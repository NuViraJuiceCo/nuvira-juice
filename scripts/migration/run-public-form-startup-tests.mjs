#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { transformSync } from 'esbuild';
import { QueryObserver, timeoutManager } from '@tanstack/react-query';
import * as sessions from '../../src/lib/authQuerySession.js';
import * as authOperation from '../../src/lib/authOperation.js';

timeoutManager.setTimeoutProvider({
  setTimeout: (callback, delay) => setTimeout(callback, delay).unref(), clearTimeout,
  setInterval: (callback, delay) => setInterval(callback, delay).unref(), clearInterval,
});
const checks = [];
const clients = new Set();
const noop = () => {};
const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(read(file), { loader: 'jsx', format: 'cjs' }).code, {
    module, exports: module.exports, console, setTimeout, clearTimeout, ...globals,
    require: name => {
      assert.ok(name in imports, `Unexpected import ${name}`);
      const value = imports[name];
      return 'default' in value ? { __esModule: true, ...value } : value;
    },
  });
  return module.exports;
}
function hooks(onChange = noop) {
  let state = [];
  let cursor = 0;
  const api = {
    ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in state)) state[index] = typeof initial === 'function' ? initial() : initial;
      return [state[index], value => {
        state[index] = typeof value === 'function' ? value(state[index]) : value;
        onChange();
      }];
    },
    useRef(initial) { return api.useState(() => ({ current: initial }))[0]; },
    useCallback: callback => callback,
    useEffect: noop,
  };
  return { api, begin: () => { cursor = 0; }, reset: () => { state = []; cursor = 0; } };
}
function allElements(node, predicate, found = []) {
  if (!React.isValidElement(node)) return found;
  if (predicate(node)) found.push(node);
  React.Children.forEach(node.props.children, child => allElements(child, predicate, found));
  return found;
}
function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

let profileRead;
let profileReads = 0;
const onboarding = load('src/lib/onboardingQuery.js', {
  '@/api/base44Client': { base44: { entities: { UserProfile: { filter: () => {
    profileReads++;
    return profileRead.promise;
  } } } } },
});
let auth = { user: null, isLoadingAuth: true, isLoadingPublicSettings: true, authSessionEpoch: 0 };
let profile = { data: undefined, isError: false };
let observedOptions;
const startup = load('src/lib/usePublicInquiryStartup.js', {
  '@tanstack/react-query': { useQuery: options => { observedOptions = options; return profile; } },
  '@/lib/AuthContext': { useAuth: () => auth },
  '@/lib/onboardingQuery': onboarding,
});
const submissions = [];
function pageRuntime(name) {
  const scheduler = hooks();
  const imports = {
    react: { ...scheduler.api, default: scheduler.api },
    'react-router-dom': { Link: noop, useNavigate: () => noop },
    'lucide-react': Object.fromEntries(['ArrowLeft', 'Mail', 'MapPin', 'Clock', 'Send',
      'MessageCircle', 'HelpCircle', 'ChevronDown', 'ChevronUp', 'ShieldCheck', 'Star'].map(key => [key, noop])),
    'framer-motion': { AnimatePresence: noop, motion: { div: noop } },
    '@/components/ui/button': { Button: noop },
    '@/components/ui/input': { Input: noop },
    '@/components/ui/label': { Label: noop },
    '@/components/SEO': { default: noop },
    sonner: { toast: { error: noop, success: noop } },
    '@/lib/customerCommunications': { submitCustomerInquiry: async (type, payload) => {
      submissions.push({ type, payload: JSON.parse(JSON.stringify(payload)) });
    } },
    '@/lib/googleAnalytics': { trackGoogleGenerateLead: noop },
    '@/lib/metaPixel': { trackMetaLead: noop },
    '@/lib/usePublicInquiryStartup': startup,
  };
  const Page = load(`src/pages/${name}.jsx`, imports).default;
  let epoch;
  return {
    render() {
      if (epoch !== auth.authSessionEpoch) { epoch = auth.authSessionEpoch; scheduler.reset(); }
      scheduler.begin();
      const tree = Page();
      const fieldset = allElements(tree, node => node.type === 'fieldset')[0];
      const form = allElements(tree, node => node.type === 'form')[0];
      const controls = allElements(fieldset, node => typeof node.props.onChange === 'function');
      const status = allElements(tree, node => node.props.role === 'status');
      assert.ok(fieldset);
      assert.equal(controls.length, 4, `${name}: all editable controls remain inside the disabled fieldset`);
      assert.equal(allElements(fieldset, node => node.props.type === 'submit').length, 1);
      assert.match(fieldset.props.className, /nuvira-utility-form/, 'Keep direct-child desktop styling on the fieldset');
      assert.equal(form.props['aria-busy'], fieldset.props.disabled);
      assert.equal(status.length, fieldset.props.disabled ? 1 : 0);
      return { tree, fieldset, form, controls, status };
    },
  };
}
const pages = [pageRuntime('Contact'), pageRuntime('Support')];

