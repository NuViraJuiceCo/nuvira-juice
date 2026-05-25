# Phase G21D: Native Order-Safety Schema Parity PR Plan

Date: 2026-05-25

Status: planning only. No runtime code, entity schema, Builder publish, live command, sync, retry, repair, provider call, or live record mutation is included.

## 1. Goal

Define the smallest safe Customer App schema slice needed before native `safeSyncOrderUpdate` fixture testing and dark launch.

The current Customer App to Hub bridge remains transitional. The native Customer App backend cannot safely own operational order writes until the Customer App has:

- the lock/snapshot/idempotency fields currently enforced by Hub `ShopifyOrder`
- a native quarantine queue equivalent to Hub `OrderReviewQueue`
- a native event/write audit log equivalent to Hub `OrderSyncLog`
- a command/idempotency audit log equivalent to Hub `HubCommandLog`

Production, inventory, purchase order, recipe, and compliance schemas are intentionally out of this first order-safety slice.

## 2. Current Customer App Schema Inventory

| Entity | Path | Relevant fields present | Gap/risk |
| --- | --- | --- | --- |
| `Order` | `base44/entities/Order.jsonc` | Customer-facing order status, status_history, address fields, Stripe checkout/payment intent ids, payment flags, production/delivery display status. | Customer-facing. Do not use as the operational safeSync write target without a projection contract. |
| `ShopifyOrder` | `base44/entities/ShopifyOrder.jsonc` | Shopify ids, source_channel, customer fields, line_items, fulfillment/payment/production status, tags, internal/customer notes, workflow_checklist, raw Shopify payload. | Partial operational model. Missing lock, snapshot, structured Hub address, Stripe event ids, fulfillments array, audit trail, data quality, repair, and subscription occurrence fields. Existing admin UI may read/write some fields directly. |
| `FulfillmentTask` | `base44/entities/FulfillmentTask.jsonc` | order id, customer email, fulfillment number/date, items, status, notes. | Too small for Hub driver/production parity; not in first order-safety slice except references from `ShopifyOrder`/queue/logs. |
| `OrderSyncLog` | `base44/entities/OrderSyncLog.jsonc` | order_number, status, hub_order_id, matched_hub_order_id, hub_action, description, started/completed timestamps, triggered_by. | Hub-sync-shaped. Missing native safeSync event fields: source, event type, Stripe event id, order id, action, reason, fields updated/rejected, success/error. |
| `OrderReviewQueue` | absent | none | Required for native quarantine before safeSync live mode. |
| `HubCommandLog` / `CommandLog` | absent | none | Required for native command idempotency/audit before migrated admin/ops commands become final. |
| `Notification` | `base44/entities/Notification.jsonc` | idempotency_key and customer notification metadata. | Existing customer-facing notification model; not part of order-safety schema PR. |
| `CustomerMessageDeliveryLog` | `base44/entities/CustomerMessageDeliveryLog.jsonc` | idempotency_key, channel, provider, provider message id, status, metadata. | Notification idempotency model exists; do not conflate with order command/event logs. |
| `OperationalAlert` | `base44/entities/OperationalAlert.jsonc` | alert_type, order fields, severity, resolution state. | Useful admin alert, not a replacement for OrderReviewQueue because it lacks incoming payload, incident idempotency, and review metadata. |
| `Subscription` | `base44/entities/Subscription.jsonc` | Stripe subscription id/customer id, hub sync status/response fields. | Subscription source of truth exists but still contains Hub sync fields. Native safeSync must protect subscription order occurrences separately. |
| `PendingSubscriptionCheckout` | `base44/entities/PendingSubscriptionCheckout.jsonc` | pending checkout, subscription, address, production/delivery dates, products, hub_payload, status. | Source fixture for subscription safeSync tests; not first schema target. |
| `DeliveryApprovalRequest` | `base44/entities/DeliveryApprovalRequest.jsonc` | zone, address, approval, Stripe authorization, created order/subscription fields, audit_trail. | Its zone/delivery fields inform `ShopifyOrder` parity but should not be changed in G21D. |
| `DriverActionLog` | `base44/entities/DriverActionLog.jsonc` | order/action/status/proof/drop/sync metadata. | Driver parity later; not first order-safety slice. |

## 3. Hub Schema Comparison

### Hub ShopifyOrder fields needed for order-safety parity

Customer App already has basic Shopify/order/payment fields, but the following Hub fields are missing and relevant to native `safeSyncOrderUpdate`:

| Field group | Fields | Why needed |
| --- | --- | --- |
| Classification | `order_type`, `fulfillment_mode`, `source_type`, `customer_order_date` | Controls POS/one-time/subscription/multi-delivery handling and source behavior. |
| Native linkage | `internal_customer_id`, `customer_app_user_id`, `base44_order_id` parity confirmation | Prevents ambiguous customer/order identity during consolidation. |
| Structured address | `address_line1`, `address_line2`, `address_city`, `address_state`, `address_postal_code`, `address_country`, `delivery_notes`, `address_last_synced_from`, `address_last_synced_at` | Required for address completeness gate, blank-overwrite protection, and provenance. |
| Fulfillment occurrences | `fulfillments`, `fulfillment_instance_date`, `fulfillment_sequence_number`, `subscription_parent_id`, `source_invoice_id` | Required for subscription hard lock, production snapshot, and multi-delivery fixture tests. |
| Production safety | `production_snapshot`, `production_date`, `selected_delivery_date`, `delivery_window_label`, `order_lock_status`, `order_status`, `operational_visibility`, `data_quality_status`, `last_verified_at` | Required for frozen fields, production scheduled/in-production locks, and quality quarantine. |
| Stripe/idempotency | `stripe_customer_id`, `stripe_checkout_session_id`, `stripe_payment_intent_id`, `stripe_invoice_id`, `stripe_subscription_id`, `stripe_charge_id`, `stripe_event_id_applied`, `stripe_created_event_type`, `last_reconciliation_at` | Required for matching, duplicate-event skip, refund/reconciliation, and subscription hard lock. |
| Repair/audit | `sync_status`, `last_sync_at`, `repair_status`, `repair_timestamp`, `repair_method`, `manual_override`, `manual_override_at`, `manual_override_by`, `audit_trail` | Required for safe repair, manual override guard, and audit trails. |
| Delivery/zone | `delivery_zone_key`, `delivery_zone_name`, `delivery_zone_type`, `delivery_fee`, `minimum_order`, `distance_miles`, `drive_time_minutes`, `approval_request_id`, `approval_status`, `approved_delivery_fee`, `route_review_required`, `origin_address` | Needed for later delivery/zone parity; can be optional in G21D if adding full order-safety fields together. |
| Delivery proof | `delivery_photo_url`, `delivery_drop_location`, `delivered_by`, `delivered_at` | Needed before driver/delivery native cutover; can remain optional. |

### Hub OrderSyncLog fields needed

Missing from Customer App `OrderSyncLog`:

- `sync_timestamp`
- `sync_source`
- `event_type`
- `stripe_event_id`
- `order_id`
- `customer_email`
- `action`
- `reason`
- `fields_updated`
- `fields_rejected`
- `incoming_data_completeness`
- `success`
- `error`

Recommendation: extend existing `OrderSyncLog` rather than create a separate successor first, because existing retry/diagnostic code already references `OrderSyncLog`. Keep legacy Hub-sync fields optional for backward compatibility.

### Hub OrderReviewQueue entity needed

Customer App is missing this entity. Required minimum fields:

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

All fields should be admin-only. `incoming_payload` is operational audit data and must not be customer-facing.

### HubCommandLog equivalent needed

Recommended new entity name: `CommandLog`.

Reason: the final backend is not Hub, but existing Hub command-log semantics should survive. If compatibility imports require it, a later read alias can map Hub-origin records.

Minimum fields:

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
- `payload`
- `result`
- `error_code`
- `error_message`
- `idempotency_key`
- `idempotent_skipped`
- `request_id`
- `submitted_at`
- `started_at`
- `completed_at`
- `duration_ms`
- `function_name`
- `related_stripe_event_id`
- `related_order_id`
- `related_order_number`
- `notes`

`payload` and `result` must be safe metadata only; runtime command contracts should not log raw provider payloads, secrets, stack traces, full raw order records, or customer-facing notification bodies.

## 4. Minimal Schema Slice Recommendation

Recommended option: Option B, add only order-safety fields and logs needed for native `safeSyncOrderUpdate` fixtures.

Proposed first schema PR:

1. Extend `base44/entities/ShopifyOrder.jsonc` with missing optional order-safety fields:
   - lock/snapshot/manual override
   - structured address/provenance
   - Stripe ids/event id
   - source/order classification
   - fulfillment occurrences
   - data quality/sync/repair/audit fields
   - optional delivery zone/proof fields for future parity
2. Extend `base44/entities/OrderSyncLog.jsonc` with native safeSync fields while preserving existing Hub-sync fields.
3. Add `base44/entities/OrderReviewQueue.jsonc`.
4. Add `base44/entities/CommandLog.jsonc`.

Do not include:

- `ProductionBatch`
- `InventoryItem`
- `PurchaseOrder`
- `Recipe`
- `IngredientYield`
- compliance logs
- FulfillmentTask parity expansion
- runtime functions
- UI
- automations

## 5. Backward Compatibility Rules

