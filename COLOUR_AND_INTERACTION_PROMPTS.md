# Bazaar Lane — colour and interaction pack

> **Design system (the source of truth for the look):** https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4#readme. It is the Interaction Kit, and the project's `kit/` folder is a copy of it. Every prompt in this file follows its README, `screen-map.md`, tokens (themes lane, night, cacao) and its 14 components. If the design system changes, paste the "Sync the kit" prompt below first.
>
> ```text
> Sync the kit. The Interaction Kit design system at https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4 is the source of truth for the look. Compare it with kit/ (README.md, screen-map.md, tokens.css, tokens.json, components/bundle.js, components/bundle.css, api/). If anything differs, show me the differences and wait for my yes before replacing the files in kit/. Then check every page still follows the kit's rules (one marigold action per screen, no emoji, sentence case, real 4:5 photos, IK.formatMoney, reduced motion) and run npm run check.
> ```

Every idea from the list, as paste-ready prompts, in a safe order. Paste one prompt, wait until it says done and `npm run check` passes, then the next. After each one, look at it on your phone width and on a laptop.

**Rules for every prompt below (already inside each one):** keep the Interaction Kit look, one bright action colour per screen, real photos (no emoji), every text pair readable (4.5:1), reduced motion turns movement off, nothing fake (no fake urgency, no fake rewards), and every existing feature and test keeps working.

| # | Prompt | What you get |
|---|---|---|
| 1 | Colour system | Category colours, shop colours, photo-tinted cards, gradient promo cards |
| 2 | Time of day | Morning, afternoon, sunset and night looks that change by themselves |
| 3 | More seasons | Diwali, Holi, Pongal, Eid, Independence Day, Monsoon sale |
| 4 | Add-to-bag magic | Fly-to-bag, bag bounce, sticky mini-cart |
| 5 | Mobile gestures | Swipe to remove, swipe to save, pull to refresh, long-press peek |
| 6 | Discovery fun | Surprise me wheel, occasion picker, shop the look |
| 7 | Seller stories | Story-style seller videos at the top of the home page |
| 8 | Live tracker | Moving van tracker with a one-time confetti on delivery |
| 9 | Rewards | Honest badges and streaks, scratch card coupons |
| 10 | App feel | Bottom tab bar, haptics, installable app (PWA), offline browsing |
| 11 | Test everything | One big test of the whole pack |

---

## 1 · Colour system

```text
Read CLAUDE.md and kit/README.md first (kit/ is a copy of the Interaction Kit design system at https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4). Make the marketplace colourful without breaking the kit's rules. Keep every feature and test passing.
- Category colours: every category gets its own colour pair (a soft background tint and a deep text-safe shade), saved in the categories table (db.js adds the columns safely and gives every existing category a colour from a hand-picked palette: saffron for pantry, terracotta for home and kitchen, teal for pet care, soft pink for baby care, leaf green for plants, indigo for stationery, and so on, no two neighbours alike). The category's tile, its page header strip, its chips, its row heading on the home page and the carousel spotlight use it. The admin can change it on the categories page, and the server refuses any pair under 4.5:1 contrast.
- Shop colours: each seller picks one colour for their shop from a safe list of 12 on their Shop settings page. Their storefront banner, their name chip on product cards and their order emails' header use it.
- Photo-tinted cards: each product card's background is a very soft tint taken from its own photo. Work out the colour once on the server when the photo is uploaded (an average of the photo's middle, softened towards white) and save it, so pages do not compute it in the browser. Text on cards always stays readable.
- Gradient promo cards: the home page promo cards use a two-colour soft gradient from their category colour, with the real photo cut out on the right.
- The ONE accent button per screen (Add to bag) stays the kit's accent colour, never the category colour.
- Check light and night themes, at 390 pixels and on a laptop. Add npm run check items: COL1 every category and shop colour pair is at least 4.5:1; COL2 the server refuses a bad pair; COL3 every product with a photo has a saved tint. Update CLAUDE.md and Stage. Tell me what to click.
```

## 2 · Time-of-day looks

```text
Add time-of-day looks on top of the kit and the seasons system. Morning (6 to 11): soft sunrise yellow canvas; afternoon (11 to 17): the normal bright look; sunset (17 to 21): warm orange-pink header gradient; night (21 to 6): the kit's night theme. Use the customer's own clock. Changes happen gently on page load (never in the middle of reading). A season (like Christmas) always wins over time of day. A footer switch "Look changes with the time of day" (on by default, remembered in the browser); when off, the customer's light or night choice is used. Text stays at least 4.5:1 in every look. Add npm run check items: TOD1 the right look for 8:00, 14:00, 19:00 and 23:00; TOD2 a season overrides it. Update CLAUDE.md and Stage.
```

