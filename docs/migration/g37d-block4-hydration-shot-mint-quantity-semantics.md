# G37D-BLOCK4: Hydration Shot Mint Quantity Semantics Audit

## 1. Executive summary

G37D-BLOCK4 audited the remaining post-import production blocker for the exact controlled order `NV-MQHJR3V2`:

```text
unsupported_or_missing_recipe_quantity:Hydration Shot:Mint
```

The audit was read-only/docs-only. It did not update `Recipe`, `InventoryItem`, `IngredientYield`, order, task, batch, Hub, provider, notification, inventory, or PO records.

Finding: the G37D-BLOCK3 import preserved the source recipe semantics. Both the native Hydration Shot Recipe and the safe Hub/source Recipe context represent Mint as:

```text
ingredient=Mint
unit=leaves
quantity_oz=0
```

The current production readiness and demand materialization previews treat `quantity_oz <= 0` as materialization-blocking unless the unit is an explicitly supported trace unit: `pinch`, `dash`, `trace`, or `to taste`. `leaves` is not currently a supported trace unit. Therefore Mint is not being blocked because the Recipe row is missing, because the InventoryItem is missing, or because G37D-BLOCK3 dropped a quantity; it is blocked because the source/native semantics do not provide a production-computable numeric ingredient demand for Mint.

Recommendation: do not approve G37E materialization yet. Request owner input for Mint semantics first. Then choose one narrow BLOCK5 path:

- If Mint has an actual production quantity: plan `G37D-BLOCK5A` exact Recipe quantity correction command.
- If Mint is garnish/trace and should not block production visibility: plan `G37D-BLOCK5C` or `G37D-BLOCK5D` parser/classification patch, with explicit owner approval that inventory deduction and PO automation remain held.
- If neither is confirmed: hold.

## 2. Target order context

| Field | Value |
| --- | --- |
| order_number | `NV-MQHJR3V2` |
| Customer App Order | `6a321cbfd8d78863f15de956` |
| Native ShopifyOrder | `6a321d38a3819cdd5cf89031` |
| Native FulfillmentTask | `6a321d38071327f8218b958b` |
| production_date | `2026-06-19` |
| delivery_date | `2026-06-20` |

G37D-BLOCK3 created exactly the approved non-stock visibility rows:

| Entity | Name | id |
| --- | --- | --- |
| Recipe | Hydration Shot | `6a32a5a5d2c86c2213db0525` |
| InventoryItem | Lime Juice | `6a32a5a591da1d65eb349614` |
| InventoryItem | Honey | `6a32a5a6cec8b8f51c38996b` |
| InventoryItem | Mint | `6a32a5a6db84e9f114e6c432` |
| InventoryItem | Pink Salt | `6a32a5a619bc3352c1695110` |

Still held after G37D-BLOCK3:

- IngredientYield rows for Beetroot, Lime Juice, Honey, Mint, and Pink Salt.
- Inventory deduction.
- PurchaseOrder automation.
- ProductionBatch materialization.
- BatchComplianceLog creation.
- Order/task/customer status cascades.
- Notifications.
- Provider/Stripe/Shopify calls.
- Hub mutation.

## 3. Post-BLOCK3 state

Post-live G37D-BLOCK1 preview after G37D-BLOCK3 showed:

- Hydration Shot Recipe present.
- Lime Juice, Honey, Mint, and Pink Salt InventoryItems present.
- no Recipe create rows remaining.
- no InventoryItem create rows remaining.
- IngredientYield rows still deferred:
  - Beetroot
  - Lime Juice
  - Honey
  - Mint
  - Pink Salt
- `production_master_data_ready:true`
- `inventory_deduction_ready:false`
- `purchase_order_ready:false`
- `recommended_next_action:ready_with_deferred_yield_details`

However, the full production preview stack still held materialization:

| Preview | Result |
| --- | --- |
| `previewNativeProductionInventoryReadiness` | `production_ready:false`, blocker `unsupported_or_missing_recipe_quantity:Hydration Shot:Mint` |
| procurement visibility mode | `procurement_visibility_ready:false`, classification `blocked_unsupported_recipe_quantity` |
| `previewNativeProductionDemandMaterialization` | `materialization_ready:false`, blockers `production_demand_not_ready` and `unsupported_or_missing_recipe_quantity:Hydration Shot:Mint` |
| `previewNativeProductionBatchLifecycle` | held because no native ProductionBatch exists |
| `previewNativeProductionVerifyCascades` | held pending production/verification state |

