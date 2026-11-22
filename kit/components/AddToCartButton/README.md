# AddToCartButton

The add-to-bag button: plus → spinner while the add is in flight → drawn tick and "Added", or a shake and "Try again".

**You provide** `onAdd`. Return a promise from it to get the spinner; resolve shows "Added" for 1.8s, reject shows "Try again". Optional: `label`, `addedLabel`, `soldOut`, `tone`, `size`, `block`.

- `tone="accent"` (default) is the one primary action on a product page: `accent` fill, `on-accent` text. Use it once per view.
- `tone="ink"` is for secondary placements (Quick add on cards, sticky mobile bar): `inverse` fill.
- Width never jumps between states: all labels share one grid cell.
- Sold out disables it with `surface-sunk` and `ink-muted`.

Do pair it with a ToastStack "Added to bag" toast that has a **View bag** action, and roll the bag count. Don't navigate to the cart on add; keep shoppers browsing.

Inspired by: Bencho "Press" and "Loading" blocks; "Plus to tick button" in 60fps snippets.
