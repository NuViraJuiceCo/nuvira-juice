#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadExports(relativePath, exportNames) {
  const functionPath = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(functionPath, 'utf8').replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { ${exportNames.join(', ')} };\n`;
  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Date,
    Intl,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    JSON,
    Error,
    Response,
    Promise,
    createClientFromRequest: req => req.__base44,
    fetch: async () => new Response('{}', { status: 200 }),
    Deno: {
      env: { get: () => '' },
      serve: handler => {
        context.globalThis.__handler = handler;
      },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__exports;
}

const results = [];

{
  const { planDeliveredTaskReconciliation } = loadExports(
    'base44/functions/syncHubDeliveryStatuses/entry.ts',
    ['planDeliveredTaskReconciliation'],
  );
  const order = {
    id: 'order_current',
    order_number: 'NV-CURRENT',
    assigned_delivery_date: '2026-08-05',
    delivered_at: '2026-08-05T23:38:28.061Z',
  };
  const deliveredTask = {
    id: 'task_aug_5',
    order_id: order.id,
    order_number: order.order_number,
    delivery_date: '2026-08-05',
    status: 'delivered',
    delivery_status: 'delivered',
  };
  const futureTask = {
    id: 'task_aug_8',
    order_id: order.id,
    order_number: order.order_number,
    delivery_date: '2026-08-08',
    status: 'scheduled',
    delivery_status: 'pending',
  };

  const alreadyDelivered = planDeliveredTaskReconciliation({
    tasks: [deliveredTask, futureTask],
    order,
    hubOrder: order,
  });
  assert.equal(alreadyDelivered.task, null);
  assert.equal(alreadyDelivered.reason, 'no_exact_fulfillment_occurrence_match');
  assert.equal(alreadyDelivered.remaining_nonterminal_task_count, 1);

  const bothPending = planDeliveredTaskReconciliation({
    tasks: [{ ...deliveredTask, status: 'scheduled', delivery_status: 'pending' }, futureTask],
    order: { ...order, delivered_at: null },
    hubOrder: order,
  });
  assert.equal(bothPending.task.id, deliveredTask.id);
  assert.equal(bothPending.reason, 'exact_delivery_date_match');
  assert.equal(bothPending.remaining_nonterminal_task_count, 1);

  const single = planDeliveredTaskReconciliation({
    tasks: [{ ...futureTask, delivery_date: null }],
    order: { id: order.id, order_number: order.order_number },
  });
  assert.equal(single.task.id, futureTask.id);
  assert.equal(single.reason, 'single_order_task');
  results.push('delivery_sync_reconciles_only_the_exact_fulfillment_occurrence');
}

{
  const { buildDeliveryLifecycleReadModel } = await import(
    new URL('../../base44/functions/getAdminDeliveryRouteSummary/deliveryLifecycleReadModel.js', import.meta.url)
  );
  const customerOrder = {
    id: 'order_multi_date',
    order_number: 'NV-MULTI-DATE',
    assigned_delivery_date: '2026-08-05',
    status: 'delivered',
    payment_status: 'paid',
    payment_captured: true,
  };
  const nativeOrder = {
    id: 'native_multi_date',
    base44_order_id: customerOrder.id,
    shopify_order_number: customerOrder.order_number,
    assigned_delivery_date: '2026-08-05',
    payment_status: 'paid',
    source_type: 'customer_app_one_time',
    order_type: 'one_time',
    fulfillment_mode: 'multi_delivery',
  };
  const tasks = [
    {
      id: 'task_aug_5',
      order_id: customerOrder.id,
      native_shopify_order_id: nativeOrder.id,
      order_number: customerOrder.order_number,
      delivery_date: '2026-08-05',
      status: 'delivered',
      delivery_status: 'delivered',
      payment_status: 'paid',
    },
    {
      id: 'task_aug_8',
      order_id: customerOrder.id,
      native_shopify_order_id: nativeOrder.id,
      order_number: customerOrder.order_number,
      delivery_date: '2026-08-08',
      status: 'scheduled',
      delivery_status: 'pending',
      payment_status: 'paid',
    },
  ];
  const result = buildDeliveryLifecycleReadModel({
    deliveryDate: '2026-08-08',
    routeSummaryRows: [{
      task_id: 'task_aug_8',
      order_number: customerOrder.order_number,
      customer_app_order_id: customerOrder.id,
      native_shopify_order_id: nativeOrder.id,
      delivery_date: '2026-08-08',
      status: 'scheduled',
      delivery_status: 'pending',
    }],
    customerOrders: [customerOrder],
    nativeOrders: [nativeOrder],
    fulfillmentTasks: tasks,
  });
  assert.equal(result.summary.duplicate_identity_count, 0);
  assert.equal(result.summary.schedule_mismatch_count, 0);
  assert.equal(result.rows[0].blockers.includes('delivery_lifecycle_subscription_multi_delivery_hold'), false);
  assert.equal(result.rows[0].fulfillment_task_ref, 'task_aug_8');
  results.push('lifecycle_read_model_resolves_multi_date_sibling_occurrences');
}

{
  const { effectiveAdminOperationalStatuses } = loadExports(
    'base44/functions/getAdminOrdersWithHub/entry.ts',
    ['effectiveAdminOperationalStatuses'],
  );
  const mixed = effectiveAdminOperationalStatuses({
    status: 'delivered',
    customer_app_order_status: 'delivered',
    delivered_at: '2026-08-05T23:38:28.061Z',
    native_production_status: 'awaiting_production',
    native_fulfillment_status: 'pending',
    native_fulfillment_task_summary: {
      count: 2,
      status_counts: { delivered: 1, scheduled: 1 },
    },
    has_customer_app_order: true,
    has_native_order: true,
  });
  assert.equal(mixed.effective_order_status, 'partially_fulfilled');
  assert.equal(mixed.effective_production_status, 'partially_complete');
  assert.equal(mixed.effective_fulfillment_status, 'partially_fulfilled');
  assert.equal(mixed.native_status_stale_against_source, false);
  assert.equal(mixed.fulfillment_occurrence_summary.terminal, 1);
  assert.equal(mixed.fulfillment_occurrence_summary.pending, 1);
  results.push('admin_order_summary_represents_mixed_delivery_occurrences_as_partial');
}

{
  const { dedupeCrossSourceProjections } = loadExports(
    'base44/functions/getAdminOrderTimeline/entry.ts',
    ['dedupeCrossSourceProjections'],
  );
  const moment = '2026-08-05T23:38:28.061Z';
  const events = [
    { id: 'task_delivered', type: 'Delivered', source: 'Fulfillment Task', timestamp: moment },
    { id: 'order_delivered', type: 'Delivered', source: 'Shopify Order', timestamp: moment },
    { id: 'task_proof', type: 'Delivery Proof Added', source: 'Fulfillment Task', timestamp: moment },
    { id: 'order_proof', type: 'Delivery Proof Added', source: 'Shopify Order', timestamp: moment },
    { id: 'payment', type: 'Payment Captured', source: 'Shopify Order', timestamp: moment },
  ];
  const deduped = dedupeCrossSourceProjections(events);
  assert.deepEqual(Array.from(deduped, event => event.id), ['task_delivered', 'task_proof', 'payment']);
  results.push('timeline_hides_parent_projection_duplicates_and_keeps_occurrence_events');
}

{
  const { preferredCustomerName } = loadExports(
    'base44/functions/getAdminDeliveryRouteSummary/entry.ts',
    ['preferredCustomerName'],
  );
  const profilesByEmail = new Map([
    ['customer@example.test', { first_name: 'Lee', last_name: 'Burton' }],
  ]);
  assert.equal(preferredCustomerName({
    customerOrder: { customer_email: 'CUSTOMER@example.test', customer_name: 'Burton Lee' },
    order: { customer_name: 'Burton Lee' },
    profilesByEmail,
  }), 'Lee Burton');
  assert.equal(preferredCustomerName({
    customerOrder: { customer_name: 'Fallback Customer' },
    profilesByEmail,
  }), 'Fallback Customer');
  results.push('route_uses_structured_profile_name_before_stale_order_name');
}

{
  const routeOpsSource = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/RouteOps.jsx'), 'utf8');
  assert.match(routeOpsSource, /review_required_count/);
  assert.match(routeOpsSource, /duplicate_identity_count/);
  assert.match(routeOpsSource, /fallback_required_count/);
  assert.match(routeOpsSource, /value === null \|\| value === undefined \? '—'/);
  assert.match(routeOpsSource, /No count recorded/);
  results.push('route_readiness_surfaces_lifecycle_conflicts_and_unknown_counts');
}

console.log(JSON.stringify({
  success: true,
  suite: 'g70-route-delivery-integrity',
  cases: results.length,
  results,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
