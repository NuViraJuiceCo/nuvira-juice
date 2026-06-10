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
  source += `\nglobalThis.__exports = { G35B_PREVIEW_MODE, G35B_READ_ONLY_SAFETY, G35B_STATUS_SCHEMA_COMPATIBILITY, isG35BPreviewRequest, g35bUnsupportedBodyKey, buildG35BPreview };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, source };
}

function makeOrder(overrides = {}) {
  return {
    id: 'order_refund',
    order_number: 'NV-G35B-ORDER',
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    financial_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    items: [{ name: 'The NuVira Trio', quantity: 1 }],
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: 'native_refund',
    base44_order_id: 'order_refund',
    shopify_order_number: 'NV-G35B-ORDER',
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    fulfillment_method: 'delivery',
    source_type: 'customer_app_native_mirror',
    production_status: 'new',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    financial_status: 'paid',
    line_items: [{ title: 'The NuVira Trio', quantity: 1 }],
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: 'task_refund',
    base44_order_id: 'order_refund',
    order_id: 'order_refund',
    native_shopify_order_id: 'native_refund',
    shopify_order_id: 'native_refund',
    order_number: 'NV-G35B-ORDER',
    shopify_order_number: 'NV-G35B-ORDER',
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    status: 'scheduled',
    delivery_status: 'pending',
    ...overrides,
  };
}

function makeBatch(overrides = {}) {
  return {
    id: 'batch_refund',
    batch_id: 'G35B-BATCH',
    status: 'planned',
    planned_units: 6,
    base44_order_id: 'order_refund',
    native_shopify_order_id: 'native_refund',
    native_fulfillment_task_id: 'task_refund',
    order_number: 'NV-G35B-ORDER',
    order_sources: [{ order_id: 'order_refund', order_number: 'NV-G35B-ORDER', quantity: 2 }],
    ...overrides,
  };
}

function makeComplianceLog(overrides = {}) {
  return { id: 'compliance_refund', batch_id: 'G35B-BATCH', source_production_batch_id: 'batch_refund', locked: true, ...overrides };
}

function makeStore({
  user = { role: 'admin', email: 'owner_admin' },
  orders = [makeOrder()], nativeOrders = [makeNativeOrder()], tasks = [makeTask()],
  batches = [], complianceLogs = [], orderSyncLogs = [], reviewRows = [], commandLogs = [], parityLogs = [],
} = {}) {
  const store = { orders, nativeOrders, tasks, batches, complianceLogs, orderSyncLogs, reviewRows, commandLogs, parityLogs, writes: [] };
  const rowsFor = name => ({ Order: store.orders, ShopifyOrder: store.nativeOrders, FulfillmentTask: store.tasks, ProductionBatch: store.batches, BatchComplianceLog: store.complianceLogs, OrderSyncLog: store.orderSyncLogs, OrderReviewQueue: store.reviewRows, CommandLog: store.commandLogs, SafeSyncParityLog: store.parityLogs }[name] || []);
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
      asServiceRole: { entities: { Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog') } },
    },
  };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }
async function previewFor(scenario, body) { return fns.buildG35BPreview(scenario.base44, { preview_mode: 'NATIVE_REFUND_IMPACT', ...body }); }

const { exports: fns, handler, source } = loadHarness({ env: { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' } });

assert.equal(fns.G35B_PREVIEW_MODE, 'NATIVE_REFUND_IMPACT');
assert.equal(fns.G35B_READ_ONLY_SAFETY.dry_run_only, true);
assert.equal(fns.G35B_READ_ONLY_SAFETY.writes_performed, false);
assert.equal(fns.G35B_READ_ONLY_SAFETY.provider_calls_performed, false);
assert.equal(fns.G35B_READ_ONLY_SAFETY.stripe_calls_performed, false);
assert.equal(fns.G35B_READ_ONLY_SAFETY.shopify_api_calls_performed, false);
assert.equal(fns.G35B_STATUS_SCHEMA_COMPATIBILITY.customer_order_status_refund_value_supported, false);
assert.equal(fns.G35B_STATUS_SCHEMA_COMPATIBILITY.customer_order_cancelled_value_supported, false);
assert.equal(fns.isG35BPreviewRequest({ preview_mode: 'NATIVE_REFUND_IMPACT' }), true);
assert.equal(fns.g35bUnsupportedBodyKey({ preview_mode: 'NATIVE_REFUND_IMPACT', order_number: 'NV', process_refund: true }), 'process_refund');

let scenario = makeStore({ tasks: [], batches: [] });
let preview = await previewFor(scenario, { order_number: 'NV-G35B-ORDER', refund_type: 'full', refund_amount: 42 });
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.preview_mode, 'NATIVE_REFUND_IMPACT');
assert.equal(preview.lifecycle_state, 'native_order_created_only');
assert.equal(preview.lifecycle_risk_level, 'low_risk_preview_only');
assert.equal(preview.proposed_native_shopify_order_impact.proposed_payment_status, 'refunded');
assert.equal(preview.proposed_native_shopify_order_impact.proposed_production_status, 'canceled');
assert.equal(preview.proposed_customer_app_order_impact.proposed_status_supported, false);
assert.ok(preview.blockers.includes('customer_order_status_refund_value_unsupported'));
assert.equal(preview.next_action, 'schema_gap_blocks_native_refund_command');
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ batches: [makeBatch()] });
preview = await previewFor(scenario, { order_number: 'NV-G35B-ORDER', refund_type: 'partial', refund_amount: 10 });
assert.equal(preview.next_action, 'partial_refund_review_required');
assert.equal(preview.proposed_order_review_queue_impact.incident_type, 'partial_refund_received');
assert.equal(preview.proposed_fulfillment_task_impact.would_cancel_task, false);
assert.equal(preview.proposed_production_batch_impact.would_remove_order_sources_now, false);
assert.equal(preview.proposed_native_shopify_order_impact.proposed_action, 'hold_native_order_mutation_review_only');
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ orderSyncLogs: [{ id: 'sync_dup', order_number: 'NV-G35B-ORDER', stripe_event_id: 'evt_duplicate_12345678', status: 'success', action: 'refund_processed' }] });
preview = await previewFor(scenario, { order_number: 'NV-G35B-ORDER', refund_type: 'full', stripe_event_id: 'evt_duplicate_12345678' });
assert.equal(preview.idempotency_status.duplicate_event_detected, true);
assert.equal(preview.idempotency_status.order_sync_log_match_count, 1);
assert.equal(preview.next_action, 'duplicate_refund_event_detected');
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ orders: [], nativeOrders: [], tasks: [], batches: [] });
preview = await previewFor(scenario, { order_number: 'NV-UNKNOWN', refund_type: 'full' });
assert.equal(preview.order_found, false);
assert.equal(preview.next_action, 'unknown_order_review_required');
assert.equal(preview.proposed_order_review_queue_impact.incident_type, 'refund_received_unknown_order');
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ orders: [makeOrder({ status: 'delivered' })], nativeOrders: [makeNativeOrder({ production_status: 'bottled', fulfillment_status: 'fulfilled' })], tasks: [makeTask({ status: 'delivered', delivery_status: 'delivered' })], batches: [makeBatch({ status: 'verified_logged' })], complianceLogs: [makeComplianceLog()] });
preview = await previewFor(scenario, { order_number: 'NV-G35B-ORDER', refund_type: 'full' });
assert.equal(preview.lifecycle_state, 'delivered');
assert.equal(preview.lifecycle_risk_level, 'do_not_auto_cancel');
assert.equal(preview.next_action, 'delivered_refund_manual_review_required');
assert.equal(preview.proposed_fulfillment_task_impact.proposed_action, 'do_not_auto_cancel_delivered_or_completed_task');
assert.equal(preview.proposed_production_batch_impact.deletion_proposed, false);
assert.equal(preview.proposed_production_batch_impact.compliance_history_preserved, true);
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ batches: [makeBatch({ status: 'verified_logged' })], complianceLogs: [makeComplianceLog()] });
preview = await previewFor(scenario, { order_number: 'NV-G35B-ORDER', refund_type: 'full' });
assert.equal(preview.lifecycle_state, 'production_verified');
assert.equal(preview.proposed_production_batch_impact.proposed_action, 'hold_batch_mutation_manual_review_only');
assert.equal(preview.proposed_production_batch_impact.deletion_proposed, false);
assert.ok(preview.blockers.includes('production_verified_manual_review_required'));

assert.ok(preview.warnings.includes('inventory_reversal_not_proposed'));
assert.equal(preview.safety.inventory_deducted_or_restored, false);
assert.ok(preview.warnings.includes('purchase_order_reversal_not_proposed'));
assert.equal(preview.safety.purchase_order_created_or_updated, false);
assert.equal(preview.notification_impact.notification_would_send, false);
assert.equal(preview.notification_impact.notification_held, true);
assert.equal(preview.provider_call_impact, false);
assert.equal(preview.safety.provider_calls_performed, false);

scenario = makeStore({ nativeOrders: [makeNativeOrder({ order_type: 'subscription', is_subscription: true })] });
preview = await previewFor(scenario, { order_number: 'NV-G35B-ORDER', refund_type: 'full' });
assert.equal(preview.next_action, 'unsupported_subscription_refund');
assert.ok(preview.blockers.includes('subscription_or_multi_delivery_refund_not_supported_by_one_time_preview'));

scenario = makeStore();
let res = await handler(req(scenario.base44, { preview_mode: 'NATIVE_REFUND_IMPACT', order_number: 'NV-G35B-ORDER', refund_type: 'full' }));
assert.equal(res.status, 200);
let body = await json(res);
assert.equal(body.success, true);
assert.equal(body.writes_performed, false);
assert.equal(body.actor_type, 'admin');
assert.equal(scenario.store.writes.length, 0);

res = await handler(req(scenario.base44, { preview_mode: 'NATIVE_REFUND_IMPACT', order_number: 'NV-G35B-ORDER', refund_type: 'full' }, 'GET'));
assert.equal(res.status, 405);
assert.equal((await json(res)).writes_performed, false);

scenario = makeStore({ user: new Error('no auth') });
res = await handler(req(scenario.base44, { preview_mode: 'NATIVE_REFUND_IMPACT', order_number: 'NV-G35B-ORDER', refund_type: 'full' }));
assert.equal(res.status, 401);
assert.equal((await json(res)).writes_performed, false);

scenario = makeStore();
preview = await previewFor(scenario, { order_number: 'NV-G35B-ORDER' });
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('refund_type_required_full_partial_or_unknown'));
assert.equal(scenario.store.writes.length, 0);

const forbiddenSnippets = ['stripe.paymentIntents.retrieve', 'stripe.refunds.create', 'new Stripe(', 'Shopify(', 'PurchaseOrder.create', '.create({', '.update(', '.delete(', 'sendOrderReceivedNotification', 'sendOrderStatusNotification', 'syncRefundToHub', 'repairRefundedOrder'];
for (const snippet of forbiddenSnippets) {
  if (['.create({', '.update(', '.delete('].includes(snippet)) continue;
  assert.ok(!source.includes(snippet), `source must not include forbidden snippet ${snippet}`);
}
assert.ok(!/previewNativeOrderCutoverReadiness[\s\S]*stripe\.refunds\.create/.test(source));

console.log('G35B native refund impact preview tests passed');
