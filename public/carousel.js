// carousel.js - the rotating 3D product carousel. One reusable piece, used on the home page (for a chosen category),
// on the category pages and on the shop pages.
//
// How it works: every product is a card shaped like a product box, with its photo on the front. This file only decides where each card stands,
// by giving it an offset: 0 is the middle, -1 and 1 its neighbours, up to 3 on each side ("far-left" and "far-right"
// are hidden). The CSS ("The rotating carousel" in style.css) turns each offset into a place on a 3D ring and moves
// the cards there with transform and opacity only, so it stays smooth on a cheap phone.
//
// It turns one product at a time with: the arrow buttons, the left and right arrow keys, the mouse wheel or trackpad
// while the pointer is over it, a sideways swipe, or a click on a side product. After the last product it goes round
// to the first. It turns by itself every 4 seconds while nobody is using it. With "reduce motion" switched on, there is
// no animation and no turning by itself; the arrows and keys still switch products instantly.
// Its timings are the kit's: one turn takes --dur-slow, a category swing --dur-base (kit/tokens.css).

const CAROUSEL_SIDE = 3;       // at most 3 products on each side of the middle
const CAROUSEL_AUTO_MS = 4000; // it turns by itself every 4 seconds while nobody is using it
const SWIPE_PIXELS = 40;       // a sideways swipe of at least 40 pixels turns it

// Reads one of the kit's timing tokens (like "--dur-slow: 520ms") in milliseconds; fallback when it cannot be read.
function kitDurationMs(tokenName, fallback) {
  const text = getComputedStyle(document.documentElement).getPropertyValue(tokenName).trim();
  const number = parseFloat(text);
  if (!Number.isFinite(number)) return fallback;
  return text.endsWith('ms') ? number : number * 1000;
}

// One turn takes as long as the kit's --dur-slow (520 ms).
function carouselTurnMs() {
  return kitDurationMs('--dur-slow', 520);
}

// Picking another category: the old products swing out for the kit's --dur-base (240 ms).
function carouselSwingMs() {
  return kitDurationMs('--dur-base', 240);
}

// True when the person asked their computer or phone for less motion.
function wantsLessMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

class ProductCarousel {
  // Builds an empty carousel inside host (an element on the page). label is read out by screen readers.
  constructor(host, label) {
    this.products = [];
    this.cards = [];
    this.nameItems = [];
    this.offsets = [];
    this.current = 0;          // the product in the middle
    this.direction = 1;        // the way it turned last: 1 = to the next product, -1 = back
    this.pointerOver = false;  // the mouse is over the carousel
    this.touching = false;     // a finger is on the carousel
    this.autoTimer = null;
    this.swingTimer = null;
    this.wheel = { sum: 0, lastAt: 0, turned: false };
    this.drag = null;
    this.ignoreClicksUntil = 0;
    this.turnedAt = 0;         // when it last started turning
    this.buildParts(label);
    host.replaceChildren(this.section);
    this.listen();
  }

  // The parts: the stage with the ring of cards and the two arrow buttons, the name strip, the details of the middle
  // product, a line for screen readers, and "Nothing here yet".
  buildParts(label) {
    this.section = make('section', 'carousel');
    this.section.setAttribute('aria-roledescription', 'carousel');
    this.section.tabIndex = 0;
    this.stage = make('div', 'carousel-stage');
    this.ring = make('div', 'carousel-ring');
    this.prevButton = this.arrowButton('carousel-arrow prev', 'Previous product', -1);
    this.nextButton = this.arrowButton('carousel-arrow next', 'Next product', 1);
    this.stage.append(this.ring, this.prevButton, this.nextButton);
    this.names = make('div', 'carousel-names');
    this.names.setAttribute('aria-hidden', 'true'); // the details below say the same in words
    this.details = make('div', 'carousel-details');
    this.status = make('p', 'visually-hidden');
    this.empty = make('p', 'carousel-empty hidden', 'Nothing here yet');
    this.section.append(this.stage, this.names, this.details, this.status, this.empty);
    this.setLabel(label);
  }

