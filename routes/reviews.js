// routes/reviews.js - reviews and trust (sector 6).
// Customer (with the tracking link): rate each product of a DELIVERED part 1 to 5 stars, with an optional review,
// once per product per order; "Report this listing" on any product page.
// Seller: their own products' reviews, and ONE reply to each. Admin: hide or show any review; hide a reported product
// or dismiss the report. Hidden reviews disappear from customer pages and from every average.
const express = require('express');
const { db, nowIso } = require('../db');
const auth = require('../auth');

const router = express.Router();
const { HttpError } = auth;

// Customer: review one item of their order. The server checks the tracking token, that the item is in that order,
// and that its shop's part is delivered. One review per order item (the database refuses a second one too).
router.post('/api/track/:token/items/:itemId/review', (req, res) => {
  const order = findOrderByToken(req.params.token);
  const item = db.prepare(`
    SELECT order_items.*, seller_orders.status, seller_orders.seller_id
    FROM order_items JOIN seller_orders ON seller_orders.id = order_items.seller_order_id
    WHERE order_items.id = ? AND seller_orders.customer_order_id = ?`).get(auth.readId(req.params.itemId), order.id);
  if (!item) throw new HttpError(404, 'That product is not in this order. Reload the page and pick a product from this order.');
  if (item.status !== 'delivered') throw new HttpError(400, 'You can review a product once it has been delivered.');
  const body = req.body || {};
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'Please choose 1 to 5 stars.');
  const text = auth.cleanText(body.text);
  if (text.length > 500) throw new HttpError(400, 'A review can be at most 500 characters.');
  try {
    db.prepare(`
      INSERT INTO reviews (order_item_id, product_id, seller_id, rating, text, hidden, created_at)
      VALUES (?, ?, ?, ?, ?, 0, ?)`).run(item.id, item.product_id, item.seller_id, rating, text, nowIso());
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'You already reviewed this product for this order.');
    throw err;
  }
  res.status(201).json({ ok: true, message: 'Thank you. Your review is on the product page, marked Verified buyer.' });
});

// Anyone: "Report this listing" (a reason of 1 to 2000 characters). Only products customers can see can be reported.
router.post('/api/products/:id/report', (req, res) => {
  const id = auth.readId(req.params.id);
  const product = id ? db.prepare(`
    SELECT products.id FROM products JOIN sellers ON sellers.id = products.seller_id
    WHERE products.id = ? AND products.active = 1 AND products.deleted = 0 AND products.hidden = 0 AND sellers.status = 'active'`).get(id) : null;
  if (!product) throw new HttpError(404, 'This product is no longer on sale, so there is nothing to report.');
  const reason = auth.cleanText((req.body || {}).reason);
  if (!reason) throw new HttpError(400, 'Please say what is wrong with this listing (at most 2000 characters).');
  if (reason.length > 2000) throw new HttpError(400, 'Please keep it to 2000 characters or fewer.');
  db.prepare("INSERT INTO reports (product_id, reason, status, created_at) VALUES (?, ?, 'open', ?)").run(product.id, reason, nowIso());
  res.status(201).json({ ok: true, message: 'Thank you. The marketplace team will look at this listing.' });
});

// ---------- Seller ----------

// Seller: the reviews of their OWN products, newest first (hidden ones too, marked), with their average.
router.get('/api/seller/reviews', auth.requireSeller('active', 'suspended'), (req, res) => {
  const reviews = db.prepare(`
    SELECT reviews.id, reviews.rating, reviews.text, reviews.seller_reply, reviews.hidden, reviews.created_at,
           products.name AS product_name, customer_orders.customer_name, customer_orders.code
    FROM reviews
    JOIN products ON products.id = reviews.product_id
    JOIN order_items ON order_items.id = reviews.order_item_id
    JOIN seller_orders ON seller_orders.id = order_items.seller_order_id
    JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE reviews.seller_id = ? ORDER BY reviews.id DESC LIMIT 200`).all(req.shop.id)
    .map(({ customer_name, ...review }) => ({ ...review, first_name: customer_name.split(' ')[0] }));
  const average = db.prepare('SELECT ROUND(AVG(rating), 1) AS rating, COUNT(*) AS n FROM reviews WHERE seller_id = ? AND hidden = 0').get(req.shop.id);
  res.json({ reviews, rating: average.rating, review_count: average.n });
});

