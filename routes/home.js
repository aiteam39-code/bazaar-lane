// routes/home.js - what the home page needs: the real delivery range (from the open shops' dispatch days), the words
// the search box rotates through (from real product names), the category tiles, the category rows (loaded a few at a
// time as the customer scrolls), and the promo cards (the admin switches each on or off and changes its words, photo
// and link on the Promo cards page). Only products that can be bought are ever shown.
const express = require('express');
const { db, photoUrl } = require('../db');
const auth = require('../auth');
const { slugify } = require('../pages');
const { productAddress } = require('./storefront');
const { readPhotoBody, savePhoto, removeOldPhoto } = require('../photos');

const router = express.Router();
const { HttpError } = auth;
const PRODUCTS_PER_ROW = 12;
const MOST_ROWS_AT_ONCE = 12;
const TONES = ['accent', 'sunk']; // soft colours only: success and danger mean something, so they never decorate
const OLD_TONES = { success: 'sunk', danger: 'accent' }; // cards saved with an old colour show as one of these
const PLAIN_WORDS = new Set(['set', 'pack', 'box', 'pair', 'kit', 'mix', 'small', 'large', 'big', 'new']); // not useful as search examples

// "Can be bought": on sale, not deleted, not hidden, in stock, from an open shop.
const BUYABLE = `products.active = 1 AND products.deleted = 0 AND products.hidden = 0 AND products.stock > 0 AND sellers.status = 'active'`;

// The home page's first answer: the delivery range, the search words, the category tiles and the promo cards.
router.get('/api/home', async (req, res) => {
  res.json({
    delivery: await deliveryRange(),
    search_words: await searchWords(),
    categories: await categoryTiles(),
    promo_cards: await promoCards(true),
  });
});

// What every page's header needs: the real delivery range and the words the search box rotates through.
router.get('/api/header', async (req, res) => {
  res.json({ delivery: await deliveryRange(), search_words: await searchWords() });
});

// The category rows: offset and limit (1 to 12). Each row is a category that has products that can be bought, with
// its newest 12. "done" says there are no more rows.
router.get('/api/home/rows', async (req, res) => {
  const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 6, 1), MOST_ROWS_AT_ONCE);
  const tiles = await categoryTiles();
  const rows = [];
  for (const tile of tiles.slice(offset, offset + limit)) {
    const products = await db.all(`
      SELECT products.id, products.name, products.photo, products.price, products.size_label, products.giftable,
             CASE WHEN products.stock BETWEEN 1 AND 5 THEN products.stock END AS few_left,
             sellers.shop_name, sellers.slug AS shop_slug, sellers.city, sellers.dispatch_days
      FROM products JOIN sellers ON sellers.id = products.seller_id
      WHERE products.category_id = ? AND ${BUYABLE}
      ORDER BY products.created_at DESC, products.id DESC LIMIT ?`, tile.id, PRODUCTS_PER_ROW);
    rows.push({ category: { id: tile.id, name: tile.name, slug: tile.slug }, products: products.map(rowProduct) });
  }
  res.json({ rows, next_offset: offset + rows.length, done: offset + rows.length >= tiles.length });
});

// The real delivery range: the fastest open shop's dispatch days + 2 to the slowest one's + 5 (only shops with
// products that can be bought). Null when no shop sells anything.
async function deliveryRange() {
  const range = await db.get(`
    SELECT MIN(sellers.dispatch_days) AS fastest, MAX(sellers.dispatch_days) AS slowest
    FROM sellers WHERE sellers.status = 'active' AND EXISTS (
      SELECT 1 FROM products WHERE products.seller_id = sellers.id AND products.active = 1 AND products.deleted = 0
        AND products.hidden = 0 AND products.stock > 0)`);
  return range.fastest ? { from_days: range.fastest + 2, to_days: range.slowest + 5 } : null;
}

// Every category that has products that can be bought, with its photo (its own, else a product's) for the tile.
async function categoryTiles() {
  const categories = await db.all(`
    SELECT categories.id, categories.name, categories.photo,
      (SELECT COUNT(*) FROM products JOIN sellers ON sellers.id = products.seller_id WHERE products.category_id = categories.id AND ${BUYABLE}) AS product_count,
      (SELECT products.id FROM products JOIN sellers ON sellers.id = products.seller_id WHERE products.category_id = categories.id AND ${BUYABLE}
       ORDER BY products.photo IS NULL, products.created_at DESC LIMIT 1) AS cover_product_id,
      (SELECT products.photo FROM products JOIN sellers ON sellers.id = products.seller_id WHERE products.category_id = categories.id AND ${BUYABLE}
       ORDER BY products.photo IS NULL, products.created_at DESC LIMIT 1) AS cover_photo
    FROM categories ORDER BY categories.name COLLATE NOCASE`);
  return categories
    .filter((category) => category.product_count > 0)
    .map((category) => ({
      id: category.id, name: category.name, slug: slugify(category.name), product_count: category.product_count,
      cover_product_id: category.cover_product_id, photo_url: photoUrl(category.photo || category.cover_photo),
    }));
}

// One product for a category row: its photo, size, maker, price and the TRUE delivery chip for its shop.
function rowProduct(row) {
  const { photo, dispatch_days: dispatchDays, ...product } = row;
  return {
    ...product,
    photo_url: photoUrl(photo),
    url: productAddress(row),
    delivery: { from_days: dispatchDays + 2, to_days: dispatchDays + 5 },
  };
}

