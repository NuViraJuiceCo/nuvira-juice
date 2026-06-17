# G37F-RECON1: Premature production start reconciliation packet

## Executive summary

G37F live start production was executed for `NV-MQHJR3V2`, but owner correction confirms physical production has not started yet. Expected physical production date is Friday, `2026-06-19`.

Native state currently shows both exact `ProductionBatch` rows as `in_production` with `actual_start_time` `2026-06-17T16:59:27.000Z`. That timestamp is ahead of physical reality.

This packet is read-only/docs-only. No correction is executed here.

Recommended decision:

- **Option A — correct both exact batches back to `planned`**, clear start metadata where schema-safe, then rerun start production on Friday with the real physical `actual_start_time`.

## Target context

Order and native ids:

| Field | Value |
| --- | --- |
| order_number | `NV-MQHJR3V2` |
| Customer App Order | `6a321cbfd8d78863f15de956` |
| native ShopifyOrder | `6a321d38a3819cdd5cf89031` |
| native FulfillmentTask | `6a321d38071327f8218b958b` |
| production_date | `2026-06-19` |
| delivery_date | `2026-06-20` |

Affected ProductionBatch rows:

| Product | ProductionBatch id | deterministic batch_id | planned_units |
| --- | --- | --- | ---: |
| Hydration Shot | `6a32c1de2fd3943a9cf171a8` | `NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT` | 3 |
| Radiance Shot | `6a32c1de87810fd871f131c5` | `NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT` | 3 |

## Read-only audit

Audit request id:

- `g37f_recon1_premature_start_audit_nvmqhjr3v2_20260617T175521Z`

The audit read only safe fields from `ProductionBatch`, related order/task records, compliance logs, and read-only lifecycle preview output.

No raw provider payloads, customer PII, payment payloads, secrets, or auth values are included.

## Current ProductionBatch evidence

| Field | Hydration Shot | Radiance Shot |
| --- | --- | --- |
| ProductionBatch id | `6a32c1de2fd3943a9cf171a8` | `6a32c1de87810fd871f131c5` |
| status | `in_production` | `in_production` |
| planned_units | 3 | 3 |
| actual_units | null | null |
| production_date | `2026-06-19` | `2026-06-19` |
| actual_start_time | `2026-06-17T16:59:27.000Z` | `2026-06-17T16:59:27.000Z` |
| started_by present | true | true |
| actual_end_time | null | null |
| completed_by present | false | false |
| verified_at present | false | false |
| verified_by present | false | false |
| compliance_log_id present | false | false |
| inventory_deduction_status | `held` | `held` |
| is_locked | false | false |

Interpretation:

- The only premature lifecycle state is native production start metadata on the two exact `ProductionBatch` rows.
- There is no evidence of completion, verification, compliance logging, inventory deduction, PO creation, delivery, packing, bottling, or customer status progression from the premature start.

## Compliance, order, task, notification, inventory, and PO evidence

BatchComplianceLog counts:

| Batch | count |
| --- | ---: |
| Hydration Shot | 0 |
| Radiance Shot | 0 |

Customer App Order safe summary:

| Field | Value |
| --- | --- |
| id | `6a321cbfd8d78863f15de956` |
| order_number | `NV-MQHJR3V2` |
| status | `scheduled_for_juicing` |
| payment_status | `paid` |
| fulfillment_status | null |
| production_status | null |
| delivery_status | null |

Native ShopifyOrder safe summary:

| Field | Value |
| --- | --- |
| id | `6a321d38a3819cdd5cf89031` |
| order_number | `NV-MQHJR3V2` |
| payment_status | `paid` |
| fulfillment_status | `pending` |
| production_status | `awaiting_production` |

Native FulfillmentTask safe summary:

| Field | Value |
| --- | --- |
| id | `6a321d38071327f8218b958b` |
| order_number | `NV-MQHJR3V2` |
| status | `pending` |
| payment_status | `paid` |
| production_status | `awaiting_production` |
| delivery_status | `pending` |

Request-id side-effect scan for the RECON1 audit request returned zero rows in:

- `OrderSyncLog`
- `CommandLog`
- `OrderReviewQueue`
- `Notification`
- `CustomerMessageDeliveryLog`
- `PurchaseOrder`
- `ManualProductionBatch`
- `SafeSyncParityLog`
- `OperationalAlert`
- `ComplianceAlert`

## Lifecycle preview evidence

Read-only lifecycle preview from the same audit returned:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `batch_count:2`
- `start_ready_count:0`
- `complete_ready_count:0`
- `verify_ready_count:0`
- `blockers:[]`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- `hub_fallback_required:true`

Per-row preview state:

