# G36C-DECISION: Subscription Occurrence Owner Decision Packet

## 1. Executive summary

G36C-RESOLVE narrowed the target subscription occurrence context, but it did not produce a G36D-ready exact occurrence. The blocker is no longer broad discovery; it is owner/admin interpretation of two matching Hub task contexts, line-item authority, and how to treat a Customer App parent-order mirror that shows cancelled while Hub task context indicates paid/delivered.

This packet captures the exact decisions needed before G36D can run. G36D remains read-only and held until the owner/admin supplies all required decisions.

No runtime behavior changes are included in this packet. No schema changes, provider calls, notifications, sync/repair/replay, Hub mutations, Customer App mutations, native order/task mutations, logs, queues, inventory, purchase order, production batch, or compliance log changes are approved by this document.

Hub remains subscription source of truth.

## 2. Current live G36C-RESOLVE findings

Target context:

```text
hub_subscription_id=SUB-1TPMGCIR
parent_order_number=#SUB-1TPMGCIR
hub_order_id=69ed51368b5ca93c33a1b0b4
delivery_date=2026-05-09
operator_expected_payment=paid
operator_expected_line_item_count=3
```

Live resolver result:

```text
success=true
dry_run=true
writes_performed=false
hub_source_of_truth=true
matching_task_count=2
g36d_ready=false
selected_candidate=null
g36d_approval_block_present=false
```

Matching Hub task contexts:

```text
69f509d5a1bea46cdce8e274
69ffb0c9fedc8bbefc7710da
```

Both were grouped as the same order/date occurrence context:

```text
order_date:SUB-1TPMGCIR:2026-05-09
```

Current blockers:

```text
duplicate_occurrence_risk
line_item_count_ambiguous
line_item_discrepancy_requires_owner_resolution
insufficient_for_g36d
```

Current warnings:

```text
hub_source_of_truth
read_only_ambiguity_resolution_only
customer_pii_not_returned
provider_calls_disabled
notifications_held
raw_hub_payloads_not_returned
customer_app_parent_order_has_cancel_or_refund_marker
operator_packet_line_item_count_differs_from_hub_task_count
```

## 3. Duplicate Hub task decision needed

G36C-RESOLVE found two Hub task contexts for the same Hub order/date context. Both are safe admin task identifiers. No customer PII or raw Hub payload is included here.

```text
DUPLICATE HUB TASK DECISION

Target subscription:
hub_subscription_id=SUB-1TPMGCIR
parent_order_number=#SUB-1TPMGCIR
hub_order_id=69ed51368b5ca93c33a1b0b4
delivery_date=2026-05-09

Matching Hub task ids:
- 69f509d5a1bea46cdce8e274
- 69ffb0c9fedc8bbefc7710da

Choose one:

Option A — Treat as duplicate same occurrence and select task id:
APPROVE SUBSCRIPTION OCCURRENCE TASK SELECTION
selected_hub_fulfillment_task_id=
ignored_duplicate_hub_fulfillment_task_id=
duplicate_explanation=

Option B — Treat as two different occurrences
HOLD G36D
reason=two different occurrence contexts need separate review

Option C — Cannot determine yet
HOLD G36D
needed_info=
```

Selecting a Hub task id is only for a future read-only G36D preview. It does not delete a Hub task, modify Hub, create native task context, create a Customer App record, or approve any subscription write.

## 4. Line item count decision needed

G36C-RESOLVE found a line-item mismatch:

```text
LINE ITEM AUTHORITY DECISION

Live helper found:
hub_task_line_item_count=1
customer_app_parent_line_item_count=1

Operator expected:
line_item_count=3

Choose one:

Option A — Use Hub/task count as authoritative
APPROVE SUBSCRIPTION OCCURRENCE LINE ITEM AUTHORITY
line_item_count=1
line_item_interpretation=subscription bundle/package count
production_decomposition=held_for_later

Option B — Use decomposed product count as authoritative
APPROVE SUBSCRIPTION OCCURRENCE LINE ITEM AUTHORITY
line_item_count=3
line_item_interpretation=decomposed products
decomposition_source=

Option C — Bundle/package count is 1 but decomposes to 3 production items
APPROVE SUBSCRIPTION OCCURRENCE LINE ITEM AUTHORITY
line_item_count=1
line_item_interpretation=bundle/package
decomposed_production_item_count=3
decomposition_source=

Option D — Cannot determine yet
HOLD G36D
needed_info=
```

This decision is for parity-preview interpretation only. It does not materialize production demand, create inventory movement, create purchase orders, create native task/order records, or mutate Hub.

## 5. Customer App parent cancelled mirror decision needed

G36C-RESOLVE found that the Customer App parent order mirror has a cancel/refund marker while Hub task context indicates paid/delivered.

