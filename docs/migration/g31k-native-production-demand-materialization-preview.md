# G31K Native Production Demand Materialization Preview

## Purpose

G31K adds a read-only preview that answers:

> Given a paid native Customer App order and native non-stock production master data, what native `ProductionBatch` demand plan would the Customer App create if materialization were later approved?

This phase does not approve native production batch creation. Hub fallback remains active.

## Function

`previewNativeProductionDemandMaterialization`

Inputs:

- `order_number`
- optional `customer_app_order_id`
- optional `native_shopify_order_id`
- optional `native_fulfillment_task_id`
- optional `request_id`

Auth:

- admin user, or
- internal preview secret

Output includes:

- `dry_run: true`
- `writes_performed: false`
- product demand rows
- bundle decomposition rows
- recipe match rows
- ingredient need rows
- proposed native `ProductionBatch` rows
- proposed order-source rows
- existing native batch/dedupe context
- materialization blockers and warnings
- Hub fallback status

## No-write boundary

G31K does not:

- create or update `ProductionBatch`
- create or update `ManualProductionBatch`
- update Customer App `Order`
- update native `ShopifyOrder`
- update native `FulfillmentTask`
- update `Recipe`, `Bundle`, `InventoryItem`, or `IngredientYield`
- deduct inventory
- create `PurchaseOrder`
- create compliance logs
- call Stripe, Shopify, providers, or notification services
- run sync, retry, repair, or replay
- disable Hub fallback

## Materialization readiness semantics

`materialization_ready` can be true when:

- the order is paid/captured
- native order and required native task context exist
- production date exists
- line items exist
- product demand can be calculated
- bundle decomposition is resolved
- recipes are matched
- proposed batch rows can be generated
- there is no conflicting native batch

The preview does not block materialization readiness for make-to-order procurement details that are intentionally deferred:

- current stock of zero
- procurement needed
- missing Black Salt / Beetroot detailed yield conversion
- unsupported stock unit warnings for Sea Salt / Black Pepper
- inventory deduction not ready
- purchase conversion not ready

Those remain warnings and keep inventory deduction / PO automation held.

## Target order expectation

For `NV-MPZNKGNT`, after G31J and the G31G/G31I non-stock master-data imports:

- `production_ready: true`
- `materialization_ready: true` if no conflicting native batch exists
- proposed `ProductionBatch` rows are generated
- product demand rows are generated
- ingredient need rows are generated
- `procurement_needed: true`
- `procurement_conversion_ready: false`
- `inventory_deduction_ready: false`
- deferred yield/stock-unit warnings remain visible
- `writes_performed: false`
