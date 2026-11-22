// routes/commissions.js - commissions, the early-bird offer, the ledger and payouts (sector 7).
// Rates are typed in percent on screen and saved as basis points (10% = 1000). The rate is copied into each order when
// it is placed, so changing a rate later never changes old orders.
// The ledger: when a seller order is delivered it is booked exactly once (a unique index stops a second booking):
//   online -> earning = items + shipping - commission (+, the platform owes the seller)
//   cash on delivery -> commission owed = -commission (the seller already holds the cash)
// Rejected and cancelled orders book nothing. A payout is - (the seller was paid). Balance = the sum of the ledger.
const express = require('express');
const { db, nowIso } = require('../db');
const auth = require('../auth');
const mail = require('../mail');
const { commissionRateWithReason } = require('./checkout');

const router = express.Router();
const { HttpError } = auth;
const MOST_PAYOUT = 100000000 * 100; // ₹10 crore: a typo guard

// ---------- The ledger ----------

// Books one delivered seller order, once. Called by the delivered step (routes/fulfilment.js).
function bookDelivery(sellerOrderId) {
  const part = db.prepare(`
    SELECT seller_orders.*, customer_orders.payment_method, customer_orders.code
    FROM seller_orders JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE seller_orders.id = ?`).get(sellerOrderId);
  if (!part || part.status !== 'delivered') return;
  const online = part.payment_method === 'online';
  const type = online ? 'earning' : 'commission_owed';
  const amount = online ? part.items_total + part.shipping - part.commission : -part.commission;
  const note = online
    ? `${part.code}: items ${part.items_total} + shipping ${part.shipping} - commission ${part.commission} (paise)`
    : `${part.code}: cash on delivery, commission ${part.commission} paise owed`;
  // INSERT OR IGNORE + the unique index (seller_order_id, type): a second booking of the same order does nothing.
  db.prepare('INSERT OR IGNORE INTO ledger (seller_id, seller_order_id, type, amount, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(part.seller_id, part.id, type, amount, note, nowIso());
}

// A shop's balance in paise: earnings - commission owed - payouts (the sum of its ledger).
function balanceOf(sellerId) {
  return db.prepare('SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE seller_id = ?').get(sellerId).n;
}

// ---------- Seller: Earnings ----------

// Seller: each delivered order (items, shipping, rate, commission, what they earn or owe), their payouts and balance.
router.get('/api/seller/earnings', auth.requireSeller('active', 'suspended'), (req, res) => {
  const bookings = db.prepare(`
    SELECT ledger.id, ledger.type, ledger.amount, ledger.note, ledger.created_at, seller_orders.items_total, seller_orders.shipping,
           seller_orders.commission_bps, seller_orders.commission, customer_orders.code, customer_orders.payment_method
    FROM ledger
    LEFT JOIN seller_orders ON seller_orders.id = ledger.seller_order_id
    LEFT JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE ledger.seller_id = ? ORDER BY ledger.id DESC LIMIT 500`).all(req.shop.id);
  res.json({
    balance: balanceOf(req.shop.id),
    orders: bookings.filter((b) => b.type !== 'payout'),
    payouts: bookings.filter((b) => b.type === 'payout').map(({ id, amount, note, created_at }) => ({ id, amount: -amount, note, created_at })),
    rate: commissionRateWithReason(req.shop.id),
  });
});

// ---------- Admin: Commissions ----------

// Admin: the default rate, each category's rate, each shop's own rate and the rate it actually gets today (and why),
// and the early-bird offer.
router.get('/api/admin/commissions', auth.requireRole('admin'), (req, res) => {
  const setting = (key) => Number(db.prepare('SELECT value FROM settings WHERE key = ?').get(key).value);
  const shops = db.prepare("SELECT id, shop_name, status, commission_bps, early_bird, approved_at FROM sellers WHERE status <> 'rejected' ORDER BY shop_name COLLATE NOCASE").all()
    .map((shop) => ({ ...shop, today: commissionRateWithReason(shop.id) }));
  res.json({
    default_bps: setting('default_commission_bps'),
    categories: db.prepare('SELECT id, name, commission_bps FROM categories ORDER BY name COLLATE NOCASE').all(),
    shops,
    early_bird: {
      slots: setting('early_bird_slots'), bps: setting('early_bird_bps'), days: setting('early_bird_days'),
      taken: db.prepare('SELECT COUNT(*) AS n FROM sellers WHERE early_bird = 1').get().n,
    },
  });
});

// Admin: the default rate (percent).
router.put('/api/admin/commissions/default', auth.requireRole('admin'), (req, res) => {
  const bps = readPercent((req.body || {}).percent, false);
  db.prepare("UPDATE settings SET value = ? WHERE key = 'default_commission_bps'").run(String(bps));
  res.json({ ok: true, message: `The default rate is now ${bps / 100}%. Old orders keep their rate.` });
});

// Admin: one category's rate (percent; empty = use the default).
router.put('/api/admin/commissions/category/:id', auth.requireRole('admin'), (req, res) => {
  const bps = readPercent((req.body || {}).percent, true);
  const done = db.prepare('UPDATE categories SET commission_bps = ? WHERE id = ?').run(bps, auth.readId(req.params.id));
  if (done.changes !== 1) throw new HttpError(404, 'That category does not exist.');
  res.json({ ok: true, message: bps === null ? 'This category now uses the default rate.' : `This category's rate is now ${bps / 100}%.` });
});

// Admin: add a category (a name of 2 to 40 characters, new; a rate in percent or empty).
router.post('/api/admin/categories', auth.requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const name = auth.cleanText(body.name).replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 40) throw new HttpError(400, 'A category name must be 2 to 40 characters.');
  const bps = readPercent(body.percent, true);
  try {
    db.prepare('INSERT INTO categories (name, commission_bps) VALUES (?, ?)').run(name, bps);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new HttpError(409, 'There is already a category with this name.');
    throw err;
  }
  res.status(201).json({ ok: true, message: `${name} was added.` });
});

