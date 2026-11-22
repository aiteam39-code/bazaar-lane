// orders.js - "My orders": the orders placed in this browser (remembered after checkout), newest first,
// each with a link to its private tracking page. Nothing here comes from the server.

// Shows one card per remembered order, or "No orders on this device yet".
function showMyOrders() {
  const orders = rememberedOrders();
  document.getElementById('order-list').replaceChildren(...orders.map(myOrderCard));
  document.getElementById('no-orders').classList.toggle('hidden', orders.length > 0);
}

// One order: its code, when it was placed, its total, and "Track this order".
function myOrderCard(order) {
  const card = make('article', 'card');
  const top = make('div', 'card-top');
  top.append(make('h2', '', `Order ${order.code}`));
  if (Number.isSafeInteger(order.total)) top.append(make('strong', '', formatMoney(order.total)));
  card.append(top);
  if (order.at) card.append(make('p', 'muted', 'Placed ' + formatDateTime(order.at)));
  const link = make('a', 'button', 'Track this order');
  link.href = '/track/' + order.token;
  card.append(link);
  return card;
}

showMyOrders();
