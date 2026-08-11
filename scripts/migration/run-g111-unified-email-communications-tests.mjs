#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_MARKETING_CADENCE_RULES,
  internalOrPrivateEmail,
  marketingCadenceDecision,
  testOrder,
} from '../../base44/functions/customerJourneyAutomation/marketingCadencePolicy.js';

const read = (file) => fs.readFileSync(file, 'utf8');
const now = Date.parse('2026-08-11T18:00:00.000Z');
const acceptedEvent = (hoursAgo, eventName = 'reorder_due') => ({
  event_name: eventName,
  resend_status: 'accepted',
  resend_forwarded_at: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
});
const transactionalMessage = (hoursAgo) => ({
  status: 'delivered',
  sent_at: new Date(now - hoursAgo * 60 * 60 * 1000).toISOString(),
});

assert.equal(internalOrPrivateEmail('info@nuvirajuice.com'), true);
assert.equal(internalOrPrivateEmail('customer@gmail.com'), false);
assert.equal(testOrder({ is_test_order: true }), true);
assert.equal(testOrder({ order_number: 'G104-TEST-RADIANCE-2' }), true);
assert.equal(testOrder({ order_number: 'NV-REAL-104' }), false);

assert.deepEqual(marketingCadenceDecision({
  email: 'info@nuvirajuice.com',
  eventName: 'order_delivered',
  nowMs: now,
}), { allowed: false, reason: 'internal_or_private_identity_excluded' });

assert.deepEqual(marketingCadenceDecision({
  email: 'customer@gmail.com',
  eventName: 'order_delivered',
  order: { order_number: 'G104-TEST-RESET-3' },
  nowMs: now,
}), { allowed: false, reason: 'test_order_excluded' });

assert.deepEqual(marketingCadenceDecision({
  email: 'customer@gmail.com',
  eventName: 'purchase_completed',
  nowMs: now,
}), { allowed: false, reason: 'transactional_order_confirmation_authoritative' });

assert.deepEqual(marketingCadenceDecision({
  email: 'customer@gmail.com',
  eventName: 'loyalty_joined',
  recentTransactionalMessages: [transactionalMessage(4)],
  nowMs: now,
}), { allowed: false, reason: 'recent_transactional_email_quiet_period' });

assert.deepEqual(marketingCadenceDecision({
  email: 'customer@gmail.com',
  eventName: 'reorder_due',
  recentEvents: [acceptedEvent(24)],
  nowMs: now,
}), { allowed: false, reason: 'recipient_marketing_cooldown' });

assert.deepEqual(marketingCadenceDecision({
  email: 'customer@gmail.com',
  eventName: 'reorder_due',
  recentEvents: [acceptedEvent(80), acceptedEvent(120)],
  nowMs: now,
}), { allowed: false, reason: 'recipient_weekly_marketing_cap' });

assert.deepEqual(marketingCadenceDecision({
  email: 'customer@gmail.com',
  eventName: 'order_delivered',
  recentEvents: [acceptedEvent(45 * 24, 'order_delivered')],
  nowMs: now,
}), { allowed: false, reason: 'review_request_cooldown' });

assert.deepEqual(marketingCadenceDecision({
  email: 'customer@gmail.com',
  eventName: 'cart_abandoned',
  recentEvents: [acceptedEvent(6 * 24, 'cart_abandoned')],
  nowMs: now,
}), { allowed: false, reason: 'abandoned_cart_cooldown' });

assert.deepEqual(marketingCadenceDecision({
  email: 'customer@gmail.com',
  eventName: 'reorder_due',
  recentEvents: [acceptedEvent(8 * 24)],
  recentTransactionalMessages: [transactionalMessage(48)],
  nowMs: now,
}), { allowed: true, reason: 'eligible_within_cadence' });

assert.deepEqual(marketingCadenceDecision({
  email: 'info@nuvirajuice.com',
  eventName: 'order_delivered',
  recentEvents: [acceptedEvent(1, 'order_delivered')],
  nowMs: now,
  allowInternalProof: true,
}), { allowed: true, reason: 'internal_proof_authorized' });

assert.equal(DEFAULT_MARKETING_CADENCE_RULES.delivery_followup_delay_hours, 48);
assert.equal(DEFAULT_MARKETING_CADENCE_RULES.recipient_cooldown_hours, 72);
assert.equal(DEFAULT_MARKETING_CADENCE_RULES.recipient_weekly_cap, 2);

const journey = read('base44/functions/customerJourneyAutomation/customerJourneyAutomation.ts');
const marketingLaunch = read('base44/functions/customerJourneyAutomation/marketingLaunch.ts');
const orderConfirmation = read('base44/functions/sendOrderReceivedNotification/entry.ts');
const orderStatus = read('base44/functions/sendOrderStatusNotification/entry.ts');
const elevatedStatus = read('base44/functions/sendOrderStatusNotification/elevatedTransactionalCommunications.ts');
const zone3Approval = read('base44/functions/getAdminOperationsDashboardSummary/handlers/approveZone3DeliveryRequest/entry.ts');
const zone3Denial = read('base44/functions/getAdminOperationsDashboardSummary/handlers/denyZone3DeliveryRequest/entry.ts');
const compliance = read('base44/functions/getAdminOperationsDashboardSummary/handlers/monitorPostPaymentChain/entry.ts');
const operations = read('base44/functions/getAdminOperationsDashboardSummary/handlers/notifyOrderProcessed/entry.ts');

assert.match(journey, /marketingCadenceDecision/);
assert.match(journey, /recentTransactionalMessages/);
assert.match(journey, /delivery_followup_delay_hours/);
assert.match(journey, /deferred_to_scheduled_evaluator/);
assert.match(journey, /testOrder\(order\)/);
assert.match(journey, /transactional_order_confirmation_authoritative|purchase_completion_email_suppressed/);
assert.match(marketingLaunch, /NuVira Juice Co <hello@nuvirajuice\.com>/);
assert.match(marketingLaunch, /MARKETING_REPLY_TO/);

for (const source of [orderConfirmation, orderStatus, elevatedStatus, zone3Approval, zone3Denial]) {
  assert.match(source, /NuVira Juice Co <orders@nuvirajuice\.com>/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /support@nuvirajuice\.com/);
}

for (const source of [orderStatus, zone3Approval, zone3Denial, compliance]) {
  assert.doesNotMatch(source, /integrations\.Core\.SendEmail/);
  assert.match(source, /https:\/\/api\.resend\.com\/emails/);
}

assert.match(operations, /internal_order_processed_/);
assert.match(operations, /Idempotency-Key/);
assert.match(operations, /NuVira Juice Co <system@nuvirajuice\.com>/);
assert.match(compliance, /internal:compliance_review:/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g111-unified-email-communications',
  provider: 'resend',
  transactional_from: 'orders@nuvirajuice.com',
  marketing_from: 'hello@nuvirajuice.com',
  unified_reply_to: 'support@nuvirajuice.com',
  customer_provider_calls_performed: false,
  production_writes_performed: false,
}, null, 2));
