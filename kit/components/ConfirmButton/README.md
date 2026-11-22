# ConfirmButton

A two-step destructive button: the first press widens it into a question ("Remove item?") with a draining timer, the second confirms.

**You provide** `onConfirm`, optionally `label`, `confirmLabel`, `timeout`.

- Escape, moving focus away, or the timer running out puts it back.
- Armed state is `danger-soft` with `danger` text and border, and the confirm hint is announced.

Use it for remove-from-bag, cancel order, delete listing. Do follow a removal with an **Undo** in the same spot. Don't use it for actions you can simply undo; those need no confirmation at all.

Inspired by: "Cancel button expand to confirm" in 60fps snippets.
