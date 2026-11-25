// help/contact.js - the contact form: saved in contact_messages; the admin reads it on the Messages page.

document.getElementById('contact-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const note = document.getElementById('contact-note');
  try {
    const answer = await api('POST', '/api/contact', {
      name: document.getElementById('contact-name').value,
      email: document.getElementById('contact-email').value,
      message: document.getElementById('contact-message').value,
    });
    showMessage(note, answer.message, 'ok');
    event.target.reset();
  } catch (error) {
    showMessage(note, error.message, 'error');
    if (window.IK && IK.sound) IK.sound.play('error'); // the kit's error cue (silent unless sound is switched on)
  }
});
