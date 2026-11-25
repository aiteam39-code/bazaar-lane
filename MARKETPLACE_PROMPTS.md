# Bazaar Lane: Multi-Vendor Marketplace — the full prompt pack

> **Design system (the source of truth for the look):** https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4#readme. It is the Interaction Kit, and the project's `kit/` folder is a copy of it. Every prompt in this file follows its README, `screen-map.md`, tokens (themes lane, night, cacao) and its 14 components. If the design system changes, paste the "Sync the kit" prompt below first.
>
> ```text
> Sync the kit. The Interaction Kit design system at https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4 is the source of truth for the look. Compare it with kit/ (README.md, screen-map.md, tokens.css, tokens.json, components/bundle.js, components/bundle.css, api/). If anything differs, show me the differences and wait for my yes before replacing the files in kit/. Then check every page still follows the kit's rules (one marigold action per screen, no emoji, sentence case, real 4:5 photos, IK.formatMoney, reduced motion) and run npm run check.
> ```

> Build a marketplace where independent sellers manage products, inventory, orders and fulfilment. Include customer storefronts, payment integration, commissions and a centralized admin dashboard.

This file gives you every message to paste into Claude Code, section by section, in order. It uses the same method as the Run Your Own Restaurant course (notebook first, plan, build one sector at a time, test after every sector, finish with a checklist) and carries over everything we learned building Chilli Lane. From Sector 2 on, it also follows Wix's guide *How to build a marketplace website* and the pages it links to (see Appendix B).

**How to use it**
- Every grey box is a message for Claude Code. Copy it, paste it, press Enter.
- Words in (brackets) are for you to change before pasting.
- Do the sections in order. Tick each one before moving on.
- Good places to stop: after Sector 3 (you can already sell with cash on delivery), and after Sector 5 (a working marketplace without reviews or money splitting).

**The sections**

| # | Section | What you get |
|---|---|---|
| 0 | Setup | Claude and Node.js ready, an empty folder |
| 1 | The notebook | CLAUDE.md: the whole marketplace described, plus a 32-line checklist |
| 2 | The plan | Claude's plan, checked against the checklist |
| 3 | Sector 1: Logins and sellers | Admin and seller logins, sign-up, approve, suspend |
| 4 | Sector 2: Notebook upgrade, products, categories and search | The Wix guide's ideas added to the notebook (15 more checklist lines); products and stock; search with filters; product pages that answer every question; a Sell with us page; every category rotating on a 3D ring |
| 5 | Sector 3: Cart, checkout and emails | One cart from many shops with every cost shown early, a one-page guest checkout split into one order per shop, emails in an outbox, Find my orders |
| 6 | Sector 4: Payments | Pay online in test mode (FakePay, or Razorpay test keys), the split per shop, refunds |
| 7 | Sector 5: Orders, fulfilment and help | Accept, reject, pack, ship, deliver, cash collected, LATE orders, Help with this order |
| 8 | Sector 6: Reviews and trust | Verified reviews and ratings, seller replies, reported listings, moderation |
| 9 | Sector 7: Commissions and payouts | Commission rates, an early-bird offer for the first sellers, a ledger, balances, payouts |
| 10 | Sector 8: Dashboards | The central admin dashboard and each seller's dashboard |
| 11 | Sector 9: Trust pages, SEO and launch | Policy and help pages, contact form, newsletter, page titles, sitemap, 404 page, safety check, backups, a launch check |
| 12 | Final proof | npm run check, reset with backup, opening day |
| 13 | Make it feel real | Layout, navigation, floating cart, progress bars, animations |
| 14 | Make it yours | Your own niche, name, shops and look |
| — | Later ideas | Plan-only messages for the next features |
| — | Appendices | What carried over from Chilli Lane, what came from the Wix guide, common problems |

---

## 0 · Setup

**What:** Claude and Node.js work, and Claude is open in an empty folder.

1. Install Claude (claude.com/download) and sign in with a paid account. Open the **Code** tab and choose **Local**.
2. Install Node.js from nodejs.org (the green **LTS** button). Then quit Claude completely and open it again.
3. Make a folder called `marketplace` inside Documents. In Claude, click the folder button and open it. Say **Yes** to "Do you trust this folder?".
4. Choose **Manual** in the little menu next to the send button, so Claude asks before doing anything.

```text
Run node -v and tell me the answer in plain words. Is it version 20 or higher?
```

You should see something like: "v22.12.0. That is version 22, which is higher than 20."

---

## 1 · The notebook

**What:** Claude gets a notebook that describes the whole marketplace. It reads it before every job.

**Why:** Claude starts every session knowing nothing. A clear notebook gives you a working marketplace. A vague one gives you a pretty picture.

```text
Save everything below, exactly as written, as a file called CLAUDE.md in this folder. It is the notebook for this project: read it at the start of every job.

# Bazaar Lane - multi-vendor marketplace

A web marketplace where many independent sellers run their own shops in one place: their products, their stock, their orders and their shipping. Customers browse every shop, fill ONE cart from several sellers and pay once. The marketplace (the platform) takes a commission on every sale and pays the rest to the sellers. One admin runs the whole platform from a central dashboard. Everything runs on one laptop. Payments use a provider's TEST MODE only, never real money. The marketplace is called Bazaar Lane (it can be renamed later).

This file is the project notebook. Read it at the start of every job. Do not change the checklist or the rules unless I ask. Keep the Stage section at the bottom up to date.

## How to build it (do not change this)
- Node.js 20 or higher with Express. SQLite through the better-sqlite3 package, in one data file called marketplace.db.
- Plain HTML, CSS and JavaScript in a public folder. No React, no build step, no frameworks. Use Node's built-in crypto for passwords (crypto.scrypt with a random salt per user). Never store a password in plain text.
- `npm run dev` starts the app at http://localhost:3000 and restarts it when files change. `PORT` and `DB_FILE` can be set as environment variables so a test can use its own port and its own database.
- Payment settings come only from environment variables: `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. They must be TEST keys (they start with rzp_test_). If a live key is set, the app refuses to start. If no keys are set, the app uses FakePay: a pretend payment page built into the app, so everything works offline. Keys are never written in code or in any file that is shared.
- Files: server.js (starts the app), db.js (tables and sample data), auth.js (logins, sessions, role checks), orderStatus.js (the ONE status function), money.js (paise helpers and commission maths), payments.js (FakePay and Razorpay test mode behind the same three functions: createPayment, verifyPayment, refund), a routes folder with one file per area (auth, sellers, products, storefront, checkout, payments, fulfilment, commissions, dashboard), a public folder with pages for each person, one shared style.css, one shared common.js, and check.js (the automatic test, run with `npm run check`).
- Money is stored as whole paise (integers: Rs 250 = 25000). Show it as Rs 250, or Rs 250.50 when there are paise. Never use decimals for money in code or in the database. Commission rates are stored in basis points (10% = 1000). Commission = items total x rate / 10000, rounded to the nearest paisa (half up).
- The server decides prices, stock, shipping, commission, totals, who may do what, and which status moves are allowed. Never trust the browser.
- Every route checks who is logged in and their role. A seller can only see and change their own shop, products, orders and earnings. Anything else gets 403, even when someone calls the server directly. Hiding it on the screen is not enough.
- Put text people typed on the page with textContent, never innerHTML, so nobody can inject HTML.
- Screens use short, plain words. The storefront, cart, checkout and tracking pages are built for a phone first. Seller and admin pages refresh themselves every 5 seconds, but never while someone is typing or choosing from a list.
- Write code a beginner can read: short functions, clear names, a one-line comment above each route.
- After each job: run it, prove it works, then tell me exactly what you tested and what I should click.
- Test data names start with ZZ. Big tests run on a separate copy of the app (its own PORT and DB_FILE) so my real data stays clean. Put back anything you change during a test.
- Never delete marketplace.db and never run a destructive command without asking me first. Before any reset, make a backup copy, tell me exactly what will be deleted, and wait for my yes.
- Never use the name, logo, products or text of a real company or brand.

## The people
- Customer (no login): opens `/`, `/store/<shop-slug>`, `/product/<id>`, `/cart.html`, `/checkout.html` and `/track/<tracking-token>`. Browses every shop, searches, fills one cart from several sellers, checks out as a guest, pays, follows each part of the order, and can cancel a part that its seller has not accepted yet.
- Seller (logs in): signs up at `/seller/signup.html`, then waits for the admin. Once approved, uses `/seller/`: their dashboard, products and stock, orders and shipping, earnings and payouts, and shop settings (shop name, description, shipping fee, free shipping above). Sees ONLY their own shop.
- Admin (logs in): opens `/admin/`. Approves, rejects and suspends shops, manages categories and commission rates, switches cash on delivery on or off, sees every order and payment, cancels and refunds, records payouts, and sees the central dashboard. Can hide a product that breaks the rules, but cannot change a seller's prices.
Logins: email and password at `/login.html`. The session lives in a cookie that is httpOnly and SameSite=Lax, and expires after 8 hours. 5 wrong passwords in a row lock that account for 5 minutes.

