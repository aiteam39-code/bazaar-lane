// db.js - the database: Postgres. Live, the app uses the Supabase database named in the DATABASE_URL environment
// variable (a secret: it is set in Netlify's settings, never written in code). On a laptop with no DATABASE_URL, the app
// starts its own small Postgres in the pgdata folder (the embedded-postgres package), so `npm run dev` works offline.
// Every query waits for the database:  await db.get(sql, ...values)  (one row or undefined),  await db.all(...)
// (every row),  await db.run(...)  ({ changes, lastInsertRowid }),  await db.tx(async () => { ... })  (one transaction:
// every query inside it, even in other functions it calls, belongs to it; a thrown error undoes all of it).
// SQL is written with ? for each value, as before; db.js turns it into Postgres's $1, $2 ...
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');
const pg = require('pg');
const { rupees } = require('./money');

// Numbers come back as JavaScript numbers (whole paise fit easily), and true/false as 1/0 like the rest of the code.
pg.types.setTypeParser(20, (value) => Number(value));    // bigint (COUNT, SUM)
pg.types.setTypeParser(1700, (value) => Number(value));  // numeric (AVG, ROUND)
pg.types.setTypeParser(16, (value) => (value === 't' ? 1 : 0)); // boolean

const LOCAL_DIR = process.env.DB_DIR || path.join(__dirname, 'pgdata'); // the laptop's own database folder
const LOCAL_PORT = Number(process.env.DB_PORT) || 54329;
const LOCAL_URL = `postgres://bazaar:bazaar-local@127.0.0.1:${LOCAL_PORT}/bazaar`;
// Live, the address comes from DATABASE_URL, or from SUPABASE_DATABASE_URL, which Netlify's Supabase extension sets.
if (!process.env.DATABASE_URL && /^postgres/.test(process.env.SUPABASE_DATABASE_URL || "")) process.env.DATABASE_URL = process.env.SUPABASE_DATABASE_URL;
const IS_LOCAL = !process.env.DATABASE_URL;
const DB_LABEL = IS_LOCAL ? `the local database in ${LOCAL_DIR}` : 'the database in DATABASE_URL';

let pool = null;
const transactionClient = new AsyncLocalStorage(); // the connection of the transaction we are inside, if any

// ---------- Connecting ----------

// Starts the laptop's own Postgres (once), creating its folder and database the first time.
let localServer = null;
async function startLocalPostgres() {
  const EmbeddedPostgres = require('embedded-' + 'postgres').default; // only on a laptop, never in the live function
  const firstTime = !fs.existsSync(path.join(LOCAL_DIR, 'PG_VERSION'));
  localServer = new EmbeddedPostgres({
    databaseDir: LOCAL_DIR, user: 'bazaar', password: 'bazaar-local', port: LOCAL_PORT, persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C', '--locale-provider=icu', '--icu-locale=und'], onLog: () => {}, onError: () => {},
  });
  if (firstTime) await localServer.initialise();
  await localServer.start();
  if (firstTime) await localServer.createDatabase('bazaar');
}

// Stops the laptop's Postgres (tests use this; a running app keeps it until it ends).
async function close() {
  if (pool) await pool.end();
  pool = null;
  if (localServer) await localServer.stop();
  localServer = null;
}

// The pool of connections, made on first use.
function getPool() {
  if (!pool) {
    const url = process.env.DATABASE_URL || LOCAL_URL;
    const ssl = /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
    pool = new pg.Pool({ connectionString: url, ssl, max: Number(process.env.DB_POOL_SIZE) || (IS_LOCAL ? 10 : 3) });
  }
  return pool;
}

// ---------- Running SQL ----------

// Tables whose rows have no numeric id (an INSERT into them does not ask for one back).
const NO_ID = new Set(['settings', 'product_views', 'phone_codes', 'sessions', 'photos']);

// Turns the SQL the app writes into Postgres SQL: ? -> $1 $2 ..., LIKE -> ILIKE (letter case ignored, as before),
// "x COLLATE NOCASE" -> lower(x), "INSERT OR IGNORE" -> ON CONFLICT DO NOTHING, and an INSERT gets RETURNING id.
function toPostgres(sql) {
  let text = sql.replace(/([\w.]+) COLLATE NOCASE/g, 'lower($1)').replace(/\bLIKE\b/g, 'ILIKE');
  const ignore = /^\s*INSERT OR IGNORE INTO/i.test(text);
  if (ignore) text = text.replace(/INSERT OR IGNORE INTO/i, 'INSERT INTO') + ' ON CONFLICT DO NOTHING';
  const insert = /^\s*INSERT INTO\s+(\w+)/i.exec(text);
  if (insert && !NO_ID.has(insert[1]) && !/\bRETURNING\b/i.test(text)) text += ' RETURNING id';
  let number = 0;
  let inQuote = false;
  let out = '';
  for (const ch of text) {
    if (ch === "'") inQuote = !inQuote;
    out += ch === '?' && !inQuote ? '$' + (number += 1) : ch;
  }
  return out;
}

