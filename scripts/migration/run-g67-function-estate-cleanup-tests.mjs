#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildLoyaltyIntegrityReport } from '../../base44/functions/auditCustomerAppLoyaltyAfterPhase2/loyaltyIntegrity.js';

const repoRoot = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));

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
assert.equal(healthy.summary.critical_exception_count, 0);

const unhealthy = buildLoyaltyIntegrityReport({
  members: [{ id: 'member-relay', email: 'relay@privaterelay.appleid.com', total_points: 0, lifetime_points: 0, redeemed_points: 0 }],
  pointsAccounts: [
    { id: 'points-a', customer_email: 'relay@privaterelay.appleid.com', total_points: -1, lifetime_points: 0, redeemed_points: 0, points_history: [] },
    { id: 'points-b', customer_email: 'relay@privaterelay.appleid.com', total_points: 0, lifetime_points: 0, redeemed_points: 0, points_history: [] },
  ],
});
assert.equal(unhealthy.healthy, false);
assert.equal(unhealthy.summary.critical_counts.private_relay_members, 1);
assert.equal(unhealthy.summary.critical_counts.duplicate_points_accounts, 1);

const auditEntry = read('base44/functions/auditCustomerAppLoyaltyAfterPhase2/entry.ts');
assert.match(auditEntry, /LOYALTY_INTEGRITY_AUDIT/);
assert.doesNotMatch(auditEntry, /EXPECTED_MEMBERS|HELD_CUSTOMERS|privaterelay\.appleid\.com/);

const upsell = read('src/components/program/SubscriptionUpsellModal.jsx');
assert.match(upsell, /invoke\('validateDeliveryEligibility'/);
assert.match(upsell, /allowed_for_subscriptions/);
assert.doesNotMatch(upsell, /calculateDeliveryZone/);
assert.doesNotMatch(upsell, /we deliver within 15 miles/);

const retiredFunctions = [
  'auditAmarkSubscriptions',
  'auditLatestStripePaymentForAmark',
  'canonicalizeAmarkSubscription',
  'repairR1DeepaCAPatch',
  'repairR2RefundedDuplicatesCA',
  'repairR3HenrryCAHydration',
  'repairR4SukhwantCAStructure',
  'verifyCustomerFacingLoyaltyDisplay',
  'replaySubscriptionRefundDryRun',
  'probeHubSubscriptionCancelled',
  'correctAdminOrderDeliverySchedule',
  'correctAdminOrderDeliveryScheduleV2',
  'auditNewSubscriptions',
  'auditStabilizationRepair',
  'auditStripeAndIntegrationInventory',
  'auditSubscriptionFulfillments',
  'auditSubscriptionPayloadToHub',
  'auditWindow3Orders',
  'debugAndRetryHubSync',
  'debugHubSyncPayload',
  'diagnosePiConfig',
  'inspectPaymentIntent',
  'listRecentPIs',
  'manualPushOrderToHub',
  'manualSyncOrders',
  'manualSyncSubscription',
  'manualSyncSubscriptionOrders',
  'stabilizationDiagnostic',
  'testSchedulingLogic',
  'verifyLiveSubscriptionSmoke',
  'verifyStripeLiveMode',
];
for (const functionName of retiredFunctions) {
  assert.equal(exists(`base44/functions/${functionName}/entry.ts`), false, `${functionName} must remain retired`);
}

const requiredSafeguards = [
  'stripeWebhook',
  'shopifyWebhookReceiver',
  'customerJourneyAutomation',
  'syncOrderToHub',
  'sendOrderStatusNotification',
  'previewNativeOrderCutoverReadiness',
  'previewNativeSafeSyncOrderUpdate',
  'executeNativeSafeSyncOrderUpdate',
];
for (const functionName of requiredSafeguards) {
  assert.equal(exists(`base44/functions/${functionName}/entry.ts`), true, `${functionName} must not be removed`);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g67-function-estate-cleanup',
  retired_function_count: retiredFunctions.length,
  required_safeguard_count: requiredSafeguards.length,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
