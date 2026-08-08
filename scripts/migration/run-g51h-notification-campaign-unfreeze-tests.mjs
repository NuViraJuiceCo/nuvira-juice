#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const files = {
  ui: 'src/pages/admin/NotificationCampaigns.jsx',
  sendCampaign: 'base44/functions/getAdminOperationsDashboardSummary/handlers/sendNotificationCampaign/entry.ts',
  sendCustomerNotification: 'base44/functions/sendCustomerNotification/entry.ts',
  sendCustomerPush: 'base44/functions/sendCustomerPushNotification/entry.ts',
  docs: 'docs/ADMIN_PUSH_NOTIFICATIONS.md',
};

const source = Object.fromEntries(Object.entries(files).map(([key, relativePath]) => [key, read(relativePath)]));

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('admin UI no longer freezes customer campaign sending', () => {
  assert.doesNotMatch(source.ui, /CAMPAIGN_SENDS_ENABLED\s*=\s*false/);
  assert.doesNotMatch(source.ui, /Campaign Sends Frozen/);
  assert.match(source.ui, /badge=['"]Live['"]/);
  assert.match(source.ui, /customer_sends_enabled\s*\?\s*['"]Live['"]\s*:\s*['"]Sends locked['"]/);
  assert.match(source.ui, /production_sends_enabled\s*\?\s*['"]Live['"]\s*:\s*['"]Sends locked['"]/);
  assert.match(source.ui, /sendNotificationCampaign/);
});

test('admin UI keeps a confirmation gate for broad audiences only', () => {
  assert.match(source.ui, /form\.audience !== ['"]test_only['"][\s\S]*window\.confirm/);
  assert.match(source.ui, /Send Test Campaign/);
  assert.match(source.ui, /Send Campaign/);
  assert.match(source.ui, /queryClient\.invalidateQueries\(\{ queryKey: \[['"]notification-campaigns['"]\] \}/);
});

test('campaign sender uses the new kill switch and retains admin execution gates', () => {
  assert.doesNotMatch(source.sendCampaign, /ENABLE_NOTIFICATION_CAMPAIGN_SENDS/);
  assert.match(source.sendCampaign, /DISABLE_NOTIFICATION_CAMPAIGN_SENDS/);
  assert.match(source.sendCampaign, /req\.method !== ['"]POST['"]/);
  assert.match(source.sendCampaign, /user\.role !== ['"]admin['"]/);
  assert.match(source.sendCampaign, /confirm\s*=\s*false/);
  assert.match(source.sendCampaign, /Campaign already sent/);
});

test('campaign sender routes through customer notification creation, not direct entity writes', () => {
  assert.match(source.sendCampaign, /functions\.invoke\(['"]sendCustomerNotification['"]/);
  assert.match(source.sendCampaign, /source:\s*['"]notification_campaign['"]/);
  assert.match(source.sendCampaign, /idempotency_key:\s*`notification_campaign:\$\{campaign_id\}:\$\{email\}`/);
  assert.doesNotMatch(source.sendCampaign, /entities\.Notification\.create/);
  assert.match(source.sendCampaign, /push_sent_count/);
  assert.match(source.sendCampaign, /push_token_count/);
});

test('customer notification function permits approved campaign notification subtypes', () => {
  assert.match(source.sendCustomerNotification, /String\(source\s*\|\|\s*['"]['"]\)\s*===\s*['"]notification_campaign['"]/);
  assert.match(source.sendCustomerNotification, /DISABLE_NOTIFICATION_CAMPAIGN_SENDS/);
  assert.match(source.sendCustomerNotification, /sendCustomerPushNotification/);
  assert.match(source.sendCustomerNotification, /source,/);
});

test('customer push function allows notification campaigns without opening broad marketing push generally', () => {
  assert.match(source.sendCustomerPush, /source\s*===\s*['"]notification_campaign['"]/);
  assert.match(source.sendCustomerPush, /\[['"]promo['"],\s*['"]general['"]\]\.includes\(notificationSubtype\)/);
  assert.match(source.sendCustomerPush, /ENABLE_CUSTOMER_PUSH_NOTIFICATIONS/);
  assert.match(source.sendCustomerPush, /ENABLE_BROAD_CUSTOMER_PUSH/);
  assert.match(source.sendCustomerPush, /ENABLE_CUSTOMER_MARKETING_PUSH/);
  assert.match(source.sendCustomerPush, /notification_campaign_push_disabled/);
});

test('consolidated sender and docs describe live campaign sends with an emergency kill switch', () => {
  assert.match(source.sendCampaign, /DISABLE_NOTIFICATION_CAMPAIGN_SENDS/);
  assert.match(source.docs, /Customer Campaigns/);
  assert.match(source.docs, /DISABLE_NOTIFICATION_CAMPAIGN_SENDS=true/);
  assert.match(source.docs, /sent campaigns cannot be re-?sent/i);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error.stack || error.message);
    process.exit(1);
  }
}

console.log(JSON.stringify({
  ok: true,
  passed,
  classification: 'g51h_notification_campaign_sends_unfrozen',
}, null, 2));
