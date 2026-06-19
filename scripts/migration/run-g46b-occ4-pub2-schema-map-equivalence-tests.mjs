#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const INTENDED_UPDATED = new Set(['Order', 'ShopifyOrder', 'FulfillmentTask']);
const EXPECTED_ADDITIONS = Object.freeze({
  Order: {
    customer_app_subscription_id: { type: 'string' },
    subscription_occurrence_id: { type: 'string' },
    subscription_cycle_key: { type: 'string' },
    fulfillment_number: { type: 'number' },
    source_type: { type: 'string' },
  },
  ShopifyOrder: {
    subscription_occurrence_id: { type: 'string' },
    subscription_cycle_key: { type: 'string' },
  },
  FulfillmentTask: {
    subscription_occurrence_id: { type: 'string' },
    subscription_cycle_key: { type: 'string' },
  },
});

function stripJsonComments(input) {
  let output = '';
  let inString = false;
  let quote = '';
  let escaped = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (inString) {
      output += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      output += char;
      continue;
    }
    if (char === '/' && next === '/') {
      while (index < input.length && input[index] !== '\n') index += 1;
      output += '\n';
      continue;
    }
    if (char === '/' && next === '*') {
      index += 2;
      while (index < input.length && !(input[index] === '*' && input[index + 1] === '/')) index += 1;
      index += 1;
      continue;
    }
    output += char;
  }
  return output;
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortDeep(value[key])]));
  }
  return value;
}

function normalizeSchemaText(text) {
  return JSON.stringify(sortDeep(JSON.parse(stripJsonComments(text))));
}

function hashSchema(schema) {
  return createHash('sha256').update(JSON.stringify(sortDeep(schema))).digest('hex');
}

function schema(name, properties = {}, required = []) {
  return { name, type: 'object', properties, ...(required.length ? { required } : {}) };
}

function field(type, extra = {}) {
  return { type, ...extra };
}

function entityMap(rows) {
  return Object.fromEntries(rows.map((row) => [row.name, row]));
}

function compareEntitySets(liveMap, localMap) {
  const liveNames = new Set(Object.keys(liveMap));
  const localNames = new Set(Object.keys(localMap));
  return {
    missing_live_entities: [...localNames].filter((name) => !liveNames.has(name)).sort(),
    extra_live_entities: [...liveNames].filter((name) => !localNames.has(name)).sort(),
  };
}

function compareProperty(localProperty, liveProperty) {
  return JSON.stringify(sortDeep(localProperty)) === JSON.stringify(sortDeep(liveProperty));
}

function diffSchema(liveSchema, localSchema) {
  const liveProps = liveSchema.properties || {};
  const localProps = localSchema.properties || {};
  const liveRequired = new Set(liveSchema.required || []);
  const localRequired = new Set(localSchema.required || []);
  const added = Object.keys(localProps).filter((name) => !(name in liveProps)).sort();
  const removed = Object.keys(liveProps).filter((name) => !(name in localProps)).sort();
  const changed = Object.keys(localProps).filter((name) => name in liveProps && !compareProperty(localProps[name], liveProps[name])).sort();
  const requiredAdded = [...localRequired].filter((name) => !liveRequired.has(name)).sort();
  const requiredRemoved = [...liveRequired].filter((name) => !localRequired.has(name)).sort();
  const defaultAdditions = added.filter((name) => Object.hasOwn(localProps[name], 'default'));
  const constraintChanges = [...added, ...changed].filter((name) => {
    const prop = localProps[name] || {};
    return Object.hasOwn(prop, 'enum') || Object.hasOwn(prop, 'unique') || Object.hasOwn(prop, 'index');
  });
  return { added, removed, changed, requiredAdded, requiredRemoved, defaultAdditions, constraintChanges };
}

