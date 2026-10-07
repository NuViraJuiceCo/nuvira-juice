#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToString } from 'react-dom/server';

// Exercise real Suspense with unresolved route code. No browser, network, API,
// identity or payment fixture is needed to prove the shell stays mounted.
const checks = [];
const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports = {}) {
  const module = { exports: {} };
  const { code } = transformSync(read(file), { loader: file.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs' });
  vm.runInNewContext(code, {
    module, exports: module.exports, URLSearchParams,
    require: name => {
      assert.ok(name in imports, `Unexpected import ${name}`);
      const value = imports[name];
      return 'default' in value ? { __esModule: true, ...value } : value;
    },
  });
  return module.exports;
}
const policy = load('src/lib/publicStorefrontStartup.js');
const motionPolicy = load('src/lib/customerWebsiteMotion.js', { './publicStorefrontStartup.js': policy });
const Loading = load('src/components/layout/PublicRouteLoading.jsx', { react: React }).default;
let native = false;
let initialAuthReturn = false;
let location = { pathname: '/', search: '', hash: '' };
let waiting = true;
const pendingRoute = new Promise(() => {});
const Outlet = () => {
  if (waiting) throw pendingRoute;
  return React.createElement('div', { 'data-page-ready': 'true' }, 'Page content');
};
const Layout = load('src/components/layout/AppLayout.jsx', {
  '@/styles/browser-audit.css': {},
  react: React,
  'react-router-dom': { Outlet, useLocation: () => location },
  'framer-motion': {
    AnimatePresence: ({ children }) => children,
    motion: { div: ({ children }) => React.createElement('div', { 'data-motion-wrapper': 'true' }, children) },
  },
  './SideNav': { default: () => React.createElement('nav', { 'data-test-navigation': 'desktop' }, 'Home Shop Contact') },
  './MobileNav': { default: () => React.createElement('nav', { 'data-test-navigation': 'mobile' }, 'Home Shop') },
  './PublicRouteLoading': { default: Loading },
  '@/hooks/useDesktopStorefront': { default: () => false },
  '@/components/desktop/DesktopHeader': { default: () => null },
  '@/components/desktop/DesktopFooter': { default: () => null },
  '@/components/cart/CartPreviewHost': { default: () => null },
  '@/lib/nativeRuntime': { isNativeAppRuntime: () => native },
  '@/lib/customerWebsiteMotion': motionPolicy,
  '@/lib/app-params': { get startedWithAuthReturn() { return initialAuthReturn; } },
}).default;
function render(path, isNative = false, search = '', hash = '') {
  location = { pathname: path, search, hash };
  native = isNative;
  return renderToString(React.createElement(React.Suspense, {
    fallback: React.createElement('div', { 'data-outer-startup': 'true' }, 'Existing startup boundary'),
  }, React.createElement(Layout)));
}
for (const route of ['/', '/shop', '/contact', '/support', '/about', '/product/aura.html']) {
  const html = render(route);
  assert.match(html, /data-test-navigation="desktop"/);
  assert.match(html, /data-test-navigation="mobile"/);
  assert.match(html, /data-public-route-loading="true"/);
  assert.doesNotMatch(html, /data-outer-startup/);
  assert.match(html, /role="status"/);
}
checks.push('Real suspended public route retains both website navigation surfaces and inline loading status');
for (const route of ['/', '/shop', '/contact', '/support']) {
  assert.match(render(route, true), /data-outer-startup/);
  assert.doesNotMatch(render(route, true), /data-test-navigation|data-public-route-loading/);
}
for (const route of ['/account', '/account/orders', '/account/programs', '/account/programs/example',
  '/account/settings', '/account/subscriptions', '/rewards', '/notifications', '/return-reward',
  '/cart', '/cart/example', '/delete-account', '/referral', '/partner', '/book-event']) {
  const html = render(route);
  assert.match(html, /data-test-navigation="desktop"/);
  assert.match(html, /data-test-navigation="mobile"/);
  assert.match(html, /data-public-route-loading="true"/);
  assert.match(html, /data-page-transition="immediate"/);
  assert.doesNotMatch(html, /data-outer-startup|data-page-ready|data-motion-wrapper/);
  assert.match(render(route, true), /data-outer-startup/);
}
checks.push('Already-authorized customer website member chunks retain the shell with neutral immediate loading, never previous page data');
for (const route of ['/admin/orders', '/checkout', '/order-confirmation', '/unknown', '/account/unknown']) {
  assert.match(render(route), /data-outer-startup/);
  assert.doesNotMatch(render(route), /data-public-route-loading/);
}
for (const key of ['code', 'state', 'access_token', 'clear_access_token', 'error', 'is_new_user', 'native_provider_callback', 'native_browser_callback', 'reset_sign_in']) {
  for (const route of ['/support', '/account', '/account/orders', '/rewards']) {
    assert.match(render(route, false, `?${key}=synthetic`), /data-outer-startup/);
    assert.match(render(route, false, '', `#${key}=synthetic`), /data-outer-startup/);
  }
}
checks.push('Native, admin, checkout, unknown and auth-return paths retain the original outer boundary');
initialAuthReturn = true;
for (const route of ['/', '/shop', '/contact', '/support', '/about', '/account', '/rewards']) {
  const html = render(route, false, '', '');
  assert.match(html, /data-outer-startup/);
  assert.doesNotMatch(html, /data-public-route-loading|data-test-navigation/);
}
initialAuthReturn = false;
checks.push('Captured auth return retains the outer boundary after token URL parameters are removed');
waiting = false;
for (const route of ['/', '/shop', '/account', '/admin/orders']) {
  for (const isNative of [false, true]) {
    const html = render(route, isNative);
    assert.match(html, /data-page-ready="true"/);
    assert.match(html, /data-test-navigation="desktop"/);
    assert.doesNotMatch(html, /data-public-route-loading|data-outer-startup/);
  }
}
checks.push('Resolved routes render original page content in website/native layouts');
assert.doesNotMatch(read('src/components/layout/PublicRouteLoading.jsx'), /fixed|inset-0|setTimeout|useEffect|base44|fetch\(/);
assert.match(read('src/App.jsx'), /<Suspense fallback=\{<AppRouteFallback \/>\}>/);
assert.match(read('src/App.jsx'), /if \(!publicStorefrontReady\) \{\s*return <StartupStatus/);
checks.push('Inline fallback has no overlay, artificial delay or data requests; original startup/auth gates remain');
console.log(JSON.stringify({ ok: true, suite: 'public-route-shell', checks, network_requests: 0, production_writes: false }, null, 2));
