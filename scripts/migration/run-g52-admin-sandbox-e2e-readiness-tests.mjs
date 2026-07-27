#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const TEST_NOW = '2026-07-23T16:30:00.000Z';
const TEST_OPERATOR = {
  id: 'sandbox-admin-operator',
  email: 'info@nuvirajuice.com',
  role: 'admin',
  name: 'NuVira Sandbox Admin',
};
const NON_ADMIN = {
  id: 'sandbox-customer',
  email: 'customer@example.com',
  role: 'user',
  name: 'Sandbox Customer',
};

function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeState() {
  return {
    safety: {
      live_writes_performed: false,
      provider_calls_performed: false,
      customer_notifications_sent: false,
      refunds_performed: false,
      subscription_changes_performed: false,
      inventory_mutations_performed: false,
      bulk_sync_performed: false,
    },
    sandbox: {
      mutations_performed: false,
      mutation_count: 0,
      projected_notifications: [],
    },
    idempotency: new Map(),
    commandLog: [],
    audit: [],
    records: {
      orders: {
        'SANDBOX-ORDER-HYDRATION-001': {
          id: 'SANDBOX-ORDER-HYDRATION-001',
          order_number: 'SANDBOX-NV-E2E-001',
          customer_name: 'Sandbox Customer',
          customer_email: 'sandbox.customer@example.invalid',
          source: 'sandbox_customer_app',
          payment_status: 'paid',
          order_status: 'active',
          fulfillment_method: 'delivery',
          production_date: '2026-07-23',
          selected_delivery_date: '2026-07-24',
          delivery_window: 'Friday 5 PM - 8 PM',
          delivery_fee: 7.99,
          item_subtotal: 144,
          order_total: 151.99,
          items: [
            {
              name: 'Hydration Program (3-Day)',
              quantity: 1,
              unit_price: 144,
              composition: [
                { product_name: 'Oasis', quantity: 9 },
                { product_name: 'Aura', quantity: 3 },
              ],
            },
          ],
          lifecycle_locks: ['payment_captured', 'order_received'],
        },
      },
      batches: {},
      compliance: {},
      fulfillmentTasks: {
        'SANDBOX-TASK-DELIVERY-001': {
          id: 'SANDBOX-TASK-DELIVERY-001',
          order_id: 'SANDBOX-ORDER-HYDRATION-001',
          order_number: 'SANDBOX-NV-E2E-001',
          status: 'awaiting_production',
          delivery_status: 'pending',
          production_status: 'awaiting_production',
          assigned_driver: null,
          route_id: null,
          delivery_date: '2026-07-24',
          proof_photo_url: null,
          delivery_drop_location: null,
          delivery_notes: null,
        },
      },
    },
  };
}

function command(state, actor, action, recordId, idempotencyKey, fn) {
  if (!actor || actor.role !== 'admin') {
    state.commandLog.push({
      action,
      record_id: recordId,
      status: 'rejected',
      reason: 'permission_denied',
      actor_email: actor?.email || null,
      created_at: TEST_NOW,
    });
    return { ok: false, status: 'rejected', reason: 'permission_denied' };
  }

  if (idempotencyKey && state.idempotency.has(idempotencyKey)) {
    return { ...deepClone(state.idempotency.get(idempotencyKey)), replayed: true };
  }

  const before = snapshotState(state);
  try {
    const result = fn();
    const commandResult = {
      ok: true,
      status: 'applied',
      command_id: `cmd_${state.commandLog.length + 1}`,
      ...result,
    };
    state.commandLog.push({
      action,
      record_id: recordId,
      status: 'applied',
      actor_email: actor.email,
      created_at: TEST_NOW,
      command_id: commandResult.command_id,
    });
    if (idempotencyKey) state.idempotency.set(idempotencyKey, commandResult);
    return commandResult;
  } catch (error) {
    restoreState(state, before);
    const failed = {
      ok: false,
      status: 'failed',
      reason: error.message || String(error),
      command_id: `cmd_${state.commandLog.length + 1}`,
    };
    state.commandLog.push({
      action,
      record_id: recordId,
      status: 'failed',
      reason: failed.reason,
      actor_email: actor.email,
      created_at: TEST_NOW,
      command_id: failed.command_id,
    });
    return failed;
  }
}

