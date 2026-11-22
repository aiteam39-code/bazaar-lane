// seller/signup.js - sends the sign-up form. The new shop is pending, and the seller lands on their home page.

const signupForm = document.getElementById('signup-form');
const signupMessage = document.getElementById('message');

signupForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(signupMessage);
  const button = signupForm.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const result = await api('POST', '/api/sellers/signup', {
      shop_name: document.getElementById('shop-name').value,
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
      phone: document.getElementById('phone').value,
    });
    location.href = result.redirect;
  } catch (error) {
    showMessage(signupMessage, error.message, 'error');
    button.disabled = false;
  }
});
