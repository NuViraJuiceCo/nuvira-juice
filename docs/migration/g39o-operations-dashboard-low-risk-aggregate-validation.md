# G39O: Operations Dashboard Low-Risk Aggregate Validation

## 1. Executive summary

G39O is a docs-only/read-only validation report for the operations dashboard aggregate diagnostics that went live in G39N. It does not change `getAdminOperationsDashboardSummary`, `Operations.jsx`, customer-facing behavior, Hub fallback, Hub writes, schemas, gates, or live data.

The validation goal was narrow: use the already-live G39N diagnostics to test only six low-risk delivery/production aggregate candidates across multiple small date windows and decide whether exactly one aggregate is credible for a future single-aggregate displayed-value patch plan.

Result:

- Clean nonzero candidate found: **yes, conditionally**.
- Recommended candidate for a future G39P **plan**: `delivery.completed_in_range`.
- Runtime displayed-value switch approved in G39O: **no**.
- Reason: `delivery.completed_in_range` had one clean nonzero confirmation window, but two single-day windows showed `delivered_completed_semantic_mismatch`. G39P should be a single-aggregate patch plan with explicit guardrails and additional semantic confirmation before any runtime displayed-value switch.
- Production candidates are held because their only nonzero window showed Hub/native mismatches.
- Inventory/PO, refund/payment, subscription/multi-delivery, repair/replay, and customer-facing order aggregates remain out of scope.

No Base44 publish is needed for G39O.

## 2. G39N evidence

G39N is live for `getAdminOperationsDashboardSummary` and adds diagnostics-only aggregate metadata while preserving current displayed dashboard values.

G39N live baseline carried into G39O:

| Field | Value |
| --- | --- |
| `operations_dashboard_diagnostics_enabled` | `true` |
| `native_first_enabled` | `false` |
| `hub_primary_enabled` | `true` |
| `hub_fallback_active` | `true` |
| `aggregate_count` | `22` |
| `aggregate_mismatch_count` | `1` in the baseline scope |
| `aggregate_mismatch_categories` | `schema_meaning_mismatch:1` |
| `source_of_truth_hold_count` | `16` |
| `fallback_required_count` | `22` |
| `review_required_count` | `8` |
| `native_first_ready_aggregate_count` | `6` |
| `hub_source_of_truth_aggregate_count` | `7` |
| `blocked_aggregate_count` | `16` |

Baseline mismatch requiring hold:

| Aggregate | Displayed/Hub | Native | Category | Source of truth | Decision |
| --- | ---: | ---: | --- | --- | --- |
| `inventory.out_of_stock` | `23` | `16` | `schema_meaning_mismatch` | `manual_review` | Do not trigger inventory deduction or PurchaseOrder creation from dashboard counts. |

The six G39N native-first-ready diagnostic aggregates were:

- `production.batch_count`
- `production.planned_units`
- `production.produced_units`
- `delivery.today_stops`
- `delivery.tomorrow_stops`
- `delivery.completed_in_range`

G39N did not switch displayed values. G39O keeps that boundary.

## 3. Candidate aggregate families

G39O tested only these low-risk aggregate families:

### Delivery candidates

- `delivery.today_stops`
- `delivery.tomorrow_stops`
- `delivery.completed_in_range`

### Production candidates

- `production.batch_count`
- `production.planned_units`
- `production.produced_units`

G39O explicitly did not test or recommend native-primary display for:

- `inventory.out_of_stock`
- inventory stock aggregates
- PurchaseOrder aggregates
- refund/payment aggregates
- subscription/multi-delivery aggregates
- repair/replay aggregates
- customer-facing order aggregates

## 4. Live diagnostic windows tested

All windows were read-only calls to the already-live `getAdminOperationsDashboardSummary` diagnostics. The calls used G39O request IDs and did not invoke mutation endpoints.

| Window | Date range returned | Request ID | Success | Diagnostics live | Writes performed | Aggregate mismatch count |
| --- | --- | --- | --- | --- | --- | ---: |
| `today_preset` | `2026-06-16` to `2026-06-16` | `g39o_ops_dashboard_aggregate_validation_today_preset_20260616T220115Z` | `true` | `true` | `false` | `1` |
| `tomorrow_single_day` | `2026-06-17` to `2026-06-17` | `g39o_ops_dashboard_aggregate_validation_tomorrow_single_day_20260616T220115Z` | `true` | `true` | `false` | `1` |
| `next_7_days` | `2026-06-16` to `2026-06-22` | `g39o_ops_dashboard_aggregate_validation_next_7_days_20260616T220115Z` | `true` | `true` | `false` | `1` |
| `previous_7_days` | `2026-06-09` to `2026-06-15` | `g39o_ops_dashboard_aggregate_validation_previous_7_days_20260616T220115Z` | `true` | `true` | `false` | `1` |
| `known_2026_06_08` | `2026-06-08` to `2026-06-08` | `g39o_ops_dashboard_aggregate_validation_known_2026_06_08_20260616T220115Z` | `true` | `true` | `false` | `2` |
| `known_2026_06_16` | `2026-06-16` to `2026-06-16` | `g39o_ops_dashboard_aggregate_validation_known_2026_06_16_20260616T220115Z` | `true` | `true` | `false` | `1` |
| `known_2026_05_16` | `2026-05-16` to `2026-05-16` | `g39o_ops_dashboard_aggregate_validation_known_2026_05_16_20260616T220115Z` | `true` | `true` | `false` | `2` |
| `last_30_days_preset` | `2026-05-18` to `2026-06-16` | `g39o_ops_dashboard_aggregate_validation_last_30_days_preset_20260616T220115Z` | `true` | `true` | `false` | `12` |

