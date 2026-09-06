#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { QueryObserver, timeoutManager } from '@tanstack/react-query';
import * as sessions from '../../src/lib/authQuerySession.js';
import * as authOperation from '../../src/lib/authOperation.js';

// Retired queries may keep GC timers after cancellation. They must not keep a
// completed Node-only harness alive; assertions still await every test request.
timeoutManager.setTimeoutProvider({
  setTimeout: (callback, delay) => setTimeout(callback, delay).unref(),
  clearTimeout,
  setInterval: (callback, delay) => setInterval(callback, delay).unref(),
  clearInterval,
});

const checks = [];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const boundary = sessions.createAuthSessionBoundary();
const allClients = new Set([boundary.getSession().client]);
const transition = (user, options) => {
  const session = boundary.transition(user, options);
  allClients.add(session.client);
  return session;
};
const a = transition({ id: 'synthetic-a' });
const key = ['program-journeys'];
const privateA = { journeys: [{ id: 'synthetic-a-journey', status: 'in_progress' }] };
a.client.setQueryData(key, privateA);
a.client.setQueryData(['my-bag-returns'], [{ id: 'synthetic-a-return' }]);
assert.equal(transition({ id: 'synthetic-a', first_name: 'Updated' }), a);
assert.equal(a.client.getQueryData(key), privateA);
checks.push('same-principal refresh preserves client, epoch, and cached state');

const lateRead = deferred();
const readResult = a.client.fetchQuery({ queryKey: ['late-private-read'], queryFn: () => lateRead.promise }).catch(() => null);
const lateMutation = deferred();
const mutationStarted = deferred();
let callbackEffects = 0;
const mutation = a.client.getMutationCache().build(a.client, sessions.guardSessionMutationOptions(a.client, {
  gcTime: 0,
  mutationFn: () => { mutationStarted.resolve(); return lateMutation.promise; },
  onSuccess: data => { callbackEffects++; a.client.setQueryData(key, data); },
  onError: () => { callbackEffects++; },
  onSettled: () => { callbackEffects++; },
}));
const mutationResult = mutation.execute({ action: 'synthetic-only' });
await mutationStarted.promise;
const anonymous = transition(null, { force: true });
assert.notEqual(anonymous.client, a.client);
assert.equal(a.client.getQueryCache().getAll().length, 0);
assert.equal(a.client.getMutationCache().getAll().length, 0);
assert.equal(anonymous.client.getQueryData(key), undefined);
assert.equal(anonymous.client.getQueryData(['my-bag-returns']), undefined);
const b = transition({ id: 'synthetic-b' });
assert.notEqual(b.client, a.client);
assert.ok(b.epoch > anonymous.epoch);
const bRead = deferred();
const bObserver = new QueryObserver(b.client, { queryKey: key, queryFn: () => bRead.promise });
const stopObserver = bObserver.subscribe(() => {});
assert.equal(bObserver.getCurrentResult().data, undefined);
lateRead.resolve(privateA);
lateMutation.resolve(privateA);
await Promise.all([readResult, mutationResult]);
assert.equal(callbackEffects, 0, 'Retired callbacks must not write cache, show UI, or emit measurement');
assert.equal(a.client.getQueryData(key), undefined);
assert.equal(b.client.getQueryData(key), undefined);
assert.equal(b.client.getQueryData(['late-private-read']), undefined);
bRead.reject(Object.assign(new Error('Unauthorized'), { status: 401 }));
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(bObserver.getCurrentResult().isError, true);
assert.equal(bObserver.getCurrentResult().data, undefined);
stopObserver();
checks.push('A -> signed-out -> B isolates list/detail caches, late reads/mutations, and B 401');

