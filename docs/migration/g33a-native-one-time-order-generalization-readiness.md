# G33A: Native one-time order generalization readiness

## 1. Executive summary

G33A is a docs-only readiness audit for moving from the exact native pilot lifecycle to a controlled, repeatable native one-time order workflow. No runtime code, Base44 functions, Builder UI, gates, records, providers, Hub bridge behavior, inventory, PurchaseOrder logic, notifications, sync, repair, replay, or live customer-facing behavior are changed by this phase.

The controlled native lifecycle for order `NV-MPZNKGNT` is proven end-to-end as an exact-order pilot:

- Customer App Order remained paid/captured through the flow.
- A native ShopifyOrder mirror and native FulfillmentTask existed and were used as the operational native records.
- Non-stock production master data was imported.
- ProductionBatch demand was materialized.
- Production was started, completed, and verified.
- BatchComplianceLog rows were created and locked.
- The native FulfillmentTask was packed.
- The native ShopifyOrder was bottled.
- One-order schedule metadata was corrected without changing ProductionBatch or BatchComplianceLog dates.
- Delivery completion was reconciled directly without creating artificial Out For Delivery state.
- The Customer App Order was finally moved to `delivered` with notifications disabled.
- No notifications, inventory deduction, PurchaseOrders, provider calls, Stripe calls, Shopify calls, Hub mutations, proof/drop/route writes, sync, repair, or replay actions were used.

The current result is strong evidence that the native one-time order workflow is operationally viable for one exact paid/captured single-delivery order. It is not enough evidence to broaden gates to all eligible orders. The next safe step is a second controlled one-time order pilot: ideally the next natural paid one-time order, with read-only previews first and live commands opened only for exact order/task/batch allowlists.

## 2. Proven `NV-MPZNKGNT` lifecycle map

| Stage | Proven result | Write scope used | Held scope |
| --- | --- | --- | --- |
| Native intake / mirror | Customer App Order, native ShopifyOrder, and native FulfillmentTask linked for one exact one-time order. | Exact native mirror / task records only. | Broad safeSync writer, subscriptions, multi-delivery, refunds, provider calls. |
| Master data | Non-stock production master data imported for native production use. | Master data only. | Inventory deduction, PurchaseOrder creation, detailed yield / purchase conversion automation. |
| Demand materialization | Native production demand preview and batch materialization produced six ProductionBatch rows. | Exact ProductionBatch rows. | Bulk production recalculation and inventory actions. |
| Start production | Six batches moved through start lifecycle. | Exact batch status/timestamps allowed by command contract. | Batch creation beyond preview packet, broad schedule recalculation. |
| Complete production | Six batches completed with exact actual-unit data. | Exact batch completion fields. | Inventory deduction, PurchaseOrder, provider calls. |
| Verify production | Six batches verified and six locked BatchComplianceLog rows created. | Exact verification fields and compliance logs. | Compliance backfill outside exact batches. |
| Post-verify pack | Native FulfillmentTask packed. | Exact task `status` / `production_status` pack fields. | Delivery status, Customer App status, notification, proof/drop/route. |
| Post-verify bottle | Native ShopifyOrder bottled. | Exact native ShopifyOrder `production_status`. | ShopifyOrder fulfillment status, Customer App Order, notifications. |
| Schedule exception | One-order date metadata corrected to actual production/delivery dates. | Exact Customer App Order, native ShopifyOrder, and native FulfillmentTask date metadata. | ProductionBatch dates, BatchComplianceLog dates, delivery status, status history, notifications, global scheduling logic. |
| Delivery completion | Native FulfillmentTask delivered and native ShopifyOrder fulfilled. | Exact native FulfillmentTask delivery fields and exact native ShopifyOrder fulfillment status. | Customer App Order, notifications, proof/drop/route, Hub. |
| Customer final status | Customer App Order status updated to `delivered`. | Exact Customer App Order status and schema-safe status history / audit metadata. | Notifications, native records, Hub, proof/drop/route. |
| Historical Hub 1052 | Historical native ShopifyOrder mirror created for Hub order `1052`. | Exact native ShopifyOrder historical mirror and CommandLog. | Customer App Order backfill, native FulfillmentTask backfill, Hub mutation, notifications. |

## 3. Function and command inventory

### 3.1 Order intake / native mirror

