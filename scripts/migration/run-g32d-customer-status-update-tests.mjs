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

const OPEN_GATES = {
  ENABLE_NATIVE_CUSTOMER_STATUS_UPDATE: 'true',
  NATIVE_CUSTOMER_STATUS_UPDATE_KILL_SWITCH: 'false',
  NATIVE_CUSTOMER_STATUS_UPDATE_ALLOWED_EMAILS: 'owner@example.test',
  NATIVE_CUSTOMER_STATUS_UPDATE_ORDER_ALLOWLIST: 'NV-MPZNKGNT',
  NATIVE_CUSTOMER_STATUS_UPDATE_CUSTOMER_ORDER_ALLOWLIST: '6a219a3f4adcda5856c3d579',
  NATIVE_CUSTOMER_STATUS_UPDATE_POLICY: 'EXACT_STATUS_ONLY_NO_NOTIFICATION',
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret',
};

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/updateNativeCustomerOrderStatusForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, preflightTargetContext, buildLocalFreshStatusPreview, validateFreshPreview, buildStatusPatch, validateStatusPatch, updateCustomerOrderStatusOnly, safetyResult, getLookup, requireAdmin, fetchFreshPreview };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
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
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    status_history: [
      { status: 'order_received', timestamp: '2026-06-05T16:00:00.000Z', message: 'Order received.' },
      { status: 'scheduled_for_juicing', timestamp: '2026-06-05T16:05:00.000Z', message: 'Payment confirmed.' },
    ],
    ...(overrides || {}),
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: '6a22ffda400eb806eb3ca945',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    shopify_order_number: 'NV-MPZNKGNT',
    production_status: 'bottled',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    financial_status: 'paid',
    is_subscription: false,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
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
    order_type: 'one_time',
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
  failOrderUpdate = false,
  failCommandLogCreate = false,
  failCommandLogUpdate = false,
  previewInvokeError = null,
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
      if (name === 'CommandLog' && failCommandLogUpdate) throw new Error('simulated CommandLog update failure');
      if (name === 'Order' && failOrderUpdate) throw new Error('simulated Order update failure');
      const rows = rowsFor(name);
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) throw new Error(`${name} not found`);
      const updated = { ...rows[index], ...patch };
      rows[index] = updated;
      if (name !== 'Order' && name !== 'CommandLog') store.otherWrites.push({ op: 'update', name, id, patch });
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
        entities: {
          Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), CommandLog: api('CommandLog'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog'),
        },
        functions: {
          invoke: async () => {
            if (previewInvokeError) throw previewInvokeError;
            throw new Error('unexpected service preview invocation');
          },
        },
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
    production_date: '2026-06-05',
    current_status_expected: 'scheduled_for_juicing',
    target_status: 'bottled_packed',
    notification_policy: 'NO_NOTIFICATION',
    request_id: 'g32d_test_request',
    confirmation: 'update_customer_order_status_bottled_packed_no_notification',
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
assert.equal(body.error_code, 'native_customer_status_update_disabled');
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.customerOrders[0].status, 'scheduled_for_juicing');
assert.equal(storeSetup.store.commandLogs.length, 0);

harness = loadHarness(OPEN_GATES);
storeSetup = makeStore({ user: null });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 401);
assert.equal(body.error_code, 'unauthorized');
assert.equal(body.writes_performed, false);

storeSetup = makeStore({ user: { role: 'member', email: 'owner@example.test' } });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 403);
assert.equal(body.error_code, 'forbidden');

storeSetup = makeStore({ customerOrder: null });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'customer_status_update_preflight_blocked');
assert.ok(body.blockers.includes('customer_app_order_not_found'));

storeSetup = makeStore({ customerOrder: makeCustomerOrder({ status: 'in_production' }) });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('customer_app_order_status_not_status_update_eligible'));
assert.equal(storeSetup.store.customerOrders[0].status, 'in_production');

storeSetup = makeStore();
res = await harness.handler(req(storeSetup.base44, validBody({ target_status: 'out_for_delivery' })));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'exact_customer_status_update_target_required');
assert.ok(body.blockers.includes('target_status_must_be_bottled_packed'));

storeSetup = makeStore();
res = await harness.handler(req(storeSetup.base44, validBody({ notification_policy: 'SEND_NOTIFICATION' })));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('notification_policy_must_be_no_notification'));
assert.equal(storeSetup.store.commandLogs.length, 0);

storeSetup = makeStore({ nativeOrder: makeNativeOrder({ production_status: 'awaiting_production' }) });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('native_shopify_order_not_bottled'));

storeSetup = makeStore({ task: makeTask({ status: 'pending', production_status: 'awaiting_production' }) });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('native_fulfillment_task_not_packed'));

storeSetup = makeStore({ batches: [], complianceLogs: [] });
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.some(blocker => blocker.startsWith('production_batch_not_found:')));

let patch = harness.exports.buildStatusPatch({ order: makeCustomerOrder(), now: '2026-06-08T20:30:00.000Z' });
assert.equal(patch.status, 'bottled_packed');
assert.equal(patch.status_history.length, 3);
assert.deepEqual(Object.keys(patch).sort(), ['status', 'status_history']);
assert.equal(harness.exports.validateStatusPatch(patch).length, 0);
patch = { ...patch, delivery_status: 'delivered' };
assert.ok(harness.exports.validateStatusPatch(patch).includes('unapproved_customer_status_update_field:delivery_status'));
assert.ok(harness.exports.validateStatusPatch(patch).includes('forbidden_delivery_or_notification_field_present'));

