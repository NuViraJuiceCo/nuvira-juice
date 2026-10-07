#!/usr/bin/env node
// Execute real page query options and QueryObservers with synthetic data only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { QueryObserver, timeoutManager } from '@tanstack/react-query';
import { createQueryClient } from '../../src/lib/query-client.js';
import { createAuthSessionBoundary } from '../../src/lib/authQuerySession.js';
import * as catalog from '../../src/lib/publicCatalogQueries.js';

timeoutManager.setTimeoutProvider({
  setTimeout: (callback, delay) => setTimeout(callback, delay).unref(),
  clearTimeout,
  setInterval: (callback, delay) => setInterval(callback, delay).unref(),
  clearInterval,
});

const checks = [];
const clients = new Set();
const clean = value => JSON.parse(JSON.stringify(value));
const noop = () => {};
const fallback = [{ id: 'synthetic-existing-fallback', price: 7.25 }];
function syntheticReads(prefix = 'synthetic') {
  const calls = [];
  let mode = 'success';
  const read = (resource, filter, sort, limit) => {
    calls.push({ resource, filter: clean(filter), sort, limit });
    if (mode === 'error') return Promise.reject(new Error('synthetic-read-failure'));
    if (mode === 'empty') return Promise.resolve([]);
    return Promise.resolve(Array.from({ length: limit }, (_, index) => ({
      id: `${prefix}-${resource}-${index}`, price: index + 0.25,
    })));
  };
  return {
    calls,
    setMode: value => { mode = value; },
    count: resource => calls.filter(call => call.resource === resource).length,
    base44: { entities: {
      Product: { filter: (filter, sort, limit) => read('products', filter, sort, limit) },
      Banner: { filter: (filter, sort, limit) => read('banners', filter, sort, limit) },
      SubscriptionBundle: { list: (sort, limit) => read('bundles', {}, sort, limit) },
    } },
  };
}

// Invoke the actual page functions with a minimal hook shell. Query functions
// are retained intact; requests are issued only by the real observers below.
function pageQueries(page, isNative, reads) {
  const queries = {};
  let refreshHandler;
  let explicitRefreshes = 0;
  const PullToRefresh = () => null;
  const react = {
    createElement: (type, props) => {
      if (type === PullToRefresh) refreshHandler = props.onRefresh;
      return null;
    },
    useState: initial => [typeof initial === 'function' ? initial() : initial, noop],
    useMemo: callback => callback(),
    useEffect: noop,
    useRef: current => ({ current }),
  };
  const imports = {
    '@/lib/program-catalog': { programCollectionSummary: () => '2 or 3 days' },
    react: { ...react, default: react },
    'framer-motion': { motion: new Proxy({}, { get: () => noop }), AnimatePresence: noop },
    'lucide-react': { Bell: noop, Search: noop },
    'react-router-dom': { Link: noop, useSearchParams: () => [new URLSearchParams(), noop] },
    '@tanstack/react-query': { useQuery: options => {
      queries[options.queryKey[0]] = options;
      return { data: [], isLoading: false, refetch: async () => { explicitRefreshes++; } };
    } },
    '@/api/base44Client': { base44: reads.base44 },
    '@/lib/AuthContext': { useAuth: () => ({ user: null }) },
    '@/lib/nativeRuntime': { isNativeAppRuntime: () => isNative },
    '@/hooks/useDesktopStorefront': { default: () => !isNative },
    '@/lib/publicCatalogQueries': catalog,
    '@/lib/public-products': { PUBLIC_PRODUCT_FALLBACKS: fallback },
    '@/lib/brandImages': { BRAND_IMAGES: { wordmark: '/synthetic-wordmark.webp' } },
    '@/lib/seo-slugs': { absoluteUrl: path => `https://example.test${path}`, productPath: () => '/synthetic' },
    '@/lib/googleAnalytics': { ANALYTICS_CONSENT_EVENT: 'synthetic', trackGoogleSearch: noop, trackGoogleViewItemList: noop },
    '@/lib/metaPixel': { MARKETING_CONSENT_EVENT: 'synthetic', trackMetaSearch: noop },
    '@/lib/snapPixel': { trackSnapSearch: noop },
    '@/lib/product-seo': { productImageUrl: () => '/synthetic.webp' },
    '@/components/PullToRefresh': { default: PullToRefresh },
  };
  const module = { exports: {} };
  const code = transformSync(fs.readFileSync(`src/pages/${page}.jsx`, 'utf8'), {
    loader: 'jsx', format: 'cjs',
  }).code;
  vm.runInNewContext(code, {
    module, exports: module.exports, URLSearchParams,
    console: { warn: noop },
    require: name => {
      const value = imports[name] || (name.startsWith('@/components/') ? { default: noop } : null);
      assert.ok(value, `Unmocked import: ${name}`);
      return 'default' in value ? { __esModule: true, ...value } : value;
    },
  });
  module.exports.default({});
  return { queries, refresh: () => refreshHandler(), refreshCount: () => explicitRefreshes };
}

