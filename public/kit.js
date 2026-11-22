// kit.js - puts the Interaction Kit's pieces (window.IK, React 18) into the plain HTML pages, without JSX or a build
// step. Pages load React, ReactDOM, the kit's bundle, common.js and then this file.
// It also builds the header and footer of every customer page, the bag count, toasts and the wishlist.
// Rule: text from people always goes in as React text or textContent, never as HTML.

const h = React.createElement;
const kitRoots = new WeakMap();

// Draws a kit component into an element (again, when called again for the same element).
function mountKit(element, component, props) {
  let root = kitRoots.get(element);
  if (!root) {
    root = ReactDOM.createRoot(element);
    kitRoots.set(element, root);
  }
  root.render(h(component, props));
}

// Money in paise as the kit shows it: ₹1,299 (paise only when there are some).
const rupeesOf = (paise) => paise / 100;

// ---------- Toasts: "Added to bag" and other short notes, one stack per page ----------

let toastList = [];
let toastCounter = 0;
let toastHost = null;

// Shows a toast: { title, body, tone ('neutral' | 'success' | 'danger'), thumb (a photo), action ({ label, onClick }) }.
function showToast(toast) {
  toastCounter += 1;
  toastList = [...toastList, { ...toast, id: 'toast-' + toastCounter }].slice(-5);
  drawToasts();
}

function drawToasts() {
  if (!toastHost) {
    toastHost = make('div', 'toast-host');
    document.body.append(toastHost);
  }
  const placement = window.matchMedia('(max-width: 640px)').matches ? 'bottom-center' : 'bottom-right';
  mountKit(toastHost, IK.ToastStack, {
    toasts: toastList,
    placement,
    onDismiss: (id) => { toastList = toastList.filter((toast) => toast.id !== id); drawToasts(); },
  });
}

// ---------- The bag ----------

// Adds a product to the bag (in this browser) and shows the "Added to bag" toast with its photo and View bag.
// Returns a promise, so the kit's add button shows its tick, or "Try again" when the bag is full.
function addToBag(product, quantity = 1) {
  let inBag = 0;
  for (let i = 0; i < quantity; i += 1) inBag = addToCart(product.id);
  if (inBag === 0) return Promise.reject(new Error('Your bag is full.'));
  showToast({
    title: (window.SEASON_WORDS && SEASON_WORDS.added) || 'Added to bag', // a season may warm the words
    body: inBag === MOST_OF_ONE ? `${product.name} · ${MOST_OF_ONE} in your bag, the most for one order` : product.name,
    thumb: product.photo_url || placeholderArt(product.id),
    action: { label: 'View bag', onClick: () => { location.href = '/cart.html'; } },
  });
  return Promise.resolve(inBag);
}

// The bag count in the header rolls when it changes (RollingNumber).
// The bag in the header: the count and the total roll when they change; the button is greyed out while the bag is
// empty. The total always comes from the server (POST /api/cart), never from the browser's own maths.
let bagTotalAsk = 0;
function drawBagCount() {
  const count = cartCount();
  document.querySelectorAll('[data-bag-count]').forEach((element) => {
    mountKit(element, IK.RollingNumber, { value: count, animateOnMount: false });
  });
  document.querySelectorAll('[data-bag-link]').forEach((link) => {
    link.classList.toggle('is-empty', count === 0);
    link.setAttribute('aria-label', count === 0 ? 'Bag, empty' : `Bag, ${count} item${count === 1 ? '' : 's'}`);
  });
  drawBagTotal(count);
}

async function drawBagTotal(count) {
  const totals = document.querySelectorAll('[data-bag-total]');
  if (totals.length === 0) return;
  const ask = ++bagTotalAsk;
  let paise = 0;
  if (count > 0) {
    try {
      paise = (await api('POST', '/api/cart', { items: readCart() })).grand_total;
    } catch (e) {
      paise = 0;
    }
  }
  if (ask !== bagTotalAsk) return; // a newer change is on its way
  totals.forEach((element) => {
    element.classList.toggle('hidden', count === 0);
    mountKit(element, IK.RollingNumber, { value: paise / 100, format: (n) => formatMoney(Math.round(n * 100)), animateOnMount: false });
  });
}

