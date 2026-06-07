# G31N — Native Production Lifecycle Start / Complete / Verify Preview

Status: PR prep

## Purpose

G31N adds an admin/internal read-only preview for native Customer App `ProductionBatch` lifecycle readiness after exact native batch materialization.

For the exact order `NV-MPZNKGNT`, G31M created six planned native `ProductionBatch` rows. G31N answers whether those batches are ready for later separately approved lifecycle actions:

- start production
- complete production
- verify/log production

This phase does not execute any lifecycle write.

## Scope and safety

Read-only only:

- no `ProductionBatch` update
- no start / complete / verify action
- no `BatchComplianceLog` creation
- no `ComplianceAlert` / corrective-action / sanitation / temperature / checklist creation
- no Customer App Order mutation
- no native `ShopifyOrder` mutation
- no native `FulfillmentTask` mutation
- no inventory deduction
- no `PurchaseOrder`
- no provider/payment/notification calls
- no sync/retry/repair/replay
- Hub bridge remains fallback

The preview returns `writes_performed: false` and a safety block confirming no write side effects.

## Schema audit summary

### `ProductionBatch`

Current Customer App schema supports lifecycle-relevant fields:

- identity: `id`, `batch_id`, `product_name`, `production_date`
- plan: `planned_units`, `order_sources`, `related_orders`, `source_system`, `native_owner_status`
- lifecycle: `status`, `actual_start_time`, `actual_end_time`, `started_by`, `completed_by`, `actual_units`
- production detail: `staff_on_duty`, `ingredients_used`, `bottles_produced`, `bottles_rejected_or_wasted`, `final_usable_quantity`, `storage_location`, `use_by_date`
- verification/compliance: `pH_result`, `pH_passed_failed`, `passed_failed`, `ccp_check_complete`, `verified_by`, `verified_at`, `compliance_log_id`, `ccp_log_id`, `corrective_action_log_id`, `sanitation_log_id`
- safety/audit: `is_locked`, `audit_trail`, `command_log_ids`
- migration/holds: `ingredient_usage_status`, `procurement_needed`, `inventory_deduction_status`, `inventory_deduction_log_id`

### `BatchComplianceLog`

Schema supports a later verification log with:

- `date`
- `batch_id`
- `juice_flavor`
- `ingredients`
- `start_time`
- `end_time`
- `quantity_produced`
- `staff_on_duty`
- `pH_result`
- `passed_failed`
- `verified_by`
- `verified_at`
- `source_production_batch_id`
- `locked`

Required fields include `date`, `batch_id`, `juice_flavor`, `quantity_produced`, and `passed_failed`.

### Related entities

- `FulfillmentTask` and `ShopifyOrder` have lifecycle/status fields, but G31N only previews downstream cascade readiness. It does not mutate either record.
- `ComplianceAlert`, `CorrectiveActionLog`, `SanitationLog`, `TemperatureLog`, and `DailyChecklist` remain read-only context/out-of-scope for this phase.
- `CommandLog` is not created by this preview.

## Preview contract

Function: `previewNativeProductionBatchLifecycle`

Auth:

- admin auth, or
- internal preview secret

Inputs:

- `order_number`
- optional `production_date`
- optional `batch_ids`
- optional `customer_app_order_id`
- optional `native_shopify_order_id`
- optional `native_fulfillment_task_id`
- optional `request_id`

Reads:

- Customer App Order
- native `ShopifyOrder`
- native `FulfillmentTask`
- native `ProductionBatch`
- existing `BatchComplianceLog` context

Response includes:

- `batch_lifecycle_rows`
- `start_preview`
- `complete_preview`
- `verify_preview`
- `compliance_preview`
- `cascade_preview`
- `blockers`
- `warnings`
- `next_action`
- `hub_fallback_required`
- `safety`

## Expected G31M/G31N classification for `NV-MPZNKGNT`

Because all six native batches are currently `planned`:

- start preview: likely ready for all six planned batches
- complete preview: blocked until batches are `in_production` and actual completion data exists
- verify preview: blocked until batches are completed and compliance fields exist
- compliance log creation: held
- task/order cascade: held
- inventory deduction: held
- PurchaseOrder automation: held
- Hub fallback: still visible

Inventory stock shortfalls, deferred Black Salt/Beetroot yield details, and deferred stock-unit conversion do not block start preview.

## Later phases

Possible next phases after G31N:

1. G31O: gated exact native Start Production command for `NV-MPZNKGNT` batches.
2. G31P: gated exact native Complete Production command with actual units and staff/completion data.
3. G31Q: gated exact native Verify/Compliance Log command.
4. Separate preview/approval for task pack cascade and ShopifyOrder bottled cascade.

Each live phase must remain exact-target, gated, idempotent, and separately approved.