```text
CUSTOMER APP PARENT CANCELLED MIRROR DECISION

Live finding:
Customer App parent order mirror shows cancelled.
Hub occurrence/task context indicates delivered/paid.

Choose one:

Option A — Cancelled mirror is expected historical state and should block native occurrence pilot
HOLD G36D
reason=customer app parent cancelled mirror is authoritative

Option B — Cancelled mirror is a stale/reconciliation artifact and Hub paid/delivered task is authoritative for read-only preview
APPROVE HUB OCCURRENCE AUTHORITY OVER CANCELLED MIRROR
hub_source_of_truth=true
customer_app_cancelled_mirror_treatment=stale_artifact_for_this_preview_only

Option C — Cannot determine yet
HOLD G36D
needed_info=
```

This decision does not change the Customer App parent order. No correction, repair, replay, sync, or native write is approved. It only determines whether a future read-only G36D exact occurrence preview can proceed.

## 6. Payment authority finding

G36C-RESOLVE found paid authority from the Hub task context, but one matching task had no payment status and the Customer App parent mirror showed cancelled.

```text
PAYMENT STATUS AUTHORITY CONFIRMATION

Live finding:
payment_status_authority=paid_authoritative
one Hub task payment_status=null
one Hub task payment_status=paid
operator expected payment=paid

Choose one:

Option A — Accept Hub paid task as authoritative
APPROVE SUBSCRIPTION OCCURRENCE PAYMENT STATUS
payment_status=paid
payment_authority=hub_task_paid_context

Option B — Hold until payment status is confirmed elsewhere
HOLD G36D
needed_info=
```

No Stripe, Shopify, or provider lookup is approved by this decision packet.

## 7. G36D readiness checklist

G36D exact subscription occurrence preview can proceed only if all are true:

- exactly one Hub task context is selected or duplicate handling is explicitly approved
- selected/ignored Hub task ids are provided if duplicate same occurrence is approved
- payment status is accepted as authoritative
- line-item count interpretation is approved
- Customer App parent cancelled mirror treatment is approved
- delivery date remains `2026-05-09`
- fulfillment status remains delivered/completed
- known cancellation/refund issue is answered yes/no
- known repair/replay issue is answered yes/no
- Hub remains source of truth
- no provider call is required
- no notification side effect is required
- no native write path is proposed

If any checklist item is unresolved, G36D remains held.

## 8. Owner approval blocks

### 8.1 Duplicate Hub task approval block

```text
APPROVE SUBSCRIPTION OCCURRENCE TASK SELECTION
selected_hub_fulfillment_task_id=
ignored_duplicate_hub_fulfillment_task_id=
duplicate_explanation=
```

### 8.2 Line item authority approval block

```text
APPROVE SUBSCRIPTION OCCURRENCE LINE ITEM AUTHORITY
line_item_count=
line_item_interpretation=
decomposed_production_item_count=
decomposition_source=
production_decomposition=held_for_later
```

### 8.3 Customer App cancelled mirror approval block

```text
APPROVE HUB OCCURRENCE AUTHORITY OVER CANCELLED MIRROR
hub_source_of_truth=true
customer_app_cancelled_mirror_treatment=
```

### 8.4 Payment status approval block

```text
APPROVE SUBSCRIPTION OCCURRENCE PAYMENT STATUS
payment_status=paid
payment_authority=hub_task_paid_context
```

### 8.5 Final G36D approval template

Use this final template only after all decision blocks above are completed:

```text
APPROVE G36D EXACT SUBSCRIPTION OCCURRENCE PREVIEW

hub_subscription_id=SUB-1TPMGCIR
parent_order_number=#SUB-1TPMGCIR
hub_order_id=69ed51368b5ca93c33a1b0b4
delivery_date=2026-05-09
selected_hub_fulfillment_task_id=
ignored_duplicate_hub_fulfillment_task_id=
payment_status=paid
fulfillment_status=delivered
line_item_count=
line_item_interpretation=
known cancellation/refund issue=
known repair/replay issue=
customer_app_cancelled_mirror_treatment=
notes=
```

G36D is still read-only. G36D does not create native subscription records, mutate Hub, call providers, send notifications, create logs/queues, run sync/repair/replay, or update Customer App/native records.

## 9. Hard stops

Hold G36D if any of the following are true:

- no selected Hub fulfillment task id is provided
- duplicate Hub task context remains unresolved
- line-item count remains ambiguous
- decomposed product count cannot be tied to a safe source
- Customer App parent cancelled mirror is treated as authoritative
- payment status is not accepted as authoritative
- cancellation/refund issue is unknown
- repair/replay issue is unknown
- provider lookup would be required
- notification side effect would be required
- any Hub or Customer App mutation would be required
- any native subscription/order/task write would be required
- customer PII or raw Hub/provider payload would be needed to decide

## 10. Recommended next phase

Recommended immediate state: hold G36D until owner/admin supplies the decision blocks.

If all decisions are supplied, proceed to G36D exact subscription occurrence preview as read-only only.

If the decisions cannot be supplied from current admin knowledge, run a separate read-only Hub-side safe detail audit that returns only distinguishing non-PII fields for the two task contexts. Do not run repair, replay, sync, deletion, provider lookup, or mutation.
