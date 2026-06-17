# G39R — Full Hub Migration Scoreboard Current State

## 1. Executive summary

G39R is a docs-only/read-only current-state audit of the remaining Operations Hub migration surface. It is intentionally broader than the Friday production sequence. The goal is to identify every visible customer/admin area that still depends on Hub data, Hub sync, Hub fallback, provider calls, or incomplete native semantics, then rank the safest work that can move NuVira closer to 100% native ownership before and after the Friday production run.

No runtime code was changed. No schemas were changed. No Base44 publish was performed. No gates were opened. No Hub, Stripe, Shopify, route-provider, notification-provider, sync, repair, replay, inventory, PurchaseOrder, production, fulfillment, compliance, order, customer, or event write was run.

Current conclusion:

- Full Hub retirement is **not ready**.
- Friday production remains important for proving the native production lifecycle, but it is not the only migration track.
- Several non-production surfaces can be advanced before Friday, especially customer/admin event time semantics, compliance page boundary hardening, delivery action replacement planning, customer order views, and Hub write suppression planning.
- The observed event bug where Hub-added events appear in the Customer App with a default `7am-7pm` window is a valid migration defect. It indicates the public `Event` record/display contract does not preserve exact start/end time semantics.

Recommended immediate next phase:

- **G40A — Event time semantics native patch** for `Event` schema/display/sync preview, followed by an exact live correction command only if current records need repair.

Recommended parallel planning phases:

- **G41A — Compliance native boundary/readiness audit**.
- **G42A — Delivery Queue action migration audit**.
- **G43A — Customer order history/tracker native parity preview**.
- **G44A — Hub write suppression scoreboard**.

## 2. Static audit scope and limits

Static audit evidence came from current `origin/main` source after PR #497.

Important limitation: this packet does not call live Base44 endpoints and does not inspect live rows. It uses source, existing migration docs, entity schemas, and static references. Live preview evidence should still be collected before any runtime patch is treated as cutover-ready.

Static counts from the source tree:

| Metric | Count |
| --- | ---: |
| Base44 function `entry.ts` files | 258 |
| Functions with Hub env-secret usage (`HUB_API_URL`, `CUSTOMER_APP_SYNC_SECRET`, or `HUB_SYNC_SECRET`) | 124 |
| Functions with Hub/hub text references | 168 |
| Functions with gate/policy/kill-switch style markers | 122 |
| Functions with static create/update/delete calls | 105 |

This confirms the remaining migration is not just production. Hub is still involved across customer account/order views, admin dashboards, delivery, compliance summaries, inventory/procurement, subscriptions, refunds, loyalty/events, POS, sync health, backfill, and repair/replay.

## 3. Current migrated/staged areas

| Area | Current state | Practical meaning |
| --- | --- | --- |
| One-time native mirror/task | Proven for exact orders | Exact one-time mirrors are available, but broad automation remains gated. |
| G37 production materialization/start/repair/complete/verify commands | Retargeted and boundary-safe for `NV-MQHJR3V2` | Friday still needed for real start/complete/QC proof. |
| Admin delivery route summary | Native-first runtime patch exists | Read summary is safer, but delivery actions remain a separate problem. |
| Admin production planning summary | Native-first runtime patch exists | Read-only planning improved; lifecycle writes still separate. |
| Admin calendar events summary | Native-first runtime patch exists | Admin calendar improved, but customer `/events` still has event-time semantics gap. |
| Admin orders | Limited native-primary patch exists | Full native-first still blocked by mismatches, subscriptions, refunds, payment-risk, and Hub-only rows. |
| Operations dashboard | Diagnostics live; one delivery aggregate guarded | Dashboard as a whole is not native-first. |
| Inventory/procurement | Native read context exists | Deduction and PO automation remain held. |
| Refunds | Native previews/shadows exist | Hub/payment source of truth remains. |
| Subscriptions/multi-delivery | Native occurrence previews exist | Hub remains source of truth. |

