#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionDir = path.join(repoRoot, 'base44/functions/getAdminDeliveryRouteSummary');
const entryPath = path.join(functionDir, 'entry.ts');
const helperPath = path.join(functionDir, 'deliveryLifecycleReadModel.js');
const uiPath = path.join(repoRoot, 'src/pages/admin/DeliveryQueue.jsx');
const docsPath = path.join(repoRoot, 'docs/migration/g48d-delivery-lifecycle-read-model-consolidation.md');
const g42bDocsPath = path.join(repoRoot, 'docs/migration/g42b-admin-delivery-action-readiness-preview.md');
const g39dHarnessPath = path.join(repoRoot, 'scripts/migration/run-g39d-admin-delivery-route-native-first-tests.mjs');

const entrySource = fs.readFileSync(entryPath, 'utf8');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const uiSource = fs.readFileSync(uiPath, 'utf8');
const helper = await import(pathToFileURL(helperPath).href);

const DELIVERY_DATE = '2026-06-22';

function orderNumber(value) {
  return (value ?? '').toString().trim().replace(/^#/, '').toUpperCase();
}

function baseOrder(overrides = {}) {
  const number = overrides.order_number || 'NV-CLEAN';
  return {
    id: overrides.id || `order_${number}`,
    order_number: number,
    fulfillment_type: 'delivery',
    assigned_delivery_date: DELIVERY_DATE,
    status: 'order_received',
    fulfillment_status: 'scheduled',
    delivery_status: 'pending',
    payment_status: 'paid',
    financial_status: 'paid',
    payment_captured: true,
    source_type: 'one_time',
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  const number = overrides.shopify_order_number || overrides.order_number || 'NV-CLEAN';
  return {
    id: overrides.id || `native_${number}`,
    base44_order_id: overrides.base44_order_id || `order_${number}`,
    shopify_order_number: number,
    fulfillment_method: 'delivery',
    assigned_delivery_date: DELIVERY_DATE,
    selected_delivery_date: DELIVERY_DATE,
    requested_delivery_date: DELIVERY_DATE,
    payment_status: 'paid',
    financial_status: 'paid',
    fulfillment_status: 'scheduled',
    production_status: 'awaiting_production',
    source_type: 'customer_app_one_time_native_mirror',
    source_channel: 'customer_app',
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
    order_number: number,
    fulfillment_type: 'delivery',
    delivery_date: DELIVERY_DATE,
    scheduled_date: DELIVERY_DATE,
    assigned_delivery_date: DELIVERY_DATE,
    status: 'scheduled',
    delivery_status: 'pending',
    payment_status: 'paid',
    production_status: 'awaiting_production',
    ...overrides,
  };
}

function stop(overrides = {}) {
  const number = overrides.order_number || 'NV-CLEAN';
  return {
    task_id: overrides.task_id || `task_${number}`,
    order_number: number,
    customer_app_order_id: overrides.customer_app_order_id || `order_${number}`,
    native_shopify_order_id: overrides.native_shopify_order_id || `native_${number}`,
    task_status: overrides.task_status || 'scheduled',
    delivery_status: overrides.delivery_status || 'pending',
    production_status: 'awaiting_production',
    fulfillment_status: 'scheduled',
    fulfillment_type: 'delivery',
    payment_status: 'paid',
    delivery_date: DELIVERY_DATE,
    scheduled_date: DELIVERY_DATE,
    assigned_delivery_date: DELIVERY_DATE,
    data_source: overrides.data_source || 'customer_app_native_task',
    hub_fallback_used: overrides.hub_fallback_used === true,
    ...overrides,
  };
}

function model({ orders = [baseOrder()], nativeOrders = [nativeOrder()], tasks = [task()], stops = [stop()], reviewRows = [], orderSyncLogs = [], safeSyncParityLogs = [] } = {}) {
  return helper.buildDeliveryLifecycleReadModel({
    deliveryDate: DELIVERY_DATE,
    routeSummaryRows: stops,
    customerOrders: orders,
    nativeOrders,
    fulfillmentTasks: tasks,
    reviewRows,
    orderSyncLogs,
    safeSyncParityLogs,
  });
}

function rowFor(result, number) {
  return result.rows.find(row => orderNumber(row.canonical_order_number) === orderNumber(number));
}

function loadEntryHandler({ env = {}, hubData = null } = {}) {
  let source = entrySource.replace(/^import .*$/gm, '');
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
    fetch: async () => new Response(JSON.stringify(hubData || { success: true, delivery_date: DELIVERY_DATE, sections: { delivery_stops: [], completed: [] } }), { status: 200 }),
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: entryPath });
  return context.globalThis.__handler;
}