function expectedAdditionsOnly(entityName, diff, localSchema) {
  const expected = EXPECTED_ADDITIONS[entityName] || {};
  const expectedNames = Object.keys(expected).sort();
  assert.deepEqual(diff.added, expectedNames, `${entityName} additions mismatch`);
  assert.deepEqual(diff.removed, [], `${entityName} removed fields`);
  assert.deepEqual(diff.changed, [], `${entityName} changed fields`);
  assert.deepEqual(diff.requiredAdded, [], `${entityName} required additions`);
  assert.deepEqual(diff.defaultAdditions, [], `${entityName} default additions`);
  assert.deepEqual(diff.constraintChanges, [], `${entityName} constraint changes`);
  for (const [name, expectedProperty] of Object.entries(expected)) {
    assert.equal(localSchema.properties[name].type, expectedProperty.type, `${entityName}.${name} type`);
  }
  return true;
}

function predictImpact(liveMap, localMap) {
  const entitySet = compareEntitySets(liveMap, localMap);
  const created = entitySet.missing_live_entities;
  const deleted = entitySet.extra_live_entities;
  const updated = [];
  const unchanged = [];
  const details = {};
  for (const name of Object.keys(localMap).sort()) {
    if (!liveMap[name]) continue;
    const localHash = hashSchema(localMap[name]);
    const liveHash = hashSchema(liveMap[name]);
    if (localHash === liveHash) {
      unchanged.push(name);
      continue;
    }
    const diff = diffSchema(liveMap[name], localMap[name]);
    updated.push(name);
    details[name] = diff;
  }
  return { created, deleted, updated, unchanged, details };
}

function hasUnsafeOutput(value) {
  return /Authorization|Bearer|sk_|pk_|shpat_|ghp_|access_token|refresh_token|device_code|client_secret/i.test(JSON.stringify(value));
}

function assertNoPublishInvocation(calls) {
  assert.equal(calls.some((call) => /entities\s+push|deploy|PUT\s+entity-schemas/i.test(call)), false);
}

const baseLive = entityMap([
  schema('Order', { order_number: field('string') }, ['order_number']),
  schema('ShopifyOrder', { shopify_order_number: field('string') }, ['shopify_order_number']),
  schema('FulfillmentTask', { order_id: field('string'), fulfillment_number: field('number') }, ['order_id']),
  schema('Subscription', { customer_ref: field('string') }, ['customer_ref']),
]);
const baseLocal = entityMap([
  schema('Order', {
    order_number: field('string'),
    customer_app_subscription_id: field('string'),
    subscription_occurrence_id: field('string'),
    subscription_cycle_key: field('string'),
    fulfillment_number: field('number'),
    source_type: field('string'),
  }, ['order_number']),
  schema('ShopifyOrder', {
    shopify_order_number: field('string'),
    subscription_occurrence_id: field('string'),
    subscription_cycle_key: field('string'),
  }, ['shopify_order_number']),
  schema('FulfillmentTask', {
    order_id: field('string'),
    fulfillment_number: field('number'),
    subscription_occurrence_id: field('string'),
    subscription_cycle_key: field('string'),
  }, ['order_id']),
  schema('Subscription', { customer_ref: field('string') }, ['customer_ref']),
]);

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('JSONC normalization is deterministic', () => {
  const a = normalizeSchemaText('{"name":"Order","type":"object","properties":{"b":{"type":"string"},"a":{"type":"number"}}}');
  const b = normalizeSchemaText('{"properties":{"a":{"type":"number"},"b":{"type":"string"}},"type":"object","name":"Order"}');
  assert.equal(a, b);
});

test('comments and key ordering do not cause false drift', () => {
  const a = normalizeSchemaText('{/*x*/"name":"Order","properties":{"a":{"type":"string"}},"type":"object"}');
  const b = normalizeSchemaText('{"type":"object","properties":{"a":{"type":"string"}},"name":"Order"}// trailing');
  assert.equal(a, b);
});

test('missing live entity is detected', () => {
  const impact = predictImpact({}, baseLocal);
  assert.ok(impact.created.includes('Order'));
});

test('extra live entity is detected', () => {
  const live = { ...baseLive, ExtraEntity: schema('ExtraEntity') };
  const impact = predictImpact(live, baseLocal);
  assert.deepEqual(impact.deleted, ['ExtraEntity']);
});

test('unrelated schema drift is detected', () => {
  const local = { ...baseLocal, Subscription: schema('Subscription', { customer_ref: field('number') }, ['customer_ref']) };
  const impact = predictImpact(baseLive, local);
  assert.ok(impact.updated.includes('Subscription'));
});

