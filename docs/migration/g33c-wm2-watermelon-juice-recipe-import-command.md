# G33C-WM2 — Watermelon Juice Recipe Import Command

## Purpose

G33C-WM2 adds an exact, default-off import path in the existing deployed master-data command:

`importNativeProductionMasterDataForCustomerApp`

The path is limited to creating exactly one native `Recipe` row for `Watermelon Juice`, using the clean G33C-WM1 read-only preview packet. It is PR-prep only. No live import is approved by this phase.

## Target context

- order_number: `NV-MP5SOQLJ`
- customer_app_order_id: `6a060df457fc07751f3c7ded`
- native_shopify_order_id: `6a2df0026e266e19c68046eb`
- native_fulfillment_task_id: `6a2eb72aa7ff194aafac49d3`
- recipe_name: `Watermelon Juice`
- hub_recipe_id: `69ed8a1fab9a16f8772096ec`

G33C-WM1 proved:

- native `Recipe` for Watermelon Juice is missing
- Hub recipe is present and exact
- native `InventoryItem` for Watermelon is already present
- native `IngredientYield` for Watermelon is already present
- no `Bundle` mapping is needed
- mirror packet is ready
- no deferred or blocked rows exist

## Command contract

Function:

`importNativeProductionMasterDataForCustomerApp`

Exact WM2 import mode:

`import_scope=EXACT_RECIPE_ONLY`

Required confirmation phrase:

`import_watermelon_juice_recipe_non_stock_no_inventory_no_po`

Required policy:

`EXACT_WATERMELON_JUICE_RECIPE_ONLY_NON_STOCK_NO_INVENTORY_NO_PO`

Required request policies:

- `inventory_policy=NON_STOCK_MASTER_DATA_ONLY`
- `inventory_deduction_policy=HELD`
- `purchase_order_policy=HELD`
- `notification_policy=NO_NOTIFICATION`
- `provider_call_policy=NO_PROVIDER_CALLS`
- `hub_mutation_policy=NO_HUB_MUTATION`

## Gates

The command uses the existing native production master-data import gate family:

- `ENABLE_NATIVE_PRODUCTION_MASTER_DATA_IMPORT`
- `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_KILL_SWITCH`
- `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ALLOWED_EMAILS`
- `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ORDER_ALLOWLIST`
- `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY`

G33C-WM2 also adds an exact entity allowlist:

- `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ENTITY_ALLOWLIST`

For a future live run, the entity allowlist must include only the exact approved Watermelon Juice recipe context, such as:

- `recipe:Watermelon Juice`
- `69ed8a1fab9a16f8772096ec`

Do not broaden these gates.

## Fresh preview requirement

Before any future write, the command invokes `previewNativeProductionMasterDataParity` through the Base44 service-role function invocation path. It does not self-fetch over public HTTP.

G33C-WM2-PATCH1 aligns the command preflight with the clean full-order G33C-WM1 preview path. The earlier exact Watermelon-only `line_items` preview shape could return `hub_master_data_http_404` for the single-name Hub lookup even though the full-order WM1 preview found the exact Hub Recipe `69ed8a1fab9a16f8772096ec`.

For this command, the full-order preview is the canonical preflight evidence. The command filters that packet down to the exact Watermelon Juice `Recipe` create row and rejects any extra create, deferred, blocked, or unsafe rows. The exact Watermelon-only preview path remains non-authoritative for WM2 unless it is separately patched and verified.

G33C-WM3-PATCH2 keeps the Recipe-only path aligned with that canonical evidence for procurement conversion. The broader nested import preview can report `procurement_conversion_ready:false` because inventory deduction and PurchaseOrder automation are intentionally held. That nested value must not block this exact Recipe-only import when the canonical packet proves Watermelon dependencies are already native: Watermelon `InventoryItem` present, Watermelon `IngredientYield` present, zero dependency create rows, zero deferred rows, zero blocked rows, inventory deduction held, and PurchaseOrder automation held.

PATCH2 does not change broad G31G/G31I master-data import behavior and does not approve live import. It only changes the exact Watermelon Juice Recipe validation path so stale nested procurement conversion state cannot override clean exact dependency evidence.

The fresh preview must satisfy all of the following:

- `success:true`
- full-order `NV-MP5SOQLJ` packet includes `Watermelon Juice`
- order and native ids match the approved target
- native Watermelon Juice Recipe missing
- Hub Watermelon Juice Recipe present
- Hub recipe id matches `69ed8a1fab9a16f8772096ec`
- `non_stock_import_preview_ready:true`
- `seed_packet_ready:true`
- create rows exactly one `Recipe`
- the single `Recipe` create row is exactly `Watermelon Juice`
- create rows zero `InventoryItem`
- create rows zero `IngredientYield`
- create rows zero `Bundle`
- Watermelon `InventoryItem` already native / present
- Watermelon `IngredientYield` already native / present
- deferred rows zero
- blocked rows zero
- schema packet blockers zero
- `inventory_policy=NON_STOCK_MASTER_DATA_ONLY`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- provider calls disabled
- notifications held
- Hub mutation disabled

If any condition fails, the command fails closed with `writes_performed:false`.

## Recipe-only write scope

Allowed future writes, only after separate explicit live approval:

1. One native `Recipe` row for Watermelon Juice.
2. One safe `CommandLog`.

Expected schema-safe Recipe fields:

- `product_name: Watermelon Juice`
- `bottle_size_oz: 32`
- `yield_factor: 1.05`
- `ingredients: [{ ingredient_name: Watermelon, quantity_oz: 32, unit: oz }]`
- `is_active: true`

## Explicitly forbidden writes

The WM2 path does not create or update:

- `InventoryItem`
- `IngredientYield`
- `Bundle`
- Customer App `Order`
- native `ShopifyOrder`
- native `FulfillmentTask`
- `ProductionBatch`
- `BatchComplianceLog`
- `OrderSyncLog`
- `OrderReviewQueue`
- `Notification`
- `CustomerMessageDeliveryLog`
- `PurchaseOrder`
- Hub records

It also does not perform:

- inventory deduction
- PO automation
- provider calls
- Stripe calls
- Shopify calls
- notifications
- sync / repair / replay

## Idempotency

- `request_id` is required.
- A matching successful `CommandLog` idempotency key returns skipped/idempotent success.
- A pre-existing Watermelon Juice Recipe blocks duplicate creation unless it is already represented by the idempotent success path.
- Failed prior logs are not treated as success.

## Safety notes

The command response and CommandLog store safe operational metadata only. They must not store raw Hub payloads, provider payloads, customer PII, secrets, auth values, inventory stock authoritativeness, or PO values.

Hub remains active. Inventory deduction and PurchaseOrder automation remain held.

## Future live execution

G33C-WM2 does not approve or run the live import.

A future G33C-WM3 approval must explicitly authorize the exact live Watermelon Juice Recipe import, with gates opened only for this target and shut down immediately afterward.
