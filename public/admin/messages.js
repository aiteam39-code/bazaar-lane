// admin/messages.js - the contact form's messages (not handled first), each with Mark handled. Refreshes every 5 seconds.

const messagesNote = document.getElementById('message');

// Loads the contact messages and draws them.
async function loadMessages() {
  try {
    const data = await api('GET', '/api/admin/messages');
    clearLoadProblem(messagesNote);
    setNavBadge('/admin/messages.html', data.open_count, 'messages to answer');
    if (!dataChanged('messages', data)) return;
    document.getElementById('message-list').replaceChildren(...data.messages.map(messageCard));
    document.getElementById('no-messages').classList.toggle('hidden', data.messages.length > 0);
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(messagesNote, error);
  }
}

// One message: name, email, time, the words, and Mark handled while it is still open.
function messageCard(item) {
  const card = make('article', 'card');
  const top = make('div', 'card-top');
  top.append(make('h2', '', item.name), make('span', item.handled ? 'badge badge-active' : 'badge badge-pending', item.handled ? 'Handled' : 'To answer'));
  card.append(top, make('p', 'small muted', `${item.email} · ${formatDateTime(item.created_at)}`), make('p', 'description', item.message));
  if (!item.handled) {
    const done = make('button', 'secondary', 'Mark handled');
    done.type = 'button';
    done.addEventListener('click', async () => {
      try {
        await api('POST', `/api/admin/messages/${item.id}/handled`);
        forgetDrawnData('messages');
        loadMessages();
      } catch (error) {
        showMessage(messagesNote, error.message, 'error');
      }
    });
    card.append(done);
  }
  return card;
}

refreshEvery5Seconds(loadMessages);
