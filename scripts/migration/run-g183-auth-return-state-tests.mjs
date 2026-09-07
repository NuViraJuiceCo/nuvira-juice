#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createClient } from '@base44/sdk';
import * as authOperation from '../../src/lib/authOperation.js';

function loadModule(file, imports, globals) {
  const { code } = transformSync(fs.readFileSync(file, 'utf8'), { format: 'cjs', target: 'node20' });
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, URLSearchParams, Event, console,
    require: name => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    ...globals,
  });
  return module.exports;
}

const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const checks = [];
try {
  let currentUrl = new URL('https://nuvira.invalid/account');
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
  const location = Object.fromEntries(['href', 'origin', 'pathname', 'search', 'hash', 'hostname'].map(key => [key, null]));
  for (const key of Object.keys(location)) Object.defineProperty(location, key, { get: () => currentUrl[key] });
  const window = {
    localStorage: storage, sessionStorage: storage, location,
    history: { replaceState: (_state, _title, route) => { currentUrl = new URL(route, currentUrl); } },
    dispatchEvent: () => {}, scrollTo: () => {},
  };
  globalThis.window = window;
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, headers: new Headers(init.headers) });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  globalThis.fetch = fetch;
  const base44 = createClient({
    appId: 'synthetic-app', serverUrl: 'https://nuvira.invalid',
    appBaseUrl: 'https://nuvira.invalid', requiresAuth: false, analytics: { enabled: false },
  });
  let pendingReturn;
  let nextToken;
  const globals = { window, localStorage: storage, document: { title: '', activeElement: null }, fetch };
  const returnHelpers = loadModule('src/lib/authReturnTo.js', {}, globals);
  const redirects = loadModule('src/lib/nativeAuthRedirect.js', {
    '@/api/base44Client': { base44 },
    '@/lib/app-params': { appParams: { appId: 'synthetic-app', appBaseUrl: 'https://nuvira.invalid' } },
    '@/lib/authReturnTo': returnHelpers,
    '@/lib/authOperation': authOperation,
    '@/lib/nativeAuthHandoff': {
      prepareNativeAuthHandoff: async (url, returnTo) => { pendingReturn = returnTo; return url; },
      clearNativeAuthHandoff: () => {},
      consumeNativeAuthHandoff: async () => ({ accessToken: nextToken, returnTo: pendingReturn }),
      encryptNativeAuthHandoff: async () => { throw new Error('Not part of this test'); },
    },
  }, globals);

  base44.auth.setToken('synthetic-initial');
  for (const provider of ['google', 'google', 'apple']) {
    await redirects.logoutInsideApp('/account');
    assert.equal(storage.getItem('base44_access_token'), null, 'Logout must still clear storage');
    // The protected route captures its complete URL when it redirects to login.
    await redirects.redirectToLogin(`${location.pathname}${location.search}`);
    const returnTo = new URLSearchParams(location.search).get('return_to');
    const browserUrl = await redirects.getNativeBrowserProviderReturnUrl(returnTo);
    const providerUrl = redirects.getProviderLoginUrl(provider, browserUrl);
    assert.equal(new URL(providerUrl).origin, 'https://app.base44.com');
    nextToken = `synthetic-${provider}-${checks.length}`;
    const callback = await redirects.consumeNativeAuthCallbackUrl('nuvira://auth/callback?synthetic=1');
    redirects.replaceInAppRoute(callback.returnTo);
    // AuthContext handles a focus/pageshow event after the native sheet closes.
    redirects.consumeBase44AuthFromUrl();
    await base44.functions.fetch('getAdminOperationsDashboardSummary', { method: 'POST', body: '{}' });
    assert.equal(requests.at(-1).headers.get('Authorization'), `Bearer ${nextToken}`,
      'The post-login destination must not clear the newly issued token');
    assert.equal(location.pathname, '/account');
    assert.equal(new URLSearchParams(location.search).has('clear_access_token'), false);
    checks.push(`${provider}: logout, protected redirect, native callback, focus, gateway retain new token`);
  }

  const { sanitizeAuthReturnRoute } = returnHelpers;
  assert.equal(typeof sanitizeAuthReturnRoute, 'function');
  assert.equal(sanitizeAuthReturnRoute('/account?clear_access_token=true&signed_out=1&tab=orders#recent'), '/account?tab=orders#recent');
  assert.equal(sanitizeAuthReturnRoute('/checkout?access_token=old&app_id=other&app_base_url=https%3A%2F%2Fother.invalid&functions_version=old&from_url=old&reset_sign_in=1&bag=return#payment'), '/checkout?bag=return#payment');
  assert.equal(sanitizeAuthReturnRoute('/account?native_provider_callback=1&native_browser_callback=1&is_new_user=true'), '/account');
  for (const unsafe of ['//outside.invalid', '/\\outside.invalid', '/.//outside.invalid', 'https://outside.invalid', null]) {
    assert.equal(sanitizeAuthReturnRoute(unsafe), '/');
  }
  checks.push('return destinations discard auth/bootstrap/logout state while retaining normal query and hash');
  checks.push('external and ambiguous navigation targets are rejected');

  const login = fs.readFileSync('src/pages/NativeLogin.jsx', 'utf8');
  assert.match(login, /sanitizeAuthReturnRoute\(searchParams\.get\('return_to'\)\)/);
  assert.doesNotMatch(login, /function normalizeReturnRoute/);
  checks.push('native sign-in uses the shared post-auth destination sanitizer');
  console.log(JSON.stringify({ ok: true, suite: 'g183-auth-return-state', checks, real_network_requests: 0, provider_calls: false, production_writes: false }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
