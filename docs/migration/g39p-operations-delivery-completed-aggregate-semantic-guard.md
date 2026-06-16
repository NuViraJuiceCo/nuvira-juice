# G39P: Operations Delivery Completed Aggregate Semantic Guard

## 1. Executive summary

G39P is a docs-only/read-only semantic guard plan for the single operations dashboard aggregate candidate `delivery.completed_in_range`.

G39P does not change `getAdminOperationsDashboardSummary`, `Operations.jsx`, customer-facing behavior, Hub fallback, Hub writes, schemas, gates, or live data. No Base44 publish is needed.

G39O found one conditional clean nonzero candidate:

- candidate aggregate: `delivery.completed_in_range`
- clean window: `last_30_days_preset`, with displayed/native/Hub = `1/1/1`
- blocking caveat: single-day windows disagreed:
  - `2026-06-08`: displayed/native/Hub = `0/1/0`
  - `2026-05-16`: displayed/native/Hub = `1/0/1`

G39P resolves the target future semantic as a **route-date completed-delivery count** aligned with G39D delivery route behavior:

> Count admin delivery route rows whose route delivery date is inside the selected range and whose delivery/task status is completed/delivered/fulfilled/picked up.

`delivered_at` is useful evidence, but it should not be the primary date bucket for the operations dashboard displayed value because it can differ from route date, scheduled date, or Hub dashboard behavior. The current displayed value remains Hub/current behavior until a future guarded G39Q patch is approved.

Recommended next phase: G39Q single-aggregate guarded patch for `delivery.completed_in_range`, with fallback to the current displayed value whenever date-bucket semantics or Hub/native comparison is not clean.

## 2. G39O evidence

G39O validated six low-risk operations dashboard candidate aggregates across eight read-only windows.

Candidate results carried forward:

| Aggregate | Nonzero native window? | Clean nonzero window? | Mismatch windows | G39O decision |
| --- | --- | --- | --- | --- |
| `delivery.today_stops` | no | no | none | Hold; needs nonzero confirmation. |
| `delivery.tomorrow_stops` | no | no | none | Hold; needs nonzero confirmation. |
| `delivery.completed_in_range` | yes | yes: `last_30_days_preset` (`1/1/1`) | `2026-06-08`, `2026-05-16` | Only G39P candidate, but requires semantic guard. |
| `production.batch_count` | yes | no | `last_30_days_preset` (`15/6/15`) | Hold; production status semantic mismatch. |
| `production.planned_units` | yes | no | `last_30_days_preset` (`129/6/129`) | Hold; unit/schema meaning mismatch. |
| `production.produced_units` | yes | no | `last_30_days_preset` (`123/6/123`) | Hold; produced-unit schema meaning mismatch. |

G39O hard boundary:

- Do not switch any displayed value from G39O alone.
- Do not use the `last_30_days_preset` match as proof for single-day semantics.
- Resolve `delivery.completed_in_range` date-bucket semantics before any runtime displayed-value patch.

## 3. Semantic question

The exact semantic question is:

> What should `delivery.completed_in_range` count?

Possible definitions considered:

1. Orders/tasks with `delivered_at` inside the selected range.
2. Orders/tasks with `delivery_date` inside the selected range and delivered/completed status.
3. Orders/tasks with `assigned_delivery_date` inside the selected range and delivered/completed status.
4. Hub-delivery-summary completed rows inside the selected range.
5. Current dashboard displayed behavior, regardless of native semantics.

### Current behavior

The current displayed operations dashboard behavior is Hub/current behavior when Hub succeeds. It returns the Hub operations dashboard summary field:

- `summary.delivery.completed_in_range`

G39N diagnostics compare that displayed Hub value with a native diagnostic value, but they do not change the display.

The current native diagnostic value in `getAdminOperationsDashboardSummary` is not a pure route-date bucket. It counts `FulfillmentTask` rows where:

- task status is one of delivered/picked up/fulfilled/completed; and
- `delivered_at || delivery_date || scheduled_date || assigned_delivery_date` falls inside the selected range.

That means `delivered_at` wins over route date when present.

### Recommended future behavior

A future displayed-value patch should define `delivery.completed_in_range` as a G39D-aligned route-date completed-delivery count:

- primary bucket: `delivery_date`
- fallback bucket only when needed: `scheduled_date`, then `assigned_delivery_date`
- completed status: `delivered`, `completed`, `fulfilled`, or `picked_up`
- `delivered_at`: supporting audit evidence, not the primary date bucket
- Hub fallback: retained
- current displayed value: retained when comparison is not clean

