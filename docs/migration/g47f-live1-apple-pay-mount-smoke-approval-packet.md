# G47F-LIVE1 — Apple Pay mount-smoke approval packet

## 1. Executive summary

G47F-CONFIG3 closed with:

```text
apple_pay_configuration_ready_pending_approved_nuvira_mount_smoke
```

CONFIG3 proved:

- Stripe live/test payment-method domains are verified.
- Apple Pay is active in live/test.
- frontend, backend, and webhook environments align in live mode.
- Apple Pay renders on the approved iPhone in Safari.
- Stripe Express Checkout demo reported `applePay:true`.
- NuVira checkout mount has not been opened for this smoke.
- No PaymentIntent or pending Customer App Order has been created for this smoke.

G47F-LIVE1 is intended to answer one narrow question:

```text
Does Apple Pay appear after NuVira's own Express Checkout Element mounts?
```

This packet does **not** approve execution yet. Source audit found two execution blockers:

1. `createPaymentIntent` has no request-id/idempotency key in the current customer checkout request path.
2. Existing cleanup is not an immediate exact cleanup path for both the pending Customer App Order and the unconfirmed Stripe PaymentIntent.

Until those are resolved or separately approved, do not run the NuVira checkout mount smoke.

## 2. Current classification

```text
apple_pay_configuration_ready_pending_approved_nuvira_mount_smoke
```

Planning outcome for this packet:

```text
apple_pay_mount_smoke_plan_ready_execution_held_pending_idempotency_and_cleanup_approval
```

## 3. Scope

This phase is docs-only.

No Base44 publish, Builder publish, checkout mount, PaymentIntent creation, Customer App Order creation, payment submission, Hub call, provider call, notification, inventory deduction, PurchaseOrder creation, native ShopifyOrder creation, or FulfillmentTask creation is approved by this document.

## 4. Approved customer/session requirement

Use exactly one existing owner-controlled customer account.

Safe reference to use in run evidence:

```text
customer_account_ref=g47f_live1_owner_controlled_customer_account
customer_session_confirmed=false
```

`customer_session_confirmed` must become `true` before execution. Confirmation must be based on an actual customer session, not an admin session.

Do not record customer email, phone, address, card details, Wallet details, auth tokens, session tokens, Stripe keys, client secrets, full PaymentIntent ids, or provider payloads in the run evidence.

Hard stops:

- Do not use another customer's account.
- Do not use an admin-capable session as a substitute for the customer session.
- Do not create a fake production customer solely for this smoke.
- Do not proceed if the owner-controlled customer account/session cannot be confirmed.

## 5. Proposed smallest valid cart

The proposed cart is the smallest observed single-bottle customer checkout cart, gated by live UI confirmation before execution.

```text
cart_items:
- product=AURA
  quantity=1
expected_subtotal=13.00
expected_delivery_fee=3.99
expected_tax=0.00
expected_total=16.99
maximum_authorized_amount=16.99
```

Assumptions that must be confirmed immediately before execution:

- Product `AURA` is available for checkout.
- Product price shown in the live UI is `$13.00`.
- The owner-controlled customer account's delivery address resolves to Core Delivery `zone_1a_core_0_5` with a `$3.99` delivery fee.
- No points, credits, referral discount, reward discount, subscription discount, or free-delivery discount is applied.
- The checkout total displayed by NuVira is exactly `$16.99`.

If any of those assumptions fail, stop and update this approval packet before running a smoke.

Do not override prices or manually change the calculated total.

## 6. Source audit — pre-mount side effects

### 6.1 Runtime path

Customer checkout path:

```text
src/pages/Checkout.jsx
  handlePlaceOrder()
    base44.functions.invoke('createPaymentIntent', {...})
      returns clientSecret, publishableKey, orderNumber, effectiveTotal
    setClientSecret(...)
    renders src/components/checkout/EmbeddedPayment.jsx
      <ExpressCheckoutElement ... />
```

Backend side-effect path:

```text
base44/functions/createPaymentIntent/entry.ts
```

This function:

- authorizes the authenticated checkout customer against the submitted customer email;
- validates delivery eligibility server-side;
- validates the latest delivery schedule option;
- creates one Stripe PaymentIntent;
- pre-creates one Customer App `Order` with `status='pending_payment'` when the order write succeeds;
- creates a legacy `CheckoutSession` entity row keyed with the PaymentIntent id for compatibility/admin tooling;
- returns the PaymentIntent client secret and publishable key to the frontend.

