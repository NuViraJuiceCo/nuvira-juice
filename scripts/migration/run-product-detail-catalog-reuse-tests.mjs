#!/usr/bin/env node
// Synthetic QueryObserver reads only; no SDK/network/provider access.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { QueryObserver, timeoutManager } from '@tanstack/react-query';
import { createQueryClient } from '../../src/lib/query-client.js';
import { createAuthSessionBoundary } from '../../src/lib/authQuerySession.js';
import { publicCatalogQueryOptions } from '../../src/lib/publicCatalogQueries.js';
import * as details from '../../src/lib/productDetailQueries.js';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import * as slugs from '../../src/lib/seo-slugs.js';

timeoutManager.setTimeoutProvider({
  setTimeout: (fn, delay) => setTimeout(fn, delay).unref(), clearTimeout,
  setInterval: (fn, delay) => setInterval(fn, delay).unref(), clearInterval,
});
const checks = [];
const clients = new Set();
const noop = () => {};
const clone = value => JSON.parse(JSON.stringify(value));
const catalogKey = publicCatalogQueryOptions('products', false).queryKey;
const fallback = PUBLIC_PRODUCT_FALLBACKS.find(product => product.slug === 'aura');
const live = { ...fallback, price: 17.25, shopify_handle: 'synthetic-aura-handle', updated_date: '2026-10-06T12:00:00Z' };
const findFallback = identifier => PUBLIC_PRODUCT_FALLBACKS.find(product => slugs.productLookupKeys(product).includes(identifier));
function client() {
  const result = createQueryClient();
  clients.add(result);
  return result;
}
function makeOptions(cache, { identifier = 'aura', isNative = false, rows = [live], ...overrides } = {}) {
  const calls = [];
  const errors = [];
  const options = details.productDetailQueryOptions({
    identifier, isNative, queryClient: cache, findFallback,
    readProducts: async (...args) => { calls.push(args); return rows; },
    onReadError: (...args) => errors.push(args),
    ...overrides,
  });
  return { options, calls, errors };
}
function mount(cache, options) {
  const observer = new QueryObserver(cache, options);
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
async function test(name, work) { await work(); checks.push(name); }

try {
  await test('fresh exact website cache renders immediately for id, slug, title, handle and normalized URL aliases without a read', async () => {
    for (const identifier of [live.id, 'aura', 'AURA', live.shopify_handle, '/product/AURA.html', '/products/synthetic-aura-handle']) {
      const cache = client();
      const updatedAt = Date.now() - 1000;
      cache.setQueryData(catalogKey, [clone(live)], { updatedAt });
      const { options, calls } = makeOptions(cache, { identifier });
      const view = mount(cache, options);
      assert.equal(view.observer.getCurrentResult().data.price, 17.25);
      assert.equal(view.observer.getCurrentResult().isLoading, false);
      assert.equal(view.observer.getCurrentResult().isFetching, false);
      assert.equal(view.observer.getCurrentResult().dataUpdatedAt, updatedAt);
      assert.equal(calls.length, 0);
      assert.equal(slugs.productPath(view.observer.getCurrentResult().data), '/product/aura.html');
      view.stop();
    }
  });

  await test('legacy and wrong-limit cache contracts never satisfy the website PDP', async () => {
    for (const key of [['products'], ['products', 'public-website', { is_available: true, sort: 'sort_order', limit: 50 }]]) {
      const cache = client();
      cache.setQueryData(key, [live]);
      const { options, calls } = makeOptions(cache);
      const view = mount(cache, options);
      assert.equal(view.observer.getCurrentResult().isLoading, true);
      await settled(view);
      assert.deepEqual(calls, [[{ is_available: true }, 'sort_order', 200]]);
      view.stop();
    }
  });

  await test('stale, invalidated, error, future-dated, unavailable and malformed cache data require a real detail read', async () => {
    for (const condition of ['stale', 'invalidated', 'error', 'future', 'unavailable', 'malformed']) {
      const cache = client();
      const now = Date.now();
      cache.setQueryData(catalogKey, condition === 'malformed' ? {} : [{ ...live, is_available: condition !== 'unavailable' }], {
        updatedAt: condition === 'stale' ? now - 120000 : condition === 'future' ? now + 1000 : now - 1000,
      });
      if (condition === 'invalidated') await cache.invalidateQueries({ queryKey: catalogKey });
      if (condition === 'error') cache.getQueryCache().find({ queryKey: catalogKey }).setState({ status: 'error' });
      const { options, calls } = makeOptions(cache, { now });
      assert.equal(options.initialData, undefined, condition);
      const view = mount(cache, options);
      await settled(view);
      assert.equal(calls.length, 1, condition);
      view.stop();
    }
  });

  await test('static fallback, structural clone and reordered fallback properties never seed live pricing', async () => {
    for (const record of [fallback, clone(fallback), Object.fromEntries(Object.entries(fallback).reverse())]) {
      const cache = client();
      cache.setQueryData(catalogKey, [record]);
      const { options, calls } = makeOptions(cache);
      const view = mount(cache, options);
      assert.equal(view.observer.getCurrentResult().data, undefined);
      await settled(view);
      assert.equal(calls.length, 1);
      assert.equal(view.observer.getCurrentResult().data.price, 17.25);
      view.stop();
    }
  });

  await test('a missing first-100 match preserves the 200-item lookup and does not overwrite the shared catalog', async () => {
    const cache = client();
    const firstHundred = Array.from({ length: 100 }, (_, index) => ({ id: `synthetic-${index}`, is_available: true }));
    cache.setQueryData(catalogKey, firstHundred);
    const { options, calls } = makeOptions(cache, { rows: [...firstHundred, live] });
    const view = mount(cache, options);
    await settled(view);
    assert.deepEqual(calls, [[{ is_available: true }, 'sort_order', 200]]);
    assert.equal(view.observer.getCurrentResult().data.id, live.id);
    assert.equal(cache.getQueryData(catalogKey).length, 100);
    view.stop();
  });

  await test('ID misses retain direct ID retry and all other misses retain existing metadata fallback', async () => {
    const cache = client();
    const calls = [];
    const { options } = makeOptions(cache, {
      identifier: live.id,
      readProducts: async (...args) => { calls.push(args); return calls.length === 1 ? [] : [live]; },
    });
    assert.equal(await options.queryFn(), live);
    assert.deepEqual(calls, [[{ is_available: true }, 'sort_order', 200], [{ id: live.id }]]);
    const missing = makeOptions(client(), { rows: [] });
    assert.equal(await missing.options.queryFn(), fallback);
    assert.equal(missing.calls.length, 1);
    const unknown = makeOptions(client(), { identifier: 'not-in-catalog', rows: [] });
    assert.equal(await unknown.options.queryFn(), undefined);
  });

  await test('read errors retain fallback and reporting, and fallback still refreshes on remount', async () => {
    const cache = client();
    let reads = 0;
    const { options, errors } = makeOptions(cache, { readProducts: async () => { reads++; throw new Error('synthetic'); } });
    const first = mount(cache, options);
    await settled(first);
    assert.deepEqual(first.observer.getCurrentResult().data, fallback);
    first.stop();
    const second = mount(cache, options);
    await settled(second);
    assert.equal(reads, 2);
    assert.equal(errors.length, 2);
    second.stop();
  });

  await test('explicit PDP refresh and detail invalidation re-read even while shared catalog is fresh', async () => {
    const cache = client();
    cache.setQueryData(catalogKey, [live]);
    const { options, calls } = makeOptions(cache, { rows: [{ ...live, price: 18.50 }] });
    const view = mount(cache, options);
    assert.equal(calls.length, 0);
    await view.observer.refetch();
    assert.equal(calls.length, 1);
    assert.equal(view.observer.getCurrentResult().data.price, 18.50);
    await cache.invalidateQueries({ queryKey: ['product-detail'] });
    assert.equal(calls.length, 2);
    view.stop();
  });

  await test('missing product results remain stale and retry on the next mount', async () => {
    const cache = client();
    const { options, calls } = makeOptions(cache, { identifier: 'missing-fixture', rows: [], findFallback: () => null });
    const first = mount(cache, options);
    await settled(first);
    assert.equal(first.observer.getCurrentResult().data, null);
    first.stop();
    const second = mount(cache, options);
    await settled(second);
    assert.equal(calls.length, 2);
    second.stop();
  });

  await test('native keys, no seed, 200-item read and always-on-remount behavior are unchanged', async () => {
    const cache = client();
    cache.setQueryData(catalogKey, [live]);
    const { options, calls } = makeOptions(cache, { isNative: true });
    assert.deepEqual(options.queryKey, ['product-detail', 'aura']);
    for (const key of ['initialData', 'initialDataUpdatedAt', 'staleTime', 'refetchOnMount']) assert.equal(Object.hasOwn(options, key), false);
    const first = mount(cache, options);
    assert.equal(first.observer.getCurrentResult().data, undefined);
    await settled(first); first.stop();
    const second = mount(cache, options);
    await settled(second); second.stop();
    assert.deepEqual(calls, [[{ is_available: true }, 'sort_order', 200], [{ is_available: true }, 'sort_order', 200]]);
    const missingRuntime = details.productDetailQueryOptions({
      identifier: 'aura', queryClient: cache, findFallback, readProducts: async () => [live],
    });
    assert.deepEqual(missingRuntime.queryKey, ['product-detail', 'aura']);
  });

  await test('empty identifiers remain disabled and principal transition cannot reuse another session catalog', async () => {
    const empty = makeOptions(client(), { identifier: '' });
    const view = mount(client(), empty.options);
    assert.equal(empty.options.enabled, false);
    assert.equal(empty.calls.length, 0); view.stop();
    const boundary = createAuthSessionBoundary();
    const before = boundary.getSession();
    before.client.setQueryData(catalogKey, [live]);
    const after = boundary.transition({ id: 'synthetic-principal', email: 'buyer@example.test' });
    assert.equal(makeOptions(after.client).options.initialData, undefined);
    before.client.clear(); after.client.clear();
  });

  await test('actual ProductDetail wires current query client and runtime flag into the tested options without mutating cart', async () => {
    for (const isNative of [false, true]) {
      for (const routeSlug of ['aura.html', 'synthetic%252Fhandle']) {
      const cache = client();
      let captured;
      let writes = 0;
      const react = {
        createElement: noop, useEffect: noop, useRef: current => ({ current }),
        useState: value => [typeof value === 'function' ? value() : value, noop],
      };
      const imports = {
        react: { ...react, default: react },
        'react-dom': { createPortal: noop },
        '@tanstack/react-query': { useQueryClient: () => cache, useQuery: options => {
          if (options.queryKey[0] === 'product-detail') captured = options;
          return { isLoading: true };
        } },
        'react-router-dom': { Link: noop, useNavigate: () => noop, useParams: () => ({ slug: routeSlug }) },
        'lucide-react': new Proxy({}, { get: () => noop }),
        'framer-motion': { motion: new Proxy({}, { get: () => noop }) },
        sonner: { toast: { success: noop } },
        '@/api/base44Client': { base44: { entities: { Product: { filter: async () => [live] } } } },
        '@/lib/cartContext': { useCart: () => ({ items: [], addItem: () => { writes++; } }) },
        '@/lib/seo-slugs': slugs,
        '@/lib/public-products': { findPublicProductFallback: findFallback },
        '@/lib/productDetailQueries': details,
        '@/lib/nativeRuntime': { isNativeAppRuntime: () => isNative },
      };
      const module = { exports: {} };
      vm.runInNewContext(transformSync(fs.readFileSync('src/pages/ProductDetail.jsx', 'utf8'), { loader: 'jsx', format: 'cjs' }).code, {
        module, exports: module.exports, console,
        require: name => {
          const value = imports[name] || (name.startsWith('@/') ? { default: noop } : null);
          assert.ok(value, `Unmocked import: ${name}`);
          return 'default' in value ? { __esModule: true, ...value } : value;
        },
      });
      module.exports.default();
      const expectedIdentifier = slugs.normalizeProductIdentifier(routeSlug);
      assert.deepEqual(clone(captured.queryKey), isNative ? ['product-detail', expectedIdentifier] : ['product-detail', 'public-website', expectedIdentifier]);
      if (routeSlug === 'aura.html') assert.equal(await captured.queryFn(), live);
      assert.equal(writes, 0);
      }
    }
    const source = fs.readFileSync('src/pages/ProductDetail.jsx', 'utf8');
    assert.match(source, /navigate\(canonicalPath, \{ replace: true \}\)/);
    assert.match(source, /addItem\(product, quantity, extra, \{ preview: !isNativeAppRuntime\(\), triggerElement: event\?\.currentTarget \}\)/);
  });
} finally {
  clients.forEach(cache => cache.clear());
}
console.log(JSON.stringify({ ok: true, suite: 'product-detail-catalog-reuse', checks, provider_calls: 0, production_writes: 0 }, null, 2));
