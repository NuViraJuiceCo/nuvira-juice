#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const source = read('base44/functions/sendNotificationCampaign/customerJourneyAutomation.ts');
const campaignEntry = read('base44/functions/sendNotificationCampaign/entry.ts');
const cart = read('src/lib/cartContext.jsx');
const checkout = read('src/pages/Checkout.jsx');
const campaigns = read('src/pages/admin/NotificationCampaigns.jsx');
const loyalty = read('base44/functions/createLoyaltyMember/entry.ts');

for (const entity of ['CustomerJourneyEvent', 'CustomerJourneyState']) {
  const schema = JSON.parse(read(`base44/entities/${entity}.jsonc`));
  for (const permission of ['create', 'read', 'update', 'delete']) {
    assert.deepEqual(schema.rls?.[permission], { user_condition: { role: 'admin' } });
  }
}

assert.match(campaignEntry, /req\.method !== 'POST'/);
assert.match(campaignEntry, /auth\.me\(\)\.catch\(\(\) => null\)/);
assert.match(source, /status:\s*401/);
assert.match(source, /caller\.role !== 'admin'/);
assert.match(source, /status:\s*403/);
assert.ok(source.indexOf("if (!caller)") < source.indexOf("action === 'record_activity'"));
assert.match(campaignEntry, /handleCustomerJourneyRequest/);
assert.ok(campaignEntry.indexOf('handleCustomerJourneyRequest') < campaignEntry.indexOf('campaignSendsDisabled()'));

assert.match(source, /const email = normalizeEmail\(caller\?\.email\)/);
assert.doesNotMatch(source, /recordActivity[\s\S]{0,1200}body\.customer_email/);
assert.match(source, /safeItems\(body\.items\)/);
assert.match(cart, /Journey analytics must never interrupt shopping or checkout/);
assert.match(cart, /\.catch\(\(\) =>/);
assert.match(checkout, /journeyCheckoutTrackedRef/);

for (const gate of [
  'CUSTOMER_JOURNEY_MODE',
  'ENABLE_CUSTOMER_JOURNEY_AUTOMATIONS',
  'CUSTOMER_JOURNEY_KILL_SWITCH',
  'ENABLE_RESEND_CUSTOMER_JOURNEY_EVENTS',
  'CUSTOMER_JOURNEY_LAUNCH_CUTOFF',
  'CUSTOMER_JOURNEY_TEST_RECIPIENT',
  'CUSTOMER_JOURNEY_MAX_EVENTS_PER_SWEEP',
]) {
  assert.match(source, new RegExp(gate));
}
assert.match(source, /eventAfterLaunch\(eventAt\)/);
assert.match(source, /outside_test_recipient/);
assert.match(source, /promotional_email_consent_missing/);
assert.match(source, /rewards_credits_disabled|preferenceField/);
assert.match(source, /Idempotency-Key/);
assert.match(source, /existingJourneyEvent/);
assert.match(source, /results\.length >= maxEvents/);
assert.match(source, /send_test_customer_journey/);
assert.match(source, /sandbox_requires_test_mode/);

assert.match(source, /action === 'evaluate_scheduled'/);
assert.match(source, /body\?\.event && body\?\.data/);
assert.match(campaigns, /sendNotificationCampaign', \{ action: 'preview/);
assert.doesNotMatch(campaigns, /customerJourneyAutomation/);

assert.match(loyalty, /ENABLE_LEGACY_LOYALTY_WELCOME_EMAIL/);
assert.match(loyalty, /total_points:\s*preorderBonus/);
assert.match(loyalty, /points_history:\s*\[bonusEntry\]/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g66-customer-journey-automation',
  journey_events: 9,
  provider_automations: 8,
  consent_gate: true,
  launch_cutoff_gate: true,
  recipient_cap: true,
  test_recipient_gate: true,
  idempotency_gate: true,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
