# Customer-selected rewards and order minimums

## Owner clarification

The customer chooses an available reward using their spendable points. Unlocking a tier does not automatically add a product, spend points, or create an order.

An earned bundle that meets or exceeds the normal item-count minimum may be ordered without buying additional merchandise. The customer may optionally add items. Delivery fees, applicable taxes and normal address/route rules remain separate. A single earned shot/bottle cannot bypass the minimum.

Item-count examples using the current 3-unit rule (one juice=1; one shot=0.5):

| Cart | Count minimum |
| --- | --- |
| One earned 12oz bottle only | Not met |
| One earned 2oz shot only | Not met |
| One earned bottle + two paid bottles | Met |
| One earned shot + five paid shots | Met |
| Earned 3-bottle bundle only | Met |
| Earned 6-bottle bundle only | Met |
| Earned bundle + optional additional items | Met |

Price must not be used as a proxy for bottle count. A $0 reward bundle still has its actual physical bottle count. The implementation must not add a separate paid-merchandise count minimum.

This clarification establishes the item-count rule. This local change does not alter existing delivery-zone dollar thresholds, fees, tax computation, eligibility or route approval; verify all of these separately against authoritative pre-/post-reward amounts before release.

## Local work completed

- Shared orderMinimumStatus helper is used by Cart and by the direct Checkout preflight.
- Cart/checkout count checks ignore item price, count actual reward-bundle bottles and reject an unknown reward-bundle count instead of inventing it.
- Client tests: 19 policy cases, 18 actual checkout preflight cases, and 4 price-independence cases; no provider calls or production writes.
- Normal paid juice, shot, mixed, bundle and merchandise-only count behavior is retained.

### September 8 selection corrections (local only, not deployed)

- Selection waits for the existing authenticated claim handler to confirm the active catalog, current balance, reward type and canonical points cost. Failed requests no longer show success or add free items.
- Cart refresh uses an explicitly read-only validation response. The frontend must not ship before that backend contract is promoted and read back; an old runtime may ignore validate_only, so do not probe it on a real customer.
- Earned lines retain the real Product ID and use a separate cart-line key. A single-item reward is limited to one unit; paid units of the same product remain separate.
- The picker enforces 2oz shots / 12oz juices, awaits successful selection, blocks double taps and retains the picker on error.
- Removing an earned item clears its active reward and defeats late validation responses; removing/replacing a reward preserves paid and birthday lines.
- Local schemas now include the six existing active catalog types plus legacy values, and record pending selection metadata without claiming completed redemption.
- Focused selection harness: 49/49, including auth-recovery protection so loading a stored session does not erase earned items. Final combined critical regression runner: 123/123. Typecheck, full lint, build, diagnostic baseline, diff check and secret scan (1,230 tracked text files, zero findings) pass. The lint configuration excludes src/lib; source execution/typecheck/build and focused tests cover those modules separately. These tests use synthetic fixtures, not customer/provider writes.

This is NOT a complete reward redemption implementation. Checkout still needs authoritative member pricing, implementation/validation of all six reward effects, points reservation/debit/replay behavior, payment success/failure/abandonment, fulfillment and live provider verification. Do not activate the offer or publish reward claims based only on selection/count tests. No app/backend/schema release occurred.

## Required full redemption acceptance cases

1. Available balance (not lifetime points) determines all rewards the customer may select. One selected reward per order follows the existing active_reward contract; replacing/removing it must restore the cart and pending balance cleanly.
2. Resolve reward type, points cost, eligible sizes/products, quantities and prices on the server. Do not trust local storage or a client-provided $0 price.
3. Do not report a successful selection if claim validation fails. Do not expose default UI rewards as redeemable unless the server supports the same catalog.
4. Preserve canonical product IDs for production/inventory/fulfillment. Keep a separate cart-line identity when the same product is both paid and earned.
5. Test free shot, free bottle, discount, double-points, bundle upgrade and VIP bundle individually. The current schema/default UI reward-type mismatch must be reconciled, not hidden.
6. An earned bundle meeting the count minimum reaches payment for applicable delivery/other charges without a paid-item requirement. A single earned bottle or shot remains below minimum.
7. Test direct /checkout and direct backend requests. Client count checks are useful UX but are not an authorization/security boundary.
8. Cover two tabs/concurrent checkouts, stale balance, failed/cancelled payment, abandoned cart, duplicate/replayed webhook, refund handling and exactly-once points accounting. No fabricated production order or balance correction.
9. Reward-available messages are friendly, consent/preference-aware, deduplicated and linked to Rewards. They never auto-redeem. Existing loyalty_reward_unlocked automation is present in source and should be audited/reused before adding any new automation. No message was sent or scheduling changed in this task.

