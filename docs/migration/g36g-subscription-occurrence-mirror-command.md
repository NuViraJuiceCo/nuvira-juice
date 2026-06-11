# G36G — Gated Subscription Occurrence Native ShopifyOrder Mirror Command

## 1. Executive summary

G36G adds a default-off gated command that can later create exactly one native `ShopifyOrder` mirror for one exact Hub subscription occurrence, using the G36F read-only mirror packet preview.

This PR prep does not run the live command. It does not publish the new function in this phase.

Command function:

```text
createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp
```

Confirmation phrase:

```text
create_native_subscription_occurrence_shopify_order_mirror_no_notification
```

Hub remains the subscription source of truth. G36G creates no Customer App Order, no native FulfillmentTask, no ProductionBatch, no BatchComplianceLog, no notification, no OrderSyncLog, no OrderReviewQueue, no inventory change, no PurchaseOrder, and no Hub mutation.

## 2. Target occurrence

The initial approved context comes from G36D and G36F:

```text
hub_subscription_id=SUB-1TPMGCIR
parent_order_number=#SUB-1TPMGCIR
hub_order_id=69ed51368b5ca93c33a1b0b4
delivery_date=2026-05-09
selected_hub_fulfillment_task_id=69ffb0c9fedc8bbefc7710da
ignored_duplicate_hub_fulfillment_task_id=69f509d5a1bea46cdce8e274
payment_status=paid
financial_status=paid
fulfillment_status=fulfilled
production_status=fulfilled
line_item_count=1
line_item_interpretation=subscription bundle/package count
decomposed_production_item_count=held_for_later
customer_app_cancelled_mirror_treatment=stale_artifact_for_this_preview_only
```

## 3. Gate contract

Required gate names:

```text
ENABLE_NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_KILL_SWITCH
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_ALLOWED_EMAILS
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_SUBSCRIPTION_ALLOWLIST
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_ORDER_ALLOWLIST
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_TASK_ALLOWLIST
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_POLICY
```

Required policy:

```text
EXACT_SUBSCRIPTION_OCCURRENCE_MIRROR_ONLY_NO_NOTIFICATION
```

Default behavior:

- disabled unless `ENABLE_NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR=true`
- kill switch blocks when `NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_KILL_SWITCH=true`
- actor email must be allowlisted
- exact subscription allowlist required
- exact order or Hub order allowlist required
- exact selected Hub task allowlist required
- no broad subscription automation
- no wildcard/bulk allowlists

## 4. Required inputs

A future live call must include:

```text
hub_subscription_id
parent_order_number
hub_order_id
delivery_date
selected_hub_fulfillment_task_id
ignored_duplicate_hub_fulfillment_task_id
payment_status=paid
fulfillment_status=fulfilled
line_item_count=1
line_item_interpretation=subscription bundle/package count
customer_app_cancelled_mirror_treatment=stale_artifact_for_this_preview_only
notification_policy=NO_NOTIFICATION
provider_call_policy=NO_PROVIDER_CALLS
hub_mutation_policy=NO_HUB_MUTATION
request_id
confirmation=create_native_subscription_occurrence_shopify_order_mirror_no_notification
```

Optional policy-context fields:

```text
financial_status=paid
production_status=fulfilled
decomposed_production_item_count=held_for_later
known_cancellation_refund_issue=no
known_repair_replay_issue=no
```

## 5. Fresh G36F preview requirement

Before any create, the command invokes:

```text
previewNativeOrderCutoverReadiness
preview_mode=SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET
mode=EXACT_OCCURRENCE_MIRROR_PACKET
```

The command fails closed unless the fresh preview returns:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `mirror_packet_ready:true`
- `blockers:[]`
- `schema_packet_blockers:[]`
- selected task id matches
- ignored duplicate task id matches
- `payment_status:paid`
- `line_item_count:1`
- `line_item_interpretation:subscription bundle/package count`
- cancelled mirror treatment matches
- `provider_call_impact:false`
- notifications held
- Hub mutation false
- no existing native ShopifyOrder
- no existing native FulfillmentTask

## 6. Native ShopifyOrder create contract

The command writes only schema-safe `ShopifyOrder` fields.

Expected top-level fields:

```text
shopify_order_number=#SUB-1TPMGCIR
source_channel=subscription
source_type=subscription_occurrence_hub_mirror
order_type=subscription
fulfillment_mode=single_delivery
fulfillment_method=delivery
requested_delivery_date=2026-05-09
assigned_delivery_date=2026-05-09
selected_delivery_date=2026-05-09
fulfillment_instance_date=2026-05-09
customer_order_date=2026-05-09
payment_status=paid
financial_status=paid
fulfillment_status=fulfilled
shopify_fulfillment_status=fulfilled
production_status=fulfilled
order_lock_status=fulfilled
order_status=historical_subscription_occurrence_mirror
operational_visibility=historical_subscription_occurrence_mirror
sync_status=native_subscription_occurrence_mirror_g36g
data_quality_status=g36g_exact_occurrence_owner_approved_hub_source_of_truth
is_subscription=true
subscription_parent_id=SUB-1TPMGCIR
line_items=[{ title: subscription bundle/package, quantity:1 }]
tags
internal_notes
audit_trail
```

Unsupported occurrence-specific fields are stored only as safe `audit_trail` metadata, not forced into top-level schema fields.

## 7. Omitted fields and raw payload policy

The command must not write:

- raw Hub payload
- raw Shopify payload
- raw Stripe/payment payload
- customer email
- customer phone
- full address
- proof/drop/route fields
- provider IDs unless schema-required and already safe
- notification payloads
- Customer App Order fields
- FulfillmentTask fields
- unsupported top-level fields from G36F

## 8. Idempotency

Idempotency key:

```text
native_subscription_occurrence_shopify_order_mirror_create:<hub_subscription_id>:<hub_order_id>:<selected_hub_fulfillment_task_id>:<request_id>
```

Behavior:

- matching success/skipped CommandLog returns skipped/idempotent success
- native ShopifyOrder already created by the same request returns skipped/idempotent success
- existing native ShopifyOrder from another source returns safe conflict/dedupe
- failed prior CommandLog is not treated as success
- duplicate request does not create a second native ShopifyOrder
- no duplicate notifications
- no duplicate queue/log side effects beyond the one safe CommandLog contract

## 9. Allowed writes

Only after all gates and validation pass:

1. One native `ShopifyOrder` mirror.
2. One safe `CommandLog`.

No other write is allowed.

## 10. Explicitly held records and behaviors

Always held:

- Customer App Order
- native FulfillmentTask
- ProductionBatch
- BatchComplianceLog
- OrderSyncLog
- OrderReviewQueue
- Notification
- CustomerMessageDeliveryLog
- Hub records
- InventoryItem
- PurchaseOrder
- provider calls
- Stripe calls
- Shopify calls
- notification sends
- sync/repair/replay

## 11. Live execution requirements

Live execution requires a separate explicit owner approval, a fresh G36F preview, exact allowlists, gates enabled, kill switch off, and the required confirmation phrase.

G36G PR prep does not approve live execution.

## 12. Recommendation

Merge G36G as PR prep only. Do not publish or run a valid live command until an owner explicitly approves G36H for this one historical/admin native ShopifyOrder mirror. Keep Hub as subscription source of truth.
