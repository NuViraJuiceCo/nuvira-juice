# G39E — Admin production planning native-first patch plan

## 1. Executive summary

G39E selects `getAdminProductionPlanningSummary` as the next low-risk admin read surface for a future native-first runtime patch. This document is a docs-only implementation plan. It does not change runtime behavior, admin UI behavior, customer-facing behavior, Hub fallback, schemas, gates, or live data.

G39B live parity evidence made production planning a good secondary candidate after the successful G39D delivery route patch:

- admin-only surface
- read-only aggregation function
- G39B classified `production_planning` as `ready_for_native_first_patch`
- G39B risk level was low
- sampled live parity found 10 native rows, 0 Hub rows, and no mismatches
- native planning/readiness surfaces are mature enough for operator preview context
- Hub fallback can remain active and explicitly reported

The future G39F patch should make native production planning rows primary while retaining Hub fallback for missing or incomplete native data, historical contexts, subscription contexts, and any remaining master-data gaps.

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

G39B production planning surface result:

| Field | Value |
| --- | --- |
| Surface | `production_planning` |
| Readiness | `ready_for_native_first_patch` |
| Risk | low |
| Native row count | 10 |
| Hub row count | 0 |
| Mismatch count | 0 |
| Recommended order | secondary candidate after `delivery_route_summary` |

G39B does not prove that Hub can be removed. It proves that a native-first admin read patch is reasonable if Hub fallback remains available and reported.

## 3. Why `getAdminProductionPlanningSummary` is selected

`getAdminProductionPlanningSummary` is the next appropriate native-first admin read candidate because it is:

1. Admin-only.
2. Read-only.
3. Already native-aware through the Customer App `ShopifyOrder` mirror and native master-data entities.
4. Already exposes a `native_overlay` section that separates native planning evidence from Hub planning context.
5. Operationally important for production migration readiness, but not customer-facing.
6. Lower risk than `getAdminOrdersWithHub`, `getAdminOperationsDashboardSummary`, `getAdminOpsAlertsSummary`, or `getAdminResourcesSummary`.
7. A natural follow-up to the now-live G39D native-first delivery route summary patch.

Do not target these first:

- `getAdminOrdersWithHub`: broader row shape and customer/order list risk.
- `getAdminOperationsDashboardSummary`: aggregate parity still needs more fields.
- `getAdminOpsAlertsSummary`: alert semantics need more native parity.
- `getAdminResourcesSummary`: resource/team/equipment parity is incomplete.

## 4. Current behavior audit

### Function audited

- `base44/functions/getAdminProductionPlanningSummary/entry.ts`

### Admin UI consumer audited

- `src/pages/admin/ProductionPlanning.jsx`

### Current auth and request behavior

The function:

- uses `createClientFromRequest(req)`
- requires authenticated admin access through `base44.auth.me()`
- returns `401` for unauthenticated requests
- returns `403` for non-admin users
- accepts JSON body input
- supports presets `today`, `this_week`, `next_7_days`
- supports custom `date_from` / `date_to` ranges
- limits custom ranges to 31 days
- performs no record writes
- creates no logs or queues
- does not call Stripe, Shopify, delivery providers, or notification services
- calls the Hub production planning summary endpoint when Hub config exists

### Current Hub reads

If `HUB_API_URL` and `CUSTOMER_APP_SYNC_SECRET` are configured, the function calls:

- Hub function: `getProductionPlanningSummaryForCustomerApp`
- Method: GET
- Parameters: `preset` or `date_from` / `date_to`
- Auth: bearer secret from environment

If Hub is not configured, unavailable, or malformed, the function returns native overlay context with warnings where possible.

### Current native reads

The current native overlay is built by `loadNativeMay30Planning`. It reads native/customer app backend entities through service-role list reads:

- `ShopifyOrder`
- `Recipe`
- `Bundle`
- `Product`
- `InventoryItem`
- `IngredientYield`

The current function does not read these entities:

- `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`

Those reads may be added in G39F only if needed for a backward-compatible native-first production planning row contract and covered by fixture tests.

### Current native selection logic

The native overlay currently filters for May 30/native operational order context. It excludes or avoids:

- unpaid or refunded orders
- cancelled orders
- POS/event stock rows except the explicit May 30 event stock plan
- subscription or multi-delivery-looking rows
- orders without line items
- rows outside the selected planning range

The native overlay calculates:

- production dates
- product demand
- planned units
- ingredient requirements
- recipe matches
- bundle/product expansion
- inventory context
- IngredientYield procurement-unit context
- missing or ambiguous master-data counts

It also returns these policy flags:

- `inventory_deduction_enabled:false`
- `purchase_order_automation_enabled:false`

