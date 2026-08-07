# G41B: Admin compliance native read-parity preview

## 1. G41A findings

G41A classified the compliance boundary as:

```text
compliance_native_boundary_partially_ready_pending_live_qc_proof
```

That remains the carry-forward state. Native compliance entities and admin read surfaces exist, but the migration is not ready for write expansion or customer-facing status changes. The strongest compliance proof still requires real locked QC evidence from approved production flow, especially `NV-MQHJR3V2` if the separately approved G37F/G37G/G37H sequence has occurred.

G42B is closed as:

```text
admin_delivery_action_readiness_no_clean_command_candidates
```

Delivery action migration remains held. Hub delivery actions stay active. Apple Pay production payments remain blocked under:

```text
apple_pay_deferred_intent_backend_blocked_by_platform_atomicity
```

PR #545 remains draft, blocked, unmerged, and unpublished.

## 2. ComplianceOps data path

The admin Compliance Operations page is `src/pages/admin/ComplianceOps.jsx`.

Current read path:

```text
ComplianceOps.jsx
→ getAdminComplianceOpsSummary
→ native Customer App entities
→ Hub compliance summary fallback when configured
```

`ComplianceOps.jsx` also renders the compliance tabs and dashboard components. The page displays native compliance summary details while stating that Hub compliance remains available as fallback.

The audit found these relevant native read entities:

- `ProductionBatch`
- `BatchComplianceLog`
- `ComplianceAlert`
- `OperationalAlert`
- `ManualProductionBatch`
- `ComplianceLog`
- other form-specific compliance logs used by `getAdminComplianceOpsSummary`

The write paths remain separate from this preview:

- `saveAdminComplianceRecord`
- `validateComplianceEntry`
- `verifyNativeProductionBatchesForCustomerApp`
- `executeNativeProductionBatchLifecycle`
- `startAdminProductionBatch`
- `completeAdminProductionBatch`
- `verifyAdminProductionBatch`

G41B does not call any of those write paths.

## 3. Native / Hub source-of-truth map

| Surface | Current behavior | G41B treatment |
| --- | --- | --- |
| ComplianceOps summary | Native summary with Hub fallback | Preserve. Read-only preview only. |
| Batch QC proof | Native `ProductionBatch` plus locked `BatchComplianceLog` | Exact parity candidate only when exact batch/log agreement exists. |
| Alerts | Native `ComplianceAlert` context | Read-only context. No alert creation or resolution. |
| Repair/replay evidence | Command/audit metadata may indicate manual-review risk | Read-only hold marker. No repair/replay/backfill. |
| Customer-facing compliance impact | Held | Unchanged. No status cascade. |
| Hub fallback | Active | Unchanged. No suppression. |

G41B does not call the Hub externally. Hub fallback remains active through the existing admin summary path.

## 4. Exact batch/log identity contract

G41B extends `base44/functions/previewNativeOrderCutoverReadiness/entry.ts` with:

```text
preview_mode=ADMIN_COMPLIANCE_OPERATIONS_READ_PARITY
```

Supported modes:

```text
EXACT_COMPLIANCE_RECORD_PARITY
BOUNDED_COMPLIANCE_READINESS_SCAN
```

Exact preview accepts exact identifiers only:

- `production_batch_id`
- `batch_id`
- `batch_compliance_log_id`
- `compliance_log_id`

Exact matching uses only:

- `ProductionBatch.id`
- `ProductionBatch.batch_id`
- `ProductionBatch.compliance_log_id`
- `BatchComplianceLog.id`
- `BatchComplianceLog.batch_id`
- `BatchComplianceLog.source_production_batch_id`

It does not match by:

- product name alone
- production date alone
- operator/staff name
- approximate quantity
- newest record selection
- raw notes or free-text payloads

A native read candidate requires one exact `ProductionBatch`, one compatible `BatchComplianceLog`, and no duplicate identity risk.

## 5. Bounded scan strategy

`BOUNDED_COMPLIANCE_READINESS_SCAN` performs one bounded read per source and joins in memory:

- `ProductionBatch`
- `BatchComplianceLog`
- `ComplianceAlert`
- `OperationalAlert`
- `ManualProductionBatch`
- `CommandLog`

Default requested limits are bounded and clamped. The scan returns:

- `unique_batch_count`
- `verified_batch_count`
- `compliance_log_count`
- `exact_batch_log_match_count`
- `missing_log_count`
- `duplicate_log_count`
- `locked_log_ready_count`
- `status_mismatch_count`
- `pH_missing_count`
- `pass_fail_mismatch_count`
- `alert_context_count`
- `native_read_candidate_count`
- `Hub_fallback_required_count`
- `review_required_count`
- `repair_replay_hold_count`
- `classification_counts`
- `source_read_count`
- `source_row_counts`
- `source_truncated`
- `scan_complete`
- `rate_limit_detected`

If any required source is truncated or fails, G41B returns `scan_complete:false` and does not claim fleet-wide readiness. Exact follow-up remains required.

## 6. Live QC-proof status

A read-ready batch/log pair requires:

- exact `ProductionBatch` match
- exact linked `BatchComplianceLog` match
- locked compliance log
- pH result present
- pH pass/fail safe state present
- batch pass/fail safe state present
- verification timestamp presence
- verified-by presence without exposing the email in broad summaries
- no duplicate log risk
- no batch/log status mismatch
- no pass/fail mismatch
- no repair/replay hold

Until real locked QC evidence exists, classify as:

```text
compliance_live_qc_proof_pending
```

## 7. Customer-facing holds

G41B does not change customer-facing behavior.

Held:

- Customer App order status updates
- tracker/history status cascades
- notifications/messages
- post-verify customer-status cascade
- delivery or production customer-visible wording changes

The response explicitly includes:

```text
customer_facing_status_unchanged=true
customer_facing_behavior_changed=false
```

## 8. Write-path holds

G41B is read-only and admin-only.

Held write functions:

- `saveAdminComplianceRecord`
- `validateComplianceEntry`
- `verifyNativeProductionBatchesForCustomerApp`
- `executeNativeProductionBatchLifecycle`

Hard no-write guarantees:

- no `ProductionBatch` create/update
- no `BatchComplianceLog` create/update
- no `ComplianceAlert` create
- no `CommandLog` create
- no Hub mutation
- no notifications
- no provider calls
- no sync/repair/replay/backfill
- no customer order/task mutation
- no inventory deduction
- no PurchaseOrder creation

## 9. Test coverage

Added fixture harness:

```text
scripts/migration/run-g41b-admin-compliance-read-parity-tests.mjs
```

Coverage includes:

1. Admin auth required.
2. Exact `ProductionBatch` resolves.
3. Exact compliance log resolves.
4. Missing log classified safely.
5. Duplicate log blocks readiness.
6. Incorrect batch linkage blocks readiness.
7. Verified/locked batch-log pair is read-ready.
8. Missing pH result holds.
9. pH failure is represented safely.
10. Batch/log pass mismatch holds.
11. Status mismatch holds.
12. Alert context reported.
13. Hub context unavailable does not imply parity.
14. Repair/replay evidence holds.
15. Customer-facing status remains unchanged.
16. Bounded scan uses one read per source.
17. Source truncation prevents fleet-wide claims.
18. No PII/raw notes returned.
19. No `ProductionBatch` mutation.
20. No `BatchComplianceLog` mutation.
21. No `ComplianceAlert` creation.
22. No notifications.
23. No Hub mutation.
24. No customer/order/task mutation.
25. No provider calls.
26. No logs/queues created.

## 10. Recommendation

Do not migrate ComplianceOps writes or alerts.

Proceed toward limited native-first ComplianceOps reads only if exact locked batch/log candidates exist and exact preview confirms:

```text
compliance_native_read_ready
```

Keep Hub fallback active. Keep customer-facing compliance effects held. Keep all verify/QC write commands separately approved and gated.
