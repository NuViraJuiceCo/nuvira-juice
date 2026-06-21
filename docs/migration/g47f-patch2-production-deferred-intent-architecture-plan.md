# G47F-PATCH2: production deferred-Intent Apple Pay architecture plan

## Executive summary

PATCH1 proved the missing Apple Pay button was not a Stripe domain, mode, device, Wallet, or NuVira rendering blocker. On a real iPhone in Safari, NuVira's side-effect-free diagnostic mounted Stripe Express Checkout and reported:

- `diagnostic_mode_active=true`
- `public_config_loaded=true`
- `express_checkout_mounted=true`
- `available_payment_methods_present=true`
- `apple_pay_available=true`
- `google_pay_available=false`
- `link_available=true`
- `apple_pay_button_visible=true`

No Apple Pay sheet was opened. No payment was submitted. No PaymentIntent, Checkout Session, Customer App Order, native ShopifyOrder, FulfillmentTask, Hub sync, notification, loyalty/credit mutation, inventory deduction, or PurchaseOrder was created.

PATCH2 should not be a payment execution phase. Its job is to design the production checkout architecture so ordinary eligible customers can see Apple Pay before any backend payment/order side effects begin, while preserving the existing paid/captured webhook finalization path.

Final PLAN1 classification:

```text
apple_pay_production_deferred_intent_architecture_plan_ready
```

## Scope and no-write policy

This phase is docs/fixture-only. It does not change production checkout runtime, Base44 functions, Stripe configuration, Hub behavior, schemas, or UI behavior.

No provider calls are made by this plan or harness. No live records are created or updated.

Explicitly not approved in this phase:

- creating a PaymentIntent;
- creating a Checkout Session;
- creating, updating, deleting, or hiding a Customer App Order;
- creating a native ShopifyOrder or FulfillmentTask;
- opening, confirming, or submitting Apple Pay;
- submitting, capturing, voiding, or refunding any payment;
- changing Stripe domain or payment method settings;
- suppressing Hub writes or changing Hub fallback;
- sending notifications;
- mutating loyalty, credits, inventory, or PurchaseOrders;
- publishing Base44 or Builder.

## 1. PATCH1 live proof

Source and evidence:

- `src/components/checkout/ApplePayMountDiagnostic.jsx`
- `docs/migration/g47f-patch1-smoke1-iphone-apple-pay-diagnostic-result.md`

PATCH1 used Stripe Elements in `mode: 'payment'` with a fixed diagnostic amount and no client secret. It loaded only the live publishable configuration through the read-only `previewNativeOrderCutoverReadiness` public config preview. The diagnostic branch was admin/owner-only and default-off behind the explicit `apple_pay_mount_diagnostic` query parameter.

Live iPhone Safari evidence showed Apple Pay, Link, and Amazon Pay rendered inside NuVira. This confirms wallet rendering is solved. The remaining problem is production checkout sequencing: the current customer flow waits until `createPaymentIntent` has already created backend state before mounting `EmbeddedPayment`.

## 2. Current checkout sequence

Current customer checkout path:

| Step | Component/function | Source file | Backend call | Entity write | Stripe call | Hub/Shopify/notification impact | Idempotency/failure behavior | Customer-visible outcome |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Checkout wrapper | `src/pages/Checkout.jsx` | none | none | none | none | explicit diagnostic query can route admin/owner to PATCH1 diagnostic | normal customers enter `CheckoutFlow` |
| 2 | Customer/cart/address validation | `src/pages/Checkout.jsx` `handlePlaceOrder` | local reads and profile reads | may update `UserProfile`; may create pending `BagReturn` | none | bag return may invoke customer Hub sync before payment | validation failures toast and stop | customer remains on checkout |
| 3 | Payment setup | `src/pages/Checkout.jsx` `handlePlaceOrder` | the Base44 `createPaymentIntent` function call | request proceeds to backend | none in client | none directly in client | schedule or delivery validation can fail before mount | payment step is not shown until response succeeds |
| 4 | Backend validation | `base44/functions/createPaymentIntent/entry.ts` | delivery eligibility, subscriptions, schedule options | none before success path | none before success path | none | stale schedule or route review fails closed | frontend sees error/stale schedule |
| 5 | PaymentIntent creation | `createPaymentIntent` | same function | none yet | Stripe PaymentIntent creation | Stripe provider call occurs before Express Checkout is visible | no explicit checkout attempt id; order number is timestamp-derived | payment state now exists |
| 6 | Pending Order pre-create | `createPaymentIntent` | same function | Customer App Order creation with `status='pending_payment'`, `payment_status='pending'`, `payment_captured=false` | none | comments say it must not sync to Hub until payment succeeds | creation failure is non-fatal; webhook has safety-net creation | pending Customer App Order can exist before customer confirms wallet/card |
| 7 | Legacy compatibility row | `createPaymentIntent` | same function | CheckoutSession creation keyed by PaymentIntent id | none | none | failure is non-fatal | compatibility state may exist |
| 8 | Payment UI mount | `src/pages/Checkout.jsx` and `src/components/checkout/EmbeddedPayment.jsx` | none | none | Elements receives `clientSecret`; Express Checkout mounts | none until confirmation | if no client secret, component returns null | customer finally sees wallet/card UI |
| 9 | Express Checkout confirmation | `EmbeddedPayment.jsx` `handleExpressConfirm` | none | none | `stripe.confirmPayment({ elements, clientSecret })` | none directly | failures show payment error | customer may complete wallet payment |
| 10 | Card confirmation | `EmbeddedPayment.jsx` `handleSubmit` | none | none | `stripe.confirmCardPayment(clientSecret, ...)` | none directly | failures show payment error | card flow remains available |
| 11 | Frontend success route | `Checkout.jsx` `onSuccess` | none | cart cleared locally | none | none | frontend response loss can be recovered only by webhook state | navigates to order confirmation |
| 12 | Webhook finalization | `base44/functions/stripeWebhook/entry.ts` `payment_intent.succeeded` | service-role reads/writes | updates pre-created Order to paid/scheduled or creates safety-net Order | Stripe event already succeeded | pushes to Shopify, syncs Hub, sends notifications, posts loyalty/credit mutations | replay guarded by `payment_captured`; terminal/refund guards exist | customer order becomes operational |
| 13 | Failure/cancel webhook | `stripeWebhook` | service-role reads/writes | failed PI can mark pending order cancelled/abandoned; canceled PI path can create OperationalAlert | provider event | no intended fulfillment | terminal behavior varies by event path | customer may see failed/cancelled state |

Important current-sequence problem: production wallet rendering is coupled to prior PaymentIntent and pending Order creation. PATCH1 proved the wallet can render without that coupling.

## 3. Proposed deferred-Intent sequence

Target future flow:

1. Authenticated customer enters checkout.
2. Cart, delivery, health advisory, customer profile, and customer inputs are validated locally enough to decide whether checkout may proceed.
3. Live Stripe publishable configuration is loaded from a read-only approved source.
4. Stripe Elements initializes without a client secret using the Stripe-supported no-Intent Express Checkout mount pattern.
5. Express Checkout renders Apple Pay when the device, browser, wallet, domain, Stripe mode, and merchant configuration are eligible.
6. No PaymentIntent, Checkout Session, Customer App Order, ShopifyOrder, FulfillmentTask, Hub sync, notification, loyalty mutation, or inventory effect exists during page mount or wallet availability checks.
7. Customer chooses Apple Pay and authorizes/continues through the Stripe-supported confirmation event.
8. Client submits the Stripe-supported payment detail/confirmation artifact plus one stable `checkout_request_id` to the backend.
9. Backend authenticates the customer and rejects unauthenticated or cross-customer attempts.
10. Backend reloads and recalculates the authoritative cart, prices, delivery fee, tax, discounts, credits, total, and currency.
11. Backend rejects client/server mismatches before creating payment/order state.
12. Backend enforces one deterministic idempotency contract.
13. Backend creates or resolves exactly one canonical Customer App Order for the approved checkout attempt.
14. Backend creates or resolves exactly one Stripe PaymentIntent for the approved checkout attempt.
15. Payment is confirmed only through the supported Stripe flow selected for the implementation phase.
16. Stripe webhook remains authoritative for paid/captured finalization.
17. Existing post-payment Shopify push, Hub sync, FulfillmentTask/native behavior, loyalty/credit posting, and notifications remain active unless separately migrated.

Do not implement this sequence in PLAN1.

## 4. Client/server trust boundary

The client may provide:

- a `checkout_request_id` generated before the wallet confirmation attempt;
- selected cart line references and quantities;
- selected delivery option reference;
- fulfillment type;
- customer-entered address and phone under the existing checkout contract;
- wallet/Stripe confirmation artifact allowed by the future Stripe integration path.

