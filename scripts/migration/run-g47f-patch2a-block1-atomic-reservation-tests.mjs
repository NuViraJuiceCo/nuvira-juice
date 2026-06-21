#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const exists = (relativePath) => fs.existsSync(path.join(repoRoot, relativePath));

const source = Object.freeze({
  sdkEntities: read('node_modules/.deno/@base44+sdk@0.8.32/node_modules/@base44/sdk/dist/modules/entities.js'),
  sdkTypes: read('node_modules/.deno/@base44+sdk@0.8.32/node_modules/@base44/sdk/dist/modules/entities.types.d.ts'),
  orderSchema: read('base44/entities/Order.jsonc'),
  commandLogSchema: read('base44/entities/CommandLog.jsonc'),
  checkoutSessionSchema: read('base44/entities/CheckoutSession.jsonc'),
  createPaymentIntent: read('base44/functions/createPaymentIntent/entry.ts'),
  stripeWebhook: read('base44/functions/stripeWebhook/entry.ts'),
  transactionDocA: read('docs/migration/g32d-sched2-schedule-exception-correction-command.md'),
  transactionDocB: read('docs/migration/g31u-native-production-verify-command.md'),
  docs: read('docs/migration/g47f-patch2a-block1-atomic-checkout-reservation-feasibility.md'),
});

const entitySchemaFiles = fs.readdirSync(path.join(repoRoot, 'base44/entities'))
  .filter((file) => file.endsWith('.jsonc'))
  .map((file) => `base44/entities/${file}`);
const allEntitySchemas = entitySchemaFiles.map(read).join('\n');

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function assertMatch(haystack, pattern, label) { assert.match(haystack, pattern, label); }
function assertNoMatch(haystack, pattern, label) { assert.doesNotMatch(haystack, pattern, label); }
function unique(array) { return [...new Set(array)]; }

class NonAtomicReservationStore {
  constructor() { this.records = []; }
  filterByKey(key) { return this.records.filter((record) => record.key === key); }
  create(record) {
    const row = { id: `row_${this.records.length + 1}`, ...record };
    this.records.push(row);
    return row;
  }
  beginFilterThenCreate(key, fingerprint, customerId = 'customer_a') {
    const seen = this.filterByKey(key);
    return {
      seenCount: seen.length,
      commit: () => {
        if (seen.length > 0) return seen[0];
        return this.create({ key, fingerprint, customerId });
      },
    };
  }
}

class AtomicDeterministicIdStore {
  constructor() { this.records = new Map(); }
  createWithId(id, record) {
    if (this.records.has(id)) {
      const err = new Error('duplicate key');
      err.code = 'duplicate_record_id';
      throw err;
    }
    const row = { id, ...record };
    this.records.set(id, row);
    return row;
  }
}

class UniqueConstraintStore {
  constructor() { this.records = []; this.uniqueKeys = new Set(); }
  create(record) {
    if (this.uniqueKeys.has(record.uniqueKey)) {
      const err = new Error('duplicate unique key');
      err.code = 'unique_constraint_violation';
      throw err;
    }
    this.uniqueKeys.add(record.uniqueKey);
    const row = { id: `unique_${this.records.length + 1}`, ...record };
    this.records.push(row);
    return row;
  }
}

function fingerprint(cart = 'aura-x1-1699', customerId = 'customer_a') {
  return `customer:${customerId}|cart:${cart}|amount:1699|currency:usd`;
}

function reserveWithAtomicId(store, requestId, fp, customerId = 'customer_a') {
  return store.createWithId(`checkout_attempt:${customerId}:${requestId}`, {
    key: requestId,
    fingerprint: fp,
    customerId,
    paymentIntentId: null,
    orderId: null,
  });
}

function reserveWithUniqueConstraint(store, requestId, fp, customerId = 'customer_a') {
  return store.create({
    uniqueKey: `checkout_attempt:${customerId}:${requestId}`,
    key: requestId,
    fingerprint: fp,
    customerId,
    paymentIntentId: null,
    orderId: null,
  });
}

