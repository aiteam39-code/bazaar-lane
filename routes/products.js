// routes/products.js - products and stock.
// Seller: only their OWN products (add, edit, + and - stock, switch off and on, delete). Anything else gets 403.
// Admin: every product, with a search, and Hide / Unhide for products that break the rules. The admin cannot change prices.
const express = require('express');
const { db, nowIso, photoUrl } = require('../db');
const { readPhotoBody, savePhoto, removeOldPhoto } = require('../photos');
const auth = require('../auth');
const { paiseFromRupeesText } = require('../money');

const router = express.Router();
const { HttpError } = auth;

const MAX_PRICE = 1000000 * 100; // Rs 10,00,000 in paise
const MAX_STOCK = 1000000;       // the most one product can have in stock
const MAX_STOCK_CHANGE = 100000; // the most one + or - can add or take away

// The product fields the seller and the admin see.
const PRODUCT_FIELDS = `
  products.id, products.seller_id, products.name, products.description, products.photo, products.price, products.giftable, products.size_label,
  products.stock, products.low_stock_level, products.active, products.hidden, products.hidden_reason,
  products.category_id, categories.name AS category_name`;

// ---------- Seller: their own products ----------

// The seller's own products (deleted ones are left out), the categories for the form, and how many are LOW.
// A suspended shop can still look at its products, but cannot change them.
router.get('/api/seller/products', auth.requireSeller('active', 'suspended'), async (req, res) => {
  const rows = await db.all(`
    SELECT ${PRODUCT_FIELDS}
    FROM products JOIN categories ON categories.id = products.category_id
    WHERE products.seller_id = ? AND products.deleted = 0
    ORDER BY products.name COLLATE NOCASE`, req.shop.id);
  const products = rows.map(withLowFlag);
  res.json({
    shop: { shop_name: req.shop.shop_name, slug: req.shop.slug, status: req.shop.status, status_reason: req.shop.status_reason },
    categories: await allCategories(),
    products,
    low_count: products.filter((product) => product.low).length,
  });
});

// Add a product. It starts on sale. The price is typed in rupees and saved as paise.
router.post('/api/seller/products', auth.requireSeller('active'), async (req, res) => {
  const body = req.body || {};
  const form = await readProductForm(body);
  const stock = auth.readWholeNumber(body.stock, 'Stock', 0, MAX_STOCK);
  const result = await db.run(`
    INSERT INTO products (seller_id, category_id, name, description, price, giftable, size_label, stock, low_stock_level, active, deleted, hidden, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, ?)`,
    req.shop.id, form.categoryId, form.name, form.description, form.price, form.giftable, form.sizeLabel, stock, form.lowStockLevel, nowIso());
  res.status(201).json({ ok: true, id: result.lastInsertRowid, message: `${form.name} was added.` });
});

// Edit a product: name, category, price, description and low-stock level. Stock only changes with + and -.
router.put('/api/seller/products/:id', auth.requireSeller('active'), async (req, res) => {
  const product = await findOwnProduct(req, req.params.id);
  const form = await readProductForm(req.body || {});
  await db.run(`
    UPDATE products SET name = ?, category_id = ?, price = ?, description = ?, giftable = ?, size_label = ?, low_stock_level = ?
    WHERE id = ? AND seller_id = ?`,
    form.name, form.categoryId, form.price, form.description, form.giftable, form.sizeLabel, form.lowStockLevel, product.id, req.shop.id);
  res.json({ ok: true, message: `${form.name} was saved.` });
});

// Stock +: adds the amount (1 to 1,00,000). The stock can be at most 10,00,000.
router.post('/api/seller/products/:id/stock/add', auth.requireSeller('active'), async (req, res) => {
  const product = await findOwnProduct(req, req.params.id);
  const amount = auth.readWholeNumber((req.body || {}).amount, 'Amount', 1, MAX_STOCK_CHANGE);
  const row = await db.get(`
    UPDATE products SET stock = stock + ?
    WHERE id = ? AND seller_id = ? AND stock + ? <= ?
    RETURNING stock`, amount, product.id, req.shop.id, amount, MAX_STOCK);
  if (!row) {
    const now = (await db.get('SELECT stock FROM products WHERE id = ?', product.id)).stock;
    const most = MAX_STOCK.toLocaleString('en-IN');
    throw new HttpError(400, `Stock can be at most ${most}. ${product.name} has ${now.toLocaleString('en-IN')} now, so add a smaller amount.`);
  }
  res.json({ ok: true, stock: row.stock, message: `Added ${amount}. ${product.name} now has ${row.stock} in stock.` });
});

