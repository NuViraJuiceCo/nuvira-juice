# G37F-BLOCK1: ProductionBatch start command retarget

## Executive summary

G37F live start production was stopped before gates because the deployed exact start command was not compatible with the current `NV-MQHJR3V2` pilot. The command was still scoped to the previous exact pilot order and six previous ProductionBatch rows.

This PR retargets `startNativeProductionBatchesForCustomerApp` to the exact G37F target only. It does not open gates and does not run the live start command.

## Root cause

`startNativeProductionBatchesForCustomerApp` was still hardcoded for:

- order: previous pilot `NV-MPZNKGNT`
- production date: previous pilot date
- six prior ProductionBatch batch ids and products

The current G37F approved target is:

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

The command now accepts only the G37F target above. It accepts either the exact native ProductionBatch record ids or the exact deterministic batch ids as the selected batch set.

Required selection is exactly two rows:

- Hydration Shot — `3`
- Radiance Shot — `3`

Any missing, extra, wrong, or partially matching batch set fails closed.

## Gate, policy, and confirmation

Implemented gates remain:

- `ENABLE_NATIVE_PRODUCTION_BATCH_START`
- `NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH`
- `NATIVE_PRODUCTION_BATCH_START_ALLOWED_EMAILS`
- `NATIVE_PRODUCTION_BATCH_START_ORDER_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_START_POLICY`

Required policy:

- `EXACT_PREVIEW_PACKET_ONLY`

Required confirmation:

- `start_native_production_batches_for_customer_app`

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
- current status `planned`
- start-ready count `2`
- no lifecycle blockers
- inventory deduction held
- PurchaseOrder held
- Hub fallback retained

If the preview changes, contains blockers, or shows non-startable rows, the command fails closed.

## Allowed future writes

Only after separate exact live approval, the command may write:

1. Update the two exact `ProductionBatch` records from `planned` to `in_production`.
2. Write `actual_start_time`, `started_by`, and safe audit metadata on those exact rows.
3. Create/update one safe `CommandLog` for idempotency/audit.

## Forbidden writes and side effects

The command must not:

- create `ProductionBatch`
- create `BatchComplianceLog`
- complete or verify production
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
- If both exact batches are already in production with coherent start metadata, the command returns a safe skipped state.
- Partial started/planned state fails closed.

## Test coverage

Added G37F-BLOCK1 harness coverage for:

- disabled gate
- missing auth
- confirmation mismatch
- policy mismatch
- wrong order/date/batch selection
- exact record-id and deterministic batch-id selection handling
- fresh preview requirement
- planned-unit validation
- record-id validation
- valid in-memory start updates exactly two rows
- duplicate idempotency skip
- already-started skip
- partial lifecycle conflict
- locked/terminal state block
- no BatchComplianceLog, master-data, order/task, inventory/PO, provider, notification, or Hub writes
- response/log safety

The legacy G31O harness now delegates to this exact retarget harness because the live command is intentionally scoped to the current G37F pilot.

## Live execution boundary

This PR is prep only.

Do not publish or run the live start command until after PR audit/merge, scoped publish of only `startNativeProductionBatchesForCustomerApp`, gates-closed boundary verification, and a fresh clean lifecycle preview.

## Recommendation

Close/merge/publish G37F-BLOCK1 first. Then request separate exact G37F live start approval only if the published command is gates-closed safe and the fresh lifecycle preview remains clean.
