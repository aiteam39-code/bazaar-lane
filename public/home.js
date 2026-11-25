// home.js - the home page, laid out like a quick-shopping app in our own look: a big banner (the page's one accent,
// "Shop now"), a row of promo cards (the admin switches them on and off), "Shop by category" as a grid of photo tiles,
// then one sideways row of products per category, 6 rows at first and more as the customer scrolls down. Every
// product card shows its true delivery days (its shop's dispatch days + 2 to + 5), its size, its maker and its price,
// and "Add" (the kit's AddToCartButton) turns into the kit's - / + stepper once it is in the bag. Above the tiles: the
// kit's CollectionAccordion of the 5 biggest categories and a "New from makers" grid of the 8 newest ProductCards.
// Old addresses /?search=... and /?category=... move.

const ROWS_AT_A_TIME = 6;
const PRODUCTS_PER_ROW = 12; // the most products one category row shows (routes/home.js sends at most 12)
const TOP_CATEGORIES = 5;
const NEW_PRODUCTS = 8;
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
let nextRowOffset = 0;
let rowsDone = false;
let rowsLoading = false;

// Moves an old home-page search or category address to its own page.
function moveOldAddresses() {
  const query = new URLSearchParams(location.search);
  if (query.get('search')) location.replace('/search?search=' + encodeURIComponent(query.get('search')));
  else if (query.get('category')) location.replace('/category/' + encodeURIComponent(query.get('category')));
  return query.has('search') || query.has('category');
}

// A picture with its text label (empty label for a picture that only decorates).
function picture(src, alt, className) {
  const image = make('img', className || '');
  image.src = src;
  image.alt = alt;
  image.loading = 'lazy';
  image.decoding = 'async';
  return image;
}

// ---------- The banner pictures and the promo cards ----------

// The banner's three pictures (decoration only, so their labels are empty).
function drawBannerPictures(tiles) {
  const host = document.getElementById('banner-pictures');
  host.replaceChildren(...tiles.slice(0, 3).map((tile) => picture(tile.photo_url || placeholderArt(tile.cover_product_id || tile.id), '')));
}

// One promo card: a soft colour, a bold title, a short line, a white "Order now" pill and a photo on the right.
function promoCard(card) {
  const item = make('li', 'promo-item');
  const link = make('a', 'promo-card tone-' + card.tone);
  link.href = card.link;
  const words = make('div', 'promo-words');
  words.append(make('strong', 'promo-title', card.title));
  if (card.line) words.append(make('span', 'promo-line', card.line));
  words.append(make('span', 'promo-pill', 'Order now'));
  link.append(words, picture(card.photo_url || placeholderArt(card.id * 7), '', 'promo-photo'));
  item.append(link);
  return item;
}

// ---------- Top categories (the kit's CollectionAccordion) ----------

// The 5 categories with the most products to buy, as accordion panels that open their category page.
function drawTopCategories(tiles) {
  const top = [...tiles].sort((a, b) => b.product_count - a.product_count || a.name.localeCompare(b.name)).slice(0, TOP_CATEGORIES);
  document.getElementById('top-categories-section').classList.toggle('hidden', top.length === 0);
  if (top.length === 0) return;
  mountKit(document.getElementById('top-categories'), IK.CollectionAccordion, {
    items: top.map((tile) => ({
      id: String(tile.id),
      title: tile.name,
      subtitle: `${tile.product_count} product${tile.product_count === 1 ? '' : 's'}`,
      image: tile.photo_url || placeholderArt(tile.cover_product_id || tile.id),
      href: '/category/' + tile.slug,
      cta: 'Shop ' + tile.name.toLowerCase(),
    })),
  });
}

// ---------- New from makers (the kit's ProductCards) ----------

// The 8 newest products that can be bought; 8 SkeletonCards while they load.
async function loadNewProducts() {
  const grid = document.getElementById('new-products');
  showSkeletons(grid, NEW_PRODUCTS);
  try {
    const data = await api('GET', `/api/products?sort=newest&limit=${NEW_PRODUCTS}`);
    const products = data.products.slice(0, NEW_PRODUCTS);
    grid.replaceChildren(...products.map(productCard));
    document.getElementById('new-section').classList.toggle('hidden', products.length === 0);
  } catch (error) {
    grid.replaceChildren();
    throw error;
  }
}

// ---------- Shop by category ----------

// One tile: a rounded square photo and the name in at most two short lines; it opens the category page.
function categoryTile(tile) {
  const item = make('li');
  const link = make('a', 'category-tile');
  link.href = '/category/' + tile.slug;
  const frame = make('span', 'tile-photo');
  frame.append(picture(tile.photo_url || placeholderArt(tile.cover_product_id || tile.id), tile.name));
  link.append(frame, make('span', 'tile-name', tile.name));
  item.append(link);
  return item;
}

