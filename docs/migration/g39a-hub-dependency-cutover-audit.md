# G39A Hub Dependency Cutover Audit

## 1. Executive summary

G39A is a static/read-only audit of Customer App dependencies on the Operations Hub. No runtime code was changed, no schemas were changed, no Base44 publish was performed, no Hub/Stripe/Shopify/provider call was made, and no live records were mutated.

Current migration state:

- native one-time ShopifyOrder mirror is proven
- native FulfillmentTask mirror is proven
- Watermelon Juice native master-data gap is closed
- production lifecycle commands are boundary-safe
- fixture-only production lifecycle simulation is proven locally
- live production lifecycle proof remains blocked until a real active paid/captured one-time order exists
- Hub remains active and is still source-of-truth/fallback in multiple domains

Static audit result:

| Metric | Count | Notes |
|---|---:|---|
| Files matching Hub/sync/repair/fallback terms, excluding the unrelated `entry 2.ts` caveat file | 362 | Includes runtime, schema, frontend, scripts, and docs |
| Runtime function files with direct Hub env/API/proxy usage | 125 | `HUB_API_URL`, `CUSTOMER_APP_SYNC_SECRET`, `HUB_SYNC_SECRET`, Hub fetch, or Hub proxy patterns |
| Hub write-ish runtime function names | 26 | Includes explicit sync/push/backfill/repair/receive Hub surfaces |
| Entity schemas carrying Hub/sync/parity fields | 12 | Migration linkage, sync logs, legacy Hub ids, and parity logs |
| Frontend files referencing Hub-backed surfaces | 18 | Admin operations, delivery, production, inventory, orders, tracker, settings/checkout |
| Migration scripts referencing Hub/sync/repair/parity terms | 43 | Harness/test/migration support only |
| Migration docs referencing Hub/sync/repair/parity terms | 112 | Docs/test-only unless paired with runtime function references |

Top-level conclusion:

- Hub cannot be disabled globally yet.
- Hub write paths remain live or potentially live in order/customer/subscription/refund/delivery/status domains.
- Admin dashboards are the safest first cutover target because several already have native fallback/read context.
- Customer-facing cutover must wait for exact parity previews because `OrderTracker` and customer order detail still depend on Hub-backed order detail context.
- Subscriptions and refunds should remain Hub source-of-truth for now.
- Inventory deduction and PurchaseOrder automation remain not ready.

Recommended next phase: **G39B native-first read parity preview for admin/order surfaces**.

## 2. Scope and method

Static scan only. No live endpoint or provider call was made.

Directories scanned:

- `base44/functions`
- `base44/entities`
- `src/pages`
- `src/components`
- `scripts/migration`
- `docs/migration`
- package/build/config files where relevant

Search terms included:

- `hubSyncProxy`
- `syncOrderToHub`
- `syncCustomerToHub`
- `syncSubscriptionToHub`
- `syncHubDeliveryStatuses`
- `getAdminOrdersWithHub`
- `getCustomerOrdersWithHub`
- `getAdminDeliveryRouteSummary`
- `getCustomerOrders`
- `getAdminOrders`
- `safeSync`
- `manualPushOrderToHub`
- `pushOrderStatusToHub`
- `syncRefundToHub`
- `processStripeRefund`
- `subscription fulfillment`
- `syncSubscriptionWithFulfillments`
- `Hub fallback` / `hub fallback`
- `HUB_API_URL`
- `CUSTOMER_APP_SYNC_SECRET`
- `HUB_SYNC_SECRET`
- `HUB_` / `hub_`
- `hubOrder`, `hubTask`, `hubSubscription`
- `source_type: hub`, `source_channel: hub`
- `historical_hub`, `hub_historical_backfill`
- `native_safe_sync`
- `OrderSyncLog`, `SafeSyncParityLog`, `OrderReviewQueue`
- `repair`, `replay`

Important caveat: the unrelated untracked file `base44/functions/previewNativeOrderCutoverReadiness/entry 2.ts` was excluded from the inventory and remains outside scope.

## 3. Hub dependency inventory

### 3.1 Dependency classes found

| Dependency type | Runtime examples | Classification |
|---|---|---|
| Hub proxy | `hubSyncProxy` | `Hub proxy`, `customer_surface_still_hub_backed` |
| Hub write | `syncOrderToHub`, `syncCustomerToHub`, `syncRefundToHub`, `syncSubscriptionPlansToHub`, `syncShopifyOrderToHub` | `write_path_still_going_to_hub` |
| Hub pull/read | `getAdminOrdersWithHub`, `getCustomerOrdersWithHub`, `getAdminDeliveryRouteSummary`, `getCustomerOrderDetail` | `read_only_hub_fallback_still_active` / `admin_dashboard_still_hub_backed` / `customer_surface_still_hub_backed` |
| Hub status sync | `syncHubDeliveryStatuses`, `hubToCustomerAppStatusSync`, `pushOrderStatusToHub` | `production_delivery_lifecycle_still_hub_backed` |
| Hub repair/replay | `retryFailedHubSyncs`, `debugAndRetryHubSync`, `recoverStuckOrder`, subscription repair functions | `repair_replay_hub_dependent` |
| Historical Hub backfill | `previewAdminHistoricalHubBackfill`, `backfillAdminHistoricalHubOrders`, `previewHistoricalHubFulfilledNativeBackfill` | `historical_backfill_hub_dependent` |
| Subscription/recurrence | `syncSubscriptionWithFulfillments`, `syncSubscriptionFromHub`, `syncAllSubscriptionsFromHub`, G36 occurrence mirror functions | `subscription_recurrence_still_hub_backed` |
| Refund/payment | `stripeWebhook`, `processManualRefund`, `syncRefundToHub`, G35 native refund previews/review queue | `refund_payment_still_hub_source_of_truth` |
| Master-data fallback | `previewNativeProductionMasterDataParity`, production/inventory/procurement previews | `master_data_hub_fallback_still_active` |
| Admin dashboard fallback | `getAdminOperationsDashboardSummary`, `getAdminProductionPlanningSummary`, `getAdminDeliveryRouteSummary`, `getAdminOrdersWithHub` | `admin_dashboard_still_hub_backed` |
| Customer-facing fallback | `getCustomerOrderDetail`, `getCustomerOrdersWithHub`, `OrderTracker` | `customer_surface_still_hub_backed` |
| Docs/test-only | migration docs, fixture harnesses, script references | `docs_or_test_only_no_runtime_dependency` |

### 3.2 Direct runtime Hub usage files

Static scan found 125 runtime function files with direct Hub env/API/proxy usage. These are the key files to track during cutover because they reference Hub configuration, Hub API calls, Hub sync secrets, or Hub fallback behavior.

Representative direct-runtime files:

- `base44/functions/hubSyncProxy/entry.ts`
- `base44/functions/syncOrderToHub/entry.ts`
- `base44/functions/syncCustomerToHub/entry.ts`
- `base44/functions/syncUserToHub/entry.ts`
- `base44/functions/syncShopifyOrderToHub/entry.ts`
- `base44/functions/syncRefundToHub/entry.ts`
- `base44/functions/syncSubscriptionPlansToHub/entry.ts`
- `base44/functions/syncSubscriptionWithFulfillments/entry.ts`
- `base44/functions/syncHubDeliveryStatuses/entry.ts`
- `base44/functions/hubToCustomerAppStatusSync/entry.ts`
- `base44/functions/manualPushOrderToHub/entry.ts`
- `base44/functions/pushOrderStatusToHub/entry.ts`
- `base44/functions/getAdminOrdersWithHub/entry.ts`
- `base44/functions/getCustomerOrdersWithHub/entry.ts`
- `base44/functions/getCustomerOrderDetail/entry.ts`
- `base44/functions/getAdminDeliveryRouteSummary/entry.ts`
- `base44/functions/getAdminOperationsDashboardSummary/entry.ts`
- `base44/functions/getAdminProductionPlanningSummary/entry.ts`
- `base44/functions/getAdminInventoryStatusSummary/entry.ts`
- `base44/functions/getAdminProductionQueueSummary/entry.ts`
- `base44/functions/previewNativeOrderCutoverReadiness/entry.ts`
- `base44/functions/previewNativeProductionMasterDataParity/entry.ts`
- `base44/functions/previewNativeProductionInventoryReadiness/entry.ts`
- `base44/functions/previewNativeProductionDemandMaterialization/entry.ts`
- `base44/functions/previewNativeDeliveryWorkflowReadiness/entry.ts`
- `base44/functions/stripeWebhook/entry.ts`
- `base44/functions/processManualRefund/entry.ts`
- `base44/functions/createNativePartialRefundReviewQueueForCustomerApp/entry.ts`
- `base44/functions/createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp/entry.ts`
- `base44/functions/backfillAdminHistoricalHubOrders/entry.ts`
- `base44/functions/backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp/entry.ts`

This list is not permission to remove or suppress anything. It is the current Hub dependency surface.

### 3.3 Entity schemas carrying Hub/sync/parity fields

| Entity schema | Hub dependency role | Cutover note |
|---|---|---|
| `Order` | includes `hub_mirror` source/status context | Native order remains primary Customer App record; Hub linkage still useful for parity/history |
| `ShopifyOrder` | native mirror entity includes source/sync fields and `hub_mirror` source option | Native mirror replacement exists for one-time pilot contexts |
| `FulfillmentTask` | stores external/legacy Hub fulfillment task id and sync metadata | Native task replacement exists for one-time pilot contexts |
| `OrderSyncLog` | stores Hub action, Hub order ids, sync status | Required for bridge audit until Hub writes are suppressed |
| `SafeSyncParityLog` | stores Hub result summary and native safe-sync comparison | Useful for parity/shadow observation |
| `OrderReviewQueue` | review queue for native/Hub mismatch or unsafe writes | Native replacement/control surface, keep |
| `Subscription` | Hub sync status/response fields | Subscription Hub source-of-truth remains |
| `PendingSubscriptionCheckout` | stores Hub payload for retry/audit | Subscription/multi-delivery still Hub-backed |
| `DriverActionLog` | Hub sync status/error fields | Delivery driver actions still bridge-dependent |
| `Event` | Hub event id for upsert matching | Event sync remains Hub-linked |
| `ProductionBatch` | legacy Hub batch id for migration parity | Native production replacement exists but live proof still pending real order |
| `ManualProductionBatch` | legacy Hub manual batch id | Historical/manual production parity only |

## 4. Classification table

| Dependency | File/path family | Runtime/docs | Trigger | Classification | Native replacement readiness |
|---|---|---|---|---|---|
| Order Hub bridge write | `syncOrderToHub` | runtime | checkout/payment/order event, manual sync, webhook path | `write_path_still_going_to_hub` | `native_replacement_partial` |
| Customer profile Hub write | `syncCustomerToHub`, `syncUserToHub` | runtime | customer action/profile update | `write_path_still_going_to_hub` | `native_replacement_partial` |
| Hub proxy pull endpoint | `hubSyncProxy` | runtime | Hub pull/sync | `Hub proxy`, `customer_surface_still_hub_backed` | `native_read_surface_partial` |
| Admin order read expansion | `getAdminOrdersWithHub`, `AdminOrders.jsx` | runtime/frontend | admin read | `admin_dashboard_still_hub_backed` | `native_replacement_partial` |
| Customer order detail | `getCustomerOrderDetail`, `OrderTracker.jsx` | runtime/frontend | customer read | `customer_surface_still_hub_backed` | `replace_after_native_parity_preview` |
| Customer orders with Hub | `getCustomerOrdersWithHub` | runtime | customer/admin read | `customer_surface_still_hub_backed` | `replace_after_native_parity_preview` |
| Delivery route summary | `getAdminDeliveryRouteSummary`, `DeliveryQueue.jsx` | runtime/frontend | admin read/action preview | `production_delivery_lifecycle_still_hub_backed` | `native_replacement_partial` |
| Delivery status sync | `syncHubDeliveryStatuses`, `hubToCustomerAppStatusSync`, `pushOrderStatusToHub` | runtime | scheduled/sync/admin action | `production_delivery_lifecycle_still_hub_backed` | `native_command_exists_but_held` |
| Admin operations summary | `getAdminOperationsDashboardSummary`, `Operations.jsx` | runtime/frontend | admin read | `admin_dashboard_still_hub_backed` | `native_first_ready` |
| Production planning summary | `getAdminProductionPlanningSummary`, `ProductionQueueSummary.jsx` | runtime/frontend | admin read | `admin_dashboard_still_hub_backed` | `native_replacement_partial` |
| Inventory status/procurement | `getAdminInventoryStatusSummary`, `InventoryStatus.jsx` | runtime/frontend | admin read | `master_data_hub_fallback_still_active` | `blocked_by_owner_input` |
| Production lifecycle commands | native production command functions | runtime | exact command | `already_replaced_by_native_backend` for command shell; live proof blocked | `blocked_by_real_order_event` |
| Master-data parity/import | native preview/import functions | runtime | preview/exact command | `master_data_hub_fallback_still_active` | `native_replacement_partial` |
| Refund/payment bridge | `stripeWebhook`, `processManualRefund`, `syncRefundToHub` | runtime | webhook/admin refund | `refund_payment_still_hub_source_of_truth` | `native_preview_exists_only` / `native_command_exists_but_held` |
| Subscription recurrence | subscription sync/generation/repair functions, G36 mirror command | runtime | subscription checkout/recurrence/sync | `subscription_recurrence_still_hub_backed` | `native_preview_exists_only` / `native_command_exists_but_held` |
| Repair/replay | `retryFailedHubSyncs`, `debugAndRetryHubSync`, `recoverStuckOrder`, repair functions | runtime/admin/internal | admin/scheduled repair | `repair_replay_hub_dependent` | `replace_after_native_parity_preview` |
| Historical backfill | historical Hub preview/backfill functions | runtime/admin/internal | admin backfill | `historical_backfill_hub_dependent` | `keep_hub_source_of_truth_for_now` |
| Migration docs/harnesses | docs/scripts | docs/test | local/static | `docs_or_test_only_no_runtime_dependency` | not applicable |