| Proposed change | Default/required behavior | Compatibility assessment |
| --- | --- | --- |
| New `ShopifyOrder` fields | All optional unless already required in current Customer App schema. Defaults only where safe and non-semantic, such as booleans defaulting false. | Existing records continue to validate; existing UI should ignore unknown optional fields. |
| `order_lock_status` | Optional initially; future native safeSync may default to `unlocked` on create. | Do not make required until all existing records have a migration/backfill. |
| `production_snapshot` | Optional object. | Safe if no runtime reads it yet. |
| `fulfillments` | Optional array. | Safe if not required; do not confuse with Customer App `FulfillmentTask` until service contract lands. |
| Stripe id fields | Optional strings. | Safe; many current records may not have every id. |
| `audit_trail` | Optional array. | Safe; future commands append only safe metadata. |
| Extend `OrderSyncLog` | New fields optional; keep current required `order_number` and `status`. | Existing retry/diagnostic code keeps working. |
| Add `OrderReviewQueue` | New entity; required fields mirror Hub minimum. | No existing code uses it until native safeSync/dashboards are built. |
| Add `CommandLog` | New entity with required `command_type`, `command_source`, `status`. | No existing code uses it until native commands are migrated. |

## 6. Builder / Git Registration Notes

Observed repo pattern: entity schemas are versioned as `base44/entities/*.jsonc` in both repos.

Known uncertainty:

- Whether Base44 Builder requires entity creation through the Builder UI before Git-authored new entities become available in a published app.
- Whether adding fields to an existing entity via Git is enough for Builder schema registration without manual sync steps.
- Whether new required fields on existing entities trigger validation problems for existing records.

Planning decision:

- G21D implementation should add only optional fields to existing entities.
- New entities may have required fields because they have no existing records, but implementation should verify Builder registration before any runtime use.
- Do not publish if Builder preflight shows unrelated pending changes.
- Do not enable runtime functions against these schemas until post-publish schema availability is verified.

## 7. Migration / Backfill Needs

No backfill is required for the first schema PR because all added `ShopifyOrder` and `OrderSyncLog` fields should be optional.

Backfill will be needed later for:

- `order_lock_status` defaulting to `unlocked` or current lifecycle-derived lock.
- `source_type`, `order_type`, and `fulfillment_mode`.
- structured address fields when only legacy address strings exist.
- `stripe_event_id_applied` from historical Stripe/order logs if possible.
- initial `data_quality_status`.
- any imported Hub `OrderReviewQueue`, `OrderSyncLog`, or `HubCommandLog` history.

Backfill must have a dry-run and sample audit before writing.

## 8. Validation Plan After Schema Implementation

After a future schema PR:

1. Run `git diff --check`.
2. Verify changed files are limited to approved entity schemas and docs.
3. Perform Builder publish preflight.
4. Publish only if pending Builder changes match the schema PR.
5. Verify schemas exist through safe admin/schema read checks if available.
6. Do not create live business records.
7. If a fake/test record is needed, create only after a separate fake-data approval.
8. Confirm no existing checkout, subscription, notification, sync, retry, repair, dashboard, or admin route starts writing new fields.
9. Confirm no automations trigger from schema-only changes.

## 9. Risks / Blockers

| Risk | Severity | Mitigation |
| --- | --- | --- |
| Builder may not register new entities from Git alone. | High | Schema PR audit must include Builder preflight before publish; hold if registration is unclear. |
| Existing Customer App UI may directly update `ShopifyOrder` fields. | Medium | New fields optional; no UI changes; runtime safeSync work later must replace direct writes. |
| `OrderSyncLog` currently means Hub sync, not native safeSync event log. | Medium | Extend existing log with optional native fields first; document semantic transition. |
| `CommandLog` vs `HubCommandLog` naming could affect import/read compatibility. | Medium | Use `CommandLog` for final-state clarity; preserve `HubCommandLog` import mapping in later migration. |
| Raw payload fields can expose sensitive data if surfaced incorrectly. | Medium | Keep admin-only RLS; runtime response/log contracts must not dump raw provider payloads. |
| Making new fields required would break existing records. | High | First schema PR must keep extensions optional. |

## 10. Implementation Recommendation

Recommendation: implement a schema-only PR next, but do not enable any runtime behavior.

Exact proposed files for the schema PR:

- modify `base44/entities/ShopifyOrder.jsonc`
- modify `base44/entities/OrderSyncLog.jsonc`
- add `base44/entities/OrderReviewQueue.jsonc`
- add `base44/entities/CommandLog.jsonc`
- optionally add a short docs note under `docs/migration/` if audit needs a schema checklist

Required implementation constraints:

- entity/schema files only
- no functions
- no UI/routes
- no automations
- no live records
- no publish until audit and Builder preflight pass
- no native safeSync runtime use until G21E/G21F fixture and dry-run phases

Hold conditions before schema implementation:

- if Builder requires manual entity creation and cannot safely sync Git-authored entities
- if `CommandLog` naming must be owner-decided before implementation
- if any field is proposed as required on an existing entity
- if schema publication shows unrelated Builder changes

## 11. G21D Planning Confirmation

This phase did not modify runtime code, schemas, Builder state, or live records. It did not process orders, refunds, sync, retry, repair, Stripe, Shopify, Customer App Order, ShopifyOrder, FulfillmentTask, ProductionBatch, InventoryItem, OrderReviewQueue, OrderSyncLog, CommandLog, compliance, notification, route, proof, or delivery state.