const guardedOld = sessions.guardSessionMutationOptions(a.client, {
  mutationFn: () => { throw new Error('retired mutation was invoked'); },
  onSuccess: () => { callbackEffects++; },
  onError: () => { callbackEffects++; },
  onSettled: () => { callbackEffects++; },
});
await assert.rejects(guardedOld.mutationFn(), /auth_session_changed/);
guardedOld.onSuccess(); guardedOld.onError(); guardedOld.onSettled();
assert.equal(callbackEffects, 0);
let currentEffects = 0;
const currentOptions = sessions.guardSessionMutationOptions(b.client, { onSuccess: () => currentEffects++ });
currentOptions.onSuccess();
assert.equal(currentEffects, 1);
// Even an unguarded legacy closure holding A's client cannot populate B's cache.
a.client.setQueryData(key, privateA);
assert.equal(b.client.getQueryData(key), undefined);
checks.push('retired hook and per-call mutation callbacks are suppressed; current callbacks still run');

const errorStarted = deferred();
const lateError = deferred();
let errorEffects = 0;
const errorMutation = b.client.getMutationCache().build(b.client, sessions.guardSessionMutationOptions(b.client, {
  gcTime: 0,
  mutationFn: () => { errorStarted.resolve(); return lateError.promise; },
  onError: () => { errorEffects++; },
  onSettled: () => { errorEffects++; },
}));
const errorResult = errorMutation.execute({}).catch(error => error.message);
await errorStarted.promise;
transition(null, { force: true });
lateError.reject(new Error('synthetic-late-error'));
assert.equal(await errorResult, 'synthetic-late-error');
assert.equal(errorEffects, 0);
checks.push('actual retired mutation rejection suppresses error and settled side effects');

function load(file, imports, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { format: 'cjs', loader: 'jsx' }).code, {
    module, exports: module.exports, console, setTimeout, clearTimeout, ...globals,
    require: key => { assert.ok(key in imports, key); return imports[key]; },
  });
  return module.exports;
}
for (const [enabled, isError] of [[false, false], [true, true]]) {
  const hook = load('src/lib/program-journey-state.js', {
    '@tanstack/react-query': { useQuery: () => ({ data: privateA, isError }) },
    '@/api/base44Client': { invokeCustomerGateway: () => { throw new Error('network forbidden'); } },
  });
  const result = hook.useActiveProgramJourney(enabled);
  assert.equal(result.data, undefined);
  assert.equal(result.journey, null);
  assert.equal(result.journeys.length, 0);
}
checks.push('actual disabled/error journey hook redacts cached data and navigation targets');

// Execute AuthContext itself with a minimal hook scheduler and controlled me().
const state = [];
let cursor = 0;
const react = {
  createContext: () => ({ Provider: 'Provider' }),
  createElement: (_type, props) => props,
  useState: initial => {
    const i = cursor++;
    if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
    return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }];
  },
  useRef: initial => {
    const i = cursor++;
    if (!(i in state)) state[i] = { current: initial };
    return state[i];
  },
  useCallback: fn => fn,
  useEffect: () => {},
};
let pendingMe;
const authModule = load('src/lib/AuthContext.jsx', {
  react,
  '@capacitor/core': { Capacitor: {} },
  '@capacitor/browser': { Browser: {} },
  '@/api/base44Client': { base44: { auth: { me: () => pendingMe.promise } } },
  '@/lib/app-params': { appParams: { appId: 'synthetic-app' } },
  '@/lib/authQuerySession': sessions,
  '@/lib/authOperation': authOperation,
  '@/lib/rewardManager': { clearAllRewardsOnLogout: () => {} },
  '@/lib/nativeAuthRedirect': { consumeBase44AuthFromUrl: () => {}, clearBase44AuthTokens: () => {} },
  '@/lib/googleAnalytics': { captureGoogleProviderAuthEvent: () => null, completeGoogleProviderAuthEvent: () => false, discardGoogleProviderAuthEvent: () => {} },
  '@/lib/metaPixel': { consumeMetaRegistrationEvent: () => {} },
  '@/lib/snapPixel': { consumeSnapRegistrationEvent: () => {} },
});
const render = () => {
  cursor = 0;
  const value = authModule.AuthProvider({ children: null }).value;
  allClients.add(value.sessionQueryClient);
  return value;
};
let context = render();
pendingMe = deferred();
const initialMe = pendingMe;
const initialCheck = context.checkUserAuth();
await context.logout(false);
initialMe.resolve({ id: 'synthetic-a' });
assert.equal(await initialCheck, null);
context = render();
assert.equal(context.user, null);
assert.equal(context.isLoadingAuth, false);
assert.equal(context.isLoadingPublicSettings, false);
assert.ok(context.authSessionEpoch > 0);
checks.push('actual AuthContext rejects pre-logout success even with no prior principal');

