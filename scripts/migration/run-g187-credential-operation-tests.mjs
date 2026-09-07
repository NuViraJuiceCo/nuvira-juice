#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createAuthModule } from '../../node_modules/@base44/sdk/dist/modules/auth.js';
import { createSessionCredentials } from '../../src/lib/sessionCredentials.js';
import * as operation from '../../src/lib/authOperation.js';
import * as sessions from '../../src/lib/authQuerySession.js';

const checks = [];
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const previousWindow = globalThis.window;
const previousFetch = globalThis.fetch;
const storage = new Map();
const localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key),
};
const location = { href: 'https://nuvira.invalid/native-login', origin: 'https://nuvira.invalid' };
let response;
const axios = { defaults: { headers: { common: {} } }, post: () => response.promise };
const functionsAxios = { defaults: { headers: { common: {} } } };
try {
  globalThis.window = { localStorage, location };
  globalThis.fetch = () => { throw new Error('Network forbidden'); };
  const auth = createAuthModule(axios, functionsAxios, 'synthetic-app', { appBaseUrl: 'https://nuvira.invalid' });
  const start = () => createSessionCredentials(auth, operation.beginAuthOperation());
  const assertNewSession = () => {
    assert.equal(localStorage.getItem('base44_access_token'), 'synthetic-new');
    assert.equal(localStorage.getItem('token'), 'synthetic-new');
    assert.equal(axios.defaults.headers.common.Authorization, 'Bearer synthetic-new');
    assert.equal(functionsAxios.defaults.headers.common.Authorization, 'Bearer synthetic-new');
    assert.equal(location.href, 'https://nuvira.invalid/native-login');
  };

  for (const outcome of ['success', '401', '500']) {
    response = deferred();
    const credentials = start();
    const pending = credentials.loginViaEmailPassword('synthetic@example.invalid', 'not-a-real-password');
    const rejected = assert.rejects(pending, { code: 'auth_operation_superseded' });
    start().setToken('synthetic-new');
    if (outcome === 'success') response.resolve({ access_token: 'synthetic-old', user: { id: 'old' } });
    else response.reject(Object.assign(new Error('synthetic failure'), { response: { status: Number(outcome) } }));
    await rejected;
    assertNewSession();
  }
  checks.push('actual SDK late password success/401/500 cannot write an old token, log out, or redirect a newer session');

  response = deferred();
  const valid = start().loginViaEmailPassword('synthetic@example.invalid', 'synthetic-password');
  response.resolve({ access_token: 'synthetic-current', user: { id: 'current' } });
  assert.equal((await valid).access_token, 'synthetic-current');
  assert.equal(functionsAxios.defaults.headers.common.Authorization, 'Bearer synthetic-current');
  response = deferred();
  const invalid = start().loginViaEmailPassword('synthetic@example.invalid', 'synthetic-invalid');
  const expectedInvalid = assert.rejects(invalid, /invalid credentials/);
  response.reject(Object.assign(new Error('invalid credentials'), { response: { status: 401 } }));
  await expectedInvalid;
  assert.equal(location.href, 'https://nuvira.invalid/native-login');
  assert.equal(localStorage.getItem('base44_access_token'), 'synthetic-current');
  checks.push('current password success updates both clients; current invalid password stays on the form without destroying an existing session');

  for (const method of ['register', 'verifyOtp', 'resendOtp', 'resetPasswordRequest']) {
    for (const fail of [false, true]) {
      response = deferred();
      const credentials = start();
      const pending = credentials[method](method === 'register' ? { email: 'synthetic@example.invalid', password: 'synthetic-password' }
        : method === 'verifyOtp' ? { email: 'synthetic@example.invalid', otpCode: 'synthetic-otp' } : 'synthetic@example.invalid');
      const rejected = assert.rejects(pending, { code: 'auth_operation_superseded' });
      start().setToken('synthetic-new');
      if (fail) response.reject(new Error('synthetic failure'));
      else response.resolve({ access_token: 'synthetic-old', success: true });
      await rejected;
      assert.throws(() => credentials.setToken('synthetic-old'), { code: 'auth_operation_superseded' });
      assertNewSession();
    }
  }
  checks.push('actual SDK OTP/register/resend/reset stale success and failure cannot advance the old form or save a token');
} finally {
  globalThis.window = previousWindow;
  globalThis.fetch = previousFetch;
}

