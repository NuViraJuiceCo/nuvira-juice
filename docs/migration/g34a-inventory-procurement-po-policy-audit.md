# G34A: Inventory procurement PO policy audit

## 1. Current state

G34A is a docs-only policy and architecture audit for native inventory, procurement-needed, and PurchaseOrder behavior after the proven controlled one-time order lifecycle. This phase does not change runtime code, Base44 functions, Builder UI, schemas, gates, records, inventory quantities, PurchaseOrders, providers, Hub bridge behavior, notifications, sync, repair, replay, or customer-facing behavior.

The proven native one-time order path intentionally stopped before stock deduction and PurchaseOrder automation. For `NV-MPZNKGNT`, production visibility worked with:

- `NON_STOCK_MASTER_DATA_ONLY` production master data.
- Stock seeded or kept as `0` under the make-to-order operating policy.
- `procurement_needed:true` when recipe demand exceeded non-authoritative stock.
- `inventory_deduction_ready:false`.
- `procurement_conversion_ready:false` where yield or purchase-unit conversion details were deferred.
- PurchaseOrder automation held.
- Black Salt and Beetroot yield details deferred.
- Sea Salt and Black Pepper stock-unit / purchase-unit conversion details deferred.

The resulting boundary is correct for the current business policy: production and procurement visibility are useful now; stock deduction, purchase-unit conversion, receiving, and PurchaseOrder automation are not yet safe to automate.

## 2. Owner make-to-order policy

The owner policy for the current migration state is:

- NuVira is make-to-order.
- Inventory stock quantities are expected to be `0` for now.
- Current inventory receiving and stock updating are not maintained yet.
- Missing yield or purchase conversion details should not block production visibility.
- Missing yield or purchase conversion details should block inventory deduction, purchase-unit conversion, and PurchaseOrder automation.

This means native inventory should currently behave as a planning/readiness surface, not as an authoritative stock ledger.

## 3. Native inventory and procurement map

| Area | Native status | Hub/manual status | Writes today | Held scope |
| --- | --- | --- | --- | --- |
| `InventoryItem` schema | Native entity exists with ingredient, unit, stock, reorder point, supplier, packaging, supplier unit/cost, and categorization fields. | Hub inventory can still be surfaced through admin summary fallback where configured. | Admin/inventory RLS allows direct record changes, but automated native deduction is not generalized. | Automated stock deduction, stock truth, receiving, reversal, and broad adjustment workflows. |
| `IngredientYield` schema | Native entity exists with purchase unit, oz per purchase unit, trim/waste factor, units per case, split-case, rounding, and supplier fields. | Hub/manual conversion policy remains useful as reference. | Non-stock master-data import can seed yield rows when contract allows. | Detailed purchase conversion for deferred ingredients and PO conversion automation. |
| `Recipe` schema | Native entity exists with product SKU, bottle size, yield factor, and ingredient quantity rows. | Some admin summaries use fallback/built-in recipe context if native recipe coverage is incomplete. | Master-data import can write schema-safe recipes under exact policy. | Broad recipe mutation and unreviewed recipe normalization. |
| `Bundle` schema | Native entity exists with component products and fulfillment count. | Hub/manual references may still be needed for historical or unsupported bundles. | No broad bundle automation is part of this phase. | Bundle generalization for all one-time orders. |
| `PurchaseOrder` schema | Native entity exists with PO number, supplier, status, items, totals, and dates. | Hub/manual purchase planning remains the short-term fallback. | No native PO automation command is generalized. Existing open POs can be read in admin summaries. | PO creation, PO receiving, supplier ordering, provider/payment calls. |
| `ProductionBatch` inventory fields | Batches carry `procurement_needed`, `inventory_deduction_status`, `ingredient_usage_status`, and optional deduction log references. | Hub/manual context remains available for planning and historical comparison. | Native production lifecycle writes batch production state and procurement-needed metadata. | `inventory_deduction_log_id` and actual stock deduction remain blocked. |
| `BatchComplianceLog` | Native verified compliance logs are proven. | Hub logs remain historical/fallback context. | Verify command can create locked compliance logs for exact batches. | Compliance logs do not imply inventory deduction or PO automation. |
| `/admin/production-planning` | Native read summaries show order/product demand, recipe coverage, procurement needs, and readiness context. | Hub production planning summary can still be read where configured. | Read-only planning summary. | No deduction or PO creation. |
| `/admin/inventory-status` | Native inventory and PO summary reads stock/reorder/open-PO context and procurement plan rows. | Hub inventory summary can be merged as fallback/reference. | Copy/export planning only. | No stock deduction and no PO creation. |
| `/admin/sync-health` | Migration previews show held inventory/PO status where relevant. | Hub fallback remains active. | Read-only migration health panels. | No write controls for inventory/PO generalization. |