for (const scenario of [
  { user: null, authLoading: true, settingsLoading: true, data: undefined, disabled: true },
  { user: null, authLoading: false, settingsLoading: true, data: undefined, disabled: true },
  { user: null, authLoading: false, settingsLoading: false, data: undefined, disabled: false },
  { user: { email: 'synthetic@example.test' }, data: undefined, disabled: true },
  { user: { email: 'synthetic@example.test' }, data: null, disabled: true },
  { user: { email: 'synthetic@example.test' }, data: { onboarding_complete: false }, disabled: true },
  { user: { email: 'synthetic@example.test' }, data: undefined, isError: true, disabled: true },
  { user: { email: 'synthetic@example.test' }, data: { onboarding_complete: true }, disabled: false },
]) {
  auth = { user: scenario.user, isLoadingAuth: Boolean(scenario.authLoading),
    isLoadingPublicSettings: Boolean(scenario.settingsLoading), authSessionEpoch: 0 };
  profile = { data: scenario.data, isError: Boolean(scenario.isError) };
  for (const page of pages) {
    const result = page.render();
    assert.equal(result.fieldset.props.disabled, scenario.disabled);
    assert.equal(observedOptions.enabled, false);
    assert.equal(JSON.stringify(observedOptions.queryKey), JSON.stringify(['user-onboarding-check', scenario.user?.email]));
    if (scenario.isError) assert.match(result.status[0].props.children, /reload/);
  }
}
assert.equal(profileReads, 0, 'Rendering public forms must not call the profile API');
checks.push('Actual Contact/Support disable every control until auth and verified onboarding settle; anonymous forms remain available');

// Exercise the real AuthContext setter ordering, including intermediate states
// that React normally batches, against the actual page fieldsets.
let onAuthChange = noop;
const authHooks = hooks(() => onAuthChange());
const me = deferred();
const authModule = load('src/lib/AuthContext.jsx', {
  react: { ...authHooks.api, default: authHooks.api },
  '@capacitor/core': { Capacitor: {} }, '@capacitor/browser': { Browser: {} },
  '@/api/base44Client': { base44: { auth: { me: () => me.promise } } },
  '@/lib/app-params': { appParams: { appId: 'synthetic-app' } },
  '@/lib/authQuerySession': sessions, '@/lib/authOperation': authOperation,
  '@/lib/rewardManager': { clearAllRewardsOnLogout: noop },
  '@/lib/nativeAuthRedirect': { consumeBase44AuthFromUrl: noop, clearBase44AuthTokens: noop },
  '@/lib/googleAnalytics': { captureGoogleProviderAuthEvent: () => null, completeGoogleProviderAuthEvent: () => false, discardGoogleProviderAuthEvent: noop },
  '@/lib/metaPixel': { consumeMetaRegistrationEvent: noop },
  '@/lib/snapPixel': { consumeSnapRegistrationEvent: noop },
});
const renderAuth = () => {
  authHooks.begin();
  auth = authModule.AuthProvider({ children: null }).props.value;
  clients.add(auth.sessionQueryClient);
  return auth;
};
profile = { data: undefined, isError: false };
renderAuth();
const epochs = [];
onAuthChange = () => {
  renderAuth();
  epochs.push(auth.authSessionEpoch);
  for (const page of pages) assert.equal(page.render().fieldset.props.disabled, true,
    'An auth/session setter enabled a draft before the epoch/profile settled');
};
const authCheck = auth.checkAppState();
me.resolve({ id: 'synthetic-member', email: 'synthetic@example.test' });
await authCheck;
onAuthChange = noop;
renderAuth();
assert.ok(epochs.includes(0) && epochs.some(epoch => epoch > 0));
assert.equal(auth.isLoadingAuth, false);
assert.equal(auth.isLoadingPublicSettings, false);
for (const page of pages) assert.equal(page.render().fieldset.props.disabled, true);
checks.push('Real AuthContext initial sign-in/epoch ordering never enables a draft before remount and profile verification');

