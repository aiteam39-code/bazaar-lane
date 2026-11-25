// routes/sellers.js - seller sign-up, and the admin's Shops page (approve, reject, suspend, reactivate).
const express = require('express');
const { db, nowIso } = require('../db');
const auth = require('../auth');
const mail = require('../mail');
const { rupees, paiseFromRupeesText } = require('../money');

const router = express.Router();
const { HttpError } = auth;

const SHOP_TABS = ['pending', 'active', 'suspended', 'rejected'];
const RETURN_CHOICES = [0, 7, 10, 15, 30]; // days to return a product (0 = no returns)
const MOST_SHIPPING = rupees(10000);     // a shipping fee or free-shipping limit is at most Rs 10,000

// What the admin may do to a shop: which statuses it can start from, the new status, and whether a reason is needed.
const SHOP_ACTIONS = {
  approve:    { from: ['pending', 'rejected'], to: 'active',    needsReason: false, done: 'approved' },
  reject:     { from: ['pending'],             to: 'rejected',  needsReason: true,  done: 'rejected' },
  suspend:    { from: ['active'],              to: 'suspended', needsReason: true,  done: 'suspended' },
  reactivate: { from: ['suspended'],           to: 'active',    needsReason: false, done: 'reactivated' },
};

// Shop statuses in plain words, for messages.
const SHOP_STATUS_WORDS = { pending: 'waiting for approval', active: 'live', rejected: 'not approved', suspended: 'suspended' };

// What the admin can do with a shop in this status, as a next step: "You can approve or reject it."
function nextShopStep(status) {
  const allowed = Object.keys(SHOP_ACTIONS).filter((name) => SHOP_ACTIONS[name].from.includes(status));
  if (allowed.length === 0) return 'Choose another action.';
  return `You can ${allowed.join(' or ')} it.`;
}

// A new shop starts with these shipping settings. The seller can change them in Shop settings (sector 2).
const NEW_SHOP_SHIPPING_FEE = rupees(50);
const NEW_SHOP_FREE_SHIPPING_OVER = rupees(499);

// Seller sign-up: shop name, email, password and a 10-digit phone. The shop starts as pending, and the seller is logged in.
router.post('/api/sellers/signup', async (req, res) => {
  const form = readSignupForm(req.body || {});
  const userId = await createPendingShop(form);
  await auth.startSession(res, userId);
  res.status(201).json({ ok: true, redirect: '/seller/' });
});

// Admin: the shops in one tab (pending, active, suspended or rejected), and how many shops each tab has.
router.get('/api/admin/shops', auth.requireRole('admin'), async (req, res) => {
  const tab = SHOP_TABS.includes(req.query.tab) ? req.query.tab : 'pending';
  // Pending: the shop that has waited longest comes first. Other tabs: A to Z.
  const order = tab === 'pending' ? 'sellers.created_at ASC' : 'sellers.shop_name COLLATE NOCASE ASC';
  const shops = await db.all(`
    SELECT sellers.id, sellers.shop_name, sellers.slug, sellers.phone, sellers.status,
           sellers.status_reason, sellers.created_at, users.email
    FROM sellers LEFT JOIN users ON users.seller_id = sellers.id
    WHERE sellers.status = ?
    ORDER BY ${order}`, tab);
  res.json({ tab, counts: await countShopsByStatus(), shops });
});

// Admin: approve, reject (reason needed), suspend (reason needed) or reactivate one shop.
router.post('/api/admin/shops/:id/:action', auth.requireRole('admin'), async (req, res) => {
  const actionName = req.params.action;
  if (!Object.hasOwn(SHOP_ACTIONS, actionName)) throw new HttpError(404, 'That action does not exist.');
  const action = SHOP_ACTIONS[actionName];
  const shop = await findShop(req.params.id);
  const reason = auth.cleanText((req.body || {}).reason);

  if (!action.from.includes(shop.status)) {
    throw new HttpError(400, `${shop.shop_name} is ${SHOP_STATUS_WORDS[shop.status]}, so it cannot be ${action.done}. ${nextShopStep(shop.status)}`);
  }
  if (action.needsReason && !reason) throw new HttpError(400, `Please give a reason to ${actionName} this shop.`);
  if (reason.length > 200) throw new HttpError(400, 'The reason must be 200 characters or fewer.');

  // Only changes the shop if its status is still what we checked, in case two admins click at once.
  await db.tx(async () => {
    const result = await db.run('UPDATE sellers SET status = ?, status_reason = ? WHERE id = ? AND status = ?',
      action.to, action.needsReason ? reason : null, shop.id, shop.status);
    if (result.changes !== 1) throw new HttpError(409, 'This shop just changed. Please look again.');
    if (actionName === 'approve') await markApproved(shop.id);
  });
  if (actionName === 'approve') await mail.sendShopDecision(shop.id, true);
  if (actionName === 'reject') await mail.sendShopDecision(shop.id, false, reason);

  res.json({ ok: true, status: action.to, message: `${shop.shop_name} is now ${action.to}.` });
});

