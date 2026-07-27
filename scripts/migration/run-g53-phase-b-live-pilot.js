const TEST_TASK_ID = 'TASK-G53-TEST-20260723-DELIVERY';
const TEST_ORDER_ID = 'G53-INTERNAL-NO-CUSTOMER-ORDER';
const TEST_ORDER_NUMBER = 'G53-TEST-DELIVERY-20260723';
const TEST_EMAIL = 'g53.internal@example.invalid';
const EXPECTED_OPERATOR = 'info@nuvirajuice.com';
const CONFIRMATION = 'execute_native_fulfillment_task_lifecycle';
const TEST_PURPOSE = 'G53 controlled delivery persistence validation';
const INTERNAL_DRIVER = 'G53 Internal Driver';

function chicagoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

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

function routeSummary(data) {
  return {
    summary: data?.summary || null,
    test_task_mode: data?.test_task_mode || null,
    operational_totals_exclude_test_tasks: data?.operational_totals_exclude_test_tasks === true,
    contains_test_task: includesText(data, TEST_TASK_ID) || includesText(data, TEST_ORDER_NUMBER),
    active_count: Array.isArray(data?.sections?.delivery_stops) ? data.sections.delivery_stops.length : null,
    completed_count: Array.isArray(data?.sections?.completed) ? data.sections.completed.length : null,
  };
}

const generatedAt = new Date();
const pilotWindowEnd = new Date(generatedAt.getTime() + 60 * 60 * 1000);
const today = chicagoDate();
const requestIds = {
  invalid_delivered: 'g53-phase-b-invalid-delivered-20260723-v1',
  assign: 'g53-phase-b-assign-20260723-v1',
  pack: 'g53-phase-b-pack-20260723-v1',
  out_for_delivery: 'g53-phase-b-out-for-delivery-20260723-v1',
  delivered_operational: 'g53-phase-b-delivered-20260723-v1',
};