// Sets how many of one product are in the bag (0 takes it out). Returns the new quantity.
function setBagQuantity(productId, quantity) {
  const cart = readCart();
  const line = cart.find((l) => l.product_id === productId);
  const wanted = Math.max(0, Math.min(MOST_OF_ONE, quantity));
  if (!line && wanted > 0) cart.push({ product_id: productId, quantity: wanted });
  if (line) line.quantity = wanted;
  saveCart(cart.filter((l) => l.quantity > 0));
  return wanted;
}

// How many of one product are in the bag now.
function bagQuantityOf(productId) {
  const line = readCart().find((l) => l.product_id === productId);
  return line ? line.quantity : 0;
}

// ---------- The wishlist (saved in this browser only) ----------

const WISHLIST_KEY = 'bazaarWishlist';

function readWishlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]');
    return Array.isArray(saved) ? saved.filter((id) => Number.isSafeInteger(id) && id > 0).slice(0, 200) : [];
  } catch (e) {
    return [];
  }
}

function setWishlisted(productId, saved) {
  const list = readWishlist().filter((id) => id !== productId);
  if (saved) list.push(productId);
  try {
    localStorage.setItem(WISHLIST_KEY, JSON.stringify(list));
  } catch (e) {
    // Saving is blocked: the heart still works on this page.
  }
}

// ---------- Product cards ----------

// "Chilli Lane Pantry · Jaipur": every product names its maker.
function vendorLine(product) {
  return product.city ? `${product.shop_name} · ${product.city}` : product.shop_name;
}

// One kit ProductCard (photo, heart, vendor line, name, price, Quick add), in its own element.
function productCard(product) {
  const box = make('div', 'card-slot');
  mountKit(box, IK.ProductCard, {
    title: product.name,
    vendor: vendorLine(product),
    price: rupeesOf(product.price),
    images: [product.photo_url || placeholderArt(product.id)],
    alt: product.name,
    badge: product.few_left ? `Only ${product.few_left} left` : undefined,
    href: product.url || '/product/' + product.id,
    soldOut: product.sold_out,
    defaultWishlisted: readWishlist().includes(product.id),
    onWishlistChange: (saved) => setWishlisted(product.id, saved),
    onAdd: () => addToBag(product),
  });
  return box;
}

// SkeletonCards while products load: exactly as many as the page will show.
function showSkeletons(grid, count) {
  const slots = Array.from({ length: count }, () => {
    const box = make('div', 'card-slot');
    mountKit(box, IK.SkeletonCard, {});
    return box;
  });
  grid.replaceChildren(...slots);
}

// ---------- Stars (inline SVG in the kit's colours, with the number written beside them) ----------

// "4.6 out of 5 (12 reviews)" with 5 stars, or "No reviews yet".
function ratingLine(rating, count, small) {
  const line = make('p', small ? 'rating-line small' : 'rating-line');
  if (!count) {
    line.append(make('span', 'muted', 'No reviews yet'));
    return line;
  }
  line.append(starRow(rating), make('span', '', `${Number(rating).toFixed(1)} out of 5 (${count} review${count === 1 ? '' : 's'})`));
  return line;
}

