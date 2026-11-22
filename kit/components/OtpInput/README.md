# OtpInput

One-time code boxes for phone sign-in and checkout: typing advances, Backspace steps back, paste and SMS autofill fill every box.

**You provide** `value` + `onChange`, `onComplete` (fires when all boxes are filled) and the `status` you get back from verification: `verifying` pulses, `error` shakes and tints `danger-soft`, `success` lands each box in `success-soft` with a stagger. Put the result line in `message`.

- The first box has `autocomplete="one-time-code"`, so iOS and Android offer the code from SMS.
- Clear the error as soon as the shopper edits (the preview does this).

Do say where the code was sent and offer resend after 30s. Don't auto-submit payment from a code; verify, then let them press Pay.

Inspired by: Bencho "One-time code".
