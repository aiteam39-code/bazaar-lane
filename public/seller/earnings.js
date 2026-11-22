// seller/earnings.js - the seller's own money: the balance (a RollingNumber; "You owe ₹N" when it is below 0), each
// delivered order (items, shipping, rate, commission, what they earned or owe), their payouts, and the rate they get
// today and why. Refreshes every 5 seconds.

const earningsMessage = document.getElementById('message');

async function loadEarnings() {
  try {
    const data = await api('GET', '/api/seller/earnings');
    clearLoadProblem(earningsMessage);
    if (!dataChanged('earnings', data)) return;
    mountKit(document.getElementById('balance'), IK.RollingNumber, { value: data.balance / 100, format: (n) => formatMoney(Math.round(n * 100)), animateOnMount: false });
    document.getElementById('balance-words').textContent = data.balance < 0 ? `You owe ${formatMoney(-data.balance)} in commission from cash-on-delivery orders.`
      : data.balance > 0 ? 'The marketplace owes you this. It is paid out by the admin.' : 'Nothing owed either way.';
    const rate = data.rate;
    document.getElementById('rate-line').textContent = `Your commission on new orders: ${rate.bps / 100}% (${rate.why === 'early bird' ? 'early bird until ' + formatDateTime(rate.until) : rate.why}).`;
    showOrders(data.orders);
    document.getElementById('payout-list').replaceChildren(...data.payouts.map((p) => make('li', '', `${formatDateTime(p.created_at)} · ${formatMoney(p.amount)} · ${p.note}`)));
    document.getElementById('no-payouts').classList.toggle('hidden', data.payouts.length > 0);
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(earningsMessage, error);
  }
}

function showOrders(orders) {
  const table = document.getElementById('order-table');
  const head = make('tr');
  for (const word of ['Order', 'Paid by', 'Items', 'Shipping', 'Rate', 'Commission', 'You earn / owe']) head.append(make('th', '', word));
  table.replaceChildren(head, ...orders.map((o) => {
    const row = make('tr');
    row.append(make('td', '', o.code), make('td', '', o.payment_method === 'cod' ? 'Cash' : 'Online'), make('td', '', formatMoney(o.items_total)),
      make('td', '', formatMoney(o.shipping)), make('td', '', `${o.commission_bps / 100}%`), make('td', '', formatMoney(o.commission)),
      make('td', '', o.amount >= 0 ? `Earn ${formatMoney(o.amount)}` : `Owe ${formatMoney(-o.amount)}`));
    return row;
  }));
  document.getElementById('no-orders').classList.toggle('hidden', orders.length > 0);
}

refreshEvery5Seconds(loadEarnings);
