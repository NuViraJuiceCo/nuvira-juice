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
const docsPath = path.join(repoRoot, 'docs/migration/g48e-runtime2-compact-admin-order-read-model-response.md');
const entrySource = fs.readFileSync(entryPath, 'utf8');
const uiSource = fs.readFileSync(uiPath, 'utf8');
const docs = fs.existsSync(docsPath) ? fs.readFileSync(docsPath, 'utf8') : '';

const COMPACT_CONTRACT = 'g48e_compact_read_model_v1';
const MODEL_VERSION = 'g48e_admin_order_lifecycle_v1';

function order(overrides = {}) {
  return {
    id: overrides.id || 'order_1',
    order_number: overrides.order_number || 'NV-COMPACT',
    created_date: overrides.created_date || '2026-06-17T04:04:15.034000',
    status: overrides.status || 'scheduled_for_juicing',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    fulfillment_type: overrides.fulfillment_type || 'delivery',
    total: overrides.total ?? 16.99,
    subtotal: overrides.subtotal ?? 13,
    items: overrides.items || [{ name: 'AURA', quantity: 1 }],
    ...overrides,
  };
}

function lifecycleModelFixture(args = {}) {
  return {
    read_model_available: true,
    read_model_enabled: true,
    read_model_version: MODEL_VERSION,
    summary: {
      canonical_order_count: Array.isArray(args.currentOrders) ? args.currentOrders.length : 1,
      complete_native_chain_count: 1,
      fallback_required_count: 0,
      review_hold_count: 0,
    },
    classification_counts: {
      admin_order_native_read_ready: 1,
    },
    rows: [
      {
        canonical_order_number: 'NV-COMPACT',
        classification: 'admin_order_native_read_ready',
        exact_identity_ready: true,
        native_chain_complete: true,
        fallback_required: false,
        review_required: false,
        order_write_ready: false,
        payment_write_ready: false,
        refund_write_ready: false,
        fulfillment_write_ready: false,
        delivery_write_ready: false,
      },
    ],
    order_write_ready: false,
    payment_write_ready: false,
    refund_write_ready: false,
    fulfillment_write_ready: false,
    delivery_write_ready: false,
    notification_expansion_ready: false,
    hub_write_suppression_ready: false,
    repair_replay_ready: false,
    pii_returned: false,
    raw_payloads_returned: false,
  };
}

function loadHandler({ role = 'admin', env = {}, records = {}, failOrderList = false } = {}) {
  const source = entrySource.replace(/^import .*$/gm, '');
  const reads = [];
  const writes = [];
  const providerCalls = [];
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
    buildAdminOrderLifecycleReadModel: lifecycleModelFixture,
    fetch: async () => { providerCalls.push('fetch'); return new Response(JSON.stringify({ orders: [] }), { status: 200 }); },
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  const rowsFor = name => {
    if (name === 'Order') return records.orders || [order()];
    if (name === 'FulfillmentTask') return records.tasks || [];
    if (name === 'ShopifyOrder') return records.nativeOrders || [];
    if (name === 'OrderSyncLog') return records.orderSyncLogs || [];
    if (name === 'OrderReviewQueue') return records.reviewRows || [];
    if (name === 'SafeSyncParityLog') return records.safeSyncParityLogs || [];
    if (name === 'UserProfile') return records.profiles || [];
    return [];
  };
  const api = name => ({
    list: async (_sort, limit = 500) => {
      reads.push(name);
      if (name === 'Order' && failOrderList) throw new Error('forced Order.list failure');
      return rowsFor(name).slice(0, limit);
    },
    filter: async () => { reads.push(`${name}.filter`); return []; },
    create: async payload => { writes.push({ name, action: 'create', payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ name, action: 'update', id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ name, action: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
  });
  const base44 = {
    auth: { me: async () => role === 'none' ? null : { id: role === 'admin' ? 'admin' : 'customer', role } },
    asServiceRole: {
      entities: new Proxy({}, { get: (_target, name) => api(String(name)) }),
    },
  };
  vm.runInContext(source, context, { filename: entryPath });
  return { handler: context.globalThis.__handler, base44, reads, writes, providerCalls };
}

async function invoke({ body = {}, role = 'admin', env = {}, records = {}, failOrderList = false } = {}) {
  const runtime = loadHandler({ role, env, records, failOrderList });
  const response = await runtime.handler({ __base44: runtime.base44, json: async () => body });
  return { status: response.status, payload: await response.json(), reads: runtime.reads, writes: runtime.writes, providerCalls: runtime.providerCalls };
}

function largeLegacyOrders(count = 200) {
  return Array.from({ length: count }, (_, index) => order({
    id: `order_${index}`,
    order_number: `NV-LARGE-${index}`,
    notes: 'x'.repeat(1000),
    items: [{ name: 'AURA', quantity: 1, diagnostic_blob: 'y'.repeat(1000) }],
  }));
}

function assertNoSideEffects(result) {
  assert.deepEqual(result.writes, []);
  assert.deepEqual(result.providerCalls, []);
}

function assertNoCustomerOrRawPayload(payload) {
  const json = JSON.stringify(payload);
  assert.doesNotMatch(json, /customer_email|customer_name|contact_phone|delivery_address|phone|address|raw_hub|raw_shopify|raw_stripe|provider_payload|payment_payload|client_secret|payment_intent/i);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. Legacy request remains unchanged', async () => {
  const result = await invoke({ body: {}, records: { orders: [order()] } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  assert.ok(Array.isArray(result.payload.orders));
  assert.equal(result.payload.orders.length, 1);
  assert.ok(result.reads.includes('Order'));
  assertNoSideEffects(result);
});

test('2. Explicit mode selects compact path', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.read_model_mode, 'ADMIN_ORDER_LIFECYCLE');
  assert.equal(result.payload.response_contract, COMPACT_CONTRACT);
  assert.equal(result.payload.legacy_orders_payload_included, false);
});

test('3. Disabled explicit mode returns capability metadata', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.equal(result.payload.success, true);
  assert.equal(result.payload.dry_run, true);
  assert.equal(result.payload.writes_performed, false);
  assert.equal(result.payload.admin_order_lifecycle_read_model_available, true);
  assert.equal(result.payload.admin_order_lifecycle_read_model_enabled, false);
  assert.equal(result.payload.admin_order_lifecycle_read_model_version, MODEL_VERSION);
  assert.equal(result.payload.read_model_payload_present, false);
});

test('4. Disabled explicit mode excludes orders[]', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, records: { orders: largeLegacyOrders() } });
  assert.equal(result.payload.orders, undefined);
  assert.equal('total' in result.payload, false);
  assert.equal(result.payload.legacy_orders_payload_included, false);
});