pendingMe = deferred();
const oldMe = pendingMe;
const oldCheck = context.checkUserAuth();
pendingMe = deferred();
const newestMe = pendingMe;
const newestCheck = context.checkUserAuth();
newestMe.resolve({ id: 'synthetic-b' });
await newestCheck;
oldMe.resolve({ id: 'synthetic-a' });
assert.equal(await oldCheck, null);
context = render();
assert.equal(context.user.id, 'synthetic-b');
const bClient = context.sessionQueryClient;
const bEpoch = context.authSessionEpoch;
pendingMe = deferred();
const staleFailure = pendingMe;
const staleCheck = context.checkUserAuth();
pendingMe = deferred();
const refresh = context.refreshUser();
pendingMe.resolve({ id: 'synthetic-b' });
await refresh;
staleFailure.reject(Object.assign(new Error('Unauthorized'), { status: 401 }));
await staleCheck;
context = render();
assert.equal(context.user.id, 'synthetic-b');
assert.equal(context.authError, null);
assert.equal(context.sessionQueryClient, bClient);
assert.equal(context.authSessionEpoch, bEpoch);
assert.equal(context.isLoadingAuth, false);
checks.push('actual overlapping auth success/error cannot replace newest identity; same-user refresh stays mounted');

pendingMe = deferred();
const oldRefreshMe = pendingMe;
const oldRefresh = context.refreshUser();
await context.logout(false);
oldRefreshMe.resolve({ id: 'synthetic-b' });
await oldRefresh;
context = render();
assert.equal(context.user, null);
assert.notEqual(context.sessionQueryClient, bClient);
checks.push('actual logout invalidates pending refresh and retires query client');

const app = fs.readFileSync('src/App.jsx', 'utf8');
assert.match(app, /<QueryClientProvider key=\{authSessionEpoch\} client=\{sessionQueryClient\}>/);
assert.match(app, /<Router>\s*<AuthSessionQueries>/);
assert.doesNotMatch(app, /queryClientInstance/);
const scope = fs.readFileSync('src/lib/authQuerySession.js', 'utf8');
assert.doesNotMatch(scope, /localStorage|sessionStorage|base44|fetch\(/);
const cart = fs.readFileSync('src/lib/cartContext.jsx', 'utf8');
assert.match(cart, /useState\(readStoredCart\)/);
assert.match(cart, /getItem\('nuvira_cart'\)/);
const wrapper = fs.readFileSync('src/lib/useSessionMutation.js', 'utf8');
assert.match(wrapper, /mutation\.mutate\(variables, guardSessionMutationOptions\(client, callbacks\)\)/);
assert.match(wrapper, /mutation\.mutateAsync\(variables, guardSessionMutationOptions\(client, callbacks\)\)/);
for (const file of ['src/pages/ProgramJourney.jsx', 'src/pages/Notifications.jsx', 'src/components/account/ProfileAvatar.jsx', 'src/pages/admin/AdminEvents.jsx', 'src/pages/admin/LoyaltyMembers.jsx', 'src/pages/admin/InventoryStatus.jsx', 'src/pages/AdminOrders.jsx']) {
  assert.match(fs.readFileSync(file, 'utf8'), /useSessionMutation as useMutation/);
}
checks.push('keyed query observers keep Router stable, all mutation consumers guarded, cart/consent storage untouched');
for (const client of allClients) client.clear();
console.log(JSON.stringify({ ok: true, suite: 'g185-auth-query-isolation', checks, provider_calls: false, production_writes: false }, null, 2));
