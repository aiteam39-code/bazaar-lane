// payments.js - online payments in TEST MODE only, behind the same three functions:
//   createPayment(customerOrderId) -> starts a payment and says where the customer pays
//   verifyPayment(result)          -> checks the provider's signature on the SERVER, then marks the order paid
//   refund(sellerOrderId)          -> gives back exactly one shop's part of a paid order, once
// Two providers:
//   FakePay (the default, when no Razorpay keys are set): a pretend payment page built into the app, so everything works
//     offline. Its result is signed with a secret that only the server knows (kept in the settings table, never sent).
//   Razorpay test mode: only when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set. server.js refuses to start with a live
//     key (rzp_live_). Every payment signature is checked here, and refunds go through Razorpay's refund API.
// A browser saying "I paid" is never enough: only a valid signature moves an order on.
const crypto = require('crypto');
const https = require('https');
const { db, nowIso } = require('./db');
const { HttpError } = require('./auth');
const { changeStatus } = require('./orderStatus');
const mail = require('./mail');

const KEY_ID = process.env.RAZORPAY_KEY_ID || '';
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || '';
const PROVIDER = KEY_ID && KEY_SECRET ? 'razorpay' : 'fake';
const PAY_WITHIN_MINUTES = 30;

// True when a live (real money) Razorpay key is set. server.js stops the app if so.
function hasLiveKey() {
  return KEY_ID.startsWith('rzp_live_') || (KEY_ID !== '' && !KEY_ID.startsWith('rzp_test_'));
}

// The FakePay secret: made once at random and kept in the settings table. The browser never sees it.
async function fakeSecret() {
  const row = await db.get("SELECT value FROM settings WHERE key = 'fakepay_secret'");
  if (row) return row.value;
  const secret = crypto.randomBytes(32).toString('hex');
  await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('fakepay_secret', ?)", secret);
  return (await db.get("SELECT value FROM settings WHERE key = 'fakepay_secret'")).value;
}

// An HMAC-SHA256 signature, as hex.
function sign(secret, text) {
  return crypto.createHmac('sha256', secret).update(text).digest('hex');
}

