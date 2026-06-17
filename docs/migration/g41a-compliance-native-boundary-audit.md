# G41A — Compliance native boundary audit

## 1. Executive summary

G41A is a docs-only/static/read-only audit of compliance-related native boundaries. It does not change runtime code, schemas, UI, Builder state, records, providers, notifications, inventory, PurchaseOrders, Hub records, or sync/retry/repair/replay behavior.

Conclusion: **do not call compliance fully migrated yet**.

The strongest native compliance path is the gated production verify/QC path:

- `verifyNativeProductionBatchesForCustomerApp` is retargeted to the exact G37H `NV-MQHJR3V2` pilot.
- It is designed to update exact completed-pending-verification `ProductionBatch` rows to `verified_logged`.
- It is designed to create one locked/safe `BatchComplianceLog` per verified batch.
- It records one safe `CommandLog`.
- Inventory deduction, PurchaseOrders, notifications, provider calls, and Hub mutation remain held.

But this path has not yet run live for `NV-MQHJR3V2`. Native compliance cannot be considered complete until at least one real production/QC run proves the end-to-end verify/log/admin-read boundary.

There is also a broader admin compliance operations surface (`ComplianceOps` + `saveAdminComplianceRecord`) that can create native compliance records and compliance alerts. That surface is admin-authenticated but is not governed by the same exact-order/default-off command gates as G37H production verification. It should remain controlled and should not be treated as a generalized migrated compliance write boundary without separate hardening.

## 2. Scope and method

Audited source areas:

- Base44 entity schemas:
  - `ProductionBatch`
  - `BatchComplianceLog`
  - `ComplianceAlert`
  - `OperationalAlert`
  - `ComplianceLog`
  - `pHLog`
  - related checklist/sanitation/CCP/corrective-action entities by reference
- Base44 functions:
  - `verifyNativeProductionBatchesForCustomerApp`
  - `completeNativeProductionBatchesForCustomerApp`
  - `previewNativeProductionVerifyCascades`
  - `getAdminComplianceOpsSummary`
  - `getAdminOpsAlertsSummary`
  - `getAdminProductionQueueSummary`
  - `saveAdminComplianceRecord`
  - `validateComplianceEntry`
  - `generateAuditPacket`
  - older Hub-backed admin verify wrappers by reference
- Admin/customer UI:
  - `src/pages/admin/ComplianceOps.jsx`
  - `src/components/compliance/*`
  - production queue/admin summary surfaces that display native compliance fields
- Harness/docs:
  - G31U verify command docs/harness
  - G31W post-verify cascade preview docs/harness
  - G37H verify retarget docs/harness
  - G38C production command boundary verification docs

No live endpoint was called. No write-capable UI action was clicked. No Builder publish was run.

## 3. Compliance surface inventory

| Surface | Type | Native coverage | Hub dependency | Write capable | Notes |
|---|---:|---:|---:|---:|---|
| `ProductionBatch` verification fields | Entity schema | Yes | No for exact native rows | Yes through gated lifecycle commands | Includes `status`, `actual_*`, `pH_result`, `pH_passed_failed`, `passed_failed`, `verified_by`, `verified_at`, `compliance_log_id`, `is_locked`, audit fields. |
| `BatchComplianceLog` | Entity schema | Yes | No for native rows | Yes | Admin RLS; G37H path creates locked logs; admin forms can also create batch logs. |
| `ComplianceLog` / `pHLog` / CCP / sanitation / checklist records | Entity schemas | Yes | Hub fallback still active in summary | Yes through admin compliance wrapper | Broader compliance ops records exist natively but are not exact-order gated. |
| `ComplianceAlert` | Entity schema | Yes | Hub fallback still active in alerts summary | Yes | Created by `validateComplianceEntry` and `saveAdminComplianceRecord` for out-of-range/failure cases. |
| `OperationalAlert` | Entity schema | Yes | Hub fallback still active in ops summary | Yes elsewhere | Displayed with ComplianceAlert in ops-alerts summary; not part of G37H verify. |
| `verifyNativeProductionBatchesForCustomerApp` | Command | Yes | No Hub mutation | Yes, default-off/gated | Exact G37H target only; creates BatchComplianceLog rows. |
| `completeNativeProductionBatchesForCustomerApp` | Command | Partial | No Hub mutation | Yes, default-off/gated | Completes batches but explicitly blocks verify/compliance fields/logs. |
| `previewNativeProductionVerifyCascades` | Preview | Yes | Hub fallback required warning | No | Read-only cascade readiness after verification/logging. |
| `getAdminComplianceOpsSummary` | Admin read summary | Yes | Yes, Hub primary/fallback merge | No direct writes | Reads native compliance entities and Hub compliance summary when configured. |
| `getAdminOpsAlertsSummary` | Admin read summary | Yes | Yes, Hub primary/fallback | No direct writes | Reads native `OperationalAlert`, `ComplianceAlert`, `OrderReviewQueue`; returns read-only alert summaries. |
| `ComplianceOps.jsx` and compliance forms | Admin UI | Yes | Hub fallback text remains | Yes through wrapper | Admin can create native compliance records via `saveAdminComplianceRecord`. |
| Customer-facing compliance exposure | Customer UI | Held | N/A | No | No customer-facing compliance status cutover is approved. |

