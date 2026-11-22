// pay.js - FakePay, the pretend payment page used when no Razorpay test keys are set (/pay/fake/<payment id>).
// A button asks "FakePay" for a signed result, then sends that result to the server, which checks the signature.
// Paid: the bag is emptied and the order page opens. Failed: the order is cancelled and the stock goes back.

const paymentId = pagePathPart(3); // /pay/fake/7 -> "7"
const payMessage = document.getElementById('message');

// Shows the amount to pay and the order code (or says the payment is already finished).
async function loadPayment() {
  try {
    const info = await api('GET', '/api/pay/fake/' + encodeURIComponent(paymentId));
    if (info.status !== 'created') return showFinished(info);
    document.getElementById('pay-code').textContent = 'Order ' + info.code;
    document.getElementById('pay-amount').textContent = formatMoney(info.amount);
    document.getElementById('pay-details').classList.remove('hidden');
  } catch (error) {
    showMessage(payMessage, error.message, 'error');
  }
}

// A payment that is paid or failed already.
function showFinished(info) {
  const paid = info.status === 'paid';
  showMessage(payMessage, paid ? 'This order is already paid.' : 'This payment did not go through, so the order was cancelled.', paid ? 'ok' : 'error');
  showAfterLinks(info.tracking_url, !paid);
}

// "See your order", and after a failure "Back to your bag" to try again.
function showAfterLinks(trackingUrl, failed) {
  const links = document.getElementById('after-links');
  const order = make('a', '', 'See your order');
  order.href = trackingUrl;
  links.replaceChildren(order);
  if (failed) {
    const bag = make('a', 'button accent', 'Back to your bag');
    bag.href = '/cart.html';
    links.append(' ', bag);
  }
  links.classList.remove('hidden');
}

// One of the three buttons: get FakePay's signed result, then let the server check it.
document.querySelectorAll('[data-outcome]').forEach((button) => {
  button.addEventListener('click', async () => {
    document.querySelectorAll('[data-outcome]').forEach((b) => { b.disabled = true; });
    try {
      const result = await api('POST', '/api/pay/fake/' + encodeURIComponent(paymentId), { outcome: button.dataset.outcome });
      const answer = await api('POST', '/api/payments/verify', result);
      if (answer.status === 'paid') {
        saveCart([]);
        return location.assign(answer.tracking_url);
      }
      document.getElementById('pay-details').classList.add('hidden');
      showMessage(payMessage, answer.message + ' Your order was cancelled and nothing was charged; your bag still has the products.', 'error');
      showAfterLinks(answer.tracking_url, true);
    } catch (error) {
      showMessage(payMessage, error.message, 'error');
      document.querySelectorAll('[data-outcome]').forEach((b) => { b.disabled = false; });
    }
  });
});

loadPayment();
