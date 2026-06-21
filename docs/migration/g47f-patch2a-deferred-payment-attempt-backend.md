# G47F-PATCH2A: deferred Apple Pay payment-attempt backend contract

## Executive summary

PATCH2A adds a default-off backend request mode to `createPaymentIntent` for the future deferred Express Checkout Apple Pay flow, but it intentionally does **not** implement the live-write branch.

The source audit found no atomic or schema-enforced application-level reservation primitive that can guarantee at-most-one Customer App Order under concurrent retries. Existing migration command idempotency uses `CommandLog` filter-then-create patterns, and `CommandLog.idempotency_key` is not declared unique in the entity schema. Stripe idempotency can protect the provider PaymentIntent request, but it cannot prevent duplicate Customer App Orders by itself.

Therefore PATCH2A fails closed with:

```text
apple_pay_deferred_intent_backend_blocked_by_atomic_idempotency_gap
```

Legacy card checkout behavior remains unchanged.

## 1. PLAN1 merge result

PLAN1 PR #544 merged into `main` with merge commit:

```text
2668eeccb41c48f147c71cfcce6e5ca737872537
```

PLAN1 classification carried forward:

```text
apple_pay_production_deferred_intent_architecture_plan_ready
```

PATCH1 live proof remains:

```text
apple_pay_side_effect_free_mount_live_apple_pay_visible
```

## 2. current createPaymentIntent behavior

The current production checkout path is unchanged when `mode` is absent:

1. `Checkout.jsx` calls `createPaymentIntent` before Stripe Elements mounts.
2. `createPaymentIntent` validates customer ownership, delivery eligibility, schedule options, and customer name.
3. It creates a Stripe PaymentIntent.
4. It pre-creates a Customer App Order with `pending_payment` status.
5. It writes a compatibility CheckoutSession row keyed by the PaymentIntent id.
6. It returns the client secret and publishable key to the authenticated customer.
7. `EmbeddedPayment.jsx` confirms card or Express Checkout payment client-side.
8. `stripeWebhook` handles `payment_intent.succeeded`, finalizes the Order, and keeps existing Shopify, Hub, loyalty, notification, history, and tracker behavior active.

PATCH2A does not change that legacy request contract.

## 3. selected reservation/idempotency primitive

No safe primitive is selected for live writes.

Audited candidates:

| Candidate | Finding | Decision |
| --- | --- | --- |
| `CommandLog` | Has `idempotency_key`, but schema does not declare uniqueness. Existing usage checks with filter then create. | Not safe for concurrent checkout reservation. |
| `CheckoutSession` | Stores checkout data keyed by Stripe session or PaymentIntent id, but no unique attempt key or atomic upsert. | Not safe as primary attempt reservation. |
| `Order` | Has `order_number` and Stripe ids but no checkout-request unique field. | Not safe before schema/linkage work. |
| Stripe idempotency key | Protects Stripe POST retry behavior. | Required later, but insufficient for Customer App Order uniqueness. |

## 4. atomicity evidence or blocker

Evidence:

- `base44/entities/CommandLog.jsonc` defines `idempotency_key` as a plain string, not a unique field.
- Existing command functions look up a `CommandLog` by idempotency key and then create a new row if none exists.
- That pattern is not atomic and can race under two simultaneous checkout requests.
- There is no documented transaction, compare-and-set, unique insert, or schema-enforced upsert primitive in the audited checkout path.

Hard stop applied:

```text
apple_pay_deferred_intent_backend_blocked_by_atomic_idempotency_gap
```

PATCH2A therefore adds only a fail-closed default-off deferred mode. It does not create Orders, PaymentIntents, logs, queues, or provider state.

## 5. new default-off mode/gates

New request mode:

```text
DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT
```

Feature controls added to `createPaymentIntent`:

```text
ENABLE_DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT
DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT_KILL_SWITCH
DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT_ALLOWED_USER_PROFILE_IDS
DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT_POLICY
```

Required policy:

```text
DEFERRED_EXPRESS_CHECKOUT_CONFIRMATION_TOKEN_ONE_TIME_ONLY
```

Behavior:

- disabled by default;
- kill-switch protected;
- customer-authenticated;
- pilot limited by exact internal UserProfile ids;
- never keyed by customer email, name, or phone;
- unavailable to subscriptions and multi-delivery;
- fail-closed because atomic reservation is not proven.

