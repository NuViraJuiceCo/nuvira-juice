# G38A production lifecycle command readiness audit

## 1. Executive summary

G38A audits the native production lifecycle preview and command surfaces before the next real active one-time production pilot.

Current migration state: **hold_wait_for_next_order**.

Reason: G37B/G37C found no clean active paid/captured one-time Customer App order. The migration can keep getting production-ready, but the live one-time production lifecycle cannot be honestly re-proven on a natural order until a real active paid/captured order exists.

Key conclusions:

- The production lifecycle surface area exists in source and is listed in the deployed Base44 function inventory.
- The controlled exact one-time path was previously proven for `NV-MPZNKGNT`, but that does not replace the need for a next natural active-order repeatability pilot.
- Production lifecycle commands are default-off/gated and depend on fresh read-only previews before writes.
- Inventory deduction, PurchaseOrder automation, provider calls, notifications, broad sync/repair/replay, and Hub mutation remain held.
- The safest next work without a live candidate is either:
  - **G38B** fixture-only end-to-end lifecycle simulation, or
  - **G38C** live gates-closed boundary verification for deployed production commands.

No runtime code was changed. No schemas were changed. No Base44 publish was run. No live records were mutated.

## 2. Current migration state

| Area | State | Notes |
| --- | --- | --- |
| G33C late mirror | Completed for native ShopifyOrder + native FulfillmentTask + Watermelon Recipe gap | Production lifecycle backfill not recommended for late/historical order `NV-MP5SOQLJ`. |
| G37B/G37C candidate monitor | No clean active one-time candidate | Recent scans found only completed/historical or payment-not-ready/cancelled/refunded rows. |
| Hub | Active | Hub remains fallback/source of truth for unsupported paths. |
| Gates | Closed by policy | No broad gates should be opened. |
| Live production lifecycle | Held | Requires real active paid/captured one-time order and separate exact approval. |
| Inventory/PO | Held | Stock is not authoritative; inventory deduction and PO automation remain disabled. |
| Notifications | Held | No customer/admin notifications are part of this pilot sequence unless separately approved. |

## 3. Preview inventory

All listed preview functions exist in source and are present in `base44 functions list` as of this audit.

| Preview function | Purpose | Auth / access | Expected inputs | Read-only contract | Output readiness fields | One-time active order coverage | Late/historical coverage | Known gaps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `previewNativeProductionMasterDataParity` | Checks recipe/bundle/inventory/yield parity and non-stock seed/import packet readiness. | Admin or internal/service secret path. | Exact order/native ids or product/recipe scope; line-item context. | `dry_run:true`; no native writes; Hub lookup read-only. | `production_master_data_ready`, `non_stock_master_data_seed_ready`, `mirror_packet_ready`, blockers/warnings. | Yes, through exact order line items. | Yes for gap analysis; not proof of lifecycle. | Hub lookup/config can be shape-sensitive; exact single-item paths previously needed command-side normalization. |
| `previewNativeProductionInventoryReadiness` | Computes production/inventory/procurement visibility without stock mutation. | Admin or internal/service secret path. | Exact order/native/task ids, production/delivery dates, optional `NATIVE_PROCUREMENT_VISIBILITY`. | `dry_run:true`; `writes_performed:false`; inventory and PO held. | `production_ready`, `inventory_calculation_ready`, `procurement_visibility_ready`, `procurement_conversion_ready`, `inventory_deduction_ready:false`, `purchase_order_ready:false`. | Yes. | Yes for visibility only. | Stock remains non-authoritative; inventory deduction/PO remain intentionally not ready. |
| `previewNativeProductionDemandMaterialization` | Builds proposed ProductionBatch rows from exact order demand. | Admin or internal/service secret path. | Exact order/native/task ids and production date. | `dry_run:true`; no ProductionBatch writes. | `materialization_ready`, `proposed_batch_count`, `proposed_batches`, blockers/warnings. | Yes. | Can preview historical demand but should not be used as normal lifecycle proof. | Requires exact fresh active context before command use. |
| `previewNativeProductionBatchLifecycle` | Previews batch start/complete/verify readiness. | Admin or internal/service secret path. | Exact order ids or batch ids, production date, actual-unit/QC data where applicable. | `dry_run:true`; no batch/compliance writes. | start/complete/verify readiness, required fields, lifecycle blockers. | Yes after batches exist. | Batch-only/historical preview possible, but live backfill requires owner actuals/QC. | Complete requires actual units; verify requires pH/pass-fail/batch passed data. |
| `previewNativeProductionVerifyCascades` | Previews post-verify cascade readiness for task pack/order bottle/status impacts. | Admin or internal/service secret path. | Exact order/native/task/batch ids. | `dry_run:true`; no cascade writes. | pack/bottle/customer status readiness, cascade blockers/warnings. | Yes after verified batches/logs exist. | Historical use possible only as read-only context. | Requires verified batches and compliance logs; not a replacement for lifecycle execution. |
| `previewNativeDeliveryWorkflowReadiness` | Read-only delivery workflow readiness after production/task states. | Admin or internal/service secret path. | Exact order/native/task ids and delivery date. | `dry_run:true`; no proof/drop/route/status writes. | delivery readiness, route/proof/drop policy requirements, blockers/warnings. | Yes near delivery phase. | Historical delivery context only. | Route/proof/drop remains out of scope unless separately approved. |
| `previewNativeCustomerStatusNotificationImpact` | Previews status/notification impact without sending notifications. | Admin or internal/service secret path. | Exact order/native/task/batch ids and desired status context. | `dry_run:true`; notifications held. | status impact, notification policy requirements, existing notification/message counts. | Yes for status impact. | Historical status context only. | Does not authorize notifications. |
| `previewNativeCustomerDeliveredStatusImpact` | Previews Customer App delivered status correction/reconciliation without notification. | Admin only. | Exact customer/native/task ids, delivered status mode, `NO_NOTIFICATION`, proof/drop held policy. | `dry_run:true`; no Customer App Order writes. | `status_update_ready`, blockers/warnings, notification held state. | Yes after native task delivered. | Historical delivered reconciliation preview possible. | Requires exact delivered native task/order evidence. |
| `previewNativeOrderCutoverReadiness` | Consolidated cutover readiness and one-time order exact/recent previews, including G33C one-time mirror/task modes. | Admin or internal/service secret path. | Mode-specific; exact order ids or recent scan. | `dry_run:true`; no writes; Hub fallback expected. | one-time eligibility, mirror/task parity, blockers/warnings, safety flags. | Yes; G37C exact active preview should use this first. | Yes for late mirror context, but not production lifecycle proof. | Recent scan can be slower; exact target is preferred when order id is known. |

