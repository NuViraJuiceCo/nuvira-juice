# G31F — Non-stock production master-data mirror/import preview

## Purpose

G31F adds a read-only Customer App import packet preview for the native production master-data path.

It takes the G31E policy result and shows the exact schema-safe Customer App rows that could be approved later for a gated non-stock master-data import.

## Approved owner policy

- Inventory seed policy: `NON_STOCK_MASTER_DATA_ONLY`
- Yield policy: `DEFER_DETAILED_PURCHASE_CONVERSION_VALUES`
- Approved alias: `The NuVira Trio -> NuVira Trio`
- Hub Bundle id: `69e8f55b06e17fbd88dbbc0c`

## Behavior

The preview may mark native production master-data import readiness as ready when:

- Hub recipes and bundles are mirrorable.
- The approved Trio alias can supply bundle components.
- Hub InventoryItem master records exist.
- Inventory stock is seeded or kept as `0`.
- Missing yield purchase-conversion values are deferred instead of guessed.

The preview does not treat current stock `0` as fatal for make-to-order production demand visibility.

## Preview packet

The preview returns a nested `customer_app_non_stock_master_data_import_preview` object with:

- `import_ready`
- `create_rows`
- `deferred_rows`
- `blocked_rows`
- `create_rows_by_entity`
- `inventory_seed_policy`
- `yield_policy`
- `procurement_conversion_ready`
- `inventory_deduction_ready`
- `purchase_order_automation_ready`
- `required_approval_phrase_template`

Create rows are schema-safe `create_if_missing` previews for:

- `Recipe`
- `Bundle`
- `InventoryItem`
- `IngredientYield` only where exact Hub yield values already exist

Deferred yield rows are not created and remain pending for purchase conversion.

## Hard stops

G31F does not:

- create Recipe records
- create Bundle records
- create InventoryItem records
- create IngredientYield records
- import or mirror master data
- update Hub records
- create ProductionBatch
- deduct inventory
- create PurchaseOrder
- call Stripe, Shopify, or providers
- send notifications
- run sync, repair, or replay
- disable Hub fallback

## Current NV-MPZNKGNT expectation

For `NV-MPZNKGNT`, after G31E policy clarification, the expected preview classification is:

- production master data ready: yes
- non-stock master data seed ready: yes
- non-stock import preview ready: yes
- procurement conversion ready: no
- inventory deduction ready: no
- pending yield details: Black Salt, Beetroot
- Hub fallback required until a later approved import is executed and validated

## Next phase

If G31F preview is clean, the next phase should be a separate exact live approval:

`APPROVE G31G CUSTOMER APP NON STOCK MASTER DATA IMPORT NV-MPZNKGNT`

That approval should still require:

- exact import packet snapshot
- exact create counts by entity
- idempotency key
- before/after Customer App master-data counts
- no production/inventory/order/task/provider side effects
