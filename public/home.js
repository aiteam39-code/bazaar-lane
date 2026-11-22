// home.js - the home page, laid out like a quick-shopping app in our own look: a big banner (the page's one accent,
// "Shop now"), a row of promo cards (the admin switches them on and off), "Shop by category" as a grid of photo tiles,
// then one sideways row of products per category, 6 rows at first and more as the customer scrolls down. Every
// product card shows its true delivery days (its shop's dispatch days + 2 to + 5), its size, its maker and its price,
// and "Add" turns into a - / + stepper once it is in the bag. Old addresses /?search=... and /?category=... move.

const ROWS_AT_A_TIME = 6;
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
  drawAddControl(control, product, false);
  return card;
}

// "Add" while the product is not in the bag; the kit's stepper (with a tick right after adding) once it is.
function drawAddControl(control, product, justAdded) {
  const quantity = bagQuantityOf(product.id);
  if (quantity === 0) {
    const add = make('button', 'add-button', 'Add');
    add.type = 'button';
    add.setAttribute('aria-label', `Add ${product.name} to bag`);
    add.addEventListener('click', () => {
      addToBag(product).then(() => {
        drawAddControl(control, product, true);
        const stepperButton = control.querySelector('button');
        if (stepperButton) stepperButton.focus(); // keyboard users stay on the card
      }).catch(() => {});
    });
    control.replaceChildren(add);
    return;
  }
  const holder = make('div', 'row-stepper');
  const tick = make('span', 'added-tick' + (justAdded ? ' is-on' : ''));
  tick.append(kitIcon('check'));
  holder.append(tick);
  const stepper = make('div');
  holder.append(stepper);
  control.replaceChildren(holder);
  const label = `${product.name} in your bag`;
  const drawStepper = (value) => mountKit(stepper, IK.QuantityStepper, { value, min: 0, max: MOST_OF_ONE, size: 'sm', label, onChange });
  function onChange(wanted) {
    setBagQuantity(product.id, wanted);
    if (wanted === 0) drawAddControl(control, product, false);
    else drawStepper(wanted);
  }
  drawStepper(quantity);
  if (justAdded) setTimeout(() => tick.classList.remove('is-on'), 1600);
}

// One category row: the name on the left, "See all" on the right, the products in a sideways row that snaps,
// with round arrows on a laptop (a phone swipes).
function categoryRow(row) {
  const section = make('section', 'category-row reveal');
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

// Skeleton rows while the next rows load.
function skeletonRows(count) {
  return Array.from({ length: count }, () => {
    const section = make('div', 'category-row is-loading');
    section.append(make('div', 'skeleton-title'));
    const list = make('div', 'product-row');
    for (let i = 0; i < 5; i += 1) {
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
  const skeletons = skeletonRows(Math.min(2, ROWS_AT_A_TIME));
  host.append(...skeletons);
  try {
    const data = await api('GET', `/api/home/rows?offset=${nextRowOffset}&limit=${ROWS_AT_A_TIME}`);
    skeletons.forEach((skeleton) => skeleton.remove());
    const sections = data.rows.map(categoryRow);
    host.append(...sections);
    sections.forEach(watchReveal);
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

async function loadWhileNear() {
  while (!rowsDone && markerIsNear() && await loadMoreRows()) { /* the next 6 */ }
}

let scrollCheckWaiting = false;
function onScroll() {
  if (scrollCheckWaiting) return;
  scrollCheckWaiting = true;
  setTimeout(() => {
    scrollCheckWaiting = false;
    revealVisible();
    if (!rowsDone && !rowsLoading && markerIsNear()) loadWhileNear();
  }, 100);
}

// ---------- Sections fade and rise once as they come into view (not with reduced motion) ----------

function watchReveal(element) {
  if (reduceMotion.matches) return;
  element.classList.add('will-reveal');
  setTimeout(revealVisible, 0);
}

// Every waiting section that is on the screen, or already above it, shows (so nothing is ever left hidden).
function revealVisible() {
  document.querySelectorAll('.will-reveal:not(.is-in)').forEach((element) => {
    if (element.getBoundingClientRect().top < window.innerHeight - 40) element.classList.add('is-in');
  });
}

// ---------- The shops ----------

async function loadShops() {
  const data = await api('GET', '/api/shops');
  document.getElementById('shops').replaceChildren(...data.shops.map(shopCard));
  document.getElementById('no-shops').classList.toggle('hidden', data.shops.length > 0);
}

function shopCard(shop) {
  const card = make('a', 'card shop-card');
  card.href = '/store/' + encodeURIComponent(shop.slug);
  card.append(
    make('h3', '', shop.shop_name),
    make('p', 'vendor-line', shop.city || 'City not set yet'),
    ratingLine(shop.rating, shop.review_count, true),
    make('p', 'muted', shop.description || 'A new shop.')
  );
  return card;
}

// ---------- Start ----------

async function loadHome() {
  const data = await api('GET', '/api/home');
  drawBannerPictures(data.categories);
  document.getElementById('promo-cards').replaceChildren(...data.promo_cards.map(promoCard));
  document.querySelector('.promo-section').classList.toggle('hidden', data.promo_cards.length === 0);
  document.getElementById('category-tiles').replaceChildren(...data.categories.map(categoryTile));
}

if (!moveOldAddresses()) {
  document.querySelectorAll('.reveal').forEach(watchReveal);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  Promise.all([loadHome(), loadMoreRows(), loadShops()]).then(loadWhileNear).catch((error) => {
    showMessage(document.getElementById('message'), error.message, 'error');
  });
}