## 3 · More seasons

```text
Add these seasons to the season system, exactly like Christmas (their own files, dates the admin can change, preview, our own inline SVG drawings, no emoji, no copied art, reduced motion turns movement off, prices and orders never change because of a season, only TRUE delivery promises):
- Diwali (dates for this year): deep indigo night, marigold and gold; diyas glowing along the header, a rangoli pattern behind the hero, a "Diwali gifts" collection of sweets, lamps and decor.
- Holi: white canvas with soft colour splashes that appear on the bag button when something is added; a "Holi colours and snacks" collection.
- Pongal / Sankranti: sugarcane green and turmeric yellow, kites in the header sky; a "Harvest festival" collection.
- Eid: deep green and silver, crescent and lantern drawings; an "Eid gifts" collection.
- Independence Day: saffron, white and green bands done tastefully (no misuse of the national flag image), a "Made in India" collection.
- Monsoon sale: rainy blue-grey, slow raindrops (off with reduced motion), a "Monsoon picks" collection; any sale price is set by sellers and shown honestly with the old price.
The admin Seasons page lists them all with their dates; two seasons can never overlap (the server refuses it). Add npm run check items for each: on inside its dates, off outside, no overlap allowed. Update CLAUDE.md and Stage.
```

## 4 · Add-to-bag magic

```text
Make adding to the bag feel great, everywhere a product can be added (cards, carousel, product page, category rows):
- Fly to bag: the product's photo makes a small copy that flies along a smooth curve into the bag button (about 0.6 seconds), shrinking as it goes; then the bag bounces once and the count rolls. Every quick press launches its own copy; nothing waits. Off with reduced motion (the count still rolls).
- Sticky mini-cart: after the first add, a bar slides up at the bottom of the screen: "2 items · ₹740 · View bag", with the photos of the last 3 items. It sits above the bottom tab bar on phones, never covers an Add button, and leaves space so the last product can scroll clear. It hides on the bag and checkout pages.
- The "Added to bag" toast and the tick stay.
Add npm run check items: BAG1 adding from every place updates the same bag and total (server-checked); BAG2 the mini-cart total matches the server's total. Update Stage.
```

## 5 · Mobile gestures

```text
Add touch gestures for phones (they must also have a button that does the same thing, for people who cannot swipe or use a keyboard):
- In the bag: swipe an item left to show Remove (red, with the word), let go to remove it, with Undo in place for 5 seconds; swipe right to move it to the wishlist (with a heart and the word Saved).
- Pull to refresh on the home page and the orders page: pull down, a small circle fills, let go to reload the data (not the whole page).
- Long-press (half a second) on any product card for a quick peek: a bigger photo, the name, the shop, the price and Add, in a sheet that slides up; tap outside or swipe it down to close. On a laptop the same peek opens with a small "Quick view" button on hover.
- Gestures never trigger while the page is scrolling sideways in a row, and vertical scrolling always wins.
Turn off the slide animations with reduced motion (the actions still work). Test at 390 pixels with touch. Update Stage.
```

## 6 · Discovery fun

```text
Add three ways to discover products, all using real products from the database:
- Surprise me: a button on the home page opens a colourful wheel of categories (each slice its category colour). Spin it: it lands on a category (chosen by the server, fair, random), then shows one real buyable product under ₹500 from it with Add and "Spin again". With reduced motion the wheel does not spin; it just shows the result.
- Occasion picker: a row of chips under the header: Birthday gift, Housewarming, Self-care Sunday, Thank you, Festive. Tapping one reorders the home page rows to match (each occasion is a list of categories and a price range the admin can edit), with a smooth crossfade. The chosen occasion stays in the address so it can be shared.
- Shop the look: the admin can upload a styled photo (for example a kitchen shelf) and place dots on it, each linked to a real product. On the home page, tapping a dot shows the product's name, price and Add in a small card. Dots are buttons with labels for screen readers.
Add npm run check items: FUN1 Surprise me only returns buyable products under ₹500; FUN2 each occasion's products match its categories and price range; FUN3 every Shop the look dot links to a real, buyable product (or hides). Update CLAUDE.md and Stage.
```

## 7 · Seller stories

```text
Add Instagram-style seller stories at the top of the home page:
- Sellers can upload a short video (MP4 or WebM, at most 15 seconds and 10 MB) or a photo, with one line of text, from a new Stories page. The server checks the file type by its first bytes, the size, gives it a random name, and removes it after 7 days. Each upload waits for the admin's approval before it shows.
- Home page: a row of round shop photos with a coloured ring (the shop's colour) when they have a new story; tapping opens the story full-screen with a progress bar, tap right for next, left for back, swipe down to close, and a "Visit shop" button. Videos start muted with captions from the text line, and never autoplay with sound.
- A seen story's ring turns grey (remembered in the browser).
- Reduced motion: no auto-advance; arrows instead.
Add npm run check items: STO1 a story shows only after approval and disappears after 7 days; STO2 a seller cannot post as another shop; STO3 a wrong file type or a too-big file is refused. Update CLAUDE.md and Stage.
```

