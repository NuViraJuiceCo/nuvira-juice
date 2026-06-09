#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const OPEN_GATES = {
  ENABLE_HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL: 'true',
  HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_KILL_SWITCH: 'false',
  HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_ALLOWED_EMAILS: 'owner@example.test',
  HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_ORDER_ALLOWLIST: '1052',
  HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_POLICY: 'HISTORICAL_FULFILLED_NATIVE_SHOPIFY_ORDER_ONLY_NO_NOTIFICATION',
  HUB_API_URL: 'https://hub.example.test/functions/x',
  CUSTOMER_APP_SYNC_SECRET: 'sync-secret',
};

function loadHarness({ env = {}, fetchImpl = null } = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(/^export \{[\s\S]*?\};\s*$/m, '');
  source += `\nglobalThis.__exports = { safetyResult, writeSafetyResult, getLookup, unsupportedBodyKey, exactTargetBlockers, gateFailure, schemaAudit, schemaMappingBlockers, safeHubOrderStatus, safeLineItems, preflightTargetContext, buildLocalFreshPreview, validateFreshPreview, buildNativeShopifyOrderRecord, validateNativeShopifyOrderRecord, summarizeNativeShopifyOrder, nativeOrderCreatedByRequest, REQUIRED_POLICY, REQUIRED_CORRECTION_MODE, REQUIRED_NOTIFICATION_POLICY, REQUIRED_CUSTOMER_APP_ORDER_BACKFILL_POLICY, REQUIRED_NATIVE_TASK_BACKFILL_POLICY, REQUIRED_PROOF_DROP_POLICY, CONFIRMATION_PHRASE, TARGET_HUB_ORDER_NUMBER, TARGET_PRODUCTION_STATUS, TARGET_FULFILLMENT_STATUS, TARGET_SYNC_STATUS };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    fetch: fetchImpl || (async () => ({ ok: true, status: 200, json: async () => ({ orders: [hubOrder()] }) })),
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, source };
}

function hubOrder(overrides = {}) {
  return {
    id: 'hub_order_1052',
    shopify_order_number: '1052',
    customer_email: 'stephanie@example.test',
    customer_name: 'Stephanie Morales',
    source_channel: 'online',
    order_type: 'one_time',
    payment_status: 'paid',
    production_status: 'new',
    fulfillment_status: 'fulfilled',
    assigned_delivery_date: '2026-06-08',
    fulfilled_at: '2026-06-08T14:45:00.000Z',
    line_items: [{ title: 'AURA', quantity: 1, price: 12 }, { title: 'OASIS', quantity: 1, price: 12 }, { title: 'RE-NU', quantity: 1, price: 12 }],
    total_price: 36,
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  return {
    id: 'native_1052',
    shopify_order_number: '1052',
    shopify_order_id: 'historical_hub_fulfilled:1052',
    production_status: 'fulfilled',
    fulfillment_status: 'fulfilled',
    source_type: 'hub_historical_backfill',
    sync_status: 'historical_hub_fulfilled_native_mirror_g32l',
    audit_trail: [{ source: 'backfillHistoricalHubFulfilledNativeShopifyOrderForCustomerApp', request_id: 'g32l_valid' }],
    ...overrides,
  };
}

function makeStore({
  user = { role: 'admin', email: 'owner@example.test' },
  customerOrders = [],
  nativeOrders = [],
  tasks = [],
  orderSyncLogs = [],
  reviewRows = [],
  commandLogs = [],
  parityLogs = [],
  notifications = [],
  messageLogs = [],
  failNativeCreate = false,
  failCommandLogCreate = false,
  failCommandLogUpdate = false,
} = {}) {
  const store = { customerOrders, nativeOrders, tasks, orderSyncLogs, reviewRows, commandLogs, parityLogs, notifications, messageLogs, writes: [] };
  const rowsFor = name => {
    if (name === 'Order') return store.customerOrders;
    if (name === 'ShopifyOrder') return store.nativeOrders;
    if (name === 'FulfillmentTask') return store.tasks;
    if (name === 'OrderSyncLog') return store.orderSyncLogs;
    if (name === 'OrderReviewQueue') return store.reviewRows;
    if (name === 'CommandLog') return store.commandLogs;
    if (name === 'SafeSyncParityLog') return store.parityLogs;
    if (name === 'Notification') return store.notifications;
    if (name === 'CustomerMessageDeliveryLog') return store.messageLogs;
    return [];
  };
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    list: async () => rowsFor(name),
    create: async payload => {
      if (name === 'ShopifyOrder' && failNativeCreate) throw new Error('simulated native create failure');
      if (name === 'CommandLog' && failCommandLogCreate) throw new Error('simulated CommandLog create failure');
      if (!['ShopifyOrder', 'CommandLog'].includes(name)) throw new Error(`unexpected create ${name}`);
      const row = { id: `${name.toLowerCase()}_${rowsFor(name).length + 1}`, ...payload };
      rowsFor(name).push(row);
      store.writes.push({ op: 'create', name, payload });
      return row;
    },
    update: async (id, patch) => {
      if (name !== 'CommandLog') throw new Error(`unexpected update ${name}`);
      if (failCommandLogUpdate) throw new Error('simulated CommandLog update failure');
      const rows = rowsFor(name);
      const index = rows.findIndex(row => row.id === id);
      if (index < 0) throw new Error(`${name} not found`);
      rows[index] = { ...rows[index], ...patch };
      store.writes.push({ op: 'update', name, id, patch });
      return rows[index];
    },
  });
  return {
    store,
    base44: {
      auth: { me: async () => {
        if (user instanceof Error) throw user;
        return user;
      } },
      asServiceRole: { entities: {
        Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog'),
      }, functions: { invoke: async () => { throw new Error('unexpected service preview invocation'); } } },
    },
  };
}

function validBody(overrides = {}) {
  return {
    mode: 'live',
    hub_order_number: '1052',
    correction_mode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION',
    notification_policy: 'NO_NOTIFICATION',
    customer_app_order_backfill: 'HELD',
    native_fulfillment_task_backfill: 'HELD',
    proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
    request_id: 'g32l_valid',
    confirmation: 'backfill_historical_hub_fulfilled_native_shopify_order_no_notification',
    ...overrides,
  };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

let harness = loadHarness({ env: OPEN_GATES });
const fns = harness.exports;

assert.equal(fns.REQUIRED_POLICY, 'HISTORICAL_FULFILLED_NATIVE_SHOPIFY_ORDER_ONLY_NO_NOTIFICATION');
assert.equal(fns.CONFIRMATION_PHRASE, 'backfill_historical_hub_fulfilled_native_shopify_order_no_notification');
assert.equal(fns.schemaAudit().production_status_fulfilled_supported, true);
assert.equal(fns.schemaAudit().payment_status_required, false);
assert.equal(fns.schemaAudit().customer_identity_required, false);
assert.equal(fns.exactTargetBlockers(fns.getLookup(validBody())).length, 0);
assert.ok(fns.exactTargetBlockers(fns.getLookup(validBody({ hub_order_number: '1053' }))).includes('target_hub_order_number_mismatch'));
assert.ok(fns.unsupportedBodyKey(validBody({ create_customer_app_order: true })));
assert.ok(fns.unsupportedBodyKey(validBody({ native_fulfillment_task_create: true })));
assert.ok(fns.unsupportedBodyKey(validBody({ notification_payload: { send: true } })));
assert.ok(fns.unsupportedBodyKey(validBody({ proof_photo_url: 'https://example.test/proof.jpg' })));
assert.ok(fns.unsupportedBodyKey(validBody({ raw_hub_payload: { id: 'raw' } })));

let fake = makeStore();
let res = await harness.handler(req(fake.base44, validBody()));
let body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, false);
assert.equal(body.writes_performed, true);
assert.equal(body.native_shopify_order_created, true);
assert.equal(body.customer_app_order_created, false);
assert.equal(body.native_fulfillment_task_created, false);
assert.equal(body.notifications_created, false);
assert.equal(body.hub_records_updated, false);
assert.equal(fake.store.nativeOrders.length, 1);
assert.equal(fake.store.nativeOrders[0].shopify_order_number, '1052');
assert.equal(fake.store.nativeOrders[0].production_status, 'fulfilled');
assert.equal(fake.store.nativeOrders[0].fulfillment_status, 'fulfilled');
assert.equal(fake.store.nativeOrders[0].source_type, 'hub_historical_backfill');
assert.equal(fake.store.nativeOrders[0].source_channel, 'admin');
assert.equal(fake.store.nativeOrders[0].line_items.length, 3);
assert.equal('customer_email' in fake.store.nativeOrders[0], false);
assert.equal('customer_name' in fake.store.nativeOrders[0], false);
assert.equal('delivery_address' in fake.store.nativeOrders[0], false);
assert.equal(fake.store.commandLogs.length, 1);
assert.equal(fake.store.commandLogs[0].status, 'success');
assert.equal(fake.store.commandLogs[0].result.writes_performed, true);
assert.equal(fake.store.commandLogs[0].result.native_shopify_order_created, true);
assert.equal(fake.store.writes.filter(write => write.name === 'ShopifyOrder').length, 1);
assert.equal(fake.store.writes.filter(write => write.name === 'CommandLog' && write.op === 'create').length, 1);
assert.equal(fake.store.writes.filter(write => write.name !== 'ShopifyOrder' && write.name !== 'CommandLog').length, 0);

res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(fake.store.nativeOrders.length, 1);
assert.equal(fake.store.commandLogs.length, 1);

harness = loadHarness({ env: {} });
fake = makeStore();
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'historical_hub_fulfilled_native_shopify_order_backfill_disabled');
assert.equal(body.writes_performed, false);
assert.equal(fake.store.writes.length, 0);

harness = loadHarness({ env: { ...OPEN_GATES, HISTORICAL_HUB_FULFILLED_NATIVE_SHOPIFY_ORDER_BACKFILL_KILL_SWITCH: 'true' } });
fake = makeStore();
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'kill_switch_active');
assert.equal(body.writes_performed, false);

harness = loadHarness({ env: OPEN_GATES });
fake = makeStore({ user: new Error('no session') });
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 401);
assert.equal(body.writes_performed, false);

fake = makeStore({ user: { role: 'user', email: 'owner@example.test' } });
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 403);
assert.equal(body.writes_performed, false);

fake = makeStore({ user: { role: 'admin', email: 'other@example.test' } });
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'actor_email_not_allowlisted');
assert.equal(body.writes_performed, false);

fake = makeStore({ nativeOrders: [nativeOrder()] });
res = await harness.handler(req(fake.base44, validBody({ request_id: 'g32l_valid' })));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.reason, 'native_shopify_order_already_created_by_same_request');
assert.equal(body.writes_performed, false);
assert.equal(fake.store.nativeOrders.length, 1);
assert.equal(fake.store.writes.filter(write => write.name === 'ShopifyOrder').length, 0);

fake = makeStore({ nativeOrders: [nativeOrder({ audit_trail: [] })] });
res = await harness.handler(req(fake.base44, validBody({ request_id: 'g32l_conflict' })));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'historical_hub_fulfilled_backfill_preflight_blocked');
assert.ok(body.blockers.includes('native_shopify_order_already_exists_for_hub_order'));
assert.equal(fake.store.nativeOrders.length, 1);

fake = makeStore({ customerOrders: [{ id: 'order_1052', order_number: '1052' }] });
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('customer_app_order_already_exists_for_hub_order'));
assert.equal(fake.store.nativeOrders.length, 0);

fake = makeStore({ tasks: [{ id: 'task_1052', order_number: '1052' }] });
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('native_fulfillment_task_already_exists_for_hub_order'));
assert.equal(fake.store.nativeOrders.length, 0);

harness = loadHarness({ env: OPEN_GATES, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ orders: [hubOrder({ fulfillment_status: 'pending', fulfilled_at: null })] }) }) });
fake = makeStore();
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('hub_order_not_fulfilled'));
assert.equal(fake.store.nativeOrders.length, 0);

harness = loadHarness({ env: OPEN_GATES, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ orders: [hubOrder({ order_status: 'cancelled' })] }) }) });
fake = makeStore();
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('hub_order_cancelled_or_refunded'));

harness = loadHarness({ env: OPEN_GATES, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ orders: [hubOrder({ line_items: [] })] }) }) });
fake = makeStore();
res = await harness.handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 409);
assert.ok(body.blockers.includes('hub_line_items_missing'));

harness = loadHarness({ env: OPEN_GATES, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ orders: [hubOrder({ payment_status: '', financial_status: '', customer_email: '', customer_name: '' })] }) }) });
fake = makeStore();
res = await harness.handler(req(fake.base44, validBody({ request_id: 'g32l_missing_optional' })));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.native_shopify_order_created, true);
assert.ok(fake.store.commandLogs[0].result.native_shopify_order_created);
assert.equal('payment_status' in fake.store.nativeOrders[0], false);
assert.equal('customer_email' in fake.store.nativeOrders[0], false);

harness = loadHarness({ env: OPEN_GATES });
fake = makeStore();
for (const [override, expected] of [
  [{ notification_policy: 'SEND_NOTIFICATION' }, 'notification_policy_must_be_no_notification'],
  [{ proof_drop_policy: 'REQUIRE_PROOF' }, 'proof_drop_policy_must_be_held_not_required_for_reconciliation'],
  [{ customer_app_order_backfill: 'CREATE' }, 'customer_app_order_backfill_must_be_held'],
  [{ native_fulfillment_task_backfill: 'CREATE' }, 'native_fulfillment_task_backfill_must_be_held'],
]) {
  res = await harness.handler(req(fake.base44, validBody(override)));
  body = await json(res);
  assert.equal(res.status, 409);
  assert.ok(body.blockers.includes(expected));
  assert.equal(body.writes_performed, false);
}

fake = makeStore({ commandLogs: [{ id: 'cmd_failed', status: 'failed', idempotency_key: 'historical_hub_fulfilled_native_shopify_order_backfill:g32l_failed' }] });
res = await harness.handler(req(fake.base44, validBody({ request_id: 'g32l_failed' })));
body = await json(res);
assert.equal(res.status, 409);
assert.equal(body.error_code, 'previous_failed_request_id_not_reusable');
assert.equal(fake.store.nativeOrders.length, 0);

const record = fns.buildNativeShopifyOrderRecord({ hubOrder: hubOrder(), preflight: { hubStatus: fns.safeHubOrderStatus(hubOrder()), lineItems: fns.safeLineItems(hubOrder()) }, requestId: 'g32l_record', user: { role: 'admin' } });
assert.equal(fns.validateNativeShopifyOrderRecord(record).length, 0);
assert.ok(fns.validateNativeShopifyOrderRecord({ ...record, customer_email: 'redacted@example.test' }).includes('forbidden_raw_provider_customer_or_delivery_field_present'));
assert.ok(fns.validateNativeShopifyOrderRecord({ ...record, shopify_raw_payload: { raw: true } }).includes('forbidden_raw_provider_customer_or_delivery_field_present'));
assert.ok(fns.validateNativeShopifyOrderRecord({ ...record, unsupported_field: true }).some(blocker => blocker.startsWith('unsupported_shopify_order_field')));

const source = harness.source;
assert.equal(/entities\.Order\.create|entities\.FulfillmentTask\.create|entities\.Notification\.create|entities\.CustomerMessageDeliveryLog\.create|entities\.ProductionBatch\.create|entities\.BatchComplianceLog\.create|entities\.OrderSyncLog\.create|entities\.OrderReviewQueue\.create|entities\.SafeSyncParityLog\.create|entities\.PurchaseOrder\.create/.test(source), false, 'command must not create disallowed entities');
assert.equal(/sendOrderStatusNotification|sendNotification|stripe\.charges|stripe\.|shopify\.graphql|shopifyApi|runRepair|runReplay/i.test(source), false, 'command must not invoke providers/notifications/sync actions');

console.log('G32L historical Hub fulfilled native ShopifyOrder backfill command tests passed');
