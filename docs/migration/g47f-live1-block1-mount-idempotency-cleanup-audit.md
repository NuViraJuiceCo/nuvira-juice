# G47F-LIVE1-BLOCK1 — Apple Pay mount idempotency and cleanup audit

## 1. PLAN1 closeout

G47F-LIVE1-PLAN1 closed with PR #537 merged into `main`.

```text
PR: https://github.com/NuViraJuiceCo/nuvira-juice/pull/537
PLAN1 commit: 811b0dd
PLAN1 merge commit: 03bbd620d50eef393b0f543e0ff96fed8fbb6dd6
PLAN1 changed file: docs/migration/g47f-live1-apple-pay-mount-smoke-approval-packet.md
PLAN1 scope: docs-only/planning
```

PLAN1 did not approve execution. The carry-forward classification is:

```text
apple_pay_mount_smoke_plan_blocked_by_owner_session_idempotency_and_cleanup
```

No NuVira checkout mount, Stripe PaymentIntent, pending Customer App Order, Apple Pay sheet, payment submission, Hub action, notification, or Base44/Builder publish occurred during PLAN1.

## 2. Current checkout mount sequence

The current one-time checkout sequence is:

1. `src/pages/Checkout.jsx` validates iframe status, health advisory, customer name, delivery address, phone, selected delivery option, and delivery-zone eligibility.
2. `src/pages/Checkout.jsx` may update or create `UserProfile` before payment initialization when profile fields differ.
3. `src/pages/Checkout.jsx` may create `BagReturn` and call `syncCustomerToHub` before payment when bag-return quantities are nonzero.
4. `src/pages/Checkout.jsx` calls `base44.functions.invoke('createPaymentIntent', ...)`.
5. `base44/functions/createPaymentIntent/entry.ts` authorizes the customer, validates delivery eligibility, validates schedule, creates a Stripe PaymentIntent, pre-creates a Customer App `Order`, and creates a legacy `CheckoutSession` row.
6. `createPaymentIntent` returns `clientSecret`, `publishableKey`, `orderNumber`, and `effectiveTotal`.
7. `src/pages/Checkout.jsx` stores the client secret and renders `src/components/checkout/EmbeddedPayment.jsx`.
8. `EmbeddedPayment.jsx` creates Stripe Elements and mounts `ExpressCheckoutElement`.
9. `ExpressCheckoutElement.onReady` reports `availablePaymentMethods` and can show Apple Pay.
10. `ExpressCheckoutElement.onConfirm` calls `stripe.confirmPayment(...)` only after the customer authorizes through the wallet sheet.
11. `base44/functions/stripeWebhook/entry.ts` handles `payment_intent.succeeded`, promotes the pending order, performs Hub/Shopify/notification/loyalty side effects, and sends operational notifications.
12. `stripeWebhook` handles failed or canceled PaymentIntents through separate cancellation/abandoned paths.

## 3. Current idempotency findings

Current source does not satisfy the LIVE1 pre-mount guarantee of one request, one PaymentIntent, and one pending Order maximum.

Findings:

```text
stable request id in checkout request: not found
Stripe idempotency key in paymentIntents.create: not found
deterministic cart/session idempotency key: not found
existing pending-order lookup before PI create: not found
existing PaymentIntent lookup before PI create: not found
browser refresh/remount protection: not source-enforced
two-tab protection: not source-enforced
network-timeout retry recovery: not source-enforced
webhook replay protection: partial/terminal-path only, not sufficient for pre-mount duplicate prevention
```

Duplicate-risk cases:

- Same customer/cart submitted twice can create a second PaymentIntent and second pending Order.
- A page refresh after PaymentIntent creation can lose local `clientSecret` state.
- The `Edit order details` path clears payment state without canceling the pending PaymentIntent or pending Order.
- A second tab can run the same cart through the same non-idempotent mount path.
- A response-lost or timeout case can leave a PaymentIntent and/or Order with no retry-safe lookup.

Current idempotency classifications:

```text
checkout_mount_duplicate_payment_intent_risk
checkout_mount_duplicate_pending_order_risk
checkout_mount_partial_state_risk
checkout_mount_retry_contract_missing
apple_pay_mount_smoke_requires_idempotency_patch
```

