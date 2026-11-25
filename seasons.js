// seasons.js - the season system: which festival look (if any) the store wears right now.
// A season is on when it is enabled and "now" is between its starts_at and ends_at (local time). The store changes back
// by itself when the dates pass, without a deploy. Seasons only change the look and add gift options: never a price,
// a stock number or an order rule.
// Everything for one season lives in public/seasons/<key>.css, <key>.js (and <key>.html for its collection page).
// If those files are missing, the season is simply never shown, and the store stays normal.
const fs = require('fs');
const path = require('path');
const { db } = require('./db');

const SEASON_FOLDER = path.join(__dirname, 'public', 'seasons');

// "Now" for seasons and date promises. A TEST copy may move its clock with TEST_CLOCK (an ISO date), but only when
// ALLOW_TEST_CLOCK=1 is set too (check.js does that for its own copy) and never in production, so the owner's real
// store always uses the real date.
function seasonNow() {
  const testClock = process.env.TEST_CLOCK;
  const clockMayMove = process.env.ALLOW_TEST_CLOCK === '1' && process.env.NODE_ENV !== 'production';
  if (testClock && clockMayMove) {
    const moved = new Date(testClock);
    if (!Number.isNaN(moved.getTime())) return moved;
  }
  return new Date();
}

// A date as the seasons table writes it, in local time: "2026-12-01 00:00".
function localStamp(date) {
  const two = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

// True when the season's own files are there (deleting them leaves a normal store).
function hasFiles(key) {
  return /^[a-z]+$/.test(key) && fs.existsSync(path.join(SEASON_FOLDER, key + '.css')) && fs.existsSync(path.join(SEASON_FOLDER, key + '.js'));
}

// The season that is on right now, or null.
async function currentSeason() {
  const now = localStamp(seasonNow());
  const season = await db.get('SELECT * FROM seasons WHERE enabled = 1 AND starts_at <= ? AND ends_at >= ? ORDER BY starts_at LIMIT 1', now, now);
  return season && hasFiles(season.key) ? season : null;
}

// The season a page should wear: the current one, or (only for a logged-in admin) the one asked for with
// ?preview=<key>. A customer's ?preview does nothing.
async function seasonForRequest(req) {
  const wanted = typeof req.query.preview === 'string' ? req.query.preview : '';
  if (wanted && req.user && req.user.role === 'admin') {
    const season = await db.get('SELECT * FROM seasons WHERE key = ?', wanted);
    if (season && hasFiles(season.key)) return { ...season, preview: true };
  }
  return currentSeason();
}

module.exports = { seasonNow, localStamp, currentSeason, seasonForRequest, hasFiles, SEASON_FOLDER };
