# Bazaar Lane — Christmas mode (the last prompt)

Like Blinkit, the whole store changes its clothes for a festival, then changes back by itself. This file has the prompts to paste into your marketplace session, in order. It builds a **season system** (so Diwali, Holi or New Year can be added later with one small prompt) and **Christmas** as the first season.

Paste **Prompt 1**, wait until it says it is done and every test passes, then **Prompt 2**, then **Prompt 3**.

---

## Prompt 1 · Build Christmas mode

```text
Read CLAUDE.md and kit/README.md first. Build "seasons": a way for the whole marketplace to change into a festival look and change back by itself, like Blinkit does for festivals. The first season is Christmas. Keep every feature, every server rule and every test passing. Do not change any price, stock number or order rule because of a season.

1. The season system
- A seasons table: id, key (christmas), name, starts_at, ends_at, enabled (0 or 1). db.js adds it safely and fills Christmas: 1 December to 26 December, 23:59, enabled.
- The server decides which season is on (today is inside the dates and it is enabled) and sends it to every page: GET /api/season returns the key or null, and every customer page gets data-season="christmas" on the <html> tag from the server before it is sent, so there is no flash of the normal look.
- Admin: a Seasons page to switch a season on or off, change its dates, and "Preview" it (only for the admin's own browser, through a ?preview=christmas address that customers cannot use to change anything).
- Everything Christmas lives in its own files: public/seasons/christmas.css, public/seasons/christmas.js and its pictures. When the season is off, these files are not loaded at all. Deleting the season's files and row must leave a normal working store.

2. The look (on top of the Interaction Kit, never instead of it)
- A season theme in the kit's token style: [data-season="christmas"] sets the kit's colour tokens to a Christmas palette: deep pine green, berry red, warm cream, a soft gold. Every text pair still meets 4.5:1, and the accent is still ONE action colour per screen (berry red for Add to bag). Check night theme too.
- Decorations are inline SVG drawn for this project (the kit's rules: no emoji, no clip art from other sites, no copyrighted characters): a string of small warm lights along the bottom of the header that twinkle slowly; snow resting on the top edge of the header and on product card corners; a small pine sprig beside the logo; holly beside section headings.
- Gentle snowfall over the page: few flakes, slow, drawn on one canvas that never blocks clicks, paused when the tab is hidden, and OFF when the laptop is set to reduce motion. A small "Snow on/off" switch in the footer, remembered in the browser.
- The bag button becomes a gift sack with the same rolling count. The "Added to bag" toast says "Added to your Christmas bag".
- The OrderTracker and status emails use warm Christmas sentences ("Chilli Lane Pantry wrapped your order and handed it to BlueDart."), still one plain sentence each.
- The rotating category carousel gets a soft spotlight and snow under the middle product. It still respects reduced motion.
- Sound stays OFF by default. If the shopper turns sound on, the kit's "add" cue may be swapped for a short soft bell made with the Web Audio API (no audio files from other sites).

3. The Christmas shop (content on top)
- Home: a Christmas hero band at the top ("Christmas gifts from independent makers", with a "Shop gifts" button), then a "Gifts under ₹499", "Gifts under ₹999" and "Gifts for the kitchen" row of ProductCards, chosen by real prices and categories (no fake picks).
- A "Christmas gifts" collection page at /christmas listing products sellers have tagged as giftable. Sellers get a "Giftable" tick box on each product (a new column added safely).
- Gift options at checkout, per shop: "Gift wrap" (a price the seller sets, 0 = not offered; the server adds it to that shop's total and copies it into the order like any price) and a gift message of up to 200 characters printed on the seller's order screen. The receipt and tracking page show the wrap and the message.
- "Arrives before Christmas" on a product only when it is TRUE: today plus that shop's dispatch days plus 5 days is on or before 24 December. After that date the line disappears. No countdown timers, no "hurry", no fake scarcity: "Only 2 left" still appears only when stock is 2.
- Search: typing "gift", "christmas" or "xmas" shows giftable products first.

4. Turning back
- On 27 December the store looks exactly like before, by itself, without a deploy. Orders placed during Christmas keep their gift wrap and message.

5. Prove it
- Add to npm run check: X1 the season is on inside the dates and off outside them (move the clock in the test copy); X2 with the season off, no Christmas file is loaded and the normal look is back; X3 gift wrap is priced by the server, copied into the order and a fake wrap price from the browser is ignored; X4 "Arrives before Christmas" appears only when the date maths is true; X5 a customer cannot switch seasons or use preview; X6 every earlier item still passes.
- Check every customer page at 390 pixels and on a laptop, light and night, with reduced motion on and off, and with the season on and off. No sideways scrolling, nothing blocks a click, the snow never covers a button.
Update CLAUDE.md (add the season system and Christmas to the rules, and the X lines to the checklist) and the Stage section. Tell me exactly what to click.
```

---

## Prompt 2 · Test it like a customer

```text
The app is running. Test Christmas mode yourself on a separate copy with its own port and database. With the season ON: open the home page, the Christmas collection, a category with the carousel, a product page, the bag and checkout at 390 pixels and on a laptop; add a giftable ZZ product with gift wrap and a message from two shops, pay with FakePay, and check the totals by hand, the seller's order screen shows the message, and the tracking sentences are warm and plain. Check "Arrives before Christmas" with the test clock on 10 December (should show for a shop with 2 dispatch days) and on 23 December (should not). Turn reduced motion on: no snow, no twinkling, everything still works. Turn the season OFF as the admin: the normal look is back with no Christmas file loaded. Move the clock to 27 December: Christmas is off by itself. Then run npm run check. Give me a table: what you tested, what you saw, PASS or FAIL, with a screenshot of the home page on and off.
```

---

## Prompt 3 · Add the next festival later (optional)

Change the words in brackets, then paste:

```text
Add a new season to the season system, exactly like Christmas: (Diwali), from (date) to (date). Palette: (deep indigo night, marigold, warm gold and soft rose). Decorations drawn as our own inline SVG: (diyas along the header, a rangoli pattern behind the hero, a few gentle lights). Collection: (/diwali, "Diwali gifts", with sweets, lamps and home decor). Same rules: no emoji, no copied art, one accent per screen, reduced motion turns the movement off, no fake urgency, prices and orders never change because of the season. Add its X tests to npm run check.
```

---

**What to expect:** the store dresses up for Christmas on 1 December, takes it off on 27 December by itself, and the admin can switch it on early to preview it. Nothing about money, stock or orders changes because of the season except the optional gift wrap, which the server prices like everything else.
