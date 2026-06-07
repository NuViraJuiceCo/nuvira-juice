# G31A Native Production / Inventory Readiness Preview

## Purpose

G31A adds a read-only Customer App preview for the native production and inventory readiness path. It answers whether an exact paid native order can be translated into:

- production demand rows
- bundle decomposition rows
- recipe match rows
- ingredient need rows
- procurement-needed context

without relying entirely on Hub production planning and without writing any production, inventory, procurement, order, or fulfillment records.

## Scope

Function added:

- `previewNativeProductionInventoryReadiness`

Admin visibility added:

- `/admin/sync-health` now includes a **Native Production / Inventory Readiness** panel for the exact order number entered in the Native Cutover Readiness Gate.

## Safety contract

This phase is preview-only.

The function and UI do not:

- create or update `ProductionBatch`
- update `FulfillmentTask`
- update `ShopifyOrder`
- update Customer App `Order`
- write ingredient usage
- deduct inventory
- create `PurchaseOrder`
- create compliance logs
- call Stripe
- call Shopify
- call providers
- send notifications
- run sync, retry, repair, or replay
- enable the native safeSync writer
- disable Hub bridge fallback
- add live action buttons

The preview response includes `dry_run: true` and `writes_performed: false`.

## Inputs

`POST` only:

```json
{
  "mode": "dry_run",
  "order_number": "NV-MPZNKGNT",
  "customer_app_order_id": "optional",
  "native_shopify_order_id": "optional",
  "native_fulfillment_task_id": "optional",
  "request_id": "optional"
}
```

At least one exact lookup key is required: order number, Customer App order id, native ShopifyOrder id, or native FulfillmentTask id.

Authentication is admin auth or the existing internal preview secret path.

## Reads

The preview reads Customer App native records and master data only:

- `Order`
- `ShopifyOrder`
- `FulfillmentTask`
- `Recipe`
- `Bundle`
- `Product`
- `InventoryItem`
- `IngredientYield`
- `ProductionBatch` only for bounded context comparison

No Hub function call is performed by this preview.

## Readiness semantics

Blockers include:

- order not found
- unpaid or uncaptured payment
- missing line items
- missing native ShopifyOrder
- missing native FulfillmentTask
- unsupported subscription, multi-delivery, POS, or event order shape
- unknown product mapping
- missing or ambiguous bundle mapping
- missing or ambiguous recipe
- missing or ambiguous InventoryItem
- missing or invalid IngredientYield
- unsupported inventory unit conversion

Warnings include:

- Hub fallback required
- native production batch not created
- inventory deduction held
- purchase order automation held
- existing native production batch missing
- inventory shortfall / procurement needed

Current stock shortfall is procurement context, not automatically a production-demand blocker. In that case production demand can be ready while inventory deduction remains held and procurement is flagged.

## Output highlights

The response includes sanitized operational metadata only:

- `success`
- `dry_run`
- `writes_performed`
- `order_number`
- `customer_app_order_present`
- `native_shopify_order_present`
- `native_fulfillment_task_present`
- `line_item_count`
- `production_demand_rows`
- `bundle_decomposition_rows`
- `recipe_match_rows`
- `ingredient_need_rows`
- `procurement_needed`
- `procurement_needed_count`
- `missing_recipe_items`
- `missing_bundle_items`
- `missing_inventory_items`
- `missing_yield_items`
- `inventory_shortfall_items`
- `production_ready`
- `inventory_calculation_ready`
- `inventory_deduction_ready`
- `hub_fallback_required`
- `blockers`
- `warnings`

The response does not return raw order/task objects, raw provider payloads, payment provider IDs, auth headers, secrets, stack traces, full addresses, or phone numbers.

## Hub-retirement impact

G31A moves the production/inventory subsystem from pure visibility toward read-only parity preview. It does not approve native production batch creation, inventory deduction, or purchase order creation. Hub bridge remains fallback until materialization and lifecycle write paths are separately validated and approved.
