# G46B-OCC1 — Active Subscription Occurrence Linkage Gap Audit

## 1. Executive summary

G46B is closed as:

```text
Overall: customer_subscription_parent_occurrence_scan_incomplete
Exact sub-finding: customer_subscription_parent_read_candidate_occurrences_fallback_required
```

G46B-OCC1 was opened to fast-track the subscription path by narrowing the question from "does a native parent exist?" to "can an active parent's customer-visible occurrences be joined exactly to Customer App Order, native ShopifyOrder, and FulfillmentTask context without inference?"

The read-only OCC1 control found no active native `Subscription` parent in the current live Customer App source:

```text
active Subscription count: 0
paused Subscription count: 0
cancelled Subscription count: 6
```

Because the phase requires an active native parent and explicitly says not to use the previously sampled cancelled parent as a migration pilot, OCC1 cannot produce an active-parent native-read candidate from current live data. The safe result is to keep customer subscription reads Hub/Stripe-backed and isolate the occurrence linkage gap as a source/contract problem rather than proceed to G46C.

## 2. Scope and method

Scope remained read-only/static:

- no customer subscription behavior changed;
- no `Subscription`, `PendingSubscriptionCheckout`, `Order`, `ShopifyOrder`, or `FulfillmentTask` rows were mutated;
- no subscription pause/resume/skip/cancel/payment-method action was invoked;
- no Stripe, Shopify, Hub, or provider API call was made;
- no notifications were sent;
- no repair/replay/backfill was run;
- no G45C, G43B, or G43C configuration was changed.

Method:

1. Reused the G46B live closeout evidence.
2. Performed read-only live `Subscription` status checks.
3. Inspected current entity schemas for actual linkage fields.
4. Inspected subscription creation/sync/mirror source paths.
5. Classified whether the gap is a preview lookup problem, schema/link population problem, missing native occurrence records, or historical Hub-only behavior.

## 3. Active parent selection result

OCC1 required one active parent selected by exact internal id and exact owner/profile linkage. Current live source does not have an active native parent available.

| Source | Safe result |
| --- | --- |
| `Subscription.filter({ status: "active" })` | 0 rows |
| `Subscription.filter({ status: "paused" })` | 0 rows |
| `Subscription.filter({ status: "cancelled" })` | 6 rows |
| Active parent selected for OCC1 | no |
| Previously sampled cancelled parent reused as pilot | no |

Classification:

```text
active_parent_read_candidate_occurrences_fallback_required
```

with the additional blocking fact:

```text
no_active_native_subscription_parent_available
```

This means OCC1 cannot validate a future customer subscription read from active live subscription state yet.

## 4. Actual occurrence entity/link fields

### `Subscription` parent

Actual parent fields include:

- `id`
- `customer_email`
- `plan_id`
- `bundle_id`
- `custom_composition`
- `delivery_zone_id`
- `delivery_address`
- `status`
- `cancel_at_period_end`
- `cancel_effective_date`
- `next_delivery_date`
- `started_date`
- `paused_until`
- `stripe_subscription_id`
- `stripe_customer_id`
- Hub sync status metadata

Parent rows do not represent individual delivery occurrences.

### `PendingSubscriptionCheckout`

Occurrence-adjacent checkout fields include:

- `stripe_checkout_session_id`
- `stripe_subscription_id`
- `stripe_customer_id`
- `plan_id`
- `fulfillment_cadence`
- `fulfillments_per_cycle`
- `fulfillment_number`
- `order_timestamp`
- `order_date`
- `production_date`
- `first_delivery_date`
- `next_delivery_date`
- `status`
- `hub_payload`

Important gap: this entity is activation/checkout context, not a durable occurrence ledger. It does not provide explicit Customer App Order id, native ShopifyOrder id, or FulfillmentTask id fields for every occurrence.

### Customer App `Order`

The current `Order` schema has customer order fields such as:

- `order_number`
- `status`
- `production_status`
- `fulfillment_status`
- `delivery_status`
- schedule/delivery fields
- Stripe payment/refund fields

