#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadHarness({ env = {}, fetchImpl = null } = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/previewHistoricalHubFulfilledNativeBackfill/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(/^export \{[\s\S]*?\};\s*$/m, '');
  source += `\nglobalThis.__exports = { READ_ONLY_SAFETY, lookupFromBody, unsupportedBodyKey, safeHubOrderStatus, auditedHubFallbackOrder, isHubFulfilled, isCancelledOrRefunded, isSubscriptionOrMultiDelivery, policyBlockers, buildDuplicateRisks, buildProposedNativeShopifyOrderRecord, buildPreview, HISTORICAL_NATIVE_PRODUCTION_STATUS, HISTORICAL_NATIVE_FULFILLMENT_STATUS };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    fetch: fetchImpl || (async url => {
      const text = url.toString();
      if (text.includes('getFulfillmentTaskDetailsForCustomerApp')) return { ok: true, status: 200, json: async () => ({ tasks: [] }) };
      return { ok: true, status: 200, json: async () => ({ orders: [] }) };
    }),
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
    line_items: [{ title: 'AURA', quantity: 1 }, { title: 'OASIS', quantity: 2 }],
    total_price: 99.5,
    ...overrides,
  };
}

function localRecords(overrides = {}) {
  return {
    customerOrders: [],
    nativeOrders: [],
    tasks: [],
    orderSyncLogs: [],
    reviewRows: [],
    commandLogs: [],
    parityLogs: [],
    notifications: [],
    messageLogs: [],
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    correctionMode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION',
    notificationPolicy: 'NO_NOTIFICATION',
    proofDropPolicy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
    requestId: 'g32j_test_request',
    ...overrides,
  };
}

function lookup(overrides = {}) {
  return {
    hubOrderNumber: '1052',
    hubOrderId: '',
    requestId: 'g32j_test_request',
    since: '2026-05-01',
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
    create: async payload => { store.writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { store.writes.push({ op: 'update', name, id, patch }); throw new Error(`unexpected update ${name}`); },
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
      } },
    },
  };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

const { exports: fns } = loadHarness({ env: { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' } });

assert.equal(fns.HISTORICAL_NATIVE_PRODUCTION_STATUS, 'fulfilled');
assert.equal(fns.HISTORICAL_NATIVE_FULFILLMENT_STATUS, 'fulfilled');
assert.equal(fns.policyBlockers(policy()).length, 0);
assert.ok(fns.policyBlockers(policy({ notificationPolicy: 'SEND' })).includes('notification_policy_must_be_no_notification'));
assert.ok(fns.policyBlockers(policy({ proofDropPolicy: 'REQUIRE_PROOF' })).includes('proof_drop_policy_must_be_held_not_required_for_reconciliation'));
assert.equal(fns.isHubFulfilled(hubOrder()), true);
assert.equal(fns.isCancelledOrRefunded(hubOrder({ fulfillment_status: 'refunded' })), true);
assert.equal(fns.isSubscriptionOrMultiDelivery(hubOrder({ order_type: 'subscription' })), true);

let preview = fns.buildPreview({
  lookup: lookup(),
  policy: policy(),
  hubOrder: hubOrder(),
  hubFetchResult: { ok: true, status: 200, orders: [hubOrder()] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.hub_order_present, true);
assert.equal(preview.local_customer_app_order_present, false);
assert.equal(preview.native_shopify_order_present, false);
assert.equal(preview.native_fulfillment_task_present, false);
assert.equal(preview.historical_backfill_needed, true);
assert.equal(preview.proposed_records[0].record_type, 'Native ShopifyOrder');
assert.equal(preview.proposed_records[0].ready_for_dedicated_live_contract, true);
assert.equal(preview.proposed_records[0].proposed_safe_fields.production_status, 'fulfilled');
assert.equal(preview.proposed_records[0].proposed_safe_fields.fulfillment_status, 'fulfilled');
assert.ok(preview.held_records.some(record => record.record_type === 'Customer App Order'));
assert.ok(preview.held_records.some(record => record.record_type === 'Native FulfillmentTask'));
assert.equal(preview.notification_would_send, false);
assert.equal(preview.proof_drop_impact.proof_drop_required, false);
assert.equal(preview.hub_mutation, false);
assert.ok(preview.warnings.includes('hub_task_rows_absent'));
assert.ok(preview.warnings.includes('notifications_held'));
assert.equal(preview.blockers.length, 0);

preview = fns.buildPreview({
  lookup: lookup(),
  policy: policy(),
  hubOrder: hubOrder(),
  hubFetchResult: { ok: true, status: 200, orders: [hubOrder()] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords({ nativeOrders: [{ id: 'native_1052', shopify_order_number: '1052' }] }),
  auth: { actor_type: 'admin' },
});
assert.ok(preview.duplicate_risks.includes('existing_native_shopify_order_for_hub_order_number_or_id'));
assert.ok(preview.data_quality_blockers.includes('duplicate_native_or_customer_order_exists'));
assert.ok(preview.blockers.includes('duplicate_native_or_customer_order_exists'));
assert.equal(preview.historical_backfill_needed, false);

preview = fns.buildPreview({
  lookup: lookup(),
  policy: policy(),
  hubOrder: hubOrder({ fulfillment_status: 'pending', fulfilled_at: null, delivered_at: null }),
  hubFetchResult: { ok: true, status: 200, orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.ok(preview.data_quality_blockers.includes('hub_order_not_fulfilled'));
assert.equal(preview.proposed_records[0].ready_for_dedicated_live_contract, false);

preview = fns.buildPreview({
  lookup: lookup(),
  policy: policy(),
  hubOrder: hubOrder({ order_status: 'cancelled' }),
  hubFetchResult: { ok: true, status: 200, orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.ok(preview.data_quality_blockers.includes('hub_order_cancelled_or_refunded'));

preview = fns.buildPreview({
  lookup: lookup(),
  policy: policy(),
  hubOrder: hubOrder({ line_items: [] }),
  hubFetchResult: { ok: true, status: 200, orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.ok(preview.data_quality_blockers.includes('hub_line_items_missing'));
assert.equal(preview.proposed_records[0].ready_for_dedicated_live_contract, false);

preview = fns.buildPreview({
  lookup: lookup(),
  policy: policy(),
  hubOrder: fns.auditedHubFallbackOrder('1052'),
  hubFetchResult: { ok: false, status: 0, error_code: 'hub_fetch_timeout', orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.equal(preview.hub_order_present, true);
assert.equal(preview.hub_fulfillment_status, 'fulfilled');
assert.ok(preview.data_quality_blockers.includes('insufficient_hub_data_for_historical_backfill'));
assert.ok(preview.data_quality_blockers.includes('hub_line_items_missing'));
assert.ok(preview.data_quality_blockers.includes('hub_customer_identity_missing'));
assert.ok(preview.warnings.includes('hub_safe_audit_fallback_used'));
assert.ok(preview.warnings.includes('hub_production_status_new_despite_fulfilled'));

preview = fns.buildPreview({
  lookup: lookup(),
  policy: policy({ notificationPolicy: 'SEND_NOTIFICATION' }),
  hubOrder: hubOrder(),
  hubFetchResult: { ok: true, status: 200, orders: [hubOrder()] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.ok(preview.blockers.includes('notification_policy_must_be_no_notification'));
assert.equal(preview.notification_would_send, false);

const richOrder = hubOrder();
const fetchImpl = async url => {
  const text = url.toString();
  if (text.includes('getFulfillmentTaskDetailsForCustomerApp')) return { ok: true, status: 200, json: async () => ({ tasks: [] }) };
  return { ok: true, status: 200, json: async () => ({ orders: [richOrder] }) };
};
let harness = loadHarness({ env: { HUB_API_URL: 'https://hub.example.test/functions/x', CUSTOMER_APP_SYNC_SECRET: 'sync-secret' }, fetchImpl });
let fake = makeStore();
let response = await harness.handler(req(fake.base44, {
  hub_order_number: '1052',
  correction_mode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION',
  notification_policy: 'NO_NOTIFICATION',
  proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
  request_id: 'g32j_handler_test',
}));
assert.equal(response.status, 200);
let body = await json(response);
assert.equal(body.success, true);
assert.equal(body.writes_performed, false);
assert.equal(body.proposed_records[0].ready_for_dedicated_live_contract, true);
assert.equal(fake.store.writes.length, 0);

response = await harness.handler(req(makeStore({ user: new Error('no session') }).base44, {
  hub_order_number: '1052', correction_mode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION', notification_policy: 'NO_NOTIFICATION', proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
}));
assert.equal(response.status, 401);
body = await json(response);
assert.equal(body.writes_performed, false);

response = await harness.handler(req(makeStore().base44, {}, 'GET'));
assert.equal(response.status, 405);
body = await json(response);
assert.equal(body.writes_performed, false);

harness = loadHarness({ env: { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' } });
fake = makeStore({ user: new Error('no session') });
response = await harness.handler({
  method: 'POST',
  __base44: fake.base44,
  headers: { get: key => key === 'x-native-preview-secret' ? 'preview-secret' : '' },
  text: async () => JSON.stringify({
    hub_order_number: '1052', correction_mode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION', notification_policy: 'NO_NOTIFICATION', proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
  }),
});
assert.equal(response.status, 200);
body = await json(response);
assert.equal(body.success, true);
assert.equal(body.writes_performed, false);
assert.equal(fake.store.writes.length, 0);

const source = harness.source;
assert.equal(/\.create\s*\(/.test(source), false, 'preview source must not call create');
assert.equal(/\.update\s*\(/.test(source), false, 'preview source must not call update');
assert.equal(/sendOrderStatusNotification|sendNotification|stripe\.charges|stripe\.|shopify\.graphql|shopifyApi|runRepair|runReplay/i.test(source), false, 'preview source must not invoke providers/notifications/sync actions');

console.log('G32J historical Hub fulfilled backfill preview tests passed');
