# G34B: Native procurement visibility preview

## Scope

G34B adds a read-only native procurement visibility preview by extending the existing deployed `previewNativeProductionInventoryReadiness` function with `preview_mode: NATIVE_PROCUREMENT_VISIBILITY`.

This avoids creating another Base44 function while preserving the read-only boundary. It does not deduct inventory, update stock, create or update PurchaseOrders, mutate Recipe/Bundle/IngredientYield/InventoryItem/ProductionBatch/order/task records, call providers/payments, send notifications, run sync/repair/replay, or mutate Hub records.

## Request mode

Use:

```json
{
  "mode": "dry_run",
  "preview_mode": "NATIVE_PROCUREMENT_VISIBILITY",
  "order_number": "NV-MPZNKGNT"
}
```

Supported target inputs:

- `order_number`
- `customer_app_order_id`
- `native_shopify_order_id`
- `native_fulfillment_task_id`
- `production_date`
- `batch_ids`

If no target is supplied, the function returns `procurement_visibility_target_required` with `writes_performed:false`.

## Response contract

The preview returns:

- `success`
- `dry_run:true`
- `writes_performed:false`
- `preview_mode:NATIVE_PROCUREMENT_VISIBILITY`
- `inventory_policy:NON_STOCK_MASTER_DATA_ONLY`
- `stock_authoritative:false`
- `product_demand_count`
- `production_batch_count`
- `ingredient_need_count`
- `procurement_visibility_ready`
- `procurement_visibility_classification`
- `procurement_needed`
- `procurement_needed_count`
- `procurement_conversion_ready:false`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- `ingredient_need_rows`
- `procurement_summary_rows`
- `deferred_yield_rows`
- `deferred_stock_unit_rows`
- `missing_master_data_rows`
- `blockers`
- `warnings`
- `next_action`
- `hub_fallback_required:true`

## Policy behavior

- `stock_authoritative` is always `false` under the current make-to-order policy.
- `inventory_deduction_ready` is always `false` in procurement visibility mode.
- `purchase_order_ready` is always `false` in procurement visibility mode.
- Stock `0` does not block procurement visibility.
- Missing yield details warn but do not block visibility.
- Unsupported/deferred stock-unit conversion warns but does not block visibility.
- Missing recipe, missing bundle mapping, missing InventoryItem, ambiguous mapping, unsupported recipe quantity, missing demand, and invalid target block visibility.

## Admin UI

`/admin/sync-health` now labels the existing production/inventory preview panel as **Native Procurement Visibility Preview** and invokes `previewNativeProductionInventoryReadiness` with `preview_mode: NATIVE_PROCUREMENT_VISIBILITY`.

The panel shows:

- No writes performed
- non-stock inventory policy
- stock not authoritative
- inventory deduction held
- PurchaseOrder automation held
- grouped procurement summary rows
- deferred yield details
- deferred stock-unit conversion
- blockers and warnings

No live write buttons are added.