// 5 stars, filled up to the rating (rounded to the nearest whole star). Hidden from screen readers: the words say it.
function starRow(rating) {
  const svgSpace = 'http://www.w3.org/2000/svg';
  const row = make('span', 'stars');
  row.setAttribute('aria-hidden', 'true');
  for (let i = 1; i <= 5; i += 1) {
    const svg = document.createElementNS(svgSpace, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', i <= Math.round(rating) ? 'star is-on' : 'star');
    const path = document.createElementNS(svgSpace, 'path');
    path.setAttribute('d', 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z');
    svg.append(path);
    row.append(svg);
  }
  return row;
}

// ---------- The customer header and footer ----------

// The header of every customer page (it stays on top while scrolling): the name and the delivery line (the real
// range from the open shops' dispatch days, and the customer's own city or PIN code, saved in this browser), a big
// search box whose example word changes every 3 seconds (real product words; it stops while the box has focus and
// with reduced motion), Log in, and the bag with its rolling count and total (greyed out when empty). Under them:
// the Categories menu, "Sell on Bazaar Lane" and My orders.
const PLACE_KEY = 'bazaarPlace';
function buildCustomerHeader(host) {
  const bar = make('div', 'bar shop-bar');
  const brand = make('a', 'brand', siteName());
  brand.href = '/';
  brand.classList.add('site-name');
  const brandBox = make('div', 'brand-box');
  brandBox.append(brand, deliveryLine());

  const search = make('form', 'header-search');
  search.action = '/search';
  search.method = 'get';
  search.setAttribute('role', 'search');
  const label = make('label', 'visually-hidden', 'Search products');
  label.htmlFor = 'header-search-box';
  const box = make('input');
  box.id = 'header-search-box';
  box.name = 'search';
  box.type = 'search';
  box.maxLength = 60;
  box.placeholder = 'Search pickles, pots, stoles';
  box.value = new URLSearchParams(location.search).get('search') || '';
  const go = make('button', 'secondary', 'Search');
  go.type = 'submit';
  search.append(label, box, go);

  const right = make('div', 'header-right');
  const login = make('a', 'login-link', 'Log in');
  login.href = '/login.html';
  const bag = make('a', 'bag-link');
  bag.href = '/cart.html';
  bag.dataset.bagLink = '';
  const count = make('span', 'bag-count');
  count.dataset.bagCount = '';
  const total = make('span', 'bag-total hidden');
  total.dataset.bagTotal = '';
  bag.append(kitIcon('bag'), make('span', 'bag-word', 'Bag'), count, total);
  right.append(login, bag);

  const nav = make('nav', 'header-links');
  nav.setAttribute('aria-label', 'Shop');
  const menu = make('details', 'category-menu');
  const summary = make('summary', '', 'Categories');
  const list = make('ul', 'category-menu-list');
  menu.append(summary, list);
  const sell = make('a', 'sell-link', 'Sell on ' + siteName());
  sell.href = '/sell';
  const orders = make('a', '', 'My orders');
  orders.href = '/orders.html';
  nav.append(menu, sell, orders);

  bar.append(brandBox, search, right, nav);
  host.replaceChildren(bar);
  fillCategoryMenu(list);
  drawBagCount();
  fillHeaderFacts(host, box);
  compactOnScroll(host);
}

// On a phone the header shrinks to the name, bag and search once the customer has scrolled down (CSS decides the
// width), so the sticky header never covers much of the page. The space it gives up is kept below it as a margin, so
// the page itself never jumps.
function compactOnScroll(host) {
  let compact = false;
  const update = () => {
    const wanted = window.scrollY > 120 || (compact && window.scrollY > 40); // a gap, so it never flickers
    if (wanted === compact) return;
    compact = wanted;
    const before = host.offsetHeight;
    host.classList.toggle('is-compact', compact);
    host.style.marginBottom = compact ? Math.max(before - host.offsetHeight, 0) + 'px' : '';
  };
  window.addEventListener('scroll', update, { passive: true });
  update();
}

// "Delivery in 4 to 8 days" and the customer's place ("Jaipur 302001"), with a small form to change the place.
function deliveryLine() {
  const line = make('details', 'delivery-line');
  const summary = make('summary', '');
  const days = make('strong', 'delivery-days', 'Delivery in a few days');
  const place = make('span', 'delivery-place', readPlace() || 'Add your city or PIN code');
  summary.append(days, place);
  const form = make('form', 'place-form');
  const label = make('label', '', 'Your city or 6-digit PIN code');
  const input = make('input');
  input.id = 'place-box';
  input.maxLength = 40;
  input.value = readPlace();
  input.autocomplete = 'postal-code';
  label.htmlFor = input.id;
  const save = make('button', 'secondary', 'Save');
  save.type = 'submit';
  const note = make('p', 'small muted', 'Kept only in this browser. Each shop still shows its own delivery days.');
  form.append(label, input, save, note);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim().replace(/\s+/g, ' ').slice(0, 40);
    try {
      if (text) localStorage.setItem(PLACE_KEY, text);
      else localStorage.removeItem(PLACE_KEY);
    } catch (e) {
      // Saving is blocked: it still shows on this page.
    }
    place.textContent = text || 'Add your city or PIN code';
    line.open = false;
  });
  line.append(summary, form);
  return line;
}

function readPlace() {
  try {
    return localStorage.getItem(PLACE_KEY) || '';
  } catch (e) {
    return '';
  }
}

