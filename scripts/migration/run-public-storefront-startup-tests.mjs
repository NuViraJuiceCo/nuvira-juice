#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Router from 'react-router-dom';

const checks = [];
const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports = {}, globals = {}) {
  const module = { exports: {} };
  const { code } = transformSync(read(file), {
    loader: file.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs',
    define: { 'import.meta.env': '{}' }, supported: { 'dynamic-import': false },
  });
  vm.runInNewContext(code, {
    module, exports: module.exports, URLSearchParams, console,
    require: name => {
      assert.ok(name in imports, name);
      const value = imports[name];
      return 'default' in value ? { __esModule: true, ...value } : value;
    },
    ...globals,
  });
  return module.exports;
}
const policy = load('src/lib/publicStorefrontStartup.js');
const publicRoutes = ['/', '/shop', '/SHOP/', '/shop/product-id', '/product/oasis.html',
  '/products/aura', '/program/radiance', '/about', '/events', '/delivery.html',
  '/fresh-juice-delivery-st-louis'];
for (const pathname of publicRoutes) {
  assert.equal(policy.canRenderPublicStorefront({ pathname, search: '?utm_source=google&gclid=test', hash: '#details' }), true, pathname);
  assert.equal(policy.canRenderPublicStorefront({ pathname, isNative: true }), false);
  assert.equal(policy.canRenderPublicStorefront({ pathname, startedWithAuthReturn: true }), false);
}
const gatedRoutes = ['/cart', '/cart/123:2', '/checkout', '/order-confirmation/test', '/order-incomplete',
  '/account', '/account/orders', '/account-setup', '/admin/orders', '/operations', '/production',
  '/native-login', '/native-auth-bridge', '/login', '/register', '/reset-password', '/rewards',
  '/notifications', '/order-tracker/test', '/shop/x/y', '/unknown', '', 'shop', '//outside.invalid'];
for (const pathname of gatedRoutes) assert.equal(policy.canRenderPublicStorefront({ pathname }), false, pathname);
for (const key of ['access_token', 'clear_access_token', 'code', 'state', 'error', 'is_new_user',
  'native_provider_callback', 'native_browser_callback', 'reset_sign_in']) {
  assert.equal(policy.canRenderPublicStorefront({ pathname: '/', search: `?${key}=test` }), false);
  assert.equal(policy.canRenderPublicStorefront({ pathname: '/', hash: `#${key}=test` }), false);
}
checks.push('Explicit public route allowlist; native, callbacks, cart, checkout, protected and unknown routes stay gated');

// Real app-param initialization strips token fields. Its boolean snapshot must survive.
const storage = new Map();
const location = new URL('https://example.test/?access_token=synthetic-only');
const params = load('src/lib/app-params.js', {
  '@capacitor/core': { Capacitor: { isNativePlatform: () => false } },
  './publicStorefrontStartup': policy,
}, { document: { title: 'Local test' }, window: { location, localStorage: {
  getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
}, history: { replaceState: (_state, _title, route) => { location.href = new URL(route, location).href; } } } });
assert.equal(params.startedWithAuthReturn, true);
assert.equal(location.search, '');
assert.equal(policy.canRenderPublicStorefront({ pathname: '/', startedWithAuthReturn: params.startedWithAuthReturn }), false);
checks.push('Auth-return boundary survives token URL cleanup before App mounts');

