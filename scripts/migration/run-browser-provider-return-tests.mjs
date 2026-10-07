#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createAuthModule } from '../../node_modules/@base44/sdk/dist/modules/auth.js';
import * as returnHelpers from '../../src/lib/authReturnTo.js';

const checks = [];
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
const originalFetch = globalThis.fetch;
const loginSource = fs.readFileSync('src/pages/NativeLogin.jsx', 'utf8');
const loginCode = transformSync(loginSource, { format: 'cjs', loader: 'jsx' }).code;

function findButton(node, label) {
  if (!node || typeof node !== 'object') return null;
  if (node.type === 'button' && node.props.children.includes(label)) return node;
  for (const child of (node.props?.children || []).flat(Infinity)) {
    const found = findButton(child, label);
    if (found) return found;
  }
  return null;
}

function mountLogin({ native = false, preview = false, returnTo = '/account?tab=orders', page = 'NativeLogin' } = {}) {
  const errors = [];
  const nativeCalls = [];
  globalThis.document = { querySelector: () => preview ? {} : null };
  const react = {
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useMemo: fn => fn(), useEffect() {},
    useRef: initial => ({ current: initial }),
    useState: initial => [typeof initial === 'function' ? initial() : initial, value => {
      if (typeof value === 'string' && value.startsWith('Sign-in is unavailable')) errors.push(value);
    }],
  };
  const axios = { defaults: { headers: { common: {} } } };
  const auth = createAuthModule(axios, axios, 'synthetic-app', { appBaseUrl: 'https://nuvirajuice.com' });
  const nativeCallback = 'https://nuvirajuice.com/native-auth-bridge?native_browser_callback=1';
  const imports = {
    react,
    '@capacitor/core': {
      Capacitor: { isNativePlatform: () => native, isPluginAvailable: () => native },
      registerPlugin: () => ({ authenticate: async options => {
        nativeCalls.push(options);
        throw Object.assign(new Error('Canceled in test'), { code: 'AUTH_CANCELED' });
      } }),
    },
    '@capacitor/app-launcher': { AppLauncher: {} },
    'react-router-dom': { Link: 'a', useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams({ return_to: returnTo })] },
    'lucide-react': new Proxy({}, { get: (_target, key) => String(key) }),
    sonner: { toast: { info() {}, error: message => errors.push(message) } },
    '@/api/base44Client': { base44: { auth } },
    '@/lib/nativeAuthRedirect': {
      beginNativeSignInAttempt: () => 1,
      getNativeBrowserProviderReturnUrl: async () => nativeCallback,
      getProviderLoginUrl: (provider, callback) => `https://app.base44.com/api/apps/auth/${provider}/login?from_url=${encodeURIComponent(callback)}`,
    },
    '@/lib/authOperation': { beginAuthOperation: () => 1, isCurrentAuthOperation: () => true },
    '@/lib/sessionCredentials': {},
    '@/lib/startupPages': { preloadStartupPage: async () => true },
    '@/lib/brandImages': { BRAND_IMAGES: { wordmark: '/images/brand/nuvira-wordmark.webp' } },
    '@/lib/AuthContext': { useAuth: () => ({ isAuthenticated: false, user: null }) },
    '@/lib/authReturnTo': returnHelpers,
    '@/components/SEO': { default: 'SEO' },
    '@/components/AuthLayout': { default: 'AuthLayout' },
    '@/components/GoogleIcon': { default: 'GoogleIcon' },
    '@/components/ui/button': { Button: 'button' },
    '@/components/ui/input': { Input: 'input' },
    '@/components/ui/label': { Label: 'label' },
    '@/components/ui/input-otp': {},
    '@/lib/googleAnalytics': { prepareGoogleProviderAuthRedirect: route => route },
    '@/lib/metaPixel': {},
    '@/lib/snapPixel': {},
    '@/lib/guestLoyaltyActivation': { readGuestLoyaltyActivationContext: () => null, GUEST_LOYALTY_ACTIVATION_RETURN_ROUTE: '/synthetic-rewards' },
  };
  const module = { exports: {} };
  const code = page === 'NativeLogin' ? loginCode
    : transformSync(fs.readFileSync(`src/pages/${page}.jsx`, 'utf8'), { format: 'cjs', loader: 'jsx' }).code;
  vm.runInNewContext(code, {
    module, exports: module.exports, URL, URLSearchParams,
    window: globalThis.window,
    document: globalThis.document,
    console: { warn() {} },
    require: key => { assert.ok(key in imports, key); return imports[key]; },
  });
  return { tree: module.exports.default(), errors, nativeCalls, nativeCallback };
}

