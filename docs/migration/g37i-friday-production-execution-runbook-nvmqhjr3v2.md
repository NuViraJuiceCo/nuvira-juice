# G37I: Friday production execution runbook for NV-MQHJR3V2

## 1. Executive summary

This is the Friday production execution runbook for exact order `NV-MQHJR3V2`.

All native production lifecycle commands needed for this sequence have been retargeted for the exact order and boundary-verified with gates closed:

1. G37F start production.
2. G37G complete production.
3. G37H verify/QC.
4. Post-verify cascade preview only.

Live actions require exact owner approval at each step. Inventory deduction, PurchaseOrder automation, notifications, provider calls, Stripe/Shopify calls, Hub mutation, broad sync, repair, and replay remain held unless separately approved by a later exact phase.

This G37I packet is docs-only. It does not run lifecycle commands, open gates, publish Base44, or mutate records.

## 2. Target context

Order and native records:

- order number: `NV-MQHJR3V2`
- Customer App Order: `6a321cbfd8d78863f15de956`
- native ShopifyOrder: `6a321d38a3819cdd5cf89031`
- native FulfillmentTask: `6a321d38071327f8218b958b`
- production date: `2026-06-19`
- delivery date: `2026-06-20`

ProductionBatch rows:

| Product | ProductionBatch id | Planned units | Expected current status before Friday start |
|---|---|---:|---|
| Hydration Shot | `6a32c1de2fd3943a9cf171a8` | 3 | `planned` |
| Radiance Shot | `6a32c1de87810fd871f131c5` | 3 | `planned` |

## 3. Pre-flight state checklist

Before any Friday live command, confirm:

- both exact `ProductionBatch` rows exist
- both rows are status `planned`
- `actual_start_time` is null
- `actual_units` is null
- `actual_end_time` is null
- `BatchComplianceLog` count for the exact rows is `0`
- Customer App Order is unchanged
- native ShopifyOrder is unchanged
- native FulfillmentTask is unchanged
- gates are closed before starting the live step setup
- no existing `CommandLog` exists for the new request id
- inventory deduction remains held
- PurchaseOrder automation remains held
- notifications remain held
- provider calls remain held
- Hub mutation remains held

If any item is not true, stop and run a read-only reconciliation before opening any gate.

## 4. Step 1 — G37F start production

Run G37F only when physical production actually starts. Do not estimate the start time.

### Approval template

```text
APPROVE G37F EXACT START PRODUCTION NV-MQHJR3V2

order_number=NV-MQHJR3V2
customer_app_order_id=6a321cbfd8d78863f15de956
native_shopify_order_id=6a321d38a3819cdd5cf89031
native_fulfillment_task_id=6a321d38071327f8218b958b
production_date=2026-06-19
selected_production_batch_ids=6a32c1de2fd3943a9cf171a8,6a32c1de87810fd871f131c5
actual_start_time=<REAL_PHYSICAL_START_ISO_TIMESTAMP>
started_by=<approved admin actor>
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
inventory_deduction_policy=HELD
purchase_order_policy=HELD
```

### Required pre-start preview

Run a read-only lifecycle preview before the live start command. Required result:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `batch_count:2`
- `start_ready_count:2`
- both exact batches present
- both exact batches status `planned`
- blockers empty for start
- inventory deduction held
- PurchaseOrder held
- notifications held
- provider impact false
- Hub mutation false

### Expected live writes

Only after separate exact live approval, G37F may write:

1. Update exactly the two target `ProductionBatch` rows to `in_production` or the schema-canonical started status.
2. Write the real `actual_start_time` if supported.
3. Write safe started-by/audit metadata if supported.
4. Create one safe `CommandLog`.

### G37F forbidden actions

G37F must not:

- complete production
- verify production
- create `ProductionBatch`
- create `BatchComplianceLog`
- update Customer App Order
- update native ShopifyOrder
- update native FulfillmentTask
- mutate Recipe, InventoryItem, IngredientYield, Bundle, or Product
- deduct inventory
- create PurchaseOrder
- send notifications or create message logs
- call providers, Stripe, or Shopify
- mutate Hub records
- run sync, repair, or replay

## 5. Step 2 — G37G complete production

Run G37G only after physical production is actually complete. Do not estimate the completion time. Do not infer actual units from planned units unless the production operator confirms those exact actuals.

Known expected values:

- Hydration Shot actual units: `3`
- Radiance Shot actual units: `3`
- completed_by: `Kiran Kahlon; Kirandeep Gill`
- variance notes: `none`
- actual_end_time: real completion time required

### Approval template

```text
APPROVE G37G EXACT COMPLETE PRODUCTION NV-MQHJR3V2

order_number=NV-MQHJR3V2
customer_app_order_id=6a321cbfd8d78863f15de956
native_shopify_order_id=6a321d38a3819cdd5cf89031
native_fulfillment_task_id=6a321d38071327f8218b958b
production_date=2026-06-19
selected_production_batch_ids=6a32c1de2fd3943a9cf171a8,6a32c1de87810fd871f131c5
actual_units=Hydration Shot:3,Radiance Shot:3
actual_end_time=<REAL_COMPLETION_ISO_TIMESTAMP>
completed_by=Kiran Kahlon; Kirandeep Gill
variance_notes=none
inventory_deduction_policy=HELD
purchase_order_policy=HELD
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
```

### Required pre-complete preview

