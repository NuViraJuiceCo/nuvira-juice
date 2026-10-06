#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const handlerPath = 'base44/functions/getCustomerAccountDashboardData/handlers/getCustomerAccountDashboardData/entry.ts';
const baselineRevision = 'cbb224c81197dd5efd141c968e6d195bd9212522';
const baselineSource = execFileSync('git', ['show', `${baselineRevision}:${handlerPath}`], { cwd: root, encoding: 'utf8' });
const candidateSource = fs.readFileSync(path.join(root, handlerPath), 'utf8');
assert.equal(
  candidateSource.slice(0, candidateSource.indexOf('    // Identity resolution must finish')).trimEnd(),
  baselineSource.slice(0, baselineSource.indexOf('    // ── STEP 3:')).trimEnd(),
  'all existing helpers, authentication, identity discovery and profile selection must stay unchanged',
);
const responseBoundary = "    console.log(`[getCustomerAccountDashboardData] Done.";
assert.equal(candidateSource.slice(candidateSource.indexOf(responseBoundary)),
  baselineSource.slice(baselineSource.indexOf(responseBoundary)),
  'response fields/defaults and outer error handling must stay unchanged');
const clone = value => structuredClone(value);
const EMAIL = 'member@example.test';
const RELAY = 'relay@example.test';
const EXTRA = 'linked@example.test';
const results = [];

function fixture(overrides = {}) {
  return {
    user: { id: 'member-1', email: EMAIL, role: 'user' },
    rows: {
      UserProfile: [{ id: 'profile-1', customer_email: EMAIL, contact_email: EMAIL, first_name: 'Test' }],
      Subscription: [
        { id: 'sub-1', customer_email: EMAIL, stripe_subscription_id: 'sub_fake_1', status: 'active' },
        { id: 'sub-2', customer_email: EMAIL, status: 'paused' },
        { id: 'sub-3', customer_email: EMAIL, status: 'cancelled' },
      ],
      Order: [
        { id: 'order-1', order_number: 'NV-PAID', customer_email: EMAIL, status: 'delivered', payment_status: 'paid', total: 30, items: [] },
        { id: 'order-2', order_number: 'NV-REFUND', customer_email: EMAIL, status: 'refunded', payment_status: 'refunded', total: 10, items: [] },
        { id: 'order-3', order_number: 'NV-PENDING', customer_email: EMAIL, status: 'pending_payment', payment_status: 'pending' },
        { id: 'order-4', order_number: 'NV-TEST', customer_email: EMAIL, payment_status: 'paid', is_test_order: true },
        { id: 'order-5', order_number: 'NV-ABANDONED', customer_email: EMAIL, payment_status: 'paid', is_abandoned_checkout: true },
      ],
      NuViraCredit: [{ id: 'credit-1', customer_email: EMAIL, balance: 17.5, reserved_balance: 2.25, lifetime_issued: 20, lifetime_used: 2.5 }],
      UserPoints: [{ id: 'points-1', customer_email: EMAIL, total_points: 300, reserved_points: 40, lifetime_points: 400, redeemed_points: 100 }],
      Notification: [
        { id: 'notif-1', customer_email: EMAIL, is_read: false },
        { id: 'notif-2', customer_email: EMAIL, is_read: true },
      ],
      ShopifyOrder: [], FulfillmentTask: [], OrderReviewQueue: [], OrderSyncLog: [], SafeSyncParityLog: [], RewardTier: [],
    },
    ...overrides,
  };
}

