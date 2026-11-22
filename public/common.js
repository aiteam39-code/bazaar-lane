// common.js - helpers shared by every page. Each page loads this file first, then its own script.
// Rule: text from people (names, reasons, descriptions) always goes on the page with textContent, never innerHTML.

// Sends a request to the server and returns its JSON answer.
// When the server says no, it throws an Error with the server's plain message and the status code (error.status).
// When the server cannot be reached at all (for example while it restarts), error.status is 0.
async function api(method, url, body) {
  const options = { method, headers: {}, credentials: 'same-origin' };
  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(url, options);
  } catch (e) {
    const error = new Error('Cannot reach the server right now. Please check that the app is running.');
    error.status = 0;
    throw error;
  }
  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    data = {};
  }
  if (!response.ok) {
    const error = new Error(data.error || 'Something went wrong. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

// Makes a page element with an optional class and text. The text goes in with textContent, so it is never run as HTML.
function make(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

// Shows money saved in paise the kit's way (IK.formatMoney): rupees with Indian grouping, like ₹1,299 or ₹1,24,580.
// Paise are shown only when there are some (₹499.01), so an amount is never rounded. Only for showing: money is
// always stored and worked out in whole paise.
function formatMoney(paise) {
  const decimals = paise % 100 === 0 ? 0 : 2;
  const rupees = paise / 100;
  if (window.IK && IK.formatMoney) return IK.formatMoney(rupees, { decimals });
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', minimumFractionDigits: decimals, maximumFractionDigits: decimals,
  }).format(rupees);
}

// Shows a saved time as a local date and time, like "19 Nov 2026, 10:35 am".
function formatDateTime(isoText) {
  return new Date(isoText).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

// Shows a message in a message box. kind is 'error' or 'ok'. Any other classes on the box are kept.
function showMessage(box, text, kind) {
  box.textContent = text;
  box.classList.remove('error', 'ok');
  box.classList.add('message', kind || 'error');
  delete box.dataset.loadProblem;
}

// Empties a message box.
function clearMessage(box) {
  box.textContent = '';
  box.classList.remove('error', 'ok');
  delete box.dataset.loadProblem;
}

// Staff pages: shows a problem with loading the page's data, for example while the server restarts.
// It goes away by itself as soon as loading works again (see clearLoadProblem).
function showLoadProblem(box, error) {
  showMessage(box, error.message, 'error');
  box.dataset.loadProblem = 'yes';
}

// Empties the message box, but only while it shows a loading problem. A message about a button the person pressed stays.
function clearLoadProblem(box) {
  if (box.dataset.loadProblem) clearMessage(box);
}

// Shows paise as the rupees text for a form box: 25050 -> "250.50", 25000 -> "250".
function paiseToRupeesText(paise) {
  const whole = Math.floor(paise / 100);
  const rest = paise % 100;
  return rest === 0 ? String(whole) : whole + '.' + String(rest).padStart(2, '0');
}

// The marketplace name as the page header shows it (used in page titles).
function siteName() {
  const element = document.querySelector('.site-name');
  return element ? element.textContent : 'Bazaar Lane';
}

// One part of this page's address, decoded: on /store/chilli-lane-pantry, pagePathPart(2) is "chilli-lane-pantry".
function pagePathPart(index) {
  const part = location.pathname.split('/')[index] || '';
  try {
    return decodeURIComponent(part);
  } catch (e) {
    return part;
  }
}

// ---------- The cart: saved in this browser only. The server works out every price and total. ----------

const CART_KEY = 'bazaarCart';     // [{ product_id, quantity }]
const ORDERS_KEY = 'bazaarOrders'; // orders placed in this browser: [{ code, token, total, at }]
const MOST_OF_ONE = 20;            // 1 to 20 of one product (the server checks this too)
const MOST_LINES = 50;             // at most 50 different products

// The cart saved in this browser: [{ product_id, quantity }]. Anything broken in it is left out.
function readCart() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch (e) {
    saved = [];
  }
  if (!Array.isArray(saved)) return [];
  const seen = new Set();
  const cart = [];
  for (const line of saved) {
    // (product numbers have at most 15 digits, like the server reads them; a line it would refuse is dropped here)
    const ok = line && Number.isSafeInteger(line.product_id) && line.product_id > 0 && line.product_id < 1e15
      && !seen.has(line.product_id)
      && Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= MOST_OF_ONE;
    if (ok && cart.length < MOST_LINES) {
      seen.add(line.product_id);
      cart.push({ product_id: line.product_id, quantity: line.quantity });
    }
  }
  return cart;
}

// Saves the cart in this browser and updates every cart badge on the page.
function saveCart(cart) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(cart));
  } catch (e) {
    // Saving is blocked (for example in some private windows): the cart cannot be kept.
  }
  updateCartBadges();
}

