const ORDER_NUMBER = 'G81-TEST-JOURNEY-20260807';
const BATCH_ID = 'BATCH-G81-TEST-20260807-CONNECTED';
const TASK_ID = 'TASK-G81-TEST-20260807-CONNECTED';
const EMAIL = 'info@nuvirajuice.com';
const PRODUCTION_CONFIRMATION = 'execute_native_production_batch_lifecycle';
const FULFILLMENT_CONFIRMATION = 'execute_native_fulfillment_task_lifecycle';
const STAFF = 'NuVira Internal QA';

function data(response) { return response?.data || response || {}; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function invoke(name, payload) {
  try {
    return {
      ok: true,
      data: data(await base44.functions.invoke('getAdminOperationsDashboardSummary', {
        gateway_action: name,
        payload,
      })),
    };
  }
  catch (error) { return { ok: false, status: error?.status || error?.response?.status || null, data: error?.response?.data || null, message: String(error?.message || error).slice(0, 240) }; }
}
function chicagoDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function chicagoTime() {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
}

async function waitForEvent(orderId, event, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const logs = await base44.entities.CustomerMessageDeliveryLog.filter({ order_id: orderId }, '-created_date', 50);
    const matches = logs.filter((row) => row?.metadata?.event === event);
    if (matches.length > 0 && matches.every((row) => !['prepared'].includes(row.status))) return matches;
    await delay(1500);
  }
  return (await base44.entities.CustomerMessageDeliveryLog.filter({ order_id: orderId }, '-created_date', 50))
    .filter((row) => row?.metadata?.event === event);
}

function summarizeLogs(rows) {
  return rows.map((row) => ({ channel: row.channel, status: row.status, provider: row.provider, error: row.error_message || null }));
}

const today = chicagoDate();
const time = chicagoTime();
const evidence = { success: false, order_number: ORDER_NUMBER, batch_id: BATCH_ID, task_id: TASK_ID, stages: {}, communications: {} };

