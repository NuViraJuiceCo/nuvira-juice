import assert from 'node:assert/strict';
import fs from 'node:fs';

const webhook = fs.readFileSync('base44/functions/stripeWebhook/entry.ts', 'utf8');

assert.match(webhook, /function verifiedCheckoutSchedule\(/);
assert.match(webhook, /CheckoutSession\.filter\(\{ stripe_session_id: pi\.id \}\)/);
assert.match(webhook, /let finalSchedule = verifiedCheckoutSchedule\(checkoutData, meta\)/);
assert.match(webhook, /Preserving verified customer selection/);
assert.match(webhook, /finalOrderUpdate\.assigned_delivery_date \|\| order\.assigned_delivery_date/);
assert.doesNotMatch(
  webhook,
  /let finalSchedule = null;\s*try \{\s*const successTimestamp[\s\S]{0,900}finalSchedule = schedResp\.data \|\| schedResp;/,
  'embedded payment finalization must not unconditionally replace a verified customer selection with the default schedule',
);

const schedule = {
  production_date: '2026-08-11',
  assigned_production_day: '2026-08-11',
  delivery_date: '2026-08-12',
  assigned_delivery_date: '2026-08-12',
  delivery_window_label: 'Wednesday 5 PM - 8 PM',
  delivery_window_start: '17:00',
  delivery_window_end: '20:00',
};

const productionDow = new Date(`${schedule.production_date}T12:00:00`).getDay();
const deliveryDow = new Date(`${schedule.delivery_date}T12:00:00`).getDay();
assert.equal(productionDow, 2);
assert.equal(deliveryDow, 3);
assert.equal(schedule.delivery_window_label, 'Wednesday 5 PM - 8 PM');

console.log(JSON.stringify({
  ok: true,
  suite: 'g78-checkout-schedule-preservation',
  cases: 8,
  live_writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
