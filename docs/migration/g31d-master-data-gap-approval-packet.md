# G31D — Hub master-data correction approval packet

## Scope

G31D is an owner approval packet for closing the native production master-data gaps found by G31C. It is planning/documentation only.

This phase does **not**:

- create or update Hub `Bundle`, `Recipe`, `InventoryItem`, or `IngredientYield` records
- create or update Customer App `Bundle`, `Recipe`, `InventoryItem`, or `IngredientYield` records
- create or update `ProductionBatch`
- update Customer App `Order`, native `ShopifyOrder`, or native `FulfillmentTask`
- deduct inventory
- create `PurchaseOrder`
- call Stripe, Shopify, providers, or notification systems
- run sync, retry, repair, replay, import, or mirror commands
- change customer-facing status
- enable native safeSync writer
- disable Hub bridge fallback
- add import/write buttons

Hub fallback remains required until the approved master-data corrections and a separately approved Customer App master-data mirror/import phase are complete.

## Target order context

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`

## Latest read-only G31C verification

A live read-only `/admin/sync-health` G31C preview was rerun for `NV-MPZNKGNT` during G31D prep.

Result:

- `No Writes Performed`
- required rows: `16`
- mirror-ready rows: `13`
- seed packet: `Not Ready`
- gap next action: `Create Update Hub Master Data First`
- blocked rows: `0`
- manual / alias rows: `1`
- owner-input rows: `2`
- Hub fallback required: yes
- Customer App native counts: `0 recipes`, `0 bundles`, `0 inventory items`, `0 yields`
- Hub master-data counts: `9 recipes`, `7 bundles`, `34 inventory items`, `15 yields`

Confirmed outstanding gaps:

1. `The NuVira Trio` still maps to Hub Bundle alias candidate `NuVira Trio`.
2. `Black Salt` still has a Hub `InventoryItem` match but no Hub `IngredientYield`.
3. `Beetroot` still has a Hub `InventoryItem` match but no Hub `IngredientYield`.
4. Inventory stock seed policy was undecided at the time of G31D prep and is now resolved by the G31E owner clarification below.

## G31E owner clarification update

The owner clarified NuVira's current production/inventory policy:

- NuVira is make-to-order.
- Ingredient stock quantities are expected to be `0` for now because inventory receipts are not currently reflected as authoritative stock numbers.
- Detailed purchase/yield values such as `oz_per_purchase_unit`, `trim_waste_factor`, and `units_per_case` can be filled in later.
- Native production/procurement visibility should not be blocked solely because current stock is `0`.
- Missing purchase/yield conversion values should not force guessed `IngredientYield` records.

Approved policy phrases received:

```text
APPROVE INVENTORY SEED POLICY: NON_STOCK_MASTER_DATA_ONLY
APPROVE YIELD POLICY: DEFER_DETAILED_PURCHASE_CONVERSION_VALUES
APPROVE ALIAS The NuVira Trio -> NuVira Trio
```

Revised interpretation:

- `The NuVira Trio` should map to Hub Bundle `NuVira Trio` (`69e8f55b06e17fbd88dbbc0c`).
- Black Salt and Beetroot `IngredientYield` records should **not** be created yet.
- Missing Black Salt / Beetroot yield details become `yield_details_pending` and `procurement_conversion_pending` warnings.
- Missing yield details block inventory deduction, purchase-unit conversion, and PO automation.
- Missing yield details do **not** block recipe matching, product demand, ingredient needs in recipe units / ounces, basic non-stock master-data mirror/import planning, or production/procurement visibility.
- Customer App inventory master-data mirror/import should seed or keep stock quantities at `0` and should not mirror live Hub stock as authoritative.

## A. Alias mapping approval

### Proposed alias

- Source product / order line item: `The NuVira Trio`
- Proposed Hub Bundle: `NuVira Trio`
- Hub Bundle id: `69e8f55b06e17fbd88dbbc0c`
- Alias confidence: `0.9`
- Proposed action: map/alias the Customer App line item name to the existing Hub Bundle instead of creating a duplicate bundle.

### Hub Bundle component context

The current G31C admin preview surfaced the candidate Hub Bundle name, id, and confidence, but it did **not** surface the live Hub Bundle component list or component quantities.

Do not infer components in this packet. Before any live seed/import, the next executable preview should either:

- include the Hub Bundle components in a read-only seed packet, or
- read them directly from Hub in a bounded admin-only preview.

### Why this is likely the correct match

- The normalized names differ only by the leading article `The`.
- The live preview found a single Hub Bundle alias candidate.
- The candidate is a Hub `Bundle`, not an unrelated product type.
- The G31C confidence value is high (`0.9`).

### Risk of approving the alias

- If `The NuVira Trio` and `NuVira Trio` are not operationally identical, native production demand could decompose the Customer App line item using the wrong Hub Bundle recipe/component set.
- Because the component list was not surfaced in the current preview, the alias should be treated as a mapping approval, not final approval to seed/import until a schema-safe seed packet displays the resulting bundle components.

### Risk of creating a duplicate bundle instead

- Duplicate bundle master data can split future production demand across two names.
- Duplicate bundles increase the chance of recipe/ingredient drift between Hub and Customer App.
- Duplicate bundles create avoidable cleanup risk during Hub retirement.

### Recommendation

Alias mapping is now approved. Do not create a duplicate bundle unless the owner explicitly revokes the alias approval.

Received owner approval phrase:

```text
APPROVE ALIAS The NuVira Trio -> NuVira Trio
```

## B. Black Salt yield status

### Existing Hub InventoryItem match

The current G31C preview confirms a Hub `InventoryItem` match for `Black Salt`:

- name: `Black Salt`
- id: `69ed645fab9a16f877208573`
- source line item / recipe context: `Reset Shot`
- mirror status: `Mirror Ready With Stock Seed Decision`

The current G31C admin preview did **not** surface the live InventoryItem unit, category, supplier, current stock, reorder point, or max stock values. Do not infer those values in this approval packet.

### Deferred owner fields for future purchase conversion

The following values are no longer required before non-stock master-data mirror/import planning:

- `ingredient_name`
- `purchase_unit`
- `oz_per_purchase_unit`
- `trim_waste_factor`
- `units_per_case`
- `rounding_rule`

Schema notes from Customer App `IngredientYield`:

- `purchase_unit` enum: `each`, `bunch`, `lb`, `bag`, `bottle`, `case`, `carton`, `box`, `other`
- `rounding_rule` enum: `round_up_unit`, `round_up_case`, `exact`
- required fields are `ingredient_name`, `purchase_unit`, `oz_per_purchase_unit`
- `trim_waste_factor` defaults to `1` when not explicitly set, but owner approval should still state the intended value

Do not create a guessed Hub or Customer App `IngredientYield` row. These values can be supplied in a later inventory deduction / purchase conversion phase.

Future owner-fillable approval block, held for later:

```text
APPROVE BLACK SALT YIELD
ingredient_name=Black Salt
purchase_unit=
oz_per_purchase_unit=
trim_waste_factor=
units_per_case=
rounding_rule=
```

## C. Beetroot yield status

### Existing Hub InventoryItem match

The current G31C preview confirms a Hub `InventoryItem` match for `Beetroot`:

- name: `Beetroot`
- id: `69ed645fab9a16f87720856d`
- source line item / recipe context: `Radiance Shot`
- mirror status: `Mirror Ready With Stock Seed Decision`

The current G31C admin preview did **not** surface the live InventoryItem unit, category, supplier, current stock, reorder point, or max stock values. Do not infer those values in this approval packet.

### Deferred owner fields for future purchase conversion

The following values are no longer required before non-stock master-data mirror/import planning:

- `ingredient_name`
- `purchase_unit`
- `oz_per_purchase_unit`
- `trim_waste_factor`
- `units_per_case`
- `rounding_rule`

Schema notes from Customer App `IngredientYield`:

- `purchase_unit` enum: `each`, `bunch`, `lb`, `bag`, `bottle`, `case`, `carton`, `box`, `other`
- `rounding_rule` enum: `round_up_unit`, `round_up_case`, `exact`
- required fields are `ingredient_name`, `purchase_unit`, `oz_per_purchase_unit`
- `trim_waste_factor` defaults to `1` when not explicitly set, but owner approval should still state the intended value

Do not create a guessed Hub or Customer App `IngredientYield` row. These values can be supplied in a later inventory deduction / purchase conversion phase.

Future owner-fillable approval block, held for later:

```text
APPROVE BEETROOT YIELD
ingredient_name=Beetroot
purchase_unit=
oz_per_purchase_unit=
trim_waste_factor=
units_per_case=
rounding_rule=
```

## D. Inventory stock seed policy approval

`InventoryItem` has two distinct meanings:

1. master data: ingredient name, unit, category, supplier, reorder point, packaging, and procurement metadata
2. live operational state: current stock quantity

Native production readiness needs master data first. Live stock mirroring is a separate business decision.

### Option 1 — Mirror Hub stock

Customer App inventory stock starts from current Hub stock.

- Good for continuity.
- Risk: mirrors potentially stale live stock and can make Customer App appear authoritative for stock before native inventory operations are validated.

Approval phrase:

```text
APPROVE INVENTORY SEED POLICY: MIRROR_HUB_STOCK
```

### Option 2 — Seed zero stock

Customer App receives inventory records, but stock starts at `0`.

- Good for make-to-order and clear procurement workflow.
- Risk: does not preserve current Hub stock state.

Approval phrase:

```text
APPROVE INVENTORY SEED POLICY: SEED_ZERO_STOCK
```

### Option 3 — Mirror non-stock master data only

Mirror item names, units, categories, suppliers, reorder points, packaging fields, recipes, and bundles. Mirror existing compatible yield records only where they already exist and are safe; do not create guessed yield rows. Do not mirror live stock quantities as authoritative operational state.

- Most conservative for migration.
- Keeps procurement-needed explicit.
- Avoids treating possibly stale Hub stock as native Customer App stock authority.

Approved default for NuVira make-to-order:

```text
APPROVE INVENTORY SEED POLICY: NON_STOCK_MASTER_DATA_ONLY
```

## Future schema-safe seed packet preview

After owner approvals are supplied, the next preview should produce a schema-safe seed packet with the following rows.

### Bundle alias / mapping row

```yaml
action: alias existing Hub Bundle or map Customer App line item to Hub Bundle
source_name: The NuVira Trio
target_hub_bundle_name: NuVira Trio
target_hub_bundle_id: 69e8f55b06e17fbd88dbbc0c
write_target: mapping/alias strategy, not duplicate bundle unless explicitly approved
owner_approval_status: approved
required_owner_phrase: APPROVE ALIAS The NuVira Trio -> NuVira Trio
```

### Black Salt deferred IngredientYield row

```yaml
action: do not create IngredientYield yet
ingredient_name: Black Salt
yield_policy: DEFER_DETAILED_PURCHASE_CONVERSION_VALUES
status: yield_details_pending
procurement_conversion_ready: false
inventory_deduction_ready: false
purchase_order_automation_ready: false
blocker_for_non_stock_master_data_mirror: false
```

### Beetroot deferred IngredientYield row

```yaml
action: do not create IngredientYield yet
ingredient_name: Beetroot
yield_policy: DEFER_DETAILED_PURCHASE_CONVERSION_VALUES
status: yield_details_pending
procurement_conversion_ready: false
inventory_deduction_ready: false
purchase_order_automation_ready: false
blocker_for_non_stock_master_data_mirror: false
```

### Future Customer App master-data mirror plan

After the G31E read-only preview confirms the approved policies:

1. mirror approved Recipes
2. mirror approved Bundles or apply explicit bundle mapping
3. mirror approved InventoryItems as non-stock master data and seed/keep Customer App stock at `0`
4. do not create guessed Black Salt or Beetroot `IngredientYield` rows
5. mark missing yield details as pending warnings
6. rerun G31C/G31E until all true blockers are clear and non-stock seed readiness is true
7. only then scope a separate gated Customer App master-data mirror/import preview PR and live seed approval

The future mirror/import phase must still prohibit:

- inventory deduction
- purchase order creation
- production batch creation
- provider calls
- notifications
- broad sync/repair/replay
- customer-facing status changes

## Implementation path recommendation

### Path A — Correct Hub master data first, then rerun G31C

Original steps:

1. approve alias mapping for `The NuVira Trio -> NuVira Trio`
2. add owner-approved Hub `IngredientYield` rows for `Black Salt` and `Beetroot`
3. decide inventory stock seed policy
4. rerun G31C until `16/16` rows are mirror-ready or explicitly mapped
5. create the Customer App master-data mirror/import PR

This was the G31D recommendation before owner clarification. It is now superseded for Black Salt and Beetroot yield details.

Do not create Hub IngredientYield rows for Black Salt or Beetroot until the owner supplies purchase-conversion values in a later phase.

### Revised G31E path — Customer App non-stock mirror/import preview

Steps:

1. apply the approved Trio alias in read-only preview semantics
2. apply `NON_STOCK_MASTER_DATA_ONLY` inventory seed policy
3. apply `DEFER_DETAILED_PURCHASE_CONVERSION_VALUES` yield policy
4. confirm G31E preview returns production master data / non-stock seed readiness
5. scope a gated Customer App non-stock master-data mirror/import preview
6. request separate explicit live import approval only after the preview is reviewed

Recommendation: use the revised G31E path.

Reason: it matches the make-to-order operating model, avoids guessed yield values, and keeps inventory deduction / PO automation held until stock and purchase-conversion policy is complete.

### Path B — Create Customer App mapping/yields during mirror import without modifying Hub

This is faster but creates Customer App divergence from Hub.

Do not use Path B unless the owner explicitly approves divergence and confirms Hub retirement is near enough that Hub master-data correction is no longer worth doing.

## Exact owner inputs still needed

No owner inputs remain for G31E read-only preview semantics.

Already received:

1. Alias approval:

```text
APPROVE ALIAS The NuVira Trio -> NuVira Trio
```

2. Inventory seed policy:

```text
APPROVE INVENTORY SEED POLICY: NON_STOCK_MASTER_DATA_ONLY
```

3. Yield policy:

```text
APPROVE YIELD POLICY: DEFER_DETAILED_PURCHASE_CONVERSION_VALUES
```

Future Black Salt / Beetroot yield conversion values are still needed before inventory deduction, purchase-unit conversion, or PO automation can be enabled.

## Hard stops

Stop and request explicit owner approval before any step that would:

- write Hub master data
- write Customer App master data
- create production batches
- deduct inventory
- create purchase orders
- call Stripe, Shopify, providers, or notification systems
- run sync, retry, repair, replay, import, mirror, or backfill commands
- change customer-facing status
- broaden native writer access
- disable Hub bridge fallback

## G31D confirmation

G31D modified documentation only. G31E updates read-only preview semantics, tests, UI copy, and documentation. Neither phase creates/updates live master data or business records.