try {
  const user = await base44.auth.me();
  assert(user?.role === 'admin' && (user?.email || '').toLowerCase() === EMAIL, 'expected admin operator required');

  const [oldOrders, oldBatches, oldTasks] = await Promise.all([
    base44.entities.Order.filter({ order_number: ORDER_NUMBER }, '-created_date', 5),
    base44.entities.ProductionBatch.filter({ batch_id: BATCH_ID }, '-created_date', 5),
    base44.entities.FulfillmentTask.filter({ fulfillment_task_id: TASK_ID }, '-created_date', 5),
  ]);
  assert(oldOrders.length === 0 && oldBatches.length === 0 && oldTasks.length === 0, 'G81 connected records already exist');

  const order = await base44.entities.Order.create({
    order_number: ORDER_NUMBER,
    customer_email: EMAIL,
    customer_name: 'NuVira Internal QA',
    items: [{ title: 'Aura', quantity: 1, price: 0, category: 'juice', size: '12 oz' }],
    subtotal: 0,
    delivery_fee: 0,
    total: 0,
    fulfillment_type: 'delivery',
    delivery_address: 'Internal QA Route',
    address_line1: 'Internal QA Route',
    address_city: 'O Fallon',
    address_state: 'MO',
    address_postal_code: '63366',
    assigned_production_day: today,
    assigned_delivery_date: today,
    assigned_delivery_day: 'Internal QA',
    delivery_window_label: 'Internal QA Window',
    status: 'scheduled_for_juicing',
    status_history: [{ status: 'scheduled_for_juicing', timestamp: new Date().toISOString(), message: 'Internal QA order created.' }],
    production_status: 'scheduled_for_production',
    fulfillment_status: 'pending_production',
    delivery_status: 'not_ready',
    financial_status: 'paid',
    payment_status: 'paid',
    payment_captured: true,
    is_test_order: true,
    do_not_recover: false,
    notes: 'G81 zero-dollar internal test. No Stripe or Shopify provider object.',
    health_advisory_acknowledged: true,
    health_advisory_version: '2026-05-13-v1',
  });
  assert(order?.id, 'test order creation failed');

  const batch = await base44.entities.ProductionBatch.create({
    batch_id: BATCH_ID,
    product_name: 'Aura', product_category: 'juice', status: 'planned', planned_units: 1,
    production_date: today, assigned_to: STAFF, staff_on_duty: [STAFF],
    equipment_used: ['Cold-press juicer', 'Internal QA bottling set'],
    formula_or_recipe_used: 'Aura approved production recipe', bottle_size: '12 oz',
    ingredients_used: [
      { ingredient_name: 'Orange', quantity: 1, unit: 'lb', lot_number: 'G81-CONNECTED-ORANGE' },
      { ingredient_name: 'Carrot', quantity: 1, unit: 'lb', lot_number: 'G81-CONNECTED-CARROT' },
      { ingredient_name: 'Ginger', quantity: 0.1, unit: 'lb', lot_number: 'G81-CONNECTED-GINGER' },
    ],
    is_test_batch: true, test_purpose: 'G81 connected zero-dollar internal journey', is_locked: false,
    related_orders: [order.id],
    order_sources: [{ order_id: order.id, order_number: ORDER_NUMBER, quantity: 1, source_type: 'customer_app_internal_validation' }],
    source_system: 'customer_app_internal_validation', native_owner_status: 'internal_test_only',
    inventory_deduction_status: 'held_internal_test', audit_trail: [],
    notes: 'G81 connected internal test batch. No physical product or inventory effect.',
  });
  assert(batch?.id, 'test batch creation failed');

  const common = { batch_id: BATCH_ID, source_production_batch_id: batch.id, related_batch_ids: [BATCH_ID], related_source_production_batch_ids: [batch.id], is_test_record: true };
  const compliance = await Promise.all([
    invoke('saveAdminComplianceRecord', { record_type: 'sanitation', data: { ...common, log_date: today, log_time: time, staff_member: STAFF, area: 'Prep Area', sanitizer_type: 'Internal QA', sanitizer_level: 'Adequate', cleaned: true, sanitized: true, verified_by: EMAIL, notes: 'G81 connected test' } }),
    invoke('saveAdminComplianceRecord', { record_type: 'daily_checklist', data: { ...common, checklist_date: today, staff_member: STAFF, shift: 'Internal QA', morning_fridge_temp_logged: true, morning_fridge_time: time, sanitizer_levels_checked: true, sanitizer_check_time: time, equipment_sanitized: true, sanitization_time: time, work_areas_cleaned: true, cleaning_time: time, batch_logs_completed: false, ccp_logs_completed: false, batches_logged: BATCH_ID, overall_status: 'Pre-Production Complete', manager_reviewed: true, manager_comments: 'G81 connected test' } }),
    invoke('saveAdminComplianceRecord', { record_type: 'temperature', data: { ...common, log_date: today, log_time: time, staff_member: STAFF, location: 'Cold Room 1', temperature: 38, unit: 'F', min_range: 35, max_range: 40, production_date: today, shift: 'Internal QA', notes: 'G81 connected test' } }),
  ]);
  assert(compliance.every((call) => call.ok && call.data?.success), 'pre-start compliance failed');

  const startPayload = {
    mode: 'live', confirmation: PRODUCTION_CONFIRMATION, production_batch_id: batch.id, batch_id: BATCH_ID,
    action: 'start', request_id: 'g81-connected-start-20260807-r3', reason: 'G81 connected production start',
    update_customer_order_status: true, notify_customer: true, allow_internal_test_customer_side_effects: true,
  };
  const start = await invoke('executeNativeProductionBatchLifecycle', startPayload);
  assert(start.ok && start.data?.success && start.data?.customer_order_projection?.updated_count === 1, `connected start failed: ${JSON.stringify(start)}`);
  const startReplay = await invoke('executeNativeProductionBatchLifecycle', startPayload);
  assert(startReplay.ok && startReplay.data?.idempotent && startReplay.data?.writes_performed === false, 'connected start replay was not idempotent');
  const afterStartOrder = await base44.entities.Order.get(order.id);
  assert(afterStartOrder?.status === 'in_production' && afterStartOrder?.production_status === 'in_production', 'order did not project to in_production');
  const productionLogs = await waitForEvent(order.id, 'in_production');
  assert(productionLogs.length >= 1, 'in_production communication was not logged');
  assert(productionLogs.every((row) => row.channel !== 'email'), 'in_production must remain push/in-app only');
  evidence.stages.production_start = { batch_status: start.data.status, order_status: afterStartOrder.status, replay_idempotent: true };
  evidence.communications.in_production = summarizeLogs(productionLogs);

  const complete = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live', confirmation: PRODUCTION_CONFIRMATION, production_batch_id: batch.id, batch_id: BATCH_ID,
    action: 'complete', request_id: 'g81-connected-complete-20260807-r3', reason: 'G81 connected production complete',
    actual_units: 1, bottles_produced: 1, bottles_rejected_or_wasted: 0, final_usable_quantity: 1,
    storage_location: 'Internal Test Hold', use_by_date: today,
  });
  assert(complete.ok && complete.data?.status === 'completed_pending_verification', 'connected complete failed');
  const verify = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live', confirmation: PRODUCTION_CONFIRMATION, production_batch_id: batch.id, batch_id: BATCH_ID,
    action: 'verify', request_id: 'g81-connected-verify-20260807-r3', reason: 'G81 connected production verify',
    pH_result: 4.1, pH_passed_failed: 'passed', passed_failed: 'passed', calibration_checked: true,
    ccp_check_complete: true, sanitation_verification_complete: true, labels_applied: true,
    staff_on_duty: [STAFF], verification_notes: 'G81 connected verification; meter ID intentionally omitted',
  });
  assert(verify.ok && verify.data?.status === 'verified_logged' && verify.data?.compliance_log_created, 'connected verify failed');
  evidence.stages.production_complete_verify = { complete_status: complete.data.status, verify_status: verify.data.status, meter_id_required: false };

  const task = await base44.entities.FulfillmentTask.create({
    order_id: order.id, base44_order_id: order.id, order_number: ORDER_NUMBER, fulfillment_task_id: TASK_ID,
    customer_name: 'NuVira Internal QA', customer_email: EMAIL, source_channel: 'customer_app_internal_validation',
    source_type: 'delivery', task_source: 'g81_connected_live_pilot', created_from_native_ops: true,
    order_type: 'internal_test', fulfillment_type: 'delivery', fulfillment_number: 1,
    delivery_date: today, scheduled_date: today, assigned_delivery_date: today, production_date: today,
    delivery_window_label: 'Internal QA Window', address: 'Internal QA Route',
    delivery_address: { address_line1: 'Internal QA Route', city: 'O Fallon', state: 'MO', postal_code: '63366' },
    address_complete: true, items: [{ title: 'Aura', quantity: 1, price: 0 }], items_summary: '1x Aura',
    line_item_count: 1, total_price: 0, status: 'scheduled', delivery_status: 'pending',
    production_status: 'ready', payment_status: 'paid', is_test_task: true,
    test_purpose: 'G81 connected zero-dollar internal journey', audit_trail: [],
    internal_notes: 'Internal QA only; linked only to the zero-dollar formal test Order.',
  });
  assert(task?.id, 'test task creation failed');

  async function fulfillment(action, requestId, extras = {}) {
    return await invoke('executeNativeFulfillmentTaskLifecycle', {
      mode: 'live', confirmation: FULFILLMENT_CONFIRMATION, fulfillment_task_id: TASK_ID,
      action, request_id: requestId, reason: `G81 connected ${action}`, ...extras,
    });
  }
  const assign = await fulfillment('assign', 'g81-connected-assign-20260807-r3', { assigned_driver: 'NuVira Internal QA Driver' });
  assert(assign.ok && assign.data?.status === 'assigned', 'assign failed');
  const pack = await fulfillment('pack', 'g81-connected-pack-20260807-r3');
  assert(pack.ok && pack.data?.status === 'packed', 'pack failed');

  const forbidden = await fulfillment('out_for_delivery', 'g81-connected-ood-forbidden-20260807-r3', { update_customer_order_status: true, notify_customer: true });
  assert(!forbidden.ok && forbidden.data?.error_code === 'test_task_customer_side_effects_forbidden', 'test customer side-effect gate did not reject');

  const ood = await fulfillment('out_for_delivery', 'g81-connected-ood-20260807-r3', {
    update_customer_order_status: true, notify_customer: true, allow_internal_test_customer_side_effects: true,
  });
  assert(ood.ok && ood.data?.status === 'out_for_delivery' && ood.data?.customer_order_updated === true, `out for delivery failed: ${JSON.stringify(ood)}`);
  assert(ood.data?.customer_notification?.reason === 'order_status_entity_automation_triggered', 'single-sender notification ownership mismatch');
  const oodLogs = await waitForEvent(order.id, 'out_for_delivery');
  assert(oodLogs.length >= 1, 'out_for_delivery communication was not logged');
  evidence.communications.out_for_delivery = summarizeLogs(oodLogs);

  const delivered = await fulfillment('delivered_operational', 'g81-connected-delivered-20260807-r3', {
    update_customer_order_status: true, notify_customer: true, allow_internal_test_customer_side_effects: true,
    delivery_drop_location: 'Internal Test Completion', delivery_notes: 'G81 internal delivery proof test',
  });
  assert(delivered.ok && delivered.data?.status === 'delivered' && delivered.data?.customer_order_updated === true, `delivered failed: ${JSON.stringify(delivered)}`);
  const deliveredLogs = await waitForEvent(order.id, 'delivered');
  assert(deliveredLogs.some((row) => row.channel === 'email' && ['sent', 'delivered'].includes(row.status)), 'delivered email was not sent');
  assert(deliveredLogs.some((row) => row.channel === 'push'), 'delivered push attempt was not logged');
  assert(!JSON.stringify(deliveredLogs).toLowerCase().includes('undefined'), 'delivered communication log contains undefined');
  const finalOrder = await base44.entities.Order.get(order.id);
  const finalTask = await base44.entities.FulfillmentTask.get(task.id);
  assert(finalOrder?.status === 'delivered' && finalTask?.status === 'delivered', 'final delivered state mismatch');
  evidence.stages.fulfillment = { assign: assign.data.status, pack: pack.data.status, out_for_delivery: ood.data.status, delivered: delivered.data.status, test_guard_rejected: true };
  evidence.communications.delivered = summarizeLogs(deliveredLogs);

  const allLogs = await base44.entities.CustomerMessageDeliveryLog.filter({ order_id: order.id }, '-created_date', 100);
  const duplicates = new Map();
  for (const row of allLogs) {
    const key = `${row?.metadata?.event || 'unknown'}:${row.channel}`;
    duplicates.set(key, (duplicates.get(key) || 0) + 1);
  }
  assert([...duplicates.entries()].every(([key, count]) => key.startsWith('unknown:') || count === 1), `duplicate communication attempts detected: ${JSON.stringify([...duplicates])}`);
  evidence.communication_deduplication = Object.fromEntries(duplicates);
  evidence.success = true;
} catch (error) {
  evidence.error = String(error?.message || error).slice(0, 800);
}

console.log(JSON.stringify(evidence, null, 2));
if (!evidence.success) throw new Error(evidence.error || 'G81 connected journey failed');