// Compares two signatures without leaking how much of them matched.
function sameSignature(a, b) {
  const left = Buffer.from(String(a), 'utf8');
  const right = Buffer.from(String(b), 'utf8');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

// ---------- 1. Start a payment ----------

// Starts the payment of one customer order (its grand total). Returns { paymentId, provider, payUrl } for FakePay,
// or { paymentId, provider, razorpay: { key, order_id, amount, currency, name } } for Razorpay's checkout.
async function createPayment(customerOrderId) {
  const order = await db.get('SELECT * FROM customer_orders WHERE id = ?', customerOrderId);
  const paymentId = Number((await db.run(`
    INSERT INTO payments (customer_order_id, provider, provider_ref, amount, status, created_at)
    VALUES (?, ?, NULL, ?, 'created', ?)`, order.id, PROVIDER, order.grand_total, nowIso())).lastInsertRowid);
  if (PROVIDER === 'fake') {
    const ref = 'fake_order_' + crypto.randomBytes(8).toString('hex');
    await db.run('UPDATE payments SET provider_ref = ? WHERE id = ?', ref, paymentId);
    return { paymentId, provider: 'fake', payUrl: `/pay/fake/${paymentId}` };
  }
  let razorpayOrder;
  try {
    razorpayOrder = await razorpayRequest('POST', '/v1/orders', {
      amount: order.grand_total, currency: 'INR', receipt: order.code, notes: { order_code: order.code },
    });
  } catch (err) {
    await stopUnpaidOrder(await findPayment(paymentId), 'Online payment could not be started.');
    throw new HttpError(502, 'Online payment is not reachable right now. Try again, or choose Cash on delivery.');
  }
  await db.run('UPDATE payments SET provider_ref = ? WHERE id = ?', razorpayOrder.id, paymentId);
  return {
    paymentId,
    provider: 'razorpay',
    razorpay: { key: KEY_ID, order_id: razorpayOrder.id, amount: order.grand_total, currency: 'INR', name: order.code },
  };
}

// ---------- FakePay: the pretend provider ----------

// What the FakePay page shows: the amount and the order code (only for a payment still waiting).
async function fakePaymentInfo(paymentId) {
  const payment = await findPayment(paymentId);
  if (payment.provider !== 'fake') throw new HttpError(404, 'That payment does not exist.');
  const order = await db.get('SELECT code, tracking_token FROM customer_orders WHERE id = ?', payment.customer_order_id);
  return { amount: payment.amount, status: payment.status, code: order.code, tracking_url: '/track/' + order.tracking_token };
}

// FakePay "processes" the payment and hands back a signed result, like a real provider would.
// outcome: 'upi' or 'card' (paid) or 'fail'. The signature uses the server's secret, so nobody can make one up.
async function fakeProviderResult(paymentId, outcome) {
  const payment = await findPayment(paymentId);
  if (payment.provider !== 'fake') throw new HttpError(404, 'That payment does not exist.');
  if (!['upi', 'card', 'fail'].includes(outcome)) throw new HttpError(400, 'Please choose UPI, card or fail.');
  const status = outcome === 'fail' ? 'failed' : 'paid';
  const paidRef = `fake_${outcome}_${crypto.randomBytes(8).toString('hex')}`;
  const text = `${payment.id}|${payment.provider_ref}|${paidRef}|${status}`;
  return { payment_id: payment.id, order_ref: payment.provider_ref, paid_ref: paidRef, status, signature: sign(await fakeSecret(), text) };
}

// ---------- 2. Verify a payment (on the server) ----------

// Checks the provider's signature, then moves the order on: paid -> every shop's part becomes placed (as the system)
// and the emails go out; failed -> the order is cancelled and the stock goes back. A wrong signature is refused (400)
// and changes nothing. Returns { status: 'paid' | 'failed', trackingUrl }.
async function verifyPayment(result) {
  const body = result || {};
  const payment = await findPayment(body.payment_id);
  let status;
  let paidRef;
  if (payment.provider === 'fake') {
    status = body.status === 'paid' ? 'paid' : body.status === 'failed' ? 'failed' : null;
    paidRef = typeof body.paid_ref === 'string' ? body.paid_ref : '';
    const expected = sign(await fakeSecret(), `${payment.id}|${payment.provider_ref}|${paidRef}|${status}`);
    if (!status || typeof body.signature !== 'string' || !sameSignature(body.signature, expected)) {
      throw new HttpError(400, 'This payment result could not be checked, so the order was not marked paid.');
    }
  } else {
    // Razorpay: a failure comes from the checkout page without a signature; success needs a valid one.
    if (body.status === 'failed') {
      status = 'failed';
    } else {
      paidRef = String(body.razorpay_payment_id || '');
      const expected = sign(KEY_SECRET, `${payment.provider_ref}|${paidRef}`);
      if (body.razorpay_order_id !== payment.provider_ref || !sameSignature(body.razorpay_signature || '', expected)) {
        throw new HttpError(400, 'This payment result could not be checked, so the order was not marked paid.');
      }
      status = 'paid';
    }
  }
  const order = await db.get('SELECT * FROM customer_orders WHERE id = ?', payment.customer_order_id);
  const trackingUrl = '/track/' + order.tracking_token;
  if (payment.status !== 'created') return { status: payment.status, trackingUrl }; // already done (a second click)
  if (status === 'paid') await markPaid(payment, paidRef);
  else await stopUnpaidOrder(payment, 'Your payment did not go through.');
  return { status, trackingUrl };
}

// Paid: the payment, then each shop's part (pending_payment -> placed, by the system), then the emails.
async function markPaid(payment, paidRef) {
  const parts = await db.tx(async () => {
    const claimed = await db.run("UPDATE payments SET status = 'paid', paid_ref = ? WHERE id = ? AND status = 'created'",
      paidRef, payment.id);
    if (claimed.changes !== 1) return null; // someone else finished it at the same moment
    const waiting = await db.all("SELECT id FROM seller_orders WHERE customer_order_id = ? AND status = 'pending_payment' ORDER BY id",
      payment.customer_order_id);
    for (const part of waiting) {
      await changeStatus(part.id, 'placed', { role: 'system' });
      await db.run("UPDATE seller_orders SET payment_status = 'paid' WHERE id = ?", part.id);
    }
    return waiting;
  });
  if (!parts) return;
  await mail.sendOrderConfirmation(payment.customer_order_id);
  for (const part of parts) await mail.sendNewOrderToSeller(part.id);
}

// Not paid (failed, or too late): the payment is failed and every part is cancelled by the system (stock back).
async function stopUnpaidOrder(payment, why) {
  const stopped = await db.tx(async () => {
    const claimed = await db.run("UPDATE payments SET status = 'failed' WHERE id = ? AND status = 'created'", payment.id);
    if (claimed.changes !== 1) return false;
    const parts = await db.all("SELECT id FROM seller_orders WHERE customer_order_id = ? AND status = 'pending_payment' ORDER BY id",
      payment.customer_order_id);
    for (const part of parts) await changeStatus(part.id, 'cancelled', { role: 'system' }, { reason: why });
    return true;
  });
  if (stopped) await mail.sendPaymentFailed(payment.customer_order_id, why);
}

// The 30-minute rule: every unpaid online order older than 30 minutes is cancelled and its stock goes back.
// Runs every minute (server.js), and the admin can run it now. Returns how many orders it cancelled.
async function cancelExpiredPayments() {
  const cutoff = new Date(Date.now() - PAY_WITHIN_MINUTES * 60 * 1000).toISOString();
  const expired = await db.all(`
    SELECT payments.* FROM payments JOIN customer_orders ON customer_orders.id = payments.customer_order_id
    WHERE payments.status = 'created' AND customer_orders.created_at < ? ORDER BY payments.id`, cutoff);
  for (const payment of expired) await stopUnpaidOrder(payment, `The payment was not finished within ${PAY_WITHIN_MINUTES} minutes.`);
  return expired.length;
}

// ---------- 3. Refund one shop's part ----------

// Refunds exactly one seller order's total (items + shipping), once, when it was paid online and is now rejected or
// cancelled. The refunds table allows one refund per seller order, so a second refund is impossible. The refund is never
// bigger than what is left of that payment. Returns the refund, or throws a plain message.
async function refund(sellerOrderId) {
  const part = await findPart('SELECT * FROM seller_orders WHERE id = ?', sellerOrderId);
  if (!part) throw new HttpError(404, 'That part of the order does not exist.');
  if (part.status !== 'rejected' && part.status !== 'cancelled') throw new HttpError(400, 'Only a rejected or cancelled part can be refunded.');
  if (part.payment_status === 'refunded') throw new HttpError(400, 'This part was already refunded.');
  if (part.payment_status !== 'paid') throw new HttpError(400, 'This part was not paid online, so there is nothing to refund.');
  const payment = await db.get("SELECT * FROM payments WHERE customer_order_id = ? AND status = 'paid' ORDER BY id DESC LIMIT 1",
    part.customer_order_id);
  if (!payment) throw new HttpError(400, 'No paid payment was found for this order.');
  const amount = part.items_total + part.shipping + part.gift_wrap; // the part's whole total, gift wrap too

  // Claim the refund first (the UNIQUE seller_order_id stops a second one), then ask the provider. The check against
  // what is left of the payment and the claim happen together, one refund of this payment at a time (a lock), so two
  // refunds at the same moment can never add up to more than was paid.
  let refundId;
  try {
    refundId = await db.tx(async () => {
      await db.lock('refund_payment', payment.id);
      const alreadyRefunded = (await db.get('SELECT COALESCE(SUM(amount), 0) AS n FROM refunds WHERE payment_id = ?', payment.id)).n;
      if (amount > payment.amount - alreadyRefunded) throw new HttpError(400, 'The refund would be bigger than what is left of the payment.');
      return Number((await db.run('INSERT INTO refunds (payment_id, seller_order_id, amount, provider_ref, created_at) VALUES (?, ?, ?, NULL, ?)',
        payment.id, part.id, amount, nowIso())).lastInsertRowid);
    });
  } catch (err) {
    if (err.code === 'UNIQUE_VIOLATION') throw new HttpError(400, 'This part was already refunded.');
    throw err;
  }
  try {
    const providerRef = await providerRefund(payment, amount);
    await db.run('UPDATE refunds SET provider_ref = ? WHERE id = ?', providerRef, refundId);
    await db.run("UPDATE seller_orders SET payment_status = 'refunded' WHERE id = ?", part.id);
  } catch (err) {
    await db.run('DELETE FROM refunds WHERE id = ?', refundId); // the order stays cancelled; the admin can try again
    throw new HttpError(502, 'Refund failed, try again.');
  }
  await mail.sendRefunded(part.id, amount);
  return { amount };
}

// The provider's refund: FakePay always works; Razorpay through its refund API.
async function providerRefund(payment, amount) {
  if (payment.provider === 'fake') return 'fake_refund_' + crypto.randomBytes(8).toString('hex');
  const answer = await razorpayRequest('POST', `/v1/payments/${encodeURIComponent(payment.paid_ref)}/refund`, { amount });
  return answer.id;
}

// After a shop's part was rejected or cancelled: if it was paid online, refund it now. A failed refund is shown to the
// admin on the Payments page ("Refund failed, try again"), and never undoes the cancel.
async function refundIfPaid(sellerOrderId) {
  const part = await findPart('SELECT payment_status FROM seller_orders WHERE id = ?', sellerOrderId);
  if (!part || part.payment_status !== 'paid') return null;
  try {
    return await refund(sellerOrderId);
  } catch (err) {
    return { failed: true, message: err.message };
  }
}

// ---------- Helpers ----------

// True for a number that can be a row id (a whole number from 1 up to Postgres's INTEGER limit).
function isRowId(id) {
  return Number.isSafeInteger(id) && id > 0 && id <= 2147483647;
}

// One seller order row (the columns the SQL asks for), or undefined when the id cannot exist.
async function findPart(sql, sellerOrderId) {
  const id = Number(sellerOrderId);
  return isRowId(id) ? db.get(sql, id) : undefined;
}

// The payment with this id, or a 404.
async function findPayment(idValue) {
  const id = Number(idValue);
  const payment = isRowId(id) ? await db.get('SELECT * FROM payments WHERE id = ?', id) : null;
  if (!payment) throw new HttpError(404, 'That payment does not exist.');
  return payment;
}

// One call to Razorpay's API (test keys only), with the key as Basic auth. Resolves with the JSON answer.
function razorpayRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body || {});
    const request = https.request({
      host: 'api.razorpay.com', path, method, timeout: 15000,
      auth: `${KEY_ID}:${KEY_SECRET}`,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        let answer = {};
        try { answer = JSON.parse(text); } catch (e) { /* not JSON */ }
        if (response.statusCode >= 200 && response.statusCode < 300) resolve(answer);
        else reject(new Error((answer.error && answer.error.description) || 'Razorpay said no.'));
      });
    });
    request.on('timeout', () => request.destroy(new Error('Razorpay did not answer in time.')));
    request.on('error', reject);
    request.end(data);
  });
}

module.exports = {
  PROVIDER,
  PAY_WITHIN_MINUTES,
  hasLiveKey,
  createPayment,
  verifyPayment,
  refund,
  refundIfPaid,
  cancelExpiredPayments,
  fakePaymentInfo,
  fakeProviderResult,
};
