# Customer-selected rewards and order minimums

## Latest checkpoint: September 8 approved retail-value delivery minimum

**Local and unreleased. The owner approved counting an earned reward's normal retail value toward delivery-area dollar minimums. This does not waive delivery fees, applicable taxes, distance limits or route approval. The ad remains unpublished.**

- Preserved local preparation commit `7f1a3f37cf5440335378a4732d6dde1fcb33422b`, then merged exact current canonical `606bd11b85524d9296a9605fdbc88feb261aaeca` locally. The critical-runner conflict was resolved by retaining both the reward suites and the canonical startup-performance suite. No auth/startup file was overwritten and no external merge, push or deployment occurred.
- Automatic checkout now uses the server reward quote's current catalog subtotal for delivery-minimum qualification while retaining the discounted merchandise amount for charging. The address preview independently obtains the same read-only authoritative quote; it does not trust caller-supplied reward values. Stale preview responses cannot replace a newer cart/address decision.
- Executed real-handler fixtures prove that six earned bottles with $78 catalog value qualify for the $49.99 area minimum and retain the $9.99 delivery fee, that forged values cannot turn $36 into eligibility, and that distance limits and manual route review remain enforced. Ordinary paid-order behavior is covered separately. The minimum harness additionally checks preview validation and both route-entry guards.
- Source review found that manual route authorization does not yet reserve/settle earned rewards. Both its standalone and gateway handler now reject reward redemption before provider or record writes; the UI explains the restriction. This is an explicit temporary release blocker, not a claim that route-review rewards are implemented.
- Current synthetic results: checkout persistence **38/38**, reward minimum policy/preview/route-guard tests pass, and the full registered critical set **135/135**. Configured frontend typecheck, full lint and build passed. A subsequent scoped backend Deno check caught a response-union property access in no-cost preparation; property-existence narrowing corrected it, and the three affected checkout/route handlers now pass the scoped Deno check. Secret scan (1,284 tracked text files, zero findings), diagnostic baseline and diff checks also pass.

Remaining work includes actual fulfillment/notification adapters, route-review reward accounting, credit/direct-points reservations, ordinary member authoritative pricing, interrupted-session recovery, terminal/refund races, supported Base44 promotion and provider/customer-journey verification. WELCOME10 was not activated. No live customer/order/provider request, payment, notification, inventory mutation, ad publish or native/Appflow release occurred.

## Previous checkpoint: September 8 no-cost customer checkout preparation

**Local and unreleased. The real customer no-cost Session preparation and embedded UI are implemented, but provider-specific fulfillment/communication handoff remains incomplete. The ad is not cleared to publish.**

