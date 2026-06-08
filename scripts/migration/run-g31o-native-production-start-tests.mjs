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

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/startNativeProductionBatchesForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, validateFreshPreview, preflightTargetBatches, buildStartPatch, validateStartPatch, updateProductionBatches, requireAdmin };\n`;

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
  return BATCH_IDS.map((batchId, index) => ({
    id: `pb_${index + 1}`,
    batch_id: batchId,
    product_name: PRODUCTS[batchId],
    product_category: PRODUCTS[batchId].includes('Shot') ? 'shot' : 'juice',
    status: 'planned',
    production_date: '2026-06-05',
    planned_units: 1,
    order_sources: [{ order_id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT', quantity: 1, source_type: 'direct', source_item: PRODUCTS[batchId] }],
    related_orders: ['6a22ffda400eb806eb3ca945'],
    source_system: 'customer_app_native_order',
    native_owner_status: 'native_production_batch_materialized_from_g31k_preview',
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
    batch_lifecycle_rows: rows,
    start_preview: { action: 'start', preview_only: true, ready_count: 6, blocked_count: 0, ready_batch_ids: BATCH_IDS, blocked_rows: [], no_writes_now: true },
    complete_preview: { action: 'complete', preview_only: true, ready_count: 0, blocked_count: 6, ready_batch_ids: [], no_writes_now: true },
    verify_preview: { action: 'verify', preview_only: true, ready_count: 0, blocked_count: 6, ready_batch_ids: [], no_writes_now: true },
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
      functions: { invoke: async (name) => {
        assert.equal(name, 'previewNativeProductionBatchLifecycle');
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
  return {
    method,
    __base44: base44,
    text: async () => JSON.stringify(body),
  };
}

async function json(res) {
  return res.json();
}

function liveBody(overrides = {}) {
  return {
    mode: 'live',
    confirmation: 'start_native_production_batches_for_customer_app',
    order_number: 'NV-MPZNKGNT',
    production_date: '2026-06-05',
    batch_ids: BATCH_IDS,
    customer_app_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    expected_status: 'planned',
    request_id: 'g31o_start_test',
    ...overrides,
  };
}

const harness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const { exports: fns, handler, env } = harness;

const lookup = {
  orderNumber: 'NV-MPZNKGNT',
  productionDate: '2026-06-05',
  expectedStatus: 'planned',
  batchIds: BATCH_IDS,
  customerAppOrderId: '6a219a3f4adcda5856c3d579',
  nativeShopifyOrderId: '6a22ffda400eb806eb3ca945',
  nativeFulfillmentTaskId: '6a22ffdaf675ea79e30575aa',
};
assert.equal(fns.exactTargetBlockers(lookup).length, 0);
assert.ok(fns.exactTargetBlockers({ ...lookup, orderNumber: 'OTHER' }).includes('target_order_number_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, batchIds: BATCH_IDS.slice(0, 5) }).includes('target_batch_ids_mismatch'));
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'native_production_batch_start_disabled');

env.ENABLE_NATIVE_PRODUCTION_BATCH_START = 'true';
env.NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH = 'true';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'kill_switch_active');
env.NATIVE_PRODUCTION_BATCH_START_KILL_SWITCH = 'false';
env.NATIVE_PRODUCTION_BATCH_START_ALLOWED_EMAILS = 'owner@example.test';
env.NATIVE_PRODUCTION_BATCH_START_ORDER_ALLOWLIST = 'NV-MPZNKGNT';
env.NATIVE_PRODUCTION_BATCH_START_BATCH_ALLOWLIST = BATCH_IDS.join(',');
env.NATIVE_PRODUCTION_BATCH_START_POLICY = 'EXACT_PREVIEW_PACKET_ONLY';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), null);
assert.equal(fns.gateFailure({ actorEmail: 'staff@example.test', lookup }), 'actor_email_not_allowlisted');

const unauthStore = makeStore({ user: new Error('no auth') });
let response = await handler(req(unauthStore.base44, liveBody({ request_id: 'g31o_unauth' })));
assert.equal(response.status, 401);
assert.equal((await json(response)).error_code, 'unauthorized');

const nonAdminStore = makeStore({ user: { role: 'staff', email: 'staff@example.test' } });
response = await handler(req(nonAdminStore.base44, liveBody({ request_id: 'g31o_forbidden' })));
assert.equal(response.status, 403);
assert.equal((await json(response)).error_code, 'forbidden');

const disabledHarness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const disabledStore = makeStore();
response = await disabledHarness.handler(req(disabledStore.base44, liveBody({ request_id: 'g31o_disabled' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'native_production_batch_start_disabled');
assert.equal(disabledStore.store.productionBatches.every(batch => batch.status === 'planned'), true);
assert.equal(disabledStore.store.commandLogs.length, 0);

response = await handler(req(makeStore().base44, liveBody({ confirmation: 'wrong_phrase', request_id: 'g31o_bad_confirmation' })));
assert.equal(response.status, 400);
assert.equal((await json(response)).error_code, 'confirmation_required');

const notReady = fns.validateFreshPreview(makeLifecyclePreview({ start_preview: { ready_count: 5 }, batch_count: 6 }));
assert.equal(notReady.ready, false);
assert.ok(notReady.blockers.includes('unexpected_start_ready_count'));

const validPreview = makeLifecyclePreview();
const validation = fns.validateFreshPreview(validPreview);
assert.equal(validation.ready, true);
assert.equal(validation.rows.length, 6);

const samplePatch = fns.buildStartPatch({
  batch: makeBatches()[0],
  commandLogId: 'command_1',
  actorEmail: 'owner@example.test',
  requestId: 'g31o_patch',
  now: '2026-06-07T01:00:00.000Z',
});
assert.equal(samplePatch.status, 'in_production');
assert.equal(samplePatch.actual_units, undefined);
assert.equal(samplePatch.ingredients_used, undefined);
assert.equal(samplePatch.compliance_log_id, undefined);
assert.equal(fns.validateStartPatch(samplePatch).length, 0);
assert.ok(samplePatch.audit_trail[0].action === 'production_batch_start');

const liveStore = makeStore({ preview: validPreview });
response = await handler(req(liveStore.base44, liveBody({ request_id: 'g31o_start_live' })));
let body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.updated_batch_count, 6);
assert.equal(body.status_to, 'in_production');
assert.equal(body.inventory_deducted, false);
assert.equal(body.purchase_orders_created, false);
assert.equal(body.compliance_logs_created, false);
assert.equal(body.customer_app_order_updated, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(liveStore.store.productionBatches.every(batch => batch.status === 'in_production'), true);
assert.equal(liveStore.store.productionBatches.every(batch => Boolean(batch.actual_start_time)), true);
assert.equal(liveStore.store.productionBatches.every(batch => batch.started_by === 'owner@example.test'), true);
assert.equal(liveStore.store.productionBatches.every(batch => Array.isArray(batch.audit_trail) && batch.audit_trail.length === 1), true);
assert.equal(liveStore.store.productionBatches.every(batch => !('actual_units' in batch)), true);
assert.equal(liveStore.store.productionBatches.every(batch => !('ingredients_used' in batch)), true);
assert.equal(liveStore.store.commandLogs.length, 1);
assert.equal(liveStore.store.commandLogs[0].status, 'success');
assert.equal(liveStore.store.otherWrites.length, 0);

response = await handler(req(liveStore.base44, liveBody({ request_id: 'g31o_start_live' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(liveStore.store.commandLogs.length, 1);
assert.equal(liveStore.store.productionBatches.every(batch => batch.audit_trail.length === 1), true);

const alreadyStartedStore = makeStore({ productionBatches: makeBatches(Object.fromEntries(BATCH_IDS.map(id => [id, { status: 'in_production', actual_start_time: '2026-06-07T01:00:00.000Z', started_by: 'owner@example.test' }]))), preview: validPreview });
response = await handler(req(alreadyStartedStore.base44, liveBody({ request_id: 'g31o_already_started' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.reason, 'exact_native_batches_already_in_production');
assert.equal(alreadyStartedStore.store.productionBatches.every(batch => !Array.isArray(batch.audit_trail)), true);
assert.equal(alreadyStartedStore.store.commandLogs.length, 1);
assert.equal(alreadyStartedStore.store.commandLogs[0].status, 'skipped');

const partialStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'in_production', actual_start_time: '2026-06-07T01:00:00.000Z', started_by: 'owner@example.test' } }), preview: validPreview });
response = await handler(req(partialStore.base44, liveBody({ request_id: 'g31o_partial' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'partial_lifecycle_conflict');
assert.equal(partialStore.store.productionBatches.filter(batch => batch.status === 'in_production').length, 1);
assert.equal(partialStore.store.commandLogs.length, 0);

const lockedStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { is_locked: true } }), preview: validPreview });
response = await handler(req(lockedStore.base44, liveBody({ request_id: 'g31o_locked' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(lockedStore.store.productionBatches.every(batch => batch.status === 'planned'), true);
assert.equal(lockedStore.store.commandLogs.length, 0);

const terminalStore = makeStore({ productionBatches: makeBatches({ [BATCH_IDS[0]]: { status: 'verified_logged', verified_at: '2026-06-07T02:00:00.000Z' } }), preview: validPreview });
response = await handler(req(terminalStore.base44, liveBody({ request_id: 'g31o_terminal' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'lifecycle_conflict');
assert.equal(terminalStore.store.commandLogs.length, 0);

const mismatchStore = makeStore({ preview: makeLifecyclePreview({ start_preview: { ready_count: 6 }, batch_lifecycle_rows: validPreview.batch_lifecycle_rows.slice(0, 5) }) });
response = await handler(req(mismatchStore.base44, liveBody({ request_id: 'g31o_preview_mismatch' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'fresh_lifecycle_preview_not_clean');
assert.ok(body.blockers.includes('target_lifecycle_rows_missing'));
assert.equal(mismatchStore.store.productionBatches.every(batch => batch.status === 'planned'), true);
assert.equal(mismatchStore.store.commandLogs.length, 0);

const forbiddenStore = makeStore();
response = await handler(req(forbiddenStore.base44, liveBody({ request_id: 'g31o_forbidden_payload', actual_units: 1 })));
body = await json(response);
assert.equal(response.status, 400);
assert.equal(body.error_code, 'unsupported_request_field');
assert.equal(forbiddenStore.store.productionBatches.every(batch => batch.status === 'planned'), true);
assert.equal(forbiddenStore.store.commandLogs.length, 0);

console.log('G31O native ProductionBatch start command tests passed');
