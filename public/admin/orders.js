// admin/orders.js - the admin's Orders page: every customer order, newest first, with each shop's part
// (status, products, shipping, commission, payment) and who changed what, when. Cancel (with a reason, the kit's
// ConfirmButton; stock back and a refund) for placed, accepted or packed parts, and Mark delivered for shipped ones.
// It refreshes every 5 seconds, and is only drawn again when something changed.

const ordersMessage = document.getElementById('message');

const PAYMENT_WORDS = { cod: 'Cash on delivery', online: 'Online' };
const PAID_WORDS = { unpaid: 'Not paid yet', paid: 'Paid', refunded: 'Refunded' };
const BY_WORDS = { system: 'the system', customer: 'the customer', seller: 'the shop', admin: 'the admin' };

// Loads every order and draws the list.
async function loadOrders() {
  try {
    const data = await api('GET', '/api/admin/orders');
    clearLoadProblem(ordersMessage);
    if (!dataChanged('admin-orders', data)) return;
    showCounts(data.counts);
    document.getElementById('order-list').replaceChildren(...data.orders.map(orderCard));
    document.getElementById('no-orders').classList.toggle('hidden', data.orders.length > 0);
    document.getElementById('more-orders').classList.toggle('hidden', !data.more);
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    forgetDrawnData('admin-orders');
    showLoadProblem(ordersMessage, error);
  }
}

// "3 orders · Placed 2 · Cancelled 1"
function showCounts(counts) {
  const parts = Object.entries(counts.parts).map(([status, n]) => `${ORDER_STATUS_WORDS[status] || status} ${n}`);
  document.getElementById('counts').textContent = [`${counts.orders} order${counts.orders === 1 ? '' : 's'}`, ...parts].join(' · ');
}

// One customer order: code, time, payment, total, the customer's details, and one box per shop's part.
function orderCard(order) {
  const card = make('article', 'card');
  const top = make('div', 'card-top');
  top.append(make('h2', '', order.code), make('strong', '', formatMoney(order.grand_total)));
  card.append(top);
  card.append(make('p', 'muted', `${formatDateTime(order.created_at)} · ${PAYMENT_WORDS[order.payment_method] || order.payment_method}`
    + ` · items ${formatMoney(order.items_total)} + shipping ${formatMoney(order.shipping_total)}`));
  card.append(make('p', '', `${order.customer_name} · ${order.phone} · ${order.email}`));
  card.append(make('p', 'muted description', order.address));
  card.append(...order.parts.map(partBox));
  return card;
}

// One shop's part: shop, status, products, shipping, commission, payment, reason, and what happened when.
function partBox(part) {
  const box = make('section', 'order-part admin-part');
  const top = make('div', 'card-top');
  top.append(make('h3', '', part.shop_name), orderStatusBadge(part.status));
  box.append(top);
  for (const item of part.items) {
    box.append(make('p', 'small', `${item.quantity} × ${item.name} (${formatMoney(item.unit_price)} each) = ${formatMoney(item.line_total)}`));
  }
  box.append(make('p', 'small', `Items ${formatMoney(part.items_total)} · shipping ${part.shipping === 0 ? 'free' : formatMoney(part.shipping)}`
    + ` · commission ${part.commission_bps / 100}% = ${formatMoney(part.commission)} · ${PAID_WORDS[part.payment_status] || part.payment_status}`));
  if (part.reason) box.append(make('p', 'reason', 'Reason: ' + part.reason));
  if (part.courier) box.append(make('p', 'small', `Courier ${part.courier}, tracking number ${part.tracking_number}`));
  const history = make('ol', 'history');
  for (const step of part.history) {
    history.append(make('li', 'small', `${ORDER_STATUS_WORDS[step.status] || step.status} by ${BY_WORDS[step.by_role] || step.by_role} - ${formatDateTime(step.at)}`));
  }
  box.append(history);
  box.append(adminActions(part, box));
  return box;
}

// Cancel (reason first, then "Cancel order?") and Mark delivered.
function adminActions(part, box) {
  const row = make('div', 'actions');
  const note = make('div', 'message');
  if (['placed', 'accepted', 'packed'].includes(part.status)) {
    const label = make('label', 'visually-hidden', 'Reason for cancelling the part from ' + part.shop_name);
    const reason = make('input');
    reason.id = 'cancel-reason-' + part.id;
    label.htmlFor = reason.id;
    reason.maxLength = 200;
    reason.placeholder = 'Reason to cancel (the customer sees it)';
    reason.addEventListener('input', () => { if (reason.value) reason.dataset.busy = 'yes'; else delete reason.dataset.busy; });
    const confirm = make('span');
    mountKit(confirm, IK.ConfirmButton, {
      label: 'Cancel this part', confirmLabel: 'Cancel order?', hint: 'Press again to cancel this part and refund it if it was paid',
      onConfirm: () => adminMove(`/api/admin/orders/${part.id}/cancel`, { reason: reason.value }, note),
    });
    row.append(label, reason, confirm);
  }
  if (part.status === 'shipped') {
    const deliver = make('button', 'secondary', 'Mark delivered');
    deliver.type = 'button';
    deliver.addEventListener('click', () => adminMove(`/api/admin/orders/${part.id}/deliver`, {}, note));
    row.append(deliver);
  }
  const wrap = make('div');
  wrap.append(row, note);
  return wrap;
}

async function adminMove(address, body, note) {
  try {
    const answer = await api('POST', address, body);
    showMessage(ordersMessage, answer.message, 'ok');
    forgetDrawnData('admin-orders');
    await loadOrders();
  } catch (error) {
    showMessage(note, error.message, 'error');
  }
}

refreshEvery5Seconds(loadOrders);
