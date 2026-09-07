import { createClient } from '@base44/sdk';
import { appParams } from '@/lib/app-params';
import { Capacitor } from '@capacitor/core';

const { appId, functionsVersion, appBaseUrl } = appParams;
const serverUrl = Capacitor.isNativePlatform() ? appBaseUrl : '';

const ADMIN_GATEWAY = 'getAdminOperationsDashboardSummary';
const DIRECT_ADMIN_FUNCTIONS = new Map([
  [
    'executeNativeProductionBatchLifecycle',
    'getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle',
  ],
  [
    'previewNativeProductionBatchLifecycle',
    'getAdminOperationsDashboardSummary/handlers/previewNativeProductionBatchLifecycle',
  ],
]);
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
  'getAdminNativeSystemHealth',
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
  'manageEventPosInventory',
  'manageDriverRouteTelemetry',
  'maintainAdminOperationalNotices',
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
  'manageProgramJourney',
  'manageDeliveryLiveActivity',
  'pauseSubscription',
  'registerPushSubscription',
  'requestAccountDeletion',
  'resolveShopifyCartPermalink',
  'stripeCustomerPortal',
  'syncUserToHub',
  'unregisterPushSubscription',
  'validateDeliveryEligibility',
]);

// The SDK pins a constructor token inside functions.fetch. Read its shared
// token storage instead so gateway calls follow login, logout, and account changes.
export const base44 = createClient({
  appId,
  functionsVersion,
  serverUrl,
  requiresAuth: false,
  appBaseUrl
});

const invokeFunction = base44.functions.invoke.bind(base44.functions);
const invokeGateway = async (gateway, action, payload = {}, options = {}) => {
  const response = await base44.functions.fetch(gateway, {
    ...options,
    method: 'POST',
    headers: {
      ...(options?.headers || {}),
      'Content-Type': 'application/json',
      'X-App-Id': appParams.appId,
    },
    body: JSON.stringify({ gateway_action: action, payload }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || 'The requested operation could not be completed.');
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return { data, status: response.status };
};

export const invokeAdminGateway = (action, payload = {}, options) =>
  invokeGateway(ADMIN_GATEWAY, action, payload, options);

export const invokeCustomerGateway = (action, payload = {}, options) =>
  invokeGateway(CUSTOMER_GATEWAY, action, payload, options);

base44.functions.invoke = (name, data = {}, options) => {
  const directAdminFunction = DIRECT_ADMIN_FUNCTIONS.get(name);
  if (directAdminFunction) {
    return invokeFunction(directAdminFunction, data, options);
  }

  if (ADMIN_GATEWAY_ACTIONS.has(name) && name !== ADMIN_GATEWAY) {
    return invokeAdminGateway(name, data, options);
  }

  if (CUSTOMER_GATEWAY_ACTIONS.has(name) && name !== CUSTOMER_GATEWAY) {
    return invokeCustomerGateway(name, data, options);
  }

  return invokeFunction(name, data, options);
};
