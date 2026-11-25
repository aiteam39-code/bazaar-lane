// admin/help.js - the admin's Help requests page: Open and Resolved tabs. Each open request shows the order, the shop,
// the customer's message and the shop's reply; the admin resolves it with a note, and while the part is not shipped can
// also cancel and refund it. Refreshes every 5 seconds, but never while someone is typing.

const helpMessage = document.getElementById('message');
let helpTab = 'open';

// Loads the help requests in the current tab and draws the tabs and the list.
async function loadHelp() {
  try {
    const data = await api('GET', '/api/admin/help?tab=' + helpTab);
    clearLoadProblem(helpMessage);
    setNavBadge('/admin/help.html', data.counts.open, 'open help requests');
    if (!dataChanged('help', data)) return;
    document.getElementById('tabs').replaceChildren(...['open', 'resolved'].map((tab) => {
      const tabButton = make('button', tab === helpTab ? 'tab active' : 'tab', `${tab === 'open' ? 'Open' : 'Resolved'} (${data.counts[tab]})`);
      tabButton.type = 'button';
      tabButton.addEventListener('click', () => { helpTab = tab; forgetDrawnData('help'); loadHelp(); });
      return tabButton;
    }));
    document.getElementById('request-list').replaceChildren(...data.requests.map(requestCard));
    document.getElementById('no-requests').classList.toggle('hidden', data.requests.length > 0);
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(helpMessage, error);
  }
}

// One help request: order, shop, customer, message, the shop's reply, and the resolve form (or the outcome).
function requestCard(request) {
  const card = make('article', 'card');
  const top = make('div', 'card-top');
  top.append(make('h2', '', `${request.code} · ${request.shop_name}`), orderStatusBadge(request.part_status));
  card.append(top);
  card.append(make('p', 'small muted', `${request.customer_name} · ${request.phone} · ${request.email} · ${formatDateTime(request.created_at)}`));
  card.append(make('p', 'description', request.message));
  card.append(make('p', 'small', request.seller_reply ? 'Shop replied: ' + request.seller_reply : 'The shop has not replied yet.'));
  if (request.status === 'resolved') {
    card.append(make('p', 'reason', 'Outcome: ' + request.resolution));
    return card;
  }
  const form = make('form', 'inline-form');
  const label = make('label', '', 'What was decided? The customer sees this.');
  const note = make('textarea');
  note.id = 'resolution-' + request.id;
  note.maxLength = 2000;
  note.rows = 2;
  label.htmlFor = note.id;
  form.append(label, note);
  let cancelBox = null;
  if (request.can_cancel) {
    const choice = make('label', 'choice');
    cancelBox = make('input');
    cancelBox.type = 'checkbox';
    choice.append(cancelBox, ` Also cancel this part${request.payment_status === 'paid' ? ' and refund the customer' : ''}`);
    form.append(choice);
  }
  const box = make('div', 'message');
  const resolve = make('button', '', 'Resolve');
  resolve.type = 'submit';
  // With "Also cancel" ticked, Resolve becomes the kit's two-step ConfirmButton ("Cancel and refund?").
  const confirmResolve = make('span', 'hidden');
  if (cancelBox) mountKit(confirmResolve, IK.ConfirmButton, {
    label: 'Resolve and cancel', confirmLabel: request.payment_status === 'paid' ? 'Cancel and refund?' : 'Cancel this part?',
    hint: 'Press again to resolve, cancel this part and refund it if it was paid',
    onConfirm: () => sendResolve(),
  });
  if (cancelBox) {
    cancelBox.addEventListener('change', () => {
      resolve.classList.toggle('hidden', cancelBox.checked);
      confirmResolve.classList.toggle('hidden', !cancelBox.checked);
    });
  }
  form.append(box, resolve, confirmResolve);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (cancelBox && cancelBox.checked) return; // cancelling needs the ConfirmButton's second press
    sendResolve();
  });
  // Sends the resolution (and the cancel, when ticked) to the server.
  async function sendResolve() {
    try {
      const answer = await api('POST', `/api/admin/help/${request.id}/resolve`, { resolution: note.value, cancel: Boolean(cancelBox && cancelBox.checked) });
      showMessage(helpMessage, answer.message, 'ok');
      forgetDrawnData('help');
      loadHelp();
    } catch (error) {
      showMessage(box, error.message, 'error');
    }
  }
  card.append(form);
  return card;
}

refreshEvery5Seconds(loadHelp);