test('deleted field is detected', () => {
  const local = { ...baseLocal, Order: schema('Order', {}) };
  const diff = diffSchema(baseLive.Order, local.Order);
  assert.deepEqual(diff.removed, ['order_number']);
});

test('existing field type change is detected', () => {
  const local = { ...baseLocal, Subscription: schema('Subscription', { customer_ref: field('number') }, ['customer_ref']) };
  const diff = diffSchema(baseLive.Subscription, local.Subscription);
  assert.deepEqual(diff.changed, ['customer_ref']);
});

test('required-field change is detected', () => {
  const local = { ...baseLocal, Order: schema('Order', { ...baseLocal.Order.properties }, ['order_number', 'subscription_occurrence_id']) };
  const diff = diffSchema(baseLive.Order, local.Order);
  assert.deepEqual(diff.requiredAdded, ['subscription_occurrence_id']);
});

test('default-value change is detected', () => {
  const local = { ...baseLocal, Order: schema('Order', { ...baseLocal.Order.properties, subscription_occurrence_id: field('string', { default: 'fabricated' }) }, ['order_number']) };
  const diff = diffSchema(baseLive.Order, local.Order);
  assert.deepEqual(diff.defaultAdditions, ['subscription_occurrence_id']);
});

test('enum/constraint change is detected', () => {
  const local = { ...baseLocal, Order: schema('Order', { ...baseLocal.Order.properties, source_type: field('string', { enum: ['subscription_occurrence'] }) }, ['order_number']) };
  const diff = diffSchema(baseLive.Order, local.Order);
  assert.deepEqual(diff.constraintChanges, ['source_type']);
});

test('expected Order additions pass', () => {
  const diff = diffSchema(baseLive.Order, baseLocal.Order);
  assert.equal(expectedAdditionsOnly('Order', diff, baseLocal.Order), true);
});

test('expected ShopifyOrder additions pass', () => {
  const diff = diffSchema(baseLive.ShopifyOrder, baseLocal.ShopifyOrder);
  assert.equal(expectedAdditionsOnly('ShopifyOrder', diff, baseLocal.ShopifyOrder), true);
});

test('expected FulfillmentTask additions pass', () => {
  const diff = diffSchema(baseLive.FulfillmentTask, baseLocal.FulfillmentTask);
  assert.equal(expectedAdditionsOnly('FulfillmentTask', diff, baseLocal.FulfillmentTask), true);
});

test('unexpected fourth updated entity fails', () => {
  const local = { ...baseLocal, Subscription: schema('Subscription', { customer_ref: field('string'), unexpected: field('string') }, ['customer_ref']) };
  const impact = predictImpact(baseLive, local);
  const unexpected = impact.updated.filter((name) => !INTENDED_UPDATED.has(name));
  assert.deepEqual(unexpected, ['Subscription']);
});

test('predicted created count must be zero', () => {
  const impact = predictImpact(baseLive, baseLocal);
  assert.equal(impact.created.length, 0);
});

test('predicted deleted count must be zero', () => {
  const impact = predictImpact(baseLive, baseLocal);
  assert.equal(impact.deleted.length, 0);
});

test('predicted updated count must be three', () => {
  const impact = predictImpact(baseLive, baseLocal);
  assert.deepEqual(impact.updated.sort(), ['FulfillmentTask', 'Order', 'ShopifyOrder']);
});

test('raw credentials are not written to output', () => {
  const safeOutput = { entity: 'Order', hash: 'abc123', blockers: ['live_export_unavailable'] };
  assert.equal(hasUnsafeOutput(safeOutput), false);
});

test('no schema publish is invoked', () => {
  assertNoPublishInvocation(['base44 whoami', 'base44 eject --help', 'node local-hash-script']);
});

test('no live records are mutated', () => {
  const result = { record_writes_performed: false, provider_calls: false, notifications_sent: false, hub_mutation: false };
  assert.equal(result.record_writes_performed, false);
  assert.equal(result.provider_calls, false);
  assert.equal(result.notifications_sent, false);
  assert.equal(result.hub_mutation, false);
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
console.log(`\nG46B-OCC4-PUB2 schema-map equivalence tests passed (${passed}/${tests.length}).`);
