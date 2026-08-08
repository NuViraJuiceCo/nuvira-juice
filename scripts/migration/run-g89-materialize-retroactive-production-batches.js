const EXPECTED_OPERATOR = 'info@nuvirajuice.com';
const EXPECTED_ORDER_NUMBER = 'NV-MSHGPOQ8';
const EXPECTED_ORDER_ID = '6a7476e9c53347407b8f2743';
const PRODUCTION_DATE = '2026-08-07';
const REQUIRED_CONFIRMATION = 'materialize_g89_retroactive_delivered_batches_without_customer_projection';
const suppliedConfirmation = typeof process !== 'undefined'
  ? process.env.G89_CONFIRMATION
  : '';

const BATCHES = [
  {
    batch_id: 'BATCH-20260807-ORANGEJU',
    product_name: 'Orange Juice',
    source_hub_batch_id: '6a74772f9b46389e0e5b9c30',
  },
  {
    batch_id: 'BATCH-20260807-PINEAPPL',
    product_name: 'Pineapple Juice',
    source_hub_batch_id: '6a74772f0013d60fdd21684c',
  },
  {
    batch_id: 'BATCH-20260807-RE-NU',
    product_name: 'Re-Nu',
    source_hub_batch_id: '6a74772fc7dd64cd9034aa61',
  },
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function snapshotOrder(order) {
  return JSON.stringify({
    id: order?.id,
    status: order?.status,
    production_status: order?.production_status,
    fulfillment_status: order?.fulfillment_status,
    delivery_status: order?.delivery_status,
    delivered_at: order?.delivered_at,
    payment_status: order?.payment_status,
    payment_captured: order?.payment_captured,
    status_history: order?.status_history,
  });
}

function snapshotTask(task) {
  return JSON.stringify({
    id: task?.id,
    status: task?.status,
    production_status: task?.production_status,
    fulfillment_status: task?.fulfillment_status,
    delivery_status: task?.delivery_status,
    delivered_at: task?.delivered_at,
  });
}

assert(suppliedConfirmation === REQUIRED_CONFIRMATION, 'Exact G89 confirmation is required.');

const operator = await base44.auth.me();
assert(operator?.role === 'admin', 'G89 materialization requires an authenticated admin.');
assert((operator?.email || '').toLowerCase() === EXPECTED_OPERATOR, 'Unexpected G89 operator.');

const orders = await base44.entities.Order.filter({ order_number: EXPECTED_ORDER_NUMBER }, '-created_date', 5);
assert(Array.isArray(orders) && orders.length === 1, 'Expected exactly one Customer App order.');
const order = orders[0];
assert(order.id === EXPECTED_ORDER_ID, 'Customer App order identity mismatch.');
assert((order.status || '').toLowerCase() === 'delivered', 'Order must remain delivered before retroactive materialization.');
assert((order.payment_status || '').toLowerCase() === 'paid' && order.payment_captured === true, 'Order payment state mismatch.');

const tasks = await base44.entities.FulfillmentTask.filter({ base44_order_id: EXPECTED_ORDER_ID }, '-created_date', 10);
const deliveredTasks = tasks.filter(task => (task.status || '').toLowerCase() === 'delivered' || (task.delivery_status || '').toLowerCase() === 'delivered');
assert(deliveredTasks.length >= 1, 'A delivered fulfillment task is required.');

const orderBefore = snapshotOrder(order);
const taskBefore = deliveredTasks.map(snapshotTask);
const deliveryLogsBefore = await base44.entities.CustomerMessageDeliveryLog.filter({ order_id: EXPECTED_ORDER_ID }, '-created_date', 200);
const created = [];
const skipped = [];

for (const definition of BATCHES) {
  const existing = await base44.entities.ProductionBatch.filter({ batch_id: definition.batch_id }, '-created_date', 5);
  if (existing.length > 0) {
    assert(existing.length === 1, `Duplicate native ProductionBatch rows exist for ${definition.batch_id}.`);
    const row = existing[0];
    assert(row.source_hub_batch_id === definition.source_hub_batch_id, `Existing ${definition.batch_id} has unexpected Hub provenance.`);
    assert(row.native_owner_status === 'native_owned_retroactive_delivered_no_customer_projection', `Existing ${definition.batch_id} lacks notification suppression provenance.`);
    skipped.push({ batch_id: definition.batch_id, production_batch_id: row.id, reason: 'already_materialized' });
    continue;
  }

  const now = new Date().toISOString();
  const row = await base44.entities.ProductionBatch.create({
    batch_id: definition.batch_id,
    product_name: definition.product_name,
    product_category: 'juice',
    status: 'planned',
    planned_units: 1,
    production_date: PRODUCTION_DATE,
    assigned_to: 'Amar Kahlon',
    notes: 'Retroactive Customer App production record for product already delivered. Customer order projection and customer notifications are suppressed.',
    is_test_batch: false,
    is_locked: false,
    order_sources: [{
      order_id: EXPECTED_ORDER_ID,
      order_number: EXPECTED_ORDER_NUMBER,
      quantity: 1,
      source_type: 'direct',
      source_item: definition.product_name,
    }],
    related_orders: [EXPECTED_ORDER_ID],
    source_system: 'legacy_hub_mirror',
    source_hub_batch_id: definition.source_hub_batch_id,
    native_owner_status: 'native_owned_retroactive_delivered_no_customer_projection',
    procurement_needed: false,
    inventory_deduction_status: 'not_applicable_make_to_order',
    audit_trail: [{
      timestamp: now,
      action: 'native_cutover_materialized',
      performed_by: EXPECTED_OPERATOR,
      reason: 'Exact legacy Hub batch mirrored into Customer App after physical delivery; no customer projection or notification.',
      request_id: `g89-materialize-${definition.batch_id.toLowerCase()}`,
    }],
  });
  assert(row?.id && row.batch_id === definition.batch_id, `Failed to create ${definition.batch_id}.`);
  created.push({ batch_id: row.batch_id, production_batch_id: row.id, status: row.status });
}

for (const definition of BATCHES) {
  const rows = await base44.entities.ProductionBatch.filter({ batch_id: definition.batch_id }, '-created_date', 5);
  assert(rows.length === 1, `Expected one native row for ${definition.batch_id}.`);
  assert(rows[0].status === 'planned', `${definition.batch_id} must remain planned for operator completion.`);
  assert(rows[0].native_owner_status === 'native_owned_retroactive_delivered_no_customer_projection', `${definition.batch_id} notification suppression marker mismatch.`);
}

const orderAfter = await base44.entities.Order.get(EXPECTED_ORDER_ID);
const tasksAfter = await base44.entities.FulfillmentTask.filter({ base44_order_id: EXPECTED_ORDER_ID }, '-created_date', 10);
const deliveryLogsAfter = await base44.entities.CustomerMessageDeliveryLog.filter({ order_id: EXPECTED_ORDER_ID }, '-created_date', 200);
assert(snapshotOrder(orderAfter) === orderBefore, 'Customer order changed during batch materialization.');
assert(JSON.stringify(tasksAfter.filter(task => deliveredTasks.some(before => before.id === task.id)).map(snapshotTask)) === JSON.stringify(taskBefore), 'Fulfillment task changed during batch materialization.');
assert(deliveryLogsAfter.length === deliveryLogsBefore.length, 'Customer communication log count changed during batch materialization.');

console.log(JSON.stringify({
  success: true,
  classification: 'g89_retroactive_native_production_batches_materialized',
  order_number: EXPECTED_ORDER_NUMBER,
  production_date: PRODUCTION_DATE,
  created,
  skipped,
  customer_order_changed: false,
  fulfillment_task_changed: false,
  customer_notifications_sent: false,
  provider_calls_performed: false,
  inventory_mutations_performed: false,
  hub_mutations_performed: false,
}, null, 2));
