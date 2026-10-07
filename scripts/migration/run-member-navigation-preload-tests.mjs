#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';

const checks = [];
const calls = [];
let fail = false;
let mounts = 0;
const moduleSource = fs.readFileSync('src/lib/memberNavigationPreload.js', 'utf8');
function loaders(browser = true) {
  const module = { exports: {} };
  const { code } = transformSync(moduleSource, { loader: 'js', format: 'cjs', supported: { 'dynamic-import': false } });
  vm.runInNewContext(code, {
    module, exports: module.exports, ...(browser ? { window: {} } : {}),
    require: name => {
      assert.ok(['@/pages/Account', '@/pages/Rewards'].includes(name));
      calls.push(name);
      if (fail) throw new Error('Synthetic chunk failure');
      return { default: () => { mounts++; return null; } };
    },
  });
  return module.exports;
}
const member = { isNative: false, isAdmin: false, isAuthenticated: true };
const api = loaders();
assert.equal(calls.length, 0);
for (const route of [null, {}, '', '/', '/shop', '/account/orders', '/admin', '/admin/orders', '/account?code=x',
  '/account#callback', '/ACCOUNT', '/account/', '/account/../rewards', '/constructor', 'toString',
  '//outside.invalid/account', 'https://nuvirajuice.com/account']) {
  assert.equal(api.isMemberNavigationPreloadRoute(route), false);
  assert.equal(await api.preloadMemberNavigation(route, member), false);
}
for (const route of ['/account', '/rewards']) {
  assert.equal(api.isMemberNavigationPreloadRoute(route), true);
  for (const context of [undefined, {}, { isNative: false, isAdmin: false },
    { ...member, isNative: true }, { ...member, isAdmin: true }, { ...member, isAuthenticated: false },
    { ...member, isAuthenticated: 'true' }]) {
    assert.equal(await api.preloadMemberNavigation(route, context), false);
  }
  assert.equal(await loaders(false).preloadMemberNavigation(route, member), false);
}
assert.equal(calls.length, 0);
checks.push('Exact member routes only; anonymous, missing context, server, native, admin and callback-shaped requests denied');

const account = api.preloadMemberNavigation('/account', member);
assert.equal(api.preloadMemberNavigation('/account', member), account);
assert.equal(await api.preloadMemberNavigation('/rewards', member), false, 'Only one speculative member import at a time');
assert.equal(await account, true);
assert.equal(await api.preloadMemberNavigation('/account', member), true);
assert.equal(calls.length, 1);
assert.equal(await api.preloadMemberNavigation('/rewards', member), true);
assert.equal(calls.length, 2);
assert.equal(await api.preloadMemberNavigation('/account', { ...member, isAuthenticated: false }), false);
assert.equal(await api.preloadMemberNavigation('/rewards', { ...member, isNative: true }), false);
checks.push('In-flight/success reuse, one-member concurrency bound, and cached results cannot bypass context checks');

const retry = loaders();
fail = true;
assert.equal(await retry.preloadMemberNavigation('/account', member), false);
fail = false;
assert.equal(await retry.preloadMemberNavigation('/account', member), true);
assert.equal(mounts, 0);
assert.doesNotMatch(moduleSource, /fetch\(|\.invoke\(|\.entities\.|localStorage|sessionStorage|setTimeout|setInterval/);
checks.push('Chunk failure safely retries; no mounted pages, API reads, writes, storage or timers');

let native = false, desktop = true, pathname = '/', user = { email: 'fixture@example.test' };
const intents = [];
const Link = () => null;
const icon = () => null;
const imports = {
  react: { ...React, default: React },
  'react-router-dom': { Link, useLocation: () => ({ pathname }) },
  'lucide-react': Object.fromEntries(['ArrowLeft', 'Home', 'Search', 'ShoppingBag', 'User', 'Star', 'ShieldCheck', 'Sparkles'].map(n => [n, icon])),
  '@/lib/cartContext': { useCart: () => ({ itemCount: 0 }) },
  '@/lib/AuthContext': { useAuth: () => ({ user }) },
  '@/lib/admin-access': { isAdminUser: u => u?.role === 'admin' },
  '@/lib/nativeRuntime': { isNativeAppRuntime: () => native },
  './adminNavItems': { adminNavGroups: [], isAdminNavActive: () => false },
  '@/lib/program-journey-state': { useActiveProgramJourney: () => ({ journey: null }) },
  '@/lib/brandImages': { BRAND_IMAGES: { wordmark: '/fixture-logo.webp' } },
  '@/lib/startupPages': { isPublicNavigationPreloadRoute: () => false, preloadPublicNavigation: () => false },
  '@/lib/memberNavigationPreload': { isMemberNavigationPreloadRoute: api.isMemberNavigationPreloadRoute,
    preloadMemberNavigation: (route, context) => { intents.push({ route, ...context }); return Promise.resolve(true); } },
};
const module = { exports: {} };
const { code } = transformSync(fs.readFileSync('src/components/layout/SideNav.jsx', 'utf8'), { loader: 'jsx', format: 'cjs' });
vm.runInNewContext(code, { module, exports: module.exports,
  require: name => { assert.ok(Object.hasOwn(imports, name), name); return imports[name]; },
  window: { matchMedia: () => ({ matches: desktop }) },
});
function links() {
  const result = [];
  function visit(node) {
    if (!React.isValidElement(node)) return;
    if (node.type === Link) result.push(node.props);
    React.Children.forEach(node.props.children, visit);
  }
  visit(module.exports.default());
  return result;
}
const signedInLinks = links();
assert.equal(intents.length, 0);
for (const link of signedInLinks) {
  assert.equal(link.onClick, undefined);
  assert.equal(link.onTouchStart, undefined);
  if (['/account', '/rewards'].includes(link.to)) {
    link.onMouseEnter(); link.onFocus();
  } else assert.equal(link.onMouseEnter, undefined);
}
assert.deepEqual(intents.map(i => i.route), ['/rewards', '/rewards', '/account', '/account']);
assert.ok(intents.every(i => i.isNative === false && i.isAdmin === false && i.isAuthenticated === true));
const count = intents.length;
desktop = false;
for (const link of links()) { link.onMouseEnter?.(); link.onFocus?.(); }
assert.equal(intents.length, count);
desktop = true;
for (const context of [
  { native: true, pathname: '/', user },
  { native: false, pathname: '/admin/operations', user: { ...user, role: 'admin' } },
  { native: false, pathname: '/admin/unknown', user },
  { native: false, pathname: '/', user: null },
]) {
  ({ native, pathname, user } = context);
  for (const link of links()) {
    assert.equal(link.onMouseEnter, undefined);
    assert.equal(link.onFocus, undefined);
  }
}
assert.equal(intents.length, count);
checks.push('Actual SideNav warms only signed-in desktop customer intent; no eager, touch, anonymous, admin or native behavior');
console.log(JSON.stringify({ ok: true, suite: 'member-navigation-code-preload', checks, network_calls: 0,
  production_writes: 0, mounted_pages: mounts, timing_claims: false }, null, 2));
