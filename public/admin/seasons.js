// admin/seasons.js - the admin's Seasons page: each season with its dates, on or off, whether it is showing now, and
// Preview (opens the home page dressed for that season, for the admin's own browser only: ?preview=<key> does nothing
// for customers). Refreshes every 5 seconds, but never while someone is typing.

const seasonsMessage = document.getElementById('message');

async function loadSeasons() {
  try {
    const data = await api('GET', '/api/admin/seasons');
    clearLoadProblem(seasonsMessage);
    if (!dataChanged('seasons', data)) return;
    document.getElementById('clock').textContent = `The store's clock now: ${data.now}`;
    document.getElementById('season-list').replaceChildren(...data.seasons.map(seasonCard));
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(seasonsMessage, error);
  }
}

function seasonCard(season) {
  const card = make('article', 'card');
  const top = make('div', 'card-top');
  const state = !season.has_files ? ['Files missing', 'badge-rejected'] : season.on_now ? ['Showing now', 'badge-active']
    : season.enabled ? ['Waiting for its dates', 'badge-pending'] : ['Switched off', 'badge-rejected'];
  top.append(make('h2', '', season.name), make('span', 'badge ' + state[1], state[0]));
  card.append(top);
  const form = make('form', 'form-grid');
  const starts = field('Starts (YYYY-MM-DD HH:MM)', 'starts-' + season.id, season.starts_at);
  const ends = field('Ends (YYYY-MM-DD HH:MM)', 'ends-' + season.id, season.ends_at);
  const onLabel = make('label', 'choice');
  const on = make('input');
  on.type = 'checkbox';
  on.checked = season.enabled === 1;
  onLabel.append(on, ' Switched on (it shows between its dates)');
  const save = make('button', 'secondary', 'Save');
  save.type = 'submit';
  const preview = make('a', 'button secondary', 'Preview');
  preview.href = '/?preview=' + encodeURIComponent(season.key);
  preview.target = '_blank';
  preview.rel = 'noopener';
  const row = make('div', 'actions');
  row.append(save, preview);
  form.append(starts.wrap, ends.wrap, onLabel, row);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const answer = await api('PUT', `/api/admin/seasons/${season.id}`, { starts_at: starts.input.value, ends_at: ends.input.value, enabled: on.checked });
      showMessage(seasonsMessage, answer.message, 'ok');
      document.querySelectorAll('[data-busy]').forEach((box) => delete box.dataset.busy);
      forgetDrawnData('seasons');
      loadSeasons();
    } catch (error) {
      showMessage(seasonsMessage, error.message, 'error');
    }
  });
  card.append(form, make('p', 'small muted', 'Preview opens the home page in its festival look for you only. Customers see it only between the dates while it is switched on.'));
  return card;
}

function field(labelText, id, value) {
  const wrap = make('div', 'field');
  const label = make('label', '', labelText);
  const input = make('input');
  input.id = id;
  input.value = value;
  input.maxLength = 16;
  input.addEventListener('input', () => { input.dataset.busy = 'yes'; });
  label.htmlFor = id;
  wrap.append(label, input);
  return { wrap, input };
}

refreshEvery5Seconds(loadSeasons);
