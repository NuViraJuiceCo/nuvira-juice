#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { webcrypto } from 'node:crypto';
import { createMetaFunnelHandler } from '../../base44/functions/getCustomerAccountDashboardData/handlers/trackMetaFunnelEvent/handler.js';

// Base44 packages the selected function and base44/shared, not sibling functions.
const gatewayRoot = new URL('../../base44/functions/getCustomerAccountDashboardData/', import.meta.url);
const sharedRoot = new URL('../../base44/shared/', import.meta.url);
const visitedModules = new Set();
function verifyPackagedImports(file) {
  if (visitedModules.has(file.href)) return;
  visitedModules.add(file.href);
  assert.ok(file.href.startsWith(gatewayRoot.href) || file.href.startsWith(sharedRoot.href), `Unpackaged dependency: ${file.href}`);
  const source = ts.createSourceFile(file.pathname, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (specifier && ts.isStringLiteral(specifier) && specifier.text.startsWith('.')) {
      verifyPackagedImports(new URL(specifier.text, file));
    }
  }
}
verifyPackagedImports(new URL('entry.ts', gatewayRoot));

const epoch = 1788700000000;
const values = new Map([
  ['META_CAPI_FUNNEL_MODE', 'live'],
  ['META_CONVERSIONS_API_TOKEN', 'synthetic-funnel-token'],
  ['META_CONVERSIONS_API_TEST_EVENT_CODE', 'TEST_SYNTHETIC'],
]);
const env = { get: (key) => values.get(key) };
const calls = [];
const logs = [];
let userReads = 0;
const fetchImpl = async (url, options) => {
  calls.push({ url, options, payload: JSON.parse(options.body) });
  return Response.json({ events_received: 1 });
};
const handler = createMetaFunnelHandler({
  env, now: () => epoch, fetchImpl, log: (...args) => logs.push(args),
  getUser: async () => { userReads += 1; return { id: 'account_123', email: 'buyer@example.test', full_name: 'Jordan Taylor' }; },
});
const baseEvent = {
  event_name: 'AddToCart', event_id: 'web:AddToCart:synthetic-event-0001', event_time: epoch / 1000,
  marketing_measurement_consent: 'granted',
  attribution: {
    event_source_url: 'https://nuvirajuice.com/shop/oasis?email=never@example.test&fbclid=strip-me#private',
    fbp: 'fb.1.1788700000000.1234567890', fbc: 'fb.1.1788700000000.IwARSyntheticClick',
    client_ip_address: '198.51.100.9', client_user_agent: 'body-forged-agent',
  },
  custom_data: {
    currency: 'USD', value: 26, content_type: 'product',
    contents: [{ id: '43220774944858', quantity: 2, item_price: 13 }],
    content_ids: ['forged-id'], customer_email: 'do-not-forward@example.test',
    content_name: 'private free text',
  },
  customer_email: 'untrusted@example.test',
};
const request = (body = baseEvent, headers = {}, method = 'POST') => new Request('https://nuvirajuice.com/api/functions/customer-gateway', {
  method,
  headers: {
    origin: 'https://nuvirajuice.com', 'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.42', 'user-agent': 'Synthetic Browser', ...headers,
  },
  ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});
const result = async (body, headers) => (await handler(request(body, headers))).json();

assert.equal((await result()).sent, true);
assert.equal(calls.length, 1);
const sent = calls[0].payload.data[0];
assert.equal(sent.event_name, baseEvent.event_name);
assert.equal(sent.event_id, baseEvent.event_id);
assert.equal(sent.event_source_url, 'https://nuvirajuice.com/shop/oasis');
assert.equal(sent.user_data.client_ip_address, '203.0.113.42');
assert.equal(sent.user_data.client_user_agent, 'Synthetic Browser');
assert.match(sent.user_data.em[0], /^[a-f0-9]{64}$/);
assert.match(sent.user_data.external_id[0], /^[a-f0-9]{64}$/);
assert.equal(sent.user_data.country, undefined);
assert.equal(sent.custom_data.content_name, undefined);
assert.deepEqual(sent.custom_data.content_ids, ['43220774944858']);
assert.equal(sent.custom_data.num_items, 2);
assert.equal(calls[0].options.headers.authorization, 'Bearer synthetic-funnel-token');
assert.equal(calls[0].url, 'https://graph.facebook.com/v26.0/719023677458304/events');
assert.equal(calls[0].payload.test_event_code, undefined);
assert.doesNotMatch(JSON.stringify(calls[0].payload), /@|body-forged|198\.51\.100|private free text/);
assert.doesNotMatch(JSON.stringify(logs), /token|@|203\.0\.113|fb\.1\./);
assert.equal((await result()).deduplicated, true);
assert.equal(calls.length, 1);