| Function | Type | Live-proven | Exact-order gated | Gate names / policy | Writes | Refuses / held | Idempotency | Risk | Next expansion requirement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `previewNativeSafeSyncOrderUpdate` | Read-only preview | Preview-proven | N/A | N/A | None | All record mutation, provider calls, sync side effects. | N/A | Preview may not cover every new order edge case. | Use as part of a second-order preview bundle. |
| `executeNativeSafeSyncOrderUpdate` | Write command | Controlled exact pilot only | Yes | `ENABLE_NATIVE_SAFE_SYNC_WRITER`, `NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH`, `NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST`, `NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES`, `NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS`, `NATIVE_SAFE_SYNC_WRITER_ACTOR_EMAIL_ALLOWLIST`; policy enforced by source/event/order allowlists. | Native/customer linkage and safe sync fields according to exact event contract; CommandLog / audit context where supported. | Provider calls, Stripe calls, Shopify calls, broad replay, unsupported events, non-allowlisted orders. | CommandLog/request based safety exists; broad idempotency still needs more samples. | Keep exact-order for next pilot; do not enable broad writer yet. |
| `previewNativeSafeSyncDarkLaunchComparison` | Read-only preview | Preview-proven | N/A | N/A | None | Live sync writes. | N/A | Comparison quality depends on source coverage. | Include in monitoring for natural order pilot. |
| `previewNativeSafeSyncLiveOrderParity` | Read-only preview | Preview-proven | N/A | N/A | None | Live sync writes. | N/A | Parity may surface old Hub inconsistencies. | Keep read-only and use before any cutover expansion. |
| `previewNativeSafeSyncParityHarness` | Read-only / harness preview | Harness-proven | N/A | N/A | None | Live writes. | N/A | Harness coverage can lag production schema. | Keep as regression guard. |
| `previewNativeOrderCutoverReadiness` | Read-only preview | Preview-proven | N/A | N/A | None | Cutover mutation. | N/A | Cutover readiness is not cutover approval. | Re-run for second pilot and before any Hub role change. |
| `previewNativeExactOrderPilotApproval` | Read-only preview | Preview-proven | Exact target | N/A | None | Live writes. | N/A | Approval packet can become stale. | Use as the standard pre-live approval artifact for second pilot. |
| `processMay30NativeOrderOps` | Write command | Historical / controlled only | Yes | `ENABLE_MAY30_NATIVE_ORDER_OPS`, `MAY30_NATIVE_ORDER_OPS_SECRET`. | May create/update native ops records for the May 30 operational path. | Broad order operations and unsupported dates. | Not relied on as the generalized path. | Treat as historical one-off support, not a generalization base. |
| `previewNativeFulfillmentTaskMaterialization` | Read-only preview | Preview-proven | N/A | N/A | None | FulfillmentTask creation. | N/A | Task schema can vary by delivery method. | Include in future one-time order eligibility checks. |
| `executeNativeFulfillmentTaskMaterialization` | Write command | Controlled only | Yes | Function-specific default-off gates in source. | Native FulfillmentTask creation/update according to exact task materialization contract. | Customer status, notification, provider calls, delivery proof/drop/route. | Needs another natural order sample. | Keep exact-order; require preview packet and exact task/order allowlist. |
| `previewNativeFulfillmentTaskLifecycle` | Read-only preview | Preview-proven | N/A | N/A | None | Task lifecycle writes. | N/A | Lifecycle mapping differs for pickup vs delivery. | Keep delivery/pickup classification explicit. |
| `executeNativeFulfillmentTaskLifecycle` | Write command | Controlled only | Yes | Function-specific default-off gates in source. | Native FulfillmentTask lifecycle fields under exact contract. | Customer status, notifications, proof/drop/route unless explicitly approved. | Needs more samples. | Split lifecycle by operation type before broadening. |
| `previewNativeFulfillmentTaskMetadataRepair` | Read-only preview | Preview-proven | N/A | N/A | None | Metadata repair writes. | N/A | Repair can mask upstream defects if overused. | Keep repair as owner-approved fallback. |
| `executeNativeFulfillmentTaskMetadataRepair` | Write command | Controlled only | Yes | Function-specific default-off gates in source. | Exact task metadata repair fields. | Lifecycle status changes and provider calls. | Controlled only. | Do not generalize until repeated metadata defect class is understood. |

### 3.2 Production readiness

| Function | Type | Live-proven | Exact-order gated | Gate names / policy | Writes | Refuses / held | Idempotency | Risk | Next expansion requirement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `previewNativeProductionInventoryReadiness` | Read-only preview | Preview-proven | N/A | N/A | None | Inventory deduction and PurchaseOrder actions. | N/A | Inventory policy remains intentionally held. | Keep as hard preflight; define G34 inventory/PO policy before retirement. |
| `previewNativeProductionMasterDataParity` | Read-only preview | Preview-proven | N/A | N/A | None | Master-data writes. | N/A | Master data drift can block new products. | Require clean parity for each pilot order. |
| `previewNativeProductionDemandMaterialization` | Read-only preview | Preview-proven | N/A | N/A | None | ProductionBatch creation. | N/A | Demand materialization depends on line item normalization and master data. | Bundle into next pilot preview set. |
| `importNativeProductionMasterDataForCustomerApp` | Write command | Live-proven for exact non-stock packet | Yes | `ENABLE_NATIVE_PRODUCTION_MASTER_DATA_IMPORT`, `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_KILL_SWITCH`, `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ALLOWED_EMAILS`, `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ORDER_ALLOWLIST`, `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY=NON_STOCK_MASTER_DATA_ONLY`, yield policy `DEFER_DETAILED_PURCHASE_CONVERSION_VALUES`. | Non-stock native production master data only. | Stock/inventory quantities, PurchaseOrders, detailed purchase conversion/yield automation. | Proven for exact packet. | Expand only to schema-safe non-stock master data gaps surfaced by previews. |

