// routes/storefront.js - what customers see: the open shops, the categories, search with filters, a shop's page and a
// product's page, each page with its own title and description written in by the server (pages.js).
// Customers only ever see products that are on sale, not deleted, not hidden by the admin, and from an open (active) shop.
const express = require('express');
const { db, photoUrl, nowIso } = require('../db');
const auth = require('../auth');
const { sendPage, slugify, pageTitle, MARKETPLACE_NAME } = require('../pages');
const { formatMoney } = require('../money');

const router = express.Router();
const { HttpError } = auth;
const MOST_RESULTS = 100;   // search and category lists show at most this many products
const FEW_LEFT = 5;         // "Only 3 left" shows at this stock or below (it is true: it is the real stock)
const SORTS = ['newest', 'price_asc', 'price_desc', 'top_rated', 'name'];

// "A customer may see this product." A product with 0 stock still shows on its shop and its own page, marked Sold out,
// but never in search or category lists, because it cannot be bought.
const CUSTOMER_CAN_SEE = `products.active = 1 AND products.deleted = 0 AND products.hidden = 0 AND sellers.status = 'active'`;

// A product's rating: the average and the count of its VISIBLE reviews (hidden reviews count for nothing).
const RATING_FIELDS = `
  (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE reviews.product_id = products.id AND reviews.hidden = 0) AS rating,
  (SELECT COUNT(*) FROM reviews WHERE reviews.product_id = products.id AND reviews.hidden = 0) AS review_count`;

// The product fields customers get: no stock numbers (only "few_left" when it is 5 or fewer), no seller email or
// phone, nothing about hiding.
const CUSTOMER_FIELDS = `
  products.id, products.name, products.description, products.photo, products.price, products.created_at,
  products.stock = 0 AS sold_out, CASE WHEN products.stock BETWEEN 1 AND ${FEW_LEFT} THEN products.stock END AS few_left,
  products.category_id, categories.name AS category_name,
  sellers.shop_name, sellers.slug AS shop_slug, sellers.city, ${RATING_FIELDS}`;

const FROM_PRODUCTS = `
  FROM products
  JOIN sellers ON sellers.id = products.seller_id
  JOIN categories ON categories.id = products.category_id`;

// The marketplace name for every page header. Set MARKETPLACE_NAME to rename it.
router.get('/api/info', (req, res) => {
  res.json({ name: MARKETPLACE_NAME });
});

// Home page and filters: only shops that are open (active), with their city and rating.
router.get('/api/shops', (req, res) => {
  const shops = db.prepare(`
    SELECT shop_name, slug, description, city, shipping_fee, free_shipping_over, dispatch_days, return_days,
      (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE reviews.seller_id = sellers.id AND reviews.hidden = 0) AS rating,
      (SELECT COUNT(*) FROM reviews WHERE reviews.seller_id = sellers.id AND reviews.hidden = 0) AS review_count
    FROM sellers
    WHERE status = 'active'
    ORDER BY shop_name COLLATE NOCASE`).all();
  res.json({ shops });
});

// Every category, with its clean address and how many of its products can be bought right now,
// and one product photo for the home page's category panels.
router.get('/api/categories', (req, res) => {
  const categories = db.prepare(`
    SELECT categories.id, categories.name,
      (SELECT COUNT(*) FROM products JOIN sellers ON sellers.id = products.seller_id
       WHERE products.category_id = categories.id AND products.stock > 0 AND ${CUSTOMER_CAN_SEE}) AS product_count,
      (SELECT products.id FROM products JOIN sellers ON sellers.id = products.seller_id
       WHERE products.category_id = categories.id AND products.stock > 0 AND ${CUSTOMER_CAN_SEE}
       ORDER BY products.photo IS NULL, products.created_at DESC LIMIT 1) AS cover_product_id
    FROM categories
    ORDER BY categories.name COLLATE NOCASE`).all();
  const coverPhoto = db.prepare('SELECT photo FROM products WHERE id = ?');
  res.json({
    categories: categories.map((category) => ({
      ...category,
      slug: slugify(category.name),
      cover_photo_url: category.cover_product_id ? photoUrl(coverPhoto.get(category.cover_product_id).photo) : null,
    })),
  });
});

