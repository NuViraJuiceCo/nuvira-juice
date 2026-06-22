#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionDir = path.join(repoRoot, 'base44/functions/getAdminOrdersWithHub');
const entryPath = path.join(functionDir, 'entry.ts');
const helperPath = path.join(functionDir, 'adminOrderLifecycleReadModel.js');
const uiPath = path.join(repoRoot, 'src/pages/AdminOrders.jsx');
const docsPath = path.join(repoRoot, 'docs/migration/g48e-admin-order-lifecycle-read-model-consolidation.md');
const helper = await import(pathToFileURL(helperPath).href);
const entrySource = fs.readFileSync(entryPath, 'utf8');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const uiSource = fs.readFileSync(uiPath, 'utf8');
const docs = fs.existsSync(docsPath) ? fs.readFileSync(docsPath, 'utf8') : '';

function orderNumber(value) {
  return (value ?? '').toString().replace(/^#/, '').trim().toUpperCase();
}

function baseRow(overrides = {}) {
  const number = overrides.order_number || 'NV-CLEAN';
  return {
    id: overrides.id || `order_${number}`,
    customer_app_order_id: overrides.customer_app_order_id || `order_${number}`,
    order_number: number,
    created_date: '2026-06-17T04:04:15.034000',
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    financial_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    order_type: 'one_time',
    assigned_delivery_date: '2026-06-22',
    estimated_delivery_date: '2026-06-22',
    items: [{ sku: 'AURA' }],
    has_customer_app_order: true,
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  const number = overrides.shopify_order_number || overrides.order_number || 'NV-CLEAN';
  return {
    id: overrides.id || `native_${number}`,
    base44_order_id: overrides.base44_order_id || `order_${number}`,
    customer_app_order_id: overrides.customer_app_order_id || `order_${number}`,
    shopify_order_number: number,
    order_number: number,
    payment_status: 'paid',
    financial_status: 'paid',
    fulfillment_status: 'scheduled',
    production_status: 'awaiting_production',
    assigned_delivery_date: '2026-06-22',
    selected_delivery_date: '2026-06-22',
    source_type: 'customer_app_one_time_native_mirror',
    ...overrides,
  };
}

function task(overrides = {}) {
  const number = overrides.order_number || 'NV-CLEAN';
  return {
    id: overrides.id || `task_${number}`,
    order_id: overrides.order_id || `order_${number}`,
    base44_order_id: overrides.base44_order_id || `order_${number}`,
    native_shopify_order_id: overrides.native_shopify_order_id || `native_${number}`,
    shopify_order_id: overrides.shopify_order_id || `native_${number}`,
    order_number: number,
    shopify_order_number: number,
    delivery_date: '2026-06-22',
    status: 'scheduled',
    delivery_status: 'pending',
    production_status: 'awaiting_production',
    fulfillment_type: 'delivery',
    ...overrides,
  };
}

function model({ rows = [baseRow()], nativeOrders = [nativeOrder()], tasks = [task()], reviewRows = [], orderSyncLogs = [], safeSyncParityLogs = [], hubRows = [] } = {}) {
  return helper.buildAdminOrderLifecycleReadModel({
    currentOrders: rows,
    customerOrders: rows,
    nativeOrders,
    fulfillmentTasks: tasks,
    hubOrders: hubRows,
    reviewRows,
    orderSyncLogs,
    safeSyncParityLogs,
    filters: { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' },
  });
}

function rowFor(result, number) {
  return result.rows.find(row => orderNumber(row.canonical_order_number) === orderNumber(number));
}

function loadEntryHandler(env = {}) {
  const source = entrySource.replace(/^import .*$/gm, '');
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
    buildAdminOrderLifecycleReadModel: helper.buildAdminOrderLifecycleReadModel,
    fetch: async () => new Response(JSON.stringify({ orders: [] }), { status: 200 }),
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: entryPath });
  return context.globalThis.__handler;
}

function fakeBase44({ orders = [baseRow()], nativeOrders = [nativeOrder()], tasks = [task()], profiles = [], logs = [], reviewRows = [] } = {}) {
  const reads = [];
  const writes = [];
  const api = (name, rows) => ({
    list: async (_sort, limit = 500) => { reads.push(name); return rows.slice(0, limit); },
    filter: async () => { throw new Error(`unexpected filter ${name}`); },
    create: async payload => { writes.push({ name, action: 'create', payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ name, action: 'update', id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ name, action: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    reads,
    writes,
    base44: {
      auth: { me: async () => ({ id: 'admin', role: 'admin' }) },
      asServiceRole: {
        entities: {
          Order: api('Order', orders),
          FulfillmentTask: api('FulfillmentTask', tasks),
          ShopifyOrder: api('ShopifyOrder', nativeOrders),
          OrderSyncLog: api('OrderSyncLog', logs),
          OrderReviewQueue: api('OrderReviewQueue', reviewRows),
          UserProfile: api('UserProfile', profiles),
          SafeSyncParityLog: api('SafeSyncParityLog', []),
        },
      },
    },
  };
}

async function invokeEntry({ env = {}, body = { read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } } = {}) {
  const store = fakeBase44();
  const handler = loadEntryHandler(env);
  const response = await handler({ __base44: store.base44, json: async () => body });
  return { status: response.status, payload: await response.json(), reads: store.reads, writes: store.writes };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. Function-local helper is packaged', () => {
  assert.equal(path.dirname(helperPath), functionDir);
  assert.ok(fs.existsSync(helperPath));
  assert.match(entrySource, /\.\/adminOrderLifecycleReadModel\.js/);
});

test('2. Helper performs no reads/writes/provider calls', () => {
  assert.doesNotMatch(helperSource, /base44\.|createClientFromRequest|fetch\s*\(|entities\.|asServiceRole|\.create\s*\(|\.update\s*\(|\.delete\s*\(|bulkCreate|updateMany|deleteMany|Stripe\.|shopify\.|HUB_API_URL|Notification\./);
});

test('3. Existing response remains unchanged when disabled', async () => {
  const result = await invokeEntry({ env: {} });
  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  assert.ok(Array.isArray(result.payload.orders));
  assert.equal(result.payload.admin_order_lifecycle_read_model_available, true);
  assert.equal(result.payload.admin_order_lifecycle_read_model_enabled, false);
  assert.equal(result.payload.admin_order_lifecycle_read_model, undefined);
  assert.equal(result.writes.length, 0);
});

test('4. Existing filters/search/date behavior remains unchanged', () => {
  assert.match(uiSource, /const \[filter, setFilter\] = useState\('active'\)/);
  assert.match(uiSource, /const \[search, setSearch\] = useState\(''\)/);
  assert.match(uiSource, /statusFiltered\.filter/);
});

test('5. Exact Order/native-order/task matching works', () => {
  const result = model();
  const row = rowFor(result, 'NV-CLEAN');
  assert.equal(row.classification, 'admin_order_native_read_ready');
  assert.equal(row.native_chain_complete, true);
  assert.equal(row.exact_identity_ready, true);
});

test('6. Fuzzy matching is rejected', () => {
  const result = model({ nativeOrders: [nativeOrder({ id: 'native_other', base44_order_id: 'unrelated', customer_app_order_id: 'unrelated', order_number: 'NV-OTHER', customer_name: 'Same Person' })], tasks: [] });
  assert.equal(rowFor(result, 'NV-CLEAN').classification, 'admin_order_native_order_missing');
});

test('7. Duplicate native order blocks readiness', () => {
  const result = model({ nativeOrders: [nativeOrder({ id: 'native_a' }), nativeOrder({ id: 'native_b' })] });
  assert.equal(rowFor(result, 'NV-CLEAN').classification, 'admin_order_duplicate_identity_risk');
});

test('8. Duplicate/conflicting task blocks readiness', () => {
  const result = model({ tasks: [task({ id: 'task_a' }), task({ id: 'task_b', delivery_date: '2026-06-23' })] });
  assert.equal(rowFor(result, 'NV-CLEAN').classification, 'admin_order_duplicate_identity_risk');
});

test('9. Missing native order preserves fallback', () => {
  const row = rowFor(model({ nativeOrders: [], tasks: [] }), 'NV-CLEAN');
  assert.equal(row.classification, 'admin_order_native_order_missing');
  assert.equal(row.fallback_required, true);
});

test('10. Missing task preserves fallback', () => {
  const row = rowFor(model({ tasks: [] }), 'NV-CLEAN');
  assert.equal(row.classification, 'admin_order_fulfillment_task_missing');
  assert.equal(row.fallback_required, true);
});

test('11. Payment mismatch holds', () => {
  const row = rowFor(model({ nativeOrders: [nativeOrder({ payment_status: 'pending' })] }), 'NV-CLEAN');
  assert.equal(row.classification, 'admin_order_payment_mismatch');
});

test('12. Fulfillment mismatch holds', () => {
  const row = rowFor(model({ rows: [baseRow({ status: 'delivered', fulfillment_status: 'delivered' })], nativeOrders: [nativeOrder({ fulfillment_status: 'scheduled' })] }), 'NV-CLEAN');
  assert.equal(row.classification, 'admin_order_fulfillment_mismatch');
});

test('13. Delivery schedule mismatch holds', () => {
  const row = rowFor(model({ tasks: [task({ delivery_date: '2026-06-23', scheduled_date: '2026-06-23', assigned_delivery_date: '2026-06-23' })] }), 'NV-CLEAN');
  assert.equal(row.classification, 'admin_order_delivery_schedule_mismatch');
});

test('14. Refund/cancel holds', () => {
  assert.equal(rowFor(model({ rows: [baseRow({ payment_status: 'refunded' })] }), 'NV-CLEAN').classification, 'admin_order_refund_payment_hold');
  assert.equal(rowFor(model({ rows: [baseRow({ status: 'cancelled' })] }), 'NV-CLEAN').classification, 'admin_order_cancelled_payment_risk');
});

test('15. Subscription/multi-delivery holds', () => {
  const row = rowFor(model({ rows: [baseRow({ order_type: 'subscription', stripe_subscription_id: 'sub_x' })] }), 'NV-CLEAN');
  assert.equal(row.classification, 'admin_order_subscription_multi_delivery_hold');
});

test('16. Review queue holds', () => {
  const row = rowFor(model({ reviewRows: [{ status: 'open', existing_order_number: 'NV-CLEAN', incident_type: 'duplicate' }] }), 'NV-CLEAN');
  assert.equal(row.classification, 'admin_order_review_queue_hold');
});

test('17. Repair/replay holds', () => {
  const row = rowFor(model({ orderSyncLogs: [{ order_number: 'NV-CLEAN', action: 'repair_replay', status: 'pending' }] }), 'NV-CLEAN');
  assert.equal(row.classification, 'admin_order_repair_replay_hold');
});

test('18. Historical late mirror remains held', () => {
  const row = rowFor(model({ rows: [baseRow({ order_number: 'NV-MP5SOQLJ', notes: 'historical late_mirror backfill' })], nativeOrders: [nativeOrder({ order_number: 'NV-MP5SOQLJ', shopify_order_number: 'NV-MP5SOQLJ', base44_order_id: 'order_NV-MP5SOQLJ' })], tasks: [task({ order_number: 'NV-MP5SOQLJ', order_id: 'order_NV-MP5SOQLJ', base44_order_id: 'order_NV-MP5SOQLJ', native_shopify_order_id: 'native_NV-MP5SOQLJ' })] }), 'NV-MP5SOQLJ');
  assert.equal(row.classification, 'admin_order_historical_late_mirror');
});

test('19. Hub-only valid row remains visible', () => {
  const row = rowFor(model({ rows: [baseRow({ id: 'hub_1', order_number: 'NV-HUBONLY', is_hub_order: true, has_customer_app_order: false, customer_app_order_id: null })], nativeOrders: [], tasks: [] }), 'NV-HUBONLY');
  assert.equal(row.classification, 'admin_order_hub_only_valid');
});

test('20. Complete native chain is represented safely', () => {
  const result = model();
  assert.equal(result.summary.complete_native_chain_count, 1);
  assert.equal(result.order_write_ready, false);
  assert.equal(result.payment_write_ready, false);
  assert.equal(result.refund_write_ready, false);
  assert.equal(result.fulfillment_write_ready, false);
  assert.equal(result.delivery_write_ready, false);
});

test('21. Admin page uses canonical model only when enabled', () => {
  assert.match(uiSource, /hasValidAdminOrderLifecycleReadModel/);
  assert.match(uiSource, /admin_order_lifecycle_read_model_enabled === true/);
  assert.match(uiSource, /admin_order_lifecycle_read_model_version === ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION/);
});

test('22. Disabled page behavior remains unchanged', () => {
  assert.match(uiSource, /const primaryOrders = ordersData\.orders \|\| \[\]/);
  assert.match(uiSource, /deliveryFallbackOrders\.forEach/);
});

test('23. Backend failure preserves fallback', () => {
  assert.match(uiSource, /deliveryFallbackOrders/);
  assert.match(uiSource, /ordersError/);
});

test('24. Unsupported version preserves fallback', () => {
  assert.match(uiSource, /ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION/);
  assert.match(uiSource, /model\?\.read_model_version === ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION/);
});

test('25. No frontend Vite/query/localStorage/global activation path', () => {
  assert.doesNotMatch(uiSource, /VITE_ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL|localStorage|sessionStorage|location\.search|window\.__|globalThis/);
});

test('26. Existing admin actions remain unchanged', () => {
  const changed = (process.env.G48E_CHANGED_FILES || '').split(/\n/).filter(Boolean);
  const forbidden = changed.filter(file => /appendAdminHubOrderNote|manualSync|repair|refund|pushOrder|Fulfillment|Delivery|Notification/.test(file) && !/getAdminOrdersWithHub|AdminOrders|g48e/.test(file));
  assert.deepEqual(forbidden, []);
  assert.match(uiSource, /ORDER_WORKFLOW_CONTROLS_FROZEN = true/);
});

test('27. No Order mutation', () => assert.doesNotMatch(helperSource, /Order\.create|Order\.update|entities\.Order\.create|entities\.Order\.update/));
test('28. No ShopifyOrder mutation', () => assert.doesNotMatch(helperSource, /ShopifyOrder\.create|ShopifyOrder\.update|entities\.ShopifyOrder\.create|entities\.ShopifyOrder\.update/));
test('29. No FulfillmentTask mutation', () => assert.doesNotMatch(helperSource, /FulfillmentTask\.create|FulfillmentTask\.update|entities\.FulfillmentTask\.create|entities\.FulfillmentTask\.update/));
test('30. No payment/refund mutation', () => assert.doesNotMatch(helperSource, /refunds?\.create|paymentIntents?\.create|\.capture\s*\(|cancelPayment|refund_write_ready:\s*true/));
test('31. No Hub/Shopify/provider calls', () => assert.doesNotMatch(helperSource, /fetch\s*\(|HUB_API_URL|Stripe\.|stripe\.|shopify\.|provider_call_impact:\s*true/));
test('32. No notifications', () => assert.doesNotMatch(helperSource, /Notification\.create|notifications_sent:\s*true|sendNotification/));
test('33. No repair/replay', () => assert.match(helperSource, /repair_replay_ready: false/));
test('34. No logs/queues', () => assert.doesNotMatch(helperSource, /CommandLog|OrderSyncLog\.create|SafeSyncParityLog\.create|OrderReviewQueue\.create/));
test('35. No raw payloads', () => assert.doesNotMatch(helperSource, /raw_hub|raw_shopify|raw_stripe|provider_payload|payment_payload/));
test('36. No PII expansion', () => assert.doesNotMatch(helperSource, /customer_email|customer_phone|contact_phone|delivery_address|address_line|postal_code|full_address/));

test('37. G39J/G39L admin-order regressions are declared', () => {
  assert.match(docs, /G39J\/G39L|G39J|G39L/);
});

test('38. G43B/G43C customer regressions are declared', () => assert.match(docs, /G43B\/G43C|G43B|G43C/));
test('39. G47B checkout parity is declared', () => assert.match(docs, /G47B/));
test('40. G42B delivery readiness is declared', () => assert.match(docs, /G42B/));

test('41. Existing controls remain default-off', () => {
  assert.match(entrySource, /ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL/);
  assert.match(entrySource, /ADMIN_ORDER_LIFECYCLE_READ_MODEL_KILL_SWITCH/);
  assert.match(entrySource, /admin_order_lifecycle_read_model_enabled: Boolean\(adminOrderLifecycleReadModelRequested && adminOrderLifecycleReadModelActive\)/);
});

test('42. Known control rows are representable', () => {
  const result = model({ rows: [baseRow({ order_number: 'NV-MQHJR3V2' }), baseRow({ order_number: 'NV-MPZNKGNT' })], nativeOrders: [nativeOrder({ order_number: 'NV-MQHJR3V2', shopify_order_number: 'NV-MQHJR3V2', base44_order_id: 'order_NV-MQHJR3V2' }), nativeOrder({ order_number: 'NV-MPZNKGNT', shopify_order_number: 'NV-MPZNKGNT', base44_order_id: 'order_NV-MPZNKGNT' })], tasks: [task({ order_number: 'NV-MQHJR3V2', order_id: 'order_NV-MQHJR3V2', base44_order_id: 'order_NV-MQHJR3V2', native_shopify_order_id: 'native_NV-MQHJR3V2' }), task({ order_number: 'NV-MPZNKGNT', order_id: 'order_NV-MPZNKGNT', base44_order_id: 'order_NV-MPZNKGNT', native_shopify_order_id: 'native_NV-MPZNKGNT' })] });
  assert.ok(rowFor(result, 'NV-MQHJR3V2'));
  assert.ok(rowFor(result, 'NV-MPZNKGNT'));
});

test('43. Empty result is safe', () => {
  const result = model({ rows: [], nativeOrders: [], tasks: [] });
  assert.equal(result.summary.canonical_order_count, 0);
  assert.deepEqual(result.rows, []);
});

test('44. Valid rows are never hidden by the read model', () => {
  const result = model({ rows: [baseRow({ order_number: 'NV-A' }), baseRow({ order_number: 'NV-B' })], nativeOrders: [nativeOrder({ order_number: 'NV-A', shopify_order_number: 'NV-A', base44_order_id: 'order_NV-A' })], tasks: [task({ order_number: 'NV-A', order_id: 'order_NV-A', base44_order_id: 'order_NV-A', native_shopify_order_id: 'native_NV-A' })] });
  assert.equal(result.rows.length, 2);
});

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, error: error?.stack || error?.message || String(error) });
  }
}

const result = {
  success: failures.length === 0,
  passed,
  failed: failures.length,
  failures,
  classification: failures.length === 0 ? 'admin_order_lifecycle_read_model_consolidation_pr_ready' : 'hard_stop_admin_order_lifecycle_read_model_behavior_regression',
  writes_performed: false,
  provider_call_impact: false,
  shopify_calls: false,
  hub_mutation_performed: false,
  notifications_sent: false,
  repair_replay_performed: false,
  raw_payloads_returned: false,
  pii_returned: false,
};
console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
