# G49A Checkout Processing Error Boundary

## Executive summary

A live customer became stuck on the checkout `Processing...` button before the Stripe Payment Element appeared. The customer closed the app to prevent repeat submissions. This patch is a narrow customer UI reliability fix for checkout-start failures before payment entry.

G49A does not change payment semantics, `createPaymentIntent`, webhook behavior, Hub behavior, schemas, notifications, or Apple Pay production-payment work. It only prevents indefinite UI lockups and distinguishes retry-safe pre-payment setup failures from ambiguous checkout-start failures.

## Live incident evidence

Observed customer state:

- Customer tapped checkout and became stuck on `Processing...`.
- Stripe Payment Element did not appear.
- Customer closed the app to avoid another submission.
- Stripe dashboard review supplied by operations found no matching PaymentIntent.
- Hub review supplied by operations found no matching order.
- No payment completion was reported.

Native Customer App `Order` check:

```text
customer_app_pending_order_match_count=pending_operator_read_only_check
stripe_payment_intent_match_count=0
hub_order_match_count=0
payment_completed=false
```

The customer must not retry until an operator confirms the native Customer App `Order` entity also has no matching `pending_payment` row for the exact customer/cart/time context.

## Current checkout-start sequence

`src/pages/Checkout.jsx` currently performs this sequence after client validation:

1. `setIsSubmitting(true)`;
2. re-check delivery eligibility;
3. save profile phone/address;
4. optionally write a bag-return request;
5. invoke `createPaymentIntent`;
6. require a valid `clientSecret`, publishable key, and order number;
7. mount the existing embedded Payment Element.

Before G49A, a thrown SDK/entity/function error after `setIsSubmitting(true)` could bypass all existing `setIsSubmitting(false)` branches and leave the customer on `Processing...` indefinitely.

## Root cause

The checkout-start handler lacked an outer stage-aware error boundary. Failures during profile save, bag-return persistence, or checkout initialization could leave the UI waiting forever. A promise that never resolves also never reaches `catch` or `finally`, so a visual watchdog is required.

## Stage-aware failure policy

G49A adds internal stages:

- `saving_profile`
- `saving_bag_return`
- `creating_payment_attempt`
- `payment_element_ready`
- `failed_before_payment_attempt`
- `payment_attempt_state_unknown`
- `slow_processing`

### Failure before `createPaymentIntent`

If profile save or bag-return persistence fails before the payment attempt starts:

- `isSubmitting` resets to false;
- a customer-safe message is shown;
- manual retry is allowed;
- no automatic retry is issued;
- raw SDK errors are not displayed.

### Explicit no-write backend failure

G49A only treats a backend response as retry-safe when it explicitly proves no checkout state was created:

```text
writes_performed=false
payment_intent_created=false
order_created=false
```

The current `createPaymentIntent` error contract does not generally provide those fields. Therefore, ordinary thrown/rejected/malformed responses after the function call starts are not considered safe retries.

### Ambiguous checkout-start state

If `createPaymentIntent` has started and the browser receives a thrown error, network failure, malformed response, or lost response without explicit no-write proof:

- the UI does not enable another checkout click;
- no automatic retry is issued;
- no payment success or payment failure is claimed;
- the customer sees: “We couldn’t confirm whether checkout started. Please don’t retry yet. We’re checking your order.”

This is intentionally conservative because `createPaymentIntent` can create a Stripe PaymentIntent and a pending Customer App Order before the browser receives a response.

## Watchdog behavior

A UI-only watchdog replaces indefinite `Processing...` with a “Still checking” state after a bounded delay.

The watchdog:

- sends no backend request;
- does not abort or retry the request;
- keeps checkout disabled;
- does not claim payment success or failure;
- clears on success, retry-safe pre-attempt failure, or component unmount.

## Retry rules

Retry is permitted only when checkout did not reach `createPaymentIntent`, or when a future backend response explicitly proves no checkout state was created.

Retry is blocked when the state is ambiguous. An operator must inspect native Customer App `Order`, Stripe, and Hub before instructing the customer to try again.

## Customer copy

G49A adds distinct customer-safe copy for:

1. profile/bag-return failure before payment setup;
2. explicit no-write checkout-start failure;
3. ambiguous checkout-start state;
4. unusually slow processing.

The UI does not display stack traces, raw SDK errors, Stripe payloads, client secrets, PaymentIntent IDs, Base44 internals, or provider identifiers.

## Success contract

The Payment Element mounts only when checkout-start response data contains a valid `clientSecret`, publishable key, and order number. Malformed or partial responses are not treated as success.

Existing behavior preserved:

- card checkout still uses the existing `EmbeddedPayment` component;
- Express Checkout behavior remains inside `EmbeddedPayment`;
- OrderConfirmation routing remains unchanged;
- webhook behavior remains unchanged.

## Tests

Added harness:

```text
scripts/migration/run-g49a-checkout-processing-error-boundary-tests.mjs
```

Coverage includes:

- profile-save rejection;
- bag-return rejection;
- pre-attempt retry;
- explicit no-write failure;
- ambiguous/lost/malformed checkout-start responses;
- unresolved request watchdog;
- no auto retry;
- double-click suppression;
- success path mounting existing Payment Element;
- watchdog cleanup;
- no raw error, client secret, or provider-id logging;
- no test PaymentIntent, Order, Hub call, notification, or mutation.

## Web-only publish plan

After PR merge:

1. publish only the customer Web/app UI bundle containing `src/pages/Checkout.jsx`;
2. do not publish functions, schemas, or entities;
3. do not publish Apple Pay PR #545 or any blocked payment backend work;
4. smoke checkout only to the pre-payment boundary with an approved account/cart;
5. do not submit payment unless separately approved.

## No-write policy

G49A PR prep performs no live checkout mount, no PaymentIntent creation, no Order mutation, no Hub sync, no provider call, no notification, no schema change, and no Base44/Builder publish.

## Classification

```text
checkout_processing_error_boundary_patch_pr_ready
```
