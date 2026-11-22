# OrderTracker

Live order status: a big ETA, one live line ("Ravi is 2.1 km away") and a rail that fills to the current step.

**You provide** `steps` (`label`, optional `time`), `current` (index), `eta`, `status`, `meta`.

- Past steps get an `ink` tick; the current one pulses; delivered turns the rail and dots `success`.
- Under 440px of width it turns vertical.
- The status line is a polite live region, so updates are announced.

Use it on the order page, in the post-purchase email landing, and as a card on the account home. Do keep `status` to one human sentence. Don't invent precision you don't have; an ETA window ("6–7 pm") beats a fake minute.

Inspired by: Bencho "Step player"; the "Almost at pickup" ride card on Spotted in Prod; the commute ETA card in Bencho Finds.
