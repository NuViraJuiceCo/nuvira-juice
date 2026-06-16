# G39N: Operations Dashboard Aggregate Diagnostics Runtime Patch

## Purpose

G39N adds diagnostics-only aggregate metadata to `getAdminOperationsDashboardSummary` while preserving current dashboard behavior.

This is not a native-first cutover. The operations dashboard remains Hub-primary when Hub succeeds and native-fallback when Hub is unavailable. Existing displayed values, date filters, summary shape, source field, generated timestamp, warnings, `data_sources`, and `truncated` behavior are preserved.

G39N does not change customer-facing behavior. It does not mutate records, call Stripe, call Shopify, call providers, send notifications, run sync/repair/replay, create logs/queues, deduct inventory, or create PurchaseOrders.

## G39M evidence

G39M documented the aggregate mismatch/source-of-truth analysis for the operations dashboard.

Carry-forward findings:

- Target function: `getAdminOperationsDashboardSummary`
- Current behavior: Hub-primary with native fallback
- Current native fallback reads:
  - `Order`
  - `ShopifyOrder`
  - `ProductionBatch`
  - `FulfillmentTask`
  - `InventoryItem`
  - `OrderReviewQueue`
  - `OperationalAlert`
  - `ComplianceAlert`
- `/admin/operations` consumes:
  - aggregate `summary`
  - `source`
  - `generated_at`
  - date range fields
  - `warnings`
  - `data_sources`
  - `truncated`
- G39B classified `operations_dashboard` as `preview_only_more_fields_needed`, medium risk.
- G39M recommended diagnostics-only runtime metadata before any displayed value switch.

G39M hard decision:

- Do not make operations dashboard native-first yet.
- Do not loosen G39L admin-orders native-primary rules.
- Preserve Hub/payment/subscription/log authority where required.

## Current Hub-primary behavior

Before G39N, the function:

1. authenticated an admin user
2. resolved a bounded date range
3. fetched Hub operations summary when Hub config was present
4. returned sanitized Hub `summary` when Hub succeeded
5. built native fallback `summary` only when Hub config was missing, Hub fetch failed, Hub returned non-OK, or Hub returned malformed data

G39N preserves that display model.

The only runtime behavior added is read-only native summary construction on Hub success so aggregate diagnostics can compare Hub-displayed values against native fallback values. This additional read is limited to existing native fallback entities and does not write records.

## Diagnostic metadata contract

G39N adds these safe additive top-level fields:

- `operations_dashboard_diagnostics_enabled:true`
- `operations_dashboard_diagnostics_marker:"g39n_operations_dashboard_aggregate_diagnostics"`
- `native_first_enabled:false`
- `hub_primary_enabled:true`
- `hub_fallback_active:true`
- `dashboard_source_mode:"current_behavior_with_diagnostics"`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `customer_facing_behavior_changed:false`
- `aggregate_count`
- `aggregate_mismatch_count`
- `native_aggregate_count`
- `hub_aggregate_count`
- `mixed_aggregate_count`
- `source_of_truth_hold_count`
- `fallback_required_count`
- `review_required_count`
- `native_first_ready_aggregate_count`
- `hub_source_of_truth_aggregate_count`
- `blocked_aggregate_count`
- `aggregate_mismatch_categories`
- `source_of_truth_holds`
- `fallback_reasons`
- `aggregate_diagnostics`

Each `aggregate_diagnostics` row can include:

- `aggregate_name`
- `displayed_value`
- `current_display_source`
- `native_value`
- `hub_value`
- `comparison_available`
- `mismatch_detected`
- `mismatch_category`
- `source_of_truth`
- `native_first_ready`
- `fallback_required`
- `review_required`
- `blocker`
- `recommendation`

No raw Hub payloads, raw provider payloads, raw payment payloads, customer email, phone, full address, auth values, secrets, proof payloads, or drop payloads are returned.

## Aggregate mismatch categories

G39N implements conservative categories for diagnostics only:

- `native_count_lower_than_hub`
- `hub_count_lower_than_native`
- `date_window_mismatch`
- `payment_refund_semantic_mismatch`
- `subscription_multi_delivery_mismatch`
- `delivered_completed_semantic_mismatch`
- `production_status_semantic_mismatch`
- `repair_replay_safesync_mismatch`
- `schema_meaning_mismatch`
- `aggregate_includes_different_row_classes`
- `not_comparable`
- `unknown_manual_review_needed`

G39N keeps broader G39M categories as future expansion vocabulary, but the runtime patch only emits categories supported by current summary fields and safe comparisons.

When native or Hub values cannot be computed safely, diagnostics set `comparison_available:false` and do not guess missing values.

## Source-of-truth rules

