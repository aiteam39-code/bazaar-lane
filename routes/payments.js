// routes/payments.js - paying online (test mode), the FakePay page, the phone code before cash on delivery, and the
// admin's Payments page (every payment and refund, the split per shop, the cash-on-delivery switch, the 30-minute check).
const crypto = require('crypto');
const express = require('express');
const { db, nowIso } = require('../db');
const auth = require('../auth');
const payments = require('../payments');
const mail = require('../mail');
const { sendPage, pageTitle } = require('../pages');
const { formatMoney } = require('../money');

const router = express.Router();
const { HttpError } = auth;
const CODE_MINUTES = 10;       // a phone code works for 10 minutes
const RESEND_SECONDS = 30;     // a new code can be asked for after 30 seconds
const MOST_CODE_TRIES = 5;     // 5 wrong codes and a new one is needed
const VERIFIED_MINUTES = 30;   // a checked phone can place cash-on-delivery orders for 30 minutes
// The code is shown on screen and logged outside production, or when SHOW_TEST_CODES=1 (the live demo has no SMS service).
const SHOW_TEST_CODE = process.env.NODE_ENV !== 'production' || process.env.SHOW_TEST_CODES === '1';

// ---------- FakePay (only used when no Razorpay keys are set) ----------

// The FakePay page: the amount and three buttons (UPI, card, fail).
router.get('/pay/fake/:id', async (req, res) => {
  await sendPage(res, 'pay.html', { title: pageTitle('Pay (test)'), description: 'A pretend payment page for testing.' });
});

// What the FakePay page shows.
router.get('/api/pay/fake/:id', async (req, res) => {
  res.json(await payments.fakePaymentInfo(req.params.id));
});

// FakePay "processes" the payment and hands back a result signed with the server's secret, like a real provider.
router.post('/api/pay/fake/:id', async (req, res) => {
  res.json(await payments.fakeProviderResult(req.params.id, String((req.body || {}).outcome || '')));
});

// The result of a payment (from FakePay or Razorpay's checkout) comes back here. Only a valid signature counts.
router.post('/api/payments/verify', async (req, res) => {
  const result = await payments.verifyPayment(req.body || {});
  const paid = result.status === 'paid';
  res.json({
    ok: true,
    status: result.status,
    tracking_url: result.trackingUrl + (paid ? '?new=1' : ''),
    message: paid ? 'Payment received. Thank you.'
      : 'Payment declined, so the order was cancelled and nothing was charged. Your bag still has the products: go back to it to try again.',
  });
});

// ---------- The phone code before a cash-on-delivery order ----------

