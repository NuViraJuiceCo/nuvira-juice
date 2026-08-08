#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(
  repoRoot,
  'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminDeliveryRouteSummary/entry.ts',
);
const DELIVERY_DATE = '2026-06-20';
const TEST_NOW = '2026-06-18T12:00:00.000Z';

class FixedDate extends Date {
  constructor(...args) {
    super(...(args.length > 0 ? args : [TEST_NOW]));
  }

  static now() {
    return new Date(TEST_NOW).getTime();
  }
}

function loadHandler({ env = {}, hubData = null, hubStatus = 200, fetchError = null } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(
    'export default async function handler(req: Request)',
    'globalThis.__handler = async function handler(req)',
  );

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

function lineItems() {
  return [
    { title: 'Pineapple Juice', quantity: 1 },
    { title: 'RE-NU', quantity: 1 },
    { title: 'Watermelon Juice', quantity: 1 },
  ];
}

function nativeOrder(overrides = {}) {
  const number = overrides.shopify_order_number || overrides.order_number || 'NV-NATIVE';
  return {
    id: overrides.id || `shopify_${number}`,
    base44_order_id: overrides.base44_order_id || `order_${number}`,
    shopify_order_number: number,
    customer_name: overrides.customer_name || 'Synthetic Admin Route Customer',
    customer_email: 'do-not-return@example.test',
    customer_phone: '+15555550123',
    source_type: 'customer_app_one_time_native_mirror',
    source_channel: 'customer_app',
    fulfillment_method: 'delivery',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    payment_status: 'paid',
    production_status: 'awaiting_production',
    sync_status: overrides.sync_status || 'native_ops_ready',
    tags: overrides.tags || ['native_order_ops'],
    created_from_native_ops: overrides.created_from_native_ops ?? true,
    line_items: lineItems(),
    delivery_address: overrides.delivery_address ?? '100 Native Rd, Chicago, IL',
    delivery_window_label: overrides.delivery_window_label || '9 AM - 11 AM',
    requested_time_window: overrides.requested_time_window || '9 AM - 11 AM',
    assigned_delivery_date: overrides.assigned_delivery_date || DELIVERY_DATE,
    selected_delivery_date: overrides.selected_delivery_date || DELIVERY_DATE,
    requested_delivery_date: overrides.requested_delivery_date || DELIVERY_DATE,
    created_date: '2026-06-16T12:00:00Z',
    raw_payload: { should_not_return: true },
    provider_payload: { should_not_return: true },
    payment_payload: { should_not_return: true },
    ...overrides,
  };
}

function nativeTask(overrides = {}) {
  const number = overrides.order_number || 'NV-NATIVE';
  return {
    id: overrides.id || `task_${number}`,
    order_id: overrides.order_id || `shopify_${number}`,
    order_number: number,
    customer_name: overrides.customer_name || 'Synthetic Admin Route Customer',
    customer_email: 'do-not-return@example.test',
    customer_phone: '+15555550123',
    source_type: 'customer_app_native_task',
    fulfillment_number: 1,
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: 'awaiting_production',
    delivery_date: overrides.delivery_date ?? DELIVERY_DATE,
    scheduled_date: overrides.scheduled_date ?? overrides.delivery_date ?? DELIVERY_DATE,
    assigned_delivery_date: overrides.assigned_delivery_date ?? overrides.delivery_date ?? DELIVERY_DATE,
    delivery_window_label: overrides.delivery_window_label ?? '9 AM - 11 AM',
    delivery_address: overrides.delivery_address ?? '100 Native Rd, Chicago, IL',
    items_summary: overrides.items_summary ?? '1x Pineapple Juice, 1x RE-NU, 1x Watermelon Juice',
    delivery_photo_url: overrides.delivery_photo_url || null,
    delivery_drop_location: overrides.delivery_drop_location || null,
    delivery_notes: overrides.delivery_notes || null,
    raw_payload: { should_not_return: true },
    proof_payload: { should_not_return: true },
    ...overrides,
  };
}

function hubStop(overrides = {}) {
  const number = overrides.order_number || 'NV-HUB';
  return {
    task_id: overrides.task_id || `hub_task_${number}`,
    order_number: number,
    customer_name: overrides.customer_name || 'Synthetic Hub Fallback Customer',
    customer_email: 'do-not-return@example.test',
    customer_phone: '+15555550123',
    fulfillment_number: 1,
    source_type: 'hub',
    assigned_driver: 'Synthetic Driver',
    task_status: overrides.task_status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: 'awaiting_production',
    fulfillment_status: 'pending',
    fulfillment_type: 'delivery',
    fulfillment_method: 'delivery',
    payment_status: 'paid',
    line_item_count: 3,
    delivery_date: overrides.delivery_date ?? DELIVERY_DATE,
    scheduled_date: overrides.scheduled_date ?? overrides.delivery_date ?? DELIVERY_DATE,
    assigned_delivery_date: overrides.assigned_delivery_date ?? overrides.delivery_date ?? DELIVERY_DATE,
    delivery_window_label: overrides.delivery_window_label ?? '10 AM - 12 PM',
    delivery_address: overrides.delivery_address ?? '200 Hub Fallback Ave, Chicago, IL',
    items_summary: overrides.items_summary ?? '1x Pineapple Juice, 1x RE-NU, 1x Watermelon Juice',
    proof_available: overrides.proof_available === true,
    delivery_photo_url: overrides.delivery_photo_url || null,
    delivery_drop_location: overrides.delivery_drop_location || null,
    delivery_notes: overrides.delivery_notes || null,
    raw_payload: { should_not_return: true },
    provider_payload: { should_not_return: true },
    payment_payload: { should_not_return: true },
    proof_payload: { should_not_return: true },
    ...overrides,
  };
}

function emptyHubData(overrides = {}) {
  return {
    success: true,
    delivery_date: DELIVERY_DATE,
    summary: { total_stops: 0, active: 0, completed: 0, unscheduled: 0, bag_returns: null },
    sections: { delivery_stops: [], completed: [] },
    ...overrides,
  };
}

function makeBase44({ tasks = [], orders = [] } = {}) {
  const writes = [];
  const rowsByName = { FulfillmentTask: tasks, ShopifyOrder: orders };
  const api = name => ({
    list: async (_sort, limit = 100) => (rowsByName[name] || []).slice(0, limit),
    filter: async () => { throw new Error(`unexpected filter ${name}`); },
    create: async payload => {
      writes.push({ entity: name, action: 'create', payload });
      throw new Error(`unexpected create ${name}`);
    },
    update: async (id, payload) => {
      writes.push({ entity: name, action: 'update', id, payload });
      throw new Error(`unexpected update ${name}`);
    },
    delete: async id => {
      writes.push({ entity: name, action: 'delete', id });
      throw new Error(`unexpected delete ${name}`);
    },
  });

  return {
    writes,
    base44: {
      auth: { me: async () => ({ id: 'synthetic_admin', role: 'admin' }) },
      asServiceRole: { entities: { FulfillmentTask: api('FulfillmentTask'), ShopifyOrder: api('ShopifyOrder') } },
    },
  };
}

async function invoke({ tasks = [], orders = [], hubData = emptyHubData(), hubEnv = true, body = {}, hubStatus = 200 } = {}) {
  const { base44, writes } = makeBase44({ tasks, orders });
  const handler = loadHandler({
    env: hubEnv ? { HUB_API_URL: 'https://hub.example.test/functions/getDeliveryRouteSummaryForCustomerApp', CUSTOMER_APP_SYNC_SECRET: 'synthetic-secret' } : {},
    hubData,
    hubStatus,
  });
  const req = {
    method: 'POST',
    __base44: base44,
    json: async () => ({ delivery_date: DELIVERY_DATE, limit: 100, ...body }),
  };
  const response = await handler(req);
  const payload = await response.json();
  return { status: response.status, payload, writes };
}

function allRows(payload) {
  return [
    ...(payload.sections?.delivery_stops || []),
    ...(payload.sections?.completed || []),
    ...(payload.sections?.unscheduled_delivery_orders || []),
  ];
}

function assertNoForbiddenPayloads(payload) {
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes('do-not-return@example.test'), false, 'email leaked');
  assert.equal(serialized.includes('+15555550123'), false, 'phone leaked');
  for (const forbidden of ['raw_payload', 'provider_payload', 'payment_payload', 'proof_payload', 'should_not_return']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
  }
}

