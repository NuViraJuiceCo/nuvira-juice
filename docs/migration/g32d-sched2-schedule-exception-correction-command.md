# G32D-SCHED2: gated one-order schedule exception correction command

## Scope

Adds `correctNativeScheduleExceptionForCustomerApp`, a default-off gated command for the exact one-order schedule exception on `NV-MPZNKGNT`.

This PR prepares the command only. It does not run the live correction.

## Exact target

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`

## Date-only correction contract

Required input values for a future live approval:

- `current_recorded_production_date`: `2026-06-05`
- `current_recorded_delivery_date`: `2026-06-06`
- `actual_production_date`: `2026-06-07`
- `actual_delivery_date`: `2026-06-08`
- `correction_mode`: `DATE_ONLY`
- `leave_delivery_window_unchanged`: `true`
- `notification_policy`: `NO_NOTIFICATION`
- confirmation phrase: `correct_native_schedule_exception_date_only_no_notification`

The command rejects delivery window updates. If a window needs correction later, use a separate date-and-window contract.

## Gates

Default state is disabled with no writes. Future live execution requires all gates to be exact:

- `ENABLE_NATIVE_SCHEDULE_EXCEPTION_CORRECTION=true`
- `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_KILL_SWITCH=false`
- `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_ALLOWED_EMAILS=<admin/owner allowlist>`
- `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_ORDER_ALLOWLIST=NV-MPZNKGNT`
- `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_CUSTOMER_ORDER_ALLOWLIST=6a219a3f4adcda5856c3d579`
- `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_TASK_ALLOWLIST=6a22ffdaf675ea79e30575aa`
- `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_SHOPIFY_ORDER_ALLOWLIST=6a22ffda400eb806eb3ca945`
- `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_POLICY=EXACT_DATE_ONLY_NO_NOTIFICATION`

## Allowed future writes

Only these fields may be written after separate live approval:

### FulfillmentTask `6a22ffdaf675ea79e30575aa`

- `delivery_date = 2026-06-08`
- `scheduled_date = 2026-06-08`
- `assigned_delivery_date = 2026-06-08`
- `production_date = 2026-06-07`

### Customer App Order `6a219a3f4adcda5856c3d579`

- `estimated_delivery_date = 2026-06-08`
- `assigned_delivery_date = 2026-06-08`
- `production_date = 2026-06-07`
- `assigned_production_day = 2026-06-07`

### Native ShopifyOrder `6a22ffda400eb806eb3ca945`

- `assigned_delivery_date = 2026-06-08`
- `selected_delivery_date = 2026-06-08` when the field exists
- `production_date = 2026-06-07`
- first fulfillment snapshot `production_date` and `delivery_date` when the snapshot exists

### CommandLog

One safe CommandLog records request id, actor metadata, target ids, gate policy, and safe result metadata.

## Explicit non-goals

The command does not write:

- `ProductionBatch.production_date`
- `ProductionBatch.batch_id`
- `BatchComplianceLog.date` or any compliance log field
- Customer App Order `status`
- Customer App Order `status_history`
- Native ShopifyOrder `production_status` or `fulfillment_status`
- FulfillmentTask `status`, `delivery_status`, or `production_status`
- Notification or message log rows
- OrderSyncLog, OrderReviewQueue, SafeSyncParityLog, or Hub records
- delivery/proof/drop/route fields
- inventory or PurchaseOrder fields

It does not call Stripe, Shopify, providers, notification channels, sync, retry, repair, or replay.

## Validation behavior

Before any future write, the command validates:

- admin auth
- actor email allowlist
- exact order/customer-order/task/native-order allowlists
- exact stale recorded dates
- exact target actual dates
- `DATE_ONLY` mode
- `NO_NOTIFICATION` policy
- delivery window unchanged
- local fresh schedule correction preflight equivalent to `previewNativeScheduleExceptionCorrection`
- six verified native ProductionBatch rows remain on `2026-06-05`
- six BatchComplianceLog rows remain on `2026-06-05`
- customer status, notifications, delivery lifecycle, ProductionBatch, and compliance log changes are not projected

Validation failure returns a structured safe response with `writes_performed:false`.

## Idempotency

- `request_id` is required.
- A matching successful CommandLog with the same idempotency key returns skipped/idempotent success.
- Duplicate calls do not append duplicate audit entries or create duplicate success logs.
- If the date correction is already satisfied under a different request, the command fails closed for explicit reconciliation.

## Non-transactional note

Base44 entity updates are not treated as an all-or-nothing transaction here. The command validates fail-closed before any update and records a CommandLog before writes. If an update fails after a prior date update, the command finalizes a failed CommandLog with reconciliation-required metadata and does not attempt rollback.
