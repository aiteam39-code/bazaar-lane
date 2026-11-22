# RollingNumber

A number whose digits roll like an odometer when it changes; the base for every count and total in the kit.

**Use it for** the bag count in the header, cart subtotal, "₹350 to go" in the free-delivery meter, seller KPIs. Anything a shopper or seller watches change.

**You provide** `value` (a number) and either Intl options in `format` (rupees: `{ style: 'currency', currency: 'INR', maximumFractionDigits: 0 }`) or your own `(n) => string`. Formatting defaults to `en-IN`, so 124580 reads 1,24,580.

- Do set its font size on the element (`style` or a class); the columns size themselves in `em`.
- Do pass `animateOnMount={false}` for values that are already on screen when the page loads (bag count); leave it on for reveal moments (order total on the confirmation page).
- Do turn on `live` only where the change is the news (quantity), not for numbers that tick constantly.
- Don't use it for long paragraphs of figures or for phone numbers and codes; it is for values that change.

Screen readers get the plain formatted value; the rolling columns are hidden from them. Under reduced motion the digits change instantly.

Inspired by: Bencho "Rolling counter"; the live leaderboard digits on Spotted in Prod.
