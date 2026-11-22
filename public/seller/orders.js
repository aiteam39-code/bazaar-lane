// seller/orders.js - the seller's own orders, in tabs: New (Accept or Reject with a reason), To pack (Packed, then
// Shipped with the courier and tracking number), Shipped (Delivered), and Done. Cash on delivery orders also get
// Cash collected. Each order shows the customer's name, phone and address, the products, the totals, the "Ship by" date
// (in red with the word LATE when it has passed) and any help request, with one reply.
// The server checks every move again (only this shop's orders, only allowed steps).
// Refreshes every 5 seconds, but never while someone is typing; a new order shows a toast.

const TAB_WORDS = { new: 'New', to_pack: 'To pack', shipped: 'Shipped', done: 'Done' };
const ordersMessage = document.getElementById('message');
let currentTab = new URLSearchParams(location.search).get('tab') || 'new';
let newCountSeen = null;

async function loadOrders() {
  try {
    const data = await api('GET', '/api/seller/orders?tab=' + encodeURIComponent(currentTab));
    clearLoadProblem(ordersMessage);
    announceNewOrders(data.counts.new);
    if (!dataChanged('seller-orders', data)) return;
    currentTab = data.tab;
    showTabs(data.counts);
    document.getElementById('order-list').replaceChildren(...data.orders.map(orderCard));
    document.getElementById('no-orders').classList.toggle('hidden', data.orders.length > 0);
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(ordersMessage, error);
  }
}

// A toast when more new orders arrived since the last look, and the badge on the Orders link.
function announceNewOrders(count) {
  setNavBadge('/seller/orders.html', count, 'new orders');
  if (newCountSeen !== null && count > newCountSeen) {
    showToast({ title: 'New order', body: `You have ${count} new order${count === 1 ? '' : 's'} to accept.`, tone: 'success',
      action: { label: 'View', onClick: () => switchTab('new') } });
  }
  newCountSeen = count;
}

function showTabs(counts) {
  document.getElementById('tabs').replaceChildren(...Object.keys(TAB_WORDS).map((tab) => {
    const button = make('button', tab === currentTab ? 'tab active' : 'tab', TAB_WORDS[tab]);
    button.type = 'button';
    if (tab === currentTab) button.setAttribute('aria-current', 'page');
    if (counts[tab] && tab !== 'done') button.append(make('span', 'count', String(counts[tab])));
    button.addEventListener('click', () => switchTab(tab));
    return button;
  }));
}

function switchTab(tab) {
  currentTab = tab;
  history.replaceState(null, '', '?tab=' + tab);
  forgetDrawnData('seller-orders');
  loadOrders();
}

// One order: code, status, Ship by (LATE), payment, customer, products, totals, history, help, and its buttons.
function orderCard(order) {
  const card = make('article', 'card order-card');
  const top = make('div', 'card-top');
  top.append(make('h2', '', order.code), orderStatusBadge(order.status));
  card.append(top);
  if (['placed', 'accepted', 'packed'].includes(order.status)) {
    const shipBy = make('p', order.late ? 'late-line' : 'small', `${order.late ? 'LATE · ' : ''}Ship by ${formatDateTime(order.ship_by)}`);
    card.append(shipBy);
  }
  card.append(make('p', 'small', paymentLine(order)));
  card.append(make('p', '', `${order.customer_name} · ${order.phone}`), make('p', 'small description', order.address));
  const items = make('ul', 'plain-list');
  for (const item of order.items) items.append(make('li', '', `${item.quantity} × ${item.name} (${formatMoney(item.unit_price)} each) = ${formatMoney(item.line_total)}`));
  card.append(items);
  card.append(make('p', 'small', `Items ${formatMoney(order.items_total)} + shipping ${formatMoney(order.shipping)} = ${formatMoney(order.total)} · commission ${order.commission_bps / 100}% = ${formatMoney(order.commission)}`));
  if (order.reason) card.append(make('p', 'reason', 'Reason: ' + order.reason));
  if (order.courier) card.append(make('p', 'small', `Sent with ${order.courier}, tracking number ${order.tracking_number}`));
  if (order.help) card.append(helpBox(order));
  card.append(cardMessage(order.id));
  card.append(actionRow(order, card));
  return card;
}

function paymentLine(order) {
  if (order.payment_method === 'cod') return order.payment_status === 'paid' ? 'Cash on delivery · cash collected' : 'Cash on delivery · collect the cash on delivery';
  return order.payment_status === 'refunded' ? 'Paid online · refunded' : 'Paid online';
}

