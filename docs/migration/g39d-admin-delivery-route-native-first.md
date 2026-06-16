# G39D: Admin delivery route native-first runtime patch

## 1. Executive summary

G39D patches `getAdminDeliveryRouteSummary` as the first low-risk Hub read burn-down runtime change. The function remains admin-only and read-only, but now builds the delivery route summary from native Customer App `FulfillmentTask` / `ShopifyOrder` rows first and uses Hub only as fallback/context.

This does not disable Hub. It does not suppress Hub writes. It does not change customer-facing delivery behavior. It adds explicit fallback metadata so operators can see when Hub was needed, when a native row was primary, and when stale Hub route rows were suppressed.

## 2. Evidence from G39B/G39C

G39B live parity preview classified `delivery_route_summary` as `ready_for_native_first_patch` with low risk:

- sampled native rows: 2
- sampled Hub rows: 0
- mismatches: 0
- blockers: []
- preview was dry-run/read-only
- PII/raw payload exposure was not observed

G39C selected `getAdminDeliveryRouteSummary` because it is admin-only, read-only, already has native task data available, and has a stale Hub fallback suppression pattern from prior delivery readiness work.

## 3. Current behavior before G39D

Before G39D, the visible route summary effectively merged Hub rows before native rows. Native rows were included when no Hub row for the same order was visible. Stale Hub rows could be suppressed when native schedule evidence showed a corrected date, but the response did not clearly report all native-first/fallback decisions.

Current admin page consumers rely on the existing response shape:

- `summary`
- `sections.delivery_stops`
- `sections.completed`
- `sections.unscheduled_delivery_orders`
- route row display fields such as order number, customer display label, delivery window, address, items, status fields, proof URL, drop location, source type, and data source
- `hub_fallback_reconciliation`
- `warnings`

G39D preserves those fields and adds metadata only.

## 4. Native-first algorithm

The patched function uses this read order:

1. Read native `FulfillmentTask` rows for the requested delivery date.
2. Enrich native task rows from native `ShopifyOrder` rows where schema-safe and already used by the function.
3. Read native delivery orders without tasks for the requested date.
4. Read Hub delivery route summary when Hub config exists.
5. Match native and Hub rows by operational keys, primarily `order_number` with delivery date context.
6. Prefer native rows when native route data is present and complete enough for the current admin route UI.
7. Use Hub fallback rows only when no native route row exists.
8. Use Hub fallback as context when a native row exists but lacks route display fields the UI currently needs.
9. Suppress stale Hub rows when native schedule evidence shows a corrected delivery date.
10. Deduplicate native/Hub rows for the same order/date and keep the native row as primary.
11. Return explicit fallback metadata.
12. Never write records.

The function does not use customer email, phone, or full customer identity as fuzzy matching keys.

## 5. Fallback metadata

G39D adds safe top-level metadata:

- `native_row_count`
- `hub_fallback_row_count`
- `suppressed_hub_row_count`
- `fallback_required`
- `fallback_reasons`
- `stale_hub_fallback_detected`
- `native_first_enabled:true`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`

G39D adds safe per-row metadata:

- `data_source`
  - `customer_app_native_task`
  - `customer_app_native_order`
  - `native_with_hub_fallback_context`
  - `hub_fallback`
- `fallback_source`
- `fallback_reason`
- `stale_hub_fallback_suppressed`
- `native_primary`
- `hub_fallback_used`
- `warnings`
- `hub_fallback_context`

Fallback reasons currently include:

- `native_route_row_missing`
- `native_row_incomplete_for_route_display`
- `duplicate_native_hub_row_deduped`
- `native_corrected_date_suppresses_stale_hub_row`
- `hub_delivery_summary_unavailable_or_unconfigured`

## 6. Route row compatibility

G39D preserves the route fields used by `DeliveryQueue.jsx`:

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

It also adds safe operational identifiers and status fields where already available:

- `customer_app_order_id`
- `native_shopify_order_id`
- `native_fulfillment_task_id`
- `hub_task_id`
- `production_status`
- `fulfillment_type`
- `fulfillment_method`
- `payment_status`
- `line_item_count`
- `scheduled_date`
- `assigned_delivery_date`

No customer email, phone, raw Hub payload, raw provider payload, raw payment payload, raw proof payload, auth value, or secret is returned.

## 7. Stale Hub suppression

G39D keeps and strengthens stale Hub fallback handling:

| Case | Behavior |
| --- | --- |
| Native row exists for corrected date and Hub row exists on stale date | suppress Hub row, report `stale_hub_fallback_detected:true` |
| Native row and Hub row match same order/date | dedupe and prefer native row |
| Native row exists but is incomplete for route display | return native row with Hub context, report fallback reason |
| Hub-only active row exists | retain Hub fallback row |
| Native-only row exists | return native primary row |
| No rows exist | return empty safe response when Hub responds with an empty route summary |

Hub fallback remains active. Active Hub-only rows are not hidden.

## 8. Test coverage

Added fixture-only harness:

- `scripts/migration/run-g39d-admin-delivery-route-native-first-tests.mjs`

The harness loads the function locally with fake Base44 entity adapters and fake Hub responses. It does not call live Base44, Hub, Shopify, Stripe, or providers.

Covered cases:

1. Native row present -> native row is primary.
2. Hub row absent -> native row still returned.
3. Native row missing and Hub row present -> Hub fallback used.
4. Native row incomplete and Hub row present -> native row returned with Hub fallback context.
5. Native corrected date exists and stale Hub row exists -> stale Hub row suppressed.
6. Duplicate native/Hub same order/date -> deduped, native primary.
7. Hub-only active row retained.
8. No rows -> empty safe response.
9. Existing response shape remains backward-compatible.
10. No customer email/phone returned.
11. No raw Hub/provider/payment/proof payload returned.
12. `writes_performed:false`.
13. `provider_call_impact:false`.
14. `notifications_sent:false`.
15. No logs/queues created.
16. G32F stale Hub fallback scenario remains covered.

## 9. No-write policy

G39D remains read-only:

- no Customer App order mutation
- no native `ShopifyOrder` mutation
- no native `FulfillmentTask` mutation
- no Hub mutation
- no delivery status update
- no proof/drop/route write
- no `OrderSyncLog`
- no `CommandLog`
- no `OrderReviewQueue`
- no notification/message log
- no provider call
- no Stripe call
- no Shopify call
- no sync/repair/replay
- no inventory deduction
- no `PurchaseOrder`

## 10. Rollback plan

Rollback is code-only:

1. Revert the `getAdminDeliveryRouteSummary` native-first merge patch.
2. Republish only `getAdminDeliveryRouteSummary`.
3. Hub fallback remains active, so no data repair should be needed.
4. Re-run admin delivery route summary smoke for the same small date scopes.
5. Confirm no route rows were lost and no writes occurred.

Because G39D does not write data, rollback does not require record repair.

## 11. Next phase recommendation

After G39D is merged and published, run the scoped live boundary/smoke checks:

1. `getAdminDeliveryRouteSummary` method/auth boundary.
2. Admin-auth route summary for a date with known native rows.
3. Admin-auth route summary for a date with no rows.
4. Optional date with historical stale Hub suppression context if safe.
5. `/admin/delivery-queue` smoke.
6. No-write verification for G39D request IDs.

Then proceed to the next low-risk native-first admin read surface: `getAdminProductionPlanningSummary` or `getAdminCalendarEventsSummary`.
