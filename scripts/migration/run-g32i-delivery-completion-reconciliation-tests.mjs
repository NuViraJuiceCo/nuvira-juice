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

const OPEN_GATES = {
  ENABLE_NATIVE_DELIVERY_COMPLETION_RECONCILIATION: 'true',
  NATIVE_DELIVERY_COMPLETION_RECONCILIATION_KILL_SWITCH: 'false',
  NATIVE_DELIVERY_COMPLETION_RECONCILIATION_ALLOWED_EMAILS: 'owner@example.test',
  NATIVE_DELIVERY_COMPLETION_RECONCILIATION_ORDER_ALLOWLIST: 'NV-MPZNKGNT',
  NATIVE_DELIVERY_COMPLETION_RECONCILIATION_CUSTOMER_ORDER_ALLOWLIST: '6a219a3f4adcda5856c3d579',
  NATIVE_DELIVERY_COMPLETION_RECONCILIATION_TASK_ALLOWLIST: '6a22ffdaf675ea79e30575aa',
  NATIVE_DELIVERY_COMPLETION_RECONCILIATION_SHOPIFY_ORDER_ALLOWLIST: '6a22ffda400eb806eb3ca945',
  NATIVE_DELIVERY_COMPLETION_RECONCILIATION_POLICY: 'DIRECT_DELIVERED_NO_NOTIFICATION',
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret',
};

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/reconcileNativeDeliveryCompletionForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, preflightTargetContext, buildLocalFreshPreview, validateFreshPreview, buildTaskPatch, buildNativeOrderPatch, validateTaskPatch, validateNativeOrderPatch, applyDeliveryCompletionUpdates, safetyResult, getLookup, fetchFreshPreview, unsupportedBodyKey, canonicalIsoDateTime };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    setTimeout,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, source };
}

function makeCustomerOrder(overrides = {}) {
  return {
    id: '6a219a3f4adcda5856c3d579',
    order_number: 'NV-MPZNKGNT',
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    payment_captured: true,
    production_date: '2026-06-07',
    assigned_delivery_date: '2026-06-08',
    estimated_delivery_date: '2026-06-08',
    status_history: [{ status: 'order_received' }, { status: 'scheduled_for_juicing' }],
    ...(overrides || {}),
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: '6a22ffda400eb806eb3ca945',
    shopify_order_number: 'NV-MPZNKGNT',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    production_status: 'bottled',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    production_date: '2026-06-07',
    assigned_delivery_date: '2026-06-08',
    audit_trail: [],
    ...(overrides || {}),
  };
}

function makeTask(overrides = {}) {
  return {
    id: '6a22ffdaf675ea79e30575aa',
    order_number: 'NV-MPZNKGNT',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    status: 'packed',
    delivery_status: 'pending',
    production_status: 'packed',
    delivery_date: '2026-06-08',
    scheduled_date: '2026-06-08',
    assigned_delivery_date: '2026-06-08',
    production_date: '2026-06-07',
    packed_at: '2026-06-08T18:00:10.444Z',
    audit_trail: [{ action: 'fulfillment_task_pack' }],
    ...(overrides || {}),
  };
}

