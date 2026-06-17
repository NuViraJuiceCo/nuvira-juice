# G42A: Delivery Queue action migration audit

## 1. Executive summary

G42A is a docs-only/static/read-only audit of Delivery Queue actions, route workflow actions, and customer delivery status boundaries.

Current state:

- `getAdminDeliveryRouteSummary` is native-first live from G39D and remains admin-only/read-only.
- `/admin/delivery-queue` now reads native `FulfillmentTask` / `ShopifyOrder` rows first, with Hub fallback/context when needed.
- Delivery write actions are not fully migrated. Native task lifecycle preview/write scaffolding exists, but the broad delivery action migration is not approved.
- Legacy admin action wrappers still call Hub functions for assignment, out-for-delivery, and delivered actions when a row is Hub-backed rather than native-backed.
- Customer-facing delivery status, proof/drop fields, notifications, Hub push/export, route optimization provider calls, and repair/replay remain held.

Classification:

```text
delivery_actions_partially_native_read_ready_write_migration_required
```

Recommendation: do not run delivery actions yet. Use this audit to plan exact default-off native delivery action replacements after G37H live QC proof and post-verify cascade preview.

## 2. Scope and method

Audited source areas:

- `src/pages/admin/DeliveryQueue.jsx`
- `base44/functions/getAdminDeliveryRouteSummary/entry.ts`
- `base44/functions/previewNativeFulfillmentTaskLifecycle/entry.ts`
- `base44/functions/executeNativeFulfillmentTaskLifecycle/entry.ts`
- `base44/functions/updateAdminFulfillmentTaskAssignment/entry.ts`
- `base44/functions/markAdminFulfillmentTaskOutForDelivery/entry.ts`
- `base44/functions/recordAdminFulfillmentTaskDelivered/entry.ts`
- `base44/functions/optimizeDeliveryRoute/entry.ts`
- `base44/functions/syncHubDeliveryStatuses/entry.ts`
- `base44/functions/hubToCustomerAppStatusSync/entry.ts`
- `base44/functions/pushOrderStatusToHub/entry.ts`
- `base44/functions/previewNativeDeliveryWorkflowReadiness/entry.ts`
- `base44/functions/previewNativeDeliveryCompletionReconciliation/entry.ts`
- `base44/functions/reconcileNativeDeliveryCompletionForCustomerApp/entry.ts`
- `base44/functions/previewNativeCustomerDeliveredStatusImpact/entry.ts`
- `base44/functions/updateNativeCustomerOrderDeliveredStatusForCustomerApp/entry.ts`
- `base44/entities/FulfillmentTask.jsonc`
- `base44/entities/ShopifyOrder.jsonc`
- `base44/entities/Order.jsonc`
- `base44/entities/CustomerMessageDeliveryLog.jsonc`
- delivery migration docs and harness names around G32/G39.

This audit did not run live commands, did not call providers, did not open gates, did not publish Base44, and did not mutate records.

## 3. Delivery action inventory

