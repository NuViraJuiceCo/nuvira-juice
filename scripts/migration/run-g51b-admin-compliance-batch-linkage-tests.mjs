#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const repo = process.cwd();
const results = [];
function pass(name, detail = {}) { results.push({ name, ok: true, detail }); }
function fail(name, detail = {}) { results.push({ name, ok: false, detail }); }
function assert(name, condition, detail = {}) { condition ? pass(name, detail) : fail(name, detail); }
function read(file) { return fs.readFileSync(path.join(repo, file), 'utf8'); }
function readJson(file) { return JSON.parse(read(file)); }

const sanitationSchema = readJson('base44/entities/SanitationLog.jsonc');
const temperatureSchema = readJson('base44/entities/TemperatureLog.jsonc');
const checklistSchema = readJson('base44/entities/DailyChecklist.jsonc');
const saveEntry = read('base44/functions/saveAdminComplianceRecord/entry.ts');
const complianceSummaryEntry = read('base44/functions/getAdminComplianceOpsSummary/entry.ts');
const productionQueue = read('src/pages/admin/ProductionQueueSummary.jsx');
const preStartModal = read('src/components/admin/ProductionPreStartModal.jsx');
const productionQueueEntry = read('base44/functions/getAdminProductionQueueSummary/entry.ts');
const previewStartEntry = read('base44/functions/previewAdminProductionBatchStart/entry.ts');
const liveStartEntry = read('base44/functions/startAdminProductionBatch/entry.ts');
const complianceOps = read('src/pages/admin/ComplianceOps.jsx');
const unifiedComplianceForm = read('src/components/compliance/UnifiedComplianceForm.jsx');
const sanitationLogForm = read('src/components/compliance/SanitationLogForm.jsx');
const criticalCi = read('scripts/ci/run-critical-regressions.mjs');

function hasProps(schema, props) {
  return props.every(prop => Object.prototype.hasOwnProperty.call(schema.properties || {}, prop));
}

const linkProps = ['batch_id', 'source_production_batch_id', 'related_batch_ids', 'related_source_production_batch_ids'];

assert('SanitationLog supports structured production batch linkage.', hasProps(sanitationSchema, linkProps), {
  schema: 'SanitationLog',
});
assert('TemperatureLog supports structured production batch linkage.', hasProps(temperatureSchema, linkProps), {
  schema: 'TemperatureLog',
});
assert('DailyChecklist supports structured production batch linkage.', hasProps(checklistSchema, linkProps), {
  schema: 'DailyChecklist',
});
assert('DailyChecklist schema allows pre-production completion state used by the UI.', checklistSchema.properties?.overall_status?.enum?.includes('Pre-Production Complete') === true, {});
assert('DailyChecklist keeps existing required fields unchanged.', JSON.stringify(checklistSchema.required || []) === JSON.stringify(['checklist_date', 'staff_member', 'shift']), {
  required: checklistSchema.required,
});

assert('saveAdminComplianceRecord centralizes batch link sanitization.', saveEntry.includes('function batchLinkFields(data)') && saveEntry.includes('related_source_production_batch_ids'), {});
assert('Temperature records persist batch link fields.', /function temperatureRecord[\s\S]*\.\.\.batchLinkFields\(data\)[\s\S]*location:/.test(saveEntry), {});
assert('Sanitation records persist batch link fields.', /function sanitationRecord[\s\S]*\.\.\.batchLinkFields\(data\)[\s\S]*area:/.test(saveEntry), {});
assert('Daily checklist records persist batch link fields.', /function checklistRecord[\s\S]*const linkFields = batchLinkFields\(data\)[\s\S]*\.\.\.linkFields/.test(saveEntry), {});
assert('Daily checklist batch text falls back to structured references.', saveEntry.includes("data?.batches_logged || data?.batch_id || batchRefs.join(', ')"), {});