// Runs one statement on the transaction's connection, or on the pool. Errors get plain codes the routes check.
async function query(sql, values) {
  const client = transactionClient.getStore() || getPool();
  try {
    return await client.query(toPostgres(sql), values.map((v) => (v === undefined ? null : v)));
  } catch (err) {
    if (err.code === '23505') err.code = 'UNIQUE_VIOLATION';
    else if (err.code === '23514') err.code = 'CHECK_VIOLATION';
    else if (err.code === '23503') err.code = 'FOREIGN_KEY_VIOLATION';
    throw err;
  }
}

const db = {
  // The first row, or undefined.
  async get(sql, ...values) { return (await query(sql, values)).rows[0]; },
  // Every row.
  async all(sql, ...values) { return (await query(sql, values)).rows; },
  // A change: how many rows it touched and, for an INSERT, the new row's id.
  async run(sql, ...values) {
    const result = await query(sql, values);
    return { changes: result.rowCount, lastInsertRowid: result.rows[0] ? result.rows[0].id : undefined, rows: result.rows };
  },
  // Several statements with no values (table set-up).
  async exec(sql) {
    const client = transactionClient.getStore() || getPool();
    await client.query(sql);
  },
  // One transaction. Inside another transaction it becomes a savepoint, so the outer one still decides.
  async tx(work) {
    const outer = transactionClient.getStore();
    if (outer) {
      const name = 'sp_' + crypto.randomBytes(4).toString('hex');
      await outer.query(`SAVEPOINT ${name}`);
      try {
        const result = await work();
        await outer.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (err) {
        await outer.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw err;
      }
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const result = await transactionClient.run(client, work);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  },
  // Inside a transaction: waits for, then holds until the end, a lock on one named thing (for example one shop's payouts).
  async lock(name, id = 0) {
    await query('SELECT pg_advisory_xact_lock(hashtext(?), ?)', [name, id]);
  },
};

// The time right now as text the database can sort and compare (UTC, ISO format).
function nowIso() {
  return new Date().toISOString();
}

// The form of a name that search compares: small letters in every alphabet, so CRÈME finds Crème.
function searchForm(text) {
  return String(text).normalize('NFC').toLowerCase();
}

// ---------- The tables ----------

// Every table from CLAUDE.md (created only if missing). All money columns are whole paise. Photos are kept in the
// photos table, so the live site needs no file storage.
const SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS sellers (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      commission_bps INTEGER CHECK (commission_bps IS NULL OR commission_bps BETWEEN 0 AND 10000)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id SERIAL PRIMARY KEY,
      seller_id INTEGER NOT NULL REFERENCES sellers(id),
      category_id INTEGER NOT NULL REFERENCES categories(id),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '',
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
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      seller_order_id INTEGER NOT NULL REFERENCES seller_orders(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      name TEXT NOT NULL,
      unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
      quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 20),
      line_total INTEGER NOT NULL CHECK (line_total >= 0)
    );

    CREATE TABLE IF NOT EXISTS status_log (
      id SERIAL PRIMARY KEY,
      seller_order_id INTEGER NOT NULL REFERENCES seller_orders(id),
      status TEXT NOT NULL CHECK (status IN ('pending_payment', 'placed', 'accepted', 'packed', 'shipped', 'delivered', 'rejected', 'cancelled')),
      by_role TEXT NOT NULL CHECK (by_role IN ('system', 'customer', 'seller', 'admin')),
      at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id SERIAL PRIMARY KEY,
      customer_order_id INTEGER NOT NULL REFERENCES customer_orders(id),
      provider TEXT NOT NULL CHECK (provider IN ('fake', 'razorpay')),
      provider_ref TEXT,
      amount INTEGER NOT NULL CHECK (amount > 0),
      status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'paid', 'failed')),
      created_at TEXT NOT NULL
    );

    -- seller_order_id is UNIQUE: a seller order can be refunded only once, even if two requests arrive together.
    CREATE TABLE IF NOT EXISTS refunds (
      id SERIAL PRIMARY KEY,
      payment_id INTEGER NOT NULL REFERENCES payments(id),
      seller_order_id INTEGER NOT NULL UNIQUE REFERENCES seller_orders(id),
      amount INTEGER NOT NULL CHECK (amount > 0),
      provider_ref TEXT,
      created_at TEXT NOT NULL
    );

    -- amount is + when the platform owes the seller, - when the seller owes or was paid.
    CREATE TABLE IF NOT EXISTS ledger (
      id SERIAL PRIMARY KEY,
      seller_id INTEGER NOT NULL REFERENCES sellers(id),
      seller_order_id INTEGER REFERENCES seller_orders(id),
      type TEXT NOT NULL CHECK (type IN ('earning', 'commission_owed', 'payout')),
      amount INTEGER NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    -- Sector 6: verified reviews. order_item_id is UNIQUE: one review per product per order.
    CREATE TABLE IF NOT EXISTS reviews (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES products(id),
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'hidden', 'dismissed')),
      created_at TEXT NOT NULL
    );

    -- Sector 9: the contact form and the newsletter.
    CREATE TABLE IF NOT EXISTS contact_messages (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      message TEXT NOT NULL,
      handled INTEGER NOT NULL DEFAULT 0 CHECK (handled IN (0, 1)),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS newsletter (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      consent_at TEXT NOT NULL,
      unsubscribe_token TEXT NOT NULL UNIQUE
    );

    -- The outbox: every email the app "sends" (mail.js). Nothing is really sent.
    CREATE TABLE IF NOT EXISTS emails (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1))
    );

    -- The home page's promo cards (the admin switches each on or off and changes its words, photo and link).
    CREATE TABLE IF NOT EXISTS promo_cards (
      id SERIAL PRIMARY KEY,
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
  
    CREATE TABLE IF NOT EXISTS photos (
      name TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      bytes BYTEA NOT NULL,
      created_at TEXT NOT NULL
    );

    -- search_text(name): the form of a name that search compares (small letters in every alphabet).
    CREATE OR REPLACE FUNCTION search_text(value TEXT) RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$ SELECT lower(normalize(value, NFC)) $$;
`;

// Creates every table that is missing, then adds any column a newer version needs.
async function createTables() {
  await db.exec(SCHEMA_SQL);
  await addMissingColumns();
  await lockTablesFromTheWebApi();
}

// Supabase also offers every table through its own web API. Row-level security with no rules closes that door: only
// this app (which owns the tables and connects with DATABASE_URL) can read or change the data.
async function lockTablesFromTheWebApi() {
  const tables = await db.all("SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND NOT rowsecurity");
  for (const { tablename } of tables) await db.exec(`ALTER TABLE ${tablename} ENABLE ROW LEVEL SECURITY`);
}

// Columns added after the first tables (each is added only when missing; rows and values are kept).
const ADDED_COLUMNS = [
  ['products', 'hidden', 'INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1))'],
  ['products', 'hidden_reason', 'TEXT'],
  ['products', 'photo', 'TEXT'],
  ['products', 'giftable', 'INTEGER NOT NULL DEFAULT 0 CHECK (giftable IN (0, 1))'],
  ['products', 'size_label', "TEXT NOT NULL DEFAULT ''"],
  ['sellers', 'gift_wrap_price', 'INTEGER NOT NULL DEFAULT 0 CHECK (gift_wrap_price >= 0)'],
  ['sellers', 'city', "TEXT NOT NULL DEFAULT ''"],
  ['sellers', 'dispatch_days', 'INTEGER NOT NULL DEFAULT 2 CHECK (dispatch_days BETWEEN 1 AND 7)'],
  ['sellers', 'return_days', 'INTEGER NOT NULL DEFAULT 7 CHECK (return_days IN (0, 7, 10, 15, 30))'],
  ['sellers', 'approved_at', 'TEXT'],
  ['sellers', 'early_bird', 'INTEGER NOT NULL DEFAULT 0 CHECK (early_bird IN (0, 1))'],
  ['seller_orders', 'gift_wrap', 'INTEGER NOT NULL DEFAULT 0 CHECK (gift_wrap >= 0)'],
  ['seller_orders', 'gift_message', 'TEXT'],
  ['customer_orders', 'gift_wrap_total', 'INTEGER NOT NULL DEFAULT 0 CHECK (gift_wrap_total >= 0)'],
  ['categories', 'photo', 'TEXT'],
  ['payments', 'paid_ref', 'TEXT'],
];
async function addMissingColumns() {
  for (const [table, column, definition] of ADDED_COLUMNS) {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} ${definition}`);
  }
}

