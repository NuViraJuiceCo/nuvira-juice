import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { runRewardHandoff, REWARD_HANDOFF_STAGES, REWARD_HANDOFF_REVISION } from '../../base44/functions/stripeWebhook/rewardHandoff.js';

// All downstream adapters are synthetic; they cannot call a real provider or SDK.
const tests = []; const test = (name, fn) => tests.push([name, fn]);
function fixture() {
  const order = { id: 'order_synthetic', customer_email: 'synthetic@example.test', order_number: 'NV-SYNTHETIC',
    status: 'scheduled_for_juicing', total: 0, payment_captured: false, payment_status: 'paid', financial_status: 'paid',
    stripe_checkout_session_id: 'cs_live_SYNTHETIC', reward_handoff_status: 'pending',
    assigned_delivery_date: '2026-09-12', status_history: [{ message: 'Real history preserved' }],
    reward_settlement: { revision: '2026-09-08.reward-settlement-v1', checkout_session_id: 'cs_live_SYNTHETIC',
      context_hash: 'a'.repeat(64), reservation_id: 'synthetic-reservation', points_redeemed: 2000,
      provider_event_id: 'evt_SYNTHETIC', settled_at: '2026-09-08T08:00:00Z' } };
  const calls = []; const evidence = {}; const faults = {}; let attempt = 0;
  const entities = { Order: {
    filter: async () => structuredClone([order]),
    updateMany: async (query, patch) => {
      if (faults.beforeWrite) { const fn = faults.beforeWrite; faults.beforeWrite = null; fn(order); }
      const matches = Object.entries(query).every(([key, value]) => value && typeof value === 'object'
        ? '$exists' in value ? (order[key] !== undefined) === value.$exists : order[key] !== value.$ne
        : order[key] === value);
      if (!matches) return { success: true, has_more: false, updated: 0 };
      const stage = Object.keys(patch.$set.reward_handoff.steps).at(-1);
      if (faults.write === stage) throw new Error('synthetic write failure');
      Object.assign(order, structuredClone(patch.$set));
      if (faults.lostWrite === stage) { faults.lostWrite = null; throw new Error('synthetic lost response'); }
      if (faults.badWrite) return { success: true, has_more: true, updated: 2 };
      return { success: true, has_more: false, updated: 1 };
    },
  } };
  const adapters = Object.fromEntries(REWARD_HANDOFF_STAGES.map(stage => [stage, {
    perform: async ({ order: snapshot, idempotencyKey }) => {
      assert.equal(idempotencyKey, `reward_handoff:${order.id}:${stage}`);
      assert.equal(snapshot.reward_handoff.steps[stage].state, 'dispatching');
      calls.push(stage);
      if (faults.wait === stage) await faults.waitFor;
      if (faults.before === stage) throw new Error('synthetic rejected or unknown');
      evidence[stage] = faults.receipt?.[stage] || { outcome: 'completed', evidence_id: `synthetic:${stage}` };
      if (faults.after === stage) throw new Error('synthetic lost provider reply with PII synthetic@example.test');
      if (faults.afterPerform) { const fn = faults.afterPerform; faults.afterPerform = null; fn(order); }
      return structuredClone(evidence[stage]);
    },
    reconcile: async ({ idempotencyKey }) => {
      assert.equal(idempotencyKey, `reward_handoff:${order.id}:${stage}`);
      calls.push(`read:${stage}`); return structuredClone(evidence[stage] || null);
    },
  }]));
  return { order, entities, calls, evidence, faults, adapters, run: () => runRewardHandoff({
    entities, orderId: order.id, adapters, now: () => '2026-09-08T08:10:00Z', attemptId: () => `synthetic-attempt-${++attempt}`,
  }) };
}
test('All nine stages are awaited and saved once, without changing cash/lifecycle/history', async () => {
  const f = fixture(); const history = structuredClone(f.order.status_history); const result = await f.run();
  assert.equal(result.complete, true); assert.deepEqual(f.calls, [...REWARD_HANDOFF_STAGES]);
  assert.equal(f.order.reward_handoff_status, 'complete'); assert.equal(f.order.payment_captured, false);
  assert.equal(f.order.status, 'scheduled_for_juicing'); assert.deepEqual(f.order.status_history, history);
  await f.run(); assert.deepEqual(f.calls, [...REWARD_HANDOFF_STAGES]);
});
for (const stage of REWARD_HANDOFF_STAGES) test(`${stage}: lost provider response recovers from evidence, never resends`, async () => {
  const f = fixture(); f.faults.after = stage; const first = await f.run();
  assert.equal(first.complete, false); assert.equal(first.review_required, true); assert.equal(first.stage, stage);
  f.faults.after = null; assert.equal((await f.run()).complete, true);
  assert.equal(f.calls.filter(name => name === stage).length, 1); assert.ok(f.calls.includes(`read:${stage}`));
  for (const name of REWARD_HANDOFF_STAGES) assert.equal(f.calls.filter(c => c === name).length, 1);
});
test('No receipt means review required across retries, not a blind repeated message/provider write', async () => {
  const f = fixture(); f.faults.before = 'confirmation_email'; await f.run(); f.faults.before = null;
  for (let i = 0; i < 3; i++) assert.equal((await f.run()).review_required, true);
  assert.equal(f.calls.filter(name => name === 'confirmation_email').length, 1);
  assert.equal(f.calls.includes('customer_in_app'), false);
  assert.doesNotMatch(JSON.stringify(f.order.reward_handoff), /example\.test|provider reply/);
});
test('Concurrent invocations cannot both dispatch the same side effect', async () => {
  const f = fixture(); let release; f.faults.wait = 'native_operations';
  f.faults.waitFor = new Promise(resolve => { release = resolve; });
  const first = f.run(); for (let i = 0; i < 20; i++) await Promise.resolve();
  const second = await f.run(); assert.equal(second.review_required, true);
  release(); assert.equal((await first).complete, true);
  assert.equal(f.calls.filter(name => name === 'native_operations').length, 1);
});
test('Losing a claim-write response never triggers an unclaimed provider action', async () => {
  const f = fixture(); f.faults.lostWrite = 'native_operations'; await assert.rejects(f.run);
  assert.deepEqual(f.calls, []); assert.equal((await f.run()).review_required, true);
  assert.deepEqual(f.calls, ['read:native_operations']);
});
test('Failure to save a completed receipt is recoverable by read-only evidence lookup', async () => {
  const f = fixture(); f.faults.afterPerform = () => { f.faults.write = 'native_operations'; };
  await assert.rejects(f.run); f.faults.write = null; assert.equal((await f.run()).complete, true);
  assert.equal(f.calls.filter(name => name === 'native_operations').length, 1);
});
test('Concurrent cancellation before a claim prevents any downstream dispatch', async () => {
  const f = fixture(); f.faults.beforeWrite = row => { row.status = 'cancelled'; };
  await assert.rejects(f.run); assert.deepEqual(f.calls, []); assert.equal(f.order.status, 'cancelled');
});
test('Lifecycle advance while a provider call runs is preserved', async () => {
  const f = fixture(); f.faults.afterPerform = row => { row.status = 'in_production'; row.status_history.push({ message: 'Production began' }); };
  assert.equal((await f.run()).complete, true); assert.equal(f.order.status, 'in_production');
  assert.ok(f.order.status_history.some(row => row.message === 'Production began'));
});
test('Missing adapter cannot start a partial handoff', async () => {
  const f = fixture(); delete f.adapters.shopify_mirror; await assert.rejects(f.run, /adapters_incomplete/);
  assert.deepEqual(f.calls, []); assert.equal(f.order.reward_handoff, undefined);
});
test('A completed handoff from another Session/context cannot be reused for this order', async () => {
  for (const field of ['checkout_session_id', 'context_hash']) {
    const f = fixture(); await f.run(); f.order.reward_handoff[field] = 'different';
    const callCount = f.calls.length; await assert.rejects(f.run, /revision_unconfirmed/);
    assert.equal(f.calls.length, callCount);
  }
});
test('No eligible device is an explained skip; missing credentials/error is not', async () => {
  const f = fixture(); f.faults.receipt = { customer_push: { outcome: 'skipped', reason: 'no_eligible_device', evidence_id: 'synthetic:no-device' } };
  assert.equal((await f.run()).complete, true); assert.equal(f.order.reward_handoff.steps.customer_push.receipt.reason, 'no_eligible_device');
  for (const reason of ['internal_secret_missing', 'push_function_unavailable', 'function_error']) {
    const x = fixture(); x.faults.receipt = { customer_push: { outcome: 'skipped', reason, evidence_id: 'synthetic:error' } };
    assert.equal((await x.run()).review_required, true); assert.equal(x.order.reward_handoff_status, 'review_required');
  }
});
test('Email/Shopify cannot be called complete by a skip, missing ID or boolean success alone', async () => {
  for (const receipt of [{ success: true }, { outcome: 'completed' },
    { outcome: 'skipped', reason: 'channel_disabled', evidence_id: 'synthetic:disabled' },
    { outcome: 'completed', evidence_id: 'synthetic@example.test' }]) {
    const f = fixture(); f.faults.receipt = { shopify_mirror: receipt };
    assert.equal((await f.run()).review_required, true); assert.equal(f.calls.includes('confirmation_email'), false);
  }
});
test('Corrupt progress or settlement and malformed CAS results fail closed', async () => {
  for (const mutate of [f => { f.order.reward_settlement = null; }, f => { f.order.reward_handoff_revision = -1; },
    f => { f.order.reward_handoff = { revision: 'other', steps: {} }; },
    f => { f.order.reward_handoff = { revision: REWARD_HANDOFF_REVISION, steps: { unknown: {} } }; },
    f => { f.faults.badWrite = true; }]) {
    const f = fixture(); mutate(f); await assert.rejects(f.run); assert.deepEqual(f.calls, []);
  }
});

