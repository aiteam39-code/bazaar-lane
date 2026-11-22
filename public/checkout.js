// checkout.js - the checkout page: the order summary (priced by the server), the customer's details and how they pay,
// then Place order. The browser sends only product ids and quantities: the server works out every total itself.
// Pay online: the order waits for payment and the customer goes to FakePay (or Razorpay's test checkout); only the
// server's check of the payment moves it on. Cash on delivery: the phone is checked first with a 6-digit code (the
// kit's OtpInput). After the order is placed, the bag is emptied and the tracking link is remembered.

const checkoutMessage = document.getElementById('message');
const checkoutForm = document.getElementById('checkout-form');
const formMessage = document.getElementById('form-message');
const placeButton = document.getElementById('place-order');
let cartIsReady = false; // true when the cart has products and none of them has a problem
let codIsOn = true;
let paymentProvider = 'fake';
let phoneToken = null;     // given by the server once the phone code is right
let checkedPhone = null;   // the phone that code was for
let otpState = { value: '', status: 'idle', message: '' };

// Loads what the checkout may offer and the priced cart.
async function loadCheckout() {
  if (readCart().length === 0) return showEmptyCart();
  try {
    const [options, priced] = await Promise.all([
      api('GET', '/api/checkout/options'),
      api('POST', '/api/cart', { items: readCart() }),
    ]);
    showPaymentChoices(options);
    showSummary(priced);
  } catch (error) {
    showMessage(checkoutMessage, error.message, 'error');
  }
}

// "Your cart is empty".
function showEmptyCart() {
  document.getElementById('summary').classList.add('hidden');
  checkoutForm.classList.add('hidden');
  document.getElementById('cart-empty').classList.remove('hidden');
}

// Pay online is always offered; cash on delivery only while the admin has it switched on.
function showPaymentChoices(options) {
  codIsOn = options.cod_enabled;
  paymentProvider = options.provider;
  const cod = document.getElementById('pay-cod');
  cod.disabled = !codIsOn;
  if (!codIsOn) {
    cod.checked = false;
    document.getElementById('pay-online').checked = true;
    cod.closest('label').append(make('span', 'muted', ' (switched off right now)'));
  }
  showPhoneCheck();
  updatePlaceButton();
}

// The chosen way to pay: 'online' or 'cod'.
function chosenPayment() {
  const chosen = checkoutForm.querySelector('input[name=payment]:checked');
  return chosen ? chosen.value : '';
}

// The phone check shows only for cash on delivery.
function showPhoneCheck() {
  document.getElementById('phone-check').classList.toggle('hidden', chosenPayment() !== 'cod');
  updatePlaceButton();
}
checkoutForm.querySelectorAll('input[name=payment]').forEach((radio) => radio.addEventListener('change', showPhoneCheck));

// "Send code": the server sends a code to the phone (into the outbox; the page shows it as a test SMS).
document.getElementById('send-code').addEventListener('click', async () => {
  const phone = document.getElementById('phone').value;
  const sentLine = document.getElementById('code-sent');
  try {
    const answer = await api('POST', '/api/checkout/phone-code', { phone });
    checkedPhone = phone.replace(/\D/g, '').slice(-10);
    phoneToken = null;
    sentLine.textContent = answer.message + ' You can ask for a new one after 30 seconds.';
    sentLine.classList.remove('hidden');
    const test = document.getElementById('test-sms');
    test.textContent = `Test SMS (this app sends no real SMS): your code is ${answer.test_sms}`;
    test.classList.remove('hidden');
    otpState = { value: '', status: 'idle', message: '' };
    document.getElementById('otp').classList.remove('hidden');
    drawOtp(true);
  } catch (error) {
    showMessage(formMessage, error.message, 'error');
  }
});

// The kit's code boxes. When all 6 are filled, the server checks the code.
function drawOtp(autoFocus) {
  mountKit(document.getElementById('otp'), IK.OtpInput, {
    length: 6, value: otpState.value, status: otpState.status, message: otpState.message, label: 'Code', autoFocus,
    onChange: (code) => { otpState = { value: code, status: 'idle', message: '' }; drawOtp(false); },
    onComplete: checkCode,
  });
}

async function checkCode(code) {
  otpState = { value: code, status: 'verifying', message: 'Checking...' };
  drawOtp(false);
  try {
    const answer = await api('POST', '/api/checkout/phone-verify', { phone: checkedPhone, code });
    phoneToken = answer.phone_token;
    otpState = { value: code, status: 'success', message: 'Phone checked.' };
  } catch (error) {
    otpState = { value: code, status: 'error', message: error.message };
  }
  drawOtp(false);
  updatePlaceButton();
}