## 4. Page/domain scoreboard

| Domain / page | Primary files/functions | Current dependency | Risk | Migration readiness | Next action |
| --- | --- | --- | --- | --- | --- |
| Customer Events page | `src/pages/Events.jsx`, `base44/entities/Event.jsonc`, `syncEventsFromHub`, `receiveSyncedEvent`, `hubSyncProxy` | Native `Event` rows, legacy Hub event bridge, incomplete time semantics | Medium | Patch-ready | G40A event time schema/display/sync normalization. |
| Admin Calendar | `src/pages/admin/Calendar.jsx`, `getAdminCalendarEventsSummary` | Native-first with Hub fallback | Low/medium | Mostly migrated for admin reads | Smoke/verify after event time patch; keep Hub fallback. |
| Compliance Ops | `src/pages/admin/ComplianceOps.jsx`, `getAdminComplianceOpsSummary`, `saveAdminComplianceRecord`, `generateAuditPacket` | Native records exist; summary still merges Hub; save path writes native compliance records | Medium/high | Audit-ready | G41A boundary + idempotency/lock/export audit. |
| Batch verify/QC compliance | `verifyNativeProductionBatchesForCustomerApp`, `BatchComplianceLog` | Retargeted for Friday exact batches | Medium | Pending Friday actual QC | Run only after real complete + QC data. |
| Delivery Queue read summary | `DeliveryQueue.jsx`, `getAdminDeliveryRouteSummary` | Native-first read with Hub fallback | Medium | Partially migrated | Keep; verify live smoke by date. |
| Delivery Queue actions | `updateAdminFulfillmentTaskAssignment`, `markAdminFulfillmentTaskOutForDelivery`, `recordAdminFulfillmentTaskDelivered`, native lifecycle functions | Hub action wrappers still present; native commands/previews also exist | High | Needs isolation | G42A action-by-action audit, then exact native replacement PRs. |
| Route optimization | `optimizeDeliveryRoute` | Google route provider and Hub/local merge | High | Not retirement-ready | Keep disabled/gated until native route rows and provider policy are defined. |
| Customer Order History | `OrderHistory.jsx`, `getCustomerAccountDashboardData`, `getCustomerOrdersWithHub` | Customer order list can still be Hub-authoritative for merged operational orders | High | Preview-ready | G43A native order list parity preview. |
| Customer Order Tracker | `OrderTracker.jsx`, `getCustomerOrderDetail`, `getDeliveryEta` | Native/local order detail exists but customer-visible delivery/status semantics need parity | High | Preview-ready | G43A exact customer tracker parity. |
| Checkout/order intake | `Checkout.jsx`, `createPaymentIntent`, `stripeWebhook`, `syncOrderToHub`, `syncCustomerToHub` | Stripe/payment plus Hub sync bridge still active | Critical | Do not suppress broadly | G44A write suppression matrix after parity. |
| Admin Orders | `AdminOrders.jsx`, `getAdminOrdersWithHub`, `appendAdminHubOrderNote` | Limited native-primary; Hub fallback still required | Medium/high | Limited migrated | Continue restricted native-primary; do not fully cut over yet. |
| Operations Dashboard | `Operations.jsx`, `getAdminOperationsDashboardSummary` | Hub-primary diagnostics with one guarded native aggregate | Medium | Incremental only | Pick one aggregate at a time after diagnostics. |
| Production Queue / Planning | `ProductionQueueSummary.jsx`, `ProductionPlanning.jsx`, production lifecycle previews/commands | Planning native-first; queue still includes Hub-backed legacy admin actions | Medium/high | Friday proof pending | Keep native exact lifecycle; retire old admin production wrappers later. |
| Inventory Status | `InventoryStatus.jsx`, `getAdminInventoryStatusSummary` | Hub/native merged read; native stock non-authoritative; PO held | High | Owner-input blocked | G45A inventory/yield/procurement owner input packet. |
| Notifications | `Notifications.jsx`, `NotificationCampaigns.jsx`, send notification functions | Existing paths exist; migration notifications held | High | Held | Define notification matrix after status/cascade parity. |
| Subscriptions | `SubscriptionManagement.jsx`, subscription sync/repair functions | Hub source of truth for recurrence/multi-delivery | Critical | Held | Exact occurrence-by-occurrence migration only. |
| Refunds/payments | `stripeWebhook`, `processManualRefund`, `syncRefundToHub`, refund preview docs | Hub/payment source of truth | Critical | Held | Shadow/preview only until exact event/order approval. |
| POS orders | `POSOrders.jsx`, `getAdminPOSOrdersSummary` | Read-only Hub/POS context | Medium | Audit-ready | POS native mirror/parity audit after customer order views. |
| Resources/Ops Alerts/Sync Health | `Resources.jsx`, `OpsAlerts.jsx`, `SyncHealth.jsx` | Hub-backed/admin diagnostics | Medium | Audit-ready | Lower priority after customer/admin core flows. |
| Loyalty/rewards/event bonus | `Rewards.jsx`, `EventMay30.jsx`, loyalty/event sync functions | Native points plus Hub/legacy bridges | Medium | Audit-ready | Separate loyalty/event bridge cleanup after event display fix. |
| Repair/replay/backfill | retry/recover/backfill functions | Hub-dependent operational safety net | Critical | Do not retire | Keep until all source-of-truth domains are native and live-proven. |