## 5. Domain summaries

### 5.1 Customer/order intake

Current source of truth:

- Customer App `Order` is canonical for app-created order identity and payment state.
- Hub remains live bridge/writer for operational Hub flow through `syncOrderToHub`.
- Native `ShopifyOrder` mirror exists and has been proven for exact one-time pilot contexts.

Hub dependencies:

- `syncOrderToHub`
- `syncShopifyOrderToHub`
- `shopifyWebhookReceiver` Hub bridge context
- `OrderSyncLog`
- `SafeSyncParityLog`
- `OrderReviewQueue`

Active write risk: high. `syncOrderToHub` can still push order/refund bridge data to Hub.

Native replacement status: partial. Exact native mirror is proven for one-time pilots, but broad intake/mirror suppression is not yet approved.

Next safest cutover step:

- G39B native-first read parity preview for admin/order surfaces.
- Do not suppress `syncOrderToHub` yet.

### 5.2 Customer profile/account

Current source of truth:

- Customer App entities hold profile/account data.
- Hub customer sync remains write-capable.

Hub dependencies:

- `syncCustomerToHub`
- `syncUserToHub`
- `Checkout.jsx` bag return/customer sync path
- `AccountSettings.jsx` profile sync path

Active write risk: medium/high because customer actions can trigger Hub writes.

Native replacement status: partial. Customer App profile data exists, but Hub suppression/parity has not been proven.

Next safest cutover step:

- Add native-first customer/account read parity before suppressing Hub writes.

### 5.3 One-time order native mirror

Current source of truth:

- Exact native one-time mirror path is proven for controlled order/task contexts.
- Hub remains active bridge/fallback.

Hub dependencies:

- `previewNativeOrderCutoverReadiness`
- `createNativeOneTimeShopifyOrderMirrorForCustomerApp`
- `createNativeOneTimeFulfillmentTaskMirrorForCustomerApp`
- `OrderSyncLog`, `OrderReviewQueue`, `SafeSyncParityLog`

Active write risk: low when gates closed; high only if broad mirror gates were opened, which is prohibited.

Native replacement status: strong for exact pilots, not broad rollout.

Next safest cutover step:

- Wait for next natural active paid/captured one-time order and run exact G37C preview.

### 5.4 FulfillmentTask / delivery task

Current source of truth:

- Native FulfillmentTask mirror path is proven for exact one-time pilot context.
- Hub delivery/task context remains active for admin/customer surfaces.

Hub dependencies:

- `getAdminFulfillmentTaskDetails`
- `getAdminDeliveryRouteSummary`
- `markAdminFulfillmentTaskOutForDelivery`
- `recordAdminFulfillmentTaskDelivered`
- `syncHubDeliveryStatuses`
- `DriverActionLog` Hub sync fields

Active write risk: high for delivery status sync/admin actions if Hub-backed writes remain available.

Native replacement status: partial. Native previews/commands exist but delivery completion/customer status live writes remain exact-gated and held.

Next safest cutover step:

- Native delivery route parity preview before replacing admin delivery route summaries.

### 5.5 Production planning / batches

Current source of truth:

- Hub/admin production remains visible in admin queues.
- Native production lifecycle commands are boundary-safe and fixture-proven.
- Live native production lifecycle proof is blocked by absence of a real active paid/captured one-time order.

Hub dependencies:

- admin production queue and Hub-backed admin production commands
- `getAdminProductionPlanningSummary`
- `getAdminProductionQueueSummary`
- admin production preview/command surfaces
- native production previews use Hub fallback for context/master-data parity

Active write risk: medium/high for older admin production Hub-backed actions.

Native replacement status: command-ready but live proof blocked.

Next safest cutover step:

- Keep Hub-backed production actions held.
- Use next natural active one-time order for G37C then production lifecycle pilot.

### 5.6 Delivery route / delivery status

Current source of truth:

- Hub route summaries remain central in `DeliveryQueue`.
- Native delivery readiness/completion previews exist.

Hub dependencies:

- `getAdminDeliveryRouteSummary`
- `DeliveryQueue.jsx`
- `syncHubDeliveryStatuses`
- `syncAdminSingleHubDeliveryStatus`
- `markAdminHubOrderDeliveredForCustomerAppSync`
- `pushOrderStatusToHub`

Active write risk: high if delivery status writes are turned off without native route parity.

Native replacement status: partial.

Next safest cutover step:

- G39B/G39C native-first route/read parity before any Hub route suppression.

### 5.7 Customer-facing order status

Current source of truth:

- Customer App order exists, but customer-facing tracker uses Hub detail fallback/context.

Hub dependencies:

- `getCustomerOrderDetail`
- `getCustomerOrdersWithHub`
- `OrderTracker.jsx`

Active customer-visible risk: high. Removing Hub too early can hide line item/status/delivery context.

Native replacement status: partial, not safe without parity proof.

Next safest cutover step:

- Build native-first customer order detail parity preview before any customer-facing cutover.

### 5.8 Notifications / message logs

Current source of truth:

- Customer App notification system exists.
- Migration phases consistently held notifications.
- Hub/customer status workflows still reference notification effects.

Hub dependencies:

- admin/customer status notification impact previews
- order status notification functions
- delivery status flows

Active write risk: medium. Notifications must remain separately approved.

Native replacement status: held by policy.

Next safest cutover step:

- Keep notifications held until after native lifecycle/customer status parity is proven.

### 5.9 Refunds / payment reversals

Current source of truth:

- Hub remains refund source-of-truth.
- Stripe webhook still has live/mutating refund behavior for refund events.
- Native refund impact previews/review queue work exists but native refund writes remain held.

Hub dependencies:

- `stripeWebhook`
- `processManualRefund`
- `syncRefundToHub`
- `refundFlowDiagnostic`
- G35 refund docs/harnesses

Active write risk: high. Refund/payment is high-stakes and must remain conservative.

Native replacement status: preview/shadow only.

Next safest cutover step:

- Refund webhook shadow observation/parity only, not native writes.

### 5.10 Subscriptions / recurrence / multi-delivery

Current source of truth:

- Hub remains subscription source-of-truth.
- Parent vs occurrence identity remains high risk.
- G36 exact occurrence preview/packet/command surfaces exist, but no broad live subscription mirror has been approved.

Hub dependencies:

- `syncSubscriptionWithFulfillments`
- `syncSubscriptionFromHub`
- `syncAllSubscriptionsFromHub`
- `getSubscriptionOrdersForSync`
- `repairMissingCASubscriptionFromStripeAndHub`
- `createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp`
- subscription admin/customer pages and functions

Active write risk: high.

Native replacement status: preview/command exists for exact occurrence only; keep Hub source-of-truth.