This is closest to definitions 2 and 3. It intentionally does not use definition 1 as the primary bucket and does not blindly preserve definition 5 when native route-date semantics are proven clean.

## 4. Current source audit

### `getAdminOperationsDashboardSummary`

Current native diagnostic source:

- entity: `FulfillmentTask`
- source filter: excludes POS/event fulfillment tasks
- completion status helper: delivered/picked up/fulfilled/completed
- date helper: `task.delivered_at || task.delivery_date || task.scheduled_date || task.assigned_delivery_date`
- aggregate logic: count completed tasks whose selected helper date is inside the requested range

Current displayed/Hub source:

- external Hub read: `getOperationsDashboardSummaryForCustomerApp`
- field consumed: `summary.delivery.completed_in_range`
- custom range request: sends `date_from` and `date_to`
- preset request: sends `preset`
- response contract: aggregate count only; no safe row-level Hub completed-delivery rows are returned by this operations summary function

Current date handling:

- custom range uses caller-provided ISO date strings
- presets resolve dates using America/Chicago for the local function
- `dateKey` extracts the leading `YYYY-MM-DD` from date-like values
- `delivered_at` timestamps are currently bucketed by their leading ISO date, not explicitly converted to America/Chicago

### `getAdminDeliveryRouteSummary` / G39D behavior

G39D made route summary native-first with Hub fallback retained.

Current native route source:

- entity: `FulfillmentTask`
- route selection: tasks whose `delivery_date || scheduled_date` equals the requested `delivery_date`
- route row fallback date: `delivery_date || scheduled_date || assigned_delivery_date`
- completed section: rows with task/delivery status delivered/completed/fulfilled
- Hub fallback: retained and reported
- stale Hub suppression: retained

This surface is already live and is the appropriate semantic reference for delivery route date buckets.

### Native ShopifyOrder and Customer App Order context

`getAdminDeliveryRouteSummary` reads native `ShopifyOrder` rows to enrich task context with safe admin route fields. Those fields are context only for this aggregate. `delivery.completed_in_range` should not become a broad order-delivered count and should not change customer-facing order history/tracker behavior.

### Hub route/dashboard context

The operations dashboard Hub summary exposes aggregate counts only. The route summary Hub read can expose route rows, but G39D native-first reconciliation may suppress or contextualize Hub rows when native route context exists. Therefore G39P does not infer exact Hub row truth from the operations aggregate alone.

## 5. Row-level evidence for mismatched dates

G39P gathered read-only row-level evidence for the two mismatched single-day windows and the matching `last_30_days` window. The evidence was sanitized: no customer email, phone, full address, raw Hub payload, raw provider payload, raw payment payload, proof payload, or drop payload was printed.

### Operation aggregate evidence

| Window | Displayed | Native diagnostic | Hub diagnostic | Mismatch | Category | Writes/provider/notification/Hub mutation |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `2026-06-08` custom | `0` | `1` | `0` | yes | `delivered_completed_semantic_mismatch` | all false |
| `2026-05-16` custom | `1` | `0` | `1` | yes | `delivered_completed_semantic_mismatch` | all false |
| `last_30_days_preset` (`2026-05-18` to `2026-06-16`) | `1` | `1` | `1` | no | none | all false |

### `2026-06-08` row evidence

Route summary for `2026-06-08` returned one completed native row:

| Field | Value |
| --- | --- |
| order number | `NV-MPZNKGNT` |
| source | native task / G39D route summary |
| status | `delivered` |
| delivery status | `delivered` |
| fulfillment status | `fulfilled` |
| delivered_at | `2026-06-08T13:30:00.000Z` |
| delivery_date | `2026-06-08` |
| scheduled_date | `2026-06-08` |
| assigned_delivery_date | `2026-06-08` |
| route section | `completed` |
| contributes to native operations diagnostic | yes |
| contributes to G39D route completed count | yes |
| contributes to Hub/displayed operations count for custom `2026-06-08` | no |

Explanation:

- Native task evidence and G39D route-date evidence agree that the row is completed on `2026-06-08`.
- Hub/current operations displayed value for the same custom single-day window is `0`.
- This is a Hub/displayed-vs-native semantic mismatch, not a write or provider issue.
- A future G39Q patch must not switch the displayed value for this window unless the chosen route-date semantic is explicitly allowed to supersede current Hub custom-window behavior.

