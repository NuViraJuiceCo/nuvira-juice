#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const harnesses = [
  'scripts/migration/run-g50b-native-startup-hotfix-tests.mjs',
  'scripts/migration/run-g49a-checkout-processing-error-boundary-tests.mjs',
  'scripts/migration/run-g47f-patch1-config2-public-key-delivery-tests.mjs',
  'scripts/migration/run-g47f-patch1-side-effect-free-apple-pay-mount-tests.mjs',
  'scripts/migration/run-g47b-customer-checkout-order-chain-parity-tests.mjs',
  'scripts/migration/run-g43b-customer-order-history-limited-native-first-tests.mjs',
  'scripts/migration/run-g43c-customer-order-tracker-limited-native-first-tests.mjs',
  'scripts/migration/run-g39d-admin-delivery-route-native-first-tests.mjs',
  'scripts/migration/run-g42b-admin-delivery-action-readiness-tests.mjs',
  'scripts/migration/run-g39j-admin-orders-mismatch-diagnostics-tests.mjs',
  'scripts/migration/run-g39l-admin-orders-limited-native-primary-tests.mjs',
  'scripts/migration/run-g35b-native-refund-impact-preview-tests.mjs',
  'scripts/migration/run-g36b-subscription-occurrence-parity-tests.mjs',
  'scripts/migration/run-g39n-operations-dashboard-aggregate-diagnostics-tests.mjs',
  'scripts/migration/run-g27-native-cutover-readiness-tests.mjs',
];

function fail(message, extra = {}) {
  console.error(JSON.stringify({ ok: false, suite: 'g50c-critical-regressions', message, ...extra }, null, 2));
  process.exit(1);
}

const missing = harnesses.filter((harness) => !fs.existsSync(path.join(repoRoot, harness)));
if (missing.length) {
  fail('Required critical regression harness missing', { missing });
}

const results = [];
for (const harness of harnesses) {
  const started = Date.now();
  const result = spawnSync(process.execPath, [harness], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env },
  });
  results.push({ harness, exit_code: result.status ?? 1, duration_ms: Date.now() - started });
  if (result.status !== 0) {
    fail('Critical regression harness failed', { harness, results });
  }
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g50c-critical-regressions',
  harness_count: harnesses.length,
  writes_performed: false,
  provider_calls_performed: false,
  results,
}, null, 2));
