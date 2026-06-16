# G39M: Operations Dashboard Aggregate Mismatch Analysis

## 1. Executive summary

G39M documents the mismatch and fallback plan for `getAdminOperationsDashboardSummary` before any runtime change. This phase is docs-only. It does not change `getAdminOperationsDashboardSummary`, `Operations.jsx`, customer-facing behavior, Hub fallback, Hub writes, schemas, gates, or live data.

G39B classified the `operations_dashboard` surface as:

- readiness: `preview_only_more_fields_needed`
- risk: `medium`
- issue: aggregate mismatch/source semantics are not specific enough for a safe native-first patch
- recommendation: analyze aggregate source-of-truth rules first

The operations dashboard is an aggregate surface, not a row detail surface. A mismatch can come from date windows, entity semantics, Hub-only row classes, native-only mirrors, payment/refund/subscription status ownership, or inventory/procurement policy. The safest next runtime phase is therefore diagnostics-first: preserve currently displayed values and add per-aggregate source/mismatch metadata so each aggregate can be evaluated independently.

Recommended G39N scope:

- add diagnostics/mismatch metadata only
- preserve current displayed dashboard counts
- keep `native_first_enabled:false`
- keep Hub fallback active
- do not make operations dashboard broadly native-first
- do not loosen G39L admin-orders native-primary eligibility

## 2. G39B evidence

G39B added read-only parity preview mode `ADMIN_NATIVE_FIRST_HUB_READ_PARITY` and included `operations_dashboard` in the admin read-surface comparison.

Relevant G39B audit facts:

| Field | G39B result |
| --- | --- |
| Surface | `operations_dashboard` |
| Function | `getAdminOperationsDashboardSummary` |
| Admin dependency | `Operations.jsx` operations snapshot |
| Current Hub role | `hub_primary_with_native_fallback` |
| Reads native data | yes |
| Reads Hub data | yes |
| Admin-only | yes |
| Read-only | yes |
| Provider calls expected | no |
| PII policy | aggregate counts only |
| Readiness | `preview_only_more_fields_needed` |
| Risk | medium |

G39B aggregate preview used local native and Hub-fallback context only. It did not call external Hub, providers, Stripe, Shopify, or mutation endpoints. The surface was not selected for immediate native-first runtime work because aggregate mismatches require field-level and domain-level source-of-truth rules.

Carry-forward context from later phases:

- `getAdminDeliveryRouteSummary` is now native-first with Hub fallback retained.
- `getAdminProductionPlanningSummary` is now native-first with Hub fallback retained.
- `getAdminCalendarEventsSummary` is now native-first with Hub fallback retained.
- `getAdminOrdersWithHub` has diagnostics and limited native-primary metadata live, but remains Hub-first/default with zero eligible native-primary rows under strict G39L rules.

## 3. Current behavior audit

### Function

`base44/functions/getAdminOperationsDashboardSummary/entry.ts`

Current request handling:

1. Authenticates the current Base44 user.
2. Requires `user.role === 'admin'`.
3. Parses a bounded date range using either:
   - `today`
   - `last_7_days`
   - `last_30_days`
   - `custom` with `date_from` and `date_to`
4. Enforces a maximum custom date range of 31 days.
5. If Hub config exists, fetches Hub summary from:
   - `getOperationsDashboardSummaryForCustomerApp`
6. If Hub config is missing, Hub fetch fails, Hub returns non-OK, or Hub response is malformed, it builds a native Customer App fallback summary.
7. On Hub success, it returns sanitized Hub summary counts.
8. On native fallback, it returns native summary counts plus warnings and `data_sources` metadata.

Current visible behavior is Hub-primary. Native data is only visible as a fallback when Hub cannot be used.

### Native fallback reads

The function's native fallback reads these entities through service-role list calls:

