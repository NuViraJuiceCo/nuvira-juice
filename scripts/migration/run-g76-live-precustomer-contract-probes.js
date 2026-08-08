const ADMIN_GATEWAY = 'getAdminOperationsDashboardSummary';
const CUSTOMER_GATEWAY = 'getCustomerAccountDashboardData';

function normalizePayload(value) {
  if (typeof value !== 'string') return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return { raw_response_type: 'string' };
  }
}

function safeError(error) {
  const message = String(error?.message || error || '').slice(0, 240);
  return {
    status: error?.status || error?.response?.status || null,
    code: error?.code || null,
    message,
    missing_function: /function.*(not found|does not exist)|404.*function/i.test(message),
  };
}

async function probe(gateway, action, payload = {}) {
  try {
    const response = await base44.functions.invoke(gateway, {
      gateway_action: action,
      payload,
    });
    const data = normalizePayload(response?.data ?? response);
    const error = typeof data?.error === 'string' ? data.error.slice(0, 200) : null;
    const responseKeys = data && typeof data === 'object'
      ? Object.keys(data).filter((key) => !['orders', 'customers', 'members', 'notifications', 'items', 'data'].includes(key)).slice(0, 20)
      : [];
    return {
      gateway,
      action,
      transport: 'returned',
      routed: true,
      application_success: data?.success === true,
      application_rejection: Boolean(error),
      missing_function: /function.*(not found|does not exist)|404.*function/i.test(error || ''),
      result_shape: Array.isArray(data) ? 'array' : typeof data,
      response_keys: responseKeys,
      ...(error ? { application_error: error } : {}),
    };
  } catch (error) {
    const safe = safeError(error);
    return {
      gateway,
      action,
      transport: 'rejected',
      routed: !safe.missing_function,
      application_success: false,
      application_rejection: true,
      missing_function: safe.missing_function,
      status: safe.status,
      code: safe.code,
    };
  }
}

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const adminReadProbes = [
  ['getAdminCalendarEventsSummary', { preset: 'today', limit: 20 }],
  ['getAdminComplianceOpsSummary', { date_from: today, date_to: today, test_record_mode: 'exclude' }],
  ['getAdminDeliveryRouteSummary', { delivery_date: today, limit: 20, test_task_mode: 'exclude' }],
  ['getAdminInventoryStatusSummary', { limit: 20 }],
  ['getAdminOpsAlertsSummary', { limit: 20 }],
  ['getAdminOrdersWithHub', { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }],
  ['getAdminProductionPlanningSummary', { preset: 'today' }],
  ['getAdminProductionQueueSummary', { date_from: today, date_to: today, limit: 20, test_batch_mode: 'exclude' }],
  ['getAdminPushDiagnostics', {}],
  ['getAdminResourcesSummary', { limit: 20 }],
  ['getAdminShopifyOpsSummary', {}],
  ['getAdminSyncHealthSummary', {}],
];

const adminNoWriteValidationProbes = [
  ['getAdminFulfillmentTaskDetails', { fulfillment_task_id: 'G76-NONEXISTENT-TASK' }],
  ['getAdminOrderTimeline', { order_id: 'G76-NONEXISTENT-ORDER' }],
  ['previewAdminProductionBatchStart', { batch_id: 'G76-NONEXISTENT-BATCH' }],
  ['previewAdminProductionBatchComplete', { batch_id: 'G76-NONEXISTENT-BATCH' }],
  ['previewAdminProductionBatchVerify', { batch_id: 'G76-NONEXISTENT-BATCH' }],
  ['previewAdminProductionIngredientUsageCorrection', { batch_id: 'G76-NONEXISTENT-BATCH' }],
  ['previewAdminProductionInventoryDeduction', { batch_id: 'G76-NONEXISTENT-BATCH' }],
  ['previewAdminProductionVerifyCascades', { batch_id: 'G76-NONEXISTENT-BATCH' }],
  ['previewNativeFulfillmentTaskLifecycle', { fulfillment_task_id: 'G76-NONEXISTENT-TASK' }],
  ['previewNativeFulfillmentTaskMaterialization', { order_id: 'G76-NONEXISTENT-ORDER' }],
  ['previewNativeOrderScheduleCorrection', { order_id: 'G76-NONEXISTENT-ORDER' }],
  ['previewNativeProductionBatchLifecycle', { batch_id: 'G76-NONEXISTENT-BATCH' }],
];

const customerReadProbes = [
  ['getCustomerNotifications', {}],
  ['getCustomerOrderDetail', { order_id: 'G76-NONEXISTENT-ORDER' }],
  ['getDeliveryEta', { order_id: 'G76-NONEXISTENT-ORDER' }],
  ['getOrderBySession', { session_id: 'cs_g76_nonexistent' }],
];

const customerNoWriteValidationProbes = [
  ['completeAccountSetup', {}],
  ['claimReward', {}],
  ['createZone3AuthorizationIntent', {}],
  ['createZone3SubscriptionReviewRequest', {}],
  ['registerPushSubscription', {}],
];

const results = [];
for (const [action, payload] of adminReadProbes) results.push(await probe(ADMIN_GATEWAY, action, payload));
for (const [action, payload] of adminNoWriteValidationProbes) results.push(await probe(ADMIN_GATEWAY, action, payload));
for (const [action, payload] of customerReadProbes) results.push(await probe(CUSTOMER_GATEWAY, action, payload));
for (const [action, payload] of customerNoWriteValidationProbes) results.push(await probe(CUSTOMER_GATEWAY, action, payload));
results.push(await probe(ADMIN_GATEWAY, 'G76_MISSING_ADMIN_ALIAS', {}));
results.push(await probe(CUSTOMER_GATEWAY, 'G76_MISSING_CUSTOMER_ALIAS', {}));

const knownUnknownActions = new Set(['G76_MISSING_ADMIN_ALIAS', 'G76_MISSING_CUSTOMER_ALIAS']);
const requiredResults = results.filter(row => !knownUnknownActions.has(row.action));
const unknownResults = results.filter(row => knownUnknownActions.has(row.action));
const summary = {
  ok: requiredResults.every(row => row.routed && !row.missing_function) &&
    unknownResults.every(row => row.application_rejection && !row.missing_function),
  suite: 'g76-live-precustomer-contract-probes',
  probe_count: results.length,
  required_route_count: requiredResults.length,
  routed_count: requiredResults.filter(row => row.routed).length,
  missing_function_count: requiredResults.filter(row => row.missing_function).length,
  read_probe_count: adminReadProbes.length + customerReadProbes.length,
  no_write_validation_probe_count: adminNoWriteValidationProbes.length + customerNoWriteValidationProbes.length,
  unknown_action_rejection_count: unknownResults.filter(row => row.application_rejection).length,
  writes_requested: false,
  provider_calls_requested: false,
  provider_read_calls_possible: false,
  customer_notifications_requested: false,
  payment_actions_requested: false,
};

console.log(JSON.stringify({ summary, results }, null, 2));
if (!summary.ok) throw new Error('One or more live gateway routes failed the pre-customer contract probe');
