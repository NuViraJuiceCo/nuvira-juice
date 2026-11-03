# G25: Hub Retirement Readiness Audit

Status: current-state audit and migration scorecard only
Date: 2026-06-06
Scope: Customer App repo after G24A/G24C publish. This document changes no runtime code and performs no live data writes.

## Safety Boundary

This phase is intentionally read-only and repo-only.

It does not:

- publish Base44 changes
- run `processMay30NativeOrderOps`
- run `syncOrderToHub`
- enable the native safeSync writer for broad real orders
- mutate Customer App `Order`, native `ShopifyOrder`, native `FulfillmentTask`, or Hub records
- create `OrderSyncLog`, `OrderReviewQueue`, `CommandLog`, or `SafeSyncParityLog`
- call Stripe, Shopify, provider APIs, or notification services
- run sync, retry, repair, replay, refund, production, inventory, route, proof, drop, or delivery commands

Admin read previews may include limited operational order context when needed for migration decisions, but live mutation boundaries remain strict.

## Controlling Conclusion

Hub retirement is **not ready** yet.

G24A and G24C moved the migration forward in an important way: a paid one-time Customer App order can now have native operational context in the Customer App (`ShopifyOrder` mirror and `FulfillmentTask`), and `/admin/orders` can display that native context alongside Hub fallback. That is a foundation, not a cutover.

The Hub is still active across order ingestion, operational reads, production, delivery, subscriptions, refunds, loyalty/customer/event sync, diagnostics, repair, and backfill paths. A current repo scan found:

- **792** Hub-related references in source/docs matched by the audit query.
- **100** active-source files/functions/pages with Hub bridge, Hub environment, Hub sync, or Hub fallback references.
- `syncOrderToHub` remains the largest active dependency surface with **40** matched references and still calls Hub `receiveCustomerAppEvent`.

Retiring Hub safely requires replacing the Hub as the canonical operational writer and then replacing Hub-backed read/command surfaces. The next meaningful migration work should focus on native order write parity and native operational state generation, not another UI-only patch.

## Current G24 State

| Area | Current status | Retirement implication |
| --- | --- | --- |
| G24A native paid-order ops | Live for gated eligible paid orders through `processMay30NativeOrderOps` when invoked by `syncOrderToHub`. | Good foundation, but not a broad replacement for Hub `safeSyncOrderUpdate`. |
| G24C admin visibility | `/admin/orders` shows Customer App, native mirror, native task, and Hub fallback context together. | Useful operational visibility, but still preserves Hub context and does not retire Hub reads. |
| Known recovered order `NV-MPZNKGNT` | Customer App order is paid/scheduled, native `ShopifyOrder` exists, native `FulfillmentTask` exists, Hub order exists and deduped. | Proves one order path, not full order-source parity. |
| Native safeSync writer | Broad real-order mode remains disabled. | Hub cannot retire while native writer is not the canonical write gateway. |
| Hub bridge | Still live and required. | Must remain until native parity is proven across order sources and operational commands. |

## Readiness Scorecard

Legend:

- **Ready for shadow/native read**: useful native state exists, but Hub may remain fallback.
- **Transitional**: Customer App has wrappers/mirrors, but Hub still owns or confirms the operational truth.
- **Hub-owned**: Hub remains the primary writer/source for this domain.
- **Held**: path intentionally blocked pending policy, data model, or safety approval.

