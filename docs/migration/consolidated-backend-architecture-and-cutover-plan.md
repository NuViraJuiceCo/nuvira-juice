# Consolidated Backend Architecture And Cutover Plan

Status: G21A alignment audit
Date: 2026-05-25
Scope: documentation-only alignment of the current Customer App to Operations Hub bridge work against the final single-backend target architecture.

## Controlling Conclusion

The current migration has made real progress, but most of that progress is transitional. It has built a controlled Customer App to Operations Hub command bridge:

- Customer App admin wrappers.
- Hub bearer-auth endpoints.
- Read-only previews.
- Fake/test validation.
- Feature-flagged, owner/allowlisted one-record pilots.
- Command logs and idempotency around selected operations.

That bridge is valuable because it proves contracts, exposes missing guardrails, and allows safe one-record operational pilots. It is not the final architecture. The final architecture is one Customer App backend that owns operational data and logic directly. Operations Hub must stop being a separate backend source of truth. All Hub guardrails and operational semantics must be preserved or improved inside the Customer App backend before Hub endpoints and sync loops are retired.

This plan therefore treats every current bridge endpoint as temporary unless explicitly marked final-state native Customer App ownership.

## 1. Current Migration Reality Check

| Completed area | Current classification | Why it matters | Final-state gap |
|---|---|---|---|
| Hub note append from Customer App | Transitional Customer App wrapper to Hub | Customer App can safely trigger a Hub note append. | Move note/audit storage and command handler into Customer App backend or canonical operational log. |
| Ops Alert acknowledge/resolve/dismiss | Transitional Customer App wrapper to Hub | Useful role-based admin action. | OperationalAlert/HubAlert ownership must be unified in Customer App backend. |
| FulfillmentTask assign/unassign | Transitional wrapper plus owner/allowlist pilot pattern | Proves task mutation with command logging. | FulfillmentTask entity and assignment command must move native to Customer App backend. |
| FulfillmentTask Out For Delivery | Transitional wrapper/Hub command | Operational-only state transition proven safely. | Driver and admin task transitions must become native Customer App services. |
| FulfillmentTask Delivered fake path | Fake/test-only proof | Validated customer-facing delivered guard style without real customer impact. | Real delivered/customer notification remains unmigrated and gated. |
| Scoped delivery sync helper | Transitional sync helper | Proves narrow readback. | Hub-to-Customer sync must be retired once Customer App owns delivery state. |
| Real customer-facing Delivered | Not migrated / held | No eligible real candidate; notification policy not approved. | Requires dedicated Customer App-native customer status/notification flow. |
| Start Production fake path | Fake/test-only proof | Validated command shape. | Start command currently still executes in Hub. |
| Real Start Production pilot | Owner/allowlist pilot; Hub command still source of truth | Batch `BATCH-20260522-RE-NU` moved to in production through guarded Hub command. | ProductionBatch and production commands must move native. |
| Complete Production pilot | Owner/allowlist pilot; Hub command still source of truth | Batch completed with actual units and QC fields. | Complete command still Hub-owned; Customer App only wraps. |
| Verify/Compliance pilot | Owner/allowlist pilot; Hub command still source of truth | Batch verified/logged, locked, compliance metadata created. | Compliance log creation and lock semantics must migrate native. |
| Staff-on-duty correction | Owner/allowlist pilot; Hub command still source of truth | Narrow data correction proved. | Future correction tools belong in Customer App backend. |
| Verify FulfillmentTask pack pilot | Owner/allowlist pilot; Hub command still source of truth | One task moved Scheduled to Packed. | Pack cascade semantics still Hub-owned. |
| ShopifyOrder bottled cascade | Read-only preview/held | Subscription/multi-delivery risk correctly blocked. | Need occurrence-level model before any parent status cascade. |
| Subscription occurrence production preview | Read-only preview only | Defined safer occurrence-level path. | Occurrence status write command not built; final occurrence model not native. |
| Inventory deduction preview/command/wrapper | Bridge built; live deduction held | Correctly blocked by missing ingredient usage/stock. | InventoryItem and procurement logic still Hub-owned. |
| Ingredient usage preview and correction | Owner/allowlist pilot; Hub command still source of truth | Batch gained 5 recipe-derived usage rows; no stock mutation. | Ingredient capture/correction must move native and eventually integrate with complete/verify. |
| Admin-safe preview policy | Policy finalized | Read previews may include useful admin inventory/customer/order context. | Must be codified in Customer App backend preview/command response standards. |
| safeSyncOrderUpdate | Not migrated | Hub remains order write gateway. | This is a critical blocker to Hub retirement. |
| Order ingestion/pull bridge | Not migrated | Customer App still syncs/pushes and Hub still ingests/pulls. | Customer App backend must create/update operational records directly. |
| Refund/Stripe reconciliation | Not migrated | Hub still owns important refund cascades. | Move refund command and event handling into Customer App backend with identical idempotency. |
| Recalculation, production demand, fulfillment task generation | Not migrated | Hub planning still source of truth. | Move demand and task generation native with shadow comparisons. |
| Compliance logs beyond verified batch pilot | Not migrated | Hub-only entities still exist. | Migrate specific log types and audit requirements. |

Transitional paths that still leave Hub alive:

- Every Customer App `*Admin*` wrapper that forwards to a Hub `*ForCustomerApp` function.
- Every Hub preview helper, even read-only, because it still reads Hub as source of truth.
- Every Hub command with feature flags and allowlists.
- Every Customer App sync function that pushes to or pulls from Hub.
- Every Hub pull/push/customer-app-event endpoint.

## 2. Entity Ownership Matrix

