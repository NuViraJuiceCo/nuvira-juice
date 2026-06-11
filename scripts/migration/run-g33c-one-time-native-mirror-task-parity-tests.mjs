#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');

function loadHarness() {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { buildG33CPreview, isG33CPreviewRequest, buildG33CMirror1Preview, isG33CMirror1PreviewRequest, g33cMirror1UnsupportedBodyKey, G33C_MIRROR1_PREVIEW_MODE, G33C_READ_ONLY_SAFETY };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: () => '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, source };
}

function makeOrder(overrides = {}) {
  return {
    id: 'order_nv_mp5',
    order_number: 'NV-MP5SOQLJ',
    status: 'bottled_packed',
    payment_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    assigned_delivery_date: '2026-05-15',
    production_date: '2026-05-14',
    requested_time_window: 'AM',
    address_line1: 'present',
    address_city: 'present',
    address_state: 'ON',
    address_postal_code: 'A1A1A1',
    items: [
      { name: 'Green Juice', quantity: 1, price: 10 },
      { name: 'Orange Juice', quantity: 1, price: 10 },
      { name: 'Ginger Shot', quantity: 1, price: 5 },
    ],
    total_price: 25,
    status_history: [{ status: 'paid' }, { status: 'bottled_packed' }],
    ...overrides,
  };
}

