#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');

function loadHarness({ env = {} } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { buildG35BPreview };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, source };
}

const TARGET = {
  orderNumber: 'NV-MPZNKGNT',
  customerOrderId: '6a219a3f4adcda5856c3d579',
  nativeOrderId: '6a22ffda400eb806eb3ca945',
  taskId: '6a22ffdaf675ea79e30575aa',
};

const PRODUCTS = ['Aura', 'Oasis', 'Pineapple Juice', 'Radiance Shot', 'Re-Nu', 'Reset Shot'];

function makeOrder(overrides = {}) {
  return {
    id: TARGET.customerOrderId,
    order_number: TARGET.orderNumber,
    status: 'delivered',
    payment_status: 'paid',
    financial_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    items: [{ name: 'The NuVira Trio', quantity: 1 }],
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: TARGET.nativeOrderId,
    base44_order_id: TARGET.customerOrderId,
    shopify_order_number: TARGET.orderNumber,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    fulfillment_method: 'delivery',
    source_type: 'customer_app_native_mirror',
    production_status: 'bottled',
    fulfillment_status: 'fulfilled',
    payment_status: 'paid',
    financial_status: 'paid',
    line_items: [{ title: 'The NuVira Trio', quantity: 1 }],
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: TARGET.taskId,
    base44_order_id: TARGET.customerOrderId,
    order_id: TARGET.customerOrderId,
    native_shopify_order_id: TARGET.nativeOrderId,
    shopify_order_id: TARGET.nativeOrderId,
    order_number: TARGET.orderNumber,
    shopify_order_number: TARGET.orderNumber,
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    status: 'delivered',
    delivery_status: 'delivered',
    ...overrides,
  };
}

function makeBatch(index, overrides = {}) {
  const product = PRODUCTS[index];
  return {
    id: `pb_${index + 1}`,
    batch_id: `NATIVE-${TARGET.orderNumber}-2026-06-07-${product.toUpperCase().replace(/\s+/g, '-')}`,
    product_name: product,
    production_date: '2026-06-07',
    status: 'verified_logged',
    planned_units: 1,
    compliance_log_id: `cl_${index + 1}`,
    order_sources: [{ order_id: TARGET.customerOrderId, order_number: TARGET.orderNumber, quantity: 1 }],
    ...overrides,
  };
}

function makeComplianceLog(index, overrides = {}) {
  const product = PRODUCTS[index];
  return {
    id: `cl_${index + 1}`,
    batch_id: `NATIVE-${TARGET.orderNumber}-2026-06-07-${product.toUpperCase().replace(/\s+/g, '-')}`,
    source_production_batch_id: `pb_${index + 1}`,
    date: '2026-06-07',
    juice_flavor: product,
    locked: true,
    status: 'verified_logged',
    ...overrides,
  };
}

function makeStore({
  user = { role: 'admin', email: 'owner_admin' },
  orders = [makeOrder()],
  nativeOrders = [makeNativeOrder()],
  tasks = [makeTask()],
  batches = [],
  complianceLogs = [],
  orderSyncLogs = [],
  reviewRows = [],
  commandLogs = [],
  parityLogs = [],
} = {}) {
  const store = { orders, nativeOrders, tasks, batches, complianceLogs, orderSyncLogs, reviewRows, commandLogs, parityLogs, writes: [] };
  const rowsFor = name => ({ Order: store.orders, ShopifyOrder: store.nativeOrders, FulfillmentTask: store.tasks, ProductionBatch: store.batches, BatchComplianceLog: store.complianceLogs, OrderSyncLog: store.orderSyncLogs, OrderReviewQueue: store.reviewRows, CommandLog: store.commandLogs, SafeSyncParityLog: store.parityLogs }[name] || []);
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
      auth: { me: async () => { if (user instanceof Error) throw user; return user; } },
      asServiceRole: { entities: { Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog') } },
    },
  };
}

async function previewFor(scenario, body = {}) {
  return fns.buildG35BPreview(scenario.base44, {
    preview_mode: 'NATIVE_REFUND_IMPACT',
    order_number: TARGET.orderNumber,
    refund_type: 'full',
    event_source: 'test_fixture',
    request_id: 'g35d_test',
    ...body,
  });
}