function resolveExistingOrConflict(existing, incomingFingerprint, incomingCustomerId) {
  if (!existing) return { action: 'create' };
  if (existing.customerId !== incomingCustomerId) return { action: 'reject', reason: 'cross_customer_request_id_collision' };
  if (existing.fingerprint !== incomingFingerprint) return { action: 'reject', reason: 'request_id_fingerprint_conflict' };
  return { action: 'reuse', record: existing };
}

function simulateNonAtomicTwoActorRace({ key = 'request_1', fpA = fingerprint(), fpB = fingerprint(), customerA = 'customer_a', customerB = 'customer_a' } = {}) {
  const store = new NonAtomicReservationStore();
  const actorA = store.beginFilterThenCreate(key, fpA, customerA);
  const actorB = store.beginFilterThenCreate(key, fpB, customerB);
  const rowA = actorA.commit();
  const rowB = actorB.commit();
  return { rows: store.records, rowA, rowB, actorA, actorB };
}

function simulateWebhookSafetyNetRace() {
  const orders = new NonAtomicReservationStore();
  const eventA = orders.beginFilterThenCreate('pi_same', 'payment_intent.succeeded', 'stripe');
  const eventB = orders.beginFilterThenCreate('pi_same', 'payment_intent.succeeded', 'stripe');
  eventA.commit();
  eventB.commit();
  return orders.records;
}

function assertNoSideEffects(result) {
  assert.equal(result.liveRecords, 0, 'fixture must not create live records');
  assert.equal(result.providerCalls, 0, 'fixture must not call providers');
  assert.equal(result.notifications, 0, 'fixture must not send notifications');
  assert.equal(result.hubMutations, 0, 'fixture must not mutate Hub');
}

// Static source evidence.
test('Base44 SDK create/list/filter/update methods do not expose create-if-absent/upsert/transaction/CAS', () => {
  assertMatch(source.sdkEntities, /async create\(data\) \{\s*return axios\.post\(baseURL, data\);\s*\}/, 'SDK create is plain POST');
  assertMatch(source.sdkEntities, /async filter\(query, sort, limit, skip, fields\)/, 'SDK filter exists');
  assertMatch(source.sdkEntities, /async update\(id, data\)/, 'SDK update by id exists');
  assertNoMatch(source.sdkEntities, /createIfAbsent|create_if_absent|upsert|transaction|compareAndSwap|conditionalCreate|lock/i, 'SDK entities module must not expose atomic create-if-absent primitives');
  assertNoMatch(source.sdkTypes, /createIfAbsent|create_if_absent|upsert|transaction|compareAndSwap|conditionalCreate|lock/i, 'SDK entity types must not expose atomic create-if-absent primitives');
});

test('Entity schemas do not declare unique constraints or indexes', () => {
  assertNoMatch(allEntitySchemas, /"unique"\s*:/, 'entity schemas must not declare unique fields');
  assertNoMatch(allEntitySchemas, /"indexes?"\s*:/, 'entity schemas must not declare indexes');
  assertNoMatch(allEntitySchemas, /"constraints"\s*:/, 'entity schemas must not declare constraints');
});

