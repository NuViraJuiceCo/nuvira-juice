#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');

const TARGET = {
  orderNumber: 'NV-MPZNKGNT',
  customerOrderId: '6a219a3f4adcda5856c3d579',
  nativeOrderId: '6a22ffda400eb806eb3ca945',
  taskId: '6a22ffdaf675ea79e30575aa',
};

function loadHarness({ env = {} } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { buildG35HPreview, buildG35BPreview, G35I_PREV1_EXACT_READ_FAST_PATH_MARKER, G35I_PREV1_EXACT_READ_LIST_LIMIT };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    setTimeout: callback => { callback(); return 0; },
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, source };
}

function makeOrder(overrides = {}) {
  return {
    id: TARGET.customerOrderId,
    order_number: TARGET.orderNumber,
    status: 'delivered',
    payment_status: 'paid',
    financial_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    items: [{ name: 'Synthetic Bundle', quantity: 1 }],
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: TARGET.nativeOrderId,
    base44_order_id: TARGET.customerOrderId,
    shopify_order_number: TARGET.orderNumber,
    order_type: 'one_time',
    source_type: 'customer_app_native_mirror',
    production_status: 'bottled',
    fulfillment_status: 'fulfilled',
    payment_status: 'paid',
    financial_status: 'paid',
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
    status: 'delivered',
    delivery_status: 'delivered',
    ...overrides,
  };
}

function makeBatch(index, overrides = {}) {
  return {
    id: `pb_prev1_${index + 1}`,
    batch_id: `NATIVE-${TARGET.orderNumber}-2026-06-07-SYNTHETIC-${index + 1}`,
    product_name: `Synthetic ${index + 1}`,
    production_date: '2026-06-07',
    status: 'verified_logged',
    planned_units: 1,
    compliance_log_id: `cl_prev1_${index + 1}`,
    order_sources: [{ order_id: TARGET.customerOrderId, order_number: TARGET.orderNumber, quantity: 1 }],
    ...overrides,
  };
}

function makeComplianceLog(index, overrides = {}) {
  return {
    id: `cl_prev1_${index + 1}`,
    batch_id: `NATIVE-${TARGET.orderNumber}-2026-06-07-SYNTHETIC-${index + 1}`,
    source_production_batch_id: `pb_prev1_${index + 1}`,
    date: '2026-06-07',
    juice_flavor: `Synthetic ${index + 1}`,
    locked: true,
    status: 'verified_logged',
    ...overrides,
  };
}

