#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = relativePath => fs.readFileSync(`${root}/${relativePath}`, 'utf8');
const journeyModule = await import(pathToFileURL(`${root}/src/lib/customer-order-journey.js`));
const {
  buildCustomerJourneyTimeline,
  getCustomerOrderJourney,
  normalizeCustomerOrderStatus,
  resolveCustomerJourneyFulfillmentType,
} = journeyModule;

const deliveryCases = [
  ['order_received', 0, 'Order Confirmed'],
  ['scheduled_for_juicing', 1, 'Fresh Batch Scheduled'],
  ['scheduled_for_production', 1, 'Fresh Batch Scheduled'],
  ['in_production', 2, 'Being Freshly Made'],
  ['bottled_packed', 3, 'Bottled & Packed'],
  ['out_for_delivery', 4, 'Out for Delivery'],
  ['arriving_soon', 4, 'Arriving Soon'],
  ['delivered', 5, 'Delivered'],
];

for (const [status, expectedIndex, expectedLabel] of deliveryCases) {
  const journey = getCustomerOrderJourney({ status, fulfillmentType: 'delivery' });
  assert.equal(journey.currentIndex, expectedIndex, `${status} must resolve to the correct delivery milestone`);
  assert.equal(journey.statusLabel, expectedLabel, `${status} must have customer-ready language`);
  assert.equal(journey.stages.filter(stage => stage.state === 'current').length, 1, `${status} must have exactly one current milestone`);
}

assert.equal(normalizeCustomerOrderStatus('scheduled-for-production'), 'scheduled_for_juicing');
assert.equal(normalizeCustomerOrderStatus('assigned for delivery'), 'out_for_delivery');
assert.equal(normalizeCustomerOrderStatus('canceled'), 'cancelled');

const readyForPickup = getCustomerOrderJourney({ status: 'ready_for_pickup', fulfillmentType: 'pickup' });
assert.equal(readyForPickup.currentIndex, 4);
assert.equal(readyForPickup.statusLabel, 'Order Ready');
assert.equal(getCustomerOrderJourney({ status: 'picked_up', fulfillmentType: 'pickup' }).currentIndex, 5);
assert.equal(getCustomerOrderJourney({ status: 'picked_up', fulfillmentType: 'pickup' }).statusLabel, 'Order Complete');
assert.equal(resolveCustomerJourneyFulfillmentType({
  orderFulfillmentType: 'delivery',
  hubFulfillmentMethod: 'pickup',
  status: 'picked_up',
}), 'delivery', 'authoritative Customer App delivery must beat stale Hub pickup metadata');
assert.equal(resolveCustomerJourneyFulfillmentType({ orderFulfillmentType: 'pickup' }), 'pickup');
assert.equal(resolveCustomerJourneyFulfillmentType({ hubFulfillmentMethod: 'pos' }), 'pickup');
assert.equal(getCustomerOrderJourney({ status: 'picked_up', fulfillmentType: 'delivery' }).statusLabel, 'Delivered');
assert.equal(getCustomerOrderJourney({ status: 'ready_for_pickup', fulfillmentType: 'delivery' }).statusLabel, 'Bottled & Packed');
assert.equal(getCustomerOrderJourney({ status: 'refunded' }).isTerminal, true);
assert.equal(getCustomerOrderJourney({ status: 'unexpected_provider_status' }).isKnownStage, false);
assert.equal(getCustomerOrderJourney({ status: 'unexpected_provider_status' }).progressPercent, 0);

const timeline = buildCustomerJourneyTimeline([
  { status: 'order_received', timestamp: '2026-08-08T10:00:00Z' },
  { status: 'scheduled_for_production', timestamp: '2026-08-08T11:00:00Z' },
  { status: 'scheduled_for_juicing', timestamp: '2026-08-08T12:00:00Z', message: 'Batch confirmed' },
  { status: 'arriving_soon', timestamp: '2026-08-09T15:00:00Z' },
], 'delivery');
assert.equal(timeline.scheduled_for_juicing.timestamp, '2026-08-08T12:00:00Z');
assert.equal(timeline.scheduled_for_juicing.message, 'Batch confirmed');
assert.equal(timeline.out_for_delivery.status, 'arriving_soon');

const tracker = read('src/pages/OrderTracker.jsx');
assert.match(tracker, /deliveryStatus\?\.status\s*\|\|\s*order\?\.status/, 'authoritative delivery summary must lead tracker status selection');
assert.match(tracker, /query\.state\.data/, 'React Query v5 polling callback must read query state');
assert.match(tracker, /currentDetail\?\.found && !currentDetail\?\.is_terminal/, 'active orders must refresh automatically');
assert.match(tracker, /Freshness journey/);
assert.match(tracker, /Status history/);
assert.match(tracker, /Order details/);
assert.match(tracker, /Return \+ Reward/);
assert.match(tracker, /buildCustomerJourneyTimeline/);
assert.match(tracker, /resolveCustomerJourneyFulfillmentType/);
assert.doesNotMatch(tracker, /Pickup complete|Pickup status|Expected pickup/);
assert.doesNotMatch(tracker, /stages\.findIndex\(s => s\.key === displayOrder\.status\)/, 'raw status equality must not drive progress');

const history = read('src/pages/OrderHistory.jsx');
assert.match(history, /getCustomerOrderJourney/);
assert.match(history, /journey\.progressPercent/);
assert.match(history, /refetchInterval: query =>/);

console.log(JSON.stringify({
  success: true,
  suite: 'g100-customer-order-journey-tracker',
  cases: 48,
  production_writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
