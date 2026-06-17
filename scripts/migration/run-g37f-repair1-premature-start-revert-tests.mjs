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
const PREMATURE_START_TIME = '2026-06-17T16:59:27.000Z';
const REPAIR_SCOPE = 'REVERT_PREMATURE_START_TO_PLANNED';
const REPAIR_POLICY = 'EXACT_REVERT_PREMATURE_START_TO_PLANNED_NO_NOTIFICATION';
const REPAIR_CONFIRMATION = 'revert_premature_production_start_to_planned_no_notification';
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
  source += `\nglobalThis.__exports = { gateFailure, exactRepairTargetBlockers, validateExplicitPolicies, preflightRepairTargetBatches, buildRepairPatch, validateRepairPatch, repairProductionBatches, requireAdmin };\n`;

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
    planned_units: UNITS[batchId],
    actual_units: null,
    actual_start_time: PREMATURE_START_TIME,
    started_at: null,
    started_by: 'owner@example.test',
    actual_end_time: null,
    completed_by: null,
    verified_at: null,
    verified_by: null,
    compliance_log_id: null,
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

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, productionBatches = makeBatches(), commandLogs = [], complianceLogs = [] } = {}) {
  const store = {
    productionBatches: productionBatches.map(row => ({ ...row })),
    commandLogs: [...commandLogs],
    complianceLogs: [...complianceLogs],
    otherWrites: [],
  };
  const rowsFor = (name) => {
    if (name === 'ProductionBatch') return store.productionBatches;
    if (name === 'CommandLog') return store.commandLogs;
    if (name === 'BatchComplianceLog') return store.complianceLogs;
    return store.otherWrites;
  };
  const matchFilter = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const entityApi = (name) => ({
    filter: async (filter) => rowsFor(name).filter(row => matchFilter(row, filter)),
    create: async (payload) => {
      const row = { id: `${name.toLowerCase()}_${rowsFor(name).length + 1}`, ...payload };
      if (name === 'CommandLog') store.commandLogs.push(row);
      else if (name === 'BatchComplianceLog') store.complianceLogs.push(row);
      else store.otherWrites.push({ name, payload });
      return row;
    },
    update: async (id, patch) => {
      const row = rowsFor(name).find(item => item.id === id);
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
      functions: { invoke: async () => { throw new Error('repair mode must not invoke preview'); } },
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

async function json(res) {
  return res.json();
}

function repairBody(overrides = {}) {
  return {
    mode: 'live',
    confirmation: REPAIR_CONFIRMATION,
    repair_scope: REPAIR_SCOPE,
    order_number: ORDER_NUMBER,
    production_date: PRODUCTION_DATE,
    delivery_date: DELIVERY_DATE,
    selected_production_batch_ids: RECORD_ID_VALUES,
    current_status: 'in_production',
    target_status: 'planned',
    reason: 'Physical production has not started yet; production is expected Friday 2026-06-19.',
    clear_actual_start_time: true,
    clear_started_by: true,
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    inventory_deduction_policy: 'HELD',
    purchase_order_policy: 'HELD',
    policy: REPAIR_POLICY,
    customer_app_order_id: CUSTOMER_APP_ORDER_ID,
    native_shopify_order_id: NATIVE_SHOPIFY_ORDER_ID,
    native_fulfillment_task_id: NATIVE_FULFILLMENT_TASK_ID,
    request_id: 'g37f_repair1_test',
    ...overrides,
  };
}

const harness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const { exports: fns, handler, env } = harness;
const lookup = {
  repairScope: REPAIR_SCOPE,
  orderNumber: ORDER_NUMBER,
  productionDate: PRODUCTION_DATE,
  expectedDeliveryDate: DELIVERY_DATE,
  currentStatus: 'in_production',
  targetStatus: 'planned',
  batchIds: RECORD_ID_VALUES,
  customerAppOrderId: CUSTOMER_APP_ORDER_ID,
  nativeShopifyOrderId: NATIVE_SHOPIFY_ORDER_ID,
  nativeFulfillmentTaskId: NATIVE_FULFILLMENT_TASK_ID,
  clearActualStartTime: true,
  clearStartedBy: true,
};

assert.equal(fns.exactRepairTargetBlockers(lookup).length, 0);
assert.ok(fns.exactRepairTargetBlockers({ ...lookup, orderNumber: 'OTHER' }).includes('target_order_number_mismatch'));
assert.ok(fns.exactRepairTargetBlockers({ ...lookup, productionDate: '2026-06-18' }).includes('target_production_date_mismatch'));
assert.ok(fns.exactRepairTargetBlockers({ ...lookup, batchIds: RECORD_ID_VALUES.slice(0, 1) }).includes('target_batch_ids_mismatch'));
assert.ok(fns.exactRepairTargetBlockers({ ...lookup, batchIds: [...RECORD_ID_VALUES, 'extra'] }).includes('target_batch_ids_mismatch'));
assert.ok(fns.exactRepairTargetBlockers({ ...lookup, currentStatus: 'planned' }).includes('current_status_must_be_in_production'));
assert.ok(fns.exactRepairTargetBlockers({ ...lookup, targetStatus: 'in_production' }).includes('target_status_must_be_planned'));
assert.ok(fns.exactRepairTargetBlockers({ ...lookup, clearActualStartTime: false }).includes('clear_actual_start_time_required'));
assert.ok(fns.exactRepairTargetBlockers({ ...lookup, clearStartedBy: false }).includes('clear_started_by_required'));
assert.equal(fns.validateExplicitPolicies(repairBody(), lookup).length, 0);
assert.ok(fns.validateExplicitPolicies(repairBody({ notification_policy: 'SEND' }), lookup).includes('notification_requested'));
assert.ok(fns.validateExplicitPolicies(repairBody({ provider_call_policy: 'ALLOW' }), lookup).includes('provider_call_requested'));
assert.ok(fns.validateExplicitPolicies(repairBody({ hub_mutation_policy: 'ALLOW' }), lookup).includes('hub_mutation_requested'));
assert.ok(fns.validateExplicitPolicies(repairBody({ inventory_deduction_policy: 'DEDUCT' }), lookup).includes('inventory_deduction_requested'));
assert.ok(fns.validateExplicitPolicies(repairBody({ purchase_order_policy: 'CREATE' }), lookup).includes('purchase_order_requested'));
assert.ok(fns.validateExplicitPolicies(repairBody({ policy: 'EXACT_PREVIEW_PACKET_ONLY' }), lookup).includes('policy_mismatch'));
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'native_production_batch_start_disabled');

env.ENABLE_NATIVE_PRODUCTION_BATCH_START = 'true';
env.NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH = 'true';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'kill_switch_active');
env.NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH = 'false';
env.NATIVE_PRODUCTION_BATCH_START_ALLOWED_EMAILS = 'owner@example.test';
env.NATIVE_PRODUCTION_BATCH_START_ORDER_ALLOWLIST = [ORDER_NUMBER, CUSTOMER_APP_ORDER_ID, NATIVE_SHOPIFY_ORDER_ID, NATIVE_FULFILLMENT_TASK_ID].join(',');
env.NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST = RECORD_ID_VALUES.join(',');
env.NATIVE_PRODUCTION_BATCH_START_POLICY = REPAIR_POLICY;
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), null);
assert.equal(fns.gateFailure({ actorEmail: 'staff@example.test', lookup }), 'actor_email_not_allowlisted');