- A fully covered, server-priced member reward order now creates an actual zero-total Stripe embedded Checkout Session, not a fifty-cent charge or fake PaymentIntent. It validates a fresh provider read, reserves the exact points, persists and reads back the matching pending Order and complete private CheckoutSession snapshot before exposing a client secret. Applicable nonzero delivery/balance/credit cases are not silently waived. There was no real Stripe invocation in this task; provider behavior is simulated in tests.
- The central points CAS grants one preparation request permission to create the missing records. Concurrent retries may reuse a completed matching pair but cannot create competing rows or expire the original request's Session. A lost reservation acknowledgement does not establish claim ownership; that ambiguous hold stays preserved. The optional `preparation_attempt_id` field is local schema only.
- Customer checkout separates a reward Session from the existing PaymentIntent UI. No-card copy, duplicate/stale/unmounted completion protection and an order-number-only confirmation handoff are implemented. The confirmation page still independently waits for a verified non-cash receipt; an embedded callback is not represented as fulfilled-order or provider-delivery proof.
- Editing an exposed reward checkout first verifies provider expiration, central hold release and conditional cancellation of only the matching unpaid Order. The UI retains its original checkout and reports uncertainty if cancellation cannot be proved. An interrupted preparation can now return an opaque owned-session recovery hint, never a client secret, and show customer order-history/cancel controls. Cancellation independently verifies ownership and completion, and the checkout lock is released only after exact expiration/release proof. A completely lost response or page reload still lacks durable customer recovery; natural expiration or explicit recovery remains necessary for that case.
- Focused synthetic tests: **49/49** real helper/ledger/dispatcher preparation, concurrency, cancellation and race cases; **28/28** actual reward component and extracted Checkout callback cases; **32/32** actual checkout record-persistence cases. The full registered critical set passes **134/134**. Tests use in-memory Stripe and Base44 behavior, not real Stripe UI, provider delivery or production CAS guarantees. The completed-session integration deliberately expects `reward_checkout_handoff_pending` until real adapters exist.
- Updated G167 to inspect the exact Stripe metadata object with the TypeScript AST instead of a text range that now also enclosed the private checkout snapshot. Its original no-GA-context-in-Stripe-metadata assertion remains; all **67 assertions** pass. No tracking behavior changed.
- Configured typecheck, full lint, Vite build, scoped Deno checks, secret scan, diagnostic baseline and diff check pass. The secret scanner initially flagged three obviously synthetic fixture literals; they were changed to explicit synthetic construction without weakening the scanner or adding allowlist entries. The routing guard caught a new dynamic invocation in the recovery wrapper; the wrapper now names the single existing function literally, and the guard remains unchanged. Runtime preparation marker is `2026-09-08.reward-session-preparation-v2`; `reward_payment_integration_complete` deliberately remains false.
- Fresh read-only Safari review of exact C01 confirms **In draft / Off**, the approved evergreen WELCOME10 and selectable-rewards copy, correct OASIS/AURA/RE-NU carousel, and Meta's selected-placement compatibility message. Feed, Story, Instagram Reels, Explore/search and Facebook overlay previews were inspected; no ad setting or publish action was taken. A preview message saying the ad can deliver is not evidence it is published or the advertised offer is active.
- The separate startup task reports canonical `606bd11b85524d9296a9605fdbc88feb261aaeca`, live site `index-BINMyGkS.js` and Appflow Production 11119577. That release is separate evidence from this task, and excludes this reward branch. Any future integration must preserve that newer canonical source; this older-base isolated tree must not be deployed.

**Remaining release gates:** actual idempotent handoff adapters for native operations, bag returns, Shopify, confirmation email, customer in-app/push, operations email/push and SMS; interrupted-preparation customer recovery; completed-redemption/terminal-order races; credits/direct-points-only holds; route-review and refund parity; ordinary member authoritative pricing; delivery-zone dollar-minimum policy; canonical integration, supported Base44 promotion and provider/customer-journey validation. WELCOME10 remains unactivated by this task. A real-provider iframe, physical device and live delivery were not tested.

No push/PR/merge, deployment, customer/provider write, email/push, ad publication, Appflow/native release, support submission, automation or credential change occurred. Base44's broad app-promotion restriction remains intact.

## Previous checkpoint: September 8 reward webhook dispatch and handoff recovery

**Local and unreleased. Customer no-cost Session creation and provider-specific handoff adapters remain incomplete. The ad is not cleared to publish.**

