# G43D-SCAN3: Customer Order Window Filter Semantics

## 1. Executive summary

G43D-SCAN2 added a bounded, read-only windowed readiness scan, but the first live windows were not decision-grade. All windows returned zero Customer App `Order` rows even though a known control order fell inside the recent-seven-day window.

SCAN3 validates the actual Customer App `Order` timestamp contract and patches the read-only scan to avoid trusting an unvalidated server-side range-filter syntax. The selected strategy is bounded source reads plus in-memory timestamp filtering, with optional known-control-order validation before any readiness count is considered authoritative.

This phase does not change G43B/G43C gates, allowlists, customer behavior, schemas, records, providers, notifications, Hub fallback, or Hub writes.

## 2. Zero-row contradiction

Known control order:

| Field | Value |
| --- | --- |
| order_number | `NV-MQHJR3V2` |
| Customer App Order id | `6a321cbfd8d78863f15de956` |
| known created value | `2026-06-17T04:04:15.034000` |
| recent-seven-day window | `2026-06-12` through `2026-06-18` America/Chicago |

The recent-seven-day window should have included the control order. G43D-SCAN2 returned `unique_order_count: 0`, so the window results were reclassified as implementation-complete but filter-contract-unvalidated.

## 3. Actual Order timestamp fields

A read-only control audit found:

| Check | Result |
| --- | --- |
| exact id lookup | control order found |
| exact `order_number` lookup | control order found |
| unfiltered recent-created list | control order found |
| unfiltered recent-updated list | control order found |
| canonical created field | `created_date` |
| canonical updated field | `updated_date` |
| `created_at` / `createdAt` | absent for the control order |
| `updated_at` / `updatedAt` | absent for the control order |

The stored timestamp values have microsecond-style precision and no timezone suffix. SCAN3 treats stored timestamps without an explicit timezone as UTC for comparison.

## 4. Base44 date-filter behavior

The control audit showed exact filters and unfiltered list reads worked. However, server-side range filters using `$gte` / `$lt` did not return the control row for either:

- a tiny window around the stored timestamp; or
- the full recent-seven-day window.

The read API did not produce a hard validation error for that range syntax; it returned zero rows. Therefore the readiness scan must not treat server-side range-filter zeroes as authoritative until the filter contract is proven.

## 5. Timezone and boundary contract

SCAN3 uses a single comparison contract:

```text
window_start <= canonical_timestamp < window_end
```

Calendar-day windows should be resolved in America/Chicago once, then converted to canonical UTC timestamps before invocation. Example for the recent-seven-day control window:

| Local boundary | UTC boundary |
| --- | --- |
| `2026-06-12 00:00:00 America/Chicago` | `2026-06-12T05:00:00.000Z` |
| `2026-06-19 00:00:00 America/Chicago` | `2026-06-19T05:00:00.000Z` |

The exclusive end boundary prevents adjacent-window duplication.

## 6. Selected patch strategy

Selected strategy: **Option B — bounded list plus in-memory date filtering**.

The `WINDOWED_ORDER_SURFACE_SCAN` mode now:

1. reads each bounded source once;
2. does not run per-order entity lookup loops;
3. filters Customer App `Order` rows in memory using canonical timestamp fields;
4. returns `source_rows_before_window_filter` and `source_rows_after_window_filter`;
5. reports the date filter operator as `bounded_list_in_memory`;
6. reports the timestamp policy as `stored_timestamp_without_timezone_treated_as_utc`;
7. preserves source truncation metadata; and
8. refuses to mark counts authoritative when a requested control order is expected but missing from the window.

The patch preserves existing SCAN1/SCAN2 response safety fields:

- `writes_performed:false`
- `pii_returned:false`
- `raw_payloads_returned:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`

## 7. Control-order validation

`WINDOWED_ORDER_SURFACE_SCAN` now accepts optional control metadata:

```json
{
  "control_order_number": "NV-MQHJR3V2",
  "control_customer_app_order_id": "6a321cbfd8d78863f15de956"
}
```

The response includes:

- `control_order_found_exact`
- `control_order_found_unfiltered`
- `control_order_found_in_window`
- `control_order_expected_in_window`
- `control_order_validation_passed`
- `window_filter_contract_validated`
- `filter_discrepancy_detected`
- canonical timestamp field/value metadata
- before/after source-row counts

If a control order is expected in the requested window but is not present after filtering, the scan returns:

- `scan_complete:false`
- `scan_incomplete_reasons:["known_control_order_missing_from_expected_window"]`
- `next_action:"inspect_window_filter_contract"`

Readiness counts must not be used for G43E/G43F decisions in that state.

## 8. Truncation limitations

Bounded reads still have limited coverage. If a source read is truncated:

- full-fleet coverage is not claimed;
- missing related context is not treated as definitive;
- `bounded_scan_context_not_found` remains the safe classification when related context may exist outside the bounded read; and
- operators should split windows or run exact follow-up previews before making eligibility decisions.

The control-order validation proves the window filter contract for the requested control case; it does not by itself prove complete fleet coverage when source reads are truncated.

## 9. Test coverage

Added harness:

```text
scripts/migration/run-g43d-scan3-window-filter-semantics-tests.mjs
```

Coverage includes:

1. exact control id lookup;
2. canonical timestamp field selection;
3. expected control order inclusion;
4. unsupported server-side range syntax not being trusted;
5. in-memory fallback inclusion;
6. America/Chicago to UTC boundary conversion;
7. inclusive start and exclusive end behavior;
8. created/updated dedupe;
9. expected-control-missing incomplete scan behavior;
10. zero-row plausibility only when control validation supports it;
11. source truncation reporting;
12. no per-order query loop;
13. no PII or raw payload output;
14. no writes;
15. no provider calls;
16. no notifications; and
17. no Hub mutation.

Regression coverage remains required before merge:

- G43D-SCAN2
- G43D-SCAN1
- G43D fixture harness
- G43A
- G43B
- G43C
- relevant G33C/G35/G36/G39/G27 harnesses
- scoped ESLint
- build
- diff/scope/mutation/privacy scans

## 10. No-write policy

SCAN3 is an admin-authenticated read-only preview hardening patch. It must not:

- mutate `Order`;
- mutate `ShopifyOrder`;
- mutate `FulfillmentTask`;
- create logs or queues;
- call Stripe;
- call Shopify;
- call delivery or payment providers;
- send notifications;
- mutate Hub;
- run sync/repair/replay; or
- change G43B/G43C gates or allowlists.

## 11. Recommendation

After merge, publish only `previewNativeOrderCutoverReadiness` and validate in this order:

1. boundary verify;
2. run a tiny control window containing `NV-MQHJR3V2`;
3. require `control_order_validation_passed:true` and `window_filter_contract_validated:true`;
4. rerun recent-seven-days only;
5. perform no-write verification; and
6. run broader windows only after the control order appears in the expected window and source coverage is not materially truncated.

Until that post-merge control validation passes:

```text
No broad G43E/G43F.
Keep all current exact allowlists unchanged.
```