### 6.2 Initial pending Order state

The pre-created Customer App Order uses:

```text
status=pending_payment
payment_status=pending
financial_status=pending
payment_captured=false
is_preorder=false
```

Source comments state pending-payment orders must not enter Hub, Driver Portal, route optimization, production, or active order-management flows before `payment_intent.succeeded`.

### 6.3 PaymentIntent creation

`createPaymentIntent` creates a Stripe PaymentIntent with:

```text
currency=usd
payment_method_types=['card']
```

The source comment states this card-only PaymentIntent enables Apple Pay and Google Pay through `ExpressCheckoutElement` without enabling bank, Klarna, ACH, or redirect-based methods.

### 6.4 Express Checkout mount

`src/components/checkout/EmbeddedPayment.jsx` renders `ExpressCheckoutElement` after `clientSecret` is present.

Relevant callbacks:

- `onReady({ availablePaymentMethods })` records wallet availability in local component state.
- `onConfirm` calls `stripe.confirmPayment(...)` after the user authorizes through the wallet sheet.

G47F-LIVE1 must stop at mount/visibility observation. Do not click Apple Pay and do not trigger `onConfirm`.

### 6.5 Pre-payment Hub/native/notification behavior

From source audit:

- `createPaymentIntent` itself does not call `syncOrderToHub`.
- `createPaymentIntent` itself does not call `sendOrderReceivedNotification` or `sendCustomerNotification`.
- `createPaymentIntent` itself does not create a native `ShopifyOrder` or `FulfillmentTask`.
- `stripeWebhook` creates/schedules operational order state, Hub sync, Shopify push, notifications, and loyalty/credit mutations only after successful payment events.

Known pre-payment caveat:

- `Checkout.jsx` can update or create `UserProfile` before invoking `createPaymentIntent` when profile phone/address fields differ.
- `Checkout.jsx` can create `BagReturn` and call `syncCustomerToHub` before payment if bag-return quantities are set.

G47F-LIVE1 therefore requires:

```text
profile_update_expected=false
bag_return_quantities=0
syncCustomerToHub_pre_payment_expected=false
```

Hard stop if the checkout page proposes profile changes or any bag-return request before the mount smoke.

## 7. Idempotency and duplicate-risk finding

Current source does **not** show a request id or idempotency key passed from `Checkout.jsx` to `createPaymentIntent`.

Current source does **not** show a Stripe idempotency key passed to `stripe.paymentIntents.create(...)`.

Current source generates order numbers from current time:

```text
NV-${Date.now().toString(36).toUpperCase()}
```

Duplicate-risk paths:

- browser refresh before cleanup can lose local `clientSecret` state;
- using the `Edit order details` path clears `clientSecret` and `pendingOrderNumber` without canceling the PaymentIntent or pending Order;
- a second click path after state reset can create another PaymentIntent and another pending Order;
- no stable run identifier currently prevents a second PaymentIntent/Order pair.

Required pre-mount guarantees from the requested policy are therefore not yet satisfied:

```text
one customer session: planned, must be confirmed
one cart: planned, must be confirmed
one request/idempotency key: missing in current source
one PaymentIntent maximum: not source-enforced
one pending Customer App Order maximum: not source-enforced
```

Hard stop:

```text
hard_stop_checkout_mount_idempotency_gap
```

Do not execute G47F-LIVE1 until either:

1. a source-supported idempotency/request guard is identified; or
2. a separate owner approval accepts the one-attempt operational risk with a no-refresh/no-remount procedure and exact cleanup.

## 8. Cleanup finding

### 8.1 Existing pending Order cleanup

Existing function:

```text
base44/functions/cancelAbandonedCheckouts/entry.ts
```

This function:

- targets `Order` rows with `status='pending_payment'`;
- processes rows older than 30 minutes;
- marks eligible rows as `status='cancelled'`;
- sets `is_abandoned_checkout=true`;
- sets `do_not_recover=true`;
- sets `canceled_at`;
- skips PaymentIntents that are `succeeded` or `processing`.

Limitations:

- it is time-window based, not exact-run based;
- it is not immediate;
- response results may include customer email, so G47F-LIVE1 reporting must sanitize output;
- it does not cancel the Stripe PaymentIntent.

