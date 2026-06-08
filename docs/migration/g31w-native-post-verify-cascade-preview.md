# G31W Native Post-Verify Cascade Preview

## Scope

G31W adds a read-only post-verify cascade preview for the Customer App native production pilot order `NV-MPZNKGNT`.

The preview answers whether verified native production can later cascade to:

1. Native `FulfillmentTask` pack state.
2. Native `ShopifyOrder` bottled/packed production state.
3. Customer-facing order status impact.
4. Notification impact.

G31W does not run any cascade and does not mutate records.

## Target context

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`

Current expected state after G31V:

- Six native `ProductionBatch` rows exist for the target order/date.
- All six batches are `verified_logged`.
- Six `BatchComplianceLog` rows exist, one per batch.
- Customer App Order remains unchanged.
- Native ShopifyOrder remains unchanged.
- Native FulfillmentTask remains unchanged.
- Hub fallback remains active.

## Audit findings

### Customer App cascade targets

- `FulfillmentTask` has native fields for task, delivery, and production lifecycle state.
- `ShopifyOrder` has native production and fulfillment status fields.
- Customer App `Order` status and status history are customer-facing and must remain held until separately approved.
- Notification paths are separate side-effecting actions and remain held.
- Delivery, proof, drop, and route state are separate delivery lifecycle actions and remain held.

### Production verification prerequisites

Task/order cascade readiness requires:

- all related native `ProductionBatch` rows are `verified_logged`;
- required `BatchComplianceLog` rows are present;
- native `FulfillmentTask` exists;
- native `ShopifyOrder` exists;
- target task/order state is not terminal, cancelled, refunded, or already advanced beyond the previewed transition;
- subscription or multi-delivery ambiguity does not block order-level bottle/pack cascade.

A `ProductionBatch.compliance_log_id` alone is not treated as sufficient for cascade readiness. The preview requires actual readable `BatchComplianceLog` rows so missing compliance logs remain a blocker.

## Preview function

Function: `previewNativeProductionVerifyCascades`

Auth:

- admin auth, or
- internal preview/service secret using the existing read-only preview pattern.

Accepted inputs:

- `order_number`
- `customer_app_order_id`
- `native_shopify_order_id`
- `native_fulfillment_task_id`
- `production_date`
- `request_id`
- `mode: dry_run`

Reads only:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
- `CommandLog`

Response highlights:

- `success`
- `dry_run: true`
- `writes_performed: false`
- `verified_batch_count`
- `compliance_log_count`
- `task_pack_preview`
- `shopify_order_bottle_preview`
- `customer_status_impact_preview`
- `notification_impact_preview`
- `cascade_blockers`
- `cascade_warnings`
- `task_pack_ready`
- `shopify_order_bottle_ready`
- `customer_facing_status_held`
- `notifications_held`
- `hub_fallback_required`
- `next_action`

## Classification rules

### FulfillmentTask pack preview

`task_pack_preview.pack_cascade_allowed` is true only when:

- native task exists;
- all related batches are `verified_logged`;
- every target batch has a readable `BatchComplianceLog` row;
- task status is eligible for packing;
- task and delivery state are not terminal or already advanced.

The preview may propose future task status and production status fields, but it writes nothing.

### ShopifyOrder bottle/pack preview

`shopify_order_bottle_preview.order_bottle_cascade_allowed` is true only when:

- native order exists;
- all related batches are `verified_logged`;
- every target batch has a readable `BatchComplianceLog` row;
- order is one-time / non-subscription;
- fulfillment is not ambiguous multi-delivery parent context;
- order is not cancelled or refunded.

Order fulfillment status, customer-facing order status, and notifications remain held.

### Customer-facing impact

Customer-facing effects remain explicitly held:

- no Customer App Order status update;
- no `status_history` append;
- no delivered/ready-for-delivery change;
- no customer notification;
- no delivery/proof/drop/route mutation.

### Hub fallback

Hub fallback remains active. G31W only previews native cascade readiness and does not disable or replace any Hub path.

## Stale warning cleanup

G31W removes the legacy unconditional `native_production_batch_not_created` warning from `previewNativeProductionInventoryReadiness`.

The warning still appears when native production batches are truly missing. When exact native batches already exist for the order/date, the preview now reports existing native batch context instead of a stale missing-batch warning.

## Hard stops

G31W does not:

- pack `FulfillmentTask`;
- bottle/update `ShopifyOrder`;
- update Customer App `Order`;
- send notifications;
- update delivery/proof/drop/route state;
- update `ProductionBatch`;
- create `ProductionBatch`;
- create compliance logs;
- deduct inventory;
- create purchase orders;
- call Stripe, Shopify, providers, sync, repair, retry, or replay;
- expose live Pack/Bottle/Status buttons.

## Recommended next phase

If the live preview for `NV-MPZNKGNT` returns:

- `verified_batch_count: 6`,
- `compliance_log_count: 6`,
- no cascade blockers,
- `task_pack_ready: true`,
- `shopify_order_bottle_ready: true` for one-time/single-delivery context,

then the next implementation phase can plan default-off gated commands for:

1. native `FulfillmentTask` pack cascade; and
2. native `ShopifyOrder` bottled/packed production status cascade.

Customer-facing status updates and notifications should remain separate approval gates.