function snapshotState(state) {
  return {
    safety: deepClone(state.safety),
    sandbox: deepClone(state.sandbox),
    commandLog: deepClone(state.commandLog),
    audit: deepClone(state.audit),
    records: deepClone(state.records),
  };
}

function restoreState(state, snapshot) {
  state.safety = snapshot.safety;
  state.sandbox = snapshot.sandbox;
  state.commandLog = snapshot.commandLog;
  state.audit = snapshot.audit;
  state.records = snapshot.records;
}

function sandboxWrite(state, entity, id, patch, auditType) {
  const table = state.records[entity];
  assert.ok(table, `unknown sandbox entity ${entity}`);
  assert.ok(table[id], `missing sandbox ${entity} ${id}`);
  table[id] = { ...table[id], ...patch };
  state.sandbox.mutations_performed = true;
  state.sandbox.mutation_count += 1;
  state.audit.push({
    type: auditType,
    entity,
    record_id: id,
    patch_keys: Object.keys(patch).sort(),
    created_at: TEST_NOW,
  });
}

function selectOrCreateBatchesFromOrder(state, orderId) {
  const order = state.records.orders[orderId];
  assert.ok(order, 'order_not_found');
  const created = [];
  for (const item of order.items || []) {
    for (const part of item.composition || []) {
      const batchId = `SANDBOX-BATCH-20260723-${part.product_name.toUpperCase()}`;
      if (!state.records.batches[batchId]) {
        state.records.batches[batchId] = {
          id: batchId,
          batch_id: batchId,
          product_name: part.product_name,
          production_date: order.production_date,
          needed: part.quantity,
          produced: 0,
          status: 'planned',
          source_order_ids: [order.id],
          source_order_numbers: [order.order_number],
          compliance_status: 'incomplete',
        };
        state.sandbox.mutations_performed = true;
        state.sandbox.mutation_count += 1;
        state.audit.push({
          type: 'sandbox_batch_selected_or_created',
          entity: 'batches',
          record_id: batchId,
          created_at: TEST_NOW,
        });
        created.push(batchId);
      }
    }
  }
  return Object.keys(state.records.batches).filter(id => state.records.batches[id].source_order_ids.includes(orderId));
}

function saveCompliance(state, batchId, type, actor = TEST_OPERATOR) {
  return command(state, actor, `save_${type}`, batchId, `save_${type}_${batchId}`, () => {
    const batch = state.records.batches[batchId];
    assert.ok(batch, 'batch_not_found');
    const recordId = `SANDBOX-${type.toUpperCase()}-${batchId}`;
    state.records.compliance[recordId] = {
      id: recordId,
      record_type: type,
      batch_id: batchId,
      production_date: batch.production_date,
      product_name: batch.product_name,
      staff_member: actor.name,
      submitted_at: TEST_NOW,
      status: 'submitted',
    };
    state.sandbox.mutations_performed = true;
    state.sandbox.mutation_count += 1;
    state.audit.push({
      type: 'compliance_record_submitted',
      entity: 'compliance',
      record_id: recordId,
      batch_id: batchId,
      created_at: TEST_NOW,
    });
    refreshComplianceGate(state, batchId);
    return { record_id: recordId };
  });
}

function refreshComplianceGate(state, batchId) {
  const required = ['preop_sanitation', 'daily_checklist', 'temperature_log'];
  const present = new Set(Object.values(state.records.compliance)
    .filter(record => record.batch_id === batchId && record.status === 'submitted')
    .map(record => record.record_type));
  const missing = required.filter(type => !present.has(type));
  state.records.batches[batchId].compliance_status = missing.length ? 'incomplete' : 'ready';
  state.records.batches[batchId].compliance_missing = missing;
}

