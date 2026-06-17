# G37D-BLOCK2: Hydration Shot Master-Data Import Command

## Purpose

G37D-BLOCK2 prepares an exact default-off command path for importing the Hydration Shot production master-data visibility packet needed by order `NV-MQHJR3V2`.

This is PR prep only. It does not run the live import, open gates, publish Base44, create master data, create production batches, mutate order/task records, call providers, send notifications, deduct inventory, create PurchaseOrders, mutate Hub records, or run sync/repair/replay.

The implementation patches the existing deployed command:

- `importNativeProductionMasterDataForCustomerApp`

No new Base44 function is added.

## Target order

| Field | Value |
| --- | --- |
| Order number | `NV-MQHJR3V2` |
| Customer App Order | `6a321cbfd8d78863f15de956` |
| Native ShopifyOrder | `6a321d38a3819cdd5cf89031` |
| Native FulfillmentTask | `6a321d38071327f8218b958b` |
| Production date | `2026-06-19` |
| Delivery date | `2026-06-20` |
| Recipe | `Hydration Shot` |
| Hub Recipe id | `69ed63d35c89c5d5ffa37e0e` |

## G37D-BLOCK1 evidence

G37D-BLOCK1 found:

- native Hydration Shot Recipe: missing
- Hub Hydration Shot Recipe: present
- non-stock packet: ready
- missing non-stock InventoryItem rows:
  - `Lime Juice`
  - `Honey`
  - `Mint`
  - `Pink Salt`
- deferred IngredientYield rows:
  - `Beetroot`
  - `Lime Juice`
  - `Honey`
  - `Mint`
  - `Pink Salt`
- downstream demand materialization remained blocked by `missing_recipe:Hydration Shot`
- `materialization_ready:false`
- proposed ProductionBatch rows: `0`

G37E materialization remains blocked until the master-data import runs under separate approval and the preview stack is rerun cleanly.

## Exact import contract

G37D-BLOCK2 adds an exact mode to `importNativeProductionMasterDataForCustomerApp`.

| Contract field | Value |
| --- | --- |
| `import_scope` | `EXACT_HYDRATION_SHOT_NON_STOCK_VISIBILITY_PACKET` |
| Required policy | `EXACT_HYDRATION_SHOT_NON_STOCK_MASTER_DATA_ONLY_NO_INVENTORY_NO_PO` |
| Required confirmation | `import_hydration_shot_non_stock_master_data_no_inventory_no_po` |
| Command type | `hydration_shot_non_stock_master_data_import` |
| Inventory policy | `NON_STOCK_MASTER_DATA_ONLY` |
| Yield policy | `DEFER_DETAILED_PURCHASE_CONVERSION_VALUES` |
| Command default | disabled until existing gate envs are explicitly configured |

Required exact target:

- order number: `NV-MQHJR3V2`
- customer order id: `6a321cbfd8d78863f15de956`
- native ShopifyOrder id: `6a321d38a3819cdd5cf89031`
- native FulfillmentTask id: `6a321d38071327f8218b958b`
- recipe name: `Hydration Shot`
- Hub Recipe id: `69ed63d35c89c5d5ffa37e0e`

## Gate, policy, and confirmation

G37D-BLOCK2 uses the existing import gate family:

| Gate | Value |
| --- | --- |
| Enable gate | `ENABLE_NATIVE_PRODUCTION_MASTER_DATA_IMPORT` |
| Kill switch | `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_KILL_SWITCH` |
| Actor allowlist | `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ALLOWED_EMAILS` |
| Order allowlist | `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ORDER_ALLOWLIST` |
| Entity allowlist | `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ENTITY_ALLOWLIST` |
| Policy | `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY` |

The Hydration mode requires exact entity allowlist entries for:

- `recipe:Hydration Shot`
- `hub_recipe:69ed63d35c89c5d5ffa37e0e`
- `inventoryitem:Lime Juice`
- `inventoryitem:Honey`
- `inventoryitem:Mint`
- `inventoryitem:Pink Salt`