const results = [];

{
  const { status, payload } = await invoke({
    orders: [nativeOrder({ shopify_order_number: 'NV-NATIVE', id: 'shopify_NV-NATIVE' })],
    tasks: [nativeTask({ order_number: 'NV-NATIVE', order_id: 'shopify_NV-NATIVE' })],
    hubData: emptyHubData(),
  });
  assert.equal(status, 200);
  const row = payload.sections.delivery_stops.find(stop => stop.order_number === 'NV-NATIVE');
  assert.ok(row);
  assert.equal(row.data_source, 'customer_app_native_task');
  assert.equal(row.native_primary, true);
  assert.equal(row.hub_fallback_used, false);
  assert.equal(payload.native_row_count, 1);
  results.push('native_row_present_is_primary');
  results.push('hub_row_absent_native_still_returned');
}

{
  const { payload } = await invoke({
    orders: [],
    tasks: [],
    hubData: emptyHubData({ sections: { delivery_stops: [hubStop({ order_number: 'NV-HUBONLY' })], completed: [] } }),
  });
  const row = payload.sections.delivery_stops.find(stop => stop.order_number === 'NV-HUBONLY');
  assert.ok(row);
  assert.equal(row.data_source, 'hub_fallback');
  assert.equal(row.native_primary, false);
  assert.equal(row.hub_fallback_used, true);
  assert.equal(row.fallback_reason, 'native_route_row_missing');
  assert.equal(payload.hub_fallback_row_count, 1);
  results.push('native_missing_hub_fallback_used');
  results.push('hub_only_active_row_retained');
}

