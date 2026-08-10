import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const standalone = read('base44/functions/getCustomerOrderDetail/entry.ts');
const gateway = read('base44/functions/getCustomerAccountDashboardData/handlers/getCustomerOrderDetail/entry.ts');
const dashboard = read('base44/functions/getCustomerAccountDashboardData/handlers/getCustomerAccountDashboardData/entry.ts');
const tracker = read('src/pages/OrderTracker.jsx');
const history = read('src/pages/OrderHistory.jsx');

const tests = [
  ['standalone customer detail resolves fulfillment tasks by linked IDs and order numbers', () => {
    for (const marker of [
      "resolvedOrderId ? { order_id: resolvedOrderId } : { order_id: 'NONE_USE_NUMBER' }",
      'taskQueries.push({ base44_order_id: resolvedOrderId })',
      'taskQueries.push({ order_number: taskOrderNumber })',
      'taskQueries.push({ shopify_order_number: taskOrderNumber })',
    ]) assert.ok(standalone.includes(marker), marker);
  }],
  ['gateway customer detail keeps the same delivery-proof fallback', () => {
    for (const source of [standalone, gateway]) {
      assert.match(source, /const deliveryProofTask = deliveryProofTasks\.find/);
      assert.match(source, /deliveryProofTask\?\.delivery_photo_url/);
      assert.match(source, /deliveryProofTask\?\.delivery_drop_location/);
      assert.match(source, /deliveryProofTask\?\.delivered_at/);
    }
  }],
  ['expanded proof lookup does not change the established fulfillment-task response', () => {
    for (const source of [standalone, gateway]) {
      assert.match(source, /let deliveryProofTasks = \[\]/);
      assert.match(source, /if \(!primaryTaskHasProof\)/);
      assert.match(source, /deliveryProofTasks = uniqueRows\(\[\.\.\.fulfillmentTasks/);
      assert.match(source, /fulfillment_tasks: fulfillmentTasks/);
    }
  }],
  ['customer tracker shows an expanded delivery confirmation', () => {
    assert.match(tracker, /Delivery confirmation/);
    assert.match(tracker, /alt="Delivery proof"/);
    assert.match(tracker, /deliveryStatus\?\.delivery_drop_location/);
  }],
  ['completed-order history surfaces delivery proof before opening details', () => {
    assert.match(history, /order\.status === 'delivered'/);
    assert.match(history, /Delivery proof/);
    assert.match(history, /Left at \$\{order\.delivery_drop_location\}/);
  }],
  ['order history recovers proof from customer-owned fulfillment tasks', () => {
    for (const marker of [
      'applyOwnedDeliveryProofToOrderHistory',
      "{ customer_email: customerEmail }",
      "normalizeLower(order?.status) !== 'delivered'",
      'task?.base44_order_id',
      'task?.order_id',
      'task?.shopify_order_number',
      'proofTask?.delivery_photo_url',
      'proofTask?.delivery_drop_location',
    ]) assert.ok(dashboard.includes(marker), marker);
    assert.match(dashboard, /filter\(task => !task\?\.is_test_task\)/);
    assert.doesNotMatch(dashboard, /proofTask\?\.delivery_notes/);
  }],
  ['authoritative order history preserves safe delivery-proof fields', () => {
    const sanitizer = dashboard.slice(
      dashboard.indexOf('function sanitizeAuthoritativeHistoryOrder'),
      dashboard.indexOf('async function loadOwnedAuthoritativeOrders'),
    );
    assert.match(sanitizer, /delivery_photo_url: normalizeText\(order\?\.delivery_photo_url\)/);
    assert.match(sanitizer, /delivery_drop_location: normalizeText\(order\?\.delivery_drop_location\)/);
    assert.doesNotMatch(sanitizer, /delivery_notes/);
  }],
  ['customer surfaces never expose driver notes or internal proof metadata', () => {
    for (const source of [tracker, history]) {
      assert.doesNotMatch(source, /delivery_notes/);
      assert.doesNotMatch(source, /internal_note/);
    }
  }],
];

let passed = 0;
for (const [name, test] of tests) {
  try {
    test();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`G102 customer delivery proof: ${passed}/${tests.length} passed`);