| Entity | Current use |
| --- | --- |
| `Order` | Customer App order count, paid/fulfilled/delivered/source mix context |
| `ShopifyOrder` | Native Shopify mirror order count, paid/fulfilled/delivered/source mix context |
| `ProductionBatch` | batch count, planned units, produced units |
| `FulfillmentTask` | today/tomorrow delivery stops and completed delivery task counts |
| `InventoryItem` | low/critical/out-of-stock inventory health counts |
| `OrderReviewQueue` | alert count/severity context |
| `OperationalAlert` | alert count/severity context |
| `ComplianceAlert` | alert count/severity context |

The current function does not directly read:

- `BatchComplianceLog`
- `Recipe`
- `IngredientYield`
- `Bundle`
- `Product`
- `OrderSyncLog`
- `SafeSyncParityLog`
- `Notification`
- `CustomerMessageDeliveryLog`
- `PurchaseOrder`

Those domains may still be represented indirectly in Hub aggregates or neighboring admin surfaces, but they are not direct native fallback inputs in the current function.

### Hub reads

When Hub config exists, the function builds a Hub base URL and performs a read-only `GET` to the Hub operations dashboard summary endpoint with date/source filters. It passes the Customer App sync secret as bearer auth. The returned Hub summary is sanitized into the local response contract.

This is a Hub read/fallback dependency, not a Hub mutation path.

### Admin UI dependency

`src/pages/admin/Operations.jsx` invokes `getAdminOperationsDashboardSummary` and renders the `OperationsSnapshot` section.

The page consumes these top-level fields:

- `summary`
- `source`
- `generated_at`
- `date_from`
- `date_to`
- `warnings`
- `data_sources`
- `truncated`

The page renders these summary groups:

- `summary.orders`
- `summary.production`
- `summary.delivery`
- `summary.inventory`
- `summary.alerts`
- `summary.source_mix`

It also uses `source` and `data_sources.hub_available` only to label the snapshot as Hub aggregate or native fallback.

### Response compatibility requirements

A future G39N diagnostics patch must preserve:

- `success`
- `source`
- `generated_at`
- `date_from`
- `date_to`
- `summary`
- `truncated`
- `warnings` when present
- `data_sources` when present
- every existing `summary` nested field consumed by `Operations.jsx`

Diagnostics must be additive and safe for the existing UI to ignore.

### Safety audit

Current function behavior:

- admin-only
- aggregate-only
- read-only
- no Customer App record writes
- no native record writes
- no Hub writes
- no provider calls beyond the existing Hub summary read
- no Stripe calls
- no Shopify calls
- no notifications
- no sync/retry/repair/replay
- no log/queue creation
- no customer email, phone, full address, raw Hub payload, raw provider payload, raw payment payload, secrets, proof payload, or drop payload returned by the aggregate response

## 4. Aggregate inventory

`getAdminOperationsDashboardSummary` currently returns this sanitized summary model.

### Top-level groups

| Group | Fields | Current displayed source when Hub succeeds | Native fallback source | Admin-visible meaning | Operationally actionable? |
| --- | --- | --- | --- | --- | --- |
| `orders` | `total`, `paid`, `fulfilled`, `delivered` | Hub summary | `Order` + `ShopifyOrder` deduped by order number | date-scoped order state counts | yes; used as an operational snapshot |
| `production` | `batch_count`, `planned_units`, `produced_units` | Hub summary | `ProductionBatch` | production batch/unit totals | yes, but command readiness is out of scope |
| `delivery` | `today_stops`, `tomorrow_stops`, `completed_in_range` | Hub summary | `FulfillmentTask` | route stop and completion counts | yes; should align with G39D route summary over time |
| `inventory` | `low`, `critical`, `out_of_stock` | Hub summary | `InventoryItem` stock/reorder point heuristic | inventory health | yes, but stock/PO authority remains held |
| `alerts` | `active`, `critical`, `warning`, `info` | Hub summary | `OrderReviewQueue`, `OperationalAlert`, `ComplianceAlert` | sanitized operations alerts | yes; review/log source semantics vary |
| `source_mix` | `one_time`, `subscription`, `pos`, `other` | Hub summary | `Order` + `ShopifyOrder` classification | source class mix | informational; source ownership varies |