// ---------- Category rows ----------

// One product in a row: photo, delivery chip, name (2 lines), size, maker, price, and Add (then - / +).
function rowCard(product) {
  const card = make('li', 'row-card');
  const link = make('a', 'row-card-link');
  link.href = product.url;
  const frame = make('span', 'row-photo');
  frame.append(picture(product.photo_url || placeholderArt(product.id), product.name));
  const chip = make('span', 'delivery-chip', `${product.delivery.from_days}-${product.delivery.to_days} days`);
  chip.dataset.deliveryChip = `${product.delivery.from_days}-${product.delivery.to_days}`;
  chip.setAttribute('aria-label', `Delivery in ${product.delivery.from_days} to ${product.delivery.to_days} days`);
  frame.append(chip);
  link.append(frame, make('span', 'row-name', product.name));
  card.append(link);
  card.append(make('span', 'row-size', product.size_label || ' '));
  card.append(make('span', 'row-maker', vendorLine(product)));
  if (product.few_left) card.append(make('span', 'row-few', `Only ${product.few_left} left`));
  const foot = make('div', 'row-foot');
  foot.append(make('span', 'row-price', formatMoney(product.price)));
  const control = make('div', 'row-control');
  foot.append(control);
  card.append(foot);
  drawAddControl(control, product);
  return card;
}

// "Add" (the kit's AddToCartButton, ink so the banner keeps the one accent) while the product is not in the bag;
// the kit's stepper once it is.
function drawAddControl(control, product) {
  const quantity = bagQuantityOf(product.id);
  if (quantity > 0) return drawStepper(control, product, quantity);
  const holder = make('div', 'row-add');
  control.replaceChildren(holder);
  mountKit(holder, IK.AddToCartButton, {
    label: 'Add',
    addedLabel: 'Added',
    tone: 'ink',
    size: 'sm',
    'aria-label': `Add ${product.name} to bag`,
    onAdd: () => addToBag(product).then((inBag) => {
      whenTickEnds(holder, () => swapToStepper(control, product));
      return inBag;
    }),
  });
}

// Waits until the kit's button has shown its "Added" tick (the kit's own timing), then calls done.
function whenTickEnds(holder, done) {
  const button = holder.querySelector('button');
  if (!button) return done();
  let tickShown = false;
  const watcher = new MutationObserver(() => {
    if (button.classList.contains('is-done')) tickShown = true;
    else if (tickShown) {
      watcher.disconnect();
      done();
    }
  });
  watcher.observe(button, { attributes: true, attributeFilter: ['class'] });
}

// Swaps the Add button for the stepper; a keyboard user who was on the button lands on the stepper.
function swapToStepper(control, product) {
  const hadFocus = control.contains(document.activeElement);
  drawAddControl(control, product);
  if (hadFocus) {
    requestAnimationFrame(() => {
      const button = control.querySelector('button:not(:disabled)');
      if (button) button.focus();
    });
  }
}

// The kit's - / + stepper for a product in the bag; at 0 the Add button comes back.
function drawStepper(control, product, quantity) {
  const stepper = make('div', 'row-stepper');
  control.replaceChildren(stepper);
  const label = `${product.name} in your bag`;
  const draw = (value) => mountKit(stepper, IK.QuantityStepper, { value, min: 0, max: MOST_OF_ONE, size: 'sm', label, onChange });
  function onChange(wanted) {
    setBagQuantity(product.id, wanted);
    if (wanted === 0) drawAddControl(control, product);
    else draw(wanted);
  }
  draw(quantity);
}

// One category row: the name on the left, "See all" on the right, the products in a sideways row that snaps,
// with round arrows on a laptop (a phone swipes).
function categoryRow(row) {
  const section = make('section', 'category-row');
  const titleId = 'row-title-' + row.category.id;
  section.setAttribute('aria-labelledby', titleId);
  const head = make('div', 'section-head');
  const title = make('h2', '', row.category.name);
  title.id = titleId;
  const seeAll = make('a', 'see-all', 'See all');
  seeAll.href = '/category/' + row.category.slug;
  seeAll.setAttribute('aria-label', 'See all of ' + row.category.name);
  head.append(title, seeAll);
  const shell = make('div', 'row-shell');
  const list = make('ul', 'product-row');
  list.append(...row.products.map(rowCard));
  const back = arrowButton('Back', `Scroll ${row.category.name} back`, -1, list);
  const forward = arrowButton('Next', `Scroll ${row.category.name} forward`, 1, list);
  shell.append(back, list, forward);
  section.append(head, shell);
  const sync = () => {
    back.disabled = list.scrollLeft <= 2;
    forward.disabled = list.scrollLeft + list.clientWidth >= list.scrollWidth - 2;
  };
  list.addEventListener('scroll', sync, { passive: true });
  setTimeout(sync, 0);
  return section;
}