Next safest cutover step:

- Do not disable subscription Hub fallback.
- Continue exact occurrence preview-only or separately approved occurrence mirror phases.

### 5.11 Master data / recipes / inventory / procurement

Current source of truth:

- Native master data is partially closed.
- Watermelon Juice Recipe gap is closed.
- Hub remains fallback for master-data parity details.
- Inventory stock is not authoritative.
- Inventory deduction and PurchaseOrder automation are held.

Hub dependencies:

- `previewNativeProductionMasterDataParity`
- `previewNativeProductionInventoryReadiness`
- `getAdminInventoryStatusSummary`
- `InventoryStatus.jsx`
- production planning summaries

Active write risk: low for read previews, high if inventory/PO were enabled.

Native replacement status: partial, blocked by owner input and stock policy.

Known remaining owner-input/master-data blockers:

- Black Salt
- Beetroot
- Sea Salt
- Black Pepper
- stock authority policy
- inventory deduction policy
- PO automation policy

Next safest cutover step:

- Keep inventory/PO held.
- Continue non-stock master-data parity/preview closure only.

### 5.12 Admin dashboards / analytics / summaries

Current source of truth:

- Admin dashboards are mixed Hub + native.
- Some functions already have native fallback behavior.

Hub dependencies:

- `getAdminOrdersWithHub` / `AdminOrders.jsx`
- `getAdminOperationsDashboardSummary` / `Operations.jsx`
- `getAdminDeliveryRouteSummary` / `DeliveryQueue.jsx`
- `getAdminProductionPlanningSummary` / `ProductionQueueSummary.jsx`
- `getAdminInventoryStatusSummary` / `InventoryStatus.jsx`
- `getAdminResourcesSummary` / `Resources.jsx`
- `getAdminCalendarEventsSummary` / `Calendar.jsx`
- `getAdminOpsAlertsSummary` / `OpsAlerts.jsx`
- `getAdminSyncHealthSummary` / `SyncHealth.jsx`

Active write risk: low for read-only summary pages; higher where pages still expose Hub-backed actions.

Native replacement status: best immediate candidate for native-first burn-down.

Next safest cutover step:

- G39B native-first read parity preview for admin order/operations/delivery/production summaries.
- G39C patch plan for native-first admin dashboards with fallback reporting.

### 5.13 Sync / repair / replay

Current source of truth:

- Hub repair/replay paths remain available in runtime functions.
- Migration policy has repeatedly prohibited broad sync/repair/replay during pilots.

Hub dependencies:

- `retryFailedHubSyncs`
- `debugAndRetryHubSync`
- `syncStuckOrdersPollerManual`
- `recoverStuckOrder`
- subscription repair functions
- legacy repair scripts/functions

Active write risk: high.

Native replacement status: partial; safe-sync preview/parity surfaces exist, broad repair suppression not approved.

Next safest cutover step:

- Gate or suppress repair/replay only after parity preview and shadow observation.

### 5.14 Historical backfills

Current source of truth:

- Hub historical data remains useful for audit/backfill previews.

Hub dependencies:

- `previewAdminHistoricalHubBackfill`
- `backfillAdminHistoricalHubOrders`
- `previewHistoricalHubFulfilledNativeBackfill`
- `backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp`
- historical docs/harnesses

Active write risk: high if backfill writes are executed without exact approval.

Native replacement status: historical/admin-only only; not live lifecycle proof.

Next safest cutover step:

- Keep historical backfill preview-only unless owner supplies exact historical actuals/QC and separately approves a write.

### 5.15 Webhooks/payment event handling

Current source of truth:

- Stripe and Shopify webhook functions still bridge into Hub/native sync paths.

Hub dependencies:

- `stripeWebhook`
- `shopifyWebhookReceiver`
- `syncOrderToHub`
- `syncRefundToHub`
- `OrderSyncLog`
- `SafeSyncParityLog`

Active write risk: high.

Native replacement status: partial shadow/parity only for several paths.

Next safest cutover step:

- Shadow/parity observation before suppressing any Hub writes.

### 5.16 Miscellaneous/unknown

Static scan also found lower-priority Hub references in loyalty, events, POS, zone delivery approval, resources, and operational diagnostics.

These should be treated as `unknown_needs_manual_review` or domain-specific after the core order/production/delivery/refund/subscription surfaces are addressed.

## 6. Hub write path risk audit

| Function | Writes/affects | Trigger | Still active? | Native equivalent | Proven native write? | Suppression strategy | Risk if disabled now | Classification |
|---|---|---|---|---|---|---|---|---|
| `syncOrderToHub` | order/refund operational payload to Hub, `OrderSyncLog` | checkout/payment/order sync/webhook/manual | yes | native safe sync + ShopifyOrder/FulfillmentTask mirrors | exact one-time only | suppress after native parity + shadow observation | high | `do_not_disable` |
| `syncCustomerToHub` | customer/profile event to Hub | customer action/checkout | yes | Customer App profile entities | partial | native account parity first | medium/high | `suppress_after_native_parity` |
| `syncUserToHub` | user/profile to Hub | account settings/profile update | yes | UserProfile/native account | partial | native account parity first | medium | `suppress_after_native_parity` |
| `syncShopifyOrderToHub` | Shopify order bridge to Hub | Shopify/admin sync | yes | native ShopifyOrder | partial | shadow only | high | `suppress_after_shadow_observation` |
| `syncRefundToHub` | refund event to Hub | refund/manual/webhook | yes | native refund impact/review queue | no live native refund write | shadow only | high | `do_not_disable` |
| `processManualRefund` | refund processing + Hub sync path | admin action | yes | native refund preview/review | held | refund parity/shadow | high | `do_not_disable` |
| `stripeWebhook` | payment/subscription/refund bridge, Hub/native sync | webhook | yes | partial native shadows | not broad | shadow observation | critical | `do_not_disable` |
| `shopifyWebhookReceiver` | Shopify order bridge context | webhook | yes | native safe sync bridge | partial | native shadow/compare | high | `suppress_after_shadow_observation` |
| `syncSubscriptionPlansToHub` | subscription plan to Hub | plan sync | yes | native SubscriptionPlan | partial | design needed | medium/high | `needs_design` |
| `syncSubscriptionWithFulfillments` | subscription fulfillments to Hub | subscription sync/repair | yes | G36 exact occurrence preview/command | no broad | keep Hub | high | `do_not_disable` |
| `syncRepairedSubscriptionToHub` | repaired subscription to Hub | repair | yes | subscription occurrence mirror only | no broad | keep Hub | high | `do_not_disable` |
| `syncHubDeliveryStatuses` | pulls Hub delivery status and updates Customer App Order | scheduled/sync | yes | native delivery reconciliation/status commands | exact-gated only | route/status parity first | high | `do_not_disable` |
| `pushOrderStatusToHub` | status push to Hub | admin/status action | yes | native status commands | exact-gated only | status parity first | high | `suppress_after_native_parity` |
| `hubToCustomerAppStatusSync` | Hub status into Customer App | sync | yes | native customer status impact/delivered previews | partial | customer status parity first | high | `suppress_after_native_parity` |
| `manualPushOrderToHub` | manual Hub order push | admin | yes | native exact mirror commands | exact only | gate default-off after parity | medium/high | `safe_to_gate_default_off` |
| `appendAdminHubOrderNote` | internal note to Hub | admin | yes | no native note surface identified | no | design native admin notes | medium | `needs_design` |
| `markAdminHubOrderDeliveredForCustomerAppSync` | marks Hub-delivered context for CA sync | admin | yes | native delivery completion reconciliation | exact-gated only | delivery parity first | high | `suppress_after_native_parity` |
| `syncAdminSingleHubDeliveryStatus` | sync single Hub delivery status | admin | yes | native delivery readiness/completion | partial | delivery parity first | medium/high | `suppress_after_native_parity` |
| `retryFailedHubSyncs` | retries failed Hub syncs | scheduled/admin | yes | safe-sync parity only | no broad | disable after all Hub writes suppressed | high | `do_not_disable` |
| `debugAndRetryHubSync` | debug/retry Hub sync | admin/internal | yes | native parity previews | partial | gate default-off after parity | medium/high | `safe_to_gate_default_off` |
| `debugHubSyncPayload` | debug Hub sync payload | admin/internal | yes | native preview/debug | partial | gate default-off after parity | medium | `safe_to_gate_default_off` |
| `backfillAdminHistoricalHubOrders` | historical Hub backfill writes | admin | yes if invoked | historical native backfill preview/command | held | keep preview-only | high | `do_not_disable` |
| `backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp` | native historical mirror from Hub fulfilled orders | admin exact command | gates | native historical backfill command | exact only | keep exact-gated | medium | `suppress_after_shadow_observation` |
| `pushExistingLoyaltyMembersToHub` / `pushLoyaltyMemberToHub` | loyalty member Hub write | admin/customer loyalty | yes | native loyalty entities | unknown | loyalty-specific audit | medium | `unknown` |
| `syncLoyaltyToHub` | loyalty sync to Hub | scheduled/action | yes | native loyalty entities | unknown | loyalty-specific audit | medium | `unknown` |
| `syncEventToHub` | event sync to Hub | event action | yes | native Event entity | partial | event-specific audit | low/medium | `needs_design` |