Important gap: current schema does not provide explicit `customer_app_subscription_id`, `subscription_parent_id`, `stripe_subscription_id`, `occurrence_id`, or `fulfillment_number` fields that can deterministically link subscription occurrences to parent subscriptions.

### Native `ShopifyOrder`

Occurrence-capable fields include:

- `id`
- `shopify_order_id`
- `shopify_order_number`
- `base44_order_id`
- `source_channel`
- `source_type`
- `order_type`
- `fulfillment_mode`
- `is_subscription`
- `fulfillments`
- `stripe_subscription_id`
- `subscription_parent_id`
- `fulfillment_instance_date`
- `fulfillment_sequence_number`
- `source_invoice_id`
- schedule/status fields

Important gap: native `ShopifyOrder` can represent a subscription occurrence mirror, but current evidence does not show complete active parent occurrence linkage to Customer App Order and FulfillmentTask records.

### Native `FulfillmentTask`

Occurrence-capable fields include:

- `order_id`
- `base44_order_id`
- `shopify_order_id`
- `native_shopify_order_id`
- `shopify_order_number`
- `order_number`
- `fulfillment_task_id`
- `source_channel`
- `source_type`
- `order_type`
- `fulfillment_type`
- `fulfillment_number`
- `delivery_date`
- `scheduled_date`
- `assigned_delivery_date`
- `status`
- `delivery_status`
- `production_status`
- `sync_status`
- `stripe_subscription_id`
- `customer_app_subscription_id`
- `plan_id`

Important gap: G46B exact evidence showed the sampled occurrence did not have a native ShopifyOrder link or FulfillmentTask link.

## 5. Exact relationship-key audit

OCC1 does not approve date-only matching. Exact linkage may use only these classes of identifiers.

### Occurrence to Customer App Order

Allowed exact keys:

- explicit Customer App Order id;
- exact `base44_order_id`/`order_id` where present;
- exact normalized `order_number` only when it is unique and tied to owned Customer App context;
- exact occurrence/cycle linkage if implemented.

Current finding:

```text
Customer App Order schema lacks explicit subscription occurrence linkage fields.
```

### Occurrence to native ShopifyOrder

Allowed exact keys:

- explicit native ShopifyOrder id;
- `base44_order_id` / Customer App Order id;
- exact normalized order number;
- explicit subscription/occurrence linkage fields such as `subscription_parent_id`, `stripe_subscription_id`, `fulfillment_instance_date`, and `fulfillment_sequence_number` when complete.

Current finding:

```text
Native ShopifyOrder supports occurrence-capable fields, but current G46B exact occurrence evidence still had native ShopifyOrder link missing.
```

### Occurrence to FulfillmentTask

Allowed exact keys:

- explicit task id;
- `native_shopify_order_id`;
- `shopify_order_id`;
- `base44_order_id`/Customer App Order id;
- exact normalized order number;
- explicit occurrence linkage such as `customer_app_subscription_id`, `stripe_subscription_id`, and `fulfillment_number` when complete.

Current finding:

```text
FulfillmentTask supports occurrence-capable fields, but current G46B exact occurrence evidence still had task link missing.
```

## 6. Exact log/parity result

The broad G46B bounded scan had truncated `OrderSyncLog` coverage. OCC1 therefore does not treat broad log absence as proof that no repair/replay ambiguity exists.

Because no active parent exists, OCC1 did not run an active-parent exact log/parity preview. Any future active-parent preview must use exact parent/occurrence identifiers and narrowly scoped reads against:

- `OrderSyncLog`
- `SafeSyncParityLog`
- `OrderReviewQueue`
- any occurrence mirror/audit command logs

Current classification:

```text
exact_log_context_unavailable_for_active_parent
```

## 7. Occurrence creation/sync path finding

### `createSubscriptionPaymentElementIntent`

This function creates `PendingSubscriptionCheckout` before Stripe subscription creation and stores checkout/schedule/product decomposition metadata. It does not create Customer App `Order`, native `ShopifyOrder`, or `FulfillmentTask` occurrence rows.