All windows returned:

- `operations_dashboard_diagnostics_enabled:true`
- `native_first_enabled:false`
- `hub_primary_enabled:true`
- `hub_fallback_active:true`
- `dashboard_source_mode:"current_behavior_with_diagnostics"`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `customer_facing_behavior_changed:false`

No customer email, phone, full address, raw Hub payload, raw provider payload, raw Stripe payload, raw Shopify payload, or raw payment payload was printed in the validation output.

## 5. Per-window candidate aggregate table

### Delivery candidates

| Window | `delivery.today_stops` displayed/native/Hub | `delivery.tomorrow_stops` displayed/native/Hub | `delivery.completed_in_range` displayed/native/Hub | Candidate mismatch |
| --- | --- | --- | --- | --- |
| `today_preset` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `tomorrow_single_day` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `next_7_days` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `previous_7_days` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `known_2026_06_08` | `0/0/0` | `0/0/0` | `0/1/0` | `delivery.completed_in_range`: `delivered_completed_semantic_mismatch` |
| `known_2026_06_16` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `known_2026_05_16` | `0/0/0` | `0/0/0` | `1/0/1` | `delivery.completed_in_range`: `delivered_completed_semantic_mismatch` |
| `last_30_days_preset` | `0/0/0` | `0/0/0` | `1/1/1` | none for `delivery.completed_in_range` |

### Production candidates

| Window | `production.batch_count` displayed/native/Hub | `production.planned_units` displayed/native/Hub | `production.produced_units` displayed/native/Hub | Candidate mismatch |
| --- | --- | --- | --- | --- |
| `today_preset` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `tomorrow_single_day` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `next_7_days` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `previous_7_days` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `known_2026_06_08` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `known_2026_06_16` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `known_2026_05_16` | `0/0/0` | `0/0/0` | `0/0/0` | none among candidates |
| `last_30_days_preset` | `15/6/15` | `129/6/129` | `123/6/123` | production semantic/schema mismatches |

## 6. Clean nonzero candidate analysis

### Acceptance criteria applied

A candidate aggregate can advance to a future single-aggregate native-primary patch plan only when the tested evidence shows:

- the aggregate is one of the six allowed delivery/production candidates
- at least one live window has `native_value > 0`
- `comparison_available:true`
- `mismatch_detected:false`
- `native_first_ready:true`
- `review_required:false`
- no blocker
- no provider calls
- no notifications
- no Hub mutation
- `writes_performed:false`
- no inventory/PO implication

G39O also treats `source_of_truth:"mixed"` and `fallback_required:true` as a reason to plan additional guardrails before any runtime displayed-value switch. They are acceptable for selecting a planning candidate, not for approving an immediate value switch.

### Candidate results

| Aggregate | Nonzero native window? | Clean nonzero window? | Mismatch windows | G39O decision |
| --- | --- | --- | --- | --- |
| `delivery.today_stops` | no | no | none | Hold; needs nonzero confirmation window. |
| `delivery.tomorrow_stops` | no | no | none | Hold; needs nonzero confirmation window. |
| `delivery.completed_in_range` | yes | yes: `last_30_days_preset` (`1/1/1`) | `known_2026_06_08`, `known_2026_05_16` | Choose as the only G39P planning candidate, but do not switch display until completed-delivery date-bucket semantics are confirmed. |
| `production.batch_count` | yes | no | `last_30_days_preset` (`15/6/15`) | Hold; production status semantic mismatch. |
| `production.planned_units` | yes | no | `last_30_days_preset` (`129/6/129`) | Hold; unit/schema meaning mismatch. |
| `production.produced_units` | yes | no | `last_30_days_preset` (`123/6/123`) | Hold; produced-unit schema meaning mismatch. |

`delivery.completed_in_range` is the only aggregate with a nonzero clean confirmation window. However, its single-day mismatches mean it is not approved for a direct runtime switch in this phase. A future G39P must be scoped as a single-aggregate plan or tightly guarded patch that proves date-bucket and completion semantics before changing the displayed value.

## 7. Rejected and held aggregate reasons

