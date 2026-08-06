#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;
function gitHead() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}
function writeEvidence(result) {
  if (!outPath) return;
  fs.mkdirSync(path.dirname(path.resolve(repoRoot, outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(repoRoot, outPath), `${JSON.stringify(result, null, 2)}\n`);
}
const harnesses = [
  'scripts/migration/run-g50b-native-startup-hotfix-tests.mjs',
  'scripts/migration/run-g49a-checkout-processing-error-boundary-tests.mjs',
  'scripts/migration/run-g47f-patch1-config2-public-key-delivery-tests.mjs',
  'scripts/migration/run-g47f-patch1-side-effect-free-apple-pay-mount-tests.mjs',
  'scripts/migration/run-g51a-native-followup-fixes-tests.mjs',
  'scripts/migration/run-g47b-customer-checkout-order-chain-parity-tests.mjs',
  'scripts/migration/run-g43b-customer-order-history-limited-native-first-tests.mjs',
  'scripts/migration/run-g43c-customer-order-tracker-limited-native-first-tests.mjs',
  'scripts/migration/run-g39d-admin-delivery-route-native-first-tests.mjs',
  'scripts/migration/run-g39f-admin-production-planning-native-first-tests.mjs',
  'scripts/migration/run-g42b-admin-delivery-action-readiness-tests.mjs',
  'scripts/migration/run-g39j-admin-orders-mismatch-diagnostics-tests.mjs',
  'scripts/migration/run-g39l-admin-orders-limited-native-primary-tests.mjs',
  'scripts/migration/run-g35b-native-refund-impact-preview-tests.mjs',
  'scripts/migration/run-g36b-subscription-occurrence-parity-tests.mjs',
  'scripts/migration/run-g39n-operations-dashboard-aggregate-diagnostics-tests.mjs',
  'scripts/migration/run-g56a-food-demand-based-inventory-policy-tests.mjs',
  'scripts/migration/run-g51b-admin-compliance-batch-linkage-tests.mjs',
  'scripts/migration/run-g51c-delivery-status-sync-freshness-guard-tests.mjs',
  'scripts/migration/run-g51d-native-production-lifecycle-gate-tests.mjs',
  'scripts/migration/run-g51f-admin-order-pricing-rate-context-tests.mjs',
  'scripts/migration/run-g51g-delivery-program-composition-tests.mjs',
  'scripts/migration/run-g51h-native-delivery-fusion-workflow-tests.mjs',
  'scripts/migration/run-g51i-notification-campaign-consent-tests.mjs',
  'scripts/migration/run-g51j-admin-dark-surface-tests.mjs',
  'scripts/migration/run-g51k-admin-function-result-unwrapping-tests.mjs',
  'scripts/migration/run-g52-admin-sandbox-e2e-readiness-tests.mjs',
  'scripts/migration/run-g53-admin-visibility-refresh-and-compliance-readiness-tests.mjs',
  'scripts/migration/run-g53-phase-a-live-pilot-prerequisites-tests.mjs',
  'scripts/migration/run-g53-phase-b-live-pilot-prerequisites-tests.mjs',
  'scripts/migration/run-g27-native-cutover-readiness-tests.mjs',
  'scripts/migration/run-g54-whole-app-readiness-audit-tests.mjs',
  'scripts/migration/run-g55-backend-live-use-readiness-tests.mjs',
  'scripts/migration/run-g59-google-play-mobile-readiness-tests.mjs',
  'scripts/migration/run-g60-android-play-store-readiness-tests.mjs',
  'scripts/migration/run-brclub-discount-tests.mjs',
  'scripts/migration/run-g61-checkout-customer-identity-tests.mjs',
  'scripts/migration/run-g62-website-only-seo-links-tests.mjs',
  'scripts/migration/run-g63-capacitor-live-update-bootstrap-tests.mjs',
  'scripts/migration/run-g64-native-push-transport-tests.mjs',
  'scripts/migration/run-g65-security-and-loyalty-auth-tests.mjs',
  'scripts/migration/run-g66-customer-journey-automation-tests.mjs',
  'scripts/migration/run-g67-function-estate-cleanup-tests.mjs',
  'scripts/migration/run-g68-authoritative-loyalty-and-ingestion-tests.mjs',
  'scripts/migration/run-g69-production-prestart-modal-tests.mjs',
];

function fail(message, extra = {}) {
  const result = { ok: false, suite: 'g50c-critical-regressions', git_commit: gitHead(), generated_at_utc: new Date().toISOString(), message, ...extra };
  writeEvidence(result);
  console.error(JSON.stringify(result, null, 2));
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

const result = {
  ok: true,
  suite: 'g50c-critical-regressions',
  git_commit: gitHead(),
  generated_at_utc: new Date().toISOString(),
  harness_count: harnesses.length,
  writes_performed: false,
  provider_calls_performed: false,
  results,
};
writeEvidence(result);
console.log(JSON.stringify(result, null, 2));