| Product | current_status | can_start | can_complete | can_verify | next step | complete blockers |
| --- | --- | --- | --- | --- | --- | --- |
| Hydration Shot | `in_production` | false | false | false | complete | `missing_actual_units` |
| Radiance Shot | `in_production` | false | false | false | complete | `missing_actual_units` |

Interpretation:

- The preview sees the rows as started and awaiting completion data.
- Since physical production has not started, this state is semantically premature.
- The preview remains read-only and did not mutate records.

## Schema-supported pre-start status

The active native production lifecycle source treats `planned` and `ready_for_production` as startable pre-start statuses. The G37E materialization rows were created as `planned`, and G37F changed those rows from `planned` to `in_production`.

For this exact correction, the safest schema-canonical target is:

- `planned`

Rationale:

- It exactly restores the pre-G37F state.
- It is already proven as the materialized pre-start state for these rows.
- It allows the start command to be rerun later with the real physical start time.

## Decision options

### Option A — Correct back to planned

Recommended.

Future separate repair would:

- update only the two exact `ProductionBatch` rows
- set status back to `planned`
- clear `actual_start_time` if schema-safe
- clear `started_at` if present/schema-safe
- clear `started_by` if schema-safe
- append safe audit metadata or create one safe `CommandLog`
- leave all other records untouched

Allowed future repair writes would be limited to:

- `ProductionBatch.status`
- `ProductionBatch.actual_start_time`
- `ProductionBatch.started_at` if present/schema-safe
- `ProductionBatch.started_by`
- safe audit metadata / `command_log_ids` if contract requires
- one safe `CommandLog`

Forbidden future repair writes:

- `BatchComplianceLog`
- Customer App Order
- native ShopifyOrder
- native FulfillmentTask
- Recipe / InventoryItem / IngredientYield / Bundle / Product
- inventory deduction
- PurchaseOrder
- Notification / CustomerMessageDeliveryLog
- provider / Stripe / Shopify calls
- Hub mutation
- sync / repair / replay outside the exact approved repair command

### Option B — Leave `in_production` as an operational early-start marker

Not recommended.

This would require owner acceptance that native production start means something like “prepared/scheduled for production,” not actual physical production start. That would weaken lifecycle semantics and make later audit trails less precise.

### Option C — Hold until Friday and do not repair

Not recommended.

This avoids a repair write, but the records would continue to show production started on `2026-06-17` even though physical production is expected to start on `2026-06-19`.

Risk:

- incorrect lifecycle audit trail
- misleading admin production state
- potential confusion before completion/QC

## Recommended correction path

Proceed to a separate default-off exact repair phase:

- `G37F-REPAIR1: exact revert premature production start`

That phase should first audit or add a narrow gated repair command/path, then publish and boundary-verify it before any live repair.

Required repair behavior:

- default-off gates
- exact order allowlist
- exact batch allowlist
- exact current status precondition: `in_production`
- exact target status: `planned`
- no completion/QC/compliance writes
- no inventory/PO/notification/provider/Hub behavior
- request-id idempotency
- duplicate-safe behavior
- no raw payload/PII exposure

## Future repair approval template

```text
APPROVE G37F-REPAIR1 EXACT REVERT PREMATURE PRODUCTION START NV-MQHJR3V2

order_number=NV-MQHJR3V2
selected_production_batch_ids=6a32c1de2fd3943a9cf171a8,6a32c1de87810fd871f131c5
current_status=in_production
target_status=planned
reason=Physical production has not started yet; production is expected Friday 2026-06-19.
clear_actual_start_time=true
clear_started_by=true
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
inventory_deduction_policy=HELD
purchase_order_policy=HELD
```

Do not run this repair until the default-off gated command or approved safe repair path is audited, merged, published, boundary-verified, and separately approved.

## Future completion actuals handling

Treat the previously supplied completion values as future completion expectations only, not live completion approval.

Future expected actual units:

| Product | expected actual units |
| --- | ---: |
| Hydration Shot | 3 |
| Radiance Shot | 3 |

Future completion context:

- `completed_by=Kiran Kahlon; Kirandeep Gill`
- `variance_notes=none`
- `actual_end_time=PENDING_AFTER_REAL_PRODUCTION_COMPLETES`

Completion must remain held until physical production actually completes and a separate exact G37G approval is supplied.

## Hard stops

Do not:

- run G37G complete production
- verify/QC
- pack FulfillmentTask
- bottle ShopifyOrder
- deliver
- update customer status
- send notifications
- deduct inventory
- create PurchaseOrder
- mutate Hub records
- call providers, Stripe, or Shopify
- run broad sync/repair/replay
- mutate any live records in G37F-RECON1

## No-write confirmation

G37F-RECON1 performed read-only inspection and documentation only.

No records were mutated. No Base44 publish is needed.

Request-id side-effect scan returned zero rows for the RECON1 audit request across mutation/log surfaces checked.