## 5. Event-time defect analysis

Observed owner issue:

> Events added in Hub show in the Customer App with a set time of `7am-7pm`, which is not correct.

Static source evidence:

1. The native `Event` entity only defines:
   - `date`
   - `time`
   - no `start_datetime`
   - no `end_datetime`
   - no `start_time`
   - no `end_time`
   - no `timezone`
   - no canonical `time_label`
   - no `status` or `event_type` fields in schema.
2. `src/pages/Events.jsx` displays the raw string:
   - `event.date · event.time`
3. `Events.jsx` builds structured data using `e.time`, and tries `e.end_time`, but `end_time` is not in the entity schema contract.
4. `syncEventsFromHub` and `receiveSyncedEvent` copy Hub event payloads into native `Event` with little semantic normalization.
5. `hubSyncProxy` returns only `date` and `time` for events.
6. Admin calendar can consume `start_datetime`/`end_datetime` if present, but the public Events page does not normalize or format exact start/end times.

Classification:

- Primary: `native_event_schema_missing_time_semantics`
- Secondary: `event_sync_mapping_too_loose`
- Secondary: `customer_events_display_uses_raw_time_label`
- Possible live-data issue: `existing_event_rows_need_exact_time_repair`

Why this matters:

- This is customer-facing.
- It is not dependent on Friday production.
- It is a clean example of Hub-era data being copied into Customer App without a complete native semantic contract.

Recommended G40A patch scope:

- Add/confirm native `Event` safe fields:
  - `event_type`
  - `status`
  - `start_datetime`
  - `end_datetime`
  - `start_time`
  - `end_time`
  - `timezone`
  - `time_label`
  - `source_time_label`
- Patch event display to use normalized time label.
- Patch structured data to use canonical start/end values.
- Patch event bridge normalization so Hub values do not default to broad `7am-7pm` unless that is explicitly the event's true time.
- Add read-only preview/report for existing active Event rows that flags suspicious broad default windows.
- If live records are already wrong, create a separate exact repair command or admin-safe correction path after preview.

G40A must not mutate live Event rows during PR prep.

## 6. Compliance migration status

Compliance is not a single thing.

### 6.1 General compliance forms

The compliance page includes native forms for:

- temperature
- pH
- CCP
- sanitation
- corrective action
- daily checklist
- batch compliance
- label/allergen review
- HACCP plan review
- compliance documents / binder export

Static source shows `saveAdminComplianceRecord` creates native compliance records and may create `ComplianceAlert`. This is useful, but it needs a migration hardening pass before claiming compliance is fully migrated.

