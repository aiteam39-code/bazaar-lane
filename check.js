// check.js - the automatic test for Bazaar Lane. Run it with: npm run check
//
// It starts its OWN small Postgres database (in a folder in the system temp folder, on port 54351) and its OWN copy of
// the app on port 3101 that uses it. It never touches the app's own database (pgdata), the live database in DATABASE_URL
// or the app you run on port 3000. The test database folder is deleted at the start and at the end.
// It prints one PASS or FAIL line per checklist item, then "N of M passed", and exits with an error if anything failed.
//
// Sector 1 checks: the sample data, S1 to S5 (the parts built so far) and G1.
// Sector 2 checks: more of S1, S4 and S5, then P1, P2, P3, STOCK (+ and -), P5, C1, C2 and HIDE (the admin hides a product).
// Sector 3 checks: buying in P2, P3, S5 and HIDE, then C3, C4, C5, P4, M1, P6, F4, F3, Y4 (cash on delivery) and ORDERS
// (the admin's Orders page). F3 and F4 call orderStatus.js directly for the shop's moves, which get buttons in sector 5.
// Later sectors add their own checks here.

const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DB_DIR = path.join(os.tmpdir(), 'bazaar-lane-check-pg'); // the test database's own folder in the temp folder
const TEST_DB_PORT = 54351;
const TEST_DATABASE_URL = `postgres://bazaar:bazaar-local@127.0.0.1:${TEST_DB_PORT}/bazaar`; // the test copy of the app uses this
const ZZ_PASSWORD = 'zz-check-pass-1'; // test password for the ZZ shops this check creates

let db = null;               // the test database, run by this program so checks can look inside it
let closeDatabase = null;    // stops the test database (db.js close())
let DEMO_ACCOUNTS = [];
let COOKIE_NAME = '';
let server = null;           // the test copy of the app
let serverRunning = false;
let testDatabaseIsOurs = false;
const results = [];
const state = {};            // logins and ids shared between checks

// ---------- The test database ----------

// Deletes the test database folder. Refuses any folder that is not inside the temp folder, or is inside the project.
function deleteTestDatabase() {
  const folder = path.resolve(TEST_DB_DIR);
  if (!folder.startsWith(path.resolve(os.tmpdir()) + path.sep) || folder.startsWith(path.resolve(__dirname) + path.sep)) {
    throw new Error('Refusing to delete ' + folder + '. The check must only delete its own database folder.');
  }
  fs.rmSync(folder, { recursive: true, force: true });
}

// Starts the fresh test database in this program (db.js runs it), with the sample data.
// Set BEFORE db.js is loaded: db.js then starts its own Postgres in the test folder and never uses DATABASE_URL.
async function openTestDatabase() {
  process.env.DB_DIR = TEST_DB_DIR;
  process.env.DB_PORT = String(TEST_DB_PORT);
  process.env.SAMPLE_PHOTOS_PER_START = '1000'; // the test copy fills every sample photo at once
  delete process.env.DATABASE_URL;
  const database = require('./db');
  ({ db, DEMO_ACCOUNTS } = database);
  ({ COOKIE_NAME } = require('./auth'));
  closeDatabase = database.close;
  await database.ready();
  // The Winter look is switched off in the test copy, so the season checks see only Christmas (as they were written).
  await db.run("UPDATE seasons SET enabled = 0 WHERE key = 'winter'");
}

// Stops the test database (if it was started).
async function stopTestDatabase() {
  if (closeDatabase) await closeDatabase();
  closeDatabase = null;
}

// The settings for any copy of the app (or backup.js) this check starts: the test database, a clock tests may move,
// never production, and no live database. extra adds or changes some.
function testCopyEnv(extra) {
  const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, ALLOW_TEST_CLOCK: '1', ...extra };
  for (const name of ['NODE_ENV', 'DB_DIR', 'DB_PORT']) delete env[name];
  return env;
}

// ---------- The test copy of the app ----------

// Stops with a clear message when something already uses the port (3101 for the app, 54351 for the test database).
function checkPortIsFree(port = PORT) {
  return new Promise((resolve, reject) => {
    const tester = net.createServer();
    tester.once('error', () => reject(new Error(`Port ${port} is busy. Close whatever is using it, then run npm run check again.`)));
    tester.once('listening', () => tester.close(resolve));
    tester.listen(port, '127.0.0.1');
  });
}

