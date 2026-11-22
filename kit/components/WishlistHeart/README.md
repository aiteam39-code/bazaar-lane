# WishlistHeart

The save-to-wishlist toggle: a heart that pops and bursts when saved and quietly empties when unsaved.

**You provide** `pressed` + `onChange` (or `defaultPressed` to let it manage itself), an accessible `label` naming the product ("Save brass lamp"), and optionally `count`.

- `onMedia` gives it a round `surface` chip with `shadow-card` so it reads on top of photos (ProductCard uses this).
- `count` is shown exactly as you pass it and rolls when it changes; update it yourself in `onChange`.
- The filled heart is `love`; the burst only plays on save, never on unsave.

Do save optimistically and roll back on failure. Don't ask a signed-out shopper to log in before the heart fills: save locally and offer sign-in later. It is a toggle button (`aria-pressed`), so screen readers hear "pressed / not pressed".

Inspired by: Bencho "Like".
