# G40A: Hub Burn-Down Status Roll-Up After G39 Admin-Read Patches

## Executive summary

G40A is a docs-only status roll-up after the G39 admin-read burn-down sequence. It documents what is now native-first, what remains diagnostics-only, what remains Hub source-of-truth, and what must not move without new evidence.

Current posture after G39Q:

- G39Q is closed.
- Readiness classification: `operations_delivery_completed_single_aggregate_patch_live`.
- Hub remains active.
- Hub fallback remains active.
- Customer-facing cutover remains held.
- Hub write suppression remains held.
- Inventory deduction and PurchaseOrder automation remain held.
- Refunds/payments remain Hub/payment source-of-truth.
- Subscriptions and multi-delivery remain Hub source-of-truth.
- Repair/replay/safeSync remain held and manual-review governed.
- No additional operations dashboard aggregate should switch automatically.

This report does not change runtime behavior, schemas, UI, customer-facing behavior, or Base44 deployment state. It does not run live commands and does not mutate any records.

## Current migration posture

The migration has made meaningful progress on admin-only read surfaces while preserving the safety boundary around live writes and customer-facing behavior.

Current posture:

| Area | Current state |
| --- | --- |
| Hub runtime | Active |
| Hub fallback | Active |
| Hub writes | Not suppressed |
| Customer-facing cutover | Held |
| Admin delivery route read | Native-first live with Hub fallback |
| Admin production planning read | Native-first live with Hub fallback |
| Admin calendar events read | Native-first live with Hub fallback |
| Admin orders | Diagnostics and limited native-primary metadata live; Hub-first default retained |
| Operations dashboard | Diagnostics live; one guarded aggregate patch live |
| Inventory/PO | Held |
| Refunds/payments | Hub/payment source-of-truth |
| Subscriptions/multi-delivery | Hub source-of-truth |
| Repair/replay/safeSync | Hub/log/manual-review governed |
| Notifications | Held |

The migration is not in a Hub-retirement posture. The current posture is targeted admin-read burn-down with Hub fallback retained.

## G39 admin-read burn-down summary

### Native-first admin-read surfaces live

#### 1. `getAdminDeliveryRouteSummary`

Status:

- Native-first live.
- Hub fallback retained.
- Stale Hub suppression verified.
- No writes.

Safety boundary:

- Admin-only read surface.
- Customer-facing delivery behavior remains held.
- Hub fallback remains available for missing or incomplete native context.

#### 2. `getAdminProductionPlanningSummary`

Status:

- Native-first live.
- Hub fallback retained.
- Inventory and PurchaseOrder automation held.
- No writes.

Safety boundary:

- Admin-only read surface.
- Inventory stock is not treated as authoritative.
- Production planning read data does not authorize inventory deduction or PO creation.

#### 3. `getAdminCalendarEventsSummary`

Status:

- Native-first live.
- Hub fallback retained.
- Runtime activation issue resolved by G39H-PATCH1.
- No writes.

Safety boundary:

- Admin-only read surface.
- Subscriptions and multi-delivery calendar context remain Hub source-of-truth where native occurrence parity is not proven.
- Calendar event presence does not imply command readiness.

### Diagnostics and limited admin-read surfaces

#### 4. `getAdminOrdersWithHub`

Status:

- Diagnostics live.
- Limited native-primary metadata live.
- `native_primary_row_count: 0` under strict eligibility rules.
- Hub-first default retained.
- Not ready for broad native-first.
- No writes.

Important interpretation:

- Zero eligible rows is acceptable and intentional under the current safety rules.
- Admin orders remain blocked from broad native-first because mismatch and review risk remain present.
- Hub-only, native-missing, refund/cancel/payment-risk, subscription/multi-delivery, repair/replay, review-required, and mismatched rows remain Hub-primary or manual-review governed.

#### 5. `getAdminOperationsDashboardSummary`

Status:

- Diagnostics live.
- One guarded aggregate patch live: `summary.delivery.completed_in_range`.
- Hub-primary behavior retained for the dashboard overall.
- All other displayed values unchanged.
- No writes.

Guarded aggregate behavior:

- `summary.delivery.completed_in_range` may display the native route-date count when the G39Q guard passes.
- Display source is `native_route_date` only for that aggregate and only under guard.
- Hub fallback remains active.
- Inventory/PO, production, refund/payment, subscription/multi-delivery, and repair/replay aggregates remain held.

## Source-of-truth map by domain

| Domain | Current source-of-truth posture | Native status | Hub / hold status | Notes |
| --- | --- | --- | --- | --- |
| One-time order mirror/intake | Native proven for exact controlled paths only | Native `ShopifyOrder` mirror proven; native `FulfillmentTask` mirror proven | Broad/generalized status held | Controlled examples include `NV-MPZNKGNT` and `NV-MP5SOQLJ`. Generalization remains held until a natural paid/captured one-time order appears. |
| Production lifecycle | Technically ready for controlled paths; live proof still blocked | Fixture E2E simulation proven; gates-closed command boundaries verified | Live natural production lifecycle not proven | Blocker: no active paid/captured natural one-time order available. Status: production-ready pending real order. |
| Master data / procurement | Native visibility improving; inventory/PO policy still held | Watermelon Juice recipe gap closed; procurement visibility works | Inventory stock not authoritative; inventory deduction held; PO automation held | Owner inputs still needed: Black Salt, Beetroot, Sea Salt, Black Pepper. |
| Delivery/admin route | Native-first admin read live | Native route summary primary where complete | Hub fallback active | Stale Hub suppression verified. Customer-facing delivery changes remain held. |
| Admin production planning | Native-first admin read live | Native planning summary primary where complete | Hub fallback active | Inventory and PO actions remain held. |
| Admin calendar | Native-first admin read live | Native calendar events primary where complete | Hub fallback active | Subscriptions and multi-delivery remain Hub source-of-truth where exact native parity is not proven. |
| Admin orders | Diagnostics plus limited native-primary metadata live | Limited native-primary eligibility exists but currently zero eligible rows | Hub-first default retained | Full native-first blocked by mismatch/review risk. |
| Operations dashboard | Diagnostics live plus one guarded aggregate | `delivery.completed_in_range` guarded native aggregate live | Hub-primary behavior retained for all other displayed values | Inventory/PO/refund/subscription/repair aggregates held. |
| Refunds/payments | Hub/payment source-of-truth | Native refund impact previews exist; refund schema fields exist; Stripe refund shadow exists default-off | No native refund writes approved | Payment reversal semantics must remain Hub/payment governed until explicitly approved. |
| Subscriptions / multi-delivery | Hub source-of-truth | Occurrence preview, mirror packet, and command readiness exist for exact cases | No broad subscription native ownership | No subscription production/delivery lifecycle migration is approved. |
| Repair/replay/safeSync | Hub/log/manual-review governed | Native context may support diagnostics | Not eligible for native-first cutover | Repair/replay state must remain governed by logs and manual review. |
| Notifications | Held | No expansion approved | No notification send changes approved | Notification behavior must not expand as part of read burn-down. |
| Inventory / PurchaseOrder | Held | Native inventory visibility exists but is not stock-authoritative | No PO automation approved | No inventory deduction or PurchaseOrder creation may be triggered by dashboard/read counts. |

## Readiness percentage update

These percentages are readiness estimates only. They are not claims that Hub can be removed, disabled, or write-suppressed.

| Area | Estimated readiness | Interpretation |
| --- | ---: | --- |
| Controlled one-time order flow | 96-97% | Exact controlled mirror/task paths are proven, but this does not generalize to all live orders. |
| Generalized one-time order flow | 55-60% | Needs a new natural paid/captured one-time order for G37C-style proof before broad confidence increases. |
| Production lifecycle readiness | 75-80% | Technically ready through fixture and gates-closed boundaries, but live proof is blocked by no active paid/captured natural one-time order. |
| Admin-read Hub burn-down | 55-65% | Several admin reads are native-first live, while admin orders and most operations aggregates remain diagnostics/held. |
| Refund native readiness | 45-55% | Native preview/schema/shadow components exist, but Hub/payment remains source-of-truth and no native refund writes are approved. |
| Subscription native readiness | 35-45% | Exact preview/packet pieces exist, but Hub remains source-of-truth for subscriptions and multi-delivery. |
| Inventory/PO native readiness | 30-40% | Owner inputs and source-of-truth policy are still needed; inventory deduction and PO automation remain held. |
| Full Hub retirement | 40-45% | Hub remains active and required for payments/refunds, subscriptions, repair/replay, fallback, and unresolved source-of-truth domains. |

