# G43D-SCAN5: Complete bounded customer-order readiness scan

## 1. Executive summary

G43D-SCAN5 adds the final read-only generalized customer-order scanner phase for the Customer App order-history and OrderTracker migration path.

Current proven source coverage from G43D-SCAN4:

- Customer App `Order` source coverage is complete by bounded list.
- Unique Customer App orders: 52.
- Created source returned 52 rows below the 100-row limit.
- Updated source returned 52 rows below the 100-row limit.
- No source truncation or silent server cap was observed for Customer App orders.
- Known controls were present: `NV-MQHJR3V2`, `NV-MPZNKGNT`, and `NV-MP5SOQLJ`.

SCAN5 uses that source-depth finding to add two admin-authenticated, read-only modes to the existing `previewNativeOrderCutoverReadiness` function:

1. `FULL_BOUNDED_ORDER_SURFACE_SCAN`
2. `EXACT_ORDER_SURFACE_PREVIEW`

No G43B/G43C gates or allowlists are changed by this phase.

## 2. Current live configuration held

G43B customer order-history allowlist remains:

- `NV-MQHJR3V2`
- `NV-MPZNKGNT`

G43C OrderTracker allowlist remains:

- `NV-MQHJR3V2`

`NV-MPZNKGNT` must not be added to G43C until its owning customer account can smoke the tracker route.

## 3. Full bounded scan mode

Request mode:

```json
{
  "preview_mode": "CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS",
  "mode": "FULL_BOUNDED_ORDER_SURFACE_SCAN",
  "order_limit": 100,
  "related_entity_limit": 100,
  "request_id": "g43d_scan5_full_bounded_order_surface_<timestamp>"
}
```

The scan reads each broad source once:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`
- `OrderReviewQueue`
- `OrderSyncLog`
- `SafeSyncParityLog`

The scan does not perform a per-order query loop, does not call Hub externally, and does not read `ProductionBatch` as a customer-facing source.

## 4. Source coverage semantics

For each source, SCAN5 reports:

- requested limit;
- effective limit;
- returned count;
- truncation status;
- deterministic ordering;
- oldest/newest timestamp returned; and
- coverage completeness.

Broad readiness is decision-grade only when these sources are complete:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`
- `OrderReviewQueue`

If `OrderSyncLog` or `SafeSyncParityLog` is truncated, clean-looking candidates are only provisional and must run `EXACT_ORDER_SURFACE_PREVIEW` before any G43E/G43F planning.

## 5. Exact identity joins

Customer App `Order` to native `ShopifyOrder` joins use only exact identifiers:

- `base44_order_id`
- `customer_app_order_id`
- normalized exact `order_number` / `shopify_order_number`

Customer App `Order` or native `ShopifyOrder` to `FulfillmentTask` joins use only exact identifiers:

- `order_id`
- `base44_order_id`
- `native_shopify_order_id`
- `shopify_order_id`
- normalized exact `order_number` / `shopify_order_number`

The scan does not match on customer name, phone, partial email, approximate dates, approximate totals, or fuzzy display labels.

## 6. Safe broad candidate summaries

Broad scan candidate summaries return only admin-safe fields:

- order number;
- order type;
- paid/captured readiness;
- native `ShopifyOrder` match count;
- compatible `FulfillmentTask` count;
- refund/cancel hold;
- subscription/multi-delivery hold;
- mismatch categories;
- current G43B/G43C allowlist status;
- provisional history/tracker readiness;
- exact log follow-up requirement;
- fallback/review booleans; and
- classification.

Broad summaries do not return customer name, customer email, phone, full address, raw records, raw Hub payloads, raw provider payloads, payment method details, native record IDs, or authentication/session data.

## 7. Exact order preview mode

Request mode:

```json
{
  "preview_mode": "CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS",
  "mode": "EXACT_ORDER_SURFACE_PREVIEW",
  "order_number": "<exact candidate>",
  "customer_app_order_id": "<exact Customer App Order id>",
  "request_id": "g43d_scan5_exact_order_surface_<order>_<timestamp>"
}
```