### `2026-05-16` row evidence

Route summary for `2026-05-16` returned one active native route row and no completed native route rows:

| Field | Value |
| --- | --- |
| order number | `#NV-MP5SOQLJ` |
| source | native task / G39D route summary |
| status | `bottled_packed` |
| delivery status | `pending` |
| fulfillment status | `pending` |
| delivered_at | absent |
| delivery_date | `2026-05-16` |
| scheduled_date | `2026-05-16` |
| assigned_delivery_date | `2026-05-16` |
| route section | `delivery_stops` |
| contributes to native operations diagnostic | no |
| contributes to G39D route completed count | no |
| contributes to Hub/displayed operations count for custom `2026-05-16` | aggregate says yes, row not exposed by the safe operations contract |

Explanation:

- Native route evidence says the row is scheduled/active, not completed.
- Hub/current operations displayed value for the same custom single-day window is `1`.
- The operations Hub aggregate does not expose row-level completed-delivery details, so G39P cannot safely prove which Hub row contributed.
- This must be guarded as a current-display/HUB source-of-truth case until a future patch can compare route-date semantics without guessing.

### `last_30_days_preset` evidence

The `last_30_days_preset` window returned displayed/native/Hub = `1/1/1` and `native_first_ready:true` for `delivery.completed_in_range`.

This is useful but not sufficient by itself:

- the preset window includes `2026-06-08`
- the preset window excludes `2026-05-16`
- single-day custom windows still disagree
- preset behavior and custom date-range behavior may not be semantically identical in Hub

Therefore the last-30-days match supports candidate selection, but does not authorize an unguarded displayed-value switch.

## 6. Candidate acceptance rule

A future G39Q displayed-value switch for `delivery.completed_in_range` is allowed only when all are true:

- the selected semantic is the G39D-aligned route-date completed-delivery count
- native source can compute that semantic from `FulfillmentTask` route dates and completed statuses
- Hub/current displayed source can be compared to that semantic for the requested window
- comparison is available
- mismatch is not detected
- `native_first_ready:true` or equivalent guarded candidate metadata is present
- `review_required:false`
- no blocker is present
- no subscription/multi-delivery ambiguity exists
- no repair/replay/safeSync ambiguity exists
- no refund/payment/customer-facing order-status ambiguity is introduced
- Hub fallback remains active
- G39N diagnostics remain present
- response shape remains backward-compatible
- no writes are performed
- no providers are called
- no notifications are sent

If any of these fail:

- keep the current displayed value
- return guard metadata explaining why native display was not used
- classify the aggregate as `hold_date_bucket_semantics_guarded`

If the team rejects the G39D route-date semantic, then the operations dashboard should remain diagnostics-only and classify as `hold_date_bucket_semantics_unresolved`.

## 7. Future G39Q guard design

If approved, G39Q should be limited to exactly one aggregate:

- `delivery.completed_in_range`

G39Q should preserve all other operations dashboard displayed values.

Proposed additive metadata:

- `delivery_completed_in_range_native_primary_enabled:true`
- `completed_delivery_date_bucket:"route_delivery_date"`
- `completed_delivery_native_source:"fulfillment_task_route_date_completed_status"`
- `completed_delivery_hub_source:"hub_operations_dashboard_summary.delivery.completed_in_range"`
- `completed_delivery_mismatch_guard:true`
- `completed_delivery_guard_status`
- `completed_delivery_guard_reason`
- `completed_delivery_native_value`
- `completed_delivery_displayed_previous_value`
- `completed_delivery_displayed_final_value`
- `completed_delivery_hub_value`
- `completed_delivery_route_summary_reference:"g39d"`

G39Q should choose native display only when the guard passes. It should fall back to current displayed value when:

- native comparison is unavailable
- Hub/displayed value differs unexpectedly in a nonzero confirmation window
- date-bucket semantics mismatch
- custom range and preset behavior disagree
- subscription/multi-delivery ambiguity exists
- repair/replay/safeSync ambiguity exists
- historical/late mirror context is present without explicit route-date proof
- Hub fallback is unavailable and native route evidence is incomplete

G39Q must not:

- make the whole operations dashboard native-first
- switch `delivery.today_stops`
- switch `delivery.tomorrow_stops`
- switch production aggregates
- touch inventory/PO/refund/subscription/repair aggregates
- hide Hub values
- remove diagnostics
- add write actions/buttons

## 8. Future test plan

