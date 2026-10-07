#!/usr/bin/env node
// Real QueryObservers, synthetic API responses only. Never reads customer data.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { QueryObserver, timeoutManager } from '@tanstack/react-query';
import { createQueryClient } from '../../src/lib/query-client.js';
import { createAuthSessionBoundary } from '../../src/lib/authQuerySession.js';
import * as dashboard from '../../src/lib/customerDashboardQueries.js';

timeoutManager.setTimeoutProvider({
  setTimeout: (fn, ms) => setTimeout(fn, ms).unref(), clearTimeout,
  setInterval: (fn, ms) => setInterval(fn, ms).unref(), clearInterval,
});
const user = { id: 'synthetic-a', email: 'a@example.test' };
const checks = [];
const clients = new Set();
const mounts = new Set();
const noop = () => {};
const flush = () => new Promise(resolve => setImmediate(resolve));
const read = path => fs.readFileSync(path, 'utf8');
function client() { const value = createQueryClient(); clients.add(value); return value; }
function mount(cache, options) {
  const observer = new QueryObserver(cache, options);
  const unsubscribe = observer.subscribe(noop);
  const value = { observer, stop: () => { unsubscribe(); mounts.delete(value); } };
  mounts.add(value);
  return value;
}
async function settle(value) {
  for (let i = 0; i < 25; i++) {
    if (value.observer.getCurrentResult().fetchStatus === 'idle') return;
    await flush();
  }
  assert.fail('Synthetic query did not settle');
}
function api() {
  const calls = [];
  const value = { calls, functions: { invoke: async (name, args) => {
    calls.push({ name, args });
    return { data: {
      revision: calls.length, customer_profile: { id: 'profile-a' },
      all_orders_raw: [{ id: 'paid-a', status: 'order_received', payment_status: 'paid' }],
      all_subscriptions: [{ id: 'sub-a', status: 'cancelled' }],
      points_record: { total_points: 200 },
    } };
  } } };
  return value;
}
function deferredApi() {
  const pending = [];
  return { pending, functions: { invoke: () => new Promise(resolve => pending.push(resolve)) } };
}
function subscriptionText({ rows = [], loading = false, error = false } = {}) {
  const elements = [];
  const react = {
    createElement: (type, props, ...children) => {
      elements.push(children); return { type, props, children };
    },
    useState: value => [value, noop], useEffect: noop, useRef: value => ({ current: value }),
  };
  const imports = {
    '@/components/CustomerDialog': { default: noop },
    react: { ...react, default: react },
    '@/api/base44Client': { base44: {} },
    '@/lib/AuthContext': { useAuth: () => ({ user }) },
    '@/lib/customerDashboardQueries': dashboard,
    '@tanstack/react-query': { useQueryClient: () => ({}), useQuery: options => ({
      data: options.queryKey[0] === 'account-dashboard' ? rows : [],
      isLoading: options.queryKey[0] === 'account-dashboard' && loading,
      isError: options.queryKey[0] === 'account-dashboard' && error,
      refetch: noop,
    }) },
    'react-router-dom': { Link: noop },
    'lucide-react': new Proxy({}, { get: () => noop }),
    '@/components/ui/button': { Button: noop },
    'framer-motion': { motion: new Proxy({}, { get: () => noop }), AnimatePresence: noop },
    sonner: { toast: {} },
  };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(read('src/pages/SubscriptionManagement.jsx'), { loader: 'jsx', format: 'cjs' }).code, {
    module, exports: module.exports,
    require: name => {
      assert.ok(imports[name], `unmocked import ${name}`);
      return { __esModule: true, ...imports[name] };
    },
  });
  module.exports.default();
  return JSON.stringify(elements);
}

