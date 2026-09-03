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
  'scripts/migration/run-g51c-delivery-status-sync-freshness-guard-tests.mjs',
  'scripts/migration/run-g51b-admin-compliance-batch-linkage-tests.mjs',
  'scripts/migration/run-g55-backend-live-use-readiness-tests.mjs',
  'scripts/migration/run-g59-google-play-mobile-readiness-tests.mjs',
  'scripts/migration/run-g60-android-play-store-readiness-tests.mjs',
  'scripts/migration/run-brclub-discount-tests.mjs',
  'scripts/migration/run-customer-order-adjustment-choice-tests.mjs',
  'scripts/migration/run-customer-order-adjustment-stripe-refund-tests.mjs',
  'scripts/migration/run-g61-checkout-customer-identity-tests.mjs',
  'scripts/migration/run-g62-website-only-seo-links-tests.mjs',
  'scripts/migration/run-g63-capacitor-live-update-bootstrap-tests.mjs',
  'scripts/migration/run-g64-native-push-transport-tests.mjs',
  'scripts/migration/run-g65-security-and-loyalty-auth-tests.mjs',
  'scripts/migration/run-g66-customer-journey-automation-tests.mjs',
  'scripts/migration/run-g67-function-estate-cleanup-tests.mjs',
  'scripts/migration/run-g68-authoritative-loyalty-and-ingestion-tests.mjs',
  'scripts/migration/run-g69-production-prestart-modal-tests.mjs',
  'scripts/migration/run-g70-route-delivery-integrity-tests.mjs',
  'scripts/migration/run-g72-legacy-event-runtime-retirement-tests.mjs',
  'scripts/migration/run-g113-legacy-native-order-status-cleanup-tests.mjs',
  'scripts/migration/run-g73-operations-trust-and-navigation-tests.mjs',
  'scripts/migration/run-g74-supported-function-contract-tests.mjs',
  'scripts/migration/run-g75-live-function-routing-integrity-tests.mjs',
  'scripts/migration/run-g76-order-session-error-boundary-tests.mjs',
  'scripts/migration/run-g76-product-cart-accessibility-tests.mjs',
  'scripts/migration/run-g83-fulfillment-operational-gate-tests.mjs',
  'scripts/migration/run-g85-react-router-security-tests.mjs',
  'scripts/migration/run-g86-subscription-gateway-readiness-tests.mjs',
  'scripts/migration/run-g87-production-immediate-idempotency-tests.mjs',
  'scripts/migration/run-g89-customer-app-native-production-cutover-tests.mjs',
  'scripts/migration/run-g90-terminal-hub-fallback-suppression-tests.mjs',
  'scripts/migration/run-g92-native-production-batch-materialization-tests.mjs',
  'scripts/migration/run-g115-automatic-paid-order-production-tests.mjs',
  'scripts/migration/run-g39f-admin-production-planning-native-first-tests.mjs',
  'scripts/migration/run-g39d-admin-delivery-route-native-first-tests.mjs',
  'scripts/migration/run-g39h-admin-calendar-events-native-first-tests.mjs',
  'scripts/migration/run-g56a-food-demand-based-inventory-policy-tests.mjs',
  'scripts/migration/run-g93-hub-operator-retirement-tests.mjs',
  'scripts/migration/run-g94-customer-app-compliance-authority-tests.mjs',
  'scripts/migration/run-g94-hub-operational-read-retirement-tests.mjs',
  'scripts/migration/run-g94-customer-hub-bridge-retirement-tests.mjs',
  'scripts/migration/run-g95-hub-write-retirement-tests.mjs',
  'scripts/migration/run-g96-native-pos-claim-activation-tests.mjs',
  'scripts/migration/run-g97-native-cutover-monitor-tests.mjs',
  'scripts/migration/run-g98-native-compliance-document-tests.mjs',
  'scripts/migration/run-g99-compliance-document-upload-tests.mjs',
  'scripts/migration/run-g100-customer-order-journey-tracker-tests.mjs',
  'scripts/migration/run-g101-order-item-product-thumbnails-tests.mjs',
  'scripts/migration/run-g102-customer-delivery-proof-tests.mjs',
  'scripts/migration/run-g103-premium-program-journey-tests.mjs',
  'scripts/migration/run-g105-event-publishing-tests.mjs',
  'scripts/migration/run-g106-mobile-operations-and-test-order-visibility-tests.mjs',
  'scripts/migration/run-g107-mobile-operator-workspace-tests.mjs',
  'scripts/migration/run-g108-account-program-membership-tests.mjs',
  'scripts/migration/run-g109-account-spacing-and-notification-center-tests.mjs',
  'scripts/migration/run-g110-inventory-shopify-pos-and-native-health-tests.mjs',
  'scripts/migration/run-g116-event-production-pos-inventory-tests.mjs',
  'scripts/migration/run-g118-event-welcome-tests.mjs',
  'scripts/migration/run-g119-pos-event-attribution-tests.mjs',
  'scripts/migration/run-g111-unified-email-communications-tests.mjs',
  'scripts/migration/run-g112-communication-completion-tests.mjs',
  'scripts/migration/run-g125-delivery-live-activity-tests.mjs',
  'scripts/migration/run-g126-distance-aware-delivery-progress-tests.mjs',
  'scripts/migration/run-g128-google-merchant-quality-tests.mjs',
  'scripts/migration/run-g131-google-analytics-consent-tests.mjs',
  'scripts/migration/run-g132-google-merchant-structured-content-tests.mjs',
  'scripts/migration/run-g133-google-pay-domain-readiness-tests.mjs',
  'scripts/migration/run-g134-native-android-google-pay-tests.mjs',
  'scripts/migration/run-g135-google-guest-wallet-checkout-tests.mjs',
  'scripts/migration/run-g136-stripe-guest-provider-sandbox-tests.mjs',
  'scripts/migration/run-g137-marketing-measurement-tests.mjs',
  'scripts/migration/run-g138-meta-capi-purchase-tests.mjs',
  'scripts/migration/run-g140-meta-catalog-match-tests.mjs',
  'scripts/migration/run-g141-growth-measurement-tests.mjs',
  'scripts/migration/run-g142-meta-registration-measurement-tests.mjs',
  'scripts/migration/run-g143-snapchat-measurement-tests.mjs',
  'scripts/migration/run-g145-retention-measurement-tests.mjs',
  'scripts/migration/run-g146-privacy-disclosure-tests.mjs',
  'scripts/migration/run-g147-retention-conversion-measurement-tests.mjs',
  'scripts/migration/run-g148-route-seo-page-boundary-tests.mjs',
  'scripts/migration/run-g149-android-app-links-tests.mjs',
  'scripts/migration/run-g150-mobile-performance-tests.mjs',
  'scripts/migration/run-g151-product-crawler-seo-tests.mjs',
  'scripts/migration/run-g152-mobile-accessibility-structure-tests.mjs',
  'scripts/migration/run-g153-single-toast-runtime-tests.mjs',
  'scripts/migration/run-g154-local-font-delivery-tests.mjs',
  'scripts/migration/run-g155-merchant-return-policy-tests.mjs',
  'scripts/migration/run-g156-merchant-delivery-information-tests.mjs',
  'scripts/migration/run-g157-product-detail-touch-target-tests.mjs',
  'scripts/migration/run-g158-core-conversion-touch-target-tests.mjs',
  'scripts/migration/run-g160-canonical-sitemap-contract-tests.mjs',
  'scripts/migration/run-g162-google-merchant-canonical-links-tests.mjs',
  'scripts/migration/run-g164-production-recipe-preload-tests.mjs',
  'scripts/migration/run-g165-isolated-production-lifecycle-routing-tests.mjs',
  'scripts/migration/run-g166-event-pos-stock-alert-tests.mjs',
  'scripts/migration/run-g167-google-measurement-protocol-tests.mjs',
  'scripts/migration/run-g168-google-merchant-additional-image-tests.mjs',
  'scripts/migration/run-g169-product-gallery-images-tests.mjs',
  'scripts/migration/run-g170-authentic-product-gallery-tests.mjs',
  'scripts/migration/run-g171-broken-product-gallery-tests.mjs',
  'scripts/migration/run-g172-guest-loyalty-activation-tests.mjs',
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
