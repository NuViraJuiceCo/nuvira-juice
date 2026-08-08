#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildLoyaltyIntegrityReport } from '../../base44/functions/auditCustomerAppLoyaltyAfterPhase2/loyaltyIntegrity.js';

const repoRoot = process.cwd();
const exists = relativePath => fs.existsSync(path.join(repoRoot, relativePath));
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const healthy = buildLoyaltyIntegrityReport({
  members: [{ id: 'member-1', email: 'customer@example.com', total_points: 350, lifetime_points: 350, redeemed_points: 0 }],
  pointsAccounts: [{
    id: 'points-1',
    customer_email: 'customer@example.com',
    total_points: 350,
    lifetime_points: 350,
    redeemed_points: 0,
    points_history: [
      { amount: 250, type: 'bonus', description: 'NuVira Rewards signup bonus', timestamp: '2026-08-01T00:00:00.000Z' },
      { amount: 100, type: 'earned', description: 'Order payment of $10.00', idempotency_key: 'order-1', timestamp: '2026-08-02T00:00:00.000Z' },
    ],
  }],
  profiles: [{ customer_email: 'customer@example.com', first_name: 'Sample', last_name: 'Customer', phone: '555-0100' }],
  orders: [{ customer_email: 'customer@example.com', payment_captured: true, total: 10 }],
});
assert.equal(healthy.healthy, true);
assert.equal(healthy.writes_performed, false);

const auditEntry = read('base44/functions/auditCustomerAppLoyaltyAfterPhase2/entry.ts');
assert.match(auditEntry, /LOYALTY_INTEGRITY_AUDIT/);
assert.doesNotMatch(auditEntry, /EXPECTED_MEMBERS|HELD_CUSTOMERS|privaterelay\.appleid\.com/);

const auditRun = spawnSync(process.execPath, ['scripts/audit-function-estate.mjs'], {
  cwd: repoRoot,
  encoding: 'utf8',
});
assert.equal(auditRun.status, 0, auditRun.stderr || 'function estate audit failed');
const estate = JSON.parse(auditRun.stdout);
assert.equal(estate.function_creation_limit, 50);
assert.equal(estate.capacity_remaining, 0);
assert.equal(estate.required_over_limit_by, 0);
assert.equal(estate.deployment_limit_exceeded, false);
assert.equal(estate.keep_count, 50);
assert.equal(estate.local_function_count, 50);
assert.equal(estate.gateway_consolidated_action_count, 14);
assert.deepEqual(estate.missing_keep_functions, []);
assert.deepEqual(estate.unrecognized_candidates, []);
assert.deepEqual(estate.missing_gateway_handlers, []);
assert.deepEqual(estate.unconsolidated_standalone_actions, []);

const requiredSafeguards = [
  'stripeWebhook',
  'shopifyWebhookReceiver',
  'resendWebhook',
  'customerJourneyAutomation',
  'syncOrderToHub',
  'sendOrderStatusNotification',
  'getAdminOperationsDashboardSummary',
  'getCustomerAccountDashboardData',
  'getAdminPOSOrdersSummary',
  'addressSuggest',
  'cancelSubscriptionFutureRenewal',
  'claimReward',
  'completeAccountSetup',
  'createZone3AuthorizationIntent',
  'getCustomerNotifications',
  'getCustomerOrderDetail',
  'getDeliveryEta',
  'getOrderBySession',
  'pauseSubscription',
  'processManualRefund',
  'registerPushSubscription',
  'requestAccountDeletion',
  'resolveShopifyCartPermalink',
  'stripeCustomerPortal',
  'syncUserToHub',
  'unregisterPushSubscription',
  'validateDeliveryEligibility',
];
for (const functionName of requiredSafeguards) {
  assert.equal(exists(`base44/functions/${functionName}/entry.ts`), true, `${functionName} must be retained`);
}

const consolidatedGatewayActions = [
  'adminCancelAndRefundSubscription',
  'approveZone3DeliveryRequest',
  'denyZone3DeliveryRequest',
  'executeNativeSafeSyncOrderUpdate',
  'monitorPostPaymentChain',
  'notifyOrderProcessed',
  'previewNativeSafeSyncDarkLaunchComparison',
  'previewNativeSafeSyncOrderUpdate',
  'pushMerchToShopify',
  'pushProductToShopify',
  'sendOrderSms',
  'sendUpcomingDeliveryNotifications',
  'syncShopifyOrderToHub',
  'syncSubscriptionWithFulfillments',
];
for (const functionName of consolidatedGatewayActions) {
  assert.equal(exists(`base44/functions/${functionName}/entry.ts`), false, `${functionName} must not consume a standalone function slot`);
  assert.equal(
    exists(`base44/functions/getAdminOperationsDashboardSummary/handlers/${functionName}/entry.ts`),
    true,
    `${functionName} must remain available through the admin gateway`,
  );
}

const newlyRetired = [
  'previewNativeOrderCutoverReadiness',
  'monitorLiveCheckoutTest',
  'backfillAdminHistoricalHubOrders',
  'previewAdminHistoricalHubBackfill',
  'previewNativeExactOrderPilotApproval',
  'repairMissingCASubscriptionFromStripeAndHub',
  'shopifyResyncOrders',
  'shopifyResyncProducts',
  'syncAdminSingleHubDeliveryStatus',
  'syncEventsFromHub',
  'logDriverAction',
  'createSubscriptionPaymentElementIntent',
];
for (const functionName of newlyRetired) {
  assert.equal(exists(`base44/functions/${functionName}/entry.ts`), false, `${functionName} must remain retired`);
}

const adminGateway = read('base44/functions/getAdminOperationsDashboardSummary/entry.ts');
const customerGateway = read('base44/functions/getCustomerAccountDashboardData/entry.ts');
assert.match(adminGateway, /sendNotificationCampaign/);
assert.match(adminGateway, /manageAdminDiscountCode/);
for (const functionName of consolidatedGatewayActions) {
  assert.match(adminGateway, new RegExp(`"${functionName}"\\s*:`));
}
assert.match(customerGateway, /registerPushSubscription/);
assert.match(customerGateway, /resolveShopifyCartPermalink/);

function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(target));
    else if (/\.(?:ts|js)$/.test(entry.name)) files.push(target);
  }
  return files;
}
for (const file of sourceFiles(path.join(repoRoot, 'base44/functions'))) {
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /May 30 launch freeze/i, `${file} must not retain launch-freeze messaging`);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g67-function-estate-cleanup',
  retained_function_count: estate.local_function_count,
  function_creation_limit: estate.function_creation_limit,
  required_over_limit_by: estate.required_over_limit_by,
  recognized_contract_count: estate.recognized_contract_count,
  required_safeguard_count: requiredSafeguards.length,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
