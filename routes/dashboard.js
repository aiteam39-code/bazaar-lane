// routes/dashboard.js - the dashboards (sector 8) and the email outbox.
// Admin: the whole platform. Seller: their own shop only. Every number is counted straight from the database.
// "Today" starts at midnight on this laptop's clock. Open orders are always counted; delivered, rejected and cancelled
// ones count on the day they finished (their last status_log line).
const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const { balanceOf } = require('./commissions');

const WAIT_RED_MINUTES = 60; // the oldest placed order turns red when it waited MORE than 60 minutes

const router = express.Router();
const { HttpError } = auth;
const MOST_EMAILS_SHOWN = 200;

// Admin: the outbox, newest first (who it went to, the subject and when; open one to read it).
router.get('/api/admin/emails', auth.requireRole('admin'), async (req, res) => {
  const emails = await db.all('SELECT id, to_address, subject, created_at FROM emails ORDER BY id DESC LIMIT ?', MOST_EMAILS_SHOWN);
  const total = (await db.get('SELECT COUNT(*) AS n FROM emails')).n;
  res.json({ emails, total });
});

// Admin: one email from the outbox, with its body.
router.get('/api/admin/emails/:id', auth.requireRole('admin'), async (req, res) => {
  const id = auth.readId(req.params.id);
  const email = id ? await db.get('SELECT * FROM emails WHERE id = ?', id) : null;
  if (!email) throw new HttpError(404, 'That email does not exist.');
  res.json({ email });
});

// ---------- Times ----------

// Midnight today (this laptop's clock) as the database's ISO text, and the start of the last 7 days.
function startOfToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}
function startOfWeek() {
  return new Date(Date.parse(startOfToday()) - 6 * 86400000).toISOString();
}

// When each part reached a status (its first status_log line with that status).
// The boundaries it is compared with (midnight, the start of the week) are worked out in JavaScript and passed as values.
const REACHED = (status) => `(SELECT MIN(at) FROM status_log WHERE status_log.seller_order_id = seller_orders.id AND status_log.status = '${status}')`;

// ---------- Admin ----------

// Admin: the central dashboard.
router.get('/api/admin/dashboard', auth.requireRole('admin'), async (req, res) => {
  const today = startOfToday();
  const week = startOfWeek();
  const one = async (sql, ...values) => (await db.get(sql, ...values)).n;
  const deliveredToday = await db.get(`
    SELECT COALESCE(SUM(items_total + shipping + gift_wrap), 0) AS sales, COALESCE(SUM(commission), 0) AS commission, COUNT(*) AS n
    FROM seller_orders WHERE status = 'delivered' AND ${REACHED('delivered')} >= ?`, today);
  const byStatus = {};
  for (const status of ['pending_payment', 'placed', 'accepted', 'packed', 'shipped']) {
    byStatus[status] = await one('SELECT COUNT(*) AS n FROM seller_orders WHERE status = ?', status);
  }
  for (const status of ['delivered', 'rejected', 'cancelled']) {
    byStatus[status] = await one(`SELECT COUNT(*) AS n FROM seller_orders WHERE status = ? AND ${REACHED(status)} >= ?`, status, today);
  }
  // The earliest time a part that is still placed was placed (the same as the smallest of each part's first "placed" line).
  const oldest = (await db.get(`SELECT MIN(status_log.at) AS at FROM status_log JOIN seller_orders ON seller_orders.id = status_log.seller_order_id
    WHERE seller_orders.status = 'placed' AND status_log.status = 'placed'`)).at;
  const waitMinutes = oldest ? Math.floor((Date.now() - Date.parse(oldest)) / 60000) : 0;
  const shopsWaiting = await one("SELECT COUNT(*) AS n FROM sellers WHERE status = 'pending'");
  const low = await one('SELECT COUNT(*) AS n FROM products WHERE deleted = 0 AND stock <= low_stock_level');
  const openHelp = await one("SELECT COUNT(*) AS n FROM help_requests WHERE status = 'open'");
  const openReports = await one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'");
  let payoutsDue = 0;
  for (const shop of await db.all('SELECT id FROM sellers')) payoutsDue += Math.max(await balanceOf(shop.id), 0);
  const ordersToday = await one(`SELECT COUNT(*) AS n FROM customer_orders WHERE created_at >= ? AND (payment_method = 'cod'
      OR EXISTS (SELECT 1 FROM payments WHERE payments.customer_order_id = customer_orders.id AND payments.status = 'paid'))`, today);
  const emailsToday = await one('SELECT COUNT(*) AS n FROM emails WHERE created_at >= ?', today);
  const topShops = await db.all(`
      SELECT sellers.shop_name AS name, SUM(seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap) AS sales
      FROM seller_orders JOIN sellers ON sellers.id = seller_orders.seller_id
      WHERE seller_orders.status = 'delivered' AND ${REACHED('delivered')} >= ?
      GROUP BY sellers.id ORDER BY sales DESC LIMIT 5`, week);
  const topCategories = await db.all(`
      SELECT categories.name AS name, SUM(order_items.line_total) AS sales
      FROM order_items JOIN seller_orders ON seller_orders.id = order_items.seller_order_id
      JOIN products ON products.id = order_items.product_id JOIN categories ON categories.id = products.category_id
      WHERE seller_orders.status = 'delivered' AND ${REACHED('delivered')} >= ?
      GROUP BY categories.id ORDER BY sales DESC LIMIT 5`, week);
  res.json({
    // Orders today: placed today and real (cash on delivery, or paid online); unpaid and failed online orders do not count.
    orders_today: ordersToday,
    sales_today: deliveredToday.sales,
    commission_today: deliveredToday.commission,
    by_status: byStatus,
    shops_waiting: shopsWaiting,
    low_products: low,
    payouts_due: payoutsDue,
    open_help: openHelp,
    open_reports: openReports,
    emails_today: emailsToday,
    oldest_wait_minutes: oldest ? waitMinutes : null,
    red: {
      wait: waitMinutes > WAIT_RED_MINUTES, low: low > 0, shops_waiting: shopsWaiting > 0, open_help: openHelp > 0,
    },
    top_shops: topShops,
    top_categories: topCategories,
  });
});

