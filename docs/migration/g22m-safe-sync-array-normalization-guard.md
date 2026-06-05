# G22M SafeSync Array Normalization Guard

Date: 2026-06-04

## Context

G22L completed the first owner-confirmed test-order native safeSync writer pilot against order `1009` / native `ShopifyOrder` id `6a1879c55f79664af02d1daf`.

The pilot succeeded and only approved metadata fields were accepted by the dry-run planner and audit logs. However, verification detected a watch item: `fulfillments` changed from an absent/null shape to an empty array even though `fulfillments` was not an accepted field and no fulfillment task was created.

This is likely Base44 schema normalization during an entity update. It was not customer-facing and did not create downstream operational records, but it must not be silent before any broader native writer pilot.

## Decision

G22M adds a fail-closed guard to `executeNativeSafeSyncOrderUpdate` for protected array fields:

- `line_items`
- `fulfillments`

For dry-runs, the function now returns `schema_normalization_risk` when an existing order update could materialize a missing protected array field even though the field is not accepted by the planner.

For live writer calls, the function now returns `409 schema_array_materialization_risk` before any write if:

- the planner would update an existing order
- a protected array field is absent/non-array on the existing record
- that protected array field is not explicitly included in the accepted field set

This means a future pilot cannot silently convert missing `fulfillments` or `line_items` shapes to empty arrays while claiming only unrelated metadata fields changed.

## Safety Boundary

This patch does not:

- enable the native safeSync writer
- open writer gates
- process real orders
- call Stripe
- call Shopify
- call providers
- send notifications
- create fulfillment tasks
- create production batches
- mutate inventory
- create purchase orders
- change checkout/payment behavior
- change Hub bridge behavior

The Hub remains fallback while native safeSync proceeds through explicit dark-launch and writer-pilot phases.

## Expected Behavior

If a future live writer pilot targets an existing record with protected arrays already stored as arrays, the guard should not block solely for array shape.

If a future pilot targets an existing record where `fulfillments` or `line_items` are missing/null and the planner did not explicitly accept that field, the pilot must stop with:

```json
{
  "success": false,
  "skipped": true,
  "error_code": "schema_array_materialization_risk",
  "writes_performed": false,
  "provider_calls_performed": false,
  "notifications_sent": false,
  "hub_bridge_modified": false
}
```

## Next Phase Recommendation

Before any ordinary real-customer native writer pilot:

1. Run dry-run candidate discovery with `schema_normalization_risk` included in the candidate report.
2. Prefer a candidate whose protected arrays are already explicitly stored as arrays.
3. If no safe candidate exists, create a separate schema-normalization/backfill plan before live native writer expansion.
4. Keep native writer gates disabled for real orders until an explicitly approved pilot passes this guard.