const rejected = [
  { ...baseEvent, marketing_measurement_consent: 'denied' },
  { ...baseEvent, marketing_measurement_consent: undefined },
  { ...baseEvent, event_name: 'Purchase', event_id: 'web:Purchase:synthetic-event-0001' },
  { ...baseEvent, event_id: 'web:ViewContent:synthetic-event-0001' },
  { ...baseEvent, event_time: epoch / 1000 - 601 },
  { ...baseEvent, event_time: epoch / 1000 + 61 },
  { ...baseEvent, attribution: { event_source_url: 'https://attacker.test/shop' } },
  { ...baseEvent, attribution: { event_source_url: 'https://nuvirajuice.com/admin' } },
  { ...baseEvent, attribution: { event_source_url: 'https://nuvirajuice.com/account/123' } },
  { ...baseEvent, custom_data: { ...baseEvent.custom_data, value: -1 } },
  { ...baseEvent, custom_data: { ...baseEvent.custom_data, value: '26' } },
  { ...baseEvent, custom_data: { ...baseEvent.custom_data, currency: 'EUR' } },
  { ...baseEvent, custom_data: { ...baseEvent.custom_data, contents: [{ id: 'email@example.test', quantity: 1, item_price: 13 }] } },
  { ...baseEvent, custom_data: { ...baseEvent.custom_data, contents: [{ id: '43220774944858', quantity: 0, item_price: 13 }] } },
  { ...baseEvent, custom_data: { ...baseEvent.custom_data, contents: Array(101).fill(baseEvent.custom_data.contents[0]) } },
];
for (const event of rejected) assert.equal((await result(event)).sent, false);
assert.equal((await handler(request(baseEvent, { origin: 'https://attacker.test' }))).status, 403);
assert.equal((await handler(request(baseEvent, { origin: '' }))).status, 403);
assert.equal((await handler(request(baseEvent, {}, 'GET'))).status, 405);
assert.equal((await handler(request('{broken'))).status, 400);
assert.equal((await handler(request('x'.repeat(16385)))).status, 413);
assert.equal(calls.length, 1);
assert.equal(userReads, 1, 'rejected requests must not look up customers');

assert.equal((await result({ ...baseEvent, event_id: 'web:AddToCart:canonical-product-0001', attribution: { ...baseEvent.attribution, event_source_url: 'https://nuvirajuice.com/product/oasis.html' } })).sent, true);
assert.equal(calls.at(-1).payload.data[0].event_source_url, 'https://nuvirajuice.com/product/oasis.html');

values.delete('META_CAPI_FUNNEL_MODE');
assert.equal((await result()).reason, 'funnel_disabled');
values.set('META_CAPI_FUNNEL_MODE', 'test');
assert.equal((await result()).sent, true, 'test/live dedup namespaces are separate');
assert.equal(calls.at(-1).payload.test_event_code, 'TEST_SYNTHETIC');
values.delete('META_CONVERSIONS_API_TEST_EVENT_CODE');
assert.equal((await result()).reason, 'funnel_not_configured');
values.set('META_CAPI_FUNNEL_MODE', 'live');

const guest = createMetaFunnelHandler({ env, now: () => epoch, fetchImpl, log: () => {} });
for (const name of ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo']) {
  const event = { ...baseEvent, event_name: name, event_id: `web:${name}:synthetic-event-0002` };
  assert.equal((await (await guest(request(event))).json()).sent, true);
  assert.equal(calls.at(-1).payload.data[0].user_data.em, undefined);
}
const program = { ...baseEvent, event_id: 'web:AddToCart:synthetic-program-0003', attribution: { ...baseEvent.attribution, event_source_url: 'https://nuvirajuice.com/program/hydration' } };
assert.equal((await (await guest(request(program))).json()).sent, true);

let releaseFetch;
let concurrentCalls = 0;
const concurrent = createMetaFunnelHandler({
  env, now: () => epoch, log: () => {},
  fetchImpl: async () => { concurrentCalls += 1; await new Promise((resolve) => { releaseFetch = resolve; }); return Response.json({ events_received: 1 }); },
});
const first = concurrent(request());
const second = concurrent(request());
while (!releaseFetch) await new Promise((resolve) => setTimeout(resolve, 1));
releaseFetch();
assert.equal((await (await first).json()).sent, true);
assert.equal((await (await second).json()).sent, true);
assert.equal(concurrentCalls, 1);

