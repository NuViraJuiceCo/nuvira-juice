# G43D-SCAN4: Customer Order Source Coverage Audit

## 1. Executive summary

G43D-SCAN3 validated the window timestamp semantics for Customer App `Order` rows. The control order `NV-MQHJR3V2` was found when the scan used bounded source lists plus in-memory timestamp filtering, with timezone-less stored timestamps treated as UTC.

SCAN4 addresses the remaining blocker: the pre-filter `Order` source lists can still be materially truncated before in-memory filtering runs. A valid timestamp filter is not enough if the source list does not reach the intended horizon.

This phase adds an admin-authenticated, read-only `ORDER_SOURCE_COVERAGE_AUDIT` mode under the existing `CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS` preview mode. It audits source depth, deterministic ordering, control-order presence, and real pagination metadata without changing customer behavior or G43B/G43C live configuration.

## 2. SCAN3 validated filter semantics

Validated SCAN3 contract:

```text
window_start <= canonical_timestamp < window_end
```

Canonical Customer App `Order` timestamp fields:

| Purpose | Field |
| --- | --- |
| created timestamp | `created_date` |
| updated timestamp | `updated_date` |

Timestamp policy:

```text
timezone-less stored timestamps are treated as UTC
```

Selected SCAN3 strategy:

```text
bounded list read + in-memory timestamp filtering
```

## 3. Why narrower windows alone are insufficient

In SCAN3, recent-seven-day validation correctly found `NV-MQHJR3V2`, but both pre-filter `Order` reads returned the requested 25-row limit. That means the scan reached the local bounded source cap before in-memory date filtering.

A smaller date window cannot recover rows that were never loaded into memory. The coverage question is therefore separate from timestamp correctness:

1. timestamp filtering must be correct; and
2. the bounded source list must be deep enough, or safely paginated, to cover the intended horizon.

SCAN4 audits the second requirement.

## 4. Actual Base44 list-limit / pagination behavior from source audit

Repository evidence shows Base44 entity reads are used as bounded calls such as:

```text
entity.list(sort, limit)
entity.filter(filter, sort, limit)
```

No repository source establishes a supported Customer App `Order` cursor, offset, page, or continuation-token contract for entity lists. Existing migration harnesses model bounded lists and filters, not real pagination.

SCAN4 therefore does not invent cursor/page/offset parameters. It treats pagination as unsupported unless a real entity response includes explicit continuation metadata such as a next cursor/page token.

SCAN4 uses a conservative source-depth limit:

```text
created_order_limit <= 100
updated_order_limit <= 100
```

This is a safe audit maximum, not a claim that the Base44 platform has no higher limit.

## 5. Source coverage contract

`ORDER_SOURCE_COVERAGE_AUDIT` request shape:

```json
{
  "preview_mode": "CUSTOMER_ORDER_SURFACE_GENERALIZED_READINESS",
  "mode": "ORDER_SOURCE_COVERAGE_AUDIT",
  "created_order_limit": 100,
  "updated_order_limit": 100,
  "related_entity_limit": 100,
  "control_order_number": "NV-MQHJR3V2",
  "control_customer_app_order_id": "6a321cbfd8d78863f15de956",
  "request_id": "g43d_scan4_order_source_coverage_<timestamp>"
}
```

Response metadata includes:

- `scan_complete`
- `coverage_complete`
- `scan_incomplete_reasons`
- `rate_limit_detected`
- `pagination_supported`
- `pagination_strategy`
- requested/effective limits
- returned counts
- source truncation flags
- continuation metadata only if actually present
- before/after dedupe counts
- oldest/newest created and updated timestamps returned
- control validation summaries
- safety flags proving read-only behavior

The response does not return customer names, emails, phone numbers, addresses, raw records, raw Hub payloads, raw provider payloads, or payment method details.

## 6. Coverage-complete rules

Coverage is complete only when all are true:

1. created source read succeeds;
2. updated source read succeeds;
3. returned count is below the effective created limit;
4. returned count is below the effective updated limit;
5. no possible silent server cap is detected;
6. deterministic created ordering is verified;
7. deterministic updated ordering is verified;
8. known-control validation passes;
9. no continuation metadata is present; and
10. no rate limit/source failure occurs.

Coverage remains incomplete when:

- returned count equals the effective limit;
- a likely silent cap is detected;
- a continuation token is present but not processed;
- a control expected in the source horizon is missing;
- ordering is unstable;
- any required read fails; or
- any required read is rate-limited.

SCAN4 never equates `100 returned` with `all records`.

## 7. Pagination support finding

Current implementation does not assume pagination support. It reports:

```text
pagination_strategy: unsupported_no_repository_or_entity_metadata_contract
```

unless the entity response includes explicit next-page metadata. If metadata appears, SCAN4 reports it but does not loop through pages in one invocation.

If a caller supplies a continuation token before a real contract is implemented, the scan fails closed with:

```text
continuation_token_not_supported_by_current_entity_list_contract
```

This prevents accidental invented pagination.

## 8. Known-control strategy

SCAN4 validates safe controls without returning raw records or customer identity:

| Control | Purpose |
| --- | --- |
| `NV-MQHJR3V2` | recent active coverage/control order |
| `NV-MPZNKGNT` | delivered/reconciled coverage |
| `NV-MP5SOQLJ` | historical/late-mirror chronology coverage |

For each control, the response returns only:

- `order_number`
- whether the exact control was found;
- whether it was expected in the source horizon;
- whether it was found in the source horizon;
- canonical timestamp;
- canonical timestamp field names; and
- validation pass/fail.

Exact Customer App ids are not returned in broad coverage output.

## 9. Incomplete-coverage behavior

When coverage is incomplete, SCAN4 returns:

```text
coverage_complete:false
readiness_counts_authoritative:false
generalized_readiness_counts_claimed:false
```

No generalized customer-order readiness counts should be used for G43E/G43F planning from incomplete coverage.

Recommended action for incomplete coverage:

1. retain exact G43B/G43C allowlists;
2. use exact candidate previews for known orders; or
3. implement a proven, bounded pagination contract if Base44 exposes one.

## 10. Test coverage

Added harness:

```text
scripts/migration/run-g43d-scan4-order-source-coverage-tests.mjs
```

Coverage includes:

1. limit clamping;
2. non-truncated bounded source completion;
3. full-limit incomplete coverage;
4. silent cap detection;
5. deterministic created ordering;
6. deterministic updated ordering;
7. created/updated dedupe by Customer App Order id;
8. known recent control found;
9. missing expected control incomplete coverage;
10. real pagination metadata reporting;
11. unsupported pagination not invented;
12. one-page-per-request behavior;
13. continuation token rejection until a real contract exists;
14. rate-limit handling;
15. source failure handling;
16. no authoritative readiness counts from incomplete coverage;
17. no PII;
18. no raw records;
19. no writes;
20. no provider calls;
21. no notifications;
22. no Hub mutation; and
23. G43B/G43C live allowlists unchanged.

Regression coverage remains required for:

- G43D-SCAN3
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

## 11. Hard stops

Do not:

- broaden G43B/G43C allowlists;
- add `NV-MPZNKGNT` to G43C without owning-customer smoke;
- activate G43E/G43F from incomplete source coverage;
- mutate `Order`, `ShopifyOrder`, or `FulfillmentTask`;
- create logs or queues;
- call Stripe, Shopify, Hub, or other providers;
- send notifications;
- run sync/repair/replay;
- expose PII or raw payloads; or
- invent cursor/page/offset semantics.

## 12. Recommendation

After merge, publish only `previewNativeOrderCutoverReadiness`, boundary verify, and run one live `ORDER_SOURCE_COVERAGE_AUDIT` at the deepest safe limit.

Proceed toward G43E only if source coverage is complete and clean history candidates exist outside the current G43B allowlist.

Keep G43F held until generalized history behavior is proven live.

If coverage remains incomplete, retain exact allowlists and move to exact candidate previews or another migration domain.
