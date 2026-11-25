// routes/fulfilment.js - everything after checkout.
// The customer's private tracking page (Cancel while a part is placed, Help with this order), the seller's Orders page
// (Accept, Reject, Packed, Shipped, Delivered, Cash collected, replies to help requests), and the admin's Orders and
// Help requests pages (Cancel with a reason, Mark delivered, resolve help). Every status change goes through
// orderStatus.js changeStatus(); a rejected or cancelled part gets its stock back there, and a refund here.
const path = require('path');
const express = require('express');
const { db, nowIso } = require('../db');
const { formatMoney } = require('../money');
const auth = require('../auth');
const { changeStatus } = require('../orderStatus');
const mail = require('../mail');
const payments = require('../payments');
const { bookDelivery } = require('./commissions');
const { sendPage, pageTitle } = require('../pages');

const router = express.Router();
const { HttpError } = auth;
const PUBLIC_FOLDER = path.join(__dirname, '..', 'public');
const MOST_ORDERS_SHOWN = 200; // the admin page shows the newest 200 orders

// The tracking page for /track and /track/<token>. The page itself asks /api/track/<token> what to show,
// and says "Order not found" for a wrong or missing token.
router.get(['/track', '/track/:token'], async (req, res) => {
  await sendPage(res, 'track.html', { title: pageTitle('Your order'), description: 'Follow each part of your order.' });
});

// "Find my orders": the outbox gets one email with every tracking link for that address. The answer is always the
// same, so nobody can find out which email addresses have orders.
router.post('/api/find-my-orders', async (req, res) => {
  const email = auth.cleanEmail((req.body || {}).email);
  if (!auth.isValidEmail(email)) throw new HttpError(400, 'Please enter a valid email, like name@example.com.');
  const orders = await db.all('SELECT code, tracking_token FROM customer_orders WHERE email = ? ORDER BY id DESC LIMIT 50', email);
  if (orders.length > 0) await mail.sendFindMyOrders(email, orders);
  res.json({ ok: true, message: 'If we have orders for that email, we have sent the links.' });
});

// ---------- The seller's own orders ----------

const SELLER_TABS = {
  new: ['placed'],
  to_pack: ['accepted', 'packed'],
  shipped: ['shipped'],
  done: ['delivered', 'rejected', 'cancelled'],
};

// Seller: their OWN orders in one tab (New, To pack, Shipped, Done), never ones still waiting for payment, with the
// customer's name, phone and address, the products, the totals, the "Ship by" date (LATE when it has passed), the
// payment and any help request. A suspended shop still sees and fulfils its orders.
router.get('/api/seller/orders', auth.requireSeller('active', 'suspended'), async (req, res) => {
  const tab = Object.hasOwn(SELLER_TABS, req.query.tab) ? req.query.tab : 'new';
  const statuses = SELLER_TABS[tab];
  const rows = await db.all(`
    SELECT seller_orders.*, customer_orders.code, customer_orders.customer_name, customer_orders.phone,
           customer_orders.address, customer_orders.payment_method
    FROM seller_orders JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE seller_orders.seller_id = ? AND seller_orders.status IN (${statuses.map(() => '?').join(', ')})
    ORDER BY seller_orders.id ${tab === 'done' ? 'DESC' : 'ASC'} LIMIT 200`, req.shop.id, ...statuses);
  const counts = await sellerTabCounts(req.shop.id);
  const orders = [];
  for (const row of rows) orders.push(await sellerView(row, req.shop.dispatch_days));
  res.json({ tab, counts, orders });
});

// Seller: one button on one of their OWN orders. accept, reject (reason), pack, ship (courier and tracking number),
// deliver, or cash-collected (cash on delivery, once shipped or delivered).
router.post('/api/seller/orders/:id/:action', auth.requireSeller('active', 'suspended'), async (req, res) => {
  const body = req.body || {};
  const who = { role: 'seller', sellerId: req.shop.id };
  const id = auth.readId(req.params.id);
  const action = req.params.action;
  if (action === 'cash-collected') return res.json(await cashCollected(id, req.shop.id));
  if (action === 'help-reply') return res.json(await replyToHelp(id, req.shop.id, body.reply));
  const moves = { accept: 'accepted', reject: 'rejected', pack: 'packed', ship: 'shipped', deliver: 'delivered' };
  if (!Object.hasOwn(moves, action)) throw new HttpError(404, 'That action does not exist.');
  const part = await changeStatus(id, moves[action], who, { reason: body.reason, courier: body.courier, tracking_number: body.tracking_number });
  const extra = await afterStatusChange(part);
  res.json({ ok: true, status: part.status, message: `Order ${await codeOf(part)} is now ${statusWords(part.status)}.${extra}` });
});