// Seller: their own shop settings (a pending or suspended shop may look, only an open shop may change them).
router.get('/api/seller/shop', auth.requireSeller('active', 'suspended', 'pending'), async (req, res) => {
  res.json({ shop: await shopSettings(req.shop.id), return_choices: RETURN_CHOICES });
});

// Seller: change their shop's name, description, city, dispatch days, return window, shipping fee and free-shipping
// limit. The web address (slug) never changes. Old orders keep what was copied into them.
router.put('/api/seller/shop', auth.requireSeller('active'), async (req, res) => {
  const form = readShopSettings(req.body || {});
  const sameName = await db.get('SELECT id FROM sellers WHERE lower(shop_name) = lower(?) AND id <> ?', form.shopName, req.shop.id);
  if (sameName) throw new HttpError(409, 'Another shop already has this name. Please choose another name.');
  await db.run(`
    UPDATE sellers SET shop_name = ?, description = ?, city = ?, dispatch_days = ?, return_days = ?, shipping_fee = ?,
      free_shipping_over = ?, gift_wrap_price = ? WHERE id = ?`,
    form.shopName, form.description, form.city, form.dispatchDays, form.returnDays, form.shippingFee,
      form.freeShippingOver, form.giftWrapPrice, req.shop.id);
  res.json({ ok: true, shop: await shopSettings(req.shop.id), message: 'Your shop settings were saved.' });
});

// The "Sell with us" page: the default commission and the early-bird offer, with how many places are left.
router.get('/api/sell-info', async (req, res) => {
  const setting = async (key) => Number((await db.get('SELECT value FROM settings WHERE key = ?', key)).value);
  const slots = await setting('early_bird_slots');
  const taken = (await db.get('SELECT COUNT(*) AS n FROM sellers WHERE early_bird = 1')).n;
  res.json({
    default_commission_bps: await setting('default_commission_bps'),
    early_bird: slots > 0 ? {
      slots, places_left: Math.max(slots - taken, 0), rate_bps: await setting('early_bird_bps'), days: await setting('early_bird_days'),
    } : null,
  });
});

// ---------- Helpers ----------

// Checks the sign-up form and returns the cleaned values. Throws a plain message for the first problem.
function readSignupForm(body) {
  const shopName = auth.cleanText(body.shop_name).replace(/\s+/g, ' ');
  const email = auth.cleanEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';
  const phone = auth.cleanPhone(body.phone);

  if (shopName.length < 2 || shopName.length > 40) throw new HttpError(400, 'Shop name must be 2 to 40 characters.');
  const slug = makeSlug(shopName);
  if (!slug) throw new HttpError(400, 'Shop name needs at least one English letter or number.');
  if (!auth.isValidEmail(email)) throw new HttpError(400, 'Please enter a valid email, like name@example.com.');
  if (password.length < 8 || password.length > 100) throw new HttpError(400, 'Password must be 8 to 100 characters.');
  if (!auth.isValidPhone(phone)) throw new HttpError(400, 'Phone must be exactly 10 digits.');
  return { shopName, slug, email, password, phone };
}

