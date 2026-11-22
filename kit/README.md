Fourteen commerce interactions — the small moments between "I like this" and "it's on its way" — built once and skinned per brand. Every component reads tokens and never names a colour, so the same code runs Bazaar Lane (`lane`, `night`) and Barre Cacao (`cacao`). The one exception is white text on the dark scrim over photos in CollectionAccordion.

## Principles

- **Motion confirms; it never decorates.** Every animation answers "did that work?": the tick in AddToCartButton, the heart burst, the rolling bag count, the OTP boxes landing. If an animation answers nothing, cut it.
- **One `accent` action per view.** On a product page that is Add to bag. Everything else is `inverse` (Quick add, selected pills, toasts), a ghost button, or text.
- **Timing comes from tokens.** `dur-fast` for hovers and colour, `dur-base` for glides and swaps, `dur-slow` for rolls, fills and steps. `ease-out` by default; `ease-spring` (slight overshoot) only for confirmations.
- **Reduced motion keeps every state change and drops the travel.** `bundle.css` does this for every `ik-` element; don't add motion outside it.
- **Sound is off by default.** Turn it on only behind a sound toggle the shopper can see: `IK.sound.enable()`. Four cues: `tick` (selection), `add` (added to bag), `paid` (payment or code verified), `error`.
- **No fake urgency.** No countdown timers, no "12 people are viewing this", no scarcity badges that aren't true. A badge like "Only 2 left" appears only when stock is 2.

## Content fundamentals

- Sentence case everywhere. Buttons start with a verb: "Add to bag", "View bag", "Retry", "Remove".
- Money is rupees with Indian grouping and no paise on product prices: `₹1,299`, `₹1,24,580`. Format with `IK.formatMoney`, never by hand.
- No exclamation marks, no emoji. Calm, plain, specific.
- Status lines are one human sentence: "Ravi is 2.1 km away." "Studio Kumhar packed your mug."
- Errors say what happened and what to do next: "That code didn't match. 2 tries left." "Payment declined. Try another card or UPI."
- Every product names its maker: "Studio Kumhar · Jaipur". In a marketplace the vendor line is a trust signal, not metadata.

## Visual foundations

**Colour.** Pages sit on `canvas`; cards and panels on `surface`; tracks, wells and skeletons on `surface-sunk`. Text is `ink`, secondary text `ink-muted`. `accent` is the single action colour (marigold in Lane, terracotta in Cacao) with `on-accent` text; `accent-ink` is the accent as text or a thin mark (discounts, meter fill); `accent-soft` tints badges. `inverse` with `on-inverse` is the dark-on-light (or light-on-dark) pop for toasts and selected pills. `success` (blue-teal) and `danger` always come with a word or icon. `love` is only the wishlist heart. Charts use `chart-1` → `chart-3`, darkest to lightest.

**Type.** One family, Instrument Sans (Google Fonts, 400–700), set through `--font-sans`. Styles: `type-display` for one statement per screen (the ETA), `type-kpi` for dashboard totals, `type-title`, `type-body`, `type-label` for buttons and pills, `type-price` for prices, `type-caption` for vendor lines and legends. Numbers that change use tabular figures.

**Shape.** Anything you press is a pill (`radius-pill`). Cards and toasts are `radius-lg`, product photos and panels `radius-md`, input boxes `radius-sm`.

**Depth.** `shadow-card` for resting cards and the heart chip, `shadow-float` for anything floating (toasts, a lifted card). Cacao has no soft card shadow: its cards are framed with `line`.

**Space.** `space-1` (4px) to `space-6` (32px). Cards pad `space-4` on desktop and `space-3` on mobile; grids gap `space-4`.

**Focus.** Every interactive element shows a 2px solid `focus` outline with a 2px offset, at least 3:1 on every surface in every theme.

**Photography.** Product photos are 4:5 on a plain, light backdrop with the product centred. Collection photos keep the lower third quiet for the white title. Until real photos exist, `IK.demo.art('mug' | 'tote' | 'lamp' | 'bottle' | 'bowl' | 'candle')` gives placeholder art; never ship it.

## Iconography

Inline SVG at 24px, 1.75 stroke, round caps, drawn in `currentColor` (see `components/src/icons.jsx`). No icon font, no icon library, no emoji. The only filled icon is the saved heart.

## Theming for a brand

Point the colour tokens at the brand and the components follow. `lane` and `night` are Bazaar Lane light and dark; `cacao` maps Barre Cacao's own system (cream `canvas` and `surface`, chocolate `ink`, terracotta `accent`). For Barre Cacao also set `--font-sans` to DM Sans and keep League Spartan for the brand's own headlines. A new brand needs the 23 colour tokens with every text pair at 4.5:1, plus its font.

## Using the components

React 18 or 19. Two ways in:

1. **Copy the source** into the app: `components/src/<Name>.jsx` with `util.js`, `icons.jsx` and `sound.js`, the matching block of `components/bundle.css`, and the tokens as CSS variables. Every source file starts with `'use client'` for the Next.js App Router. Classes are prefixed `ik-`, so Tailwind and shadcn/ui sit beside them without collisions.
2. **Load the bundle**: React and ReactDOM, `tokens.css`, `components/bundle.css`, then `components/bundle.js`, which defines `window.IK`.

Some components build on others: ProductCard uses WishlistHeart and AddToCartButton; WishlistHeart, QuantityStepper, FreeShippingMeter and StackedBars use RollingNumber. Copy those along.

## Accessibility

- Text pairs hold 4.5:1 and marks 3:1 in all three themes; keep that when re-theming.
- Pickers are radio groups with arrow keys; toggles use `aria-pressed`; meters are progressbars with a readable value; trackers mark the current step.
- Anything that changes on its own (bag count, toasts, order status, code result) is announced through a polite live region; decorative motion is hidden from screen readers.
- Touch targets are at least 36px, 44px for primary controls.

## Adding to the kit

New inspiration goes through the same path every time: rebuild the pattern from scratch (never paste paid or Pro code, never reuse a gallery's media), give it one folder with `README.md` and `preview.html`, add it to the bundle header and `index.d.ts`, check contrast in all three themes and under reduced motion, and record where it came from in the Inspiration library section.
