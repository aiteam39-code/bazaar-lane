// routes/products.js - products and stock.
// Seller: only their OWN products (add, edit, + and - stock, switch off and on, delete). Anything else gets 403.
// Admin: every product, with a search, and Hide / Unhide for products that break the rules. The admin cannot change prices.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { db, nowIso, UPLOADS_DIR, photoUrl } = require('../db');
const auth = require('../auth');
const { paiseFromRupeesText } = require('../money');

const router = express.Router();
const { HttpError } = auth;

const MAX_PRICE = 1000000 * 100; // Rs 10,00,000 in paise
const MAX_STOCK = 1000000;       // the most one product can have in stock
const MAX_STOCK_CHANGE = 100000; // the most one + or - can add or take away
const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // a product photo is at most 2 MB

// The product fields the seller and the admin see.
const PRODUCT_FIELDS = `
  products.id, products.seller_id, products.name, products.description, products.photo, products.price, products.giftable,
  products.stock, products.low_stock_level, products.active, products.hidden, products.hidden_reason,
  products.category_id, categories.name AS category_name`;

// ---------- Seller: their own products ----------

// The seller's own products (deleted ones are left out), the categories for the form, and how many are LOW.
// A suspended shop can still look at its products, but cannot change them.
router.get('/api/seller/products', auth.requireSeller('active', 'suspended'), (req, res) => {
  const products = db.prepare(`
    SELECT ${PRODUCT_FIELDS}
    FROM products JOIN categories ON categories.id = products.category_id
    WHERE products.seller_id = ? AND products.deleted = 0
    ORDER BY products.name COLLATE NOCASE`).all(req.shop.id).map(withLowFlag);
  res.json({
    shop: { shop_name: req.shop.shop_name, slug: req.shop.slug, status: req.shop.status, status_reason: req.shop.status_reason },
    categories: allCategories(),
    products,
    low_count: products.filter((product) => product.low).length,
  });
});

// Add a product. It starts on sale. The price is typed in rupees and saved as paise.
router.post('/api/seller/products', auth.requireSeller('active'), (req, res) => {
  const body = req.body || {};
  const form = readProductForm(body);
  const stock = auth.readWholeNumber(body.stock, 'Stock', 0, MAX_STOCK);
  const result = db.prepare(`
    INSERT INTO products (seller_id, category_id, name, description, price, giftable, stock, low_stock_level, active, deleted, hidden, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?)`)
    .run(req.shop.id, form.categoryId, form.name, form.description, form.price, form.giftable, stock, form.lowStockLevel, nowIso());
  res.status(201).json({ ok: true, id: result.lastInsertRowid, message: `${form.name} was added.` });
});

// Edit a product: name, category, price, description and low-stock level. Stock only changes with + and -.
router.put('/api/seller/products/:id', auth.requireSeller('active'), (req, res) => {
  const product = findOwnProduct(req, req.params.id);
  const form = readProductForm(req.body || {});
  db.prepare(`
    UPDATE products SET name = ?, category_id = ?, price = ?, description = ?, giftable = ?, low_stock_level = ?
    WHERE id = ? AND seller_id = ?`)
    .run(form.name, form.categoryId, form.price, form.description, form.giftable, form.lowStockLevel, product.id, req.shop.id);
  res.json({ ok: true, message: `${form.name} was saved.` });
});

// Stock +: adds the amount (1 to 100,000). The stock can be at most 1,000,000.
router.post('/api/seller/products/:id/stock/add', auth.requireSeller('active'), (req, res) => {
  const product = findOwnProduct(req, req.params.id);
  const amount = auth.readWholeNumber((req.body || {}).amount, 'Amount', 1, MAX_STOCK_CHANGE);
  const row = db.prepare(`
    UPDATE products SET stock = stock + ?
    WHERE id = ? AND seller_id = ? AND stock + ? <= ?
    RETURNING stock`).get(amount, product.id, req.shop.id, amount, MAX_STOCK);
  if (!row) throw new HttpError(400, `Stock cannot be more than ${MAX_STOCK}.`);
  res.json({ ok: true, stock: row.stock, message: `Added ${amount}. ${product.name} now has ${row.stock} in stock.` });
});

// Stock -: takes the amount away. Refused if that would go below 0. The database update checks it too (stock >= amount),
// so two clicks at the same moment can never take the stock below 0.
router.post('/api/seller/products/:id/stock/remove', auth.requireSeller('active'), (req, res) => {
  const product = findOwnProduct(req, req.params.id);
  const amount = auth.readWholeNumber((req.body || {}).amount, 'Amount', 1, MAX_STOCK_CHANGE);
  const row = db.prepare(`
    UPDATE products SET stock = stock - ?
    WHERE id = ? AND seller_id = ? AND stock >= ?
    RETURNING stock`).get(amount, product.id, req.shop.id, amount);
  if (!row) {
    const { stock } = db.prepare('SELECT stock FROM products WHERE id = ?').get(product.id);
    throw new HttpError(400, `Only ${stock} of ${product.name} in stock, so you cannot take away ${amount}.`);
  }
  res.json({ ok: true, stock: row.stock, message: `Took away ${amount}. ${product.name} now has ${row.stock} in stock.` });
});

