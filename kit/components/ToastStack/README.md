# ToastStack

Notifications stacked into one card with the two behind peeking out; point at it or tab into it and it springs apart into a list.

**You provide** the list and a dismiss function. Use the hook: `const { toasts, push, dismiss } = IK.useToasts()`, render `<ToastStack toasts={toasts} onDismiss={dismiss} />` once near the root, and call `push({ title, body, tone, thumb, action })` anywhere.

- Toasts are `inverse` cards; `tone="success"` and `"danger"` add an icon, `thumb` shows a product photo.
- Each leaves after `duration` (5s); timers pause while the stack is open.
- `placement`: `bottom-right` (default), `bottom-center` (mobile), or `inline` inside a container.

Do give add-to-bag and payment toasts an action (**View bag**, **Retry**). Don't use toasts for errors the shopper must fix in a form; put those beside the field.

Inspired by: Bencho "Toast stack".