// Sends a 6-digit code to the phone. There is no SMS service: the "SMS" goes into the outbox. Outside production the
// code is also printed in the server log and sent back as test_sms, so the page can show it marked as a test SMS.
// A new code only after 30 seconds.
router.post('/api/checkout/phone-code', async (req, res) => {
  const phone = auth.cleanPhone((req.body || {}).phone);
  if (!auth.isValidPhone(phone)) throw new HttpError(400, 'Phone must be exactly 10 digits. Type your mobile number without +91.');
  const old = await db.get('SELECT sent_at FROM phone_codes WHERE phone = ?', phone);
  if (old && Date.now() - Date.parse(old.sent_at) < RESEND_SECONDS * 1000) {
    throw new HttpError(429, `A code was just sent. You can ask for a new one after ${RESEND_SECONDS} seconds.`);
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const now = new Date();
  await db.run(`
    INSERT INTO phone_codes (phone, code_hash, sent_at, expires_at, tries, verify_token, verified_until)
    VALUES (?, ?, ?, ?, 0, NULL, NULL)
    ON CONFLICT (phone) DO UPDATE SET code_hash = excluded.code_hash, sent_at = excluded.sent_at,
      expires_at = excluded.expires_at, tries = 0, verify_token = NULL, verified_until = NULL`,
  phone, codeHash(phone, code), now.toISOString(), new Date(now.getTime() + CODE_MINUTES * 60000).toISOString());
  await mail.sendEmail(`SMS to ${phone}`, 'Your Bazaar Lane code', [`Your Bazaar Lane code is ${code}. It works for ${CODE_MINUTES} minutes.`]);
  const answer = { ok: true, message: `We sent a 6-digit code to the phone ending ${phone.slice(-4)}.`, resend_after_seconds: RESEND_SECONDS };
  if (SHOW_TEST_CODE) {
    console.log(`Test SMS to the phone ending ${phone.slice(-4)}: code ${code} (shown only outside production)`);
    answer.test_sms = code;
  }
  res.json(answer);
});

// Checks the code. Right: the phone is checked for 30 minutes, with a token only this browser gets.
// Wrong: "That code didn't match. N tries left."; after 5 wrong tries the code is locked and a new one is needed.
router.post('/api/checkout/phone-verify', async (req, res) => {
  const body = req.body || {};
  const phone = auth.cleanPhone(body.phone);
  const code = String(body.code || '');
  const row = await db.get('SELECT * FROM phone_codes WHERE phone = ?', phone);
  if (!row || Date.parse(row.expires_at) < Date.now()) throw new HttpError(400, 'That code has run out. Ask for a new code.');
  if (row.tries >= MOST_CODE_TRIES) throw new HttpError(429, 'That code is locked after 5 wrong tries. Ask for a new code.');
  if (!/^\d{6}$/.test(code) || codeHash(phone, code) !== row.code_hash) {
    await db.run('UPDATE phone_codes SET tries = tries + 1 WHERE phone = ?', phone);
    const left = MOST_CODE_TRIES - row.tries - 1;
    const tries = left > 0 ? `${left} ${left === 1 ? 'try' : 'tries'} left.` : 'No tries left. Ask for a new code.';
    throw new HttpError(400, `That code didn't match. ${tries}`);
  }
  const token = crypto.randomBytes(24).toString('hex');
  await db.run('UPDATE phone_codes SET verify_token = ?, verified_until = ? WHERE phone = ?',
    token, new Date(Date.now() + VERIFIED_MINUTES * 60000).toISOString(), phone);
  res.json({ ok: true, phone_token: token, message: 'Phone checked.' });
});

// True when this phone was checked with this token in the last 30 minutes (checkout asks before a COD order).
async function phoneIsChecked(phone, token) {
  const row = await db.get('SELECT verify_token, verified_until FROM phone_codes WHERE phone = ?', phone);
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
router.get('/api/admin/payments', auth.requireRole('admin'), async (req, res) => {
  const rows = await db.all(`
    SELECT payments.*, customer_orders.code, customer_orders.customer_name
    FROM payments JOIN customer_orders ON customer_orders.id = payments.customer_order_id
    ORDER BY payments.id DESC LIMIT 200`);
  const list = [];
  for (const payment of rows) {
    list.push({
      id: payment.id, code: payment.code, customer_name: payment.customer_name, provider: payment.provider,
      order_ref: payment.provider_ref, paid_ref: payment.paid_ref, amount: payment.amount, status: payment.status,
      created_at: payment.created_at, refunds: await refundsOf(payment.id), split: await splitOf(payment.customer_order_id),
    });
  }
  const refundDue = await db.all(`
    SELECT seller_orders.id, seller_orders.status, seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap AS amount,
           sellers.shop_name, customer_orders.code
    FROM seller_orders JOIN sellers ON sellers.id = seller_orders.seller_id
    JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE seller_orders.status IN ('rejected', 'cancelled') AND seller_orders.payment_status = 'paid'`);
  const cod = (await db.get("SELECT value FROM settings WHERE key = 'cod_enabled'")).value === '1';
  res.json({ payments: list, refund_due: refundDue, cod_enabled: cod, provider: payments.PROVIDER, pay_within_minutes: payments.PAY_WITHIN_MINUTES });
});

// The admin switches cash on delivery on or off. While it is off, the server refuses COD checkout.
router.post('/api/admin/settings/cod', auth.requireRole('admin'), async (req, res) => {
  const enabled = (req.body || {}).enabled === true;
  await db.run("UPDATE settings SET value = ? WHERE key = 'cod_enabled'", enabled ? '1' : '0');
  res.json({ ok: true, cod_enabled: enabled, message: enabled ? 'Cash on delivery is on.' : 'Cash on delivery is off.' });
});

// The admin runs the 30-minute check now (it also runs by itself every minute).
router.post('/api/admin/payments/run-expiry', auth.requireRole('admin'), async (req, res) => {
  const cancelled = await payments.cancelExpiredPayments();
  res.json({ ok: true, cancelled, message: cancelled ? `${cancelled} unpaid order${cancelled === 1 ? ' was' : 's were'} cancelled.` : 'No unpaid order is older than 30 minutes.' });
});

// The admin tries a failed refund again.
router.post('/api/admin/parts/:id/refund', auth.requireRole('admin'), async (req, res) => {
  const id = auth.readId(req.params.id);
  if (!id) throw new HttpError(404, 'That part of the order does not exist.');
  const done = await payments.refund(id);
  res.json({ ok: true, message: `Refunded ${formatMoney(done.amount)}.` });
});

// The refunds of one payment.
async function refundsOf(paymentId) {
  return db.all(`
    SELECT refunds.id, refunds.amount, refunds.provider_ref, refunds.created_at, sellers.shop_name
    FROM refunds JOIN seller_orders ON seller_orders.id = refunds.seller_order_id
    JOIN sellers ON sellers.id = seller_orders.seller_id
    WHERE refunds.payment_id = ? ORDER BY refunds.id`, paymentId);
}

// How one order's money splits per shop: the shop's total (items + shipping), the platform's commission and the
// shop's share (total - commission).
async function splitOf(customerOrderId) {
  return db.all(`
    SELECT sellers.shop_name, seller_orders.status, seller_orders.payment_status,
           seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap AS total, seller_orders.commission_bps, seller_orders.commission,
           seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap - seller_orders.commission AS shop_share
    FROM seller_orders JOIN sellers ON sellers.id = seller_orders.seller_id
    WHERE seller_orders.customer_order_id = ? ORDER BY sellers.shop_name`, customerOrderId);
}

module.exports = router;
module.exports.phoneIsChecked = phoneIsChecked;
