// routes/checkout.js - the cart and the checkout.
// The browser only sends product ids and quantities. The server looks up every price, works out every total,
// shipping fee and commission, takes the stock off and saves the order, all in ONE transaction.
// Any price or total the browser sends is ignored.
const crypto = require('crypto');
const express = require('express');
const { db, nowIso, photoUrl } = require('../db');
const auth = require('../auth');
const { commissionFor, shippingFor } = require('../money');
const { firstStatusFor, logFirstStatus } = require('../orderStatus');
const mail = require('../mail');
const payments = require('../payments');
const { phoneIsChecked } = require('./payments');

const router = express.Router();
const { HttpError } = auth;

const MOST_LINES = 50;        // the most different products one cart may hold
const MOST_OF_ONE_PRODUCT = 20; // quantity is 1 to 20

// Prices a cart for the cart and checkout pages: the products grouped by shop, each shop's shipping and totals,
// and the grand total. Products that cannot be bought come back in "problems", each with a message naming the product.
router.post('/api/cart', (req, res) => {
  const lines = readCartLines((req.body || {}).items, true);
  res.json(cartForCustomers(priceCart(lines)));
});

// What the checkout page may offer: Cash on delivery while the admin has it switched on. Paying online comes in sector 4.
router.get('/api/checkout/options', (req, res) => {
  res.json({ cod_enabled: codIsSwitchedOn(), online_enabled: true, provider: payments.PROVIDER });
});

// Places an order: one customer order with one seller order per shop. Answers with the order code and the tracking link.
router.post('/api/checkout', async (req, res) => {
  const body = req.body || {};
  const customer = readCustomerDetails(body);
  const paymentMethod = readPaymentMethod(body.payment_method);
  if (paymentMethod === 'cod' && !phoneIsChecked(customer.phone, body.phone_token)) {
    throw new HttpError(400, 'Please check your phone with the code we send, then place the order.');
  }
  const lines = readCartLines(body.items, false);
  const order = placeOrder.immediate(customer, paymentMethod, lines);
  if (paymentMethod === 'cod') {
    sendOrderEmails(order.id);
    return res.status(201).json({ ok: true, code: order.code, tracking_url: '/track/' + order.token, grand_total: order.grandTotal });
  }
  // Online: the order waits as pending_payment (stock reserved, sellers cannot see it) until the payment is verified.
  const payment = await payments.createPayment(order.id);
  res.status(201).json({
    ok: true, code: order.code, tracking_url: '/track/' + order.token, grand_total: order.grandTotal,
    payment: { id: payment.paymentId, provider: payment.provider, pay_url: payment.payUrl || null, razorpay: payment.razorpay || null },
  });
});

// ---------- Reading what the customer sent ----------

// Name, 10-digit phone, email and address. Throws a plain message for the first problem.
function readCustomerDetails(body) {
  const name = auth.cleanText(body.customer_name).replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Please enter your name (2 to 60 characters).');
  const phone = auth.cleanPhone(body.phone);
  if (!auth.isValidPhone(phone)) throw new HttpError(400, 'Phone must be exactly 10 digits.');
  const email = auth.cleanEmail(body.email);
  if (!auth.isValidEmail(email)) throw new HttpError(400, 'Please enter a valid email, like name@example.com.');
  const address = auth.cleanText(body.address).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
  if (address.length < 10 || address.length > 300) {
    throw new HttpError(400, 'Please enter your full delivery address (10 to 300 characters).');
  }
  return { name, phone, email, address };
}

// "cod" (Cash on delivery, only while the admin has it switched on). Paying online comes in sector 4.
function readPaymentMethod(value) {
  if (value === 'cod') {
    if (!codIsSwitchedOn()) throw new HttpError(400, 'Cash on delivery is switched off right now.');
    return 'cod';
  }
  if (value === 'online') return 'online';
  throw new HttpError(400, 'Please choose how you will pay.');
}

