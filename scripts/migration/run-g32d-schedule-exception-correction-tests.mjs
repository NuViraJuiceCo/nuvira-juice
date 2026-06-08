#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const TARGET = {
  order_number: 'NV-MPZNKGNT',
  customer_app_order_id: '6a219a3f4adcda5856c3d579',
  native_shopify_order_id: '6a22ffda400eb806eb3ca945',
  native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
  current_recorded_production_date: '2026-06-05',
  current_recorded_delivery_date: '2026-06-06',
  actual_production_date: '2026-06-07',
  actual_delivery_date: '2026-06-08',
  correction_mode: 'DATE_ONLY',
  leave_delivery_window_unchanged: true,
  notification_policy: 'NO_NOTIFICATION',
  confirmation: 'correct_native_schedule_exception_date_only_no_notification',
};

const OPEN_GATES = {
  ENABLE_NATIVE_SCHEDULE_EXCEPTION_CORRECTION: 'true',
  NATIVE_SCHEDULE_EXCEPTION_CORRECTION_KILL_SWITCH: 'false',
  NATIVE_SCHEDULE_EXCEPTION_CORRECTION_ALLOWED_EMAILS: 'owner@example.test',
  NATIVE_SCHEDULE_EXCEPTION_CORRECTION_ORDER_ALLOWLIST: 'NV-MPZNKGNT',
  NATIVE_SCHEDULE_EXCEPTION_CORRECTION_CUSTOMER_ORDER_ALLOWLIST: '6a219a3f4adcda5856c3d579',
  NATIVE_SCHEDULE_EXCEPTION_CORRECTION_TASK_ALLOWLIST: '6a22ffdaf675ea79e30575aa',
  NATIVE_SCHEDULE_EXCEPTION_CORRECTION_SHOPIFY_ORDER_ALLOWLIST: '6a22ffda400eb806eb3ca945',
  NATIVE_SCHEDULE_EXCEPTION_CORRECTION_POLICY: 'EXACT_DATE_ONLY_NO_NOTIFICATION',
};