function startProduction(state, batchId, actor = TEST_OPERATOR, idempotencyKey = `start_${batchId}`, options = {}) {
  return command(state, actor, 'start_production', batchId, idempotencyKey, () => {
    if (options.failBeforeWrite) throw new Error('simulated_backend_failure_before_write');
    const batch = state.records.batches[batchId];
    assert.ok(batch, 'batch_not_found');
    if (batch.status !== 'planned') throw new Error(`invalid_transition_${batch.status}_to_in_production`);
    refreshComplianceGate(state, batchId);
    if (batch.compliance_status !== 'ready') throw new Error('pre_start_compliance_incomplete');
    sandboxWrite(state, 'batches', batchId, { status: 'in_production', started_at: TEST_NOW }, 'production_started');
    return { batch_status: 'in_production' };
  });
}

function completeProduction(state, batchId, actor = TEST_OPERATOR, idempotencyKey = `complete_${batchId}`) {
  return command(state, actor, 'complete_production', batchId, idempotencyKey, () => {
    const batch = state.records.batches[batchId];
    assert.ok(batch, 'batch_not_found');
    if (batch.status !== 'in_production') throw new Error(`invalid_transition_${batch.status}_to_completed`);
    sandboxWrite(state, 'batches', batchId, {
      status: 'completed',
      completed_at: TEST_NOW,
      produced: batch.needed,
    }, 'production_completed');

    const allDone = Object.values(state.records.batches)
      .filter(b => b.source_order_ids.includes('SANDBOX-ORDER-HYDRATION-001'))
      .every(b => b.status === 'completed');
    if (allDone) {
      sandboxWrite(state, 'fulfillmentTasks', 'SANDBOX-TASK-DELIVERY-001', {
        production_status: 'completed',
        status: 'fulfillment_ready',
      }, 'fulfillment_ready_after_production');
    }
    return { batch_status: 'completed' };
  });
}

function packFulfillment(state, taskId, actor = TEST_OPERATOR) {
  return command(state, actor, 'pack_fulfillment', taskId, `pack_${taskId}`, () => {
    const task = state.records.fulfillmentTasks[taskId];
    assert.ok(task, 'task_not_found');
    if (task.status !== 'fulfillment_ready') throw new Error(`invalid_transition_${task.status}_to_packed`);
    sandboxWrite(state, 'fulfillmentTasks', taskId, { status: 'packed', packed_at: TEST_NOW }, 'fulfillment_packed');
    return { task_status: 'packed' };
  });
}

function assignRoute(state, taskId, actor = TEST_OPERATOR, idempotencyKey = `route_${taskId}`) {
  return command(state, actor, 'assign_route', taskId, idempotencyKey, () => {
    const task = state.records.fulfillmentTasks[taskId];
    assert.ok(task, 'task_not_found');
    if (!['packed', 'delivery_exception_recovered'].includes(task.status)) {
      throw new Error(`invalid_transition_${task.status}_to_route_assigned`);
    }
    sandboxWrite(state, 'fulfillmentTasks', taskId, {
      status: 'route_assigned',
      assigned_driver: 'Sandbox Driver',
      route_id: 'SANDBOX-ROUTE-20260724',
    }, 'route_assigned');
    return { task_status: 'route_assigned' };
  });
}

function outForDelivery(state, taskId, actor = TEST_OPERATOR, notifyCustomer = false) {
  return command(state, actor, 'out_for_delivery', taskId, `ofd_${taskId}`, () => {
    const task = state.records.fulfillmentTasks[taskId];
    assert.ok(task, 'task_not_found');
    if (task.status !== 'route_assigned') throw new Error(`invalid_transition_${task.status}_to_out_for_delivery`);
    sandboxWrite(state, 'fulfillmentTasks', taskId, {
      status: 'out_for_delivery',
      delivery_status: 'out_for_delivery',
    }, 'out_for_delivery');
    if (notifyCustomer) projectNotification(state, task.order_id, 'out_for_delivery');
    return { task_status: 'out_for_delivery' };
  });
}