const monitorSource = transformSync(fs.readFileSync('base44/functions/getAdminOperationsDashboardSummary/handlers/monitorPostPaymentChain/entry.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
async function monitor(order) {
  const module = { exports: {} }; order.created_date = new Date().toISOString();
  const rows = { Order: [order], ShopifyOrder: [{ id: 'native', base44_order_id: order.id }],
    FulfillmentTask: [{ id: 'task', base44_order_id: order.id, assigned_delivery_date: order.assigned_delivery_date }],
    OrderSyncLog: [{ id: 'log', sync_source: 'native_order_ops', order_number: order.order_number, status: 'success' }] };
  const db = { auth: { me: async () => ({ role: 'admin' }) }, asServiceRole: { entities: new Proxy({}, {
    get: (_, name) => ({ list: async () => rows[name] || [] }),
  }) } };
  vm.runInNewContext(monitorSource, { module, exports: module.exports, Request, Response, Date,
    console: { log() {}, warn() {}, error() {} }, Deno: { env: { get: () => '' } },
    require: () => ({ createClientFromRequest: () => db }),
  });
  const result = await module.exports.default(new Request('https://test.invalid/monitor', { method: 'POST', body: '{}' }));
  return result.json();
}
test('Actual read-only monitor cannot call a receipt-paid order healthy with unfinished handoff', async () => {
  const f = fixture(); let result = await monitor(f.order);
  assert.equal(result.overall, 'issues_detected'); assert.ok(result.orders.failed_items[0].issues.includes('reward_handoff_pending'));
  f.order.reward_handoff_status = 'review_required'; result = await monitor(f.order);
  assert.ok(result.orders.failed_items[0].issues.includes('reward_handoff_review_required'));
  f.order.reward_handoff_status = 'complete'; result = await monitor(f.order);
  assert.ok(result.orders.failed_items[0].issues.includes('reward_handoff_evidence_incomplete'));
  await f.run(); result = await monitor(f.order); assert.equal(result.overall, 'all_clear');
  f.order.reward_handoff.steps.confirmation_email.receipt = {
    outcome: 'skipped', reason: 'internal_secret_missing', evidence_id: 'synthetic:bad-skip',
  };
  result = await monitor(f.order); assert.equal(result.overall, 'issues_detected');
  assert.ok(result.orders.failed_items[0].issues.includes('reward_handoff_evidence_incomplete'));
});

let passed = 0;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`Reward handoff recovery: ${passed}/${tests.length}; local storage/adapters only, not provider delivery or production atomicity.`);
