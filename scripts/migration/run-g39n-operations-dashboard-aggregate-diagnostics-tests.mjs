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
    delivery: { today_stops: 1, tomorrow_stops: 0, completed_in_range: 1, unscheduled: 0, ...(overrides.delivery || {}) },
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

function commandLog(overrides = {}) {
  return {
    id: overrides.id || 'command_native_1',
    created_date: overrides.created_date || DATE,
    updated_date: overrides.updated_date || overrides.created_date || DATE,
    status: overrides.status || 'failed',
    command_type: overrides.command_type || 'synthetic_command',
    payload: overrides.payload || {},
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
    CommandLog: overrides.CommandLog ?? [],
  };
}

function makeBase44(rowsByName = makeStore(), functionResponses = null) {
  const writes = [];
  const api = name => ({
    list: async (_sort, limit = 500) => (rowsByName[name] || []).slice(0, limit),
    filter: async () => { throw new Error(`unexpected filter ${name}`); },
    create: async payload => { writes.push({ entity: name, action: 'create', payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ entity: name, action: 'update', id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ entity: name, action: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
    upsert: async payload => { writes.push({ entity: name, action: 'upsert', payload }); throw new Error(`unexpected upsert ${name}`); },
  });

  const asServiceRole = {
    entities: Object.fromEntries(Object.keys(rowsByName).map(name => [name, api(name)])),
  };
  if (functionResponses) {
    asServiceRole.functions = {
      invoke: async name => {
        if (!(name in functionResponses)) throw new Error(`unexpected function invoke ${name}`);
        return functionResponses[name];
      },
    };
  }

  return {
    writes,
    base44: {
      auth: { me: async () => ({ id: 'synthetic_admin', role: 'admin' }) },
      asServiceRole,
    },
  };
}

async function invoke({ store = makeStore(), functionResponses = null, hubData = hubResponse(), hubEnv = true, hubStatus = 200, body = {}, fetchError = null } = {}) {
  const { base44, writes } = makeBase44(store, functionResponses);
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

test('unscheduled paid delivery work is surfaced from native order rows', async () => {
  const store = makeStore({
    Order: [],
    ShopifyOrder: [
      nativeOrder({
        id: 'shopify_unscheduled_delivery',
        order_number: '1009',
        shopify_order_number: '1009',
        created_date: PRIOR_DATE,
        status: 'active',
        fulfillment_status: null,
        delivery_status: 'date_pending',
        fulfillment_type: 'delivery',
        fulfillment_method: 'delivery',
        delivery_date: null,
        assigned_delivery_date: null,
        estimated_delivery_date: null,
        delivery_address: 'redacted fixture address',
      }),
    ],
    FulfillmentTask: [],
  });
  const { data } = await invoke({
    store,
    hubData: hubResponse({ summary: fullSummary({ delivery: { today_stops: 0, tomorrow_stops: 0, completed_in_range: 0, unscheduled: 0 } }) }),
  });
  assert.equal(data.summary.delivery.unscheduled, 1);
  const unscheduled = diagnostic(data, 'delivery.unscheduled');
  assert.equal(unscheduled.native_value, 1);
  assert.equal(unscheduled.displayed_value, 1);
  assert.equal(unscheduled.native_first_ready, true);
});

test('stale undated native delivery rows do not inflate current dashboard unscheduled work', async () => {
  const store = makeStore({
    Order: [],
    ShopifyOrder: [
      nativeOrder({
        id: 'shopify_stale_unscheduled_delivery',
        order_number: '1009',
        shopify_order_number: '1009',
        created_date: addDays(DATE, -45),
        updated_date: addDays(DATE, -45),
        customer_order_date: addDays(DATE, -45),
        status: 'active',
        fulfillment_status: null,
        delivery_status: 'date_pending',
        fulfillment_type: 'delivery',
        fulfillment_method: 'delivery',
        delivery_date: null,
        assigned_delivery_date: null,
        estimated_delivery_date: null,
        delivery_address: 'redacted fixture address',
      }),
    ],
    FulfillmentTask: [],
  });
  const { data } = await invoke({
    store,
    hubData: hubResponse({ summary: fullSummary({ delivery: { today_stops: 0, tomorrow_stops: 0, completed_in_range: 0, unscheduled: 0 } }) }),
  });
  assert.equal(data.summary.delivery.unscheduled, 0);
  const unscheduled = diagnostic(data, 'delivery.unscheduled');
  assert.equal(unscheduled.native_value, 0);
  assert.equal(unscheduled.displayed_value, 0);
});

test('stale unlinked payment review rejects do not inflate current operations health', async () => {
  const store = makeStore({
    OrderReviewQueue: [
      reviewQueueItem({
        id: 'stale_unlinked_pos_reject',
        status: 'pending',
        incident_type: 'payment_not_paid',
        incoming_source: 'shopify_pos',
        existing_order_number: null,
        order_number: null,
        shopify_order_number: null,
        issue_description: 'Historical native order processing rejected order: payment_not_paid',
        recommended_action: 'manual_review_before_operational_processing',
        created_date: addDays(DATE, -45),
        updated_date: addDays(DATE, -45),
        last_seen_at: addDays(DATE, -45),
      }),
    ],
  });
  const { data } = await invoke({
    store,
    hubData: hubResponse({
      summary: fullSummary({
        alerts: { active: 0, critical: 0, warning: 0, info: 0 },
        ops_health: { review_open: 0, command_failed: 0, command_rejected: 0, command_running: 0 },
      }),
    }),
  });
  assert.equal(data.summary.ops_health.review_open, 0);
  assert.equal(data.summary.ops_health_details.review_queue.open, 0);
  assert.equal(data.summary.ops_health_details.review_queue.legacy_launch_suppressed, 1);
  assert.equal(data.summary.alerts.active, 0);
});

test('internal test review queue records do not inflate current operations health', async () => {
  const store = makeStore({
    OrderReviewQueue: [
      reviewQueueItem({
        id: 'internal_g22_review',
        status: 'pending',
        incident_type: 'unknown_order_attempt',
        incoming_source: 'customer_app',
        existing_order_number: 'NV-TEST-G22I-UPDATE-20260604044012',
        issue_description: 'Synthetic test order review row.',
        recommended_action: 'manual_review_before_operational_processing',
        last_seen_at: DATE,
      }),
    ],
  });
  const { data } = await invoke({
    store,
    hubData: hubResponse({
      summary: fullSummary({
        alerts: { active: 0, critical: 0, warning: 0, info: 0 },
        ops_health: { review_open: 0, command_failed: 0, command_rejected: 0, command_running: 0 },
      }),
    }),
  });
  assert.equal(data.summary.ops_health.review_open, 0);
  assert.equal(data.summary.ops_health_details.review_queue.open, 0);
  assert.equal(data.summary.ops_health_details.review_queue.internal_test_suppressed, 1);
  assert.equal(data.summary.alerts.active, 0);
});

test('current failed command logs surface in operations health', async () => {
  const { data } = await invoke({
    store: makeStore({
      CommandLog: [
        commandLog({ id: 'current_failed_command', status: 'failed', created_date: DATE, updated_date: DATE }),
      ],
    }),
    hubData: hubResponse({
      summary: fullSummary({
        ops_health: { review_open: 0, command_failed: 0, command_rejected: 0, command_running: 0 },
      }),
    }),
  });
  assert.equal(data.summary.ops_health.command_failed, 1);
  assert.equal(data.summary.ops_health_details.commands.failed, 1);
  assert.equal(data.summary.ops_health_details.commands.outside_window_suppressed, 0);
});

test('old failed command logs do not inflate current operations health', async () => {
  const { data } = await invoke({
    store: makeStore({
      CommandLog: [
        commandLog({
          id: 'old_failed_command',
          status: 'failed',
          created_date: addDays(DATE, -45),
          updated_date: addDays(DATE, -45),
        }),
      ],
    }),
    hubData: hubResponse({
      summary: fullSummary({
        ops_health: { review_open: 0, command_failed: 0, command_rejected: 0, command_running: 0 },
      }),
    }),
  });
  assert.equal(data.summary.ops_health.command_failed, 0);
  assert.equal(data.summary.ops_health_details.commands.failed, 0);
  assert.equal(data.summary.ops_health_details.commands.outside_window_suppressed, 1);
});

test('production planning aggregate references native-first planning readiness', async () => {
  const { data } = await invoke();
  const production = diagnostic(data, 'production.batch_count');
  assert.equal(production.source_of_truth, 'mixed');
  assert.equal(production.native_first_ready, true);
  assert.match(production.recommendation, /g39f/i);
});

test('native production overlay fills dashboard when Hub omits current native batches', async () => {
  const { data } = await invoke({
    store: makeStore({
      ProductionBatch: [
        productionBatch({ id: 'batch_a', planned_units: 50, actual_units: 0 }),
        productionBatch({ id: 'batch_b', planned_units: 100, actual_units: 0 }),
        productionBatch({ id: 'batch_c', planned_units: 20, actual_units: 0 }),
      ],
    }),
    hubData: hubResponse({ summary: fullSummary({ production: { batch_count: 0, planned_units: 0, produced_units: 0 } }) }),
  });
  assert.equal(data.summary.production.batch_count, 3);
  assert.equal(data.summary.production.planned_units, 170);
  assert.equal(data.native_production_overlay.applied, true);
  assert.ok(data.warnings.includes('native_production_queue_overlay_applied'));
  const production = diagnostic(data, 'production.planned_units');
  assert.equal(production.displayed_value, 170);
  assert.equal(production.hub_value, 0);
  assert.equal(production.native_value, 170);
});

test('native production overlay replaces stale lower Hub production counts', async () => {
  const { data } = await invoke({
    store: makeStore({
      ProductionBatch: [
        productionBatch({ id: 'batch_a', planned_units: 50, actual_units: 0 }),
        productionBatch({ id: 'batch_b', planned_units: 100, actual_units: 0 }),
        productionBatch({ id: 'batch_c', planned_units: 20, actual_units: 0 }),
        productionBatch({ id: 'batch_d', planned_units: 10, actual_units: 0 }),
        productionBatch({ id: 'batch_e', planned_units: 5, actual_units: 0 }),
      ],
    }),
    hubData: hubResponse({ summary: fullSummary({ production: { batch_count: 4, planned_units: 112, produced_units: 0 } }) }),
  });
  assert.equal(data.summary.production.batch_count, 5);
  assert.equal(data.summary.production.planned_units, 185);
  assert.equal(data.native_production_overlay.applied, true);
  assert.equal(data.native_production_overlay.reason, 'native_current_production_more_complete');
  assert.ok(data.warnings.includes('native_production_queue_overlay_applied'));
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

test('food inventory rows are demand-based and do not inflate low-stock operations counts', async () => {
  const store = makeStore({
    InventoryItem: [
      inventoryItem({
        id: 'produce_watermelon',
        ingredient: 'Watermelon',
        category: 'Produce',
        stock: 0,
        reorder_point: 10,
      }),
      inventoryItem({
        id: 'packaging_bottles',
        ingredient: 'Bottle Cases',
        category: 'Packaging',
        stock: 2,
        reorder_point: 10,
      }),
    ],
  });
  const { data } = await invoke({
    store,
    hubData: hubResponse({ summary: fullSummary({ inventory: { low: 0, critical: 1, out_of_stock: 0 } }) }),
  });
  assert.equal(data.summary.inventory.demand_based_food, 1);
  assert.equal(data.summary.inventory.stock_tracked, 1);
  assert.equal(data.summary.inventory.out_of_stock, 0);
  assert.equal(data.summary.inventory.critical, 1);
});

test('merged inventory policy summary keeps operations dashboard aligned with inventory page', async () => {
  const { data } = await invoke({
    hubData: hubResponse({ summary: fullSummary({ inventory: { low: 0, critical: 0, out_of_stock: 23 } }) }),
    functionResponses: {
      getAdminInventoryStatusSummary: {
        data: {
          success: true,
          summary: {
            low_stock_count: 0,
            critical_count: 0,
            out_of_stock_count: 6,
            demand_based_food_count: 20,
            stock_tracked_item_count: 15,
          },
          data_sources: {
            food_inventory_policy: 'food_and_juice_make_to_order',
            food_stock_warnings_suppressed: true,
          },
        },
      },
    },
  });
  assert.equal(data.summary.inventory.low, 0);
  assert.equal(data.summary.inventory.critical, 0);
  assert.equal(data.summary.inventory.out_of_stock, 6);
  assert.equal(data.summary.inventory.demand_based_food, 20);
  assert.equal(data.summary.inventory.stock_tracked, 15);
  assert.equal(data.native_inventory_policy_overlay.merged_inventory.out_of_stock, 6);
  assert.equal(data.native_inventory_policy_overlay.reason, 'merged_food_demand_based_inventory_policy_applied');
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
  assert.equal(total.current_display_source, 'hub_primary_with_native_operations_overlay');
  assert.equal(data.native_inventory_policy_overlay.applied, true);
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