### 8.2 Existing PaymentIntent cleanup

No existing exact G47F-safe function was found that cancels the specific unconfirmed PaymentIntent created by normal one-time checkout mount.

Related code exists for other flows:

- `denyZone3DeliveryRequest` can cancel a Zone 3 authorization PaymentIntent for a delivery-approval record;
- `autoExpireZone3Authorizations` can cancel Zone 3 authorization PaymentIntents;
- `inspectPaymentIntent` can cancel a fresh diagnostic PaymentIntent it creates itself.

Those are not an audited cleanup path for the normal G47F one-time checkout mount PaymentIntent.

### 8.3 Cleanup fields

```text
payment_intent_cleanup_method=not_available_as_exact_supported_g47f_path
pending_order_cleanup_method=cancelAbandonedCheckouts_after_30_minutes_only
cleanup_requires_separate_command=true
cleanup_mutations_expected=Order update to cancelled/do_not_recover if using cancelAbandonedCheckouts
cleanup_provider_calls_expected=Stripe PaymentIntent retrieve by cancelAbandonedCheckouts; no exact cancellation path found
cleanup_notifications_expected=false
cleanup_hub_impact_expected=false if pending_payment/do_not_recover guards hold
```

Hard stop:

```text
hard_stop_checkout_mount_cleanup_gap
```

Do not execute G47F-LIVE1 until an exact cleanup decision is approved.

## 9. Exact smoke procedure — not approved to execute yet

Device and browser:

- real iPhone
- Safari
- normal non-private tab
- Wallet configured
- Apple Pay already proven visible in Stripe demo

Hostname:

```text
https://nuvirajuice.com/checkout
```

Run identifier:

```text
g47f_live1_apple_pay_mount_smoke_<timestamp>
```

Procedure, once separately approved:

1. Authenticate with the approved owner-controlled customer account.
2. Confirm `customer_session_confirmed=true` without recording customer PII.
3. Ensure cart is empty.
4. Add only the approved cart: `AURA x 1`.
5. Confirm checkout total equals `$16.99`; hard stop if it differs.
6. Confirm no points, credits, rewards, subscriptions, referrals, or bag-return requests are applied.
7. Record baseline pending-payment Order count for the safe run context.
8. Record baseline PaymentIntent count only if safely observable without exposing full provider ids.
9. Navigate to checkout.
10. Trigger the checkout stage that calls `createPaymentIntent` and creates the pending Order.
11. Wait for Express Checkout to mount.
12. Observe whether Apple Pay appears.
13. If `?debug=1` is used and safe, record `availablePaymentMethods.applePay` from the debug panel without recording PaymentIntent id or client secret.
14. Do not click Apple Pay.
15. Do not open the Apple Pay sheet.
16. Do not submit card payment.
17. Do not refresh, use back/forward, or click `Edit order details` unless separately approved.
18. Capture a screenshot showing the Express Checkout area with no customer PII.
19. Exit checkout.
20. Run the exact approved cleanup path.
21. Verify all expected and forbidden side effects.

## 10. Required evidence template

Before mount:

```text
run_id=g47f_live1_apple_pay_mount_smoke_<timestamp>
customer_account_ref=g47f_live1_owner_controlled_customer_account
customer_session_confirmed=true|false
cart_confirmed=true|false
expected_total=16.99
maximum_authorized_amount=16.99
baseline_pending_order_count=<number>
baseline_payment_intent_reference_count=<number|unavailable>
existing_test_order_same_idempotency_key=false|unavailable
```

After mount:

```text
express_checkout_mounted=true|false
apple_pay_visible=true|false
availablePaymentMethods.applePay=true|false|unavailable
card_fallback_visible=true|false
mount_error_category=<none|category>
pending_order_created_count=0|1|more_than_1
payment_intent_created_count=0|1|more_than_1
payment_submitted=false
apple_pay_sheet_opened=false
payment_captured=false
```

After cleanup:

```text
pending_order_cleanup_status=<not_run|cancelled|held|failed>
payment_intent_cleanup_status=<not_run|cancelled|left_unconfirmed|failed>
duplicate_order_created=false
duplicate_payment_intent_created=false
shopify_order_created=false
fulfillment_task_created=false
hub_sync_created=false
provider_call_other_than_payment_intent_create_or_approved_cancel=false
notification_created=false
loyalty_mutation=false
```