// The sample products that make good gifts (tagged giftable), and the sample shops' gift-wrap prices.
const SAMPLE_GIFTS = ['Chilli Pickle Gift Box', 'Red Chilli Garlic Chutney', 'Chilli Masala Spice Mix', 'Hanging Clay Lamp',
  'Clay Diya Set (12)', 'Clay Tea Cups (set of 4)', 'Clay Planter', 'Cotton Stole', 'Cotton Tote Bag', 'Hand-woven Scarf'];
const SAMPLE_GIFT_WRAP = { 'Chilli Lane Pantry': 3000, 'Terracotta Corner': 5000, 'Handloom Nook': 4000 };

// The sizes of the 18 first sample products (filled in once, when the size column is added).
const SAMPLE_SIZES = {
  'Green Chilli Pickle': '300 g', 'Red Chilli Garlic Chutney': '200 g', 'Hot Chilli Sauce': '250 ml', 'Smoky Chilli Oil': '200 ml',
  'Chilli Masala Spice Mix': '100 g', 'Chilli Pickle Gift Box': 'Set of 3', 'Clay Water Bottle': '1 litre', 'Terracotta Cooking Pot': '2 litres',
  'Clay Tea Cups (set of 4)': 'Set of 4', 'Hanging Clay Lamp': '1 piece', 'Clay Planter': '15 cm', 'Clay Diya Set (12)': 'Set of 12',
  'Cotton Stole': '2 m', 'Handloom Bath Towel': '140 x 70 cm', 'Cotton Tote Bag': '1 bag', 'Hand-woven Scarf': '1.8 m',
  'Cotton Kitchen Towels (set of 3)': 'Set of 3', 'Woollen Shawl': '2 m',
};

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

