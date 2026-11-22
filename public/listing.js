// listing.js - one reusable product list with filters, used by search, by every category's "See all as a list" and
// by the shop pages' lists. The filters (price from and to, shop, city, rating, sort) live in the page address, so a
// search can be shared, and the server decides what can be bought.

const LIST_PAGE_SIZE = 24; // skeletons in the exact count the page shows first
const SORT_CHOICES = [
  ['name', 'A to Z'], ['newest', 'Newest'], ['price_asc', 'Price, low to high'], ['price_desc', 'Price, high to low'],
  ['top_rated', 'Top rated'],
];
const FILTER_KEYS = ['search', 'price_min', 'price_max', 'shop', 'city', 'rating', 'sort', 'giftable'];

// The filters in the page address now.
function filtersFromAddress() {
  const address = new URLSearchParams(location.search);
  const filters = {};
  for (const key of FILTER_KEYS) if (address.get(key)) filters[key] = address.get(key);
  return filters;
}

// Builds the filter form inside host. fixed: filters this page always keeps (like { category: 3 } or { shop: slug }),
// shown as hidden fields so they stay in the address. Submitting the form loads the page with the new address.
async function buildFilterForm(host, fixed = {}) {
  const filters = filtersFromAddress();
  const form = make('form', 'filters');
  form.method = 'get';
  form.action = location.pathname;
  form.setAttribute('aria-label', 'Filter and sort');
  for (const [key, value] of Object.entries(fixed)) {
    if (key === 'category') continue; // the category is in the page address itself
    const hidden = make('input');
    hidden.type = 'hidden';
    hidden.name = key;
    hidden.value = value;
    form.append(hidden);
  }
  if (new URLSearchParams(location.search).get('view')) form.append(hiddenField('view', 'list'));
  if (!('search' in fixed)) form.append(filterField('Search', textBox('search', filters.search, 'search', 'Part of a name')));
  form.append(
    filterField('Price from (₹)', textBox('price_min', filters.price_min, 'text', 'Any', 'numeric')),
    filterField('Price to (₹)', textBox('price_max', filters.price_max, 'text', 'Any', 'numeric')),
  );
  const shops = (await api('GET', '/api/shops')).shops;
  if (!('shop' in fixed)) {
    form.append(filterField('Shop', choiceBox('shop', filters.shop, [['', 'Every shop'], ...shops.map((s) => [s.slug, s.shop_name])])));
  }
  const cities = [...new Set(shops.map((shop) => shop.city).filter(Boolean))].sort();
  if (!('shop' in fixed)) form.append(filterField('City', choiceBox('city', filters.city, [['', 'Every city'], ...cities.map((c) => [c, c])])));
  form.append(
    filterField('Rating', choiceBox('rating', filters.rating, [['', 'Any rating'], ['4', '4 stars and up'], ['3', '3 stars and up']])),
    filterField('Sort by', choiceBox('sort', filters.sort || 'name', SORT_CHOICES)),
  );
  const buttons = make('div', 'filter-buttons');
  const apply = make('button', 'secondary', 'Show results');
  apply.type = 'submit';
  const clear = make('a', 'link-button', 'Clear filters');
  clear.href = location.pathname + (fixed.search !== undefined ? '?search=' + encodeURIComponent(fixed.search) : '');
  buttons.append(apply, clear);
  form.append(buttons);
  // Empty fields are left out of the address, so it stays short and easy to share.
  form.addEventListener('submit', () => {
    form.querySelectorAll('input, select').forEach((field) => { if (!field.value) field.disabled = true; });
  });
  host.replaceChildren(form);
}

function hiddenField(name, value) {
  const field = make('input');
  field.type = 'hidden';
  field.name = name;
  field.value = value;
  return field;
}

function filterField(labelText, control) {
  const field = make('div', 'field filter-field');
  const label = make('label', '', labelText);
  label.htmlFor = control.id;
  field.append(label, control);
  return field;
}

function textBox(name, value, type, placeholder, inputMode) {
  const box = make('input');
  box.id = 'filter-' + name;
  box.name = name;
  box.type = type;
  box.value = value || '';
  box.placeholder = placeholder;
  box.maxLength = 60;
  if (inputMode) box.inputMode = inputMode;
  return box;
}

function choiceBox(name, value, choices) {
  const box = make('select');
  box.id = 'filter-' + name;
  box.name = name;
  for (const [optionValue, text] of choices) {
    const option = make('option', '', text);
    option.value = optionValue;
    if (optionValue === (value || '')) option.selected = true;
    box.append(option);
  }
  return box;
}

// Loads the products for these filters (plus the page's fixed ones) into the grid: skeletons first, then the cards.
// Returns the server's answer. countLine (optional) gets "12 products" or "No products match".
async function loadProductList(grid, fixed = {}, countLine = null) {
  showSkeletons(grid, Math.min(LIST_PAGE_SIZE, 8));
  const query = new URLSearchParams({ ...filtersFromAddress(), ...fixed });
  const data = await api('GET', '/api/products?' + query.toString());
  grid.replaceChildren(...data.products.map(productCard));
  if (countLine) {
    countLine.textContent = data.products.length === 0
      ? 'No products match. Try fewer filters.'
      : `${data.products.length}${data.more ? '+' : ''} product${data.products.length === 1 ? '' : 's'}`;
  }
  return data;
}