## 4. Current native function behavior

| Function / surface | Type | Inventory/procurement behavior | Current safe interpretation |
| --- | --- | --- | --- |
| `previewNativeProductionInventoryReadiness` | Read-only preview | Calculates recipe demand, inventory rows, IngredientYield conversion context, procurement rows, `procurement_needed`, `inventory_deduction_ready`, and `procurement_conversion_ready`. | Safe production/procurement readiness preview. It must not be treated as deduction approval. |
| `previewNativeProductionMasterDataParity` | Read-only preview | Allows non-stock master-data visibility even when yield/purchase conversion details are pending; emits warnings such as yield pending, procurement conversion pending, inventory deduction held, and PO automation held. | Correct policy gate: missing conversion details warn for visibility but block deduction/PO. |
| `importNativeProductionMasterDataForCustomerApp` | Gated write command | Imports schema-safe non-stock master data under exact policy. It does not establish authoritative stock. | Useful for production visibility only. Do not use as inventory receiving. |
| `previewNativeProductionDemandMaterialization` | Read-only preview | Shows demand and batch materialization readiness while keeping `inventory_deduction_ready:false` in held scenarios. | Safe pre-batch planning preview. |
| `materializeNativeProductionBatchesForCustomerApp` | Gated write command | Writes exact ProductionBatch rows and held inventory/procurement metadata; blocks unexpected inventory deduction readiness and forbidden deduction payloads. | Proven for production visibility, not stock mutation. |
| `startNativeProductionBatchesForCustomerApp` | Gated write command | Starts exact batches and rejects deduction/write-through inventory inputs. | Production lifecycle only. |
| `completeNativeProductionBatchesForCustomerApp` | Gated write command | Completes exact batches and rejects deduction/write-through inventory inputs. | Production lifecycle only. |
| `verifyNativeProductionBatchesForCustomerApp` | Gated write command | Verifies exact batches and creates BatchComplianceLog rows; rejects inventory deduction and PO side effects. | Compliance lifecycle only. |
| `previewNativeProductionVerifyCascades` | Read-only preview | Shows downstream pack/bottle/customer-status readiness while inventory deduction remains held. | Safe post-verify cascade preview. |
| `getAdminProductionPlanningSummary` | Read-only admin summary | Shows production demand and procurement-needed planning; explicitly reports inventory deduction and PO automation disabled. | Operator visibility only. |
| `getAdminInventoryStatusSummary` | Read-only admin summary | Reads native InventoryItem and PurchaseOrder context, open PO coverage, and Hub fallback where configured; reports native read-only and automation disabled. | Inventory/procurement dashboard, not an automation trigger. |
| `previewAdminProductionInventoryDeduction` | Read-only / frozen admin preview | Hub-backed production queue preview can show potential deduction rows, but live deduction is frozen/held in the current migration boundary. | Keep as preview-only until native stock policy is proven. |
| `previewAdminProductionIngredientUsageCorrection` and related admin correction surface | Preview/gated correction surface | Can correct production ingredient usage metadata under explicit command policy, but does not deduct inventory or create POs. | Do not confuse usage correction with stock ledger mutation. |

