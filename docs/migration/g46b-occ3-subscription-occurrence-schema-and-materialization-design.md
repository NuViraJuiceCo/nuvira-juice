# G46B-OCC3 — Subscription Occurrence Schema and Native-Chain Design

## 1. OCC1/OCC2 findings carried forward

G46C customer subscription reads remain blocked.

Current evidence:

- active native `Subscription` parents: `0`;
- paused native `Subscription` parents: `0`;
- cancelled native `Subscription` parents: `6`;
- no existing occurrence is native-read-ready;
- existing occurrence context lacks complete Customer App `Order`, native `ShopifyOrder`, and `FulfillmentTask` links;
- historical/cancelled subscription records are fallback evidence, not migration pilots.

OCC2 ruled out a preview lookup patch as the next move. The structural blockers are:

```text
occurrence_schema_linkage_gap
occurrence_native_chain_intentionally_deferred
occurrence_historical_hub_only_by_design
```

OCC3 is docs-only and fixture-only. It does not modify entity schemas, runtime functions, customer subscription reads, customer UI, live records, Stripe, Shopify, Hub, providers, notifications, repair/replay/backfill, or Base44 publish state.

## 2. Current schema support matrix

| Entity | Actual field | Type | Required | Currently populated expectation | Source function/path | Customer-safe | Immutable identity field | Migration gap |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Subscription` | `id` | system/string | implicit | yes for parent rows | checkout/webhook/repair | internal only | yes | usable parent id; no occurrence identity |
| `Subscription` | `customer_email` | string | required | yes | checkout/webhook/repair | no | no | ownership uses PII; future reads need authenticated owner context first |
| `Subscription` | `status` | string | optional | yes | webhook/management actions | customer-safe display | no | all current rows cancelled |
| `Subscription` | `stripe_subscription_id` | string | optional | yes in current parents | Stripe checkout/webhook/repair | no | provider id, internal only | billing authority remains Stripe; not customer output |
| `Subscription` | Hub sync metadata | string/number | optional | partial | Hub sync functions | no | no | Hub recurrence remains fallback |
| Dedicated occurrence entity | none | n/a | n/a | not present | n/a | n/a | n/a | no durable native occurrence ledger currently exists |
| `PendingSubscriptionCheckout` | `fulfillment_number` | number | optional | first-cycle context | subscription checkout | internal only | no | checkout context only; not durable occurrence ledger |
| `PendingSubscriptionCheckout` | `first_delivery_date` / `next_delivery_date` | string/date | required/optional | yes | subscription checkout | customer-safe date if owned | no | date alone cannot identify occurrence |
| `PendingSubscriptionCheckout` | `hub_payload` | object | optional | can exist | webhook/checkout completion | no | no | raw Hub payload must not feed customer response |
| Customer App `Order` | `id` | system/string | implicit | yes for orders | checkout/webhook/order paths | internal route id where already used | yes | can be canonical customer-facing order id |
| Customer App `Order` | `order_number` | string | optional | yes for orders | order creation paths | customer-safe | not alone | order number alone not enough for subscription occurrence identity |
| Customer App `Order` | `fulfillment_type` | string | optional | partial | order creation paths | customer-safe if mapped | no | not exact parent/occurrence linkage |
| Customer App `Order` | `assigned_delivery_date` / delivery dates | string/date | optional | partial | order scheduling paths | customer-safe if owned | no | date alone cannot identify occurrence |
| Customer App `Order` | subscription parent/occurrence fields | absent | n/a | no | n/a | internal only if added | should be immutable | main schema linkage gap |
| native `ShopifyOrder` | `base44_order_id` | string | optional | populated for some native mirrors | native mirror paths | internal only | no | can link to Customer App `Order` when present |
| native `ShopifyOrder` | `subscription_parent_id` | string | optional | supported | native mirror paths | internal only | yes within occurrence | occurrence-capable but not broadly materialized |
| native `ShopifyOrder` | `fulfillment_sequence_number` | number | optional | supported | native mirror paths | internal only | yes with parent | occurrence-capable but not enough without Customer App Order link |
| native `ShopifyOrder` | `source_type` / `order_type` | string | optional | supported | native mirror paths | internal enum/copy | no | must be normalized for future occurrence reads |
| native `ShopifyOrder` | `stripe_subscription_id` | string | optional | supported | Stripe/webhook/mirror paths | no | provider id, internal only | billing authority, not customer output |
| native `FulfillmentTask` | `order_id` | string | required | yes for tasks | task creation paths | internal only | no | should point to Customer App `Order` for future occurrence chain |
| native `FulfillmentTask` | `base44_order_id` | string | optional | supported | task mirror/materialization | internal only | no | useful duplicate-safe Customer App Order link |
| native `FulfillmentTask` | `native_shopify_order_id` | string | optional | supported | task mirror/materialization | internal only | no | useful native order link |
| native `FulfillmentTask` | `customer_app_subscription_id` | string | optional | supported | subscription-capable task path | internal only | yes with occurrence | occurrence-capable but currently not proven populated |
| native `FulfillmentTask` | `fulfillment_number` | number | required | yes for tasks | task creation paths | internal/cycle display if mapped | yes with parent | required but not unique without parent/occurrence id |
| native `FulfillmentTask` | `scheduled_date` / `delivery_date` | string/date | required/optional | supported | task scheduling paths | customer-safe if owned | no | date alone cannot identify occurrence |
| `CommandLog` | `idempotency_key` | string | optional | supported | command paths | internal only | yes | suitable future materialization idempotency guard |
| `OrderSyncLog` | `request_id` / `correlation_id` | string | optional | supported | sync/log paths | internal only | no | audit only; no occurrence identity |
| `SafeSyncParityLog` | `request_id` / `order_id` / `order_number` | string | optional | supported | parity previews | internal only | no | audit only; no occurrence identity |
| `OrderReviewQueue` | `idempotency_key` / `occurrence_count` | string/number | optional | supported | review paths | internal only | no | review hold only; no durable chain |

## 3. Minimum additive schema proposal

OCC3 does not change schemas. The proposal below is the minimum future additive schema needed to make new subscription occurrences deterministic.

### Required additions to Customer App `Order`

| Proposed field | Type | Nullable | Immutable after creation | Source of value | Uniqueness/query need | Customer-visible | Compatibility |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `customer_app_subscription_id` | string | yes for old/one-time rows | yes | parent `Subscription.id` | query by parent | no | old rows remain null |
| `subscription_occurrence_id` | string | yes for old/one-time rows | yes | generated/persisted occurrence id | unique with parent | no | old rows remain null |
| `subscription_cycle_key` | string | yes | yes | deterministic cycle key or provider/source occurrence key | unique with parent | no | old rows remain null |
| `fulfillment_number` | number | yes | yes | occurrence cycle/fulfillment number | query with parent | no/directly mapped only | old rows remain null |
| `source_type` | string | yes | yes after creation | `subscription_occurrence` for future rows | filter/source guard | no/internal mapping | old rows remain null |

Reason: Customer App `Order` is the canonical customer-facing row. It currently lacks explicit subscription occurrence linkage, so future reads cannot safely connect a subscription occurrence to a customer-visible row without inference.

### Required additions to native `ShopifyOrder`

| Proposed field | Type | Nullable | Immutable after creation | Source of value | Uniqueness/query need | Customer-visible | Compatibility |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `subscription_occurrence_id` | string | yes | yes | same occurrence id as Customer App `Order` | query/dedupe by occurrence | no | old rows remain null |
| `subscription_cycle_key` | string | yes | yes | same cycle key as Customer App `Order` | query/dedupe by parent+cycle | no | old rows remain null |

Existing `base44_order_id`, `subscription_parent_id`, `fulfillment_sequence_number`, `source_type`, `order_type`, and `stripe_subscription_id` are occurrence-capable and should be retained.

### Required additions to `FulfillmentTask`

| Proposed field | Type | Nullable | Immutable after creation | Source of value | Uniqueness/query need | Customer-visible | Compatibility |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `subscription_occurrence_id` | string | yes | yes | same occurrence id as Customer App `Order` | query/dedupe by occurrence | no | old rows remain null |
| `subscription_cycle_key` | string | yes | yes | same cycle key | query/dedupe by parent+cycle | no | old rows remain null |

Existing `customer_app_subscription_id`, `order_id`, `base44_order_id`, `native_shopify_order_id`, `fulfillment_number`, `scheduled_date`, and `delivery_date` are useful but not enough without a stable occurrence id.

### Optional future ledger entity

If OCC4 allows a new additive entity, a dedicated `SubscriptionOccurrence` ledger would reduce ambiguity. Proposed fields:

- `customer_app_subscription_id`
- `subscription_occurrence_id`
- `subscription_cycle_key`
- `fulfillment_number`
- `scheduled_delivery_date`
- `occurrence_status`
- `customer_app_order_id`
- `native_shopify_order_id`
- `fulfillment_task_id`
- `materialization_status`
- `idempotency_key`

This is not required for OCC3, but it is the cleanest way to represent the occurrence/cycle as a first-class native identity.

## 4. Immutable parent/occurrence identity model

Parent key:

```text
Subscription.id
```

Occurrence key priority:

1. immutable provider/source occurrence id if one exists and can be safely stored internally;
2. otherwise a deterministic `subscription_occurrence_id` created once and persisted;
3. supporting `subscription_cycle_key` derived from immutable parent + cycle values.

Future materialization idempotency key:

```text
subscription_occurrence_materialize:<parent_subscription_id>:<subscription_occurrence_id>:<operation_type>
```

Do not derive identity solely from:

- scheduled date;
- amount;
- product name;
- customer email;
- phone;
- current timestamp;
- newest row selection.

Uniqueness expectations:

- one occurrence per `customer_app_subscription_id + subscription_occurrence_id`;
- one Customer App `Order` per occurrence;
- one native `ShopifyOrder` per occurrence;
- one `FulfillmentTask` per occurrence where fulfillment applies.

## 5. Canonical future materialization chain

This is a future design only. OCC3 does not implement it.

### Step 1 — Resolve exact parent

Preconditions:

- exact native parent id;
- authenticated owner context for customer-facing paths;
- Stripe billing authority remains active;
- Hub recurrence fallback remains active.

Allowed write in future command: none in this step.

Failure behavior: block on missing, duplicate, cancelled, or cross-customer parent.

### Step 2 — Resolve or create exactly one occurrence identity

Preconditions:

- parent is eligible;
- cycle/occurrence source is exact;
- scheduled date is supporting context only.

Allowed write in future command: create one occurrence ledger row if an occurrence entity exists, or persist occurrence identity on the future Customer App `Order` row.

Idempotency check: parent + occurrence id + operation type.

Failure behavior: block on duplicate occurrence, missing cycle key, or skipped/cancelled occurrence.

### Step 3 — Confirm authenticated/owned customer linkage

Preconditions:

- owner/profile link exact;
- allowlist or actor policy satisfied for pilot;
- no customer name/email/phone fuzzy match.

Allowed write: none.

Failure behavior: hard stop on cross-customer conflict.

### Step 4 — Create or resolve one Customer App `Order`

Preconditions:

- occurrence identity exists;
- order idempotency key absent or points to exact existing order;
- one-time chronology remains unaffected.

Allowed write in future command: one Customer App `Order` for that occurrence.

Forbidden side effects: no notification, no payment action, no Hub mutation.

### Step 5 — Create or resolve one native `ShopifyOrder`

Preconditions:

- Customer App `Order` exists;
- exact occurrence id copied;
- no duplicate native order.

Allowed write in future command: one native `ShopifyOrder` linked by `base44_order_id` and occurrence fields.

Failure behavior: block if duplicate or conflicting native order exists.

### Step 6 — Create or resolve one `FulfillmentTask`

Preconditions:

- Customer App `Order` and native `ShopifyOrder` exist;
- exact occurrence id copied;
- exact scheduled/delivery date assigned;
- no duplicate task.

Allowed write in future command: one `FulfillmentTask` linked by Customer App Order, native ShopifyOrder, parent, and occurrence fields.

Failure behavior: block or mark partial recovery required. Do not create a second task.

### Step 7 — Persist exact cross-links

Required links:

- occurrence → Customer App `Order`;
- Customer App `Order` → native `ShopifyOrder` through `base44_order_id` on native order;
- native `ShopifyOrder` → `FulfillmentTask` through `native_shopify_order_id`;
- all rows share parent and occurrence identity.

### Step 8 — Verify parity

Verify:

- exactly one row in each chain segment;
- no duplicate identity;
- customer-safe status mapping;
- Stripe/Hub authority flags retained.

### Step 9 — Keep Stripe and Hub authority active

Even after materialization:

- Stripe remains billing/payment source-of-truth;
- Hub remains recurrence/multi-delivery fallback until a separate retirement plan is approved;
- no subscription management actions are enabled by occurrence materialization.

## 6. Partial-chain policy

Required classifications:

```text
occurrence_chain_complete
occurrence_chain_missing_customer_order
occurrence_chain_missing_native_shopify_order
occurrence_chain_missing_fulfillment_task
occurrence_chain_partial_recovery_required
occurrence_duplicate_identity_risk
occurrence_cross_customer_link_conflict
occurrence_cancelled_or_skipped_hold
occurrence_materialization_idempotent
occurrence_manual_review_required
```

Fail-closed handling:

| Scenario | Classification | Policy |
| --- | --- | --- |
| occurrence exists but Customer App Order missing | `occurrence_chain_missing_customer_order` | do not read native-first; future exact command may create one row only |
| Customer App Order exists but native ShopifyOrder missing | `occurrence_chain_missing_native_shopify_order` | fallback; no customer duplicate |
| native ShopifyOrder exists but FulfillmentTask missing | `occurrence_chain_missing_fulfillment_task` | fallback for tracker/operational progress |
| conflicting occurrence ids | `occurrence_duplicate_identity_risk` | manual review; no auto-select |
| duplicate Customer App Orders | `occurrence_duplicate_identity_risk` | manual review; do not hide rows |
| duplicate ShopifyOrders | `occurrence_duplicate_identity_risk` | manual review; do not auto-select newest |
| duplicate FulfillmentTasks | `occurrence_duplicate_identity_risk` | manual review; no tracker native-first |
| cross-customer link conflict | `occurrence_cross_customer_link_conflict` | hard stop |
| parent cancelled before materialization | `occurrence_cancelled_or_skipped_hold` | no future materialization without owner approval |
| exact occurrence skipped before materialization | `occurrence_cancelled_or_skipped_hold` | no Customer App Order/native/task create |
| retry after partial failure | `occurrence_chain_partial_recovery_required` or `occurrence_materialization_idempotent` | resolve existing exact rows; never duplicate |

## 7. Historical no-backfill policy

The six current cancelled parents remain unchanged.

Historical policy:

- no historical Customer App Order creation;
- no historical native ShopifyOrder creation;
- no historical FulfillmentTask creation;
- no mutation of cancelled subscriptions;
- no inferred linkage from dates;
- no silent chronology changes;
- no customer-facing duplication;
- historical Hub-only occurrences remain Hub fallback;
- any historical backfill would require a separate owner-approved phase with exact evidence.

## 8. Future OCC4-OCC7 sequence

Recommended sequence:

### G46B-OCC4 — additive schema patch

Only if OCC3 is accepted.

Scope:

- additive fields only;
- no live occurrence creation;
- no historical backfill;
- no customer subscription read changes.

### G46B-OCC5 — future occurrence chain preview

Scope:

- read-only preview;
- exact payload proof for one new active occurrence;
- verifies parent, occurrence, Customer App Order, native ShopifyOrder, and FulfillmentTask links before writes.

### G46B-OCC6 — default-off future occurrence materialization command

Scope:

- exact parent/occurrence allowlists;
- one Customer App Order;
- one native ShopifyOrder;
- one FulfillmentTask;
- one CommandLog;
- no notifications;
- no broad Hub mutation;
- no payment action.

### G46B-OCC7 — first natural active subscription occurrence pilot

Scope:

- only with a real active parent;
- exact owner approval;
- exact occurrence identity;
- post-write no-duplicate/no-notification/no-provider verification.

### G46C — limited customer subscription reads

Only after the native occurrence chain is proven live and stable.

## 9. Hard stops

- No G46C from cancelled/historical parents.
- No G46C while active native parent count is zero.
- No customer subscription reads with zero native-ready occurrences.
- No inferred occurrence links from dates.
- No occurrence backfill without a separate gated command plan.
- No Stripe or Hub authority change.
- No pause/resume/skip/cancel/payment-method work.
- No notifications.
- No provider calls.
- No Base44 publish for OCC3.

## 10. Recommendation

Do not proceed to G46C.

Proceed only to OCC4 if the additive schema proposal is accepted. The fastest safe path is future-only correctness for the next natural active subscription occurrence. Existing cancelled records remain fallback data and must not drive schema, order, or task backfills.
