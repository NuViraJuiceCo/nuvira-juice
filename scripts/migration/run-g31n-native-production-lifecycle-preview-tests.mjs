#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/previewNativeProductionBatchLifecycle/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { planLifecycle, buildOrderLifecyclePreview, buildBatchLifecycleRow, requirePreviewAccess, getLookup, filterProductionBatches };\n`;

  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Date,
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
    createClientFromRequest: req => req.__base44,
    Deno: {
      env: { get: key => env[key] || '' },
      serve: handler => { context.globalThis.__handler = handler; },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, env };
}

function makeBatch(overrides = {}) {
  return {
    id: 'pb_aura',
    batch_id: 'NATIVE-NV-MPZNKGNT-2026-06-05-AURA',
    product_name: 'Aura',
    product_category: 'juice',
    status: 'planned',
    production_date: '2026-06-05',
    planned_units: 1,
    order_sources: [{ order_id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT', quantity: 1, source_type: 'bundle', source_item: 'The NuVira Trio' }],
    related_orders: ['6a22ffda400eb806eb3ca945'],
    source_system: 'customer_app_native_order',
    native_owner_status: 'native_production_batch_materialized_from_g31k_preview',
    procurement_needed: true,
    inventory_deduction_status: 'held',
    ingredient_usage_status: 'not_started',
    ...overrides,
  };
}

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, productionBatches = [makeBatch()], complianceLogs = [], customerOrderOverrides = {}, nativeOrderOverrides = {} } = {}) {
  const customerOrder = {
    id: '6a219a3f4adcda5856c3d579',
    order_number: 'NV-MPZNKGNT',
    payment_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    ...customerOrderOverrides,
  };
  const nativeOrder = {
    id: '6a22ffda400eb806eb3ca945',
    base44_order_id: customerOrder.id,
    shopify_order_number: 'NV-MPZNKGNT',
    payment_status: 'paid',
    production_status: 'awaiting_production',
    fulfillment_status: 'pending',
    ...nativeOrderOverrides,
  };
  const task = {
    id: '6a22ffdaf675ea79e30575aa',
    base44_order_id: customerOrder.id,
    native_shopify_order_id: nativeOrder.id,
    order_number: 'NV-MPZNKGNT',
    status: 'pending',
    delivery_status: 'pending',
    production_date: '2026-06-05',
    assigned_delivery_date: '2026-06-06',
    fulfillment_type: 'delivery',
  };
  const writes = [];
  const filterMatches = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const rowsFor = name => {
    if (name === 'Order') return [customerOrder];
    if (name === 'ShopifyOrder') return [nativeOrder];
    if (name === 'FulfillmentTask') return [task];
    if (name === 'ProductionBatch') return productionBatches;
    if (name === 'BatchComplianceLog') return complianceLogs;
    return [];
  };
  const entityApi = name => ({
    filter: async filter => rowsFor(name).filter(row => filterMatches(row, filter)),
    list: async () => rowsFor(name),
    create: async payload => { writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ op: 'update', name, id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  const base44 = {
    auth: { me: async () => {
      if (user instanceof Error) throw user;
      return user;
    } },
    asServiceRole: {
      entities: {
        Order: entityApi('Order'),
        ShopifyOrder: entityApi('ShopifyOrder'),
        FulfillmentTask: entityApi('FulfillmentTask'),
        ProductionBatch: entityApi('ProductionBatch'),
        BatchComplianceLog: entityApi('BatchComplianceLog'),
      },
    },
  };
  return { base44, writes, customerOrder, nativeOrder, task };
}

function req(base44, body = {}, method = 'POST') {
  return {
    method,
    __base44: base44,
    headers: { get: () => '' },
    text: async () => JSON.stringify(body),
  };
}

async function json(res) {
  return res.json();
}

const { exports: fns, handler } = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });

let previewAuth = await fns.requirePreviewAccess({
  base44: { auth: { me: async () => ({ role: 'admin', email: 'admin@example.test' }) } },
  req: { headers: { get: () => '' } },
  body: {},
});
assert.equal(previewAuth.ok, true);

const planned = makeBatch();
let row = fns.buildBatchLifecycleRow({ batch: planned, actorEmail: 'admin@example.test', requestId: 'g31n_test', now: '2026-06-07T00:00:00.000Z', complianceLogs: [] });
assert.equal(row.classification, 'ready_to_start_preview_only');
assert.equal(row.current_status, 'planned');
assert.equal(row.start_state, 'ready_to_start_preview_only');
assert.equal(row.can_start, true);
assert.equal(row.can_complete, false);
assert.equal(row.can_verify, false);
assert.ok(row.complete_blockers.includes('status_not_completable'));
assert.ok(row.verify_blockers.includes('status_not_verifiable'));
assert.ok(row.lifecycle_warnings.includes('procurement_needed_does_not_block_completion_preview'));

row = fns.buildBatchLifecycleRow({ batch: makeBatch({ is_locked: true }), actorEmail: 'admin@example.test', requestId: 'g31n_locked', now: '2026-06-07T00:00:00.000Z', complianceLogs: [] });
assert.equal(row.can_start, false);
assert.ok(row.start_blockers.includes('batch_locked'));

row = fns.buildBatchLifecycleRow({ batch: makeBatch({ status: 'verified_logged', verified_at: '2026-06-07T00:00:00.000Z' }), actorEmail: 'admin@example.test', requestId: 'g31n_terminal', now: '2026-06-07T00:00:00.000Z', complianceLogs: [] });
assert.equal(row.classification, 'already_completed_or_verified');
assert.equal(row.can_start, false);

row = fns.buildBatchLifecycleRow({ batch: makeBatch({ status: 'in_production', actual_start_time: '2026-06-07T01:00:00.000Z', actual_units: 1 }), actorEmail: 'admin@example.test', requestId: 'g31n_complete', now: '2026-06-07T02:00:00.000Z', complianceLogs: [] });
assert.equal(row.classification, 'ready_to_complete_preview_only');
assert.equal(row.current_status, 'in_production');
assert.equal(row.start_state, 'already_started');
assert.equal(row.complete_state, 'ready_to_complete_preview_only');
assert.equal(row.can_complete, true);

row = fns.buildBatchLifecycleRow({ batch: makeBatch({ status: 'in_production', actual_start_time: '2026-06-07T01:00:00.000Z' }), actorEmail: 'admin@example.test', requestId: 'g31n_missing_actual', now: '2026-06-07T02:00:00.000Z', complianceLogs: [] });
assert.equal(row.current_status, 'in_production');
assert.equal(row.start_state, 'already_started');
assert.equal(row.complete_state, 'complete_blocked_missing_completion_fields');
assert.equal(row.verify_state, 'verify_blocked_until_completion');
assert.equal(row.can_complete, false);
assert.ok(row.complete_blockers.includes('missing_actual_units'));
assert.equal(row.can_start, false);

row = fns.buildBatchLifecycleRow({ batch: makeBatch({ status: 'completed_pending_verification', actual_start_time: '2026-06-07T01:00:00.000Z', actual_end_time: '2026-06-07T02:00:00.000Z', actual_units: 1 }), actorEmail: 'admin@example.test', requestId: 'g31n_verify_missing', now: '2026-06-07T03:00:00.000Z', complianceLogs: [] });
assert.equal(row.can_verify, false);
assert.ok(row.verify_blockers.includes('missing_ph_result'));
assert.ok(row.verify_blockers.includes('missing_batch_pass_fail'));

row = fns.buildBatchLifecycleRow({
  batch: makeBatch({
    status: 'completed_pending_verification',
    actual_start_time: '2026-06-07T01:00:00.000Z',
    actual_end_time: '2026-06-07T02:00:00.000Z',
    actual_units: 1,
    pH_result: 3.7,
    pH_passed_failed: 'passed',
    passed_failed: 'passed',
  }),
  actorEmail: 'admin@example.test',
  requestId: 'g31n_verify_ready',
  now: '2026-06-07T03:00:00.000Z',
  complianceLogs: [],
});
assert.equal(row.classification, 'ready_to_verify_preview_only');
assert.equal(row.can_verify, true);

let store = makeStore({ productionBatches: [
  makeBatch({ id: 'pb_aura', product_name: 'Aura', batch_id: 'NATIVE-NV-MPZNKGNT-2026-06-05-AURA' }),
  makeBatch({ id: 'pb_oasis', product_name: 'Oasis', batch_id: 'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS' }),
] });
let response = await handler(req(store.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT', request_id: 'g31n_handler' }));
assert.equal(response.status, 200);
let body = await json(response);
assert.equal(body.success, true);
assert.equal(body.writes_performed, false);
assert.equal(body.batch_count, 2);
assert.equal(body.start_preview.ready_count, 2);
assert.equal(body.complete_preview.ready_count, 0);
assert.equal(body.verify_preview.ready_count, 0);
assert.equal(body.safety.production_batch_updated, false);
assert.equal(store.writes.length, 0);

store = makeStore({ customerOrderOverrides: { payment_status: 'pending', payment_captured: false }, nativeOrderOverrides: { payment_status: 'pending' } });
response = await handler(req(store.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT' }));
assert.equal(response.status, 409);
body = await json(response);
assert.ok(body.blockers.includes('order_payment_not_confirmed_for_lifecycle_context'));
assert.equal(store.writes.length, 0);

store = makeStore({ user: new Error('no auth') });
response = await handler(req(store.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT' }));
assert.equal(response.status, 401);
assert.equal((await json(response)).error_code, 'unauthorized');

store = makeStore({ user: { role: 'staff', email: 'staff@example.test' } });
response = await handler(req(store.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT' }));
assert.equal(response.status, 403);
assert.equal((await json(response)).error_code, 'forbidden');

store = makeStore();
response = await handler(req(store.base44, {}, 'GET'));
assert.equal(response.status, 405);
assert.equal((await json(response)).error_code, 'method_not_allowed');


store = makeStore({ productionBatches: [makeBatch({ status: 'in_production', actual_start_time: '2026-06-07T01:00:00.000Z' })] });
response = await handler(req(store.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT' }));
assert.equal(response.status, 200);
body = await json(response);
assert.equal(body.start_preview.ready_count, 0);
assert.equal(body.start_preview.blocked_count, 0);
assert.equal(body.start_preview.already_started_count, 1);
assert.equal(body.next_action, 'plan_native_complete_production_preview_or_command');
assert.equal(body.batch_lifecycle_rows[0].current_status, 'in_production');
assert.equal(body.batch_lifecycle_rows[0].start_state, 'already_started');

store = makeStore();
response = await handler(req(store.base44, { mode: 'live', order_number: 'NV-MPZNKGNT' }));
assert.equal(response.status, 400);
assert.equal((await json(response)).error_code, 'dry_run_only');
assert.equal(store.writes.length, 0);

store = makeStore({ productionBatches: [] });
response = await handler(req(store.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT' }));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.success, false);
assert.ok(body.blockers.includes('native_production_batches_not_found'));
assert.equal(store.writes.length, 0);

row = fns.buildBatchLifecycleRow({ batch: makeBatch({ status: 'in_12345678' }), actorEmail: 'admin@example.test', requestId: 'g31q_redaction', now: '2026-06-07T00:00:00.000Z', complianceLogs: [] });
assert.equal(row.current_status, '[redacted provider id]');

console.log('G31N native production lifecycle preview tests passed');
