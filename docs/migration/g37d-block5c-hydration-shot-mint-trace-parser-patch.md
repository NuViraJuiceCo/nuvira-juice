# G37D-BLOCK5C: Hydration Shot Mint Trace Parser Patch

## Purpose

G37D-BLOCK5C implements the owner-approved parser/classification change for Hydration Shot Mint leaves:

```text
recipe_name=Hydration Shot
ingredient_name=Mint
unit=leaves
quantity_oz=0
quantity_type=trace_garnish
production_visibility_use=yes
inventory_deduction_use=no
purchase_order_use=no
```

The patch allows the exact Hydration Shot / Mint / leaves / `quantity_oz=0` semantics to be treated as trace/garnish for production visibility only. It does not approve inventory deduction, PurchaseOrder automation, notifications, provider calls, Hub mutation, or any production write.

## Context

G37D-BLOCK4 classified the remaining post-G37D-BLOCK3 blocker as:

```text
source_recipe_unit_unsupported
```

Evidence showed both Hub/source and native Hydration Shot Recipe rows use:

```text
Mint unit=leaves
Mint quantity_oz=0
```

The previous preview parsers allowed zero-quantity trace handling only for units like `pinch`, `dash`, `trace`, or `to taste`. Because `leaves` was not trace-approved, the previews emitted:

```text
unsupported_or_missing_recipe_quantity:Hydration Shot:Mint
```

That blocked production demand/materialization visibility even though inventory deduction and PO automation are still held.

## Runtime behavior

Patched functions:

- `base44/functions/previewNativeProductionInventoryReadiness/entry.ts`
- `base44/functions/previewNativeProductionDemandMaterialization/entry.ts`

Both now include an exact owner-decision helper for:

```text
Hydration Shot / Mint / leaves / quantity_oz=0
```

When this exact condition is present:

- the production visibility blocker is not emitted for Mint.
- Mint is added as a trace quantity row.
- warning `mint_trace_garnish_inventory_po_held` is emitted.
- warning `trace_recipe_ingredient_quantity_pending:Hydration Shot:Mint` remains emitted.
- warning `procurement_conversion_pending:Mint` remains emitted.
- `inventory_deduction_ready` remains false when trace ingredients are present.
- `purchase_order_ready` remains false.
- safety flags remain read-only.

## Guardrails

The trace/garnish allowance is exact. It does not apply when:

- recipe is not `Hydration Shot`.
- ingredient is not `Mint`.
- unit is not `leaves`.
- `quantity_oz` is not `0`.
- the zero-quantity ingredient is unrelated to the owner-approved Hydration Shot Mint decision.

Other unsupported zero-quantity units still block production visibility.

## What remains held

This patch does not change these holds:

- no ProductionBatch creation.
- no BatchComplianceLog creation.
- no Recipe mutation.
- no InventoryItem mutation.
- no IngredientYield creation/update.
- no inventory deduction.
- no PurchaseOrder creation.
- no notifications or message logs.
- no provider/Stripe/Shopify calls.
- no Hub mutation.
- no sync/retry/repair/replay.
- no customer-facing status change.

## Test coverage

Added harness:

```text
scripts/migration/run-g37d-block5c-hydration-shot-mint-trace-parser-tests.mjs
```

Covered cases:

1. Hydration Shot / Mint / leaves / `quantity_oz=0` no longer emits the production visibility blocker.
2. Mint trace/garnish warning is emitted.
3. Mint remains a trace quantity row.
4. `inventory_deduction_ready:false` remains enforced.
5. `purchase_order_ready:false` remains enforced.
6. Fully converted trace data still does not make inventory deduction ready.
7. Demand materialization preview can propose Hydration Shot batch rows when no other production blockers remain.
8. Other recipes with Mint leaves still block.
9. Other ingredients with leaves still block.
10. Other unsupported zero quantities still block.
11. No writes, providers, notifications, inventory deduction, or PO creation are represented by safety flags.

Regression harnesses run in PR prep:

- G37D-BLOCK5C focused harness.
- G34B procurement visibility harness.
- G31A inventory readiness harness.
- G31K demand materialization harness.
- G33C task/mirror harnesses.
- G27 cutover harness.
- `npm run build`.
- scoped ESLint.

## No-write policy

This PR is a runtime read-preview patch only. It does not execute live materialization and does not mutate records during PR prep.

Any later live action still requires separate approval. G37E materialization remains unapproved until the patched function is merged/published and a fresh live preview returns:

```text
materialization_ready:true
```

with exact proposed ProductionBatch rows.

## Rollback plan

If the patch behaves unexpectedly after publish, revert the runtime change in:

- `previewNativeProductionInventoryReadiness`
- `previewNativeProductionDemandMaterialization`

The rollback returns Mint leaves to the prior blocking behavior. Since this patch performs no writes, rollback is code/runtime only.

## Recommendation

Close/merge/publish G37D-BLOCK5C if checks pass. Then rerun the exact read-only G37D preview stack for `NV-MQHJR3V2`.

Only proceed to G37E materialization if the fresh preview stack is clean and returns exact proposed ProductionBatch rows. Otherwise hold and patch the next blocker.
