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
await test('the new choice is visible, independently unchecked for old visitors, resettable, and disclosed', () => {
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
console.log(JSON.stringify({ ok: true, suite: 'g196-google-ads-consent', cases: results.length, checks: results, live_provider_calls: 0, production_writes: false }, null, 2));
