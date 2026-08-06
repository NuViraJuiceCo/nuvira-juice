#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

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

const openGateEnv = {
  ENABLE_NATIVE_PRODUCTION_BATCH_LIFECYCLE_WRITES: 'true',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_EMAILS: 'info@nuvirajuice.com',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_ACTIONS: 'start,complete,verify',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_BATCH_ALLOWLIST: 'BATCH-20260723-AURA,BATCH-20260723-OASIS,BATCH-20260723-RE-NU',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_TEST_BATCH_ALLOWLIST: 'BATCH-G53-TEST-20260723-AURA',
  NATIVE_PRODUCTION_BATCH_COMPLIANCE_GATE_BATCH_ALLOWLIST: 'BATCH-20260723-AURA,BATCH-G53-TEST-20260723-AURA',
};

const executeFns = loadFunction(
  path.join(repoRoot, 'base44/functions/executeNativeProductionBatchLifecycle/entry.ts'),
  ['envGateFailure', 'testBatchMarkerFailure', 'planLifecycle'],
  openGateEnv,
);

assert.equal(
  executeFns.envGateFailure({
    action: 'start',
    batchKeys: ['internal_production_batch_id', 'BATCH-20260723-AURA'],
    actorEmail: 'info@nuvirajuice.com',
    batch: { batch_id: 'BATCH-20260723-AURA', is_test_batch: false },
  }),
  null,
  'Execution gate accepts exact readable batch_id when UI also sends an internal id.',
);
assert.equal(
  executeFns.envGateFailure({
    action: 'start',
    batchKeys: ['internal_production_batch_id', 'BATCH-20260723-OTHER'],
    actorEmail: 'info@nuvirajuice.com',
    batch: { batch_id: 'BATCH-20260723-OTHER', is_test_batch: false },
  }),
  null,
  'Execution gate authorizes an operational batch without a one-off exact-batch allowlist.',
);
assert.equal(
  executeFns.envGateFailure({
    action: 'start',
    batchKeys: ['BATCH-G53-TEST-20260723-AURA'],
    actorEmail: 'info@nuvirajuice.com',
    batch: {
      batch_id: 'BATCH-G53-TEST-20260723-AURA',
      source_system: 'customer_app_internal_validation',
      native_owner_status: 'internal_test_only',
    },
  }),
  null,
  'Execution gate accepts the exact test batch allowlist.',
);
assert.equal(
  executeFns.envGateFailure({
    action: 'start',
    batchKeys: ['BATCH-G53-TEST-NOT-ALLOWLISTED'],
    actorEmail: 'info@nuvirajuice.com',
    batch: {
      batch_id: 'BATCH-G53-TEST-NOT-ALLOWLISTED',
      is_test_batch: true,
    },
  }),
  'test_batch_not_allowlisted',
  'Execution gate keeps exact allowlisting for internal test batches.',
);
assert.equal(
  executeFns.testBatchMarkerFailure({
    batchKeys: ['BATCH-G53-TEST-20260723-AURA'],
    batch: {
      batch_id: 'BATCH-G53-TEST-20260723-AURA',
      source_system: 'customer_app_internal_validation',
      native_owner_status: 'internal_test_only',
    },
  }),
  null,
  'Execution test marker gate accepts existing internal validation provenance while live schema catches up.',
);
assert.equal(
  executeFns.testBatchMarkerFailure({
    batchKeys: ['BATCH-G53-TEST-20260723-AURA'],
    batch: {
      batch_id: 'BATCH-20260723-AURA',
      source_system: 'customer_app_admin_manual_event_setup',
      native_owner_status: 'native_event_stock_ready',
    },
  }),
  'test_batch_allowlist_requires_test_marker',
  'Execution test marker gate still rejects a non-test batch sent through the test allowlist.',
);

const previewFns = loadFunction(
  path.join(repoRoot, 'base44/functions/previewNativeProductionBatchLifecycle/entry.ts'),
  ['planLifecycle', 'requirePreviewAccess'],
  openGateEnv,
);
const previewAccess = await previewFns.requirePreviewAccess({
  base44: { auth: { me: async () => ({ role: 'admin', email: 'INFO@NuViraJuice.com' }) } },
  req: { headers: { get: () => '' } },
  body: {},
});
assert.equal(previewAccess.ok, true);
assert.equal(previewAccess.actor_email, 'info@nuvirajuice.com', 'Preview access keeps normalized admin email for internal gate checks.');

const completeBatchSetup = {
  staff_on_duty: ['Admin'],
  equipment_used: ['Juicer', 'Scale'],
  formula_or_recipe_used: 'Standard production recipe',
  bottle_size: '12 oz',
  ingredients_used: [{ ingredient_name: 'Produce', quantity: 10, unit: 'lb', lot_number: 'LOT-G51D' }],
};

const plannedAura = {
  id: 'internal_production_batch_id',
  batch_id: 'BATCH-20260723-AURA',
  product_name: 'Aura',
  status: 'planned',
  production_date: '2026-07-23',
  ...completeBatchSetup,
};
let preview = previewFns.planLifecycle({
  mode: 'dry_run',
  action: 'start',
  batch: plannedAura,
  actor_email: 'info@nuvirajuice.com',
  request_id: 'g51d_preview_open',
  pre_start_compliance: {
    enforced: true,
    ready: true,
    blockers: [],
  },
});
assert.equal(preview.lifecycle_ready, true);
assert.equal(preview.live_command_available, true);
assert.equal(preview.native_write_allowed, true);
assert.deepEqual(Array.from(preview.live_command_blockers), []);