## 4. Command inventory

All listed command functions exist in source and are present in `base44 functions list` as of this audit. All must remain default-off unless a later phase gives exact live approval.

| Command | Introduced / domain | Purpose | Allowed write scope | Required fresh preview | Gate / policy / confirmation | Boundary status | Pilot readiness | Known blockers/gaps |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `createNativeOneTimeShopifyOrderMirrorForCustomerApp` | G33C-MIRROR2/3 | Exact one-time Customer App Order to native ShopifyOrder mirror. | One native `ShopifyOrder` + one safe `CommandLog`. | `previewNativeOrderCutoverReadiness`, mode `ONE_TIME_NATIVE_MIRROR_TASK_PARITY`. | `ENABLE_NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR`; kill switch; actor/order/customer allowlists; policy `EXACT_ONE_TIME_SHOPIFY_ORDER_MIRROR_ONLY_NO_NOTIFICATION`; confirmation `create_native_one_time_shopify_order_mirror_no_notification`. | Recently boundary-verified and live-used for G33C. | Ready for exact mirror use if future active order lacks native order. | Exact approval required; no task/order/Hub/provider/notification writes. |
| `createNativeOneTimeFulfillmentTaskMirrorForCustomerApp` | G33C-TASK2/3 | Exact native FulfillmentTask mirror linked to native ShopifyOrder. | One `FulfillmentTask` + one safe `CommandLog`. | `previewNativeOrderCutoverReadiness`, mode `ONE_TIME_NATIVE_FULFILLMENT_TASK_MIRROR_PACKET`. | `ENABLE_NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR`; kill switch; actor/order/customer/native order allowlists; policy `EXACT_ONE_TIME_FULFILLMENT_TASK_MIRROR_ONLY_NO_NOTIFICATION`; confirmation `create_native_one_time_fulfillment_task_mirror_no_notification`. | Recently boundary-verified and live-used for G33C. | Ready for exact task mirror use if future active order lacks native task. | Requires internal customer_email hydration without exposing PII. |
| `importNativeProductionMasterDataForCustomerApp` | G31G/G33C-WM2/WM3 | Non-stock master-data import; includes exact Watermelon Recipe-only mode. | Master-data rows approved by exact preview + one safe `CommandLog`; Watermelon mode allows one `Recipe` only. | `previewNativeProductionMasterDataParity`. | Generic policy `NON_STOCK_MASTER_DATA_ONLY`; Watermelon policy `EXACT_WATERMELON_JUICE_RECIPE_ONLY_NON_STOCK_NO_INVENTORY_NO_PO`; entity allowlist `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ENTITY_ALLOWLIST`; confirmations `import_customer_app_non_stock_master_data` or `import_watermelon_juice_recipe_non_stock_no_inventory_no_po`. | Recently boundary-verified and live-used for Watermelon Recipe. | Ready for exact master-data gap closure only after clean preview. | Do not use for broad import without exact scope. |
| `materializeNativeProductionBatchesForCustomerApp` | G31L | Materializes exact ProductionBatch rows from demand preview. | Exact `ProductionBatch` creates + one safe `CommandLog`. | `previewNativeProductionDemandMaterialization`. | `ENABLE_NATIVE_PRODUCTION_BATCH_MATERIALIZATION`; kill switch; actor/order allowlists; policy `EXACT_PREVIEW_PACKET_ONLY`; confirmation `materialize_native_production_batches_for_customer_app`. | Deployed/listed; live-used in prior exact-order pilot; needs fresh G38C boundary check before next pilot. | Command-ready when active candidate and demand preview are clean. | Function is exact-preview-packet scoped; no inventory/PO/compliance/order/task writes. |
| `startNativeProductionBatchesForCustomerApp` | G31O | Starts exact planned ProductionBatch rows. | Updates exact batches to `in_production` + safe `CommandLog`. | `previewNativeProductionBatchLifecycle` with start readiness. | `ENABLE_NATIVE_PRODUCTION_BATCH_START`; kill switch; actor/order/batch allowlists; policy `EXACT_PREVIEW_PACKET_ONLY`; confirmation `start_native_production_batches_for_customer_app`. | Deployed/listed; live-used in prior exact-order pilot; needs fresh G38C boundary check before next pilot. | Command-ready when exact batches exist and start preview is clean. | Sequential writes are not transactional; validate all targets before write. |
| `completeNativeProductionBatchesForCustomerApp` | G31R | Completes in-production batches with actual units. | Updates exact batches with actual units/end/completed metadata + safe `CommandLog`. | `previewNativeProductionBatchLifecycle` with completion readiness. | `ENABLE_NATIVE_PRODUCTION_BATCH_COMPLETE`; kill switch; actor/order/batch allowlists; policy `EXACT_BATCH_ACTUAL_UNITS_ONLY`; confirmation `complete_native_production_batches_for_customer_app`. | Deployed/listed; live-used in prior exact-order pilot; needs fresh G38C boundary check before next pilot. | Command-ready but needs owner/operator actual units per batch. | Do not infer actual units from planned units. |
| `verifyNativeProductionBatchesForCustomerApp` | G31U | Verifies completed batches with QC data and creates compliance logs. | Updates exact batches + creates one `BatchComplianceLog` per verified batch + safe `CommandLog`. | `previewNativeProductionBatchLifecycle` with verification readiness. | `ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY`; kill switch; actor/order/batch allowlists; policy `EXACT_BATCH_VERIFICATION_DATA_ONLY`; confirmation `verify_native_production_batches_for_customer_app`. | Deployed/listed; live-used in prior exact-order pilot; needs fresh G38C boundary check before next pilot. | Command-ready but needs exact pH/pass-fail/batch passed data. | No compliance log creation without exact QC inputs. |
| `packNativeProductionFulfillmentTaskForCustomerApp` | G31X | Packs exact native FulfillmentTask after verified production. | Updates exact `FulfillmentTask` pack/status metadata + safe `CommandLog`. | `previewNativeProductionVerifyCascades`. | `ENABLE_NATIVE_FULFILLMENT_TASK_PACK`; kill switch; actor/order/task allowlists; policy `EXACT_VERIFIED_ORDER_TASK_ONLY`; confirmation `pack_native_fulfillment_task_for_customer_app`. | Deployed/listed; live-used in prior exact-order pilot; needs fresh G38C boundary check before next pilot. | Command-ready after verified production cascade preview. | No order/customer/delivery/proof/provider/notification writes. |
| `bottleNativeProductionShopifyOrderForCustomerApp` | G31Z | Marks exact native ShopifyOrder bottled/production status after task pack. | Updates exact `ShopifyOrder` production/status audit metadata + safe `CommandLog`. | `previewNativeProductionVerifyCascades`. | `ENABLE_NATIVE_SHOPIFY_ORDER_BOTTLE`; kill switch; actor/order/native order allowlists; policy `EXACT_VERIFIED_PACKED_ONE_TIME_ORDER_ONLY`; confirmation `bottle_native_shopify_order_for_customer_app`. | Deployed/listed; live-used in prior exact-order pilot; needs fresh G38C boundary check before next pilot. | Command-ready after pack/bottle cascade preview. | No Customer App Order/task/batch/compliance/delivery/provider/notification writes. |
| `reconcileNativeDeliveryCompletionForCustomerApp` | G32I | Reconciles exact native task/order delivery completion without notification. | Exact native delivery/task/order reconciliation + safe `CommandLog` per command contract. | `previewNativeDeliveryCompletionReconciliation`. | `ENABLE_NATIVE_DELIVERY_COMPLETION_RECONCILIATION`; kill switch; actor/order/customer/native order/task allowlists; policy `DIRECT_DELIVERED_NO_NOTIFICATION`; confirmation `reconcile_native_delivery_completion_no_notification`; notification policy `NO_NOTIFICATION`. | Deployed/listed; prior boundary/use exists for exact pilot; needs fresh G38C if part of next pilot. | Command-ready only after delivery completion evidence exists. | Proof/drop/route and notifications remain held unless separately approved. |
| `updateNativeCustomerOrderDeliveredStatusForCustomerApp` | G32K | Updates Customer App Order delivered status after native delivery evidence. | Exact Customer App `Order` status/history + safe `CommandLog`. | `previewNativeCustomerDeliveredStatusImpact`. | `ENABLE_NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE`; kill switch; actor/order/customer/native order/task allowlists; policy `DELIVERED_STATUS_ONLY_NO_NOTIFICATION`; confirmation `update_customer_order_delivered_status_no_notification`. | Deployed/listed; prior boundary/use exists for exact pilot; needs fresh G38C if part of next pilot. | Command-ready only after native delivered evidence and customer status preview are clean. | Customer-facing status changes require separate exact approval. |
| `updateNativeCustomerOrderStatusForCustomerApp` | G32D adjacent status-only path | Status-only Customer App order command for earlier lifecycle/status corrections. | Exact Customer App `Order` status/history + safe `CommandLog`. | `previewNativeCustomerStatusNotificationImpact`. | See G32D docs/source for exact gates/policy/confirmation. | Deployed/listed; not a default next active-order production prerequisite unless status-only correction is needed. | Held unless a status-only gap exists. | Notifications remain held. |

