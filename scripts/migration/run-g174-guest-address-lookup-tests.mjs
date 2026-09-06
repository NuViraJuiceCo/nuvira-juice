#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { transformSync } from 'esbuild';

const read = path => fs.readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const nestedPath = 'base44/functions/getCustomerAccountDashboardData/handlers/addressSuggest/entry.ts';
const nested = read(nestedPath);
const standalone = read('base44/functions/addressSuggest/entry.ts');
assert.equal(standalone.replace('Deno.serve(handler);', 'export default handler;'), nested, 'legacy and gateway lookup must not drift');
assert.doesNotMatch(nested, /createClientFromRequest|auth\.me|asServiceRole|entities\./);
const gatewaySource = read('base44/functions/getCustomerAccountDashboardData/entry.ts');
assert.match(gatewaySource, /Bundle revision: g174-guest-address-20260906/);
let cases = 0;
const test = async (name, run) => { await run(); cases += 1; console.log('PASS ' + name); };
const request = (body = {}, headers = {}, method = 'POST') => new Request('https://synthetic.invalid/api/functions/getCustomerAccountDashboardData', {
  method, headers: { 'Content-Type': 'application/json', ...headers },
  ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
});
const components = [
  ['street_number', '619', '619'], ['route', 'North Main Street', 'N Main St'],
  ['locality', "O'Fallon", "O'Fallon"], ['administrative_area_level_1', 'Missouri', 'MO'],
  ['postal_code', '63366', '63366'], ['country', 'United States', 'US'],
].map(([type, long_name, short_name]) => ({ types: [type], long_name, short_name }));
const provider = url => Response.json(url.pathname.includes('autocomplete')
  ? { status: 'OK', predictions: [{ place_id: 'synthetic-place', description: 'Untrusted provider description' }] }
  : { status: 'OK', result: { address_components: components } });

function runtime({ source = nested, fetcher = provider, key = 'synthetic-google-key', authUser = null, timeout = false } = {}) {
  const calls = [];
  let now = 100000;
  let sdkCalls = 0;
  let secretReads = 0;
  const forbidden = new Proxy({}, { get() { throw new Error('Unexpected account/entity access'); } });
  const context = vm.createContext({
    Request, Response, URL, URLSearchParams, TextDecoder, TextEncoder, Uint8Array,
    crypto: webcrypto, Date: class extends Date { static now() { return now; } },
    AbortSignal: { timeout(ms) { assert.equal(ms, 6000); return AbortSignal.timeout(timeout ? 1 : ms); } },
    Deno: { env: { get(name) { assert.equal(name, 'GOOGLE_MAPS_API_KEY'); secretReads++; return key; } }, serve(fn) { context.__handler = fn; } },
    createClientFromRequest() {
      sdkCalls++;
      return { auth: { me: async () => authUser }, asServiceRole: forbidden, entities: forbidden };
    },
    fetch: async (url, options) => {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://maps.googleapis.com');
      assert.ok(options.signal);
      calls.push({ url: parsed, signal: options.signal });
      return fetcher(parsed, options);
    },
    console: { log() {}, warn() {}, error() { throw new Error('Lookup must not log private query/provider errors'); } },
  });
  function load(text) {
    const rewritten = text
      .replace(/^import \{ createClientFromRequest \} from 'npm:[^']+';\n/gm, '')
      .replace(/export default async function handler/, 'async function handler')
      .replace(/export default handler;/, '')
      .replace(/Deno\.serve\(handler\);/, '');
    const js = transformSync(rewritten + '\nglobalThis.__handler = handler;', { loader: 'ts', target: 'es2022' }).code;
    vm.runInContext(js, context);
    return context.__handler;
  }
  const handler = load(source);
  return { handler, load, calls, context, advance: ms => { now += ms; },
    stats: () => ({ sdkCalls, secretReads }) };
}

await test('empty and short anonymous input succeeds with no SDK or provider access', async () => {
  const r = runtime();
  for (const query of ['', 'a', 'ab', '  ab  ']) {
    const res = await r.handler(request({ query }));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { suggestions: [] });
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('x-address-suggest-revision'), 'g174-guest-address-20260906');
  }
  assert.equal(r.calls.length, 0);
  assert.deepEqual(r.stats(), { sdkCalls: 0, secretReads: 0 });
});

