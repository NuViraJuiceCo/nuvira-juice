#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { APP_ID, createMemberPreviewHandler, memberReadBody, MEMBER_CSP, ownedEntityQuery, UPSTREAM_ORIGIN } from '../qa/serve-member-preview.mjs';

const gateway = 'getCustomerAccountDashboardData';
const api = `/api/apps/${APP_ID}`;
const calls = [];
const checks = [];
const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'nuvira-member-preview-test-'));
let upstreamMode = 'json';
let port;
const fakeFetch = async (url, init) => {
  calls.push({ url, init });
  assert.equal(new URL(url).origin, UPSTREAM_ORIGIN);
  assert.equal(init.redirect, 'manual');
  assert.equal(init.headers.Cookie, undefined);
  assert.equal(init.headers['on-behalf-of'], undefined);
  assert.equal(init.headers['Base44-Functions-Version'], undefined);
  if (upstreamMode === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://unexpected.invalid' } });
  if (upstreamMode === 'html') return new Response('<html>Unexpected</html>', { headers: { 'Content-Type': 'text/html' } });
  if (url.endsWith('/User/me')) return Response.json({ email: 'member@example.invalid' });
  if (url.includes('/functions/')) return Response.json({ resolved_identity_emails: ['member@example.invalid', 'alias@example.invalid'] });
  if (url.endsWith('/auth/login')) return Response.json({ access_token: 'synthetic-token', user: { email: 'member@example.invalid' } });
  return Response.json([]);
};
const server = http.createServer();
try {
  await fs.mkdir(path.join(folder, 'assets'));
  await fs.writeFile(path.join(folder, 'index.html'), '<html><head><script type="module" src="/assets/app.js"></script></head><body><div id="root"></div></body></html>');
  await fs.writeFile(path.join(folder, 'assets', 'app.js'), '/* synthetic test asset */');
  await fs.symlink('/etc/hosts', path.join(folder, 'outside.txt'));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  server.on('request', await createMemberPreviewHandler({ dist: folder, port, fetchImpl: fakeFetch }));
  const origin = `http://127.0.0.1:${port}`;
  const request = async (route, { method = 'GET', body, headers = {} } = {}) => {
    const response = await fetch(`${origin}${route}`, {
      method, headers: { Origin: origin, Authorization: 'Bearer synthetic-token', 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, text: await response.text() };
  };
  const blockedWithoutUpstream = async (route, options) => {
    const before = calls.length;
    const response = await request(route, options);
    assert.ok([400, 401, 403, 413].includes(response.status), `${route}: ${response.status}`);
    assert.equal(calls.length, before, 'Denied request must never reach production');
  };

  const page = await request('/account');
  assert.equal(page.status, 200);
  assert.match(page.text, /data-member-preview="true"/);
  assert.doesNotMatch(page.text, /data-desktop-preview-badge/);
  assert.equal(page.headers.get('content-security-policy'), MEMBER_CSP);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
  assert.equal((await request('/account?access_token=synthetic-callback')).status, 200);
  assert.equal((await request('/assets/app.js')).status, 200);
  assert.equal((await request('/missing.js')).status, 404);
  await blockedWithoutUpstream('/outside.txt');
  await blockedWithoutUpstream('/%2e%2e%2fetc/passwd');
  for (const param of ['app_id', 'app_base_url', 'functions_version']) await blockedWithoutUpstream(`/account?${param}=other`);
  const wrongHostStatus = await new Promise((resolve, reject) => {
    http.get(`${origin}/account`, { headers: { Host: 'untrusted.invalid' } }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    }).on('error', reject);
  });
  assert.equal(wrongHostStatus, 403);
  checks.push('Loopback host, file containment, completed build, no-store, CSP, no-referrer and isolated member badge enforced');

  assert.equal((await request(`${api}/entities/Product`)).status, 200);
  assert.equal(calls.length, 0);
  await blockedWithoutUpstream(`${api}/entities/User/me`, { headers: { Authorization: '' } });
  assert.equal((await request(`${api}/entities/User/me`)).status, 200);
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer synthetic-token');
  checks.push('Anonymous catalog remains local; current-user read requires browser bearer token, not server credentials');

  for (const route of [`${api}/functions/${gateway}`, `/api/functions/${gateway}`]) {
    for (const body of [{}, { gateway_action: gateway, payload: {} },
      { gateway_action: 'getCustomerNotifications', payload: { action: 'list' } },
      { gateway_action: 'manageProgramJourney', payload: { action: 'list' } },
      { gateway_action: 'manageProgramJourney', payload: { action: 'get', journey_id: 'synthetic' } },
      { gateway_action: 'getCustomerOrderDetail', payload: { order_id: 'synthetic', source: 'order_history' } }]) {
      assert.equal((await request(route, { method: 'POST', body })).status, 200);
      assert.equal(calls.at(-1).url, `${UPSTREAM_ORIGIN}${api}/functions/${gateway}`);
      assert.deepEqual(JSON.parse(calls.at(-1).init.body), memberReadBody(body));
    }
  }
  checks.push('Both installed SDK transports map only audited dashboard, notification-list, program-list/detail and owned-order reads');

  for (const action of ['claimReward', 'syncUserToHub', 'completeAccountSetup', 'requestAccountDeletion', 'registerPushSubscription',
    'unregisterPushSubscription', 'stripeCustomerPortal', 'createSubscriptionPaymentElementIntent', 'pauseSubscription', 'submitCustomerInquiry',
    'validateDeliveryEligibility', 'trackMetaFunnelEvent', '__proto__']) {
    await blockedWithoutUpstream(`${api}/functions/${gateway}`, { method: 'POST', body: { gateway_action: action, payload: {} } });
  }
  for (const body of [null, [], { arbitrary: true }, { gateway_action: gateway, payload: {}, extra: true },
    { gateway_action: gateway, payload: { action: 'delete' } },
    { gateway_action: 'getCustomerNotifications', payload: { action: 'list', mark_read_id: 'synthetic' } },
    { gateway_action: 'getCustomerNotifications', payload: { action: 'dismiss' } },
    { gateway_action: 'manageProgramJourney', payload: { action: 'start', journey_id: 'synthetic' } },
    { gateway_action: 'manageProgramJourney', payload: { action: 'get', journey_id: 'synthetic', command_id: 'sneaky' } },
    { gateway_action: 'getCustomerOrderDetail', payload: { order_id: 'synthetic', gateway_action: 'claimReward' } }]) {
    await blockedWithoutUpstream(`${api}/functions/${gateway}`, { method: 'POST', body });
  }
  for (const method of ['PUT', 'PATCH', 'DELETE', 'POST']) {
    await blockedWithoutUpstream(`${api}/entities/User/me`, { method, body: {} });
    await blockedWithoutUpstream(`${api}/entities/UserProfile`, { method, body: {} });
  }
  for (const route of [`${api}/functions/getAdminOperationsDashboardSummary`, `${api}/functions/createPaymentIntent`,
    `${api}/integrations/Core/UploadFile`, `${api}/auth/register`, `${api}/auth/reset-password`,
    '/api/functions/claimReward', `/api/apps/other/functions/${gateway}`]) {
    await blockedWithoutUpstream(route, { method: 'POST', body: {} });
  }
  for (const headers of [{ Origin: 'https://outside.invalid' }, { Origin: '' }, { 'Sec-Fetch-Site': 'cross-site' },
    { 'Content-Type': 'text/plain' }, { 'X-App-Id': 'other' }]) {
    await blockedWithoutUpstream(`${api}/functions/${gateway}`, { method: 'POST', body: {}, headers });
  }
  await blockedWithoutUpstream(`${api}/functions/${gateway}?functions_version=old`, { method: 'POST', body: {} });
  await blockedWithoutUpstream(`${api}/functions/${gateway}`, { method: 'POST', body: 'not json' });
  await blockedWithoutUpstream(`${api}/functions/${gateway}`, { method: 'POST', body: 'x'.repeat(33 * 1024) });
  checks.push('Writes, action overrides, admin, payment, uploads, analytics, registration, malformed/oversized and cross-origin requests never reach upstream');

  for (const entity of ['UserProfile', 'BagReturn', 'NotificationPreference']) {
    const q = email => `?q=${encodeURIComponent(JSON.stringify({ customer_email: email }))}&sort=-created_date&limit=50`;
    assert.equal((await request(`${api}/entities/${entity}${q('member@example.invalid')}`)).status, 200);
    assert.equal((await request(`${api}/entities/${entity}${q('alias@example.invalid')}`)).status, 200);
    const before = calls.length;
    assert.equal((await request(`${api}/entities/${entity}${q('other@example.invalid')}`)).status, 403);
    assert.equal(calls.length, before + 2, 'Only me and own dashboard may be read to verify an alias');
    await blockedWithoutUpstream(`${api}/entities/${entity}`);
    await blockedWithoutUpstream(`${api}/entities/${entity}?q=${encodeURIComponent('{"customer_email":{"$ne":""}}')}`);
    assert.equal(ownedEntityQuery(entity, new URLSearchParams('q={}&q={}')), null);
  }
  checks.push('Entity reads are limited to the signed-in member and server-confirmed identity aliases, including admin logins');

  assert.equal((await request(`${api}/auth/login`, { method: 'POST', body: { email: 'member@example.invalid', password: 'synthetic-password' } })).status, 200);
  assert.equal(calls.at(-1).init.headers.Authorization, undefined);
  await blockedWithoutUpstream(`${api}/auth/login`, { method: 'POST', body: { email: 'member@example.invalid', password: 'x', role: 'admin' } });
  for (const mode of ['redirect', 'html']) {
    upstreamMode = mode;
    assert.equal((await request(`${api}/entities/User/me`)).status, 502);
  }
  checks.push('Only existing-account password sign-in is forwarded; redirects and non-JSON upstream responses fail closed');
  console.log(JSON.stringify({ ok: true, checks, real_network_requests: 0, production_writes: 0 }, null, 2));
} finally {
  await new Promise(resolve => server.close(resolve));
  await fs.rm(folder, { recursive: true, force: true });
}
