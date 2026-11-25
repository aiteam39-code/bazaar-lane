// admin/commissions.js - the default rate, the early-bird offer, each category's rate (and new categories), and each
// shop's own rate with the rate it actually gets today and why. Rates are typed in percent; the server saves basis
// points. Refreshes every 5 seconds, but never while someone is typing.

const commissionsMessage = document.getElementById('message');
const percentOf = (bps) => (bps === null || bps === undefined ? '' : String(bps / 100));

// Loads the default rate, the early-bird offer, the categories and the shops, and draws them.
async function loadCommissions() {
  try {
    const data = await api('GET', '/api/admin/commissions');
    clearLoadProblem(commissionsMessage);
    if (!dataChanged('commissions', data)) return;
    document.getElementById('default-percent').value = percentOf(data.default_bps);
    const offer = data.early_bird;
    document.getElementById('early-slots').value = String(offer.slots);
    document.getElementById('early-percent').value = percentOf(offer.bps);
    document.getElementById('early-days').value = String(offer.days);
    document.getElementById('early-state').textContent = offer.slots === 0 ? 'No offer right now.'
      : `${offer.taken} of ${offer.slots} places taken. Shops approved while places are left pay ${offer.bps / 100}% for ${offer.days} days.`;
    document.getElementById('category-list').replaceChildren(...data.categories.map((c) => rateRow(c.name, c.commission_bps, `/api/admin/commissions/category/${c.id}`, 'empty = default')));
    document.getElementById('shop-list').replaceChildren(...data.shops.map(shopRow));
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(commissionsMessage, error);
  }
}

// A name, a percent box and Save.
function rateRow(name, bps, address, hint) {
  const form = make('form', 'inline-row');
  const id = 'rate-' + address.replace(/\W+/g, '-');
  const label = make('label', '', name);
  label.htmlFor = id;
  const box = make('input', 'short-box');
  box.id = id;
  box.inputMode = 'decimal';
  box.maxLength = 6;
  box.value = percentOf(bps);
  box.placeholder = hint;
  const save = make('button', 'secondary', 'Save');
  save.type = 'submit';
  form.append(label, box, make('span', 'muted small', '%'), save);
  form.addEventListener('submit', (event) => { event.preventDefault(); send('PUT', address, { percent: box.value }); });
  return form;
}

// A shop: its own rate (to change), and the rate today with the reason.
function shopRow(shop) {
  const box = make('div', 'shop-rate');
  box.append(rateRow(`${shop.shop_name} (${shop.status}) · own rate`, shop.commission_bps, `/api/admin/commissions/shop/${shop.id}`, 'none'));
  const today = shop.today;
  const why = today.why === 'early bird' ? `early bird until ${formatDateTime(today.until)}` : today.why;
  box.append(make('p', 'small muted', `Today: ${today.bps / 100}% (${why})`));
  return box;
}

// Sends one change to the server, shows the answer and loads the page again.
async function send(method, address, body) {
  try {
    const answer = await api(method, address, body);
    showMessage(commissionsMessage, answer.message, 'ok');
    forgetDrawnData('commissions');
    if (document.activeElement) document.activeElement.blur();
    loadCommissions();
  } catch (error) {
    showMessage(commissionsMessage, error.message, 'error');
  }
}

document.getElementById('default-form').addEventListener('submit', (event) => {
  event.preventDefault();
  send('PUT', '/api/admin/commissions/default', { percent: document.getElementById('default-percent').value });
});
document.getElementById('early-form').addEventListener('submit', (event) => {
  event.preventDefault();
  send('PUT', '/api/admin/commissions/early-bird', {
    slots: document.getElementById('early-slots').value,
    percent: document.getElementById('early-percent').value,
    days: document.getElementById('early-days').value,
  });
});
document.getElementById('new-category').addEventListener('submit', (event) => {
  event.preventDefault();
  send('POST', '/api/admin/categories', { name: document.getElementById('new-category-name').value, percent: document.getElementById('new-category-percent').value });
  document.getElementById('new-category-name').value = '';
});

refreshEvery5Seconds(loadCommissions);