### 3.3 Production lifecycle

| Function | Type | Live-proven | Exact-order gated | Gate names / policy | Writes | Refuses / held | Idempotency | Risk | Next expansion requirement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `materializeNativeProductionBatchesForCustomerApp` | Write command | Live-proven on six exact rows | Yes | `ENABLE_NATIVE_PRODUCTION_BATCH_MATERIALIZATION`, `NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH`, `NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ALLOWED_EMAILS`, `NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ORDER_ALLOWLIST`, `NATIVE_PRODUCTION_BATCH_MATERIALIZATION_POLICY=EXACT_PREVIEW_PACKET_ONLY`. | Exact ProductionBatch rows from preview packet. | Inventory deduction, PurchaseOrder, broad recalculation, unpreviewed rows. | Duplicate behavior proven for pilot command class. | Require exact preview packet for second pilot; no broad batch writer. |
| `previewNativeProductionBatchLifecycle` | Read-only preview | Preview-proven | N/A | N/A | None | Lifecycle writes. | N/A | Preview must understand already-started/completed/verified states. | Keep as the lifecycle state oracle. |
| `startNativeProductionBatchesForCustomerApp` | Write command | Live-proven | Yes | `ENABLE_NATIVE_PRODUCTION_BATCH_START`, `NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH`, `NATIVE_PRODUCTION_BATCH_START_ALLOWED_EMAILS`, `NATIVE_PRODUCTION_BATCH_START_ORDER_ALLOWLIST`, `NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST`, `NATIVE_PRODUCTION_BATCH_START_POLICY=EXACT_PREVIEW_PACKET_ONLY`. | Exact batch start fields. | Non-allowlisted batches, inventory, PO, provider calls. | Duplicate/idempotent behavior proven in controlled flow. | Keep batch allowlist until second/third production sample. |
| `completeNativeProductionBatchesForCustomerApp` | Write command | Live-proven | Yes | `ENABLE_NATIVE_PRODUCTION_BATCH_COMPLETE`, `NATIVE_PRODUCTION_BATCH_COMPLETE_KILL_SWITCH`, `NATIVE_PRODUCTION_BATCH_COMPLETE_ALLOWED_EMAILS`, `NATIVE_PRODUCTION_BATCH_COMPLETE_ORDER_ALLOWLIST`, `NATIVE_PRODUCTION_BATCH_COMPLETE_BATCH_ALLOWLIST`, `NATIVE_PRODUCTION_BATCH_COMPLETE_POLICY=EXACT_BATCH_ACTUAL_UNITS_ONLY`. | Exact completion fields and actual units. | Inventory deduction, PO, broad production recalculation. | Duplicate/idempotent behavior proven in controlled flow. | Define actual-units policy for normal production before broadening. |
| `verifyNativeProductionBatchesForCustomerApp` | Write command | Live-proven | Yes | `ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY`, `NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH`, `NATIVE_PRODUCTION_BATCH_VERIFY_ALLOWED_EMAILS`, `NATIVE_PRODUCTION_BATCH_VERIFY_ORDER_ALLOWLIST`, `NATIVE_PRODUCTION_BATCH_VERIFY_BATCH_ALLOWLIST`, `NATIVE_PRODUCTION_BATCH_VERIFY_POLICY=EXACT_BATCH_VERIFICATION_DATA_ONLY`. | Exact batch verification fields and BatchComplianceLog creation. | ProductionBatch date rewrites, unrelated compliance logs, inventory, PO. | Duplicate/idempotent behavior proven in controlled flow. | Keep exact batch allowlist; add second order regression before generalized verify. |
| `executeNativeProductionBatchLifecycle` | Write command | Controlled / legacy lifecycle support | Yes | Function-specific default-off gates in source. | Native ProductionBatch lifecycle fields according to exact command contract. | Broad recalculation, inventory, PO. | Not the preferred current segmented command path. | Prefer segmented start/complete/verify commands for generalization. |

### 3.4 Post-verify cascades

