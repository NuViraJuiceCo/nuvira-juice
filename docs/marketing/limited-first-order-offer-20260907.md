# Ongoing first-order offer: implementation and release boundary

## September 8 current status (supersedes historical audit notes below)

WELCOME10 remains uncreated/inactive. The ongoing no-expiration policy passes 49 focused tests, and reward-selection safety passes 49 cases. The combined critical suite has 123 harnesses; final rerun evidence is stored outside the repository. Selection defects described in the historical audit below are corrected locally; full checkout pricing/redemption/reservation and deployment validation are not complete. No source merge, Base44/site/schema/Appflow release, paid provider event, customer balance change or ad publication occurred. The Base44 published-runtime promotion incident remains an explicit release boundary, not permission for a broad publish.

C01 is the selected combined carousel, with no dollar-price or September-deadline copy. Six matching square/landscape graphics were uploaded; only the three square variants were assigned. Incompatible placements and letterboxed Facebook Reels were excluded from the draft ad set; C01 now reports compatibility with all selected placements. The $20/day / 35-mile draft setup remains unchanged. See earned-reward-checkout-contract-20260907.md for the exact saved copy and current exclusions. Older creative/placement observations below are historical, not current readiness claims.

## Owner-approved commercial scope

- 10% off a customer's first purchase, for eligible guests and members.
- Owner superseded the earlier September cutoff: WELCOME10 runs year-round with no scheduled expiration. Do not invent seasonal urgency.
- The NuVira Trio is one OASIS, one AURA and one RE-NU for $36. WELCOME10 makes the merchandise price $32.40, before delivery and applicable tax. The live product page and add-to-cart label were read back at $36; source public catalog also uses $36. No price mutation was needed.
- Preserve NUVIRASUMMER and its existing signup/next-purchase promise. No existing offer is reclassified by this patch.
- Proposed separate code: WELCOME10. It was absent from the live admin list at inspection. No record has been created, activated, or edited by this change.
- Ad and offer remain unpublished/inactive until runtime validation and creative/Meta validation finish. Existing Traffic spend and approved additional $20/day Sales / 35-mile plan are unchanged.

## Baseline and scope

Fresh independent clone of canonical main 38ca788d794fcc8a36d2b47d8a38af9ff524a76b. The older local clone's packfile issue was avoided; no repair/reset/overwrite was attempted.

Changes are opt-in via DiscountCode.first_order_only, default false. New policy requires once_per_customer. An end date is optional for ongoing offers; if supplied, it must be valid. Old admin clients omitting the new field preserve its existing value. The UI explicitly explains that a blank end date means an ongoing offer.

Three existing function packages own the implementation:
- createPaymentIntent: discount validation and standard payment-intent path.
- getCustomerAccountDashboardData: createZone3AuthorizationIntent.
- getAdminOperationsDashboardSummary: manageAdminDiscountCode and approveZone3DeliveryRequest.

No new deployed function name, removal, automation, customer correction, notification, provider configuration, or tracking behavior change. The existing DiscountCode and DeliveryApprovalRequest schemas gain opt-in booleans. Gateway bundle-revision markers are updated because nested-handler-only deployment hashes previously went stale.

Each package contains an identical firstOrderEligibility.js helper to avoid cross-package import assumptions. Regression tests enforce byte-identical copies.

## Rules and evidence limits

- Prior paid/captured/refunded native, Shopify/POS, or route-review purchase consumes first-order eligibility even without use of this specific code.
- Clearly marked test/sandbox orders, unpaid attempts, cancelled-unpaid attempts and uncaptured holds do not consume eligibility. A refund does not create another first purchase.
- Checkout email is normalized and matched with an escaped anchored case-insensitive query. An authenticated user's account email is also checked; editing receipt email cannot bypass that known account's history.
- Reads are paginated; invalid response, identity mismatch, repeated pagination, lookup failure or an exhausted 10,000-row bound fails closed with a PII-free retry/remove-code message.
- The query uses Base44's documented Mongo-compatible entity filter and skip pagination. Production operator/runtime behavior still needs scoped read-only verification: https://docs.base44.com/developers/references/sdk/docs/type-aliases/entities
- Eligibility is checked when applying the code and again on standard checkout / route authorization. Route-review capture rechecks the server-saved policy and identity against new paid history. It never silently increases the amount on an existing hold.
- New first-order offers reject stacking with points/reward/credit/subscription discounts, including selected zero-dollar rewards and synthetic free-item cart lines. Existing discount behavior is unchanged.
- Merchandise math and the normal bottle minimum, catalog pricing, delivery charges, scheduling, checkout auth and guest restrictions remain unchanged.
- The existing Zone 3 authorization path requires an authenticated customer. This patch does not remove that separate restriction; do not advertise that every route-review address can complete as a guest.
- This is email/account-linked purchase-history enforcement, not person-level fraud prevention. Unlinked POS purchases without a usable email and purchases under unrelated identities cannot reliably be matched.
- Existing already-issued standard Stripe PaymentIntents can be confirmed independently. These preflight checks alone are NOT an atomic reservation guaranteeing a single discount across concurrent pending checkouts. Do not call the implementation race-proof. Resolve or explicitly accept this limitation before activating a strictly first-purchase-only promotion; no post-payment automatic price increase, refund, or order cancellation is introduced.

## Verification performed locally

