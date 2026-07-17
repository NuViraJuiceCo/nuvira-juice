# G48E-RUNTIME4 — Paginated Admin Order List and Exact Detail Contract

## 1. RUNTIME3 SDK truncation evidence

G48E-RUNTIME3 proved that the official compact HTTP response was valid JSON but still too large for the Base44 SDK adapter path used by AdminOrders:

- official compact HTTP response: valid JSON, 72,143 bytes, 28 orders;
- SDK compact response: 65,597 bytes, truncated mid-string, invalid JSON;
- classification: `hard_stop_admin_order_compact_list_sdk_transport_regression`.

The RUNTIME4 decision is to stop shrinking one all-orders payload and split transport into a bounded page plus exact detail.

## 2. Field-usage audit

| Field group | Classification | Contract |
| --- | --- | --- |
| order number, created date, status, payment status, captured flag, order type, fulfillment type, delivery date, total | list_required | `ADMIN_ORDER_LIST_PAGE` |
| small item count/summary | list_required | `ADMIN_ORDER_LIST_PAGE` |
| customer name/email/phone/address already used by admin list search/display | list_required, admin-safe existing PII | `ADMIN_ORDER_LIST_PAGE` |
| Customer App id, Hub id, native order id, fulfillment number, task ids | action_reference_required | list includes minimum references; detail includes full exact references |
| full line items, notes, native task summary details, sync log, review queue detail, Hub operations detail, proof/drop/timeline context | detail_required | `ADMIN_ORDER_DETAIL_COMPACT` |
| raw Hub/Shopify/Stripe/provider payloads and payment method details | sensitive / raw payload | excluded |
| repeated full native/task/order objects and large nested diagnostics | large_nested | excluded from list; bounded to one order detail when needed |

## 3. Pagination strategy

`ADMIN_ORDER_LIST_PAGE` uses a deterministic sorted merged row set, then returns one bounded page. The cursor is opaque base64 JSON containing the sort field, sort direction, last index, created date, order number, and id. The id/order number tie-breaker prevents duplicate page-boundary rows when timestamps are equal.

The current backend still assembles the full canonical merged set before slicing. Therefore:

```text
source_reads_bounded=false
response_transport_bounded=true
```

This PR only solves SDK transport safety. It does not claim scalable backend source pagination.

## 4. Page-size safety budget

```text
default_page_size=10
maximum_page_size=10
response_size_budget=32000 bytes
```

The budget is a conservative test budget, not a claimed Base44 platform limit. Caller-supplied page sizes are capped.

## 5. List response contract

Mode:

```text
response_mode=ADMIN_ORDER_LIST_PAGE
response_contract=g48e_admin_order_list_page_v1
```

Response includes:

- `success`
- `orders`
- `page_size`
- `returned_count`
- `total_count`
- `total_count_known`
- `has_more`
- `next_cursor`
- `sort`
- `filters_applied`
- `source_counts`
- `source_truncated`
- `fallback_active`
- `warnings`
- `writes_performed:false`

Rows include only bounded list fields and minimum action references. They exclude full line items, timelines, raw payloads, repeated task objects, debug diagnostics, and payment-method details.

## 6. Exact detail response contract

Mode:

```text
response_mode=ADMIN_ORDER_DETAIL_COMPACT
response_contract=g48e_admin_order_detail_compact_v1
```

The request requires exact identifiers:

```text
customer_app_order_id=<exact id>
order_number=<exact normalized order number>
```

The detail contract rejects missing, not-found, or ambiguous identity. It does not match by customer name, phone, email, approximate date, or approximate total.

## 7. Action-reference policy

Customer App Order remains canonical. The paginated list keeps the minimum references needed for existing frozen/admin controls. Heavy panels and Hub/native detail are loaded only for the selected order. No backend action contract changes in RUNTIME4.

If a future action requires a field moved out of the list, the UI must fetch exact detail before showing/enabling the action or immediately before invoking it and confirm the canonical order has not changed.

## 8. Hub/fallback parity

The underlying merge path remains unchanged. Across complete page sequences, the contract preserves:

- Hub-only valid rows;
- refunded/cancelled rows;
- subscription and multi-delivery rows;
- historical late mirrors;
- review/repair-held rows;
- original chronology;
- existing totals and statuses.

Known controls remain required once across the complete paginated set:

```text
NV-MQHJR3V2
NV-MPZNKGNT
NV-MP5SOQLJ
```

## 9. AdminOrders integration

AdminOrders now uses three separate requests:

1. `ADMIN_ORDER_LIST_PAGE` for displayed rows;
2. `ADMIN_ORDER_DETAIL_COMPACT` for expanded row detail;
3. `ADMIN_ORDER_LIFECYCLE` for the backend-disabled lifecycle capability/read model.

AdminOrders no longer requests the large legacy no-mode SDK response or the full all-orders compact SDK response for displayed rows.

## 10. Legacy contract preservation

Preserved:

- no-mode legacy response;
- full `ADMIN_ORDER_LIST_COMPACT` diagnostic/compatibility response;
- RUNTIME1 diagnostic;
- compact lifecycle response.

## 11. Tests

The RUNTIME4 harness covers pagination, cursor safety, filters/search/sorting, Hub/fallback row preservation, exact detail, AdminOrders integration, legacy contract preservation, and no-write/no-provider/no-notification guarantees. RUNTIME1/RUNTIME2/RUNTIME3 regressions are also required.

## 12. Backend-first publish plan

After merge:

1. publish only `getAdminOrdersWithHub`;
2. verify one list page through official endpoint and SDK;
3. verify all pages together match official legacy order set;
4. verify exact detail through SDK;
5. run no-write verification;
6. only then publish AdminOrders UI.

## 13. UI publish prerequisites

UI publish is allowed only when:

- page response parses through SDK;
- every page stays under the safety budget;
- complete paginated set matches the official legacy order set;
- exact detail parses through SDK;
- no valid rows or action references are omitted;
- lifecycle model remains disabled;
- no-write verification passes.

## 14. No-write policy

RUNTIME4 does not mutate Order, ShopifyOrder, FulfillmentTask, payment/refund/subscription/delivery records, Hub records, logs, queues, notifications, inventory, or PurchaseOrders. It does not call Stripe, Shopify, delivery providers, or new Hub write/suppression paths.

## 15. Classification

Expected PR-prep classification:

```text
admin_order_paginated_compact_contract_pr_ready
```
