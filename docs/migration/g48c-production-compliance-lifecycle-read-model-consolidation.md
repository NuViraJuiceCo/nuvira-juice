# G48C: Production and compliance lifecycle read-model consolidation

## Executive summary

G48C consolidates production/compliance lifecycle reads behind the existing admin backend function:

```text
getAdminProductionPlanningSummary
```

The function now owns an additive, default-off, versioned admin read model for:

```text
ProductionBatch
→ BatchComplianceLog
→ production/compliance lifecycle read model
```

Final PR-prep classification:

```text
production_compliance_read_model_consolidation_pr_ready
```

The change does not alter production or compliance writes. The read model is only returned when:

1. the request explicitly asks for `read_model_mode=PRODUCTION_COMPLIANCE_LIFECYCLE`; and
2. the backend gate is enabled; and
3. the kill switch is not active.

When disabled, the existing production planning summary response remains unchanged and no extra production/compliance lifecycle entity reads are performed.

## G48A architecture decision

G48A decided that Hub retirement should proceed by building native operational backbone contracts instead of reproducing every Hub behavior one function at a time.

For production/compliance, the chosen direction is:

- one backend read-model owner;
- exact native identity links;
- admin pages consume the versioned contract;
- writes remain separately gated and unchanged;
- Hub fallback remains active until native evidence is complete.

## G48B/PACK1 packaging limitation

G48B-PACK1 proved that Base44 CLI `0.0.55` named function deployment collects files only from the selected function directory.

PACK1 classification:

```text
shared_function_module_packaging_unsupported
```

Implication for G48C:

- do not use `base44/functions/_shared`;
- do not copy helper logic into multiple functions;
- do not extend `previewNativeOrderCutoverReadiness` into a permanent read-model owner;
- use one existing function with a function-local helper.

PACK1 Case A support allows:

```text
base44/functions/getAdminProductionPlanningSummary/
  entry.ts
  productionComplianceReadModel.js
```

## Why getAdminProductionPlanningSummary owns this read model

`getAdminProductionPlanningSummary` is the correct owner because:

- it already owns native-first production planning reads;
- it already has an admin boundary;
- it can read `ProductionBatch` and `BatchComplianceLog` in one place;
- ComplianceOps can consume the backend contract instead of implementing matching;
- the helper is function-local and therefore deployable under PACK1;
- the function can preserve Hub fallback while adding native lifecycle context.

No new Base44 function was added.

## Current production/compliance data paths

### Production planning

Current path:

```text
src/pages/admin/ProductionPlanning.jsx
→ getAdminProductionPlanningSummary
→ native planning overlay + Hub fallback
```

The existing summary, date groups, ingredient rows, native overlay, and Hub fallback behavior are preserved.

### Compliance operations

Current path:

```text
src/pages/admin/ComplianceOps.jsx
→ getAdminComplianceOpsSummary
→ native compliance entities + Hub compliance fallback
```

`ComplianceOps` remains on this path by default.

G48C adds an optional admin UI query to `getAdminProductionPlanningSummary` only when the frontend build flag is enabled:

```text
VITE_ENABLE_ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL=true
```

When the flag is disabled, no new UI query runs and ComplianceOps renders as before.

### Compliance writes

These functions were not changed:

- `saveAdminComplianceRecord`
- `validateComplianceEntry`
- `verifyNativeProductionBatchesForCustomerApp`
- production lifecycle command functions
- compliance alert behavior
- notification behavior
- customer status cascades

## Function-local helper packaging contract

Helper:

```text
base44/functions/getAdminProductionPlanningSummary/productionComplianceReadModel.js
```

Entry import:

```ts
import { buildProductionComplianceLifecycleReadModel } from './productionComplianceReadModel.js';
```

The helper is pure. It receives preloaded rows and returns a versioned read model. It does not:

- query entities;
- write entities;
- call Hub;
- call providers;
- send notifications;
- create alerts;
- validate compliance entries;
- modify batches or logs.

All entity reads and authorization remain in `entry.ts`.

## Exact batch/log identity rules

The read model uses only exact supported identifiers.

Preferred linkage:

1. `BatchComplianceLog.production_batch_id` or `source_production_batch_id` to `ProductionBatch.id`.
2. `ProductionBatch.compliance_log_id` to `BatchComplianceLog.id`.
3. Exact `BatchComplianceLog.batch_id` to `ProductionBatch.batch_id`.

The model does not match by:

- product name alone;
- production date alone;
- operator/staff name;
- approximate units;
- newest log;
- closest timestamp;
- fuzzy batch labels.

If multiple logs match one batch, the row is review-held and not read-ready.

If link fields conflict, the row is review-held and not read-ready.

## Canonical read-model schema

Returned only when enabled and requested:

```text
production_compliance_lifecycle_read_model:
  read_model_version
  read_model_enabled
  source_mode
  read_only
  production_write_ready
  compliance_write_ready
  compliance_alert_expansion_ready
  notification_expansion_ready
  customer_facing_status_ready
  hub_write_suppression_ready
  summary
  classification_counts
  rows
  manual_batch_fallback_count
  warnings
```

Version:

```text
g48c_production_compliance_lifecycle_v1
```

Summary fields:

```text
production_batch_count
verified_batch_count
compliance_log_count
exact_batch_log_match_count
missing_log_count
duplicate_log_count
locked_verified_count
pH_missing_count
pass_fail_mismatch_count
status_mismatch_count
fallback_required_count
review_required_count
```

Row fields include:

```text
production_batch_ref
batch_id
product
production_date
planned_units
actual_units
production_status
actual_start_time_present
actual_end_time_present
compliance_log_present
compliance_log_match_count
compliance_log_ref
compliance_log_locked
pH_result
pH_passed
batch_passed
verified_at_present
verified_by_present
exact_identity_ready
native_read_ready
fallback_required
review_required
mismatch_categories
blockers
warnings
classification
```

