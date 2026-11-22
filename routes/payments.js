// routes/payments.js - paying online (test mode), the FakePay page, the phone code before cash on delivery, and the
// admin's Payments page (every payment and refund, the split per shop, the cash-on-delivery switch, the 30-minute check).
const crypto = require('crypto');
const express = require('express');
const { db, nowIso } = require('../db');
const auth = require('../auth');
const payments = require('../payments');
const mail = require('../mail');
const { sendPage, pageTitle } = require('../pages');

const router = express.Router();
const { HttpError } = auth;
const CODE_MINUTES = 10;       // a phone code works for 10 minutes
const RESEND_SECONDS = 30;     // a new code can be asked for after 30 seconds
const MOST_CODE_TRIES = 5;     // 5 wrong codes and a new one is needed
const VERIFIED_MINUTES = 30;   // a checked phone can place cash-on-delivery orders for 30 minutes

// ---------- FakePay (only used when no Razorpay keys are set) ----------

// The FakePay page: the amount and three buttons (UPI, card, fail).
router.get('/pay/fake/:id', (req, res) => {
  sendPage(res, 'pay.html', { title: pageTitle('Pay (test)'), description: 'A pretend payment page for testing.' });
});

// What the FakePay page shows.
router.get('/api/pay/fake/:id', (req, res) => {
  res.json(payments.fakePaymentInfo(req.params.id));
});

// FakePay "processes" the payment and hands back a result signed with the server's secret, like a real provider.
router.post('/api/pay/fake/:id', (req, res) => {
  res.json(payments.fakeProviderResult(req.params.id, String((req.body || {}).outcome || '')));
});

// The result of a payment (from FakePay or Razorpay's checkout) comes back here. Only a valid signature counts.
router.post('/api/payments/verify', (req, res) => {
  const result = payments.verifyPayment(req.body || {});
  const paid = result.status === 'paid';
  res.json({
    ok: true,
    status: result.status,
    tracking_url: result.trackingUrl + (paid ? '?new=1' : ''),
    message: paid ? 'Payment received. Thank you.' : 'Payment declined. Try another card or UPI.',
  });
});

// ---------- The phone code before a cash-on-delivery order ----------