// True while the admin has cash on delivery switched on.
function codIsSwitchedOn() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'cod_enabled'").get();
  return Boolean(row) && row.value === '1';
}

// The cart lines as [{ productId, quantity }]. The same product twice is added together. An empty cart is allowed
// only when the cart page asks for prices (allowEmpty), never at checkout.
function readCartLines(value, allowEmpty) {
  if (value === undefined && allowEmpty) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'The cart was not sent in the right form.');
  if (value.length === 0) {
    if (allowEmpty) return [];
    throw new HttpError(400, 'Your cart is empty. Please add a product first.');
  }
  if (value.length > MOST_LINES) throw new HttpError(400, `Your cart can hold at most ${MOST_LINES} different products.`);
  const quantities = new Map(); // product id -> quantity
  for (const line of value) {
    const productId = readProductId(line);
    const quantity = readQuantity(line, productId);
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  return [...quantities].map(([productId, quantity]) => {
    if (quantity > MOST_OF_ONE_PRODUCT) throw new HttpError(400, quantityMessage(productId));
    return { productId, quantity };
  });
}

// The product id of one cart line, or a 400.
function readProductId(line) {
  const value = line && typeof line === 'object' ? line.product_id : undefined;
  const id = auth.readId(typeof value === 'number' ? String(value) : value);
  if (!id) throw new HttpError(400, 'A product in your cart is not valid. Please remove it and add it again.');
  return id;
}

// The quantity of one cart line: a whole number from 1 to 20, or a 400 that names the product.
function readQuantity(line, productId) {
  const value = line.quantity;
  let quantity = NaN;
  if (typeof value === 'number') quantity = value;
  if (typeof value === 'string' && /^\s*\d{1,3}\s*$/.test(value)) quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MOST_OF_ONE_PRODUCT) {
    throw new HttpError(400, quantityMessage(productId));
  }
  return quantity;
}

// "Quantity must be 1 to 20 for Green Chilli Pickle."
function quantityMessage(productId) {
  const product = db.prepare('SELECT name FROM products WHERE id = ?').get(productId);
  const forWhat = product ? ` for ${product.name}` : '';
  return `Quantity must be a whole number from 1 to ${MOST_OF_ONE_PRODUCT}${forWhat}.`;
}

// ---------- Pricing the cart (the same for the cart page and for checkout) ----------

// Looks up every product, keeps the ones that can be bought, groups them by shop and works out every total.
function priceCart(lines) {
  const groupsByShop = new Map();
  const problems = [];
  for (const line of lines) {
    const product = findProductForCart(line.productId);
    const problem = whyItCannotBeBought(product, line.quantity);
    if (problem) {
      problems.push({ product_id: line.productId, name: product ? product.name : null, message: problem.message, left: problem.left });
      continue;
    }
    const group = groupFor(groupsByShop, product);
    const lineTotal = product.price * line.quantity;
    group.lines.push({
      product_id: product.id, name: product.name, photo_url: photoUrl(product.photo),
      unit_price: product.price, quantity: line.quantity, line_total: lineTotal,
    });
    group.items_total += lineTotal;
  }
  const groups = [...groupsByShop.values()].sort((a, b) => a.shop_name.localeCompare(b.shop_name));
  for (const group of groups) {
    group.shipping = shippingFor(group.items_total, group.shipping_fee, group.free_shipping_over);
    group.total = group.items_total + group.shipping;
  }
  const itemsTotal = groups.reduce((sum, group) => sum + group.items_total, 0);
  const shippingTotal = groups.reduce((sum, group) => sum + group.shipping, 0);
  return { groups, problems, items_total: itemsTotal, shipping_total: shippingTotal, grand_total: itemsTotal + shippingTotal };
}

// A product with its shop's details, or undefined.
function findProductForCart(productId) {
  return db.prepare(`
    SELECT products.id, products.name, products.photo, products.price, products.stock,
           products.active, products.deleted, products.hidden, products.seller_id,
           sellers.shop_name, sellers.slug AS shop_slug, sellers.status AS shop_status,
           sellers.shipping_fee, sellers.free_shipping_over, sellers.dispatch_days
    FROM products JOIN sellers ON sellers.id = products.seller_id
    WHERE products.id = ?`).get(productId);
}