  // One arrow button (48 pixels) with the kit's arrow icon (style.css turns it round for "previous").
  // steps: -1 for the previous product, 1 for the next.
  arrowButton(className, label, steps) {
    const button = make('button', className);
    button.append(kitIcon('arrow'));
    button.type = 'button';
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => this.turn(steps, true));
    return button;
  }

  // The name screen readers use for the carousel, like "Food and spices: products".
  setLabel(label) {
    this.section.setAttribute('aria-label', label);
  }

  // Everything that makes it turn, and what stops it turning by itself.
  listen() {
    this.section.addEventListener('keydown', (event) => this.onKey(event));
    this.section.addEventListener('pointerenter', (event) => { if (event.pointerType === 'mouse') this.pointerOver = true; });
    this.section.addEventListener('pointerleave', (event) => { if (event.pointerType === 'mouse') this.pointerOver = false; });
    this.stage.addEventListener('wheel', (event) => this.onWheel(event), { passive: false });
    this.stage.addEventListener('pointerdown', (event) => this.onPointerDown(event));
    window.addEventListener('pointerup', (event) => this.onPointerUp(event));
    window.addEventListener('pointercancel', () => { this.drag = null; this.touching = false; });
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => this.scheduleAutoTurn());
  }

  // ---------- Showing products ----------

  // Shows these products with the first one in the middle. With swing, the old products swing out to the side first
  // and the new ones swing in (not with "reduce motion").
  show(products, swing) {
    clearTimeout(this.swingTimer);
    this.section.classList.remove('swing-out'); // a swing that is still going is cut short, so nothing stays hidden
    const animate = swing && this.cards.length > 0 && !wantsLessMotion();
    if (!animate) return this.fill(products, false);
    this.section.classList.add('swing-out');
    this.swingTimer = setTimeout(() => {
      this.section.classList.remove('swing-out');
      this.fill(products, true);
    }, carouselSwingMs());
  }

  // Makes one card and one name for every product, puts them in their places, and shows the middle product's details.
  fill(products, swingIn) {
    this.products = products;
    this.current = 0;
    this.direction = 1;
    this.offsets = [];
    this.cards = products.map((product, index) => this.makeCard(product, index));
    this.nameItems = products.map((product) => make('span', 'cname', product.name));
    this.ring.replaceChildren(...this.cards);
    this.names.replaceChildren(...this.nameItems);
    const some = products.length > 0;
    this.stage.classList.toggle('hidden', !some);
    this.names.classList.toggle('hidden', !some);
    this.details.classList.toggle('hidden', !some);
    this.empty.classList.toggle('hidden', some);
    this.prevButton.classList.toggle('hidden', products.length < 2); // one product: nothing to turn to
    this.nextButton.classList.toggle('hidden', products.length < 2);
    if (swingIn) this.section.classList.add('swing-in'); // the new cards start off to the right side...
    this.place(0);
    if (swingIn) {
      void this.ring.offsetWidth; // (the browser takes in that start place now)
      this.section.classList.remove('swing-in'); // ...and swing in to their places
    }
    this.showDetails();
    this.status.textContent = some ? `${products.length} product${products.length === 1 ? '' : 's'}. ${this.describe()}` : 'Nothing here yet';
    this.scheduleAutoTurn();
  }

  // One product box: the product's photo (or the kit's placeholder art), the shop name small in a corner, and a "Sold out" ribbon.
  // A click on a side box turns it to the middle; a click on the middle box opens the product's page.
  makeCard(product, index) {
    const card = make('div', 'cbox');
    card.setAttribute('aria-hidden', 'true'); // the details and the arrow buttons are what screen readers use
    const face = make('div', 'cbox-face');
    face.append(productPicture(product, 'cbox-photo'), make('span', 'cbox-shop', product.shop_name));
    if (product.sold_out) face.append(make('span', 'cbox-ribbon', 'Sold out'));
    card.append(make('div', 'cbox-top'), make('div', 'cbox-side'), make('div', 'cbox-left'), face);
    card.addEventListener('click', () => this.clickCard(index));
    return card;
  }

  // ---------- Turning ----------

  // Turns the carousel: 1 brings the next product to the middle, -1 the one before, 2 the one after next, and so on.
  // byPerson is false when it turns by itself (then screen readers are not told every 4 seconds).
  turn(steps, byPerson) {
    const count = this.products.length;
    if (count < 2 || steps === 0) return;
    this.direction = steps > 0 ? 1 : -1;
    this.turnedAt = Date.now();
    this.comeInFromTheRightSide(steps);
    this.current = (((this.current + steps) % count) + count) % count;
    this.place(steps);
    this.showDetails();
    this.status.setAttribute('aria-live', byPerson ? 'polite' : 'off');
    this.status.textContent = this.describe();
    this.scheduleAutoTurn();
  }

  // How far a product stands from the middle: 0 in the middle, negative on the left, positive on the right.
  // The ring goes round: after the last product comes the first again.
  offsetOf(index) {
    const count = this.products.length;
    let offset = (((index - this.current) % count) + count) % count;
    if (offset > count / 2) offset -= count;
    if (offset === count / 2) offset = -this.direction * offset; // exactly opposite: it stays on the side it is leaving to
    return offset;
  }

  // Gives every card and name its place for this turn. A card that goes round from one end of the ring to the other
  // jumps there without being seen moving across the middle.
  place(steps) {
    this.cards.forEach((card, index) => {
      const offset = this.offsetOf(index);
      const before = this.offsets[index];
      const wentRound = steps !== 0 && before !== undefined && offset !== before - steps;
      this.putAt(card, offset, wentRound);
      this.putAt(this.nameItems[index], offset, wentRound);
      this.offsets[index] = offset;
    });
  }

  // Puts one card or name at an offset. jump: move it there at once, with no animation.
  putAt(element, offset, jump) {
    if (jump) element.classList.add('jump');
    element.dataset.offset = Math.abs(offset) <= CAROUSEL_SIDE ? String(offset) : (offset < 0 ? 'far-left' : 'far-right');
    if (jump) {
      void element.offsetWidth; // the browser takes the new place now...
      element.classList.remove('jump'); // ...and later moves are animated again
    }
  }

  // With only 2 products the next one may be standing on the wrong side: put it on the side it comes in from.
  comeInFromTheRightSide(steps) {
    if (Math.abs(steps) !== 1) return;
    const count = this.products.length;
    const coming = (((this.current + steps) % count) + count) % count;
    if (this.offsets[coming] === steps) return;
    this.putAt(this.cards[coming], steps, true);
    this.putAt(this.nameItems[coming], steps, true);
    this.offsets[coming] = steps;
  }

  // "Hot Chilli Sauce, Rs 220, from Chilli Lane Pantry. 3 of 6."
  describe() {
    const product = this.products[this.current];
    const soldOut = product.sold_out ? ', sold out' : '';
    return `${product.name}, ${formatMoney(product.price)}${soldOut}, from ${product.shop_name}. ${this.current + 1} of ${this.products.length}.`;
  }

  // Under the names: the middle product's price, its maker ("Shop · City") and the stock in words, the kit's Add to
  // bag button (a sold-out product has none), View, and the kit's heart to save it to the wishlist.
  showDetails() {
    const product = this.products[this.current];
    if (!product) return this.details.replaceChildren();
    const hadFocus = this.details.contains(document.activeElement);
    const name = make('h3', 'visually-hidden', product.name);
    const price = make('p', 'carousel-price', formatMoney(product.price));
    const shop = make('p', 'vendor-line', vendorLine(product));
    const stock = make('p', 'muted small', product.stock_words || (product.sold_out ? 'Sold out' : 'In stock'));
    const buttons = make('div', 'actions carousel-actions');
    if (product.sold_out) buttons.append(make('span', 'badge badge-soldout', 'Sold out'));
    else {
      const add = make('span', 'add-slot');
      mountKit(add, IK.AddToCartButton, { tone: 'ink', onAdd: () => addToBag(product), 'aria-label': 'Add ' + product.name + ' to bag' });
      buttons.append(add);
    }
    const view = make('a', 'button secondary', 'View');
    view.href = product.url || '/product/' + product.id;
    view.setAttribute('aria-label', 'View ' + product.name);
    buttons.append(view, this.makeHeart(product));
    this.details.replaceChildren(name, price, shop, stock, buttons);
    if (hadFocus) this.section.focus(); // keyboard users stay inside the carousel
  }

  // The kit's wishlist heart for one product, remembered in this browser (readWishlist and setWishlisted in kit.js).
  makeHeart(product) {
    const slot = make('span', 'heart-slot');
    mountKit(slot, IK.WishlistHeart, {
      onMedia: true, defaultPressed: readWishlist().includes(product.id),
      onChange: (saved) => setWishlisted(product.id, saved), label: 'Save ' + product.name,
    });
    return slot;
  }

  // ---------- Turning by itself ----------

  // Every 4 seconds it turns by itself, unless someone is using it, the page is hidden, or motion is reduced.
  scheduleAutoTurn() {
    clearTimeout(this.autoTimer);
    if (this.products.length < 2 || wantsLessMotion()) return;
    this.autoTimer = setTimeout(() => {
      if (this.isInUse() || document.hidden || this.isHiddenOnPage()) this.scheduleAutoTurn();
      else this.turn(1, false);
    }, CAROUSEL_AUTO_MS);
  }

  // Someone is using it: the mouse is over it, a finger is on it, or it has the focus (after a click, a tap or Tab).
  isInUse() {
    return this.pointerOver || this.touching || this.section.contains(document.activeElement);
  }

  // The page has hidden it (for example the home page after picking "All"): then it does not turn by itself.
  isHiddenOnPage() {
    return !this.section.isConnected || this.section.offsetParent === null;
  }

  // ---------- The person's moves ----------

  // A click on a box: a side box turns to the middle, the middle box opens its product page.
  // While it is turning, the box sliding into the middle may pass under the pointer: that click opens nothing.
  clickCard(index) {
    if (Date.now() < this.ignoreClicksUntil) return; // the end of a swipe is not a click
    const offset = this.offsetOf(index);
    if (offset !== 0) return this.turn(offset, true);
    if (Date.now() - this.turnedAt < carouselTurnMs()) return;
    location.href = this.products[index].url || '/product/' + this.products[index].id;
  }

  // The left and right arrow keys turn it. With Alt, Ctrl or Cmd they are the browser's own keys (like Back).
  onKey(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    this.turn(event.key === 'ArrowRight' ? 1 : -1, true);
  }

  // The mouse wheel or trackpad over the carousel turns it one product per scroll. A trackpad keeps sending small
  // moves for a moment after one flick: those belong to the same scroll and are ignored.
  // Ctrl with the wheel, and a two-finger pinch on a trackpad, zoom the page: those are left to the browser.
  onWheel(event) {
    if (this.products.length < 2 || event.ctrlKey) return;
    const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1; // lines or pages, in pixels
    const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * unit;
    if (delta === 0) return;
    event.preventDefault(); // over the carousel the wheel turns it instead of scrolling the page
    const now = Date.now();
    if (now - this.wheel.lastAt > 250) this.wheel = { sum: 0, lastAt: now, turned: false }; // a new scroll starts
    this.wheel.lastAt = now;
    if (this.wheel.turned) return;
    this.wheel.sum += delta;
    if (Math.abs(this.wheel.sum) < 25) return;
    this.wheel.turned = true;
    this.turn(this.wheel.sum > 0 ? 1 : -1, true);
  }

  // A finger (or the mouse button) goes down on the stage: remember where.
  onPointerDown(event) {
    if (event.button !== 0) return;
    this.drag = { x: event.clientX, y: event.clientY, id: event.pointerId };
    this.touching = event.pointerType !== 'mouse';
  }

  // It comes up again: a sideways swipe of 40 pixels or more turns one product. A swipe that is mostly up or down is
  // left to the browser, which scrolls the page (the stage allows that with touch-action: pan-y).
  onPointerUp(event) {
    const drag = this.drag;
    if (!drag || event.pointerId !== drag.id) return;
    this.drag = null;
    this.touching = false;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) this.ignoreClicksUntil = Date.now() + 400; // a drag is never a click
    if (Math.abs(dx) < SWIPE_PIXELS || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    this.turn(dx < 0 ? 1 : -1, true);
  }
}
