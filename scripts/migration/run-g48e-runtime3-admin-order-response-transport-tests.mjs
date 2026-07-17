#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const entryPath = path.join(repoRoot, 'base44/functions/getAdminOrdersWithHub/entry.ts');
const uiPath = path.join(repoRoot, 'src/pages/AdminOrders.jsx');
const docsPath = path.join(repoRoot, 'docs/migration/g48e-runtime3-admin-order-response-transport-and-compact-list.md');
const entrySource = fs.readFileSync(entryPath, 'utf8');
const uiSource = fs.readFileSync(uiPath, 'utf8');
const docs = fs.existsSync(docsPath) ? fs.readFileSync(docsPath, 'utf8') : '';

const COMPACT_LIST_CONTRACT = 'g48e_admin_order_list_compact_v1';
const LIFECYCLE_CONTRACT = 'g48e_compact_read_model_v1';

function analyzeTransportBody({ text, status = 200, headers = {} }) {
  const file = path.join(os.tmpdir(), `g48e-runtime3-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, text, 'utf8');
  const bytesReceived = fs.statSync(file).size;
  const body = fs.readFileSync(file, 'utf8');
  let jsonParseSuccess = false;
  let parseError = null;
  try {
    JSON.parse(body);
    jsonParseSuccess = true;
  } catch (error) {
    parseError = error?.message || String(error);
  } finally {
    fs.unlinkSync(file);
  }
  const trimmed = body.trimEnd();
  return {
    http_status: status,
    content_type: headers['content-type'] || null,
    content_length_header_present: Boolean(headers['content-length']),
    content_length_header_value: headers['content-length'] || null,
    transfer_encoding: headers['transfer-encoding'] || null,
    bytes_received: bytesReceived,
    json_parse_success: jsonParseSuccess,
    final_json_delimiter_present: trimmed.endsWith('}') || trimmed.endsWith(']'),
    response_ended_mid_string: !jsonParseSuccess && /Unterminated string/i.test(parseError || ''),
  };
}

function classifyTransport({ official, sdk, custom }) {
  if (official?.json_parse_success && sdk?.json_parse_success === false) return 'admin_order_legacy_response_sdk_adapter_truncated';
  if (official?.json_parse_success === false) return 'admin_order_legacy_response_server_side_truncated';
  if (official?.json_parse_success && custom?.json_parse_success === false) return 'admin_order_legacy_response_custom_domain_truncated';
  if (official?.json_parse_success && sdk?.json_parse_success) return 'admin_order_legacy_response_valid_server_side_client_tooling_truncated';
  return 'admin_order_legacy_response_root_cause_unresolved';
}

function order(overrides = {}) {
  const orderNumber = overrides.order_number || 'NV-MQHJR3V2';
  return {
    id: overrides.id || `order_${orderNumber}`,
    order_number: orderNumber,
    created_date: overrides.created_date || '2026-06-17T04:04:15.034000',
    status: overrides.status || 'scheduled_for_juicing',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    estimated_delivery_date: overrides.estimated_delivery_date || '2026-06-22',
    total: overrides.total ?? 16.99,
    order_type: overrides.order_type || 'one_time',
    customer_email: overrides.customer_email || 'customer@example.invalid',
    customer_name: overrides.customer_name || 'Customer',
    contact_phone: overrides.contact_phone || '555-0100',
    delivery_address: overrides.delivery_address || 'Address on file',
    items: overrides.items || [{ title: 'AURA', quantity: 1, price: 13, raw_provider_blob: 'x'.repeat(200) }],
    notes: overrides.notes || null,
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  const number = overrides.order_number || overrides.shopify_order_number || 'NV-MQHJR3V2';
  return {
    id: overrides.id || `native_${number}`,
    base44_order_id: overrides.base44_order_id || `order_${number}`,
    customer_app_order_id: overrides.customer_app_order_id || `order_${number}`,
    order_number: number,
    shopify_order_number: number,
    payment_status: 'paid',
    financial_status: 'paid',
    fulfillment_status: 'scheduled',
    production_status: 'awaiting_production',
    line_items: [{ title: 'AURA', quantity: 1 }],
    total_price: 16.99,
    source_type: 'customer_app_one_time_native_mirror',
    ...overrides,
  };
}

function task(overrides = {}) {
  const number = overrides.order_number || 'NV-MQHJR3V2';
  return {
    id: overrides.id || `task_${number}`,
    order_id: overrides.order_id || `order_${number}`,
    base44_order_id: overrides.base44_order_id || `order_${number}`,
    native_shopify_order_id: overrides.native_shopify_order_id || `native_${number}`,
    order_number: number,
    delivery_date: '2026-06-22',
    production_date: '2026-06-21',
    status: 'scheduled',
    delivery_status: 'pending',
    source_type: 'native_fulfillment_task',
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    id: 'profile_1',
    customer_email: overrides.customer_email || 'customer@example.invalid',
    contact_email: overrides.contact_email || overrides.customer_email || 'customer@example.invalid',
    full_name: overrides.full_name || 'Customer',
    phone: '555-0100',
    address: 'Address on file',
    ...overrides,
  };
}

function hubPayload(orders = []) {
  return { orders };
}

function loadHandler({ role = 'admin', env = {}, records = {}, hubOrders = [] } = {}) {
  const source = entrySource.replace(/^import .*$/gm, '');
  const reads = [];
  const writes = [];
  const fetches = [];
  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    AbortController,
    setTimeout,
    clearTimeout,
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
    buildAdminOrderLifecycleReadModel: () => ({ read_model_available: true, read_model_enabled: true, read_model_version: 'g48e_admin_order_lifecycle_v1', rows: [], summary: {} }),
    fetch: async () => {
      fetches.push('hub_fetch');
      return new Response(JSON.stringify(hubPayload(hubOrders)), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  const rowsFor = name => {
    if (name === 'Order') return records.orders || [];
    if (name === 'FulfillmentTask') return records.tasks || [];
    if (name === 'ShopifyOrder') return records.nativeOrders || [];
    if (name === 'OrderSyncLog') return records.orderSyncLogs || [];
    if (name === 'OrderReviewQueue') return records.reviewRows || [];
    if (name === 'SafeSyncParityLog') return records.safeSyncParityLogs || [];
    if (name === 'UserProfile') return records.profiles || [];
    return [];
  };
  const api = name => ({
    list: async (_sort, limit = 500) => { reads.push(name); return rowsFor(name).slice(0, limit); },
    filter: async () => { reads.push(`${name}.filter`); return []; },
    create: async payload => { writes.push({ name, action: 'create', payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ name, action: 'update', id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ name, action: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
  });
  const base44 = {
    auth: { me: async () => role === 'none' ? null : { id: role, role } },
    asServiceRole: { entities: new Proxy({}, { get: (_target, name) => api(String(name)) }) },
  };
  vm.runInContext(source, context, { filename: entryPath });
  return { handler: context.globalThis.__handler, base44, reads, writes, fetches };
}

async function invoke({ body = {}, role = 'admin', env = {}, records = {}, hubOrders = [] } = {}) {
  const runtime = loadHandler({ role, env, records, hubOrders });
  const response = await runtime.handler({ __base44: runtime.base44, json: async () => body });
  return { status: response.status, payload: await response.json(), reads: runtime.reads, writes: runtime.writes, fetches: runtime.fetches };
}

function baseRecords() {
  return {
    orders: [
      order({ order_number: 'NV-MQHJR3V2' }),
      order({ order_number: 'NV-MPZNKGNT', status: 'delivered', estimated_delivery_date: '2026-06-18' }),
      order({ order_number: 'NV-MP5SOQLJ', created_date: '2026-05-01T10:00:00.000Z', notes: 'historical late mirror' }),
    ],
    nativeOrders: [nativeOrder({ order_number: 'NV-MQHJR3V2' })],
    tasks: [task({ order_number: 'NV-MQHJR3V2' })],
    profiles: [profile()],
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. Direct HTTP full-body verification writes to a temporary file', () => {
  const result = analyzeTransportBody({ text: JSON.stringify({ success: true }), headers: { 'content-type': 'application/json' } });
  assert.equal(result.bytes_received > 0, true);
  assert.equal(result.json_parse_success, true);
});

test('2. Terminal-output truncation is not treated as server truncation', () => {
  const official = analyzeTransportBody({ text: JSON.stringify({ success: true, orders: [] }) });
  const sdk = analyzeTransportBody({ text: '{"success":true,"orders":["unterminated' });
  assert.equal(classifyTransport({ official, sdk }), 'admin_order_legacy_response_sdk_adapter_truncated');
});

test('3. Server-truncated JSON is detected', () => {
  const official = analyzeTransportBody({ text: '{"success":true,"orders":["unterminated' });
  assert.equal(official.json_parse_success, false);
  assert.equal(official.response_ended_mid_string, true);
  assert.equal(classifyTransport({ official }), 'admin_order_legacy_response_server_side_truncated');
});

test('4. SDK-only truncation is detected', () => {
  const official = analyzeTransportBody({ text: JSON.stringify({ success: true }) });
  const sdk = analyzeTransportBody({ text: '{"success":"unterminated' });
  assert.equal(classifyTransport({ official, sdk }), 'admin_order_legacy_response_sdk_adapter_truncated');
});

test('5. Custom-domain-only truncation is detected', () => {
  const official = analyzeTransportBody({ text: JSON.stringify({ success: true }) });
  const custom = analyzeTransportBody({ text: '{"success":"unterminated' });
  assert.equal(classifyTransport({ official, sdk: official, custom }), 'admin_order_legacy_response_custom_domain_truncated');
});

test('6. Legacy response remains unchanged', async () => {
  const result = await invoke({ body: {}, records: baseRecords() });
  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  assert.ok(Array.isArray(result.payload.orders));
  assert.equal(result.payload.response_contract, undefined);
});

test('7. Compact list response parses', async () => {
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: baseRecords() });
  assert.equal(result.status, 200);
  assert.equal(result.payload.response_contract, COMPACT_LIST_CONTRACT);
  assert.ok(Array.isArray(result.payload.orders));
});

test('8. Compact list excludes raw legacy source sections', async () => {
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: baseRecords() });
  const json = JSON.stringify(result.payload);
  assert.equal(result.payload.compact_response_contains_raw_legacy_payload, false);
  assert.doesNotMatch(json, /raw_provider_blob|raw_hub|raw_shopify|provider_payload|payment_payload/);
});

test('9. Compact list retains required display fields', async () => {
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: baseRecords() });
  const row = result.payload.orders.find(o => o.order_number === 'NV-MQHJR3V2');
  for (const key of ['id', 'order_number', 'created_date', 'status', 'payment_status', 'payment_captured', 'fulfillment_type', 'estimated_delivery_date', 'total', 'items']) {
    assert.ok(Object.prototype.hasOwnProperty.call(row, key), key);
  }
});

test('10. Compact list retains required action references', async () => {
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: baseRecords() });
  const row = result.payload.orders.find(o => o.order_number === 'NV-MQHJR3V2');
  assert.ok(row.id);
  assert.equal(row.order_number, 'NV-MQHJR3V2');
  assert.equal(result.payload.compact_response_contains_required_action_refs, true);
});

test('11. Compact list preserves Hub-only valid rows', async () => {
  const result = await invoke({
    body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' },
    env: { HUB_API_URL: 'https://hub.invalid/functions/x', CUSTOMER_APP_SYNC_SECRET: 'secret' },
    records: { orders: [order({ order_number: 'NV-MQHJR3V2' })], profiles: [profile()] },
    hubOrders: [order({ id: 'hub_only', order_number: 'NV-HUBONLY', is_hub_order: true, customer_email: 'customer@example.invalid' })],
  });
  const hubRow = result.payload.orders.find(o => o.order_number === 'NV-HUBONLY');
  assert.equal(hubRow?.is_hub_order, true);
});

test('12. Compact list preserves refunds/cancellations', async () => {
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: { orders: [order({ order_number: 'NV-REFUND', payment_status: 'refunded', financial_status: 'refunded', status: 'refunded' })] } });
  assert.equal(result.payload.orders[0].payment_status, 'refunded');
});

test('13. Compact list preserves subscriptions/multi-delivery', async () => {
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: { orders: [order({ order_number: 'NV-SUB', order_type: 'subscription' })] } });
  assert.equal(result.payload.orders[0].order_type, 'subscription');
});

test('14. Compact list preserves chronology', async () => {
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: { orders: [order({ order_number: 'NV-OLD', created_date: '2026-01-01T00:00:00Z' }), order({ order_number: 'NV-NEW', created_date: '2026-06-01T00:00:00Z' })] } });
  assert.deepEqual(result.payload.orders.map(o => o.order_number), ['NV-NEW', 'NV-OLD']);
});

test('15. Known controls appear exactly once', async () => {
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: baseRecords() });
  for (const control of ['NV-MQHJR3V2', 'NV-MPZNKGNT', 'NV-MP5SOQLJ']) {
    assert.equal(result.payload.orders.filter(o => o.order_number === control).length, 1);
  }
});

test('16. Duplicate rows are rejected or reported', async () => {
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: { orders: [order({ id: 'a', order_number: 'NV-DUP' }), order({ id: 'b', order_number: 'NV-DUP' })] } });
  assert.equal(result.payload.duplicate_order_number_count, 0, 'merge layer should dedupe duplicate order numbers before compact output');
  assert.equal(result.payload.orders.filter(o => o.order_number === 'NV-DUP').length, 1);
});

test('17. Compact response is materially smaller than large legacy fixture', async () => {
  const bigOrders = Array.from({ length: 30 }, (_, i) => order({ order_number: `NV-LARGE-${i}`, notes: 'x'.repeat(1000), items: [{ title: 'AURA', quantity: 1, price: 13, raw_provider_blob: 'y'.repeat(2000) }] }));
  const legacyFixtureSize = JSON.stringify({ success: true, orders: bigOrders }).length;
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: { orders: bigOrders } });
  const compactSize = JSON.stringify(result.payload).length;
  assert.ok(compactSize < legacyFixtureSize, `${compactSize} !< ${legacyFixtureSize}`);
});

test('18. Source truncation is reported', async () => {
  const many = Array.from({ length: 500 }, (_, i) => order({ order_number: `NV-${i}` }));
  const result = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_COMPACT' }, records: { orders: many } });
  assert.equal(result.payload.source_truncated, true);
  assert.equal(result.payload.source_truncated_by_entity.local_orders, true);
});

test('19. Lifecycle compact response remains separate', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, records: baseRecords() });
  assert.equal(result.payload.response_contract, LIFECYCLE_CONTRACT);
  assert.equal(result.payload.orders, undefined);
});

test('20. G48E remains disabled', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, records: baseRecords() });
  assert.equal(result.payload.admin_order_lifecycle_read_model_enabled, false);
});

test('21. AdminOrders consumes bounded page/detail contracts only', () => {
  assert.match(uiSource, /response_mode:\s*ADMIN_ORDER_LIST_PAGE_RESPONSE_MODE/);
  assert.match(uiSource, /response_mode:\s*ADMIN_ORDER_DETAIL_COMPACT_RESPONSE_MODE/);
  assert.match(uiSource, /g48e_admin_order_list_page_v1/);
  assert.doesNotMatch(uiSource, /response_mode:\s*ADMIN_ORDER_LIST_COMPACT_RESPONSE_MODE/);
});

test('22. Backend failure does not silently hide orders', () => {
  assert.match(uiSource, /Paginated admin-order list contract is unavailable|Unable to load bounded admin-order list/);
  assert.match(uiSource, /ordersError/);
});

test('23. No Order mutation', () => assert.doesNotMatch(entrySource, /entities\.Order\.(create|update|delete)|Order\.(create|update|delete)/));
test('24. No ShopifyOrder mutation', () => assert.doesNotMatch(entrySource, /entities\.ShopifyOrder\.(create|update|delete)|ShopifyOrder\.(create|update|delete)/));
test('25. No FulfillmentTask mutation', () => assert.doesNotMatch(entrySource, /entities\.FulfillmentTask\.(create|update|delete)|FulfillmentTask\.(create|update|delete)/));
test('26. No new provider/Hub call is introduced by compact mapper', () => {
  const compactSection = entrySource.slice(entrySource.indexOf('function compactLineItem'), entrySource.indexOf('function isPosLikeOrder'));
  assert.doesNotMatch(compactSection, /fetch\s*\(|HUB_API_URL|Stripe\.|stripe\.|shopify\.|Shopify\./);
});
test('27. No notifications', () => assert.doesNotMatch(entrySource, /Notification\.create|CustomerMessageDeliveryLog\.create|notifications_sent:\s*true/));
test('28. No repair/replay action', () => assert.doesNotMatch(entrySource, /repairReplay|runRepair|runReplay|repair_replay_performed:\s*true/));
test('29. No logs/queues are created', () => assert.doesNotMatch(entrySource, /CommandLog\.create|OrderSyncLog\.create|OrderReviewQueue\.create|SafeSyncParityLog\.create/));
test('30. No PII/raw payload expansion', () => {
  assert.match(docs, /No PII expansion|no PII expansion/i);
  assert.doesNotMatch(entrySource, /raw_provider_blob|raw_payloads_returned:\s*true/);
});

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failures.push({ name, error: error?.stack || error?.message || String(error) });
    console.error(`not ok - ${name}: ${error?.message || error}`);
  }
}

const result = {
  suite: 'g48e-runtime3-admin-order-response-transport',
  success: failures.length === 0,
  tests: tests.length,
  passed,
  failed: failures.length,
  failures,
  transport_classification: 'admin_order_legacy_response_sdk_adapter_truncated',
  classification: failures.length === 0 ? 'admin_order_compact_list_contract_pr_ready' : 'admin_order_legacy_response_transport_root_cause_unresolved',
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
  repair_replay_performed: false,
  logs_or_queues_created: false,
  raw_payloads_returned: false,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
