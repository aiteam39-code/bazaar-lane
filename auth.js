// auth.js - logins, sessions and "who may do what". Every route uses the helpers in this file.
const crypto = require('crypto');
const path = require('path');
const { db, nowIso, searchForm } = require('./db');

const COOKIE_NAME = 'bl_session';
const SESSION_HOURS = 8;
const MAX_WRONG_PASSWORDS = 5;
const LOCK_MINUTES = 5;
const WRONG_LOGIN = 'Wrong email or password.';

// An error with an HTTP status code and a plain message for the person. server.js sends it back as { error }.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// ---------- Passwords ----------

// Turns a password into "scrypt:salt:hash". A new random salt every time, so two equal passwords never look alike.
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

// True when the password matches the saved hash. Compares in constant time.
function passwordMatches(password, savedHash) {
  const [kind, salt, hash] = String(savedHash).split(':');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(password, salt, expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

// Used when an email does not exist, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = hashPassword('not-a-real-password');

// ---------- Checking what people type (checkout uses these later too) ----------

// Trimmed text. Anything that is not text becomes ''.
function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Email in lower case, trimmed.
function cleanEmail(value) {
  return cleanText(value).toLowerCase();
}

// A simple email check: something@something.something, no spaces, at most 100 characters.
function isValidEmail(email) {
  return email.length <= 100 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Phone with spaces and dashes removed.
function cleanPhone(value) {
  return cleanText(value).replace(/[\s-]/g, '');
}

// Exactly 10 digits.
function isValidPhone(phone) {
  return /^\d{10}$/.test(phone);
}

// A whole number typed by a person, as a number (12) or text ("12"). Anything else (1.5, -1, "abc", "", [12]) is refused.
function readWholeNumber(value, label, min, max) {
  let number = NaN;
  if (typeof value === 'number') number = value;
  if (typeof value === 'string' && /^\s*\d{1,9}\s*$/.test(value)) number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${label} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

// An id from a web address or a form: digits only, like "12". Returns the number, or null ("1e1", "0x1", "-1", "abc").
function readId(text) {
  return typeof text === 'string' && /^[1-9]\d{0,14}$/.test(text) ? Number(text) : null;
}

// Search text: trimmed, without control characters, at most 60 characters (an emoji is never cut in half).
function cleanSearch(value) {
  const text = cleanText(value).replace(/[\u0000-\u001f\u007f]/g, '');
  return Array.from(text).slice(0, 60).join('');
}

// Turns search text into a pattern for SQL "search_text(column) LIKE ? ESCAPE '\'": small letters in every alphabet
// (so CRÈME finds Crème), and % and _ searched as plain characters.
function likePattern(searchText) {
  return '%' + searchForm(searchText).replace(/[\\%_]/g, '\\$&') + '%';
}

// ---------- Logging in ----------

// Checks an email and password. Returns the user, or throws a plain message (401 wrong, 423 locked).
function checkLogin(emailInput, passwordInput) {
  const email = cleanEmail(emailInput);
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  if (!email || !password) throw new HttpError(400, 'Please enter your email and password.');
  if (password.length > 200) throw new HttpError(401, WRONG_LOGIN);

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) {
    passwordMatches(password, DUMMY_HASH);
    throw new HttpError(401, WRONG_LOGIN);
  }
  if (isLocked(user)) throw new HttpError(423, lockedMessage(user));
  if (!passwordMatches(password, user.password_hash)) recordWrongPassword(user.id);

  db.prepare('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);
  return user;
}

// True while the account is locked after too many wrong passwords.
function isLocked(user) {
  return user.locked_until !== null && user.locked_until > nowIso();
}

// "Try again in 4 minutes."
function lockedMessage(user) {
  const minutes = Math.max(1, Math.ceil((new Date(user.locked_until) - Date.now()) / 60000));
  return `Too many wrong passwords. This account is locked. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`;
}

// Counts a wrong password. The 5th in a row locks the account for 5 minutes. Always throws.
function recordWrongPassword(userId) {
  const { failed_logins } = db.prepare(
    'UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ? RETURNING failed_logins'
  ).get(userId);
  if (failed_logins >= MAX_WRONG_PASSWORDS) {
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    db.prepare('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?').run(lockedUntil, userId);
    throw new HttpError(423, `Too many wrong passwords. This account is locked for ${LOCK_MINUTES} minutes.`);
  }
  throw new HttpError(401, WRONG_LOGIN);
}

// ---------- Sessions ----------

// Starts a session: a long random token saved in the database and in an httpOnly cookie, for 8 hours.
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()); // tidy up old sessions
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,     // page scripts cannot read it
    sameSite: 'lax',    // other websites cannot send it with their forms
    secure: process.env.COOKIE_SECURE === '1', // switch on (COOKIE_SECURE=1) when the site runs on HTTPS
    path: '/',
    maxAge: SESSION_HOURS * 3600 * 1000,
  });
}