Open issues to audit:

- whether every compliance entity schema exists and is published
- whether save paths are idempotent where needed
- whether logs become immutable/locked when appropriate
- whether audit packet exports all required records
- whether `ComplianceAlert` creation is safe and not noisy
- whether Hub summary fallback is still needed
- whether customer/provider/payment payloads are impossible to leak into compliance logs

Recommended next phase:

- **G41A — Compliance native boundary/readiness audit**

### 6.2 Production verify/QC compliance

The Friday G37H verify path is separate. It should create exactly two `BatchComplianceLog` rows for the two exact production batches only after production is complete and QC data exists.

Do not use the general compliance page as a substitute for the production lifecycle verify/QC command unless a separate audit explicitly approves that relationship.

## 7. Delivery route / delivery actions migration status

Delivery route summary has already moved in the right direction: native-first read with Hub fallback.

The larger migration problem is the action side:

- driver assignment
- mark out for delivery
- record delivered
- proof/drop details
- customer status cascade
- notifications
- route optimization/provider calls

Current page evidence shows `DeliveryQueue.jsx` still references Hub-backed action wrappers while also having newer native preview/execute function references. This is a good candidate for an action-by-action migration, not a broad rewrite.

Recommended next phase:

- **G42A — Delivery Queue action migration audit**

Recommended sequence:

1. Native read-only delivery action preview.
2. Exact driver-assignment command.
3. Exact out-for-delivery command.
4. Exact delivered command.
5. Post-delivery customer status preview.
6. Notifications only after a separate message policy.
7. Route optimization only after provider policy and exact address/privacy rules.

## 8. Customer-facing order views

Customer-facing order history and order tracker are higher risk than admin pages because incorrect status/delivery details are visible to customers.

Current state:

- `getCustomerOrdersWithHub` explicitly treats Hub as operational source of truth for merged customer order display.
- `getCustomerAccountDashboardData` reads native Customer App records and is important for account summary/order history.
- `getCustomerOrderDetail` is more native/local but still needs exact parity for line items, status, delivery windows, proof/drop, fulfillment tasks, refunds, subscriptions, and historical rows.

Recommended next phase:

- **G43A — Customer order history/tracker native parity preview**

This should be read-only and compare:

- active one-time order
- completed order
- refunded/cancelled order
- subscription/multi-delivery order
- POS/event order if visible
- order with delivery proof/drop details
- order with native `FulfillmentTask`
- order with Hub-only context

No customer-facing cutover should happen until preview output is clean.

## 9. Hub write suppression path

Hub write suppression must be planned, not improvised.

High-risk write/sync families include:

- `syncOrderToHub`
- `syncCustomerToHub`
- `syncUserToHub`
- `syncRefundToHub`
- `syncShopifyOrderToHub`
- `pushOrderStatusToHub`
- `syncHubDeliveryStatuses`
- subscription repair/sync functions
- historical Hub backfill/replay functions

Recommended next phase:

- **G44A — Hub write suppression scoreboard**

For each write path, document:

- trigger
- current live purpose
- native replacement
- whether suppression would lose customer/admin behavior
- exact gate/kill-switch if suppression is possible
- rollback path
- preview evidence required

Do not globally disable Hub write paths until each domain has a proven native replacement and a rollback plan.

## 10. Work that can be done before Friday

The best before-Friday work is not production lifecycle execution. It is migration burn-down.

Recommended before-Friday PR queue:

| Priority | Phase | Type | Why now |
| --- | --- | --- | --- |
| 1 | G40A Event time semantics patch | Runtime + tests + docs | Direct customer-facing bug, independent of Friday. |
| 2 | G41A Compliance native boundary audit | Docs/read-only | Compliance is partially native and can be hardened now. |
| 3 | G42A Delivery Queue action audit | Docs/read-only | Delivery actions are high-risk and should be planned before real delivery cutover. |
| 4 | G43A Customer order views parity preview | Runtime preview + tests | Customer-facing Hub dependency is a major 100% blocker. |
| 5 | G44A Hub write suppression scoreboard | Docs/read-only | Needed before any safe Hub retirement. |
| 6 | G45A Inventory/procurement owner input packet | Docs/read-only | Inventory/PO remain blocked by yield/stock policies. |

