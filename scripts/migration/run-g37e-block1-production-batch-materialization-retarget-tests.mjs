#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const target = Object.freeze({
  orderNumber: 'NV-MQHJR3V2',
  customerAppOrderId: '6a321cbfd8d78863f15de956',
  nativeShopifyOrderId: '6a321d38a3819cdd5cf89031',
  nativeFulfillmentTaskId: '6a321d38071327f8218b958b',
  productionDate: '2026-06-19',
  deliveryDate: '2026-06-20',
});

const approvedRows = Object.freeze([
  { product_name: 'Hydration Shot', planned_units: 3 },
  { product_name: 'Radiance Shot', planned_units: 3 },
]);

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/materializeNativeProductionBatchesForCustomerApp/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { gateFailure, exactTargetBlockers, validateFreshPreview, validateExplicitPolicies, validateApprovedProductionBatchRows, parseApprovedProductionBatchRows, buildBatchPayload, validateBatchPayload, deterministicBatchId, preflightExistingBatches, createProductionBatches, requireAdmin };\n`;

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
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, env, source };
}

function slug(value) {
  return String(value).toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function makePreview(overrides = {}) {
  const proposedRows = approvedRows.map(row => ({
    batch_key: `BATCH-${target.productionDate}-${slug(row.product_name)}`,
    batch_id: `BATCH-${target.productionDate}-${slug(row.product_name)}`,
    production_date: target.productionDate,
    product_name: row.product_name,
    product_category: row.product_name.includes('Shot') ? 'shot' : 'juice',
    planned_units: row.planned_units,
    source_order_count: 1,
    source_order_numbers: [target.orderNumber],
    proposed_status: 'planned',
    would_create: true,
    would_update_existing: false,
    would_skip_existing: false,
    blockers: [],
    warnings: [],
  }));
  const sourceRows = approvedRows.map(row => ({
    order_number: target.orderNumber,
    native_shopify_order_id: target.nativeShopifyOrderId,
    base44_order_id: target.customerAppOrderId,
    native_fulfillment_task_id: target.nativeFulfillmentTaskId,
    product_name: row.product_name,
    quantity_contribution: row.planned_units,
    source_type: 'customer_app_native_order',
    source_line_item: row.product_name,
    demand_source_type: 'direct_line_item',
    parent_bundle: null,
    bundle_component: null,
    production_date: target.productionDate,
    delivery_date: target.deliveryDate,
  }));
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    order_number: target.orderNumber,
    customer_app_order_present: true,
    native_shopify_order_present: true,
    native_fulfillment_task_present: true,
    customer_app_order_id: target.customerAppOrderId,
    native_shopify_order_id: target.nativeShopifyOrderId,
    native_fulfillment_task_id: target.nativeFulfillmentTaskId,
    payment_status: 'paid',
    payment_captured: true,
    production_ready: true,
    materialization_ready: true,
    production_date: target.productionDate,
    delivery_date: target.deliveryDate,
    line_item_count: 2,
    proposed_production_batch_rows: proposedRows,
    proposed_order_source_rows: sourceRows,
    existing_native_batch_matches: [],
    blockers: [],
    materialization_blockers: [],
    warnings: ['mint_trace_garnish_inventory_po_held', 'inventory_deduction_held', 'purchase_order_automation_held', 'hub_fallback_required'],
    procurement_needed: true,
    procurement_conversion_ready: false,
    inventory_deduction_ready: false,
    purchase_order_ready: false,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    hub_fallback_required: true,
    safety: {
      writes_performed: false,
      provider_calls_performed: false,
      notifications_sent: false,
      hub_bridge_modified: false,
      inventory_deducted: false,
      purchase_orders_created: false,
    },
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
      functions: { invoke: async (name, body) => {
        assert.equal(name, 'previewNativeProductionDemandMaterialization');
        assert.equal(body.order_number, target.orderNumber);
        assert.equal(body.customer_app_order_id, target.customerAppOrderId);
        assert.equal(body.native_shopify_order_id, target.nativeShopifyOrderId);
        assert.equal(body.native_fulfillment_task_id, target.nativeFulfillmentTaskId);
        assert.equal(body.production_date, target.productionDate);
        assert.equal(body.delivery_date, target.deliveryDate);
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
    confirmation: 'materialize_native_production_batches_for_customer_app',
    order_number: target.orderNumber,
    customer_app_order_id: target.customerAppOrderId,
    native_shopify_order_id: target.nativeShopifyOrderId,
    native_fulfillment_task_id: target.nativeFulfillmentTaskId,
    production_date: target.productionDate,
    delivery_date: target.deliveryDate,
    approved_production_batch_rows: approvedRows,
    inventory_deduction_policy: 'HELD',
    purchase_order_policy: 'HELD',
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    request_id: 'g37e_valid_request',
    ...overrides,
  };
}

const harness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const { exports: fns, handler, env, source } = harness;

const lookup = {
  orderNumber: target.orderNumber,
  customerAppOrderId: target.customerAppOrderId,
  nativeShopifyOrderId: target.nativeShopifyOrderId,
  nativeFulfillmentTaskId: target.nativeFulfillmentTaskId,
  expectedProductionDate: target.productionDate,
  expectedDeliveryDate: target.deliveryDate,
};
assert.equal(fns.exactTargetBlockers(lookup).length, 0);
assert.ok(fns.exactTargetBlockers({ ...lookup, orderNumber: 'NV-MPZNKGNT' }).includes('target_order_number_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, customerAppOrderId: 'wrong' }).includes('target_customer_app_order_id_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, nativeShopifyOrderId: 'wrong' }).includes('target_native_shopify_order_id_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, nativeFulfillmentTaskId: 'wrong' }).includes('target_native_fulfillment_task_id_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, expectedProductionDate: '2026-06-18' }).includes('expected_production_date_mismatch'));
assert.ok(fns.exactTargetBlockers({ ...lookup, expectedDeliveryDate: '2026-06-21' }).includes('expected_delivery_date_mismatch'));

assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'native_production_batch_materialization_disabled');
env.ENABLE_NATIVE_PRODUCTION_BATCH_MATERIALIZATION = 'true';
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH = 'true';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'kill_switch_active');
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH = 'false';
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ALLOWED_EMAILS = 'owner@example.test';
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ORDER_ALLOWLIST = [target.orderNumber, target.customerAppOrderId, target.nativeShopifyOrderId, target.nativeFulfillmentTaskId].join(',');
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_POLICY = 'WRONG_POLICY';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), 'exact_preview_packet_policy_required');
env.NATIVE_PRODUCTION_BATCH_MATERIALIZATION_POLICY = 'EXACT_PREVIEW_PACKET_ONLY';
assert.equal(fns.gateFailure({ actorEmail: 'owner@example.test', lookup }), null);
assert.equal(fns.gateFailure({ actorEmail: 'staff@example.test', lookup }), 'actor_email_not_allowlisted');

assert.equal(JSON.stringify(fns.parseApprovedProductionBatchRows('Hydration Shot:3,Radiance Shot:3')), JSON.stringify(approvedRows));
assert.equal(fns.validateApprovedProductionBatchRows(approvedRows).length, 0);
assert.ok(fns.validateApprovedProductionBatchRows([{ product_name: 'Hydration Shot', planned_units: 3 }]).includes('approved_production_batch_row_count_mismatch'));
assert.ok(fns.validateApprovedProductionBatchRows([...approvedRows, { product_name: 'Aura', planned_units: 1 }]).includes('approved_production_batch_row_count_mismatch'));
assert.ok(fns.validateApprovedProductionBatchRows([{ product_name: 'Hydration Shot', planned_units: 2 }, approvedRows[1]]).includes('approved_planned_units_mismatch:Hydration Shot'));
assert.ok(fns.validateExplicitPolicies({ inventory_deduction_policy: 'DEDUCT' }).includes('inventory_deduction_requested'));
assert.ok(fns.validateExplicitPolicies({ purchase_order_policy: 'CREATE_PURCHASE_ORDER' }).includes('purchase_order_requested'));
assert.ok(fns.validateExplicitPolicies({ notification_policy: 'SEND' }).includes('notification_requested'));
assert.ok(fns.validateExplicitPolicies({ provider_call_policy: 'CALL_PROVIDERS' }).includes('provider_call_requested'));
assert.ok(fns.validateExplicitPolicies({ hub_mutation_policy: 'MUTATE_HUB' }).includes('hub_mutation_requested'));

const unauthStore = makeStore({ user: new Error('no auth') });
let response = await handler(req(unauthStore.base44, liveBody({ request_id: 'g37e_unauth' })));
assert.equal(response.status, 401);
assert.equal((await json(response)).error_code, 'unauthorized');

const disabledHarness = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
const disabledStore = makeStore();
response = await disabledHarness.handler(req(disabledStore.base44, liveBody({ request_id: 'g37e_disabled' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'native_production_batch_materialization_disabled');
assert.equal(disabledStore.store.productionBatches.length, 0);
assert.equal(disabledStore.store.commandLogs.length, 0);

response = await handler(req(makeStore().base44, liveBody({ confirmation: 'wrong', request_id: 'g37e_confirmation_missing' })));
assert.equal(response.status, 400);
assert.equal((await json(response)).error_code, 'confirmation_required');

for (const [field, value, expectedBlocker] of [
  ['order_number', 'OTHER', 'target_order_number_mismatch'],
  ['customer_app_order_id', 'wrong', 'target_customer_app_order_id_mismatch'],
  ['native_shopify_order_id', 'wrong', 'target_native_shopify_order_id_mismatch'],
  ['native_fulfillment_task_id', 'wrong', 'target_native_fulfillment_task_id_mismatch'],
  ['production_date', '2026-06-18', 'expected_production_date_mismatch'],
  ['delivery_date', '2026-06-21', 'expected_delivery_date_mismatch'],
]) {
  response = await handler(req(makeStore().base44, liveBody({ [field]: value, request_id: `g37e_wrong_${field}` })));
  const body = await json(response);
  assert.equal(response.status, 409);
  assert.equal(body.error_code, 'exact_target_required');
  assert.ok(body.blockers.includes(expectedBlocker));
}

for (const [field, value, expectedBlocker] of [
  ['inventory_deduction_policy', 'DEDUCT', 'inventory_deduction_requested'],
  ['purchase_order_policy', 'CREATE', 'purchase_order_requested'],
  ['notification_policy', 'SEND_NOTIFICATION', 'notification_requested'],
  ['provider_call_policy', 'CALL_PROVIDERS', 'provider_call_requested'],
  ['hub_mutation_policy', 'MUTATE_HUB', 'hub_mutation_requested'],
]) {
  response = await handler(req(makeStore().base44, liveBody({ [field]: value, request_id: `g37e_bad_${field}` })));
  const body = await json(response);
  assert.equal(response.status, 409);
  assert.equal(body.error_code, 'exact_materialization_approval_contract_required');
  assert.ok(body.blockers.includes(expectedBlocker));
}

const badApprovedRowsCases = [
  [[{ product_name: 'Hydration Shot', planned_units: 3 }], 'approved_production_batch_row_count_mismatch'],
  [[approvedRows[0], { product_name: 'Aura', planned_units: 1 }], 'approved_production_batch_products_mismatch'],
  [[approvedRows[0], { product_name: 'Radiance Shot', planned_units: 2 }], 'approved_planned_units_mismatch:Radiance Shot'],
];
for (const [index, [rows, expectedBlocker]] of badApprovedRowsCases.entries()) {
  response = await handler(req(makeStore().base44, liveBody({ approved_production_batch_rows: rows, request_id: `g37e_bad_rows_${index}` })));
  const body = await json(response);
  assert.equal(response.status, 409);
  assert.equal(body.error_code, 'exact_materialization_approval_contract_required');
  assert.ok(body.blockers.includes(expectedBlocker));
}

const noSecretHarness = loadHarness({
  ENABLE_NATIVE_PRODUCTION_BATCH_MATERIALIZATION: 'true',
  NATIVE_PRODUCTION_BATCH_MATERIALIZATION_KILL_SWITCH: 'false',
  NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ALLOWED_EMAILS: 'owner@example.test',
  NATIVE_PRODUCTION_BATCH_MATERIALIZATION_ORDER_ALLOWLIST: target.orderNumber,
  NATIVE_PRODUCTION_BATCH_MATERIALIZATION_POLICY: 'EXACT_PREVIEW_PACKET_ONLY',
});
response = await noSecretHarness.handler(req(makeStore().base44, liveBody({ request_id: 'g37e_no_preview_secret' })));
assert.equal(response.status, 409);
assert.equal((await json(response)).error_code, 'preview_secret_not_configured');

for (const [preview, blocker] of [
  [makePreview({ materialization_ready: false }), 'fresh_preview_materialization_not_ready'],
  [makePreview({ blockers: ['missing_recipe'] }), 'fresh_preview_contains_blockers'],
  [makePreview({ proposed_production_batch_rows: makePreview().proposed_production_batch_rows.slice(0, 1) }), 'unexpected_proposed_batch_count'],
  [makePreview({ proposed_production_batch_rows: [...makePreview().proposed_production_batch_rows, { ...makePreview().proposed_production_batch_rows[0], product_name: 'Aura' }] }), 'unexpected_proposed_batch_count'],
  [makePreview({ proposed_production_batch_rows: [makePreview().proposed_production_batch_rows[0], { ...makePreview().proposed_production_batch_rows[1], planned_units: 2 }] }), 'unexpected_planned_units:Radiance Shot'],
  [makePreview({ existing_native_batch_matches: [{ id: 'existing' }] }), 'fresh_preview_existing_native_batch_matches_present'],
  [makePreview({ inventory_deduction_ready: true }), 'inventory_deduction_should_remain_held'],
  [makePreview({ purchase_order_ready: true }), 'purchase_order_should_remain_held'],
  [makePreview({ provider_call_impact: true }), 'provider_call_impact_should_remain_false'],
  [makePreview({ notifications_sent: true }), 'notifications_should_remain_held'],
  [makePreview({ hub_mutation_performed: true }), 'hub_mutation_should_remain_false'],
]) {
  const validation = fns.validateFreshPreview(preview);
  assert.equal(validation.ready, false, blocker);
  assert.ok(validation.blockers.includes(blocker), blocker);
}

const validPreview = makePreview();
const validation = fns.validateFreshPreview(validPreview);
assert.equal(validation.ready, true);
assert.equal(validation.proposedRows.length, 2);

const samplePayload = fns.buildBatchPayload({
  row: validPreview.proposed_production_batch_rows[0],
  preview: validPreview,
  commandLogId: 'command_1',
  actorEmail: 'owner@example.test',
  requestId: 'g37e_payload',
});
assert.equal(samplePayload.status, 'planned');
assert.equal(samplePayload.actual_units, undefined);
assert.equal(samplePayload.ingredients_used, undefined);
assert.equal(samplePayload.inventory_deduction_log_id, undefined);
assert.equal(samplePayload.inventory_deduction_status, 'held');
assert.equal(fns.validateBatchPayload(samplePayload).length, 0);
assert.ok(samplePayload.batch_id.startsWith(`NATIVE-${target.orderNumber}-${target.productionDate}-`));

const liveStore = makeStore({ preview: validPreview });
response = await handler(req(liveStore.base44, liveBody({ request_id: 'g37e_create' })));
let body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.success, true);
assert.equal(body.skipped, false);
assert.equal(body.writes_performed, true);
assert.equal(body.production_batch_created, true);
assert.equal(body.production_batch_records_created, 2);
assert.equal(body.created_batch_count, 2);
assert.deepEqual(body.created_product_names, ['Hydration Shot', 'Radiance Shot']);
assert.equal(body.batch_compliance_log_created, false);
assert.equal(body.inventory_deducted, false);
assert.equal(body.purchase_orders_created, false);
assert.equal(body.notifications_created, false);
assert.equal(body.notifications_sent, false);
assert.equal(body.provider_calls, false);
assert.equal(body.stripe_calls, false);
assert.equal(body.shopify_calls, false);
assert.equal(body.hub_records_updated, false);
assert.equal(body.customer_app_order_updated, false);
assert.equal(body.native_shopify_order_updated, false);
assert.equal(body.native_fulfillment_task_updated, false);
assert.equal(body.command_log_created, true);
assert.equal(liveStore.store.productionBatches.length, 2);
assert.equal(liveStore.store.commandLogs.length, 1);
assert.equal(liveStore.store.commandLogs[0].status, 'success');
assert.equal(liveStore.store.otherWrites.length, 0);
assert.ok(liveStore.store.productionBatches.every(batch => batch.status === 'planned'));
assert.ok(liveStore.store.productionBatches.every(batch => batch.inventory_deduction_status === 'held'));
assert.ok(liveStore.store.productionBatches.every(batch => !('actual_units' in batch)));
assert.ok(liveStore.store.productionBatches.every(batch => !('ingredients_used' in batch)));
assert.ok(liveStore.store.productionBatches.every(batch => batch.order_sources.every(source => source.order_number === target.orderNumber)));

response = await handler(req(liveStore.base44, liveBody({ request_id: 'g37e_create' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.idempotent, true);
assert.equal(body.writes_performed, false);
assert.equal(body.production_batch_created, false);
assert.equal(liveStore.store.productionBatches.length, 2);
assert.equal(liveStore.store.commandLogs.length, 1);

const existingRows = validPreview.proposed_production_batch_rows.map(row => ({
  id: `existing_${row.product_name}`,
  batch_id: fns.deterministicBatchId(row),
  product_name: row.product_name,
  production_date: target.productionDate,
  status: 'planned',
  planned_units: row.planned_units,
  order_sources: [{ order_id: target.customerAppOrderId, order_number: target.orderNumber, quantity: row.planned_units, source_type: 'direct', source_item: row.product_name }],
}));

const partialExistingStore = makeStore({ preview: validPreview, productionBatches: [existingRows[0]] });
response = await handler(req(partialExistingStore.base44, liveBody({ request_id: 'g37e_partial_existing' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'production_batch_conflict');
assert.ok(body.blockers.includes('partial_existing_batch_state_blocks_materialization'));
assert.equal(partialExistingStore.store.productionBatches.length, 1);
assert.equal(partialExistingStore.store.commandLogs.length, 0);

const dedupeStore = makeStore({ preview: validPreview, productionBatches: existingRows });
response = await handler(req(dedupeStore.base44, liveBody({ request_id: 'g37e_dedupe' })));
body = await json(response);
assert.equal(response.status, 200);
assert.equal(body.skipped, true);
assert.equal(body.production_batch_created, false);
assert.equal(body.production_batch_records_created, 0);
assert.equal(body.skipped_existing_count, 2);
assert.equal(body.command_log_created, true);
assert.equal(dedupeStore.store.productionBatches.length, 2);
assert.equal(dedupeStore.store.commandLogs.length, 1);
assert.equal(dedupeStore.store.commandLogs[0].status, 'skipped');

const conflictStore = makeStore({
  preview: validPreview,
  productionBatches: [{
    id: 'conflict_hydration',
    batch_id: `BATCH-${target.productionDate}-HYDRATION-SHOT`,
    product_name: 'Hydration Shot',
    production_date: target.productionDate,
    status: 'in_production',
    is_locked: true,
    planned_units: 10,
    order_sources: [{ order_number: 'OTHER', quantity: 10 }],
  }],
});
response = await handler(req(conflictStore.base44, liveBody({ request_id: 'g37e_conflict' })));
body = await json(response);
assert.equal(response.status, 409);
assert.equal(body.error_code, 'production_batch_conflict');
assert.equal(conflictStore.store.productionBatches.length, 1);
assert.equal(conflictStore.store.commandLogs.length, 0);

response = await handler(req(makeStore().base44, liveBody({ request_id: 'g37e_forbidden_payload', deduct_inventory: true })));
body = await json(response);
assert.equal(response.status, 400);
assert.equal(body.error_code, 'unsupported_request_field');

const responseText = JSON.stringify(body) + JSON.stringify(liveStore.store.commandLogs);
assert.equal(/raw_provider_payload|raw_payment_payload|customer_email|phone|full address|Bearer|sk_live|pk_live/i.test(responseText), false);
assert.equal(source.includes('TARGET_ORDER_NUMBER = \'NV-MQHJR3V2\''), true);
assert.equal(source.includes('TARGET_ORDER_NUMBER = \'NV-MPZNKGNT\''), false);
assert.equal(source.includes('entities.BatchComplianceLog.create('), false);
assert.equal(source.includes('entities.Order.update('), false);
assert.equal(source.includes('entities.ShopifyOrder.update('), false);
assert.equal(source.includes('entities.FulfillmentTask.update('), false);

console.log('G37E-BLOCK1 ProductionBatch materialization retarget tests passed');
