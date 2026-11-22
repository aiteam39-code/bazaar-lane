// seller/home.js - the seller's home page: their own shop's status card and, once approved, their dashboard (their
// shop only): new orders (with a badge), orders to pack, LATE orders, sales today, balance, rating, product views this
// week, orders divided by views, LOW products by name, and the kit's StackedBars of sales by week split by category.
// It refreshes every 5 seconds, so the page changes by itself when the admin approves the shop or an order arrives.

// What the seller sees for each shop status.
const SHOP_STATUS_TEXT = {
  pending: {
    icon: 'alert',
    title: 'Waiting for approval',
    text: 'The admin is checking your shop. You can add products as soon as it is approved. This page updates by itself.',
  },
  active: {
    icon: 'checkCircle',
    title: 'Your shop is live',
    text: 'Customers can see your shop and its products. Use Products to add and change them. Orders and earnings will be added here soon.',
  },
  rejected: {
    icon: 'close',
    title: 'Your shop was not approved',
    text: 'You cannot sell with this shop.',
  },
  suspended: {
    icon: 'alert',
    title: 'Your shop is suspended',
    text: 'Customers cannot see your shop or buy from it. You can still finish orders that were already placed.',
  },
};

const sellerMessage = document.getElementById('message');

// Asks the server who is logged in and shows their shop.
async function loadMyShop() {
  try {
    const me = await api('GET', '/api/me');
    if (me.role !== 'seller') {
      showMessage(sellerMessage, 'This page is for sellers. Please log in with a seller account.', 'error');
      return;
    }
    clearMessage(sellerMessage);
    showMyShop(me.shop);
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    showMessage(sellerMessage, error.message, 'error');
  }
}

// The kit icon at the top of the status card.
function statusIcon(name) {
  const box = make('div', 'status-icon');
  box.append(kitIcon(name));
  return box;
}

// Fills the status card: icon, title, explanation, and the admin's reason when there is one.
function showMyShop(shop) {
  document.getElementById('shop-title').textContent = shop.shop_name;
  const info = SHOP_STATUS_TEXT[shop.status];
  const card = document.getElementById('status-card');
  card.className = 'card status-card status-' + shop.status;
  card.replaceChildren(
    statusIcon(info.icon),
    make('h2', '', info.title),
    make('p', '', info.text)
  );
  if (shop.status_reason) card.append(make('p', 'reason', 'Reason: ' + shop.status_reason));

  // Products: for a live or suspended shop. "See your shop": only while customers can see it.
  document.getElementById('shop-links').classList.toggle('hidden', shop.status !== 'active' && shop.status !== 'suspended');
  const storeLink = document.getElementById('store-link');
  storeLink.href = '/store/' + encodeURIComponent(shop.slug);
  storeLink.classList.toggle('hidden', shop.status !== 'active');
  if (shop.status === 'active' || shop.status === 'suspended') loadDashboard();
}

// The shop's numbers (only this seller's own shop; the server decides).
async function loadDashboard() {
  const data = await api('GET', '/api/seller/dashboard');
  if (!dataChanged('seller-dashboard', data)) return;
  const money = (paise) => ({ value: paise / 100, money: true });
  const tiles = [
    sellerTile('New orders', { value: data.new_orders }, data.new_orders ? 'Accept or reject' : null),
    sellerTile('Orders to pack', { value: data.to_pack }),
    sellerTile('LATE orders', { value: data.late_orders }, data.late_orders ? 'LATE' : null),
    sellerTile('Sales today (delivered)', money(data.sales_today)),
    sellerTile(data.balance < 0 ? 'You owe' : 'Your balance', money(Math.abs(data.balance))),
    sellerTile('Shop rating', { value: data.rating || 0, decimals: 1 }, null, data.review_count ? `${data.review_count} review${data.review_count === 1 ? '' : 's'}` : 'No reviews yet'),
    sellerTile('Product views this week', { value: data.views_this_week }),
    sellerTile('Orders ÷ views', { value: data.conversion_percent || 0, decimals: 1, suffix: '%' }, null,
      `${data.orders_this_week} order${data.orders_this_week === 1 ? '' : 's'} this week`),
  ];
  document.getElementById('tiles').replaceChildren(...tiles);
  const badge = document.getElementById('orders-badge');
  badge.textContent = `${data.new_orders} new`;
  badge.classList.toggle('hidden', data.new_orders === 0);
  setNavBadge('/seller/orders.html', data.new_orders, 'new orders');
  document.getElementById('low-box').classList.toggle('hidden', data.low_products.length === 0);
  document.getElementById('low-list').replaceChildren(...data.low_products.map((p) => make('li', '', `${p.name}: ${p.stock} left (LOW at ${p.low_stock_level})`)));
  mountKit(document.getElementById('sales-chart'), IK.StackedBars, {
    title: 'Sales by week',
    series: data.weekly_sales.series,
    datasets: { week: { label: 'Week', caption: 'last 6 weeks, delivered orders', bars: data.weekly_sales.bars } },
    format: (n) => formatMoney(Math.round(n * 100)),
  });
  document.getElementById('dashboard').classList.remove('hidden');
}

// One tile with a big rolling number; a red word when it needs attention (never colour alone).
function sellerTile(label, number, alertWord, note) {
  const box = make('div', alertWord ? 'tile is-alert' : 'tile');
  box.append(make('p', 'tile-label', label));
  const value = make('p', 'kpi tile-value');
  const format = number.money ? (n) => formatMoney(Math.round(n * 100)) : number.decimals ? { minimumFractionDigits: 1, maximumFractionDigits: 1 } : undefined;
  mountKit(value, IK.RollingNumber, { value: number.value, animateOnMount: false, suffix: number.suffix, format });
  box.append(value);
  if (alertWord) box.append(make('p', 'tile-alert-word', alertWord));
  if (note) box.append(make('p', 'small muted', note));
  return box;
}

refreshEvery5Seconds(loadMyShop);