// ---------- Seller ----------

// Seller: their own shop's dashboard.
router.get('/api/seller/dashboard', auth.requireSeller('active', 'suspended'), async (req, res) => {
  const shopId = req.shop.id;
  const today = startOfToday();
  const week = startOfWeek();
  const one = async (sql, ...values) => (await db.get(sql, ...values)).n;
  const late = (await db.all(`SELECT ${REACHED('placed')} AS placed_at FROM seller_orders WHERE seller_id = ? AND status IN ('placed', 'accepted', 'packed')`, shopId))
    .filter((row) => row.placed_at && Date.parse(row.placed_at) + req.shop.dispatch_days * 86400000 < Date.now()).length;
  const views = await one(`SELECT COALESCE(SUM(product_views.count), 0) AS n FROM product_views JOIN products ON products.id = product_views.product_id
    WHERE products.seller_id = ? AND product_views.day >= ?`, shopId, week.slice(0, 10));
  const ordersThisWeek = await one(`SELECT COUNT(*) AS n FROM seller_orders WHERE seller_id = ? AND status <> 'pending_payment' AND ${REACHED('placed')} >= ?`, shopId, week);
  const rating = await db.get('SELECT ROUND(AVG(rating), 1) AS rating, COUNT(*) AS n FROM reviews WHERE seller_id = ? AND hidden = 0', shopId);
  const newOrders = await one("SELECT COUNT(*) AS n FROM seller_orders WHERE seller_id = ? AND status = 'placed'", shopId);
  const toPack = await one("SELECT COUNT(*) AS n FROM seller_orders WHERE seller_id = ? AND status IN ('accepted', 'packed')", shopId);
  const salesToday = await one(`SELECT COALESCE(SUM(items_total + shipping + gift_wrap), 0) AS n FROM seller_orders WHERE seller_id = ? AND status = 'delivered' AND ${REACHED('delivered')} >= ?`, shopId, today);
  const balance = await balanceOf(shopId);
  const lowProducts = await db.all('SELECT name, stock, low_stock_level FROM products WHERE seller_id = ? AND deleted = 0 AND stock <= low_stock_level ORDER BY name', shopId);
  const weekly = await weeklySales(shopId);
  res.json({
    new_orders: newOrders,
    to_pack: toPack,
    late_orders: late,
    sales_today: salesToday,
    balance,
    rating: rating.rating,
    review_count: rating.n,
    views_this_week: views,
    orders_this_week: ordersThisWeek,
    conversion_percent: views > 0 ? Math.round((ordersThisWeek / views) * 1000) / 10 : null,
    low_products: lowProducts,
    weekly_sales: weekly,
  });
});

// The shop's delivered sales for each of the last 6 weeks, split into new buyers and repeat buyers.
// A buyer is "repeat" when the same email already had an earlier order with this shop that was not
// cancelled, rejected or left unpaid. There is only one sales channel, so this is the only honest split.
async function weeklySales(shopId) {
  const rows = await db.all(`
    SELECT ${REACHED('delivered')} AS at, seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap AS amount,
      EXISTS (SELECT 1 FROM seller_orders AS earlier JOIN customer_orders AS earlier_order ON earlier_order.id = earlier.customer_order_id
        WHERE earlier.seller_id = seller_orders.seller_id AND earlier.id < seller_orders.id
        AND earlier.status NOT IN ('cancelled', 'rejected', 'pending_payment')
        AND LOWER(earlier_order.email) = LOWER(customer_orders.email)) AS repeat_buyer
    FROM seller_orders JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE seller_orders.seller_id = ? AND seller_orders.status = 'delivered'`, shopId);
  const series = [{ key: 'new', label: 'New buyers', tone: 1 }, { key: 'repeat', label: 'Repeat buyers', tone: 3 }];
  const thisWeekStart = Date.parse(startOfWeek());
  const bars = [];
  for (let week = 5; week >= 0; week -= 1) {
    const from = thisWeekStart - week * 7 * 86400000;
    const to = from + 7 * 86400000;
    const values = { new: 0, repeat: 0 };
    for (const row of rows) {
      const at = Date.parse(row.at);
      if (at < from || at >= to) continue;
      values[row.repeat_buyer ? 'repeat' : 'new'] += row.amount / 100;
    }
    const label = new Date(from).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    bars.push({ label, values });
  }
  return { series, bars };
}

module.exports = router;
