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
  source += `\nglobalThis.__exports = { G35H_PREVIEW_MODE, G35H_PATCH1_BATCH_LINKAGE_MARKER, isG35HPreviewRequest, buildG35HPreview, buildG35BPreview, G35B_READ_ONLY_SAFETY, G35B_STATUS_SCHEMA_COMPATIBILITY };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, source };
}

const ORDER = {
  orderNumber: 'NV-G35H-ORDER',
  customerOrderId: 'order_g35h',
  nativeOrderId: 'native_g35h',
  taskId: 'task_g35h',
};

function makeOrder(overrides = {}) {
  return {
    id: ORDER.customerOrderId,
    order_number: ORDER.orderNumber,
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    financial_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    items: [{ name: 'Synthetic Juice Bundle', quantity: 1 }],
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: ORDER.nativeOrderId,
    base44_order_id: ORDER.customerOrderId,
    shopify_order_number: ORDER.orderNumber,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    fulfillment_method: 'delivery',
    source_type: 'customer_app_native_mirror',
    production_status: 'new',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    financial_status: 'paid',
    line_items: [{ title: 'Synthetic Juice Bundle', quantity: 1 }],
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: ORDER.taskId,
    base44_order_id: ORDER.customerOrderId,
    order_id: ORDER.customerOrderId,
    native_shopify_order_id: ORDER.nativeOrderId,
    shopify_order_id: ORDER.nativeOrderId,
    order_number: ORDER.orderNumber,
    shopify_order_number: ORDER.orderNumber,
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    status: 'scheduled',
    delivery_status: 'pending',
    ...overrides,
  };
}

function makeBatch(index = 0, overrides = {}) {
  return {
    id: `pb_g35h_${index + 1}`,
    batch_id: `NATIVE-${ORDER.orderNumber}-2026-06-15-SYNTHETIC-${index + 1}`,
    product_name: `Synthetic Juice ${index + 1}`,
    production_date: '2026-06-15',
    status: 'verified_logged',
    planned_units: 1,
    compliance_log_id: `cl_g35h_${index + 1}`,
    base44_order_id: ORDER.customerOrderId,
    native_shopify_order_id: ORDER.nativeOrderId,
    native_fulfillment_task_id: ORDER.taskId,
    order_number: ORDER.orderNumber,
    order_sources: [{ order_id: ORDER.customerOrderId, order_number: ORDER.orderNumber, quantity: 1 }],
    ...overrides,
  };
}

function makeComplianceLog(index = 0, overrides = {}) {
  return {
    id: `cl_g35h_${index + 1}`,
    batch_id: `NATIVE-${ORDER.orderNumber}-2026-06-15-SYNTHETIC-${index + 1}`,
    source_production_batch_id: `pb_g35h_${index + 1}`,
    date: '2026-06-15',
    juice_flavor: `Synthetic Juice ${index + 1}`,
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
  emptyProductionBatchReadsBeforeReal = 0,
} = {}) {
  const store = { orders, nativeOrders, tasks, batches, complianceLogs, orderSyncLogs, reviewRows, commandLogs, parityLogs, writes: [], emptyProductionBatchReadsBeforeReal };
  const rowsFor = name => ({ Order: store.orders, ShopifyOrder: store.nativeOrders, FulfillmentTask: store.tasks, ProductionBatch: store.batches, BatchComplianceLog: store.complianceLogs, OrderSyncLog: store.orderSyncLogs, OrderReviewQueue: store.reviewRows, CommandLog: store.commandLogs, SafeSyncParityLog: store.parityLogs }[name] || []);
  const maybeRowsFor = name => {
    if (name === 'ProductionBatch' && store.emptyProductionBatchReadsBeforeReal > 0) {
      store.emptyProductionBatchReadsBeforeReal -= 1;
      return [];
    }
    return rowsFor(name);
  };
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    list: async () => maybeRowsFor(name),
    filter: async filter => maybeRowsFor(name).filter(row => match(row, filter)),
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

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }
async function previewFor(scenario, body = {}) {
  return fns.buildG35HPreview(scenario.base44, {
    preview_mode: 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT',
    order_number: ORDER.orderNumber,
    refund_type: 'partial',
    refund_amount: 5,
    refund_currency: 'USD',
    event_source: 'test_fixture',
    request_id: 'g35h_test_request',
    ...body,
  });
}

const { exports: fns, handler, source } = loadHarness({ env: { NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' } });
assert.equal(fns.G35H_PREVIEW_MODE, 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT');
assert.equal(fns.G35H_PATCH1_BATCH_LINKAGE_MARKER, 'g35h_patch1_reuse_native_refund_impact_batch_linkage');
assert.equal(fns.isG35HPreviewRequest({ preview_mode: 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT' }), true);
assert.equal(fns.G35B_READ_ONLY_SAFETY.writes_performed, false);

let scenario = makeStore({ batches: [], complianceLogs: [] });
let preview = await previewFor(scenario, { refund_amount: 5, stripe_event_id: 'evt_test_g35h_partial', stripe_refund_id: 're_test_g35h_partial', refund_reason: 'preview only' });
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.preview_mode, 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT');
assert.equal(preview.refund_type, 'partial');
assert.equal(preview.refund_amount, 5);
assert.equal(preview.proposed_order_review_queue_impact.proposed_action, 'partial_refund_review_queue_draft');
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.incident_type, 'partial_refund_review_required');
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.refund_amount, 5);
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.refund_currency, 'USD');
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.raw_payload_included, false);
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.customer_pii_included, false);
assert.equal(preview.proposed_customer_app_order_impact.status_mutation_proposed, false);
assert.equal(preview.proposed_customer_app_order_impact.proposed_refund_fields.refund_status, 'pending_review');
assert.equal(preview.proposed_customer_app_order_impact.proposed_refund_fields.refund_type, 'partial');
assert.equal(preview.proposed_native_shopify_order_impact.proposed_refund_fields.refund_review_required, true);
assert.equal(preview.proposed_fulfillment_task_impact.would_cancel_task, false);
assert.equal(preview.notification_impact.notification_held, true);
assert.equal(preview.provider_call_impact, false);
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore();
preview = await previewFor(scenario, { refund_amount: '' });
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('refund_amount_required_for_partial_refund_review'));
assert.equal(preview.next_action, 'provide_refund_amount_for_review_preview');
assert.equal(scenario.store.writes.length, 0);

const sixBatches = Array.from({ length: 6 }, (_, index) => makeBatch(index));
const sixComplianceLogs = Array.from({ length: 6 }, (_, index) => makeComplianceLog(index));
scenario = makeStore({
  orders: [makeOrder({ status: 'delivered' })],
  nativeOrders: [makeNativeOrder({ production_status: 'bottled', fulfillment_status: 'fulfilled' })],
  tasks: [makeTask({ status: 'delivered', delivery_status: 'delivered' })],
  batches: sixBatches,
  complianceLogs: sixComplianceLogs,
});
preview = await previewFor(scenario);
assert.equal(preview.lifecycle_state, 'delivered');
assert.equal(preview.lifecycle_risk_level, 'manual_review_required');
assert.equal(preview.next_action, 'partial_refund_manual_review_required');
assert.equal(preview.production_batch_count, 6);
assert.equal(preview.verified_logged_batch_count, 6);
assert.equal(preview.batch_compliance_log_count, 6);
assert.equal(preview.locked_compliance_log_count, 6);
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.priority, 'high');
assert.equal(preview.proposed_fulfillment_task_impact.would_cancel_task, false);
assert.equal(preview.proposed_production_batch_impact.mutation_proposed, false);
assert.equal(preview.proposed_production_batch_impact.deletion_proposed, false);
assert.equal(preview.proposed_production_batch_impact.compliance_history_preserved, true);
assert.equal(preview.proposed_compliance_impact.compliance_history_preserved, true);
assert.equal(preview.proposed_compliance_impact.compliance_history_mutation_proposed, false);
assert.equal(preview.g35h_patch1_batch_linkage.fallback_used, false);
assert.ok(preview.warnings.includes('verified_production_history_preserved'));
assert.ok(preview.warnings.includes('locked_compliance_logs_preserved'));
assert.ok(preview.warnings.includes('delivered_partial_refund_manual_review_required'));
assert.equal(scenario.store.writes.length, 0);

let fullImpactPreview = await fns.buildG35BPreview(scenario.base44, {
  preview_mode: 'NATIVE_REFUND_IMPACT',
  order_number: ORDER.orderNumber,
  refund_type: 'full',
  event_source: 'test_fixture',
  request_id: 'g35h_patch1_full_regression',
});
assert.equal(fullImpactPreview.production_batch_count, 6);
assert.equal(fullImpactPreview.batch_compliance_log_count, 6);
assert.equal(fullImpactPreview.writes_performed, false);

scenario = makeStore({
  orders: [makeOrder({ status: 'delivered' })],
  nativeOrders: [makeNativeOrder({ production_status: 'bottled', fulfillment_status: 'fulfilled' })],
  tasks: [makeTask({ status: 'delivered', delivery_status: 'delivered' })],
  batches: sixBatches,
  complianceLogs: sixComplianceLogs,
  emptyProductionBatchReadsBeforeReal: 12,
});
preview = await previewFor(scenario);
assert.equal(preview.production_batch_count, 6);
assert.equal(preview.verified_logged_batch_count, 6);
assert.equal(preview.batch_compliance_log_count, 6);
assert.equal(preview.locked_compliance_log_count, 6);
assert.equal(preview.g35h_patch1_batch_linkage.fallback_used, true);
assert.equal(preview.g35h_patch1_batch_linkage.fallback_status, 'native_refund_impact_linkage_reused');
assert.equal(preview.g35h_patch1_batch_linkage.direct_production_batch_count, 0);
assert.equal(preview.g35h_patch1_batch_linkage.fallback_production_batch_count, 6);
assert.ok(preview.proposed_production_batch_impact.batch_linkage_warnings.includes(fns.G35H_PATCH1_BATCH_LINKAGE_MARKER));
assert.ok(preview.warnings.includes(fns.G35H_PATCH1_BATCH_LINKAGE_MARKER));
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.incident_type, 'partial_refund_review_required');
assert.equal(preview.production_batch_mutation_proposed, false);
assert.equal(preview.compliance_log_mutation_proposed, false);
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ reviewRows: [{ id: 'review_existing', incident_type: 'partial_refund_review_required', existing_order_number: ORDER.orderNumber, existing_order_id: ORDER.customerOrderId, status: 'pending' }] });
preview = await previewFor(scenario);
assert.equal(preview.duplicate_review_detected, true);
assert.equal(preview.existing_review_queue_count, 1);
assert.equal(preview.next_action, 'duplicate_partial_refund_review_already_exists');
assert.equal(preview.proposed_order_review_queue_impact.draft_recommended_for_future_command, false);
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ orderSyncLogs: [{ id: 'sync_dup', order_number: ORDER.orderNumber, stripe_event_id: 'evt_test_dup_partial', status: 'success', action: 'refund_processed' }] });
preview = await previewFor(scenario, { stripe_event_id: 'evt_test_dup_partial' });
assert.equal(preview.duplicate_refund_event_detected, true);
assert.equal(preview.idempotency_status.duplicate_event_detected, true);
assert.equal(preview.next_action, 'duplicate_refund_event_detected');
assert.equal(preview.proposed_order_review_queue_impact.draft_recommended_for_future_command, false);
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore();
preview = await previewFor(scenario, { refund_type: 'full' });
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('refund_type_must_be_partial_for_partial_refund_review_preview'));
assert.equal(preview.next_action, 'use_native_refund_impact_preview_for_non_partial_refund');
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ orders: [], nativeOrders: [], tasks: [], batches: [], complianceLogs: [] });
preview = await previewFor(scenario, { order_number: 'NV-UNKNOWN-G35H', refund_amount: 5, stripe_event_id: 'evt_test_unknown_partial' });
assert.equal(preview.success, true);
assert.equal(preview.order_found, false);
assert.equal(preview.next_action, 'unknown_order_review_required');
assert.equal(preview.proposed_order_review_queue_impact.safe_queue_draft.incident_type, 'partial_refund_unknown_order_review_required');
assert.equal(scenario.store.writes.length, 0);

scenario = makeStore({ batches: [makeBatch(0)], complianceLogs: [makeComplianceLog(0)] });
preview = await previewFor(scenario);
assert.equal(preview.proposed_production_batch_impact.mutation_proposed, false);
assert.equal(preview.proposed_production_batch_impact.deletion_proposed, false);
assert.equal(preview.proposed_compliance_impact.compliance_history_mutation_proposed, false);
assert.equal(preview.safety.inventory_deducted_or_restored, false);
assert.equal(preview.safety.purchase_order_created_or_updated, false);
assert.equal(scenario.store.writes.length, 0);

assert.equal(preview.notification_impact.notification_would_send, false);
assert.equal(preview.notification_impact.notification_rows_created, false);
assert.equal(preview.notification_impact.message_logs_created, false);
assert.equal(preview.provider_call_impact, false);
assert.equal(preview.safety.provider_calls_performed, false);
assert.equal(preview.safety.order_review_queue_created, false);
assert.equal(preview.safety.order_sync_log_created, false);
assert.equal(preview.safety.command_log_created, false);

assert.ok(preview.status_schema_policy_notes.includes('customer_order_status_refund_value_unsupported_policy_note'));
assert.ok(preview.status_schema_policy_notes.includes('customer_order_cancelled_value_unsupported_policy_note'));
assert.ok(preview.status_schema_policy_notes.includes('refund_state_uses_payment_refund_fields'));
assert.equal(preview.blockers.includes('customer_order_status_refund_value_unsupported'), false);
assert.equal(preview.blockers.includes('customer_order_cancelled_value_unsupported'), false);

scenario = makeStore();
let res = await handler(req(scenario.base44, { preview_mode: 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT', order_number: ORDER.orderNumber, refund_type: 'partial', refund_amount: 5, event_source: 'admin_preview' }));
assert.equal(res.status, 200);
let body = await json(res);
assert.equal(body.success, true);
assert.equal(body.writes_performed, false);
assert.equal(body.actor_type, 'admin');
assert.equal(scenario.store.writes.length, 0);

res = await handler(req(scenario.base44, { preview_mode: 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT', order_number: ORDER.orderNumber, refund_type: 'partial', refund_amount: 5 }, 'GET'));
assert.equal(res.status, 405);
assert.equal((await json(res)).writes_performed, false);

scenario = makeStore({ user: new Error('no auth') });
res = await handler(req(scenario.base44, { preview_mode: 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT', order_number: ORDER.orderNumber, refund_type: 'partial', refund_amount: 5 }));
assert.equal(res.status, 401);
assert.equal((await json(res)).writes_performed, false);

const forbiddenRuntimeSnippets = ['stripe.refunds.create', 'new Stripe(', 'PurchaseOrder.create', 'sendOrderStatusNotification', 'sendCustomerNotification({', 'syncRefundToHub'];
for (const snippet of forbiddenRuntimeSnippets) assert.ok(!source.includes(snippet), `source must not include forbidden snippet ${snippet}`);
assert.ok(!/buildG35HPreview[\s\S]*\.create\(/.test(source), 'G35H preview must not create records');
assert.ok(!/buildG35HPreview[\s\S]*\.update\(/.test(source), 'G35H preview must not update records');
assert.ok(!/buildG35HPreview[\s\S]*\.delete\(/.test(source), 'G35H preview must not delete records');

console.log('G35H partial refund review preview tests passed');