const evidence = {
  success: false,
  classification: 'phase_b_live_pilot_in_progress',
  generated_at_utc: generatedAt.toISOString(),
  pilot_window: {
    start_utc: generatedAt.toISOString(),
    end_utc: pilotWindowEnd.toISOString(),
    timezone: 'America/Chicago',
  },
  rollback_owner: 'NuVira owner authorization; executing admin info@nuvirajuice.com',
  test_task_id: TEST_TASK_ID,
  synthetic_order_reference: TEST_ORDER_NUMBER,
  operator: null,
  baseline: null,
  creation: null,
  invalid_transition: null,
  lifecycle: null,
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
  evidence.operator = { email: user?.email || null, role: user?.role || null };
  assert(user?.role === 'admin', 'G53 Phase B pilot requires an admin operator');
  assert((user?.email || '').toLowerCase() === EXPECTED_OPERATOR, 'G53 Phase B operator does not match approval');

  const [preexistingTasks, preexistingOrders, preexistingNotifications, preexistingDeliveryLogs] = await Promise.all([
    base44.entities.FulfillmentTask.filter({ fulfillment_task_id: TEST_TASK_ID }, '-created_date', 5),
    base44.entities.Order.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
    base44.entities.Notification.filter({ customer_email: TEST_EMAIL }, '-created_date', 5),
    base44.entities.CustomerMessageDeliveryLog.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
  ]);
  assert(preexistingTasks.length === 0, 'G53 test task already exists; refusing duplicate creation');
  assert(preexistingOrders.length === 0, 'Synthetic order reference unexpectedly resolves to a Customer App Order');
  assert(preexistingNotifications.length === 0, 'Synthetic test email already has Notification rows');
  assert(preexistingDeliveryLogs.length === 0, 'Synthetic order reference already has customer delivery logs');

  const [baselineRouteCall, baselineOperationsCall, baselineCalendarCall] = await Promise.all([
    invoke('getAdminDeliveryRouteSummary', {
      delivery_date: today,
      limit: 100,
      test_task_mode: 'exclude',
    }),
    invoke('getAdminOperationsDashboardSummary', { preset: 'today' }),
    invoke('getAdminCalendarEventsSummary', {
      preset: 'custom',
      date_from: today,
      date_to: today,
      limit: 200,
    }),
  ]);
  assert(baselineRouteCall.ok && baselineOperationsCall.ok && baselineCalendarCall.ok, 'Unable to capture Phase B read-only baseline');
  evidence.baseline = {
    route: routeSummary(baselineRouteCall.data),
    operations_contains_test_task: includesText(baselineOperationsCall.data, TEST_TASK_ID),
    calendar_contains_test_task: includesText(baselineCalendarCall.data, TEST_TASK_ID),
    customer_order_matches: preexistingOrders.length,
    notification_matches: preexistingNotifications.length,
    customer_message_delivery_log_matches: preexistingDeliveryLogs.length,
  };
  assert(evidence.baseline.route.contains_test_task === false, 'Test task unexpectedly present in baseline route');

  const created = await base44.entities.FulfillmentTask.create({
    order_id: TEST_ORDER_ID,
    order_number: TEST_ORDER_NUMBER,
    fulfillment_task_id: TEST_TASK_ID,
    customer_name: 'G53 Internal QA',
    customer_email: TEST_EMAIL,
    source_channel: 'customer_app_internal_validation',
    source_type: 'delivery',
    task_source: 'g53_controlled_live_pilot',
    created_from_native_ops: true,
    order_type: 'internal_test',
    fulfillment_type: 'delivery',
    fulfillment_number: 1,
    delivery_date: today,
    scheduled_date: today,
    assigned_delivery_date: today,
    delivery_window_label: 'Internal Validation Window',
    address: 'Internal Test Route',
    delivery_address: {
      address_line1: 'Internal Test Route',
      city: 'Internal',
      state: 'MO',
    },
    address_complete: true,
    items: [{ title: 'Aura', quantity: 1, price: 0 }],
    items_summary: '1x Aura',
    line_item_count: 1,
    total_price: 0,
    status: 'scheduled',
    delivery_status: 'pending',
    production_status: 'ready',
    payment_status: 'test_paid',
    route_id: 'ROUTE-G53-INTERNAL-TEST',
    route_stop_sequence: 1,
    is_test_task: true,
    test_purpose: TEST_PURPOSE,
    internal_notes: 'Internal validation only. No Customer App Order, customer contact, provider call, or inventory effect.',
    notes: 'G53 isolated live delivery pilot audit record.',
    audit_trail: [],
  });
  assert(created?.id, 'FulfillmentTask creation did not return an id');
  assert(created?.is_test_task === true, 'Formal test-task marker did not persist on creation');
  assert(created?.status === 'scheduled', 'Test task did not persist as scheduled');
  evidence.creation = {
    fulfillment_task_entity_id: created.id,
    fulfillment_task_id: created.fulfillment_task_id,
    order_number: created.order_number,
    status: created.status,
    is_test_task: created.is_test_task === true,
    customer_email_domain: created.customer_email?.split('@')[1] || null,
    task_source: created.task_source,
  };

  const invalidExecute = await invoke('executeNativeFulfillmentTaskLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    fulfillment_task_id: TEST_TASK_ID,
    action: 'delivered_operational',
    request_id: requestIds.invalid_delivered,
    reason: 'G53 prove invalid transition rejection',
    update_customer_order_status: false,
    notify_customer: false,
  });
  const invalidReplay = await invoke('executeNativeFulfillmentTaskLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    fulfillment_task_id: TEST_TASK_ID,
    action: 'delivered_operational',
    request_id: requestIds.invalid_delivered,
    reason: 'G53 prove rejected command idempotency',
    update_customer_order_status: false,
    notify_customer: false,
  });
  const invalidLogKey = `native_fulfillment_task_lifecycle:${requestIds.invalid_delivered}`;
  const invalidLogs = await base44.entities.CommandLog.filter({ idempotency_key: invalidLogKey }, '-created_date', 5);
  const afterInvalid = await base44.entities.FulfillmentTask.get(created.id);
  assert(invalidExecute.ok === false, 'Invalid delivered transition unexpectedly succeeded');
  assert(invalidReplay.ok === false, 'Rejected transition replay unexpectedly succeeded');
  assert(invalidLogs.length === 1 && invalidLogs[0]?.status === 'rejected', 'Invalid transition must create one rejected CommandLog');
  assert(afterInvalid?.status === 'scheduled', 'Invalid transition changed task status');
  evidence.invalid_transition = {
    first_transport_ok: invalidExecute.ok,
    replay_transport_ok: invalidReplay.ok,
    command_log_count: invalidLogs.length,
    command_log_status: invalidLogs[0]?.status || null,
    blockers: invalidLogs[0]?.result?.blockers || [],
    status_after_rejection: afterInvalid?.status || null,
    mutation_performed: false,
  };

  async function runAndReplay(action, payload = {}) {
    const requestId = requestIds[action];
    const command = {
      mode: 'live',
      confirmation: CONFIRMATION,
      fulfillment_task_id: TEST_TASK_ID,
      action,
      request_id: requestId,
      reason: `G53 controlled internal ${action} validation`,
      update_customer_order_status: false,
      notify_customer: false,
      ...payload,
    };
    const first = await invoke('executeNativeFulfillmentTaskLifecycle', command);
    assert(first.ok && first.data?.success === true && first.data?.writes_performed === true, `${action} live command failed`);
    assert(first.data?.customer_order_updated !== true, `${action} unexpectedly updated Customer App Order`);
    assert(first.data?.customer_notification_sent !== true, `${action} unexpectedly sent customer notification`);
    assert(first.data?.external_service_calls !== true, `${action} unexpectedly called external service`);
    const replay = await invoke('executeNativeFulfillmentTaskLifecycle', command);
    assert(replay.ok && replay.data?.idempotent === true && replay.data?.writes_performed === false, `${action} replay was not idempotent`);
    return {
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
  }

  const assign = await runAndReplay('assign', { assigned_driver: INTERNAL_DRIVER });
  const pack = await runAndReplay('pack');
  const outForDelivery = await runAndReplay('out_for_delivery');
  const delivered = await runAndReplay('delivered_operational', {
    delivery_drop_location: 'Internal Test Completion',
    delivery_notes: 'G53 internal delivery pilot; no customer or provider effect',
  });
  assert(assign.status === 'assigned', 'Assign status mismatch');
  assert(pack.status === 'packed', 'Pack status mismatch');
  assert(outForDelivery.status === 'out_for_delivery', 'Out-for-delivery status mismatch');
  assert(delivered.status === 'delivered', 'Delivered status mismatch');
  evidence.lifecycle = {
    assign,
    pack,
    out_for_delivery: outForDelivery,
    delivered_operational: delivered,
  };

  const [
    finalTask,
    commandLogs,
    customerOrders,
    notifications,
    customerDeliveryLogs,
    defaultRouteCall,
    testRouteCall,
    operationsCall,
    calendarCall,
  ] = await Promise.all([
    base44.entities.FulfillmentTask.get(created.id),
    base44.entities.CommandLog.filter({ target_id: created.id }, '-created_date', 20),
    base44.entities.Order.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
    base44.entities.Notification.filter({ customer_email: TEST_EMAIL }, '-created_date', 5),
    base44.entities.CustomerMessageDeliveryLog.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
    invoke('getAdminDeliveryRouteSummary', {
      delivery_date: today,
      limit: 100,
      test_task_mode: 'exclude',
    }),
    invoke('getAdminDeliveryRouteSummary', {
      delivery_date: today,
      limit: 100,
      test_task_mode: 'only',
    }),
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
  assert(finalTask?.is_test_task === true, 'Final test-task marker did not persist');
  assert(finalTask?.delivery_drop_location === 'Internal Test Completion', 'Delivery drop location did not persist');
  assert(Array.isArray(finalTask?.audit_trail) && finalTask.audit_trail.length === 4, 'Successful task audit trail must contain four events');
  assert(lifecycleLogs.length === 5, 'Lifecycle CommandLog count must be one rejection plus four successes');
  assert(lifecycleLogs.filter(log => log.status === 'rejected').length === 1, 'Expected exactly one rejected CommandLog');
  assert(lifecycleLogs.filter(log => log.status === 'success').length === 4, 'Expected exactly four successful CommandLogs');
  assert(lifecycleLogs.every(log => log?.payload?.is_test_task === true), 'Every Phase B CommandLog must be marked test');
  assert(customerOrders.length === 0, 'Phase B created or matched a Customer App Order');
  assert(notifications.length === 0, 'Phase B created a Notification');
  assert(customerDeliveryLogs.length === 0, 'Phase B created a customer message delivery log');
  assert(defaultRouteCall.ok && testRouteCall.ok && operationsCall.ok && calendarCall.ok, 'One or more Phase B read models failed');
  assert(!includesText(defaultRouteCall.data, TEST_TASK_ID) && !includesText(defaultRouteCall.data, TEST_ORDER_NUMBER), 'Default delivery queue leaked test task');
  assert(includesText(testRouteCall.data, TEST_TASK_ID) || includesText(testRouteCall.data, TEST_ORDER_NUMBER), 'Test-only delivery queue did not expose test task');
  assert(!includesText(operationsCall.data, TEST_TASK_ID) && !includesText(operationsCall.data, TEST_ORDER_NUMBER), 'Operations dashboard leaked test task');
  assert(!includesText(calendarCall.data, TEST_TASK_ID) && !includesText(calendarCall.data, TEST_ORDER_NUMBER), 'Calendar leaked test task');

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
      default_route: routeSummary(defaultRouteCall.data),
      test_only_route: routeSummary(testRouteCall.data),
      operations_contains_test_task: includesText(operationsCall.data, TEST_TASK_ID) || includesText(operationsCall.data, TEST_ORDER_NUMBER),
      calendar_contains_test_task: includesText(calendarCall.data, TEST_TASK_ID) || includesText(calendarCall.data, TEST_ORDER_NUMBER),
    },
  };

  evidence.success = true;
  evidence.classification = 'phase_b_live_fulfillment_delivery_persistence_verified';
  evidence.disposition = 'Preserve the delivered internal test task and marked CommandLogs as audit evidence; remove all test-only mutation secrets after capture.';
} catch (error) {
  evidence.success = false;
  evidence.classification = 'phase_b_live_pilot_failed_safe_hold';
  evidence.error = safeError(error);
}

console.log(JSON.stringify(evidence, null, 2));
if (!evidence.success) throw new Error(evidence.error?.message || 'G53 Phase B live pilot failed');