function makeStore({ emptyBatchListReadsBeforeReal = 0, emptyComplianceListReadsBeforeReal = 0 } = {}) {
  const store = {
    orders: [makeOrder()],
    nativeOrders: [makeNativeOrder()],
    tasks: [makeTask()],
    batches: Array.from({ length: 6 }, (_, index) => makeBatch(index)),
    complianceLogs: Array.from({ length: 6 }, (_, index) => makeComplianceLog(index)),
    orderSyncLogs: [],
    reviewRows: [],
    commandLogs: [],
    parityLogs: [],
    writes: [],
    listCalls: [],
    emptyBatchListReadsBeforeReal,
    emptyComplianceListReadsBeforeReal,
  };
  const rowsFor = name => ({ Order: store.orders, ShopifyOrder: store.nativeOrders, FulfillmentTask: store.tasks, ProductionBatch: store.batches, BatchComplianceLog: store.complianceLogs, OrderSyncLog: store.orderSyncLogs, OrderReviewQueue: store.reviewRows, CommandLog: store.commandLogs, SafeSyncParityLog: store.parityLogs }[name] || []);
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    list: async (sort, limit) => {
      store.listCalls.push({ name, sort, limit });
      if (name === 'ProductionBatch' && store.emptyBatchListReadsBeforeReal > 0) {
        store.emptyBatchListReadsBeforeReal -= 1;
        return [];
      }
      if (name === 'BatchComplianceLog' && store.emptyComplianceListReadsBeforeReal > 0) {
        store.emptyComplianceListReadsBeforeReal -= 1;
        return [];
      }
      return rowsFor(name);
    },
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    get: async id => rowsFor(name).find(row => row?.id === id) || null,
    create: async payload => { store.writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { store.writes.push({ op: 'update', name, id, patch }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { store.writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    store,
    base44: {
      auth: { me: async () => ({ role: 'admin', email: 'owner@example.com' }) },
      asServiceRole: { entities: { Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog') } },
    },
  };
}

const { exports: fns } = loadHarness({ env: { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' } });
assert.equal(fns.G35I_PREV1_EXACT_READ_FAST_PATH_MARKER, 'g35i_prev1_exact_refund_preview_fast_path');
assert.equal(fns.G35I_PREV1_EXACT_READ_LIST_LIMIT, 250);

const exactPartialBody = {
  preview_mode: 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT',
  order_number: TARGET.orderNumber,
  customer_app_order_id: TARGET.customerOrderId,
  native_shopify_order_id: TARGET.nativeOrderId,
  native_fulfillment_task_id: TARGET.taskId,
  refund_type: 'partial',
  refund_amount: 5,
  refund_currency: 'USD',
  event_source: 'test_fixture',
  request_id: 'g35i_prev1_exact_partial',
};

let scenario = makeStore();
let preview = await fns.buildG35HPreview(scenario.base44, exactPartialBody);
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.preview_data_stable, true);
assert.equal(preview.read_consistency.stable, true);
assert.equal(preview.g35i_prev1_exact_read_fast_path, true);
assert.equal(preview.g35i_prev1_exact_read_fast_path_marker, fns.G35I_PREV1_EXACT_READ_FAST_PATH_MARKER);
assert.equal(preview.production_batch_count, 6);
assert.equal(preview.verified_logged_batch_count, 6);
assert.equal(preview.batch_compliance_log_count, 6);
assert.equal(preview.locked_compliance_log_count, 6);
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.incident_type, 'partial_refund_review_required');
assert.equal(preview.provider_call_impact, false);
assert.equal(preview.notification_impact.notification_held, true);
assert.equal(preview.production_batch_mutation_proposed, false);
assert.equal(preview.compliance_log_mutation_proposed, false);
assert.equal(scenario.store.writes.length, 0);
assert.equal(scenario.store.listCalls.some(call => call.name === 'ProductionBatch' && call.limit > 250), false);
assert.equal(scenario.store.listCalls.some(call => call.name === 'BatchComplianceLog' && call.limit > 250), false);

scenario = makeStore();
preview = await fns.buildG35BPreview(scenario.base44, { ...exactPartialBody, preview_mode: 'NATIVE_REFUND_IMPACT', refund_type: 'full' });
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.preview_data_stable, true);
assert.equal(preview.read_consistency.stable, true);
assert.equal(preview.g35i_prev1_exact_read_fast_path, true);
assert.equal(preview.production_batch_count, 6);
assert.equal(preview.batch_compliance_log_count, 6);
assert.equal(preview.provider_call_impact, false);
assert.equal(scenario.store.writes.length, 0);
assert.equal(scenario.store.listCalls.some(call => call.name === 'ProductionBatch' && call.limit > 250), false);
assert.equal(scenario.store.listCalls.some(call => call.name === 'BatchComplianceLog' && call.limit > 250), false);

scenario = makeStore({ emptyBatchListReadsBeforeReal: 1, emptyComplianceListReadsBeforeReal: 1 });
preview = await fns.buildG35HPreview(scenario.base44, exactPartialBody);
assert.equal(preview.writes_performed, false);
assert.equal(preview.preview_data_stable, false);
assert.equal(preview.read_consistency.stable, false);
assert.ok(preview.blockers.includes('read_consistency_unstable'));
assert.ok(preview.blockers.includes('production_batch_read_unstable'));
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft, null);
assert.equal(preview.future_review_queue_command_planning_possible, false);
assert.equal(scenario.store.writes.length, 0);

console.log(JSON.stringify({
  success: true,
  harness: 'G35I-PREV1 refund preview dependency hardening',
  cases: 3,
  exact_partial_preview_stable: true,
  exact_full_refund_preview_stable: true,
  inconsistent_reads_fail_closed: true,
  writes_performed: false,
}, null, 2));
