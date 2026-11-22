# Where each piece goes

## Bazaar Lane (multi-vendor marketplace)

| Screen | Components | Notes |
|---|---|---|
| Home | CollectionAccordion, ProductCard row | 4–5 top categories or edits in the accordion; one "New from makers" row of cards below. |
| Category and search results | ProductCard grid, SkeletonCard, WishlistHeart | Skeletons in the exact count of the page size; vendor line on every card. |
| Product page | VariantPicker, QuantityStepper, AddToCartButton (`accent`), WishlistHeart, RollingNumber | Add to bag is the only `accent` on the page. Show every size, sold out included. |
| Any page, after an add | ToastStack, RollingNumber (bag count) | "Added to bag" toast with the product thumb and **View bag**; bag count rolls in the header. |
| Cart drawer and cart page | FreeShippingMeter, QuantityStepper (`sm`), ConfirmButton, RollingNumber (subtotal) | Meter at the top; removal asks once, then offers Undo in place. |
| Sign-in and checkout | OtpInput | Phone OTP; first box takes SMS autofill. Say where the code went, offer resend after 30s. |
| Order confirmation | RollingNumber (total, rolls up), OrderTracker | The one place `animateOnMount` is a celebration. |
| Order tracking | OrderTracker | One human status line per update. |
| Seller dashboard | StackedBars, RollingNumber (KPIs) | Revenue by channel: Marketplace, Instagram, Repeat buyers. |
| Seller listings | ConfirmButton | Delete or unpublish a listing. |

## Barre Cacao (single-product chocolate site, theme `cacao`)

| Moment | Components | Notes |
|---|---|---|
| Hero and product section | AddToCartButton, QuantityStepper | Replace the plain add button; quantity for multi-bar packs. |
| Bottom cart | FreeShippingMeter, RollingNumber | The floating cart already exists; add the meter and roll the count and total. |
| After an add | ToastStack (`bottom-center`) | Short: "Added · Dark Almond 50g". |
| Checkout and COD verification | OtpInput | Phone OTP before cash-on-delivery orders cuts fake orders. |
| Post-purchase | OrderTracker | On the order page and the WhatsApp/email landing. |
| Skip | CollectionAccordion, StackedBars, VariantPicker | One product, one size: they add nothing here. |

## Anything else

- A content or creator site: RollingNumber for follower and view counts, ToastStack for saves and shares, WishlistHeart as a like.
- A SaaS or internal tool: StackedBars, RollingNumber KPIs, ConfirmButton for destructive actions, OtpInput for sign-in.
- A booking or delivery flow: OrderTracker for status, OtpInput for confirmation, ToastStack for updates.
