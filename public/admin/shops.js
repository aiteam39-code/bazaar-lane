// admin/shops.js - the admin's Shops page: tabs Pending, Active, Suspended, Rejected, and the buttons for each shop.
// Reject and Suspend open a reason box first. The page refreshes every 5 seconds, but not while a reason box is open.

// The buttons each tab shows.
const SHOP_BUTTONS = {
  pending: [
    { action: 'approve', label: 'Approve' },
    { action: 'reject', label: 'Reject', needsReason: true, style: 'danger' },
  ],
  active: [
    { action: 'suspend', label: 'Suspend', needsReason: true, style: 'danger' },
  ],
  suspended: [
    { action: 'reactivate', label: 'Reactivate' },
  ],
  rejected: [
    { action: 'approve', label: 'Approve' },
  ],
};

const STATUS_LABEL = { pending: 'Pending', active: 'Active', suspended: 'Suspended', rejected: 'Rejected' };

const shopsMessage = document.getElementById('message');
const shopList = document.getElementById('shop-list');
let currentTab = tabFromAddress();

// The tab named in the address (?tab=active), or Pending.
function tabFromAddress() {
  const tab = new URLSearchParams(location.search).get('tab');
  return Object.hasOwn(SHOP_BUTTONS, tab || '') ? tab : 'pending';
}

// Loads the shops in the current tab, and the count for every tab (drawn again only when something changed).
async function loadShops() {
  const tabAsked = currentTab;
  try {
    const data = await api('GET', '/api/admin/shops?tab=' + tabAsked);
    if (tabAsked !== currentTab) return; // the admin switched tabs while this was loading
    clearLoadProblem(shopsMessage);
    if (!dataChanged('shops', data)) return;
    showTabs(data.counts);
    showShops(data.shops);
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    forgetDrawnData('shops'); // draw everything again once loading works
    showLoadProblem(shopsMessage, error);
  }
}

// Marks the current tab and writes how many shops each tab has.
function showTabs(counts) {
  document.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === currentTab);
  });
  document.querySelectorAll('[data-count]').forEach((count) => {
    count.textContent = counts[count.dataset.count];
  });
}

// Shows one card per shop, or "No shops here."
function showShops(shops) {
  shopList.replaceChildren(...shops.map(shopCard));
  document.getElementById('empty').classList.toggle('hidden', shops.length > 0);
}

// One shop: name, status, email, phone, web address, sign-up time, the reason (if any), and the buttons.
function shopCard(shop) {
  const card = make('article', 'card');
  const top = make('div', 'card-top');
  top.append(make('h3', '', shop.shop_name), make('span', 'badge badge-' + shop.status, STATUS_LABEL[shop.status]));
  card.append(top);
  card.append(make('p', 'muted', `${shop.email || 'no email'} · ${shop.phone}`));
  card.append(make('p', 'muted', `/store/${shop.slug} · signed up ${formatDateTime(shop.created_at)}`));
  if (shop.status_reason) card.append(make('p', 'reason', 'Reason: ' + shop.status_reason));

  const buttons = make('div', 'actions');
  for (const button of SHOP_BUTTONS[shop.status]) {
    const element = make('button', button.style || '', button.label);
    element.type = 'button';
    element.addEventListener('click', () => {
      if (button.needsReason) openReasonBox(card, shop, button);
      else doShopAction(shop, button.action, '', null);
    });
    buttons.append(element);
  }
  card.append(buttons);
  return card;
}

// Opens a box under the shop to type the reason for Reject or Suspend. The seller will see this reason.
function openReasonBox(card, shop, button) {
  closeReasonBoxes();
  const box = make('div', 'reason-box');
  box.dataset.busy = 'yes'; // stops the 5-second refresh while the box is open

  const input = make('textarea');
  input.id = 'reason-' + shop.id;
  input.rows = 3;
  input.maxLength = 200;
  const label = make('label', '', `Why ${button.label.toLowerCase()} ${shop.shop_name}? The seller will see this.`);
  label.htmlFor = input.id;
  const boxMessage = make('div', 'message');

  const confirm = make('button', 'danger', button.label + ' shop');
  confirm.type = 'button';
  confirm.addEventListener('click', () => doShopAction(shop, button.action, input.value, boxMessage));
  const cancel = make('button', 'secondary', 'Cancel');
  cancel.type = 'button';
  cancel.addEventListener('click', closeReasonBoxes);

  const row = make('div', 'actions');
  row.append(confirm, cancel);
  box.append(label, input, boxMessage, row);
  card.append(box);
  input.focus();
}

// Closes any open reason box.
function closeReasonBoxes() {
  document.querySelectorAll('.reason-box').forEach((box) => box.remove());
}

// Sends Approve, Reject, Suspend or Reactivate to the server, then reloads the list.
// A problem shows inside the reason box when one is open, otherwise at the top.
async function doShopAction(shop, action, reason, boxMessage) {
  clearMessage(shopsMessage);
  try {
    const result = await api('POST', `/api/admin/shops/${shop.id}/${action}`, { reason });
    closeReasonBoxes();
    showMessage(shopsMessage, result.message, 'ok');
    await loadShops();
  } catch (error) {
    if (goToLoginIfNeeded(error)) return;
    showMessage(boxMessage || shopsMessage, error.message, 'error');
  }
}

// Switching tabs: remember the tab in the address, close reason boxes, and load that tab.
document.querySelectorAll('[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    currentTab = tab.dataset.tab;
    history.replaceState(null, '', '?tab=' + currentTab);
    closeReasonBoxes();
    clearMessage(shopsMessage);
    loadShops();
  });
});

refreshEvery5Seconds(loadShops);