// Execute the actual provider with controlled reads, without mounting effects
// or calling any account endpoint.
const state = [];
let cursor = 0, pendingMe, consumeControl = false;
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
  useEffect: () => {},
};
const imports = {
  react,
  '@capacitor/core': { Capacitor: {} },
  '@capacitor/browser': { Browser: {} },
  '@/api/base44Client': { base44: { auth: { me: () => pendingMe.promise } } },
  '@/lib/app-params': { appParams: { appId: 'synthetic-app' } },
  '@/lib/authQuerySession': sessions,
  '@/lib/authOperation': operation,
  '@/lib/rewardManager': { clearAllRewardsOnLogout: () => {} },
  '@/lib/nativeAuthRedirect': {
    consumeBase44AuthFromUrl: () => { if (consumeControl) operation.beginAuthOperation(); },
    clearBase44AuthTokens: () => operation.beginAuthOperation(),
  },
  '@/lib/googleAnalytics': { captureGoogleProviderAuthEvent: () => null, completeGoogleProviderAuthEvent: () => false, discardGoogleProviderAuthEvent: () => {} },
  '@/lib/metaPixel': { consumeMetaRegistrationEvent: () => {} },
  '@/lib/snapPixel': { consumeSnapRegistrationEvent: () => {} },
};
const module = { exports: {} };
vm.runInNewContext(transformSync(fs.readFileSync('src/lib/AuthContext.jsx', 'utf8'), { format: 'cjs', loader: 'jsx' }).code, {
  module, exports: module.exports, console, setTimeout, clearTimeout,
  require: key => { assert.ok(key in imports, key); return imports[key]; },
});
const clients = new Set();
const render = () => {
  cursor = 0;
  const context = module.exports.AuthProvider({ children: null }).value;
  clients.add(context.sessionQueryClient);
  return context;
};
let context = render();
for (const method of ['checkUserAuth', 'refreshUser', 'checkAppState']) {
  for (const fail of [false, true]) {
    operation.beginAuthOperation();
    pendingMe = deferred();
    const read = context[method]();
    operation.beginAuthOperation(); // New provider has not started its me() yet.
    if (fail) pendingMe.reject(Object.assign(new Error('Unauthorized'), { status: 401 }));
    else pendingMe.resolve({ id: 'synthetic-old' });
    assert.equal(await read, null);
    context = render();
    assert.equal(context.user, null);
    assert.equal(context.isLoadingAuth, false);
    assert.equal(context.authError, null);
    assert.equal(context.bootstrapState, 'unauthenticated');
    if (method === 'checkAppState') assert.equal(context.isLoadingPublicSettings, false);
  }
}
checks.push('actual auth/read/refresh rejects old-operation success and error before the new provider starts me(), with loading cleanup');

pendingMe = deferred();
const oldMe = pendingMe;
const oldRead = context.checkUserAuth();
operation.beginAuthOperation();
pendingMe = deferred();
const newestMe = pendingMe;
const newestRead = context.checkUserAuth();
oldMe.resolve({ id: 'synthetic-old' });
await oldRead;
assert.equal(render().isLoadingAuth, true);
newestMe.resolve({ id: 'synthetic-new' });
await newestRead;
context = render();
assert.equal(context.user.id, 'synthetic-new');
const currentClient = context.sessionQueryClient;
pendingMe = deferred();
const staleRefresh = context.refreshUser();
operation.beginAuthOperation();
pendingMe.reject(Object.assign(new Error('Unauthorized'), { status: 401 }));
await staleRefresh;
context = render();
assert.equal(context.user.id, 'synthetic-new');
assert.equal(context.sessionQueryClient, currentClient);
assert.equal(context.bootstrapState, 'authenticated');
checks.push('old read cannot clear newer loading or replace a confirmed user/cache with a stale error');

consumeControl = true;
pendingMe = deferred();
const controlledRead = context.checkUserAuth();
pendingMe.resolve({ id: 'synthetic-new' });
assert.equal((await controlledRead).id, 'synthetic-new');
checks.push('legitimate URL auth control is consumed before capturing the read operation');
for (const client of clients) client.clear();