await test('guest and signed-in callers both receive the existing structured response', async () => {
  for (const source of [nested, standalone]) {
    for (const headers of [{}, { Authorization: 'Bearer synthetic-member' }]) {
      const r = runtime({ source });
      const res = await r.handler(request({ query: '  619   North Main  ' }, headers));
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { suggestions: [{
        street: '619 North Main Street', city: "O'Fallon", state: 'MO', zip: '63366',
        display: "619 North Main Street, O'Fallon, MO 63366",
      }] });
      assert.equal(r.stats().sdkCalls, 0);
      assert.equal(r.calls.length, 2);
      assert.equal(r.calls[0].url.searchParams.get('input'), '619 North Main');
      assert.equal(r.calls[0].url.searchParams.get('components'), 'country:us');
      assert.equal(r.calls[0].url.searchParams.get('location'), '38.8106,-90.6998');
      assert.equal(r.calls[0].url.searchParams.get('radius'), '40000');
      assert.equal(r.calls[1].url.searchParams.get('fields'), 'address_components');
      assert.equal(r.calls[0].signal, r.calls[1].signal, 'one deadline covers both provider phases');
    }
  }
});

await test('method, malformed JSON, body shape/type/length/control characters rejected before provider', async () => {
  const r = runtime();
  assert.equal((await r.handler(request({}, {}, 'GET'))).status, 405);
  assert.equal((await r.handler(request('{'))).status, 400);
  for (const body of [null, [], 4, { query: 123 }, { query: {} }, { query: [] }, { query: 'x'.repeat(201) }, { query: 'ab\ncd' }]) {
    assert.equal((await r.handler(request(JSON.stringify(body)))).status, 400);
  }
  assert.equal((await r.handler(request({ query: 'x'.repeat(1200) }))).status, 413);
  assert.equal(r.calls.length, 0);
  assert.equal(r.stats().secretReads, 0);
});

await test('streamed oversized body is cancelled without depending on content-length', async () => {
  const r = runtime();
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(1025))); },
    cancel() { cancelled = true; },
  });
  const req = new Request('https://synthetic.invalid', { method: 'POST', body, duplex: 'half' });
  assert.equal((await r.handler(req)).status, 413);
  assert.equal(cancelled, true);
  assert.equal(r.calls.length, 0);
});

await test('missing key and upstream errors are sanitized; manual-entry fallback remains possible', async () => {
  const missing = runtime({ key: '' });
  assert.equal((await missing.handler(request({ query: '619 Main' }))).status, 503);
  assert.equal(missing.calls.length, 0);
  for (const fetcher of [
    () => Response.json({ status: 'REQUEST_DENIED', error_message: 'private-provider-message' }),
    () => new Response('provider detail', { status: 500 }),
    () => { throw new Error('https://secret-provider-url?key=synthetic-google-key'); },
    () => new Response('not-json'),
  ]) {
    const r = runtime({ fetcher });
    const res = await r.handler(request({ query: '619 Main' }));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { error: 'address_lookup_unavailable' });
  }
});

