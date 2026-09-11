#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const source = fs.readFileSync(new URL('../../src/lib/metaPixel.js', import.meta.url), 'utf8');
const consentKey = 'nuvira_marketing_consent_v1';
const product = { id: 'oasis', title: 'OASIS', price: 13 };
const eventNames = ['PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'CompleteRegistration', 'Lead'];
let checks = 0;
let networkAttempts = 0;
const blockedFetch = async () => {
  networkAttempts += 1;
  throw new Error('Live network is forbidden in this isolated regression');
};

function browser({ origin = 'https://nuvirajuice.com', frame = 'top', native = false, consent = 'granted', pixel = 'loaded' } = {}) {
  const storage = new Map(consent ? [[consentKey, consent]] : []);
  const cookies = new Map();
  const cookieWrites = [];
  const scripts = new Map();
  const server = [];
  const window = {
    location: { origin, pathname: '/product/oasis.html', search: '?fbclid=IwAROfflineExample', href: `${origin}/product/oasis.html?fbclid=IwAROfflineExample` },
    navigator: { userAgent: 'Offline regression browser' },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    dispatchEvent: () => true,
  };
  if (frame === 'top') window.top = window;
  if (frame === 'embedded') window.top = { location: { origin: 'https://app.base44.com' } };
  if (frame === 'unreadable') Object.defineProperty(window, 'top', { get() { throw new Error('Blocked frame access'); } });
  const document = {
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join('; '); },
    set cookie(raw) {
      cookieWrites.push(raw);
      const pair = raw.split(';')[0];
      const offset = pair.indexOf('=');
      const key = pair.slice(0, offset);
      if (/Max-Age=0(?:;|$)/.test(raw)) cookies.delete(key);
      else cookies.set(key, pair.slice(offset + 1));
    },
    createElement: () => ({ dataset: {}, remove() { scripts.delete(this.id); } }),
    getElementById: (id) => scripts.get(id),
    head: { appendChild(script) {
      scripts.set(script.id, script);
      if (pixel !== 'pending') queueMicrotask(() => pixel === 'loaded' ? script.onload() : script.onerror());
    } },
  };
  const context = vm.createContext({
    window, document, URL, URLSearchParams, Uint32Array, crypto: webcrypto, Date, Math,
    queueMicrotask, setTimeout, clearTimeout, fetch: blockedFetch,
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    __native: native,
    __transport: { sendMetaFunnelEvent: async (payload) => { server.push(payload); return true; } },
  });
  vm.runInContext(source
    .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", 'const isNativeAppRuntime = () => __native;')
    .replace("import('./metaFunnelTransport.js')", 'Promise.resolve(__transport)')
    .replace(/^export /gm, '')
    + '\nglobalThis.api = { setMarketingConsent, resetMarketingConsent, getMarketingConsent, loadMetaPixel, trackMetaPageView, trackMetaViewContent, trackMetaStandardEvent, getMetaCapiAttributionContext, isSafeMarketingEventContext, isTrackableMarketingPageView };', context);
  return { api: context.api, window, document, storage, cookies, cookieWrites, scripts, server, context };
}

const tracked = (instance) => instance.window.fbq?.queue?.filter((entry) => entry[0] === 'track') ?? [];
async function check(name, test) {
  await test();
  checks += 1;
  console.log(`PASS ${checks}: ${name}`);
}

for (const origin of ['https://nuvirajuice.com', 'https://www.nuvirajuice.com', 'https://nuvira-fresh-flow.base44.app']) {
  await check(`consented top-level production page works: ${origin}`, async () => {
    const instance = browser({ origin });
    assert.equal(await instance.api.trackMetaPageView('/product/oasis.html'), true);
    assert.equal(await instance.api.trackMetaViewContent(product), true);
    assert.equal(instance.scripts.size, 1);
    assert.equal(tracked(instance).filter((entry) => entry[1] === 'PageView').length, 1);
    const view = tracked(instance).find((entry) => entry[1] === 'ViewContent');
    assert.equal(view[2].content_ids[0], '43220774944858');
    assert.equal(view[2].value, 13);
    assert.equal(instance.window.fbq.queue.filter((entry) => entry[0] === 'init' && entry[1] === '719023677458304').length, 1);
    if (origin.endsWith('.base44.app')) {
      assert.equal(instance.server.length, 0, 'published fallback must not expand the server relay allowlist');
      assert.equal(instance.cookieWrites.length, 0, 'NuVira-domain custom cookies must not be written from the fallback host');
    } else {
      assert.equal(instance.server.length, 1);
      assert.equal(instance.server[0].event_id, view[3].eventID);
      assert.ok(instance.cookies.has('_fbp'));
      assert.ok(instance.cookies.has('_fbc'));
    }
  });
}