// Admin: one shop's own rate (percent; empty = no own rate).
router.put('/api/admin/commissions/shop/:id', auth.requireRole('admin'), (req, res) => {
  const bps = readPercent((req.body || {}).percent, true);
  const done = db.prepare('UPDATE sellers SET commission_bps = ? WHERE id = ?').run(bps, auth.readId(req.params.id));
  if (done.changes !== 1) throw new HttpError(404, 'That shop does not exist.');
  res.json({ ok: true, message: bps === null ? 'This shop has no own rate now.' : `This shop's own rate is now ${bps / 100}%.` });
});

// Admin: the early-bird offer: how many shops (0 = no offer), the rate, and how many days after approval.
router.put('/api/admin/commissions/early-bird', auth.requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const slots = auth.readWholeNumber(body.slots, 'Early-bird places', 0, 1000);
  const bps = readPercent(body.percent, false);
  const days = auth.readWholeNumber(body.days, 'Early-bird days', 1, 3650);
  const save = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  db.transaction(() => {
    save.run(String(slots), 'early_bird_slots');
    save.run(String(bps), 'early_bird_bps');
    save.run(String(days), 'early_bird_days');
  })();
  res.json({ ok: true, message: slots === 0 ? 'The early-bird offer is off.' : `Early bird: the first ${slots} shops approved pay ${bps / 100}% for ${days} days.` });
});

// ---------- Admin: Payouts ----------

// Admin: every shop's balance (positive = the platform owes the shop; negative = the shop owes commission).
router.get('/api/admin/payouts', auth.requireRole('admin'), (req, res) => {
  const shops = db.prepare("SELECT id, shop_name, status FROM sellers WHERE status <> 'pending' ORDER BY shop_name COLLATE NOCASE").all()
    .map((shop) => ({ ...shop, balance: balanceOf(shop.id) }));
  const payouts = db.prepare(`
    SELECT ledger.id, -ledger.amount AS amount, ledger.note, ledger.created_at, sellers.shop_name
    FROM ledger JOIN sellers ON sellers.id = ledger.seller_id WHERE ledger.type = 'payout' ORDER BY ledger.id DESC LIMIT 100`).all();
  const due = shops.reduce((sum, shop) => sum + Math.max(shop.balance, 0), 0);
  res.json({ shops, payouts, due });
});

// Admin: record a payout (amount in rupees, a reference note). It only RECORDS money paid outside the app; it is never
// bigger than the balance. The seller gets a "payout recorded" email.
router.post('/api/admin/payouts', auth.requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const sellerId = auth.readId(String(body.seller_id ?? ''));
  const shop = sellerId ? db.prepare('SELECT id, shop_name FROM sellers WHERE id = ?').get(sellerId) : null;
  if (!shop) throw new HttpError(404, 'That shop does not exist.');
  const { paiseFromRupeesText } = require('../money');
  const amount = paiseFromRupeesText(String(body.amount ?? ''));
  if (amount === null || amount < 1 || amount > MOST_PAYOUT) throw new HttpError(400, 'The payout must be in rupees, like 500 or 500.50.');
  const note = auth.cleanText(body.note);
  if (!note || note.length > 100) throw new HttpError(400, 'Please give a reference, like a bank transfer number (at most 100 characters).');
  db.transaction(() => {
    const balance = balanceOf(shop.id);
    if (amount > balance) throw new HttpError(400, `The payout is bigger than ${shop.shop_name}'s balance.`);
    db.prepare("INSERT INTO ledger (seller_id, seller_order_id, type, amount, note, created_at) VALUES (?, NULL, 'payout', ?, ?, ?)")
      .run(shop.id, -amount, note, nowIso());
  }).immediate();
  mail.sendPayoutRecorded(shop.id, amount, note);
  res.status(201).json({ ok: true, balance: balanceOf(shop.id), message: `Payout recorded for ${shop.shop_name}.` });
});

// A rate typed in percent, like "8" or "8.5" (at most 2 decimals, 0 to 100), as basis points. Empty is null when allowed.
function readPercent(value, emptyAllowed) {
  const text = String(value ?? '').trim();
  if (text === '' && emptyAllowed) return null;
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  const bps = match ? Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0')) : NaN;
  if (!Number.isInteger(bps) || bps > 10000) throw new HttpError(400, 'A rate must be a percent from 0 to 100, like 8 or 8.5.');
  return bps;
}

module.exports = router;
module.exports.bookDelivery = bookDelivery;
module.exports.balanceOf = balanceOf;
