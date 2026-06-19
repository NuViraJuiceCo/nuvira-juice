#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = process.cwd();
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');
const source = fs.readFileSync(functionPath, 'utf8');

function loadHarness(env = {}) {
  let handler;
  const sandbox = {
    console,
    Response,
    setTimeout,
    Deno: {
      env: { get: name => env[name] || '' },
      serve: fn => { handler = fn; },
    },
    createClientFromRequest: req => req.__base44,
  };
  const runnable = source.replace("import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';", '');
  vm.runInNewContext(runnable, sandbox, { filename: functionPath });
  return { handler };
}

function points(overrides = {}) {
  return {
    id: overrides.id || 'points_clean',
    customer_email: overrides.customer_email || 'owner@example.test',
    total_points: overrides.total_points ?? 100,
    lifetime_points: overrides.lifetime_points ?? 150,
    redeemed_points: overrides.redeemed_points ?? 50,
    points_history: overrides.points_history ?? [
      { amount: 125, type: 'earned', timestamp: '2026-06-01T10:00:00.000Z', idempotency_key: 'earn_1', description: 'Order points' },
      { amount: -25, type: 'redeemed', timestamp: '2026-06-02T10:00:00.000Z', idempotency_key: 'redeem_1', description: 'Reward redemption' },
    ],
    claimed_rewards: overrides.claimed_rewards || [],
    ...overrides,
  };
}

function reward(overrides = {}) {
  return {
    id: overrides.id || 'reward_clean',
    title: overrides.title || 'Free Wellness Shot',
    description: overrides.description || 'Customer-visible reward',
    points_required: overrides.points_required ?? 100,
    reward_type: overrides.reward_type || 'free_bottle',
    is_active: overrides.is_active ?? true,
    sort_order: overrides.sort_order ?? 1,
    ...overrides,
  };
}

function profile(overrides = {}) {
  return {
    id: overrides.id || 'profile_owner',
    customer_email: overrides.customer_email || 'owner@example.test',
    contact_email: overrides.contact_email || 'owner@example.test',
    user_id: overrides.user_id || 'auth_owner',
    ...overrides,
  };
}

function sortRows(rows, sort = '-created_date') {
  const out = [...(rows || [])];
  if (sort === 'sort_order') out.sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  if (sort?.startsWith('-')) {
    const key = sort.slice(1);
    out.sort((a, b) => String(b?.[key] || '').localeCompare(String(a?.[key] || '')));
  }
  return out;
}

function exactFilter(rows, filter) {
  const entries = Object.entries(filter || {}).filter(([, value]) => value !== undefined && value !== null && value !== '');
  return (rows || []).filter(row => entries.every(([key, value]) => row?.[key] === value));
}