## 11. Work that should wait for Friday evidence

The following should wait until the Friday run produces real lifecycle evidence:

- G37F real start production.
- G37G real complete production.
- G37H real verify/QC.
- Post-verify cascade preview.
- Pack/bottle/customer-status steps.
- Delivery completion/customer notification for the Friday order.

Friday proof will improve confidence for:

- production lifecycle commands
- `BatchComplianceLog` creation/locking
- production queue status display
- post-verify cascade readiness
- pack/bottle readiness
- customer status update readiness

## 12. Do-not-cut-yet domains

These should not be treated as close to 100% until separate exact previews and approvals exist:

- Refund/payment processing.
- Subscription/multi-delivery operational ownership.
- Inventory deduction.
- PurchaseOrder automation.
- Broad customer notifications.
- Route optimization provider calls.
- Historical Hub backfill/replay.
- Repair/retry automation.
- Full customer order history/tracker cutover.
- Full admin orders native-first.
- Global Hub disablement.

## 13. Proposed route to 100%

A practical route to 100% is staged by source-of-truth ownership:

1. **Native-read completeness**
   - events
   - admin calendar
   - admin delivery summary
   - admin production planning
   - compliance summary
   - customer order views

2. **Native-write exact commands**
   - one-time order mirrors
   - fulfillment tasks
   - production batches
   - production lifecycle
   - compliance verification
   - delivery task actions

3. **Customer-facing parity**
   - order history
   - order tracker
   - delivery status
   - post-verify/customer status
   - notifications held until approved

4. **High-risk financial/subscription domains**
   - refunds
   - subscription occurrences
   - recurrence
   - partial-refund review
   - payment event idempotency

5. **Operational automation**
   - inventory deduction
   - procurement/PO
   - route optimization
   - alerts
   - repair/replay retirement

6. **Hub suppression and retirement**
   - suppress exact write paths after native replacement proof
   - retain Hub read-only fallback during observation
   - retire repair/backfill last
   - only then consider global Hub disablement

## 14. Hard stops

Stop any migration phase if:

- a customer-facing page would lose order/status/delivery context
- exact timestamps are inferred rather than represented explicitly
- subscriptions or multi-delivery rows are flattened incorrectly
- refund/payment state is not provider-safe and idempotent
- inventory or PO automation would run from non-authoritative stock
- notifications would be sent without a message policy
- Hub write suppression would remove a still-needed operational fallback
- route/provider calls would expose address/PII or run without approval
- a preview reports mismatches or fallback-required states that the patch cannot explain

## 15. No-write confirmation

G39R is docs-only/read-only. It does not mutate:

- Event
- Order
- ShopifyOrder
- FulfillmentTask
- ProductionBatch
- BatchComplianceLog
- compliance entities
- InventoryItem
- PurchaseOrder
- Notification
- CustomerMessageDeliveryLog
- OrderSyncLog
- CommandLog
- OrderReviewQueue
- Hub records
- Stripe/Shopify/provider state

No Base44 publish is required for G39R.

## 16. Recommendation

Proceed next with:

1. **G40A — Event time semantics native patch** because the customer-visible bug is real, independent of Friday, and likely fixable with a narrow schema/display/sync-normalization patch.
2. **G41A — Compliance native boundary/readiness audit** because compliance has native write surfaces but needs hardening before declaring it migrated.
3. **G42A — Delivery Queue action migration audit** because route reads are improved but action writes still need exact native replacement.
4. **G43A — Customer order history/tracker parity preview** because customer-facing order views are one of the biggest remaining Hub-retirement blockers.
5. Keep Friday G37 lifecycle execution separate and only run it when the physical production events actually occur.
