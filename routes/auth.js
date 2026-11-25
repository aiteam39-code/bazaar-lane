// routes/auth.js - log in, log out, and "who am I".
const express = require('express');
const { db } = require('../db');
const auth = require('../auth');

const router = express.Router();

// Where each role goes after logging in.
const HOME_PAGE = { admin: '/admin/', seller: '/seller/' };

// Log in with email and password. Starts the session cookie.
router.post('/api/login', async (req, res) => {
  const body = req.body || {};
  const user = await auth.checkLogin(body.email, body.password);
  await auth.startSession(res, user.id);
  res.json({ ok: true, role: user.role, redirect: HOME_PAGE[user.role] });
});

// Log out: ends the session and removes the cookie.
router.post('/api/logout', async (req, res) => {
  await auth.endSession(req, res);
  res.json({ ok: true });
});

// Who is logged in. A seller also gets their own shop, its status, and the reason if it was rejected or suspended.
router.get('/api/me', auth.requireLogin, async (req, res) => {
  const me = { email: req.user.email, role: req.user.role, shop: null };
  if (req.user.role === 'seller') {
    me.shop = await db.get(
      'SELECT id, shop_name, slug, status, status_reason FROM sellers WHERE id = ?', req.user.seller_id);
  }
  res.json(me);
});

module.exports = router;