assert('Shared pre-start modal builds exact per-batch links.', preStartModal.includes('function batchLinkFields(batch)') && preStartModal.includes('related_source_production_batch_ids: [sourceId]'), {});
assert('Start opens one shared modal for source-backed and native batches.', (productionQueue.match(/<ProductionPreStartModal/g) || []).length === 2 && productionQueue.includes('setPreStartModalOpen(true)'), {});
assert('Modal reloads authoritative completion status whenever it opens.', preStartModal.includes("invoke('getAdminProductionQueueSummary'") && preStartModal.includes("action: 'pre_start_status'") && preStartModal.includes('refreshStatus();'), {});
assert('Modal saves one selected compliance item at a time.', preStartModal.includes('async function saveRecord(recordType)') && preStartModal.includes('record_type: recordType') && !preStartModal.includes('Promise.all'), {});
assert('After one save the modal returns to the remaining-items checklist.', preStartModal.includes("setView('overview');") && preStartModal.includes('Choose the next missing item.'), {});
assert('Valid same-day manual logs can be linked instead of duplicated.', preStartModal.includes("Use today's log") && preStartModal.includes("invoke('saveAdminComplianceRecord'") && preStartModal.includes("action: 'link_pre_start_record'"), {});
assert('Status reader distinguishes exact ready rows from reusable same-day rows.', productionQueueEntry.includes("match_scope: exact ? 'batch_linked' : null") && productionQueueEntry.includes('reusable_same_day_record: Boolean(reusable)'), {});
assert('Same-day linking revalidates date, readiness, and operational/test separation.', saveEntry.includes('record_date_does_not_match_batch') && saveEntry.includes('record_is_not_pre_start_ready') && saveEntry.includes('test_record_cannot_be_used_for_operational_batch'), {});
assert('Linked existing logs merge structured batch references.', saveEntry.includes('related_batch_ids: relatedBatchIds') && saveEntry.includes('related_source_production_batch_ids: relatedSourceIds'), {});
assert('CCP remains out of the pre-start workflow.', !/record_type:\s*['"]ccp['"]/.test(preStartModal), {});
assert('Source-backed Start execution requires record-backed readiness.', productionQueue.includes("action === 'start' && !preStartReady") && liveStartEntry.includes('pre_start_compliance_incomplete'), {});
assert('Native Start execution requires record-backed readiness.', productionQueue.includes("action === 'start' && !preStartReady") && productionQueue.includes('Complete the record-backed pre-start checklist before saving Start'), {});
assert('Source-backed preview independently applies the server compliance gate.', previewStartEntry.includes('loadPreStartCompliance') && previewStartEntry.includes('pre_start_compliance: safePreStartCompliance(preStartCompliance)'), {});
assert('Compliance Ops hides Hub fallback warnings when native compliance is ready.', complianceOps.includes('nativeComplianceReady') && complianceOps.includes('hubComplianceWarning && !nativeComplianceReady'), {});
assert('Compliance summary fallback promotes native counts into top-level counts.', complianceSummaryEntry.includes('countFromFallbackOrNative') && complianceSummaryEntry.includes('production_batches: countFromFallbackOrNative') && complianceSummaryEntry.includes('native_production_batches'), {});
assert('Compliance summary preserves Hub fallback warnings outside top-level native-ready warnings.', complianceSummaryEntry.includes('function nativeComplianceReady(native)') && complianceSummaryEntry.includes('source_fallback_warnings: safeStringArray(fallback.warnings)') && complianceSummaryEntry.includes('? safeStringArray(native.warnings)'), {});
assert('Compliance summary Hub-success path also promotes native counts.', complianceSummaryEntry.includes('function mergeNativeComplianceCounts') && complianceSummaryEntry.includes('summary: mergeNativeComplianceCounts(hub.summary, native.summary)'), {});
assert('Compliance summary Hub-success warnings stay out of top-level native-ready warnings.', complianceSummaryEntry.includes('const hubWarnings = safeStringArray(hub.warnings)') && complianceSummaryEntry.includes('source_warnings: hubWarnings') && complianceSummaryEntry.includes('warnings: nativeComplianceReady(native)'), {});
assert('Compliance summary excludes internal validation batches from default native totals.', complianceSummaryEntry.includes('function isInternalTestBatch(row)') && complianceSummaryEntry.includes('BATCH-G53-TEST') && complianceSummaryEntry.includes('customer_app_internal_validation') && /testRecordMode === 'only' \? isInternalTestBatch\(row\) : !isInternalTestBatch\(row\)/.test(complianceSummaryEntry), {});
assert('Compliance summary exposes computed internal-test batch status after sanitization.', complianceSummaryEntry.includes('is_test_batch: isInternalTestBatch(batch)'), {});
assert('Unified compliance form uses staff picker for responsible staff.', unifiedComplianceForm.includes("import StaffMemberPicker from '@/components/admin/StaffMemberPicker';") && unifiedComplianceForm.includes('label="Responsible staff member"'), {});
assert('Unified compliance form no longer hardcodes user full_name as the only log staff value.', unifiedComplianceForm.includes('staff_member: staffMember || user.full_name || user.email'), {});
assert('Unified compliance form supports multi-select staff on duty.', unifiedComplianceForm.includes("staff_on_duty: 'Staff on duty'") && unifiedComplianceForm.includes("multiple={field === 'staff_on_duty'}"), {});
assert('Shared production pre-start verifier uses the staff picker.', preStartModal.includes('label="Verified by"') && preStartModal.includes('placeholder="Optional verifier"'), {});
assert('Standalone sanitation verifier uses the staff picker.', sanitationLogForm.includes("import StaffMemberPicker from '@/components/admin/StaffMemberPicker';") && sanitationLogForm.includes('label="Verified by"'), {});

assert('Critical regressions include the compliance batch-linkage guard.', criticalCi.includes('scripts/migration/run-g51b-admin-compliance-batch-linkage-tests.mjs'), {});
assert('No provider calls were introduced by the batch-linkage guard.', !/Stripe\(|new Stripe|Shopify\(|provider_call_impact:\s*true/i.test(saveEntry + productionQueue + preStartModal + productionQueueEntry), {});
assert('No customer notifications were introduced by the batch-linkage guard.', !/CustomerMessageDeliveryLog|sendNotification|notifications_sent:\s*true/.test(saveEntry + productionQueue + preStartModal + productionQueueEntry), {});

const failures = results.filter(result => !result.ok);
console.log(JSON.stringify({
  success: failures.length === 0,
  classification: failures.length === 0 ? 'admin_compliance_batch_linkage_ready' : 'admin_compliance_batch_linkage_regression',
  case_count: results.length,
  results,
}, null, 2));
if (failures.length) process.exit(1);