// Seller: ONE reply to a review of one of their OWN products (up to 500 characters).
router.post('/api/seller/reviews/:id/reply', auth.requireSeller('active', 'suspended'), (req, res) => {
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(auth.readId(req.params.id));
  if (!review) throw new HttpError(404, 'That review does not exist.');
  auth.requireOwnShop(req, review.seller_id);
  if (review.seller_reply) throw new HttpError(400, 'You already replied to this review.');
  const reply = auth.cleanText((req.body || {}).reply);
  if (!reply || reply.length > 500) throw new HttpError(400, 'Please write a reply of up to 500 characters.');
  const saved = db.prepare('UPDATE reviews SET seller_reply = ? WHERE id = ? AND seller_reply IS NULL').run(reply, review.id);
  if (saved.changes !== 1) throw new HttpError(400, 'You already replied to this review.');
  res.json({ ok: true, message: 'Your reply is under the review now.' });
});

// ---------- Admin ----------

// Admin: every review (newest 200), with its product and shop, visible or hidden.
router.get('/api/admin/reviews', auth.requireRole('admin'), (req, res) => {
  const reviews = db.prepare(`
    SELECT reviews.id, reviews.rating, reviews.text, reviews.seller_reply, reviews.hidden, reviews.created_at,
           products.name AS product_name, sellers.shop_name
    FROM reviews JOIN products ON products.id = reviews.product_id JOIN sellers ON sellers.id = reviews.seller_id
    ORDER BY reviews.id DESC LIMIT 200`).all();
  res.json({ reviews, hidden_count: reviews.filter((r) => r.hidden).length });
});

// Admin: hide or show a review. A hidden review counts for nothing.
router.post('/api/admin/reviews/:id/:action', auth.requireRole('admin'), (req, res) => {
  const action = req.params.action;
  if (action !== 'hide' && action !== 'show') throw new HttpError(404, 'That action does not exist.');
  const done = db.prepare('UPDATE reviews SET hidden = ? WHERE id = ?').run(action === 'hide' ? 1 : 0, auth.readId(req.params.id));
  if (done.changes !== 1) throw new HttpError(404, 'That review does not exist.');
  res.json({ ok: true, message: action === 'hide' ? 'The review is hidden.' : 'The review is shown again.' });
});

// Admin: reports in one tab (open, or done = hidden and dismissed), with the product and its shop.
router.get('/api/admin/reports', auth.requireRole('admin'), (req, res) => {
  const tab = req.query.tab === 'done' ? 'done' : 'open';
  const reports = db.prepare(`
    SELECT reports.*, products.name AS product_name, products.hidden AS product_hidden, sellers.shop_name
    FROM reports JOIN products ON products.id = reports.product_id JOIN sellers ON sellers.id = products.seller_id
    WHERE ${tab === 'open' ? "reports.status = 'open'" : "reports.status <> 'open'"}
    ORDER BY reports.id ${tab === 'open' ? 'ASC' : 'DESC'} LIMIT 200`).all();
  const open = db.prepare("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'").get().n;
  res.json({ tab, open_count: open, reports });
});

// Admin: hide the reported product (it can no longer be seen or bought; the seller sees the reason), or dismiss.
router.post('/api/admin/reports/:id/:action', auth.requireRole('admin'), (req, res) => {
  const action = req.params.action;
  if (action !== 'hide' && action !== 'dismiss') throw new HttpError(404, 'That action does not exist.');
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(auth.readId(req.params.id));
  if (!report) throw new HttpError(404, 'That report does not exist.');
  if (report.status !== 'open') throw new HttpError(400, 'This report is already handled.');
  if (action === 'dismiss') {
    db.prepare("UPDATE reports SET status = 'dismissed' WHERE id = ? AND status = 'open'").run(report.id);
    return res.json({ ok: true, message: 'The report is dismissed. The product stays on sale.' });
  }
  db.transaction(() => {
    db.prepare('UPDATE products SET hidden = 1, hidden_reason = ? WHERE id = ?').run('Reported: ' + report.reason.slice(0, 180), report.product_id);
    db.prepare("UPDATE reports SET status = 'hidden' WHERE product_id = ? AND status = 'open'").run(report.product_id);
  })();
  res.json({ ok: true, message: 'The product is hidden. It can no longer be seen or bought.' });
});

// The customer order with this tracking token, or 404 with what to do next (it is shown in the review form).
function findOrderByToken(token) {
  const looksRight = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
  const order = looksRight ? db.prepare('SELECT * FROM customer_orders WHERE tracking_token = ?').get(token) : null;
  if (!order) throw new HttpError(404, 'Order not found. Open the link from your order email again.');
  return order;
}

module.exports = router;