| Domain | Current readiness | Current owner/source of truth | Hub retirement blocker | Next required migration |
| --- | --- | --- | --- | --- |
| Paid one-time Customer App operational mirror | Ready for shadow/native read | Customer App mirror plus Hub fallback | Limited order-source coverage; still invoked inside Hub sync path | Promote native order processing behind a canonical internal order service with parity tests. |
| Admin order merged visibility | Ready for shadow/native read | Customer App UI aggregating Customer App/native/Hub | Hub details still needed for timeline/task/fallback | Keep as visibility while native reads replace Hub detail calls. |
| Order ingestion/dedupe | Transitional | Customer App order plus Hub `receiveCustomerAppEvent`/Hub `safeSyncOrderUpdate` | `syncOrderToHub` still pushes to Hub and Hub dedupes | Port/complete native `safeSyncOrderUpdate` as canonical internal write gateway. |
| Native safeSync writer | Held / gated | Native preview/dark launch only; broad writes disabled | Not proven as broad real-order writer | Build fixture parity, shadow comparisons, owner/test allowlist pilot, then narrow source rollout. |
| FulfillmentTask generation | Transitional | Native delivery task for G24 path; Hub remains fallback/source for broader cases | Subscription/POS/manual/repair/task lifecycle parity incomplete | Native task generator with occurrence-level idempotency and Hub parity compare. |
| Customer order history/status reads | Transitional | Customer App reads plus Hub status readback functions | Customer/customer-facing order state still depends on Hub sync/readback in places | Native-first customer order projection and history service. |
| Admin timeline/order detail | Transitional | G24C merged view plus Hub timeline/detail functions | Hub timeline/task details still preserved and needed | Native `OrderTimeline`/event log projection with Hub fallback until parity. |
| Production planning/queue | Hub-owned/transitional reads | Hub summary/planning endpoints and Customer App wrappers | Recipe/bundle/demand engine not fully native | Native production demand engine using Customer App orders/tasks, shadow-compared to Hub. |
| Production commands | Hub-owned | Hub bridge commands from Customer App admin wrappers | Start/complete/verify/pack/bottle/corrections still write Hub | Native command framework with `CommandLog`, idempotency, previews, one-record pilots. |
| Inventory/procurement | Hub-owned / held writes | Hub inventory/procurement and preview bridges | Inventory deduction and PO policy not migrated | Native inventory/procurement read model first; write commands only after usage/stock policy. |
| Compliance | Hub-owned except schema alignment | Hub compliance entities/functions and production verify bridge | Required HACCP/QC logs not natively owned end-to-end | Native compliance module for BatchComplianceLog, SanitationLog, TemperatureLog, DailyChecklist, CorrectiveActionLog, CCPLog, pHLog. |
| Delivery/driver lifecycle | Hub-owned/transitional | Hub bridge commands and route/driver functions | Out-for-delivery/delivered/proof/drop/customer effects still Hub/held | Native task transition service with proof/drop policy and notification idempotency. |
| Refunds/cancellations | Hub-owned/high risk | Stripe/Hub refund sync and Hub refund cascade | Money-adjacent cascades not native | Native refund/cancellation service with full/partial refund tests and review queue behavior. |
| Subscriptions | Hub-owned/transitional | Subscription sync functions and Hub occurrence logic | Occurrence-level production/fulfillment model incomplete | Native subscription occurrence model and billing-cycle shadow run. |
| Shopify POS/events | Hub-owned/transitional | Hub official Shopify/POS intake and Customer App POS summaries | Native POS ingestion/classification not authoritative | Native POS adapter or explicit decision to keep Shopify POS separate until later. |
| Loyalty/customer/event sync | Hub-owned/transitional | Cross-backend sync functions | Non-order domains still sync to/from Hub | Decide final ownership, then native ledgers/events or explicit retirement scope. |
| Notifications | Transitional/held | Mixed Customer App notification functions and held customer-facing delivery paths | Notification idempotency/customer policy not finalized for migrated commands | Native notification service with explicit allowed command triggers. |
| Diagnostics/backfill/repair | Hub-specific | Hub sync diagnostics/retry/backfill tooling | Existing tools assume Hub endpoints and sync logs | Native observability, quarantine, and owner-approved repair console. |

## Active Hub Dependency Evidence

The audit query matched active source files/functions containing Hub bridge environment variables, Hub sync names, Hub order fields, or known Hub bridge function names. This is intentionally conservative; not every reference is a blocker, but every active reference is a retirement review item.

Top matched files from the current scan:

