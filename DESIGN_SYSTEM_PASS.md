# Bazaar Lane — design system pass (the next prompts)

> **Design system:** https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4#readme (the Interaction Kit; `kit/` in the project is an exact copy of it).

Everything is built. This pass makes the whole app actually *look and feel* like the design system, everywhere, and replaces the placeholder drawings with real photos. The kit's own README says the placeholder art must never ship, and right now every promo card, hero tile and product still shows it.

Paste **1**, wait for `npm run check` to pass, then **2**, **3**, **4**.

---

## 1 · Audit every page against the design system

```text
Read CLAUDE.md, then the Interaction Kit design system at https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4 (kit/ is an exact copy: read kit/README.md, kit/screen-map.md, kit/tokens.css and kit/api/). Do not change any feature, price, stock or order rule.

Go through EVERY page (customer, seller, admin, help, seasons) and list in a table each place it breaks the design system, then fix them all:
- Colour: only the kit's tokens (canvas, surface, surface-sunk, ink, ink-muted, accent, on-accent, accent-ink, accent-soft, inverse, on-inverse, success, danger, love, line, chart-1..3). No hand-written hex colours outside tokens and the season files. ONE accent action per screen; everything else inverse, ghost or text.
- Type: Instrument Sans only, with the kit's styles (type-display, type-title, type-body, type-label, type-price, type-caption, type-kpi). Tabular figures on numbers that change.
- Shape and depth: everything pressable is a pill; cards and toasts radius-lg; photos and panels radius-md; inputs radius-sm; shadow-card at rest, shadow-float for floating things. Spacing only space-1 to space-6.
- Icons: only inline SVG at 24px, 1.75 stroke, round caps, currentColor (kit/components/src/icons.jsx style). No emoji, no icon fonts.
- Focus: every interactive element shows the 2px focus outline with 2px offset.
- Words: sentence case, buttons start with a verb, no exclamation marks, every product shows "Shop · City", money only through IK.formatMoney, errors say what happened and what to do next.
- Motion: only the kit's timing tokens (dur-fast, dur-base, dur-slow, ease-out, ease-spring for confirmations only). Every animation answers "did that work?"; cut decoration that answers nothing (the season decorations are the one allowed exception and stay off with reduced motion).

Then use every piece where kit/screen-map.md puts it, adding the ones still missing:
- Home: CollectionAccordion (4 or 5 top categories) and a "New from makers" ProductCard row, kept together with the Blinkit layout.
- Category and search: ProductCard grid, SkeletonCard in the exact page size, WishlistHeart.
- Product page: VariantPicker (every size, sold out included), QuantityStepper, AddToCartButton as the only accent, WishlistHeart, RollingNumber price.
- After an add: ToastStack with the photo and View bag; the bag count rolls.
- Cart: FreeShippingMeter per shop, QuantityStepper sm, ConfirmButton remove with Undo, RollingNumber subtotal.
- Sign-in and checkout: OtpInput for the customer's phone. No real SMS: in this project the code is printed in the server log and on screen only when not in production; 5 tries, resend after 30 seconds, "That code didn't match. 2 tries left."
- Order confirmation: RollingNumber total with animateOnMount, then OrderTracker.
- Order tracking: OrderTracker, one human sentence per update.
- Seller dashboard: StackedBars for revenue by channel and RollingNumber KPIs (real numbers from orders only).
- Seller listings: ConfirmButton for Delete and Switch off.
- Sound: off by default, with a visible Sound on/off toggle in the footer calling IK.sound.enable(); cues tick, add, paid, error.
- Themes: a Light / Dark switch in the footer (lane and night, remembered in the browser, follows the device setting until chosen). Check contrast 4.5:1 for text and 3:1 for marks in both.

Add npm run check items: DS1 no page contains an emoji; DS2 no page has more than one accent button visible at a time; DS3 no hand-written colour outside tokens.css and the season files; DS4 every price on the page went through IK.formatMoney (₹ with Indian grouping); DS5 OtpInput locks after 5 wrong codes and resend waits 30 seconds. Update CLAUDE.md (screen-map table into "How to build it", DS lines into the checklist) and the Stage section. Show me the before/after table and tell me exactly what to click.
```

