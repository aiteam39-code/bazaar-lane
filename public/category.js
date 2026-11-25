// category.js - a category page (/category/<slug>): a breadcrumb, the category's name, and its products that can be
// bought turning on the 3D carousel (carousel.js), with "See all as a list". The list (?view=list) has the filters and
// sorting (listing.js). The chips switch to another category: the old products swing out and the new ones swing in,
// without loading a new page.

let categoryCarousel = null;
let allCategories = [];

// The category's clean name in the address: /category/home-and-kitchen -> "home-and-kitchen".
function chosenCategorySlug() {
  return pagePathPart(2);
}

// True when the address asks for the list with filters (?view=list).
function showsList() {
  return new URLSearchParams(location.search).get('view') === 'list';
}

// Loads the categories (once) and the chosen category's products, and shows them.
async function loadCategoryPage(swing) {
  try {
    if (allCategories.length === 0) allCategories = (await api('GET', '/api/categories')).categories;
    const category = allCategories.find((c) => c.slug === chosenCategorySlug());
    if (!category) return showCategoryNotFound();
    showCategoryHeading(category);
    if (showsList()) return showList(category);
    if (!categoryCarousel) showLoadingCards(category.product_count);
    const data = await api('GET', '/api/products?category=' + category.id);
    hideLoadingCards();
    showCarousel(category, data.products, swing);
  } catch (error) {
    hideLoadingCards();
    if (error.status === 404) return showCategoryNotFound();
    showMessage(document.getElementById('message'), error.message, 'error');
  }
}

// The name, the breadcrumb, the chips and the view link.
function showCategoryHeading(category) {
  document.title = `${category.name} | ${siteName()}`;
  document.getElementById('category-name').textContent = category.name;
  document.getElementById('crumb-name').textContent = category.name;
  showChips(category.slug);
  showViewLinks(category.slug);
  document.getElementById('not-found').classList.add('hidden');
  document.getElementById('category').classList.remove('hidden');
}

// SkeletonCards while the first products load: one per product, at most a row of 4.
function showLoadingCards(productCount) {
  const grid = document.getElementById('loading-cards');
  showSkeletons(grid, Math.min(Math.max(productCount, 1), 4));
  grid.classList.remove('hidden');
}

// Takes the SkeletonCards away once the products are here.
function hideLoadingCards() {
  const grid = document.getElementById('loading-cards');
  grid.replaceChildren();
  grid.classList.add('hidden');
}

// The products on the turning ring.
function showCarousel(category, products, swing) {
  document.getElementById('list').classList.add('hidden');
  const host = document.getElementById('carousel-host');
  host.classList.remove('hidden');
  if (!categoryCarousel) categoryCarousel = new ProductCarousel(host, '');
  categoryCarousel.setLabel(`${category.name}: products`);
  categoryCarousel.show(products, swing);
}

// The list with the filters and sorting.
async function showList(category) {
  document.getElementById('carousel-host').classList.add('hidden');
  document.getElementById('list').classList.remove('hidden');
  await buildFilterForm(document.getElementById('filters'), { category: category.id });
  await loadProductList(document.getElementById('products'), { category: category.id }, document.getElementById('result-count'));
}

// One chip per category, with how many of its products can be bought. A plain click swings that category in.
function showChips(chosenSlug) {
  const chips = allCategories.map((category) => {
    const link = make('a', category.slug === chosenSlug ? 'chip active' : 'chip', `${category.name} (${category.product_count})`);
    link.href = '/category/' + category.slug + (showsList() ? '?view=list' : '');
    if (category.slug === chosenSlug) link.setAttribute('aria-current', 'page');
    link.addEventListener('click', (event) => {
      if (showsList()) return; // the list reloads with its filters
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // a new tab
      event.preventDefault();
      history.pushState(null, '', link.href);
      loadCategoryPage(true);
    });
    return link;
  });
  document.getElementById('categories').replaceChildren(...chips);
}

// "See all as a list" (with filters), or "See them turn" when the list is showing.
function showViewLinks(slug) {
  const turning = !showsList();
  const link = make('a', '', turning ? 'See all as a list, with filters' : 'See them turn');
  link.href = '/category/' + slug + (turning ? '?view=list' : '');
  document.getElementById('view-links').replaceChildren(link);
}

// "This category does not exist".
function showCategoryNotFound() {
  document.title = 'Category not found | ' + siteName();
  document.getElementById('category').classList.add('hidden');
  document.getElementById('not-found').classList.remove('hidden');
}

window.addEventListener('popstate', () => loadCategoryPage(true));

loadCategoryPage(false);