## 8 · Live van tracker

```text
Upgrade the tracking page's OrderTracker for each shop's part with a little road: a van drawn as our own SVG drives along it to the current step (Placed, Packed, Shipped, Out for delivery, Delivered), with the road filling in the shop's colour behind it and the kit's one-sentence status under it. It only moves when the status really changes (it checks every 20 seconds). When a part becomes Delivered, play a small confetti burst once (remembered in the browser so it never plays twice). Reduced motion: the van jumps to the step, no confetti. Fits a 390 pixel phone without sideways scrolling. Add "Out for delivery" to the seller's buttons between Shipped and Delivered only if it fits our status rules; otherwise keep our statuses and show the van between Shipped and Delivered. Update Stage.
```

## 9 · Rewards (honest ones)

```text
Add honest rewards. Nothing fake, nothing that pushes people to buy more than they want.
- Badges, worked out by the server from real delivered orders, shown on a "My badges" page reached from the tracking link and from Find my orders (no login needed): "First order from a local maker", "Supported 3 shops", "Supported 5 shops this month", "Gift giver" (sent a gift-wrapped order), "Season shopper" (ordered during a season). Each badge is our own SVG in its category or season colour, with its name written.
- Scratch card: after an order is delivered, the tracking page shows one scratch card (scratch with a finger or the mouse, or press "Reveal"). It reveals a coupon decided and saved by the server when the order was delivered (for example 10% off up to ₹100 on the next order, valid 30 days, one use, this email only), or "Thanks for shopping local" when there is no coupon. The coupon is checked by the server at checkout; the platform pays for the discount (the seller's earning and the commission stay correct; book it in the ledger).
- The admin sets the coupon rules and a monthly budget on a Rewards page; when the budget is used up, cards say thanks instead.
Add npm run check items: REW1 badges match real delivered orders; REW2 a coupon works once, only for its email, only before its expiry, and a made-up code is refused; REW3 the ledger stays correct with a coupon; REW4 the budget is never exceeded. Update CLAUDE.md and Stage.
```

## 10 · App feel (mobile)

```text
Make the phone version feel like an installed app:
- Bottom tab bar on phones (narrower than 768 pixels): Home, Categories, Bag (rolling count), Orders (the remembered tracking links), Profile (badges, saved items, theme and sound switches). Each tab has our own SVG icon that does a tiny bounce when tapped, and the active tab sits in a coloured pill (the season or time-of-day colour). Pages leave space so nothing hides behind it.
- Haptics: a short vibration on Add, on Remove and on a successful order, using the browser's vibration feature where the phone supports it, off by default and switchable in Profile, and never with reduced motion.
- Installable app (PWA): a web app manifest with the name, colours and icons (our own drawn icons in several sizes), a splash colour that follows the current season, and a service worker that caches the pages, styles, scripts and photos so browsing works offline with a calm "You're offline, showing saved products" bar. The bag, checkout, payments and anything with money ALWAYS need the network and say so when offline; never serve a cached price at checkout.
- An "Install Bazaar Lane" button in Profile when the browser offers it.
Add npm run check items: APP1 the manifest and service worker are served; APP2 checkout refuses to work from cache. Test on a phone width with touch, online and offline. Update CLAUDE.md and Stage.
```

## 11 · Test everything

```text
The app is running. Test the whole colour and interaction pack yourself on a separate copy with its own port and database, at 390 pixels with touch and on a laptop, in light, night, every time of day and every season (preview them), with reduced motion on and off:
category and shop colours and their contrast; photo-tinted cards; gradient promo cards; fly to bag, bag bounce and the mini-cart total; swipe to remove with Undo, swipe to save, pull to refresh, long-press peek (and their buttons); Surprise me, occasion chips, Shop the look dots; seller stories (approval, expiry, a wrong file refused); the van tracker and the one-time confetti; badges, the scratch card and coupon rules and the ledger; the bottom tab bar, haptics switch, install and offline browsing with checkout refusing offline.
Check no page scrolls sideways, nothing covers a button, every animation stops with reduced motion, no emoji and no real brand logos appear. Run npm run check. Give me a table: what you tested, what you saw, PASS or FAIL, with screenshots of the home page on a phone in the morning, at night and during one season.
```