| Function | Type | Live-proven | Exact-order gated | Gate names / policy | Writes | Refuses / held | Idempotency | Risk | Next expansion requirement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `previewNativeProductionVerifyCascades` | Read-only preview | Preview-proven | N/A | N/A | None | Pack, bottle, customer status, notifications. | N/A | Summary wording must remain aligned with row-level state. | Keep as post-verify gatekeeper for every pilot order. |
| `packNativeProductionFulfillmentTaskForCustomerApp` | Write command | Live-proven | Yes | `ENABLE_NATIVE_FULFILLMENT_TASK_PACK`, `NATIVE_FULFILLMENT_TASK_PACK_KILL_SWITCH`, `NATIVE_FULFILLMENT_TASK_PACK_ALLOWED_EMAILS`, `NATIVE_FULFILLMENT_TASK_PACK_ORDER_ALLOWLIST`, `NATIVE_FULFILLMENT_TASK_PACK_TASK_ALLOWLIST`, `NATIVE_FULFILLMENT_TASK_PACK_POLICY=EXACT_VERIFIED_ORDER_TASK_ONLY`. | Exact native FulfillmentTask pack fields. | Delivery status, Customer App status, notifications, proof/drop/route. | Duplicate/idempotency proven. | Keep exact task allowlist until more one-time samples pass. |
| `bottleNativeProductionShopifyOrderForCustomerApp` | Write command | Live-proven | Yes | `ENABLE_NATIVE_SHOPIFY_ORDER_BOTTLE`, `NATIVE_SHOPIFY_ORDER_BOTTLE_KILL_SWITCH`, `NATIVE_SHOPIFY_ORDER_BOTTLE_ALLOWED_EMAILS`, `NATIVE_SHOPIFY_ORDER_BOTTLE_ORDER_ALLOWLIST`, `NATIVE_SHOPIFY_ORDER_BOTTLE_SHOPIFY_ORDER_ALLOWLIST`, `NATIVE_SHOPIFY_ORDER_BOTTLE_POLICY=EXACT_VERIFIED_PACKED_ONE_TIME_ORDER_ONLY`. | Exact native ShopifyOrder `production_status=bottled`; safe audit/CommandLog. | Fulfillment status, Customer App Order, notifications, provider calls. | Duplicate/idempotency and audit consistency patched/proven. | Keep exact ShopifyOrder allowlist for second pilot. |

### 3.5 Customer status and delivery