## 7. Admin dashboard Hub dependency audit

| Admin surface/function | Hub fields/dependency | Native fields exist? | Native-first safe now? | Fallback reporting exists? | UI loss without Hub | Recommended patch type |
|---|---|---|---|---|---|---|
| `AdminOrders.jsx` + `getAdminOrdersWithHub` | Hub order rows, Hub ops status, Hub tasks/timeline/internal note | partial: Order, ShopifyOrder, FulfillmentTask, sync logs | not fully | partial | high: Hub rows/timeline/internal notes | G39B parity preview then native-first read plan |
| `Operations.jsx` + `getAdminOperationsDashboardSummary` | Hub aggregate operations summary | yes for many counts; native fallback exists | likely yes for counts | yes | medium: Hub aggregate details | G39C native-first patch candidate |
| `DeliveryQueue.jsx` + `getAdminDeliveryRouteSummary` | Hub route rows, stale fallback reconciliation | partial: FulfillmentTask/native delivery fields | not yet | yes | high: route stops/actions | G39B delivery route parity preview |
| `ProductionQueueSummary.jsx` + `getAdminProductionPlanningSummary` | Hub production rows/ingredients/inventory actions | partial: ProductionBatch, Recipe, InventoryItem, IngredientYield | partial only | partial | high for Hub batches/inventory | native-first with Hub fallback after production pilot |
| `InventoryStatus.jsx` + `getAdminInventoryStatusSummary` | Hub inventory thresholds/open PO | partial: InventoryItem, IngredientYield, PurchaseOrder schema | no | partial | high: stock/PO visibility | hold until inventory owner inputs/stock policy |
| `Resources.jsx` + `getAdminResourcesSummary` | Hub resources/team/equipment | limited native fallback | partial | yes | medium | native-first fallback patch candidate after parity |
| `Calendar.jsx` + `getAdminCalendarEventsSummary` | Hub calendar events/schedules | partial: Order/Event/Task | partial | yes | medium | native-first calendar parity preview |
| `OpsAlerts.jsx` + `getAdminOpsAlertsSummary` | Hub alerts | partial: OrderReviewQueue/native alerts | partial | yes | medium | native-first alert fallback candidate |
| `SyncHealth.jsx` + native preview functions | Hub retirement/readiness context | native previews exist | yes for preview panels | yes | low | keep as migration control surface |
| `ShopifyDashboard.jsx` | labels Hub-backed operations | partial | no direct cutover | n/a | low | update copy only after actual cutover |

Admin dashboard recommendation:

1. Start with read-only native-first parity for `getAdminOperationsDashboardSummary`, `getAdminOrdersWithHub`, `getAdminDeliveryRouteSummary`, and `getAdminProductionPlanningSummary`.
2. Patch admin summaries to report `source:native_first_with_hub_fallback` only after parity shows no data loss for key operational fields.
3. Do not remove Hub internal note/timeline/route actions until a native replacement exists.

## 8. Customer-facing Hub dependency audit

| Customer surface | Hub dependency | Risk if Hub removed | Native replacement status | Customer-visible impact | Recommended cutover order |
|---|---|---|---|---|---|
| `OrderTracker.jsx` | `getCustomerOrderDetail` returns `hub_order` fallback fields | high | partial | missing status/items/delivery window for some orders | parity preview first |
| Customer order history | `getCustomerOrdersWithHub` | high | partial | missing historical/subscription orders | after admin/order parity and subscription plan |
| `Checkout.jsx` | calls `syncCustomerToHub` for bag return/customer event | medium | native profile/order exists, Hub write still active | likely none if shadowed, but not proven | customer sync parity first |
| `AccountSettings.jsx` | calls `syncUserToHub` on profile update | medium | UserProfile exists | Hub-side customer record may go stale | native account parity first |
| `Events.jsx` | Hub-synced events merge with hardcoded events | low/medium | Event entity exists | event listing differences | event-specific parity later |

Customer-facing recommendation:

- Do not remove Hub from customer-visible order tracker or order history until native-first customer order detail parity is proven.
- Suppress customer/profile Hub writes only after account/profile parity and shadow observation.

## 9. Subscription dependency summary

Subscription/recurrence remains Hub source-of-truth for now.

Carry-forward from G36:

- parent vs occurrence identity remains high risk
- exact occurrence preview works for selected occurrence
- occurrence mirror packet preview works
- occurrence mirror command exists and is boundary-safe
- no broad live subscription mirror write has been approved
- native subscription FulfillmentTask mirror remains held
- production/delivery subscription lifecycle remains held

Representative dependencies:

- `syncSubscriptionWithFulfillments`
- `syncSubscriptionFromHub`
- `syncAllSubscriptionsFromHub`
- `getSubscriptionOrdersForSync`
- `manualSyncSubscription`
- `manualSyncSubscriptionOrders`
- `generateSubscriptionOrders`
- `repairMissingCASubscriptionFromStripeAndHub`
- `repairMissingSubscriptionForPaidInvoice`
- `createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp`

Classification: `keep_hub_source_of_truth_for_now`.

Do not disable subscription Hub fallback in the next burn-down phases.

## 10. Refund/payment dependency summary

Refund/payment remains Hub source-of-truth for now.

Carry-forward from G35:

- native refund impact previews exist
- optional refund schema fields exist
- Stripe refund shadow exists default-off
- native partial refund review queue command exists but held
- no native refund writes are broadly approved
- `stripeWebhook` still has live/mutating behavior for refund events

Representative dependencies:

- `stripeWebhook`
- `processManualRefund`
- `syncRefundToHub`
- `refundFlowDiagnostic`
- `createNativePartialRefundReviewQueueForCustomerApp`
- refund impact fixtures/docs/harnesses

Classification: `keep_hub_source_of_truth_for_now` unless a specific read-only shadow/parity step is approved.

Do not suppress Hub refund writes without refund-specific shadow observation and explicit owner approval.

## 11. Master-data / inventory dependency summary

Current state:

- Watermelon Juice native Recipe gap is closed.
- Native recipe/master-data parity improved.
- Inventory stock is still not authoritative.
- Inventory deduction remains held.
- PurchaseOrder automation remains held.
- Hub fallback is still used for master-data parity and inventory/procurement context.

Representative dependencies:

- `previewNativeProductionMasterDataParity`
- `previewNativeProductionInventoryReadiness`
- `previewNativeProductionDemandMaterialization`
- `getAdminInventoryStatusSummary`
- `getAdminProductionPlanningSummary`
- `InventoryStatus.jsx`
- `ProductionQueueSummary.jsx`

Remaining owner inputs/policies:

- Black Salt
- Beetroot
- Sea Salt
- Black Pepper
- stock authority policy
- inventory deduction policy
- PurchaseOrder automation policy

Classification:

- `read_only_hub_fallback_still_active`
- `blocked_by_owner_input`
- inventory/PO: `not_ready`

## 12. Native replacement map

| Hub dependency domain | Best native replacement candidate | Readiness |
|---|---|---|
| Customer App order identity/payment | Customer App `Order` | `native_replacement_exists` |
| Native operational order mirror | `ShopifyOrder` | `native_replacement_exists` for exact one-time pilots |
| Fulfillment task/delivery task | `FulfillmentTask` | `native_replacement_exists` for exact one-time pilots |
| Production demand/materialization | `ProductionBatch`, `previewNativeProductionDemandMaterialization` | `native_command_exists_but_held` |
| Production lifecycle | `ProductionBatch`, lifecycle previews/commands | `blocked_by_real_order_event` / owner actuals/QC |
| Production compliance | `BatchComplianceLog`, verify command | `blocked_by_owner_input` |
| Master data | `Recipe`, `InventoryItem`, `IngredientYield`, `Bundle` | `native_replacement_partial` |
| Inventory/procurement | `InventoryItem`, `IngredientYield`, `PurchaseOrder` | `not_ready` |
| Admin order read | `Order`, `ShopifyOrder`, `FulfillmentTask`, logs/review queues | `native_replacement_partial` |
| Customer order detail | `Order`, `ShopifyOrder`, `FulfillmentTask` | `replace_after_native_parity_preview` |
| Delivery route/status | `FulfillmentTask`, delivery readiness/completion previews | `native_preview_exists_only` / exact commands held |
| Customer status | customer status impact/delivered impact previews | `native_command_exists_but_held` |
| Refund/payment | native refund impact previews, review queue, optional schema fields | `native_preview_exists_only` |
| Subscription occurrence | subscription occurrence parity previews and mirror command | `native_preview_exists_only` / exact command held |
| Sync/review audit | `OrderSyncLog`, `SafeSyncParityLog`, `OrderReviewQueue`, `CommandLog` | `native_replacement_exists` for audit/control |
| Historical backfill | historical Hub fulfilled native backfill previews/commands | `keep_hub_source_of_truth_for_now` |

## 13. Burn-down roadmap

### Phase proposal 1 — G39B native-first read parity preview for admin/order surfaces

- Risk: low/medium
- Expected files/functions: read-only preview/harness around `getAdminOrdersWithHub`, `getAdminOperationsDashboardSummary`, `getAdminDeliveryRouteSummary`, `getAdminProductionPlanningSummary`, `getCustomerOrderDetail`
- Mode: preview-only
- Owner input: none
- Expected outcome: identify exact fields still only available from Hub before any read cutover

### Phase proposal 2 — G39C admin dashboard native-first patch plan

- Risk: medium
- Expected files/functions: admin summary functions and docs
- Mode: plan first, then runtime patch only after approval
- Owner input: none
- Expected outcome: native-first admin reads with explicit Hub fallback reporting

### Phase proposal 3 — Customer order detail parity preview

- Risk: medium/high because customer-visible
- Expected files/functions: `getCustomerOrderDetail`, `getCustomerOrdersWithHub`, `OrderTracker.jsx`
- Mode: preview-only first
- Owner input: none
- Expected outcome: prove customer order tracker can be native-first without missing status/items/delivery context

### Phase proposal 4 — Delivery route native parity preview

- Risk: medium/high
- Expected files/functions: `getAdminDeliveryRouteSummary`, `DeliveryQueue.jsx`, delivery readiness previews
- Mode: preview-only
- Owner input: none initially
- Expected outcome: route summary can distinguish native route rows from Hub fallback rows safely

### Phase proposal 5 — Hub write suppression shadow plan

- Risk: high
- Expected files/functions: `syncOrderToHub`, `syncCustomerToHub`, `pushOrderStatusToHub`, selected manual sync paths
- Mode: default-off shadow/suppression gates only
- Owner input: exact domain approval
- Expected outcome: Hub writes can be observed/suppressed one domain at a time after native parity

### Phase proposal 6 — Refund webhook shadow observation

- Risk: high
- Expected files/functions: `stripeWebhook`, `syncRefundToHub`, G35 refund preview/shadow surfaces
- Mode: shadow/read-only only
- Owner input: refund policy approval later
- Expected outcome: native refund impact can be trusted before any suppression of Hub refund writes

### Phase proposal 7 — Subscription remains Hub source-of-truth

- Risk: high
- Expected files/functions: G36 subscription occurrence preview/mirror surfaces
- Mode: exact occurrence preview/command only by separate approval
- Owner input: exact occurrence approval
- Expected outcome: no broad subscription cutover until identity model is proven

### Phase proposal 8 — Inventory/PO held until owner inputs

- Risk: high
- Expected files/functions: master-data/inventory/procurement previews
- Mode: preview-only
- Owner input: ingredient/yield/stock/PO policy
- Expected outcome: no inventory deduction or PurchaseOrder automation until native stock authority is established