| Category | File/function | Surface | Read/write | Native touched | Hub touched | Provider touched | Notification touched | Current gates/idempotency | Source of truth | Known blockers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin route summary read | `getAdminDeliveryRouteSummary` | Admin `/admin/delivery-queue` | Read-only | Reads `FulfillmentTask`, `ShopifyOrder` | Reads Hub delivery summary fallback | No | No | Admin auth; no write gate needed | Native-first with Hub fallback | Read surface is ready; write actions still separate |
| Native delivery queue UI | `DeliveryQueue.jsx` | Admin | Mixed: read plus buttons | Native rows use native preview/write panels | Hub-backed rows use legacy wrappers | Route preview may call Google when enabled | UI text says notifications are separate | Native panels use request ids; legacy wrappers pass request ids | Mixed native/Hub | Broad action migration not complete |
| Driver assignment - Hub-backed rows | `updateAdminFulfillmentTaskAssignment` | Admin button | Write-capable wrapper | No native write | Calls Hub `updateFulfillmentTaskAssignmentForCustomerApp` | No | No direct notification | Hub handles idempotency by request id if supported | Hub primary write | Needs native equivalent or suppression/shadow plan |
| Out-for-delivery - Hub-backed rows | `markAdminFulfillmentTaskOutForDelivery` | Admin button | Write-capable wrapper | No native write | Calls Hub `markFulfillmentTaskOutForDeliveryForCustomerApp` | No | No direct notification | Hub handles idempotency by request id if supported | Hub primary write | Needs native exact command before migration |
| Delivered - Hub-backed rows | `recordAdminFulfillmentTaskDelivered` | Admin button | Write-capable wrapper | No native write | Calls Hub `recordFulfillmentTaskDeliveredForCustomerApp` | No | No direct notification | Hub handles idempotency by request id if supported | Hub primary write | Proof/drop policy missing for native delivered |
| Native task lifecycle preview | `previewNativeFulfillmentTaskLifecycle` | Admin native panel | Read-only dry-run | Drafts `FulfillmentTask` lifecycle patches | No Hub mutation | No | No | No write gate; returns draft/readiness only | Native preview | Needs exact post-G37H pilot before controlled use |
| Native task lifecycle execute | `executeNativeFulfillmentTaskLifecycle` | Admin native panel | Write-capable | Updates `FulfillmentTask` plus safe `CommandLog` | No | No | No | `ENABLE_NATIVE_FULFILLMENT_TASK_LIFECYCLE_WRITES`, kill switch, allowed emails, task allowlist, allowed actions, confirmation, request id idempotency | Native write command exists | Not exact-order scoped; proof/drop/customer status held; no ShopifyOrder/Order cascade |
| Assign/confirm delivery date | schedule correction/materialization panels | Admin native panels | Write-capable if gates open | Native order/task schedule or task creation | No | No | No | Existing exact-gated native schedule/materialization functions | Native write command exists for schedule/task prep | Not a delivery action completion substitute |
| Route optimization preview | `optimizeDeliveryRoute` | Admin/driver route panel | Read/provider call | Can use explicit stop payload; no route save | No mutation | Google Routes API if enabled | No | `ENABLE_DELIVERY_ROUTE_OPTIMIZATION`; legacy fetch separately gated | Preview/provider dependency | Provider call held for migration; no persisted route order |
| Customer delivery status display | customer order/tracker functions and `Order` schema | Customer-facing | Read | Reads `Order` status/delivery fields | Hub fallback/status sync may influence | No | Possible status notification automation elsewhere | Not part of Delivery Queue action command | Mixed native/Hub during migration | Customer status cutover held |
| Hub delivery sync/import | `syncHubDeliveryStatuses` | Scheduled/system | Write-capable if enabled | Updates `Order.status`, `status_history`, delivered proof/drop if Hub says delivered | Reads Hub | No | Entity automation can notify after `Order` status update | `ENABLE_HUB_DELIVERY_STATUS_SYNC`; idempotent by diff | Hub source for scheduled status readback | Can create customer-facing side effects; keep held/controlled |
| Hub status dry-run reconciliation | `hubToCustomerAppStatusSync` | Admin/system | Dry-run only; live disabled | Would diff Customer App `Order` | Reads Hub | No | No direct notification in dry-run | live writes return `DEPRECATED_LIVE_WRITE_DISABLED` | Hub comparison only | Not a replacement for native delivery action migration |
| Hub status push/export | `pushOrderStatusToHub` | Legacy driver/status bridge | Write-capable if enabled | Updates `DriverActionLog`, creates `OrderSyncLog` on sync result | Pushes driver action to Hub | No | No direct notification | `ENABLE_LEGACY_DRIVER_STATUS_HUB_PUSH`; idempotency key built from action/timestamp | Customer App recovery source -> Hub | Broad legacy bridge; disabled by default for freeze |
| Delivery workflow readiness | `previewNativeDeliveryWorkflowReadiness` | Admin/readiness | Read-only | Reads native order/task/batches/logs | Reads Hub fallback context | No | No | Preview auth/secret; writes_performed false | Native/Hubsafe preview | Target defaults remain old pilot; needs exact G37 target use/retarget before live pilot |
| Delivery completion reconciliation preview | `previewNativeDeliveryCompletionReconciliation` | Admin/readiness | Read-only | Reads `Order`, `ShopifyOrder`, `FulfillmentTask`, production/compliance context | Reads Hub where needed | No | No | Preview auth/secret; writes_performed false | Native/Hubsafe preview | Direct delivered reconciliation needs actual delivered timestamp and proof/drop policy |
| Delivery completion reconciliation write | `reconcileNativeDeliveryCompletionForCustomerApp` | Admin command | Write-capable exact command | Updates native `FulfillmentTask`, native `ShopifyOrder`, safe `CommandLog` | No Hub mutation | No | No | Default-off gate, kill switch, allowlists, policy, confirmation, request id idempotency | Native exact command exists for old pilot | Hardcoded prior pilot `NV-MPZNKGNT`; not retargeted for `NV-MQHJR3V2` |
| Customer delivered status preview | `previewNativeCustomerDeliveredStatusImpact` | Admin/readiness | Read-only | Reads customer/native task/order/batch/compliance/log context | No mutation | No | Counts notifications/messages only | Preview auth/secret; writes_performed false | Native/customer status preview | Hardcoded prior pilot; current G37 target not retargeted |
| Customer delivered status write | `updateNativeCustomerOrderDeliveredStatusForCustomerApp` | Admin command | Write-capable exact command | Updates Customer App `Order.status`/history only | No Hub mutation | No | Explicit NO_NOTIFICATION | Default-off gate, kill switch, allowlists, policy, confirmation, request id idempotency | Native customer status command exists for old pilot | Hardcoded prior pilot; not approved for G37 target |
| Notification/message delivery | `sendOrderStatusNotification`, `sendUpcomingDeliveryNotifications`, `CustomerMessageDeliveryLog` | System/customer | Write-capable | Creates notification/message rows | May be triggered by status sync | Provider may be downstream | Yes | Separate policies/gates vary by function | Held | Must remain separate from delivery action migration |
| Repair/replay/backfill delivery status | G32/G35 preview/repair functions | Admin/system | Mixed | Native/customer records depending command | Hub read/fallback | No | Held | Exact command gates vary | Governed/manual-review | Not part of broad Delivery Queue migration |