function makeBase44({ user = { role: 'admin', email: 'admin@example.test' }, userPoints = [points()], rewardTiers = [reward()], profiles = [profile()], calls = [], writes = [] } = {}) {
  const data = { UserPoints: userPoints, RewardTier: rewardTiers, UserProfile: profiles };
  const api = name => ({
    list: async (sort = '-created_date', limit = 50) => {
      calls.push({ entity: name, method: 'list', sort, limit });
      return sortRows(data[name] || [], sort).slice(0, limit || 50);
    },
    filter: async (filter = {}, sort = '-created_date', limit = 20) => {
      calls.push({ entity: name, method: 'filter', filter, sort, limit });
      return sortRows(exactFilter(data[name] || [], filter), sort).slice(0, limit || 20);
    },
    create: async row => { writes.push({ entity: name, method: 'create', row }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { writes.push({ entity: name, method: 'update', id, patch }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ entity: name, method: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    auth: { me: async () => user },
    asServiceRole: { entities: { UserPoints: api('UserPoints'), RewardTier: api('RewardTier'), UserProfile: api('UserProfile') } },
  };
}

function request(base44, body = {}) {
  return {
    method: body.__method || 'POST',
    headers: { get: () => '' },
    text: async () => JSON.stringify({
      preview_mode: 'CUSTOMER_LOYALTY_READ_PARITY',
      mode: 'EXACT_CUSTOMER_LOYALTY_PARITY',
      user_points_id: 'points_clean',
      request_id: 'g45b_fixture',
      ...body,
    }),
    __base44: base44,
  };
}

async function invoke(options = {}) {
  const calls = [];
  const writes = [];
  const { handler } = loadHarness(options.env || {});
  const base44 = makeBase44({ ...options, calls, writes });
  const response = await handler(request(base44, options.body || {}));
  return { status: response.status, json: await response.json(), calls, writes };
}

function summary(json, index = 0) {
  return (json.safe_subject_summaries || [])[index];
}

function assertNoUnsafePayload(json) {
  const serialized = JSON.stringify(json);
  for (const forbidden of ['owner@example.test', 'other@example.test', 'admin@example.test', 'customer_email', 'raw_hub', 'raw_shopify', 'raw_stripe', 'payment_method', 'full_address', 'Bearer ', 'sk_live_', 'phone_number']) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
  }
  assert.equal(json.pii_returned, false);
  assert.equal(json.raw_payloads_returned, false);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('missing admin auth returns 401', async () => {
  const result = await invoke({ user: null });
  assert.equal(result.status, 401);
  assert.equal(result.json.writes_performed, false);
});

test('exact UserPoints row resolves safely', async () => {
  const result = await invoke();
  assert.equal(result.status, 200);
  assert.equal(result.json.preview_mode, 'CUSTOMER_LOYALTY_READ_PARITY');
  assert.equal(result.json.mode, 'EXACT_CUSTOMER_LOYALTY_PARITY');
  assert.equal(result.json.user_points_present, true);
  assert.equal(result.json.exact_match_count, 1);
  assert.equal(summary(result.json).user_points_present, true);
});

test('duplicate UserPoints identity blocks readiness', async () => {
  const rows = [points({ id: 'points_a' }), points({ id: 'points_b' })];
  const result = await invoke({ userPoints: rows, body: { user_points_id: 'points_a' } });
  assert.equal(summary(result.json).duplicate_identity_risk, true);
  assert.ok(summary(result.json).blockers.includes('duplicate_loyalty_identity_risk'));
});

test('direct balance present', async () => {
  const result = await invoke();
  assert.equal(summary(result.json).native_balance_present, true);
  assert.equal(summary(result.json).direct_points_balance, 100);
});

test('reconstructable history matches balance', async () => {
  const result = await invoke();
  assert.equal(summary(result.json).history_reconstructable, true);
  assert.equal(summary(result.json).balance_history_consistent, true);
  assert.equal(result.json.balance_history_consistent_count, 1);
});

test('history mismatch is reported', async () => {
  const row = points({ total_points: 120 });
  const result = await invoke({ userPoints: [row] });
  assert.equal(summary(result.json).balance_history_mismatch, true);
  assert.ok(summary(result.json).blockers.includes('native_balance_history_mismatch'));
});

test('malformed history entry is reported safely', async () => {
  const row = points({ points_history: [{ amount: 'bad', type: 'earned' }] });
  const result = await invoke({ userPoints: [row] });
  assert.equal(summary(result.json).malformed_history_entry_count, 1);
  assert.equal(summary(result.json).history_reconstructable, false);
});

test('missing history does not imply zero balance', async () => {
  const row = points({ total_points: 55, points_history: [] });
  const result = await invoke({ userPoints: [row] });
  assert.equal(summary(result.json).direct_points_balance, 55);
  assert.equal(summary(result.json).history_reconstructable, false);
  assert.equal(summary(result.json).reconstructable_history_delta, 0);
});

test('stored and derived tier match', async () => {
  const row = points({ total_points: 700, lifetime_points: 700, current_tier: 'Silver' });
  const result = await invoke({ userPoints: [row] });
  assert.equal(summary(result.json).tier_match, true);
  assert.equal(summary(result.json).derived_tier_name, 'Silver');
});

test('tier mismatch requires review', async () => {
  const row = points({ total_points: 700, lifetime_points: 700, current_tier: 'Gold' });
  const result = await invoke({ userPoints: [row] });
  assert.equal(summary(result.json).tier_mismatch, true);
  assert.ok(summary(result.json).blockers.includes('tier_mismatch_manual_review'));
});

test('missing RewardTier definition holds as fallback catalog', async () => {
  const result = await invoke({ rewardTiers: [] });
  assert.equal(result.json.catalog_summary.fallback_catalog_active, true);
  assert.equal(summary(result.json).static_fallback_catalog_active, true);
});

test('native reward catalog ready', async () => {
  const result = await invoke({ rewardTiers: [reward({ points_required: 500 })] });
  assert.equal(result.json.catalog_summary.native_catalog_present, true);
  assert.equal(summary(result.json).native_catalog_ready, true);
});

test('DEFAULT_REWARDS fallback classified', async () => {
  const result = await invoke({ rewardTiers: [] });
  assert.equal(result.json.classification_counts.static_fallback_catalog_active >= 1, true);
});

test('inactive or expired reward excluded', async () => {
  const result = await invoke({ rewardTiers: [reward({ id: 'active', is_active: true }), reward({ id: 'inactive', is_active: false })] });
  assert.equal(result.json.catalog_summary.reward_catalog_native_count, 1);
  assert.equal(result.json.catalog_summary.inactive_reward_count, 1);
  assert.equal(result.json.catalog_summary.inactive_expired_rewards_excluded, true);
});

test('duplicate reward definition held', async () => {
  const rows = [reward({ id: 'a', title: 'Same', points_required: 100 }), reward({ id: 'b', title: 'Same', points_required: 100 })];
  const result = await invoke({ rewardTiers: rows });
  assert.equal(result.json.catalog_summary.duplicate_reward_definition_count, 1);
  assert.equal(summary(result.json).fallback_required, true);
});

test('Hub context unavailable does not imply parity', async () => {
  const result = await invoke();
  assert.equal(summary(result.json).hub_context_available, false);
  assert.equal(summary(result.json).hub_context_status, 'hub_loyalty_context_unavailable');
  assert.ok(summary(result.json).warnings.includes('hub_loyalty_context_unavailable'));
});

test('client localStorage state is not treated as authoritative', async () => {
  const result = await invoke();
  assert.equal(summary(result.json).client_reward_state_not_server_authoritative, true);
  assert.equal(result.json.client_reward_state_status, 'client_state_not_server_authoritative');
});

test('refund point uncertainty holds', async () => {
  const result = await invoke();
  assert.equal(summary(result.json).refund_points_source_of_truth_held, true);
  assert.equal(result.json.refund_reversal_ready, false);
});

test('subscription point uncertainty holds', async () => {
  const result = await invoke();
  assert.equal(summary(result.json).subscription_points_source_of_truth_held, true);
  assert.equal(result.json.subscription_points_ready, false);
});

test('POS point uncertainty holds', async () => {
  const result = await invoke();
  assert.equal(summary(result.json).pos_points_source_of_truth_held, true);
  assert.equal(result.json.pos_points_ready, false);
});

test('repair/replay evidence holds', async () => {
  const row = points({ description: 'repair replay pending review' });
  const result = await invoke({ userPoints: [row] });
  assert.ok(summary(result.json).blockers.includes('repair_replay_hold'));
  assert.equal(summary(result.json).classification, 'repair_replay_hold');
});

test('native-read candidate classified correctly', async () => {
  const result = await invoke();
  assert.equal(summary(result.json).native_read_eligibility, true);
  assert.equal(summary(result.json).classification, 'native_rewards_page_read_candidate');
  assert.equal(result.json.read_native_primary_candidate_count, 1);
});

test('redemption remains not ready', async () => {
  const result = await invoke();
  assert.equal(result.json.redemption_write_ready, false);
  assert.equal(summary(result.json).redemption_write_ready, false);
  assert.ok(summary(result.json).warnings.includes('redemption_write_not_ready'));
});

test('no PII returned', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
});

test('no raw payload returned', async () => {
  const result = await invoke();
  assert.equal(result.json.raw_payloads_returned, false);
  assertNoUnsafePayload(result.json);
});

test('no points mutation', async () => {
  const result = await invoke();
  assert.equal(result.json.point_mutation_performed, false);
  assert.equal(result.writes.length, 0);
});

test('no reward redemption', async () => {
  const result = await invoke();
  assert.equal(result.json.reward_redeemed, false);
  assert.equal(result.json.safety.reward_claim_invoked, false);
});

test('no provider calls', async () => {
  const result = await invoke();
  assert.equal(result.json.provider_call_impact, false);
});

test('no notifications', async () => {
  const result = await invoke();
  assert.equal(result.json.notifications_sent, false);
  assert.equal(result.json.notification_expansion_ready, false);
});

test('no Hub mutation', async () => {
  const result = await invoke();
  assert.equal(result.json.hub_mutation_performed, false);
  assert.equal(result.json.hub_write_suppression_ready, false);
});

test('no logs or queues created', async () => {
  const result = await invoke();
  assert.equal(result.json.command_log_created, false);
  assert.equal(result.writes.length, 0);
});

test('bounded scan uses one bounded read per source', async () => {
  const result = await invoke({ body: { mode: 'BOUNDED_LOYALTY_READINESS_SCAN', user_points_limit: 25, reward_tier_limit: 50 } });
  assert.equal(result.json.scan_complete, true);
  assert.equal(result.calls.filter(call => call.method === 'list').length, 2);
  assert.equal(result.calls.filter(call => call.method === 'filter').length, 0);
  assert.equal(result.json.source_read_strategy.per_loyalty_account_query_loop, false);
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
    break;
  }
}

if (process.exitCode) process.exit(process.exitCode);
console.log(`G45B customer loyalty read parity tests passed (${passed}/${tests.length})`);
