#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const ORDER_NUMBER = 'NV-MQHJR3V2';
const CUSTOMER_APP_ORDER_ID = '6a321cbfd8d78863f15de956';
const NATIVE_SHOPIFY_ORDER_ID = '6a321d38a3819cdd5cf89031';
const NATIVE_FULFILLMENT_TASK_ID = '6a321d38071327f8218b958b';
const PRODUCTION_DATE = '2026-06-19';
const DELIVERY_DATE = '2026-06-20';
const VERIFIED_AT = '2026-06-19T20:30:00.000Z';
const VERIFIED_BY = 'Kiran Kahlon; Kirandeep Gill';
const BATCH_IDS = [
  'NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT',
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT',
];
const RECORD_IDS = {
  'NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT': '6a32c1de2fd3943a9cf171a8',
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT': '6a32c1de87810fd871f131c5',
};
const RECORD_ID_VALUES = Object.values(RECORD_IDS);
const PRODUCTS = {
  'NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT': 'Hydration Shot',
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT': 'Radiance Shot',
};
const PLANNED_UNITS = {
  'NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT': 3,
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT': 3,
};
const ACTUAL_UNITS = {
  'NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT': 3,
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT': 3,
};
const VERIFICATION_DATA_BY_RECORD_ID = {
  [RECORD_IDS[BATCH_IDS[0]]]: { pH_result: 3.7, pH_passed: true, batch_passed: true, qc_notes: 'Hydration Shot QC passed.' },
  [RECORD_IDS[BATCH_IDS[1]]]: { pH_result: 3.65, pH_passed: true, batch_passed: true, qc_notes: 'Radiance Shot QC passed.' },
};
const VERIFICATION_DATA_BY_PRODUCT = {
  'Hydration Shot': { pH_result: 3.7, pH_passed: true, batch_passed: true },
  'Radiance Shot': { pH_result: 3.65, pH_passed: true, batch_passed: true },
};
const NORMALIZED_VERIFICATION_DATA = {
  [BATCH_IDS[0]]: { pH_result: 3.7, pH_passed_failed: 'passed', passed_failed: 'passed', verification_notes: 'Hydration Shot QC passed.' },
  [BATCH_IDS[1]]: { pH_result: 3.65, pH_passed_failed: 'passed', passed_failed: 'passed', verification_notes: 'Radiance Shot QC passed.' },
};

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/verifyNativeProductionBatchesForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, getLookup, parseVerificationDataMap, validateExplicitPolicies, validateFreshPreview, preflightTargetBatches, buildComplianceLogRecord, validateComplianceLogRecord, buildVerifyPatch, validateVerifyPatch, verifyProductionBatches, requireAdmin };\n`;

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
    createClientFromRequest: req => req.__base44,
    Deno: {
      env: { get: key => env[key] || '' },
      serve: handler => { context.globalThis.__handler = handler; },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, env };
}

function makeBatches(overrides = {}) {
  return BATCH_IDS.map(batchId => ({
    id: RECORD_IDS[batchId],
    batch_id: batchId,
    product_name: PRODUCTS[batchId],
    product_category: PRODUCTS[batchId].includes('Shot') ? 'shot' : 'juice',
    status: 'completed_pending_verification',
    production_date: PRODUCTION_DATE,
    planned_units: PLANNED_UNITS[batchId],
    actual_units: ACTUAL_UNITS[batchId],
    actual_start_time: '2026-06-19T16:05:00.000Z',
    actual_end_time: '2026-06-19T20:00:00.000Z',
    started_by: 'owner@example.test',
    completed_by: 'owner@example.test',
    order_sources: [{ order_id: CUSTOMER_APP_ORDER_ID, order_number: ORDER_NUMBER, quantity: PLANNED_UNITS[batchId], source_type: 'direct', source_item: PRODUCTS[batchId] }],
    related_orders: [NATIVE_SHOPIFY_ORDER_ID],
    source_system: 'customer_app_native_order',
    native_owner_status: 'native_production_batch_materialized_from_g37e_preview',
    procurement_needed: true,
    inventory_deduction_status: 'held',
    ingredient_usage_status: 'not_started',
    ...(overrides[batchId] || {}),
  }));
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
    verification_input_preview: ready
      ? { pH_result: batch.batch_id.endsWith('HYDRATION-SHOT') ? 3.7 : 3.65, pH_passed_failed: 'passed', passed_failed: 'passed' }
      : { pH_result: null, pH_passed_failed: '', passed_failed: '' },
  }));
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    order_number: ORDER_NUMBER,
    customer_app_order_id: CUSTOMER_APP_ORDER_ID,
    native_shopify_order_id: NATIVE_SHOPIFY_ORDER_ID,
    native_fulfillment_task_id: NATIVE_FULFILLMENT_TASK_ID,
    customer_app_order_present: true,
    native_shopify_order_present: true,
    native_fulfillment_task_present: true,
    payment_status: 'paid',
    payment_captured: true,
    production_date: PRODUCTION_DATE,
    delivery_date: DELIVERY_DATE,
    batch_count: 2,
    batch_lifecycle_rows: batchRows,
    start_preview: { ready_count: 0, blocked_count: 2, already_started_count: 2 },
    complete_preview: { ready_count: 0, blocked_count: 2 },
    verify_preview: { ready_count: ready ? 2 : 0, blocked_count: ready ? 0 : 2, ready_batch_ids: ready ? BATCH_IDS : [] },
    verification_preview_ready: ready,
    blockers: [],
    warnings: ['inventory_deduction_held', 'purchase_order_automation_held', 'hub_fallback_required'],
    hub_fallback_required: true,
    inventory_deduction_ready: false,
    purchase_order_ready: false,
  };
}

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, preview = makeLifecyclePreview({ ready: true }), productionBatches = makeBatches(), commandLogs = [], complianceLogs = [] } = {}) {
  const store = {
    productionBatches: productionBatches.map(row => ({ ...row })),
    commandLogs: [...commandLogs],
    complianceLogs: [...complianceLogs],
    otherWrites: [],
  };
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
        assert.equal(body.order_number, ORDER_NUMBER);
        assert.equal(JSON.stringify(body.batch_ids), JSON.stringify(BATCH_IDS));
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
    order_number: ORDER_NUMBER,
    customer_app_order_id: CUSTOMER_APP_ORDER_ID,
    native_shopify_order_id: NATIVE_SHOPIFY_ORDER_ID,
    native_fulfillment_task_id: NATIVE_FULFILLMENT_TASK_ID,
    production_date: PRODUCTION_DATE,
    delivery_date: DELIVERY_DATE,
    selected_production_batch_ids: RECORD_ID_VALUES,
    verification_data_by_batch_id: VERIFICATION_DATA_BY_RECORD_ID,
    verified_at: VERIFIED_AT,
    verified_by: VERIFIED_BY,
    compliance_log_policy: 'CREATE_LOCKED_SAFE_LOGS',
    inventory_deduction_policy: 'HELD',
    purchase_order_policy: 'HELD',
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    policy: 'EXACT_BATCH_VERIFICATION_DATA_ONLY',
    expected_status: 'completed_pending_verification',
    request_id: 'g37h_verify_test',
    ...overrides,
  };
}

const harness = loadHarness({
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret',
  ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY: 'true',
  NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH: 'false',
  NATIVE_PRODUCTION_BATCH_VERIFY_POLICY: 'EXACT_BATCH_VERIFICATION_DATA_ONLY',
  NATIVE_PRODUCTION_BATCH_VERIFY_ALLOWED_EMAILS: 'owner@example.test',
  NATIVE_PRODUCTION_BATCH_VERIFY_ORDER_ALLOWLIST: ORDER_NUMBER,
  NATIVE_PRODUCTION_BATCH_VERIFY_BATCH_ALLOWLIST: RECORD_ID_VALUES.join(','),
});
const { exports: fns, handler, env } = harness;

let parsed = fns.parseVerificationDataMap({ verification_data_by_batch_id: VERIFICATION_DATA_BY_RECORD_ID });
assert.equal(parsed.blockers.length, 0);
assert.equal(JSON.stringify(parsed.verificationDataByBatchId), JSON.stringify(NORMALIZED_VERIFICATION_DATA));
parsed = fns.parseVerificationDataMap({ verification_data: VERIFICATION_DATA_BY_PRODUCT });
assert.equal(parsed.blockers.length, 0);
assert.equal(parsed.verificationDataByBatchId[BATCH_IDS[0]].pH_result, 3.7);
parsed = fns.parseVerificationDataMap({ verification_data_by_batch_id: { [RECORD_IDS[BATCH_IDS[0]]]: { pH_passed: true, batch_passed: true } } });
assert.ok(parsed.blockers.some(item => item.startsWith('missing_ph_result:')));
parsed = fns.parseVerificationDataMap({ verification_data: { pH_result: 'bad', pH_passed: true, batch_passed: true } });
assert.ok(parsed.blockers.includes('invalid_ph_result:global'));

let lookup = fns.getLookup(liveBody());
assert.equal(fns.exactTargetBlockers(lookup).length, 0);
assert.ok(fns.exactTargetBlockers(fns.getLookup(liveBody({ order_number: 'WRONG' }))).includes('target_order_number_mismatch'));
assert.ok(fns.exactTargetBlockers(fns.getLookup(liveBody({ production_date: '2026-06-20' }))).includes('target_production_date_mismatch'));
assert.ok(fns.exactTargetBlockers(fns.getLookup(liveBody({ selected_production_batch_ids: [RECORD_IDS[BATCH_IDS[0]]] }))).includes('target_batch_ids_mismatch'));
assert.ok(fns.exactTargetBlockers(fns.getLookup(liveBody({ selected_production_batch_ids: [...RECORD_ID_VALUES, 'extra_batch'] }))).includes('target_batch_ids_mismatch'));
assert.ok(fns.exactTargetBlockers(fns.getLookup(liveBody({ selected_production_batch_ids: ['wrong_batch_1', RECORD_IDS[BATCH_IDS[1]]] }))).includes('target_batch_ids_mismatch'));
assert.ok(fns.exactTargetBlockers(fns.getLookup(liveBody({ verified_by: '' }))).includes('verified_by_required'));
assert.ok(fns.exactTargetBlockers(fns.getLookup(liveBody({ verified_at: '' }))).includes('verified_at_required'));

assert.equal(JSON.stringify(fns.validateExplicitPolicies(liveBody())), JSON.stringify([]));
assert.ok(fns.validateExplicitPolicies(liveBody({ policy: 'WRONG' })).includes('policy_mismatch'));
assert.ok(fns.validateExplicitPolicies(liveBody({ notification_policy: 'SEND_NOTIFICATION' })).includes('notification_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ provider_call_policy: 'CALL_PROVIDERS' })).includes('provider_call_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ hub_mutation_policy: 'MUTATE_HUB' })).includes('hub_mutation_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ inventory_deduction_policy: 'DEDUCT' })).includes('inventory_deduction_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ purchase_order_policy: 'CREATE_PO' })).includes('purchase_order_requested'));

let gate = fns.gateFailure({ actorEmail: 'owner@example.test', lookup });
assert.equal(gate, null);
env.ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY = 'false';
gate = fns.gateFailure({ actorEmail: 'owner@example.test', lookup });
assert.equal(gate, 'native_production_batch_verify_disabled');
env.ENABLE_NATIVE_PRODUCTION_BATCH_VERIFY = 'true';
env.NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH = 'true';
gate = fns.gateFailure({ actorEmail: 'owner@example.test', lookup });
assert.equal(gate, 'kill_switch_active');
env.NATIVE_PRODUCTION_BATCH_VERIFY_KILL_SWITCH = 'false';

gate = fns.gateFailure({ actorEmail: 'owner@example.test', lookup: fns.getLookup(liveBody({ selected_production_batch_ids: BATCH_IDS })) });
assert.equal(gate, 'request_batch_not_allowlisted');
env.NATIVE_PRODUCTION_BATCH_VERIFY_BATCH_ALLOWLIST = BATCH_IDS.join(',');
gate = fns.gateFailure({ actorEmail: 'owner@example.test', lookup: fns.getLookup(liveBody({ selected_production_batch_ids: BATCH_IDS })) });
assert.equal(gate, null);
env.NATIVE_PRODUCTION_BATCH_VERIFY_BATCH_ALLOWLIST = RECORD_ID_VALUES.join(',');

let validation = fns.validateFreshPreview(makeLifecyclePreview({ ready: true }), lookup);
assert.equal(validation.ready, true);
validation = fns.validateFreshPreview(makeLifecyclePreview({ ready: false }), lookup);
assert.equal(validation.ready, false);
assert.ok(validation.blockers.includes('unexpected_verify_ready_count'));

let complianceRecord = fns.buildComplianceLogRecord({ batch: makeBatches()[0], verificationData: NORMALIZED_VERIFICATION_DATA[BATCH_IDS[0]], verifiedBy: VERIFIED_BY, verifiedAt: VERIFIED_AT });
assert.equal(fns.validateComplianceLogRecord(complianceRecord).length, 0);
assert.equal(complianceRecord.locked, true);
assert.equal(complianceRecord.verified_by, VERIFIED_BY);
assert.equal(complianceRecord.verified_at, VERIFIED_AT);
assert.equal(complianceRecord.passed_failed, 'passed');

let patch = fns.buildVerifyPatch({ batch: makeBatches()[0], verificationData: NORMALIZED_VERIFICATION_DATA[BATCH_IDS[0]], complianceLogId: 'log_1', commandLogId: 'cmd_1', verifiedBy: VERIFIED_BY, verifiedAt: VERIFIED_AT, requestId: 'req_1', now: VERIFIED_AT });
assert.equal(fns.validateVerifyPatch(patch).length, 0);
assert.equal(patch.status, 'verified_logged');
assert.equal(patch.verified_by, VERIFIED_BY);
assert.equal(patch.verified_at, VERIFIED_AT);
assert.equal(patch.is_locked, undefined);
assert.equal(patch.ingredients_used, undefined);
assert.equal(patch.inventory_deduction_log_id, undefined);

let store = makeStore();
let preflight = await fns.preflightTargetBatches(store.base44);
assert.equal(preflight.ready, true);
store = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { product_name: 'Wrong Product' } }) });
preflight = await fns.preflightTargetBatches(store.base44);
assert.equal(preflight.ready, false);
assert.ok(preflight.conflicts[0].blockers.includes('product_name_mismatch'));
store = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'in_production' } }) });
preflight = await fns.preflightTargetBatches(store.base44);
assert.equal(preflight.ready, false);
assert.ok(preflight.conflicts[0].blockers.includes('status_not_completed_pending_verification'));
store = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'verified_logged', verified_at: VERIFIED_AT } }) });
preflight = await fns.preflightTargetBatches(store.base44);
assert.equal(preflight.ready, false);
assert.ok(preflight.conflicts[0].blockers.includes('already_verified_logged'));
store = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { is_locked: true } }) });
preflight = await fns.preflightTargetBatches(store.base44);
assert.equal(preflight.ready, false);
assert.ok(preflight.conflicts[0].blockers.includes('batch_locked'));
store = makeStore({ complianceLogs: [{ id: 'existing_log', batch_id: BATCH_IDS[0] }] });
preflight = await fns.preflightTargetBatches(store.base44);
assert.equal(preflight.ready, false);
assert.ok(preflight.conflicts[0].blockers.includes('existing_batch_compliance_log'));

store = makeStore();
let verifyResult = await fns.verifyProductionBatches({ base44: store.base44, batches: store.store.productionBatches, verificationDataByBatchId: NORMALIZED_VERIFICATION_DATA, commandLogId: 'cmd_1', verifiedBy: VERIFIED_BY, verifiedAt: VERIFIED_AT, requestId: 'req_1' });
assert.equal(verifyResult.updatedRows.length, 2);
assert.equal(verifyResult.complianceRows.length, 2);
assert.equal(store.store.complianceLogs.length, 2);
assert.equal(store.store.complianceLogs.every(row => row.locked === true), true);
assert.equal(store.store.productionBatches.every(batch => batch.status === 'verified_logged'), true);
assert.equal(store.store.productionBatches.every(batch => batch.verified_at === VERIFIED_AT), true);
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

store = makeStore();
response = await handler(req(store.base44, liveBody({ confirmation: '' })));
assert.equal(response.status, 400);
assert.equal((await json(response)).error_code, 'confirmation_required');

store = makeStore();
response = await handler(req(store.base44, liveBody({ policy: 'WRONG' })));
assert.equal(response.status, 409);
let body = await json(response);
assert.equal(body.error_code, 'exact_verify_target_required');
assert.ok(body.blockers.includes('policy_mismatch'));
assert.equal(store.store.complianceLogs.length, 0);

const disabledHarness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
store = makeStore();
response = await disabledHarness.handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'native_production_batch_verify_disabled');
assert.equal(body.writes_performed, false);
assert.equal(store.store.productionBatches.every(batch => batch.status === 'completed_pending_verification'), true);
assert.equal(store.store.complianceLogs.length, 0);

const expectExactBlock = async (overrides, expectedBlocker) => {
  const scopedStore = makeStore();
  const scopedResponse = await handler(req(scopedStore.base44, liveBody(overrides)));
  assert.equal(scopedResponse.status, 409);
  const scopedBody = await json(scopedResponse);
  assert.equal(scopedBody.error_code, 'exact_verify_target_required');
  assert.ok(scopedBody.blockers.includes(expectedBlocker) || scopedBody.blockers.some(item => item.startsWith(expectedBlocker)), `${expectedBlocker} not found in ${JSON.stringify(scopedBody.blockers)}`);
  assert.equal(scopedStore.store.complianceLogs.length, 0);
};
await expectExactBlock({ order_number: 'WRONG' }, 'target_order_number_mismatch');
await expectExactBlock({ production_date: '2026-06-20' }, 'target_production_date_mismatch');
await expectExactBlock({ selected_production_batch_ids: [RECORD_IDS[BATCH_IDS[0]]] }, 'target_batch_ids_mismatch');
await expectExactBlock({ selected_production_batch_ids: [...RECORD_ID_VALUES, 'extra_batch'] }, 'target_batch_ids_mismatch');
await expectExactBlock({ selected_production_batch_ids: ['wrong_batch_1', RECORD_IDS[BATCH_IDS[1]]] }, 'target_batch_ids_mismatch');
await expectExactBlock({ verification_data_by_batch_id: { [RECORD_IDS[BATCH_IDS[0]]]: { pH_passed: true, batch_passed: true } } }, 'missing_ph_result:');
await expectExactBlock({ verification_data_by_batch_id: { [RECORD_IDS[BATCH_IDS[0]]]: { pH_result: 3.7, batch_passed: true }, [RECORD_IDS[BATCH_IDS[1]]]: { pH_result: 3.65, pH_passed: true, batch_passed: true } } }, 'missing_ph_pass_fail:');
await expectExactBlock({ verification_data_by_batch_id: { [RECORD_IDS[BATCH_IDS[0]]]: { pH_result: 3.7, pH_passed: true }, [RECORD_IDS[BATCH_IDS[1]]]: { pH_result: 3.65, pH_passed: true, batch_passed: true } } }, 'missing_batch_pass_fail:');
await expectExactBlock({ verified_by: '' }, 'verified_by_required');
await expectExactBlock({ verified_at: '' }, 'verified_at_required');
await expectExactBlock({ notification_policy: 'SEND_NOTIFICATION' }, 'notification_requested');
await expectExactBlock({ provider_call_policy: 'CALL_PROVIDERS' }, 'provider_call_requested');
await expectExactBlock({ hub_mutation_policy: 'MUTATE_HUB' }, 'hub_mutation_requested');
await expectExactBlock({ inventory_deduction_policy: 'DEDUCT' }, 'inventory_deduction_requested');
await expectExactBlock({ purchase_order_policy: 'CREATE_PO' }, 'purchase_order_requested');

store = makeStore({ preview: makeLifecyclePreview({ ready: false }) });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'fresh_lifecycle_preview_not_clean');
assert.equal(store.store.complianceLogs.length, 0);

store = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { product_name: 'Wrong Product' } }) });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(store.store.complianceLogs.length, 0);

store = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'in_production' } }) });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(store.store.complianceLogs.length, 0);

store = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'verified_logged', verified_at: VERIFIED_AT } }) });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(store.store.complianceLogs.length, 0);

store = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { is_locked: true } }) });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
body = await json(response);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(store.store.complianceLogs.length, 0);

store = makeStore();
response = await handler(req(store.base44, liveBody({ sync: true })));
assert.equal(response.status, 400);
assert.equal((await json(response)).error_code, 'unsupported_request_field');

store = makeStore();
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 200);
body = await json(response);
assert.equal(body.success, true);
assert.equal(body.writes_performed, true);
assert.equal(body.updated_batch_count, 2);
assert.equal(body.batch_compliance_log_count, 2);
assert.equal(body.batch_compliance_log_created, true);
assert.equal(body.inventory_deducted, false);
assert.equal(body.purchase_orders_created, false);
assert.equal(body.notifications_created, false);
assert.equal(body.notifications_sent, false);
assert.equal(body.provider_calls, false);
assert.equal(body.stripe_calls, false);
assert.equal(body.shopify_calls, false);
assert.equal(body.customer_app_order_updated, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(body.hub_records_updated, false);
assert.equal(store.store.commandLogs.length, 1);
assert.equal(store.store.commandLogs[0].status, 'success');
assert.equal(store.store.complianceLogs.length, 2);
assert.equal(store.store.complianceLogs.every(row => row.locked === true), true);
assert.equal(store.store.productionBatches.every(batch => batch.status === 'verified_logged'), true);
assert.equal(store.store.otherWrites.length, 0);
const serializedResponse = JSON.stringify(body);
const serializedLog = JSON.stringify(store.store.commandLogs[0]);
assert.equal(/@example\.test|\+?1[-.\s]?\(?\d{3}\)?|raw_payload|authorization|api_key/i.test(serializedResponse), false);
assert.equal(/raw_payload|authorization|api_key|secret|token/i.test(serializedLog), false);

response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 200);
body = await json(response);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(store.store.commandLogs.length, 1);
assert.equal(store.store.complianceLogs.length, 2);

store = makeStore({ commandLogs: [{ id: 'failed_1', status: 'failed', idempotency_key: 'native_production_batch_verify:g37h_verify_test' }] });
response = await handler(req(store.base44, liveBody()));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'previous_failed_request_id_not_reusable');
assert.equal(store.store.complianceLogs.length, 0);

console.log('G37H-BLOCK1 production verify retarget tests passed');
