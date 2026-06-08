#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const BATCH_IDS = [
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT',
];
const PRODUCTS = {
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA': 'Aura',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS': 'Oasis',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE': 'Pineapple Juice',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT': 'Radiance Shot',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU': 'Re-Nu',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT': 'Reset Shot',
};
const VERIFICATION_DATA = Object.fromEntries(BATCH_IDS.map(id => [id, { pH_result: 3.7, pH_passed: true, batch_passed: true }]));
const NORMALIZED_VERIFICATION_DATA = Object.fromEntries(BATCH_IDS.map(id => [id, { pH_result: 3.7, pH_passed_failed: 'passed', passed_failed: 'passed' }]));

function loadPreviewHarness() {
  const filePath = path.join(repoRoot, 'base44/functions/previewNativeProductionBatchLifecycle/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { planVerify, buildBatchLifecycleRow, buildOrderLifecyclePreview, getLookup };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: () => '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler };
}

function loadCommandHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/verifyNativeProductionBatchesForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, parseVerificationDataMap, validateFreshPreview, preflightTargetBatches, buildComplianceLogRecord, validateComplianceLogRecord, buildVerifyPatch, validateVerifyPatch, verifyProductionBatches, requireAdmin };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, env };
}

function makeBatch(batchId = BATCH_IDS[0], overrides = {}) {
  return {
    id: `pb_${batchId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    batch_id: batchId,
    product_name: PRODUCTS[batchId],
    product_category: PRODUCTS[batchId]?.includes('Shot') ? 'shot' : 'juice',
    status: 'completed_pending_verification',
    production_date: '2026-06-05',
    planned_units: 1,
    actual_units: 1,
    actual_start_time: '2026-06-08T03:37:37.073Z',
    actual_end_time: '2026-06-08T04:49:01.083Z',
    started_by: 'owner@example.test',
    completed_by: 'owner@example.test',
    order_sources: [{ order_id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT', quantity: 1, source_type: 'direct', source_item: PRODUCTS[batchId] }],
    related_orders: ['6a22ffda400eb806eb3ca945'],
    source_system: 'customer_app_native_order',
    procurement_needed: true,
    inventory_deduction_status: 'held',
    ingredient_usage_status: 'not_started',
    ...(overrides || {}),
  };
}

function makeBatches(overrides = {}) {
  return BATCH_IDS.map(batchId => makeBatch(batchId, overrides[batchId] || {}));
}

function makeLifecyclePreview({ ready = true, rows } = {}) {
  const batchRows = rows || makeBatches().map(batch => ({
    production_batch_id: batch.id,
    batch_id: batch.batch_id,
    product_name: batch.product_name,
    current_status: batch.status,
    planned_units: batch.planned_units,
    actual_units: batch.actual_units,
    actual_start_time: batch.actual_start_time,
    actual_end_time: batch.actual_end_time,
    production_date: batch.production_date,
    is_locked: false,
    compliance_log_present: false,
    can_start: false,
    can_complete: false,
    can_verify: ready,
    verify_blockers: ready ? [] : ['missing_ph_result'],
    verification_input_preview: ready ? { pH_result: 3.7, pH_passed_failed: 'passed', passed_failed: 'passed' } : { pH_result: null, pH_passed_failed: '', passed_failed: '' },
  }));
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    order_number: 'NV-MPZNKGNT',
    customer_app_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    customer_app_order_present: true,
    native_shopify_order_present: true,
    native_fulfillment_task_present: true,
    payment_status: 'paid',
    payment_captured: true,
    production_date: '2026-06-05',
    delivery_date: '2026-06-06',
    batch_count: 6,
    batch_lifecycle_rows: batchRows,
    start_preview: { ready_count: 0, blocked_count: 6, already_started_count: 6 },
    complete_preview: { ready_count: 0, blocked_count: 6 },
    verify_preview: { ready_count: ready ? 6 : 0, blocked_count: ready ? 0 : 6, ready_batch_ids: ready ? BATCH_IDS : [] },
    verification_preview_ready: ready,
    blockers: [],
    warnings: ['inventory_deduction_held', 'purchase_order_automation_held', 'hub_fallback_required'],
    hub_fallback_required: true,
    inventory_deduction_ready: false,
    purchase_order_ready: false,
  };
}

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, preview = makeLifecyclePreview({ ready: true }), productionBatches = makeBatches(), commandLogs = [], complianceLogs = [] } = {}) {
  const store = { productionBatches: productionBatches.map(row => ({ ...row })), commandLogs: [...commandLogs], complianceLogs: [...complianceLogs], otherWrites: [] };
  const matchFilter = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const entityApi = name => ({
    filter: async filter => {
      const rows = name === 'ProductionBatch' ? store.productionBatches : name === 'CommandLog' ? store.commandLogs : name === 'BatchComplianceLog' ? store.complianceLogs : [];
      return rows.filter(row => matchFilter(row, filter));
    },
    create: async payload => {
      const row = { id: `${name.toLowerCase()}_${name === 'CommandLog' ? store.commandLogs.length + 1 : name === 'BatchComplianceLog' ? store.complianceLogs.length + 1 : store.otherWrites.length + 1}`, ...payload };
      if (name === 'CommandLog') store.commandLogs.push(row);
      else if (name === 'BatchComplianceLog') store.complianceLogs.push(row);
      else store.otherWrites.push({ name, payload });
      return row;
    },
    update: async (id, patch) => {
      const rows = name === 'ProductionBatch' ? store.productionBatches : name === 'CommandLog' ? store.commandLogs : store.complianceLogs;
      const row = rows.find(item => item.id === id);
      if (!row) throw new Error(`${name} not found`);
      Object.assign(row, patch);
      return row;
    },
  });
  const base44 = {
    auth: { me: async () => {
      if (user instanceof Error) throw user;
      return user;
    } },
    asServiceRole: {
      functions: { invoke: async (name, body) => {
        assert.equal(name, 'previewNativeProductionBatchLifecycle');
        assert.equal(JSON.stringify(body.verification_data_by_batch_id), JSON.stringify(NORMALIZED_VERIFICATION_DATA));
        return { data: preview };
      } },
      entities: {
        ProductionBatch: entityApi('ProductionBatch'),
        CommandLog: entityApi('CommandLog'),
        BatchComplianceLog: entityApi('BatchComplianceLog'),
      },
    },
  };
  return { base44, store };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

function liveBody(overrides = {}) {
  return {
    mode: 'live',
    confirmation: 'verify_native_production_batches_for_customer_app',
    order_number: 'NV-MPZNKGNT',
    production_date: '2026-06-05',
    batch_ids: BATCH_IDS,
    verification_data_by_batch_id: VERIFICATION_DATA,
    customer_app_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    expected_status: 'completed_pending_verification',
    request_id: 'g31u_verify_test',
    ...overrides,
  };
}

const previewHarness = loadPreviewHarness();
let previewBatch = makeBatch();
let verifyPlan = previewHarness.exports.planVerify({ batch: previewBatch, actorEmail: 'owner@example.test', requestId: 'preview_missing', now: '2026-06-08T05:00:00.000Z', verificationInput: {} });
assert.ok(verifyPlan.blockers.includes('missing_ph_result'));
assert.ok(verifyPlan.blockers.includes('missing_ph_pass_fail'));
assert.ok(verifyPlan.blockers.includes('missing_batch_pass_fail'));

verifyPlan = previewHarness.exports.planVerify({ batch: previewBatch, actorEmail: 'owner@example.test', requestId: 'preview_ready', now: '2026-06-08T05:00:00.000Z', verificationInput: { pH_result: '3.7', pH_passed: true, batch_passed: true } });
assert.equal(verifyPlan.blockers.length, 0);
assert.equal(verifyPlan.proposed_patch.status, 'verified_logged');
assert.equal(verifyPlan.proposed_patch.pH_result, 3.7);
assert.equal(verifyPlan.proposed_patch.pH_passed_failed, 'passed');
assert.equal(verifyPlan.proposed_patch.passed_failed, 'passed');
assert.equal(verifyPlan.proposed_patch.ingredients_used, undefined);

let lookup = previewHarness.exports.getLookup({ verification_data_by_batch_id: VERIFICATION_DATA });
let row = previewHarness.exports.buildBatchLifecycleRow({ batch: previewBatch, actorEmail: 'owner@example.test', requestId: 'row_ready', now: '2026-06-08T05:00:00.000Z', complianceLogs: [], lookup });
assert.equal(row.can_verify, true);
assert.equal(row.verify_state, 'ready_to_verify_preview_only');
assert.equal(row.verification_input_preview.pH_result, 3.7);
assert.equal(row.verification_input_preview.pH_passed_failed, 'passed');
assert.equal(row.verification_input_preview.passed_failed, 'passed');

let orderPreview = previewHarness.exports.buildOrderLifecyclePreview({
  customerOrder: { id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT', payment_status: 'paid', payment_captured: true },
  nativeOrder: { id: '6a22ffda400eb806eb3ca945', shopify_order_number: 'NV-MPZNKGNT', payment_status: 'paid' },
  task: { id: '6a22ffdaf675ea79e30575aa', order_number: 'NV-MPZNKGNT', production_date: '2026-06-05', assigned_delivery_date: '2026-06-06' },
  batches: makeBatches(),
  complianceLogs: [],
  lookup: { ...lookup, orderNumber: 'NV-MPZNKGNT', productionDate: '2026-06-05', requestId: 'order_preview' },
  auth: { actor_email: 'owner@example.test' },
  now: '2026-06-08T05:00:00.000Z',
});
assert.equal(orderPreview.verification_preview_ready, true);
assert.equal(orderPreview.verify_ready_count, 6);
assert.equal(orderPreview.verify_blocked_count, 0);
assert.equal(orderPreview.writes_performed, false);
assert.equal(orderPreview.safety.batch_compliance_logs_created, false);

const harness = loadCommandHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const { exports: fns, handler, env } = harness;

let parsed = fns.parseVerificationDataMap({ verification_data_by_batch_id: VERIFICATION_DATA });
assert.equal(parsed.blockers.length, 0);
assert.equal(JSON.stringify(parsed.verificationDataByBatchId), JSON.stringify(NORMALIZED_VERIFICATION_DATA));
parsed = fns.parseVerificationDataMap({ verification_data: { pH_result: 3.7, pH_passed: true, batch_passed: true } });
assert.equal(parsed.blockers.length, 0);
assert.equal(JSON.stringify(parsed.verificationDataByBatchId), JSON.stringify(NORMALIZED_VERIFICATION_DATA));
parsed = fns.parseVerificationDataMap({ verification_data: { pH_passed: true, batch_passed: true } });
assert.ok(parsed.blockers.some(item => item.startsWith('missing_ph_result:')));
parsed = fns.parseVerificationDataMap({ verification_data: { pH_result: 'bad', pH_passed: true, batch_passed: true } });
assert.ok(parsed.blockers.includes('invalid_ph_result:global'));

let exactBlockers = fns.exactTargetBlockers({ orderNumber: 'WRONG', productionDate: '2026-06-05', expectedStatus: 'completed_pending_verification', batchIds: BATCH_IDS, verificationDataByBatchId: NORMALIZED_VERIFICATION_DATA, blockers: [] });
assert.ok(exactBlockers.includes('target_order_number_mismatch'));

let gate = fns.gateFailure({ actorEmail: 'owner@example.test', lookup: { orderNumber: 'NV-MPZNKGNT', batchIds: BATCH_IDS } });
assert.equal(gate, 'native_production_batch_verify_disabled');
env.ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY = 'true';
env.NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH = 'true';
gate = fns.gateFailure({ actorEmail: 'owner@example.test', lookup: { orderNumber: 'NV-MPZNKGNT', batchIds: BATCH_IDS } });
assert.equal(gate, 'kill_switch_active');
env.NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH = 'false';
env.NATIVE_PRODUCTION_BATCH_VERIFY_POLICY = 'EXACT_BATCH_VERIFICATION_DATA_ONLY';
env.NATIVE_PRODUCTION_BATCH_VERIFY_ALLOWED_EMAILS = 'owner@example.test';
env.NATIVE_PRODUCTION_BATCH_VERIFY_ORDER_ALLOWLIST = 'NV-MPZNKGNT';
env.NATIVE_PRODUCTION_BATCH_VERIFY_BATCH_ALLOWLIST = BATCH_IDS.join(',');
gate = fns.gateFailure({ actorEmail: 'owner@example.test', lookup: { orderNumber: 'NV-MPZNKGNT', batchIds: BATCH_IDS } });
assert.equal(gate, null);

let validation = fns.validateFreshPreview(makeLifecyclePreview({ ready: true }), { verificationDataByBatchId: NORMALIZED_VERIFICATION_DATA });
assert.equal(validation.ready, true);
validation = fns.validateFreshPreview(makeLifecyclePreview({ ready: false }), { verificationDataByBatchId: NORMALIZED_VERIFICATION_DATA });
assert.equal(validation.ready, false);
assert.ok(validation.blockers.includes('unexpected_verify_ready_count'));

let complianceRecord = fns.buildComplianceLogRecord({ batch: makeBatch(), verificationData: NORMALIZED_VERIFICATION_DATA[BATCH_IDS[0]], actorEmail: 'owner@example.test', now: '2026-06-08T05:00:00.000Z' });
assert.equal(fns.validateComplianceLogRecord(complianceRecord).length, 0);
assert.equal(complianceRecord.locked, true);
assert.equal(complianceRecord.passed_failed, 'passed');

let patch = fns.buildVerifyPatch({ batch: makeBatch(), verificationData: NORMALIZED_VERIFICATION_DATA[BATCH_IDS[0]], complianceLogId: 'log_1', commandLogId: 'cmd_1', actorEmail: 'owner@example.test', requestId: 'req_1', now: '2026-06-08T05:00:00.000Z' });
assert.equal(fns.validateVerifyPatch(patch).length, 0);
assert.equal(patch.status, 'verified_logged');
assert.equal(patch.is_locked, undefined);
assert.equal(patch.ingredients_used, undefined);
assert.equal(patch.inventory_deduction_log_id, undefined);

let store = makeStore();
let preflight = await fns.preflightTargetBatches(store.base44);
assert.equal(preflight.ready, true);
store = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'in_production' } }) });
preflight = await fns.preflightTargetBatches(store.base44);
assert.equal(preflight.ready, false);
assert.ok(preflight.conflicts[0].blockers.includes('status_not_completed_pending_verification'));
store = makeStore({ complianceLogs: [{ id: 'existing_log', batch_id: BATCH_IDS[0] }] });
preflight = await fns.preflightTargetBatches(store.base44);
assert.equal(preflight.ready, false);
assert.ok(preflight.conflicts[0].blockers.includes('existing_batch_compliance_log'));

store = makeStore();
let verifyResult = await fns.verifyProductionBatches({ base44: store.base44, batches: store.store.productionBatches, verificationDataByBatchId: NORMALIZED_VERIFICATION_DATA, commandLogId: 'cmd_1', actorEmail: 'owner@example.test', requestId: 'req_1' });
assert.equal(verifyResult.updatedRows.length, 6);
assert.equal(verifyResult.complianceRows.length, 6);
assert.equal(store.store.complianceLogs.length, 6);
assert.equal(store.store.productionBatches.every(batch => batch.status === 'verified_logged'), true);
assert.equal(store.store.productionBatches.every(batch => batch.pH_result === 3.7), true);
assert.equal(store.store.productionBatches.every(batch => !('ingredients_used' in batch) || batch.ingredients_used === undefined), true);
assert.equal(store.store.otherWrites.length, 0);

store = makeStore();
let response = await handler(req(store.base44, liveBody(), 'GET'));
assert.equal(response.status, 405);
assert.equal((await json(response)).writes_performed, false);

store = makeStore({ user: new Error('no auth') });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 401);
assert.equal((await json(response)).error_code, 'unauthorized');

store = makeStore({ user: { role: 'staff', email: 'staff@example.test' } });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 403);
assert.equal((await json(response)).error_code, 'forbidden');

const disabledHarness = loadCommandHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
store = makeStore();
response = await disabledHarness.handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
let body = await json(response);
assert.equal(body.error_code, 'native_production_batch_verify_disabled');
assert.equal(body.writes_performed, false);
assert.equal(store.store.productionBatches.every(batch => batch.status === 'completed_pending_verification'), true);
assert.equal(store.store.complianceLogs.length, 0);

store = makeStore();
response = await handler(req(store.base44, liveBody({ verification_data_by_batch_id: { [BATCH_IDS[0]]: { pH_result: 3.7, pH_passed: true, batch_passed: true } } })));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'exact_verify_target_required');
assert.ok(body.blockers.some(item => item.startsWith('missing_ph_result:')));
assert.equal(store.store.complianceLogs.length, 0);

store = makeStore();
response = await handler(req(store.base44, liveBody({ sync: true })));
assert.equal(response.status, 400);
assert.equal((await json(response)).error_code, 'unsupported_request_field');

store = makeStore({ preview: makeLifecyclePreview({ ready: false }) });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'fresh_lifecycle_preview_not_clean');
assert.equal(store.store.complianceLogs.length, 0);

store = makeStore();
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 200);
body = await json(response);
assert.equal(body.success, true);
assert.equal(body.writes_performed, true);
assert.equal(body.updated_batch_count, 6);
assert.equal(body.batch_compliance_log_count, 6);
assert.equal(body.inventory_deducted, false);
assert.equal(body.purchase_orders_created, false);
assert.equal(body.customer_app_order_updated, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(store.store.commandLogs.length, 1);
assert.equal(store.store.commandLogs[0].status, 'success');

response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 200);
body = await json(response);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(store.store.commandLogs.length, 1);
assert.equal(store.store.complianceLogs.length, 6);

store = makeStore({ commandLogs: [{ id: 'failed_1', status: 'failed', idempotency_key: 'native_production_batch_verify:g31u_verify_test' }] });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'previous_failed_request_id_not_reusable');
assert.equal(store.store.complianceLogs.length, 0);

console.log('G31U native production verify tests passed');