| Function | Type | Live-proven | Exact-order gated | Gate names / policy | Writes | Refuses / held | Idempotency | Risk | Next expansion requirement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `previewNativeCustomerStatusNotificationImpact` | Read-only preview | Preview-proven | N/A | N/A | None | Customer status and notifications. | N/A | `bottled_packed` is stale once delivery is reconciled. | Keep for pre-delivery states only; delivered flow should use delivered status preview. |
| `updateNativeCustomerOrderStatusForCustomerApp` | Write command | Command-ready, not live-used for `NV-MPZNKGNT` | Yes | `ENABLE_NATIVE_CUSTOMER_STATUS_UPDATE`, `NATIVE_CUSTOMER_STATUS_UPDATE_KILL_SWITCH`, `NATIVE_CUSTOMER_STATUS_UPDATE_ALLOWED_EMAILS`, `NATIVE_CUSTOMER_STATUS_UPDATE_ORDER_ALLOWLIST`, `NATIVE_CUSTOMER_STATUS_UPDATE_CUSTOMER_ORDER_ALLOWLIST`, `NATIVE_CUSTOMER_STATUS_UPDATE_POLICY=EXACT_STATUS_ONLY_NO_NOTIFICATION`. | Exact Customer App Order status-only update such as `bottled_packed`; status_history only if contract supports. | Notifications, native records, delivery/proof/drop/route. | Harness/idempotency prepared; live use skipped because final delivery became the correct state. | Keep paused unless a future order has meaningful pre-delivery dwell time. |
| `previewNativeCustomerDeliveredStatusImpact` | Read-only preview | Preview-proven | N/A | N/A | None | Customer status mutation and notifications. | N/A | Delivered status mapping must remain schema-confirmed. | Use after native delivery completion for each future pilot. |
| `updateNativeCustomerOrderDeliveredStatusForCustomerApp` | Write command | Live-proven for exact order | Yes | `ENABLE_NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE`, `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_KILL_SWITCH`, `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_ALLOWED_EMAILS`, `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_ORDER_ALLOWLIST`, `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_CUSTOMER_ORDER_ALLOWLIST`, `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_TASK_ALLOWLIST`, `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_SHOPIFY_ORDER_ALLOWLIST`, `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_POLICY=DELIVERED_STATUS_ONLY_NO_NOTIFICATION`. | Exact Customer App Order `status=delivered`, schema-safe status history / audit, CommandLog. | Notifications, native records, proof/drop/route, provider calls, Hub. | Duplicate/idempotency proven. | Keep exact order/task allowlists for the second pilot. |
| `previewNativeScheduleExceptionCorrection` | Read-only preview | Preview-proven | N/A | N/A | None | Schedule correction writes. | N/A | Schedule exceptions should not become global logic. | Use only for one-off date exceptions. |
| `correctNativeScheduleExceptionForCustomerApp` | Write command | Live-proven for one exact exception | Yes | `ENABLE_NATIVE_SCHEDULE_EXCEPTION_CORRECTION`, `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_KILL_SWITCH`, `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_ALLOWED_EMAILS`, `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_ORDER_ALLOWLIST`, `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_CUSTOMER_ORDER_ALLOWLIST`, `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_TASK_ALLOWLIST`, `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_SHOPIFY_ORDER_ALLOWLIST`, `NATIVE_SCHEDULE_EXCEPTION_CORRECTION_POLICY=EXACT_DATE_ONLY_NO_NOTIFICATION`. | Exact date metadata on Customer App Order, native ShopifyOrder, native FulfillmentTask; CommandLog. | ProductionBatch dates, BatchComplianceLog dates, status history, notifications, delivery status, global scheduling rules. | Duplicate/idempotency proven. | Keep manual/owner-approved; do not generalize as normal scheduling path. |
| `previewNativeDeliveryWorkflowReadiness` | Read-only preview | Preview-proven | N/A | N/A | None | Out For Delivery / Delivered writes. | N/A | Hub fallback rows can confuse active route summaries without merge labeling. | Keep active for delivery readiness; do not add live buttons yet. |
| `previewNativeDeliveryCompletionReconciliation` | Read-only preview | Preview-proven | N/A | N/A | None | Delivered reconciliation writes. | N/A | Direct delivered mode requires actual delivered timestamp. | Use when operational delivery already happened. |
| `reconcileNativeDeliveryCompletionForCustomerApp` | Write command | Live-proven for exact order | Yes | `ENABLE_NATIVE_DELIVERY_COMPLETION_RECONCILIATION`, `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_KILL_SWITCH`, `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_ALLOWED_EMAILS`, `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_ORDER_ALLOWLIST`, `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_CUSTOMER_ORDER_ALLOWLIST`, `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_TASK_ALLOWLIST`, `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_SHOPIFY_ORDER_ALLOWLIST`, `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_POLICY=DIRECT_DELIVERED_NO_NOTIFICATION`. | Exact native FulfillmentTask delivered fields and native ShopifyOrder fulfillment status; CommandLog. | Customer App Order, notifications, proof/drop/route, Hub, provider calls. | Duplicate/idempotency proven. | Keep direct-delivered reconciliation exact; plan true Out For Delivery separately if needed. |
| `previewNativeOrderScheduleCorrection` | Read-only preview | Preview-proven / earlier schedule path | N/A | N/A | None | Schedule writes. | N/A | Superseded by more specific G32D-SCHED preview for exact one-off. | Keep as legacy/reference preview if still surfaced. |
| `executeNativeOrderScheduleCorrection` | Write command | Controlled earlier schedule support | Yes | Function-specific default-off gates in source. | Schedule correction fields under exact contract. | Broad scheduling logic. | Not the preferred current G32D-SCHED command for this pilot. | Prefer `correctNativeScheduleExceptionForCustomerApp` for one-order exceptions. |

### 3.6 Historical / backfill

| Function | Type | Live-proven | Exact-order gated | Gate names / policy | Writes | Refuses / held | Idempotency | Risk | Next expansion requirement |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `previewHistoricalHubFulfilledNativeBackfill` | Read-only preview | Preview-proven for Hub `1052` | N/A | N/A | None | Native mirror creation, Customer App Order creation, task creation, Hub mutation. | N/A | Hub data can be incomplete or inconsistent. | Keep for historical Hub-only fulfilled orders. |
| `backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp` | Write command | Live-proven for Hub `1052` | Yes | `ENABLE_HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL`, `HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_KILL_SWITCH`, `HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_ALLOWED_EMAILS`, `HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_ORDER_ALLOWLIST`, `HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_POLICY=HISTORICAL_FULFILLED_NATIVE_SHOPIFY_ORDER_ONLY_NO_NOTIFICATION`. | One native ShopifyOrder historical fulfilled mirror and CommandLog. | Customer App Order, native FulfillmentTask, Hub, notifications, proof/drop/route, provider calls. | Duplicate/idempotency proven. | Keep exact Hub order allowlist; no batch historical import yet. |
| `previewHistoricalCustomerOrderFulfillmentBackfillImpact` | Read-only preview | Preview-proven | N/A | N/A | None | Customer App Order creation and FulfillmentTask creation. | N/A | Customer-visible historical order creation has high product risk. | Recommendation is to hold additional `1052` backfill unless a specific business need appears. |
| `previewAdminHistoricalHubBackfill` | Read-only preview | Preview-proven / admin historical support | N/A | N/A | None | Historical backfill writes. | N/A | Historical Hub records vary in data quality. | Use only as supporting evidence; keep live backfill exact. |
| `backfillAdminHistoricalHubOrders` | Write command | Existing historical admin command, not part of G32M exact mirror path | Yes / historical admin scope | Function-specific gates in source. | Historical Hub backfill records according to its contract. | Live Hub mutation and provider calls unless explicitly allowed by contract. | Not used for the current exact mirror milestone. | Do not use for order `1052` without a separate approval path. |