// Deterministic logical clock: no wall-clock sleeps, network, SDK, or credentials.
async function run(source, data) {
  const reads = [];
  const writes = [];
  const pending = [];
  const durations = { auth: 5, UserProfile: 10, Subscription: 40, Order: 70, ShopifyOrder: 30, FulfillmentTask: 20, NuViraCredit: 15, UserPoints: 30, Notification: 25 };
  let now = 0;
  let authComplete = false;
  const delay = (duration, outcome) => new Promise((resolve, reject) => {
    pending.push({ at: now + duration, finish: () => {
      try { resolve(outcome()); } catch (error) { reject(error); }
    } });
  });
  const entities = new Proxy({}, {
    get: (_target, entityName) => new Proxy({}, {
      get: (_entity, method) => (...args) => {
        if (method !== 'filter') {
          writes.push({ entityName, method });
          throw new Error(`unexpected_entity_operation:${entityName}.${method}`);
        }
        assert.equal(authComplete, true, 'service-role reads must follow authentication');
        const [filter, sort, limit] = args;
        reads.push({ entity: entityName, filter: clone(filter), sort: sort ?? null, limit: limit ?? null, startedAt: now });
        const failure = (data.failures || []).find(item => item.entity === entityName
          && (!item.filter || Object.entries(item.filter).every(([key, value]) => filter[key] === value)));
        return delay(failure?.delay ?? durations[entityName] ?? 10, () => {
          if (failure) throw new Error(failure.message);
          const rows = (data.rows[entityName] || []).filter(row => Object.entries(filter).every(([key, value]) => row[key] === value));
          // Source fixtures are deliberately preordered; record/assert the exact
          // requested sort and limit separately rather than inventing SDK sorting.
          return clone(limit == null ? rows : rows.slice(0, limit));
        });
      },
    }),
  });
  const base44 = {
    auth: { me: () => delay(durations.auth, () => {
      if (data.authError) throw new Error(data.authError);
      authComplete = true;
      return clone(data.user);
    }) },
    asServiceRole: { entities },
    functions: { invoke() { throw new Error('external_function_call_not_allowed'); } },
  };
  const context = vm.createContext({
    createClientFromRequest: () => base44,
    Deno: { env: { get: key => data.env?.[key] } },
    Response, Request, console: { log() {}, warn() {}, error() {} },
    fetch() { throw new Error('provider_call_not_allowed'); },
  });
  vm.runInContext(source.replace(/^import .*$/gm, '')
    .replace('export default async function handler(req: Request)', 'globalThis.handler = async function handler(req)'), context);
  let done = false;
  let response;
  let rejection;
  context.handler(new Request('https://audit.invalid/dashboard', { method: 'POST', body: '{}' }))
    .then(value => { response = value; done = true; }, error => { rejection = error; done = true; });
  for (let iteration = 0; !done && iteration < 10000; iteration++) {
    // Drain promise chains between each logical timer wave.
    for (let microtask = 0; microtask < 40; microtask++) await Promise.resolve();
    if (done) break;
    assert.ok(pending.length, 'handler stalled without a scheduled fake read');
    now = Math.min(...pending.map(item => item.at));
    const due = pending.filter(item => item.at === now);
    for (const item of due) pending.splice(pending.indexOf(item), 1);
    for (const item of due) item.finish();
  }
  assert.equal(done, true, 'handler must settle');
  if (rejection) throw rejection;
  assert.deepEqual(writes, [], 'dashboard must remain read-only');
  return { status: response.status, body: await response.json(), reads, logicalMs: now };
}

function readSignature(reads) {
  return reads.map(({ startedAt, ...request }) => JSON.stringify(request)).sort();
}

async function compare(name, data, { expectedStatus = 200, expectedError, check } = {}) {
  const before = await run(baselineSource, data);
  const after = await run(candidateSource, data);
  assert.equal(after.status, expectedStatus, name);
  assert.deepEqual(after.body, before.body, `${name}: response parity`);
  if (expectedError) assert.equal(after.body.error, expectedError);
  if (expectedStatus === 200) assert.deepEqual(readSignature(after.reads), readSignature(before.reads), `${name}: exact filters, limits and read counts`);
  if (check) check(after, before);
  results.push({ name, ok: true, baseline_logical_ms: before.logicalMs, candidate_logical_ms: after.logicalMs });
  return { before, after };
}

const success = await compare('ordinary_member_response_and_read_contract_parity', fixture(), {
  check: after => {
    assert.equal(after.body.credits, 15.25);
    assert.equal(after.body.notifications_unread_count, 1);
    assert.equal(after.body.subscription_count, 2);
    assert.deepEqual(after.body.orders.map(order => order.order_number).sort(), ['NV-PAID', 'NV-REFUND']);
  },
});
assert.ok(success.after.logicalMs < success.before.logicalMs, 'parallel sections must shorten the deterministic critical path');
const sectionStarts = ['Subscription', 'Order', 'NuViraCredit', 'UserPoints', 'Notification']
  .map(entity => success.after.reads.find(read => read.entity === entity).startedAt);
assert.equal(new Set(sectionStarts).size, 1, 'all five sections start in the same logical wave');
assert.ok(success.after.reads.filter(read => read.entity === 'UserProfile').every(read => read.startedAt < sectionStarts[0]), 'identity/profile phase must finish before section fanout');

const empty = fixture();
for (const key of Object.keys(empty.rows)) empty.rows[key] = [];
await compare('missing_profile_and_empty_account_defaults', empty);

const linked = fixture({ user: { id: 'relay-user', email: RELAY, role: 'user' } });
linked.rows.UserProfile = [
  { id: 'relay-profile', customer_email: RELAY, contact_email: EMAIL },
  { id: 'linked-profile', customer_email: EMAIL, contact_email: EXTRA },
];
linked.rows.Subscription.unshift({ id: 'relay-sub', customer_email: RELAY, stripe_subscription_id: 'sub_fake_1', status: 'paused' });
linked.rows.Order.unshift({ id: 'relay-order', customer_email: RELAY, order_number: 'NV-PAID', status: 'delivered', payment_status: 'paid', total: 31, items: [] });
linked.rows.NuViraCredit.push({ id: 'unused-credit-1', customer_email: EXTRA }, { id: 'unused-credit-2', customer_email: EXTRA });
linked.rows.UserPoints.push({ id: 'unused-points', customer_email: EXTRA, total_points: 999 });
await compare('linked_identity_order_dedupe_and_first_match_early_breaks', linked, {
  check: after => {
    assert.deepEqual(after.body.resolved_identity_emails, [RELAY, EMAIL, EXTRA]);
    assert.equal(after.body.all_subscriptions[0].id, 'relay-sub');
    assert.equal(after.body.orders.find(order => order.order_number === 'NV-PAID').id, 'relay-order');
    assert.ok(!after.reads.some(read => ['NuViraCredit', 'UserPoints'].includes(read.entity) && read.filter.customer_email === EXTRA));
  },
});

