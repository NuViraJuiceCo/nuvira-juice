# G35I: Gated Partial Refund Review Queue Command

## Executive summary

G35I adds PR-prep for a default-off command that can later create exactly one manual `OrderReviewQueue` entry for a partial refund review. It does not process refunds, call Stripe, call Shopify, call providers, send notifications, mutate order/task/batch/compliance records, run sync/repair/replay, touch inventory, create PurchaseOrders, or mutate Hub records.

Hub remains the refund source of truth. The native command is only a future administrative review-queue handoff after a stable G35H partial refund preview.

## Function contract

Function:

```text
createNativePartialRefundReviewQueueForCustomerApp
```

Confirmation phrase:

```text
create_native_partial_refund_review_queue_no_notification
```

Required policy:

```text
PARTIAL_REFUND_REVIEW_QUEUE_ONLY_NO_NOTIFICATION
```

Required notification policy:

```text
NO_NOTIFICATION
```

The command requires admin auth and does not trust browser-supplied actor fields.

## Gates

All gates are default-off and must pass before any future write:

```text
ENABLE_NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE
NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_KILL_SWITCH
NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_ALLOWED_EMAILS
NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_ORDER_ALLOWLIST
NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_CUSTOMER_ORDER_ALLOWLIST
NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_SHOPIFY_ORDER_ALLOWLIST
NATIVE_PARTIAL_REFUND_REVIEW_QUEUE_CREATE_POLICY
```

Closed or disabled gates return a safe `409` with `writes_performed:false`.

## Required inputs

```text
order_number
customer_app_order_id
native_shopify_order_id
refund_type=partial
refund_amount
refund_currency
event_source=admin_review|stripe_webhook_shadow|manual_review
notification_policy=NO_NOTIFICATION
request_id
confirmation=create_native_partial_refund_review_queue_no_notification
```

`native_fulfillment_task_id`, `stripe_event_id`, `stripe_refund_id`, and `refund_reason` are optional. If a task id is supplied, the fresh preview must confirm the task is present.

Forbidden inputs include provider refund execution flags, Stripe/Shopify refund command flags, status overrides, ProductionBatch or BatchComplianceLog mutation flags, inventory/PurchaseOrder flags, notification send payloads, sync/repair/replay flags, raw provider payloads, secrets, auth headers, and bulk order ids.

## Fresh G35H preview requirement

Before any future write, the command invokes the existing read-only preview mode:

```text
previewNativeOrderCutoverReadiness
preview_mode=NATIVE_PARTIAL_REFUND_REVIEW_IMPACT
```

The preview must return:

```text
success:true
dry_run:true
writes_performed:false
preview_data_stable:true
read_consistency.stable:true
provider_call_impact:false
notification_impact.notification_held:true
proposed_order_review_queue_impact.safe_queue_draft present
```

The command fails closed if the preview is missing, unstable, inconsistent, proposes provider calls, proposes notifications, proposes task cancellation, proposes ProductionBatch mutation, proposes BatchComplianceLog mutation, or lacks a safe review queue draft.

## Allowed future writes

Only two future writes are in scope:

1. one `OrderReviewQueue` row
2. one safe `CommandLog` row

The command does not write:

```text
Customer App Order
native ShopifyOrder
native FulfillmentTask
ProductionBatch
BatchComplianceLog
OrderSyncLog
Notification
CustomerMessageDeliveryLog
Hub records
InventoryItem
PurchaseOrder
```

## OrderReviewQueue schema contract

The current schema supports the queue entry through existing safe fields:

```text
incident_type=partial_refund_review_required
status=pending
existing_order_id=<customer_app_order_id>
existing_order_number=<order_number>
existing_order_type=customer_app_native_one_time
incoming_source=native_refund_impact_preview
recommended_action=manual_review
idempotency_key=<command idempotency key>
queue_visibility_status=active
```

Refund-specific details are stored only in safe `incoming_payload` metadata. The payload records exact ids, refund type, amount, currency, optional Stripe ids, stable preview flags, production/compliance counts, and explicit safety booleans. It does not include raw Stripe, Shopify, provider, or payment payloads and does not include customer PII beyond safe ids/order number.

## Idempotency and dedupe

`request_id` is required. A matching successful `CommandLog` returns an idempotent skipped result and does not create another queue row.

Existing `OrderReviewQueue` rows dedupe by idempotency key, exact order ids, `stripe_event_id`, and `stripe_refund_id`. Duplicate review context returns skipped/duplicate with `writes_performed:false`.

## Live execution status

G35I is PR-prep only. No live valid command is approved or run in this phase. After merge/publish, only boundary checks are allowed:

- GET returns `405`
- unauthenticated POST returns `401`
- admin-auth gates-closed call returns `409` with `writes_performed:false`

Any valid live queue creation requires a separate exact owner approval phase, a real partial refund event or owner-approved test review, and stable G35H exact-id preview output.

## Hard stops

Do not proceed to live partial refund review queue creation unless all are true:

- exact ids are supplied
- G35H preview is stable
- read consistency is stable
- no duplicate review exists
- no duplicate Stripe event/refund id conflict exists
- gates and allowlists are explicitly opened for the exact order
- owner approval is explicit
- notification policy is `NO_NOTIFICATION`
- provider calls remain false
- Hub remains refund source of truth
