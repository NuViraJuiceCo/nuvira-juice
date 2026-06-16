# G39Q: Guarded Delivery Completed Aggregate Native Display

## Purpose

G39Q patches exactly one operations dashboard aggregate:

- `summary.delivery.completed_in_range`

This is a single-aggregate guarded display patch. It is not a broad operations dashboard native-first cutover.

G39Q keeps Hub-primary behavior and G39N diagnostics active. It keeps all other operations dashboard displayed values unchanged and only lets `delivery.completed_in_range` use the G39P-approved native route-date semantic when the guard passes.

G39Q does not change customer-facing behavior. It does not mutate Customer App records, native records, Hub records, master data, alerts, inventory, or PurchaseOrders. It does not call Stripe, Shopify, providers, or notification senders. It does not run sync/retry/repair/replay and does not create logs/queues.

## G39O/G39P evidence

G39O found one conditional clean nonzero operations-dashboard candidate:

| Aggregate | Evidence | Decision |
| --- | --- | --- |
| `delivery.completed_in_range` | `last_30_days_preset` displayed/native/Hub = `1/1/1` | Candidate only with semantic guard. |
| `delivery.today_stops` | all tested windows zero | hold |
| `delivery.tomorrow_stops` | all tested windows zero | hold |
| `production.batch_count` | mismatch `15/6/15` | hold |
| `production.planned_units` | mismatch `129/6/129` | hold |
| `production.produced_units` | mismatch `123/6/123` | hold |

G39P documented the semantic decision and mismatch evidence:

- `2026-06-08`: displayed/native/Hub = `0/1/0`
  - Native/G39D route evidence shows `NV-MPZNKGNT` completed on `2026-06-08`.
  - Hub/current operations custom-window display did not count it.
- `2026-05-16`: displayed/native/Hub = `1/0/1`
  - Native/G39D route evidence shows `#NV-MP5SOQLJ` active/pending, not completed.
  - Hub/current operations aggregate counted one, but safe operations response does not expose row-level Hub detail.
- `last_30_days`: displayed/native/Hub = `1/1/1`
  - useful confirmation, but not enough by itself without the G39P semantic guard.

## Selected semantic

G39Q applies the G39P-approved semantic:

> `delivery.completed_in_range` counts completed delivery route rows whose route delivery date is inside the selected range.

Date bucket priority:

1. `delivery_date`
2. `scheduled_date`
3. `assigned_delivery_date`

Completed statuses:

- `delivered`
- `completed`
- `fulfilled`
- `picked_up` / `picked up`

`delivered_at` remains supporting audit evidence only. It is not the primary dashboard date bucket.

## Route-date bucket implementation

G39Q adds a narrow helper inside `getAdminOperationsDashboardSummary`:

- `computeNativeCompletedDeliveriesInRangeByRouteDate`

It uses native `FulfillmentTask` rows already read by the operations dashboard native context. It excludes POS/event fulfillment tasks as before. It counts only completed delivery rows where the route-date bucket falls inside the requested range.

The native operations summary's `delivery.completed_in_range` diagnostic value now reflects this route-date count for the single aggregate.

## Guard design

G39Q adds top-level guard metadata:

- `operations_dashboard_delivery_completed_marker:"g39q_delivery_completed_in_range_route_date_guard"`
- `delivery_completed_in_range_native_primary_enabled`
- `delivery_completed_in_range_guard_passed`
- `delivery_completed_in_range_guard_reason`
- `delivery_completed_in_range_display_source`
- `delivery_completed_in_range_semantic:"route_delivery_date_completed_status"`
- `completed_delivery_date_bucket:"delivery_date_then_scheduled_date_then_assigned_delivery_date"`
- `completed_delivery_native_source:"native_fulfillment_task_route_date"`
- `completed_delivery_hub_source:"current_hub_or_dashboard_summary"`
- `delivery_completed_in_range_native_value`
- `delivery_completed_in_range_previous_display_value`
- `delivery_completed_in_range_hub_value`
- `delivery_completed_in_range_mismatch_guard`

Guard passes when:

- the aggregate is `delivery.completed_in_range`
- native route-date computation succeeds
- comparison to current/Hub display value is available
- included completed rows do not carry subscription/multi-delivery ambiguity
- included completed rows do not carry repair/replay/safeSync ambiguity
- included completed rows do not require provider calls, notifications, writes, or Hub mutation

Guard does not require native value to equal Hub/current value. When G39P-approved route-date semantics apply, the response records the mismatch instead of silently ignoring it.

Guard fails and falls back to current displayed value when:

- native computation is unavailable
- comparison is unavailable
- included rows have subscription/multi-delivery ambiguity
- included rows have repair/replay/safeSync ambiguity
- included rows require provider calls, notifications, writes, or Hub mutation
- any runtime guard error occurs

## Fallback behavior

If the guard passes:

- `summary.delivery.completed_in_range` uses the native route-date count.
- diagnostics set `source_of_truth:"native_route_date"` for the aggregate.
- diagnostics keep `mismatch_category:"delivered_completed_semantic_mismatch"` when Hub/current differs.
- `review_required:false` for the guarded aggregate because the G39P semantic is explicitly applied.
- `fallback_required:false` for the guarded aggregate.

If the guard fails:

- `summary.delivery.completed_in_range` remains the current displayed value.
- guard metadata explains the fallback reason.
- Hub fallback remains active.
- G39N diagnostics remain active.

All other operations dashboard displayed values remain current behavior.

## Diagnostics metadata compatibility

G39Q preserves G39N top-level diagnostics:

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
- aggregate counts and `aggregate_diagnostics`

The operations dashboard as a whole remains not-native-first. Only one aggregate can display a guarded native route-date value.

## Response compatibility

G39Q preserves fields consumed by `/admin/operations`:

- `summary`
- `source`
- `generated_at`
- date range fields
- `warnings`
- `data_sources`
- `truncated`
- existing aggregate names

Only `summary.delivery.completed_in_range` can change, and only when the guard passes. `Operations.jsx` is unchanged.

G39Q does not newly expose customer email, phone, full address, raw Hub payload, raw provider payload, raw Stripe/Shopify/payment payload, secrets, auth values, proof payloads, or drop payloads.

## Test coverage

Added fixture harness:

```bash
node scripts/migration/run-g39q-operations-delivery-completed-aggregate-tests.mjs
```

Coverage:

1. Last-30-days nonzero native/current/Hub match permits native display.
2. Single-day native route-date completed row with current/Hub zero uses native when G39P semantic is enabled.
3. Single-day Hub/current completed row with no native route-date completed row uses native zero when guard passes.
4. `delivered_at` inside range but route date outside range does not count.
5. `delivery_date` inside range and delivered status counts.
6. `scheduled_date` fallback counts when `delivery_date` is missing.
7. `assigned_delivery_date` fallback counts when `delivery_date` and `scheduled_date` are missing.
8. Subscription/multi-delivery row causes guard fail/fallback.
9. Repair/replay ambiguous row causes guard fail/fallback.
10. Provider-call need causes guard fail/fallback.
11. Aggregates other than `delivery.completed_in_range` remain unchanged.
12. Inventory/PO/refund/subscription/repair aggregates remain unchanged.
13. G39N diagnostics metadata remains present.
14. Hub fallback remains active.
15. `writes_performed:false`.
16. `provider_call_impact:false`.
17. `notifications_sent:false`.
18. `hub_mutation_performed:false`.
19. no logs/queues created.
20. response shape remains backward-compatible and unsafe payloads are not returned.

## No-write policy

G39Q is read-only. It does not:

- mutate Customer App records
- mutate native ShopifyOrder
- mutate native FulfillmentTask
- mutate ProductionBatch
- mutate BatchComplianceLog
- mutate Recipe / Bundle / Product / InventoryItem / IngredientYield
- mutate Hub records
- create OrderSyncLog
- create CommandLog
- create OrderReviewQueue
- create Notification rows
- create CustomerMessageDeliveryLog rows
- call Stripe
- call Shopify
- call providers
- send notifications
- run sync/retry/repair/replay
- deduct inventory
- create PurchaseOrder

## Rollback plan

Rollback is code-only:

1. Revert the `getAdminOperationsDashboardSummary` G39Q patch.
2. Revert the G39Q harness/doc if needed.
3. Publish only `getAdminOperationsDashboardSummary` during closeout if rollback is required after live deployment.
4. No data repair should be needed because G39Q is read-only and does not mutate records.

Hub/current display remains available as the fallback path.

## Next phase recommendation

After merge and scoped publish, closeout should verify live behavior for:

- `last_30_days_preset`
- `2026-06-08`
- `2026-05-16`

Expected high-level behavior:

- `last_30_days_preset`: guard passes and remains `1` if live source data is unchanged.
- `2026-06-08`: guard may display native route-date count `1` while recording Hub/current mismatch.
- `2026-05-16`: guard may display native route-date count `0` while recording Hub/current mismatch.

If live guard metadata is absent, classify as `runtime_not_activated`. If the guard includes ambiguous subscription/repair/provider-required rows, classify as `patch_required_guard_too_broad` and keep current display fallback.