{
  const { payload } = await invoke({
    orders: [nativeOrder({ shopify_order_number: 'NV-INCOMPLETE', id: 'shopify_NV-INCOMPLETE', delivery_address: '', delivery_window_label: '', requested_time_window: '', line_items: [] })],
    tasks: [nativeTask({ order_number: 'NV-INCOMPLETE', order_id: 'shopify_NV-INCOMPLETE', delivery_address: '', items_summary: '', delivery_window_label: '', items: [] })],
    hubData: emptyHubData({ sections: { delivery_stops: [hubStop({ order_number: 'NV-INCOMPLETE', delivery_address: 'Hub Context Address', delivery_window_label: '1 PM - 3 PM', items_summary: '1x RE-NU' })], completed: [] } }),
  });
  const row = payload.sections.delivery_stops.find(stop => stop.order_number === 'NV-INCOMPLETE');
  assert.ok(row);
  assert.equal(row.data_source, 'native_with_hub_fallback_context');
  assert.equal(row.native_primary, true);
  assert.equal(row.hub_fallback_used, true);
  assert.equal(row.fallback_reason, 'native_row_incomplete_for_route_display');
  assert.equal(row.delivery_address, 'Hub Context Address');
  assert.equal(row.delivery_window_label, '1 PM - 3 PM');
  assert.equal(row.items_summary, '1x RE-NU');
  assert.ok(payload.fallback_reasons.includes('native_row_incomplete_for_route_display'));
  results.push('native_incomplete_uses_hub_fallback_context');
}

