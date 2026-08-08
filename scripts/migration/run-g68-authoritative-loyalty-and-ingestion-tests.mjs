#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const failures = [];
function assert(name, condition, detail = '') {
  if (!condition) failures.push({ name, detail });
  else console.log(`PASS ${name}`);
}

const reconciliationModule = await import(pathToFileURL(path.join(root, 'base44/functions/auditCustomerAppLoyaltyAfterPhase2/loyaltyReconciliation.js')).href);
const reconciliation = reconciliationModule.buildAuthoritativeLoyaltyReconciliation({
  members: [{ id: 'lm1', email: 'member@example.net', created_date: '2026-01-01T00:00:00Z' }],
  pointsAccounts: [{
    id: 'up1', customer_email: 'member@example.net', total_points: 9999, lifetime_points: 9999, redeemed_points: 100,
    points_history: [
      { amount: 250, type: 'bonus', description: 'NuVira Rewards signup bonus', timestamp: '2026-01-01T00:00:00Z' },
      { amount: -100, type: 'redeemed', description: 'Redeemed at checkout', timestamp: '2026-02-01T00:00:00Z' },
    ],
  }],
  profiles: [{ customer_email: 'member@example.net', first_name: '', last_name: '', phone: '' }],
  orders: [
    { id: 'o1', order_number: 'NV-1', customer_email: 'member@example.net', total: 20, payment_status: 'paid', customer_name: 'Lee Burton', contact_phone: '(314) 555-1234' },
    { id: 'o2', order_number: 'NV-2', customer_email: 'member@example.net', total: 50, payment_status: 'refunded' },
  ],
  shopifyOrders: [
    { id: 'so1', shopify_order_id: 's1', shopify_order_number: 'NV-1', customer_email: 'member@example.net', total_price: 20, financial_status: 'paid' },
    { id: 'so3', shopify_order_id: 's3', shopify_order_number: 'NV-3', customer_email: 'member@example.net', total_price: 10, financial_status: 'paid' },
  ],
});
const member = reconciliation.rows[0];
assert('Reconciliation deduplicates the same order across native and Shopify projections.', member.components.qualifying_order_count === 2, JSON.stringify(member.components));
assert('Reconciliation excludes refunded orders and calculates ten points per paid dollar.', member.components.purchase_points === 300, JSON.stringify(member.components));
assert('Reconciliation adds signup bonus once and preserves redeemed points.', member.expected.lifetime_points === 550 && member.expected.redeemed_points === 100 && member.expected.total_points === 450, JSON.stringify(member.expected));
assert('Reconciliation enriches a missing profile from authoritative order contact data.', member.contact.first_name === 'Lee' && member.contact.last_name === 'Burton' && member.contact.phone, JSON.stringify(member.contact));
const relayProfileReconciliation = reconciliationModule.buildAuthoritativeLoyaltyReconciliation({
  members: [{ email: 'real@example.net' }],
  profiles: [{ customer_email: 'relay@privaterelay.appleid.com', contact_email: 'real@example.net', first_name: 'Real', last_name: 'Customer', phone: '+13145551234' }],
});
assert('Reconciliation preserves the authenticated Apple relay profile key.', relayProfileReconciliation.rows[0]?.contact?.profile_customer_email === 'relay@privaterelay.appleid.com', JSON.stringify(relayProfileReconciliation.rows[0]?.contact));
const historicalPurchaseReconciliation = reconciliationModule.buildAuthoritativeLoyaltyReconciliation({
  members: [{ email: 'historical@example.net', total_points: 250, lifetime_points: 250, redeemed_points: 0 }],
  pointsAccounts: [{ customer_email: 'historical@example.net', total_points: 400, lifetime_points: 400, redeemed_points: 0, points_history: [
    { amount: 250, type: 'bonus', description: 'Signup bonus', idempotency_key: 'signup' },
    { amount: 150, type: 'earned', description: 'Purchase points - Order 1033', idempotency_key: 'order_points:1033' },
  ] }],
});
assert('Reconciliation preserves deduplicated historical POS purchase-ledger earnings.', historicalPurchaseReconciliation.rows[0]?.expected?.total_points === 400, JSON.stringify(historicalPurchaseReconciliation.rows[0]));
assert('Reconciliation repairs a stale member projection even when the points account is correct.', historicalPurchaseReconciliation.rows[0]?.cache_mismatch === true && historicalPurchaseReconciliation.actionable.length === 1, JSON.stringify(historicalPurchaseReconciliation.rows[0]));
const internalTestReconciliation = reconciliationModule.buildAuthoritativeLoyaltyReconciliation({ pointsAccounts: [{ customer_email: 'test2@nuvirajuice.com', total_points: 250 }] });
assert('Internal test loyalty accounts are excluded from customer reconciliation.', internalTestReconciliation.enrolled_customer_count === 0, JSON.stringify(internalTestReconciliation));

