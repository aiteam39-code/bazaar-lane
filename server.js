// server.js - starts the Bazaar Lane app.
const path = require('path');
const express = require('express');
const { fillSampleDataIfEmpty, UPLOADS_DIR } = require('./db');
const auth = require('./auth');
const payments = require('./payments');

// Payments are TEST MODE only: a live Razorpay key stops the app before it starts.
if (payments.hasLiveKey()) {
  console.error('A live (or unknown) Razorpay key is set. This app only takes TEST keys (rzp_test_...). Stopping.');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const MARKETPLACE_NAME = process.env.MARKETPLACE_NAME || 'Bazaar Lane';

const app = express();
app.disable('x-powered-by');

// Extra safety on every answer: scripts, styles, fonts and pictures only from this site (React, the kit and the font are
// served by this app, see below), no framing, no leaking links to other sites.
// Only when Razorpay test keys are set, its checkout script and window are allowed too.
const RAZORPAY_ALLOWED = payments.PROVIDER === 'razorpay'
  ? { script: ' https://checkout.razorpay.com', frame: "; frame-src https://api.razorpay.com https://checkout.razorpay.com", connect: ' https://lumberjack.razorpay.com https://api.razorpay.com' }
  : { script: '', frame: '', connect: '' };
const SAFETY_POLICY = `default-src 'self'; script-src 'self'${RAZORPAY_ALLOWED.script}; style-src 'self'; font-src 'self'; `
  + `img-src 'self' data:; connect-src 'self'${RAZORPAY_ALLOWED.connect}; object-src 'none'; base-uri 'none'; `
  + `frame-ancestors 'none'; form-action 'self'${RAZORPAY_ALLOWED.frame}`;
app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy': SAFETY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });
  next();
});

app.use(express.json({ limit: '20kb' }));
app.use(auth.loadUser); // finds who is logged in, for every request

// Staff pages (/admin and /seller): only the right login can open them. The seller sign-up page is open to everyone.
app.use(auth.protectStaffPages);

// Answers from /api can hold private details (a tracking page, a seller's orders), so browsers must not keep copies.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// One file of routes for each area. More areas are added in later sectors.
app.use(require('./routes/auth'));
app.use(require('./routes/sellers'));
app.use(require('./routes/products'));
app.use(require('./routes/storefront'));
app.use(require('./routes/home'));
app.use(require('./routes/checkout'));
app.use(require('./routes/fulfilment'));
app.use(require('./routes/payments'));
app.use(require('./routes/reviews'));
app.use(require('./routes/commissions'));
const trust = require('./routes/trust');
app.use(trust);
app.use(require('./routes/seasons'));
app.use(require('./routes/dashboard'));

// Any other /api address does not exist.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'That address does not exist.' });
});

// Pages, styles and scripts live in the public folder. The browser may keep styles and scripts, but asks each time
// whether they changed (a quick "not changed" answer), so an update shows at once.
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, file) => {
    if (/\.(css|js)$/.test(file)) res.set('Cache-Control', 'no-cache'); // kept, but checked each time, so an update shows at once
  },
}));

// The Interaction Kit's look (kit/), and React 18 and the Instrument Sans font from node_modules. Only these files
// are served, from this app, never from an outside website.
const KIT_FILES = {
  '/kit/tokens.css': 'kit/tokens.css',
  '/kit/components/bundle.css': 'kit/components/bundle.css',
  '/kit/components/bundle.js': 'kit/components/bundle.js',
  '/vendor/react.js': 'node_modules/react/umd/react.production.min.js',
  '/vendor/react-dom.js': 'node_modules/react-dom/umd/react-dom.production.min.js',
};
for (const [address, file] of Object.entries(KIT_FILES)) {
  app.get(address, (req, res) => res.sendFile(path.join(__dirname, file), { maxAge: '7d' })); // fixed versions: kept 7 days
}
// The font: its four weights (400, 500, 600, 700) and their font files.
app.get(/^\/fonts\/instrument-sans\/([4-7]00\.css|files\/instrument-sans-[a-z-]+-[4-7]00-normal\.woff2?)$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules/@fontsource/instrument-sans', req.params[0]), { maxAge: '30d' });
});

// Product photos sellers uploaded (random file names made by the server).
app.use('/uploads', express.static(UPLOADS_DIR, { dotfiles: 'ignore', index: false }));

// Any other page does not exist (also an address with a broken %-code): the friendly "page not found" page, with
// the search box and a link home.
app.use(trust.sendNotFound);

// Every error ends up here and goes back as a plain message: { error: '...' }.
app.use((err, req, res, next) => {
  if (err instanceof auth.HttpError) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'The data sent was not valid.' });
  if (err.type === 'entity.too.large' && req.path.endsWith('/photo')) {
    return res.status(413).json({ error: 'The photo must be 2 MB or smaller.' });
  }
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'The data sent was too big.' });
  // Other mistakes in the request itself (for example a broken %-code in the address) are the sender's, not the server's.
  // A person opening a page gets a plain sentence; the pages' own requests to /api get { error }.
  if (Number.isInteger(err.status) && err.status >= 400 && err.status < 500) {
    if (!req.path.startsWith('/api/')) {
      return res.status(err.status).type('text').send('That address is not valid. Go to the home page: /');
    }
    return res.status(err.status).json({ error: 'The address or the data sent was not valid.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

if (fillSampleDataIfEmpty()) console.log('New database: sample data added. Demo logins are in DEMO_LOGINS.md.');

// Every minute: unpaid online orders older than 30 minutes are cancelled and their stock goes back.
setInterval(() => {
  try {
    payments.cancelExpiredPayments();
  } catch (err) {
    console.error('The 30-minute payment check failed:', err.message);
  }
}, 60 * 1000).unref();

// Listens only on this laptop (127.0.0.1), so nobody else on the Wi-Fi can reach the login pages.
app.listen(PORT, '127.0.0.1', () => {
  console.log(`${MARKETPLACE_NAME} is running at http://localhost:${PORT}`);
});
