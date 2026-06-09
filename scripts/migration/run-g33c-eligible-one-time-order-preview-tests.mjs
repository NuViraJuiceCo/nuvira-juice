#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/previewEligibleOneTimeOrderNativeWorkflow/entry.ts');

function loadHarness({ env = {} } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { READ_ONLY_SAFETY, getLookup, unsupportedBodyKey, classifyRow, downstreamState, buildCandidateRow, buildPreview, nextActionFor, recommendedPilotType };\n`;
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
    id: 'order_good',
    order_number: 'NV-G33C-GOOD',
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    assigned_delivery_date: '2026-06-10',
    items: [{ name: 'The NuVira Trio', quantity: 1 }],
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: 'native_good',
    base44_order_id: 'order_good',
    shopify_order_number: 'NV-G33C-GOOD',
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
    id: 'task_good',
    base44_order_id: 'order_good',
    order_id: 'order_good',
    native_shopify_order_id: 'native_good',
    shopify_order_id: 'native_good',
    order_number: 'NV-G33C-GOOD',
    shopify_order_number: 'NV-G33C-GOOD',
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    status: 'pending',
    delivery_status: 'pending',
    delivery_date: '2026-06-10',
    ...overrides,
  };
}

function makeBatch(overrides = {}) {
  return {
    id: 'batch_good',
    batch_id: 'G33C-BATCH-GOOD',
    base44_order_id: 'order_good',
    native_shopify_order_id: 'native_good',
    native_fulfillment_task_id: 'task_good',
    order_number: 'NV-G33C-GOOD',
    status: 'verified_logged',
    production_date: '2026-06-10',
    ...overrides,
  };
}

function makeComplianceLog(overrides = {}) {
  return {
    id: 'compliance_good',
    batch_id: 'G33C-BATCH-GOOD',
    source_production_batch_id: 'batch_good',
    locked: true,
    ...overrides,
  };
}

function makeStore({
  user = { role: 'admin', email: 'owner@example.test' },
  orders = [makeOrder()],
  nativeOrders = [makeNativeOrder()],
  tasks = [makeTask()],
  orderSyncLogs = [],
  reviewRows = [],
  commandLogs = [],
  parityLogs = [],
  batches = [],
  complianceLogs = [],
} = {}) {
  const store = { orders, nativeOrders, tasks, orderSyncLogs, reviewRows, commandLogs, parityLogs, batches, complianceLogs, writes: [] };
  const rowsFor = name => {
    if (name === 'Order') return store.orders;
    if (name === 'ShopifyOrder') return store.nativeOrders;
    if (name === 'FulfillmentTask') return store.tasks;
    if (name === 'OrderSyncLog') return store.orderSyncLogs;
    if (name === 'OrderReviewQueue') return store.reviewRows;
    if (name === 'CommandLog') return store.commandLogs;
    if (name === 'SafeSyncParityLog') return store.parityLogs;
    if (name === 'ProductionBatch') return store.batches;
    if (name === 'BatchComplianceLog') return store.complianceLogs;
    return [];
  };
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
      auth: { me: async () => {
        if (user instanceof Error) throw user;
        return user;
      } },
      asServiceRole: { entities: {
        Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'),
      } },
    },
  };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

const { exports: fns, handler, source } = loadHarness({ env: { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' } });

assert.equal(fns.READ_ONLY_SAFETY.dry_run_only, true);
assert.equal(fns.READ_ONLY_SAFETY.writes_performed, false);
assert.equal(fns.READ_ONLY_SAFETY.provider_calls_performed, false);
assert.equal(fns.READ_ONLY_SAFETY.stripe_calls_performed, false);
assert.equal(fns.READ_ONLY_SAFETY.shopify_api_calls_performed, false);
assert.equal(fns.unsupportedBodyKey({ order_number: 'NV-GOOD', send_notification: true }), 'send_notification');
assert.equal(fns.getLookup({ order_number: 'NV-GOOD' }).mode, 'EXACT_ORDER_PREVIEW');
assert.equal(fns.getLookup({}).mode, 'RECENT_CANDIDATE_SCAN');

let scenario = makeStore();
let preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.candidate_rows.length, 1);
assert.equal(preview.candidate_rows[0].eligible_for_second_controlled_pilot, true);
assert.equal(preview.candidate_rows[0].eligibility_classification, 'eligible_next_one_time_order_candidate');
assert.equal(preview.candidate_rows[0].customer_app_order_id, 'order_good');
assert.equal(preview.candidate_rows[0].native_shopify_order_id, 'native_good');
assert.equal(preview.candidate_rows[0].native_fulfillment_task_id, 'task_good');
assert.equal(preview.next_action, 'plan_g33d_second_exact_controlled_pilot_for_clean_candidate');
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ orders: [makeOrder({ payment_status: 'pending', payment_captured: false })], nativeOrders: [makeNativeOrder({ payment_status: 'pending', financial_status: 'pending' })] });
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.candidate_rows[0].eligible_for_second_controlled_pilot, false);
assert.equal(preview.candidate_rows[0].eligibility_classification, 'pending_payment_do_not_process');
assert.ok(preview.candidate_rows[0].blockers.includes('payment_not_paid_or_captured'));

scenario = makeStore({ nativeOrders: [makeNativeOrder({ order_type: 'subscription', is_subscription: true })] });
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.candidate_rows[0].eligible_for_second_controlled_pilot, false);
assert.equal(preview.candidate_rows[0].eligibility_classification, 'unsupported_subscription_or_multi_delivery');
assert.ok(preview.candidate_rows[0].blockers.includes('subscription_or_multi_delivery_not_supported'));

scenario = makeStore({ orders: [] });
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.candidate_rows[0].eligible_for_second_controlled_pilot, false);
assert.equal(preview.candidate_rows[0].eligibility_classification, 'insufficient_data');
assert.ok(preview.candidate_rows[0].blockers.includes('customer_app_order_missing'));

scenario = makeStore({ orders: [makeOrder({ items: [] })], nativeOrders: [makeNativeOrder({ line_items: [] })], tasks: [makeTask({ items: [] })] });
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.candidate_rows[0].eligible_for_second_controlled_pilot, false);
assert.equal(preview.candidate_rows[0].eligibility_classification, 'insufficient_data');
assert.ok(preview.candidate_rows[0].blockers.includes('missing_line_items'));

scenario = makeStore({ reviewRows: [{ id: 'review_open', order_number: 'NV-G33C-GOOD', status: 'open' }] });
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.candidate_rows[0].eligible_for_second_controlled_pilot, false);
assert.equal(preview.candidate_rows[0].eligibility_classification, 'needs_review');
assert.ok(preview.candidate_rows[0].blockers.includes('order_review_queue_blocker'));

scenario = makeStore({ nativeOrders: [], tasks: [] });
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.candidate_rows[0].eligible_for_second_controlled_pilot, false);
assert.equal(preview.candidate_rows[0].eligibility_classification, 'paid_but_native_mirror_missing');
assert.ok(preview.candidate_rows[0].warnings.includes('native_shopify_order_missing_mirror_preview_required'));
assert.equal(preview.candidate_rows[0].next_action, 'run_native_mirror_parity_preview_only');

scenario = makeStore({ tasks: [] });
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.candidate_rows[0].eligible_for_second_controlled_pilot, false);
assert.equal(preview.candidate_rows[0].eligibility_classification, 'paid_but_task_missing');
assert.ok(preview.candidate_rows[0].warnings.includes('native_fulfillment_task_missing_task_preview_required'));
assert.equal(preview.candidate_rows[0].next_action, 'run_native_task_materialization_preview_only');

scenario = makeStore({
  orders: [makeOrder({ status: 'delivered' })],
  nativeOrders: [makeNativeOrder({ production_status: 'bottled', fulfillment_status: 'fulfilled' })],
  tasks: [makeTask({ status: 'delivered', delivery_status: 'delivered' })],
});
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.candidate_rows[0].eligible_for_second_controlled_pilot, false);
assert.equal(preview.candidate_rows[0].already_native_complete, true);
assert.equal(preview.candidate_rows[0].eligibility_classification, 'no_action_needed_already_native_complete');
assert.equal(preview.candidate_rows[0].next_action, 'no_action_already_native_complete');

assert.ok(!source.includes('previewNativeProductionDemandMaterialization'));
assert.ok(!source.includes('previewNativeDeliveryWorkflowReadiness'));
assert.ok(!source.includes('base44.functions.invoke'));
scenario = makeStore({ nativeOrders: [], tasks: [], batches: [] });
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ order_number: 'NV-G33C-GOOD' }) });
assert.equal(preview.candidate_rows[0].production_lifecycle_state, 'not_applicable_until_production_batches_exist');
assert.equal(preview.candidate_rows[0].task_pack_state, 'not_applicable_until_task_exists');
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({
  orders: [
    makeOrder({ id: 'order_good', order_number: 'NV-G33C-GOOD' }),
    makeOrder({ id: 'order_pending', order_number: 'NV-G33C-PENDING', payment_status: 'pending', payment_captured: false }),
  ],
  nativeOrders: [makeNativeOrder()],
  tasks: [makeTask()],
});
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ mode: 'RECENT_CANDIDATE_SCAN', max_recent_candidates: 2 }) });
assert.equal(preview.mode, 'RECENT_CANDIDATE_SCAN');
assert.equal(preview.scanned_count, 2);
assert.equal(preview.candidate_rows.length, 2);
assert.ok(preview.candidate_rows.some(row => row.order_number === 'NV-G33C-GOOD'));
assert.ok(preview.candidate_rows.some(row => row.order_number === 'NV-G33C-PENDING'));

scenario = makeStore({ orders: [makeOrder()], nativeOrders: [makeNativeOrder()], tasks: [makeTask()], batches: [makeBatch()], complianceLogs: [makeComplianceLog()] });
preview = await fns.buildPreview({ base44: scenario.base44, lookup: fns.getLookup({ customer_app_order_id: 'order_good' }) });
assert.equal(preview.mode, 'EXACT_ORDER_PREVIEW');
assert.equal(preview.selected_order_number, 'NV-G33C-GOOD');
assert.equal(preview.candidate_rows[0].production_batch_count, 1);
assert.equal(preview.candidate_rows[0].verified_batch_count, 1);
assert.equal(preview.candidate_rows[0].compliance_log_count, 1);
assert.equal(preview.candidate_rows[0].blockers.length, 0);
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ user: new Error('no auth') });
let res = await handler(req(scenario.base44, { order_number: 'NV-G33C-GOOD' }));
assert.equal(res.status, 401);
assert.equal((await json(res)).writes_performed, false);

scenario = makeStore();
res = await handler(req(scenario.base44, {}, 'GET'));
assert.equal(res.status, 405);
assert.equal((await json(res)).writes_performed, false);

scenario = makeStore();
res = await handler(req(scenario.base44, { order_number: 'NV-G33C-GOOD' }));
assert.equal(res.status, 200);
const handlerResult = await json(res);
assert.equal(handlerResult.success, true);
assert.equal(handlerResult.writes_performed, false);
assert.equal(handlerResult.actor_type, 'admin');
assert.equal(scenario.store.writes.length, 0);

const forbiddenSnippets = [
  '.create(', '.update(', '.delete(', 'sendOrderStatusNotification', 'pushNotification', 'sendSMS', 'sendEmail', 'stripe.', 'Shopify(', 'fetch(', 'runSyncRepair', 'runReplay', 'deductInventory', 'PurchaseOrder.create', 'disableHub',
];
for (const snippet of forbiddenSnippets) {
  assert.ok(!source.includes(snippet), `source must not include forbidden snippet ${snippet}`);
}

console.log('G33C eligible one-time order preview tests passed');
