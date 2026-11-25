// netlify/functions/expire-payments.js - runs every 5 minutes on Netlify: unpaid online orders older than 30 minutes
// are cancelled and their stock goes back (on a laptop, server.js does this every minute).
const { ready } = require('../../db');
const payments = require('../../payments');

exports.handler = async () => {
  await ready();
  await payments.cancelExpiredPayments();
  return { statusCode: 200, body: 'checked' };
};

exports.config = { schedule: '*/5 * * * *' };