const BATCH_IDS = [
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT',
];

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/correctNativeScheduleExceptionForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(/^export \{[\s\S]*?\};\s*$/m, '');
  source += `\nglobalThis.__exports = { gateFailure, exactInputBlockers, preflightTargetContext, buildLocalFreshSchedulePreview, validateFreshPreview, buildTaskPatch, buildCustomerOrderPatch, buildNativeOrderPatch, validatePatches, applyScheduleCorrection, getLookup, safetyResult, COMMAND_TYPE, CONFIRMATION_PHRASE };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler };
}

function makeCustomerOrder(overrides = {}) {
  return {
    id: TARGET.customer_app_order_id,
    order_number: TARGET.order_number,
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    payment_captured: true,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    production_date: '2026-06-05',
    assigned_production_day: '2026-06-05',
    estimated_delivery_date: '2026-06-06',
    assigned_delivery_date: '2026-06-06',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    assigned_delivery_window_start: '2026-06-06T17:00:00.000Z',
    assigned_delivery_window_end: '2026-06-06T20:00:00.000Z',
    delivery_window_timezone: 'America/Chicago',
    status_history: [{ status: 'scheduled_for_juicing' }, { status: 'payment_confirmed' }],
    ...(overrides || {}),
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: TARGET.native_shopify_order_id,
    base44_order_id: TARGET.customer_app_order_id,
    shopify_order_number: TARGET.order_number,
    production_status: 'bottled',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    financial_status: 'paid',
    is_subscription: false,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    production_date: '2026-06-05',
    assigned_delivery_date: '2026-06-06',
    selected_delivery_date: '2026-06-06',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    fulfillments: [{ production_date: '2026-06-05', delivery_date: '2026-06-06', delivery_window_label: 'Saturday 12 PM - 3 PM', status: 'pending' }],
    ...(overrides || {}),
  };
}

function makeTask(overrides = {}) {
  return {
    id: TARGET.native_fulfillment_task_id,
    fulfillment_task_id: TARGET.native_fulfillment_task_id,
    base44_order_id: TARGET.customer_app_order_id,
    native_shopify_order_id: TARGET.native_shopify_order_id,
    shopify_order_id: TARGET.native_shopify_order_id,
    order_number: TARGET.order_number,
    status: 'packed',
    delivery_status: 'pending',
    production_status: 'packed',
    production_date: '2026-06-05',
    delivery_date: '2026-06-06',
    scheduled_date: '2026-06-06',
    assigned_delivery_date: '2026-06-06',
    time_window: 'Saturday 12 PM - 3 PM',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    packed_at: '2026-06-08T18:00:10.444Z',
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    ...(overrides || {}),
  };
}

function makeBatches(overrides = {}) {
  return BATCH_IDS.map((batchId, index) => ({
    id: `pb_${index}`,
    batch_id: batchId,
    status: 'verified_logged',
    production_date: '2026-06-05',
    compliance_log_id: `bcl_${index}`,
    ...(overrides[batchId] || {}),
  }));
}

function makeComplianceLogs(batches = makeBatches(), overrides = {}) {
  return batches.map((batch, index) => ({
    id: `bcl_${index}`,
    batch_id: batch.batch_id,
    source_production_batch_id: batch.id,
    date: '2026-06-05',
    locked: true,
    ...(overrides[batch.batch_id] || {}),
  }));
}

function makeStore({
  user = { role: 'admin', email: 'owner@example.test' },
  customerOrder = makeCustomerOrder(),
  nativeOrder = makeNativeOrder(),
  task = makeTask(),
  batches = makeBatches(),
  complianceLogs = makeComplianceLogs(batches),
  commandLogs = [],
  failUpdates = {},
  failCommandLogCreate = false,
  failCommandLogUpdate = false,
} = {}) {
  const store = {
    customerOrders: customerOrder ? [customerOrder] : [],
    nativeOrders: nativeOrder ? [nativeOrder] : [],
    tasks: task ? [task] : [],
    batches: batches || [],
    complianceLogs: complianceLogs || [],
    commandLogs: commandLogs || [],
    otherWrites: [],
  };
  const rowsFor = name => {
    if (name === 'Order') return store.customerOrders;
    if (name === 'ShopifyOrder') return store.nativeOrders;
    if (name === 'FulfillmentTask') return store.tasks;
    if (name === 'ProductionBatch') return store.batches;
    if (name === 'BatchComplianceLog') return store.complianceLogs;
    if (name === 'CommandLog') return store.commandLogs;
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
      if (name === 'CommandLog' && failCommandLogUpdate) throw new Error('simulated CommandLog update failure');
      if (failUpdates[name]) throw new Error(`simulated ${name} update failure`);
      const rows = rowsFor(name);
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) throw new Error(`${name} not found`);
      const updated = { ...rows[index], ...patch };
      rows[index] = updated;
      if (name !== 'CommandLog') store.otherWrites.push({ op: 'update', name, id, patch });
      return updated;
    },
    delete: async id => { store.otherWrites.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    store,
    base44: {
      auth: { me: async () => {
        if (user instanceof Error) throw user;
        return user;
      } },
      asServiceRole: {
        entities: {
          Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), CommandLog: api('CommandLog'),
        },
      },
    },
  };
}

function request(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

function requestBody(overrides = {}) {
  return { mode: 'execute', request_id: `g32d_sched2_${Math.random().toString(36).slice(2)}`, ...TARGET, ...overrides };
}

const closed = loadHarness({});
let store = makeStore();
let response = await closed.handler(request(store.base44, requestBody({ request_id: 'disabled_gate_test' })));
assert.equal(response.status, 409);
let body = await json(response);
assert.equal(body.error_code, 'native_schedule_exception_correction_disabled');
assert.equal(body.writes_performed, false);
assert.equal(store.store.commandLogs.length, 0);

const open = loadHarness(OPEN_GATES);
response = await open.handler(request(makeStore({ user: null }).base44, requestBody({ request_id: 'missing_auth_test' })));
assert.equal(response.status, 401);
body = await json(response);
assert.equal(body.writes_performed, false);

store = makeStore();
response = await open.handler(request(store.base44, requestBody({ request_id: 'wrong_date_test', current_recorded_delivery_date: '2026-06-09' })));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'schedule_exception_input_validation_failed');
assert.ok(body.blockers.includes('current_recorded_delivery_date_must_match_expected_stale_value'));
assert.equal(store.store.customerOrders[0].assigned_delivery_date, '2026-06-06');

store = makeStore({ customerOrder: null });
response = await open.handler(request(store.base44, requestBody({ request_id: 'missing_order_test' })));
assert.equal(response.status, 409);
body = await json(response);
assert.ok(body.blockers.includes('customer_app_order_not_found'));
assert.equal(body.writes_performed, false);

store = makeStore({ nativeOrder: null });
response = await open.handler(request(store.base44, requestBody({ request_id: 'missing_native_order_test' })));
assert.equal(response.status, 409);
body = await json(response);
assert.ok(body.blockers.includes('native_shopify_order_not_found'));
assert.equal(body.writes_performed, false);

store = makeStore({ task: null });
response = await open.handler(request(store.base44, requestBody({ request_id: 'missing_task_test' })));
assert.equal(response.status, 409);
body = await json(response);
assert.ok(body.blockers.includes('native_fulfillment_task_not_found'));
assert.equal(body.writes_performed, false);

store = makeStore();
response = await open.handler(request(store.base44, requestBody({ request_id: 'date_only_window_test' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(store.store.tasks[0].time_window, 'Saturday 12 PM - 3 PM');
assert.equal(store.store.tasks[0].delivery_window_label, 'Saturday 12 PM - 3 PM');
assert.equal(store.store.customerOrders[0].delivery_window_label, 'Saturday 12 PM - 3 PM');
assert.equal(store.store.nativeOrders[0].delivery_window_label, 'Saturday 12 PM - 3 PM');
assert.equal(store.store.nativeOrders[0].fulfillments[0].delivery_window_label, 'Saturday 12 PM - 3 PM');

response = await open.handler(request(makeStore().base44, requestBody({ request_id: 'batch_date_forbidden_test', production_batch_date: '2026-06-07' })));
assert.equal(response.status, 400);
body = await json(response);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(body.writes_performed, false);

response = await open.handler(request(makeStore().base44, requestBody({ request_id: 'compliance_date_forbidden_test', batch_compliance_log_date: '2026-06-07' })));
assert.equal(response.status, 400);
body = await json(response);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(body.writes_performed, false);

response = await open.handler(request(makeStore().base44, requestBody({ request_id: 'notification_forbidden_test', send_notification: true })));
assert.equal(response.status, 400);
body = await json(response);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(body.writes_performed, false);

response = await open.handler(request(makeStore().base44, requestBody({ request_id: 'status_forbidden_test', status: 'bottled_packed', status_history: [] })));
assert.equal(response.status, 400);
body = await json(response);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(body.writes_performed, false);

store = makeStore();
response = await open.handler(request(store.base44, requestBody({ request_id: 'valid_update_test' })));
assert.equal(response.status, 200);
body = await json(response);
assert.equal(body.success, true);
assert.equal(body.writes_performed, true);
assert.equal(body.updated_record_count, 3);
assert.equal(store.store.tasks[0].delivery_date, '2026-06-08');
assert.equal(store.store.tasks[0].scheduled_date, '2026-06-08');
assert.equal(store.store.tasks[0].assigned_delivery_date, '2026-06-08');
assert.equal(store.store.tasks[0].production_date, '2026-06-07');
assert.equal(store.store.tasks[0].status, 'packed');
assert.equal(store.store.tasks[0].delivery_status, 'pending');
assert.equal(store.store.tasks[0].production_status, 'packed');
assert.equal(store.store.customerOrders[0].estimated_delivery_date, '2026-06-08');
assert.equal(store.store.customerOrders[0].assigned_delivery_date, '2026-06-08');
assert.equal(store.store.customerOrders[0].production_date, '2026-06-07');
assert.equal(store.store.customerOrders[0].assigned_production_day, '2026-06-07');
assert.equal(store.store.customerOrders[0].status, 'scheduled_for_juicing');
assert.equal(store.store.customerOrders[0].status_history.length, 2);
assert.equal(store.store.nativeOrders[0].assigned_delivery_date, '2026-06-08');
assert.equal(store.store.nativeOrders[0].selected_delivery_date, '2026-06-08');
assert.equal(store.store.nativeOrders[0].production_date, '2026-06-07');
assert.equal(store.store.nativeOrders[0].production_status, 'bottled');
assert.equal(store.store.nativeOrders[0].fulfillment_status, 'pending');
assert.equal(store.store.nativeOrders[0].fulfillments[0].production_date, '2026-06-07');
assert.equal(store.store.nativeOrders[0].fulfillments[0].delivery_date, '2026-06-08');
assert.equal(store.store.batches.every(batch => batch.production_date === '2026-06-05' && batch.status === 'verified_logged'), true);
assert.equal(store.store.complianceLogs.every(log => log.date === '2026-06-05'), true);
assert.equal(store.store.commandLogs.filter(log => log.status === 'success').length, 1);
assert.equal(store.store.otherWrites.length, 3);
assert.deepEqual(store.store.otherWrites.map(write => write.name), ['FulfillmentTask', 'Order', 'ShopifyOrder']);
assert.equal(store.store.otherWrites.some(write => 'delivery_status' in write.patch || 'status' in write.patch || 'status_history' in write.patch || 'production_status' in write.patch || 'fulfillment_status' in write.patch), false);

response = await open.handler(request(store.base44, requestBody({ request_id: 'valid_update_test' })));
assert.equal(response.status, 200);
body = await json(response);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(store.store.commandLogs.filter(log => log.status === 'success').length, 1);
assert.equal(store.store.otherWrites.length, 3);

response = await open.handler(request(makeStore().base44, requestBody({ request_id: 'route_forbidden_test', route_id: 'route_123', proof_photo_url: 'https://example.test/proof.jpg', sync: true })));
assert.equal(response.status, 400);
body = await json(response);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(body.writes_performed, false);

response = await open.handler(request(makeStore().base44, requestBody({ request_id: 'method_test' }), 'GET'));
assert.equal(response.status, 405);
body = await json(response);
assert.equal(body.writes_performed, false);

const patchBlockers = open.exports.validatePatches({
  taskPatch: { ...open.exports.buildTaskPatch(), delivery_status: 'out_for_delivery' },
  customerOrderPatch: open.exports.buildCustomerOrderPatch(),
  nativeOrderPatch: open.exports.buildNativeOrderPatch(makeNativeOrder()),
});
assert.ok(patchBlockers.includes('unsupported_task_field:delivery_status'));

console.log('G32D-SCHED2 schedule exception correction command tests passed');