## 4. Exact-order-only assumptions

| Assumption / hardcoded target class | Current examples | Classification | Rationale | Expansion requirement |
| --- | --- | --- | --- | --- |
| Exact order number allowlists | `NV-MPZNKGNT`, `1052` | Keep exact-order until more samples | All live write commands were opened for one exact order or one exact Hub order. | Run a second controlled one-time order pilot before any multi-order allowlist. |
| Exact Customer App Order id allowlists | `6a219a3f4adcda5856c3d579` | Keep exact-order until more samples | Customer-facing status and schedule writes are high-risk. | Require exact ID match for second pilot; later move to eligibility-derived allowlist. |
| Exact native ShopifyOrder id allowlists | `6a22ffda400eb806eb3ca945`, historical mirror `6a2848655450ef3556960d99` | Keep exact-order until more samples | Prevents writes to wrong native mirror when Hub fallback/native duplicates exist. | Add duplicate detection and source-link confidence before broadening. |
| Exact FulfillmentTask id allowlists | `6a22ffdaf675ea79e30575aa` | Keep exact-order until more samples | Task status writes are operationally visible and can affect queues. | Require task preview identity match and delivery/pickup classification. |
| Exact batch id allowlists | Six `NV-MPZNKGNT` ProductionBatch rows | Keep exact batch allowlists | Batch lifecycle writes can create compliance and production audit effects. | Pilot at least one more set of batches from a different order/product mix. |
| Exact production/delivery date inputs | `2026-06-07`, `2026-06-08`; stale dates `2026-06-05`, `2026-06-06` | Should stay manual/owner-approved | This was a one-off schedule exception, not global scheduling behavior. | Do not generalize; use only with explicit date approval. |
| Exact delivered timestamp | `2026-06-08T08:30:00-05:00` / stored UTC equivalent | Should stay manual/owner-approved | Direct delivered reconciliation needs operational truth from owner/operator. | Require exact timestamp until delivery workflow records it natively. |
| Exact master-data seed packet | Non-stock master data packet for pilot products | Safe to generalize soon, but only through previews | Non-stock master data import is lower risk than inventory/PO automation. | Expand only when parity preview identifies schema-safe missing non-stock data. |
| Notification disabled policy | `NO_NOTIFICATION` | Needs policy decision before broadening | Notifications were intentionally held in every live command. | Define notification policy separately before any customer-facing automation. |
| Proof/drop held policy | `HELD_NOT_REQUIRED_FOR_RECONCILIATION` | Needs policy decision | Delivered reconciliation intentionally avoided proof/drop. | Define proof/drop requirements before true delivery workflow automation. |
| Hub fallback suppression/merge behavior | Stale Hub row for `NV-MPZNKGNT` | Safe to generalize carefully as read-only aggregation | Read-only de-dupe/labeling avoids operator confusion without mutating Hub. | Keep Hub context visible and prefer native active row when confidently matched. |
| Historical Hub fulfilled mirror creation | Hub order `1052` only | Keep exact-order until more historical samples | Hub historical data quality varies and may lack payment/task/customer fields. | Add a historical batch preview before considering any bulk historical mirrors. |

## 5. Eligible future one-time order policy

A future order should be eligible for the controlled native one-time path only when all required conditions are true.

### Required eligibility

- Order is a one-time order.
- Fulfillment mode is single-delivery or otherwise clearly classified before task creation.
- Order is paid and captured.
- Order is not cancelled, refunded, partially refunded, disputed, or excluded.
- Order is not a subscription or multi-delivery order.
- Line items are present and normalized.
- Customer/order data is complete enough for the Customer App and native schemas.
- Native ShopifyOrder mirror exists or can be created through the safe mirror path.
- Native FulfillmentTask exists or can be created through the native task materialization path.
- Production master data exists or a non-stock master-data preview/import is clean.
- Production demand preview is clean.
- No OrderReviewQueue, SafeSyncParityLog, or duplicate/conflict blockers exist.
- Delivery or pickup classification is clear.
- Notification policy is explicitly `NO_NOTIFICATION` or a separately approved notification policy exists.
- No provider, Stripe, Shopify API, sync, repair, replay, inventory deduction, or PurchaseOrder mutation is required.

