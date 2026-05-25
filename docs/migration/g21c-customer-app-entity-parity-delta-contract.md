# Phase G21C: Customer App Entity Parity Delta Contract

Date: 2026-05-25

Status: documentation-only schema parity contract. No entity schema, runtime code, Builder publish, live command, sync, provider call, or live record mutation is included in this phase.

## 1. Purpose

G21B documented that native `safeSyncOrderUpdate` cannot safely go live until the Customer App backend has enough operational data-model parity to preserve Hub guardrails.

G21C defines the entity deltas required for the Customer App backend to become the final operational source of truth. It does not implement those schema changes.

## 2. Entity Parity Summary

| Entity | Hub status | Customer App status | G21C decision |
| --- | --- | --- | --- |
| `ShopifyOrder` | Full operational order model. | Exists but only partial. | Add missing operational fields before native order writes. |
| `OrderSyncLog` | Full safe-sync audit log. | Exists but Hub-sync-shaped. | Expand or introduce successor log before native safeSync writes. |
| `OrderReviewQueue` | Required quarantine/manual review queue. | Missing. | Add before native safeSync live mode. |
| `FulfillmentTask` | Full operational task model. | Exists but partial. | Add missing driver/production/order linkage fields before fulfillment cutover. |
| `ProductionBatch` | Full production lifecycle record. | Missing. | Add before production lifecycle ownership migrates. |
| `HubCommandLog` | Command/idempotency/audit log. | Missing. | Add generalized `CommandLog` or preserve name for compatibility. |
| `BatchComplianceLog` | Production verification compliance log. | Missing. | Add before native verify/log production. |
| `SanitationLog` | Compliance log. | Missing. | Add before Hub compliance retirement. |
| `TemperatureLog` | Compliance log. | Missing. | Add before Hub compliance retirement. |
| `DailyChecklist` | Compliance checklist. | Missing. | Add before Hub compliance retirement. |
| `CorrectiveActionLog` | Compliance corrective action record. | Missing. | Add before Hub compliance retirement. |
| `Bundle` | Production bundle decomposition. | Missing. | Add or map from `SubscriptionBundle` with explicit parity rules. |
| `Recipe` | Product recipe formula. | Missing. | Add before native production demand/ingredient calculations. |
| `InventoryItem` | Inventory stock/master data. | Missing. | Add before native inventory preview/deduction. |
| `PurchaseOrder` | Procurement. | Missing. | Add before native procurement. |
| `IngredientYield` | Yield/conversion master data. | Missing. | Add before native ingredient math and deduction. |

## 3. ShopifyOrder Delta

Hub has 83 fields; Customer App currently has 38. The Customer App model must not become live operational source of truth until the missing Hub safety fields are present or intentionally replaced.

### Required Missing Fields For Native safeSync

