// seller/products.js - the seller's Products page: add, edit, switch off and on, delete, and change stock with + and -.
// The server only ever shows and changes this seller's OWN products.
// The list refreshes every 5 seconds, but waits while the seller is typing, choosing, editing, or has typed an amount,
// and it is only drawn again when something really changed.

const productsMessage = document.getElementById('message');
const shopNote = document.getElementById('shop-note');
const productForm = document.getElementById('product-form');
const formMessage = document.getElementById('form-message');
let editingId = null;  // the product being edited, or null when the form adds a new product
let canChange = false; // only an open (active) shop can change its products

// Asks the server for this seller's products and shows them (only when something changed since last time).
async function loadMyProducts() {
  try {
    const data = await api('GET', '/api/seller/products');
    clearLoadProblem(productsMessage);
    if (!dataChanged('my-products', data)) return;
    canChange = data.shop.status === 'active';
    showShopNote(data.shop);
    fillCategoryList(data.categories);
    showLowBanner(data.products.filter((product) => product.low));
    showProductList(data.products);
    productForm.classList.toggle('hidden', !canChange);
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    forgetDrawnData('my-products'); // draw everything again once loading works
    if (error.status === 403) {
      canChange = false;
      productForm.classList.add('hidden');
    }
    showLoadProblem(productsMessage, error); // for example "Your shop is waiting for approval."
  }
}

// A suspended shop can look at its products but not change them.
function showShopNote(shop) {
  const suspended = shop.status === 'suspended';
  shopNote.textContent = suspended
    ? 'Your shop is suspended, so you cannot change products now.' + (shop.status_reason ? ' Reason: ' + shop.status_reason : '')
    : '';
  shopNote.classList.toggle('hidden', !suspended);
}

// Fills the category list in the form (only once).
function fillCategoryList(categories) {
  const select = document.getElementById('category');
  if (select.options.length > 1) return;
  for (const category of categories) {
    const option = make('option', '', category.name);
    option.value = String(category.id);
    select.append(option);
  }
}

// The red banner listing every LOW product.
function showLowBanner(lowProducts) {
  const banner = document.getElementById('low-banner');
  banner.textContent = 'LOW stock: ' + lowProducts.map((product) => `${product.name} (${product.stock} left)`).join(', ');
  banner.classList.toggle('hidden', lowProducts.length === 0);
}

// One card per product, or "No products yet".
function showProductList(products) {
  document.getElementById('product-list').replaceChildren(...products.map(productCard));
  document.getElementById('product-count').textContent = `(${products.length})`;
  document.getElementById('no-products').classList.toggle('hidden', products.length > 0);
}

// One product: photo and name, status, category and price, the admin's reason if hidden, the stock row and the buttons.
function productCard(product) {
  const card = make('article', 'card');
  card.dataset.productId = product.id;
  const top = make('div', 'card-top');
  top.append(productPicture(product, 'staff-photo'), make('h3', '', product.name), statusBadge(product));
  card.append(top);
  card.append(make('p', 'muted', `${product.category_name} · ${formatMoney(product.price)}`));
  if (product.hidden) card.append(make('p', 'reason', 'Hidden by the admin: ' + product.hidden_reason));
  card.append(stockRow(product));
  card.append(cardMessageBox(product.id));
  if (canChange) card.append(actionButtons(product, card));
  return card;
}

// On sale / Sold out / Switched off / Hidden by admin.
function statusBadge(product) {
  if (product.hidden) return make('span', 'badge badge-suspended', 'Hidden by admin');
  if (!product.active) return make('span', 'badge badge-rejected', 'Switched off');
  if (product.stock === 0) return make('span', 'badge badge-soldout', 'Sold out');
  return make('span', 'badge badge-active', 'On sale');
}

