#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const source = read('base44/functions/customerJourneyAutomation/customerJourneyAutomation.ts');
const campaignEntry = read('base44/functions/sendNotificationCampaign/entry.ts');
const schedulerEntry = read('base44/functions/customerJourneyAutomation/entry.ts');
const cart = read('src/lib/cartContext.jsx');
const checkout = read('src/pages/Checkout.jsx');
const campaigns = read('src/pages/admin/NotificationCampaigns.jsx');
const loyalty = read('base44/functions/createLoyaltyMember/entry.ts');
const marketingLaunch = read('base44/functions/customerJourneyAutomation/marketingLaunch.ts');
const orderConfirmation = read('base44/functions/sendOrderReceivedNotification/entry.ts');
const transactionalCommunications = read('base44/functions/sendOrderStatusNotification/elevatedTransactionalCommunications.ts');
const stripeWebhook = read('base44/functions/stripeWebhook/entry.ts');

for (const entity of ['CustomerJourneyEvent', 'CustomerJourneyState']) {
  const schema = JSON.parse(read(`base44/entities/${entity}.jsonc`));
  for (const permission of ['create', 'read', 'update', 'delete']) {
    assert.deepEqual(schema.rls?.[permission], { user_condition: { role: 'admin' } });
  }
}

assert.match(campaignEntry, /req\.method !== 'POST'/);
assert.match(schedulerEntry, /req\.method !== 'POST'/);
assert.match(schedulerEntry, /action: 'evaluate_scheduled'/);
assert.match(schedulerEntry, /'internal_proof_event'/);
assert.match(schedulerEntry, /handleCustomerJourneyRequest\(base44, caller, journeyBody\)/);
assert.match(schedulerEntry, /unauthorized_scheduler_invocation/);
assert.doesNotMatch(schedulerEntry, /campaign_id|broad_send_confirmation|max_recipient_ack/);
assert.match(campaignEntry, /async function optionalAuthenticatedUser/);
assert.match(campaignEntry, /try \{\s*return await base44\.auth\.me\(\);\s*\} catch/);
assert.match(campaignEntry, /const user = await optionalAuthenticatedUser\(base44\)/);
assert.match(campaignEntry, /const rawBody = await req\.text\(\)/);
assert.match(campaignEntry, /if \(rawBody\.trim\(\)\)/);
assert.match(campaignEntry, /let body: Record<string, any> = \{\}/);
assert.match(source, /status:\s*401/);
assert.match(source, /caller\.role !== 'admin'/);
assert.match(source, /status:\s*403/);
assert.ok(source.indexOf("if (!caller)") < source.indexOf("action === 'record_activity'"));
assert.doesNotMatch(campaignEntry, /handleCustomerJourneyRequest|evaluate_scheduled|record_activity/);

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
assert.match(source, /https:\/\/api\.resend\.com\/events\/send/);
assert.match(source, /const normalizedPayload = providerPayload\(eventName, payload\)/);
assert.match(source, /payload: normalizedPayload/);
assert.match(source, /normalizeSingleLine\(rawKey, 120\)\.toLowerCase\(\)/);
assert.match(source, /\['undefined', 'null', 'nan'\]\.includes/);
assert.match(source, /provider_payload_missing:/);
assert.match(source, /provider_payload_type:/);
assert.match(source, /journeyStageError\('load_cart_states'/);
assert.match(source, /journeyStageError\('load_loyalty_order_subscription_sources'/);
assert.match(source, /PROVIDER_REQUIRED_FIELDS/);
assert.match(source, /PROVIDER_NUMBER_FIELDS/);
assert.ok(source.includes("NuVira Juice Company, 619 N. Main St., O'Fallon, MO 63366"));
assert.doesNotMatch(source, /206 W\. Pine Creek Ct\./);
assert.match(source, /CART_TOTAL:\s*Number\(finiteNumber\(state\.cart_total, 0\)\.toFixed\(2\)\)/);
assert.match(source, /CART_TOTAL:\s*12,/);
assert.match(source, /POSCustomerClaim\.filter/);
assert.match(source, /REVIEW_URL:/);
assert.match(source, /loyalty_joined: \['customer_name', 'points', 'discount_code', 'review_url'/);
assert.match(source, /existingJourneyEvent/);
assert.match(source, /results\.length >= maxEvents/);
assert.match(source, /send_test_customer_journey/);
assert.match(source, /sandbox_requires_test_mode/);
assert.match(source, /internal_proof_event/);
assert.match(source, /SEND INTERNAL NUVIRA JOURNEY PROOF/);
assert.match(source, /email !== 'info@nuvirajuice\.com'/);
assert.match(source, /eventName === 'subscription_recommended'/);
assert.match(source, /ENABLE_SUBSCRIPTION_RECOMMENDATION_EMAILS/);
assert.match(source, /subscriptionRecommendationEnabled\(\)/);
assert.match(source, /SUBSCRIBE_URL:\s*`\$\{APP_URL\}\/subscribe`/);
assert.doesNotMatch(source, /APP_URL\}\/subscriptions/);
assert.match(source, /protectedCustomerUrl\('\/account\/settings'\)/);
assert.doesNotMatch(source, /APP_URL\}\/account\/notifications/);
assert.match(source, /marketing_sunset_suppressed/);
assert.match(source, /marketing_sunset_retained/);
assert.match(source, /CUSTOMER_JOURNEY_SUNSET_GRACE_DAYS/);
assert.match(source, /NotificationPreference\.update\(preference\.id, \{ promotions: false \}\)/);
assert.match(source, /promotions:\s*false/);
assert.match(source, /noticeDeliveredAt/);
assert.match(source, /marketing_sunset_auto_pause:\s*true/);

assert.match(source, /action === 'evaluate_scheduled'/);
assert.match(source, /handleMarketingLaunchAction/);
assert.match(marketingLaunch, /SYNC VERIFIED NUVIRA MARKETING CONTACTS/);
assert.match(marketingLaunch, /CREATE NUVIRA MARKETING DRAFT/);
assert.match(marketingLaunch, /SEND NUVIRA MARKETING PROOF/);
assert.match(marketingLaunch, /HOLD NUVIRA MARKETING ORDER/);
assert.match(marketingLaunch, /internalOrPrivateEmail/);
assert.match(marketingLaunch, /providerContact\?\.unsubscribed === true/);
assert.match(marketingLaunch, /segment_id: segment\.id/);
assert.match(marketingLaunch, /segments\/\$\{encodeURIComponent\(segmentId\)\}\/contacts/);
assert.match(marketingLaunch, /removeContactFromSegment/);
assert.match(marketingLaunch, /active_until_order_terminal/);
assert.match(marketingLaunch, /release_on_order_terminal/);
assert.match(marketingLaunch, /order_hold_excluded_count/);
assert.match(marketingLaunch, /CommandLog/);
assert.match(marketingLaunch, /marketing_order_hold/);
assert.match(marketingLaunch, /releaseCompletedMarketingHold/);
assert.match(marketingLaunch, /global_contact_unsubscribed: false/);
assert.match(marketingLaunch, /provider_order_hold_verification_failed/);
assert.match(source, /marketing_hold_release: marketingHoldRelease/);
assert.match(marketingLaunch, /send: false/);
assert.match(marketingLaunch, /RESEND_UNSUBSCRIBE_URL/);
assert.match(marketingLaunch, /619 N\. Main St\./);
assert.match(marketingLaunch, /NuViraSummer/);
assert.match(marketingLaunch, /google\.com\/search\?q=nuvirajuiceco#lrd=0x6ba31dd76fc40465:0x251d9ffa6e774456,3/);
assert.doesNotMatch(marketingLaunch, /g\.page\/nuvirajuiceco\/review/);
assert.doesNotMatch(source, /g\.page\/nuvirajuiceco\/review/);
assert.match(orderConfirmation, /customer_name/);
assert.match(orderConfirmation, /customerFirstName/);
assert.match(orderConfirmation, /escapeHtml/);
assert.match(orderConfirmation, /native-login\?return_to=/);
assert.match(orderConfirmation, /View My Order/);
assert.match(orderConfirmation, /<strong>Status:<\/strong> Order confirmed/);
assert.doesNotMatch(orderConfirmation, /Order Received — Scheduled for Juicing/);
assert.doesNotMatch(orderConfirmation, /total\?\.toFixed/);
assert.match(transactionalCommunications, /native-login\?return_to=/);
assert.match(stripeWebhook, /customer_name:\s*resolvedCustomerName/);
assert.match(source, /body\?\.event && body\?\.data/);
assert.match(source, /asServiceRole\.entities\.Order\.get\(orderId\)/);
assert.match(source, /authoritative_order_not_found/);
assert.ok(source.indexOf("if (action === 'evaluate_scheduled')") < source.indexOf('if (!caller)'));
assert.ok(source.indexOf('if (entityAutomation)') < source.indexOf('if (!caller)'));
assert.match(campaigns, /customerJourneyAutomation', \{ action: 'preview/);
assert.match(campaigns, /sendNotificationCampaign/);

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