let attempts = 0;
const retry = createMetaFunnelHandler({
  env, now: () => epoch, log: () => {},
  fetchImpl: async () => { attempts += 1; return attempts === 1 ? Response.json({ events_received: 0 }) : Response.json({ events_received: 1 }); },
});
assert.equal((await (await retry(request())).json()).sent, false);
assert.equal((await (await retry(request())).json()).sent, true);
assert.equal(attempts, 2);
const unavailable = createMetaFunnelHandler({ env, now: () => epoch, log: () => {}, fetchImpl: async () => { throw new Error('synthetic failure'); } });
assert.equal((await (await unavailable(request())).json()).reason, 'transport_failed');
const limited = createMetaFunnelHandler({ env, now: () => epoch, log: () => {}, fetchImpl });
for (let index = 0; index < 60; index += 1) {
  assert.equal((await limited(request({ ...baseEvent, event_id: `web:AddToCart:synthetic-rate-${String(index).padStart(4, '0')}` }))).status, 200);
}
assert.equal((await limited(request({ ...baseEvent, event_id: 'web:AddToCart:synthetic-rate-limit' }))).status, 429);

const source = fs.readFileSync(new URL('../../src/lib/metaPixel.js', import.meta.url), 'utf8');
function browser({ native = false, pixel = 'loaded', origin = 'https://nuvirajuice.com' } = {}) {
  const storage = new Map();
  const cookies = new Map();
  const server = [];
  const scripts = new Map();
  const listeners = new Map();
  const location = { origin, href: `${origin}/shop?fbclid=IwARSyntheticClick`, pathname: '/shop', search: '?fbclid=IwARSyntheticClick' };
  const document = {
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(raw) { const pair = raw.split(';')[0]; const split = pair.indexOf('='); const key = pair.slice(0, split); if (/Max-Age=0(?:;|$)/.test(raw)) cookies.delete(key); else cookies.set(key, pair.slice(split + 1)); },
    createElement: () => ({ dataset: {}, remove() { scripts.delete(this.id); } }),
    getElementById: (id) => scripts.get(id),
    head: { appendChild: (script) => { scripts.set(script.id, script); if (pixel !== 'pending') queueMicrotask(() => pixel === 'loaded' ? script.onload() : script.onerror()); } },
  };
  const window = {
    location, navigator: { userAgent: 'Synthetic Browser' },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name),
    dispatchEvent: (event) => listeners.get(event.type)?.(event),
  };
  const context = vm.createContext({
    window, document, URL, URLSearchParams, Uint32Array, crypto: webcrypto, Date, Math, console, queueMicrotask, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type, data) { this.type = type; this.detail = data?.detail; } },
    __native: native,
    __transport: { sendMetaFunnelEvent: async (payload) => { server.push(payload); return true; } },
  });
  vm.runInContext(source
    .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", 'const isNativeAppRuntime = () => __native;')
    .replace("import('./metaFunnelTransport.js')", 'Promise.resolve(__transport)')
    .replace(/^export /gm, '')
    + '\nglobalThis.api = { setMarketingConsent, resetMarketingConsent, trackMetaAddToCart, trackMetaViewContent, trackMetaPageView, getMetaCapiAttributionContext };', context);
  return { api: context.api, window, server, cookies, scripts, context };
}

