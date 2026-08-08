#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixturePath = path.join(repoRoot, 'docs/migration/fixtures/safe-sync-order-update/fixtures.json');
const plannerPath = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers/previewNativeSafeSyncOrderUpdate/entry.ts');
const comparatorPath = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers/previewNativeSafeSyncDarkLaunchComparison/entry.ts');

function loadFunction(filePath, functionName, globalName) {
  const source = fs.readFileSync(filePath, 'utf8');
  const functionOnly = source.split('export default async')[0] + `\nglobalThis.${globalName} = ${functionName};\n`;
  const executableFunction = ts.transpileModule(functionOnly, {
    compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = vm.createContext({ console, globalThis: {} });
  vm.runInContext(executableFunction, context, { filename: filePath });
  return context.globalThis[globalName];
}

function nativeResultAsHubSummary(nativeResult) {
  return {
    action: nativeResult.order_sync_log_draft?.action || nativeResult.action,
    fields_updated: nativeResult.order_sync_log_draft?.fields_updated || Object.keys(nativeResult.accepted_fields || {}),
    fields_rejected: nativeResult.order_sync_log_draft?.fields_rejected || Object.keys(nativeResult.rejected_fields || {}),
    reason: nativeResult.error_code || null,
    order_review_queue_incident_type: nativeResult.order_review_queue_draft?.incident_type || null,
    order_sync_log_draft: {
      action: nativeResult.order_sync_log_draft?.action || null,
      success: nativeResult.order_sync_log_draft?.success ?? null,
      fields_updated: nativeResult.order_sync_log_draft?.fields_updated || [],
      fields_rejected: nativeResult.order_sync_log_draft?.fields_rejected || [],
      error_code: nativeResult.order_sync_log_draft?.error_code || null,
    },
  };
}

const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const planSafeSync = loadFunction(plannerPath, 'planSafeSync', '__planSafeSync');
const compareSafeSyncDarkLaunch = loadFunction(comparatorPath, 'compareSafeSyncDarkLaunch', '__compareSafeSyncDarkLaunch');

let failed = 0;
const sourceCounts = new Map();
for (const fixture of fixtures) {
  const nativeResult = planSafeSync({
    fixture_id: fixture.fixture_id,
    starting_order: fixture.starting_order,
    incoming_payload: fixture.incoming_payload,
    source: fixture.source,
    idempotency_key: fixture.idempotency_key,
    stripe_event_id: fixture.stripe_event_id,
    mode: 'dry_run',
  });

  const comparison = compareSafeSyncDarkLaunch({
    mode: 'dry_run',
    fixture_id: fixture.fixture_id,
    source: fixture.source,
    idempotency_key: fixture.idempotency_key,
    hub_result: nativeResultAsHubSummary(nativeResult),
    native_result: nativeResult,
  });

  const sourceLabel = fixture.hub_behavior_source || 'Unlabeled';
  sourceCounts.set(sourceLabel, (sourceCounts.get(sourceLabel) || 0) + 1);

  if (!comparison.matched || comparison.mismatch_category !== null) {
    failed += 1;
    console.error(`FAIL ${fixture.fixture_id}`);
    console.error(JSON.stringify({
      mismatch_category: comparison.mismatch_category,
      mismatches: comparison.mismatches,
    }, null, 2));
  } else {
    console.log(`PASS ${fixture.fixture_id}`);
  }
}

const negative = compareSafeSyncDarkLaunch({
  mode: 'dry_run',
  fixture_id: 'synthetic_negative_blocker',
  source: 'customer_app',
  idempotency_key: 'evt_synthetic_negative_blocker',
  hub_result: {
    action: 'rejected',
    reason: 'delivery_order_missing_address',
    fields_updated: [],
    fields_rejected: [],
    order_sync_log_draft: { action: 'rejected', error_code: 'delivery_order_missing_address' },
  },
  native_result: {
    action: 'would_create',
    would_create_order: true,
    accepted_fields: { customer_email: 'fixture@example.test' },
    rejected_fields: {},
    order_sync_log_draft: { action: 'created', fields_updated: ['customer_email'], fields_rejected: [] },
  },
});

if (negative.matched || negative.mismatch_category !== 'blocker') {
  failed += 1;
  console.error('FAIL synthetic_negative_blocker');
  console.error(JSON.stringify(negative, null, 2));
} else {
  console.log('PASS synthetic_negative_blocker');
}

if (failed > 0) {
  console.error(`\n${failed}/${fixtures.length + 1} dark-launch comparison checks failed.`);
  process.exit(1);
}

console.log(`\n${fixtures.length}/${fixtures.length} synthetic fixture comparisons matched.`);
console.log('1/1 synthetic negative comparison produced blocker mismatch.');
console.log(`Hub behavior source labels: ${Array.from(sourceCounts.entries()).map(([source, count]) => `${source}=${count}`).join(', ')}`);
