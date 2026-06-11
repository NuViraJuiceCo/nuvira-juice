# G36E: Controlled Subscription Occurrence Pilot Policy

## 1. Executive summary

G36D proved that a single subscription occurrence can be understood through a read-only exact parity preview when the owner supplies explicit occurrence decisions. It did not approve or implement any native subscription write path.

For the selected `SUB-1TPMGCIR` occurrence, Hub remains the operational source of truth. The next safe technical step is a read-only native subscription occurrence mirror packet preview that generates the proposed native mirror fields without writing records. A live native subscription pilot should not start from fulfillment automation, production demand, notifications, or broad recurring automation.

Recommended next phase:

```text
G36F — read-only native subscription occurrence mirror packet preview
```

If a future write pilot is explicitly approved after G36F, the safest first write scope is a native ShopifyOrder mirror only, preferably historical/admin-only, with no native FulfillmentTask, no production demand, no notification, no provider call, and no Hub mutation.

## 2. G36D proof summary

G36D live preview returned:

```text
success=true
dry_run=true
writes_performed=false
blockers=[]
hub_source_of_truth=true
parity_classification=hub_source_of_truth_subscription_occurrence
```

Selected occurrence context:

```text
hub_subscription_id=SUB-1TPMGCIR
parent_order_number=#SUB-1TPMGCIR
hub_order_id=69ed51368b5ca93c33a1b0b4
delivery_date=2026-05-09
selected_hub_fulfillment_task_id=69ffb0c9fedc8bbefc7710da
ignored_duplicate_hub_fulfillment_task_id=69f509d5a1bea46cdce8e274
payment_status=paid
payment_authority=hub_task_paid_context_owner_approved
fulfillment_status=delivered
line_item_count=1
line_item_interpretation=subscription bundle/package count
decomposed_production_item_count=held_for_later
customer_app_cancelled_mirror_treatment=stale_artifact_for_this_preview_only
native_shopify_order_present=false
native_fulfillment_task_present=false
native_production_batch_count=0
```

What G36D proved:

- exact occurrence identity can be previewed read-only
- duplicate Hub task ambiguity can be resolved by owner-approved selected/ignored task ids
- Hub paid task context can be used as payment authority for read-only preview
- Customer App cancelled parent mirror can be treated as a stale artifact for preview only
- line item count can be interpreted as subscription bundle/package count for this occurrence
- Hub remains source of truth
- no native ShopifyOrder exists for this occurrence today
- no native FulfillmentTask exists for this occurrence today
- no native ProductionBatch exists for this occurrence today
- no native write path exists or is approved

## 3. What is not proven

G36D did not prove any of the following:

- native ShopifyOrder creation for subscription occurrences
- native FulfillmentTask creation for subscription occurrences
- production demand decomposition for subscription bundle/package items
- native ProductionBatch materialization
- delivery task lifecycle behavior
- customer-facing subscription status handling
- notification behavior
- cancellation/refund behavior
- repair/replay safety
- broad subscription automation
- Hub retirement for subscriptions

These remain held.

## 4. Future pilot scope options

### Option A — Native ShopifyOrder mirror only

Create one native ShopifyOrder mirror for the exact subscription occurrence.

Benefits:

- smallest native write surface
- does not create delivery queue work
- can remain historical/admin-only
- can validate mirror field contract and idempotency without operational task side effects

Risks:

- still creates a native record that must not become source of truth
- must not trigger sync, notification, repair, production, or fulfillment automation
- requires strict gates, idempotency, and exact allowlists

### Option B — Native FulfillmentTask mirror only

Create one native FulfillmentTask mirror for the delivered occurrence.

Benefits:

- validates task-level parity for a fulfilled subscription occurrence

Risks:

- higher operational risk because task rows can appear in delivery or admin work queues
- can conflict with existing Hub task context
- can create duplicate operational work if not fully isolated
- requires delivered/proof/drop/route policy before any write

### Option C — Native ShopifyOrder plus FulfillmentTask mirror

Create both native order and task mirrors for the occurrence.

Benefits:

- closer to operational native subscription context

Risks:

- combines the write risks of Options A and B
- can produce split-brain operational state
- still lacks production decomposition policy
- should not be first pilot

### Option D — Full native production/delivery lifecycle for a future occurrence

Run native production/delivery lifecycle for a future subscription occurrence.

Status: not ready.

Required but not available yet:

- decomposition policy
- production demand preview
- delivery task lifecycle policy
- notification policy
- schedule policy
- repair/replay policy
- cancellation/refund policy
- monitoring and rollback policy

### Option E — Keep Hub-only for subscriptions

Keep Hub as the subscription source of truth and avoid native subscription writes.

Benefits:

- safest near-term posture
- avoids duplicate task, production, notification, and refund/cancellation risk

Risks:

- does not advance native subscription parity beyond read-only preview

## 5. Recommended safest next pilot type

Do not run a live write pilot yet.

Recommended next technical phase:

```text
G36F — read-only native subscription occurrence mirror packet preview
```

G36F should generate the proposed native ShopifyOrder mirror fields for the exact occurrence and return no-write safety flags. It should not create records.

If a later write pilot is approved, start with:

```text
Native ShopifyOrder mirror only
```

The first write pilot should be exact, historical/admin-only, default-off, and isolated from fulfillment automation. Native FulfillmentTask, ProductionBatch, delivery lifecycle, notifications, cancellations/refunds, and broad subscription automation should remain held.

## 6. Hard preconditions before any subscription write

A future subscription occurrence write pilot must require all of the following:

- exact `hub_subscription_id`
- exact `hub_order_id`
- exact `selected_hub_fulfillment_task_id`
- ignored duplicate task id recorded
- exact `delivery_date`
- authoritative `payment_status=paid`
- fulfillment status delivered or target state explicitly defined
- line item count interpretation approved
- production decomposition policy approved or explicitly held out of scope
- Customer App cancelled mirror treatment approved
- known cancellation/refund issue = no
- known repair/replay issue = no
- duplicate task risk resolved
- Hub source of truth remains active
- exact owner approval
- no provider call
- no notification
- no Hub mutation
- no broad subscription automation
- dry-run preview immediately before any write
- idempotency request id
- default-off gates
- kill switch active by default
- exact subscription/order/task allowlists only

If any precondition is missing, the write pilot must not run.

## 7. Native ShopifyOrder mirror field contract

A future read-only mirror packet preview should propose safe fields only. Suggested field contract:

```text
source_type=subscription_occurrence_hub_preview
source_channel=hub_subscription_occurrence
hub_subscription_id=SUB-1TPMGCIR
hub_order_id=69ed51368b5ca93c33a1b0b4
selected_hub_fulfillment_task_id=69ffb0c9fedc8bbefc7710da
ignored_duplicate_hub_fulfillment_task_id=69f509d5a1bea46cdce8e274
parent_order_number=#SUB-1TPMGCIR
delivery_date=2026-05-09
payment_status=paid
fulfillment_status=delivered
line_item_count=1
line_item_interpretation=subscription bundle/package count
decomposed_production_item_count=held
operational_visibility=admin_only_or_read_only
sync_status=preview_only_no_sync
audit_trail=owner_approved_g36d_preview_context
```

Do not include:

- raw Hub payloads
- customer email, phone, or address
- provider payloads
- payment method details
- auth headers or secrets
- proof/drop payloads
- repair/replay payloads

The mirror packet must explicitly state:

```text
native_shopify_order_create_proposed=false
native_fulfillment_task_create_proposed=false
hub_mutation_proposed=false
notification_proposed=false
provider_call_proposed=false
```

until a separate write phase is approved.

## 8. Native FulfillmentTask risk

Native FulfillmentTask mirror is higher risk than a native ShopifyOrder mirror because it can become operationally visible.

Risks:

- could appear in delivery queues
- could conflict with the selected Hub task
- could create duplicate delivery work
- requires delivered_at/proof/drop/route interpretation
- requires task lifecycle and status canonicalization
- requires notification suppression guarantees
- requires repair/replay collision policy

Native FulfillmentTask mirror should remain held unless a specific owner-approved need exists after ShopifyOrder mirror parity is proven.

## 9. Production decomposition policy

For the selected occurrence, `line_item_count=1` represents the subscription bundle/package count.

Production decomposition remains held.

Before any subscription production demand preview or native ProductionBatch work, require:

- approved decomposition source
- mapping from Weekly Fresh Subscription to component products
- exact component count
- recipe/master-data parity
- no duplicate demand with Hub
- no inventory deduction
- no purchase order automation
- no notification
- no Hub mutation

Until then:

```text
decomposed_production_item_count=held_for_later
native_production_batch_create_proposed=false
inventory_or_po_impact=false
```

## 10. Cancelled mirror policy

For this occurrence, the Customer App parent cancelled mirror is treated as a stale artifact for read-only preview only.

Policy:

- do not correct the Customer App parent order
- do not use the cancelled parent mirror as source of truth for this occurrence
- use the selected Hub paid/delivered task as occurrence authority for read-only preview
- if future evidence shows parent cancellation is authoritative, stop any pilot
- any future write pilot must preserve the distinction between stale parent mirror and authoritative Hub occurrence

No correction, repair, replay, sync, or native write is approved by this policy.

## 11. Future gate strategy

Do not implement gates in G36E. Future gate family, if needed:

```text
ENABLE_NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_KILL_SWITCH
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_ALLOWED_EMAILS
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_SUBSCRIPTION_ALLOWLIST
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_ORDER_ALLOWLIST
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_TASK_ALLOWLIST
NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_POLICY
```

Potential policy:

```text
EXACT_SUBSCRIPTION_OCCURRENCE_MIRROR_ONLY_NO_NOTIFICATION
```

Required defaults:

- disabled by default
- kill switch active by default
- exact allowlists only
- no broad subscription gates
- no provider calls
- no notifications
- no Hub mutation
- no sync/repair/replay
- no production/inventory/PO side effects

## 12. Roadmap

Recommended roadmap:

1. **G36F — read-only native subscription occurrence mirror packet preview**
   - generate exact proposed native ShopifyOrder mirror fields
   - no writes
   - no provider calls
   - no notifications
   - no Hub mutation

2. **G36G — default-off gated native subscription occurrence mirror command PR prep**
   - only after G36F is proven
   - PR prep only
   - no live execution

3. **G36H — exact live native subscription occurrence mirror pilot**
   - only if owner approves
   - likely native ShopifyOrder mirror only
   - historical/admin-only preferred

Hold until later:

- native FulfillmentTask subscription mirror
- native production demand
- native delivery lifecycle
- notifications
- cancellation/refund automation
- broad subscription automation

## 13. Hard stops

Stop before any live subscription pilot if any of the following are true:

- exact occurrence identity is missing
- duplicate task risk is unresolved
- selected Hub task payment is not authoritative paid
- line item interpretation is unresolved
- production decomposition is required but not approved
- Customer App cancelled mirror becomes authoritative
- cancellation/refund issue exists or is unknown
- repair/replay issue exists or is unknown
- provider lookup is required
- notification side effect is required
- Hub mutation is required
- native FulfillmentTask would enter live operational queues
- production demand or inventory/PO side effect is required
- raw Hub payload or customer PII would be needed
- broad subscription automation is proposed

Hub remains subscription source of truth until subscription parity, decomposition, task lifecycle, notification, refund/cancellation, and repair/replay policies are proven separately.
