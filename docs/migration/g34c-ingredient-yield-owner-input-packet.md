# G34C: Ingredient/yield owner input packet

## 1. Scope

G34C is a docs-only, read-only owner input packet for the remaining procurement conversion decisions surfaced by G34B.

Target context:

- Proven native order: `NV-MPZNKGNT`
- Native procurement visibility function: `previewNativeProductionInventoryReadiness`
- Preview mode: `NATIVE_PROCUREMENT_VISIBILITY`
- Production date: `2026-06-07`
- Delivery date: `2026-06-08`
- Inventory policy: `NON_STOCK_MASTER_DATA_ONLY`
- Stock authoritative: `false`
- Inventory deduction: held
- PurchaseOrder automation: held
- Hub/manual fallback: active

This packet does not create or update `IngredientYield`, `InventoryItem`, `Recipe`, `Bundle`, `ProductionBatch`, `PurchaseOrder`, order, task, Hub, notification, provider, Stripe, or Shopify records.

## 2. Evidence used

This packet uses only repository and prompt-provided safe context:

- G34B live preview result supplied for `NV-MPZNKGNT`.
- `InventoryItem`, `IngredientYield`, `Recipe`, and `Bundle` schema files.
- G31D owner approval packet for deferred `Black Salt` and `Beetroot` yield details.
- G34A policy audit.
- G34B procurement visibility contract.
- G31/G34 migration harnesses for classification behavior and fixture examples.

No raw Hub payloads, secrets, customer PII, provider/payment payloads, or live write commands were used.

Important limitation: the clean repo artifacts do not contain current live Customer App row ids for every native `InventoryItem` or `IngredientYield` row. G34B's live preview confirms the classification and counts, but future command planning must rerun a read-only preview that prints safe row ids before any write command is planned.

## 3. Current approved policy

Owner-approved policy remains:

- NuVira is make-to-order.
- Native stock quantities are not authoritative yet.
- Stock can remain `0` under `NON_STOCK_MASTER_DATA_ONLY`.
- Missing yield/conversion details do not block production or procurement visibility.
- Missing yield/conversion details block:
  - inventory deduction
  - purchase-unit conversion
  - PurchaseOrder automation
- Inventory deduction remains held.
- PurchaseOrder automation remains held.
- Hub/manual fallback remains active.

## 4. G34B deferred details

G34B live preview for `NV-MPZNKGNT` returned:

- `success:true`
- `dry_run:true`
- `writes_performed:false`
- `production_batch_count:6`
- `product_demand_count:6`
- `ingredient_need_count:16`
- `procurement_needed:true`
- `procurement_needed_count:16`
- `procurement_visibility_ready:true`
- `classification:ready_with_deferred_yield_details`
- `procurement_conversion_ready:false`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- `blockers:[]`

Deferred detail rows:

| Ingredient | Deferred issue | Visibility impact | Deduction/PO impact |
| --- | --- | --- | --- |
| Black Salt | Yield details pending; trace/pinch usage. | Warning only. | Blocks deduction and PO conversion. |
| Beetroot | Yield details pending. | Warning only. | Blocks deduction and PO conversion. |
| Sea Salt | Stock-unit conversion pending. | Warning only. | Blocks deduction and PO conversion. |
| Black Pepper | Stock-unit conversion pending. | Warning only. | Blocks deduction and PO conversion. |

## 5. Schema fields owner may need to approve

### `InventoryItem`

Relevant fields:

- `ingredient` required
- `unit` required enum: `lbs`, `g`, `L`, `mL`, `units`, `cases`, `bottles`
- `stock` required, currently non-authoritative
- `reorder_point` required
- optional `max_stock`
- optional `supplier`
- optional `supplier_packaging_unit` enum: `case`, `bunch`, `lb`, `kg`, `count`, `box`, `bag`, `other`
- optional `supplier_packaging_qty`
- optional `weight_per_supplier_unit`
- optional `cost_per_supplier_unit`
- optional `location`
- optional `category` enum: `Produce`, `Juice Base`, `Spices & Herbs`, `Packaging`, `Supplies`, `Other`
- optional `notes`

### `IngredientYield`

Relevant fields:

- `ingredient_name` required
- `purchase_unit` required enum: `each`, `bunch`, `lb`, `bag`, `bottle`, `case`, `carton`, `box`, `other`
- `oz_per_purchase_unit` required
- optional `trim_waste_factor`, default `1`
- optional `units_per_case`
- optional `split_case_allowed`, default `true`
- optional `rounding_rule` enum: `round_up_unit`, `round_up_case`, `exact`, default `round_up_unit`
- optional `supplier`
- optional `notes`

## 6. Ingredient-specific read-only audit

### Black Salt

| Area | Current safe finding |
| --- | --- |
| Customer App `InventoryItem` | G34B implies native master data can match Black Salt for procurement visibility. Exact live native row id was not available in repo artifacts. |
| Customer App `IngredientYield` | Missing/deferred by policy. G34B reports `yield_details_pending:Black Salt`. |
| Hub `InventoryItem` | G31D preview found Hub InventoryItem `Black Salt`, id `69ed645fab9a16f877208573`. |
| Hub `IngredientYield` | Missing/deferred by policy in G31D/G31G; no guessed Hub or Customer App yield should be created. |
| Recipe usage | G34B current context treats usage as trace/pinch for procurement visibility. Older display fallback code contains a numeric Black Salt fallback; do not use that fallback to infer owner-approved yield values. |
| G34B need row | `Black Salt: pinch`, yield/trace pending. |
| Current decision needed | Owner must decide whether Black Salt stays trace/pinch-only for now or receives a formal purchase conversion later. |

### Beetroot

| Area | Current safe finding |
| --- | --- |
| Customer App `InventoryItem` | G34B implies native master data can match Beetroot for procurement visibility. Exact live native row id was not available in repo artifacts. |
| Customer App `IngredientYield` | Missing/deferred by policy. G34B reports `yield_details_pending:Beetroot`. |
| Hub `InventoryItem` | G31D preview found Hub InventoryItem `Beetroot`, id `69ed645fab9a16f87720856d`. |
| Hub `IngredientYield` | Missing/deferred by policy in G31D/G31G; no guessed Hub or Customer App yield should be created. |
| Recipe usage | `Radiance Shot`. |
| G34B need row | `Beetroot: 0.536 oz`, yield pending. |
| Current decision needed | Owner must supply purchase conversion/yield fields before deduction or PO automation can ever include Beetroot. |

### Sea Salt

| Area | Current safe finding |
| --- | --- |
| Customer App `InventoryItem` | Native master data exists or is matched for procurement visibility. Exact live native row id was not available in repo artifacts. |
| Customer App `IngredientYield` | G34B does not classify Sea Salt as yield-missing; it classifies stock-unit conversion as pending. |
| Hub `InventoryItem` | Hub/live exact row details were not available in repo artifacts. G31/G34 harnesses include Sea Salt as seeded non-stock master data reference. |
| Hub `IngredientYield` | Exact live row details were not available in repo artifacts. Harness references include Sea Salt yield examples, but those are not owner-approved production values. |
| Recipe usage | Likely `Aura` and `Oasis` from native recipe context. |
| G34B need row | `Sea Salt: 0.042 oz`, conversion pending. |
| Current decision needed | Owner must define the stock unit / purchase unit conversion policy so a small recipe-ounce demand can safely map to inventory stock and purchase units. |

### Black Pepper

| Area | Current safe finding |
| --- | --- |
| Customer App `InventoryItem` | Native master data exists or is matched for procurement visibility. Exact live native row id was not available in repo artifacts. |
| Customer App `IngredientYield` | G34B does not classify Black Pepper as yield-missing; it classifies stock-unit conversion as pending. |
| Hub `InventoryItem` | Hub/live exact row details were not available in repo artifacts. G31/G34 harnesses include Black Pepper as seeded non-stock master data reference. |
| Hub `IngredientYield` | Exact live row details were not available in repo artifacts. Harness references include Black Pepper yield examples, but those are not owner-approved production values. |
| Recipe usage | Likely `Oasis` from native recipe context. |
| G34B need row | `Black Pepper: 0.011 oz`, conversion pending. |
| Current decision needed | Owner must define the stock unit / purchase unit conversion policy so trace recipe-ounce demand can safely map to inventory stock and purchase units. |

## 7. Current procurement summary context

G34B known procurement summary rows for `NV-MPZNKGNT` include:

| Ingredient | Needed quantity | Notes |
| --- | ---: | --- |
| Pineapple | 40.173 oz | Existing procurement visibility row. |
| Cucumber | 4.725 oz | Existing procurement visibility row. |
| Coconut Water | 4.2 oz | Existing procurement visibility row. |
| Carrot | 3.675 oz | Existing procurement visibility row. |
| Orange | 3.675 oz | Existing procurement visibility row. |
| Red Apple | 3.255 oz | Existing procurement visibility row. |
| Kale | 2.625 oz | Existing procurement visibility row. |
| Celery | 2.625 oz | Existing procurement visibility row. |
| Green Apple | 1.838 oz | Existing procurement visibility row. |
| Lemon | 0.882 oz | Existing procurement visibility row. |
| Ginger | 0.63 oz | Existing procurement visibility row. |
| Beetroot | 0.536 oz | Yield pending. |
| Sea Salt | 0.042 oz | Stock-unit conversion pending. |
| Black Pepper | 0.011 oz | Stock-unit conversion pending. |
| Black Salt | pinch | Trace/pinch; yield pending. |

All rows are visibility-only. None authorize deduction, stock updates, or PO creation.

## 8. Comparable yield examples for owner reference only

These rows are decision aids only. Do not copy values automatically. Owner-supplied values must be explicit.

### Produce-like references for Beetroot

The G34B/G31 context shows comparable produce ingredients already participate in procurement visibility:

| Comparable ingredient | Why it may help | Why it may not be directly comparable | Values available from repo artifacts |
| --- | --- | --- | --- |
| Pineapple | Produce with recipe-ounce demand and known yield examples in migration harnesses. | Case size and usable yield differ materially from beetroot. | Fixture example: `purchase_unit:case`, `oz_per_purchase_unit:160`, `trim_waste_factor:1.05`, `units_per_case:6`, `rounding_rule:round_up_case`. |
| Cucumber | Produce ingredient used in Re-Nu/Aura. | Water content, trim, supplier pack, and usable yield differ from beetroot. | Live values not available in docs; G31G harness uses generic non-stock fixture values. |
| Carrot | Root produce, closer category to beetroot than fruit. | Trim and supplier pack may still differ. | Live values not available in docs; G31G harness uses generic non-stock fixture values. |
| Red Apple / Green Apple | Produce with recipe-ounce demand. | Apples are not root produce; pack size and trim differ. | G34B summary includes demand; exact live yield values not printed. |
| Kale / Celery | Produce with potential trim/waste considerations. | Bunch/leaf/stalk packaging may not compare to beetroot. | Exact live yield values not printed. |

Owner should supply Beetroot from actual vendor/package facts rather than deriving from another produce row.

### Seasoning/spice references for Black Salt, Sea Salt, and Black Pepper

| Comparable ingredient | Why it may help | Why it may not be directly comparable | Values available from repo artifacts |
| --- | --- | --- | --- |
| Sea Salt | Salt/spice-like ingredient with small recipe-ounce demand. | Sea Salt itself still has stock-unit conversion pending, so it cannot be used as a solved template. | Harness examples include `purchase_unit:lb`, `oz_per_purchase_unit:16`, `rounding_rule:exact`; not confirmed as live owner-approved production value. |
| Black Pepper | Spice-like ingredient with trace recipe-ounce demand. | Black Pepper itself still has stock-unit conversion pending, so it cannot be used as a solved template. | Harness examples include `purchase_unit:lb`, `oz_per_purchase_unit:16`, `rounding_rule:exact`; not confirmed as live owner-approved production value. |
| Black Salt / Kala Namak alias | G31C found a possible alias-style candidate in a harness example. | Alias examples are not live owner approval; Black Salt may remain trace-only. | Harness-only candidate: `Kala Namak`, `purchase_unit:bag`, `oz_per_purchase_unit:16`. |

For trace ingredients, owner may reasonably choose visibility-only/trace-only and keep deduction/PO automation held until a formal handling policy exists.

## 9. Owner-fillable approval blocks

### A. Black Salt decision

Option A keeps Black Salt as trace/pinch-only. This is the lowest-risk option and keeps deduction/PO automation held.

```text
APPROVE BLACK SALT TRACE ONLY
ingredient_name=Black Salt
recipe_usage=pinch
inventory_deduction=HELD
po_automation=HELD
```

Option B provides formal yield details for a future preview. This does not authorize a write by itself; it only supplies owner values for a later read-only schema-safe preview.

