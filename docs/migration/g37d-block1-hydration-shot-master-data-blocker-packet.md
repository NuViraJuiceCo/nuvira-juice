# G37D-BLOCK1: Hydration Shot Production Master-Data Blocker Packet

## 1. Executive summary

G37D-BLOCK1 is a focused read-only blocker packet for the `Hydration Shot` production master-data gap blocking exact production materialization for order `NV-MQHJR3V2`.

This phase did not import master data, create production batches, update orders/tasks, mutate Hub records, call providers, send notifications, deduct inventory, create PurchaseOrders, open gates, run sync/retry/repair/replay, or create logs/queues.

Result: **plan an exact Hydration Shot non-stock master-data import command/patch before G37E materialization**.

The fresh Hydration Shot preview shows a safe non-stock packet is available:

- 1 missing `Recipe`: `Hydration Shot`
- 4 missing non-stock `InventoryItem` rows: `Lime Juice`, `Honey`, `Mint`, `Pink Salt`
- 5 deferred `IngredientYield` rows: `Beetroot`, `Lime Juice`, `Honey`, `Mint`, `Pink Salt`
- 0 preview blockers in the master-data packet
- inventory deduction remains held
- PurchaseOrder automation remains held
- stock remains non-authoritative

However, the current live import command is not a generic exact Hydration Shot import command. Source audit shows `importNativeProductionMasterDataForCustomerApp` currently has exact contracts for the older G31I component packet and the G33C Watermelon recipe-only path. It does not currently have an exact `Hydration Shot` contract for `NV-MQHJR3V2`.

Therefore, the next safe movement is not G37E materialization. The next safe movement is a narrowly scoped master-data import PR prep that adds an exact Hydration Shot non-stock contract, or an equivalent exact command path, then separately approves and runs that import after review.

## 2. Target order context

| Field | Value |
| --- | --- |
| Order number | `NV-MQHJR3V2` |
| Customer App Order | `6a321cbfd8d78863f15de956` |
| Native ShopifyOrder | `6a321d38a3819cdd5cf89031` |
| Native FulfillmentTask | `6a321d38071327f8218b958b` |
| Production date | `2026-06-19` |
| Delivery date | `2026-06-20` |
| Primary blocked product/recipe | `Hydration Shot` |

G37C classified this order as `eligible_next_one_time_order_candidate`, but G37D blocked materialization because production master data is incomplete.

## 3. Current G37D blocker stack

Carry-forward G37D state:

- master-data parity preview found blockers/deferred gaps for the production stack
- inventory/readiness preview:
  - `production_ready:false`
  - `inventory_calculation_ready:true`
  - `inventory_deduction_ready:false`
  - `purchase_order_ready:false`
- procurement visibility:
  - `procurement_visibility_ready:false`
  - `stock_authoritative:false`
- demand materialization:
  - `materialization_ready:false`
  - proposed ProductionBatch rows: `0`
- lifecycle preview held because no native ProductionBatch exists
- post-verify cascade held

Hard decision remains: **do not approve G37E materialization yet**.

## 4. Read-only preview requests

All previews were invoked in dry-run/read-only mode.

| Preview | Request id | Result |
| --- | --- | --- |
| Hydration Shot master-data preview | `g37d_block1_hydration_shot_master_data_preview_nvmqhjr3v2_20260617T124740Z` | packet available; no master-data packet blockers |
| Hydration Shot inventory readiness preview | `g37d_block1_hydration_shot_inventory_readiness_nvmqhjr3v2_20260617T124740Z` | still blocked by missing recipe |
| Hydration Shot procurement visibility preview | `g37d_block1_hydration_shot_procurement_visibility_nvmqhjr3v2_20260617T124740Z` | still blocked by missing recipe and stock policy holds |
| Hydration Shot demand materialization preview | `g37d_block1_hydration_shot_demand_materialization_nvmqhjr3v2_20260617T124740Z` | still not materialization-ready |

Preview safety:

- `dry_run:true`
- `writes_performed:false`
- no provider call required
- no notification required
- no Hub mutation required
- inventory deduction held
- PurchaseOrder automation held

## 5. Hydration Shot native/Hub master-data findings

### Recipe status

| Field | Finding |
| --- | --- |
| Native Hydration Shot Recipe present | no |
| Hub Hydration Shot Recipe present | yes |
| Safe Hub Recipe id | `69ed63d35c89c5d5ffa37e0e` |
| Proposed action | mirror Hub recipe into native `Recipe` |
| Blockers | none in the master-data packet preview |
| Classification | `mirrorable_now_exact_recipe_only` and `production_visibility_blocker` |

Safe recipe preview details:

- product name: `Hydration Shot`
- bottle size: `2.32 oz`
- recipe yield factor: `1.05`
- ingredient count: `5`
- active: `true`

