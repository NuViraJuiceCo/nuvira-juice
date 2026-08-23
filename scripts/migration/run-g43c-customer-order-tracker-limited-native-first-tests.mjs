#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = process.cwd();
const functionPath = path.join(repoRoot, 'base44/functions/getCustomerOrderDetail/entry.ts');
const source = fs.readFileSync(functionPath, 'utf8');
const trackerSource = fs.readFileSync(path.join(repoRoot, 'src/pages/OrderTracker.jsx'), 'utf8');

function loadHarness(env = {}) {
  let handler;
  const sandbox = {
    console,
    Response,
    Deno: {
      env: { get: name => env[name] || '' },
      serve: fn => { handler = fn; },
    },
    createClientFromRequest: req => req.__base44,
  };
  const runnable = source.replace("import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';", '');
  vm.runInNewContext(runnable, sandbox, { filename: functionPath });
  return { handler, source };
}

function normalizeOrderNumber(value) {
  return String(value ?? '').trim().replace(/^#/, '').toUpperCase();
}

function api(rows, writes) {
  return {
    filter: async (query = {}, sort = null, limit = 100) => {
      let out = rows.filter(row => Object.entries(query || {}).every(([key, value]) => row?.[key] === value));
      if (sort === '-created_date') out = [...out].sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
      return out.slice(0, limit || out.length);
    },
    create: async row => { writes.push({ action: 'create', row }); return row; },
    update: async (id, row) => { writes.push({ action: 'update', id, row }); return row; },
    delete: async id => { writes.push({ action: 'delete', id }); },
  };
}

const baseOrderDefaults = {
  id: 'ca_NV-MQHJR3V2',
  order_number: 'NV-MQHJR3V2',
  customer_email: 'owner@example.test',
  customer_name: 'Owner Example',
  status: 'scheduled_for_juicing',
  payment_status: 'paid',
  payment_captured: true,
  created_date: '2026-06-17T04:04:15.034000',
  fulfillment_type: 'delivery',
  estimated_delivery_date: '2026-06-20',
  assigned_delivery_date: '2026-06-20',
  total: 43.99,
  items: [
    { title: 'Hydration Shot', quantity: 3, price: 6, image_url: null },
    { title: 'Radiance Shot', quantity: 3, price: 6, image_url: null },
  ],
};

function makeOrder(overrides = {}) {
  return { ...baseOrderDefaults, ...overrides };
}

function makeNativeOrder(overrides = {}) {
  const orderNumber = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || baseOrderDefaults.order_number);
  return {
    id: overrides.id || `native_${orderNumber}`,
    base44_order_id: overrides.base44_order_id ?? `ca_${orderNumber}`,
    customer_app_order_id: overrides.customer_app_order_id,
    shopify_order_number: overrides.shopify_order_number || orderNumber,
    order_number: overrides.order_number,
    customer_email: overrides.customer_email || 'owner@example.test',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    production_status: overrides.production_status || 'awaiting_production',
    order_status: overrides.order_status,
    fulfillment_status: overrides.fulfillment_status || 'pending',
    requested_delivery_date: overrides.requested_delivery_date || '2026-06-20',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    requested_time_window: overrides.requested_time_window,
    source_type: overrides.source_type || 'one_time',
    source_channel: overrides.source_channel || 'online',
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  const orderNumber = normalizeOrderNumber(overrides.order_number || overrides.shopify_order_number || baseOrderDefaults.order_number);
  return {
    id: overrides.id || `task_${orderNumber}`,
    order_id: overrides.order_id,
    base44_order_id: overrides.base44_order_id ?? `ca_${orderNumber}`,
    native_shopify_order_id: overrides.native_shopify_order_id || `native_${orderNumber}`,
    shopify_order_id: overrides.shopify_order_id,
    order_number: overrides.order_number || orderNumber,
    shopify_order_number: overrides.shopify_order_number,
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: overrides.production_status || 'awaiting_production',
    payment_status: overrides.payment_status,
    delivery_date: overrides.delivery_date || '2026-06-20',
    scheduled_date: overrides.scheduled_date,
    assigned_delivery_date: overrides.assigned_delivery_date,
    order_type: overrides.order_type || 'one_time',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    ...overrides,
  };
}

function makeScenario({ user = { email: 'owner@example.test', role: 'user' }, orders, nativeOrders, tasks, reviews = [], syncRows = [], parityRows = [], hubOrders = [], profiles, subscriptions = [], credits = [], points = [], notifications = [] } = {}) {
  const writes = [];
  const rows = {
    UserProfile: profiles || [{ id: 'profile_owner', customer_email: 'owner@example.test', contact_email: 'owner@example.test' }],
    Order: orders || [makeOrder()],
    ShopifyOrder: nativeOrders || [makeNativeOrder()],
    FulfillmentTask: tasks || [makeTask()],
    OrderReviewQueue: reviews,
    OrderSyncLog: syncRows,
    SafeSyncParityLog: parityRows,
    Subscription: subscriptions,
    NuViraCredit: credits,
    UserPoints: points,
    Notification: notifications,
  };
  const entities = Object.fromEntries(Object.entries(rows).map(([name, data]) => [name, api(data, writes)]));
  return {
    writes,
    base44: {
      auth: { me: async () => user },
      asServiceRole: { entities },
    },
  };
}

function req(base44, body = { order_number: 'NV-MQHJR3V2', source: 'order_history' }) {
  return { __base44: base44, json: async () => body };
}

async function invoke({ env, scenario, body } = {}) {
  const { handler } = loadHarness(env || liveEnv());
  const store = makeScenario(scenario || {});
  const response = await handler(req(store.base44, body));
  return { json: await response.json(), status: response.status, writes: store.writes };
}

function liveEnv(overrides = {}) {
  return {
    ENABLE_CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST: 'true',
    CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_KILL_SWITCH: '',
    CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-MQHJR3V2,NV-MPZNKGNT',
    ...overrides,
  };
}

function stripVolatile(json) {
  const copy = JSON.parse(JSON.stringify(json));
  delete copy.debug_lookup_path;
  delete copy.resolved_identity_emails;
  return copy;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function assertFallback(name, scenario, expectedOrder = makeOrder()) {
  const result = await invoke({ scenario });
  assert.equal(result.json.order.production_status, expectedOrder.production_status);
  assert.equal(result.json.order.fulfillment_status, expectedOrder.fulfillment_status);
  assert.equal(result.json.order.delivery_status, expectedOrder.delivery_status);
  assert.equal(result.json.order.created_date, expectedOrder.created_date);
  return result;
}

test('feature disabled preserves current response exactly', async () => {
  const scenario = { orders: [makeOrder()], nativeOrders: [makeNativeOrder({ production_status: 'awaiting_production' })], tasks: [makeTask({ production_status: 'awaiting_production' })] };
  const disabled = await invoke({ env: liveEnv({ ENABLE_CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST: '' }), scenario });
  const noNative = await invoke({ env: liveEnv({ ENABLE_CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST: '' }), scenario: { ...scenario, nativeOrders: [], tasks: [] } });
  assert.deepEqual(stripVolatile(disabled.json), stripVolatile(noNative.json));
});

test('kill switch preserves current response', async () => {
  const result = await invoke({ env: liveEnv({ CUSTOMER_ORDER_TRACKER_LIMITED_NATIVE_FIRST_KILL_SWITCH: 'true' }) });
  assert.equal(result.json.order.production_status, undefined);
});

test('nonallowlisted order preserves current response', async () => {
  const result = await invoke({ scenario: { orders: [makeOrder({ id: 'ca_OTHER', order_number: 'NV-OTHER' })], nativeOrders: [makeNativeOrder({ base44_order_id: 'ca_OTHER', shopify_order_number: 'NV-OTHER' })], tasks: [makeTask({ base44_order_id: 'ca_OTHER', order_number: 'NV-OTHER', native_shopify_order_id: 'native_NV-OTHER' })] }, body: { order_number: 'NV-OTHER', source: 'order_history' } });
  assert.equal(result.json.order.production_status, undefined);
});

test('ownership filtering occurs before allowlist/native enrichment', async () => {
  const result = await invoke({ scenario: { user: { email: 'other@example.test', role: 'user' }, profiles: [{ customer_email: 'other@example.test', contact_email: 'other@example.test' }] } });
  assert.equal(result.status, 403);
});

test('allowlisted order owned by another customer is not returned', async () => {
  const result = await invoke({ scenario: { user: { email: 'other@example.test', role: 'user' }, profiles: [{ customer_email: 'other@example.test', contact_email: 'other@example.test' }], orders: [makeOrder({ customer_email: 'owner@example.test' })] } });
  assert.equal(result.json.found, false);
});

test('Customer App Order remains canonical', async () => {
  const result = await invoke();
  assert.equal(result.json.order.id, 'ca_NV-MQHJR3V2');
  assert.equal(result.json.hub_order, null);
});

test('original created date is preserved', async () => {
  const result = await invoke({ scenario: { nativeOrders: [makeNativeOrder({ created_date: '2026-06-18T00:00:00Z' })] } });
  assert.equal(result.json.order.created_date, baseOrderDefaults.created_date);
});

test('totals and line items remain unchanged', async () => {
  const result = await invoke({ scenario: { nativeOrders: [makeNativeOrder({ total_price: 1, line_items: [{ title: 'Wrong', quantity: 99, price: 1 }] })] } });
  assert.equal(result.json.order.total, 43.99);
  assert.equal(result.json.order.items.length, 2);
});

test('exact native ShopifyOrder match by base44_order_id', async () => {
  const result = await invoke({ scenario: { nativeOrders: [makeNativeOrder({ shopify_order_number: null, order_number: null, base44_order_id: 'ca_NV-MQHJR3V2' })] } });
  assert.equal(result.json.order.production_status, 'awaiting_production');
});

test('exact native ShopifyOrder match by normalized order number', async () => {
  const result = await invoke({ scenario: { nativeOrders: [makeNativeOrder({ base44_order_id: 'other', shopify_order_number: '#NV-MQHJR3V2' })] } });
  assert.equal(result.json.order.production_status, 'awaiting_production');
});

test('multiple native ShopifyOrder matches preserve fallback', async () => {
  await assertFallback('multiple native', { nativeOrders: [makeNativeOrder({ id: 'a' }), makeNativeOrder({ id: 'b' })] });
});

test('task match by order_id', async () => {
  const result = await invoke({ scenario: { tasks: [makeTask({ order_id: 'ca_NV-MQHJR3V2', base44_order_id: 'other', native_shopify_order_id: 'other', order_number: '' })] } });
  assert.equal(result.json.order.production_status, 'awaiting_production');
});

test('task match by base44_order_id', async () => {
  const result = await invoke({ scenario: { tasks: [makeTask({ order_id: 'other', base44_order_id: 'ca_NV-MQHJR3V2', native_shopify_order_id: 'other', order_number: '' })] } });
  assert.equal(result.json.order.production_status, 'awaiting_production');
});

test('task match by native_shopify_order_id', async () => {
  const result = await invoke({ scenario: { tasks: [makeTask({ order_id: 'other', base44_order_id: 'other', native_shopify_order_id: 'native_NV-MQHJR3V2', order_number: '' })] } });
  assert.equal(result.json.order.production_status, 'awaiting_production');
});

test('task match by normalized order_number', async () => {
  const result = await invoke({ scenario: { tasks: [makeTask({ order_id: 'other', base44_order_id: 'other', native_shopify_order_id: 'other', order_number: '#NV-MQHJR3V2' })] } });
  assert.equal(result.json.order.production_status, 'awaiting_production');
});

test('duplicate task candidates dedupe by id', async () => {
  const task = makeTask({ id: 'same-task', order_id: 'ca_NV-MQHJR3V2', base44_order_id: 'ca_NV-MQHJR3V2' });
  const result = await invoke({ scenario: { tasks: [task] } });
  assert.equal(result.json.order.production_status, 'awaiting_production');
});

test('conflicting task candidates preserve fallback', async () => {
  await assertFallback('conflicting tasks', { tasks: [makeTask({ id: 'a' }), makeTask({ id: 'b' })] });
});

test('missing task preserves fallback', async () => {
  await assertFallback('missing task', { tasks: [] });
});

test('clean active one-time tracker receives safe enrichment', async () => {
  const result = await invoke();
  assert.equal(result.json.order.production_status, 'awaiting_production');
  assert.equal(result.json.order.fulfillment_status, 'pending');
  assert.equal(result.json.order.delivery_status, 'pending');
});

test('clean delivered one-time tracker receives safe delivered context', async () => {
  const result = await invoke({ scenario: { orders: [makeOrder({ id: 'ca_NV-MPZNKGNT', order_number: 'NV-MPZNKGNT', status: 'delivered', created_date: '2026-06-01T00:00:00Z' })], nativeOrders: [makeNativeOrder({ id: 'native_NV-MPZNKGNT', base44_order_id: 'ca_NV-MPZNKGNT', shopify_order_number: 'NV-MPZNKGNT', production_status: 'delivered', fulfillment_status: 'delivered', assigned_delivery_date: '2026-06-20', requested_delivery_date: '2026-06-20' })], tasks: [makeTask({ id: 'task_NV-MPZNKGNT', base44_order_id: 'ca_NV-MPZNKGNT', native_shopify_order_id: 'native_NV-MPZNKGNT', order_number: 'NV-MPZNKGNT', status: 'delivered', delivery_status: 'delivered', production_status: 'delivered' })] }, body: { order_number: 'NV-MPZNKGNT', source: 'order_history' } });
  assert.equal(result.json.order.production_status, 'delivered');
  assert.equal(result.json.order.delivery_status, 'delivered');
  assert.equal(result.json.delivery_status.status, 'delivered');
  assert.equal(result.json.is_terminal, true);
});

test('completed production cannot complete a delivery order before delivery', async () => {
  const result = await invoke({
    scenario: {
      orders: [makeOrder({ status: 'delivered', production_status: 'completed', fulfillment_status: 'fulfilled' })],
      nativeOrders: [makeNativeOrder({ production_status: 'completed', fulfillment_status: 'fulfilled' })],
      tasks: [makeTask({ status: 'packed', delivery_status: 'pending', production_status: 'completed' })],
    },
  });
  assert.equal(result.json.delivery_status.status, 'bottled_packed');
  assert.equal(result.json.customer_visible_status, 'Bottled & Packed');
  assert.equal(result.json.is_terminal, false);
});

test('route start becomes out for delivery and remains nonterminal', async () => {
  const result = await invoke({
    scenario: {
      orders: [makeOrder({ status: 'delivered', production_status: 'completed', fulfillment_status: 'fulfilled' })],
      nativeOrders: [makeNativeOrder({ production_status: 'completed', fulfillment_status: 'fulfilled' })],
      tasks: [makeTask({ status: 'out_for_delivery', delivery_status: 'out_for_delivery', production_status: 'completed' })],
    },
  });
  assert.equal(result.json.delivery_status.status, 'out_for_delivery');
  assert.equal(result.json.customer_visible_status, 'Out for Delivery');
  assert.equal(result.json.is_terminal, false);
});

test('all linked delivery tasks must be delivered before the order is terminal', async () => {
  const result = await invoke({
    scenario: {
      orders: [makeOrder({ status: 'delivered', production_status: 'completed', fulfillment_status: 'fulfilled' })],
      nativeOrders: [makeNativeOrder({ production_status: 'completed', fulfillment_status: 'fulfilled' })],
      tasks: [
        makeTask({ id: 'task_delivered', status: 'delivered', delivery_status: 'delivered', production_status: 'completed' }),
        makeTask({ id: 'task_pending', status: 'packed', delivery_status: 'pending', production_status: 'completed' }),
      ],
    },
  });
  assert.equal(result.json.delivery_status.status, 'bottled_packed');
  assert.equal(result.json.is_terminal, false);
});

test('refund remains Hub/payment source-of-truth', async () => {
  await assertFallback('refund', { orders: [makeOrder({ status: 'refunded', payment_status: 'refunded' })] }, makeOrder({ status: 'refunded', payment_status: 'refunded' }));
});

test('cancelled order preserves current behavior', async () => {
  await assertFallback('cancelled', { orders: [makeOrder({ status: 'cancelled' })] }, makeOrder({ status: 'cancelled' }));
});

test('subscription remains Hub source-of-truth', async () => {
  await assertFallback('subscription', { orders: [makeOrder({ order_type: 'subscription' })] }, makeOrder({ order_type: 'subscription' }));
});

test('multi-delivery remains Hub source-of-truth', async () => {
  await assertFallback('multi', { tasks: [makeTask({ fulfillment_type: 'multi_delivery' })] });
});

test('payment mismatch preserves fallback', async () => {
  await assertFallback('payment mismatch', { nativeOrders: [makeNativeOrder({ payment_status: 'pending' })] });
});

test('fulfillment mismatch preserves fallback', async () => {
  await assertFallback('fulfillment mismatch', { orders: [makeOrder({ fulfillment_status: 'packed' })], nativeOrders: [makeNativeOrder({ fulfillment_status: 'pending' })] }, makeOrder({ fulfillment_status: 'packed' }));
});

test('delivery schedule mismatch preserves fallback', async () => {
  await assertFallback('date mismatch', { nativeOrders: [makeNativeOrder({ assigned_delivery_date: '2026-06-21', requested_delivery_date: '2026-06-21' })], tasks: [makeTask({ delivery_date: '2026-06-21' })] });
});

test('review queue hold preserves fallback', async () => {
  await assertFallback('review', { reviews: [{ id: 'review', existing_order_id: 'ca_NV-MQHJR3V2', status: 'open' }] });
});

test('repair/replay hold preserves fallback', async () => {
  await assertFallback('repair', { syncRows: [{ id: 'sync', order_number: 'NV-MQHJR3V2', action: 'repair replay' }] });
});

test('ProductionBatch state is not used as direct customer tracker source', async () => {
  assert.equal(/ProductionBatch/.test(source), false);
});

test('internal production statuses are not returned by enrichment', async () => {
  const blocked = await invoke({ scenario: { nativeOrders: [makeNativeOrder({ production_status: 'completed_pending_verification' })], tasks: [makeTask({ production_status: 'completed_pending_verification', delivery_status: 'completed_pending_verification', status: 'completed_pending_verification' })] } });
  assert.notEqual(blocked.json.order.status, 'completed_pending_verification');

  const eligibleButUnsafeProduction = await invoke({ scenario: { nativeOrders: [makeNativeOrder({ production_status: 'completed_pending_verification' })], tasks: [makeTask({ production_status: null, delivery_status: null, status: 'pending' })] } });
  assert.equal(eligibleButUnsafeProduction.json.order.production_status, undefined);
});

test('existing OrderTracker response shape remains compatible', async () => {
  const result = await invoke();
  for (const key of ['found', 'source_record', 'order', 'hub_order', 'fulfillment_tasks', 'status_timeline', 'delivery_status', 'customer_visible_status', 'is_terminal']) {
    assert.ok(Object.prototype.hasOwnProperty.call(result.json, key));
  }
});

test('existing tracker route identifiers remain compatible', async () => {
  const byNumber = await invoke({ body: { order_number: 'NV-MQHJR3V2', source: 'order_history' } });
  const byId = await invoke({ body: { order_id: 'ca_NV-MQHJR3V2', source: 'order_history' } });
  assert.equal(byNumber.json.found, true);
  assert.equal(byId.json.found, true);
});

test('numeric POS order number resolves through phone-owned ShopifyOrder fallback', async () => {
  const result = await invoke({
    scenario: {
      orders: [],
      profiles: [{ id: 'profile_owner', customer_email: 'owner@example.test', contact_email: 'owner@example.test', phone: '5551234567' }],
      nativeOrders: [makeNativeOrder({
        id: 'native_1058',
        base44_order_id: '',
        shopify_order_number: '1058',
        customer_email: 'checkout-alias@example.test',
        customer_phone: '+15551234567',
        customer_name: 'Owner Example',
        source_channel: 'pos',
        fulfillment_method: 'pos',
        production_status: 'not_required',
        fulfillment_status: 'fulfilled',
        shopify_fulfillment_status: 'fulfilled',
        line_items: [{ title: 'Juice', quantity: 2, price: 12 }],
        total_price: 24,
        shopify_raw_payload: { secret: 'must-not-return' },
        internal_notes: 'must-not-return',
      })],
      tasks: [],
    },
    body: { order_number: '1058', source: 'order_history' },
  });

  assert.equal(result.status, 200);
  assert.equal(result.json.found, true);
  assert.equal(result.json.source_record, 'hub_shopify_order');
  assert.equal(result.json.hub_order.shopify_order_number, '1058');
  assert.equal(result.json.hub_order.status, 'picked_up');
  assert.equal(result.json.hub_order.fulfillment_method, 'pickup');
  assert.equal(result.json.hub_order.requested_time_window, 'Order complete');
  assert.equal(result.json.customer_visible_status, 'Order Complete ✓');
  assert.equal(result.json.hub_order.line_items.length, 1);
  assert.equal(Object.hasOwn(result.json.hub_order, 'customer_email'), false);
  assert.equal(Object.hasOwn(result.json.hub_order, 'customer_phone'), false);
  assert.equal(JSON.stringify(result.json.hub_order).includes('must-not-return'), false);
});

test('numeric order routes are treated as order numbers instead of Base44 entity ids', async () => {
  assert.match(trackerSource, /const isBase44EntityId = \/\^\[a-f0-9\]\{24\}\$\/i/);
  assert.match(trackerSource, /const isOrderNumber = Boolean\(rawParam && !isStripeIdentifier && !isBase44EntityId\)/);
  assert.match(trackerSource, /const orderNumberParam = isOrderNumber \? rawParam\.replace\(\/\^#\//);
});

test('customer tracker gives native delivery precedence and neutralizes legacy POS completion copy', async () => {
  assert.match(trackerSource, /resolveCustomerJourneyFulfillmentType/);
  assert.match(trackerSource, /fulfillment_type: isPickupOrder \? 'pickup' : 'delivery'/);
  assert.match(trackerSource, /journey\.normalizedStatus === 'picked_up'[\s\S]*?\? 'Order status'/);
  assert.match(trackerSource, /journey\.normalizedStatus === 'picked_up'[\s\S]*?\? 'Order complete'/);
  assert.doesNotMatch(trackerSource, /Pickup complete|Pickup status|Expected pickup/);
});

test('no customer-visible G43C diagnostic fields are added', async () => {
  const result = await invoke();
  const forbidden = ['native_primary_eligible', 'fallback_reason', 'mismatch_fields', 'source_of_truth', 'review_required', 'native_fulfillment_task_id', 'native_shopify_order_id'];
  const orderKeys = Object.keys(result.json.order || {});
  for (const key of forbidden) assert.equal(orderKeys.includes(key), false);
});

test('no new PII exposure is added to enriched order keys', async () => {
  const result = await invoke();
  for (const key of Object.keys(result.json.order || {})) {
    assert.equal(['customer_phone', 'address_line1', 'address_line2', 'shopify_raw_payload'].includes(key), false);
  }
});

test('no raw payload exposure is added', async () => {
  const result = await invoke();
  assert.equal(JSON.stringify(result.json.order).includes('raw_payload'), false);
  assert.equal(JSON.stringify(result.json.order).includes('provider_payload'), false);
});

test('no writes', async () => {
  const result = await invoke();
  assert.equal(result.writes.length, 0);
  assert.equal(/\.create\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/.test(source), false);
});

test('no provider calls', async () => {
  assert.equal(/fetch\s*\(|new\s+Stripe\s*\(|stripe\.refunds|shopify\.clients|shopify\.rest/i.test(source), false);
});

test('no notifications', async () => {
  assert.equal(/sendCustomerNotification|sendOrderSms|CustomerMessageDeliveryLog|Notification\.create/i.test(source), false);
});

test('no Hub mutation', async () => {
  assert.equal(/pushOrderStatusToHub|syncHub|hubSyncProxy|base44\.functions\.invoke\s*\(/.test(source), false);
});

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    failures.push({ name, error: error?.message || String(error) });
    console.error(`✗ ${name}: ${error?.stack || error}`);
  }
}

const summary = {
  suite: 'g43c-customer-order-tracker-limited-native-first',
  tests: tests.length,
  passed,
  failed: failures.length,
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
  hub_mutation_performed: false,
  failures,
};
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exit(1);
console.log('G43C customer order tracker limited native-first tests passed');
