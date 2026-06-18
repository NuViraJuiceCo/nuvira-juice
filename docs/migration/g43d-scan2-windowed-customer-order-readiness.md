# G43D-SCAN2: Windowed Customer Order Surface Readiness

## Executive summary

G43D-SCAN2 extends `previewNativeOrderCutoverReadiness` with an admin-authenticated, read-only `WINDOWED_ORDER_SURFACE_SCAN` mode under the existing `CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS` preview mode.

The goal is to improve live readiness coverage after G43D-SCAN1 completed without rate limiting but remained materially truncated across recent-created Orders, recent-updated Orders, and OrderSyncLog context. G43D-SCAN2 does not change G43B or G43C behavior, does not broaden allowlists, and does not activate broad automatic eligibility.

Current live configuration must remain unchanged:

- G43B customer order-history allowlist:
  - `NV-MQHJR3V2`
  - `NV-MPZNKGNT`
- G43C OrderTracker allowlist:
  - `NV-MQHJR3V2`

`NV-MPZNKGNT` remains held for G43C until its owning customer session can smoke the tracker path.

## Why SCAN1 was inconclusive

G43D-SCAN1 returned:

- `scan_complete:true`
- `rate_limit_detected:false`
- `unique_order_count:33`
- `history_native_ready_count:2`
- `tracker_native_ready_count:2`
- `history_ready_excluding_current_allowlist_count:0`
- `tracker_ready_excluding_current_allowlist_count:1`

However, the scan was not authoritative for broad migration decisions because these sources were materially truncated:

- recent-created Customer App Orders
- recent-updated Customer App Orders
- OrderSyncLog

The only clean tracker expansion candidate was `NV-MPZNKGNT`, and that still requires an owning-customer tracker smoke before G43C allowlist expansion.

## Added request contract

G43D-SCAN2 adds this mode:

```json
{
  "preview_mode": "CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS",
  "mode": "WINDOWED_ORDER_SURFACE_SCAN",
  "order_created_from": "<ISO timestamp>",
  "order_created_to": "<ISO timestamp>",
  "order_updated_from": "<ISO timestamp>",
  "order_updated_to": "<ISO timestamp>",
  "related_context_from": "<ISO timestamp>",
  "related_context_to": "<ISO timestamp>",
  "order_limit": 25,
  "related_entity_limit": 100,
  "request_id": "g43d_scan2_windowed_order_surface_<window>_<timestamp>"
}
```

The existing `RECENT_ORDER_SURFACE_SCAN` mode remains supported.

## Bounded read strategy

Each invocation performs one bounded read per source and joins in memory:

1. Customer App Order, created-date window, max `order_limit`
2. Customer App Order, updated-date window, max `order_limit`
3. native ShopifyOrder, related-context window, max `related_entity_limit`
4. native FulfillmentTask, related-context window, max `related_entity_limit`
5. OrderReviewQueue, related-context window, max `related_entity_limit`
6. OrderSyncLog, related-context window, max `related_entity_limit`
7. SafeSyncParityLog, related-context window, max `related_entity_limit`

The implementation keeps the existing no-N+1 invariant:

- no per-order native order lookup loop
- no per-order task lookup loop
- no external Hub fetch
- no provider calls
- no writes

If Base44 entity filtering supports the supplied date-window filter, the preview uses it. If a source read fails or returns rate-limit behavior, the response is explicitly incomplete and counts are not treated as authoritative.

## Response metadata

G43D-SCAN2 preserves the SCAN1 safety contract and adds window/continuation metadata:

- `scan_complete`
- `scan_incomplete_reasons`
- `rate_limit_detected`
- `window_start`
- `window_end`
- `source_read_count`
- `source_read_strategy`
- `source_row_counts`
- `source_truncated`
- `continuation_available`
- `continuation_token`
- `next_window`
- `unique_order_count`
- `history_native_ready_count`
- `tracker_native_ready_count`
- `fallback_required_count`
- `review_required_count`
- `mismatch_count`
- `identity_ambiguity_count`
- `classification_counts`
- `safe_candidate_summaries`