## 14. Hard stops

Do not proceed with any of these actions without separate exact approval and parity evidence:

- broad Hub write suppression without native parity preview
- disabling Hub fallback for subscriptions
- disabling Hub fallback for refunds
- turning off Hub delivery routes without native route parity
- native inventory deduction
- PurchaseOrder automation
- notifications
- provider calls
- using historical/late mirror orders as live production proof
- deleting functions without a function-slot/decommission audit
- removing Hub dependencies without full reference search
- schema changes without preview/harness coverage
- customer-facing order read cutover without parity proof
- suppressing webhook Hub writes without shadow observation

## 15. Recommended next phase

Recommended next phase: **G39B native-first read parity preview for admin/order surfaces**.

Reason:

- It directly reduces Hub dependency without requiring a new live order.
- It is read-only and low risk.
- It will identify exact missing native fields before runtime patches.
- It creates a defensible path to G39C admin dashboard native-first patches.

Secondary option: **G39C admin dashboard native-first patch plan**, but only after G39B identifies which fields are safe to move native-first.

Do not disable Hub yet. Hub remains active.

## Appendix A — Exact direct Hub runtime file list

The following runtime files matched direct Hub env/API/proxy patterns in the static scan. The unrelated untracked `entry 2.ts` caveat file is excluded.

- `base44/functions/appendAdminHubOrderNote/entry.ts`
- `base44/functions/approveZone3SubscriptionRequest/entry.ts`
- `base44/functions/auditStripeAndIntegrationInventory/entry.ts`
- `base44/functions/backfillAdminHistoricalHubOrders/entry.ts`
- `base44/functions/backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp/entry.ts`
- `base44/functions/bottleAdminProductionVerifyShopifyOrder/entry.ts`
- `base44/functions/bottleNativeProductionShopifyOrderForCustomerApp/entry.ts`
- `base44/functions/claimReward/entry.ts`
- `base44/functions/completeAdminProductionBatch/entry.ts`
- `base44/functions/completeNativeProductionBatchesForCustomerApp/entry.ts`
- `base44/functions/correctAdminOrderDeliverySchedule/entry.ts`
- `base44/functions/correctAdminOrderDeliveryScheduleV2/entry.ts`
- `base44/functions/correctAdminProductionBatchStaffOnDuty/entry.ts`
- `base44/functions/correctAdminProductionIngredientUsage/entry.ts`
- `base44/functions/createLoyaltyMember/entry.ts`
- `base44/functions/deactivateLoyaltyMembers/entry.ts`
- `base44/functions/debugAndRetryHubSync/entry.ts`
- `base44/functions/debugHubSyncPayload/entry.ts`
- `base44/functions/deductAdminProductionInventory/entry.ts`
- `base44/functions/detectStuckOrders/entry.ts`
- `base44/functions/executeNativeFulfillmentTaskMetadataRepair/entry.ts`
- `base44/functions/executeNativeSafeSyncOrderUpdate/entry.ts`
- `base44/functions/getAdminCalendarEventsSummary/entry.ts`
- `base44/functions/getAdminComplianceOpsSummary/entry.ts`
- `base44/functions/getAdminDeliveryRouteSummary/entry.ts`
- `base44/functions/getAdminFulfillmentTaskDetails/entry.ts`
- `base44/functions/getAdminInventoryStatusSummary/entry.ts`
- `base44/functions/getAdminOperationsDashboardSummary/entry.ts`
- `base44/functions/getAdminOpsAlertsSummary/entry.ts`
- `base44/functions/getAdminOrderTimeline/entry.ts`
- `base44/functions/getAdminOrdersWithHub/entry.ts`
- `base44/functions/getAdminPOSOrdersSummary/entry.ts`
- `base44/functions/getAdminProductionPlanningSummary/entry.ts`
- `base44/functions/getAdminProductionQueueSummary/entry.ts`
- `base44/functions/getAdminResourcesSummary/entry.ts`
- `base44/functions/getAdminSyncHealthSummary/entry.ts`
- `base44/functions/getAllOrdersForSync/entry.ts`
- `base44/functions/getBagReturnsForSync/entry.ts`
- `base44/functions/getCustomerOrdersWithHub/entry.ts`
- `base44/functions/getLoyaltyDataForSync/entry.ts`
- `base44/functions/getOrderUpdatesForSync/entry.ts`
- `base44/functions/getOrdersForSync/entry.ts`
- `base44/functions/getSubscriptionOrdersForSync/entry.ts`
- `base44/functions/hubSyncProxy/entry.ts`
- `base44/functions/hubToCustomerAppStatusSync/entry.ts`
- `base44/functions/importNativeProductionMasterDataForCustomerApp/entry.ts`
- `base44/functions/markAdminFulfillmentTaskOutForDelivery/entry.ts`
- `base44/functions/markAdminHubOrderDeliveredForCustomerAppSync/entry.ts`
- `base44/functions/materializeNativeProductionBatchesForCustomerApp/entry.ts`
- `base44/functions/notifyOrderProcessed/entry.ts`
- `base44/functions/optimizeDeliveryRoute/entry.ts`
- `base44/functions/packAdminProductionVerifyFulfillmentTasks/entry.ts`
- `base44/functions/packNativeProductionFulfillmentTaskForCustomerApp/entry.ts`
- `base44/functions/pollOrderStatusUpdates/entry.ts`
- `base44/functions/previewAdminHistoricalHubBackfill/entry.ts`
- `base44/functions/previewAdminMay30POSProfileCandidates/entry.ts`
- `base44/functions/previewAdminNonSubscriptionBottledCascadeCandidates/entry.ts`
- `base44/functions/previewAdminProductionBatchComplete/entry.ts`
- `base44/functions/previewAdminProductionBatchStart/entry.ts`
- `base44/functions/previewAdminProductionBatchVerify/entry.ts`
- `base44/functions/previewAdminProductionIngredientUsageCorrection/entry.ts`
- `base44/functions/previewAdminProductionInventoryDeduction/entry.ts`
- `base44/functions/previewAdminProductionVerifyCascades/entry.ts`
- `base44/functions/previewAdminSubscriptionFulfillmentProductionStatus/entry.ts`
- `base44/functions/previewHistoricalCustomerOrderFulfillmentBackfillImpact/entry.ts`
- `base44/functions/previewHistoricalHubFulfilledNativeBackfill/entry.ts`
- `base44/functions/previewNativeCustomerDeliveredStatusImpact/entry.ts`
- `base44/functions/previewNativeCustomerStatusNotificationImpact/entry.ts`
- `base44/functions/previewNativeDeliveryCompletionReconciliation/entry.ts`
- `base44/functions/previewNativeDeliveryWorkflowReadiness/entry.ts`
- `base44/functions/previewNativeExactOrderPilotApproval/entry.ts`
- `base44/functions/previewNativeFulfillmentTaskMetadataRepair/entry.ts`
- `base44/functions/previewNativeOrderCutoverReadiness/entry.ts`
- `base44/functions/previewNativeProductionBatchLifecycle/entry.ts`
- `base44/functions/previewNativeProductionDemandMaterialization/entry.ts`
- `base44/functions/previewNativeProductionInventoryReadiness/entry.ts`
- `base44/functions/previewNativeProductionMasterDataParity/entry.ts`
- `base44/functions/previewNativeProductionVerifyCascades/entry.ts`
- `base44/functions/previewNativeSafeSyncDarkLaunchComparison/entry.ts`
- `base44/functions/previewNativeSafeSyncLiveOrderParity/entry.ts`
- `base44/functions/previewNativeSafeSyncOrderUpdate/entry.ts`
- `base44/functions/previewNativeSafeSyncParityHarness/entry.ts`
- `base44/functions/previewNativeScheduleExceptionCorrection/entry.ts`
- `base44/functions/probeHubSubscriptionCancelled/entry.ts`
- `base44/functions/processManualRefund/entry.ts`
- `base44/functions/processMay30NativeOrderOps/entry.ts`
- `base44/functions/pushExistingLoyaltyMembersToHub/entry.ts`
- `base44/functions/pushLoyaltyMemberToHub/entry.ts`
- `base44/functions/pushOrderStatusToHub/entry.ts`
- `base44/functions/receivePointsSync/entry.ts`
- `base44/functions/receiveSyncedEvent/entry.ts`
- `base44/functions/reconcileNativeDeliveryCompletionForCustomerApp/entry.ts`
- `base44/functions/recordAdminFulfillmentTaskDelivered/entry.ts`
- `base44/functions/refundFlowDiagnostic/entry.ts`
- `base44/functions/retryFailedHubSyncs/entry.ts`
- `base44/functions/retryRepairedSubscriptionHubSync/entry.ts`
- `base44/functions/sendAdminOrderProcessedNotification/entry.ts`
- `base44/functions/sendLoyaltySignup/entry.ts`
- `base44/functions/shopifyResyncOrders/entry.ts`
- `base44/functions/shopifyWebhookReceiver/entry.ts`
- `base44/functions/stabilizationDiagnostic/entry.ts`
- `base44/functions/startAdminProductionBatch/entry.ts`
- `base44/functions/startNativeProductionBatchesForCustomerApp/entry.ts`
- `base44/functions/stripeWebhook/entry.ts`
- `base44/functions/syncAdminSingleHubDeliveryStatus/entry.ts`
- `base44/functions/syncCustomerToHub/entry.ts`
- `base44/functions/syncEventToHub/entry.ts`
- `base44/functions/syncEventsFromHub/entry.ts`
- `base44/functions/syncHubDeliveryStatuses/entry.ts`
- `base44/functions/syncLoyaltyFromHub/entry.ts`
- `base44/functions/syncLoyaltyToHub/entry.ts`
- `base44/functions/syncOrderToHub/entry.ts`
- `base44/functions/syncRefundToHub/entry.ts`
- `base44/functions/syncShopifyOrderToHub/entry.ts`
- `base44/functions/syncStuckOrdersPollerManual/entry.ts`
- `base44/functions/syncSubscriptionPlansToHub/entry.ts`
- `base44/functions/syncSubscriptionWithFulfillments/entry.ts`
- `base44/functions/syncUserToHub/entry.ts`
- `base44/functions/updateAdminFulfillmentTaskAssignment/entry.ts`
- `base44/functions/updateAdminOpsAlertStatus/entry.ts`
- `base44/functions/updateNativeCustomerOrderDeliveredStatusForCustomerApp/entry.ts`
- `base44/functions/updateNativeCustomerOrderStatusForCustomerApp/entry.ts`
- `base44/functions/verifyAdminProductionBatch/entry.ts`
- `base44/functions/verifyHubEndpointReachability/entry.ts`
- `base44/functions/verifyNativeProductionBatchesForCustomerApp/entry.ts`