The backend must not trust client-provided amount, discounts, credits, tax, delivery fee, product price, product validity, reward eligibility, or currency. The backend must reload authoritative data and fail closed on mismatch.

The backend must also reject any attempt where the authenticated user does not own the customer checkout context. Customer name, email, phone, current timestamp, cart amount, or approximate delivery date cannot be the idempotency identity.

## 5. Request and Stripe idempotency

Required identities:

| Identity | Purpose | Required policy |
| --- | --- | --- |
| `checkout_request_id` | Client-visible attempt identity | generated once per deliberate checkout attempt; reused for retry/remount only within expiration |
| server idempotency key | Backend create/resolve guard | deterministic from authenticated customer id plus `checkout_request_id`; not derived from name/email/phone/amount alone |
| Stripe idempotency key | Provider duplicate protection | deterministic from server idempotency key plus payment action type |
| Customer App Order lookup key | Canonical order resolve | persisted linkage to attempt and/or Stripe PaymentIntent when schema supports it |
| payment-attempt linkage | Recovery and diagnostics | maps attempt, Order, and PaymentIntent without exposing customer PII |
| webhook idempotency key | Event replay guard | Stripe event id plus PaymentIntent id and canonical Order id |

Expiration/reuse policy:

- a checkout attempt expires after a short bounded window if no customer confirmation occurs;
- expired attempts cannot be reused for new amounts or carts;
- retries inside the window resolve existing state;
- changed cart/address/discount state requires a new `checkout_request_id`;
- duplicate webhook events must return success after confirming the canonical order is already finalized or terminal.

Hard rules:

- one checkout attempt creates at most one Customer App Order;
- one checkout attempt creates at most one PaymentIntent;
- one successful payment maps to one canonical completed order;
- retries resolve existing state rather than creating duplicates.

## 6. Order versus PaymentIntent sequencing

### Option A — create/reserve Customer App Order first

Pros:

- webhook can find the order reliably;
- customer order number exists before PaymentIntent confirmation;
- current webhook flow already expects a pre-created pending Order.

Cons:

- creates customer-visible or admin-visible order state before payment;
- requires cleanup/abandonment policy for wallet cancellation, browser close, and failed payment;
- repeats the current side-effect problem if created before Apple Pay confirmation.

### Option B — create PaymentIntent first

Pros:

- follows a payment-first model;
- Order can be created only if provider state exists.

Cons:

- payment can succeed while Order creation fails;
- webhook may need safety-net creation with incomplete cart data;
- cleanup and manual review are more complex.

### Option C — dedicated idempotent checkout-attempt/reservation record first

Pros:

- separates non-customer-visible attempt state from canonical order state;
- best duplicate prevention for double tap, remount, refresh, two tabs, backend retry, lost response, and webhook replay;
- can link Customer App Order and PaymentIntent only after server validation and customer confirmation;
- supports exact cleanup and manual review.

Cons:

- likely requires a schema proposal or a carefully constrained reuse of an existing safe entity;
- webhook compatibility must be designed before runtime activation;
- more implementation work than a direct refactor.

Recommendation: Option C is the safest long-term model if current schemas can support an attempt/reservation record or a small schema addition. If schema work is deferred, Option A may be acceptable only if Order creation begins after Apple Pay confirmation and is protected by a deterministic attempt key. Option B alone is not preferred because paid-with-missing-order recovery is the highest-risk partial state.

## 7. Partial-state policy

| Classification | Meaning | Recovery behavior |
| --- | --- | --- |
| `checkout_attempt_initialized` | checkout loaded and local validation started | no provider/order side effects; safe to abandon |
| `checkout_attempt_payment_not_started` | wallet availability checked or Apple Pay cancelled before confirmation | no PaymentIntent, Order, Hub sync, ShopifyOrder, task, notification, or loyalty mutation |
| `checkout_attempt_order_created_intent_missing` | order exists but PaymentIntent did not create | block customer completion; exact cleanup or manual review |
| `checkout_attempt_intent_created_order_missing` | PaymentIntent exists but Order did not create | cancel unconfirmed Intent if safe; manual review if succeeded |
| `checkout_attempt_payment_requires_action` | Stripe needs additional customer action | do not finalize order until succeeded/captured webhook |
| `checkout_attempt_payment_failed` | provider or validation failed | do not mark paid; exact cancellation/abandonment only |
| `checkout_attempt_payment_succeeded_webhook_pending` | payment succeeded but webhook finalization not observed yet | show pending confirmation state; webhook remains authority |
| `checkout_attempt_complete` | paid/captured webhook finalized canonical order | normal Shopify, Hub, loyalty, task, and notification path continues |
| `checkout_attempt_idempotent_retry` | duplicate frontend/backend attempt resolved existing state | return existing canonical state; no duplicate provider/order writes |
| `checkout_attempt_partial_state_manual_review` | state cannot be automatically reconciled | hold operational effects and require owner/admin review |
| `checkout_attempt_duplicate_risk` | duplicate identity or conflicting state detected | fail closed; no new payment/order state |