## 6. request contract

Conceptual future request shape:

```json
{
  "mode": "DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT",
  "checkout_request_id": "<high-entropy request id>",
  "confirmation_token_id": "<Stripe ConfirmationToken id>",
  "currency": "usd",
  "expected_amount": 1699,
  "cart": [
    {
      "product_id": "<exact Product id>",
      "quantity": 1
    }
  ],
  "fulfillment_type": "delivery",
  "order_type": "one_time",
  "fulfillment_mode": "single_delivery",
  "dry_run": true
}
```

Current PATCH2A fail-closed branch validates only safe request and gate properties before returning the atomic blocker. It does not trust client prices, fees, discounts, credits, taxes, customer identity, or currency.

## 7. server cart calculation

Required future calculation:

- exact Product id;
- active/sellable product status;
- authoritative unit price;
- quantity and quantity limit;
- subtotal;
- delivery fee;
- tax;
- allowed discounts;
- allowed credits;
- allowed reward effects;
- total;
- currency.

PATCH2A does not complete live server cart calculation because the atomic blocker stops implementation before any write-capable branch is safe.

Initial deferred pilot must fail closed for rewards, credits, coupons, subscriptions, multi-delivery, unsupported product types, unknown products, inactive products, invalid quantities, currency mismatch, and amount mismatch until exact server-authoritative support is proven.

## 8. cart fingerprint

Future fingerprint inputs should be deterministic and PII-free:

- authenticated internal customer/profile id;
- normalized canonical cart;
- fulfillment type;
- delivery date or delivery option id;
- server-calculated amount;
- currency;
- policy version.

Rules:

- same `checkout_request_id` plus same fingerprint resolves existing attempt;
- same `checkout_request_id` plus different fingerprint fails with idempotency conflict;
- fingerprint must not include name, email, phone, raw address, ConfirmationToken id, client secret, or provider payload.

## 9. Order/PaymentIntent ordering

Preferred future sequence remains:

1. authenticate customer;
2. validate feature gates;
3. validate request format;
4. recalculate authoritative cart;
5. atomically reserve checkout attempt;
6. create or reuse one pending Customer App Order;
7. create or reuse one Stripe PaymentIntent with a deterministic Stripe idempotency key;
8. return the state needed for PATCH2B client-side confirmation.

This sequence is blocked until a safe atomic reservation primitive exists.

## 10. Stripe idempotency

Future Stripe idempotency key format should be deterministic and PII-free, equivalent to:

```text
nuvira:deferred-checkout:<checkout_request_id>
```

Stripe idempotency must be passed through Stripe's request-options contract for POST operations. It protects provider-side retries, but it does not replace application-level attempt reservation.

Stripe documentation confirms the preferred Express Checkout path can collect payment details before creating an Intent, create a ConfirmationToken, create the PaymentIntent server-side with a trusted amount, and then confirm client-side with that token. Stripe also states that the server should decide the amount, not the client. Reference: https://docs.stripe.com/elements/express-checkout-element/accept-a-payment?payment-ui=elements

## 11. ConfirmationToken handling

PATCH2A accepts only a syntactically supported ConfirmationToken id in the deferred request branch and never logs, persists, returns, or places it in metadata.

Rules for future implementation:

- do not store ConfirmationToken in Order or CommandLog;
- do not put it in Stripe metadata;
- do not return it in errors;
- do not expose it across customers;
- retries resolve existing state by checkout request id and fingerprint, not by token changes.

## 12. partial-state policy

Required future states:

```text
checkout_attempt_initialized
checkout_attempt_payment_not_started
checkout_attempt_order_created_intent_missing
checkout_attempt_intent_created_order_missing
checkout_attempt_payment_requires_action
checkout_attempt_payment_failed
checkout_attempt_payment_succeeded_webhook_pending
checkout_attempt_complete
checkout_attempt_idempotent_retry
checkout_attempt_partial_state_manual_review
checkout_attempt_duplicate_risk
```

PATCH2A currently returns `checkout_attempt_initialized` with the atomic blocker and no writes.

## 13. dry-run contract

PATCH2A deferred mode returns safe no-store responses with:

- `dry_run` echoed from the request;
- `writes_performed:false`;
- no Order creation;
- no PaymentIntent creation;
- no Stripe call;
- no Shopify call;
- no Hub call;
- no notification;
- no loyalty mutation;
- no inventory deduction;
- no PurchaseOrder;
- `pii_returned:false`;
- `raw_payloads_returned:false`.

Because the atomic blocker is present, dry run does not reserve attempts and does not claim full cart/idempotency readiness.

## 14. existing card-checkout non-regression

Legacy behavior is preserved when:

- `mode` is absent;
- the mode is not `DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT`;
- the deferred feature is disabled;
- the kill switch is active;
- the customer is not allowlisted.

The existing PaymentIntent timing, pending Order creation, client-secret response, card confirmation, Express Checkout confirmation, webhook finalization, Shopify push, Hub sync, notifications, loyalty, history, and tracker behavior remain unchanged.

## 15. webhook compatibility

Current webhook compatibility requires a PaymentIntent linked to exactly one Customer App Order by `stripe_payment_intent_id` and embedded-checkout metadata. Webhook replay is guarded by existing paid/terminal-state checks.

PATCH2A does not change `stripeWebhook`.

If a future atomic attempt primitive changes Order/PaymentIntent ordering or metadata, webhook lookup must be re-audited before activation. If the webhook cannot resolve exactly one canonical Order without fuzzy matching, classify:

```text
apple_pay_deferred_intent_backend_blocked_by_webhook_lookup_gap
```

## 16. future allowed writes

When a future phase proves atomic reservation, allowed writes for the deferred backend preparation path may be limited to:

- one atomic checkout-attempt reservation;
- exactly one pending Customer App Order;
- exactly one Stripe PaymentIntent;
- exact linkage updates required between those records.

Still not allowed in deferred preparation:

- ShopifyOrder creation;
- FulfillmentTask creation;
- Hub sync;
- notifications;
- loyalty or credit mutation;
- inventory deduction;
- PurchaseOrder;
- refunds/cancellations;
- subscriptions;
- repair/replay.

## 17. hard stops

Hard stops:

- no atomic reservation primitive;
- no server-authoritative cart calculation;
- no authenticated owner/customer context;
- no exact internal UserProfile pilot id;
- missing or malformed `checkout_request_id`;
- missing or malformed ConfirmationToken id;
- subscription or multi-delivery request;
- reward/credit/coupon ambiguity;
- client/server amount mismatch;
- currency mismatch;
- webhook lookup gap;
- any design that can create duplicate Orders or duplicate PaymentIntents;
- any flow that creates provider/order state before Apple Pay confirmation;
- any flow that logs or persists ConfirmationToken/client secret;
- any Hub suppression bundled into Apple Pay work.

## 18. tests

Harness:

```text
scripts/migration/run-g47f-patch2a-deferred-payment-attempt-tests.mjs
```

Coverage:

- legacy checkout unchanged;
- default-off and kill-switch behavior;
- anonymous/nonallowlisted blocking;
- exact pilot fixture acceptance up to the atomic blocker;
- request id and ConfirmationToken validation;
- one-time/subscription/multi-delivery policy;
- product, quantity, amount, currency, reward/credit/coupon fixture behavior;
- dry-run no-write behavior;
- idempotency/fingerprint fixture behavior;
- partial-state fixture classifications;
- webhook compatibility markers;
- no Shopify, task, Hub, notification, loyalty, inventory, PO, PII, raw payload, provider call, PaymentIntent, or Order side effect.

## 19. publish-disabled plan

If this PR merges later:

- publish only `createPaymentIntent`;
- keep `ENABLE_DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT` disabled;
- keep the kill switch active;
- keep allowed-user list empty/nonmatching;
- verify legacy card checkout function contract;
- verify deferred mode returns the atomic blocker and no writes;
- do not update customer UI;
- do not create a PaymentIntent;
- do not submit payment.

## 20. PATCH2B dependency

PATCH2B remains blocked until PATCH2A has a proven atomic reservation primitive and can safely create at most one Customer App Order and one PaymentIntent per checkout attempt.

Do not proceed to Apple Pay production UI payment confirmation from this state.

## Recommendation

Do not activate deferred Apple Pay payments yet. The next useful work is a narrow schema/platform capability decision for atomic checkout-attempt reservation, or an approved Base44-supported unique/upsert primitive. Until that exists, retain PATCH1 diagnostic proof and current production checkout behavior.
