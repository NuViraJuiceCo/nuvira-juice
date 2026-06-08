# G32F: Native delivery workflow readiness preview

## Scope

Adds a read-only delivery workflow readiness preview for `NV-MPZNKGNT` after the G32D-SCHED3 date-only correction.

Function:

- `previewNativeDeliveryWorkflowReadiness`

This phase does not run delivery lifecycle commands and does not mutate records.

## Target

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Corrected production date: `2026-06-07`
- Corrected delivery date: `2026-06-08`

## Read-only preview contract

`previewNativeDeliveryWorkflowReadiness` returns:

- `success`
- `dry_run:true`
- `writes_performed:false`
- native task row context
- Hub fallback row context
- route summary merge/reconciliation status
- stale Hub fallback detection
- Out For Delivery readiness preview
- Delivered readiness preview
- customer status impact preview
- notification impact preview
- blockers/warnings
- next action

## Stale Hub fallback handling

The route summary aggregation now treats matching native and Hub rows by order number as reconciliation candidates.

Rules:

- Native corrected schedule rows are preferred for current operational delivery date filtering.
- A Hub fallback row with a different delivery date is suppressed from active delivery stops and reported in `hub_fallback_reconciliation`.
- Hub fallback is not deleted or mutated.
- Warnings are emitted when a stale Hub fallback date is detected.

For `NV-MPZNKGNT`, the known stale Hub row is `2026-06-06`, while the corrected native delivery date is `2026-06-08`.

## Delivery readiness interpretation

Out For Delivery may be preview-ready when:

- Customer App Order exists, paid, and captured.
- Native ShopifyOrder is bottled.
- Native FulfillmentTask is packed.
- Native FulfillmentTask delivery status is pending.
- The native task is on the requested delivery date.
- Six native ProductionBatch rows are verified_logged.
- Six BatchComplianceLog rows exist.

Delivered remains held until proof/drop, route completion, customer status, and notification policy are defined.

## Explicit non-goals

This phase does not:

- mark Out For Delivery
- mark Delivered
- update delivery status
- update FulfillmentTask status
- update Customer App Order status
- append status_history
- send or create notifications
- create message logs
- write proof/drop/route fields
- update Hub records
- run Hub repair/replay
- call Stripe, Shopify, or providers
- run sync/retry/repair/replay
- deduct inventory
- create PurchaseOrder
- update ProductionBatch
- update BatchComplianceLog
- disable Hub bridge

## UI

Read-only UI updates:

- `/admin/sync-health` gets a Native Delivery Workflow Readiness Preview panel.
- `/admin/delivery-queue` surfaces stale Hub fallback reconciliation metadata when the route summary suppresses duplicate/stale Hub fallback rows.

No new delivery action buttons are added.