## 4. Compliance domain classification table

| Domain | Current source of truth | Native entity coverage | Hub dependency | Admin-facing | Customer-facing | Write-capable | Default-off/gated | Preview coverage | Harness coverage | Live boundary verified | Classification | Known gaps |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1. ProductionBatch verification state | Native for exact G37 batches; Hub remains broader ops reference | Yes | No for exact native path | Yes | No | Yes | Yes for G37H command | Yes | Yes | Gates-closed verified | `native_write_gated` | No live verify yet for current pilot. |
| 2. BatchComplianceLog creation | Native | Yes | No for exact G37H logs | Yes | No | Yes | Yes for G37H; no for broad admin form | Yes | Yes | Gates-closed verified for G37H | `native_write_gated` | Broad admin creation path needs policy/boundary hardening. |
| 3. BatchComplianceLog locking | Native | Yes (`locked`) | No | Yes | No | Yes | Yes for G37H | Partial | Yes | Not live-proven for current pilot | `native_write_gated` | Need live audit of locked state after G37H. |
| 4. pH/QC/pass-fail capture | Native | Yes | No for exact G37H | Yes | No | Yes | Yes for G37H; broad forms admin-auth only | Yes | Yes | Gates-closed verified for G37H | `native_write_gated` | Needs real pH/pass-fail data after Friday production. |
| 5. Post-verify cascade previews | Native preview with Hub fallback warning | Yes | Hub fallback active | Yes | No | No | N/A | Yes | Yes | Read-only preview path exists | `native_preview_ready` | Cascade commands remain separate approval steps. |
| 6. Admin compliance visibility | Native + Hub summary | Yes | Yes | Yes | No | Forms are write-capable | No broad default-off gates | Read summary only | Partial | Not fully boundary-hardened | `hub_fallback_active` | UI combines read summaries with write forms; needs migration policy split. |
| 7. Compliance alerts | Native + Hub ops fallback | Yes | Yes | Yes | No | Yes | No exact alert gate | Read summary only | Partial | Not proven as exact migration write path | `alerting_partial` | Alert writes are not part of G37H and need separate approval/hardening. |
| 8. Operational alerts tied to compliance | Native fallback + Hub ops summary | Partial | Yes | Yes | No | Yes elsewhere | Not compliance-specific | Read summary only | Partial | Not G37-proven | `alerting_partial` | Do not expand alert automation without separate approval. |
| 9. Repair/replay/compliance backfill | Hub/manual governed | Partial | Yes | Admin/docs | No | Potentially yes in older tools | Not approved | Some previews/docs | Partial | Not approved live | `repair_replay_governed` | Keep held until a separate repair/backfill plan exists. |
| 10. Hub compliance fallback | Hub + native fallback merge | Yes for native summaries | Yes | Yes | No | No direct writes from read summary | N/A | Yes | Partial | Read behavior only | `hub_fallback_active` | Do not disable Hub fallback yet. |
| 11. Customer-facing exposure | Held | Not needed | N/A | No | No | No | N/A | N/A | N/A | N/A | `customer_facing_held` | No customer-facing compliance policy approved. |
| 12. Notification behavior | Held | N/A | N/A | Admin alerts only | No | Potential in other notification systems | No | N/A | N/A | Not approved | `customer_facing_held` | No compliance notifications without separate approval. |

## 5. Live-proven and pending G37 compliance path

Current G37/G41 carry-forward:

- G37H-BLOCK1 retargeted `verifyNativeProductionBatchesForCustomerApp` for `NV-MQHJR3V2`.
- The verify/QC command is boundary-safe with gates closed.
- No live verify has run for `NV-MQHJR3V2` yet.
- No `BatchComplianceLog` currently exists for `NV-MQHJR3V2` from the G37H path.
- Compliance remains pending until Friday physical production is completed and QC data is supplied.

Future allowed G37H writes, after separate exact approval:

1. Update exactly the two approved `ProductionBatch` rows from `completed_pending_verification` to `verified_logged`.
2. Create exactly two locked/safe `BatchComplianceLog` rows.
3. Create one safe `CommandLog`.

Still held:

- inventory deduction
- PurchaseOrder automation
- notifications
- provider calls
- Hub mutation
- customer-facing cascade
- pack/bottle/delivery/customer-status updates

## 6. Write-path audit

| Function | Write entity | Gate / kill switch | Policy / confirmation | Allowlist / target | Idempotency | Allowed writes | Forbidden writes | Boundary / harness status | Safe for exact controlled use? |
|---|---|---|---|---|---|---|---|---|---|
| `verifyNativeProductionBatchesForCustomerApp` | `ProductionBatch`, `BatchComplianceLog`, `CommandLog` | `ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY`, `NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH` | `EXACT_BATCH_VERIFICATION_DATA_ONLY`; `verify_native_production_batches_for_customer_app` | Exact `NV-MQHJR3V2` order/date/batch ids; actor/order/batch allowlists | request-id / `CommandLog` idempotency | Exact verified status/QC fields; locked safe logs; safe command log | Batch creation, order/task/native Shopify mutation, inventory, PO, notifications, providers, Hub, sync/repair/replay | G37H/G31U harness; G38C gates-closed boundary | Yes, only after Friday completion and exact QC approval. |
| `completeNativeProductionBatchesForCustomerApp` | `ProductionBatch`, `CommandLog` | Complete-production gate family | Exact complete policy/confirmation from G37G | Exact `NV-MQHJR3V2` target | request-id / `CommandLog` idempotency | Actual units/end time/completed status | Explicitly blocks verify/compliance fields/logs, inventory, PO, notifications, providers, Hub | G37G retarget; G38C boundary | Yes for completion only, not compliance logging. |
| `previewNativeProductionVerifyCascades` | None | Admin/auth preview | N/A | Target lookup | N/A | None | No pack/bottle/customer status/notification writes | G31W harness/docs | Read-only ready; not a write path. |
| `saveAdminComplianceRecord` | Temperature/pH/CCP/sanitation/checklist/corrective/batch/label/HACCP/compliance entities; may trigger alerts | Admin auth only | No exact migration policy gate found | Record-type payload, not exact order/batch target | Not command-log idempotent | Creates native compliance records; updates some review/checklist records | Does not send customer notification/provider call; can create alerts | UI-supported; not exact lifecycle-boundary verified | Controlled admin tool, but not sufficient for “fully migrated” compliance boundary. |
| `validateComplianceEntry` | `ComplianceAlert` | Authenticated staff/admin | No exact migration policy gate found | Log-type payload | No command idempotency found | Creates out-of-range alert | No notification/provider path found | Legacy/simple validation behavior | Needs separate alert policy before expansion. |
| `getAdminComplianceOpsSummary` | None | Admin auth | N/A | Date range | N/A | None | Read-only; sanitizes Hub/native summary | Admin summary path | Read-only safe; Hub fallback active. |
| `getAdminOpsAlertsSummary` | None | Admin auth | N/A | Filters/limit | N/A | None | Read-only; actions unavailable | Admin summary path | Read-only safe; Hub fallback active. |
| `generateAuditPacket` | File/export side effect only | Admin path by source context | N/A | Date/log types | N/A | Generates audit packet from compliance entities | Does not create compliance records | Existing admin export | Needs separate publish/smoke if changed; not changed here. |
| `verifyAdminProductionBatch` / `previewAdminProductionBatchVerify` | Hub-backed verify wrapper | Admin auth, Hub config | Hub command/preview | Hub production batch context | Hub-owned | Hub verify/log path | Customer App native boundary not primary | Legacy Hub-backed | Hub fallback/reference only. |

## 7. Compliance alerting audit

Native alert entities exist:

- `ComplianceAlert`
- `OperationalAlert`

Read visibility:

- `getAdminComplianceOpsSummary` reads `ComplianceAlert` and includes active compliance alerts in the native compliance summary.
- `getAdminOpsAlertsSummary` reads `OperationalAlert`, `ComplianceAlert`, and `OrderReviewQueue`, then returns safe read-only alerts. Native alert rows are marked `actions_available:false`.

Write paths:

- `validateComplianceEntry` creates `ComplianceAlert` when pH/temperature is out of range.
- `saveAdminComplianceRecord` may create `ComplianceAlert` directly for failed CCP records or invoke `validateComplianceEntry` for out-of-range temperature/pH.
- G37H `verifyNativeProductionBatchesForCustomerApp` does **not** create `ComplianceAlert`; it creates locked `BatchComplianceLog` rows only.

