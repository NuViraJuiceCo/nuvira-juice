#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outIndex = process.argv.indexOf('--out');
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : '';

function loadFunction(filePath, exportNames, env = {}) {
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { ${exportNames.join(', ')} };\n`;
  const context = vm.createContext({
    console,
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
  return context.globalThis.__exports;
}

const testBatch = {
  id: 'g53-internal-id',
  batch_id: 'BATCH-G53-TEST-20260723-AURA',
  product_name: 'Aura',
  product_category: 'juice',
  production_date: '2026-07-23',
  planned_units: 1,
  status: 'planned',
  is_test_batch: true,
  test_purpose: 'G53 controlled live persistence validation',
  staff_on_duty: ['Admin'],
  equipment_used: ['Juicer', 'Scale'],
  formula_or_recipe_used: 'Aura standard recipe',
  bottle_size: '12 oz',
  ingredients_used: [{ ingredient_name: 'Carrot', quantity: 10, unit: 'lb', lot_number: 'LOT-G53' }],
};

const linked = {
  source_production_batch_id: testBatch.id,
  batch_id: testBatch.batch_id,
  is_test_record: true,
  test_batch_id: testBatch.batch_id,
};

const completeCompliance = {
  sanitationLogs: [{
    id: 'sanitation-g53',
    ...linked,
    cleaned: true,
    sanitized: true,
    sanitizer_level: 'Adequate',
  }],
  dailyChecklists: [{
    id: 'checklist-g53',
    ...linked,
    overall_status: 'Pre-Production Complete',
    morning_fridge_temp_logged: true,
    sanitizer_levels_checked: true,
    equipment_sanitized: true,
    work_areas_cleaned: true,
  }],
  temperatureLogs: [{
    id: 'temperature-g53',
    ...linked,
    temperature: 38,
    within_range: true,
  }],
};

const gateEnv = {
  ENABLE_NATIVE_PRODUCTION_BATCH_LIFECYCLE_WRITES: 'true',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_EMAILS: 'info@nuvirajuice.com',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_ACTIONS: 'start,complete,verify',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_TEST_BATCH_ALLOWLIST: testBatch.batch_id,
  NATIVE_PRODUCTION_BATCH_COMPLIANCE_GATE_BATCH_ALLOWLIST: testBatch.batch_id,
};

const executePath = path.join(repoRoot, 'base44/functions/executeNativeProductionBatchLifecycle/entry.ts');
const executeFns = loadFunction(
  executePath,
  ['envGateFailure', 'testBatchMarkerFailure', 'evaluatePreStartCompliance', 'loadPreStartCompliance', 'planLifecycle'],
  gateEnv,
);

assert.equal(executeFns.envGateFailure({
  action: 'start',
  batchKeys: [testBatch.id, testBatch.batch_id],
  actorEmail: 'info@nuvirajuice.com',
  batch: testBatch,
}), null);
assert.equal(executeFns.envGateFailure({
  action: 'start',
  batchKeys: ['BATCH-REAL-NOT-COMPLIANCE-ALLOWLISTED'],
  actorEmail: 'info@nuvirajuice.com',
  batch: {
    batch_id: 'BATCH-REAL-NOT-COMPLIANCE-ALLOWLISTED',
    product_name: 'Aura',
    production_date: '2026-07-23',
    status: 'planned',
    is_test_batch: false,
  },
}), null);
assert.equal(executeFns.testBatchMarkerFailure({
  batchKeys: [testBatch.batch_id],
  batch: testBatch,
}), null);
assert.equal(executeFns.testBatchMarkerFailure({
  batchKeys: [testBatch.batch_id],
  batch: { ...testBatch, is_test_batch: false },
}), null);
assert.equal(executeFns.testBatchMarkerFailure({
  batchKeys: [testBatch.batch_id],
  batch: {
    batch_id: 'BATCH-20260723-AURA',
    product_name: 'Aura',
    production_date: '2026-07-23',
    status: 'planned',
    is_test_batch: false,
    source_system: 'customer_app_admin_manual_event_setup',
    native_owner_status: 'native_event_stock_ready',
    test_purpose: '',
  },
}), 'test_batch_allowlist_requires_test_marker');

let compliance = executeFns.evaluatePreStartCompliance({ batch: testBatch });
assert.equal(compliance.ready, false);
assert.deepEqual(
  Array.from(compliance.blockers).sort(),
  [
    'pre_start_daily_checklist_missing_or_incomplete',
    'pre_start_sanitation_missing_or_incomplete',
    'pre_start_temperature_missing_or_out_of_range',
  ].sort(),
);

compliance = executeFns.evaluatePreStartCompliance({ batch: testBatch, ...completeCompliance });
assert.equal(compliance.ready, true);
assert.deepEqual(Array.from(compliance.blockers), []);
assert.deepEqual(JSON.parse(JSON.stringify(compliance.matched_record_counts)), {
  sanitation: 1,
  daily_checklist: 1,
  temperature: 1,
});

const outOfRange = executeFns.evaluatePreStartCompliance({
  batch: testBatch,
  ...completeCompliance,
  temperatureLogs: [{ ...completeCompliance.temperatureLogs[0], within_range: false, temperature: 45 }],
});
assert.equal(outOfRange.ready, false);
assert.ok(outOfRange.blockers.includes('pre_start_temperature_missing_or_out_of_range'));

let plan = executeFns.planLifecycle({
  action: 'start',
  batch: testBatch,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g53-start-blocked',
  now: '2026-07-23T17:00:00.000Z',
  body: {},
  reason: 'G53 test',
  preStartCompliance: executeFns.evaluatePreStartCompliance({ batch: testBatch }),
});
assert.equal(plan.proposed_patch, null);
assert.ok(plan.blockers.includes('pre_start_sanitation_missing_or_incomplete'));

plan = executeFns.planLifecycle({
  action: 'start',
  batch: testBatch,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g53-start-ready',
  now: '2026-07-23T17:01:00.000Z',
  body: {},
  reason: 'G53 test',
  preStartCompliance: compliance,
});
assert.equal(plan.proposed_patch.status, 'in_production');

const previewPath = path.join(repoRoot, 'base44/functions/previewNativeProductionBatchLifecycle/entry.ts');
const previewFns = loadFunction(
  previewPath,
  ['evaluatePreStartCompliance', 'loadPreStartCompliance', 'planLifecycle'],
  gateEnv,
);
const previewCompliance = previewFns.evaluatePreStartCompliance({ batch: testBatch, ...completeCompliance });
const preview = previewFns.planLifecycle({
  mode: 'dry_run',
  action: 'start',
  batch: testBatch,
  actor_email: 'info@nuvirajuice.com',
  request_id: 'g53-preview-ready',
  pre_start_compliance: previewCompliance,
});
assert.equal(preview.lifecycle_ready, true);
assert.equal(preview.live_command_available, true);
assert.equal(preview.pre_start_compliance.ready, true);

const sharedOperationalBatch = {
  ...testBatch,
  id: 'pineapple-batch-id',
  batch_id: 'MANUAL-20260805-PINEAPPLE-JUICE-4',
  product_name: 'Pineapple Juice',
  production_date: '2026-08-05',
  is_test_batch: false,
  test_purpose: '',
};
const sharedOriginLink = {
  source_production_batch_id: 'orange-batch-id',
  batch_id: 'MANUAL-20260805-ORANGE-JUICE-4',
  related_source_production_batch_ids: ['orange-batch-id', sharedOperationalBatch.id],
  related_batch_ids: ['MANUAL-20260805-ORANGE-JUICE-4', sharedOperationalBatch.batch_id],
  is_test_record: false,
};
const sharedRows = {
  SanitationLog: [{ id: 'shared-sanitation', ...sharedOriginLink, log_date: sharedOperationalBatch.production_date, cleaned: true, sanitized: true, sanitizer_level: 'Optimal' }],
  DailyChecklist: [{ id: 'shared-checklist', ...sharedOriginLink, checklist_date: sharedOperationalBatch.production_date, batches_logged: `MANUAL-20260805-ORANGE-JUICE-4, ${sharedOperationalBatch.batch_id}`, overall_status: 'Pre-Production Complete', morning_fridge_temp_logged: true, sanitizer_levels_checked: true, equipment_sanitized: true, work_areas_cleaned: true }],
  TemperatureLog: [{ id: 'shared-temperature', ...sharedOriginLink, log_date: sharedOperationalBatch.production_date, temperature: 37, within_range: true }],
};
const sharedBase44 = {
  asServiceRole: {
    entities: Object.fromEntries(Object.entries(sharedRows).map(([entityName, rows]) => [entityName, {
      filter: async filter => rows.filter(row => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value)),
    }])),
  },
};
const executeSharedCompliance = await executeFns.loadPreStartCompliance(sharedBase44, sharedOperationalBatch);
assert.equal(executeSharedCompliance.ready, true);
assert.deepEqual(JSON.parse(JSON.stringify(executeSharedCompliance.matched_record_counts)), { sanitation: 1, daily_checklist: 1, temperature: 1 });
const previewSharedCompliance = await previewFns.loadPreStartCompliance(sharedBase44, sharedOperationalBatch);
assert.equal(previewSharedCompliance.ready, true);
assert.deepEqual(JSON.parse(JSON.stringify(previewSharedCompliance.matched_record_counts)), { sanitation: 1, daily_checklist: 1, temperature: 1 });

const savePath = path.join(repoRoot, 'base44/functions/saveAdminComplianceRecord/entry.ts');
const saveFns = loadFunction(savePath, ['deriveComplianceTestContext']);
const testContext = await saveFns.deriveComplianceTestContext({
  asServiceRole: {
    entities: {
      ProductionBatch: {
        get: async id => id === testBatch.id ? testBatch : null,
        filter: async () => [],
      },
    },
  },
}, linked);
assert.deepEqual(JSON.parse(JSON.stringify(testContext)), {
  is_test_record: true,
  test_batch_id: testBatch.batch_id,
});

for (const entityName of ['ProductionBatch', 'SanitationLog', 'DailyChecklist', 'TemperatureLog', 'BatchComplianceLog']) {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, `base44/entities/${entityName}.jsonc`), 'utf8'));
  if (entityName === 'ProductionBatch') {
    assert.equal(schema.properties.is_test_batch.type, 'boolean');
    assert.equal(schema.properties.is_test_batch.default, false);
    assert.equal(schema.properties.test_purpose.type, 'string');
  } else {
    assert.equal(schema.properties.is_test_record.type, 'boolean');
    assert.equal(schema.properties.is_test_record.default, false);
    assert.equal(schema.properties.test_batch_id.type, 'string');
  }
}

const queueFunction = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminProductionQueueSummary/entry.ts'), 'utf8');
assert.ok(queueFunction.includes("test_batch_mode must be exclude or only"));
assert.ok(queueFunction.includes("testBatchMode === 'only' ? isTestBatch : !isTestBatch"));
assert.ok(queueFunction.includes('operational_totals_exclude_test_batches: true'));

const complianceFunction = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminComplianceOpsSummary/entry.ts'), 'utf8');
assert.ok(complianceFunction.includes("test_record_mode must be exclude or only"));
assert.ok(complianceFunction.includes('function isInternalTestRecord(row)'));
assert.ok(complianceFunction.includes("testRecordMode === 'only' ? isInternalTestRecord(row) : !isInternalTestRecord(row)"));
assert.ok(complianceFunction.includes("testRecordMode === 'only' ? isInternalTestBatch(row) : !isInternalTestBatch(row)"));
assert.ok(complianceFunction.includes('operational_totals_exclude_test_records: true'));

const dashboardFunction = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/entry.ts'), 'utf8');
assert.ok(dashboardFunction.includes('function isInternalTestProductionBatch'));
assert.ok(dashboardFunction.includes('!isInternalTestProductionBatch(batch)'));
assert.ok(dashboardFunction.includes('row?.payload?.is_test_batch !== true'));

const calendarFunction = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminCalendarEventsSummary/entry.ts'), 'utf8');
assert.ok(calendarFunction.includes('row?.is_test_batch !== true'));
const resourcesFunction = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminResourcesSummary/entry.ts'), 'utf8');
assert.ok(resourcesFunction.includes('productionBatches.filter(batch => batch?.is_test_batch !== true)'));
const planningReadModel = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminProductionPlanningSummary/productionComplianceReadModel.js'), 'utf8');
assert.ok(planningReadModel.includes('row?.is_test_batch !== true'));
assert.ok(planningReadModel.includes('row?.is_test_record !== true'));

const productionPage = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/ProductionQueueSummary.jsx'), 'utf8');
assert.ok(productionPage.includes("test_batch_mode: testBatchMode"));
assert.ok(productionPage.includes('Open Internal Test Validation'));
assert.ok(productionPage.includes('Internal test batches only.'));
assert.ok(productionPage.includes('<ProductionPreStartModal'));
const preStartModal = fs.readFileSync(path.join(repoRoot, 'src/components/admin/ProductionPreStartModal.jsx'), 'utf8');
assert.ok(preStartModal.includes('is_test_batch: batch?.is_test_batch === true'));
assert.ok(preStartModal.includes("invoke('getAdminProductionQueueSummary'"));
assert.ok(preStartModal.includes("action: 'pre_start_status'"));
assert.ok(productionPage.includes('enabled: isAdminUser(user) && isPageVisible && !rangeInvalid,'));
assert.ok(!productionPage.includes("enabled: isAdminUser(user) && !rangeInvalid && testBatchMode === 'exclude'"));
assert.ok(productionPage.includes('disabled={!action.enabled || pending || actionPending'));
assert.ok(productionPage.includes('This verified batch is audit-only. Start, Complete, and Verify are closed.'));
assert.ok(fs.readFileSync(previewPath, 'utf8').includes('is_test_batch: isInternalTestBatch(row)'));

const evidence = {
  ok: true,
  suite: 'g53-phase-a-live-pilot-prerequisites',
  checks: 57,
  live_writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  inventory_mutations_performed: false,
};

if (outPath) {
  const resolvedOutPath = path.resolve(repoRoot, outPath);
  fs.mkdirSync(path.dirname(resolvedOutPath), { recursive: true });
  fs.writeFileSync(resolvedOutPath, `${JSON.stringify(evidence, null, 2)}\n`);
}

console.log(JSON.stringify({
  ...evidence,
  evidence_path: outPath || null,
}, null, 2));