const proof = fixture();
proof.rows.ShopifyOrder = [{ id: 'native-1', customer_email: EMAIL, shopify_order_number: 'NV-AUTHORITATIVE', payment_status: 'paid', financial_status: 'paid', total_price: 22, fulfillment_status: 'delivered', items: [] }];
proof.rows.FulfillmentTask = [{ id: 'proof-1', customer_email: EMAIL, order_number: 'NV-PAID', base44_order_id: 'order-1', status: 'delivered', delivery_photo_url: 'https://example.invalid/proof.jpg' }];
await compare('authoritative_history_merge_and_delivery_proof_preserved', proof);

const toggles = clone(proof);
toggles.env = {
  ENABLE_CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST: 'true',
  CUSTOMER_ORDER_HISTORY_LIMITED_NATIVE_FIRST_ORDER_ALLOWLIST: 'NV-PAID',
  ENABLE_CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_READS: 'true',
  CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_USER_POINTS_ALLOWLIST: 'points-1',
};
await compare('limited_native_read_flags_and_fallbacks_preserved', toggles);
await compare('optional_history_reads_still_fail_soft', { ...fixture(), failures: [
  { entity: 'ShopifyOrder', message: 'optional_shopify_unavailable' },
  { entity: 'FulfillmentTask', message: 'optional_proof_unavailable' },
] });

await compare('unauthenticated_never_reads_service_role_entities', fixture({ user: null }), { expectedStatus: 401, check: after => assert.equal(after.reads.length, 0) });
await compare('auth_failure_unchanged', fixture({ authError: 'auth_unavailable' }), { expectedStatus: 500, expectedError: 'auth_unavailable', check: after => assert.equal(after.reads.length, 0) });
await compare('identity_failure_prevents_all_section_reads', { ...fixture(), failures: [{ entity: 'UserProfile', message: 'profile_unavailable' }] }, {
  expectedStatus: 500, expectedError: 'profile_unavailable', check: after => assert.ok(after.reads.every(read => read.entity === 'UserProfile')),
});

for (const [entity, message] of [['Subscription', 'subscriptions_unavailable'], ['Order', 'orders_unavailable'], ['NuViraCredit', 'credits_unavailable'], ['UserPoints', 'points_unavailable'], ['Notification', 'notifications_unavailable']]) {
  await compare(`${entity}_failure_remains_fatal_without_partial_response`, { ...fixture(), failures: [{ entity, message }] }, {
    expectedStatus: 500, expectedError: message,
    check: (after, before) => assert.ok(after.logicalMs <= before.logicalMs, 'a failed section must not wait for a later, slower section'),
  });
}
await compare('simultaneous_failures_preserve_section_order_not_fastest_error', { ...fixture(), failures: [
  { entity: 'Subscription', message: 'subscriptions_first', delay: 100 },
  { entity: 'Order', message: 'orders_second', delay: 2 },
  { entity: 'Notification', message: 'notifications_last', delay: 1 },
] }, { expectedStatus: 500, expectedError: 'subscriptions_first' });
const ambiguous = fixture();
ambiguous.rows.NuViraCredit.push({ id: 'credit-duplicate', customer_email: EMAIL, balance: 5 });
ambiguous.failures = [{ entity: 'UserPoints', message: 'later_points_failure', delay: 1 }];
await compare('ambiguous_credits_keep_precedence_over_later_points_failure', ambiguous, { expectedStatus: 500, expectedError: 'credit_account_ambiguous' });
for (const held of [-1, 99, 'not-a-number']) {
  const invalid = fixture();
  invalid.rows.NuViraCredit[0].reserved_balance = held;
  await compare(`invalid_credit_hold_${held}_still_fails_closed_to_zero`, invalid, { check: after => assert.equal(after.body.credits, 0) });
}

assert.doesNotMatch(candidateSource, /\.\s*(?:create|update|delete|bulkCreate|bulkUpdate)\s*\(/);
assert.doesNotMatch(candidateSource, /\bfetch\s*\(|functions\.(?:invoke|fetch)\s*\(/);
console.log(JSON.stringify({ ok: true, suite: 'dashboard-parallel-reads', baseline_revision: baselineRevision,
  checks: results.length, writes_performed: false, provider_calls_performed: false,
  timing_scope: 'deterministic fake read latency only; not a live performance claim',
  ordinary_member_logical_ms: { before: success.before.logicalMs, after: success.after.logicalMs }, results }, null, 2));