## 4. Blocker details

Current blocker:

```text
unsupported_or_missing_recipe_quantity:Hydration Shot:Mint
```

The blocker is not a missing master-data row blocker. It appears after the Recipe and InventoryItem visibility rows exist, when the production preview attempts to compute ingredient demand from Recipe quantities.

Current impact:

| Domain | Status |
| --- | --- |
| production demand calculation | blocked for Mint quantity semantics |
| procurement visibility | blocked/held for unsupported recipe quantity plus deferred yield/procurement conversion |
| inventory deduction | held regardless of this blocker |
| PurchaseOrder automation | held regardless of this blocker |
| G37E materialization | not approved; `materialization_ready:false` |

## 5. Native Recipe evidence

Read-only audit request:

```text
g37d_block4_mint_quantity_semantics_audit_nvmqhjr3v2_20260617T140440Z
```

Native Hydration Shot Recipe safe fields:

| Field | Value |
| --- | --- |
| id | `6a32a5a5d2c86c2213db0525` |
| product_name | Hydration Shot |
| bottle_size_oz | `2.32` |
| yield_factor | `1.05` |
| is_active | `true` |
| ingredient_count | `5` |

Native ingredient summary:

| Ingredient | quantity_oz | unit |
| --- | ---: | --- |
| Coconut Water | `1.69` | oz |
| Lime Juice | `0.34` | oz |
| Honey | `0.15` | oz |
| Mint | `0` | leaves |
| Pink Salt | `0` | pinch |

Mint native Recipe entry:

```text
ingredient_name=Mint
quantity_oz=0
unit=leaves
```

The native Recipe does not contain a nonzero production-computable Mint quantity. It also does not include a separate normalized leaf count or ounce conversion field.

Native Mint InventoryItem safe fields:

| Field | Value |
| --- | --- |
| id | `6a32a5a6db84e9f114e6c432` |
| ingredient | Mint |
| unit | lbs |
| stock | `0` |
| stock_authoritative | `false` |
| reorder_point | `1` |
| purchase_unit | not set |
| oz_per_purchase_unit | not set |
| units_per_case | not set |
| trim_waste_factor | not set |
| is_active | `false` |

The InventoryItem is a non-stock visibility row. It is not authoritative for stock, yield, deduction, or PO automation.

## 6. Hub/source Recipe evidence

Read-only nested Hub/source context request:

```text
g37d_block4_hub_mint_quantity_nested_audit_nvmqhjr3v2_20260617T140516Z
```

Safe Hub/source Hydration Shot Recipe context:

| Field | Value |
| --- | --- |
| Hub Recipe id | `69ed63d35c89c5d5ffa37e0e` |
| name | Hydration Shot |
| bottle_size_oz | `2.32` |
| yield_factor | `1.05` |
| ingredient_count | `5` |

Safe Hub/source ingredient summary:

| Ingredient | quantity_oz | unit |
| --- | ---: | --- |
| Coconut Water | `1.69` | oz |
| Lime Juice | `0.34` | oz |
| Honey | `0.15` | oz |
| Mint | `0` | leaves |
| Pink Salt | `0` | pinch |

Hub/source Mint entry:

```text
ingredient_name=Mint
quantity_oz=0
unit=leaves
```

This confirms G37D-BLOCK3 did not drop a nonzero Mint quantity during import. The source recipe itself presents Mint as leaves with a zero ounce quantity.

## 7. Blocker source trace

The blocker is emitted by both:

- `base44/functions/previewNativeProductionInventoryReadiness/entry.ts`
- `base44/functions/previewNativeProductionDemandMaterialization/entry.ts`

Both previews use the same ingredient-demand pattern:

1. Attach the matched native Recipe to each demand row.
2. Iterate `recipe.ingredients`.
3. Read `ingredient.quantity_oz`.
4. If `quantity_oz <= 0`, allow it only if `isTraceIngredientQuantity(ingredient)` returns true.
5. Otherwise emit:

