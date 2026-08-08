const TEST_ORDER_NUMBER = 'G81-TEST-JOURNEY-20260807';
const TEST_TASK_ID = 'TASK-G81-TEST-20260807-CONNECTED';
const TEST_BATCH_IDS = [
  'BATCH-G81-TEST-20260807-AURA',
  'BATCH-G81-TEST-20260807-CONNECTED',
];
const CANCELED_CHECKOUT_ORDER_NUMBER = 'NV-MSJCR5NQ';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function rows(value) {
  return Array.isArray(value) ? value : (Array.isArray(value?.items) ? value.items : []);
}

async function find(entity, filter, limit = 50) {
  return rows(await base44.entities[entity].filter(filter, '-created_date', limit));
}

async function deleteRows(entity, records, predicate, summary) {
  for (const record of records) {
    assert(record?.id, `${entity} cleanup record is missing an id`);
    assert(predicate(record), `${entity} cleanup safety assertion failed for ${record.id}`);
    await base44.entities[entity].delete(record.id);
    summary[entity] = (summary[entity] || 0) + 1;
  }
}

const summary = {};

const testOrders = await find('Order', { order_number: TEST_ORDER_NUMBER }, 5);
assert(testOrders.length <= 1, 'test order lookup is ambiguous');
const testOrder = testOrders[0] || null;
if (testOrder) {
  assert(testOrder.is_test_order === true, 'test order marker is missing');
}

const tasks = await find('FulfillmentTask', { fulfillment_task_id: TEST_TASK_ID }, 5);
assert(tasks.length <= 1, 'test task lookup is ambiguous');
await deleteRows('FulfillmentTask', tasks, record => record.is_test_task === true, summary);

if (testOrder) {
  const notifications = await find('Notification', { order_id: testOrder.id }, 100);
  await deleteRows('Notification', notifications, record => record.order_id === testOrder.id, summary);
}

for (const batchId of TEST_BATCH_IDS) {
  const batches = await find('ProductionBatch', { batch_id: batchId }, 5);
  assert(batches.length <= 1, `test batch lookup is ambiguous for ${batchId}`);
  const batch = batches[0] || null;

  for (const entity of ['SanitationLog', 'DailyChecklist', 'TemperatureLog']) {
    const records = await find(entity, { batch_id: batchId }, 50);
    await deleteRows(entity, records, record => record.is_test_record === true && record.batch_id === batchId, summary);
  }

  const compliance = await find('BatchComplianceLog', { test_batch_id: batchId }, 50);
  await deleteRows('BatchComplianceLog', compliance, record => record.is_test_record === true && record.test_batch_id === batchId, summary);

  await deleteRows('ProductionBatch', batches, record => record.is_test_batch === true && record.batch_id === batchId, summary);
}

await deleteRows('Order', testOrders, record => record.is_test_order === true && record.order_number === TEST_ORDER_NUMBER, summary);

const canceledOrders = await find('Order', { order_number: CANCELED_CHECKOUT_ORDER_NUMBER }, 5);
assert(canceledOrders.length <= 1, 'canceled checkout lookup is ambiguous');
await deleteRows('Order', canceledOrders, record =>
  record.order_number === CANCELED_CHECKOUT_ORDER_NUMBER &&
  String(record.status || '').toLowerCase() === 'cancelled' &&
  record.payment_captured !== true &&
  record.do_not_recover === true,
summary);

const remaining = {
  test_orders: (await find('Order', { order_number: TEST_ORDER_NUMBER }, 5)).length,
  test_tasks: (await find('FulfillmentTask', { fulfillment_task_id: TEST_TASK_ID }, 5)).length,
  test_batches: 0,
  canceled_checkout_orders: (await find('Order', { order_number: CANCELED_CHECKOUT_ORDER_NUMBER }, 5)).length,
};
for (const batchId of TEST_BATCH_IDS) {
  remaining.test_batches += (await find('ProductionBatch', { batch_id: batchId }, 5)).length;
}

assert(Object.values(remaining).every(value => value === 0), `test cleanup incomplete: ${JSON.stringify(remaining)}`);
console.log(JSON.stringify({ success: true, deleted: summary, remaining }, null, 2));