## 4. Side-effect-free mount feasibility

Stripe's current Express Checkout documentation and Stripe.js reference describe using the Express Checkout Element with Elements, including an Elements instance created without an Intent for deferred payment collection. Primary references:

- [Stripe Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element)
- [Stripe.js: create an Elements object without an Intent](https://docs.stripe.com/js/elements_object/create_without_intent)
- [React Stripe.js ExpressCheckoutElement reference](https://docs.stripe.com/js/react_stripe_js/elements/express_checkout_element)

That means a side-effect-free availability/rendering mount appears technically viable at the Stripe layer.

However, NuVira's current application architecture does not use that deferred/intentless pattern. It creates the PaymentIntent and pending Customer App Order before the Express Checkout Element can mount.

Current classifications:

```text
express_checkout_side_effect_free_mount_supported
app_architecture_creates_order_before_mount
apple_pay_mount_smoke_requires_side_effect_free_mount_patch
```

Recommended safe direction:

- Prefer a narrow `G47F-PATCH1` that separates wallet availability/rendering from PaymentIntent and Order creation.
- Preserve card fallback.
- Keep existing payment confirmation behavior unchanged.
- Do not change capture, webhook, Hub, Shopify, notification, or loyalty behavior in the availability patch.

If NuVira keeps the current side-effectful mount architecture, LIVE1 requires exact idempotency and cleanup first.

## 5. Duplicate and partial-state risks

Required fixture scenarios classify as follows:

| Scenario | Current classification |
| --- | --- |
| Same request id twice | `checkout_mount_retry_contract_missing` because request id is not accepted/enforced |
| Same cart/session twice | `checkout_mount_duplicate_payment_intent_risk`, `checkout_mount_duplicate_pending_order_risk` |
| Page refresh | duplicate/abandoned pending state risk |
| React component remount | duplicate risk if it retriggers payment initialization |
| Two checkout tabs | duplicate PaymentIntent/Order risk |
| Network timeout after PI create | `checkout_mount_partial_state_risk` |
| PaymentIntent created but Order missing | `checkout_mount_partial_state_risk` |
| Order created but PaymentIntent missing/response lost | `checkout_mount_partial_state_risk` |
| Apple Pay mount repeated without confirmation | duplicate risk unless guarded by idempotency |

## 6. PaymentIntent cleanup contract

Current source does not expose an exact LIVE1-safe cleanup path for the unconfirmed PaymentIntent created by normal one-time checkout mount.

Existing cleanup-related behavior:

- `base44/functions/cancelAbandonedCheckouts/entry.ts` retrieves PaymentIntents for stale pending orders but does not cancel the PaymentIntent.
- `base44/functions/stripeWebhook/entry.ts` handles `payment_intent.canceled` and can mark a matching order canceled.
- The current `payment_intent.canceled` path can create an `OperationalAlert`, which is not acceptable for a silent Apple Pay visibility smoke unless separately patched/approved.
- Other functions can cancel Zone 3 authorization PaymentIntents or diagnostic PaymentIntents, but they are not audited cleanup paths for normal one-time checkout mount smoke.

Cleanup status:

```text
payment_intent_cleanup_method=not_available_as_exact_supported_g47f_path
payment_intent_cleanup_contract_ready=false
```

Classification:

```text
apple_pay_mount_smoke_requires_cleanup_path
hard_stop_checkout_mount_cleanup_gap
```

## 7. Pending Order cleanup contract

Current supported abandoned-checkout cleanup is time-based, not exact-run based.

`cancelAbandonedCheckouts`:

- targets `Order.status='pending_payment'`;
- processes orders older than the abandoned-checkout threshold;
- updates eligible rows to `status='cancelled'`;
- sets `is_abandoned_checkout=true`;
- sets `do_not_recover=true`;
- does not delete the Order;
- can include customer-identifying fields in function output, so any future run report must sanitize output.

This does not satisfy LIVE1's required immediate, exact pending Order cleanup.

Cleanup status:

```text
pending_order_cleanup_method=cancelAbandonedCheckouts_after_30_minutes_only
pending_order_cleanup_contract_ready=false
order_deletion_allowed=false
```

## 8. Exact customer/cart/request identity

A future LIVE1 must require all of the following before opening NuVira checkout:

```text
customer_account_ref=g47f_live1_owner_controlled_customer_account
customer_session_confirmed=true
cart_items=AURA x 1
expected_subtotal=13.00
expected_delivery_fee=3.99
expected_tax=0.00
expected_total=16.99
maximum_authorized_amount=16.99
run_id=g47f_live1_apple_pay_mount_smoke_<timestamp>
deterministic_idempotency_key=<source-supported key required before execution>
```

The smoke must not use:

- an admin session as customer ownership proof;
- a guest or fuzzy customer identity;
- another customer's account;
- arbitrary cart contents;
- discounts, credits, points, referrals, subscriptions, or bag returns;
- a changed profile/address path that mutates `UserProfile` before mount.

## 9. Fixture results

Fixture harness:

```text
scripts/migration/run-g47f-live1-block1-mount-idempotency-cleanup-tests.mjs
```

The harness is static/fixture-only. It does not invoke Base44, Stripe, Shopify, Hub, providers, checkout UI, or live data.

Coverage includes:

- exact customer/session requirement;
- exact `AURA x1` cart and `$16.99` amount requirement;
- wrong-cart and wrong-amount rejection;
- idempotent fixture behavior when a future guard exists;
- duplicate-risk classification when a guard is absent;
- component remount/two-tab retry behavior;
- partial-state detection;
- cleanup status checks;
- prohibition on order deletion;
- no ShopifyOrder, FulfillmentTask, Hub, notification, loyalty, payment submission, Apple Pay confirmation, provider calls, or live writes.

## 10. Required patch or approval path

G47F-LIVE1 should not execute from current source.

Two safe paths exist:

### Preferred path — side-effect-free availability patch

```text
G47F-PATCH1 — side-effect-free Express Checkout availability mount
```

Required characteristics:

- render Express Checkout availability without creating a PaymentIntent;
- do not create a Customer App Order before the customer commits to payment;
- preserve card fallback;
- preserve existing payment confirmation flow;
- no payment submission;
- no Hub/Shopify/native fulfillment/notification/loyalty side effects.

### Alternative path — side-effectful mount hardening

```text
G47F-LIVE1-IDEMPOTENCY1 — exact idempotency and cleanup controls
```

Required characteristics:

- checkout request accepts one stable `request_id` / deterministic idempotency key;
- Stripe PaymentIntent creation uses an idempotency key;
- Customer App pending Order creation is deduped by the same exact identity;
- response-lost and partial states resolve safely;
- exact pending Order cleanup exists;
- exact unconfirmed PaymentIntent cleanup exists;
- cleanup does not emit notifications, Hub sync, Shopify push, native order/task creation, loyalty/credit mutation, or generic operational alerts.

## 11. Hard stops

Do not issue or execute `APPROVE G47F-LIVE1 APPLE PAY MOUNT SMOKE` until all are true:

```text
customer_session_confirmed=true
checkout_mount_idempotency_ready=true
cleanup_contract_ready=true
exact request/idempotency policy documented
no duplicate pending Order risk
no duplicate PaymentIntent risk
no Hub/notification/loyalty side effect
rollback path separately approved
```

Current final BLOCK1 classification:

```text
apple_pay_mount_smoke_blocked_by_idempotency_and_cleanup
```

## 12. No-write confirmation

G47F-LIVE1-BLOCK1 did not:

- open NuVira checkout;
- mount Express Checkout;
- create a PaymentIntent;
- create a Checkout Session;
- create a pending Customer App Order;
- submit payment;
- open or confirm the Apple Pay sheet;
- capture or cancel payment;
- mutate Order, ShopifyOrder, FulfillmentTask, UserProfile, BagReturn, UserPoints, NuViraCredit, OrderSyncLog, Notification, CustomerMessageDeliveryLog, PurchaseOrder, OperationalAlert, or Hub records;
- call Stripe, Shopify, Hub, delivery providers, or notification providers;
- publish Base44 or Builder;
- change runtime checkout code.
