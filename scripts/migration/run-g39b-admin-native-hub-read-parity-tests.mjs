#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');

function loadFunctions() {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { isG39BPreviewRequest, g39bUnsupportedBodyKey, buildG39BPreview, g39bCompareRows };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: () => '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__exports;
}

const LINE_ITEMS = [
  { title: 'Pineapple Juice', quantity: 1 },
  { title: 'RE-NU', quantity: 1 },
  { title: 'Watermelon Juice', quantity: 1 },
];

function order(overrides = {}) {
  return {
    id: overrides.id || `order_${overrides.order_number || 'fixture'}`,
    order_number: overrides.order_number || 'NV-MATCH',
    status: overrides.status || 'scheduled_for_juicing',
    payment_status: overrides.payment_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    production_status: overrides.production_status || 'awaiting_production',
    delivery_status: overrides.delivery_status || 'pending',
    delivery_date: overrides.delivery_date || '2026-06-20',
    line_items: overrides.line_items || LINE_ITEMS,
    total_price: overrides.total_price ?? 42,
    created_date: overrides.created_date || '2026-06-15T12:00:00Z',
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  return {
    id: overrides.id || `shopify_${overrides.shopify_order_number || overrides.order_number || 'fixture'}`,
    shopify_order_number: overrides.shopify_order_number || overrides.order_number || 'NV-MATCH',
    base44_order_id: overrides.base44_order_id || `order_${overrides.shopify_order_number || overrides.order_number || 'fixture'}`,
    payment_status: overrides.payment_status || 'paid',
    fulfillment_status: overrides.fulfillment_status || 'pending',
    production_status: overrides.production_status || 'awaiting_production',
    fulfillment_method: overrides.fulfillment_method || 'delivery',
    line_items: overrides.line_items || LINE_ITEMS,
    total_price: overrides.total_price ?? 42,
    created_date: overrides.created_date || '2026-06-15T12:01:00Z',
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: overrides.id || `task_${overrides.order_number || 'fixture'}`,
    order_number: overrides.order_number || 'NV-MATCH',
    base44_order_id: overrides.base44_order_id || `order_${overrides.order_number || 'fixture'}`,
    status: overrides.status || 'pending',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: overrides.production_status || 'awaiting_production',
    assigned_delivery_date: overrides.assigned_delivery_date || '2026-06-20',
    created_date: overrides.created_date || '2026-06-15T12:02:00Z',
    ...overrides,
  };
}

function makeBase44({
  orders = [], nativeOrders = [], tasks = [], batches = [], syncLogs = [], parityLogs = [], reviewRows = [],
  alerts = [], complianceAlerts = [], recipes = [], inventoryItems = [], yields = [], events = [],
} = {}) {
  const writes = [];
  const rowsByName = {
    Order: orders,
    ShopifyOrder: nativeOrders,
    FulfillmentTask: tasks,
    ProductionBatch: batches,
    OrderSyncLog: syncLogs,
    SafeSyncParityLog: parityLogs,
    OrderReviewQueue: reviewRows,
    OperationalAlert: alerts,
    ComplianceAlert: complianceAlerts,
    Recipe: recipes,
    InventoryItem: inventoryItems,
    IngredientYield: yields,
    Event: events,
    SanitationLog: [],
    TemperatureLog: [],
    DailyChecklist: [],
    CorrectiveActionLog: [],
    BatchComplianceLog: [],
  };
  const api = name => ({
    list: async (_sort, limit = 100) => (rowsByName[name] || []).slice(0, limit),
    filter: async filter => (rowsByName[name] || []).filter(row => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value)),
    create: async payload => { writes.push({ entity: name, action: 'create', payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ entity: name, action: 'update', id, payload }); throw new Error(`unexpected update ${name}`); },
  });
  return {
    writes,
    base44: { asServiceRole: { entities: Object.fromEntries(Object.keys(rowsByName).map(name => [name, api(name)])) } },
  };
}

function cleanFixture() {
  const orders = [
    order({
      id: 'order_match', order_number: 'NV-MATCH', hub_order_id: 'hub_match', hub_status: 'scheduled_for_juicing', hub_delivery_status: 'pending', hub_production_status: 'awaiting_production', hub_delivery_date: '2026-06-20',
    }),
    order({
      id: 'order_native_only', order_number: 'NV-NATIVE', delivery_date: '2026-06-21',
    }),
    order({
      id: 'order_mismatch', order_number: 'NV-MISMATCH', hub_order_id: 'hub_mismatch', status: 'scheduled_for_juicing', hub_status: 'packed', delivery_date: '2026-06-22', hub_delivery_date: '2026-06-22',
    }),
    order({
      id: 'order_stale', order_number: 'NV-STALE', hub_order_id: 'hub_stale', delivery_date: '2026-06-20', hub_delivery_date: '2026-06-19',
    }),
    order({
      id: 'order_prod', order_number: 'NV-PROD', production_date: '2026-06-20', delivery_date: '2026-06-21',
    }),
  ];
  const nativeOrders = [
    nativeOrder({ id: 'shopify_match', shopify_order_number: 'NV-MATCH', base44_order_id: 'order_match' }),
    nativeOrder({ id: 'shopify_native', shopify_order_number: 'NV-NATIVE', base44_order_id: 'order_native_only' }),
    nativeOrder({ id: 'shopify_mismatch', shopify_order_number: 'NV-MISMATCH', base44_order_id: 'order_mismatch' }),
    nativeOrder({ id: 'shopify_stale', shopify_order_number: 'NV-STALE', base44_order_id: 'order_stale' }),
    nativeOrder({ id: 'shopify_prod', shopify_order_number: 'NV-PROD', base44_order_id: 'order_prod' }),
  ];
  const tasks = [
    task({ id: 'task_match', order_number: 'NV-MATCH', base44_order_id: 'order_match' }),
    task({ id: 'task_stale', order_number: 'NV-STALE', base44_order_id: 'order_stale', hub_task_id: 'hub_task_stale', assigned_delivery_date: '2026-06-20', hub_delivery_date: '2026-06-19' }),
  ];
  const syncLogs = [
    { id: 'sync_hub_only', order_number: 'NV-HUBONLY', hub_order_id: 'hub_only', source: 'hub_sync', status: 'scheduled_for_juicing', delivery_date: '2026-06-23', created_date: '2026-06-15T12:03:00Z' },
  ];
  return { orders, nativeOrders, tasks, syncLogs };
}

