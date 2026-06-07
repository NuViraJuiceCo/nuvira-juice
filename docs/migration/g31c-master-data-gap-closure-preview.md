# G31C — Native production master-data gap closure preview

## Scope

G31C extends the read-only native production master-data parity preview with a seed-packet preview. G31E updates that preview with owner-approved make-to-order policies so it can distinguish production-demand readiness from procurement conversion and inventory deduction readiness.

It is intended to explain exactly which Recipe, Bundle, InventoryItem, and IngredientYield rows would still need mirror/import planning before native production and procurement can run without Hub.

This phase is read-only:

- no Recipe, Bundle, InventoryItem, or IngredientYield records are created or updated
- no ProductionBatch records are created or updated
- no inventory is deducted
- no PurchaseOrder records are created
- no Customer App Order, ShopifyOrder, or FulfillmentTask records are mutated
- no Stripe, Shopify, provider, notification, sync, repair, or replay paths run
- Hub fallback remains required

## Current G31B blocker targets

For `NV-MPZNKGNT`, G31B reported 16 required rows, 13 mirror-ready rows, and 3 blockers:

- missing Hub Bundle: `The NuVira Trio`
- missing Hub IngredientYield: `Black Salt`
- missing Hub IngredientYield: `Beetroot`

G31C resolves those gaps only by read-only candidate analysis. G31E owner clarification changes two of the missing Hub `IngredientYield` gaps from launch blockers to deferred purchase-conversion warnings. It does not create the missing Hub rows or seed Customer App master data.

## Gap closure behavior

The preview now returns:

- `seed_packet_ready`
- `seed_packet_rows`
- `blocked_rows`
- `manual_mapping_required_rows`
- `owner_input_required_rows`
- `hub_missing_rows`
- `alias_candidate_rows`
- `next_action`
- `master_data_gap_closure_preview`

A seed packet is considered ready only when every required missing native row is mirror-ready and no inventory live-stock seed policy, alias mapping, or owner-input decision is outstanding.

After G31E, the preview also returns:

- `production_master_data_ready`
- `non_stock_master_data_seed_ready`
- `procurement_conversion_ready`
- `inventory_deduction_ready`
- `yield_details_pending`
- `pending_yield_items`
- `approved_alias_mappings`
- `inventory_seed_policy`
- `yield_policy`

## Inventory stock policy

`InventoryItem.stock` is live operational state, not pure master data. G31E owner clarification approves:

```text
APPROVE INVENTORY SEED POLICY: NON_STOCK_MASTER_DATA_ONLY
```

Meaning:

- mirror ingredient/product master data
- seed or keep Customer App stock quantities at `0`
- do not mirror Hub stock as authoritative
- do not treat stock shortfall as fatal
- show stock shortfall as `procurement_needed`

G31E also approves:

```text
APPROVE YIELD POLICY: DEFER_DETAILED_PURCHASE_CONVERSION_VALUES
```

Missing `IngredientYield` purchase-conversion details are warnings, not blockers, for production-demand visibility and basic non-stock master-data mirror planning. They still block inventory deduction, purchase-unit conversion, and purchase order automation.

## Expected next decisions

If G31C/G31E returns true Hub-missing Recipe, Bundle, or InventoryItem rows, update/approve Hub master data first. If it returns alias rows, approve an explicit mapping before any Customer App import.

For `NV-MPZNKGNT`, the owner-approved alias:

```text
APPROVE ALIAS The NuVira Trio -> NuVira Trio
```

allows the preview to treat the Hub Bundle `NuVira Trio` (`69e8f55b06e17fbd88dbbc0c`) as the mapped source for `The NuVira Trio`.

Only after all true blockers are cleared or explicitly mapped should a gated Customer App non-stock master-data mirror/import command be scoped. Inventory deduction and PO automation remain separate held phases.
