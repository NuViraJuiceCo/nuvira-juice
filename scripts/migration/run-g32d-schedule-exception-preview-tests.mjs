#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const TARGET = {
  order_number: 'NV-MPZNKGNT',
  customer_app_order_id: '6a219a3f4adcda5856c3d579',
  native_shopify_order_id: '6a22ffda400eb806eb3ca945',
  native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
  current_recorded_production_date: '2026-06-05',
  current_recorded_delivery_date: '2026-06-06',
  proposed_actual_production_date: '2026-06-07',
  proposed_actual_delivery_date: '2026-06-08',
  correction_mode: 'DATE_ONLY',
};

const BATCH_IDS = [
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT',
];

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/previewNativeScheduleExceptionCorrection/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(/^export \{[^}]+\};\s*$/gm, '');
  source += `\nglobalThis.__exports = { buildPreview, getLookup, parseDeliveryWindow, loadContext, requirePreviewAccess, READ_ONLY_SAFETY };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler };
}

function makeCustomerOrder(overrides = {}) {
  return {
    id: TARGET.customer_app_order_id,
    order_number: TARGET.order_number,
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    payment_captured: true,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    production_date: '2026-06-05',
    assigned_production_day: '2026-06-05',
    estimated_delivery_date: '2026-06-06',
    assigned_delivery_date: '2026-06-06',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    assigned_delivery_window_start: '2026-06-06T17:00:00.000Z',
    assigned_delivery_window_end: '2026-06-06T20:00:00.000Z',
    delivery_window_timezone: 'America/Chicago',
    status_history: [{ status: 'scheduled_for_juicing' }, { status: 'payment_confirmed' }],
    ...(overrides || {}),
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: TARGET.native_shopify_order_id,
    base44_order_id: TARGET.customer_app_order_id,
    shopify_order_number: TARGET.order_number,
    production_status: 'bottled',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    financial_status: 'paid',
    is_subscription: false,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    production_date: '2026-06-05',
    assigned_delivery_date: '2026-06-06',
    selected_delivery_date: '2026-06-06',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    fulfillments: [{ production_date: '2026-06-05', delivery_date: '2026-06-06', delivery_window_label: 'Saturday 12 PM - 3 PM', status: 'pending' }],
    ...(overrides || {}),
  };
}

function makeTask(overrides = {}) {
  return {
    id: TARGET.native_fulfillment_task_id,
    base44_order_id: TARGET.customer_app_order_id,
    native_shopify_order_id: TARGET.native_shopify_order_id,
    shopify_order_id: TARGET.native_shopify_order_id,
    order_number: TARGET.order_number,
    status: 'packed',
    delivery_status: 'pending',
    production_status: 'packed',
    production_date: '2026-06-05',
    delivery_date: '2026-06-06',
    scheduled_date: '2026-06-06',
    assigned_delivery_date: '2026-06-06',
    time_window: 'Saturday 12 PM - 3 PM',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    packed_at: '2026-06-08T18:00:10.444Z',
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    ...(overrides || {}),
  };
}

function makeBatches(overrides = {}) {
  return BATCH_IDS.map((batchId, index) => ({
    id: `pb_${index}`,
    batch_id: batchId,
    source_order_number: TARGET.order_number,
    status: 'verified_logged',
    production_date: '2026-06-05',
    actual_start_time: '2026-06-08T03:37:37.073Z',
    actual_end_time: '2026-06-08T04:49:01.083Z',
    verified_at: '2026-06-08T16:03:53.429Z',
    compliance_log_id: `bcl_${index}`,
    order_sources: [{ order_id: TARGET.customer_app_order_id, order_number: TARGET.order_number }],
    ...(overrides[batchId] || {}),
  }));
}

function makeComplianceLogs(batches = makeBatches()) {
  return batches.map((batch, index) => ({
    id: `bcl_${index}`,
    batch_id: batch.batch_id,
    source_production_batch_id: batch.id,
    date: '2026-06-05',
    verified_at: '2026-06-08T16:03:53.429Z',
    locked: true,
  }));
}

function context(overrides = {}) {
  const customerOrder = overrides.customerOrder === null ? null : makeCustomerOrder(overrides.customerOrder);
  const nativeOrder = overrides.nativeOrder === null ? null : makeNativeOrder(overrides.nativeOrder);
  const task = overrides.task === null ? null : makeTask(overrides.task);
  const batches = overrides.batches ?? makeBatches(overrides.batchOverrides || {});
  const complianceLogs = overrides.complianceLogs ?? makeComplianceLogs(batches);
  return {
    customerOrder,
    nativeOrder,
    task,
    batches,
    complianceLogs,
    matchCounts: {
      customer_app_order_matches: customerOrder ? 1 : 0,
      native_shopify_order_matches: nativeOrder ? 1 : 0,
      native_fulfillment_task_matches: task ? 1 : 0,
    },
    lookup: {
      orderNumber: TARGET.order_number,
      customerAppOrderId: TARGET.customer_app_order_id,
      nativeShopifyOrderId: TARGET.native_shopify_order_id,
      nativeFulfillmentTaskId: TARGET.native_fulfillment_task_id,
      currentRecordedProductionDate: '2026-06-05',
      currentRecordedDeliveryDate: '2026-06-06',
      currentRecordedProductionDateProvided: true,
      currentRecordedDeliveryDateProvided: true,
      proposedActualProductionDate: '2026-06-07',
      proposedActualDeliveryDate: '2026-06-08',
      proposedActualProductionDateProvided: true,
      proposedActualDeliveryDateProvided: true,
      currentRecordedProductionDateInvalid: false,
      currentRecordedDeliveryDateInvalid: false,
      proposedActualProductionDateInvalid: false,
      proposedActualDeliveryDateInvalid: false,
      proposedDeliveryWindow: overrides.proposedDeliveryWindow || null,
      correctionMode: overrides.correctionMode || 'DATE_ONLY',
      requestId: 'g32d_sched_test',
      ...(overrides.lookup || {}),
    },
    auth: { actor_type: 'admin', actor_role: 'admin' },
  };
}

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, ...ctx } = context()) {
  const writes = [];
  const rowsFor = name => {
    if (name === 'Order') return [ctx.customerOrder].filter(Boolean);
    if (name === 'ShopifyOrder') return [ctx.nativeOrder].filter(Boolean);
    if (name === 'FulfillmentTask') return [ctx.task].filter(Boolean);
    if (name === 'ProductionBatch') return ctx.batches || [];
    if (name === 'BatchComplianceLog') return ctx.complianceLogs || [];
    return [];
  };
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    list: async () => rowsFor(name),
    create: async payload => { writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ op: 'update', name, id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    writes,
    base44: {
      auth: { me: async () => user },
      asServiceRole: { entities: { Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog') } },
    },
  };
}

function req(base44, body = {}, method = 'POST', headers = {}) {
  return { method, __base44: base44, headers: { get: key => headers[key.toLowerCase()] || '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

const { exports: fns, handler } = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });

let preview = fns.buildPreview(context());
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.correction_needed, true);
assert.equal(preview.records_to_update.length, 3);
assert.ok(preview.classifications.includes('native_fulfillment_task_schedule_correction_needed'));
assert.ok(preview.classifications.includes('customer_order_date_correction_recommended'));
assert.ok(preview.classifications.includes('native_shopify_order_date_correction_recommended'));

assert.equal(preview.correction_mode, 'DATE_ONLY');
assert.equal(preview.window_update_status, 'not_updated_date_only');
assert.ok(preview.warnings.includes('delivery_window_not_updated'));
assert.equal(preview.proposed_field_changes.some(change => change.field === 'delivery_window_label'), false);

preview = fns.buildPreview(context({ task: null }));
assert.ok(preview.blockers.includes('target_native_fulfillment_task_not_found'));

preview = fns.buildPreview(context({ customerOrder: { payment_status: 'unpaid', payment_captured: false } }));
assert.ok(preview.blockers.includes('customer_app_order_not_paid_or_captured'));

preview = fns.buildPreview(context());
assert.ok(preview.records_not_updated.some(record => record.record_type === 'ProductionBatch'));
assert.ok(preview.classifications.includes('production_batch_date_change_not_recommended'));
assert.equal(preview.proposed_field_changes.some(change => change.record_type === 'ProductionBatch'), false);

assert.ok(preview.records_not_updated.some(record => record.record_type === 'BatchComplianceLog'));
assert.ok(preview.classifications.includes('compliance_log_date_change_not_recommended'));
assert.equal(preview.proposed_field_changes.some(change => change.record_type === 'BatchComplianceLog'), false);

assert.equal(preview.notification_impact, false);
assert.equal(preview.notification_preview.notification_would_send, false);
assert.equal(preview.customer_facing_impact.customer_app_order_status_would_change, false);
assert.equal(preview.customer_facing_impact.status_history_would_append, false);

const windowPayload = fns.parseDeliveryWindow({
  delivery_window_label: 'Monday 12 PM - 3 PM',
  assigned_delivery_window_start: '2026-06-08T17:00:00.000Z',
  assigned_delivery_window_end: '2026-06-08T20:00:00.000Z',
  delivery_window_timezone: 'America/Chicago',
});
preview = fns.buildPreview(context({ correctionMode: 'DATE_AND_WINDOW', proposedDeliveryWindow: windowPayload }));
assert.equal(preview.correction_mode, 'DATE_AND_WINDOW');
assert.equal(preview.window_update_status, 'would_update_window_if_later_approved');
assert.ok(preview.proposed_field_changes.some(change => change.field === 'delivery_window_label' && change.to === 'Monday 12 PM - 3 PM'));

preview = fns.buildPreview(context({ lookup: { currentRecordedDeliveryDate: '2026-06-09' } }));
assert.ok(preview.blockers.includes('current_recorded_delivery_date_safety_mismatch'));

preview = fns.buildPreview(context({ lookup: { proposedActualProductionDateProvided: false, proposedActualProductionDate: '' } }));
assert.ok(preview.blockers.includes('proposed_actual_production_date_missing'));

const store = makeStore(context());
let response = await handler(req(store.base44, { mode: 'dry_run', ...TARGET }));
assert.equal(response.status, 200);
let body = await json(response);
assert.equal(body.success, true);
assert.equal(body.writes_performed, false);
assert.equal(store.writes.length, 0);
assert.equal(body.correction_needed, true);

response = await handler(req(store.base44, { mode: 'dry_run', ...TARGET }, 'GET'));
assert.equal(response.status, 405);
body = await json(response);
assert.equal(body.writes_performed, false);

response = await handler(req(makeStore({ ...context(), user: null }).base44, { mode: 'dry_run', ...TARGET }));
assert.equal(response.status, 401);
body = await json(response);
assert.equal(body.writes_performed, false);

response = await handler(req(store.base44, { mode: 'dry_run', ...TARGET, proof_photo_url: 'https://example.test/proof.jpg' }));
assert.equal(response.status, 400);
body = await json(response);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(body.writes_performed, false);

response = await handler(req(store.base44, { mode: 'execute', ...TARGET }));
assert.equal(response.status, 400);
body = await json(response);
assert.equal(body.error_code, 'dry_run_only');
assert.equal(body.writes_performed, false);

response = await handler(req(store.base44, { mode: 'dry_run', ...TARGET, order_number: 'NV-OTHER' }));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'unsupported_schedule_exception_target');
assert.equal(body.writes_performed, false);

console.log('G32D-SCHED schedule exception preview tests passed');