---

## 2 · Real photos (no more placeholder drawings)

Pick **A** if you have photos, **B** if Claude should find free ones.

**A. Your photos.** Put them in a folder named after products, categories and promo cards (`green-chilli-pickle.jpg`, `pet-care.jpg`, `promo-pantry.jpg`), then paste:

```text
I put photos in (/Users/a91970/Downloads/bazaar-photos). Attach each one to the product, category tile, promo card, hero or CollectionAccordion panel with the closest name, through the same rules as a seller upload (type checked by its first bytes, 2 MB limit, random file name). Crop products to 4:5 centred on a plain light backdrop, category tiles to square, collection photos so the lower third stays quiet for the white title. Then list: what you matched, anything you could not match, and every place that still shows IK.demo.art. Change nothing else.
```

**B. Free photos found for you.**

```text
Every place still showing the kit's placeholder art (IK.demo.art) needs a real photo: every product, category tile, promo card, the hero and the CollectionAccordion panels. Find them on Pexels or Unsplash only. Before downloading anything, show me a table (where it goes, subject, link, photographer, size) and wait for my yes. Rules: product photos 4:5, product centred on a plain light backdrop; no brand names or logos on packaging; no AI-made images; no people's faces. After my yes, download into a new folder, check each file really is an image, attach them like a seller upload, crop like the design system says, and write CREDITS.md with the photographer and link for each. Then add npm run check item DS6: no customer page uses IK.demo.art when a photo exists, and list any place still without one.
```

---

## 3 · Polish pass, screen by screen

```text
Using the design system at https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4 (kit/), polish these, one at a time, checking each at 390 pixels and on a laptop, light and night:
- Header: the sticky header must never cover the top of the hero or a section heading when the page scrolls or a link jumps to a section (use scroll-margin); the delivery line "Delivery in X to Y days" uses type-caption and real dispatch days; the search box and bag are pills.
- Hero: one type-display statement only, one accent button ("Shop now"), real photos on the right with radius-md.
- Promo cards: each card's background is a token-based tint (not a random dark colour), the title and line meet 4.5:1 on it, the "Order now" pill is inverse (not a second accent), and the photo has a plain backdrop.
- Category tiles and rows: same photo size, same gap (space-4), names never cut off mid-word, "See all" is text, not a button.
- Empty states (empty bag, no results, no orders, seller with no products): one calm sentence, one next step ("Browse pantry"), a kit icon, never a blank page.
- Loading: SkeletonCards everywhere data loads; no layout jump when photos arrive (fixed aspect ratios).
- Footer: Light/Dark, Sound, Snow (in season), Help, Sell on Bazaar Lane, in type-caption.
Run npm run check after each screen. Take a screenshot of each screen before and after, at 390 pixels and on a laptop, and save them in screenshots/design-pass/.
```

---

## 4 · Test it all

```text
The app is running. On a separate copy with its own port and database (never my real data), test the design system pass: every customer, seller and admin page at 390 pixels and on a laptop, in light and night, with reduced motion on and off, with sound on and off, and with Christmas on and off. For each page check: one accent button, no emoji, no placeholder art, ₹ with Indian grouping, "Shop · City" on every product, focus outline visible when tabbing, no sideways scrolling, nothing hidden under the sticky header. Sign in with OtpInput (wrong code twice, then right), add from two shops, watch the tick, toast and rolling bag count, remove one with Undo, pay with FakePay, see the total roll up and the OrderTracker. As a seller, check StackedBars matches the real orders. Run npm run check. Give me a table: page, what you checked, PASS or FAIL, and the screenshots.
```

---

**What you should see after this:** real photos everywhere, one marigold button per screen, the same pill buttons, spacing and type on every page, light and dark that both read clearly, and every little animation telling you something worked.