// Turns a shop name into its web address: "Chilli Lane Pantry" -> "chilli-lane-pantry".
function makeSlug(shopName) {
  return shopName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Saves the new pending shop and its login together (both or neither). Returns the new user's id.
async function createPendingShop(form) {
  if (await db.get('SELECT 1 FROM users WHERE email = ?', form.email)) {
    throw new HttpError(409, 'This email already has an account. Please log in instead.');
  }
  if (await db.get('SELECT 1 FROM sellers WHERE slug = ?', form.slug)) {
    throw new HttpError(409, 'A shop with this name already exists. Please choose another name.');
  }
  const passwordHash = auth.hashPassword(form.password);
  const saveBoth = () => db.tx(async () => {
    const shop = await db.run(`
      INSERT INTO sellers (shop_name, slug, description, phone, status, shipping_fee, free_shipping_over, created_at)
      VALUES (?, ?, '', ?, 'pending', ?, ?, ?)`,
      form.shopName, form.slug, form.phone, NEW_SHOP_SHIPPING_FEE, NEW_SHOP_FREE_SHIPPING_OVER, nowIso());
    const user = await db.run(`
      INSERT INTO users (email, password_hash, role, seller_id, created_at)
      VALUES (?, ?, 'seller', ?, ?)`,
      form.email, passwordHash, shop.lastInsertRowid, nowIso());
    return user.lastInsertRowid;
  });
  try {
    return await saveBoth();
  } catch (err) {
    // Two sign-ups with the same email or name at the same moment: the database refuses the second one.
    if (err.code === 'UNIQUE_VIOLATION') throw new HttpError(409, 'This email or shop name is already taken.');
    throw err;
  }
}

// One shop's settings, as the seller sees them (the money in paise).
async function shopSettings(shopId) {
  return db.get(`
    SELECT shop_name, slug, description, city, dispatch_days, return_days, shipping_fee, free_shipping_over, gift_wrap_price, status
    FROM sellers WHERE id = ?`, shopId);
}

// Checks the shop settings form. Money is typed in rupees. Throws a plain message for the first problem.
function readShopSettings(body) {
  const shopName = auth.cleanText(body.shop_name).replace(/\s+/g, ' ');
  if (shopName.length < 2 || shopName.length > 40) throw new HttpError(400, 'Shop name must be 2 to 40 characters.');
  const description = auth.cleanText(body.description);
  if (description.length > 500) throw new HttpError(400, 'Description must be 500 characters or fewer.');
  const city = auth.cleanText(body.city).replace(/\s+/g, ' ');
  if (city.length < 2 || city.length > 40) throw new HttpError(400, 'City must be 2 to 40 characters, like Jaipur.');
  const dispatchDays = auth.readWholeNumber(body.dispatch_days, 'Dispatch days', 1, 7);
  const returnDays = Number(body.return_days);
  if (!RETURN_CHOICES.includes(returnDays)) throw new HttpError(400, 'Returns must be no returns, 7, 10, 15 or 30 days.');
  const shippingFee = paiseFromRupeesText(String(body.shipping_fee ?? ''));
  if (shippingFee === null || shippingFee > MOST_SHIPPING) {
    throw new HttpError(400, 'Shipping fee must be in rupees, from 0 to 10,000, like 40.');
  }
  const freeText = String(body.free_shipping_over ?? '').trim();
  const freeShippingOver = freeText === '' ? null : paiseFromRupeesText(freeText);
  if (freeText !== '' && (freeShippingOver === null || freeShippingOver > MOST_SHIPPING * 10)) {
    throw new HttpError(400, 'Free shipping above must be in rupees, like 499, or empty for never.');
  }
  const wrapText = String(body.gift_wrap_price ?? '0').trim() || '0';
  const giftWrapPrice = paiseFromRupeesText(wrapText);
  if (giftWrapPrice === null || giftWrapPrice > MOST_SHIPPING) throw new HttpError(400, 'Gift wrap must be in rupees, from 0 (not offered) to 10,000, like 30.');
  return { shopName, description, city, dispatchDays, returnDays, shippingFee, freeShippingOver, giftWrapPrice };
}

// A shop was approved: remember when, and put it in the early-bird group while the offer has places left
// (a shop that was in the group before keeps its place). Runs inside the approve transaction; the lock makes two
// approvals at the same moment take their turn, so they can never both take the last place.
async function markApproved(shopId) {
  await db.lock('early-bird');
  await db.run('UPDATE sellers SET approved_at = ? WHERE id = ?', nowIso(), shopId);
  const slots = Number((await db.get("SELECT value FROM settings WHERE key = 'early_bird_slots'")).value);
  const taken = (await db.get('SELECT COUNT(*) AS n FROM sellers WHERE early_bird = 1')).n;
  if (taken < slots) await db.run('UPDATE sellers SET early_bird = 1 WHERE id = ?', shopId);
}

// Finds a shop by the id in the address (digits only), or answers 404.
async function findShop(idText) {
  const id = auth.readId(idText);
  const shop = id ? await db.get('SELECT * FROM sellers WHERE id = ?', id) : null;
  if (!shop) throw new HttpError(404, 'That shop does not exist.');
  return shop;
}

// { pending: 1, active: 3, suspended: 0, rejected: 0 }
async function countShopsByStatus() {
  const counts = { pending: 0, active: 0, suspended: 0, rejected: 0 };
  for (const row of await db.all('SELECT status, COUNT(*) AS n FROM sellers GROUP BY status')) {
    counts[row.status] = row.n;
  }
  return counts;
}

module.exports = router;
