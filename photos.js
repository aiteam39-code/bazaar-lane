// photos.js - the ONE way a photo gets into the store (products, category tiles, promo cards): the file itself is the
// request body; JPEG, PNG or WebP by its first bytes only (never its name or the type the browser says); at most 2 MB;
// saved in the database's photos table under a new random name, never overwriting; the old photo of that item is removed.
const crypto = require('crypto');
const express = require('express');
const { savePhotoBytes, deletePhoto } = require('./db');
const { HttpError } = require('./auth');

const MAX_PHOTO_BYTES = 2 * 1024 * 1024; // a photo is at most 2 MB
const TYPES = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

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

// Checks and saves the uploaded bytes. Returns the new random name. Throws a plain message for a bad file.
async function savePhoto(body) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  if (bytes.length === 0) throw new HttpError(400, 'Please choose a photo to upload.');
  if (bytes.length > MAX_PHOTO_BYTES) throw new HttpError(413, 'The photo must be 2 MB or smaller.');
  const extension = photoExtension(bytes);
  if (!extension) throw new HttpError(400, 'The photo must be a JPEG, PNG or WebP picture.');
  const name = crypto.randomBytes(16).toString('hex') + extension;
  await savePhotoBytes(name, TYPES[extension], bytes);
  return name;
}

// Deletes a photo this app saved earlier (only names it made itself, so nothing else can ever be deleted).
async function removeOldPhoto(name) {
  await deletePhoto(name);
}

module.exports = { MAX_PHOTO_BYTES, readPhotoBody, photoExtension, savePhoto, removeOldPhoto };
