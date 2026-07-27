#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const helperPath = 'src/lib/base44-result.js';
const files = [
  'src/pages/admin/ProductionQueueSummary.jsx',
  'src/pages/admin/DeliveryQueue.jsx',
  'src/pages/admin/Operations.jsx',
  'src/pages/admin/ComplianceOps.jsx',
  'src/pages/admin/NotificationCampaigns.jsx',
  'src/components/admin/StaffMemberPicker.jsx',
  'src/components/compliance/ComplianceLogsParity.jsx',
  'src/components/compliance/ProductionAuditPacket.jsx',
];

const helperSource = fs.readFileSync(helperPath, 'utf8');
const fileSources = Object.fromEntries(files.map(file => [file, fs.readFileSync(file, 'utf8')]));

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('1. Shared Base44 result helper parses string responses and fails without raw payload exposure', () => {
  assert.match(helperSource, /export function unwrapBase44Result/);
  assert.match(helperSource, /JSON\.parse\(value\)/);
  assert.match(helperSource, /unparseable_base44_function_response/);
  assert.doesNotMatch(helperSource, /raw_prefix|rawText|slice\(0/);
});

test('2. Production and delivery action paths use the shared parser', () => {
  for (const file of [
    'src/pages/admin/ProductionQueueSummary.jsx',
    'src/pages/admin/DeliveryQueue.jsx',
  ]) {
    assert.match(fileSources[file], /import \{ unwrapBase44Result \} from '@\/lib\/base44-result'/);
    assert.match(fileSources[file], /unwrapBase44Result\(res\)/);
    assert.doesNotMatch(fileSources[file], /const result = res\?\.data \|\| res/);
    assert.doesNotMatch(fileSources[file], /const payload = res\?\.data \|\| res/);
  }
});

test('3. Operations, compliance, and notification admin reads use the shared parser', () => {
  for (const file of [
    'src/pages/admin/Operations.jsx',
    'src/pages/admin/ComplianceOps.jsx',
    'src/pages/admin/NotificationCampaigns.jsx',
  ]) {
    assert.match(fileSources[file], /unwrapBase44Result|unwrapBase44Data/);
    assert.doesNotMatch(fileSources[file], /res\?\.data \|\| res/);
    assert.doesNotMatch(fileSources[file], /response\?\.data \|\| response/);
  }
});

test('4. Staff and compliance audit views use the shared parser', () => {
  for (const file of [
    'src/components/admin/StaffMemberPicker.jsx',
    'src/components/compliance/ComplianceLogsParity.jsx',
    'src/components/compliance/ProductionAuditPacket.jsx',
  ]) {
    assert.match(fileSources[file], /import \{ unwrapBase44Result \} from '@\/lib\/base44-result'/);
    assert.match(fileSources[file], /unwrapBase44Result\(res\)/);
  }
});

test('5. Shared result helper remains side-effect free', () => {
  assert.doesNotMatch(helperSource, /entities\.|functions\.invoke|fetch\s*\(|Stripe\.|shopify/i);
});

for (const item of tests) {
  item.fn();
}

console.log(JSON.stringify({
  success: true,
  suite: 'g51k-admin-function-result-unwrapping',
  cases: tests.length,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
