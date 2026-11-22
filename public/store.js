// store.js - one shop's page (/store/<shop address>): its name, city, rating, description, shipping and returns; a row of chips for the
// categories it sells; and the chosen category's products turning on the 3D carousel (carousel.js), each with
// Add to bag (a sold-out product shows a "Sold out" ribbon and no Add button). "See all as a list" shows the same
// products as the kit's product cards. Picking another chip swings the new products in, without loading a new page.
// A pending, rejected or suspended shop (or a wrong address) shows "This shop is not available".
// The address says what to show: /store/<shop>?category=1 and ?view=list.

const shopAddress = pagePathPart(2); // /store/chilli-lane-pantry -> "chilli-lane-pantry"
let shopProducts = [];
let storeCarousel = null;

// Asks the server for the shop and the products customers may see.
async function loadShop() {
  try {
    const data = await api('GET', '/api/store/' + encodeURIComponent(shopAddress));
    shopProducts = data.products;
    showShop(data.shop);
    showChosenCategory(false);
  } catch (error) {
    if (error.status === 404) return showShopNotAvailable();
    showMessage(document.getElementById('message'), error.message, 'error');
  }
}

// The shop's name, city, rating, description, shipping, dispatch days and returns.
function showShop(shop) {
  document.getElementById('shop-name').textContent = shop.shop_name;
  document.getElementById('crumb-name').textContent = shop.shop_name;
  document.getElementById('shop-city').textContent = shop.city ? 'Made in ' + shop.city : '';
  document.getElementById('shop-rating').replaceChildren(ratingLine(shop.rating, shop.review_count));
  document.getElementById('shop-description').textContent = shop.description;
  const facts = [shippingText(shop), dispatchText(shop.dispatch_days), returnsText(shop.return_days)];
  document.getElementById('shop-facts').replaceChildren(...facts.map((fact) => make('li', '', fact)));
  document.getElementById('shop').classList.remove('hidden');
}

// "Ships within 2 days".
function dispatchText(days) {
  return `Ships within ${days} day${days === 1 ? '' : 's'}`;
}

// "Returns within 7 days", or "No returns".
function returnsText(days) {
  return days === 0 ? 'No returns' : `Returns within ${days} days`;
}

// "Shipping ₹40, free over ₹499", or "Free shipping" when the fee is 0.
function shippingText(shop) {
  if (shop.shipping_fee === 0) return 'Free shipping';
  if (shop.free_shipping_over === null) return `Shipping ${formatMoney(shop.shipping_fee)}`;
  return `Shipping ${formatMoney(shop.shipping_fee)}, free over ${formatMoney(shop.free_shipping_over)}`;
}

// What the address asks for: one category (or all of them), and the carousel or the list.
function storeChoice() {
  const address = new URLSearchParams(location.search);
  return { category: address.get('category') || '', asList: address.get('view') === 'list' };
}

// The categories this shop sells, with how many of its products are in each: [{ id, name, count }], by name.
function shopCategories() {
  const byId = new Map();
  for (const product of shopProducts) {
    const id = String(product.category_id);
    if (!byId.has(id)) byId.set(id, { id, name: product.category_name, count: 0 });
    byId.get(id).count += 1;
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Shows the chosen category: its chip highlighted, and its products on the carousel (or as a list).
function showChosenCategory(swing) {
  const choice = storeChoice();
  const categories = shopCategories();
  const chosen = categories.find((category) => category.id === choice.category) || null;
  const products = chosen ? shopProducts.filter((product) => String(product.category_id) === chosen.id) : shopProducts;
  showChips(categories, chosen);
  document.getElementById('products-title').textContent = chosen ? chosen.name : 'All products';
  showViewLinks(chosen, !choice.asList);

  const host = document.getElementById('carousel-host');
  host.classList.toggle('hidden', choice.asList);
  if (!choice.asList) {
    if (!storeCarousel) storeCarousel = new ProductCarousel(host, '');
    storeCarousel.setLabel(`${chosen ? chosen.name : 'All products'} in this shop`);
    storeCarousel.show(products, swing);
  }
  const cards = choice.asList ? products.map(productCard) : [];
  document.getElementById('products').replaceChildren(...cards);
  document.getElementById('no-products').classList.toggle('hidden', !choice.asList || products.length > 0);
}

// The chips: "All" and one for each category the shop sells, with its count. A plain click swings that category in.
function showChips(categories, chosen) {
  const all = chipLink('All', '', shopProducts.length, !chosen);
  const chips = categories.map((category) => chipLink(category.name, category.id, category.count, chosen === category));
  document.getElementById('shop-categories').replaceChildren(all, ...chips);
}

// One chip: a link to ?category=<id> that the page follows without loading again.
function chipLink(name, id, count, isChosen) {
  const link = make('a', isChosen ? 'chip active' : 'chip', `${name} (${count})`);
  link.href = location.pathname + (id ? '?category=' + encodeURIComponent(id) : '');
  if (isChosen) link.setAttribute('aria-current', 'page');
  link.addEventListener('click', (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // a new tab or window
    event.preventDefault();
    history.pushState(null, '', link.href);
    showChosenCategory(true);
  });
  return link;
}

// "See all as a list", or "See them turn" when the list is showing.
function showViewLinks(chosen, turning) {
  const address = new URLSearchParams();
  if (chosen) address.set('category', chosen.id);
  if (turning) address.set('view', 'list');
  const link = make('a', '', turning ? 'See all as a list' : 'See them turn');
  link.href = location.pathname + (address.toString() ? '?' + address : '');
  document.getElementById('view-links').replaceChildren(link);
}

// Shows "This shop is not available".
function showShopNotAvailable() {
  document.getElementById('not-available').classList.remove('hidden');
}

window.addEventListener('popstate', () => showChosenCategory(true));

loadShop();
