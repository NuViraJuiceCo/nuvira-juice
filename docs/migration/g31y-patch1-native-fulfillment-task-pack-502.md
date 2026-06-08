# G31Y-PATCH1 — Native FulfillmentTask Pack 502 hardening

Date: 2026-06-08

## Scope

G31Y-PATCH1 diagnoses and patches `packNativeProductionFulfillmentTaskForCustomerApp` after the first G31Y live attempt returned an unstructured HTTP 502 before any mutation.

This patch does not run the pack command and does not mutate live records.

## Target

- Order number: `NV-MPZNKGNT`
- Customer App Order id: `6a219a3f4adcda5856c3d579`
- Native ShopifyOrder id: `6a22ffda400eb806eb3ca945`
- Native FulfillmentTask id: `6a22ffdaf675ea79e30575aa`
- Production date: `2026-06-05`
- Delivery date: `2026-06-06`
- Prior failed request id: `g31y_native_pack_fulfillment_task_nvmpzngnt_20260608T172335Z`

Do not reuse the prior failed request id for a future successful attempt.

## Root-cause classification

The failed G31Y call returned HTTP 502 with no handled command response and no `CommandLog`. Live state stayed unchanged. Base44 logs for the pack function and cascade preview showed only isolate startup lines, not a command-level safe error.

The most likely cause is a Base44 runtime/platform timeout or service-invocation failure around the command's internal fresh `previewNativeProductionVerifyCascades` invocation. The command used `base44.asServiceRole.functions.invoke`, not recursive HTTP self-fetch, but the live result was still outside the command's structured error path.

## Patch behavior

G31Y-PATCH1 changes the default live validation path to avoid depending on an internal function invocation before the task update.

Default validation now uses direct local preflight reads for the exact target context:

- Customer App Order exists and is paid/captured.
- Native ShopifyOrder exists and is not canceled/refunded.
- Exact native FulfillmentTask exists and is pack-eligible.
- Delivery lifecycle has not advanced.
- Six exact `ProductionBatch` rows exist and are `verified_logged`.
- Six matching `BatchComplianceLog` rows are readable.
- Customer-facing order status, notifications, ShopifyOrder bottle/pack, delivery/proof/drop/route, inventory, PO, provider/payment, sync/repair/replay, and Hub remain held.

The command builds a local dry-run readiness packet from those reads and validates it with the same preview validator. This is marked with:

- `g31y_patch1_safe_pack_command_error_handling`
- `preview_source: local_preflight`

The older service-preview helper remains available only if explicitly opted in with `NATIVE_FULFILLMENT_TASK_PACK_USE_SERVICE_PREVIEW=true`. If that path fails, it now returns a structured response instead of allowing an unhandled 502-style failure.

## Safe error handling added

Structured failure handling now covers:

- preview/service invocation failure: `native_fulfillment_task_pack_preview_failed`
- preview timeout: `native_fulfillment_task_pack_preview_timeout`
- validation failure: 409 with safe blockers and `writes_performed:false`
- CommandLog create failure before task update: structured 500 with `writes_performed:false`
- task update failure: structured failed CommandLog attempt and `writes_performed:false`
- CommandLog finalization failure after task update: structured `reconciliation_required:true` response with `writes_performed:true`

No raw payloads, secrets, provider/payment payloads, full customer PII, stack traces, or auth headers are returned.

## Pack write scope remains unchanged

Future live execution may write only:

- `FulfillmentTask.status = packed`
- `FulfillmentTask.production_status = packed`
- `FulfillmentTask.packed_at`
- `FulfillmentTask.command_log_id`
- safe `FulfillmentTask.audit_trail`
- one safe `CommandLog`

Still forbidden:

- Customer App Order updates
- native ShopifyOrder updates
- delivery status changes
- proof/drop/route writes
- ProductionBatch updates
- BatchComplianceLog creates/updates
- inventory deduction
- PurchaseOrder creation
- provider/payment/notification calls
- sync/retry/repair/replay
- Hub mutations

## Gating remains default-off

The G31X/G31Y gates remain unchanged:

- `ENABLE_NATIVE_FULFILLMENT_TASK_PACK`
- `NATIVE_FULFILLMENT_TASK_PACK_KILL_SWITCH`
- `NATIVE_FULFILLMENT_TASK_PACK_ALLOWED_EMAILS`
- `NATIVE_FULFILLMENT_TASK_PACK_ORDER_ALLOWLIST`
- `NATIVE_FULFILLMENT_TASK_PACK_TASK_ALLOWLIST`
- `NATIVE_FULFILLMENT_TASK_PACK_POLICY=EXACT_VERIFIED_ORDER_TASK_ONLY`

## Next step

After publish and boundary verification, request a new explicit G31Y retry approval with a new request id. Do not reuse `g31y_native_pack_fulfillment_task_nvmpzngnt_20260608T172335Z`.