// Search and category lists: only products that can be bought right now (in stock, on sale, from an open shop).
// Filters (all optional, all kept in the page address): search, category (id or slug), price_min and price_max (rupees),
// shop (its slug), city, rating (at least this many stars), sort (newest, price_asc, price_desc, top_rated, name),
// limit (1 to 100). At most 100 products; "more" says if there were more.
router.get('/api/products', (req, res) => {
  const filters = readFilters(req.query);
  const where = [`${CUSTOMER_CAN_SEE}`, 'products.stock > 0', "search_text(products.name) LIKE ? ESCAPE '\\'"];
  const values = [auth.likePattern(filters.search)];
  if (filters.category) { where.push('products.category_id = ?'); values.push(filters.category.id); }
  if (filters.priceMin !== null) { where.push('products.price >= ?'); values.push(filters.priceMin); }
  if (filters.priceMax !== null) { where.push('products.price <= ?'); values.push(filters.priceMax); }
  if (filters.shop) { where.push('sellers.slug = ?'); values.push(filters.shop); }
  if (filters.city) { where.push('search_text(sellers.city) = ?'); values.push(filters.city.toLowerCase()); }
  const order = {
    newest: 'products.created_at DESC, products.id DESC',
    price_asc: 'products.price ASC, products.name COLLATE NOCASE',
    price_desc: 'products.price DESC, products.name COLLATE NOCASE',
    top_rated: 'rating IS NULL, rating DESC, review_count DESC, products.name COLLATE NOCASE',
    name: 'products.name COLLATE NOCASE',
  }[filters.sort];
  if (filters.rating) {
    where.push('(SELECT AVG(rating) FROM reviews WHERE reviews.product_id = products.id AND reviews.hidden = 0) >= ?');
    values.push(filters.rating);
  }
  const sql = `SELECT ${CUSTOMER_FIELDS} ${FROM_PRODUCTS} WHERE ${where.join(' AND ')}`;
  const rows = db.prepare(`${sql} ORDER BY ${order} LIMIT ?`).all(...values, filters.limit + 1);
  res.json({
    search: filters.search,
    category: filters.category,
    filters: { ...filters, category: filters.category ? filters.category.id : null },
    products: rows.slice(0, filters.limit).map(customerProduct),
    more: rows.length > filters.limit,
  });
});

// One product, for its page: the shop's city, shipping, dispatch days and returns, the stock in words, a delivery
// estimate, its newest visible reviews, "More from this shop" and "Similar products". "Not available" when it is
// switched off, deleted, hidden, or its shop is not open. A customer opening it adds 1 view (logged-in staff do not).
router.get('/api/products/:id', (req, res) => {
  const row = findVisibleProduct(req.params.id);
  if (!row) throw new HttpError(404, 'This product is not available.');
  if (!req.user) countView(row.id);
  const shop = db.prepare(`
    SELECT id, shop_name, slug, city, shipping_fee, free_shipping_over, dispatch_days, return_days,
      (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE reviews.seller_id = sellers.id AND reviews.hidden = 0) AS rating,
      (SELECT COUNT(*) FROM reviews WHERE reviews.seller_id = sellers.id AND reviews.hidden = 0) AS review_count
    FROM sellers WHERE slug = ?`).get(row.shop_slug);
  const product = customerProduct(row);
  const { id: shopId, ...shopForCustomers } = shop;
  res.json({
    product,
    shop: shopForCustomers,
    delivery: { from_days: shop.dispatch_days + 2, to_days: shop.dispatch_days + 5 },
    reviews: visibleReviews(row.id),
    more_from_shop: relatedProducts('products.seller_id = ?', shopId, row.id),
    similar: relatedProducts('products.category_id = ? AND products.seller_id <> ' + Number(shopId), row.category_id, row.id),
  });
});

// A shop's storefront: its name, city, description, shipping, dispatch days, returns and rating, and the products
// customers may see (sold out ones last). A pending, rejected or suspended shop, or an address that does not exist,
// gets "This shop is not available."
router.get('/api/store/:slug', (req, res) => {
  const shop = findOpenShop(req.params.slug);
  if (!shop) throw new HttpError(404, 'This shop is not available.');
  const products = db.prepare(`
    SELECT ${CUSTOMER_FIELDS} ${FROM_PRODUCTS}
    WHERE products.seller_id = ? AND ${CUSTOMER_CAN_SEE}
    ORDER BY products.stock = 0, products.name COLLATE NOCASE`).all(shop.id).map(customerProduct);
  const { id, ...shopForCustomers } = shop;
  res.json({ shop: shopForCustomers, products });
});

