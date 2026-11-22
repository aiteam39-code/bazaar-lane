// cart.js - the bag page (the kit says "bag"). The cart (product ids and quantities) is saved in this browser. The server prices it
// (POST /api/cart), so every price, shipping fee and total on this page is the server's. Grouped by shop:
// each shop's items, a FreeShippingMeter, its shipping (free above that shop's limit), its delivery estimate and its
// total, then the grand total (a RollingNumber). Remove asks once (ConfirmButton), then offers Undo in place.

const cartMessage = document.getElementById('message');
let latestAsk = 0; // only the answer to the newest question is drawn, when the quantity is changed quickly

// Asks the server to price the cart, then draws it.
async function loadCart() {
  const cart = readCart();
  if (cart.length === 0) return showEmptyCart();
  const ask = ++latestAsk;
  try {
    const priced = await api('POST', '/api/cart', { items: cart });
    if (ask !== latestAsk) return;
    clearMessage(cartMessage);
    showCart(priced);
  } catch (error) {
    if (ask === latestAsk) showMessage(cartMessage, error.message, 'error');
  }
}

// "Your cart is empty".
function showEmptyCart() {
  latestAsk++;
  document.getElementById('cart-groups').replaceChildren();
  document.getElementById('problems').classList.add('hidden');
  document.getElementById('cart-summary').classList.add('hidden');
  document.getElementById('cart-empty').classList.remove('hidden');
}

// Draws the products that need attention, one box per shop, and the totals.
function showCart(priced) {
  document.getElementById('cart-empty').classList.add('hidden');
  showProblems(priced.problems);
  document.getElementById('cart-groups').replaceChildren(...priced.groups.map(shopGroup));
  document.getElementById('sum-items').textContent = formatMoney(priced.items_total);
  document.getElementById('sum-shipping').textContent = priced.shipping_total === 0 ? 'Free' : formatMoney(priced.shipping_total);
  mountKit(document.getElementById('sum-grand'), IK.RollingNumber, {
    value: priced.grand_total / 100, format: (n) => formatMoney(Math.round(n * 100)), animateOnMount: false, live: true,
  });
  const canCheckOut = priced.problems.length === 0 && priced.groups.length > 0;
  document.getElementById('to-checkout').classList.toggle('hidden', !canCheckOut);
  document.getElementById('fix-first').classList.toggle('hidden', canCheckOut);
  document.getElementById('cart-summary').classList.toggle('hidden', priced.groups.length === 0 && priced.problems.length === 0);
}

// Products that cannot be bought as they are: the server's message, with Remove (and "Change to N" when only N are left).
function showProblems(problems) {
  const box = document.getElementById('problems');
  box.classList.toggle('hidden', problems.length === 0);
  document.getElementById('problem-list').replaceChildren(...problems.map((problem) => {
    const row = make('div', 'problem-row');
    row.append(make('p', '', problem.message));
    const buttons = make('div', 'actions');
    if (problem.left) buttons.append(cartButton(`Change to ${problem.left}`, '', () => setQuantity(problem.product_id, problem.left)));
    buttons.append(cartButton('Remove', 'secondary', () => removeFromCart(problem.product_id)));
    row.append(buttons);
    return row;
  }));
}

// One shop's box: its name, its products, its items total, shipping and shop total.
function shopGroup(group) {
  const box = make('section', 'card cart-group');
  const title = make('h2');
  const shopLink = make('a', '', group.shop_name);
  shopLink.href = '/store/' + encodeURIComponent(group.shop_slug);
  title.append(shopLink);
  box.append(title);
  if (group.free_shipping_over !== null && group.shipping_fee > 0) box.append(freeShippingMeter(group));
  box.append(...group.lines.map(cartLine));
  box.append(totalRow('Items', formatMoney(group.items_total)));
  box.append(totalRow('Shipping', group.shipping === 0 ? 'Free shipping' : formatMoney(group.shipping)));
  box.append(make('p', 'muted small', `Arrives in ${group.delivery.from_days} to ${group.delivery.to_days} days`));
  box.append(totalRow(`Total from ${group.shop_name}`, formatMoney(group.total), 'shop-total'));
  return box;
}

