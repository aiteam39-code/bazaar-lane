// db.js - the database: creates every table, and fills a brand-new database with sample data.
// The data file is marketplace.db, or the file named in the DB_FILE environment variable (tests use their own file).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { rupees } = require('./money');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'marketplace.db');
// Product photos sellers upload live in this folder (tests use their own folder).
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');   // safe when several requests read and write at the same time
db.pragma('foreign_keys = ON');    // an id that points at another table must really exist
db.pragma('busy_timeout = 5000');  // wait up to 5 seconds if the file is busy

// The time right now as text the database can sort and compare (UTC, ISO format).
function nowIso() {
  return new Date().toISOString();
}

// The form of a name that search compares: small letters in every alphabet, so CRÈME finds Crème.
// (SQLite's own LIKE only ignores the case of A to Z.)
function searchForm(text) {
  return String(text).normalize('NFC').toLowerCase();
}

// SQL can call search_text(name) to get the same form, for example: WHERE search_text(products.name) LIKE ?
db.function('search_text', { deterministic: true }, (text) => (text === null ? null : searchForm(text)));

// Creates every table from CLAUDE.md, if they do not exist yet. All money columns are whole paise.
function createTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sellers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shop_name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'rejected', 'suspended')),
      status_reason TEXT,
      commission_bps INTEGER CHECK (commission_bps IS NULL OR commission_bps BETWEEN 0 AND 10000),
      shipping_fee INTEGER NOT NULL DEFAULT 0 CHECK (shipping_fee >= 0),
      free_shipping_over INTEGER CHECK (free_shipping_over IS NULL OR free_shipping_over >= 0),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin', 'seller')),
      seller_id INTEGER REFERENCES sellers(id),
      failed_logins INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL,
      CHECK ((role = 'admin' AND seller_id IS NULL) OR (role = 'seller' AND seller_id IS NOT NULL))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      commission_bps INTEGER CHECK (commission_bps IS NULL OR commission_bps BETWEEN 0 AND 10000)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL REFERENCES sellers(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '📦',
      price INTEGER NOT NULL CHECK (price > 0),
      stock INTEGER NOT NULL DEFAULT 0 CHECK (stock >= 0),
      low_stock_level INTEGER NOT NULL DEFAULT 0 CHECK (low_stock_level >= 0),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
      deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
      created_at TEXT NOT NULL,
      hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
      hidden_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS customer_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      tracking_token TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT NOT NULL,
      address TEXT NOT NULL,
      payment_method TEXT NOT NULL CHECK (payment_method IN ('online', 'cod')),
      items_total INTEGER NOT NULL CHECK (items_total >= 0),
      shipping_total INTEGER NOT NULL CHECK (shipping_total >= 0),
      grand_total INTEGER NOT NULL CHECK (grand_total >= 0),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seller_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_order_id INTEGER NOT NULL REFERENCES customer_orders(id),
      seller_id INTEGER NOT NULL REFERENCES sellers(id),
      status TEXT NOT NULL CHECK (status IN ('pending_payment', 'placed', 'accepted', 'packed', 'shipped', 'delivered', 'rejected', 'cancelled')),
      reason TEXT,
      courier TEXT,
      tracking_number TEXT,
      items_total INTEGER NOT NULL CHECK (items_total >= 0),
      shipping INTEGER NOT NULL CHECK (shipping >= 0),
      commission_bps INTEGER NOT NULL CHECK (commission_bps BETWEEN 0 AND 10000),
      commission INTEGER NOT NULL CHECK (commission >= 0),
      payment_status TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_order_id INTEGER NOT NULL REFERENCES seller_orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      name TEXT NOT NULL,
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
      line_total INTEGER NOT NULL CHECK (line_total >= 0)
    );

    CREATE TABLE IF NOT EXISTS status_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_order_id INTEGER NOT NULL REFERENCES seller_orders(id),
      status TEXT NOT NULL CHECK (status IN ('pending_payment', 'placed', 'accepted', 'packed', 'shipped', 'delivered', 'rejected', 'cancelled')),
      by_role TEXT NOT NULL CHECK (by_role IN ('system', 'customer', 'seller', 'admin')),
      at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_order_id INTEGER NOT NULL REFERENCES customer_orders(id),
      provider TEXT NOT NULL CHECK (provider IN ('fake', 'razorpay')),
      provider_ref TEXT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
      created_at TEXT NOT NULL
    );

    -- seller_order_id is UNIQUE: a seller order can be refunded only once, even if two requests arrive together.
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      seller_order_id INTEGER NOT NULL UNIQUE REFERENCES seller_orders(id),
      amount INTEGER NOT NULL CHECK (amount > 0),
      provider_ref TEXT,
      created_at TEXT NOT NULL
    );

    -- amount is + when the platform owes the seller, - when the seller owes or was paid.
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_id INTEGER NOT NULL REFERENCES sellers(id),
      seller_order_id INTEGER REFERENCES seller_orders(id),
      type TEXT NOT NULL CHECK (type IN ('earning', 'commission_owed', 'payout')),
      amount INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    -- Sector 6: verified reviews. order_item_id is UNIQUE: one review per product per order.
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_item_id INTEGER NOT NULL UNIQUE REFERENCES order_items(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      seller_id INTEGER NOT NULL REFERENCES sellers(id),
      rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
      text TEXT NOT NULL DEFAULT '',
      seller_reply TEXT,
      hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
      created_at TEXT NOT NULL
    );

    -- Sector 5: "Help with this order". Only one open request per seller order (the index below).
    CREATE TABLE IF NOT EXISTS help_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seller_order_id INTEGER NOT NULL REFERENCES seller_orders(id),
      message TEXT NOT NULL,
      seller_reply TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
      resolution TEXT,
      created_at TEXT NOT NULL,
      resolved_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS help_one_open_per_order ON help_requests(seller_order_id) WHERE status = 'open';

    -- Sector 6: "Report this listing".
    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'hidden', 'dismissed')),
      created_at TEXT NOT NULL
    );

    -- Sector 9: the contact form and the newsletter.
    CREATE TABLE IF NOT EXISTS contact_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      handled INTEGER NOT NULL DEFAULT 0 CHECK (handled IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS newsletter (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      consent_at TEXT NOT NULL,
      unsubscribe_token TEXT NOT NULL UNIQUE
    );

    -- The outbox: every email the app "sends" (mail.js). Nothing is really sent.
    CREATE TABLE IF NOT EXISTS emails (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      to_address TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- How many times customers opened each product page, per day (sellers and the admin do not count).
    CREATE TABLE IF NOT EXISTS product_views (
      product_id INTEGER NOT NULL REFERENCES products(id),
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
      PRIMARY KEY (product_id, day)
    );

    -- Sector 4: a one-time code checks the phone before a cash-on-delivery order.
    CREATE TABLE IF NOT EXISTS phone_codes (
      phone TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      tries INTEGER NOT NULL DEFAULT 0,
      verify_token TEXT,
      verified_until TEXT
    );

    -- Seasons (festival looks): the store dresses up between starts_at and ends_at (local time, 'YYYY-MM-DD HH:MM')
    -- while enabled. Nothing about prices, stock or orders depends on a season, apart from the optional gift wrap.
    CREATE TABLE IF NOT EXISTS seasons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
    );

    -- The home page's promo cards (the admin switches each on or off and changes its words, photo and link).
    CREATE TABLE IF NOT EXISTS promo_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      position INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      line TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL,
      tone TEXT NOT NULL DEFAULT 'sunk' CHECK (tone IN ('accent', 'success', 'sunk', 'danger')),
      photo TEXT,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
    );

    -- A delivered seller order is booked in the ledger only once.
    CREATE UNIQUE INDEX IF NOT EXISTS ledger_one_booking_per_order ON ledger(seller_order_id, type) WHERE seller_order_id IS NOT NULL;

    -- Indexes so lists stay fast as the data grows.
    CREATE INDEX IF NOT EXISTS products_by_seller ON products(seller_id);
    CREATE INDEX IF NOT EXISTS products_by_category ON products(category_id);
    CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS seller_orders_by_seller ON seller_orders(seller_id, status);
    CREATE INDEX IF NOT EXISTS seller_orders_by_customer_order ON seller_orders(customer_order_id);
    CREATE INDEX IF NOT EXISTS order_items_by_seller_order ON order_items(seller_order_id);
    CREATE INDEX IF NOT EXISTS status_log_by_seller_order ON status_log(seller_order_id);
    CREATE INDEX IF NOT EXISTS payments_by_customer_order ON payments(customer_order_id);
    CREATE INDEX IF NOT EXISTS ledger_by_seller ON ledger(seller_id);
  `);
}

// Sector 2 added two columns to products, so the admin can hide a product that breaks the rules:
// hidden (0 or 1) and hidden_reason. An older database gets them here; every row and value is kept.
function addMissingColumns() {
  const productColumns = db.prepare('PRAGMA table_info(products)').all().map((column) => column.name);
  if (!productColumns.includes('hidden')) {
    db.exec('ALTER TABLE products ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))');
  }
  if (!productColumns.includes('hidden_reason')) {
    db.exec('ALTER TABLE products ADD COLUMN hidden_reason TEXT');
  }
  if (!productColumns.includes('photo')) {
    db.exec('ALTER TABLE products ADD COLUMN photo TEXT'); // the photo's file name in the uploads folder, or empty
  }
  // Seasons: giftable products, each shop's gift-wrap price (0 = not offered), and the gift wrap and message copied
  // into each order. Sample products that make good gifts are tagged once, when the column is first added.
  const giftColumns = {
    products: { giftable: 'INTEGER NOT NULL DEFAULT 0 CHECK (giftable IN (0, 1))' },
    sellers: { gift_wrap_price: 'INTEGER NOT NULL DEFAULT 0 CHECK (gift_wrap_price >= 0)' },
    seller_orders: { gift_wrap: 'INTEGER NOT NULL DEFAULT 0 CHECK (gift_wrap >= 0)', gift_message: 'TEXT' },
    customer_orders: { gift_wrap_total: 'INTEGER NOT NULL DEFAULT 0 CHECK (gift_wrap_total >= 0)' },
  };
  for (const [table, columns] of Object.entries(giftColumns)) {
    const have = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
    for (const [name, definition] of Object.entries(columns)) {
      if (have.includes(name)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      if (table === 'products' && name === 'giftable') tagSampleGifts();
      if (table === 'sellers' && name === 'gift_wrap_price') addSampleGiftWrap();
    }
  }
  // The home page rebuild: a size or weight for each product ("250 g", "Set of 4"), and a photo for category tiles.
  const productHas = db.prepare('PRAGMA table_info(products)').all().map((column) => column.name);
  if (!productHas.includes('size_label')) {
    db.exec("ALTER TABLE products ADD COLUMN size_label TEXT NOT NULL DEFAULT ''");
    addSampleSizes();
  }
  const categoryHas = db.prepare('PRAGMA table_info(categories)').all().map((column) => column.name);
  if (!categoryHas.includes('photo')) db.exec('ALTER TABLE categories ADD COLUMN photo TEXT');
  // Sector 4: the provider's id of the payment itself (Razorpay refunds need it).
  const paymentColumns = db.prepare('PRAGMA table_info(payments)').all().map((column) => column.name);
  if (!paymentColumns.includes('paid_ref')) db.exec('ALTER TABLE payments ADD COLUMN paid_ref TEXT');
  // The prompt pack's notebook upgrade (2a): each shop's city, dispatch days, return window, approval date and early bird.
  const sellerColumns = db.prepare('PRAGMA table_info(sellers)').all().map((column) => column.name);
  const newSellerColumns = {
    city: "TEXT NOT NULL DEFAULT ''",
    dispatch_days: 'INTEGER NOT NULL DEFAULT 2 CHECK (dispatch_days BETWEEN 1 AND 7)',
    return_days: 'INTEGER NOT NULL DEFAULT 7 CHECK (return_days IN (0, 7, 10, 15, 30))',
    approved_at: 'TEXT',
    early_bird: 'INTEGER NOT NULL DEFAULT 0 CHECK (early_bird IN (0, 1))',
  };
  for (const [name, definition] of Object.entries(newSellerColumns)) {
    if (!sellerColumns.includes(name)) db.exec(`ALTER TABLE sellers ADD COLUMN ${name} ${definition}`);
  }
  // Shops approved before approved_at existed count as approved when they joined (done once, when the column is added).
  if (!sellerColumns.includes('approved_at')) {
    db.exec("UPDATE sellers SET approved_at = created_at WHERE status IN ('active', 'suspended')");
  }
}

// The sample products that make good gifts (tagged giftable), and the sample shops' gift-wrap prices.
const SAMPLE_GIFTS = ['Chilli Pickle Gift Box', 'Red Chilli Garlic Chutney', 'Chilli Masala Spice Mix', 'Hanging Clay Lamp',
  'Clay Diya Set (12)', 'Clay Tea Cups (set of 4)', 'Clay Planter', 'Cotton Stole', 'Cotton Tote Bag', 'Hand-woven Scarf'];
const SAMPLE_GIFT_WRAP = { 'Chilli Lane Pantry': 3000, 'Terracotta Corner': 5000, 'Handloom Nook': 4000 };
function tagSampleGifts() {
  const tag = db.prepare('UPDATE products SET giftable = 1 WHERE name = ?');
  for (const name of SAMPLE_GIFTS) tag.run(name);
}
function addSampleGiftWrap() {
  const set = db.prepare('UPDATE sellers SET gift_wrap_price = ? WHERE shop_name = ?');
  for (const [shop, paise] of Object.entries(SAMPLE_GIFT_WRAP)) set.run(paise, shop);
}

// The sizes of the 18 first sample products (filled in once, when the size column is added).
const SAMPLE_SIZES = {
  'Green Chilli Pickle': '300 g', 'Red Chilli Garlic Chutney': '200 g', 'Hot Chilli Sauce': '250 ml', 'Smoky Chilli Oil': '200 ml',
  'Chilli Masala Spice Mix': '100 g', 'Chilli Pickle Gift Box': 'Set of 3', 'Clay Water Bottle': '1 litre', 'Terracotta Cooking Pot': '2 litres',
  'Clay Tea Cups (set of 4)': 'Set of 4', 'Hanging Clay Lamp': '1 piece', 'Clay Planter': '15 cm', 'Clay Diya Set (12)': 'Set of 12',
  'Cotton Stole': '2 m', 'Handloom Bath Towel': '140 x 70 cm', 'Cotton Tote Bag': '1 bag', 'Hand-woven Scarf': '1.8 m',
  'Cotton Kitchen Towels (set of 3)': 'Set of 3', 'Woollen Shawl': '2 m',
};
function addSampleSizes() {
  const set = db.prepare("UPDATE products SET size_label = ? WHERE name = ? AND size_label = ''");
  for (const [name, size] of Object.entries(SAMPLE_SIZES)) set.run(size, name);
}

// More categories for the home page's category grid, each with its rate, and sample products from the sample shops so
// none is empty. Added once: a category that already exists is left alone (and so are its products).
const MORE_CATEGORIES = [
  ['Pantry and spices', 800], ['Snacks and sweets', 800], ['Tea and coffee', 800], ['Fresh and organic', 800],
  ['Breakfast and spreads', 800], ['Home decor', 1000], ['Bags and accessories', 1200], ['Jewellery', 1500],
  ['Beauty and personal care', 1200], ['Health and wellness', 1000], ['Baby care', 1000], ['Pet care', 1000],
  ['Stationery and prints', 1200], ['Toys and games', 1200], ['Cleaning essentials', 1000], ['Plants and garden', 1000],
  ['Festive and puja', 1500],
];
// [shop, category, name, price in rupees, stock, low-stock level, size, description, giftable]
const MORE_PRODUCTS = [
  ['Chilli Lane Pantry', 'Pantry and spices', 'Whole Cumin Seeds', 140, 30, 6, '200 g', 'Bold, sun-dried cumin seeds for tempering.', 0],
  ['Chilli Lane Pantry', 'Pantry and spices', 'Turmeric Powder', 120, 35, 6, '250 g', 'Bright, earthy turmeric, stone-ground in small batches.', 0],
  ['Chilli Lane Pantry', 'Snacks and sweets', 'Spicy Banana Chips', 110, 40, 8, '200 g', 'Thin banana chips with a little chilli and salt.', 0],
  ['Chilli Lane Pantry', 'Snacks and sweets', 'Jaggery Peanut Chikki', 130, 30, 6, '250 g', 'Crunchy peanut brittle made with jaggery.', 1],
  ['Chilli Lane Pantry', 'Tea and coffee', 'Masala Chai Blend', 210, 25, 5, '250 g', 'Assam tea with ginger, cardamom and a pinch of pepper.', 1],
  ['Chilli Lane Pantry', 'Tea and coffee', 'Filter Coffee Powder', 260, 20, 5, '250 g', 'A medium roast with chicory, for a strong filter coffee.', 0],
  ['Chilli Lane Pantry', 'Fresh and organic', 'Organic Jaggery Block', 150, 25, 5, '500 g', 'Unrefined jaggery from organic sugarcane.', 0],
  ['Chilli Lane Pantry', 'Fresh and organic', 'Organic Red Chilli Flakes', 160, 25, 5, '100 g', 'Sun-dried organic red chillies, roughly crushed.', 0],
  ['Chilli Lane Pantry', 'Breakfast and spreads', 'Mango Chilli Jam', 230, 20, 4, '250 g', 'Sweet mango jam with a gentle chilli warmth.', 1],
  ['Chilli Lane Pantry', 'Breakfast and spreads', 'Roasted Peanut Butter', 240, 20, 4, '300 g', 'Just roasted peanuts and a little salt.', 0],
  ['Chilli Lane Pantry', 'Health and wellness', 'Tulsi Ginger Tea', 180, 25, 5, '100 g', 'Holy basil and dried ginger, caffeine-free.', 0],
  ['Chilli Lane Pantry', 'Health and wellness', 'Turmeric Honey', 260, 18, 4, '250 g', 'Raw honey stirred with turmeric and black pepper.', 1],
  ['Terracotta Corner', 'Home decor', 'Terracotta Wall Plate', 480, 10, 2, '25 cm', 'A hand-painted clay plate to hang on the wall.', 1],
  ['Terracotta Corner', 'Home decor', 'Clay Bud Vase', 260, 15, 3, '12 cm', 'A small vase for a single flower.', 1],
  ['Terracotta Corner', 'Jewellery', 'Terracotta Bead Necklace', 390, 12, 3, '45 cm', 'Hand-rolled clay beads, painted and fired.', 1],
  ['Terracotta Corner', 'Jewellery', 'Clay Stud Earrings', 220, 20, 4, '1 pair', 'Light clay studs with a matt glaze.', 1],
  ['Terracotta Corner', 'Pet care', 'Clay Pet Water Bowl', 340, 15, 3, '18 cm', 'A heavy clay bowl that keeps water cool.', 0],
  ['Terracotta Corner', 'Toys and games', 'Clay Spinning Tops', 180, 20, 4, 'Set of 3', 'Painted clay tops, the old-fashioned way.', 1],
  ['Terracotta Corner', 'Toys and games', 'Terracotta Whistle Bird', 150, 20, 4, '1 piece', 'A little clay bird that whistles when you blow.', 1],
  ['Terracotta Corner', 'Cleaning essentials', 'Coconut Fibre Scrubbers', 120, 30, 6, 'Set of 3', 'Tough scrubbers for clay and iron pots.', 0],
  ['Terracotta Corner', 'Plants and garden', 'Small Clay Herb Pots', 280, 15, 3, 'Set of 2', 'Two small pots with saucers, for a kitchen window.', 1],
  ['Terracotta Corner', 'Plants and garden', 'Clay Bird Feeder', 330, 10, 2, '1 piece', 'A hanging clay feeder for seeds and water.', 0],
  ['Terracotta Corner', 'Festive and puja', 'Painted Rangoli Diyas', 200, 25, 5, 'Set of 4', 'Bright, hand-painted clay lamps for festivals.', 1],
  ['Terracotta Corner', 'Festive and puja', 'Clay Puja Thali', 450, 10, 2, '25 cm', 'A clay plate with small bowls for offerings.', 1],
  ['Handloom Nook', 'Bags and accessories', 'Handloom Sling Bag', 520, 12, 3, '1 bag', 'A woven sling bag with a long strap.', 1],
  ['Handloom Nook', 'Bags and accessories', 'Cotton Coin Pouches', 180, 25, 5, 'Set of 3', 'Small zip pouches in block-printed cotton.', 1],
  ['Handloom Nook', 'Beauty and personal care', 'Cotton Face Towels', 240, 25, 5, 'Set of 4', 'Soft, small towels for the face.', 0],
  ['Handloom Nook', 'Beauty and personal care', 'Handloom Hair Wrap', 210, 20, 4, '1 piece', 'A light cotton wrap for drying hair.', 0],
  ['Handloom Nook', 'Baby care', 'Soft Cotton Baby Swaddle', 390, 15, 3, '100 x 100 cm', 'A breathable muslin swaddle for babies.', 1],
  ['Handloom Nook', 'Baby care', 'Muslin Baby Bibs', 260, 20, 4, 'Set of 3', 'Soft, washable bibs.', 1],
  ['Handloom Nook', 'Pet care', 'Cotton Pet Bed Cover', 450, 10, 2, '60 x 80 cm', 'A washable cover for a medium pet bed.', 0],
  ['Handloom Nook', 'Stationery and prints', 'Block-printed Notebook', 230, 20, 4, 'A5, 120 pages', 'A cotton-covered notebook with plain pages.', 1],
  ['Handloom Nook', 'Stationery and prints', 'Handmade Paper Cards', 190, 25, 5, 'Set of 6', 'Cards and envelopes made from cotton rag paper.', 1],
  ['Handloom Nook', 'Cleaning essentials', 'Cotton Cleaning Cloths', 160, 30, 6, 'Set of 6', 'Thick cloths that wash well again and again.', 0],
];
function addMoreCategories() {
  const added = [];
  for (const [name, rate] of MORE_CATEGORIES) {
    if (db.prepare('SELECT 1 FROM categories WHERE name = ?').get(name)) continue;
    db.prepare('INSERT INTO categories (name, commission_bps) VALUES (?, ?)').run(name, rate);
    added.push(name);
  }
  return added;
}
// Adds the sample products of these categories (only for sample shops that exist, and never a product twice).
function addMoreSampleProducts(categoryNames) {
  const insert = db.prepare(`
    INSERT INTO products (seller_id, category_id, name, description, emoji, price, stock, low_stock_level, active, deleted,
                          created_at, giftable, size_label)
    VALUES (?, ?, ?, ?, '', ?, ?, ?, 1, 0, ?, ?, ?)`);
  for (const [shop, category, name, price, stock, low, size, description, giftable] of MORE_PRODUCTS) {
    if (!categoryNames.includes(category)) continue;
    const seller = db.prepare('SELECT id FROM sellers WHERE shop_name = ?').get(shop);
    const categoryRow = db.prepare('SELECT id FROM categories WHERE name = ?').get(category);
    if (!seller || !categoryRow || db.prepare('SELECT 1 FROM products WHERE name = ? AND seller_id = ?').get(name, seller.id)) continue;
    insert.run(seller.id, categoryRow.id, name, description, rupees(price), stock, low, nowIso(), giftable, size);
  }
}

// The home page's promo cards, added once (when there are none): each links to a real category or collection page.
const SAMPLE_PROMO_CARDS = [
  ['Pantry staples at your doorstep', 'Spices, pickles and oils from small kitchens', '/category/pantry-and-spices', 'accent'],
  ['Home and kitchen, handmade', 'Pots, mugs and planters from family potteries', '/category/home-and-kitchen', 'success'],
  ['Gifts for every occasion', 'Things makers marked as giftable', '/search?giftable=1', 'danger'],
  ['Pet care supplies at your door', 'Cool clay bowls and washable bed covers', '/category/pet-care', 'sunk'],
  ['No time to shop for the baby?', 'Baby essentials, delivered', '/category/baby-care', 'success'],
  ['Get prints and stationery delivered', 'Notebooks and cards on handmade paper', '/category/stationery-and-prints', 'accent'],
];
function addSamplePromoCards() {
  if (db.prepare('SELECT COUNT(*) AS n FROM promo_cards').get().n > 0) return;
  const insert = db.prepare('INSERT INTO promo_cards (position, title, line, link, tone, enabled) VALUES (?, ?, ?, ?, ?, 1)');
  SAMPLE_PROMO_CARDS.forEach(([title, line, link, tone], index) => insert.run(index + 1, title, line, link, tone));
}

// The seasons, added once when missing: Christmas, 1 to 26 December (until 23:59) of this year.
function addDefaultSeasons() {
  const year = new Date().getFullYear();
  db.prepare("INSERT OR IGNORE INTO seasons (key, name, starts_at, ends_at, enabled) VALUES ('christmas', 'Christmas', ?, ?, 1)")
    .run(`${year}-12-01 00:00`, `${year}-12-26 23:59`);
}

// Settings the app needs. Added only when missing, so a change the admin makes is never overwritten.
function addDefaultSettings() {
  const add = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  add.run('default_commission_bps', '1000'); // 10%
  add.run('cod_enabled', '1');               // cash on delivery is switched on
  add.run('early_bird_slots', '0');          // the early-bird offer is off until the admin sets it
  add.run('early_bird_bps', '500');          // 5%
  add.run('early_bird_days', '90');
}

// The sample shops' city, dispatch days and return window (only filled in while a sample shop has no city yet).
const SAMPLE_SHOP_DETAILS = {
  'Chilli Lane Pantry': { city: 'Jaipur', dispatch_days: 2, return_days: 7 },
  'Terracotta Corner': { city: 'Khurja', dispatch_days: 3, return_days: 10 },
  'Handloom Nook': { city: 'Kannur', dispatch_days: 2, return_days: 15 },
  'Brass Bell Crafts': { city: 'Moradabad', dispatch_days: 3, return_days: 0 },
};
function addSampleShopDetails() {
  const update = db.prepare("UPDATE sellers SET city = ?, dispatch_days = ?, return_days = ? WHERE shop_name = ? AND city = ''");
  for (const [shopName, details] of Object.entries(SAMPLE_SHOP_DETAILS)) {
    update.run(details.city, details.dispatch_days, details.return_days, shopName);
  }
}

// The sample photos (free Unsplash photos, see CREDITS.md) live in the sample-photos folder, named after what they
// show: category-<name>.jpg, promo-<title>.jpg, product-<name>.jpg. A category, promo card or product that has NO photo
// yet and has a matching file gets a copy of it in the uploads folder under a new random name. A photo someone already
// uploaded is never replaced, so this only fills gaps (for example in a friend's brand-new database).
const SAMPLE_PHOTOS_DIR = path.join(__dirname, 'sample-photos');
const photoSlug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function addSamplePhotos() {
  if (!fs.existsSync(SAMPLE_PHOTOS_DIR)) return;
  const files = new Set(fs.readdirSync(SAMPLE_PHOTOS_DIR));
  const targets = [
    ['category', 'categories', 'name'], ['promo', 'promo_cards', 'title'], ['product', 'products', 'name'],
  ];
  for (const [kind, table, nameColumn] of targets) {
    const rows = db.prepare(`SELECT id, ${nameColumn} AS name FROM ${table} WHERE photo IS NULL OR photo = ''`).all();
    for (const row of rows) {
      const file = `${kind}-${photoSlug(row.name)}.jpg`;
      if (!files.has(file)) continue;
      const newName = crypto.randomBytes(16).toString('hex') + '.jpg';
      fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      fs.copyFileSync(path.join(SAMPLE_PHOTOS_DIR, file), path.join(UPLOADS_DIR, newName), fs.constants.COPYFILE_EXCL);
      db.prepare(`UPDATE ${table} SET photo = ? WHERE id = ?`).run(newName, row.id);
    }
  }
}

createTables();
addMissingColumns();
addDefaultSettings();
addDefaultSeasons();
addMoreSampleProducts(addMoreCategories());
addSamplePromoCards();
addSampleShopDetails();
addSamplePhotos();

// ---------- Sample data (only for a brand-new, empty database) ----------

const ADMIN_PASSWORD_MIN = 12; // an admin password must be at least 12 characters

// Demo logins. TEST passwords only, for trying the app on this laptop. They are also listed in DEMO_LOGINS.md.
const DEMO_ACCOUNTS = [
  { email: 'admin@bazaarlane.test', password: 'admin-test-2026', role: 'admin', shop: null },
  { email: 'pantry@bazaarlane.test', password: 'pantry-test-2026', role: 'seller', shop: 'Chilli Lane Pantry' },
  { email: 'terracotta@bazaarlane.test', password: 'terracotta-test-2026', role: 'seller', shop: 'Terracotta Corner' },
  { email: 'handloom@bazaarlane.test', password: 'handloom-test-2026', role: 'seller', shop: 'Handloom Nook' },
  { email: 'brassbell@bazaarlane.test', password: 'brassbell-test-2026', role: 'seller', shop: 'Brass Bell Crafts' },
];

// 4 categories, each with its own commission rate (basis points: 800 = 8%).
const SAMPLE_CATEGORIES = [
  { name: 'Food and spices', commission_bps: 800 },
  { name: 'Home and kitchen', commission_bps: 1000 },
  { name: 'Clothing', commission_bps: 1200 },
  { name: 'Gifts and crafts', commission_bps: 1500 },
];

// 3 active shops and 1 pending shop. Terracotta Corner has its own 9% rate, the others use their category's rate.
const SAMPLE_SHOPS = [
  {
    shop_name: 'Chilli Lane Pantry', slug: 'chilli-lane-pantry', status: 'active', phone: '9000000101',
    description: 'Small-batch chilli pickles, hot sauces and spice mixes, made in our own kitchen.',
    commission_bps: null, shipping_fee: rupees(40), free_shipping_over: rupees(499),
  },
  {
    shop_name: 'Terracotta Corner', slug: 'terracotta-corner', status: 'active', phone: '9000000102',
    description: 'Hand-made clay pots, cups and lamps from a family pottery.',
    commission_bps: 900, shipping_fee: rupees(80), free_shipping_over: rupees(999),
  },
  {
    shop_name: 'Handloom Nook', slug: 'handloom-nook', status: 'active', phone: '9000000103',
    description: 'Soft cotton stoles, towels and bags woven on hand looms.',
    commission_bps: null, shipping_fee: rupees(60), free_shipping_over: rupees(799),
  },
  {
    shop_name: 'Brass Bell Crafts', slug: 'brass-bell-crafts', status: 'pending', phone: '9000000104',
    description: 'Hand-polished brass bells, lamps and small gifts.',
    commission_bps: null, shipping_fee: rupees(50), free_shipping_over: rupees(599),
  },
];

// 18 products, 6 per active shop. Prices are in whole rupees here and saved as paise.
// LOW on purpose: Green Chilli Pickle (3, low at 5), Terracotta Cooking Pot (2, low at 3), Chilli Pickle Gift Box (0 = sold out).
// Switched off on purpose: Woollen Shawl.
const SAMPLE_PRODUCTS = {
  'Chilli Lane Pantry': [
    { name: 'Green Chilli Pickle', category: 'Food and spices', price: 180, stock: 3, low: 5, emoji: '🌶️', description: 'Whole green chillies in mustard oil with lemon and spices. 300 g jar.' },
    { name: 'Red Chilli Garlic Chutney', category: 'Food and spices', price: 150, stock: 25, low: 5, emoji: '🧄', description: 'A hot, garlicky chutney for snacks and sandwiches. 200 g jar.' },
    { name: 'Hot Chilli Sauce', category: 'Food and spices', price: 220, stock: 18, low: 5, emoji: '🔥', description: 'Fiery red chilli sauce with a little vinegar. 250 ml bottle.' },
    { name: 'Smoky Chilli Oil', category: 'Food and spices', price: 260, stock: 12, low: 4, emoji: '🫙', description: 'Dried red chillies and garlic in hot oil. Great on noodles. 200 ml.' },
    { name: 'Chilli Masala Spice Mix', category: 'Food and spices', price: 120, stock: 40, low: 10, emoji: '🥄', description: 'Our everyday blend of red chilli, coriander and cumin. 100 g pack.' },
    { name: 'Chilli Pickle Gift Box', category: 'Gifts and crafts', price: 599, stock: 0, low: 2, emoji: '🎁', description: 'Three small jars of our best pickles in a gift box.' },
  ],
  'Terracotta Corner': [
    { name: 'Clay Water Bottle', category: 'Home and kitchen', price: 450, stock: 10, low: 3, emoji: '🏺', description: 'Keeps water cool the natural way. 1 litre.' },
    { name: 'Terracotta Cooking Pot', category: 'Home and kitchen', price: 650, stock: 2, low: 3, emoji: '🍲', description: 'A deep clay pot for slow-cooked curries and dal. 2 litres.' },
    { name: 'Clay Tea Cups (set of 4)', category: 'Home and kitchen', price: 380, stock: 20, low: 5, emoji: '☕', description: 'Small hand-made cups for hot chai.' },
    { name: 'Hanging Clay Lamp', category: 'Gifts and crafts', price: 520, stock: 8, low: 2, emoji: '🏮', description: 'A painted clay lamp with a hook for hanging.' },
    { name: 'Clay Planter', category: 'Home and kitchen', price: 300, stock: 15, low: 4, emoji: '🪴', description: 'A round planter with a drainage hole. 15 cm wide.' },
    { name: 'Clay Diya Set (12)', category: 'Gifts and crafts', price: 240, stock: 30, low: 10, emoji: '🪔', description: 'Twelve hand-shaped oil lamps for festivals.' },
  ],
  'Handloom Nook': [
    { name: 'Cotton Stole', category: 'Clothing', price: 550, stock: 14, low: 4, emoji: '🧣', description: 'A light hand-woven cotton stole in indigo stripes.' },
    { name: 'Handloom Bath Towel', category: 'Home and kitchen', price: 420, stock: 20, low: 5, emoji: '🛁', description: 'Soft, quick-drying cotton bath towel.' },
    { name: 'Cotton Tote Bag', category: 'Gifts and crafts', price: 280, stock: 25, low: 5, emoji: '👜', description: 'A strong tote bag woven from thick cotton.' },
    { name: 'Hand-woven Scarf', category: 'Clothing', price: 480, stock: 9, low: 3, emoji: '🧶', description: 'A warm cotton scarf with tassels.' },
    { name: 'Cotton Kitchen Towels (set of 3)', category: 'Home and kitchen', price: 250, stock: 30, low: 6, emoji: '🧺', description: 'Checked kitchen towels that soak up well.' },
    { name: 'Woollen Shawl', category: 'Clothing', price: 1200, stock: 6, low: 2, emoji: '🧥', description: 'A thick woollen shawl for cold evenings.', switchedOff: true },
  ],
};

// Fills the database with the sample data, but only when it has no users yet (a brand-new database).
// Returns true when it added the data. server.js calls this once at start-up.
function fillSampleDataIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (userCount > 0) return false;

  // Loaded here, not at the top, because auth.js also loads db.js.
  const { hashPassword } = require('./auth');
  const addEverything = db.transaction(() => {
    const categoryIds = addSampleCategories();
    const shopIds = addSampleShops();
    addDemoLogins(shopIds, hashPassword);
    addSampleProducts(shopIds, categoryIds);
  });
  addEverything();
  addSampleShopDetails();
  tagSampleGifts();
  addSampleGiftWrap();
  addSampleSizes();
  addMoreSampleProducts(MORE_CATEGORIES.map(([name]) => name));
  db.exec("UPDATE sellers SET approved_at = created_at WHERE approved_at IS NULL AND status = 'active'");
  addSamplePhotos();
  return true;
}

// Adds the 4 categories. Returns { 'Food and spices': id, ... }.
function addSampleCategories() {
  const ids = {};
  for (const category of SAMPLE_CATEGORIES) {
    db.prepare('INSERT OR IGNORE INTO categories (name, commission_bps) VALUES (?, ?)').run(category.name, category.commission_bps);
    ids[category.name] = db.prepare('SELECT id FROM categories WHERE name = ?').get(category.name).id;
  }
  return ids;
}

// Adds the 4 shops. Returns { 'Chilli Lane Pantry': id, ... }.
function addSampleShops() {
  const ids = {};
  const insert = db.prepare(`
    INSERT INTO sellers (shop_name, slug, description, phone, status, commission_bps, shipping_fee, free_shipping_over, created_at)
    VALUES (@shop_name, @slug, @description, @phone, @status, @commission_bps, @shipping_fee, @free_shipping_over, @created_at)`);
  for (const shop of SAMPLE_SHOPS) {
    ids[shop.shop_name] = insert.run({ ...shop, created_at: nowIso() }).lastInsertRowid;
  }
  return ids;
}

// Adds the admin and one login per sample shop. Only the password hash is saved, never the password.
function addDemoLogins(shopIds, hashPassword) {
  const insert = db.prepare('INSERT INTO users (email, password_hash, role, seller_id, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const account of DEMO_ACCOUNTS) {
    if (account.role === 'admin' && account.password.length < ADMIN_PASSWORD_MIN) {
      throw new Error(`An admin password must be at least ${ADMIN_PASSWORD_MIN} characters.`);
    }
    const sellerId = account.shop ? shopIds[account.shop] : null;
    insert.run(account.email, hashPassword(account.password), account.role, sellerId, nowIso());
  }
}

// Adds the 18 sample products.
function addSampleProducts(shopIds, categoryIds) {
  const insert = db.prepare(`
    INSERT INTO products (seller_id, category_id, name, description, emoji, price, stock, low_stock_level, active, deleted, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`);
  for (const [shopName, products] of Object.entries(SAMPLE_PRODUCTS)) {
    for (const p of products) {
      const active = p.switchedOff ? 0 : 1;
      insert.run(shopIds[shopName], categoryIds[p.category], p.name, p.description, p.emoji, rupees(p.price), p.stock, p.low, active, nowIso());
    }
  }
}

// The web address of a product's photo, or null when it has none (the page then shows the kit's placeholder art).
function photoUrl(photo) {
  return photo ? '/uploads/' + photo : null;
}

module.exports = { ADMIN_PASSWORD_MIN, db, nowIso, searchForm, fillSampleDataIfEmpty, DEMO_ACCOUNTS, DB_FILE, UPLOADS_DIR, photoUrl };