// Why this product cannot be bought in this quantity right now, or null when it can. The message names the product;
// "left" says how many there are when there are just not enough (so the cart can offer to lower the quantity).
function whyItCannotBeBought(product, quantity) {
  if (!product) return { message: 'A product in your cart is not sold any more. Please remove it.', left: null };
  if (product.deleted) return { message: `${product.name} is not sold any more. Please remove it.`, left: null };
  if (product.shop_status !== 'active') {
    return { message: `${product.name} cannot be bought right now: its shop is not available.`, left: null };
  }
  if (!product.active || product.hidden) return { message: `${product.name} is not for sale right now. Please remove it.`, left: null };
  if (product.stock === 0) return { message: `${product.name} is sold out. Please remove it.`, left: null };
  if (product.stock < quantity) {
    return { message: `Only ${product.stock} of ${product.name} left. Please lower the quantity.`, left: product.stock };
  }
  return null;
}

// The group of this product's shop (made the first time).
function groupFor(groupsByShop, product) {
  if (!groupsByShop.has(product.seller_id)) {
    groupsByShop.set(product.seller_id, {
      seller_id: product.seller_id, shop_name: product.shop_name, shop_slug: product.shop_slug,
      shipping_fee: product.shipping_fee, free_shipping_over: product.free_shipping_over,
      delivery: { from_days: product.dispatch_days + 2, to_days: product.dispatch_days + 5 },
      lines: [], items_total: 0, shipping: 0, total: 0,
    });
  }
  return groupsByShop.get(product.seller_id);
}

// The priced cart as customers get it (without the shops' ids).
function cartForCustomers(priced) {
  return {
    groups: priced.groups.map(({ seller_id, ...group }) => group),
    problems: priced.problems,
    items_total: priced.items_total,
    shipping_total: priced.shipping_total,
    grand_total: priced.grand_total,
  };
}

// ---------- Saving the order ----------

