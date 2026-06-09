#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadHarness({ env = {}, fetchImpl = null } = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/previewHistoricalCustomerOrderFulfillmentBackfillImpact/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(/^export \{[\s\S]*?\};\s*$/m, '');
  source += `\nglobalThis.__exports = { READ_ONLY_SAFETY, lookupFromBody, unsupportedBodyKey, policyBlockers, safeHubOrderStatus, auditedHubFallbackOrder, isHubFulfilled, isCancelledOrRefunded, isSubscriptionOrMultiDelivery, summarizeNativeMirror, nativeMirrorIsValid, buildProposedCustomerAppOrderPreview, buildProposedFulfillmentTaskPreview, buildPreview, REQUIRED_PREVIEW_MODE, REQUIRED_NOTIFICATION_POLICY, REQUIRED_CUSTOMER_APP_ORDER_BACKFILL, REQUIRED_NATIVE_TASK_BACKFILL, REQUIRED_PROOF_DROP_POLICY, TARGET_HUB_ORDER_NUMBER, TARGET_NATIVE_SHOPIFY_ORDER_ID };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    fetch: fetchImpl || (async url => {
      const text = url.toString();
      if (text.includes('getFulfillmentTaskDetailsForCustomerApp')) return { ok: true, status: 200, json: async () => ({ tasks: [] }) };
      return { ok: true, status: 200, json: async () => ({ orders: [hubOrder()] }) };
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
    assigned_delivery_date: '2026-06-06',
    fulfilled_at: '2026-06-06T14:45:00.000Z',
    line_items: [{ title: 'AURA', quantity: 1 }, { title: 'OASIS', quantity: 1 }, { title: 'RE-NU', quantity: 1 }],
    total_price: 36,
    ...overrides,
  };
}

function nativeMirror(overrides = {}) {
  return {
    id: '6a2848655450ef3556960d99',
    shopify_order_number: '1052',
    shopify_order_id: 'historical_hub_fulfilled:1052',
    source_type: 'hub_historical_backfill',
    source_channel: 'admin',
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    fulfillment_method: 'delivery',
    production_status: 'fulfilled',
    fulfillment_status: 'fulfilled',
    shopify_fulfillment_status: 'fulfilled',
    sync_status: 'historical_hub_fulfilled_native_mirror_g32l',
    operational_visibility: 'historical_backfill',
    line_items: [{ title: 'redacted item' }, { title: 'redacted item' }, { title: 'redacted item' }],
    audit_trail: [{ request_id: 'g32m_historical_native_shopify_order_backfill_1052_test' }],
    ...overrides,
  };
}

function localRecords(overrides = {}) {
  return {
    customerOrders: [],
    nativeOrders: [nativeMirror()],
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

function lookup(overrides = {}) {
  return {
    hubOrderNumber: '1052',
    nativeShopifyOrderId: '6a2848655450ef3556960d99',
    previewMode: 'HISTORICAL_CUSTOMER_ORDER_FULFILLMENT_BACKFILL_IMPACT',
    notificationPolicy: 'NO_NOTIFICATION',
    customerAppOrderBackfill: 'PREVIEW_ONLY',
    nativeFulfillmentTaskBackfill: 'PREVIEW_ONLY',
    proofDropPolicy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
    requestId: 'g32n_test',
    since: '2026-05-01',
    ...overrides,
  };
}

function validBody(overrides = {}) {
  return {
    mode: 'dry_run',
    hub_order_number: '1052',
    native_shopify_order_id: '6a2848655450ef3556960d99',
    preview_mode: 'HISTORICAL_CUSTOMER_ORDER_FULFILLMENT_BACKFILL_IMPACT',
    notification_policy: 'NO_NOTIFICATION',
    customer_app_order_backfill: 'PREVIEW_ONLY',
    native_fulfillment_task_backfill: 'PREVIEW_ONLY',
    proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
    request_id: 'g32n_test',
    ...overrides,
  };
}

function makeStore({
  user = { role: 'admin', email: 'owner@example.test' },
  customerOrders = [], nativeOrders = [nativeMirror()], tasks = [], orderSyncLogs = [], reviewRows = [], commandLogs = [], parityLogs = [], notifications = [], messageLogs = [],
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

const { exports: fns, handler, source } = loadHarness({ env: { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret', HUB_API_URL: 'https://hub.example.test/functions/x', CUSTOMER_APP_SYNC_SECRET: 'sync-secret' } });

assert.equal(fns.TARGET_HUB_ORDER_NUMBER, '1052');
assert.equal(fns.TARGET_NATIVE_SHOPIFY_ORDER_ID, '6a2848655450ef3556960d99');
assert.equal(fns.REQUIRED_PREVIEW_MODE, 'HISTORICAL_CUSTOMER_ORDER_FULFILLMENT_BACKFILL_IMPACT');
assert.equal(fns.REQUIRED_NOTIFICATION_POLICY, 'NO_NOTIFICATION');
assert.equal(fns.REQUIRED_CUSTOMER_APP_ORDER_BACKFILL, 'PREVIEW_ONLY');
assert.equal(fns.REQUIRED_NATIVE_TASK_BACKFILL, 'PREVIEW_ONLY');
assert.equal(fns.REQUIRED_PROOF_DROP_POLICY, 'HELD_NOT_REQUIRED_FOR_RECONCILIATION');
assert.equal(fns.policyBlockers(lookup()).length, 0);
assert.ok(fns.policyBlockers(lookup({ notificationPolicy: 'SEND' })).includes('notification_policy_must_be_no_notification'));
assert.ok(fns.policyBlockers(lookup({ customerAppOrderBackfill: 'CREATE' })).includes('customer_app_order_backfill_must_be_preview_only'));
assert.ok(fns.policyBlockers(lookup({ nativeFulfillmentTaskBackfill: 'CREATE' })).includes('native_fulfillment_task_backfill_must_be_preview_only'));
assert.ok(fns.policyBlockers(lookup({ proofDropPolicy: 'REQUIRED' })).includes('proof_drop_policy_must_be_held_not_required_for_reconciliation'));
assert.equal(fns.nativeMirrorIsValid(nativeMirror(), lookup()), true);
assert.equal(fns.nativeMirrorIsValid(nativeMirror({ source_type: 'manual' }), lookup()), false);
assert.equal(fns.unsupportedBodyKey(validBody({ create_customer_app_order: true })), 'create_customer_app_order');
assert.equal(fns.unsupportedBodyKey(validBody({ notification_payload: { send: true } })), 'notification_payload');

let preview = fns.buildPreview({
  lookup: lookup(),
  hubOrder: hubOrder(),
  hubFetchResult: { ok: true, status: 200, orders: [hubOrder()] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.native_shopify_order_present, true);
assert.equal(preview.customer_app_order_present, false);
assert.equal(preview.native_fulfillment_task_present, false);
assert.equal(preview.customer_app_order_backfill_recommended, false);
assert.equal(preview.customer_app_order_backfill_recommendation, 'customer_app_order_backfill_hold');
assert.equal(preview.native_fulfillment_task_backfill_recommended, false);
assert.equal(preview.native_fulfillment_task_backfill_recommendation, 'native_fulfillment_task_backfill_hold');
assert.equal(preview.native_shopify_order_mirror_sufficient_for_admin_historical_context, true);
assert.equal(preview.notification_impact, false);
assert.equal(preview.notification_would_send, false);
assert.equal(preview.proof_drop_impact.proof_drop_required, false);
assert.equal(preview.delivery_queue_impact.active_delivery_queue_row_projected, false);
assert.equal(preview.customer_facing_impact.would_expose_order_to_customer, true);
assert.ok(preview.warnings.includes('hub_task_rows_absent'));
assert.ok(preview.warnings.includes('notifications_held'));
assert.ok(preview.warnings.includes('proof_drop_held'));
assert.equal(preview.next_action, 'hold_additional_backfill_native_shopify_order_mirror_sufficient');

preview = fns.buildPreview({
  lookup: lookup(),
  hubOrder: hubOrder({ payment_status: null, financial_status: null }),
  hubFetchResult: { ok: true, status: 200, orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.equal(preview.customer_app_order_backfill_recommendation, 'customer_app_order_backfill_blocked_missing_payment_or_customer_data');
assert.ok(preview.warnings.includes('hub_payment_status_missing'));

preview = fns.buildPreview({
  lookup: lookup(),
  hubOrder: hubOrder(),
  hubFetchResult: { ok: true, status: 200, orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords({ customerOrders: [{ id: 'order_1052', order_number: '1052' }] }),
  auth: { actor_type: 'admin' },
});
assert.equal(preview.customer_app_order_present, true);
assert.equal(preview.customer_app_order_backfill_recommendation, 'customer_app_order_backfill_not_needed_existing_order_present');
assert.ok(preview.warnings.includes('existing_customer_app_order_present'));

preview = fns.buildPreview({
  lookup: lookup(),
  hubOrder: hubOrder(),
  hubFetchResult: { ok: true, status: 200, orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords({ tasks: [{ id: 'task_1052', order_number: '1052' }] }),
  auth: { actor_type: 'admin' },
});
assert.equal(preview.native_fulfillment_task_present, true);
assert.equal(preview.native_fulfillment_task_backfill_recommendation, 'native_fulfillment_task_backfill_not_needed_existing_task_present');
assert.ok(preview.warnings.includes('existing_native_fulfillment_task_present'));

preview = fns.buildPreview({
  lookup: lookup(),
  hubOrder: hubOrder(),
  hubFetchResult: { ok: true, status: 200, orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [{ id: 'hub_task_1052' }] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.equal(preview.native_fulfillment_task_backfill_recommendation, 'native_fulfillment_task_backfill_requires_delivered_timestamp');

preview = fns.buildPreview({
  lookup: lookup(),
  hubOrder: hubOrder(),
  hubFetchResult: { ok: true, status: 200, orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords({ nativeOrders: [] }),
  auth: { actor_type: 'admin' },
});
assert.ok(preview.blockers.includes('historical_native_shopify_order_mirror_missing'));
assert.equal(preview.native_shopify_order_present, false);

preview = fns.buildPreview({
  lookup: lookup({ notificationPolicy: 'SEND' }),
  hubOrder: hubOrder(),
  hubFetchResult: { ok: true, status: 200, orders: [] },
  hubTasksResult: { ok: true, status: 200, tasks: [] },
  localRecords: localRecords(),
  auth: { actor_type: 'admin' },
});
assert.ok(preview.blockers.includes('notification_policy_must_be_no_notification'));
assert.equal(preview.notification_would_send, false);

let fake = makeStore();
let res = await handler(req(fake.base44, validBody()));
let body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.dry_run, true);
assert.equal(body.writes_performed, false);
assert.equal(body.native_shopify_order_present, true);
assert.equal(body.customer_app_order_present, false);
assert.equal(body.native_fulfillment_task_present, false);
assert.equal(body.notification_would_send, false);
assert.equal(fake.store.writes.length, 0);

res = await handler(req(fake.base44, validBody(), 'GET'));
body = await json(res);
assert.equal(res.status, 405);
assert.equal(body.writes_performed, false);

fake = makeStore({ user: new Error('no session') });
res = await handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 401);
assert.equal(body.writes_performed, false);
assert.equal(fake.store.writes.length, 0);

fake = makeStore({ user: { role: 'user', email: 'user@example.test' } });
res = await handler(req(fake.base44, validBody()));
body = await json(res);
assert.equal(res.status, 403);
assert.equal(body.writes_performed, false);
assert.equal(fake.store.writes.length, 0);

res = await handler(req(makeStore().base44, validBody({ notification_policy: 'SEND' })));
body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.writes_performed, false);
assert.ok(body.blockers.includes('notification_policy_must_be_no_notification'));

assert.equal(/\.create\(/.test(source), false, 'G32N preview must not call create');
assert.equal(/\.update\(/.test(source), false, 'G32N preview must not call update');
assert.equal(/sendCustomerNotification|SendEmail|sendOrderSms|base44\.asServiceRole\.functions\.invoke|integrations\.Core|fetch\(['\"]https:\/\/api\.stripe|fetch\(['\"]https:\/\/.*shopify/i.test(source), false, 'G32N preview must not call notification/provider APIs');

console.log('G32N historical customer/task backfill impact preview tests passed');