## 5. Gate and policy map

| Gate family | Enable | Kill switch | Allowlists | Policy | Confirmation | Default state | G38C status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| One-time ShopifyOrder mirror | `ENABLE_NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR` | `NATIVE_ONE_TIME_SHOPIFY_ORDER_MIRROR_KILL_SWITCH` | actor, order, customer order | `EXACT_ONE_TIME_SHOPIFY_ORDER_MIRROR_ONLY_NO_NOTIFICATION` | `create_native_one_time_shopify_order_mirror_no_notification` | Closed | Recently verified in G33C; recheck only if reused. |
| One-time FulfillmentTask mirror | `ENABLE_NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR` | `NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_KILL_SWITCH` | actor, order, customer order, native ShopifyOrder | `EXACT_ONE_TIME_FULFILLMENT_TASK_MIRROR_ONLY_NO_NOTIFICATION` | `create_native_one_time_fulfillment_task_mirror_no_notification` | Closed | Recently verified in G33C; recheck only if reused. |
| Master-data import | `ENABLE_NATIVE_PRODUCTION_MASTER_DATA_IMPORT` | `NATIVE_PRODUCTION_MASTER_DATA_IMPORT_KILL_SWITCH` | actor, order, entity | `NON_STOCK_MASTER_DATA_ONLY` or exact entity policy | import-specific | Closed | Recently verified for Watermelon path; recheck before new import mode. |
| Batch materialization | `ENABLE_NATIVE_PRODUCTION_BATCH_MATERIALIZATION` | `NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH` | actor, order | `EXACT_PREVIEW_PACKET_ONLY` | `materialize_native_production_batches_for_customer_app` | Closed | Needs G38C. |
| Batch start | `ENABLE_NATIVE_PRODUCTION_BATCH_START` | `NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH` | actor, order, batch | `EXACT_PREVIEW_PACKET_ONLY` | `start_native_production_batches_for_customer_app` | Closed | Needs G38C. |
| Batch complete | `ENABLE_NATIVE_PRODUCTION_BATCH_COMPLETE` | `NATIVE_PRODUCTION_BATCH_COMPLETE_KILL_SWITCH` | actor, order, batch | `EXACT_BATCH_ACTUAL_UNITS_ONLY` | `complete_native_production_batches_for_customer_app` | Closed | Needs G38C. |
| Batch verify | `ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY` | `NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH` | actor, order, batch | `EXACT_BATCH_VERIFICATION_DATA_ONLY` | `verify_native_production_batches_for_customer_app` | Closed | Needs G38C. |
| Task pack | `ENABLE_NATIVE_FULFILLMENT_TASK_PACK` | `NATIVE_FULFILLMENT_TASK_PACK_KILL_SWITCH` | actor, order, task | `EXACT_VERIFIED_ORDER_TASK_ONLY` | `pack_native_fulfillment_task_for_customer_app` | Closed | Needs G38C. |
| Native ShopifyOrder bottle | `ENABLE_NATIVE_SHOPIFY_ORDER_BOTTLE` | `NATIVE_SHOPIFY_ORDER_BOTTLE_KILL_SWITCH` | actor, order, native order | `EXACT_VERIFIED_PACKED_ONE_TIME_ORDER_ONLY` | `bottle_native_shopify_order_for_customer_app` | Closed | Needs G38C. |
| Delivery completion reconciliation | `ENABLE_NATIVE_DELIVERY_COMPLETION_RECONCILIATION` | `NATIVE_DELIVERY_COMPLETION_RECONCILIATION_KILL_SWITCH` | actor, order, customer order, native order, task | `DIRECT_DELIVERED_NO_NOTIFICATION` | `reconcile_native_delivery_completion_no_notification` | Closed | Needs G38C if in next pilot scope. |
| Customer delivered status | `ENABLE_NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE` | `NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_KILL_SWITCH` | actor, order, customer order, native order, task | `DELIVERED_STATUS_ONLY_NO_NOTIFICATION` | `update_customer_order_delivered_status_no_notification` | Closed | Needs G38C if in next pilot scope. |

