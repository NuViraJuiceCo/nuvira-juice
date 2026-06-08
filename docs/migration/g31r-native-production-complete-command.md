# G31R — Native Complete Production command prep

## Scope

G31R prepares the native Customer App Complete Production path for the exact `NV-MPZNKGNT` pilot batches. It does not run completion and does not mutate live records during PR prep.

Target order:

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`

Target batches:

- `NATIVE-NV-MPZNKGNT-2026-06-05-AURA`
- `NATIVE-NV-MPZNKGNT-2026-06-05-OASIS`
- `NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE`
- `NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT`
- `NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU`
- `NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT`

## Audit findings

Customer App `ProductionBatch` schema supports the v1 completion fields:

- `status`
- `actual_units`
- `actual_end_time`
- `completed_by`
- `audit_trail`
- `command_log_ids`

Hub completion flows also support or write broader fields such as `ingredients_used`, bottle/QC fields, pH fields, `passed_failed`, corrective-action fields, manual-batch updates, and downstream verification/compliance fields. Those are intentionally out of scope for G31R native v1 completion.

Verification/compliance remains separate. Inventory deduction, purchase-order automation, task packing, ShopifyOrder bottling, and customer-facing status changes remain held.

## Actual-units contract

Completion requires explicit actual units for every target batch. The command does not infer actual units from planned units.

Rules:

- `batch_actual_units` must be an object keyed by exact batch id.
- Every one of the six target batch ids must be present.
- No extra batch ids are allowed.
- Values must be numeric and greater than or equal to `0`.
- All target batches must currently be `in_production`.
- `actual_start_time` must exist on every target batch.
- Locked, terminal, verified, archived, or partially completed states block completion.
- G31R v1 requires all six batches; partial completion is not supported.

Future owner approval format:

```text
APPROVE G31S EXACT NATIVE COMPLETE PRODUCTION NV-MPZNKGNT
actual_units:
- Aura=1
- Oasis=1
- Pineapple Juice=1
- Radiance Shot=1
- Re-Nu=1
- Reset Shot=1
```

## Live command contract

Function:

- `completeNativeProductionBatchesForCustomerApp`

Confirmation phrase:

- `complete_native_production_batches_for_customer_app`

Default state:

- disabled
- kill switch active
- no writes

Gate names:

- `ENABLE_NATIVE_PRODUCTION_BATCH_COMPLETE`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_KILL_SWITCH`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_ALLOWED_EMAILS`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_ORDER_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_BATCH_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_POLICY`

Required policy:

- `EXACT_BATCH_ACTUAL_UNITS_ONLY`

Allowed future writes after separate explicit approval:

- exact six `ProductionBatch` records only
- `ProductionBatch.status = completed_pending_verification`
- `ProductionBatch.actual_units`
- `ProductionBatch.actual_end_time = server timestamp`
- `ProductionBatch.completed_by = admin actor email`
- safe `ProductionBatch.audit_trail` append
- `ProductionBatch.command_log_ids` append if supported
- one safe `CommandLog`

Forbidden writes and side effects:

- no `ingredients_used`
- no pH/QC/compliance fields
- no `BatchComplianceLog` or compliance logs
- no verify fields (`verified_at`, `verified_by`, `compliance_log_id`)
- no inventory deduction
- no `PurchaseOrder`
- no `ManualProductionBatch`
- no Customer App Order mutation
- no native ShopifyOrder mutation
- no native FulfillmentTask mutation
- no provider, Stripe, Shopify, notification, sync, repair, replay, or Hub mutation

## Read-only preview updates

`previewNativeProductionBatchLifecycle` now supports dry-run actual-units inputs:

- `batch_actual_units`
- `actual_units_by_batch_id`
- `actual_units_by_product_name`

When actual units are supplied, the preview validates completion readiness and exposes:

- `completion_preview_ready`
- `complete_ready_count`
- `complete_blocked_count`
- `actual_units_supplied_count`
- `completion_required_fields`
- `completion_data_contract`
- `completion_rows`

No writes are performed by the preview.

## Atomicity note

Base44 entity updates are validated fail-closed before any ProductionBatch write. If the platform does not provide a multi-row transaction and a single update fails after earlier batch updates, the command records a failed CommandLog with partial update metadata and stops. No rollback is attempted without a separate explicit rollback approval.

## Hard stops

Do not run the live complete command until a later exact approval supplies actual units for all six batches.

Do not expand G31R into Verify, compliance logging, inventory deduction, purchase-order automation, task packing, ShopifyOrder bottling, notifications, provider calls, sync, repair, replay, or customer-facing status changes.