const b = browser();
const oasis = { id: 'oasis', title: 'OASIS', price: 13 };
assert.equal(await b.api.trackMetaAddToCart(oasis), false);
assert.equal(b.cookies.size, 0);
assert.equal(b.scripts.size, 0);
b.api.setMarketingConsent('granted');
assert.equal(await b.api.trackMetaAddToCart(oasis, 2), true);
await new Promise((resolve) => setImmediate(resolve));
assert.equal(b.server.length, 1);
const browserEvent = b.window.fbq.queue.map((entry) => Array.from(entry)).find((entry) => entry[0] === 'track');
assert.equal(b.server[0].event_id, browserEvent[3].eventID);
assert.equal(b.server[0].event_name, browserEvent[1]);
assert.equal(b.server[0].custom_data.value, 26);
const fbc = b.api.getMetaCapiAttributionContext().fbc;
const fbp = b.api.getMetaCapiAttributionContext().fbp;
b.window.location.href = 'https://nuvirajuice.com/checkout';
b.window.location.search = '';
assert.equal(b.api.getMetaCapiAttributionContext().fbc, fbc, 'ad click survives SPA navigation');
assert.equal(b.api.getMetaCapiAttributionContext().fbp, fbp);
b.window.location.href = 'https://nuvirajuice.com/shop?fbclid=IwARAnotherSyntheticClick';
const newerFbc = b.api.getMetaCapiAttributionContext().fbc;
assert.notEqual(newerFbc, fbc, 'a later ad click replaces the earlier attribution');
assert.equal(b.api.getMetaCapiAttributionContext().fbc, newerFbc, 'repeat reads preserve the click timestamp');
b.api.setMarketingConsent('denied');
assert.equal(b.cookies.size, 0);
assert.equal(b.api.getMetaCapiAttributionContext(), null);

const blocked = browser({ pixel: 'blocked' });
blocked.api.setMarketingConsent('granted');
assert.equal(await blocked.api.trackMetaAddToCart(oasis), true, 'server success is recognized even when the pixel is blocked');
assert.equal(blocked.server.length, 1);
assert.equal(blocked.window.fbq.queue.some((entry) => entry[0] === 'track'), false);

const revoked = browser({ pixel: 'pending' });
revoked.api.setMarketingConsent('granted');
const pending = revoked.api.trackMetaAddToCart(oasis);
revoked.api.setMarketingConsent('denied');
revoked.api.setMarketingConsent('granted');
revoked.scripts.get('nuvira-meta-pixel').onload();
assert.equal(await pending, false);
assert.equal(revoked.server.length, 0, 'queued events cannot replay after consent was withdrawn');
assert.equal(revoked.window.fbq.queue.some((entry) => entry[0] === 'track'), false);

const native = browser({ native: true });
assert.equal(native.api.setMarketingConsent('granted'), false);
assert.equal(await native.api.trackMetaAddToCart(oasis), false);
assert.equal(native.server.length, 0);
const preview = browser({ origin: 'http://localhost:5173' });
preview.api.setMarketingConsent('granted');
await preview.api.trackMetaAddToCart(oasis);
assert.equal(preview.server.length, 0, 'local previews must not call the live CAPI relay');
const sensitive = browser();
sensitive.api.setMarketingConsent('granted');
sensitive.window.location.search = '?payment_intent_client_secret=synthetic';
assert.equal(await sensitive.api.trackMetaAddToCart(oasis), false);
assert.equal(sensitive.server.length, 0);

const transportSource = fs.readFileSync(new URL('../../src/lib/metaFunnelTransport.js', import.meta.url), 'utf8');
let consent = 'granted';
let transportOptions;
let consentListener;
const transportContext = vm.createContext({
  AbortController, setTimeout, clearTimeout,
  MARKETING_CONSENT_EVENT: 'nuvira:marketing-consent',
  getMarketingConsent: () => consent,
  window: {
    addEventListener: (_name, listener) => { consentListener = listener; },
    removeEventListener: () => { consentListener = null; },
  },
  invokeCustomerGateway: async (action, body, options) => {
    assert.equal(action, 'trackMetaFunnelEvent');
    assert.equal(body.event_id, baseEvent.event_id);
    transportOptions = options;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  },
});
vm.runInContext(transportSource.replace(/^import .*;\n/gm, '').replace(/^export /gm, '')
  + '\nglobalThis.send = sendMetaFunnelEvent;', transportContext);
const transportPending = transportContext.send(baseEvent);
assert.equal(transportOptions.keepalive, true);
consent = 'denied';
consentListener();
assert.equal(transportOptions.signal.aborted, true);
assert.equal(await transportPending, false);
assert.equal(consentListener, null);
assert.equal(await transportContext.send(baseEvent), false);

console.log(JSON.stringify({
  ok: true, suite: 'meta-funnel-capi',
  commerce_events: ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo'],
  shared_browser_server_event_id: true, consent_withdrawal_tested: true,
  blocked_pixel_fallback_tested: true, attribution_survives_navigation: true,
  duplicate_and_concurrent_delivery_tested: true, invalid_event_and_rate_limits_tested: true,
  hashed_authenticated_identity_only: true, raw_customer_data_logged: false,
  purchase_endpoint_not_exposed: true, live_provider_calls_performed: false,
}, null, 2));