function client() {
  const value = createQueryClient();
  clients.add(value);
  return value;
}
function mount(queryClient, options) {
  const observer = new QueryObserver(queryClient, options);
  const stop = observer.subscribe(noop);
  return { observer, stop };
}
async function settled(mounted) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (mounted.observer.getCurrentResult().fetchStatus === 'idle') return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Synthetic observer did not settle');
}

try {
  assert.equal(catalog.PUBLIC_WEBSITE_CATALOG_STALE_TIME, 120000);
  assert.equal(catalog.PUBLIC_WEBSITE_PRODUCT_LIMIT, 100);
  for (const resource of ['products', 'banners', 'bundles']) {
    const reads = syntheticReads();
    const home = pageQueries('Home', false, reads);
    const shop = pageQueries('Shop', false, reads);
    const firstOptions = resource === 'bundles' ? shop.queries[resource] : home.queries[resource];
    const nextOptions = resource === 'banners' ? home.queries[resource] : shop.queries[resource];
    assert.equal(firstOptions.staleTime, 120000);
    assert.equal(firstOptions.refetchOnMount, true);
    assert.deepEqual(clean(firstOptions.queryKey), clean(nextOptions.queryKey));
    const cache = client();
    // A different legacy query contract must never satisfy the website read.
    cache.setQueryData([resource], [{ id: 'legacy-incomplete-or-different-entity' }]);
    const first = mount(cache, firstOptions);
    assert.equal(first.observer.getCurrentResult().data, undefined);
    await settled(first);
    assert.equal(reads.count(resource), 1);
    const initialData = first.observer.getCurrentResult().data;
    assert.equal(initialData.length, resource === 'banners' ? 10 : 100);
    first.stop();

    const second = mount(cache, nextOptions);
    assert.equal(second.observer.getCurrentResult().data, initialData);
    assert.equal(second.observer.getCurrentResult().isFetching, false);
    await settled(second);
    assert.equal(reads.count(resource), 1, `${resource}: fresh remount must reuse cache`);
    second.stop();

    cache.setQueryData(firstOptions.queryKey, initialData, { updatedAt: Date.now() - 120001 });
    const stale = mount(cache, nextOptions);
    await settled(stale);
    assert.equal(reads.count(resource), 2, `${resource}: stale remount must refresh`);
    await stale.observer.refetch();
    assert.equal(reads.count(resource), 3, `${resource}: explicit refresh must ignore freshness`);
    await cache.invalidateQueries({ queryKey: [resource] });
    assert.equal(reads.count(resource), 4, `${resource}: existing prefix invalidation must still work`);
    stale.stop();
    assert.ok(reads.calls.filter(call => call.resource === resource).every(call =>
      call.sort === 'sort_order' && call.limit === (resource === 'banners' ? 10 : 100)));
    if (resource === 'products') {
      assert.ok(reads.calls.every(call => call.filter.is_available === true));
      // Includes items beyond Home's former limit, without changing values.
      assert.equal(initialData[99].id, 'synthetic-products-99');
      assert.equal(initialData[99].price, 99.25);
    }
    if (resource === 'banners') assert.ok(reads.calls.every(call => call.filter.is_active === true));
    await home.refresh();
    await shop.refresh();
    assert.equal(home.refreshCount(), 1);
    assert.equal(shop.refreshCount(), 1);
  }
  checks.push('Actual Home/Shop options reuse fresh complete web catalogs, refetch stale data and honor manual refresh/prefix invalidation');

  for (const resource of ['products', 'banners', 'bundles']) {
    const reads = syntheticReads();
    const home = pageQueries('Home', true, reads);
    const shop = pageQueries('Shop', true, reads);
    const firstOptions = resource === 'bundles' ? shop.queries[resource] : home.queries[resource];
    const nextOptions = resource === 'banners' ? home.queries[resource] : shop.queries[resource];
    assert.deepEqual(clean(firstOptions.queryKey), [resource]);
    assert.equal(Object.hasOwn(firstOptions, 'staleTime'), false);
    assert.equal(Object.hasOwn(firstOptions, 'refetchOnMount'), false);
    const cache = client();
    assert.equal(cache.defaultQueryOptions(firstOptions).refetchOnMount, 'always');
    const first = mount(cache, firstOptions);
    await settled(first);
    first.stop();
    const next = mount(cache, nextOptions);
    await settled(next);
    assert.equal(reads.count(resource), 2, `${resource}: native always-refetch contract changed`);
    next.stop();
    const limits = reads.calls.map(call => call.limit);
    assert.deepEqual(limits, resource === 'products' ? [50, 100] : resource === 'banners' ? [10, 10] : [100, 100]);
  }
  checks.push('Native keys, Home50/Shop100 limits and always-refetch behavior are unchanged');

  for (const isNative of [false, true]) {
    for (const page of ['Home', 'Shop']) {
      const reads = syntheticReads();
      const { queries } = pageQueries(page, isNative, reads);
      for (const mode of ['empty', 'error']) {
        reads.setMode(mode);
        assert.equal(await queries.products.queryFn(), fallback);
      }
      for (const key of ['my-orders', 'unread-notifications']) {
        if (!queries[key]) continue;
        assert.deepEqual(clean(queries[key].queryKey), [key]);
        assert.equal(queries[key].enabled, false);
        assert.equal(Object.hasOwn(queries[key], 'staleTime'), false);
        assert.equal(Object.hasOwn(queries[key], 'refetchOnMount'), false);
      }
    }
  }
  checks.push('Existing empty/error product fallback and protected Home query options are unchanged');

  const boundary = createAuthSessionBoundary();
  clients.add(boundary.getSession().client);
  const a = boundary.transition({ id: 'synthetic-principal-a' });
  clients.add(a.client);
  const aReads = syntheticReads('principal-a');
  const aOptions = pageQueries('Home', false, aReads).queries.products;
  const aMounted = mount(a.client, aOptions);
  await settled(aMounted);
  aMounted.stop();
  assert.equal(boundary.transition({ id: 'synthetic-principal-a' }).client, a.client);
  const anonymous = boundary.transition(null);
  clients.add(anonymous.client);
  assert.equal(anonymous.client.getQueryData(aOptions.queryKey), undefined);
  const b = boundary.transition({ id: 'synthetic-principal-b' });
  clients.add(b.client);
  assert.notEqual(a.client, b.client);
  assert.equal(a.client.getQueryData(aOptions.queryKey), undefined);
  assert.equal(b.client.getQueryData(aOptions.queryKey), undefined);
  const bReads = syntheticReads('principal-b');
  const bOptions = pageQueries('Shop', false, bReads).queries.products;
  const bMounted = mount(b.client, bOptions);
  assert.equal(bMounted.observer.getCurrentResult().data, undefined);
  await settled(bMounted);
  assert.equal(bReads.count('products'), 1);
  assert.equal(bMounted.observer.getCurrentResult().data[0].id, 'principal-b-products-0');
  bMounted.stop();
  // Even a late write to an old retained client cannot populate the new one.
  a.client.setQueryData(aOptions.queryKey, [{ id: 'late-principal-a' }]);
  assert.equal(b.client.getQueryData(bOptions.queryKey)[0].id, 'principal-b-products-0');
  const freshBrowserClient = client();
  assert.equal(freshBrowserClient.getQueryData(bOptions.queryKey), undefined);
  checks.push('Real auth-session boundaries isolate A, signed-out and B clients; no cross-user or disk-persisted cache');

  const source = fs.readFileSync('src/lib/publicCatalogQueries.js', 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|indexedDB|persistQuery|new QueryClient/);
  assert.deepEqual(Object.keys(catalog.publicCatalogQueryOptions('products', false)).sort(),
    ['queryKey', 'refetchOnMount', 'staleTime']);
  console.log(JSON.stringify({ ok: true, suite: 'public-catalog-freshness', checks,
    real_query_observers: true, real_network_requests: 0, provider_calls: false, production_writes: false }, null, 2));
} finally {
  for (const queryClient of clients) queryClient.clear();
}