// Switch off: customers stop seeing the product. It stays in the seller's list.
router.post('/api/seller/products/:id/switch-off', auth.requireSeller('active'), (req, res) => {
  const product = findOwnProduct(req, req.params.id);
  db.prepare('UPDATE products SET active = 0 WHERE id = ? AND seller_id = ?').run(product.id, req.shop.id);
  res.json({ ok: true, message: `${product.name} is switched off. Customers cannot see it.` });
});

// Switch on again. Not allowed while the admin has hidden the product.
router.post('/api/seller/products/:id/switch-on', auth.requireSeller('active'), (req, res) => {
  const product = findOwnProduct(req, req.params.id);
  const result = db.prepare('UPDATE products SET active = 1 WHERE id = ? AND seller_id = ? AND hidden = 0')
    .run(product.id, req.shop.id);
  if (result.changes !== 1) {
    throw new HttpError(403, `The admin has hidden ${product.name}, so you cannot switch it on. Reason: ${product.hidden_reason || 'not given'}`);
  }
  res.json({ ok: true, message: `${product.name} is on sale again.` });
});

// Upload a product photo: the file itself is the request body (JPEG, PNG or WebP, at most 2 MB).
// The server checks the type by the file's first bytes, never by its name or the type the browser says,
// and saves it in the uploads folder under a new random name. A new photo replaces the old one.
router.post('/api/seller/products/:id/photo', auth.requireSeller('active'),
  express.raw({ type: () => true, limit: MAX_PHOTO_BYTES }), (req, res) => {
    const product = findOwnProduct(req, req.params.id);
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (bytes.length === 0) throw new HttpError(400, 'Please choose a photo to upload.');
    const extension = photoExtension(bytes);
    if (!extension) throw new HttpError(400, 'The photo must be a JPEG, PNG or WebP picture.');
    const fileName = crypto.randomBytes(16).toString('hex') + extension;
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, fileName), bytes, { flag: 'wx' }); // wx: never overwrites a file
    db.prepare('UPDATE products SET photo = ? WHERE id = ? AND seller_id = ?').run(fileName, product.id, req.shop.id);
    removeOldPhoto(product.photo);
    res.json({ ok: true, photo_url: photoUrl(fileName), message: `The photo of ${product.name} was saved.` });
  });

// Delete: the product disappears for good, but it is never erased, so old orders keep its name.
router.delete('/api/seller/products/:id', auth.requireSeller('active'), (req, res) => {
  const product = findOwnProduct(req, req.params.id);
  db.prepare('UPDATE products SET deleted = 1 WHERE id = ? AND seller_id = ?').run(product.id, req.shop.id);
  res.json({ ok: true, message: `${product.name} was deleted.` });
});

// ---------- Admin: every product ----------

// Admin: every product of every shop (deleted ones are left out). The search finds part of a product name or a shop name.
router.get('/api/admin/products', auth.requireRole('admin'), (req, res) => {
  const search = auth.cleanSearch(req.query.search);
  const pattern = auth.likePattern(search);
  const products = db.prepare(`
    SELECT ${PRODUCT_FIELDS}, sellers.shop_name, sellers.slug AS shop_slug, sellers.status AS shop_status
    FROM products
    JOIN categories ON categories.id = products.category_id
    JOIN sellers ON sellers.id = products.seller_id
    WHERE products.deleted = 0
      AND (search_text(products.name) LIKE ? ESCAPE '\\' OR search_text(sellers.shop_name) LIKE ? ESCAPE '\\')
    ORDER BY sellers.shop_name COLLATE NOCASE, products.name COLLATE NOCASE`).all(pattern, pattern).map(withLowFlag);
  res.json({ search, products, counts: productCounts() });
});

// Admin: hide a product that breaks the rules. A reason is needed, and the seller sees it. Customers stop seeing the product.
router.post('/api/admin/products/:id/hide', auth.requireRole('admin'), (req, res) => {
  const product = findProduct(req.params.id);
  if (product.deleted) throw new HttpError(404, 'That product was deleted.');
  if (product.hidden) throw new HttpError(400, `${product.name} is already hidden.`);
  const reason = auth.cleanText((req.body || {}).reason);
  if (!reason) throw new HttpError(400, 'Please give a reason to hide this product. The seller will see it.');
  if (reason.length > 200) throw new HttpError(400, 'The reason must be 200 characters or fewer.');
  const result = db.prepare('UPDATE products SET hidden = 1, hidden_reason = ? WHERE id = ? AND hidden = 0').run(reason, product.id);
  if (result.changes !== 1) throw new HttpError(409, 'This product just changed. Please look again.');
  res.json({ ok: true, message: `${product.name} is hidden. Customers cannot see it.` });
});