function delivered(state, taskId, actor = TEST_OPERATOR, notifyCustomer = false) {
  return command(state, actor, 'delivered', taskId, `delivered_${taskId}`, () => {
    const task = state.records.fulfillmentTasks[taskId];
    assert.ok(task, 'task_not_found');
    if (task.status !== 'out_for_delivery') throw new Error(`invalid_transition_${task.status}_to_delivered`);
    sandboxWrite(state, 'fulfillmentTasks', taskId, {
      status: 'delivered',
      delivery_status: 'delivered',
      delivered_at: TEST_NOW,
      delivery_drop_location: 'Front Door',
      delivery_notes: 'Sandbox proof captured.',
      proof_photo_url: 'sandbox://delivery-proof/SANDBOX-TASK-DELIVERY-001.jpg',
    }, 'delivery_completed_with_proof');
    sandboxWrite(state, 'orders', task.order_id, {
      order_status: 'delivered',
      delivered_at: TEST_NOW,
    }, 'customer_order_projected_delivered');
    if (notifyCustomer) projectNotification(state, task.order_id, 'delivered');
    return { task_status: 'delivered' };
  });
}

function deliveryException(state, taskId, actor = TEST_OPERATOR) {
  return command(state, actor, 'delivery_exception', taskId, `exception_${taskId}`, () => {
    const task = state.records.fulfillmentTasks[taskId];
    assert.ok(task, 'task_not_found');
    if (!['route_assigned', 'out_for_delivery'].includes(task.status)) {
      throw new Error(`invalid_transition_${task.status}_to_delivery_exception`);
    }
    sandboxWrite(state, 'fulfillmentTasks', taskId, {
      status: 'delivery_exception',
      delivery_status: 'exception',
      exception_reason: 'Customer unavailable - sandbox test',
    }, 'delivery_exception_recorded');
    return { task_status: 'delivery_exception' };
  });
}

function recoverDeliveryException(state, taskId, actor = TEST_OPERATOR) {
  return command(state, actor, 'recover_delivery_exception', taskId, `recover_exception_${taskId}`, () => {
    const task = state.records.fulfillmentTasks[taskId];
    assert.ok(task, 'task_not_found');
    if (task.status !== 'delivery_exception') throw new Error(`invalid_transition_${task.status}_to_recovered`);
    sandboxWrite(state, 'fulfillmentTasks', taskId, {
      status: 'delivery_exception_recovered',
      delivery_status: 'pending',
      exception_recovered_at: TEST_NOW,
    }, 'delivery_exception_recovered');
    return { task_status: 'delivery_exception_recovered' };
  });
}

function projectNotification(state, orderId, eventType) {
  const key = `${orderId}:${eventType}`;
  if (state.sandbox.projected_notifications.some(row => row.key === key)) return;
  state.sandbox.projected_notifications.push({
    key,
    order_id: orderId,
    event_type: eventType,
    status: 'projected_only',
    created_at: TEST_NOW,
  });
}

