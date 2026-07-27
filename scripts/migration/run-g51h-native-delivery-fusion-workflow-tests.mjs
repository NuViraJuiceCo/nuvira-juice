#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const commandPath = 'base44/functions/executeNativeFulfillmentTaskLifecycle/entry.ts';
const previewPath = 'base44/functions/previewNativeFulfillmentTaskLifecycle/entry.ts';
const deliveryPagePath = 'src/pages/admin/DeliveryQueue.jsx';
const commandSource = fs.readFileSync(commandPath, 'utf8');
const previewSource = fs.readFileSync(previewPath, 'utf8');
const deliveryPageSource = fs.readFileSync(deliveryPagePath, 'utf8');

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function sourceSegment(source, startToken, endToken) {
  const start = source.indexOf(startToken);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(start >= 0, `${startToken} not found`);
  assert.ok(end > start, `${endToken} not found after ${startToken}`);
  return source.slice(start, end);
}

test('1. Native lifecycle accepts explicit proof/drop and customer projection flags', () => {
  const allowedSegment = sourceSegment(commandSource, 'const ALLOWED_BODY_KEYS', 'const FORBIDDEN_BODY_KEYS');
  for (const field of ['delivery_drop_location', 'delivery_notes', 'delivery_photo_url', 'notify_customer', 'update_customer_order_status']) {
    assert.match(allowedSegment, new RegExp(`'${field}'`));
  }
});

test('2. Proof/drop fields are not rejected as unsupported fields', () => {
  const forbiddenSegment = sourceSegment(commandSource, 'const FORBIDDEN_BODY_KEYS', 'function normalizeText');
  assert.doesNotMatch(forbiddenSegment, /'delivery_photo_url'/);
  assert.doesNotMatch(forbiddenSegment, /'delivery_drop_location'/);
  assert.doesNotMatch(forbiddenSegment, /'delivery_notes'/);
});

test('3. Delivered workflow stores proof/drop on FulfillmentTask', () => {
  assert.match(commandSource, /FulfillmentTask\.delivery_drop_location/);
  assert.match(commandSource, /FulfillmentTask\.delivery_notes/);
  assert.match(commandSource, /FulfillmentTask\.delivery_photo_url/);
  assert.match(commandSource, /delivered_by/);
});

test('4. Customer Order projection is explicit and bounded', () => {
  assert.match(commandSource, /boolFlag\(body\.update_customer_order_status\)/);
  assert.match(commandSource, /projectCustomerOrderStatus/);
  assert.match(commandSource, /base44\.asServiceRole\.entities\.Order\.update\(order\.id, patch\)/);
  assert.match(commandSource, /customer_order_terminal_status_not_overwritten/);
});

test('5. Customer notification is explicit and uses the existing idempotent status function', () => {
  assert.match(commandSource, /boolFlag\(body\.notify_customer\)/);
  assert.match(commandSource, /sendCustomerStatusNotification/);
  assert.match(commandSource, /sendOrderStatusNotification/);
  assert.match(commandSource, /customer_order_already_projected/);
});

test('6. Native delivery fusion does not write Shopify, production, inventory, providers, or email directly', () => {
  assert.doesNotMatch(commandSource, /entities\.ShopifyOrder\.update|entities\.ProductionBatch\.update|entities\.InventoryItem\.update|entities\.PurchaseOrder\.update/);
  assert.doesNotMatch(commandSource, /fetch\s*\(|Stripe\.|new Shopify|shopifyApi|shopify\.graphql|integrations\.Core\.SendEmail/);
});

test('7. Delivery Queue exposes Hub-like native controls before diagnostics', () => {
  assert.match(deliveryPageSource, /function NativeDeliveryActionControls/);
  assert.match(deliveryPageSource, /NativeDeliveryActionControls stop=\{stop\}/);
  assert.match(deliveryPageSource, /NativeFulfillmentPreviewPanel stop=\{stop\}/);
  assert.ok(deliveryPageSource.indexOf('NativeDeliveryActionControls stop={stop}') < deliveryPageSource.indexOf('NativeFulfillmentPreviewPanel stop={stop}'));
});

test('8. Native UI opts into customer projection and notification only for delivery milestones', () => {
  assert.match(deliveryPageSource, /payload\.update_customer_order_status = true/);
  assert.match(deliveryPageSource, /payload\.notify_customer = true/);
  assert.match(deliveryPageSource, /action === 'out_for_delivery' \|\| action === 'delivered_operational'/);
});

test('9. Native delivered modal captures drop location and proof photo upload', () => {
  assert.match(deliveryPageSource, /native-drop-location/);
  assert.match(deliveryPageSource, /Take or Upload Photo/);
  assert.match(deliveryPageSource, /delivery_photo_url: trimDriverLabel/);
  assert.match(deliveryPageSource, /delivery_notes: notes/);
  assert.match(deliveryPageSource, /delivery_drop_location: selectedDropLocation/);
});

test('10. Date-pending native delivery tools prefill route date and prior production date', () => {
  assert.match(deliveryPageSource, /useState\(stop\.delivery_date \|\| selectedDate \|\| ''\)/);
  assert.match(deliveryPageSource, /useState\(stop\.production_date \|\| \(selectedDate \? shiftDate\(selectedDate, -1\) : ''\)\)/);
  assert.match(deliveryPageSource, /Route filter is \{formatDate\(selectedDate\)\} and is prefilled for review/);
});

test('11. Native delivery preview supports the same proof/drop fields as execution', () => {
  assert.match(previewSource, /delivery_drop_location/);
  assert.match(previewSource, /delivery_notes/);
  assert.match(previewSource, /delivery_photo_url/);
  assert.doesNotMatch(previewSource, /proof_drop_not_supported_in_native_preview/);
  assert.match(previewSource, /FulfillmentTask\.delivery_drop_location/);
  assert.match(previewSource, /FulfillmentTask\.delivery_notes/);
  assert.match(previewSource, /FulfillmentTask\.delivery_photo_url/);
});

for (const item of tests) {
  item.fn();
}

console.log(JSON.stringify({
  success: true,
  suite: 'g51h-native-delivery-fusion-workflow',
  cases: tests.length,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
