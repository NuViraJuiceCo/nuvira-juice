#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createClient } from '@base44/sdk';

const source = fs.readFileSync('src/api/base44Client.js', 'utf8')
  .replace(/^import .*;\n/gm, '')
  .replace(/export const /g, 'const ');
const originalWindow = globalThis.window;
const originalFetch = globalThis.fetch;
const checks = [];

try {
  for (const native of [true, false]) {
    const values = new Map([['base44_access_token', 'synthetic-startup-token']]);
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    };
    globalThis.window = {
      localStorage: storage,
      location: { search: '', href: 'https://nuvira.invalid/account', hostname: 'nuvira.invalid' },
    };
    const requests = [];
    let responseStatus = 200;
    globalThis.fetch = async (url, init) => {
      requests.push({ url, headers: new Headers(init.headers), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(responseStatus === 200 ? { ok: true } : { error: 'Unauthorized' }), {
        status: responseStatus,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const { base44 } = vm.runInNewContext(`${source}\n({ base44 });`, {
      createClient: config => createClient({ ...config, analytics: { enabled: false } }),
      appParams: { appId: 'synthetic-app', token: 'synthetic-startup-token', appBaseUrl: 'https://nuvira.invalid' },
      Capacitor: { isNativePlatform: () => native },
    });
    const actions = [
      'getAdminProductionQueueSummary',
      'getAdminDeliveryRouteSummary',
      'getAdminInventoryStatusSummary',
      'getAdminProductionPlanningSummary',
      'manageProgramJourney',
    ];
    await base44.functions.invoke(actions[0], { read_only: true });
    assert.equal(requests.at(-1).headers.get('Authorization'), 'Bearer synthetic-startup-token');

    for (const token of ['synthetic-google-token', 'synthetic-apple-token', 'synthetic-second-google-token']) {
      base44.auth.setToken(token);
      for (const action of actions) {
        await base44.functions.invoke(action, { read_only: true });
        const request = requests.at(-1);
        assert.equal(request.headers.get('Authorization'), `Bearer ${token}`, `${action} must use the current session`);
        assert.equal(request.headers.get('X-App-Id'), 'synthetic-app');
        assert.equal(request.body.gateway_action, action);
        assert.deepEqual(request.body.payload, { read_only: true });
        assert.equal(request.url, `${native ? 'https://nuvira.invalid' : ''}/api/functions/${
          action === 'manageProgramJourney' ? 'getCustomerAccountDashboardData' : 'getAdminOperationsDashboardSummary'
        }`);
      }
    }
    checks.push(`${native ? 'native' : 'web'}: all gateways follow three session rotations`);

    storage.removeItem('base44_access_token');
    storage.removeItem('token');
    await base44.functions.invoke('manageProgramJourney', { action: 'list' });
    assert.equal(requests.at(-1).headers.has('Authorization'), false, 'Signed-out requests must not resurrect the startup token');
    checks.push(`${native ? 'native' : 'web'}: signed-out gateway has no old bearer token`);

    base44.auth.setToken('synthetic-current-token');
    responseStatus = 403;
    const before = requests.length;
    await assert.rejects(
      base44.functions.invoke('getAdminProductionQueueSummary', { read_only: true }),
      error => error.status === 403 && error.message === 'Unauthorized',
    );
    assert.equal(requests.length, before + 1, 'No retry or permission bypass is allowed');
    checks.push(`${native ? 'native' : 'web'}: backend authorization errors remain enforced`);
  }
  console.log(JSON.stringify({ ok: true, suite: 'g181-session-gateway-auth', checks, real_network_requests: 0, provider_calls: false }, null, 2));
} finally {
  globalThis.fetch = originalFetch;
  if (originalWindow === undefined) delete globalThis.window;
  else globalThis.window = originalWindow;
}
