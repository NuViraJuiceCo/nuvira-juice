#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import ts from 'typescript';
import { sendGooglePurchaseMeasurement, normalizeGoogleMeasurementContext } from '../../base44/functions/stripeWebhook/googleMeasurement.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const source = read('src/lib/googleAnalytics.js');
const banner = read('src/components/AnalyticsConsent.jsx');
const legal = read('src/pages/Legal.jsx');
const payment = read('base44/functions/createPaymentIntent/entry.ts');
const results = [];
const test = async (name, run) => { await run(); results.push(name); };
const version = '2026-09-google-ads-v1';
const adsKey = 'nuvira_google_ads_measurement_consent_v1';
function runtime({ native = false, initial = {}, blockedStorage = false } = {}) {
  const values = new Map(Object.entries(initial));
  const scripts = new Map();
  const events = [];
  const cookieWrites = [];
  const storage = {
    getItem: (key) => { if (blockedStorage) throw new Error('storage unavailable'); return values.get(key) || null; },
    setItem: (key, value) => { if (blockedStorage) throw new Error('storage unavailable'); values.set(key, value); },
    removeItem: (key) => { if (blockedStorage) throw new Error('storage unavailable'); values.delete(key); },
  };
  const window = { localStorage: storage, sessionStorage: storage,
    location: new URL('https://nuvirajuice.com/product/oasis.html?gclid=synthetic-ad-click'),
    dispatchEvent: event => events.push(event),
  };
  const document = {
    get cookie() { return '_ga=GA1.2.1.2; _gcl_aw=synthetic; _gac_G_H8R82365GM=synthetic; _fbp=untouched'; },
    set cookie(value) { cookieWrites.push(value); },
    title: 'Synthetic consent fixture',
    createElement: () => ({ dataset: {}, remove() { scripts.delete(this.id); } }),
    getElementById: id => scripts.get(id) || null,
    head: { appendChild(script) { scripts.set(script.id, script); queueMicrotask(() => script.onload()); } },
  };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(source, { format: 'cjs' }).code, {
    module, exports: module.exports,
    require: key => { assert.equal(key, '@/lib/nativeRuntime'); return { isNativeAppRuntime: () => native }; },
    window, document, URL, URLSearchParams, console, queueMicrotask, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
  });
  const api = module.exports;
  const lastConsent = () => Array.from(window.dataLayer || []).map(args => Array.from(args))
    .filter(args => args[0] === 'consent').at(-1)?.[2];
  const enableTagIds = () => {
    const queued = window.gtag;
    window.gtag = (...args) => args[0] === 'get'
      ? args[3](args[2] === 'client_id' ? '1234567890.1789000000' : '1789000000') : queued(...args);
  };
  return { api, window, values, scripts, events, cookieWrites, lastConsent, enableTagIds };
}