## Current approved ad direction: combine the offer into C01

The owner clarified that the existing product carousel is the setup to proceed with. The separate A03 offer draft is superseded and must not be published. C01 ad ID 120246231181900138 retains its three OASIS/AURA/RE-NU product cards and their matched product destinations. Campaign/ad set, budgets and live Traffic ads are unchanged.

The owner also made WELCOME10 ongoing, with no September expiry, and confirmed the Trio bundle price of $36. The live Trio page and add-to-cart button both showed $36; no live price edit was required. The owner subsequently requested no dollar prices in ad copy. WELCOME10 is not a verified activated checkout offer yet.

Saved C01 primary text:

> Your first NuVira order, 10% off. Real ingredients. Bold, cold-pressed flavor.
>
> Discover OASIS, AURA and RE-NU—100% all-natural juices with no artificial sweeteners and no additives. Choose your favorite or enjoy all three with the NuVira Trio, delivered locally.
>
> Sweet watermelon & citrus. Bright carrot & pineapple. Crisp apple & greens. Which one is your NuVira?
>
> Use WELCOME10 at checkout for 10% off your first order. Join NuVira Rewards to earn points toward complimentary shots and juices, and choose your earned reward on an eligible order.
>
> Tap Shop Now to explore the blends and check delivery availability.
>
> First orders only. Order minimums, delivery fees and applicable taxes apply. Cannot combine with other discounts or reward redemptions.

UTM: utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign=nuvira_sales_welcome&utm_content=c01_first_order_rewards&utm_term={{placement}}.

C01 readback: In draft, On/off=false. Promo-code auto sourcing and email-signup offers remain unchecked; no deadline event. Uploaded six exact-photo editorial graphics; assigned the three square variants to the default carousel placements. The three landscape variants remain library-only because Meta cropped the carousel to a square even with a horizontal source. Product-specific vertical Stories/Reels/Search assets remain.

The draft ad set excludes WhatsApp Status, Messenger Stories, Facebook Business Explore mobile, Audience Network rewarded videos, Facebook in-stream reels and Facebook Reels. Fresh readback confirms 16 included, 6 excluded, 0 allowed with limited spend. Facebook Reels was removed after Meta repeatedly generated a letterboxed derivative; no additional ad set/spend was created. This shared exclusion also applies to V01, which remains off. Instagram Reels and Facebook/Instagram Stories remain. C01 now reports "Your ad is delivering to all selected placements" in the preview compatibility area; this is not evidence that the draft is live. No ads were published, and no live Traffic change occurred. Do not publish until the reward/offer/runtime gates pass.

## Superseded A03: retained unpublished only, NOT the selected launch ad

The following is historical draft evidence, not current commercial copy. Its September deadline is superseded by the ongoing offer above. Do not publish this duplicate draft.

Exact target: NuVira account 1055493810138896; Sales campaign 120246231145760138; ad set 120246231145770138; third ad 120246231145780138.

Draft name: A03 | First Order Offer + Earned Rewards | September | DRAFT.
Destination: https://nuvirajuice.com/shop.
UTM: utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign=nuvira_sales_september&utm_content=a03_first_order_rewards.

Headline: Your First NuVira Order, 10% Off.

Primary text:

> Meet your next favorite juice—and take 10% off your first order.
>
> Discover OASIS, AURA and RE-NU: cold-pressed flavor, real ingredients, delivered locally. Use WELCOME10 through September 30.
>
> More to look forward to: join NuVira Rewards and earn points toward complimentary wellness shots and juices. You choose which earned reward to redeem on an eligible order.
>
> First-order offer ends September 30, 2026, at 11:59 p.m. Central. Order minimums, delivery fees and applicable taxes still apply. Offer cannot combine with other discounts or reward redemptions. Check delivery availability at checkout.

Description: Through Sept. 30. Order minimums and delivery fees apply.
CTA: Shop now.

Existing approved oasis-lifestyle-9x16.png (1152x2048) is a draft placeholder, not a newly generated image and not final placement approval. No AI image variant was selected; automatic animation and reviewed creative-alteration switches are off. Shop-personalized/optimized destinations are off. An unrelated preselected email-signup offer sourced from a different commerce ID was unchecked in this draft, without editing that external commerce account or its offers.

Do not publish: WELCOME10 is not active/verified, redemption issues remain, and all placement framing must still be reviewed. No active Traffic ad, budget, campaign activation, Base44/site/Appflow/native release, customer cart, points or notification was changed.