// A round arrow that scrolls a row back or forward by most of its width.
function arrowButton(word, label, direction, list) {
  const button = make('button', 'row-arrow ' + (direction < 0 ? 'is-back' : 'is-next'));
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.append(kitIcon('arrow'));
  button.addEventListener('click', () => {
    list.scrollBy({ left: direction * list.clientWidth * 0.85, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  });
  return button;
}

// Skeleton rows while the next rows load: as many rows as will come, each with as many cards as a row shows.
function skeletonRows(count) {
  return Array.from({ length: count }, () => {
    const section = make('div', 'category-row is-loading');
    section.append(make('div', 'skeleton-title'));
    const list = make('div', 'product-row');
    for (let i = 0; i < PRODUCTS_PER_ROW; i += 1) {
      const slot = make('div', 'row-card');
      mountKit(slot, IK.SkeletonCard, {});
      list.append(slot);
    }
    section.append(list);
    return section;
  });
}

// Loads the next 6 rows (skeletons first). True when new rows came.
async function loadMoreRows() {
  if (rowsDone || rowsLoading) return false;
  rowsLoading = true;
  const host = document.getElementById('category-rows');
  const skeletons = skeletonRows(ROWS_AT_A_TIME);
  host.append(...skeletons);
  try {
    const data = await api('GET', `/api/home/rows?offset=${nextRowOffset}&limit=${ROWS_AT_A_TIME}`);
    skeletons.forEach((skeleton) => skeleton.remove());
    const sections = data.rows.map(categoryRow);
    host.append(...sections);
    nextRowOffset = data.next_offset;
    rowsDone = data.done;
    document.getElementById('rows-more').textContent = rowsDone ? '' : 'Scroll down for more categories.';
    return data.rows.length > 0;
  } catch (error) {
    skeletons.forEach((skeleton) => skeleton.remove());
    showMessage(document.getElementById('message'), error.message, 'error');
    return false;
  } finally {
    rowsLoading = false;
  }
}

// More rows when the customer scrolls near the end of them: one light check every 100 ms while scrolling (it also runs
// after each load, so a tall screen or a quick jump to the end keeps loading until the rows are done).
function markerIsNear() {
  return document.getElementById('rows-more').getBoundingClientRect().top < window.innerHeight + 600;
}

// Keeps loading 6 rows at a time while the end of the rows is near the screen.
async function loadWhileNear() {
  while (!rowsDone && markerIsNear() && await loadMoreRows()) { /* the next 6 */ }
}

// While scrolling: at most one check every 100 ms whether more rows are needed.
let scrollCheckWaiting = false;
function onScroll() {
  if (scrollCheckWaiting) return;
  scrollCheckWaiting = true;
  setTimeout(() => {
    scrollCheckWaiting = false;
    if (!rowsDone && !rowsLoading && markerIsNear()) loadWhileNear();
  }, 100);
}

// ---------- The shops ----------

// The open shops, each as a card that opens its page.
async function loadShops() {
  const data = await api('GET', '/api/shops');
  document.getElementById('shops').replaceChildren(...data.shops.map(shopCard));
  document.getElementById('no-shops').classList.toggle('hidden', data.shops.length > 0);
}

// One shop card: its name, its city (left out when the shop has not set one), its rating and description.
function shopCard(shop) {
  const card = make('a', 'card shop-card');
  card.href = '/store/' + encodeURIComponent(shop.slug);
  card.append(make('h3', '', shop.shop_name));
  if (shop.city) card.append(make('p', 'vendor-line', shop.city));
  card.append(ratingLine(shop.rating, shop.review_count, true), make('p', 'muted', shop.description || 'A new shop.'));
  return card;
}

// ---------- Start ----------

// The banner pictures, promo cards, top categories and category tiles.
async function loadHome() {
  const data = await api('GET', '/api/home');
  drawBannerPictures(data.categories);
  document.getElementById('promo-cards').replaceChildren(...data.promo_cards.map(promoCard));
  document.querySelector('.promo-section').classList.toggle('hidden', data.promo_cards.length === 0);
  drawTopCategories(data.categories);
  document.getElementById('category-tiles').replaceChildren(...data.categories.map(categoryTile));
}

if (!moveOldAddresses()) {
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  Promise.all([loadHome(), loadNewProducts(), loadMoreRows(), loadShops()]).then(loadWhileNear).catch((error) => {
    showMessage(document.getElementById('message'), error.message, 'error');
  });
}