## What people do
1. Join: a seller signs up with a shop name, email, password and 10-digit phone. The shop is pending. The admin approves it (the shop goes live) or rejects it with a reason. The admin can suspend a live shop (reason required): its storefront and products disappear and cannot be bought, but orders already placed can still be fulfilled and refunded.
2. List: the seller adds products with a name, category, price, description, an emoji (instead of a photo), stock, a low-stock level, and on or off. They edit, switch off and delete products. A deleted product is hidden, never erased, so old orders keep its name.
3. Shop: the customer browses the home page (categories, shops, search), a shop's storefront and product pages, and adds products to one cart. The cart groups items by seller, shows each seller's shipping fee (free above that seller's limit), and the grand total.
4. Check out: name, 10-digit phone, email, address, and Pay online or Cash on delivery (only if the admin switched COD on). The server splits the cart into ONE seller order per seller under one customer order, reserves the stock, copies names, prices and the commission rate, and works out every total. The customer gets an order code (like BZ-1001) and a private tracking link.
5. Pay: an online order waits as pending_payment, invisible to sellers, until the server has verified the payment with the provider. Paid: each seller order becomes placed. Failed, or not paid within 30 minutes: cancelled, and the stock goes back. A COD order becomes placed straight away.
6. Fulfil: each seller sees only their own seller orders. New: Accept or Reject (reason required). Then Packed, then Shipped (courier name and tracking number required), then Delivered. For a COD order the seller also presses Cash collected.
7. Money back: a rejected or cancelled seller order returns its stock. If it was paid online, exactly that seller order's total is refunded through the provider, once. Other sellers' parts of the same customer order are untouched.
8. Get paid: when a seller order is delivered, the ledger books it. Online: the seller earns items + shipping - commission. COD: the seller already holds the cash, so the ledger books the commission they owe. The admin records payouts. Seller balance = earnings - commission owed - payouts.
9. Watch: the admin dashboard shows the whole platform. The seller dashboard shows one shop.

## Seller order status
pending_payment, placed, accepted, packed, shipped, delivered.
Also: pending_payment can become cancelled (payment failed, or 30 minutes passed; the system does it). placed can become rejected (the seller, reason required). placed can become cancelled (the customer from the tracking link, or the admin). accepted or packed can become cancelled (admin only, reason required).
Who moves it: pending_payment to placed = the system, only after the payment is verified on the server (straight away for COD). placed to accepted or rejected, accepted to packed, packed to shipped = the seller who owns that order. shipped to delivered = that seller or the admin.
A status only moves forward along that line. It never skips a step and never goes back. Every change goes through ONE function in orderStatus.js. It refuses anything else with a clear message, and writes the new status, who made the change and the time into status_log.

## Data (SQLite)
- users: id, email (unique), password_hash, role (admin or seller), seller_id, failed_logins, locked_until, created_at
- sessions: id (long random token), user_id, expires_at
- sellers: id, shop_name, slug (unique), description, phone, status (pending, active, rejected, suspended), status_reason, commission_bps (empty = use the category or the default), shipping_fee, free_shipping_over, created_at
- categories: id, name, commission_bps
- settings: key, value (default_commission_bps, cod_enabled)
- products: id, seller_id, category_id, name, description, emoji, price, stock, low_stock_level, active (0 or 1), deleted (0 or 1), created_at
- customer_orders: id, code, tracking_token (long random), customer_name, phone, email, address, payment_method (online or cod), items_total, shipping_total, grand_total, created_at
- seller_orders: id, customer_order_id, seller_id, status, reason, courier, tracking_number, items_total, shipping, commission_bps, commission, payment_status (unpaid, paid, refunded), created_at, updated_at
- order_items: id, seller_order_id, product_id, name, unit_price, quantity, line_total
- status_log: id, seller_order_id, status, by_role, at
- payments: id, customer_order_id, provider (fake or razorpay), provider_ref, amount, status (created, paid, failed), created_at
- refunds: id, payment_id, seller_order_id, amount, provider_ref, created_at
- ledger: id, seller_id, seller_order_id, type (earning, commission_owed, payout), amount (+ when the platform owes the seller, - when the seller owes or was paid), note, created_at
All money columns are whole paise.

## Rules the server enforces
- Names, prices and the commission rate are COPIED into the order when it is placed. Changing a product, a shop or a rate later never changes old orders.
- The server works out every total, shipping fee and commission. A total or price sent by the browser is ignored.
- A product that is switched off, deleted, out of stock, or from a shop that is not active cannot be bought, even by calling the server directly.
- Stock never goes below 0, even when many customers order the last items at the same moment (the database update checks stock >= quantity). Ordering more than is in stock is refused with a clear message that names the product.
- A seller order is only placed after the server has verified the payment (or straight away for COD). A browser saying "I paid" is never enough.
- A refund is never bigger than what was paid for that seller order, and never happens twice.
- A payout is never bigger than the seller's balance.
- Name, address, a 10-digit phone and a valid email are required. At least one product is required. Quantity is 1 to 20.
- Only valid status moves are allowed. Anything else gets a clear error message.
- Everything is saved in marketplace.db. Restart the app and nothing is lost.

## The checklist (everything here must be true at the end)
Sellers and logins
- S1. A new seller signs up. Their shop is pending: it is not on the home page and they cannot add products until the admin approves it.
- S2. The admin approves the shop. It appears on the home page and at /store/<slug>. Rejecting needs a reason, and the seller sees it when they log in.
- S3. A wrong password is refused. 5 wrong tries lock the account for 5 minutes. Passwords are stored only as hashes.
- S4. Seller A cannot see or change seller B's products, orders or earnings, and cannot open admin pages, even by calling the server directly (403). A visitor who is not logged in gets 401.
- S5. The admin suspends a shop (reason required). Its storefront and products disappear and cannot be bought, even directly. Its orders already placed can still be fulfilled.
Products and stock
- P1. A seller adds a product with a name, category, price and stock. It shows on their storefront, in its category and in search.
- P2. A seller changes a price. The storefront shows the new price. Old orders keep the old price.
- P3. A switched-off or deleted product cannot be bought, even by calling the server directly. Old orders still show its name.
- P4. Placing an order takes the items off the stock. Ordering more than is in stock is refused, naming the product. Stock never goes below 0, even with many orders at the same moment.
- P5. A product at or below its low-stock level shows LOW on the seller's products page and dashboard. The admin dashboard counts LOW products across all shops.
- P6. A rejected or cancelled seller order puts its items back in stock.
Storefront, cart and checkout
- C1. The home page lists only active shops, and the categories. Search finds a product by part of its name and only shows products that can be bought.
- C2. /store/<slug> shows only that shop's products that can be bought. The page of a pending, rejected or suspended shop says it is not available.
- C3. A cart with products from 2 sellers groups them by seller, each with its shipping fee (free above that seller's limit), and shows the right grand total. The server's total matches, and a total sent by the browser is ignored.
- C4. An empty cart, a bad phone number, a bad email, a missing address or a quantity outside 1 to 20 is refused with a clear message.
- C5. Checking out a 2-seller cart makes one customer order with 2 seller orders. The customer gets an order code and a private tracking link. The tracking page shows each seller part with its current status and every earlier status with its time. Without the right token it shows nothing.
Payments
- Y1. An online order stays pending_payment, and sellers cannot see it, until the server verifies the payment. A browser claiming it paid, without a valid provider signature, is refused.
- Y2. A failed payment, or one not finished within 30 minutes, cancels the order and puts the stock back.
- Y3. When a paid seller order is rejected or cancelled, exactly that seller order's total is refunded, once. The other seller's part is untouched.
- Y4. A COD order is placed straight away, and the seller's Cash collected marks it paid. When the admin switches COD off, COD checkout is refused.
Fulfilment
- F1. A seller sees only their own new seller orders. Accept moves one to accepted. Reject needs a reason, and the customer's tracking page shows it.
- F2. Packed, then Shipped (courier and tracking number required), then Delivered. The customer sees the courier and tracking number.
- F3. Skipping a step or going back (for example placed straight to delivered, or shipped back to packed) is refused with a clear message, whoever tries.
- F4. The customer can cancel a seller part from the tracking link while it is placed, but not after the seller accepted it.
Commissions and payouts
- M1. The commission rate is the shop's own rate if set, else its category's rate, else the default. It is copied into the seller order when placed. Changing a rate later does not change old orders.
- M2. A delivered online seller order books earning = items + shipping - commission. A delivered COD order books the commission the seller owes. Nothing is booked for rejected or cancelled orders.
- M3. The admin records a payout. The seller's balance = earnings - commission owed - payouts. A payout bigger than the balance is refused.
Dashboards
- A1. The admin home shows: orders today, sales today (delivered only), commission earned today, seller orders by status, shops waiting for approval, LOW products across all shops, payouts due, and how many minutes the oldest placed seller order has waited for its seller (red after 60 minutes).
- A2. The seller home shows only their own shop: new orders (with a badge), orders to pack, sales today, balance and LOW products.
Everything
- G1. Stop the app, start it again. All the data and logins are still there.
- G2. The home, storefront, product, cart, checkout and tracking pages are easy to use on a phone (390 pixels wide, no sideways scrolling).
- G3. `npm run check` prints PASS or FAIL for every item it can test automatically, and all of them PASS.

## Stage
Nothing built yet.
```

> **Note:** Sector 2 begins with a notebook upgrade (2a) that adds the Wix guide's ideas and 15 more checklist lines. If you are starting fresh, still paste the notebook above first, then the upgrade when you reach Sector 2.

**Check Claude understood:**

```text
Read CLAUDE.md. In plain words, in under 15 lines, tell me: who uses this marketplace, what happens to one customer order that has products from 2 different sellers (from checkout until both parts are delivered and the sellers are paid), and which 3 checklist items you think will be the hardest to get right, and why.
```

You should see: three kinds of people (customer, seller, admin); the cart splitting into one seller order per seller; payment verified on the server; each seller fulfilling their own part; commission and payouts at the end; and three hard items with reasons.

---

## 2 · The plan

**What:** Claude's plan in plain words, checked before anything is built.

```text
Read CLAUDE.md. Before you build anything, tell me your plan in plain words, in under 30 lines: the 7 sectors you will build in order (logins and sellers, products and stock, storefront cart and checkout, payments, orders and fulfilment, commissions and payouts, dashboards), what each sector gives me to click on, and the 3 things most likely to go wrong. Do not create any files yet.
```

Push back once, like a manager:

```text
Check your plan against the checklist in CLAUDE.md. Is every item covered by one of the sectors? Tell me any that are not, then fix the plan. Also check the sample data: 1 admin, 3 active shops (one of them called Chilli Lane Pantry, selling chilli pickles, sauces and spice mixes), 1 shop still pending, 4 categories with different commission rates, about 18 products, at least 2 products already LOW and 1 switched off, so I can see every state straight away. The demo logins must use test passwords only, written in a file called DEMO_LOGINS.md. Show me the final plan.
```

Now switch to **Accept edits** in the little menu. Claude can create files without asking, but still asks before running commands.

---

## 3 · Sector 1: Logins and sellers

**What:** the foundation, admin and seller logins, shop sign-up, and the admin's approve, reject and suspend.

**Why:** in a marketplace, "who is allowed to see what" is the whole game. Build it first, so everything after it is protected from the start.

```text
Build sector 1 only: logins and sellers, plus the foundation everything else will stand on.
- Set up the project and install what it needs.
- Create the database with ALL the tables in CLAUDE.md. When the tables are empty, fill them with the sample data from the plan (admin, 3 active shops including Chilli Lane Pantry, 1 pending shop, 4 categories with commission rates, about 18 products with 2 already LOW and 1 switched off, default commission 10%, COD switched on). Write the demo logins with their test passwords in DEMO_LOGINS.md.
- auth.js: log in, log out, sessions in an httpOnly SameSite=Lax cookie that expire after 8 hours, passwords hashed with crypto.scrypt and a random salt, 5 wrong tries lock the account for 5 minutes, and helpers that every route uses to require a login and a role (401 when not logged in, 403 for the wrong role or someone else's shop).
- Seller sign-up page: shop name, email, password, 10-digit phone. The new shop is pending. A pending or rejected seller who logs in only sees "Waiting for approval" or the rejection reason.
- Admin: a Shops page with tabs Pending, Active, Suspended and Rejected. Buttons: Approve, Reject (reason), Suspend (reason), Reactivate.
- Customer home page: the marketplace name and the active shops only (products come in sector 2). Phone first.
- One shared style and one shared common.js for every page.
Do not start the app: I will ask you to. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

**Start it:**

```text
Start the app and keep it running so I can open it in my browser. Tell me the address to open, and remind me where the demo logins are.
```

**Try it:** open three tabs: the home page, `/login.html` as the admin, and `/seller/signup.html`. Sign up a shop called "ZZ My Shop". As the admin, approve it. Refresh the home page: it appears.

**Let Claude test it:**

```text
The app is running. Test sector 1 on a separate copy of the app with its own port and its own database, so my real data stays clean. Sign up a ZZ seller and check they cannot add products while pending and their shop is not on the home page; approve them and check the shop appears; reject another ZZ seller with a reason and check they see it; try 5 wrong passwords and check the account locks; check passwords are stored only as hashes; log in as seller A and try to open admin pages and seller B's data by calling the server directly (refused with 403); call a seller route while logged out (401); suspend a shop and check it disappears from the home page. Then stop the test copy and give me a table: what you tested, what the app answered, PASS or FAIL.
```

---

## 4 · Sector 2: Notebook upgrade, products, categories and search

From here on, the pack follows Wix's guide *How to build a marketplace website* and the pages it links to (design, ecommerce, security, SEO, the launch checklist and the multi-vendor app). Appendix B lists every idea taken from it and where it went.

### 2a · Upgrade the notebook (paste this first)

**What:** Claude adds the guide's ideas to your notebook: buyers who can find things, product pages that answer every question, reviews, help with orders, emails, trust pages, SEO, an early-bird offer for the first sellers, and 15 new checklist lines.

**Why:** Sector 1 is already built from the old notebook. Claude reads the notebook before every job, so the new ideas have to be written there before Sector 2 starts.

```text
Update CLAUDE.md before we build sector 2. I want the marketplace to follow a guide on building marketplace websites. Add exactly what is below, in the right sections. Keep everything that is already there, including the Stage section and every decision already made. If anything below clashes with something already in CLAUDE.md, ask me before changing it. Do not build anything yet. When you are done, show me a short list of what you added.

Add to "How to build it":
- Every customer page gets its own page title and meta description from the server (for example "Green Chilli Pickle by Chilli Lane Pantry | Bazaar Lane"), exactly one H1, and a clean address: /category/<slug>, /store/<slug>, /product/<id>-<slug>. The server puts the title and description into the page before sending it, so search engines can read them.
- Emails are never really sent. mail.js writes every email into the emails table (the outbox), and the admin can read it at /admin/outbox.html. Later a real email service can replace mail.js. Emails never contain passwords.
- Customer pages load no outside fonts or scripts, so they stay fast. Every emoji used as a picture has a text label for screen readers (role="img" and aria-label). A status is never shown by colour alone: there is always a word too. Everything works with the keyboard.
- `npm run backup` copies marketplace.db into a backups folder with the date and time in the file name. It never deletes anything.

Add to "The people":
- Customer: also opens /category/<slug>, /search, /sell (Sell with us), /find-my-orders.html and the help pages (about, how it works, FAQ, contact, terms, privacy, refunds and returns, shipping, seller guidelines). Can leave a review after delivery, ask for help with an order and report a listing, all without logging in: the tracking link proves who they are.
- Seller: also sets their city, how many days they take to dispatch (1 to 7) and their return window (no returns, 7, 10, 15 or 30 days); replies to reviews; answers help requests.
- Admin: also moderates reviews and reported listings, resolves help requests, reads contact messages and the email outbox, and sets the early-bird offer.

Add to "What people do":
10. Discover: the header has a big search box, the category menu and a "Sell on Bazaar Lane" button. The home page shows featured products. Every product can be reached in 3 clicks or fewer. Search results and category lists can be filtered by price range, shop, city, in stock only and rating, and sorted by newest, price (low to high, high to low) and top rated; the filters stay in the address, so a search can be shared. Each category shows its products on a rotating 3D carousel, with a "See all as a list" link.
11. Decide: the product page shows the price, the shop (with a link, its city and its rating), the stock status in words (In stock / Only 3 left / Sold out), that shop's shipping fee and free-shipping limit, a delivery estimate (the shop's dispatch days plus 2 to 5 days), the shop's return window, the rating and reviews, "More from this shop" and "Similar products", and a big Add to cart button.
12. Hear back: the customer gets emails (in the outbox): an order confirmation with the order code, the tracking link, each shop's part and every cost; shipped (courier and tracking number); delivered (with a link to leave a review); rejected or cancelled (with the refund note). Sellers get "new order" (only their own part), "shop approved" or "shop rejected" and "payout recorded". "Find my orders" emails a customer all their tracking links; the page shows the same message whether or not that email had orders.
13. Trust: after a shop's part is delivered, the customer can rate each product 1 to 5 stars with an optional review (up to 500 characters) from the tracking link, once per product per order, marked "Verified buyer". The seller can reply once. The admin can hide a review. Product and shop ratings are the averages of the visible reviews.
14. Help: on the tracking page, the customer can open "Help with this order" for one shop's part. The seller and the admin see it, and the seller can add a reply. The admin resolves it with a note, and can cancel and refund the part if it has not been shipped. The customer sees the outcome. Anyone can "Report this listing"; the admin hides the product or dismisses the report.
15. Join early: the admin sets an early-bird offer (how many shops, the rate, how many days). The first shops approved while places are left get the early-bird rate for that many days after their approval.

Change the commission-rate order to: the shop's own rate if set; else the early-bird rate, if the shop is in the early-bird group and still inside its days; else its category's rate; else the default. The rate is still copied into each order when it is placed.

Add to "Data" (db.js adds the new tables and columns safely, without losing any data, and gives the sample shops sample values):
- sellers: city, dispatch_days, return_days, approved_at, early_bird (0 or 1)
- settings: early_bird_slots, early_bird_bps, early_bird_days
- reviews: id, order_item_id (unique), product_id, seller_id, rating (1 to 5), text, seller_reply, hidden (0 or 1), created_at
- help_requests: id, seller_order_id, message, seller_reply, status (open or resolved), resolution, created_at, resolved_at
- reports: id, product_id, reason, status (open, hidden, dismissed), created_at
- contact_messages: id, name, email, message, handled (0 or 1), created_at
- newsletter: id, email (unique), consent_at, unsubscribe_token
- emails: id, to_address, subject, body, created_at
- product_views: product_id, day, count (a customer opening a product page adds 1; sellers and the admin do not count)

Add to "Rules the server enforces":
- A review needs the right tracking token and a delivered seller order that contains that product. One review per order item.
- Customer pages only show visible reviews. Hidden reviews count for nothing.
- Help requests, reports and contact messages are at most 2000 characters. A seller order can have only one open help request at a time.
- An admin password must be at least 12 characters.

Add these lines to the checklist:
Browse and discover
- B1. The header has a big search box, the category menu and a "Sell on Bazaar Lane" button. The home page shows featured products. Every product can be reached in 3 clicks or fewer.
- B2. Search and category lists filter by price range, shop, city, in stock only and rating, and sort by newest, price and top rated. Only products that can be bought appear. The filters stay in the address.
- B3. Every category page, and every category on a storefront, shows its products on the rotating 3D carousel (it turns with the wheel, a swipe, the arrows and a click, and respects reduce motion), with a "See all as a list" link.
- B4. The product page shows the price, the shop and its rating, the stock status in words, the shop's shipping fee and free-shipping limit, a delivery estimate, the return window, reviews, related products and Add to cart.
Trust and help
- T1. Only a customer with the tracking link and a delivered order can review that product, once per product per order, marked Verified buyer. The seller can reply once, the admin can hide it, and the ratings update.
- T2. "Help with this order" reaches the seller and the admin. The admin resolves it with a note (with a cancel and refund if it was not shipped), and the customer sees the outcome.
- T3. "Report this listing" reaches the admin, who hides the product or dismisses the report.
- T4. The footer links to About, How it works, Sell with us, FAQ, Contact (the form reaches the admin), Terms, Privacy, Refunds and returns, Shipping and Seller guidelines. The refunds page says clearly who handles what: sellers ship and handle returns, the platform refunds online payments for rejected or cancelled parts, and disputes go through Help with this order.
Emails
- E1. Order confirmation, new order (to the seller, only their part), shipped, delivered (with a review link), rejected or cancelled, shop approved or rejected, and payout emails land in the outbox with the right details. No email contains a password.
- E2. "Find my orders" emails the tracking links for that address, and the page shows the same message whether or not orders were found.
Launch
- L1. Every customer page has its own title and meta description from the server, one H1 and a clean address. /sitemap.xml lists the active shops, categories and buyable products, /robots.txt exists, and a wrong address shows a friendly 404 page with search and a link home.
- L2. Customer pages load no outside fonts or scripts, emoji pictures have text labels, status is never colour alone, and the cart and checkout work with the keyboard only.
- L3. npm run backup makes a dated copy of marketplace.db and deletes nothing.
Commissions
- M4. The early-bird offer gives the first shops approved its rate for its number of days, unless the shop has its own rate. It is copied into orders like any other rate.
Dashboards
- A3. The admin dashboard also shows open help requests, open reports and the outbox count. The seller dashboard also shows their shop rating, product views this week, and orders divided by views.

Change the plan in the Stage section to these sectors: 1 logins and sellers (done), 2 products, categories, search and storefronts, 3 cart, checkout and emails, 4 payments, 5 orders, fulfilment and help, 6 reviews and trust, 7 commissions and payouts, 8 dashboards, 9 trust pages, SEO and launch, then the final proof.
```

You should see a short list of what Claude added, and maybe a question if something clashed. Answer it, then go on.

**Already pasted the old Sector 2 build prompt?** That's fine. Paste the notebook upgrade above anyway, then the new build prompt below: Claude adds what is missing and keeps what works.

### 2b · Build products, categories and search

```text
Build sector 2 only: products, stock, categories, search and storefronts. Read the upgraded CLAUDE.md first. The categories show a simple grid for now: the rotating carousel comes in the next message.
- Seller: shop settings (description, city, dispatch days, return window, shipping fee, free shipping above). A Products page with add, edit, switch off and delete (deleted products are hidden, never erased). Fields: name (include a plain word buyers would search for, like "pickle" or "pot"), category, price in rupees (saved as paise), description (what it is made of, its size, how to use it), an emoji instead of a photo, stock, and a low-stock level. A stock column with an amount box, + and - buttons, and a LOW tag (the word LOW, not just a colour). Stock never goes below 0. A seller only ever sees and changes their own products: the server refuses anything else with 403.
- Admin: an All products page with search and a Hide button. A hidden product cannot be switched back on by its seller.
- A header on every customer page: the logo (links home), a big search box, a Categories menu, and a "Sell on Bazaar Lane" button.
- Home page: one clear headline that says what the marketplace sells, the big search box, category tiles, 8 featured products (the newest buyable ones), the open shops with their city, and a "Sell on Bazaar Lane" band.
- /search?q=...: results with filters (price from and to, shop, city, in stock only) and sorting (newest, price low to high, price high to low). The filters stay in the address. Only products that can be bought appear. (Rating filters and "top rated" come with reviews in sector 6.)
- /category/<slug>: the category name as the H1, a breadcrumb (Home > Category), and its products in a grid with the same filters and sorting as search.
- /store/<slug>: the shop's name, city, description, shipping and return info, a row of chips for the categories it sells, and the chosen category's products. A pending, rejected or suspended shop says "This shop is not available".
- /product/<id>-<slug> (an old /product/<id> address goes there too): the emoji picture with a text label, the name as the H1, a breadcrumb (Home > Category > Product), the price, a link to the shop with its city, the stock status in words (In stock / Only N left / Sold out), the shop's shipping fee and free-shipping limit, a delivery estimate (dispatch days plus 2 to 5 days), the return window, the description, "More from this shop" and "Similar products" (same category), and a big Add to cart button (the cart comes in sector 3, so for now it says "Cart coming soon"). A customer opening it adds 1 to product_views.
- /sell (Sell with us): why sell here, the 3 steps (sign up, get approved, add products), the commission (the default rate, and the early-bird offer if it is set), and a big "Start selling" button that opens the sign-up page.
- The server puts each page's own title and meta description in before sending it.
- Phone first. Every product can be reached in 3 clicks or fewer.
Do not restart the app: it restarts itself. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

### 2c · Make every category rotate

**What:** every category, on its own page and on each storefront, shows its products on a turning 3D ring. The middle product is big and faces you, the ones beside it turn away and shrink, and a scroll or swipe swings the next one in, with the names sliding along underneath.

```text
Replace the product grid on every category page and on every storefront category with a rotating 3D product carousel. Keep everything that already works (products, stock, filters, search, and every server rule in CLAUDE.md). Build it with plain CSS 3D transforms and a little JavaScript (no libraries, no WebGL), as one reusable piece used everywhere.
How it looks:
- The chosen product stands in the middle, big, facing the customer with a slight tilt. The products on each side get smaller, turn away (about 40 degrees), sit further back and fade a little, as if they stand on a slowly turning ring. Show at most 3 on each side.
- Each product is a card shaped like a product box: its emoji very large on a coloured block (pick the colour from the product, so every product looks different), with the shop name small in a corner.
- Under the carousel, a name strip moves with it: the middle product's name big and bold, its price like Rs 250, its stock status in words, its shop, and a View button (Add to cart once the cart exists). The neighbours' names show smaller and dimmed on each side.
How it moves:
- It turns one product at a time: the mouse wheel or trackpad while the pointer is over the carousel, a sideways swipe on a phone, the left and right arrow keys, left and right arrow buttons (at least 44 pixels), or clicking a side product. Each turn takes about 0.6 seconds with a smooth ease and a short blur while moving. After the last product it goes round to the first.
- A vertical swipe or scroll outside the carousel still scrolls the page normally.
- It turns by itself every 4 seconds when nobody is using it, and stops while the mouse is over it, while it is touched, or while it has keyboard focus.
- Picking another category (or chip on a storefront): the old products swing out to the side and the new ones swing in.
Rules:
- Only products that can be bought are shown, exactly as the server already decides. A sold-out product shows a "Sold out" ribbon with the words, and no Add button. A category with one product shows it alone in the middle. A category with none says "Nothing here yet".
- Under the carousel, "See all as a list" shows the same products as the grid with the filters and sorting, so search, filters and screen readers still work.
- Phone first: at 390 pixels wide the middle product fills most of the width, the neighbours peek in at the edges, and nothing makes the page scroll sideways.
- If the laptop is set to reduce motion: no turning animation and no auto-turn; the arrows and keys still switch products instantly.
- Move things only with transform and opacity, so it stays smooth on a cheap phone.
- Copy only this movement idea, never any real brand's pictures, names or design.
Do not restart the app. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

If it feels too much:

```text
The carousel turns too fast and too far. Make each turn 0.8 seconds, turn the side products only 30 degrees, and stop the auto-turn.
```

**Try it:** as a seller, add a product, change a price, switch one off and reduce one until it shows LOW. As a customer, search for it, filter by price and city, open a category and turn the carousel, open the product page, and check the shipping, delivery estimate and return window. Log in as a different seller: you must not see the first seller's products.

```text
The app is running. Test sector 2 on a separate copy with its own port and database. As a seller: add a ZZ product and check it shows in its category, on the storefront, in search and on the home page; change its price; switch it off; delete it; add 5 stock, take away 2, try to take away more than there is (refused); push one product down to its low-stock level and check it shows the word LOW. As a different seller, try to edit the first seller's product by calling the server directly (403). As the admin, hide a product and check the seller cannot switch it back on. As a customer: search by part of a name; filter by price, shop, city and in stock; sort by price; check the filters stay in the address; check a product page shows the stock status in words, the shipping fee and free-shipping limit, a delivery estimate, the return window and related products; check each page has its own title and meta description and one H1; check a suspended shop's page says it is not available; check every product can be reached in 3 clicks from the home page; check opening a product page as a customer adds a view and as a seller does not. Then test the carousel: the right products in every category, a sold-out one has no Add button, the arrows, arrow keys, a click on a side product and one wheel scroll each turn exactly one product, it goes round after the last one, auto-turn stops while the mouse is over it, at 390 pixels nothing scrolls sideways, and with reduce motion on it switches instantly. Give me a table: what you tested, what the app answered, PASS or FAIL.
```

---

## 5 · Sector 3: Cart, checkout and emails

**What:** one cart from many shops, every cost shown before paying, one checkout split into one order per shop, emails in an outbox, and a way for customers to find their orders. Cash on delivery only for now.

**Why:** the guide says surprise costs at checkout drive away nearly half of buyers, and forcing people to make an account loses more. So every cost shows early, and checkout is one page for guests.

```text
Build sector 3 only: the cart, checkout, tracking and emails. Cash on delivery only in this sector (online payment comes in sector 4).
- Cart (saved in the browser), with a badge on the header's cart button: add from a product page or the carousel, quantity + and - (1 to 20), remove, grouped by shop. Each shop's group shows its subtotal, its shipping fee or "Free shipping", a hint like "Add Rs 120 more from Chilli Lane Pantry for free shipping", and its delivery estimate. Then the grand total. Every cost is visible before checkout. Prices come from the server, so a changed price shows up in the cart.
- Checkout: ONE page for guests, with a progress line (Cart, Details, Pay, Done): name, 10-digit phone, email, address, payment method (Cash on delivery for now), and an order summary with every cost. The button says the total, like "Place order - Rs 1,240".
- orderStatus.js: the ONE function every status change goes through, with the table of allowed moves and who may make each one, exactly as in CLAUDE.md. It refuses everything else with a clear message and writes each change, who made it and the time into status_log.
- Server checkout: check every rule in CLAUDE.md; work out every total, shipping fee and commission on the server (copy the rate into the order); take the stock off in the same transaction, with the database update checking stock >= quantity so two customers can never both buy the last item; make one customer order (a code like BZ-1001 and a long random tracking token) with one seller order per shop. A total or price sent by the browser is ignored.
- Tracking page /track/<token> (it is also the thank-you page): the order code, how it is paid, the delivery address, and each shop's part with its products, costs, delivery estimate, current status, every earlier status with its time, and any reason. A Cancel button on a part that is still placed (through the status function; the stock goes back). A wrong token shows "Order not found". After checkout, go straight there and remember the link in the browser.
- mail.js and the outbox: the order confirmation to the customer (code, tracking link, each shop's part, every cost), a "new order" email to each seller with only their own part, and a cancellation email when a part is cancelled. /admin/outbox.html lists every email, newest first, and opens one.
- /find-my-orders.html: the customer types their email; the outbox gets one email listing all their tracking links; the page always says "If we have orders for that email, we have sent the links."
- Admin: an Orders page listing every customer order with its seller parts (read only for now). Seller: a read-only list of their own new orders.
Do not restart the app. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

**Be the customer:** add 2 products from Chilli Lane Pantry and 1 from another shop. Open the cart: two groups, two shipping fees, a free-shipping hint. Check out with cash on delivery. You land on the tracking page. Open `/admin/outbox.html` as the admin: the confirmation and two "new order" emails are there.

```text
The app is running. Test sector 3 on a separate copy with its own port and database. Place a ZZ order with 3 products from 2 shops and check every total by hand, including each shop's shipping and free shipping; send a fake total of Rs 1 from the browser and check it is ignored; try a bad phone, a bad email, a missing address, an empty cart and a quantity of 99; try a switched-off product, a deleted product, a hidden product and a product from a suspended shop by calling the server directly; try to buy more than is in stock; send 20 orders at the same moment for a product with only 5 left and check exactly 5 succeed and the stock ends at 0; open the tracking page with a wrong token; cancel a placed part and check its stock comes back. Check the outbox: the customer's confirmation has the code, the link and every cost; each seller's "new order" email has only their own part and nothing about the other shop; the cancellation email arrived; no email contains a password. Check "Find my orders" sends the links for a known email and shows the same message for an unknown one. Give me a table: what you tried, what the app answered, PASS or FAIL.
```

---

## ★ Before Sector 4: switch to the Interaction Kit

**What:** the whole marketplace switches to the **Interaction Kit** (`Interaction Kit.zip`, made for Bazaar Lane): its colours and font, its 14 shop pieces (product cards, add-to-bag button, toasts, free-shipping meter, order tracker…) and its rules. Emoji pictures are replaced by real product photos.

**Why:** the kit is calm and consistent, with one marigold action colour per screen, real photos, and motion that only confirms things. The emoji-on-coloured-block look reads as "AI made this". From here on, every sector uses the kit's pieces in the places its `screen-map.md` names.

**Photos: yes, add them.** The kit wants a 4:5 photo for every product, centred on a plain light backdrop. Take your own, or use free photos you are allowed to use (Unsplash and Pexels allow it; check each photo's licence, and don't use AI-made or copyrighted shop photos). Put them in a folder, for example `~/Downloads/product-photos/`, named after the product (`green-chilli-pickle.jpg`). Until a product has a photo, the kit's placeholder art shows, which is fine for testing but not for the final demo.

### K1 · Notebook and set-up (paste first)

```text
We are switching the whole marketplace to a design kit. Unzip /Users/a91970/Downloads/Interaction Kit.zip into a folder called kit/ in this project (skip the __MACOSX folder) and read kit/README.md, kit/screen-map.md, kit/tokens.css and kit/api/ before doing anything. Then update CLAUDE.md (I am asking for these rule changes):
- Add to "How to build it": the look comes from the Interaction Kit in kit/. The colours, sizes and timings are the kit's tokens (theme "lane", with "night" as dark mode); the pieces are the kit's 14 components, loaded the kit's "Load the bundle" way: React 18 and ReactDOM 18 (installed from npm and served by this app from node_modules, no outside website), kit/tokens.css, kit/components/bundle.css and kit/components/bundle.js (window.IK), mounted into plain HTML pages with small plain JavaScript files. This is the ONLY use of React allowed: no build step, no JSX, no other frameworks. The font is Instrument Sans, installed from npm (@fontsource/instrument-sans) and served by this app.
- Follow the kit's rules in kit/README.md: one accent (marigold) action per screen; sentence case; buttons start with a verb ("Add to bag", "View bag"); no exclamation marks; NO emoji anywhere in the interface; icons are inline SVG from the kit; every product shows its maker ("Shop name · City"); "Only 2 left" only when it is true; no fake urgency; sound off by default; reduced motion keeps every state change and drops the travel.
- Money is shown with IK.formatMoney: ₹ with Indian grouping and no paise on product prices (₹1,299, ₹1,24,580). It is still stored as paise.
- Products have a photo (4:5). Add a photo column to products (db.js adds it safely). Sellers upload a JPEG, PNG or WebP photo of at most 2 MB on their Products page; the server checks the type by its first bytes, gives it a random file name in an uploads folder, and never trusts the name sent by the browser. A product without a photo shows the kit's placeholder art (IK.demo.art).
- Keep every rule that is already there (server decides prices and totals, sellers only see their own shop, and so on).
Then set it up: install react@18, react-dom@18 and @fontsource/instrument-sans; serve the files the pages need; allow them in the safety headers (still only from this site); replace the old colours in public/style.css with the kit's tokens so the pages that are not rebuilt yet still look like the kit; remove every emoji from the interface. Do not rebuild the pages yet. Run npm run check, and tell me what you changed. Update the Stage section of CLAUDE.md.
```

### K2 · Rebuild what is already built with the kit

```text
Rebuild the pages that already exist with the Interaction Kit, following kit/screen-map.md. Keep every feature, every server rule and every test passing.
- Header on every customer page: the name, search, categories, Sell on Bazaar Lane, and a bag button whose count is a RollingNumber.
- Home: a CollectionAccordion with the top 4 or 5 categories (each with a product photo), then a "New from makers" row of ProductCards.
- Category, search and storefront lists: a ProductCard grid with WishlistHeart (the wishlist is saved in the browser), SkeletonCards in the exact page size while loading, and the vendor line ("Shop · City") on every card.
- The rotating category carousel stays, but every face is now the product's photo (4:5, no coloured block, no emoji), with the name strip using the kit's type and colours. It still respects reduced motion.
- Product page: the photo, VariantPicker only if the product has options (skip it otherwise), QuantityStepper, AddToCartButton as the ONLY accent on the page, WishlistHeart, and the price as a RollingNumber.
- After every add: a ToastStack "Added to bag" toast with the photo and View bag, and the bag count rolls.
- Cart and checkout (if built): a FreeShippingMeter per shop, QuantityStepper (sm), and ConfirmButton for Remove with Undo in place; the subtotal is a RollingNumber.
- Seller products page: a photo upload on each product, and ConfirmButton for Delete and Switch off.
- Order tracking page (if built): OrderTracker with one human sentence per update ("Chilli Lane Pantry packed your pickle.").
- Every staff page uses the kit's tokens, type and buttons.
Check every page at 390 pixels and on a laptop, in light and in night theme, and with reduced motion on. Run npm run check. Tell me what to click, and update the Stage section of CLAUDE.md.
```

Then add your photos:

```text
I put product photos in (the folder, for example /Users/a91970/Downloads/product-photos). Each file is named after its product. Attach each photo to the product with the closest name in my real marketplace through the same rules as a seller upload (type check, size limit, random file name). List any photo you could not match and any product that still has no photo. Do not change anything else.
```

**Try it:** open the home page on your phone width. You should see photos, the accordion, calm marigold buttons and no emoji. Add something to the bag: the button ticks, a toast slides in and the bag count rolls.

From here, each sector below says which kit pieces it uses.

---

## 6 · Sector 4: Payments

**What:** pay online in test mode. FakePay works offline with no sign-up. Razorpay test keys work if you add them. Every payment shows how it splits between the platform and each shop.

**Why:** the guide calls payments and commissions the engine of a marketplace. A browser can lie, so "I paid" only counts when the server has checked it with the provider. Nobody pays real money here.

```text
Build sector 4 only: online payments in test mode, and refunds.
- payments.js with three functions, createPayment, verifyPayment and refund, and two providers behind them:
  1. FakePay (the default, used when no Razorpay keys are set): /pay/fake/<payment id> shows the amount and three buttons: "Pay with UPI (test)", "Pay with card (test)" and "Fail (test)". The result comes back to the server with a signature made with a secret the browser never sees, and the server checks that signature before believing it.
  2. Razorpay test mode, used only when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set as environment variables. Refuse to start if the key is a live key (rzp_live_). Verify every payment signature on the server, and refund through Razorpay's refund API. Allow Razorpay's checkout script in the safety headers only when Razorpay is used.
- Checkout: add "Pay online" next to cash on delivery. An online order is saved as pending_payment (stock already reserved), sellers cannot see it and get no email yet, and the customer is sent to pay. Only after verifyPayment succeeds does each seller order move to placed, through the status function, as the system; then the confirmation and "new order" emails go out. A failed payment cancels the order, puts the stock back and emails the customer. An unpaid order older than 30 minutes is cancelled the same way: check every minute, and add an admin-only "Run the 30-minute check now" button so it can be tested.
- Refunds: when a paid seller order is rejected or cancelled, refund exactly that seller order's total, once, record it in the refunds table, and email the customer the refund note. Other shops' parts of the same order are untouched. If a refund fails, keep the order cancelled and show the admin "Refund failed, try again".
- Admin: a Payments page with every payment and refund, and for each payment how it splits per shop: that shop's total, the platform's commission and the shop's share. A COD on/off switch: when COD is off, COD checkout is refused by the server.
- Tracking page: shows "Waiting for payment", "Paid" or "Refunded" for each part.
- Look (Interaction Kit): OtpInput to check the phone before a cash-on-delivery order; on the order confirmation the total is a RollingNumber that rolls up once (the kit's one celebration); payment errors say what happened and what to do next ("Payment declined. Try another card or UPI."); the FakePay page uses the kit's buttons, with Pay as the only accent.
Do not restart the app. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

**Try it:** check out with Pay online and press "Pay with UPI (test)": both parts become placed and the emails appear in the outbox. Check out again and press "Fail (test)": the order is cancelled and the stock comes back.

```text
The app is running. Test sector 4 on a separate copy with its own port and database, using FakePay. Pay a ZZ online order and check both seller orders become placed and only then do the emails go out; try to mark an order paid by sending a made-up result without a valid signature (refused); fail a payment and check the stock comes back and the customer is emailed; make an unpaid order 31 minutes old in the test database, run the 30-minute check, and check it is cancelled with the stock back; switch COD off and check COD checkout is refused, then switch it back on; refund one part of a paid 2-shop order and check only that part is refunded, a second refund is refused, the refund is never bigger than what was paid, and the refund email arrived; check the Payments page shows the split per shop and the numbers add up. Give me a table: what you tested, what the app answered, PASS or FAIL.
```

---

## 7 · Sector 5: Orders, fulfilment and help

**What:** each seller works through their own orders (accept or reject, pack, ship, deliver), customers hear about every step, and anyone with a problem can ask for help.

**Why:** in a marketplace the sellers ship, and the platform keeps the peace. The guide says the platform's job is the ecosystem: moderating, resolving disputes, and keeping things running.

```text
Build sector 5 only: seller orders, fulfilment and help requests.
- Seller: an Orders page with tabs New, To pack, Shipped and Done, showing ONLY their own seller orders (never pending_payment ones), with the customer's name, phone and address, the products, the totals and a "Ship by" date (placed date plus the shop's dispatch days, shown in red with the word LATE when it has passed). Buttons: Accept, Reject (asks for a reason), Packed, Shipped (asks for the courier name and tracking number, both required), Delivered, and Cash collected on COD orders. Every button goes through the status function, which also checks the order belongs to this seller.
- Rejected or cancelled: put the stock back, and refund through payments.js if it was paid online (only that seller's part).
- Emails: shipped (with the courier and tracking number), delivered (with a "Leave a review" link to the tracking page), and rejected or cancelled (with the reason and the refund note).
- Admin: on the Orders page, Cancel for placed, accepted or packed seller orders (reason required, with stock back and refund), and Mark delivered for shipped ones.
- Help with this order: on the tracking page, each shop's part has a "Help with this order" button (a message of up to 2000 characters; only one open request per part). The seller sees it on that order and can add one reply. The admin has a Help requests page with Open and Resolved tabs, and resolves each one with a note; while the part is not shipped, the admin can also cancel and refund it from there. The customer sees the reply and the outcome on the tracking page.
- The customer's tracking page shows the courier and tracking number once shipped, and every reason.
- A suspended shop can still fulfil and refund its orders already placed, but gets no new ones.
- Look (Interaction Kit): the tracking page uses OrderTracker with one human sentence per update ("Chilli Lane Pantry shipped your order with BlueDart."); the seller's Reject and the admin's Cancel use ConfirmButton; new orders arrive on seller screens as a ToastStack toast.
Do not restart the app. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

**Be everyone:** place a 2-shop order. Seller A accepts, packs, ships and delivers. Seller B rejects with a reason. On the tracking link: one part delivered, one rejected with the reason. Open "Help with this order" on the delivered part; reply as seller A; resolve it as the admin.

```text
The app is running. Test sector 5 on a separate copy with its own port and database. Place a ZZ 2-shop order paid online. As seller A: accept, try Shipped without a tracking number (refused), pack, ship with a courier and tracking number, deliver. As seller B: try to accept seller A's order by calling the server directly (refused), then reject their own part and check only their part is refunded and its stock comes back. Try to skip a step (placed straight to delivered) and to go back (shipped to packed), as the seller and as the admin (refused). Try to cancel from the tracking link after the seller accepted (refused). Check the shipped, delivered and rejected emails in the outbox. Make a ZZ order older than its dispatch days in the test database and check it shows LATE. Open a help request, try to open a second one on the same part (refused), reply as the seller, try to reply as the other seller (refused), resolve it as the admin, and check the customer sees the outcome. Check a COD order: Cash collected marks it paid. Give me a table: what you tested, what the app answered, PASS or FAIL.
```

---

## 8 · Sector 6: Reviews and trust

**What:** verified reviews and star ratings, seller replies, reported listings, and the admin's moderation.

**Why:** the guide lists reviews and ratings as a core marketplace feature: they are how buyers trust a shop they have never heard of. "Verified buyer" stops fake reviews.

```text
Build sector 6 only: reviews and trust.
- Reviews: once a shop's part is delivered, its products show "Rate this product" on the tracking page: 1 to 5 stars (with the number written too, for screen readers) and an optional review of up to 500 characters. One review per product per order, and the server checks the tracking token and that the part is delivered. Each review shows the first name and "Verified buyer".
- The product page shows the average rating with the number of reviews ("4.6 out of 5, 12 reviews") and the newest reviews with any seller reply. Shop cards and storefronts show the shop's average rating. Products without reviews say "No reviews yet".
- Seller: a Reviews page with their products' reviews and one Reply per review.
- Report this listing: a small link on every product page (a reason of up to 2000 characters). The admin has a Reports page: Hide the product or Dismiss the report.
- Admin: a Reviews page to hide or show any review. Hidden reviews disappear from customer pages and from every average.
- Search and categories: the rating filter (4 stars and up) and the "Top rated" sort now work.
- Look (Interaction Kit): stars are inline SVG in the kit's colours (never emoji), with the number written beside them; Hide and Report use ConfirmButton; a posted review shows a ToastStack toast.
Do not restart the app. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

```text
The app is running. Test sector 6 on a separate copy with its own port and database. Try to review a product before its part is delivered, with a wrong token, and a product that was not in the order (all refused). Deliver a ZZ order and leave a review; try to review the same product from the same order again (refused); check the average and count update on the product page and the shop's rating; reply as the seller, try a second reply (refused) and try to reply as another seller (refused); hide the review as the admin and check it disappears and the average changes back; report a listing and hide it as the admin, then check it can no longer be bought; check "4 stars and up" and "Top rated" in search. Give me a table: what you tested, what the app answered, PASS or FAIL.
```

---

## 9 · Sector 7: Commissions and payouts

**What:** the platform's cut, an early-bird offer for the first sellers, a ledger for every rupee, seller balances and payouts.

**Why:** commissions are how the marketplace earns. The guide's example: a Rs 100 sale sends Rs 10 to the platform and Rs 90 to the seller. It also suggests winning your first sellers with a lower early-bird rate, because a marketplace needs sellers before it can attract buyers.

```text
Build sector 7 only: commissions, the early-bird offer, the ledger and payouts.
- Admin: a Commissions page to set the default rate, a rate per category, an optional rate per shop, and the early-bird offer (how many shops, the rate, how many days), all in percent on screen and saved as basis points. When a shop is approved while early-bird places are left, it joins the early-bird group. Show which rate each shop actually gets today and why (own rate, early-bird until a date, category or default).
- The rate is copied into each order when it is placed, so later changes never change old orders.
- When a seller order is delivered, book it in the ledger exactly once: online = earning of items + shipping - commission; COD = commission owed (a negative amount), because the seller already holds the cash. Rejected and cancelled orders book nothing.
- Seller: an Earnings page with each delivered order (items, shipping, rate, commission, what they earn or owe), their payouts and their balance. A negative balance says "You owe Rs N". The Sell with us page shows the current early-bird offer and how many places are left.
- Admin: a Payouts page listing every shop's balance, and Record payout (amount and a reference note). A payout bigger than the balance is refused. It only records money: it does not send real money. The seller gets a "payout recorded" email.
- Show the commission on each seller order on the admin Orders page.
- Look (Interaction Kit): balances and payout totals are RollingNumbers; Record payout uses ConfirmButton; money uses IK.formatMoney.
Do not restart the app. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

```text
The app is running. Test sector 7 on a separate copy with its own port and database. Set an early-bird offer of 2 shops at 5% for 90 days, approve 3 ZZ shops and check only the first 2 get it; check a shop with its own rate keeps its own rate; move an early-bird shop's approval date back 91 days in the test database and check it falls back to its category rate. Place and deliver a ZZ online order and check the ledger by hand (write out the sum: items + shipping - commission). Deliver a ZZ COD order and check the commission owed. Change a rate and check old orders keep the old rate. Reject an order and check nothing is booked. Deliver the same order twice by calling the server directly and check it is booked only once. Record a payout bigger than the balance (refused), then a correct one, and check the balance and the payout email. Give me a table: what you tested, the numbers you expected, what the app showed, PASS or FAIL.
```

---

## 10 · Sector 8: Dashboards

**What:** the central admin dashboard, and each seller's own dashboard, with the numbers the guide says to watch.

```text
Build sector 8 only: the dashboards.
- Admin home becomes the central dashboard: big number tiles for orders today, sales today (delivered seller orders only, counted on the day they were delivered), commission earned today, seller orders in each status, shops waiting for approval, LOW products across all shops, payouts due (the sum of all positive balances), open help requests, open reports, emails in the outbox today, and how many minutes the oldest placed seller order has waited for its seller. Open orders are always counted, even old ones. Delivered, rejected and cancelled orders are counted on the day they finished. Make a tile red (with a word, not just the colour) when the waiting time is MORE than 60 minutes, when anything is LOW, when any shop is waiting for approval, or when any help request is open. A table of the top 5 shops and the top 5 categories by sales this week. Big links to Shops, Products, Orders, Payments, Commissions, Payouts, Help requests, Reviews, Reports and the outbox, with badges for shops waiting, open help requests and open reports.
- Seller home becomes their dashboard, for their shop only: new orders (with a badge on the Orders link), orders to pack, LATE orders, sales today, balance, shop rating, product views this week, orders divided by views (as a percent), and LOW products listed by name.
- Long numbers shrink to fit their tile. Both pages refresh every 5 seconds.
- Look (Interaction Kit): every big number is a RollingNumber KPI in the kit's type-kpi style; the seller dashboard has StackedBars of sales by week split by category; red tiles become the kit's danger colour WITH a word; no coloured blocks or emoji.
Do not restart the app. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

```text
The app is running. Check both dashboards: compare each number they show with what you can count yourself straight from the database, without using the dashboard code. Show me a table: each number, what the dashboard says, what you counted, PASS or FAIL. Also check the red rules at the edges: an order waiting exactly 60 minutes is not red, and 61 minutes is red (use the test copy to make orders older). Check that a seller's views do not count towards their own product views.
```

---

## 11 · Sector 9: Trust pages, SEO and launch

**What:** the pages every store needs, a site search engines can read, safety checks, and backups, from the guide's legal advice, its SEO step and its launch checklist.

**Why:** the guide says a marketplace typically needs a privacy policy, terms and a clear refund policy, and must say who handles returns, refunds and damage. It also says to start SEO small (good titles, headings and clean addresses), test everything before opening, and keep backups.

```text
Build sector 9 only: trust pages, SEO and launch readiness.
- Pages, in plain words, filled in for this marketplace (not lorem ipsum): About; How it works (for buyers and for sellers); FAQ (shipping, returns, payments, how shops are checked, reviews); Contact (a form that saves to contact_messages, with "We reply within 2 working days"; the admin has a Messages page with a Handled button); Terms; Privacy (what we keep: name, phone, email, address; why; how long; how to ask us to delete it); Refunds and returns (sellers ship and handle returns within their return window; the platform refunds online payments when a part is rejected or cancelled; problems go through Help with this order); Shipping (each shop's fee, free-shipping limit and dispatch days); Seller guidelines (what may be sold, banned items, honest descriptions, shipping on time, how reviews and reports work). Put this line at the bottom of the legal pages: "Template text, not legal advice. Have a professional check it before going live."
- A footer on every customer page with all those links, "Sell on Bazaar Lane", and a newsletter sign-up (email plus a consent tick box, saved in the newsletter table; /unsubscribe/<token> removes it and says so).
- SEO: check every customer page has its own title and meta description from the server, exactly one H1 and a clean address; /sitemap.xml lists the home page, the help pages, active shops, categories and buyable products; /robots.txt allows everything except /admin, /seller, /track and /pay, and points to the sitemap; a friendly 404 page with the search box and a link home for any wrong address; the emoji as the browser-tab icon.
- Speed and access: no outside fonts or scripts on customer pages; long cache times for style.css and the JavaScript files; every emoji picture has a text label; status is never colour alone; check the cart and checkout can be done with the keyboard only.
- Safety (from the guide's security checklist): confirm passwords are hashed, sessions are httpOnly, every input is checked on the server, and every page uses textContent. An admin password must be at least 12 characters. Add a COOKIE_SECURE setting that adds the Secure flag to the session cookie, to switch on when the site runs on HTTPS.
- Backups: npm run backup copies marketplace.db into a backups folder with the date and time in the name, and deletes nothing.
- Look (Interaction Kit): every help and policy page uses the kit's type and spacing; the newsletter sign-up and contact form use the kit's inputs and one accent button; a light/night theme switch in the footer (remembered in the browser); a sound toggle that is off by default.
Do not restart the app. When you are done, tell me what to click, and update the Stage section of CLAUDE.md.
```

Then run the guide's launch checklist:

```text
Run a launch check on the running app, on a separate copy with its own port and database. Visit every page a customer, a seller and the admin can reach and follow every link: list any link that gives an error or a 404. Send every form once with good data and once with bad data, and check good data is saved and bad data gets a clear message. Check every customer page has a different title and meta description and one H1. Check /sitemap.xml lists only things that exist and can be seen, /robots.txt is right, and a made-up address shows the friendly 404 page. Check there are no errors in the browser console on any page. Check every page at 390 pixels wide (nothing scrolls sideways, buttons at least 44 pixels). Run npm run backup and check the copy appears and nothing was deleted. Give me a table: what you checked, what you found, fixed, PASS or FAIL.
```

---

## 12 · Final proof

**What:** an automatic test of the whole marketplace, then opening day played by you.

**Why:** "it seems to work" is not a finish line. The guide says the same: break your own site before customers do.

### The automatic test

```text
Write an automatic test for the whole marketplace. It starts its own copy of the app on port 3101 with its own empty database in the system temp folder (deleted at the start and at the end, and it must refuse to ever delete marketplace.db), using FakePay so it needs no internet. It never touches my real data, and my running app is left alone. If port 3101 is busy, it stops with a clear message. It logs in with the demo accounts, plays the marketplace by itself, and tests every item on the checklist in CLAUDE.md that a program can test: S1 to S5, P1 to P6, B1, B2, B4, C1 to C5, Y1 to Y4, F1 to F4, T1 to T4, E1, E2, M1 to M4, A1 to A3, L1, L3 and G1 (for G1 it stops its copy, starts it again on the same database, and compares everything before and after). For each item print one line: PASS or FAIL, the item number, and what was checked. End with "N of M passed", and exit with an error if anything failed. Make it run with npm run check. Tell me which items it cannot test, because those are for me to test by hand. Run it once and show me the result.
```

If a line says FAIL (change T1 to the item that failed):

```text
Item T1 failed. Find out whether the app or the test is wrong, fix the right one, and run the test again.
```

Prove the test really catches mistakes:

```text
Prove that npm run check really catches bugs. Make a throw-away copy of the project somewhere outside this folder (never copy marketplace.db), break one rule in the copy on purpose (for example, let a customer review a product before it is delivered), run the test in the copy, and show me which items fail. Do not change my real files. Then delete the throw-away copy and tell me my real code still has the rule.
```

### Start from fresh data

```text
Reset the marketplace to its starting data: remove all saved orders, payments, refunds, ledger entries, reviews, help requests, reports, contact messages, newsletter sign-ups, emails and product views, and put the sample shops, products, categories, settings and logins back. First run npm run backup, tell me exactly what you will delete, and wait for my yes. Do not delete the marketplace.db file itself: empty the tables and refill them from the sample data.
```

Read the answer, say yes, then make sure the app is running.

### Play opening day

Open five tabs: the home page, a cart, `/admin/`, and two sellers (use a private window for the second seller so the logins don't mix). Then:

- **Find:** search for a product, filter by city, open a category and turn the carousel to a product. Count the clicks from the home page: 3 or fewer?
- **Decide:** on the product page, check the shipping fee, delivery estimate and return window are there before you add it.
- **Buy:** fill one cart from 2 shops. Write down the grand total. Pay online with FakePay.
- **Hear back:** open `/admin/outbox.html`. The confirmation and two "new order" emails are there.
- **Seller A:** accept, pack, ship (with courier and tracking number), deliver.
- **Seller B:** reject with a reason.
- **Customer:** on the tracking link, every step has a time, and seller B's part says refunded with the reason. Leave a review on seller A's product. Open "Help with this order".
- **Seller A:** reply to the review and to the help request. **Admin:** resolve the help request.
- **Money:** check the commission and seller A's balance. Record a payout.
- **COD:** place a COD order, deliver it, press Cash collected, and check seller A now owes the commission.
- **Stock:** buy the last items of a product. The next customer is told it is sold out.
- **Trust:** open every footer link. Send the contact form. Sign up for the newsletter and unsubscribe.
- **Lost:** type a made-up address. You see the friendly 404 page.
- **Find my orders:** use it with your test email, then check the outbox.
- **Phone check:** make the customer tab 390 pixels wide. Can you find, buy and track without scrolling sideways? (G2)
- **Restart:** ask Claude to stop the app and start it again. Is everything still there, and can you still log in? (G1)

Tell Claude what felt wrong. **Replace the brackets with what you actually saw before pasting:**

```text
I played opening day and found these problems. Fix each one, test it, run npm run check again, and tell me what you changed:
1. (what I did, on which page, what I expected, what I saw)
2. (what I did, on which page, what I expected, what I saw)
```

---

## 13 · Make it feel real

The Interaction Kit (section 6) already gives you the layout, the buttons, the toasts, the meters, the tracker and all the motion. Skip the old layout and feel options. Two checks are left:

```text
Check every page against kit/README.md: one accent action per screen, sentence case, no emoji, no exclamation marks, every product names its maker, ₹ with Indian grouping, focus rings on everything I can press, touch targets at least 44 pixels for main buttons, and reduced motion keeps every state change. Check light and night themes at 390 pixels and on a laptop. Fix what fails without changing features, and show me a table: page, problem, fixed, PASS or FAIL.
```

```text
Save a checkpoint of my project now, called "kit look". If checkpoints are not set up yet, set that up first, and make sure marketplace.db, the uploads and backups folders, DEMO_LOGINS.md and any keys are NOT saved in it. If you are asked who I am, use the name Student and the email student@example.com for this project only. Tell me in one line that it is saved.
```

---

## 14 · Make it yours

The guide's first step is to pick a niche: a specific group of people with a shared need. Make Bazaar Lane yours:

```text
Change the marketplace name to (your marketplace's name) everywhere, including page titles, emails, the sitemap and the help pages. Pick the niche (for example local makers, home cooks, or second-hand books) and replace the sample shops and products to fit it, each product with a category, a price in rupees, a stock number, an emoji and a description that answers what a buyer would ask. Keep at least 3 active shops, 1 pending shop, 2 LOW products and 1 switched-off product so every state can still be seen. Update the About, How it works, FAQ and Seller guidelines pages to match. Do not use any real company's name or products. Keep everything else, update DEMO_LOGINS.md, and run npm run check again.
```

Save a copy: in Finder, click the `marketplace` folder once and press Cmd + D. Rename the copy `marketplace-v1`.

Show a friend the home page and say only: "Buy a gift from two different shops." Watch where they get stuck. Each hesitation is your next fix. The guide says the same: add features based on what real people do, not on guesses.

---

## Later ideas (plan only first)

Each of these is a real feature, most of them from the guide and its linked pages. Ask for a plan, then decide.

| Idea | Paste into Claude |
|---|---|
| Customer accounts | How would I add customer accounts with order history and saved addresses, while keeping guest checkout? Plan only. |
| Product photos | How would I let sellers upload product photos safely (size limits, only images, alt text, small files for speed)? Plan only. |
| Variants | How would I add sizes and colours, each with its own stock? Plan only. |
| Back-in-stock alerts | How would a customer ask to be emailed when a sold-out product is back? Plan only. |
| Abandoned carts | How would I send a reminder email when someone leaves items in their cart, and what consent would I need? Plan only. |
| Coupons and gift cards | How would I add coupons from the platform and from a shop, and gift cards, and who pays for each discount? Plan only. |
| Other ways to earn | How would I add paid featured listings or a monthly seller plan, next to commissions? Plan only. |
| Product approval | How would I make a new shop's first products wait for the admin's approval before they go live? Plan only. |
| Returns after delivery | How would I add returns after delivery, with partial refunds and the ledger corrected? Plan only. |
| Real shipping | How would I get real shipping rates and tracking from a courier service? Plan only, and say what it would cost. |
| Live screens | How would a seller see a new order the moment it arrives, without refreshing? Plan only. |
| Automatic payouts | How would sellers add bank details and get paid automatically (for example with Razorpay Route), and what checks would the law need? Plan only. |
| Tax and invoices | How would I make a GST invoice for every seller order, and when would the platform have to collect tax for sellers? Plan only. |
| Real email | How would I send the outbox emails for real with an email service, with my own domain as the sender? Plan only. |
| Two-step login | How would I add two-step verification for sellers and the admin? Plan only. |
| Analytics and search | How would I measure visits, conversion and where buyers come from, and get the site listed in Google Search Console? Plan only. |
| Referrals | How would I give sellers and customers referral links with a reward per sale? Plan only. |
| Going live | What would I need to change to run this for real sellers: domain, hosting with backups and uptime, HTTPS, live payment keys, a security review and a legal review? Plan only. |

---

## Appendix A · What carried over from Chilli Lane

| In Chilli Lane (the restaurant) | In Bazaar Lane (the marketplace) |
|---|---|
| CLAUDE.md notebook with rules, checklist and a Stage section kept up to date | The same, upgraded at the start of Sector 2 to 47 checklist lines |
| Plan first, push back once, then build in parts, test after each part | The same, in 9 sectors |
| Menu: dishes, groups, prices, add-ons, switch off, soft delete | Products per shop: categories, prices, switch off, soft delete, admin can hide |
| Ingredient stock by hand, never below 0, LOW at or below the low level | Product stock taken off automatically at checkout, never below 0 even with many orders at once, LOW warnings |
| ONE status function, forward only, every change logged with its time | The same, with more steps (packed, shipped) and who made each change |
| Names and prices copied into the order | Names, prices AND the commission rate copied into the order |
| The server works out totals; a fake "total: Rs 1" from the browser is ignored | The same, plus shipping and commission |
| A rider sees only their own orders, and the server refuses the rest | Real logins: a seller sees only their own shop, and the server answers 403 to anything else |
| A rider with open orders cannot be switched off | A suspended shop's open orders can still be fulfilled and refunded |
| Cash on delivery and Cash collected | COD, Cash collected, and the commission the seller owes in the ledger |
| Customer tracking page with every status and its time | A private tracking link (a long random token), one tracker per shop, reviews and help from the same link |
| Manager dashboard: tiles, red rules (more than 5 minutes), badge, counting rules | Admin and seller dashboards with the same ideas (red after 60 minutes) |
| `npm run check` on port 3101, its own database deleted at start and end, one line per item, "N of M passed", exit with an error on failure | The same, plus FakePay so it runs offline |
| We proved the test catches bugs by breaking a rule in a throw-away copy | Included as its own message |
| Reset only after a backup, a list of what will be deleted, and a yes | The same, now with `npm run backup` |
| ZZ names for test data, tests on a separate copy, stock put back after tests | The same |
| Chilli theme, and never copying a real brand (we refused to copy Chili's) | "Warm and spicy" feel option, Chilli Lane Pantry as a sample shop, and the no-real-brands rule |
| A chocolate shop's rotating products | B3: every category turns on a 3D ring (Sector 2c) |
| Part 2 of the course: layout rules, navigation, floating button, progress bars, animations, reduce motion, checkpoints | Section 13, adapted to plain HTML, CSS and JavaScript |

## Appendix B · What came from the Wix guide

| The guide (and its linked pages) says | Where it is in this pack |
|---|---|
| Step 1: pick a niche and a way to earn (commission, listing fees, featured listings) | Section 14 (niche), Sector 7 (commission), Later ideas (featured listings, seller plans) |
| Step 2: a memorable domain and reliable hosting | Later ideas: Going live |
| Step 3: features a marketplace needs: multi-vendor, vendor dashboards, commission management, search and filtering, reviews and ratings | Sectors 1, 2, 7, 8 and 6 |
| Step 4: for buyers, clear categories, a prominent search bar, and filters by price, vendor and location; for sellers, an easy-to-find "Sell with us" button and simple onboarding | Sector 2 (header search, category menu, filters by price, shop and city, /sell page, header button) |
| Step 5: an MVP first (accounts, listings, cart, checkout), then grow from feedback | Good places to stop; Section 14 (watch a friend); Later ideas |
| Step 6: split payments (Rs 100 sale: Rs 10 platform, Rs 90 seller), automated payouts | Sector 4 (split per shop on the Payments page), Sector 7 (ledger and payouts), Later ideas (automatic payouts) |
| Step 7: break your own site; test seller and buyer flows, the order confirmation email, the vendor dashboard and the commission, on phones too; SSL and encrypted data | Every sector's test prompt, Sector 3 (confirmation email), Sector 11 launch check, Final proof, COOKIE_SECURE |
| Step 8: SEO: keywords in headings and category names, fast pages, clean URLs; every listing is a new page search engines can find | Sector 2 (clean addresses, titles from the server), Sector 9 (sitemap, robots.txt, one H1, speed) |
| Step 9: win sellers first, for example with an early-bird commission; then buyers with email and content | Sector 7 (early-bird offer), Sector 9 (newsletter sign-up), Later ideas (referrals) |
| Marketplace vs store: the platform manages sellers, trust and disputes | Sector 5 (help with an order), Sector 6 (reviews, reports, moderation) |
| Legal: privacy policy, terms, a clear refund policy, and who handles returns, refunds and damage; tax | Sector 9 (all policy pages, with a "not legal advice" note), Later ideas (tax) |
| Product pages: stock status, shipping cost, delivery estimate, return policy, reviews, related products | Sector 2 (product page), Sector 6 (reviews) |
| Show every cost early; guest checkout; one page; a progress line | Sector 3 (cart and checkout) |
| Emails: confirmation, shipping updates; a footer with contact, legal links and email sign-up | Sector 3, Sector 5, Sector 9 |
| Security: hashed passwords, least privilege, validated inputs, backups | Sector 1 (already), Sector 9 (safety check, admin passwords, npm run backup) |
| Launch checklist: every link and form tested, 404 page, favicon, privacy policy, mobile check | Sector 9 launch check, Final proof |
| Accessibility: text labels for pictures, contrast, keyboard, not colour alone | Notebook upgrade (L2), Sector 9 |
| Building with AI coding tools: plan the structure first, be specific, expect to finish the last part by hand, test every flow, check phones | The whole method of this pack |

## Appendix C · If you see this

| Problem | What to paste |
|---|---|
| "This site can't be reached" | Start the app again and tell me the address. |
| Claude says the port is busy | That address is busy. Use a different one and tell me. |
| A page is blank or shows an error | The page shows an error. Look at it, find the cause, fix it, and test. |
| Red npm errors about "gyp" or "build tools" | Install Node.js LTS again, quit and reopen Claude, then paste: Delete node_modules and install again. |
| A seller can see another shop's data | A seller must only see their own shop, and the server must enforce it, not just the screen. Fix it and add a test for it. |
| The cart total and the order total are different | The cart showed X but the order total is Y. The total must always be worked out by the server. Fix it and test. |
| The carousel makes the page jump or scroll sideways | The carousel makes the page scroll sideways on a phone. Keep it inside its own box and fix it without changing how it turns. |
| Claude says the test is wrong, not the app | Show me the checklist item and the part of the test that checks it. (You decide. The checklist is the boss.) |
| A fix breaks something that worked | Your last change broke (the thing). Undo it and try a smaller fix. Then run npm run check again. |
| You hate how a change looks | Go back to my last checkpoint. Throw away every change I made after it, but never touch marketplace.db. |
| Claude asks to do something you do not understand | Click No, then ask: Why do you need that? |