test('5. Disabled explicit mode avoids entity reads where possible', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, records: { orders: largeLegacyOrders() } });
  assert.deepEqual(result.reads, []);
  assertNoSideEffects(result);
});

test('6. Capability response parses as valid JSON', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  const json = JSON.stringify(result.payload);
  assert.deepEqual(JSON.parse(json), result.payload);
  assert.ok(json.length < 5000, `compact response too large: ${json.length}`);
});

test('7. Large synthetic legacy payload does not affect compact response', async () => {
  const legacyFixtureSize = JSON.stringify({ orders: largeLegacyOrders(250) }).length;
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, records: { orders: largeLegacyOrders(250) } });
  const compactSize = JSON.stringify(result.payload).length;
  assert.ok(legacyFixtureSize > 100000);
  assert.ok(compactSize < 5000);
  assert.ok(legacyFixtureSize > compactSize * 20);
});

test('8. Metadata is not dependent on JSON key order', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  const entries = Object.entries(result.payload).reverse();
  const reparsed = Object.fromEntries(entries);
  assert.equal(reparsed.response_contract, COMPACT_CONTRACT);
  assert.equal(reparsed.admin_order_lifecycle_read_model_available, true);
});

test('9. Unknown mode does not select compact path', async () => {
  const result = await invoke({ body: { read_model_mode: 'UNKNOWN_MODE' } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.response_contract, undefined);
  assert.ok(Array.isArray(result.payload.orders));
  assert.ok(result.reads.includes('Order'));
});

test('10. Conflicting mode values fail safely', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE', mode: 'OTHER_MODE' } });
  assert.equal(result.status, 400);
  assert.equal(result.payload.success, false);
  assert.equal(result.payload.error, 'conflicting_read_model_mode');
  assert.equal(result.payload.response_contract, COMPACT_CONTRACT);
  assert.equal(result.payload.orders, undefined);
  assert.deepEqual(result.reads, []);
  assertNoSideEffects(result);
});

test('11. Diagnostic mode remains functional', async () => {
  const result = await invoke({ body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.g48e_source_marker_present, true);
  assert.equal(result.payload.response_contract_version, 'g48e_runtime_contract_v1');
  assert.deepEqual(result.reads, []);
});

test('12. Admin authorization is required', async () => {
  const result = await invoke({ role: 'customer', body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.equal(result.status, 403);
  assert.equal(result.payload.admin_order_lifecycle_read_model_available, undefined);
});

test('13. Anonymous request returns no metadata', async () => {
  const result = await invoke({ role: 'none', body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.equal(result.status, 401);
  assert.equal(result.payload.admin_order_lifecycle_read_model_available, undefined);
});

test('14. Ordinary customer returns no admin metadata', async () => {
  const result = await invoke({ role: 'customer', body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.equal(result.status, 403);
  assert.equal(result.payload.g48e_source_marker_present, undefined);
});

test('15. Future enabled fixture includes canonical lifecycle payload', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, env: { ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL: 'true' } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.admin_order_lifecycle_read_model_enabled, true);
  assert.equal(result.payload.read_model_payload_present, true);
  assert.equal(result.payload.admin_order_lifecycle_read_model.read_model_version, MODEL_VERSION);
  assert.ok(Array.isArray(result.payload.admin_order_lifecycle_read_model.rows));
});

test('16. Future enabled fixture excludes legacy orders payload', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, env: { ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL: 'true' } });
  assert.equal(result.payload.orders, undefined);
  assert.equal(result.payload.legacy_orders_payload_included, false);
});

test('17. Future enabled payload is bounded', async () => {
  const result = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, env: { ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL: 'true' }, records: { orders: largeLegacyOrders(200) } });
  const size = JSON.stringify(result.payload).length;
  assert.ok(size < 20000, `enabled compact fixture too large: ${size}`);
});

