# Base44 required-function manifest — 2026-08-04

## Retention rule

A function remains only when it owns a distinct current responsibility that is not safely covered by another canonical path. A function can qualify through an active UI caller, an automation, an authenticated external contract, a webhook/provider callback, a required read model, a customer lifecycle action, or a controlled preview/apply/recovery boundary. Merely compiling or returning a successful response is not a retention reason.

The retained estate contains **141 functions**. The lists below are exhaustive: every deployed function after cleanup appears exactly once. Loyalty mutation/admin repair, operational-notice maintenance, legacy admin reads, POS customer claims, and native order processing were consolidated into existing canonical functions instead of consuming new function slots.

## Customer identity, loyalty, and customer reads — 15

These functions own self-service identity, loyalty, customer account reads, public SEO routing, or delivery validation.

- `addressSuggest`
- `auditCustomerAppLoyaltyAfterPhase2`
- `claimReward`
- `completeAccountSetup`
- `createLoyaltyMember`
- `enrollNewCustomerInLoyalty`
- `generateSitemap`
- `getCustomerAccountDashboardData`
- `getCustomerNotifications`
- `getCustomerOrderDetail`
- `getDeliveryEta`
- `getOrderBySession`
- `requestAccountDeletion`
- `resolveShopifyCartPermalink`
- `validateDeliveryEligibility`

## Checkout, payments, subscriptions, and Zone 3 — 19

These functions own the canonical PaymentIntent checkout, subscription Payment Element flow, Stripe lifecycle, refund/cancellation recovery, centralized fulfillment scheduling, and route-review authorization controls.

- `adminCancelAndRefundSubscription`
- `approveZone3DeliveryRequest`
- `approveZone3SubscriptionRequest`
- `autoExpireZone3Authorizations`
- `calculateNuViraFulfillmentSchedule`
- `cancelAbandonedCheckouts`
- `cancelIncompleteSubscriptions`
- `cancelSubscriptionFutureRenewal`
- `createPaymentIntent`
- `createSubscriptionPaymentElementIntent`
- `createZone3AuthorizationIntent`
- `createZone3SubscriptionReviewRequest`
- `denyZone3DeliveryRequest`
- `pauseSubscription`
- `processManualRefund`
- `repairMissingCASubscriptionFromStripeAndHub`
- `stripeCustomerPortal`
- `stripeWebhook`
- `syncSubscriptionWithFulfillments`

## Transactional communications and push — 15

These functions own consent-aware journeys, transactional email/SMS/push dispatch, provider callbacks, notification reads, token registration, and passive post-payment monitoring.

- `customerJourneyAutomation`
- `monitorPostPaymentChain`
- `notifyOrderProcessed`
- `registerPushSubscription`
- `resendWebhook`
- `sendAdminOrderProcessedNotification`
- `sendAdminPushTestNotification`
- `sendCustomerNotification`
- `sendCustomerPushNotification`
- `sendNotificationCampaign`
- `sendOrderReceivedNotification`
- `sendOrderSms`
- `sendOrderStatusNotification`
- `sendUpcomingDeliveryNotifications`
- `unregisterPushSubscription`

## Hub, Shopify, GMC, and event integration contracts — 25

These functions are explicit webhook, pull, push, retry, or provider-recovery boundaries. Zero local UI callers is expected for externally invoked endpoints.

- `appendAdminHubOrderNote`
- `getAllOrdersForSync`
- `getBagReturnsForSync`
- `getOrderUpdatesForSync`
- `getOrdersForSync`
- `getSubscriptionOrdersForSync`
- `googleMerchantFeed`
- `logDriverAction`
- `pushMerchToShopify`
- `pushOrderToShopify`
- `pushProductToShopify`
- `retryFailedHubSyncs`
- `shopifyPollFallback`
- `shopifyResyncOrders`
- `shopifyResyncProducts`
- `shopifyWebhookReceiver`
- `syncAdminSingleHubDeliveryStatus`
- `syncCustomerToHub`
- `syncEventsFromHub`
- `syncHubDeliveryStatuses`
- `syncOrderToHub`
- `syncProductsToGMC`
- `syncRefundToHub`
- `syncShopifyOrderToHub`
- `syncUserToHub`

## Admin and operations read/write surface — 38

These functions back a current operations page, produce an admin-only read model, or own one explicit production, delivery, compliance, catalog, or safe-sync command.

