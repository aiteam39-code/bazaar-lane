# StackedBars

Seller revenue by channel as stacked bars, with a Day / Week toggle; point at or focus a bar and the headline scrubs to that bar.

**You provide** `datasets` (one per period, each with `label`, `caption`, `bars`), `series` (`key`, `label`, `tone` 1–3) and optionally `format`, `title`, `height`.

- Series colours are `chart-1` to `chart-3`, told apart by lightness and named in the legend, which also shows each series' value for the hovered bar or the period.
- Bars grow in with a stagger when the period changes; each bar is a button whose label reads out its full breakdown.

Use it on the seller dashboard home. Do keep to three series; group the rest as "Other". Don't use it for single-series data; a plain bar or a number is clearer.

Inspired by: Bencho "Stacked bars"; "Graph scrub highlight" in 60fps snippets; the funnel dashboard in Bencho Finds.