// The home page's promo cards, added once (when there are none): each links to a real category or collection page.
const SAMPLE_PROMO_CARDS = [
  ['Pantry staples at your doorstep', 'Spices, pickles and oils from small kitchens', '/category/pantry-and-spices', 'accent'],
  ['Home and kitchen, handmade', 'Pots, mugs and planters from family potteries', '/category/home-and-kitchen', 'success'],
  ['Gifts for every occasion', 'Things makers marked as giftable', '/search?giftable=1', 'danger'],
  ['Pet care supplies at your door', 'Cool clay bowls and washable bed covers', '/category/pet-care', 'sunk'],
  ['No time to shop for the baby?', 'Baby essentials, delivered', '/category/baby-care', 'success'],
  ['Get prints and stationery delivered', 'Notebooks and cards on handmade paper', '/category/stationery-and-prints', 'accent'],
];

// The sample shops' city, dispatch days and return window (only filled in while a sample shop has no city yet).
const SAMPLE_SHOP_DETAILS = {
  'Chilli Lane Pantry': { city: 'Jaipur', dispatch_days: 2, return_days: 7 },
  'Terracotta Corner': { city: 'Khurja', dispatch_days: 3, return_days: 10 },
  'Handloom Nook': { city: 'Kannur', dispatch_days: 2, return_days: 15 },
  'Brass Bell Crafts': { city: 'Moradabad', dispatch_days: 3, return_days: 0 },
};

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
    { name: 'Green Chilli Pickle', category: 'Food and spices', price: 180, stock: 3, low: 5, description: 'Whole green chillies in mustard oil with lemon and spices. 300 g jar.' },
    { name: 'Red Chilli Garlic Chutney', category: 'Food and spices', price: 150, stock: 25, low: 5, description: 'A hot, garlicky chutney for snacks and sandwiches. 200 g jar.' },
    { name: 'Hot Chilli Sauce', category: 'Food and spices', price: 220, stock: 18, low: 5, description: 'Fiery red chilli sauce with a little vinegar. 250 ml bottle.' },
    { name: 'Smoky Chilli Oil', category: 'Food and spices', price: 260, stock: 12, low: 4, description: 'Dried red chillies and garlic in hot oil. Great on noodles. 200 ml.' },
    { name: 'Chilli Masala Spice Mix', category: 'Food and spices', price: 120, stock: 40, low: 10, description: 'Our everyday blend of red chilli, coriander and cumin. 100 g pack.' },
    { name: 'Chilli Pickle Gift Box', category: 'Gifts and crafts', price: 599, stock: 0, low: 2, description: 'Three small jars of our best pickles in a gift box.' },
  ],
  'Terracotta Corner': [
    { name: 'Clay Water Bottle', category: 'Home and kitchen', price: 450, stock: 10, low: 3, description: 'Keeps water cool the natural way. 1 litre.' },
    { name: 'Terracotta Cooking Pot', category: 'Home and kitchen', price: 650, stock: 2, low: 3, description: 'A deep clay pot for slow-cooked curries and dal. 2 litres.' },
    { name: 'Clay Tea Cups (set of 4)', category: 'Home and kitchen', price: 380, stock: 20, low: 5, description: 'Small hand-made cups for hot chai.' },
    { name: 'Hanging Clay Lamp', category: 'Gifts and crafts', price: 520, stock: 8, low: 2, description: 'A painted clay lamp with a hook for hanging.' },
    { name: 'Clay Planter', category: 'Home and kitchen', price: 300, stock: 15, low: 4, description: 'A round planter with a drainage hole. 15 cm wide.' },
    { name: 'Clay Diya Set (12)', category: 'Gifts and crafts', price: 240, stock: 30, low: 10, description: 'Twelve hand-shaped oil lamps for festivals.' },
  ],
  'Handloom Nook': [
    { name: 'Cotton Stole', category: 'Clothing', price: 550, stock: 14, low: 4, description: 'A light hand-woven cotton stole in indigo stripes.' },
    { name: 'Handloom Bath Towel', category: 'Home and kitchen', price: 420, stock: 20, low: 5, description: 'Soft, quick-drying cotton bath towel.' },
    { name: 'Cotton Tote Bag', category: 'Gifts and crafts', price: 280, stock: 25, low: 5, description: 'A strong tote bag woven from thick cotton.' },
    { name: 'Hand-woven Scarf', category: 'Clothing', price: 480, stock: 9, low: 3, description: 'A warm cotton scarf with tassels.' },
    { name: 'Cotton Kitchen Towels (set of 3)', category: 'Home and kitchen', price: 250, stock: 30, low: 6, description: 'Checked kitchen towels that soak up well.' },
    { name: 'Woollen Shawl', category: 'Clothing', price: 1200, stock: 6, low: 2, description: 'A thick woollen shawl for cold evenings.', switchedOff: true },
  ],
};