Notification/customer exposure:

- No compliance alert notification expansion is approved.
- No customer-facing compliance alert exposure is approved.
- Do not tie compliance alert creation to notifications without separate approval.

Classification:

```text
alerting_partial
```

## 8. Admin UI visibility audit

Admin surfaces:

- `ComplianceOps.jsx` shows native compliance summary counts, active alerts, lists of logs, and Hub fallback messaging.
- `ComplianceOps.jsx` contains write-capable tabs/forms for temperature, pH, CCP, sanitation, corrective actions, daily checklist, batch compliance, label/allergen review, and HACCP review.
- `ComplianceLogsParity` and audit packet components read `getAdminComplianceOpsSummary` and render production audit/binder views.
- `ProductionQueueSummary` can display native `ProductionBatch` lifecycle/QC fields such as `verified_by`, `verified_at`, `compliance_log_id`, `pH_result`, `pH_passed_failed`, and `passed_failed`.
- `OpsAlerts` receives read-only alert summaries through `getAdminOpsAlertsSummary`.

Important distinction:

- Compliance list cards are read-only, but record creation is available through forms.
- Admin forms write through `saveAdminComplianceRecord`, not the exact G37H lifecycle gate.
- `BatchComplianceLog` rows created through manual admin forms are not equivalent to G37H production verification unless linked and governed by the lifecycle command.

Known UI gaps:

- Admin UI does not clearly separate “manual compliance record entry” from “production lifecycle verify/QC record created by exact gated verify.”
- Locked log state is visible in some export/print contexts, but should be explicitly audited after the first live G37H verify.
- Missing compliance log / verified state is visible through previews and summaries, but broader operator guidance should remain in runbooks until the live proof exists.

## 9. Boundary hardening gap list

Before compliance can be called native-complete:

1. G37H live verify/QC has not yet run for the real active order.
2. The created `BatchComplianceLog` locked state has not yet been live-audited for `NV-MQHJR3V2`.
3. Post-verify cascade preview has not yet been run against verified/logged native batches.
4. Broad admin compliance write path is not exact-order/default-off gated.
5. Compliance alert creation policy is not scoped to the production lifecycle pilot.
6. Alert notification policy remains held.
7. Customer-facing compliance exposure policy is undefined and held.
8. Repair/replay/backfill compliance writes remain Hub/manual-review governed.
9. Subscription and multi-delivery compliance contexts remain Hub-owned or unproven natively.
10. Historical compliance backfill policy is not approved.
11. Broader/generalized QC path beyond exact G37H target is not proven.
12. Admin UI needs clearer distinction between manual compliance entries and lifecycle-generated verification logs.

## 10. Recommended compliance migration sequence

1. Keep G37H exact verify/QC for `NV-MQHJR3V2` as the first real live native compliance proof.
2. After Friday physical production completes, supply exact QC data and run G37H only with separate exact approval.
3. Verify exactly two `BatchComplianceLog` rows are created, locked, safe, and linked to the exact `ProductionBatch` rows.
4. Run post-verify cascade preview only.
5. Audit `getAdminComplianceOpsSummary`, `ComplianceOps`, production queue, and audit packet views against the resulting native logs.
6. Add native-first admin diagnostics if locked/logged state is not clear enough.
7. Keep alert/notification expansion held.
8. Keep compliance repair/replay/backfill held.
9. Only after one clean live QC and admin-read verification, consider broader compliance native boundary work.

## 11. Hard stops

- No live verify without actual pH/pass-fail/batch-pass data.
- No inferred QC data.
- No `BatchComplianceLog` creation outside approved gated verify/QC or controlled admin compliance entry.
- No compliance alert expansion unless explicitly approved.
- No notifications.
- No customer-facing status changes.
- No inventory deduction.
- No PurchaseOrder automation.
- No Hub mutation.
- No repair/replay/backfill compliance writes.
- No broad verify/QC command beyond exact targets.
- No subscription/multi-delivery compliance cutover.
- No disabling Hub fallback.
- No suppressing Hub writes/fallback behavior.

## 12. Recommendation

Do not call compliance fully migrated yet.

Current recommended classification:

```text
compliance_native_boundary_partially_ready_pending_live_qc_proof
```

Use G37H live verify/QC as the first real proof after Friday physical production is started, completed, and QC data is supplied. Keep alerts, notifications, repair/replay, backfill, subscription/multi-delivery, and customer-facing compliance exposure held until separate approval and boundary hardening.
