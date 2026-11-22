// seller/settings.js - the seller's own shop settings: name, city, description, shipping fee, free-shipping limit,
// dispatch days and return window. The server checks everything again and only changes this seller's own shop.

const settingsForm = document.getElementById('settings-form');
const formMessage = document.getElementById('form-message');

// Loads the shop's settings into the form. A suspended or pending shop can look but not save.
async function loadSettings() {
  try {
    const data = await api('GET', '/api/seller/shop');
    fillForm(data.shop, data.return_choices);
    const canChange = data.shop.status === 'active';
    settingsForm.querySelectorAll('input, textarea, select, button').forEach((field) => { field.disabled = !canChange; });
    if (!canChange) showMessage(document.getElementById('message'), 'Your shop is not open, so these settings cannot be changed now.', 'error');
    settingsForm.classList.remove('hidden');
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showMessage(document.getElementById('message'), error.message, 'error');
  }
}

// Puts the saved values in the form (money as rupees).
function fillForm(shop, returnChoices) {
  document.getElementById('shop-name').value = shop.shop_name;
  document.getElementById('shop-address').textContent = '/store/' + shop.slug;
  document.getElementById('city').value = shop.city;
  document.getElementById('description').value = shop.description;
  document.getElementById('shipping-fee').value = paiseToRupeesText(shop.shipping_fee);
  document.getElementById('free-over').value = shop.free_shipping_over === null ? '' : paiseToRupeesText(shop.free_shipping_over);
  fillChoices('dispatch-days', [1, 2, 3, 4, 5, 6, 7].map((d) => [d, `${d} day${d === 1 ? '' : 's'}`]), shop.dispatch_days);
  fillChoices('return-days', returnChoices.map((d) => [d, d === 0 ? 'No returns' : `Within ${d} days of delivery`]), shop.return_days);
}

function fillChoices(id, choices, chosen) {
  document.getElementById(id).replaceChildren(...choices.map(([value, text]) => {
    const option = make('option', '', text);
    option.value = String(value);
    option.selected = value === chosen;
    return option;
  }));
}

// Saves the form. The server answers with a plain message for the first problem.
settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const answer = await api('PUT', '/api/seller/shop', {
      shop_name: document.getElementById('shop-name').value,
      city: document.getElementById('city').value,
      description: document.getElementById('description').value,
      shipping_fee: document.getElementById('shipping-fee').value,
      free_shipping_over: document.getElementById('free-over').value,
      dispatch_days: document.getElementById('dispatch-days').value,
      return_days: document.getElementById('return-days').value,
    });
    showMessage(formMessage, answer.message, 'ok');
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showMessage(formMessage, error.message, 'error');
  }
});

loadSettings();
