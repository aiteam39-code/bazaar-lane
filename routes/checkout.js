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
const { currentSeason } = require('../seasons');
const { phoneIsChecked } = require('./payments');

const router = express.Router();
const { HttpError } = auth;

const MOST_LINES = 50;        // the most different products one cart may hold
const MOST_OF_ONE_PRODUCT = 20; // quantity is 1 to 20

// Prices a cart for the cart and checkout pages: the products grouped by shop, each shop's shipping and totals,
// and the grand total. Products that cannot be bought come back in "problems", each with a message naming the product.
router.post('/api/cart', async (req, res) => {
  const body = req.body || {};
  const lines = await readCartLines(body.items, true);
  const gifts = await readGifts(body.gifts);
  res.json(await cartForCustomers(await priceCart(lines, gifts)));
});

// What the checkout page may offer: Cash on delivery while the admin has it switched on. Paying online comes in sector 4.
router.get('/api/checkout/options', async (req, res) => {
  const season = await currentSeason();
  res.json({ cod_enabled: await codIsSwitchedOn(), online_enabled: true, provider: payments.PROVIDER, gift_options: Boolean(season), season: season ? season.key : null });
});

// Places an order: one customer order with one seller order per shop. Answers with the order code and the tracking link.
router.post('/api/checkout', async (req, res) => {
  const body = req.body || {};
  const customer = readCustomerDetails(body);
  const paymentMethod = await readPaymentMethod(body.payment_method);
  if (paymentMethod === 'cod' && !(await phoneIsChecked(customer.phone, body.phone_token))) {
    throw new HttpError(400, 'Please check your phone with the code we send, then place the order.');
  }
  const lines = await readCartLines(body.items, false);
  const gifts = await readGifts(body.gifts);
  const order = await placeOrder(customer, paymentMethod, lines, gifts);
  if (paymentMethod === 'cod') {
    await sendOrderEmails(order.id);
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

// Gift options, per shop: { "<shop slug>": { wrap: true or false, message: "..." } }. They are only offered while a
// season is on; otherwise they are ignored. The browser never sends a price: the server uses the shop's own
// gift-wrap price. A message is at most 200 characters.
async function readGifts(value) {
  if (!(await currentSeason()) || !value || typeof value !== 'object' || Array.isArray(value)) return {};
  const gifts = {};
  for (const [slug, choice] of Object.entries(value).slice(0, MOST_LINES)) {
    if (!choice || typeof choice !== 'object') continue;
    const message = auth.cleanText(choice.message);
    if (message.length > 200) throw new HttpError(400, 'A gift message can be at most 200 characters.');
    gifts[String(slug)] = { wrap: choice.wrap === true, message };
  }
  return gifts;
}

// Name, 10-digit phone, email and address. Throws a plain message for the first problem.
function readCustomerDetails(body) {
  const name = auth.cleanText(body.customer_name).replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Please enter your name (2 to 60 characters).');
  const phone = auth.cleanPhone(body.phone);
  if (!auth.isValidPhone(phone)) throw new HttpError(400, 'Phone must be exactly 10 digits. Type your mobile number without +91.');
  const email = auth.cleanEmail(body.email);
  if (!auth.isValidEmail(email)) throw new HttpError(400, 'Please enter a valid email, like name@example.com.');
  const address = auth.cleanText(body.address).replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n');
  if (address.length < 10 || address.length > 300) {
    throw new HttpError(400, 'Please enter your full delivery address (10 to 300 characters).');
  }
  return { name, phone, email, address };
}

// "cod" (Cash on delivery, only while the admin has it switched on). Paying online comes in sector 4.
async function readPaymentMethod(value) {
  if (value === 'cod') {
    if (!(await codIsSwitchedOn())) throw new HttpError(400, 'Cash on delivery is switched off right now. Choose Pay online.');
    return 'cod';
  }
  if (value === 'online') return 'online';
  throw new HttpError(400, 'Please choose how you will pay.');
}

// True while the admin has cash on delivery switched on.
async function codIsSwitchedOn() {
  const row = await db.get("SELECT value FROM settings WHERE key = 'cod_enabled'");
  return Boolean(row) && row.value === '1';
}

// The cart lines as [{ productId, quantity }]. The same product twice is added together. An empty cart is allowed
// only when the cart page asks for prices (allowEmpty), never at checkout.
async function readCartLines(value, allowEmpty) {
  if (value === undefined && allowEmpty) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'Something went wrong with your bag. Reload the page and try again.');
  if (value.length === 0) {
    if (allowEmpty) return [];
    throw new HttpError(400, 'Your bag is empty. Add a product first.');
  }
  if (value.length > MOST_LINES) throw new HttpError(400, `Your bag can hold at most ${MOST_LINES} different products. Remove some first.`);
  const quantities = new Map(); // product id -> quantity
  for (const line of value) {
    const productId = readProductId(line);
    const quantity = await readQuantity(line, productId);
    quantities.set(productId, (quantities.get(productId) || 0) + quantity);
  }
  const lines = [];
  for (const [productId, quantity] of quantities) {
    if (quantity > MOST_OF_ONE_PRODUCT) throw new HttpError(400, await quantityMessage(productId));
    lines.push({ productId, quantity });
  }
  return lines;
}

// The product id of one cart line, or a 400.
function readProductId(line) {
  const value = line && typeof line === 'object' ? line.product_id : undefined;
  const id = auth.readId(typeof value === 'number' ? String(value) : value);
  if (!id) throw new HttpError(400, 'A product in your bag is not valid. Please remove it and add it again.');
  return id;
}

// The quantity of one cart line: a whole number from 1 to 20, or a 400 that names the product.
async function readQuantity(line, productId) {
  const value = line.quantity;
  let quantity = NaN;
  if (typeof value === 'number') quantity = value;
  if (typeof value === 'string' && /^\s*\d{1,3}\s*$/.test(value)) quantity = Number(value);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MOST_OF_ONE_PRODUCT) {
    throw new HttpError(400, await quantityMessage(productId));
  }
  return quantity;
}

// "Quantity must be 1 to 20 for Green Chilli Pickle."
async function quantityMessage(productId) {
  const product = await db.get('SELECT name FROM products WHERE id = ?', productId);
  const forWhat = product ? ` for ${product.name}` : '';
  return `Quantity must be a whole number from 1 to ${MOST_OF_ONE_PRODUCT}${forWhat}.`;
}

// ---------- Pricing the cart (the same for the cart page and for checkout) ----------

// Looks up every product, keeps the ones that can be bought, groups them by shop and works out every total.
async function priceCart(lines, gifts = {}) {
  const groupsByShop = new Map();
  const problems = [];
  for (const line of lines) {
    const product = await findProductForCart(line.productId);
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
    const gift = gifts[group.shop_slug] || { wrap: false, message: '' };
    if (gift.wrap && group.gift_wrap_price === 0) throw new HttpError(400, `${group.shop_name} does not offer gift wrap.`);
    group.gift_wrap = gift.wrap ? group.gift_wrap_price : 0; // the shop's own price, never the browser's
    group.gift_message = gift.message || '';
    group.total = group.items_total + group.shipping + group.gift_wrap;
  }
  const itemsTotal = groups.reduce((sum, group) => sum + group.items_total, 0);
  const shippingTotal = groups.reduce((sum, group) => sum + group.shipping, 0);
  const giftWrapTotal = groups.reduce((sum, group) => sum + group.gift_wrap, 0);
  return { groups, problems, items_total: itemsTotal, shipping_total: shippingTotal, gift_wrap_total: giftWrapTotal,
    grand_total: itemsTotal + shippingTotal + giftWrapTotal };
}

// A product with its shop's details, or undefined.
async function findProductForCart(productId) {
  return db.get(`
    SELECT products.id, products.name, products.photo, products.price, products.stock,
           products.active, products.deleted, products.hidden, products.seller_id,
           sellers.shop_name, sellers.slug AS shop_slug, sellers.city AS shop_city, sellers.status AS shop_status,
           sellers.shipping_fee, sellers.free_shipping_over, sellers.dispatch_days, sellers.gift_wrap_price
    FROM products JOIN sellers ON sellers.id = products.seller_id
    WHERE products.id = ?`, productId);
}

// Why this product cannot be bought in this quantity right now, or null when it can. The message names the product;
// "left" says how many there are when there are just not enough (so the cart can offer to lower the quantity).
function whyItCannotBeBought(product, quantity) {
  if (!product) return { message: 'A product in your bag is not sold any more. Please remove it.', left: null };
  if (product.deleted) return { message: `${product.name} is not sold any more. Please remove it.`, left: null };
  if (product.shop_status !== 'active') {
    return { message: `${product.name} cannot be bought right now: its shop is not available. Please remove it.`, left: null };
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
      seller_id: product.seller_id, shop_name: product.shop_name, shop_slug: product.shop_slug, city: product.shop_city,
      shipping_fee: product.shipping_fee, free_shipping_over: product.free_shipping_over,
      delivery: { from_days: product.dispatch_days + 2, to_days: product.dispatch_days + 5 },
      gift_wrap_price: product.gift_wrap_price,
      lines: [], items_total: 0, shipping: 0, total: 0,
    });
  }
  return groupsByShop.get(product.seller_id);
}

