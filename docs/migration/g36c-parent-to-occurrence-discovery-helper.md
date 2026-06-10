# G36C-HELPER Subscription Parent-to-Occurrence Discovery

## 1. Purpose

G36C-HELPER adds a read-only helper to discover exact subscription occurrence candidates from a parent subscription/order context. It exists because G36B recent scan found only subscription parent candidates, and G36C documented that parent identity is not enough for G36D exact occurrence preview.

The helper is discovery-only. It lists safe occurrence candidate identifiers, missing fields, blockers, and an owner-ready G36D approval block only when exactly one clean candidate is found. If multiple candidates are found, it does not auto-select. If no candidates are found, it returns the exact fields still needed and keeps subscription migration held.

Hub remains the subscription / multi-delivery operational source of truth.

## 2. Implementation

The helper extends the existing read-only function:

```text
previewNativeOrderCutoverReadiness
preview_mode=SUBSCRIPTION_PARENT_TO_OCCURRENCE_DISCOVERY
```

No standalone Base44 function is added.

## 3. Inputs

Supported inputs:

```text
preview_mode=SUBSCRIPTION_PARENT_TO_OCCURRENCE_DISCOVERY
customer_label
subscription_id
hub_subscription_id
customer_app_subscription_id
parent_order_number
order_number
shopify_order_number
customer_app_order_id
date_from
date_to
fulfilled_only
max_candidates
request_id
```

`customer_label` is an operator display/search hint only. It is not a matching key. If only `customer_label` is supplied, the helper returns `exact_parent_identifier_required` and asks for subscription or parent order identifiers.

## 4. Matching policy

Allowed matching keys:

- `subscription_id`
- `hub_subscription_id`
- `customer_app_subscription_id`
- `parent_order_number` / `order_number`
- `customer_app_order_id`
- date range as supporting filter only

Forbidden matching keys:

- customer name
- customer email
- phone number
- address
- fuzzy customer identity
- raw Stripe payload
- raw Shopify payload
- webhook signatures
- auth headers
- provider dashboard data containing customer PII

The helper may use an internal subscription provider key already present in local records to query an approved read-only Hub detail helper, but it does not echo that raw provider id in the response.

## 5. Read surfaces

The helper reads only:

- Customer App `Subscription`
- Customer App `Order`
- native `ShopifyOrder`
- native `FulfillmentTask`
- safe Hub fulfillment task detail helper when configured

It does not perform broad Hub scans. It does not call Stripe, Shopify, or providers. It does not mutate Hub records.

## 6. Response contract

Response includes:

```text
success
dry_run:true
writes_performed:false
preview_mode:SUBSCRIPTION_PARENT_TO_OCCURRENCE_DISCOVERY
hub_source_of_truth:true
input_quality
parent_identity_status
identifiers
parent_context
candidate_count
g36d_ready_candidate_count
candidate_rows
owner_ready_g36d_approval_block
blockers
warnings
next_action
provider_call_impact:false
notification_impact
safety
```

Each candidate row includes safe admin fields only:

```text
candidate_id
source
subscription_id
hub_subscription_id if explicitly supplied
customer_app_subscription_id
occurrence_id
order_number
hub_order_id
hub_fulfillment_task_id
customer_app_order_id
native_shopify_order_id
native_fulfillment_task_id
delivery_date
occurrence_status
payment_status
fulfillment_status
line_item_count
customer_app_parent_present
hub_occurrence_present
native_order_present
native_task_present
duplicate_risk
cancellation_refund_risk
repair_replay_risk
occurrence_identity_status
g36d_ready
classification
missing_fields
blockers
warnings
next_action
```

The helper does not return customer email, phone, address, raw provider payloads, or provider payment ids.

## 7. Parent identity classifications

The helper returns one of:

- `exact_parent_identifier_present`
- `parent_identifier_insufficient`
- `customer_label_only_not_sufficient`
- `ambiguous_parent_context`
- `no_parent_context_found`

