const ORDER_NUMBER = 'G81-TEST-JOURNEY-20260807';
const BATCH_ID = 'BATCH-G81-TEST-20260807-CONNECTED';
const TASK_ID = 'TASK-G81-TEST-20260807-CONNECTED';
const CONFIRMATION = 'execute_native_fulfillment_task_lifecycle';

function data(response) { return response?.data || response || {}; }
function assert(condition, message) { if (!condition) throw new Error(message); }
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function invoke(payload) {
  try {
    return {
      ok: true,
      data: data(await base44.functions.invoke('getAdminOperationsDashboardSummary', {
        gateway_action: 'executeNativeFulfillmentTaskLifecycle',
        payload,
      })),
    };
  }
  catch (error) { return { ok: false, status: error?.status || error?.response?.status || null, data: error?.response?.data || null, message: String(error?.message || error).slice(0, 240) }; }
}
async function action(name, requestId, extra = {}) {
  return await invoke({
    mode: 'live', confirmation: CONFIRMATION, fulfillment_task_id: TASK_ID,
    action: name, request_id: requestId, reason: `G81 connected ${name} resume`, ...extra,
  });
}
async function waitForEvent(orderId, event, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = (await base44.entities.CustomerMessageDeliveryLog.filter({ order_id: orderId }, '-created_date', 50))
      .filter((row) => row?.metadata?.event === event);
    if (rows.length > 0 && rows.every((row) => row.status !== 'prepared')) return rows;
    await delay(1500);
  }
  return (await base44.entities.CustomerMessageDeliveryLog.filter({ order_id: orderId }, '-created_date', 50))
    .filter((row) => row?.metadata?.event === event);
}
function summary(rows) { return rows.map((row) => ({ channel: row.channel, status: row.status, provider: row.provider, error: row.error_message || null })); }

const evidence = { success: false, order_number: ORDER_NUMBER, stages: {}, communications: {} };
try {
  const [orders, batches, tasks] = await Promise.all([
    base44.entities.Order.filter({ order_number: ORDER_NUMBER }, '-created_date', 5),
    base44.entities.ProductionBatch.filter({ batch_id: BATCH_ID }, '-created_date', 5),
    base44.entities.FulfillmentTask.filter({ fulfillment_task_id: TASK_ID }, '-created_date', 5),
  ]);
  assert(orders.length === 1 && batches.length === 1 && tasks.length === 1, 'connected test records missing or ambiguous');
  const order = orders[0];
  const batch = batches[0];
  const task = tasks[0];
  assert(order.is_test_order === true && batch.is_test_batch === true && task.is_test_task === true, 'formal test markers missing');
  assert(order.status === 'in_production' && batch.status === 'verified_logged' && task.status === 'assigned', 'resume state mismatch');

  const productionLogs = await waitForEvent(order.id, 'in_production', 5000);
  assert(productionLogs.length === 1 && productionLogs[0].channel === 'push', 'production push evidence mismatch');
  evidence.communications.in_production = summary(productionLogs);

  const pack = await action('pack', 'g81-connected-pack-20260807-v2');
  assert(pack.ok && pack.data?.status === 'packed', `pack failed: ${JSON.stringify(pack)}`);
  const packReplay = await action('pack', 'g81-connected-pack-20260807-v2');
  assert(packReplay.ok && packReplay.data?.idempotent && packReplay.data?.writes_performed === false, 'pack replay not idempotent');

  const forbidden = await action('out_for_delivery', 'g81-connected-ood-forbidden-20260807-v2', {
    update_customer_order_status: true, notify_customer: true,
  });
  assert(!forbidden.ok && forbidden.data?.error_code === 'test_task_customer_side_effects_forbidden', `test side-effect gate failed: ${JSON.stringify(forbidden)}`);

  const ood = await action('out_for_delivery', 'g81-connected-ood-20260807-v2', {
    update_customer_order_status: true, notify_customer: true, allow_internal_test_customer_side_effects: true,
  });
  assert(ood.ok && ood.data?.status === 'out_for_delivery' && ood.data?.customer_order_updated === true, `out for delivery failed: ${JSON.stringify(ood)}`);
  assert(ood.data?.customer_notification?.reason === 'order_status_entity_automation_triggered', 'delivery writer did not defer to single sender');
  const oodReplay = await action('out_for_delivery', 'g81-connected-ood-20260807-v2', {
    update_customer_order_status: true, notify_customer: true, allow_internal_test_customer_side_effects: true,
  });
  assert(oodReplay.ok && oodReplay.data?.idempotent && oodReplay.data?.writes_performed === false, 'out-for-delivery replay not idempotent');
  const oodLogs = await waitForEvent(order.id, 'out_for_delivery');
  assert(oodLogs.length >= 1, 'out-for-delivery communication missing');
  evidence.communications.out_for_delivery = summary(oodLogs);

  const delivered = await action('delivered_operational', 'g81-connected-delivered-20260807-v2', {
    update_customer_order_status: true, notify_customer: true, allow_internal_test_customer_side_effects: true,
    delivery_drop_location: 'Internal Test Completion', delivery_notes: 'G81 internal delivery proof test',
  });
  assert(delivered.ok && delivered.data?.status === 'delivered' && delivered.data?.customer_order_updated === true, `delivered failed: ${JSON.stringify(delivered)}`);
  const deliveredReplay = await action('delivered_operational', 'g81-connected-delivered-20260807-v2', {
    update_customer_order_status: true, notify_customer: true, allow_internal_test_customer_side_effects: true,
    delivery_drop_location: 'Internal Test Completion', delivery_notes: 'G81 internal delivery proof test',
  });
  assert(deliveredReplay.ok && deliveredReplay.data?.idempotent && deliveredReplay.data?.writes_performed === false, 'delivered replay not idempotent');
  const deliveredLogs = await waitForEvent(order.id, 'delivered');
  assert(deliveredLogs.some((row) => row.channel === 'email' && ['sent', 'delivered'].includes(row.status)), 'delivered email missing');
  assert(deliveredLogs.some((row) => row.channel === 'push'), 'delivered push attempt missing');
  assert(!JSON.stringify(deliveredLogs).toLowerCase().includes('undefined'), 'delivered logs contain undefined');
  evidence.communications.delivered = summary(deliveredLogs);

  const [finalOrder, finalTask, allLogs] = await Promise.all([
    base44.entities.Order.get(order.id),
    base44.entities.FulfillmentTask.get(task.id),
    base44.entities.CustomerMessageDeliveryLog.filter({ order_id: order.id }, '-created_date', 100),
  ]);
  assert(finalOrder?.status === 'delivered' && finalTask?.status === 'delivered', 'final delivered projection mismatch');
  const counts = new Map();
  for (const row of allLogs) {
    const event = row?.metadata?.event;
    if (!event) continue;
    const key = `${event}:${row.channel}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  assert([...counts.values()].every((count) => count === 1), `duplicate communication records: ${JSON.stringify([...counts])}`);
  evidence.communication_deduplication = Object.fromEntries(counts);
  evidence.stages = { pack: 'passed', out_for_delivery: 'passed', delivered: 'passed', idempotent_replays: 'passed', test_isolation_gate: 'passed' };
  evidence.success = true;
} catch (error) {
  evidence.error = String(error?.message || error).slice(0, 800);
}
console.log(JSON.stringify(evidence, null, 2));
if (!evidence.success) throw new Error(evidence.error || 'G81 connected journey resume failed');