// The priced cart as customers get it (without the shops' ids).
async function cartForCustomers(priced) {
  return {
    groups: priced.groups.map(({ seller_id, ...group }) => group),
    problems: priced.problems,
    items_total: priced.items_total,
    shipping_total: priced.shipping_total,
    gift_wrap_total: priced.gift_wrap_total,
    grand_total: priced.grand_total,
    gift_options: Boolean(await currentSeason()),
  };
}

// ---------- Saving the order ----------

// Saves one customer order with one seller order per shop, and takes the stock off: all of it, or none of it.
// It runs as one transaction: the stock is taken with updates that check it is still there (in product id order, so two
// checkouts never wait for each other in a circle), and any problem undoes everything.
async function placeOrder(customer, paymentMethod, lines, gifts) {
  return db.tx(async () => {
    const priced = await priceCart(lines, gifts);
    if (priced.problems.length > 0) throw new HttpError(400, priced.problems[0].message);

    const allLines = priced.groups.flatMap((group) => group.lines).sort((a, b) => a.product_id - b.product_id);
    for (const line of allLines) await takeStock(line);

    const token = crypto.randomBytes(32).toString('hex'); // the long random part of the private tracking link
    const now = nowIso();
    const orderId = Number((await db.run(`
      INSERT INTO customer_orders (code, tracking_token, customer_name, phone, email, address, payment_method,
                                   items_total, shipping_total, gift_wrap_total, grand_total, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    'new-' + token, token, customer.name, customer.phone, customer.email, customer.address, paymentMethod,
    priced.items_total, priced.shipping_total, priced.gift_wrap_total, priced.grand_total, now)).lastInsertRowid);
    const code = 'BZ-' + (1000 + orderId); // the first order is BZ-1001
    await db.run('UPDATE customer_orders SET code = ? WHERE id = ?', code, orderId);

    for (const group of priced.groups) await addSellerOrder(orderId, group, paymentMethod, now);
    return { id: orderId, code, token, grandTotal: priced.grand_total };
  });
}

// One shop's part: its totals, the commission rate copied in, its items (names and prices copied in) and its first
// status. (The stock was already taken off by placeOrder.)
async function addSellerOrder(orderId, group, paymentMethod, now) {
  const rate = await commissionRateFor(group.seller_id);
  const status = firstStatusFor(paymentMethod);
  const sellerOrderId = Number((await db.run(`
    INSERT INTO seller_orders (customer_order_id, seller_id, status, items_total, shipping, gift_wrap, gift_message,
                               commission_bps, commission, payment_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?, ?)`,
  orderId, group.seller_id, status, group.items_total, group.shipping, group.gift_wrap, group.gift_message || null, rate,
  commissionFor(group.items_total, rate), now, now)).lastInsertRowid);
  for (const line of group.lines) {
    await db.run(`
      INSERT INTO order_items (seller_order_id, product_id, name, unit_price, quantity, line_total)
      VALUES (?, ?, ?, ?, ?, ?)`,
    sellerOrderId, line.product_id, line.name, line.unit_price, line.quantity, line.line_total);
  }
  await logFirstStatus(sellerOrderId, status);
}

// Takes the items off the stock. The update itself checks stock >= quantity (and that the product is still for sale),
// so two customers can never both buy the last item. If it fails, the whole order is undone.
async function takeStock(line) {
  const result = await db.run(`
    UPDATE products SET stock = stock - ?
    WHERE id = ? AND stock >= ? AND active = 1 AND deleted = 0 AND hidden = 0`,
  line.quantity, line.product_id, line.quantity);
  if (result.changes === 1) return;
  // Someone else bought the last ones a moment ago: say so the same way the bag does (the whole order is undone).
  const now = await db.get('SELECT stock FROM products WHERE id = ?', line.product_id);
  const left = now ? now.stock : 0;
  if (left === 0) throw new HttpError(400, `${line.name} is sold out. Please remove it.`);
  throw new HttpError(400, `Only ${left} of ${line.name} left. Please lower the quantity.`);
}

// The early-bird rate, while the shop is in the early-bird group and inside its days since approval; else null.
async function earlyBirdRateFor(shop) {
  if (!shop.early_bird || !shop.approved_at) return null;
  const setting = async (key) => Number((await db.get('SELECT value FROM settings WHERE key = ?', key)).value);
  const endsAt = new Date(shop.approved_at).getTime() + (await setting('early_bird_days')) * 24 * 60 * 60 * 1000;
  return Date.now() < endsAt ? await setting('early_bird_bps') : null;
}

// The confirmation to the customer and a "new order" email to each shop (only its own part).
async function sendOrderEmails(customerOrderId) {
  await mail.sendOrderConfirmation(customerOrderId);
  for (const part of await db.all('SELECT id FROM seller_orders WHERE customer_order_id = ?', customerOrderId)) {
    await mail.sendNewOrderToSeller(part.id);
  }
}

// The commission rate copied into a new seller order, and why: the shop's own rate if set; else the early-bird rate
// (see earlyBirdRateFor); else the rate of the shop's category, which is the category most of its (not deleted)
// products are in (on a tie, the lower rate); else the default. Returns { bps, why, until }.
async function commissionRateWithReason(sellerId) {
  const shop = await db.get('SELECT commission_bps, early_bird, approved_at FROM sellers WHERE id = ?', sellerId);
  if (shop.commission_bps !== null) return { bps: shop.commission_bps, why: 'own rate' };
  const earlyBird = await earlyBirdRateFor(shop);
  if (earlyBird !== null) return { bps: earlyBird, why: 'early bird', until: await earlyBirdEnd(shop) };
  const shopCategory = await db.get(`
    SELECT categories.name, categories.commission_bps
    FROM products JOIN categories ON categories.id = products.category_id
    WHERE products.seller_id = ? AND products.deleted = 0
    GROUP BY categories.id
    ORDER BY COUNT(*) DESC, categories.commission_bps IS NULL, categories.commission_bps ASC
    LIMIT 1`, sellerId);
  if (shopCategory && shopCategory.commission_bps !== null) return { bps: shopCategory.commission_bps, why: `category (${shopCategory.name})` };
  return { bps: await defaultCommissionRate(), why: 'default' };
}

// Just the rate (basis points) for a new seller order.
async function commissionRateFor(sellerId) {
  return (await commissionRateWithReason(sellerId)).bps;
}

// When a shop's early-bird days end (its approval date + the offer's days).
async function earlyBirdEnd(shop) {
  const days = Number((await db.get("SELECT value FROM settings WHERE key = 'early_bird_days'")).value);
  return new Date(new Date(shop.approved_at).getTime() + days * 86400000).toISOString();
}

// The platform's default rate (basis points); 10% if the setting is missing or broken.
async function defaultCommissionRate() {
  const row = await db.get("SELECT value FROM settings WHERE key = 'default_commission_bps'");
  const rate = row ? Number(row.value) : NaN;
  return Number.isInteger(rate) && rate >= 0 && rate <= 10000 ? rate : 1000;
}

module.exports = router;
module.exports.sendOrderEmails = sendOrderEmails;
module.exports.earlyBirdRateFor = earlyBirdRateFor;
module.exports.commissionRateWithReason = commissionRateWithReason;
