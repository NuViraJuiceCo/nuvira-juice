# G36C-RESOLVE: Subscription Occurrence Ambiguity Resolution

## Executive summary

G36C-RESOLVE adds a read-only ambiguity-resolution preview for subscription occurrence discovery. It exists because the G36C parent-to-occurrence helper narrowed the referenced fulfilled subscription context, but still found duplicate Hub task context and missing occurrence-level payment authority.

This phase does not create subscriptions, orders, tasks, batches, logs, review queues, notifications, provider calls, syncs, repairs, replays, or Hub mutations. Hub remains the subscription source of truth.

## Target context

Safe operator-supplied identifiers for the audit target:

- Hub subscription/order label: `SUB-1TPMGCIR`
- Parent order number: `#SUB-1TPMGCIR`
- Delivery date: `2026-05-09`
- Fulfillment status from prior helper: delivered / completed

The prior helper result was not G36D-ready:

- `candidate_count: 1` after dedupe
- `g36d_ready_candidate_count: 0`
- blockers included `missing_payment_status`, `duplicate_occurrence_risk`, and `insufficient_for_g36d`
- operator packet expected 3 line items, while the helper's Hub task summary counted 1 line item
- two matching Hub task contexts existed before helper dedupe

## Runtime preview added

Preview mode:

```text
SUBSCRIPTION_OCCURRENCE_AMBIGUITY_RESOLUTION
```

Implemented in the existing read-only function:

```text
previewNativeOrderCutoverReadiness
```

No standalone function was added.

## Read-only input contract

Supported safe identifiers include:

- `hub_subscription_id`
- `parent_order_number` / `order_number`
- `hub_order_id`
- `occurrence_id`
- `hub_fulfillment_task_id`
- `customer_app_order_id`
- `date_from`
- `date_to`
- `fulfilled_only`
- `operator_expected_line_item_count`
- `operator_expected_payment_status`
- `request_id`

Customer labels remain display/search hints only. Customer name, customer email, phone, and address are not matching keys.

## Response contract

The preview returns:

- `success`
- `dry_run:true`
- `writes_performed:false`
- `hub_source_of_truth:true`
- `matching_task_count`
- `candidate_rows`
- `selected_candidate`
- `payment_status_authority`
- `line_item_discrepancy_analysis`
- `duplicate_occurrence_risk`
- `g36d_ready`
- `g36d_approval_block` only when exactly one clean candidate is ready
- `blockers`
- `warnings`
- `next_action`

Candidate rows are safe summaries only. They do not include customer email, phone, full address, raw Hub payloads, proof/drop payloads, auth headers, secrets, or provider payloads.

## Duplicate Hub task analysis policy

Each matching Hub task context is returned separately in ambiguity mode. Unlike the parent-to-occurrence helper, this mode does not collapse duplicate task rows before the operator can inspect safe differences.

The resolver classifies task context as one of:

- `exact_subscription_occurrence_candidate`
- `duplicate_hub_task_same_occurrence`
- `historical_repair_artifact`
- `cancellation_refund_risk`
- `insufficient_identity`

Duplicate task context blocks G36D until an exact Hub task or occurrence is selected.

## Payment status authority policy

G36D requires authoritative occurrence-level payment status. The resolver checks safe fields from:

- Hub fulfillment task context
- Customer App parent order mirrors
- Customer App subscription mirrors
- native order/task mirrors if present
- operator packet expectation, as non-authoritative comparison only

Classifications include:

- `paid_authoritative`
- `paid_inferred_not_authoritative`
- `missing_payment_status`
- `payment_status_ambiguous`
- `unpaid_or_failed`
- `not_available_from_safe_reads`

Only `paid_authoritative` can satisfy G36D readiness.

## Line item discrepancy policy

The resolver compares safe count sources:

- Hub fulfillment task item arrays or explicit count
- Hub fulfillment task summary-only count
- Customer App parent order item arrays or explicit count
- Customer App subscription mirror count if present
- native order/task mirror count if present
- operator packet expectation, as non-authoritative comparison only

Classifications include:

- `line_item_count_authoritative_1`
- `line_item_count_authoritative_3`
- `bundle_or_decomposition_possible_not_authoritative`
- `task_vs_order_line_item_mismatch`
- `line_item_count_ambiguous`
- `missing_line_item_detail`

A bundle or decomposition explanation is useful context, but it does not clear G36D by itself unless the authoritative occurrence-level item context is unambiguous.

## G36D readiness rule

A candidate is G36D-ready only when all of these are true:

- exactly one occurrence/task context is selected
- payment status is authoritative
- line item count is clear
- delivery date is clear
- fulfillment status is clear
- duplicate occurrence risk is cleared
- cancellation/refund issue is known yes/no
- repair/replay issue is known yes/no
- no provider call is required
- no notification side effect is required
- Hub remains source of truth

If any requirement is not met, the preview returns blockers and no approval block.

## No-write policy

G36C-RESOLVE is read-only. It must not:

- create or update subscription/order/task records
- mutate Hub records
- call Stripe, Shopify, or providers
- create OrderReviewQueue, OrderSyncLog, CommandLog, Notification, or message rows
- send notifications
- run sync, repair, retry, or replay
- create or update ProductionBatch or BatchComplianceLog
- create inventory or PurchaseOrder side effects

## Expected target decision

For the referenced `SUB-1TPMGCIR` context, G36D should remain held unless the resolver can identify exactly one task context with authoritative payment status and clear line item context. If the resolver still reports duplicate task context, missing payment authority, or line item discrepancy, the smallest next step is owner/admin resolution of those specific fields.

## Recommended next phase

Proceed to G36D exact subscription occurrence preview only if this resolver returns `g36d_ready:true` for exactly one candidate.

Otherwise hold subscription migration and resolve:

1. which Hub task is the exact occurrence,
2. authoritative occurrence payment status,
3. authoritative occurrence line item count or bundle decomposition,
4. repair/replay and cancellation/refund ambiguity.