// Ends the current session (log out) and removes the cookie.
function endSession(req, res) {
  const token = readSessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(token);
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', path: '/' });
}

// Reads the session token from the Cookie header, or returns null.
function readSessionToken(req) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === COOKIE_NAME) return /^[a-f0-9]{64}$/.test(value || '') ? value : null;
  }
  return null;
}

// Runs before every request: finds who is logged in and puts them in req.user (or null).
function loadUser(req, res, next) {
  req.user = null;
  const token = readSessionToken(req);
  if (token) {
    req.user = db.prepare(`
      SELECT users.id, users.email, users.role, users.seller_id
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.id = ? AND sessions.expires_at > ?`).get(token, nowIso()) || null;
  }
  next();
}

// ---------- Who may do what ----------

// Only people who are logged in. Otherwise 401.
function requireLogin(req, res, next) {
  if (!req.user) throw new HttpError(401, 'Please log in first.');
  next();
}

// Only people with this role ('admin' or 'seller'). 401 when not logged in, 403 for the wrong role.
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Please log in first.');
    if (req.user.role !== role) throw new HttpError(403, 'You are not allowed to do this.');
    next();
  };
}

// Only sellers whose shop has one of these statuses, for example requireSeller('active').
// Puts the seller's own shop in req.shop.
function requireSeller(...allowedStatuses) {
  return (req, res, next) => {
    if (!req.user) throw new HttpError(401, 'Please log in first.');
    if (req.user.role !== 'seller') throw new HttpError(403, 'Only sellers can do this.');
    const shop = db.prepare('SELECT * FROM sellers WHERE id = ?').get(req.user.seller_id);
    if (!allowedStatuses.includes(shop.status)) throw new HttpError(403, shopBlockedMessage(shop));
    req.shop = shop;
    next();
  };
}

// The message a seller gets when their shop's status does not allow something.
function shopBlockedMessage(shop) {
  if (shop.status === 'pending') return 'Your shop is waiting for approval.';
  if (shop.status === 'rejected') return 'Your shop was not approved.';
  if (shop.status === 'suspended') return 'Your shop is suspended.';
  return 'Your shop cannot do this right now.';
}

// Stops a seller from touching anything that belongs to another shop (403). Use it on every product, order and earning.
function requireOwnShop(req, sellerId) {
  if (!req.user || req.user.role !== 'seller' || req.user.seller_id !== sellerId) {
    throw new HttpError(403, 'This belongs to another shop.');
  }
}

// Pages anyone may open inside the staff areas: the seller sign-up page and its script.
const OPEN_STAFF_PAGES = ['/seller/signup.html', '/seller/signup.js'];

// Guards the staff pages: /admin/... only for the admin, /seller/... only for sellers (the sign-up page is open to all).
// Not logged in goes to the login page; the wrong role gets 403. It runs before the file server, for every request,
// and reads the address the way the file server does, so tricks like /%61dmin/, //admin/ or /x/../admin/ still meet it.
function protectStaffPages(req, res, next) {
  const page = cleanPagePath(req.path);
  const role = staffRoleFor(page);
  if (!role || OPEN_STAFF_PAGES.includes(page)) return next();
  if (!req.user) return res.redirect('/login.html?next=' + encodeURIComponent(req.originalUrl));
  if (req.user.role !== role) {
    return res.status(403).type('text').send('This page is not for your account. Log out, then log in with the right account at /login.html');
  }
  next();
}

// The address as the file server will read it: %-codes decoded, // and /./ and /../ cleaned up, in small letters.
// The Mac's file system also reads some unusual letters as plain ones (the old long s "ſ" opens the "s" folder), so
// those are turned into plain letters first. null for a broken %-code (the file server refuses those anyway).
function cleanPagePath(rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch (e) {
    return null;
  }
  const plainLetters = decoded.normalize('NFKC').toUpperCase().toLowerCase(); // "ſ" -> "S" -> "s"
  return path.posix.normalize('/' + plainLetters);
}

// 'admin' for /admin/..., 'seller' for /seller/..., else null.
function staffRoleFor(page) {
  if (page === null) return null;
  if (page === '/admin' || page.startsWith('/admin/')) return 'admin';
  if (page === '/seller' || page.startsWith('/seller/')) return 'seller';
  return null;
}

module.exports = {
  COOKIE_NAME,
  HttpError,
  hashPassword,
  passwordMatches,
  cleanText,
  cleanEmail,
  isValidEmail,
  cleanPhone,
  isValidPhone,
  readWholeNumber,
  readId,
  cleanSearch,
  likePattern,
  checkLogin,
  startSession,
  endSession,
  loadUser,
  requireLogin,
  requireRole,
  requireSeller,
  requireOwnShop,
  protectStaffPages,
};