// Short real words from the names of products that can be bought ("pickle", "planter", "stole"), for the search box.
async function searchWords() {
  const names = await db.all(`SELECT products.name FROM products JOIN sellers ON sellers.id = products.seller_id WHERE ${BUYABLE} ORDER BY products.id`);
  const words = new Set();
  for (const { name } of names) {
    const last = name.replace(/\(.*?\)/g, '').trim().split(/\s+/).pop().toLowerCase();
    if (/^[a-z]{3,12}$/.test(last) && !PLAIN_WORDS.has(last)) words.add(last);
  }
  return [...words].slice(0, 16);
}

// The promo cards in order (only the switched-on ones for customers).
async function promoCards(onlyEnabled) {
  const cards = await db.all(`SELECT * FROM promo_cards ${onlyEnabled ? 'WHERE enabled = 1' : ''} ORDER BY position, id`);
  return cards.map(({ photo, ...card }) => ({ ...card, tone: allowedTone(card.tone), photo_url: photoUrl(photo) }));
}

// A card's colour as one of TONES (an old success or danger colour becomes a soft one).
function allowedTone(tone) {
  return TONES.includes(tone) ? tone : OLD_TONES[tone] || 'sunk';
}

// ---------- Admin: promo cards and category photos ----------

// Admin: every promo card, on or off.
router.get('/api/admin/promo-cards', auth.requireRole('admin'), async (req, res) => {
  res.json({ cards: await promoCards(false), tones: TONES });
});

// Admin: change a promo card's words, link, colour, place, or switch it on or off.
router.put('/api/admin/promo-cards/:id', auth.requireRole('admin'), async (req, res) => {
  const card = await db.get('SELECT * FROM promo_cards WHERE id = ?', auth.readId(req.params.id));
  if (!card) throw new HttpError(404, 'That promo card does not exist.');
  const body = req.body || {};
  const title = body.title === undefined ? card.title : auth.cleanText(body.title).replace(/\s+/g, ' ');
  const line = body.line === undefined ? card.line : auth.cleanText(body.line).replace(/\s+/g, ' ');
  const link = body.link === undefined ? card.link : String(body.link).trim();
  const tone = body.tone === undefined ? allowedTone(card.tone) : String(body.tone);
  const enabled = body.enabled === undefined ? card.enabled : body.enabled === true ? 1 : 0;
  if (title.length < 3 || title.length > 50) throw new HttpError(400, 'A title must be 3 to 50 characters.');
  if (line.length > 80) throw new HttpError(400, 'The short line must be 80 characters or fewer.');
  if (!TONES.includes(tone)) throw new HttpError(400, 'Please choose one of the colours.');
  await checkLink(link);
  await db.run('UPDATE promo_cards SET title = ?, line = ?, link = ?, tone = ?, enabled = ? WHERE id = ?', title, line, link, tone, enabled, card.id);
  res.json({ ok: true, message: `${title}: ${enabled ? 'shown' : 'hidden'} on the home page.` });
});

// Admin: a promo card's photo (the same rules as a seller's product photo).
router.post('/api/admin/promo-cards/:id/photo', auth.requireRole('admin'), readPhotoBody, async (req, res) => {
  const card = await db.get('SELECT * FROM promo_cards WHERE id = ?', auth.readId(req.params.id));
  if (!card) throw new HttpError(404, 'That promo card does not exist.');
  const fileName = await savePhoto(req.body);
  await db.run('UPDATE promo_cards SET photo = ? WHERE id = ?', fileName, card.id);
  await removeOldPhoto(card.photo);
  res.json({ ok: true, photo_url: photoUrl(fileName), message: 'The photo was saved.' });
});

// Admin: a category tile's photo (the same rules).
router.post('/api/admin/categories/:id/photo', auth.requireRole('admin'), readPhotoBody, async (req, res) => {
  const category = await db.get('SELECT * FROM categories WHERE id = ?', auth.readId(req.params.id));
  if (!category) throw new HttpError(404, 'That category does not exist.');
  const fileName = await savePhoto(req.body);
  await db.run('UPDATE categories SET photo = ? WHERE id = ?', fileName, category.id);
  await removeOldPhoto(category.photo);
  res.json({ ok: true, photo_url: photoUrl(fileName), message: `The photo of ${category.name} was saved.` });
});

// A promo card links only to a real page of this store: a category that exists, a shop, search, a season's collection,
// Sell with us or a help page. Never to another website.
async function checkLink(link) {
  const bad = () => new HttpError(400, 'The link must be a page of this store, like /category/pet-care or /search?giftable=1.');
  if (!/^\/[a-z0-9\-/?=&.%]*$/i.test(link) || link.startsWith('//') || link.length > 120) throw bad();
  const category = /^\/category\/([a-z0-9-]+)$/.exec(link);
  if (category) {
    const exists = (await db.all('SELECT name FROM categories')).some((row) => slugify(row.name) === category[1]);
    if (!exists) throw new HttpError(400, 'That category does not exist.');
    return;
  }
  if (/^\/(search(\?.*)?|store\/[a-z0-9-]+|christmas|sell|about|how-it-works|faq|shipping)$/.test(link)) return;
  throw bad();
}

module.exports = router;