await test('no matching addresses is not a provider error', async () => {
  const r = runtime({ fetcher: () => Response.json({ status: 'ZERO_RESULTS' }) });
  const res = await r.handler(request({ query: 'no address' }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { suggestions: [] });
  assert.equal(r.calls.length, 1);
});

await test('at most five details calls and encoded place IDs; incomplete/non-US results omitted', async () => {
  const r = runtime({ fetcher: url => {
    if (url.pathname.includes('autocomplete')) return Response.json({ status: 'OK',
      predictions: Array.from({ length: 8 }, (_, index) => ({ place_id: index + '&fields=secret' })) });
    assert.equal(url.searchParams.get('fields'), 'address_components');
    const index = Number(url.searchParams.get('place_id').split('&')[0]);
    return Response.json({ status: 'OK', result: { address_components: index === 0 ? components
      : index === 1 ? components.filter(c => !c.types.includes('postal_code'))
      : components.map(c => c.types.includes('country') ? { ...c, short_name: 'CA' } : c) } });
  } });
  const res = await r.handler(request({ query: '619 Main' }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).suggestions.length, 1);
  assert.equal(r.calls.length, 6);
});

await test('detail provider failure cannot return falsely verified address fields', async () => {
  const r = runtime({ fetcher: url => url.pathname.includes('autocomplete') ? provider(url)
    : Response.json({ status: 'REQUEST_DENIED' }) });
  assert.equal((await r.handler(request({ query: '619 Main' }))).status, 503);
});

await test('per-client and worker-wide request windows limit provider fanout and expire', async () => {
  const r = runtime({ fetcher: () => Response.json({ status: 'ZERO_RESULTS' }) });
  for (let n = 0; n < 30; n++) assert.equal((await r.handler(request({ query: '619 Main' }, { 'cf-connecting-ip': '192.0.2.1' }))).status, 200);
  const limited = await r.handler(request({ query: '619 Main' }, { 'cf-connecting-ip': '192.0.2.1' }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.equal(r.calls.length, 30);
  for (let n = 30; n < 120; n++) assert.equal((await r.handler(request({ query: '619 Main' }))).status, 200);
  assert.equal((await r.handler(request({ query: '619 Main' }))).status, 429);
  assert.equal(r.calls.length, 120);
  r.advance(60001);
  assert.equal((await r.handler(request({ query: '619 Main' }, { 'cf-connecting-ip': '192.0.2.1' }))).status, 200);
});

await test('concurrent lookups bounded and capacity released after failures', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const r = runtime({ fetcher: async () => { await waiting; throw new Error('synthetic-failure'); } });
  const pending = Array.from({ length: 4 }, () => r.handler(request({ query: '619 Main' })));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await r.handler(request({ query: '619 Main' }))).status, 429);
  assert.equal(r.calls.length, 4);
  release();
  for (const res of await Promise.all(pending)) assert.equal(res.status, 503);
  assert.equal((await r.handler(request({ query: '619 Main' }))).status, 503);
  assert.equal(r.calls.length, 5);
});

await test('provider deadline aborts and releases lookup capacity', async () => {
  const r = runtime({ timeout: true, fetcher: (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const keepAlive = setTimeout(() => {}, 1000);
  try { assert.equal((await r.handler(request({ query: '619 Main' }))).status, 503); }
  finally { clearTimeout(keepAlive); }
});

await test('real gateway routes anonymous lookup but private customer actions still reject guests', async () => {
  const r = runtime();
  r.context.handler0 = r.handler;
  const privateNames = ['getCustomerAccountDashboardData', 'getCustomerNotifications', 'getCustomerOrderDetail', 'completeAccountSetup', 'claimReward'];
  const privateHandlers = {};
  for (const name of privateNames) privateHandlers[name] = r.load(read('base44/functions/getCustomerAccountDashboardData/handlers/' + name + '/entry.ts'));
  const imports = [...gatewaySource.matchAll(/^import (\w+) from '\.\/handlers\/([^/]+)\/entry\.ts';/gm)];
  for (const [, variable, name] of imports) r.context[variable] = name === 'addressSuggest' ? r.handler
    : privateHandlers[name] || (() => { throw new Error('Unexpected private route ' + name); });
  vm.runInContext(transformSync(gatewaySource.replace(/^import .*;\n/gm, ''), { loader: 'ts', target: 'es2022' }).code, r.context);
  const gateway = r.context.__handler;
  const guest = await gateway(request({ gateway_action: 'addressSuggest', payload: { query: '619 Main' } }));
  assert.equal(guest.status, 200);
  assert.equal((await guest.json()).suggestions.length, 1);
  for (const gateway_action of privateNames) {
    const res = await gateway(request({ gateway_action, payload: {} }));
    assert.equal(res.status, 401, gateway_action + ' must retain anonymous rejection');
  }
  assert.equal((await gateway(request({}))).status, 401, 'default dashboard stays private');
  assert.equal(r.calls.length, 2, 'private calls never reach Google');
});

console.log(JSON.stringify({ ok: true, suite: 'g174-guest-address-lookup', cases,
  actual_handler_executed: true, actual_gateway_executed: true,
  provider_boundary: 'synthetic fetch only', production_writes: false, provider_calls: false }, null, 2));
