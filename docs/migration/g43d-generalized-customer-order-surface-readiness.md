# G43D — Generalized Customer Order Surface Readiness Preview

## 1. Executive summary

G43D defines a read-only readiness model for moving customer order history and `OrderTracker` from exact order allowlists toward strict automatic native eligibility for safe one-time orders.

Current live state:

- G43B customer order history is live with exact allowlist:
  - `NV-MQHJR3V2`
  - `NV-MPZNKGNT`
- G43C customer `OrderTracker` is live only for:
  - `NV-MQHJR3V2`
- G43C classification:
  - `customer_order_tracker_limited_native_first_live_exact_allowlist_nvmqhjr3v2`
- Customer App `Order` remains the canonical customer-facing row/detail record.
- Hub fallback remains active.
- Refunds/payments remain Hub/payment source-of-truth.
- Subscriptions and multi-delivery remain Hub source-of-truth.

G43D does **not** change live behavior, broaden allowlists, publish Base44, or mutate records.

## 2. Scope and method

Audited surfaces:

| Surface | Current role |
| --- | --- |
| `base44/functions/getCustomerAccountDashboardData/entry.ts` | Customer account dashboard and `all_orders_raw` source for order history. |
| `base44/functions/getCustomerOrderDetail/entry.ts` | Customer order detail backend for `OrderTracker`. |
| `src/pages/OrderHistory.jsx` | Customer order-history UI, still consuming `all_orders_raw`. |
| `src/pages/OrderTracker.jsx` | Customer tracker UI, consuming `getCustomerOrderDetail`. |
| Customer App `Order` | Canonical customer-facing identity, chronology, totals, line items. |
| native `ShopifyOrder` | Native operational order mirror/context. |
| native `FulfillmentTask` | Native task/delivery operational context required for tracker. |
| `OrderReviewQueue`, `OrderSyncLog`, `SafeSyncParityLog` | Review, repair/replay, and parity holds. |

The PR adds a fixture harness only:

- `scripts/migration/run-g43d-generalized-customer-order-surface-readiness-tests.mjs`

No runtime preview function is added because Base44 function count remains constrained and the phase is docs/harness/read-only.

## 3. Bounded live scan status

Requested scan shape:

- 25 most recently created Customer App orders
- 25 most recently updated Customer App orders
- deduped by Customer App `Order.id`
- safe aggregate and order-number-only classifications

Result:

```text
live_bounded_scan_status=blocked_by_base44_rate_limit
```

A read-only scan attempt hit Base44 `429 Rate limit exceeded` before a reliable aggregate could be produced. The local process was terminated and no further broad live scan retry was run in this phase.

Because the live bounded scan did not complete, G43D does **not** claim a live generalized safe subset count. The completed evidence in this PR is the source audit plus fixture harness. A future generalized rollout should run a more rate-safe preview mechanism before G43E/G43F activation work.

## 4. Fixture readiness counts

The G43D harness scans 15 owned fixture orders representing current migration categories.

| Count | Value |
| --- | ---: |
| unique_order_count | 15 |
| one_time_count | 13 |
| subscription_multi_delivery_count | 2 |
| native_shopify_order_match_count | 14 |
| unique_native_fulfillment_task_match_count | 12 |
| history_native_ready_count | 3 |
| tracker_native_ready_count | 1 |
| fallback_required_count | 14 |
| review_required_count | 14 |
| refund_cancel_payment_hold_count | 3 |
| identity_ambiguity_count | 2 |
| mismatch_count | 7 |

Classification counts:

| Classification | Count |
| --- | ---: |
| `history_and_tracker_native_ready` | 1 |
| `history_native_ready_tracker_task_missing` | 1 |
| `history_native_ready_tracker_identity_ambiguous` | 1 |
| `native_duplicate_identity_risk` | 1 |
| `native_shopify_order_missing` | 1 |
| `refund_payment_hub_source_of_truth` | 1 |
| `cancelled_payment_risk` | 1 |
| `subscription_multi_delivery_hub_source_of_truth` | 2 |
| `payment_mismatch` | 1 |
| `fulfillment_mismatch` | 1 |
| `delivery_schedule_mismatch` | 1 |
| `review_queue_hold` | 1 |
| `repair_replay_hold` | 1 |
| `historical_late_mirror_hold` | 1 |

These counts prove the classifier behavior, not live fleet readiness.

## 5. Per-order classification contract

Safe candidate summaries may include only:

- order number
- Customer App Order present flag
- native ShopifyOrder present flag
- compatible native FulfillmentTask count
- order type
- payment/captured readiness
- refund/cancel hold flag
- subscription hold flag
- mismatch categories
- history eligibility
- tracker eligibility
- fallback required flag
- review required flag
- classification

They must not include:

- customer name
- customer email
- phone
- full address
- native record ids
- raw Hub/provider/payment payloads
- debug payloads

## 6. Automatic eligibility contract

A future one-time order can be automatically eligible only when all are true:

1. Authenticated customer owns the Customer App `Order`.
2. The order is one-time.
3. Customer App `Order` exists.
4. Exactly one compatible native `ShopifyOrder` exists.
5. For tracker use, exactly one compatible native `FulfillmentTask` exists.
6. `payment_status=paid` or source-canonical equivalent.
7. `payment_captured=true`.
8. Not refunded.
9. Not cancelled.
10. Not subscription.
11. Not multi-delivery.
12. No `OrderReviewQueue` blocker.
13. No repair/replay ambiguity in `OrderSyncLog`.
14. No blocking mismatch in `SafeSyncParityLog`.
15. No duplicate identity risk.
16. No payment mismatch.
17. No fulfillment mismatch.
18. No delivery schedule mismatch.
19. Native operational values are internally consistent.
20. Customer-safe status mapping exists.
21. Original Customer App chronology, totals, and line items remain canonical.

History-only eligibility may tolerate a missing `FulfillmentTask` only when no task-dependent operational fields are enriched.

Tracker eligibility requires exactly one compatible `FulfillmentTask`.

## 7. Ownership isolation

Automatic eligibility must run only after authenticated ownership filtering.

Required safety rules:

- order-number lookup alone is never enough
- allowlisting or automatic eligibility cannot bypass ownership
- native ShopifyOrder/task matches cannot change ownership
- cross-customer native matches are rejected
- no order belonging to another customer appears

Current ownership result:

```text
source_and_harness_verified_not_live_multi_account
```

A second live customer-account proof was not available in this phase.

## 8. Chronology and customer-contract safeguards

Always preserve:

- Customer App `Order.id`
- order number
- original Customer App created date
- totals
- line items
- refund/cancel fields
- delivery details under current safe contract
- existing routes and links
- pagination and sorting

Never allow a native mirror creation date to reorder customer history.

Never expose customer-visible:

- native eligibility
- source-of-truth
- fallback reasons
- mismatch fields
- review-required flags
- native record ids
- `ProductionBatch` status
- `CommandLog` / `OrderSyncLog` data
- raw provider/Hub payloads

## 9. Exact live evidence carry-forward

### NV-MQHJR3V2

- G43B history native enrichment is live.
- G43C tracker native enrichment is live.
- Customer App `Order` remains canonical.
- Exact native ShopifyOrder and exactly one compatible native FulfillmentTask were verified during G43C-LIVE1A.
- Tracker remains at safe pre-production wording.
- `ProductionBatch` state does not directly advance tracker.

### NV-MPZNKGNT

- G43B history allowlist is live.
- G43C tracker activation is held pending owning-customer account smoke.
- Do not add to G43C without separate proof.

### NV-MP5SOQLJ

- Historical late mirror.
- Must not appear as new customer activity.
- Remains held unless chronology-safe handling is separately proven.

Refunded/cancelled orders, subscription/multi-delivery contexts, native-missing rows, and task-missing/task-ambiguous rows remain fallback/review-held.

## 10. Proposed G43E / G43F sequence

### G43E — strict automatic native eligibility for customer order history

Only after a successful rate-safe bounded live readiness scan:

- replace exact order-number dependency with strict eligibility policy
- keep feature gate and kill switch
- maintain denylist and optional allowlist override
- keep Customer App `Order` canonical
- keep Hub fallback active
- keep refunds, cancellations, subscriptions, multi-delivery, mismatches, review holds, and repair/replay rows unchanged
- no customer-visible diagnostics
- no writes

### G43F — strict automatic native eligibility for OrderTracker

Only after G43E and additional customer-auth smoke:

- require exactly one compatible `FulfillmentTask`
- retain Hub/current fallback
- no `ProductionBatch` direct source
- no customer status writes
- no notifications
- no provider calls

Do not remove Hub fallback in either phase.

## 11. Hard stops

Stop before generalized rollout if any of these are true:

- live bounded scan is rate-limited or incomplete
- ownership isolation lacks source/harness proof
- exact native identity is duplicated or ambiguous
- compatible task is missing for tracker
- refund/payment status is ambiguous
- order is cancelled/refunded
- order is subscription or multi-delivery
- delivery schedule mismatch exists
- payment or fulfillment mismatch exists
- review queue blocker exists
- repair/replay ambiguity exists
- historical native mirror could reorder chronology
- customer-visible diagnostics would be exposed
- `ProductionBatch` status would drive tracker directly
- provider/notification/Hub mutation appears

## 12. No-write confirmation

G43D is docs/harness/read-only.

Confirmed policy:

- no G43B/G43C gate changes
- no allowlist changes
- no Base44 publish
- no Customer App `Order` mutation
- no native `ShopifyOrder` mutation
- no `FulfillmentTask` mutation
- no Hub mutation
- no provider/Stripe/Shopify calls
- no notifications/messages
- no sync/repair/replay
- no logs/queues created by the harness

## 13. Recommendation

Do not proceed directly to broad G43E/G43F activation from G43D alone because the live bounded scan was blocked by rate limiting.

Recommended next step:

1. Keep exact G43B/G43C allowlists unchanged.
2. Add or run a more rate-safe read-only generalized preview path that avoids repeated per-order live queries.
3. Only if that scan finds a meaningful clean subset, proceed to G43E history automatic eligibility first.
4. Proceed to G43F tracker automatic eligibility only after G43E and owning-customer smoke coverage are clean.