### Field-level inventory

| Aggregate field | Hub-derived today | Native-derived fallback | Mixed/merged risk | Native source exists | Hub source-of-truth remains? | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| `orders.total` | yes | yes | high | `Order`, `ShopifyOrder` | yes for broad order count until G39L improves eligibility | Hub and native may use different date windows and row classes. |
| `orders.paid` | yes | yes | high | `Order`, `ShopifyOrder` | yes for payment/refund/cancel holds | Native paid semantics cannot override payment/refund Hub holds. |
| `orders.fulfilled` | yes | yes | high | `Order`, `ShopifyOrder`, task-adjacent context | yes until fulfillment semantics are proven per row | Status names can differ across Hub, Customer App order, Shopify mirror, and task. |
| `orders.delivered` | yes | yes | medium/high | `Order`, `ShopifyOrder` | partial | G39D delivery route is native-first, but broad order delivered count still depends on order-class semantics. |
| `production.batch_count` | yes | yes | medium | `ProductionBatch` | partial | G39F planning is native-first, but operations summary still needs per-aggregate metadata before switching display. |
| `production.planned_units` | yes | yes | medium | `ProductionBatch.planned_units` | partial | Unit semantics can differ between Hub batches and native batch fields. |
| `production.produced_units` | yes | yes | medium | `ProductionBatch.actual_units`, `final_usable_quantity`, `bottles_produced` | partial | Produced-unit field selection should be documented before native-primary display. |
| `delivery.today_stops` | yes | yes | low/medium | `FulfillmentTask` | Hub fallback retained | G39D should become the preferred reference, but operations summary still has independent task counting. |
| `delivery.tomorrow_stops` | yes | yes | low/medium | `FulfillmentTask` | Hub fallback retained | Date-bucket and timezone handling must match G39D. |
| `delivery.completed_in_range` | yes | yes | medium | `FulfillmentTask` | Hub fallback retained | Completion semantics should match delivered/picked-up/fulfilled task statuses. |
| `inventory.low` | yes | yes | high | `InventoryItem` | Hub/current policy held | Current native fallback uses stock/reorder heuristic; inventory stock is not yet authoritative. |
| `inventory.critical` | yes | yes | high | `InventoryItem` | Hub/current policy held | Threshold policy requires owner-approved stock semantics before native authority. |
| `inventory.out_of_stock` | yes | yes | high | `InventoryItem` | Hub/current policy held | Do not trigger PurchaseOrder or deduction actions from this aggregate. |
| `alerts.active` | yes | yes | medium/high | `OrderReviewQueue`, `OperationalAlert`, `ComplianceAlert` | logs/manual review remain source-of-truth | Native alert classes and Hub alert classes may not be equivalent. |
| `alerts.critical` | yes | yes | medium/high | same as alerts | logs/manual review remain source-of-truth | Severity mapping differs by source. |
| `alerts.warning` | yes | yes | medium/high | same as alerts | logs/manual review remain source-of-truth | Includes review queue incident types in native fallback. |
| `alerts.info` | yes | yes | medium/high | same as alerts | logs/manual review remain source-of-truth | Informational alert semantics need source labels. |
| `source_mix.one_time` | yes | yes | medium/high | `Order`, `ShopifyOrder` | partial | G39L has zero eligible admin native-primary rows under strict rules. |
| `source_mix.subscription` | yes | yes | high | limited native signals | yes | Subscription/multi-delivery remains Hub source-of-truth. |
| `source_mix.pos` | yes | yes | medium/high | order source fields | yes/unknown | POS/event rows remain Hub/POS governed until separate parity. |
| `source_mix.other` | yes | yes | medium/high | fallback classifier | yes/unknown | Ambiguous rows should stay Hub/manual-review governed. |

