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
  ENABLE_NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE: 'true',
  NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_KILL_SWITCH: 'false',
  NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_ALLOWED_EMAILS: 'owner@example.test',
  NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_ORDER_ALLOWLIST: 'NV-MPZNKGNT',
  NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_CUSTOMER_ORDER_ALLOWLIST: '6a219a3f4adcda5856c3d579',
  NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_TASK_ALLOWLIST: '6a22ffdaf675ea79e30575aa',
  NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_SHOPIFY_ORDER_ALLOWLIST: '6a22ffda400eb806eb3ca945',
  NATIVE_CUSTOMER_DELIVERED_STATUS_UPDATE_POLICY: 'DELIVERED_STATUS_ONLY_NO_NOTIFICATION',
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret',
};

function loadFunction(fileRelativePath, exportSnippet, env = {}) {
  const filePath = path.join(repoRoot, fileRelativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\n${exportSnippet}\n`;
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

function loadPreview(env = {}) {
  return loadFunction(
    'base44/functions/previewNativeCustomerDeliveredStatusImpact/entry.ts',
    'globalThis.__exports = { getLookup, loadTargetContext, buildPreview, deliveredStatusMappingBlockers, unsupportedBodyKey };',
    env,
  );
}

function loadCommand(env = {}) {
  return loadFunction(
    'base44/functions/updateNativeCustomerOrderDeliveredStatusForCustomerApp/entry.ts',
    'globalThis.__exports = { gateFailure, exactTargetBlockers, preflightTargetContext, buildLocalFreshPreview, validateFreshPreview, buildStatusPatch, validateStatusPatch, updateCustomerOrderDeliveredStatusOnly, safetyResult, getLookup, fetchFreshPreview, unsupportedBodyKey };',
    env,
  );
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
    assigned_delivery_date: '2026-06-08',
    estimated_delivery_date: '2026-06-08',
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
    fulfillment_status: 'fulfilled',
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
    status: 'delivered',
    delivery_status: 'delivered',
    production_status: 'packed',
    delivered_at: '2026-06-08T13:30:00.000Z',
    delivery_date: '2026-06-08',
    assigned_delivery_date: '2026-06-08',
    order_type: 'one_time',
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
  failOrderUpdate = false,
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
    writes: [],
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
      const row = { id: `${name.toLowerCase()}_${name === 'CommandLog' ? store.commandLogs.length + 1 : store.writes.length + 1}`, ...payload };
      if (name === 'CommandLog') store.commandLogs.push(row);
      else store.writes.push({ op: 'create', name, payload });
      return row;
    },
    update: async (id, patch) => {
      if (name === 'Order' && failOrderUpdate) throw new Error('simulated Order update failure');
      if (name === 'CommandLog' && failCommandLogUpdate) throw new Error('simulated CommandLog update failure');
      const rows = rowsFor(name);
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) throw new Error(`${name} not found`);
      const updated = { ...rows[index], ...patch };
      rows[index] = updated;
      store.writes.push({ op: 'update', name, id, patch });
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
        functions: { invoke: async () => {
          if (previewInvokeError) throw previewInvokeError;
          if (previewInvokeResponse) return previewInvokeResponse;
          throw new Error('unexpected service preview invocation');
        } },
      },
    },
  };
}

function validCommandBody(overrides = {}) {
  return {
    mode: 'live',
    order_number: 'NV-MPZNKGNT',
    customer_app_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    current_status_expected: 'scheduled_for_juicing',
    target_status: 'delivered',
    status_mode: 'DELIVERED_STATUS_ONLY_NO_NOTIFICATION',
    notification_policy: 'NO_NOTIFICATION',
    proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
    request_id: 'g32k_test_request',
    confirmation: 'update_customer_order_delivered_status_no_notification',
    ...(overrides || {}),
  };
}

function validPreviewBody(overrides = {}) {
  return {
    order_number: 'NV-MPZNKGNT',
    customer_app_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    status_mode: 'DELIVERED_STATUS_ONLY_NO_NOTIFICATION',
    notification_policy: 'NO_NOTIFICATION',
    proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
    request_id: 'g32k_preview_test',
    ...(overrides || {}),
  };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

let previewHarness = loadPreview(OPEN_GATES);
let setup = makeStore();
let res = await previewHarness.handler(req(setup.base44, validPreviewBody()));
let body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.dry_run, true);
assert.equal(body.writes_performed, false);
assert.equal(body.current_customer_order_status, 'scheduled_for_juicing');
assert.equal(body.proposed_customer_order_status, 'delivered');
assert.equal(body.status_update_ready, true);
assert.equal(body.notification_would_send, false);
assert.equal(body.proof_drop_required, false);
assert.equal(setup.store.writes.length, 0);
assert.deepEqual(Array.from(previewHarness.exports.deliveredStatusMappingBlockers('fulfilled')), ['delivered_status_mapping_required']);

let commandHarness = loadCommand({});
setup = makeStore();
res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'native_customer_delivered_status_update_disabled');
assert.equal(body.writes_performed, false);
assert.equal(setup.store.commandLogs.length, 0);

commandHarness = loadCommand(OPEN_GATES);
setup = makeStore({ user: null });
res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 401);
assert.equal(body.error_code, 'unauthorized');
assert.equal(setup.store.commandLogs.length, 0);

setup = makeStore({ user: { role: 'staff', email: 'staff@example.test' } });
res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 403);
assert.equal(body.error_code, 'forbidden');

setup = makeStore({ customerOrder: null });
res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'customer_delivered_status_preflight_blocked');
assert.ok(body.blockers.includes('customer_app_order_not_found'));

setup = makeStore({ task: makeTask({ status: 'packed', delivery_status: 'pending', delivered_at: null }) });
res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('native_fulfillment_task_not_delivered'));
assert.ok(body.blockers.includes('native_fulfillment_task_delivery_status_not_delivered'));

setup = makeStore({ nativeOrder: makeNativeOrder({ fulfillment_status: 'pending' }) });
res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('native_shopify_order_not_fulfilled'));

setup = makeStore();
res = await commandHarness.handler(req(setup.base44, validCommandBody({ notification_policy: 'SEND' })));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('notification_policy_must_be_no_notification'));

setup = makeStore();
res = await commandHarness.handler(req(setup.base44, validCommandBody({ proof_drop_policy: 'REQUIRED' })));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('proof_drop_policy_must_be_held_not_required_for_reconciliation'));

setup = makeStore();
res = await commandHarness.handler(req(setup.base44, validCommandBody({ target_status: 'fulfilled' })));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('target_status_must_be_delivered'));

setup = makeStore({ batches: makeBatches({ [BATCH_IDS[0]]: { status: 'completed' } }) });
res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes(`production_batch_not_verified_logged:${BATCH_IDS[0]}`));

setup = makeStore({ complianceLogs: [] });
res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('batch_compliance_log_count_mismatch'));

setup = makeStore();
res = await commandHarness.handler(req(setup.base44, validCommandBody({ send_notification: true })));
body = await json(res);
assert.equal(res.status, 400);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(setup.store.notificationRows.length, 0);

setup = makeStore();
res = await commandHarness.handler(req(setup.base44, validCommandBody({ proof_url: 'https://example.test/proof.jpg' })));
body = await json(res);
assert.equal(res.status, 400);
assert.equal(body.error_code, 'unsupported_request_field');

setup = makeStore();
res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.writes_performed, true);
assert.equal(body.customer_app_order_updated, true);
assert.equal(body.status_to, 'delivered');
assert.equal(setup.store.customerOrders[0].status, 'delivered');
assert.equal(setup.store.customerOrders[0].status_history.length, 3);
assert.equal(setup.store.commandLogs.length, 1);
assert.equal(setup.store.commandLogs[0].status, 'success');
assert.equal(setup.store.commandLogs[0].result.writes_performed, true);
assert.equal(setup.store.commandLogs[0].result.customer_app_order_updated, true);
const nonCommandWrites = setup.store.writes.filter(write => write.name !== 'CommandLog');
assert.equal(nonCommandWrites.length, 1);
assert.equal(nonCommandWrites[0].name, 'Order');
assert.deepEqual(Object.keys(nonCommandWrites[0].patch).sort(), ['status', 'status_history']);
assert.equal(setup.store.nativeOrders[0].fulfillment_status, 'fulfilled');
assert.equal(setup.store.tasks[0].status, 'delivered');
assert.equal(setup.store.notificationRows.length, 0);
assert.equal(setup.store.messageLogs.length, 0);

res = await commandHarness.handler(req(setup.base44, validCommandBody()));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(setup.store.commandLogs.length, 1);
assert.equal(setup.store.customerOrders[0].status_history.length, 3);

setup = makeStore({ customerOrder: makeCustomerOrder({ status: 'delivered', status_history: [{ status: 'delivered' }] }) });
res = await commandHarness.handler(req(setup.base44, validCommandBody({ request_id: 'g32k_already_delivered' })));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.reason, 'customer_status_already_delivered');
assert.equal(body.writes_performed, false);
assert.equal(setup.store.customerOrders[0].status_history.length, 1);
assert.equal(setup.store.writes.filter(write => write.name === 'Order').length, 0);
assert.equal(setup.store.commandLogs.length, 1);

setup = makeStore();
const exportedLookup = commandHarness.exports.getLookup(validCommandBody());
const preflight = await commandHarness.exports.preflightTargetContext(setup.base44);
const localPreview = commandHarness.exports.buildLocalFreshPreview(preflight);
const validation = commandHarness.exports.validateFreshPreview(localPreview);
assert.equal(exportedLookup.targetStatus, 'delivered');
assert.equal(preflight.ready, true);
assert.equal(validation.ready, true);
assert.equal(localPreview.notification_would_send, false);
assert.equal(localPreview.safety.writes_performed, false);

assert.ok(!/fetch\s*\(/.test(commandHarness.source), 'command must not use recursive HTTP fetch');
assert.ok(!/sendOrderStatusNotification|sendNotification|pushNotification|CustomerMessageDeliveryLog\.create/.test(commandHarness.source), 'command must not send notifications or create message logs');
assert.ok(!/entities\.ShopifyOrder\.update|entities\.FulfillmentTask\.update|entities\.ProductionBatch\.update|entities\.BatchComplianceLog\.update/.test(commandHarness.source), 'command must not update native/task/batch records');

console.log('G32K customer delivered status tests passed');
