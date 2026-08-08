// @ts-nocheck
import handler0 from './handlers/appendAdminHubOrderNote/entry.ts';
import handler1 from './handlers/bottleAdminProductionVerifyShopifyOrder/entry.ts';
import handler2 from './handlers/completeAdminProductionBatch/entry.ts';
import handler3 from './handlers/correctAdminProductionIngredientUsage/entry.ts';
import handler4 from './handlers/deductAdminProductionInventory/entry.ts';
import handler5 from './handlers/executeNativeFulfillmentTaskLifecycle/entry.ts';
import handler6 from './handlers/executeNativeFulfillmentTaskMaterialization/entry.ts';
import handler7 from './handlers/executeNativeOrderScheduleCorrection/entry.ts';
import handler8 from './handlers/executeNativeProductionBatchLifecycle/entry.ts';
import handler9 from './handlers/generateAuditPacket/entry.ts';
import handler10 from './handlers/getAdminCalendarEventsSummary/entry.ts';
import handler11 from './handlers/getAdminComplianceOpsSummary/entry.ts';
import handler12 from './handlers/getAdminDeliveryRouteSummary/entry.ts';
import handler13 from './handlers/getAdminFulfillmentTaskDetails/entry.ts';
import handler14 from './handlers/getAdminInventoryStatusSummary/entry.ts';
import handler15 from './handlers/getAdminOperationsDashboardSummary/entry.ts';
import handler16 from './handlers/getAdminOpsAlertsSummary/entry.ts';
import handler17 from './handlers/getAdminOrderTimeline/entry.ts';
import handler18 from './handlers/getAdminOrdersWithHub/entry.ts';
import handler19 from './handlers/getAdminProductionPlanningSummary/entry.ts';
import handler20 from './handlers/getAdminProductionQueueSummary/entry.ts';
import handler21 from './handlers/getAdminPushDiagnostics/entry.ts';
import handler22 from './handlers/getAdminResourcesSummary/entry.ts';
import handler23 from './handlers/getAdminShopifyOpsSummary/entry.ts';
import handler24 from './handlers/getAdminSyncHealthSummary/entry.ts';
import handler25 from './handlers/manageAdminDiscountCode/entry.ts';
import handler26 from './handlers/markAdminFulfillmentTaskOutForDelivery/entry.ts';
import handler27 from './handlers/optimizeDeliveryRoute/entry.ts';
import handler28 from './handlers/packAdminProductionVerifyFulfillmentTasks/entry.ts';
import handler29 from './handlers/previewAdminProductionBatchComplete/entry.ts';
import handler30 from './handlers/previewAdminProductionBatchStart/entry.ts';
import handler31 from './handlers/previewAdminProductionBatchVerify/entry.ts';
import handler32 from './handlers/previewAdminProductionIngredientUsageCorrection/entry.ts';
import handler33 from './handlers/previewAdminProductionInventoryDeduction/entry.ts';
import handler34 from './handlers/previewAdminProductionVerifyCascades/entry.ts';
import handler35 from './handlers/previewNativeFulfillmentTaskLifecycle/entry.ts';
import handler36 from './handlers/previewNativeFulfillmentTaskMaterialization/entry.ts';
import handler37 from './handlers/previewNativeOrderScheduleCorrection/entry.ts';
import handler38 from './handlers/previewNativeProductionBatchLifecycle/entry.ts';
import handler39 from './handlers/processManualRefund/entry.ts';
import handler40 from './handlers/recordAdminFulfillmentTaskDelivered/entry.ts';
import handler41 from './handlers/saveAdminComplianceRecord/entry.ts';
import handler42 from './handlers/sendAdminPushTestNotification/entry.ts';
import handler43 from './handlers/sendNotificationCampaign/entry.ts';
import handler44 from './handlers/startAdminProductionBatch/entry.ts';
import handler45 from './handlers/updateAdminFulfillmentTaskAssignment/entry.ts';
import handler46 from './handlers/updateAdminOpsAlertStatus/entry.ts';
import handler47 from './handlers/updateAdminProductCatalogItem/entry.ts';
import handler48 from './handlers/verifyAdminProductionBatch/entry.ts';
import handler49 from './handlers/monitorLiveCheckoutTest/entry.ts';
import handler50 from './handlers/adminCancelAndRefundSubscription/entry.ts';
import handler51 from './handlers/approveZone3DeliveryRequest/entry.ts';
import handler52 from './handlers/denyZone3DeliveryRequest/entry.ts';
import handler53 from './handlers/pushMerchToShopify/entry.ts';
import handler54 from './handlers/pushProductToShopify/entry.ts';
import handler55 from './handlers/sendOrderSms/entry.ts';
import handler56 from './handlers/sendUpcomingDeliveryNotifications/entry.ts';
import handler57 from './handlers/syncShopifyOrderToHub/entry.ts';
import handler58 from './handlers/syncSubscriptionWithFulfillments/entry.ts';
import handler59 from './handlers/previewNativeSafeSyncDarkLaunchComparison/entry.ts';
import handler60 from './handlers/previewNativeSafeSyncOrderUpdate/entry.ts';
import handler61 from './handlers/monitorPostPaymentChain/entry.ts';
import handler62 from './handlers/executeNativeSafeSyncOrderUpdate/entry.ts';
import handler63 from './handlers/notifyOrderProcessed/entry.ts';