// ---------- The admin: cancel and mark delivered ----------

// Admin: cancel a placed, accepted or packed part (a reason is always needed), with the stock back and a refund.
router.post('/api/admin/orders/:id/cancel', auth.requireRole('admin'), async (req, res) => {
  const reason = auth.cleanText((req.body || {}).reason);
  if (!reason) throw new HttpError(400, 'Please give a reason to cancel this part (at most 200 characters).');
  const part = await changeStatus(auth.readId(req.params.id), 'cancelled', { role: 'admin' }, { reason });
  const extra = await afterStatusChange(part);
  res.json({ ok: true, status: part.status, message: `Order ${await codeOf(part)}: this part is cancelled.${extra}` });
});

// Admin: mark a shipped part delivered.
router.post('/api/admin/orders/:id/deliver', auth.requireRole('admin'), async (req, res) => {
  const part = await changeStatus(auth.readId(req.params.id), 'delivered', { role: 'admin' });
  await afterStatusChange(part);
  res.json({ ok: true, status: part.status, message: `Order ${await codeOf(part)}: this part is delivered.` });
});

// ---------- Help with this order ----------

// Customer (with the tracking link): ask for help with one shop's part (up to 2000 characters, one open request per part).
router.post('/api/track/:token/parts/:partId/help', async (req, res) => {
  const order = await findOrderByToken(req.params.token, NOT_FOUND_IN_FORM);
  const part = await db.get('SELECT * FROM seller_orders WHERE id = ? AND customer_order_id = ?', auth.readId(req.params.partId), order.id);
  if (!part) throw new HttpError(404, 'That part of the order does not exist. Reload this page and try again.');
  if (part.status === 'pending_payment') throw new HttpError(400, 'This part is still waiting for payment. Finish paying, then ask for help.');
  const message = readLongText((req.body || {}).message, 'Please say what went wrong');
  try {
    await db.run("INSERT INTO help_requests (seller_order_id, message, status, created_at) VALUES (?, ?, 'open', ?)", part.id, message, nowIso());
  } catch (err) {
    if (err.code === 'UNIQUE_VIOLATION') throw new HttpError(409, 'There is already an open help request for this part. The shop and the admin will answer it.');
    throw err;
  }
  res.status(201).json({ ok: true, message: 'Your help request was sent to the shop and to us. You will see the answer on this page.' });
});

// Admin: help requests in one tab (open or resolved), each with its order, shop, the customer's message and the reply.
router.get('/api/admin/help', auth.requireRole('admin'), async (req, res) => {
  const tab = req.query.tab === 'resolved' ? 'resolved' : 'open';
  const requests = (await db.all(`
    SELECT help_requests.*, seller_orders.status AS part_status, seller_orders.payment_status, sellers.shop_name,
           customer_orders.code, customer_orders.customer_name, customer_orders.phone, customer_orders.email
    FROM help_requests
    JOIN seller_orders ON seller_orders.id = help_requests.seller_order_id
    JOIN sellers ON sellers.id = seller_orders.seller_id
    JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE help_requests.status = ? ORDER BY help_requests.id ${tab === 'open' ? 'ASC' : 'DESC'} LIMIT 200`, tab))
    .map((row) => ({ ...row, can_cancel: ['placed', 'accepted', 'packed'].includes(row.part_status) }));
  const counts = { open: 0, resolved: 0 };
  for (const row of await db.all('SELECT status, COUNT(*) AS n FROM help_requests GROUP BY status')) counts[row.status] = row.n;
  res.json({ tab, counts, requests });
});

// Admin: resolve a help request with a note. While the part is not shipped, the admin can also cancel and refund it.
router.post('/api/admin/help/:id/resolve', auth.requireRole('admin'), async (req, res) => {
  const body = req.body || {};
  const request = await db.get('SELECT * FROM help_requests WHERE id = ?', auth.readId(req.params.id));
  if (!request) throw new HttpError(404, 'That help request does not exist.');
  if (request.status !== 'open') throw new HttpError(400, 'This help request is already resolved.');
  const resolution = readLongText(body.resolution, 'Please write what was decided');
  let extra = '';
  if (body.cancel === true) {
    const part = await changeStatus(request.seller_order_id, 'cancelled', { role: 'admin' }, { reason: resolution.slice(0, 200) });
    extra = await afterStatusChange(part);
  }
  const done = await db.run("UPDATE help_requests SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ? AND status = 'open'",
    resolution, nowIso(), request.id);
  if (done.changes !== 1) throw new HttpError(409, 'This help request just changed. Please look again.');
  res.json({ ok: true, message: 'The help request is resolved. The customer sees the outcome.' + extra });
});

