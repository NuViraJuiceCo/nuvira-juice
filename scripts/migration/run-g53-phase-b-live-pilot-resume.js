const TEST_TASK_ID = 'TASK-G53-TEST-20260723-DELIVERY';
const TEST_ORDER_NUMBER = 'G53-TEST-DELIVERY-20260723';
const TEST_EMAIL = 'g53.internal@example.invalid';
const EXPECTED_OPERATOR = 'info@nuvirajuice.com';
const REQUEST_ID = 'g53-phase-b-delivered-20260723-v1';

function responseData(response) {
  return response?.data || response || {};
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: (error?.message || String(error)).slice(0, 300),
    status: error?.status || error?.response?.status || null,
    code: error?.code || null,
  };
}

async function invoke(name, payload) {
  try {
    const response = await base44.functions.invoke(name, payload);
    return { ok: true, data: responseData(response), error: null };
  } catch (error) {
    return { ok: false, data: null, error: safeError(error) };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesText(value, text) {
  return JSON.stringify(value || {}).includes(text);
}

function chicagoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

const evidence = {
  success: false,
  classification: 'phase_b_live_pilot_resume_in_progress',
  generated_at_utc: new Date().toISOString(),
  test_task_id: TEST_TASK_ID,
  resumed_from: 'out_for_delivery_after_harness_request_id_omission',
  pre_resume: null,
  delivered: null,
  verification: null,
  safety: {
    customer_order_created: false,
    customer_order_updated: false,
    customer_notifications_sent: false,
    provider_calls_performed: false,
    route_saved: false,
    shopify_order_mutations: false,
    inventory_mutations_performed: false,
    refunds_performed: false,
    subscription_changes_performed: false,
    bulk_sync_performed: false,
  },
};

try {
  const user = await base44.auth.me();
  assert(user?.role === 'admin', 'Resume requires admin');
  assert((user?.email || '').toLowerCase() === EXPECTED_OPERATOR, 'Resume operator mismatch');

  const tasks = await base44.entities.FulfillmentTask.filter({ fulfillment_task_id: TEST_TASK_ID }, '-created_date', 5);
  assert(tasks.length === 1, 'Expected one exact test task');
  const task = tasks[0];
  assert(task?.is_test_task === true, 'Resume task is not formally marked test');
  assert(task?.status === 'out_for_delivery', 'Resume task is not at the proven out-for-delivery state');
  const priorLogs = (await base44.entities.CommandLog.filter({ target_id: task.id }, '-created_date', 20))
    .filter(log => log?.command_type === 'native_fulfillment_task_lifecycle');
  assert(priorLogs.length === 4, 'Expected one rejection and three successful commands before resume');
  assert(priorLogs.filter(log => log.status === 'rejected').length === 1, 'Expected one prior rejection');
  assert(priorLogs.filter(log => log.status === 'success').length === 3, 'Expected three prior successes');
  assert(priorLogs.every(log => log?.payload?.is_test_task === true), 'Prior logs are not all test-marked');
  evidence.pre_resume = {
    task_status: task.status,
    delivery_status: task.delivery_status,
    audit_trail_count: Array.isArray(task.audit_trail) ? task.audit_trail.length : 0,
    command_logs: {
      total: priorLogs.length,
      rejected: priorLogs.filter(log => log.status === 'rejected').length,
      success: priorLogs.filter(log => log.status === 'success').length,
      all_marked_test: true,
    },
  };

  const command = {
    mode: 'live',
    confirmation: 'execute_native_fulfillment_task_lifecycle',
    fulfillment_task_id: TEST_TASK_ID,
    action: 'delivered_operational',
    request_id: REQUEST_ID,
    reason: 'G53 controlled internal delivered_operational validation',
    delivery_drop_location: 'Internal Test Completion',
    delivery_notes: 'G53 internal delivery pilot; no customer or provider effect',
    update_customer_order_status: false,
    notify_customer: false,
  };
  const first = await invoke('executeNativeFulfillmentTaskLifecycle', command);
  assert(first.ok && first.data?.success === true && first.data?.writes_performed === true, 'Delivered resume command failed');
  assert(first.data?.status === 'delivered', 'Delivered resume status mismatch');
  assert(first.data?.customer_order_updated !== true, 'Delivered resume updated Customer App Order');
  assert(first.data?.customer_notification_sent !== true, 'Delivered resume sent customer notification');
  assert(first.data?.external_service_calls !== true, 'Delivered resume called external service');
  assert(first.data?.route_saved !== true, 'Delivered resume saved a route');
  const replay = await invoke('executeNativeFulfillmentTaskLifecycle', command);
  assert(replay.ok && replay.data?.idempotent === true && replay.data?.writes_performed === false, 'Delivered resume replay was not idempotent');
  evidence.delivered = {
    status: first.data.status,
    delivery_status: first.data.delivery_status,
    command_log_id: first.data.command_log_id,
    writes_performed: first.data.writes_performed === true,
    customer_order_updated: first.data.customer_order_updated === true,
    customer_notification_sent: first.data.customer_notification_sent === true,
    external_service_calls: first.data.external_service_calls === true,
    route_saved: first.data.route_saved === true,
    replay_idempotent: replay.data.idempotent === true,
    replay_writes_performed: replay.data.writes_performed === true,
  };

  const today = chicagoDate();
  const [
    finalTask,
    commandLogs,
    customerOrders,
    notifications,
    customerDeliveryLogs,
    defaultRoute,
    testRoute,
    operations,
    calendar,
  ] = await Promise.all([
    base44.entities.FulfillmentTask.get(task.id),
    base44.entities.CommandLog.filter({ target_id: task.id }, '-created_date', 20),
    base44.entities.Order.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
    base44.entities.Notification.filter({ customer_email: TEST_EMAIL }, '-created_date', 5),
    base44.entities.CustomerMessageDeliveryLog.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
    invoke('getAdminDeliveryRouteSummary', { delivery_date: today, limit: 100, test_task_mode: 'exclude' }),
    invoke('getAdminDeliveryRouteSummary', { delivery_date: today, limit: 100, test_task_mode: 'only' }),
    invoke('getAdminOperationsDashboardSummary', { preset: 'today' }),
    invoke('getAdminCalendarEventsSummary', {
      preset: 'custom',
      date_from: today,
      date_to: today,
      limit: 200,
    }),
  ]);
  const lifecycleLogs = commandLogs.filter(log => log?.command_type === 'native_fulfillment_task_lifecycle');
  assert(finalTask?.status === 'delivered' && finalTask?.delivery_status === 'delivered', 'Final delivered state did not persist');
  assert(finalTask?.is_test_task === true, 'Final test marker did not persist');
  assert(finalTask?.delivery_drop_location === 'Internal Test Completion', 'Drop location did not persist');
  assert(Array.isArray(finalTask?.audit_trail) && finalTask.audit_trail.length === 4, 'Expected four successful audit events');
  assert(lifecycleLogs.length === 5, 'Expected one rejected and four successful CommandLogs');
  assert(lifecycleLogs.filter(log => log.status === 'rejected').length === 1, 'Expected exactly one rejected CommandLog');
  assert(lifecycleLogs.filter(log => log.status === 'success').length === 4, 'Expected exactly four successful CommandLogs');
  assert(lifecycleLogs.every(log => log?.payload?.is_test_task === true), 'Every lifecycle log must be marked test');
  assert(customerOrders.length === 0, 'Customer App Order was created or matched');
  assert(notifications.length === 0, 'Notification was created');
  assert(customerDeliveryLogs.length === 0, 'Customer message delivery log was created');
  assert(defaultRoute.ok && testRoute.ok && operations.ok && calendar.ok, 'One or more read models failed');
  assert(!includesText(defaultRoute.data, TEST_TASK_ID) && !includesText(defaultRoute.data, TEST_ORDER_NUMBER), 'Default route leaked test task');
  assert(includesText(testRoute.data, TEST_TASK_ID) || includesText(testRoute.data, TEST_ORDER_NUMBER), 'Test-only route did not expose task');
  assert(!includesText(operations.data, TEST_TASK_ID) && !includesText(operations.data, TEST_ORDER_NUMBER), 'Operations leaked test task');
  assert(!includesText(calendar.data, TEST_TASK_ID) && !includesText(calendar.data, TEST_ORDER_NUMBER), 'Calendar leaked test task');
  evidence.verification = {
    persisted_task: {
      id: finalTask.id,
      fulfillment_task_id: finalTask.fulfillment_task_id,
      order_number: finalTask.order_number,
      status: finalTask.status,
      delivery_status: finalTask.delivery_status,
      assigned_driver: finalTask.assigned_driver,
      delivered_by: finalTask.delivered_by || null,
      delivery_drop_location: finalTask.delivery_drop_location || null,
      delivery_notes: finalTask.delivery_notes || null,
      is_test_task: finalTask.is_test_task === true,
      audit_trail_count: finalTask.audit_trail.length,
    },
    command_logs: {
      total: lifecycleLogs.length,
      rejected: lifecycleLogs.filter(log => log.status === 'rejected').length,
      success: lifecycleLogs.filter(log => log.status === 'success').length,
      failed: lifecycleLogs.filter(log => log.status === 'failed').length,
      all_marked_test: lifecycleLogs.every(log => log?.payload?.is_test_task === true),
      duplicate_logs_created_by_replays: false,
    },
    customer_side_effects: {
      customer_app_order_matches: customerOrders.length,
      notification_matches: notifications.length,
      customer_message_delivery_log_matches: customerDeliveryLogs.length,
    },
    operational_isolation: {
      default_route_contains_test_task: includesText(defaultRoute.data, TEST_TASK_ID) || includesText(defaultRoute.data, TEST_ORDER_NUMBER),
      test_only_route_contains_test_task: includesText(testRoute.data, TEST_TASK_ID) || includesText(testRoute.data, TEST_ORDER_NUMBER),
      test_only_route_mode: testRoute.data?.test_task_mode || null,
      operational_totals_exclude_test_tasks: defaultRoute.data?.operational_totals_exclude_test_tasks === true,
      operations_contains_test_task: includesText(operations.data, TEST_TASK_ID) || includesText(operations.data, TEST_ORDER_NUMBER),
      calendar_contains_test_task: includesText(calendar.data, TEST_TASK_ID) || includesText(calendar.data, TEST_ORDER_NUMBER),
    },
  };
  evidence.success = true;
  evidence.classification = 'phase_b_live_fulfillment_delivery_persistence_verified';
  evidence.disposition = 'Preserve the delivered internal test task and marked CommandLogs as audit evidence; remove all test-only mutation secrets after capture.';
} catch (error) {
  evidence.success = false;
  evidence.classification = 'phase_b_live_pilot_resume_failed_safe_hold';
  evidence.error = safeError(error);
}

console.log(JSON.stringify(evidence, null, 2));
if (!evidence.success) throw new Error(evidence.error?.message || 'G53 Phase B live pilot resume failed');