Failure scenarios:

- customer closes Apple Pay sheet: stay in `checkout_attempt_payment_not_started`;
- backend request never arrives: no state beyond client-only attempt;
- PaymentIntent creation fails: no paid order; may be `checkout_attempt_order_created_intent_missing` if Order was reserved first;
- Order creation fails after Intent: `checkout_attempt_intent_created_order_missing` and cancel unconfirmed Intent when safe;
- frontend response is lost: webhook finalization recovers canonical state;
- webhook arrives before frontend completion: webhook remains authoritative;
- webhook replay: idempotent success when canonical order already finalized;
- Hub sync fails after paid/captured: existing OrderSyncLog/manual retry behavior remains active;
- Shopify or FulfillmentTask creation fails: existing post-payment fallback/retry behavior remains active.

## 8. Apple Pay cancellation behavior

Preferred cancellation behavior when the customer dismisses Apple Pay before confirmation:

- no PaymentIntent;
- no Customer App Order;
- no Checkout Session;
- no Hub sync;
- no ShopifyOrder;
- no FulfillmentTask;
- no notification;
- no loyalty/credit mutation;
- no inventory deduction;
- no PurchaseOrder.

Backend side effects begin only after the customer confirms Apple Pay and the backend receives the exact authenticated checkout request with a valid `checkout_request_id` and server-validated cart.

## 9. Server-authoritative amount validation

Backend recalculation must cover:

- product identity and active/sellable status;
- current price;
- quantity and quantity limits;
- delivery availability and delivery fee;
- tax;
- discount eligibility;
- NuVira credit balance and application amount;
- reward effects;
- subscription perks if applicable under the current checkout contract;
- final total;
- currency.

Reject before payment/order creation:

- unknown products;
- invalid quantities;
- stale prices;
- expired discounts;
- insufficient credit;
- delivery-policy mismatch;
- amount mismatch;
- currency mismatch;
- customer ownership/auth mismatch.

## 10. Webhook compatibility

Keep Stripe authoritative for payment state and keep the Stripe webhook authoritative for paid/captured finalization.

The current `payment_intent.succeeded` webhook already has useful guards:

- it handles embedded checkout PaymentIntent events;
- it skips already-finalized orders;
- it protects terminal refunded/cancelled states;
- it finalizes pending orders to paid/scheduled;
- it pushes to Shopify and Hub after paid/captured finalization;
- it sends notifications and posts loyalty/credit effects after payment success.

PATCH2 implementation must preserve those boundaries. A future attempt/reservation linkage must let webhook resolve the canonical order without relying on fuzzy customer identity, approximate timestamps, or amount alone.

## 11. Shopify, Hub, and task boundaries

PATCH2 is not a Hub suppression or fulfillment migration phase.

Rules:

- Hub writes remain active after paid/captured finalization.
- Hub fallback remains active.
- Shopify push remains on the existing post-payment path.
- FulfillmentTask/native task creation remains on the existing approved post-payment path.
- No ShopifyOrder or FulfillmentTask should exist before paid/captured finalization.
- Refund/cancellation behavior remains unchanged.
- Subscription checkout remains unchanged.
- Notifications remain unchanged except that no notification may occur before payment success.
- Loyalty/credit behavior remains unchanged except that no mutation may occur before payment success.

## 12. Card-checkout compatibility

Initial implementation should use the narrowest safe path:

- change Apple Pay/Express Checkout sequencing first;
- preserve card checkout unchanged until the wallet deferred-Intent path is proven;
- keep card fallback visible and functional;
- do not modify card checkout in PATCH2A or PATCH2B unless a compatibility wrapper is unavoidable and separately reviewed.

A later unification phase may share the same backend idempotent checkout-attempt contract across wallet and card checkout, but that should be separate after Apple Pay visibility and payment sequencing are proven.

