# G35B — Native Refund Impact Preview

Date: 2026-06-09

## Summary

G35B adds a read-only native refund impact preview mode to the existing `previewNativeOrderCutoverReadiness` runtime:

```text
preview_mode: NATIVE_REFUND_IMPACT
requested function alias: previewNativeRefundImpact
```

The preview is designed to show what a refund would affect before any native refund/reversal mutation is allowed.

## Safety boundary

The preview does not:

- process refunds
- call Stripe, Shopify, payment providers, or Hub APIs
- update Customer App Order
- update native ShopifyOrder
- update native FulfillmentTask
- update ProductionBatch
- update BatchComplianceLog
- create OrderReviewQueue entries
- create OrderSyncLog entries
- create CommandLog entries
- cancel tasks
- remove `order_sources`
- recalculate batches
- deduct or restore inventory
- create or update PurchaseOrders
- send notifications
- run sync/retry/repair/replay
- open gates
- disable Hub bridge
- mutate records

## Inputs

Supported request body fields:

```json
{
  "preview_mode": "NATIVE_REFUND_IMPACT",
  "order_number": "optional",
  "customer_app_order_id": "optional",
  "native_shopify_order_id": "optional",
  "stripe_event_id": "optional",
  "refund_type": "full | partial | unknown",
  "refund_amount": 0,
  "currency": "usd",
  "event_source": "stripe_webhook | admin_preview | test_fixture",
  "request_id": "optional"
}
```

At least one order or event identifier is required. `refund_type` is required.

## Response highlights

The response returns:

- `success`
- `dry_run:true`
- `writes_performed:false`
- `preview_mode:NATIVE_REFUND_IMPACT`
- order/native/task presence
- refund type and amount
- lifecycle state and risk level
- idempotency preview from existing log rows
- status schema compatibility
- proposed impacts by entity
- notification impact held
- provider call impact false
- Hub fallback required/active
- blockers/warnings
- next action

## Lifecycle/risk classification

The preview classifies order state as one of:

- `before_native_ops`
- `native_order_created_only`
- `task_scheduled_or_packed`
- `production_batches_planned`
- `production_started`
- `production_completed`
- `production_verified`
- `task_packed`
- `delivered`
- `historical_fulfilled`

Risk levels:

- `low_risk_preview_only`
- `review_required`
- `high_risk_manual_only`
- `do_not_auto_cancel`

Delivered and historical fulfilled states never propose automatic cancellation.

## Status schema compatibility

G35A found that Customer App `Order.status` does not currently include `refunded` or `cancelled`, while existing refund code writes/checks those values. G35B reports this explicitly:

```text
customer_order_status_refund_value_supported:false
customer_order_cancelled_value_supported:false
schema_gap_blockers:
  - customer_order_status_refund_value_unsupported
  - customer_order_cancelled_value_unsupported
```

G35B does not patch schema or silently work around the mismatch.

## Full refund preview behavior

For full refunds, the preview reports potential impact for:

- Customer App payment/status fields
- native ShopifyOrder payment/production/fulfillment status
- native FulfillmentTask cancellation
- ProductionBatch order source removal and planned unit recalculation
- OrderReviewQueue review need when late lifecycle risk is present
- OrderSyncLog / CommandLog future audit surfaces
- notifications held
- provider calls false

No write is performed.

## Partial refund preview behavior

For partial refunds, the preview recommends review-only handling:

- proposed incident type: `partial_refund_received`
- no Customer App status mutation
- no native ShopifyOrder mutation
- no FulfillmentTask cancellation
- no ProductionBatch mutation
- no notifications
- no provider calls

## Recommended next phases

G35B keeps Hub as the refund source of truth for now. Recommended follow-up options:

1. Expand refund fixtures/harness coverage.
2. Plan a partial refund review queue preview/command only after exact approval.
3. Patch/refine Customer App refund/cancel status schema policy.
4. Continue keeping Hub refund processing as source of truth until native parity is proven.