Broad gates are prohibited for this migration. Every future live write must be exact target allowlisted and separately approved.

## 6. Allowed-write matrix

| Domain | Function | Allowed entity writes | Forbidden writes / actions | Provider calls | Notifications | Hub mutation | Inventory deduction | PO creation | Next required approval |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Native ShopifyOrder mirror | `createNativeOneTimeShopifyOrderMirrorForCustomerApp` | One `ShopifyOrder`, one `CommandLog` | Order/task/batch/log queues/notifications/Hub/provider | False | False | False | False | False | Exact mirror approval for target. |
| Native FulfillmentTask mirror | `createNativeOneTimeFulfillmentTaskMirrorForCustomerApp` | One `FulfillmentTask`, one `CommandLog` | Customer App Order/native order/batch/compliance/notifications/Hub/provider | False | False | False | False | False | Exact task mirror approval for target. |
| ProductionBatch materialization | `materializeNativeProductionBatchesForCustomerApp` | Exact `ProductionBatch` creates, one `CommandLog` | Existing orders/tasks/master-data/compliance/inventory/PO | False | False | False | False | False | Exact materialization approval after clean demand preview. |
| Production start | `startNativeProductionBatchesForCustomerApp` | Exact `ProductionBatch` updates, one `CommandLog` | Actual units/QC/compliance/inventory/PO/order/task | False | False | False | False | False | Exact start approval after clean lifecycle preview. |
| Production complete | `completeNativeProductionBatchesForCustomerApp` | Exact `ProductionBatch` actual unit completion updates, one `CommandLog` | Verify/QC/compliance/inventory/PO/order/task | False | False | False | False | False | Exact complete approval with actual units. |
| Production verify | `verifyNativeProductionBatchesForCustomerApp` | Exact `ProductionBatch` verification updates, `BatchComplianceLog`, one `CommandLog` | Inventory/PO/order/task/delivery/provider/notification/Hub | False | False | False | False | False | Exact verify approval with QC data. |
| FulfillmentTask pack | `packNativeProductionFulfillmentTaskForCustomerApp` | Exact `FulfillmentTask` pack/status update, one `CommandLog` | Orders/batches/compliance/delivery/notifications | False | False | False | False | False | Exact pack approval after verified cascade preview. |
| ShopifyOrder bottled | `bottleNativeProductionShopifyOrderForCustomerApp` | Exact `ShopifyOrder` bottled/status update, one `CommandLog` | Customer App Order/task/batch/compliance/delivery/notifications | False | False | False | False | False | Exact bottle approval after verified cascade preview. |
| Delivery reconciliation | `reconcileNativeDeliveryCompletionForCustomerApp` | Exact native delivery completion fields per command contract, one `CommandLog` | Notifications/proof-drop-route unless approved, inventory/PO/Hub | False | False | False | False | False | Exact delivery reconciliation approval. |
| Customer App delivered status | `updateNativeCustomerOrderDeliveredStatusForCustomerApp` | Exact Customer App `Order` status/history, one `CommandLog` | Notifications/native records/batches/Hub/provider | False | False | False | False | False | Exact customer status approval. |
| Recipe/master-data import | `importNativeProductionMasterDataForCustomerApp` | Exact preview-approved master data, one `CommandLog` | Orders/tasks/batches/inventory stock/PO/notifications/Hub | False | False | False | False | False | Exact import approval after clean parity preview. |

