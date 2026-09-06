#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transformSync } from 'esbuild';
import { createClient } from '@base44/sdk';
import * as handoff from '../../src/lib/nativeAuthHandoff.js';
import * as operation from '../../src/lib/authOperation.js';
import * as sessions from '../../src/lib/authQuerySession.js';

const checks = [];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const values = new Map();
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
const pendingKey = handoff.NATIVE_AUTH_HANDOFF_STORAGE_KEY;
const makeFlow = async () => {
  const url = await handoff.prepareNativeAuthHandoff('https://nuvira.invalid/native-auth-bridge', '/account/programs', { storage });
  return handoff.encryptNativeAuthHandoff(url, 'synthetic-old-bearer');
};
const pausedCrypto = (method, started, gate) => ({
  getRandomValues: webcrypto.getRandomValues.bind(webcrypto),
  subtle: new Proxy(webcrypto.subtle, {
    get: (target, key) => key === method ? async (...args) => {
      started.resolve(); await gate.promise;
      return target[key](...args);
    } : target[key].bind(target),
  }),
});
const prepStart = deferred(), prepGate = deferred();
const prepEpoch = operation.beginAuthOperation();
const oldPrepare = handoff.prepareNativeAuthHandoff('https://nuvira.invalid/native-auth-bridge', '/old', {
  storage, cryptoApi: pausedCrypto('generateKey', prepStart, prepGate),
  isCurrent: () => operation.isCurrentAuthOperation(prepEpoch),
});
const rejectedPrepare = assert.rejects(oldPrepare, /native_auth_handoff_interrupted/);
await prepStart.promise;
operation.beginAuthOperation();
handoff.clearNativeAuthHandoff({ storage });
await makeFlow();
const newerPending = storage.getItem(pendingKey);
prepGate.resolve();
await rejectedPrepare;
assert.equal(storage.getItem(pendingKey), newerPending);
checks.push('canceled key generation cannot recreate old pending state or replace a newer attempt');

const oldCallback = await makeFlow();
const decryptStart = deferred(), decryptGate = deferred();
const decryptEpoch = operation.currentAuthOperation();
const oldConsume = handoff.consumeNativeAuthHandoff(oldCallback, {
  storage, cryptoApi: pausedCrypto('decrypt', decryptStart, decryptGate),
  isCurrent: () => operation.isCurrentAuthOperation(decryptEpoch),
});
const rejectedConsume = assert.rejects(oldConsume, /native_auth_handoff_invalid/);
await decryptStart.promise;
operation.beginAuthOperation();
handoff.clearNativeAuthHandoff({ storage });
await makeFlow();
const replacementPending = storage.getItem(pendingKey);
decryptGate.resolve();
await rejectedConsume;
assert.equal(storage.getItem(pendingKey), replacementPending);
checks.push('logout/new attempt during actual decryption rejects old bearer and preserves newer pending state');

const duplicate = await makeFlow();
const duplicateResults = await Promise.allSettled([
  handoff.consumeNativeAuthHandoff(duplicate, { storage }),
  handoff.consumeNativeAuthHandoff(duplicate, { storage }),
]);
assert.equal(duplicateResults.filter(result => result.status === 'fulfilled').length, 1);
assert.equal(duplicateResults.filter(result => result.status === 'rejected').length, 1);
checks.push('concurrent duplicate encrypted callback can be consumed only once');

