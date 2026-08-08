#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const plannerPath = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers/previewNativeSafeSyncOrderUpdate/entry.ts');
const comparatorPath = path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/handlers/previewNativeSafeSyncDarkLaunchComparison/entry.ts');
const defaultSamplePath = '/private/tmp/nuvira-safe-sync-real-samples.redacted.json';
const args = process.argv.slice(2);
const selfTest = args.includes('--self-test');
const samplePath = args.find((arg) => !arg.startsWith('--')) || defaultSamplePath;

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

function loadSamples() {
  if (selfTest) {
    return [{
      sample_id: 'self_test_clean_update',
      source: 'stripe_webhook',
      idempotency_key: 'evt_self_test_clean_update',
      starting_order: {
        id: 'sample_order_001',
        shopify_order_number: 'SAMPLE-001',
        customer_email: 'sample@example.test',
        payment_status: 'pending',
        order_lock_status: 'unlocked',
      },
      incoming_payload: {
        shopify_order_number: 'SAMPLE-001',
        customer_email: 'sample@example.test',
        payment_status: 'paid',
        sync_status: 'synced',
      },
      hub_result: {
        action: 'updated',
        fields_updated: ['customer_email', 'payment_status', 'shopify_order_number', 'stripe_event_id_applied', 'sync_status'],
        fields_rejected: [],
        order_sync_log_draft: {
          action: 'updated',
          success: true,
          fields_updated: ['customer_email', 'payment_status', 'shopify_order_number', 'stripe_event_id_applied', 'sync_status'],
          fields_rejected: [],
        },
      },
    }];
  }

  if (!fs.existsSync(samplePath)) {
    console.error(`Sample file not found: ${samplePath}`);
    console.error('Provide a redacted sample file path or run with --self-test.');
    process.exit(2);
  }

  const parsed = JSON.parse(fs.readFileSync(samplePath, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.samples)) return parsed.samples;
  throw new Error('Sample file must be an array or an object with a samples array.');
}

function validateSample(sample, index) {
  const errors = [];
  if (!sample || typeof sample !== 'object') errors.push('sample must be an object');
  if (!sample.sample_id || typeof sample.sample_id !== 'string') errors.push('sample_id required');
  if (!sample.source || typeof sample.source !== 'string') errors.push('source required');
  if (!sample.idempotency_key || typeof sample.idempotency_key !== 'string') errors.push('idempotency_key required');
  if (!sample.incoming_payload || typeof sample.incoming_payload !== 'object') errors.push('incoming_payload object required');
  if (!sample.hub_result || typeof sample.hub_result !== 'object') errors.push('hub_result object required');
  if (errors.length > 0) {
    throw new Error(`Invalid sample at index ${index}: ${errors.join('; ')}`);
  }
}

const planSafeSync = loadFunction(plannerPath, 'planSafeSync', '__planSafeSync');
const compareSafeSyncDarkLaunch = loadFunction(comparatorPath, 'compareSafeSyncDarkLaunch', '__compareSafeSyncDarkLaunch');
const samples = loadSamples();

let failed = 0;
const categoryCounts = new Map();
const statusCounts = new Map();

for (const [index, sample] of samples.entries()) {
  validateSample(sample, index);
  const nativeResult = planSafeSync({
    fixture_id: sample.sample_id,
    starting_order: sample.starting_order || sample.existing_order || null,
    incoming_payload: sample.incoming_payload,
    source: sample.source,
    idempotency_key: sample.idempotency_key,
    stripe_event_id: sample.stripe_event_id || sample.idempotency_key,
    mode: 'dry_run',
  });

  const comparison = compareSafeSyncDarkLaunch({
    mode: 'dry_run',
    fixture_id: sample.sample_id,
    source: sample.source,
    idempotency_key: sample.idempotency_key,
    hub_result: sample.hub_result,
    native_result: nativeResult,
  });

  const parityStatus = comparison.matched ? 'match' : 'mismatch';
  statusCounts.set(parityStatus, (statusCounts.get(parityStatus) || 0) + 1);
  const category = comparison.mismatch_category || 'none';
  categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);

  if (!comparison.matched) {
    failed += 1;
    console.error(`MISMATCH ${sample.sample_id}: ${comparison.mismatch_category}`);
    console.error(JSON.stringify(comparison.mismatches, null, 2));
  } else {
    console.log(`MATCH ${sample.sample_id}`);
  }
}

console.log(`\nSamples checked: ${samples.length}`);
console.log(`Parity status counts: ${Array.from(statusCounts.entries()).map(([key, value]) => `${key}=${value}`).join(', ')}`);
console.log(`Mismatch category counts: ${Array.from(categoryCounts.entries()).map(([key, value]) => `${key}=${value}`).join(', ')}`);

if (failed > 0) {
  console.error(`${failed}/${samples.length} exported safeSync sample comparisons mismatched.`);
  process.exit(1);
}

console.log('All exported safeSync sample comparisons matched.');