// Stock: the number, a LOW tag, and (for an open shop) an amount box with + and - buttons.
function stockRow(product) {
  const row = make('div', 'stock-row');
  row.append(make('span', 'stock-number', 'Stock: ' + product.stock));
  if (product.low) row.append(make('span', 'badge badge-low', 'LOW'));
  if (!canChange) return row;

  const amountBox = make('input', 'amount-box');
  amountBox.type = 'number';
  amountBox.min = '1';
  amountBox.step = '1';
  amountBox.inputMode = 'numeric';
  amountBox.placeholder = '1';
  amountBox.setAttribute('aria-label', 'Amount for ' + product.name);
  // A typed amount keeps the 5-second refresh from wiping it.
  amountBox.addEventListener('input', () => {
    if (amountBox.value || amountBox.validity.badInput) amountBox.dataset.busy = 'yes';
    else delete amountBox.dataset.busy;
  });
  const plus = actionButton('+', 'small-button', () => changeStock(product, 'add', amountBox));
  plus.setAttribute('aria-label', 'Add to the stock of ' + product.name);
  const minus = actionButton('−', 'small-button secondary', () => changeStock(product, 'remove', amountBox));
  minus.setAttribute('aria-label', 'Take away from the stock of ' + product.name);
  const controls = make('div', 'stock-controls');
  controls.append(amountBox, plus, minus);
  row.append(controls);
  return row;
}

// Edit, Switch off or Switch on, and Delete.
function actionButtons(product, card) {
  const row = make('div', 'actions');
  row.append(actionButton('Edit', 'secondary', () => startEditing(product)));
  row.append(photoButton(product));
  if (product.active) row.append(actionButton('Switch off', 'secondary', () => switchProduct(product, 'switch-off')));
  else if (!product.hidden) row.append(actionButton('Switch on', '', () => switchProduct(product, 'switch-on')));
  row.append(actionButton('Delete', 'danger', () => askDelete(product, card)));
  return row;
}

// "Add photo" or "Change photo": picks a JPEG, PNG or WebP file of at most 2 MB and sends it to the server,
// which checks it again (the type by its first bytes) and gives it a new random name.
function photoButton(product) {
  const label = make('label', 'button secondary photo-button', product.photo_url ? 'Change photo' : 'Add photo');
  const input = make('input', 'visually-hidden');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.addEventListener('change', () => uploadPhoto(product, input));
  label.append(input);
  return label;
}

// Sends the chosen photo, then draws the list again with it.
async function uploadPhoto(product, input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return showCardMessage(product.id, 'The photo must be 2 MB or smaller.', 'error');
  try {
    const response = await fetch(`/api/seller/products/${product.id}/photo`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
    });
    const answer = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(answer.error || 'The photo could not be saved. Please try again.');
    forgetDrawnData('my-products');
    await loadMyProducts();
    showCardMessage(product.id, answer.message, 'ok');
  } catch (error) {
    showCardMessage(product.id, error.message, 'error');
  }
}

// A button with a click action.
function actionButton(text, style, onClick) {
  const button = make('button', style, text);
  button.type = 'button';
  button.addEventListener('click', onClick);
  return button;
}

// The message box inside a product's card.
function cardMessageBox(productId) {
  const box = make('div', 'message');
  box.dataset.cardMessage = String(productId);
  return box;
}

// Shows a message inside one product's card (found again after the list was drawn again).
function showCardMessage(productId, text, kind) {
  const box = document.querySelector(`[data-card-message="${productId}"]`);
  showMessage(box || productsMessage, text, kind);
}

// + or -: sends the amount to the server. An empty amount box means 1.
async function changeStock(product, direction, amountBox) {
  if (amountBox.validity.badInput) {
    showCardMessage(product.id, 'Please type a whole number, like 5.', 'error');
    return;
  }
  const amount = amountBox.value.trim() === '' ? '1' : amountBox.value.trim();
  try {
    const result = await api('POST', `/api/seller/products/${product.id}/stock/${direction}`, { amount });
    await loadMyProducts();
    showCardMessage(product.id, result.message, 'ok');
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    showCardMessage(product.id, error.message, 'error');
  }
}