// The kit's meter: "Add ₹20 more for free delivery" from this shop. Shipping is free when the items come to MORE
// than the shop's limit, so the meter's line is the next whole rupee above it (₹499 -> ₹500).
function freeShippingMeter(group) {
  const box = make('div', 'meter-slot');
  box.append(make('p', 'small muted', `From ${group.shop_name}`));
  const meter = make('div');
  box.append(meter);
  mountKit(meter, IK.FreeShippingMeter, {
    subtotal: group.items_total / 100,
    threshold: Math.floor(group.free_shipping_over / 100) + 1,
    unlockedLabel: `Free delivery from ${group.shop_name} unlocked`,
  });
  return box;
}

// One product in the bag: photo, name, price each, - quantity +, line total and Remove.
function cartLine(line) {
  const row = make('div', 'cart-line');
  const picture = productPicture(line, 'line-photo');
  const name = make('a', 'line-name', line.name);
  name.href = '/product/' + line.product_id;
  const details = make('div', 'line-details');
  details.append(name, make('p', 'muted small', `${formatMoney(line.unit_price)} each`));

  const quantity = make('div', 'qty-row');
  const stepper = make('span', 'stepper-slot');
  mountKit(stepper, IK.QuantityStepper, {
    value: line.quantity, min: 1, max: MOST_OF_ONE, size: 'sm', label: 'Quantity of ' + line.name,
    maxHint: `Max ${MOST_OF_ONE} per order`, onChange: (count) => setQuantity(line.product_id, count),
  });
  const remove = make('span', 'remove-slot');
  mountKit(remove, IK.ConfirmButton, {
    label: 'Remove', confirmLabel: 'Remove item?', hint: `Press again to remove ${line.name} from your bag`,
    onConfirm: () => removeFromCart(line),
  });
  quantity.append(stepper, make('strong', 'line-total', formatMoney(line.line_total)), remove);

  row.append(picture, details, quantity);
  return row;
}

// A row like "Items ...... Rs 580".
function totalRow(label, value, extraClass) {
  const row = make('div', 'total-row' + (extraClass ? ' ' + extraClass : ''));
  row.append(make('span', '', label), make('span', '', value));
  return row;
}

// A button with a click action.
function cartButton(text, style, onClick) {
  const button = make('button', style, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

// Sets how many of a product are in the cart (1 to 20), then prices the cart again.
function setQuantity(productId, quantity) {
  const cart = readCart();
  const line = cart.find((l) => l.product_id === productId);
  if (!line) return;
  line.quantity = Math.max(1, Math.min(MOST_OF_ONE, quantity));
  saveCart(cart);
  loadCart();
}

// Takes a product out of the bag, offers Undo in its place, then prices the bag again.
// (A problem row passes just the product id.)
function removeFromCart(lineOrId) {
  const productId = typeof lineOrId === 'object' ? lineOrId.product_id : lineOrId;
  const removed = readCart().find((l) => l.product_id === productId);
  saveCart(readCart().filter((l) => l.product_id !== productId));
  if (removed && typeof lineOrId === 'object') offerUndo(lineOrId.name, removed);
  loadCart();
}

// "Removed Hot Chilli Sauce. Undo" for 8 seconds.
function offerUndo(name, removed) {
  const row = document.getElementById('undo-row');
  const undo = cartButton('Undo', 'secondary', () => {
    const cart = readCart();
    if (!cart.some((l) => l.product_id === removed.product_id)) cart.push(removed);
    saveCart(cart);
    row.classList.add('hidden');
    loadCart();
  });
  row.replaceChildren(make('span', '', `Removed ${name}.`), undo);
  row.classList.remove('hidden');
  clearTimeout(row.hideTimer);
  row.hideTimer = setTimeout(() => row.classList.add('hidden'), 8000);
}

// If the cart changes in another tab, show the new cart here too.
window.addEventListener('storage', (event) => {
  if (event.key === CART_KEY) loadCart();
});

loadCart();
