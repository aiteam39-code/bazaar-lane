// admin/outbox.js - the admin reads the outbox: every email, newest first. Open one to read it.
// Refreshes every 5 seconds (only redraws when something new arrived).

// Loads the outbox and draws the list of emails.
async function loadEmails() {
  try {
    const data = await api('GET', '/api/admin/emails');
    clearLoadProblem(document.getElementById('message'));
    if (!dataChanged('emails', data)) return;
    document.getElementById('email-count').textContent = `${data.total} email${data.total === 1 ? '' : 's'}`;
    document.getElementById('email-list').replaceChildren(...data.emails.map(emailRow));
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(document.getElementById('message'), error);
  }
}

// One email in the list: the subject, who it went to and when. A click opens it.
function emailRow(email) {
  const item = make('li');
  const button = make('button', 'email-row');
  button.type = 'button';
  button.append(make('strong', '', email.subject), make('span', 'muted small', `To ${email.to_address} · ${formatDateTime(email.created_at)}`));
  button.addEventListener('click', () => openEmail(email.id));
  item.append(button);
  return item;
}

// Shows one email's full text.
async function openEmail(id) {
  try {
    const { email } = await api('GET', '/api/admin/emails/' + id);
    document.getElementById('email-subject').textContent = email.subject;
    document.getElementById('email-meta').textContent = `To ${email.to_address} · ${formatDateTime(email.created_at)}`;
    document.getElementById('email-body').textContent = email.body;
    const box = document.getElementById('email-open');
    box.classList.remove('hidden');
    box.scrollIntoView({ block: 'nearest' });
  } catch (error) {
    showMessage(document.getElementById('message'), error.message, 'error');
  }
}

refreshEvery5Seconds(loadEmails);