## 5. What is proven

| Proven item | Evidence / implication |
| --- | --- |
| Production demand can be made visible without stock mutation. | `NV-MPZNKGNT` materialized and completed production batches while inventory deduction remained held. |
| Procurement-needed can be tracked separately from stock deduction. | Production batches can carry `procurement_needed` and held deduction metadata. |
| Missing yield details do not need to block production visibility. | Master-data parity policy allowed deferred yield details while blocking deduction/PO readiness. |
| Native admin summaries can show procurement planning context read-only. | Production planning and inventory status summaries read native and Hub/reference context without creating POs. |
| Compliance verification is independent from inventory deduction. | BatchComplianceLog creation was proven without stock deduction. |
| Hub/manual fallback remains compatible with native production. | Hub bridge stayed active through the controlled lifecycle. |

## 6. What remains held

| Held area | Reason |
| --- | --- |
| Inventory deduction | Current stock is not authoritative, receiving is not maintained, yield/conversion coverage is incomplete, and reversal/audit policy is not proven. |
| PurchaseOrder automation | Supplier mapping, purchase-unit conversion, rounding, minimum order quantities, approval workflow, and receiving lifecycle are not complete. |
| Inventory receiving | No controlled native receiving workflow is proven as stock source of truth. |
| Stock adjustment / spoilage / waste correction | No safe correction/reversal policy exists for maintaining stock truth after production or receiving errors. |
| Provider ordering or payment | Explicitly outside current migration scope. PO automation must not call suppliers, payment providers, Stripe, Shopify, or third-party APIs. |
| Broad recipe/yield normalization | Current policy allows production visibility despite incomplete yield details; it does not authorize broad ingredient conversion rewrites. |
| Hub retirement for inventory/procurement | Hub/manual fallback is still required until native stock, receiving, and PO policies are proven. |

## 7. Inventory deduction blockers

| Blocker | Classification | Current handling |
| --- | --- | --- |
| Stock is not maintained as authoritative. | Must fix before deduction. | Treat stock as non-authoritative planning context. |
| Stock is often `0` by make-to-order policy. | Must fix or explicitly model before deduction. | `0` stock can drive procurement-needed visibility, not stock mutation. |
| Receiving/stock update workflow is not implemented or proven. | Must fix before deduction. | Keep manual receiving outside native automation. |
| Black Salt yield details deferred. | Blocks deduction and PO conversion; warning for visibility. | Continue as owner-input item. |
| Beetroot yield details deferred. | Blocks deduction and PO conversion; warning for visibility. | Continue as owner-input item. |
| Sea Salt stock-unit / purchase-unit conversion deferred. | Blocks deduction and PO conversion. | Continue as owner-input / schema-safe conversion item. |
| Black Pepper stock-unit / purchase-unit conversion deferred. | Blocks deduction and PO conversion. | Continue as owner-input / schema-safe conversion item. |
| Purchase-unit conversion incomplete across ingredients. | Blocks deduction where stock unit and recipe unit differ; blocks PO automation. | Show conversion warnings only. |
| Inventory audit trail policy not proven. | Must fix before deduction. | Future deduction command must write exact CommandLog/audit rows. |
| Duplicate/idempotent deduction policy not proven. | Must fix before deduction. | Require request-id idempotency and duplicate batch/order safeguards in any future command. |
| Stock adjustment/reversal policy missing. | Must fix before deduction. | Do not deduct until corrections can be safely reversed or adjusted. |
| Spoilage/waste correction workflow missing. | Must fix before authoritative stock. | Keep waste/spoilage manual. |
| No exact batch/order deduction preview contract. | Needs command preview. | Build read-only dry run before any live command. |
| No broad eligibility policy for deduction. | Must fix before broad use. | Exact batch/order allowlists only if a pilot is approved later. |