G39N applies source-of-truth rules as diagnostics only. It does not change displayed values.

| Aggregate domain | G39N rule |
| --- | --- |
| Admin orders | Hub/default remains. G39L currently has zero eligible native-primary rows. |
| Payment/refund | Hub/payment/refund source-of-truth remains. |
| Subscription/multi-delivery | Hub source-of-truth remains. |
| Delivery route/status | Reference G39D native-first route readiness; do not switch display in G39N. |
| Production planning | Reference G39F native-first planning readiness; do not switch display in G39N. |
| Calendar/events | Reference G39H if a calendar aggregate is added later; current operations summary does not display calendar counts. |
| Inventory/PO | Native inventory stock is not authoritative; PO automation remains held. |
| Alerts/review/repair/replay | Manual-review/log governed. |
| Unknown | Manual review / Hub fallback. |

## Response compatibility

G39N preserves fields consumed by `/admin/operations`:

- `summary`
- `source`
- `generated_at`
- `date_from`
- `date_to`
- `warnings`
- `data_sources`
- `truncated`

Existing nested summary fields are unchanged:

- `summary.orders.total`
- `summary.orders.paid`
- `summary.orders.fulfilled`
- `summary.orders.delivered`
- `summary.production.batch_count`
- `summary.production.planned_units`
- `summary.production.produced_units`
- `summary.delivery.today_stops`
- `summary.delivery.tomorrow_stops`
- `summary.delivery.completed_in_range`
- `summary.inventory.low`
- `summary.inventory.critical`
- `summary.inventory.out_of_stock`
- `summary.alerts.active`
- `summary.alerts.critical`
- `summary.alerts.warning`
- `summary.alerts.info`
- `summary.source_mix.one_time`
- `summary.source_mix.subscription`
- `summary.source_mix.pos`
- `summary.source_mix.other`

`Operations.jsx` was not changed.

## Test coverage

Added fixture harness:

```bash
node scripts/migration/run-g39n-operations-dashboard-aggregate-diagnostics-tests.mjs
```

Coverage:

1. Matching native/Hub aggregate returns no mismatch.
2. Native lower than Hub returns `native_count_lower_than_hub`.
3. Hub lower than native returns `hub_count_lower_than_native`.
4. Date bucket mismatch is classified.
5. Payment/refund aggregate stays Hub/payment source-of-truth.
6. Subscription aggregate stays Hub source-of-truth.
7. Delivery aggregate references G39D native-first route summary readiness.
8. Production planning aggregate references G39F native-first planning readiness.
9. Calendar aggregate references G39H readiness without guessing values.
10. Admin orders aggregate remains Hub-first/default because G39L had zero eligible rows.
11. Inventory/PO aggregate remains held.
12. Repair/replay aggregate remains manual-review/log governed.
13. Not-comparable aggregate does not guess `native_value`.
14. Existing response shape remains backward-compatible.
15. No customer email/phone returned.
16. No raw Hub/provider/payment payload returned.
17. `writes_performed:false`.
18. `provider_call_impact:false`.
19. `notifications_sent:false`.
20. `hub_mutation_performed:false`.
21. no logs/queues created.
22. `customer_facing_behavior_changed:false`.
23. displayed values remain current behavior.

## No-write policy

G39N remains read-only.

It does not:

- mutate Customer App records
- mutate native ShopifyOrder records
- mutate FulfillmentTask records
- mutate ProductionBatch records
- mutate InventoryItem records
- mutate Hub records
- create `OrderSyncLog`
- create `CommandLog`
- create `OrderReviewQueue`
- create `Notification`
- create `CustomerMessageDeliveryLog`
- call Stripe
- call Shopify
- call providers
- send notifications
- run sync/retry/repair/replay
- deduct inventory
- create PurchaseOrders
- disable Hub fallback
- suppress Hub writes
- change customer-facing behavior

## Rollback plan

Rollback is code-only:

1. Revert the `getAdminOperationsDashboardSummary` G39N diagnostics patch.
2. Revert the G39N harness/docs if needed.
3. Republish only `getAdminOperationsDashboardSummary` in the closeout phase.
4. No data repair is needed because G39N does not write records.

Hub fallback remains active before, during, and after rollback.

## Next phase recommendation

After G39N is merged and published in a separate closeout phase:

1. Boundary-verify `getAdminOperationsDashboardSummary`.
2. Run a small live dashboard call for a safe date range.
3. Confirm diagnostics metadata is live and displayed values remain current behavior.
4. Smoke `/admin/operations`.
5. Use aggregate diagnostics to identify any individual aggregate that can later become native-primary.

Do not implement broad operations dashboard native-first until diagnostics prove specific aggregate readiness.