// ---------- Filling in the sample data ----------

// Tags the sample gift products and sets the sample shops' gift-wrap prices (only where not set yet).
async function tagSampleGifts() {
  for (const name of SAMPLE_GIFTS) await db.run('UPDATE products SET giftable = 1 WHERE name = ?', name);
}
async function addSampleGiftWrap() {
  for (const [shop, paise] of Object.entries(SAMPLE_GIFT_WRAP)) {
    await db.run('UPDATE sellers SET gift_wrap_price = ? WHERE shop_name = ? AND gift_wrap_price = 0', paise, shop);
  }
}
async function addSampleSizes() {
  for (const [name, size] of Object.entries(SAMPLE_SIZES)) {
    await db.run("UPDATE products SET size_label = ? WHERE name = ? AND size_label = ''", size, name);
  }
}

// Adds the extra categories that are missing. Returns the names it added.
async function addMoreCategories() {
  const added = [];
  for (const [name, rate] of MORE_CATEGORIES) {
    if (await db.get('SELECT 1 FROM categories WHERE name = ?', name)) continue;
    await db.run('INSERT INTO categories (name, commission_bps) VALUES (?, ?)', name, rate);
    added.push(name);
  }
  return added;
}

// Adds the sample products of these categories (only for sample shops that exist, and never a product twice).
async function addMoreSampleProducts(categoryNames) {
  for (const [shop, category, name, price, stock, low, size, description, giftable] of MORE_PRODUCTS) {
    if (!categoryNames.includes(category)) continue;
    const seller = await db.get('SELECT id FROM sellers WHERE shop_name = ?', shop);
    const categoryRow = await db.get('SELECT id FROM categories WHERE name = ?', category);
    if (!seller || !categoryRow || await db.get('SELECT 1 FROM products WHERE name = ? AND seller_id = ?', name, seller.id)) continue;
    await db.run(`
      INSERT INTO products (seller_id, category_id, name, description, emoji, price, stock, low_stock_level, active, deleted,
                            created_at, giftable, size_label)
      VALUES (?, ?, ?, ?, '', ?, ?, ?, 1, 0, ?, ?, ?)`,
    seller.id, categoryRow.id, name, description, rupees(price), stock, low, nowIso(), giftable, size);
  }
}