### Current merge order

The current response is merged, but not native-first:

- Hub summary is initialized/fetched first.
- Native planning overlay is loaded after Hub.
- `summary` is `mergeSummaries(hubData.summary, nativePlanning.summary)`.
- `dates` is `mergeDateGroups(hubData.dates, nativePlanning.dates).slice(0, 62)`.
- `mergeDateGroups` currently concatenates Hub date groups first, then native date groups, then sorts by production date and source.
- `ingredients` is `[...hubIngredients, ...nativeIngredients].slice(0, 200)`, so Hub ingredient rows are returned before native ingredient rows.

This means Hub-derived planning remains visibly primary in the current admin surface whenever Hub data is present.

### Current response shape

Current top-level response fields:

- `success`
- `date_from`
- `date_to`
- `generated_at`
- `summary`
- `dates`
- `ingredients`
- `truncated`
- `native_overlay`
- `warnings`

Current `summary` fields used by the admin page include:

- `production_date_count`
- `batch_count`
- `planned_units`
- `ingredient_count`
- `shortage_count`
- `missing_recipe_count`
- `missing_yield_count`
- `native_order_count`
- `skipped_missing_date_count`

Current `dates` group fields include:

- `production_date`
- `batch_count`
- `planned_units`
- `produced_units`
- `product_groups`
- `ingredient_count`
- `shortage_count`
- `native_order_count`
- `source`

Current product group fields include:

- `product_name`
- `product_category`
- `planned_units`
- `produced_units`
- `batch_count`
- `source_order_count`
- `source`

Current `ingredients` fields include:

- `ingredient`
- `unit`
- `required_quantity`
- `available_stock`
- `shortage_amount`
- `status`
- `yield_match_found`
- `procurement_needed_quantity`
- `procurement_purchase_unit`
- `procurement_units_per_case`
- `procurement_case_quantity`
- `procurement_rounding_rule`
- `source_products`
- `production_dates`
- `source`

### Current admin UI assumptions

`ProductionPlanning.jsx` invokes `getAdminProductionPlanningSummary` and currently uses:

- `data.summary`
- `data.dates`
- `data.ingredients`
- `data.native_overlay`
- `data.warnings`
- `data.truncated`

The page renders:

- production date count
- batch count
- planned units
- ingredient count
- procurement needs
- master-data gap counts
- native overlay details
- read-only draft ProductionBatch cards
- ingredient demand tables/cards
- Hub/native warning messaging

The page explicitly tells operators that draft cards are read-only and that no `ProductionBatch`, `CommandLog`, inventory deduction, purchase order, notification, or Hub record is created from this summary.

### Current privacy behavior

The function sanitizes text fields and redacts email/phone/auth-like token patterns. The current admin production planning page displays product, ingredient, source, date, and count information. It does not need customer email, phone, full address, raw Hub payloads, raw provider payloads, raw payment payloads, or secrets.

### Current write/provider behavior

Audit found no create/update/delete/upsert paths in `getAdminProductionPlanningSummary`. The function performs:

- one optional Hub GET read when configured
- native entity list reads
- local aggregation/sanitization
- JSON response construction

It does not create logs, queues, notifications, batches, compliance logs, purchase orders, or inventory deductions.

## 5. Proposed native-first read order

G39F should use this future read order:

1. Read native production planning sources first:
   - `ShopifyOrder`
   - `FulfillmentTask` if needed for task/production/delivery status context
   - `ProductionBatch` if needed for existing batch count/status summaries
   - `BatchComplianceLog` if needed for verified/compliance count summaries
   - `Recipe`
   - `InventoryItem`
   - `IngredientYield`
   - `Bundle`
   - `Product`
2. Build native production planning rows and ingredient rows from native records.
3. Fetch Hub production planning summary only as fallback/context when Hub config exists.
4. Use Hub fallback only when native planning context is missing or incomplete.
5. Preserve Hub fallback for:
   - older/historical rows
   - subscription/multi-delivery contexts
   - records missing native task/order/batch coverage
   - remaining master-data gaps
   - legacy production history not represented by native batches
6. Deduplicate native/Hub rows by safe operational keys.
7. Return explicit fallback reporting.
8. Never write records.
9. Never call providers.
10. Never send notifications.

Safe matching keys:

- `order_number`
- `customer_app_order_id`
- `native_shopify_order_id`
- `native_fulfillment_task_id`
- `production_date`
- `delivery_date`
- `production_batch_id` where applicable
- product name as supporting context only

Do not use:

- customer email
- customer phone
- fuzzy customer name matching
- raw Hub payloads
- raw provider/payment payloads

## 6. Production planning row contract

