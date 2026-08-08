import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { Capacitor } from '@capacitor/core';

const { appId, token, functionsVersion, appBaseUrl } = appParams;
const serverUrl = Capacitor.isNativePlatform() ? appBaseUrl : '';

const ADMIN_GATEWAY = 'getAdminOperationsDashboardSummary';
const ADMIN_GATEWAY_ACTIONS = new Set([
  'adminCancelAndRefundSubscription',
  'appendAdminHubOrderNote',
  'approveZone3DeliveryRequest',
  'bottleAdminProductionVerifyShopifyOrder',
  'completeAdminProductionBatch',
  'correctAdminProductionIngredientUsage',
  'deductAdminProductionInventory',
  'denyZone3DeliveryRequest',
  'executeNativeSafeSyncOrderUpdate',
  'executeNativeFulfillmentTaskLifecycle',
  'executeNativeFulfillmentTaskMaterialization',
  'executeNativeOrderScheduleCorrection',
  'executeNativeProductionBatchLifecycle',
  'generateAuditPacket',
  'getAdminCalendarEventsSummary',
  'getAdminComplianceOpsSummary',
  'getAdminDeliveryRouteSummary',
  'getAdminFulfillmentTaskDetails',
  'getAdminInventoryStatusSummary',
  ADMIN_GATEWAY,
  'getAdminOpsAlertsSummary',
  'getAdminOrderTimeline',
  'getAdminOrdersWithHub',
  'getAdminProductionPlanningSummary',
  'getAdminProductionQueueSummary',
  'getAdminPushDiagnostics',
  'getAdminResourcesSummary',
  'getAdminShopifyOpsSummary',
  'getAdminSyncHealthSummary',
  'manageAdminDiscountCode',
  'monitorLiveCheckoutTest',
  'monitorPostPaymentChain',
  'markAdminFulfillmentTaskOutForDelivery',
  'optimizeDeliveryRoute',
  'packAdminProductionVerifyFulfillmentTasks',
  'previewAdminProductionBatchComplete',
  'previewAdminProductionBatchStart',
  'previewAdminProductionBatchVerify',
  'previewAdminProductionIngredientUsageCorrection',
  'previewAdminProductionInventoryDeduction',
  'previewAdminProductionVerifyCascades',
  'previewNativeFulfillmentTaskLifecycle',
  'previewNativeFulfillmentTaskMaterialization',
  'previewNativeOrderScheduleCorrection',
  'previewNativeProductionBatchLifecycle',
  'previewNativeSafeSyncDarkLaunchComparison',
  'previewNativeSafeSyncOrderUpdate',
  'processManualRefund',
  'pushMerchToShopify',
  'pushProductToShopify',
  'recordAdminFulfillmentTaskDelivered',
  'saveAdminComplianceRecord',
  'sendAdminPushTestNotification',
  'sendNotificationCampaign',
  'sendOrderSms',
  'sendUpcomingDeliveryNotifications',
  'startAdminProductionBatch',
  'syncShopifyOrderToHub',
  'syncSubscriptionWithFulfillments',
  'notifyOrderProcessed',
  'updateAdminFulfillmentTaskAssignment',
  'updateAdminOpsAlertStatus',
  'updateAdminProductCatalogItem',
  'verifyAdminProductionBatch',
]);

const CUSTOMER_GATEWAY = 'getCustomerAccountDashboardData';
const CUSTOMER_GATEWAY_ACTIONS = new Set([
  'addressSuggest',
  'cancelSubscriptionFutureRenewal',
  'claimReward',
  'completeAccountSetup',
  'createZone3AuthorizationIntent',
  'createZone3SubscriptionReviewRequest',
  'createSubscriptionPaymentElementIntent',
  CUSTOMER_GATEWAY,
  'getCustomerNotifications',
  'getCustomerOrderDetail',
  'getDeliveryEta',
  'getOrderBySession',
  'pauseSubscription',
  'registerPushSubscription',
  'requestAccountDeletion',
  'resolveShopifyCartPermalink',
  'stripeCustomerPortal',
  'syncUserToHub',
  'unregisterPushSubscription',
  'validateDeliveryEligibility',
]);

//Create a client with authentication required
export const base44 = createClient({
  appId,
  token,
  functionsVersion,
  serverUrl,
  requiresAuth: false,
  appBaseUrl
});

const invokeFunction = base44.functions.invoke.bind(base44.functions);
base44.functions.invoke = (name, data = {}, options) => {
  if (ADMIN_GATEWAY_ACTIONS.has(name) && name !== ADMIN_GATEWAY) {
    return invokeFunction(ADMIN_GATEWAY, {
      gateway_action: name,
      payload: data,
    }, options);
  }

  if (CUSTOMER_GATEWAY_ACTIONS.has(name) && name !== CUSTOMER_GATEWAY) {
    return invokeFunction(CUSTOMER_GATEWAY, {
      gateway_action: name,
      payload: data,
    }, options);
  }

  return invokeFunction(name, data, options);
};
