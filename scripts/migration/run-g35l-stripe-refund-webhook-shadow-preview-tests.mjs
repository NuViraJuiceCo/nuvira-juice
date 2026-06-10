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
  source += `\nglobalThis.__exports = { G35L_PREVIEW_MODE, isG35LPreviewRequest, g35lUnsupportedBodyKey, buildG35LPreview, buildG35BPreview, buildG35HPreview, G35B_READ_ONLY_SAFETY } ;\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    setTimeout: callback => { callback(); return 0; },
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, source };
}

const ORDER = {
  orderNumber: 'NV-G35L-ORDER',
  customerOrderId: 'order_g35l',
  nativeOrderId: 'native_g35l',
  taskId: 'task_g35l',
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
    stripe_payment_intent_id: 'pi_synthetic_g35l',
    stripe_charge_id: 'ch_synthetic_g35l',
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
    stripe_payment_intent_id: 'pi_synthetic_g35l',
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
    id: `pb_g35l_${index + 1}`,
    batch_id: `NATIVE-${ORDER.orderNumber}-2026-06-19-SYNTHETIC-${index + 1}`,
    product_name: `Synthetic Juice ${index + 1}`,
    production_date: '2026-06-19',
    status: 'verified_logged',
    planned_units: 1,
    compliance_log_id: `cl_g35l_${index + 1}`,
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
    id: `cl_g35l_${index + 1}`,
    batch_id: `NATIVE-${ORDER.orderNumber}-2026-06-19-SYNTHETIC-${index + 1}`,
    source_production_batch_id: `pb_g35l_${index + 1}`,
    date: '2026-06-19',
    juice_flavor: `Synthetic Juice ${index + 1}`,
    locked: true,
    status: 'verified_logged',
    ...overrides,
  };
}

function makeStore({
  user = { role: 'admin', email: 'synthetic_owner_admin' },
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
      auth: { me: async () => { if (user instanceof Error) throw user; return user; } },
      asServiceRole: { entities: {
        Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'),
        ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'),
        OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'),
      } },
    },
  };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

async function previewFor(scenario, body = {}) {
  return fns.buildG35LPreview(scenario.base44, {
    preview_mode: 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW',
    event_type: 'charge.refunded',
    order_number: ORDER.orderNumber,
    customer_app_order_id: ORDER.customerOrderId,
    native_shopify_order_id: ORDER.nativeOrderId,
    native_fulfillment_task_id: ORDER.taskId,
    refund_type: 'full',
    refund_currency: 'USD',
    event_source: 'synthetic_fixture',
    request_id: 'g35l_fixture_request',
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
  assert.equal(preview.safety?.order_sync_log_created, false, `${label}: no sync log create`);
  assert.equal(preview.safety?.command_log_created, false, `${label}: no command log create`);
  assert.equal(store.writes.length, 0, `${label}: no writes captured`);
}

const { exports: fns, handler, source } = loadHarness({ env: { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' } });
assert.equal(fns.G35L_PREVIEW_MODE, 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW');
assert.equal(fns.isG35LPreviewRequest({ preview_mode: 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW' }), true);
assert.equal(fns.g35lUnsupportedBodyKey({ preview_mode: 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW', raw_payload: {} }), 'raw_payload');
assert.equal(fns.G35B_READ_ONLY_SAFETY.writes_performed, false);

const sixBatches = Array.from({ length: 6 }, (_, index) => makeBatch(index));
const sixLogs = Array.from({ length: 6 }, (_, index) => makeComplianceLog(index));

let scenario = makeStore({
  orders: [makeOrder({ status: 'delivered' })],
  nativeOrders: [makeNativeOrder({ production_status: 'bottled', fulfillment_status: 'fulfilled' })],
  tasks: [makeTask({ status: 'delivered', delivery_status: 'delivered' })],
  batches: sixBatches,
  complianceLogs: sixLogs,
});
let preview = await previewFor(scenario, { event_type: 'charge.refunded', refund_type: 'full', stripe_event_id: 'evt_g35l_full' });
assert.equal(preview.success, true);
assert.equal(preview.preview_mode, 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW');
assert.equal(preview.event_type_supported, true);
assert.equal(preview.normalized_refund_type, 'full');
assert.equal(preview.refund_impact_preview.preview_mode, 'NATIVE_REFUND_IMPACT');
assert.equal(preview.refund_impact_preview.lifecycle_state, 'delivered');
assert.equal(preview.next_action, 'shadow_preview_full_refund_manual_review_required');
assert.equal(preview.refund_impact_preview.production_batch_count, 6);
assert.equal(preview.refund_impact_preview.batch_compliance_log_count, 6);
assertNoSideEffects(preview, scenario.store, 'full refund shadow');

scenario = makeStore({
  orders: [makeOrder({ status: 'delivered' })],
  nativeOrders: [makeNativeOrder({ production_status: 'bottled', fulfillment_status: 'fulfilled' })],
  tasks: [makeTask({ status: 'delivered', delivery_status: 'delivered' })],
  batches: sixBatches,
  complianceLogs: sixLogs,
});
preview = await previewFor(scenario, { event_type: 'refund.created', refund_type: 'partial', refund_amount: 5, refund_currency: 'USD', stripe_event_id: 'evt_g35l_partial', stripe_refund_id: 're_g35l_partial' });
assert.equal(preview.success, true);
assert.equal(preview.normalized_refund_type, 'partial');
assert.equal(preview.refund_impact_preview.preview_mode, 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT');
assert.equal(preview.next_action, 'shadow_preview_partial_refund_review_required');
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.incident_type, 'partial_refund_review_required');
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.raw_payload_included, false);
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.customer_pii_included, false);
assertNoSideEffects(preview, scenario.store, 'partial refund shadow');

scenario = makeStore();
preview = await previewFor(scenario, { event_type: 'refund.created', refund_type: 'partial', refund_amount: '', stripe_event_id: 'evt_g35l_missing_amount' });
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('refund_amount_required_for_partial_refund_review'));
assert.equal(preview.next_action, 'missing_refund_amount_for_partial_preview');
assertNoSideEffects(preview, scenario.store, 'partial missing amount');

scenario = makeStore();
preview = await previewFor(scenario, { event_type: 'refund.created', refund_type: 'partial', refund_amount: 5, refund_currency: '', currency: '', stripe_event_id: 'evt_g35l_missing_currency' });
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('refund_currency_required_for_partial_refund_review'));
assert.equal(preview.next_action, 'missing_refund_amount_for_partial_preview');
assertNoSideEffects(preview, scenario.store, 'partial missing currency');

scenario = makeStore();
preview = await previewFor(scenario, { event_type: 'payout.paid', refund_type: 'full', stripe_event_id: 'evt_g35l_unsupported' });
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('unsupported_stripe_refund_event_type'));
assert.equal(preview.next_action, 'unsupported_stripe_refund_event_type');
assert.equal(preview.refund_impact_preview, null);
assertNoSideEffects(preview, scenario.store, 'unsupported event');

scenario = makeStore({ orders: [], nativeOrders: [], tasks: [], batches: [], complianceLogs: [] });
preview = await previewFor(scenario, { order_number: 'NV-G35L-UNKNOWN', customer_app_order_id: '', native_shopify_order_id: '', native_fulfillment_task_id: '', event_type: 'charge.refunded', refund_type: 'full', stripe_event_id: 'evt_g35l_unknown' });
assert.equal(preview.success, true);
assert.equal(preview.order_lookup_result, 'unknown_order_no_provider_lookup');
assert.equal(preview.next_action, 'unknown_order_refund_review_required');
assert.equal(preview.proposed_order_review_queue_impact.incident_type, 'refund_received_unknown_order');
assertNoSideEffects(preview, scenario.store, 'unknown order');

scenario = makeStore({ orderSyncLogs: [{ id: 'sync_evt_dup', order_number: ORDER.orderNumber, stripe_event_id: 'evt_g35l_dup', status: 'success', action: 'refund_processed' }] });
preview = await previewFor(scenario, { event_type: 'charge.refunded', refund_type: 'full', stripe_event_id: 'evt_g35l_dup' });
assert.equal(preview.idempotency_status.duplicate_event_detected, true);
assert.equal(preview.next_action, 'duplicate_refund_event_detected');
assert.ok(preview.blockers.includes('duplicate_refund_event_detected'));
assertNoSideEffects(preview, scenario.store, 'duplicate stripe event');

scenario = makeStore({ commandLogs: [{ id: 'cmd_refund_dup', order_number: ORDER.orderNumber, stripe_refund_id: 're_g35l_dup', status: 'success', action: 'partial_refund_review_created' }] });
preview = await previewFor(scenario, { event_type: 'refund.updated', refund_type: 'partial', refund_amount: 5, refund_currency: 'USD', stripe_refund_id: 're_g35l_dup' });
assert.equal(preview.idempotency_status.duplicate_stripe_refund_id_detected, true);
assert.equal(preview.next_action, 'duplicate_refund_event_detected');
assert.ok(preview.blockers.includes('duplicate_refund_event_detected'));
assertNoSideEffects(preview, scenario.store, 'duplicate stripe refund id');

scenario = makeStore({
  orders: [makeOrder({ status: 'delivered' })],
  nativeOrders: [makeNativeOrder({ production_status: 'bottled', fulfillment_status: 'fulfilled' })],
  tasks: [makeTask({ status: 'delivered', delivery_status: 'delivered' })],
  batches: sixBatches,
  complianceLogs: sixLogs,
});
preview = await previewFor(scenario, { event_type: 'charge.refunded', refund_type: 'full', payment_intent_id: 'pi_synthetic_g35l', order_number: '', customer_app_order_id: '', native_shopify_order_id: '', native_fulfillment_task_id: '' });
assert.equal(preview.order_lookup_strategy, 'payment_intent_id_local_order');
assert.equal(preview.linked_order_number, ORDER.orderNumber);
assert.equal(preview.next_action, 'shadow_preview_full_refund_manual_review_required');
assertNoSideEffects(preview, scenario.store, 'payment intent local lookup');

scenario = makeStore({
  orders: [makeOrder({ status: 'delivered' })],
  nativeOrders: [makeNativeOrder({ production_status: 'bottled', fulfillment_status: 'fulfilled' })],
  tasks: [makeTask({ status: 'delivered', delivery_status: 'delivered' })],
  batches: sixBatches,
  complianceLogs: sixLogs,
});
preview = await previewFor(scenario, { event_type: 'charge.refund.updated', refund_type: 'partial', refund_amount: 5, refund_currency: 'USD', stripe_event_id: 'evt_g35l_delivered_partial' });
assert.equal(preview.next_action, 'shadow_preview_partial_refund_review_required');
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.incident_type, 'partial_refund_review_required');
assert.equal(preview.refund_impact_preview.lifecycle_state, 'delivered');
assertNoSideEffects(preview, scenario.store, 'delivered partial');

scenario = makeStore();
let res = await handler(req(scenario.base44, { preview_mode: 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW', raw_payload: { id: 'evt_should_not_be_accepted' }, refund_type: 'full' }));
assert.equal(res.status, 400);
let body = await json(res);
assert.equal(body.error_code, 'unsupported_body_key');
assert.equal(body.unsupported_key, 'raw_payload');
assert.equal(body.writes_performed, false);
assert.equal(scenario.store.writes.length, 0);

assert.ok(!/stripe\.refunds\.create/.test(source), 'shadow preview must not create Stripe refunds');
assert.ok(!/new Stripe\(/.test(source), 'shadow preview must not instantiate Stripe');
assert.ok(!/OrderReviewQueue\.create/.test(source), 'shadow preview must not create review queue rows');
assert.ok(!/OrderSyncLog\.create/.test(source), 'shadow preview must not create sync log rows');
assert.ok(!/CommandLog\.create/.test(source), 'shadow preview must not create command log rows');
assert.ok(!/sendOrderStatusNotification/.test(source), 'shadow preview must not send notifications');
assert.equal(scenario.store.writes.length, 0);

console.log(JSON.stringify({
  success: true,
  test_count: 14,
  full_refund_shadow_routes_to_native_refund_impact: true,
  partial_refund_shadow_routes_to_review_preview: true,
  provider_call_impact: false,
  notifications_held: true,
  writes_performed: false,
}, null, 2));
