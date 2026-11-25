// backup.js - npm run backup: copies every table of the database into one JSON file in the backups folder, with the
// date and time in the name, like backups/bazaar-lane-2026-11-22-173015.json. Photos are kept in it as base64 text.
// It reads the database the app uses (the laptop's own Postgres, or the one in DATABASE_URL), and it never deletes
// or changes anything. BACKUP_DIR can change the folder.
const fs = require('fs');
const net = require('net');
const path = require('path');

const folder = process.env.BACKUP_DIR || path.join(__dirname, 'backups');
const LOCAL_PORT = Number(process.env.DB_PORT) || 54329; // the laptop's own Postgres (the same port db.js uses)

// The date and time for the file name: 2026-11-22-173015.
function stamp() {
  const now = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
}

// True when something already listens on this port on this laptop (for example `npm run dev` with its own Postgres).
function portIsInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, '127.0.0.1');
    socket.once('connect', () => { socket.end(); resolve(true); });
    socket.once('error', () => resolve(false));
  });
}

// One table's rows, with any bytes (photos) turned into base64 text so they fit in JSON.
async function rowsOf(db, table) {
  const rows = await db.all(`SELECT * FROM "${table}"`);
  return rows.map((row) => {
    const copy = {};
    for (const [column, value] of Object.entries(row)) copy[column] = Buffer.isBuffer(value) ? value.toString('base64') : value;
    return copy;
  });
}

// Reads every table and writes the backup file. Never overwrites an older backup.
async function backUp() {
  // While the app runs on this laptop, its Postgres is already started: connect to it instead of starting a second one.
  if (!process.env.DATABASE_URL && await portIsInUse(LOCAL_PORT)) {
    process.env.DATABASE_URL = `postgres://bazaar:bazaar-local@127.0.0.1:${LOCAL_PORT}/bazaar`;
  }
  const { db, ready, close } = require('./db'); // loaded only now, so it sees the address chosen above
  try {
    await ready();
    const tables = (await db.all(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).map((row) => row.table_name);
    const backup = { app: 'Bazaar Lane', made_at: new Date().toISOString(), tables: {} };
    for (const table of tables) backup.tables[table] = await rowsOf(db, table);

    fs.mkdirSync(folder, { recursive: true });
    const target = path.join(folder, `bazaar-lane-${stamp()}.json`);
    try {
      fs.writeFileSync(target, JSON.stringify(backup), { flag: 'wx' }); // 'wx': refuse to overwrite a file that exists
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`${target} already exists. Try again in a second.`);
      throw error;
    }
    const products = (backup.tables.products || []).length;
    console.log(`Backup saved: ${target} (${products} products in it). Nothing was deleted.`);
  } finally {
    await close();
  }
}

backUp().catch((error) => {
  console.error('The backup did not work: ' + error.message);
  process.exit(1);
});