test('18. Backend failure preserves safe response behavior', async () => {
  const result = await invoke({ body: {}, failOrderList: true });
  assert.equal(result.status, 500);
  assert.match(result.payload.error, /forced Order\.list failure/);
  assert.equal(result.payload.orders, undefined);
  assertNoSideEffects(result);
});

test('19. No Order mutation', () => assert.doesNotMatch(entrySource, /entities\.Order\.(create|update|delete)|Order\.(create|update|delete)/));
test('20. No ShopifyOrder mutation', () => assert.doesNotMatch(entrySource, /entities\.ShopifyOrder\.(create|update|delete)|ShopifyOrder\.(create|update|delete)/));
test('21. No FulfillmentTask mutation', () => assert.doesNotMatch(entrySource, /entities\.FulfillmentTask\.(create|update|delete)|FulfillmentTask\.(create|update|delete)/));
test('22. No Stripe/Shopify/Hub/provider calls in compact branch', () => {
  const compactSection = entrySource.slice(entrySource.indexOf('function buildAdminOrderLifecycleCompactResponse'), entrySource.indexOf('// 1. Fetch all local orders'));
  assert.doesNotMatch(compactSection, /fetch\s*\(|Stripe\.|stripe\.|shopify\.|Shopify\.|HUB_API_URL|provider_call_impact:\s*true/);
});
test('23. No notifications', () => assert.doesNotMatch(entrySource, /Notification\.create|CustomerMessageDeliveryLog\.create|notifications_sent:\s*true/));
test('24. No repair/replay action', () => assert.doesNotMatch(entrySource, /repairReplay|runRepair|runReplay|repair_replay_performed:\s*true/));
test('25. No logs/queues are created', () => assert.doesNotMatch(entrySource, /CommandLog\.create|OrderSyncLog\.create|OrderReviewQueue\.create|SafeSyncParityLog\.create/));
test('26. No PII/raw payloads in compact response', async () => {
  const disabled = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  const enabled = await invoke({ body: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' }, env: { ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL: 'true' } });
  assertNoCustomerOrRawPayload(disabled.payload);
  assertNoCustomerOrRawPayload(enabled.payload);
  assert.equal(disabled.payload.pii_returned, false);
  assert.equal(disabled.payload.raw_payloads_returned, false);
});

test('27. AdminOrders uses separate compact list and lifecycle queries', () => {
  assert.match(uiSource, /queryKey:\s*\['admin-orders'\][\s\S]*?response_mode:\s*ADMIN_ORDER_LIST_COMPACT_RESPONSE_MODE/);
  assert.match(uiSource, /queryKey:\s*\['admin-order-lifecycle-read-model'\][\s\S]*?read_model_mode:\s*ADMIN_ORDER_LIFECYCLE_READ_MODEL_MODE/);
  assert.match(uiSource, /hasValidAdminOrderLifecycleReadModel\(orderLifecycleData\)/);
});

test('28. Diagnostic mode is not exposed in AdminOrders UI', () => {
  assert.doesNotMatch(uiSource, /G48E_RUNTIME_CONTRACT|diagnostic_mode/);
});

test('29. Documentation records compact response rationale', () => {
  assert.match(docs, /metadata-first/i);
  assert.match(docs, /compact explicit-mode/i);
  assert.match(docs, /legacy `orders\[\]`|legacy orders\[\]/i);
});

test('30. Existing disabled controls remain default-off', () => {
  assert.match(entrySource, /ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL/);
  assert.match(entrySource, /ADMIN_ORDER_LIFECYCLE_READ_MODEL_KILL_SWITCH/);
  assert.match(entrySource, /adminOrderLifecycleReadModelRequested && !adminOrderLifecycleReadModelActive/);
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
  suite: 'g48e-runtime2-compact-read-model-response',
  success: failures.length === 0,
  tests: tests.length,
  passed,
  failed: failures.length,
  failures,
  writes_performed: false,
  provider_call_impact: false,
  stripe_calls: false,
  shopify_calls: false,
  hub_calls: false,
  notifications_sent: false,
  repair_replay_performed: false,
  logs_or_queues_created: false,
  raw_payloads_returned: false,
  pii_returned: false,
  classification: failures.length === 0 ? 'admin_order_lifecycle_compact_runtime_contract_pr_ready' : 'admin_order_lifecycle_runtime_contract_fix_required',
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
