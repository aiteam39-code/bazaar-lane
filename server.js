// server.js - starts Bazaar Lane on this laptop: npm run dev (or npm start). Live, Netlify runs app.js instead.
const app = require('./app');
const { ready, DB_LABEL } = require('./db');
const payments = require('./payments');

const PORT = Number(process.env.PORT) || 3000;
const MARKETPLACE_NAME = process.env.MARKETPLACE_NAME || 'Bazaar Lane';

// Every minute: unpaid online orders older than 30 minutes are cancelled and their stock goes back.
// (Live, a Netlify scheduled function does the same: netlify/functions/expire-payments.js.)
function checkPaymentsEveryMinute() {
  setInterval(async () => {
    try {
      await payments.cancelExpiredPayments();
    } catch (err) {
      console.error('The 30-minute payment check failed:', err.message);
    }
  }, 60 * 1000).unref();
}

// Gets the database ready, then listens only on this laptop (127.0.0.1), so nobody else on the Wi-Fi can reach it.
async function start() {
  const isNew = await ready();
  if (isNew) console.log('New database: sample data added. Demo logins are in DEMO_ACCOUNTS in db.js.');
  console.log(`Using ${DB_LABEL}.`);
  checkPaymentsEveryMinute();
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`${MARKETPLACE_NAME} is running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error('Bazaar Lane could not start:', err.message);
  process.exit(1);
});
