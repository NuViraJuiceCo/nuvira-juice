#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repoRoot = process.cwd();
const helperPath = path.join(repoRoot, 'base44/functions/shopifyWebhookReceiver/eventPosInventoryAlerts.js');
const entryPath = path.join(repoRoot, 'base44/functions/shopifyWebhookReceiver/entry.ts');
const helper = await import(`${pathToFileURL(helperPath).href}?g166=${Date.now()}`);
const entrySource = fs.readFileSync(entryPath, 'utf8');

const {
  eventInventoryAlertCopy,
  eventInventoryMonitorEligibility,
  eventInventoryThreshold,
  monitorEventPosInventorySale,
} = helper;

let assertions = 0;
function check(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  assertions += 1;
}
function match(value, pattern, message) {
  assert.match(value, pattern, message);
  assertions += 1;
}

check(eventInventoryThreshold(4), null, 'More than three units is not a low-stock threshold');
check(eventInventoryThreshold(3)?.key, 'low_stock', 'Three units enters low-stock');
check(eventInventoryThreshold(2)?.key, 'low_stock', 'Crossing below three remains the deduplicated low-stock state');
check(eventInventoryThreshold(1)?.key, 'last_unit', 'One unit enters last-unit state');
check(eventInventoryThreshold(0)?.key, 'sold_out', 'Zero units enters sold-out state');
check(eventInventoryThreshold(-2)?.key, 'sold_out', 'Oversold inventory is reported as sold out, not a negative customer-facing count');

const soldOutCopy = eventInventoryAlertCopy({
  eventName: 'Freedom Fitness St. Peters Event',
  locationName: 'Freedom Fitness St. Peters - Aug 30',
  productTitle: 'OASIS',
  availableQuantity: -1,
});
check(soldOutCopy.title, 'Sold Out: OASIS', 'Sold-out title names the item');
match(soldOutCopy.message, /has sold out of OASIS/, 'Sold-out copy never exposes a negative quantity');

const event = {
  id: 'event-freedom-20260830',
  title: 'Freedom Fitness St. Peters Event',
  date: '2026-08-30',
  is_active: true,
  shopify_pos_inventory_sync_enabled: true,
  shopify_pos_location_id: 'gid://shopify/Location/86312878170',
  shopify_pos_location_name: 'Freedom Fitness St. Peters - Aug 30',
};
const record = {
  id: 'shopify-order-row-1',
  is_pos_order: true,
  payment_status: 'paid',
  financial_status: 'paid',
  shopify_order_id: '987654321',
  event_id: event.id,
  event_attribution_status: 'matched',
  shopify_pos_location_id: event.shopify_pos_location_id,
  shopify_order_number: '1234',
};
check(
  eventInventoryMonitorEligibility(record, event, new Date('2026-08-30T18:00:00Z')),
  { eligible: true, reason: 'eligible' },
  'Paid, matched, same-day POS event sale is eligible',
);
check(
  eventInventoryMonitorEligibility({ ...record, payment_status: 'pending', financial_status: 'pending' }, event, new Date('2026-08-30T18:00:00Z')).reason,
  'order_not_paid',
  'Unpaid POS orders cannot trigger inventory alerts',
);
check(
  eventInventoryMonitorEligibility(record, { ...event, shopify_pos_inventory_sync_enabled: false }, new Date('2026-08-30T18:00:00Z')).reason,
  'event_inventory_sync_disabled',
  'Only explicitly enabled event stock is monitored',
);

function createMockBase44() {
  const state = {
    Event: [{ ...event }],
    User: [
      { id: 'admin-1', email: 'operations@nuvirajuice.com', role: 'admin' },
      { id: 'owner-1', email: 'info@nuvirajuice.com', role: 'owner' },
    ],
    OperationalAlert: [],
    Notification: [],
    pushes: [],
    creates: { OperationalAlert: 0, Notification: 0 },
  };
  let nextId = 1;
  const entity = (name) => ({
    async filter(query) {
      return state[name].filter((row) => Object.entries(query || {}).every(([key, value]) => row[key] === value));
    },
    async create(payload) {
      const row = { id: `${name}-${nextId++}`, ...payload };
      state[name].push(row);
      if (name in state.creates) state.creates[name] += 1;
      return row;
    },
    async update(id, patch) {
      const index = state[name].findIndex((row) => row.id === id);
      assert.notEqual(index, -1, `${name} update target must exist`);
      state[name][index] = { ...state[name][index], ...patch };
      return state[name][index];
    },
  });
  const entities = new Proxy({}, { get: (_target, name) => entity(name) });
  return {
    state,
    base44: {
      asServiceRole: {
        entities,
        functions: {
          async invoke(name, payload) {
            assert.equal(name, 'sendCustomerPushNotification');
            state.pushes.push(payload);
            return { data: { push_attempted: true, push_sent: true, sent_count: 1 } };
          },
        },
      },
    },
  };
}