env.NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST = BATCH_IDS.join(',');
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup: { ...lookup, batchIds: BATCH_IDS } }), null);
env.NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST = RECORD_ID_VALUES.join(',');

const unauthStore = makeStore({ user: new Error('no auth') });
let response = await handler(req(unauthStore.base44, repairBody({ request_id: 'g37f_repair1_unauth' })));
assert.equal(response.status, 401);
assert.equal((await json(response)).error_code, 'unauthorized');

const disabledHarness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const disabledStore = makeStore();
response = await disabledHarness.handler(req(disabledStore.base44, repairBody({ request_id: 'g37f_repair1_disabled' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'native_production_batch_start_disabled');
assert.equal(disabledStore.store.productionBatches.every(batch => batch.status === 'in_production'), true);
assert.equal(disabledStore.store.commandLogs.length, 0);

response = await handler(req(makeStore().base44, repairBody({ confirmation: 'wrong_phrase', request_id: 'g37f_repair1_bad_confirmation' })));
assert.equal(response.status, 400);
assert.equal((await json(response)).error_code, 'confirmation_required');

response = await handler(req(makeStore().base44, repairBody({ policy: 'EXACT_PREVIEW_PACKET_ONLY', request_id: 'g37f_repair1_policy_mismatch' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'exact_premature_start_repair_approval_contract_required');

response = await handler(req(makeStore().base44, repairBody({ order_number: 'OTHER', request_id: 'g37f_repair1_wrong_order' })));
assert.equal(response.status, 409);
assert.ok((await json(response)).blockers.includes('target_order_number_mismatch'));

response = await handler(req(makeStore().base44, repairBody({ production_date: '2026-06-18', request_id: 'g37f_repair1_wrong_date' })));
assert.equal(response.status, 409);
assert.ok((await json(response)).blockers.includes('target_production_date_mismatch'));

response = await handler(req(makeStore().base44, repairBody({ selected_production_batch_ids: RECORD_ID_VALUES.slice(0, 1), request_id: 'g37f_repair1_missing_batch' })));
assert.equal(response.status, 409);
assert.ok((await json(response)).blockers.includes('target_batch_ids_mismatch'));

response = await handler(req(makeStore().base44, repairBody({ selected_production_batch_ids: [...RECORD_ID_VALUES, 'extra'], request_id: 'g37f_repair1_extra_batch' })));
assert.equal(response.status, 409);
assert.ok((await json(response)).blockers.includes('target_batch_ids_mismatch'));

const wrongStatusStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'ready_for_production' } }) });
response = await handler(req(wrongStatusStore.base44, repairBody({ request_id: 'g37f_repair1_wrong_status' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'premature_start_repair_conflict');

const alreadyPlanned = Object.fromEntries(BATCH_IDS.map(id => [id, { status: 'planned', actual_start_time: null, started_by: null, started_at: null }]));
const alreadyPlannedStore = makeStore({ productionBatches: makeBatches(alreadyPlanned) });
response = await handler(req(alreadyPlannedStore.base44, repairBody({ request_id: 'g37f_repair1_already_planned' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'already_reverted_without_matching_idempotency_log');

const partialStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'planned', actual_start_time: null, started_by: null } }) });
response = await handler(req(partialStore.base44, repairBody({ request_id: 'g37f_repair1_partial' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'partial_repair_state_detected');

const completedStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'completed_pending_verification', actual_end_time: '2026-06-19T18:00:00.000Z', completed_by: 'owner@example.test' } }) });
response = await handler(req(completedStore.base44, repairBody({ request_id: 'g37f_repair1_completed' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'premature_start_repair_conflict');

const verifiedStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'verified_logged', verified_at: '2026-06-19T18:00:00.000Z' } }) });
response = await handler(req(verifiedStore.base44, repairBody({ request_id: 'g37f_repair1_verified' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'premature_start_repair_conflict');

const lockedStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { is_locked: true } }) });
response = await handler(req(lockedStore.base44, repairBody({ request_id: 'g37f_repair1_locked' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'premature_start_repair_conflict');

const complianceStore = makeStore({ complianceLogs: [{ id: 'bcl_1', batch_id: BATCH_IDS[0], source_production_batch_id: RECORD_IDS[BATCH_IDS[0]] }] });
response = await handler(req(complianceStore.base44, repairBody({ request_id: 'g37f_repair1_compliance_present' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'premature_start_repair_conflict');

const actualUnitsStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { actual_units: 3 } }) });
response = await handler(req(actualUnitsStore.base44, repairBody({ request_id: 'g37f_repair1_actual_units_present' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'premature_start_repair_conflict');

const actualEndStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { actual_end_time: '2026-06-19T18:00:00.000Z' } }) });
response = await handler(req(actualEndStore.base44, repairBody({ request_id: 'g37f_repair1_actual_end_present' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'premature_start_repair_conflict');

const validStore = makeStore();
response = await handler(req(validStore.base44, repairBody({ request_id: 'g37f_repair1_valid' })));
let body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.repair_scope, REPAIR_SCOPE);
assert.equal(body.writes_performed, true);
assert.equal(body.production_batch_updated, true);
assert.equal(body.production_batch_records_updated, 2);
assert.equal(body.reverted_to_status, 'planned');
assert.equal(body.cleared_actual_start_time, true);
assert.equal(body.cleared_started_by, true);
assert.equal(body.batch_compliance_log_created, false);
assert.equal(body.customer_app_order_updated, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(body.inventory_deducted, false);
assert.equal(body.purchase_orders_created, false);
assert.equal(body.notifications_sent, false);
assert.equal(body.provider_calls, false);
assert.equal(body.hub_records_updated, false);
assert.equal(validStore.store.productionBatches.every(batch => batch.status === 'planned'), true);
assert.equal(validStore.store.productionBatches.every(batch => batch.actual_start_time === null), true);
assert.equal(validStore.store.productionBatches.every(batch => batch.started_by === null), true);
assert.equal(validStore.store.productionBatches.every(batch => batch.actual_units === null), true);
assert.equal(validStore.store.productionBatches.every(batch => batch.actual_end_time === null), true);
assert.equal(validStore.store.productionBatches.every(batch => !batch.compliance_log_id), true);
assert.equal(validStore.store.productionBatches.every(batch => Array.isArray(batch.audit_trail) && batch.audit_trail.length === 1), true);
assert.equal(validStore.store.commandLogs.length, 1);
assert.equal(validStore.store.commandLogs[0].status, 'success');
assert.equal(validStore.store.commandLogs[0].command_type, 'native_production_batch_start_revert');
assert.equal(validStore.store.complianceLogs.length, 0);
assert.equal(validStore.store.otherWrites.length, 0);

response = await handler(req(validStore.base44, repairBody({ request_id: 'g37f_repair1_valid' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(validStore.store.commandLogs.length, 1);
assert.equal(validStore.store.productionBatches.every(batch => batch.audit_trail.length === 1), true);

const source = fs.readFileSync(path.join(repoRoot, 'base44/functions/startNativeProductionBatchesForCustomerApp/entry.ts'), 'utf8');
assert.ok(source.includes(REPAIR_SCOPE));
assert.ok(source.includes(REPAIR_POLICY));
assert.ok(source.includes(REPAIR_CONFIRMATION));
assert.ok(!JSON.stringify(body).match(/raw_payload|stripe_id|shopify_id|full_address|phone/));

console.log('G37F-REPAIR1 premature start revert tests passed');