function makeBatch(batchId, overrides = {}) {
  return {
    id: `pb_${batchId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    batch_id: batchId,
    status: 'verified_logged',
    production_date: '2026-06-05',
    actual_units: 1,
    verified_at: '2026-06-08T16:03:53.429Z',
    verified_by: 'owner@example.test',
    compliance_log_id: `bcl_${batchId}`,
    order_sources: [{ order_id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT' }],
    related_orders: ['6a22ffda400eb806eb3ca945'],
    ...(overrides || {}),
  };
}

function makeBatches(overridesById = {}) {
  return BATCH_IDS.map(id => makeBatch(id, overridesById[id] || {}));
}

function makeComplianceLogs(batches = makeBatches()) {
  return batches.map(batch => ({ id: `bcl_${batch.batch_id}`, batch_id: batch.batch_id, source_production_batch_id: batch.id, locked: true }));
}

function makeStore({
  user = { role: 'admin', email: 'owner@example.test' },
  customerOrder = makeCustomerOrder(),
  nativeOrder = makeNativeOrder(),
  task = makeTask(),
  batches = makeBatches(),
  complianceLogs = makeComplianceLogs(batches),
  commandLogs = [],
  notificationRows = [],
  messageLogs = [],
  failTaskUpdate = false,
  failNativeOrderUpdate = false,
  failCommandLogCreate = false,
  failCommandLogUpdate = false,
  previewInvokeError = null,
  previewInvokeResponse = null,
} = {}) {
  const store = {
    customerOrders: customerOrder ? [customerOrder] : [],
    nativeOrders: nativeOrder ? [nativeOrder] : [],
    tasks: task ? [task] : [],
    batches: batches || [],
    complianceLogs: complianceLogs || [],
    commandLogs: commandLogs || [],
    notificationRows: notificationRows || [],
    messageLogs: messageLogs || [],
    otherWrites: [],
  };
  const rowsFor = name => {
    if (name === 'Order') return store.customerOrders;
    if (name === 'ShopifyOrder') return store.nativeOrders;
    if (name === 'FulfillmentTask') return store.tasks;
    if (name === 'ProductionBatch') return store.batches;
    if (name === 'BatchComplianceLog') return store.complianceLogs;
    if (name === 'CommandLog') return store.commandLogs;
    if (name === 'Notification') return store.notificationRows;
    if (name === 'CustomerMessageDeliveryLog') return store.messageLogs;
    return [];
  };
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    get: async id => rowsFor(name).find(row => row.id === id) || null,
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    list: async () => rowsFor(name),
    create: async payload => {
      if (name === 'CommandLog' && failCommandLogCreate) throw new Error('simulated CommandLog create failure');
      const row = { id: `${name.toLowerCase()}_${name === 'CommandLog' ? store.commandLogs.length + 1 : store.otherWrites.length + 1}`, ...payload };
      if (name === 'CommandLog') store.commandLogs.push(row);
      else store.otherWrites.push({ op: 'create', name, payload });
      return row;
    },
    update: async (id, patch) => {
      if (name === 'FulfillmentTask' && failTaskUpdate) throw new Error('simulated FulfillmentTask update failure');
      if (name === 'ShopifyOrder' && failNativeOrderUpdate) throw new Error('simulated ShopifyOrder update failure');
      if (name === 'CommandLog' && failCommandLogUpdate) throw new Error('simulated CommandLog update failure');
      const rows = rowsFor(name);
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) throw new Error(`${name} not found`);
      const updated = { ...rows[index], ...patch };
      rows[index] = updated;
      if (name !== 'CommandLog') store.otherWrites.push({ op: 'update', name, id, patch });
      return updated;
    },
  });
  return {
    store,
    base44: {
      auth: { me: async () => {
        if (user instanceof Error) throw user;
        return user;
      } },
      asServiceRole: {
        entities: { Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), CommandLog: api('CommandLog'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog') },
        functions: { invoke: async () => {
          if (previewInvokeError) throw previewInvokeError;
          if (previewInvokeResponse) return previewInvokeResponse;
          throw new Error('unexpected service preview invocation');
        } },
      },
    },
  };
}

function validBody(overrides = {}) {
  return {
    mode: 'live',
    order_number: 'NV-MPZNKGNT',
    customer_app_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    actual_delivered_at: '2026-06-08T14:30:00.000Z',
    notification_policy: 'NO_NOTIFICATION',
    proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
    correction_mode: 'DIRECT_DELIVERED_NO_NOTIFICATION',
    request_id: 'g32i_test_request',
    confirmation: 'reconcile_native_delivery_completion_no_notification',
    ...(overrides || {}),
  };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

let harness = loadHarness({});
let storeSetup = makeStore();
let res = await harness.handler(req(storeSetup.base44, validBody()));
let body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'native_delivery_completion_reconciliation_disabled');
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.tasks[0].status, 'packed');
assert.equal(storeSetup.store.commandLogs.length, 0);

harness = loadHarness(OPEN_GATES);
storeSetup = makeStore({ user: null });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 401);
assert.equal(body.error_code, 'unauthorized');
assert.equal(storeSetup.store.commandLogs.length, 0);

storeSetup = makeStore({ user: { role: 'staff', email: 'staff@example.test' } });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 403);
assert.equal(body.error_code, 'forbidden');

storeSetup = makeStore();
res = await harness.handler(req(storeSetup.base44, validBody({ actual_delivered_at: '' })));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('actual_delivered_at_required'));

storeSetup = makeStore();
res = await harness.handler(req(storeSetup.base44, validBody({ actual_delivered_at: 'June 8' })));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('actual_delivered_at_must_be_valid_iso_timestamp'));

storeSetup = makeStore({ task: null });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'delivery_completion_reconciliation_preflight_blocked');
assert.ok(body.blockers.includes('native_fulfillment_task_not_found'));

storeSetup = makeStore({ task: makeTask({ status: 'pending' }) });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('native_fulfillment_task_not_packed_or_delivered'));

storeSetup = makeStore({ nativeOrder: makeNativeOrder({ production_status: 'awaiting_production' }) });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('native_shopify_order_not_bottled'));

storeSetup = makeStore();
res = await harness.handler(req(storeSetup.base44, validBody({ notification_policy: 'SEND_NOTIFICATION' })));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('notification_policy_must_be_no_notification'));

storeSetup = makeStore();
res = await harness.handler(req(storeSetup.base44, validBody({ proof_drop_policy: 'REQUIRE_PROOF' })));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('proof_drop_policy_must_be_held_not_required_for_reconciliation'));

storeSetup = makeStore();
res = await harness.handler(req(storeSetup.base44, validBody({ proof_url: 'https://example.invalid/proof.jpg' })));
body = await json(res);
assert.equal(res.status, 400);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(storeSetup.store.otherWrites.length, 0);

storeSetup = makeStore({ batches: makeBatches({ [BATCH_IDS[0]]: { status: 'completed_pending_verification' } }) });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes(`production_batch_context_blocked:${BATCH_IDS[0]}`));

storeSetup = makeStore({ complianceLogs: makeComplianceLogs().slice(0, 5) });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('batch_compliance_log_count_mismatch'));

storeSetup = makeStore();
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.writes_performed, true);
assert.equal(body.native_fulfillment_task_updated, true);
assert.equal(body.native_shopify_order_updated, true);
assert.equal(storeSetup.store.tasks[0].status, 'delivered');
assert.equal(storeSetup.store.tasks[0].delivery_status, 'delivered');
assert.equal(storeSetup.store.tasks[0].production_status, 'packed');
assert.equal(storeSetup.store.tasks[0].delivered_at, '2026-06-08T14:30:00.000Z');
assert.equal(storeSetup.store.nativeOrders[0].fulfillment_status, 'fulfilled');
assert.equal(storeSetup.store.nativeOrders[0].production_status, 'bottled');
assert.equal(storeSetup.store.customerOrders[0].status, 'scheduled_for_juicing');
assert.equal(storeSetup.store.customerOrders[0].status_history.length, 2);
assert.equal(storeSetup.store.notificationRows.length, 0);
assert.equal(storeSetup.store.messageLogs.length, 0);
assert.equal(storeSetup.store.commandLogs.length, 1);
assert.equal(storeSetup.store.commandLogs[0].status, 'success');
assert.equal(storeSetup.store.commandLogs[0].result.writes_performed, true);
assert.equal(storeSetup.store.commandLogs[0].result.customer_app_order_updated, false);
assert.equal(storeSetup.store.commandLogs[0].result.status_history_appended, false);
assert.equal(storeSetup.store.commandLogs[0].result.notifications_sent, false);
const writes = storeSetup.store.otherWrites;
assert.equal(writes.length, 2);
assert.deepEqual(writes.map(w => w.name).sort(), ['FulfillmentTask', 'ShopifyOrder']);
assert.deepEqual(Object.keys(writes.find(w => w.name === 'FulfillmentTask').patch).sort(), ['audit_trail', 'delivered_at', 'delivery_status', 'status']);
assert.deepEqual(Object.keys(writes.find(w => w.name === 'ShopifyOrder').patch).sort(), ['audit_trail', 'fulfillment_status']);

res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.commandLogs.length, 1);
assert.equal(storeSetup.store.otherWrites.length, 2);

storeSetup = makeStore({ commandLogs: [{ id: 'cmd_failed', status: 'failed', idempotency_key: 'native_delivery_completion_reconciliation:g32i_test_request', request_id: 'g32i_test_request' }] });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'previous_failed_request_id_not_reusable');
assert.equal(storeSetup.store.otherWrites.length, 0);

storeSetup = makeStore({ failNativeOrderUpdate: true });
res = await harness.handler(req(storeSetup.base44, validBody({ request_id: 'g32i_partial_test' })));
body = await json(res);
assert.equal(res.status, 500);
assert.equal(body.writes_performed, true);
assert.equal(body.reconciliation_required, true);
assert.equal(storeSetup.store.tasks[0].status, 'delivered');
assert.equal(storeSetup.store.nativeOrders[0].fulfillment_status, 'pending');
assert.equal(storeSetup.store.commandLogs[0].status, 'failed');
assert.equal(storeSetup.store.commandLogs[0].result.native_fulfillment_task_updated, true);
assert.equal(storeSetup.store.commandLogs[0].result.native_shopify_order_updated, false);

storeSetup = makeStore();
let preflight = await harness.exports.preflightTargetContext(storeSetup.base44, harness.exports.getLookup(validBody()));
assert.equal(preflight.ready, true);
let preview = harness.exports.buildLocalFreshPreview(preflight, harness.exports.getLookup(validBody()));
let validation = harness.exports.validateFreshPreview(preview, harness.exports.getLookup(validBody()));
assert.equal(validation.ready, true);

const taskPatch = harness.exports.buildTaskPatch({ task: makeTask(), actualDeliveredAtIso: '2026-06-08T14:30:00.000Z', actorEmail: 'owner@example.test', requestId: 'g32i_test_request', now: '2026-06-08T15:00:00.000Z' });
assert.equal(harness.exports.validateTaskPatch(taskPatch).length, 0);
assert.equal(taskPatch.production_status, undefined);
assert.equal(taskPatch.proof_url, undefined);
const orderPatch = harness.exports.buildNativeOrderPatch({ nativeOrder: makeNativeOrder(), actorEmail: 'owner@example.test', requestId: 'g32i_test_request', now: '2026-06-08T15:00:00.000Z' });
assert.equal(harness.exports.validateNativeOrderPatch(orderPatch).length, 0);
assert.equal(orderPatch.production_status, undefined);
assert.equal(orderPatch.delivered_at, undefined);
assert.ok(harness.exports.validateTaskPatch({ ...taskPatch, route_id: 'route_1' }).includes('unapproved_fulfillment_task_delivery_field:route_id'));
assert.ok(harness.exports.validateNativeOrderPatch({ ...orderPatch, production_status: 'delivered' }).includes('unapproved_native_shopify_order_delivery_field:production_status'));

harness = loadHarness({ ...OPEN_GATES, NATIVE_DELIVERY_COMPLETION_RECONCILIATION_USE_SERVICE_PREVIEW: 'true' });
storeSetup = makeStore({ previewInvokeError: Object.assign(new Error('preview timeout'), { status: 504, code: 'native_delivery_completion_reconciliation_preview_timeout' }) });
res = await harness.handler(req(storeSetup.base44, validBody({ request_id: 'g32i_preview_fail' })));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'native_delivery_completion_reconciliation_preview_timeout');
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.otherWrites.length, 0);
assert.equal(storeSetup.store.commandLogs.length, 0);

console.log('G32I delivery completion reconciliation command tests passed.');
