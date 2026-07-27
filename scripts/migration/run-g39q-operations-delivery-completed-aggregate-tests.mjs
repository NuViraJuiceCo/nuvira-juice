#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/entry.ts');
const DATE = '2026-06-08';
const OUTSIDE_DATE = '2026-06-09';
const FIXED_NOW = '2026-06-16T12:00:00.000Z';

class FixedDate extends Date {
  constructor(...args) {
    if (args.length === 0) {
      super(FIXED_NOW);
      return;
    }
    super(...args);
  }

  static now() {
    return Date.parse(FIXED_NOW);
  }

  static parse(value) {
    return Date.parse(value);
  }

  static UTC(...args) {
    return Date.UTC(...args);
  }
}

function loadHandler({ env = {}, hubData = hubResponse(), hubStatus = 200, fetchError = null } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');

  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Date: FixedDate,
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
    Promise,
    Intl,
    createClientFromRequest: req => req.__base44,
    fetch: async () => {
      if (fetchError) throw fetchError;
      return new Response(JSON.stringify(hubData), { status: hubStatus });
    },
    Deno: {
      env: { get: key => env[key] || '' },
      serve: handler => {
        context.globalThis.__handler = handler;
      },
    },
    globalThis: {},
  });

  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__handler;
}

function fullSummary(overrides = {}) {
  return {
    orders: { total: 1, paid: 1, fulfilled: 1, delivered: 1, ...(overrides.orders || {}) },
    production: { batch_count: 1, planned_units: 12, produced_units: 10, ...(overrides.production || {}) },
    delivery: { today_stops: 1, tomorrow_stops: 0, completed_in_range: 1, ...(overrides.delivery || {}) },
    inventory: { low: 0, critical: 1, out_of_stock: 0, ...(overrides.inventory || {}) },
    alerts: { active: 1, critical: 0, warning: 1, info: 0, ...(overrides.alerts || {}) },
    source_mix: { one_time: 1, subscription: 0, pos: 0, other: 0, ...(overrides.source_mix || {}) },
  };
}

function hubResponse(overrides = {}) {
  return {
    success: true,
    source: 'hub_operations_dashboard_summary',
    generated_at: '2026-06-16T12:00:00.000Z',
    date_from: overrides.date_from || DATE,
    date_to: overrides.date_to || DATE,
    summary: overrides.summary || fullSummary(),
    truncated: overrides.truncated === true,
    raw_payload: { should_not_return: true },
    provider_payload: { should_not_return: true },
    payment_payload: { should_not_return: true },
  };
}

function nativeOrder(overrides = {}) {
  return {
    id: overrides.id || 'order_native_1',
    order_number: overrides.order_number || 'NV-G39Q-1',
    created_date: overrides.created_date || DATE,
    payment_status: overrides.payment_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    status: overrides.status || 'delivered',
    fulfillment_status: overrides.fulfillment_status || 'fulfilled',
    delivery_status: overrides.delivery_status || 'delivered',
    source_type: overrides.source_type || 'one_time',
    line_items: overrides.line_items || [{ sku: 'safe-item' }],
    customer_email: 'do-not-return@example.test',
    customer_phone: '+15555550123',
    raw_payload: { should_not_return: true },
    provider_payload: { should_not_return: true },
    payment_payload: { should_not_return: true },
    ...overrides,
  };
}

function productionBatch(overrides = {}) {
  return {
    id: overrides.id || 'batch_native_1',
    production_date: overrides.production_date || DATE,
    planned_units: overrides.planned_units ?? 12,
    actual_units: overrides.actual_units ?? 10,
    raw_payload: { should_not_return: true },
    ...overrides,
  };
}

function fulfillmentTask(overrides = {}) {
  return {
    id: overrides.id || 'task_native_1',
    order_number: overrides.order_number || 'NV-G39Q-1',
    order_id: overrides.order_id || 'order_native_1',
    delivery_date: Object.hasOwn(overrides, 'delivery_date') ? overrides.delivery_date : DATE,
    scheduled_date: Object.hasOwn(overrides, 'scheduled_date') ? overrides.scheduled_date : (Object.hasOwn(overrides, 'delivery_date') ? overrides.delivery_date : DATE),
    assigned_delivery_date: Object.hasOwn(overrides, 'assigned_delivery_date') ? overrides.assigned_delivery_date : (Object.hasOwn(overrides, 'delivery_date') ? overrides.delivery_date : DATE),
    delivered_at: Object.hasOwn(overrides, 'delivered_at') ? overrides.delivered_at : `${DATE}T18:00:00.000Z`,
    status: overrides.status || 'delivered',
    delivery_status: overrides.delivery_status || 'delivered',
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    customer_email: 'do-not-return@example.test',
    customer_phone: '+15555550123',
    raw_payload: { should_not_return: true },
    proof_payload: { should_not_return: true },
    ...overrides,
  };
}