Future harness:

```bash
node scripts/migration/run-g39q-operations-delivery-completed-aggregate-tests.mjs
```

Planned tests:

1. Last-30-days nonzero native/display/Hub match permits native candidate.
2. Single-day native-only row with route date and delivered status is guarded when Hub/displayed is zero.
3. Single-day Hub/display row with no native matching completed route row is guarded.
4. Chosen route-date bucket semantic is applied consistently.
5. `delivered_at` does not override route-date bucket for displayed-value eligibility.
6. Subscription delivery row stays Hub source-of-truth.
7. Repair/replay row stays manual-review governed.
8. Historical/late mirror row does not become broad proof.
9. Other operations dashboard aggregates remain unchanged.
10. Hub fallback remains active.
11. G39N diagnostics remain present.
12. `writes_performed:false`.
13. `provider_call_impact:false`.
14. `notifications_sent:false`.
15. `hub_mutation_performed:false`.
16. no logs/queues created.
17. response shape remains backward-compatible.
18. customer-facing behavior remains unchanged.

Regression harnesses for G39Q should include:

- G39N operations dashboard diagnostics harness
- G39D delivery route harness
- G39H calendar harness if date semantics are shared
- G39J/G39L admin orders harnesses if order classification is touched
- G27 cutover harness if shared preview helpers are touched
- scoped ESLint
- `npm run build`

## 9. Risk assessment

Low-risk attributes:

- single aggregate only
- admin-only dashboard
- diagnostics already live
- Hub fallback retained
- no write path required

Medium-risk attributes:

- single-day date bucket semantics disagree
- current native diagnostic prefers `delivered_at` over route date
- Hub custom-range behavior and Hub preset behavior may not be identical
- historical/late mirrors can distort delivery completion counts
- route summary and operations summary currently use different date logic

High-risk hard stops:

- switching displayed value before guard rules are implemented
- using the `last_30_days_preset` match alone as proof
- changing customer-facing delivery status
- using completed delivery count to trigger actions
- touching inventory/PO/refund/subscription/repair aggregates
- disabling Hub fallback
- suppressing Hub writes
- calling Stripe, Shopify, or providers
- sending notifications
- creating logs/queues
- mutating Customer App, native, Hub, alert, inventory, or master-data records

## 10. Hard stops

G39Q or any later operations-dashboard patch must stop if it would:

- switch more than `delivery.completed_in_range`
- make operations dashboard broadly native-first
- remove Hub fallback
- hide Hub/current values from diagnostics
- change customer-facing order or delivery status
- loosen admin-orders native-primary rules
- treat refund/payment/subscription rows as native-authoritative
- treat repair/replay rows as native-authoritative
- use the aggregate for operational commands
- enable inventory deduction
- enable PurchaseOrder automation
- expose customer email, phone, full address, raw Hub payloads, raw provider payloads, raw Stripe/Shopify/payment payloads, secrets, proof payloads, or drop payloads

## 11. No-write confirmation

G39P gathered read-only evidence only. It did not publish Base44 and did not run mutation endpoints.

Read-only request IDs:

- `g39p_delivery_completed_semantic_guard_ops_single_2026_06_08_20260616T221442Z`
- `g39p_delivery_completed_semantic_guard_ops_single_2026_05_16_20260616T221442Z`
- `g39p_delivery_completed_semantic_guard_ops_last_30_days_20260616T221442Z`
- `g39p_delivery_completed_semantic_guard_route_2026_06_08_20260616T221442Z`
- `g39p_delivery_completed_semantic_guard_route_2026_05_16_20260616T221442Z`

No-write verification scanned recent rows for those request IDs across:

- `ShopifyOrder`
- `Order`
- `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
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

- total matching rows: `0`
- `no_write_confirmed:true`

Confirmed absent:

- provider/Stripe/Shopify calls
- Hub mutation
- sync/repair/replay
- inventory deduction
- PurchaseOrder creation
- notifications/message logs
- Customer App/native/master-data/alert mutation

## 12. Recommendation

Proceed to **G39Q single-aggregate guarded patch** for `delivery.completed_in_range` only if the team accepts the route-date completed-delivery semantic.

G39Q should not blindly switch the displayed value. It should compute the route-date native candidate, preserve current display when the guard fails, and expose explicit guard metadata.

If the route-date semantic is not accepted, or if G39Q cannot safely distinguish custom-range/preset Hub behavior, hold operations dashboard displayed values at diagnostics-only.
