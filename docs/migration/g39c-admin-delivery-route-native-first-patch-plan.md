# G39C — Admin delivery route native-first patch plan

## 1. Executive summary

G39C selects `getAdminDeliveryRouteSummary` as the first admin read surface for a future native-first runtime patch. This document is a docs-only implementation plan. It does not change runtime behavior, admin UI behavior, customer-facing behavior, Hub fallback, schemas, gates, or live data.

G39B live parity evidence made delivery route summary the lowest-risk G39C target:

- admin-only surface
- read-only aggregation function
- native rows already available
- no live G39B mismatches for sampled delivery route rows
- existing stale Hub fallback suppression already exists in the current function
- Hub fallback reporting can remain explicit

The future G39D patch should make native delivery route rows primary while retaining Hub fallback for missing or incomplete native data.

## 2. G39B evidence

G39B live preview:

- request id: `g39b_live_admin_native_hub_parity_20260616T051416Z`
- preview mode: `ADMIN_NATIVE_FIRST_HUB_READ_PARITY`
- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `pii_returned:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- blockers: `[]`

G39B delivery route surface result:

| Field | Value |
| --- | --- |
| Surface | `delivery_route_summary` |
| Readiness | `ready_for_native_first_patch` |
| Risk | low |
| Native row count | 2 |
| Hub row count | 0 |
| Exact match count | 0 |
| Native-only count | 2 |
| Mismatch count | 0 |
| Fallback required count | 0 |
| Stale Hub fallback count | 0 |
| Classifications | `native_present_hub_missing` |

G39B identified native delivery rows for `NV-MP5SOQLJ` and `NV-MPZNKGNT`, both using native `FulfillmentTask` context. No Hub route row was needed for those sampled rows.

## 3. Why `getAdminDeliveryRouteSummary` is selected

`getAdminDeliveryRouteSummary` is the best first native-first admin read candidate because it is:

1. Admin-only.
2. Read-only.
3. Already partly native-aware.
4. Already contains native-vs-Hub reconciliation logic.
5. Already reports `data_sources` and `hub_fallback_reconciliation` metadata.
6. Isolated to a single backend function and one known admin page consumer.
7. Lower risk than admin order lists, operations dashboard, ops alerts, or resources.

Do not target these first:

- `getAdminOrdersWithHub`: medium risk; live G39B found mismatches and fallback-required rows.
- `getAdminOperationsDashboardSummary`: aggregate mismatch.
- `getAdminOpsAlertsSummary`: aggregate mismatch.
- `getAdminResourcesSummary`: missing team/equipment native parity.

Secondary candidates after delivery route summary:

- `getAdminProductionPlanningSummary`
- `getAdminCalendarEventsSummary`

## 4. Current behavior audit

### Function audited

- `base44/functions/getAdminDeliveryRouteSummary/entry.ts`

### Admin UI consumer audited

- `src/pages/admin/DeliveryQueue.jsx`

### Current auth and request behavior

The function:

- requires authenticated admin access through `base44.auth.me()`
- returns `401` for unauthenticated requests
- returns `403` for non-admin users
- accepts JSON body input
- supports `delivery_date` / `date`
- supports `limit`, capped at 100
- defaults date to the current Chicago date
- performs no record writes
- creates no logs/queues
- does not call Stripe, Shopify, or delivery providers
- does call the Hub delivery summary endpoint when Hub config is present

### Current native reads

The function reads native/customer app backend data through service-role entity reads:

- `FulfillmentTask.list('-delivery_date', 500)`
- `ShopifyOrder.list('-created_date', 500)`

It builds native route rows from:

1. `FulfillmentTask` rows matching `delivery_date` or `scheduled_date`.
2. Native `ShopifyOrder` rows with delivery dates when no task row already covers the order.
3. Native `ShopifyOrder` rows that appear delivery-eligible but have no assigned delivery date, returned as `unscheduled_delivery_orders`.

Current native row `data_source` values:

- `customer_app_native_task`
- `customer_app_native_order`

### Current Hub reads

If `HUB_API_URL` and `CUSTOMER_APP_SYNC_SECRET` are configured, the function calls:

- Hub function: `getDeliveryRouteSummaryForCustomerApp`
- Method: GET
- Parameters: `delivery_date`, `limit`
- Auth: bearer secret from environment

If Hub is not configured or returns invalid data, the function keeps native data when available and returns a Hub warning.

### Current merge order

The current response builds:

- `hubActive` / `hubCompleted` after Hub reconciliation
- `nativeActive` / `nativeCompleted` excluding order numbers already present in visible Hub rows
- final visible rows as `hub rows first`, then native rows:
  - `deliveryStops = [...hubActive, ...nativeActive]`
  - `completedStops = [...hubCompleted, ...nativeCompleted]`

This means Hub is currently primary for visible rows whenever a Hub row remains after reconciliation. Native is fallback/overlay except when Hub is unavailable or suppressed.

### Current stale Hub suppression

The function already has `reconcileHubRowsWithNativeSchedule`.

For each Hub row:

1. Match a native schedule row by normalized order number.
2. Compare Hub delivery date and native delivery date.
3. Suppress Hub row when native exists and:
   - Hub date differs from native date (`native_schedule_active_hub_fallback_stale_date`), or
   - Hub date is blank or equal to native date (`native_schedule_preferred_hub_duplicate`).
4. Keep Hub row with `hub_fallback_context` only if no conflict exists.

Response metadata already includes:

- `hub_fallback_reconciliation.merge_status`
- `hub_fallback_reconciliation.stale_hub_fallback_detected`
- `hub_fallback_reconciliation.suppressed_hub_row_count`
- `hub_fallback_reconciliation.suppressed_hub_rows`
- `hub_fallback_reconciliation.native_schedule_preferred`

Warnings can include:

- `hub_delivery_queue_service_not_configured`
- `hub_delivery_queue_unavailable:<status>`
- `hub_delivery_queue_unavailable:fetch_failed`
- `hub_delivery_queue_malformed_response`
- `hub_fallback_stale_date_detected`
- `native_schedule_preferred_hub_fallback_rows_suppressed`

### Current response shape

Current top-level response:

- `success`
- `delivery_date`
- `summary`
- `sections.delivery_stops`
- `sections.completed`
- `sections.unscheduled_delivery_orders`
- `data_sources`
- `hub_fallback_reconciliation`
- `warnings`

Current summary fields:

- `total_stops`
- `active`
- `completed`
- `unscheduled`
- `bag_returns`

Current route stop fields from `sanitizeStop`:

- `task_id`
- `order_number`
- `customer_name`
- `fulfillment_number`
- `source_type`
- `assigned_driver`
- `task_status`
- `delivery_status`
- `fulfillment_status`
- `delivery_date`
- `delivery_window_label`
- `delivery_address`
- `items_summary`
- `delivered_at`
- `proof_available`
- `delivery_photo_url`
- `delivery_drop_location`
- `missing_address`
- `bag_return_required`
- `bag_return_count`
- `data_source`
- `hub_fallback_context`

### Current admin UI assumptions

`DeliveryQueue.jsx` currently uses:

- `data.summary`
- `data.sections.delivery_stops`
- `data.sections.completed`
- `data.sections.unscheduled_delivery_orders`
- `data.hub_fallback_reconciliation.suppressed_hub_rows`
- `stop.data_source`
- `stop.task_id`
- `stop.order_number`
- `stop.customer_name`
- `stop.delivery_address`
- `stop.items_summary`
- `stop.delivery_window_label`
- `stop.assigned_driver`
- `stop.task_status`
- `stop.delivery_status`
- `stop.source_type`
- `stop.missing_address`
- `stop.proof_available`
- `stop.delivery_photo_url`
- `stop.delivered_at`
- `stop.delivery_drop_location`

The page labels `customer_app_native_task` as “Native Task”, `customer_app_native_order` as “Native Order”, and `hub` as “Hub”.

### Current PII / proof behavior

This surface is admin-only and already returns limited operational route fields required by the admin route UI:

- customer display name
- delivery address string
- optional proof photo URL
- optional drop location string

G39D must not expand this contract. If a future cutover wants stricter address/proof masking, that should be a separate admin UX/privacy phase because the current route UI depends on these fields.

G39D must not return:

- customer email
- customer phone
- raw Hub payloads
- raw provider payloads
- raw payment payloads
- secrets/auth values
- new proof/drop raw payloads beyond current URL/drop fields

## 5. Proposed native-first read order

Future G39D should change read priority only. It should not change write behavior.

Proposed algorithm:

1. Parse and validate admin request as today.
2. Read native `FulfillmentTask` rows for the requested date/range.
3. Read native `ShopifyOrder` rows for enrichment and unscheduled delivery orders.
4. Build native route rows first:
   - task-backed rows from `FulfillmentTask`
   - order-backed rows from native `ShopifyOrder` only when no task row exists
   - unscheduled delivery rows from native `ShopifyOrder`
5. Fetch Hub route summary only as fallback context when configured.
6. Reconcile Hub rows against native rows by normalized `order_number`.
7. For each order/date:
   - prefer native row when native route row is complete enough for the route UI
   - suppress stale Hub row when native corrected date exists
   - dedupe same-order/same-date Hub duplicate
   - retain Hub-only row when native route row is missing
   - retain Hub fallback metadata when native row is incomplete
8. Return visible rows in native-first order:
   - native primary rows
   - Hub fallback rows where needed
9. Return explicit fallback report:
   - `native_row_count`
   - `hub_fallback_row_count`
   - `suppressed_hub_row_count`
   - `fallback_required`
   - `fallback_reason`
   - `data_source` per row
   - `fallback_source` per row where applicable
   - `stale_hub_fallback_detected`
10. Preserve existing response shape and add metadata only in additive fields.

Hard requirements:

- never write records
- never create logs/queues
- never call Stripe, Shopify, or providers
- never send notifications
- never mutate Hub
- keep Hub fallback available and reported

## 6. Route row contract for G39D

Future native-first rows should preserve the current admin route row contract and may add safe metadata.

### Safe fields to preserve or add

- `task_id`
- `order_number`
- `customer_app_order_id` when schema-safe and already admin-safe
- `native_shopify_order_id` when schema-safe
- `native_fulfillment_task_id` when schema-safe
- `hub_task_id` only for Hub fallback rows and only when safe
- `customer_name` as currently returned by admin route UI
- `delivery_address` as currently required by admin route UI
- `delivery_date`
- `scheduled_date`
- `assigned_delivery_date`
- `delivery_window_label`
- `task_status`
- `delivery_status`
- `production_status` if available
- `fulfillment_status`
- `fulfillment_type` / `fulfillment_method` if available
- `payment_status` only if already admin-visible and schema-safe
- `line_item_count`
- `items_summary`
- `assigned_driver`
- `route/stop status` if safe
- `proof_available` boolean
- `delivery_photo_url` only because current admin route contract already exposes it
- `delivery_drop_location` only because current admin route contract already exposes it
- `data_source`
- `fallback_source`
- `fallback_reason`
- `hub_fallback_context`
- `stale_hub_fallback_suppressed`
- `warnings`

### Fields not allowed

G39D must not newly expose:

- customer email
- customer phone
- full raw customer profile
- raw Hub payloads
- raw provider payloads
- raw payment payloads
- secrets/auth values
- raw proof/drop payloads beyond current admin route fields
- Stripe IDs
- Shopify provider IDs beyond existing safe native record IDs if needed

### Address parity note

`DeliveryQueue.jsx` currently uses `delivery_address` for display, route manifest copy, and map route links. Therefore G39D cannot remove address strings without a separate UI redesign. Native-first is safe only if native rows can populate the same admin-only address field or use Hub fallback when native address is incomplete.

## 7. Fallback behavior contract

Fallback must be explicit, not silent.

| Case | Admin-visible behavior | Metadata/warning | Safe for G39D? |
| --- | --- | --- | --- |
| `native_route_row_present_no_hub_needed` | Show native row. | `data_source:customer_app_native_task` or `customer_app_native_order`; `fallback_required:false`. | Yes. |
| `native_route_row_missing_hub_fallback_used` | Show Hub row. | `data_source:hub`; `fallback_reason:native_route_row_missing`. | Yes. |
| `native_route_row_incomplete_hub_fallback_used` | Show native row plus fallback metadata, or Hub row only if native row cannot satisfy UI contract. | `fallback_reason:native_route_row_incomplete`; list missing safe fields. | Yes, if additive and clear. |
| `native_corrected_date_suppresses_stale_hub_row` | Show native row for corrected date; do not show stale Hub row in active route list. | `stale_hub_fallback_detected:true`; suppressed row summary. | Yes. |
| `hub_row_stale_date_detected` | Do not show stale Hub row when native corrected row exists. | warning `hub_fallback_stale_date_detected`. | Yes. |
| `duplicate_native_hub_row_deduped` | Show native row once. | `fallback_reason:duplicate_native_hub_row_deduped`. | Yes. |
| `hub_only_row_retained` | Show Hub row so operator does not lose active work. | `data_source:hub`; `fallback_reason:native_missing`. | Yes. |
| `no_route_rows_found` | Empty safe response with summary counts 0. | `fallback_required:false` or Hub warning if Hub unavailable. | Yes. |

Hard rule: G39D must not remove Hub fallback. It should only make native primary with Hub fallback still available and visible.

## 8. Future G39D implementation scope

G39D should be a narrow runtime patch to:

- `base44/functions/getAdminDeliveryRouteSummary/entry.ts` only
- optional helper functions inside the same file
- no schema changes
- no UI changes unless additive metadata already renders safely or is required for explicit fallback reporting
- no provider calls
- no Hub writes
- no record writes
- no notifications
- no sync/repair/replay
- no inventory/PO behavior

Future G39D must:

- keep existing response shape backward compatible
- preserve existing admin route row fields
- add fallback metadata only in additive fields
- preserve current behavior when native data is missing
- report stale/suppressed Hub rows
- retain Hub fallback
- include `request_id` in diagnostics only if safe and only for the response/request context
- return `writes_performed:false` if adding that marker is safe and backward compatible

## 9. Future G39D test plan

Add harness:

```bash
scripts/migration/run-g39d-admin-delivery-route-native-first-tests.mjs
```

Planned positive tests:

1. Native row present -> returned as primary.
2. Hub row absent -> native row still returned.
3. Native row missing and Hub row present -> Hub fallback used.
4. Native corrected date exists and stale Hub row exists -> stale Hub row suppressed.
5. Duplicate native/Hub same order/date -> deduped.
6. Native incomplete row uses Hub fallback metadata.
7. No rows -> empty safe response.
8. Existing response shape remains backward compatible for `DeliveryQueue.jsx`.
9. Existing data source labels still work: `customer_app_native_task`, `customer_app_native_order`, `hub`.
10. Hub fallback reconciliation metadata remains present.

Planned safety tests:

1. No customer email returned.
2. No customer phone returned.
3. No raw Hub payload returned.
4. No raw provider/payment payload returned.
5. Provider calls remain false/not present.
6. `writes_performed:false` if included.
7. No create/update/delete/upsert calls.
8. No `OrderSyncLog`, `CommandLog`, or `OrderReviewQueue` creation.
9. No notifications/messages.
10. No Hub mutation.

Planned regression harnesses:

- G39B admin native-vs-Hub read parity harness
- G33C mirror/task harnesses if row linkage depends on task/native order shape
- G27 native cutover readiness harness if shared preview code is touched
- existing delivery workflow/readiness harnesses if present
- scoped ESLint
- `npm run build`

If historical G32F stale Hub fallback fixtures are still present or recoverable, include them or port the relevant stale-Hub case into the G39D harness.

## 10. Risk assessment

### Low-risk factors

- Admin-only surface.
- Read-only function.
- Live G39B parity found no sampled delivery route mismatches.
- Native `FulfillmentTask` rows are already available for sampled controlled orders.
- Existing stale Hub fallback suppression logic already exists.
- Hub fallback can remain active and visible.
- Rollback is code-only because no data should be written.

### Medium-risk factors

- Route UI depends on address strings and route manifest behavior.
- Route UI currently can display proof photo URL and drop location for completed rows.
- Hub fallback rows may still matter for older dates or unsupported order classes.
- G39B sample size was small.
- Some native rows may be incomplete and require Hub fallback for operational route display.
- Additive fallback metadata must avoid confusing operators.

### High-risk / hard stops

- Removing Hub fallback.
- Hiding active Hub-only route rows.
- Altering customer-facing delivery status.
- Mutating `FulfillmentTask`, `ShopifyOrder`, or Customer App `Order` rows.
- Changing proof/drop/route write behavior.
- Sending notifications.
- Calling providers, Stripe, or Shopify.
- Running sync/repair/replay.
- Exposing new PII or raw payloads.
- Publishing unrelated Builder changes or using Builder Fix All.

## 11. Rollback plan for future G39D

Rollback should be code-only:

1. Revert the G39D `getAdminDeliveryRouteSummary` patch.
2. Republish only `getAdminDeliveryRouteSummary`.
3. Do not run repair, replay, or sync.
4. No data repair should be required because G39D must be read-only.
5. Monitor admin Delivery Queue after deploy for route row counts and fallback warnings.
6. Keep Hub fallback active throughout rollback.

If the native-first ordering causes operator confusion, rollback immediately and keep the current Hub-first merge order until fallback metadata can be improved.

## 12. Hard stops for G39D

Do not proceed with G39D if any audit or test shows:

- native rows cannot supply `delivery_address` and Hub fallback cannot safely fill it
- native rows lack required task/order linkage for active route rows
- active Hub-only rows would be hidden
- stale Hub suppression would suppress without a confident native order match
- route UI requires fields not available from native or fallback rows
- runtime patch would require schema changes
- runtime patch would require UI changes beyond safe additive metadata
- runtime patch would call providers
- runtime patch would mutate records
- runtime patch would suppress Hub writes or disable Hub fallback
- runtime patch would expose customer email, phone, raw Hub payloads, raw provider/payment payloads, or secrets

## 13. Recommendation

Proceed to **G39D runtime patch** for `getAdminDeliveryRouteSummary` if the owner wants to continue Hub cutover momentum.

G39D should:

- make route rows native-first
- keep Hub fallback active
- preserve existing admin route response shape
- add explicit fallback reporting only as additive metadata
- maintain stale Hub suppression
- include a focused fixture harness
- publish only `getAdminDeliveryRouteSummary`
- run GET/unauth/admin boundary checks
- run a small live read-only delivery route summary check after publish

Hold instead if the next audit finds a route row contract gap, especially around address parity, proof/drop fields, or Hub-only route rows.

## 14. No-write confirmation

G39C is docs-only. It does not:

- change runtime code
- change `getAdminDeliveryRouteSummary` behavior
- change admin UI behavior
- change customer-facing behavior
- suppress Hub writes
- disable Hub fallback
- mutate Customer App records
- mutate native records
- mutate Hub records
- call Stripe, Shopify, Hub, or providers
- send notifications
- run sync/retry/repair/replay
- open gates
- create logs/queues
- deduct inventory
- create PurchaseOrders
- publish Base44
