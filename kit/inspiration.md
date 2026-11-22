# Inspiration library

Every source collected so far, what it is good for, and what the kit took from it. Galleries show other people's work: study them, credit them, and rebuild patterns from scratch rather than copying assets or code.

## The sources

| Source | What it is | Use it for | Taken into the kit | Terms |
|---|---|---|---|---|
| [Bencho — Blocks](https://bencho.dev/) | 179 live React micro-interaction blocks with tunable knobs; Sounds (180+ synthesised UI sounds); Bench (a canvas to arrange blocks); Docs. | Feel references you can play with, and real code for the free blocks. | Rolling counter, Toast stack, Like, Magnetic select, Image accordion, One-time code, Step player, Stacked bars, Context meter, Asset swap, the Press and Loading states, the off-by-default sound policy. | 43 free blocks on GitHub are MIT (keep the notice). Pro (€99/yr or €129 once) code can be used in your products but not redistributed as a kit, so nothing here is Pro code. |
| [Bencho — Finds](https://bencho.dev/finds) | Hand-picked interactions by other designers, each credited, filterable by Hover, Press, Drag, Slide, Swipe, Scroll, Type, Select, Magnetic, Morph, Parallax, Elastic, Reveal. | Spotting a pattern before building it. | Colour swatch picker, commute ETA card (OrderTracker), funnel dashboard idea (StackedBars). | Most items behind Pro; credit the maker. |
| [Ripplix](https://www.ripplix.com/) | 7,000+ recorded interactions from 1,000+ real apps and sites, each with an AI build prompt (Claude, Cursor, Lovable, v0); collections, Figma plugin, MCP. | Finding how a real product animates a specific moment, then prompting a first build. | Quick-add and category-pill patterns; backlog items below. | Prompts are paid past the free tier. Its Black Friday countdown is a sales tactic: buy only when a build actually needs it. |
| [60fps](https://60fps.design/) | 2,140 motion shots from 499 iOS apps, plus App Sites, Storyboards, SwiftUI Snippets and a Glossary of motion terms. Filters by gesture, pattern, effect, element and app category (Shopping, Food & Drink). | Motion vocabulary and timing; the Glossary gives the right words for prompts. | Plus to tick (AddToCartButton), Cancel expand to confirm (ConfirmButton), Graph scrub highlight (StackedBars), Shimmer (SkeletonCard). | Snippets are SwiftUI; we rebuilt them for the web. |
| [Spotted in Prod](https://www.spottedinprod.com/) | The best of shipped iOS UI: staff picks, clips, popular apps, home setups, a leaderboard. | Seeing what polished production apps actually ship. | Live leaderboard digits (RollingNumber), the "Almost at pickup" ride status card (OrderTracker). | Screens belong to their apps; reference only. |
| [regards.design](https://www.regards.design/search) | Website sections searchable by look: Hero, Features, Testimonials, CTA, Footer, Blog, filterable by site and style, with a written description of each section; boards, interactions, MCP. | Picking the layout for a page section (hero, footer) before building it. | Section-level references for Bazaar Lane and Barre Cacao landing pages. | Free tier limits deep searches. |
| [Details](https://www.details.so/inspo) | The details behind great websites, in video: Hero, Footer, SaaS, Button, About, Services, Navigation, Scroll animations, Page and Section transitions; Vault, MCP, "Copy code and context for AI". | Scroll and transition ideas for brand pages. Delta Cafés is a strong food-and-beverage reference for Barre Cacao. | Reference only so far (scroll and transition work is in the backlog). | Full access is paid. |
| [Recent](https://recent.design/) | A daily feed of design across web, interface, branding, motion, illustration, posters and print, plus launch videos, websites, OG images, app screenshots and app icons. | Brand direction, launch videos and OG images. | Reference only: OG image and launch-video ideas in the backlog. | Links out to the makers' own posts. |
| [posts.design](https://posts.design/) | What 1,160+ brands actually post on social, plus profile headers and OG images, by category: launches, hiring, events, updates, teasers, memes, partnerships, branding. | Instagram and launch posts for Barre Cacao, PIECEOUT and your own channel; share cards for product pages. | Reference only: social and OG templates in the backlog. | Posts belong to the brands. |

## Backlog — seen, not built yet

Ranked by what it would do for Bazaar Lane first.

1. **OG share card per product** (posts.design, Recent) — every product link shared on WhatsApp shows photo, price and maker.
2. **Product zoom loupe** (Bencho Finds, the jacket) — a lens that follows the pointer on product photos.
3. **Category pill crossfade** (Ripplix, Ko-fi) — category chips that crossfade the grid below without a page load.
4. **Delivery speed choice with ETA** (Bencho Finds, the commute card) — Standard / Express as a segmented control with the arrival time; the Segmented control already exists inside StackedBars.
5. **Seller milestone sheet** (Ripplix, Streak milestone) — a bottom sheet with a badge when a seller hits their first or hundredth order.
6. **Amount input with jumping commas** (60fps snippet) — for sellers setting prices.
7. **Scroll product stage** (Ripplix, Shopify Editions) — a pinned product that turns as copy scrolls past; Barre Cacao's bar is the candidate.
8. **Generate description button** (Bencho "Generate") — AI-written product descriptions for sellers.
9. **Image compare** (Bencho) — before / after for refurbished or restored goods.
10. **Social post templates** (posts.design) — launch, restock and review posts for Barre Cacao and your Instagram.

## How a new source gets added

1. Go through every section of the site: main feed, every category or filter, docs, licence and pricing.
2. Add a row above: what it is, what to use it for, what was taken, the terms.
3. Rebuild only the patterns that earn their place in a real screen; park the rest in the backlog with the source named.
4. Build each one as a kit component (README, preview, tokens only) and say which screen it goes on in "Where each piece goes".