## 5. Mismatch categories

A future diagnostics patch should report aggregate mismatch categories without changing displayed counts.

| Category | Likely cause | Source-of-truth rule | Native can eventually win? | Hub fallback required? | Data/schema patch first? |
| --- | --- | --- | --- | --- | --- |
| `native_count_lower_than_hub` | Hub includes rows without native mirror, subscription rows, historical Hub rows, or wider date semantics | Hub for missing/ambiguous classes | only for proven one-time reconciled subset | yes | maybe |
| `hub_count_lower_than_native` | native mirrors exist without Hub context, late/historical mirror rows, native-only tasks/batches | native can be admin context, not automatic lifecycle truth | yes for safe admin-only aggregates | yes for broad view | maybe |
| `double_count_risk` | `Order` and `ShopifyOrder` both represent same order; Hub may already dedupe | dedupe by exact operational keys only | yes after deterministic keys | yes | maybe |
| `delivered_completed_semantic_mismatch` | Hub delivered/fulfilled, order status, task status, and native delivery status use different labels | G39D route summary is preferred for route counts; order counts need row proof | partial | yes | no unless fields missing |
| `production_status_semantic_mismatch` | Hub batch states differ from `ProductionBatch` fields and G39F planning fields | G39F planning summary should guide planning aggregates | partial | yes | maybe |
| `payment_refund_semantic_mismatch` | paid/captured/refunded/cancelled status differs by source | Hub/payment/refund source-of-truth | not until refund/payment parity is proven | yes | likely |
| `subscription_multi_delivery_mismatch` | Hub owns recurrence/occurrence logic not mirrored natively | Hub source-of-truth | no for now | yes | likely |
| `repair_replay_safeSync_mismatch` | logs/manual repair context affects visibility or counts | Hub/log/manual review governed | no broad win | yes | maybe |
| `historical_late_mirror_mismatch` | native historical mirror appears without live lifecycle context | native admin context only | yes for display, not command proof | yes | no |
| `date_window_mismatch` | Hub and native use different reference dates | source-specific until aligned | yes after documented bucket rules | yes | maybe |
| `timezone_date_bucket_mismatch` | Chicago day buckets vs UTC/string dates differ | use explicit `America/Chicago` calendar rules | yes after alignment | yes | no |
| `stale_hub_fallback_mismatch` | Hub still has stale schedule/status while native corrected record exists | native can win only where stable key/date correction is proven | yes for delivery/calendar-like aggregates | yes | no |
| `native_missing_hub_available` | native mirror/task/batch absent for Hub row | Hub source-of-truth | no until mirrored | yes | maybe |
| `hub_missing_native_available` | native-only row not represented in Hub | native can be admin context | yes for safe row classes | yes for broad view | maybe |
| `native_field_missing` | native record exists but lacks aggregate field | Hub/context fallback | not until field populated | yes | yes |
| `schema_meaning_mismatch` | similarly named fields have different semantics | domain-specific source-of-truth | maybe | yes | maybe |
| `aggregate_includes_different_row_classes` | Hub includes subscriptions/POS/refunds; native fallback excludes or classifies differently | source-specific holds | maybe by class only | yes | maybe |
| `unknown_manual_review_needed` | insufficient evidence | manual review / Hub fallback | no | yes | likely |

Do not infer customer or payment truth from aggregate mismatches alone. Aggregate diagnostics must point to the domain that owns the source of truth.

## 6. Source-of-truth rules by aggregate domain

### One-time active order counts

Native can become primary only after Customer App order, native ShopifyOrder, and native FulfillmentTask parity exists for the relevant row class and active lifecycle semantics are proven. G39L currently reports zero eligible native-primary admin order rows under strict rules, so operations dashboard order aggregates should not switch to native-primary yet.

### One-time completed/reconciled counts

