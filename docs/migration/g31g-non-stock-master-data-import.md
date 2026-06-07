# G31G — Exact Customer App non-stock master-data import

G31G adds a gated live import command for the exact `NV-MPZNKGNT` non-stock production master-data seed packet approved after G31F.

## Scope

The command is exact-order and exact-packet only. It imports only the G31F-approved Customer App master-data rows:

- 1 `Bundle`
- 3 `Recipe` records
- 6 `InventoryItem` records
- 4 `IngredientYield` records with exact Hub yield values already available

It explicitly defers:

- Black Salt `IngredientYield`
- Beetroot `IngredientYield`

## Policies enforced

- `NON_STOCK_MASTER_DATA_ONLY`
- `DEFER_DETAILED_PURCHASE_CONVERSION_VALUES`
- Inventory `stock` must seed as `0`
- Hub live stock is not mirrored as authoritative
- Approved alias: `The NuVira Trio -> NuVira Trio`

## Gates

Default state is disabled. Live import requires:

- `ENABLE_NATIVE_PRODUCTION_MASTER_DATA_IMPORT=true`
- `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_KILL_SWITCH=false`
- `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ALLOWED_EMAILS` containing the admin actor email
- `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ORDER_ALLOWLIST` containing the exact order/id target
- `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY=NON_STOCK_MASTER_DATA_ONLY`
- live mode, request id, confirmation, and owner approval phrase

## Safety boundary

The command does not:

- create `ProductionBatch`
- deduct inventory
- create `PurchaseOrder`
- update Customer App Order
- update native ShopifyOrder
- update native FulfillmentTask
- update Hub records
- call Stripe, Shopify, or providers
- send notifications
- run sync, retry, repair, or replay
- disable Hub bridge

## Idempotency

The command writes one `CommandLog` for a successful request id. Repeating the same request id returns an idempotent skip and does not create duplicate master data or duplicate success logs.

## Post-import expected state

After the exact import, production master data should be visible natively for the target order. Procurement conversion and inventory deduction remain held until yield/stock policy is completed later.
