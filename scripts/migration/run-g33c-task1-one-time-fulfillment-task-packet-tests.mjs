#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');

const IDS = {
  orderNumber: 'NV-MP5SOQLJ',
  customerAppOrderId: '6a060df457fc07751f3c7ded',
  nativeShopifyOrderId: '6a2df0026e266e19c68046eb',
  requestId: 'g33c_task1_fixture_request',
};

function loadFunctions() {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { isG33CTask1PreviewRequest, g33cTask1UnsupportedBodyKey, buildG33CTask1Preview };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: () => '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, source };
}

function baseOrder(overrides = {}) {
  return {
    id: IDS.customerAppOrderId,
    order_number: IDS.orderNumber,
    status: 'bottled_packed',
    payment_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    assigned_delivery_date: '2026-05-16',
    production_date: '2026-05-16',
    requested_time_window: '12:00 PM – 3:00 PM',
    address_line1: 'present',
    address_city: 'Frisco',
    address_state: 'TX',
    address_postal_code: '75034',
    line_items: [
      { title: 'Pineapple Juice', quantity: 1, price: 15 },
      { title: 'Watermelon Juice', quantity: 1, price: 12 },
      { title: 'RE-NU', quantity: 1, price: 13 },
    ],
    total_price: 43.99,
    updated_date: '2026-05-16T05:13:43.920000',
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  return {
    id: IDS.nativeShopifyOrderId,
    shopify_order_number: `#${IDS.orderNumber}`,
    base44_order_id: IDS.customerAppOrderId,
    source_channel: 'online',
    source_type: 'customer_app_one_time_native_mirror',
    order_type: 'one_time',
    fulfillment_method: 'delivery',
    payment_status: 'paid',
    financial_status: 'paid',
    fulfillment_status: 'pending',
    production_status: 'bottled',
    sync_status: 'native_one_time_mirror_g33c_mirror2',
    line_items: baseOrder().line_items,
    ...overrides,
  };
}

function body(overrides = {}) {
  return {
    preview_mode: 'ONE_TIME_NATIVE_FULFILLMENT_TASK_MIRROR_PACKET',
    order_number: IDS.orderNumber,
    customer_app_order_id: IDS.customerAppOrderId,
    native_shopify_order_id: IDS.nativeShopifyOrderId,
    task_creation_policy: 'HELD_UNTIL_NATIVE_SHOPIFY_ORDER_EXISTS',
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    request_id: IDS.requestId,
    ...overrides,
  };
}

function makeBase44({ orders = [baseOrder()], nativeOrders = [nativeOrder()], tasks = [], syncLogs = [], reviewRows = [], commandRows = [], parityRows = [] } = {}) {
  const writes = [];
  const rowsByName = {
    Order: orders,
    ShopifyOrder: nativeOrders,
    FulfillmentTask: tasks,
    OrderSyncLog: syncLogs,
    OrderReviewQueue: reviewRows,
    CommandLog: commandRows,
    SafeSyncParityLog: parityRows,
  };
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    filter: async filter => (rowsByName[name] || []).filter(row => match(row, filter)),
    list: async (_sort, limit = 100) => (rowsByName[name] || []).slice(0, limit),
    create: async payload => { writes.push({ name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { writes.push({ name, id, patch }); throw new Error(`unexpected update ${name}`); },
  });
  return {
    writes,
    base44: { asServiceRole: { entities: Object.fromEntries(Object.keys(rowsByName).map(name => [name, api(name)])) } },
  };
}

async function preview(storeArgs = {}, payload = body()) {
  const { exports } = loadFunctions();
  const { base44, writes } = makeBase44(storeArgs);
  const result = await exports.buildG33CTask1Preview(base44, payload);
  return { result, writes, exports };
}

const results = [];

{
  const { exports } = loadFunctions();
  assert.equal(exports.isG33CTask1PreviewRequest(body()), true);
  assert.equal(exports.g33cTask1UnsupportedBodyKey(body({ raw_payload: {} })), 'raw_payload');
  results.push('mode_detects_and_rejects_unsupported_keys');
}

{
  const { result, writes } = await preview();
  assert.equal(result.success, true);
  assert.equal(result.dry_run, true);
  assert.equal(result.writes_performed, false);
  assert.equal(result.native_shopify_order_present, true);
  assert.equal(result.native_fulfillment_task_present, false);
  assert.equal(result.task_packet_ready, true);
  assert.equal(result.blockers.length, 0);
  assert.equal(result.proposed_native_fulfillment_task_packet.native_shopify_order_id, IDS.nativeShopifyOrderId);
  assert.equal(result.proposed_native_fulfillment_task_packet.order_id, IDS.customerAppOrderId);
  assert.equal(result.proposed_native_fulfillment_task_packet.base44_order_id, IDS.customerAppOrderId);
  assert.equal(result.proposed_native_fulfillment_task_packet.line_item_count, 3);
  assert.equal(result.proposed_native_fulfillment_task_packet.payment_status, 'paid');
  assert.equal(result.provider_call_impact, false);
  assert.equal(result.notification_impact.notification_held, true);
  assert.equal(result.hub_mutation_performed, false);
  assert.equal(writes.length, 0);
  results.push('native_shopify_order_present_and_task_missing_returns_ready_packet');
  results.push('task_packet_includes_native_shopify_order_linkage');
  results.push('task_packet_includes_customer_app_order_linkage');
  results.push('no_writes_for_clean_preview');
}

{
  const { result, writes } = await preview({ orders: [] });
  assert.equal(result.task_packet_ready, false);
  assert.ok(result.blockers.includes('customer_app_order_missing'));
  assert.equal(writes.length, 0);
  results.push('customer_app_order_missing_blocks');
}

{
  const { result, writes } = await preview({ nativeOrders: [] });
  assert.equal(result.task_packet_ready, false);
  assert.ok(result.blockers.includes('native_shopify_order_missing'));
  assert.equal(writes.length, 0);
  results.push('native_shopify_order_missing_blocks');
}

{
  const existingTask = { id: 'task-existing', native_shopify_order_id: IDS.nativeShopifyOrderId, base44_order_id: IDS.customerAppOrderId, order_number: IDS.orderNumber, status: 'pending' };
  const { result, writes } = await preview({ tasks: [existingTask] });
  assert.equal(result.native_fulfillment_task_present, true);
  assert.equal(result.duplicate_task_risk, true);
  assert.ok(result.blockers.includes('existing_native_fulfillment_task_present'));
  assert.ok(result.duplicate_task_risk_reasons.includes('matching_native_shopify_order_id'));
  assert.equal(writes.length, 0);
  results.push('existing_fulfillment_task_dedupes_blocks_create_preview');
}

{
  const order = baseOrder({ assigned_delivery_date: '', selected_delivery_date: '', requested_delivery_date: '', delivery_date: '', production_date: '' });
  const { result, writes } = await preview({ orders: [order] });
  assert.equal(result.task_packet_ready, false);
  assert.ok(result.blockers.includes('missing_delivery_date'));
  assert.equal(writes.length, 0);
  results.push('missing_delivery_date_blocks');
}

{
  const order = baseOrder({ address_line1: '', address_city: '', address_state: '', address_postal_code: '' });
  const { result, writes } = await preview({ orders: [order] });
  assert.equal(result.task_packet_ready, false);
  assert.ok(result.blockers.includes('missing_delivery_address_context'));
  assert.equal(writes.length, 0);
  results.push('missing_delivery_address_blocks');
}

{
  const order = baseOrder({ payment_status: 'pending', payment_captured: false });
  const native = nativeOrder({ payment_status: 'pending', financial_status: 'pending' });
  const { result, writes } = await preview({ orders: [order], nativeOrders: [native] });
  assert.equal(result.task_packet_ready, false);
  assert.ok(result.blockers.includes('payment_not_paid_or_captured'));
  assert.equal(writes.length, 0);
  results.push('unpaid_order_blocks');
}

{
  const order = baseOrder({ fulfillment_type: 'shipping' });
  const native = nativeOrder({ fulfillment_method: 'shipping' });
  const { result, writes } = await preview({ orders: [order], nativeOrders: [native] });
  assert.equal(result.task_packet_ready, false);
  assert.ok(result.blockers.includes('unsupported_fulfillment_type'));
  assert.equal(writes.length, 0);
  results.push('unsupported_fulfillment_type_blocks');
}

{
  const { result } = await preview();
  assert.equal(result.customer_app_order_update_proposed, false);
  assert.equal(result.native_shopify_order_update_proposed, false);
  assert.equal(result.production_batch_create_proposed, false);
  assert.equal(result.batch_compliance_log_create_proposed, false);
  assert.equal(result.held_records.customer_app_order, 'held_no_update');
  assert.equal(result.held_records.native_shopify_order, 'held_no_update');
  assert.equal(result.held_records.production_batch, 'held');
  assert.equal(result.notification_impact.notification_rows_created, false);
  assert.equal(result.notification_impact.message_logs_created, false);
  assert.equal(result.provider_call_impact, false);
  results.push('customer_app_order_update_not_proposed');
  results.push('native_shopify_order_update_not_proposed');
  results.push('production_batch_not_proposed');
  results.push('notifications_held');
  results.push('provider_call_impact_false');
}

console.log(JSON.stringify({
  suite: 'g33c-task1-one-time-fulfillment-task-packet-preview',
  passed: results.length,
  failed: 0,
  results,
  writes_performed: false,
  provider_call_impact: false,
  notifications_held: true,
  hub_mutation: false,
}, null, 2));
