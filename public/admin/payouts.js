// admin/payouts.js - every shop's balance (a RollingNumber), Record payout (amount and a reference; the kit's
// ConfirmButton), and the recent payouts. A payout bigger than the balance is refused by the server.
// Refreshes every 5 seconds, but never while someone is typing.

const payoutsMessage = document.getElementById('message');
const moneyRoll = (paise) => ({ value: paise / 100, format: (n) => formatMoney(Math.round(n * 100)), animateOnMount: false });

async function loadPayouts() {
  try {
    const data = await api('GET', '/api/admin/payouts');
    clearLoadProblem(payoutsMessage);
    if (!dataChanged('payouts', data)) return;
    mountKit(document.getElementById('due'), IK.RollingNumber, moneyRoll(data.due));
    document.getElementById('shop-list').replaceChildren(...data.shops.map(shopCard));
    document.getElementById('payout-list').replaceChildren(...data.payouts.map((p) =>
      make('li', '', `${formatDateTime(p.created_at)} · ${p.shop_name} · ${formatMoney(p.amount)} · ${p.note}`)));
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(payoutsMessage, error);
  }
}

function shopCard(shop) {
  const card = make('article', 'card');
  const top = make('div', 'card-top');
  const balance = make('span', 'kpi');
  mountKit(balance, IK.RollingNumber, moneyRoll(shop.balance));
  top.append(make('h2', '', shop.shop_name), balance);
  card.append(top);
  card.append(make('p', 'small muted', shop.balance > 0 ? 'The platform owes this shop.' : shop.balance < 0 ? `This shop owes ${formatMoney(-shop.balance)} in commission.` : 'Nothing owed either way.'));
  if (shop.balance > 0) card.append(payoutForm(shop));
  return card;
}

function payoutForm(shop) {
  const form = make('div', 'inline-row');
  const amount = make('input', 'short-box');
  amount.id = 'amount-' + shop.id;
  amount.inputMode = 'decimal';
  amount.maxLength = 12;
  amount.placeholder = 'Amount (₹)';
  amount.setAttribute('aria-label', 'Payout amount in rupees for ' + shop.shop_name);
  const note = make('input');
  note.id = 'note-' + shop.id;
  note.maxLength = 100;
  note.placeholder = 'Reference, like a bank transfer number';
  note.setAttribute('aria-label', 'Payout reference for ' + shop.shop_name);
  for (const box of [amount, note]) box.addEventListener('input', () => { if (box.value) box.dataset.busy = 'yes'; else delete box.dataset.busy; });
  const confirm = make('span');
  mountKit(confirm, IK.ConfirmButton, {
    label: 'Record payout', confirmLabel: 'Record payout?', hint: 'Press again to record this payout',
    onConfirm: async () => {
      try {
        const answer = await api('POST', '/api/admin/payouts', { seller_id: shop.id, amount: amount.value, note: note.value });
        showMessage(payoutsMessage, answer.message, 'ok');
        forgetDrawnData('payouts');
        document.querySelectorAll('[data-busy]').forEach((box) => delete box.dataset.busy);
        loadPayouts();
      } catch (error) {
        showMessage(payoutsMessage, error.message, 'error');
      }
    },
  });
  form.append(amount, note, confirm);
  return form;
}

refreshEvery5Seconds(loadPayouts);