const load = (file, imports, globals = {}) => {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { format: 'cjs', loader: 'jsx' }).code, {
    module, exports: module.exports, URL, URLSearchParams, Event, AbortController,
    console, setTimeout, clearTimeout, ...globals,
    require: key => { assert.ok(key in imports, key); return imports[key]; },
  });
  return module.exports;
};
const savedWindow = globalThis.window;
const savedFetch = globalThis.fetch;
try {
  let url = new URL('https://nuvira.invalid/account');
  const location = { replace: route => { url = new URL(route, url); } };
  for (const key of ['href', 'origin', 'pathname', 'search', 'hash', 'hostname']) {
    Object.defineProperty(location, key, { get: () => url[key] });
  }
  const window = {
    localStorage: storage, sessionStorage: storage, location, setTimeout, clearTimeout,
    history: { replaceState: (_state, _title, route) => { url = new URL(route, url); } },
    dispatchEvent: () => {}, scrollTo: () => {},
  };
  let fetchGate = null;
  const fetch = () => {
    assert.ok(fetchGate, 'Unexpected network request');
    return fetchGate.promise;
  };
  globalThis.window = window;
  globalThis.fetch = fetch;
  const base44 = createClient({ appId: 'synthetic-app', serverUrl: 'https://nuvira.invalid', appBaseUrl: 'https://nuvira.invalid', requiresAuth: false, analytics: { enabled: false } });
  let consumeGate;
  const globals = { window, localStorage: storage, document: { title: '', activeElement: null }, fetch };
  const redirects = load('src/lib/nativeAuthRedirect.js', {
    '@/api/base44Client': { base44 },
    '@/lib/app-params': { appParams: { appId: 'synthetic-app', appBaseUrl: 'https://nuvira.invalid' } },
    '@/lib/authReturnTo': load('src/lib/authReturnTo.js', {}, globals),
    '@/lib/authOperation': operation,
    '@/lib/nativeAuthHandoff': {
      ...handoff,
      clearNativeAuthHandoff: () => handoff.clearNativeAuthHandoff({ storage }),
      consumeNativeAuthHandoff: () => consumeGate.promise,
    },
  }, globals);
  consumeGate = deferred();
  const callbackResult = redirects.consumeNativeAuthCallbackUrl('nuvira://auth/callback?synthetic=1');
  redirects.clearBase44AuthTokens();
  consumeGate.resolve({ accessToken: 'synthetic-old-bearer', returnTo: '/account/programs' });
  assert.equal(await callbackResult, null);
  assert.equal(storage.getItem('base44_access_token'), null);
  checks.push('actual callback consumer checks operation before SDK setToken after awaited handoff');

  for (const reset of [false, true]) {
    fetchGate = deferred();
    const logout = reset ? redirects.resetSignInAndReload('/account') : redirects.logoutInsideApp('/account');
    // A fresh SDK login also protects against late logout, even if a legacy
    // email caller did not explicitly advance the new operation epoch.
    base44.auth.setToken('synthetic-new-bearer');
    redirects.replaceInAppRoute('/account?tab=orders');
    fetchGate.resolve(new Response('{}', { status: 200 }));
    await logout;
    redirects.consumeBase44AuthFromUrl();
    assert.equal(url.pathname + url.search, '/account?tab=orders');
    assert.equal(storage.getItem('base44_access_token'), 'synthetic-new-bearer');
  }
  fetchGate = deferred();
  const delayedLogout = redirects.logoutInsideApp('/account');
  redirects.beginNativeSignInAttempt();
  redirects.replaceInAppRoute('/native-login?return_to=%2Frewards');
  fetchGate.resolve(new Response('{}', { status: 200 }));
  await delayedLogout;
  assert.equal(url.pathname + url.search, '/native-login?return_to=%2Frewards');
  checks.push('late hosted logout/reset cannot navigate over a fresh bearer or newer pending sign-in');

  for (const pause of ['consume', 'close', 'none']) {
    const state = [], effects = [];
    let cursor = 0, listener, meCalls = 0, navigations = 0;
    const consume = deferred(), close = deferred(), closeStarted = deferred();
    const react = {
      createContext: () => ({ Provider: 'Provider' }),
      createElement: (_type, props) => props,
      useState: initial => {
        const i = cursor++;
        if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
        return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next; }];
      },
      useRef: initial => {
        const i = cursor++;
        if (!(i in state)) state[i] = { current: initial };
        return state[i];
      },
      useCallback: fn => fn,
      useEffect: fn => effects.push(fn),
    };
    const contextModule = load('src/lib/AuthContext.jsx', {
      react,
      '@capacitor/core': { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => true, Plugins: { App: { addListener: (_event, fn) => { listener = fn; return { remove() {} }; } } } } },
      '@capacitor/browser': { Browser: { close: () => { closeStarted.resolve(); return close.promise; } } },
      '@/api/base44Client': { base44: { auth: { me: async () => { meCalls++; return { id: 'synthetic-a', email: 'synthetic@example.invalid' }; } } } },
      '@/lib/app-params': { appParams: { appId: 'synthetic-app' } },
      '@/lib/authQuerySession': sessions,
      '@/lib/authOperation': operation,
      '@/lib/rewardManager': { clearAllRewardsOnLogout: () => {} },
      '@/lib/nativeAuthRedirect': { ...redirects, consumeBase44AuthFromUrl: () => {}, consumeNativeAuthCallbackUrl: () => consume.promise, replaceInAppRoute: () => { navigations++; } },
      '@/lib/googleAnalytics': { captureGoogleProviderAuthEvent: () => null, completeGoogleProviderAuthEvent: () => false, discardGoogleProviderAuthEvent: () => {} },
      '@/lib/metaPixel': { consumeMetaRegistrationEvent: () => {} },
      '@/lib/snapPixel': { consumeSnapRegistrationEvent: () => {} },
    }, globals);
    const render = () => { cursor = 0; return contextModule.AuthProvider({ children: null }).value; };
    const context = render();
    effects[1](); // Register the actual native URL effect without live bootstrap.
    redirects.beginNativeSignInAttempt();
    const handling = listener({ url: `nuvira://auth/callback?synthetic=${pause}` });
    if (pause === 'consume') await context.logout(false);
    consume.resolve({ accessToken: 'synthetic-a', returnTo: '/account/programs' });
    if (pause === 'close') {
      await closeStarted.promise;
      await context.logout(false);
    }
    close.resolve();
    await handling;
    const result = render();
    assert.equal(meCalls, pause === 'none' ? 1 : 0);
    assert.equal(navigations, pause === 'none' ? 1 : 0);
    assert.equal(Boolean(result.user), pause === 'none');
    result.sessionQueryClient.clear();
  }
  checks.push('actual native URL effect rejects logout during consume/Browser.close; uninterrupted callback still signs in');
} finally {
  globalThis.window = savedWindow;
  globalThis.fetch = savedFetch;
}

const login = fs.readFileSync('src/pages/NativeLogin.jsx', 'utf8');
assert.match(login, /const operation = beginNativeSignInAttempt\(\)/);
assert.match(login, /await getNativeBrowserProviderReturnUrl\(returnTo\);\s*if \(!isCurrentAuthOperation\(operation\)\) return/);
assert.match(login, /await NativeWebAuth\.authenticate\([\s\S]*?\}\);\s*if \(!isCurrentAuthOperation\(operation\)\) return/);
assert.match(login, /await consumeNativeAuthCallbackUrl\([^\n]+\);\s*if \(!isCurrentAuthOperation\(operation\)\) return/);
assert.match(login, /await checkAppState\(\{ authTimeoutMs: NATIVE_LOGIN_AUTH_TIMEOUT_MS \}\);\s*if \(!isCurrentAuthOperation\(operation\)\) return/);
assert.match(login, /error\?\.code === 'AUTH_CANCELED'\) \{\s*beginNativeSignInAttempt\(\)/);
checks.push('provider launch/return awaits and cancellation are bound to the initiating operation');
console.log(JSON.stringify({ ok: true, suite: 'g186-native-auth-interleavings', checks, provider_calls: false, production_writes: false }, null, 2));