// Stock -: takes the amount away. Refused if that would go below 0. The database update checks it too (stock >= amount),
// so two clicks at the same moment can never take the stock below 0.
router.post('/api/seller/products/:id/stock/remove', auth.requireSeller('active'), async (req, res) => {
  const product = await findOwnProduct(req, req.params.id);
  const amount = auth.readWholeNumber((req.body || {}).amount, 'Amount', 1, MAX_STOCK_CHANGE);
  const row = await db.get(`
    UPDATE products SET stock = stock - ?
    WHERE id = ? AND seller_id = ? AND stock >= ?
    RETURNING stock`, amount, product.id, req.shop.id, amount);
  if (!row) {
    const { stock } = await db.get('SELECT stock FROM products WHERE id = ?', product.id);
    throw new HttpError(400, `Only ${stock} of ${product.name} in stock, so you cannot take away ${amount}.`);
  }
  res.json({ ok: true, stock: row.stock, message: `Took away ${amount}. ${product.name} now has ${row.stock} in stock.` });
});

// Switch off: customers stop seeing the product. It stays in the seller's list.
router.post('/api/seller/products/:id/switch-off', auth.requireSeller('active'), async (req, res) => {
  const product = await findOwnProduct(req, req.params.id);
  await db.run('UPDATE products SET active = 0 WHERE id = ? AND seller_id = ?', product.id, req.shop.id);
  res.json({ ok: true, message: `${product.name} is switched off. Customers cannot see it.` });
});

// Switch on again. Not allowed while the admin has hidden the product.
router.post('/api/seller/products/:id/switch-on', auth.requireSeller('active'), async (req, res) => {
  const product = await findOwnProduct(req, req.params.id);
  const result = await db.run('UPDATE products SET active = 1 WHERE id = ? AND seller_id = ? AND hidden = 0',
    product.id, req.shop.id);
  if (result.changes !== 1) {
    throw new HttpError(403, `The admin has hidden ${product.name}, so you cannot switch it on. Reason: ${product.hidden_reason || 'not given'}`);
  }
  res.json({ ok: true, message: `${product.name} is on sale again.` });
});

// Upload a product photo (photos.js: JPEG, PNG or WebP by the first bytes, at most 2 MB, a new random name). A new
// photo replaces the old one.
router.post('/api/seller/products/:id/photo', auth.requireSeller('active'), readPhotoBody, async (req, res) => {
  const product = await findOwnProduct(req, req.params.id);
  const fileName = await savePhoto(req.body);
  await db.run('UPDATE products SET photo = ? WHERE id = ? AND seller_id = ?', fileName, product.id, req.shop.id);
  await removeOldPhoto(product.photo);
  res.json({ ok: true, photo_url: photoUrl(fileName), message: `The photo of ${product.name} was saved.` });
});

// Delete: the product disappears for good, but it is never erased, so old orders keep its name.
router.delete('/api/seller/products/:id', auth.requireSeller('active'), async (req, res) => {
  const product = await findOwnProduct(req, req.params.id);
  await db.run('UPDATE products SET deleted = 1 WHERE id = ? AND seller_id = ?', product.id, req.shop.id);
  res.json({ ok: true, message: `${product.name} was deleted.` });
});

// ---------- Admin: every product ----------

// Admin: every product of every shop (deleted ones are left out). The search finds part of a product name or a shop name.
router.get('/api/admin/products', auth.requireRole('admin'), async (req, res) => {
  const search = auth.cleanSearch(req.query.search);
  const pattern = auth.likePattern(search);
  const rows = await db.all(`
    SELECT ${PRODUCT_FIELDS}, sellers.shop_name, sellers.slug AS shop_slug, sellers.status AS shop_status
    FROM products
    JOIN categories ON categories.id = products.category_id
    JOIN sellers ON sellers.id = products.seller_id
    WHERE products.deleted = 0
      AND (search_text(products.name) LIKE ? ESCAPE '\\' OR search_text(sellers.shop_name) LIKE ? ESCAPE '\\')
    ORDER BY sellers.shop_name COLLATE NOCASE, products.name COLLATE NOCASE`, pattern, pattern);
  res.json({ search, products: rows.map(withLowFlag), counts: await productCounts() });
});