storeSetup = makeStore();
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, false);
assert.equal(body.writes_performed, true);
assert.equal(body.customer_app_order_updated, true);
assert.equal(body.status_history_appended, true);
assert.equal(body.notifications_created, false);
assert.equal(body.notifications_sent, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(storeSetup.store.customerOrders[0].status, 'bottled_packed');
assert.equal(storeSetup.store.customerOrders[0].status_history.length, 3);
assert.equal(storeSetup.store.commandLogs.length, 1);
assert.equal(storeSetup.store.commandLogs[0].status, 'success');
assert.equal(storeSetup.store.commandLogs[0].result.writes_performed, true);
assert.equal(storeSetup.store.commandLogs[0].result.notifications_sent, false);
assert.equal(storeSetup.store.notificationRows.length, 0);
assert.equal(storeSetup.store.messageLogs.length, 0);
assert.deepEqual(storeSetup.store.nativeOrders[0], makeNativeOrder());
assert.equal(storeSetup.store.tasks[0].status, 'packed');
assert.equal(storeSetup.store.otherWrites.length, 0);

const statusHistoryAfterSuccess = storeSetup.store.customerOrders[0].status_history.length;
res = await harness.handler(req(storeSetup.base44, validBody()));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.customerOrders[0].status_history.length, statusHistoryAfterSuccess);
assert.equal(storeSetup.store.commandLogs.length, 1);

storeSetup = makeStore({ customerOrder: makeCustomerOrder({ status: 'bottled_packed', status_history: [{ status: 'bottled_packed', timestamp: '2026-06-08T19:00:00.000Z', message: 'Already packed.' }] }) });
res = await harness.handler(req(storeSetup.base44, validBody({ request_id: 'g32d_already_satisfied' })));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.reason, 'customer_status_already_bottled_packed');
assert.equal(body.writes_performed, false);
assert.equal(body.status_history_appended, false);
assert.equal(storeSetup.store.customerOrders[0].status_history.length, 1);
assert.equal(storeSetup.store.commandLogs.length, 1);
assert.equal(storeSetup.store.commandLogs[0].status, 'skipped');

storeSetup = makeStore({ failOrderUpdate: true });
res = await harness.handler(req(storeSetup.base44, validBody({ request_id: 'g32d_write_fail' })));
body = await json(res);
assert.equal(res.status, 500);
assert.equal(body.error_code, 'customer_status_update_write_failed');
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.commandLogs.length, 1);
assert.equal(storeSetup.store.commandLogs[0].status, 'failed');

const previewFailure = new Error('preview timeout');
previewFailure.status = 504;
harness = loadHarness({ ...OPEN_GATES, NATIVE_CUSTOMER_STATUS_UPDATE_USE_SERVICE_PREVIEW: 'true' });
storeSetup = makeStore({ previewInvokeError: previewFailure });
res = await harness.handler(req(storeSetup.base44, validBody({ request_id: 'g32d_preview_fail' })));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'native_customer_status_update_preview_timeout');
assert.equal(body.writes_performed, false);
assert.equal(storeSetup.store.customerOrders[0].status, 'scheduled_for_juicing');
assert.equal(storeSetup.store.commandLogs.length, 0);

res = await harness.handler(req(storeSetup.base44, validBody(), 'GET'));
body = await json(res);
assert.equal(res.status, 405);
assert.equal(body.writes_performed, false);

const commandSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/updateNativeCustomerOrderStatusForCustomerApp/entry.ts'), 'utf8');
assert.equal(commandSource.includes('sendOrderStatusNotification'), false, 'command must not call notification functions');
assert.equal(commandSource.includes('sendCustomerNotification'), false, 'command must not call notification functions');
assert.equal(commandSource.includes('sendCustomerPushNotification'), false, 'command must not call notification functions');
assert.equal(/entities\.Notification\.(create|update|delete)\s*\(/.test(commandSource), false, 'command must not write Notification');
assert.equal(/entities\.CustomerMessageDeliveryLog\.(create|update|delete)\s*\(/.test(commandSource), false, 'command must not write message logs');
assert.equal(commandSource.includes('base44.asServiceRole.entities.ShopifyOrder.update'), false, 'command must not update native ShopifyOrder');
assert.equal(commandSource.includes('base44.asServiceRole.entities.FulfillmentTask.update'), false, 'command must not update FulfillmentTask');
assert.equal(commandSource.includes('base44.asServiceRole.entities.ProductionBatch.update'), false, 'command must not update ProductionBatch');
assert.equal(commandSource.includes('base44.asServiceRole.entities.BatchComplianceLog.update'), false, 'command must not update BatchComplianceLog');
assert.equal(commandSource.includes('fetch('), false, 'command must not call providers via fetch');

const previewSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/previewNativeCustomerStatusNotificationImpact/entry.ts'), 'utf8');
assert.equal(previewSource.includes('status_command_available'), true);
assert.equal(previewSource.includes("notification_policy_required: 'NO_NOTIFICATION'"), true);
const syncHealthSource = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/SyncHealth.jsx'), 'utf8');
assert.equal(syncHealthSource.includes('Status-only command available but gated'), true);
assert.equal(syncHealthSource.includes('NO_NOTIFICATION required'), true);

console.log('G32D customer status-only command tests passed');