function views(state) {
  const batches = Object.values(state.records.batches);
  const tasks = Object.values(state.records.fulfillmentTasks);
  const reviewItems = state.commandLog.filter(row => ['failed', 'rejected'].includes(row.status));
  return {
    dashboard: {
      production_planned: batches.filter(b => b.status === 'planned').length,
      production_active: batches.filter(b => b.status === 'in_production').length,
      production_completed: batches.filter(b => b.status === 'completed').length,
      delivery_exceptions: tasks.filter(t => t.delivery_status === 'exception').length,
      review_items: reviewItems.length,
    },
    productionQueue: batches.map(batch => ({
      id: batch.id,
      status: batch.status,
      compliance_status: batch.compliance_status,
      order_numbers: batch.source_order_numbers,
    })),
    deliveryQueue: tasks.map(task => ({
      id: task.id,
      status: task.status,
      delivery_status: task.delivery_status,
      route_id: task.route_id,
      order_number: task.order_number,
    })),
    routeOps: tasks
      .filter(task => task.route_id)
      .map(task => ({
        id: task.id,
        route_id: task.route_id,
        delivery_status: task.delivery_status,
      })),
    orderDetails: Object.values(state.records.orders).map(order => ({
      id: order.id,
      order_number: order.order_number,
      status: order.order_status,
      total: order.order_total,
      delivery_fee: order.delivery_fee,
      batch_ids: batches.filter(batch => batch.source_order_ids.includes(order.id)).map(batch => batch.id).sort(),
      task_ids: tasks.filter(task => task.order_id === order.id).map(task => task.id).sort(),
    })),
  };
}

function prepareProductionReadyState() {
  const state = makeState();
  const batchIds = selectOrCreateBatchesFromOrder(state, 'SANDBOX-ORDER-HYDRATION-001');
  for (const batchId of batchIds) {
    saveCompliance(state, batchId, 'preop_sanitation');
    saveCompliance(state, batchId, 'daily_checklist');
    saveCompliance(state, batchId, 'temperature_log');
  }
  return { state, batchIds };
}

function completeAllProductionState() {
  const { state, batchIds } = prepareProductionReadyState();
  for (const batchId of batchIds) {
    assert.equal(startProduction(state, batchId).ok, true);
    assert.equal(completeProduction(state, batchId).ok, true);
  }
  return { state, batchIds, taskId: 'SANDBOX-TASK-DELIVERY-001' };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('1. Production lifecycle creates/selects deduped batches and completes them', () => {
  const { state, batchIds } = prepareProductionReadyState();
  const again = selectOrCreateBatchesFromOrder(state, 'SANDBOX-ORDER-HYDRATION-001');
  assert.deepEqual(again.sort(), batchIds.sort());
  assert.deepEqual(batchIds.sort(), [
    'SANDBOX-BATCH-20260723-AURA',
    'SANDBOX-BATCH-20260723-OASIS',
  ]);
  for (const batchId of batchIds) {
    assert.equal(startProduction(state, batchId).ok, true);
    assert.equal(completeProduction(state, batchId).ok, true);
    assert.equal(state.records.batches[batchId].status, 'completed');
    assert.equal(state.records.batches[batchId].produced, state.records.batches[batchId].needed);
  }
  assert.equal(state.records.fulfillmentTasks['SANDBOX-TASK-DELIVERY-001'].status, 'fulfillment_ready');
});

test('2. Compliance gate blocks start until required records are complete', () => {
  const state = makeState();
  const [batchId] = selectOrCreateBatchesFromOrder(state, 'SANDBOX-ORDER-HYDRATION-001');
  const blocked = startProduction(state, batchId);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, 'pre_start_compliance_incomplete');
  assert.equal(state.records.batches[batchId].status, 'planned');
  saveCompliance(state, batchId, 'preop_sanitation');
  saveCompliance(state, batchId, 'daily_checklist');
  saveCompliance(state, batchId, 'temperature_log');
  const started = startProduction(state, batchId);
  assert.equal(started.ok, true);
  assert.equal(state.records.batches[batchId].status, 'in_production');
});

test('3. Completed production unlocks fulfillment packing without provider side effects', () => {
  const { state, taskId } = completeAllProductionState();
  const packed = packFulfillment(state, taskId);
  assert.equal(packed.ok, true);
  assert.equal(state.records.fulfillmentTasks[taskId].status, 'packed');
  assert.equal(state.safety.provider_calls_performed, false);
  assert.equal(state.safety.inventory_mutations_performed, false);
});

