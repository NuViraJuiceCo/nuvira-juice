import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../..');
const fixturePath = path.join(repoRoot, 'docs/migration/fixtures/production-lifecycle-e2e/g38b-fixtures.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

const SAFETY_FALSE_FLAGS = Object.freeze({
  provider_calls: false,
  stripe_calls: false,
  shopify_calls: false,
  notifications_sent: false,
  hub_records_updated: false,
  inventory_deduction: false,
  purchase_orders_created: false,
});

const COMMAND_TYPES = Object.freeze({
  materialize: 'native_production_batch_materialization',
  start: 'native_production_batch_start',
  complete: 'native_production_batch_complete',
  verify: 'native_production_batch_verify',
});

function slugify(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStore() {
  return {
    order: clone(fixture.order),
    productionBatches: [],
    batchComplianceLogs: [],
    commandLogs: [],
    transitions: [],
    safety: { ...SAFETY_FALSE_FLAGS },
  };
}

function safetyResult(extra = {}) {
  return {
    provider_calls: false,
    stripe_calls: false,
    shopify_calls: false,
    notifications_sent: false,
    hub_records_updated: false,
    inventory_deduction: false,
    purchase_orders_created: false,
    customer_app_order_updated: false,
    native_shopify_order_updated: false,
    native_fulfillment_task_updated: false,
    ...extra,
  };
}

function assertSafety(result) {
  assert.equal(result.provider_calls, false, 'provider calls must remain false');
  assert.equal(result.stripe_calls, false, 'Stripe calls must remain false');
  assert.equal(result.shopify_calls, false, 'Shopify calls must remain false');
  assert.equal(result.notifications_sent, false, 'notifications must remain false');
  assert.equal(result.hub_records_updated, false, 'Hub mutation must remain false');
  assert.equal(result.inventory_deduction, false, 'inventory deduction must remain false');
  assert.equal(result.purchase_orders_created, false, 'PurchaseOrder creation must remain false');
}

function policyBlockers(input = {}) {
  const blockers = [];
  if (input.notification_policy && input.notification_policy !== 'NO_NOTIFICATION') blockers.push('notification_request_rejected');
  if (input.provider_call_policy && input.provider_call_policy !== 'NO_PROVIDER_CALLS') blockers.push('provider_call_request_rejected');
  if (input.hub_mutation_policy && input.hub_mutation_policy !== 'NO_HUB_MUTATION') blockers.push('hub_mutation_request_rejected');
  if (input.inventory_deduction_policy && input.inventory_deduction_policy !== 'HELD') blockers.push('inventory_deduction_request_rejected');
  if (input.purchase_order_policy && input.purchase_order_policy !== 'HELD') blockers.push('purchase_order_request_rejected');
  return blockers;
}

function commandLogFor(store, commandType, requestId) {
  return store.commandLogs.find(log => log.command_type === commandType && log.request_id === requestId && log.status === 'success');
}

function createCommandLog(store, commandType, requestId, result) {
  const log = {
    id: `synthetic_command_log_${store.commandLogs.length + 1}`,
    command_type: commandType,
    request_id: requestId,
    status: 'success',
    writes_performed: result.writes_performed === true,
    provider_calls: false,
    notifications_sent: false,
    hub_records_updated: false,
    raw_payload_written: false,
  };
  store.commandLogs.push(log);
  return log;
}

function demandPreview(store) {
  const blockers = [];
  if (store.order.order_type !== 'one_time') blockers.push('order_type_not_one_time');
  if (store.order.payment_status !== 'paid') blockers.push('payment_status_not_paid');
  if (store.order.payment_captured !== true) blockers.push('payment_not_captured');
  if (!['delivery', 'pickup'].includes(store.order.fulfillment_type)) blockers.push('fulfillment_type_not_supported');
  if (!Array.isArray(store.order.line_items) || store.order.line_items.length === 0) blockers.push('missing_line_items');
  const proposedBatches = (store.order.line_items || []).map(item => ({
    batch_id: `SYN-${store.order.order_number}-${store.order.production_date}-${slugify(item.product_name)}`,
    product_name: item.product_name,
    planned_units: item.quantity,
    status: 'planned',
    production_date: store.order.production_date,
    order_number: store.order.order_number,
  }));
  return {
    success: blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    production_ready: blockers.length === 0,
    materialization_ready: blockers.length === 0,
    proposed_batch_count: proposedBatches.length,
    proposed_batches: proposedBatches,
    blockers,
    ...safetyResult(),
  };
}

function materializeBatches(store, { request_id, ...input }) {
  const blockers = policyBlockers(input);
  if (blockers.length) return { success: false, skipped: true, writes_performed: false, blockers, ...safetyResult() };
  if (commandLogFor(store, COMMAND_TYPES.materialize, request_id)) {
    return { success: true, skipped: true, idempotent: true, writes_performed: false, production_batch_created_count: 0, ...safetyResult() };
  }
  const preview = demandPreview(store);
  if (!preview.success || !preview.materialization_ready) return { success: false, writes_performed: false, blockers: preview.blockers, ...safetyResult() };
  const existingIds = new Set(store.productionBatches.map(batch => batch.batch_id));
  const createRows = preview.proposed_batches.filter(batch => !existingIds.has(batch.batch_id));
  for (const batch of createRows) {
    store.productionBatches.push({
      ...batch,
      actual_units: null,
      actual_start_time: null,
      actual_end_time: null,
      started_by: null,
      completed_by: null,
      verified_by: null,
      pH_result: null,
      pH_passed: null,
      batch_passed: null,
      locked: false,
    });
  }
  const result = { success: true, skipped: false, writes_performed: createRows.length > 0, production_batch_created_count: createRows.length, ...safetyResult() };
  createCommandLog(store, COMMAND_TYPES.materialize, request_id, result);
  store.transitions.push(`materialized:${createRows.length}`);
  return result;
}

function startProduction(store, { request_id, actual_start_time, started_by, ...input }) {
  const blockers = policyBlockers(input);
  if (blockers.length) return { success: false, skipped: true, writes_performed: false, blockers, ...safetyResult() };
  if (commandLogFor(store, COMMAND_TYPES.start, request_id)) {
    return { success: true, skipped: true, idempotent: true, writes_performed: false, updated_batch_count: 0, ...safetyResult() };
  }
  const notPlanned = store.productionBatches.filter(batch => batch.status !== 'planned');
  if (store.productionBatches.length !== fixture.expected.final_batch_count || notPlanned.length) {
    return { success: false, writes_performed: false, blockers: ['start_requires_all_batches_planned'], ...safetyResult() };
  }
  for (const batch of store.productionBatches) {
    batch.status = 'in_production';
    batch.actual_start_time = actual_start_time;
    batch.started_by = started_by;
  }
  const result = { success: true, skipped: false, writes_performed: true, updated_batch_count: store.productionBatches.length, ...safetyResult() };
  createCommandLog(store, COMMAND_TYPES.start, request_id, result);
  store.transitions.push('started:planned->in_production');
  return result;
}

function completeProduction(store, { request_id, actual_units_by_product, actual_end_time, completed_by, ...input }) {
  const blockers = policyBlockers(input);
  if (blockers.length) return { success: false, skipped: true, writes_performed: false, blockers, ...safetyResult() };
  if (commandLogFor(store, COMMAND_TYPES.complete, request_id)) {
    return { success: true, skipped: true, idempotent: true, writes_performed: false, updated_batch_count: 0, ...safetyResult() };
  }
  if (store.productionBatches.length !== fixture.expected.final_batch_count || store.productionBatches.some(batch => batch.status !== 'in_production')) {
    return { success: false, writes_performed: false, blockers: ['complete_requires_all_batches_in_production'], ...safetyResult() };
  }
  const missing = store.productionBatches.filter(batch => Number.isFinite(actual_units_by_product?.[batch.product_name]) === false);
  if (missing.length) return { success: false, writes_performed: false, blockers: missing.map(batch => `actual_units_missing:${batch.product_name}`), ...safetyResult() };
  for (const batch of store.productionBatches) {
    batch.status = 'completed_pending_verification';
    batch.actual_units = actual_units_by_product[batch.product_name];
    batch.actual_end_time = actual_end_time;
    batch.completed_by = completed_by;
  }
  const result = { success: true, skipped: false, writes_performed: true, updated_batch_count: store.productionBatches.length, batch_compliance_log_created_count: 0, ...safetyResult() };
  createCommandLog(store, COMMAND_TYPES.complete, request_id, result);
  store.transitions.push('completed:in_production->completed_pending_verification');
  return result;
}

function verifyProduction(store, { request_id, qc_by_product, verified_by, verified_at, ...input }) {
  const blockers = policyBlockers(input);
  if (blockers.length) return { success: false, skipped: true, writes_performed: false, blockers, ...safetyResult() };
  if (commandLogFor(store, COMMAND_TYPES.verify, request_id)) {
    return { success: true, skipped: true, idempotent: true, writes_performed: false, updated_batch_count: 0, batch_compliance_log_created_count: 0, ...safetyResult() };
  }
  if (store.productionBatches.length !== fixture.expected.final_batch_count || store.productionBatches.some(batch => batch.status !== 'completed_pending_verification')) {
    return { success: false, writes_performed: false, blockers: ['verify_requires_all_batches_completed_pending_verification'], ...safetyResult() };
  }
  const qcBlockers = [];
  for (const batch of store.productionBatches) {
    const qc = qc_by_product?.[batch.product_name] || {};
    if (typeof qc.pH_result !== 'number') qcBlockers.push(`pH_result_missing:${batch.product_name}`);
    if (typeof qc.pH_passed !== 'boolean') qcBlockers.push(`pH_passed_missing:${batch.product_name}`);
    if (typeof qc.batch_passed !== 'boolean') qcBlockers.push(`batch_passed_missing:${batch.product_name}`);
  }
  if (qcBlockers.length) return { success: false, writes_performed: false, blockers: qcBlockers, ...safetyResult() };
  for (const batch of store.productionBatches) {
    const qc = qc_by_product[batch.product_name];
    batch.status = 'verified_logged';
    batch.verified_by = verified_by;
    batch.verified_at = verified_at;
    batch.pH_result = qc.pH_result;
    batch.pH_passed = qc.pH_passed;
    batch.batch_passed = qc.batch_passed;
    batch.locked = true;
    store.batchComplianceLogs.push({
      id: `synthetic_compliance_log_${store.batchComplianceLogs.length + 1}`,
      batch_id: batch.batch_id,
      product_name: batch.product_name,
      pH_result: qc.pH_result,
      pH_passed: qc.pH_passed,
      batch_passed: qc.batch_passed,
      verified_by,
      locked: true,
      raw_payload_written: false,
    });
  }
  const result = { success: true, skipped: false, writes_performed: true, updated_batch_count: store.productionBatches.length, batch_compliance_log_created_count: store.batchComplianceLogs.length, ...safetyResult() };
  createCommandLog(store, COMMAND_TYPES.verify, request_id, result);
  store.transitions.push('verified:completed_pending_verification->verified_logged');
  return result;
}

function postVerifyCascadePreview(store) {
  const verifiedBatchCount = store.productionBatches.filter(batch => batch.status === 'verified_logged').length;
  const complianceLogCount = store.batchComplianceLogs.length;
  const ready = verifiedBatchCount === fixture.expected.final_batch_count && complianceLogCount === fixture.expected.final_compliance_log_count;
  return {
    success: ready,
    dry_run: true,
    writes_performed: false,
    verified_batch_count: verifiedBatchCount,
    compliance_log_count: complianceLogCount,
    task_pack_ready: ready,
    shopify_order_bottle_ready: ready,
    customer_status_held: true,
    delivery_status_held: true,
    notification_held: true,
    blockers: ready ? [] : ['verified_batches_or_compliance_logs_missing'],
    ...safetyResult({ customer_app_order_updated: false, native_shopify_order_updated: false, native_fulfillment_task_updated: false }),
  };
}

function runPositiveLifecycle() {
  const store = createStore();
  const demand = demandPreview(store);
  assert.equal(demand.success, true);
  assert.equal(demand.dry_run, true);
  assert.equal(demand.writes_performed, false);
  assert.equal(demand.production_ready, true);
  assert.equal(demand.materialization_ready, true);
  assert.equal(demand.proposed_batch_count, 3);
  assertSafety(demand);

  const materialize = materializeBatches(store, { request_id: 'g38b_materialize_positive', ...fixture.policies });
  assert.equal(materialize.success, true);
  assert.equal(materialize.production_batch_created_count, 3);
  assert.equal(store.productionBatches.length, 3);
  assert.equal(store.commandLogs.filter(log => log.command_type === COMMAND_TYPES.materialize).length, 1);
  assertSafety(materialize);

  const materializeDup = materializeBatches(store, { request_id: 'g38b_materialize_positive', ...fixture.policies });
  assert.equal(materializeDup.skipped, true);
  assert.equal(materializeDup.idempotent, true);
  assert.equal(store.productionBatches.length, 3);
  assert.equal(store.commandLogs.filter(log => log.command_type === COMMAND_TYPES.materialize).length, 1);

  const start = startProduction(store, { request_id: 'g38b_start_positive', actual_start_time: fixture.production_actuals.actual_start_time, started_by: fixture.production_actuals.started_by, ...fixture.policies });
  assert.equal(start.success, true);
  assert.equal(start.updated_batch_count, 3);
  assert.equal(store.productionBatches.every(batch => batch.status === 'in_production'), true);
  assertSafety(start);

  const startDup = startProduction(store, { request_id: 'g38b_start_positive', actual_start_time: fixture.production_actuals.actual_start_time, started_by: fixture.production_actuals.started_by, ...fixture.policies });
  assert.equal(startDup.skipped, true);
  assert.equal(startDup.idempotent, true);

  const complete = completeProduction(store, { request_id: 'g38b_complete_positive', actual_units_by_product: fixture.production_actuals.actual_units_by_product, actual_end_time: fixture.production_actuals.actual_end_time, completed_by: fixture.production_actuals.completed_by, ...fixture.policies });
  assert.equal(complete.success, true);
  assert.equal(complete.updated_batch_count, 3);
  assert.equal(complete.batch_compliance_log_created_count, 0);
  assert.equal(store.productionBatches.every(batch => batch.status === 'completed_pending_verification'), true);
  assertSafety(complete);

  const completeDup = completeProduction(store, { request_id: 'g38b_complete_positive', actual_units_by_product: fixture.production_actuals.actual_units_by_product, actual_end_time: fixture.production_actuals.actual_end_time, completed_by: fixture.production_actuals.completed_by, ...fixture.policies });
  assert.equal(completeDup.skipped, true);
  assert.equal(completeDup.idempotent, true);

  const verify = verifyProduction(store, { request_id: 'g38b_verify_positive', qc_by_product: fixture.verification.qc_by_product, verified_by: fixture.verification.verified_by, verified_at: fixture.verification.verified_at, ...fixture.policies });
  assert.equal(verify.success, true);
  assert.equal(verify.updated_batch_count, 3);
  assert.equal(verify.batch_compliance_log_created_count, 3);
  assert.equal(store.batchComplianceLogs.length, 3);
  assert.equal(store.productionBatches.every(batch => batch.status === 'verified_logged' && batch.locked === true), true);
  assert.equal(store.batchComplianceLogs.every(log => log.locked === true), true);
  assertSafety(verify);

  const verifyDup = verifyProduction(store, { request_id: 'g38b_verify_positive', qc_by_product: fixture.verification.qc_by_product, verified_by: fixture.verification.verified_by, verified_at: fixture.verification.verified_at, ...fixture.policies });
  assert.equal(verifyDup.skipped, true);
  assert.equal(verifyDup.idempotent, true);
  assert.equal(store.batchComplianceLogs.length, 3);

  const cascade = postVerifyCascadePreview(store);
  assert.equal(cascade.success, true);
  assert.equal(cascade.dry_run, true);
  assert.equal(cascade.writes_performed, false);
  assert.equal(cascade.verified_batch_count, 3);
  assert.equal(cascade.compliance_log_count, 3);
  assert.equal(cascade.task_pack_ready, true);
  assert.equal(cascade.shopify_order_bottle_ready, true);
  assert.equal(cascade.customer_status_held, true);
  assert.equal(cascade.notification_held, true);
  assertSafety(cascade);

  return store;
}

function storeAfterMaterialize() {
  const store = createStore();
  materializeBatches(store, { request_id: 'setup_materialize', ...fixture.policies });
  return store;
}

function storeAfterStart() {
  const store = storeAfterMaterialize();
  startProduction(store, { request_id: 'setup_start', actual_start_time: fixture.production_actuals.actual_start_time, started_by: fixture.production_actuals.started_by, ...fixture.policies });
  return store;
}

function storeAfterComplete() {
  const store = storeAfterStart();
  completeProduction(store, { request_id: 'setup_complete', actual_units_by_product: fixture.production_actuals.actual_units_by_product, actual_end_time: fixture.production_actuals.actual_end_time, completed_by: fixture.production_actuals.completed_by, ...fixture.policies });
  return store;
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('positive lifecycle composes end to end', () => {
  const store = runPositiveLifecycle();
  assert.deepEqual(store.transitions, [
    'materialized:3',
    'started:planned->in_production',
    'completed:in_production->completed_pending_verification',
    'verified:completed_pending_verification->verified_logged',
  ]);
  assert.equal(store.commandLogs.length, 4);
});

test('missing actual units blocks complete command', () => {
  const store = storeAfterStart();
  const actuals = { ...fixture.production_actuals.actual_units_by_product };
  delete actuals['Watermelon Juice'];
  const result = completeProduction(store, { request_id: 'neg_missing_actual_units', actual_units_by_product: actuals, actual_end_time: fixture.production_actuals.actual_end_time, completed_by: fixture.production_actuals.completed_by, ...fixture.policies });
  assert.equal(result.success, false);
  assert.match(result.blockers.join(','), /actual_units_missing:Watermelon Juice/);
});

test('missing pH result blocks verify command', () => {
  const store = storeAfterComplete();
  const qc = clone(fixture.verification.qc_by_product);
  delete qc['Pineapple Juice'].pH_result;
  const result = verifyProduction(store, { request_id: 'neg_missing_ph', qc_by_product: qc, verified_by: fixture.verification.verified_by, verified_at: fixture.verification.verified_at, ...fixture.policies });
  assert.equal(result.success, false);
  assert.match(result.blockers.join(','), /pH_result_missing:Pineapple Juice/);
});

test('missing pH pass/fail blocks verify command', () => {
  const store = storeAfterComplete();
  const qc = clone(fixture.verification.qc_by_product);
  delete qc['RE-NU'].pH_passed;
  const result = verifyProduction(store, { request_id: 'neg_missing_ph_passed', qc_by_product: qc, verified_by: fixture.verification.verified_by, verified_at: fixture.verification.verified_at, ...fixture.policies });
  assert.equal(result.success, false);
  assert.match(result.blockers.join(','), /pH_passed_missing:RE-NU/);
});

test('missing batch pass/fail blocks verify command', () => {
  const store = storeAfterComplete();
  const qc = clone(fixture.verification.qc_by_product);
  delete qc['Watermelon Juice'].batch_passed;
  const result = verifyProduction(store, { request_id: 'neg_missing_batch_passed', qc_by_product: qc, verified_by: fixture.verification.verified_by, verified_at: fixture.verification.verified_at, ...fixture.policies });
  assert.equal(result.success, false);
  assert.match(result.blockers.join(','), /batch_passed_missing:Watermelon Juice/);
});

test('verify before complete blocks', () => {
  const store = storeAfterStart();
  const result = verifyProduction(store, { request_id: 'neg_verify_before_complete', qc_by_product: fixture.verification.qc_by_product, verified_by: fixture.verification.verified_by, verified_at: fixture.verification.verified_at, ...fixture.policies });
  assert.equal(result.success, false);
  assert.deepEqual(result.blockers, ['verify_requires_all_batches_completed_pending_verification']);
});

test('complete before start blocks', () => {
  const store = storeAfterMaterialize();
  const result = completeProduction(store, { request_id: 'neg_complete_before_start', actual_units_by_product: fixture.production_actuals.actual_units_by_product, actual_end_time: fixture.production_actuals.actual_end_time, completed_by: fixture.production_actuals.completed_by, ...fixture.policies });
  assert.equal(result.success, false);
  assert.deepEqual(result.blockers, ['complete_requires_all_batches_in_production']);
});

test('duplicate materialization does not create duplicate batches', () => {
  const store = createStore();
  materializeBatches(store, { request_id: 'dup_materialize', ...fixture.policies });
  const duplicate = materializeBatches(store, { request_id: 'dup_materialize', ...fixture.policies });
  assert.equal(duplicate.skipped, true);
  assert.equal(store.productionBatches.length, 3);
  assert.equal(store.commandLogs.filter(log => log.command_type === COMMAND_TYPES.materialize).length, 1);
});

test('duplicate verify does not create duplicate compliance logs', () => {
  const store = storeAfterComplete();
  verifyProduction(store, { request_id: 'dup_verify', qc_by_product: fixture.verification.qc_by_product, verified_by: fixture.verification.verified_by, verified_at: fixture.verification.verified_at, ...fixture.policies });
  const duplicate = verifyProduction(store, { request_id: 'dup_verify', qc_by_product: fixture.verification.qc_by_product, verified_by: fixture.verification.verified_by, verified_at: fixture.verification.verified_at, ...fixture.policies });
  assert.equal(duplicate.skipped, true);
  assert.equal(store.batchComplianceLogs.length, 3);
});

test('inventory deduction request is rejected or held', () => {
  const store = createStore();
  const result = materializeBatches(store, { request_id: 'neg_inventory_deduction', ...fixture.policies, inventory_deduction_policy: 'DEDUCT' });
  assert.equal(result.success, false);
  assert.deepEqual(result.blockers, ['inventory_deduction_request_rejected']);
  assert.equal(store.productionBatches.length, 0);
});

test('notification request is rejected or held', () => {
  const store = createStore();
  const result = materializeBatches(store, { request_id: 'neg_notification', ...fixture.policies, notification_policy: 'SEND_NOTIFICATION' });
  assert.equal(result.success, false);
  assert.deepEqual(result.blockers, ['notification_request_rejected']);
  assert.equal(store.productionBatches.length, 0);
});

const results = [];
for (const { name, fn } of tests) {
  try {
    fn();
    results.push({ name, status: 'passed' });
  } catch (error) {
    results.push({ name, status: 'failed', error: error?.stack || String(error) });
  }
}

const failed = results.filter(result => result.status === 'failed');
const finalStore = runPositiveLifecycle();
const output = {
  fixture_name: fixture.fixture_name,
  live_api_calls: false,
  live_base44_calls: false,
  dry_run_fixture_only: true,
  total_test_cases: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  lifecycle_state_transitions: finalStore.transitions,
  final_batch_count: finalStore.productionBatches.length,
  final_batch_statuses: [...new Set(finalStore.productionBatches.map(batch => batch.status))],
  final_compliance_log_count: finalStore.batchComplianceLogs.length,
  command_idempotency_summary: {
    materialize_duplicate_skipped: true,
    start_duplicate_skipped: true,
    complete_duplicate_skipped: true,
    verify_duplicate_skipped: true,
    command_log_count: finalStore.commandLogs.length,
  },
  safety_flag_summary: { ...SAFETY_FALSE_FLAGS },
  no_live_call_confirmation: 'fixture-only in-memory simulation; no Base44 SDK imports, no live function invokes, no provider calls',
  tests: results.map(result => ({ name: result.name, status: result.status })),
};

console.log(JSON.stringify(output, null, 2));

if (failed.length) {
  for (const failure of failed) console.error(`\nFAILED: ${failure.name}\n${failure.error}`);
  process.exit(1);
}
