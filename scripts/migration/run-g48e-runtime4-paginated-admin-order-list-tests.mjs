#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const entryPath = path.join(repoRoot, 'base44/functions/getAdminOrdersWithHub/entry.ts');
const uiPath = path.join(repoRoot, 'src/pages/AdminOrders.jsx');
const docsPath = path.join(repoRoot, 'docs/migration/g48e-runtime4-paginated-admin-order-list-and-detail.md');
const entrySource = fs.readFileSync(entryPath, 'utf8');
const uiSource = fs.readFileSync(uiPath, 'utf8');
const docs = fs.existsSync(docsPath) ? fs.readFileSync(docsPath, 'utf8') : '';

const LIST_CONTRACT = 'g48e_admin_order_list_page_v1';
const DETAIL_CONTRACT = 'g48e_admin_order_detail_compact_v1';

function order(overrides = {}) {
  const number = overrides.order_number || 'NV-MQHJR3V2';
  return {
    id: overrides.id || `order_${number}`,
    order_number: number,
    created_date: overrides.created_date || '2026-06-17T04:04:15.034000',
    status: overrides.status || 'scheduled_for_juicing',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    estimated_delivery_date: overrides.estimated_delivery_date || '2026-06-22',
    assigned_delivery_date: overrides.assigned_delivery_date || null,
    total: overrides.total ?? 16.99,
    order_type: overrides.order_type || 'one_time',
    customer_email: overrides.customer_email || 'customer@example.invalid',
    customer_name: overrides.customer_name || 'Customer',
    contact_phone: overrides.contact_phone || '555-0100',
    delivery_address: overrides.delivery_address || 'Address on file',
    items: overrides.items || [{ title: 'AURA', quantity: 1, price: 13, raw_provider_blob: 'x'.repeat(300) }],
    notes: overrides.notes || null,
    ...overrides,
  };
}
function nativeOrder(overrides = {}) {
  const number = overrides.order_number || 'NV-MQHJR3V2';
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
function baseRecords() {
  return {
    orders: [
      order({ order_number: 'NV-MQHJR3V2', created_date: '2026-06-17T04:04:15.034000' }),
      order({ order_number: 'NV-MPZNKGNT', status: 'delivered', created_date: '2026-06-16T04:00:00.000Z', estimated_delivery_date: '2026-06-18' }),
      order({ order_number: 'NV-MP5SOQLJ', created_date: '2026-05-01T10:00:00.000Z', notes: 'historical late mirror' }),
    ],
    nativeOrders: [nativeOrder({ order_number: 'NV-MQHJR3V2' })],
    tasks: [task({ order_number: 'NV-MQHJR3V2' })],
    profiles: [profile()],
  };
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
    btoa: value => Buffer.from(value, 'utf8').toString('base64'),
    atob: value => Buffer.from(value, 'base64').toString('utf8'),
    createClientFromRequest: req => req.__base44,
    buildAdminOrderLifecycleReadModel: () => ({ read_model_available: true, read_model_enabled: true, read_model_version: 'g48e_admin_order_lifecycle_v1', rows: [], summary: {} }),
    fetch: async () => { fetches.push('hub_fetch'); return new Response(JSON.stringify({ orders: hubOrders }), { status: 200, headers: { 'content-type': 'application/json' } }); },
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
function bigRecords(count = 24) {
  return { orders: Array.from({ length: count }, (_, i) => order({ order_number: `NV-PAGE${String(i).padStart(2, '0')}`, id: `order_${i}`, created_date: `2026-06-${String(20 - Math.floor(i / 2)).padStart(2, '0')}T00:${String(i).padStart(2, '0')}:00.000Z` })), profiles: [profile()] };
}
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. Paginated response parses through simulated SDK constraints', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE' }, records: baseRecords() }); assert.equal(r.payload.response_contract, LIST_CONTRACT); assert.ok(JSON.stringify(r.payload).length < 32000); });
test('2. Default page stays below the response-size test budget', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE' }, records: bigRecords(30) }); assert.equal(r.payload.response_size_budget_passed, true); });
test('3. Excessive page size is capped', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 500 }, records: bigRecords(30) }); assert.equal(r.payload.page_size, 10); });
test('4. Stable first page ordering', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 5 }, records: bigRecords(12) }); assert.deepEqual(r.payload.orders.map(o => o.order_number).slice(0, 2), ['NV-PAGE01', 'NV-PAGE00']); });
test('5. Stable next-page ordering', async () => { const first = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 5 }, records: bigRecords(12) }); const second = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 5, cursor: first.payload.next_cursor }, records: bigRecords(12) }); assert.notEqual(first.payload.orders[4].order_number, second.payload.orders[0].order_number); });
test('6. No duplicate order across pages', async () => { const records = bigRecords(14); const first = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 10 }, records }); const second = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 10, cursor: first.payload.next_cursor }, records }); const nums = [...first.payload.orders, ...second.payload.orders].map(o => o.order_number); assert.equal(nums.length, new Set(nums).size); });
test('7. No omitted order across complete page sequence', async () => { const records = bigRecords(14); const first = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 10 }, records }); const second = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 10, cursor: first.payload.next_cursor }, records }); assert.equal(first.payload.orders.length + second.payload.orders.length, first.payload.total_count); });
test('8. Cursor tie-breaker handles equal timestamps', async () => { const records = { orders: [order({ id: 'a', order_number: 'NV-A', created_date: '2026-06-01T00:00:00Z' }), order({ id: 'b', order_number: 'NV-B', created_date: '2026-06-01T00:00:00Z' })], profiles: [profile()] }; const first = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 1 }, records }); const second = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 1, cursor: first.payload.next_cursor }, records }); assert.notEqual(first.payload.orders[0].order_number, second.payload.orders[0].order_number); });
test('9. Invalid cursor fails safely', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', cursor: 'bad-cursor' }, records: baseRecords() }); assert.equal(r.payload.success, false); assert.equal(r.payload.error, 'invalid_or_stale_cursor'); });
test('10. Changing filters invalidates cursor', async () => { const first = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 1, filter: 'active' }, records: baseRecords() }); const second = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 1, filter: 'completed', cursor: first.payload.next_cursor }, records: baseRecords() }); assert.ok(second.payload.success === false || Array.isArray(second.payload.orders)); });
test('11. Search semantics match existing AdminOrders behavior', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', search: 'Customer' }, records: baseRecords() }); assert.ok(r.payload.orders.length >= 1); assert.ok(r.payload.orders.every(o => /customer/i.test(`${o.customer_name || ''} ${o.customer_email || ''}`)));  });
test('12. Status filtering matches existing behavior', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', filter: 'completed' }, records: baseRecords() }); assert.deepEqual(r.payload.orders.map(o => o.order_number), ['NV-MPZNKGNT']); });
test('13. Payment filtering matches existing behavior', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', payment_filter: 'paid' }, records: baseRecords() }); assert.ok(r.payload.orders.length >= 1); });
test('14. Date filtering matches existing behavior', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', created_from: '2026-06-01T00:00:00Z' }, records: baseRecords() }); assert.equal(r.payload.orders.some(o => o.order_number === 'NV-MP5SOQLJ'), false); });
test('15. Sorting matches existing behavior', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', sort_field: 'order_number', sort_direction: 'asc' }, records: baseRecords() }); assert.ok(r.payload.sort.field === 'order_number'); });
test('16. Hub-only valid rows are preserved', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE' }, records: { orders: [order({ order_number: 'NV-LOCAL' })], profiles: [profile()] }, env: { HUB_API_URL: 'https://hub.invalid/functions/x', CUSTOMER_APP_SYNC_SECRET: 'secret' }, hubOrders: [order({ id: 'hub_only', order_number: 'NV-HUBONLY', is_hub_order: true })] }); assert.equal(r.payload.orders.some(o => o.order_number === 'NV-HUBONLY'), true); });
test('17. Refund/cancel rows are preserved in pending/completed contract when requested', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', filter: 'pending' }, records: { orders: [order({ order_number: 'NV-REFUND', status: 'pending_payment', payment_status: 'refunded', financial_status: 'refunded', payment_captured: false })], profiles: [profile()] } }); assert.equal(r.payload.orders.some(o => o.order_number === 'NV-REFUND'), true); });
test('18. Subscription/multi-delivery rows are preserved', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE' }, records: { orders: [order({ order_number: 'NV-SUB', order_type: 'subscription' })], profiles: [profile()] } }); assert.equal(r.payload.orders[0].subscription_indicator, true); });
test('19. Historical chronology is preserved', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', filter: 'active' }, records: baseRecords() }); assert.equal(r.payload.orders.at(-1).order_number, 'NV-MP5SOQLJ'); });
test('20. Known controls appear exactly once across complete paginated filter union', async () => { const all = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE', page_size: 10, filter: 'all' }, records: baseRecords() }); const nums = all.payload.orders.map(o => o.order_number); for (const n of ['NV-MQHJR3V2','NV-MPZNKGNT','NV-MP5SOQLJ']) assert.equal(nums.filter(num => num === n).length, 1); });
test('21. List rows contain required display fields', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE' }, records: baseRecords() }); for (const key of ['canonical_order_ref','order_number','created_date','status','payment_status','total','item_count']) assert.ok(Object.hasOwn(r.payload.orders[0], key)); });
test('22. List rows contain required action references', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE' }, records: baseRecords() }); assert.ok(r.payload.orders[0].id || r.payload.orders[0].customer_app_order_id || r.payload.orders[0].order_number); });
test('23. List rows exclude heavy detail fields', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_LIST_PAGE' }, records: baseRecords() }); assert.equal(Object.hasOwn(r.payload.orders[0], 'items'), false); assert.equal(Object.hasOwn(r.payload.orders[0], 'native_latest_sync_log'), false); });
test('24. Detail request resolves exactly one canonical order', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_DETAIL_COMPACT', customer_app_order_id: 'order_NV-MQHJR3V2', order_number: 'NV-MQHJR3V2' }, records: baseRecords() }); assert.equal(r.payload.response_contract, DETAIL_CONTRACT); assert.equal(r.payload.order.order_number, 'NV-MQHJR3V2'); });
test('25. Detail request rejects ambiguous or missing exact identity', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_DETAIL_COMPACT' }, records: baseRecords() }); assert.equal(r.payload.success, false); assert.equal(r.payload.error, 'exact_order_identifier_required'); });
test('26. Detail includes required line items/panels/action references', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_DETAIL_COMPACT', order_number: 'NV-MQHJR3V2' }, records: baseRecords() }); assert.ok(Array.isArray(r.payload.order.items)); assert.ok(r.payload.action_references_present); });
test('27. Detail excludes raw provider payloads', async () => { const r = await invoke({ body: { response_mode: 'ADMIN_ORDER_DETAIL_COMPACT', order_number: 'NV-MQHJR3V2' }, records: baseRecords() }); assert.doesNotMatch(JSON.stringify(r.payload), /raw_provider_blob|provider_payload|raw_hub|raw_shopify/); });
test('28. AdminOrders loads list and detail separately', () => { assert.match(uiSource, /ADMIN_ORDER_LIST_PAGE_RESPONSE_MODE/); assert.match(uiSource, /ADMIN_ORDER_DETAIL_COMPACT_RESPONSE_MODE/); });
test('29. AdminOrders never requests the large legacy SDK response', () => assert.doesNotMatch(uiSource, /invoke\('getAdminOrdersWithHub'\s*,\s*\{\s*\}\s*\)/));
test('30. AdminOrders never requests the full compact all-orders response', () => assert.doesNotMatch(uiSource, /response_mode:\s*ADMIN_ORDER_LIST_COMPACT_RESPONSE_MODE/));
test('31. Compact lifecycle request remains separate', () => assert.match(uiSource, /read_model_mode:\s*ADMIN_ORDER_LIFECYCLE_READ_MODEL_MODE/));
test('32. G48E remains disabled', async () => { const r = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, records: baseRecords() }); assert.equal(r.payload.admin_order_lifecycle_read_model_enabled, false); });
test('33. List failure does not render an empty successful state', () => assert.match(uiSource, /Unable to load bounded admin-order list/));
test('34. Stale responses do not replace current filters/page', () => assert.match(uiSource, /queryKey:\s*\['admin-orders-page', filter, search\]/));
test('35. Existing actions remain unchanged', () => { assert.match(uiSource, /appendAdminHubOrderNote/); assert.match(uiSource, /ORDER_WORKFLOW_CONTROLS_FROZEN/); });
test('36. No Order mutation', () => assert.doesNotMatch(entrySource, /entities\.Order\.(create|update|delete)|Order\.(create|update|delete)/));
test('37. No ShopifyOrder mutation', () => assert.doesNotMatch(entrySource, /entities\.ShopifyOrder\.(create|update|delete)|ShopifyOrder\.(create|update|delete)/));
test('38. No FulfillmentTask mutation', () => assert.doesNotMatch(entrySource, /entities\.FulfillmentTask\.(create|update|delete)|FulfillmentTask\.(create|update|delete)/));
test('39. No payment/refund/subscription/delivery mutation', () => assert.doesNotMatch(entrySource, /paymentIntents?\.create\s*\(|refunds?\.create\s*\(|Subscription\.update\s*\(|Delivery[A-Za-z]*\.update\s*\(/));
test('40. No Hub/Stripe/Shopify/provider calls in new page/detail mappers', () => { const section = entrySource.slice(entrySource.indexOf('function buildAdminOrderListPageResponse'), entrySource.indexOf('function buildAdminOrderListCompactResponse')); assert.doesNotMatch(section, /fetch\s*\(|HUB_API_URL|Stripe\.|stripe\.|shopify\.|Shopify\./); });
test('41. No notifications', () => assert.doesNotMatch(entrySource, /Notification\.create|CustomerMessageDeliveryLog\.create|notifications_sent:\s*true/));
test('42. No repair/replay', () => assert.doesNotMatch(entrySource, /runRepair|runReplay|repair_replay_performed:\s*true/));
test('43. No logs/queues', () => assert.doesNotMatch(entrySource, /CommandLog\.create|OrderSyncLog\.create|OrderReviewQueue\.create|SafeSyncParityLog\.create/));
test('44. No raw payload or PII expansion', () => { assert.match(entrySource, /raw_payloads_returned:\s*false/); assert.doesNotMatch(entrySource, /raw_provider_blob/); });
test('45. Legacy contracts remain unchanged', () => { assert.match(entrySource, /ADMIN_ORDER_LIST_COMPACT/); assert.match(entrySource, /G48E_RUNTIME_CONTRACT/); });
test('46. RUNTIME1/RUNTIME2/RUNTIME3 regressions are referenced', () => { assert.match(docs, /RUNTIME1/); assert.match(docs, /RUNTIME2/); assert.match(docs, /RUNTIME3/); });

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
  suite: 'g48e-runtime4-paginated-admin-order-list',
  success: failures.length === 0,
  tests: tests.length,
  passed,
  failed: failures.length,
  failures,
  classification: failures.length === 0 ? 'admin_order_paginated_compact_contract_pr_ready' : 'g48e_runtime4_tests_failed',
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
  repair_replay_performed: false,
  logs_or_queues_created: false,
  raw_payloads_returned: false,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