// The buttons for the order's status.
function actionRow(order, card) {
  const row = make('div', 'actions');
  if (order.status === 'placed') {
    row.append(button('Accept', '', () => move(order, 'accept')));
    row.append(button('Reject', 'secondary', () => askReason(order, card)));
  }
  if (order.status === 'accepted') row.append(button('Packed', '', () => move(order, 'pack')));
  if (order.status === 'packed') row.append(button('Shipped', '', () => askShipping(order, card)));
  if (order.status === 'shipped') row.append(button('Delivered', '', () => move(order, 'deliver')));
  if (order.payment_method === 'cod' && order.payment_status === 'unpaid' && ['shipped', 'delivered'].includes(order.status)) {
    row.append(button('Cash collected', 'secondary', () => move(order, 'cash-collected')));
  }
  return row;
}

// Reject: a reason box, then the kit's ConfirmButton ("Reject order?").
function askReason(order, card) {
  const form = make('div', 'inline-form');
  form.dataset.busy = 'yes'; // the 5-second refresh waits
  const label = make('label', '', 'Why are you rejecting it? The customer sees this.');
  const box = make('textarea');
  box.id = 'reason-' + order.id;
  label.htmlFor = box.id;
  box.maxLength = 200;
  box.rows = 2;
  const confirm = make('span');
  mountKit(confirm, IK.ConfirmButton, {
    label: 'Reject', confirmLabel: 'Reject order?', hint: 'Press again to reject this order',
    onConfirm: () => move(order, 'reject', { reason: box.value }),
  });
  const keep = button('Keep it', 'link-button', () => { forgetDrawnData('seller-orders'); loadOrders(); });
  form.append(label, box, confirm, keep);
  card.append(form);
  box.focus();
}

// Shipped: the courier name and tracking number are both needed.
function askShipping(order, card) {
  const form = make('form', 'inline-form');
  form.dataset.busy = 'yes';
  const courier = field('Courier name', 'courier-' + order.id);
  const tracking = field('Tracking number', 'tracking-' + order.id);
  const send = make('button', '', 'Mark shipped');
  send.type = 'submit';
  form.append(courier.wrap, tracking.wrap, send);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    move(order, 'ship', { courier: courier.input.value, tracking_number: tracking.input.value });
  });
  card.append(form);
  courier.input.focus();
}

// The help request on this order: the customer's message, the reply (one) and the admin's outcome.
function helpBox(order) {
  const box = make('div', 'reason');
  box.append(make('strong', '', order.help.status === 'open' ? 'Help request (open)' : 'Help request (resolved)'));
  box.append(make('p', 'description', order.help.message));
  if (order.help.seller_reply) box.append(make('p', '', 'Your reply: ' + order.help.seller_reply));
  if (order.help.resolution) box.append(make('p', '', 'Outcome: ' + order.help.resolution));
  if (order.help.status === 'open' && !order.help.seller_reply) {
    const reply = make('textarea');
    reply.maxLength = 2000;
    reply.rows = 2;
    reply.id = 'reply-' + order.id;
    const label = make('label', '', 'Your reply (one reply; the customer and the admin see it)');
    label.htmlFor = reply.id;
    box.append(label, reply, button('Send reply', 'secondary', () => move(order, 'help-reply', { reply: reply.value })));
  }
  return box;
}

// Sends one button press to the server, then shows the answer in the card and draws the list again.
async function move(order, action, details = {}) {
  try {
    const answer = await api('POST', `/api/seller/orders/${order.id}/${action}`, details);
    showMessage(ordersMessage, answer.message, 'ok');
    forgetDrawnData('seller-orders');
    await loadOrders();
  } catch (error) {
    const box = document.querySelector(`[data-card-message="${order.id}"]`);
    showMessage(box || ordersMessage, error.message, 'error');
  }
}

function button(text, style, onClick) {
  const element = make('button', style, text);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

function field(labelText, id) {
  const wrap = make('div', 'field');
  const label = make('label', '', labelText);
  const input = make('input');
  input.id = id;
  input.maxLength = 60;
  label.htmlFor = id;
  wrap.append(label, input);
  return { wrap, input };
}

function cardMessage(id) {
  const box = make('div', 'message');
  box.dataset.cardMessage = String(id);
  return box;
}

refreshEvery5Seconds(loadOrders);
