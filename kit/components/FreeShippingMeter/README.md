# FreeShippingMeter

"Add ₹350 more for free delivery", with a bar that fills as the cart grows and a tick when it is unlocked.

**You provide** `subtotal` and `threshold` (rupees), optionally `unlockedLabel`.

- The amount left rolls; the fill is `accent-ink` and turns `success` at the line, with one shine sweep.
- It is a progressbar with a readable value ("₹350 to go").

Put it at the top of the cart drawer and cart page. Do keep the threshold honest and constant. Don't show it when every order already ships free.

Inspired by: Bencho "Context meter".