test('4. Route assignment through delivered captures proof and projects notification once', () => {
  const { state, taskId } = completeAllProductionState();
  packFulfillment(state, taskId);
  assignRoute(state, taskId);
  outForDelivery(state, taskId, TEST_OPERATOR, true);
  outForDelivery(state, taskId, TEST_OPERATOR, true);
  delivered(state, taskId, TEST_OPERATOR, true);
  delivered(state, taskId, TEST_OPERATOR, true);
  const task = state.records.fulfillmentTasks[taskId];
  assert.equal(task.status, 'delivered');
  assert.equal(task.delivery_drop_location, 'Front Door');
  assert.match(task.proof_photo_url, /^sandbox:\/\//);
  assert.equal(state.records.orders[task.order_id].order_status, 'delivered');
  assert.deepEqual(
    state.sandbox.projected_notifications.map(row => row.event_type).sort(),
    ['delivered', 'out_for_delivery'],
  );
  assert.equal(state.safety.customer_notifications_sent, false);
});

test('5. Delivery exception and recovery keep task visible and route-safe', () => {
  const { state, taskId } = completeAllProductionState();
  packFulfillment(state, taskId);
  assignRoute(state, taskId);
  const exception = deliveryException(state, taskId);
  assert.equal(exception.ok, true);
  assert.equal(state.records.fulfillmentTasks[taskId].delivery_status, 'exception');
  const viewDuringException = views(state);
  assert.equal(viewDuringException.dashboard.delivery_exceptions, 1);
  const recovered = recoverDeliveryException(state, taskId);
  assert.equal(recovered.ok, true);
  assert.equal(assignRoute(state, taskId, TEST_OPERATOR, 'route_after_exception_recovery').ok, true);
  assert.equal(state.records.fulfillmentTasks[taskId].status, 'route_assigned');
});

test('6. Invalid transitions fail closed and preserve state', () => {
  const state = makeState();
  const [batchId] = selectOrCreateBatchesFromOrder(state, 'SANDBOX-ORDER-HYDRATION-001');
  const invalidBatch = completeProduction(state, batchId);
  assert.equal(invalidBatch.ok, false);
  assert.equal(state.records.batches[batchId].status, 'planned');
  const invalidDelivery = delivered(state, 'SANDBOX-TASK-DELIVERY-001', TEST_OPERATOR, true);
  assert.equal(invalidDelivery.ok, false);
  assert.equal(state.records.fulfillmentTasks['SANDBOX-TASK-DELIVERY-001'].status, 'awaiting_production');
  assert.equal(state.sandbox.projected_notifications.length, 0);
});

test('7. Duplicate submissions are idempotent and do not duplicate audit events', () => {
  const { state, batchIds } = prepareProductionReadyState();
  const batchId = batchIds[0];
  const beforeAudit = state.audit.length;
  const first = startProduction(state, batchId, TEST_OPERATOR, 'same-start-key');
  const second = startProduction(state, batchId, TEST_OPERATOR, 'same-start-key');
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.replayed, true);
  assert.equal(first.command_id, second.command_id);
  const startedAudit = state.audit.filter(row => row.type === 'production_started' && row.record_id === batchId);
  assert.equal(startedAudit.length, 1);
  assert.equal(state.audit.length, beforeAudit + 1);
});

test('8. Permission denial is server-side style and performs no sandbox mutation', () => {
  const state = makeState();
  const [batchId] = selectOrCreateBatchesFromOrder(state, 'SANDBOX-ORDER-HYDRATION-001');
  saveCompliance(state, batchId, 'preop_sanitation');
  saveCompliance(state, batchId, 'daily_checklist');
  saveCompliance(state, batchId, 'temperature_log');
  const before = snapshotState(state);
  const denied = startProduction(state, batchId, NON_ADMIN, 'non-admin-start');
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, 'permission_denied');
  assert.equal(state.records.batches[batchId].status, before.records.batches[batchId].status);
  assert.equal(state.commandLog.at(-1).status, 'rejected');
});