await test('legacy analytics and Meta/Snap grants never grant the new Google purpose', async () => {
  const r = runtime({ initial: { nuvira_analytics_consent_v1: 'granted', nuvira_marketing_consent_v1: 'granted' } });
  assert.equal(r.api.getGoogleAdsMeasurementConsent(), null);
  await r.api.loadGoogleAnalytics();
  assert.equal(r.lastConsent().ad_storage, 'denied');
  assert.equal(r.lastConsent().ad_user_data, 'denied');
  assert.equal(r.values.get('nuvira_marketing_consent_v1'), 'granted');
});
await test('new explicit grant requires analytics too; personalized ads always remain denied', async () => {
  const r = runtime();
  assert.equal(r.api.setGoogleAdsMeasurementConsent('granted'), true);
  assert.equal(r.lastConsent().ad_storage, 'denied');
  assert.equal(await r.api.loadGoogleAnalytics(), false);
  r.api.setAnalyticsConsent('granted');
  assert.equal(r.lastConsent().ad_storage, 'granted');
  assert.equal(r.lastConsent().ad_user_data, 'granted');
  assert.equal(r.lastConsent().ad_personalization, 'denied');
  await r.api.loadGoogleAnalytics();
  const config = r.window.dataLayer.find(args => args[0] === 'config')[2];
  assert.equal(config.allow_google_signals, false);
  assert.equal(config.allow_ad_personalization_signals, false);
});
await test('withdrawal and reset revoke Google advertising without changing Meta/Snap consent', () => {
  const r = runtime({ initial: { nuvira_analytics_consent_v1: 'granted', nuvira_marketing_consent_v1: 'granted' } });
  r.api.setGoogleAdsMeasurementConsent('granted');
  r.api.setGoogleAdsMeasurementConsent('denied');
  assert.equal(r.lastConsent().ad_user_data, 'denied');
  assert.ok(r.cookieWrites.some(value => value.startsWith('_gcl_aw=;')));
  assert.ok(r.cookieWrites.some(value => value.startsWith('_gac_G_H8R82365GM=;')));
  assert.ok(!r.cookieWrites.some(value => value.startsWith('_fbp=;')));
  r.api.resetGoogleAdsMeasurementConsent();
  assert.equal(r.api.getGoogleAdsMeasurementConsent(), null);
  assert.equal(r.values.get('nuvira_marketing_consent_v1'), 'granted');
  assert.equal(r.events.at(-1).detail, 'reset');
});
await test('analytics withdrawal also stops advertising storage and clears advertising cookies', () => {
  const r = runtime();
  r.api.setGoogleAdsMeasurementConsent('granted'); r.api.setAnalyticsConsent('granted');
  r.api.setAnalyticsConsent('denied');
  assert.equal(r.lastConsent().analytics_storage, 'denied');
  assert.equal(r.lastConsent().ad_user_data, 'denied');
  assert.ok(r.cookieWrites.some(value => value.startsWith('_gcl_aw=;')));
});
await test('cross-tab removal and denial override this tab\'s old grant without new page views', () => {
  const r = runtime();
  r.api.setGoogleAdsMeasurementConsent('granted'); r.api.setAnalyticsConsent('granted');
  r.values.delete(adsKey);
  assert.equal(r.api.getGoogleAdsMeasurementConsent(), null);
  r.api.syncGoogleMeasurementConsent();
  assert.equal(r.lastConsent().ad_storage, 'denied');
  assert.equal(r.lastConsent().ad_user_data, 'denied');
  assert.equal(r.lastConsent().analytics_storage, 'granted');
  r.values.set(adsKey, 'denied');
  r.api.syncGoogleMeasurementConsent();
  assert.equal(r.lastConsent().ad_user_data, 'denied');
  r.values.delete('nuvira_analytics_consent_v1');
  assert.equal(r.api.getAnalyticsConsent(), null);
  r.api.syncGoogleMeasurementConsent();
  assert.equal(r.lastConsent().analytics_storage, 'denied');
  assert.ok(!r.window.dataLayer.some(args => args[0] === 'event'));
  assert.match(banner, /window\.addEventListener\('storage', onStorage\)/);
  assert.match(banner, /window\.removeEventListener\('storage', onStorage\)/);
});
await test('native runtime remains off and invalid choices do not write', async () => {
  const r = runtime({ native: true });
  assert.equal(r.api.setGoogleAdsMeasurementConsent('granted'), false);
  assert.equal(r.api.resetGoogleAdsMeasurementConsent(), false);
  assert.equal(r.api.syncGoogleMeasurementConsent(), false);
  assert.equal(await r.api.getGoogleMeasurementContext(), null);
  assert.equal(r.values.size, 0); assert.equal(r.scripts.size, 0);
  assert.equal(runtime().api.setGoogleAdsMeasurementConsent('yes'), false);
});
await test('blocked storage stays default-denied until a deliberate session-only grant', () => {
  const r = runtime({ blockedStorage: true });
  assert.equal(r.api.getGoogleAdsMeasurementConsent(), null);
  r.api.setGoogleAdsMeasurementConsent('granted'); r.api.setAnalyticsConsent('granted');
  assert.equal(r.lastConsent().ad_user_data, 'granted');
  r.api.resetGoogleAdsMeasurementConsent();
  assert.equal(r.lastConsent().ad_user_data, 'denied');
});
await test('browser permission never adds advertising authority to the existing checkout context', async () => {
  const r = runtime(); r.api.setAnalyticsConsent('granted'); await r.api.loadGoogleAnalytics(); r.enableTagIds();
  const oldContext = await r.api.getGoogleMeasurementContext();
  assert.deepEqual(Object.keys(oldContext).sort(), ['captured_at', 'client_id', 'session_id']);
  r.api.setGoogleAdsMeasurementConsent('granted');
  const granted = await r.api.getGoogleMeasurementContext();
  assert.equal(granted.ad_measurement_consent, undefined);
  assert.equal(granted.ad_measurement_consent_version, undefined);
  assert.deepEqual(Object.keys(granted).sort(), ['captured_at', 'client_id', 'session_id']);
  r.api.setAnalyticsConsent('denied'); assert.equal(await r.api.getGoogleMeasurementContext(), null);
});
await test('analytics withdrawal during identifier lookup cannot produce a checkout measurement context', async () => {
  const r = runtime(); r.api.setAnalyticsConsent('granted'); await r.api.loadGoogleAnalytics();
  const queued = r.window.gtag;
  r.window.gtag = (...args) => {
    if (args[0] !== 'get') return queued(...args);
    if (args[2] === 'session_id') r.api.setAnalyticsConsent('denied');
    args[3](args[2] === 'client_id' ? '1234567890.1789000000' : '1789000000');
  };
  assert.equal(await r.api.getGoogleMeasurementContext(), null);
});
await test('Google ad withdrawal during identifier lookup cannot export a stale advertising grant', async () => {
  const r = runtime(); r.api.setAnalyticsConsent('granted'); r.api.setGoogleAdsMeasurementConsent('granted');
  await r.api.loadGoogleAnalytics();
  const queued = r.window.gtag;
  r.window.gtag = (...args) => {
    if (args[0] !== 'get') return queued(...args);
    if (args[2] === 'session_id') { r.values.delete(adsKey); r.api.syncGoogleMeasurementConsent(); }
    args[3](args[2] === 'client_id' ? '1234567890.1789000000' : '1789000000');
  };
  assert.equal((await r.api.getGoogleMeasurementContext()).ad_measurement_consent, undefined);
  assert.equal(r.lastConsent().ad_user_data, 'denied');
});
await test('checkout normalization and idempotency do not consume browser advertising permission', () => {
  const tree = ts.createSourceFile('entry.ts', payment, ts.ScriptTarget.Latest, true);
  const fn = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'normalizeGoogleMeasurementContext');
  assert.ok(fn);
  const normalize = vm.runInNewContext(`(${ts.transpileModule(fn.getText(tree), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText})`);
  const value = { client_id: '123.456', session_id: '1789000000', captured_at: '2026-09-10T12:00:00Z' };
  assert.equal(normalize({ ...value, ad_measurement_consent: 'granted' }).ad_measurement_consent, undefined);
  assert.equal(normalize({ ...value, ad_measurement_consent: 'granted', ad_measurement_consent_version: version }).ad_measurement_consent, undefined);
  assert.deepEqual(Object.keys(normalize(value)).sort(), ['captured_at', 'client_id', 'session_id']);
  assert.equal(normalize({ ...value, customer_email: 'private@example.test' }).customer_email, undefined);
  assert.doesNotMatch(payment, /google_ad_measurement_consent|google_measurement_consent_revision|google_ad_measurement_requires_explicit_consent/);
  assert.equal((payment.match(/google_measurement_context: normalizedGoogleMeasurementContext/g) || []).length, 2);
  assert.match(read('base44/functions/stripeWebhook/entry.ts'), /stripe-webhook-runtime-20260909-credit-settlement-v8/);
});
await test('server advertising permission stays DENIED even with explicit browser or forged context grants', async () => {
  for (const [consent, consentVersion] of [[undefined, undefined], ['granted', undefined], ['granted', 'old'], ['denied', version], ['granted', version]]) {
    const requests = [];
    const context = { client_id: '123.456', session_id: '1789000000', ad_measurement_consent: consent, ad_measurement_consent_version: consentVersion };
    const logs = [];
    const args = {
      base44: { asServiceRole: { entities: { OrderSyncLog: { filter: async () => logs, create: async row => logs.push(row) } } } },
      event: { id: 'evt_synthetic', created: 1789000000 },
      paymentIntent: { id: 'pi_synthetic', status: 'succeeded', amount_received: 3900, metadata: {} },
      order: { id: 'order_synthetic', order_number: 'NV-SYNTH-G196', delivery_fee: 0, items: [{ product_id: 'oasis', title: 'OASIS', price: 13, quantity: 3 }] },
      checkoutData: { analytics_measurement_consent: 'granted', google_measurement_context: context },
      env: { get: key => key === 'ENABLE_GOOGLE_MEASUREMENT_PROTOCOL_PURCHASE' ? 'true' : 'synthetic-secret' },
      fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true }; },
    };
    assert.equal((await sendGooglePurchaseMeasurement(args)).sent, true);
    assert.equal(requests[0].consent.ad_user_data, 'DENIED');
    assert.equal(requests[0].consent.ad_personalization, 'DENIED');
    assert.equal(requests[0].events[0].params.transaction_id, 'NV-SYNTH-G196');
    assert.equal((await sendGooglePurchaseMeasurement(args)).deduplicated, true);
    assert.equal(requests.length, 1);
    assert.equal((await sendGooglePurchaseMeasurement({ ...args, checkoutData: { ...args.checkoutData, analytics_measurement_consent: 'denied' } })).reason, 'analytics_consent_not_granted');
  }
  assert.equal(normalizeGoogleMeasurementContext({ client_id: 'bad', session_id: '0' }), null);
});
await test('neither an order nor checkout context can override server advertising denial', async () => {
  const requests = [];
  const context = { client_id: '123.456', session_id: '1789000000', ad_measurement_consent_version: version };
  await sendGooglePurchaseMeasurement({
    base44: { asServiceRole: { entities: { OrderSyncLog: { filter: async () => [], create: async () => ({}) } } } },
    event: { id: 'evt_precedence', created: 1789000000 },
    paymentIntent: { id: 'pi_precedence', status: 'succeeded', amount_received: 3900, metadata: {} },
    order: { id: 'order_precedence', order_number: 'NV-SYNTH-PRECEDENCE', items: [{ product_id: 'oasis', title: 'OASIS', price: 13, quantity: 3 }],
      google_measurement_context: { ...context, ad_measurement_consent: 'granted' } },
    checkoutData: { analytics_measurement_consent: 'granted', google_measurement_context: { ...context, ad_measurement_consent: 'denied' } },
    env: { get: key => key === 'ENABLE_GOOGLE_MEASUREMENT_PROTOCOL_PURCHASE' ? 'true' : 'synthetic-secret' },
    fetchImpl: async (_url, init) => { requests.push(JSON.parse(init.body)); return { ok: true }; },
  });
  assert.equal(requests[0].consent.ad_user_data, 'DENIED');
});
await test('the detailed choice remains available, independently unchecked for old visitors, resettable, and disclosed', () => {
  assert.match(banner, /getGoogleAdsMeasurementConsent\(\) === null/);
  assert.match(banner, /useState\(\(\) => getGoogleAdsMeasurementConsent\(\) === 'granted'\)/);
  assert.match(banner, /aria-label="Allow Google ad measurement"/);
  assert.match(banner, /Requires Website analytics\. No personalized ads/);
  assert.match(banner, /setGoogleAdsMeasurementConsent\(googleAdsAllowed \? 'granted' : 'denied'\)/);
  assert.match(banner, /setGoogleAdsMeasurementConsent\('denied'\)/);
  assert.match(legal, /Earlier Website analytics or Ad insights choices do not grant this new Google permission/);
  assert.match(legal, /Server-sent Google purchase events continue to deny advertising use/);
  assert.match(legal, /Google signals and personalized advertising remain disabled/);
  assert.match(legal, /resetGoogleAdsMeasurementConsent\(\)/);
  assert.doesNotMatch(source, /ad_personalization: 'granted'|allow_google_signals: true|allow_ad_personalization_signals: true/);
  assert.equal(adsKey, 'nuvira_google_ads_measurement_consent_v1');
});
await test('consent stays above root stacking with bounded scrolling and pinned 44px actions/choices', () => {
  const tree = ts.createSourceFile('AnalyticsConsent.jsx', banner, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
  const nodes = [];
  const visit = node => { nodes.push(node); ts.forEachChild(node, visit); };
  visit(tree);
  const attribute = (opening, name) => opening.attributes.properties.find(prop => ts.isJsxAttribute(prop) && prop.name.getText(tree) === name)?.initializer?.text || '';
  const dialog = nodes.find(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'aside' && attribute(node.openingElement, 'aria-label') === 'Measurement preferences');
  assert.ok(dialog);
  const dialogClass = attribute(dialog.openingElement, 'className');
  assert.match(dialogClass, /\bflex\b[\s\S]*\bflex-col\b/);
  assert.match(dialogClass, /max-h-\[calc\(100dvh-/);
  assert.match(dialogClass, /md:max-h-\[calc\(100dvh-/);
  assert.doesNotMatch(dialogClass, /(?:^|\s)(?:\w+:)?max-h-none(?:\s|$)/);
  assert.match(dialogClass, /overflow-hidden/);
  const sections = dialog.children.filter(ts.isJsxElement);
  assert.equal(sections.length, 2, 'scroll body and pinned footer must be direct siblings');
  assert.match(attribute(sections[0].openingElement, 'className'), /min-h-0 overflow-y-auto overscroll-contain/);
  const footerClass = attribute(sections[1].openingElement, 'className');
  assert.match(footerClass, /\bshrink-0\b/);
  assert.doesNotMatch(footerClass, /overflow-y-auto|hidden|(?:^|\s)(?:\w+:)?shrink(?:\s|$)/);
  const actions = sections[1].children.filter(node => ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'button');
  assert.equal(actions.length, 2);
  for (const action of actions) assert.match(attribute(action.openingElement, 'className'), /\bh-11\b/);
  const choices = nodes.filter(node => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === 'Checkbox');
  assert.equal(choices.length, 3);
  for (const choice of choices) assert.match(attribute(choice, 'className'), /\bh-11 w-11\b/);
  assert.match(banner, /createPortal\(banner, document\.body\)/);
  assert.match(banner, /return typeof document !== 'undefined' \? createPortal\(banner, document\.body\) : banner/);
  assert.match(banner, /import \{ createPortal \} from 'react-dom'/);
});

// Exercise the component's actual handlers with stateful hooks; WebKit covers DOM/layout separately.
function bannerRuntime({ initial = {}, native = false, pathname = '/product/re-nu.html' } = {}) {
  const values = { analytics: null, marketing: null, google: null, ...initial };
  const writes = [];
  const hooks = [];
  const listeners = new Map();
  let cursor = 0;
  let pending = [];
  let tree;
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: initialValue => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initialValue === 'function' ? initialValue() : initialValue;
      return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
    },
    useEffect: (effect, deps) => {
      const index = cursor++;
      if (!hooks[index] || deps.some((value, i) => value !== hooks[index][i])) pending.push(effect);
      hooks[index] = deps;
    },
  };
  const dispatch = (name, detail) => (listeners.get(name) || []).forEach(listener => listener({ detail }));
  const set = name => value => { writes.push([name, value]); values[name] = value; dispatch(name, value); };
  const noop = () => false;
  const dependencies = {
    react: React,
    'react-dom': { createPortal: node => node },
    'react-router-dom': { useLocation: () => ({ pathname }) },
    'lucide-react': { ChevronDown: 'Icon', ShieldCheck: 'Icon' },
    '@/components/ui/checkbox': { Checkbox: 'Checkbox' },
    '@/lib/nativeRuntime': { isNativeAppRuntime: () => native },
    '@/lib/googleAnalytics': {
      ANALYTICS_CONSENT_EVENT: 'analytics', ANALYTICS_CONSENT_STORAGE_KEY: 'analytics-key',
      GOOGLE_ADS_CONSENT_EVENT: 'google', GOOGLE_ADS_CONSENT_STORAGE_KEY: 'google-key',
      getGoogleAdsMeasurementConsent: () => values.google, setGoogleAdsMeasurementConsent: set('google'),
      getAnalyticsConsent: () => values.analytics, setAnalyticsConsent: set('analytics'),
      syncGoogleMeasurementConsent: noop, isTrackableAnalyticsPath: () => !pathname.startsWith('/admin'), trackGooglePageView: noop,
    },
    '@/lib/metaPixel': {
      MARKETING_CONSENT_EVENT: 'marketing', getMarketingConsent: () => values.marketing,
      setMarketingConsent: set('marketing'), trackMetaPageView: noop,
    },
    '@/lib/snapPixel': { trackSnapPageView: noop },
  };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(banner, { loader: 'jsx', format: 'cjs' }).code, {
    module, exports: module.exports, require: key => { assert.ok(dependencies[key], key); return dependencies[key]; },
    document: { body: {}, title: 'Consent test' },
    window: { location: { pathname }, addEventListener: (name, listener) => listeners.set(name, [...(listeners.get(name) || []), listener]), removeEventListener() {} },
  });
  const render = () => {
    cursor = 0; pending = [];
    tree = module.exports.default();
    pending.forEach(effect => effect());
    return tree;
  };
  const visible = () => {
    const nodes = [];
    const walk = node => {
      if (!node || typeof node !== 'object' || node.props.hidden) return;
      nodes.push(node); node.children.forEach(walk);
    };
    walk(tree); return nodes;
  };
  const text = node => typeof node === 'string' ? node : node?.children?.map(text).join('') || '';
  const button = name => visible().find(node => node.type === 'button' && text(node) === name);
  const click = name => { const node = button(name); assert.ok(node, name); node.props.onClick(); render(); };
  const choices = () => visible().filter(node => node.type === 'Checkbox');
  const choose = (name, value) => { const node = choices().find(node => node.props['aria-label'] === name); assert.ok(node, name); node.props.onCheckedChange(value); render(); };
  render();
  return { values, writes, render, visible, button, click, choices, choose, reset: name => { values[name] = null; dispatch(name, 'reset'); render(); } };
}
await test('first layer is compact, purpose-specific, and has equally prominent accept/decline actions', () => {
  const r = bannerRuntime();
  assert.equal(r.choices().length, 0);
  assert.equal(r.button('Manage preferences').props['aria-expanded'], false);
  assert.equal(r.button('Manage preferences').props['aria-controls'], 'measurement-preference-details');
  assert.equal(r.button('No thanks').props.className, r.button('Accept all').props.className);
  assert.match(banner, /Optional cookies measure site visits and ad results with Google, Meta and Snapchat\. You can shop without them\./);
  assert.deepEqual(r.writes, []);
});
await test('opening, editing, and closing details never implies consent', () => {
  const r = bannerRuntime();
  r.click('Manage preferences');
  assert.equal(r.choices().length, 3);
  assert.ok(r.choices().every(choice => choice.props.checked === false));
  r.choose('Allow advertising measurement', true);
  r.click('Less detail');
  assert.equal(r.choices().length, 0);
  assert.deepEqual(r.writes, []);
  r.click('Manage preferences');
  assert.equal(r.choices().find(choice => choice.props['aria-label'] === 'Allow advertising measurement').props.checked, true);
});
await test('Accept all is an explicit three-purpose grant with Google captured before analytics', () => {
  const r = bannerRuntime(); r.click('Accept all');
  assert.deepEqual(r.writes, [['google', 'granted'], ['analytics', 'granted'], ['marketing', 'granted']]);
  assert.deepEqual(r.values, { analytics: 'granted', marketing: 'granted', google: 'granted' });
  assert.equal(r.visible().length, 0);
});
await test('No thanks refuses all purposes from either layer, including unsaved selections', () => {
  for (const detailed of [false, true]) {
    const r = bannerRuntime();
    if (detailed) { r.click('Manage preferences'); r.choose('Allow Google ad measurement', true); }
    r.click('No thanks');
    assert.deepEqual(r.values, { analytics: 'denied', marketing: 'denied', google: 'denied' });
    assert.equal(r.visible().length, 0);
  }
});
await test('Save choices preserves independent purpose selections instead of accepting all', () => {
  for (const [label, purpose] of [['Allow Google Analytics', 'analytics'], ['Allow advertising measurement', 'marketing'], ['Allow Google ad measurement', 'google']]) {
    const r = bannerRuntime(); r.click('Manage preferences'); r.choose(label, true); r.click('Save choices');
    assert.deepEqual(r.values, { analytics: 'denied', marketing: 'denied', google: 'denied', [purpose]: 'granted' });
    assert.equal(r.visible().length, 0);
  }
});
await test('legacy grants never opt into Google without a new explicit choice', () => {
  const r = bannerRuntime({ initial: { analytics: 'granted', marketing: 'granted' } });
  assert.deepEqual(r.writes, []);
  r.click('Manage preferences');
  assert.equal(r.choices().find(choice => choice.props['aria-label'] === 'Allow Google ad measurement').props.checked, false);
  r.click('Save choices');
  assert.deepEqual(r.values, { analytics: 'granted', marketing: 'granted', google: 'denied' });
});
await test('privacy-page resets reopen detailed controls and allow withdrawal', () => {
  const r = bannerRuntime({ initial: { analytics: 'granted', marketing: 'granted', google: 'granted' } });
  assert.equal(r.visible().length, 0);
  for (const purpose of ['analytics', 'marketing', 'google']) r.reset(purpose);
  assert.equal(r.choices().length, 3);
  assert.ok(r.choices().every(choice => choice.props.checked === false));
  assert.ok(r.button('Save choices'));
  assert.deepEqual(r.writes, []);
  r.click('No thanks');
  assert.deepEqual(r.values, { analytics: 'denied', marketing: 'denied', google: 'denied' });
});
await test('compact consent remains absent in native runtime, checkout, and admin', () => {
  for (const options of [{ native: true }, { pathname: '/checkout' }, { pathname: '/admin' }]) {
    const r = bannerRuntime(options); assert.equal(r.visible().length, 0); assert.deepEqual(r.writes, []);
  }
});
console.log(JSON.stringify({ ok: true, suite: 'g196-google-ads-consent', cases: results.length, checks: results, live_provider_calls: 0, production_writes: false }, null, 2));