## 7. Fresh preview dependency map

| Command | Required preview | Required clean fields | Fail-closed conditions |
| --- | --- | --- | --- |
| ShopifyOrder mirror | `previewNativeOrderCutoverReadiness`, `ONE_TIME_NATIVE_MIRROR_TASK_PARITY` | paid/captured, one-time, delivery/pickup, native order missing, task held, no blockers, provider/notification/Hub held. | Any blocker, native order exists unless idempotent, policy mismatch, evidence missing. |
| FulfillmentTask mirror | `previewNativeOrderCutoverReadiness`, `ONE_TIME_NATIVE_FULFILLMENT_TASK_MIRROR_PACKET` | native ShopifyOrder present, task missing, packet ready, duplicate risk false, customer_email internally hydratable. | Task exists/conflict, packet not ready, missing native order, missing required internal fields. |
| Master-data import | `previewNativeProductionMasterDataParity` | exact entity rows ready, no deferred/blocked rows unless explicitly supported, inventory/PO held. | Missing Hub/native dependency, unexpected create rows, schema blockers, inventory/PO enabled. |
| Batch materialization | `previewNativeProductionDemandMaterialization` | `production_ready:true`, `materialization_ready:true`, proposed batch rows exact and stable, no blockers. | Preview drift, row count/name/unit mismatch, existing conflicting batches. |
| Start production | `previewNativeProductionBatchLifecycle` | exact batches exist, planned state, `start_ready_count` matches target count, no blockers. | Missing/mismatched/terminal/locked/partial batches. |
| Complete production | `previewNativeProductionBatchLifecycle` | exact batches in production, actual units supplied for each target, no blockers. | Missing actual units, partial state, locked/terminal mismatch. |
| Verify production | `previewNativeProductionBatchLifecycle` | exact completed-pending-verification batches, pH/pass-fail/batch passed data supplied, no blockers. | Missing QC values, batch failed without correction policy, existing conflicting compliance logs. |
| Pack task | `previewNativeProductionVerifyCascades` | verified batches/logs present, task pack ready, notifications/provider/Hub held. | Missing verified batches/logs, task already conflicting, side-effect projection. |
| Bottle native order | `previewNativeProductionVerifyCascades` | task packed, native order bottle ready, notifications/provider/Hub held. | Task not packed, order status conflict, side-effect projection. |
| Delivery reconciliation | `previewNativeDeliveryCompletionReconciliation` | exact native task/order delivery evidence, `NO_NOTIFICATION`, proof/drop policy held. | Missing delivered evidence, proof/drop/route needed but not approved, notification projected. |
| Customer delivered status | `previewNativeCustomerDeliveredStatusImpact` | native delivered evidence, Customer App Order not already delivered or idempotent, no notification. | Delivered evidence missing, status mapping mismatch, notification/proof/drop projected. |