| Entity | Current owner | Current writers | Current readers | Migration status | Final owner | Gap to final architecture | Risks | Next action |
|---|---|---|---|---|---|---|---|---|
| ShopifyOrder | Hub operationally; Customer App has partial mirror/entity | Hub `safeSyncOrderUpdate`, `processStripeRefund`, Shopify/POS ingestion, production/driver functions; Customer App sync wrappers | Hub production, fulfillment, refund, driver, dashboards; Customer App admin reads through Hub wrappers | Mostly Hub source of truth | Customer App backend canonical operational order record | Port `safeSyncOrderUpdate`, lock rules, status semantics, sync logs, review queue | Duplicate orders, stale payment state, subscription corruption | G21B migrate safeSync service design/test harness |
| FulfillmentTask | Hub operational source of truth; Customer App has separate occurrence/task model | Hub task generation, assignment, driver, pack commands; Customer App wrappers | Hub driver/ops/production; Customer App wrappers/admin summaries | Transitional bridge for selected actions | Customer App backend | Native task lifecycle, occurrence matching, driver actions, proof/drop policies | Premature customer status, wrong occurrence, duplicate tasks | Migrate task generation and driver command service after order ownership |
| ProductionBatch | Hub | Hub start/complete/verify/correction/inventory functions | Hub production pages and Customer App wrappers/previews | Bridge pilots proven | Customer App backend | Move entity, lifecycle commands, audit trail, locks, compliance linkage | Compliance errors, inventory math errors | Port lifecycle after order/demand model shadow run |
| HubCommandLog | Hub | Hub bridge commands | Hub command idempotency and audit | Transitional but critical | Generalized `CommandLog` in Customer App backend | Preserve existing records; future commands log natively | Losing idempotency history | Add canonical CommandLog and import/backfill mapping |
| OrderSyncLog | Both apps, divergent meanings | Customer App sync functions; Hub `safeSyncOrderUpdate`/refund | Sync dashboards, repair tools | Not consolidated | Customer App backend `OrderSyncLog` or `IntegrationEventLog` | One log model for order event processing and quarantines | Retry loops, no audit of dropped events | Design unified log before order ingestion cutover |
| OrderReviewQueue | Hub | `safeSyncOrderUpdate`, refund/quality guards, queue tools | Hub admin review | Not migrated | Customer App backend operational queue | Port incident types, dedupe keys, owner actions | Low-quality orders bypass review | Migrate with safeSync |
| Bundle | Hub production bundle model; Customer App has SubscriptionBundle | Hub recipe/demand/recalc | Production planning | Not migrated | Customer App backend catalog/production model | Reconcile customer bundles vs production bundles | Bundle decomposition mismatch | Build bundle equivalence tests |
| Recipe | Hub | Hub admin/production | Ingredient demand, preview/correction | Not migrated except bridge reads | Customer App backend operations | Move recipes and normalize ingredient matching | Wrong ingredient math | Port with IngredientYield and test exact outputs |
| ManualProductionBatch | Hub | Hub manual batch UI/functions | Recalc/planning | Not migrated | Customer App backend operations | Need command boundaries for manual/internal batches | Manual sources corrupt real rollout | Dedicated audit before mutation |
| InventoryItem | Hub | Hub inventory UI; bridge deduction command not live | Inventory preview, demand, deduction | Preview/command bridge only | Customer App backend operations | Move stock, supplier fields, stock adjustment logs | Inventory/PO mutation risk | Native preview first, live deductions later |
| PurchaseOrder | Hub/manual | Hub PO UI/manual updates | Inventory planning | Not migrated | Customer App backend procurement | Make-to-order procurement model needed | Accidental PO creation/stock update | Procurement audit before automation |
| IngredientYield | Hub | Hub inventory/recipe admin | Ingredient demand/correction/deduction | Matching patched in Hub | Customer App backend operations | Move yield records and normalizer | Unit conversion errors | Port matcher shared across previews/commands |
| BatchComplianceLog | Hub | Hub verify command | Compliance reports | Verified pilot created one log | Customer App backend compliance | Native compliance log create/lock/audit | Regulatory/audit gap | Port verify/log after compliance entity migration |
| SanitationLog | Hub | Hub compliance UI/functions | Compliance dashboards | Not migrated | Customer App backend compliance | Preserve required fields and manager review | Missing pre-op sanitation evidence | Audit UI and create native forms |
| TemperatureLog | Hub | Hub compliance UI/functions | Compliance/daily checklist | Not migrated | Customer App backend compliance | Preserve out-of-range corrective action links | Food safety record gap | Port with corrective-action flow |
| DailyChecklist | Hub | Hub compliance UI/functions | Compliance dashboard | Not migrated | Customer App backend compliance | Preserve shift/date checklist semantics | Incomplete daily audit | Port manual/admin-only first |
| CorrectiveActionLog | Hub | Hub compliance UI/functions | Compliance logs | Not migrated | Customer App backend compliance | Preserve links from pH/temp/CCP | Corrective action loss | Port as locked compliance record |
| CCPLog | Hub | Hub compliance UI/functions | Compliance dashboards | Not migrated | Customer App backend compliance | Preserve CCP point/result/limits | HACCP record gap | Port with verify tests |
| pHLog | Hub | Hub compliance UI/functions | Compliance/verify | Not migrated | Customer App backend compliance | Align with ProductionBatch pH fields | Duplicated pH truth | Decide pHLog vs embedded batch pH source |
| ComplianceLog / ComplianceDoc / ComplianceAlert / HACCPPlanReview | Hub | Hub compliance functions/UI | Compliance workflows | Not migrated | Customer App backend compliance | Inventory of actual use needed | Silent compliance loss | G25 compliance migration audit |
| Supplier | Hub | Inventory/procurement UI | Inventory/PO | Not migrated | Customer App backend procurement | Move supplier data without private contract leakage | Procurement mismatch | Include in inventory/procurement migration |
| IntegrationUsageLog / RepairAuditLog / StripeEventLog | Hub | Hub integration/repair/webhook tools | Audits/repairs | Not migrated | Customer App backend integration/audit | Unify with CommandLog/EventLog | Lost forensic trace | Preserve/import before cutover |
| BagReturn | Both apps | Customer requests, Hub driver verification/sync | Customer/driver/admin | Not consolidated | Customer App backend lifecycle entity | One request-to-credit lifecycle | Credits/customer state risk | Dedicated bag return/credit audit |
| Product | Both apps | Customer catalog, Hub product/recipe sync | Storefront/production | Split | Customer App backend catalog plus ops fields | Public vs production metadata boundary | Catalog/recipe mismatch | Catalog ownership audit |
| LoyaltyMember/UserPoints/NuViraCredit/Rewards/RewardTier | Both apps | Customer checkout/rewards and Hub sync | Customer and admin | Not in current bridge scope | Customer App backend ledger | Ledger model and sync retirement | Money-adjacent credits | Owner-only dedicated audit |

## 3. Critical Function Mapping