```text
unsupported_or_missing_recipe_quantity:<product_name>:<ingredient_name>
```

The trace-unit helper in `previewNativeProductionInventoryReadiness` defines:

```text
TRACE_INGREDIENT_UNITS = pinch, dash, trace, to taste
```

`isTraceIngredientQuantity` returns true only when quantity is zero/null and the unit is one of those trace units. Because Mint uses `unit=leaves`, it is not trace-approved by the current parser. Pink Salt uses `unit=pinch`, so it becomes a warning instead of a blocker.

The G37D-BLOCK2 import command did not invent or transform Mint semantics. Its Hydration validation explicitly expected:

```text
Mint quantity_oz=0 unit=leaves
Pink Salt quantity_oz=0 unit=pinch
```

The master-data preview/import mapping copies safe recipe payload fields from Hub/source into the native Recipe payload:

- `ingredient_name`
- `quantity_oz`
- `unit`

Therefore the issue is not an import mapping drop. It is an unsupported production-demand semantic for Mint leaves.

## 8. Classification

Primary classification:

```text
source_recipe_unit_unsupported
```

Secondary classifications:

```text
ingredient_yield_owner_input_required
native_recipe_quantity_parser_gap_possible
```

Not supported by evidence:

| Classification | Reason rejected |
| --- | --- |
| `source_recipe_quantity_missing` | Source has an explicit quantity field, but it is zero with unit `leaves`. |
| `import_mapping_dropped_quantity` | Native and Hub/source both show Mint `quantity_oz=0`. |
| `import_mapping_dropped_unit` | Native and Hub/source both show Mint `unit=leaves`. |
| `native_recipe_schema_missing_quantity_field` | Recipe supports `quantity_oz`; Mint has the field. |
| `preview_parser_rejects_valid_quantity` | There is no nonzero numeric production quantity to reject. |
| `procurement_only_warning_incorrectly_blocks_materialization` | Not enough evidence. Current materialization computes ingredient demand before proposing batches, and Mint demand is not computable. |

Current impact by domain:

| Question | Answer |
| --- | --- |
| Can production demand be fully calculated? | Not for Mint under current semantics. |
| Can procurement visibility be calculated? | Not cleanly; it remains blocked/held. |
| Is inventory deduction safe? | No. Still held. |
| Is PO automation safe? | No. Still held. |
| Can G37E proceed without fixing this? | No, unless owner approves a parser/classification path that treats Mint leaves as trace/non-blocking for production visibility only. |

## 9. Safe correction options

### Option A — Exact Recipe quantity correction command

Use if the owner provides an actual production quantity for Mint.

Example: if Hydration Shot should use a nonzero ounce-equivalent Mint quantity, a future exact command can update only the Hydration Shot Recipe Mint ingredient entry. This would require a separate PR, published command path, exact gate, exact live approval, and post-write preview stack.

Likely next phase:

```text
G37D-BLOCK5A: exact Hydration Shot Recipe quantity correction command
```

Expected changed files:

- existing exact master-data correction/import command, or a narrow existing command path if one already exists
- focused test harness
- docs

Allowed future write only after separate approval:

- update Hydration Shot Recipe id `6a32a5a5d2c86c2213db0525`, Mint ingredient quantity/unit fields only
- one safe CommandLog

Forbidden future writes:

- IngredientYield
- Bundle
- Product
- InventoryItem stock mutation
- order/task/batch mutations
- inventory deduction
- PurchaseOrder
- notifications
- provider/Stripe/Shopify calls
- Hub mutation

### Option B — Import command patch

Use only if future Hydration imports need different mapping behavior. Current evidence does not indicate an import mapping bug. G37D-BLOCK3 preserved the source Mint semantics exactly, so this is not the preferred path unless the intended source-to-native mapping must intentionally transform `leaves` into a supported production quantity.

Likely next phase if chosen:

```text
G37D-BLOCK5B: Hydration Shot import mapping patch
```

### Option C — Recipe quantity parser patch

Use if the owner confirms Mint leaves are a garnish/trace ingredient for production visibility and should not block materialization, while inventory deduction and PO automation remain held.

A future parser patch could treat `unit=leaves` with `quantity_oz=0` as trace-like for production visibility only. This should be limited and tested because it changes semantic classification. It must not make inventory deduction or PO automation authoritative.

