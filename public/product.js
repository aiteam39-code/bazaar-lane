// product.js - one product's page (/product/<id>-<name>): the photo, the maker ("Shop · City") and its rating, the
// name, the price (a RollingNumber), the stock in words, the quantity, the kit's Add to bag (the ONLY accent on this
// page), the heart, the shipping, a delivery estimate and the return window, the description, the reviews,
// "More from this shop", "Similar products" and "Report this listing".
// A product that is switched off, deleted, hidden, or from a shop that is not open shows "This product is not available".

const productId = pagePathPart(2).split('-')[0]; // /product/12-green-chilli-pickle -> "12"
let chosenQuantity = 1;

// Asks the server for the product and everything around it.
async function loadProduct() {
  try {
    const data = await api('GET', '/api/products/' + encodeURIComponent(productId));
    showProduct(data);
  } catch (error) {
    if (error.status === 404) return showProductNotAvailable();
    showMessage(document.getElementById('message'), error.message, 'error');
  }
}

// Fills the page.
function showProduct(data) {
  const { product, shop, delivery, reviews, more_from_shop: more, similar } = data;
  const photo = document.getElementById('product-photo');
  photo.src = product.photo_url || placeholderArt(product.id);
  photo.alt = product.name;
  mountKit(document.getElementById('product-heart'), IK.WishlistHeart, {
    onMedia: true, defaultPressed: readWishlist().includes(product.id),
    onChange: (saved) => setWishlisted(product.id, saved), label: 'Save ' + product.name,
  });
  const shopLink = document.getElementById('product-shop');
  shopLink.textContent = vendorLine({ shop_name: shop.shop_name, city: shop.city });
  shopLink.href = '/store/' + encodeURIComponent(shop.slug);
  document.getElementById('product-name').textContent = product.name;
  document.getElementById('crumb-name').textContent = product.name;
  const crumb = document.getElementById('crumb-category');
  crumb.textContent = product.category_name;
  crumb.href = '/category/' + slugOf(product.category_name);
  document.getElementById('product-rating').replaceChildren(ratingLine(product.rating, product.review_count));
  mountKit(document.getElementById('product-price'), IK.RollingNumber, {
    value: product.price / 100, format: (n) => formatMoney(Math.round(n * 100)), animateOnMount: false,
  });
  const stock = document.getElementById('product-stock');
  stock.textContent = product.stock_words;
  stock.classList.toggle('is-few', Boolean(product.few_left));
  showBuyRow(product);
  showFacts(shop, delivery);
  document.getElementById('arrives-christmas').classList.toggle('hidden', !data.arrives_before_christmas);
  document.getElementById('product-description').textContent = product.description || 'No description yet.';
  showReviews(product, reviews);
  showRelated('more', more);
  showRelated('similar', similar);
  setUpReport(product);
  document.getElementById('product').classList.remove('hidden');
}

// Quantity and the kit's Add to bag (the one accent on this page). A sold-out product has neither.
function showBuyRow(product) {
  const row = document.getElementById('product-buy');
  if (product.sold_out) return row.replaceChildren(make('p', 'badge badge-soldout', 'Sold out'));
  const most = product.few_left || MOST_OF_ONE;
  const stepper = make('span', 'stepper-slot');
  const add = make('span', 'add-slot');
  const drawStepper = () => mountKit(stepper, IK.QuantityStepper, {
    value: chosenQuantity, min: 1, max: most, label: 'Quantity',
    maxHint: most === MOST_OF_ONE ? `Max ${MOST_OF_ONE} per order` : `Only ${most} left`,
    onChange: (quantity) => { chosenQuantity = quantity; drawStepper(); },
  });
  drawStepper();
  mountKit(add, IK.AddToCartButton, { tone: 'accent', onAdd: () => addToBag(product, chosenQuantity) });
  const view = make('a', 'button secondary', 'View bag');
  view.href = '/cart.html';
  row.replaceChildren(stepper, add, view);
}

// Shipping, the delivery estimate and the return window, before anything is added.
function showFacts(shop, delivery) {
  const shipping = shop.shipping_fee === 0 ? 'Free shipping from this shop'
    : shop.free_shipping_over === null ? `Shipping ${formatMoney(shop.shipping_fee)} from this shop`
    : `Shipping ${formatMoney(shop.shipping_fee)}, free when this shop's items come to more than ${formatMoney(shop.free_shipping_over)}`;
  const arrives = `Arrives in ${delivery.from_days} to ${delivery.to_days} days (the shop sends it within ${shop.dispatch_days} day${shop.dispatch_days === 1 ? '' : 's'})`;
  const returns = shop.return_days === 0 ? 'This shop does not take returns' : `Returns within ${shop.return_days} days of delivery`;
  document.getElementById('product-facts').replaceChildren(...[shipping, arrives, returns].map((fact) => make('li', '', fact)));
}

// The average, the count and the newest reviews, each "Verified buyer", with any reply from the shop.
function showReviews(product, reviews) {
  document.getElementById('reviews-summary').replaceChildren(ratingLine(product.rating, product.review_count));
  document.getElementById('review-list').replaceChildren(...reviews.map((review) => {
    const item = make('li', 'review');
    const top = make('p', 'review-top');
    top.append(starRow(review.rating), make('strong', '', `${review.rating} out of 5`), make('span', 'muted', ` · ${review.first_name} · Verified buyer`));
    item.append(top);
    if (review.text) item.append(make('p', 'description', review.text));
    if (review.seller_reply) item.append(make('p', 'reason', 'Reply from the shop: ' + review.seller_reply));
    return item;
  }));
}

// "More from this shop" or "Similar products": up to 4 product cards (the section stays hidden when empty).
function showRelated(which, products) {
  document.getElementById(which + '-products').replaceChildren(...products.map(productCard));
  document.getElementById(which + '-section').classList.toggle('hidden', products.length === 0);
}

// "Report this listing": opens a small form; the admin sees the report.
function setUpReport(product) {
  const box = document.getElementById('report');
  document.getElementById('report-link').addEventListener('click', (event) => {
    event.preventDefault();
    box.classList.remove('hidden');
    document.getElementById('report-reason').focus();
  });
  document.getElementById('report-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const message = document.getElementById('report-message');
    try {
      const answer = await api('POST', `/api/products/${product.id}/report`, { reason: document.getElementById('report-reason').value });
      showMessage(message, answer.message, 'ok');
      document.getElementById('report-reason').value = '';
    } catch (error) {
      showMessage(message, error.message, 'error');
    }
  });
}

// The clean address of a category name: "Home and kitchen" -> "home-and-kitchen".
function slugOf(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Shows "This product is not available".
function showProductNotAvailable() {
  document.getElementById('not-available').classList.remove('hidden');
}

loadProduct();
