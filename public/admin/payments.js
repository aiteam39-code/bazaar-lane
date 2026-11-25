// admin/payments.js - every online payment (newest first) with its refunds and how it splits per shop (the shop's
// total, the platform's commission and the shop's share), parts whose refund failed (with Try again), the cash on
// delivery switch and "Run the 30-minute check now". Refreshes every 5 seconds.

const paymentsMessage = document.getElementById('message');
let codOn = true;

// Plain words for a payment's status and a part's payment state (never the database codes).
const PAYMENT_STATUS_WORDS = { created: 'Waiting for payment', paid: 'Paid', failed: 'Failed' };
const PART_PAID_WORDS = { unpaid: 'Not paid yet', paid: 'Paid', refunded: 'Refunded' };

// Loads the payments, the refunds still due and the cash on delivery switch, and draws them.
async function loadPayments() {
  try {
    const data = await api('GET', '/api/admin/payments');
    clearLoadProblem(paymentsMessage);
    if (!dataChanged('payments', data)) return;
    codOn = data.cod_enabled;
    document.getElementById('provider-line').textContent = data.provider === 'fake'
      ? 'Payments use FakePay (test mode, no real money). Set Razorpay TEST keys to use Razorpay test mode.'
      : 'Payments use Razorpay in test mode.';
    document.getElementById('cod-state').textContent = codOn ? 'Cash on delivery is on. Customers can choose it at checkout.' : 'Cash on delivery is off. The server refuses it at checkout.';
    document.getElementById('cod-toggle').textContent = codOn ? 'Switch cash on delivery off' : 'Switch cash on delivery on';
    showRefundDue(data.refund_due);
    document.getElementById('payment-list').replaceChildren(...data.payments.map(paymentCard));
    document.getElementById('no-payments').classList.toggle('hidden', data.payments.length > 0);
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(paymentsMessage, error);
  }
}

// One payment: order, amount, status, provider references, the split per shop, and the refunds.
function paymentCard(payment) {
  const card = make('article', 'card');
  const top = make('div', 'card-top');
  top.append(make('h3', '', `${payment.code} · ${formatMoney(payment.amount)}`), make('span', 'badge ' + statusColour(payment.status), PAYMENT_STATUS_WORDS[payment.status] || payment.status));
  card.append(top);
  card.append(make('p', 'muted small', `${payment.customer_name} · ${payment.provider === 'fake' ? 'FakePay' : 'Razorpay test'} · ${formatDateTime(payment.created_at)} · ${payment.order_ref || ''}${payment.paid_ref ? ' / ' + payment.paid_ref : ''}`));
  const table = make('table', 'split');
  const head = make('tr');
  for (const word of ['Shop', 'Total', 'Commission', 'Shop share', 'Status']) head.append(make('th', '', word));
  table.append(head);
  for (const part of payment.split) {
    const row = make('tr');
    row.append(make('td', '', part.shop_name), make('td', '', formatMoney(part.total)),
      make('td', '', `${formatMoney(part.commission)} (${part.commission_bps / 100}%)`), make('td', '', formatMoney(part.shop_share)),
      make('td', '', `${ORDER_STATUS_WORDS[part.status] || part.status}, ${PART_PAID_WORDS[part.payment_status] || part.payment_status}`));
    table.append(row);
  }
  const scroll = make('div', 'table-scroll');
  scroll.append(table);
  card.append(scroll);
  for (const refund of payment.refunds) {
    card.append(make('p', 'small', `Refunded ${formatMoney(refund.amount)} to the customer for ${refund.shop_name} · ${formatDateTime(refund.created_at)} · ${refund.provider_ref || ''}`));
  }
  return card;
}

// The badge colour for a payment's status (the badge also has words, so colour is never alone).
function statusColour(status) {
  return status === 'paid' ? 'badge-active' : status === 'failed' ? 'badge-rejected' : 'badge-pending';
}

// Parts that were paid and then rejected or cancelled, whose refund did not go through: Try again.
function showRefundDue(parts) {
  document.getElementById('refund-due-box').classList.toggle('hidden', parts.length === 0);
  document.getElementById('refund-due').replaceChildren(...parts.map((part) => {
    const row = make('div', 'problem-row');
    row.append(make('p', '', `${part.code} · ${part.shop_name} · ${ORDER_STATUS_WORDS[part.status] || part.status} · ${formatMoney(part.amount)}`));
    const retry = make('button', 'secondary', 'Try the refund again');
    retry.type = 'button';
    retry.addEventListener('click', async () => {
      try {
        const answer = await api('POST', `/api/admin/parts/${part.id}/refund`);
        showMessage(paymentsMessage, answer.message, 'ok');
        forgetDrawnData('payments');
        loadPayments();
      } catch (error) {
        showMessage(paymentsMessage, error.message, 'error');
      }
    });
    row.append(retry);
    return row;
  }));
}

document.getElementById('cod-toggle').addEventListener('click', async () => {
  try {
    const answer = await api('POST', '/api/admin/settings/cod', { enabled: !codOn });
    showMessage(paymentsMessage, answer.message, 'ok');
    forgetDrawnData('payments');
    loadPayments();
  } catch (error) {
    showMessage(paymentsMessage, error.message, 'error');
  }
});

document.getElementById('run-expiry').addEventListener('click', async () => {
  try {
    const answer = await api('POST', '/api/admin/payments/run-expiry');
    showMessage(paymentsMessage, answer.message, 'ok');
    forgetDrawnData('payments');
    loadPayments();
  } catch (error) {
    showMessage(paymentsMessage, error.message, 'error');
  }
});

refreshEvery5Seconds(loadPayments);