// Admin: hide a product that breaks the rules. A reason is needed, and the seller sees it. Customers stop seeing the product.
router.post('/api/admin/products/:id/hide', auth.requireRole('admin'), async (req, res) => {
  const product = await findProduct(req.params.id);
  if (product.deleted) throw new HttpError(404, 'That product was deleted.');
  if (product.hidden) throw new HttpError(400, `${product.name} is already hidden.`);
  const reason = auth.cleanText((req.body || {}).reason);
  if (!reason) throw new HttpError(400, 'Please give a reason to hide this product. The seller will see it.');
  if (reason.length > 200) throw new HttpError(400, 'The reason must be 200 characters or fewer.');
  const result = await db.run('UPDATE products SET hidden = 1, hidden_reason = ? WHERE id = ? AND hidden = 0', reason, product.id);
  if (result.changes !== 1) throw new HttpError(409, 'This product just changed. Please look again.');
  res.json({ ok: true, message: `${product.name} is hidden. Customers cannot see it.` });
});

// Admin: show a hidden product again. (If its seller had switched it off, it stays off.)
router.post('/api/admin/products/:id/unhide', auth.requireRole('admin'), async (req, res) => {
  const product = await findProduct(req.params.id);
  if (product.deleted) throw new HttpError(404, 'That product was deleted.');
  if (!product.hidden) throw new HttpError(400, `${product.name} is not hidden.`);
  const result = await db.run('UPDATE products SET hidden = 0, hidden_reason = NULL WHERE id = ? AND hidden = 1', product.id);
  if (result.changes !== 1) throw new HttpError(409, 'This product just changed. Please look again.');
  res.json({ ok: true, message: `${product.name} is not hidden any more.` });
});

// ---------- Helpers ----------

// Checks the product form (add and edit) and returns clean values. Throws a plain message for the first problem.
async function readProductForm(body) {
  const name = auth.cleanText(body.name).replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Product name must be 2 to 60 characters.');
  const categoryId = await readCategoryId(body.category_id);
  const price = paiseFromRupeesText(body.price);
  if (price === null || price < 1 || price > MAX_PRICE) {
    throw new HttpError(400, 'Price must be in rupees, from 0.01 to 10,00,000, like 250 or 250.50.');
  }
  const description = auth.cleanText(body.description);
  if (description.length > 500) throw new HttpError(400, 'Description must be 500 characters or fewer.');
  const lowStockLevel = auth.readWholeNumber(body.low_stock_level, 'Low-stock level', 0, MAX_STOCK);
  const giftable = body.giftable === true || body.giftable === 1 || body.giftable === '1' ? 1 : 0; // "Giftable" tick box
  const sizeLabel = auth.cleanText(body.size_label).replace(/\s+/g, ' '); // "250 g", "Set of 4" (optional)
  if (sizeLabel.length > 30) throw new HttpError(400, 'Size or weight must be 30 characters or fewer, like 250 g or Set of 4.');
  return { name, categoryId, price, description, giftable, sizeLabel, lowStockLevel };
}

// The category chosen in the form. 400 if it is missing or not a real category.
async function readCategoryId(value) {
  const id = auth.readId(typeof value === 'number' ? String(value) : value);
  const category = id ? await db.get('SELECT id FROM categories WHERE id = ?', id) : null;
  if (!category) throw new HttpError(400, 'Please choose a category from the list.');
  return category.id;
}

// Finds a product by the id in the address (digits only), or answers 404.
async function findProduct(idText) {
  const id = auth.readId(idText);
  const product = id ? await db.get('SELECT * FROM products WHERE id = ?', id) : null;
  if (!product) throw new HttpError(404, 'That product does not exist.');
  return product;
}

// Finds one of the seller's OWN products: 404 if there is no such product, 403 if it belongs to another shop,
// 404 if the seller deleted it.
async function findOwnProduct(req, idText) {
  const product = await findProduct(idText);
  await auth.requireOwnShop(req, product.seller_id);
  if (product.deleted) throw new HttpError(404, 'That product was deleted.');
  return product;
}

// Adds low: true when the stock is at or below the product's low-stock level, and the photo's web address.
function withLowFlag(product) {
  return { ...product, low: product.stock <= product.low_stock_level, photo_url: photoUrl(product.photo) };
}

// All categories, for the product form.
async function allCategories() {
  return db.all('SELECT id, name FROM categories ORDER BY name COLLATE NOCASE');
}

// Counts for the admin page: all products (not deleted), hidden ones, and LOW ones across all shops.
async function productCounts() {
  return db.get(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(hidden), 0) AS hidden,
           COALESCE(SUM(CASE WHEN stock <= low_stock_level THEN 1 ELSE 0 END), 0) AS low
    FROM products WHERE deleted = 0`);
}

module.exports = router;
