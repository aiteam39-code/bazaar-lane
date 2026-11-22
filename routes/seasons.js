// routes/seasons.js - the season system's routes: which season is on (GET /api/season), a season's collection page
// (like /christmas, only while that season is on or for the admin's preview), and the admin's Seasons page
// (switch a season on or off, change its dates). Customers can never switch or preview a season.
const fs = require('fs');
const path = require('path');
const express = require('express');
const { db } = require('../db');
const auth = require('../auth');
const { sendPage, pageTitle } = require('../pages');
const { seasonForRequest, currentSeason, hasFiles, localStamp, seasonNow, SEASON_FOLDER } = require('../seasons');

const router = express.Router();
const { HttpError } = auth;
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/; // "2026-12-01 00:00", local time

// Which season is on for this visitor (only an admin's ?preview=<key> can show one early).
router.get('/api/season', (req, res) => {
  const season = seasonForRequest(req);
  res.json(season ? { season: season.key, name: season.name, ends_at: season.ends_at, preview: Boolean(season.preview) } : { season: null });
});

// A season's collection page, like /christmas: only while that season is on (or in the admin's preview), and only if
// its page file is there. Otherwise it is simply not found.
router.get(/^\/([a-z]+)$/, (req, res, next) => {
  const key = req.params[0];
  const row = db.prepare('SELECT * FROM seasons WHERE key = ?').get(key);
  if (!row) return next();
  const season = seasonForRequest(req);
  if (!season || season.key !== key || !fs.existsSync(path.join(SEASON_FOLDER, key + '.html'))) return next();
  sendPage(res, `seasons/${key}.html`, {
    title: pageTitle(`${row.name} gifts`),
    description: `${row.name} gifts from independent makers: hand-made, from small shops.`,
  });
});

// Admin: every season, with whether it is on right now and whether its files are there.
router.get('/api/admin/seasons', auth.requireRole('admin'), (req, res) => {
  const on = currentSeason();
  const seasons = db.prepare('SELECT * FROM seasons ORDER BY starts_at').all()
    .map((season) => ({ ...season, on_now: Boolean(on && on.key === season.key), has_files: hasFiles(season.key) }));
  res.json({ seasons, now: localStamp(seasonNow()) });
});

// Admin: switch a season on or off and change its dates ("YYYY-MM-DD HH:MM", local time; the end after the start).
router.put('/api/admin/seasons/:id', auth.requireRole('admin'), (req, res) => {
  const season = db.prepare('SELECT * FROM seasons WHERE id = ?').get(auth.readId(req.params.id));
  if (!season) throw new HttpError(404, 'That season does not exist.');
  const body = req.body || {};
  const startsAt = body.starts_at === undefined ? season.starts_at : String(body.starts_at).trim();
  const endsAt = body.ends_at === undefined ? season.ends_at : String(body.ends_at).trim();
  if (!STAMP.test(startsAt) || !STAMP.test(endsAt) || Number.isNaN(Date.parse(startsAt.replace(' ', 'T'))) || Number.isNaN(Date.parse(endsAt.replace(' ', 'T')))) {
    throw new HttpError(400, 'Dates must look like 2026-12-01 00:00.');
  }
  if (endsAt <= startsAt) throw new HttpError(400, 'The end must be after the start.');
  const enabled = body.enabled === undefined ? season.enabled : body.enabled === true ? 1 : 0;
  db.prepare('UPDATE seasons SET starts_at = ?, ends_at = ?, enabled = ? WHERE id = ?').run(startsAt, endsAt, enabled, season.id);
  res.json({ ok: true, message: `${season.name}: ${enabled ? 'on' : 'off'}, ${startsAt} to ${endsAt}.` });
});

module.exports = router;