## 8. PurchaseOrder blockers

| Blocker | Classification | Current handling |
| --- | --- | --- |
| Supplier mapping incomplete. | Must fix before PO automation. | Show supplier when known; do not create POs. |
| Purchase unit conversion incomplete. | Must fix before PO automation. | `procurement_conversion_ready:false` or warnings. |
| Units per case / split case policy incomplete. | Must fix before PO automation. | Treat as owner-input. |
| Rounding rules incomplete. | Must fix before PO automation. | Do not infer purchase quantities. |
| Minimum order quantities not modeled/proven. | Must fix before PO automation. | Keep procurement plan advisory. |
| PO approval workflow not implemented. | Must fix before live PO creation. | No automatic PO creation. |
| PO receiving lifecycle not implemented. | Must fix before stock truth. | No receiving automation. |
| Provider/supplier ordering integration not approved. | Should stay forbidden. | No provider calls. |
| Payment/provider coupling not approved. | Should stay forbidden. | No Stripe, Shopify, supplier, or payment calls. |
| Reconciliation policy for cancelled/changed POs missing. | Must fix before PO lifecycle automation. | Manual only. |

## 9. Native inventory policy options

| Option | Description | Fit now | Recommendation |
| --- | --- | --- | --- |
| A. Visibility-only procurement | Use recipes and line items to show ingredient needs, procurement-needed flags, yield/conversion gaps, and non-authoritative stock context. Do not deduct stock or create POs. | Best current fit. | Adopt as G34 v1. |
| B. Manual received-stock entry first | Add a controlled receiving workflow so stock can become meaningful before deduction. | Useful prerequisite, but needs policy and audit design. | Plan after visibility v1 or in parallel as policy design. |
| C. Inventory deduction from production completion/verification | Deduct stock after production lifecycle. | High risk now because stock and conversions are not reliable. | Hold until prerequisites are complete and exact dry-run command is proven. |
| D. PurchaseOrder automation | Create POs from procurement needs. | High risk now because supplier/conversion/approval/receiving details are incomplete. | Hold; design preview first, then gated command much later. |
| E. Hub/manual fallback for inventory | Keep current manual/Hub reference process while native visibility matures. | Safe short-term fallback. | Keep active. |

## 10. Recommended v1 procurement visibility plan

G34B should implement or extend a read-only native procurement visibility preview. The target behavior should be useful for operations without implying stock truth or automation approval.

Suggested function or extension:

- `previewNativeProcurementNeedsForProduction`, or
- an extension of existing production/inventory readiness summaries if that avoids duplicate logic.

V1 should show:

- Order/product demand.
- Ingredient need in recipe units.
- Ingredient need normalized only where conversion is schema-safe.
- `procurement_needed:true/false`.
- Missing yield details.
- Missing stock-unit / purchase-unit conversion details.
- Supplier when known.
- Current stock clearly labeled non-authoritative.
- Stock seeded or kept at `0` under make-to-order policy.
- Purchase conversion readiness.
- Inventory deduction readiness, expected to remain false until prerequisites are met.
- PO automation readiness, expected to remain false until prerequisites are met.
- Warnings/blockers separated so production visibility is not blocked by conversion details that only affect deduction/PO automation.

V1 must not:

- Deduct inventory.
- Create or update PurchaseOrders.
- Update InventoryItem stock.
- Update Recipe, Bundle, or IngredientYield rows.
- Update ProductionBatch or BatchComplianceLog rows.
- Run sync, repair, replay, provider calls, Stripe calls, Shopify calls, or Hub mutations.

## 11. Prerequisites for future inventory deduction

Before enabling any live native inventory deduction, require all of the following:

1. Receiving/stock update policy approved.
2. Clear stock source of truth.
3. IngredientYield coverage complete for all ingredients used by the target batch/order.
4. Supported unit conversions for recipe units to stock units.
5. Exact batch/order allowlist for any pilot.
6. Read-only deduction preview with exact before/after stock values.
7. CommandLog and inventory audit trail contract.
8. Duplicate/idempotency policy using request ids.
9. Reversal/correction policy for mistaken deductions.
10. Spoilage/waste correction policy.
11. No PurchaseOrder automation coupling in the first deduction command.
12. Owner approval for exact batch/order/fields before live deduction.
13. Proof that no provider, payment, Stripe, Shopify, notification, sync, repair, replay, or Hub mutation is needed.

## 12. Prerequisites for future PurchaseOrder automation

Before enabling any PurchaseOrder automation, require all of the following:

1. Supplier mapping for each ingredient.
2. Purchase unit conversion for each ingredient.
3. Units per case / split-case policy.
4. Rounding rules.
5. Minimum order quantities.
6. Cost model and total calculation policy.
7. Approval workflow before PO creation or ordering.
8. PO draft vs ordered status policy.
9. Receiving workflow and received-stock reconciliation policy.
10. Cancellation/change policy.
11. Read-only PO preview with exact proposed PO rows.
12. Gated command with request-id idempotency and CommandLog audit.
13. Explicit prohibition on automatic provider ordering, payment calls, Stripe calls, Shopify calls, and supplier API calls unless a future owner-approved phase changes that boundary.

## 13. Hub fallback role

Hub/manual fallback should remain active for inventory and procurement. Current classification:

| Workflow | Current role |
| --- | --- |
| Native production visibility | Native primary for proven exact one-time path. |
| Procurement-needed planning | Native read-only is viable; Hub/manual fallback remains useful. |
| Inventory stock truth | Hub/manual or external process remains source/reference; native stock is not authoritative. |
| Inventory deduction | Held; no native primary yet. |
| PurchaseOrder automation | Held; no native primary yet. |
| Historical inventory context | Hub/manual reference remains useful. |
| Hub retirement | Not a candidate for inventory/procurement yet. |

Do not retire Hub inventory/procurement endpoints until native receiving, stock truth, deduction, reversal, PO preview, PO approval, and PO receiving workflows are proven.

## 14. Recommended next phase

Recommended next phase: **G34B native procurement visibility preview**.

Rationale:

- It is useful immediately under the make-to-order policy.
- It improves operator clarity without relying on authoritative stock.
- It keeps inventory deduction and PO automation blocked.
- It can reuse existing recipe, yield, inventory readiness, and procurement-needed logic.
- It creates a clean owner-input packet for missing yield/conversion details.

Parallel or follow-up planning:

- Ingredient/yield owner input packet for Black Salt, Beetroot, Sea Salt, Black Pepper, and any additional ingredients surfaced by G34B.
- Receiving/stock source-of-truth policy planning.
- Future `previewNativeInventoryDeductionForProduction` only after stock/yield/receiving prerequisites are clear.
- Future `previewNativePurchaseOrderNeeds` only after supplier/conversion/approval prerequisites are clear.

## 15. Hard stops

Stop and require explicit owner approval before any phase that would:

- Deduct inventory.
- Update `InventoryItem.stock`.
- Create or update a `PurchaseOrder`.
- Update `Recipe`, `Bundle`, or `IngredientYield` master data outside an approved master-data import contract.
- Update ProductionBatch inventory deduction fields beyond held/readiness metadata.
- Create inventory audit rows or deduction logs.
- Create provider, Stripe, Shopify, supplier, payment, notification, sync, repair, replay, or Hub side effects.
- Couple production verification to stock deduction.
- Couple procurement-needed visibility to PO creation.
- Disable Hub/manual fallback.

## 16. G33D status

G33D remains held. A second controlled one-time pilot should not proceed until a new natural paid one-time order arrives, G33C exact preview returns eligible, and exact owner approval is given.
