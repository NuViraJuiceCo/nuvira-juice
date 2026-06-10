# G36B Subscription Occurrence Parity Preview

## Purpose

G36B adds a read-only subscription occurrence parity preview. The preview compares one exact subscription occurrence across Customer App parent/mirror context, native operational records if present, and safe Hub fulfillment-task context when configured.

This phase does not make Customer App the subscription source of truth. Hub remains the operational source of truth for subscription / multi-delivery fulfillment, delivery tasks, and production demand.

## Source-of-truth policy

Current policy carried forward from G36A:

- Customer App owns checkout/account-facing parent subscription records.
- Hub owns operational subscription occurrences, Hub `FulfillmentTask` rows, production demand, and subscription batch impact.
- Native one-time migration paths intentionally block subscription / multi-delivery writes.
- Subscription refund/cancellation, notification, production, delivery, inventory, and PurchaseOrder automation remain held.

G36B is preview-only. It does not create subscriptions, orders, tasks, batches, logs, queues, notifications, provider calls, or Hub mutations.

## Implementation

The preview is implemented by extending the existing deployed read-only function:

```text
previewNativeOrderCutoverReadiness
preview_mode: SUBSCRIPTION_OCCURRENCE_PARITY
```

A standalone Base44 function was not added.

## Inputs

Supported input fields:

```text
preview_mode=SUBSCRIPTION_OCCURRENCE_PARITY
mode=EXACT_OCCURRENCE_PREVIEW | RECENT_SUBSCRIPTION_OCCURRENCE_SCAN
subscription_id
customer_app_subscription_id
hub_subscription_id
stripe_subscription_id
order_number
hub_order_id
occurrence_id
fulfillment_number
fulfillment_task_id
hub_fulfillment_task_id
delivery_date
production_date
customer_app_order_id
native_shopify_order_id
request_id
limit
```

Exact occurrence preview should provide as many exact identifiers as possible. Parent subscription id alone is not enough for a multi-delivery occurrence.

## Occurrence identity model

The preview separates:

- subscription parent
- order/operational parent
- delivery occurrence
- fulfillment task
- production demand context

Safe matching keys:

- subscription id / Customer App subscription id
- Stripe subscription id presence for local exact matching, without returning raw provider ids broadly
- order number
- Hub order id
- occurrence id
- fulfillment number
- fulfillment task id
- native ShopifyOrder id
- Customer App Order id
- delivery date / production date

The preview does not match by customer name, customer email, phone number, address, or fuzzy customer PII.

## Response contract

Response includes:

```text
success
dry_run:true
writes_performed:false
preview_mode:SUBSCRIPTION_OCCURRENCE_PARITY
mode
identifiers
customer_app_subscription_present
hub_subscription_present
customer_app_parent_order_present
hub_occurrence_present
native_shopify_order_present
native_fulfillment_task_present
hub_fulfillment_task_present
occurrence_identity_status
parity_classification
production_demand_impact
delivery_task_impact
cancellation_refund_risk
notification_impact
duplicate_risk
provider_call_impact:false
hub_source_of_truth:true
blockers
warnings
next_action
safety
```

## Classifications

Supported classifications:

- `hub_source_of_truth_subscription_occurrence`
- `customer_app_parent_only_hub_occurrence_present`
- `hub_occurrence_missing_customer_app_context`
- `native_occurrence_missing`
- `native_task_missing`
- `native_task_present_read_only`
- `duplicate_occurrence_risk`
- `subscription_occurrence_identity_ambiguous`
- `unsupported_subscription_multi_delivery`
- `no_action_hub_only_context`
- `preview_ready_for_exact_occurrence_pilot`
- `not_applicable_no_subscription_context`

## Blockers

Preview blockers include:

- `no_exact_subscription_occurrence_identity`
- `subscription_occurrence_identity_ambiguous`
- `missing_delivery_date`
- `duplicate_task_risk`
- `duplicate_occurrence_risk`
- `refund_cancellation_ambiguity`
- `missing_line_items`
- `missing_hub_occurrence_when_hub_source_of_truth`
- `production_demand_duplication_risk`

A blocker means no native subscription write path should be planned from the preview.

## Warnings

Common warnings include:

- `hub_remains_source_of_truth`
- `customer_app_native_writes_held`
- `notifications_held`
- `refund_cancellation_held`
- `production_delivery_native_automation_held`
- `occurrence_preview_only`
- `no_live_command_available`
- `hub_read_not_configured_local_preview_only`

## Recent scan mode

`RECENT_SUBSCRIPTION_OCCURRENCE_SCAN` returns a small local candidate list without customer PII. It does not perform broad Hub reads. It is intended only to help find a candidate for a future exact preview.

## No-write policy

G36B does not:

- create or update subscriptions
- create or update Customer App Orders
- create or update native ShopifyOrder records
- create or update FulfillmentTask records
- create or update ProductionBatch or BatchComplianceLog records
- create OrderReviewQueue, OrderSyncLog, CommandLog, notification, or message rows
- call Stripe, Shopify, or providers
- send notifications
- run sync/retry/repair/replay
- mutate Hub records
- open gates or disable Hub fallback

## Recommended next phase

Keep Hub as subscription source of truth.

Next safe step after G36B closeout is either:

1. run exact read-only previews for a clean real subscription occurrence if exact identifiers are available, or
2. hold subscription migration and continue one-time order generalization.

Do not plan a native subscription occurrence write command until G36B previews prove exact occurrence identity, no duplicate task/demand risk, stable Hub context, and explicit owner approval.
