// admin/products.js - the admin's All products page: search every shop's products, and Hide or Unhide one.
// The admin cannot change prices: this page has no button for it, and the server refuses it too.
// The list refreshes every 5 seconds, but waits while the admin is typing or has a Hide box open,
// and it is only drawn again when something really changed.

const allProductsMessage = document.getElementById('message');
let currentSearch = '';

// Loads the products for the current search (and draws them only when something changed since last time).
async function loadAllProducts() {
  const searchAsked = currentSearch;
  try {
    const data = await api('GET', '/api/admin/products?search=' + encodeURIComponent(searchAsked));
    if (searchAsked !== currentSearch) return; // a newer search started while this one was loading
    clearLoadProblem(allProductsMessage);
    if (!dataChanged('all-products', data)) return;
    showCounts(data.counts);
    showAllProducts(data.products);
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    forgetDrawnData('all-products'); // draw everything again once loading works
    showLoadProblem(allProductsMessage, error);
  }
}

// "18 products in all shops · 0 hidden · 3 LOW"
function showCounts(counts) {
  document.getElementById('counts').textContent = `${counts.total} products in all shops · ${counts.hidden} hidden · ${counts.low} LOW`;
}

// One card per product, or "No products found."
function showAllProducts(products) {
  document.getElementById('product-list').replaceChildren(...products.map(adminProductCard));
  document.getElementById('empty').classList.toggle('hidden', products.length > 0);
}

// What customers see for this product, as [badge text, badge colour].
function customerView(product) {
  if (product.hidden) return ['Hidden', 'badge-suspended'];
  if (product.shop_status !== 'active') return ['Shop not open', 'badge-rejected'];
  if (!product.active) return ['Switched off', 'badge-rejected'];
  if (product.stock === 0) return ['Sold out', 'badge-soldout'];
  return ['On sale', 'badge-active'];
}

// One product: photo and name, what customers see, shop, category, price, stock (LOW), the hide reason, Hide or Unhide.
function adminProductCard(product) {
  const card = make('article', 'card');
  const [viewText, viewColour] = customerView(product);
  const top = make('div', 'card-top');
  top.append(productPicture(product, 'staff-photo'), make('h3', '', product.name), make('span', 'badge ' + viewColour, viewText));
  card.append(top);
  card.append(make('p', 'muted', `${product.shop_name} · ${product.category_name} · ${formatMoney(product.price)}`));
  const stock = make('div', 'stock-row');
  stock.append(make('span', 'stock-number', 'Stock: ' + product.stock));
  if (product.low) stock.append(make('span', 'badge badge-low', 'LOW'));
  card.append(stock);
  if (product.hidden) card.append(make('p', 'reason', 'Hidden: ' + product.hidden_reason));
  const row = make('div', 'actions');
  if (product.hidden) row.append(adminButton('Unhide', '', () => unhideProduct(product)));
  else row.append(adminButton('Hide', 'secondary', () => askHide(product, card)));
  card.append(row);
  return card;
}

// A button with a click action.
function adminButton(text, style, onClick) {
  const button = make('button', style, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

// Hide opens a box under the product: the admin types the reason (the seller will see it), then confirms with the
// kit's two-step ConfirmButton ("Hide product?"). Cancel closes the box.
function askHide(product, card) {
  closeConfirmBoxes();
  const box = make('div', 'reason-box confirm-box');
  box.dataset.busy = 'yes'; // stops the 5-second refresh while the box is open
  const input = make('textarea');
  input.id = 'confirm-box-reason';
  input.rows = 3;
  input.maxLength = 200;
  const label = make('label', '', `Why hide ${product.name}? The seller will see this.`);
  label.htmlFor = input.id;
  const boxMessage = make('div', 'message');
  const confirm = make('span');
  mountKit(confirm, IK.ConfirmButton, {
    label: 'Hide product', confirmLabel: 'Hide product?', hint: 'Press again to hide this product from customers',
    onConfirm: () => hideProduct(product, input.value, boxMessage),
  });
  const cancel = adminButton('Cancel', 'secondary', closeConfirmBoxes);
  const row = make('div', 'actions');
  row.append(confirm, cancel);
  box.append(label, input, boxMessage, row);
  card.append(box);
  input.focus();
}

// Sends Hide with the reason; a problem (for example no reason) shows inside the box.
async function hideProduct(product, reason, boxMessage) {
  try {
    const result = await api('POST', `/api/admin/products/${product.id}/hide`, { reason });
    closeConfirmBoxes();
    showMessage(allProductsMessage, result.message, 'ok');
    await loadAllProducts();
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    showMessage(boxMessage, error.message, 'error');
  }
}

// Unhide: customers can see the product again (unless its seller switched it off).
async function unhideProduct(product) {
  try {
    const result = await api('POST', `/api/admin/products/${product.id}/unhide`);
    showMessage(allProductsMessage, result.message, 'ok');
    await loadAllProducts();
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    showMessage(allProductsMessage, error.message, 'error');
  }
}

// Search: press Enter or the Search button. An empty search shows every product.
document.getElementById('search-form').addEventListener('submit', (event) => {
  event.preventDefault();
  currentSearch = document.getElementById('search').value.trim();
  closeConfirmBoxes();
  clearMessage(allProductsMessage);
  loadAllProducts();
});

refreshEvery5Seconds(loadAllProducts);