// ---------- After a status change ----------

// The emails and money after a part changed: shipped and delivered emails; for rejected or cancelled, the email and the
// refund if it was paid online. Returns words to add to the answer.
async function afterStatusChange(part) {
  if (part.status === 'shipped') await mail.sendShipped(part.id);
  if (part.status === 'delivered') {
    await mail.sendDelivered(part.id);
    await bookDelivery(part.id); // the ledger: booked exactly once
  }
  if (part.status === 'rejected' || part.status === 'cancelled') {
    await mail.sendPartStopped(part.id);
    const refunded = await payments.refundIfPaid(part.id);
    if (refunded && refunded.failed) return ' The refund failed: try again on the Payments page.';
    if (refunded) return ` ${formatMoney(refunded.amount)} was refunded to the customer.`;
  }
  return '';
}

// Cash collected: a cash-on-delivery part, once shipped or delivered, is marked paid (only by its own shop).
async function cashCollected(sellerOrderId, sellerId) {
  const part = await db.get(`
    SELECT seller_orders.*, customer_orders.payment_method, customer_orders.code FROM seller_orders
    JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id WHERE seller_orders.id = ?`, sellerOrderId);
  if (!part) throw new HttpError(404, 'That order does not exist.');
  if (part.seller_id !== sellerId) throw new HttpError(403, 'This order belongs to another shop.');
  if (part.payment_method !== 'cod') throw new HttpError(400, 'This order was paid online, so there is no cash to collect.');
  if (!['shipped', 'delivered'].includes(part.status)) throw new HttpError(400, 'Cash is collected on delivery, so first ship the order.');
  if (part.payment_status === 'paid') throw new HttpError(400, 'The cash for this order is already marked collected.');
  await db.run("UPDATE seller_orders SET payment_status = 'paid', updated_at = ? WHERE id = ? AND payment_status = 'unpaid'", nowIso(), part.id);
  return { ok: true, message: `Cash for order ${part.code} is marked collected.` };
}

// The seller adds ONE reply to the open help request on one of their own orders.
async function replyToHelp(sellerOrderId, sellerId, replyText) {
  const part = await db.get('SELECT seller_id FROM seller_orders WHERE id = ?', sellerOrderId);
  if (!part) throw new HttpError(404, 'That order does not exist.');
  if (part.seller_id !== sellerId) throw new HttpError(403, 'This order belongs to another shop.');
  const request = await db.get("SELECT * FROM help_requests WHERE seller_order_id = ? AND status = 'open'", sellerOrderId);
  if (!request) throw new HttpError(404, 'This order has no open help request.');
  if (request.seller_reply) throw new HttpError(400, 'You already replied to this help request.');
  const reply = readLongText(replyText, 'Please write your reply');
  const saved = await db.run('UPDATE help_requests SET seller_reply = ? WHERE id = ? AND seller_reply IS NULL', reply, request.id);
  if (saved.changes !== 1) throw new HttpError(400, 'You already replied to this help request.');
  return { ok: true, message: 'Your reply was added. The customer and the admin can see it.' };
}

// What a seller sees for one order: no email, nothing about other shops.
async function sellerView(row, dispatchDays) {
  const placedStep = await db.get("SELECT at FROM status_log WHERE seller_order_id = ? AND status = 'placed' ORDER BY id LIMIT 1", row.id);
  const placedAt = placedStep ? placedStep.at : row.created_at;
  const shipBy = new Date(Date.parse(placedAt) + dispatchDays * 86400000).toISOString();
  const waitingToShip = ['placed', 'accepted', 'packed'].includes(row.status);
  const help = await db.get('SELECT id, message, seller_reply, status, resolution, created_at FROM help_requests WHERE seller_order_id = ? ORDER BY id DESC LIMIT 1', row.id);
  return {
    id: row.id, code: row.code, status: row.status, reason: row.reason, courier: row.courier, tracking_number: row.tracking_number,
    customer_name: row.customer_name, phone: row.phone, address: row.address,
    payment_method: row.payment_method, payment_status: row.payment_status,
    items: await itemsOf(row.id), items_total: row.items_total, shipping: row.shipping, gift_wrap: row.gift_wrap,
    gift_message: row.gift_message, total: row.items_total + row.shipping + row.gift_wrap,
    commission_bps: row.commission_bps, commission: row.commission,
    placed_at: placedAt, ship_by: shipBy, late: waitingToShip && Date.parse(shipBy) < Date.now(),
    history: await historyOf(row.id), help: help || null,
  };
}

