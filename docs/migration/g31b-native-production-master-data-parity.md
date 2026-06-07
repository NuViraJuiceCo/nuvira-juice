# G31B Native Production Master-Data Parity Preview

## Purpose

G31B adds a read-only parity preview for the production master data needed before native Customer App production/procurement can replace Hub-backed operational context.

It compares Customer App native records against Hub master data for:

- `Recipe`
- `Bundle`
- `InventoryItem`
- `IngredientYield`

The goal is to identify exactly which records must be mirrored/seeded before native production demand and ingredient/procurement previews can become useful.

## Scope

Customer App function:

- `previewNativeProductionMasterDataParity`

Hub companion read endpoint:

- `getProductionMasterDataParityForCustomerApp`

Admin UI:

- `/admin/sync-health` includes a **Native Production Master Data Parity** panel under the G31A production/inventory readiness preview.

## Safety contract

G31B is read-only.

It does not:

- create `Recipe` records
- create `Bundle` records
- create `InventoryItem` records
- create `IngredientYield` records
- update any master data
- create or update `ProductionBatch`
- update Customer App `Order`
- update native `ShopifyOrder`
- update native `FulfillmentTask`
- deduct inventory
- create `PurchaseOrder`
- call Stripe
- call Shopify
- call external providers
- send notifications
- run sync, retry, repair, or replay
- enable native safeSync writer
- disable Hub bridge fallback
- add live write buttons

Both functions return `dry_run: true` / `writes_performed: false` style safety metadata.

## Schema audit summary

Customer App and Hub both define compatible schemas for:

- `Recipe.product_name`, `product_sku`, `bottle_size_oz`, `yield_factor`, `ingredients[]`, `notes`, `is_active`
- `Bundle.bundle_name`, `components[]`, `fulfillment_count`, active/notes fields
- `InventoryItem.ingredient`, `unit`, `stock`, `reorder_point`, supplier/category/packaging fields
- `IngredientYield.ingredient_name`, `purchase_unit`, `oz_per_purchase_unit`, yield/rounding/supplier fields

Hub `Product` differs from Customer App `Product`:

- Hub Product uses `name` / `sku`.
- Customer App Product uses `title` / product catalog fields.

Therefore Product is treated as contextual and not a blocker for this master-data parity preview.

## InventoryItem policy

`InventoryItem` has two meanings:

1. Operational master data: ingredient name, unit, category, supplier, reorder fields.
2. Live stock state: current `stock` quantity.

G31B exposes Hub stock as admin-only context but marks inventory rows with:

- `inventory_stock_is_live_state_seed_decision_required`

A future mirror/import phase must explicitly decide whether to seed stock from Hub, seed stock at zero, or hold stock seeding for a separate inventory migration.

## Current target

For `NV-MPZNKGNT`, G31A identified native blockers for:

- `Pineapple Juice`
- `The NuVira Trio`
- `Reset Shot`
- `Radiance Shot`

G31B uses the exact order line items, compares native master data counts to Hub counts, and returns required rows across recipes, bundles, inventory items, and ingredient yields.

## Recommended next actions

The preview classifies the next action as one of:

- `ready_for_master_data_mirror`
- `schema_gap_blocks_mirror`
- `hub_master_data_missing`
- `ambiguous_hub_match`
- `manual_mapping_required`
- `customer_app_schema_missing`
- `hold`

A `ready_for_master_data_mirror` result means the next phase can propose a gated, exact-scope master-data seed/mirror preview and then a separately approved live seed. It does not approve a live seed by itself.
