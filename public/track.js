// track.js - the private tracking page /track/<token>: the order code, how it is paid, and each shop's part with its
// products, costs, its status now and every earlier status with its time, and any reason. A part that is still placed
// has a Cancel button (the server puts its stock back). A wrong or missing token shows "Order not found".
// Each part has the kit's OrderTracker: the steps with their times, one human sentence ("Chilli Lane Pantry packed your
// order."), and while it is on its way, the expected delivery dates. The page refreshes every 5 seconds, so a shop's
// change shows up by itself. Right after checkout the order total rolls up once near the top (the kit's one
// celebration), above the OrderTrackers, so it plays where the customer is looking.

const TRACK_STEPS = ['placed', 'accepted', 'packed', 'shipped', 'delivered'];
let rolledUpOnce = false;

const trackingToken = pagePathPart(2);
const trackMessage = document.getElementById('message');

// Asks the server for the order and shows it (only when something changed since last time).
async function loadOrder() {
  if (!/^[a-f0-9]{64}$/.test(trackingToken)) return showOrderNotFound();
  try {
    const data = await api('GET', '/api/track/' + trackingToken);
    clearLoadProblem(trackMessage);
    if (!dataChanged('order', data)) return;
    showOrder(data);
  } catch (error) {
    if (error.status === 404) return showOrderNotFound();
    forgetDrawnData('order');
    showLoadProblem(trackMessage, error);
  }
}

// Fills the page: title, date and payment, one box per shop, and the totals.
function showOrder(data) {
  const order = data.order;
  document.title = `Order ${order.code} - ${siteName()}`;
  document.getElementById('order-title').textContent = `Order ${order.code}`;
  // Each part says whether it is paid (payment_words), so the order line only says how it is paid.
  const howPaid = order.payment_method === 'cod' ? 'Cash on delivery' : 'Online payment';
  document.getElementById('order-meta').textContent = `Placed ${formatDateTime(order.created_at)} · ${howPaid} · for ${order.customer_name}`;
  document.getElementById('order-address').textContent = 'Delivery address: ' + order.address;
  document.getElementById('parts').replaceChildren(...data.parts.map(partBox));
  document.getElementById('sum-items').textContent = formatMoney(order.items_total);
  document.getElementById('sum-shipping').textContent = order.shipping_total === 0 ? 'Free' : formatMoney(order.shipping_total);
  showNewOrderTotal(order);
  mountKit(document.getElementById('sum-grand'), IK.RollingNumber, {
    value: order.grand_total / 100, format: (n) => formatMoney(Math.round(n * 100)), animateOnMount: false,
  });
  document.getElementById('sum-still').textContent = formatMoney(order.still_to_pay);
  document.getElementById('still-row').classList.toggle('hidden', order.still_to_pay === order.grand_total);
  document.getElementById('not-found').classList.add('hidden');
  document.getElementById('order').classList.remove('hidden');
}

// Right after checkout: the order total near the top rolls up once (animateOnMount), before the shops' parts.
function showNewOrderTotal(order) {
  if (!isNewOrder) return;
  const celebrate = !rolledUpOnce;
  rolledUpOnce = true;
  mountKit(document.getElementById('new-grand'), IK.RollingNumber, {
    value: order.grand_total / 100, format: (n) => formatMoney(Math.round(n * 100)), animateOnMount: celebrate,
  });
  document.getElementById('new-total').classList.remove('hidden');
}

// One shop's part: name and status, its products and costs, the reason (if any), the courier (once shipped),
// every status with its time, and Cancel while it is still placed.
function partBox(part) {
  const box = make('section', 'card order-part');
  const top = make('div', 'card-top');
  const title = make('h2');
  const shopLink = make('a', '', part.shop_name);
  shopLink.href = '/store/' + encodeURIComponent(part.shop_slug);
  title.append(shopLink);
  top.append(title, orderStatusBadge(part.status));
  box.append(top);
  box.append(make('p', 'payment-words', part.payment_words));

  box.append(trackerFor(part));

  for (const item of part.items) {
    box.append(costRow(`${item.quantity} × ${item.name} (${formatMoney(item.unit_price)} each)`, formatMoney(item.line_total)));
  }
  box.append(costRow('Shipping', part.shipping === 0 ? 'Free shipping' : formatMoney(part.shipping)));
  if (part.gift_wrap) box.append(costRow('Gift wrap', formatMoney(part.gift_wrap)));
  if (part.gift_message) box.append(make('p', 'gift-message', `Gift message: "${part.gift_message}"`));
  box.append(costRow(`Total from ${part.shop_name}`, formatMoney(part.total), 'shop-total'));

  if (part.reason) box.append(make('p', 'reason', 'Reason: ' + part.reason));
  if (part.courier) box.append(make('p', '', `Sent with ${part.courier}, tracking number ${part.tracking_number}`));
  box.append(historyList(part.history));
  if (typeof partExtras === 'function') partExtras(part, box); // help, reviews (sectors 5 and 6)
  if (part.can_cancel) box.append(cancelButton(part));
  return box;
}