## 8. Harness coverage map

| Harness | Proves | Does not prove |
| --- | --- | --- |
| `scripts/migration/run-g31k-native-production-demand-materialization-tests.mjs` | Demand preview packets and no-write behavior. | Live batch writes or live data freshness. |
| `scripts/migration/run-g31l-native-production-batch-materialization-tests.mjs` | Batch materialization command fixtures, gates/idempotency/no side effects. | Current live boundary and next natural-order readiness. |
| `scripts/migration/run-g31n-native-production-lifecycle-preview-tests.mjs` | Lifecycle preview start/complete/verify readiness shapes. | Live command execution. |
| `scripts/migration/run-g31o-native-production-start-tests.mjs` | Start command gates/idempotency/no side effects in fixture. | Current live boundary freshness. |
| `scripts/migration/run-g31r-native-production-complete-tests.mjs` | Complete command actual-units contract/idempotency. | Owner actual-unit capture process. |
| `scripts/migration/run-g31u-native-production-verify-tests.mjs` | Verify command QC/compliance contract/idempotency. | Real pH/QC capture process. |
| `scripts/migration/run-g31w-native-post-verify-cascade-preview-tests.mjs` | Post-verify cascade preview. | Live pack/bottle/status writes. |
| `scripts/migration/run-g31x-native-fulfillment-task-pack-tests.mjs` | Pack command fixture safety. | Current live boundary freshness. |
| `scripts/migration/run-g31z-native-shopify-order-bottle-tests.mjs` | Bottle command fixture safety. | Current live boundary freshness. |
| `scripts/migration/run-g32i-delivery-completion-reconciliation-tests.mjs` | Delivery reconciliation command fixture safety. | Real delivery/proof/drop policy choices. |
| `scripts/migration/run-g32k-customer-delivered-status-tests.mjs` | Delivered Customer App status command fixture safety. | Customer-facing approval and notification policy beyond `NO_NOTIFICATION`. |
| `scripts/migration/run-g33c-*` | One-time active candidate, mirror, task packet/command safety. | Production lifecycle execution. |
| `scripts/migration/run-g34b-native-procurement-visibility-tests.mjs` | Procurement visibility and inventory/PO held policy. | Inventory deduction or PO automation. |
| `scripts/migration/run-g35*` | Refund shared-preview/regression coverage. | Production command execution. |
| `scripts/migration/run-g36*` | Subscription/multi-delivery shared preview/regression coverage. | One-time production lifecycle proof. |