If any required entity allowlist entry is missing, the command fails closed with `writes_performed:false`.

## Allowed future writes

Only after separate live approval and open exact gates, this mode may write:

| Entity | Allowed future write |
| --- | --- |
| `Recipe` | create exactly one `Hydration Shot` Recipe row if missing |
| `InventoryItem` | create only missing exact non-stock rows for `Lime Juice`, `Honey`, `Mint`, `Pink Salt` |
| `CommandLog` | create/update one safe command log for idempotency/audit |

The command dedupes existing exact Recipe/InventoryItem rows and creates only the missing approved subset. It never creates extra rows.

## Forbidden writes and actions

G37D-BLOCK2 does not allow:

- `IngredientYield` creation/update
- `Bundle` creation/update
- `Product` creation/update
- Customer App Order update
- native ShopifyOrder update
- native FulfillmentTask update
- `ProductionBatch` creation
- `BatchComplianceLog` creation
- `OrderSyncLog` creation
- `OrderReviewQueue` creation
- `Notification` creation
- `CustomerMessageDeliveryLog` creation
- Hub record mutation
- inventory stock deduction
- PurchaseOrder creation
- provider calls
- Stripe calls
- Shopify calls
- notifications
- sync/repair/replay

## Fresh preview dependency

Before any future write, the command invokes `previewNativeProductionMasterDataParity` through the Base44 service-role function invocation path.

The fresh preview must prove:

- exact order/native ids match `NV-MQHJR3V2`
- Hydration Shot line item exists
- native Hydration Shot Recipe is missing
- Hub Hydration Shot Recipe is matched
- Hub Recipe id is `69ed63d35c89c5d5ffa37e0e`
- non-stock import preview is ready
- seed packet is ready
- Recipe create row is exactly `Hydration Shot`
- InventoryItem create rows are exactly `Lime Juice`, `Honey`, `Mint`, `Pink Salt`
- no `IngredientYield` create rows
- no `Bundle` create rows
- no `Product` create rows
- deferred yield rows are exactly `Beetroot`, `Lime Juice`, `Honey`, `Mint`, `Pink Salt`
- inventory policy is `NON_STOCK_MASTER_DATA_ONLY`
- yield policy is `DEFER_DETAILED_PURCHASE_CONVERSION_VALUES`
- inventory deduction remains held
- PurchaseOrder automation remains held
- provider calls are not required
- notifications are held
- Hub mutation is not required

If preview scope is unexpected, the command fails closed before creating a `CommandLog` or master-data row.

## Recipe create contract

The exact Hydration Shot Recipe row may use only schema-safe preview fields:

- `product_name: Hydration Shot`
- nullable/string `product_sku`
- `bottle_size_oz: 2.32`
- `yield_factor: 1.05`
- ingredient list:
  - `Coconut Water`, `1.69 oz`
  - `Lime Juice`, `0.34 oz`
  - `Honey`, `0.15 oz`
  - `Mint`, `0 leaves`
  - `Pink Salt`, `0 pinch`
- `is_active:true`

The command rejects unsupported Recipe fields and raw payload input.

## InventoryItem create contract

The exact non-stock InventoryItem rows are:

- `Lime Juice`
- `Honey`
- `Mint`
- `Pink Salt`

Each row must be a visibility/master-data row only:

- stock seeded as zero
- stock not authoritative for Customer App operations
- no inventory deduction
- no PO automation
- no extra InventoryItem rows

If one approved InventoryItem already exists at live time, the command dedupes it and creates only the remaining approved rows. If all exact rows already exist, the command skips safely with `writes_performed:false`.

## Deferred IngredientYield policy

IngredientYield rows are explicitly deferred:

- `Beetroot`
- `Lime Juice`
- `Honey`
- `Mint`
- `Pink Salt`

Response metadata includes:

- `ingredient_yield_created:false`
- `ingredient_yield_records_created:0`
- `deferred_ingredient_yield_count`
- `deferred_ingredient_yield_names`

