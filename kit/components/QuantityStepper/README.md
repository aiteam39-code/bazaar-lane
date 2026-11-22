# QuantityStepper

Minus / count / plus for the product page and cart lines; the count rolls and the limits push back.

**You provide** `value` + `onChange` (or `defaultValue`), `min`, `max`, and optionally `maxHint`.

- At a limit the buttons dim and a press shakes the number instead of doing nothing; past `max` it says why ("Max 5 per order").
- The new count is announced politely to screen readers.
- `size="sm"` (36px) fits cart rows; the default (44px) is for the product page.

Do set `max` from real stock or a per-order cap. Don't let 0 sit in the stepper on a cart line: removing an item is ConfirmButton's job.

Inspired by: Bencho "Rolling counter"; "Comma jump number input" in 60fps snippets.