| File | Matches | Why it matters |
| --- | ---: | --- |
| `base44/functions/syncOrderToHub/entry.ts` | 40 | Still central Customer App to Hub order bridge and native mirror trigger. |
| `src/pages/AdminOrders.jsx` | 21 | Admin UI still displays/preserves Hub context. |
| `base44/functions/pollOrderStatusUpdates/entry.ts` | 14 | Hub-to-Customer status polling/readback. |
| `base44/functions/getAdminOrdersWithHub/entry.ts` | 14 | Admin order aggregation still includes Hub fallback/details. |
| `base44/functions/stabilizationDiagnostic/entry.ts` | 13 | Diagnostics are Hub-aware. |
| `base44/functions/pushOrderStatusToHub/entry.ts` | 12 | Customer App can still push status to Hub. |
| `base44/functions/debugAndRetryHubSync/entry.ts` | 11 | Repair/retry assumes Hub sync path. |
| `base44/functions/retryRepairedSubscriptionHubSync/entry.ts` | 10 | Subscription repair still Hub-oriented. |
| `base44/functions/getCustomerOrdersWithHub/entry.ts` | 10 | Customer-facing order read path still includes Hub. |
| `base44/functions/auditStripeAndIntegrationInventory/entry.ts` | 10 | Integration audit still tracks Hub dependency. |

Active Hub-referencing function families:

| Family | Representative active functions | Retirement meaning |
| --- | --- | --- |
| Order sync and bridge | `syncOrderToHub`, `manualPushOrderToHub`, `manualSyncOrders`, `syncOrdersFromHub`, `pushOrderStatusToHub`, `pollOrderStatusUpdates`, `hubToCustomerAppStatusSync` | Cross-backend sync remains live. |
| Admin/customer order reads | `getAdminOrdersWithHub`, `getCustomerOrdersWithHub`, `getAdminOrderTimeline`, `getAdminFulfillmentTaskDetails` | Native read projection is incomplete. |
| Native order transition work | `processMay30NativeOrderOps`, `previewNativeSafeSyncOrderUpdate`, `previewNativeSafeSyncDarkLaunchComparison`, `executeNativeSafeSyncOrderUpdate` | Native path exists, but broad writer is still gated. |
| Production commands/previews | `startAdminProductionBatch`, `completeAdminProductionBatch`, `verifyAdminProductionBatch`, `packAdminProductionVerifyFulfillmentTasks`, `bottleAdminProductionVerifyShopifyOrder`, production preview/correction/deduction functions | Production still writes or reads through Hub-backed contracts. |
| Delivery and route | `markAdminFulfillmentTaskOutForDelivery`, `recordAdminFulfillmentTaskDelivered`, `markAdminHubOrderDeliveredForCustomerAppSync`, `optimizeDeliveryRoute`, `retryFailedDriverSync`, `syncHubDeliveryStatuses` | Driver/delivery lifecycle is not native-owned. |
| Refunds/payments | `processManualRefund`, `syncRefundToHub`, `refundFlowDiagnostic`, `stripeWebhook`, `probeHubSubscriptionCancelled` | Refund/cancellation cascades remain high-risk Hub dependencies. |
| Subscriptions | `syncSubscriptionWithFulfillments`, `syncSubscriptionPlansToHub`, `manualSyncSubscriptionOrders`, `retryRepairedSubscriptionHubSync`, `getSubscriptionOrdersForSync` | Subscription occurrence parity is not complete. |
| Loyalty/customer/events | `syncCustomerToHub`, `syncUserToHub`, `syncEventToHub`, `syncLoyaltyToHub`, `syncLoyaltyFromHub`, `pushLoyaltyMemberToHub`, `claimReward`, `createLoyaltyMember`, `deactivateLoyaltyMembers` | Non-order domain ownership still needs a decision. |
| Diagnostics/backfills/repair | `debugAndRetryHubSync`, `debugHubSyncPayload`, `backfillAdminHistoricalHubOrders`, `previewAdminHistoricalHubBackfill`, `recoverStuckOrder`, `retryFailedHubSyncs`, `verifyHubEndpointReachability` | Repair/observability assumes Hub exists. |