### Explicit exclusions

- Subscriptions.
- Multi-delivery orders.
- Refunded, partially refunded, cancelled, disputed, or excluded orders.
- Ambiguous customer/order identity.
- Missing line items.
- Missing required master data that is not covered by the non-stock import contract.
- Orders requiring proof/drop/delivery-photo behavior before policy is defined.
- Orders requiring inventory deduction or PurchaseOrder automation.
- Orders requiring provider, Stripe, Shopify, sync, repair, or replay calls.
- Orders with duplicate Customer App/native/Hub records that cannot be confidently reconciled by exact IDs.
- Orders whose customer-facing status or notification behavior is unclear.

## 6. Recommended next live pilot type

| Option | Assessment | Recommendation |
| --- | --- | --- |
| A. Monitor next natural paid one-time order | Best operational signal. Proves the native intake/mirror path on a real new order without manufacturing edge cases. | Recommended if a natural paid one-time order is expected soon. Run previews first; open exact gates only after clean approval. |
| B. Owner/test one-time order | Controlled and repeatable. Useful if no natural order is expected soon. Still requires payment/order-path care. | Acceptable fallback. Treat it as a real paid/captured order and keep provider/payment calls out of migration commands. |
| C. Broaden gates to all eligible one-time orders | Too early. Only one complete live lifecycle and one historical mirror backfill are proven. | Not recommended. |
| D. Continue one-off manual commands only | Safest but slow. Good for exceptional orders, not enough for migration progress. | Use only for exceptions while G33B/G33C prepare a second pilot. |

Recommended next phase: **G33B next natural one-time order monitoring**, followed by **G33C eligible one-time order preview bundle**. If no natural order arrives within the desired window, use an owner/test one-time order as **G33D controlled second order pilot**.

## 7. Hub fallback role

Hub fallback should remain active. The native path is proven for one controlled one-time order and one historical mirror, but the system still depends on Hub for unsupported flows, historical context, and operational fallback.

| Workflow area | Current role | Recommendation |
| --- | --- | --- |
| New eligible one-time orders | Customer App native path can become controlled pilot primary for exact approved orders. | Native primary for the next exact pilot only; Hub fallback remains shadow/context. |
| Unsupported one-time orders | Hub remains operational fallback. | Keep Hub fallback required. |
| Subscriptions / multi-delivery | Hub-only or legacy path. | Keep Hub primary until G36 policy/workflow exists. |
| Refunds / payment reversals | Not proven natively. | Keep Hub/provider workflow; do not native-cutover. |
| Production lifecycle | Native controlled path proven for one exact order. | Native primary only for exact approved pilots; Hub fallback retained. |
| Delivery workflow | Direct delivered reconciliation proven; true Out For Delivery workflow not live-proven. | Hub fallback required until delivery workflow is generalized. |
| Customer status / notifications | Customer status delivered proven with notifications disabled. | Native status updates remain exact-gated; notifications remain held. |
| Historical fulfilled orders | Native ShopifyOrder mirror backfill proven for one Hub order. | Use exact historical preview/backfill only; no bulk historical import. |
| Admin route summaries | Read-only native/Hub merge and stale fallback labeling are useful. | Continue de-dupe/labeling; do not mutate Hub to reconcile display. |
| Hub endpoint retirement | Not ready. | No broad retirement until G37 and all high-risk blockers close. |

## 8. Remaining blockers for full Hub retirement

