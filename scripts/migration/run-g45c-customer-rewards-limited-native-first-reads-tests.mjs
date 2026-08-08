#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = process.cwd();
const functionPath = path.join(repoRoot, 'base44/functions/getCustomerAccountDashboardData/handlers/getCustomerAccountDashboardData/entry.ts');
const source = fs.readFileSync(functionPath, 'utf8');

function loadHarness(env = {}) {
  const sandbox = {
    console,
    Response,
    setTimeout,
    Deno: {
      env: { get: name => env[name] || '' },
      serve: () => { throw new Error('unexpected Deno.serve in consolidated handler'); },
    },
    createClientFromRequest: req => req.__base44,
  };
  const runnable = source
    .replace("import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';", '')
    .replace('export default async function handler(req: Request)', 'globalThis.__handler = async function handler(req)');
  vm.runInNewContext(runnable, sandbox, { filename: functionPath });
  return { handler: sandbox.__handler, sandbox };
}

function points(overrides = {}) {
  return {
    id: overrides.id || 'points_owner',
    customer_email: overrides.customer_email || 'owner@example.test',
    total_points: overrides.total_points ?? 100,
    lifetime_points: overrides.lifetime_points ?? 150,
    redeemed_points: overrides.redeemed_points ?? 50,
    current_tier: overrides.current_tier || 'Seedling',
    description: overrides.description || 'customer-visible points account',
    points_history: overrides.points_history ?? [
      { amount: 125, type: 'earned', timestamp: '2026-06-01T10:00:00.000Z', idempotency_key: 'earn_1', description: 'Order points' },
      { amount: -25, type: 'redeemed', timestamp: '2026-06-02T10:00:00.000Z', idempotency_key: 'redeem_1', description: 'Reward redemption' },
    ],
    claimed_rewards: overrides.claimed_rewards || [{ reward_id: 'reward_1', reward_title: 'Free Wellness Shot', claimed_at: '2026-06-01T10:00:00.000Z' }],
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

function subscription(overrides = {}) {
  return {
    id: overrides.id || 'sub_owner',
    customer_email: overrides.customer_email || 'owner@example.test',
    status: overrides.status || 'active',
    stripe_subscription_id: overrides.stripe_subscription_id || 'sub_fixture',
    created_date: overrides.created_date || '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: overrides.id || 'order_owner',
    customer_email: overrides.customer_email || 'owner@example.test',
    order_number: overrides.order_number || 'NV-LOYALTY1',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    payment_captured: overrides.payment_captured ?? true,
    is_abandoned_checkout: overrides.is_abandoned_checkout ?? false,
    is_test_order: overrides.is_test_order ?? false,
    total_amount: overrides.total_amount ?? 42,
    line_items: overrides.line_items || [{ title: 'Juice', quantity: 1, price: 42 }],
    created_date: overrides.created_date || '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function credit(overrides = {}) {
  return {
    id: overrides.id || 'credit_owner',
    customer_email: overrides.customer_email || 'owner@example.test',
    balance: overrides.balance ?? 5,
    lifetime_issued: overrides.lifetime_issued ?? 10,
    lifetime_used: overrides.lifetime_used ?? 5,
    ...overrides,
  };
}

function notification(overrides = {}) {
  return {
    id: overrides.id || 'notification_owner',
    customer_email: overrides.customer_email || 'owner@example.test',
    is_read: overrides.is_read ?? false,
    created_date: overrides.created_date || '2026-06-01T00:00:00.000Z',
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

function makeBase44({
  user = { role: 'customer', email: 'owner@example.test' },
  userProfiles = [profile()],
  subscriptions = [subscription()],
  orders = [order()],
  credits = [credit()],
  userPoints = [points()],
  rewardTiers = [reward()],
  notifications = [notification()],
  calls = [],
  writes = [],
} = {}) {
  const data = {
    UserProfile: userProfiles,
    Subscription: subscriptions,
    Order: orders,
    NuViraCredit: credits,
    UserPoints: userPoints,
    RewardTier: rewardTiers,
    Notification: notifications,
  };
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
  const entities = Object.fromEntries(Object.keys(data).map(name => [name, api(name)]));
  return {
    auth: { me: async () => user },
    asServiceRole: { entities },
  };
}

function request(base44) {
  return {
    method: 'POST',
    headers: { get: () => '' },
    text: async () => JSON.stringify({}),
    __base44: base44,
  };
}

const enabledEnv = {
  ENABLE_CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_READS: 'true',
  CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_KILL_SWITCH: 'false',
  CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_USER_POINTS_ALLOWLIST: 'points_owner',
};

async function invoke(options = {}) {
  const calls = [];
  const writes = [];
  const { handler, sandbox } = loadHarness(options.env || {});
  const base44 = makeBase44({ ...options, calls, writes });
  const response = await handler(request(base44));
  return { status: response.status, json: await response.json(), calls, writes, sandbox };
}

function loyaltySubset(json) {
  return {
    loyalty_points: json.loyalty_points,
    loyalty_lifetime: json.loyalty_lifetime,
    loyalty_redeemed: json.loyalty_redeemed,
    points_record: json.points_record,
  };
}

function nonLoyaltySubset(json) {
  return {
    subscription_count: json.subscription_count,
    order_count: json.order_count,
    credits: json.credits,
    lifetime_credits: json.lifetime_credits,
    applied_credits: json.applied_credits,
    notifications_unread_count: json.notifications_unread_count,
    all_orders_raw: json.all_orders_raw,
    orders: json.orders,
  };
}

function assertCurrentFallbackLoyalty(json) {
  assert.equal(json.points_record?.id, 'points_owner');
  assert.equal(json.points_record?.customer_email, 'owner@example.test');
  assert.ok(Array.isArray(json.points_record?.points_history));
  assert.ok(Array.isArray(json.points_record?.claimed_rewards));
}

function assertSanitizedLoyalty(json) {
  assert.equal(json.points_record?.total_points, json.loyalty_points);
  assert.equal(json.points_record?.lifetime_points, json.loyalty_lifetime);
  assert.equal(json.points_record?.redeemed_points, json.loyalty_redeemed);
  assert.equal(Object.hasOwn(json.points_record, 'customer_email'), false);
  assert.equal(Object.hasOwn(json.points_record, 'points_history'), false);
  assert.equal(Object.hasOwn(json.points_record, 'claimed_rewards'), false);
  assert.equal(Object.hasOwn(json.points_record, 'id'), false);
}

function assertNoG45CDiagnostics(json) {
  const serialized = JSON.stringify(loyaltySubset(json));
  for (const forbidden of [
    'native_primary_eligible',
    'balance_history_consistent',
    'fallback_reason',
    'review_required',
    'source_of_truth',
    'repair_replay_hold',
    'limited_native_rewards_read_selected',
    'eligibility_failed',
    'UserPoints',
    'owner@example.test',
    'points_history',
    'claimed_rewards',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked in loyalty payload`);
  }
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('feature disabled preserves current Rewards response', async () => {
  const result = await invoke();
  assert.equal(result.status, 200);
  assertCurrentFallbackLoyalty(result.json);
  assert.equal(result.calls.some(call => call.entity === 'RewardTier'), false);
});

test('kill switch preserves current response', async () => {
  const baseline = await invoke();
  const result = await invoke({ env: { ...enabledEnv, CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_KILL_SWITCH: 'true' } });
  assert.deepEqual(loyaltySubset(result.json), loyaltySubset(baseline.json));
});

test('nonallowlisted account preserves fallback', async () => {
  const baseline = await invoke();
  const result = await invoke({ env: { ...enabledEnv, CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_USER_POINTS_ALLOWLIST: 'points_other' } });
  assert.deepEqual(loyaltySubset(result.json), loyaltySubset(baseline.json));
});

test('ownership filtering precedes allowlist evaluation', async () => {
  const result = await invoke({
    env: { ...enabledEnv, CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_USER_POINTS_ALLOWLIST: 'points_other' },
    userPoints: [points(), points({ id: 'points_other', customer_email: 'other@example.test', total_points: 999, lifetime_points: 999, redeemed_points: 0, points_history: [{ amount: 999, type: 'earned' }] })],
  });
  assert.equal(result.json.points_record?.id, 'points_owner');
  assert.equal(JSON.stringify(loyaltySubset(result.json)).includes('points_other'), false);
  assert.equal(JSON.stringify(loyaltySubset(result.json)).includes('999'), false);
});

test('cross-customer account cannot be returned', async () => {
  const result = await invoke({
    env: { ...enabledEnv, CUSTOMER_REWARDS_LIMITED_NATIVE_FIRST_USER_POINTS_ALLOWLIST: 'points_other' },
    userPoints: [points(), points({ id: 'points_other', customer_email: 'other@example.test', total_points: 999, lifetime_points: 999, redeemed_points: 0, points_history: [{ amount: 999, type: 'earned' }] })],
  });
  assert.notEqual(result.json.points_record?.total_points, 999);
  assert.equal(JSON.stringify(result.json.points_record).includes('other@example.test'), false);
});

test('exact safe account receives native balance', async () => {
  const result = await invoke({ env: enabledEnv });
  assert.equal(result.json.loyalty_points, 100);
  assert.equal(result.json.loyalty_lifetime, 150);
  assert.equal(result.json.loyalty_redeemed, 50);
  assertSanitizedLoyalty(result.json);
});

test('exact safe account receives native tier', async () => {
  const row = points({ total_points: 700, lifetime_points: 750, redeemed_points: 50, current_tier: 'Silver', points_history: [{ amount: 725, type: 'earned', idempotency_key: 'earn' }, { amount: -25, type: 'redeemed', idempotency_key: 'redeem' }] });
  const result = await invoke({ env: enabledEnv, userPoints: [row] });
  assert.equal(result.json.points_record.current_tier, 'Silver');
});

test('tier progress remains compatible', async () => {
  const row = points({ total_points: 700, lifetime_points: 750, redeemed_points: 50, current_tier: 'Silver', points_history: [{ amount: 725, type: 'earned', idempotency_key: 'earn' }, { amount: -25, type: 'redeemed', idempotency_key: 'redeem' }] });
  const result = await invoke({ env: enabledEnv, userPoints: [row] });
  assert.equal(result.json.points_record.points_to_next_tier, 300);
  assert.equal(result.json.points_record.tier_progress_percent, 40);
});

test('deterministic native catalog displays safely', async () => {
  const result = await invoke({ env: enabledEnv, rewardTiers: [reward({ title: 'Free Bottle', points_required: 1000 })] });
  assertSanitizedLoyalty(result.json);
  assert.equal(result.calls.some(call => call.entity === 'RewardTier' && call.filter?.is_active === true), true);
});

test('inactive or expired rewards are excluded', async () => {
  const result = await invoke({ env: enabledEnv, rewardTiers: [reward({ id: 'active', is_active: true }), reward({ id: 'inactive', is_active: false })] });
  const rewardTierCalls = result.calls.filter(call => call.entity === 'RewardTier');
  assert.equal(rewardTierCalls.length, 1);
  assert.equal(rewardTierCalls[0].filter?.is_active, true);
  assertSanitizedLoyalty(result.json);
});

test('duplicate loyalty identity preserves fallback', async () => {
  const result = await invoke({ env: enabledEnv, userPoints: [points({ id: 'points_owner' }), points({ id: 'points_second' })] });
  assertCurrentFallbackLoyalty(result.json);
});

test('invalid negative balance preserves fallback', async () => {
  const result = await invoke({ env: enabledEnv, userPoints: [points({ total_points: -1, lifetime_points: 10, redeemed_points: 0, points_history: [{ amount: -1, type: 'redeemed' }] })] });
  assertCurrentFallbackLoyalty(result.json);
});

test('balance history mismatch preserves fallback', async () => {
  const result = await invoke({ env: enabledEnv, userPoints: [points({ total_points: 120 })] });
  assertCurrentFallbackLoyalty(result.json);
});

test('tier mismatch preserves fallback', async () => {
  const row = points({ total_points: 700, lifetime_points: 750, redeemed_points: 50, current_tier: 'Gold', points_history: [{ amount: 725, type: 'earned', idempotency_key: 'earn' }, { amount: -25, type: 'redeemed', idempotency_key: 'redeem' }] });
  const result = await invoke({ env: enabledEnv, userPoints: [row] });
  assertCurrentFallbackLoyalty(result.json);
});

test('repair replay hold preserves fallback', async () => {
  const result = await invoke({ env: enabledEnv, userPoints: [points({ description: 'repair replay pending review' })] });
  assertCurrentFallbackLoyalty(result.json);
});

test('Hub context unavailable does not become parity', async () => {
  const result = await invoke({ env: enabledEnv });
  assert.equal(JSON.stringify(loyaltySubset(result.json)).includes('hub_loyalty_context_available'), false);
  assert.equal(JSON.stringify(loyaltySubset(result.json)).includes('parity'), false);
});

test('localStorage remains client only and non authoritative', async () => {
  const result = await invoke({ env: enabledEnv });
  assert.equal(JSON.stringify(result.json).includes('localStorage'), false);
  assert.equal(JSON.stringify(result.json).includes('server_authoritative_reward_state'), false);
});

test('no customer-visible G45C diagnostics', async () => {
  const result = await invoke({ env: enabledEnv });
  assertNoG45CDiagnostics(result.json);
});

test('no raw history or loyalty PII in enabled native read payload', async () => {
  const result = await invoke({ env: enabledEnv });
  assertSanitizedLoyalty(result.json);
  assertNoG45CDiagnostics(result.json);
});

test('no point mutation', async () => {
  const result = await invoke({ env: enabledEnv });
  assert.equal(result.writes.length, 0);
});

test('no reward redemption', async () => {
  const result = await invoke({ env: enabledEnv });
  assert.equal(result.calls.some(call => /claim|redeem/i.test(call.entity)), false);
  assert.equal(result.writes.length, 0);
});

test('no referral creation', async () => {
  const result = await invoke({ env: enabledEnv });
  assert.equal(result.calls.some(call => /referral/i.test(call.entity)), false);
  assert.equal(result.writes.length, 0);
});

test('no provider calls', async () => {
  const result = await invoke({ env: enabledEnv });
  assert.equal(result.calls.some(call => ['Stripe', 'Shopify', 'Hub'].includes(call.entity)), false);
});

test('no notifications sent', async () => {
  const result = await invoke({ env: enabledEnv });
  assert.equal(result.calls.some(call => call.entity === 'Notification' && call.method !== 'filter'), false);
  assert.equal(result.writes.length, 0);
});

test('no Hub mutation', async () => {
  const result = await invoke({ env: enabledEnv });
  assert.equal(result.calls.some(call => call.entity === 'Hub'), false);
  assert.equal(result.writes.length, 0);
});

test('non loyalty dashboard fields remain unchanged', async () => {
  const baseline = await invoke();
  const result = await invoke({ env: enabledEnv });
  assert.deepEqual(nonLoyaltySubset(result.json), nonLoyaltySubset(baseline.json));
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
console.log(`G45C customer rewards limited native-first read tests passed (${passed}/${tests.length})`);