Rollback approach:

- keep the existing card checkout path as the operational fallback;
- gate the deferred Express Checkout path default-off;
- kill switch returns customer checkout to the current `createPaymentIntent` before mount behavior;
- do not remove current webhook finalization in the wallet rollout.

## 13. Fixture results

Fixture harness:

```text
scripts/migration/run-g47f-patch2-deferred-intent-architecture-tests.mjs
```

Coverage includes:

- checkout and Express Checkout mount without PaymentIntent or Customer App Order;
- no state on Apple Pay availability check or cancellation;
- exact `checkout_request_id` requirement;
- server-authoritative amount validation;
- unknown product and invalid quantity fail closed;
- duplicate request, remount, network retry, and two-tab behavior;
- at most one Customer App Order and one PaymentIntent;
- partial-state classifications;
- webhook replay idempotency;
- no notification, ShopifyOrder, FulfillmentTask, or Hub sync before paid/captured finalization;
- Hub writes active and Hub suppression false;
- G43B/G43C compatibility;
- existing card checkout unchanged;
- no real provider calls, live records, credentials, card data, or raw payment payloads.

Expected fixture classification:

```text
apple_pay_production_deferred_intent_architecture_plan_ready
```

## 14. Implementation phases

### G47F-PATCH2A — backend idempotency and deferred payment-attempt contract

- default-off;
- no customer activation;
- define and implement exact attempt identity;
- server-recalculate totals;
- create/resolve attempt state safely;
- preserve existing webhook finalization;
- include fixture and source-level tests;
- no Apple Pay customer activation.

### G47F-PATCH2B — Apple Pay production UI integration

- default-off feature gate;
- mount Express Checkout without a client secret for eligible customers;
- use the PATCH2A backend contract only after customer confirmation;
- card fallback unchanged;
- no broad customer activation until smoke-approved.

### G47F-PATCH2C — Stripe test/sandbox payment pilot

- exact test customer and cart;
- maximum authorized amount;
- no production payment;
- cleanup and cancellation policy;
- verify webhook/idempotency behavior in sandbox.

### G47F-PATCH2D — first controlled live Apple Pay transaction

- separate explicit owner approval;
- exact account, cart, amount, request id, and cleanup/reconciliation policy;
- no broad launch;
- verify no duplicates and correct post-payment side effects.

Do not combine these phases into one PR.

## 15. Rollback

Rollback controls for future runtime phases:

- default-off feature gate for deferred Express Checkout;
- kill switch restoring existing card/current checkout path;
- optional customer/account allowlist for first live wallet pilots;
- explicit monitoring for duplicate Order, duplicate PaymentIntent, pending partial state, webhook replay, Hub sync failure, Shopify failure, notification failure, and loyalty/credit mismatch;
- manual review queue or operational alert for unresolved partial states;
- no deletion of current card checkout path during initial wallet rollout.

## 16. Sandbox/live-payment test prerequisites

Before any payment test:

- explicit owner approval for mode: sandbox or live;
- exact customer/test account safe reference;
- exact cart contents;
- maximum authorized amount;
- stable `checkout_request_id`;
- idempotency policy;
- expected Order and PaymentIntent side effects;
- cleanup/cancellation path;
- webhook observation plan;
- no Hub suppression;
- no unrelated checkout changes;
- post-run no-duplicate and no-unapproved-side-effect verification.

Live payment must not be executed from this PLAN1.

## 17. Hard stops

Stop and do not implement or activate if any of these are true:

- Apple Pay confirmation would create payment/order state before server-side amount validation;
- a missing or duplicated `checkout_request_id` can create more than one Order or PaymentIntent;
- customer ownership is not enforced server-side;
- client amount/currency can override backend calculation;
- cancellation before confirmation creates PaymentIntent, Order, Hub, Shopify, task, notification, loyalty, inventory, or PO effects;
- webhook cannot resolve the canonical Order without fuzzy matching;
- card checkout regression is required for wallet rollout;
- provider calls are needed in docs/fixture phases;
- Hub writes are suppressed as part of PATCH2;
- refund, subscription, or G43B/G43C behavior changes are bundled into PATCH2;
- no safe rollback or kill switch exists.

## Recommendation

Proceed to G47F-PATCH2A only as a separate default-off backend idempotency/deferred-attempt contract. Do not submit Apple Pay, do not broaden checkout activation, and do not alter card checkout until the backend contract is proven.