{
  const { payload } = await invoke({
    orders: [nativeOrder({ shopify_order_number: 'NV-STALE', id: 'shopify_NV-STALE', assigned_delivery_date: '2026-06-21', selected_delivery_date: '2026-06-21', requested_delivery_date: '2026-06-21' })],
    tasks: [nativeTask({ order_number: 'NV-STALE', order_id: 'shopify_NV-STALE', delivery_date: '2026-06-21', scheduled_date: '2026-06-21', assigned_delivery_date: '2026-06-21' })],
    hubData: emptyHubData({ sections: { delivery_stops: [hubStop({ order_number: 'NV-STALE', delivery_date: DELIVERY_DATE })], completed: [] } }),
  });
  assert.equal(allRows(payload).some(stop => stop.order_number === 'NV-STALE'), false);
  assert.equal(payload.stale_hub_fallback_detected, true);
  assert.equal(payload.suppressed_hub_row_count, 1);
  assert.ok(payload.warnings.includes('hub_fallback_stale_date_detected'));
  results.push('native_corrected_date_suppresses_stale_hub_row');
  results.push('g32f_stale_hub_fallback_scenario_covered');
}

{
  const { payload } = await invoke({
    orders: [nativeOrder({ shopify_order_number: 'NV-DUPE', id: 'shopify_NV-DUPE' })],
    tasks: [nativeTask({ order_number: 'NV-DUPE', order_id: 'shopify_NV-DUPE' })],
    hubData: emptyHubData({ sections: { delivery_stops: [hubStop({ order_number: 'NV-DUPE' })], completed: [] } }),
  });
  const rows = allRows(payload).filter(stop => stop.order_number === 'NV-DUPE');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data_source, 'customer_app_native_task');
  assert.equal(rows[0].native_primary, true);
  assert.equal(payload.suppressed_hub_row_count, 1);
  results.push('duplicate_native_hub_same_date_deduped_native_primary');
}

{
  const { payload } = await invoke({
    orders: [nativeOrder({
      shopify_order_number: 'NV-RECENT-PENDING',
      id: 'shopify_NV-RECENT-PENDING',
      assigned_delivery_date: null,
      selected_delivery_date: null,
      requested_delivery_date: null,
      delivery_date: null,
      customer_order_date: '2026-06-18T12:00:00Z',
      created_date: '2026-06-18T12:00:00Z',
      updated_date: '2026-06-18T12:00:00Z',
    })],
    tasks: [],
    hubData: emptyHubData(),
  });
  assert.equal(payload.sections.unscheduled_delivery_orders.some(stop => stop.order_number === 'NV-RECENT-PENDING'), true);
  results.push('recent_date_pending_native_delivery_order_still_surfaces_for_review');
}

{
  const { payload } = await invoke({
    orders: [nativeOrder({
      shopify_order_number: 'NV-STALE-PENDING',
      id: 'shopify_NV-STALE-PENDING',
      assigned_delivery_date: null,
      selected_delivery_date: null,
      requested_delivery_date: null,
      delivery_date: null,
      customer_order_date: '2026-05-01T12:00:00Z',
      created_date: '2026-05-01T12:00:00Z',
      updated_date: '2026-05-01T12:00:00Z',
    })],
    tasks: [],
    hubData: emptyHubData(),
  });
  assert.equal(payload.sections.unscheduled_delivery_orders.some(stop => stop.order_number === 'NV-STALE-PENDING'), false);
  assert.equal(payload.summary.unscheduled, 0);
  results.push('stale_date_pending_native_delivery_order_excluded_from_current_route_review');
}