## 4. Action classification table

| Action/domain | Classification | Notes |
| --- | --- | --- |
| Admin route summary read | `native_read_ready` | G39D made route summary native-first with Hub fallback and no writes. |
| Delivery Queue route cards | `native_read_ready`, `hub_fallback_active` | Native rows show native actions; Hub fallback rows still expose Hub wrappers. |
| Assign/reassign/unassign native task | `native_write_command_exists`, `blocked_by_missing_boundary` | Native lifecycle command can update `FulfillmentTask`, but exact delivery pilot/boundary is not approved. |
| Assign/reassign/unassign Hub-backed row | `hub_primary_write` | Uses Hub wrapper functions. |
| Mark out-for-delivery native task | `native_write_command_exists`, `exact_controlled_pilot_ready`, `blocked_by_customer_status_policy` | Native lifecycle command supports task-only write; customer status and notification remain held. |
| Mark out-for-delivery Hub-backed row | `hub_primary_write` | Wrapper calls Hub action. |
| Mark delivered native task | `native_write_command_exists`, `proof_drop_policy_missing`, `blocked_by_customer_status_policy` | Native lifecycle delivered action is operational-only and excludes proof/drop/customer status. |
| Mark delivered Hub-backed row | `hub_primary_write` | Wrapper calls Hub action. |
| Proof/drop/route capture | `native_write_command_missing`, `proof_drop_policy_missing` | Schema has delivery proof/drop on `Order`/`ShopifyOrder`, but `FulfillmentTask` schema has no proof/drop fields and native lifecycle forbids them. |
| Route optimization | `route_optimization_provider_held`, `provider_dependency_present` | Google route call is gated; route order is not persisted by current panel. |
| Customer delivery tracker/status | `customer_facing_held`, `blocked_by_customer_status_policy` | Do not switch customer-visible status from delivery actions without exact approval. |
| Hub delivery sync/import | `hub_fallback_active`, `repair_replay_governed` | Status sync can write Customer App `Order` when enabled; this is not the native delivery action replacement. |
| Hub push/export | `hub_primary_write`, `repair_replay_governed` | Legacy push is default-disabled by freeze gate; Hub remains active. |
| Notification/message delivery | `notification_policy_held` | Delivery action commands must not send notifications until policy is separately approved. |
| Delivered customer status cascade | `blocked_by_customer_status_policy`, `native_write_command_exists` | Old-pilot exact command exists but is not retargeted/approved for current target. |