// The kit's OrderTracker for one part. A rejected or cancelled part shows no tracker, just its status and reason.
function trackerFor(part) {
  const slot = make('div', 'tracker-slot');
  if (part.status === 'rejected' || part.status === 'cancelled') return slot;
  const timeOf = (status) => {
    const step = part.history.find((h) => h.status === status);
    return step ? formatDateTime(step.at) : undefined;
  };
  const current = Math.max(TRACK_STEPS.indexOf(part.status), 0);
  mountKit(slot, IK.OrderTracker, {
    steps: TRACK_STEPS.map((status) => ({ label: ORDER_STATUS_WORDS[status], time: timeOf(status) })),
    current,
    eta: part.status === 'delivered' || part.status === 'pending_payment' ? undefined : etaWindow(part),
    status: statusSentence(part),
    meta: `${part.items.reduce((sum, item) => sum + item.quantity, 0)} item${part.items.length === 1 && part.items[0].quantity === 1 ? '' : 's'}`,
  });
  return slot;
}

// One human sentence for where the part is now.
function statusSentence(part) {
  const seasonal = window.SEASON_WORDS && SEASON_WORDS.sentence ? SEASON_WORDS.sentence(part) : null; // a season's warm words
  if (seasonal) return seasonal;
  const first = part.items[0] ? part.items[0].name.toLowerCase() : 'order';
  const sentences = {
    pending_payment: 'Waiting for your payment.',
    placed: `${part.shop_name} has your order and will accept it soon.`,
    accepted: `${part.shop_name} accepted your order.`,
    packed: `${part.shop_name} packed your ${first}.`,
    shipped: `${part.shop_name} shipped your order with ${part.courier}.`,
    delivered: 'Delivered. We hope you like it.',
  };
  return sentences[part.status] || ORDER_STATUS_WORDS[part.status];
}

// "24 to 27 Nov": the order date plus the shop's dispatch days and 2 to 5 days of travel.
function etaWindow(part) {
  const placed = new Date(part.history[0] ? part.history[0].at : Date.now());
  const day = (days) => new Date(placed.getTime() + days * 86400000);
  const from = day(part.delivery.from_days);
  const to = day(part.delivery.to_days);
  const month = (date) => date.toLocaleString('en-IN', { month: 'short' });
  return from.getMonth() === to.getMonth()
    ? `${from.getDate()} to ${to.getDate()} ${month(to)}`
    : `${from.getDate()} ${month(from)} to ${to.getDate()} ${month(to)}`;
}

// Help with this order: the open request (with the shop's reply and the outcome), or the button to ask for help.
// Reviews come in sector 6 (reviewExtras).
function partExtras(part, box) {
  if (part.help) {
    const help = make('div', 'reason');
    help.append(make('strong', '', part.help.status === 'open' ? 'Your help request' : 'Your help request (resolved)'));
    help.append(make('p', 'description', part.help.message));
    help.append(make('p', '', part.help.seller_reply ? `${part.shop_name} replied: ${part.help.seller_reply}` : `Waiting for ${part.shop_name} to reply.`));
    if (part.help.resolution) help.append(make('p', '', 'Outcome: ' + part.help.resolution));
    box.append(help);
  }
  if (part.can_ask_help) box.append(helpForm(part));
  if (typeof reviewExtras === 'function') reviewExtras(part, box);
}

// Reviews: once the part is delivered, each product can be rated 1 to 5 stars (a radio group with the number written)
// with an optional review of up to 500 characters, once. A posted review shows the kit's toast.
function reviewExtras(part, box) {
  if (part.status !== 'delivered') return;
  for (const item of part.items) {
    if (item.review_rating !== null) {
      const done = make('div', 'review-done');
      done.append(starRow(item.review_rating), make('span', 'small', ` Your review of ${item.name}: ${item.review_rating} out of 5`));
      if (item.review_reply) done.append(make('p', 'small', `${part.shop_name} replied: ${item.review_reply}`));
      box.append(done);
    } else if (item.can_review) {
      box.append(reviewForm(item));
    }
  }
}

