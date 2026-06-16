#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/entry.ts');
const CHICAGO_TZ = 'America/Chicago';

function todayChicagoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const DATE = todayChicagoDate();
const TOMORROW = addDays(DATE, 1);
const PRIOR_DATE = addDays(DATE, -1);

function loadHandler({ env = {}, hubData = hubResponse(), hubStatus = 200, fetchError = null } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');

  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
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
    order_number: overrides.order_number || 'NV-G39N-1',
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
    order_number: overrides.order_number || 'NV-G39N-1',
    delivery_date: overrides.delivery_date || DATE,
    scheduled_date: overrides.scheduled_date || overrides.delivery_date || DATE,
    assigned_delivery_date: overrides.assigned_delivery_date || overrides.delivery_date || DATE,
    delivered_at: overrides.delivered_at || `${DATE}T18:00:00.000Z`,
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
  const req = {
    method: 'POST',
    __base44: base44,
    json: async () => ({ preset: 'custom', date_from: DATE, date_to: DATE, ...body }),
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
  assert.equal(data.dashboard_source_mode, 'current_behavior_with_diagnostics');
  assert.equal(data.writes_performed, false);
  assert.equal(data.provider_call_impact, false);
  assert.equal(data.notifications_sent, false);
  assert.equal(data.hub_mutation_performed, false);
  assert.equal(data.customer_facing_behavior_changed, false);
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('matching native/Hub aggregate returns no mismatch', async () => {
  const { data } = await invoke();
  const total = diagnostic(data, 'orders.total');
  assert.equal(total.displayed_value, 1);
  assert.equal(total.native_value, 1);
  assert.equal(total.hub_value, 1);
  assert.equal(total.comparison_available, true);
  assert.equal(total.mismatch_detected, false);
});

test('native lower than Hub returns native_count_lower_than_hub', async () => {
  const { data } = await invoke({ hubData: hubResponse({ summary: fullSummary({ orders: { total: 2 } }) }) });
  const total = diagnostic(data, 'orders.total');
  assert.equal(total.displayed_value, 2);
  assert.equal(total.mismatch_detected, true);
  assert.equal(total.mismatch_category, 'native_count_lower_than_hub');
  assert.equal(data.aggregate_mismatch_categories.native_count_lower_than_hub >= 1, true);
});

test('Hub lower than native returns hub_count_lower_than_native', async () => {
  const store = makeStore({ Order: [nativeOrder({ order_number: 'NV-G39N-1' }), nativeOrder({ id: 'order_native_2', order_number: 'NV-G39N-2' })] });
  const { data } = await invoke({ store, hubData: hubResponse({ summary: fullSummary({ orders: { total: 1, paid: 2, fulfilled: 2, delivered: 2 }, source_mix: { one_time: 2 } }) }) });
  const total = diagnostic(data, 'orders.total');
  assert.equal(total.native_value, 2);
  assert.equal(total.hub_value, 1);
  assert.equal(total.mismatch_category, 'hub_count_lower_than_native');
});

test('date bucket mismatch classified', async () => {
  const { data } = await invoke({ hubData: hubResponse({ date_from: PRIOR_DATE, date_to: PRIOR_DATE }) });
  const total = diagnostic(data, 'orders.total');
  assert.equal(total.comparison_available, false);
  assert.equal(total.mismatch_detected, true);
  assert.equal(total.mismatch_category, 'date_window_mismatch');
});

test('payment/refund aggregate stays Hub/payment source-of-truth', async () => {
  const store = makeStore({ Order: [nativeOrder({ payment_status: 'pending', payment_captured: false })] });
  const { data } = await invoke({ store, hubData: hubResponse({ summary: fullSummary({ orders: { paid: 1 } }) }) });
  const paid = diagnostic(data, 'orders.paid');
  assert.equal(paid.source_of_truth, 'payment_provider_hub');
  assert.equal(paid.native_first_ready, false);
  assert.equal(paid.mismatch_category, 'payment_refund_semantic_mismatch');
});

test('subscription aggregate stays Hub source-of-truth', async () => {
  const { data } = await invoke({ hubData: hubResponse({ summary: fullSummary({ source_mix: { subscription: 1 } }) }) });
  const subscription = diagnostic(data, 'source_mix.subscription');
  assert.equal(subscription.source_of_truth, 'subscription_hub');
  assert.equal(subscription.native_first_ready, false);
  assert.equal(subscription.mismatch_category, 'subscription_multi_delivery_mismatch');
});

test('delivery aggregate references native-first route summary readiness', async () => {
  const { data } = await invoke();
  const delivery = diagnostic(data, 'delivery.today_stops');
  assert.equal(delivery.source_of_truth, 'mixed');
  assert.equal(delivery.native_first_ready, true);
  assert.match(delivery.recommendation, /g39d/i);
});

test('production planning aggregate references native-first planning readiness', async () => {
  const { data } = await invoke();
  const production = diagnostic(data, 'production.batch_count');
  assert.equal(production.source_of_truth, 'mixed');
  assert.equal(production.native_first_ready, true);
  assert.match(production.recommendation, /g39f/i);
});

test('calendar aggregate references native-first calendar readiness', async () => {
  const { data } = await invoke();
  const calendar = diagnostic(data, 'calendar.events');
  assert.equal(calendar.comparison_available, false);
  assert.equal(calendar.native_value, null);
  assert.equal(calendar.hub_value, null);
  assert.equal(calendar.native_first_ready, false);
  assert.match(calendar.recommendation, /g39h/i);
});

test('admin orders aggregate remains Hub-first/default because G39L had zero eligible rows', async () => {
  const { data } = await invoke();
  const total = diagnostic(data, 'orders.total');
  assert.equal(data.native_first_enabled, false);
  assert.equal(total.source_of_truth, 'hub');
  assert.equal(total.native_first_ready, false);
  assert.match(total.blocker, /g39l_zero_eligible/i);
});

test('inventory/PO aggregate remains held', async () => {
  const { data } = await invoke({ hubData: hubResponse({ summary: fullSummary({ inventory: { critical: 0 } }) }) });
  const critical = diagnostic(data, 'inventory.critical');
  assert.equal(critical.source_of_truth, 'manual_review');
  assert.equal(critical.native_first_ready, false);
  assert.match(critical.blocker, /po_automation_held/i);
});

test('repair/replay aggregate remains manual-review/log governed', async () => {
  const { data } = await invoke({ hubData: hubResponse({ summary: fullSummary({ alerts: { active: 0 } }) }) });
  const alerts = diagnostic(data, 'alerts.active');
  assert.equal(alerts.source_of_truth, 'manual_review');
  assert.equal(alerts.native_first_ready, false);
  assert.match(alerts.blocker, /manual_review|review_log|alert_sources/i);
});

test('not-comparable aggregate does not guess native_value', async () => {
  const { data } = await invoke({ hubEnv: false });
  const calendar = diagnostic(data, 'calendar.events');
  assert.equal(calendar.comparison_available, false);
  assert.equal(calendar.native_value, null);
  assert.equal(calendar.hub_value, null);
});

test('existing response shape remains backward-compatible', async () => {
  const { data } = await invoke();
  assert.equal(data.success, true);
  assert.ok(data.summary.orders);
  assert.ok(data.summary.production);
  assert.ok(data.summary.delivery);
  assert.ok(data.summary.inventory);
  assert.ok(data.summary.alerts);
  assert.ok(data.summary.source_mix);
  assert.equal(typeof data.source, 'string');
  assert.equal(typeof data.generated_at, 'string');
  assert.equal(typeof data.truncated, 'boolean');
});

test('no customer email/phone returned', async () => {
  const { data } = await invoke();
  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes('do-not-return@example.test'), false);
  assert.equal(serialized.includes('+15555550123'), false);
});

test('no raw Hub/provider/payment payload returned', async () => {
  const { data } = await invoke();
  const serialized = JSON.stringify(data);
  assert.equal(serialized.includes('raw_payload'), false);
  assert.equal(serialized.includes('provider_payload'), false);
  assert.equal(serialized.includes('payment_payload'), false);
  assert.equal(serialized.includes('proof_payload'), false);
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

test('customer_facing_behavior_changed:false', async () => {
  const { data } = await invoke();
  assert.equal(data.customer_facing_behavior_changed, false);
});

test('displayed values remain current behavior', async () => {
  const { data } = await invoke({ hubData: hubResponse({ summary: fullSummary({ orders: { total: 9 } }) }) });
  assert.equal(data.source, 'hub_operations_dashboard_summary');
  assert.equal(data.summary.orders.total, 9);
  const total = diagnostic(data, 'orders.total');
  assert.equal(total.displayed_value, 9);
  assert.equal(total.current_display_source, 'hub_primary');
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

console.log(`\nG39N operations dashboard aggregate diagnostics tests passed: ${passed}/${tests.length}`);