// Sends a 6-digit code to the phone. There is no SMS service: the "SMS" goes into the outbox, and in this test app
// the page also shows it, marked as a test SMS.
router.post('/api/checkout/phone-code', (req, res) => {
  const phone = auth.cleanPhone((req.body || {}).phone);
  if (!auth.isValidPhone(phone)) throw new HttpError(400, 'Phone must be exactly 10 digits.');
  const old = db.prepare('SELECT sent_at FROM phone_codes WHERE phone = ?').get(phone);
  if (old && Date.now() - Date.parse(old.sent_at) < RESEND_SECONDS * 1000) {
    throw new HttpError(429, `A code was just sent. You can ask for a new one after ${RESEND_SECONDS} seconds.`);
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const now = new Date();
  db.prepare(`
    INSERT INTO phone_codes (phone, code_hash, sent_at, expires_at, tries, verify_token, verified_until)
    VALUES (?, ?, ?, ?, 0, NULL, NULL)
    ON CONFLICT (phone) DO UPDATE SET code_hash = excluded.code_hash, sent_at = excluded.sent_at,
      expires_at = excluded.expires_at, tries = 0, verify_token = NULL, verified_until = NULL`)
    .run(phone, codeHash(phone, code), now.toISOString(), new Date(now.getTime() + CODE_MINUTES * 60000).toISOString());
  mail.sendEmail(`SMS to ${phone}`, 'Your Bazaar Lane code', [`Your Bazaar Lane code is ${code}. It works for ${CODE_MINUTES} minutes.`]);
  res.json({ ok: true, message: `We sent a 6-digit code to the phone ending ${phone.slice(-4)}.`, test_sms: code });
});

// Checks the code. Right: the phone is checked for 30 minutes, with a token only this browser gets.
router.post('/api/checkout/phone-verify', (req, res) => {
  const body = req.body || {};
  const phone = auth.cleanPhone(body.phone);
  const code = String(body.code || '');
  const row = db.prepare('SELECT * FROM phone_codes WHERE phone = ?').get(phone);
  if (!row || Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, 'That code has run out. Ask for a new code.');
  if (row.tries >= MOST_CODE_TRIES) throw new HttpError(429, 'Too many wrong codes. Ask for a new code.');
  if (!/^\d{6}$/.test(code) || codeHash(phone, code) !== row.code_hash) {
    db.prepare('UPDATE phone_codes SET tries = tries + 1 WHERE phone = ?').run(phone);
    const left = MOST_CODE_TRIES - row.tries - 1;
    throw new HttpError(400, left > 0 ? `That code didn't match. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code didn\'t match. Ask for a new code.');
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.prepare('UPDATE phone_codes SET verify_token = ?, verified_until = ? WHERE phone = ?')
    .run(token, new Date(Date.now() + VERIFIED_MINUTES * 60000).toISOString(), phone);
  res.json({ ok: true, phone_token: token, message: 'Phone checked.' });
});

// True when this phone was checked with this token in the last 30 minutes (checkout asks before a COD order).
function phoneIsChecked(phone, token) {
  const row = db.prepare('SELECT verify_token, verified_until FROM phone_codes WHERE phone = ?').get(phone);
  return Boolean(row && row.verify_token && typeof token === 'string' && token === row.verify_token
    && Date.parse(row.verified_until) > Date.now());
}

// The code is never saved, only its hash.
function codeHash(phone, code) {
  return crypto.createHash('sha256').update(`${phone}|${code}`).digest('hex');
}

// ---------- Admin ----------

// Every payment (newest 200), each with its order, its refunds and how it splits per shop (that shop's total, the
// platform's commission and the shop's share); the parts whose refund failed; the COD switch; the provider.
router.get('/api/admin/payments', auth.requireRole('admin'), (req, res) => {
  const rows = db.prepare(`
    SELECT payments.*, customer_orders.code, customer_orders.customer_name
    FROM payments JOIN customer_orders ON customer_orders.id = payments.customer_order_id
    ORDER BY payments.id DESC LIMIT 200`).all();
  const list = rows.map((payment) => ({
    id: payment.id, code: payment.code, customer_name: payment.customer_name, provider: payment.provider,
    order_ref: payment.provider_ref, paid_ref: payment.paid_ref, amount: payment.amount, status: payment.status,
    created_at: payment.created_at, refunds: refundsOf(payment.id), split: splitOf(payment.customer_order_id),
  }));
  const refundDue = db.prepare(`
    SELECT seller_orders.id, seller_orders.status, seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap AS amount,
           sellers.shop_name, customer_orders.code
    FROM seller_orders JOIN sellers ON sellers.id = seller_orders.seller_id
    JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE seller_orders.status IN ('rejected', 'cancelled') AND seller_orders.payment_status = 'paid'`).all();
  const cod = db.prepare("SELECT value FROM settings WHERE key = 'cod_enabled'").get().value === '1';
  res.json({ payments: list, refund_due: refundDue, cod_enabled: cod, provider: payments.PROVIDER, pay_within_minutes: payments.PAY_WITHIN_MINUTES });
});

// The admin switches cash on delivery on or off. While it is off, the server refuses COD checkout.
router.post('/api/admin/settings/cod', auth.requireRole('admin'), (req, res) => {
  const enabled = (req.body || {}).enabled === true;
  db.prepare("UPDATE settings SET value = ? WHERE key = 'cod_enabled'").run(enabled ? '1' : '0');
  res.json({ ok: true, cod_enabled: enabled, message: enabled ? 'Cash on delivery is on.' : 'Cash on delivery is off.' });
});

// The admin runs the 30-minute check now (it also runs by itself every minute).
router.post('/api/admin/payments/run-expiry', auth.requireRole('admin'), (req, res) => {
  const cancelled = payments.cancelExpiredPayments();
  res.json({ ok: true, cancelled, message: cancelled ? `${cancelled} unpaid order${cancelled === 1 ? ' was' : 's were'} cancelled.` : 'No unpaid order is older than 30 minutes.' });
});

// The admin tries a failed refund again.
router.post('/api/admin/parts/:id/refund', auth.requireRole('admin'), async (req, res) => {
  const id = auth.readId(req.params.id);
  if (!id) throw new HttpError(404, 'That part of the order does not exist.');
  const done = await payments.refund(id);
  res.json({ ok: true, message: `Refunded ${done.amount / 100} rupees.` });
});

// The refunds of one payment.
function refundsOf(paymentId) {
  return db.prepare(`
    SELECT refunds.id, refunds.amount, refunds.provider_ref, refunds.created_at, sellers.shop_name
    FROM refunds JOIN seller_orders ON seller_orders.id = refunds.seller_order_id
    JOIN sellers ON sellers.id = seller_orders.seller_id
    WHERE refunds.payment_id = ? ORDER BY refunds.id`).all(paymentId);
}

// How one order's money splits per shop: the shop's total (items + shipping), the platform's commission and the
// shop's share (total - commission).
function splitOf(customerOrderId) {
  return db.prepare(`
    SELECT sellers.shop_name, seller_orders.status, seller_orders.payment_status,
           seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap AS total, seller_orders.commission_bps, seller_orders.commission,
           seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap - seller_orders.commission AS shop_share
    FROM seller_orders JOIN sellers ON sellers.id = seller_orders.seller_id
    WHERE seller_orders.customer_order_id = ? ORDER BY sellers.shop_name`).all(customerOrderId);
}

module.exports = router;
module.exports.phoneIsChecked = phoneIsChecked;
