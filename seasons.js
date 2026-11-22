// seasons.js - the season system: which festival look (if any) the store wears right now.
// A season is on when it is enabled and "now" is between its starts_at and ends_at (local time). The store changes back
// by itself when the dates pass, without a deploy. Seasons only change the look and add gift options: never a price,
// a stock number or an order rule.
// Everything for one season lives in public/seasons/<key>.css, <key>.js (and <key>.html for its collection page).
// If those files are missing, the season is simply never shown, and the store stays normal.
const fs = require('fs');
const path = require('path');
const { db, DB_FILE } = require('./db');

const SEASON_FOLDER = path.join(__dirname, 'public', 'seasons');

// "Now" for seasons and date promises. A TEST copy may move its clock with TEST_CLOCK (an ISO date); the owner's real
// marketplace.db never does, so the real store always uses the real date.
function seasonNow() {
  const testClock = process.env.TEST_CLOCK;
  if (testClock && path.basename(DB_FILE) !== 'marketplace.db') {
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
function currentSeason() {
  const now = localStamp(seasonNow());
  const season = db.prepare('SELECT * FROM seasons WHERE enabled = 1 AND starts_at <= ? AND ends_at >= ? ORDER BY starts_at LIMIT 1').get(now, now);
  return season && hasFiles(season.key) ? season : null;
}

// The season a page should wear: the current one, or (only for a logged-in admin) the one asked for with
// ?preview=<key>. A customer's ?preview does nothing.
function seasonForRequest(req) {
  const wanted = typeof req.query.preview === 'string' ? req.query.preview : '';
  if (wanted && req.user && req.user.role === 'admin') {
    const season = db.prepare('SELECT * FROM seasons WHERE key = ?').get(wanted);
    if (season && hasFiles(season.key)) return { ...season, preview: true };
  }
  return currentSeason();
}

module.exports = { seasonNow, localStamp, currentSeason, seasonForRequest, hasFiles, SEASON_FOLDER };
