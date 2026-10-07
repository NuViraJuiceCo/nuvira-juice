#!/usr/bin/env node
// Evaluate the real code with inert page imports and navigation dependencies.
// No page mount, browser, network, provider, authentication or storage calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';

const checks = [];
const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const { code } = transformSync(read(file), {
    loader: file.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs',
    supported: { 'dynamic-import': false },
  });
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require: name => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected dependency: ${name}`);
      return imports[name];
    },
    ...globals,
  });
  return module.exports;
}

const routes = ['/', '/shop', '/about', '/contact', '/support'];
const website = { isNative: false, isAdmin: false };
const importCalls = [];
let mountedPages = 0;
let failedImport = '';
const pageImports = Object.fromEntries(['Home', 'Shop', 'About', 'Contact', 'Support']
  .map(name => [`@/pages/${name}`, { default: () => { mountedPages++; return null; } }]));
const imports = new Proxy(pageImports, {
  get(target, name) {
    importCalls.push(name);
    if (name === failedImport) throw new Error('synthetic_chunk_failure');
    return target[name];
  },
});
const loaders = load('src/lib/startupPages.js', imports, { window: {} });
assert.equal(importCalls.length, 0, 'Module evaluation must not eagerly import any route');
for (const route of ['', undefined, null, {}, '/cart', '/checkout', '/account', '/rewards',
  '/admin', '/admin/orders', '/account/orders', '/native-login', '/login', '/register',
  '/product/oasis', '/shop/product-id', '/unknown', '/constructor', 'toString',
  'https://nuvirajuice.com/shop', 'https://outside.invalid/', '//outside.invalid/shop',
  '/shop?code=test', '/shop#details', '/SHOP', '/shop/', '/shop/../account']) {
  assert.equal(loaders.isPublicNavigationPreloadRoute(route), false);
  assert.equal(await loaders.preloadPublicNavigation(route, website), false);
}
for (const route of routes) {
  assert.equal(loaders.isPublicNavigationPreloadRoute(route), true);
  assert.equal(await loaders.preloadPublicNavigation(route), false, 'Missing context must fail closed');
  assert.equal(await loaders.preloadPublicNavigation(route, { isNative: true, isAdmin: false }), false);
  assert.equal(await loaders.preloadPublicNavigation(route, { isNative: false, isAdmin: true }), false);
  assert.equal(await loaders.preloadPublicNavigation(route, { isNative: false }), false);
}
const serverLoaders = load('src/lib/startupPages.js', imports);
assert.equal(await serverLoaders.preloadPublicNavigation('/', website), false, 'No prefetch on the server');
assert.equal(importCalls.length, 0);
checks.push('Only five exact relative public routes; server, native, admin, unknown, protected and callback-shaped targets denied');

const home = loaders.preloadPublicNavigation('/', website);
assert.equal(loaders.preloadPublicNavigation('/', website), home, 'Concurrent intent reuses the same promise');
const shop = loaders.preloadPublicNavigation('/shop', website);
assert.equal(await loaders.preloadPublicNavigation('/about', website), false, 'At most two simultaneous imports');
assert.equal(await home, true);
assert.equal(await shop, true);
assert.equal(importCalls.length, 2);
assert.equal(await loaders.preloadPublicNavigation('/', website), true);
assert.equal(await loaders.preloadPublicNavigation('/shop', website), true);
assert.equal(importCalls.length, 2, 'Successful prefetches are retained without another import');
for (const route of routes.slice(2)) assert.equal(await loaders.preloadPublicNavigation(route, website), true);
assert.equal(importCalls.length, 5);
for (const route of routes) assert.equal(await loaders.preloadPublicNavigation(route, website), true);
assert.equal(importCalls.length, 5, 'Successful cache is bounded by exactly five public modules');
assert.equal(await loaders.preloadPublicNavigation('/', { isNative: true, isAdmin: false }), false,
  'Cached success cannot bypass native exclusion');
assert.equal(await loaders.preloadPublicNavigation('/', { isNative: false, isAdmin: true }), false,
  'Cached success cannot bypass admin exclusion');
assert.equal(mountedPages, 0);
checks.push('Two-import concurrency bound; in-flight and successful deduplication; no page components mounted');

const retryLoaders = load('src/lib/startupPages.js', imports, { window: {} });
failedImport = '@/pages/About';
const failed = retryLoaders.preloadPublicNavigation('/about', website);
assert.equal(retryLoaders.preloadPublicNavigation('/about', website), failed);
assert.equal(await failed, false, 'A failed chunk is handled without rejecting');
failedImport = '';
assert.equal(await retryLoaders.preloadPublicNavigation('/about', website), true, 'Failed imports can retry');
const afterRetry = importCalls.length;
assert.equal(await retryLoaders.preloadPublicNavigation('/about', website), true);
assert.equal(importCalls.length, afterRetry);
checks.push('Import failure never rejects the caller and can retry successfully on later intent');

let native = false;
let adminUser = false;
let currentPath = '/';
let desktop = true;
const intents = [];
const Link = () => null;
const icon = () => null;
const sideImports = {
  react: { ...React, default: React },
  'react-router-dom': { Link, useLocation: () => ({ pathname: currentPath }) },
  'lucide-react': Object.fromEntries(['ArrowLeft', 'Home', 'Search', 'ShoppingBag', 'User', 'Star', 'ShieldCheck', 'Sparkles']
    .map(name => [name, icon])),
  '@/lib/cartContext': { useCart: () => ({ itemCount: 2 }) },
  '@/lib/AuthContext': { useAuth: () => ({ user: adminUser ? { role: 'admin' } : null }) },
  '@/lib/admin-access': { isAdminUser: user => user?.role === 'admin' },
  '@/lib/nativeRuntime': { isNativeAppRuntime: () => native },
  './adminNavItems': { adminNavGroups: [{ label: 'Operations', items: [{ path: '/admin/orders', label: 'Orders', icon }] }],
    isAdminNavActive: () => false },
  '@/lib/program-journey-state': { useActiveProgramJourney: () => ({ journey: null }) },
  '@/lib/brandImages': { BRAND_IMAGES: { wordmark: '/images/wordmark.webp' } },
  '@/lib/startupPages': { isPublicNavigationPreloadRoute: loaders.isPublicNavigationPreloadRoute,
    preloadPublicNavigation: (route, options) => { intents.push({ route, options }); return Promise.resolve(true); } },
  '@/lib/memberNavigationPreload': { isMemberNavigationPreloadRoute: () => false,
    preloadMemberNavigation: () => { throw new Error('Anonymous public navigation must not warm member pages'); } },
};
const SideNav = load('src/components/layout/SideNav.jsx', sideImports, {
  window: { matchMedia: query => { assert.equal(query, '(min-width: 1024px)'); return { matches: desktop }; } },
}).default;
function links() {
  const result = [];
  function visit(node) {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (!React.isValidElement(node)) return;
    if (node.type === Link) result.push(node.props);
    React.Children.forEach(node.props.children, visit);
  }
  visit(SideNav());
  return result;
}
const initialLinks = links();
assert.equal(intents.length, 0, 'Rendering SideNav does not prefetch');
for (const props of initialLinks) {
  assert.equal(props.onClick, undefined, 'Link click/navigation behavior is untouched');
  assert.equal(props.onTouchStart, undefined, 'No speculative prefetch on touch');
  if (routes.includes(props.to)) {
    assert.equal(typeof props.onMouseEnter, 'function');
    assert.equal(typeof props.onFocus, 'function');
    props.onMouseEnter();
    props.onFocus();
  } else {
    assert.equal(props.onMouseEnter, undefined, props.to);
    assert.equal(props.onFocus, undefined, props.to);
  }
}
assert.deepEqual([...new Set(intents.map(intent => intent.route))].sort(), [...routes].sort());
assert.ok(intents.every(intent => intent.options.isNative === false && intent.options.isAdmin === false));
const desktopIntents = intents.length;
desktop = false;
for (const props of links()) { props.onMouseEnter?.(); props.onFocus?.(); }
assert.equal(intents.length, desktopIntents, 'Tablet/mobile widths do not prefetch');
desktop = true;
for (const context of [
  { native: true, admin: false, path: '/' },
  { native: true, admin: true, path: '/admin/orders' },
  { native: false, admin: true, path: '/admin/orders' },
  { native: false, admin: false, path: '/admin/unknown' },
]) {
  native = context.native; adminUser = context.admin; currentPath = context.path;
  for (const props of links()) {
    assert.equal(props.onMouseEnter, undefined, `${context.path} ${props.to}`);
    assert.equal(props.onFocus, undefined, `${context.path} ${props.to}`);
  }
}
assert.equal(intents.length, desktopIntents);
assert.equal(mountedPages, 0);
checks.push('Actual SideNav prefetches only on public desktop hover/focus; no eager, touch, protected, native or admin behavior');

console.log(JSON.stringify({ ok: true, suite: 'public-navigation-preload', checks,
  public_routes: routes, maximum_concurrent_imports: 2, maximum_retained_successes: 5,
  mounted_page_components: mountedPages, provider_calls: false, network_calls: false,
  writes: false, limitation: 'Code-only intent contracts; actual network and interaction latency require browser measurement.' }, null, 2));
