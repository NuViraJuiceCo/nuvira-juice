# G33C-MIRROR1 — One-Time Native Mirror / Task Parity Preview

## Purpose

G33C-MIRROR1 adds a read-only preview for paid one-time Customer App orders that are missing native `ShopifyOrder` and/or native `FulfillmentTask` records.

The immediate target is `NV-MP5SOQLJ`, which G33C classified as:

```text
paid_but_native_mirror_missing
```

This preview determines whether a future exact native mirror/task recovery path can be planned safely. It does not create records.

## Runtime target

Existing function:

```text
previewNativeOrderCutoverReadiness
```

Preview mode:

```text
ONE_TIME_NATIVE_MIRROR_TASK_PARITY
```

Mode:

```text
EXACT_ORDER_PREVIEW
```

No standalone Base44 function is added. This respects the current Base44 function-count constraint.

## Inputs

```json
{
  "preview_mode": "ONE_TIME_NATIVE_MIRROR_TASK_PARITY",
  "mode": "EXACT_ORDER_PREVIEW",
  "order_number": "NV-MP5SOQLJ",
  "customer_app_order_id": "6a060df457fc07751f3c7ded",
  "request_id": "g33c_mirror_parity_preview_nvmp5soqlj_<timestamp>"
}
```

## Read-only source audit

The preview reads safe local context only:

- Customer App `Order`
- native `ShopifyOrder`
- native `FulfillmentTask`
- `OrderSyncLog`
- `OrderReviewQueue`
- `CommandLog`
- `SafeSyncParityLog`

It returns only admin-safe summaries.

It does not return:

- raw payloads
- auth headers
- secrets
- provider payloads
- Stripe/Shopify payment identifiers
- customer email
- customer phone
- full address
- proof/drop/route payloads

For contact/address data, the preview returns completeness booleans rather than values.

## Missing native reason classifications

Possible classifications include:

- `native_ops_gate_disabled`
- `native_ops_not_triggered`
- `native_ops_validation_blocked`
- `native_ops_source_unsupported`
- `native_ops_payment_context_missing`
- `native_ops_delivery_context_missing`
- `native_ops_duplicate_hub_dedupe_only`
- `native_record_missing_but_preview_safe`
- `native_record_missing_requires_review`
- `unknown_missing_native_reason`

For `NV-MP5SOQLJ`, the expected classification is likely tied to Hub bridge dedupe context unless live evidence differs.

## Native ShopifyOrder preview packet

The preview returns:

- whether a native `ShopifyOrder` would be created by a future command
- proposed schema-safe field packet
- proposed source/order/fulfillment/payment/status values
- line item count
- safe line item summary
- delivery/production dates if schema-safe
- omitted unsafe fields
- blockers/warnings

Expected safety flags:

```text
raw_payload_included:false
provider_call_impact:false
notification_impact.notification_held:true
writes_performed:false
```

## Native FulfillmentTask preview packet

The preview returns:

- whether a native `FulfillmentTask` would be created by a future command
- schema-safe field packet
- task status / delivery status / production status preview
- delivery and production dates
- address completeness boolean
- line item count and summary
- blockers/warnings

If the native `ShopifyOrder` does not exist yet, the preview must return:

```text
task_create_depends_on_native_shopify_order
```

That dependency is not treated as a runtime error.

## Lifecycle safety classification

The preview classifies whether the order appears to be:

- operationally active pre-native-ops
- already bottled/packed through Hub context
- completed/historical/admin mirror only

For orders already `bottled_packed`, the preview should preserve Hub fallback and avoid recommending production lifecycle commands.

For delivered/completed orders, the preview should recommend historical/admin mirror only.

## Eligibility output

The preview returns:

- `eligible_for_second_controlled_pilot`
- `eligible_for_native_mirror_command_planning`
- `eligible_for_native_task_command_planning`
- `recommended_pilot_type`
- `blockers`
- `warnings`
- `next_action`

Recommended pilot types include:

- `none_hold`
- `mirror_preview_only`
- `historical_native_mirror_only`
- `exact_native_mirror_task_recovery_preview`
- `second_controlled_order_pilot_candidate`

## No-write policy

G33C-MIRROR1 does not:

- create native `ShopifyOrder`
- create native `FulfillmentTask`
- update Customer App `Order`
- mutate Hub records
- run safeSync writer
- run `processMay30NativeOrderOps`
- run sync/retry/repair/replay
- call Stripe
- call Shopify
- call providers
- send notifications
- create `ProductionBatch`
- create `BatchComplianceLog`
- deduct inventory
- create PurchaseOrders
- open gates
- disable Hub bridge

Hub remains active.

## Next phase options

If `NV-MP5SOQLJ` returns clean mirror readiness and task dependency only:

1. Plan exact native mirror/task recovery command PR prep.
2. Do not run live write without owner approval.
3. Keep Hub active.
4. Do not run production/delivery lifecycle commands until native order/task recovery is separately approved and previewed.

If the order is already completed through Hub/customer-facing state:

- classify as historical/admin mirror only.

If blockers appear:

- hold and resolve blockers before any command planning.
