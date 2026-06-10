# G35O Stripe Refund Shadow Pilot Runbook

## 1. Executive summary

G35O defines the exact allowlisted live shadow pilot procedure for the Stripe refund webhook shadow added in G35N. This is a runbook only. It does not open gates, send Stripe webhooks, create refunds, mutate records, or change runtime behavior.

A future G35O live shadow pilot may run only when either:

- a real refund event is expected and exact event/order identifiers are known, or
- the owner explicitly approves a controlled test review with exact identifiers.

The future pilot must remain read-only from the shadow path. Existing `stripeWebhook` behavior and Hub refund source-of-truth behavior remain unchanged.

## 2. Current G35N state

G35N is merged, published, and boundary-verified with gates closed.

Current live state:

- Published function: `stripeWebhook`
- Marker: `g35n_default_off_stripe_refund_webhook_shadow`
- Helper: `runStripeRefundWebhookShadowPreview`
- Shadow runs only after Stripe signature validation succeeds.
- Shadow is fire-and-forget and non-blocking.
- Shadow is skipped unless all gates pass.
- Shadow requires exact event/order allowlist.
- Shadow logging mode must be `none`.
- Shadow routes only to existing read-only preview:

```text
previewNativeOrderCutoverReadiness
preview_mode: STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW
```

Already verified:

- GET/invalid signature boundary behavior remains protected.
- No valid Stripe event was sent.
- No gates were opened.
- No production events ran live shadow.
- No `OrderSyncLog`, `CommandLog`, `OrderReviewQueue`, `Notification`, or `CustomerMessageDeliveryLog` rows were created by G35N verification.
- No refund was processed.
- No provider call, notification, Hub mutation, or live record mutation occurred.

## 3. Exact pilot eligibility

A future G35O live shadow pilot may proceed only if all conditions below are true:

1. Owner explicitly approves G35O live shadow.
2. Exact order number is known.
3. Exact Customer App `Order` id is known if the order exists locally.
4. Exact native `ShopifyOrder` id is known if the native mirror exists.
5. Exact native `FulfillmentTask` id is known if the native task exists.
6. Expected Stripe event type is known.
7. Expected Stripe event id is known or immediately captured from the Stripe dashboard before approval.
8. Event/order allowlists can be set exactly.
9. Sample rate remains `0`.
10. Logging mode remains `none`.
11. Policy is `READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS`.
12. Hub remains source of truth.
13. No review queue write is expected.
14. No notification is expected.
15. No provider call is expected from shadow.
16. No record mutation is expected from shadow.

If exact Stripe event id is not known:

- do not approve broad event sampling
- do not open gates
- hold G35O
- continue using admin read-only previews only

## 4. Gate contract for a future pilot

Gate names:

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

Required pilot values:

```text
ENABLE_STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW=true
STRIPE_REFUND_WEBHOOK_SHADOW_KILL_SWITCH=false
STRIPE_REFUND_WEBHOOK_SHADOW_ALLOWED_EVENT_TYPES=<exact event type only>
STRIPE_REFUND_WEBHOOK_SHADOW_LOGGING_MODE=none
STRIPE_REFUND_WEBHOOK_SHADOW_ORDER_ALLOWLIST=<exact order number only>
STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST=<exact stripe event id only>
STRIPE_REFUND_WEBHOOK_SHADOW_SAMPLE_RATE=0
STRIPE_REFUND_WEBHOOK_SHADOW_POLICY=READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS
```

Hard gate rules:

- no wildcard order allowlist
- no wildcard event allowlist
- no broad sampling
- no persistent logging
- no provider calls from shadow
- no notifications from shadow
- no review queue write from shadow
- no order/task/batch/compliance mutation from shadow
- no Hub mutation from shadow

## 5. Pre-pilot preview requirements

Before any live shadow pilot, run read-only admin previews for the exact target.

### Full refund target

Run:

1. `STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW` with a synthetic safe event summary.
2. `NATIVE_REFUND_IMPACT` exact preview.

Confirm:

- delivered or verified lifecycle routes to manual review / `do_not_auto_cancel`
- production and compliance history is preserved
- no writes
- no provider calls
- no notification
- Hub fallback/source-of-truth remains visible

### Partial refund target

Run:

1. `STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW` with a synthetic safe event summary.
2. `NATIVE_PARTIAL_REFUND_REVIEW_IMPACT` exact preview.

Confirm:

- review queue draft only
- no `OrderReviewQueue` creation
- no writes
- no provider calls
- no notification
- Hub fallback/source-of-truth remains visible

### Required preview outputs

Required outputs before any future live pilot:

```text
success:true
dry_run:true
writes_performed:false
provider_call_impact:false
notifications held
no mutation proposed
hub_fallback_required or Hub source-of-truth visible
```

Where applicable, also require:

```text
preview_data_stable:true
read_consistency.stable:true
no read consistency blockers
```

If preview is unstable, times out, or returns blockers:

- do not run G35O live shadow
- keep gates closed
- continue using read-only admin preview only

## 6. Owner approval template

Do not run a future live shadow pilot unless the owner provides this exact approval block with all required fields filled.

