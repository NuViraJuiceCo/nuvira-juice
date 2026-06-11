# G37A — Migration Readiness Roll-Up and Hub Retirement Blocker Map

## 1. Executive summary

G31 through G36 moved the native migration from isolated previews into a proven controlled path for one exact one-time order, plus read-only or default-off coverage for historical backfill, refunds, procurement visibility, and subscription occurrence discovery.

Current readiness is still intentionally narrow:

- Controlled one-time order lifecycle is proven for an exact order.
- Generalized one-time order automation is not yet broad-gated.
- Refund paths are preview-ready and shadow-ready, but Hub remains refund source of truth.
- Subscription and multi-delivery parity is still Hub-owned; exact occurrence preview and mirror packet readiness are proven, but no live subscription mirror write is approved.
- Inventory deduction and PurchaseOrder automation remain held pending real owner-supplied yield/conversion values.
- Base44 function count is now a practical platform constraint; future work should prefer extending existing functions over adding standalone functions.

Hub fallback remains active and should stay active until exact-domain parity, idempotency, exception handling, and operator workflows are proven beyond single-target pilots.

## 2. Updated migration percentage estimates

| Scope | Estimate | Confidence | Basis |
| --- | ---: | --- | --- |
| Controlled one-time order flow | 95% | High for exact-order execution | NV-MPZNKGNT completed paid to delivered native lifecycle with Hub fallback active. Remaining gap is broader repeatability and operational gating. |
| Generalized one-time order flow | 45–55% | Medium | G33C exact preview exists, but broad gating and natural-order repetition are not complete. |
| Full Hub retirement | 30–40% | Medium-low | Refunds, subscriptions, inventory/PO, notification expansion, repair/replay parity, and admin workflow consolidation remain blockers. |

These estimates are operational readiness estimates, not code-completion percentages. They intentionally weight source-of-truth ownership, live write safety, rollback, idempotency, and exception handling more heavily than isolated function availability.

## 3. Proven native one-time order path

### Done/proven

The controlled native one-time order lifecycle for `NV-MPZNKGNT` is proven end-to-end through exact approvals and gated commands:

1. Paid/captured order context verified.
2. Native `ShopifyOrder` created and linked.
3. Native `FulfillmentTask` created and linked.
4. Master data import completed.
5. `ProductionBatch` materialized.
6. Production lifecycle executed:
   - start
   - complete
   - verify
7. `BatchComplianceLog` created/locked through the verified path.
8. Task packed.
9. Native order bottled.
10. Schedule correction executed.
11. Delivered reconciliation executed.
12. Customer App `Order` delivered status updated through the approved status-only path.

### Boundaries preserved

- No notifications were sent.
- No inventory deduction was performed.
- No PurchaseOrder automation was run.
- Hub fallback remained active.
- The path was exact-order controlled, not broad automation.

### Classification

`Done/proven` for one exact controlled one-time order.

`Proven exact-order only` for repeatable one-time order lifecycle design.

`Preview-ready` for the next natural paid one-time order through G33C.

## 4. Historical/backfill coverage

### Historical Hub order 1052

Historical Hub fulfilled order 1052 received a native `ShopifyOrder` historical mirror.

Held:

- Customer App `Order` backfill.
- Native `FulfillmentTask` backfill.
- Customer-visible record creation.
- Notifications.

### Classification

`Proven exact-order only` for historical native `ShopifyOrder` mirror backfill.

`Held` for Customer App order/task historical backfill.

## 5. Refund readiness

### Proven/read-only coverage

Refund work across G35B, G35D, G35H, G35K, and G35L established read-only impact previews for:

- full refund impact
- partial refund review impact
- batch/compliance linkage
- delivered/manual-review routing
- pre-production full refund lifecycle states
- Stripe refund webhook shadow-preview normalization

Optional refund schema fields were added so refund-specific state does not require overloading `Order.status` with refund/cancelled values.

### Command/shadow coverage implemented but held

Implemented but held:

- G35I: `createNativePartialRefundReviewQueueForCustomerApp`
  - default-off gated partial refund review queue command
  - boundary-safe
  - no live queue write approved
- G35N: Stripe refund webhook dark-launch shadow path
  - default-off
  - gates closed
  - no persistent logging
  - no provider calls
  - no live behavior change while disabled
- G35O: exact allowlisted Stripe refund shadow pilot runbook

### Current source of truth

Hub remains refund source of truth.