## 5. Source-of-truth rules

Delivery migration should use these rules until a broader cutover is approved:

1. Admin route summary is native-first with Hub fallback.
2. Hub fallback stays active; do not suppress Hub writes globally from this phase.
3. Customer-facing delivery status should not switch unless native and Hub statuses agree or an exact reconciliation has been proven.
4. Out-for-delivery must require exact native `FulfillmentTask`, native `ShopifyOrder`, and Customer App `Order` identity in any future production command.
5. Delivered must require proof/drop/route policy and exact approval before any customer-facing status update.
6. Customer App `Order.status` must not update from Delivery Queue operational actions unless separately approved.
7. Notifications remain held and must not be coupled to Delivery Queue action buttons.
8. Hub status push remains active/available until a separate Hub write suppression/shadow plan exists.
9. Provider route optimization remains preview-only/held unless a provider contract is separately approved.
10. Repair/replay/backfill remains Hub/log/manual-review governed.

## 6. Native replacement candidates

### A. Mark native FulfillmentTask out-for-delivery

Candidate command shape:

- exact `fulfillment_task_id`
- exact `order_number`
- exact `customer_app_order_id`
- exact `native_shopify_order_id`
- exact `production_date` / delivery date context
- current task status must be packed/ready-for-delivery
- update only `FulfillmentTask.status`, `FulfillmentTask.delivery_status`, `FulfillmentTask.out_for_delivery_at`, audit trail, and one safe `CommandLog`
- no Customer App `Order` mutation
- no native `ShopifyOrder` mutation unless separately approved
- no notification
- no provider
- no Hub mutation

Current source status: `executeNativeFulfillmentTaskLifecycle` supports a task-only `out_for_delivery` action, but it is not exact-order scoped and has not been piloted for the G37 target.

### B. Mark native FulfillmentTask delivered

Candidate command shape:

- exact `fulfillment_task_id`
- exact `order_number`
- exact delivery date
- actual delivered timestamp required
- proof/drop policy required before customer-facing delivered state
- update only native `FulfillmentTask` if operational-only mode is approved
- no Customer App `Order` mutation unless separate delivered customer status approval exists
- no notification
- no provider
- no Hub mutation

Current source status: `executeNativeFulfillmentTaskLifecycle` supports `delivered_operational`, and `reconcileNativeDeliveryCompletionForCustomerApp` supports a more complete old-pilot exact delivered reconciliation. Neither should be used broadly without retarget/boundary approval.

### C. Native delivered customer status impact

Candidate path:

1. Preview delivered customer status impact.
2. Confirm exact native task/order/compliance state.
3. Confirm no notification policy.
4. Approve a separate customer-facing status update.

Current source status: preview/write functions exist but are hardcoded to the prior pilot and should not be treated as ready for `NV-MQHJR3V2`.