```text
APPROVE G35O EXACT STRIPE REFUND WEBHOOK SHADOW PILOT
order_number=
customer_app_order_id=
native_shopify_order_id=
native_fulfillment_task_id=
stripe_event_id=
stripe_event_type=
refund_type=
refund_amount=
refund_currency=
notification_policy=NO_NOTIFICATION
logging_mode=none
provider_call_policy=NO_PROVIDER_CALLS
mutation_policy=NO_WRITES
hub_source_of_truth=true
```

Codex must validate the approval block before future use.

Validation requirements:

- `order_number` is exact, not wildcard.
- `stripe_event_id` is exact, not wildcard.
- `stripe_event_type` is one of the allowed refund shadow event types.
- `notification_policy` equals `NO_NOTIFICATION`.
- `logging_mode` equals `none`.
- `provider_call_policy` equals `NO_PROVIDER_CALLS`.
- `mutation_policy` equals `NO_WRITES`.
- `hub_source_of_truth` equals `true`.

## 7. Live pilot expected behavior

Expected future live shadow behavior:

1. Stripe signature validation succeeds normally.
2. Existing `stripeWebhook` behavior proceeds unchanged.
3. Shadow gates see exact event/order allowlist.
4. Shadow runs read-only preview fire-and-forget.
5. Webhook response is not delayed or changed by shadow result.
6. No raw payload is stored.
7. No persistent logs are created.
8. No provider calls are made by shadow.
9. No notifications are sent by shadow.
10. No order/task/batch/compliance records are mutated by shadow.
11. No `OrderReviewQueue` is created by shadow.
12. Hub remains source of truth.

Important distinction:

- Existing `charge.refunded` live behavior may already mutate records and call Hub.
- G35O verification must distinguish existing `stripeWebhook` behavior from G35O shadow behavior.
- G35O shadow itself must remain read-only.

## 8. Post-pilot verification checklist

After a future G35O live shadow pilot, verify each item below.

### Entity state

- Customer App `Order` unchanged by shadow.
- native `ShopifyOrder` unchanged by shadow.
- native `FulfillmentTask` unchanged by shadow.
- `ProductionBatch` unchanged by shadow.
- `BatchComplianceLog` unchanged by shadow.
- `OrderReviewQueue` unchanged by shadow.
- `CommandLog` unchanged by shadow.
- `Notification` unchanged by shadow.
- `CustomerMessageDeliveryLog` unchanged by shadow.
- Inventory unchanged by shadow.
- PurchaseOrders unchanged by shadow.

### Existing webhook behavior separation

Check `OrderSyncLog` carefully:

- Existing live `stripeWebhook` behavior may create `OrderSyncLog` for actual refund processing.
- G35O shadow must not create `OrderSyncLog`.
- Any `OrderSyncLog` found must be attributed to existing webhook behavior, not the shadow helper.

### Side-effect checks

Verify:

- no provider calls from shadow
- no sync/repair/replay from shadow
- no inventory/PO mutation from shadow
- no Hub mutation from shadow
- Hub source-of-truth behavior unchanged
- gate shutdown completed
- disabled/skip behavior restored

## 9. Rollback plan

Immediate rollback values:

```text
ENABLE_STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW=false
STRIPE_REFUND_WEBHOOK_SHADOW_KILL_SWITCH=true
STRIPE_REFUND_WEBHOOK_SHADOW_ORDER_ALLOWLIST=disabled
STRIPE_REFUND_WEBHOOK_SHADOW_EVENT_ALLOWLIST=disabled
STRIPE_REFUND_WEBHOOK_SHADOW_ALLOWED_EVENT_TYPES=disabled
STRIPE_REFUND_WEBHOOK_SHADOW_SAMPLE_RATE=0
STRIPE_REFUND_WEBHOOK_SHADOW_LOGGING_MODE=none
```

Also keep:

```text
STRIPE_REFUND_WEBHOOK_SHADOW_POLICY=READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS
```

No code rollback should be needed if gates are functioning.

If code rollback becomes necessary:

1. Revert G35N runtime change.
2. Deploy only `stripeWebhook`.
3. Verify invalid-signature boundary behavior.
4. Verify gates are absent/closed.
5. Verify no shadow-created records exist.

## 10. Hard stops

Do not run a future G35O live shadow pilot if any are true:

- owner approval is missing
- exact order number is missing
- exact Stripe event id is missing
- event/order allowlist cannot be exact
- sample rate would be greater than `0`
- logging mode would not be `none`
- policy would not be `READ_ONLY_NO_MUTATION_NO_PROVIDER_CALLS`
- any provider call is required
- any notification is required
- any review queue write is expected
- any Customer App/native order mutation is expected from shadow
- any ProductionBatch/BatchComplianceLog mutation is expected from shadow
- any Hub mutation is expected from shadow
- raw Stripe payload storage is required
- webhook signature or auth header exposure is required
- preview is unstable, times out, or returns blockers
- there is any attempt to make Customer App refund source of truth before parity is approved

## 11. Recommendation

Hold G35O until one of these is true:

1. an exact real refund event is expected and exact identifiers are available, or
2. the owner approves a controlled exact-event/order shadow test.

When that happens, use this runbook to validate exact allowlists, run pre-pilot previews, open gates only for the exact event/order, then immediately restore disabled gates after verification.

Do not run G35J partial refund review queue creation unless a real partial refund event or owner-approved test review has exact IDs and fresh stable preview evidence.
