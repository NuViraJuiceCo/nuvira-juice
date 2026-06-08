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
const PRODUCT_BY_BATCH = {
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA': 'Aura',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS': 'Oasis',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE': 'Pineapple Juice',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT': 'Radiance Shot',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU': 'Re-Nu',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT': 'Reset Shot',
};

function loadCascadeHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/previewNativeProductionVerifyCascades/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { buildPreview, buildTaskPackPreview, buildOrderBottlePreview, requirePreviewAccess, getLookup, findProductionBatches };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler };
}

function loadInventoryHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/previewNativeProductionInventoryReadiness/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  const serveIndex = source.indexOf('Deno.serve');
  if (serveIndex >= 0) source = source.slice(0, serveIndex);
  source += `\nglobalThis.__exports = { buildProductionReadiness, getLookup, safeLineItems, stockToOz };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    Deno: { env: { get: key => env[key] || '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

function makeBatch(batchId, overrides = {}) {
  return {
    id: `pb_${batchId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    batch_id: batchId,
    product_name: PRODUCT_BY_BATCH[batchId],
    status: 'verified_logged',
    production_date: '2026-06-05',
    planned_units: 1,
    actual_units: 1,
    actual_start_time: '2026-06-08T03:37:37.073Z',
    actual_end_time: '2026-06-08T04:49:01.083Z',
    verified_at: '2026-06-08T16:03:53.429Z',
    verified_by: 'owner@example.test',
    compliance_log_id: `compliance_${batchId}`,
    order_sources: [{ order_id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT', quantity: 1 }],
    related_orders: ['6a22ffda400eb806eb3ca945'],
    source_system: 'customer_app_native_order',
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

function context(overrides = {}) {
  const customerOrder = {
    id: '6a219a3f4adcda5856c3d579',
    order_number: 'NV-MPZNKGNT',
    payment_status: 'paid',
    payment_captured: true,
    status: 'scheduled_for_juicing',
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    ...(overrides.customerOrder || {}),
  };
  const nativeOrder = {
    id: '6a22ffda400eb806eb3ca945',
    base44_order_id: customerOrder.id,
    shopify_order_number: 'NV-MPZNKGNT',
    payment_status: 'paid',
    production_status: 'awaiting_production',
    fulfillment_status: 'pending',
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    is_subscription: false,
    ...(overrides.nativeOrder || {}),
  };
  const task = {
    id: '6a22ffdaf675ea79e30575aa',
    base44_order_id: customerOrder.id,
    native_shopify_order_id: nativeOrder.id,
    order_number: 'NV-MPZNKGNT',
    status: 'pending',
    delivery_status: 'pending',
    production_status: 'awaiting_production',
    production_date: '2026-06-05',
    assigned_delivery_date: '2026-06-06',
    fulfillment_type: 'delivery',
    order_type: 'one_time',
    ...(overrides.task || {}),
  };
  const batches = overrides.batches || makeBatches();
  const complianceLogs = overrides.complianceLogs ?? makeComplianceLogs(batches);
  return { customerOrder, nativeOrder, task, batches, complianceLogs };
}

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, customerOrder, nativeOrder, task, batches, complianceLogs, commandLogs = [] } = context()) {
  const writes = [];
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const rowsFor = name => {
    if (name === 'Order') return [customerOrder].filter(Boolean);
    if (name === 'ShopifyOrder') return [nativeOrder].filter(Boolean);
    if (name === 'FulfillmentTask') return [task].filter(Boolean);
    if (name === 'ProductionBatch') return batches || [];
    if (name === 'BatchComplianceLog') return complianceLogs || [];
    if (name === 'CommandLog') return commandLogs || [];
    return [];
  };
  const api = name => ({
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    list: async () => rowsFor(name),
    create: async payload => { writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ op: 'update', name, id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    writes,
    base44: {
      auth: { me: async () => {
        if (user instanceof Error) throw user;
        return user;
      } },
      asServiceRole: { entities: {
        Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), CommandLog: api('CommandLog'),
      } },
    },
  };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

const { exports: fns, handler } = loadCascadeHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const baseContext = context();

let preview = fns.buildPreview({ ...baseContext, commandLogs: [{ id: 'cmd_verify', command_type: 'native_production_batch_verify', status: 'success' }], lookup: { orderNumber: 'NV-MPZNKGNT', productionDate: '2026-06-05', requestId: 'g31w_test' }, auth: { actor_type: 'admin', actor_role: 'admin' } });
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.verified_batch_count, 6);
assert.equal(preview.compliance_log_count, 6);
assert.equal(preview.task_pack_preview.pack_cascade_allowed, true);
assert.equal(preview.task_pack_ready, true);
assert.equal(preview.shopify_order_bottle_preview.order_bottle_cascade_allowed, false);
assert.ok(preview.shopify_order_bottle_preview.blockers.includes('native_fulfillment_task_not_packed'));
assert.equal(preview.customer_status_impact_preview.would_touch_customer_app_order, false);
assert.equal(preview.notification_impact_preview.would_send_notification, false);
assert.equal(preview.safety.fulfillment_task_updated, false);
assert.equal(preview.safety.native_shopify_order_updated, false);
assert.equal(preview.safety.notifications_sent, false);

const packedTaskContext = context({ task: { status: 'packed', production_status: 'packed', packed_at: '2026-06-08T18:00:10.444Z' } });
preview = fns.buildPreview({ ...packedTaskContext, commandLogs: [{ id: 'cmd_verify', command_type: 'native_production_batch_verify', status: 'success' }], lookup: { orderNumber: 'NV-MPZNKGNT', productionDate: '2026-06-05', requestId: 'g31z_ready' }, auth: { actor_type: 'admin', actor_role: 'admin' } });
assert.equal(preview.task_pack_ready, false);
assert.equal(preview.task_pack_already_satisfied, true);
assert.equal(preview.task_pack_preview.pack_command_available, false);
assert.equal(preview.task_pack_preview.pack_action_state, 'already_packed');
assert.equal(preview.shopify_order_bottle_preview.order_bottle_cascade_allowed, true);
assert.equal(preview.shopify_order_bottle_preview.bottle_command_available, true);
assert.equal(preview.next_action, 'plan_gated_native_shopify_order_bottle_command');

const missingCompliance = context({ complianceLogs: [] });
preview = fns.buildPreview({ ...missingCompliance, commandLogs: [], lookup: { orderNumber: 'NV-MPZNKGNT', productionDate: '2026-06-05' }, auth: { actor_type: 'admin', actor_role: 'admin' } });
assert.ok(preview.cascade_blockers.includes('missing_batch_compliance_logs'));
assert.equal(preview.task_pack_preview.pack_cascade_allowed, false);
assert.ok(preview.task_pack_preview.blockers.includes('missing_batch_compliance_logs'));

const nonVerified = context({ batches: makeBatches({ [BATCH_IDS[0]]: { status: 'completed_pending_verification', verified_at: null, verified_by: null } }) });
preview = fns.buildPreview({ ...nonVerified, commandLogs: [], lookup: { orderNumber: 'NV-MPZNKGNT', productionDate: '2026-06-05' }, auth: { actor_type: 'admin', actor_role: 'admin' } });
assert.ok(preview.cascade_blockers.includes('not_all_batches_verified_logged'));
assert.equal(preview.shopify_order_bottle_preview.order_bottle_cascade_allowed, false);

const subscriptionContext = context({ nativeOrder: { is_subscription: true, order_type: 'subscription', fulfillment_mode: 'multi_delivery' }, task: { order_type: 'subscription', fulfillment_type: 'subscription_delivery' } });
preview = fns.buildPreview({ ...subscriptionContext, commandLogs: [], lookup: { orderNumber: 'NV-MPZNKGNT', productionDate: '2026-06-05' }, auth: { actor_type: 'admin', actor_role: 'admin' } });
assert.equal(preview.task_pack_preview.pack_cascade_allowed, true);
assert.equal(preview.shopify_order_bottle_preview.order_bottle_cascade_allowed, false);
assert.ok(preview.shopify_order_bottle_preview.blockers.includes('subscription_multi_delivery_order_bottle_blocked'));

let auth = await fns.requirePreviewAccess({ base44: { auth: { me: async () => ({ role: 'admin', email: 'owner@example.test' }) } }, req: { headers: { get: () => '' } }, body: {} });
assert.equal(auth.ok, true);
auth = await fns.requirePreviewAccess({ base44: { auth: { me: async () => ({ role: 'customer', email: 'customer@example.test' }) } }, req: { headers: { get: () => '' } }, body: {} });
assert.equal(auth.ok, false);
auth = await fns.requirePreviewAccess({ base44: { auth: { me: async () => { throw new Error('auth should not run'); } } }, req: { headers: { get: name => name === 'x-internal-secret' ? 'preview-secret' : '' } }, body: {} });
assert.equal(auth.ok, true);

const store = makeStore({ ...baseContext, commandLogs: [{ id: 'cmd_verify', command_type: 'native_production_batch_verify', status: 'success', related_order_number: 'NV-MPZNKGNT' }] });
let response = await handler(req(store.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT', request_id: 'g31w_handler' }));
let body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.verified_batch_count, 6);
assert.equal(body.compliance_log_count, 6);
assert.equal(body.task_pack_preview.pack_cascade_allowed, true);
assert.equal(body.shopify_order_bottle_preview.order_bottle_cascade_allowed, false);
assert.equal(store.writes.length, 0);

response = await handler(req(store.base44, {}, 'GET'));
body = await json(response);
assert.equal(response.status, 405);
assert.equal(body.writes_performed, false);

const inventoryFns = loadInventoryHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const inventoryLookup = inventoryFns.getLookup({ order_number: 'NV-MPZNKGNT' });
const customerOrder = { id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT', payment_status: 'paid', payment_captured: true, line_items: [{ title: 'Aura', quantity: 1 }] };
const nativeOrder = { id: '6a22ffda400eb806eb3ca945', base44_order_id: customerOrder.id, shopify_order_number: 'NV-MPZNKGNT', payment_status: 'paid', order_type: 'one_time', line_items: customerOrder.line_items };
const task = { id: '6a22ffdaf675ea79e30575aa', native_shopify_order_id: nativeOrder.id, base44_order_id: customerOrder.id, order_number: 'NV-MPZNKGNT', production_date: '2026-06-05', assigned_delivery_date: '2026-06-06', fulfillment_type: 'delivery' };
const readiness = inventoryFns.buildProductionReadiness({
  customerOrder, nativeOrder, task, lookup: inventoryLookup, lineItems: customerOrder.line_items,
  masterData: {
    recipes: [{ id: 'recipe_aura', product_name: 'Aura', ingredients: [{ ingredient_name: 'Apple', quantity_oz: 1 }] }],
    bundles: [], products: [],
    inventoryItems: [{ id: 'inv_apple', ingredient: 'Apple', unit: 'lbs', stock: 1 }],
    ingredientYields: [{ id: 'yield_apple', ingredient_name: 'Apple', purchase_unit: 'lb', oz_per_purchase_unit: 16, units_per_case: 1 }],
  },
  existingBatches: [{ id: 'pb_aura', batch_id: 'NATIVE-NV-MPZNKGNT-2026-06-05-AURA', product_name: 'Aura', production_date: '2026-06-05', status: 'verified_logged', planned_units: 1, order_sources: [{ order_id: customerOrder.id, order_number: 'NV-MPZNKGNT' }], related_orders: [nativeOrder.id] }],
});
assert.equal(readiness.warnings.includes('native_production_batch_not_created'), false);
assert.equal(readiness.warnings.includes('existing_native_production_batch_missing'), false);
assert.equal(readiness.existing_production_batch_context_rows.length, 1);
assert.equal(readiness.writes_performed, false);

console.log('G31W native post-verify cascade preview tests passed');