// Admin: show a hidden product again. (If its seller had switched it off, it stays off.)
router.post('/api/admin/products/:id/unhide', auth.requireRole('admin'), (req, res) => {
  const product = findProduct(req.params.id);
  if (product.deleted) throw new HttpError(404, 'That product was deleted.');
  if (!product.hidden) throw new HttpError(400, `${product.name} is not hidden.`);
  const result = db.prepare('UPDATE products SET hidden = 0, hidden_reason = NULL WHERE id = ? AND hidden = 1').run(product.id);
  if (result.changes !== 1) throw new HttpError(409, 'This product just changed. Please look again.');
  res.json({ ok: true, message: `${product.name} is not hidden any more.` });
});

// ---------- Helpers ----------

// Checks the product form (add and edit) and returns clean values. Throws a plain message for the first problem.
function readProductForm(body) {
  const name = auth.cleanText(body.name).replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Product name must be 2 to 60 characters.');
  const categoryId = readCategoryId(body.category_id);
  const price = paiseFromRupeesText(body.price);
  if (price === null || price < 1 || price > MAX_PRICE) {
    throw new HttpError(400, 'Price must be in rupees, from 0.01 to 10,00,000, like 250 or 250.50.');
  }
  const description = auth.cleanText(body.description);
  if (description.length > 500) throw new HttpError(400, 'Description must be 500 characters or fewer.');
  const lowStockLevel = auth.readWholeNumber(body.low_stock_level, 'Low-stock level', 0, MAX_STOCK);
  const giftable = body.giftable === true || body.giftable === 1 || body.giftable === '1' ? 1 : 0; // "Giftable" tick box
  return { name, categoryId, price, description, giftable, lowStockLevel };
}

// The category chosen in the form. 400 if it is missing or not a real category.
function readCategoryId(value) {
  const id = auth.readId(typeof value === 'number' ? String(value) : value);
  const category = id ? db.prepare('SELECT id FROM categories WHERE id = ?').get(id) : null;
  if (!category) throw new HttpError(400, 'Please choose a category from the list.');
  return category.id;
}

// The file type from the first bytes of the file: '.jpg', '.png' or '.webp', or null for anything else.
function photoExtension(bytes) {
  const starts = (hex, at = 0) => bytes.subarray(at, at + hex.length / 2).toString('hex') === hex;
  if (bytes.length >= 3 && starts('ffd8ff')) return '.jpg';
  if (bytes.length >= 8 && starts('89504e470d0a1a0a')) return '.png';
  if (bytes.length >= 12 && starts('52494646') && starts('57454250', 8)) return '.webp'; // "RIFF" .... "WEBP"
  return null;
}

// Deletes a photo file this app saved earlier (only names it made itself, so nothing else can ever be deleted).
function removeOldPhoto(fileName) {
  if (!fileName || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(fileName)) return;
  fs.rmSync(path.join(UPLOADS_DIR, fileName), { force: true }); // done before the answer, so the old file is surely gone
}

// Finds a product by the id in the address (digits only), or answers 404.
function findProduct(idText) {
  const id = auth.readId(idText);
  const product = id ? db.prepare('SELECT * FROM products WHERE id = ?').get(id) : null;
  if (!product) throw new HttpError(404, 'That product does not exist.');
  return product;
}

// Finds one of the seller's OWN products: 404 if there is no such product, 403 if it belongs to another shop,
// 404 if the seller deleted it.
function findOwnProduct(req, idText) {
  const product = findProduct(idText);
  auth.requireOwnShop(req, product.seller_id);
  if (product.deleted) throw new HttpError(404, 'That product was deleted.');
  return product;
}

// Adds low: true when the stock is at or below the product's low-stock level, and the photo's web address.
function withLowFlag(product) {
  return { ...product, low: product.stock <= product.low_stock_level, photo_url: photoUrl(product.photo) };
}

// All categories, for the product form.
function allCategories() {
  return db.prepare('SELECT id, name FROM categories ORDER BY name COLLATE NOCASE').all();
}

// Counts for the admin page: all products (not deleted), hidden ones, and LOW ones across all shops.
function productCounts() {
  return db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(hidden), 0) AS hidden,
           COALESCE(SUM(stock <= low_stock_level), 0) AS low
    FROM products WHERE deleted = 0`).get();
}

module.exports = router;