let route = '/';
let native = false;
let initialCallback = false;
let auth;
let profile;
const pass = ({ children }) => children;
const empty = () => null;
const page = () => React.createElement('main', { 'data-route-rendered': route }, 'Storefront content');
const imports = {
  react: { ...React, lazy: () => page },
  'react-helmet-async': { HelmetProvider: pass },
  '@tanstack/react-query': { QueryClientProvider: pass, useQuery: () => profile },
  'react-router-dom': { ...Router,
    BrowserRouter: ({ children }) => React.createElement(Router.MemoryRouter, { initialEntries: [route] }, children),
    Navigate: ({ to }) => React.createElement('div', { 'data-redirect': to }),
  },
  '@/lib/AuthContext': { AuthProvider: pass, useAuth: () => auth },
  '@/lib/cartContext': { CartProvider: pass },
  '@/components/layout/AppLayout': { default: Router.Outlet },
  '@/components/StartupStatus': { default: ({ phase }) => React.createElement('div', { 'data-startup-phase': phase }, 'Waiting') },
  '@/components/ui/sonner': { Toaster: empty },
  '@/components/AppErrorBoundary': { default: pass },
  './lib/PageNotFound': { default: () => React.createElement('div', null, 'Not found') },
  '@/components/UserNotRegisteredError': { default: () => React.createElement('div', null, 'Not registered') },
  '@/lib/onboardingQuery': { onboardingQueryOptions: () => ({}) },
  '@/lib/startupPages': { preloadStartupPage: empty, startupPageLoaders: {} },
  '@/lib/nativeAuthRedirect': { hasBase44AuthParamsInUrl: () => false, redirectToLogin: empty },
  '@/lib/admin-access': { isAdminUser: user => user?.role === 'admin' },
  '@/lib/nativeRuntime': { isNativeAppRuntime: () => native },
  '@/lib/app-params': { get startedWithAuthReturn() { return initialCallback; } },
  '@/lib/publicStorefrontStartup': policy,
  '@/lib/pushNotifications': { ensureAuthenticatedNativePushRegistration: empty, installNativePushListeners: empty },
  '@/lib/deliveryLiveActivity': { ensureDeliveryLiveActivityRegistration: empty, installDeliveryLiveActivityListeners: empty },
};
for (const name of ['ScrollToTop', 'LowercaseRedirect', 'SeoHeadSanitizer', 'AnalyticsConsent']) {
  imports[`@/components/${name}`] = { default: empty };
}
const App = load('src/App.jsx', imports).default;
function render(pathname, { loading = true, user = null, error = null, pending = false, failed = false, data } = {}) {
  route = pathname;
  auth = { isLoadingAuth: loading, isLoadingPublicSettings: loading, user, authError: error,
    navigateToLogin: empty, checkAppState: empty, authSessionEpoch: 0, sessionQueryClient: {} };
  profile = { data, isLoading: pending, isError: failed, refetch: empty };
  const originalError = console.error;
  console.error = (message, ...args) => {
    // MemoryRouter is intentionally rendered without a browser in this contract test.
    if (String(message).startsWith('Warning: useLayoutEffect does nothing on the server')) return;
    originalError(message, ...args);
  };
  try {
    return renderToStaticMarkup(React.createElement(App));
  } finally {
    console.error = originalError;
  }
}
const verified = { id: 'test-user', email: 'member@example.test' };
for (const pathname of ['/', '/shop', '/product/oasis.html', '/program/radiance']) {
  assert.match(render(pathname), /data-route-rendered/, `Public content waits for auth: ${pathname}`);
  assert.match(render(pathname, { loading: false, user: verified, pending: true }), /data-route-rendered/);
  assert.match(render(pathname, { loading: false, user: verified, failed: true }), /data-route-rendered/);
  assert.match(render(pathname, { loading: false, error: { type: 'bootstrap_timeout' } }), /data-route-rendered/);
  assert.match(render(pathname, { loading: false, error: { type: 'bootstrap_error' } }), /data-route-rendered/);
}
checks.push('Actual App renders public content with pending auth/profile and failed background reads');
for (const pathname of gatedRoutes.filter(p => p.startsWith('/') && !p.startsWith('//'))) {
  assert.match(render(pathname), /data-startup-phase="auth"/, pathname);
}
native = true;
assert.match(render('/'), /data-startup-phase="auth"/);
native = false;
initialCallback = true;
assert.match(render('/'), /data-startup-phase="auth"/);
initialCallback = false;
assert.match(render('/?access_token=test'), /data-startup-phase="auth"/);
assert.match(render('/account', { loading: false, user: verified, pending: true }), /data-startup-phase="profile"/);
assert.match(render('/checkout', { loading: false, user: verified, failed: true }), /could not load your account setup/);
assert.match(render('/account', { loading: false, error: { type: 'bootstrap_timeout' } }), /Sign-in check timed out/);
assert.doesNotMatch(render('/admin/orders', { loading: false, user: verified, data: { onboarding_complete: true } }), /data-route-rendered/);
assert.match(render('/admin/orders', { loading: false, user: verified, data: { onboarding_complete: true } }), /Admin access required/);
checks.push('Actual App retains native/callback/protected loading, checkout profile recovery and admin authorization');
for (const data of [null, { onboarding_complete: false }]) {
  assert.match(render('/', { loading: false, user: verified, data }), /data-redirect="\/account-setup/);
  assert.doesNotMatch(render('/', { loading: true, user: verified, data }), /data-redirect/);
}
assert.match(render('/', { loading: false, error: { type: 'user_not_registered' } }), /Not registered/);
assert.doesNotMatch(render('/', { loading: false, error: { type: 'auth_required' } }), /data-route-rendered/);
const app = read('src/App.jsx');
assert.match(app, /QueryClientProvider key=\{authSessionEpoch\} client=\{sessionQueryClient\}/);
assert.match(read('src/lib/AuthContext.jsx'), /await checkUserAuth\(\{ timeoutMs: authTimeoutMs \}\)/);
checks.push('Verified incomplete profiles still enter onboarding; auth-required errors and principal-isolated caches remain enforced');

const home = read('src/pages/Home.jsx');
assert.match(home, /data: products = \[\], refetch: refetchProducts/);
assert.doesNotMatch(home, /useQuery\(\{ queryKey: \['products'\] \}\)/);
assert.doesNotMatch(home, /base44\.entities\.UserProfile/);
assert.match(home, /await refetchProducts\(\)/);
checks.push('Homepage reuses the product-query refetch and no longer performs an unused duplicate profile read');

console.log(JSON.stringify({ ok: true, suite: 'public-storefront-startup', checks,
  real_network_requests: 0, provider_calls: false, production_writes: false }, null, 2));