Future preflight batch should include G31K/L/N/O/R/U/W/X/Z, G32I/K, G33C mirror/task, G34B, and shared G35/G36 preview regression harnesses when `previewNativeOrderCutoverReadiness` or shared production preview code changes.

## 9. G38C boundary verification checklist

Do not run live commands in G38A. G38C should run gates-closed boundary checks only.

For each deployed command in G38C:

1. `GET` should return `405` with `writes_performed:false`.
2. Unauthenticated `POST` should return `401` with `writes_performed:false`.
3. Admin-auth gates-closed `POST` should return `409` disabled or `kill_switch_active` with `writes_performed:false`.
4. Disabled/pre-gate calls should not create `CommandLog`.
5. No-write verification should scan request ids across:
   - `ShopifyOrder`
   - `Order`
   - `FulfillmentTask`
   - `ProductionBatch`
   - `BatchComplianceLog`
   - `OrderSyncLog`
   - `CommandLog`
   - `OrderReviewQueue`
   - `Notification`
   - `CustomerMessageDeliveryLog`
   - `PurchaseOrder`
   - `ManualProductionBatch`

Commands that need G38C freshness before next pilot:

- `materializeNativeProductionBatchesForCustomerApp`
- `startNativeProductionBatchesForCustomerApp`
- `completeNativeProductionBatchesForCustomerApp`
- `verifyNativeProductionBatchesForCustomerApp`
- `packNativeProductionFulfillmentTaskForCustomerApp`
- `bottleNativeProductionShopifyOrderForCustomerApp`
- `reconcileNativeDeliveryCompletionForCustomerApp`, if delivery is in next pilot scope
- `updateNativeCustomerOrderDeliveredStatusForCustomerApp`, if customer status is in next pilot scope

Mirror and Watermelon import commands were recently boundary-verified during G33C/G33C-WM work, but should still be rechecked if patched or reused for a new target.

## 10. Readiness grading

| Domain | Grade | Rationale |
| --- | --- | --- |
| One-time native mirror intake | A — ready for exact active-order pilot when candidate exists | G33C mirror command was deployed, boundary-verified, and live-used safely. |
| FulfillmentTask mirror | A — ready for exact active-order pilot when candidate exists | G33C task command was deployed, boundary-verified, and live-used safely. |
| Master-data import | A/B — ready for exact gaps; recheck if new entity mode | Watermelon Recipe path proven; broad import remains exact-preview gated. |
| Procurement visibility | A — preview-ready | Read-only visibility ready; inventory/PO remain held. |
| ProductionBatch materialization | B — command-ready but needs fresh boundary verification | Prior exact pilot proven; next pilot needs G38C and fresh demand preview. |
| Production start | B — command-ready but needs fresh boundary verification | Requires exact planned batches and clean lifecycle preview. |
| Production complete | E — held pending owner/operator actual units | Command exists, but actual units must be provided, not inferred. |
| Production verify | E — held pending owner/operator QC data | Command exists, but pH/pass-fail/batch passed values are required. |
| Post-verify cascade | B — command-ready but needs fresh boundary verification | Pack/bottle previews and commands exist. |
| Delivery reconciliation | B/E — command-ready but depends on delivery evidence and approval | Use only after exact delivered native evidence. |
| Customer delivered status | B/E — command-ready but customer-facing status approval required | `NO_NOTIFICATION` status-only path exists; exact approval required. |
| Inventory deduction | G — not ready / intentionally held | Stock is not authoritative and owner yield/conversion inputs remain unresolved. |
| PurchaseOrder automation | G — not ready / intentionally held | PO automation remains held. |
| Notifications | G — not ready / intentionally held | No-notification policy remains the migration default. |

