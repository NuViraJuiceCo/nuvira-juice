import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const analytics = fs.readFileSync('src/lib/googleAnalytics.js', 'utf8');
const authContext = fs.readFileSync('src/lib/AuthContext.jsx', 'utf8');
const login = fs.readFileSync('src/pages/Login.jsx', 'utf8');
const register = fs.readFileSync('src/pages/Register.jsx', 'utf8');
const accountSetup = fs.readFileSync('src/pages/AccountSetup.jsx', 'utf8');
const referral = fs.readFileSync('src/pages/Referral.jsx', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const checks = [
  ['campaign attribution uses a strict allowlist and rejects arbitrary query data', () => {
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'gclid', 'gbraid', 'wbraid', 'fbclid', 'ttclid']) {
      assert.match(analytics, new RegExp(`['"]${key}['"]`));
    }
    assert.match(analytics, /sanitizeCampaignValue/);
    assert.ok(analytics.includes("if (/\\S+@\\S+\\.\\S+/.test(sanitized)) return '';"));
    assert.match(analytics, /buildAnalyticsPageLocation/);
    assert.doesNotMatch(analytics, /CAMPAIGN_QUERY_KEYS[\s\S]{0,500}session_id/);
  }],
  ['email login is measured only after authentication succeeds', () => {
    assert.match(login, /await base44\.auth\.loginViaEmailPassword\(email, password\);\s*trackGoogleLogin\('email'\);/);
    assert.ok(login.indexOf("trackGoogleLogin('email')") < login.indexOf('window.location.href = returnTo'));
  }],
  ['email sign-up is measured only after OTP verification succeeds', () => {
    assert.match(register, /await base44\.auth\.verifyOtp\(\{ email, otpCode \}\);[\s\S]{0,220}trackGoogleSignUp\('email'\);/);
    assert.ok(register.indexOf("trackGoogleSignUp('email')") < register.indexOf('window.location.href = safeReturnTo()'));
  }],
  ['Google provider measurement is bound to a short-lived callback token and authenticated readback', () => {
    assert.match(login, /prepareGoogleProviderAuthRedirect\(returnTo, 'login', 'google'\)/);
    assert.match(register, /prepareGoogleProviderAuthRedirect\(safeReturnTo\(\), 'sign_up', 'google'\)/);
    assert.match(analytics, /GOOGLE_AUTH_EVENT_TTL_MS/);
    assert.match(analytics, /stored\.token !== token/);
    assert.match(analytics, /providerOutcome === 'true'/);
    assert.match(authContext, /const pendingProviderAuthEvent = captureGoogleProviderAuthEvent\(\);[\s\S]{0,120}consumeBase44AuthFromUrl\(\);/);
    assert.match(authContext, /if \(currentUser\) \{\s*const providerEventCompleted = completeGoogleProviderAuthEvent\(pendingProviderAuthEvent\);/);
    assert.match(authContext, /discardGoogleProviderAuthEvent\(pendingProviderAuthEvent\);/);
  }],
  ['profile completion is measured only after the backend confirms success', () => {
    assert.match(accountSetup, /if \(response\.ok && responseData\?\.success\) \{\s*trackGoogleProfileComplete\('account_setup'\);/);
  }],
  ['referral sharing is measured only after the selected customer action succeeds', () => {
    assert.match(referral, /await navigator\.clipboard\.writeText\(code\);\s*trackGoogleShare\('clipboard'/);
    assert.match(referral, /await navigator\.share\([\s\S]{0,120}trackGoogleShare\('native_share'/);
    assert.match(referral, /await navigator\.clipboard\.writeText\(shareMessage\);\s*trackGoogleShare\('clipboard_message'/);
    assert.doesNotMatch(referral, /trackGoogleShare\(\s*(?:email|code)\b/);
  }],
  ['lifecycle payloads contain no customer identity or referral-code values', () => {
    const lifecycleBlock = analytics.slice(
      analytics.indexOf('function trackGoogleLifecycleEvent'),
      analytics.indexOf('function merchandiseValue')
    );
    assert.doesNotMatch(lifecycleBlock, /customer_email|first_name|last_name|phone|address|referral_code/);
    assert.match(lifecycleBlock, /item_id: safeAnalyticsLabel\(itemId, 'nuvira_referral'\)/);
  }],
  ['native analytics exclusion and advertising-consent denials remain unchanged', () => {
    assert.match(analytics, /isNativeAppRuntime\(\)/);
    assert.match(analytics, /ad_storage: 'denied'/);
    assert.match(analytics, /ad_user_data: 'denied'/);
    assert.match(analytics, /ad_personalization: 'denied'/);
  }],
  ['G141 remains part of the critical regression suite', () => {
    assert.match(critical, /run-g141-growth-measurement-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  check();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

const localStored = new Map();
const sessionStored = new Map();
const scripts = new Map();
const replacedRoutes = [];
const windowMock = {
  localStorage: {
    getItem: (key) => localStored.get(key) || null,
    setItem: (key, value) => localStored.set(key, String(value)),
    removeItem: (key) => localStored.delete(key),
  },
  sessionStorage: {
    getItem: (key) => sessionStored.get(key) || null,
    setItem: (key, value) => sessionStored.set(key, String(value)),
    removeItem: (key) => sessionStored.delete(key),
  },
  location: {
    origin: 'https://nuvirajuice.com',
    href: 'https://nuvirajuice.com/shop',
    pathname: '/shop',
    search: '',
    hash: '',
  },
  history: {
    replaceState: (_state, _title, route) => replacedRoutes.push(route),
  },
  dispatchEvent: () => true,
};
const documentMock = {
  title: 'NuVira test',
  cookie: '',
  head: {
    appendChild: (script) => {
      scripts.set(script.id, script);
      queueMicrotask(() => script.onload?.());
    },
  },
  createElement: () => ({
    dataset: {},
    remove() {
      scripts.delete(this.id);
    },
  }),
  getElementById: (id) => scripts.get(id) || null,
};
const executable = analytics
  .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", 'const isNativeAppRuntime = () => false;')
  .replace(/^export /gm, '')
  + '\nglobalThis.__g141 = { setAnalyticsConsent, buildAnalyticsPageLocation, trackGooglePageView, trackGoogleLogin, trackGoogleSignUp, trackGoogleProfileComplete, trackGoogleShare, prepareGoogleProviderAuthRedirect, captureGoogleProviderAuthEvent, completeGoogleProviderAuthEvent };';
const context = vm.createContext({
  window: windowMock,
  document: documentMock,
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  console,
  crypto: { randomUUID: () => 'g141-auth-token' },
  URL,
  URLSearchParams,
  encodeURIComponent,
  queueMicrotask,
  setTimeout,
  clearTimeout,
});
vm.runInContext(executable, context);

assert.equal(context.__g141.trackGoogleLogin('email'), false, 'lifecycle events must fail closed before consent');
assert.equal(context.__g141.setAnalyticsConsent('granted'), true);

windowMock.location.search = '?utm_source=instagram&utm_campaign=stl_launch&gclid=google-click&fbclid=meta-click&session_id=private&utm_term=636-697-6028&utm_content=customer%40example.com';
assert.equal(await context.__g141.trackGooglePageView('/order-tracker/NV-PRIVATE?customer=secret', 'Private order'), true);
assert.equal(context.__g141.trackGoogleLogin('email'), true);
assert.equal(context.__g141.trackGoogleProfileComplete('account_setup'), true);
assert.equal(context.__g141.trackGoogleShare('clipboard', 'referral', 'nuvira_referral'), true);

const preparedRoute = context.__g141.prepareGoogleProviderAuthRedirect('/account?source=member', 'sign_up', 'google');
assert.equal(preparedRoute, '/account?source=member&nuvira_auth_event=g141-auth-token');
windowMock.location.href = `https://nuvirajuice.com${preparedRoute}&is_new_user=true&access_token=private`;
windowMock.location.search = preparedRoute.slice(preparedRoute.indexOf('?')) + '&is_new_user=true&access_token=private';
const providerEvent = context.__g141.captureGoogleProviderAuthEvent();
assert.equal(providerEvent.eventName, 'sign_up');
assert.equal(providerEvent.method, 'google');
assert.equal(context.__g141.completeGoogleProviderAuthEvent(providerEvent), true);
assert.equal(sessionStored.size, 0);
assert.equal(replacedRoutes.at(-1).includes('nuvira_auth_event'), false);

const emitted = windowMock.dataLayer.map((entry) => Array.from(entry));
const pageView = emitted.find((entry) => entry[0] === 'event' && entry[1] === 'page_view');
const loginEvent = emitted.find((entry) => entry[0] === 'event' && entry[1] === 'login');
const signUpEvent = emitted.find((entry) => entry[0] === 'event' && entry[1] === 'sign_up');
const profileEvent = emitted.find((entry) => entry[0] === 'event' && entry[1] === 'profile_complete');
const shareEvent = emitted.find((entry) => entry[0] === 'event' && entry[1] === 'share');
assert.equal(pageView[2].page_path, '/order-tracker/:order');
assert.equal(pageView[2].page_location, 'https://nuvirajuice.com/order-tracker/:order?utm_source=instagram&utm_campaign=stl_launch&gclid=google-click&fbclid=meta-click');
assert.equal(pageView[2].page_location.includes('session_id'), false);
assert.equal(pageView[2].page_location.includes('customer%40example.com'), false);
assert.equal(pageView[2].page_location.includes('636-697-6028'), false);
assert.equal(loginEvent[2].method, 'email');
assert.equal(signUpEvent[2].method, 'google');
assert.equal(profileEvent[2].profile_source, 'account_setup');
assert.equal(shareEvent[2].item_id, 'nuvira_referral');
assert.equal(JSON.stringify(emitted).includes('access_token=private'), false);
assert.equal(JSON.stringify(emitted).includes('session_id=private'), false);
assert.equal(JSON.stringify(emitted).includes('customer=secret'), false);
assert.equal(JSON.stringify(emitted).includes('customer@example.com'), false);

console.log(`PASS ${checks.length + 1}: runtime harness verifies consent, campaign allowlisting, private-query omission, lifecycle events, and Google callback binding`);
console.log(`G141 growth measurement coverage: ${passed + 1}/${checks.length + 1} checks passed`);