// ---------- The customer pages, each with its own title and description ----------

// The home page.
router.get(['/', '/index.html'], (req, res) => {
  sendPage(res, 'index.html', {
    title: `${MARKETPLACE_NAME}: hand-made goods from independent shops`,
    description: 'Pickles, clay pots, hand-woven cloth and gifts from small independent shops across India. One bag, many shops, one payment.',
  });
});

// Search results: /search?search=pickle (with any filters).
router.get('/search', (req, res) => {
  const search = auth.cleanSearch(req.query.search);
  sendPage(res, 'search.html', {
    title: pageTitle(search ? `Search: ${search}` : 'Search all products'),
    description: search ? `Products matching "${search}" from independent shops.` : 'Search every product from every open shop.',
  });
});

// A shop's storefront page: /store/<slug>.
router.get('/store/:slug', (req, res) => {
  const shop = findOpenShop(req.params.slug);
  if (!shop) {
    return sendPage(res, 'store.html', { status: 404, title: pageTitle('Shop not available'), description: 'This shop is not available.' });
  }
  sendPage(res, 'store.html', {
    title: pageTitle(shop.city ? `${shop.shop_name} · ${shop.city}` : shop.shop_name),
    description: shop.description || `${shop.shop_name} on ${MARKETPLACE_NAME}.`,
  });
});

// A category's page: /category/<slug>. An old /category/<id> address moves to the clean one.
router.get('/category/:slug', (req, res) => {
  const category = findCategory(req.params.slug);
  if (!category) {
    return sendPage(res, 'category.html', { status: 404, title: pageTitle('Category not found'), description: 'This category does not exist.' });
  }
  const slug = slugify(category.name);
  if (req.params.slug !== slug) return res.redirect(301, '/category/' + slug + queryPart(req));
  sendPage(res, 'category.html', {
    title: pageTitle(category.name),
    description: `${category.name} from independent shops on ${MARKETPLACE_NAME}.`,
  });
});

// A product's page: /product/<id>-<slug>. An old /product/<id> address (or a wrong slug) moves to the clean one.
router.get('/product/:idAndSlug', (req, res) => {
  const idText = String(req.params.idAndSlug).split('-')[0];
  const row = findVisibleProduct(idText);
  if (!row) {
    return sendPage(res, 'product.html', { status: 404, title: pageTitle('Product not available'), description: 'This product is not available.' });
  }
  const address = productAddress(row);
  if ('/product/' + req.params.idAndSlug !== address) return res.redirect(301, address);
  sendPage(res, 'product.html', {
    title: pageTitle(`${row.name} by ${row.shop_name}`),
    description: `${formatMoney(row.price)}. ${row.description}`,
  });
});

// "Sell with us": why sell here, the 3 steps, the commission and the early-bird offer.
router.get('/sell', (req, res) => {
  sendPage(res, 'sell.html', {
    title: pageTitle('Sell with us'),
    description: `Open your own shop on ${MARKETPLACE_NAME}: sign up, get approved, add your products. We only earn when you sell.`,
  });
});

// ---------- Helpers ----------

// The filters from the page address. Bad values are refused with a plain message.
function readFilters(query) {
  const text = (value) => (typeof value === 'string' ? value.trim() : '');
  const rupeesFilter = (value, label) => {
    if (!text(value)) return null;
    if (!/^\d{1,7}$/.test(text(value))) throw new HttpError(400, `${label} must be a whole number of rupees, like 500.`);
    return Number(text(value)) * 100;
  };
  const sort = SORTS.includes(text(query.sort)) ? text(query.sort) : 'name';
  const rating = text(query.rating) ? Number(text(query.rating)) : null;
  if (rating !== null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
    throw new HttpError(400, 'Rating must be 1 to 5 stars.');
  }
  const limitText = text(query.limit);
  const limit = /^\d{1,3}$/.test(limitText) ? Math.min(Math.max(Number(limitText), 1), MOST_RESULTS) : MOST_RESULTS;
  return {
    search: auth.cleanSearch(query.search),
    category: readCategoryFilter(query.category),
    priceMin: rupeesFilter(query.price_min, 'Price from'),
    priceMax: rupeesFilter(query.price_max, 'Price to'),
    shop: text(query.shop).slice(0, 60) || null,
    city: auth.cleanSearch(query.city) || null,
    rating,
    sort,
    limit,
  };
}