## 11. Gap list before next real pilot

Required before the next natural paid one-time production pilot:

1. **Active order candidate availability** — need exact real paid/captured one-time order; G37C currently has none.
2. **G37C exact eligibility preview** — must classify candidate before mirror/task/production planning.
3. **Mirror state** — native ShopifyOrder and FulfillmentTask must exist or be created through exact mirror/task approvals first.
4. **G38C boundary freshness** — production commands need gates-closed boundary checks before live pilot use.
5. **Fresh master-data/procurement/demand previews** — exact active order must show no blocking recipe/item/yield gaps.
6. **Actual units capture process** — complete command needs owner/operator-provided actual units for each batch.
7. **QC capture process** — verify command needs pH/pass-fail/batch passed data for each batch.
8. **Inventory deduction held** — no inventory write should be introduced into the next pilot.
9. **PurchaseOrder held** — no PO automation should be introduced into the next pilot.
10. **Notifications held** — no notification send should be introduced into the next pilot.
11. **Hub fallback active** — do not retire Hub during next exact pilot.
12. **Function-count constraint** — avoid new standalone functions; extend existing functions only with explicit design approval.
13. **Preview response consistency** — exact IDs and stable request ids are required; fail closed on preview drift.
14. **Owner approvals** — each write phase needs separate exact approval and a new request id.

## 12. Recommended next phases

Recommended sequence without a live active order:

1. **G38B — fixture-only end-to-end production lifecycle simulation**
   - No live records.
   - Proves demand preview → batch materialization → start → complete → verify → cascade held sequence in local harnesses.
   - Best next step if the goal is code confidence while waiting for a real order.

2. **G38C — live gates-closed boundary verification**
   - No live writes.
   - Confirms deployed command surfaces are still safe with closed gates.
   - Best next step if the goal is live surface safety confidence.

3. **Hold G37C until a real order exists**
   - Once a natural paid/captured one-time order appears, run exact G37C preview with order number and Customer App Order id.

4. **Owner actuals/QC input templates**
   - Prepare operator packet for actual units and pH/QC capture so complete/verify phases do not stall during the next pilot.

Recommendation: run **G38B** next if improving code confidence is the priority; run **G38C** next if live boundary confidence is the priority. Keep G37C held until a real active paid/captured one-time order exists.

## 13. Hard stops

Stop and do not proceed to live writes if any of these are true:

- No real active paid/captured one-time order exists.
- Candidate is delivered, bottled, packed, cancelled, refunded, subscription, multi-delivery, synthetic/test/POS-only, or historical/late-mirror only.
- Native ShopifyOrder or FulfillmentTask is missing and exact mirror/task preview has not passed.
- Any fresh preview returns blockers.
- Any target id mismatches.
- Any broad gate is enabled.
- Any provider/Stripe/Shopify call would be required.
- Any notification would be sent.
- Any Hub mutation would occur.
- Any inventory deduction or PurchaseOrder creation would occur.
- Actual units or QC data are missing for complete/verify.
- Function boundary verification is stale or failing.
- Base44 function-count/platform constraints require a new function without explicit slot approval.

## 14. No-write confirmation

G38A was source/docs/harness/deployed-list audit only.

Confirmed:

- no live production commands were run
- no gates were opened
- no `ProductionBatch` was created or updated
- no `BatchComplianceLog` was created or updated
- no Customer App Order was mutated
- no native ShopifyOrder was mutated
- no native FulfillmentTask was mutated
- no inventory deduction occurred
- no PurchaseOrder was created
- no notifications or message logs were created
- no Stripe/Shopify/provider calls were made
- no Hub records were mutated
- no sync/repair/replay was run
- no Base44 publish was run
- no runtime code or schema changed