const { state, base44 } = createMockBase44();
let availableQuantity = 3;
let providerReads = 0;
const readInventoryLevels = async ({ variantIds, locationId }) => {
  providerReads += 1;
  check(variantIds, ['45330821120090'], 'Webhook variant ids are deduplicated before the provider read');
  check(locationId, event.shopify_pos_location_id, 'Inventory is read at the attributed event location only');
  return [{
    variantId: 'gid://shopify/ProductVariant/45330821120090',
    inventoryItemId: 'gid://shopify/InventoryItem/45330821120090',
    productTitle: 'OASIS',
    availableQuantity,
  }];
};
const orderPayload = {
  line_items: [
    { variant_id: '45330821120090', title: 'OASIS', quantity: 1 },
    { variant_id: '45330821120090', title: 'OASIS', quantity: 1 },
  ],
};

const first = await monitorEventPosInventorySale({
  base44,
  record,
  orderPayload,
  readInventoryLevels,
  configuredAdminRecipients: 'info@nuvirajuice.com',
  pushEnabled: true,
  now: new Date('2026-08-30T18:00:00Z'),
});
check(first.monitored, true, 'Eligible sale is monitored');
check(first.results[0].threshold, 'low_stock', 'Three remaining creates the low-stock state');
check(state.creates.OperationalAlert, 1, 'One active operations alert is created for the event item');
check(state.OperationalAlert[0].shopify_order_id, record.shopify_order_id, 'Operations notice keeps the real triggering Shopify order link');
check(state.creates.Notification, 2, 'Configured recipients and current admin roles are safely unioned without duplicates');
check(state.pushes.length, 2, 'Each unique operations recipient receives one push attempt');
check(state.Notification.every((row) => row.deep_link === '/admin/shopify'), true, 'Stock alerts open the Shopify inventory surface');
check(state.Notification.every((row) => !/[\w.+-]+@[\w.-]+/.test(row.message)), true, 'Alert copy contains no customer PII');

await monitorEventPosInventorySale({
  base44,
  record,
  orderPayload,
  readInventoryLevels,
  pushEnabled: true,
  now: new Date('2026-08-30T18:00:00Z'),
});
check(state.creates.OperationalAlert, 1, 'Webhook retry updates rather than duplicates the operations alert');
check(state.creates.Notification, 2, 'Webhook retry does not duplicate in-app notifications');
check(state.pushes.length, 2, 'Webhook retry does not duplicate push notifications');

availableQuantity = 1;
await monitorEventPosInventorySale({
  base44,
  record: { ...record, id: 'shopify-order-row-2', shopify_order_number: '1235' },
  orderPayload,
  readInventoryLevels,
  pushEnabled: true,
  now: new Date('2026-08-30T18:30:00Z'),
});
check(state.creates.OperationalAlert, 1, 'Last-unit state reuses the single active operations alert');
check(state.OperationalAlert[0].title, 'Last OASIS', 'Operations alert advances to last-unit copy');
check(state.creates.Notification, 4, 'Last-unit threshold creates one new notification per recipient');
check(state.pushes.length, 4, 'Last-unit threshold creates one new push per recipient');

availableQuantity = 0;
await monitorEventPosInventorySale({
  base44,
  record: { ...record, id: 'shopify-order-row-3', shopify_order_number: '1236' },
  orderPayload,
  readInventoryLevels,
  pushEnabled: true,
  now: new Date('2026-08-30T19:00:00Z'),
});
check(state.OperationalAlert[0].title, 'Sold Out: OASIS', 'Operations alert advances to sold-out copy');
check(state.creates.Notification, 6, 'Sold-out threshold creates one new notification per recipient');
check(state.pushes.length, 6, 'Sold-out threshold creates one new push per recipient');

availableQuantity = 5;
await monitorEventPosInventorySale({
  base44,
  record: { ...record, id: 'shopify-order-row-4', shopify_order_number: '1237' },
  orderPayload,
  readInventoryLevels,
  pushEnabled: true,
  now: new Date('2026-08-30T19:30:00Z'),
});
check(state.OperationalAlert[0].resolved, true, 'A restocked item automatically clears the active operations notice');
check(state.creates.Notification, 6, 'Healthy inventory does not send a notification');

const readsBeforeSkip = providerReads;
const skipped = await monitorEventPosInventorySale({
  base44,
  record: { ...record, payment_status: 'pending', financial_status: 'pending' },
  orderPayload,
  readInventoryLevels,
  pushEnabled: true,
  now: new Date('2026-08-30T19:30:00Z'),
});
check(skipped.reason, 'order_not_paid', 'Unpaid sale is safely skipped');
check(providerReads, readsBeforeSkip, 'Unpaid sale performs no Shopify inventory read');

match(entrySource, /2026-08-30\.g166-event-pos-stock-alerts/, 'Root webhook entrypoint has an explicit release revision marker');
match(entrySource, /query EventPosInventoryMonitor/, 'Existing Shopify webhook performs the read-only inventory query');
match(entrySource, /quantities\(names: \["available"\]\)/, 'Monitor reads authoritative available inventory');
match(entrySource, /await maybeMonitorEventPosInventory\(base44, record, payload\)/, 'Paid create/paid path invokes the monitor');
match(entrySource, /if \(inventoryMonitorRecord\) await maybeMonitorEventPosInventory/, 'Updated-order path invokes the same idempotent monitor');
check(/inventoryAdjust|inventorySetQuantities|inventoryActivate/.test(entrySource), false, 'Webhook stock monitor cannot mutate Shopify inventory');

console.log(`G166 event POS stock alert tests passed (${assertions} assertions).`);
