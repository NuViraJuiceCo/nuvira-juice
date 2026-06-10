#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');

function loadHarness({ env = {} } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { buildG35BPreview, G35B_PREVIEW_MODE, G35K_FULL_REFUND_PREPRODUCTION_MARKER, G35B_READ_ONLY_SAFETY, G35B_STATUS_SCHEMA_COMPATIBILITY } ;\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    setTimeout: callback => { callback(); return 0; },
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, source };
}

const ORDER = {
  orderNumber: 'NV-G35K-ORDER',
  customerOrderId: 'order_g35k',
  nativeOrderId: 'native_g35k',
  taskId: 'task_g35k',
};

function makeOrder(overrides = {}) {
  return {
    id: ORDER.customerOrderId,
    order_number: ORDER.orderNumber,
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    financial_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    items: [{ name: 'Synthetic Juice Bundle', quantity: 1 }],
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: ORDER.nativeOrderId,
    base44_order_id: ORDER.customerOrderId,
    shopify_order_number: ORDER.orderNumber,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    fulfillment_method: 'delivery',
    source_type: 'customer_app_native_mirror',
    production_status: 'new',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    financial_status: 'paid',
    line_items: [{ title: 'Synthetic Juice Bundle', quantity: 1 }],
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: ORDER.taskId,
    base44_order_id: ORDER.customerOrderId,
    order_id: ORDER.customerOrderId,
    native_shopify_order_id: ORDER.nativeOrderId,
    shopify_order_id: ORDER.nativeOrderId,
    order_number: ORDER.orderNumber,
    shopify_order_number: ORDER.orderNumber,
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    status: 'scheduled',
    delivery_status: 'pending',
    ...overrides,
  };
}

function makeBatch(index = 0, overrides = {}) {
  return {
    id: `pb_g35k_${index + 1}`,
    batch_id: `NATIVE-${ORDER.orderNumber}-2026-06-18-SYNTHETIC-${index + 1}`,
    product_name: `Synthetic Juice ${index + 1}`,
    production_date: '2026-06-18',
    status: 'planned',
    planned_units: 1,
    compliance_log_id: overrides.compliance_log_id || `cl_g35k_${index + 1}`,
    base44_order_id: ORDER.customerOrderId,
    native_shopify_order_id: ORDER.nativeOrderId,
    native_fulfillment_task_id: ORDER.taskId,
    order_number: ORDER.orderNumber,
    order_sources: [{ order_id: ORDER.customerOrderId, order_number: ORDER.orderNumber, quantity: 1 }],
    ...overrides,
  };
}

function makeComplianceLog(index = 0, overrides = {}) {
  return {
    id: `cl_g35k_${index + 1}`,
    batch_id: `NATIVE-${ORDER.orderNumber}-2026-06-18-SYNTHETIC-${index + 1}`,
    source_production_batch_id: `pb_g35k_${index + 1}`,
    date: '2026-06-18',
    juice_flavor: `Synthetic Juice ${index + 1}`,
    locked: true,
    status: 'verified_logged',
    ...overrides,
  };
}

