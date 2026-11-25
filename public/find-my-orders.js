// find-my-orders.js - "Find my orders": the server emails every tracking link for that address (into the outbox).
// The answer is always the same, so nobody can find out which addresses have orders.

document.getElementById('find-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.getElementById('find-message');
  try {
    const answer = await api('POST', '/api/find-my-orders', { email: document.getElementById('email').value });
    showMessage(message, answer.message, 'ok');
  } catch (error) {
    showMessage(message, error.message, 'error');
    if (window.IK && IK.sound) IK.sound.play('error'); // the kit's error cue (silent unless sound is switched on)
  }
});