Exact preview confirms:

- exact Customer App `Order` exists;
- exactly one compatible native `ShopifyOrder` exists;
- exactly one compatible `FulfillmentTask` exists for tracker readiness;
- no duplicate identity risk;
- no `OrderReviewQueue` blocker;
- no `OrderSyncLog` or `SafeSyncParityLog` repair/replay hold;
- not refunded;
- not cancelled;
- not subscription/multi-delivery;
- no payment mismatch;
- no fulfillment mismatch;
- no delivery schedule mismatch;
- Customer App chronology, totals, and line items remain canonical;
- no `ProductionBatch` direct customer-facing source; and
- customer-safe history/tracker mappings exist.

Exact preview is for candidate confirmation only. It still does not activate G43E/G43F or change any allowlist.

## 8. Eligibility contract

History eligibility requires:

- one-time order;
- Customer App `Order` present;
- exactly one native `ShopifyOrder`;
- paid/captured;
- not refunded or cancelled;
- not subscription/multi-delivery;
- no review/repair/replay hold;
- no duplicate identity;
- no payment, fulfillment, or delivery schedule mismatch; and
- Customer App chronology, totals, and line items remain canonical.

Tracker eligibility additionally requires:

- exactly one compatible `FulfillmentTask`;
- exact identity agreement;
- customer-safe operational mapping;
- no direct `ProductionBatch` source; and
- no internal lifecycle terminology exposure.

Ownership caveat remains:

```text
source_and_harness_verified_not_live_multi_account
```

Future automatic eligibility must execute only after authenticated customer ownership filtering.

## 9. Known controls

`NV-MQHJR3V2`:

- known G43B/G43C pilot order;
- history and tracker native enrichment already live by exact allowlist;
- Customer App `Order` remains canonical.

`NV-MPZNKGNT`:

- history allowlisted;
- tracker candidate remains held pending owning-customer smoke.

`NV-MP5SOQLJ`:

- historical late mirror;
- chronology hold;
- must not be treated as new customer activity.

## 10. Hard stops

Do not:

- change G43B or G43C gates;
- broaden either allowlist;
- add `NV-MPZNKGNT` to G43C without owning-customer smoke;
- activate broad G43E or G43F;
- mutate `Order`, `ShopifyOrder`, or `FulfillmentTask`;
- create logs or queues;
- call Hub externally;
- call Stripe, Shopify, or providers;
- send notifications;
- run sync/repair/replay;
- expose PII or raw payloads; or
- publish during PR prep.

## 11. Test coverage

`run-g43d-scan5-full-bounded-order-readiness-tests.mjs` covers:

- complete 52-order source coverage below the safe limit;
- one read per broad source;
- no per-order query loop in full scan;
- exact native order and task joins;
- duplicate native/task blockers;
- clean history/tracker candidate;
- history-ready/task-missing candidate;
- refund/cancel/subscription holds;
- payment, fulfillment, and delivery schedule mismatches;
- review queue and repair/replay holds;
- truncated log coverage requiring exact follow-up;
- exact preview clearing or blocking log follow-up;
- historical chronology hold;
- current allowlist reporting;
- outside-allowlist counts;
- ownership caveat;
- no PII/raw payloads;
- no writes;
- no providers;
- no notifications; and
- no Hub mutation.

## 12. Recommendation

After merge, publish only `previewNativeOrderCutoverReadiness`, boundary verify, run exactly one `FULL_BOUNDED_ORDER_SURFACE_SCAN`, then run `EXACT_ORDER_SURFACE_PREVIEW` only for candidates outside the current allowlists.

Proceed to G43E planning only if at least one candidate outside the G43B history allowlist passes exact history readiness.

Keep G43F held until generalized G43E history behavior is live and stable.

If there are no new exact-confirmed history candidates, stop generalized customer-order scanner work, retain exact G43B/G43C allowlists, and move to another Hub-dependent page or domain.
