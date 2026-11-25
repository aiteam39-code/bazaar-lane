# Bazaar Lane — Blinkit-style home page

> **Design system (the source of truth for the look):** https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4#readme. It is the Interaction Kit, and the project's `kit/` folder is a copy of it. Every prompt in this file follows its README, `screen-map.md`, tokens (themes lane, night, cacao) and its 14 components. If the design system changes, paste the "Sync the kit" prompt below first.
>
> ```text
> Sync the kit. The Interaction Kit design system at https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4 is the source of truth for the look. Compare it with kit/ (README.md, screen-map.md, tokens.css, tokens.json, components/bundle.js, components/bundle.css, api/). If anything differs, show me the differences and wait for my yes before replacing the files in kit/. Then check every page still follows the kit's rules (one marigold action per screen, no emoji, sentence case, real 4:5 photos, IK.formatMoney, reduced motion) and run npm run check.
> ```

Blinkit's home page, rebuilt our way for a multi-seller marketplace. Paste **Prompt 1**, then **Prompt 2** to add real photos, then **Prompt 3** to test.

Rules that stay: our Interaction Kit look, our rotating category carousel, our add-to-bag animation, and no real brand names, logos or Blinkit pictures. We copy the *layout idea*, never their artwork.

---

## Prompt 1 · Rebuild the home page like Blinkit

```text
Read CLAUDE.md and kit/README.md first (kit/ is a copy of the Interaction Kit design system at https://claude.ai/artifact/CfXYWRG1NdSqw8rznx5bS4). Rebuild the customer home page with Blinkit's layout, in our own design (the Interaction Kit, our carousel, our animations). Keep every feature, server rule and test passing.

1. Header (sticky)
- Left: the Bazaar Lane logo. Next to it, a delivery line: "Delivery in 2 to 4 days" and the customer's saved city/pincode with a small dropdown to change it (saved in the browser). The days come from the shops' real dispatch days, never made up.
- Middle: a big rounded search box whose placeholder changes every 3 seconds ("Search "pickle"", "Search "mug"", "Search "shawl"", using real product words from our catalogue). Stops changing while focused and with reduced motion.
- Right: Log in, and a bag button (gift sack in Christmas mode) with the rolling count and the total, greyed out when the bag is empty.

2. Big hero banner
- One wide rounded banner under the header for the main campaign (Christmas when the season is on, otherwise "Handmade by independent makers, delivered to your door"), with a "Shop now" button.

3. Promo cards row (like "Get printouts delivered", "Pharmacy at your doorstep")
- A row of 4 wide rounded cards that scrolls sideways on a phone (only the row, never the page) and shows all 4 on a laptop. Each card: a soft colour, a bold one-line title, a short line, a white "Order now" pill, and a real photo on the right side. Each card links to a real category or collection page. Make them:
  - "Pantry staples at your doorstep" - spices, pickles and oils
  - "Home and kitchen, handmade" - pots, mugs and planters
  - "Gifts for every occasion" - the giftable collection
  - "Pet care supplies at your door" - the new Pet care category
  - "No time to shop for the baby?" - "Baby essentials, delivered" - the new Baby care category
  - "Get prints and stationery delivered" - the new Stationery and prints category
  The admin can turn each card on or off and change its words, photo and link on a new Promo cards page (saved in the database).

4. Shop by category (more categories)
- A grid of category tiles: 10 per row on a laptop, 4 per row on a phone, each a rounded square with a real photo on a soft background and the name under it in two short lines.
- Add these categories (db.js adds them safely, with sample products from our sample shops so none is empty): Pantry and spices, Snacks and sweets, Tea and coffee, Fresh and organic, Breakfast and spreads, Home and kitchen, Home decor, Clothing, Bags and accessories, Jewellery, Beauty and personal care, Health and wellness, Baby care, Pet care, Stationery and prints, Toys and games, Gifts and crafts, Cleaning essentials, Plants and garden, Festive and puja. Keep the existing categories and their products.
- Each tile opens the category page, which keeps our rotating 3D carousel with "See all as a list".

5. Category rows (like "Dairy, Bread and Eggs  see all")
- Under the grid, one row per category that has products: the category name on the left, "See all" on the right, and a sideways-scrolling row of ProductCards with round arrow buttons on both ends (laptop) and swipe (phone). Snap one card at a time, smooth, respects reduced motion.
- Each ProductCard: the real 4:5 photo, a small "2-4 days" delivery chip (true for that shop), the name in 2 lines max, the size or weight ("250 g", "Set of 4"), "Shop · City", the price, and an outlined "Add" button that turns into the QuantityStepper after the first add, with our tick animation, the "Added to bag" toast and the rolling bag count.
- Show 6 rows on first load and load more rows as the customer scrolls (with SkeletonCards while loading).

6. Scrolling and picking animations (ours, made smoother)
- Sections fade and rise in once as they scroll into view.
- Category tiles lift slightly on hover and press down when tapped.
- The promo cards and product rows glide with momentum and snap.
- Everything turns off with reduced motion; nothing blocks a click.

7. Phone first
- At 390 pixels: sticky header with search under the logo, promo cards scroll sideways, 4-across category grid, rows swipe. No sideways scrolling of the page. Buttons at least 44 pixels.

Add a size or weight field to products (db.js, safely). Add npm run check items: H1 every category tile opens a page with products; H2 promo cards link to real pages and can be switched off by the admin; H3 the delivery chip matches the shop's real dispatch days; H4 the page never scrolls sideways at 390 pixels (check the layout in the test). Update CLAUDE.md and the Stage section, and tell me exactly what to click.
```

---

## Prompt 2 · Real-life photos

Real photos are what makes it look like Blinkit instead of "AI". Pick one way.

**A. You give the photos** (best). Put photos in a folder, named after the product or category (for example `pet-care.jpg`, `green-chilli-pickle.jpg`), then paste:

```text
I put photos in (/Users/a91970/Downloads/bazaar-photos). Attach each one to the product, category or promo card with the closest name, through the same rules as a seller upload (type check, 2 MB limit, random file name). Crop products to 4:5 and category tiles to square, centred. List anything you could not match and anything still without a photo.
```

**B. Claude finds free photos.** Paste:

```text
Find real photos for every category tile, every promo card and every sample product that has no photo, from Pexels or Unsplash only (their free licences allow this). Before downloading anything, show me the list of photos you want (subject, link, photographer) and wait for my yes. After my yes, download them into a new folder, check each file really is an image, attach them like a seller upload, and write CREDITS.md with the photographer and link for each one. No photos with real brand names or logos on the packaging, no AI-made photos, no photos of real people's faces.
```

---

## Prompt 3 · Test it

```text
The app is running. Test the new home page yourself on a separate copy with its own port and database. At 390 pixels and on a laptop: the header stays on top, the search placeholder changes and stops when focused, the promo cards scroll sideways inside their row and each opens a real page, every category tile opens a page with products and the carousel, each category row scrolls with the arrows and by swipe and "See all" works, Add turns into the stepper with the tick, toast and rolling bag count, the delivery chip matches the shop's dispatch days, more rows load as you scroll, and with reduced motion on nothing moves but everything works. Switch a promo card off as the admin and check it disappears. Check no photo shows a real brand logo. Run npm run check. Give me a table: what you tested, what you saw, PASS or FAIL, with a screenshot of the home page on a phone and on a laptop.
```
