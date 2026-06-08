# G31U Native Production Verify Command Prep

Date: 2026-06-08

## Scope

G31U prepares native Verify Production for the exact `NV-MPZNKGNT` pilot batches. It is PR/publish prep only. No live verify command is run in G31U.

Target order context:

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`

Target batches:

- `NATIVE-NV-MPZNKGNT-2026-06-05-AURA`
- `NATIVE-NV-MPZNKGNT-2026-06-05-OASIS`
- `NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE`
- `NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT`
- `NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU`
- `NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT`

## Audit findings

Customer App `ProductionBatch` supports the native v1 verify fields:

- `status` enum includes `completed_pending_verification` and `verified_logged`.
- `verified_at` and `verified_by` are supported.
- `pH_result` is a number.
- `pH_passed_failed` is a string enum: `passed` / `failed`.
- `passed_failed` is a string enum: `passed` / `failed`.
- `compliance_log_id` is available on the batch schema.
- `audit_trail` and `command_log_ids` are already used by prior native lifecycle commands.

Customer App `BatchComplianceLog` is schema-clear for v1:

- required: `date`, `batch_id`, `juice_flavor`, `quantity_produced`, `passed_failed`.
- supports: `ingredients`, `start_time`, `end_time`, `staff_on_duty`, `pH_result`, `notes`, `verified_by`, `verified_at`, `source_production_batch_id`, `locked`.

Hub verify flows include verify/log/cascade concepts, but G31U intentionally keeps native v1 verify separate from downstream cascades.

## Verification data contract

G31U adds dry-run validation for verification data in `previewNativeProductionBatchLifecycle`.

Supported preview/command input forms:

```json
{
  "verification_data": {
    "pH_result": 3.7,
    "pH_passed": true,
    "batch_passed": true,
    "verification_notes": "optional safe note"
  }
}
```

or exact per-batch data:

```json
{
  "verification_data_by_batch_id": {
    "NATIVE-NV-MPZNKGNT-2026-06-05-AURA": {
      "pH_result": 3.7,
      "pH_passed": true,
      "batch_passed": true
    }
  }
}
```

Rules:

- exact six batch ids are required for live command input.
- current batch status must be `completed_pending_verification`.
- `actual_units` and `actual_end_time` must already exist.
- `pH_result` must be numeric.
- `pH_passed` / `pH_passed_failed` must normalize to `passed` or `failed`.
- `batch_passed` / `passed_failed` must normalize to `passed` or `failed`.
- already verified, locked, archived, or compliance-logged batches block.
- missing or invalid data blocks before write.

Suggested future owner approval format:

```text
APPROVE G31V EXACT NATIVE VERIFY PRODUCTION NV-MPZNKGNT
verification_data_by_batch:
- NATIVE-NV-MPZNKGNT-2026-06-05-AURA:
    pH_result=
    pH_passed=
    batch_passed=
- NATIVE-NV-MPZNKGNT-2026-06-05-OASIS:
    pH_result=
    pH_passed=
    batch_passed=
- NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE:
    pH_result=
    pH_passed=
    batch_passed=
- NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT:
    pH_result=
    pH_passed=
    batch_passed=
- NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU:
    pH_result=
    pH_passed=
    batch_passed=
- NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT:
    pH_result=
    pH_passed=
    batch_passed=
```

## Compliance log decision

G31U includes schema-safe `BatchComplianceLog` creation in the future live command contract:

- one `BatchComplianceLog` per verified batch.
- no raw payloads.
- no customer PII.
- includes product, batch id, production date, actual units, pH result, pass/fail status, verifier, timestamp, and source ProductionBatch id.
- links the created log id to `ProductionBatch.compliance_log_id`.

The command validates all rows and the fresh preview before any write. Base44 does not provide an explicit multi-entity transaction here, so the command records a failed `CommandLog` with partial counts if a write error occurs after some compliance logs or batch updates. Live execution still requires separate exact approval.

## Cascade decision

G31U keeps cascades held:

- no FulfillmentTask pack cascade.
- no native ShopifyOrder bottled cascade.
- no Customer App Order status change.
- no customer-facing status change.
- no notification.
- no sync/retry/repair/replay.

Separate preview/command phases are required before any pack, bottle, delivery, route/proof/drop, or customer-facing mutation.

## Gated command

Function: `verifyNativeProductionBatchesForCustomerApp`

Default gate state:

- disabled.
- kill switch active.
- no writes.

Gate names:

- `ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY`
- `NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH`
- `NATIVE_PRODUCTION_BATCH_VERIFY_ALLOWED_EMAILS`
- `NATIVE_PRODUCTION_BATCH_VERIFY_ORDER_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_VERIFY_BATCH_ALLOWLIST`
- `NATIVE_PRODUCTION_BATCH_VERIFY_POLICY`

Required policy:

- `EXACT_BATCH_VERIFICATION_DATA_ONLY`

Confirmation phrase:

- `verify_native_production_batches_for_customer_app`

Allowed future writes only:

- exact six `ProductionBatch` rows.
- one `BatchComplianceLog` per batch.
- one safe `CommandLog`.

Explicitly not written:

- Customer App Order.
- native ShopifyOrder.
- native FulfillmentTask.
- Recipe / Bundle / InventoryItem / IngredientYield.
- InventoryItem stock.
- PurchaseOrder.
- OrderSyncLog / OrderReviewQueue / SafeSyncParityLog.
- Hub records.
- provider/payment/notification/cascade fields.

## G31U no-live-execution confirmation

G31U does not run the live verify command, does not open verify gates, and does not mutate live records.
