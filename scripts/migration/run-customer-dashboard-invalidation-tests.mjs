#!/usr/bin/env node
// Exercise real invalidation helper/session guards with extracted UI callbacks.
// All persistence/payment/provider functions are synthetic; no external calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { timeoutManager } from '@tanstack/react-query';
import { createAuthSessionBoundary, guardSessionMutationOptions } from '../../src/lib/authQuerySession.js';
import { invalidateCustomerDashboard } from '../../src/lib/customerDashboardQueries.js';
import { classifyOrderConfirmation } from '../../src/lib/orderConfirmationState.js';

timeoutManager.setTimeoutProvider({
  setTimeout: (fn, delay) => setTimeout(fn, delay).unref(), clearTimeout,
  setInterval: (fn, delay) => setInterval(fn, delay).unref(), clearInterval,
});
const checks = [];
const clients = new Set();
const noop = () => {};
const flush = () => new Promise(resolve => setImmediate(resolve));
const read = file => fs.readFileSync(file, 'utf8');
const clean = value => JSON.parse(JSON.stringify(value));
function session(effects = []) {
  const boundary = createAuthSessionBoundary();
  const client = boundary.getSession().client;
  clients.add(client);
  client.invalidateQueries = async request => effects.push(['invalidate', clean(request.queryKey)]);
  return { client, retire() {
    const next = boundary.transition({ id: 'next', email: 'next@example.test' });
    clients.add(next.client);
    next.client.invalidateQueries = async () => effects.push(['new-principal-invalidated']);
  } };
}
function callback(source, start, end, name, context) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin);
  assert.ok(begin >= 0 && finish > begin, name);
  return vm.runInNewContext(`${source.slice(begin, finish)}\n${name};`, context);
}
async function test(name, work) { await work(); checks.push(name); }