const { exports: fns, source } = loadHarness({ env: { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' } });

const linkedBatches = [
  makeBatch(0, { compliance_log_id: 'cl_1', order_sources: [{ order_number: TARGET.orderNumber, quantity: 1 }] }),
  makeBatch(1, { compliance_log_id: '', order_sources: [{ source_order_number: TARGET.orderNumber, quantity: 1 }] }),
  makeBatch(2, { compliance_log_id: '', native_shopify_order_id: TARGET.nativeOrderId, order_sources: [] }),
  makeBatch(3, { compliance_log_id: '', base44_order_id: TARGET.customerOrderId, order_sources: [] }),
  makeBatch(4, { compliance_log_id: '', order_sources: [] }),
  makeBatch(5, { compliance_log_id: '', native_fulfillment_task_id: TARGET.taskId, order_sources: [] }),
];
const linkedComplianceLogs = [
  makeComplianceLog(0, { id: 'cl_1', batch_id: 'unmatched-direct-via-compliance-log-id', source_production_batch_id: '' }),
  makeComplianceLog(1, { id: 'cl_2', source_production_batch_id: 'pb_2', batch_id: 'unmatched-source-production-batch-id' }),
  makeComplianceLog(2, { id: 'cl_3', source_production_batch_id: '', batch_id: linkedBatches[2].batch_id }),
  makeComplianceLog(3, { id: 'cl_4', source_production_batch_id: 'pb_4', batch_id: 'unmatched-source-production-batch-id-2' }),
  makeComplianceLog(4, { id: 'cl_5', source_production_batch_id: '', batch_id: linkedBatches[4].batch_id }),
  makeComplianceLog(5, { id: 'cl_6', source_production_batch_id: '', batch_id: '', date: '2026-06-07', juice_flavor: PRODUCTS[5] }),
];

let scenario = makeStore({ batches: linkedBatches, complianceLogs: linkedComplianceLogs });
let preview = await previewFor(scenario);
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.lifecycle_state, 'delivered');
assert.equal(preview.lifecycle_risk_level, 'do_not_auto_cancel');
assert.equal(preview.next_action, 'delivered_refund_manual_review_required');
assert.equal(preview.production_batch_count, 6);
assert.equal(preview.verified_logged_batch_count, 6);
assert.equal(preview.batch_compliance_log_count, 6);
assert.equal(preview.locked_compliance_log_count, 6);
assert.equal(preview.production_batch_mutation_proposed, false);
assert.equal(preview.compliance_log_mutation_proposed, false);
assert.equal(preview.proposed_production_batch_impact.production_batch_count, 6);
assert.equal(preview.proposed_production_batch_impact.verified_logged_batch_count, 6);
assert.equal(preview.proposed_production_batch_impact.batch_compliance_log_count, 6);
assert.equal(preview.proposed_production_batch_impact.locked_compliance_log_count, 6);
assert.equal(preview.proposed_production_batch_impact.production_batch_rows.length, 6);
assert.equal(preview.proposed_production_batch_impact.compliance_log_rows.length, 6);
assert.equal(preview.proposed_production_batch_impact.production_batch_impact_classification, 'delivered_refund_manual_review_required_with_verified_batches');
assert.equal(preview.proposed_production_batch_impact.compliance_history_preserved, true);
assert.equal(preview.proposed_production_batch_impact.compliance_history_mutation_proposed, false);
assert.equal(preview.proposed_production_batch_impact.would_remove_order_sources, false);
assert.equal(preview.proposed_production_batch_impact.would_recalculate_planned_units, false);
assert.equal(preview.proposed_production_batch_impact.would_archive_batches, false);
assert.equal(preview.proposed_production_batch_impact.mutation_proposed, false);
assert.equal(preview.proposed_production_batch_impact.deletion_proposed, false);
assert.ok(preview.proposed_production_batch_impact.batch_linkage_method.includes('order_sources'));
assert.ok(preview.proposed_production_batch_impact.batch_linkage_method.includes('native_shopify_order_id'));
assert.ok(preview.proposed_production_batch_impact.batch_linkage_method.includes('customer_app_order_id'));
assert.ok(preview.proposed_production_batch_impact.batch_linkage_method.includes('deterministic_native_batch_id'));
assert.ok(preview.proposed_production_batch_impact.batch_linkage_method.includes('native_fulfillment_task_id'));
assert.ok(preview.proposed_production_batch_impact.compliance_linkage_method.includes('production_batch_compliance_log_id'));
assert.ok(preview.proposed_production_batch_impact.compliance_linkage_method.includes('source_production_batch_id'));
assert.ok(preview.proposed_production_batch_impact.compliance_linkage_method.includes('batch_id'));
assert.ok(preview.proposed_production_batch_impact.compliance_linkage_method.includes('product_name_production_date_supporting_context'));
assert.ok(preview.warnings.includes('verified_production_history_preserved'));
assert.ok(preview.warnings.includes('locked_compliance_logs_preserved'));
assert.ok(preview.warnings.includes('delivered_refund_manual_review_required'));
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ batches: [], complianceLogs: [] });
preview = await previewFor(scenario);
assert.equal(preview.production_batch_count, 0);
assert.equal(preview.batch_compliance_log_count, 0);
assert.equal(preview.proposed_production_batch_impact.production_batch_impact_classification, 'not_applicable_no_production_batches');
assert.equal(preview.proposed_production_batch_impact.proposed_action, 'none_no_batches_found');
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({
  batches: [makeBatch(0, {
    id: 'pb_unrelated_date_only',
    batch_id: 'NATIVE-OTHER-2026-06-07-AURA',
    order_number: 'OTHER',
    base44_order_id: 'other_order',
    native_shopify_order_id: 'other_native',
    native_fulfillment_task_id: 'other_task',
    order_sources: [{ order_number: 'OTHER', quantity: 1 }],
  })],
  complianceLogs: [makeComplianceLog(0, { id: 'cl_unrelated_date_only', source_production_batch_id: 'pb_unrelated_date_only' })],
});
preview = await previewFor(scenario);
assert.equal(preview.production_batch_count, 0);
assert.equal(preview.batch_compliance_log_count, 0);
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({
  batches: [makeBatch(0, {
    id: 'pb_pii_only',
    batch_id: 'BATCH-PII-ONLY',
    order_number: '',
    base44_order_id: '',
    native_shopify_order_id: '',
    native_fulfillment_task_id: '',
    order_sources: [{ customer_email: 'hidden@example.invalid', customer_name: 'Hidden Customer', quantity: 1 }],
  })],
  complianceLogs: [],
});
preview = await previewFor(scenario);
assert.equal(preview.production_batch_count, 0);
assert.equal(preview.batch_compliance_log_count, 0);
assert.equal(scenario.store.writes.length, 0);

assert.ok(!/g35dBatchMatchInfo[\s\S]*customer_email/.test(source));
assert.ok(!/g35dBatchMatchInfo[\s\S]*customer_name/.test(source));
assert.ok(!/stripe\.refunds\.create|new Stripe\(|Shopify\(|PurchaseOrder\.create|sendOrderStatusNotification|syncRefundToHub|repairRefundedOrder/.test(source));

console.log('G35D refund batch/compliance linkage tests passed');
