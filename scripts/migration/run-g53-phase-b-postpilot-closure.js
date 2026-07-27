const TEST_TASK_ID = 'TASK-G53-TEST-20260723-DELIVERY';
const TEST_ORDER_NUMBER = 'G53-TEST-DELIVERY-20260723';
const EXPECTED_OPERATOR = 'info@nuvirajuice.com';

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

function includesText(value, text) {
  return JSON.stringify(value || {}).includes(text);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const evidence = {
  success: false,
  classification: 'phase_b_closure_verification_in_progress',
  generated_at_utc: new Date().toISOString(),
  test_task_id: TEST_TASK_ID,
};

try {
  const user = await base44.auth.me();
  assert(user?.role === 'admin', 'Closure verification requires admin');
  assert((user?.email || '').toLowerCase() === EXPECTED_OPERATOR, 'Closure operator mismatch');
  const tasks = await base44.entities.FulfillmentTask.filter({ fulfillment_task_id: TEST_TASK_ID }, '-created_date', 5);
  assert(tasks.length === 1 && tasks[0]?.is_test_task === true, 'Marked audit task is unavailable');
  const gateProbe = await invoke('executeNativeFulfillmentTaskLifecycle', {
    mode: 'live',
    confirmation: 'execute_native_fulfillment_task_lifecycle',
    fulfillment_task_id: TEST_TASK_ID,
    action: 'delivered_operational',
    request_id: 'g53-phase-b-postclosure-probe-20260723-v1',
    reason: 'G53 post-pilot closed-gate verification',
    update_customer_order_status: false,
    notify_customer: false,
  });
  assert(gateProbe.ok === false, 'Post-pilot mutation gate unexpectedly remained open');
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [defaultRoute, testRoute] = await Promise.all([
    invoke('getAdminDeliveryRouteSummary', { delivery_date: today, limit: 100, test_task_mode: 'exclude' }),
    invoke('getAdminDeliveryRouteSummary', { delivery_date: today, limit: 100, test_task_mode: 'only' }),
  ]);
  assert(defaultRoute.ok && testRoute.ok, 'Post-pilot delivery read models failed');
  assert(!includesText(defaultRoute.data, TEST_TASK_ID) && !includesText(defaultRoute.data, TEST_ORDER_NUMBER), 'Default queue leaked closed test task');
  assert(includesText(testRoute.data, TEST_TASK_ID) || includesText(testRoute.data, TEST_ORDER_NUMBER), 'Test-only queue lost audit task');
  evidence.success = true;
  evidence.classification = 'phase_b_live_pilot_closed_read_only_audit_preserved';
  evidence.persisted_task_status = tasks[0].status;
  evidence.persisted_task_is_test = tasks[0].is_test_task === true;
  evidence.mutation_gate_closed = true;
  evidence.gate_probe_transport_ok = gateProbe.ok;
  evidence.gate_probe_error = gateProbe.error;
  evidence.default_queue_contains_test_task = false;
  evidence.test_only_queue_contains_test_task = true;
  evidence.writes_performed = false;
} catch (error) {
  evidence.success = false;
  evidence.classification = 'phase_b_closure_verification_failed';
  evidence.error = safeError(error);
}

console.log(JSON.stringify(evidence, null, 2));
if (!evidence.success) throw new Error(evidence.error?.message || 'G53 Phase B closure verification failed');
