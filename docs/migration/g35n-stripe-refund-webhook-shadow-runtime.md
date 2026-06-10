# G35N Stripe Refund Webhook Shadow Runtime

## 1. Executive summary

G35N adds a default-off Stripe refund webhook shadow path to Customer App `stripeWebhook`.

The shadow path is disabled unless all gates are explicitly configured, the kill switch is off, policy is read-only, logging mode is `none`, and an exact event/order allowlist matches. While disabled, existing `stripeWebhook` behavior is behaviorally unchanged except for a safe no-op branch after Stripe signature verification.

The shadow path is observation/preview only. It does not process refunds, call Stripe, call Shopify, call providers, mutate records, create logs/queues, send notifications, or change Hub behavior.

Hub remains the refund source of truth.

## 2. Changed runtime surface

Runtime changed:

- `base44/functions/stripeWebhook/entry.ts`

Validation added:

- `scripts/migration/run-g35n-stripe-refund-webhook-shadow-runtime-tests.mjs`

No schema changes are included. No UI changes are included.

## 3. Default-off gates

G35N uses env-based gates:

```text
ENABLE_STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW
STRIPE_REFUND_WEBHOOK_SHADOW_KILL_SWITCH
STRIPE_REFUND_WEBHOOK_SHADOW_ALLOWED_EVENT_TYPES
STRIPE_REFUND_WEBHOOK_SHADOW_LOGGING_MODE
STRIPE_REFUND_WEBHOOK_SHADOW_ORDER_ALLOWLIST
STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST
STRIPE_REFUND_WEBHOOK_SHADOW_SAMPLE_RATE
STRIPE_REFUND_WEBHOOK_SHADOW_POLICY
```

Required closed defaults:

- enabled: false
- kill switch: true
- sample rate: 0
- logging mode: none
- no broad order allowlist
- no broad event allowlist
- policy must equal `READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS`

If any gate is missing, closed, or unsafe, shadow is skipped.

## 4. Exact allowlist requirement

G35N does not support broad sampling.

A future shadow run requires one of:

- exact `stripe_event_id` allowlist match
- exact order-number allowlist match after read-only local order lookup

`STRIPE_REFUND_WEBHOOK_SHADOW_SAMPLE_RATE` is not a rollout mechanism in G35N. Any sample rate above `0` without an exact allowlist is blocked as broad sampling.

## 5. Runtime integration

The shadow branch is called only after Stripe signature validation succeeds and after the Base44 client is created.

It is invoked as a fire-and-forget, internally caught helper:

```text
void runStripeRefundWebhookShadowPreview({ base44, event }).catch(() => {})
```

This means the shadow cannot alter:

- Stripe webhook HTTP status
- Stripe webhook JSON response
- current `charge.refunded` behavior
- current `refund.updated` behavior
- current Hub sync/refund behavior
- current notification behavior
- current order mutation behavior

## 6. Supported event types

Shadow considers refund-related events only:

- `charge.refunded`
- `refund.created`
- `refund.updated`
- `charge.refund.updated`

Other event types are skipped.

G35N does not begin live handling of `refund.created` or `charge.refund.updated`; those remain observation-only if shadow is later allowlisted.

## 7. Normalized event summary

The shadow helper builds a safe normalized summary from the parsed Stripe event object.

Allowed in-memory fields:

- `event_type`
- `stripe_event_id`
- `stripe_refund_id`
- `payment_intent_id`
- `charge_id`
- `order_number` if resolved from local records
- `customer_app_order_id` if resolved from local records
- `native_shopify_order_id` if resolved from local records
- `native_fulfillment_task_id` if resolved from local records
- `refund_type`
- `refund_amount`
- `refund_currency`
- `event_source: stripe_webhook_shadow`
- `raw_payload_included:false`

Forbidden:

- raw Stripe event payload
- webhook signature
- auth headers
- secrets
- raw provider payloads
- payment method/card data
- full customer PII
- raw stack traces

## 8. Amount conversion policy

When Stripe source fields use minor units, G35N normalizes to Customer App preview decimal amount before routing to preview.