for (const page of ['NativeLogin', 'Login', 'Register']) {
  const source = fs.readFileSync(`src/pages/${page}.jsx`, 'utf8');
  assert.match(source, /createSessionCredentials\(base44\.auth, operation\)/);
  assert.doesNotMatch(source, /await base44\.auth\.(?:loginViaEmailPassword|register|verifyOtp|resendOtp|resetPasswordRequest)\(/);
  assert.doesNotMatch(source, /base44\.auth\.setToken\(/);
  assert.match(source, /if \(!isCurrentAuthOperation\(operation\)\) return/);
}
const native = fs.readFileSync('src/pages/NativeLogin.jsx', 'utf8');
assert.match(native, /const completeLogin = async \(credentials\) => \{\s*credentials\.assertCurrent\(\);\s*const currentUser = await checkAppState\([^\n]+\);\s*credentials\.assertCurrent\(\);/);
assert.match(native, /catch \{\s*credentials\.assertCurrent\(\);\s*setMode\('verify'\)/);
checks.push('all credential pages use scoped operations; native completion and register fallback cannot act on superseded attempts');

const formState = [];
let formCursor = 0;
const formReact = {
  ...react,
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useMemo: fn => fn(),
  useState: initial => {
    const i = formCursor++;
    if (!(i in formState)) formState[i] = typeof initial === 'function' ? initial() : initial;
    return [formState[i], next => { formState[i] = typeof next === 'function' ? next(formState[i]) : next; }];
  },
  useRef: initial => {
    const i = formCursor++;
    if (!(i in formState)) formState[i] = { current: initial };
    return formState[i];
  },
};
const registration = deferred();
const formModule = { exports: {} };
const formImports = {
  react: formReact,
  '@capacitor/core': { Capacitor: { isNativePlatform: () => true, isPluginAvailable: () => false }, registerPlugin: () => ({}) },
  '@capacitor/app-launcher': { AppLauncher: {} },
  'react-router-dom': { useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams()] },
  'lucide-react': new Proxy({}, { get: (_target, key) => String(key) }),
  sonner: { toast: { info() {}, error() {} } },
  '@/api/base44Client': { base44: { auth: {
    register: () => registration.promise,
    loginViaEmailPassword: async () => { throw new Error('verification required'); },
  } } },
  '@/lib/nativeAuthRedirect': { beginNativeSignInAttempt: operation.beginAuthOperation },
  '@/lib/authOperation': operation,
  '@/lib/sessionCredentials': { createSessionCredentials },
  '@/lib/AuthContext': { useAuth: () => ({ isAuthenticated: false, user: null }) },
  '@/lib/authReturnTo': { sanitizeAuthReturnRoute: () => '/account' },
  '@/components/SEO': { default: 'SEO' },
  '@/lib/guestLoyaltyActivation': { readGuestLoyaltyActivationContext: () => null, GUEST_LOYALTY_ACTIVATION_RETURN_ROUTE: '/synthetic-rewards' },
};
vm.runInNewContext(transformSync(native, { format: 'cjs', loader: 'jsx' }).code, {
  module: formModule, exports: formModule.exports, console,
  require: key => { assert.ok(key in formImports, key); return formImports[key]; },
});
const renderForm = () => { formCursor = 0; return formModule.exports.default(); };
const nodes = tree => Array.isArray(tree) ? tree.flatMap(nodes)
  : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : [];
const label = tree => Array.isArray(tree) ? tree.map(label).join('')
  : tree && typeof tree === 'object' ? label(tree.props?.children) : typeof tree === 'string' ? tree : '';
const button = (tree, text) => nodes(tree).find(node => node.type === 'button' && label(node) === text);
const click = node => { assert.ok(node); if (!node.props.disabled) node.props.onClick(); };
click(button(renderForm(), 'Join'));
for (const [placeholder, value] of [['you@example.com', 'synthetic@example.invalid'], ['Password', 'synthetic-password'], ['Confirm password', 'synthetic-password']]) {
  nodes(renderForm()).find(node => node.type === 'input' && node.props.placeholder === placeholder).props.onChange({ target: { value } });
}
const submitting = nodes(renderForm()).find(node => node.type === 'form').props.onSubmit({ preventDefault() {} });
for (const text of ['Sign In', 'Join', 'Verify', 'Already have an account? Sign in', 'I have a verification code', 'Forgot password?']) {
  const control = button(renderForm(), text);
  assert.equal(control.props.disabled, true, text);
  click(control);
}
assert.ok(nodes(renderForm()).some(node => node.props?.placeholder === 'Confirm password'));
registration.resolve({ success: true });
await submitting;
assert.ok(nodes(renderForm()).some(node => node.props?.placeholder === '000000'));
assert.equal(button(renderForm(), 'Sign In').props.disabled, false);
click(button(renderForm(), 'Sign In'));
assert.equal(nodes(renderForm()).some(node => node.props?.placeholder === '000000'), false);
checks.push('actual NativeLogin interactions keep mode/recovery controls disabled during register; verification fallback and mode changes recover after completion');
console.log(JSON.stringify({ ok: true, suite: 'g187-credential-operations', checks, provider_calls: false, production_writes: false }, null, 2));
