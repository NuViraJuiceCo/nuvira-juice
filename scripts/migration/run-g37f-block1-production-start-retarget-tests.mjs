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
const UNITS = {
  'NATIVE-NV-MQHJR3V2-2026-06-19-HYDRATION-SHOT': 3,
  'NATIVE-NV-MQHJR3V2-2026-06-19-RADIANCE-SHOT': 3,
};

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/startNativeProductionBatchesForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, validateExplicitPolicies, validateFreshPreview, preflightTargetBatches, buildStartPatch, validateStartPatch, updateProductionBatches, requireAdmin };\n`;

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
    status: 'planned',
    production_date: PRODUCTION_DATE,
    planned_units: UNITS[batchId],
    order_sources: [{ order_id: CUSTOMER_APP_ORDER_ID, order_number: ORDER_NUMBER, quantity: UNITS[batchId], source_type: 'direct', source_item: PRODUCTS[batchId] }],
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
    production_date: batch.production_date,
    is_locked: false,
    order_source_count: 1,
    can_start: true,
    can_complete: false,
    can_verify: false,
    next_allowed_transition: 'start',
    start_blockers: [],
    complete_blockers: ['status_not_completable'],
    verify_blockers: ['status_not_verifiable'],
    lifecycle_blockers: ['complete:status_not_completable', 'verify:status_not_verifiable'],
    lifecycle_warnings: ['procurement_needed_does_not_block_completion_preview', 'inventory_deduction_held'],
    expected_start_writes_if_approved: ['ProductionBatch.status', 'ProductionBatch.actual_start_time', 'ProductionBatch.started_by', 'ProductionBatch.audit_trail'],
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
    start_preview: { action: 'start', preview_only: true, ready_count: 2, blocked_count: 0, ready_batch_ids: BATCH_IDS, blocked_rows: [], no_writes_now: true },
    complete_preview: { action: 'complete', preview_only: true, ready_count: 0, blocked_count: 2, ready_batch_ids: [], no_writes_now: true },
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
        assert.deepEqual(body.batch_ids, BATCH_IDS);
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
    confirmation: 'start_native_production_batches_for_customer_app',
    order_number: ORDER_NUMBER,
    production_date: PRODUCTION_DATE,
    delivery_date: DELIVERY_DATE,
    selected_production_batch_ids: RECORD_ID_VALUES,
    customer_app_order_id: CUSTOMER_APP_ORDER_ID,
    native_shopify_order_id: NATIVE_SHOPIFY_ORDER_ID,
    native_fulfillment_task_id: NATIVE_FULFILLMENT_TASK_ID,
    expected_status: 'planned',
    actual_start_time: '2026-06-17T16:00:00.000Z',
    policy: 'EXACT_PREVIEW_PACKET_ONLY',
    inventory_deduction_policy: 'HELD',
    purchase_order_policy: 'HELD',
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    request_id: 'g37f_start_test',
    ...overrides,
  };
}

const harness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const { exports: fns, handler, env } = harness;
const lookup = {
  orderNumber: ORDER_NUMBER,
  productionDate: PRODUCTION_DATE,
  expectedDeliveryDate: DELIVERY_DATE,
  expectedStatus: 'planned',
  batchIds: RECORD_ID_VALUES,
  customerAppOrderId: CUSTOMER_APP_ORDER_ID,
  nativeShopifyOrderId: NATIVE_SHOPIFY_ORDER_ID,
  nativeFulfillmentTaskId: NATIVE_FULFILLMENT_TASK_ID,
};
assert.equal(fns.exactTargetBlockers(lookup).length, 0);
assert.equal(fns.exactTargetBlockers({ ...lookup, batchIds: BATCH_IDS }).length, 0);
assert.ok(fns.exactTargetBlockers({ ...lookup, orderNumber: 'NV-MPZNKGNT' }).includes('target_order_number_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, batchIds: RECORD_ID_VALUES.slice(0, 1) }).includes('target_batch_ids_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, productionDate: '2026-06-05' }).includes('target_production_date_mismatch'));
assert.equal(fns.validateExplicitPolicies(liveBody()).length, 0);
assert.ok(fns.validateExplicitPolicies(liveBody({ inventory_deduction_policy: 'DEDUCT' })).includes('inventory_deduction_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ notification_policy: 'SEND' })).includes('notification_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ provider_call_policy: 'CALL_PROVIDERS' })).includes('provider_call_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ hub_mutation_policy: 'ALLOW' })).includes('hub_mutation_requested'));
assert.ok(fns.validateExplicitPolicies(liveBody({ policy: 'WRONG' })).includes('policy_mismatch'));
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'native_production_batch_start_disabled');

env.ENABLE_NATIVE_PRODUCTION_BATCH_START = 'true';
env.NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH = 'true';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'kill_switch_active');
env.NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH = 'false';
env.NATIVE_PRODUCTION_BATCH_START_ALLOWED_EMAILS = 'owner@example.test';
env.NATIVE_PRODUCTION_BATCH_START_ORDER_ALLOWLIST = [ORDER_NUMBER, CUSTOMER_APP_ORDER_ID, NATIVE_SHOPIFY_ORDER_ID, NATIVE_FULFILLMENT_TASK_ID].join(',');
env.NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST = RECORD_ID_VALUES.join(',');
env.NATIVE_PRODUCTION_BATCH_START_POLICY = 'EXACT_PREVIEW_PACKET_ONLY';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), null);
assert.equal(fns.gateFailure({ actorEmail: 'staff@example.test', lookup }), 'actor_email_not_allowlisted');
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup: { ...lookup, batchIds: BATCH_IDS } }), 'request_batch_not_allowlisted');
env.NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST = BATCH_IDS.join(',');
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup: { ...lookup, batchIds: BATCH_IDS } }), null);
env.NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST = RECORD_ID_VALUES.join(',');

const unauthStore = makeStore({ user: new Error('no auth') });
let response = await handler(req(unauthStore.base44, liveBody({ request_id: 'g37f_unauth' })));
assert.equal(response.status, 401);
assert.equal((await json(response)).error_code, 'unauthorized');

const disabledHarness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const disabledStore = makeStore();
response = await disabledHarness.handler(req(disabledStore.base44, liveBody({ request_id: 'g37f_disabled' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'native_production_batch_start_disabled');
assert.equal(disabledStore.store.productionBatches.every(batch => batch.status === 'planned'), true);
assert.equal(disabledStore.store.commandLogs.length, 0);

response = await handler(req(makeStore().base44, liveBody({ confirmation: 'wrong_phrase', request_id: 'g37f_bad_confirmation' })));
assert.equal(response.status, 400);
assert.equal((await json(response)).error_code, 'confirmation_required');

response = await handler(req(makeStore().base44, liveBody({ request_id: 'g37f_bad_policy', inventory_deduction_policy: 'DEDUCT' })));
assert.equal(response.status, 409);
let body = await json(response);
assert.equal(body.error_code, 'exact_start_approval_contract_required');
assert.ok(body.blockers.includes('inventory_deduction_requested'));

const notReady = fns.validateFreshPreview(makeLifecyclePreview({ start_preview: { ready_count: 1 }, batch_count: 2 }));
assert.equal(notReady.ready, false);
assert.ok(notReady.blockers.includes('unexpected_start_ready_count'));
const wrongUnits = fns.validateFreshPreview(makeLifecyclePreview({ batch_lifecycle_rows: makeLifecyclePreview().batch_lifecycle_rows.map((row, i) => i === 0 ? { ...row, planned_units: 1 } : row) }));
assert.equal(wrongUnits.ready, false);
assert.ok(wrongUnits.blockers.some(blocker => blocker.startsWith('lifecycle_planned_units_mismatch:')));
const wrongRecord = fns.validateFreshPreview(makeLifecyclePreview({ batch_lifecycle_rows: makeLifecyclePreview().batch_lifecycle_rows.map((row, i) => i === 0 ? { ...row, production_batch_id: 'wrong' } : row) }));
assert.equal(wrongRecord.ready, false);
assert.ok(wrongRecord.blockers.some(blocker => blocker.startsWith('lifecycle_production_batch_id_mismatch:')));
const validPreview = makeLifecyclePreview();
const validation = fns.validateFreshPreview(validPreview);
assert.equal(validation.ready, true);
assert.equal(validation.rows.length, 2);

const samplePatch = fns.buildStartPatch({
  batch: makeBatches()[0],
  commandLogId: 'command_1',
  actorEmail: 'owner@example.test',
  requestId: 'g37f_patch',
  now: '2026-06-17T16:00:00.000Z',
});
assert.equal(samplePatch.status, 'in_production');
assert.equal(samplePatch.actual_start_time, '2026-06-17T16:00:00.000Z');
assert.equal(samplePatch.actual_units, undefined);
assert.equal(samplePatch.ingredients_used, undefined);
assert.equal(samplePatch.compliance_log_id, undefined);
assert.equal(fns.validateStartPatch(samplePatch).length, 0);
assert.equal(samplePatch.audit_trail[0].action, 'production_batch_start');

const liveStore = makeStore({ preview: validPreview });
response = await handler(req(liveStore.base44, liveBody({ request_id: 'g37f_start_live' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.updated_batch_count, 2);
assert.equal(body.production_batch_updated, true);
assert.equal(body.production_batch_records_updated, 2);
assert.deepEqual(body.updated_production_batch_ids.sort(), RECORD_ID_VALUES.sort());
assert.equal(body.status_to, 'in_production');
assert.equal(body.inventory_deducted, false);
assert.equal(body.purchase_orders_created, false);
assert.equal(body.batch_compliance_log_created, false);
assert.equal(body.customer_app_order_updated, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(body.notifications_sent, false);
assert.equal(body.provider_calls, false);
assert.equal(body.hub_records_updated, false);
assert.equal(body.command_log_created, true);
assert.equal(liveStore.store.productionBatches.every(batch => batch.status === 'in_production'), true);
assert.equal(liveStore.store.productionBatches.every(batch => batch.actual_start_time === '2026-06-17T16:00:00.000Z'), true);
assert.equal(liveStore.store.productionBatches.every(batch => batch.started_by === 'owner@example.test'), true);
assert.equal(liveStore.store.productionBatches.every(batch => Array.isArray(batch.audit_trail) && batch.audit_trail.length === 1), true);
assert.equal(liveStore.store.productionBatches.every(batch => !('actual_units' in batch)), true);
assert.equal(liveStore.store.productionBatches.every(batch => !('ingredients_used' in batch)), true);
assert.equal(liveStore.store.commandLogs.length, 1);
assert.equal(liveStore.store.commandLogs[0].status, 'success');
assert.equal(liveStore.store.commandLogs[0].result.production_batch_records_updated, 2);
assert.equal(liveStore.store.otherWrites.length, 0);

response = await handler(req(liveStore.base44, liveBody({ request_id: 'g37f_start_live' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(body.command_log_created, false);
assert.equal(liveStore.store.commandLogs.length, 1);
assert.equal(liveStore.store.productionBatches.every(batch => batch.audit_trail.length === 1), true);

const alreadyStartedStore = makeStore({ productionBatches: makeBatches(Object.fromEntries(BATCH_IDS.map(id => [id, { status: 'in_production', actual_start_time: '2026-06-17T16:00:00.000Z', started_by: 'owner@example.test' }]))), preview: validPreview });
response = await handler(req(alreadyStartedStore.base44, liveBody({ request_id: 'g37f_already_started' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.reason, 'exact_native_batches_already_in_production');
assert.equal(body.command_log_created, true);
assert.equal(alreadyStartedStore.store.productionBatches.every(batch => !Array.isArray(batch.audit_trail)), true);
assert.equal(alreadyStartedStore.store.commandLogs.length, 1);
assert.equal(alreadyStartedStore.store.commandLogs[0].status, 'skipped');

const partialStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'in_production', actual_start_time: '2026-06-17T16:00:00.000Z', started_by: 'owner@example.test' } }), preview: validPreview });
response = await handler(req(partialStore.base44, liveBody({ request_id: 'g37f_partial' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'partial_lifecycle_conflict');
assert.equal(partialStore.store.productionBatches.filter(batch => batch.status === 'in_production').length, 1);
assert.equal(partialStore.store.commandLogs.length, 0);

const lockedStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { is_locked: true } }), preview: validPreview });
response = await handler(req(lockedStore.base44, liveBody({ request_id: 'g37f_locked' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(lockedStore.store.productionBatches.every(batch => batch.status === 'planned'), true);
assert.equal(lockedStore.store.commandLogs.length, 0);

const terminalStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'verified_logged', verified_at: '2026-06-17T17:00:00.000Z' } }), preview: validPreview });
response = await handler(req(terminalStore.base44, liveBody({ request_id: 'g37f_terminal' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(terminalStore.store.commandLogs.length, 0);

const mismatchStore = makeStore({ preview: makeLifecyclePreview({ start_preview: { ready_count: 2 }, batch_lifecycle_rows: validPreview.batch_lifecycle_rows.slice(0, 1) }) });
response = await handler(req(mismatchStore.base44, liveBody({ request_id: 'g37f_preview_mismatch' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'fresh_lifecycle_preview_not_clean');
assert.ok(body.blockers.includes('target_lifecycle_rows_missing'));
assert.equal(mismatchStore.store.productionBatches.every(batch => batch.status === 'planned'), true);
assert.equal(mismatchStore.store.commandLogs.length, 0);

const wrongRecordStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { id: 'wrong_record' } }), preview: validPreview });
response = await handler(req(wrongRecordStore.base44, liveBody({ request_id: 'g37f_wrong_record' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(wrongRecordStore.store.commandLogs.length, 0);

const forbiddenStore = makeStore();
response = await handler(req(forbiddenStore.base44, liveBody({ request_id: 'g37f_forbidden_payload', actual_units: 1 })));
body = await json(response);
assert.equal(response.status, 400);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(forbiddenStore.store.productionBatches.every(batch => batch.status === 'planned'), true);
assert.equal(forbiddenStore.store.commandLogs.length, 0);

const source = fs.readFileSync(path.join(repoRoot, 'base44/functions/startNativeProductionBatchesForCustomerApp/entry.ts'), 'utf8');
assert.equal(source.includes('entities.BatchComplianceLog.create('), false);
assert.equal(source.includes('entities.ProductionBatch.create('), false);
assert.equal(source.includes('entities.Order.update('), false);
assert.equal(source.includes('entities.ShopifyOrder.update('), false);
assert.equal(source.includes('entities.FulfillmentTask.update('), false);
assert.equal(source.includes('entities.Notification.create('), false);
assert.equal(source.includes('entities.PurchaseOrder.create('), false);
const responseText = JSON.stringify(body);
assert.equal(/raw_provider_payload|raw_payment_payload|customer_email|phone|full address|Bearer|sk_live|pk_live/i.test(responseText), false);

console.log('G37F-BLOCK1 ProductionBatch start retarget tests passed');