// More makers (added 2026-11-27): five women-run shops in the style the owner asked for, with our own names and words
// (no brand-name products). Each gets a seller login (TEST passwords, see DEMO_ACCOUNTS) and its products, added once.
const MAKER_SHOPS = [
  { shop_name: 'Thekua Ghar', slug: 'thekua-ghar', city: 'Aurangabad', dispatch_days: 2, return_days: 0, phone: '9000000201',
    description: 'Festive Bihari sweets and snacks, fried in pure desi ghee in a home kitchen.', shipping_fee: 4000, free_shipping_over: 59900,
    email: 'thekua@bazaarlane.test', password: 'thekua-test-2026' },
  { shop_name: 'Mithila Rang', slug: 'mithila-rang', city: 'Madhubani', dispatch_days: 4, return_days: 7, phone: '9000000202',
    description: 'Hand-painted Madhubani art on wood, paper and cloth, by women artists from Mithila.', shipping_fee: 8000, free_shipping_over: 99900,
    email: 'mithila@bazaarlane.test', password: 'mithila-test-2026' },
  { shop_name: 'Woolly Hook Studio', slug: 'woolly-hook-studio', city: 'Veraval', dispatch_days: 3, return_days: 7, phone: '9000000203',
    description: 'Crochet flowers, bags and baby wear, hooked by hand one stitch at a time.', shipping_fee: 5000, free_shipping_over: 69900,
    email: 'crochet@bazaarlane.test', password: 'crochet-test-2026' },
  { shop_name: 'Chooda Lane', slug: 'chooda-lane', city: 'Aurangabad', dispatch_days: 3, return_days: 7, phone: '9000000204',
    description: 'Bridal chooda, latkans and festive puja sets, finished by hand.', shipping_fee: 6000, free_shipping_over: 149900,
    email: 'chooda@bazaarlane.test', password: 'chooda-test-2026' },
  { shop_name: 'Bagru Block Prints', slug: 'bagru-block-prints', city: 'Jaipur', dispatch_days: 3, return_days: 10, phone: '9000000205',
    description: 'Hand-block printed mulmul sarees and dupattas in natural dyes.', shipping_fee: 0, free_shipping_over: null,
    email: 'bagru@bazaarlane.test', password: 'bagru-test-2026' },
];
// [shop, category, name, price in rupees, stock, low-stock level, size, description, giftable]
const MAKER_PRODUCTS = [
  ['Thekua Ghar', 'Snacks and sweets', 'Desi Ghee Thekua', 340, 40, 8, '500 g', 'Crisp wheat and jaggery thekua fried in pure desi ghee, the Chhath way.', 1],
  ['Thekua Ghar', 'Snacks and sweets', 'Coconut Ghee Thekua', 390, 30, 6, '500 g', 'Thekua with grated coconut and fennel, fried in desi ghee.', 1],
  ['Thekua Ghar', 'Snacks and sweets', 'Salted Nimki', 180, 40, 8, '400 g', 'Flaky diamond-cut nimki with ajwain, a tea-time favourite.', 0],
  ['Thekua Ghar', 'Snacks and sweets', 'Khaja Layered Sweet', 260, 25, 5, '400 g', 'Many-layered crisp khaja dipped in light sugar syrup.', 1],
  ['Thekua Ghar', 'Pantry and spices', 'Roasted Sattu Flour', 160, 50, 10, '1 kg', 'Stone-ground roasted gram flour for sattu drinks and litti.', 0],
  ['Thekua Ghar', 'Snacks and sweets', 'Sesame Tilkut', 280, 30, 6, '500 g', 'Pounded sesame and jaggery tilkut, made in winter batches.', 1],
  ['Mithila Rang', 'Home decor', 'Madhubani Fish Coaster Set', 799, 15, 3, 'Set of 6 with stand', 'Six wooden coasters hand-painted with Madhubani fish, in a matching stand.', 1],
  ['Mithila Rang', 'Home decor', 'Madhubani Desk Organiser Tray', 1690, 6, 2, 'Tray and 3 holders', 'A painted wooden tray with pen and card holders for a desk.', 1],
  ['Mithila Rang', 'Stationery and prints', 'Madhubani Peacock Painting', 1450, 8, 2, 'A3 on handmade paper', 'An original peacock painting in natural colours on handmade paper.', 1],
  ['Mithila Rang', 'Stationery and prints', 'Madhubani Greeting Cards', 260, 30, 6, 'Set of 6', 'Hand-painted folded cards with envelopes.', 1],
  ['Woolly Hook Studio', 'Gifts and crafts', 'Crochet Rose Bouquet', 340, 20, 4, '5 roses', 'Five crochet roses with leaves that never wilt.', 1],
  ['Woolly Hook Studio', 'Bags and accessories', 'Crochet Rose Potli Bag', 689, 12, 3, '1 bag', 'A small drawstring potli bag with a crochet rose on the front.', 1],
  ['Woolly Hook Studio', 'Bags and accessories', 'Crochet Rose Handbag with Pearl Handle', 890, 8, 2, '1 bag', 'A structured crochet bag covered in 3D roses, with a pearl handle.', 1],
  ['Woolly Hook Studio', 'Baby care', 'Crochet Baby Booties and Cap', 290, 15, 3, '0 to 6 months', 'Soft cotton booties and a matching cap.', 1],
  ['Woolly Hook Studio', 'Jewellery', 'Crochet Flower Earrings', 190, 25, 5, '1 pair', 'Light crochet flower drops on hypoallergenic hooks.', 1],
  ['Woolly Hook Studio', 'Gifts and crafts', 'Crochet Daisy Keychain', 190, 30, 6, '1 piece', 'A cheerful crochet daisy on a steel key ring.', 1],
  ['Woolly Hook Studio', 'Home decor', 'Crochet Table Mat', 289, 20, 4, '30 cm round', 'A round crochet mat for a puja table or a side table.', 0],
  ['Chooda Lane', 'Jewellery', 'Maroon Velvet Bridal Chooda', 2539, 10, 2, 'Size 2.4 and 2.6', 'Maroon velvet chooda with stone work and golden hanging latkans.', 1],
  ['Chooda Lane', 'Jewellery', 'Emerald and Maroon Chooda Set with Latkans', 5939, 5, 1, 'Size 2.4 and 2.6', 'A full bridal chooda set in emerald and maroon with jhumki latkans.', 1],
  ['Chooda Lane', 'Festive and puja', 'Karwa Chauth Thali Set', 2939, 8, 2, 'Thali with 7 pieces', 'A decorated thali with karwa, diya, sieve and small bowls.', 1],
  ['Bagru Block Prints', 'Clothing', 'Red Hand-block Mulmul Saree', 1539, 10, 2, '5.5 m with blouse piece', 'A soft cotton mulmul saree hand-block printed in Bagru in red and black.', 1],
  ['Bagru Block Prints', 'Clothing', 'Indigo Bagru Print Saree', 1239, 10, 2, '5.5 m with blouse piece', 'A mulmul cotton saree in indigo with hand-block prints in natural dyes.', 1],
  ['Bagru Block Prints', 'Clothing', 'Block-printed Cotton Dupatta', 590, 20, 4, '2.25 m', 'A light cotton dupatta with a small Bagru motif all over.', 1],
];
async function addMakerShops() {
  const { hashPassword } = require('./auth');
  for (const shop of MAKER_SHOPS) {
    let seller = await db.get('SELECT id FROM sellers WHERE slug = ?', shop.slug);
    if (!seller) {
      const id = (await db.run(`
        INSERT INTO sellers (shop_name, slug, description, phone, status, shipping_fee, free_shipping_over, created_at, approved_at,
                             city, dispatch_days, return_days)
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?)`,
      shop.shop_name, shop.slug, shop.description, shop.phone, shop.shipping_fee, shop.free_shipping_over, nowIso(), nowIso(),
      shop.city, shop.dispatch_days, shop.return_days)).lastInsertRowid;
      seller = { id };
      if (!(await db.get('SELECT 1 FROM users WHERE email = ?', shop.email))) {
        await db.run("INSERT INTO users (email, password_hash, role, seller_id, created_at) VALUES (?, ?, 'seller', ?, ?)",
          shop.email, hashPassword(shop.password), id, nowIso());
      }
    }
    for (const [shopName, category, name, price, stock, low, size, description, giftable] of MAKER_PRODUCTS) {
      if (shopName !== shop.shop_name) continue;
      const categoryRow = await db.get('SELECT id FROM categories WHERE name = ?', category);
      if (!categoryRow || await db.get('SELECT 1 FROM products WHERE name = ? AND seller_id = ?', name, seller.id)) continue;
      await db.run(`
        INSERT INTO products (seller_id, category_id, name, description, emoji, price, stock, low_stock_level, active, deleted,
                              created_at, giftable, size_label)
        VALUES (?, ?, ?, ?, '', ?, ?, ?, 1, 0, ?, ?, ?)`,
      seller.id, categoryRow.id, name, description, rupees(price), stock, low, nowIso(), giftable, size);
    }
  }
}

