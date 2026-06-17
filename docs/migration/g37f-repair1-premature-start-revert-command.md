# G37F-REPAIR1: Premature production start revert command

## Purpose

Add an exact default-off repair path to revert the premature native production start for `NV-MQHJR3V2`.

This PR prepares the repair command path only. It does not run live repair, open gates, or mutate live records.

## Incident context

G37F started two exact native `ProductionBatch` rows before physical production had actually started. Owner correction confirms physical production is expected Friday, `2026-06-19`.

Current native state from G37F-RECON1:

- two exact `ProductionBatch` rows exist
- both are `in_production`
- both have `actual_start_time=2026-06-17T16:59:27.000Z`
- both have `started_by` present
- both have `actual_units=null`
- both have `actual_end_time=null`
- no completion metadata
- no verification metadata
- no compliance log id
- inventory deduction is held
- rows are unlocked
- `BatchComplianceLog` count is `0`
- Customer App Order remains scheduled/paid
- native ShopifyOrder remains paid/pending/awaiting production
- native FulfillmentTask remains pending/awaiting production

G37F-RECON1 recommended Option A: exact correction back to `planned`.

## Implementation target

Patched existing deployed function:

- `startNativeProductionBatchesForCustomerApp`

No new Base44 function is added.

Added exact repair scope:

- `REVERT_PREMATURE_START_TO_PLANNED`

The existing start behavior remains intact under its existing confirmation and policy.

## Exact target rows

| Product | ProductionBatch id | deterministic batch_id | planned_units |
| --- | --- | --- | ---: |
| Hydration Shot | `6a32c1de2fd3943a9cf171a8` | `NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT` | 3 |
| Radiance Shot | `6a32c1de87810fd871f131c5` | `NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT` | 3 |

Order context:

| Field | Value |
| --- | --- |
| order_number | `NV-MQHJR3V2` |
| Customer App Order | `6a321cbfd8d78863f15de956` |
| native ShopifyOrder | `6a321d38a3819cdd5cf89031` |
| native FulfillmentTask | `6a321d38071327f8218b958b` |
| production_date | `2026-06-19` |
| delivery_date | `2026-06-20` |

## Current-state precondition

A future live repair must find both exact rows in this state:

- `status=in_production`
- `actual_start_time=2026-06-17T16:59:27.000Z`
- `started_by` present
- `actual_units=null`
- `actual_end_time=null`
- no `completed_by`
- no `verified_at`
- no `verified_by`
- no `compliance_log_id`
- no matching `BatchComplianceLog`
- rows unlocked

If any current-state precondition fails, the command fails closed with `writes_performed:false`.

## Target state

A future approved repair may update only the two exact rows to:

- `status=planned`
- `actual_start_time=null`
- `started_at=null`
- `started_by=null`
- safe audit metadata appended

The command must not change:

- `actual_units`
- `actual_end_time`
- completion metadata
- verification metadata
- compliance log linkages
- order/task/customer-facing state

## Gate, policy, and confirmation

The repair path uses the existing start-production gate family:

- `ENABLE_NATIVE_PRODUCTION_BATCH_START`
- `NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH`
- `NATIVE_PRODUCTION_BATCH_START_ALLOWED_EMAILS`
- `NATIVE_PRODUCTION_BATCH_START_ORDER_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_START_POLICY`

Repair-specific policy:

- `EXACT_REVERT_PREMATURE_START_TO_PLANNED_NO_NOTIFICATION`

Repair-specific confirmation:

- `revert_premature_production_start_to_planned_no_notification`

Required no-op policies:

- `notification_policy=NO_NOTIFICATION`
- `provider_call_policy=NO_PROVIDER_CALLS`
- `hub_mutation_policy=NO_HUB_MUTATION`
- `inventory_deduction_policy=HELD`
- `purchase_order_policy=HELD`

Any non-held or non-no-op policy fails closed.

## Allowed future writes

Only after separate exact approval, the repair may write:

1. Update exactly two `ProductionBatch` rows:
   - `6a32c1de2fd3943a9cf171a8`
   - `6a32c1de87810fd871f131c5`
2. Set status back to `planned`.
3. Clear premature start metadata:
   - `actual_start_time`
   - `started_at`
   - `started_by`
4. Append safe audit metadata.
5. Create/update one safe `CommandLog` for idempotency/audit.

## Forbidden writes and side effects

The repair path must not:

- create `ProductionBatch`
- create `BatchComplianceLog`
- write `actual_units`
- write `actual_end_time`
- write completion metadata
- write verification metadata
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
- run broad sync, repair, or replay
- process any other order or batch

## Idempotency and existing-state behavior

The repair command is request-id/idempotency-key governed.

Expected future behavior:

- first valid approved run updates exactly two rows and creates one `CommandLog`
- duplicate same request id skips with `writes_performed:false`
- no duplicate `CommandLog`
- if rows are already `planned` without a matching idempotency log, fail closed with `already_reverted_without_matching_idempotency_log`
- if one row is `planned` and one is `in_production`, fail closed with `partial_repair_state_detected`
- if any row is completed, verified, locked, or has compliance logs, fail closed
- if any row already has `actual_units` or `actual_end_time`, fail closed

## Response safety contract

The repair response includes safe fields only, including:

- `success`
- `skipped`
- `idempotent`
- `writes_performed`
- `repair_scope`
- `production_batch_updated`
- `production_batch_records_updated`
- `reverted_to_status`
- `cleared_actual_start_time`
- `cleared_started_by`
- `batch_compliance_log_created:false`
- `customer_app_order_updated:false`
- `native_shopify_order_updated:false`
- `native_fulfillment_task_updated:false`
- `inventory_deducted:false`
- `purchase_orders_created:false`
- `notifications_created:false`
- `notifications_sent:false`
- `provider_calls:false`
- `stripe_calls:false`
- `shopify_calls:false`
- `hub_records_updated:false`
- `sync_repair_replay_performed:false`
- `exact_repair_command_performed:true` only when the exact repair path runs
- `command_log_created`
- `error_code`

The response must not expose customer email, phone, full address, raw payloads, provider/payment payloads, secrets, or auth values.

## Test coverage

Added `scripts/migration/run-g37f-repair1-premature-start-revert-tests.mjs` covering:

- missing auth
- disabled gate
- missing confirmation
- policy mismatch
- wrong order/date/batch selection
- missing/extra batch ids
- wrong current status
- already planned without idempotency log
- partial planned/in-production state
- completed/verified/locked batches
- `BatchComplianceLog` present
- `actual_units` present
- `actual_end_time` present
- notification/provider/Hub/inventory/PO policy blockers
- valid in-memory repair updates exactly two rows to `planned`
- valid repair clears `actual_start_time` and `started_by`
- valid repair creates exactly one `CommandLog`
- duplicate request id skips
- no BatchComplianceLog, order/task, master-data, inventory/PO, provider, notification, or Hub writes
- no raw payload/PII in response/log

Regression coverage includes the existing G37F/G31O start harness to confirm standard start behavior remains intact.

## Live execution boundary

This PR is prep only.

Do not publish or run live repair until after PR audit/merge, scoped publish of only `startNativeProductionBatchesForCustomerApp`, gates-closed boundary verification, and a fresh read-only lifecycle preview.

After repair, rerun the lifecycle preview and wait until Friday `2026-06-19` to start production again with the real physical start time.

## Recommendation

Close/merge/publish G37F-REPAIR1 after audit if clean. Then request separate exact live repair approval only after boundary and fresh preview are clean.