// How many of the seller's orders are in each tab (New gets a badge).
async function sellerTabCounts(sellerId) {
  const counts = {};
  for (const [tab, statuses] of Object.entries(SELLER_TABS)) {
    counts[tab] = (await db.get(`SELECT COUNT(*) AS n FROM seller_orders WHERE seller_id = ? AND status IN (${statuses.map(() => '?').join(', ')})`,
      sellerId, ...statuses)).n;
  }
  return counts;
}

// A message of 1 to 2000 characters.
function readLongText(value, ask) {
  const text = auth.cleanText(value);
  if (!text) throw new HttpError(400, `${ask} (at most 2000 characters).`);
  if (text.length > 2000) throw new HttpError(400, 'Please keep it to 2000 characters or fewer.');
  return text;
}

// The order code (like BZ-1001) of one part.
async function codeOf(part) {
  return (await db.get('SELECT code FROM customer_orders WHERE id = ?', part.customer_order_id)).code;
}

// The word for a status in an answer.
function statusWords(status) {
  return { accepted: 'accepted', rejected: 'rejected', packed: 'packed', shipped: 'shipped', delivered: 'delivered', cancelled: 'cancelled' }[status] || status;
}

// One order for its tracking page: the code, how it is paid, the totals, and each shop's part with its products,
// its status now and every earlier status with its time. Only the long random token opens it: anything else is 404.
router.get('/api/track/:token', async (req, res) => {
  const order = await findOrderByToken(req.params.token);
  res.json(await trackingView(order));
});

// The customer cancels one shop's part while it is still placed. It goes through the status function,
// which puts the stock back. The other shops' parts are not touched.
router.post('/api/track/:token/parts/:partId/cancel', async (req, res) => {
  const order = await findOrderByToken(req.params.token, NOT_FOUND_IN_FORM);
  const part = await changeStatus(auth.readId(req.params.partId), 'cancelled', { role: 'customer', customerOrderId: order.id });
  await mail.sendPartStopped(part.id);
  const refunded = await payments.refundIfPaid(part.id);
  const money = refunded && !refunded.failed ? ' Your payment for it is being refunded.' : '';
  res.json({ ok: true, status: part.status, message: 'This part of your order is cancelled. Its items went back to the shop.' + money });
});

// Admin: every customer order with its seller parts, newest first (read only for now).
router.get('/api/admin/orders', auth.requireRole('admin'), async (req, res) => {
  const rows = await db.all('SELECT * FROM customer_orders ORDER BY id DESC LIMIT ?', MOST_ORDERS_SHOWN + 1);
  const orders = [];
  for (const row of rows.slice(0, MOST_ORDERS_SHOWN)) orders.push(await adminView(row));
  res.json({ orders, more: rows.length > MOST_ORDERS_SHOWN, counts: await orderCounts() });
});

// ---------- Helpers ----------

// What a form on the tracking page says when its link is wrong: what happened and what to do next.
const NOT_FOUND_IN_FORM = 'Order not found. Open the link from your order email again.';

// The order with this tracking token, or 404 "Order not found." (a token is always 64 letters a-f and digits).
// notFoundText lets a form on the tracking page say what to do next.
async function findOrderByToken(token, notFoundText = 'Order not found.') {
  const looksRight = typeof token === 'string' && /^[a-f0-9]{64}$/.test(token);
  const order = looksRight ? await db.get('SELECT * FROM customer_orders WHERE tracking_token = ?', token) : null;
  if (!order) throw new HttpError(404, notFoundText);
  return order;
}

// What the customer sees. Their phone, email and address are left out, in case the link is ever shared.
// still_to_pay leaves out the parts that were rejected or cancelled.
async function trackingView(order) {
  const parts = await partsOf(order.id);
  const stillToPay = parts
    .filter((part) => part.status !== 'rejected' && part.status !== 'cancelled')
    .reduce((sum, part) => sum + part.items_total + part.shipping + part.gift_wrap, 0);
  return {
    order: {
      code: order.code,
      created_at: order.created_at,
      customer_name: order.customer_name,
      address: order.address,
      payment_method: order.payment_method,
      items_total: order.items_total,
      shipping_total: order.shipping_total,
      gift_wrap_total: order.gift_wrap_total,
      grand_total: order.grand_total,
      still_to_pay: stillToPay,
    },
    parts: await Promise.all(parts.map(async (part) => ({
      id: part.id,
      shop_name: part.shop_name,
      shop_slug: part.shop_slug,
      status: part.status,
      reason: part.reason,
      courier: part.courier,
      tracking_number: part.tracking_number,
      items: await itemsWithReviews(part),
      items_total: part.items_total,
      shipping: part.shipping,
      gift_wrap: part.gift_wrap,
      gift_message: part.gift_message,
      total: part.items_total + part.shipping + part.gift_wrap,
      history: (await historyOf(part.id)).map(({ status, at }) => ({ status, at })),
      can_cancel: part.status === 'placed',
      payment_status: part.payment_status,
      payment_words: paymentWords(order.payment_method, part),
      delivery: { from_days: part.dispatch_days + 2, to_days: part.dispatch_days + 5 },
      help: (await db.get('SELECT message, seller_reply, status, resolution, created_at, resolved_at FROM help_requests WHERE seller_order_id = ? ORDER BY id DESC LIMIT 1', part.id)) || null,
      can_ask_help: part.status !== 'pending_payment'
        && !(await db.get("SELECT 1 FROM help_requests WHERE seller_order_id = ? AND status = 'open'", part.id)),
    }))),
  };
}