// The promo cards, added once (when there are none).
async function addSamplePromoCards() {
  if ((await db.get('SELECT COUNT(*) AS n FROM promo_cards')).n > 0) return;
  let position = 0;
  for (const [title, line, link, tone] of SAMPLE_PROMO_CARDS) {
    position += 1;
    await db.run('INSERT INTO promo_cards (position, title, line, link, tone, enabled) VALUES (?, ?, ?, ?, ?, 1)', position, title, line, link, tone);
  }
}

// The seasons, added once when missing: Christmas, 1 to 26 December (until 23:59) of this year.
async function addDefaultSeasons() {
  const year = new Date().getFullYear();
  await db.run("INSERT OR IGNORE INTO seasons (key, name, starts_at, ends_at, enabled) VALUES ('christmas', 'Christmas', ?, ?, 1)",
    `${year}-12-01 00:00`, `${year}-12-26 23:59`);
}

// Settings the app needs. Added only when missing, so a change the admin makes is never overwritten.
async function addDefaultSettings() {
  const defaults = [['default_commission_bps', '1000'], ['cod_enabled', '1'], ['early_bird_slots', '0'], ['early_bird_bps', '500'], ['early_bird_days', '90']];
  for (const [key, value] of defaults) await db.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', key, value);
}

// The sample shops' city, dispatch days and return window (only while a sample shop has no city yet).
async function addSampleShopDetails() {
  for (const [shopName, details] of Object.entries(SAMPLE_SHOP_DETAILS)) {
    await db.run("UPDATE sellers SET city = ?, dispatch_days = ?, return_days = ? WHERE shop_name = ? AND city = ''",
      details.city, details.dispatch_days, details.return_days, shopName);
  }
}

// ---------- Photos (kept in the database) ----------

// Saves a photo's bytes under a name. Never overwrites (the name is new and random).
async function savePhotoBytes(name, type, bytes) {
  await db.run('INSERT INTO photos (name, type, bytes, created_at) VALUES (?, ?, ?, ?)', name, type, bytes, nowIso());
}
// A saved photo ({ type, bytes }), or undefined.
async function loadPhoto(name) {
  return db.get('SELECT type, bytes FROM photos WHERE name = ?', name);
}
// Deletes a saved photo (only names this app made itself).
async function deletePhoto(name) {
  if (name && /^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) await db.run('DELETE FROM photos WHERE name = ?', name);
}