function makeStore({ orders = [makeOrder()], nativeOrders = [], tasks = [], orderSyncLogs = [], reviewRows = [], commandLogs = [], parityLogs = [] } = {}) {
  const store = { orders, nativeOrders, tasks, orderSyncLogs, reviewRows, commandLogs, parityLogs, writes: [] };
  const rowsFor = name => ({
    Order: store.orders,
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.tasks,
    OrderSyncLog: store.orderSyncLogs,
    OrderReviewQueue: store.reviewRows,
    CommandLog: store.commandLogs,
    SafeSyncParityLog: store.parityLogs,
  }[name] || []);
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    list: async () => rowsFor(name),
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    get: async id => rowsFor(name).find(row => row?.id === id) || null,
    create: async payload => { store.writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { store.writes.push({ op: 'update', name, id, patch }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { store.writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    store,
    base44: {
      asServiceRole: {
        entities: {
          Order: api('Order'),
          ShopifyOrder: api('ShopifyOrder'),
          FulfillmentTask: api('FulfillmentTask'),
          OrderSyncLog: api('OrderSyncLog'),
          OrderReviewQueue: api('OrderReviewQueue'),
          CommandLog: api('CommandLog'),
          SafeSyncParityLog: api('SafeSyncParityLog'),
        },
      },
    },
  };
}

async function previewFor(scenario, body = {}) {
  return fns.buildG33CMirror1Preview(scenario.base44, {
    preview_mode: 'ONE_TIME_NATIVE_MIRROR_TASK_PARITY',
    order_number: 'NV-MP5SOQLJ',
    customer_app_order_id: 'order_nv_mp5',
    request_id: 'g33c_mirror1_fixture',
    ...body,
  });
}

const { exports: fns, source } = loadHarness();
const results = [];

assert.equal(fns.G33C_MIRROR1_PREVIEW_MODE, 'ONE_TIME_NATIVE_MIRROR_TASK_PARITY');
assert.equal(fns.isG33CMirror1PreviewRequest({ preview_mode: 'ONE_TIME_NATIVE_MIRROR_TASK_PARITY' }), true);
assert.equal(fns.isG33CPreviewRequest({ preview_mode: 'ONE_TIME_NATIVE_MIRROR_TASK_PARITY', mode: 'EXACT_ORDER_PREVIEW' }), false);
assert.equal(fns.isG33CPreviewRequest({ mode: 'EXACT_ORDER_PREVIEW' }), true);
assert.equal(fns.g33cMirror1UnsupportedBodyKey({ preview_mode: 'ONE_TIME_NATIVE_MIRROR_TASK_PARITY', send_notification: true }), 'send_notification');
assert.equal(fns.G33C_READ_ONLY_SAFETY.writes_performed, false);

let scenario = makeStore({ orderSyncLogs: [{ id: 'sync1', order_number: 'NV-MP5SOQLJ', status: 'deduped' }] });
let preview = await previewFor(scenario);
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.native_shopify_order_present, false);
assert.equal(preview.native_fulfillment_task_present, false);
assert.equal(preview.native_shopify_order_mirror_preview.would_create_native_shopify_order, true);
assert.equal(preview.eligible_for_native_mirror_command_planning, true);
assert.equal(preview.native_fulfillment_task_preview.would_create_native_fulfillment_task, false);
assert.equal(preview.native_fulfillment_task_preview.task_create_depends_on_native_shopify_order, true);
assert.ok(preview.native_fulfillment_task_preview.blockers.includes('task_create_depends_on_native_shopify_order'));
assert.equal(preview.missing_native_reason_classification, 'native_ops_duplicate_hub_dedupe_only');
assert.equal(preview.source_audit.order_sync_log_status.latest_status, 'deduped');
assert.equal(preview.native_shopify_order_mirror_preview.schema_safe_field_packet.base44_order_id, 'order_nv_mp5');
assert.equal(preview.native_shopify_order_mirror_preview.schema_safe_field_packet.line_items.length, 3);
assert.equal(preview.native_fulfillment_task_preview.schema_safe_field_packet.line_item_count, 3);
assert.equal(preview.provider_call_impact, false);
assert.equal(preview.notification_impact.notification_held, true);
assert.equal(scenario.store.writes.length, 0);
results.push('paid_captured_one_time_missing_native_records_returns_mirror_and_task_dependency_preview');
results.push('hub_deduped_context_preserved');
results.push('no_provider_calls_notifications_held_no_writes');

scenario = makeStore({ reviewRows: [{ id: 'review1', order_number: 'NV-MP5SOQLJ', status: 'open' }] });
preview = await previewFor(scenario);
assert.ok(preview.blockers.includes('order_review_queue_blocker'));
assert.equal(preview.native_shopify_order_mirror_preview.would_create_native_shopify_order, false);
results.push('order_review_queue_blocker_blocks');

scenario = makeStore({ orders: [makeOrder({ items: [] })] });
preview = await previewFor(scenario);
assert.ok(preview.blockers.includes('missing_line_items'));
results.push('missing_line_items_blocks');

scenario = makeStore({ orders: [makeOrder({ address_line1: '', address_city: '', address_state: '', address_postal_code: '' })] });
preview = await previewFor(scenario);
assert.ok(preview.blockers.includes('missing_delivery_address_context'));
assert.equal(preview.native_fulfillment_task_preview.address_complete, false);
results.push('missing_delivery_address_context_blocks_task_preview');

scenario = makeStore({ orders: [makeOrder({ status: 'delivered' })] });
preview = await previewFor(scenario);
assert.equal(preview.recommended_pilot_type, 'historical_native_mirror_only');
assert.equal(preview.production_delivery_lifecycle_safety.recommended_scope, 'historical_admin_mirror_only');
results.push('already_delivered_classifies_historical_admin_mirror_only');

scenario = makeStore({ nativeOrders: [{ id: 'native1', base44_order_id: 'order_nv_mp5', shopify_order_number: 'NV-MP5SOQLJ', order_type: 'one_time', fulfillment_method: 'delivery', payment_status: 'paid' }] });
preview = await previewFor(scenario);
assert.equal(preview.native_shopify_order_present, true);
assert.equal(preview.native_shopify_order_mirror_preview.would_create_native_shopify_order, false);
assert.equal(preview.native_fulfillment_task_preview.would_create_native_fulfillment_task, true);
assert.equal(preview.eligible_for_native_task_command_planning, true);
results.push('native_order_present_allows_task_preview_command_planning');

assert.ok(!source.includes('ShopifyOrder.create'));
assert.ok(!source.includes('FulfillmentTask.create'));
assert.ok(!source.includes('Notification.create'));

console.log(JSON.stringify({
  suite: 'g33c-one-time-native-mirror-task-parity',
  passed: results.length,
  failed: 0,
  results,
  writes_performed: false,
  provider_call_impact: false,
  notifications_held: true,
}, null, 2));