Likely next phase:

```text
G37D-BLOCK5C: recipe quantity parser patch
```

Expected changed files:

- `base44/functions/previewNativeProductionInventoryReadiness/entry.ts`
- `base44/functions/previewNativeProductionDemandMaterialization/entry.ts`
- focused test harness
- docs

No live writes. Runtime publish required only after merge.

### Option D — Owner input needed

This is the recommended immediate path. We need owner/operator confirmation of what Mint means in this recipe:

- actual numeric production quantity, or
- garnish/trace/non-material quantity, or
- unsupported until yield/procurement details are supplied.

### Option E — Reclassify as inventory/PO-only blocker

Use only with explicit owner approval and a runtime patch. This path would allow production batch materialization even when Mint ingredient demand cannot be computed, while preserving inventory/PO holds. This is potentially safe if ProductionBatch rows only require product-level planned units and do not depend on ingredient demand. It still needs a narrow patch and tests because current code uses ingredient readiness as a materialization gate.

Likely next phase if chosen:

```text
G37D-BLOCK5D: materialization blocker classification patch
```

### Option F — Hold

Use if owner input is unavailable or if the team does not want to change parser/materialization semantics before this real order.

## 10. Owner input block

If Mint has a real production quantity or should be treated as trace/garnish, use this approval block:

```text
APPROVE HYDRATION SHOT MINT QUANTITY SEMANTICS
recipe_name=Hydration Shot
ingredient_name=Mint
quantity=
unit=
quantity_type=
production_visibility_use=yes/no
inventory_deduction_use=no
purchase_order_use=no
notes=
```

If yield/procurement details are also required, use this separate block:

```text
APPROVE MINT INGREDIENT YIELD / PROCUREMENT DETAILS
ingredient_name=Mint
purchase_unit=
oz_per_purchase_unit=
trim_waste_factor=
units_per_case=
split_case_allowed=
rounding_rule=
supplier_notes=
inventory_deduction_policy=HELD
purchase_order_policy=HELD
```

Do not infer Mint quantity from planned units. Do not infer leaf-to-ounce conversion. Do not enable inventory deduction or PO automation from this audit.

## 11. Recommendation

Recommended correction path:

```text
owner_input_required first
```

Then choose exactly one:

1. `G37D-BLOCK5A` if owner supplies a numeric production quantity/unit for Mint.
2. `G37D-BLOCK5C` if owner confirms Mint leaves should be treated as trace/garnish for production visibility only.
3. `G37D-BLOCK5D` if owner explicitly approves reclassifying this as not materialization-blocking while keeping inventory/PO held.
4. Hold if owner input is unavailable.

Do not approve G37E materialization yet. Fresh full preview stack still returns `materialization_ready:false` and proposed ProductionBatch rows remain zero.

## 12. Hard stops

- No Recipe update in G37D-BLOCK4.
- No InventoryItem update.
- No IngredientYield import.
- No Bundle/Product mutation.
- No ProductionBatch creation.
- No BatchComplianceLog creation.
- No Customer App Order mutation.
- No native ShopifyOrder mutation.
- No native FulfillmentTask mutation.
- No inventory deduction.
- No PurchaseOrder automation.
- No notifications.
- No Stripe/Shopify/provider calls.
- No Hub mutation.
- No sync/retry/repair/replay.
- No G37E materialization until a fresh full preview stack returns `materialization_ready:true` with exact proposed ProductionBatch rows.

## 13. No-write confirmation

G37D-BLOCK4 used read-only entity reads and dry-run preview calls only.

Request ids used:

```text
g37d_block4_mint_quantity_semantics_audit_nvmqhjr3v2_20260617T140440Z
g37d_block4_hub_mint_quantity_nested_audit_nvmqhjr3v2_20260617T140516Z
```

Expected safety state:

- `writes_performed:false`
- no Recipe mutation
- no InventoryItem mutation
- no IngredientYield mutation
- no Bundle/Product mutation
- no order/task/batch mutation
- no CommandLog creation
- no notifications/message logs
- no provider/Stripe/Shopify calls
- no Hub mutation
- no inventory deduction
- no PurchaseOrder creation
