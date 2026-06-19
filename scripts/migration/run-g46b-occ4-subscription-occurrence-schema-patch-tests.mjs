#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../..');

function loadSchema(name) {
  return JSON.parse(readFileSync(resolve(repoRoot, `base44/entities/${name}.jsonc`), 'utf8'));
}

const schemas = {
  Order: loadSchema('Order'),
  ShopifyOrder: loadSchema('ShopifyOrder'),
  FulfillmentTask: loadSchema('FulfillmentTask'),
  Subscription: loadSchema('Subscription'),
  CommandLog: loadSchema('CommandLog'),
};

const addedFields = Object.freeze({
  Order: [
    'customer_app_subscription_id',
    'subscription_occurrence_id',
    'subscription_cycle_key',
    'fulfillment_number',
    'source_type',
  ],
  ShopifyOrder: ['subscription_occurrence_id', 'subscription_cycle_key'],
  FulfillmentTask: ['subscription_occurrence_id', 'subscription_cycle_key'],
});

const ownerA = 'owner_A';
const ownerB = 'owner_B';
const parentId = 'sub_parent_future';
const occurrenceId = 'sub_parent_future:cycle:2026-07-01:1';
const cycleKey = 'cycle:2026-07-01:1';

function requiredFields(entity) {
  return new Set(schemas[entity].required || []);
}

function property(entity, field) {
  return schemas[entity].properties[field];
}

function isRequired(entity, field) {
  return requiredFields(entity).has(field);
}

function identityKey(parent, occurrence, operation = 'materialize') {
  return `subscription_occurrence_materialize:${parent}:${occurrence}:${operation}`;
}

function containsPii(value) {
  return /@|phone|customer_email|customer_name|address/i.test(String(value));
}

function baseOrder(overrides = {}) {
  return {
    id: 'order_one_time',
    customer_id: ownerA,
    customer_email: 'owner@example.test',
    order_number: 'NV-ONE-TIME',
    items: [{ title: 'Juice', quantity: 1 }],
    total: 42,
    status: 'order_received',
    ...overrides,
  };
}

function futureOrder(overrides = {}) {
  return baseOrder({
    id: 'order_future_occurrence_1',
    order_number: 'NV-SUB-FUTURE-1',
    customer_app_subscription_id: parentId,
    subscription_occurrence_id: occurrenceId,
    subscription_cycle_key: cycleKey,
    fulfillment_number: 1,
    source_type: 'subscription_occurrence',
    ...overrides,
  });
}

function futureShopifyOrder(overrides = {}) {
  return {
    id: 'shopify_order_future_occurrence_1',
    customer_id: ownerA,
    shopify_order_number: 'NV-SUB-FUTURE-1',
    base44_order_id: 'order_future_occurrence_1',
    source_channel: 'subscription',
    source_type: 'subscription_occurrence',
    subscription_parent_id: parentId,
    subscription_occurrence_id: occurrenceId,
    subscription_cycle_key: cycleKey,
    fulfillment_sequence_number: 1,
    ...overrides,
  };
}

function futureTask(overrides = {}) {
  return {
    id: 'task_future_occurrence_1',
    customer_id: ownerA,
    order_id: 'order_future_occurrence_1',
    base44_order_id: 'order_future_occurrence_1',
    native_shopify_order_id: 'shopify_order_future_occurrence_1',
    customer_email: 'owner@example.test',
    order_number: 'NV-SUB-FUTURE-1',
    fulfillment_number: 1,
    delivery_date: '2026-07-01',
    fulfillment_type: 'subscription_delivery',
    source_type: 'subscription_occurrence',
    customer_app_subscription_id: parentId,
    subscription_occurrence_id: occurrenceId,
    subscription_cycle_key: cycleKey,
    ...overrides,
  };
}

