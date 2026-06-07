# G31L — Gated Native ProductionBatch Materialization Command

## Purpose

G31L adds a default-off Customer App backend command that can materialize native `ProductionBatch` records from the live G31K read-only production demand materialization preview.

This phase is command preparation only. It does not approve or run live materialization.

## Command

Function:

- `materializeNativeProductionBatchesForCustomerApp`

Command type:

- `native_production_batch_materialization`

Confirmation phrase required for any future live run:

```text
materialize_native_production_batches_for_customer_app
```

## Exact target

The command is scoped to the already-previewed exact order only:

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`

## Default-off gates

The command must remain disabled unless all gates are intentionally configured:

```text
ENABLE_NATIVE_PRODUCTION_BATCH_MATERIALIZATION=true
NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH=false
NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ALLOWED_EMAILS=<admin/owner allowlist>
NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ORDER_ALLOWLIST=NV-MPZNKGNT
NATIVE_PRODUCTION_BATCH_MATERIALIZATION_POLICY=EXACT_PREVIEW_PACKET_ONLY
```

Default behavior:

- Disabled or kill-switched calls return a safe `409`.
- Public unauthenticated calls return `401`.
- Non-admin calls return `403`.
- No writes occur unless auth, gates, target checks, idempotency, and fresh preview validation all pass.

## Fresh preview requirement

Before any future write, the command invokes `previewNativeProductionDemandMaterialization` using the service-role function invocation pattern. It does not recursively self-fetch over HTTP.

The fresh G31K preview must still report:

- `production_ready: true`
- `materialization_ready: true`
- `blockers: []`
- `materialization_blockers: []`
- `writes_performed: false`
- `production_date: 2026-06-05`
- `delivery_date: 2026-06-06`
- exactly six proposed rows:
  - `Aura` — 1 unit
  - `Oasis` — 1 unit
  - `Pineapple Juice` — 1 unit
  - `Radiance Shot` — 1 unit
  - `Re-Nu` — 1 unit
  - `Reset Shot` — 1 unit

If the preview changes, the command fails closed before creating records.

## Future write scope

Allowed future writes, only after separate approval:

- Create schema-safe `ProductionBatch` rows for exact preview-approved rows.
- Create/update a safe `CommandLog` audit/idempotency record.

Not written by this command:

- Customer App Order
- native ShopifyOrder
- native FulfillmentTask
- Recipe / Bundle / InventoryItem / IngredientYield
- Inventory deduction / ingredient usage
- PurchaseOrder
- compliance logs
- ManualProductionBatch
- Hub records
- notifications
- provider calls
- sync / repair / replay
- customer-facing status

## Deterministic batch ids

The command uses deterministic ids to prevent duplicates:

```text
NATIVE-NV-MPZNKGNT-2026-06-05-AURA
NATIVE-NV-MPZNKGNT-2026-06-05-OASIS
NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE
NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT
NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU
NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT
```

## Dedupe and conflict behavior

Before creating any row, the command checks existing `ProductionBatch` records by:

- deterministic `batch_id`
- `product_name + production_date`
- existing order source linkage to the target order/native ids

Behavior:

- Exact existing native batch: skip/dedupe; do not create duplicate.
- Conflicting existing batch: return `409 production_batch_conflict`; `writes_performed: false`.
- Same product/date batch that would require updating an existing batch: blocked, because G31L create scope does not allow updates.

## Idempotency

- `request_id` is required.
- A successful or skipped `CommandLog` with the same idempotency key returns idempotent skipped success.
- A failed prior request id is not treated as success and is not reusable.
- Duplicate successful calls do not create duplicate `ProductionBatch` rows or duplicate success logs.

## Safety boundary

G31L is not live materialization approval. A future G31M approval is required before running a valid live command.

Post-publish verification for G31L should be limited to:

- auth boundary
- disabled/kill-switch boundary
- G31K read-only preview still works
- no records/logs are created

## Recommended next phase

If G31L publishes cleanly and disabled/auth boundaries pass, the next phase is:

```text
APPROVE G31M EXACT NATIVE PRODUCTIONBATCH MATERIALIZATION NV-MPZNKGNT
```

The future G31M run should snapshot target records and counts, configure gates for the exact order only, run one live command with a unique request id, run duplicate idempotency, close gates, and verify only the six approved planned `ProductionBatch` rows plus one safe `CommandLog` were created.