// Switch off (customers stop seeing it) or switch on again.
async function switchProduct(product, action) {
  try {
    const result = await api('POST', `/api/seller/products/${product.id}/${action}`);
    await loadMyProducts();
    showCardMessage(product.id, result.message, 'ok');
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    showCardMessage(product.id, error.message, 'error');
  }
}

// Delete asks "are you sure?" first, inside the card.
function askDelete(product, card) {
  openConfirmBox(card, {
    question: `Delete ${product.name}? Customers will not see it any more. Old orders keep its name.`,
    confirmText: 'Yes, delete',
    askReason: false,
    onConfirm: async (reason, boxMessage) => {
      try {
        const result = await api('DELETE', '/api/seller/products/' + product.id);
        closeConfirmBoxes();
        if (editingId === product.id) stopEditing();
        showMessage(productsMessage, result.message, 'ok');
        await loadMyProducts();
      } catch (error) {
        if (goToLoginIfNeeded(error)) return;
        showMessage(boxMessage, error.message, 'error');
      }
    },
  });
}

// Fills the form with a product so the seller can change it. Stock is not in the form: it only changes with + and -.
function startEditing(product) {
  editingId = product.id;
  document.getElementById('form-title').textContent = 'Edit ' + product.name;
  document.getElementById('name').value = product.name;
  document.getElementById('category').value = String(product.category_id);
  document.getElementById('price').value = paiseToRupeesText(product.price);
  document.getElementById('description').value = product.description;
  document.getElementById('giftable').checked = product.giftable === 1;
  document.getElementById('size-label').value = product.size_label || '';
  document.getElementById('low-stock').value = String(product.low_stock_level);
  document.getElementById('stock-field').classList.add('hidden');
  document.getElementById('save-button').textContent = 'Save changes';
  document.getElementById('cancel-edit').classList.remove('hidden');
  productForm.dataset.busy = 'yes'; // the list waits while a product is being edited
  clearMessage(formMessage);
  productForm.scrollIntoView({ block: 'start' });
  document.getElementById('name').focus();
}

// Back to "Add a product" with an empty form.
function stopEditing() {
  editingId = null;
  productForm.reset();
  document.getElementById('form-title').textContent = 'Add a product';
  document.getElementById('stock-field').classList.remove('hidden');
  document.getElementById('save-button').textContent = 'Add product';
  document.getElementById('cancel-edit').classList.add('hidden');
  delete productForm.dataset.busy;
}

// The values typed in the form. Stock is only sent when adding a product.
function readProductForm() {
  const values = {
    name: document.getElementById('name').value,
    category_id: document.getElementById('category').value,
    price: document.getElementById('price').value,
    description: document.getElementById('description').value,
    giftable: document.getElementById('giftable').checked,
    size_label: document.getElementById('size-label').value,
    low_stock_level: numberBoxValue('low-stock'),
  };
  if (editingId === null) values.stock = numberBoxValue('stock');
  return values;
}

// The text in a number box. Something that is not a number is sent as it is, so the server explains the problem.
function numberBoxValue(id) {
  const box = document.getElementById(id);
  return box.validity.badInput ? 'not a number' : box.value;
}

// Add product / Save changes.
productForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(formMessage);
  const saveButton = document.getElementById('save-button');
  saveButton.disabled = true;
  try {
    const values = readProductForm();
    const result = editingId === null
      ? await api('POST', '/api/seller/products', values)
      : await api('PUT', '/api/seller/products/' + editingId, values);
    stopEditing();
    showMessage(formMessage, result.message, 'ok');
    await loadMyProducts();
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    showMessage(formMessage, error.message, 'error');
  } finally {
    saveButton.disabled = false;
  }
});

document.getElementById('cancel-edit').addEventListener('click', () => {
  stopEditing();
  clearMessage(formMessage);
});

refreshEvery5Seconds(loadMyProducts);