- `bottleAdminProductionVerifyShopifyOrder`
- `completeAdminProductionBatch`
- `correctAdminProductionIngredientUsage`
- `deductAdminProductionInventory`
- `executeNativeFulfillmentTaskLifecycle`
- `executeNativeFulfillmentTaskMaterialization`
- `executeNativeOrderScheduleCorrection`
- `executeNativeProductionBatchLifecycle`
- `executeNativeSafeSyncOrderUpdate`
- `generateAuditPacket`
- `getAdminCalendarEventsSummary`
- `getAdminComplianceOpsSummary`
- `getAdminDeliveryRouteSummary`
- `getAdminFulfillmentTaskDetails`
- `getAdminInventoryStatusSummary`
- `getAdminOperationsDashboardSummary`
- `getAdminOpsAlertsSummary`
- `getAdminOrderTimeline`
- `getAdminOrdersWithHub`
- `getAdminPOSOrdersSummary`
- `getAdminProductionPlanningSummary`
- `getAdminProductionQueueSummary`
- `getAdminPushDiagnostics`
- `getAdminResourcesSummary`
- `getAdminShopifyOpsSummary`
- `getAdminSyncHealthSummary`
- `markAdminFulfillmentTaskOutForDelivery`
- `monitorLiveCheckoutTest`
- `optimizeDeliveryRoute`
- `packAdminProductionVerifyFulfillmentTasks`
- `recordAdminFulfillmentTaskDelivered`
- `saveAdminComplianceRecord`
- `startAdminProductionBatch`
- `updateAdminFulfillmentTaskAssignment`
- `updateAdminOpsAlertStatus`
- `updateAdminProductCatalogItem`
- `validateComplianceEntry`
- `verifyAdminProductionBatch`

## Preview, cutover, and scoped recovery controls — 29

These are intentionally separate from live writers. Preview/apply separation, exact allowlists, idempotency, rollback evidence, and historical recovery controls are lifecycle safeguards rather than duplicate functions.

- `backfillAdminHistoricalHubOrders`
- `backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp`
- `previewAdminHistoricalHubBackfill`
- `previewAdminProductionBatchComplete`
- `previewAdminProductionBatchStart`
- `previewAdminProductionBatchVerify`
- `previewAdminProductionIngredientUsageCorrection`
- `previewAdminProductionInventoryDeduction`
- `previewAdminProductionVerifyCascades`
- `previewHistoricalCustomerOrderFulfillmentBackfillImpact`
- `previewHistoricalHubFulfilledNativeBackfill`
- `previewNativeCustomerStatusNotificationImpact`
- `previewNativeDeliveryCompletionReconciliation`
- `previewNativeDeliveryWorkflowReadiness`
- `previewNativeExactOrderPilotApproval`
- `previewNativeFulfillmentTaskLifecycle`
- `previewNativeFulfillmentTaskMaterialization`
- `previewNativeOrderCutoverReadiness`
- `previewNativeOrderScheduleCorrection`
- `previewNativeProductionBatchLifecycle`
- `previewNativeProductionDemandMaterialization`
- `previewNativeProductionInventoryReadiness`
- `previewNativeProductionMasterDataParity`
- `previewNativeProductionVerifyCascades`
- `previewNativeSafeSyncDarkLaunchComparison`
- `previewNativeSafeSyncLiveOrderParity`
- `previewNativeSafeSyncOrderUpdate`
- `previewNativeScheduleExceptionCorrection`
- `reconcileNativeDeliveryCompletionForCustomerApp`

## Legacy event function consolidation

The remaining event-era compatibility functions were unnecessary as separate endpoints and were consolidated into existing canonical owners:

- Admin data read models now dispatch through `getAdminResourcesSummary`.
- POS claim previews, activation, and ShopifyOrder refresh automation now dispatch through `getAdminPOSOrdersSummary`.
- Native one-time and POS order mirroring now runs inside `syncOrderToHub`, while its Hub bridge remains the isolated fallback.

This removes three stale function names without creating replacement slots. Current callers, automations, gates, metadata, and operational UI use the consolidated owners. Historical production metadata can be migrated separately; active readers no longer depend on event-specific tags or statuses.

## Ownership rule going forward

New functions must identify the canonical caller or external contract, the unique responsibility, the source of truth, side effects, idempotency key, authorization model, rollback behavior, and the function they replace. Customer-specific repairs, temporary probes, duplicate hosted/payment paths, and disabled 410 compatibility shells do not return to the live estate.