const HANDLERS = {
  "appendAdminHubOrderNote": handler0,
  "bottleAdminProductionVerifyShopifyOrder": handler1,
  "completeAdminProductionBatch": handler2,
  "correctAdminProductionIngredientUsage": handler3,
  "deductAdminProductionInventory": handler4,
  "executeNativeFulfillmentTaskLifecycle": handler5,
  "executeNativeFulfillmentTaskMaterialization": handler6,
  "executeNativeOrderScheduleCorrection": handler7,
  "executeNativeProductionBatchLifecycle": handler8,
  "generateAuditPacket": handler9,
  "getAdminCalendarEventsSummary": handler10,
  "getAdminComplianceOpsSummary": handler11,
  "getAdminDeliveryRouteSummary": handler12,
  "getAdminFulfillmentTaskDetails": handler13,
  "getAdminInventoryStatusSummary": handler14,
  "getAdminOperationsDashboardSummary": handler15,
  "getAdminOpsAlertsSummary": handler16,
  "getAdminOrderTimeline": handler17,
  "getAdminOrdersWithHub": handler18,
  "getAdminProductionPlanningSummary": handler19,
  "getAdminProductionQueueSummary": handler20,
  "getAdminPushDiagnostics": handler21,
  "getAdminResourcesSummary": handler22,
  "getAdminShopifyOpsSummary": handler23,
  "getAdminSyncHealthSummary": handler24,
  "manageAdminDiscountCode": handler25,
  "markAdminFulfillmentTaskOutForDelivery": handler26,
  "optimizeDeliveryRoute": handler27,
  "packAdminProductionVerifyFulfillmentTasks": handler28,
  "previewAdminProductionBatchComplete": handler29,
  "previewAdminProductionBatchStart": handler30,
  "previewAdminProductionBatchVerify": handler31,
  "previewAdminProductionIngredientUsageCorrection": handler32,
  "previewAdminProductionInventoryDeduction": handler33,
  "previewAdminProductionVerifyCascades": handler34,
  "previewNativeFulfillmentTaskLifecycle": handler35,
  "previewNativeFulfillmentTaskMaterialization": handler36,
  "previewNativeOrderScheduleCorrection": handler37,
  "previewNativeProductionBatchLifecycle": handler38,
  "processManualRefund": handler39,
  "recordAdminFulfillmentTaskDelivered": handler40,
  "saveAdminComplianceRecord": handler41,
  "sendAdminPushTestNotification": handler42,
  "sendNotificationCampaign": handler43,
  "startAdminProductionBatch": handler44,
  "updateAdminFulfillmentTaskAssignment": handler45,
  "updateAdminOpsAlertStatus": handler46,
  "updateAdminProductCatalogItem": handler47,
  "verifyAdminProductionBatch": handler48,
  "monitorLiveCheckoutTest": handler49,
  "adminCancelAndRefundSubscription": handler50,
  "approveZone3DeliveryRequest": handler51,
  "denyZone3DeliveryRequest": handler52,
  "pushMerchToShopify": handler53,
  "pushProductToShopify": handler54,
  "sendOrderSms": handler55,
  "sendUpcomingDeliveryNotifications": handler56,
  "syncShopifyOrderToHub": handler57,
  "syncSubscriptionWithFulfillments": handler58,
  "previewNativeSafeSyncDarkLaunchComparison": handler59,
  "previewNativeSafeSyncOrderUpdate": handler60,
  "monitorPostPaymentChain": handler61,
  "executeNativeSafeSyncOrderUpdate": handler62,
  "notifyOrderProcessed": handler63,
};

const DEFAULT_ACTION = 'getAdminOperationsDashboardSummary';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });

  const rawBody = await req.text();
  let body: Record<string, unknown> = {};
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

  const requestedAction = typeof body.gateway_action === 'string' ? body.gateway_action : DEFAULT_ACTION;
  const handler = HANDLERS[requestedAction];
  if (!handler) return Response.json({ error: 'unsupported_admin_operation' }, { status: 400 });

  const payload = body.gateway_action
    ? (body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
      ? body.payload
      : Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'gateway_action')))
    : body;
  const forwarded = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(payload),
  });
  const response = await handler(forwarded);
  return response instanceof Response
    ? response
    : Response.json({ error: 'admin_operation_returned_no_response' }, { status: 500 });
});