G39F should preserve the current response shape and add metadata only. The future native-first row/summary contract should keep these safe fields available where they already exist or can be derived safely:

- `order_number`
- `customer_app_order_id` if safe and already admin-operational
- `native_shopify_order_id` if safe and already admin-operational
- `native_fulfillment_task_id` if safe and already admin-operational
- `production_date`
- `delivery_date`
- `order_status`
- `payment_status`
- `fulfillment_type`
- `fulfillment_status`
- `production_status`
- `delivery_status`
- `line_item_count`
- `product_demand_count`
- safe product names / item names
- `batch_count` or `ProductionBatch` count
- `production_batch_status_summary`
- `batch_compliance_log_count`
- `master_data_ready`
- `production_ready`
- `procurement_needed`
- `procurement_visibility_ready`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- `blockers`
- `warnings`
- `data_source`
- `fallback_source`
- `fallback_reason`

G39F should not return:

- customer email
- customer phone
- full address
- raw Hub payload
- raw provider payload
- raw payment payload
- raw proof/drop payload
- secrets/auth values

If G39F needs to add new metadata, it should be additive and safe:

- `native_first_enabled:true`
- `native_row_count`
- `hub_fallback_row_count`
- `suppressed_hub_row_count`
- `fallback_required`
- `fallback_reasons`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`

## 7. Fallback behavior

Fallback behavior must be explicit. G39F should classify and report these cases:

| Case | Admin-visible behavior | Metadata / warning | Safe for G39F patch? |
| --- | --- | --- | --- |
| `native_planning_row_present_no_hub_needed` | return native planning row as primary | `data_source:customer_app_native`, `native_primary:true` | yes |
| `native_planning_row_missing_hub_fallback_used` | return Hub fallback row | `fallback_reason:native_planning_row_missing` | yes |
| `native_planning_row_incomplete_hub_fallback_used` | return native row with Hub context where needed | `fallback_reason:native_planning_row_incomplete` | yes |
| `native_batches_missing_hub_context_used` | show native demand/readiness plus Hub historical batch context | warning that native batch coverage is incomplete | yes, read-only only |
| `native_master_data_missing_hub_context_used` | show native blocker/warning, use Hub only as context | warning with exact missing native field/entity | yes, no write recommendation |
| `subscription_context_hub_source_of_truth` | retain Hub source-of-truth classification | `hub_source_of_truth_for_now` | yes, do not native-cutover |
| `historical_late_mirror_native_context_only` | classify as historical/late mirror, not live production candidate | warning that production lifecycle commands are not implied | yes |
| `duplicate_native_hub_row_deduped` | keep native primary and report fallback/dedupe | `fallback_reason:duplicate_native_hub_row_deduped` | yes |
| `hub_only_row_retained` | keep Hub row because native row is absent | `data_source:hub_fallback` | yes |
| `no_planning_rows_found` | return empty safe response | `fallback_required:false` unless Hub unavailable warning applies | yes |

Hard rule: do not remove Hub fallback. G39F should only make native rows primary while keeping Hub fallback available and reported.

## 8. Production-specific risk rules

G39F must keep these production-specific constraints intact:

- Inventory deduction remains held.
- PurchaseOrder automation remains held.
- Notifications remain held.
- Hub fallback remains active for missing native production context.
- Subscriptions remain Hub source of truth.
- Historical or late mirror rows must not be treated as live production lifecycle candidates.
- Missing `ProductionBatch` rows do not automatically mean a materialization command should run.
- Missing native master data should return blockers/warnings, not an automatic import recommendation.
- Production lifecycle command planning still requires an exact active paid/captured one-time order, fresh previews, and separate approval.
- Customer-facing status must not change from this admin read surface.

## 9. Future G39F implementation scope

G39F should be a narrow runtime patch to:

- `base44/functions/getAdminProductionPlanningSummary/entry.ts` only
- optional local helper functions inside the same file if needed
- no schema changes
- no admin UI changes unless strictly necessary for backward-compatible metadata display
- no customer-facing UI changes
- no provider calls
- no Hub writes
- no record writes
- no notification changes
- no sync/repair/replay

G39F must:

- keep the existing response shape backward-compatible
- preserve `summary`, `dates`, `ingredients`, `native_overlay`, `warnings`, and `truncated`
- make native rows/ingredients primary when native evidence exists
- retain Hub fallback rows/context when native evidence is missing or incomplete
- report Hub fallback usage explicitly
- return safety flags such as `writes_performed:false` where feasible
- include request id in diagnostics only if safe

G39F may add read-only `FulfillmentTask`, `ProductionBatch`, or `BatchComplianceLog` enrichment only if the resulting row contract remains backward-compatible and the fixture harness covers the added cases.

## 10. Future G39F test plan

Future harness:

- `scripts/migration/run-g39f-admin-production-planning-native-first-tests.mjs`

Planned test cases:

1. Native production planning row present -> returned as primary.
2. Hub row absent -> native row still returned.
3. Native row missing and Hub row present -> Hub fallback used.
4. Native row incomplete and Hub row present -> native row returned with Hub fallback context.
5. Duplicate native/Hub same order/date -> deduped, native primary.
6. Historical/late mirror row classified as not live production candidate.
7. Subscription/multi-delivery row remains Hub source-of-truth.
8. Missing native master data returns blocker/warning, not write recommendation.
9. Missing `ProductionBatch` returns preview-only status, not auto-command recommendation.
10. No rows -> empty safe response.
11. Existing response shape remains backward-compatible.
12. No customer email/phone returned.
13. No full address returned.
14. No raw Hub/provider/payment payload returned.
15. `writes_performed:false`.
16. `provider_call_impact:false`.
17. `notifications_sent:false`.
18. `hub_mutation_performed:false`.
19. `inventory_deduction_ready:false`.
20. `purchase_order_ready:false`.
21. No logs/queues created.
22. G34B procurement visibility regression remains compatible.

Regression harnesses to include:

- G39B admin native/Hub read parity harness
- G34B procurement visibility harness
- G33C mirror/task/master-data harnesses where native order/task shape is relevant
- G31 lifecycle/master-data harnesses if production planning helpers are touched
- G27 native cutover readiness harness if shared preview logic is touched
- scoped ESLint
- `npm run build`

## 11. Risk assessment

### Low-risk factors

- Admin-only surface.
- Read-only function.
- G39B live parity showed no mismatches for sampled production planning rows.
- Native production/master-data/readiness preview work is mature.
- Hub fallback remains active.
- G39D already proved the pattern for a neighboring admin read surface.

### Medium-risk factors

- Production planning combines orders, tasks, batches, recipes, inventory, procurement, and schedule fields.
- Late/historical mirrors can look production-ready even when live commands are not operationally appropriate.
- Subscriptions remain Hub-owned.
- Missing batches can mean either not materialized yet or historical mirror context.
- Current function does not read `FulfillmentTask`, `ProductionBatch`, or `BatchComplianceLog`, so G39F must decide whether to keep scope to current native overlay or add tested read-only enrichment.
- Fallback reporting is necessary to avoid operator confusion.

### High-risk / hard stops

- Removing Hub fallback.
- Creating `ProductionBatch` records.
- Creating or updating `BatchComplianceLog` records.
- Altering production status.
- Changing customer-facing status.
- Enabling inventory deduction.
- Enabling PurchaseOrder automation.
- Sending notifications.
- Calling providers.
- Hiding Hub-only subscription planning rows.
- Exposing PII or raw payloads.

## 12. Rollback plan for future G39F

If G39F exposes an admin route/planning regression:

1. Revert the `getAdminProductionPlanningSummary` native-first patch.
2. Keep Hub fallback active throughout rollback.
3. Do not perform data repair; G39F should be read-only and should not mutate records.
4. Monitor the admin production planning page after deploy.
5. Re-run the G39B parity preview and G39F harness before retrying.

Because G39F should not mutate data, rollback should be code-only.

## 13. Hard stops

Do not proceed to a runtime patch if G39F would require any of these:

- disabling Hub fallback
- suppressing Hub writes
- changing customer-facing behavior
- broad schema changes
- live production command execution
- inventory deduction
- PurchaseOrder creation
- notifications
- provider/Stripe/Shopify calls
- sync/repair/replay
- returning customer email/phone/full address
- returning raw Hub/provider/payment payloads
- treating historical/late mirror rows as normal live production candidates
- treating subscription planning rows as native source-of-truth
- automatic command recommendations from missing `ProductionBatch` rows

## 14. Recommendation

Proceed to G39F with a narrow runtime patch for `getAdminProductionPlanningSummary` only, unless implementation audit finds a row contract gap that cannot be solved additively.

Recommended G39F scope:

1. Make the response native-first where native planning rows exist.
2. Keep Hub fallback active.
3. Add explicit fallback reporting and safety flags.
4. Preserve existing `ProductionPlanning.jsx` response fields.
5. Do not change admin UI unless required for additive metadata display.
6. Do not create/update/delete any records.
7. Keep inventory deduction, PurchaseOrder automation, notifications, providers, and Hub mutation held.

No live production lifecycle proof is implied by this plan. The live production lifecycle remains held until a real active paid/captured one-time order exists and exact write approvals are issued.
