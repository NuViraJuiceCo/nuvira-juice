# Google Shopping offer continuity

## Intent and boundary

Owner approved a Google-only improvement pass on September 10, 2026. This patch starts from canonical `abbada070c38960c6da5d326da530f397f07997d` and makes existing first-order and delivery information visible on the exact product destinations used by Shopping ads.

- Product Detail: qualified WELCOME10 reminder beside price, item-count minimum, shared delivery windows, and delivery-policy link.
- AURA/OASIS/RE-NU only: an optional canonical Trio shortcut. Concrete catalog identity takes precedence over a mismatching slug.
- Bundle detail: count qualification uses the existing order-minimum helper, never waives delivery-area dollar minimums, and does not turn malformed/zero bottle counts into qualifying bundles.
- Cart: reminder in scrollable content, not the fixed purchase dock.
- Checkout: reminder inside the existing Rewards & discount code section. Coupon application remains explicit and server-validated; no automatic application or input-state change.

WELCOME10 remains the existing 10% first-order offer, once per customer. Other discounts/reward redemptions cannot be stacked; ordinary minimums, fees and taxes apply. The UI does not assert any specific shopper's eligibility.

## Unchanged systems

No backend function, schema, catalog/product data, payment, order, refund, rewards, consent, analytics, native shell, provider configuration, or customer communication changed. The approved product galleries, image geometry, cart quantity handlers, fixed purchase bars and checkout section mapping remain unchanged. No real order, payment or provider event is used for validation.

## Separate Google Ads action

Two campaign-level negative broad-match keywords (`smoothie`, `smoothies`) were saved and independently reloaded for Search campaign `24195142289` in account `325-350-2382`. Its prior eleven exact exclusions remain intact. Search budget $33.18/day, Shopping budget $20/day and maximum CPC $2.50 remain unchanged. This provider change is separate from source deployment.

Current-day reporting showed Search 51 impressions / 2 clicks / $4.88 / zero conversions. These are pre-change/context data, not an effectiveness result. Relevant paid searches remain allowed. No broad ingredient or juice exclusion was introduced.

Merchant Promotions enrollment was inspected and cancelled. The special first-order promotion format restricts additional minimum-spend conditions; no unconditional Merchant badge was submitted while NuVira's ordinary count/route minimum policy fit remains unconfirmed. No customer list was uploaded for the separate member-tier audience warning.

## Verification and release

The new shopping-offer continuity harness exercises real React rendering, product identity, item-count edge cases, terms, and unchanged checkout controls. The existing first-order, rewards, gallery, address-selection and critical regression harnesses remain required. Browser QA uses mocked API/Stripe boundaries with external transport blocked and must be labeled separately from production purchases.

Release through a reviewed PR and all quality gates. Site and Appflow must use the same exact clean merged commit, with exact affected live URL checks and separate native propagation evidence. Do not promote an older snapshot or publish backend/settings drafts. Provider receipts and final deployment evidence are maintained in the root marketing/release evidence folders.