const mutator = read('base44/functions/enrollNewCustomerInLoyalty/entry.ts');
assert('Central loyalty mutation requires an idempotency key.', mutator.includes('idempotency_key_required'));
assert('Central loyalty mutation rejects conflicting replays.', mutator.includes('idempotency_key_conflict'));
assert('Central loyalty mutation maintains both projections.', mutator.includes('entities.UserPoints') && mutator.includes('entities.LoyaltyMember'));
assert('Refund transaction type must be a negative debit.', mutator.includes("transactionType === 'redeemed' || transactionType === 'reversal'") && mutator.includes('debit_amount_must_be_negative'));

const directWriters = [];
for (const directory of fs.readdirSync(path.join(root, 'base44/functions'))) {
  const entry = path.join(root, 'base44/functions', directory, 'entry.ts');
  if (!fs.existsSync(entry) || directory === 'enrollNewCustomerInLoyalty' || directory === 'claimReward') continue;
  const source = fs.readFileSync(entry, 'utf8');
  if (/UserPoints\.(?:create|update)\(/.test(source)) directWriters.push(directory);
}
assert('No backend entry point bypasses the central loyalty balance writer.', directWriters.length === 0, directWriters.join(','));

const stripe = read('base44/functions/stripeWebhook/entry.ts');
assert('Stripe payments use stable payment-level loyalty keys.', stripe.includes('stripe_payment:${paymentId}:earned'));
assert('Stripe refund paths reverse rather than restore earned points.', stripe.includes("transaction_type: 'reversal'") && !/Restore loyalty points if full refund/.test(stripe));

const poller = read('base44/functions/shopifyPollFallback/entry.ts');
const pollerServeIndex = poller.indexOf('Deno.serve');
const pollerAuthIndex = poller.indexOf("auth.me().catch(() => null)", pollerServeIndex);
const pollerCredentialUseIndex = poller.indexOf('await shopifyAccessToken', pollerServeIndex);
assert('Shopify polling requires an authenticated admin before provider access.', pollerAuthIndex > pollerServeIndex && pollerAuthIndex < pollerCredentialUseIndex);
assert('Shopify polling uses the current versioned Admin API with a validated override.', poller.includes("'SHOPIFY_ADMIN_API_VERSION'") && poller.includes("'2026-07'") && !poller.includes('/admin/api/2024-01/'));
assert('Shopify polling exchanges installed-app client credentials instead of depending on a stale static token.', poller.includes("grant_type: 'client_credentials'") && poller.includes("authFlow: 'client_credentials'"));
assert('Shopify connection preview performs no ingestion or local writes.', poller.includes("body?.action === 'connection_preview'") && poller.includes('writes_performed: false') && poller.includes('ingestion_performed: false'));
assert('Shopify polling uses an emergency kill switch instead of a stale launch-style enable freeze.', poller.includes("'SHOPIFY_POLL_FALLBACK_KILL_SWITCH'") && !poller.includes("Deno.env.get('ENABLE_SHOPIFY_POLL_FALLBACK')"));
assert(
  'Shopify polling delegates to canonical webhook ingestion.',
  poller.includes("invokeInternalFunction(base44, 'shopifyWebhookReceiver'") &&
    poller.includes("internal_topic: 'orders/create'") &&
    poller.includes("'x-internal-secret': secret || ''"),
);
assert('Shopify polling no longer creates a degraded ShopifyOrder directly.', !poller.includes('entities.ShopifyOrder.create'));
const receiver = read('base44/functions/shopifyWebhookReceiver/entry.ts');
assert('Canonical Shopify mapper persists delivery identity and schedule.', receiver.includes('delivery_address: extractAddress(order)') && receiver.includes('requested_delivery_date: extractRequestedDate(order)'));
assert('Routine successful orders no longer create unresolved alerts.', !receiver.includes("createAlert(base44, 'new_order'"));
const retrySync = read('base44/functions/retryFailedHubSyncs/entry.ts');
assert(
  'Internal function authentication uses the SDK fetch transport that actually forwards headers.',
  poller.includes("functions.fetch(`/${functionName}`") &&
    retrySync.includes("functions.fetch(`/${targetFunction}`") &&
    stripe.includes("functions.fetch(`/${targetFunction}`") &&
    receiver.includes("functions.fetch('/getAdminOperationsDashboardSummary'") &&
    receiver.includes("gateway_action: 'syncShopifyOrderToHub'") &&
    receiver.includes('authorization: `Bearer ${getCustomerAppSyncSecret()}`'),
);
assert(
  'Central loyalty calls carry their internal credential in the supported request body.',
  stripe.includes('internal_secret: secret') &&
    read('base44/functions/createLoyaltyMember/entry.ts').includes('internal_secret: Deno.env.get(\'LOYALTY_LEDGER_SECRET\')'),
);

const journey = read('base44/functions/customerJourneyAutomation/customerJourneyAutomation.ts');
assert('Resend numeric event fields are coerced before delivery.', journey.includes('numericFields.has(key)') && journey.includes('finiteNumber(rawValue, Number.NaN)'));
assert('Resend payload validation uses the internal journey type before sending the provider event name.', journey.includes('sendResendEvent(eventName, providerName, email') && journey.includes('JSON.stringify({ event: providerEventName'));
const sms = read('base44/functions/getAdminOperationsDashboardSummary/handlers/sendOrderSms/entry.ts');
assert('SMS validates sender and recipient E.164 numbers.', sms.includes('normalizeE164(phone_number)') && sms.includes('normalizeE164(SENDBLUE_PHONE_NUMBER)'));
assert('SMS stores sanitized provider diagnostics for rejected requests.', sms.includes('provider_error_code') && sms.includes('safeProviderError'));

const accountBackends = [
  read('base44/functions/completeAccountSetup/entry.ts'),
  read('base44/functions/getCustomerAccountDashboardData/handlers/completeAccountSetup/entry.ts'),
];
assert(
  'Standalone and gateway account activation require only identity and phone, not address or birthday.',
  accountBackends.every(accountBackend => (
    accountBackend.includes('!authenticatedEmail || !requestedEmail || !firstName || !lastName || !phone') &&
    !accountBackend.includes('!phone || !birthday || !address')
  )),
);
const loyaltyEnrollment = read('base44/functions/createLoyaltyMember/entry.ts');
assert('Loyalty enrollment reuses a real-contact or authenticated Apple profile.', loyaltyEnrollment.includes('contactProfiles') && loyaltyEnrollment.includes('authenticatedProfiles') && loyaltyEnrollment.includes('existingProfile?.customer_email || authenticatedEmail'));
const accountPage = read('src/pages/AccountSetup.jsx');
assert('Account setup labels birthday and address as optional.', accountPage.includes('Birthday <span') && accountPage.includes('(optional until checkout)'));
const loyaltyPage = read('src/pages/admin/LoyaltyMembers.jsx');
assert('Loyalty admin uses the consolidated audit and management API.', loyaltyPage.includes("auditCustomerAppLoyaltyAfterPhase2") && loyaltyPage.includes('Audited points adjustment'));
const loyaltyAdmin = read('base44/functions/auditCustomerAppLoyaltyAfterPhase2/loyaltyAdmin.ts');
assert('Loyalty admin deduplicates mirrored orders and nets partial refunds.', loyaltyAdmin.includes('dedupePaidOrders') && loyaltyAdmin.includes('netOrderTotal'));
const alertManager = read('base44/functions/getAdminOperationsDashboardSummary/handlers/updateAdminOpsAlertStatus/entry.ts');
const noticeMaintenance = read('base44/functions/getAdminOperationsDashboardSummary/handlers/updateAdminOpsAlertStatus/noticeMaintenance.ts');
assert('Operational notice maintenance is consolidated into the existing alert manager.', alertManager.includes('handleOperationalNoticeMaintenance') && noticeMaintenance.includes('maintenance_apply'));
assert('The cleanup adds no new Base44 function slots.', !fs.existsSync(path.join(root, 'base44/functions/mutateLoyaltyPoints/entry.ts')) && !fs.existsSync(path.join(root, 'base44/functions/manageLoyaltyMembers/entry.ts')) && !fs.existsSync(path.join(root, 'base44/functions/maintainOperationalNotices/entry.ts')));

if (failures.length) {
  console.error(JSON.stringify({ ok: false, suite: 'g68-authoritative-loyalty-and-ingestion', failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, suite: 'g68-authoritative-loyalty-and-ingestion', assertions: 31, writes_performed: false, provider_calls_performed: false }, null, 2));
