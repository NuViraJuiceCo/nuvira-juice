# G31C — Native production master-data gap closure preview

## Scope

G31C extends the read-only native production master-data parity preview with a seed-packet preview. It is intended to explain exactly which Recipe, Bundle, InventoryItem, and IngredientYield rows would still need mirror/import planning before native production and procurement can run without Hub.

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

G31C resolves those gaps only by read-only candidate analysis. It does not create the missing Hub rows or seed Customer App master data.

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

## Inventory stock policy

`InventoryItem.stock` is live operational state, not pure master data. G31C can include it in read-only preview context, but any future mirror/import phase must explicitly decide whether to seed stock values, zero them, or mirror only non-stock master-data fields.

## Expected next decisions

If G31C returns Hub-missing or owner-input rows, update/approve Hub master data first. If G31C returns alias rows, approve an explicit mapping before any Customer App import. Only after all rows are mirror-ready or explicitly mapped should a gated Customer App master-data mirror/import command be scoped.
