# G39F — Admin production planning native-first runtime patch

## 1. Purpose

G39F patches `getAdminProductionPlanningSummary` so the admin production planning summary is native-first while keeping Hub fallback active. The surface remains admin-only and read-only.

This patch is part of the Hub dependency burn-down sequence after G39D made delivery route summary native-first. It does not change customer-facing behavior and does not make any production lifecycle command eligible by itself.

## 2. G39B / G39E evidence

G39B classified `production_planning` as:

- readiness: `ready_for_native_first_patch`
- risk: low
- sampled live parity: 10 native rows, 0 Hub rows, no mismatches
- no provider calls
- no notifications
- no Hub mutation
- no PII returned

G39E audited the existing function and found:

- current visible merge was Hub-first, then native overlay
- native overlay already read `ShopifyOrder`, `Recipe`, `Bundle`, `Product`, `InventoryItem`, and `IngredientYield`
- current function did not read `FulfillmentTask`, `ProductionBatch`, or `BatchComplianceLog`
- no create/update/delete/upsert paths existed
- no provider calls, notifications, logs/queues, inventory deduction, or PO automation existed

G39F intentionally keeps the first runtime patch narrow. It does not add `FulfillmentTask`, `ProductionBatch`, or `BatchComplianceLog` reads.

## 3. Current behavior before G39F

Before G39F, the function fetched Hub production planning summary first, then built the native May 30 overlay. The response shape was read-only but visibly Hub-first:

- `summary` added Hub summary and native summary together
- `dates` merged Hub date groups before native date groups
- `ingredients` returned Hub ingredient rows before native ingredient rows
- `native_overlay` carried the native mirror/readiness evidence

The admin page `ProductionPlanning.jsx` consumed these fields:

- `summary`
- `dates`
- `ingredients`
- `native_overlay`
- `warnings`
- `truncated`

G39F preserves those fields.

## 4. Native-first algorithm

G39F now uses this read/merge model:

1. Build native production planning context first from existing native sources:
   - `ShopifyOrder`
   - `Recipe`
   - `Bundle`
   - `Product`
   - `InventoryItem`
   - `IngredientYield`
2. Fetch Hub production planning summary only as fallback/context when Hub config exists.
3. Prefer native date/product rows where native data is present.
4. Prefer native ingredient rows where native master-data evidence is complete enough.
5. Use Hub fallback when native rows are missing.
6. Use Hub fallback context when native ingredient data is incomplete for the current admin response contract.
7. Deduplicate native/Hub rows for the same product/date with native primary.
8. Keep Hub-only rows instead of hiding them.
9. Return explicit fallback metadata.
10. Never write records.

Safe matching keys are limited to operational planning fields:

- `production_date`
- product/recipe name
- ingredient name and unit

The patch does not use customer email, phone, fuzzy customer name matching, raw Hub payloads, or provider/payment payloads.

## 5. Fallback metadata

G39F adds these safe top-level fields:

- `native_first_enabled:true`
- `native_row_count`
- `hub_fallback_row_count`
- `native_overlay_row_count`
- `hub_summary_row_count`
- `suppressed_hub_row_count`
- `fallback_required`
- `fallback_reasons`
- `hub_fallback_used`
- `native_missing_count`
- `hub_only_count`
- `native_only_count`
- `mismatch_count`
- `production_planning_source`
- `writes_performed:false`
- `provider_call_impact:false`
- `notifications_sent:false`
- `hub_mutation_performed:false`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- `live_production_command_candidate:false`
- `production_batch_command_ready:false`
- `production_lifecycle_command_recommendation:preview_only_fresh_active_order_required`

G39F adds safe per-row metadata to date/product/ingredient rows where applicable:

- `data_source`
- `fallback_source`
- `fallback_reason`
- `native_primary`
- `hub_fallback_used`
- `warnings`

Fallback reasons include:

- `native_planning_row_missing`
- `native_data_incomplete_for_production_planning`

## 6. Response compatibility

G39F keeps the existing response shape backward-compatible for `ProductionPlanning.jsx`:

- `summary` remains an object with production date, batch, units, ingredient, shortage, recipe, yield, and native order counts.
- `dates` remains an array of production date groups.
- `date.product_groups` remains an array of product demand groups.
- `ingredients` remains an array of ingredient demand/procurement context rows.
- `native_overlay` remains present and read-only.
- `warnings` remains an array.
- `truncated` remains present.

New fields are additive. No admin UI code changed in G39F.

## 7. Production-specific safety rules

G39F preserves these rules:

- Inventory deduction remains held.
- PurchaseOrder automation remains held.
- Notifications remain held.
- Hub fallback remains active.
- Subscriptions remain Hub source of truth when native production planning evidence is absent.
- Late/historical mirror rows are not live production command candidates.
- Missing `ProductionBatch` does not automatically produce command readiness.
- Missing master data is surfaced as blocker/warning context, not as an automatic write recommendation.
- Production lifecycle commands still require exact active paid/captured one-time order evidence and separate write approvals.

## 8. Test coverage

Added fixture harness:

- `scripts/migration/run-g39f-admin-production-planning-native-first-tests.mjs`

The harness runs locally with fake Base44 entity adapters and fake Hub responses. It does not call live Base44, Hub, Stripe, Shopify, providers, or notification systems.

Covered cases:

1. Native production planning data present -> native data is primary.
2. `writes_performed:false`.
3. `provider_call_impact:false`.
4. `notifications_sent:false`.
5. `hub_mutation_performed:false`.
6. `inventory_deduction_ready:false`.
7. `purchase_order_ready:false`.
8. Hub rows absent -> native summary still returned.
9. Native data missing and Hub data present -> Hub fallback used.
10. Native data incomplete and Hub data present -> native summary returned with Hub fallback context.
11. Duplicate native/Hub same product/date -> native primary and Hub duplicate suppressed.
12. Historical/late mirror row is not a live production candidate.
13. Subscription/multi-delivery context remains Hub source-of-truth when native planning evidence is absent.
14. Missing native master data returns warning/blocker context, not a write recommendation.
15. Missing `ProductionBatch` returns preview-only status, not an auto-command recommendation.
16. No rows -> empty safe response.
17. Existing response shape remains backward-compatible.
18. No customer email/phone returned.
19. No raw Hub/provider/payment payload returned.
20. No logs/queues created.

## 9. No-write policy

G39F is read-only. It does not:

- mutate Customer App records
- mutate native `ShopifyOrder`
- mutate native `FulfillmentTask`
- mutate `ProductionBatch`
- mutate `BatchComplianceLog`
- mutate Hub records
- create or update Recipe/Bundle/Product/InventoryItem/IngredientYield records
- create OrderSyncLog, CommandLog, OrderReviewQueue, Notification, CustomerMessageDeliveryLog, or PurchaseOrder rows
- call Stripe
- call Shopify
- call providers
- send notifications
- run sync/repair/replay
- deduct inventory
- create PurchaseOrders

## 10. Rollback plan

Rollback is code-only:

1. Revert the `getAdminProductionPlanningSummary` native-first patch.
2. Keep Hub fallback active.
3. No data repair should be needed because the patch is read-only.
4. Re-run the G39F harness and G39B parity harness before retrying.
5. Smoke `/admin/production-planning` after any deployment or rollback.

## 11. Next phase recommendation

After G39F is merged, published, boundary-verified, and live-smoked:

- classify as `production_planning_native_first_patch_live` if the admin page remains healthy and no-write verification is clean
- proceed to the next low-risk admin read surface, likely `getAdminCalendarEventsSummary`
- or hold if production planning smoke exposes a row contract or fallback reporting gap