const rejectedOrigins = [
  'https://app.base44.com', 'https://preview-sandbox.base44.com',
  'https://preview-nuvira-fresh-flow.base44.app', 'http://localhost:5173',
  'http://127.0.0.1:5173', 'https://nuvira-juice-company.myshopify.com',
  'https://staging.nuvirajuice.com', 'http://nuvirajuice.com',
  'https://nuvirajuice.com:444', 'https://nuvirajuice.com.attacker.test',
  'https://attacker.test', 'null', undefined,
];
for (const origin of rejectedOrigins) {
  await check(`unapproved origin sends no Meta telemetry: ${String(origin)}`, async () => {
    const instance = browser({ origin });
    // An omitted browser origin must fail closed, not use the fixture default.
    if (origin === undefined) delete instance.window.location.origin;
    assert.equal(await instance.api.loadMetaPixel(), false);
    for (const name of eventNames) assert.equal(await instance.api.trackMetaStandardEvent(name), false);
    assert.equal(instance.api.getMetaCapiAttributionContext(), null);
    assert.equal(instance.scripts.size, 0);
    assert.equal(instance.server.length, 0);
    assert.equal(instance.cookieWrites.length, 0);
    assert.equal(instance.window.fbq, undefined);
    assert.equal(instance.api.isSafeMarketingEventContext(), true, 'shared Snapchat context semantics are not changed');
    assert.equal(instance.api.isTrackableMarketingPageView('/shop'), true);
    const foreignQueue = [];
    instance.window.fbq = (...args) => foreignQueue.push(args);
    assert.equal(instance.api.setMarketingConsent('granted'), true, 'preview consent controls remain usable');
    assert.equal(instance.api.getMarketingConsent(), 'granted');
    assert.equal(foreignQueue.length, 0, 'do not grant an existing foreign pixel on an unapproved origin');
    assert.equal(instance.api.setMarketingConsent('denied'), true);
    assert.deepEqual(foreignQueue, [['consent', 'revoke']], 'revocation and cookie cleanup remain available');
  });
}

for (const frame of ['embedded', 'unreadable', 'missing']) {
  await check(`approved origin in ${frame} frame fails closed`, async () => {
    const instance = browser({ frame });
    assert.equal(await instance.api.trackMetaPageView('/shop'), false);
    assert.equal(await instance.api.trackMetaViewContent(product), false);
    assert.equal(instance.api.getMetaCapiAttributionContext(), null);
    assert.equal(instance.scripts.size, 0);
    assert.equal(instance.server.length, 0);
    assert.equal(instance.cookieWrites.length, 0);
  });
}

await check('native and unconsented production visits remain unmeasured', async () => {
  for (const options of [{ native: true }, { consent: null }, { consent: 'denied' }]) {
    const instance = browser(options);
    assert.equal(await instance.api.trackMetaPageView('/shop'), false);
    assert.equal(await instance.api.trackMetaViewContent(product), false);
    assert.equal(instance.api.getMetaCapiAttributionContext(), null);
    assert.equal(instance.scripts.size, 0);
    assert.equal(instance.server.length, 0);
    assert.equal(instance.cookieWrites.length, 0);
  }
});

await check('private routes and sensitive queries stay excluded', async () => {
  const instance = browser();
  for (const path of ['/admin', '/account', '/checkout', '/login', '/order-confirmation', '/_preview']) {
    instance.window.location.pathname = path;
    assert.equal(await instance.api.trackMetaPageView(path), false);
  }
  instance.window.location.pathname = '/shop';
  instance.window.location.search = '?payment_intent_client_secret=offline-only';
  assert.equal(await instance.api.trackMetaViewContent(product), false);
  assert.equal(instance.scripts.size, 0);
  assert.equal(instance.server.length, 0);
});

for (const change of ['origin', 'frame', 'consent', 'native']) {
  await check(`delayed pixel load rechecks ${change}`, async () => {
    const instance = browser({ pixel: 'pending' });
    const pending = instance.api.trackMetaViewContent(product);
    if (change === 'origin') instance.window.location.origin = 'https://app.base44.com';
    if (change === 'frame') instance.window.top = {};
    if (change === 'consent') instance.api.setMarketingConsent('denied');
    if (change === 'native') instance.context.__native = true;
    instance.scripts.get('nuvira-meta-pixel').onload();
    assert.equal(await pending, false);
    assert.equal(tracked(instance).length, 0);
    assert.equal(instance.server.length, 0, 'queued relay work must also recheck before sending');
  });
}

await check('published fallback cannot inherit a queued apex relay request', async () => {
  const instance = browser({ pixel: 'pending' });
  const pending = instance.api.trackMetaViewContent(product);
  instance.window.location.origin = 'https://nuvira-fresh-flow.base44.app';
  instance.scripts.get('nuvira-meta-pixel').onload();
  assert.equal(await pending, true);
  assert.equal(instance.server.length, 0);
});

await check('withdrawal then regrant does not replay an old queued event', async () => {
  const instance = browser({ pixel: 'pending' });
  const pending = instance.api.trackMetaPageView('/shop');
  instance.api.setMarketingConsent('denied');
  instance.api.setMarketingConsent('granted');
  instance.scripts.get('nuvira-meta-pixel').onload();
  assert.equal(await pending, false);
  assert.equal(tracked(instance).length, 0);
});

await check('browser purchase authority and critical registration stay unchanged', async () => {
  const instance = browser();
  assert.equal(await instance.api.trackMetaStandardEvent('Purchase'), false);
  assert.equal(instance.scripts.size, 0);
  assert.equal(instance.server.length, 0);
  const runner = fs.readFileSync(new URL('../ci/run-critical-regressions.mjs', import.meta.url), 'utf8');
  assert.match(runner, /run-meta-production-origin-tests\.mjs/);
});

assert.equal(networkAttempts, 0);
console.log(JSON.stringify({ ok: true, suite: 'meta-production-origin', checks, live_network_attempts: networkAttempts, provider_events_created: 0 }));
