#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const BATCH_IDS = [
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT',
];
const PRODUCTS = {
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA': 'Aura',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS': 'Oasis',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE': 'Pineapple Juice',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT': 'Radiance Shot',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU': 'Re-Nu',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT': 'Reset Shot',
};

function loadCommandHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/bottleNativeProductionShopifyOrderForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, fetchFreshPreview, validateFreshPreview, preflightTargetContext, buildLocalFreshBottlePreview, buildBottlePatch, validateBottlePatch, updateNativeShopifyOrderBottle, requireAdmin, getLookup };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, setTimeout,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, env };
}

function loadCascadeHarness() {
  const filePath = path.join(repoRoot, 'base44/functions/previewNativeProductionVerifyCascades/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { buildPreview, buildTaskPackPreview, buildOrderBottlePreview };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: () => '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

function makeCustomerOrder(overrides = {}) {
  return {
    id: '6a219a3f4adcda5856c3d579',
    order_number: 'NV-MPZNKGNT',
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    payment_captured: true,
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    ...(overrides || {}),
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: '6a22ffda400eb806eb3ca945',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    shopify_order_number: 'NV-MPZNKGNT',
    production_status: 'awaiting_production',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    is_subscription: false,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    audit_trail: [],
    ...(overrides || {}),
  };
}

function makeTask(overrides = {}) {
  return {
    id: '6a22ffdaf675ea79e30575aa',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    shopify_order_id: '6a22ffda400eb806eb3ca945',
    order_number: 'NV-MPZNKGNT',
    status: 'packed',
    delivery_status: 'pending',
    production_status: 'packed',
    packed_at: '2026-06-08T18:00:10.444Z',
    production_date: '2026-06-05',
    delivery_date: '2026-06-06',
    assigned_delivery_date: '2026-06-06',
    fulfillment_type: 'delivery',
    items: [{ title: 'Aura', quantity: 1 }],
    audit_trail: [{ action: 'fulfillment_task_pack' }],
    ...(overrides || {}),
  };
}

function makeBatch(batchId, overrides = {}) {
  return {
    id: `pb_${batchId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    batch_id: batchId,
    product_name: PRODUCTS[batchId],
    status: 'verified_logged',
    production_date: '2026-06-05',
    planned_units: 1,
    actual_units: 1,
    actual_start_time: '2026-06-08T03:37:37.073Z',
    actual_end_time: '2026-06-08T04:49:01.083Z',
    verified_at: '2026-06-08T16:03:53.429Z',
    verified_by: 'owner@example.test',
    compliance_log_id: `bcl_${batchId}`,
    order_sources: [{ order_id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT', quantity: 1 }],
    related_orders: ['6a22ffda400eb806eb3ca945'],
    ...(overrides || {}),
  };
}

function makeBatches(overridesById = {}) {
  return BATCH_IDS.map(batchId => makeBatch(batchId, overridesById[batchId] || {}));
}

function makeComplianceLogs(batches = makeBatches()) {
  return batches.map(batch => ({
    id: `bcl_${batch.batch_id}`,
    batch_id: batch.batch_id,
    source_production_batch_id: batch.id,
    juice_flavor: batch.product_name,
    date: batch.production_date,
    quantity_produced: 1,
    pH_result: 3.8,
    passed_failed: 'passed',
    verified_by: 'owner@example.test',
    verified_at: '2026-06-08T16:03:53.429Z',
    locked: true,
  }));
}

function makePreview(overrides = {}) {
  const nativeOrder = overrides.nativeOrder || makeNativeOrder();
  const task = overrides.task || makeTask();
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    order_number: 'NV-MPZNKGNT',
    customer_app_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    production_date: '2026-06-05',
    delivery_date: '2026-06-06',
    customer_app_order_present: true,
    native_shopify_order_present: true,
    native_fulfillment_task_present: true,
    verified_batch_count: 6,
    production_batch_count: 6,
    compliance_log_count: 6,
    task_pack_ready: false,
    task_pack_already_satisfied: true,
    task_pack_preview: {
      task_id: '6a22ffdaf675ea79e30575aa',
      current_task_status: task.status,
      current_delivery_status: task.delivery_status,
      current_production_status: task.production_status,
      pack_cascade_allowed: true,
      task_pack_already_satisfied: true,
      task_already_satisfied: true,
      pack_action_state: 'already_packed',
      would_update_task_status: false,
      proposed_task_status: 'packed',
      would_update_production_status: false,
      proposed_production_status: 'packed',
      would_update_delivery_status: false,
      proposed_delivery_status: task.delivery_status,
      blockers: [],
      warnings: ['task_already_packed_or_bottled'],
      pack_command_available: false,
      pack_command_gated: true,
      pack_requires_exact_approval: false,
    },
    shopify_order_bottle_ready: true,
    shopify_order_bottle_preview: {
      native_shopify_order_id: '6a22ffda400eb806eb3ca945',
      order_number: 'NV-MPZNKGNT',
      current_production_status: nativeOrder.production_status,
      current_fulfillment_status: nativeOrder.fulfillment_status,
      order_type: nativeOrder.order_type,
      fulfillment_mode: nativeOrder.fulfillment_mode,
      is_subscription: false,
      order_bottle_cascade_allowed: true,
      bottle_command_available: true,
      bottle_command_gated: true,
      bottle_requires_exact_approval: true,
      already_bottled: false,
      would_update_native_shopify_order: true,
      proposed_production_status: 'bottled',
      proposed_fulfillment_status: nativeOrder.fulfillment_status,
      would_update_fulfillment_status: false,
      customer_app_order_sync_deferred: true,
      notifications_deferred: true,
      blockers: [],
      warnings: [],
    },
    customer_status_impact_preview: {
      would_touch_customer_app_order: false,
      customer_facing_status_changes_held: true,
      status_history_append_held: true,
    },
    notification_impact_preview: {
      would_send_notification: false,
      non_confirmation_notifications_disabled_until_separate_approval: true,
    },
    cascade_blockers: [],
    cascade_warnings: ['customer_facing_status_held', 'notifications_held'],
    safety: {
      writes_performed: false,
      fulfillment_task_updated: false,
      native_shopify_order_updated: false,
      customer_app_order_updated: false,
      production_batch_updated: false,
      compliance_logs_created: false,
      notifications_sent: false,
      provider_calls_performed: false,
      shopify_api_calls_performed: false,
      stripe_calls_performed: false,
    },
    ...(overrides.preview || {}),
  };
}

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, preview = makePreview(), previewInvokeError = null, customerOrder = makeCustomerOrder(), nativeOrder = makeNativeOrder(), task = makeTask(), productionBatches = makeBatches(), complianceLogs = makeComplianceLogs(productionBatches), commandLogs = [], failCommandLogCreate = false, failCommandLogUpdate = false } = {}) {
  const store = {
    customerOrders: customerOrder ? [{ ...customerOrder }] : [],
    nativeOrders: nativeOrder ? [{ ...nativeOrder }] : [],
    tasks: task ? [{ ...task }] : [],
    productionBatches: productionBatches.map(row => ({ ...row })),
    complianceLogs: complianceLogs.map(row => ({ ...row })),
    commandLogs: commandLogs.map(row => ({ ...row })),
    otherWrites: [],
  };
  const matchFilter = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const rowsFor = name => {
    if (name === 'Order') return store.customerOrders;
    if (name === 'ShopifyOrder') return store.nativeOrders;
    if (name === 'FulfillmentTask') return store.tasks;
    if (name === 'ProductionBatch') return store.productionBatches;
    if (name === 'BatchComplianceLog') return store.complianceLogs;
    if (name === 'CommandLog') return store.commandLogs;
    return [];
  };
  const entityApi = name => ({
    get: async id => rowsFor(name).find(row => row.id === id) || null,
    filter: async filter => rowsFor(name).filter(row => matchFilter(row, filter)),
    create: async payload => {
      if (name === 'CommandLog' && failCommandLogCreate) throw new Error('simulated CommandLog create failure');
      const row = { id: `${name.toLowerCase()}_${rowsFor(name).length + 1}`, ...payload };
      if (name === 'CommandLog') store.commandLogs.push(row);
      else store.otherWrites.push({ op: 'create', name, payload });
      return row;
    },
    update: async (id, patch) => {
      const row = rowsFor(name).find(item => item.id === id);
      if (!row) throw new Error(`${name} not found`);
      if (name === 'CommandLog' && failCommandLogUpdate) throw new Error('simulated CommandLog update failure');
      if (name !== 'ShopifyOrder' && name !== 'CommandLog') store.otherWrites.push({ op: 'update', name, id, patch });
      Object.assign(row, patch);
      return row;
    },
  });
  const base44 = {
    auth: { me: async () => {
      if (user instanceof Error) throw user;
      return user;
    } },
    asServiceRole: {
      functions: { invoke: async (name, body) => {
        if (previewInvokeError) throw previewInvokeError;
        assert.equal(name, 'previewNativeProductionVerifyCascades');
        assert.equal(body.order_number, 'NV-MPZNKGNT');
        assert.equal(body.native_shopify_order_id, '6a22ffda400eb806eb3ca945');
        return { data: preview };
      } },
      entities: {
        Order: entityApi('Order'),
        ShopifyOrder: entityApi('ShopifyOrder'),
        FulfillmentTask: entityApi('FulfillmentTask'),
        ProductionBatch: entityApi('ProductionBatch'),
        BatchComplianceLog: entityApi('BatchComplianceLog'),
        CommandLog: entityApi('CommandLog'),
      },
    },
  };
  return { base44, store };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

function liveBody(overrides = {}) {
  return {
    mode: 'live',
    confirmation: 'bottle_native_shopify_order_for_customer_app',
    order_number: 'NV-MPZNKGNT',
    production_date: '2026-06-05',
    customer_app_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    expected_production_status: 'bottled',
    request_id: 'g31z_bottle_test',
    ...overrides,
  };
}

const cascadeFns = loadCascadeHarness();
let cascadePreview = cascadeFns.buildPreview({
  customerOrder: makeCustomerOrder(),
  nativeOrder: makeNativeOrder(),
  task: makeTask({ status: 'pending', production_status: 'awaiting_production', packed_at: null }),
  batches: makeBatches(),
  complianceLogs: makeComplianceLogs(),
  commandLogs: [],
  lookup: { orderNumber: 'NV-MPZNKGNT', productionDate: '2026-06-05' },
  auth: { actor_type: 'admin', actor_role: 'admin' },
});
assert.equal(cascadePreview.task_pack_ready, true);
assert.equal(cascadePreview.task_pack_already_satisfied, false);
assert.equal(cascadePreview.shopify_order_bottle_ready, false);
assert.ok(cascadePreview.shopify_order_bottle_preview.blockers.includes('native_fulfillment_task_not_packed'));

cascadePreview = cascadeFns.buildPreview({
  customerOrder: makeCustomerOrder(),
  nativeOrder: makeNativeOrder(),
  task: makeTask(),
  batches: makeBatches(),
  complianceLogs: makeComplianceLogs(),
  commandLogs: [],
  lookup: { orderNumber: 'NV-MPZNKGNT', productionDate: '2026-06-05' },
  auth: { actor_type: 'admin', actor_role: 'admin' },
});
assert.equal(cascadePreview.task_pack_ready, false);
assert.equal(cascadePreview.task_pack_already_satisfied, true);
assert.equal(cascadePreview.shopify_order_bottle_ready, true);
assert.equal(cascadePreview.shopify_order_bottle_preview.proposed_production_status, 'bottled');
assert.equal(cascadePreview.shopify_order_bottle_preview.bottle_command_available, true);
assert.equal(cascadePreview.next_action, 'plan_gated_native_shopify_order_bottle_command');

const harness = loadCommandHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const { exports: fns, handler, env } = harness;
const commandSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/bottleNativeProductionShopifyOrderForCustomerApp/entry.ts'), 'utf8');
assert.equal(commandSource.includes('g31z_gated_native_shopify_order_bottle_command'), true);
assert.equal(/fetch\s*\(/.test(commandSource), false);

let lookup = fns.getLookup(liveBody());
assert.equal(fns.exactTargetBlockers(lookup).length, 0);
assert.ok(fns.exactTargetBlockers({ ...lookup, orderNumber: 'WRONG' }).includes('target_order_number_mismatch'));
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'native_shopify_order_bottle_disabled');

env.ENABLE_NATIVE_SHOPIFY_ORDER_BOTTLE = 'true';
env.NATIVE_SHOPIFY_ORDER_BOTTLE_KILL_SWITCH = 'false';
env.NATIVE_SHOPIFY_ORDER_BOTTLE_ALLOWED_EMAILS = 'owner@example.test';
env.NATIVE_SHOPIFY_ORDER_BOTTLE_ORDER_ALLOWLIST = 'NV-MPZNKGNT';
env.NATIVE_SHOPIFY_ORDER_BOTTLE_SHOPIFY_ORDER_ALLOWLIST = '6a22ffda400eb806eb3ca945';
env.NATIVE_SHOPIFY_ORDER_BOTTLE_POLICY = 'EXACT_VERIFIED_PACKED_ONE_TIME_ORDER_ONLY';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), null);
env.NATIVE_SHOPIFY_ORDER_BOTTLE_KILL_SWITCH = 'true';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'kill_switch_active');
env.NATIVE_SHOPIFY_ORDER_BOTTLE_KILL_SWITCH = 'false';

let validation = fns.validateFreshPreview(makePreview());
assert.equal(validation.ready, true);
validation = fns.validateFreshPreview(makePreview({ preview: { shopify_order_bottle_ready: false } }));
assert.equal(validation.ready, false);
assert.ok(validation.blockers.includes('fresh_preview_shopify_order_bottle_not_ready'));
validation = fns.validateFreshPreview({ success: true, dry_run: true, writes_performed: false });
assert.equal(validation.ready, false);
assert.ok(validation.blockers.includes('fresh_preview_order_number_mismatch'));

let storeSetup = makeStore();
let preflight = await fns.preflightTargetContext(storeSetup.base44);
const localPreview = fns.buildLocalFreshBottlePreview(preflight);
assert.equal(localPreview.preview_source, 'local_preflight');
assert.equal(localPreview.shopify_order_bottle_ready, true);
assert.equal(localPreview.task_pack_already_satisfied, true);
assert.equal(fns.validateFreshPreview(localPreview).ready, true);

const previewError = new Error('simulated preview invoke failure');
previewError.status = 502;
storeSetup = makeStore({ previewInvokeError: previewError });
let previewFailure = await fns.fetchFreshPreview(storeSetup.base44, lookup);
assert.equal(previewFailure.ok, false);
assert.equal(previewFailure.status, 502);
assert.equal(previewFailure.error_code, 'native_shopify_order_bottle_preview_failed');

let patch = fns.buildBottlePatch({ nativeOrder: makeNativeOrder(), actorEmail: 'owner@example.test', requestId: 'req_1', now: '2026-06-08T18:30:00.000Z' });
assert.equal(patch.production_status, 'bottled');
assert.equal(patch.fulfillment_status, undefined);
assert.equal(fns.validateBottlePatch(patch).length, 0);
assert.ok(fns.validateBottlePatch({ ...patch, fulfillment_status: 'packed' }).includes('unapproved_native_shopify_order_bottle_field:fulfillment_status'));
assert.deepEqual(Object.keys(patch).sort(), ['audit_trail', 'production_status'].sort());

storeSetup = makeStore();
preflight = await fns.preflightTargetContext(storeSetup.base44);
assert.equal(preflight.ready, true);
assert.equal(preflight.mode, 'bottle');

storeSetup = makeStore();
let response = await handler(req(storeSetup.base44, liveBody(), 'GET'));
let body = await json(response);
assert.equal(response.status, 405);
assert.equal(body.writes_performed, false);

storeSetup = makeStore({ user: new Error('unauthorized') });
response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 401);
assert.equal(body.error_code, 'unauthorized');
assert.equal(body.writes_performed, false);

const savedEnable = env.ENABLE_NATIVE_SHOPIFY_ORDER_BOTTLE;
env.ENABLE_NATIVE_SHOPIFY_ORDER_BOTTLE = 'false';
storeSetup = makeStore();
response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'native_shopify_order_bottle_disabled');
assert.equal(body.writes_performed, false);
env.ENABLE_NATIVE_SHOPIFY_ORDER_BOTTLE = savedEnable;

storeSetup = makeStore();
response = await handler(req(storeSetup.base44, liveBody({ delivery_status: 'ready_for_delivery' })));
body = await json(response);
assert.equal(response.status, 400);
assert.equal(body.error_code, 'unsupported_request_field');

storeSetup = makeStore({ nativeOrder: null });
response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'native_shopify_order_bottle_preflight_blocked');
assert.ok(body.blockers.includes('native_shopify_order_not_found'));
assert.equal(body.writes_performed, false);

storeSetup = makeStore({ task: makeTask({ status: 'pending', production_status: 'awaiting_production', packed_at: null }) });
response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 409);
assert.ok(body.blockers.includes('native_fulfillment_task_not_packed'));
assert.equal(body.writes_performed, false);

storeSetup = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'completed_pending_verification' } }) });
response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 409);
assert.ok(body.blockers.includes(`production_batch_context_blocked:${BATCH_IDS[0]}`));
assert.equal(body.writes_performed, false);

storeSetup = makeStore({ complianceLogs: [] });
response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 409);
assert.ok(body.blockers.some(item => item.startsWith('production_batch_context_blocked:')));
assert.equal(body.writes_performed, false);

storeSetup = makeStore({ nativeOrder: makeNativeOrder({ is_subscription: true, order_type: 'subscription', fulfillment_mode: 'multi_delivery' }) });
response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 409);
assert.ok(body.blockers.includes('native_shopify_order_subscription_blocked'));
assert.equal(body.writes_performed, false);

storeSetup = makeStore({ nativeOrder: makeNativeOrder({ payment_status: 'refunded' }) });
response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 409);
assert.ok(body.blockers.includes('native_shopify_order_cancelled_or_refunded'));
assert.equal(body.writes_performed, false);

storeSetup = makeStore({ previewInvokeError: previewError });
response = await handler(req(storeSetup.base44, liveBody({ request_id: 'g31z_bottle_local_preview' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.writes_performed, true);
assert.equal(storeSetup.store.nativeOrders[0].production_status, 'bottled');
assert.equal(storeSetup.store.nativeOrders[0].fulfillment_status, 'pending');
assert.equal(storeSetup.store.tasks[0].status, 'packed');
assert.equal(storeSetup.store.commandLogs.length, 1);


env.NATIVE_SHOPIFY_ORDER_BOTTLE_USE_SERVICE_PREVIEW = 'true';
storeSetup = makeStore({ previewInvokeError: previewError });
response = await handler(req(storeSetup.base44, liveBody({ request_id: 'g31z_bottle_service_preview_failure' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.success, false);
assert.equal(body.error_code, 'native_shopify_order_bottle_preview_failed');
assert.equal(body.preview_status, 502);
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.nativeOrders[0].production_status, 'awaiting_production');
assert.equal(storeSetup.store.commandLogs.length, 0);
env.NATIVE_SHOPIFY_ORDER_BOTTLE_USE_SERVICE_PREVIEW = 'false';

storeSetup = makeStore({ failCommandLogCreate: true });
response = await handler(req(storeSetup.base44, liveBody({ request_id: 'g31z_bottle_command_log_create_failure' })));
body = await json(response);
assert.equal(response.status, 500);
assert.equal(body.error_code, 'native_shopify_order_bottle_command_log_create_failed');
assert.equal(body.writes_performed, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(storeSetup.store.nativeOrders[0].production_status, 'awaiting_production');

storeSetup = makeStore({ failCommandLogUpdate: true });
response = await handler(req(storeSetup.base44, liveBody({ request_id: 'g31z_bottle_command_log_update_failure' })));
body = await json(response);
assert.equal(response.status, 500);
assert.equal(body.error_code, 'native_shopify_order_bottle_command_log_update_failed');
assert.equal(body.writes_performed, true);
assert.equal(body.reconciliation_required, true);
assert.equal(body.native_shopify_order_updated, true);
assert.equal(storeSetup.store.nativeOrders[0].production_status, 'bottled');
assert.equal(storeSetup.store.tasks[0].status, 'packed');

storeSetup = makeStore();
response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.writes_performed, true);
assert.equal(body.native_shopify_order_updated, true);
assert.equal(body.shopify_order_bottled, true);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(body.customer_app_order_updated, false);
assert.equal(body.notifications_sent, false);
assert.equal(body.delivery_status_updated, false);
assert.equal(body.delivery_route_proof_drop_mutated, false);
assert.equal(storeSetup.store.nativeOrders[0].production_status, 'bottled');
assert.equal(storeSetup.store.nativeOrders[0].fulfillment_status, 'pending');
assert.equal(storeSetup.store.nativeOrders[0].audit_trail.length, 1);
assert.equal(storeSetup.store.tasks[0].status, 'packed');
assert.equal(storeSetup.store.tasks[0].production_status, 'packed');
assert.equal(storeSetup.store.customerOrders[0].status, 'scheduled_for_juicing');
assert.equal(storeSetup.store.commandLogs.length, 1);
assert.equal(storeSetup.store.commandLogs[0].status, 'success');
assert.equal(storeSetup.store.otherWrites.length, 0);

response = await handler(req(storeSetup.base44, liveBody()));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.nativeOrders[0].audit_trail.length, 1);
assert.equal(storeSetup.store.commandLogs.length, 1);

storeSetup = makeStore({ nativeOrder: makeNativeOrder({ production_status: 'bottled', audit_trail: [{ action: 'native_shopify_order_bottle' }] }) });
response = await handler(req(storeSetup.base44, liveBody({ request_id: 'g31z_bottle_already' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.reason, 'native_shopify_order_already_bottled');
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.nativeOrders[0].audit_trail.length, 1);
assert.equal(storeSetup.store.commandLogs.length, 1);
assert.equal(storeSetup.store.commandLogs[0].status, 'skipped');

console.log('G31Z native ShopifyOrder bottle command tests passed');