// The ?category= filter: empty means every category; anything else must be a real category, by id or slug (404 if not).
function readCategoryFilter(value) {
  if (value === undefined || value === '') return null;
  const category = findCategory(typeof value === 'string' ? value : '');
  if (!category) throw new HttpError(404, 'That category does not exist.');
  return { id: category.id, name: category.name, slug: slugify(category.name) };
}

// A category by its id ("2") or its slug ("home-and-kitchen"), or undefined.
function findCategory(idOrSlug) {
  const all = db.prepare('SELECT id, name FROM categories').all();
  const id = auth.readId(idOrSlug);
  return all.find((category) => (id ? category.id === id : slugify(category.name) === idOrSlug));
}

// An open shop by its slug, or undefined.
function findOpenShop(slug) {
  return db.prepare(`
    SELECT id, shop_name, slug, description, city, shipping_fee, free_shipping_over, dispatch_days, return_days,
      (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE reviews.seller_id = sellers.id AND reviews.hidden = 0) AS rating,
      (SELECT COUNT(*) FROM reviews WHERE reviews.seller_id = sellers.id AND reviews.hidden = 0) AS review_count
    FROM sellers WHERE slug = ? AND status = 'active'`).get(String(slug));
}

// A product customers may see (sold out ones too), by the id in the address, or undefined.
function findVisibleProduct(idText) {
  const id = auth.readId(idText);
  return id ? db.prepare(`SELECT ${CUSTOMER_FIELDS} ${FROM_PRODUCTS} WHERE products.id = ? AND ${CUSTOMER_CAN_SEE}`).get(id) : undefined;
}

// Up to 4 other products that can be bought, matching the condition (same shop, or same category from other shops).
function relatedProducts(condition, value, notThisId) {
  return db.prepare(`
    SELECT ${CUSTOMER_FIELDS} ${FROM_PRODUCTS}
    WHERE ${condition} AND products.id <> ? AND products.stock > 0 AND ${CUSTOMER_CAN_SEE}
    ORDER BY products.created_at DESC LIMIT 4`).all(value, notThisId).map(customerProduct);
}

// The newest 20 visible reviews of a product: the first name only, "Verified buyer", the stars, the text, any reply.
function visibleReviews(productId) {
  return db.prepare(`
    SELECT reviews.id, reviews.rating, reviews.text, reviews.seller_reply, reviews.created_at, customer_orders.customer_name
    FROM reviews
    JOIN order_items ON order_items.id = reviews.order_item_id
    JOIN seller_orders ON seller_orders.id = order_items.seller_order_id
    JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE reviews.product_id = ? AND reviews.hidden = 0
    ORDER BY reviews.created_at DESC LIMIT 20`).all(productId)
    .map(({ customer_name, ...review }) => ({ ...review, first_name: customer_name.split(' ')[0], verified: true }));
}

// A customer opened a product page: one more view for today.
function countView(productId) {
  db.prepare(`
    INSERT INTO product_views (product_id, day, count) VALUES (?, ?, 1)
    ON CONFLICT (product_id, day) DO UPDATE SET count = count + 1`).run(productId, nowIso().slice(0, 10));
}

// /product/12-green-chilli-pickle
function productAddress(product) {
  return `/product/${product.id}-${slugify(product.name)}`;
}

// The "?..." part of the address, kept when a page moves to its clean address.
function queryPart(req) {
  const index = req.originalUrl.indexOf('?');
  return index === -1 ? '' : req.originalUrl.slice(index);
}

// What customers get for one product: sold_out as true or false, the photo's web address, its clean address and the
// stock in words ("In stock", "Only 3 left", "Sold out").
function customerProduct(row) {
  const { photo, ...product } = row;
  const soldOut = row.sold_out === 1;
  return {
    ...product,
    sold_out: soldOut,
    photo_url: photoUrl(photo),
    url: productAddress(row),
    stock_words: soldOut ? 'Sold out' : row.few_left ? `Only ${row.few_left} left` : 'In stock',
  };
}

module.exports = router;
module.exports.productAddress = productAddress;