| Aggregate | Readiness class | Hold reason |
| --- | --- | --- |
| `delivery.today_stops` | `needs_nonzero_window_confirmation` | Native, Hub, and displayed values were zero in every tested window. |
| `delivery.tomorrow_stops` | `needs_nonzero_window_confirmation` | Native, Hub, and displayed values were zero in every tested window. |
| `delivery.completed_in_range` | `ready_for_single_aggregate_native_primary_patch_plan` | One clean nonzero window exists, but per-day delivered/completed semantic mismatches require G39P guardrails before runtime switching. |
| `production.batch_count` | `diagnostics_only_keep_current_display` | Nonzero window showed displayed/Hub `15` vs native `6`, category `production_status_semantic_mismatch`. |
| `production.planned_units` | `diagnostics_only_keep_current_display` | Nonzero window showed displayed/Hub `129` vs native `6`, category `schema_meaning_mismatch`. |
| `production.produced_units` | `diagnostics_only_keep_current_display` | Nonzero window showed displayed/Hub `123` vs native `6`, category `schema_meaning_mismatch`. |
| `inventory.out_of_stock` | `blocked_by_inventory_po_policy` | G39N baseline mismatch remained manual-review governed; inventory deduction and PO automation remain held. |
| Refund/payment aggregates | `blocked_by_subscription_refund_repair_policy` | Hub/payment/refund source-of-truth remains. |
| Subscription/multi-delivery aggregates | `blocked_by_subscription_refund_repair_policy` | Hub source-of-truth remains until exact native occurrence parity is proven. |
| Repair/replay/safeSync aggregates | `blocked_by_subscription_refund_repair_policy` | Log/manual-review source-of-truth remains. |

## 8. Recommended future G39P scope

Recommended next phase: **G39P single-aggregate patch plan for `delivery.completed_in_range` only**.

G39P should not be a broad operations dashboard native-first patch. It should define or implement exactly one candidate path, depending on approval:

- candidate aggregate: `delivery.completed_in_range`
- keep all other operations dashboard displayed values unchanged
- keep `native_first_enabled:false` for the whole dashboard unless the field is explicitly redefined for one aggregate
- keep Hub fallback active
- retain G39N diagnostics metadata
- add a single-aggregate marker such as `delivery_completed_in_range_native_primary_candidate:true`
- require date-bucket and completed-delivery semantics to match G39D route summary behavior
- preserve `writes_performed:false`
- preserve `provider_call_impact:false`
- preserve `notifications_sent:false`
- preserve `hub_mutation_performed:false`
- preserve `customer_facing_behavior_changed:false`

G39P must not:

- switch multiple aggregates at once
- make operations dashboard native-first
- touch inventory/PO/refund/subscription/repair aggregates
- hide Hub values
- remove diagnostics
- trigger provider calls
- send notifications
- create logs/queues
- mutate Customer App, native, Hub, master-data, alert, inventory, or PurchaseOrder records

If G39P cannot reconcile the single-day `delivery.completed_in_range` mismatches, it should stop as diagnostics-only and keep displayed values unchanged.

## 9. Hard stops

Hard stops for G39P or any later operations-dashboard phase:

- making the whole operations dashboard native-first
- changing current displayed values for more than one aggregate in the same patch
- changing customer-facing behavior
- disabling Hub fallback
- suppressing Hub writes
- loosening G39L admin-orders native-primary rules
- treating refund/payment counts as native-authoritative
- treating subscription/multi-delivery counts as native-authoritative
- treating inventory stock as authoritative
- enabling inventory deduction
- enabling PurchaseOrder automation
- creating logs/queues
- sending notifications
- calling Stripe, Shopify, or providers
- exposing customer email, phone, full address, raw Hub payloads, raw provider payloads, raw Stripe/Shopify/payment payloads, secrets, proof payloads, or drop payloads

## 10. No-write confirmation

G39O used read-only diagnostics calls only. It did not publish Base44 and did not run mutation endpoints.

No-write verification scanned recent rows for all G39O request IDs across:

- `ShopifyOrder`
- `Order`
- `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
- `Recipe`
- `InventoryItem`
- `IngredientYield`
- `Bundle`
- `Event`
- `OrderSyncLog`
- `CommandLog`
- `OrderReviewQueue`
- `Notification`
- `CustomerMessageDeliveryLog`
- `PurchaseOrder`
- `ManualProductionBatch`
- `SafeSyncParityLog`
- `OperationalAlert`
- `ComplianceAlert`

Verification result:

- request IDs checked: `8`
- total matching rows: `0`
- `no_write_confirmed:true`

Confirmed absent for G39O request IDs:

- provider/Stripe/Shopify calls
- Hub mutation
- sync/repair/replay
- inventory deduction
- PurchaseOrder creation
- notifications/message logs
- Customer App/native/master-data/alert mutation

## 11. Recommendation

Proceed to a G39P **single-aggregate plan** for `delivery.completed_in_range` if the next phase is intended to continue operations-dashboard burn-down.

Do not approve a runtime displayed-value switch from G39O alone. G39P must first address the observed `delivered_completed_semantic_mismatch` in single-day windows and prove the aggregate aligns with G39D route summary completion/date-bucket semantics.

If that semantic proof is not available, hold the operations dashboard at diagnostics-only.