| Function / flow | Actual repo path | Classification | Final action |
|---|---|---|---|
| safeSyncOrderUpdate | Hub `base44/functions/safeSyncOrderUpdate/entry.ts` | Migrate as-is into Customer App backend internal service | Preserve lock, field ownership, quarantine, logging, idempotency; make it the only order write gateway. |
| processStripeRefund | Hub `base44/functions/processStripeRefund/entry.ts` | Migrate/refactor | Customer App refund service should own refund cascades and call native safeSync/order/task/batch services. |
| pullOrdersFromCustomerApp | Hub `base44/functions/pullOrdersFromCustomerApp/entry.ts` | Retire | Obsolete when Customer App writes operational records directly. |
| receiveCustomerAppEvent | Hub `base44/functions/receiveCustomerAppEvent/entry.ts` | Retire after native event bus | Replace with internal Customer App event dispatch. |
| stripeSessionReconciliation | Hub `base44/functions/stripeSessionReconciliation/entry.ts` | Migrate/refactor | Move reconciliation into Customer App payment service with Stripe event log/idempotency. |
| startBatchProduction | Hub `base44/functions/startBatchProduction/entry.ts` | Migrate/refactor | Native Customer App production lifecycle service. |
| completeBatchProduction | Hub `base44/functions/completeBatchProduction/entry.ts` | Migrate/refactor | Native complete command; include ingredient capture decision. |
| verifyAndLogBatch | Hub `base44/functions/verifyAndLogBatch/entry.ts` | Migrate/refactor | Native compliance-only verify first, then cascades. |
| bottleProductionVerifyShopifyOrderForCustomerApp | Hub bridge | Keep temporarily as bridge | Replace with native non-subscription order cascade; subscription occurrence remains separate. |
| packProductionVerifyFulfillmentTasksForCustomerApp | Hub bridge | Keep temporarily as bridge | Replace with native task pack command. |
| correctProductionBatchStaffOnDutyForCustomerApp | Hub bridge | Keep temporarily as bridge | Replace with native correction command or admin edit with CommandLog. |
| correctProductionIngredientUsageForCustomerApp | Hub bridge | Keep temporarily as bridge | Replace with native ingredient correction/capture command. |
| deductProductionInventoryForCustomerApp | Hub bridge | Keep temporarily as bridge; live deduction held | Replace with native inventory deduction command after procurement policy. |
| previewProductionInventoryDeductionForCustomerApp | Hub preview bridge | Keep temporarily as bridge | Replace with native read-only preview. |
| previewProductionIngredientUsageCorrectionForCustomerApp | Hub preview bridge | Keep temporarily as bridge | Replace with native recipe-derived preview. |
| previewProductionBatchVerifyForCustomerApp | Hub preview bridge | Keep temporarily as bridge | Replace with native verify preview. |
| previewProductionBatchCompleteForCustomerApp | Hub preview bridge | Keep temporarily as bridge | Replace with native complete preview. |
| previewProductionBatchStartForCustomerApp | Hub preview bridge | Keep temporarily as bridge | Replace with native start preview. |
| previewNonSubscriptionBottledCascadeCandidatesForCustomerApp | Hub preview bridge | Keep temporarily as bridge | Replace with native candidate finder after order ownership. |
| previewProductionVerifyCascadesForCustomerApp | Hub preview bridge | Keep temporarily as bridge | Replace with native cascade preview. |
| previewSubscriptionFulfillmentProductionStatusForCustomerApp | Hub preview bridge | Keep temporarily as bridge | Replace with native occurrence preview/write model. |
| recalculateProductionBatches | Hub `base44/functions/recalculateProductionBatches/entry.ts` | Migrate/refactor | Native demand-generation service with shadow comparison. |
| autoGenerateProductionBatch | Hub `base44/functions/autoGenerateProductionBatch/entry.ts` | Migrate/refactor | Native batch generation after recipe/bundle/order model. |
| calculateIngredientNeeds | Hub `base44/functions/calculateIngredientNeeds/entry.ts` | Migrate/refactor | Native ingredient-demand service. |
| calculateIngredientDemandFixed | Hub `base44/functions/calculateIngredientDemandFixed/entry.ts` | Migrate/refactor | Compare to `calculateIngredientNeeds`; merge into one tested engine. |
| createFulfillmentTasks | Hub disabled legacy creator | Retire or replace | Keep disabled; final task generation belongs to Customer App order service. |
| syncFulfillmentTasksFromOrders | Hub | Retire after native task generation | Use only for migration comparison/repair until cutover. |
| recordDriverDelivery | Hub | Migrate/refactor | Native driver proof/drop/delivery service; customer-facing effects gated. |
| receiveDriverStatusUpdate | Hub | Migrate/refactor | Native driver endpoint; no cross-backend bridge. |
| updateDriverDeliveryTask | Hub | Migrate/refactor | Native task status command with proof/drop audit. |
| markFulfillmentTaskOutForDeliveryForCustomerApp | Hub bridge | Keep temporarily as bridge | Replace with native task transition. |
| markHubOrderDeliveredForCustomerAppSync | Hub bridge | Keep temporarily as bridge; real customer path held | Replace with native order/customer status flow with notifications. |
| monitorNewOrderChain | Hub/Customer monitoring family | Migrate/refactor | Native observability over single backend. |
| systemHealthCheck | Hub | Migrate/refactor | Native health checks. |
| operationsOversight | Hub | Migrate/refactor | Native ops dashboard/monitor. |
| checkQueueBacklog | Hub | Migrate/refactor | Native queue monitor. |
| orderReviewQueueAlert | Hub | Migrate/refactor | Native operational alert tied to OrderReviewQueue. |

Functions with names that differ are mapped by current file discovery in the two repos. Customer App wrappers with matching names, such as `startAdminProductionBatch`, `completeAdminProductionBatch`, `verifyAdminProductionBatch`, `packAdminProductionVerifyFulfillmentTasks`, `bottleAdminProductionVerifyShopifyOrder`, `deductAdminProductionInventory`, and `correctAdminProductionIngredientUsage`, are not final-state functions; they are bridge callers.

## 4. safeSyncOrderUpdate Final Migration Plan

Current location: Hub `base44/functions/safeSyncOrderUpdate/entry.ts`.

Current callers and dependencies:

- Hub ingestion/pull paths such as `pullOrdersFromCustomerApp`, `receiveCustomerAppEvent`, `ingestCustomerAppOrder`, `receiveOrderFromCustomerApp`, POS/Shopify ingestion, repair/rebuild tools, and refund/reconciliation flows.
- Writes Hub `ShopifyOrder`.
- Creates or updates `OrderReviewQueue`.
- Creates `OrderSyncLog`.
- Uses internal secret trust for selected internal sources.

Preserved behavior requirements:

- Idempotency via Stripe event id, command/event id, Stripe checkout session id, payment intent id, subscription id, and internal order id matching.
- `order_lock_status` enforcement through `LOCK_FROZEN_FIELDS`.
- `FIELD_OWNERSHIP` by source.
- Subscription hard lock: no downgrade of source channel, no removal of `stripe_subscription_id`, no erasure of line items/fulfillments.
- Payment guardrails: paid cannot be downgraded by stale Customer App payloads; refund flow is the approved downgrade path.
- `production_snapshot` lock once scheduled/in production/out for delivery/fulfilled.
- Address quality gate and fallback.
- POS order handling.
- Line item normalization and preservation.
- Manual override guard.
- OrderReviewQueue integration with dedupe keys.
- OrderSyncLog integration.
- Unknown/low-quality payload quarantine.

Final location:

- Customer App backend internal module/service, not a public Hub endpoint.
- Suggested public function boundary: only webhooks/admin commands call service functions; frontend does not write order fields directly.
- Keep the function name `safeSyncOrderUpdate` initially to reduce migration risk, but move to a shared internal service file if Base44 supports module reuse. If Base44 requires function boundaries, create `internalSafeSyncOrderUpdate` and make it service-role only.

Final callers:

- Customer App `stripeWebhook`.
- Customer App Shopify/POS webhook/adapter if still used.
- Customer App subscription lifecycle functions.
- Customer App refund/reconciliation service.
- Customer App admin repair tools.
- Customer App production/fulfillment commands only through owned field updates.

Hub endpoints obsolete after migration:

- `pullOrdersFromCustomerApp`
- `receiveCustomerAppEvent`
- `receiveOrderFromCustomerApp`
- `ingestCustomerAppOrder`
- `customerAppEventPublicGateway`
- `fullSyncFromCustomerApp`
- push/pull order status endpoints
- Customer App `syncOrderToHub`, `syncSubscriptionWithFulfillments`, `syncRefundToHub`, and retry/manual sync functions

Authentication change:

- Replace cross-backend Bearer sync secret with internal Customer App service-role execution.
- External providers authenticate only at webhook boundaries: Stripe signature, Shopify HMAC, admin user session, or explicitly scoped owner repair token.
- Command callers derive actor from authenticated user or provider event, never from browser-supplied trusted fields.

Required tests:

- Lock frozen fields by status.
- Field ownership reject/filter matrix.
- Subscription hard lock cases.
- Paid status stale downgrade blocked.
- Approved refund downgrade allowed.
- Production snapshot mismatch blocked.
- Incomplete/low-quality order quarantined.
- POS order accepted and marked source correctly.
- Duplicate Stripe events/idempotency.
- Manual override preservation.
- OrderReviewQueue dedupe key update instead of duplicate.
- OrderSyncLog created for create/update/reject/filter/quarantine.

## 5. Order Ingestion / Sync Retirement Plan

Old flow:

1. Stripe webhook creates Customer App order or subscription.
2. Customer App calls `syncOrderToHub` or `syncSubscriptionWithFulfillments`.
3. Hub pulls or receives Customer App data.
4. Hub routes through `safeSyncOrderUpdate`.
5. Hub creates operational `ShopifyOrder`, `FulfillmentTask`, and production demand.
6. Customer App later reads status back through sync/readback paths.

Transitional current flow:

1. Customer App remains commerce/customer UI owner.
2. Hub remains operational source of truth.
3. Customer App wrappers call Hub commands for selected operations.
4. Hub command logs/idempotency protect one-record pilots.
5. Sync loops still exist and Hub is still required.

Final flow:

1. Customer App order/subscription is created by Stripe webhook or checkout service.
2. Customer App backend writes/updates the canonical operational order record directly.
3. Native `safeSyncOrderUpdate` runs internally.
4. FulfillmentTasks are generated internally.
5. ProductionBatch demand is generated internally.
6. OrderSyncLog and OrderReviewQueue are recorded in the Customer App backend.
7. Hub no longer pulls from Customer App and no longer receives Customer App events.

Retirement steps:

1. Port `safeSyncOrderUpdate` read-only test harness and fixtures.
2. Add native Customer App operational entities or reconcile current entity schemas.
3. Shadow-write new orders to native operational records while still syncing Hub.
4. Compare Customer App native result to Hub record for one-time, subscription, POS, refund, and repair cases.
5. Cut over order creation ownership.
6. Disable Hub pull/push endpoints.
7. Monitor one full subscription/billing cycle.
8. Delete bridge endpoints only after no calls are observed.

Risks:

- Duplicate ghost subscription orders.
- Customer App local Order and operational ShopifyOrder drift.
- Address/date/fulfillment schedule mismatch.
- Review queue bypass.
- Retry loops creating stale records.

Tests:

- One-time order created once.
- Subscription order creates one parent plus correct occurrences.
- Duplicate webhook no-op.
- Hub disabled path does not lose orders during shadow run.
- Low-quality payload quarantines.
- FulfillmentTasks and production demand match Hub output.

## 6. Refund / Stripe Reconciliation Plan

Current Hub logic:

- `processStripeRefund` locates Hub order by refund/payment/order identifiers.
- Full refund cascades to ShopifyOrder payment/production status, cancels FulfillmentTasks, removes order sources from ProductionBatches, recalculates planned units, and writes OrderSyncLog.
- Partial refunds require review rather than full automatic cascade.
- `stripeSessionReconciliation`, Stripe recovery, and audit helpers identify missed or inconsistent Stripe events.

Final Customer App backend logic:

- Stripe webhook and admin refund functions call a native refund service.
- Refund service uses the canonical operational order record.
- Full refund updates payment state through safeSync, cancels uncompleted FulfillmentTasks, removes demand from non-locked future ProductionBatches, and writes review entries for ambiguous/locked production.
- Partial refund creates OrderReviewQueue entry and does not silently alter production demand unless the refund contract explicitly maps line-item quantities.
- Stripe event log/idempotency prevents duplicate cascades.

