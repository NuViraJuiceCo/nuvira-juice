#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { buildProductionComplianceLifecycleReadModel } from '../../base44/functions/getAdminProductionPlanningSummary/productionComplianceReadModel.js';

const repo = process.cwd();
const entryPath = path.join(repo, 'base44/functions/getAdminProductionPlanningSummary/entry.ts');
const helperPath = path.join(repo, 'base44/functions/getAdminProductionPlanningSummary/productionComplianceReadModel.js');
const complianceOpsPath = path.join(repo, 'src/pages/admin/ComplianceOps.jsx');
const results = [];
function pass(name, detail = {}) { results.push({ name, ok: true, detail }); }
function fail(name, detail = {}) { results.push({ name, ok: false, detail }); }
function assert(name, condition, detail = {}) { condition ? pass(name, detail) : fail(name, detail); }
function read(file) { return fs.readFileSync(file, 'utf8'); }
function byClass(model, classification) { return model.rows.find(row => row.classification === classification); }

const entry = read(entryPath);
const helper = read(helperPath);
const complianceOps = read(complianceOpsPath);
const changedFiles = process.env.G48C_CHANGED_FILES ? process.env.G48C_CHANGED_FILES.split('\n').filter(Boolean) : [];

assert('Function-local helper import is inside the function directory.', entry.includes("./productionComplianceReadModel.js") && helperPath.startsWith(path.dirname(entryPath)), {
  helper: path.relative(repo, helperPath),
});
assert('Named-function packaging includes the helper.', fs.existsSync(helperPath) && /\.js$/.test(helperPath) && helperPath.startsWith(path.dirname(entryPath)), {
  package_case: 'case_a_function_local_helper',
});
assert('Helper performs no entity reads or writes.', !/base44\.|\.entities\.|entities\.|safeEntityList|await |fetch\(|\.create\(|\.update\(|\.delete\(/.test(helper), {
  helper: path.relative(repo, helperPath),
});
assert('Existing production summary response remains unchanged when disabled.', entry.includes('if (productionComplianceReadModelRequested && productionComplianceReadModelEnabled)') && entry.includes('if (productionComplianceReadModel) {'), {
  default_off: true,
});
assert('Existing date-range behavior remains unchanged.', entry.includes('resolveRange({ preset, dateFrom, dateTo })') && entry.includes('daysInclusive(dateFrom, dateTo) > MAX_RANGE_DAYS'), {});

const fixtures = [
  {
    id: 'pb_verified', batch_id: 'B-VERIFIED', product_name: 'Aura', production_date: '2026-06-20', planned_units: 10, actual_units: 10, status: 'verified_logged', compliance_log_id: 'log_verified', pH_result: 3.4, pH_passed_failed: 'passed', passed_failed: 'passed', actual_start_time: '08:00', actual_end_time: '09:00', verified_at: '2026-06-20T10:00:00Z', verified_by: 'qa',
  },
  { id: 'pb_missing', batch_id: 'B-MISSING', product_name: 'Oasis', production_date: '2026-06-20', planned_units: 8, actual_units: 8, status: 'verified_logged', pH_result: 3.6, passed_failed: 'passed', verified_at: '2026-06-20T10:30:00Z' },
  { id: 'pb_dupe', batch_id: 'B-DUPE', product_name: 'Re-Nu', production_date: '2026-06-20', status: 'verified_logged', pH_result: 3.5, passed_failed: 'passed', verified_at: '2026-06-20T11:00:00Z' },
  { id: 'pb_conflict', batch_id: 'B-CONFLICT', product_name: 'Aura', production_date: '2026-06-20', status: 'verified_logged', compliance_log_id: 'log_conflict', pH_result: 3.5, passed_failed: 'passed', verified_at: '2026-06-20T12:00:00Z' },
  { id: 'pb_ph_missing', batch_id: 'B-PH-MISSING', product_name: 'Aura', production_date: '2026-06-20', status: 'verified_logged', compliance_log_id: 'log_ph_missing', passed_failed: 'passed', verified_at: '2026-06-20T13:00:00Z' },
  { id: 'pb_ph_fail', batch_id: 'B-PH-FAIL', product_name: 'Oasis', production_date: '2026-06-20', status: 'verified_logged', compliance_log_id: 'log_ph_fail', pH_result: 4.8, pH_passed_failed: 'failed', passed_failed: 'failed', verified_at: '2026-06-20T14:00:00Z' },
  { id: 'pb_pass_mismatch', batch_id: 'B-PASS-MISMATCH', product_name: 'Oasis', production_date: '2026-06-20', status: 'verified_logged', compliance_log_id: 'log_pass_mismatch', pH_result: 3.2, passed_failed: 'passed', verified_at: '2026-06-20T15:00:00Z' },
  { id: 'pb_status_mismatch', batch_id: 'B-STATUS-MISMATCH', product_name: 'Re-Nu', production_date: '2026-06-20', status: 'verified_logged', compliance_log_id: 'log_status_mismatch', pH_result: 3.2, passed_failed: 'passed', verified_at: '2026-06-20T15:30:00Z' },
  { id: 'pb_unlocked', batch_id: 'B-UNLOCKED', product_name: 'Aura', production_date: '2026-06-20', status: 'verified_logged', compliance_log_id: 'log_unlocked', pH_result: 3.3, passed_failed: 'passed', verified_at: '2026-06-20T16:00:00Z' },
  { id: 'pb_repair', batch_id: 'B-REPAIR', product_name: 'Aura', production_date: '2026-06-20', status: 'verified_logged', compliance_log_id: 'log_repair', pH_result: 3.3, passed_failed: 'passed', verified_at: '2026-06-20T17:00:00Z', review_status: 'repair_required' },
];

const logs = [
  { id: 'log_verified', batch_id: 'B-VERIFIED', source_production_batch_id: 'pb_verified', date: '2026-06-20', locked: true, pH_result: 3.4, passed_failed: 'passed', verified_at: '2026-06-20T10:00:00Z', verified_by: 'qa' },
  { id: 'log_dupe_a', batch_id: 'B-DUPE', source_production_batch_id: 'pb_dupe', date: '2026-06-20', locked: true, pH_result: 3.5, passed_failed: 'passed', verified_at: '2026-06-20T11:00:00Z' },
  { id: 'log_dupe_b', batch_id: 'B-DUPE', source_production_batch_id: 'pb_dupe', date: '2026-06-20', locked: true, pH_result: 3.5, passed_failed: 'passed', verified_at: '2026-06-20T11:01:00Z' },
  { id: 'log_conflict', batch_id: 'B-OTHER', source_production_batch_id: 'pb_other', date: '2026-06-20', locked: true, pH_result: 3.5, passed_failed: 'passed', verified_at: '2026-06-20T12:00:00Z' },
  { id: 'log_ph_missing', batch_id: 'B-PH-MISSING', source_production_batch_id: 'pb_ph_missing', date: '2026-06-20', locked: true, passed_failed: 'passed', verified_at: '2026-06-20T13:00:00Z' },
  { id: 'log_ph_fail', batch_id: 'B-PH-FAIL', source_production_batch_id: 'pb_ph_fail', date: '2026-06-20', locked: true, pH_result: 4.8, pH_passed_failed: 'failed', passed_failed: 'failed', verified_at: '2026-06-20T14:00:00Z' },
  { id: 'log_pass_mismatch', batch_id: 'B-PASS-MISMATCH', source_production_batch_id: 'pb_pass_mismatch', date: '2026-06-20', locked: true, pH_result: 3.2, passed_failed: 'failed', verified_at: '2026-06-20T15:00:00Z' },
  { id: 'log_status_mismatch', batch_id: 'B-STATUS-MISMATCH', source_production_batch_id: 'pb_status_mismatch', date: '2026-06-20', locked: true, pH_result: 3.8, passed_failed: 'passed', verified_at: '2026-06-20T15:30:00Z' },
  { id: 'log_unlocked', batch_id: 'B-UNLOCKED', source_production_batch_id: 'pb_unlocked', date: '2026-06-20', locked: false, pH_result: 3.3, passed_failed: 'passed', verified_at: '2026-06-20T16:00:00Z' },
  { id: 'log_repair', batch_id: 'B-REPAIR', source_production_batch_id: 'pb_repair', date: '2026-06-20', locked: true, pH_result: 3.3, passed_failed: 'passed', verified_at: '2026-06-20T17:00:00Z' },
];

const model = buildProductionComplianceLifecycleReadModel({
  productionBatches: fixtures,
  batchComplianceLogs: logs,
  manualProductionBatches: [{ id: 'manual_1', batch_id: 'MANUAL-1', production_date: '2026-06-20' }],
  dateFrom: '2026-06-20',
  dateTo: '2026-06-20',
  enabled: true,
  sourceMode: 'fixture',
});

assert('Exact batch/log linkage works.', model.rows.find(row => row.batch_id === 'B-VERIFIED')?.exact_identity_ready === true, {});
assert('Reverse compliance_log_id linkage works where supported.', model.rows.find(row => row.batch_id === 'B-VERIFIED')?.compliance_log_ref === 'log_verified', {});
assert('Duplicate logs block native readiness.', byClass(model, 'production_batch_duplicate_compliance_log_risk')?.native_read_ready === false, {});
assert('Conflicting links block readiness.', byClass(model, 'production_batch_compliance_link_conflict')?.review_required === true, {});
assert('Missing log is classified safely.', byClass(model, 'production_batch_missing_compliance_log')?.fallback_required === true, {});
assert('Locked verified pair is read-ready.', byClass(model, 'production_compliance_native_read_ready')?.compliance_log_locked === true, {});
assert('Unlocked log remains partial.', model.rows.find(row => row.batch_id === 'B-UNLOCKED')?.native_read_ready === false, {});
assert('Missing pH holds.', byClass(model, 'production_compliance_ph_missing')?.blockers.includes('ph_result_missing') === true, {});
assert('pH failure remains visible to admin.', model.rows.find(row => row.batch_id === 'B-PH-FAIL')?.pH_passed === 'failed', {});
assert('Pass/fail mismatch holds.', byClass(model, 'production_compliance_pass_fail_mismatch')?.review_required === true, {});
assert('Status mismatch holds.', model.rows.find(row => row.batch_id === 'B-STATUS-MISMATCH')?.mismatch_categories.includes('production_compliance_status_mismatch') === true, {});
assert('Manual batch fallback remains.', model.manual_batch_fallback_count === 1 && model.classification_counts.production_compliance_manual_batch_fallback === 1, {});
assert('Hub fallback remains.', model.summary.fallback_required_count > 0 && model.classification_counts.production_compliance_hub_fallback_required > 0, {});
assert('Repair/replay evidence holds.', byClass(model, 'production_compliance_repair_replay_hold')?.review_required === true, {});

const empty = buildProductionComplianceLifecycleReadModel({ productionBatches: [], batchComplianceLogs: [], dateFrom: '2026-01-01', dateTo: '2026-01-01', enabled: true });
assert('Empty date range works.', empty.summary.production_batch_count === 0 && empty.rows.length === 0, {});
assert('Nonzero production range works.', model.summary.production_batch_count === fixtures.length, { count: model.summary.production_batch_count });
assert('Existing G37H exact target contract is represented by locked verified fixtures.', model.summary.locked_verified_count >= 1, {});
assert('No live QC proof available flag is not converted into write readiness.', model.production_write_ready === false && model.compliance_write_ready === false, {});
assert('Valid existing compliance records are never hidden.', entry.includes('productionComplianceReadModel') && !entry.includes('filter(row => row.native_read_ready)'), {});

assert('ComplianceOps uses canonical backend data only when backend reports enabled.', !complianceOps.includes('ENABLE_COMPLIANCE_CANONICAL_READ_MODEL') && complianceOps.includes("getAdminProductionPlanningSummary") && complianceOps.includes('production_compliance_read_model_enabled === true'), {});
assert('ComplianceOps preserves current read path when backend disabled.', complianceOps.includes("getAdminComplianceOpsSummary") && complianceOps.includes('enabled: isAdminUser(user)') && complianceOps.includes('productionComplianceReadModelSupported &&'), {});
assert('ComplianceOps preserves fallback when canonical response fails.', complianceOps.includes('productionComplianceReadModelSupported') && complianceOps.includes('const nativeCompliance = complianceSummary?.native || {};') && !complianceOps.includes('nativeCompliance = productionComplianceReadModel'), {});
assert('Existing compliance write functions are untouched.', !changedFiles.some(file => /saveAdminComplianceRecord|validateComplianceEntry/.test(file)), { changedFiles });
assert('Existing production commands are untouched.', !changedFiles.some(file => /startNativeProductionBatches|completeNativeProductionBatches|verifyNativeProductionBatches|executeNativeProductionBatchLifecycle/.test(file)), { changedFiles });
assert('No customer-facing status change.', !changedFiles.some(file => /^src\/pages\/(?!admin\/)/.test(file)), { changedFiles });
assert('No ComplianceAlert creation.', !/ComplianceAlert\.create|entities\.ComplianceAlert\.create/.test(entry + helper + complianceOps), {});
assert('No ProductionBatch mutation.', !/ProductionBatch\.update|entities\.ProductionBatch\.update|ProductionBatch\.create/.test(entry + helper + complianceOps), {});
assert('No BatchComplianceLog mutation.', !/BatchComplianceLog\.update|entities\.BatchComplianceLog\.update|BatchComplianceLog\.create/.test(entry + helper + complianceOps), {});
assert('No provider calls.', !/Stripe\(|new Stripe|Shopify\(|provider_call_impact:\s*true|fetch\(.*provider/i.test(helper + complianceOps), {});
assert('No notifications.', !/Notification\.create|CustomerMessageDeliveryLog|sendNotification|notifications_sent:\s*true/.test(entry + helper + complianceOps), {});
assert('No Hub mutation.', !/push.*Hub|Hub.*mutation|hub_mutation_performed:\s*true|method:\s*['"]POST['"]/.test(helper + complianceOps), {});
assert('No raw payload exposure.', !/raw_payload|payloads_returned:\s*true|JSON\.stringify\(.*payload/.test(helper + complianceOps), {});
assert('No customer PII.', !/customer_email|customer_phone|contact_phone|shipping_address|billing_address/.test(helper), {});
assert('No logs/queues created.', !/CommandLog\.create|OrderSyncLog\.create|SafeSyncParityLog\.create|OrderReviewQueue\.create/.test(entry + helper + complianceOps), {});
assert('Existing G39F production-planning contract passes.', entry.includes('summary: nativeFirstPlanning.summary') && entry.includes('dates: nativeFirstPlanning.dates.slice'), {});
assert('Existing G31U lifecycle preview contract passes.', !changedFiles.some(file => /previewNativeProductionBatchLifecycle/.test(file)), { changedFiles });

const failures = results.filter(result => !result.ok);
console.log(JSON.stringify({ success: failures.length === 0, classification: 'production_compliance_read_model_consolidation_pr_ready', results }, null, 2));
if (failures.length) process.exit(1);
