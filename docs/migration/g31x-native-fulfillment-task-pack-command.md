# G31X — Native FulfillmentTask Pack Command Planning

Date: 2026-06-08

## Scope

G31X prepares a default-off native Customer App command to pack the exact verified FulfillmentTask for order `NV-MPZNKGNT`.

This phase does **not** run the pack command and does **not** mutate live records during PR prep.

## Target context

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`

Current verified production context:

- Six native `ProductionBatch` rows exist and are `verified_logged`.
- Six `BatchComplianceLog` rows exist, one per batch.
- Native FulfillmentTask remains `pending` / production status `awaiting_production` / delivery status `pending`.
- Native ShopifyOrder remains held for a separate bottle/pack cascade.
- Customer App Order, customer-facing status, notifications, delivery/proof/drop/route state, inventory, PO, providers, Stripe, Shopify API, sync/repair/replay, and Hub bridge remain untouched.

## Audit findings

### Customer App FulfillmentTask schema

Relevant schema-safe pack fields:

- `status`
- `production_status`
- `packed_at`
- `command_log_id`
- `audit_trail`

Fields intentionally held:

- `delivery_status`
- `out_for_delivery_at`
- `delivered_at`
- `route_id`
- `route_stop_sequence`
- proof/drop fields
- Customer App Order status/history fields
- native ShopifyOrder status/checklist fields
- notification fields

The schema supports lowercase `packed` in `FulfillmentTask.status`. Existing native lifecycle planning also uses `status: packed` and `production_status: packed` for pack. G31X therefore uses lowercase `packed` for both task status and task production status.

### Hub reference behavior

Hub pack behavior is treated as reference only. G31X does not call Hub. The native v1 command keeps ShopifyOrder bottle/pack, Customer App Order status projection, notifications, and delivery lifecycle separate.

## Pack-state contract

Future approved live command may write only:

- `FulfillmentTask.status = packed`
- `FulfillmentTask.production_status = packed`
- `FulfillmentTask.packed_at = server timestamp`
- safe `FulfillmentTask.audit_trail` append
- `FulfillmentTask.command_log_id`
- one safe `CommandLog`

It must not write:

- Customer App Order
- native ShopifyOrder
- ProductionBatch
- BatchComplianceLog
- InventoryItem / inventory deduction
- PurchaseOrder
- delivery/proof/drop/route fields
- notifications
- provider/payment/API calls
- sync/retry/repair/replay
- Hub records

## Command contract

Function:

- `packNativeProductionFulfillmentTaskForCustomerApp`

Confirmation phrase:

- `pack_native_fulfillment_task_for_customer_app`

Required feature gates:

- `ENABLE_NATIVE_FULFILLMENT_TASK_PACK=true`
- `NATIVE_FULFILLMENT_TASK_PACK_KILL_SWITCH=false`
- `NATIVE_FULFILLMENT_TASK_PACK_ALLOWED_EMAILS=<admin/owner allowlist>`
- `NATIVE_FULFILLMENT_TASK_PACK_ORDER_ALLOWLIST=NV-MPZNKGNT`
- `NATIVE_FULFILLMENT_TASK_PACK_TASK_ALLOWLIST=6a22ffdaf675ea79e30575aa`
- `NATIVE_FULFILLMENT_TASK_PACK_POLICY=EXACT_VERIFIED_ORDER_TASK_ONLY`

Defaults:

- disabled
- kill switch active
- no writes

Required inputs:

- `mode: live`
- `confirmation: pack_native_fulfillment_task_for_customer_app`
- `order_number: NV-MPZNKGNT`
- `native_fulfillment_task_id: 6a22ffdaf675ea79e30575aa`
- `native_shopify_order_id: 6a22ffda400eb806eb3ca945`
- `production_date: 2026-06-05`
- `request_id`

Optional safety match:

- `customer_app_order_id: 6a219a3f4adcda5856c3d579`
- `expected_delivery_date: 2026-06-06`
- `expected_task_status: pending`

Forbidden inputs include custom status overrides, delivery status overrides, ShopifyOrder updates, Customer App Order updates, notification flags, proof/drop/route data, sync/repair/replay flags, provider/payment payloads, raw payloads, and bulk ids.

## Pre-write validation

The command runs a fresh `previewNativeProductionVerifyCascades` service invocation immediately before any write and requires:

- `success: true`
- `dry_run: true`
- `writes_performed: false`
- exact order/task/native order ids
- `task_pack_ready: true`
- six verified native `ProductionBatch` rows
- six readable `BatchComplianceLog` rows
- no cascade blockers
- Customer App Order status impact held
- notifications held
- delivery status update not projected

It then directly re-reads target records and requires:

- Customer App Order exists and is paid/captured
- native ShopifyOrder exists and is not canceled/refunded
- exact native FulfillmentTask exists
- FulfillmentTask status is eligible for pack
- FulfillmentTask delivery lifecycle has not advanced
- all six exact ProductionBatch rows are `verified_logged`
- each batch has verification metadata and a matching compliance log row

## Idempotency

- `request_id` is required.
- Existing success/skipped `CommandLog` for the same idempotency key returns skipped/idempotent success with `writes_performed:false`.
- Failed request ids cannot be reused.
- Already packed exact target task is treated as safe skipped/dedupe; it does not rewrite the task.

## UI and preview

G31X updates the post-verify cascade preview to expose:

- `pack_command_available`
- `pack_command_gated`
- `pack_requires_exact_approval`

No live pack button is added.

## Hard stops

G31X does not run live pack. Future live execution requires a separate explicit approval, likely G31Y.

## Recommended next phase

After G31X is published and boundary-verified, request exact approval for G31Y native FulfillmentTask pack for `NV-MPZNKGNT`, then run one gated live command with gates open only for that attempt.