Admin-safe internal references are returned only through the authenticated admin function response. Raw records, raw Hub payloads, provider identifiers, customer order details, and authentication/session data are not returned by the helper.

## Classifications

Supported row/classification values include:

```text
production_compliance_native_read_ready
production_compliance_native_read_partial
production_batch_missing_compliance_log
production_batch_duplicate_compliance_log_risk
production_batch_compliance_link_conflict
production_compliance_status_mismatch
production_compliance_ph_missing
production_compliance_pass_fail_mismatch
production_compliance_locked_verified
production_compliance_manual_batch_fallback
production_compliance_hub_fallback_required
production_compliance_review_required
production_compliance_repair_replay_hold
production_compliance_live_qc_proof_pending
```

Read readiness does not imply write readiness. The model always returns:

```text
production_write_ready=false
compliance_write_ready=false
compliance_alert_expansion_ready=false
notification_expansion_ready=false
customer_facing_status_ready=false
hub_write_suppression_ready=false
```

## ComplianceOps adoption contract

`ComplianceOps.jsx` now has a default-off optional query to `getAdminProductionPlanningSummary`.

It consumes the canonical backend model only when:

- `VITE_ENABLE_ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL=true`;
- the authenticated user is admin;
- the backend response includes `production_compliance_lifecycle_read_model`;
- `read_model_enabled=true`;
- `read_model_version=g48c_production_compliance_lifecycle_v1`.

When disabled, unavailable, incomplete, or unsupported:

- current `getAdminComplianceOpsSummary` behavior remains unchanged;
- Hub fallback remains available;
- valid existing compliance records remain visible;
- no write buttons/actions change;
- no customer-facing page changes.

The UI does not duplicate batch/log matching.

## Preserved write paths

G48C did not modify:

- `saveAdminComplianceRecord`
- `validateComplianceEntry`
- `verifyNativeProductionBatchesForCustomerApp`
- `startNativeProductionBatchesForCustomerApp`
- `completeNativeProductionBatchesForCustomerApp`
- `executeNativeProductionBatchLifecycle`
- compliance alerts
- notification behavior
- Hub writes
- customer status cascades

No displayed G48C row becomes writable through this phase.

## Default-off and fallback behavior

Backend gate names:

```text
ENABLE_ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL
ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL_KILL_SWITCH
```

Frontend build flag:

```text
VITE_ENABLE_ADMIN_PRODUCTION_COMPLIANCE_READ_MODEL
```

Default behavior:

- backend read model not returned;
- ComplianceOps does not call the production-planning read model;
- admin production planning remains unchanged;
- current compliance summary and Hub fallback remain unchanged;
- no new customer-facing behavior.

## Test coverage

Harness:

```text
scripts/migration/run-g48c-production-compliance-read-model-consolidation-tests.mjs
```

Covers:

- function-local helper import and packaging location;
- helper purity/no entity reads or writes;
- disabled response gating;
- exact batch/log linkage;
- reverse compliance-log linkage;
- duplicate log risk;
- conflicting link risk;
- missing compliance log;
- locked verified read-ready rows;
- unlocked log partial rows;
- missing pH hold;
- pH failure visibility;
- pass/fail mismatch;
- status mismatch;
- manual batch fallback;
- Hub fallback retained;
- repair/replay hold;
- empty and nonzero ranges;
- G37H/G31U write-path preservation;
- ComplianceOps default-off behavior;
- no writes/providers/notifications/Hub mutation;
- no raw payload/customer PII exposure.

## Publish plan

After merge:

1. Publish only `getAdminProductionPlanningSummary`.
2. Publish Web/admin UI only if Builder scope is clean and contains the G48C UI flag/path.
3. Keep backend and UI read model disabled.
4. Boundary-verify the function.
5. Verify existing production planning remains unchanged.
6. Smoke ComplianceOps with disabled fallback.
7. Run no-write verification.
8. Request separate limited activation only after an exact locked native batch/log pair is available.

Do not activate compliance writes, alerts, notifications, customer-facing status, or Hub suppression through G48C.

## Live QC proof requirement

G48C read readiness still depends on live QC evidence.

A row can be read-ready when it has:

- exact `ProductionBatch` ↔ `BatchComplianceLog` identity;
- a locked log;
- verified timestamp evidence;
- no duplicate/conflicting linkage;
- no repair/replay hold.

Write readiness remains false even for read-ready rows.

## Hub retirement criteria for this domain

Production/compliance Hub retirement is not approved by G48C.

Future retirement criteria:

- canonical read model live and stable;
- exact native batch/log pairs proven in production;
- ComplianceOps consumes backend contract under controlled activation;
- write commands remain separately authorized and exact;
- alert/notification expansion separately approved;
- customer status cascades separately approved;
- Hub fallback can be disabled safely per domain only after owner approval.

## No-write policy

Confirmed non-effects:

- no ProductionBatch mutation;
- no BatchComplianceLog mutation;
- no ManualProductionBatch mutation;
- no ComplianceAlert creation;
- no OperationalAlert creation;
- no CommandLog creation;
- no Hub mutation;
- no Stripe/Shopify/provider calls;
- no notifications/messages;
- no sync/repair/replay;
- no inventory deduction;
- no PurchaseOrder creation;
- no customer-facing status change;
- no Base44 or Builder publish during PR prep.

## Next package recommendation

After G48C closes and disabled behavior is published/smoked, the next work should be one of:

1. limited activation of the G48C read model for an exact locked verified native batch/log pair;
2. G48D admin operations dashboard consumption of canonical production/compliance read models;
3. another G48 domain package that does not depend on shared Base44 modules.