## Appendix B — Exact frontend Hub reference file list

The following frontend files reference Hub-backed surfaces, Hub fallback copy, or backend functions that return Hub/native mixed context.

- `src/components/admin/AdminOpsHeader.jsx`
- `src/components/admin/AdminStatusPill.jsx`
- `src/pages/AccountSettings.jsx`
- `src/pages/AdminOrders.jsx`
- `src/pages/Checkout.jsx`
- `src/pages/Events.jsx`
- `src/pages/OrderTracker.jsx`
- `src/pages/admin/Calendar.jsx`
- `src/pages/admin/DeliveryQueue.jsx`
- `src/pages/admin/InventoryStatus.jsx`
- `src/pages/admin/LiveCheckoutMonitor.jsx`
- `src/pages/admin/Operations.jsx`
- `src/pages/admin/OpsAlerts.jsx`
- `src/pages/admin/ProductionQueueSummary.jsx`
- `src/pages/admin/Resources.jsx`
- `src/pages/admin/ShopifyDashboard.jsx`
- `src/pages/admin/SyncHealth.jsx`
- `src/pages/admin/SyncStatus.jsx`

## Appendix C — Exact Hub write-ish runtime function list

The following function names matched explicit Hub write, push, receive, repair, retry, or historical backfill naming patterns.

- `base44/functions/appendAdminHubOrderNote/entry.ts`
- `base44/functions/backfillAdminHistoricalHubOrders/entry.ts`
- `base44/functions/backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp/entry.ts`
- `base44/functions/debugAndRetryHubSync/entry.ts`
- `base44/functions/debugHubSyncPayload/entry.ts`
- `base44/functions/hubToCustomerAppStatusSync/entry.ts`
- `base44/functions/manualPushOrderToHub/entry.ts`
- `base44/functions/markAdminHubOrderDeliveredForCustomerAppSync/entry.ts`
- `base44/functions/pushExistingLoyaltyMembersToHub/entry.ts`
- `base44/functions/pushLoyaltyMemberToHub/entry.ts`
- `base44/functions/pushOrderStatusToHub/entry.ts`
- `base44/functions/receivePointsSync/entry.ts`
- `base44/functions/receiveSyncedEvent/entry.ts`
- `base44/functions/repairMissingCASubscriptionFromStripeAndHub/entry.ts`
- `base44/functions/retryFailedHubSyncs/entry.ts`
- `base44/functions/retryRepairedSubscriptionHubSync/entry.ts`
- `base44/functions/syncCustomerToHub/entry.ts`
- `base44/functions/syncEventToHub/entry.ts`
- `base44/functions/syncHubDeliveryStatuses/entry.ts`
- `base44/functions/syncLoyaltyToHub/entry.ts`
- `base44/functions/syncOrderToHub/entry.ts`
- `base44/functions/syncRefundToHub/entry.ts`
- `base44/functions/syncRepairedSubscriptionToHub/entry.ts`
- `base44/functions/syncShopifyOrderToHub/entry.ts`
- `base44/functions/syncSubscriptionPlansToHub/entry.ts`
- `base44/functions/syncUserToHub/entry.ts`