If the parent identity is insufficient, candidate count remains `0`, and next action is:

```text
provide_subscription_or_parent_order_identifier
```

## 8. G36D readiness

A candidate may set `g36d_ready:true` only if it has:

- `subscription_id` or explicitly supplied `hub_subscription_id`
- `occurrence_id` OR exact `delivery_date + order_number`
- `order_number` or `hub_order_id`
- `delivery_date`
- `payment_status`
- `fulfillment_status`
- positive `line_item_count`
- known cancellation/refund issue state
- known repair/replay issue state

If missing required data, the helper returns `g36d_ready:false` plus exact missing fields and blockers.

Candidate classifications include:

- `g36d_ready_exact_occurrence_candidate`
- `missing_occurrence_id`
- `missing_delivery_date`
- `missing_order_number`
- `missing_payment_status`
- `missing_fulfillment_status`
- `missing_line_items`
- `duplicate_occurrence_risk`
- `cancellation_refund_risk`
- `repair_replay_risk`
- `insufficient_for_g36d`
- `hub_source_of_truth_hold`

## 9. Owner-ready approval block

If exactly one clean G36D-ready candidate is found, the response includes:

```text
APPROVE G36D EXACT SUBSCRIPTION OCCURRENCE PREVIEW

subscription_id=
hub_subscription_id=
customer_app_subscription_id=
occurrence_id=
order_number=
hub_order_id=
delivery_date=
hub_fulfillment_task_id=
customer_app_order_id=
native_shopify_order_id=
native_fulfillment_task_id=
payment_status=
fulfillment_status=
line_item_count=
known cancellation/refund issue=
known repair/replay issue=
notes=
```

This block approves only a future read-only G36D exact preview. It does not approve subscription writes.

## 10. Multiple/no candidate behavior

If multiple candidates are found:

- do not auto-select
- return the candidate table
- set next action to owner/admin selection
- omit the owner-ready G36D approval block until one exact candidate is chosen

If no candidates are found:

- return `candidate_count:0`
- return `exact_fields_still_needed`
- include `no_occurrence_candidates_found` when parent identity was otherwise valid
- keep subscription migration held
- ask for exact subscription/occurrence/order/task identifiers

## 11. No-write policy

G36C-HELPER does not:

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
- open gates
- disable Hub fallback

## 12. Test coverage

The local harness covers:

1. `customer_label` only blocks and does not call Hub.
2. exact `hub_subscription_id` returns occurrence candidates.
3. exact parent id plus one fulfilled Hub task returns one G36D-ready candidate.
4. one clean candidate returns an owner-ready G36D approval block.
5. multiple candidates require owner/admin selection and do not auto-select.
6. no candidates return exact fields still needed and keep migration held.
7. missing occurrence identity blocks G36D readiness.
8. missing delivery date blocks G36D readiness.
9. `fulfilled_only:true` filters scheduled/non-fulfilled candidates.
10. `fulfilled_only:false` includes scheduled candidates.
11. duplicate Hub or native task rows for the same order/date return duplicate risk and are not G36D-ready.
12. cancellation/refund ambiguity blocks G36D readiness.
13. repair/replay ambiguity blocks G36D readiness.
14. missing line items block G36D readiness.
15. local native mirrors can support discovery context when Hub read config is absent.
16. customer PII and internal subscription provider ids are not returned.
17. no provider calls, notifications, or writes occur.

## 13. Recommended next step

After G36C-HELPER is merged and published, run the helper only as read-only discovery for the known fulfilled subscription context referenced by the operator if exact parent identifiers are available. If the helper finds exactly one clean candidate, use its owner-ready approval block to run G36D exact subscription occurrence preview.

Do not plan subscription writes until G36D exact preview proves a clean occurrence with no duplicate task, production demand, refund/cancellation, notification, provider, Hub mutation, or repair/replay risk.
