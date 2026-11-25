// routes/trust.js - the help and policy pages, the contact form, the newsletter, the sitemap, robots.txt and the
// friendly "page not found" page (sector 9). Each page gets its own title and description from the server.
const crypto = require('crypto');
const express = require('express');
const { db, nowIso } = require('../db');
const auth = require('../auth');
const mail = require('../mail');
const { sendPage, pageTitle, slugify, MARKETPLACE_NAME } = require('../pages');
const { productAddress } = require('./storefront');

const router = express.Router();
const { HttpError } = auth;
const SITE_URL = process.env.SITE_URL || `http://localhost:${Number(process.env.PORT) || 3000}`;

// The help and policy pages: address, file, title and description.
const HELP_PAGES = [
  ['/about', 'about.html', 'About', `Who we are, how ${MARKETPLACE_NAME} earns, and how shops are checked.`],
  ['/how-it-works', 'how-it-works.html', 'How it works', 'How buying from many shops at once works, and how selling works.'],
  ['/faq', 'faq.html', 'Questions and answers', 'Shipping, returns, payments, how shops are checked, and reviews.'],
  ['/contact', 'contact.html', 'Contact us', 'Write to us. We reply within 2 working days.'],
  ['/terms', 'terms.html', 'Terms of use', `The terms for buying and selling on ${MARKETPLACE_NAME}.`],
  ['/privacy', 'privacy.html', 'Privacy', 'What we keep about you, why, for how long, and how to ask us to delete it.'],
  ['/refunds', 'refunds.html', 'Refunds and returns', 'Who handles returns, when online payments are refunded, and how to get help.'],
  ['/shipping', 'shipping.html', 'Shipping', "Each shop's shipping fee, free-shipping limit and dispatch days."],
  ['/seller-guidelines', 'seller-guidelines.html', 'Seller guidelines', 'What may be sold, honest listings, shipping on time, reviews and reports.'],
];

// Each help page at its clean address.
for (const [address, file, title, description] of HELP_PAGES) {
  router.get(address, async (req, res) => { await sendPage(res, 'help/' + file, { title: pageTitle(title), description }); });
}

// The contact form: a name (2-60), a valid email and a message (1-2000). The admin reads it on the Messages page.
router.post('/api/contact', async (req, res) => {
  const body = req.body || {};
  const name = auth.cleanText(body.name).replace(/\s+/g, ' ');
  const email = auth.cleanEmail(body.email);
  const message = auth.cleanText(body.message);
  if (name.length < 2 || name.length > 60) throw new HttpError(400, 'Please enter your name (2 to 60 characters).');
  if (!auth.isValidEmail(email)) throw new HttpError(400, 'Please enter a valid email, like name@example.com.');
  if (!message) throw new HttpError(400, 'Please write your message.');
  if (message.length > 2000) throw new HttpError(400, 'Please keep your message to 2000 characters or fewer.');
  await db.run('INSERT INTO contact_messages (name, email, message, handled, created_at) VALUES (?, ?, ?, 0, ?)', name, email, message, nowIso());
  res.status(201).json({ ok: true, message: 'Thank you. We reply within 2 working days.' });
});

// Admin: the contact messages, newest first, and how many are not handled yet.
router.get('/api/admin/messages', auth.requireRole('admin'), async (req, res) => {
  const messages = await db.all('SELECT * FROM contact_messages ORDER BY handled, id DESC LIMIT 200');
  res.json({ messages, open_count: messages.filter((m) => !m.handled).length });
});

// Admin: mark a message handled.
router.post('/api/admin/messages/:id/handled', auth.requireRole('admin'), async (req, res) => {
  const done = await db.run('UPDATE contact_messages SET handled = 1 WHERE id = ?', auth.readId(req.params.id));
  if (done.changes !== 1) throw new HttpError(404, 'That message does not exist.');
  res.json({ ok: true, message: 'Marked handled.' });
});

// The newsletter: an email and a ticked consent box. The answer is the same whether or not it was already signed up.
router.post('/api/newsletter', async (req, res) => {
  const body = req.body || {};
  const email = auth.cleanEmail(body.email);
  if (!auth.isValidEmail(email)) throw new HttpError(400, 'Please enter a valid email, like name@example.com.');
  if (body.consent !== true) throw new HttpError(400, 'Please tick the box to say we may email you.');
  const token = crypto.randomBytes(24).toString('hex');
  const added = await db.run('INSERT OR IGNORE INTO newsletter (email, consent_at, unsubscribe_token) VALUES (?, ?, ?)', email, nowIso(), token);
  if (added.changes === 1) {
    await mail.sendEmail(email, `You are on the ${MARKETPLACE_NAME} newsletter`, [
      'Thank you for signing up. We write about once a month, about new shops and new products.',
      `To stop at any time, open: ${SITE_URL}/unsubscribe/${token}`,
    ]);
  }
  res.json({ ok: true, message: 'Thank you. You are on the list. Every email has a link to stop.' });
});

// /unsubscribe/<token>: removes that email from the newsletter and says so.
router.get('/unsubscribe/:token', async (req, res) => {
  const token = String(req.params.token);
  const removed = /^[a-f0-9]{48}$/.test(token) ? (await db.run('DELETE FROM newsletter WHERE unsubscribe_token = ?', token)).changes : 0;
  await sendPage(res, 'help/unsubscribe.html', {
    title: pageTitle('Newsletter'),
    description: 'Stop the newsletter.',
    fill: {
      result: removed ? 'You are off the newsletter. We will not email you again.' : 'This link is not on our list, so there is nothing to stop.',
      icon: removed ? 'checkCircle' : 'alert', // a tick only when something was really stopped
    },
  });
});

// /sitemap.xml: the home page, search, Sell with us, the help pages, the open shops, the categories and every product
// that can be bought.
router.get('/sitemap.xml', async (req, res) => {
  const addresses = ['/', '/search', '/sell', ...HELP_PAGES.map(([address]) => address)];
  for (const shop of await db.all("SELECT slug FROM sellers WHERE status = 'active' ORDER BY id")) addresses.push('/store/' + shop.slug);
  for (const category of await db.all('SELECT name FROM categories ORDER BY id')) addresses.push('/category/' + slugify(category.name));
  const products = await db.all(`
    SELECT products.id, products.name FROM products JOIN sellers ON sellers.id = products.seller_id
    WHERE products.active = 1 AND products.deleted = 0 AND products.hidden = 0 AND products.stock > 0 AND sellers.status = 'active'
    ORDER BY products.id`);
  for (const product of products) addresses.push(productAddress(product));
  const xmlSafe = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const urls = addresses.map((address) => `  <url><loc>${xmlSafe(SITE_URL + address)}</loc></url>`).join('\n');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
});

// /robots.txt: everything may be read except the staff pages, the private tracking links and the payment pages.
router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(['User-agent: *', 'Disallow: /admin', 'Disallow: /seller', 'Disallow: /track', 'Disallow: /pay',
    'Disallow: /api', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n'));
});

// The friendly "page not found" page (status 404), with the search box and a link home. server.js uses it last.
async function sendNotFound(req, res) {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'That address does not exist.' });
  await sendPage(res, 'help/not-found.html', { status: 404, title: pageTitle('Page not found'), description: 'This page does not exist.' });
}

module.exports = router;
module.exports.sendNotFound = sendNotFound;
module.exports.HELP_PAGES = HELP_PAGES;
