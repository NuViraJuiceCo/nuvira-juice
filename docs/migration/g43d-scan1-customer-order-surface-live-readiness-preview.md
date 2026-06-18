# G43D-SCAN1: customer order surface live readiness preview

## 1. Executive summary

G43D-SCAN1 adds an admin-authenticated, read-only preview mode to the existing `previewNativeOrderCutoverReadiness` function:

```text
preview_mode: CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS
mode: RECENT_ORDER_SURFACE_SCAN
```

The preview is designed to produce reliable live readiness counts for customer order history and OrderTracker without per-order entity lookup loops. It does not change G43B or G43C runtime behavior, does not broaden allowlists, does not publish customer-facing diagnostics, and does not mutate records.

Current live state carried forward:

- G43B customer order history is live for the exact allowlist:
  - `NV-MQHJR3V2`
  - `NV-MPZNKGNT`
- G43C OrderTracker is live only for:
  - `NV-MQHJR3V2`
- `NV-MPZNKGNT` must not be activated in G43C until its owning customer account can smoke the delivered/reconciled tracker path.
- Customer App `Order` remains canonical.
- Hub fallback remains active.
- Refunds/payments remain Hub/payment source-of-truth.
- Subscriptions/multi-delivery remain Hub source-of-truth.

## 2. Why the earlier live scan was inconclusive

G43D attempted a read-only bounded live scan from a local script, but it hit Base44 rate limiting. Because the earlier scan caught individual 429s and continued, it could not claim reliable fleet-wide readiness counts.

G43D-SCAN1 moves the scan server-side into the established admin preview surface and uses bounded source reads plus in-memory exact joins. If any required source read fails or receives a 429/rate-limit response, the preview returns:

```text
scan_complete:false
rate_limit_detected:true
next_action:retry_after_rate_limit_window
writes_performed:false
```

It does not claim generalized readiness counts when source coverage is incomplete.

## 3. Bounded server-side scan strategy

The preview avoids N+1 entity reads. `RECENT_ORDER_SURFACE_SCAN` uses these bounded reads:

1. Customer App `Order` by recent created date, default/max `25`.
2. Customer App `Order` by recent updated date, default/max `25`.
3. Native `ShopifyOrder`, bounded related horizon, default/max `100`.
4. Native `FulfillmentTask`, bounded related horizon, default/max `100`.
5. `OrderReviewQueue`, bounded related horizon, default/max `100`.
6. `OrderSyncLog`, bounded related horizon, default/max `100`.
7. `SafeSyncParityLog`, bounded related horizon, default/max `100`.

The Customer App order candidates are deduped by Customer App `Order.id`. Native context is joined in memory through exact identifiers only.

No external Hub fetch is performed in the broad scan.

## 4. Request contract

Example request:

```json
{
  "preview_mode": "CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS",
  "mode": "RECENT_ORDER_SURFACE_SCAN",
  "recent_created_limit": 25,
  "recent_updated_limit": 25,
  "related_entity_limit": 100,
  "request_id": "g43d_scan1_recent_customer_order_surface_readiness_<timestamp>"
}
```

The preview is admin-authenticated through the existing `previewNativeOrderCutoverReadiness` access boundary.

## 5. Response safety contract

Returned top-level safety fields include:

- `success`
- `dry_run:true`
- `writes_performed:false`
- `preview_mode`
- `mode`
- `scan_complete`
- `scan_incomplete_reasons`
- `rate_limit_detected`
- `pii_returned:false`
- `raw_payloads_returned:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `source_read_count`
- `source_row_counts`
- `source_truncated`
- readiness counts
- `safe_candidate_summaries`
- `classification_counts`
- `blockers`
- `warnings`
- `next_action`

The broad scan does not return:

- customer name
- customer email
- customer phone
- full address
- raw Hub payloads
- raw Stripe payloads
- raw Shopify payloads
- payment method details
- native record ids
- internal customer authentication data
- `ProductionBatch` status
- `CommandLog` payloads
- `OrderSyncLog` payloads

Safe candidate summaries contain only:

- `order_number`
- `order_type`
- Customer App order presence
- native ShopifyOrder match count
- compatible FulfillmentTask count
- paid/captured readiness
- refund/cancel hold
- subscription/multi-delivery hold
- mismatch categories
- history eligibility
- tracker eligibility
- current G43B allowlist status
- current G43C allowlist status
- fallback required
- review required
- classification

## 6. Rate-limit and truncation handling

If any required source read fails or is rate limited:

- `scan_complete:false`
- generalized readiness counts are `null`
- `safe_candidate_summaries` is empty
- `next_action` is either `retry_after_rate_limit_window` or `fix_source_read_failure_and_rerun`
- `writes_performed:false`

If a bounded related source is truncated:

- `source_truncated` identifies the truncated source.
- missing context is classified as `bounded_scan_context_not_found`.
- rows with missing context are not counted as automatically eligible.
- `coverage_warning` is returned.

This avoids claiming that a native order/task/log is definitively missing when the bounded related horizon may not have covered it.

## 7. Exact eligibility logic

History eligibility requires:

- Customer App `Order` exists.
- Order is one-time.
- Exactly one compatible native `ShopifyOrder` is found.
- Customer App payment status is paid and captured.
- Not refunded.
- Not cancelled.
- Not subscription.
- Not multi-delivery.
- No `OrderReviewQueue` blocker.
- No repair/replay ambiguity from bounded `OrderSyncLog` / `SafeSyncParityLog` context.
- No duplicate identity risk.
- No payment mismatch.
- No fulfillment mismatch.
- No delivery-date mismatch.
- No historical late mirror chronology risk.
- Customer App chronology, totals, and line items remain canonical.

Tracker eligibility additionally requires:

- Exactly one compatible native `FulfillmentTask`.
- Task identity agrees with the Customer App `Order` and matched native `ShopifyOrder`.
- Customer-safe operational mapping exists.
- No `ProductionBatch` direct source.
- No internal production status exposure.

For order history only, a missing task may be acceptable only when no task-dependent operational field is enriched and the related task context is not truncated.

## 8. Exact matching rules

Customer App `Order` to native `ShopifyOrder` uses only:

- `base44_order_id === Customer App Order.id`
- `customer_app_order_id === Customer App Order.id`
- normalized exact `order_number` / `shopify_order_number`

Native `FulfillmentTask` compatibility uses only:

- `order_id === Customer App Order.id`
- `base44_order_id === Customer App Order.id`
- `native_shopify_order_id === matched native ShopifyOrder.id`
- `shopify_order_id === matched native ShopifyOrder.id`
- normalized exact `order_number` / `shopify_order_number`

No fuzzy customer name, phone, partial email, amount, or approximate date matching is used.

## 9. Ownership caveat

This is an admin preview. It does not prove live multi-account customer ownership isolation.

The response returns:

```text
ownership_verification: source_and_harness_verified_not_live_multi_account
```

Future G43E/G43F runtime eligibility must still run only after authenticated customer ownership filtering. Automatic eligibility must never make order-number lookup alone sufficient.

## 10. Classifications

The preview returns these classifications:

- `history_and_tracker_native_ready`
- `history_native_ready_tracker_task_missing`
- `history_native_ready_tracker_identity_ambiguous`
- `native_shopify_order_missing`
- `bounded_scan_context_not_found`
- `native_fulfillment_task_missing`
- `native_duplicate_identity_risk`
- `refund_payment_hub_source_of_truth`
- `cancelled_payment_risk`
- `subscription_multi_delivery_hub_source_of_truth`
- `payment_mismatch`
- `fulfillment_mismatch`
- `delivery_schedule_mismatch`
- `review_queue_hold`
- `repair_replay_hold`
- `historical_late_mirror_hold`
- `unknown_manual_review_required`

## 11. Test coverage

`run-g43d-scan1-customer-order-surface-live-readiness-tests.mjs` covers:

- bounded reads instead of per-order entity queries
- recent created/updated dedupe by Customer App order id
- native `ShopifyOrder` exact joins
- native `FulfillmentTask` exact joins
- duplicate native/task identity blockers
- clean history/tracker candidate readiness
- history-ready but tracker task-missing case
- refund/cancel/payment holds
- subscription/multi-delivery holds
- payment, fulfillment, and delivery-date mismatch holds
- review queue and repair/replay holds
- historical late mirror hold
- bounded-source truncation semantics
- 429/rate-limit failure semantics
- current G43B/G43C allowlist reporting
- candidate counts excluding current allowlists
- no PII or raw payload exposure
- no writes, providers, notifications, or Hub mutation

## 12. No-write policy

G43D-SCAN1 is read-only preview code. It does not:

- change G43B gates
- change G43C gates
- broaden allowlists
- mutate `Order`
- mutate `ShopifyOrder`
- mutate `FulfillmentTask`
- create `CommandLog`
- create `OrderSyncLog`
- create `OrderReviewQueue`
- call Stripe
- call Shopify
- call providers
- send notifications
- mutate Hub
- run sync/repair/replay
- read `ProductionBatch` as customer-facing tracker source
- expose internal production statuses

No Base44 publish is part of PR prep.

## 13. Criteria for proceeding to G43E/G43F

Proceed toward G43E/G43F only after the merged/published preview produces one complete live scan where:

- `scan_complete:true`
- `rate_limit_detected:false`
- required sources are not truncated, or truncation cannot affect candidate classifications
- no ownership safety gap exists beyond the documented live multi-account caveat
- at least one clean candidate exists outside the current exact allowlists

If no clean candidate exists outside current allowlists:

- keep exact allowlists
- address the identified blockers
- do not generalize customer-facing order history or tracker behavior

Recommended sequence if live evidence is complete:

1. G43E — strict automatic native eligibility for customer order history.
2. G43F — strict automatic native eligibility for OrderTracker after G43E.

Hub fallback remains active in both future phases.
