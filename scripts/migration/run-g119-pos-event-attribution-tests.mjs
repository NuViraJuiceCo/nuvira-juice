import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeShopifyLocationId,
  posEventAttributionNeedsReview,
  resolvePosEventAttribution,
} from '../../base44/functions/shopifyWebhookReceiver/posEventAttribution.js';

const LOCATION_GID = 'gid://shopify/Location/86197370970';
const EVENT_KEY = 's2-st-peters-customer-appreciation-bbq-2026-08-22';
const event = {
  id: 'event_s2_20260822',
  hub_event_id: EVENT_KEY,
  title: 'Supplement Superstores St. Peters Customer Appreciation BBQ',
  date: '2026-08-22',
  location: 'Supplement Superstores — St. Peters, 181 Mid Rivers Mall Dr., St. Peters, MO 63376',
  shopify_pos_location_id: LOCATION_GID,
  shopify_pos_location_name: 'S2 Customer Appreciation BBQ - Aug 22',
};

function fakeBase44(events = [event], options = {}) {
  const queries = [];
  return {
    queries,
    asServiceRole: {
      entities: {
        Event: {
          filter: async (query) => {
            queries.push(query);
            if (options.failLookup) throw new Error('synthetic_event_lookup_failure');
            return events.filter((row) => row.shopify_pos_location_id === query.shopify_pos_location_id);
          },
        },
      },
    },
  };
}

function posOrder(overrides = {}) {
  return {
    id: 1001,
    order_number: 1001,
    source_name: 'pos',
    location_id: '86197370970',
    device_id: 'device-42',
    user_id: 'staff-7',
    created_at: '2026-08-22T16:30:00.000Z',
    note_attributes: [],
    ...overrides,
  };
}

assert.deepEqual(normalizeShopifyLocationId('86197370970'), {
  gid: LOCATION_GID,
  numeric: '86197370970',
});
assert.deepEqual(normalizeShopifyLocationId(LOCATION_GID), {
  gid: LOCATION_GID,
  numeric: '86197370970',
});
assert.equal(normalizeShopifyLocationId('not-a-location'), null);

const nonPosState = fakeBase44();
assert.deepEqual(await resolvePosEventAttribution(nonPosState, posOrder({ source_name: 'web' })), {});
assert.equal(nonPosState.queries.length, 0);

const matchedState = fakeBase44();
const matched = await resolvePosEventAttribution(matchedState, posOrder());
assert.equal(matched.event_attribution_status, 'matched');
assert.equal(matched.shopify_pos_location_id, LOCATION_GID);
assert.equal(matched.shopify_pos_location_name, 'S2 Customer Appreciation BBQ - Aug 22');
assert.equal(matched.event_id, event.id);
assert.equal(matched.event_key, EVENT_KEY);
assert.equal(matched.event_name, event.title);
assert.equal(matched.event_date, event.date);
assert.equal(matched.event_location, event.location);
assert.equal(matched.shopify_pos_device_id, 'device-42');
assert.equal(matched.shopify_pos_staff_id, 'staff-7');
assert.equal(matchedState.queries.length, 2);
assert.equal(posEventAttributionNeedsReview({ source_channel: 'pos', ...matched }), false);

const replay = await resolvePosEventAttribution(fakeBase44(), posOrder());
assert.deepEqual(replay, matched, 'Webhook replay must produce identical attribution fields');

const missing = await resolvePosEventAttribution(fakeBase44(), posOrder({
  location_id: null,
  note_attributes: [{ name: 'event_location', value: 'Unverified staff-entered event note' }],
}));
assert.equal(missing.event_attribution_status, 'missing_location');
assert.equal(missing.event_name, '');
assert.equal(missing.event_location, '');
assert.match(missing.event_attribution_reason, /legacy note location was present but was not trusted/);
assert.equal(posEventAttributionNeedsReview({ source_channel: 'pos', ...missing }), true);

const unmatched = await resolvePosEventAttribution(fakeBase44([]), posOrder());
assert.equal(unmatched.event_attribution_status, 'unmatched_location');
assert.equal(unmatched.shopify_pos_location_id, LOCATION_GID);
assert.equal(unmatched.sync_status, 'native_pos_attribution_review');

const ambiguous = await resolvePosEventAttribution(fakeBase44([
  event,
  { ...event, id: 'duplicate_event', hub_event_id: 'duplicate-key' },
]), posOrder());
assert.equal(ambiguous.event_attribution_status, 'ambiguous_location');

const lookupFailed = await resolvePosEventAttribution(fakeBase44([], { failLookup: true }), posOrder());
assert.equal(lookupFailed.event_attribution_status, 'lookup_failed');
assert.match(lookupFailed.event_attribution_reason, /failed safely/);

const receiver = readFileSync('base44/functions/shopifyWebhookReceiver/entry.ts', 'utf8');
const journey = readFileSync('base44/functions/customerJourneyAutomation/customerJourneyAutomation.ts', 'utf8');
const orderEntity = readFileSync('base44/entities/ShopifyOrder.jsonc', 'utf8');
const alertEntity = readFileSync('base44/entities/OperationalAlert.jsonc', 'utf8');

assert.match(receiver, /await mapIncomingShopifyOrder\(base44, payload\)/);
assert.match(receiver, /resolvePosEventAttribution/);
assert.match(receiver, /reconcilePosEventAttributionAlert/);
assert.match(receiver, /pos_event_attribution/);
assert.match(journey, /event_welcome_pos_location_required/);
assert.match(journey, /event_attribution_status === 'matched'/);
assert.match(journey, /orderLocation\?\.gid === config\.shopify_pos_location_id/);
assert.match(orderEntity, /"shopify_pos_location_id"/);
assert.match(orderEntity, /"event_attribution_status"/);
assert.match(alertEntity, /"pos_event_attribution"/);

console.log('G119 POS event attribution tests passed');
