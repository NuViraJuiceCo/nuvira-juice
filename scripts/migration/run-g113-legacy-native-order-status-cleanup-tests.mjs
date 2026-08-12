import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildPatch,
  containsLegacyText,
  normalizeLegacyString,
  normalizeLegacyValue,
  shouldArchiveLegacyReview,
} from './normalize-legacy-native-order-statuses.mjs';

const migrationPath = new URL('./normalize-legacy-native-order-statuses.mjs', import.meta.url);
const migrationSource = fs.readFileSync(migrationPath, 'utf8');
const auditPath = new URL('./audit-legacy-native-status-migration-side-effects.mjs', import.meta.url);
const auditSource = fs.readFileSync(auditPath, 'utf8');
const historyAuditPath = new URL('./audit-legacy-native-order-log-history.mjs', import.meta.url);
const historyAuditSource = fs.readFileSync(historyAuditPath, 'utf8');

assert.match(migrationSource, /const APPLY_CHANGES = false;/, 'migration must default to preview');
assert.match(migrationSource, /MAX_EXPECTED_LEGACY_RECORDS = 201/, 'migration must retain reviewed blast-radius ceiling');
assert.match(migrationSource, /bulkUpdate/, 'migration should update only the exact reviewed rows');
assert.doesNotMatch(migrationSource, /\.delete\(|deleteMany|bulkDelete/, 'migration must not delete production records');
assert.doesNotMatch(migrationSource, /functions\.invoke|integrations\.|fetch\(/, 'migration must not call functions or providers');
assert.doesNotMatch(auditSource, /\.update\(|bulkUpdate|updateMany|\.create\(|\.delete\(/, 'side-effect audit must remain read-only');
assert.doesNotMatch(auditSource, /customer_email|customer_phone|provider_message_id/, 'side-effect audit must not return PII or provider IDs');
assert.doesNotMatch(historyAuditSource, /\.update\(|bulkUpdate|updateMany|\.create\(|\.delete\(/, 'historical audit must remain read-only');
assert.doesNotMatch(historyAuditSource, /customer_email|customer_phone|actor_email|stripe_event_id/, 'historical audit must not return PII or provider IDs');

assert.equal(normalizeLegacyString('native_may30_ready'), 'native_ops_ready');
assert.equal(normalizeLegacyString('native_may30_refunded'), 'native_ops_refunded');
assert.equal(normalizeLegacyString('may30_native_ops'), 'native_order_ops');
assert.equal(normalizeLegacyString('processMay30NativeOrderOps'), 'syncOrderToHub');
assert.equal(
  normalizeLegacyString('request=may30_native_ops:123'),
  'request=native_order_ops:123',
);

const legacyRow = {
  id: 'row-1',
  sync_status: 'native_may30_ready',
  tags: ['may30_native_ops', 'pos_sale'],
  audit_trail: [{ source: 'processMay30NativeOrderOps', request_id: 'may30_native_ops:123' }],
  payment_status: 'paid',
  fulfillment_status: 'fulfilled',
};
const patch = buildPatch(legacyRow, ['id', 'sync_status', 'tags', 'audit_trail']);
assert.deepEqual(patch, {
  sync_status: 'native_ops_ready',
  tags: ['native_order_ops', 'pos_sale'],
  audit_trail: [{ source: 'syncOrderToHub', request_id: 'native_order_ops:123' }],
});
assert.equal('payment_status' in patch, false, 'payment state must not be touched');
assert.equal('fulfillment_status' in patch, false, 'fulfillment state must not be touched');
assert.equal(containsLegacyText(normalizeLegacyValue(legacyRow)), false);
assert.equal(shouldArchiveLegacyReview({
  status: 'pending',
  incident_type: 'missing_customer_info',
  issue_description: 'May 30 native order ops rejected order: delivery_order_missing_address',
  existing_order_id: null,
  existing_order_number: null,
}), true, 'orphaned launch diagnostics should be archived');
assert.equal(shouldArchiveLegacyReview({
  status: 'pending',
  incident_type: 'missing_customer_info',
  issue_description: 'May 30 native order ops rejected order: delivery_order_missing_address',
  existing_order_id: 'real-order-id',
}), false, 'linked order reviews must not be archived automatically');
assert.deepEqual(
  buildPatch({ id: 'row-2', sync_status: 'native_ops_ready' }, ['id', 'sync_status']),
  {},
  'current rows must be idempotent no-ops',
);

console.log(JSON.stringify({
  ok: true,
  suite: 'g113-legacy-native-order-status-cleanup',
  checks: 22,
  default_mode: 'preview',
  destructive_operations: false,
  provider_calls: false,
}, null, 2));