// Saves one customer order with one seller order per shop, and takes the stock off: all of it, or none of it.
// It runs as one "immediate" transaction, so no other order can change the stock in the middle.
const placeOrder = db.transaction((customer, paymentMethod, lines) => {
  const priced = priceCart(lines);
  if (priced.problems.length > 0) throw new HttpError(400, priced.problems[0].message);

  const token = crypto.randomBytes(32).toString('hex'); // the long random part of the private tracking link
  const now = nowIso();
  const orderId = Number(db.prepare(`
    INSERT INTO customer_orders (code, tracking_token, customer_name, phone, email, address, payment_method,
                                 items_total, shipping_total, grand_total, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('new-' + token, token, customer.name, customer.phone, customer.email, customer.address, paymentMethod,
      priced.items_total, priced.shipping_total, priced.grand_total, now).lastInsertRowid);
  const code = 'BZ-' + (1000 + orderId); // the first order is BZ-1001
  db.prepare('UPDATE customer_orders SET code = ? WHERE id = ?').run(code, orderId);

  for (const group of priced.groups) addSellerOrder(orderId, group, paymentMethod, now);
  return { id: orderId, code, token, grandTotal: priced.grand_total };
});

// One shop's part: its totals, the commission rate copied in, its items (names and prices copied in), the stock
// taken off, and its first status.
function addSellerOrder(orderId, group, paymentMethod, now) {
  const rate = commissionRateFor(group.seller_id);
  const status = firstStatusFor(paymentMethod);
  const sellerOrderId = Number(db.prepare(`
    INSERT INTO seller_orders (customer_order_id, seller_id, status, items_total, shipping, commission_bps, commission,
                               payment_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`)
    .run(orderId, group.seller_id, status, group.items_total, group.shipping, rate,
      commissionFor(group.items_total, rate), now, now).lastInsertRowid);
  for (const line of group.lines) {
    takeStock(line);
    db.prepare(`
      INSERT INTO order_items (seller_order_id, product_id, name, unit_price, quantity, line_total)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(sellerOrderId, line.product_id, line.name, line.unit_price, line.quantity, line.line_total);
  }
  logFirstStatus(sellerOrderId, status);
}

// Takes the items off the stock. The update itself checks stock >= quantity (and that the product is still for sale),
// so two customers can never both buy the last item. If it fails, the whole order is undone.
function takeStock(line) {
  const result = db.prepare(`
    UPDATE products SET stock = stock - ?
    WHERE id = ? AND stock >= ? AND active = 1 AND deleted = 0 AND hidden = 0`)
    .run(line.quantity, line.product_id, line.quantity);
  if (result.changes !== 1) throw new HttpError(409, `Sorry, ${line.name} just sold out. Please look at your cart again.`);
}

// The early-bird rate, while the shop is in the early-bird group and inside its days since approval; else null.
function earlyBirdRateFor(shop) {
  if (!shop.early_bird || !shop.approved_at) return null;
  const setting = (key) => Number(db.prepare('SELECT value FROM settings WHERE key = ?').get(key).value);
  const endsAt = new Date(shop.approved_at).getTime() + setting('early_bird_days') * 24 * 60 * 60 * 1000;
  return Date.now() < endsAt ? setting('early_bird_bps') : null;
}

// The confirmation to the customer and a "new order" email to each shop (only its own part).
function sendOrderEmails(customerOrderId) {
  mail.sendOrderConfirmation(customerOrderId);
  for (const part of db.prepare('SELECT id FROM seller_orders WHERE customer_order_id = ?').all(customerOrderId)) {
    mail.sendNewOrderToSeller(part.id);
  }
}

// The commission rate copied into a new seller order, and why: the shop's own rate if set; else the early-bird rate
// (see earlyBirdRateFor); else the rate of the shop's category, which is the category most of its (not deleted)
// products are in (on a tie, the lower rate); else the default. Returns { bps, why, until }.
function commissionRateWithReason(sellerId) {
  const shop = db.prepare('SELECT commission_bps, early_bird, approved_at FROM sellers WHERE id = ?').get(sellerId);
  if (shop.commission_bps !== null) return { bps: shop.commission_bps, why: 'own rate' };
  const earlyBird = earlyBirdRateFor(shop);
  if (earlyBird !== null) return { bps: earlyBird, why: 'early bird', until: earlyBirdEnd(shop) };
  const shopCategory = db.prepare(`
    SELECT categories.name, categories.commission_bps
    FROM products JOIN categories ON categories.id = products.category_id
    WHERE products.seller_id = ? AND products.deleted = 0
    GROUP BY categories.id
    ORDER BY COUNT(*) DESC, categories.commission_bps IS NULL, categories.commission_bps ASC
    LIMIT 1`).get(sellerId);
  if (shopCategory && shopCategory.commission_bps !== null) return { bps: shopCategory.commission_bps, why: `category (${shopCategory.name})` };
  return { bps: defaultCommissionRate(), why: 'default' };
}

function commissionRateFor(sellerId) {
  return commissionRateWithReason(sellerId).bps;
}

// When a shop's early-bird days end (its approval date + the offer's days).
function earlyBirdEnd(shop) {
  const days = Number(db.prepare("SELECT value FROM settings WHERE key = 'early_bird_days'").get().value);
  return new Date(new Date(shop.approved_at).getTime() + days * 86400000).toISOString();
}

function defaultCommissionRate() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'default_commission_bps'").get();
  const rate = row ? Number(row.value) : NaN;
  return Number.isInteger(rate) && rate >= 0 && rate <= 10000 ? rate : 1000;
}

module.exports = router;
module.exports.sendOrderEmails = sendOrderEmails;
module.exports.earlyBirdRateFor = earlyBirdRateFor;
module.exports.commissionRateWithReason = commissionRateWithReason;