// The sample photos (free Unsplash photos, see CREDITS.md) live in the sample-photos folder, named after what they
// show: category-<name>.jpg, promo-<title>.jpg, product-<name>.jpg. A category, promo card or product that has NO photo
// yet and has a matching file gets a copy of it under a new random name. A photo someone uploaded is never replaced.
const SAMPLE_PHOTOS_DIR = path.join(__dirname, 'sample-photos');
const photoSlug = (text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
async function addSamplePhotos() {
  if (!fs.existsSync(SAMPLE_PHOTOS_DIR)) return;
  const files = new Set(fs.readdirSync(SAMPLE_PHOTOS_DIR));
  const targets = [['category', 'categories', 'name'], ['promo', 'promo_cards', 'title'], ['product', 'products', 'name']];
  for (const [kind, table, nameColumn] of targets) {
    const rows = await db.all(`SELECT id, ${nameColumn} AS name FROM ${table} WHERE photo IS NULL OR photo = ''`);
    for (const row of rows) {
      const file = `${kind}-${photoSlug(row.name)}.jpg`;
      if (!files.has(file)) continue;
      const newName = crypto.randomBytes(16).toString('hex') + '.jpg';
      await savePhotoBytes(newName, 'image/jpeg', fs.readFileSync(path.join(SAMPLE_PHOTOS_DIR, file)));
      await db.run(`UPDATE ${table} SET photo = ? WHERE id = ?`, newName, row.id);
    }
  }
}

// Fills the database with the sample data, but only when it has no users yet (a brand-new database).
// Returns true when it added the data.
async function fillSampleDataIfEmpty() {
  if ((await db.get('SELECT COUNT(*) AS n FROM users')).n > 0) return false;
  const { hashPassword } = require('./auth'); // loaded here, not at the top, because auth.js also loads db.js
  await db.tx(async () => {
    const categoryIds = await addSampleCategories();
    const shopIds = await addSampleShops();
    await addDemoLogins(shopIds, hashPassword);
    await addSampleProducts(shopIds, categoryIds);
  });
  await addSampleShopDetails();
  await tagSampleGifts();
  await addSampleGiftWrap();
  await addSampleSizes();
  await addMoreSampleProducts(MORE_CATEGORIES.map(([name]) => name));
  await db.run("UPDATE sellers SET approved_at = created_at WHERE approved_at IS NULL AND status = 'active'");
  await addSamplePhotos();
  return true;
}

// Adds the 4 categories. Returns { 'Food and spices': id, ... }.
async function addSampleCategories() {
  const ids = {};
  for (const category of SAMPLE_CATEGORIES) {
    await db.run('INSERT OR IGNORE INTO categories (name, commission_bps) VALUES (?, ?)', category.name, category.commission_bps);
    ids[category.name] = (await db.get('SELECT id FROM categories WHERE name = ?', category.name)).id;
  }
  return ids;
}

// Adds the 4 shops. Returns { 'Chilli Lane Pantry': id, ... }.
async function addSampleShops() {
  const ids = {};
  for (const shop of SAMPLE_SHOPS) {
    ids[shop.shop_name] = (await db.run(`
      INSERT INTO sellers (shop_name, slug, description, phone, status, commission_bps, shipping_fee, free_shipping_over, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    shop.shop_name, shop.slug, shop.description, shop.phone, shop.status, shop.commission_bps, shop.shipping_fee,
    shop.free_shipping_over, nowIso())).lastInsertRowid;
  }
  return ids;
}

// Adds the admin and one login per sample shop. Only the password hash is saved, never the password.
async function addDemoLogins(shopIds, hashPassword) {
  for (const account of DEMO_ACCOUNTS) {
    if (account.role === 'admin' && account.password.length < ADMIN_PASSWORD_MIN) {
      throw new Error(`An admin password must be at least ${ADMIN_PASSWORD_MIN} characters.`);
    }
    const sellerId = account.shop ? shopIds[account.shop] : null;
    await db.run('INSERT INTO users (email, password_hash, role, seller_id, created_at) VALUES (?, ?, ?, ?, ?)',
      account.email, hashPassword(account.password), account.role, sellerId, nowIso());
  }
}

// Adds the 18 sample products.
async function addSampleProducts(shopIds, categoryIds) {
  for (const [shopName, products] of Object.entries(SAMPLE_PRODUCTS)) {
    for (const p of products) {
      await db.run(`
        INSERT INTO products (seller_id, category_id, name, description, emoji, price, stock, low_stock_level, active, deleted, created_at)
        VALUES (?, ?, ?, ?, '', ?, ?, ?, ?, 0, ?)`,
      shopIds[shopName], categoryIds[p.category], p.name, p.description, rupees(p.price), p.stock, p.low, p.switchedOff ? 0 : 1, nowIso());
    }
  }
}

// ---------- Getting the database ready ----------

// Starts (on a laptop) and sets up the database once: tables, settings, seasons, sample data and photos.
// Every entry point (server.js, the Netlify function, the tests) waits for this before answering anything.
// Returns true when the sample data was added just now (a brand-new database).
let readyPromise = null;
function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      if (IS_LOCAL) await startLocalPostgres();
      // One set-up at a time, even when several live functions start together.
      return db.tx(async () => {
        await db.lock('bazaar-setup');
        await createTables();
        await addDefaultSettings();
        await addDefaultSeasons();
        await addMoreSampleProducts(await addMoreCategories());
        await addSamplePromoCards();
        await addSampleShopDetails();
        const isNew = await fillSampleDataIfEmpty();
        await addMakerShops();
        await addSamplePhotos();
        return isNew;
      });
    })();
    readyPromise.catch(() => { readyPromise = null; }); // a failed start can be tried again
  }
  return readyPromise;
}

// The web address of a photo, or null when it has none (the page then shows the kit's placeholder art).
function photoUrl(photo) {
  return photo ? '/uploads/' + photo : null;
}

module.exports = {
  SCHEMA_SQL, ADDED_COLUMNS, ADMIN_PASSWORD_MIN, db, ready, close, nowIso, searchForm, fillSampleDataIfEmpty, DEMO_ACCOUNTS, DB_LABEL, IS_LOCAL,
  photoUrl, savePhotoBytes, loadPhoto, deletePhoto,
};
