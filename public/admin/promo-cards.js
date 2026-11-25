// admin/promo-cards.js - the home page's promo cards: each with a preview, Shown on the home page (on or off), its
// title, short line, colour and link, Save, and Change photo. Then the category tiles' photos. It does not refresh by
// itself while someone is changing a card: it only loads again after a save.

const promoNote = document.getElementById('message');
// The colour names the admin picks from; they match the kit tokens each tone uses (success is teal, danger is red).
const TONE_WORDS = { accent: 'Marigold', success: 'Teal', sunk: 'Grey', danger: 'Soft red' };

// Loads the promo cards and the category tiles and draws an editor for each.
async function loadPromoCards() {
  try {
    const [cards, home] = await Promise.all([api('GET', '/api/admin/promo-cards'), api('GET', '/api/home')]);
    document.getElementById('card-list').replaceChildren(...cards.cards.map((card) => promoEditor(card, cards.tones)));
    document.getElementById('tile-list').replaceChildren(...home.categories.map(tileEditor));
  } catch (error) {
    if (!goToLoginIfNeeded(error)) showLoadProblem(promoNote, error);
  }
}

// A preview of the card as customers see it.
function promoPreview(card) {
  const preview = make('div', 'promo-card tone-' + card.tone);
  const words = make('div', 'promo-words');
  words.append(make('strong', 'promo-title', card.title), make('span', 'promo-line', card.line), make('span', 'promo-pill', 'Order now'));
  const image = make('img', 'promo-photo');
  image.src = card.photo_url || placeholderArt(card.id * 7);
  image.alt = '';
  preview.append(words, image);
  return preview;
}

// One promo card editor: preview, shown on or off, title, line, colour, link, Save and Change photo.
function promoEditor(card, tones) {
  const box = make('article', 'card promo-admin-card');
  const top = make('div', 'card-top');
  top.append(make('h2', '', card.title), make('span', card.enabled ? 'badge badge-active' : 'badge badge-pending', card.enabled ? 'Shown' : 'Switched off'));
  const form = make('form', 'promo-admin-fields');
  const shown = make('input');
  shown.type = 'checkbox';
  shown.checked = card.enabled === 1;
  shown.id = 'shown-' + card.id;
  const shownLabel = make('label', 'choice');
  shownLabel.append(shown, document.createTextNode(' Shown on the home page'));
  const title = field(form, 'Title', 'title-' + card.id, card.title, 50);
  const line = field(form, 'Short line', 'line-' + card.id, card.line, 80);
  const link = field(form, 'Link (a page of this store)', 'link-' + card.id, card.link, 120);
  const toneField = make('div', 'field');
  const toneLabel = make('label', '', 'Colour');
  const tone = make('select');
  tone.id = toneLabel.htmlFor = 'tone-' + card.id;
  for (const value of tones) {
    const option = make('option', '', TONE_WORDS[value] || value);
    option.value = value;
    option.selected = value === card.tone;
    tone.append(option);
  }
  toneField.append(toneLabel, tone);
  form.append(toneField);
  const shownField = make('div', 'field');
  shownField.append(shownLabel);
  form.append(shownField);
  const note = make('div', 'message');
  note.setAttribute('role', 'status');
  const save = make('button', '', 'Save card');
  save.type = 'submit';
  const actions = make('div', 'actions');
  actions.append(save, photoPicker(`/api/admin/promo-cards/${card.id}/photo`, note));
  form.append(actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const answer = await api('PUT', `/api/admin/promo-cards/${card.id}`, {
        title: title.value, line: line.value, link: link.value, tone: tone.value, enabled: shown.checked,
      });
      showMessage(promoNote, answer.message, 'ok');
      loadPromoCards();
    } catch (error) {
      showMessage(note, error.message, 'error');
    }
  });
  box.append(top, promoPreview(card), form, note);
  return box;
}

// Adds one labelled text box to a form and returns the box.
function field(form, labelText, id, value, maxLength) {
  const box = make('div', 'field');
  const label = make('label', '', labelText);
  const input = make('input');
  input.id = label.htmlFor = id;
  input.value = value || '';
  input.maxLength = maxLength;
  box.append(label, input);
  form.append(box);
  return input;
}

// "Change photo": a JPEG, PNG or WebP of at most 2 MB; the server checks it again by its first bytes.
function photoPicker(address, note) {
  const label = make('label', 'button secondary photo-button', 'Change photo');
  const input = make('input', 'visually-hidden');
  input.type = 'file';
  input.accept = 'image/jpeg,image/png,image/webp';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return showMessage(note, 'The photo must be 2 MB or smaller.', 'error');
    try {
      const response = await fetch(address, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: file,
      });
      const answer = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(answer.error || 'The photo could not be saved. Please try again.');
      showMessage(promoNote, answer.message, 'ok');
      loadPromoCards();
    } catch (error) {
      showMessage(note, error.message, 'error');
    }
  });
  label.append(input);
  return label;
}

// One category tile: its photo and Change photo.
function tileEditor(tile) {
  const item = make('li');
  const frame = make('span', 'tile-photo');
  const image = make('img');
  image.src = tile.photo_url || placeholderArt(tile.cover_product_id || tile.id);
  image.alt = tile.name;
  frame.append(image);
  const note = make('div', 'message');
  note.setAttribute('role', 'status');
  item.append(frame, make('strong', '', tile.name), photoPicker(`/api/admin/categories/${tile.id}/photo`, note), note);
  return item;
}

loadPromoCards();
