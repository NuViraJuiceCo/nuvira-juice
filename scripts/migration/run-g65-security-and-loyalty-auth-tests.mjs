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

console.log(JSON.stringify({
  ok: true,
  suite: 'g65-security-and-loyalty-auth',
  admin_only_entities: adminOnlyEntities.length,
  admin_only_functions: adminOnlyFunctions.length,
  authenticated_customer_functions: 3,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