Safe ingredient list from the preview:

| Ingredient | Quantity | Unit | Native dependency status |
| --- | ---: | --- | --- |
| `Coconut Water` | 1.69 | `oz` | already represented in native context |
| `Lime Juice` | 0.34 | `oz` | missing native non-stock InventoryItem; IngredientYield deferred |
| `Honey` | 0.15 | `oz` | missing native non-stock InventoryItem; IngredientYield deferred |
| `Mint` | 0 | `leaves` | missing native non-stock InventoryItem; IngredientYield deferred |
| `Pink Salt` | 0 | `pinch` | missing native non-stock InventoryItem; IngredientYield deferred |

`delivered_at`, customer PII, provider payloads, and raw Hub payloads are not part of this packet.

### Bundle status

No Bundle import is required for the Hydration Shot blocker packet.

Bundle mapping relevance: `false` for the exact Hydration Shot line item.

## 6. Missing non-stock rows

The preview identified four missing native non-stock `InventoryItem` rows that are mirror-ready under `NON_STOCK_MASTER_DATA_ONLY` policy.

| Row | Native status | Hub status | Proposed action | Blocks materialization | Blocks procurement visibility | Blocks inventory deduction | Blocks PO automation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Lime Juice` | missing | matched | create non-stock InventoryItem with zero stock seed | no direct downstream blocker yet; needed for complete master-data packet | yes, visibility warning | yes | yes |
| `Honey` | missing | matched | create non-stock InventoryItem with zero stock seed | no direct downstream blocker yet; needed for complete master-data packet | yes, visibility warning | yes | yes |
| `Mint` | missing | matched | create non-stock InventoryItem with zero stock seed | no direct downstream blocker yet; needed for complete master-data packet | yes, visibility warning | yes | yes |
| `Pink Salt` | missing | matched | create non-stock InventoryItem with zero stock seed | no direct downstream blocker yet; needed for complete master-data packet | yes, visibility warning | yes | yes |

Policy for all four rows:

- inventory policy: `NON_STOCK_MASTER_DATA_ONLY`
- stock authoritative: `false`
- stock seed quantity: `0`
- inventory deduction ready: `false`
- PurchaseOrder ready: `false`

Classification for these rows: `mirrorable_now_non_stock_inventory_item` and `procurement_visibility_warning`.

## 7. Yield and procurement holds

The preview deferred detailed purchase conversion values for five `IngredientYield` rows.

| Row | Status | Classification | Blocks materialization | Blocks procurement visibility | Blocks inventory deduction | Blocks PO automation | Safe next action |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Beetroot` | already native inventory, yield deferred | `owner_input_required` for yield/procurement; `blocked_for_inventory_deduction_only` | no direct Hydration Shot materialization blocker | yes | yes | yes | keep held until owner supplies yield/procurement values |
| `Lime Juice` | yield deferred | `owner_input_required` | no direct materialization blocker under non-stock policy | yes | yes | yes | defer detailed purchase conversion values |
| `Honey` | yield deferred | `owner_input_required` | no direct materialization blocker under non-stock policy | yes | yes | yes | defer detailed purchase conversion values |
| `Mint` | yield deferred | `owner_input_required` | no direct materialization blocker under non-stock policy | yes | yes | yes | defer detailed purchase conversion values |
| `Pink Salt` | yield deferred | `owner_input_required` | no direct materialization blocker under non-stock policy | yes | yes | yes | defer detailed purchase conversion values |

Master-data preview policy:

- `yield_policy:DEFER_DETAILED_PURCHASE_CONVERSION_VALUES`
- `procurement_conversion_ready:false`
- `yield_details_pending:true`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`

These yield rows must not be guessed. They should not be imported with made-up conversion values.

## 8. Downstream preview findings

### Inventory/readiness preview

Request id: `g37d_block1_hydration_shot_inventory_readiness_nvmqhjr3v2_20260617T124740Z`

Safe result:

- success: `true`
- dry_run: `true`
- writes_performed: `false`
- production_date: `2026-06-19`
- `production_ready:false`
- `inventory_calculation_ready:true`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- blockers:
  - `missing_recipe:Hydration Shot`
- warnings:
  - `inventory_shortfall:Beetroot`
  - `yield_details_pending:Beetroot`
  - `procurement_conversion_pending:Beetroot`
  - `inventory_shortfall:Red Apple`
  - `inventory_shortfall:Lemon`
  - `inventory_shortfall_procurement_needed`
  - `hub_fallback_required`
  - `inventory_deduction_held`
  - `purchase_order_automation_held`
  - `existing_native_production_batch_missing`

Interpretation: the active hard blocker is the missing native `Hydration Shot` recipe. Inventory and procurement remain held for visibility/stock/PO policy reasons.

### Procurement visibility preview

Request id: `g37d_block1_hydration_shot_procurement_visibility_nvmqhjr3v2_20260617T124740Z`

Safe result:

- success: `true`
- dry_run: `true`
- writes_performed: `false`
- preview_mode: `NATIVE_PROCUREMENT_VISIBILITY`
- production_date: `2026-06-19`
- `production_ready:false`
- `inventory_calculation_ready:true`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- `procurement_visibility_ready:false`
- `stock_authoritative:false`
- `ingredient_need_count:3`
- blockers:
  - `missing_recipe:Hydration Shot`
- next action: `resolve_procurement_visibility_blockers_before_manual_procurement_use`

Interpretation: procurement visibility remains non-authoritative and held. This does not approve inventory deduction or PO automation.

### Demand materialization preview

Request id: `g37d_block1_hydration_shot_demand_materialization_nvmqhjr3v2_20260617T124740Z`

Safe result:

- success: `true`
- dry_run: `true`
- writes_performed: `false`
- production_date: `2026-06-19`
- `production_ready:false`
- `materialization_ready:false`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- proposed ProductionBatch rows: `0`
- existing native batch matches: `0`
- blockers:
  - `production_demand_not_ready`
  - `missing_recipe:Hydration Shot`
- next action: `hold_materialization_blockers`

Interpretation: G37E remains blocked.

## 9. Proposed minimal unblock packet

The smallest safe packet depends on the exact command path available.

### Required to clear the current downstream hard blocker

The downstream hard blocker is:

- `missing_recipe:Hydration Shot`

Minimum logical unblock:

- create exactly one native `Recipe` row for `Hydration Shot` from the matched Hub recipe packet
- no InventoryItem creation if a recipe-only command path is explicitly approved and downstream previews confirm readiness after recipe import
- no IngredientYield creation
- no inventory deduction
- no PurchaseOrder automation
- no ProductionBatch creation

### Recommended operational packet

Because the preview already shows the Hydration Shot recipe depends on missing non-stock ingredients, the safer operational master-data packet is:

- create exactly one native `Recipe` row: `Hydration Shot`
- create exactly four native non-stock `InventoryItem` rows seeded with zero stock:
  - `Lime Juice`
  - `Honey`
  - `Mint`
  - `Pink Salt`
- defer all `IngredientYield` rows:
  - `Beetroot`
  - `Lime Juice`
  - `Honey`
  - `Mint`
  - `Pink Salt`
- no Bundle rows
- no inventory deduction
- no PurchaseOrder automation
- no provider calls
- no notifications
- no Hub mutation

This packet aligns with `NON_STOCK_MASTER_DATA_ONLY` and avoids pretending stock/yield values are authoritative.

### Current command gap

A source audit found that `importNativeProductionMasterDataForCustomerApp` currently supports:

- the G31I component packet for fixed target `NV-MPZNKGNT`
- the G33C Watermelon recipe-only exact path for fixed target `NV-MP5SOQLJ`

It does not currently expose an exact `Hydration Shot` import contract for `NV-MQHJR3V2`.

Therefore, the next safe phase should be a runtime PR prep for an exact Hydration Shot import command/contract, not a live import.

## 10. Blocker classification

| Blocker | Classification | Blocks materialization | Safe next action |
| --- | --- | --- | --- |
| Missing native `Hydration Shot` Recipe | `mirrorable_now_exact_recipe_only`; `production_visibility_blocker` | yes | add/approve exact Hydration Shot recipe import command path |
| Missing `Lime Juice` InventoryItem | `mirrorable_now_non_stock_inventory_item`; `procurement_visibility_warning` | not current hard blocker, but part of complete master-data packet | include as non-stock zero-stock row if exact packet imports dependencies |
| Missing `Honey` InventoryItem | `mirrorable_now_non_stock_inventory_item`; `procurement_visibility_warning` | not current hard blocker, but part of complete master-data packet | include as non-stock zero-stock row if exact packet imports dependencies |
| Missing `Mint` InventoryItem | `mirrorable_now_non_stock_inventory_item`; `procurement_visibility_warning` | not current hard blocker, but part of complete master-data packet | include as non-stock zero-stock row if exact packet imports dependencies |
| Missing `Pink Salt` InventoryItem | `mirrorable_now_non_stock_inventory_item`; `procurement_visibility_warning` | not current hard blocker, but part of complete master-data packet | include as non-stock zero-stock row if exact packet imports dependencies |
| `Beetroot` yield/procurement values | `owner_input_required`; `blocked_for_inventory_deduction_only`; `blocked_for_purchase_order_only` | no direct Hydration Shot materialization blocker | keep held until owner provides actual yield/procurement values |
| Missing yield values for Hydration ingredients | `owner_input_required`; `blocked_for_inventory_deduction_only`; `blocked_for_purchase_order_only` | no direct materialization blocker under current non-stock policy | keep held; do not guess conversion values |

## 11. Owner inputs required

No owner yield/procurement input is required to create the exact non-stock Recipe/InventoryItem visibility packet if the command is patched to support it.

Owner input is required before any future inventory deduction or PO automation:

- purchase unit
- ounces per purchase unit
- trim/waste factor
- units per case
- split-case policy if relevant
- rounding rule
- supplier/procurement conversion details where missing
- stock-authoritative policy decision

Owner approval is required before any live import command:

- exact target order ids
- exact entity list to import
- inventory policy: `NON_STOCK_MASTER_DATA_ONLY`
- yield policy: `DEFER_DETAILED_PURCHASE_CONVERSION_VALUES`
- inventory deduction policy: `HELD`
- purchase order policy: `HELD`
- notification policy: `NO_NOTIFICATION`
- provider call policy: `NO_PROVIDER_CALLS`
- Hub mutation policy: `NO_HUB_MUTATION`

## 12. What remains held

These remain held after G37D-BLOCK1:

- G37E ProductionBatch materialization
- start/complete/verify production lifecycle writes
- BatchComplianceLog creation
- Customer App Order status changes
- native ShopifyOrder updates
- native FulfillmentTask updates
- Hub mutation
- inventory deduction
- PurchaseOrder automation
- notifications/message logs
- provider/Stripe/Shopify calls
- sync/retry/repair/replay
- stock-authoritative inventory policy
- yield/procurement conversion rows without owner input

## 13. Hard stops

Do not proceed with any live import or production lifecycle write if any of these are true:

- exact Hydration Shot import command/contract is not implemented and audited
- fresh preview request id is missing
- preview target ids do not exactly match `NV-MQHJR3V2`
- preview contains unexpected create/update/delete/upsert rows
- IngredientYield values would be guessed
- inventory deduction would run
- PurchaseOrder automation would run
- provider/Stripe/Shopify calls would be required
- Hub mutation would be required
- notifications/message logs would be created
- ProductionBatch materialization is attempted before the master-data blocker is resolved
- downstream materialization preview still returns `materialization_ready:false`

## 14. No-write confirmation

G37D-BLOCK1 did not run any command path. It invoked dry-run previews only.

Confirmed from preview results:

- `writes_performed:false`
- no master-data import performed
- no `Recipe` created or updated
- no `InventoryItem` created or updated
- no `IngredientYield` created or updated
- no `Bundle` created or updated
- no `ProductionBatch` created
- no `BatchComplianceLog` created
- no Customer App Order update
- no native ShopifyOrder update
- no native FulfillmentTask update
- no Hub mutation
- no provider/Stripe/Shopify call
- no notifications/message logs
- no sync/retry/repair/replay
- no inventory deduction
- no PurchaseOrder creation

Request-id no-write verification found `total_matches:0` for:

- `g37d_block1_hydration_shot_master_data_preview_nvmqhjr3v2_20260617T124740Z`
- `g37d_block1_hydration_shot_inventory_readiness_nvmqhjr3v2_20260617T124740Z`
- `g37d_block1_hydration_shot_procurement_visibility_nvmqhjr3v2_20260617T124740Z`
- `g37d_block1_hydration_shot_demand_materialization_nvmqhjr3v2_20260617T124740Z`

Checked entities all returned zero request-id matches: `Recipe`, `Bundle`, `InventoryItem`, `IngredientYield`, `ShopifyOrder`, `Order`, `FulfillmentTask`, `ProductionBatch`, `BatchComplianceLog`, `OrderSyncLog`, `CommandLog`, `OrderReviewQueue`, `Notification`, `CustomerMessageDeliveryLog`, `PurchaseOrder`, `ManualProductionBatch`, `SafeSyncParityLog`, `OperationalAlert`, and `ComplianceAlert`.

## 15. Recommendation

Recommended classification: **exact_master_data_import_pr_prep_required**.

Recommended next phase:

- prepare an exact Hydration Shot non-stock master-data import runtime PR, limited to `NV-MQHJR3V2`
- import scope should be one of:
  - exact recipe-only first, if the team wants the smallest possible materialization unblock, or
  - exact recipe plus four non-stock InventoryItem rows, if the team wants the complete safe visibility packet already proven by preview
- keep all IngredientYield rows deferred unless owner supplies conversion values
- do not run the import in the PR-prep phase
- after merge/publish, run a separate exact live import approval phase
- after import, rerun the full G37D preview stack
- only then consider G37E materialization if `materialization_ready:true`

Do not approve G37E materialization from the current state.