| Blocker | Status | Risk | Required next step |
| --- | --- | --- | --- |
| Native safeSync broad writer | Controlled proven only | High | Second natural order pilot; then limited eligible-order allowlist. |
| Automatic paid order native ops path | Preview/controlled only | High | G33B/G33C monitoring and preview bundle. |
| Native ShopifyOrder mirror generalization | Controlled proven only | Medium-high | More paid one-time samples and duplicate/source-link validation. |
| Native FulfillmentTask materialization generalization | Controlled only | Medium-high | More delivery/pickup classification samples. |
| Production master data parity/import | Controlled proven for non-stock gaps | Medium | Expand non-stock import from preview only; keep inventory held. |
| Production demand materialization | Controlled proven | Medium-high | Second order with different product mix. |
| Production start/complete/verify lifecycle | Controlled proven | Medium-high | Repeat with second order; keep exact batch allowlists. |
| BatchComplianceLog creation | Controlled proven | Medium | Confirm schema and audit behavior across a second product mix. |
| Post-verify pack/bottle cascade | Controlled proven | Medium | Repeat on second order; keep exact task/order allowlists. |
| Customer pre-delivery status (`bottled_packed`) | Command-ready but not live-used in final pilot | Medium | Use only if future order has meaningful pre-delivery state and explicit approval. |
| Customer final delivered status | Controlled proven with notifications disabled | Medium | Repeat with exact order and keep notifications held. |
| Notification policy | Intentionally held | High | Define customer notification matrix by status/event/channel. |
| Proof/drop/route policy | Intentionally held | High | Define proof/drop requirements and customer/admin visibility. |
| True Out For Delivery workflow | Preview-ready, not live-proven | Medium-high | Plan gated command only if operational flow requires it. |
| Direct delivered reconciliation | Controlled proven | Medium | Keep for exception/reconciliation cases; not a substitute for full delivery workflow. |
| Inventory deduction | Not started / intentionally held | High | G34 inventory policy and audit-safe deduction contract. |
| PurchaseOrder automation | Not started / intentionally held | High | G34 PO policy after inventory/yield decisions. |
| Refunds / partial refunds / cancellations | Not started | High | G35 refund policy with provider/payment boundaries. |
| Subscriptions / multi-delivery | Not started | High | G36 dedicated workflow. |
| Historical backfills | Exact mirror proven for one order | Medium | Keep exact; avoid Customer App/task backfill without business need. |
| Admin UI live actions | Mostly intentionally absent | Medium | Add only after command contracts are generalized and audited. |
| Monitoring / alerts | Partial through previews/smoke checks | Medium | Add read-only monitoring for eligible next order; no broad automation yet. |
| Hub endpoint retirement | Not ready | High | G37 only after native workflows cover all active order classes. |
| Base44 publish/checkpoint reliability | Operational friction remains | Medium | Continue clean scope preflight; use Builder UI when CLI deploy is blocked. |

## 9. Recommended phase roadmap

| Phase | Purpose | Scope boundary |
| --- | --- | --- |
| G33B | Next natural one-time order monitoring | Read-only detection and preview of the next paid/captured one-time order; no gates opened automatically. |
| G33C | Eligible one-time order preview bundle | Combine safeSync, mirror/task, master data, demand, production, cascade, delivery, status, notification, and Hub fallback previews into one approval packet. |
| G33D | Controlled second order pilot | Run the second exact one-time order through the native lifecycle with exact gates and duplicate/idempotency checks. |
| G34 | Inventory / PurchaseOrder policy | Define whether and how inventory deduction and PO automation can happen natively. |
| G35 | Refund / payment reversal policy | Define refund, partial refund, cancellation, and payment-provider boundaries. |
| G36 | Subscription / multi-delivery workflow | Separate workflow for recurring/multi-delivery orders; do not force into one-time path. |
| G37 | Hub retirement plan | Endpoint-by-endpoint retirement only after native coverage, monitoring, fallback, and rollback policies are proven. |

## 10. Hard stops

Stop and require a separate explicit approval if any future order or command would require:

- Opening gates beyond one exact approved order/task/batch/Historical Hub order.
- Any provider, Stripe, or Shopify API call.
- Sync, repair, replay, broad recalculation, or bulk writer behavior.
- Notification creation or push/SMS/email/in-app send.
- Inventory deduction or PurchaseOrder creation.
- Proof/drop/route write.
- Hub mutation or Hub bridge retirement.
- Customer-facing status change whose notification behavior is not explicitly disabled or approved.
- Subscription, multi-delivery, refund, partial refund, cancellation, or disputed-order handling.
- ProductionBatch or BatchComplianceLog date rewrites after verification/locking.
- Customer App Order historical backfill that could expose an old order to a customer without owner approval.
- Native FulfillmentTask historical backfill without Hub task data or a dedicated hidden/historical task contract.

## 11. Readiness estimate

| Area | Estimate | Reasoning |
| --- | ---: | --- |
| Controlled one-time order flow | 92% | One exact paid/captured one-time order was proven end-to-end through native production, delivery reconciliation, and customer delivered status with side effects held. Remaining gap is repeatability across another order/product mix. |
| Generalized one-time order flow | 40% | Most pieces exist as previews or exact-gated commands, but the workflow is still dominated by exact order/task/batch allowlists, manual approvals, disabled notifications, held inventory/PO, and one live sample. |
| Full Hub retirement | 25% | Hub still covers unsupported flows, historical context, refunds, subscriptions/multi-delivery, provider/payment realities, inventory/PO policy, and fallback. Retirement planning should not start until multiple native order classes are proven. |

## 12. G33A conclusion

Close G33A as a docs-only readiness audit. Do not broaden gates. Do not retire Hub. Proceed to G33B/G33C to watch the next eligible one-time order and generate a complete read-only approval bundle before any second live pilot command runs.