### `stripeWebhook`

For subscription checkout/invoice success, this path creates or updates the native `Subscription` parent, marks `PendingSubscriptionCheckout` completed, and dispatches `syncSubscriptionWithFulfillments` to Hub. It can send customer notifications in the live checkout path, but OCC1 did not invoke this path.

This path does not establish native occurrence rows as Customer App `Order` + native `ShopifyOrder` + `FulfillmentTask` chains for customer subscription reads.

### `syncSubscriptionWithFulfillments`

This function calculates fulfillments and pushes them to Hub. Hub remains the recurrence/multi-delivery authority. It can update subscription Hub sync metadata, but OCC1 did not invoke it.

It does not create Customer App `Order`, native `ShopifyOrder`, or native `FulfillmentTask` occurrence rows locally.

### `repairMissingSubscriptionForPaidInvoice` and `repairMissingCASubscriptionFromStripeAndHub`

These are repair paths that can create/repair parent `Subscription` records and send subscription context back to Hub. They are not safe OCC1 actions and were not invoked.

### `createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp`

This is a default-off, exact-gated mirror command for one historical Hub subscription occurrence. Its own contract creates only a native `ShopifyOrder` mirror and explicitly holds Customer App Order creation, FulfillmentTask creation, ProductionBatch work, notifications, provider calls, Hub mutation, sync/repair/replay, inventory, and PO.

Finding:

```text
The current source path explains why parent records can exist while occurrence rows remain incomplete for customer-native reads: parent creation and Hub recurrence sync are live, but durable native occurrence/order/task chains are not broadly materialized.
```

## 8. Root-cause classification

Current OCC1 root cause is not a G46B preview lookup-only gap. The stronger finding is:

```text
occurrence_link_fields_unpopulated
occurrence_native_order_missing
occurrence_native_task_missing
occurrence_historical_hub_only
active_parent_read_candidate_occurrences_fallback_required
```

Additional blocker:

```text
no_active_native_subscription_parent_available
```

A future `occurrence_preview_lookup_contract_gap` remains possible only if exact active-parent records later show valid links in fields that G46B does not yet recognize. Current evidence does not prove that.

## 9. Safe output summary

| Metric | Result |
| --- | ---: |
| Active native parent count | 0 |
| Paused native parent count | 0 |
| Cancelled native parent count | 6 |
| Exact active parent match count | 0 |
| Occurrence count from G46B bounded scan | 20 |
| Complete occurrence identity count from G46B bounded scan | 5 |
| Orphan occurrence count from G46B bounded scan | 15 |
| Exact Customer App Order link count for sampled occurrence | 0 |
| Exact native ShopifyOrder link count for sampled occurrence | 0 |
| Exact FulfillmentTask link count for sampled occurrence | 0 |
| Native occurrence read candidate count | 0 |
| Bounded `OrderSyncLog` coverage | truncated |
| Writes performed | false |
| PII/raw payload output | false |
| Provider calls / notifications / Hub mutation | false |

## 10. Hard stops

- No G46C from a cancelled parent alone.
- No customer subscription cutover with zero native-ready occurrences.
- No inferred occurrence links from scheduled dates.
- No occurrence backfill without a separate gated command plan.
- No Stripe or Hub authority changes.
- No pause/resume/skip/cancel/payment-method work.
- No customer subscription page changes.

## 11. Recommendation

Do not proceed to G46C yet.

The fastest safe next step is not another broad scan. It is either:

1. wait for or identify a real active native `Subscription` parent, then rerun an exact active-parent occurrence linkage preview; or
2. plan an exact occurrence mirror/linkage packet that proves how one customer-visible occurrence would be connected to Customer App Order, native ShopifyOrder, and FulfillmentTask records without inference.

Proceed to G46C only after at least one active parent and its customer-visible occurrences are exact, deterministic native-read candidates. Until then, retain Hub/Stripe fallback for subscriptions and keep all subscription writes held.
