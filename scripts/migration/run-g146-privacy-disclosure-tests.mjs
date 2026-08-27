#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const legal = fs.readFileSync('src/pages/Legal.jsx', 'utf8');
const deletion = fs.readFileSync(
  'base44/functions/getCustomerAccountDashboardData/handlers/requestAccountDeletion/entry.ts',
  'utf8',
);
const routeTelemetry = fs.readFileSync(
  'base44/functions/getAdminOperationsDashboardSummary/handlers/manageDriverRouteTelemetry/entry.ts',
  'utf8',
);
const profileAvatar = fs.readFileSync('src/components/account/ProfileAvatar.jsx', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const checks = [
  ['profile and optional user-content collection is disclosed', () => {
    assert.match(legal, /optional birthday, profile photo, wellness goals, juice experience, flavor preferences, and preferred drink time/);
    assert.match(profileAvatar, /UploadFile\(\{ file: compressedFile \}\)/);
    assert.match(profileAvatar, /profile_photo_url: photoUrl/);
  }],
  ['commerce, rewards, notification, and technical records are disclosed', () => {
    assert.match(legal, /purchase history, discounts, payment and refund status/);
    assert.match(legal, /points, credits, referrals, program journeys and check-ins, notification choices/);
    assert.match(legal, /push-notification tokens or endpoints, device platform, app version or build/);
  }],
  ['payment boundary does not claim NuVira stores card numbers', () => {
    assert.match(legal, /Stripe processes payment details; NuVira does not store your full card number/);
    assert.match(legal, /transaction identifiers and payment, refund, and tax records/);
    assert.doesNotMatch(legal, /NuVira (?:stores|retains) (?:your )?(?:full )?card number/i);
  }],
  ['active route location purpose, provider, minimization, and customer boundary are explicit', () => {
    assert.match(legal, /authorized NuVira operator starts route tracking/);
    assert.match(legal, /precise location to NuVira and Google Routes/);
    assert.match(legal, /does not persist the raw coordinates in its route record after calculation/);
    assert.match(legal, /Customers do not receive the operator's exact location/);
    assert.match(legal, /this data is not used for advertising/);
    assert.match(legal, /Google Maps Platform and Google Routes/);
    assert.match(routeTelemetry, /location_storage: 'coordinates_discarded_after_derivation'/);
    assert.match(routeTelemetry, /https:\/\/routes\.googleapis\.com\/directions\/v2:computeRoutes/);
  }],
  ['authentication and transactional communication providers are disclosed', () => {
    assert.match(legal, /Apple and Google — optional account sign-in providers/);
    assert.match(legal, /Resend, Apple Push Notification service, and Firebase Cloud Messaging/);
  }],
  ['retention statement matches the implemented deletion boundary', () => {
    for (const category of [
      'orders',
      'payment_records',
      'refund_records',
      'tax_records',
      'fulfillment_and_delivery_records',
      'food_safety_and_compliance_records',
      'sync_and_audit_logs',
    ]) {
      assert.match(deletion, new RegExp(`'${category}'`));
    }
    assert.match(legal, /app profile, notification preference, push subscription, in-app notification, and loyalty or reward records/);
    assert.match(legal, /Order, payment, refund, tax, fulfillment, delivery, food-safety, compliance, sync, and audit records may be retained/);
    assert.match(legal, /Records held independently by service providers/);
  }],
  ['deletion and consent rights avoid blanket or misleading promises', () => {
    assert.match(legal, /Request account-data deletion in Account Settings/);
    assert.match(legal, /Review or change optional Website analytics and Ad insights choices/);
    assert.doesNotMatch(legal, /Request full deletion/);
    assert.doesNotMatch(legal, /Your data is retained as long as your account is active/);
  }],
  ['unsupported blanket crash-log collection claim is absent', () => {
    assert.doesNotMatch(legal, /App usage: crash logs and page views/);
    assert.match(legal, /technical records needed to provide, secure, and maintain the service/);
  }],
  ['existing G141-G145 measurement disclosures remain intact', () => {
    assert.match(legal, /Google Analytics remains off unless you enable Website analytics/);
    assert.match(legal, /Meta and Snapchat measurement remain off unless you enable Ad insights/);
    assert.match(legal, /These optional web tools are not enabled inside the native iOS or Android app/);
    assert.match(legal, /A paid Snapchat Purchase event may be sent/);
  }],
  ['G146 is permanently included in the critical regression suite', () => {
    assert.match(critical, /run-g146-privacy-disclosure-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  check();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

console.log(`G146 privacy-disclosure coverage: ${passed}/${checks.length} checks passed`);