- The actual Stripe webhook now dispatches recognized reward Checkout events before its legacy cash-payment path. Unknown reward revisions cannot fall through. Signature verification, live-mode checks, staging isolation and the internal ledger credential precede processing. The reward dispatcher never awards cash points or invokes advertising Purchase helpers.
- Completed Sessions use the independently verified settlement from the prior checkpoint. Expired Sessions now independently retrieve Stripe, release the exact central-ledger hold, then conditionally retire only the matching unpaid Order. Missing creation-time records do not strand an otherwise verifiable hold. Paid/terminal/foreign/ambiguous records, changed provider metadata and unconfirmed release fail closed. No refund or provider expiration is initiated by this event handler.
- Added a durable handoff runner with nine separate stages: native operations, bag-return linkage, Shopify mirror, confirmation email, customer in-app notification, customer push, operations email, operations push and SMS. Progress is bound to the Session/context and saved with a conditional revision before dispatch. Retries reconcile an interrupted step from existing evidence instead of blindly sending/creating again. Only whitelisted skips (such as no eligible device or a disabled optional channel) qualify; missing credentials and provider errors do not. Cash/lifecycle/history fields remain untouched.
- **The handoff adapters are not wired to live functions yet.** The webhook currently passes `runHandoff: null` and intentionally returns retryable HTTP 503 after a successful reward settlement while handoff is pending. Customer checkout still blocks zero-cost Session creation. These source changes must not be deployed piecemeal. The new runner's downstream test adapters are entirely synthetic.
- The existing read-only payment-chain monitor now reports pending/review-required reward handoff and rejects a bare `complete` flag without stage evidence. This applies within its existing recent-order window; it is not a new all-history reconciliation scheduler. No monitor was invoked against production.
- Focused synthetic evidence: **96/96** settlement/expiration/actual-webhook cases and **22/22** handoff/recovery/monitor cases. The actual existing paid-checkout benefit retry suite remains **18/18**, and the order-adjustment/refund suite remains **48 assertions**. The full registered critical set is **132/132**. Tests simulate provider signatures, Stripe reads, Base44 conditional storage and handoff adapters; they do not validate real provider delivery or database atomicity.
- Updated two test harnesses to load the actual new webhook helper and the existing sandbox diagnostic assertion to the exact new runtime marker; no behavioral assertion was removed. Configured frontend typecheck/lint/build, scoped Deno checks and diff check pass. The previously documented six unchanged subscription-handler Deno errors remain outside the scoped passing check. An extra standalone G35N shadow test (not registered in the critical set) still fails parsing pre-existing TypeScript annotations in its old raw-JavaScript loader; it was left unchanged, not reported as passing.

**Remaining release gates:** create and persist the real no-cost Session before exposing its client secret; embed customer completion; implement each actual handoff adapter with durable provider evidence and an approved reconciliation path; resolve completed-redemption/terminal-order races, credits/direct-points-only reservations, route review, ordinary member price authority and refunds; then complete canonical release, Base44 promotion and provider/customer-journey verification. A lost dispatch-claim response without recoverable provider evidence deliberately requires review, not automatic resending. WELCOME10 remains unactivated by this task.

No push/PR/merge, deployment, live Order/customer/provider request, email/push, ad publication, Appflow/native release, support submission, automation or credential change occurred. Base44's app-level promotion restriction remains intact. These local files are not in the published iOS app.

## Previous checkpoint: September 8 verified non-cash settlement and confirmation truth

**Local and unreleased. The no-cost customer checkout is still incomplete and the ad is not cleared for publication.**

- Added `stripeWebhook/rewardSettlement.js`, which independently verifies a completed live no-cost Stripe Session against one persisted Order, one CheckoutSession, exact owner/cart/context/reservation/schedule, and the central points ledger. It records a versioned non-cash receipt with `payment_captured=false`, schedules the order, and persists `reward_handoff_status=pending`. It does not claim a captured payment, earn cash-based points, send notifications, create Shopify records, or emit an advertising Purchase. This module is **not yet dispatched by the webhook entrypoint**.
- The production, delivery synchronization, customer/admin read models and payment-chain monitor recognize that verified receipt separately from cash capture. Exact predicate parity is tested across each affected function bundle and the customer confirmation helper. Existing internal-test isolation and the retired Hub-bridge gate remain unchanged.
- Restricted direct Order creation to administrators in the **local** schema. Normal checkout already creates Orders with the backend service role; a runtime frontend scan found no direct Order creation. Customer read and existing update permissions were not changed. This schema has not been deployed.
- Corrected the actual confirmation page: a pending or unverifiable lookup no longer displays success or invents a paid guest confirmation. Paid sanitized guest responses remain supported. Polling cannot overlap, and timeout/unmount suppresses late results. Verified non-cash orders say `Reward redeemed` / `No payment required`.
- Synthetic verification exercises actual settlement and central-ledger code, interrupted writes, consumed-hold replay, ownership/context mismatches, conditional-write races, customer/admin projections and production-to-delivery transitions. No food-safety facts, live records, provider requests, email or push were created. These simulations do not prove Base44 production atomicity or provider delivery.
- The full critical regression set passes **131/131**. Focused settlement tests pass **69/69** and actual-component confirmation tests pass **19/19**. Configured frontend typecheck, lint, Vite production build, scoped Deno checks for the changed leaf handlers/admin gateway, and diff check pass. A broader customer gateway Deno check still reports six existing Stripe union-type errors in the unchanged legacy `createSubscriptionPaymentElementIntent` handler (SHA-256 `21c5d1937e5ec22cfd1149ff7967f64a691ca0bd1187d08f59bed9c1d7910ced`, identical to checkpoint HEAD). That broader check is **not passing** and the retired subscription code was not altered to mask it.