Preserved idempotency:

- Stripe event id.
- Stripe refund id.
- Payment intent/charge id.
- Internal command/request id for manual refund.
- CommandLog/OrderSyncLog records with duplicate/skipped semantics.

Preserved cascade behavior:

- Full refund cancels future tasks and excludes order from future production planning.
- Scheduled/in production/verified batches are not destructively recalculated without explicit review.
- Customer-facing refund notifications and loyalty/credit reversals require separate owner-approved policy.

Required tests:

- Full refund before production scheduled.
- Full refund after production scheduled.
- Full refund when task already delivered.
- Partial refund creates review queue.
- Duplicate refund event is skipped.
- Missing order creates review queue.
- ProductionBatch planned units update only when safe.

## 7. Production Lifecycle Final Migration Plan

| Flow | Current status | Proven pilots | Remaining Hub dependency | Final ownership path | Tests |
|---|---|---|---|---|---|
| Start production | Hub bridge command | Fake path and real `BATCH-20260522-RE-NU` start | Hub ProductionBatch write, HubCommandLog | Native Customer App production service with feature flags only during migration | status transition, idempotency, locks, no side effects |
| Complete production | Hub bridge command | Fake path and real complete | Hub writes actual_end_time, completed_by, actual_units, QC | Native complete command; decide ingredient capture at complete | required fields, idempotency, no verify/cascade |
| Verify/log production | Hub bridge command | Real compliance-only verify | Hub BatchComplianceLog/lock/status | Native compliance-only verify first, cascades split | log creation, lock, idempotency, compliance fields |
| Pack task cascade | Hub bridge command | One task Scheduled to Packed | Hub task write | Native pack command and occurrence model | explicit task allowlist, no parent order on subscription |
| Bottle order cascade | Hub bridge built/held | Boundary only; no real pilot | Hub order status | Native non-subscription only first; subscription occurrence separate | non-sub only, subscription blocked |
| Ingredient usage correction | Hub bridge command | Real correction wrote 5 rows | Hub recipe/yield/batch | Native ingredient capture/correction | recipe math, no stock mutation |
| Inventory deduction | Hub bridge command built; live held | Preview blocked until ingredient usage/stock policy | Hub InventoryItem | Native inventory command after procurement model | no deduction without usage, stock policy |
| Recalculation | Hub | No migration pilot | Hub demand engine | Native demand engine with shadow compare | output parity across orders/subscriptions/manual |
| Manual batches | Hub | Guarded out of first rollout | Hub ManualProductionBatch | Dedicated native manual batch lifecycle | no accidental customer source mixing |
| Compliance logs | Hub | One BatchComplianceLog through verify | Hub compliance entities | Native compliance module | auditability and lock tests |
| Recipe/Bundle math | Hub | Matching normalization patched in Hub | Hub Recipe/Bundle/IngredientYield | Native formula engine | bundle decomposition parity |

Every command currently built in the bridge is transitional until its logic writes Customer App owned entities directly.

## 8. Fulfillment / Driver Final Migration Plan

Current bridge status:

- Assignment/unassignment, Out For Delivery, Delivered fake path, and Packed have bridge commands and selected pilots.
- Real customer-facing Delivered remains held.
- Proof/drop and unable-to-deliver are high-risk and not migrated.
- Route optimization remains outside the current bridge.

Final Customer App backend flow:

1. Native order ingestion generates FulfillmentTasks.
2. Native admin assignment sets driver and route context.
3. Driver portal reads only assigned tasks.
4. Out For Delivery updates task status and, only after customer-facing policy, customer order projection/status history.
5. Delivered records proof/drop if approved, updates task, updates customer-safe order projection, and sends notification only through idempotent notification service.
6. Unable To Deliver records reason, keeps task/order in review state, and does not bill/refund/credit automatically.

Hub endpoints to retire:

- `updateFulfillmentTaskAssignmentForCustomerApp`
- `markFulfillmentTaskOutForDeliveryForCustomerApp`
- `recordFulfillmentTaskDeliveredForCustomerApp`
- `markHubOrderDeliveredForCustomerAppSync`
- `recordDriverDelivery`
- `receiveDriverStatusUpdate`
- `updateDriverDeliveryTask`
- route/driver sync endpoints after native driver service exists

Gated areas:

- Proof/drop evidence.
- Customer-facing delivered notifications.
- Unable-to-deliver.
- Bag returns/credits.
- Route optimization.

Tests:

- Task generated once per occurrence.
- Driver sees assigned tasks only.
- Out For Delivery idempotent.
- Delivered idempotent and notification idempotent.
- Unable To Deliver creates review path.
- Proof/drop not exposed unless approved.
- Subscription occurrence does not update parent status prematurely.

## 9. Bundle / Recipe / Ingredient Calculation Plan

Current Hub behavior:

- `Bundle` decomposes bundles into product quantities.
- `Recipe` stores per-bottle ingredients and yield factor.
- `IngredientYield` maps produce to purchase-unit yields.
- `calculateIngredientNeeds` and `calculateIngredientDemandFixed` compute demand from ShopifyOrders, subscription fulfillments, manual batches, recipes, bundles, and inventory.
- `recalculateProductionBatches` creates/updates demand and guards against double-counting subscription tasks and orders.

Final calculation flow:

1. Customer App backend canonical order/fulfillment occurrence is source input.
2. Product/bundle decomposition resolves bundle components.
3. Recipe engine expands products to ingredients.
4. IngredientYield converts usage to purchase/procurement units.
5. Make-to-order stock shortfall is classified as procurement needed, not a preview blocker.
6. Ingredient usage capture writes actual usage to ProductionBatch at complete or through correction command.
7. Inventory deduction only runs from approved usage rows and stock/procurement policy.

Procurement-needed flow:

- Preview returns item id/name, current stock, unit, proposed deduction, projected stock, shortfall, yield match, and procurement flag.
- No PurchaseOrder is created automatically until procurement workflow is audited.
- Negative stock/backorder policy requires explicit owner decision.

Tests:

- Re-Nu recipe math matches Hub: Cucumber, Green Apple, Red Apple, Celery, Kale.
- Red Apple singular/plural matching resolves to Red Apples InventoryItem/Yield.
- Bundle decomposition identical to Hub.
- Subscription multi-delivery quantities split correctly.
- Make-to-order zero stock does not block usage correction preview.
- Inventory deduction remains blocked without usage rows and approved stock policy.