## 11. Hard stops

Do not execute the mount smoke if any are true:

- customer session is not confirmed;
- cart differs from the approved cart;
- total differs from `$16.99`;
- delivery fee differs from `$3.99`;
- any discount/credit/reward/subscription/referral applies;
- bag-return quantities are nonzero;
- profile update would be triggered as part of the smoke;
- idempotency/request guard remains unapproved;
- exact cleanup path remains unapproved;
- checkout is opened in an iframe/preview instead of production Safari;
- browser is private for the NuVira smoke;
- user would need to click Apple Pay or open the Apple Pay sheet to observe the result;
- any provider/payment/customer data would need to be recorded in the evidence.

Immediate hard-stop classifications:

```text
hard_stop_checkout_mount_idempotency_gap
hard_stop_checkout_mount_cleanup_gap
hard_stop_checkout_mount_side_effect_regression
```

## 12. Expected final classifications

If Apple Pay appears and no payment is submitted:

```text
apple_pay_nuvira_mount_visible_no_payment_submitted
```

Interpretation:

- NuVira Express Checkout integration is functioning for Apple Pay visibility.
- No checkout code patch is required for Apple Pay visibility.
- Investigate only the original customer/session/device context where Apple Pay was absent.

If Express Checkout mounts but Apple Pay is absent while Stripe demo shows it:

```text
apple_pay_nuvira_integration_or_mount_issue
```

Next:

- G47F-PATCH1 narrow integration diagnostics;
- inspect `onReady.availablePaymentMethods`;
- consider migrating deprecated `wallets.applePay` to `paymentMethods.applePay`;
- preserve card fallback;
- no payment submission.

If Express Checkout does not mount:

```text
apple_pay_express_checkout_mount_failure
```

If duplicates or unauthorized side effects occur:

```text
hard_stop_checkout_mount_side_effect_regression
```

## 13. Approval template

Do not execute until the owner provides a separate approval in this exact form, with any gap decisions filled in:

```text
APPROVE G47F-LIVE1 APPLE PAY MOUNT SMOKE

customer_account_ref=g47f_live1_owner_controlled_customer_account
customer_session_confirmed=true
cart_items=AURA x 1
expected_subtotal=13.00
expected_delivery_fee=3.99
expected_tax=0.00
expected_total=16.99
maximum_authorized_amount=16.99
normal_non_private_safari=true
payment_submission_approved=false
apple_pay_sheet_open_approved=false
idempotency_gap_accepted_or_resolved=<accepted|resolved>
cleanup_gap_accepted_or_resolved=<accepted|resolved>
payment_intent_cleanup_method=<approved method>
pending_order_cleanup_method=<approved method>
no_hub_suppression=true
no_notifications=true
no_unrelated_checkout_changes=true
```

Without this approval, G47F-LIVE1 remains planned only.

## 14. No-write / no-payment confirmation for PLAN1

G47F-LIVE1-PLAN1 did not:

- open NuVira checkout;
- mount Express Checkout;
- create a PaymentIntent;
- create a Checkout Session;
- create a pending Customer App Order;
- submit payment;
- open or confirm the Apple Pay sheet;
- capture payment;
- cancel payment;
- mutate Order, ShopifyOrder, FulfillmentTask, UserProfile, BagReturn, UserPoints, NuViraCredit, OrderSyncLog, Notification, CustomerMessageDeliveryLog, PurchaseOrder, OperationalAlert, or Hub records;
- call Stripe, Shopify, Hub, delivery providers, or notification providers;
- publish Base44 or Builder;
- change checkout code.

## 15. Recommendation

Do not run G47F-LIVE1 yet.

Recommended next step:

```text
G47F-LIVE1-CLEANUP1 — approve or add exact cleanup/idempotency controls for a one-attempt Apple Pay mount smoke
```

Minimum acceptable path before execution:

- exact owner-controlled customer session confirmed;
- exact cart and total confirmed in production UI before mount;
- no pre-payment profile/bag-return/Hub side effects;
- one-attempt/no-refresh/no-remount procedure approved;
- exact pending Order cleanup policy approved;
- exact PaymentIntent cleanup policy approved;
- sanitized evidence template agreed.