### D. Route optimization

Candidate path:

- keep explicit-stop preview only;
- require provider-call approval for Google route optimization;
- do not persist route order until route save schema and command policy exist;
- do not mix route optimization with delivered proof/drop capture.

### E. Hub push suppression shadow

Candidate path:

- not part of Delivery Queue action patch;
- belongs to a separate Hub write suppression/shadow plan;
- requires parity logging, rollback, and owner approval.

## 7. Boundary/gate gap list

Any future delivery command must include:

- default-off enable gate
- kill switch
- approved actor allowlist
- order allowlist
- Customer App order allowlist
- native ShopifyOrder allowlist
- native FulfillmentTask/task allowlist
- exact policy value
- exact confirmation phrase
- required `request_id`
- request-id idempotency
- no notification policy
- no provider policy
- no Hub mutation policy
- no customer status policy unless explicitly approved
- no raw payload/proof/provider/payment payload policy
- method/auth boundary verification
- disabled-boundary verification
- before/after no-write side-effect verification

Current gaps by area:

| Area | Gap |
| --- | --- |
| Native lifecycle command | Has gates and idempotency but is generic task allowlist/action gated, not an exact G37 delivery pilot contract. |
| Hub wrappers | Call Hub directly and rely on Hub-side idempotency; not native replacements. |
| Delivered reconciliation | Old-pilot exact command exists but must be retargeted and proof/drop policy resolved. |
| Customer status delivered update | Old-pilot exact command exists but must be retargeted and separately approved. |
| Proof/drop capture | Policy and schema/command path are incomplete for native Delivery Queue actions. |
| Route optimization | Provider-call gate exists, but route persistence and provider approval are held. |
| Notifications | Must stay independent from delivery action commands. |
| Hub sync/push | Must remain governed by separate Hub shadow/suppression plan. |

## 8. Recommended delivery action migration sequence

1. **G42B — delivery action preview/packet for exact `NV-MQHJR3V2` after verified production.**
   - Use read-only lifecycle and delivery completion previews.
   - Confirm exact native `FulfillmentTask`, native `ShopifyOrder`, Customer App `Order`, batch, compliance, and route state.

2. **G42C — default-off native out-for-delivery command plan.**
   - Retarget or wrap native task lifecycle to exact order/task identity.
   - Prove disabled boundary before live.

3. **G42D — default-off native delivered command plan.**
   - Require actual delivered timestamp.
   - Keep proof/drop and customer status held unless separately approved.

4. **G42E — customer delivered status impact preview.**
   - Read-only customer-facing impact preview after native delivered state is proven.

5. **G42F — delivery notification policy plan.**
   - Decide if/when notifications should be created/sent after delivery status changes.

6. **Hub write suppression/shadow.**
   - Only after native delivery actions are proven and parity logging is clean.

Do not recommend broad delivery action migration yet.

## 9. Hard stops

Stop immediately if any of these appear:

- out-for-delivery write before production is verified and pack path is approved
- delivered write before proof/drop policy exists
- customer status update without exact approval
- notification/message creation
- provider call without explicit provider approval
- Hub mutation from a native delivery action
- route optimization provider write without approval
- customer-facing tracker cutover
- repair/replay/backfill writes
- broad/non-exact delivery command
- raw proof/drop/provider/payment payload exposure
- mutation of `Order`, `ShopifyOrder`, or `FulfillmentTask` outside the approved exact command contract

## 10. Recommendation

Do not run delivery actions yet.

Use G42A to plan exact native delivery action replacements. After Friday G37H verify/QC and post-verify cascade preview are complete, choose one exact delivery action pilot if the state is clean:

1. Native out-for-delivery preview/command boundary.
2. Native delivered operational preview/command boundary.
3. Customer delivered status impact preview.
4. Notification policy only after customer status policy is approved.

Keep Hub active and keep notifications/providers/customer-facing delivery status held until a separate exact approval exists.
