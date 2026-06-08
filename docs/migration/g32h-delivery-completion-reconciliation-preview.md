# G32H: Delivery Completion Reconciliation Preview

## Scope

G32H adds a read-only preview for delivery completion reconciliation after operational delivery is already complete.

The preview supports two cases:

1. Existing native order/task that should be reconciled directly to delivered.
2. Hub-fulfilled historical order that is missing Customer App/native records.

This phase does not run delivery reconciliation and does not mutate records.

## Targets

### NV-MPZNKGNT

Current operational truth: delivered and complete.

Current native/customer-app state before any delivery reconciliation:

- Customer App Order `6a219a3f4adcda5856c3d579`: `scheduled_for_juicing`
- Native ShopifyOrder `6a22ffda400eb806eb3ca945`: `production_status=bottled`, `fulfillment_status=pending`
- Native FulfillmentTask `6a22ffdaf675ea79e30575aa`: `status=packed`, `delivery_status=pending`, `production_status=packed`
- ProductionBatch: 6 `verified_logged`
- BatchComplianceLog: 6 locked logs

Recommended preview mode:

- `DIRECT_DELIVERED_NO_NOTIFICATION`

Previewed future writes, if separately approved with exact timestamp:

- Native FulfillmentTask `status -> delivered`
- Native FulfillmentTask `delivery_status -> delivered`
- Native FulfillmentTask `delivered_at -> owner-approved timestamp`
- Native ShopifyOrder `fulfillment_status -> fulfilled`

Held:

- Customer App Order status
- status_history
- notifications
- proof/drop/route fields
- Hub mutation

### Hub order 1052

Current operational truth: Stephanie Morales order `1052` was fulfilled.

Read-only audit found:

- no Customer App Order
- no native ShopifyOrder
- no native FulfillmentTask
- Hub order exists with `fulfillment_status=fulfilled`
- Hub task detail endpoint returns no FulfillmentTask rows

Recommended preview mode:

- `HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION`

Preview classification:

- Native ShopifyOrder historical fulfilled mirror may be preview-ready if Hub order has safe minimum data.
- Customer App Order backfill remains held pending a dedicated customer-facing historical record contract.
- Native FulfillmentTask backfill remains held because Hub task rows are not present.
- Native delivered command is not applicable when no native FulfillmentTask exists.

## Function

`previewNativeDeliveryCompletionReconciliation`

### Auth

- Admin auth, or
- internal preview secret via safe internal header/body field.

### Inputs

- `order_number` optional
- `customer_app_order_id` optional
- `native_shopify_order_id` optional
- `native_fulfillment_task_id` optional
- `hub_order_number` optional
- `targets` optional array for multi-target preview
- `correction_mode` required unless target overrides/defaults apply
- `notification_policy=NO_NOTIFICATION`
- `proof_drop_policy=HELD_NOT_REQUIRED_FOR_RECONCILIATION`
- `actual_delivered_at` optional for preview
- `request_id` optional

If `actual_delivered_at` is missing for direct delivered reconciliation, preview warns with:

- `delivered_timestamp_required_before_live_reconciliation`

This does not block read-only preview.

## Schema/status mapping audit

Schema-supported values found in Customer App entities:

- FulfillmentTask `status`: includes `delivered`
- FulfillmentTask `delivery_status`: string projection; use `delivered`
- FulfillmentTask `delivered_at`: exists
- ShopifyOrder `fulfillment_status`: string; use Shopify-compatible `fulfilled`
- ShopifyOrder `delivered_at`: exists, but not proposed in G32H direct preview
- Order `status`: includes `delivered`
- Order `status_history`: array of `{ status, timestamp, message }`

G32H does not run any live status mapping.

## Non-goals / blocked actions

G32H does not:

- mark Out For Delivery
- mark Delivered
- update Customer App Order
- create Customer App Order
- update/create native ShopifyOrder
- update/create native FulfillmentTask
- append status_history
- send notifications
- create notification or message rows
- write proof/drop/route fields
- mutate Hub
- call Stripe, Shopify, providers, sync, retry, repair, replay
- deduct inventory or create PurchaseOrders
- update ProductionBatch or BatchComplianceLog
- disable Hub bridge

## Live correction requirements

Any live correction must be a separate explicit approval with:

- exact order/task ids
- exact correction mode
- exact `actual_delivered_at` timestamp for direct delivered reconciliation
- notification policy `NO_NOTIFICATION`
- proof/drop policy decision
- allowed writes only
- idempotency request id
- post-write no-side-effect verification
