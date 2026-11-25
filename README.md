# Bazaar Lane

A marketplace where many small, independent shops sell handmade goods in one place. Customers fill one bag from several shops and pay once. Each shop packs and sends its own part. The platform takes a commission and pays the rest to the shops. Payments run in test mode only: no real money moves.

## Run it on your computer

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:3000. The first start creates `marketplace.db` with sample shops, 21 categories, 52 products and photos. `npm run dev` restarts the app by itself when you save a file.

### Test logins

The sample admin and shop logins are in `DEMO_ACCOUNTS` near the top of the sample data in `db.js`. They are test passwords for the sample data only. Log in at http://localhost:3000/login.html.

- Admin: http://localhost:3000/admin/
- A shop: http://localhost:3000/seller/
- Customers do not log in: they browse, add to the bag and check out as guests. Payments use FakePay, a pretend payment page built into the app.

## Check that nothing broke

```bash
npm run check
```

This starts a separate test copy of the app (port 3101, its own database in your temp folder) and prints PASS or FAIL for every checklist item. All of them must pass before you share a change. The layout check opens Google Chrome without a window; set `CHROME_PATH` if Chrome is somewhere else.

## How the project is built

- `CLAUDE.md` is the project notebook: the rules, the full checklist and what has been built. Read it first.
- Node.js and Express, SQLite through better-sqlite3 (one file, `marketplace.db`), plain HTML, CSS and JavaScript in `public/`. No build step.
- The look comes from the Interaction Kit in `kit/` (do not edit it): its colour tokens, the Instrument Sans font and its 14 components (`window.IK`).
- `server.js` starts the app. `routes/` has one file per area. `orderStatus.js` is the only place an order's status changes. Money is stored as whole paise.

## Working together

1. Get the latest code: `git pull`.
2. Make a branch for your change: `git checkout -b my-change`.
3. Make the change, run `npm run check`, then commit and push the branch: `git push -u origin my-change`.
4. Open a pull request on GitHub so someone else can look at it before it goes into `main`.

Never commit your own `marketplace.db`, the `uploads/` and `backups/` folders, or a `.env` file. `.gitignore` already keeps them out. Never put real payment keys in the code: the app only takes Razorpay TEST keys, from environment variables.

## Photos

The sample photos in `sample-photos/` are free Unsplash photos. `CREDITS.md` lists each photographer and link.
