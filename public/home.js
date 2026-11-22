// home.js - the home page: the categories as the kit's CollectionAccordion (each with a product photo), the 8 newest
// products as ProductCards ("New from makers"), the open shops with their city and rating, and "Start selling".
// Old addresses /?search=... and /?category=... move to the search and category pages.

const NEW_PRODUCTS_SHOWN = 8;

// Moves an old home-page search or category address to its own page.
function moveOldAddresses() {
  const query = new URLSearchParams(location.search);
  if (query.get('search')) location.replace('/search?search=' + encodeURIComponent(query.get('search')));
  else if (query.get('category')) location.replace('/category/' + encodeURIComponent(query.get('category')));
  return query.has('search') || query.has('category');
}

// The categories, each a panel with a product photo that opens wide under the pointer.
async function loadCategories() {
  const data = await api('GET', '/api/categories');
  const items = data.categories.map((category) => ({
    id: String(category.id),
    title: category.name,
    subtitle: `${category.product_count} product${category.product_count === 1 ? '' : 's'}`,
    image: category.cover_photo_url || placeholderArt(category.cover_product_id || category.id),
    href: '/category/' + category.slug,
    cta: 'Browse ' + category.name.toLowerCase(),
  }));
  mountKit(document.getElementById('collections'), IK.CollectionAccordion, { items, height: 320 });
}

// The 8 newest products that can be bought.
async function loadNewProducts() {
  const grid = document.getElementById('new-products');
  showSkeletons(grid, NEW_PRODUCTS_SHOWN);
  const data = await api('GET', `/api/products?sort=newest&limit=${NEW_PRODUCTS_SHOWN}`);
  grid.replaceChildren(...data.products.map(productCard));
  document.getElementById('no-products').classList.toggle('hidden', data.products.length > 0);
}

// The open shops: name, city, rating and description, each a link to its storefront.
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

if (!moveOldAddresses()) {
  Promise.all([loadCategories(), loadNewProducts(), loadShops()]).catch((error) => {
    showMessage(document.getElementById('message'), error.message, 'error');
  });
}
