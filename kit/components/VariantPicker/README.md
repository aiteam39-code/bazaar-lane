# VariantPicker

Size or colour selection for one product, as a radio group with a single selected pill that glides between options.

**You provide** `options` (`value`, `label`, optional `soldOut`, and `swatch` colour for `kind="swatch"`), plus `value`/`onChange` or `defaultValue`. The label row shows the current choice ("Colour Indigo").

- Selected is an `inverse` pill with `on-inverse` text; a softer `surface-sunk` highlight follows the pointer, so the row feels magnetic without moving the selection.
- Sold-out sizes are dashed, struck through, announced as "sold out" and skipped by the arrow keys.
- Swatches are 36px discs; the chosen one gets a `surface` gap ring and an `ink` ring.

Do show every size, sold out included; hiding them makes shoppers think the size never existed. Do keep labels short (S, M, 38, 500 g). Don't use swatches without the colour name in the label: colour alone is not enough.

Arrow keys, Home and End move the choice; only the chosen option is in the tab order.

Inspired by: Bencho "Magnetic select"; the colour dropdown in Bencho Finds.