- Focused first-order tests cover helper behavior and actual transpiled validation/admin/route handlers with mocked entities and Stripe; no external network or provider writes.
- Existing BRCLUB/NUVIRASUMMER/referral regressions pass.
- Critical regression runner: final run passed 121/121 harnesses with writes_performed=false and provider_calls_performed=false.
- Typecheck, lint, diagnostic baseline, production build with the explicit NuVira app identity, and diff checks passed.
- No live first-order validation, payment, confirmation email, loyalty, inventory, fulfillment, Google/Meta purchase event, Appflow or physical device evidence is asserted here.
- Updated focused suite: 47 tests, including ongoing eligibility across month/year boundaries, optional explicit cutoff behavior, and zero-dollar reward non-stacking. Current guest/member validation fixtures have no expiration.
- Final typecheck, full lint, diagnostic baseline, explicit-app production build, staged secret scan (1,225 text files; zero findings) and diff checks passed. These are local-source gates, not release/runtime approval.

## Required coordinated activation

1. Review the diff and resolve the pending-checkout concurrency boundary above. Do not merge just to hurry an ad.
2. PR/CI and fresh canonical/publisher conflict checks; no older source snapshot.
3. Scoped schema and existing-function package deployment only, including parent gateways; verify actual published runtime, not just CLI success or a source pull. Stop on a version mismatch. Do not use a broad publish to bypass the Base44 help-center issue.
4. Deploy frontend from that exact approved source and coordinate Appflow for shared code, keeping native/store claims separate.
5. Create the separate offer inactive, 10%, first_order_only=true, once_per_customer=true, ends_at=null. No minimum override and no delivery-fee discount.
6. Verify controlled guest/member first-order cases and returning-customer rejection; expiration boundary, no-stacking, route review, current checkout UI and existing-code compatibility. No real customer test or charge without separate authorization.
7. Verify the real offer code before publishing the Meta drafts. There is no offer-driven September stop date. No automatic change to the existing Traffic campaign or ad budgets.
8. Clear Meta #2446880 WhatsApp validation without linking WhatsApp, resolve C01 Facebook Reels framing/placement strategy, inspect actual previews, and retain owner image approval. No ad publication until these gates pass.

## Draft copy direction (superseded by the combined carousel below)

Primary hook: "Your first taste of NuVira, with 10% off."

Supporting copy:
"Cold-pressed flavor. Real ingredients. Delivered locally.
Discover OASIS, AURA and RE-NU, then choose the blends that speak to you.
Take 10% off your first order with WELCOME10.
The NuVira Trio is $36, or $32.40 with the first-order offer, before delivery and applicable tax.
Check your address and available delivery dates at checkout. First order only; cannot combine with other discounts or rewards."

Do not publish WELCOME10 as a working code until its live configuration and checkout behavior have been verified. Keep product-specific card images and URLs matched. Distinguish the $36 Trio from three separately purchased $13 bottles.

## Earned-reward promotion: audit hold

Owner is interested in advertising earned free juices and considering other promotions. No additional offer activation is authorized by that suggestion.

Read-only live Rewards page inspection confirmed the displayed catalog:

- 500 points: Free Wellness Shot, described as one 2oz shot added to an order.
- 1,000 points: Free Add-On Bottle, described as one 12oz bottle added to the next order.
- Customers press Redeem and choose an item; it is not automatically added to all eligible orders.

Do not advertise this as a verified end-to-end redemption yet. In canonical source 38ca788:

1. Rewards.handleFreeProductSelect places a zero-price synthetic product ID in the cart with isFreeReward=true. It does not call claimReward, persist activeReward, or carry the selected reward ID and points_required.
2. An isolated execution of that exact handler with a synthetic 1,000-point reward reproduced a free cart line without its points cost; no browser/customer/provider write occurred.
3. Checkout reads activeReward separately from local storage. The payment normalizer drops isFreeReward; webhook redemption relies on points_used or active_reward.points_required. The free-selection path alone therefore does not supply the required debit context.
4. FreeProductPicker filters available category=juice but does not enforce the advertised 12oz size. The loyalty picker and authoritative checkout must enforce the eligible catalog/size, not just the marketing description.

No claim is made that a particular live customer obtained a free item improperly. The above is a reproducible source-path defect, not a paid production test. No reward threshold, customer balance, cart, claim, or webhook was changed during this audit.

Before using free-product claims, verify/fix the full selection -> authenticated reward validation -> canonical product mapping -> cart quantity limit -> checkout -> payment -> exactly-once points debit -> fulfillment path. Include insufficient points, two tabs, abandonment, removal, payment failure, duplicate webhook, and refund-policy tests.

Recommended promotional hierarchy, pending those gates:

- Acquisition: the approved ongoing 10% first-order offer with no scheduled expiration.
- Retention: earned rewards as the supporting benefit, not another discount stacked on the first-order code.
- Lifecycle: a factual reminder when a customer actually has enough points, showing the specific unlocked reward. Do not send prematurely or imply automatic free delivery/order.
- Additional future test: a narrowly timed bonus-points offer only after reward redemption and contribution margins are verified; do not launch several incentives at once.

Conditional draft wording (not saved to Meta):
"Your favorites today. Your next reward to look forward to. Join NuVira Rewards and earn points on eligible purchases toward complimentary wellness shots and 12oz juices."
Supporting terms must state the actual point thresholds, customer-selected redemption, availability and normal order/delivery terms. Keep it out of published ads until the audit hold is cleared.