Safety flags remain explicit:

- `writes_performed:false`
- `pii_returned:false`
- `raw_payloads_returned:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`

## Coverage and truncation semantics

G43D-SCAN2 does not overclaim readiness when context is incomplete.

Rules:

- If any required source read fails or rate-limits, return `scan_complete:false`.
- If a related source is truncated, missing native/task/review/sync context is classified as `bounded_scan_context_not_found` rather than definitive absence.
- If the candidate order window is truncated, the scan can describe returned rows but must not be treated as fleet-complete.
- Overlapping created/updated windows are deduped by Customer App Order id.
- Customer ownership remains `source_and_harness_verified_not_live_multi_account`; future G43E/G43F must still enforce authenticated customer ownership before native enrichment.

## Eligibility logic

History readiness requires:

- Customer App Order exists
- one-time order
- exactly one compatible native ShopifyOrder
- paid/captured
- not refunded
- not cancelled
- not subscription/multi-delivery
- no review queue blocker
- no repair/replay ambiguity
- no duplicate identity risk
- no payment mismatch
- no fulfillment mismatch
- no delivery-date mismatch
- Customer App chronology/totals/line items remain canonical

Tracker readiness additionally requires:

- exactly one compatible native FulfillmentTask
- task identity agrees with Customer App Order/native ShopifyOrder
- no internal ProductionBatch source
- no internal production status exposure

## Safe candidate summaries

Broad scan output may include only safe operational summary fields:

- order number
- order type
- Customer App Order presence
- native ShopifyOrder match count
- compatible FulfillmentTask count
- paid/captured readiness
- refund/cancel hold
- subscription/multi-delivery hold
- mismatch categories
- history readiness
- tracker readiness
- current G43B/G43C allowlist flags
- fallback/review requirement
- classification

The preview must not return:

- customer name
- customer email
- phone
- full address
- native record ids in broad scan output
- raw Hub payloads
- raw Stripe/Shopify payloads
- payment method details
- internal authentication details

## Recommended scan windows

Run sequentially with cooldown and stop immediately on 429:

1. Last 7 days
2. Days 8-30
3. Days 31-90
4. Older historical window only if needed for chronology/fallback analysis

Aggregate results offline from safe summaries, deduping by Customer App Order id/order number. Do not rerun a failed/rate-limited window repeatedly.

## Test coverage

The G43D-SCAN2 harness covers:

- nonoverlapping windows
- overlapping-order dedupe
- one bounded source read per invocation
- continuation metadata when a window truncates
- date-window scan path when cursor pagination is unavailable
- source truncation reporting
- no definitive missing-record classification under truncated context
- clean history/tracker readiness
- task-missing tracker hold
- duplicate task hold
- refund/cancel hold
- subscription/multi-delivery hold
- review/repair hold
- historical mirror chronology hold
- G43B/G43C allowlist reporting
- candidate counts outside current allowlists
- 429 behavior
- no PII/raw payloads
- no writes/providers/notifications/Hub mutation

## No-write policy

G43D-SCAN2 is read-only.

It does not:

- modify G43B gates or allowlists
- modify G43C gates or allowlists
- activate G43E/G43F
- mutate Order, ShopifyOrder, or FulfillmentTask
- create CommandLog, OrderSyncLog, OrderReviewQueue, Notification, CustomerMessageDeliveryLog, PurchaseOrder, OperationalAlert, or ComplianceAlert rows
- call Hub externally
- call Stripe, Shopify, or providers
- send notifications
- run sync/repair/replay

## Criteria for proceeding

Proceed toward G43E only when combined window evidence is complete enough to find clean history candidates outside the current G43B allowlist.

Proceed toward G43F only after generalized history eligibility is proven and a clean tracker candidate has exactly one compatible task.

Until then:

- keep exact allowlists unchanged
- retain Hub fallback
- retain refund/payment and subscription source-of-truth
- keep `NV-MPZNKGNT` tracker activation held until owning-customer smoke