try {
  const reads = api();
  const cache = client();
  const options = dashboard.customerDashboardQueryOptions(reads, user);
  assert.deepEqual(options.queryKey, ['account-dashboard', user.email]);
  assert.equal(options.staleTime, 30000);
  assert.equal(options.refetchOnMount, true);
  assert.equal(createQueryClient().getDefaultOptions().queries.refetchOnMount, 'always');
  const account = mount(cache, options);
  await settle(account);
  const raw = account.observer.getCurrentResult().data;
  account.stop();
  for (const select of [dashboard.customerDashboardOrders, undefined, dashboard.customerDashboardSubscriptions, undefined]) {
    const page = mount(cache, { ...options, select });
    assert.equal(page.observer.getCurrentResult().isFetching, false);
    assert.deepEqual(page.observer.getCurrentResult().data, select ? select(raw) : raw);
    page.stop();
  }
  assert.equal(reads.calls.length, 1, 'Account→Orders→Rewards→Subscriptions→Wallet reuses one read');
  assert.equal(cache.getQueryData(options.queryKey), raw, 'selectors never replace raw cache shape');
  assert.deepEqual(reads.calls[0], { name: 'getCustomerAccountDashboardData', args: {} });
  checks.push('one full raw read reused across five consumers for 30s; unchanged function contract');

  const orders = mount(cache, { ...options, select: dashboard.customerDashboardOrders });
  await orders.observer.refetch();
  assert.equal(reads.calls.length, 2, 'explicit refresh works while fresh');
  await dashboard.invalidateCustomerDashboard(cache);
  assert.equal(reads.calls.length, 3, 'write invalidation refetches active consumer');
  assert.equal(cache.getQueryData(options.queryKey).revision, 3);
  orders.stop();
  cache.setQueryData(options.queryKey, raw, { updatedAt: Date.now() - 31000 });
  const stale = mount(cache, options);
  assert.deepEqual(stale.observer.getCurrentResult().data, raw, 'stale data remains visible during refresh');
  await settle(stale);
  assert.equal(reads.calls.length, 4);
  stale.stop();
  await dashboard.invalidateCustomerDashboard(cache, { refetchType: 'none' });
  assert.equal(reads.calls.length, 4, 'checkout entry starts no read');
  const returned = mount(cache, options);
  await settle(returned);
  assert.equal(reads.calls.length, 5, 'return from checkout refreshes even inside 30s');
  returned.stop();
  checks.push('explicit refresh, active write invalidation, stale navigation and checkout return');

  const slow = deferredApi();
  const slowCache = client();
  const slowOptions = dashboard.customerDashboardQueryOptions(slow, user);
  const first = mount(slowCache, slowOptions);
  const second = mount(slowCache, { ...slowOptions, select: dashboard.customerDashboardOrders });
  assert.equal(slow.pending.length, 1, 'in-flight reads deduplicate');
  await dashboard.invalidateCustomerDashboard(slowCache, { refetchType: 'none' });
  slow.pending[0]({ data: { revision: 'pre-reservation', all_orders_raw: [] } });
  await flush();
  assert.equal(slowCache.getQueryData(slowOptions.queryKey), undefined);
  assert.equal(slowCache.getQueryState(slowOptions.queryKey).isInvalidated, true);
  // The destination can mount before checkout's passive cleanup. Active exit
  // invalidation must restart it rather than strand the page pending+idle.
  const exit = dashboard.invalidateCustomerDashboard(slowCache);
  await flush();
  assert.equal(slow.pending.length, 2);
  slow.pending[1]({ data: { revision: 'post-reservation', all_orders_raw: [{ id: 'new' }] } });
  await exit;
  assert.equal(first.observer.getCurrentResult().data.revision, 'post-reservation');
  assert.deepEqual(second.observer.getCurrentResult().data, [{ id: 'new' }]);
  first.stop(); second.stop();
  checks.push('slow pre-mutation response discarded; already-mounted destination restarts correctly');

  const boundary = createAuthSessionBoundary();
  clients.add(boundary.getSession().client);
  const a = boundary.transition(user).client; clients.add(a);
  const pendingA = deferredApi();
  const accountA = mount(a, dashboard.customerDashboardQueryOptions(pendingA, user));
  const b = boundary.transition({ id: 'synthetic-b', email: user.email }).client; clients.add(b);
  assert.notEqual(a, b, 'even equal emails with distinct IDs are isolated');
  b.setQueryData(options.queryKey, { revision: 'B' });
  await dashboard.invalidateCustomerDashboard(a);
  pendingA.pending[0]({ data: { revision: 'late-A' } });
  await flush();
  assert.equal(a.getQueryData(options.queryKey), undefined);
  assert.deepEqual(b.getQueryData(options.queryKey), { revision: 'B' });
  assert.equal(b.getQueryState(options.queryKey).isInvalidated, false);
  const signedOut = boundary.transition(null).client; clients.add(signedOut);
  assert.equal(signedOut.getQueryData(options.queryKey), undefined);
  accountA.stop();
  const guestApi = api();
  const guest = mount(signedOut, dashboard.customerDashboardQueryOptions(guestApi, null));
  await flush();
  assert.equal(guestApi.calls.length, 0);
  guest.stop();
  checks.push('session change and logout remove old data; late mutation/read cannot touch new principal; no guest fetch');

  const failed = mount(client(), dashboard.customerDashboardQueryOptions({ functions: { invoke: async () => {
    throw Object.assign(new Error('denied'), { status: 403 });
  } } }, user));
  await settle(failed);
  assert.equal(failed.observer.getCurrentResult().isError, true);
  assert.equal(failed.observer.getCurrentResult().data, undefined, 'denials cannot become cached empty success');
  failed.stop();
  assert.equal(dashboard.customerDashboardOrderPollInterval({ state: { data: raw } }), 60000);
  for (const status of ['delivered', 'picked_up', 'cancelled', 'refunded', 'failed']) {
    assert.equal(dashboard.customerDashboardOrderPollInterval({ state: { data: { all_orders_raw: [{ status }] } } }), false);
  }
  assert.equal(dashboard.customerDashboardOrderPollInterval({ state: {} }), false);
  checks.push('errors remain errors; active-order polling reads raw object and preserves terminal statuses');

  for (const file of ['src/pages/Account.jsx', 'src/pages/OrderHistory.jsx', 'src/pages/Rewards.jsx',
    'src/pages/SubscriptionManagement.jsx', 'src/components/account/CreditWallet.jsx']) {
    const source = read(file);
    assert.match(source, /customerDashboardQueryOptions\(base44, user\)/, `${file}: shared options wired`);
    assert.doesNotMatch(source, /invoke\('getCustomerAccountDashboardData'/, `${file}: no independent contract`);
  }
  assert.match(read('src/pages/OrderHistory.jsx'), /select: customerDashboardOrders/);
  assert.match(read('src/pages/OrderHistory.jsx'), /refetchInterval: customerDashboardOrderPollInterval/);
  assert.match(read('src/pages/SubscriptionManagement.jsx'), /select: customerDashboardSubscriptions/);
  assert.match(read('src/pages/SubscriptionManagement.jsx'), /refetch\(\{ cancelRefetch: false \}\)/);
  const checkout = read('src/pages/Checkout.jsx');
  assert.match(checkout, /invalidateCustomerDashboard\(dashboardQueryClient, \{ refetchType: 'none' \}\)/);
  assert.match(checkout, /return \(\) => \{ void invalidateCustomerDashboard\(dashboardQueryClient\); \}/);
  checks.push('actual customer page selectors, polling and checkout entry/exit are wired to shared policy');

  assert.match(subscriptionText({ rows: [{ id: 'old', status: 'cancelled' }] }), /No active subscriptions/);
  assert.match(subscriptionText(), /No active subscriptions/);
  assert.doesNotMatch(subscriptionText({ loading: true }), /No active subscriptions/);
  assert.doesNotMatch(subscriptionText({ error: true }), /No active subscriptions/);
  assert.match(subscriptionText({ error: true }), /couldn’t refresh your subscriptions/);
  assert.doesNotMatch(read('src/pages/SubscriptionManagement.jsx'), /toast.success\('Payment received/);
  checks.push('actual subscription component renders cancelled-only empty state and truthful error/loading/return states');
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, results: checks }, null, 2));
} finally {
  for (const mounted of mounts) mounted.stop();
  for (const cache of clients) cache.clear();
}
