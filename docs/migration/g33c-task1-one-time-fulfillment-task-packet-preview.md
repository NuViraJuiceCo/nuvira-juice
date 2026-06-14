# G33C-TASK1 — One-Time FulfillmentTask Mirror Packet Preview

## Purpose

G33C-TASK1 adds a read-only preview for the exact native FulfillmentTask mirror/task packet for `NV-MP5SOQLJ` after G33C-MIRROR3-RETRY created the native ShopifyOrder mirror.

The preview is intentionally read-only. It does not create a FulfillmentTask, update the Customer App Order, update the native ShopifyOrder, mutate Hub records, call providers, send notifications, create production/compliance records, run sync/repair/replay, deduct inventory, or create PurchaseOrders.

## Source records

Target context:

- Customer App Order id: `6a060df457fc07751f3c7ded`
- Order number: `NV-MP5SOQLJ`
- Native ShopifyOrder id: `6a2df0026e266e19c68046eb`
- Customer App Order status: `bottled_packed`
- Payment status: `paid`
- Payment captured: `true`
- Fulfillment type: `delivery`
- Line item count: `3`

Hub remains active and operational fallback remains available.

## Preview mode

Function:

- `previewNativeOrderCutoverReadiness`

Preview mode:

- `ONE_TIME_NATIVE_FULFILLMENT_TASK_MIRROR_PACKET`

Required policies:

- `task_creation_policy=HELD_UNTIL_NATIVE_SHOPIFY_ORDER_EXISTS`
- `notification_policy=NO_NOTIFICATION`
- `provider_call_policy=NO_PROVIDER_CALLS`
- `hub_mutation_policy=NO_HUB_MUTATION`

## Proposed FulfillmentTask packet

The preview generates a schema-safe proposed FulfillmentTask packet using:

- Customer App Order id and order number.
- Existing native ShopifyOrder id.
- Customer App delivery/production date context.
- Existing one-time line item summary.
- Current production/delivery status projection.

Expected safe packet fields include:

- `order_id`
- `base44_order_id`
- `shopify_order_id`
- `native_shopify_order_id`
- `shopify_order_number`
- `order_number`
- `source_channel`
- `source_type`
- `task_source`
- `created_from_native_ops`
- `order_type`
- `fulfillment_type`
- `fulfillment_number`
- `delivery_date`
- `scheduled_date`
- `assigned_delivery_date`
- `production_date`
- `time_window`
- `delivery_window_label`
- `items`
- `items_summary`
- `line_item_count`
- `total_price`
- `address_complete`
- `status`
- `delivery_status`
- `production_status`
- `payment_status`
- `sync_status`
- `schedule_source`
- `review_status`
- `review_reason`
- `internal_notes`
- `notes`
- `audit_trail`

## Omitted fields

The preview omits customer PII and operational proof/route payloads from the returned packet:

- `customer_email`
- `customer_phone`
- `customer_name`
- full address values
- proof/drop payloads
- route fields
- raw Customer App payloads
- raw Hub payloads
- raw Shopify payloads
- raw Stripe/payment payloads
- provider/payment payloads

`customer_email` is a schema-required field for a future live FulfillmentTask write, but TASK1 does not return or write it. A future command must source any required internal-only schema field safely without exposing it in preview output.

## Duplicate checks

The preview checks for existing native FulfillmentTask records by:

- `native_shopify_order_id` / `shopify_order_id`
- `base44_order_id` / `order_id`
- `order_number` / `shopify_order_number`

If an existing native FulfillmentTask is found, the preview blocks create-readiness with duplicate risk instead of proposing a write.

## Held records

The following remain held:

- Customer App Order update
- native ShopifyOrder update
- native FulfillmentTask creation
- ProductionBatch creation
- BatchComplianceLog creation
- OrderSyncLog creation
- OrderReviewQueue creation
- Notification / CustomerMessageDeliveryLog creation
- Hub mutation
- provider calls
- Stripe / Shopify calls
- sync / repair / replay
- inventory / PurchaseOrder
- proof / drop / route actions

## No-write policy

G33C-TASK1 is read-only. A clean task packet preview only means the next phase can plan a default-off gated FulfillmentTask mirror command PR. It does not authorize live FulfillmentTask creation.

## Next phase options

If TASK1 is clean:

- Plan `G33C-TASK2` default-off gated native FulfillmentTask mirror command PR prep.

If blockers appear:

- Hold and resolve the exact missing field, duplicate risk, payment issue, address/date issue, or unsupported fulfillment type before command planning.
