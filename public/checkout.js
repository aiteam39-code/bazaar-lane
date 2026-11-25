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
let gifts = {};              // per shop slug: { wrap: true or false, message } (only while a season offers them)
let giftControlsDrawn = false;

// Loads what the checkout may offer and the priced cart.
async function loadCheckout() {
  if (readCart().length === 0) return showEmptyCart();
  try {
    const [options, priced] = await Promise.all([
      api('GET', '/api/checkout/options'),
      api('POST', '/api/cart', { items: readCart(), gifts }),
    ]);
    showPaymentChoices(options);
    showSummary(priced);
    if (priced.gift_options && !giftControlsDrawn) showGiftOptions(priced.groups);
  } catch (error) {
    showMessage(checkoutMessage, error.message, 'error');
  }
}

// "Your bag is empty".
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

// "Send code": the server sends a code to the phone (into the outbox). Outside production the server also sends the
// code back, and the page shows it marked as a test SMS. Then the button counts down 30 seconds before a new code.
document.getElementById('send-code').addEventListener('click', async () => {
  const phone = document.getElementById('phone').value;
  const sentLine = document.getElementById('code-sent');
  const test = document.getElementById('test-sms');
  clearMessage(formMessage);
  try {
    const answer = await api('POST', '/api/checkout/phone-code', { phone });
    checkedPhone = phone.replace(/\D/g, '').slice(-10);
    phoneToken = null;
    sentLine.textContent = answer.message;
    sentLine.classList.remove('hidden');
    test.textContent = answer.test_sms ? `Test SMS (this app sends no real SMS): your code is ${answer.test_sms}` : '';
    test.classList.toggle('hidden', !answer.test_sms);
    otpState = { value: '', status: 'idle', message: '' };
    document.getElementById('otp').classList.remove('hidden');
    drawOtp(true);
    startResendCountdown(answer.resend_after_seconds || 30);
  } catch (error) {
    playSound('error');
    showMessage(formMessage, error.message, 'error');
  }
});

// Switches "Send code" off and counts down ("Send a new code in 29 s"), then offers "Send a new code".
// The server still refuses a new code within 30 seconds, whatever the page does.
let resendTimer = null;
function startResendCountdown(seconds) {
  const button = document.getElementById('send-code');
  let left = seconds;
  clearInterval(resendTimer);
  button.disabled = true;
  button.textContent = `Send a new code in ${left} s`;
  resendTimer = setInterval(() => {
    left -= 1;
    if (left > 0) {
      button.textContent = `Send a new code in ${left} s`;
      return;
    }
    clearInterval(resendTimer);
    button.disabled = false;
    button.textContent = 'Send a new code';
  }, 1000);
}

// The kit's code boxes. When all 6 are filled, the server checks the code.
function drawOtp(autoFocus) {
  mountKit(document.getElementById('otp'), IK.OtpInput, {
    length: 6, value: otpState.value, status: otpState.status, message: otpState.message, label: 'Code', autoFocus,
    onChange: (code) => { otpState = { value: code, status: 'idle', message: '' }; drawOtp(false); },
    onComplete: checkCode,
  });
}

// Asks the server whether the 6 digits are the right code. Right: the "paid" sound (when sound is on) and the
// phone is checked. Wrong: the server's words ("That code didn't match. 4 tries left.") and the "error" sound.
async function checkCode(code) {
  otpState = { value: code, status: 'verifying', message: 'Checking...' };
  drawOtp(false);
  try {
    const answer = await api('POST', '/api/checkout/phone-verify', { phone: checkedPhone, code });
    phoneToken = answer.phone_token;
    otpState = { value: code, status: 'success', message: 'Phone checked.' };
    playSound('paid');
  } catch (error) {
    playSound('error');
    otpState = { value: code, status: 'error', message: error.message };
  }
  drawOtp(false);
  updatePlaceButton();
}

// The order summary: each shop with its products, shipping and total, then the grand total.
// A product with a problem shows the server's message and asks the customer to fix it in the bag.
function showSummary(priced) {
  const groups = priced.groups.map((group) => {
    const box = make('div', 'summary-group');
    box.append(make('h3', '', vendorLine({ shop_name: group.shop_name, city: group.city })));
    for (const line of group.lines) {
      box.append(summaryRow(`${line.quantity} × ${line.name}`, formatMoney(line.line_total)));
    }
    box.append(summaryRow('Shipping', group.shipping === 0 ? 'Free shipping' : formatMoney(group.shipping)));
    if (group.gift_wrap) box.append(summaryRow('Gift wrap', formatMoney(group.gift_wrap)));
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
    showMessage(checkoutMessage, `${first} Fix it in your bag first.`, 'error');
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
      gifts: readGiftChoices(),
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
    playSound('error');
    showMessage(formMessage, error.message, 'error');
    await loadCheckout(); // a price or the stock may have changed: show the bag as it is now
    updatePlaceButton();
  }
});

// Gift options (only while a festival season offers them): per shop, "Gift wrap" at the shop's own price (when it
// offers one) and a gift message of up to 200 characters. Ticking the wrap prices the order again on the server.
function showGiftOptions(groups) {
  giftControlsDrawn = true;
  document.getElementById('gift-shops').replaceChildren(...groups.map((group) => {
    const box = make('div', 'gift-shop');
    box.append(make('p', 'gift-shop-name', group.shop_name));
    gifts[group.shop_slug] = { wrap: false, message: '' };
    if (group.gift_wrap_price > 0) {
      const label = make('label', 'choice');
      const tick = make('input');
      tick.type = 'checkbox';
      tick.dataset.giftWrap = group.shop_slug;
      tick.addEventListener('change', async () => {
        gifts[group.shop_slug].wrap = tick.checked;
        try {
          showSummary(await api('POST', '/api/cart', { items: readCart(), gifts: readGiftChoices() }));
        } catch (error) {
          showMessage(formMessage, error.message, 'error');
        }
      });
      label.append(tick, ` Gift wrap (${formatMoney(group.gift_wrap_price)})`);
      box.append(label);
    } else {
      box.append(make('p', 'small muted', 'This shop does not offer gift wrap.'));
    }
    const messageLabel = make('label', 'small', 'Gift message (up to 200 characters, printed for the shop)');
    const message = make('textarea');
    message.id = 'gift-message-' + group.shop_slug;
    message.maxLength = 200;
    message.rows = 2;
    message.dataset.giftMessage = group.shop_slug;
    messageLabel.htmlFor = message.id;
    box.append(messageLabel, message);
    return box;
  }));
  document.getElementById('gift-options').classList.remove('hidden');
}

// What the customer chose: { slug: { wrap, message } }. Never a price: the server prices the wrap.
function readGiftChoices() {
  const choices = {};
  for (const [slug, gift] of Object.entries(gifts)) {
    const message = document.querySelector(`[data-gift-message="${CSS.escape(slug)}"]`);
    choices[slug] = { wrap: gift.wrap, message: message ? message.value : '' };
  }
  return choices;
}

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
    if (answer.status === 'paid') {
      saveCart([]);
      playSound('paid');
    } else {
      playSound('error');
    }
    location.assign(answer.tracking_url);
  } catch (error) {
    playSound('error');
    showMessage(formMessage, error.message, 'error');
  }
}

loadCheckout();