Example:

```text
source_refund_amount_minor=500
refund_amount=5.00
amount_conversion=stripe_minor_units_to_decimal
```

The raw event is not stored. Conversion metadata remains in the in-memory helper result and is not persisted.

## 9. Preview routing

When all gates pass, G35N invokes the existing read-only preview function by service invocation:

```text
previewNativeOrderCutoverReadiness
preview_mode: STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW
```

It does not call the public function URL recursively.

Expected routing inside the existing preview runtime:

| Event classification | Existing preview route |
| --- | --- |
| full refund | `NATIVE_REFUND_IMPACT` |
| partial refund | `NATIVE_PARTIAL_REFUND_REVIEW_IMPACT` |
| unknown refund type | `unknown_refund_review_required` |
| unknown order | `unknown_order_refund_review_required` |
| duplicate event | `duplicate_refund_event_detected` |
| missing partial amount | `missing_refund_amount_for_partial_preview` |

## 10. No persistent logging policy

Initial G35N policy:

- `STRIPE_REFUND_WEBHOOK_SHADOW_LOGGING_MODE=none`
- no persistent logging
- no `OrderSyncLog`
- no `CommandLog`
- no `OrderReviewQueue`
- no `RefundWebhookShadowLog`
- no notification/message logs

If logging mode is anything other than `none`, G35N skips shadow.

A future persistent logging phase would require a separate schema/contract and explicit approval.

## 11. Non-blocking and failure behavior

Shadow failures are suppressed from the live Stripe webhook response.

| Failure | G35N behavior |
| --- | --- |
| gates closed | skip shadow |
| unsupported event | skip shadow |
| exact allowlist missing | skip shadow |
| missing partial amount | skip preview and classify internally |
| preview error | catch internally; no response change |
| preview timeout | classify internally as timeout; no response change |
| read consistency unstable | not command-ready; no response change |

## 12. Test matrix

G35N harness covers:

1. gates disabled -> shadow skipped, normal webhook behavior unchanged
2. kill switch active -> shadow skipped
3. unsupported event type -> shadow skipped
4. refund event not exact-event allowlisted -> shadow skipped
5. refund event not exact-order allowlisted -> shadow skipped
6. sample rate 0 blocks broad sampling without allowlist
7. sample rate greater than 0 without exact allowlist blocks broad sampling
8. allowed full refund routes to `NATIVE_REFUND_IMPACT` shadow preview
9. allowed partial refund routes to `NATIVE_PARTIAL_REFUND_REVIEW_IMPACT` shadow preview
10. missing partial amount returns missing amount classification
11. unknown order routes to unknown-order review classification
12. duplicate event id classification is surfaced
13. raw payload is not persisted
14. webhook signature is not stored
15. shadow preview error is non-blocking
16. shadow timeout is non-blocking
17. no provider calls from shadow
18. no notifications
19. no writes
20. existing `charge.refunded` no-payment-intent boundary remains unchanged when gates are disabled

## 13. Hard stops

Do not open G35N gates unless all are true:

- exact event/order allowlist is approved
- policy remains `READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS`
- logging mode remains `none`
- no raw payload storage is required
- no provider calls are required
- no Hub mutation is required
- no notification is required
- no native refund write is required
- no review queue/log write is required
- preview remains stable for the exact target event/order

## 14. Rollback plan

Rollback options:

1. Keep gates closed; default behavior already skips shadow.
2. Set `STRIPE_REFUND_WEBHOOK_SHADOW_KILL_SWITCH=true`.
3. Unset or clear exact allowlists.
4. Revert the G35N function change and redeploy `stripeWebhook` if needed.

No data rollback is required because G35N does not write records.

## 15. Recommended next phase

Recommended next phase:

- Hold until an exact real refund event is expected.
- Or plan G35O exact allowlisted shadow pilot with no persistent logging.

Do not run G35J partial refund review queue creation unless a real partial refund event or owner-approved test review has exact IDs and fresh stable G35H/G35L/G35N preview evidence.
