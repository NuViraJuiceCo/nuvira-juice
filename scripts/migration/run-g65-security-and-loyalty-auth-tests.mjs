#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');

const adminOnlyEntities = [
  'CCPLog',
  'ComplianceLog',
  'CorrectiveActionLog',
  'DailyChecklist',
  'ManualProductionBatch',
  'PurchaseOrder',
  'SanitationLog',
  'TemperatureLog',
  'pHLog',
];

const expectedAdminRule = { user_condition: { role: 'admin' } };
for (const entity of adminOnlyEntities) {
  const schema = JSON.parse(read(`base44/entities/${entity}.jsonc`));
  for (const permission of ['create', 'read', 'update', 'delete']) {
    assert.deepEqual(
      schema.rls?.[permission],
      expectedAdminRule,
      `${entity}.${permission} must be explicitly admin-only`,
    );
  }
  assert.doesNotMatch(JSON.stringify(schema.rls), /user\.full_name/);
}

const adminOnlyFunctions = [
  'autoExpireZone3Authorizations',
  'cancelAbandonedCheckouts',
  'cancelIncompleteSubscriptions',
  'deleteProductFromShopify',
  'notifyOrderProcessed',
  'sendCustomerNotification',
  'sendCustomerPushNotification',
  'sendOrderConfirmation',
  'sendOrderReceivedNotification',
  'sendOrderSms',
  'sendOrderStatusNotification',
  'repairMissingCASubscriptionFromStripeAndHub',
];

for (const functionName of adminOnlyFunctions) {
  const source = read(`base44/functions/${functionName}/entry.ts`);
  assert.match(source, /createClientFromRequest\(req\)/, `${functionName} must create an authenticated request client`);
  assert.match(source, /auth\.me\(\)\.catch\(\(\) => null\)/, `${functionName} must explicitly authenticate the caller`);
  assert.match(source, /status:\s*401/, `${functionName} must reject anonymous callers`);
  assert.match(source, /caller\.role !== 'admin'|user\.role !== 'admin'/, `${functionName} must restrict provider or mutation access to admins`);
  assert.match(source, /status:\s*403/, `${functionName} must reject non-admin callers`);
}

const autoExpireZone3 = read('base44/functions/autoExpireZone3Authorizations/entry.ts');
assert.match(autoExpireZone3, /if \(!user\)/);
assert.ok(
  autoExpireZone3.indexOf('if (!user)') < autoExpireZone3.indexOf('ENABLE_ZONE3_AUTO_EXPIRE_AUTHORIZATIONS'),
  'Zone 3 expiration must authenticate before revealing or evaluating feature-gate state',
);

const cancelAbandoned = read('base44/functions/cancelAbandonedCheckouts/entry.ts');
assert.doesNotMatch(cancelAbandoned, /body\?\.scheduled === true/);
assert.doesNotMatch(cancelAbandoned, /if \(!isScheduled\)/);

const cancelIncomplete = read('base44/functions/cancelIncompleteSubscriptions/entry.ts');
assert.doesNotMatch(cancelIncomplete, /assume called by automation\/scheduler/i);
assert.doesNotMatch(cancelIncomplete, /isScheduled = true/);
assert.ok(
  cancelIncomplete.indexOf('if (!user)') < cancelIncomplete.indexOf('ENABLE_INCOMPLETE_SUBSCRIPTION_CLEANUP'),
  'Incomplete subscription cleanup must authenticate before feature-gate state',
);

const addressSuggest = read('base44/functions/addressSuggest/entry.ts');
assert.match(addressSuggest, /createClientFromRequest\(req\)/);
assert.match(addressSuggest, /auth\.me\(\)\.catch\(\(\) => null\)/);
assert.match(addressSuggest, /status:\s*401/);

const claimReward = read('base44/functions/claimReward/entry.ts');
assert.match(claimReward, /requestedEmail !== authenticatedEmail/);
assert.match(claimReward, /Cannot claim a reward for another customer/);
assert.match(claimReward, /entities\.RewardTier\.filter/);
assert.match(claimReward, /Reward details do not match the active catalog/);
assert.match(claimReward, /Not enough points for this reward/);
assert.match(claimReward, /selected_pending_checkout/);

const completeAccountSetup = read('base44/functions/completeAccountSetup/entry.ts');
assert.match(completeAccountSetup, /requestedEmail !== authenticatedEmail/);
assert.match(completeAccountSetup, /Cannot update another customer profile/);
assert.match(completeAccountSetup, /phone,\s*\n\s*address,/);
assert.doesNotMatch(completeAccountSetup, /phone_number:\s*phone/);
assert.match(completeAccountSetup, /customer_email:\s*authenticatedEmail/);

const resendWebhook = read('base44/functions/resendWebhook/entry.ts');
assert.match(resendWebhook, /req\.method !== 'POST'/);
assert.match(resendWebhook, /await req\.text\(\)/);
assert.doesNotMatch(resendWebhook, /req\.json\(\)/);
assert.match(resendWebhook, /new Webhook\(webhookSecret\)\.verify/);
assert.match(resendWebhook, /req\.headers\.get\('svix-id'\)/);
assert.match(resendWebhook, /req\.headers\.get\('svix-timestamp'\)/);
assert.match(resendWebhook, /req\.headers\.get\('svix-signature'\)/);
assert.match(resendWebhook, /provider_message_id:\s*providerMessageId/);
assert.match(resendWebhook, /resend_webhook_event_ids/);
assert.doesNotMatch(resendWebhook, /rawBody[^\n]*metadata|payload:\s*event|raw_payload/);

const deliveryLogSchema = JSON.parse(read('base44/entities/CustomerMessageDeliveryLog.jsonc'));
assert.ok(deliveryLogSchema.properties.message_type.enum.includes('transactional_order'));
for (const status of ['prepared', 'scheduled', 'sent', 'delivered', 'delivery_delayed', 'bounced', 'failed', 'suppressed', 'complained', 'skipped']) {
  assert.ok(deliveryLogSchema.properties.status.enum.includes(status), `delivery log status must support ${status}`);
}
for (const field of ['delivered_at', 'delivery_delayed_at', 'bounced_at', 'failed_at', 'suppressed_at', 'complained_at', 'opened_at', 'clicked_at', 'last_provider_event', 'last_provider_event_at', 'last_webhook_id']) {
  assert.equal(deliveryLogSchema.properties[field]?.type, 'string', `delivery log must define ${field}`);
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g65-security-and-loyalty-auth',
  admin_only_entities: adminOnlyEntities.length,
  admin_only_functions: adminOnlyFunctions.length,
  authenticated_customer_functions: 3,
  signed_public_webhooks: 1,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