{
  const staleDeliveryDate = '2026-05-16';
  const { status, payload, writes } = await invoke({
    orders: [nativeOrder({
      shopify_order_number: 'NV-HISTORICAL-TASK',
      id: 'shopify_NV-HISTORICAL-TASK',
      assigned_delivery_date: staleDeliveryDate,
      selected_delivery_date: staleDeliveryDate,
      requested_delivery_date: staleDeliveryDate,
    })],
    tasks: [nativeTask({
      order_number: 'NV-HISTORICAL-TASK',
      order_id: 'shopify_NV-HISTORICAL-TASK',
      status: 'bottled_packed',
      delivery_status: 'pending',
      delivery_date: staleDeliveryDate,
      scheduled_date: staleDeliveryDate,
      assigned_delivery_date: staleDeliveryDate,
    })],
    hubData: emptyHubData({ delivery_date: staleDeliveryDate }),
    body: { delivery_date: staleDeliveryDate },
  });
  assert.equal(status, 200);
  assert.equal(payload.sections.delivery_stops.some(stop => stop.order_number === 'NV-HISTORICAL-TASK'), false);
  assert.equal(payload.summary.active, 0);
  assert.equal(payload.stale_native_delivery_task_detected, true);
  assert.equal(payload.suppressed_native_stale_task_count, 1);
  assert.equal(payload.sections.suppressed_stale_delivery_tasks[0].order_number, 'NV-HISTORICAL-TASK');
  assert.equal(payload.sections.suppressed_stale_delivery_tasks[0].suppression_reason, 'stale_nonterminal_native_fulfillment_task_outside_action_window');
  assert.ok(payload.warnings.includes('stale_native_fulfillment_task_excluded_from_active_route'));
  assert.equal(payload.data_sources.stale_native_delivery_task_suppression_ready, true);
  assert.equal(writes.length, 0);
  results.push('stale_nonterminal_native_fulfillment_task_excluded_from_active_route');
}

{
  const staleDeliveryDate = '2026-05-16';
  const { payload } = await invoke({
    orders: [],
    tasks: [nativeTask({
      order_number: 'NV-INTERNAL-STALE-TASK',
      is_test_task: true,
      test_purpose: 'G53 stale-window visibility regression',
      status: 'pending',
      delivery_status: 'pending',
      delivery_date: staleDeliveryDate,
      scheduled_date: staleDeliveryDate,
      assigned_delivery_date: staleDeliveryDate,
    })],
    hubData: emptyHubData({ delivery_date: staleDeliveryDate }),
    body: { delivery_date: staleDeliveryDate, test_task_mode: 'only' },
  });
  const row = payload.sections.delivery_stops.find(stop => stop.order_number === 'NV-INTERNAL-STALE-TASK');
  assert.ok(row);
  assert.equal(row.is_test_task, true);
  assert.equal(payload.stale_native_delivery_task_detected, false);
  assert.equal(payload.suppressed_native_stale_task_count, 0);
  results.push('internal_test_task_mode_bypasses_stale_delivery_suppression');
}

{
  const { payload } = await invoke({
    orders: [nativeOrder({ shopify_order_number: 'NV-DONE', id: 'shopify_NV-DONE', fulfillment_status: 'pending' })],
    tasks: [nativeTask({
      order_number: 'NV-DONE',
      order_id: 'shopify_NV-DONE',
      status: 'Completed',
      delivery_status: 'delivered',
      delivery_photo_url: 'https://example.test/proof.jpg',
      delivery_drop_location: 'Front Door',
      delivery_notes: 'Left in insulated bag at front door',
    })],
    hubData: emptyHubData({
      sections: {
        delivery_stops: [],
        completed: [hubStop({
          order_number: 'NV-DONE',
          task_status: 'Completed',
          delivery_status: 'delivered',
          fulfillment_status: 'pending',
          delivery_photo_url: 'https://example.test/proof.jpg',
          delivery_drop_location: 'Front Door',
          delivery_notes: 'Left in insulated bag at front door',
        })],
      },
    }),
  });
  const row = payload.sections.completed.find(stop => stop.order_number === 'NV-DONE');
  assert.ok(row);
  assert.equal(row.delivery_status, 'delivered');
  assert.equal(row.fulfillment_status, 'delivered');
  assert.equal(row.proof_available, true);
  assert.equal(row.delivery_notes, 'Left in insulated bag at front door');
  assert.equal(row.data_source, 'customer_app_native_task');
  assert.equal(row.native_primary, true);
  assert.equal(row.hub_fallback_used, false);
  assert.equal(payload.hub_fallback_row_count, 0);
  results.push('native_completed_route_remains_authoritative');
}