Native refund writes remain blocked.

### Classification

`Preview-ready` for full and partial refund impact.

`Command-ready but held` for partial refund review queue creation.

`Held pending real event` for G35O/G35I operational use.

`Hub source of truth` for actual refund processing.

## 6. Inventory/procurement readiness

### Proven/read-only coverage

G34B procurement visibility works as read-only native visibility.

Current inventory posture:

- stock is non-authoritative
- inventory deduction is held
- PurchaseOrder automation is held
- no inventory/PO mutation is approved

### Deferred ingredient/yield details

G34C owner input packet exists and still needs real business values for:

- Black Salt
- Beetroot
- Sea Salt
- Black Pepper

G34D remains held until owner supplies real yield/conversion values.

### Classification

`Preview-ready` for procurement visibility.

`Held pending owner input` for yield/conversion validation.

`Not ready` for inventory deduction and PurchaseOrder automation.

## 7. Subscription readiness

### Proven/read-only coverage

G36 work established that subscription/multi-delivery migration requires occurrence-level identity, not parent subscription identity alone.

Proven read-only capabilities:

- G36B: subscription occurrence parity preview modes exist:
  - `RECENT_SUBSCRIPTION_OCCURRENCE_SCAN`
  - `EXACT_OCCURRENCE_PREVIEW`
- G36C helper: parent-to-occurrence discovery can identify candidate occurrence context without using customer PII as a fuzzy key.
- G36C resolve/answers/decision: duplicate Hub task ambiguity and owner-approved interpretation can be documented and carried forward.
- G36D: exact subscription occurrence preview succeeded for `SUB-1TPMGCIR` / `2026-05-09`.
- G36F: native `ShopifyOrder` mirror packet preview returned clean:
  - `mirror_packet_ready:true`
  - no blockers
  - no schema packet blockers
  - no provider calls
  - notifications held
- G36G: default-off gated native `ShopifyOrder` mirror command exists and is boundary-safe.

### Held

No live subscription mirror write is approved.

Held subscription scopes:

- Customer App subscription/order mutation.
- Native `FulfillmentTask` subscription mirror.
- Native production demand for subscription bundle/package decomposition.
- Native delivery lifecycle for subscriptions.
- Notifications.
- Refund/cancellation automation for subscriptions.
- Repair/replay automation.
- Broad recurring subscription automation.

### Current source of truth

Hub remains subscription and multi-delivery source of truth.

### Classification

`Preview-ready` for exact subscription occurrence parity and mirror packet review.

`Command-ready but held` for one exact historical/admin native `ShopifyOrder` subscription occurrence mirror.

`Hub source of truth` for operational subscription fulfillment.

## 8. Hub fallback/source-of-truth map

| Domain | Current source of truth | Customer App native status | Hub retirement readiness |
| --- | --- | --- | --- |
| Controlled one-time order lifecycle | Customer App native for exact approved target, Hub fallback active | Proven for one exact order | Not enough for broad retirement |
| General one-time order intake/ops | Hub fallback active | Exact preview ready; broad automation held | Needs repeated natural-order proof |
| Historical fulfilled one-time order mirror | Hub historical data | One native `ShopifyOrder` mirror proven | Customer/task backfill held |
| Refund processing | Hub | Native previews and held queue command/shadow only | Hub must remain source of truth |
| Stripe refund webhook shadow | Existing webhook behavior + Hub refund ownership | Default-off shadow implemented | Pilot held until exact real event/approval |
| Inventory stock | Hub/manual operations | Read-only visibility only | Non-authoritative; not retirement-ready |
| PurchaseOrders | Hub/manual operations | Held | Not retirement-ready |
| Subscriptions/multi-delivery | Hub | Exact occurrence previews and held mirror command | Hub must remain source of truth |
| Notifications | Existing approved paths only | Migration notifications held | Not retirement-ready for expanded native flows |
| Repair/replay | Hub/existing repair tooling | Held | Not retirement-ready |

## 9. Function/platform constraints

Base44 function-count limits were encountered during G36G closeout. Although live verification showed the G36G function exists and matches source, the CLI reported the maximum function count reached during scoped deploy attempt.

Future implications:

- Prefer extending existing deployed functions when safe, especially for read-only previews.
- Avoid adding standalone Base44 functions unless capacity is explicitly confirmed.
- Verify publish scope before every runtime change.
- Prefer scoped function deploys over broad Builder publish.
- Do not use Builder Fix All for migration phases.
- Treat generated pull artifacts as local-only and remove them after source marker verification.