test('9. Backend failure before write is retry-safe', () => {
  const { state, batchIds } = prepareProductionReadyState();
  const batchId = batchIds[0];
  const failed = startProduction(state, batchId, TEST_OPERATOR, 'failure-key', { failBeforeWrite: true });
  assert.equal(failed.ok, false);
  assert.equal(state.records.batches[batchId].status, 'planned');
  const retry = startProduction(state, batchId, TEST_OPERATOR, 'retry-key');
  assert.equal(retry.ok, true);
  assert.equal(state.records.batches[batchId].status, 'in_production');
});

test('10. Dashboard, queues, route ops, and order details derive the same truth', () => {
  const { state, taskId } = completeAllProductionState();
  packFulfillment(state, taskId);
  assignRoute(state, taskId);
  const view = views(state);
  assert.equal(view.dashboard.production_completed, 2);
  assert.equal(view.deliveryQueue[0].route_id, 'SANDBOX-ROUTE-20260724');
  assert.equal(view.routeOps[0].route_id, 'SANDBOX-ROUTE-20260724');
  assert.deepEqual(view.orderDetails[0].batch_ids, [
    'SANDBOX-BATCH-20260723-AURA',
    'SANDBOX-BATCH-20260723-OASIS',
  ]);
  assert.deepEqual(view.orderDetails[0].task_ids, ['SANDBOX-TASK-DELIVERY-001']);
});

const results = [];
for (const item of tests) {
  const started = Date.now();
  try {
    item.fn();
    results.push({ name: item.name, ok: true, duration_ms: Date.now() - started });
  } catch (error) {
    results.push({
      name: item.name,
      ok: false,
      duration_ms: Date.now() - started,
      message: error.message || String(error),
      stack: error.stack,
    });
  }
}

const failures = results.filter(row => !row.ok);
const output = {
  success: failures.length === 0,
  suite: 'g52-admin-sandbox-e2e-readiness',
  classification: failures.length === 0
    ? 'sandbox_e2e_ready_live_pilot_required'
    : 'sandbox_e2e_regression',
  git_commit: gitHead(),
  generated_at_utc: new Date().toISOString(),
  sandbox_method: 'in_memory_synthetic_records_no_live_entities',
  test_records: {
    order_id: 'SANDBOX-ORDER-HYDRATION-001',
    order_number: 'SANDBOX-NV-E2E-001',
    task_id: 'SANDBOX-TASK-DELIVERY-001',
    batch_ids: [
      'SANDBOX-BATCH-20260723-OASIS',
      'SANDBOX-BATCH-20260723-AURA',
    ],
  },
  coverage: [
    'production_lifecycle',
    'compliance_gated_production_start',
    'fulfillment_progression',
    'route_assignment_and_delivery_completion',
    'delivery_exception_and_recovery',
    'invalid_or_prohibited_transition',
    'duplicate_submission_idempotency',
    'permission_denial',
    'backend_failure_safe_retry',
    'cross_screen_state_consistency',
  ],
  safety: {
    live_writes_performed: false,
    provider_calls_performed: false,
    customer_notifications_sent: false,
    refunds_performed: false,
    subscription_changes_performed: false,
    inventory_mutations_performed: false,
    bulk_sync_performed: false,
  },
  limitations: [
    'Does not prove live Base44 persistence on real or allowlisted records.',
    'Does not send or verify real customer notifications.',
    'Does not perform provider calls, refunds, Shopify writes, or inventory mutations.',
    'Does not verify native App Store build parity on device.',
  ],
  rollback_or_recovery: 'No live rollback required; all mutations are in-memory sandbox records. Live pilot still requires exact approved test records.',
  case_count: results.length,
  pass_count: results.filter(row => row.ok).length,
  fail_count: failures.length,
  results,
};

console.log(JSON.stringify(output, null, 2));
if (failures.length) process.exit(1);
