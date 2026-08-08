import { spawnSync } from 'node:child_process';

const harnesses = [
  'scripts/migration/run-g52-admin-sandbox-e2e-readiness-tests.mjs',
  'scripts/migration/run-g47c-checkout-native-chain-anomaly-diagnostics-tests.mjs',
  'scripts/migration/run-g47f-apple-pay-express-checkout-audit-tests.mjs',
  'scripts/migration/run-g43a-customer-order-history-tracker-parity-tests.mjs',
  'scripts/migration/run-g43c-customer-order-tracker-limited-native-first-tests.mjs',
  'scripts/migration/run-g45c-customer-rewards-limited-native-first-reads-tests.mjs',
  'scripts/migration/run-g51c-delivery-status-sync-freshness-guard-tests.mjs',
  'scripts/migration/run-g51h-notification-campaign-unfreeze-tests.mjs',
  'scripts/migration/run-g51i-notification-campaign-consent-tests.mjs',
  'scripts/migration/run-g64-native-push-transport-tests.mjs',
  'scripts/migration/run-g66-customer-journey-automation-tests.mjs',
  'scripts/migration/run-g68-authoritative-loyalty-and-ingestion-tests.mjs',
  'scripts/migration/run-g70-route-delivery-integrity-tests.mjs',
  'scripts/migration/run-g76-order-session-error-boundary-tests.mjs',
  'scripts/migration/run-g76-product-cart-accessibility-tests.mjs',
];

const results = harnesses.map(harness => {
  const started = Date.now();
  const result = spawnSync(process.execPath, [harness], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: { ...process.env },
  });
  return {
    harness,
    ok: result.status === 0,
    exit_code: result.status ?? 1,
    duration_ms: Date.now() - started,
    failure_tail: result.status === 0
      ? null
      : `${result.stdout || ''}\n${result.stderr || ''}`.trim().split('\n').slice(-20),
  };
});

const output = {
  ok: results.every(row => row.ok),
  suite: 'g76-precustomer-expanded-regressions',
  harness_count: results.length,
  passed_count: results.filter(row => row.ok).length,
  failed_count: results.filter(row => !row.ok).length,
  coverage: [
    'checkout_and_wallet_entry',
    'customer_order_chain_and_tracker',
    'authoritative_loyalty_and_rewards',
    'order_status_email_and_push_projection',
    'customer_journey_automation_and_consent',
    'production_and_fulfillment_sandbox',
    'delivery_reconciliation_and_route_integrity',
    'checkout_session_error_boundary',
  ],
  live_entity_writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  payment_actions_performed: false,
  results,
};

console.log(JSON.stringify(output, null, 2));
if (!output.ok) process.exit(1);
