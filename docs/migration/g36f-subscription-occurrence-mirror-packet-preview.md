# G36F — Subscription Occurrence Native ShopifyOrder Mirror Packet Preview

## 1. Executive summary

G36F adds a read-only preview for a proposed native `ShopifyOrder` mirror packet for one exact Hub subscription occurrence. It does not create a native ShopifyOrder, Customer App Order, FulfillmentTask, ProductionBatch, BatchComplianceLog, log, queue, notification, inventory record, PurchaseOrder, or Hub record.

The only supported runtime path is:

```text
previewNativeOrderCutoverReadiness
preview_mode=SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET
mode=EXACT_OCCURRENCE_MIRROR_PACKET
```

Hub remains the subscription source of truth. The packet exists to make the future write contract auditable before any gated command is planned.

## 2. G36D source evidence

The initial G36F target is the G36D-approved read-only occurrence:

```text
hub_subscription_id=SUB-1TPMGCIR
parent_order_number=#SUB-1TPMGCIR
hub_order_id=69ed51368b5ca93c33a1b0b4
delivery_date=2026-05-09
selected_hub_fulfillment_task_id=69ffb0c9fedc8bbefc7710da
ignored_duplicate_hub_fulfillment_task_id=69f509d5a1bea46cdce8e274
payment_status=paid
fulfillment_status=delivered
line_item_count=1
line_item_interpretation=subscription bundle/package count
decomposed_production_item_count=held_for_later
known cancellation/refund issue=no
known repair/replay issue=no
customer_app_cancelled_mirror_treatment=stale_artifact_for_this_preview_only
```

G36D proved, read-only, that:

- exact occurrence identity can be resolved for this selected Hub task
- the duplicate Hub task is ignored only by owner decision for preview context
- Hub selected task payment status is authoritative as `paid` for the read-only preview
- line item count is interpreted as one subscription bundle/package
- production decomposition is held
- Customer App cancelled parent mirror is treated as a stale artifact for this preview only
- no native ShopifyOrder exists for the occurrence
- no native FulfillmentTask exists for the occurrence
- no native ProductionBatch exists for the occurrence

## 3. Preview contract

Required inputs:

```text
preview_mode=SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET
mode=EXACT_OCCURRENCE_MIRROR_PACKET
hub_subscription_id
parent_order_number
hub_order_id
delivery_date
selected_hub_fulfillment_task_id
ignored_duplicate_hub_fulfillment_task_id
payment_status
fulfillment_status
line_item_count
line_item_interpretation
decomposed_production_item_count
known_cancellation_refund_issue
known_repair_replay_issue
customer_app_cancelled_mirror_treatment
request_id
```

Expected response shape:

- `success`
- `dry_run:true`
- `writes_performed:false`
- `preview_mode: SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET`
- `mode: EXACT_OCCURRENCE_MIRROR_PACKET`
- `hub_source_of_truth:true`
- `mirror_packet_ready:true/false`
- `proposed_native_shopify_order_packet`
- `schema_supported_fields`
- `omitted_fields`
- `held_records`
- `existing_record_checks`
- `duplicate_risk`
- `blockers`
- `warnings`
- `next_action`

## 4. Proposed native ShopifyOrder packet

The packet uses only schema-supported top-level `ShopifyOrder` fields. Unsupported subscription-occurrence details are carried in `audit_trail` as safe admin metadata or omitted.

Schema-safe top-level fields include:

```text
shopify_order_number
source_channel=subscription
source_type=subscription_occurrence_hub_preview
order_type=subscription
fulfillment_mode=single_delivery
fulfillment_method=delivery
requested_delivery_date
assigned_delivery_date
selected_delivery_date
fulfillment_instance_date
payment_status=paid
financial_status=paid
fulfillment_status=fulfilled
shopify_fulfillment_status=fulfilled
production_status=fulfilled
operational_visibility=historical_preview
sync_status=native_subscription_occurrence_preview_g36f
data_quality_status=preview_only_hub_source_of_truth_owner_approved_occurrence
is_subscription=true
subscription_parent_id
line_items
tags
internal_notes
audit_trail
```

Important schema mappings:

| Requested concept | Packet value | Reason |
| --- | --- | --- |
| `source_channel=hub_subscription_occurrence` | `source_channel=subscription` | `source_channel` enum supports `subscription`, not `hub_subscription_occurrence`. |
| `order_type=subscription_occurrence` | `order_type=subscription` | `order_type` enum supports `subscription`, not `subscription_occurrence`. |
| `production_status=historical_fulfilled` | `production_status=fulfilled` | `production_status` enum supports `fulfilled`, not `historical_fulfilled`. |

## 5. Omitted fields

G36F intentionally omits:

- `shopify_order_id` because there is no Shopify order and no provider lookup is allowed
- top-level `hub_subscription_id`, `hub_order_id`, selected task id, ignored duplicate task id, line item interpretation, duplicate resolution, and cancelled mirror treatment when the `ShopifyOrder` schema does not support those top-level fields
- raw Hub payloads
- raw Shopify payloads
- raw Stripe/payment payloads
- customer email, phone, address, proof/drop/route fields, or other broad PII
- notification payloads
- Customer App Order creation fields
- native FulfillmentTask creation fields
- ProductionBatch or BatchComplianceLog materialization fields

## 6. Held records

The preview always holds:

- Customer App Order
- native FulfillmentTask
- ProductionBatch
- BatchComplianceLog
- OrderSyncLog
- CommandLog
- OrderReviewQueue
- Notification
- CustomerMessageDeliveryLog
- Hub records
- proof/drop/route context
- inventory and PurchaseOrder state

No provider calls are made. No sync, repair, retry, or replay is run.

## 7. Duplicate checks

The preview checks for existing or duplicate context before declaring `mirror_packet_ready:true`:

- existing native ShopifyOrder for the occurrence/order/subscription context
- existing native FulfillmentTask for the occurrence/order/subscription context
- existing native ProductionBatch context
- owner-selected ignored duplicate Hub task context
- Customer App parent mirror context

If an existing native ShopifyOrder is found, the preview returns a dedupe/blocker instead of proposing a create packet.

## 8. Schema blockers

The preview returns `schema_packet_blocker` if owner-approved values cannot be safely mapped to the current `ShopifyOrder` schema or G36F policy. Examples:

- unsupported fulfillment status for the historical mirror packet
- unsupported line item interpretation
- production decomposition not held
- missing or non-authoritative payment status
- missing selected Hub task id
- selected Hub task cannot be resolved

## 9. No-write policy

G36F is read-only. It must not:

- create native ShopifyOrder
- create Customer App Order
- create native FulfillmentTask
- create ProductionBatch
- create BatchComplianceLog
- create OrderSyncLog
- create CommandLog
- create OrderReviewQueue
- create notifications or message logs
- call Stripe, Shopify, Hub mutation endpoints, or providers
- send notifications
- run sync, retry, repair, or replay
- deduct inventory
- create PurchaseOrders

## 10. Next phase options

If `mirror_packet_ready:true` and there are no blockers, the next phase may be:

```text
G36G — gated native ShopifyOrder subscription occurrence mirror command PR prep
```

G36G should still be default-off and should not run live without exact owner approval.

Held until later:

- native FulfillmentTask mirror
- production decomposition
- ProductionBatch materialization
- delivery lifecycle
- notifications
- cancellation/refund automation
- broad subscription automation

## 11. Recommendation

Close G36F after the read-only packet preview is live-verified. If the packet is clean, plan G36G as a PR-prep-only gated native ShopifyOrder mirror command. Keep Hub as subscription source of truth.
