#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appSource = fs.readFileSync('src/App.jsx', 'utf8');
const authSource = fs.readFileSync('src/lib/AuthContext.jsx', 'utf8');
const layoutSource = fs.readFileSync('src/components/layout/AppLayout.jsx', 'utf8');
const accountSettingsSource = fs.readFileSync('src/pages/AccountSettings.jsx', 'utf8');
const deleteAccountSource = fs.readFileSync('src/pages/DeleteAccount.jsx', 'utf8');
const eventsSource = fs.readFileSync('src/pages/Events.jsx', 'utf8');
const shopSource = fs.readFileSync('src/pages/Shop.jsx', 'utf8');
const orderHistorySource = fs.readFileSync('src/pages/OrderHistory.jsx', 'utf8');
const deletionFunctionSource = fs.readFileSync('base44/functions/requestAccountDeletion/entry.ts', 'utf8');
const deletionEntitySource = fs.readFileSync('base44/entities/AccountDeletionRequest.jsonc', 'utf8');
const paritySource = fs.readFileSync('scripts/release/verify-web-native-bundle-parity.mjs', 'utf8');
const criticalSource = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function assertNoHardRedirects(source, label) {
  assert.doesNotMatch(source, /window\.location\.(?:replace|href|assign)|location\.replace|location\.href/, `${label} must not hard-redirect inside the app shell`);
}

