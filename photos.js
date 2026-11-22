// photos.js - the ONE way a photo gets into the store (products, category tiles, promo cards): the file itself is the
// request body; JPEG, PNG or WebP by its first bytes only (never its name or the type the browser says); at most 2 MB;
// saved in the uploads folder under a new random name, never overwriting; the old file of that item is removed.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { UPLOADS_DIR } = require('./db');
const { HttpError } = require('./auth');

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // a photo is at most 2 MB

// The body reader for a photo upload (a bigger file is refused with "The photo must be 2 MB or smaller.").
const readPhotoBody = express.raw({ type: () => true, limit: MAX_PHOTO_BYTES });

// The file type from the first bytes of the file: '.jpg', '.png' or '.webp', or null for anything else.
function photoExtension(bytes) {
  const starts = (hex, at = 0) => bytes.subarray(at, at + hex.length / 2).toString('hex') === hex;
  if (bytes.length >= 3 && starts('ffd8ff')) return '.jpg';
  if (bytes.length >= 8 && starts('89504e470d0a1a0a')) return '.png';
  if (bytes.length >= 12 && starts('52494646') && starts('57454250', 8)) return '.webp'; // "RIFF" .... "WEBP"
  return null;
}

// Checks and saves the uploaded bytes. Returns the new random file name. Throws a plain message for a bad file.
function savePhoto(body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  if (bytes.length === 0) throw new HttpError(400, 'Please choose a photo to upload.');
  if (bytes.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'The photo must be 2 MB or smaller.');
  const extension = photoExtension(bytes);
  if (!extension) throw new HttpError(400, 'The photo must be a JPEG, PNG or WebP picture.');
  const fileName = crypto.randomBytes(16).toString('hex') + extension;
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), bytes, { flag: 'wx' }); // wx: never overwrites a file
  return fileName;
}

// Deletes a photo file this app saved earlier (only names it made itself, so nothing else can ever be deleted).
function removeOldPhoto(fileName) {
  if (!fileName || !/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(fileName)) return;
  fs.rmSync(path.join(UPLOADS_DIR, fileName), { force: true }); // done before the answer, so the old file is surely gone
}

module.exports = { MAX_PHOTO_BYTES, readPhotoBody, photoExtension, savePhoto, removeOldPhoto };