{
  const { payload } = await invoke({
    orders: [nativeOrder({ shopify_order_number: 'NV-HUB-COMPLETION', id: 'shopify_NV-HUB-COMPLETION', fulfillment_status: 'pending' })],
    tasks: [nativeTask({
      order_number: 'NV-HUB-COMPLETION',
      order_id: 'shopify_NV-HUB-COMPLETION',
      status: 'pending',
      delivery_status: 'pending',
    })],
    hubData: emptyHubData({
      sections: {
        delivery_stops: [],
        completed: [hubStop({
          order_number: 'NV-HUB-COMPLETION',
          task_status: 'Completed',
          delivery_status: 'delivered',
          fulfillment_status: 'delivered',
          delivery_photo_url: 'https://example.test/proof.jpg',
          delivery_drop_location: 'Front Door',
        })],
      },
    }),
  });
  const row = payload.sections.completed.find(stop => stop.order_number === 'NV-HUB-COMPLETION');
  assert.ok(row);
  assert.equal(row.delivery_status, 'delivered');
  assert.equal(row.data_source, 'native_with_hub_completed_context');
  assert.equal(row.native_primary, true);
  assert.equal(row.hub_fallback_used, true);
  assert.equal(row.fallback_reason, 'hub_completed_state_preferred_for_native_duplicate');
  results.push('hub_completed_context_retained_for_nonterminal_native_task');
}

{
  const { status, payload } = await invoke({ hubData: emptyHubData() });
  assert.equal(status, 200);
  assert.equal(payload.success, true);
  assert.deepEqual(payload.sections.delivery_stops, []);
  assert.deepEqual(payload.sections.completed, []);
  assert.deepEqual(payload.sections.unscheduled_delivery_orders, []);
  assert.equal(payload.summary.total_stops, 0);
  results.push('no_rows_returns_empty_safe_response');
}

{
  const { payload, writes } = await invoke({
    orders: [nativeOrder({ shopify_order_number: 'NV-SHAPE', id: 'shopify_NV-SHAPE' })],
    tasks: [nativeTask({ order_number: 'NV-SHAPE', order_id: 'shopify_NV-SHAPE' })],
    hubData: emptyHubData(),
  });
  assert.equal(payload.success, true);
  assert.ok(payload.summary);
  assert.ok(payload.sections);
  assert.ok(Array.isArray(payload.sections.delivery_stops));
  assert.ok(Array.isArray(payload.sections.completed));
  assert.ok(Array.isArray(payload.sections.unscheduled_delivery_orders));
  assert.ok(payload.data_sources);
  assert.ok(payload.hub_fallback_reconciliation);
  assert.equal(payload.native_first_enabled, true);
  assert.equal(payload.writes_performed, false);
  assert.equal(payload.provider_call_impact, false);
  assert.equal(payload.notifications_sent, false);
  assert.equal(payload.hub_mutation_performed, false);
  assert.equal(writes.length, 0);
  assertNoForbiddenPayloads(payload);
  results.push('existing_response_shape_backward_compatible');
  results.push('no_customer_email_or_phone_returned');
  results.push('no_raw_hub_provider_payment_or_proof_payload_returned');
  results.push('writes_performed_false');
  results.push('provider_call_impact_false');
  results.push('notifications_sent_false');
  results.push('no_logs_or_queues_created');
}

console.log(JSON.stringify({
  suite: 'G39D admin delivery route native-first simulation',
  total_test_cases: results.length,
  passed: results.length,
  failed: 0,
  results,
  live_base44_calls: false,
  live_api_calls: false,
}, null, 2));