// Starts the test copy on port 3101 with the test database, and waits until it answers.
// testClock (optional): an ISO date the test copy uses as "now" for seasons (only a test copy, with ALLOW_TEST_CLOCK,
// can move its clock). Stopping and starting it keeps every row: the data lives in this check's own database.
async function startServer(testClock) {
  let output = '';
  server = spawn(process.execPath, ['server.js'], {
    cwd: __dirname,
    env: testCopyEnv({ PORT: String(PORT), RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '', TEST_CLOCK: testClock || '' }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverRunning = true;
  server.on('exit', () => { serverRunning = false; });
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });

  for (let i = 0; i < 300; i++) {
    if (!serverRunning) throw new Error('The test copy of the app stopped:\n' + output);
    try {
      const response = await fetch(BASE + '/api/info');
      if (response.ok) return;
    } catch (e) {
      // not ready yet
    }
    await wait(100);
  }
  throw new Error('The test copy of the app did not start within 30 seconds:\n' + output);
}

// Stops the test copy and waits until it has really stopped.
function stopServer() {
  return new Promise((resolve) => {
    if (!server || !serverRunning) return resolve();
    server.once('exit', () => resolve());
    server.kill('SIGTERM');
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- A pretend browser ----------

// A pretend browser: it keeps its own login cookie, like a real browser.
function newBrowser() {
  const browser = { cookie: '' };
  // Sends one request and returns { status, data, headers }.
  browser.call = async (method, url, body) => {
    const headers = {};
    if (browser.cookie) headers.Cookie = browser.cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(BASE + url, {
      method,
      headers,
      redirect: 'manual',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const setCookie of response.headers.getSetCookie()) {
      const pair = setCookie.split(';')[0];
      if (pair.startsWith(COOKIE_NAME + '=')) browser.cookie = pair === COOKIE_NAME + '=' ? '' : pair;
    }
    const text = await response.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch (e) {
      // not JSON: keep the text
    }
    return { status: response.status, data, headers: response.headers };
  };
  return browser;
}

// ---------- A real browser for the layout check (Google Chrome, headless, on its own empty profile) ----------

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Opens each page in headless Chrome at width x height (as a phone) and measures it: how wide the page is, whether
// the header is sticky, and on the home page how many tiles, promo cards and rows it drew and which buttons are small.
async function measureInChrome(pages, width, height) {
  if (!fs.existsSync(CHROME)) throw new Error('Google Chrome is needed for this check (set CHROME_PATH to it).');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bazaar-lane-chrome-'));
  const debugPort = 9333;
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let target = null;
    for (let i = 0; i < 50 && !target; i += 1) {
      await wait(200);
      try {
        target = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find((t) => t.type === 'page');
      } catch (e) {
        // Chrome is still starting
      }
    }
    if (!target) throw new Error('Chrome did not start.');
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let nextId = 0;
    const waiting = new Map();
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && waiting.has(message.id)) {
        waiting.get(message.id)(message);
        waiting.delete(message.id);
      }
    };
    const send = (method, params = {}) => new Promise((resolve) => {
      nextId += 1;
      waiting.set(nextId, resolve);
      socket.send(JSON.stringify({ id: nextId, method, params }));
    });
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result.value;
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    const report = [];
    for (const url of pages) {
      await send('Page.navigate', { url: BASE + url });
      await wait(1500);
      // Scroll to the bottom twice so the lazy rows load, then measure.
      await evaluate('new Promise((done) => { window.scrollTo(0, document.body.scrollHeight); setTimeout(() => { window.scrollTo(0, document.body.scrollHeight); setTimeout(done, 1200); }, 1200); })');
      const measured = await evaluate(`(async () => {
        const arrow = [...document.querySelectorAll('.row-arrow.is-next')].find((b) => !b.disabled && b.offsetParent !== null);
        let arrowMoved = null;
        if (arrow) {
          const list = arrow.parentElement.querySelector('.product-row');
          arrow.scrollIntoView({ block: 'center' });
          const before = list.scrollLeft;
          arrow.click();
          await new Promise((done) => setTimeout(done, 1200));
          arrowMoved = list.scrollLeft > before;
        }
        const header = document.querySelector('[data-customer-header]');
        const small = [...document.querySelectorAll('main button, main a.button, header button, header .bag-link')]
          .filter((el) => el.offsetParent !== null && !el.closest('.product-row .row-card:not(:first-child)'))
          .map((el) => [el, el.getBoundingClientRect()]).filter(([, box]) => box.height > 0 && box.height < 43.5)
          .map(([el, box]) => (el.textContent.trim() || el.getAttribute('aria-label') || el.className) + ' ' + Math.round(box.height) + 'px');
        return { width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth,
          sticky: header ? getComputedStyle(header).position : null,
          tiles: document.querySelectorAll('.category-tile').length, promos: document.querySelectorAll('.promo-card').length,
          rows: document.querySelectorAll('.category-row:not(.is-loading)').length, hiddenSections: document.querySelectorAll('.will-reveal:not(.is-in)').length,
          accents: [...document.querySelectorAll('.accent, .ik-atc-accent')].filter((el) => el.offsetParent !== null && (el.matches('button, a, [role=button]') || el.querySelector('button'))).length,
          arrowMoved, small };
      })()`);
      report.push(measured ? { url, ...measured } : { url, error: 'the page could not be measured' });
    }
    socket.close();
    return report;
  } finally {
    chrome.kill();
    await wait(300);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

// Every file in a folder and its sub-folders.
function listFiles(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

// ---------- Helpers for the checks ----------

// Runs one checklist item and prints PASS or FAIL.
async function check(item, description, testFn) {
  try {
    await testFn();
    results.push({ item, pass: true });
    console.log(`PASS  ${item}  ${description}`);
  } catch (error) {
    results.push({ item, pass: false });
    console.log(`FAIL  ${item}  ${description}\n        -> ${error.message}`);
  }
}

// Fails the current check with a plain explanation when the condition is not true.
function expect(condition, problem) {
  if (!condition) throw new Error(problem);
}

// Shows a server answer in a failure message.
function show(answer) {
  return `${answer.status} ${JSON.stringify(answer.data)}`;
}

// The demo account of the admin ('admin') or of a sample shop (by shop name).
function demo(name) {
  return DEMO_ACCOUNTS.find((account) => (name === 'admin' ? account.role === 'admin' : account.shop === name));
}

// Logs in and returns a browser holding that login. Fails the check if the login does not work.
async function loginAs(email, password) {
  const browser = newBrowser();
  const answer = await browser.call('POST', '/api/login', { email, password });
  expect(answer.status === 200, `login for ${email} should work, got ${show(answer)}`);
  return browser;
}

// Signs up a ZZ test shop and returns the browser that is now logged in as it.
async function signUpShop(shopName, email, phone) {
  const browser = newBrowser();
  const answer = await browser.call('POST', '/api/sellers/signup', { shop_name: shopName, email, password: ZZ_PASSWORD, phone });
  expect(answer.status === 201, `sign-up of ${shopName} should work, got ${show(answer)}`);
  return browser;
}

async function shopId(shopName) {
  return (await db.get('SELECT id FROM sellers WHERE shop_name = ?', shopName)).id;
}

async function shopStatus(shopName) {
  return (await db.get('SELECT status FROM sellers WHERE shop_name = ?', shopName)).status;
}

// The names of the shops a customer sees on the home page.
async function homePageShops() {
  const answer = await newBrowser().call('GET', '/api/shops');
  return answer.data.shops.map((shop) => shop.shop_name);
}

async function count(sql) {
  return (await db.get(sql)).n;
}

// A product form for the checks, with the price typed in rupees as on the page. extra changes some fields.
async function zzProduct(name, extra = {}) {
  return {
    name, category_id: await categoryId('Food and spices'), price: '120',
    description: 'ZZ check product', stock: 10, low_stock_level: 3, ...extra,
  };
}

async function categoryId(name) {
  return (await db.get('SELECT id FROM categories WHERE name = ?', name)).id;
}

async function productId(name) {
  return (await db.get('SELECT id FROM products WHERE name = ?', name)).id;
}

async function productRow(name) {
  return await db.get('SELECT * FROM products WHERE name = ?', name);
}

// The products a customer sees on a shop's page, or null when the shop is not available.
async function storeProducts(slug) {
  const answer = await newBrowser().call('GET', '/api/store/' + slug);
  return answer.status === 200 ? answer.data.products : null;
}

// The product names a customer gets from search or a category list, for example { search: 'chilli' }.
async function searchNames(filters) {
  const answer = await newBrowser().call('GET', '/api/products?' + new URLSearchParams(filters));
  return answer.data.products.map((product) => product.name);
}

// One cart line by product name, for example cartLine('Hot Chilli Sauce', 2).
async function cartLine(name, quantity) {
  return { product_id: await productId(name), quantity };
}

// A checkout form for the checks: test customer details and this cart. extra changes some fields.
function zzCheckout(items, extra = {}) {
  return {
    customer_name: 'ZZ Check Customer', phone: '9000000990', email: 'zz-customer@check.test',
    address: '12 ZZ Check Street, Test Town 560001', payment_method: 'cod', items,
    phone_token: (state.phoneTokens || {})[extra.phone || '9000000990'], ...extra,
  };
}

// Checks a phone with the code the server "sends" (cash on delivery needs it). Keeps the token for zzCheckout.
async function checkPhone(phone) {
  const browser = newBrowser();
  const sent = await browser.call('POST', '/api/checkout/phone-code', { phone });
  const checked = await browser.call('POST', '/api/checkout/phone-verify', { phone, code: sent.data.test_sms });
  state.phoneTokens = { ...(state.phoneTokens || {}), [phone]: checked.data.phone_token };
  return { sent, checked };
}

// Places an ONLINE order (it waits for payment). Returns { answer, token, paymentId }.
async function placeOnlineOrder(items, extra = {}) {
  const answer = await newBrowser().call('POST', '/api/checkout', zzCheckout(items, { payment_method: 'online', ...extra }));
  const token = answer.status === 201 ? answer.data.tracking_url.split('/')[2] : null;
  return { answer, token, paymentId: answer.status === 201 ? answer.data.payment.id : null };
}

// FakePay hands back its signed result, then the server checks it (like the pay page does).
async function payWithFakePay(paymentId, outcome) {
  const result = await newBrowser().call('POST', `/api/pay/fake/${paymentId}`, { outcome });
  const verified = await newBrowser().call('POST', '/api/payments/verify', result.data);
  return { result: result.data, verified };
}

// Places an order as a visitor (no login), like a browser would. Returns { answer, token }.
async function placeOrder(items, extra) {
  const answer = await newBrowser().call('POST', '/api/checkout', zzCheckout(items, extra));
  const token = answer.status === 201 ? answer.data.tracking_url.split('/')[2] : null;
  return { answer, token };
}

// What the tracking page gets for this token.
async function trackOrder(token) {
  return newBrowser().call('GET', '/api/track/' + token);
}

async function stockOf(name) {
  return (await productRow(name)).stock;
}

// The shops' parts (seller orders) of the order with this tracking token, with each shop's name.
async function partsOfToken(token) {
  return await db.all(`
    SELECT seller_orders.*, sellers.shop_name FROM seller_orders
    JOIN sellers ON sellers.id = seller_orders.seller_id
    JOIN customer_orders ON customer_orders.id = seller_orders.customer_order_id
    WHERE customer_orders.tracking_token = ? ORDER BY sellers.shop_name`, token);
}

// ---------- The checks ----------

async function runChecks() {
  await checkPhone('9000000990'); // the test customer's phone, checked once for cash-on-delivery orders
  await check('DATA', 'Sample data: 1 admin, 3 active shops with Chilli Lane Pantry, 1 pending, the first 4 categories with different rates plus 17 more for the home page, 18 + 34 sample products, 2+ LOW, 1 switched off, 10% default, COD on', async () => {
    expect((await count("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")) === 1, 'there should be exactly 1 admin');
    const active = (await db.all("SELECT shop_name FROM sellers WHERE status = 'active'")).map((row) => row.shop_name);
    expect(active.length === 10, `there should be 3 + 7 maker shops = 10 active shops, found ${active.length}`);
    expect(active.includes('Chilli Lane Pantry'), 'Chilli Lane Pantry should be one of the active shops');
    expect((await count("SELECT COUNT(*) AS n FROM sellers WHERE status = 'pending'")) === 1, 'there should be 1 pending shop');
    const firstFour = (await db.all("SELECT commission_bps FROM categories WHERE name IN ('Food and spices', 'Home and kitchen', 'Clothing', 'Gifts and crafts')")).map((row) => row.commission_bps);
    expect(firstFour.length === 4 && new Set(firstFour).size === 4, `the first 4 categories should have 4 different rates, found ${firstFour}`);
    expect((await count('SELECT COUNT(*) AS n FROM categories')) === 22, `there should be 22 categories, found ${await count('SELECT COUNT(*) AS n FROM categories')}`);
    const products = await count('SELECT COUNT(*) AS n FROM products');
    expect(products === 193, `there should be 18 + 34 + 141 = 193 sample products, found ${products}`);
    const empty = (await db.all(`SELECT name FROM categories WHERE NOT EXISTS (SELECT 1 FROM products JOIN sellers ON sellers.id = products.seller_id
      WHERE products.category_id = categories.id AND products.active = 1 AND products.stock > 0 AND sellers.status = 'active')`)).map((r) => r.name);
    expect(empty.length === 0, `no category may be empty, these are: ${empty.join(', ')}`);
    expect((await count('SELECT COUNT(*) AS n FROM products WHERE stock <= low_stock_level AND deleted = 0')) >= 2, 'at least 2 products should be LOW');
    expect((await count('SELECT COUNT(*) AS n FROM products WHERE active = 0')) >= 1, 'at least 1 product should be switched off');
    expect((await count("SELECT COUNT(*) AS n FROM settings WHERE key = 'default_commission_bps' AND value = '1000'")) === 1, 'the default commission should be 10% (1000)');
    expect((await count("SELECT COUNT(*) AS n FROM settings WHERE key = 'cod_enabled' AND value = '1'")) === 1, 'cash on delivery should be on');
  });

  await check('S1', 'A new seller signs up: the shop is pending, not on the home page, and the seller cannot add products (403); a bad phone, email, password or shop name and a used email or name are refused with a clear message', async () => {
    state.one = await signUpShop('ZZ Test Shop One', 'zz-one@check.test', '9000000901');
    const me = await state.one.call('GET', '/api/me');
    expect(me.status === 200 && me.data.shop.status === 'pending', `the new shop should be pending, got ${show(me)}`);
    expect(!(await homePageShops()).includes('ZZ Test Shop One'), 'a pending shop should not be on the home page');
    expect((await newBrowser().call('GET', '/api/store/zz-test-shop-one')).status === 404, "a pending shop's page should say it is not available");
    const addWhilePending = await state.one.call('POST', '/api/seller/products', await zzProduct('ZZ Pending Jam'));
    expect(addWhilePending.status === 403 && /waiting for approval/.test(addWhilePending.data.error),
      `a pending seller must not add products (403), got ${show(addWhilePending)}`);
    expect((await state.one.call('GET', '/api/seller/products')).status === 403, 'a pending seller should not get a products list');
    expect((await count("SELECT COUNT(*) AS n FROM products WHERE name = 'ZZ Pending Jam'")) === 0, 'nothing may be saved for a pending seller');

    const badForms = [
      [{ shop_name: 'ZZ Bad', email: 'zz-bad@check.test', password: ZZ_PASSWORD, phone: '12345' }, 'Phone'],
      [{ shop_name: 'ZZ Bad', email: 'not-an-email', password: ZZ_PASSWORD, phone: '9000000999' }, 'email'],
      [{ shop_name: 'ZZ Bad', email: 'zz-bad@check.test', password: 'short', phone: '9000000999' }, 'Password'],
      [{ shop_name: ' ', email: 'zz-bad@check.test', password: ZZ_PASSWORD, phone: '9000000999' }, 'Shop name'],
      [{ shop_name: 'ZZ Bad', email: 'zz-one@check.test', password: ZZ_PASSWORD, phone: '9000000999' }, 'email already'],
      [{ shop_name: 'zz test shop ONE', email: 'zz-bad@check.test', password: ZZ_PASSWORD, phone: '9000000999' }, 'name already'],
    ];
    for (const [form, word] of badForms) {
      const answer = await newBrowser().call('POST', '/api/sellers/signup', form);
      expect([400, 409].includes(answer.status) && String(answer.data.error).includes(word),
        `sign-up with ${JSON.stringify(form)} should be refused with a message about "${word}", got ${show(answer)}`);
    }
    expect((await count("SELECT COUNT(*) AS n FROM sellers WHERE shop_name = 'ZZ Bad'")) === 0, 'a refused sign-up must not save a shop');
  });

  await check('S2', 'The admin approves a shop and it appears on the home page and at /store/<slug>; Reject needs a reason, and the seller sees it when they log in', async () => {
    const admin = demo('admin');
    state.admin = await loginAs(admin.email, admin.password);
    const approve = await state.admin.call('POST', `/api/admin/shops/${await shopId('ZZ Test Shop One')}/approve`, {});
    expect(approve.status === 200, `approve should work, got ${show(approve)}`);
    expect((await homePageShops()).includes('ZZ Test Shop One'), 'an approved shop should be on the home page');
    const storePage = await newBrowser().call('GET', '/api/store/zz-test-shop-one');
    expect(storePage.status === 200 && storePage.data.shop.shop_name === 'ZZ Test Shop One', `an approved shop should have its page at /store/<slug>, got ${show(storePage)}`);

    await signUpShop('ZZ Test Shop Two', 'zz-two@check.test', '9000000902');
    const twoId = await shopId('ZZ Test Shop Two');
    const noReason = await state.admin.call('POST', `/api/admin/shops/${twoId}/reject`, { reason: '   ' });
    expect(noReason.status === 400 && /reason/.test(noReason.data.error), `reject without a reason should be refused, got ${show(noReason)}`);
    const reject = await state.admin.call('POST', `/api/admin/shops/${twoId}/reject`, { reason: 'ZZ check: photos missing' });
    expect(reject.status === 200, `reject with a reason should work, got ${show(reject)}`);

    const two = await loginAs('zz-two@check.test', ZZ_PASSWORD);
    const me = await two.call('GET', '/api/me');
    expect(me.data.shop.status === 'rejected' && me.data.shop.status_reason === 'ZZ check: photos missing',
      `the rejected seller should see the reason when they log in, got ${show(me)}`);
    expect(!(await homePageShops()).includes('ZZ Test Shop Two'), 'a rejected shop should not be on the home page');
  });

  await check('S3', 'A wrong password is refused; 5 wrong tries lock the account for 5 minutes; passwords are saved only as salted hashes; the cookie is httpOnly, SameSite=Lax, 8 hours; Log out ends the session', async () => {
    const wrong = await newBrowser().call('POST', '/api/login', { email: 'zz-one@check.test', password: 'wrong-password' });
    expect(wrong.status === 401 && wrong.data.error === 'Wrong email or password.', `a wrong password should be refused, got ${show(wrong)}`);

    const hashes = await db.all("SELECT password_hash FROM users WHERE email IN ('zz-one@check.test', 'zz-two@check.test')");
    for (const row of hashes) {
      expect(row.password_hash.startsWith('scrypt:') && !row.password_hash.includes(ZZ_PASSWORD), 'a password should be saved only as a scrypt hash');
    }
    expect(hashes.length === 2 && hashes[0].password_hash !== hashes[1].password_hash, 'two accounts with the same password should get different hashes (random salt)');
    expect((await count("SELECT COUNT(*) AS n FROM users WHERE password_hash NOT LIKE 'scrypt:%'")) === 0, 'every account should have a scrypt hash');

    await signUpShop('ZZ Lock Shop', 'zz-lock@check.test', '9000000903');
    for (let i = 1; i <= 4; i++) {
      const answer = await newBrowser().call('POST', '/api/login', { email: 'zz-lock@check.test', password: 'wrong-' + i });
      expect(answer.status === 401, `wrong try ${i} should answer 401, got ${show(answer)}`);
    }
    const fifth = await newBrowser().call('POST', '/api/login', { email: 'zz-lock@check.test', password: 'wrong-5' });
    expect(fifth.status === 423 && /locked for 5 minutes/.test(fifth.data.error), `the 5th wrong try should lock the account, got ${show(fifth)}`);
    const rightWhileLocked = await newBrowser().call('POST', '/api/login', { email: 'zz-lock@check.test', password: ZZ_PASSWORD });
    expect(rightWhileLocked.status === 423, `even the right password should be refused while locked, got ${show(rightWhileLocked)}`);
    const lockedUntil = (await db.get("SELECT locked_until FROM users WHERE email = 'zz-lock@check.test'")).locked_until;
    const minutesLeft = (Date.parse(lockedUntil) - Date.now()) / 60000;
    expect(minutesLeft > 4.5 && minutesLeft <= 5.01, `the lock should last 5 minutes, found ${minutesLeft.toFixed(2)}`);
    // Pretend the 5 minutes have passed (only in the test database), then the right password works again.
    await db.run("UPDATE users SET locked_until = ? WHERE email = 'zz-lock@check.test'", new Date(Date.now() - 1000).toISOString());
    await loginAs('zz-lock@check.test', ZZ_PASSWORD);

    const admin = demo('admin');
    const login = await newBrowser().call('POST', '/api/login', { email: admin.email, password: admin.password });
    const cookie = login.headers.getSetCookie().find((text) => text.startsWith(COOKIE_NAME + '='));
    expect(cookie && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Max-Age=28800/i.test(cookie),
      `the cookie should be HttpOnly, SameSite=Lax and last 8 hours, got: ${cookie}`);
    const token = cookie.split(';')[0].split('=')[1];
    const hoursLeft = (Date.parse((await db.get('SELECT expires_at FROM sessions WHERE id = ?', token)).expires_at) - Date.now()) / 3600000;
    expect(hoursLeft > 7.9 && hoursLeft <= 8.01, `the session should end after 8 hours, found ${hoursLeft.toFixed(2)}`);

    const browser = await loginAs('zz-one@check.test', ZZ_PASSWORD);
    const savedCookie = browser.cookie;
    await browser.call('POST', '/api/logout');
    expect((await browser.call('GET', '/api/me')).status === 401, 'after Log out, the person should not be logged in');
    browser.cookie = savedCookie;
    expect((await browser.call('GET', '/api/me')).status === 401, 'after Log out, the old cookie should not work any more');
  });

  await check('S4', 'A visitor gets 401 and a seller gets 403 on admin data, actions and pages, even calling the server directly; seller A sees only their own products and gets 403 on seller B\'s (edit, stock, switch, delete); an expired session gets 401 (orders and earnings: sectors 5 and 6)', async () => {
    const oneId = await shopId('ZZ Test Shop One');
    const visitor = newBrowser();
    expect((await visitor.call('GET', '/api/me')).status === 401, 'a visitor should get 401 on /api/me');
    expect((await visitor.call('GET', '/api/admin/shops')).status === 401, 'a visitor should get 401 on the admin shop list');
    expect((await visitor.call('POST', `/api/admin/shops/${oneId}/suspend`, { reason: 'ZZ' })).status === 401, 'a visitor should get 401 on Suspend');
    const adminPage = await visitor.call('GET', '/admin/shops.html');
    expect(adminPage.status === 302 && adminPage.headers.get('location').startsWith('/login.html'), `a visitor should be sent to the login page, got ${adminPage.status}`);
    expect((await visitor.call('GET', '/seller/')).status === 302, 'a visitor should be sent from /seller/ to the login page');
    expect((await visitor.call('GET', '/seller/products.html')).status === 302, 'a visitor should be sent from the seller Products page to the login page');
    expect((await visitor.call('GET', '/admin/products.html')).status === 302, 'a visitor should be sent from the admin All products page to the login page');
    expect((await visitor.call('GET', '/seller/signup.html')).status === 200, 'the sign-up page should be open to everyone');
    expect((await visitor.call('GET', '/api/seller/products')).status === 401, 'a visitor should get 401 on the seller products list');
    expect((await visitor.call('POST', '/api/seller/products', await zzProduct('ZZ Visitor Jam'))).status === 401, 'a visitor should get 401 when adding a product');

    const pantryAccount = demo('Chilli Lane Pantry');
    const pantry = await loginAs(pantryAccount.email, pantryAccount.password);
    expect((await pantry.call('GET', '/api/admin/shops')).status === 403, 'a seller should get 403 on the admin shop list');
    const suspend = await pantry.call('POST', `/api/admin/shops/${oneId}/suspend`, { reason: 'ZZ not allowed' });
    expect(suspend.status === 403, `a seller should get 403 on Suspend, got ${show(suspend)}`);
    expect((await shopStatus('ZZ Test Shop One')) === 'active', 'a seller must not be able to change another shop');
    expect((await pantry.call('GET', '/admin/')).status === 403, 'a seller should get 403 on the admin pages');
    expect((await state.admin.call('GET', '/seller/')).status === 403, 'the admin should get 403 on the seller pages');

    // Seller A (Chilli Lane Pantry) and seller B's (Terracotta Corner) products.
    const pantryId = await shopId('Chilli Lane Pantry');
    const pantryList = await pantry.call('GET', '/api/seller/products');
    expect(pantryList.status === 200 && pantryList.data.products.length > 0 && pantryList.data.products.every((p) => p.seller_id === pantryId),
      `a seller should see only their own products, got ${show(pantryList).slice(0, 200)}`);
    const theirs = await productRow('Clay Water Bottle');
    const attempts = [
      ['PUT', `/api/seller/products/${theirs.id}`, await zzProduct('ZZ Stolen Bottle', { price: '1' })],
      ['POST', `/api/seller/products/${theirs.id}/stock/remove`, { amount: 1 }],
      ['POST', `/api/seller/products/${theirs.id}/stock/add`, { amount: 1 }],
      ['POST', `/api/seller/products/${theirs.id}/switch-off`, undefined],
      ['DELETE', `/api/seller/products/${theirs.id}`, undefined],
    ];
    for (const [method, url, body] of attempts) {
      const answer = await pantry.call(method, url, body);
      expect(answer.status === 403, `seller A should get 403 on ${method} ${url} (seller B's product), got ${show(answer)}`);
    }
    expect(JSON.stringify(await productRow('Clay Water Bottle')) === JSON.stringify(theirs), "seller B's product must be unchanged");
    expect((await pantry.call('GET', '/api/admin/products')).status === 403, 'a seller should get 403 on the admin products list');
    expect((await pantry.call('POST', `/api/admin/products/${theirs.id}/hide`, { reason: 'ZZ' })).status === 403, 'a seller should get 403 on Hide');
    expect((await pantry.call('GET', '/admin/products.html')).status === 403, 'a seller should get 403 on the admin All products page');
    // Odd ways of writing a staff address must meet the same guard (they used to reach the file server directly).
    for (const trick of ['/%61dmin/products.html', '//admin/products.html', '/admin%2Fproducts.html', '/x/../admin/shops.html', '/%73eller/products.html', '/ADMIN/index.html', '/%C5%BFeller/index.html', '/%C5%BFELLER/products.js']) {
      const asVisitor = await visitor.call('GET', trick);
      expect(asVisitor.status === 302, `a visitor asking for ${trick} should be sent to the login page, got ${asVisitor.status}`);
    }
    expect((await pantry.call('GET', '/%61dmin/products.html')).status === 403, 'a seller should get 403 on an admin page written as /%61dmin/');

    const expiring = await loginAs(pantryAccount.email, pantryAccount.password);
    const token = expiring.cookie.split('=')[1];
    await db.run('UPDATE sessions SET expires_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), token);
    expect((await expiring.call('GET', '/api/me')).status === 401, 'an expired session should get 401');
  });

  await check('S5', 'The admin suspends a shop (reason needed): it leaves the home page, its shop page and product pages say not available, search drops its products, it cannot add products, and the seller sees why; Reactivate brings it all back; wrong moves are refused; its products cannot be bought, even directly, and its order already placed stays (fulfilling it: sector 5)', async () => {
    const oneId = await shopId('ZZ Test Shop One');
    const one = await loginAs('zz-one@check.test', ZZ_PASSWORD);
    const added = await one.call('POST', '/api/seller/products', await zzProduct('ZZ Suspend Check Jam'));
    expect(added.status === 201, `the approved ZZ shop should add a product, got ${show(added)}`);
    const jamId = added.data.id;
    expect((await newBrowser().call('GET', '/api/store/zz-test-shop-one')).status === 200, 'before suspending, the shop page should work');
    const placedBefore = await placeOrder([{ product_id: jamId, quantity: 1 }]);
    expect(placedBefore.answer.status === 201, `before suspending, its product can be bought, got ${show(placedBefore.answer)}`);

    const noReason = await state.admin.call('POST', `/api/admin/shops/${oneId}/suspend`, {});
    expect(noReason.status === 400, `suspend without a reason should be refused, got ${show(noReason)}`);
    const suspend = await state.admin.call('POST', `/api/admin/shops/${oneId}/suspend`, { reason: 'ZZ check: late deliveries' });
    expect(suspend.status === 200, `suspend with a reason should work, got ${show(suspend)}`);
    expect(!(await homePageShops()).includes('ZZ Test Shop One'), 'a suspended shop should leave the home page');
    const suspendedTab = await state.admin.call('GET', '/api/admin/shops?tab=suspended');
    expect(suspendedTab.data.shops.some((shop) => shop.id === oneId), 'the shop should be in the Suspended tab');
    const storePage = await newBrowser().call('GET', '/api/store/zz-test-shop-one');
    expect(storePage.status === 404 && storePage.data.error === 'This shop is not available.', `a suspended shop's page should say it is not available, got ${show(storePage)}`);
    expect((await newBrowser().call('GET', `/api/products/${jamId}`)).status === 404, "a suspended shop's product page should say it is not available");
    expect(!(await searchNames({ search: 'Suspend Check' })).includes('ZZ Suspend Check Jam'), "search should not find a suspended shop's products");
    expect((await one.call('POST', '/api/seller/products', await zzProduct('ZZ While Suspended'))).status === 403, 'a suspended shop cannot add products');
    expect((await one.call('GET', '/api/seller/products')).status === 200, 'a suspended seller can still look at their products');
    const buySuspended = await placeOrder([{ product_id: jamId, quantity: 1 }]);
    expect(buySuspended.answer.status === 400 && /shop is not available/.test(buySuspended.answer.data.error),
      `a suspended shop's product cannot be bought, even directly, got ${show(buySuspended.answer)}`);
    const oldOrder = await trackOrder(placedBefore.token);
    expect(oldOrder.status === 200 && oldOrder.data.parts[0].status === 'placed', 'the order placed before suspending is still there and still placed');

    const me = await one.call('GET', '/api/me');
    expect(me.data.shop.status === 'suspended' && me.data.shop.status_reason === 'ZZ check: late deliveries',
      `the seller should see that the shop is suspended and why, got ${show(me)}`);

    const wrongMoves = [
      [`/api/admin/shops/${oneId}/approve`, {}, 400, 'Approve on a suspended shop'],
      [`/api/admin/shops/${await shopId('Brass Bell Crafts')}/reactivate`, {}, 400, 'Reactivate on a pending shop'],
      [`/api/admin/shops/${await shopId('Chilli Lane Pantry')}/reject`, { reason: 'ZZ' }, 400, 'Reject on an active shop'],
      [`/api/admin/shops/${oneId}/delete`, {}, 404, 'an action that does not exist'],
      ['/api/admin/shops/99999/approve', {}, 404, 'a shop that does not exist'],
    ];
    for (const [url, body, status, what] of wrongMoves) {
      const answer = await state.admin.call('POST', url, body);
      expect(answer.status === status && answer.data.error, `${what} should be refused with ${status}, got ${show(answer)}`);
    }

    const reactivate = await state.admin.call('POST', `/api/admin/shops/${oneId}/reactivate`, {});
    expect(reactivate.status === 200, `reactivate should work, got ${show(reactivate)}`);
    expect((await homePageShops()).includes('ZZ Test Shop One'), 'a reactivated shop should be back on the home page');
    const after = await one.call('GET', '/api/me');
    expect(after.data.shop.status === 'active' && after.data.shop.status_reason === null, 'after Reactivate the shop should be active with no reason');
    expect((await newBrowser().call('GET', `/api/products/${jamId}`)).status === 200, 'after Reactivate its products are back');
  });

  await check('P1', 'A seller adds a product with a name, category, price (typed in rupees, saved as paise) and stock: it shows on their storefront, in its category and in search; bad product forms are refused with a clear message', async () => {
    const pantryAccount = demo('Chilli Lane Pantry');
    state.pantry = await loginAs(pantryAccount.email, pantryAccount.password);
    const added = await state.pantry.call('POST', '/api/seller/products',
      await zzProduct('ZZ Ghost Pepper Jam', { price: '199.50', emoji: '🍓', stock: 12, low_stock_level: 3 }));
    expect(added.status === 201, `adding a product should work, got ${show(added)}`);
    state.jamId = added.data.id;
    const saved = await productRow('ZZ Ghost Pepper Jam');
    expect(saved.price === 19950 && saved.stock === 12 && saved.seller_id === await shopId('Chilli Lane Pantry'),
      `it should be saved with price 19950 paise and stock 12, found ${JSON.stringify(saved)}`);
    const store = await storeProducts('chilli-lane-pantry');
    expect(store.some((p) => p.name === 'ZZ Ghost Pepper Jam' && p.price === 19950), 'it should show on the storefront');
    expect((await searchNames({ category: String(await categoryId('Food and spices')) })).includes('ZZ Ghost Pepper Jam'), 'it should show in its category');
    expect((await searchNames({ search: 'ghost PEPP' })).includes('ZZ Ghost Pepper Jam'), 'search should find it by part of its name');
    expect((await newBrowser().call('GET', `/api/products/${state.jamId}`)).status === 200, 'its product page should work');

    const badForms = [
      [{ name: '' }, 'name'],
      [{ name: 'Z' }, 'name'],
      [{ category_id: 99999 }, 'category'],
      [{ category_id: '' }, 'category'],
      [{ price: 'abc' }, 'Price'],
      [{ price: '0' }, 'Price'],
      [{ price: '-5' }, 'Price'],
      [{ price: '1.234' }, 'Price'],
      [{ price: '10000001' }, 'Price'],
      [{ stock: -1 }, 'Stock'],
      [{ stock: 1.5 }, 'Stock'],
      [{ stock: '' }, 'Stock'],
      [{ low_stock_level: 'x' }, 'Low-stock'],
      [{ description: 'x'.repeat(501) }, 'Description'],
    ];
    for (const [change, word] of badForms) {
      const answer = await state.pantry.call('POST', '/api/seller/products', await zzProduct('ZZ Bad Product', change));
      expect(answer.status === 400 && String(answer.data.error).includes(word),
        `a product with ${JSON.stringify(change).slice(0, 60)} should be refused with a message about "${word}", got ${show(answer)}`);
    }
    expect((await count("SELECT COUNT(*) AS n FROM products WHERE name = 'ZZ Bad Product'")) === 0, 'a refused product must not be saved');
  });

  await check('P2', 'A seller changes a price: the storefront and the product page show the new price, the stock stays the same, and an order placed before keeps the old price', async () => {
    const before = await placeOrder([{ product_id: state.jamId, quantity: 1 }]);
    expect(before.answer.status === 201, `an order at the old price (Rs 199.50) should work, got ${show(before.answer)}`);
    state.jamOrderToken = before.token;
    const edit = await state.pantry.call('PUT', `/api/seller/products/${state.jamId}`, await zzProduct('ZZ Ghost Pepper Jam', { price: '210', emoji: '🍓' }));
    expect(edit.status === 200, `the edit should work, got ${show(edit)}`);
    const store = await storeProducts('chilli-lane-pantry');
    expect(store.find((p) => p.id === state.jamId).price === 21000, 'the storefront should show the new price, Rs 210');
    const page = await newBrowser().call('GET', `/api/products/${state.jamId}`);
    expect(page.data.product.price === 21000, 'the product page should show the new price');
    expect((await productRow('ZZ Ghost Pepper Jam')).stock === 11, 'editing must not change the stock (12, minus the 1 ordered)');
    const item = (await trackOrder(state.jamOrderToken)).data.parts[0].items[0];
    expect(item.name === 'ZZ Ghost Pepper Jam' && item.unit_price === 19950 && item.line_total === 19950,
      `the old order should keep the old price, Rs 199.50, got ${JSON.stringify(item)}`);
  });

  await check('P3', 'A switched-off or deleted product leaves the storefront, search and its product page, and cannot be bought, even by calling the server directly; a deleted product stays in the database, and old orders still show its name', async () => {
    const off = await state.pantry.call('POST', `/api/seller/products/${state.jamId}/switch-off`);
    expect(off.status === 200, `Switch off should work, got ${show(off)}`);
    const buyOff = await placeOrder([{ product_id: state.jamId, quantity: 1 }]);
    expect(buyOff.answer.status === 400 && /ZZ Ghost Pepper Jam is not for sale/.test(buyOff.answer.data.error),
      `a switched-off product cannot be bought, even directly, got ${show(buyOff.answer)}`);
    expect(!(await storeProducts('chilli-lane-pantry')).some((p) => p.id === state.jamId), 'a switched-off product should leave the storefront');
    expect(!(await searchNames({ search: 'Ghost Pepper' })).includes('ZZ Ghost Pepper Jam'), 'a switched-off product should leave search');
    expect((await newBrowser().call('GET', `/api/products/${state.jamId}`)).status === 404, "a switched-off product's page should say it is not available");
    expect(!(await storeProducts('handloom-nook')).some((p) => p.name === 'Woollen Shawl'), 'the sample switched-off Woollen Shawl should not show');
    const sellerList = await state.pantry.call('GET', '/api/seller/products');
    expect(sellerList.data.products.some((p) => p.id === state.jamId && p.active === 0), 'the seller should still see it, switched off');
    const on = await state.pantry.call('POST', `/api/seller/products/${state.jamId}/switch-on`);
    expect(on.status === 200 && (await storeProducts('chilli-lane-pantry')).some((p) => p.id === state.jamId), 'Switch on should bring it back');

    const removed = await state.pantry.call('DELETE', `/api/seller/products/${state.jamId}`);
    expect(removed.status === 200, `Delete should work, got ${show(removed)}`);
    expect(!(await storeProducts('chilli-lane-pantry')).some((p) => p.id === state.jamId), 'a deleted product should leave the storefront');
    expect((await newBrowser().call('GET', `/api/products/${state.jamId}`)).status === 404, "a deleted product's page should say it is not available");
    expect(!(await state.pantry.call('GET', '/api/seller/products')).data.products.some((p) => p.id === state.jamId), 'a deleted product should leave the seller list');
    const row = await productRow('ZZ Ghost Pepper Jam');
    expect(row && row.deleted === 1 && row.name === 'ZZ Ghost Pepper Jam', 'a deleted product must stay in the database with its name');
    const editDeleted = await state.pantry.call('PUT', `/api/seller/products/${state.jamId}`, await zzProduct('ZZ Ghost Pepper Jam'));
    expect(editDeleted.status === 404, `a deleted product cannot be edited, got ${show(editDeleted)}`);
    const buyDeleted = await placeOrder([{ product_id: state.jamId, quantity: 1 }]);
    expect(buyDeleted.answer.status === 400 && /ZZ Ghost Pepper Jam is not sold any more/.test(buyDeleted.answer.data.error),
      `a deleted product cannot be bought, even directly, got ${show(buyDeleted.answer)}`);
    const oldItem = (await trackOrder(state.jamOrderToken)).data.parts[0].items[0];
    expect(oldItem.name === 'ZZ Ghost Pepper Jam', 'the old order should still show the deleted product\'s name');
  });

  await check('STOCK', 'Stock + and - change it by the amount; it never goes below 0, even with 10 clicks at the same moment; with 0 stock the product shows Sold out and leaves search; bad amounts are refused', async () => {
    const added = await state.pantry.call('POST', '/api/seller/products', await zzProduct('ZZ Stock Check Salt', { stock: 12, low_stock_level: 2 }));
    expect(added.status === 201, `adding the test product should work, got ${show(added)}`);
    const saltId = added.data.id;
    const plus = await state.pantry.call('POST', `/api/seller/products/${saltId}/stock/add`, { amount: 5 });
    expect(plus.status === 200 && plus.data.stock === 17, `+5 on 12 should give 17, got ${show(plus)}`);
    const tooMany = await state.pantry.call('POST', `/api/seller/products/${saltId}/stock/remove`, { amount: 20 });
    expect(tooMany.status === 400 && /Only 17/.test(tooMany.data.error), `taking away 20 of 17 should be refused with a clear message, got ${show(tooMany)}`);
    for (const amount of [0, -3, 2.5, 'abc', '', null, [2]]) {
      const answer = await state.pantry.call('POST', `/api/seller/products/${saltId}/stock/remove`, { amount });
      expect(answer.status === 400, `amount ${JSON.stringify(amount)} should be refused, got ${show(answer)}`);
    }
    // 10 clicks of -2 at the same moment on a stock of 17: exactly 8 work, 2 are refused, and the stock ends at 1.
    const answers = await Promise.all(Array.from({ length: 10 }, () =>
      state.pantry.call('POST', `/api/seller/products/${saltId}/stock/remove`, { amount: 2 })));
    const worked = answers.filter((answer) => answer.status === 200).length;
    const stockNow = (await productRow('ZZ Stock Check Salt')).stock;
    expect(worked === 8 && stockNow === 1, `10 x -2 on 17 should give 8 successes and stock 1, got ${worked} and ${stockNow}`);
    await state.pantry.call('POST', `/api/seller/products/${saltId}/stock/remove`, { amount: 1 });
    expect((await productRow('ZZ Stock Check Salt')).stock === 0, 'the stock should be exactly 0, never below');
    expect((await storeProducts('chilli-lane-pantry')).find((p) => p.id === saltId).sold_out === true, 'with 0 stock the storefront should mark it Sold out');
    expect(!(await searchNames({ search: 'Stock Check Salt' })).includes('ZZ Stock Check Salt'), 'with 0 stock it should leave search');
  });

  await check('P5', 'A product at or below its low-stock level shows LOW on the seller products page (exactly at the level counts), and the admin gets the LOW count across all shops (dashboards: sector 7)', async () => {
    const list = (await state.pantry.call('GET', '/api/seller/products')).data;
    const byName = (name) => list.products.find((p) => p.name === name);
    expect(byName('Green Chilli Pickle').low === true, 'Green Chilli Pickle (3, low at 5) should be LOW');
    expect(byName('Hot Chilli Sauce').low === false, 'Hot Chilli Sauce (18, low at 5) should not be LOW');
    expect(list.low_count === list.products.filter((p) => p.stock <= p.low_stock_level).length, 'low_count should match the LOW products');
    const saltId = await productId('ZZ Stock Check Salt');
    await state.pantry.call('POST', `/api/seller/products/${saltId}/stock/add`, { amount: 2 }); // 0 -> 2, its low level is 2
    const salt = (await state.pantry.call('GET', '/api/seller/products')).data.products.find((p) => p.id === saltId);
    expect(salt.stock === 2 && salt.low === true, 'stock exactly at the low-stock level should be LOW');
    const lowInDatabase = await count('SELECT COUNT(*) AS n FROM products WHERE deleted = 0 AND stock <= low_stock_level');
    const adminList = await state.admin.call('GET', '/api/admin/products');
    expect(adminList.data.counts.low === lowInDatabase, `the admin should get ${lowInDatabase} LOW products across all shops, got ${adminList.data.counts.low}`);
  });

  await check('C1', 'The home page lists only active shops and the categories; search finds a product by part of its name, in any letter case, and only shows products that can be bought', async () => {
    const categories = (await newBrowser().call('GET', '/api/categories')).data.categories;
    expect(categories.length === 22 && categories.every((c) => Number.isInteger(c.product_count)), 'the 22 categories should be listed, each with a count');
    const shops = await homePageShops();
    expect(shops.includes('Chilli Lane Pantry') && !shops.includes('Brass Bell Crafts') && !shops.includes('ZZ Test Shop Two'), 'only active shops should be listed');
    const chilli = await searchNames({ search: 'CHILLI' });
    expect(chilli.includes('Green Chilli Pickle') && chilli.includes('Hot Chilli Sauce'), 'search should find products by part of the name, in any letter case');
    expect(!chilli.includes('Chilli Pickle Gift Box'), 'a sold-out product should not be in search results');
    expect((await searchNames({ search: 'Shawl' })).length === 0, 'a switched-off product should not be in search results');
    expect((await searchNames({ search: '%' })).length === 0 && (await searchNames({ search: '_' })).length === 0, '% and _ should be searched as plain characters');
    const creme = await state.pantry.call('POST', '/api/seller/products', await zzProduct('ZZ Crème Brûlée Jam'));
    expect(creme.status === 201, `adding the accented test product should work, got ${show(creme)}`);
    expect((await searchNames({ search: 'CRÈME' })).includes('ZZ Crème Brûlée Jam') && (await searchNames({ search: 'brûlée' })).includes('ZZ Crème Brûlée Jam'),
      'search should ignore letter case in every alphabet (CRÈME finds Crème)');
    const unknown = await newBrowser().call('GET', '/api/products?category=99999');
    expect(unknown.status === 404, `an unknown category should say it does not exist, got ${show(unknown)}`);
  });

  await check('C2', '/store/<slug> shows only that shop\'s products customers may see (sold out marked; no switched-off, deleted or hidden ones; no stock numbers or phones); a pending, rejected or unknown shop says "This shop is not available"', async () => {
    const handloom = await storeProducts('handloom-nook');
    const handloomVisible = await count("SELECT COUNT(*) AS n FROM products JOIN sellers ON sellers.id = products.seller_id WHERE sellers.slug = 'handloom-nook' AND products.active = 1 AND products.deleted = 0 AND products.hidden = 0");
    expect(handloom.length === handloomVisible && handloomVisible >= 15 && handloom.every((p) => p.shop_slug === 'handloom-nook'), `Handloom Nook should show its ${handloomVisible} products customers may see, found ${handloom.length}`);
    expect(!handloom.some((p) => p.name === 'Woollen Shawl'), 'the switched-off Woollen Shawl should not show');
    const pantry = await storeProducts('chilli-lane-pantry');
    expect(pantry.find((p) => p.name === 'Chilli Pickle Gift Box').sold_out === true, 'the Gift Box (0 stock) should be marked Sold out');
    expect(!pantry.some((p) => p.name === 'ZZ Ghost Pepper Jam'), 'the deleted product should not show');
    expect(!JSON.stringify(pantry).includes('"stock"') && !JSON.stringify(pantry).includes('9000000'), 'customers should not get stock numbers or phone numbers');
    for (const slug of ['brass-bell-crafts', 'zz-test-shop-two', 'no-such-shop']) {
      const answer = await newBrowser().call('GET', '/api/store/' + slug);
      expect(answer.status === 404 && answer.data.error === 'This shop is not available.', `${slug} should say "This shop is not available.", got ${show(answer)}`);
    }
    const page = await newBrowser().call('GET', '/store/brass-bell-crafts');
    expect(page.status === 404 && String(page.data).includes('This shop is not available'), 'the /store/<slug> page should be served, with the "not available" text in it');
  });

  await check('HIDE', 'The admin searches all products and hides one (reason needed): it leaves the storefront, search and its page; the seller sees why and cannot switch it back on; Unhide brings it back; the admin cannot change prices', async () => {
    const towels = await state.admin.call('GET', '/api/admin/products?search=towel');
    const names = towels.data.products.map((p) => p.name);
    expect(names.includes('Handloom Bath Towel') && names.every((name) => /towel/i.test(name)), `the admin search should find the towels, got ${names}`);
    const byShop = await state.admin.call('GET', '/api/admin/products?search=terracotta');
    const terracottaCount = await count("SELECT COUNT(*) AS n FROM products JOIN sellers ON sellers.id = products.seller_id WHERE sellers.shop_name = 'Terracotta Corner' AND products.deleted = 0");
    expect(byShop.data.products.length === terracottaCount && terracottaCount >= 18, `the admin search should also find products by shop name (all ${terracottaCount}), got ${byShop.data.products.length}`);

    const towel = await productRow('Handloom Bath Towel');
    const noReason = await state.admin.call('POST', `/api/admin/products/${towel.id}/hide`, { reason: '  ' });
    expect(noReason.status === 400, `Hide without a reason should be refused, got ${show(noReason)}`);
    const hide = await state.admin.call('POST', `/api/admin/products/${towel.id}/hide`, { reason: 'ZZ check: the photo shows a brand logo' });
    expect(hide.status === 200, `Hide should work, got ${show(hide)}`);
    expect(!(await storeProducts('handloom-nook')).some((p) => p.id === towel.id), 'a hidden product should leave the storefront');
    expect(!(await searchNames({ search: 'Bath Towel' })).includes('Handloom Bath Towel'), 'a hidden product should leave search');
    expect((await newBrowser().call('GET', `/api/products/${towel.id}`)).status === 404, "a hidden product's page should say it is not available");
    const buyHidden = await placeOrder([{ product_id: towel.id, quantity: 1 }]);
    expect(buyHidden.answer.status === 400 && /not for sale/.test(buyHidden.answer.data.error), `a hidden product cannot be bought, even directly, got ${show(buyHidden.answer)}`);

    const handloomAccount = demo('Handloom Nook');
    const handloom = await loginAs(handloomAccount.email, handloomAccount.password);
    const mine = (await handloom.call('GET', '/api/seller/products')).data.products.find((p) => p.id === towel.id);
    expect(mine.hidden === 1 && mine.hidden_reason === 'ZZ check: the photo shows a brand logo', 'the seller should see that it is hidden, and why');
    await handloom.call('POST', `/api/seller/products/${towel.id}/switch-off`);
    const switchOn = await handloom.call('POST', `/api/seller/products/${towel.id}/switch-on`);
    expect(switchOn.status === 403 && (await productRow('Handloom Bath Towel')).active === 0, `the seller must not switch a hidden product back on, got ${show(switchOn)}`);

    const priceChange = await state.admin.call('PUT', `/api/seller/products/${towel.id}`, await zzProduct('Handloom Bath Towel', { price: '1' }));
    expect(priceChange.status === 403 && (await productRow('Handloom Bath Towel')).price === towel.price, `the admin must not change a price (403), got ${show(priceChange)}`);
    expect((await state.admin.call('PUT', `/api/admin/products/${towel.id}`, { price: '1' })).status === 404, 'there must be no admin route that changes a product');

    const unhide = await state.admin.call('POST', `/api/admin/products/${towel.id}/unhide`);
    expect(unhide.status === 200 && (await productRow('Handloom Bath Towel')).hidden === 0, `Unhide should work, got ${show(unhide)}`);
    await handloom.call('POST', `/api/seller/products/${towel.id}/switch-on`);
    expect((await storeProducts('handloom-nook')).some((p) => p.id === towel.id), 'after Unhide and Switch on, the towel is back on the storefront');
  });

  await check('C3', 'A cart from 2 shops is grouped by shop, each with its shipping fee (free only ABOVE that shop\'s limit), and the right grand total; checkout charges the same total, and a total or price sent by the browser is ignored', async () => {
    const cart = [await cartLine('Hot Chilli Sauce', 1), await cartLine('Red Chilli Garlic Chutney', 1), await cartLine('Clay Tea Cups (set of 4)', 3)];
    const priced = await newBrowser().call('POST', '/api/cart', { items: cart });
    expect(priced.status === 200 && priced.data.groups.length === 2 && priced.data.problems.length === 0, `the cart should have 2 shop groups, got ${show(priced)}`);
    const [pantry, terracotta] = priced.data.groups;
    // By hand: Chilli Lane Pantry Rs 220 + Rs 150 = Rs 370, not over its Rs 499 limit, so Rs 40 shipping: Rs 410.
    //          Terracotta Corner 3 x Rs 380 = Rs 1,140, over its Rs 999 limit, so free shipping: Rs 1,140.
    //          Grand total Rs 1,550.
    expect(pantry.shop_name === 'Chilli Lane Pantry' && pantry.items_total === 37000 && pantry.shipping === 4000 && pantry.total === 41000,
      `Chilli Lane Pantry should be Rs 370 + Rs 40 = Rs 410, got ${JSON.stringify(pantry).slice(0, 200)}`);
    expect(terracotta.shop_name === 'Terracotta Corner' && terracotta.items_total === 114000 && terracotta.shipping === 0 && terracotta.total === 114000,
      `Terracotta Corner should be Rs 1,140 with free shipping, got ${JSON.stringify(terracotta).slice(0, 200)}`);
    expect(priced.data.items_total === 151000 && priced.data.shipping_total === 4000 && priced.data.grand_total === 155000,
      `the grand total should be Rs 1,550, got ${priced.data.grand_total}`);
    // Free shipping only ABOVE the limit: exactly Rs 499 still pays Rs 40, Rs 499.01 ships free.
    await state.pantry.call('POST', '/api/seller/products', await zzProduct('ZZ Limit 499 Paste', { price: '499' }));
    await state.pantry.call('POST', '/api/seller/products', await zzProduct('ZZ Limit 499.01 Paste', { price: '499.01' }));
    const atLimit = await newBrowser().call('POST', '/api/cart', { items: [await cartLine('ZZ Limit 499 Paste', 1)] });
    const overLimit = await newBrowser().call('POST', '/api/cart', { items: [await cartLine('ZZ Limit 499.01 Paste', 1)] });
    expect(atLimit.data.groups[0].shipping === 4000, 'exactly Rs 499 (the limit itself) should still pay Rs 40 shipping');
    expect(overLimit.data.groups[0].shipping === 0, 'Rs 499.01 (above the limit) should ship free');
    // Checkout: the same total, whatever the browser says the total or the prices are.
    const fakeCart = cart.map((line) => ({ ...line, price: 1, unit_price: 1 }));
    const order = await placeOrder(fakeCart, { total: 100, grand_total: 100, shipping_total: 0 });
    expect(order.answer.status === 201 && order.answer.data.grand_total === 155000, `checkout should charge Rs 1,550 whatever the browser says, got ${show(order.answer)}`);
    const saved = await db.get('SELECT * FROM customer_orders WHERE tracking_token = ?', order.token);
    expect(saved.items_total === 151000 && saved.shipping_total === 4000 && saved.grand_total === 155000, 'the saved order should have the server\'s totals');
    state.twoShopOrder = order;
  });

  await check('C4', 'An empty cart, a bad phone, a bad email, a missing name or address, a quantity outside 1 to 20 and a payment that is not offered are refused with a clear message, and nothing is saved or taken from stock', async () => {
    const ordersBefore = await count('SELECT COUNT(*) AS n FROM customer_orders');
    const stockBefore = await stockOf('Hot Chilli Sauce');
    const good = [await cartLine('Hot Chilli Sauce', 1)];
    const badForms = [
      [zzCheckout([]), 'empty'],
      [zzCheckout(good, { phone: '12345' }), 'Phone'],
      [zzCheckout(good, { email: 'not-an-email' }), 'email'],
      [zzCheckout(good, { address: '' }), 'address'],
      [zzCheckout(good, { customer_name: ' ' }), 'name'],
      [zzCheckout([await cartLine('Hot Chilli Sauce', 99)]), 'Quantity'],
      [zzCheckout([await cartLine('Hot Chilli Sauce', 0)]), 'Quantity'],
      [zzCheckout([await cartLine('Hot Chilli Sauce', 1.5)]), 'Quantity'],
      [zzCheckout([{ product_id: 'abc', quantity: 1 }]), 'not valid'],
      [zzCheckout(good, { phone_token: 'not-the-right-token' }), 'check your phone'],
      [zzCheckout(good, { payment_method: 'bitcoin' }), 'pay'],
    ];
    for (const [form, word] of badForms) {
      const answer = await newBrowser().call('POST', '/api/checkout', form);
      expect(answer.status === 400 && String(answer.data.error).includes(word),
        `${JSON.stringify(form).slice(0, 100)} should be refused with a message about "${word}", got ${show(answer)}`);
    }
    expect((await count('SELECT COUNT(*) AS n FROM customer_orders')) === ordersBefore, 'a refused checkout must not save an order');
    expect((await stockOf('Hot Chilli Sauce')) === stockBefore, 'a refused checkout must not take any stock');
  });

  await check('C5', 'Checking out a 2-shop cart makes one customer order with 2 seller orders, a code like BZ-1001 and a private tracking link; tracking shows each part with its status and every earlier status with its time, the delivery address but no phone or email; a wrong or missing token shows "Order not found"', async () => {
    const { answer, token } = state.twoShopOrder;
    expect(/^BZ-\d{4,}$/.test(answer.data.code) && /^\/track\/[a-f0-9]{64}$/.test(answer.data.tracking_url), `a code like BZ-1001 and a long private link, got ${show(answer)}`);
    const order = await db.get('SELECT * FROM customer_orders WHERE tracking_token = ?', token);
    const parts = await db.all('SELECT * FROM seller_orders WHERE customer_order_id = ?', order.id);
    expect(parts.length === 2 && new Set(parts.map((p) => p.seller_id)).size === 2, 'one customer order with 2 seller orders, one per shop');
    const tracked = await trackOrder(token);
    expect(tracked.status === 200 && tracked.data.order.code === answer.data.code && tracked.data.parts.length === 2, `tracking should show the order and both parts, got ${show(tracked).slice(0, 200)}`);
    for (const part of tracked.data.parts) {
      expect(part.status === 'placed' && part.history.length === 1 && part.history[0].status === 'placed' && !Number.isNaN(Date.parse(part.history[0].at)),
        `each part should be placed, with its history and time, got ${JSON.stringify(part).slice(0, 200)}`);
    }
    const text = JSON.stringify(tracked.data);
    expect(!text.includes('9000000990') && !text.includes('zz-customer@check.test'), 'tracking must not show the phone or email');
    expect(tracked.data.order.address.includes('ZZ Check Street'), 'the tracking page (also the thank-you page) shows the delivery address');
    for (const wrong of ['a'.repeat(64), token.slice(0, 63), token.toUpperCase(), 'not-a-token']) {
      const notFound = await newBrowser().call('GET', '/api/track/' + wrong);
      expect(notFound.status === 404 && notFound.data.error === 'Order not found.', `a wrong token should give "Order not found.", got ${show(notFound)}`);
    }
    const page = await newBrowser().call('GET', '/track/' + 'b'.repeat(64));
    expect(page.status === 200 && String(page.data).includes('Order not found'), 'the tracking page itself should be served, with "Order not found" in it');
    const noToken = await newBrowser().call('GET', '/track');
    expect(noToken.status === 200 && String(noToken.data).includes('Order not found'), 'the tracking page without a token should be served too');
  });

  await check('P4', 'Placing an order takes the items off the stock; more than is in stock is refused, naming the product; 20 orders at the same moment for the last 5 give exactly 5 orders and stock 0, never below; a cart with one sold-out product changes nothing', async () => {
    const before = await stockOf('Hot Chilli Sauce');
    const order = await placeOrder([await cartLine('Hot Chilli Sauce', 2)]);
    expect(order.answer.status === 201 && (await stockOf('Hot Chilli Sauce')) === before - 2, `the order should take 2 off the stock, got ${show(order.answer)}`);
    const tooMany = await placeOrder([await cartLine('Hot Chilli Sauce', 20)]);
    expect(tooMany.answer.status === 400 && /^Only \d+ of Hot Chilli Sauce left/.test(tooMany.answer.data.error), `more than is in stock should be refused, naming the product, got ${show(tooMany.answer)}`);
    await state.pantry.call('POST', '/api/seller/products', await zzProduct('ZZ Last Five Jar', { stock: 5, low_stock_level: 1 }));
    const ordersBefore = await count('SELECT COUNT(*) AS n FROM customer_orders');
    const lastFiveLine = await cartLine('ZZ Last Five Jar', 1);
    const answers = await Promise.all(Array.from({ length: 20 }, () => placeOrder([lastFiveLine])));
    const worked = answers.filter((a) => a.answer.status === 201).length;
    const refused = answers.filter((a) => a.answer.status === 400 && /ZZ Last Five Jar is sold out/.test(a.answer.data.error)).length;
    expect(worked === 5 && refused === 15 && (await stockOf('ZZ Last Five Jar')) === 0,
      `20 orders at once for the last 5: exactly 5 should succeed and the stock end at 0, got ${worked} worked, ${refused} refused, stock ${await stockOf('ZZ Last Five Jar')}`);
    expect((await count('SELECT COUNT(*) AS n FROM customer_orders')) === ordersBefore + 5, 'exactly 5 new orders should be saved');
    const chutneyBefore = await stockOf('Red Chilli Garlic Chutney');
    const mixed = await placeOrder([await cartLine('Red Chilli Garlic Chutney', 1), await cartLine('ZZ Last Five Jar', 1)]);
    expect(mixed.answer.status === 400 && (await stockOf('Red Chilli Garlic Chutney')) === chutneyBefore, 'a cart with one sold-out product must take no stock at all');
    expect((await count('SELECT COUNT(*) AS n FROM products WHERE stock < 0')) === 0, 'no product may have stock below 0');
  });

  await check('M1', 'The commission rate is the shop\'s own rate if set, else its category\'s rate (the category most of its products are in), else the default; it is copied into the seller order with the commission, and changing a rate later does not change old orders', async () => {
    const parts = await partsOfToken(state.twoShopOrder.token);
    const terracotta = parts.find((p) => p.shop_name === 'Terracotta Corner');
    const pantry = parts.find((p) => p.shop_name === 'Chilli Lane Pantry');
    expect(terracotta.commission_bps === 900 && terracotta.commission === 10260, `Terracotta Corner's own 9% of Rs 1,140 = Rs 102.60, got ${terracotta.commission_bps} and ${terracotta.commission}`);
    expect(pantry.commission_bps === 800 && pantry.commission === 2960, `Chilli Lane Pantry (Food and spices, 8%) of Rs 370 = Rs 29.60, got ${pantry.commission_bps} and ${pantry.commission}`);
    const handloom = await placeOrder([await cartLine('Cotton Tote Bag', 1)]); // a Gifts product, but most of the shop is Clothing
    const handloomPart = (await partsOfToken(handloom.token))[0];
    expect(handloomPart.commission_bps === 1200 && handloomPart.commission === 3360, `Handloom Nook's category is Clothing (12%): Rs 33.60 on Rs 280, got ${handloomPart.commission_bps} and ${handloomPart.commission}`);
    await db.run("INSERT INTO categories (name, commission_bps) VALUES ('ZZ No Rate', NULL)");
    const shop = await signUpShop('ZZ Default Rate Shop', 'zz-default@check.test', '9000000905');
    await state.admin.call('POST', `/api/admin/shops/${await shopId('ZZ Default Rate Shop')}/approve`, {});
    const soap = await shop.call('POST', '/api/seller/products', await zzProduct('ZZ Default Rate Soap', { category_id: await categoryId('ZZ No Rate') }));
    expect(soap.status === 201, `the ZZ shop should add its product, got ${show(soap)}`);
    const defaultOrder = await placeOrder([await cartLine('ZZ Default Rate Soap', 1)]);
    expect((await partsOfToken(defaultOrder.token))[0].commission_bps === 1000, 'a shop with no own rate and no category rate should get the default 10%');
    await db.run("UPDATE categories SET commission_bps = 2000 WHERE name = 'Food and spices'");
    const newOrder = await placeOrder([await cartLine('Hot Chilli Sauce', 1)]);
    const oldPart = (await partsOfToken(state.twoShopOrder.token)).find((p) => p.shop_name === 'Chilli Lane Pantry');
    await db.run("UPDATE categories SET commission_bps = 800 WHERE name = 'Food and spices'"); // put the rate back
    expect(oldPart.commission_bps === 800 && oldPart.commission === 2960, 'an old order must keep its rate and its commission');
    expect((await partsOfToken(newOrder.token))[0].commission_bps === 2000, 'a new order should get the new rate');
  });

  await check('P6', 'Cancelling a placed part from the tracking link puts exactly its items back in stock, only once; the other shop\'s part is not touched; another order\'s part cannot be cancelled with this link', async () => {
    const oilBefore = await stockOf('Smoky Chilli Oil');
    const planterBefore = await stockOf('Clay Planter');
    const order = await placeOrder([await cartLine('Smoky Chilli Oil', 2), await cartLine('Clay Planter', 1)]);
    expect(order.answer.status === 201 && (await stockOf('Smoky Chilli Oil')) === oilBefore - 2 && (await stockOf('Clay Planter')) === planterBefore - 1, 'the order should take the stock off');
    state.cancelOrder = order;
    const pantryPart = (await trackOrder(order.token)).data.parts.find((p) => p.shop_name === 'Chilli Lane Pantry');
    const cancel = await newBrowser().call('POST', `/api/track/${order.token}/parts/${pantryPart.id}/cancel`);
    expect(cancel.status === 200, `cancelling a placed part should work, got ${show(cancel)}`);
    expect((await stockOf('Smoky Chilli Oil')) === oilBefore, 'its 2 items should be back in stock');
    expect((await stockOf('Clay Planter')) === planterBefore - 1, "the other shop's part must not change");
    const again = await newBrowser().call('POST', `/api/track/${order.token}/parts/${pantryPart.id}/cancel`);
    expect(again.status === 400 && (await stockOf('Smoky Chilli Oil')) === oilBefore, `a second cancel is refused and gives nothing back twice, got ${show(again)}`);
    const after = (await trackOrder(order.token)).data.parts;
    const cancelled = after.find((p) => p.id === pantryPart.id);
    const other = after.find((p) => p.id !== pantryPart.id);
    expect(cancelled.status === 'cancelled' && cancelled.reason === 'Cancelled by the customer.' && !cancelled.can_cancel
      && cancelled.history.map((h) => h.status).join(',') === 'placed,cancelled', `the part should show cancelled, the reason and its history, got ${JSON.stringify(cancelled).slice(0, 200)}`);
    expect(other.status === 'placed' && other.can_cancel === true, "the other shop's part should still be placed");
    const foreignPart = (await partsOfToken(state.twoShopOrder.token))[0];
    const wrong = await newBrowser().call('POST', `/api/track/${order.token}/parts/${foreignPart.id}/cancel`);
    expect(wrong.status === 404 && (await partsOfToken(state.twoShopOrder.token))[0].status === 'placed', `a part of another order cannot be cancelled with this link, got ${show(wrong)}`);
  });

  await check('F4', 'The customer can cancel a part from the tracking link while it is placed (P6), but not after the shop accepted it', async () => {
    const { changeStatus } = require('./orderStatus');
    const terracottaPart = (await trackOrder(state.cancelOrder.token)).data.parts.find((p) => p.shop_name === 'Terracotta Corner');
    await changeStatus(terracottaPart.id, 'accepted', { role: 'seller', sellerId: await shopId('Terracotta Corner') }); // the shop accepts (its button comes in sector 5)
    const planter = await stockOf('Clay Planter');
    const cancel = await newBrowser().call('POST', `/api/track/${state.cancelOrder.token}/parts/${terracottaPart.id}/cancel`);
    expect(cancel.status === 403 && /Only the admin can cancel it now/.test(cancel.data.error), `after the shop accepted, the customer cannot cancel, got ${show(cancel)}`);
    const now = (await trackOrder(state.cancelOrder.token)).data.parts.find((p) => p.id === terracottaPart.id);
    expect(now.status === 'accepted' && now.can_cancel === false && (await stockOf('Clay Planter')) === planter, 'it stays accepted, with no Cancel button and no stock change');
  });

  await check('F3', 'The status table is exactly the one in CLAUDE.md; skipping a step or going back is refused with a clear message, whoever tries; the wrong person gets 403; moves that need a reason, courier or tracking number refuse without it; every change is logged with who and when', async () => {
    const { MOVES, changeStatus } = require('./orderStatus');
    const expected = [
      'pending_payment>placed:system', 'pending_payment>cancelled:system',
      'placed>accepted:seller', 'placed>rejected:seller', 'placed>cancelled:customer,admin',
      'accepted>packed:seller', 'accepted>cancelled:admin', 'packed>shipped:seller', 'packed>cancelled:admin',
      'shipped>delivered:seller,admin',
    ];
    const actual = MOVES.map((m) => `${m.from}>${m.to}:${m.who.join(',')}`);
    expect(JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()), `the moves should be exactly CLAUDE.md's, got ${actual.join(' | ')}`);
    const order = await placeOrder([await cartLine('Clay Diya Set (12)', 1)]);
    const part = (await partsOfToken(order.token))[0];
    const seller = { role: 'seller', sellerId: await shopId('Terracotta Corner') };
    const customer = { role: 'customer', customerOrderId: part.customer_order_id };
    const admin = { role: 'admin' };
    const tryMove = async (status, who, details) => {
      try {
        await changeStatus(part.id, status, who, details);
        return 'ok';
      } catch (error) {
        return `${error.status} ${error.message}`;
      }
    };
    for (const status of ['packed', 'shipped', 'delivered']) {
      const result = await tryMove(status, seller, { courier: 'ZZ Courier', tracking_number: 'ZZ1' });
      expect(result.startsWith('400') && result.includes('Next it can only become accepted, rejected or cancelled'), `placed straight to ${status} should be refused with a clear message, got ${result}`);
    }
    expect((await tryMove('delivered', admin)).startsWith('400'), 'the admin cannot skip steps either');
    expect((await tryMove('accepted', { role: 'seller', sellerId: await shopId('Chilli Lane Pantry') })).startsWith('403 This order belongs to another shop'), 'another shop cannot accept it');
    expect((await tryMove('accepted', admin)).startsWith('403 Only the shop can accept it'), 'the admin cannot accept for the shop');
    expect((await tryMove('accepted', customer)).startsWith('403'), 'the customer cannot accept it');
    expect((await tryMove('cancelled', seller)).startsWith('403'), 'the shop cannot cancel a placed part (it can reject it)');
    expect((await tryMove('rejected', seller, { reason: '  ' })).startsWith('400'), 'reject needs a reason');
    expect((await tryMove('accepted', seller)) === 'ok', 'the shop accepts');
    expect((await tryMove('placed', seller)).startsWith('400'), 'accepted back to placed is refused');
    expect((await tryMove('cancelled', admin, {})).startsWith('400'), 'the admin needs a reason to cancel an accepted part');
    expect((await tryMove('packed', seller)) === 'ok', 'the shop marks it packed');
    expect((await tryMove('shipped', seller, { courier: 'ZZ Courier' })).startsWith('400'), 'shipping needs a courier and a tracking number');
    expect((await tryMove('shipped', seller, { courier: 'ZZ Courier', tracking_number: 'ZZ12345' })) === 'ok', 'the shop marks it shipped');
    expect((await tryMove('packed', seller)).startsWith('400'), 'shipped back to packed is refused');
    expect((await tryMove('cancelled', admin, { reason: 'ZZ' })).startsWith('400'), 'a shipped part cannot be cancelled');
    expect((await tryMove('delivered', admin)) === 'ok', 'the admin can mark a shipped part delivered');
    expect((await tryMove('shipped', seller)).includes('finished'), 'a delivered part is finished');
    const log = await db.all('SELECT status, by_role, at FROM status_log WHERE seller_order_id = ? ORDER BY id', part.id);
    expect(log.map((l) => `${l.status}/${l.by_role}`).join(',') === 'placed/customer,accepted/seller,packed/seller,shipped/seller,delivered/admin'
      && log.every((l) => !Number.isNaN(Date.parse(l.at))), `every change should be logged with who and when, got ${JSON.stringify(log)}`);
    const tracked = (await trackOrder(order.token)).data.parts[0];
    expect(tracked.status === 'delivered' && tracked.courier === 'ZZ Courier' && tracked.tracking_number === 'ZZ12345' && tracked.history.length === 5,
      'the tracking page should show every status and the courier');
  });

  await check('Y4', 'A cash-on-delivery order is placed straight away (not paid yet); while cash on delivery is switched off, checkout is refused (Cash collected and the admin switch: sectors 4 and 5)', async () => {
    const order = await placeOrder([await cartLine('Clay Planter', 1)]);
    const part = (await partsOfToken(order.token))[0];
    expect(part.status === 'placed' && part.payment_status === 'unpaid', `a COD part should be placed straight away and not paid yet, got ${part.status} / ${part.payment_status}`);
    await db.run("UPDATE settings SET value = '0' WHERE key = 'cod_enabled'");
    const off = await placeOrder([await cartLine('Clay Planter', 1)]);
    const options = await newBrowser().call('GET', '/api/checkout/options');
    await db.run("UPDATE settings SET value = '1' WHERE key = 'cod_enabled'"); // put it back
    expect(off.answer.status === 400 && /switched off/.test(off.answer.data.error), `with COD off, checkout should be refused, got ${show(off.answer)}`);
    expect(options.data.cod_enabled === false, 'the checkout page should be told that cash on delivery is off');
  });

  await check('B1', 'Every customer page has the header with the big search box, the Categories menu and "Sell on Bazaar Lane"; the home page shows the 8 newest products and the shops with their city; every product is reached in 3 clicks or fewer', async () => {
    const kitScript = String((await newBrowser().call('GET', '/kit.js')).data);
    expect(kitScript.includes("'Sell on '") && kitScript.includes("'Categories'") && kitScript.includes("search.action = '/search'"),
      'kit.js should build the header with the search box, Categories and Sell on Bazaar Lane');
    for (const address of ['/', '/search', '/category/food-and-spices', '/store/chilli-lane-pantry', '/cart.html', '/checkout.html', '/sell', '/find-my-orders.html']) {
      const page = String((await newBrowser().call('GET', address)).data);
      expect(page.includes('data-customer-header') && page.includes('/kit.js'), `${address} should have the customer header`);
    }
    const featured = (await newBrowser().call('GET', '/api/products?sort=newest&limit=8')).data.products;
    const newest = (await db.all(`SELECT products.id FROM products JOIN sellers ON sellers.id = products.seller_id
      WHERE products.active = 1 AND products.deleted = 0 AND products.hidden = 0 AND products.stock > 0 AND sellers.status = 'active'
      ORDER BY products.created_at DESC, products.id DESC LIMIT 8`)).map((row) => row.id);
    expect(JSON.stringify(featured.map((p) => p.id)) === JSON.stringify(newest), 'the home page should get the 8 newest products that can be bought');
    const shops = (await newBrowser().call('GET', '/api/shops')).data.shops;
    expect(shops.find((shop) => shop.shop_name === 'Chilli Lane Pantry').city === 'Jaipur', 'the shops come with their city');
    // Home -> a category (Categories menu) -> a product card: 2 clicks. Home -> a shop -> a product: 2 clicks.
    const categories = (await newBrowser().call('GET', '/api/categories')).data.categories;
    const reachable = new Set();
    for (const category of categories) {
      for (const product of (await newBrowser().call('GET', `/api/products?category=${category.id}`)).data.products) reachable.add(product.id);
    }
    const buyable = await count(`SELECT COUNT(*) AS n FROM products JOIN sellers ON sellers.id = products.seller_id
      WHERE products.active = 1 AND products.deleted = 0 AND products.hidden = 0 AND products.stock > 0 AND sellers.status = 'active'`);
    expect(reachable.size === buyable, `every product that can be bought should be in a category page (2 clicks), got ${reachable.size} of ${buyable}`);
  });

  await check('B2', 'Search and category lists filter by price range, shop, city and rating and sort by newest, price and top rated; only products that can be bought appear; the filters stay in the address', async () => {
    const get = async (query) => (await newBrowser().call('GET', '/api/products?' + query)).data;
    const priced = (await get('price_min=200&price_max=400')).products;
    expect(priced.length > 0 && priced.every((p) => p.price >= 20000 && p.price <= 40000), 'the price filter keeps only ₹200 to ₹400');
    const shop = (await get('shop=terracotta-corner')).products;
    expect(shop.length > 0 && shop.every((p) => p.shop_slug === 'terracotta-corner'), 'the shop filter keeps one shop');
    const city = (await get('city=Kannur')).products;
    expect(city.length > 0 && city.every((p) => p.city === 'Kannur'), 'the city filter keeps one city');
    const low = (await get('sort=price_asc')).products.map((p) => p.price);
    const high = (await get('sort=price_desc')).products.map((p) => p.price);
    expect(low.every((price, i) => i === 0 || low[i - 1] <= price) && high.every((price, i) => i === 0 || high[i - 1] >= price), 'price sorts go up and down');
    const newest = (await get('sort=newest')).products.map((p) => p.created_at);
    expect(newest.every((at, i) => i === 0 || newest[i - 1] >= at), 'newest comes first');
    const all = (await get('')).products;
    expect(all.every((p) => !p.sold_out), 'only products that can be bought appear');
    expect((await newBrowser().call('GET', '/api/products?price_min=abc')).status === 400, 'a bad price filter is refused with a message');
    const page = await newBrowser().call('GET', '/search?search=chilli&price_max=300&sort=price_asc');
    expect(page.status === 200 && String(page.data).includes('/listing.js'), 'the search page with filters in its address should open');
    const listing = String((await newBrowser().call('GET', '/listing.js')).data);
    expect(listing.includes("form.method = 'get'") && listing.includes('location.search'), 'the filters are read from and kept in the page address');
  });

  await check('B4', 'The product page has the price, the shop with its city and rating, the stock in words, the shipping fee and free-shipping limit, a delivery estimate, the return window, reviews, related products and Add to bag; a customer opening it adds a view, staff do not', async () => {
    const pickle = await productId('Green Chilli Pickle');
    const views = async () => (await count(`SELECT COALESCE(SUM(count), 0) AS n FROM product_views WHERE product_id = ${pickle}`));
    const before = await views();
    const answer = await newBrowser().call('GET', `/api/products/${pickle}`);
    const data = answer.data;
    expect(answer.status === 200 && data.product.price === 18000 && data.shop.city === 'Jaipur' && 'rating' in data.shop,
      `the product page should have the price and the shop with its city and rating, got ${show(answer)}`);
    expect(/^(In stock|Only \d+ left|Sold out)$/.test(data.product.stock_words), `the stock in words, got ${data.product.stock_words}`);
    expect(data.shop.shipping_fee === 4000 && data.shop.free_shipping_over === 49900 && data.shop.return_days === 7, 'shipping, free-shipping limit and returns');
    expect(data.delivery.from_days === data.shop.dispatch_days + 2 && data.delivery.to_days === data.shop.dispatch_days + 5, 'the delivery estimate is dispatch days plus 2 to 5');
    expect(Array.isArray(data.reviews) && data.more_from_shop.length > 0 && data.similar.every((p) => p.category_id === data.product.category_id),
      'reviews, more from this shop and similar products (same category)');
    expect((await views()) === before + 1, 'a customer opening the page adds one view');
    await state.admin.call('GET', `/api/products/${pickle}`);
    expect((await views()) === before + 1, 'the admin opening it does not add a view');
    const moved = await newBrowser().call('GET', `/product/${pickle}`);
    expect(moved.status === 301 && moved.data !== undefined, `an old /product/<id> address moves to the clean one, got ${moved.status}`);
    const page = await newBrowser().call('GET', `/product/${pickle}-green-chilli-pickle`);
    expect(page.status === 200 && String(page.data).includes('Green Chilli Pickle by Chilli Lane Pantry | Bazaar Lane'), 'the product page has its own title');
    const script = String((await newBrowser().call('GET', '/product.js')).data);
    expect(script.includes('IK.AddToCartButton') && script.includes("tone: 'accent'"), 'Add to bag is the accent button');
  });

  await check('E1', 'Emails land in the outbox: the order confirmation (code, link, every cost), a new-order email to each shop with only its own part, a cancellation email, and shop approved or not approved; no email holds a password', async () => {
    const before = (await count('SELECT MAX(id) AS n FROM emails')) || 0;
    const order = await placeOrder([await cartLine('Smoky Chilli Oil', 1), await cartLine('Clay Planter', 1)], { email: 'zz-mail@check.test' });
    expect(order.answer.status === 201, `the order should be placed, got ${show(order.answer)}`);
    const emails = await db.all('SELECT * FROM emails WHERE id > ? ORDER BY id', before);
    const confirmation = emails.find((e) => e.to_address === 'zz-mail@check.test');
    expect(confirmation && confirmation.body.includes(order.answer.data.code) && confirmation.body.includes('/track/' + order.token)
      && confirmation.body.includes('Grand total') && confirmation.body.includes('Chilli Lane Pantry') && confirmation.body.includes('Terracotta Corner'),
      'the confirmation has the code, the tracking link, each shop and every cost');
    const toPantry = emails.find((e) => e.to_address === demo('Chilli Lane Pantry').email);
    const toTerracotta = emails.find((e) => e.to_address === demo('Terracotta Corner').email);
    expect(toPantry && toPantry.body.includes('Smoky Chilli Oil') && !toPantry.body.includes('Clay Planter') && !toPantry.body.includes('Terracotta'),
      "the pantry's new-order email has only its own part");
    expect(toTerracotta && toTerracotta.body.includes('Clay Planter') && !toTerracotta.body.includes('Smoky Chilli Oil'), "the pottery's email has only its own part");
    const pantryShopId = await shopId('Chilli Lane Pantry');
    const part = (await partsOfToken(order.token)).find((p) => p.seller_id === pantryShopId);
    await newBrowser().call('POST', `/api/track/${order.token}/parts/${part.id}/cancel`);
    const cancelled = await db.get("SELECT * FROM emails WHERE to_address = 'zz-mail@check.test' AND subject LIKE '%cancelled%'");
    expect(cancelled && cancelled.body.includes('Chilli Lane Pantry'), 'a cancellation email reaches the customer');
    const decisions = (await db.all("SELECT subject FROM emails WHERE subject LIKE '%approved%'")).map((e) => e.subject);
    expect(decisions.some((s) => s.endsWith('is approved')) && decisions.some((s) => s.endsWith('was not approved')), 'shop approved and not approved emails were sent');
    const passwords = DEMO_ACCOUNTS.map((a) => a.password).concat([ZZ_PASSWORD]);
    const all = (await db.all('SELECT body FROM emails')).map((e) => e.body).join('\n');
    expect(passwords.every((password) => !all.includes(password)), 'no email contains a password');
    const outbox = await state.admin.call('GET', '/api/admin/emails');
    expect(outbox.status === 200 && outbox.data.total === await count('SELECT COUNT(*) AS n FROM emails'), 'the admin reads the outbox');
    expect((await newBrowser().call('GET', '/api/admin/emails')).status === 401, 'a visitor cannot read the outbox');
  });

  await check('E2', '"Find my orders" emails the tracking links for that address, and answers the same whether or not orders were found', async () => {
    const before = await count('SELECT COUNT(*) AS n FROM emails');
    const known = await newBrowser().call('POST', '/api/find-my-orders', { email: 'ZZ-Mail@check.test' });
    const unknown = await newBrowser().call('POST', '/api/find-my-orders', { email: 'zz-nobody@check.test' });
    expect(known.status === 200 && JSON.stringify(known.data) === JSON.stringify(unknown.data), 'the same answer for a known and an unknown email');
    const sent = await db.get("SELECT * FROM emails WHERE to_address = 'zz-mail@check.test' ORDER BY id DESC");
    expect((await count('SELECT COUNT(*) AS n FROM emails')) === before + 1 && sent.body.includes('/track/'), 'one email with the links, none for the unknown address');
    expect((await newBrowser().call('POST', '/api/find-my-orders', { email: 'not-an-email' })).status === 400, 'a bad email is refused');
  });

  await check('SETTINGS', 'A seller sets their shop name, city, description, shipping fee, free-shipping limit, dispatch days and return window; bad values are refused; only an open shop can change them; customers see the new values', async () => {
    const one = await loginAs('zz-one@check.test', ZZ_PASSWORD);
    const good = { shop_name: 'ZZ Test Shop One', city: 'ZZ Town', description: 'ZZ test shop', shipping_fee: '45', free_shipping_over: '600', dispatch_days: '3', return_days: '10' };
    const saved = await one.call('PUT', '/api/seller/shop', good);
    expect(saved.status === 200 && saved.data.shop.city === 'ZZ Town' && saved.data.shop.shipping_fee === 4500 && saved.data.shop.free_shipping_over === 60000,
      `the settings should be saved (money in paise), got ${show(saved)}`);
    const store = await newBrowser().call('GET', '/api/store/zz-test-shop-one');
    expect(store.data.shop.city === 'ZZ Town' && store.data.shop.dispatch_days === 3 && store.data.shop.return_days === 10, 'customers see the new values');
    for (const [change, word] of [[{ city: '' }, 'City'], [{ dispatch_days: '9' }, 'Dispatch'], [{ return_days: '12' }, 'Returns'],
      [{ shipping_fee: '-1' }, 'Shipping'], [{ free_shipping_over: 'abc' }, 'Free shipping'], [{ shop_name: 'Chilli Lane Pantry' }, 'name']]) {
      const answer = await one.call('PUT', '/api/seller/shop', { ...good, ...change });
      expect(answer.status >= 400 && String(answer.data.error).includes(word), `${JSON.stringify(change)} should be refused about "${word}", got ${show(answer)}`);
    }
    expect((await state.admin.call('PUT', '/api/seller/shop', good)).status === 403, 'the admin cannot use the seller settings');
    expect((await newBrowser().call('GET', '/api/seller/shop')).status === 401, 'a visitor gets 401');
  });

  await check('L1', 'Customer pages get their own title and meta description from the server, one H1 and a clean address (/category/<slug>, /store/<slug>, /product/<id>-<slug>)', async () => {
    const pickle = await productId('Green Chilli Pickle');
    const pages = ['/', '/search?search=pot', '/category/clothing', '/store/terracotta-corner', `/product/${pickle}-green-chilli-pickle`, '/sell',
      '/cart.html', '/checkout.html', '/find-my-orders.html', '/orders.html'];
    const titles = new Set();
    const descriptions = new Set();
    for (const address of pages) {
      const html = String((await newBrowser().call('GET', address)).data);
      const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1];
      const description = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1];
      expect(title && description, `${address} should have a title and a meta description`);
      expect((html.match(/<h1[\s>]/g) || []).length === 1, `${address} should have exactly one H1`);
      titles.add(title);
      descriptions.add(description);
    }
    expect(titles.size === pages.length, 'every page has its own title');
    const store = String((await newBrowser().call('GET', '/store/terracotta-corner')).data);
    expect(store.includes('<title>Terracotta Corner · Khurja | Bazaar Lane</title>') && store.includes('Hand-made clay pots'), 'the shop page title and description come from the server');
  });

  await check('Y1', 'An online order waits as pending_payment, invisible to sellers and with no emails, until the server verifies the payment; a made-up or tampered result is refused; a good FakePay result places every part and sends the emails', async () => {
    const emailsBefore = await count('SELECT COUNT(*) AS n FROM emails');
    const stockBefore = await stockOf('Clay Planter');
    const order = await placeOnlineOrder([await cartLine('Clay Planter', 1), await cartLine('Smoky Chilli Oil', 1)]);
    expect(order.answer.status === 201 && /^\/pay\/fake\/\d+$/.test(order.answer.data.payment.pay_url), `an online order should go to FakePay, got ${show(order.answer)}`);
    const parts = await partsOfToken(order.token);
    expect(parts.length === 2 && parts.every((p) => p.status === 'pending_payment' && p.payment_status === 'unpaid'), 'both parts wait for payment');
    expect((await stockOf('Clay Planter')) === stockBefore - 1, 'the stock is reserved while it waits');
    expect((await count('SELECT COUNT(*) AS n FROM emails')) === emailsBefore, 'no emails before the payment is verified');
    const tracked = await trackOrder(order.token);
    expect(tracked.data.parts.every((p) => p.payment_words === 'Waiting for payment'), 'the tracking page says Waiting for payment');
    // A browser claiming it paid: no signature, a made-up one, and a real one with the amount or status changed.
    const good = (await newBrowser().call('POST', `/api/pay/fake/${order.paymentId}`, { outcome: 'upi' })).data;
    for (const fake of [{ payment_id: order.paymentId, status: 'paid' }, { ...good, signature: 'a'.repeat(64) },
      { ...good, paid_ref: good.paid_ref + 'x' }, { ...good, status: 'failed', signature: good.signature }]) {
      const answer = await newBrowser().call('POST', '/api/payments/verify', fake);
      expect(answer.status === 400, `a result without a valid signature should be refused, got ${show(answer)}`);
    }
    expect((await partsOfToken(order.token)).every((p) => p.status === 'pending_payment'), 'refused results change nothing');
    const verified = await newBrowser().call('POST', '/api/payments/verify', good);
    expect(verified.status === 200 && verified.data.status === 'paid', `the real FakePay result should be accepted, got ${show(verified)}`);
    const after = await partsOfToken(order.token);
    expect(after.every((p) => p.status === 'placed' && p.payment_status === 'paid'), 'both parts are placed and paid');
    const placedBy = await db.get(`SELECT by_role FROM status_log WHERE seller_order_id = ? AND status = 'placed'`, after[0].id);
    expect(placedBy.by_role === 'system', 'the system placed it, after the check');
    const newEmails = (await count('SELECT COUNT(*) AS n FROM emails')) - emailsBefore;
    expect(newEmails === 3, `the confirmation and 2 new-order emails go out after the payment, got ${newEmails}`);
    const again = await newBrowser().call('POST', '/api/payments/verify', good);
    expect(again.status === 200 && (await count('SELECT COUNT(*) AS n FROM emails')) - emailsBefore === 3, 'sending the result twice changes nothing');
    state.paidOrder = order;
  });

  await check('Y2', 'A failed payment, or one not finished within 30 minutes, cancels the order, puts the stock back and emails the customer', async () => {
    const stockBefore = await stockOf('Cotton Stole');
    const failed = await placeOnlineOrder([await cartLine('Cotton Stole', 2)], { email: 'zz-fail@check.test' });
    const paid = await payWithFakePay(failed.paymentId, 'fail');
    expect(paid.verified.data.status === 'failed' && /declined/.test(paid.verified.data.message), `a failed payment says what happened, got ${show(paid.verified)}`);
    expect((await partsOfToken(failed.token)).every((p) => p.status === 'cancelled'), 'the order is cancelled');
    expect((await stockOf('Cotton Stole')) === stockBefore, 'the stock came back');
    expect((await db.get("SELECT COUNT(*) AS n FROM emails WHERE to_address = 'zz-fail@check.test' AND subject LIKE '%not paid%'")).n === 1, 'the customer is emailed');
    const late = await placeOnlineOrder([await cartLine('Cotton Stole', 1)]);
    expect((await stockOf('Cotton Stole')) === stockBefore - 1, 'the late order reserved its stock');
    const old = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    await db.run('UPDATE customer_orders SET created_at = ? WHERE tracking_token = ?', old, late.token); // only in the test copy
    const fresh = await placeOnlineOrder([await cartLine('Cotton Stole', 1)]);
    expect((await state.pantry.call('POST', '/api/admin/payments/run-expiry')).status === 403, 'a seller cannot run the 30-minute check');
    const run = await state.admin.call('POST', '/api/admin/payments/run-expiry');
    expect(run.status === 200 && run.data.cancelled === 1, `exactly the 31-minute-old order is cancelled, got ${show(run)}`);
    expect((await partsOfToken(late.token)).every((p) => p.status === 'cancelled') && (await partsOfToken(fresh.token)).every((p) => p.status === 'pending_payment'),
      'the old one is cancelled, the new one still waits');
    expect((await stockOf('Cotton Stole')) === stockBefore - 1, 'the stock of the old order came back (the new one keeps its reservation)');
    await payWithFakePay(fresh.paymentId, 'fail'); // tidy up: its stock comes back too
    expect((await stockOf('Cotton Stole')) === stockBefore, 'all stock is back');
  });

  await check('Y3', 'When a paid part is cancelled, exactly that part is refunded, once, never more than was paid, and the customer is emailed; the other shop\'s part is untouched', async () => {
    const order = state.paidOrder;
    const parts = await partsOfToken(order.token);
    const pantryPart = parts.find((p) => p.shop_name === 'Chilli Lane Pantry');
    const other = parts.find((p) => p.shop_name !== 'Chilli Lane Pantry');
    const cancel = await newBrowser().call('POST', `/api/track/${order.token}/parts/${pantryPart.id}/cancel`);
    expect(cancel.status === 200 && /refunded/.test(cancel.data.message), `the cancel should say it is refunded, got ${show(cancel)}`);
    const refund = await db.get('SELECT * FROM refunds WHERE seller_order_id = ?', pantryPart.id);
    expect(refund && refund.amount === pantryPart.items_total + pantryPart.shipping, 'exactly that part\'s total is refunded');
    expect((await partsOfToken(order.token)).find((p) => p.id === pantryPart.id).payment_status === 'refunded', 'the part is marked refunded');
    const untouched = (await partsOfToken(order.token)).find((p) => p.id === other.id);
    expect(untouched.status === 'placed' && untouched.payment_status === 'paid', 'the other shop\'s part is untouched');
    const twice = await state.admin.call('POST', `/api/admin/parts/${pantryPart.id}/refund`);
    expect(twice.status === 400 && (await count(`SELECT COUNT(*) AS n FROM refunds WHERE seller_order_id = ${pantryPart.id}`)) === 1, `a second refund is refused, got ${show(twice)}`);
    const notCancelled = await state.admin.call('POST', `/api/admin/parts/${other.id}/refund`);
    expect(notCancelled.status === 400, 'a part that is still placed cannot be refunded');
    const payment = await db.get('SELECT amount FROM payments WHERE id = ?', order.paymentId);
    const refunded = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM refunds WHERE payment_id = ${order.paymentId}`);
    expect(refunded <= payment.amount, 'refunds are never bigger than what was paid');
    expect((await db.get("SELECT COUNT(*) AS n FROM emails WHERE subject LIKE '%refund of%'")).n >= 1, 'the refund email went out');
  });

  await check('PAY', 'The admin Payments page lists every payment with its split per shop (shop total, commission, shop share; the numbers add up) and its refunds; the admin switches cash on delivery off and on; a visitor and a seller are refused', async () => {
    const page = await state.admin.call('GET', '/api/admin/payments');
    const payment = page.data.payments.find((p) => p.id === state.paidOrder.paymentId);
    expect(payment && payment.status === 'paid' && payment.refunds.length === 1, 'the paid payment and its refund are listed');
    const total = payment.split.reduce((sum, part) => sum + part.total, 0);
    expect(total === payment.amount, `the shops' totals add up to the payment, ${total} vs ${payment.amount}`);
    expect(payment.split.every((part) => part.shop_share + part.commission === part.total), 'each shop share + commission = that shop total');
    const off = await state.admin.call('POST', '/api/admin/settings/cod', { enabled: false });
    const refused = await placeOrder([await cartLine('Clay Planter', 1)]);
    const on = await state.admin.call('POST', '/api/admin/settings/cod', { enabled: true });
    expect(off.data.cod_enabled === false && refused.answer.status === 400 && /switched off/.test(refused.answer.data.error) && on.data.cod_enabled === true,
      'with COD switched off by the admin, COD checkout is refused; then it is switched back on');
    expect((await state.pantry.call('GET', '/api/admin/payments')).status === 403 && (await newBrowser().call('GET', '/api/admin/payments')).status === 401,
      'a seller gets 403 and a visitor 401');
    const code = await checkPhone('9000000991');
    expect(code.sent.status === 200 && code.checked.status === 200, 'the phone code works for another phone');
    const wrong = await newBrowser().call('POST', '/api/checkout/phone-verify', { phone: '9000000991', code: '000000' === code.sent.data.test_sms ? '111111' : '000000' });
    expect(wrong.status === 400 && /didn't match/.test(wrong.data.error), `a wrong code says so, got ${show(wrong)}`);
    const quick = await newBrowser().call('POST', '/api/checkout/phone-code', { phone: '9000000991' });
    expect(quick.status === 429, 'a new code only after 30 seconds');
  });

  await check('LIVEKEY', 'The app refuses to start with a live Razorpay key', async () => {
    const child = spawn(process.execPath, ['server.js'], {
      cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'],
      env: testCopyEnv({ PORT: '3102', RAZORPAY_KEY_ID: 'rzp_live_ZZcheck', RAZORPAY_KEY_SECRET: 'zz' }),
    });
    let output = '';
    child.stderr.on('data', (chunk) => { output += chunk; });
    const code = await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill(); resolve('still running'); }, 5000);
      child.on('exit', (exitCode) => { clearTimeout(timer); resolve(exitCode); });
    });
    expect(code === 1 && /TEST keys/.test(output), `the app should stop with a clear message, got ${code}: ${output.slice(0, 120)}`);
  });

  await check('F1', 'A seller sees only their own seller orders (never ones waiting for payment); Accept moves one to accepted; Reject needs a reason, the stock comes back and the customer sees the reason; another shop and a visitor are refused', async () => {
    const terracotta = await loginAs(demo('Terracotta Corner').email, demo('Terracotta Corner').password);
    state.terracotta = terracotta;
    const waiting = await placeOnlineOrder([await cartLine('Clay Planter', 1)]);
    const order = await placeOrder([await cartLine('Clay Tea Cups (set of 4)', 1), await cartLine('Hot Chilli Sauce', 1)]);
    const tea = (await partsOfToken(order.token)).find((p) => p.shop_name === 'Terracotta Corner');
    const sauce = (await partsOfToken(order.token)).find((p) => p.shop_name === 'Chilli Lane Pantry');
    const list = await terracotta.call('GET', '/api/seller/orders?tab=new');
    expect(list.status === 200 && list.data.orders.some((o) => o.id === tea.id), 'the shop sees its new order');
    expect(list.data.orders.every((o) => o.id !== sauce.id), "it never sees another shop's part");
    const waitingPart = (await partsOfToken(waiting.token))[0];
    expect(list.data.orders.every((o) => o.id !== waitingPart.id), 'an order waiting for payment is not shown');
    const shown = list.data.orders.find((o) => o.id === tea.id);
    expect(shown.phone === '9000000990' && shown.address.includes('ZZ Check Street') && shown.items.length === 1 && shown.ship_by, 'it shows the customer, the products and Ship by');
    const otherShop = await terracotta.call('POST', `/api/seller/orders/${sauce.id}/accept`);
    expect(otherShop.status === 403, `another shop's order gets 403, got ${show(otherShop)}`);
    expect((await newBrowser().call('GET', '/api/seller/orders')).status === 401, 'a visitor gets 401');
    expect((await state.admin.call('GET', '/api/seller/orders')).status === 403, 'the admin is not a seller');
    const accepted = await terracotta.call('POST', `/api/seller/orders/${tea.id}/accept`);
    expect(accepted.status === 200 && accepted.data.status === 'accepted', `Accept should work, got ${show(accepted)}`);
    const sauceBefore = await stockOf('Hot Chilli Sauce');
    const pantry = await loginAs(demo('Chilli Lane Pantry').email, demo('Chilli Lane Pantry').password);
    const noReason = await pantry.call('POST', `/api/seller/orders/${sauce.id}/reject`, { reason: ' ' });
    expect(noReason.status === 400 && /reason/.test(noReason.data.error), 'Reject without a reason is refused');
    const rejected = await pantry.call('POST', `/api/seller/orders/${sauce.id}/reject`, { reason: 'ZZ out of jars today' });
    expect(rejected.status === 200 && (await stockOf('Hot Chilli Sauce')) === sauceBefore + 1, 'Reject works and the stock comes back');
    const tracked = await trackOrder(order.token);
    const sauceTracked = tracked.data.parts.find((p) => p.shop_name === 'Chilli Lane Pantry');
    expect(sauceTracked.status === 'rejected' && sauceTracked.reason === 'ZZ out of jars today', 'the customer sees the reason');
    await payWithFakePay(waiting.paymentId, 'fail'); // tidy up
    state.teaOrder = { order, tea };
  });

  await check('F2', 'Packed, then Shipped (courier and tracking number needed), then Delivered; the customer sees the courier and tracking number; the shipped and delivered emails go out', async () => {
    const { order, tea } = state.teaOrder;
    const terracotta = state.terracotta;
    expect((await terracotta.call('POST', `/api/seller/orders/${tea.id}/pack`)).data.status === 'packed', 'Packed works');
    const noTracking = await terracotta.call('POST', `/api/seller/orders/${tea.id}/ship`, { courier: 'ZZ Couriers', tracking_number: '' });
    expect(noTracking.status === 400 && /tracking number/.test(noTracking.data.error), 'Shipped without a tracking number is refused');
    const noCourier = await terracotta.call('POST', `/api/seller/orders/${tea.id}/ship`, { courier: '', tracking_number: 'ZZ123' });
    expect(noCourier.status === 400 && /courier/.test(noCourier.data.error), 'Shipped without a courier is refused');
    const shipped = await terracotta.call('POST', `/api/seller/orders/${tea.id}/ship`, { courier: 'ZZ Couriers', tracking_number: 'ZZ123456' });
    expect(shipped.status === 200, `Shipped works, got ${show(shipped)}`);
    const tracked = (await trackOrder(order.token)).data.parts.find((p) => p.id === tea.id);
    expect(tracked.courier === 'ZZ Couriers' && tracked.tracking_number === 'ZZ123456', 'the customer sees the courier and the tracking number');
    const back = await terracotta.call('POST', `/api/seller/orders/${tea.id}/pack`);
    expect(back.status === 400, 'going back from shipped to packed is refused');
    const delivered = await terracotta.call('POST', `/api/seller/orders/${tea.id}/deliver`);
    expect(delivered.status === 200 && delivered.data.status === 'delivered', 'Delivered works');
    const emails = (await db.all("SELECT subject FROM emails WHERE to_address = 'zz-customer@check.test' ORDER BY id DESC LIMIT 5")).map((e) => e.subject);
    expect(emails.some((s) => /shipped your part/.test(s)) && emails.some((s) => /was delivered/.test(s)), 'the shipped and delivered emails reach the customer');
    const done = await terracotta.call('GET', '/api/seller/orders?tab=done');
    expect(done.data.orders.some((o) => o.id === tea.id), 'the order moves to Done');
  });

  await check('Y4b', 'Cash on delivery: Cash collected (only its own shop, only once shipped) marks the part paid; an online order has no cash to collect', async () => {
    const order = await placeOrder([await cartLine('Cotton Tote Bag', 1)]);
    const part = (await partsOfToken(order.token))[0];
    const handloom = await loginAs(demo('Handloom Nook').email, demo('Handloom Nook').password);
    const early = await handloom.call('POST', `/api/seller/orders/${part.id}/cash-collected`);
    expect(early.status === 400, 'cash cannot be collected before the order is shipped');
    for (const action of ['accept', 'pack']) await handloom.call('POST', `/api/seller/orders/${part.id}/${action}`);
    await handloom.call('POST', `/api/seller/orders/${part.id}/ship`, { courier: 'ZZ Post', tracking_number: 'ZZ9' });
    expect((await state.terracotta.call('POST', `/api/seller/orders/${part.id}/cash-collected`)).status === 403, 'another shop cannot press it');
    const collected = await handloom.call('POST', `/api/seller/orders/${part.id}/cash-collected`);
    expect(collected.status === 200 && (await partsOfToken(order.token))[0].payment_status === 'paid', 'Cash collected marks it paid');
    expect((await handloom.call('POST', `/api/seller/orders/${part.id}/cash-collected`)).status === 400, 'only once');
    const delivered = await handloom.call('POST', `/api/seller/orders/${part.id}/deliver`);
    expect(delivered.status === 200, 'then it is delivered');
    const tracked = (await trackOrder(order.token)).data.parts[0];
    expect(tracked.payment_words === 'Paid in cash', 'the customer sees Paid in cash');
    state.codDelivered = { order, part };
  });

  await check('Y3b', 'A paid part rejected by its seller, or cancelled by the admin (reason needed), is refunded once; the other part is untouched; the admin can mark a shipped part delivered', async () => {
    const order = await placeOnlineOrder([await cartLine('Clay Planter', 1), await cartLine('Cotton Stole', 1)]);
    await payWithFakePay(order.paymentId, 'upi');
    const parts = await partsOfToken(order.token);
    const planter = parts.find((p) => p.shop_name === 'Terracotta Corner');
    const stole = parts.find((p) => p.shop_name === 'Handloom Nook');
    const rejected = await state.terracotta.call('POST', `/api/seller/orders/${planter.id}/reject`, { reason: 'ZZ cracked in the kiln' });
    expect(rejected.status === 200 && /refunded/.test(rejected.data.message), `the seller's reject refunds it, got ${show(rejected)}`);
    const refund = await db.get('SELECT amount FROM refunds WHERE seller_order_id = ?', planter.id);
    expect(refund && refund.amount === planter.items_total + planter.shipping, 'exactly that part is refunded');
    expect((await partsOfToken(order.token)).find((p) => p.id === stole.id).payment_status === 'paid', 'the other part is untouched');
    const noReason = await state.admin.call('POST', `/api/admin/orders/${stole.id}/cancel`, { reason: '' });
    expect(noReason.status === 400, 'the admin must give a reason');
    expect((await state.terracotta.call('POST', `/api/admin/orders/${stole.id}/cancel`, { reason: 'x' })).status === 403, 'a seller cannot use the admin cancel');
    const cancelled = await state.admin.call('POST', `/api/admin/orders/${stole.id}/cancel`, { reason: 'ZZ admin cancel' });
    expect(cancelled.status === 200 && (await db.get('SELECT COUNT(*) AS n FROM refunds WHERE seller_order_id = ?', stole.id)).n === 1, 'the admin cancel refunds it once');
    const shippedOrder = await placeOrder([await cartLine('Clay Planter', 1)]);
    const shippedPart = (await partsOfToken(shippedOrder.token))[0];
    for (const action of ['accept', 'pack']) await state.terracotta.call('POST', `/api/seller/orders/${shippedPart.id}/${action}`);
    await state.terracotta.call('POST', `/api/seller/orders/${shippedPart.id}/ship`, { courier: 'ZZ Post', tracking_number: 'ZZ10' });
    const adminCancelShipped = await state.admin.call('POST', `/api/admin/orders/${shippedPart.id}/cancel`, { reason: 'too late' });
    expect(adminCancelShipped.status === 400, 'a shipped part cannot be cancelled');
    const adminDelivered = await state.admin.call('POST', `/api/admin/orders/${shippedPart.id}/deliver`);
    expect(adminDelivered.status === 200 && (await partsOfToken(shippedOrder.token))[0].status === 'delivered', 'the admin marks it delivered');
  });

  await check('LATE', 'An order older than its shop\'s dispatch days shows LATE on the seller\'s Orders page', async () => {
    const order = await placeOrder([await cartLine('Clay Tea Cups (set of 4)', 1)]);
    const part = (await partsOfToken(order.token))[0];
    const fresh = (await state.terracotta.call('GET', '/api/seller/orders?tab=new')).data.orders.find((o) => o.id === part.id);
    expect(fresh && fresh.late === false, 'a new order is not late');
    const old = new Date(Date.now() - 4 * 86400000).toISOString(); // Terracotta Corner ships within 3 days (only in the test copy)
    await db.run("UPDATE status_log SET at = ? WHERE seller_order_id = ? AND status = 'placed'", old, part.id);
    const late = (await state.terracotta.call('GET', '/api/seller/orders?tab=new')).data.orders.find((o) => o.id === part.id);
    expect(late.late === true, 'after its dispatch days it is LATE');
    const script = String((await state.terracotta.call('GET', '/seller/orders.js')).data);
    expect(script.includes("'LATE · '"), 'the page writes the word LATE, not just a colour');
    state.lateOrder = { order, part };
  });

  await check('T2', '"Help with this order" reaches the seller and the admin; one open request per part; the seller replies once (no other shop); the admin resolves it with a note (with a cancel and refund if not shipped); the customer sees the outcome', async () => {
    const { order, part } = state.lateOrder;
    const asked = await newBrowser().call('POST', `/api/track/${order.token}/parts/${part.id}/help`, { message: 'ZZ where is my order?' });
    expect(asked.status === 201, `the help request is sent, got ${show(asked)}`);
    const second = await newBrowser().call('POST', `/api/track/${order.token}/parts/${part.id}/help`, { message: 'ZZ again' });
    expect(second.status === 409, 'a second open request on the same part is refused');
    const tooLong = await newBrowser().call('POST', `/api/track/${state.codDelivered.order.token}/parts/${state.codDelivered.part.id}/help`, { message: 'x'.repeat(2001) });
    expect(tooLong.status === 400, 'more than 2000 characters is refused');
    const wrongToken = await newBrowser().call('POST', `/api/track/${'b'.repeat(64)}/parts/${part.id}/help`, { message: 'ZZ' });
    expect(wrongToken.status === 404, 'a wrong token gets nothing');
    const seen = (await state.terracotta.call('GET', '/api/seller/orders?tab=new')).data.orders.find((o) => o.id === part.id);
    expect(seen.help && seen.help.message === 'ZZ where is my order?', 'the seller sees it on the order');
    const pantry = await loginAs(demo('Chilli Lane Pantry').email, demo('Chilli Lane Pantry').password);
    expect((await pantry.call('POST', `/api/seller/orders/${part.id}/help-reply`, { reply: 'ZZ' })).status === 403, 'another shop cannot reply');
    const reply = await state.terracotta.call('POST', `/api/seller/orders/${part.id}/help-reply`, { reply: 'ZZ it ships today' });
    expect(reply.status === 200, 'the seller replies');
    expect((await state.terracotta.call('POST', `/api/seller/orders/${part.id}/help-reply`, { reply: 'ZZ again' })).status === 400, 'only one reply');
    const open = await state.admin.call('GET', '/api/admin/help?tab=open');
    const request = open.data.requests.find((r) => r.seller_order_id === part.id);
    expect(request && request.seller_reply === 'ZZ it ships today' && request.can_cancel, 'the admin sees it with the reply');
    const stockBefore = await stockOf('Clay Tea Cups (set of 4)');
    const resolved = await state.admin.call('POST', `/api/admin/help/${request.id}/resolve`, { resolution: 'ZZ we cancelled it for you', cancel: true });
    expect(resolved.status === 200 && (await partsOfToken(order.token))[0].status === 'cancelled' && (await stockOf('Clay Tea Cups (set of 4)')) === stockBefore + 1,
      `resolving with a cancel cancels the part and puts the stock back, got ${show(resolved)}`);
    const tracked = (await trackOrder(order.token)).data.parts[0];
    expect(tracked.help.status === 'resolved' && tracked.help.resolution === 'ZZ we cancelled it for you' && tracked.help.seller_reply === 'ZZ it ships today',
      'the customer sees the reply and the outcome');
    expect((await state.admin.call('POST', `/api/admin/help/${request.id}/resolve`, { resolution: 'again' })).status === 400, 'it cannot be resolved twice');
  });

  await check('S5b', 'A suspended shop still sees and fulfils its orders already placed, but gets no new ones', async () => {
    const order = await placeOrder([await cartLine('Handloom Bath Towel', 1)]);
    const part = (await partsOfToken(order.token))[0];
    const handloomId = await shopId('Handloom Nook');
    await state.admin.call('POST', `/api/admin/shops/${handloomId}/suspend`, { reason: 'ZZ check suspension' });
    const handloom = await loginAs(demo('Handloom Nook').email, demo('Handloom Nook').password);
    const list = await handloom.call('GET', '/api/seller/orders?tab=new');
    const accepted = await handloom.call('POST', `/api/seller/orders/${part.id}/accept`);
    const blocked = await placeOrder([await cartLine('Handloom Bath Towel', 1)]);
    await state.admin.call('POST', `/api/admin/shops/${handloomId}/reactivate`, {}); // put it back
    expect(list.status === 200 && list.data.orders.some((o) => o.id === part.id), 'the suspended shop still sees its order');
    expect(accepted.status === 200, 'and can fulfil it');
    expect(blocked.answer.status === 400, 'but no new order can be placed with it');
  });

  await check('T1', 'Only a customer with the tracking link and a delivered order can review that product, once per product per order, marked Verified buyer; the seller replies once; the admin hides it; the ratings update; the rating filter and Top rated work', async () => {
    const delivered = state.teaOrder; // Clay Tea Cups (set of 4), delivered by Terracotta Corner
    const tracked = (await trackOrder(delivered.order.token)).data.parts.find((p) => p.id === delivered.tea.id);
    const item = tracked.items[0];
    expect(item.can_review === true, 'a delivered product can be reviewed');
    const notDelivered = await placeOrder([await cartLine('Clay Tea Cups (set of 4)', 1)]);
    const pendingItem = (await trackOrder(notDelivered.token)).data.parts[0].items[0];
    const early = await newBrowser().call('POST', `/api/track/${notDelivered.token}/items/${pendingItem.id}/review`, { rating: 5 });
    expect(early.status === 400, 'a product that is not delivered cannot be reviewed');
    const wrongToken = await newBrowser().call('POST', `/api/track/${'c'.repeat(64)}/items/${item.id}/review`, { rating: 5 });
    expect(wrongToken.status === 404, 'a wrong token cannot review');
    const notInOrder = await newBrowser().call('POST', `/api/track/${notDelivered.token}/items/${item.id}/review`, { rating: 5 });
    expect(notInOrder.status === 404, 'a product that was not in this order cannot be reviewed');
    const badStars = await newBrowser().call('POST', `/api/track/${delivered.order.token}/items/${item.id}/review`, { rating: 6 });
    expect(badStars.status === 400, '6 stars is refused');
    const product = await productId('Clay Tea Cups (set of 4)');
    const before = (await newBrowser().call('GET', `/api/products/${product}`)).data;
    const posted = await newBrowser().call('POST', `/api/track/${delivered.order.token}/items/${item.id}/review`, { rating: 4, text: 'ZZ lovely cups' });
    expect(posted.status === 201, `the review is posted, got ${show(posted)}`);
    const twice = await newBrowser().call('POST', `/api/track/${delivered.order.token}/items/${item.id}/review`, { rating: 1 });
    expect(twice.status === 409, 'a second review of the same product in the same order is refused');
    const after = (await newBrowser().call('GET', `/api/products/${product}`)).data;
    expect(after.product.review_count === before.product.review_count + 1 && after.product.rating === 4, `the product's rating updates, got ${after.product.rating}`);
    expect(after.reviews[0].verified === true && after.reviews[0].first_name === 'ZZ' && after.reviews[0].text === 'ZZ lovely cups', 'the review shows the first name and Verified buyer');
    expect(after.shop.rating === 4 && after.shop.review_count >= 1, "the shop's rating updates");
    const review = await db.get('SELECT id FROM reviews WHERE order_item_id = ?', item.id);
    const pantry = await loginAs(demo('Chilli Lane Pantry').email, demo('Chilli Lane Pantry').password);
    expect((await pantry.call('POST', `/api/seller/reviews/${review.id}/reply`, { reply: 'ZZ' })).status === 403, 'another shop cannot reply');
    expect((await state.terracotta.call('POST', `/api/seller/reviews/${review.id}/reply`, { reply: 'ZZ thank you' })).status === 200, 'the seller replies');
    expect((await state.terracotta.call('POST', `/api/seller/reviews/${review.id}/reply`, { reply: 'ZZ again' })).status === 400, 'only once');
    const fourUp = (await newBrowser().call('GET', '/api/products?rating=4')).data.products;
    expect(fourUp.some((p) => p.id === product) && fourUp.every((p) => p.rating >= 4), '"4 stars and up" keeps only rated products');
    const top = (await newBrowser().call('GET', '/api/products?sort=top_rated')).data.products;
    expect(top[0].id === product, 'Top rated puts the rated product first');
    expect((await state.terracotta.call('POST', `/api/admin/reviews/${review.id}/hide`)).status === 403, 'a seller cannot hide reviews');
    const hidden = await state.admin.call('POST', `/api/admin/reviews/${review.id}/hide`);
    const afterHide = (await newBrowser().call('GET', `/api/products/${product}`)).data;
    expect(hidden.status === 200 && afterHide.product.review_count === before.product.review_count && afterHide.reviews.every((r) => r.id !== review.id),
      'a hidden review disappears and the average changes back');
    expect(!(await newBrowser().call('GET', '/api/products?rating=4')).data.products.some((p) => p.id === product), 'it no longer counts for the rating filter');
    await state.admin.call('POST', `/api/admin/reviews/${review.id}/show`);
  });

  await check('T3', '"Report this listing" reaches the admin, who hides the product (it can no longer be bought) or dismisses the report', async () => {
    const planter = await productId('Clay Planter');
    const empty = await newBrowser().call('POST', `/api/products/${planter}/report`, { reason: '' });
    expect(empty.status === 400, 'a report needs a reason');
    expect((await newBrowser().call('POST', `/api/products/${planter}/report`, { reason: 'ZZ looks fine, testing dismiss' })).status === 201, 'a report is sent');
    let open = (await state.admin.call('GET', '/api/admin/reports')).data;
    const first = open.reports.find((r) => r.product_id === planter);
    expect(first && open.open_count >= 1, 'the admin sees it');
    expect((await state.terracotta.call('GET', '/api/admin/reports')).status === 403, 'a seller cannot see reports');
    await state.admin.call('POST', `/api/admin/reports/${first.id}/dismiss`);
    expect((await newBrowser().call('GET', `/api/products/${planter}`)).status === 200, 'a dismissed report leaves the product on sale');
    await newBrowser().call('POST', `/api/products/${planter}/report`, { reason: 'ZZ this is not clay' });
    open = (await state.admin.call('GET', '/api/admin/reports')).data;
    const second = open.reports.find((r) => r.product_id === planter);
    const hide = await state.admin.call('POST', `/api/admin/reports/${second.id}/hide`);
    const bought = await placeOrder([await cartLine('Clay Planter', 1)]);
    expect(hide.status === 200 && (await newBrowser().call('GET', `/api/products/${planter}`)).status === 404 && bought.answer.status === 400,
      'a hidden product cannot be seen or bought');
    expect((await state.admin.call('POST', `/api/admin/reports/${second.id}/hide`)).status === 400, 'a handled report cannot be handled again');
    await state.admin.call('POST', `/api/admin/products/${planter}/unhide`); // put it back for the next checks
  });

  await check('M2', 'A delivered online part books earning = items + shipping - commission; a delivered COD part books the commission owed; nothing for rejected or cancelled; delivering twice books once', async () => {
    const order = await placeOnlineOrder([await cartLine('Clay Tea Cups (set of 4)', 2)]);
    await payWithFakePay(order.paymentId, 'upi');
    const part = (await partsOfToken(order.token))[0];
    for (const action of ['accept', 'pack']) await state.terracotta.call('POST', `/api/seller/orders/${part.id}/${action}`);
    await state.terracotta.call('POST', `/api/seller/orders/${part.id}/ship`, { courier: 'ZZ Post', tracking_number: 'ZZ11' });
    await state.terracotta.call('POST', `/api/seller/orders/${part.id}/deliver`);
    // By hand: 2 x ₹380 = ₹760 items, shipping ₹80 (not over ₹999), Terracotta's own 9%: commission ₹68.40. Earning ₹771.60.
    const booked = await db.get("SELECT * FROM ledger WHERE seller_order_id = ? AND type = 'earning'", part.id);
    expect(part.items_total === 76000 && part.shipping === 8000 && part.commission === 6840, `the part should be 76000 + 8000, commission 6840, got ${part.items_total}, ${part.shipping}, ${part.commission}`);
    expect(booked && booked.amount === 76000 + 8000 - 6840, `earning = items + shipping - commission = 77160, got ${booked && booked.amount}`);
    const again = await state.admin.call('POST', `/api/admin/orders/${part.id}/deliver`);
    expect(again.status === 400 && (await count(`SELECT COUNT(*) AS n FROM ledger WHERE seller_order_id = ${part.id}`)) === 1, 'delivering again is refused and books nothing more');
    const cod = state.codDelivered.part; // the COD tote bag, delivered in Y4b
    const owed = await db.get("SELECT * FROM ledger WHERE seller_order_id = ? AND type = 'commission_owed'", cod.id);
    expect(owed && owed.amount === -cod.commission, `a delivered COD part books -commission, got ${owed && owed.amount} for ${cod.commission}`);
    const stopped = await count("SELECT COUNT(*) AS n FROM ledger JOIN seller_orders ON seller_orders.id = ledger.seller_order_id WHERE seller_orders.status IN ('rejected', 'cancelled')");
    expect(stopped === 0, 'rejected and cancelled parts book nothing');
    state.onlineDelivered = { order, part };
  });

  await check('M3', 'The admin records a payout; balance = earnings - commission owed - payouts; a payout bigger than the balance is refused; the seller gets an email and sees it on Earnings; others are refused', async () => {
    const terracottaId = await shopId('Terracotta Corner');
    const ledgerSum = async () => (await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE seller_id = ${terracottaId}`));
    const earnings = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE seller_id = ${terracottaId} AND type = 'earning'`);
    const owed = await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE seller_id = ${terracottaId} AND type = 'commission_owed'`);
    const page = (await state.admin.call('GET', '/api/admin/payouts')).data;
    const before = page.shops.find((shop) => shop.id === terracottaId).balance;
    expect(before === earnings + owed && before === await ledgerSum(), `balance = earnings - commission owed - payouts, got ${before} vs ${earnings} + ${owed}`);
    const tooBig = await state.admin.call('POST', '/api/admin/payouts', { seller_id: terracottaId, amount: String(before / 100 + 1), note: 'ZZ too big' });
    expect(tooBig.status === 400 && /bigger than/.test(tooBig.data.error), `a payout bigger than the balance is refused, got ${show(tooBig)}`);
    expect((await state.admin.call('POST', '/api/admin/payouts', { seller_id: terracottaId, amount: '100', note: '' })).status === 400, 'a payout needs a reference');
    expect((await state.terracotta.call('POST', '/api/admin/payouts', { seller_id: terracottaId, amount: '1', note: 'x' })).status === 403, 'a seller cannot record payouts');
    const paid = await state.admin.call('POST', '/api/admin/payouts', { seller_id: terracottaId, amount: '500', note: 'ZZ-UTR-1' });
    expect(paid.status === 201 && paid.data.balance === before - 50000, `the balance drops by the payout, got ${show(paid)}`);
    const mailSent = await db.get("SELECT body FROM emails WHERE to_address = ? AND subject LIKE 'Payout of%' ORDER BY id DESC", demo('Terracotta Corner').email);
    expect(mailSent && mailSent.body.includes('ZZ-UTR-1'), 'the seller gets the payout email');
    const seen = (await state.terracotta.call('GET', '/api/seller/earnings')).data;
    expect(seen.balance === before - 50000 && seen.payouts.some((p) => p.note === 'ZZ-UTR-1' && p.amount === 50000), 'the seller sees the payout and the new balance');
    const pantry = await loginAs(demo('Chilli Lane Pantry').email, demo('Chilli Lane Pantry').password);
    const theirs = (await pantry.call('GET', '/api/seller/earnings')).data;
    expect(theirs.payouts.every((p) => p.note !== 'ZZ-UTR-1'), "another shop does not see Terracotta's payout");
    const handloom = (await state.admin.call('GET', '/api/admin/payouts')).data.shops.find((shop) => shop.shop_name === 'Handloom Nook');
    expect(handloom.balance < 0, 'a shop with only COD deliveries owes commission (negative balance)');
    expect((await state.admin.call('POST', '/api/admin/payouts', { seller_id: handloom.id, amount: '1', note: 'ZZ' })).status === 400, 'no payout from a negative balance');
  });

  await check('M1b', 'Rate screens: the admin changes the default, a category and a shop rate (percent on screen, basis points saved); new orders copy the new rate, old orders keep theirs', async () => {
    const food = await categoryId('Food and spices');
    const before = await placeOrder([await cartLine('Smoky Chilli Oil', 1)]);
    const oldPart = (await partsOfToken(before.token))[0];
    expect(oldPart.commission_bps === 800, 'the pantry pays the Food and spices 8%');
    const changed = await state.admin.call('PUT', `/api/admin/commissions/category/${food}`, { percent: '6.5' });
    expect(changed.status === 200 && (await db.get('SELECT commission_bps FROM categories WHERE id = ?', food)).commission_bps === 650, '6.5% is saved as 650');
    const after = await placeOrder([await cartLine('Smoky Chilli Oil', 1)]);
    expect((await partsOfToken(after.token))[0].commission_bps === 650 && (await partsOfToken(before.token))[0].commission_bps === 800, 'the new order copies 6.5%, the old one keeps 8%');
    const shopRate = await state.admin.call('PUT', `/api/admin/commissions/shop/${await shopId('Chilli Lane Pantry')}`, { percent: '7' });
    const page = (await state.admin.call('GET', '/api/admin/commissions')).data;
    const pantryToday = page.shops.find((shop) => shop.shop_name === 'Chilli Lane Pantry').today;
    expect(shopRate.status === 200 && pantryToday.bps === 700 && pantryToday.why === 'own rate', 'a shop rate wins, and the page says why');
    for (const bad of ['101', '-1', 'abc', '1.234']) {
      expect((await state.admin.call('PUT', '/api/admin/commissions/default', { percent: bad })).status === 400, `a rate of ${bad} is refused`);
    }
    expect((await state.terracotta.call('GET', '/api/admin/commissions')).status === 403, 'a seller cannot see the rate screens');
    // put back
    await state.admin.call('PUT', `/api/admin/commissions/category/${food}`, { percent: '8' });
    await state.admin.call('PUT', `/api/admin/commissions/shop/${await shopId('Chilli Lane Pantry')}`, { percent: '' });
    const added = await state.admin.call('POST', '/api/admin/categories', { name: 'ZZ Check Category', percent: '11' });
    expect(added.status === 201 && (await db.get("SELECT commission_bps FROM categories WHERE name = 'ZZ Check Category'")).commission_bps === 1100, 'the admin adds a category with its rate');
  });

  await check('M4', 'The early-bird offer: only the first shops approved while places are left get its rate, for its days, unless the shop has its own rate; it is copied into orders; after its days the shop falls back to its category rate', async () => {
    await state.admin.call('PUT', '/api/admin/commissions/early-bird', { slots: '2', percent: '5', days: '90' });
    const sell = (await newBrowser().call('GET', '/api/sell-info')).data;
    expect(sell.early_bird && sell.early_bird.places_left === 2 && sell.early_bird.rate_bps === 500, 'Sell with us shows the offer and the places left');
    const names = ['ZZ Early One', 'ZZ Early Two', 'ZZ Early Three'];
    for (const [i, name] of names.entries()) {
      await newBrowser().call('POST', '/api/sellers/signup', { shop_name: name, email: `zz-early-${i}@check.test`, password: ZZ_PASSWORD, phone: `90000009${70 + i}` });
      await state.admin.call('POST', `/api/admin/shops/${await shopId(name)}/approve`, {});
    }
    const flags = [];
    for (const name of names) flags.push((await db.get('SELECT early_bird FROM sellers WHERE shop_name = ?', name)).early_bird);
    expect(JSON.stringify(flags) === '[1,1,0]', `only the first 2 approved get the offer, got ${flags}`);
    const one = await loginAs('zz-early-0@check.test', ZZ_PASSWORD);
    const added = await one.call('POST', '/api/seller/products', await zzProduct('ZZ Early Jam'));
    expect(added.status === 201, 'the early shop adds a product');
    const order = await placeOrder([{ product_id: added.data.id, quantity: 1 }]);
    expect((await partsOfToken(order.token))[0].commission_bps === 500, 'its order copies the 5% early-bird rate');
    await state.admin.call('PUT', `/api/admin/commissions/shop/${await shopId('ZZ Early Two')}`, { percent: '9' });
    const today = (await state.admin.call('GET', '/api/admin/commissions')).data.shops;
    expect(today.find((s) => s.shop_name === 'ZZ Early Two').today.why === 'own rate', 'a shop with its own rate keeps its own rate');
    const old = new Date(Date.now() - 91 * 86400000).toISOString(); // only in the test copy
    await db.run('UPDATE sellers SET approved_at = ? WHERE shop_name = ?', old, 'ZZ Early One');
    const later = await placeOrder([{ product_id: added.data.id, quantity: 1 }]);
    expect((await partsOfToken(later.token))[0].commission_bps === 800 && (await partsOfToken(order.token))[0].commission_bps === 500,
      'after 90 days it falls back to its category rate (Food and spices 8%), and the old order keeps 5%');
    await state.admin.call('PUT', '/api/admin/commissions/early-bird', { slots: '0', percent: '5', days: '90' }); // put back
  });

  await check('A1', 'The admin dashboard shows orders today, sales and commission today (delivered only), seller orders by status, shops waiting, LOW products, payouts due, open help, open reports, emails today and how long the oldest placed order has waited (red after MORE than 60 minutes); each number matches the database', async () => {
    const midnight = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString();
    const reached = (status) => `(SELECT MIN(at) FROM status_log WHERE status_log.seller_order_id = seller_orders.id AND status_log.status = '${status}')`;
    const dash = (await state.admin.call('GET', '/api/admin/dashboard')).data;
    // Counted here straight from the database, without the dashboard code.
    const ordersToday = await count(`SELECT COUNT(*) AS n FROM customer_orders WHERE created_at >= '${midnight}' AND (payment_method = 'cod' OR id IN (SELECT customer_order_id FROM payments WHERE status = 'paid'))`);
    const salesToday = await count(`SELECT COALESCE(SUM(items_total + shipping), 0) AS n FROM seller_orders WHERE status = 'delivered' AND ${reached('delivered')} >= '${midnight}'`);
    const commissionToday = await count(`SELECT COALESCE(SUM(commission), 0) AS n FROM seller_orders WHERE status = 'delivered' AND ${reached('delivered')} >= '${midnight}'`);
    const low = await count('SELECT COUNT(*) AS n FROM products WHERE deleted = 0 AND stock <= low_stock_level');
    const pending = await count("SELECT COUNT(*) AS n FROM sellers WHERE status = 'pending'");
    const due = (await db.all('SELECT seller_id, SUM(amount) AS b FROM ledger GROUP BY seller_id')).reduce((sum, row) => sum + Math.max(row.b, 0), 0);
    const help = await count("SELECT COUNT(*) AS n FROM help_requests WHERE status = 'open'");
    const reports = await count("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'");
    const emails = await count(`SELECT COUNT(*) AS n FROM emails WHERE created_at >= '${midnight}'`);
    const placed = await count("SELECT COUNT(*) AS n FROM seller_orders WHERE status = 'placed'");
    const pairs = [['orders today', dash.orders_today, ordersToday], ['sales today', dash.sales_today, salesToday], ['commission today', dash.commission_today, commissionToday],
      ['LOW products', dash.low_products, low], ['shops waiting', dash.shops_waiting, pending], ['payouts due', dash.payouts_due, due],
      ['open help', dash.open_help, help], ['open reports', dash.open_reports, reports], ['emails today', dash.emails_today, emails], ['placed', dash.by_status.placed, placed]];
    for (const [name, shown, counted] of pairs) expect(shown === counted, `${name}: the dashboard says ${shown}, the database says ${counted}`);
    expect(salesToday > 0 && commissionToday > 0, 'there were deliveries today in this test run, so the money tiles are not empty');
    // The red rule at the edge: exactly 60 minutes is not red, 61 is (only in the test copy).
    const order = await placeOrder([await cartLine('Smoky Chilli Oil', 1)]);
    const part = (await partsOfToken(order.token))[0];
    const setPlacedAgo = async (minutes) => (await db.run("UPDATE status_log SET at = ? WHERE seller_order_id = ? AND status = 'placed'", new Date(Date.now() - minutes * 60000).toISOString(), part.id));
    await setPlacedAgo(60.5);
    const sixty = (await state.admin.call('GET', '/api/admin/dashboard')).data;
    await setPlacedAgo(61.5);
    const sixtyOne = (await state.admin.call('GET', '/api/admin/dashboard')).data;
    expect(sixty.oldest_wait_minutes === 60 && sixty.red.wait === false, `60 minutes is not red, got ${sixty.oldest_wait_minutes} ${sixty.red.wait}`);
    expect(sixtyOne.oldest_wait_minutes === 61 && sixtyOne.red.wait === true, `61 minutes is red, got ${sixtyOne.oldest_wait_minutes} ${sixtyOne.red.wait}`);
    expect(dash.red.low === (low > 0) && dash.red.open_help === (help > 0), 'LOW and open help turn their tiles red');
    const home = String((await state.admin.call('GET', '/admin/home.js')).data);
    expect(home.includes("'Too long'") && home.includes("'LOW'"), 'a red tile also has a word');
    expect((await state.terracotta.call('GET', '/api/admin/dashboard')).status === 403 && (await newBrowser().call('GET', '/api/admin/dashboard')).status === 401, 'a seller gets 403, a visitor 401');
    await newBrowser().call('POST', `/api/track/${order.token}/parts/${part.id}/cancel`); // tidy up
  });

  await check('A2', "The seller dashboard shows only their own shop: new orders, orders to pack, LATE, sales today, balance, rating, product views this week (their own views do not count), orders per view, LOW products by name, and sales by week", async () => {
    const terracottaId = await shopId('Terracotta Corner');
    const midnight = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()).toISOString();
    const dash = (await state.terracotta.call('GET', '/api/seller/dashboard')).data;
    const counted = {
      new_orders: await count(`SELECT COUNT(*) AS n FROM seller_orders WHERE seller_id = ${terracottaId} AND status = 'placed'`),
      to_pack: await count(`SELECT COUNT(*) AS n FROM seller_orders WHERE seller_id = ${terracottaId} AND status IN ('accepted', 'packed')`),
      balance: await count(`SELECT COALESCE(SUM(amount), 0) AS n FROM ledger WHERE seller_id = ${terracottaId}`),
      sales_today: await count(`SELECT COALESCE(SUM(items_total + shipping), 0) AS n FROM seller_orders WHERE seller_id = ${terracottaId} AND status = 'delivered'
        AND (SELECT MIN(at) FROM status_log WHERE seller_order_id = seller_orders.id AND status = 'delivered') >= '${midnight}'`),
    };
    for (const [name, value] of Object.entries(counted)) expect(dash[name] === value, `${name}: the dashboard says ${dash[name]}, the database says ${value}`);
    const lowNames = (await db.all(`SELECT name FROM products WHERE seller_id = ${terracottaId} AND deleted = 0 AND stock <= low_stock_level ORDER BY name`)).map((r) => r.name);
    expect(JSON.stringify(dash.low_products.map((p) => p.name)) === JSON.stringify(lowNames) && lowNames.includes('Terracotta Cooking Pot'), 'LOW products are listed by name (P5)');
    expect(dash.rating === 4 && dash.review_count === 1, "the shop's rating (the review from T1)");
    const lamp = await productId('Hanging Clay Lamp');
    const viewsBefore = dash.views_this_week;
    await state.terracotta.call('GET', `/api/products/${lamp}`);
    await state.admin.call('GET', `/api/products/${lamp}`);
    const afterStaff = (await state.terracotta.call('GET', '/api/seller/dashboard')).data.views_this_week;
    await newBrowser().call('GET', `/api/products/${lamp}`);
    const afterCustomer = (await state.terracotta.call('GET', '/api/seller/dashboard')).data;
    expect(afterStaff === viewsBefore && afterCustomer.views_this_week === viewsBefore + 1, "the seller's and the admin's views do not count, a customer's does");
    const expectedPercent = Math.round((afterCustomer.orders_this_week / afterCustomer.views_this_week) * 1000) / 10;
    expect(afterCustomer.conversion_percent === expectedPercent, `orders divided by views: ${afterCustomer.conversion_percent} vs ${expectedPercent}`);
    expect(afterCustomer.weekly_sales.bars.length === 6 && afterCustomer.weekly_sales.series.length >= 1, 'sales by week for the chart');
    const pantryDash = (await (await loginAs(demo('Chilli Lane Pantry').email, demo('Chilli Lane Pantry').password)).call('GET', '/api/seller/dashboard')).data;
    expect(!pantryDash.low_products.some((p) => p.name === 'Terracotta Cooking Pot'), "another shop's dashboard does not show Terracotta's products");
    expect((await state.admin.call('GET', '/api/seller/dashboard')).status === 403, 'the admin is not a seller');
  });

  await check('A3', 'The admin dashboard also shows open help requests, open reports and the outbox count; the seller dashboard also shows the shop rating, product views this week and orders divided by views', async () => {
    const admin = (await state.admin.call('GET', '/api/admin/dashboard')).data;
    expect(admin.open_help === (await count("SELECT COUNT(*) AS n FROM help_requests WHERE status = 'open'"))
      && admin.open_reports === (await count("SELECT COUNT(*) AS n FROM reports WHERE status = 'open'")) && Number.isInteger(admin.emails_today), 'open help, open reports and emails today are on the admin dashboard');
    const seller = (await state.terracotta.call('GET', '/api/seller/dashboard')).data;
    expect('rating' in seller && Number.isInteger(seller.views_this_week) && 'conversion_percent' in seller, 'rating, views this week and orders divided by views are on the seller dashboard');
    const home = String((await state.admin.call('GET', '/admin/home.js')).data);
    expect(home.includes('Open help requests') && home.includes('Open reports') && home.includes('Emails in the outbox today'), 'the admin home shows them');
  });

  await check('T4', 'The footer links to About, How it works, Sell with us, FAQ, Contact, Terms, Privacy, Refunds and returns, Shipping and Seller guidelines; each page opens with its own title; the refunds page says who handles what; the contact form reaches the admin', async () => {
    const kitScript = String((await newBrowser().call('GET', '/kit.js')).data);
    const pages = ['/about', '/how-it-works', '/sell', '/faq', '/contact', '/terms', '/privacy', '/refunds', '/shipping', '/seller-guidelines'];
    for (const address of pages) {
      expect(kitScript.includes(`'${address}'`), `the footer links to ${address}`);
      const page = await newBrowser().call('GET', address);
      expect(page.status === 200 && (String(page.data).match(/<h1[\s>]/g) || []).length === 1, `${address} opens with one H1, got ${page.status}`);
    }
    const refunds = String((await newBrowser().call('GET', '/refunds')).data);
    expect(/Shops<\/strong> pack and send/.test(refunds) && /refunds online payments/.test(refunds) && /Help with this order/.test(refunds), 'the refunds page says who handles what');
    for (const legal of ['/terms', '/privacy', '/refunds', '/seller-guidelines']) {
      expect(String((await newBrowser().call('GET', legal)).data).includes('Template text, not legal advice'), `${legal} has the "not legal advice" line`);
    }
    const bad = await newBrowser().call('POST', '/api/contact', { name: 'ZZ', email: 'nope', message: 'hi' });
    expect(bad.status === 400 && /email/.test(bad.data.error), 'a bad contact form is refused with a clear message');
    const sent = await newBrowser().call('POST', '/api/contact', { name: 'ZZ Contact', email: 'zz-contact@check.test', message: 'ZZ hello' });
    expect(sent.status === 201 && /2 working days/.test(sent.data.message), 'the contact form is saved');
    const inbox = await state.admin.call('GET', '/api/admin/messages');
    const item = inbox.data.messages.find((m) => m.email === 'zz-contact@check.test');
    expect(item && !item.handled, 'the admin sees it');
    expect((await state.admin.call('POST', `/api/admin/messages/${item.id}/handled`)).status === 200, 'and marks it handled');
    expect((await state.terracotta.call('GET', '/api/admin/messages')).status === 403, 'a seller cannot read messages');
  });

  await check('NEWS', 'The newsletter needs an email and the consent tick; it emails a link to stop; /unsubscribe/<token> removes it and says so', async () => {
    const noConsent = await newBrowser().call('POST', '/api/newsletter', { email: 'zz-news@check.test', consent: false });
    expect(noConsent.status === 400 && /tick/.test(noConsent.data.error), 'no consent, no sign-up');
    const joined = await newBrowser().call('POST', '/api/newsletter', { email: 'zz-news@check.test', consent: true });
    const again = await newBrowser().call('POST', '/api/newsletter', { email: 'zz-news@check.test', consent: true });
    expect(joined.status === 200 && JSON.stringify(joined.data) === JSON.stringify(again.data) && (await count("SELECT COUNT(*) AS n FROM newsletter WHERE email = 'zz-news@check.test'")) === 1, 'signed up once');
    const row = await db.get("SELECT unsubscribe_token FROM newsletter WHERE email = 'zz-news@check.test'");
    const welcome = await db.get("SELECT body FROM emails WHERE to_address = 'zz-news@check.test'");
    expect(welcome && welcome.body.includes('/unsubscribe/' + row.unsubscribe_token), 'the email has the link to stop');
    const stop = await newBrowser().call('GET', '/unsubscribe/' + row.unsubscribe_token);
    expect(stop.status === 200 && String(stop.data).includes('You are off the newsletter') && (await count("SELECT COUNT(*) AS n FROM newsletter WHERE email = 'zz-news@check.test'")) === 0, 'unsubscribe removes it and says so');
    const unknown = await newBrowser().call('GET', '/unsubscribe/' + 'f'.repeat(48));
    expect(String(unknown.data).includes('not on our list'), 'an unknown link says so');
  });

  await check('L1b', '/sitemap.xml lists the home page, the help pages, active shops, categories and buyable products (and nothing hidden); /robots.txt keeps out /admin, /seller, /track and /pay; a wrong address shows the friendly 404 page with search and a link home', async () => {
    const sitemap = String((await newBrowser().call('GET', '/sitemap.xml')).data);
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
    for (const must of ['/', '/about', '/refunds', '/store/chilli-lane-pantry', '/category/food-and-spices']) expect(locs.includes(must), `the sitemap lists ${must}`);
    expect(!locs.includes('/store/brass-bell-crafts'), 'a pending shop is not listed');
    const woollen = await productId('Woollen Shawl');
    expect(!locs.some((l) => l.startsWith(`/product/${woollen}-`)), 'a switched-off product is not listed');
    for (const address of locs) {
      const page = await newBrowser().call('GET', address);
      expect(page.status === 200, `every sitemap address opens: ${address} gave ${page.status}`);
    }
    const robots = String((await newBrowser().call('GET', '/robots.txt')).data);
    expect(['/admin', '/seller', '/track', '/pay'].every((p) => robots.includes('Disallow: ' + p)) && /Sitemap: .*\/sitemap\.xml/.test(robots), 'robots.txt is right');
    const lost = await newBrowser().call('GET', '/no-such-page-zz');
    expect(lost.status === 404 && String(lost.data).includes('We could not find that page') && String(lost.data).includes('action="/search"') && String(lost.data).includes('href="/"'),
      'a wrong address shows the friendly 404 page with search and a link home');
    expect((await newBrowser().call('GET', '/api/no-such-thing')).status === 404, 'a wrong /api address still answers 404');
  });

  await check('L2', 'Customer pages load no outside fonts or scripts; product pictures have text labels (alt); status is never colour alone; the bag and checkout use real buttons, labels and fields (keyboard)', async () => {
    for (const address of ['/', '/search', '/category/clothing', '/store/handloom-nook', '/cart.html', '/checkout.html', '/about', '/sell']) {
      const html = String((await newBrowser().call('GET', address)).data);
      expect(!/<(script|link)[^>]+(src|href)="https?:/i.test(html), `${address} loads nothing from outside websites`);
    }
    const css = String((await newBrowser().call('GET', '/style.css')).data);
    expect(!/@import url\("https?:/.test(css) && !/fonts\.googleapis/.test(css), 'the font comes from this app');
    const common = String((await newBrowser().call('GET', '/common.js')).data);
    expect(/picture\.alt = ''/.test(common) && String((await newBrowser().call('GET', '/kit.js')).data).includes('alt: product.name'), 'product cards give the photo its name as alt text');
    const checkout = String((await newBrowser().call('GET', '/checkout.html')).data);
    expect((checkout.match(/<label/g) || []).length >= 6 && /<button type="submit" id="place-order"/.test(checkout), 'checkout fields have labels and the order is placed with a real button');
    const words = String((await newBrowser().call('GET', '/common.js')).data);
    expect(/ORDER_STATUS_WORDS/.test(words), 'every status has words (the badges write them, never only a colour)');
  });

  await check('L3', 'npm run backup makes a dated copy of the database in the backups folder and deletes nothing', async () => {
    const backupDir = path.join(os.tmpdir(), 'bazaar-lane-check-backups');
    fs.rmSync(backupDir, { recursive: true, force: true }); // only the check's own temp folder
    const productsBefore = await count('SELECT COUNT(*) AS n FROM products');
    const run = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ['backup.js'], { cwd: __dirname, env: testCopyEnv({ BACKUP_DIR: backupDir }), stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (chunk) => { output += chunk; });
      child.stderr.on('data', (chunk) => { output += chunk; });
      child.on('exit', (code) => resolve({ code, output }));
    });
    const first = await run();
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const second = await run();
    const files = fs.existsSync(backupDir) ? fs.readdirSync(backupDir) : [];
    expect(first.code === 0 && second.code === 0 && files.length === 2 && files.every((f) => /^bazaar-lane-\d{4}-\d{2}-\d{2}-\d{6}\.json$/.test(f)),
      `two runs make two dated copies and keep both, got ${files.join(', ')}: ${first.output}`);
    const copy = JSON.parse(fs.readFileSync(path.join(backupDir, files[0]), 'utf8'));
    expect(copy.tables && Array.isArray(copy.tables.products) && copy.tables.products.length === productsBefore && Array.isArray(copy.tables.photos),
      `the copy holds every table, with all ${productsBefore} products, got ${copy.tables && copy.tables.products ? copy.tables.products.length : 'none'}`);
    expect(first.output.includes(`${productsBefore} products`), `backup.js says where it saved and how many products, got: ${first.output}`);
    expect((await count('SELECT COUNT(*) AS n FROM products')) === productsBefore, 'the database itself is still there');
    fs.rmSync(backupDir, { recursive: true, force: true });
  });

  await check('KIT', 'The Interaction Kit look: React 18, ReactDOM 18, the kit\'s tokens, bundle and the Instrument Sans font are served by this app; the safety headers still allow only this site; the pages load the kit; no emoji anywhere in the pages', async () => {
    for (const address of ['/vendor/react.js', '/vendor/react-dom.js', '/kit/tokens.css', '/kit/components/bundle.css',
      '/kit/components/bundle.js', '/fonts/instrument-sans/400.css', '/fonts/instrument-sans/600.css']) {
      const answer = await newBrowser().call('GET', address);
      expect(answer.status === 200 && String(answer.data).length > 100, `${address} should be served, got ${answer.status}`);
    }
    const react = await newBrowser().call('GET', '/vendor/react.js');
    expect(/React v?18\./.test(String(react.data).slice(0, 300)) || String(react.data).includes('"18.'), 'the React served should be version 18');
    const fontCss = String((await newBrowser().call('GET', '/fonts/instrument-sans/400.css')).data);
    const fontFile = fontCss.match(/url\(\.\/(files\/[^)]+\.woff2)\)/)[1];
    expect((await newBrowser().call('GET', '/fonts/instrument-sans/' + fontFile)).status === 200, 'the font file should be served');
    for (const secret of ['/kit/README.md', '/kit/components/src/util.js', '/fonts/instrument-sans/package.json', '/vendor/../package.json']) {
      expect((await newBrowser().call('GET', secret)).status === 404, `${secret} should not be served`);
    }
    const home = await fetch(BASE + '/');
    const policy = home.headers.get('content-security-policy');
    expect(/default-src 'self'/.test(policy) && /script-src 'self';/.test(policy) && /font-src 'self';/.test(policy) && !/https?:|unsafe/.test(policy),
      `the safety headers should allow only this site, got ${policy}`);
    const style = String((await newBrowser().call('GET', '/style.css')).data);
    expect(style.includes('@import url("/kit/tokens.css")') && !/#[0-9a-f]{3,8}\b(?![^;]*mask)/i.test(style.replace(/mask-image:[^;]*;/g, '')),
      'style.css should take its colours from the kit\'s tokens (no colour codes of its own)');
    const page = String((await newBrowser().call('GET', '/')).data);
    for (const file of ['/vendor/react.js', '/vendor/react-dom.js', '/kit/components/bundle.js', '/kit/components/bundle.css']) {
      expect(page.includes(file), `the home page should load ${file}`);
    }
    const emoji = /\p{Extended_Pictographic}/u;
    const withEmoji = [];
    const look = (folder) => {
      for (const name of fs.readdirSync(folder)) {
        const file = path.join(folder, name);
        if (fs.statSync(file).isDirectory()) look(file);
        else if (/\.(html|js|css)$/.test(name) && emoji.test(fs.readFileSync(file, 'utf8'))) withEmoji.push(path.relative(__dirname, file));
      }
    };
    look(path.join(__dirname, 'public'));
    expect(withEmoji.length === 0, `no page may show an emoji, found some in ${withEmoji.join(', ')}`);
    const customer = (await newBrowser().call('GET', '/api/products')).data.products[0];
    expect(!('emoji' in customer) && 'photo_url' in customer, 'customers get a photo address (or null), never an emoji');
  });

  await check('PHOTO', 'A seller uploads a JPEG, PNG or WebP photo of at most 2 MB: the server checks its first bytes, saves it under a random name and customers see it; a wrong type, a renamed file, an empty or too big file, another shop\'s product or a visitor are refused', async () => {
    // The sample photos copied in when the test database was filled are not part of this check: count only new photos
    // (photos are rows in the photos table now, not files).
    const photoNames = async () => (await db.all('SELECT name FROM photos')).map((row) => row.name);
    const samplePhotos = new Set(await photoNames());
    const newUploads = async () => (await photoNames()).filter((name) => !samplePhotos.has(name));
    const pantry = await loginAs(demo('Chilli Lane Pantry').email, demo('Chilli Lane Pantry').password);
    const added = await pantry.call('POST', '/api/seller/products', await zzProduct('ZZ Photo Jar'));
    expect(added.status === 201, `the ZZ product should be added, got ${show(added)}`);
    const id = added.data.id;
    const send = async (browser, productId, bytes, type = 'image/jpeg') => {
      const headers = { 'Content-Type': type };
      if (browser && browser.cookie) headers.Cookie = browser.cookie;
      const response = await fetch(`${BASE}/api/seller/products/${productId}/photo`, { method: 'POST', headers, body: bytes });
      return { status: response.status, data: await response.json().catch(() => ({})) };
    };
    const jpeg = Buffer.concat([Buffer.from('ffd8ffe000104a464946', 'hex'), Buffer.alloc(2000, 7)]);
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(500, 1)]);
    const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(500, 2)]);
    for (const [bytes, ending] of [[png, '.png'], [webp, '.webp'], [jpeg, '.jpg']]) {
      const answer = await send(pantry, id, bytes, 'application/octet-stream');
      expect(answer.status === 200 && new RegExp(`^/uploads/[a-f0-9]{32}\\${ending}$`).test(answer.data.photo_url),
        `a ${ending} photo should be saved under a random name, got ${show(answer)}`);
    }
    const saved = (await db.get('SELECT photo FROM products WHERE id = ?', id)).photo;
    const files = await newUploads();
    expect(files.length === 1 && files[0] === saved, `a new photo replaces the old file, got ${files.join(', ')}`);
    const served = await fetch(`${BASE}/uploads/${saved}`);
    expect(served.status === 200 && served.headers.get('content-type') === 'image/jpeg', 'the photo should be served as a picture');
    const page = await newBrowser().call('GET', `/api/products/${id}`);
    expect(page.data.product.photo_url === '/uploads/' + saved, 'customers should see the photo');

    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const refused = [
      [await send(pantry, id, html, 'image/jpeg'), 400, 'JPEG, PNG or WebP', 'an HTML file sent as image/jpeg'],
      [await send(pantry, id, Buffer.from('GIF89a' + 'x'.repeat(100)), 'image/gif'), 400, 'JPEG, PNG or WebP', 'a GIF'],
      [await send(pantry, id, Buffer.alloc(0)), 400, 'choose a photo', 'an empty file'],
      [await send(pantry, id, Buffer.concat([jpeg, Buffer.alloc(2 * 1024 * 1024)])), 413, '2 MB', 'a photo over 2 MB'],
      [await send(null, id, jpeg), 401, '', 'a visitor'],
    ];
    const terracotta = await loginAs(demo('Terracotta Corner').email, demo('Terracotta Corner').password);
    refused.push([await send(terracotta, id, jpeg), 403, 'another shop', "another shop's seller"]);
    const admin = await loginAs(demo('admin').email, demo('admin').password);
    refused.push([await send(admin, id, jpeg), 403, '', 'the admin (who cannot change products)']);
    for (const [answer, status, words, what] of refused) {
      expect(answer.status === status && String(answer.data.error || '').includes(words), `${what} should get ${status}, got ${show(answer)}`);
    }
    expect((await db.get('SELECT photo FROM products WHERE id = ?', id)).photo === saved && (await newUploads()).length === 1,
      'a refused upload must not change the photo or save a file');
    await db.run("UPDATE products SET deleted = 1 WHERE name = 'ZZ Photo Jar'"); // tidy up: the ZZ product leaves the shop
  });

  await check('CAROUSEL', 'The category pages /category/<id> exist and load the carousel, as do the home page and the shop pages; a category\'s list only has products that can be bought (how it turns is checked by hand)', async () => {
    const foodId = await categoryId('Food and spices');
    const moved = await newBrowser().call('GET', `/category/${foodId}`);
    expect(moved.status === 301, `an old /category/<id> address should move to the clean address, got ${moved.status}`);
    const page = await newBrowser().call('GET', '/category/food-and-spices');
    expect(page.status === 200 && String(page.data).includes('/carousel.js') && String(page.data).includes('This category does not exist'),
      'the category page should be served, with the carousel script and its "not found" text');
    for (const address of ['/store/chilli-lane-pantry']) {
      const other = await newBrowser().call('GET', address);
      expect(other.status === 200 && String(other.data).includes('/carousel.js'), `${address} should load the carousel`);
    }
    const script = await newBrowser().call('GET', '/carousel.js');
    expect(script.status === 200 && String(script.data).includes('class ProductCarousel'), 'carousel.js should be served');
    const food = (await newBrowser().call('GET', `/api/products?category=${foodId}`)).data.products;
    const ids = food.map((p) => p.id);
    const buyable = (await db.all(`
      SELECT products.id FROM products JOIN sellers ON sellers.id = products.seller_id
      WHERE products.category_id = ? AND products.active = 1 AND products.deleted = 0 AND products.hidden = 0
        AND products.stock > 0 AND sellers.status = 'active'`, foodId)).map((row) => row.id);
    expect(ids.length === buyable.length && buyable.every((id) => ids.includes(id)) && food.every((p) => !p.sold_out),
      `the Food and spices list should be exactly its ${buyable.length} products that can be bought, got ${ids.length}`);
  });

  await check('ORDERS', 'The admin Orders page lists every customer order with its shops\' parts, commission and who changed what; a seller gets 403 and a visitor 401', async () => {
    const answer = await state.admin.call('GET', '/api/admin/orders');
    const total = await count('SELECT COUNT(*) AS n FROM customer_orders');
    expect(answer.status === 200 && answer.data.counts.orders === total && answer.data.orders.length === Math.min(total, 200), `the admin should get every order, got ${show(answer).slice(0, 150)}`);
    const two = answer.data.orders.find((o) => o.code === state.twoShopOrder.answer.data.code);
    expect(two && two.parts.length === 2 && two.parts.every((p) => Number.isInteger(p.commission) && p.history[0].by_role === 'customer') && two.phone === '9000000990',
      'the 2-shop order should show both parts with commission, history and the customer\'s details');
    expect((await state.pantry.call('GET', '/api/admin/orders')).status === 403, 'a seller should get 403 on the admin orders');
    expect((await newBrowser().call('GET', '/api/admin/orders')).status === 401, 'a visitor should get 401 on the admin orders');
    expect((await newBrowser().call('GET', '/admin/orders.html')).status === 302, 'a visitor should be sent from the Orders page to the login page');
  });

  // ---------- Seasons (Christmas mode). The test copy restarts with a moved clock; the real store never can. ----------
  const year = new Date().getFullYear();
  const moveClock = async (iso) => { await stopServer(); await startServer(iso); };
  const seasonOf = async (browser = newBrowser(), query = '') => (await browser.call('GET', '/api/season' + query)).data.season;
  const homeHtml = async (browser = newBrowser(), query = '') => String((await browser.call('GET', '/' + query)).data);

  // ---------- The home page (laid out like a quick-shopping app) ----------

  await check('H1', 'Every category tile on the home page opens a category page that has products to buy', async () => {
    const home = (await newBrowser().call('GET', '/api/home')).data;
    const withProducts = (await db.get(`SELECT COUNT(DISTINCT products.category_id) AS n FROM products JOIN sellers ON sellers.id = products.seller_id
      WHERE products.active = 1 AND products.deleted = 0 AND products.hidden = 0 AND products.stock > 0 AND sellers.status = 'active'`)).n;
    expect(home.categories.length >= 20 && home.categories.length === withProducts, `the home page shows ${home.categories.length} tiles for ${withProducts} categories with products`);
    for (const tile of home.categories) {
      const page = await newBrowser().call('GET', '/category/' + tile.slug);
      expect(page.status === 200 && String(page.data).includes(tile.name), `the tile ${tile.name} opens /category/${tile.slug} (${page.status})`);
      const list = (await newBrowser().call('GET', '/api/products?category=' + tile.slug)).data;
      expect(list.products.length > 0 && list.products.length <= tile.product_count, `${tile.name} has products to buy`);
      expect(tile.name.length > 0 && (tile.photo_url === null || tile.photo_url.startsWith('/uploads/')), `${tile.name} has a picture of this site`);
    }
    const rows = (await newBrowser().call('GET', '/api/home/rows?offset=0&limit=6')).data;
    expect(rows.rows.length === 6 && rows.done === false && rows.next_offset === 6, 'the home page loads 6 category rows first, then more');
  });

  await check('H2', 'The promo cards link to real pages of this store, and the admin can switch one off (and change it) while sellers and visitors cannot', async () => {
    const cards = (await state.admin.call('GET', '/api/admin/promo-cards')).data.cards;
    expect(cards.length >= 6, `${cards.length} promo cards`);
    for (const card of cards.filter((c) => c.enabled)) {
      const page = await newBrowser().call('GET', card.link);
      expect(page.status === 200, `the card "${card.title}" opens ${card.link} (${page.status})`);
    }
    const first = cards[0];
    const off = await state.admin.call('PUT', `/api/admin/promo-cards/${first.id}`, { enabled: false });
    expect(off.status === 200, 'the admin switches a card off: ' + show(off));
    let home = (await newBrowser().call('GET', '/api/home')).data;
    expect(!home.promo_cards.some((c) => c.id === first.id), 'a switched-off card is not on the home page');
    const bad = await state.admin.call('PUT', `/api/admin/promo-cards/${first.id}`, { link: 'https://example.com/' });
    expect(bad.status === 400, 'a link to another website is refused');
    const noCategory = await state.admin.call('PUT', `/api/admin/promo-cards/${first.id}`, { link: '/category/zz-no-such-thing' });
    expect(noCategory.status === 400, 'a link to a category that does not exist is refused');
    const seller = await loginAs(demo('Chilli Lane Pantry').email, demo('Chilli Lane Pantry').password);
    expect((await seller.call('PUT', `/api/admin/promo-cards/${first.id}`, { enabled: true })).status === 403, 'a seller gets 403');
    expect((await newBrowser().call('GET', '/api/admin/promo-cards')).status === 401, 'a visitor gets 401');
    const on = await state.admin.call('PUT', `/api/admin/promo-cards/${first.id}`, { enabled: true, title: first.title, line: first.line, link: first.link, tone: first.tone });
    expect(on.status === 200, 'the card is put back');
    home = (await newBrowser().call('GET', '/api/home')).data;
    expect(home.promo_cards.some((c) => c.id === first.id && c.title === first.title), 'switched on again, it is back on the home page');
  });

  await check('H3', "Every product's delivery chip on the home page matches its shop's real dispatch days (+ 2 to + 5), and follows a change", async () => {
    const dispatch = new Map((await db.all('SELECT shop_name, dispatch_days FROM sellers')).map((s) => [s.shop_name, s.dispatch_days]));
    const rows = (await newBrowser().call('GET', '/api/home/rows?offset=0&limit=12')).data.rows;
    let seen = 0;
    for (const row of rows) {
      for (const product of row.products) {
        const days = dispatch.get(product.shop_name);
        expect(product.delivery.from_days === days + 2 && product.delivery.to_days === days + 5, `${product.name}: chip ${product.delivery.from_days}-${product.delivery.to_days}, shop dispatches in ${days}`);
        seen += 1;
      }
    }
    expect(seen > 20, `${seen} products checked`);
    const shopId = await db.get("SELECT id, dispatch_days FROM sellers WHERE shop_name = 'Chilli Lane Pantry'");
    await db.run('UPDATE sellers SET dispatch_days = 6 WHERE id = ?', shopId.id);
    try {
      const again = (await newBrowser().call('GET', '/api/home/rows?offset=0&limit=12')).data.rows.flatMap((r) => r.products)
        .filter((p) => p.shop_name === 'Chilli Lane Pantry');
      expect(again.length > 0 && again.every((p) => p.delivery.from_days === 8 && p.delivery.to_days === 11), 'after the shop changes to 6 dispatch days its chips say 8-11 days');
      const header = (await newBrowser().call('GET', '/api/header')).data;
      expect(header.delivery.to_days === 11, 'the header\'s delivery line follows the slowest shop');
    } finally {
      await db.run('UPDATE sellers SET dispatch_days = ? WHERE id = ?', shopId.dispatch_days, shopId.id);
    }
  });

  await check('H4', 'At 390 pixels wide (a phone) the home page and the other customer pages never scroll sideways, the header stays on top, and buttons are at least 44 pixels (measured in a real browser)', async () => {
    const pages = ['/', '/search?search=pickle', '/category/pantry-and-spices', '/store/chilli-lane-pantry', '/cart.html', '/checkout.html'];
    const report = await measureInChrome(pages, 390, 844);
    state.phoneReport = report; // DS2 reads it
    for (const page of report) {
      expect(page.error === undefined, `${page.url}: ${page.error}`);
      expect(page.scrollWidth <= page.width, `${page.url} is ${page.scrollWidth}px wide at ${page.width}px: it scrolls sideways`);
    }
    const home = report[0];
    expect(home.sticky === 'sticky', 'the home page header is sticky');
    expect(home.rows >= 6 && home.tiles >= 20 && home.promos >= 6, `the home page drew ${home.tiles} tiles, ${home.promos} promo cards and ${home.rows} rows`);
    expect(home.small.length === 0, 'these home page buttons are under 44px: ' + home.small.join(', '));
    expect(home.rows === home.tiles, `scrolling down loads every category row (${home.rows} of ${home.tiles})`);
    // On a laptop: every row loads too, nothing is left faded out, and the round arrows move a row that is too long.
    const zz = (await db.get("SELECT id FROM sellers WHERE shop_name = 'Terracotta Corner'")).id;
    const kitchen = (await db.get("SELECT id FROM categories WHERE name = 'Home and kitchen'")).id;
    const added = [];
    for (const name of ['ZZ Row Cup', 'ZZ Row Plate', 'ZZ Row Jug']) {
      added.push((await db.run(`INSERT INTO products (seller_id, category_id, name, description, price, stock, low_stock_level, active, deleted, hidden, created_at, size_label)
        VALUES (?, ?, ?, '', 19900, 5, 1, 1, 0, 0, ?, '1 piece')`, zz, kitchen, name, new Date().toISOString())).lastInsertRowid);
    }
    try {
      const [laptop] = await measureInChrome(['/'], 1280, 860);
      expect(laptop.scrollWidth <= laptop.width && laptop.rows === laptop.tiles, `at 1280px: ${laptop.rows} of ${laptop.tiles} rows, ${laptop.scrollWidth}px wide`);
      expect(laptop.hiddenSections === 0, `${laptop.hiddenSections} sections stayed faded out`);
      expect(laptop.arrowMoved === true, 'the round arrow moves a long row on a laptop');
    } finally {
      for (const id of added) await db.run('DELETE FROM products WHERE id = ?', id); // only the ZZ rows this check added, in its own test database
    }
  });

  // ---------- The design system pass ----------

  await check('DS1', 'No page, script, style or server message contains an emoji', async () => {
    const pictograph = /\p{Extended_Pictographic}/u;
    const files = [...listFiles(path.join(__dirname, 'public')), ...listFiles(path.join(__dirname, 'routes')),
      ...['mail.js', 'pages.js', 'orderStatus.js', 'payments.js', 'auth.js', 'money.js', 'seasons.js'].map((f) => path.join(__dirname, f))];
    const found = files.filter((file) => /\.(html|css|js|json)$/.test(file) && pictograph.test(fs.readFileSync(file, 'utf8')));
    expect(found.length === 0, 'emoji found in ' + found.map((f) => path.relative(__dirname, f)).join(', '));
  });

  await check('DS2', 'At most one accent (marigold) button is visible on each customer page at a time (home, search, category, shop, bag, checkout, product)', async () => {
    const product = (await newBrowser().call('GET', '/api/products?limit=1')).data.products[0];
    const productPage = await measureInChrome([product.url], 390, 844);
    const pages = [...(state.phoneReport || []), ...productPage];
    expect(pages.length >= 7, 'the phone layout check ran first');
    for (const page of pages) expect(page.accents <= 1, `${page.url} shows ${page.accents} accent buttons`);
  });

  await check('DS3', 'No hand-written colour (hex, rgb or hsl) in the pages, scripts or styles outside the kit\'s tokens and the season files', async () => {
    const colour = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
    const found = [];
    for (const file of listFiles(path.join(__dirname, 'public'))) {
      if (!/\.(html|css|js)$/.test(file) || file.includes(path.sep + 'seasons' + path.sep)) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (colour.test(line.replace(/href="#[^"]*"/g, ''))) found.push(`${path.relative(__dirname, file)}:${index + 1}`);
      });
    }
    expect(found.length === 0, 'hand-written colours at ' + found.join(', '));
  });

  await check('DS4', 'Every price goes through the one money formatter: rupees with Indian grouping (₹1,24,580), never built by hand', async () => {
    const money = require('./money');
    expect(money.formatMoney(12458000) === '₹1,24,580' && money.formatMoney(129900) === '₹1,299' && money.formatMoney(49901) === '₹499.01', 'the server formatter writes ₹ with Indian grouping');
    const handMade = /₹\$\{|['"`]₹['"`]\s*\+|\bRs\.?\s?\$?\{?\d/;
    const found = [];
    for (const file of [...listFiles(path.join(__dirname, 'public')), ...listFiles(path.join(__dirname, 'routes')), path.join(__dirname, 'mail.js')]) {
      if (!/\.js$/.test(file)) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        const code = line.replace(/\/\/.*$/, '');
        if (handMade.test(code)) found.push(`${path.relative(__dirname, file)}:${index + 1}`);
      });
    }
    expect(found.length === 0, 'money built by hand at ' + found.join(', '));
    const page = (await newBrowser().call('GET', '/api/products?limit=3')).data.products;
    expect(page.every((p) => Number.isInteger(p.price)), 'prices reach the pages as whole paise for the formatter');
  });

  await check('DS5', 'The phone code (OtpInput): a wrong code says how many tries are left, the 5th wrong try locks it (even the right code is refused), and a new code waits 30 seconds', async () => {
    const browser = newBrowser();
    const phone = '9000000555';
    const sent = await browser.call('POST', '/api/checkout/phone-code', { phone });
    expect(sent.status === 200 && /^\d{6}$/.test(String(sent.data.test_sms || '').replace(/\D/g, '').slice(-6)), 'a test code is shown outside production: ' + show(sent));
    const code = String(sent.data.test_sms).replace(/\D/g, '').slice(-6);
    const wrong = code === '000000' ? '111111' : '000000';
    const first = await browser.call('POST', '/api/checkout/phone-verify', { phone, code: wrong });
    expect(first.status === 400 && first.data.error === "That code didn't match. 4 tries left.", 'the first wrong try says 4 tries left: ' + show(first));
    for (let i = 0; i < 3; i += 1) await browser.call('POST', '/api/checkout/phone-verify', { phone, code: wrong });
    const fifth = await browser.call('POST', '/api/checkout/phone-verify', { phone, code: wrong });
    expect(fifth.status === 400 && /No tries left/.test(fifth.data.error), 'the 5th wrong try says no tries left: ' + show(fifth));
    const locked = await browser.call('POST', '/api/checkout/phone-verify', { phone, code });
    expect(locked.status === 429, 'after 5 wrong tries even the right code is refused: ' + show(locked));
    const again = await browser.call('POST', '/api/checkout/phone-code', { phone });
    expect(again.status === 429 && /30 seconds/.test(again.data.error), 'a new code waits 30 seconds: ' + show(again));
  });

  await check('X1', 'The season is on inside its dates (1 to 26 December, until 23:59) and off outside them, by itself, with no deploy', async () => {
    const moments = [[`${year}-11-30T23:59:00`, null], [`${year}-12-01T00:00:30`, 'christmas'], [`${year}-12-10T12:00:00`, 'christmas'],
      [`${year}-12-26T23:59:30`, 'christmas'], [`${year}-12-27T00:00:30`, null]];
    for (const [moment, expected] of moments) {
      await moveClock(moment);
      const season = await seasonOf();
      const html = await homeHtml();
      expect(season === expected, `at ${moment} the season should be ${expected}, got ${season}`);
      expect(html.includes('data-season="christmas"') === (expected === 'christmas'), `at ${moment} the page should ${expected ? '' : 'not '}be dressed for Christmas`);
    }
  });

  await check('X2', 'With the season off, no Christmas file is loaded and the normal look is back (also when the admin switches it off inside its dates, and for a season whose files are missing)', async () => {
    await moveClock(`${year}-12-10T12:00:00`);
    const on = await homeHtml();
    expect(on.includes('/seasons/christmas.css') && on.includes('/seasons/christmas.js') && (await newBrowser().call('GET', '/christmas')).status === 200,
      'inside the dates the page loads the Christmas files and /christmas opens');
    const christmasId = (await db.get("SELECT id FROM seasons WHERE key = 'christmas'")).id;
    const off = await state.admin.call('PUT', `/api/admin/seasons/${christmasId}`, { enabled: false });
    const offPages = [];
    for (const address of ['/', '/search', '/product/1-green-chilli-pickle', '/cart.html', '/checkout.html', '/store/handloom-nook', '/about']) {
      offPages.push(String((await newBrowser().call('GET', address)).data));
    }
    expect(off.status === 200 && offPages.every((html) => !html.includes('/seasons/') && !html.includes('data-season')), 'switched off: no page loads any Christmas file');
    expect((await newBrowser().call('GET', '/christmas')).status === 404 && (await seasonOf()) === null, 'switched off: /christmas is not found and no season is on');
    const options = (await newBrowser().call('GET', '/api/checkout/options')).data;
    expect(options.gift_options === false, 'switched off: no gift options at checkout');
    await state.admin.call('PUT', `/api/admin/seasons/${christmasId}`, { enabled: true });
    await db.run("INSERT INTO seasons (key, name, starts_at, ends_at, enabled) VALUES ('zzfiles', 'ZZ no files', ?, ?, 1)", `${year}-01-01 00:00`, `${year + 1}-12-31 23:59`);
    await db.run("UPDATE seasons SET enabled = 0 WHERE key = 'christmas'");
    const missing = await homeHtml();
    await db.run("DELETE FROM seasons WHERE key = 'zzfiles'");
    await db.run("UPDATE seasons SET enabled = 1 WHERE key = 'christmas'");
    expect(!missing.includes('data-season') && !missing.includes('/seasons/'), 'a season whose files are missing is never shown: the store stays normal');
  });

  await check('X3', 'Gift wrap is priced by the server from the shop\'s own price, copied into the order with the message, shown to the seller and on tracking; a fake wrap price from the browser is ignored; a shop without wrap and a message over 200 characters are refused; outside the season gifts are ignored', async () => {
    await moveClock(`${year}-12-10T12:00:00`);
    const items = [await cartLine('Red Chilli Garlic Chutney', 1), await cartLine('Clay Tea Cups (set of 4)', 1)];
    const gifts = { 'chilli-lane-pantry': { wrap: true, message: 'ZZ Happy Christmas, Amma', price: 1, gift_wrap: 1 }, 'terracotta-corner': { wrap: true, message: '' } };
    const order = await placeOrder(items, { gifts, gift_wrap_total: 1, grand_total: 1 });
    expect(order.answer.status === 201, `the gift order should be placed, got ${show(order.answer)}`);
    const parts = await partsOfToken(order.token);
    const pantry = parts.find((p) => p.shop_name === 'Chilli Lane Pantry');
    const pottery = parts.find((p) => p.shop_name === 'Terracotta Corner');
    // By hand: chutney ₹150 + ₹40 shipping + ₹30 wrap = ₹220; tea cups ₹380 + ₹80 shipping + ₹50 wrap = ₹510; grand ₹730.
    expect(pantry.gift_wrap === 3000 && pantry.gift_message === 'ZZ Happy Christmas, Amma' && pottery.gift_wrap === 5000, `the wrap is the shops' own price, got ${pantry.gift_wrap} and ${pottery.gift_wrap}`);
    const customerOrder = await db.get('SELECT * FROM customer_orders WHERE tracking_token = ?', order.token);
    expect(customerOrder.gift_wrap_total === 8000 && customerOrder.grand_total === 73000 && order.answer.data.grand_total === 73000, `the grand total is ₹730 with wrap, got ${customerOrder.grand_total}`);
    expect(pantry.commission === Math.floor((15000 * pantry.commission_bps + 5000) / 10000), 'commission is still on the items only');
    const tracked = (await trackOrder(order.token)).data;
    const trackedPantry = tracked.parts.find((p) => p.shop_name === 'Chilli Lane Pantry');
    expect(trackedPantry.gift_wrap === 3000 && trackedPantry.gift_message === 'ZZ Happy Christmas, Amma' && trackedPantry.total === 22000 && tracked.order.gift_wrap_total === 8000, 'tracking shows the wrap and the message');
    const pantrySeller = await loginAs(demo('Chilli Lane Pantry').email, demo('Chilli Lane Pantry').password);
    const sellerView = (await pantrySeller.call('GET', '/api/seller/orders?tab=new')).data.orders.find((o) => o.id === pantry.id);
    expect(sellerView && sellerView.gift_message === 'ZZ Happy Christmas, Amma' && sellerView.gift_wrap === 3000 && sellerView.total === 22000, "the seller's order screen has the message and the wrap");
    const receipt = await db.get("SELECT body FROM emails WHERE to_address = 'zz-customer@check.test' AND subject LIKE 'Your % order " + order.answer.data.code + "'");
    expect(receipt && receipt.body.includes('Gift wrap: ₹80') && receipt.body.includes('ZZ Happy Christmas, Amma'), 'the receipt shows the wrap and the message');
    await db.run("UPDATE sellers SET gift_wrap_price = 0 WHERE shop_name = 'Handloom Nook'");
    const noWrap = await placeOrder([await cartLine('Cotton Stole', 1)], { gifts: { 'handloom-nook': { wrap: true } } });
    await db.run("UPDATE sellers SET gift_wrap_price = 4000 WHERE shop_name = 'Handloom Nook'"); // put back
    expect(noWrap.answer.status === 400 && /does not offer gift wrap/.test(noWrap.answer.data.error), 'a shop without gift wrap is refused with a clear message');
    const longMessage = await placeOrder([await cartLine('Cotton Stole', 1)], { gifts: { 'handloom-nook': { wrap: false, message: 'x'.repeat(201) } } });
    expect(longMessage.answer.status === 400 && /200 characters/.test(longMessage.answer.data.error), 'a message over 200 characters is refused');
    const priced = (await newBrowser().call('POST', '/api/cart', { items, gifts })).data;
    expect(priced.gift_wrap_total === 8000 && priced.grand_total === 73000 && priced.gift_options === true, 'the bag prices the wrap the same way');
    await moveClock(`${year}-12-27T10:00:00`); // the phone stays checked (its code works 30 minutes)
    const after = await placeOrder([await cartLine('Red Chilli Garlic Chutney', 1)], { gifts });
    const afterPart = (await partsOfToken(after.token))[0];
    expect(after.answer.status === 201 && afterPart.gift_wrap === 0 && !afterPart.gift_message, 'after the season, gift options are ignored');
    expect((await db.get('SELECT gift_wrap, gift_message FROM seller_orders WHERE id = ?', pantry.id)).gift_wrap === 3000, 'orders placed during Christmas keep their wrap and message');
  });

  await check('X4', '"Arrives before Christmas" appears only when today + the shop\'s dispatch days + 5 days is on or before 24 December, and only during the season', async () => {
    const pickle = await productId('Green Chilli Pickle');   // Chilli Lane Pantry: 2 dispatch days
    const pot = await productId('Clay Planter');              // Terracotta Corner: 3 dispatch days
    const arrives = async (id) => (await newBrowser().call('GET', `/api/products/${id}`)).data.arrives_before_christmas;
    const cases = [[`${year}-12-10T09:00:00`, true, true], [`${year}-12-17T09:00:00`, true, false], [`${year}-12-18T09:00:00`, false, false],
      [`${year}-12-23T09:00:00`, false, false], [`${year}-11-20T09:00:00`, false, false]];
    for (const [moment, pantryShows, potteryShows] of cases) {
      await moveClock(moment);
      const [a, b] = [await arrives(pickle), await arrives(pot)];
      expect(a === pantryShows && b === potteryShows, `at ${moment}: 2-day shop ${a} (want ${pantryShows}), 3-day shop ${b} (want ${potteryShows})`);
    }
    const script = String((await newBrowser().call('GET', '/product.js')).data);
    expect(script.includes('arrives_before_christmas') && !/countdown|hurry/i.test(script), 'the page shows the line only when the server says it is true, with no countdown or hurry');
  });

  await check('X5', 'A customer cannot switch seasons or use preview; the admin can preview a season early (only in their own browser)', async () => {
    await moveClock(`${year}-11-20T09:00:00`);
    const christmasId = (await db.get("SELECT id FROM seasons WHERE key = 'christmas'")).id;
    expect((await newBrowser().call('PUT', `/api/admin/seasons/${christmasId}`, { enabled: false })).status === 401, 'a visitor cannot switch a season (401)');
    expect((await state.terracotta.call('PUT', `/api/admin/seasons/${christmasId}`, { enabled: false })).status === 403, 'a seller cannot switch a season (403)');
    expect((await state.terracotta.call('GET', '/api/admin/seasons')).status === 403, 'a seller cannot see the Seasons page data');
    expect((await seasonOf(newBrowser(), '?preview=christmas')) === null && !(await homeHtml(newBrowser(), '?preview=christmas')).includes('data-season'), "a customer's ?preview does nothing");
    expect((await seasonOf(state.terracotta, '?preview=christmas')) === null, "a seller's ?preview does nothing either");
    const preview = await homeHtml(state.admin, '?preview=christmas');
    expect(preview.includes('data-season="christmas"') && preview.includes('data-season-preview="yes"') && (await seasonOf()) === null, "the admin's preview dresses only the admin's page");
    expect((await state.admin.call('GET', '/christmas?preview=christmas')).status === 200 && (await newBrowser().call('GET', '/christmas')).status === 404, 'the admin can preview /christmas; customers cannot open it before the season');
    const bad = await state.admin.call('PUT', `/api/admin/seasons/${christmasId}`, { starts_at: '2026-13-01 00:00', ends_at: 'soon' });
    expect(bad.status === 400, 'bad dates are refused with a clear message');
    const keyword = (await newBrowser().call('GET', '/api/products?search=xmas')).data.products;
    expect(keyword.length > 0 && keyword.every((p) => p.giftable === 1), 'typing "xmas" shows giftable products first');
  });

  await check('X6', 'Every earlier item still passes with the season system in place', async () => {
    await moveClock(''); // back to the real clock for the last checks
    const failed = results.filter((result) => !result.pass).map((result) => result.item);
    expect(failed.length === 0, `these earlier items failed: ${failed.join(', ')}`);
  });

  await check('G1', 'Stop the app and start it again: shops, logins, products, categories, settings, orders, payments, refunds, the ledger, reviews, help, reports, messages, the newsletter, emails and views are all still there, a logged-in admin stays logged in, and tracking links still work', async () => {
    const snapshot = async () => JSON.stringify({
      sellers: await db.all('SELECT * FROM sellers ORDER BY id'),
      users: await db.all('SELECT id, email, role, seller_id, password_hash FROM users ORDER BY id'),
      categories: await db.all('SELECT * FROM categories ORDER BY id'),
      products: await db.all('SELECT * FROM products ORDER BY id'),
      settings: await db.all('SELECT * FROM settings ORDER BY key'),
      orders: await db.all('SELECT * FROM customer_orders ORDER BY id'),
      sellerOrders: await db.all('SELECT * FROM seller_orders ORDER BY id'),
      items: await db.all('SELECT * FROM order_items ORDER BY id'),
      log: await db.all('SELECT * FROM status_log ORDER BY id'),
      payments: await db.all('SELECT * FROM payments ORDER BY id'),
      refunds: await db.all('SELECT * FROM refunds ORDER BY id'),
      ledger: await db.all('SELECT * FROM ledger ORDER BY id'),
      reviews: await db.all('SELECT * FROM reviews ORDER BY id'),
      help: await db.all('SELECT * FROM help_requests ORDER BY id'),
      reports: await db.all('SELECT * FROM reports ORDER BY id'),
      messages: await db.all('SELECT * FROM contact_messages ORDER BY id'),
      newsletter: await db.all('SELECT * FROM newsletter ORDER BY id'),
      emails: await db.all('SELECT * FROM emails ORDER BY id'),
      views: await db.all('SELECT * FROM product_views ORDER BY product_id, day'),
    });
    const dataBefore = await snapshot();
    const pageBefore = await state.admin.call('GET', '/api/admin/shops?tab=active');

    await stopServer();
    await startServer();

    expect((await snapshot()) === dataBefore, 'the saved data should be exactly the same after the restart');
    const pageAfter = await state.admin.call('GET', '/api/admin/shops?tab=active');
    expect(pageAfter.status === 200, `the admin should still be logged in after the restart, got ${show(pageAfter)}`);
    expect(JSON.stringify(pageAfter.data) === JSON.stringify(pageBefore.data), 'the Shops page should show the same shops after the restart');
    await loginAs('zz-one@check.test', ZZ_PASSWORD);
    const tracked = await trackOrder(state.twoShopOrder.token);
    expect(tracked.status === 200 && tracked.data.order.code === state.twoShopOrder.answer.data.code, 'a tracking link should still work after the restart');
  });
}

// ---------- Start ----------

async function main() {
  console.log(`Bazaar Lane check: a test copy of the app on port ${PORT}, with its own database in the temp folder (port ${TEST_DB_PORT}).\n`);
  await checkPortIsFree();
  await checkPortIsFree(TEST_DB_PORT);
  deleteTestDatabase();
  testDatabaseIsOurs = true;
  await openTestDatabase();
  await startServer();
  try {
    await runChecks();
  } finally {
    await stopServer();
    await stopTestDatabase();
    deleteTestDatabase();
  }
  const passed = results.filter((result) => result.pass).length;
  console.log(`\n${passed} of ${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch(async (error) => {
  console.error('\nThe check could not finish: ' + error.message);
  await stopServer();
  if (testDatabaseIsOurs) {
    try {
      await stopTestDatabase();
      deleteTestDatabase();
    } catch (e) {
      // the next run deletes it at the start anyway
    }
  }
  process.exit(1);
});

// Ctrl+C: stop the test copy of the app and the test database too.
process.on('SIGINT', () => {
  if (server && serverRunning) server.kill('SIGTERM');
  stopTestDatabase().catch(() => {}).finally(() => process.exit(130));
});
