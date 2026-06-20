# G47F-PATCH1 — side-effect-free Apple Pay mount diagnostic

## 1. BLOCK1 merge result

G47F-LIVE1-BLOCK1 closed with:

```text
PR: https://github.com/NuViraJuiceCo/nuvira-juice/pull/538
BLOCK1 commit: e44e88a
BLOCK1 merge commit: 8701b59297c69b0a364e5214c6571a7c7f1f6271
classification: apple_pay_mount_smoke_blocked_by_idempotency_and_cleanup
```

BLOCK1 proved the existing NuVira checkout mount is not safe for a mount-only Apple Pay smoke because it creates a Stripe PaymentIntent and pending Customer App Order before Express Checkout mounts, without a stable request-id/idempotency contract or exact cleanup path.

## 2. Prior side-effectful mount architecture

Current normal checkout remains unchanged:

```text
src/pages/Checkout.jsx
  CheckoutFlow
    handlePlaceOrder()
      base44.functions.invoke('createPaymentIntent', ...)
        creates Stripe PaymentIntent
        creates pending Customer App Order
        returns clientSecret and publishableKey
      renders EmbeddedPayment
        mounts ExpressCheckoutElement with clientSecret
```

PATCH1 does not refactor that production payment flow. It adds a separate diagnostic branch that never reaches `handlePlaceOrder()`.

## 3. Diagnostic authorization contract

Diagnostic entry:

```text
/checkout?apple_pay_mount_diagnostic=1
```

Access requirements:

- authenticated `user.role === 'admin'` or `user.role === 'owner'`;
- explicit diagnostic query parameter;
- no ordinary UI link;
- no customer PII required or displayed;
- unauthorized/ordinary customers receive an access-restricted diagnostic message and do not enter the diagnostic mount.

The diagnostic is default-off because `/checkout` without the query parameter renders the normal checkout flow.

## 4. CONFIG2 public key source

G47F-CONFIG2 is merged and live as a read-only admin/owner public config preview:

```text
previewNativeOrderCutoverReadiness
preview_mode=APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG
```

PATCH1 now consumes that source to obtain the live Stripe publishable key for the side-effect-free diagnostic mount. The preview response is required to report:

```text
success=true
writes_performed=false
stripe_mode=live
key_type=publishable
pii_returned=false
raw_payloads_returned=false
provider_call_impact=false
notifications_sent=false
hub_mutation_performed=false
```

The key is used only in memory to initialize Stripe.js. It is not displayed, logged, committed, stored in docs, or exposed as a client secret. The diagnostic fails closed if CONFIG2 is unavailable or returns anything other than a live publishable key.

No checkout backend call is made for `createPaymentIntent`, and no PaymentIntent or Customer App Order is created by fetching public config.

## 5. No-Intent Elements configuration

Stripe supports initializing Elements without an Intent for Express Checkout by providing `mode`, `currency`, and `amount`. Stripe also recommends collecting payment details before creating an Intent when using Express Checkout.

References:

- [Stripe Express Checkout Element — Accept a payment](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment?payment-ui=elements)
- [Stripe.js — Create an Elements instance without an Intent](https://docs.stripe.com/js/elements_object/create_without_intent)
- [Stripe.js — Express Checkout confirm event](https://docs.stripe.com/js/elements_object/express_checkout_element_confirm_event)

PATCH1 diagnostic Elements options:

```text
mode=payment
currency=usd
amount=1699
clientSecret=not_used
```

Publishable key behavior:

- The current production checkout obtains the publishable key from `createPaymentIntent`, which PATCH1 must not call.
- The side-effect-free diagnostic instead calls the existing admin/owner read-only preview `previewNativeOrderCutoverReadiness` with `preview_mode=APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG`.
- The diagnostic accepts only a live publishable key response with `writes_performed:false`; all other responses fail closed.
- The diagnostic does not use `VITE_STRIPE_PUBLISHABLE_KEY`, window-injected key shims, client secrets, or any secret key source.

## 6. Exact diagnostic cart and amount

The diagnostic cart is display/eligibility context only. It does not create a cart server record, PaymentIntent, Checkout Session, or Order.

```text
AURA x1: 1300
Delivery fee: 399
Tax: 0
Total: 1699
```

## 7. Availability handling

The diagnostic captures only safe booleans:

```text
express_checkout_mounted
available_payment_methods_present
apple_pay_available
google_pay_available
link_available
diagnostic_mode_active
```

It does not capture or display:

- billing details;
- shipping details;
- customer name, email, phone, or address;
- PaymentMethod data;
- Wallet/card details;
- Stripe account ids;
- client secrets;
- raw event payloads.

## 8. Fail-closed confirmation behavior

PATCH1 diagnostic `onConfirm` is fail-closed.

It:

- calls the Express Checkout confirm event's supported `paymentFailed(...)` callback when available;
- displays: `Diagnostic preview only. No payment was processed.`;
- makes no backend request;
- creates no ConfirmationToken;
- creates no PaymentIntent;
- creates no Customer App Order;
- calls no `elements.submit()`;
- calls no `stripe.createConfirmationToken()`;
- calls no `stripe.confirmPayment()`;
- does not navigate to order confirmation.

Pointer interaction is disabled after the diagnostic element reports ready to reduce accidental interaction after wallet visibility has been observed.

## 9. Normal-checkout non-regression

When diagnostic mode is disabled:

- `CheckoutFlow` remains the normal `/checkout` path;
- `handlePlaceOrder()` still invokes `createPaymentIntent` at the same point;
- `EmbeddedPayment` still receives `clientSecret` and `publishableKey` from the backend response;
- card fallback remains in `EmbeddedPayment`;
- payment confirmation behavior remains unchanged;
- Hub, Shopify, webhook, notification, loyalty, and pending-order behavior remain unchanged.

PATCH1 does not change:

- `base44/functions/createPaymentIntent/entry.ts`;
- `base44/functions/stripeWebhook/entry.ts`;
- Order schemas;
- Stripe package versions;
- Hub behavior;
- checkout confirmation behavior.

## 10. UI and accessibility safeguards

The diagnostic page:

- uses mobile-safe top padding with `env(safe-area-inset-top)`;
- gives the Express Checkout area a nonzero minimum height;
- displays a visible admin-only label: `Diagnostic only — do not submit payment`;
- keeps the diagnostic status display to safe booleans;
- does not expose provider ids, client secrets, raw payloads, or customer data;
- is not linked from ordinary customer UI.

## 11. Test coverage

Harness:

```text
scripts/migration/run-g47f-patch1-side-effect-free-apple-pay-mount-tests.mjs
```

Coverage includes:

- diagnostic default-off behavior;
- anonymous/customer denial;
- admin/owner activation;
- no-Intent Elements options;
- exact amount/currency/mode;
- no `clientSecret` dependency;
- no `createPaymentIntent` call;
- read-only CONFIG2 public key delivery only;
- no Order, Checkout Session, ShopifyOrder, or FulfillmentTask creation;
- safe `onReady` booleans;
- fail-closed `onConfirm`;
- no side-effectful backend calls beyond read-only CONFIG2 public config, ConfirmationToken creation, payment confirmation, Hub mutation, notification, loyalty/credit mutation, or live writes;
- normal checkout path and card fallback preserved.

## 12. Publish plan

After merge only:

1. Verify Builder source contains PATCH1 and CONFIG2 public key consumption.
2. Confirm pending Builder scope contains only intended customer UI changes.
3. Publish Web/customer UI only.
4. Do not use Builder Fix All.
5. Do not publish Base44 functions, schemas, or entities.

## 13. Live smoke runbook

After publish only, use a normal non-private iPhone Safari tab.

Steps:

1. Authenticate with an owner/admin account.
2. Open `/checkout?apple_pay_mount_diagnostic=1`.
3. Confirm the diagnostic page is visible.
4. Confirm Express Checkout mounts.
5. Confirm whether Apple Pay is visible.
6. Record safe booleans only.
7. Do not tap Apple Pay.
8. Do not open the Apple Pay sheet.
9. Do not submit payment.
10. Verify no PaymentIntent, Checkout Session, Customer App Order, ShopifyOrder, FulfillmentTask, Hub mutation, notification, or loyalty/credit mutation occurred.

Successful classification:

```text
apple_pay_side_effect_free_mount_live_apple_pay_visible
```

If Express Checkout mounts but Apple Pay is absent:

```text
apple_pay_side_effect_free_mount_live_apple_pay_not_available
```

If mount fails:

```text
apple_pay_side_effect_free_mount_patch_required
```

## 14. No-write policy

PATCH1 PR prep did not:

- open NuVira checkout live diagnostic;
- create a PaymentIntent;
- create a Checkout Session;
- create a Customer App Order;
- create a ShopifyOrder;
- create a FulfillmentTask;
- submit payment;
- open or confirm Apple Pay;
- alter Stripe Dashboard configuration;
- change Hub behavior;
- send notifications;
- mutate loyalty/credits;
- publish Builder.

PATCH1 source update did not publish customer UI or execute the diagnostic route. CONFIG2 was published separately and verified read-only before this PR update.

## 15. Future deferred-Intent production path

If PATCH1 proves Apple Pay visibly mounts in NuVira, a separate G47F-PATCH2 can evaluate a production deferred-Intent checkout flow:

- collect payment details first;
- create a ConfirmationToken only after customer confirmation;
- create PaymentIntent and pending Order after confirmation begins;
- add exact request/idempotency handling;
- handle partial states;
- preserve card fallback;
- preserve webhook compatibility.

Do not implement PATCH2 in PATCH1.
