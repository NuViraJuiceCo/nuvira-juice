# G48E-RUNTIME2 — Compact Admin Order Lifecycle Read-Model Response

## 1. Runtime1 finding

G48E-RUNTIME1 proved that the deployed `getAdminOrdersWithHub` source was executing, the function-local lifecycle helper was deployed, and `diagnostic_mode=G48E_RUNTIME_CONTRACT` returned safely for admin-only requests. It also proved the explicit request shape was reaching the function.

The failure was the explicit lifecycle request contract. `read_model_mode=ADMIN_ORDER_LIFECYCLE` still fell through to the full legacy admin-order response. That response includes the large legacy `orders[]` payload and was truncated by the SDK/transport before the trailing G48E capability metadata could be parsed.

Observed failure:

```text
parse_error=Unterminated string in JSON at position 66130
```

## 2. Why metadata-first ordering is insufficient

Moving G48E metadata before `orders[]` would not fix the contract. If the response body is truncated, the entire JSON document remains invalid and no caller can reliably parse the metadata. The fix must avoid the large legacy payload in explicit lifecycle mode.

## 3. Selected compact explicit-mode contract

Requests with:

```text
read_model_mode=ADMIN_ORDER_LIFECYCLE
```

now use a dedicated compact response path after authentication, admin authorization, request parsing, and feature-gate evaluation.

When the backend feature is disabled, the response is intentionally small and contains only capability metadata and safety flags:

```json
{
  "success": true,
  "dry_run": true,
  "writes_performed": false,
  "read_model_mode": "ADMIN_ORDER_LIFECYCLE",
  "admin_order_lifecycle_read_model_available": true,
  "admin_order_lifecycle_read_model_enabled": false,
  "admin_order_lifecycle_read_model_version": "g48e_admin_order_lifecycle_v1",
  "read_model_payload_present": false,
  "legacy_orders_payload_included": false,
  "response_contract": "g48e_compact_read_model_v1",
  "pii_returned": false,
  "raw_payloads_returned": false,
  "provider_call_impact": false,
  "stripe_calls": false,
  "shopify_calls": false,
  "hub_calls": false,
  "notifications_sent": false,
  "order_mutation_performed": false,
  "native_order_mutation_performed": false,
  "fulfillment_task_mutation_performed": false,
  "payment_mutation_performed": false,
  "refund_mutation_performed": false,
  "repair_replay_performed": false,
  "hub_write_suppression_ready": false
}
```

It omits:

- `orders[]`
- Hub order rows
- customer details
- payment details
- raw filters
- native record ids
- legacy pagination payload
- Runtime1 diagnostic-only fields

## 4. Disabled response behavior

With G48E disabled, the explicit compact path returns before loading entity lists. It avoids loading:

- Customer App `Order`
- native `ShopifyOrder`
- `FulfillmentTask`
- Hub order lists
- review/sync/parity lists

This makes capability detection deterministic and inexpensive while preserving the default-off backend gate.

## 5. Future enabled response

When `ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL` is enabled and the kill switch is not active, the same explicit mode returns:

- compact capability metadata
- `admin_order_lifecycle_read_model`
- no legacy `orders[]`
- no legacy Hub merge payload
- no unrelated admin-order response sections

The lifecycle payload remains bounded by the function-local read model contract. Read readiness still does not imply command/write readiness.

## 6. Legacy response isolation

Requests without `read_model_mode` continue through the legacy admin-order path. That preserves:

- existing `orders[]`
- counts and diagnostics already present in the legacy response
- ordering, filtering, search, and pagination behavior consumed by `AdminOrders.jsx`
- Hub-only valid rows
- existing admin action references

The compact path is additive and explicit. Unknown modes do not select the compact lifecycle path. Conflicting mode fields fail closed with a compact safe error.

## 7. AdminOrders compatibility

The unpublished `AdminOrders.jsx` integration now separates concerns:

1. The ordinary `admin-orders` query calls `getAdminOrdersWithHub` with no `read_model_mode` and continues to receive legacy `orders[]`.
2. A separate `admin-order-lifecycle-read-model` query calls the explicit lifecycle mode and consumes only capability metadata plus the canonical lifecycle payload when backend-enabled and version-compatible.

Disabled compact responses preserve existing page behavior because the page no longer expects `orders[]` from the explicit lifecycle request.

The Runtime1 diagnostic remains hidden from the UI.

## 8. Response-size and serialization safeguards

The Runtime2 harness uses a synthetic large legacy order fixture to prove:

- legacy data can be substantially larger than the compact response
- disabled compact response contains no legacy rows
- compact response serializes and parses as valid JSON
- capability metadata is not dependent on field order
- future enabled fixture response remains bounded

No specific Base44 response-size limit is claimed because the platform limit is not documented here.

## 9. Diagnostic retention

`diagnostic_mode=G48E_RUNTIME_CONTRACT` remains in place until the compact response is verified live. It remains:

- admin-only
- static/read-only
- before entity reads
- free of customer/order payloads
- absent from AdminOrders UI

A later cleanup phase can remove it after stable deployed verification.

## 10. Test coverage

Added:

```text
scripts/migration/run-g48e-runtime2-compact-read-model-response-tests.mjs
```

Updated the existing G48E consolidation harness so the explicit disabled request now expects compact metadata rather than legacy `orders[]`.

Coverage includes:

- legacy no-mode response unchanged
- explicit compact path selected
- disabled compact metadata
- `orders[]` excluded from compact response
- disabled explicit mode avoids entity reads
- valid JSON serialization
- large legacy fixture isolation
- unknown/conflicting mode behavior
- diagnostic retention
- admin authorization
- future enabled fixture contract
- no writes, provider calls, notifications, repair/replay, logs/queues, PII, or raw payloads

## 11. Publish plan

PR prep only. No Base44 or Builder publish occurs in this phase.

After merge:

1. Publish only `getAdminOrdersWithHub`.
2. Keep G48E disabled.
3. Invoke Runtime1 diagnostic.
4. Invoke explicit compact lifecycle mode.
5. Confirm response is parseable and omits `orders[]`.
6. Confirm legacy request remains unchanged.
7. Run no-write verification.
8. Only then publish the already-merged AdminOrders UI from clean source.

## 12. No-write policy

This phase does not:

- activate G48E
- publish AdminOrders UI
- mutate `Order`, `ShopifyOrder`, or `FulfillmentTask`
- change admin write actions
- call Hub, Stripe, Shopify, or providers
- send notifications
- run repair/replay
- create logs/queues
- change schemas/entities
- modify Apple Pay PR #545

## 13. UI publish prerequisite

AdminOrders UI remains unpublished until the backend compact response is deployed-disabled and verified live. The UI must only be published from clean source after backend explicit-mode parsing is proven.

## 14. Classification

```text
admin_order_lifecycle_compact_runtime_contract_pr_ready
```