function base44Fake({ tasks = [], nativeOrders = [], orders = [] } = {}) {
  const reads = [];
  const writes = [];
  const api = (name, rows) => ({
    list: async (_sort, limit = 100) => { reads.push(name); return rows.slice(0, limit); },
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
          FulfillmentTask: api('FulfillmentTask', tasks),
          ShopifyOrder: api('ShopifyOrder', nativeOrders),
          Order: api('Order', orders),
          OrderReviewQueue: api('OrderReviewQueue', []),
          OrderSyncLog: api('OrderSyncLog', []),
          SafeSyncParityLog: api('SafeSyncParityLog', []),
        },
      },
    },
  };
}

async function invokeDisabled() {
  const store = base44Fake({ tasks: [task()], nativeOrders: [nativeOrder()], orders: [baseOrder()] });
  const handler = loadEntryHandler({ env: {}, hubData: { success: true, delivery_date: DELIVERY_DATE, sections: { delivery_stops: [], completed: [] } } });
  const response = await handler({ __base44: store.base44, json: async () => ({ delivery_date: DELIVERY_DATE, limit: 100, read_model_mode: 'DELIVERY_LIFECYCLE' }) });
  return { status: response.status, payload: await response.json(), reads: store.reads, writes: store.writes };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. Function-local helper is inside the function directory', () => {
  assert.equal(path.dirname(helperPath), functionDir);
  assert.ok(fs.existsSync(helperPath));
});
test('2. Named-function payload includes the helper', () => {
  assert.match(entrySource, /\.\/deliveryLifecycleReadModel\.js/);
  assert.match(helperSource, /g48d_delivery_lifecycle_v1/);
});
test('3. Helper performs no reads/writes/provider calls', () => {
  assert.doesNotMatch(helperSource, /base44\.|createClientFromRequest|fetch\s*\(|entities\.|asServiceRole|\.create\s*\(|\.update\s*\(|\.delete\s*\(|bulkCreate|updateMany|deleteMany|Stripe\.|shopify\.|HUB_API_URL|Notification\./);
});
test('4. Existing route-summary response remains unchanged when disabled', async () => {
  const result = await invokeDisabled();
  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  assert.equal(result.payload.delivery_lifecycle_read_model_available, true);
  assert.equal(result.payload.delivery_lifecycle_read_model_enabled, false);
  assert.equal(result.payload.delivery_lifecycle_read_model, undefined);
  assert.deepEqual(result.reads.sort(), ['FulfillmentTask', 'Order', 'ShopifyOrder'].sort());
  assert.equal(result.writes.length, 0);
});
test('5. Existing date/range filtering remains unchanged', () => {
  assert.match(entrySource, /parseIsoDate\(body\.delivery_date \|\| body\.date, 'delivery_date'\)/);
  assert.match(entrySource, /normalizeLimit\(body\.limit\)/);
});
test('6. Exact Order/native-order/task linkage works', () => {
  const result = model();
  const row = rowFor(result, 'NV-CLEAN');
  assert.equal(row.exact_identity_ready, true);
  assert.equal(row.native_read_ready, true);
  assert.equal(row.classification, 'delivery_lifecycle_native_read_ready');
});
test('7. Duplicate native order blocks native readiness', () => {
  const result = model({ nativeOrders: [nativeOrder(), { ...nativeOrder(), id: 'native_dup' }] });
  const row = rowFor(result, 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_duplicate_identity_risk/);
});
test('8. Duplicate/conflicting task blocks native readiness', () => {
  const result = model({ tasks: [task(), { ...task(), id: 'task_dup' }] });
  const row = rowFor(result, 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_duplicate_identity_risk/);
});
test('9. Missing native order preserves fallback', () => {
  const row = rowFor(model({ nativeOrders: [] }), 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_native_order_missing/);
  assert.equal(row.fallback_required, true);
});
test('10. Missing task preserves fallback', () => {
  const row = rowFor(model({ tasks: [] }), 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_task_missing/);
});
test('11. Delivery schedule match is represented correctly', () => {
  const row = rowFor(model(), 'NV-CLEAN');
  assert.equal(row.schedule_match, true);
  assert.equal(row.canonical_delivery_date, DELIVERY_DATE);
});
test('12. Delivery schedule mismatch holds', () => {
  const row = rowFor(model({ tasks: [task({ delivery_date: '2026-06-23' })] }), 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_schedule_mismatch/);
  assert.match(row.mismatch_categories.join('|'), /delivery_schedule_mismatch/);
});
test('13. Status mismatch holds', () => {
  const row = rowFor(model({ orders: [baseOrder({ delivery_status: 'delivered', fulfillment_status: 'delivered' })], tasks: [task({ status: 'out_for_delivery', delivery_status: 'out_for_delivery' })] }), 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_status_mismatch/);
});
test('14. Pending-payment order holds', () => {
  const row = rowFor(model({ orders: [baseOrder({ payment_status: 'pending', financial_status: 'pending', payment_captured: false })] }), 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_payment_hold/);
});
test('15. Refunded/cancelled order holds', () => {
  const refunded = rowFor(model({ orders: [baseOrder({ refund_status: 'fully_refunded' })] }), 'NV-CLEAN');
  const cancelled = rowFor(model({ orders: [baseOrder({ status: 'cancelled', canceled_at: '2026-06-22T00:00:00Z' })] }), 'NV-CLEAN');
  assert.match(refunded.blockers.join('|'), /delivery_lifecycle_refund_cancel_hold/);
  assert.match(cancelled.blockers.join('|'), /delivery_lifecycle_refund_cancel_hold/);
});
test('16. Subscription/multi-delivery holds', () => {
  const row = rowFor(model({ orders: [baseOrder({ source_type: 'subscription_occurrence', customer_app_subscription_id: 'sub_1' })] }), 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_subscription_multi_delivery_hold/);
});
test('17. Review queue holds', () => {
  const row = rowFor(model({ reviewRows: [{ existing_order_id: 'order_NV-CLEAN', status: 'pending' }] }), 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_review_queue_hold/);
});
test('18. Repair/replay holds', () => {
  const row = rowFor(model({ orderSyncLogs: [{ order_number: 'NV-CLEAN', status: 'error' }] }), 'NV-CLEAN');
  assert.match(row.blockers.join('|'), /delivery_lifecycle_repair_replay_hold/);
});
test('19. Unassigned state is represented safely', () => {
  const row = rowFor(model(), 'NV-CLEAN');
  assert.equal(row.driver_assignment_present, false);
  assert.match(row.warnings.join('|'), /delivery_lifecycle_driver_assignment_missing/);
});
test('20. Assigned/no-route state is represented safely', () => {
  const row = rowFor(model({ tasks: [task({ assigned_driver: 'Driver One' })], stops: [stop({ assigned_driver: 'Driver One' })] }), 'NV-CLEAN');
  assert.equal(row.driver_assignment_present, true);
  assert.equal(row.route_context_present, false);
});
test('21. Route-linked state is represented safely', () => {
  const row = rowFor(model({ tasks: [task({ assigned_driver: 'Driver One', route_id: 'route_1', route_stop_sequence: 1 })] }), 'NV-CLEAN');
  assert.equal(row.route_context_present, true);
  assert.equal(row.route_sequence_present, true);
});
test('22. Out-for-delivery state is represented safely', () => {
  const row = rowFor(model({ tasks: [task({ status: 'out_for_delivery', delivery_status: 'out_for_delivery', assigned_driver: 'Driver One' })], stops: [stop({ task_status: 'out_for_delivery', delivery_status: 'out_for_delivery', assigned_driver: 'Driver One' })] }), 'NV-CLEAN');
  assert.equal(row.delivery_status, 'out_for_delivery');
});
test('23. Delivered state is represented safely', () => {
  const row = rowFor(model({ tasks: [task({ status: 'delivered', delivery_status: 'delivered' })], stops: [stop({ task_status: 'delivered', delivery_status: 'delivered' })] }), 'NV-CLEAN');
  assert.equal(row.classification, 'delivery_lifecycle_already_completed');
});
test('23b. Hub completed route context counts as delivered even when native task lags', () => {
  const result = model({
    tasks: [task({ status: 'scheduled', delivery_status: 'pending' })],
    stops: [stop({ task_status: 'Completed', delivery_status: 'delivered', data_source: 'native_with_hub_completed_context', hub_fallback_used: true })],
  });
  const row = rowFor(result, 'NV-CLEAN');
  assert.equal(row.delivery_status, 'delivered');
  assert.equal(row.production_status, 'delivered');
  assert.equal(result.summary.delivered_count, 1);
  assert.equal(row.review_required, false);
});
test('23c. Route summary completed duplicate maps stale native production to delivered when Hub omits production status', async () => {
  const store = base44Fake({
    tasks: [task({
      status: 'delivered',
      delivery_status: 'delivered',
      production_status: 'awaiting_production',
      delivery_window_label: '5 PM - 8 PM',
      delivery_address: '619 N Main St, O Fallon, MO',
      items_summary: '1x Hydration Program (3-Day)',
    })],
    nativeOrders: [nativeOrder({
      fulfillment_status: 'pending',
      production_status: 'awaiting_production',
    })],
    orders: [baseOrder({
      status: 'delivered',
      delivery_status: 'delivered',
      fulfillment_status: 'delivered',
    })],
  });
  const handler = loadEntryHandler({
    env: {
      HUB_API_URL: 'https://hub.example',
      CUSTOMER_APP_SYNC_SECRET: 'secret',
    },
    hubData: {
      success: true,
      delivery_date: DELIVERY_DATE,
      sections: {
        delivery_stops: [],
        completed: [stop({
          task_id: 'hub_task_NV-CLEAN',
          order_number: 'NV-CLEAN',
          task_status: 'Completed',
          delivery_status: 'delivered',
          fulfillment_status: 'delivered',
          delivery_window_label: '5 PM - 8 PM',
          delivery_address: '619 N Main St, O Fallon, MO',
          items_summary: '9x OASIS, 3x AURA',
          data_source: 'hub',
        })],
      },
    },
  });
  const response = await handler({ __base44: store.base44, json: async () => ({ delivery_date: DELIVERY_DATE, limit: 100 }) });
  const payload = await response.json();
  const row = payload.sections.completed.find(item => orderNumber(item.order_number) === 'NV-CLEAN');
  assert.equal(response.status, 200);
  assert.equal(row.production_status, 'delivered');
  assert.equal(row.fulfillment_status, 'delivered');
  assert.equal(row.items_summary, '9x OASIS, 3x AURA');
  assert.equal(row.data_source, 'native_with_hub_completed_context');
  assert.equal(row.hub_fallback_used, true);
  assert.match(row.warnings.join('|'), /hub_completed_state_used_for_native_duplicate/);
  assert.equal(store.writes.length, 0);
});
test('24. Hub-only valid row remains visible through fallback', () => {
  const result = model({ orders: [], nativeOrders: [], tasks: [], stops: [stop({ order_number: 'NV-HUBONLY', customer_app_order_id: null, task_id: 'hub_task', data_source: 'hub_fallback', hub_fallback_used: true })] });
  const row = rowFor(result, 'NV-HUBONLY');
  assert.equal(row.fallback_required, true);
  assert.equal(row.classification, 'delivery_lifecycle_order_chain_missing');
});
test('25. Admin page uses canonical backend data only when enabled', () => {
  assert.match(uiSource, /hasValidDeliveryLifecycleReadModel/);
  assert.match(uiSource, /delivery_lifecycle_read_model_enabled === true/);
  assert.match(uiSource, /DELIVERY_LIFECYCLE_READ_MODEL_VERSION/);
});
test('26. Admin page preserves current behavior when disabled', () => {
  assert.match(uiSource, /const deliveryLifecycleReadModel = hasValidDeliveryLifecycleReadModel\(data\) \? data\.delivery_lifecycle_read_model : null/);
});
test('27. Backend failure preserves fallback', () => {
  assert.match(uiSource, /isError/);
  assert.match(entrySource, /hub_delivery_summary_unavailable_or_unconfigured/);
});
test('28. Unsupported version preserves fallback', () => {
  assert.match(uiSource, /data\?\.delivery_lifecycle_read_model_version === DELIVERY_LIFECYCLE_READ_MODEL_VERSION/);
  assert.match(uiSource, /model\?\.read_model_version === DELIVERY_LIFECYCLE_READ_MODEL_VERSION/);
});
test('29. No frontend Vite gate is required', () => {
  assert.doesNotMatch(uiSource, /VITE_ENABLE_ADMIN_DELIVERY_LIFECYCLE_READ_MODEL|import\.meta\.env/);
});
test('30. No query/localStorage/browser-global activation path exists', () => {
  const gateSegment = uiSource.slice(uiSource.indexOf('hasValidDeliveryLifecycleReadModel'), uiSource.indexOf('function isNativeDeliveryStop'));
  assert.doesNotMatch(gateSegment, /searchParams|URLSearchParams|localStorage|sessionStorage|window\./);
});
test('31. Existing delivery write functions are untouched by expected scope', () => {
  const changed = (process.env.G48D_CHANGED_FILES || '').split(/\s+/).filter(Boolean);
  const forbidden = changed.filter(file => /updateAdminFulfillmentTaskAssignment|markAdminFulfillmentTaskOutForDelivery|recordAdminFulfillmentTaskDelivered|executeNativeFulfillmentTaskLifecycle|optimizeDeliveryRoute|CustomerOrderStatus|DeliveryCompletion|Notification/.test(file));
  assert.deepEqual(forbidden, []);
});
test('32. No driver assignment', () => assert.match(entrySource, /driver_assignment_write_ready: false/));
test('33. No route mutation', () => assert.match(entrySource, /route_mutation_ready: false/));
test('34. No delivery status update', () => assert.match(entrySource, /out_for_delivery_write_ready: false/));
test('35. No Shopify/Hub/provider call expansion', () => {
  assert.match(entrySource, /shopify_fulfillment_write_ready: false/);
  assert.match(entrySource, /hub_write_suppression_ready: false/);
  assert.match(entrySource, /provider_call_impact: false/);
});
test('36. No notifications', () => assert.match(entrySource, /notification_expansion_ready: false/));
test('37. No customer tracker/status mutation', () => assert.match(entrySource, /customer_status_write_ready: false/));
test('38. No entity writes', () => {
  assert.doesNotMatch(helperSource, /\.create\s*\(|\.update\s*\(|\.delete\s*\(|bulkCreate|updateMany|deleteMany/);
});
test('39. No raw payload exposure', () => {
  for (const source of [entrySource, helperSource, uiSource]) assert.doesNotMatch(source, /raw_payload|provider_payload|payment_payload/);
});
test('40. No PII expansion', () => {
  assert.doesNotMatch(helperSource, /customer_email|customer_phone|delivery_address|address_line1|address_postal_code/);
});
test('41. Existing G39D regression file still targets route summary', () => {
  const g39d = fs.readFileSync(g39dHarnessPath, 'utf8');
  assert.match(g39d, /getAdminDeliveryRouteSummary/);
});
test('42. Existing G42B regression docs remain present', () => {
  const docs = fs.readFileSync(g42bDocsPath, 'utf8');
  assert.match(docs, /admin_delivery_action_readiness_no_clean_command_candidates|No route optimization\/provider call|No Hub mutation/);
});
test('docs. G48D migration doc exists', () => {
  const docs = fs.readFileSync(docsPath, 'utf8');
  assert.match(docs, /getAdminDeliveryRouteSummary owns/);
  assert.match(docs, /Backend-authoritative activation/);
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try {
    await item.fn();
    passed += 1;
  } catch (error) {
    failures.push({ name: item.name, error: error.message });
  }
}

const result = {
  success: failures.length === 0,
  passed,
  failed: failures.length,
  failures,
  classification: failures.length === 0 ? 'delivery_lifecycle_read_model_consolidation_pr_ready' : 'hard_stop_delivery_lifecycle_read_model_behavior_regression',
  writes_performed: false,
  provider_call_impact: false,
  shopify_calls: false,
  hub_mutation_performed: false,
  route_provider_calls: false,
  notifications_sent: false,
  customer_status_mutation_performed: false,
  delivery_status_updated: false,
  route_mutation_performed: false,
  driver_assignment_performed: false,
  pii_returned: false,
  raw_payloads_returned: false,
};
console.log(JSON.stringify(result, null, 2));
if (!result.success) process.exit(1);