```text
APPROVE BLACK SALT YIELD
ingredient_name=Black Salt
purchase_unit=
oz_per_purchase_unit=
trim_waste_factor=
units_per_case=
split_case_allowed=
rounding_rule=
supplier=
notes=
inventory_deduction=HELD
po_automation=HELD
```

### B. Beetroot yield decision

```text
APPROVE BEETROOT YIELD
ingredient_name=Beetroot
purchase_unit=
oz_per_purchase_unit=
trim_waste_factor=
units_per_case=
split_case_allowed=
rounding_rule=
supplier=
notes=
inventory_deduction=HELD
po_automation=HELD
```

If Beetroot data is not available yet:

```text
HOLD BEETROOT YIELD
ingredient_name=Beetroot
reason=
inventory_deduction=HELD
po_automation=HELD
```

### C. Sea Salt stock-unit conversion decision

This decision should clarify how recipe-ounce demand maps to inventory/purchase units. It should not update stock or create POs.

```text
APPROVE SEA SALT STOCK UNIT CONVERSION
ingredient_name=Sea Salt
inventory_item_unit=
purchase_unit=
oz_per_purchase_unit=
trim_waste_factor=
units_per_case=
split_case_allowed=
rounding_rule=
supplier=
stock_unit_conversion_policy=
notes=
inventory_deduction=HELD
po_automation=HELD
```

If Sea Salt should stay visibility-only for now:

```text
HOLD SEA SALT STOCK UNIT CONVERSION
ingredient_name=Sea Salt
reason=
inventory_deduction=HELD
po_automation=HELD
```

### D. Black Pepper stock-unit conversion decision

```text
APPROVE BLACK PEPPER STOCK UNIT CONVERSION
ingredient_name=Black Pepper
inventory_item_unit=
purchase_unit=
oz_per_purchase_unit=
trim_waste_factor=
units_per_case=
split_case_allowed=
rounding_rule=
supplier=
stock_unit_conversion_policy=
notes=
inventory_deduction=HELD
po_automation=HELD
```

If Black Pepper should stay visibility-only for now:

```text
HOLD BLACK PEPPER STOCK UNIT CONVERSION
ingredient_name=Black Pepper
reason=
inventory_deduction=HELD
po_automation=HELD
```

## 10. Validation requirements for any later preview

After owner input is supplied, the next phase should still be read-only. It should validate:

- supplied `purchase_unit` is in the `IngredientYield.purchase_unit` enum
- supplied `rounding_rule` is in the `IngredientYield.rounding_rule` enum
- supplied `oz_per_purchase_unit` is positive when a formal yield is approved
- supplied `trim_waste_factor` is positive or omitted to use default `1`
- supplied `units_per_case` is positive if rounding by case is requested
- supplied `inventory_item_unit` is in the `InventoryItem.unit` enum if an InventoryItem unit conversion is proposed
- no stock quantity update is proposed
- no PurchaseOrder creation is proposed
- no provider/payment calls are proposed
- no notification/message rows are proposed
- no Hub mutation is proposed
- missing values remain warnings for visibility and blockers for deduction/PO automation

## 11. Recommended next phase

Recommended next phase: **G34D ingredient/yield owner input validation preview**.

G34D should be read-only and should answer:

- Which owner-supplied values are schema-valid?
- Which `IngredientYield` rows would be created or updated in a future command?
- Which `InventoryItem` unit/conversion fields would be changed in a future command, if any?
- Does procurement visibility remain ready?
- Does `procurement_conversion_ready` become true, or which rows remain pending?
- Do `inventory_deduction_ready` and `purchase_order_ready` remain false until stock/receiving/PO policy is separately approved?

Do not proceed directly to live `IngredientYield` or `InventoryItem` mutation from this packet.

## 12. Hard stops

Stop and require separate explicit approval before any action that would:

- create or update `IngredientYield`
- update `InventoryItem`
- update stock quantities
- deduct inventory
- create or update `PurchaseOrder`
- update `Recipe` or `Bundle`
- update `ProductionBatch` or `BatchComplianceLog`
- update orders or tasks
- send notifications or create message logs
- call Stripe, Shopify, suppliers, or providers
- run sync, retry, repair, or replay
- mutate Hub records
- disable Hub/manual fallback