test('1. App routes are lazy-loaded and wrapped in Suspense.', () => {
  assert.match(appSource, /import React,\s*\{\s*Suspense\s*\}/);
  assert.match(appSource, /React\.lazy\(\(\) => import\('@\/pages\/Shop'\)\)/);
  assert.match(appSource, /React\.lazy\(\(\) => import\('@\/pages\/Checkout'\)\)/);
  assert.match(appSource, /React\.lazy\(\(\) => import\('@\/pages\/admin\/Operations'\)\)/);
  assert.match(appSource, /<Suspense fallback=\{<AppRouteFallback \/>}/);
  assert.doesNotMatch(appSource, /import\s+\w+\s+from\s+['"]@\/pages\//);
});

test('2. Home, Shop, and Cart are no longer permanently mounted behind tabs.', () => {
  assert.doesNotMatch(layoutSource, /import Home from '@\/pages\/Home'/);
  assert.doesNotMatch(layoutSource, /import Shop from '@\/pages\/Shop'/);
  assert.doesNotMatch(layoutSource, /import Cart from '@\/pages\/Cart'/);
  assert.doesNotMatch(layoutSource, /tabPanelProps|Always-mounted tab panels|aria-hidden/);
  assert.match(layoutSource, /<Outlet \/>/);
});

test('3. App and AuthContext avoid hard webview redirects.', () => {
  assertNoHardRedirects(appSource, 'App.jsx');
  assertNoHardRedirects(authSource, 'AuthContext.jsx');
  assertNoHardRedirects(accountSettingsSource, 'AccountSettings.jsx');
});

test('4. Auth bootstrap exposes explicit loading, authenticated, timeout, and error states.', () => {
  for (const token of [
    'AUTH_BOOTSTRAP_STATES',
    "loading: 'loading'",
    "authenticated: 'authenticated'",
    "unauthenticated: 'unauthenticated'",
    "timeout: 'timeout'",
    "error: 'error'",
    'bootstrap_timeout',
    'bootstrap_error',
    'getSafeReturnPath',
  ]) {
    assert.match(authSource, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(appSource, /BootstrapRecovery/);
  assert.match(appSource, /Sign-in check timed out/);
  assert.match(appSource, /We could not verify your session/);
});

test('5. Pull-to-refresh is present on key list pages.', () => {
  assert.match(shopSource, /<PullToRefresh onRefresh=\{refetch\}>/);
  assert.match(eventsSource, /<PullToRefresh onRefresh=\{refetch\}>/);
  assert.match(orderHistorySource, /<PullToRefresh onRefresh=\{refetch\}>/);
});

test('6. Account deletion has a public route and uses the backend endpoint.', () => {
  assert.match(appSource, /path="\/delete-account"/);
  assert.match(deleteAccountSource, /Delete your NuVira account/);
  assert.match(deleteAccountSource, /navigateToLogin\('\/account\/settings'\)/);
  assert.match(accountSettingsSource, /requestAccountDeletion/);
  assert.match(accountSettingsSource, /confirm:\s*'DELETE'/);
  assert.doesNotMatch(accountSettingsSource, /Core\.SendEmail|window\.location\.reload/);
});

test('7. AccountDeletionRequest is user-readable/admin-updatable audit state.', () => {
  const schema = JSON.parse(deletionEntitySource);
  assert.equal(schema.name, 'AccountDeletionRequest');
  assert.ok(schema.properties.requestor_email);
  assert.ok(schema.properties.identity_emails);
  assert.ok(schema.properties.deleted_counts);
  assert.ok(schema.properties.retained_record_categories);
  assert.deepEqual(schema.properties.status.enum, ['processing', 'completed', 'failed']);
  assert.deepEqual(schema.rls.update, { user_condition: { role: 'admin' } });
});

test('8. Deletion function requires POST, auth, and explicit DELETE confirmation.', () => {
  assert.match(deletionFunctionSource, /req\.method !== 'POST'/);
  assert.match(deletionFunctionSource, /base44\.auth\.me\(\)/);
  assert.match(deletionFunctionSource, /Authentication required/);
  assert.match(deletionFunctionSource, /body\.confirm !== 'DELETE'/);
  assert.match(deletionFunctionSource, /confirmation_required/);
});

test('9. Deletion function deletes only app-owned profile, preference, device-token, notification, and loyalty records.', () => {
  const targetStart = deletionFunctionSource.indexOf('const targets: DeleteTarget[] = [');
  const targetEnd = deletionFunctionSource.indexOf('const deletedCounts: Record<string, number>');
  assert.ok(targetStart >= 0 && targetEnd > targetStart, 'delete target segment must be discoverable');
  const targetsSource = deletionFunctionSource.slice(targetStart, targetEnd);

  for (const allowed of [
    'UserProfile',
    'NotificationPreference',
    'PushSubscription',
    'Notification',
    'UserPoints',
    'LoyaltyMember',
  ]) {
    assert.match(targetsSource, new RegExp(`entityName: '${allowed}'`));
  }

  assert.doesNotMatch(
    targetsSource,
    /entityName:\s*'(?:Order|ShopifyOrder|Subscription|SubscriptionPlan|SubscriptionBundle|FulfillmentTask|Inventory|Payment|Refund|Stripe|Shopify)'/,
  );
});

test('10. Deletion function has no external/provider/customer-notification side effects.', () => {
  assert.doesNotMatch(deletionFunctionSource, /functions\.invoke\s*\(/);
  assert.doesNotMatch(deletionFunctionSource, /\bfetch\s*\(/);
  assert.doesNotMatch(deletionFunctionSource, /stripe|shopify|sendCustomerNotification|sendNotificationCampaign/i);
  assert.match(deletionFunctionSource, /RETAINED_RECORD_CATEGORIES/);
  for (const retained of [
    'orders',
    'payment_records',
    'refund_records',
    'tax_records',
    'subscription_history',
    'fulfillment_and_delivery_records',
    'food_safety_and_compliance_records',
    'sync_and_audit_logs',
  ]) {
    assert.match(deletionFunctionSource, new RegExp(`'${retained}'`));
  }
});

test('11. Bundle parity verifier scans all copied lazy assets.', () => {
  assert.match(paritySource, /function allAssetFiles/);
  assert.match(paritySource, /Web and native asset file sets differ/);
  assert.match(paritySource, /Web\/native asset hash mismatch/);
  assert.match(paritySource, /textAssetFiles\(allNativeAssets\)/);
  assert.match(paritySource, /total_asset_file_count/);
});

test('12. Google Play/mobile readiness guard is part of critical regressions.', () => {
  assert.match(criticalSource, /run-g59-google-play-mobile-readiness-tests\.mjs/);
});

for (const item of tests) {
  item.fn();
}

console.log(JSON.stringify({
  success: true,
  suite: 'g59-google-play-mobile-readiness',
  cases: tests.length,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  operational_records_mutated: false,
}, null, 2));
