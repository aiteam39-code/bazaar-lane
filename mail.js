// mail.js - every email the marketplace "sends". Nothing is really sent: each email is written into the emails table
// (the outbox), which the admin reads at /admin/outbox.html. Later a real email service can replace sendEmail().
// Rule: an email never contains a password.
const { db, nowIso } = require('./db');
const fs = require('fs');
const path = require('path');
const { formatMoney } = require('./money');
const { currentSeason, SEASON_FOLDER } = require('./seasons');

const MARKETPLACE_NAME = process.env.MARKETPLACE_NAME || 'Bazaar Lane';
const SITE_URL = process.env.SITE_URL || `http://localhost:${Number(process.env.PORT) || 3000}`;

// Writes one email into the outbox. lines become the body, one per line.
function sendEmail(to, subject, lines) {
  const body = lines.filter((line) => line !== null && line !== undefined).join('\n');
  db.prepare('INSERT INTO emails (to_address, subject, body, created_at) VALUES (?, ?, ?, ?)').run(to, subject, body, nowIso());
}

// The full web address of a tracking link.
function trackingLink(token) {
  return `${SITE_URL}/track/${token}`;
}

// The email address of a shop's seller login.
function sellerEmail(sellerId) {
  const user = db.prepare("SELECT email FROM users WHERE seller_id = ? AND role = 'seller' ORDER BY id LIMIT 1").get(sellerId);
  return user ? user.email : null;
}

// While a season is on, its warm sentence for an email (from public/seasons/<key>-words.json), or null.
function seasonSentence(which, part) {
  const season = currentSeason();
  if (!season) return null;
  try {
    const words = JSON.parse(fs.readFileSync(path.join(SEASON_FOLDER, season.key + '-words.json'), 'utf8'));
    const email = words.email || {};
    // "wrapped" only when this part really paid for gift wrap; otherwise the plain sentence.
    const template = (part.gift_wrap > 0 && email[which + '_wrapped']) || email[which];
    return template ? template.replace('{shop}', part.shop_name).replace('{courier}', part.courier || 'the courier') : null;
  } catch (e) {
    return null; // no words file: the normal sentence
  }
}

// One seller order with its shop, items and customer order, for the emails below.
function loadPart(sellerOrderId) {
  const part = db.prepare(`
    SELECT seller_orders.*, sellers.shop_name, sellers.dispatch_days, customer_orders.code, customer_orders.tracking_token,
           customer_orders.customer_name, customer_orders.email AS customer_email, customer_orders.phone,
           customer_orders.address, customer_orders.payment_method
    FROM seller_orders
    JOIN sellers ON sellers.id = seller_orders.seller_id
    JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE seller_orders.id = ?`).get(sellerOrderId);
  part.items = db.prepare('SELECT name, unit_price, quantity, line_total FROM order_items WHERE seller_order_id = ? ORDER BY id')
    .all(sellerOrderId);
  return part;
}

// The lines that list one shop's part: its items, shipping and total.
function partLines(part) {
  return [
    `From ${part.shop_name}:`,
    ...part.items.map((item) => `  ${item.quantity} x ${item.name} (${formatMoney(item.unit_price)} each): ${formatMoney(item.line_total)}`),
    `  Shipping: ${part.shipping === 0 ? 'free' : formatMoney(part.shipping)}`,
    part.gift_wrap ? `  Gift wrap: ${formatMoney(part.gift_wrap)}` : null,
    part.gift_message ? `  Gift message: "${part.gift_message}"` : null,
    `  Total from ${part.shop_name}: ${formatMoney(part.items_total + part.shipping + part.gift_wrap)}`,
  ];
}

// How the order is paid, in words.
function paidHow(paymentMethod) {
  return paymentMethod === 'cod' ? 'Cash on delivery' : 'Paid online';
}

// To the customer, once the order is placed (cash on delivery) or paid (online): the code, the link, every part and cost.
function sendOrderConfirmation(customerOrderId) {
  const order = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(customerOrderId);
  const parts = db.prepare('SELECT id FROM seller_orders WHERE customer_order_id = ? ORDER BY id').all(customerOrderId)
    .map((row) => loadPart(row.id));
  sendEmail(order.email, `Your ${MARKETPLACE_NAME} order ${order.code}`, [
    `Hello ${order.customer_name},`,
    '',
    `Thank you for your order ${order.code}. Each shop packs and sends its own part.`,
    `Follow every part here: ${trackingLink(order.tracking_token)}`,
    '',
    ...parts.flatMap((part) => [...partLines(part), '']),
    `Items: ${formatMoney(order.items_total)}`,
    `Shipping: ${order.shipping_total === 0 ? 'free' : formatMoney(order.shipping_total)}`,
    order.gift_wrap_total ? `Gift wrap: ${formatMoney(order.gift_wrap_total)}` : null,
    `Grand total: ${formatMoney(order.grand_total)} (${paidHow(order.payment_method)})`,
    '',
    `Delivery address: ${order.address}`,
  ]);
}

// To one seller: a new order, with ONLY their own part (never anything about the other shops in the same order).
function sendNewOrderToSeller(sellerOrderId) {
  const part = loadPart(sellerOrderId);
  const to = sellerEmail(part.seller_id);
  if (!to) return;
  sendEmail(to, `New order ${part.code} for ${part.shop_name}`, [
    `You have a new order: ${part.code}.`,
    '',
    ...partLines(part),
    '',
    `Payment: ${paidHow(part.payment_method)}`,
    `Customer: ${part.customer_name}, phone ${part.phone}`,
    `Deliver to: ${part.address}`,
    `Please accept or reject it on your Orders page, and send it within ${part.dispatch_days} day${part.dispatch_days === 1 ? '' : 's'}.`,
  ]);
}

