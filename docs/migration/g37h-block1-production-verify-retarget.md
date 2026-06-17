# G37H-BLOCK1: Production verify/QC command retarget

## Executive summary

G37H-BLOCK1 retargets `verifyNativeProductionBatchesForCustomerApp` to the exact `NV-MQHJR3V2` production verify/QC pilot. This is PR prep only. It does not run live verify, does not open gates, and does not create `BatchComplianceLog` rows in PR prep.

The retarget prevents Friday QC from hitting an old-pilot command target after physical production is started and completed through the separately approved G37F/G37G lifecycle steps.

## Exact target

Order and native context:

- order number: `NV-MQHJR3V2`
- Customer App Order: `6a321cbfd8d78863f15de956`
- native ShopifyOrder: `6a321d38a3819cdd5cf89031`
- native FulfillmentTask: `6a321d38071327f8218b958b`
- production date: `2026-06-19`
- delivery date: `2026-06-20`

Exact ProductionBatch records:

- `6a32c1de2fd3943a9cf171a8` / `NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT` / Hydration Shot / planned units `3`
- `6a32c1de87810fd871f131c5` / `NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT` / Radiance Shot / planned units `3`

The command accepts only the exact two-batch selection, either by native record id or deterministic `batch_id`. Missing, extra, wrong, or partial selections fail closed with `writes_performed:false`.

## QC data requirements

Do not infer QC values. Each batch must have explicit verification input:

- `pH_result`
- `pH_passed` or `pH_passed_failed`
- `batch_passed` or `passed_failed`
- optional `qc_notes` / `verification_notes`

The request must also include:

- `verified_at`
- `verified_by`
- `compliance_log_policy=CREATE_LOCKED_SAFE_LOGS`

Accepted exact verification-data shapes include:

- `verification_data_by_batch_id` keyed by exact native ProductionBatch record id
- `verification_data_by_batch_id` keyed by deterministic `batch_id`
- `verification_data` keyed by exact product name (`Hydration Shot`, `Radiance Shot`)
- global `verification_data` only when the same QC values safely apply to both exact batches

## Gate, policy, and confirmation

Implemented gates remain:

- `ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY`
- `NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH`
- `NATIVE_PRODUCTION_BATCH_VERIFY_ALLOWED_EMAILS`
- `NATIVE_PRODUCTION_BATCH_VERIFY_ORDER_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_VERIFY_BATCH_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_VERIFY_POLICY`

Required policy:

- `EXACT_BATCH_VERIFICATION_DATA_ONLY`

Required confirmation:

- `verify_native_production_batches_for_customer_app`

Required request no-op policies:

- `inventory_deduction_policy=HELD`
- `purchase_order_policy=HELD`
- `notification_policy=NO_NOTIFICATION`
- `provider_call_policy=NO_PROVIDER_CALLS`
- `hub_mutation_policy=NO_HUB_MUTATION`

Any non-held or non-no-op value fails closed.

## Status precondition

Before any future live verify, both exact batches must already be completed by the G37G command and visible as `completed_pending_verification` or the schema-canonical completed-pending-verification state.

The command blocks when a target batch is:

- not found
- duplicated by `batch_id`
- wrong product
- wrong production date
- wrong planned units
- not linked to the exact target order/native records
- not `completed_pending_verification`
- missing actual start, actual end, completed_by, or actual units
- already verified/logged
- locked
- terminal/archived
- already associated with a `BatchComplianceLog`

## Fresh preview dependency

Before any future live write, the command requires a fresh `previewNativeProductionBatchLifecycle` result for the exact target. The preview must show:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- exact order/native ids
- `batch_count:2`
- exact target deterministic batch ids
- planned units `3` for both batches
- current status `completed_pending_verification`
- actual units, actual start time, and actual end time present
- `verify_preview.ready_count:2`
- `verification_preview_ready:true`
- no lifecycle blockers
- inventory deduction held
- PurchaseOrder held
- Hub fallback retained

If the preview changes, contains blockers, shows non-verifiable rows, or has QC input preview mismatches, the command fails closed.

## Allowed future writes

Only after separate exact live approval, the command may write:

1. Update the two exact `ProductionBatch` records from `completed_pending_verification` to `verified_logged` or the schema-canonical verified status.
2. Create exactly two locked/safe `BatchComplianceLog` rows, one per exact ProductionBatch.
3. Create/update one safe `CommandLog` for idempotency/audit.

## Forbidden writes and side effects

The command must not:

- create `ProductionBatch`
- complete production
- start production
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

## Compliance log policy

Future live verify creates one locked/safe `BatchComplianceLog` per exact batch only. The log contains safe production/QC fields:

- date
- deterministic `batch_id`
- juice flavor
- safe ingredient summary from the ProductionBatch row
- start/end time
- quantity produced
- pH result
- pass/fail state
- optional QC notes
- `verified_by`
- `verified_at`
- source ProductionBatch id
- locked flag

It does not include raw payloads, customer PII, provider payloads, payment payloads, secrets, inventory deduction fields, or PurchaseOrder fields.

## Idempotency

The command remains request-id/idempotency-key governed.

- First valid future run updates exactly two batches, creates exactly two locked compliance logs, and records one CommandLog.
- Duplicate same request id skips with `writes_performed:false`.
- A failed request id is not reusable.
- Already verified, partially verified, locked, or compliance-log-present states fail closed unless a future explicit repair flow is approved.

## Required future owner/QC approval block

```text
APPROVE EXACT VERIFY PRODUCTION QC NV-MQHJR3V2

order_number=NV-MQHJR3V2
production_date=2026-06-19
selected_production_batch_ids=6a32c1de2fd3943a9cf171a8,6a32c1de87810fd871f131c5

verification_data:
Hydration Shot:
  production_batch_id=6a32c1de2fd3943a9cf171a8
  pH_result=
  pH_passed=
  batch_passed=
  qc_notes=

Radiance Shot:
  production_batch_id=6a32c1de87810fd871f131c5
  pH_result=
  pH_passed=
  batch_passed=
  qc_notes=

verified_at=
verified_by=
compliance_log_policy=CREATE_LOCKED_SAFE_LOGS
inventory_deduction_policy=HELD
purchase_order_policy=HELD
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
```

## Test coverage

Added G37H-BLOCK1 harness coverage for:

- missing auth
- disabled gate
- missing confirmation
- policy mismatch
- wrong order/date/batch selection
- missing/extra/wrong batch ids
- wrong product
- not-completed batch state
- already verified batch state
- locked batch state
- missing pH result
- missing pH pass/fail
- missing batch pass/fail
- missing verified_by
- missing verified_at
- requested notification/provider/Hub mutation/inventory deduction/PurchaseOrder blocks
- valid in-memory verify updates exactly two batches
- valid verify creates exactly two locked BatchComplianceLog rows
- one CommandLog created
- duplicate request id skip
- no Customer App Order, native ShopifyOrder, native FulfillmentTask, inventory, PO, notification, provider, or Hub writes
- response/log safety

The legacy G31U verify harness now delegates to this exact retarget harness because the live command is intentionally scoped to the current G37H pilot.

## Live execution boundary

This PR is prep only.

Do not publish or run the live verify command until after PR audit/merge, scoped publish of only `verifyNativeProductionBatchesForCustomerApp`, gates-closed boundary verification, fresh lifecycle preview after G37G completion, exact QC input, and separate exact G37H live approval.

## Recommendation

Close/merge/publish G37H-BLOCK1 after review and boundary verification. Do not run live verify until G37F start and G37G complete have run on Friday physical production, both batches are `completed_pending_verification`, and exact QC data is supplied.