const g53TestBatch = {
  id: 'internal_g53_test_batch_id',
  batch_id: 'BATCH-G53-TEST-20260723-AURA',
  product_name: 'Aura',
  status: 'planned',
  production_date: '2026-07-23',
  source_system: 'customer_app_internal_validation',
  native_owner_status: 'internal_test_only',
  ...completeBatchSetup,
};
preview = previewFns.planLifecycle({
  mode: 'dry_run',
  action: 'start',
  batch: g53TestBatch,
  actor_email: 'info@nuvirajuice.com',
  request_id: 'g51d_preview_g53_test',
  pre_start_compliance: {
    enforced: true,
    ready: true,
    blockers: [],
  },
});
assert.equal(preview.lifecycle_ready, true);
assert.equal(preview.native_write_allowed, true);
assert.equal(preview.is_test_batch, true, 'Preview exposes internal/test marker through provenance fallback.');

const executeBlockedByPreStart = executeFns.planLifecycle({
  action: 'start',
  batch: plannedAura,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g51d_execute_missing_prestart',
  now: '2026-07-23T12:00:00.000Z',
  body: {},
  reason: 'test missing compliance gate',
  preStartCompliance: {
    enforced: true,
    ready: false,
    blockers: ['pre_start_sanitation_missing_or_incomplete'],
  },
});
assert.ok(
  executeBlockedByPreStart.blockers.includes('pre_start_sanitation_missing_or_incomplete'),
  'Execution plan blocks Start when linked pre-start compliance is incomplete.',
);
assert.equal(executeBlockedByPreStart.proposed_patch, null);

const executeBlockedByBatchSetup = executeFns.planLifecycle({
  action: 'start',
  batch: { ...plannedAura, ingredients_used: [] },
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g51d_execute_missing_batch_setup',
  now: '2026-07-23T12:00:00.000Z',
  body: {},
  reason: 'test missing batch setup',
  preStartCompliance: { enforced: true, ready: true, blockers: [] },
});
assert.ok(executeBlockedByBatchSetup.blockers.includes('batch_setup_ingredients_missing'));
assert.equal(executeBlockedByBatchSetup.proposed_patch, null);

const completedForVerification = {
  ...plannedAura,
  status: 'completed_pending_verification',
  actual_start_time: '2026-07-23T12:00:00.000Z',
  actual_end_time: '2026-07-23T13:00:00.000Z',
  completed_by: 'info@nuvirajuice.com',
  actual_units: 4,
};
const completeQcInput = {
  pH_result: 3.8,
  pH_passed_failed: 'passed',
  calibration_checked: true,
  ccp_check_complete: true,
  sanitation_verification_complete: true,
  labels_applied: true,
  passed_failed: 'passed',
};
const verifyReady = executeFns.planLifecycle({
  action: 'verify',
  batch: completedForVerification,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g51d_verify_qc_complete',
  now: '2026-07-23T13:30:00.000Z',
  body: completeQcInput,
  reason: 'test complete QC capture',
});
assert.equal(verifyReady.blockers.length, 0);
assert.equal(Object.hasOwn(verifyReady.proposed_patch, 'pH_meter_id'), false);
assert.equal(verifyReady.proposed_patch.calibration_checked, true);

const verifyWithoutMeterId = executeFns.planLifecycle({
  action: 'verify',
  batch: completedForVerification,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g51d_verify_without_meter_id',
  now: '2026-07-23T13:30:00.000Z',
  body: completeQcInput,
  reason: 'test no meter id required',
});
assert.equal(verifyWithoutMeterId.blockers.length, 0);
assert.equal(Object.hasOwn(verifyWithoutMeterId.proposed_patch, 'pH_meter_id'), false);

const closedPreviewFns = loadFunction(
  path.join(repoRoot, 'base44/functions/previewNativeProductionBatchLifecycle/entry.ts'),
  ['planLifecycle'],
  {},
);
preview = closedPreviewFns.planLifecycle({
  mode: 'dry_run',
  action: 'start',
  batch: plannedAura,
  actor_email: 'info@nuvirajuice.com',
  request_id: 'g51d_preview_closed',
  pre_start_compliance: {
    enforced: true,
    ready: true,
    blockers: [],
  },
});
assert.equal(preview.lifecycle_ready, true);
assert.equal(preview.live_command_available, false);
assert.equal(preview.native_write_allowed, false);
assert.ok(preview.live_command_blockers.includes('native_production_batch_lifecycle_writes_disabled'));

const productionPage = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/ProductionQueueSummary.jsx'), 'utf8');
const writeAvailableFunction = productionPage.match(/function nativePreviewWriteAvailable[\s\S]*?\n}\n/)?.[0] || '';
assert.ok(writeAvailableFunction.includes('preview.native_write_allowed === true'));
assert.ok(writeAvailableFunction.includes('preview.live_command_available === true'));
assert.ok(!writeAvailableFunction.includes('nativePreviewReadyForAction'), 'Write availability must not fall back to dry-run readiness.');
assert.ok(productionPage.includes('!actionReady || !writeAvailable'), 'Run Native button stays disabled unless readiness and write gate are both open.');

console.log(JSON.stringify({
  ok: true,
  suite: 'g51d-native-production-lifecycle-gate',
  checks: 25,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