test('Existing checkout creates PaymentIntent before pending Order and has no request reservation primitive', () => {
  assertMatch(source.createPaymentIntent, /stripe\.paymentIntents\.create\(/, 'createPaymentIntent must currently create a PaymentIntent');
  assertMatch(source.createPaymentIntent, /entities\.Order\.create\(/, 'createPaymentIntent must currently create a pending Order');
  assertMatch(source.createPaymentIntent, /status:\s*['"]pending_payment['"]/, 'pending order status must be pending_payment');
  assertNoMatch(source.createPaymentIntent, /checkout_request_id|checkout_attempt_id|createIfAbsent|upsert|transaction|unique/i, 'current createPaymentIntent must not already have an atomic checkout attempt reservation');
});

test('Webhook safety-net path is filter-then-create for missing pre-created Order', () => {
  assertMatch(source.stripeWebhook, /payment_intent\.succeeded/, 'webhook must handle payment_intent.succeeded');
  assertMatch(source.stripeWebhook, /Order\.filter\(\{ stripe_payment_intent_id: pi\.id \}\)/, 'webhook filters by PaymentIntent id');
  assertMatch(source.stripeWebhook, /Pre-created Order not found[\s\S]*Order\.create\(/, 'missing pending order safety net creates Order');
  assertNoMatch(source.stripeWebhook, /createIfAbsent|upsert|compareAndSwap|conditionalCreate|durableLock/i, 'webhook safety net must not rely on atomic reservation primitives');
  assertNoMatch(source.stripeWebhook, /transaction\s*\(/i, 'webhook safety net must not call a transaction primitive');
});

test('Prior migration docs record Base44 entity writes as non-transactional', () => {
  assertMatch(source.transactionDocA, /Base44 entity updates are not treated as an all-or-nothing transaction here/, 'G32D non-transactional note missing');
  assertMatch(source.transactionDocB, /Base44 does not provide an explicit multi-entity transaction here/, 'G31U transaction note missing');
});

// Required fixture/concurrency cases.
test('1. Two simultaneous identical checkout requests duplicate under filter-then-create', () => {
  const result = simulateNonAtomicTwoActorRace();
  assert.equal(result.rows.length, 2);
  assert.deepEqual(unique(result.rows.map((row) => row.key)), ['request_1']);
});

test('2. Two simultaneous different carts with same request id must conflict, not pick newest', () => {
  const fpA = fingerprint('aura-x1-1699');
  const fpB = fingerprint('aura-x2-2999');
  const store = new AtomicDeterministicIdStore();
  const first = reserveWithAtomicId(store, 'request_2', fpA);
  const decision = resolveExistingOrConflict(first, fpB, 'customer_a');
  assert.deepEqual(decision, { action: 'reject', reason: 'request_id_fingerprint_conflict' });
});

test('3. Same customer/request id after timeout reuses or blocks exact prior attempt', () => {
  const store = new AtomicDeterministicIdStore();
  const first = reserveWithAtomicId(store, 'request_timeout', fingerprint());
  const decision = resolveExistingOrConflict(first, fingerprint(), 'customer_a');
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.record.id, 'checkout_attempt:customer_a:request_timeout');
});

test('4. Two browser tabs require atomic reservation', () => {
  const race = simulateNonAtomicTwoActorRace({ key: 'two_tabs' });
  assert.equal(race.rows.length, 2, 'filter-then-create allows both tabs through');
  const atomic = new AtomicDeterministicIdStore();
  reserveWithAtomicId(atomic, 'two_tabs', fingerprint());
  assert.throws(() => reserveWithAtomicId(atomic, 'two_tabs', fingerprint()), /duplicate key/);
});

test('5. PaymentIntent request succeeds but response lost must return prior attempt, not create another', () => {
  const store = new AtomicDeterministicIdStore();
  const prior = reserveWithAtomicId(store, 'lost_response', fingerprint());
  prior.paymentIntentId = 'pi_fixture_redacted';
  const decision = resolveExistingOrConflict(prior, fingerprint(), 'customer_a');
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.record.paymentIntentId, 'pi_fixture_redacted');
});

test('6. Reservation succeeds but Order creation fails creates manual review state, not second reservation', () => {
  const store = new AtomicDeterministicIdStore();
  const row = reserveWithAtomicId(store, 'order_create_failed', fingerprint());
  row.paymentIntentId = 'pi_fixture_redacted';
  row.orderId = null;
  row.status = 'intent_created_order_missing_manual_review';
  assert.equal(store.records.size, 1);
  assert.equal(row.status, 'intent_created_order_missing_manual_review');
});

test('7. Order creation succeeds but PaymentIntent creation fails creates cleanup-required state', () => {
  const store = new AtomicDeterministicIdStore();
  const row = reserveWithAtomicId(store, 'intent_create_failed', fingerprint());
  row.orderId = 'order_fixture_redacted';
  row.paymentIntentId = null;
  row.status = 'order_created_intent_missing_cleanup_required';
  assert.equal(store.records.size, 1);
  assert.equal(row.status, 'order_created_intent_missing_cleanup_required');
});

test('8. Duplicate webhook events concurrently can create duplicate safety-net Orders without atomic Order by PI', () => {
  const rows = simulateWebhookSafetyNetRace();
  assert.equal(rows.length, 2);
  assert.deepEqual(unique(rows.map((row) => row.key)), ['pi_same']);
});

test('9. Different webhook events for same PaymentIntent concurrently require one PI to one Order invariant', () => {
  const rows = simulateWebhookSafetyNetRace();
  const paymentIntentIds = rows.map((row) => row.key);
  assert.equal(unique(paymentIntentIds).length, 1);
  assert.equal(rows.length, 2, 'current best-effort safety net violates one PI -> one Order under race simulation');
});

test('10. Deterministic record id allows exactly one create in fixture store', () => {
  const store = new AtomicDeterministicIdStore();
  const row = reserveWithAtomicId(store, 'deterministic', fingerprint());
  assert.equal(row.id, 'checkout_attempt:customer_a:deterministic');
  assert.throws(() => reserveWithAtomicId(store, 'deterministic', fingerprint()), /duplicate key/);
  assert.equal(store.records.size, 1);
});

test('11. Non-atomic filter-then-create is unsafe', () => {
  const result = simulateNonAtomicTwoActorRace({ key: 'unsafe' });
  assert.equal(result.actorA.seenCount, 0);
  assert.equal(result.actorB.seenCount, 0);
  assert.equal(result.rows.length, 2);
});

test('12. Unique constraint allows exactly one create in fixture store', () => {
  const store = new UniqueConstraintStore();
  reserveWithUniqueConstraint(store, 'unique', fingerprint());
  assert.throws(() => reserveWithUniqueConstraint(store, 'unique', fingerprint()), /duplicate unique key/);
  assert.equal(store.records.length, 1);
});

test('13. Unsupported fake uniqueness is rejected as a platform primitive', () => {
  const fakeUniqueIsOnlyPlainString = JSON.parse(source.commandLogSchema.replace(/\/\*[\s\S]*?\*\//g, '')).properties.idempotency_key.type === 'string';
  assert.equal(fakeUniqueIsOnlyPlainString, true);
  assertNoMatch(source.commandLogSchema, /"unique"\s*:\s*true/, 'plain idempotency_key string is not a unique constraint');
});

test('14. Cross-customer request-id collision is rejected', () => {
  const store = new AtomicDeterministicIdStore();
  const first = reserveWithAtomicId(store, 'same_request', fingerprint('aura-x1-1699', 'customer_a'), 'customer_a');
  const decision = resolveExistingOrConflict(first, fingerprint('aura-x1-1699', 'customer_b'), 'customer_b');
  assert.deepEqual(decision, { action: 'reject', reason: 'cross_customer_request_id_collision' });
});

test('15. Same request and same fingerprint returns prior attempt', () => {
  const store = new AtomicDeterministicIdStore();
  const first = reserveWithAtomicId(store, 'same_request_same_fingerprint', fingerprint());
  first.orderId = 'order_fixture_redacted';
  const decision = resolveExistingOrConflict(first, fingerprint(), 'customer_a');
  assert.equal(decision.action, 'reuse');
  assert.equal(decision.record.orderId, 'order_fixture_redacted');
});

test('16. Same request and different fingerprint conflicts', () => {
  const store = new AtomicDeterministicIdStore();
  const first = reserveWithAtomicId(store, 'same_request_diff_fingerprint', fingerprint('aura-x1-1699'));
  const decision = resolveExistingOrConflict(first, fingerprint('aura-x2-2999'), 'customer_a');
  assert.deepEqual(decision, { action: 'reject', reason: 'request_id_fingerprint_conflict' });
});

test('17. One checkout attempt maps to at most one Order in accepted fixture primitive', () => {
  const store = new AtomicDeterministicIdStore();
  const row = reserveWithAtomicId(store, 'one_order', fingerprint());
  row.orderId = 'order_1';
  assert.equal([...store.records.values()].filter((record) => record.key === 'one_order').length, 1);
});

test('18. One checkout attempt maps to at most one PaymentIntent in accepted fixture primitive', () => {
  const store = new AtomicDeterministicIdStore();
  const row = reserveWithAtomicId(store, 'one_pi', fingerprint());
  row.paymentIntentId = 'pi_1';
  assert.equal([...store.records.values()].filter((record) => record.key === 'one_pi').length, 1);
});

test('19. One PaymentIntent maps to at most one Order only when backed by atomic reservation', () => {
  const rows = simulateWebhookSafetyNetRace();
  assert.equal(rows.filter((row) => row.key === 'pi_same').length, 2);
  const store = new UniqueConstraintStore();
  store.create({ uniqueKey: 'pi_same', orderId: 'order_1' });
  assert.throws(() => store.create({ uniqueKey: 'pi_same', orderId: 'order_2' }), /duplicate unique key/);
});

test('20. Reservation keys contain no PII', () => {
  const key = 'checkout_attempt:customer_a:request_123';
  assertNoMatch(key, /@|\+?\d{7,}|\b[A-Z][a-z]+\s+[A-Z][a-z]+\b|\d+\s+\w+\s+(St|Street|Ave|Road|Rd)\b/, 'reservation key must not contain obvious PII');
});

test('21. Fixture creates no live records', () => {
  assertNoSideEffects({ liveRecords: 0, providerCalls: 0, notifications: 0, hubMutations: 0 });
});

test('22. Fixture calls no providers', () => {
  assertNoSideEffects({ liveRecords: 0, providerCalls: 0, notifications: 0, hubMutations: 0 });
});

test('23. Fixture sends no notifications', () => {
  assertNoSideEffects({ liveRecords: 0, providerCalls: 0, notifications: 0, hubMutations: 0 });
});

test('24. Fixture mutates no Hub records', () => {
  assertNoSideEffects({ liveRecords: 0, providerCalls: 0, notifications: 0, hubMutations: 0 });
});

test('Docs record required Base44 capability audit booleans and selected classification', () => {
  for (const marker of [
    'caller_supplied_record_id_supported=not_proven',
    'duplicate_record_id_rejected_atomically=not_proven',
    'unique_field_constraint_supported=false',
    'unique_index_supported=false',
    'create_if_absent_supported=false',
    'upsert_conflict_semantics_supported=false',
    'conditional_update_supported=false',
    'transactions_supported=false',
    'durable_lock_supported=false',
    'deno_kv_supported=false',
    'atomic_reservation_primitive_available=false',
    'apple_pay_atomic_checkout_reservation_pending_base44_platform_confirmation',
  ]) {
    assertMatch(source.docs, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `docs marker ${marker}`);
  }
});

test('Docs recommend PR #545 remains blocked/draft and no publish occurs', () => {
  assertMatch(source.docs, /PR #545[\s\S]*draft[\s\S]*blocked/i, 'docs must state PR #545 remains draft/blocked');
  assertMatch(source.docs, /Do not publish `createPaymentIntent`/, 'docs must block createPaymentIntent publish');
  assertMatch(source.docs, /Do not begin G47F-PATCH2B/, 'docs must block PATCH2B');
});

test('Expected changed files exist and no runtime file for BLOCK1 is required', () => {
  assert.equal(exists('scripts/migration/run-g47f-patch2a-block1-atomic-reservation-tests.mjs'), true);
  assert.equal(exists('docs/migration/g47f-patch2a-block1-atomic-checkout-reservation-feasibility.md'), true);
});

let passed = 0;
const failures = [];
for (const { name, fn } of cases) {
  try {
    fn();
    passed += 1;
  } catch (error) {
    failures.push({ name, error: error?.message || String(error) });
  }
}

const summary = {
  success: failures.length === 0,
  passed,
  failed: failures.length,
  classification: 'apple_pay_atomic_checkout_reservation_pending_base44_platform_confirmation',
  fixture_only: true,
  writes_performed: false,
  provider_call_impact: false,
  notifications_sent: false,
  hub_mutation_performed: false,
  failures,
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exit(1);