// Adds one of a product to the cart (at most 20). Returns how many are in the cart now, or 0 when the cart is full.
function addToCart(productId) {
  const cart = readCart();
  let line = cart.find((l) => l.product_id === productId);
  if (!line) {
    if (cart.length >= MOST_LINES) return 0;
    line = { product_id: productId, quantity: 0 };
    cart.push(line);
  }
  line.quantity = Math.min(MOST_OF_ONE, line.quantity + 1);
  saveCart(cart);
  return line.quantity;
}

// How many items are in the cart, for the badge in the header.
function cartCount() {
  return readCart().reduce((sum, line) => sum + line.quantity, 0);
}

// Writes the cart count into every element marked data-cart-count (the header's Cart button).
function updateCartBadges() {
  if (typeof drawBagCount === 'function') drawBagCount(); // kit pages: the bag count rolls
  const count = cartCount();
  document.querySelectorAll('[data-cart-count]').forEach((element) => { element.textContent = String(count); });
  document.querySelectorAll('[data-cart-link]').forEach((link) => {
    link.setAttribute('aria-label', `Bag, ${count} item${count === 1 ? '' : 's'}`);
  });
}

// Remembers an order placed in this browser, so "My orders" can find it again (newest first, at most 20).
function rememberOrder(order) {
  const orders = rememberedOrders().filter((saved) => saved.token !== order.token);
  orders.unshift(order);
  try {
    localStorage.setItem(ORDERS_KEY, JSON.stringify(orders.slice(0, 20)));
  } catch (e) {
    // Saving is blocked: the tracking link still works, it just is not remembered.
  }
}

// The orders placed in this browser: [{ code, token, total, at }], newest first.
function rememberedOrders() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(ORDERS_KEY) || '[]');
  } catch (e) {
    saved = [];
  }
  if (!Array.isArray(saved)) return [];
  return saved.filter((order) => order && typeof order.code === 'string' && /^[a-f0-9]{64}$/.test(String(order.token)));
}

// ---------- Order statuses ----------

// Every order status in words (a status is never shown by colour alone).
const ORDER_STATUS_WORDS = {
  pending_payment: 'Waiting for payment',
  placed: 'Placed',
  accepted: 'Accepted',
  packed: 'Packed',
  shipped: 'Shipped',
  delivered: 'Delivered',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

// A badge with an order status in words.
function orderStatusBadge(status) {
  return make('span', 'badge status-' + status, ORDER_STATUS_WORDS[status] || status);
}

// Opens a small box under a card: a question, a reason box (if askReason), a red confirm button and a button that
// closes the box (keepText, "Cancel" unless the question is itself about cancelling).
// Used for Hide (needs a reason), Delete and Cancel ("are you sure?"). While it is open, the 5-second refresh waits.
// onConfirm(reason, boxMessage) does the work; the confirm button is switched off while it runs.
function openConfirmBox(card, { question, confirmText, askReason, onConfirm, keepText = 'Cancel' }) {
  closeConfirmBoxes();
  const box = make('div', 'reason-box confirm-box');
  box.dataset.busy = 'yes';
  let input = null;
  if (askReason) {
    input = make('textarea');
    input.id = 'confirm-box-reason';
    input.rows = 3;
    input.maxLength = 200;
    const label = make('label', '', question);
    label.htmlFor = input.id;
    box.append(label, input);
  } else {
    box.append(make('p', 'confirm-question', question));
  }
  const boxMessage = make('div', 'message');
  const confirm = make('button', 'danger', confirmText);
  confirm.type = 'button';
  confirm.addEventListener('click', async () => {
    confirm.disabled = true;
    try {
      await onConfirm(input ? input.value : '', boxMessage);
    } finally {
      confirm.disabled = false;
    }
  });
  const cancel = make('button', 'secondary', keepText);
  cancel.type = 'button';
  cancel.addEventListener('click', closeConfirmBoxes);
  const row = make('div', 'actions');
  row.append(confirm, cancel);
  box.append(boxMessage, row);
  card.append(box);
  (input || cancel).focus();
}

// Closes any open confirm box.
function closeConfirmBoxes() {
  document.querySelectorAll('.confirm-box').forEach((box) => box.remove());
}

// True while someone is typing, choosing from a list, or has a box open (marked data-busy), so a refresh must wait.
function isPersonBusy() {
  const focused = document.activeElement;
  if (focused && ['INPUT', 'TEXTAREA', 'SELECT'].includes(focused.tagName)) return true;
  return document.querySelector('[data-busy]') !== null;
}

// The data each list was last drawn with (as text), so a refresh that brings the same data can leave the list alone.
const lastDrawnData = {};

// True when this data is different from what the list showed last time, so the list must be drawn again.
// When nothing changed, the list stays exactly as it is: no flicker, messages stay, and keyboard users keep their place.
function dataChanged(listName, data) {
  const text = JSON.stringify(data);
  if (lastDrawnData[listName] === text) return false;
  lastDrawnData[listName] = text;
  return true;
}

// Forgets what a list showed, so the next successful load draws it again (used after a loading problem).
function forgetDrawnData(listName) {
  delete lastDrawnData[listName];
}

// Staff pages: runs loadFn now, then every 5 seconds, skipping a turn while the person is busy or the tab is hidden.
function refreshEvery5Seconds(loadFn) {
  loadFn();
  setInterval(() => {
    if (!isPersonBusy() && !document.hidden) loadFn();
  }, 5000);
}

// Staff pages: when the server says "please log in" (401), go to the login page and come back here afterwards.
// Returns true when it is sending the person away.
function goToLoginIfNeeded(error) {
  if (error.status !== 401) return false;
  location.href = '/login.html?next=' + encodeURIComponent(location.pathname + location.search);
  return true;
}

// Puts the marketplace name in every element with class "site-name" and in the browser tab title.
async function fillSiteName() {
  try {
    const info = await api('GET', '/api/info');
    document.querySelectorAll('.site-name').forEach((element) => { element.textContent = info.name; });
    document.title = document.title.replace('Bazaar Lane', info.name);
  } catch (e) {
    // Keep the name already written in the page.
  }
}

// Adds a shopping-bag icon to the browser tab.
function addTabIcon() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1c1a17" stroke-width="1.75"'
    + ' stroke-linecap="round" stroke-linejoin="round">' + KIT_ICONS.bag.map((d) => `<path d="${d}"/>`).join('') + '</svg>';
  const link = document.createElement('link');
  link.rel = 'icon';
  link.href = 'data:image/svg+xml,' + encodeURIComponent(svg);
  document.head.append(link);
}