try {
  globalThis.fetch = () => { throw new Error('Network forbidden'); };
  for (const origin of ['https://nuvirajuice.com', 'https://www.nuvirajuice.com', 'http://127.0.0.1:4203']) {
    const window = { location: { origin, href: `${origin}/native-login` } };
    window.self = window;
    window.top = window;
    window.parent = window;
    globalThis.window = window;
    for (const provider of ['google', 'google', 'apple']) {
      const { tree, errors } = mountLogin();
      await findButton(tree, provider === 'google' ? 'Google' : 'Apple').props.onClick();
      assert.deepEqual(errors, []);
      const loginUrl = new URL(window.location.href);
      const callback = new URL(loginUrl.searchParams.get('from_url'));
      assert.equal(callback.origin, origin);
      assert.equal(callback.pathname + callback.search, '/account?tab=orders');
      assert.equal(loginUrl.pathname, provider === 'google' ? '/api/apps/auth/login' : '/api/apps/auth/apple/login');
      assert.equal(callback.searchParams.has('native_provider_callback'), false);
      assert.equal(callback.searchParams.has('native_browser_callback'), false);
    }
    assert.equal(returnHelpers.getBrowserProviderReturnUrl('/checkout?clear_access_token=true&access_token=old&native_browser_callback=1&bag=return#payment'), `${origin}/checkout?bag=return#payment`);
    for (const unsafe of ['//outside.invalid', '/\\outside.invalid', 'nuvira://auth/callback', 'https://outside.invalid/account']) {
      assert.equal(returnHelpers.getBrowserProviderReturnUrl(unsafe), `${origin}/`);
    }
    for (const nativeRoute of ['/native-login', '/native-login/nested', '/native-auth-bridge?native_browser_callback=1', '/%6eative-login', '/NATIVE-LOGIN']) {
      assert.equal(returnHelpers.getBrowserProviderReturnUrl(nativeRoute), `${origin}/account`);
    }
  }
  checks.push('actual Google/Apple button handlers and SDK return to the originating browser on repeated sign-in');
  checks.push('account/checkout destination retained; token/logout/native markers and unsafe destinations rejected');
  checks.push('native callback destinations cannot be selected by browser return_to');

  for (const label of ['Google', 'Apple']) {
    window.location.href = 'http://127.0.0.1:4203/native-login';
    const { tree, errors } = mountLogin({ preview: true });
    await findButton(tree, label).props.onClick();
    assert.equal(window.location.href, 'http://127.0.0.1:4203/native-login');
    assert.match(errors[0], /Sign-in is unavailable in this local design preview/);
  }
  checks.push('isolated design preview displays an explanation and never starts live OAuth');

  for (const label of ['Google', 'Apple']) {
    const { tree, nativeCalls, nativeCallback } = mountLogin({ native: true });
    await findButton(tree, label).props.onClick();
    assert.equal(nativeCalls.length, 1);
    assert.equal(nativeCalls[0].callbackScheme, 'nuvira');
    assert.equal(new URL(nativeCalls[0].url).searchParams.get('from_url'), nativeCallback);
  }
  checks.push('native Google/Apple still use the native authentication plugin and app callback scheme');
  for (const page of ['Login', 'Register']) {
    window.location.origin = 'https://nuvirajuice.com';
    window.location.search = '?returnTo=%2Fcheckout%3Fbag%3Dreturn';
    const { tree } = mountLogin({ page });
    await findButton(tree, 'Continue with Google').props.onClick();
    assert.equal(new URL(window.location.href).searchParams.get('from_url'), 'https://nuvirajuice.com/checkout?bag=return');
    window.location.search = '?returnTo=%2Fnative-login%3Fnative_browser_callback%3D1';
    await findButton(mountLogin({ page }).tree, 'Continue with Google').props.onClick();
    assert.equal(new URL(window.location.href).searchParams.get('from_url'), 'https://nuvirajuice.com/account');
  }
  checks.push('legacy Login/Register Google handlers preserve browser checkout and reject native destinations');

  for (const framed of [false, true]) {
    window.parent = framed ? {} : window;
    window.open = () => { throw new Error('Preview must never open an OAuth popup'); };
    for (const page of ['NativeLogin', 'Login', 'Register']) {
      window.location.origin = 'http://127.0.0.1:4203';
      window.location.href = `${window.location.origin}/${page.toLowerCase()}`;
      const before = window.location.href;
      const { tree, errors } = mountLogin({ page, preview: true });
      await findButton(tree, page === 'NativeLogin' ? 'Google' : 'Continue with Google').props.onClick();
      assert.equal(window.location.href, before);
      assert.match(errors[0], /Sign-in is unavailable in this local design preview/);
    }
  }
  checks.push('every provider sign-in page blocks preview OAuth in standalone and review-frame contexts');
  assert.doesNotMatch(loginSource, /getNativeProviderReturnUrl/);
  console.log(JSON.stringify({ ok: true, suite: 'browser-provider-return', checks, provider_calls: false, real_network_requests: 0, production_writes: false }, null, 2));
} finally {
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
  globalThis.fetch = originalFetch;
}