function makeStore({
  orders = [makeOrder()],
  nativeOrders = [makeNativeOrder()],
  tasks = [makeTask()],
  batches = [],
  complianceLogs = [],
  orderSyncLogs = [],
  reviewRows = [],
  commandLogs = [],
  parityLogs = [],
} = {}) {
  const store = { orders, nativeOrders, tasks, batches, complianceLogs, orderSyncLogs, reviewRows, commandLogs, parityLogs, writes: [] };
  const rowsFor = name => ({
    Order: store.orders,
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.tasks,
    ProductionBatch: store.batches,
    BatchComplianceLog: store.complianceLogs,
    OrderSyncLog: store.orderSyncLogs,
    OrderReviewQueue: store.reviewRows,
    CommandLog: store.commandLogs,
    SafeSyncParityLog: store.parityLogs,
  }[name] || []);
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    list: async () => rowsFor(name),
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    get: async id => rowsFor(name).find(row => row?.id === id) || null,
    create: async payload => { store.writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { store.writes.push({ op: 'update', name, id, patch }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { store.writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    store,
    base44: {
      auth: { me: async () => ({ role: 'admin', email: 'synthetic_owner_admin' }) },
      asServiceRole: { entities: {
        Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'),
        ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'),
        OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'),
      } },
    },
  };
}

async function previewFor(scenario, body = {}) {
  return fns.buildG35BPreview(scenario.base44, {
    preview_mode: 'NATIVE_REFUND_IMPACT',
    order_number: ORDER.orderNumber,
    refund_type: 'full',
    refund_amount: 42,
    refund_currency: 'USD',
    event_source: 'test_fixture',
    request_id: 'g35k_fixture_request',
    ...body,
  });
}

function assertNoSideEffects(preview, store, label) {
  assert.equal(preview.dry_run, true, `${label}: dry_run`);
  assert.equal(preview.writes_performed, false, `${label}: writes_performed`);
  assert.equal(preview.provider_call_impact, false, `${label}: provider calls`);
  assert.equal(preview.notification_impact?.notification_would_send, false, `${label}: notification send`);
  assert.equal(preview.notification_impact?.notification_held, true, `${label}: notification held`);
  assert.equal(preview.safety?.stripe_calls_performed, false, `${label}: Stripe calls`);
  assert.equal(preview.safety?.shopify_api_calls_performed, false, `${label}: Shopify calls`);
  assert.equal(preview.safety?.order_review_queue_created, false, `${label}: no review queue create`);
  assert.equal(preview.safety?.command_log_created, false, `${label}: no command log create`);
  assert.equal(store.writes.length, 0, `${label}: no writes captured`);
}

const { exports: fns, source } = loadHarness();
assert.equal(fns.G35B_PREVIEW_MODE, 'NATIVE_REFUND_IMPACT');
assert.equal(fns.G35K_FULL_REFUND_PREPRODUCTION_MARKER, 'g35k_full_refund_preproduction_preview_hardening');
assert.equal(fns.G35B_READ_ONLY_SAFETY.writes_performed, false);
assert.equal(fns.G35B_STATUS_SCHEMA_COMPATIBILITY.customer_order_status_refund_value_supported, false);
assert.ok(source.includes('preview_full_refund_customer_refund_field_impact'));
assert.ok(!source.includes("proposed_status: 'refunded'"), 'full refund preview must not propose Customer App Order.status=refunded');

const results = [];
function record(name, preview) {
  results.push(`${name}|${preview.lifecycle_state}|${preview.next_action}`);
}

let scenario = makeStore({ nativeOrders: [], tasks: [], batches: [], complianceLogs: [] });
let preview = await previewFor(scenario, { stripe_event_id: 'evt_g35k_before_ops' });
assert.equal(preview.success, true);
assert.equal(preview.lifecycle_state, 'before_native_ops');
assert.equal(preview.lifecycle_risk_level, 'low_risk_preview_only');
assert.equal(preview.full_refund_preview_ready, true);
assert.equal(preview.native_shopify_order_present, false);
assert.equal(preview.native_fulfillment_task_present, false);
assert.equal(preview.production_batch_count, 0);
assert.equal(preview.batch_compliance_log_count, 0);
assert.equal(preview.proposed_customer_app_order_impact.status_mutation_proposed, false);
assert.equal(preview.proposed_customer_app_order_impact.proposed_status, null);
assert.equal(preview.proposed_customer_app_order_impact.proposed_refund_fields.refund_status, 'fully_refunded');
assert.equal(preview.next_action, 'native_refund_preview_ready_full_refund_pre_production');
assert.ok(preview.status_schema_policy_notes.includes('refund_state_uses_payment_refund_fields'));
assert.ok(!preview.blockers.includes('customer_order_status_refund_value_unsupported'));
assertNoSideEffects(preview, scenario.store, 'before native ops');
record('before_native_ops', preview);

scenario = makeStore({ tasks: [], batches: [], complianceLogs: [] });
preview = await previewFor(scenario, { stripe_event_id: 'evt_g35k_native_order' });
assert.equal(preview.lifecycle_state, 'native_order_created_only');
assert.equal(preview.full_refund_preview_ready, true);
assert.equal(preview.proposed_native_shopify_order_impact.proposed_payment_status, 'refunded');
assert.equal(preview.proposed_native_shopify_order_impact.proposed_production_status, 'canceled');
assert.equal(preview.proposed_native_shopify_order_impact.proposed_refund_fields.refund_status, 'fully_refunded');
assert.equal(preview.next_action, 'native_refund_preview_ready_full_refund_pre_production');
assertNoSideEffects(preview, scenario.store, 'native order only');
record('native_order_only', preview);

scenario = makeStore({ batches: [], complianceLogs: [] });
preview = await previewFor(scenario, { stripe_event_id: 'evt_g35k_task_pending' });
assert.equal(preview.lifecycle_state, 'task_scheduled_or_packed');
assert.equal(preview.full_refund_preview_ready, true);
assert.equal(preview.proposed_task_cancellation_impact.proposed_action, 'preview_task_cancellation_impact');
assert.equal(preview.proposed_task_cancellation_impact.proposed_status, 'cancelled');
assert.equal(preview.proposed_task_cancellation_impact.would_cancel_task, false);
assert.equal(preview.next_action, 'full_refund_preview_ready_task_cancellation_impact');
assertNoSideEffects(preview, scenario.store, 'task pending');
record('task_pending', preview);

scenario = makeStore({ batches: [makeBatch(0, { status: 'planned' }), makeBatch(1, { status: 'planned', product_name: 'Synthetic Shot' })], complianceLogs: [] });
preview = await previewFor(scenario, { stripe_event_id: 'evt_g35k_batch_planned' });
assert.equal(preview.lifecycle_state, 'production_batches_planned');
assert.equal(preview.full_refund_preview_ready, true);
assert.equal(preview.production_batch_count, 2);
assert.equal(preview.proposed_batch_recalculation_impact.proposed_action, 'preview_order_source_removal_and_planned_units_recalculation');
assert.equal(preview.proposed_batch_recalculation_impact.would_remove_order_sources_now, false);
assert.equal(preview.proposed_batch_recalculation_impact.would_recalculate_planned_units_now, false);
assert.equal(preview.next_action, 'full_refund_preview_ready_batch_recalculation_impact');
assertNoSideEffects(preview, scenario.store, 'planned batches');
record('planned_batches', preview);

scenario = makeStore({ batches: [makeBatch(0, { status: 'in_progress' })], complianceLogs: [] });
preview = await previewFor(scenario, { stripe_event_id: 'evt_g35k_in_progress' });
assert.equal(preview.lifecycle_state, 'production_started');
assert.equal(preview.full_refund_preview_ready, false);
assert.equal(preview.next_action, 'production_started_manual_review_required');
assert.ok(preview.blockers.includes('production_started_manual_review_required'));
assert.equal(preview.proposed_production_batch_impact.proposed_action, 'hold_batch_mutation_manual_review_only');
assertNoSideEffects(preview, scenario.store, 'production started');
record('production_started', preview);

scenario = makeStore({ batches: [makeBatch(0, { status: 'verified_logged' })], complianceLogs: [makeComplianceLog(0)] });
preview = await previewFor(scenario, { stripe_event_id: 'evt_g35k_verified' });
assert.equal(preview.lifecycle_state, 'production_verified');
assert.equal(preview.full_refund_preview_ready, false);
assert.equal(preview.next_action, 'production_verified_manual_review_required');
assert.ok(preview.blockers.includes('production_verified_manual_review_required'));
assert.equal(preview.verified_logged_batch_count, 1);
assert.equal(preview.locked_compliance_log_count, 1);
assert.equal(preview.proposed_production_batch_impact.compliance_history_preserved, true);
assert.equal(preview.proposed_production_batch_impact.compliance_history_mutation_proposed, false);
assertNoSideEffects(preview, scenario.store, 'verified logged');
record('verified_logged', preview);

scenario = makeStore({
  orders: [makeOrder({ status: 'delivered' })],
  nativeOrders: [makeNativeOrder({ production_status: 'bottled', fulfillment_status: 'fulfilled' })],
  tasks: [makeTask({ status: 'delivered', delivery_status: 'delivered' })],
  batches: [makeBatch(0, { status: 'verified_logged' })],
  complianceLogs: [makeComplianceLog(0)],
});
preview = await previewFor(scenario, { stripe_event_id: 'evt_g35k_delivered' });
assert.equal(preview.lifecycle_state, 'delivered');
assert.equal(preview.lifecycle_risk_level, 'do_not_auto_cancel');
assert.equal(preview.full_refund_preview_ready, false);
assert.equal(preview.next_action, 'delivered_refund_manual_review_required');
assert.ok(preview.blockers.includes('delivered_manual_review_required'));
assert.equal(preview.proposed_task_cancellation_impact.proposed_action, 'do_not_auto_cancel_delivered_or_completed_task');
assert.equal(preview.proposed_native_shopify_order_impact.proposed_production_status, null);
assert.equal(preview.proposed_native_shopify_order_impact.proposed_fulfillment_status, null);
assertNoSideEffects(preview, scenario.store, 'delivered');
record('delivered', preview);

scenario = makeStore({ tasks: [], batches: [], complianceLogs: [], orderSyncLogs: [{ id: 'sync_duplicate_g35k', order_number: ORDER.orderNumber, stripe_event_id: 'evt_g35k_duplicate', status: 'success', action: 'refund_processed' }] });
preview = await previewFor(scenario, { stripe_event_id: 'evt_g35k_duplicate' });
assert.equal(preview.idempotency_status.duplicate_event_detected, true);
assert.equal(preview.next_action, 'duplicate_refund_event_detected');
assert.ok(preview.blockers.includes('duplicate_refund_event_detected'));
assertNoSideEffects(preview, scenario.store, 'duplicate event');
record('duplicate', preview);

scenario = makeStore({
  orders: [makeOrder({ payment_status: 'refunded', financial_status: 'refunded', do_not_recover: true })],
  nativeOrders: [makeNativeOrder({ payment_status: 'refunded', financial_status: 'refunded', production_status: 'canceled' })],
  tasks: [],
  batches: [],
  complianceLogs: [],
});
preview = await previewFor(scenario, { stripe_event_id: 'evt_g35k_already_refunded' });
assert.equal(preview.already_refunded_or_terminal, true);
assert.equal(preview.full_refund_preview_ready, false);
assert.equal(preview.next_action, 'already_refunded_or_terminal_review_required');
assert.ok(preview.blockers.includes('already_refunded_or_terminal_review_required'));
assert.equal(preview.proposed_review_queue_impact.incident_type, 'already_refunded_terminal_refund_review');
assertNoSideEffects(preview, scenario.store, 'already refunded terminal');
record('already_refunded_terminal', preview);

scenario = makeStore({ orders: [], nativeOrders: [], tasks: [], batches: [], complianceLogs: [] });
preview = await previewFor(scenario, { order_number: 'NV-G35K-UNKNOWN', stripe_event_id: 'evt_g35k_unknown' });
assert.equal(preview.order_found, false);
assert.equal(preview.next_action, 'unknown_order_review_required');
assert.equal(preview.proposed_review_queue_impact.incident_type, 'refund_received_unknown_order');
assertNoSideEffects(preview, scenario.store, 'unknown order');
record('unknown', preview);

assert.ok(!source.includes('stripe.refunds.create'), 'runtime preview must not create Stripe refunds');
assert.ok(!source.includes('new Stripe('), 'runtime preview must not instantiate Stripe');
assert.ok(!source.includes('PurchaseOrder.create'), 'runtime preview must not create PurchaseOrders');
assert.ok(!source.includes('sendOrderStatusNotification'), 'runtime preview must not send notifications');

console.log(JSON.stringify({
  success: true,
  test_count: 13,
  classification_summary: results,
  writes_performed: false,
  provider_call_impact: false,
  notifications_held: true,
}, null, 2));
