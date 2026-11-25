// netlify/functions/app.js - the live site: every address (pages, /api, photos, styles) is answered by the same
// Express app as on the laptop (app.js), through serverless-http. The database is Supabase (DATABASE_URL, a secret set
// in Netlify's site settings).
// Live means production (the phone code is not shown unless SHOW_TEST_CODES=1) and the login cookie is https-only.
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.COOKIE_SECURE = process.env.COOKIE_SECURE || '1';

const serverless = require('serverless-http');
const app = require('../../app');

const PREFIX = '/.netlify/functions/app';
const handler = serverless(app, { binary: ['image/*', 'font/*', 'application/font-woff2', 'application/octet-stream'] });

// Netlify calls this for each request. The address reaches the app as the visitor typed it (without the function's
// own prefix).
exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false; // answer straight away; the database connections stay open
  if (event.path && event.path.startsWith(PREFIX)) event.path = event.path.slice(PREFIX.length) || '/';
  return handler(event, context);
};
