# G31O — Gated Native Start Production Command

## Purpose

G31O adds a default-off Customer App backend command, `startNativeProductionBatchesForCustomerApp`, for a later exact-order start-production pilot. The command is scoped to the six planned native `ProductionBatch` rows for order `NV-MPZNKGNT` and uses the live G31N lifecycle preview as its pre-write source of truth.

G31O is PR prep only. The command must not be run against live data until a separate exact approval is provided.

## Exact target

Order context:

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`

Batch ids:

- `NATIVE-NV-MPZNKGNT-2026-06-05-AURA`
- `NATIVE-NV-MPZNKGNT-2026-06-05-OASIS`
- `NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE`
- `NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT`
- `NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU`
- `NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT`

## Gates

All gates default closed:

- `ENABLE_NATIVE_PRODUCTION_BATCH_START=true`
- `NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH=false`
- `NATIVE_PRODUCTION_BATCH_START_ALLOWED_EMAILS=<admin/owner allowlist>`
- `NATIVE_PRODUCTION_BATCH_START_ORDER_ALLOWLIST=NV-MPZNKGNT`
- `NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST=<the six exact batch ids>`
- `NATIVE_PRODUCTION_BATCH_START_POLICY=EXACT_PREVIEW_PACKET_ONLY`

The confirmation phrase is:

```text
start_native_production_batches_for_customer_app
```

## Pre-write validation

Before any write, the command invokes `previewNativeProductionBatchLifecycle` through service-role function invocation, not recursive HTTP self-fetch. It requires:

- `success: true`
- `dry_run: true`
- `writes_performed: false`
- `batch_count: 6`
- `start_preview.ready_count: 6`
- no top-level blockers
- each target batch has `current_status: planned`
- each target batch has `can_start: true`
- production date `2026-06-05`
- order number `NV-MPZNKGNT`
- native ShopifyOrder and native FulfillmentTask present

Preview drift blocks the command before writes.

## Allowed writes when separately approved

Only these writes are allowed:

- Update the six exact `ProductionBatch` records from `planned` to `in_production`.
- Set `actual_start_time` to a server timestamp.
- Set `started_by` to the authenticated admin actor.
- Append a safe `audit_trail` entry.
- Add the safe `CommandLog` id to `command_log_ids` when supported.
- Create one `CommandLog` for audit and idempotency.

The command does not write actual units, ingredient usage, pH/QC fields, compliance logs, inventory stock, purchase orders, Customer App Order, native ShopifyOrder, native FulfillmentTask, Hub records, notifications, provider calls, or sync/repair/replay state.

## Dedupe and conflict behavior

- Same successful `request_id` returns skipped/idempotent success and creates no duplicate audit entries.
- All six batches already `in_production` with coherent start metadata returns skipped/dedupe and does not update batches.
- Partial lifecycle state blocks with `partial_lifecycle_conflict`.
- Locked, terminal, verified, archived, mismatched, or missing batches block before writes.
- Failed prior `request_id` is not reusable.

## Transaction note

Base44 entity updates are not treated as transactional here. The command validates all target batches before any update and writes sequentially only after all gates and preview checks pass. If an update fails after a prior batch update, the failure `CommandLog` records the partial update count. No rollback is attempted without a separately approved rollback command.

## Held work

Still held after G31O:

- Live start execution
- Complete production
- Verify production
- BatchComplianceLog creation
- Inventory deduction
- PurchaseOrder automation
- Customer-facing order/task/status cascades
- Hub bridge retirement

## Next exact approval phrase

If G31O is audited, merged, published, and boundary verified, the next live phase should use an explicit approval such as:

```text
APPROVE G31P EXACT NATIVE START PRODUCTION NV-MPZNKGNT
```