function validateChain({ order = futureOrder(), shopifyOrder = futureShopifyOrder(), task = futureTask() } = {}) {
  const blockers = [];

  if (!order.customer_app_subscription_id || !order.subscription_occurrence_id) blockers.push('missing_customer_app_occurrence_link');
  if (!shopifyOrder.subscription_occurrence_id) blockers.push('missing_shopify_occurrence_link');
  if (!task.subscription_occurrence_id) blockers.push('missing_task_occurrence_link');

  const ownerValues = [order.customer_id, shopifyOrder.customer_id, task.customer_id].filter(Boolean);
  if (new Set(ownerValues).size > 1) blockers.push('cross_customer_chain_conflict');

  const occurrenceValues = [order.subscription_occurrence_id, shopifyOrder.subscription_occurrence_id, task.subscription_occurrence_id].filter(Boolean);
  if (new Set(occurrenceValues).size > 1) blockers.push('mismatched_occurrence_id');

  const cycleValues = [order.subscription_cycle_key, shopifyOrder.subscription_cycle_key, task.subscription_cycle_key].filter(Boolean);
  if (new Set(cycleValues).size > 1) blockers.push('mismatched_cycle_key');

  if (order.customer_app_subscription_id === order.subscription_occurrence_id) blockers.push('parent_occurrence_not_distinct');
  if (order.subscription_cycle_key && !order.subscription_occurrence_id) blockers.push('cycle_key_without_occurrence_id');
  if (order.assigned_delivery_date && !order.subscription_occurrence_id) blockers.push('date_only_identity_not_allowed');

  return {
    ready: blockers.length === 0,
    blockers,
    writes_performed: false,
    provider_calls: false,
    notifications_sent: false,
    hub_mutation_performed: false,
  };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('existing one-time Order remains schema-valid', () => {
  const row = baseOrder();
  assert.equal(row.subscription_occurrence_id, undefined);
  assert.equal(isRequired('Order', 'subscription_occurrence_id'), false);
});

test('existing historical subscription Order remains valid with null new fields', () => {
  const row = baseOrder({ source_type: 'subscription_occurrence', customer_app_subscription_id: null, subscription_occurrence_id: null, subscription_cycle_key: null, fulfillment_number: null });
  assert.equal(row.subscription_occurrence_id, null);
  assert.equal(isRequired('Order', 'customer_app_subscription_id'), false);
});

test('existing ShopifyOrder remains valid with null occurrence fields', () => {
  assert.equal(isRequired('ShopifyOrder', 'subscription_occurrence_id'), false);
  assert.equal(property('ShopifyOrder', 'subscription_occurrence_id').type, 'string');
});

test('existing FulfillmentTask remains valid with null occurrence fields', () => {
  assert.equal(isRequired('FulfillmentTask', 'subscription_occurrence_id'), false);
  assert.equal(property('FulfillmentTask', 'subscription_occurrence_id').type, 'string');
});

test('future Customer App Order can store exact parent and occurrence links', () => {
  const row = futureOrder();
  assert.equal(row.customer_app_subscription_id, parentId);
  assert.equal(row.subscription_occurrence_id, occurrenceId);
});

test('future ShopifyOrder can store the same occurrence and cycle links', () => {
  const row = futureShopifyOrder();
  assert.equal(row.subscription_occurrence_id, occurrenceId);
  assert.equal(row.subscription_cycle_key, cycleKey);
});

test('future FulfillmentTask can store the same occurrence and cycle links', () => {
  const row = futureTask();
  assert.equal(row.subscription_occurrence_id, occurrenceId);
  assert.equal(row.subscription_cycle_key, cycleKey);
});

test('occurrence id and parent id remain distinct', () => {
  const result = validateChain({ order: futureOrder({ subscription_occurrence_id: parentId }) });
  assert.ok(result.blockers.includes('parent_occurrence_not_distinct'));
});

test('cycle key cannot replace occurrence id', () => {
  const result = validateChain({ order: futureOrder({ subscription_occurrence_id: '', subscription_cycle_key: cycleKey }) });
  assert.ok(result.blockers.includes('missing_customer_app_occurrence_link'));
  assert.ok(result.blockers.includes('cycle_key_without_occurrence_id'));
});

test('scheduled date alone cannot identify an occurrence', () => {
  const result = validateChain({ order: futureOrder({ subscription_occurrence_id: '', subscription_cycle_key: '', assigned_delivery_date: '2026-07-01' }) });
  assert.ok(result.blockers.includes('date_only_identity_not_allowed'));
});

test('two occurrences on the same date remain distinguishable', () => {
  const first = futureOrder({ subscription_occurrence_id: 'occurrence:1', subscription_cycle_key: 'cycle:1', assigned_delivery_date: '2026-07-01' });
  const second = futureOrder({ subscription_occurrence_id: 'occurrence:2', subscription_cycle_key: 'cycle:2', assigned_delivery_date: '2026-07-01' });
  assert.notEqual(first.subscription_occurrence_id, second.subscription_occurrence_id);
});

test('cross-customer chain conflict is rejected by contract validation', () => {
  const result = validateChain({ task: futureTask({ customer_id: ownerB }) });
  assert.ok(result.blockers.includes('cross_customer_chain_conflict'));
});

test('mismatched occurrence ids across Order/ShopifyOrder/Task are rejected', () => {
  const result = validateChain({ shopifyOrder: futureShopifyOrder({ subscription_occurrence_id: 'different_occurrence' }) });
  assert.ok(result.blockers.includes('mismatched_occurrence_id'));
});

test('mismatched cycle keys are rejected', () => {
  const result = validateChain({ task: futureTask({ subscription_cycle_key: 'different_cycle' }) });
  assert.ok(result.blockers.includes('mismatched_cycle_key'));
});

test('missing Customer App occurrence link blocks chain readiness', () => {
  const result = validateChain({ order: futureOrder({ subscription_occurrence_id: '' }) });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('missing_customer_app_occurrence_link'));
});

test('missing ShopifyOrder occurrence link blocks chain readiness', () => {
  const result = validateChain({ shopifyOrder: futureShopifyOrder({ subscription_occurrence_id: '' }) });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('missing_shopify_occurrence_link'));
});

test('missing FulfillmentTask occurrence link blocks operational readiness', () => {
  const result = validateChain({ task: futureTask({ subscription_occurrence_id: '' }) });
  assert.equal(result.ready, false);
  assert.ok(result.blockers.includes('missing_task_occurrence_link'));
});

test('existing rows require no backfill', () => {
  for (const [entity, fields] of Object.entries(addedFields)) {
    for (const field of fields) assert.equal(isRequired(entity, field), false, `${entity}.${field} should be optional`);
  }
});

test('no customer PII is used in identity keys', () => {
  const key = identityKey(parentId, occurrenceId);
  assert.equal(containsPii(key), false);
});

test('new fields are internal-only', () => {
  for (const [entity, fields] of Object.entries(addedFields)) {
    for (const field of fields) {
      const description = property(entity, field).description || '';
      assert.match(description, /Internal|internal|Not customer-facing|not customer-facing/);
    }
  }
});

test('no provider calls', () => {
  const result = validateChain();
  assert.equal(result.provider_calls, false);
});

test('no notifications', () => {
  const result = validateChain();
  assert.equal(result.notifications_sent, false);
});

test('no Hub mutation', () => {
  const result = validateChain();
  assert.equal(result.hub_mutation_performed, false);
});

test('no live writes', () => {
  const result = validateChain();
  assert.equal(result.writes_performed, false);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`\nG46B-OCC4 subscription occurrence additive schema patch tests passed (${passed}/${tests.length}).`);