// The passive form observer shares the already running App query. It does not
// fetch on mount, invalidation or remount, and observes its successful result.
startup.usePublicInquiryStartup();
const passiveOptions = observedOptions;
profileRead = deferred();
const passive = new QueryObserver(auth.sessionQueryClient, passiveOptions);
let passiveNotifications = 0;
const stopPassive = passive.subscribe(() => { passiveNotifications++; });
assert.equal(profileReads, 0);
await auth.sessionQueryClient.invalidateQueries({ queryKey: passiveOptions.queryKey });
assert.equal(profileReads, 0);
const active = new QueryObserver(auth.sessionQueryClient, {
  ...onboarding.onboardingQueryOptions(auth.user.email), enabled: true,
});
const stopActive = active.subscribe(noop);
assert.equal(profileReads, 1);
profileRead.resolve([{ onboarding_complete: true }]);
for (let attempt = 0; attempt < 30 && active.getCurrentResult().fetchStatus !== 'idle'; attempt++) {
  await new Promise(resolve => setImmediate(resolve));
}
assert.equal(active.getCurrentResult().fetchStatus, 'idle');
profile = passive.getCurrentResult();
assert.equal(profile.data.onboarding_complete, true);
assert.ok(passiveNotifications > 0);
stopPassive();
const remountedPassive = new QueryObserver(auth.sessionQueryClient, passiveOptions);
const stopRemounted = remountedPassive.subscribe(noop);
assert.equal(profileReads, 1);
stopRemounted(); stopActive();
checks.push('Real disabled QueryObserver adds zero requests and receives the existing App query result, including after remount');

for (const [index, page] of pages.entries()) {
  const values = ['Synthetic Visitor', 'synthetic@example.test', 'Synthetic subject', 'Synthetic message'];
  for (let input = 0; input < values.length; input++) {
    const result = page.render();
    assert.equal(result.fieldset.props.disabled, false);
    result.controls[input].props.onChange({ target: { value: values[input] } });
  }
  // Same-principal auth updates and ordinary re-renders preserve the draft.
  auth = { ...auth, user: { ...auth.user, first_name: 'Updated' } };
  const result = page.render();
  assert.deepEqual(result.controls.map(control => control.props.value), values);
  await result.form.props.onSubmit({ preventDefault: noop });
  assert.equal(submissions[index].type, index === 0 ? 'contact' : 'support');
  assert.deepEqual(submissions[index].payload, {
    customer_name: values[0], customer_email: values[1], subject: values[2], message: values[3],
    source: index === 0 ? 'contact_page' : 'support_page',
  });
  assert.ok(page.render().controls.every(control => control.props.value === ''));
}
checks.push('Enabled drafts survive same-principal renders; original explicit submission payload and success clearing are unchanged');
for (const page of ['Contact', 'Support']) {
  const source = read(`src/pages/${page}.jsx`);
  assert.match(source, /<fieldset disabled=\{formStartup\.disabled\}/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|useEffect/);
}
for (const client of clients) client.clear();
console.log(JSON.stringify({ ok: true, suite: 'public-form-startup', checks,
  real_auth_ordering: true, real_query_observers: true, synthetic_profile_reads: profileReads,
  added_profile_requests: 0, real_network_requests: 0, production_writes: false }, null, 2));