## Hard stops

Do not proceed with any of the following without separate approval and evidence:

- Broad Hub write suppression.
- Customer-facing order history/tracker cutover.
- Subscription or multi-delivery native source-of-truth switch.
- Refund/payment native source-of-truth switch.
- Inventory deduction.
- PurchaseOrder automation.
- Notification expansion.
- Production lifecycle live proof from historical or late mirror orders.
- Broad operations dashboard native-first switch.
- Broad admin orders native-first switch.
- Hub fallback removal.
- Function deletion without slot/reference audit.

## Valid next movement triggers

A next migration movement should happen only when one of these triggers is present:

1. **New active paid/captured one-time order appears**
   - Run the G37C exact preview path.
   - If clean, proceed through the exact native mirror/task/lifecycle path.

2. **Clean nonzero aggregate evidence appears**
   - Run G39R single-aggregate validation.
   - Patch only one operations dashboard aggregate if the candidate is guardable.

3. **Owner supplies inventory/yield inputs**
   - Resume G34D validation preview.
   - Required owner inputs currently include Black Salt, Beetroot, Sea Salt, and Black Pepper.

4. **Real refund event expected**
   - Use G35O/G35I shadow/review runbooks.
   - Continue blocking native refund writes unless separately approved.

5. **Specific Hub dependency target selected**
   - Plan diagnostics/preview first.
   - Patch runtime only after parity evidence exists.

6. **Operator requests historical/admin-only backfill**
   - Run packet preview first.
   - Require exact owner actuals, QC evidence, and timestamps before any live movement.

## Recommended next phase options

### Option A — Hold/monitor

Wait for the next natural paid/captured one-time order or a clear nonzero aggregate evidence window.

This is the safest default because the largest remaining blockers are evidence-bound, not implementation-bound.

### Option B — G40B customer-facing surface dependency audit

Run a docs/static audit of customer-facing order history/tracker dependencies.

Scope should remain docs-only with no runtime changes. This can clarify future customer-facing cutover risk, but it is higher risk than admin-only surfaces and should not become a cutover by default.

### Option C — G40C Hub write suppression shadow plan

Create a docs-only plan for shadowing or measuring selected Hub writes before any suppression.

No actual Hub write suppression should occur. This can prepare write burn-down while preserving the current safety boundary.

### Option D — G34D ingredient/yield input validation

Resume only after owner-supplied values are available for the held inputs.

This can improve procurement/master-data readiness but must not trigger inventory deduction or PO automation.

### Option E — G39R next single-aggregate validation

Proceed only if a clean nonzero operations dashboard aggregate candidate exists.

Validate one aggregate at a time. Do not switch displayed values during validation.

## Current hold/monitor state

Default recommendation: **Option A — hold/monitor**.

If the team wants to continue without waiting for a new order or clean aggregate window, choose a docs-only planning/audit phase such as G40B or G40C.

Do not automatically switch any additional operations dashboard aggregate. Do not loosen admin-orders native-primary eligibility. Do not infer production lifecycle readiness from historical or late mirror rows.

## No-write confirmation

G40A is docs-only.

This phase does not:

- Change runtime code.
- Change schemas.
- Change UI.
- Publish Base44.
- Open gates.
- Run live commands.
- Mutate Customer App records.
- Mutate native records.
- Mutate Hub records.
- Call Stripe.
- Call Shopify.
- Call providers.
- Send notifications.
- Run sync/retry/repair/replay.
- Create logs or queues.
- Deduct inventory.
- Create PurchaseOrders.
- Suppress Hub writes.
- Disable Hub fallback.
- Change customer-facing behavior.

Hub remains active. Hub fallback remains active. Customer-facing cutover remains held.