Native can become primary where Customer App order, native ShopifyOrder, and native FulfillmentTask are reconciled and no mismatch/review hold exists. This should be aggregate-by-aggregate, not a broad dashboard switch.

### Late/historical mirror rows

Native can count as admin context when mirror fields are complete and non-conflicting, but late/historical mirrors must not be treated as live production, delivery, inventory, or customer-facing lifecycle proof.

### Refund/cancel/payment counts

Hub/payment/refund source-of-truth remains. Dashboard aggregates must not make native payment/refund/cancel fields authoritative until refund/payment parity has separate evidence.

### Subscription/multi-delivery counts

Hub source-of-truth remains for subscriptions and multi-delivery occurrence semantics. Native aggregates may report supporting context only when exact parity is proven.

### Delivery route/status counts

Use the G39D native-first route summary as the preferred readiness reference for delivery-specific aggregate semantics. Hub fallback remains active and should be reported where route rows are Hub-only, incomplete, or stale-suppressed.

### Production planning counts

Use the G39F native-first production planning summary as the preferred readiness reference for production-planning aggregates. Missing native planning context should remain fallback/review metadata, not command readiness.

### Calendar/event counts

Use the G39H native-first calendar summary as the preferred readiness reference for calendar/date aggregate semantics. Calendar event presence must not imply delivery, production, notification, or command readiness.

### Admin orders counts

`getAdminOrdersWithHub` remains Hub-first/default with G39J/G39L diagnostics. G39L limited native-primary metadata is live, but the current result has zero eligible rows. Operations dashboard order aggregates should remain current-display-source until G39N diagnostics proves specific counts are safe.

### Inventory/procurement counts

Native inventory stock is not authoritative for automation. PurchaseOrder automation remains held. Dashboard inventory aggregates may show native fallback context but must not become stock/PO source-of-truth or trigger inventory deduction/PO creation.

### Alerts/review/sync/parity counts

Repair/replay/safeSync, `OrderReviewQueue`, sync/parity logs, and manual-review classes remain log/manual-review governed. Native alert counts and Hub alert counts should be labeled rather than merged silently.

### Unknown/ambiguous aggregates

Use Hub fallback/manual review. Unknown aggregates should not become native-primary.

## 7. Proposed G39N diagnostics metadata

G39N should be diagnostics-first and preserve current visible dashboard behavior.

### Top-level metadata

Add safe additive fields:

- `operations_dashboard_diagnostics_enabled:true`
- `native_first_enabled:false`
- `hub_fallback_active:true`
- `dashboard_source_mode:"current_behavior_with_diagnostics"`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `customer_facing_behavior_changed:false`
- `aggregate_mismatch_count`
- `aggregate_mismatch_categories`
- `native_aggregate_count`
- `hub_aggregate_count`
- `mixed_aggregate_count`
- `source_of_truth_holds`
- `fallback_required_count`
- `review_required_count`
- `native_first_ready_aggregate_count`
- `hub_source_of_truth_aggregate_count`
- `blocked_aggregate_count`

### Per-aggregate metadata

Add safe additive metadata for each aggregate field:

- `aggregate_name`
- `displayed_value`
- `current_display_source`
- `native_value`
- `hub_value`
- `mismatch_detected`
- `mismatch_category`
- `source_of_truth`
- `native_first_ready`
- `fallback_required`
- `review_required`
- `blocker`
- `recommendation`

### Response-compatibility rule

Do not remove or rename existing `summary` fields. `Operations.jsx` must continue to render without code changes. If a future diagnostics panel is desired, that should be a separate UI phase after G39N proves metadata safety.

## 8. Future G39N test plan

Future harness:

```bash
node scripts/migration/run-g39n-operations-dashboard-aggregate-diagnostics-tests.mjs
```

Planned fixture test cases:

1. matching native/Hub aggregate returns no mismatch.
2. native lower than Hub returns `native_count_lower_than_hub`.
3. Hub lower than native returns `hub_count_lower_than_native`.
4. date bucket mismatch is classified.
5. payment/refund aggregate stays Hub source-of-truth.
6. subscription aggregate stays Hub source-of-truth.
7. delivery aggregate can reference G39D native-first route summary readiness.
8. production planning aggregate can reference G39F native-first planning readiness.
9. calendar aggregate can reference G39H native-first calendar readiness.
10. admin orders aggregate remains Hub-first/default because G39L currently has zero eligible rows.
11. inventory/PO aggregate remains held.
12. repair/replay aggregate remains manual-review/log governed.
13. no customer PII is returned.
14. no raw Hub/provider/payment payload is returned.
15. `writes_performed:false`.
16. `provider_call_impact:false`.
17. `notifications_sent:false`.
18. `hub_mutation_performed:false`.
19. no logs/queues are created.
20. response shape remains backward-compatible.

Regression harnesses for G39N:

- G39B parity harness
- G39D delivery route native-first harness
- G39F production planning native-first harness
- G39H calendar native-first harness
- G39J admin orders diagnostics harness
- G39L admin orders limited native-primary harness
- relevant G33C mirror/task/master-data harnesses if dashboard logic uses those shapes
- relevant G35 refund harnesses if refund aggregates are touched
- relevant G36 subscription harnesses if subscription aggregates are touched
- G27 cutover harness if shared preview/cutover logic is touched
- scoped ESLint
- `npm run build`

## 9. Risk assessment

### Low-risk

- G39M is docs-only.
- Recommended G39N is diagnostics-only.
- Surface is admin-only.
- Response is aggregate counts, not raw customer/order payloads.
- No writes are needed.
- Hub fallback remains active.

### Medium-risk

- The operations dashboard is high-visibility and can influence operator decisions.
- Aggregate mismatches are less explainable than row-level mismatches.
- Date semantics vary across order creation, delivery, production, task, and alert fields.
- Existing dashboard fields combine multiple domains with different source-of-truth rules.
- Admin orders currently has zero native-primary eligible rows under G39L strict rules.

### High-risk / hard stops

- making operations dashboard fully native-first immediately
- hiding Hub-derived counts
- changing customer-facing behavior
- treating refund/subscription counts as native-authoritative
- treating inventory stock or PurchaseOrder automation as ready
- enabling inventory, PO, production, delivery, notification, or sync actions from dashboard aggregates
- provider, Stripe, or Shopify calls
- notifications
- writing logs/queues
- suppressing Hub writes
- loosening G39L admin-order native-primary eligibility
- exposing customer email, phone, full address, raw Hub payloads, raw provider/payment payloads, secrets, proof payloads, or drop payloads

## 10. Hard stops

Future work must stop and remain diagnostics-only if any of these are found:

- aggregate source-of-truth cannot be determined
- payment/refund/subscription rows are included without source-of-truth hold metadata
- dashboard display would hide active Hub-only operational rows
- source matching requires customer email, phone, fuzzy customer name matching, or raw payload inspection
- native and Hub date windows cannot be reconciled
- a change would alter customer-facing order history/tracker behavior
- a change would create records, update records, send notifications, call providers, run sync/repair/replay, deduct inventory, or create PurchaseOrders

## 11. Recommendation

Proceed to G39N as a narrow diagnostics runtime patch for `getAdminOperationsDashboardSummary`.

G39N should:

1. keep current dashboard displayed values and response shape
2. add source/mismatch metadata per aggregate
3. keep `native_first_enabled:false`
4. keep Hub fallback active
5. expose source-of-truth holds for payment/refund, subscription, inventory/PO, repair/replay, and admin-orders aggregates
6. reference G39D/G39F/G39H/G39L readiness where applicable
7. avoid UI changes unless additive metadata cannot be safely ignored
8. avoid live mutations and provider calls

Do not implement full native-first operations dashboard until G39N diagnostics identify specific aggregates that are safe to switch one at a time.
