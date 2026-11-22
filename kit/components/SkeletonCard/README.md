# SkeletonCard

A loading stand-in with the same shape as ProductCard, so the grid doesn't jump when products arrive.

**You provide** nothing required; `media`, `lines` and `aspect` adjust the shape.

- The base is `surface-sunk` with a slow `surface` shimmer; under reduced motion it stays still.
- It is hidden from screen readers. Mark the grid `aria-busy="true"` and put a visually hidden "Loading products" status inside it.

Do render the same number of skeletons as the page size you expect. Don't show skeletons for under 300ms of loading; that flicker is worse than a blank.

Inspired by: the Loading filter on Bencho; "Shimmer" in 60fps.