**Next required work:** no-cost Session creation and embedded customer confirmation; completion/expiration dispatch; durable, idempotent operational and communication handoff; reconciliation for a completed redemption whose Order concurrently becomes terminal; upfront credits/direct-points-only holds; route-review and refund parity; ordinary member authoritative pricing. `createPaymentIntent` still returns `REWARD_NO_PAYMENT_FINALIZATION_REQUIRED` for the covered-reward case. The receipt groundwork must not be presented as a working zero-dollar checkout.

No push, PR, merge, deployment, provider/customer write, WELCOME10 activation, ad publication, Appflow/native action or Base44 support mutation occurred. The app-level promotion restriction is unchanged. Published iOS build 43 does not contain these local unfinished changes.

## Previous checkpoint: September 8 no-payment accounting and safe abandonment

**Local and unreleased. This is not a completed zero-dollar checkout or permission to publish the ad.**

- The existing central loyalty handler now separately recognizes real no-cost Stripe Checkout Sessions (`cs_...`) under `4.0_reward_no_payment`. It independently retrieves Stripe, requires USD, live/account ownership, payment mode, exactly zero total, no PaymentIntent, and a matching reservation/context. Completion additionally requires `no_payment_required` and one exact persisted checkout snapshot. It consumes the held points once using a `stripe_checkout:...:redeemed` receipt; there is no invented cash payment or cash-based points award. Expiration releases the hold without a redemption. An open Session or caller-supplied status cannot release it. [Stripe no-cost orders](https://docs.stripe.com/payments/checkout/no-cost-orders?locale=en-GB)
- Added the optional `checkout_session_id` reservation field to the **local** UserPoints schema. It is mutually exclusive with a PaymentIntent. Existing PaymentIntent holds tolerate a null new field, and corrupt/double-bound holds fail closed. No schema has been deployed. Runtime accounting revision is `2026-09-08.points-cas-no-payment-v2`.
- Fixed a real source bug in `cancelAbandonedCheckouts`: the old bulk path caught a Stripe retrieval/cancellation error and still permanently marked the local order abandoned. The new path requires verified exact provider ownership and confirmed cancellation before an independently verified hold release, then conditionally marks only the still-unpaid, unchanged order. Provider uncertainty, paid/processing/manual-capture state, ambiguous/missing identity, and concurrent paid/audit updates leave the order untouched for reconciliation/retry. Oldest pending rows are examined first. The handler now pins the same SDK 0.8.48 as the ledger so the conditional-update API is available; runtime revision is `2026-09-08.confirmed-provider-cancellation-v2`.
- The cancellation candidate supports exact no-cost Session expiration. It deliberately does not infer cancelability for an arbitrary legacy hosted Session or a record with both provider IDs; those cases are retained for explicit reconciliation. Existing admin/owner authorization and the exact-order confirmation requirement remain. No provider cancellation was executed.
- Focused synthetic evidence: **51/51** points/reservation cases and **40/40** abandonment cases. Four connected tests execute both actual handlers (cancellation -> central loyalty) with simulated Stripe and conditional storage, including an interrupted Order write and retry. They prove the modeled hold release, unchanged point balance, member projection, and absence of a redemption transaction; they do not prove Base44 production atomicity or live Stripe delivery.
- Combined local verification: **129/129 critical harnesses**, configured frontend typecheck/lint, configured Deno checks for both changed handlers, production Vite build and diff check pass. No strict-mode claim or production/provider validation is implied.

**Still unfinished:** `createPaymentIntent` continues to return `REWARD_NO_PAYMENT_FINALIZATION_REQUIRED` for a fully covered reward. No no-cost Session is created or exposed by the customer checkout yet, and no zero-dollar order is promoted to operations. Next work must join Session creation + embedded confirmation + completion/expiration webhooks to an explicit non-cash settlement state, then teach production, delivery, order history, communication and monitoring qualification to accept the verified state without pretending `payment_captured=true`. Current strict capture assumptions remain in `syncOrderToHub`, native batch/fulfillment execution and post-payment monitoring. Do not bypass those gates with a fabricated captured payment. Route-review parity, upfront credits/direct-points-only holds, ordinary member price authority, refunds and durable handoff remain open as described below.

No push, PR, merge, deployment, customer/provider record, email, notification, ad publication, WELCOME10 activation, Appflow/native release, Base44 support mutation or broad Publish occurred. The existing support/release restriction is unchanged.

## Previous checkpoint: September 8 reward selection and payment wiring

**Local, unreleased work. The ad is not cleared for publication.** Earlier sections below are historical checkpoints, not a claim that all of their remaining-work lists are current.

- Added a separate earned-reward picker for one shot/bottle, three half-price upgrade bottles, and six included VIP bottles. Customers choose actual flavors and quantities. Paid and birthday items remain separate, and an incomplete selection cannot partially replace the cart. The legacy birthday picker is unchanged.
- The standard signed-in `createPaymentIntent` path now charges the catalog-backed reward quote, not submitted reward prices or costs. The tier cost and any direct points discount use one reservation before the client secret is exposed. A retry can reuse its own held points only with the same provider intent and checkout hash. Failure cancels only an unconfirmed intent and releases points only after confirmed cancellation; uncertain outcomes remain blocked.
- Applied integer-cent reward/points/credit arithmetic and prevented account discounts from exceeding the merchandise balance. Added explicit Order item schema fields for earned identity, pre-reward price, line discount and catalog identifiers, retaining the actual Product ID and quantity. Validated program-shot lineage is preserved through the reward quote into both Order and CheckoutSession.
- A product disappearing during picker confirmation now removes only its unavailable quantity, keeps other choices and lets the customer select a replacement. It no longer traps the customer at an invisible selection limit. Failed saves retain the selection; double taps cannot start a second save.
- A configured Deno check exposed type inference problems in the existing Meta context object and the new optional program-addon result. Added a context type and a property-existence guard without changing tracking behavior. The first-order and BRCLUB test harnesses now transpile the real TypeScript helper fragment before executing it; no eligibility assertion was removed.

Focused synthetic evidence: selection **63/63**, actual payment creation/persistence **32/32**, canonical quote **57/57**, central points/reservations **38/38**, payment-benefit retry **18/18**. These execute local source with in-memory entities and simulated Stripe/Maps; they are **not** a provider sandbox or production test.

Combined local checks: **128/128 critical harnesses**, configured frontend typecheck, lint, build with the explicit NuVira public app ID/base URL, configured Deno checks for both changed TypeScript handlers, and diff check pass. The repository's Deno configuration is not strict mode; no strict-typing claim is made. An initial Deno dependency auto-install disturbed local `node_modules` during a concurrent build; dependencies were restored with the unchanged npm lock and the existing postinstall patch, then the build passed. No package/lock changes or deployment resulted. Secret scan covered 1,266 tracked text files with zero findings.

An isolated browser fixture at `scripts/fixtures/reward-picker` uses the real picker and local images, with no production SDK, credentials or entity writes. At an observed CSS viewport of 390x843, the modal stayed within the viewport, all three juice images loaded and quantity buttons measured 44x44. Tested mixed six-bottle selection, three-flavor half-price upgrade, 2oz shot-only choices, failed-save retention, and availability loss followed by successful replacement. Browser viewport overrides were reset. This is browser evidence, not physical-device verification.

Fresh Meta C01 readback (ad `120246231181900138`): In draft, off, manual carousel, catalog disconnected, same evergreen WELCOME10/rewards copy, Shop Now, pixel `719023677458304`, and approved UTM. Meta's preview compatibility message says the ad can deliver to all selected placements. Feed, Story and Instagram Reels previews were visually inspected; no ad settings or spend were changed. The wording in that compatibility message does not mean the draft is live.

### Release blockers that remain

1. **A zero-total reward order is not implemented.** The new reward path stops before creating a fabricated fifty-cent payment. Stripe documents no-cost Checkout Sessions and completion through `checkout.session.completed`, with no PaymentIntent. A real no-payment finalizer, loyalty reservation binding, cancellation/expiration and normal fulfillment/communication handoff must be integrated and verified first. [Stripe no-cost orders](https://docs.stripe.com/payments/checkout/no-cost-orders)
2. **Route-review payments do not yet use this reward quote/reservation contract.** All routes, approval/capture/cancellation paths and the UI must agree. Existing delivery-zone dollar thresholds and their pre-/post-discount basis remain a separate unresolved policy/implementation check; this checkpoint does not waive them.
3. **Direct points without a selected tier and credits still need upfront holds.** Credits are checked before payment and debited with conditional replay protection after payment, but this does not prevent two separate prepared payments from using the same available credit. Ordinary non-reward member pricing still needs full authoritative parity, including legacy birthday and program behavior.
4. **Abandoned-attempt and refund reconciliation, database concurrency guarantees and durable fulfillment/communication recovery remain acceptance gates.** Local conditional-write fixtures are not proof of Base44 production compare-and-set or unique account creation.
5. **WELCOME10 activation and live release are held.** No DiscountCode activation, schema/function/site/Appflow/native release or provider traffic occurred. Base44's app-level promotion/support restriction was not bypassed. Do not deploy this branch piecemeal or enable the ad from local test results.

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

### September 8 payment-accounting checkpoint (local only, not deployed)

This continuation changes source, not production state. It does **not** make the offer or reward checkout ready to advertise.

- Fixed a separate source defect in `stripeWebhook`: `payment_intent.payment_failed` previously set cancelled/abandoned/do-not-recover flags. A decline now preserves the pending order so a later successful attempt can be finalized. Delayed failures cannot overwrite a paid order. Duplicate cancellations do not repeat cancellation alerts, and a cancellation cannot overwrite a captured/refunded order.
- Embedded payment benefits now complete before the paid flag is written. An already-paid replay separately repairs unfinished points/credit accounting without replaying the fulfillment/notification handoff. Zero earned points do not call the nonzero ledger mutation API. This repairs benefits only; it is not a general durable outbox for every fulfillment/provider side effect.
- `enrollNewCustomerInLoyalty` remains the sole points-balance writer. Its new helper saves each delta plus its idempotency receipt in the same conditional UserPoints update. Pending legacy replay uses the current balance and existing receipt instead of overwriting with an old after-balance. Equivalent pending duplicate transaction rows can recover to one posted transaction, with losers retained as voided audit records. Conflicting posted transactions fail closed for review.
- Added held/consumed/released reward reservations on the existing points account. The existing central function has `reserve_reward_checkout` and `settle_reward_checkout` actions, still internal/admin only. These actions retrieve the PaymentIntent from Stripe and verify owner, embedded-account flow, currency, mode, reservation and checkout hash. A supplied caller status cannot release a hold. Only confirmed cancellation releases it; confirmed success consumes it once. Declines, processing and local timeouts do not release retryable holds.
- Added a monotonic LoyaltyMember projection revision so a delayed mirror write cannot roll a newer balance back. Standalone/gateway reward selection and Rewards/Checkout availability now exclude held points.
- Credit redemption uses the same conditional-write pattern for amount plus receipt. The existing bag-return credit issuer was updated too: a simultaneous issuance must not overwrite a checkout debit. Old history receipts are no longer dropped after 200 entries. No bag-return amount, policy, inventory, customer communication, or real record was changed.
- The three affected writer SDK imports pin `@base44/sdk@0.8.48`, whose published package exposes the documented `updateMany` query/update API. No fallback to unconditional writes is allowed when that API is unavailable. The changed schema files are UserPoints, LoyaltyMember and NuViraCredit; they have not been deployed. No new function name was added.
- Local fixture evidence: points/reservation accounting 35/35; payment retry/credit accounting 18/18; selection 55/55; bag-return existing contract 16 cases; combined critical runner 128/128. Secret scan: 1,261 tracked text files, zero findings. Diagnostic baseline: zero new lint/typecheck/dependency findings. The actual handlers are executed with in-memory entities and a simulated Stripe class. The modeled decline -> successful retry reaches the mocked native fulfillment handoff; no provider, payment, customer notification, production, inventory or live record call occurs.
- Deno checks pass for the changed central ledger and bag-return TypeScript handlers. The existing webhook retains its pre-existing `@ts-nocheck`; its new payment helper and handler paths are covered by executed fixtures, not a claim of full static webhook typing. Frontend typecheck, configured lint, and the configured production build pass.

**Still required before any release or ad publish:** connect the canonical pricing quote and reservation creation to ordinary and route-review charging; complete the VIP/upgrade product-selection path; remove the actual payment path's inappropriate minimum-charge behavior for a fully covered order; finish upfront point/credit reservation, abandoned-checkout cancellation/reconciliation and refund policy. The new central reservation actions and webhook support are present, but `createPaymentIntent` does not yet call them. `reward_payment_integration_complete=false` remains intentional and accurate.

The SDK documentation describes conditional query/update operators, not a transaction/uniqueness guarantee for this production app. An isolated provider-backed Base44 compare-and-set/concurrent-bootstrap test is a release gate. New-account creation still cannot assume a unique email constraint: duplicate accounts fail closed rather than silently choosing a balance. A refund reversal that conflicts with an active hold also fails closed pending reconciliation; no refund/hold cancellation policy is invented here. These remaining cases must not be called production-verified from local concurrency fixtures.

Primary references used for the implementation boundaries: [Base44 entities/updateMany](https://docs.base44.com/developers/references/sdk/docs/type-aliases/entities), [Stripe webhooks](https://docs.stripe.com/webhooks), and [PaymentIntent cancellation](https://docs.stripe.com/api/payment_intents/cancel). No schema push, selective function deploy, broad Publish App, setting change, or help-center workaround was performed.

### September 8 deeper checkout corrections (local only, not deployed)

- Merged canonical `a0cc24b11b6c71280836e4cf67b50779b5fa0fee` into this isolated branch, preserving the Base44 package update and 24 migrated workflows. No competing source was overwritten or published.
- Added catalog-backed reward pricing for all six live reward types plus legacy discount/free-delivery types. The read-only `preview_reward_checkout` mode on the existing `createPaymentIntent` loads the authenticated account's balance and actual catalog; it rejects forged costs, prices, product sizes, counts, stale IDs, duplicate earned lines and insufficient available points. It uses integer-cent calculations and retains real Product IDs.
- `discount_10pct` is now recognized by the Checkout UI; previously it only recognized the legacy `discount` identifier.
- A real-handler synthetic test exposed a separate record-persistence regression: `sandboxOrderReady = !internalSandboxCheckout` and `sandboxSessionReady = !internalSandboxCheckout` caused ordinary guest/member calls to skip both pending Order and CheckoutSession creation. Both flags now begin false, and both records must be confirmed before returning a payment client secret. A replay no longer returns early before checking/restoring CheckoutSession. Ownership conflicts and duplicate records fail closed. Storage failure suppresses the secret and attempts to cancel only the same unconfirmed PaymentIntent; uncertain cancellation is not called safe to retry.
- Added admin-only, read-only `checkout_runtime_status` with `checkout_record_revision=2026-09-08.persist-before-payment-v1` and `reward_quote_revision=2026-09-08.reward-checkout-v1`. It explicitly reports `reward_payment_integration_complete=false`. This is for post-release provenance, not activation or a provider test.
- A stricter Stripe fixture then reproduced idempotency errors after advancing time: identical checkout retries had changing order numbers and provider acknowledgment timestamps. Opaque account-scoped attempt hashes now produce stable order references, the observed acknowledgment time stays on the persisted records, and a provider metadata hash binds the cart/reward/ownership context. Changed cart contents, reward selection, address or guest ownership token return a friendly conflict without revealing a stale secret or canceling the original attempt. This follows Stripe's documented same-parameter idempotency contract: https://docs.stripe.com/api/idempotent_requests .
- The pricing fixture's zero-dollar VIP result is merchandise pricing only. **The actual payment path still has a fifty-cent floor, and the quote has NOT yet been wired into charging.** Do not equate quote tests with successful redemption or a zero-dollar order.

Checkpoint test evidence, September 8: all **125/125 critical harnesses passed**, including **18/18** real-handler checkout persistence/retry tests, **55/55** reward-quote/read-only-mode tests and **49/49** first-order-offer tests. No live or provider writes were used. Stripe is simulated, not a provider sandbox. The new record tests prove serial retries, not simultaneous database inserts or retries after provider idempotency expiration. A local pass is not approval to deploy this incomplete reward branch.

Remaining source work before release: wire authoritative quotes into ordinary member and route-review charging; complete bundle selection/curation; reserve points against concurrent checkouts and release/consume them using confirmed payment outcomes; preserve double-points behavior in the ledger; cover cancellation, abandonment and refund/replay reconciliation. The existing ledger uses read-then-write projections and needs a proved concurrency design, not another client-only balance check.

Release also remains separately held: WELCOME10 was absent from the signed-in live DiscountCode table on September 8 (the three rows were NUVIRASUMMER, NUVIRA26 and BRCLUB). No discount record was created or enabled. The ad must remain unpublished until the complete implementation and live validation pass.

Base44 ticket #6a91a714 is no longer open: it was automatically closed September 2 for inactivity, not fixed. Support's August 30 read-only SEO export is preserved as a checksum and reviewed findings in `growth-output/base44-runtime-support-readback-20260908.md` outside this repository. Support still described app-level Publish as the available production-promotion path and did not offer a supported settings-only discard. The export is historical, not a current draft-versus-published diff. No full Publish, checkpoint revert, undocumented settings API, provider mutation or ad publish is authorized by these test results. The other release task acknowledged it will coordinate before touching overlapping checkout/reward files; that acknowledgement is not a global publisher scan.

The persistence test exercises actual handler code with in-memory entities and simulated Maps/Stripe. It proves those code paths, not provider delivery, live Base44 promotion, payment capture, production/fulfillment, or physical-device behavior.

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

September 8 fresh Meta readback during this checkpoint: exact C01 still shows In draft with On/off `aria-checked=false`. The evergreen WELCOME10/earned-rewards copy above is saved; selected placement compatibility again says "Your ad is delivering to all selected placements". Promo codes and email-sign-up offers are unchecked, Shop/Product browsing/Browser add-on destinations are off, and the same pixel and UTM are selected. No ad setting was changed in this read-only check, and Preview to publish was not clicked. This does not prove the advertised offer is live or that purchase tracking has processed a legitimate conversion.

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
