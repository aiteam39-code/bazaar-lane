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
router.get('/api/admin/emails', auth.requireRole('admin'), (req, res) => {
  const emails = db.prepare('SELECT id, to_address, subject, created_at FROM emails ORDER BY id DESC LIMIT ?').all(MOST_EMAILS_SHOWN);
  const total = db.prepare('SELECT COUNT(*) AS n FROM emails').get().n;
  res.json({ emails, total });
});

// Admin: one email from the outbox, with its body.
router.get('/api/admin/emails/:id', auth.requireRole('admin'), (req, res) => {
  const id = auth.readId(req.params.id);
  const email = id ? db.prepare('SELECT * FROM emails WHERE id = ?').get(id) : null;
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
const REACHED = (status) => `(SELECT MIN(at) FROM status_log WHERE status_log.seller_order_id = seller_orders.id AND status_log.status = '${status}')`;

// ---------- Admin ----------

// Admin: the central dashboard.
router.get('/api/admin/dashboard', auth.requireRole('admin'), (req, res) => {
  const today = startOfToday();
  const week = startOfWeek();
  const one = (sql, ...values) => db.prepare(sql).get(...values).n;
  const deliveredToday = db.prepare(`
    SELECT COALESCE(SUM(items_total + shipping + gift_wrap), 0) AS sales, COALESCE(SUM(commission), 0) AS commission, COUNT(*) AS n
    FROM seller_orders WHERE status = 'delivered' AND ${REACHED('delivered')} >= ?`).get(today);
  const byStatus = {};
  for (const status of ['pending_payment', 'placed', 'accepted', 'packed', 'shipped']) {
    byStatus[status] = one('SELECT COUNT(*) AS n FROM seller_orders WHERE status = ?', status);
  }
  for (const status of ['delivered', 'rejected', 'cancelled']) {
    byStatus[status] = one(`SELECT COUNT(*) AS n FROM seller_orders WHERE status = ? AND ${REACHED(status)} >= ?`, status, today);
  }
  const oldest = db.prepare(`SELECT MIN(${REACHED('placed')}) AS at FROM seller_orders WHERE status = 'placed'`).get().at;
  const waitMinutes = oldest ? Math.floor((Date.now() - Date.parse(oldest)) / 60000) : 0;
  const shopsWaiting = one("SELECT COUNT(*) AS n FROM sellers WHERE status = 'pending'");
  const low = one('SELECT COUNT(*) AS n FROM products WHERE deleted = 0 AND stock <= low_stock_level');
  const openHelp = one("SELECT COUNT(*) AS n FROM help_requests WHERE status = 'open'");
  const openReports = one("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'");
  const payoutsDue = db.prepare('SELECT id FROM sellers').all().reduce((sum, shop) => sum + Math.max(balanceOf(shop.id), 0), 0);
  res.json({
    // Orders today: placed today and real (cash on delivery, or paid online); unpaid and failed online orders do not count.
    orders_today: one(`SELECT COUNT(*) AS n FROM customer_orders WHERE created_at >= ? AND (payment_method = 'cod'
      OR EXISTS (SELECT 1 FROM payments WHERE payments.customer_order_id = customer_orders.id AND payments.status = 'paid'))`, today),
    sales_today: deliveredToday.sales,
    commission_today: deliveredToday.commission,
    by_status: byStatus,
    shops_waiting: shopsWaiting,
    low_products: low,
    payouts_due: payoutsDue,
    open_help: openHelp,
    open_reports: openReports,
    emails_today: one('SELECT COUNT(*) AS n FROM emails WHERE created_at >= ?', today),
    oldest_wait_minutes: oldest ? waitMinutes : null,
    red: {
      wait: waitMinutes > WAIT_RED_MINUTES, low: low > 0, shops_waiting: shopsWaiting > 0, open_help: openHelp > 0,
    },
    top_shops: db.prepare(`
      SELECT sellers.shop_name AS name, SUM(seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap) AS sales
      FROM seller_orders JOIN sellers ON sellers.id = seller_orders.seller_id
      WHERE seller_orders.status = 'delivered' AND ${REACHED('delivered')} >= ?
      GROUP BY sellers.id ORDER BY sales DESC LIMIT 5`).all(week),
    top_categories: db.prepare(`
      SELECT categories.name AS name, SUM(order_items.line_total) AS sales
      FROM order_items JOIN seller_orders ON seller_orders.id = order_items.seller_order_id
      JOIN products ON products.id = order_items.product_id JOIN categories ON categories.id = products.category_id
      WHERE seller_orders.status = 'delivered' AND ${REACHED('delivered')} >= ?
      GROUP BY categories.id ORDER BY sales DESC LIMIT 5`).all(week),
  });
});

// ---------- Seller ----------

// Seller: their own shop's dashboard.
router.get('/api/seller/dashboard', auth.requireSeller('active', 'suspended'), (req, res) => {
  const shopId = req.shop.id;
  const today = startOfToday();
  const week = startOfWeek();
  const one = (sql, ...values) => db.prepare(sql).get(...values).n;
  const late = db.prepare(`SELECT ${REACHED('placed')} AS placed_at FROM seller_orders WHERE seller_id = ? AND status IN ('placed', 'accepted', 'packed')`).all(shopId)
    .filter((row) => row.placed_at && Date.parse(row.placed_at) + req.shop.dispatch_days * 86400000 < Date.now()).length;
  const views = one(`SELECT COALESCE(SUM(product_views.count), 0) AS n FROM product_views JOIN products ON products.id = product_views.product_id
    WHERE products.seller_id = ? AND product_views.day >= ?`, shopId, week.slice(0, 10));
  const ordersThisWeek = one(`SELECT COUNT(*) AS n FROM seller_orders WHERE seller_id = ? AND status <> 'pending_payment' AND ${REACHED('placed')} >= ?`, shopId, week);
  const rating = db.prepare('SELECT ROUND(AVG(rating), 1) AS rating, COUNT(*) AS n FROM reviews WHERE seller_id = ? AND hidden = 0').get(shopId);
  res.json({
    new_orders: one("SELECT COUNT(*) AS n FROM seller_orders WHERE seller_id = ? AND status = 'placed'", shopId),
    to_pack: one("SELECT COUNT(*) AS n FROM seller_orders WHERE seller_id = ? AND status IN ('accepted', 'packed')", shopId),
    late_orders: late,
    sales_today: one(`SELECT COALESCE(SUM(items_total + shipping + gift_wrap), 0) AS n FROM seller_orders WHERE seller_id = ? AND status = 'delivered' AND ${REACHED('delivered')} >= ?`, shopId, today),
    balance: balanceOf(shopId),
    rating: rating.rating,
    review_count: rating.n,
    views_this_week: views,
    orders_this_week: ordersThisWeek,
    conversion_percent: views > 0 ? Math.round((ordersThisWeek / views) * 1000) / 10 : null,
    low_products: db.prepare('SELECT name, stock, low_stock_level FROM products WHERE seller_id = ? AND deleted = 0 AND stock <= low_stock_level ORDER BY name').all(shopId),
    weekly_sales: weeklySales(shopId),
  });
});

// The shop's delivered sales for each of the last 6 weeks, split into new buyers and repeat buyers.
// A buyer is "repeat" when the same email already had an earlier order with this shop that was not
// cancelled, rejected or left unpaid. There is only one sales channel, so this is the only honest split.
function weeklySales(shopId) {
  const rows = db.prepare(`
    SELECT ${REACHED('delivered')} AS at, seller_orders.items_total + seller_orders.shipping + seller_orders.gift_wrap AS amount,
      EXISTS (SELECT 1 FROM seller_orders AS earlier JOIN customer_orders AS earlier_order ON earlier_order.id = earlier.customer_order_id
        WHERE earlier.seller_id = seller_orders.seller_id AND earlier.id < seller_orders.id
        AND earlier.status NOT IN ('cancelled', 'rejected', 'pending_payment')
        AND LOWER(earlier_order.email) = LOWER(customer_orders.email)) AS repeat_buyer
    FROM seller_orders JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE seller_orders.seller_id = ? AND seller_orders.status = 'delivered'`).all(shopId);
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
