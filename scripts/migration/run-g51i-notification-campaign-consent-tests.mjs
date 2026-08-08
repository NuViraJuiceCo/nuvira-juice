#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const functionPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/sendNotificationCampaign/entry.ts';
const schemaPath = 'base44/entities/NotificationCampaign.jsonc';
const pagePath = 'src/pages/admin/NotificationCampaigns.jsx';

const functionSource = fs.readFileSync(functionPath, 'utf8');
const schemaSource = fs.readFileSync(schemaPath, 'utf8');
const pageSource = fs.readFileSync(pagePath, 'utf8');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function segment(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0, `${startToken} not found`);
  assert.ok(end > start, `${endToken} not found after ${startToken}`);
  return source.slice(start, end);
}

test('1. Broad notification campaigns require explicit notification preferences', () => {
  assert.match(functionSource, /const MAX_PREFERENCE_SCAN = 2000/);
  assert.match(functionSource, /entities\.NotificationPreference\.list\('-created_date', MAX_PREFERENCE_SCAN\)/);
  assert.match(functionSource, /const requiresCampaignPreference = campaign\.audience !== 'test_only'/);
});

test('2. Campaign type maps to the correct customer preference field', () => {
  const preferenceMapper = segment(functionSource, 'function campaignPreferenceField', 'function campaignPreferenceLabel');
  assert.match(preferenceMapper, /order_update/);
  assert.match(preferenceMapper, /order_updates/);
  assert.match(preferenceMapper, /promotions/);
});

test('3. General, promotion, and new-drop campaigns use the promotional subtype path', () => {
  const subtypeMapper = segment(functionSource, 'function campaignNotificationSubtype', 'function campaignPreferenceField');
  assert.match(subtypeMapper, /value === 'order_update' \? 'general' : 'promo'/);
  assert.doesNotMatch(subtypeMapper, /value === 'order_update' \|\| value === 'general'/);
});

test('4. Missing campaign preference skips rather than sends', () => {
  const filterSegment = segment(functionSource, 'if (requiresCampaignPreference) {', 'console.log(`[sendNotificationCampaign]');
  assert.match(filterSegment, /hasAllowedCampaignPreference/);
  assert.match(filterSegment, /missing_\$\{requiredPreferenceField\}_preference/);
  assert.match(filterSegment, /preferenceSkippedCount\+\+/);
  assert.match(filterSegment, /return false/);
});

test('5. No eligible broad recipients returns a non-success result with safe counts', () => {
  assert.match(functionSource, /const noEligibleRecipients = candidateEmails\.length > 0 && uniqueEmails\.length === 0/);
  assert.match(functionSource, /success: finalStatus === 'sent'/);
  assert.match(functionSource, /eligible_count: uniqueEmails\.length/);
  assert.match(functionSource, /recipients_total: candidateEmails\.length/);
});

test('6. Campaign schema stores consent-filter results without customer PII', () => {
  for (const field of ['skipped_count', 'recipients_total', 'eligible_count', 'skipped_reasons']) {
    assert.match(schemaSource, new RegExp(`"${field}"`));
  }
});

test('7. Admin UI explains broad-send eligibility instead of promising all-customer delivery', () => {
  assert.match(pageSource, /matching notification preference enabled/);
  assert.match(pageSource, /eligible customers/);
  assert.match(pageSource, /Campaign not sent/);
  assert.match(pageSource, /skipped_count/);
  assert.doesNotMatch(pageSource, /This will notify all customers/);
});

test('8. Broad campaign sends require a recipient ceiling acknowledgement', () => {
  assert.match(functionSource, /broad_send_confirmation/);
  assert.match(functionSource, /max_recipient_ack/);
  assert.match(functionSource, /broad_campaign_confirmation_required/);
  assert.match(functionSource, /broad_campaign_recipient_ack_required/);
  assert.match(pageSource, /Maximum eligible recipients you approve/);
  assert.match(pageSource, /max_recipient_ack:\s*maxRecipientAck/);
});

for (const item of tests) {
  item.fn();
}

console.log(JSON.stringify({
  success: true,
  suite: 'g51i-notification-campaign-consent',
  cases: tests.length,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