// The form to rate one product (1 to 5 stars) with an optional review.
function reviewForm(item) {
  const form = make('form', 'review-form');
  const group = make('fieldset', 'star-picker');
  group.append(make('legend', '', 'Rate ' + item.name));
  for (let stars = 1; stars <= 5; stars += 1) {
    const label = make('label', 'star-choice');
    const radio = make('input');
    radio.type = 'radio';
    radio.name = 'rating-' + item.id;
    radio.value = String(stars);
    radio.addEventListener('change', () => { form.dataset.busy = 'yes'; });
    label.append(radio, starRow(stars), make('span', '', `${stars} star${stars === 1 ? '' : 's'}`));
    group.append(label);
  }
  const textLabel = make('label', '', 'Your review (optional, up to 500 characters)');
  const text = make('textarea');
  text.id = 'review-' + item.id;
  text.maxLength = 500;
  text.rows = 2;
  textLabel.htmlFor = text.id;
  text.addEventListener('input', () => { form.dataset.busy = 'yes'; });
  const note = make('div', 'message');
  const send = make('button', 'secondary', 'Post review');
  send.type = 'submit';
  form.append(group, textLabel, text, note, send);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const chosen = form.querySelector('input[type=radio]:checked');
    try {
      const answer = await api('POST', `/api/track/${trackingToken}/items/${item.id}/review`, { rating: chosen ? Number(chosen.value) : 0, text: text.value });
      showToast({ title: 'Review posted', body: item.name, tone: 'success' });
      showMessage(trackMessage, answer.message, 'ok');
      forgetDrawnData('order');
      loadOrder();
    } catch (error) {
      showMessage(note, error.message, 'error');
      playCue('error');
    }
  });
  return form;
}

// "Help with this order": a short form that reaches the shop and the admin.
function helpForm(part) {
  const details = make('details', 'help-box');
  details.append(make('summary', '', 'Help with this order'));
  const label = make('label', '', 'What went wrong? (up to 2000 characters)');
  const text = make('textarea');
  text.id = 'help-' + part.id;
  text.maxLength = 2000;
  text.rows = 3;
  label.htmlFor = text.id;
  text.addEventListener('input', () => { if (text.value) text.dataset.busy = 'yes'; else delete text.dataset.busy; });
  const note = make('div', 'message');
  const send = make('button', 'secondary', 'Send to the shop');
  send.type = 'button';
  send.addEventListener('click', async () => {
    try {
      const answer = await api('POST', `/api/track/${trackingToken}/parts/${part.id}/help`, { message: text.value });
      showMessage(trackMessage, answer.message, 'ok');
      forgetDrawnData('order');
      loadOrder();
    } catch (error) {
      showMessage(note, error.message, 'error');
      playCue('error');
    }
  });
  details.append(label, text, note, send);
  return details;
}

// A row like "2 × Green Chilli Pickle (₹180 each) ...... ₹360".
function costRow(label, value, extraClass) {
  const row = make('div', 'total-row' + (extraClass ? ' ' + extraClass : ''));
  row.append(make('span', '', label), make('span', '', value));
  return row;
}

// Every status of the part, oldest first, with its time: "Placed - 19 Nov 2026, 3:30 pm".
function historyList(history) {
  const list = make('ol', 'history');
  list.setAttribute('aria-label', 'What happened so far');
  for (const step of history) {
    list.append(make('li', '', `${ORDER_STATUS_WORDS[step.status] || step.status} - ${formatDateTime(step.at)}`));
  }
  return list;
}

// Cancel: the kit's ConfirmButton asks once ("Cancel this part?"), the second press cancels. Only this shop's part
// is cancelled; the server puts its items back in stock.
function cancelButton(part) {
  const area = make('div', 'cancel-area');
  const slot = make('span', 'confirm-slot');
  const note = make('div', 'message');
  note.setAttribute('role', 'alert');
  mountKit(slot, IK.ConfirmButton, {
    label: `Cancel the part from ${part.shop_name}`,
    confirmLabel: 'Cancel this part?',
    hint: `Press again to cancel the part from ${part.shop_name}. The other shops' parts are not changed.`,
    onConfirm: () => cancelPart(part, note),
  });
  area.append(slot, note);
  return area;
}

// Asks the server to cancel one part, then shows the answer and draws the order again.
async function cancelPart(part, note) {
  try {
    const result = await api('POST', `/api/track/${trackingToken}/parts/${part.id}/cancel`);
    showMessage(trackMessage, result.message, 'ok');
    forgetDrawnData('order');
    await loadOrder();
  } catch (error) {
    showMessage(note, error.message, 'error');
    playCue('error');
  }
}

// Plays one of the kit's sound cues ('error' here). The kit stays silent unless the shopper turned sound on.
function playCue(name) {
  if (window.IK && IK.sound) IK.sound.play(name);
}

// "Order not found" for a wrong or missing token.
function showOrderNotFound() {
  document.title = 'Order not found - ' + siteName();
  const heading = document.getElementById('order-title');
  heading.textContent = heading.dataset.notFoundTitle; // the page's one H1 says "Order not found"
  document.getElementById('new-total').classList.add('hidden');
  document.getElementById('order').classList.add('hidden');
  document.getElementById('not-found').classList.remove('hidden');
}

// Right after checkout (?new=1): say thank you once, and take ?new=1 out of the address.
function showThanksAfterCheckout() {
  if (new URLSearchParams(location.search).get('new') !== '1') return;
  document.getElementById('thanks').classList.remove('hidden');
  document.getElementById('done-steps').classList.remove('hidden');
  history.replaceState(null, '', location.pathname);
}

const isNewOrder = new URLSearchParams(location.search).get('new') === '1';
showThanksAfterCheckout();
refreshEvery5Seconds(loadOrder);
