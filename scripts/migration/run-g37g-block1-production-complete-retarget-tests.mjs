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
const ACTUAL_END_TIME = '2026-06-17T18:30:00.000Z';
const COMPLETED_BY = 'owner@example.test';
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
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT': 2.5,
};

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/completeNativeProductionBatchesForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, parseActualUnitsMap, validateExplicitPolicies, validateFreshPreview, preflightTargetBatches, buildCompletePatch, validateCompletePatch, updateProductionBatches, requireAdmin };\n`;

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
  return BATCH_IDS.map((batchId) => ({
    id: RECORD_IDS[batchId],
    batch_id: batchId,
    product_name: PRODUCTS[batchId],
    product_category: PRODUCTS[batchId].includes('Shot') ? 'shot' : 'juice',
    status: 'in_production',
    production_date: PRODUCTION_DATE,
    planned_units: PLANNED_UNITS[batchId],
    actual_units: null,
    actual_start_time: '2026-06-17T16:59:27.000Z',
    started_by: 'owner@example.test',
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

function makeLifecyclePreview(overrides = {}) {
  const rows = makeBatches().map(batch => ({
    production_batch_id: batch.id,
    batch_id: batch.batch_id,
    product_name: batch.product_name,
    current_status: batch.status,
    planned_units: batch.planned_units,
    actual_units: null,
    completion_actual_units_preview: ACTUAL_UNITS[batch.batch_id],
    actual_start_time: batch.actual_start_time,
    actual_end_time: null,
    production_date: batch.production_date,
    is_locked: false,
    order_source_count: 1,
    can_start: false,
    can_complete: true,
    can_verify: false,
    next_allowed_transition: 'complete',
    start_blockers: ['status_not_startable', 'already_started'],
    complete_blockers: [],
    verify_blockers: ['status_not_verifiable'],
    lifecycle_blockers: ['start:status_not_startable', 'verify:status_not_verifiable'],
    lifecycle_warnings: ['completion_v1_actual_units_only', 'inventory_deduction_held'],
    expected_complete_writes_if_approved: ['ProductionBatch.status', 'ProductionBatch.actual_end_time', 'ProductionBatch.completed_by', 'ProductionBatch.actual_units', 'ProductionBatch.audit_trail'],
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
    batch_lifecycle_rows: rows,
    start_preview: { action: 'start', preview_only: true, ready_count: 0, blocked_count: 2, already_started_count: 2, ready_batch_ids: [], no_writes_now: true },
    complete_preview: { action: 'complete', preview_only: true, ready_count: 2, blocked_count: 0, ready_batch_ids: BATCH_IDS, no_writes_now: true },
    verify_preview: { action: 'verify', preview_only: true, ready_count: 0, blocked_count: 2, ready_batch_ids: [], no_writes_now: true },
    blockers: [],
    warnings: ['inventory_deduction_held', 'purchase_order_automation_held', 'hub_fallback_required'],
    hub_fallback_required: true,
    inventory_deduction_ready: false,
    purchase_order_ready: false,
    ...overrides,
  };
}

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, preview = makeLifecyclePreview(), productionBatches = makeBatches(), commandLogs = [] } = {}) {
  const store = { productionBatches: productionBatches.map(row => ({ ...row })), commandLogs: [...commandLogs], otherWrites: [] };
  const matchFilter = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const entityApi = (name) => ({
    filter: async (filter) => {
      const rows = name === 'ProductionBatch' ? store.productionBatches : store.commandLogs;
      return rows.filter(row => matchFilter(row, filter));
    },
    create: async (payload) => {
      const row = { id: `${name.toLowerCase()}_${name === 'CommandLog' ? store.commandLogs.length + 1 : store.otherWrites.length + 1}`, ...payload };
      if (name === 'CommandLog') store.commandLogs.push(row);
      else store.otherWrites.push({ name, payload });
      return row;
    },
    update: async (id, patch) => {
      const rows = name === 'ProductionBatch' ? store.productionBatches : store.commandLogs;
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
        assert.equal(JSON.stringify(body.batch_actual_units), JSON.stringify(ACTUAL_UNITS));
        return { data: preview };
      } },
      entities: {
        ProductionBatch: entityApi('ProductionBatch'),
        CommandLog: entityApi('CommandLog'),
      },
    },
  };
  return { base44, store };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, text: async () => JSON.stringify(body) };
}

async function json(res) {
  return res.json();
}

function liveBody(overrides = {}) {
  return {
    mode: 'live',
    confirmation: 'complete_native_production_batches_for_customer_app',
    order_number: ORDER_NUMBER,
    production_date: PRODUCTION_DATE,
    delivery_date: DELIVERY_DATE,
    selected_production_batch_ids: RECORD_ID_VALUES,
    actual_units: 'Hydration Shot:3,Radiance Shot:2.5',
    actual_end_time: ACTUAL_END_TIME,
    completed_by: COMPLETED_BY,
    customer_app_order_id: CUSTOMER_APP_ORDER_ID,
    native_shopify_order_id: NATIVE_SHOPIFY_ORDER_ID,
    native_fulfillment_task_id: NATIVE_FULFILLMENT_TASK_ID,
    expected_status: 'in_production',
    policy: 'EXACT_BATCH_ACTUAL_UNITS_ONLY',
    inventory_deduction_policy: 'HELD',
    purchase_order_policy: 'HELD',
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    request_id: 'g37g_complete_test',
    ...overrides,
  };
}

const harness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const { exports: fns, handler, env } = harness;

const lookup = {
  orderNumber: ORDER_NUMBER,
  productionDate: PRODUCTION_DATE,
  expectedDeliveryDate: DELIVERY_DATE,
  expectedStatus: 'in_production',
  batchIds: RECORD_ID_VALUES,
  customerAppOrderId: CUSTOMER_APP_ORDER_ID,
  nativeShopifyOrderId: NATIVE_SHOPIFY_ORDER_ID,
  nativeFulfillmentTaskId: NATIVE_FULFILLMENT_TASK_ID,
  actualEndTime: ACTUAL_END_TIME,
  completedBy: COMPLETED_BY,
  actualUnitsByBatchId: ACTUAL_UNITS,
  blockers: [],
};

assert.equal(fns.exactTargetBlockers(lookup).length, 0);
assert.equal(fns.exactTargetBlockers({ ...lookup, batchIds: BATCH_IDS }).length, 0);
assert.ok(fns.exactTargetBlockers({ ...lookup, orderNumber: 'OTHER' }).includes('target_order_number_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, productionDate: '2026-06-18' }).includes('target_production_date_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, batchIds: RECORD_ID_VALUES.slice(0, 1) }).includes('target_batch_ids_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, actualEndTime: '' }).includes('actual_end_time_required'));
assert.ok(fns.exactTargetBlockers({ ...lookup, completedBy: '' }).includes('completed_by_required'));
assert.equal(fns.validateExplicitPolicies(liveBody()).length, 0);
assert.ok(fns.validateExplicitPolicies(liveBody({ inventory_deduction_policy: 'DEDUCT' })).includes('inventory_deduction_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ purchase_order_policy: 'CREATE' })).includes('purchase_order_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ notification_policy: 'SEND' })).includes('notification_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ provider_call_policy: 'ALLOW' })).includes('provider_call_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ hub_mutation_policy: 'ALLOW' })).includes('hub_mutation_requested'));

assert.equal(JSON.stringify(fns.parseActualUnitsMap({ actual_units: 'Hydration Shot:3,Radiance Shot:2.5' }).actualUnitsByBatchId), JSON.stringify(ACTUAL_UNITS));
assert.equal(JSON.stringify(fns.parseActualUnitsMap({ actual_units_by_batch_id: Object.fromEntries(BATCH_IDS.map(id => [id, ACTUAL_UNITS[id]])) }).actualUnitsByBatchId), JSON.stringify(ACTUAL_UNITS));
assert.equal(JSON.stringify(fns.parseActualUnitsMap({ actual_units_by_batch_id: Object.fromEntries(BATCH_IDS.map(id => [RECORD_IDS[id], ACTUAL_UNITS[id]])) }).actualUnitsByBatchId), JSON.stringify(ACTUAL_UNITS));
assert.ok(fns.parseActualUnitsMap({ actual_units: 'Hydration Shot:3' }).blockers.includes('exact_batch_actual_units_required'));
assert.ok(fns.parseActualUnitsMap({ actual_units: 'Hydration Shot:-1,Radiance Shot:2.5' }).blockers.some(item => item.startsWith('invalid_actual_units')));
assert.ok(fns.parseActualUnitsMap({ actual_units: 'Hydration Shot:3,Unknown:1' }).blockers.includes('unexpected_actual_units_product'));
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'native_production_batch_complete_disabled');

env.ENABLE_NATIVE_PRODUCTION_BATCH_COMPLETE = 'true';
env.NATIVE_PRODUCTION_BATCH_COMPLETE_KILL_SWITCH = 'true';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'kill_switch_active');
env.NATIVE_PRODUCTION_BATCH_COMPLETE_KILL_SWITCH = 'false';
env.NATIVE_PRODUCTION_BATCH_COMPLETE_ALLOWED_EMAILS = 'owner@example.test';
env.NATIVE_PRODUCTION_BATCH_COMPLETE_ORDER_ALLOWLIST = [ORDER_NUMBER, CUSTOMER_APP_ORDER_ID, NATIVE_SHOPIFY_ORDER_ID, NATIVE_FULFILLMENT_TASK_ID].join(',');
env.NATIVE_PRODUCTION_BATCH_COMPLETE_BATCH_ALLOWLIST = RECORD_ID_VALUES.join(',');
env.NATIVE_PRODUCTION_BATCH_COMPLETE_POLICY = 'EXACT_BATCH_ACTUAL_UNITS_ONLY';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), null);
assert.equal(fns.gateFailure({ actorEmail: 'staff@example.test', lookup }), 'actor_email_not_allowlisted');

env.NATIVE_PRODUCTION_BATCH_COMPLETE_BATCH_ALLOWLIST = BATCH_IDS.join(',');
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup: { ...lookup, batchIds: BATCH_IDS } }), null);
env.NATIVE_PRODUCTION_BATCH_COMPLETE_BATCH_ALLOWLIST = RECORD_ID_VALUES.join(',');

const unauthStore = makeStore({ user: new Error('no auth') });
let response = await handler(req(unauthStore.base44, liveBody({ request_id: 'g37g_unauth' })));
assert.equal(response.status, 401);
assert.equal((await json(response)).error_code, 'unauthorized');

const nonAdminStore = makeStore({ user: { role: 'staff', email: 'staff@example.test' } });
response = await handler(req(nonAdminStore.base44, liveBody({ request_id: 'g37g_forbidden' })));
assert.equal(response.status, 403);
assert.equal((await json(response)).error_code, 'forbidden');

const disabledHarness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const disabledStore = makeStore();
response = await disabledHarness.handler(req(disabledStore.base44, liveBody({ request_id: 'g37g_disabled' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'native_production_batch_complete_disabled');
assert.equal(disabledStore.store.productionBatches.every(batch => batch.status === 'in_production'), true);
assert.equal(disabledStore.store.commandLogs.length, 0);

response = await handler(req(makeStore().base44, liveBody({ confirmation: 'wrong_phrase', request_id: 'g37g_bad_confirmation' })));
assert.equal(response.status, 400);
assert.equal((await json(response)).error_code, 'confirmation_required');

response = await handler(req(makeStore().base44, liveBody({ actual_units: undefined, request_id: 'g37g_missing_units' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'exact_complete_target_required');

response = await handler(req(makeStore().base44, liveBody({ actual_end_time: '', request_id: 'g37g_missing_end' })));
assert.equal(response.status, 409);
assert.ok((await json(response)).blockers.includes('actual_end_time_required'));

response = await handler(req(makeStore().base44, liveBody({ completed_by: '', request_id: 'g37g_missing_completed_by' })));
assert.equal(response.status, 409);
assert.ok((await json(response)).blockers.includes('completed_by_required'));

const validPreview = makeLifecyclePreview();
const validation = fns.validateFreshPreview(validPreview, lookup);
assert.equal(validation.ready, true);
assert.equal(validation.rows.length, 2);

const notReady = fns.validateFreshPreview(makeLifecyclePreview({ complete_preview: { ready_count: 1 }, batch_count: 2 }), lookup);
assert.equal(notReady.ready, false);
assert.ok(notReady.blockers.includes('unexpected_complete_ready_count'));

const wrongUnitsPreview = makeLifecyclePreview({ batch_lifecycle_rows: validPreview.batch_lifecycle_rows.map((row, index) => index === 0 ? { ...row, planned_units: 1 } : row) });
assert.ok(fns.validateFreshPreview(wrongUnitsPreview, lookup).blockers.some(item => item.startsWith('lifecycle_planned_units_mismatch')));

const samplePatch = fns.buildCompletePatch({
  batch: makeBatches()[0],
  actualUnits: 3,
  commandLogId: 'command_1',
  actorEmail: 'owner@example.test',
  requestId: 'g37g_patch',
  actualEndTime: ACTUAL_END_TIME,
  completedBy: COMPLETED_BY,
});
assert.equal(samplePatch.status, 'completed_pending_verification');
assert.equal(samplePatch.actual_units, 3);
assert.equal(samplePatch.actual_end_time, ACTUAL_END_TIME);
assert.equal(samplePatch.ingredients_used, undefined);
assert.equal(samplePatch.pH_result, undefined);
assert.equal(samplePatch.compliance_log_id, undefined);
assert.equal(samplePatch.verified_at, undefined);
assert.equal(fns.validateCompletePatch(samplePatch).length, 0);
assert.ok(samplePatch.audit_trail[0].action === 'production_batch_complete');

const liveStore = makeStore({ preview: validPreview });
response = await handler(req(liveStore.base44, liveBody({ request_id: 'g37g_complete_live' })));
let body = await json(response);
if (response.status !== 200) console.error('unexpected live response', response.status, JSON.stringify(body, null, 2));
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.updated_batch_count, 2);
assert.equal(body.production_batch_records_updated, 2);
assert.equal(body.status_to, 'completed_pending_verification');
assert.equal(body.inventory_deducted, false);
assert.equal(body.purchase_orders_created, false);
assert.equal(body.compliance_logs_created, false);
assert.equal(body.customer_app_order_updated, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(liveStore.store.productionBatches.every(batch => batch.status === 'completed_pending_verification'), true);
assert.equal(liveStore.store.productionBatches.find(batch => batch.batch_id === BATCH_IDS[0]).actual_units, 3);
assert.equal(liveStore.store.productionBatches.find(batch => batch.batch_id === BATCH_IDS[1]).actual_units, 2.5);
assert.equal(liveStore.store.productionBatches.every(batch => batch.actual_end_time === ACTUAL_END_TIME), true);
assert.equal(liveStore.store.productionBatches.every(batch => batch.completed_by === COMPLETED_BY), true);
assert.equal(liveStore.store.productionBatches.every(batch => Array.isArray(batch.audit_trail) && batch.audit_trail.length === 1), true);
assert.equal(liveStore.store.productionBatches.every(batch => !('ingredients_used' in batch)), true);
assert.equal(liveStore.store.productionBatches.every(batch => !('pH_result' in batch)), true);
assert.equal(liveStore.store.productionBatches.every(batch => !('compliance_log_id' in batch)), true);
assert.equal(liveStore.store.productionBatches.every(batch => !('verified_at' in batch)), true);
assert.equal(liveStore.store.commandLogs.length, 1);
assert.equal(liveStore.store.commandLogs[0].status, 'success');
assert.equal(liveStore.store.otherWrites.length, 0);

response = await handler(req(liveStore.base44, liveBody({ request_id: 'g37g_complete_live' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(liveStore.store.commandLogs.length, 1);
assert.equal(liveStore.store.productionBatches.every(batch => batch.audit_trail.length === 1), true);

const alreadyCompletedOverrides = Object.fromEntries(BATCH_IDS.map(id => [id, { status: 'completed_pending_verification', actual_units: ACTUAL_UNITS[id], actual_end_time: ACTUAL_END_TIME, completed_by: COMPLETED_BY }]));
const alreadyCompletedStore = makeStore({ productionBatches: makeBatches(alreadyCompletedOverrides), preview: validPreview });
response = await handler(req(alreadyCompletedStore.base44, liveBody({ request_id: 'g37g_already_completed' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.reason, 'exact_native_batches_already_completed_pending_verification');
assert.equal(alreadyCompletedStore.store.commandLogs.length, 1);
assert.equal(alreadyCompletedStore.store.commandLogs[0].status, 'skipped');

const plannedStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'planned', actual_start_time: null, started_by: null } }), preview: validPreview });
response = await handler(req(plannedStore.base44, liveBody({ request_id: 'g37g_planned_blocked' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(plannedStore.store.productionBatches.filter(batch => batch.status === 'completed_pending_verification').length, 0);
assert.equal(plannedStore.store.commandLogs.length, 0);

const partialStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'completed_pending_verification', actual_units: 3, actual_end_time: ACTUAL_END_TIME, completed_by: COMPLETED_BY } }), preview: validPreview });
response = await handler(req(partialStore.base44, liveBody({ request_id: 'g37g_partial' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'partial_lifecycle_conflict');
assert.equal(partialStore.store.commandLogs.length, 0);

const lockedStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { is_locked: true } }), preview: validPreview });
response = await handler(req(lockedStore.base44, liveBody({ request_id: 'g37g_locked' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(lockedStore.store.productionBatches.every(batch => batch.status === 'in_production'), true);
assert.equal(lockedStore.store.commandLogs.length, 0);

const terminalStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'verified_logged', verified_at: '2026-06-17T19:00:00.000Z' } }), preview: validPreview });
response = await handler(req(terminalStore.base44, liveBody({ request_id: 'g37g_terminal' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(terminalStore.store.commandLogs.length, 0);

const mismatchStore = makeStore({ preview: makeLifecyclePreview({ complete_preview: { ready_count: 2 }, batch_lifecycle_rows: validPreview.batch_lifecycle_rows.slice(0, 1) }) });
response = await handler(req(mismatchStore.base44, liveBody({ request_id: 'g37g_preview_mismatch' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'fresh_lifecycle_preview_not_clean');
assert.ok(body.blockers.includes('target_lifecycle_rows_missing'));
assert.equal(mismatchStore.store.productionBatches.every(batch => batch.status === 'in_production'), true);
assert.equal(mismatchStore.store.commandLogs.length, 0);

const forbiddenStore = makeStore();
response = await handler(req(forbiddenStore.base44, liveBody({ request_id: 'g37g_forbidden_payload', ingredients_used: [] })));
body = await json(response);
assert.equal(response.status, 400);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(forbiddenStore.store.productionBatches.every(batch => batch.status === 'in_production'), true);
assert.equal(forbiddenStore.store.commandLogs.length, 0);

const source = fs.readFileSync(path.join(repoRoot, 'base44/functions/completeNativeProductionBatchesForCustomerApp/entry.ts'), 'utf8');
assert.ok(!source.includes('NV-MPZNKGNT'));
assert.ok(!source.includes('2026-06-05'));
assert.ok(source.includes(ORDER_NUMBER));
assert.ok(source.includes(RECORD_ID_VALUES[0]));
assert.ok(source.includes(RECORD_ID_VALUES[1]));
assert.ok(!JSON.stringify(body).match(/raw_payload|stripe|shopify_api_payload|full_address|phone/));

console.log('G37G-BLOCK1 ProductionBatch complete retarget tests passed');