## P0 Retirement Blockers

These blockers must be closed before Hub can be disabled rather than merely left as fallback.

1. **Canonical order write gateway is still not native.**
   Hub `safeSyncOrderUpdate` behavior must be ported or fully matched by a Customer App internal service. G24A creates a useful native mirror for a narrow class of paid orders, but Hub still owns broader idempotency, field ownership, stale-event filtering, review queue behavior, subscriptions, POS, refunds, and repair semantics.

2. **Fulfillment task generation and occurrence semantics are incomplete.**
   Native G24 delivery tasks exist for the recovered order path, but Hub still covers broader delivery, subscription occurrence, driver, pack, delivered, and route behavior.

3. **Production demand and command execution are still Hub-backed.**
   Admin production summaries and commands still depend on Hub functions. The Customer App does not yet own the full Recipe/Bundle/IngredientYield/demand engine or production lifecycle commands.

4. **Refund/cancellation cascades are not native-owned.**
   This is a money-adjacent high-risk blocker. Full and partial refund behavior, production/task cancellation, review queue entries, and idempotency must be native before Hub can retire.

5. **Subscriptions remain a cross-backend dependency.**
   Subscription order generation, fulfillments, occurrence production status, and billing-cycle repairs still rely on Hub-oriented sync paths.

6. **Admin/customer reads still use Hub for authoritative details in places.**
   G24C made visibility better, but native timeline, native task detail, and customer-facing order projection are not complete replacements.

7. **Non-order domains still have sync ownership ambiguity.**
   Loyalty, customer/user sync, events, bag returns, rewards, notifications, and credits must either be migrated or explicitly excluded from the Hub retirement definition.

8. **Repair/diagnostics/backfill tooling is Hub-specific.**
   A single-backend system still needs quarantine, review, replay, and diagnostics, but they must target native logs and queues instead of Hub endpoints.

## Recommended Critical Path to 100% Hub Retirement Readiness

### G26 — Native order write gateway parity

Goal: make the Customer App backend capable of producing the same canonical operational order result that Hub `safeSyncOrderUpdate` produces, without enabling broad real-order writes immediately.

Deliverables:

- Native internal safeSync/order-write service contract.
- Fixture and live-read shadow comparisons for one-time app, website, Shopify POS, subscription, refund, duplicate webhook, stale event, low-quality payload, and manual repair cases.
- `OrderSyncLog`, `OrderReviewQueue`, and `CommandLog` parity rules.
- Native write gate remains off by default; allow only owner/test or explicitly approved one-order pilots.
- Hub bridge remains live fallback.

Acceptance:

- Native planner output matches Hub for approved representative cases.
- No broad native writer access.
- No customer-facing state mutation outside approved pilot.
- Clear mismatch classes and review queue behavior.

### G27 — Native fulfillment task generation and order timeline projection

Goal: make native `FulfillmentTask` and native timeline/history complete enough that admin/customer order reads do not need Hub for normal paid one-time orders.

Deliverables:

- Native task generation idempotency keyed by order/occurrence/date.
- Native order timeline projection from Customer App order events, native mirror writes, task writes, and review entries.
- Native-first replacement for Hub-backed admin/customer detail reads with Hub fallback visible but not required for normal review.
- Subscription occurrence model design remains explicit; do not collapse parent subscription status into occurrence status.

Acceptance:

- New paid one-time delivery order has native order, native task, native timeline, and admin/customer-safe projection without opening Hub.
- Hub fallback remains visible and deduped.
- No duplicate native tasks.

### G28 — Native production demand and procurement read parity

Goal: derive production and ingredient/procurement needs from native orders/tasks instead of Hub summaries.

Deliverables:

- Native Recipe/Bundle/IngredientYield read model or equivalent migration map.
- Demand engine shadow comparison against Hub for a bounded schedule window.
- Make-to-order shortfall handling as procurement-needed, not automatic PO creation.
- Read-only production planning parity first.

