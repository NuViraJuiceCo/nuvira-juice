#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildOrderEmailHtml } from '../../base44/functions/sendOrderStatusNotification/orderEmailTemplate.js';
import {
  buildOrderCommunicationCopy,
  orderCommunicationPolicySummary,
} from '../../base44/functions/sendOrderStatusNotification/orderCommunicationPolicy.js';

const read = (path) => fs.readFileSync(path, 'utf8');
const source = read('base44/functions/customerJourneyAutomation/customerJourneyAutomation.ts');
const campaignEntry = read('base44/functions/getAdminOperationsDashboardSummary/handlers/sendNotificationCampaign/entry.ts');
const schedulerEntry = read('base44/functions/customerJourneyAutomation/entry.ts');
const cart = read('src/lib/cartContext.jsx');
const checkout = read('src/pages/Checkout.jsx');
const campaigns = read('src/pages/admin/NotificationCampaigns.jsx');
const loyalty = read('base44/functions/createLoyaltyMember/entry.ts');
const marketingLaunch = read('base44/functions/customerJourneyAutomation/marketingLaunch.ts');
const orderConfirmation = read('base44/functions/sendOrderReceivedNotification/entry.ts');
const transactionalCommunications = read('base44/functions/sendOrderStatusNotification/elevatedTransactionalCommunications.ts');
const orderStatusEntry = read('base44/functions/sendOrderStatusNotification/entry.ts');
const orderEmailTemplate = read('base44/functions/sendOrderStatusNotification/orderEmailTemplate.js');
const stripeWebhook = read('base44/functions/stripeWebhook/entry.ts');
const zone3Approval = read('base44/functions/getAdminOperationsDashboardSummary/handlers/approveZone3DeliveryRequest/entry.ts');
const zone3Denial = read('base44/functions/getAdminOperationsDashboardSummary/handlers/denyZone3DeliveryRequest/entry.ts');
const operationsEmail = read('base44/functions/getAdminOperationsDashboardSummary/handlers/notifyOrderProcessed/entry.ts');

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
assert.match(source, /CART_TOTAL:\s*13,/);
assert.match(source, /CART_IMAGE_URL:\s*cartImageUrl\(abandonedItems\)/);
assert.match(source, /cart_abandoned: \['customer_name', 'cart_summary', 'item_count', 'cart_total', 'cart_image_url'/);
assert.match(source, /POSCustomerClaim\.filter/);
assert.match(source, /REVIEW_URL:/);
assert.match(source, /loyalty_joined: \['customer_name', 'points', 'points_rate', 'discount_code', 'review_url'/);
assert.match(source, /POINTS_RATE:\s*10/);
assert.match(source, /FAVORITE_PRODUCT_DESCRIPTION:\s*favorite\.description/);
assert.match(source, /FAVORITE_PRODUCT_IMAGE_URL:\s*favorite\.image_url/);
assert.match(source, /PROGRAM_SUMMARY:\s*CURRENT_PROGRAM_SUMMARY/);
assert.match(source, /PROGRAMS_URL:\s*`\$\{APP_URL\}\/programs`/);
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
assert.match(transactionalCommunications, /https:\/\/www\.nuvirajuice\.com/);
assert.match(orderStatusEntry, /buildOrderCommunicationCopy\('delivered'/);
assert.match(orderStatusEntry, /buildOrderEmailHtml/);
assert.match(orderStatusEntry, /\['sent', 'delivered'\]\.includes/);
assert.doesNotMatch(orderStatusEntry, /<p>Hi there,<\/p>/);
assert.doesNotMatch(orderStatusEntry, /fullOrder\.total \|\| 0\)\.toFixed/);
assert.ok(orderEmailTemplate.includes("NuVira Juice Company, 619 N. Main St., O'Fallon, MO 63366"));
assert.doesNotMatch(orderEmailTemplate, /Wentzville, Missouri/);
assert.match(orderConfirmation, /\['sent', 'delivered'\]\.includes/);
for (const customerEmailSource of [zone3Approval, zone3Denial]) {
  assert.match(customerEmailSource, /escapeHtml/);
  assert.match(customerEmailSource, /\['sent', 'delivered'\]\.includes/);
  assert.ok(customerEmailSource.includes("619 N. Main St., O'Fallon, MO 63366"));
  assert.doesNotMatch(customerEmailSource, /Wentzville, MO/);
  assert.match(customerEmailSource, /name="viewport"/);
}
assert.match(operationsEmail, /escapeHtml/);
assert.match(operationsEmail, /function money/);
assert.doesNotMatch(operationsEmail, /total\?\.toFixed/);

const proofOrder = {
  id: 'proof-order-id',
  order_number: 'NV-PROOF-1001',
  customer_name: '<script>alert(1)</script> Taylor',
  customer_email: 'info@nuvirajuice.com',
  items: [{ title: '<b>Oasis</b>', quantity: 2, price: '12.50' }],
  total: '25.00',
};
for (const policy of orderCommunicationPolicySummary().filter((row) => row.email !== 'never')) {
  const copy = buildOrderCommunicationCopy(policy.event, proofOrder);
  const rendered = buildOrderEmailHtml({
    copy,
    order: proofOrder,
    actionUrl: 'https://www.nuvirajuice.com/native-login?return_to=%2Forder-tracker%2FNV-PROOF-1001',
  });
  assert.doesNotMatch(rendered, /(?:undefined|null|NaN)/i, `${policy.event} rendered an invalid placeholder`);
  assert.match(rendered, /619 N\. Main St\., O'Fallon, MO 63366/);
  assert.match(rendered, /native-login\?return_to=/);
  assert.doesNotMatch(rendered, /<script>/i);
  assert.match(rendered, /&lt;script&gt;/);
}
assert.match(stripeWebhook, /customer_name:\s*resolvedCustomerName/);
assert.match(source, /body\?\.event && body\?\.data/);
assert.match(source, /asServiceRole\.entities\.Order\.get\(orderId\)/);
assert.match(source, /authoritative_order_not_found/);
assert.ok(source.indexOf("if (action === 'evaluate_scheduled')") < source.indexOf('if (!caller)'));
assert.ok(source.indexOf('if (entityAutomation)') < source.indexOf('if (!caller)'));
assert.match(campaigns, /customerJourneyAutomation', \{ action: 'preview/);
assert.match(campaigns, /sendNotificationCampaign/);

assert.doesNotMatch(loyalty, /ENABLE_LEGACY_LOYALTY_WELCOME_EMAIL/);
assert.doesNotMatch(loyalty, /api\.resend\.com\/emails/);
assert.match(loyalty, /idempotency_key:\s*`loyalty_signup:\$\{customerEmail\}`/);
assert.match(loyalty, /transaction_type:\s*'bonus'/);
assert.doesNotMatch(loyalty, /api\/customer-app-sync\/enroll-loyalty/);

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
