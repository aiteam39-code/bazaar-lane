// pages.js - sends a page from the public folder with its own title and meta description written in by the server,
// so search engines (and link previews) can read them before any script runs.
const fs = require('fs');
const path = require('path');

const PUBLIC_FOLDER = path.join(__dirname, 'public');
const MARKETPLACE_NAME = process.env.MARKETPLACE_NAME || 'Bazaar Lane';

// Text made safe to put inside HTML (names come from sellers, so they are never trusted).
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

// Turns a name into the end of a clean address: "Green Chilli Pickle" -> "green-chilli-pickle".
function slugify(text) {
  return String(text).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
}

// "Green Chilli Pickle by Chilli Lane Pantry" -> "Green Chilli Pickle by Chilli Lane Pantry | Bazaar Lane".
function pageTitle(text) {
  return text ? `${text} | ${MARKETPLACE_NAME}` : MARKETPLACE_NAME;
}

// A description of at most 160 characters, on one line.
function shortDescription(text) {
  const oneLine = String(text || '').replace(/\s+/g, ' ').trim();
  return oneLine.length > 160 ? oneLine.slice(0, 157).trimEnd() + '...' : oneLine;
}

// Sends public/<file> with this title and description (status 200, or another, like 404).
// fill: { name: text } puts each text (escaped) where the page has {{name}}.
function sendPage(res, file, { title, description, status = 200, fill = {} }) {
  let html = fs.readFileSync(path.join(PUBLIC_FOLDER, file), 'utf8');
  for (const [name, text] of Object.entries(fill)) html = html.split(`{{${name}}}`).join(escapeHtml(text));
  html = html.replace(/<meta name="description"[^>]*>\s*/i, '');
  html = html.replace(/<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(title)}</title>\n  <meta name="description" content="${escapeHtml(shortDescription(description))}">`);
  res.status(status).type('html').send(html);
}

module.exports = { sendPage, slugify, pageTitle, escapeHtml, shortDescription, MARKETPLACE_NAME };
