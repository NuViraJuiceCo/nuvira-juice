import assert from 'node:assert/strict';
import fs from 'node:fs';

const sources = [
  'base44/functions/processManualRefund/entry.ts',
  'base44/functions/getAdminOperationsDashboardSummary/handlers/processManualRefund/entry.ts',
];

for (const file of sources) {
  const source = fs.readFileSync(file, 'utf8');
  assert.match(source, /preview_full_order_refund/);
  assert.match(source, /execute_full_order_refund/);
  assert.match(source, /expected_order_id/);
  assert.match(source, /exact_order_identity_mismatch/);
  assert.match(source, /refund_exact_paid_order/);
  assert.match(source, /provider_calls_performed:\s*false/);
  assert.match(source, /writes_performed:\s*false/);
  assert.match(source, /idempotencyKey:\s*`exact-full-order-refund:/);
  assert.match(source, /providerRefundResult\.status !== 'succeeded'/);
  assert.match(source, /!providerRefundResult && Deno\.env\.get\('ENABLE_ADMIN_MANUAL_REFUNDS'\)/);
  assert.match(source, /LoyaltyTransaction\.reversal/);
  assert.match(source, /Hub\.refund_projection/);
  assert.match(source, /refund_status:\s*isFull \? 'fully_refunded' : 'partially_refunded'/);
  assert.match(source, /stripe_refund_id:\s*stripe_refund_id \|\| null/);
  assert.match(source, /functions\.invoke\('sendOrderStatusNotification'/);
  assert.match(source, /event_id:\s*refundReference/);
  assert.match(source, /customer_communication:\s*customerCommunication/);
  assert.doesNotMatch(source, /\brefund_id:\s*stripe_refund_id/);
  assert.doesNotMatch(source, /\bis_partial_refund:/);
}

const refundBridge = fs.readFileSync('base44/functions/syncRefundToHub/entry.ts', 'utf8');
assert.match(refundBridge, /order\.stripe_refund_id \|\| order\.refund_event_id/);
assert.match(refundBridge, /order\.refund_type === 'full'/);
assert.match(refundBridge, /reference_present=/);

const orderBridge = fs.readFileSync('base44/functions/syncOrderToHub/entry.ts', 'utf8');
assert.match(orderBridge, /const refundReference = eventType === 'order\.refunded'/);
assert.match(orderBridge, /refund_id:\s*refundReference/);
assert.match(orderBridge, /stripe_refund_id:\s*order\.stripe_refund_id \|\| refundReference/);
assert.match(orderBridge, /is_partial_refund:\s*eventType === 'order\.refunded' \? !isFullRefund : false/);
assert.doesNotMatch(orderBridge, /stripe_charge_id:\s*order\.stripe_charge_id \|\| order\.refund_id/);

const communications = fs.readFileSync(
  'base44/functions/sendOrderStatusNotification/elevatedTransactionalCommunications.ts',
  'utf8',
);
assert.match(communications, /if \(event === 'refunded'\)/);
assert.match(communications, /order\.stripe_refund_id \|\| order\.refund_event_id \|\| order\.refunded_at/);
assert.match(communications, /closeScheduledPushesForTerminalOrder/);
assert.match(communications, /superseded_by_\$\{event\}/);
assert.match(communications, /cancellation_reason: 'order_no_longer_eligible'/);

console.log('G80 exact full-order refund tests passed.');