// The order summary: each shop with its products, shipping and total, then the grand total.
// Products with a problem are listed with the server's message and a link back to the cart.
function showSummary(priced) {
  const groups = priced.groups.map((group) => {
    const box = make('div', 'summary-group');
    box.append(make('h3', '', group.shop_name));
    for (const line of group.lines) {
      box.append(summaryRow(`${line.quantity} × ${line.name}`, formatMoney(line.line_total)));
    }
    box.append(summaryRow('Shipping', group.shipping === 0 ? 'Free shipping' : formatMoney(group.shipping)));
    box.append(summaryRow(`Total from ${group.shop_name}`, formatMoney(group.total), 'shop-total'));
    return box;
  });
  document.getElementById('summary-groups').replaceChildren(...groups);
  document.getElementById('summary-total').textContent = formatMoney(priced.grand_total);
  document.getElementById('summary').classList.remove('hidden');
  checkoutForm.classList.remove('hidden');

  cartIsReady = priced.problems.length === 0 && priced.groups.length > 0;
  if (priced.problems.length > 0) {
    const first = priced.problems[0].message;
    showMessage(checkoutMessage, `${first} Please fix it in the cart first.`, 'error');
  } else {
    clearMessage(checkoutMessage);
  }
  placeButton.dataset.total = formatMoney(priced.grand_total);
  updatePlaceButton();
}

// A row like "2 × Green Chilli Pickle ...... Rs 360".
function summaryRow(label, value, extraClass) {
  const row = make('div', 'total-row' + (extraClass ? ' ' + extraClass : ''));
  row.append(make('span', '', label), make('span', '', value));
  return row;
}

// "Pay ₹1,110" or "Place order - ₹1,110", switched off while the bag has a problem, or a COD phone is not checked.
function updatePlaceButton() {
  const online = chosenPayment() === 'online';
  const words = online ? 'Pay' : 'Place order -';
  placeButton.textContent = placeButton.dataset.total ? `${words} ${placeButton.dataset.total}` : 'Place order';
  const codReady = codIsOn && phoneToken !== null;
  placeButton.disabled = !cartIsReady || (!online && !codReady);
}

// Sends the order. The server checks everything again and works out the total itself.
checkoutForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(formMessage);
  placeButton.disabled = true;
  placeButton.textContent = 'Placing your order...';
  try {
    const result = await api('POST', '/api/checkout', {
      customer_name: document.getElementById('customer-name').value,
      phone: document.getElementById('phone').value,
      email: document.getElementById('email').value,
      address: document.getElementById('address').value,
      payment_method: chosenPayment(),
      phone_token: phoneToken,
      items: readCart(),
    });
    rememberOrder({ code: result.code, token: result.tracking_url.split('/')[2], total: result.grand_total, at: new Date().toISOString() });
    if (!result.payment) {
      saveCart([]);
      return location.assign(result.tracking_url + '?new=1');
    }
    // Online: the bag is emptied only once the payment is received, so a failed payment can be tried again.
    if (result.payment.pay_url) return location.assign(result.payment.pay_url);
    openRazorpay(result.payment, result.tracking_url);
  } catch (error) {
    showMessage(formMessage, error.message, 'error');
    await loadCheckout(); // a price or the stock may have changed: show the bag as it is now
    updatePlaceButton();
  }
});

// Razorpay's test checkout (only when test keys are set): its script is loaded from Razorpay, then its result is sent
// to the server, which checks the signature before the order counts as paid.
function openRazorpay(payment, trackingUrl) {
  const script = document.createElement('script');
  script.src = 'https://checkout.razorpay.com/v1/checkout.js';
  script.onload = () => {
    const checkout = new window.Razorpay({
      key: payment.razorpay.key, order_id: payment.razorpay.order_id, amount: payment.razorpay.amount,
      currency: payment.razorpay.currency, name: siteName(), description: 'Order ' + payment.razorpay.name,
      handler: (response) => sendPaymentResult({ payment_id: payment.id, ...response }),
      modal: { ondismiss: () => location.assign(trackingUrl) },
    });
    checkout.on('payment.failed', () => sendPaymentResult({ payment_id: payment.id, status: 'failed' }));
    checkout.open();
  };
  document.head.append(script);
}

// Sends the provider's result to the server, then opens the order (or says what happened).
async function sendPaymentResult(result) {
  try {
    const answer = await api('POST', '/api/payments/verify', result);
    if (answer.status === 'paid') saveCart([]);
    location.assign(answer.tracking_url);
  } catch (error) {
    showMessage(formMessage, error.message, 'error');
  }
}

loadCheckout();
