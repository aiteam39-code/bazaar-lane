# ProductCard

The product tile for category grids, search results and "you may also like" rows.

**You provide** `title`, `price`, `images` (main and optional hover photo, 4:5), and optionally `vendor`, `compareAt`, `badge`, `href`, `onAdd` and the wishlist props. Prices are numbers in rupees; the card formats them.

- Hover (mouse only) crossfades to the second photo, zooms 3% and slides up **Quick add** in `inverse`. On touch screens Quick add is always visible, because hover does not exist there.
- The whole card is one link (the title's, stretched); the heart and Quick add sit above it and work on their own.
- `compareAt` above `price` shows the old price struck through and "20% off" in `accent-ink`.
- `soldOut` greys the photo, swaps the badge to "Sold out" and removes Quick add.

Do keep `vendor` on: in a multi-vendor marketplace the maker's name is a trust signal. Do use real 4:5 photography on a plain backdrop. Don't put more than one badge on a card, and only say "Only 2 left" when stock really is 2.

Inspired by: Bencho "Asset swap" (hover image swap); quick-add patterns collected on Ripplix.