try {
  await test('profile avatar and notifications invalidate on settlement, while retired callbacks cannot touch either principal', async () => {
    for (const file of ['src/components/account/ProfileAvatar.jsx', 'src/pages/Notifications.jsx']) {
      const source = read(file);
      assert.match(source, /useSessionMutation as useMutation/);
      const callbacks = [...source.matchAll(/onSettled:\s*(\(\)\s*=>\s*\{[\s\S]*?\}),/g)];
      assert.equal(callbacks.length, file.includes('ProfileAvatar') ? 2 : 1);
      for (const match of callbacks) {
        const effects = [];
        const current = session(effects);
        const onSettled = vm.runInNewContext(`(${match[1]})`, {
          queryClient: current.client, queryKey: ['notifications', 'buyer@example.test'], invalidateCustomerDashboard,
        });
        const guarded = guardSessionMutationOptions(current.client, { onSettled });
        await guarded.onSettled();
        await flush();
        assert.ok(effects.some(effect => effect[1]?.[0] === 'account-dashboard'));
        if (file.includes('Notifications')) assert.ok(effects.some(effect => effect[1]?.[0] === 'notifications'));
        effects.length = 0;
        current.retire();
        await guarded.onSettled();
        await flush();
        assert.deepEqual(effects, []);
      }
    }
  });

  await test('settings invalidation covers successful profile/auth writes and ambiguous write failures, never a failed preliminary read', async () => {
    const source = read('src/pages/AccountSettings.jsx');
    for (const outcome of ['success', 'create', 'profile-error', 'auth-error', 'read-error', 'retired-after-write']) {
      const effects = [];
      const current = session(effects);
      const profileWrite = async () => {
        effects.push(['profile-write']);
        if (outcome === 'retired-after-write') current.retire();
        if (outcome === 'profile-error') throw new Error('ambiguous write');
      };
      const save = callback(source, '  const handleSave =', '  const handleDeleteAccount =', 'handleSave', {
        form: { firstName: 'Buyer', lastName: 'Example', phone: '', birthday: '', address: {} },
        user: { email: 'buyer@example.test' }, queryClient: current.client, invalidateCustomerDashboard,
        setIsSaving: noop, setSaveSuccess: noop, setTimeout: noop,
        base44: { entities: { UserProfile: {
          filter: async () => {
            if (outcome === 'read-error') throw new Error('read failed');
            return outcome === 'create' ? [] : [{ id: 'profile-fixture' }];
          }, update: profileWrite, create: profileWrite,
        } }, auth: { updateMe: async () => {
          effects.push(['auth-write']);
          if (outcome === 'auth-error') throw new Error('auth write failed');
        } } },
        refreshUser: async () => effects.push(['refresh-user']),
        console: { error: noop }, toast: { error: noop },
      });
      await save();
      await flush();
      const invalidations = effects.filter(effect => effect[0] === 'invalidate');
      assert.equal(invalidations.length, ['read-error', 'retired-after-write'].includes(outcome) ? 0 : 1, outcome);
      assert.equal(effects.some(effect => effect[0] === 'new-principal-invalidated'), false);
      if (['success', 'create'].includes(outcome)) assert.ok(effects.some(effect => effect[0] === 'refresh-user'));
    }
  });

  await test('Rewards shares raw dashboard data and refreshes attempted claims including picker returns and ambiguous failures', async () => {
    const source = read('src/pages/Rewards.jsx');
    assert.match(source, /useQuery\(customerDashboardQueryOptions\(base44, user\)\)/);
    assert.doesNotMatch(source, /getCustomerAccountDashboardData|staleTime: 60 \* 1000/);
    for (const outcome of ['picker', 'non-picker', 'failed', 'changed-email', 'retired']) {
      const effects = [];
      const current = session(effects);
      const email = 'buyer@example.test';
      const reward = { id: 'fixture-reward', title: 'Fixture', reward_type: 'free_bottle' };
      const apply = callback(source, '  const handleApplyReward =', '  const handleFreeProductSelect =', 'handleApplyReward', {
        user: { email }, currentEmailRef: { current: outcome === 'changed-email' ? 'other@example.test' : email },
        queryClient: current.client, invalidateCustomerDashboard: client => {
          effects.push(['invalidate-request']);
          return invalidateCustomerDashboard(client);
        },
        rewardSelectionRef: { current: false }, setIsSelectingReward: noop,
        selectActiveReward: async () => {
          if (outcome === 'failed') throw new Error('selection rejected');
          if (outcome === 'retired') current.retire();
          return reward;
        },
        rewardSelectionCount: () => outcome === 'non-picker' ? 0 : 1,
        setPendingReward: () => effects.push(['pending']), setPickerOpen: () => effects.push(['picker']),
        localStorage: { setItem: () => effects.push(['stored']) },
        clearEarnedRewardItems: () => effects.push(['cart']), setActiveReward: noop,
        trackGoogleRetentionEvent: noop, toast: { success: noop, error: noop },
      });
      await apply(reward);
      await flush();
      const invalidations = effects.filter(effect => effect[0] === 'invalidate');
      assert.equal(invalidations.length, ['picker', 'non-picker', 'failed'].includes(outcome) ? 1 : 0, outcome);
      if (outcome === 'picker') {
        assert.deepEqual(effects, [['pending'], ['picker'], ['invalidate-request'], ['invalidate', ['account-dashboard']]]);
      }
      assert.equal(effects.some(effect => effect[0] === 'new-principal-invalidated'), false);
    }
  });

  await test('read-only reward picker validation does not invalidate dashboard data', async () => {
    const source = read('src/pages/Rewards.jsx');
    for (const outcome of ['success', 'failed', 'changed-email', 'retired']) {
      const effects = [];
      const current = session(effects);
      const reward = { id: 'fixture-reward', title: 'Fixture', reward_type: 'free_bottle' };
      const email = 'buyer@example.test';
      const select = callback(source, '  const handleFreeProductSelect =', '  const handleRemoveReward =', 'handleFreeProductSelect', {
        pendingReward: reward, user: { email }, currentEmailRef: { current: outcome === 'changed-email' ? 'other@example.test' : email },
        queryClient: current.client, invalidateCustomerDashboard,
        selectActiveReward: async (_reward, _email, options) => {
          assert.equal(options.validateOnly, true);
          if (outcome === 'failed') throw new Error('invalid choice');
          if (outcome === 'retired') current.retire();
          return reward;
        },
        earnedRewardCartItems: noop, localStorage: { setItem: noop }, setEarnedRewardSelection: noop,
        setActiveReward: noop, setPickerOpen: noop, setPendingReward: noop,
        trackGoogleRetentionEvent: noop, toast: { success: noop }, navigate: noop,
      });
      if (['failed', 'changed-email'].includes(outcome)) await assert.rejects(() => select([]));
      else await select([]);
      await flush();
      assert.equal(effects.filter(effect => effect[0] === 'invalidate').length, 0);
      assert.equal(effects.some(effect => effect[0] === 'new-principal-invalidated'), false);
    }
  });

  await test('confirmation invalidates accepted paid readback once per order, not URL/session status or pending/rejected data', async () => {
    const source = read('src/pages/OrderConfirmation.jsx');
    const start = source.indexOf('    // `order` is populated only');
    const end = source.indexOf('  }, [order, queryClient]);', start);
    assert.ok(start > 0 && end > start);
    const body = source.slice(start, end);
    const effects = [];
    const current = session(effects);
    const context = {
      order: null, queryClient: current.client, invalidateCustomerDashboard, classifyOrderConfirmation,
      dashboardOrdersInvalidatedRef: { current: new Set() },
      sessionId: 'cs_url_only', orderNumber: 'NV-URL-ONLY', paymentOk: true,
    };
    const run = () => vm.runInNewContext(`(() => { ${body} })()`, context);
    for (const order of [null, {}, { id: 'fixture', total: 39, status: 'pending_payment', payment_status: 'paid' },
      { id: 'fixture', total: 39, status: 'cancelled', payment_status: 'paid' },
      { id: 'fixture', total: 0, status: 'confirmed', payment_status: 'paid' }]) {
      context.order = order; run();
    }
    await flush();
    assert.deepEqual(effects, []);
    context.order = { id: 'paid-fixture', order_number: 'NV-FIXTURE', total: 39, payment_status: 'paid', status: 'confirmed' };
    run(); run();
    context.order = { ...context.order }; run();
    await flush();
    assert.deepEqual(effects, [['invalidate', ['account-dashboard']]]);
    context.order = { ...context.order, id: 'second-fixture' }; run();
    await flush();
    assert.equal(effects.length, 2);
    current.retire();
    context.order = { ...context.order, id: 'late-fixture' }; run();
    await flush();
    assert.equal(effects.length, 2);
    // Keep invalidation separate from purchase analytics and the existing four
    // accepted order readback branches; nothing changes receipt authority.
    assert.equal((source.match(/setOrder\((?:data\.order|o|orders\[0\])\)/g) || []).length, 4);
    assert.ok(end < source.indexOf('const trackPurchase ='));
  });
} finally {
  clients.forEach(client => client.clear());
}
console.log(JSON.stringify({ ok: true, suite: 'customer-dashboard-invalidations', checks, provider_calls: 0, production_writes: 0 }, null, 2));