## 10. Compliance Flow Migration Plan

Current Hub ownership:

- BatchComplianceLog is created by verify/log production.
- SanitationLog, TemperatureLog, DailyChecklist, CorrectiveActionLog, CCPLog, pHLog, ComplianceLog, ComplianceDoc, ComplianceAlert, and HACCPPlanReview are Hub-only.
- ProductionBatch contains embedded QC, pH, sanitation, staff, equipment, ingredient, and audit fields.

Final Customer App backend ownership:

- Compliance entities migrate as operations-only Customer App backend records.
- Batch verification creates locked BatchComplianceLog and links it to ProductionBatch.
- Sanitation/temp/daily/CCP/corrective logs remain admin/ops-only initially.
- Customer App customer-facing UI must not expose compliance notes, raw logs, or internal corrective action details.

Migrate as-is first:

- BatchComplianceLog.
- ProductionBatch verification fields.
- TemperatureLog and CorrectiveActionLog link semantics.
- SanitationLog and DailyChecklist required fields.
- CCPLog and pHLog if currently used by compliance pages.

Manual/admin-only initially:

- HACCPPlanReview.
- ComplianceDoc.
- ComplianceAlert.
- LabelAllergenReview.

Auditability requirements:

- Immutable or locked compliance logs after verification.
- Actor, timestamp, request id, source, and before/after status in CommandLog.
- No raw provider/customer payloads in compliance logs.
- Reconciliation path for partial success.

Tests:

- Verify creates exactly one BatchComplianceLog.
- Duplicate verify skips.
- Locked batch cannot be reverified.
- Required staff/pH/QC fields enforced.
- Corrective action link present for failed temp/pH/CCP.

## 11. Logging / Auditability Plan

Final ownership:

- `HubCommandLog` becomes generalized `CommandLog` or remains named `HubCommandLog` during compatibility migration. Recommendation: create `CommandLog` with a `legacy_source` field, then import/retain HubCommandLog records read-only.
- `OrderSyncLog` remains, but semantics become internal event/write log, not cross-backend sync.
- `OrderReviewQueue` remains as manual intervention queue.
- `ProductionBatch.audit_trail` remains embedded, but CommandLog is the durable idempotency/audit source.
- Customer App `status_history` remains customer-facing order projection history only.
- Notification idempotency logs must be explicit for every email/SMS/push path.

Existing records:

- Preserve HubCommandLog, OrderSyncLog, OrderReviewQueue, ProductionBatch, compliance, and inventory histories before cutover.
- Add migration import/backfill ids so old records can be traced to the original Hub entity id.

Future command logging:

- Every internal command has command_type, target_entity, target_id, idempotency_key, actor, source, status, started_at/completed_at, safe metadata, and error_code.
- No raw order payloads, secrets, provider payloads, stack traces, payment tokens, or customer PII beyond approved operational summary fields.

Idempotency strategy:

- Provider webhooks: provider event id plus object id.
- Admin commands: request_id plus target id plus command type.
- Repair tools: owner-approved request_id plus dry-run hash.
- Notifications: notification type plus recipient plus order/event id.

## 12. Endpoint Retirement Plan

Retirement rules:

| Family | Current usage | Replacement path | Retirement condition | Deletion risk |
|---|---|---|---|---|
| `*ForCustomerApp` Hub bridge commands | Customer App admin wrappers call Hub | Native Customer App backend command | Native command passes preview, one-record pilot, idempotency, and parallel audit | Medium/high |
| Hub preview helpers | Customer App wrappers read Hub | Native Customer App read-only previews | Native previews match Hub output for live/fake cases | Low/medium |
| Customer App `*Admin*` wrappers to Hub | Browser-safe server-side bridge | Native admin command wrapper around Customer App service | Hub command no longer called for 1 billing cycle | Low |
| Customer-to-Hub sync functions | Cross-backend order/status/customer sync | Internal Customer App event processing | Native order ingestion live and no sync retries needed | High |
| Hub-to-Customer pull/push functions | Cross-backend readback/sync | Direct Customer App reads | Customer App owns operational state | High |
| Stripe/refund/reconciliation | Provider/money side effects | Customer App payment/refund service | Stripe webhook cutover with duplicate-event tests | High |
| Shopify/provider functions | Provider side effects | Customer App provider adapter or retire | Provider policy and auth tested | High |
| Repair/cleanup/delete/bulk | One-off repair | Owner-only repair console or retired | Data retention window complete | Very high |
| Monitoring/alerts/health | Operational dashboards | Customer App monitoring service | Native logs and queues live | Medium |
| Compliance | Hub compliance module | Customer App compliance module | Native records and audits pass | Medium/high |

Critical endpoint index:

| Endpoint/function | Repo path | Current usage | Replacement path | Retirement condition | Deletion risk |
|---|---|---|---|---|---|
| safeSyncOrderUpdate | Hub `base44/functions/safeSyncOrderUpdate/entry.ts` | Hub order write gateway | Customer App internal safeSync service | Native order ingestion owns writes | High |
| pullOrdersFromCustomerApp | Hub path | Hub pull ingestion | None; internal order creation | Native ingestion live | High |
| receiveCustomerAppEvent | Hub path | Customer App event intake | Internal event bus | Native event processing live | High |
| processStripeRefund | Hub path | Refund cascade | Customer App refund service | Refund suite passes | High |
| stripeSessionReconciliation | Hub path | Stripe reconciliation | Customer App payment reconciliation | Provider cutover passes | High |
| startProductionBatchForCustomerApp | Hub path | Bridge start command | Native production start | Native pilot passes | Medium |
| completeProductionBatchForCustomerApp / completeBatchProduction | Hub path | Bridge and legacy complete | Native complete | Native pilot passes | Medium |
| verifyProductionBatchForCustomerApp / verifyAndLogBatch | Hub path | Bridge and legacy verify | Native verify/compliance | Native compliance pilot passes | Medium/high |
| packProductionVerifyFulfillmentTasksForCustomerApp | Hub path | Bridge task pack | Native pack command | Native task pack pilot passes | Medium |
| bottleProductionVerifyShopifyOrderForCustomerApp | Hub path | Bridge bottled cascade | Native non-sub order cascade | Non-sub candidate pilot passes | Medium/high |
| correctProductionBatchStaffOnDutyForCustomerApp | Hub path | Bridge correction | Native correction | Native correction command exists | Low/medium |
| correctProductionIngredientUsageForCustomerApp | Hub path | Bridge correction | Native ingredient correction | Native correction command exists | Medium |
| deductProductionInventoryForCustomerApp | Hub path | Bridge inventory command | Native inventory deduction | Procurement/inventory pilot passes | High |
| previewProductionInventoryDeductionForCustomerApp | Hub path | Read-only preview | Native preview | Output parity | Low |
| previewProductionIngredientUsageCorrectionForCustomerApp | Hub path | Read-only preview | Native preview | Output parity | Low |
| previewProductionBatchStart/Complete/Verify* | Hub paths | Read-only previews | Native previews | Output parity | Low |
| previewProductionVerifyCascadesForCustomerApp | Hub path | Read-only cascade preview | Native cascade preview | Output parity | Low |
| previewSubscriptionFulfillmentProductionStatusForCustomerApp | Hub path | Read-only occurrence preview | Native occurrence preview | Occurrence model approved | Low/medium |
| recalculateProductionBatches | Hub path | Production demand generator | Native demand generator | Shadow parity across schedule window | High |
| autoGenerateProductionBatch | Hub path | Batch creation | Native batch generator | Native demand service live | Medium/high |
| calculateIngredientNeeds / calculateIngredientDemandFixed | Hub paths | Ingredient math | Native ingredient engine | Formula parity tests pass | Medium/high |
| createFulfillmentTasks | Hub path | Disabled legacy | Retire | Native task generator live | Low if still disabled |
| syncFulfillmentTasksFromOrders | Hub path | Task repair/generation | Native repair or retired | Native task model live | Medium |
| recordDriverDelivery / receiveDriverStatusUpdate / updateDriverDeliveryTask | Hub paths | Driver writes | Native driver service | Driver portal cutover | High |
| markFulfillmentTaskOutForDeliveryForCustomerApp | Hub path | Bridge task transition | Native task transition | Native pilot passes | Medium |
| markHubOrderDeliveredForCustomerAppSync | Hub path | Bridge customer status | Native customer status command | Notification/status policy approved | High |
| monitorNewOrderChain / systemHealthCheck / operationsOversight / checkQueueBacklog / orderReviewQueueAlert | Hub monitoring family | Ops monitoring | Native monitoring | Native logs/queues live | Medium |

The full Hub function inventory is large. Functions not enumerated above inherit their family retirement rule by prefix/behavior: sync/pull/push/receive cross-backend functions retire; provider/refund functions migrate under Customer App provider services; repair/delete/bulk functions become owner-only disabled tools or retire; preview/bridge functions delete after native parity.

## 13. New Architecture Proposal

Customer App backend becomes the operational source of truth.

Textual architecture:

1. Stripe webhook, Shopify/POS webhook, customer checkout, subscription lifecycle, admin commands, and driver commands enter the Customer App backend.
2. Authentication is handled at the edge: Stripe signature, Shopify HMAC, admin/customer/driver session, or owner-only service token for repairs.
3. All order writes route through native `safeSyncOrderUpdate`.
4. `safeSyncOrderUpdate` writes the canonical operational order record, applies locks/field ownership, creates OrderSyncLog, and quarantines to OrderReviewQueue when needed.
5. FulfillmentTask generation runs internally from canonical orders and subscription occurrences.
6. ProductionBatch generation runs internally from canonical orders, bundles, recipes, manual batches, and fulfillment occurrences.
7. Recipe/Bundle/IngredientYield services calculate demand and procurement needs.
8. Production lifecycle commands operate directly on Customer App owned ProductionBatch and compliance records.
9. Compliance logs are created and locked in the Customer App backend.
10. Inventory previews/corrections/deductions operate against Customer App owned InventoryItem and procurement records.
11. Driver commands update Customer App owned FulfillmentTasks and customer-safe order projections through approved status/notification services.
12. CommandLog, OrderSyncLog, OrderReviewQueue, audit trails, status_history, and notification idempotency logs remain durable.
13. Operations Hub becomes read-only during cutover, then disabled, then deleted/archived after all traffic and automations are retired.

## 14. Detailed Migration Roadmap

### Phase A — Current Bridge Stabilization

Objective: keep the bridge safe while planning true migration.

Tasks:

- Freeze new bridge expansion except where needed for evidence.
- Document every bridge command as transitional.
- Keep feature flags closed after pilots.
- Resolve known CLI/Builder/schema deploy blockers only in scoped PRs.

Tests:

- Boundary auth tests.
- Idempotency tests for all bridge commands already live.
- No-write checks for previews.

Rollback:

- Disable wrapper or feature flag.
- Keep Hub UI operational.

Hard stops:

- Unrelated Builder publish scope.
- Any command requiring provider/payment/customer notification side effects.

### Phase B — Customer App Backend Internal Service Migration

Objective: port core internal services before changing ownership.

Tasks:

- Port `safeSyncOrderUpdate` and tests.
- Add canonical CommandLog/OrderSyncLog/OrderReviewQueue if schema gaps exist.
- Port Recipe/Bundle/IngredientYield matcher and calculation engine.
- Port production lifecycle previews natively.

Tests:

- Fixture parity with Hub for orders, subscriptions, POS, refunds, production demand, ingredient math.

Rollback:

- Keep native services dark/read-only.

### Phase C — Order Ingestion Ownership

Objective: make Customer App backend create operational orders directly.

Tasks:

- Route Stripe webhook through native safeSync.
- Shadow-write operational records and compare with Hub.
- Create native FulfillmentTasks and ProductionBatch demand in shadow.
- Retire Customer-to-Hub order push after parity.

Tests:

- One-time, subscription, duplicate webhook, low-quality, POS, refund.

Rollback:

- Re-enable existing syncOrderToHub/Hub pull during rollback window.

### Phase D — Production/Fulfillment Ownership

Objective: move operations commands native.

Tasks:

- Native start/complete/verify.
- Native task pack.
- Native non-sub bottled cascade.
- Native subscription occurrence status model.
- Native driver assignment/out-for-delivery/delivered preview.

Tests:

- Feature-flagged one-record pilots; idempotency; no side effects beyond contract.

Rollback:

- Disable native flags; use Hub bridge or Hub UI.

### Phase E — Inventory/Compliance Ownership

Objective: move inventory, procurement, and compliance.

Tasks:

- Move InventoryItem, IngredientYield, Supplier, PurchaseOrder.
- Port BatchComplianceLog and specific compliance logs.
- Native ingredient usage capture/correction.
- Native inventory deduction preview; live only after policy.

Tests:

- Compliance log audit tests.
- Ingredient usage and inventory deduction tests.
- Procurement-needed make-to-order tests.

Rollback:

- Keep Hub compliance/inventory read-write until native is proven.

### Phase F — Parallel Run / Dark Launch

Objective: prove native backend matches Hub.

Tasks:

- Run Customer App native services in shadow.
- Compare logs, batches, tasks, ingredient demand, refunds, queues.
- Alert on discrepancies.

Tests:

- Seven-day operational window plus one subscription cycle if possible.

Rollback:

- Disable shadow writes and keep Hub authoritative.

### Phase G — Cutover

Objective: make Customer App backend authoritative.

Tasks:

- Flip per-domain ownership flags.
- Disable cross-backend sync loops.
- Monitor missing orders/tasks/batches/notifications.

Tests:

- Live smoke for checkout, subscription, refund, production, fulfillment, delivery, compliance.

Rollback:

- Per-domain rollback flags re-enable bridge/Hub UI.

### Phase H — Hub Retirement / Deletion

Objective: safely retire Hub backend.

Tasks:

- Export and archive Hub data/logs.
- Disable all Hub automations.
- Delete bridge wrappers after no calls.
- Archive/delete Hub functions after retention window.

Tests:

- No production traffic to Hub endpoints.
- No missing records after one billing/subscription cycle.

Hard stops:

- Any unresolved discrepancy in payments, credits, customer-facing notifications, compliance, inventory, or provider calls.

## 15. Testing And Validation Plan

- safeSyncOrderUpdate: field ownership, locks, subscription hard lock, payment downgrade, production_snapshot, address quality, POS, line item normalization, manual override, quarantines, logs.
- New order creation: Stripe checkout creates one canonical operational order, one customer projection, no duplicate.
- Subscription order creation: one subscription, correct fulfillment occurrences, no ghost parent/child duplicates.
- Subscription update/cancel: future deliveries handled without corrupting current cycle.
- Refund full/partial: full cascade, partial review queue, duplicate event idempotent, production-scheduled refund review.
- OrderReviewQueue: low-quality, unknown, address incomplete, subscription downgrade, snapshot mismatch.
- OrderSyncLog: created for create/update/reject/filter/skip.
- FulfillmentTask generation: one-time and subscription occurrence tasks, no duplicates, refunded excluded.
- ProductionBatch generation: demand parity with Hub for date windows.
- Ingredient calculation: Recipe math, Bundle decomposition, IngredientYield conversions, make-to-order procurement labels.
- Start/complete/verify production: exact transitions, locks, audit trail, CommandLog, duplicate skip.
- Compliance logs: BatchComplianceLog and specific HACCP/temp/pH/sanitation/corrective logs.
- Inventory preview/deduction: no deduction without usage rows; stock/procurement policy enforced.
- Delivery assignment/out-for-delivery/delivered: task state, customer projection, notification idempotency.
- Proof/drop/unable-to-deliver: gated and reviewable.
- Customer-facing status sync: status_history only through approved commands.
- Duplicate webhooks/events: no duplicate orders, subscriptions, logs, notifications, refunds.

## 16. Post-Migration Verification Checklist

- [ ] Verify `order_lock_status` prevents unauthorized changes via `LOCK_FROZEN_FIELDS`.
- [ ] Verify `FIELD_OWNERSHIP` rejects unauthorized source updates.
- [ ] Verify subscription hard lock prevents source_channel downgrade, `stripe_subscription_id` removal, line_items erasure, and fulfillments erasure.
- [ ] Verify paid status cannot be downgraded except through approved refund flow.
- [ ] Verify `production_snapshot` blocks line item/fulfillment mismatches after `production_scheduled`.
- [ ] Verify incomplete delivery address creates OrderReviewQueue entry.
- [ ] Verify low-quality new order creates OrderReviewQueue entry.
- [ ] Verify full refund cancels FulfillmentTasks and updates ProductionBatch planned_units only when safe.
- [ ] Verify partial refunds enter OrderReviewQueue.
- [ ] Verify pullOrdersFromCustomerApp replacement does not create duplicate ghost subscription orders.
- [ ] Verify receiveCustomerAppEvent retirement does not lose bag returns, subscriptions, order_created, subscription_updated, subscription_cancelled behavior.
- [ ] Verify calculateIngredientNeeds yields identical results.
- [ ] Verify Bundle decomposition matches Hub behavior.
- [ ] Verify Recipe ingredient math matches Hub behavior.
- [ ] Verify production command allowlists and idempotency still work during migration.
- [ ] Verify CommandLog/OrderSyncLog entries are created for all critical actions.
- [ ] Verify customer-facing delivered notification idempotency remains intact.
- [ ] Verify inventory deduction is never run without ingredient usage rows and approved stock/procurement policy.
- [ ] Verify provider payloads, secrets, stack traces, and payment IDs are not returned in admin/user responses.
- [ ] Verify Customer App backend has no dependency on Hub for checkout, order status, production, fulfillment, inventory, compliance, or review queues before Hub is disabled.

## 17. Immediate Next Phases

Recommended next phases under this controlling roadmap:

1. G21B: `safeSyncOrderUpdate` native Customer App migration contract and fixture audit.
2. G21C: Canonical entity delta PR planning for Customer App operational ownership (`ShopifyOrder`, `ProductionBatch`, `CommandLog`, `OrderReviewQueue`, `InventoryItem`, compliance entities).
3. G21D: Customer App native order-ingestion shadow service design, with no runtime ownership cutover yet.

Do not continue expanding Hub bridge commands except where they are necessary to stabilize current operations or capture parity evidence. New implementation should prefer Customer App-native read-only services first, then feature-flagged native commands.

## 18. G21A Documentation Scope Confirmation

This phase created only this documentation file. It did not modify runtime code, publish, run commands, or mutate live records.
