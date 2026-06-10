#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixturePath = path.join(repoRoot, 'docs/migration/fixtures/refund-impact/fixtures.json');
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');

function loadHarness() {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { buildG35BPreview, G35B_READ_ONLY_SAFETY, G35B_STATUS_SCHEMA_COMPATIBILITY };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: () => '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, source };
}

function slug(value) {
  return String(value || 'SYN-UNKNOWN').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'syn_unknown';
}

function orderNumberFor(fixture) {
  return fixture.request?.order_number || `SYN-${fixture.name.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
}

function deepMerge(base, override) {
  if (override === false || override === null) return override;
  if (override === true || override === undefined) return { ...(base || {}) };
  if (Array.isArray(override)) return override;
  if (typeof override !== 'object') return override;
  const out = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object' && !Array.isArray(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function makeCustomerOrder(fixture, defaults) {
  const state = fixture.state || {};
  if (!state.customer_order) return null;
  const orderNumber = orderNumberFor(fixture);
  const id = `order_${slug(orderNumber)}`;
  return {
    id,
    order_number: orderNumber,
    ...deepMerge(defaults.customer_order, state.customer_order),
  };
}

function makeNativeOrder(fixture, defaults, customerOrder) {
  const state = fixture.state || {};
  if (!state.native_order) return null;
  const orderNumber = orderNumberFor(fixture);
  const id = `native_${slug(orderNumber)}`;
  return {
    id,
    base44_order_id: customerOrder?.id || `order_${slug(orderNumber)}`,
    shopify_order_number: orderNumber,
    ...deepMerge(defaults.native_order, state.native_order),
  };
}

function makeTask(fixture, defaults, customerOrder, nativeOrder) {
  const state = fixture.state || {};
  if (!state.fulfillment_task) return null;
  const orderNumber = orderNumberFor(fixture);
  const id = `task_${slug(orderNumber)}`;
  return {
    id,
    base44_order_id: customerOrder?.id || `order_${slug(orderNumber)}`,
    order_id: customerOrder?.id || `order_${slug(orderNumber)}`,
    native_shopify_order_id: nativeOrder?.id || `native_${slug(orderNumber)}`,
    shopify_order_id: nativeOrder?.id || `native_${slug(orderNumber)}`,
    order_number: orderNumber,
    shopify_order_number: orderNumber,
    ...deepMerge(defaults.fulfillment_task, state.fulfillment_task),
  };
}

function makeBatches(fixture, defaults, customerOrder, nativeOrder, task) {
  const orderNumber = orderNumberFor(fixture);
  const rows = fixture.state?.production_batches || [];
  return rows.map((rawOverride, index) => {
    const override = { ...(rawOverride || {}) };
    const generatedComplianceLogId = override.compliance_log_id === 'auto' ? `cl_${slug(orderNumber)}_${index + 1}` : override.compliance_log_id;
    if (override.compliance_log_id === 'auto') delete override.compliance_log_id;
    const product = override.product_name || defaults.production_batch.product_name || `Synthetic Product ${index + 1}`;
    const batchId = `NATIVE-${orderNumber}-${index + 1}-${String(product).toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`;
    const base = {
      id: `pb_${slug(orderNumber)}_${index + 1}`,
      batch_id: batchId,
      compliance_log_id: generatedComplianceLogId,
      base44_order_id: customerOrder?.id || `order_${slug(orderNumber)}`,
      native_shopify_order_id: nativeOrder?.id || `native_${slug(orderNumber)}`,
      native_fulfillment_task_id: task?.id || `task_${slug(orderNumber)}`,
      order_number: orderNumber,
      order_sources: [{ order_id: customerOrder?.id || `order_${slug(orderNumber)}`, order_number: orderNumber, quantity: 1 }],
      ...defaults.production_batch,
    };
    return deepMerge(base, override);
  });
}

function makeComplianceLogs(fixture, defaults, batches) {
  const rows = fixture.state?.compliance_logs || [];
  return rows.map((override, index) => {
    const batch = batches[index] || batches[0] || {};
    const base = {
      id: batch.compliance_log_id || `cl_${slug(orderNumberFor(fixture))}_${index + 1}`,
      batch_id: batch.batch_id || `BATCH-${index + 1}`,
      source_production_batch_id: batch.id || '',
      ...defaults.compliance_log,
    };
    return deepMerge(base, override);
  });
}

function makeStore({ orders, nativeOrders, tasks, batches, complianceLogs, orderSyncLogs = [], reviewRows = [], commandLogs = [], parityLogs = [] }) {
  const store = { orders, nativeOrders, tasks, batches, complianceLogs, orderSyncLogs, reviewRows, commandLogs, parityLogs, writes: [] };
  const rowsFor = name => ({
    Order: store.orders,
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.tasks,
    ProductionBatch: store.batches,
    BatchComplianceLog: store.complianceLogs,
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
      auth: { me: async () => ({ role: 'admin', email: 'synthetic_owner_admin' }) },
      asServiceRole: { entities: {
        Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'),
        ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'),
        OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'),
      } },
    },
  };
}

function buildScenario(fixture, defaults) {
  const customerOrder = makeCustomerOrder(fixture, defaults);
  const nativeOrder = makeNativeOrder(fixture, defaults, customerOrder);
  const task = makeTask(fixture, defaults, customerOrder, nativeOrder);
  const batches = makeBatches(fixture, defaults, customerOrder, nativeOrder, task);
  const complianceLogs = makeComplianceLogs(fixture, defaults, batches);
  return makeStore({
    orders: customerOrder ? [customerOrder] : [],
    nativeOrders: nativeOrder ? [nativeOrder] : [],
    tasks: task ? [task] : [],
    batches,
    complianceLogs,
    orderSyncLogs: fixture.state?.order_sync_logs || [],
    reviewRows: fixture.state?.review_rows || [],
    commandLogs: fixture.state?.command_logs || [],
    parityLogs: fixture.state?.parity_logs || [],
  });
}

function assertIncludes(actual, expected, label, fixtureName) {
  for (const item of expected || []) {
    assert.ok((actual || []).includes(item), `${fixtureName}: expected ${label} to include ${item}; got ${JSON.stringify(actual)}`);
  }
}

function assertExpected(fixture, preview, store) {
  const e = fixture.expected || {};
  const name = fixture.name;
  const checks = [
    ['success', preview.success],
    ['order_found', preview.order_found],
    ['lifecycle_state', preview.lifecycle_state],
    ['lifecycle_risk_level', preview.lifecycle_risk_level],
    ['next_action', preview.next_action],
    ['production_batch_count', preview.production_batch_count],
    ['verified_logged_batch_count', preview.verified_logged_batch_count],
    ['batch_compliance_log_count', preview.batch_compliance_log_count],
    ['locked_compliance_log_count', preview.locked_compliance_log_count],
    ['production_batch_mutation_proposed', preview.production_batch_mutation_proposed],
    ['compliance_log_mutation_proposed', preview.compliance_log_mutation_proposed],
    ['provider_call_impact', preview.provider_call_impact],
  ];
  for (const [key, actual] of checks) {
    if (Object.hasOwn(e, key)) assert.deepEqual(actual, e[key], `${name}: expected ${key}`);
  }
  if (Object.hasOwn(e, 'native_order_present')) assert.equal(preview.native_shopify_order_present, e.native_order_present, `${name}: native_order_present`);
  if (Object.hasOwn(e, 'task_present')) assert.equal(preview.native_fulfillment_task_present, e.task_present, `${name}: task_present`);
  if (Object.hasOwn(e, 'native_order_proposed_payment_status')) assert.equal(preview.proposed_native_shopify_order_impact?.proposed_payment_status, e.native_order_proposed_payment_status, `${name}: native payment impact`);
  if (Object.hasOwn(e, 'native_order_proposed_production_status')) assert.equal(preview.proposed_native_shopify_order_impact?.proposed_production_status, e.native_order_proposed_production_status, `${name}: native production impact`);
  if (Object.hasOwn(e, 'native_order_action')) assert.equal(preview.proposed_native_shopify_order_impact?.proposed_action, e.native_order_action, `${name}: native order action`);
  if (Object.hasOwn(e, 'task_proposed_action')) assert.equal(preview.proposed_fulfillment_task_impact?.proposed_action, e.task_proposed_action, `${name}: task action`);
  if (Object.hasOwn(e, 'would_cancel_task')) assert.equal(preview.proposed_fulfillment_task_impact?.would_cancel_task, e.would_cancel_task, `${name}: would cancel task`);
  if (Object.hasOwn(e, 'batch_action')) assert.equal(preview.proposed_production_batch_impact?.proposed_action, e.batch_action, `${name}: batch action`);
  if (Object.hasOwn(e, 'would_remove_order_sources_now')) assert.equal(preview.proposed_production_batch_impact?.would_remove_order_sources_now, e.would_remove_order_sources_now, `${name}: remove order sources now`);
  if (Object.hasOwn(e, 'would_recalculate_planned_units_now')) assert.equal(preview.proposed_production_batch_impact?.would_recalculate_planned_units_now, e.would_recalculate_planned_units_now, `${name}: recalc units now`);
  if (Object.hasOwn(e, 'review_queue_incident_type')) assert.equal(preview.proposed_order_review_queue_impact?.incident_type, e.review_queue_incident_type, `${name}: review queue incident`);
  if (Object.hasOwn(e, 'duplicate_event_detected')) assert.equal(preview.idempotency_status?.duplicate_event_detected, e.duplicate_event_detected, `${name}: duplicate event`);
  if (Object.hasOwn(e, 'future_command_should')) assert.equal(preview.idempotency_status?.future_command_should, e.future_command_should, `${name}: future command should`);
  if (Object.hasOwn(e, 'order_sync_log_match_count')) assert.equal(preview.idempotency_status?.order_sync_log_match_count, e.order_sync_log_match_count, `${name}: sync log count`);
  if (Object.hasOwn(e, 'stripe_event_id_present')) assert.equal(preview.idempotency_status?.stripe_event_id_present, e.stripe_event_id_present, `${name}: stripe event present`);
  if (Object.hasOwn(e, 'customer_order_status_refund_value_supported')) assert.equal(preview.status_schema_compatibility?.customer_order_status_refund_value_supported, e.customer_order_status_refund_value_supported, `${name}: refund status supported`);
  if (Object.hasOwn(e, 'customer_order_cancelled_value_supported')) assert.equal(preview.status_schema_compatibility?.customer_order_cancelled_value_supported, e.customer_order_cancelled_value_supported, `${name}: cancelled status supported`);
  if (Object.hasOwn(e, 'customer_proposed_status')) assert.equal(preview.proposed_customer_app_order_impact?.proposed_status, e.customer_proposed_status, `${name}: customer proposed status`);
  if (Object.hasOwn(e, 'customer_proposed_status_supported')) assert.equal(preview.proposed_customer_app_order_impact?.proposed_status_supported, e.customer_proposed_status_supported, `${name}: customer proposed status supported`);
  if (Object.hasOwn(e, 'customer_current_payment_status')) assert.equal(preview.proposed_customer_app_order_impact?.current_payment_status, e.customer_current_payment_status, `${name}: customer current payment`);
  if (Object.hasOwn(e, 'native_current_payment_status')) assert.equal(preview.proposed_native_shopify_order_impact?.current_payment_status, e.native_current_payment_status, `${name}: native current payment`);
  if (Object.hasOwn(e, 'compliance_history_preserved')) assert.equal(preview.proposed_production_batch_impact?.compliance_history_preserved, e.compliance_history_preserved, `${name}: compliance preserved`);
  if (Object.hasOwn(e, 'compliance_history_mutation_proposed')) assert.equal(preview.proposed_production_batch_impact?.compliance_history_mutation_proposed, e.compliance_history_mutation_proposed, `${name}: compliance mutation proposed`);
  if (Object.hasOwn(e, 'deletion_proposed')) assert.equal(preview.proposed_production_batch_impact?.deletion_proposed, e.deletion_proposed, `${name}: deletion proposed`);
  if (Object.hasOwn(e, 'inventory_deducted_or_restored')) assert.equal(preview.safety?.inventory_deducted_or_restored, e.inventory_deducted_or_restored, `${name}: inventory reversal`);
  if (Object.hasOwn(e, 'purchase_order_created_or_updated')) assert.equal(preview.safety?.purchase_order_created_or_updated, e.purchase_order_created_or_updated, `${name}: PO reversal`);

  assertIncludes(preview.blockers, e.blockers_include, 'blockers', name);
  assertIncludes(preview.warnings, e.warnings_include, 'warnings', name);

  assert.equal(preview.dry_run, true, `${name}: dry_run`);
  assert.equal(preview.writes_performed, false, `${name}: writes_performed`);
  assert.equal(preview.provider_call_impact, false, `${name}: provider calls`);
  assert.equal(preview.notification_impact?.notification_would_send, false, `${name}: notification send`);
  assert.equal(preview.notification_impact?.notification_held, true, `${name}: notification held`);
  assert.equal(preview.safety?.stripe_calls_performed, false, `${name}: Stripe calls`);
  assert.equal(preview.safety?.shopify_api_calls_performed, false, `${name}: Shopify calls`);
  assert.equal(preview.safety?.notifications_sent, false, `${name}: notification safety`);
  assert.equal(preview.safety?.order_review_queue_created, false, `${name}: no review queue create`);
  assert.equal(preview.safety?.order_sync_log_created, false, `${name}: no sync log create`);
  assert.equal(preview.safety?.command_log_created, false, `${name}: no command log create`);
  assert.equal(store.writes.length, 0, `${name}: no writes captured`);
}

function scanFixturesForUnsafeContent(raw) {
  const forbidden = [
    /sk_(?:live|test)_[A-Za-z0-9]+/,
    /rk_(?:live|test)_[A-Za-z0-9]+/,
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
    /\b(?:\+?1[-. ]?)?\(?[2-9][0-9]{2}\)?[-. ][0-9]{3}[-. ][0-9]{4}\b/,
    /"raw_payload"\s*:/i,
    /"raw_stripe_payload"\s*:/i,
    /"raw_shopify_payload"\s*:/i,
    /"shipping_address"\s*:/i,
    /"billing_address"\s*:/i,
  ];
  for (const pattern of forbidden) {
    assert.equal(pattern.test(raw), false, `fixture file contains unsafe pattern ${pattern}`);
  }
}

const raw = fs.readFileSync(fixturePath, 'utf8');
scanFixturesForUnsafeContent(raw);
const matrix = JSON.parse(raw);
assert.equal(matrix.fixture_policy?.synthetic_only, true);
assert.equal(matrix.fixture_policy?.native_refund_writes_approved, false);
assert.ok(Array.isArray(matrix.fixtures));
assert.equal(matrix.fixtures.length, 20);

const { exports: fns, source } = loadHarness();
assert.equal(fns.G35B_READ_ONLY_SAFETY.writes_performed, false);
assert.equal(fns.G35B_STATUS_SCHEMA_COMPATIBILITY.customer_order_status_refund_value_supported, false);

const summary = new Map();
const failures = [];
for (const fixture of matrix.fixtures) {
  try {
    const scenario = buildScenario(fixture, matrix.defaults);
    const request = { ...matrix.defaults.request, ...fixture.request };
    const preview = await fns.buildG35BPreview(scenario.base44, request);
    assertExpected(fixture, preview, scenario.store);
    const key = `${preview.lifecycle_state}|${preview.lifecycle_risk_level}|${preview.next_action}`;
    summary.set(key, (summary.get(key) || 0) + 1);
  } catch (error) {
    failures.push({ fixture: fixture.name, message: error?.stack || String(error) });
  }
}

assert.ok(!source.includes('stripe.refunds.create'), 'runtime preview must not create Stripe refunds');
assert.ok(!source.includes('new Stripe('), 'runtime preview must not instantiate Stripe');
assert.ok(!source.includes('PurchaseOrder.create'), 'runtime preview must not create PurchaseOrders');
assert.ok(!source.includes('sendOrderStatusNotification'), 'runtime preview must not send notifications');

if (failures.length) {
  console.error('G35F refund impact fixture failures:');
  for (const failure of failures) console.error(`- ${failure.fixture}: ${failure.message}`);
  process.exit(1);
}

console.log(JSON.stringify({
  success: true,
  fixture_count: matrix.fixtures.length,
  passed: matrix.fixtures.length,
  failed: 0,
  classification_summary: Object.fromEntries([...summary.entries()].sort()),
  writes_performed: false,
  provider_call_impact: false,
  notifications_held: true,
}, null, 2));