## 10. Live-write commands currently implemented but held

| Command/function | Domain | Status | Gates | Live execution status |
| --- | --- | --- | --- | --- |
| Native one-time order lifecycle commands from G31/G32 | One-time order production/delivery | Used for exact controlled target | Exact approvals/gates per phase | Do not broaden yet |
| `createNativePartialRefundReviewQueueForCustomerApp` | Partial refund review queue | Implemented and boundary-safe | Default-off | No live queue write approved |
| `createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp` | Subscription occurrence native `ShopifyOrder` mirror | Implemented and boundary-safe | Default-off | No live mirror write approved |
| Stripe refund webhook shadow path | Refund shadow preview | Implemented default-off | Exact event/order allowlists required | No live shadow pilot run |

Any live write use still requires fresh preview, exact identifiers, gates/allowlists, idempotency, owner approval, and no-provider/no-notification/no-Hub-mutation policies where applicable.

## 11. Phases safe to resume when input/event exists

| Phase path | Resume trigger | Safe next action |
| --- | --- | --- |
| G33C natural one-time order preview | Next natural paid one-time order appears | Run exact one-time order preview; do not broaden gates automatically |
| G34D inventory/yield validation | Owner supplies real ingredient/yield values | Run read-only validation preview |
| G35O/G35I refund path | Real refund event appears or owner approves exact controlled test | Run read-only shadow/impact preview first; queue/write remains separately gated |
| G36H subscription mirror | Owner explicitly approves the one exact historical/admin mirror | Run fresh G36F preview, then consider gates for the exact G36G command only |
| Admin UI/action consolidation | Owner prioritizes operator workflow cleanup | Plan docs/read-only or UI-only consolidation before new write paths |

## 12. Hard blockers for full Hub retirement

1. Broad one-time order repeatability is not proven beyond exact target execution.
2. Subscription/multi-delivery operational ownership remains Hub-only.
3. Subscription parent-vs-occurrence identity is still high risk without exact identifiers.
4. Native subscription `FulfillmentTask`, production demand, and delivery lifecycle are held.
5. Production bundle/package decomposition for subscription items is unresolved.
6. Inventory stock is non-authoritative.
7. Ingredient yield/conversion values remain owner-input blockers.
8. PurchaseOrder automation is held.
9. Refund processing remains Hub source of truth.
10. Stripe refund shadow is default-off and not piloted on a real event.
11. Partial refund review queue write exists but has not been approved live.
12. Notification expansion remains held to avoid duplicate customer messaging.
13. Repair/replay parity remains Hub-dependent.
14. Admin UI/action consolidation is not complete.
15. Base44 function-count capacity constrains additional standalone function work.
16. Broad gates must remain closed until repeated exact previews and no-write/no-duplicate proofs exist.

## 13. Recommended next phase options

### Option A — Wait for next natural paid one-time order and run G33C exact preview

This is the default recommendation.

Why:

- It advances the highest-value path toward generalized one-time order readiness.
- It avoids artificial writes.
- It keeps Hub fallback active.
- It produces operational evidence on a natural order rather than a synthetic target.

### Option B — Owner-approved G36H exact subscription historical/admin mirror write

Use only if the owner wants the one exact historical/admin native `ShopifyOrder` mirror for the approved subscription occurrence.

Boundaries:

- one native `ShopifyOrder` mirror only
- no Customer App Order
- no native FulfillmentTask
- no Hub mutation
- no provider calls
- no notifications

### Option C — Owner supplies G34C ingredient/yield values, then run G34D validation preview

Use if inventory/procurement readiness becomes the priority.

Still held after preview unless owner approves the next exact step.

### Option D — Real refund event appears, then use G35O/G35I runbooks

Use only for a real refund event or owner-approved exact controlled test.

Hub remains refund source of truth.

### Option E — Continue Hub retirement blocker planning with admin UI/action consolidation

Use if operator workflow clarity is the bottleneck.

This should focus on read-only panels, action visibility, and held-command labeling before expanding writes.

## 14. Recommendation

Default to Option A: wait for the next natural paid one-time order and run G33C exact preview.

Keep Hub active. Do not broaden gates yet. Do not proceed to G36H, G35I, G35O, inventory deduction, PurchaseOrder automation, subscription task creation, or notification expansion without a separate exact owner approval and fresh clean preview.
