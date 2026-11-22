// login.js - sends the email and password, then opens the right home page (admin or seller).

const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('message');

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage(loginMessage);
  const button = loginForm.querySelector('button[type=submit]');
  button.disabled = true;
  try {
    const result = await api('POST', '/api/login', {
      email: document.getElementById('email').value,
      password: document.getElementById('password').value,
    });
    location.href = pageAfterLogin(result.redirect);
  } catch (error) {
    showMessage(loginMessage, error.message, 'error');
    document.getElementById('password').value = '';
    button.disabled = false;
  }
});

// Goes back to the page the person wanted (?next=...), but only if it is inside their own area.
function pageAfterLogin(homePage) {
  const next = new URLSearchParams(location.search).get('next');
  if (next && next.startsWith(homePage)) return next;
  return homePage;
}
