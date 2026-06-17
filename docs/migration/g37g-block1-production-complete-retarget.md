# G37G-BLOCK1: ProductionBatch complete command retarget

## Executive summary

G37G exact complete production readiness for `NV-MQHJR3V2` found that the deployed complete command was not compatible with the current pilot. The live command was not run, gates were not opened, and both ProductionBatch rows remain under the G37F-started lifecycle state until a separately approved completion run.

This PR retargets `completeNativeProductionBatchesForCustomerApp` to the exact G37G target only. It does not complete production and does not create compliance logs.

## Readiness check result

Fresh read-only lifecycle preview request:

- `g37g_preflight_lifecycle_preview_nvmqhjr3v2_20260617T171634Z`

Result summary:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `batch_count:2`
- both exact target batches present
- both exact target batches are `in_production`
- both batches have `actual_start_time`
- `complete_ready_count:0` because actual units were not supplied in the readiness check
- row blocker: `missing_actual_units`
- `verify_ready_count:0`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- Hub fallback remains active

Classification before this PR:

- `g37g_complete_blocked_command_target_not_retarged`

## Root cause

`completeNativeProductionBatchesForCustomerApp` was still hardcoded for the previous exact pilot:

- order: `NV-MPZNKGNT`
- production date: `2026-06-05`
- delivery date: `2026-06-06`
- six previous deterministic ProductionBatch ids
- planned units `1` per batch

The current G37G target is:

- order number: `NV-MQHJR3V2`
- Customer App Order: `6a321cbfd8d78863f15de956`
- native ShopifyOrder: `6a321d38a3819cdd5cf89031`
- native FulfillmentTask: `6a321d38071327f8218b958b`
- production date: `2026-06-19`
- delivery date: `2026-06-20`
- exact ProductionBatch records:
  - `6a32c1de2fd3943a9cf171a8` / `NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT` / Hydration Shot / planned units `3`
  - `6a32c1de87810fd871f131c5` / `NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT` / Radiance Shot / planned units `3`

## Exact retarget contract

The command now accepts only the G37G target above. It accepts either the exact native ProductionBatch record ids or the exact deterministic batch ids as the selected batch set.

Required target selection is exactly two rows:

- Hydration Shot — planned units `3`
- Radiance Shot — planned units `3`

Any missing, extra, wrong, or partially matching batch set fails closed.

## Actuals contract

Completion requires owner/operator actuals. The command does not infer actual units from planned units.

Accepted exact actual-unit shapes include:

- product string form: `Hydration Shot:<units>,Radiance Shot:<units>`
- exact deterministic batch id map
- exact native ProductionBatch record id map
- exact product-name map

The request must include:

- `actual_end_time`
- `completed_by`

If either value is missing, the command fails closed with `writes_performed:false`.

## Gate, policy, and confirmation

Implemented gates remain:

- `ENABLE_NATIVE_PRODUCTION_BATCH_COMPLETE`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_KILL_SWITCH`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_ALLOWED_EMAILS`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_ORDER_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_BATCH_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_COMPLETE_POLICY`

Required policy:

- `EXACT_BATCH_ACTUAL_UNITS_ONLY`

Required confirmation:

- `complete_native_production_batches_for_customer_app`

The request-level no-op policies must remain held/no-op when supplied:

- `inventory_deduction_policy=HELD`
- `purchase_order_policy=HELD`
- `notification_policy=NO_NOTIFICATION`
- `provider_call_policy=NO_PROVIDER_CALLS`
- `hub_mutation_policy=NO_HUB_MUTATION`

## Fresh preview dependency

Before any future live write, the command requires a fresh `previewNativeProductionBatchLifecycle` result for the exact target. The preview must show:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `batch_count:2`
- exact target order/native ids
- exact target batch ids and record ids
- planned units `3` for both batches
- current status `in_production`
- `actual_start_time` present
- complete-ready count `2` after exact actual units are supplied
- no lifecycle blockers
- inventory deduction held
- PurchaseOrder held
- Hub fallback retained

If the preview changes, contains blockers, shows non-completable rows, or has actual-unit preview mismatches, the command fails closed.

## Allowed future writes

Only after separate exact live approval, the command may write:

1. Update the two exact `ProductionBatch` records from `in_production` to `completed_pending_verification`.
2. Write exact `actual_units`, `actual_end_time`, `completed_by`, and safe audit metadata on those exact rows.
3. Create/update one safe `CommandLog` for idempotency/audit.

## Forbidden writes and side effects

The command must not:

- create `ProductionBatch`
- create `BatchComplianceLog`
- verify production
- update Customer App Order
- update native ShopifyOrder
- update native FulfillmentTask
- mutate Recipe, InventoryItem, IngredientYield, Bundle, or Product
- deduct inventory
- create PurchaseOrder
- create Notification or CustomerMessageDeliveryLog rows
- create OrderSyncLog or OrderReviewQueue rows
- call Stripe, Shopify, or other providers
- mutate Hub records
- run sync, repair, or replay
- pack, bottle, deliver, or update customer-facing status

## Idempotency

The command remains request-id/idempotency-key governed.

- First valid future run updates exactly two batches and creates one CommandLog.
- Duplicate same request id skips with `writes_performed:false`.
- If both exact batches are already `completed_pending_verification` with coherent completion metadata and matching actual units, the command returns a safe skipped state.
- Partial completed/in-production state fails closed.

## Test coverage

Added G37G-BLOCK1 harness coverage for:

- disabled gate
- missing auth
- confirmation mismatch
- policy mismatch
- wrong order/date/batch selection
- exact record-id and deterministic batch-id selection handling
- actual units by product string, product map, deterministic batch id, and record id
- missing actual units
- missing actual end time
- missing completed_by
- fresh preview requirement
- planned-unit validation
- record-id validation
- valid in-memory completion updates exactly two rows
- duplicate idempotency skip
- already-completed skip
- partial lifecycle conflict
- locked/terminal state block
- no BatchComplianceLog, master-data, order/task, inventory/PO, provider, notification, or Hub writes
- response/log safety

The legacy G31R harness now delegates to this exact retarget harness because the live command is intentionally scoped to the current G37G pilot.

## Owner input required before live G37G

Owner/operator must provide exact completion actuals before any live run:

```text
APPROVE EXACT COMPLETE PRODUCTION ACTUALS NV-MQHJR3V2

order_number=NV-MQHJR3V2
production_date=2026-06-19
selected_production_batch_ids=6a32c1de2fd3943a9cf171a8,6a32c1de87810fd871f131c5

actual_units:
Hydration Shot=
Radiance Shot=

actual_end_time=
completed_by=
variance_notes=

inventory_deduction_policy=HELD
purchase_order_policy=HELD
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
```

Do not infer actual units from planned units.

## Live execution boundary

This PR is prep only.

Do not publish or run the live complete command until after PR audit/merge, scoped publish of only `completeNativeProductionBatchesForCustomerApp`, gates-closed boundary verification, fresh lifecycle preview with owner actuals, and separate exact G37G live approval.

## Recommendation

Close/merge/publish G37G-BLOCK1 first. Then request owner actual units, actual end time, and completed_by. Only after a fresh lifecycle preview with those actuals is clean should a separate exact G37G live complete approval be requested.