// To the customer: one shop's part was rejected or cancelled, with the reason and what happens to the money.
function sendPartStopped(sellerOrderId) {
  const part = loadPart(sellerOrderId);
  const word = part.status === 'rejected' ? 'could not take' : 'cancelled';
  const money = part.payment_status === 'refunded' || part.payment_method === 'online'
    ? `We are refunding ${formatMoney(part.items_total + part.shipping + part.gift_wrap)} for this part to the way you paid.`
    : 'You will not be asked to pay for this part.';
  sendEmail(part.customer_email, `Order ${part.code}: ${part.shop_name} ${word} your part`, [
    `Hello ${part.customer_name},`,
    '',
    `${part.shop_name} ${word} their part of order ${part.code}.`,
    part.reason ? `Reason: ${part.reason}` : null,
    money,
    'The other shops in your order are not affected.',
    `Your order: ${trackingLink(part.tracking_token)}`,
  ]);
}

// To the customer: a part is on its way, with the courier and tracking number.
function sendShipped(sellerOrderId) {
  const part = loadPart(sellerOrderId);
  sendEmail(part.customer_email, `Order ${part.code}: ${part.shop_name} shipped your part`, [
    `Hello ${part.customer_name},`,
    '',
    seasonSentence('shipped', part) || `${part.shop_name} shipped your part of order ${part.code} with ${part.courier}.`,
    `Order: ${part.code}`,
    `Courier tracking number: ${part.tracking_number}`,
    `Your order: ${trackingLink(part.tracking_token)}`,
  ]);
}

// To the customer: a part was delivered, with a link to leave a review.
function sendDelivered(sellerOrderId) {
  const part = loadPart(sellerOrderId);
  sendEmail(part.customer_email, `Order ${part.code}: your part from ${part.shop_name} was delivered`, [
    `Hello ${part.customer_name},`,
    '',
    seasonSentence('delivered', part) || `Your part of order ${part.code} from ${part.shop_name} was delivered.`,
    `Order: ${part.code}`,
    `How was it? Leave a review here: ${trackingLink(part.tracking_token)}`,
  ]);
}

// To the customer: a refund for one shop's part was made.
function sendRefunded(sellerOrderId, amount) {
  const part = loadPart(sellerOrderId);
  sendEmail(part.customer_email, `Order ${part.code}: refund of ${formatMoney(amount)}`, [
    `Hello ${part.customer_name},`,
    '',
    `We refunded ${formatMoney(amount)} for the part of order ${part.code} from ${part.shop_name}.`,
    'It goes back to the way you paid. Banks can take a few working days to show it.',
    `Your order: ${trackingLink(part.tracking_token)}`,
  ]);
}

// To the customer: an online payment did not go through, or was not finished in time.
function sendPaymentFailed(customerOrderId, why) {
  const order = db.prepare('SELECT * FROM customer_orders WHERE id = ?').get(customerOrderId);
  sendEmail(order.email, `Order ${order.code} was not paid`, [
    `Hello ${order.customer_name},`,
    '',
    `${why} So order ${order.code} is cancelled and nothing was charged.`,
    `You can place it again from your bag: ${SITE_URL}/cart.html`,
  ]);
}

// To a seller: their shop was approved or not approved.
function sendShopDecision(sellerId, approved, reason) {
  const shop = db.prepare('SELECT shop_name FROM sellers WHERE id = ?').get(sellerId);
  const to = sellerEmail(sellerId);
  if (!to) return;
  if (approved) {
    sendEmail(to, `${shop.shop_name} is approved`, [
      `Good news: ${shop.shop_name} is live on ${MARKETPLACE_NAME}.`,
      `Log in to add your products and set your city, shipping and returns: ${SITE_URL}/login.html`,
    ]);
  } else {
    sendEmail(to, `${shop.shop_name} was not approved`, [
      `${shop.shop_name} was not approved.`,
      `Reason: ${reason}`,
      `You can log in to read this again: ${SITE_URL}/login.html`,
    ]);
  }
}

// To a seller: a payout was recorded.
function sendPayoutRecorded(sellerId, amount, note) {
  const shop = db.prepare('SELECT shop_name FROM sellers WHERE id = ?').get(sellerId);
  const to = sellerEmail(sellerId);
  if (!to) return;
  sendEmail(to, `Payout of ${formatMoney(amount)} recorded`, [
    `${MARKETPLACE_NAME} recorded a payout of ${formatMoney(amount)} to ${shop.shop_name}.`,
    note ? `Reference: ${note}` : null,
    `See your earnings: ${SITE_URL}/seller/earnings.html`,
  ]);
}

// To a customer who used "Find my orders": every tracking link for that email address.
function sendFindMyOrders(email, orders) {
  sendEmail(email, `Your ${MARKETPLACE_NAME} orders`, [
    'Here are the orders placed with this email address:',
    '',
    ...orders.map((order) => `${order.code}: ${trackingLink(order.tracking_token)}`),
    '',
    'If you did not ask for this email, you can ignore it.',
  ]);
}

module.exports = {
  sendEmail,
  sendOrderConfirmation,
  sendNewOrderToSeller,
  sendPartStopped,
  sendShipped,
  sendDelivered,
  sendRefunded,
  sendPaymentFailed,
  sendShopDecision,
  sendPayoutRecorded,
  sendFindMyOrders,
  trackingLink,
};