// Fills the real delivery days and starts the search box's example words.
async function fillHeaderFacts(host, box) {
  let facts = null;
  try {
    facts = await api('GET', '/api/header');
  } catch (e) {
    return;
  }
  const days = host.querySelector('.delivery-days');
  if (facts.delivery) days.textContent = `Delivery in ${facts.delivery.from_days} to ${facts.delivery.to_days} days`;
  rotateSearchWords(box, facts.search_words || []);
}

// 'Search "pickle"', then another real word every 3 seconds; not while the box has focus or text, nor with
// reduced motion (then the first word stays).
function rotateSearchWords(box, words) {
  if (words.length === 0) return;
  let index = 0;
  const show = () => { box.placeholder = `Search "${words[index % words.length]}"`; };
  show();
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  setInterval(() => {
    if (document.activeElement === box || box.value || document.hidden) return;
    index += 1;
    show();
  }, 3000);
}

// The Categories menu: every category with its clean address.
async function fillCategoryMenu(list) {
  try {
    const data = await api('GET', '/api/categories');
    list.replaceChildren(...data.categories.map((category) => {
      const item = make('li');
      const link = make('a', '', `${category.name} (${category.product_count})`);
      link.href = '/category/' + category.slug;
      item.append(link);
      return item;
    }));
  } catch (e) {
    list.replaceChildren(make('li', 'muted', 'Categories could not load.'));
  }
}

// The footer of every customer page: the help and policy pages, Sell on Bazaar Lane and the staff log in.
const FOOTER_LINKS = [
  ['About', '/about'], ['How it works', '/how-it-works'], ['Sell with us', '/sell'], ['FAQ', '/faq'], ['Contact', '/contact'],
  ['Terms', '/terms'], ['Privacy', '/privacy'], ['Refunds and returns', '/refunds'], ['Shipping', '/shipping'],
  ['Seller guidelines', '/seller-guidelines'], ['Find my orders', '/find-my-orders.html'], ['Seller or admin log in', '/login.html'],
];
function buildCustomerFooter(host) {
  const nav = make('nav', 'footer-links');
  nav.setAttribute('aria-label', 'Help and policies');
  for (const [text, address] of FOOTER_LINKS) {
    const link = make('a', '', text);
    link.href = address;
    nav.append(link);
  }
  host.replaceChildren(nav);
  if (typeof buildFooterExtras === 'function') buildFooterExtras(host); // the newsletter and theme switch (sector 9)
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-customer-header]').forEach(buildCustomerHeader);
  document.querySelectorAll('[data-customer-footer]').forEach(buildCustomerFooter);
});
window.addEventListener('storage', (event) => {
  if (event.key === CART_KEY) drawBagCount();
});

// ---------- The staff header (seller and admin pages) ----------

const STAFF_LINKS = {
  seller: [
    ['Home', '/seller/'], ['Orders', '/seller/orders.html'], ['Products', '/seller/products.html'],
    ['Reviews', '/seller/reviews.html'], ['Earnings', '/seller/earnings.html'], ['Shop settings', '/seller/settings.html'],
  ],
  admin: [
    ['Home', '/admin/'], ['Shops', '/admin/shops.html'], ['Products', '/admin/products.html'], ['Orders', '/admin/orders.html'],
    ['Payments', '/admin/payments.html'], ['Commissions', '/admin/commissions.html'], ['Payouts', '/admin/payouts.html'],
    ['Help requests', '/admin/help.html'], ['Reviews', '/admin/reviews.html'], ['Reports', '/admin/reports.html'],
    ['Messages', '/admin/messages.html'], ['Outbox', '/admin/outbox.html'], ['Seasons', '/admin/seasons.html'],
    ['Promo cards', '/admin/promo-cards.html'],
  ],
};

// The header of every seller and admin page: the name, "Seller" or "Admin", the pages, and Log out.
function buildStaffHeader(host) {
  const role = host.dataset.staffHeader;
  const bar = make('div', 'bar staff-bar');
  const brand = make('a', 'brand site-name', siteName());
  brand.href = role === 'admin' ? '/admin/' : '/seller/';
  const tag = make('span', 'role-tag', role === 'admin' ? 'Admin' : 'Seller');
  const nav = make('nav', 'staff-links');
  nav.setAttribute('aria-label', role === 'admin' ? 'Admin pages' : 'Seller pages');
  const here = location.pathname.replace(/index\.html$/, '');
  for (const [text, address] of STAFF_LINKS[role]) {
    const link = make('a', '', text);
    link.href = address;
    if (address === here) link.setAttribute('aria-current', 'page');
    link.dataset.navFor = address;
    nav.append(link);
  }
  const logout = make('button', 'secondary', 'Log out');
  logout.type = 'button';
  logout.dataset.logout = '';
  bar.append(brand, tag, nav, logout);
  host.replaceChildren(bar);
}

