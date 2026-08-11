#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readinessPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminOperationsDashboardSummary/entry.ts';
const campaignPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/sendNotificationCampaign/entry.ts';
const campaignPagePath = 'src/pages/admin/NotificationCampaigns.jsx';
const criticalPath = 'scripts/ci/run-critical-regressions.mjs';

const readinessFunctionSource = fs.readFileSync(readinessPath, 'utf8');
const readinessStart = readinessFunctionSource.indexOf('function sanitizeBackendId');
const readinessEnd = readinessFunctionSource.indexOf('async function loadNativeOperationsDashboardContext');
assert.ok(readinessStart >= 0 && readinessEnd > readinessStart, 'embedded backend readiness segment must be discoverable');
const readinessSource = readinessFunctionSource.slice(readinessStart, readinessEnd);
const campaignSource = fs.readFileSync(campaignPath, 'utf8');
const campaignPage = fs.readFileSync(campaignPagePath, 'utf8');
const criticalSource = fs.readFileSync(criticalPath, 'utf8');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function assertNoWrites(source, label) {
  assert.doesNotMatch(source, /entities\.[A-Za-z0-9_]+\.(create|update|delete)\s*\(/, `${label} must not write entities`);
  assert.doesNotMatch(source, /functions\.invoke\s*\(/, `${label} must not invoke provider, sync, notification, or mutation functions`);
  assert.doesNotMatch(source, /\bfetch\s*\(/, `${label} must not make network provider calls`);
}

test('1. Backend readiness preview is admin-only and read-only.', () => {
  assert.match(readinessFunctionSource, /createClientFromRequest/);
  assert.match(readinessFunctionSource, /base44\.auth\.me\(\)/);
  assert.match(readinessFunctionSource, /user\.role !== 'admin'/);
  assert.match(readinessFunctionSource, /include_backend_readiness/);
  assert.match(readinessFunctionSource, /backend_readiness:\s*backendReadiness/);
  assertNoWrites(readinessSource, 'backend readiness preview');
  assert.match(readinessSource, /writes_performed:\s*false/);
  assert.match(readinessSource, /provider_calls_performed:\s*false/);
  assert.match(readinessSource, /customer_notifications_sent:\s*false/);
});

test('2. Backend readiness checks production, compliance, fulfillment, sync, command, and campaign surfaces.', () => {
  for (const token of [
    'ProductionBatch',
    'FulfillmentTask',
    'Order',
    'ShopifyOrder',
    'SanitationLog',
    'DailyChecklist',
    'TemperatureLog',
    'BatchComplianceLog',
    'CommandLog',
    'OrderSyncLog',
    'NotificationCampaign',
  ]) {
    assert.match(readinessSource, new RegExp(`'${token}'`));
  }
});

test('3. Backend readiness preview excludes internal test records from operational findings.', () => {
  assert.match(readinessSource, /function isBackendTestBatch/);
  assert.match(readinessSource, /function isBackendTestTask/);
  assert.match(readinessSource, /function isBackendInternalCommand/);
  assert.match(readinessSource, /audience !== 'test_only' && numberOrZero\(campaign\?\.failed_count\)/);
  assert.match(readinessSource, /internal_test_batches_excluded/);
  assert.match(readinessSource, /internal_test_tasks_excluded/);
});

test('4. Backend readiness preview detects the known high-risk drift categories.', () => {
  for (const code of [
    'batch_started_without_complete_prestart_compliance',
    'verified_batch_missing_batch_compliance_log',
    'delivered_task_missing_delivered_at',
    'delivered_task_order_status_not_projected',
    'past_due_task_not_terminal',
    'recent_shopify_order_update_without_order_sync_log',
    'campaign_has_delivery_failures',
  ]) {
    assert.match(readinessSource, new RegExp(code));
  }
  assert.match(readinessSource, /recent_command_\$\{status\}/);
  assert.match(readinessSource, /status === 'failed' \? 'warning' : 'info'/);
});

test('5. Backend readiness preview redacts PII and does not return raw records.', () => {
  assert.match(readinessSource, /pii_redacted:\s*true/);
  assert.match(readinessSource, /raw_records_returned:\s*false/);
  assert.match(readinessSource, /\\[redacted email\\]/);
  assert.match(readinessSource, /\\[redacted phone\\]/);
  assert.match(readinessSource, /\\[redacted address\\]/);
});

test('6. Broad notification campaigns require explicit audience phrase and recipient ceiling.', () => {
  assert.match(campaignSource, /broad_send_confirmation/);
  assert.match(campaignSource, /max_recipient_ack/);
  assert.match(campaignSource, /broad_campaign_confirmation_required/);
  assert.match(campaignSource, /broad_campaign_recipient_ack_required/);
  assert.match(campaignSource, /acknowledgedMax < uniqueEmails\.length/);
});

test('7. Admin campaign UI collects the broad-send ceiling before executing a non-test send.', () => {
  assert.match(campaignPage, /maxRecipientAck/);
  assert.match(campaignPage, /window\.prompt/);
  assert.match(campaignPage, /broad_send_confirmation:\s*`send_\$\{form\.audience\}_campaign`/);
  assert.match(campaignPage, /max_recipient_ack:\s*maxRecipientAck/);
});

test('8. Reporting exposes the backend readiness preflight without mutation controls.', () => {
  const reportingSource = fs.readFileSync('src/pages/admin/Reporting.jsx', 'utf8');
  assert.match(reportingSource, /getAdminOperationsDashboardSummary/);
  assert.match(reportingSource, /include_backend_readiness:\s*true/);
  assert.match(reportingSource, /Backend Live Preflight/);
  assert.match(reportingSource, /Read-only reconciliation/);
  assert.doesNotMatch(reportingSource, /executeOperationalBackendReadiness|runBackendRepair|triggerBackendSync/);
});

test('9. G55 readiness guard is part of critical regressions.', () => {
  assert.match(criticalSource, /run-g55-backend-live-use-readiness-tests\.mjs/);
});

for (const item of tests) {
  item.fn();
}

console.log(JSON.stringify({
  success: true,
  suite: 'g55-backend-live-use-readiness',
  cases: tests.length,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