// Makes every button marked data-logout log the person out and go to the login page.
function setUpLogoutButtons() {
  document.querySelectorAll('[data-logout]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await api('POST', '/api/logout');
      } catch (e) {
        // Even if this fails, go to the login page.
      }
      location.href = '/login.html';
    });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  fillIcons();
  fillSiteName();
  addTabIcon();
  setUpLogoutButtons();
  updateCartBadges();
});

// When the cart changes in another tab, the badge here follows.
window.addEventListener('storage', (event) => {
  if (event.key === CART_KEY) updateCartBadges();
});

// ---------- The Interaction Kit's look (kit/README.md) ----------

// The kit's "night" theme while the computer is in dark mode, else "lane".
// A choice saved with the footer's Theme switch (bazaarTheme) wins over the computer's setting.
let darkModeWatched = false;
function followDarkMode() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => {
    let chosen = '';
    try { chosen = localStorage.getItem('bazaarTheme') || ''; } catch (e) { chosen = ''; }
    document.documentElement.dataset.theme = chosen === 'lane' || chosen === 'night' ? chosen : dark.matches ? 'night' : 'lane';
  };
  apply();
  if (!darkModeWatched) dark.addEventListener('change', apply);
  darkModeWatched = true;
}
followDarkMode();

// The kit's icons (kit/components/src/icons.jsx): 24px, 1.75 stroke, round caps, drawn in the text colour. No emoji.
const KIT_ICONS = {
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  close: ['M6 6l12 12M18 6L6 18'],
  alert: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 7.5v5.5M12 16.5h.01'],
  checkCircle: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M8 12.5l2.8 2.8L16.5 9.5'],
  bag: ['M5 8h14l-1 12H6L5 8z', 'M9 8V6a3 3 0 0 1 6 0v2'],
  arrow: ['M5 12h14M13 6l6 6-6 6'],
};

// One kit icon as an inline SVG element, hidden from screen readers (the words beside it say the same).
function kitIcon(name) {
  const svgSpace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgSpace, 'svg');
  const settings = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.75',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' };
  for (const [name2, value] of Object.entries(settings)) svg.setAttribute(name2, value);
  for (const d of KIT_ICONS[name] || []) {
    const pathElement = document.createElementNS(svgSpace, 'path');
    pathElement.setAttribute('d', d);
    svg.append(pathElement);
  }
  return svg;
}

// Puts the icon named in data-icon into every element that has one, like <div data-icon="bag"></div>.
function fillIcons() {
  document.querySelectorAll('[data-icon]').forEach((element) => element.replaceChildren(kitIcon(element.dataset.icon)));
}

// A product's picture (4:5): its photo, or the kit's placeholder art (IK.demo.art) when it has none yet.
// The product's name always comes right after it, so the picture itself is not read out.
function productPicture(product, className) {
  const picture = make('img', className);
  picture.alt = '';
  picture.loading = 'lazy';
  const source = product.photo_url || placeholderArt(product.id || product.product_id);
  if (source) picture.src = source;
  return picture;
}

// The kit's placeholder art for a product without a photo, always the same one for the same product.
function placeholderArt(productId) {
  if (!window.IK || !IK.demo) return '';
  const kinds = IK.demo.artKinds;
  return IK.demo.art(kinds[(Number(productId) || 0) % kinds.length]);
}