| Field group | Missing Customer App fields | Why required |
| --- | --- | --- |
| Order classification | `order_type`, `fulfillment_mode`, `source_type`, `source_channel` parity details | Required for subscription/POS/one-time behavior and field ownership. |
| Customer App identity | `internal_customer_id`, `customer_app_user_id` | Required for native ownership and reconciliation. |
| Structured address | `address_line1`, `address_line2`, `address_city`, `address_state`, `address_postal_code`, `address_country` | Required for address quality gate and preservation rules. |
| Address provenance | `address_last_synced_from`, `address_last_synced_at` | Required for audit and repair decisions. |
| Fulfillment occurrences | `fulfillments`, `fulfillment_instance_date`, `fulfillment_sequence_number` | Required for subscription/multi-delivery and snapshot lock. |
| Production lock/snapshot | `production_snapshot`, `order_lock_status`, `production_date`, `selected_delivery_date`, `delivery_window_label` | Required for `LOCK_FROZEN_FIELDS` and production-scheduled protection. |
| Operational visibility | `order_status`, `operational_visibility`, `data_quality_status` | Required for dashboards and quarantine behavior. |
| Sync metadata | `sync_status`, `last_sync_at`, `last_reconciliation_at`, `repair_status`, `repair_timestamp`, `repair_method` | Required for logs, repair, and dark launch. |
| Stripe ids | `stripe_customer_id`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_invoice_id`, `stripe_subscription_id`, `stripe_charge_id`, `stripe_event_id_applied`, `stripe_created_event_type` | Required for idempotency, refunds, reconciliation, and subscription hard lock. |
| Subscription linkage | `subscription_parent_id`, `source_invoice_id` | Required for subscription cycles and invoice-created deliveries. |
| Delivery proof/status | `delivery_photo_url`, `delivery_drop_location`, `delivered_by`, `delivered_at` | Required before driver/delivery ownership cutover. |
| Manual override/audit | `manual_override`, `manual_override_at`, `manual_override_by`, `audit_trail` | Required for admin override guard and audit trail. |
| Zone/delivery economics | `delivery_zone_key`, `delivery_zone_name`, `delivery_zone_type`, `delivery_fee`, `minimum_order`, `distance_miles`, `drive_time_minutes`, `approval_request_id`, `approval_status`, `approved_delivery_fee`, `route_review_required`, `origin_address` | Required for zone approvals and final delivery operations if Hub fields remain authoritative. |

### Customer App Extra Fields To Preserve

Customer App has fields not present in Hub, including:

- `description`
- `requested_time_window`
- `shopify_fulfillment_status`
- `financial_status`
- `total_tax`
- `total_discounts`
- `tip_received`
- `discount_codes`
- `is_pos_order`
- `is_subscription`
- `subscription_cadence`
- `event_name`
- `event_date`
- `event_location`
- `assigned_driver`
- `workflow_checklist`
- `shopify_synced_at`
- `shopify_raw_payload`

These should not be dropped. The final native model should either keep them as Customer App-owned fields or map them into safe operational equivalents. `shopify_raw_payload` must not be exposed in admin previews or command logs unless a dedicated audit approves it.

## 4. OrderSyncLog Delta

Hub `OrderSyncLog` currently includes:

- `sync_timestamp`
- `sync_source`
- `event_type`
- `stripe_event_id`
- `order_id`
- `order_number`
- `customer_email`
- `action`
- `reason`
- `fields_updated`
- `fields_rejected`
- `incoming_data_completeness`
- `success`
- `error`

Customer App `OrderSyncLog` currently includes:

- `order_number`
- `status`
- `hub_order_id`
- `matched_hub_order_id`
- `hub_action`
- `description`
- `started_at`
- `completed_at`
- `triggered_by`

Decision:

- Keep existing Customer App fields for bridge history.
- Add native write/audit fields or create a successor `IntegrationEventLog`.
- The minimum native log must support:
  - event id / request id idempotency
  - source
  - action
  - order id/number
  - fields updated/rejected
  - success/error
  - safe reason/error code
  - timestamps
  - retry eligibility

## 5. OrderReviewQueue Required Entity

Customer App is missing `OrderReviewQueue`. Native safeSync cannot go live without it because quarantine is a core safety behavior.

Required fields from Hub:

- `incident_type`
- `customer_email`
- `customer_name`
- `existing_order_id`
- `existing_order_number`
- `existing_order_type`
- `incoming_payload`
- `incoming_source`
- `issue_description`
- `recommended_action`
- `admin_notes`
- `status`
- `resolved_action`
- `resolved_at`
- `resolved_by`
- `idempotency_key`
- `occurrence_count`
- `first_seen_at`
- `last_seen_at`
- `queue_visibility_status`
- `archived_at`
- `archived_by`
- `archived_reason`

Safety note:

- `incoming_payload` can contain customer/order context. It must be admin-only, never customer-facing, and never include secrets/auth headers/provider raw payloads beyond approved order payload details.

## 6. FulfillmentTask Delta

Customer App has a minimal `FulfillmentTask`; Hub has a full task model.

Missing Customer App fields needed before fulfillment/driver cutover:

- `customer_name`
- `customer_phone`
- `fulfillment_type`
- `time_window`
- `delivery_window_label`
- `scheduled_date`
- `production_date`
- `address`
- `delivery_address`
- `address_line1`
- `address_line2`
- `address_city`
- `address_state`
- `address_postal_code`
- `assigned_driver`
- `items_summary`
- `order_number`
- `source_type`
- `stripe_subscription_id`
- `customer_app_subscription_id`
- `payment_status`
- `plan_id`
- `plan_name`
- `cadence`
- `driver_notes`
- `delivered_at`
- `delivery_photo_url`
- `delivery_drop_location`
- `delivery_status`
- `schedule_source`

Decision:

- Do not migrate driver/delivery writes until task parity is implemented and fixture-tested.
- Keep customer-facing delivery status projection separate from operational task status.

## 7. Production And Compliance Entities To Add

These Hub entities are missing from Customer App and are required for full Hub retirement:

| Entity | Required before |
| --- | --- |
| `ProductionBatch` | Native production start/complete/verify, production snapshot lock, ingredient usage, inventory deduction. |
| `BatchComplianceLog` | Native verify/log production. |
| `SanitationLog` | Native compliance module. |
| `TemperatureLog` | Native compliance module. |
| `DailyChecklist` | Native compliance module. |
| `CorrectiveActionLog` | Native compliance module and verification exceptions. |
| `CCPLog` / `pHLog` if retained | HACCP/quality parity. |

Implementation rule:

- Add schemas first.
- Backfill or import data in preview/dry-run.
- Only then move production lifecycle commands from Hub bridge into native Customer App backend.

## 8. Recipe, Bundle, Inventory, And Procurement Entities To Add

Missing Customer App entities:

- `Bundle`
- `Recipe`
- `IngredientYield`
- `InventoryItem`
- `PurchaseOrder`

Important make-to-order policy:

- Low or zero `InventoryItem.stock` is procurement-needed, not automatically a blocker for ingredient usage preview/correction.
- Actual inventory deduction still requires separate stock/negative-stock policy.

Native final flow requires:

1. Bundle decomposition.
2. Recipe ingredient math.
3. IngredientYield conversion.
4. Ingredient usage capture on production.
5. Procurement-needed preview.
6. Inventory deduction only under approved stock policy.

## 9. Command Logging Entity

Hub has `HubCommandLog`; Customer App currently does not.

Recommendation:

- Add generalized `CommandLog`.
- Preserve imported Hub records or support legacy `HubCommandLog` naming in read paths during migration.
- Minimum fields:
  - `command_id`
  - `command_type`
  - `command_source`
  - `status`
  - `target_entity`
  - `target_id`
  - `target_display_id`
  - `actor_email`
  - `actor_role`
  - `actor_type`
  - safe `payload`
  - safe `result`
  - `error_code`
  - `error_message`
  - `idempotency_key`
  - `idempotent_skipped`
  - `submitted_at`
  - `started_at`
  - `completed_at`
  - `duration_ms`
  - `function_name`
  - related order/Stripe ids when safe
  - `notes`

Do not log raw provider payloads, secrets, auth headers, stack traces, full raw order records, or customer-facing notification bodies.

## 10. Recommended Schema Migration Phases

### G21D: Native order safety schemas

Add or update:

- `ShopifyOrder`
- `OrderReviewQueue`
- `OrderSyncLog` or successor `IntegrationEventLog`
- `CommandLog`

Stop before live use. Include fixture-only tests and admin-only access rules.

### G21E: Native task/fulfillment parity schemas

Add or update:

- `FulfillmentTask`
- occurrence-level subscription fulfillment fields
- driver action log linkage if needed

### G21F: Native production/compliance schemas

Add:

- `ProductionBatch`
- `BatchComplianceLog`
- compliance logs
- audit fields

### G21G: Native recipe/inventory/procurement schemas

Add:

- `Bundle`
- `Recipe`
- `IngredientYield`
- `InventoryItem`
- `PurchaseOrder`

## 11. Validation Requirements Before Any Schema PR

For each entity PR:

- changed-file scope must be limited to approved entity schemas and docs
- no runtime writer can start using new fields until a separate command PR
- no Builder publish if pending changes include unrelated runtime/UI work
- fixture tests must define migration expectations before live backfill
- existing data must be preserved
- imported/legacy records must remain distinguishable from native-created records

## 12. Hard Stops

Stop before implementation if:

- a field has ambiguous semantics between Customer App and Hub
- a field may expose secrets, provider payloads, or customer-facing proof/drop evidence
- RLS/admin visibility cannot be safely defined
- migration requires bulk backfill without a dry-run plan
- live Customer App order status projection would change
- any schema change would force existing customer-facing pages to interpret new operational statuses

## 13. Documentation-Only Confirmation

This phase does not:

- modify runtime code
- modify schemas
- publish Builder
- run endpoints/wrappers
- mutate live records
- call Stripe, Shopify, providers, sync, retry, repair, or recalculation
- change Customer App order write behavior
