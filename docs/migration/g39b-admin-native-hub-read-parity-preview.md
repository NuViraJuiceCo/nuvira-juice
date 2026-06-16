# G39B — Admin native-first Hub read parity preview

## Executive summary

G39B adds a read-only parity preview for admin/order read surfaces. The preview compares native Customer App backend records against local Hub-fallback/sync context and reports which admin reads are candidates for a future native-first patch.

This phase does **not** change admin runtime behavior. Hub remains active, Hub fallback remains enabled, and no Hub write suppression is introduced.

## Target admin surfaces

The parity mode covers these admin/read surfaces:

| Surface | Existing function | Current pattern | G39B scope |
| --- | --- | --- | --- |
| Admin orders | `getAdminOrdersWithHub` | Hub-primary/merged with local and native context | Compare safe order status, payment, fulfillment, production, delivery, line count, and source/fallback status. |
| Operations dashboard | `getAdminOperationsDashboardSummary` | Hub summary with native fallback | Aggregate native and local Hub-fallback presence. |
| Delivery route summary | `getAdminDeliveryRouteSummary` | Hub delivery queue with native schedule reconciliation | Compare task status/date fields and flag stale Hub fallback dates. |
| Production planning | `getAdminProductionPlanningSummary` | Hub planning summary merged with native production context | Compare production status, production date, product demand count, and native batch count. |
| Ops alerts | `getAdminOpsAlertsSummary` | Hub alerts with native fallback | Compare alert/review/sync/parity aggregate presence. |
| Resources | `getAdminResourcesSummary` | Hub resources with native fallback | Preview-only until team/equipment native field parity is proven. |
| Calendar events | `getAdminCalendarEventsSummary` | Hub calendar with native fallback | Compare native date/event/compliance aggregate presence. |

Customer-facing surfaces are intentionally out of scope and are held until separate customer-facing parity proof exists.

## Preview mode

Implemented on the existing read-only preview function:

- Function: `previewNativeOrderCutoverReadiness`
- Preview mode: `ADMIN_NATIVE_FIRST_HUB_READ_PARITY`

Example request:

```json
{
  "preview_mode": "ADMIN_NATIVE_FIRST_HUB_READ_PARITY",
  "surface": "all",
  "max_rows": 10,
  "request_id": "g39b_admin_native_hub_parity_<timestamp>"
}
```

Supported `surface` values:

- `all`
- `admin_orders`
- `operations_dashboard`
- `delivery_route_summary`
- `production_planning`
- `ops_alerts`
- `resources`
- `calendar_events`

Optional filters:

- `order_number`
- `customer_app_order_id`
- `native_shopify_order_id`
- `native_fulfillment_task_id`
- `date_from`
- `date_to`
- `max_rows`

## Parity field model

### Admin orders / order lists

Comparable safe fields:

- `order_number`
- `customer_app_order_id`
- `native_shopify_order_id`
- safe Hub order id when locally present
- `order_status`
- `payment_status`
- `payment_captured`
- `fulfillment_type`
- `fulfillment_status`
- `production_status`
- `delivery_status`
- `delivery_date`
- `line_item_count`
- `total_price`
- source/fallback classification

### Delivery route summary

Comparable safe fields:

- `order_number`
- `native_fulfillment_task_id`
- safe Hub task id when locally present
- `delivery_date`
- `scheduled_date`
- `assigned_delivery_date`
- task status
- `delivery_status`
- `production_status`
- route/drop/proof presence only
- data source/fallback status

The preview does not return raw proof, drop, route, address, phone, or driver payloads.

### Production planning

Comparable safe fields:

- `order_number`
- `production_date`
- `product_demand_count`
- native `ProductionBatch` count
- `production_status`
- master-data/procurement readiness indicator when available
- blockers/warnings

### Ops alerts / resources / calendar

Comparable safe fields are aggregate counts and date/event summaries only. No raw Hub payloads are returned.

## Classifications

Rows and surfaces use these classifications:

- `native_first_ready`
- `native_first_ready_with_hub_fallback`
- `native_missing_hub_available`
- `native_present_hub_missing`
- `native_hub_match`
- `native_hub_mismatch`
- `stale_hub_fallback_detected`
- `hub_only_for_now`
- `missing_native_field`
- `missing_native_entity`
- `unsafe_to_cutover`
- `customer_facing_hold`
- `write_path_not_in_scope`
- `unknown_needs_manual_review`

## Cutover readiness rules

Each surface returns one of:

- `ready_for_native_first_patch`
- `ready_with_fallback_reporting`
- `preview_only_more_fields_needed`
- `unsafe_customer_facing`
- `hub_source_of_truth_for_now`
- `blocked_by_missing_native_schema`
- `blocked_by_missing_native_data`
- `blocked_by_write_path_dependency`

A surface is only a low-risk native-first patch candidate when native rows are present, mismatches are absent, and Hub fallback reporting can remain explicit.

## Harness results

Added fixture-only harness:

```bash
node scripts/migration/run-g39b-admin-native-hub-read-parity-tests.mjs
```

Result:

- total test cases: 14
- passed: 14
- failed: 0

Covered cases:

1. Native and Hub order rows match → `native_hub_match`.
2. Native missing, Hub available → `native_missing_hub_available`.
3. Native present, Hub missing → `native_present_hub_missing`.
4. Status mismatch → `native_hub_mismatch`.
5. Stale Hub fallback delivery row → `stale_hub_fallback_detected`.
6. Admin orders surface reports fallback/more-field readiness.
7. Delivery route summary requires fallback reporting when stale fallback is present.
8. Production planning classifies missing native batch context.
9. Customer-facing surface is held.
10. `provider_call_impact:false`.
11. `pii_returned:false`.
12. `writes_performed:false`.
13. No logs/queues are created.

## Live preview results

No live preview was run during PR prep. After merge and scoped publish, run with a small row limit:

```json
{
  "preview_mode": "ADMIN_NATIVE_FIRST_HUB_READ_PARITY",
  "surface": "all",
  "max_rows": 10,
  "request_id": "g39b_live_admin_native_hub_parity_<timestamp>"
}
```

Expected:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `surfaces_checked` returned
- `parity_summary` returned
- no customer PII
- `provider_call_impact:false`
- `hub_mutation_performed:false`
- blockers/warnings returned

## No-write policy

G39B is read-only. It does not:

- change admin runtime behavior
- change customer-facing runtime behavior
- suppress Hub writes
- disable Hub fallback
- mutate Customer App records
- mutate native records
- mutate Hub records
- call Stripe, Shopify, Hub, or providers externally
- send notifications
- run sync, retry, repair, or replay
- open gates
- create `OrderSyncLog`, `CommandLog`, `OrderReviewQueue`, notification rows, or message logs
- deduct inventory
- create PurchaseOrders

## Next recommended patch surface

After live preview evidence exists, choose the lowest-risk admin-only surface with either:

1. `ready_for_native_first_patch`, or
2. `ready_with_fallback_reporting` and low/medium risk with explicit Hub fallback counts.

Recommended next phase:

- **G39C** — native-first admin patch plan for the lowest-risk admin surface found by G39B.

Do not patch customer-facing order history/tracker surfaces until separate customer-facing parity proof exists.
