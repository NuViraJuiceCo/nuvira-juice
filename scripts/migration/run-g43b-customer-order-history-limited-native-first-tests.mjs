#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/getCustomerAccountDashboardData/handlers/getCustomerAccountDashboardData/entry.ts');

const ENABLE_ENV = {
  ENABLE_CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST: 'true',
  CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-MQHJR3V2,NV-MPZNKGNT,NV-MP5SOQLJ,NV-TEST',
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadHarness({ env = {} } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(/^export default async function handler\(req: Request\)/m, 'async function handler(req)');
  source += `\nDeno.serve(handler);\nglobalThis.__exports = { normalizeOrderNumber, applyLimitedNativeFirstOrderHistory, nativeContextEligible, loadNativeHistoryContextForOrder, buildNativeOrderHistoryPatch };\n`;
  const context = vm.createContext({
    console,
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
    Promise,
    Response,
    Deno: {
      env: { get: key => env[key] || '' },
      serve: handler => { context.globalThis.__handler = handler; },
    },
    createClientFromRequest: req => req.__base44,
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { handler: context.globalThis.__handler, exports: context.globalThis.__exports, source };
}

function normalizeOrderNumber(value) {
  return String(value || '').replace(/^#/, '').trim().toUpperCase();
}

function makeOrder(overrides = {}) {
  const orderNumber = overrides.order_number || 'NV-MQHJR3V2';
  return {
    id: overrides.id || `ca_${orderNumber}`,
    order_number: orderNumber,
    customer_email: 'customer',
    customer_name: 'Customer',
    status: overrides.status || 'scheduled_for_juicing',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    fulfillment_status: overrides.fulfillment_status,
    delivery_status: overrides.delivery_status,
    estimated_delivery_date: overrides.estimated_delivery_date || '2026-06-20',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    created_date: overrides.created_date || '2026-06-17T12:00:00.000Z',
    items: overrides.items || [{ title: 'Hydration Shot', quantity: 3, price: 5, image_url: 'safe-image' }],
    subtotal: overrides.subtotal ?? 15,
    delivery_fee: overrides.delivery_fee ?? 0,
    total: overrides.total ?? 15,
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  const orderNumber = overrides.shopify_order_number || overrides.order_number || 'NV-MQHJR3V2';
  return {
    id: overrides.id || `native_${orderNumber}`,
    shopify_order_number: orderNumber,
    base44_order_id: overrides.base44_order_id || `ca_${orderNumber}`,
    order_type: overrides.order_type || 'one_time',
    fulfillment_mode: overrides.fulfillment_mode || 'single_delivery',
    production_status: overrides.production_status || 'awaiting_production',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    requested_delivery_date: overrides.requested_delivery_date || overrides.assigned_delivery_date || '2026-06-20',
    created_date: overrides.created_date || '2026-06-18T12:00:00.000Z',
    line_items: overrides.line_items || [{ title: 'Native item should not replace customer item', quantity: 99, price: 1 }],
    total_price: overrides.total_price ?? 999,
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  const orderNumber = overrides.order_number || 'NV-MQHJR3V2';
  return {
    id: overrides.id || `task_${orderNumber}`,
    order_number: orderNumber,
    base44_order_id: overrides.base44_order_id || `ca_${orderNumber}`,
    native_shopify_order_id: overrides.native_shopify_order_id || `native_${orderNumber}`,
    order_type: overrides.order_type || 'one_time',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: overrides.production_status || 'awaiting_production',
    payment_status: overrides.payment_status || 'paid',
    delivery_date: overrides.delivery_date || '2026-06-20',
    scheduled_date: overrides.scheduled_date || overrides.delivery_date || '2026-06-20',
    assigned_delivery_date: overrides.assigned_delivery_date || overrides.delivery_date || '2026-06-20',
    delivery_window_label: overrides.delivery_window_label || '5:00 PM - 8:00 PM',
    ...overrides,
  };
}

function makeStore({
  user = { email: 'customer', role: 'user' },
  orders = [makeOrder()],
  profiles = [{ id: 'profile_customer', customer_email: 'customer', contact_email: 'customer' }],
  subscriptions = [{ id: 'sub_account', customer_email: 'customer', status: 'active' }],
  credits = [{ id: 'credit_customer', customer_email: 'customer', balance: 12, lifetime_issued: 20, lifetime_used: 8 }],
  points = [{ id: 'points_customer', customer_email: 'customer', total_points: 42, lifetime_points: 60, redeemed_points: 18 }],
  notifications = [{ id: 'notif_customer', customer_email: 'customer', is_read: false }],
  nativeOrders = [makeNativeOrder()],
  tasks = [makeTask()],
  reviewRows = [],
  syncRows = [],
  parityRows = [],
} = {}) {
  const store = {
    UserProfile: profiles,
    Subscription: subscriptions,
    Order: orders,
    NuViraCredit: credits,
    UserPoints: points,
    Notification: notifications,
    ShopifyOrder: nativeOrders,
    FulfillmentTask: tasks,
    OrderReviewQueue: reviewRows,
    OrderSyncLog: syncRows,
    SafeSyncParityLog: parityRows,
    writes: [],
  };
  const rowsFor = name => store[name] || [];
  const match = (row, filter = {}) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const sortRows = (rows, sort) => {
    if (sort === '-created_date') return [...rows].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
    return [...rows];
  };
  const api = name => ({
    filter: async (filter, sort = null, limit = 200) => sortRows(rowsFor(name).filter(row => match(row, filter)), sort).slice(0, limit || undefined),
    list: async (sort = null, limit = 200) => sortRows(rowsFor(name), sort).slice(0, limit || undefined),
    create: async payload => { store.writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { store.writes.push({ op: 'update', name, id, patch }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { store.writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    store,
    base44: {
      auth: { me: async () => user },
      asServiceRole: {
        entities: {
          UserProfile: api('UserProfile'),
          Subscription: api('Subscription'),
          Order: api('Order'),
          NuViraCredit: api('NuViraCredit'),
          UserPoints: api('UserPoints'),
          Notification: api('Notification'),
          ShopifyOrder: api('ShopifyOrder'),
          FulfillmentTask: api('FulfillmentTask'),
          OrderReviewQueue: api('OrderReviewQueue'),
          OrderSyncLog: api('OrderSyncLog'),
          SafeSyncParityLog: api('SafeSyncParityLog'),
        },
      },
    },
  };
}

async function invoke({ env = {}, storeArgs = {} } = {}) {
  const harness = loadHarness({ env });
  const scenario = makeStore(storeArgs);
  const response = await harness.handler({ __base44: scenario.base44 });
  const json = await response.json();
  return { status: response.status, json, scenario, source: harness.source };
}

function byOrder(rows, orderNumber) {
  return rows.find(row => normalizeOrderNumber(row.order_number) === normalizeOrderNumber(orderNumber));
}

function assertNoDiagnostics(row) {
  const serialized = JSON.stringify(row);
  for (const forbidden of ['native_primary_eligible', 'mismatch_fields', 'fallback_reason', 'source_of_truth', 'review_required', 'native_shopify_order_id', 'native_fulfillment_task_id', 'hub_context']) {
    assert.equal(serialized.includes(forbidden), false, `customer row exposed ${forbidden}`);
  }
}

function assertCurrentRowPreserved(row, original) {
  assert.equal(row.id, original.id);
  assert.equal(row.order_number, original.order_number);
  assert.equal(row.created_date, original.created_date);
  assert.equal(row.total, original.total);
  assert.deepEqual(row.items, original.items);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('feature disabled preserves current response exactly', async () => {
  const original = makeOrder();
  const { json } = await invoke({ storeArgs: { orders: [clone(original)] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('kill switch preserves current response', async () => {
  const original = makeOrder();
  const { json } = await invoke({ env: { ...ENABLE_ENV, CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_KILL_SWITCH: 'true' }, storeArgs: { orders: [clone(original)] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('nonallowlisted order preserves current response', async () => {
  const original = makeOrder({ order_number: 'NV-NOTALLOWED' });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [makeNativeOrder({ order_number: 'NV-NOTALLOWED' })], tasks: [makeTask({ order_number: 'NV-NOTALLOWED' })] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('clean active one-time order receives safe native operational enrichment', async () => {
  const original = makeOrder({ order_number: 'NV-MQHJR3V2' });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)] } });
  const row = byOrder(json.all_orders_raw, 'NV-MQHJR3V2');
  assertCurrentRowPreserved(row, original);
  assert.equal(row.production_status, 'awaiting_production');
  assert.equal(row.fulfillment_status, 'pending');
  assert.equal(row.delivery_status, 'pending');
});

test('clean delivered one-time order receives safe native delivered context', async () => {
  const original = makeOrder({ order_number: 'NV-MPZNKGNT', status: 'delivered', estimated_delivery_date: '2026-06-06', assigned_delivery_date: '2026-06-06' });
  const { json } = await invoke({
    env: ENABLE_ENV,
    storeArgs: {
      orders: [clone(original)],
      nativeOrders: [makeNativeOrder({ order_number: 'NV-MPZNKGNT', production_status: 'fulfilled', fulfillment_status: 'fulfilled', assigned_delivery_date: '2026-06-06', requested_delivery_date: '2026-06-06', base44_order_id: 'ca_NV-MPZNKGNT' })],
      tasks: [makeTask({ order_number: 'NV-MPZNKGNT', base44_order_id: 'ca_NV-MPZNKGNT', native_shopify_order_id: 'native_NV-MPZNKGNT', status: 'delivered', delivery_status: 'delivered', production_status: 'fulfilled', delivery_date: '2026-06-06' })],
    },
  });
  const row = byOrder(json.all_orders_raw, 'NV-MPZNKGNT');
  assertCurrentRowPreserved(row, original);
  assert.equal(row.production_status, 'fulfilled');
  assert.equal(row.delivery_status, 'delivered');
});

test('Customer App Order remains canonical returned row', async () => {
  const { json } = await invoke({ env: ENABLE_ENV });
  const row = json.all_orders_raw[0];
  assert.equal(row.id, 'ca_NV-MQHJR3V2');
  assert.equal(row.id.startsWith('native_'), false);
  assert.equal(row.id.startsWith('task_'), false);
});

test('customer-facing created date remains original Customer App date', async () => {
  const original = makeOrder({ created_date: '2026-05-01T10:00:00.000Z' });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [makeNativeOrder({ created_date: '2026-06-18T12:00:00.000Z' })] } });
  assert.equal(json.all_orders_raw[0].created_date, original.created_date);
});

test('native mirror creation date never makes historical order appear new', async () => {
  const original = makeOrder({ order_number: 'NV-MP5SOQLJ', status: 'delivered', created_date: '2026-05-15T10:00:00.000Z', estimated_delivery_date: '2026-05-16', assigned_delivery_date: '2026-05-16' });
  const { json } = await invoke({
    env: ENABLE_ENV,
    storeArgs: {
      orders: [clone(original)],
      nativeOrders: [makeNativeOrder({ order_number: 'NV-MP5SOQLJ', base44_order_id: 'ca_NV-MP5SOQLJ', source_type: 'hub_historical_backfill', sync_status: 'late_mirror', production_status: 'fulfilled', fulfillment_status: 'fulfilled', assigned_delivery_date: '2026-05-16', requested_delivery_date: '2026-05-16', created_date: '2026-06-17T12:00:00.000Z' })],
      tasks: [makeTask({ order_number: 'NV-MP5SOQLJ', base44_order_id: 'ca_NV-MP5SOQLJ', native_shopify_order_id: 'native_NV-MP5SOQLJ', task_source: 'historical_late_task_mirror', status: 'delivered', delivery_status: 'delivered', production_status: 'fulfilled', delivery_date: '2026-05-16' })],
    },
  });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('native ShopifyOrder missing preserves fallback', async () => {
  const original = makeOrder();
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [], tasks: [makeTask()] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('FulfillmentTask missing preserves fallback', async () => {
  const original = makeOrder();
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], tasks: [] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('duplicate native identity preserves fallback', async () => {
  const original = makeOrder();
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [makeNativeOrder(), makeNativeOrder({ id: 'native_duplicate' })] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('payment mismatch preserves fallback', async () => {
  const original = makeOrder();
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [makeNativeOrder({ payment_status: 'pending' })] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('status mismatch preserves fallback', async () => {
  const original = makeOrder({ status: 'scheduled_for_juicing' });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [makeNativeOrder({ production_status: 'in_production' })], tasks: [makeTask({ status: 'in_production', delivery_status: 'in_production', production_status: 'in_production' })] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('fulfillment mismatch preserves fallback', async () => {
  const original = makeOrder({ fulfillment_status: 'pending_production' });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [makeNativeOrder({ fulfillment_status: 'fulfilled' })] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('delivery date mismatch preserves fallback', async () => {
  const original = makeOrder({ assigned_delivery_date: '2026-06-20', estimated_delivery_date: '2026-06-20' });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], tasks: [makeTask({ delivery_date: '2026-06-21', assigned_delivery_date: '2026-06-21' })] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('refund remains Hub/payment source-of-truth', async () => {
  const original = makeOrder({ status: 'refunded', payment_status: 'refunded', financial_status: 'refunded', refund_status: 'fully_refunded', refunded_at: '2026-05-07T16:18:57.862Z' });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('cancelled order preserves current behavior', async () => {
  const original = makeOrder({ status: 'cancelled', payment_status: 'paid', financial_status: 'paid', payment_captured: true });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('subscription remains Hub source-of-truth', async () => {
  const original = makeOrder({ order_type: 'subscription', is_subscription: true });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [makeNativeOrder({ order_type: 'subscription' })], tasks: [makeTask({ order_type: 'subscription' })] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('multi-delivery remains Hub source-of-truth', async () => {
  const original = makeOrder({ fulfillment_mode: 'multi_delivery' });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [makeNativeOrder({ fulfillment_mode: 'multi_delivery' })], tasks: [makeTask()] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('review queue blocker preserves fallback', async () => {
  const original = makeOrder();
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], reviewRows: [{ id: 'review', existing_order_number: 'NV-MQHJR3V2', status: 'pending' }] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('repair/replay ambiguity preserves fallback', async () => {
  const original = makeOrder();
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], parityRows: [{ id: 'parity', order_number: 'NV-MQHJR3V2', native_parity_status: 'needs_manual_review' }] } });
  assert.deepEqual(json.all_orders_raw, [clone(original)]);
});

test('Hub-only/current valid order remains visible through current path equivalent', async () => {
  const original = makeOrder({ order_number: 'NV-HUBONLY' });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)], nativeOrders: [], tasks: [] } });
  assert.equal(json.all_orders_raw.length, 1);
  assert.equal(json.all_orders_raw[0].order_number, 'NV-HUBONLY');
});

test('no valid order is hidden', async () => {
  const orders = [makeOrder({ order_number: 'NV-MQHJR3V2' }), makeOrder({ order_number: 'NV-OTHER' })];
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: clone(orders) } });
  assert.equal(json.all_orders_raw.length, 2);
});

test('no duplicate order is returned', async () => {
  const orders = [makeOrder({ order_number: 'NV-MQHJR3V2' })];
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: clone(orders) } });
  assert.equal(json.all_orders_raw.filter(row => row.order_number === 'NV-MQHJR3V2').length, 1);
});

test('paid POS order owned by normalized profile phone is included without a Customer App mirror', async () => {
  const { json } = await invoke({
    storeArgs: {
      orders: [],
      profiles: [{ id: 'profile_customer', customer_email: 'customer', contact_email: 'customer', phone: '5551234567' }],
      nativeOrders: [makeNativeOrder({
        id: 'native_1058',
        shopify_order_number: '1058',
        base44_order_id: '',
        customer_email: 'checkout-alias',
        customer_phone: '+15551234567',
        customer_name: 'Customer',
        source_channel: 'pos',
        fulfillment_method: 'pos',
        fulfillment_status: 'fulfilled',
        shopify_fulfillment_status: 'fulfilled',
        production_status: 'not_required',
        payment_status: 'paid',
        financial_status: 'paid',
        customer_order_date: '2026-07-11T19:10:55.518Z',
        total_price: 104.30,
        subtotal: 104.30,
        line_items: [
          { title: 'Juice One', quantity: 2, price: 20 },
          { title: 'Juice Two', quantity: 1, price: 24.30 },
          { title: 'Juice Three', quantity: 1, price: 40 },
        ],
      })],
      tasks: [],
    },
  });

  assert.equal(json.all_orders_raw.length, 1);
  assert.equal(json.all_orders_raw[0].order_number, '1058');
  assert.equal(json.all_orders_raw[0].status, 'picked_up');
  assert.equal(json.all_orders_raw[0].total, 104.30);
  assert.equal(json.all_orders_raw[0].items.length, 3);
  assert.equal(json.order_count, 1);
  assert.equal(json.orders.length, 1);
  assert.equal(Object.hasOwn(json.all_orders_raw[0], 'customer_email'), false);
  assert.equal(Object.hasOwn(json.all_orders_raw[0], 'customer_phone'), false);
  assert.equal(JSON.stringify(json.all_orders_raw[0]).includes('shopify_raw_payload'), false);
});

test('missing Hub fulfillment metadata defaults to delivery instead of inventing pickup', async () => {
  const { json } = await invoke({
    storeArgs: {
      orders: [],
      profiles: [{ id: 'profile_customer', customer_email: 'customer', contact_email: 'customer', phone: '5551234567' }],
      nativeOrders: [makeNativeOrder({
        id: 'native_delivery_default',
        shopify_order_number: 'NV-DELIVERY-DEFAULT',
        base44_order_id: '',
        customer_email: 'checkout-alias',
        customer_phone: '+15551234567',
        customer_name: 'Customer',
        source_channel: 'online',
        fulfillment_method: '',
        fulfillment_status: 'fulfilled',
        shopify_fulfillment_status: 'fulfilled',
        production_status: 'fulfilled',
        payment_status: 'paid',
        financial_status: 'paid',
      })],
      tasks: [],
    },
  });

  assert.equal(json.all_orders_raw.length, 1);
  assert.equal(json.all_orders_raw[0].fulfillment_type, 'delivery');
  assert.equal(json.all_orders_raw[0].status, 'delivered');
});

test('authoritative source merge deduplicates an owned Shopify or POS mirror by order number', async () => {
  const current = makeOrder({ order_number: '1058' });
  const { json } = await invoke({
    storeArgs: {
      orders: [current],
      profiles: [{ id: 'profile_customer', customer_email: 'customer', contact_email: 'customer', phone: '5551234567' }],
      nativeOrders: [makeNativeOrder({
        id: 'native_1058',
        shopify_order_number: '#1058',
        base44_order_id: '',
        customer_email: 'customer',
        customer_phone: '+15551234567',
      })],
      tasks: [],
    },
  });
  assert.equal(json.all_orders_raw.length, 1);
  assert.equal(json.all_orders_raw[0].id, current.id);
});

test('authoritative source merge rejects paid rows that match neither owned email nor owned phone', async () => {
  const { json } = await invoke({
    storeArgs: {
      orders: [],
      profiles: [{ id: 'profile_customer', customer_email: 'customer', contact_email: 'customer', phone: '5551234567' }],
      nativeOrders: [makeNativeOrder({
        id: 'native_unowned',
        shopify_order_number: '9999',
        customer_email: 'someone-else',
        customer_phone: '+15559876543',
      })],
      tasks: [],
    },
  });
  assert.equal(json.all_orders_raw.length, 0);
});

test('authoritative source merge kill switch restores the prior Customer App-only history', async () => {
  const { json } = await invoke({
    env: { CUSTOMER_ORDER_HISTORY_SOURCE_MERGE_KILL_SWITCH: 'true' },
    storeArgs: {
      orders: [],
      profiles: [{ id: 'profile_customer', customer_email: 'customer', contact_email: 'customer', phone: '5551234567' }],
      nativeOrders: [makeNativeOrder({
        id: 'native_1058',
        shopify_order_number: '1058',
        customer_email: 'customer',
        customer_phone: '+15551234567',
      })],
      tasks: [],
    },
  });
  assert.equal(json.all_orders_raw.length, 0);
});

test('pagination and sorting remain compatible', async () => {
  const orders = [
    makeOrder({ order_number: 'NV-MQHJR3V2', created_date: '2026-06-17T12:00:00.000Z' }),
    makeOrder({ order_number: 'NV-OLDER', created_date: '2026-06-01T12:00:00.000Z' }),
  ];
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: clone(orders) } });
  assert.deepEqual(json.all_orders_raw.map(row => row.order_number), ['NV-MQHJR3V2', 'NV-OLDER']);
});

test('order totals and line items remain unchanged', async () => {
  const original = makeOrder({ total: 15, items: [{ title: 'Customer item', quantity: 3, price: 5 }] });
  const { json } = await invoke({ env: ENABLE_ENV, storeArgs: { orders: [clone(original)] } });
  assert.equal(json.all_orders_raw[0].total, 15);
  assert.deepEqual(json.all_orders_raw[0].items, original.items);
});

test('existing links/routes remain compatible', async () => {
  const { json } = await invoke({ env: ENABLE_ENV });
  const row = json.all_orders_raw[0];
  assert.equal(row.order_number, 'NV-MQHJR3V2');
  assert.ok(`/order-tracker/${row.order_number}?source=order_history`.includes('NV-MQHJR3V2'));
});

test('no customer-visible diagnostic metadata', async () => {
  const { json } = await invoke({ env: ENABLE_ENV });
  assertNoDiagnostics(json.all_orders_raw[0]);
});

test('no new PII exposure in enriched row keys', async () => {
  const { json } = await invoke({ env: ENABLE_ENV });
  const row = json.all_orders_raw[0];
  for (const key of Object.keys(row)) {
    assert.equal(['customer_phone', 'address_line1', 'address_line2', 'shopify_raw_payload'].includes(key), false);
  }
});

test('no raw payload exposure', async () => {
  const { json } = await invoke({ env: ENABLE_ENV });
  assert.equal(JSON.stringify(json.all_orders_raw).includes('raw_payload'), false);
  assert.equal(JSON.stringify(json.all_orders_raw).includes('provider_payload'), false);
});

test('no writes', async () => {
  const { scenario } = await invoke({ env: ENABLE_ENV });
  assert.deepEqual(scenario.store.writes, []);
});

test('no provider calls', async () => {
  const { source } = await invoke({ env: ENABLE_ENV });
  assert.equal(/stripe\.refunds|new Stripe|Shopify\(|fetch\(/.test(source), false);
});

test('no notifications', async () => {
  const { source } = await invoke({ env: ENABLE_ENV });
  assert.equal(/send[A-Z][A-Za-z]+Notification|CustomerMessageDeliveryLog\.create|Notification\.create/.test(source), false);
});

test('no Hub mutation', async () => {
  const { source } = await invoke({ env: ENABLE_ENV });
  assert.equal(/syncOrderToHub\(|pushOrderStatusToHub\(|syncHubDeliveryStatuses\(/.test(source), false);
});

test('non-order dashboard fields remain unchanged', async () => {
  const { json } = await invoke({ env: ENABLE_ENV });
  assert.equal(json.customer_profile.id, 'profile_customer');
  assert.equal(json.active_subscriptions.length, 1);
  assert.equal(json.subscription_count, 1);
  assert.equal(json.credits, 12);
  assert.equal(json.loyalty_points, 42);
  assert.equal(json.notifications_unread_count, 1);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

if (failed > 0) {
  console.error(`G43B customer order history limited native-first tests failed: ${failed}`);
  process.exit(1);
}

console.log(JSON.stringify({
  suite: 'g43b-customer-order-history-limited-native-first',
  tests: tests.length,
  passed: tests.length,
  failed: 0,
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
  hub_mutation_performed: false,
}, null, 2));
console.log('G43B customer order history limited native-first tests passed');