// "Waiting for payment", "Paid", "Refunded" or, for cash on delivery, "Pay on delivery" / "Paid in cash".
function paymentWords(paymentMethod, part) {
  if (part.payment_status === 'refunded') return 'Refunded';
  if (part.status === 'pending_payment') return 'Waiting for payment';
  if (paymentMethod === 'cod') return part.payment_status === 'paid' ? 'Paid in cash' : 'Pay on delivery';
  if (part.payment_status === 'paid') return part.status === 'rejected' || part.status === 'cancelled' ? 'Paid, refund on its way' : 'Paid';
  return 'Not paid';
}

// What the admin sees: everything about the order, and for each part also the commission and who changed what.
async function adminView(order) {
  return {
    id: order.id,
    code: order.code,
    created_at: order.created_at,
    customer_name: order.customer_name,
    phone: order.phone,
    email: order.email,
    address: order.address,
    payment_method: order.payment_method,
    items_total: order.items_total,
    shipping_total: order.shipping_total,
    grand_total: order.grand_total,
    parts: await Promise.all((await partsOf(order.id)).map(async (part) => ({
      id: part.id,
      shop_name: part.shop_name,
      status: part.status,
      reason: part.reason,
      courier: part.courier,
      tracking_number: part.tracking_number,
      items_total: part.items_total,
      shipping: part.shipping,
      commission_bps: part.commission_bps,
      commission: part.commission,
      payment_status: part.payment_status,
      items: await itemsOf(part.id),
      history: await historyOf(part.id),
    }))),
  };
}

// The shops' parts of one customer order, with each shop's name and address, in shop name order.
async function partsOf(customerOrderId) {
  return db.all(`
    SELECT seller_orders.*, sellers.shop_name, sellers.slug AS shop_slug, sellers.dispatch_days
    FROM seller_orders JOIN sellers ON sellers.id = seller_orders.seller_id
    WHERE seller_orders.customer_order_id = ?
    ORDER BY sellers.shop_name COLLATE NOCASE, seller_orders.id`, customerOrderId);
}

// The items of one part, with the names and prices copied in when the order was placed.
async function itemsOf(sellerOrderId) {
  return db.all(`
    SELECT name, unit_price, quantity, line_total FROM order_items
    WHERE seller_order_id = ? ORDER BY id`, sellerOrderId);
}

// The items of one part for the customer, each with its review (if any) and whether it can be reviewed now
// (its part is delivered and it has no review yet).
async function itemsWithReviews(part) {
  return (await db.all(`
    SELECT order_items.id, order_items.product_id, order_items.name, order_items.unit_price, order_items.quantity,
           order_items.line_total, reviews.rating AS review_rating, reviews.text AS review_text, reviews.seller_reply AS review_reply
    FROM order_items LEFT JOIN reviews ON reviews.order_item_id = order_items.id
    WHERE order_items.seller_order_id = ? ORDER BY order_items.id`, part.id))
    .map((item) => ({ ...item, can_review: part.status === 'delivered' && item.review_rating === null }));
}

// Every status of one part, oldest first, with its time and who made it.
async function historyOf(sellerOrderId) {
  return db.all('SELECT status, by_role, at FROM status_log WHERE seller_order_id = ? ORDER BY id', sellerOrderId);
}

// How many customer orders there are, and how many shops' parts are in each status.
async function orderCounts() {
  const parts = {};
  for (const row of await db.all('SELECT status, COUNT(*) AS n FROM seller_orders GROUP BY status')) parts[row.status] = row.n;
  return { orders: (await db.get('SELECT COUNT(*) AS n FROM customer_orders')).n, parts };
}

module.exports = router;
