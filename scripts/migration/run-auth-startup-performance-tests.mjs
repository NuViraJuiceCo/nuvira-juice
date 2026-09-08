#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient } from '@tanstack/react-query';

const checks = [];
const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const { code } = transformSync(read(file), {
    loader: file.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs',
    supported: { 'dynamic-import': false },
  });
  vm.runInNewContext(code, {
    module, exports: module.exports, console, setTimeout, clearTimeout,
    require: name => { assert.ok(name in imports, name); return imports[name]; },
    ...globals,
  });
  return module.exports;
}

const loaded = [];
let rejectPage = false;
const pages = Object.fromEntries(['Home', 'Shop', 'Account', 'AccountSetup', 'NativeLogin', 'OrderHistory', 'OrderTracker']
  .map(name => [`@/pages/${name}`, { default: () => null }]));
const loaders = load('src/lib/startupPages.js', new Proxy(pages, {
  get: (target, key) => {
    loaded.push(key);
    if (rejectPage) throw new Error('synthetic_chunk_offline');
    return target[key];
  },
}));
for (const [route, key] of [
  ['/', 'home'], ['/shop', 'shop'], ['/account?tab=orders', 'account'],
  ['/native-login?native_provider_callback=1', 'nativeLogin'],
  ['/account-setup?return_to=%2Faccount', 'accountSetup'],
  ['/account/orders#recent', 'orderHistory'], ['/order-tracker/NV-LOCAL', 'orderTracker'],
]) {
  assert.equal(loaders.startupPageKey(route), key);
  assert.equal(await loaders.preloadStartupPage(route), true);
}
assert.equal(loaded.length, 7);
for (const route of ['https://outside.invalid/account', '//outside.invalid', '/admin/orders', '/accounting', '/order-trackers']) {
  assert.equal(await loaders.preloadStartupPage(route), false);
}
assert.equal(loaded.length, 7, 'Unknown routes must not load arbitrary code');
rejectPage = true;
assert.equal(await loaders.preloadStartupPage('/account'), false, 'Warmup failure must not reject sign-in');
rejectPage = false;
assert.equal(await loaders.preloadStartupPage('/account'), true);
checks.push('allowlisted page code warms safely; unknown routes and failed imports cannot interrupt sign-in');

let calls = 0;
let result = { onboarding_complete: false, first_name: 'Test' };
const query = load('src/lib/onboardingQuery.js', {
  '@/api/base44Client': { base44: { entities: { UserProfile: { filter: async (filter, sort, limit) => {
    calls++;
    assert.equal(filter.customer_email, 'first@example.test');
    assert.equal(limit, 1);
    return result ? [result] : [];
  } } } } },
});
const client = new QueryClient();
const options = query.onboardingQueryOptions('first@example.test');
try {
  const [first, second] = await Promise.all([client.fetchQuery(options), client.fetchQuery(options)]);
  assert.equal(first, second);
  assert.equal(calls, 1, 'Concurrent observers must share the read');
  assert.equal(await client.ensureQueryData(options), first);
  assert.equal(calls, 1, 'Account setup must reuse the verified session profile');
  result = { onboarding_complete: true, first_name: 'Test' };
  await client.invalidateQueries({ queryKey: options.queryKey, refetchType: 'none' });
  assert.equal((await client.fetchQuery(options)).onboarding_complete, true);
  assert.equal(calls, 2, 'Successful setup must still permit an explicit fresh read');
  client.clear();
  result = null;
  assert.equal(await client.fetchQuery(options), null, 'A missing profile is not complete');
  assert.equal(calls, 3, 'A new query session must not reuse a prior identity cache');
  assert.equal(options.retry, false);
  checks.push('profile reads deduplicate, setup reuses them, invalidation refreshes, session clearing discards them');
} finally {
  client.clear();
}

let expire;
let cleaned = 0;
let finishLate;
const timedQuery = load('src/lib/onboardingQuery.js', {
  '@/api/base44Client': { base44: { entities: { UserProfile: { filter: () => new Promise(resolve => { finishLate = resolve; }) } } } },
}, {
  setTimeout: (callback, ms) => { assert.equal(ms, 8000); expire = callback; return 1; },
  clearTimeout: () => { cleaned++; },
});
const timed = timedQuery.onboardingQueryOptions('timeout@example.test').queryFn();
const timedRejection = assert.rejects(timed, /profile_read_timeout/);
expire();
await timedRejection;
finishLate([{ onboarding_complete: true }]);
assert.equal(cleaned, 1);
checks.push('hung profile reads fail closed at eight seconds; a late response cannot reverse the timeout');

const status = load('src/components/StartupStatus.jsx', {
  react: React, '@/lib/brandImages': { BRAND_IMAGES: { wordmark: '/images/brand/nuvira-wordmark.webp' } },
}).default;
for (const [phase, text] of [['auth', 'Confirming your sign-in...'], ['profile', 'Loading your account...'], ['page', 'Opening NuVira...']]) {
  const markup = renderToStaticMarkup(React.createElement(status, { phase }));
  assert.ok(markup.includes(text));
  assert.ok(markup.includes('role="status"'));
  assert.ok(markup.includes('/images/brand/nuvira-wordmark.webp'));
}
checks.push('real loading phases render accessible status and the local optimized logo');

const app = read('src/App.jsx');
assert.doesNotMatch(app, /SplashScreen|showSplash|splashShown/);
assert.doesNotMatch(read('src/components/StartupStatus.jsx'), /setTimeout|useEffect/);
assert.ok(app.indexOf('void preloadStartupPage(location.pathname)') < app.indexOf('if (isLoadingPublicSettings'));
assert.match(app, /\.\.\.onboardingQueryOptions\(user\?\.email\)/);
assert.match(app, /profileRequestFailed/);
assert.match(app, /profileMissing \|\| profileLoadedAndIncomplete/);
assert.match(app, /enabled: Boolean\(user\?\.email && !isResetSignInRoute\)/);
const setup = read('src/pages/AccountSetup.jsx');
assert.match(setup, /queryClient\.ensureQueryData\(onboardingQueryOptions\(user.email\)\)/);
assert.match(setup, /if \(active && profile\)/);
assert.match(setup, /refetchQueries\(\{ queryKey: \['user-onboarding-check'\] \}\)/);
const nativeLogin = read('src/pages/NativeLogin.jsx');
assert.match(nativeLogin, /if \(IS_NATIVE_PLATFORM\) void preloadStartupPage\(returnTo\)/);
assert.match(nativeLogin, /await checkAppState\(\{ authTimeoutMs: NATIVE_LOGIN_AUTH_TIMEOUT_MS \}\)/);
assert.match(nativeLogin, /if \(!isCurrentAuthOperation\(operation\)\) return/);
checks.push('no post-ready splash timer; warmup is nonblocking; auth, reset, onboarding and supersession gates remain');

console.log(JSON.stringify({ ok: true, suite: 'auth-startup-performance', checks, real_network_requests: 0, provider_calls: false, production_writes: false }, null, 2));