Acceptance:

- Native demand totals match Hub for selected products/orders/subscription occurrences.
- No inventory deduction or PO creation.
- Mismatches classify to catalog/recipe/order/task source.

### G29 — Native production command framework

Goal: replace Hub bridge commands for production lifecycle after native demand/read parity exists.

Deliverables:

- Native previews for start, complete, verify, pack, bottle cascade, ingredient usage correction.
- `CommandLog` idempotency and safe response contract.
- One-record owner/allowlist pilots only.
- Compliance log write parity for verify.

Acceptance:

- Native command results match Hub semantics on approved pilot records.
- Locked/completed/verified records are guarded.
- No inventory deduction unless separately approved.

### G30 — Native refund, cancellation, and subscription parity

Goal: remove high-risk money/subscription Hub dependencies.

Deliverables:

- Native refund/cancellation service with Stripe event idempotency.
- Partial refund review queue behavior.
- Subscription occurrence lifecycle and one billing-cycle shadow run.
- No automatic customer notification unless notification policy is approved.

Acceptance:

- Duplicate refund/cancel events are skipped.
- Full refund cascades only where safe.
- Partial refund never silently mutates production demand without review.
- Subscription cycle completes without Hub repair dependency.

### G31 — Delivery/driver/native notification parity

Goal: replace Hub delivery state transitions only after native tasks and notification idempotency exist.

Deliverables:

- Native assign/unassign, out-for-delivery, delivered, unable-to-deliver service.
- Proof/drop metadata policy.
- Notification idempotency and customer-facing status policy.
- Route optimization policy: native replacement, third-party provider, or defer outside Hub retirement.

Acceptance:

- Driver/admin task transitions are idempotent and role-gated.
- Delivered does not notify twice.
- Proof/drop data is not exposed in unsafe contexts.

### G32 — Non-order domain ownership decision and migration

Goal: decide whether loyalty, events, customers, bag returns, rewards, and credits are part of Hub retirement or a separately scoped backend consolidation.

Deliverables:

- Domain ownership matrix.
- Ledger policy for credits/rewards.
- Bag return request-to-credit lifecycle.
- Customer/user sync retirement plan.

Acceptance:

- No remaining required Customer App runtime path calls Hub for these domains, or they are explicitly declared out-of-scope for initial Hub retirement.

### G33 — Hub fallback-only cutover and retirement

Goal: disable Hub as active writer, retain fallback/archive temporarily, then retire.

Deliverables:

- Kill switches and rollback plan.
- Per-function no-call monitoring for one billing cycle.
- Hub read-only archive/export plan.
- Deletion list for bridge endpoints and secrets.

Acceptance:

- No Hub writes observed during the monitoring window.
- Native logs/queues cover diagnostics and repair.
- Stripe/Shopify/provider webhooks target Customer App canonical services.
- Hub secrets can be removed without breaking Customer App operations.

## Immediate Recommendation

Proceed next with **G26A: Native order write gateway parity harness**.

This should not broadly enable native writes. The first G26A PR should be a safe but meaningful code migration:

- centralize the native order-write planning contract
- compare native output against Hub/safeSync expectations for representative sources
- make mismatch reporting actionable
- keep Hub bridge live
- keep broad native writer disabled
- allow only dry-run/shadow output unless an owner/test pilot is separately approved

This is the most important path because Hub cannot retire until the Customer App can safely own operational order writes. UI/read improvements are useful, but they do not remove the Hub as the operational source of truth.

## Current Hold Lines

Do not retire or disable Hub bridge yet.

Do not enable broad native safeSync writer access until:

1. G26 parity harness passes for representative cases.
2. G27 native task/timeline read projection is complete for one-time paid orders.
3. G28 production demand shadow comparison is clean.
4. G30 refund/subscription high-risk paths have explicit parity and rollback.
5. No-call monitoring shows Hub is fallback/archive only.