No yield/procurement values are guessed. Owner input is still required before inventory deduction or PO automation can be considered.

## Response safety contract

The response includes safe additive fields such as:

- `success`
- `skipped`
- `idempotent`
- `writes_performed`
- `recipe_created`
- `recipe_records_created`
- `inventory_item_records_created`
- `ingredient_yield_created:false`
- `ingredient_yield_records_created:0`
- `bundle_records_created:0`
- `production_batch_created:false`
- `batch_compliance_log_created:false`
- `customer_app_order_updated:false`
- `native_shopify_order_updated:false`
- `native_fulfillment_task_updated:false`
- `notifications_sent:false`
- `provider_calls:false`
- `provider_call_impact:false`
- `stripe_calls:false`
- `shopify_calls:false`
- `hub_records_updated:false`
- `hub_mutation_performed:false`
- `inventory_deducted:false`
- `purchase_orders_created:false`
- `command_log_created`
- `error_code`

The response does not expose customer email, phone, full address, raw Hub payloads, raw provider/payment payloads, Stripe payloads, Shopify payloads, or secrets.

## Idempotency

The command uses request id + `CommandLog` idempotency.

Expected behavior:

- duplicate request id with successful/active `CommandLog` skips
- no duplicate Recipe rows
- no duplicate InventoryItem rows
- existing exact rows are deduped for Hydration mode
- unexpected existing/conflicting rows outside the exact names do not expand scope

## Test coverage

Added harness:

- `scripts/migration/run-g37d-block2-hydration-shot-master-data-import-tests.mjs`

Coverage includes:

- disabled gate blocks
- missing auth blocks
- missing confirmation blocks
- policy mismatch blocks
- missing Recipe entity allowlist blocks
- missing InventoryItem entity allowlist blocks
- fresh preview missing blocks
- Hub recipe id mismatch blocks
- native Recipe existing dedupes safely
- approved four InventoryItem rows only
- one InventoryItem existing dedupes safely
- unexpected extra InventoryItem blocks
- IngredientYield create row blocks
- Bundle create row blocks
- Product create row blocks
- deferred IngredientYield rows reported and not created
- inventory deduction request blocks
- PurchaseOrder request blocks
- notification request blocks
- provider call request blocks
- Hub mutation request blocks
- valid in-memory command creates exactly one Recipe, four InventoryItems, and one CommandLog
- duplicate request id skips
- no order/task/ProductionBatch/BatchComplianceLog writes
- no raw payload/PII in response

Regression harnesses were run for Watermelon import, G31 master-data previews/imports, procurement visibility, G33C one-time task/mirror parity, and G27 cutover readiness.

## Live execution boundary

G37D-BLOCK2 does not run the import.

A future G37D-BLOCK3 live import approval must separately provide:

- exact request id
- exact target ids
- exact gate/policy/env configuration
- exact confirmation phrase
- `inventory_deduction_policy=HELD`
- `purchase_order_policy=HELD`
- `notification_policy=NO_NOTIFICATION`
- `provider_call_policy=NO_PROVIDER_CALLS`
- `hub_mutation_policy=NO_HUB_MUTATION`

Do not open gates or run the command during PR prep.

## Post-import requirements before G37E

After any separately approved import, rerun the full G37D preview stack:

1. master-data parity preview
2. inventory/readiness preview
3. procurement visibility preview
4. demand materialization preview
5. lifecycle preview
6. post-verify cascade preview

Only consider G37E materialization if the fresh demand materialization preview returns:

- `production_ready:true`
- `materialization_ready:true`
- exact proposed ProductionBatch rows
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- no provider/notification/Hub mutation requirement

## Recommendation

Close/merge/publish G37D-BLOCK2 if checks are clean, then run boundary verification only.

Do not run the live import until a separate exact G37D-BLOCK3 approval is provided.

Do not approve G37E materialization until after the import is separately approved, run, and the preview stack confirms materialization readiness.