Run a read-only lifecycle preview before the live complete command. Required result:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- both exact batches present
- both exact batches status `in_production`
- `actual_start_time` present on both exact batches
- complete-ready count is `2` when preview supports supplied actuals
- if the preview does not accept actuals, the only completion blocker should be missing actual-unit input
- no unexpected lifecycle blockers
- inventory deduction held
- PurchaseOrder held
- notifications held
- provider impact false
- Hub mutation false

### Expected live writes

Only after separate exact live approval, G37G may write:

1. Update exactly the two target `ProductionBatch` rows.
2. Write `actual_units` for Hydration Shot and Radiance Shot.
3. Write `actual_end_time` and `completed_by` if supported.
4. Set status to `completed_pending_verification` or the schema-canonical completed status.
5. Create one safe `CommandLog`.

### G37G forbidden actions

G37G must not:

- create `BatchComplianceLog`
- verify/QC production
- create `ProductionBatch`
- update Customer App Order
- update native ShopifyOrder
- update native FulfillmentTask
- mutate Recipe, InventoryItem, IngredientYield, Bundle, or Product
- deduct inventory
- create PurchaseOrder
- send notifications or create message logs
- call providers, Stripe, or Shopify
- mutate Hub records
- run sync, repair, or replay

## 6. Step 3 — G37H verify/QC

Run G37H only after QC data exists. Do not infer QC values.

### Approval template

```text
APPROVE G37H EXACT VERIFY PRODUCTION QC NV-MQHJR3V2

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

### Required pre-verify preview

Run a read-only lifecycle preview before the live verify command. Required result:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- both exact batches present
- both exact batches status `completed_pending_verification` or schema-canonical completed state
- `verify_ready_count:2` if supported
- `BatchComplianceLog` count is `0` before verify
- exact QC values are supplied and accepted by preview where supported
- no unexpected lifecycle blockers
- inventory deduction held
- PurchaseOrder held
- notifications held
- provider impact false
- Hub mutation false

### Expected live writes

Only after separate exact live approval, G37H may write:

1. Update exactly the two target `ProductionBatch` rows to `verified_logged` or schema-canonical verified status.
2. Create exactly two locked/safe `BatchComplianceLog` rows, one per exact batch.
3. Create one safe `CommandLog`.

### G37H forbidden actions

G37H must not:

- create `ProductionBatch`
- start or complete production
- update Customer App Order
- update native ShopifyOrder
- update native FulfillmentTask
- mutate Recipe, InventoryItem, IngredientYield, Bundle, or Product
- deduct inventory
- create PurchaseOrder
- send notifications or create message logs
- call providers, Stripe, or Shopify
- mutate Hub records
- run sync, repair, or replay
- pack, bottle, deliver, or update customer-facing status

## 7. Step 4 — Post-verify cascade preview only

After G37H succeeds, run read-only previews only:

- verify cascades preview
- customer status impact preview
- delivery workflow readiness preview
- pack/bottle readiness preview if available

Do not run any of the following without separate exact approval:

- pack FulfillmentTask
- bottle ShopifyOrder
- delivery workflow command
- customer status update
- notification send
- provider call
- Hub mutation
- inventory deduction
- PurchaseOrder automation

## 8. Gate shutdown checklist for every live step

After each live write:

1. Run the same command again with the same request id to prove idempotency.
2. Disable the enable gate.
3. Reactivate the kill switch.
4. Reset the actor allowlist.
5. Reset the order allowlist.
6. Reset the batch allowlist if present.
7. Reset policy to disabled or nonmatching.
8. Run a disabled-boundary check.
9. Verify no forbidden entities were created or mutated.
10. Record the post-live read-only preview result.

No next lifecycle step should start until the prior step has completed this shutdown checklist.

## 9. Request-id naming convention

Use unique UTC timestamps in these request ids:

- `g37f_start_production_nvmqhjr3v2_<timestamp>`
- `g37g_complete_production_nvmqhjr3v2_<timestamp>`
- `g37h_verify_qc_nvmqhjr3v2_<timestamp>`

Boundary and preview request ids should use distinct prefixes so no-write verification can separate live command attempts from read-only previews.

## 10. Hard stops

Stop immediately if any of these occur:

- physical production has not actually started
- `actual_start_time` is estimated
- `actual_end_time` is estimated
- `actual_units` are inferred instead of confirmed
- QC values are missing
- any preview blocker appears unexpectedly
- any batch id differs from the exact approved ids
- any batch is locked unexpectedly
- `BatchComplianceLog` already exists before verify
- inventory deduction behavior appears
- PurchaseOrder behavior appears
- provider, Stripe, or Shopify behavior appears
- notification behavior appears
- Hub mutation behavior appears
- any unexpected write occurs
- any gate remains open after the live step
- any disabled-boundary check returns a success path instead of a closed-gate response

## 11. No-write confirmation for G37I

G37I is docs-only. It does not:

- change runtime code
- publish Base44
- open gates
- run live commands
- update `ProductionBatch`
- create `BatchComplianceLog`
- update Customer App Order
- update native ShopifyOrder
- update native FulfillmentTask
- mutate master data
- deduct inventory
- create PurchaseOrder
- send notifications
- call providers, Stripe, or Shopify
- mutate Hub records
- run sync, repair, or replay

## 12. Recommendation

Hold until physical production starts on Friday, `2026-06-19`. Then run G37F only with the real physical `actual_start_time`. After G37F closes cleanly, proceed to G37G only after physical production completes and exact actuals are confirmed. Proceed to G37H only after QC data exists. Keep post-verify cascade work preview-only until separately approved.