// A small count badge on a staff link, like Orders (3); 0 removes it. The words say what it counts.
function setNavBadge(address, count, words) {
  const link = document.querySelector(`[data-nav-for="${address}"]`);
  if (!link) return;
  let badge = link.querySelector('.count');
  if (!count) return badge && badge.remove();
  if (!badge) {
    badge = make('span', 'count');
    link.append(badge);
  }
  badge.textContent = String(count);
  badge.setAttribute('aria-label', `${count} ${words}`);
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-staff-header]').forEach(buildStaffHeader);
  if (document.querySelector('[data-staff-header]')) setUpLogoutButtons(); // the header's Log out was made after common.js looked
}, { once: true });

// ---------- The footer extras: the newsletter, the light/night switch and the sound switch ----------

const THEME_KEY = 'bazaarTheme';  // 'lane', 'night' or empty (follow the computer)
const SOUND_KEY = 'bazaarSound';  // 'on' or empty (off: the kit's sound is off by default)

function buildFooterExtras(host) {
  const extras = make('div', 'footer-extras');
  extras.append(newsletterForm(), themeSwitch(), soundSwitch());
  host.append(extras);
}

// The newsletter: an email and a consent box; the server saves it and emails a link to stop.
function newsletterForm() {
  const form = make('form', 'newsletter');
  form.noValidate = true;
  form.append(make('p', 'footer-title', 'News from the makers, about once a month'));
  const label = make('label', 'visually-hidden', 'Your email for the newsletter');
  const email = make('input');
  email.id = 'newsletter-email';
  email.type = 'email';
  email.maxLength = 100;
  email.placeholder = 'Your email';
  email.autocomplete = 'email';
  label.htmlFor = email.id;
  const consent = make('label', 'choice small');
  const box = make('input');
  box.type = 'checkbox';
  consent.append(box, ' Yes, you may email me. I can stop at any time.');
  const note = make('div', 'message');
  const send = make('button', 'secondary', 'Sign up');
  send.type = 'submit';
  const row = make('div', 'search-row');
  row.append(label, email, send);
  form.append(row, consent, note);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const answer = await api('POST', '/api/newsletter', { email: email.value, consent: box.checked });
      showMessage(note, answer.message, 'ok');
      form.reset();
    } catch (error) {
      showMessage(note, error.message, 'error');
    }
  });
  return form;
}

// Light / Night / Same as my computer, remembered in this browser.
function themeSwitch() {
  const wrap = make('div', 'footer-switch');
  const label = make('label', '', 'Theme');
  const choice = make('select');
  choice.id = 'theme-choice';
  label.htmlFor = choice.id;
  for (const [value, text] of [['', 'Same as my computer'], ['lane', 'Light'], ['night', 'Night']]) {
    const option = make('option', '', text);
    option.value = value;
    choice.append(option);
  }
  choice.value = readSetting(THEME_KEY);
  choice.addEventListener('change', () => {
    saveSetting(THEME_KEY, choice.value);
    followDarkMode();
  });
  wrap.append(label, choice);
  return wrap;
}

// Sound: off by default; when on, the kit plays its four short sounds (added to bag, paid, error, tick).
function soundSwitch() {
  const button = make('button', 'secondary', '');
  button.type = 'button';
  const draw = () => {
    const on = readSetting(SOUND_KEY) === 'on';
    button.textContent = on ? 'Sound: on' : 'Sound: off';
    button.setAttribute('aria-pressed', String(on));
    if (window.IK && IK.sound) { if (on) IK.sound.enable(); else if (IK.sound.disable) IK.sound.disable(); }
  };
  button.addEventListener('click', () => {
    saveSetting(SOUND_KEY, readSetting(SOUND_KEY) === 'on' ? '' : 'on');
    draw();
  });
  draw();
  return button;
}

function readSetting(key) {
  try {
    return localStorage.getItem(key) || '';
  } catch (e) {
    return '';
  }
}

function saveSetting(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (e) {
    // Saving is blocked: the choice still works on this page.
  }
}