function inventoryItem(overrides = {}) {
  return {
    id: overrides.id || 'inventory_native_1',
    ingredient: overrides.ingredient || 'Synthetic ingredient',
    stock: overrides.stock ?? 4,
    reorder_point: overrides.reorder_point ?? 10,
    raw_payload: { should_not_return: true },
    ...overrides,
  };
}

function reviewQueueItem(overrides = {}) {
  return {
    id: overrides.id || 'review_native_1',
    created_date: overrides.created_date || DATE,
    status: overrides.status || 'open',
    incident_type: overrides.incident_type || 'needs_review',
    raw_payload: { should_not_return: true },
    ...overrides,
  };
}

function makeStore(overrides = {}) {
  return {
    Order: overrides.Order ?? [nativeOrder()],
    ShopifyOrder: overrides.ShopifyOrder ?? [],
    ProductionBatch: overrides.ProductionBatch ?? [productionBatch()],
    FulfillmentTask: overrides.FulfillmentTask ?? [fulfillmentTask()],
    InventoryItem: overrides.InventoryItem ?? [inventoryItem()],
    OrderReviewQueue: overrides.OrderReviewQueue ?? [reviewQueueItem()],
    OperationalAlert: overrides.OperationalAlert ?? [],
    ComplianceAlert: overrides.ComplianceAlert ?? [],
  };
}

