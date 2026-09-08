# Limited-time first-order offer: implementation and release boundary

## Owner-approved commercial scope

- 10% off a customer's first purchase, for eligible guests and members.
- Available through September 30, 2026, America/Chicago. Stop new redemptions at **2026-10-01T05:00:00.000Z**, exclusive (midnight October 1 Central).
- Not evergreen. Do not invent urgency before a real activation date.
- Preserve NUVIRASUMMER and its existing signup/next-purchase promise. No existing offer is reclassified by this patch.
- Proposed separate code: WELCOME10. It was absent from the live admin list at inspection. No record has been created, activated, or edited by this change.
- Ad and offer remain unpublished/inactive until runtime validation and creative/Meta validation finish. Existing Traffic spend and approved additional $20/day Sales / 35-mile plan are unchanged.

## Baseline and scope

Fresh independent clone of canonical main 38ca788d794fcc8a36d2b47d8a38af9ff524a76b. The older local clone's packfile issue was avoided; no repair/reset/overwrite was attempted.

Changes are opt-in via DiscountCode.first_order_only, default false. New policy requires once_per_customer plus finite ends_at. Old admin clients omitting the new field preserve its existing value. New UI exposes the choice and requires the end date.

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
- Final focused suite: 45 tests, including exclusive midnight October 1 Central cutoff in both standard and route-review resolvers and zero-dollar reward non-stacking.
- Final typecheck, full lint, diagnostic baseline, explicit-app production build, staged secret scan (1,225 text files; zero findings) and diff checks passed. These are local-source gates, not release/runtime approval.

## Required coordinated activation

1. Review the diff and resolve the pending-checkout concurrency boundary above. Do not merge just to hurry an ad.
2. PR/CI and fresh canonical/publisher conflict checks; no older source snapshot.
3. Scoped schema and existing-function package deployment only, including parent gateways; verify actual published runtime, not just CLI success or a source pull. Stop on a version mismatch. Do not use a broad publish to bypass the Base44 help-center issue.
4. Deploy frontend from that exact approved source and coordinate Appflow for shared code, keeping native/store claims separate.
5. Create the separate offer inactive, 10%, first_order_only=true, once_per_customer=true, expiry 2026-10-01T05:00:00.000Z. No minimum override and no delivery-fee discount.
6. Verify controlled guest/member first-order cases and returning-customer rejection; expiration boundary, no-stacking, route review, current checkout UI and existing-code compatibility. No real customer test or charge without separate authorization.
7. Verify the real offer code before adding it to the Meta drafts. Schedule the offer-bearing creatives to stop no later than the expiry in the ad account timezone. No automatic change to the existing Traffic campaign.
8. Clear Meta #2446880 WhatsApp validation without linking WhatsApp, resolve C01 Facebook Reels framing/placement strategy, inspect actual previews, and retain owner image approval. No ad publication until these gates pass.

## Draft copy direction, not saved to Meta

Primary hook: "Your first taste of NuVira, with 10% off."

Supporting copy:
"Cold-pressed flavor. Real ingredients. Delivered locally.
Discover OASIS, AURA and RE-NU, then choose the blends that speak to you.
Take 10% off your first order with WELCOME10 through September 30.
Three-bottle minimum. Three featured $13 juices are $35.10 after the offer, before delivery and applicable tax.
Check your address and available delivery dates at checkout. First order only; cannot combine with other discounts or rewards."

Do not publish WELCOME10 as a working code until its live configuration and checkout behavior have been verified. Keep product-specific card images and URLs matched. The $35.10 example applies to three individual $13 juices, not the differently priced Trio bundle.

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

- Acquisition: the approved 10% first-order offer through September 30.
- Retention: earned rewards as the supporting benefit, not another discount stacked on the first-order code.
- Lifecycle: a factual reminder when a customer actually has enough points, showing the specific unlocked reward. Do not send prematurely or imply automatic free delivery/order.
- Additional future test: a narrowly timed bonus-points offer only after reward redemption and contribution margins are verified; do not launch several incentives at once.

Conditional draft wording (not saved to Meta):
"Your favorites today. Your next reward to look forward to. Join NuVira Rewards and earn points on eligible purchases toward complimentary wellness shots and 12oz juices."
Supporting terms must state the actual point thresholds, customer-selected redemption, availability and normal order/delivery terms. Keep it out of published ads until the audit hold is cleared.
