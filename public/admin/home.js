// admin/home.js - the central admin dashboard. Every big number is the kit's RollingNumber in the kpi style. A tile
// turns red WITH a word when something needs the admin: the oldest placed order waited MORE than 60 minutes, anything
// is LOW, a shop waits for approval, or a help request is open. Big links with badges. Refreshes every 5 seconds.

const dashboardMessage = document.getElementById('message');

async function loadDashboard() {
  try {
    const data = await api('GET', '/api/admin/dashboard');
    clearLoadProblem(dashboardMessage);
    if (!dataChanged('admin-dashboard', data)) return;
    showTiles(data);
    showStatusTiles(data.by_status);
    showRanks('top-shops', data.top_shops);
    showRanks('top-categories', data.top_categories);
    showLinks(data);
    setNavBadge('/admin/shops.html', data.shops_waiting, 'shops waiting');
    setNavBadge('/admin/help.html', data.open_help, 'open help requests');
    setNavBadge('/admin/reports.html', data.open_reports, 'open reports');
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(dashboardMessage, error);
  }
}

function showTiles(data) {
  const money = (paise) => ({ value: paise / 100, money: true });
  const wait = data.oldest_wait_minutes;
  const tiles = [
    tile('Orders today', { value: data.orders_today }),
    tile('Sales today (delivered)', money(data.sales_today)),
    tile('Commission earned today', money(data.commission_today)),
    tile('Shops waiting for approval', { value: data.shops_waiting }, data.red.shops_waiting ? 'Waiting' : null),
    tile('LOW products, all shops', { value: data.low_products }, data.red.low ? 'LOW' : null),
    tile('Payouts due', money(data.payouts_due)),
    tile('Open help requests', { value: data.open_help }, data.red.open_help ? 'Needs an answer' : null),
    tile('Open reports', { value: data.open_reports }),
    tile('Emails in the outbox today', { value: data.emails_today }),
    tile('Oldest new order has waited', { value: wait === null ? 0 : wait, suffix: ' min' }, data.red.wait ? 'Too long' : null,
      wait === null ? 'No order is waiting' : 'Red after 60 minutes'),
  ];
  document.getElementById('tiles').replaceChildren(...tiles);
}

// One tile: a label, a big rolling number, and when it needs attention a red word (never colour alone).
function tile(label, number, alertWord, note) {
  const box = make('div', alertWord ? 'tile is-alert' : 'tile');
  box.append(make('p', 'tile-label', label));
  const value = make('p', 'kpi tile-value');
  mountKit(value, IK.RollingNumber, {
    value: number.value, animateOnMount: false, suffix: number.suffix,
    format: number.money ? (n) => formatMoney(Math.round(n * 100)) : undefined,
  });
  box.append(value);
  if (alertWord) box.append(make('p', 'tile-alert-word', alertWord));
  if (note) box.append(make('p', 'small muted', note));
  return box;
}

function showStatusTiles(byStatus) {
  document.getElementById('status-tiles').replaceChildren(...Object.entries(byStatus).map(([status, count]) =>
    tile(ORDER_STATUS_WORDS[status] || status, { value: count })));
}

function showRanks(id, rows) {
  const list = document.getElementById(id);
  list.replaceChildren(...rows.map((row) => make('li', '', `${row.name} · ${formatMoney(row.sales)}`)));
  if (rows.length === 0) list.replaceChildren(make('li', 'muted', 'No delivered sales this week yet.'));
}

function showLinks(data) {
  const links = [
    ['Shops', '/admin/shops.html', data.shops_waiting, 'waiting'], ['Products', '/admin/products.html'], ['Orders', '/admin/orders.html'],
    ['Payments', '/admin/payments.html'], ['Commissions', '/admin/commissions.html'], ['Payouts', '/admin/payouts.html'],
    ['Help requests', '/admin/help.html', data.open_help, 'open'], ['Reviews', '/admin/reviews.html'],
    ['Reports', '/admin/reports.html', data.open_reports, 'open'], ['Messages', '/admin/messages.html'], ['Outbox', '/admin/outbox.html'],
  ];
  document.getElementById('big-links').replaceChildren(...links.map(([text, address, count, word]) => {
    const link = make('a', 'card big-link', text);
    link.href = address;
    if (count) link.append(make('span', 'count', `${count} ${word}`));
    return link;
  }));
}

refreshEvery5Seconds(loadDashboard);
