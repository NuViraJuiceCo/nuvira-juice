#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/materializeNativeProductionBatchesForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, validateFreshPreview, buildBatchPayload, validateBatchPayload, deterministicBatchId, preflightExistingBatches, createProductionBatches, requireAdmin };\n`;

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

function makePreview(overrides = {}) {
  const products = ['Aura', 'Oasis', 'Pineapple Juice', 'Radiance Shot', 'Re-Nu', 'Reset Shot'];
  const proposedRows = products.map(product => ({
    batch_key: `BATCH-2026-06-05-${product.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    batch_id: `BATCH-2026-06-05-${product.toUpperCase().replace(/[^A-Z0-9]+/g, '-')}`,
    production_date: '2026-06-05',
    product_name: product,
    product_category: product.includes('Shot') ? 'shot' : 'juice',
    planned_units: 1,
    source_order_count: 1,
    source_order_numbers: ['NV-MPZNKGNT'],
    proposed_status: 'planned',
    would_create: true,
    would_update_existing: false,
    would_skip_existing: false,
    blockers: [],
    warnings: [],
  }));
  const sourceRows = products.map(product => ({
    order_number: 'NV-MPZNKGNT',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    product_name: product,
    quantity_contribution: 1,
    source_type: 'customer_app_native_order',
    source_line_item: product === 'Aura' || product === 'Oasis' || product === 'Re-Nu' ? 'The NuVira Trio' : product,
    demand_source_type: product === 'Aura' || product === 'Oasis' || product === 'Re-Nu' ? 'bundle_component' : 'direct_line_item',
    parent_bundle: product === 'Aura' || product === 'Oasis' || product === 'Re-Nu' ? 'The NuVira Trio' : null,
    bundle_component: product === 'Aura' || product === 'Oasis' || product === 'Re-Nu' ? product : null,
    production_date: '2026-06-05',
    delivery_date: '2026-06-06',
  }));
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    order_number: 'NV-MPZNKGNT',
    customer_app_order_present: true,
    native_shopify_order_present: true,
    native_fulfillment_task_present: true,
    customer_app_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
    payment_status: 'paid',
    payment_captured: true,
    production_ready: true,
    materialization_ready: true,
    production_date: '2026-06-05',
    delivery_date: '2026-06-06',
    line_item_count: 4,
    proposed_production_batch_rows: proposedRows,
    proposed_order_source_rows: sourceRows,
    blockers: [],
    materialization_blockers: [],
    warnings: ['procurement_needed', 'inventory_deduction_held', 'purchase_order_automation_held', 'hub_fallback_required'],
    procurement_needed: true,
    procurement_conversion_ready: false,
    inventory_deduction_ready: false,
    hub_fallback_required: true,
    ...overrides,
  };
}

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, preview = makePreview(), productionBatches = [], commandLogs = [] } = {}) {
  const store = { productionBatches: [...productionBatches], commandLogs: [...commandLogs], otherWrites: [] };
  const matchFilter = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const entityApi = (name) => ({
    filter: async (filter) => {
      const rows = name === 'ProductionBatch' ? store.productionBatches : store.commandLogs;
      return rows.filter(row => matchFilter(row, filter));
    },
    create: async (payload) => {
      const row = { id: `${name.toLowerCase()}_${name === 'ProductionBatch' ? store.productionBatches.length + 1 : store.commandLogs.length + 1}`, ...payload };
      if (name === 'ProductionBatch') store.productionBatches.push(row);
      else if (name === 'CommandLog') store.commandLogs.push(row);
      else store.otherWrites.push({ name, payload });
      return row;
    },
    update: async (id, patch) => {
      const rows = name === 'ProductionBatch' ? store.productionBatches : store.commandLogs;
      const row = rows.find(item => item.id === id);
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
        assert.equal(name, 'previewNativeProductionDemandMaterialization');
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

const harness = loadHarness({
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret',
});
const { exports: fns, handler, env } = harness;

const lookup = {
  orderNumber: 'NV-MPZNKGNT',
  customerAppOrderId: '6a219a3f4adcda5856c3d579',
  nativeShopifyOrderId: '6a22ffda400eb806eb3ca945',
  nativeFulfillmentTaskId: '6a22ffdaf675ea79e30575aa',
};
assert.equal(fns.exactTargetBlockers(lookup).length, 0);
assert.ok(fns.exactTargetBlockers({ ...lookup, orderNumber: 'OTHER' }).includes('target_order_number_mismatch'));
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'native_production_batch_materialization_disabled');

env.ENABLE_NATIVE_PRODUCTION_BATCH_MATERIALIZATION = 'true';
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH = 'true';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'kill_switch_active');
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH = 'false';
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ALLOWED_EMAILS = 'owner@example.test';
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ORDER_ALLOWLIST = 'NV-MPZNKGNT';
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_POLICY = 'EXACT_PREVIEW_PACKET_ONLY';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), null);
assert.equal(fns.gateFailure({ actorEmail: 'staff@example.test', lookup }), 'actor_email_not_allowlisted');

const unauthStore = makeStore({ user: new Error('no auth') });
let response = await handler(req(unauthStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  request_id: 'g31l_unauth',
}));
assert.equal(response.status, 401);
assert.equal((await json(response)).error_code, 'unauthorized');

const nonAdminStore = makeStore({ user: { role: 'staff', email: 'staff@example.test' } });
response = await handler(req(nonAdminStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  request_id: 'g31l_forbidden',
}));
assert.equal(response.status, 403);
assert.equal((await json(response)).error_code, 'forbidden');

const disabledHarness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const disabledStore = makeStore();
response = await disabledHarness.handler(req(disabledStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  request_id: 'g31l_disabled',
}));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'native_production_batch_materialization_disabled');
assert.equal(disabledStore.store.productionBatches.length, 0);
assert.equal(disabledStore.store.commandLogs.length, 0);

const notReadyValidation = fns.validateFreshPreview(makePreview({ materialization_ready: false, materialization_blockers: ['missing_recipe:Oasis'] }));
assert.equal(notReadyValidation.ready, false);
assert.ok(notReadyValidation.blockers.includes('fresh_preview_materialization_not_ready'));

const validPreview = makePreview();
const validation = fns.validateFreshPreview(validPreview);
assert.equal(validation.ready, true);
assert.equal(validation.proposedRows.length, 6);

const samplePayload = fns.buildBatchPayload({
  row: validPreview.proposed_production_batch_rows[0],
  preview: validPreview,
  commandLogId: 'command_1',
  actorEmail: 'owner@example.test',
  requestId: 'g31l_payload',
});
assert.equal(samplePayload.status, 'planned');
assert.equal(samplePayload.actual_units, undefined);
assert.equal(samplePayload.ingredients_used, undefined);
assert.equal(samplePayload.inventory_deduction_log_id, undefined);
assert.equal(fns.validateBatchPayload(samplePayload).length, 0);
assert.ok(samplePayload.batch_id.startsWith('NATIVE-NV-MPZNKGNT-2026-06-05-'));

const liveStore = makeStore({ preview: validPreview });
response = await handler(req(liveStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  customer_app_order_id: '6a219a3f4adcda5856c3d579',
  native_shopify_order_id: '6a22ffda400eb806eb3ca945',
  native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
  expected_production_date: '2026-06-05',
  request_id: 'g31l_create',
}));
let body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.created_batch_count, 6);
assert.equal(body.inventory_deducted, false);
assert.equal(body.purchase_orders_created, false);
assert.equal(body.customer_app_order_updated, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(liveStore.store.productionBatches.length, 6);
assert.equal(liveStore.store.commandLogs.length, 1);
assert.equal(liveStore.store.commandLogs[0].status, 'success');
assert.equal(liveStore.store.otherWrites.length, 0);
assert.ok(liveStore.store.productionBatches.every(batch => batch.status === 'planned'));
assert.ok(liveStore.store.productionBatches.every(batch => batch.inventory_deduction_status === 'held'));
assert.ok(liveStore.store.productionBatches.every(batch => !('actual_units' in batch)));
assert.ok(liveStore.store.productionBatches.every(batch => !('ingredients_used' in batch)));

response = await handler(req(liveStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  request_id: 'g31l_create',
}));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(liveStore.store.productionBatches.length, 6);
assert.equal(liveStore.store.commandLogs.length, 1);

const existingRows = validPreview.proposed_production_batch_rows.map(row => ({
  id: `existing_${row.product_name}`,
  batch_id: fns.deterministicBatchId(row),
  product_name: row.product_name,
  production_date: '2026-06-05',
  status: 'planned',
  planned_units: 1,
  order_sources: [{ order_id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT', quantity: 1, source_type: 'direct', source_item: row.product_name }],
}));

const partialExistingStore = makeStore({
  preview: validPreview,
  productionBatches: [existingRows[0]],
});
response = await handler(req(partialExistingStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  request_id: 'g31l_partial_existing',
}));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.created_batch_count, 5);
assert.equal(body.skipped_existing_count, 1);
assert.equal(partialExistingStore.store.productionBatches.length, 6);
assert.equal(partialExistingStore.store.commandLogs.length, 1);
assert.equal(partialExistingStore.store.commandLogs[0].status, 'success');

const dedupeStore = makeStore({ preview: validPreview, productionBatches: existingRows });
response = await handler(req(dedupeStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  request_id: 'g31l_dedupe',
}));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.production_batches_created, false);
assert.equal(body.skipped_existing_count, 6);
assert.equal(dedupeStore.store.productionBatches.length, 6);
assert.equal(dedupeStore.store.commandLogs.length, 1);
assert.equal(dedupeStore.store.commandLogs[0].status, 'skipped');

const conflictStore = makeStore({
  preview: validPreview,
  productionBatches: [{
    id: 'conflict_aura',
    batch_id: 'BATCH-2026-06-05-AURA',
    product_name: 'Aura',
    production_date: '2026-06-05',
    status: 'in_production',
    is_locked: true,
    planned_units: 10,
    order_sources: [{ order_number: 'OTHER', quantity: 10 }],
  }],
});
response = await handler(req(conflictStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  request_id: 'g31l_conflict',
}));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'production_batch_conflict');
assert.equal(conflictStore.store.productionBatches.length, 1);
assert.equal(conflictStore.store.commandLogs.length, 0);

const mismatchStore = makeStore({ preview: makePreview({ proposed_production_batch_rows: validPreview.proposed_production_batch_rows.slice(0, 5) }) });
response = await handler(req(mismatchStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  request_id: 'g31l_mismatch',
}));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'fresh_materialization_preview_not_clean');
assert.ok(body.blockers.includes('unexpected_proposed_batch_count'));
assert.equal(mismatchStore.store.productionBatches.length, 0);
assert.equal(mismatchStore.store.commandLogs.length, 0);

response = await handler(req(liveStore.base44, {
  mode: 'live',
  confirmation: 'materialize_native_production_batches_for_customer_app',
  order_number: 'NV-MPZNKGNT',
  request_id: 'g31l_forbidden_payload',
  deduct_inventory: true,
}));
body = await json(response);
assert.equal(response.status, 400);
assert.equal(body.error_code, 'unsupported_request_field');

console.log('G31L native ProductionBatch materialization command tests passed');
