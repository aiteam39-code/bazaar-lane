// backup.js - npm run backup: copies marketplace.db (or DB_FILE) into the backups folder, with the date and time in
// the name, like backups/marketplace-2026-11-22-1730.db. It reads the database safely while the app runs (SQLite's
// own backup), and it never deletes anything.
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const source = process.env.DB_FILE || path.join(__dirname, 'marketplace.db');
const folder = process.env.BACKUP_DIR || path.join(__dirname, 'backups');

function stamp() {
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

async function backUp() {
  if (!fs.existsSync(source)) throw new Error(`There is no database at ${source}.`);
  fs.mkdirSync(folder, { recursive: true });
  const target = path.join(folder, `marketplace-${stamp()}.db`);
  if (fs.existsSync(target)) throw new Error(`${target} already exists. Try again in a second.`);
  const db = new Database(source, { readonly: true, fileMustExist: true });
  await db.backup(target);
  db.close();
  // The copy becomes one plain file (no -wal or -shm helper files next to it), then it is read back as a check.
  const copy = new Database(target);
  copy.pragma('journal_mode = DELETE');
  const products = copy.prepare('SELECT COUNT(*) AS n FROM products').get().n;
  copy.close();
  console.log(`Backup saved: ${target} (${products} products in it). Nothing was deleted.`);
}

backUp().catch((error) => {
  console.error('The backup did not work: ' + error.message);
  process.exit(1);
});