async function preview(store, body = {}) {
  const exports = loadFunctions();
  const { base44, writes } = makeBase44(store);
  const result = await exports.buildG39BPreview(base44, {
    preview_mode: 'ADMIN_NATIVE_FIRST_HUB_READ_PARITY',
    surface: 'all',
    max_rows: 10,
    request_id: 'g39b_fixture_request',
    ...body,
  });
  return { result, writes, exports };
}

const results = [];

{
  const exports = loadFunctions();
  assert.equal(exports.isG39BPreviewRequest({ preview_mode: 'ADMIN_NATIVE_FIRST_HUB_READ_PARITY' }), true);
  assert.equal(exports.g39bUnsupportedBodyKey({ preview_mode: 'ADMIN_NATIVE_FIRST_HUB_READ_PARITY', raw_payload: {} }), 'raw_payload');
  results.push('mode_detects_and_rejects_unsupported_keys');
}

{
  const { result, writes } = await preview(cleanFixture(), { surface: 'admin_orders' });
  assert.equal(result.success, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.writes_performed, false);
  assert.equal(result.provider_call_impact, false);
  assert.equal(result.pii_returned, false);
  assert.equal(result.notifications_sent, false);
  assert.equal(result.hub_mutation_performed, false);
  assert.equal(writes.length, 0);

  const admin = result.surface_results.find(item => item.surface === 'admin_orders');
  assert.ok(admin.rows.some(row => row.order_number === 'NV-MATCH' && row.classification === 'native_hub_match'));
  assert.ok(admin.rows.some(row => row.order_number === 'NV-HUBONLY' && row.classification === 'native_missing_hub_available'));
  assert.ok(admin.rows.some(row => row.order_number === 'NV-NATIVE' && row.classification === 'native_present_hub_missing'));
  assert.ok(admin.rows.some(row => row.order_number === 'NV-MISMATCH' && row.classification === 'native_hub_mismatch'));
  assert.ok(['ready_with_fallback_reporting', 'preview_only_more_fields_needed'].includes(admin.cutover_readiness));
  results.push('native_and_hub_order_rows_match');
  results.push('native_missing_hub_available_classified');
  results.push('native_present_hub_missing_classified');
  results.push('status_mismatch_classified');
  results.push('admin_orders_surface_ready_with_fallback_or_more_fields');
  results.push('provider_call_impact_false');
  results.push('pii_returned_false');
  results.push('writes_performed_false');
  results.push('no_logs_or_queues_created');
}

{
  const { result } = await preview(cleanFixture(), { surface: 'delivery_route_summary' });
  const delivery = result.surface_results.find(item => item.surface === 'delivery_route_summary');
  assert.ok(delivery.rows.some(row => row.order_number === 'NV-STALE' && row.classification === 'stale_hub_fallback_detected'));
  assert.ok(['ready_with_fallback_reporting', 'preview_only_more_fields_needed'].includes(delivery.cutover_readiness));
  results.push('stale_hub_fallback_delivery_row_classified');
  results.push('delivery_route_surface_requires_fallback_reporting');
}

{
  const { result } = await preview(cleanFixture(), { surface: 'production_planning' });
  const production = result.surface_results.find(item => item.surface === 'production_planning');
  const prodRow = production.rows.find(row => row.order_number === 'NV-PROD');
  assert.ok(prodRow);
  assert.equal(prodRow.comparable_fields.native.native_production_batch_count, 0);
  assert.ok(['native_present_hub_missing', 'native_hub_match', 'native_hub_mismatch'].includes(prodRow.classification));
  results.push('production_planning_missing_native_batch_classified');
}

{
  const { result, writes } = await preview(cleanFixture(), { surface: 'customer_orders' });
  assert.equal(result.success, false);
  assert.equal(result.error_code, 'customer_facing_surface_not_in_scope');
  assert.equal(result.cutover_readiness, 'unsafe_customer_facing');
  assert.ok(result.classifications.includes('customer_facing_hold'));
  assert.equal(result.writes_performed, false);
  assert.equal(writes.length, 0);
  results.push('customer_facing_surface_is_held');
}

console.log(JSON.stringify({
  suite: 'g39b_admin_native_hub_read_parity',
  total_test_cases: results.length,
  passed: results.length,
  failed: 0,
  results,
}, null, 2));