function makeBase44(rowsByName = makeStore()) {
  const writes = [];
  const api = name => ({
    list: async (_sort, limit = 500) => (rowsByName[name] || []).slice(0, limit),
    filter: async () => { throw new Error(`unexpected filter ${name}`); },
    create: async payload => { writes.push({ entity: name, action: 'create', payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ entity: name, action: 'update', id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ entity: name, action: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
    upsert: async payload => { writes.push({ entity: name, action: 'upsert', payload }); throw new Error(`unexpected upsert ${name}`); },
  });

  return {
    writes,
    base44: {
      auth: { me: async () => ({ id: 'synthetic_admin', role: 'admin' }) },
      asServiceRole: {
        entities: Object.fromEntries(Object.keys(rowsByName).map(name => [name, api(name)])),
      },
    },
  };
}

async function invoke({ store = makeStore(), hubData = hubResponse(), hubEnv = true, hubStatus = 200, body = {}, fetchError = null } = {}) {
  const { base44, writes } = makeBase44(store);
  const handler = loadHandler({
    env: hubEnv ? { HUB_API_URL: 'https://hub.example.test/functions/getOperationsDashboardSummaryForCustomerApp', CUSTOMER_APP_SYNC_SECRET: 'synthetic-secret' } : {},
    hubData,
    hubStatus,
    fetchError,
  });
  const requestBody = body.preset && body.preset !== 'custom'
    ? body
    : { preset: 'custom', date_from: DATE, date_to: DATE, ...body };
  const req = {
    method: 'POST',
    __base44: base44,
    json: async () => requestBody,
  };
  const response = await handler(req);
  const data = await response.json();
  return { response, data, writes };
}

function diagnostic(data, name) {
  return (data.aggregate_diagnostics || []).find(item => item.aggregate_name === name);
}

function assertSafetyMetadata(data) {
  assert.equal(data.operations_dashboard_diagnostics_enabled, true);
  assert.equal(data.native_first_enabled, false);
  assert.equal(data.hub_primary_enabled, true);
  assert.equal(data.hub_fallback_active, true);
  assert.equal(data.writes_performed, false);
  assert.equal(data.provider_call_impact, false);
  assert.equal(data.notifications_sent, false);
  assert.equal(data.hub_mutation_performed, false);
  assert.equal(data.customer_facing_behavior_changed, false);
}

function assertGuardMetadata(data, { passed, finalValue, previousValue, nativeValue, hubValue = previousValue }) {
  assert.equal(data.operations_dashboard_delivery_completed_marker, 'g39q_delivery_completed_in_range_route_date_guard');
  assert.equal(data.delivery_completed_in_range_native_primary_enabled, passed);
  assert.equal(data.delivery_completed_in_range_guard_passed, passed);
  assert.equal(data.delivery_completed_in_range_semantic, 'route_delivery_date_completed_status');
  assert.equal(data.completed_delivery_date_bucket, 'delivery_date_then_scheduled_date_then_assigned_delivery_date');
  assert.equal(data.completed_delivery_native_source, 'native_fulfillment_task_route_date');
  assert.equal(data.completed_delivery_hub_source, 'current_hub_or_dashboard_summary');
  assert.equal(data.delivery_completed_in_range_native_value, nativeValue);
  assert.equal(data.delivery_completed_in_range_previous_display_value, previousValue);
  assert.equal(data.delivery_completed_in_range_hub_value, hubValue);
  assert.equal(data.summary.delivery.completed_in_range, finalValue);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('last-30-days nonzero native/current/Hub match permits native display', async () => {
  const { data } = await invoke({ body: { preset: 'last_30_days' } });
  assertGuardMetadata(data, { passed: true, finalValue: 1, previousValue: 1, nativeValue: 1 });
  assert.equal(diagnostic(data, 'delivery.completed_in_range').recommendation, 'native_route_date_semantic_applied');
});

test('single-day native route-date completed row with current/Hub zero uses native when semantic guard passes', async () => {
  const { data } = await invoke({ hubData: hubResponse({ summary: fullSummary({ delivery: { completed_in_range: 0 } }) }) });
  assertGuardMetadata(data, { passed: true, finalValue: 1, previousValue: 0, nativeValue: 1, hubValue: 0 });
  const completed = diagnostic(data, 'delivery.completed_in_range');
  assert.equal(completed.mismatch_detected, true);
  assert.equal(completed.mismatch_category, 'delivered_completed_semantic_mismatch');
  assert.equal(completed.source_of_truth, 'native_route_date');
  assert.equal(completed.review_required, false);
  assert.equal(completed.fallback_required, false);
});

test('single-day Hub/current completed row with no native route-date completed row uses native zero when guard passes', async () => {
  const store = makeStore({ FulfillmentTask: [fulfillmentTask({ status: 'bottled_packed', delivery_status: 'pending', delivered_at: null })] });
  const { data } = await invoke({ store, hubData: hubResponse({ summary: fullSummary({ delivery: { completed_in_range: 1 } }) }) });
  assertGuardMetadata(data, { passed: true, finalValue: 0, previousValue: 1, nativeValue: 0, hubValue: 1 });
  assert.equal(data.delivery_completed_in_range_mismatch_guard, true);
});

test('delivered_at inside range but delivery_date outside range does not count under route-date semantic', async () => {
  const store = makeStore({ FulfillmentTask: [fulfillmentTask({ delivery_date: OUTSIDE_DATE, scheduled_date: OUTSIDE_DATE, assigned_delivery_date: OUTSIDE_DATE, delivered_at: `${DATE}T18:00:00.000Z` })] });
  const { data } = await invoke({ store, hubData: hubResponse({ summary: fullSummary({ delivery: { completed_in_range: 1 } }) }) });
  assertGuardMetadata(data, { passed: true, finalValue: 0, previousValue: 1, nativeValue: 0, hubValue: 1 });
});

test('delivery_date inside range and delivered status counts', async () => {
  const { data } = await invoke({ store: makeStore({ FulfillmentTask: [fulfillmentTask({ delivery_date: DATE, delivered_at: null })] }) });
  assertGuardMetadata(data, { passed: true, finalValue: 1, previousValue: 1, nativeValue: 1 });
});

test('scheduled_date fallback counts when delivery_date missing', async () => {
  const store = makeStore({ FulfillmentTask: [fulfillmentTask({ delivery_date: null, scheduled_date: DATE, assigned_delivery_date: OUTSIDE_DATE, delivered_at: null })] });
  const { data } = await invoke({ store });
  assertGuardMetadata(data, { passed: true, finalValue: 1, previousValue: 1, nativeValue: 1 });
});

test('assigned_delivery_date fallback counts when delivery_date and scheduled_date missing', async () => {
  const store = makeStore({ FulfillmentTask: [fulfillmentTask({ delivery_date: null, scheduled_date: null, assigned_delivery_date: DATE, delivered_at: null })] });
  const { data } = await invoke({ store });
  assertGuardMetadata(data, { passed: true, finalValue: 1, previousValue: 1, nativeValue: 1 });
});

test('subscription/multi-delivery row causes guard fail and current display fallback', async () => {
  const store = makeStore({ FulfillmentTask: [fulfillmentTask({ source_type: 'subscription' })] });
  const { data } = await invoke({ store, hubData: hubResponse({ summary: fullSummary({ delivery: { completed_in_range: 0 } }) }) });
  assertGuardMetadata(data, { passed: false, finalValue: 0, previousValue: 0, nativeValue: 1, hubValue: 0 });
  assert.match(data.delivery_completed_in_range_guard_reason, /subscription_multi_delivery/);
});

test('repair/replay ambiguous row causes guard fail and current display fallback', async () => {
  const store = makeStore({ FulfillmentTask: [fulfillmentTask({ repair_context: true })] });
  const { data } = await invoke({ store, hubData: hubResponse({ summary: fullSummary({ delivery: { completed_in_range: 0 } }) }) });
  assertGuardMetadata(data, { passed: false, finalValue: 0, previousValue: 0, nativeValue: 1, hubValue: 0 });
  assert.match(data.delivery_completed_in_range_guard_reason, /repair_replay/);
});

test('provider call need causes guard fail and current display fallback', async () => {
  const store = makeStore({ FulfillmentTask: [fulfillmentTask({ provider_call_required: true })] });
  const { data } = await invoke({ store, hubData: hubResponse({ summary: fullSummary({ delivery: { completed_in_range: 0 } }) }) });
  assertGuardMetadata(data, { passed: false, finalValue: 0, previousValue: 0, nativeValue: 1, hubValue: 0 });
  assert.match(data.delivery_completed_in_range_guard_reason, /provider_call_required/);
});

test('aggregate other than delivery.completed_in_range remains unchanged', async () => {
  const { data } = await invoke({ hubData: hubResponse({ summary: fullSummary({ orders: { total: 9 }, delivery: { completed_in_range: 0 } }) }) });
  assert.equal(data.summary.orders.total, 9);
  assert.equal(diagnostic(data, 'orders.total').displayed_value, 9);
});

test('inventory/PO/refund/subscription/repair aggregates remain unchanged', async () => {
  const { data } = await invoke({ hubData: hubResponse({ summary: fullSummary({ inventory: { out_of_stock: 7 }, source_mix: { subscription: 3 }, alerts: { active: 4 } }) }) });
  assert.equal(data.summary.inventory.out_of_stock, 7);
  assert.equal(data.summary.source_mix.subscription, 3);
  assert.equal(data.summary.alerts.active, 4);
  assert.equal(diagnostic(data, 'inventory.out_of_stock').source_of_truth, 'manual_review');
  assert.equal(diagnostic(data, 'source_mix.subscription').source_of_truth, 'subscription_hub');
  assert.equal(diagnostic(data, 'alerts.active').source_of_truth, 'manual_review');
});

test('G39N diagnostics metadata remains present', async () => {
  const { data } = await invoke();
  assertSafetyMetadata(data);
  assert.equal(data.operations_dashboard_diagnostics_marker, 'g39n_operations_dashboard_aggregate_diagnostics');
  assert.ok(Array.isArray(data.aggregate_diagnostics));
});

test('Hub fallback remains active', async () => {
  const { data } = await invoke();
  assert.equal(data.hub_fallback_active, true);
  assert.equal(data.hub_primary_enabled, true);
});

test('writes_performed:false', async () => {
  const { data } = await invoke();
  assert.equal(data.writes_performed, false);
});

test('provider_call_impact:false', async () => {
  const { data } = await invoke();
  assert.equal(data.provider_call_impact, false);
});

test('notifications_sent:false', async () => {
  const { data } = await invoke();
  assert.equal(data.notifications_sent, false);
});

test('hub_mutation_performed:false', async () => {
  const { data } = await invoke();
  assert.equal(data.hub_mutation_performed, false);
});

test('no logs/queues created', async () => {
  const { writes } = await invoke();
  assert.deepEqual(writes, []);
});

test('response shape backward-compatible and no unsafe payloads returned', async () => {
  const { data } = await invoke();
  assert.equal(data.success, true);
  assert.ok(data.summary.orders);
  assert.ok(data.summary.production);
  assert.ok(data.summary.delivery);
  assert.ok(data.summary.inventory);
  assert.ok(data.summary.alerts);
  assert.ok(data.summary.source_mix);
  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes('do-not-return@example.test'), false);
  assert.equal(serialized.includes('+15555550123'), false);
  assert.equal(serialized.includes('raw_payload'), false);
  assert.equal(serialized.includes('provider_payload'), false);
  assert.equal(serialized.includes('payment_payload'), false);
  assert.equal(serialized.includes('proof_payload'), false);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`\nG39Q operations delivery completed aggregate tests passed: ${passed}/${tests.length}`);
