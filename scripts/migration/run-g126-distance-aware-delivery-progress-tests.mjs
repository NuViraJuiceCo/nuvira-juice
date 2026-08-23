#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { timingSafeEqual, webcrypto } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const handlerSource = read('base44/functions/getAdminOperationsDashboardSummary/handlers/manageDriverRouteTelemetry/entry.ts');
const gatewaySource = read('base44/functions/getAdminOperationsDashboardSummary/entry.ts');
const entitySource = read('base44/entities/DeliveryRouteTelemetry.jsonc');
const customerSnapshotSource = read('base44/functions/getCustomerAccountDashboardData/handlers/getDeliveryEta/deliverySnapshot.ts');
const pushSnapshotSource = read('base44/functions/sendCustomerPushNotification/deliverySnapshot.ts');
const webBridgeSource = read('src/lib/driverRouteTelemetry.js');
const deliveryQueueSource = read('src/pages/admin/DeliveryQueue.jsx');
const iosPluginSource = read('ios/App/App/NativeDeliveryLiveActivityPlugin.swift');
const iosInfoSource = read('ios/App/App/Info.plist');
const androidPluginSource = read('android/app/src/main/java/com/nuvirajuice/app/DeliveryLiveActivityPlugin.java');
const androidServiceSource = read('android/app/src/main/java/com/nuvirajuice/app/DriverRouteTrackingService.java');
const androidManifestSource = read('android/app/src/main/AndroidManifest.xml');

function fixture({ role = 'admin', email = 'operator@example.test' } = {}) {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const rows = [];
  const tasks = [
    {
      id: 'task-next', order_id: 'order-next', order_number: 'NV-NEXT', status: 'out_for_delivery',
      route_id: 'route-test', route_stop_sequence: 1, delivery_date: date, assigned_driver_email: email,
      delivery_address: '10 Synthetic Way, Wentzville, MO 63385',
    },
    {
      id: 'task-anchor', order_id: 'order-anchor', order_number: 'NV-ANCHOR', status: 'out_for_delivery',
      route_id: 'route-test', route_stop_sequence: 2, delivery_date: date, assigned_driver_email: email,
      delivery_address: '20 Synthetic Way, Wentzville, MO 63385',
    },
  ];
  const orders = [
    { id: 'order-next', order_number: 'NV-NEXT', status: 'out_for_delivery', fulfillment_type: 'delivery', delivery_address: tasks[0].delivery_address },
    { id: 'order-anchor', order_number: 'NV-ANCHOR', status: 'out_for_delivery', fulfillment_type: 'delivery', delivery_address: tasks[1].delivery_address },
  ];
  const updates = [];
  const refreshes = [];
  const telemetry = {
    list: async () => rows,
    filter: async query => rows.filter(row => Object.entries(query).every(([key, value]) => row[key] === value)),
    create: async payload => {
      const row = { id: `telemetry-${rows.length + 1}`, ...structuredClone(payload) };
      rows.push(row);
      return structuredClone(row);
    },
    update: async (id, payload) => {
      const row = rows.find(candidate => candidate.id === id);
      if (!row) throw new Error('row_not_found');
      Object.assign(row, structuredClone(payload));
      updates.push({ id, payload: structuredClone(payload) });
      return structuredClone(row);
    },
  };
  const base44 = {
    auth: { me: async () => role ? ({ id: 'operator-id', email, full_name: 'Synthetic Operator', role }) : null },
    asServiceRole: {
      entities: {
        DeliveryRouteTelemetry: telemetry,
        FulfillmentTask: { list: async () => structuredClone(tasks) },
        Order: { list: async () => structuredClone(orders) },
      },
      functions: {
        invoke: async (name, payload) => {
          refreshes.push({ name, payload: structuredClone(payload) });
          return { success: true };
        },
      },
    },
  };
  return { base44, rows, tasks, orders, updates, refreshes };
}

async function loadHandler(base44, { routeResponses = [], env = {} } = {}) {
  const executable = handlerSource
    .replace(/^import .*?;\s*$/gm, '')
    .replace('export default async function handler', 'globalThis.__handler = async function handler');
  const compiled = await transform(executable, { loader: 'ts', format: 'iife', target: 'es2022' });
  let fetchCount = 0;
  const fetchMock = async (url, init) => {
    assert.equal(url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
    assert.equal(init.method, 'POST');
    const body = JSON.parse(init.body);
    assert.equal(body.routingPreference, 'TRAFFIC_AWARE');
    assert.equal(body.origin.location.latLng.latitude, 38.81234567);
    assert.equal(body.origin.location.latLng.longitude, -90.81234567);
    const response = routeResponses[Math.min(fetchCount, routeResponses.length - 1)];
    fetchCount += 1;
    if (response instanceof Error) throw response;
    return new Response(JSON.stringify(response || {}), { status: response ? 200 : 503, headers: { 'Content-Type': 'application/json' } });
  };
  const context = vm.createContext({
    console: { warn: () => {} }, Request, Response, Headers, URL, Date, Intl, Map, Set, JSON, Math, Number, String,
    Array, Object, RegExp, encodeURIComponent, TextEncoder, Uint8Array, Buffer, crypto: webcrypto, timingSafeEqual,
    fetch: fetchMock,
    Deno: { env: { get: name => env[name] || '' } },
    createClientFromRequest: () => base44,
    structuredClone,
    btoa,
  });
  vm.runInContext(compiled.code, context);
  return { handler: context.__handler, fetchCount: () => fetchCount };
}

async function call(handler, body, token = '') {
  const response = await handler(new Request('https://nuvirajuice.com/functions/getAdminOperationsDashboardSummary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Route-Session-Token': token } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: response.status, data: await response.json() };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('gateway uses an existing deployed function name and routes the nested action', () => {
  assert.match(gatewaySource, /manageDriverRouteTelemetry/);
  assert.match(gatewaySource, /g126-distance-aware-driver-route-telemetry/);
  assert.doesNotMatch(gatewaySource, /Deno\.serve[\s\S]*manageDriverRouteTelemetry[\s\S]*Deno\.serve/);
});

test('telemetry entity cannot persist precise coordinates, addresses, or raw tokens', () => {
  const schema = JSON.parse(entitySource);
  const properties = Object.keys(schema.properties);
  for (const forbidden of ['latitude', 'longitude', 'coordinates', 'address', 'session_token']) {
    assert.equal(properties.includes(forbidden), false, forbidden);
  }
  assert.ok(properties.includes('token_hash'));
  assert.match(schema.properties.snapshots.description, /coordinates and addresses are prohibited/i);
  assert.equal(schema.rls.delete, false);
});

test('only authenticated operational roles can start a route', async () => {
  for (const role of ['', 'user']) {
    const state = fixture({ role });
    const { handler } = await loadHandler(state.base44);
    const result = await call(handler, { action: 'start', fulfillment_task_id: 'task-anchor' });
    assert.equal(result.status, role ? 403 : 401);
    assert.equal(state.rows.length, 0);
  }
});

test('start requires an active assigned route and stores only the token hash', async () => {
  const state = fixture();
  const { handler } = await loadHandler(state.base44);
  const result = await call(handler, { action: 'start', fulfillment_task_id: 'task-anchor', ordered_task_ids: ['task-next', 'task-anchor'] });
  assert.equal(result.status, 200);
  assert.equal(result.data.success, true);
  assert.match(result.data.session_token, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal(state.rows.length, 1);
  assert.match(state.rows[0].token_hash, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(state.rows[0]).includes(result.data.session_token), false);
  assert.deepEqual(Array.from(state.rows[0].task_ids), ['task-next', 'task-anchor']);
});

test('ingest fails closed for missing, wrong, short, and long route tokens', async () => {
  const state = fixture();
  const { handler } = await loadHandler(state.base44, { env: { GOOGLE_MAPS_API_KEY: 'synthetic' } });
  const started = await call(handler, { action: 'start', fulfillment_task_id: 'task-anchor' });
  const sample = { action: 'ingest', session_id: started.data.session_id, sequence: 1, latitude: 38.81234567, longitude: -90.81234567, accuracy_meters: 20, captured_at: new Date().toISOString() };
  for (const token of ['', 'wrong', 'x'.repeat(400)]) {
    const result = await call(handler, sample, token);
    assert.equal(result.status, 401);
  }
  assert.equal(state.rows[0].last_sequence, 0);
});

test('location ingest derives traffic-aware ETA and monotonic distance progress without persisting coordinates', async () => {
  const state = fixture();
  const routeResponses = [
    { routes: [{ legs: [{ distanceMeters: 1000, duration: '600s' }, { distanceMeters: 1500, duration: '900s' }] }] },
    { routes: [{ legs: [{ distanceMeters: 400, duration: '240s' }, { distanceMeters: 700, duration: '420s' }] }] },
  ];
  const { handler, fetchCount } = await loadHandler(state.base44, { routeResponses, env: { GOOGLE_MAPS_API_KEY: 'synthetic' } });
  const started = await call(handler, { action: 'start', fulfillment_task_id: 'task-anchor', ordered_task_ids: ['task-next', 'task-anchor'] });
  const base = { action: 'ingest', session_id: started.data.session_id, latitude: 38.81234567, longitude: -90.81234567, accuracy_meters: 20 };
  const first = await call(handler, { ...base, sequence: 1, captured_at: new Date().toISOString() }, started.data.session_token);
  assert.equal(first.status, 200);
  assert.equal(first.data.progress_updated, true);
  const firstProgress = state.rows[0].snapshots.map(snapshot => snapshot.progress_percent);
  const second = await call(handler, { ...base, sequence: 2, captured_at: new Date().toISOString() }, started.data.session_token);
  assert.equal(second.status, 200);
  assert.equal(fetchCount(), 2);
  state.rows[0].snapshots.forEach((snapshot, index) => assert.ok(snapshot.progress_percent >= firstProgress[index]));
  const persisted = JSON.stringify(state.rows[0]);
  for (const forbidden of ['38.81234567', '-90.81234567', 'latitude', 'longitude', 'Synthetic Way']) {
    assert.equal(persisted.includes(forbidden), false, forbidden);
  }
  assert.equal(state.rows[0].last_provider_status, 'ok');
  assert.equal(state.rows[0].snapshots[0].progress_source, 'distance_eta');
});

test('duplicate samples are idempotent and do not call routing or notifications twice', async () => {
  const state = fixture();
  const route = { routes: [{ legs: [{ distanceMeters: 1000, duration: '600s' }, { distanceMeters: 1500, duration: '900s' }] }] };
  const { handler, fetchCount } = await loadHandler(state.base44, { routeResponses: [route], env: { GOOGLE_MAPS_API_KEY: 'synthetic' } });
  const started = await call(handler, { action: 'start', fulfillment_task_id: 'task-anchor' });
  const sample = { action: 'ingest', session_id: started.data.session_id, sequence: 1, latitude: 38.81234567, longitude: -90.81234567, accuracy_meters: 20, captured_at: new Date().toISOString() };
  await call(handler, sample, started.data.session_token);
  const refreshCount = state.refreshes.length;
  const replay = await call(handler, sample, started.data.session_token);
  assert.equal(replay.data.skipped, true);
  assert.equal(replay.data.reason, 'duplicate_or_out_of_order_sample');
  assert.equal(fetchCount(), 1);
  assert.equal(state.refreshes.length, refreshCount);
});

test('invalid accuracy and stale samples fail safely without provider access', async () => {
  const state = fixture();
  const { handler, fetchCount } = await loadHandler(state.base44, { env: { GOOGLE_MAPS_API_KEY: 'synthetic' } });
  const started = await call(handler, { action: 'start', fulfillment_task_id: 'task-anchor' });
  const poor = await call(handler, { action: 'ingest', session_id: started.data.session_id, sequence: 1, latitude: 38.81234567, longitude: -90.81234567, accuracy_meters: 500, captured_at: new Date().toISOString() }, started.data.session_token);
  assert.equal(poor.data.reason, 'location_accuracy_insufficient');
  const stale = await call(handler, { action: 'ingest', session_id: started.data.session_id, sequence: 2, latitude: 38.81234567, longitude: -90.81234567, accuracy_meters: 20, captured_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }, started.data.session_token);
  assert.equal(stale.status, 400);
  assert.equal(fetchCount(), 0);
});

test('provider failure retains the route session without fabricating distance progress', async () => {
  const state = fixture();
  const { handler } = await loadHandler(state.base44, { routeResponses: [new Error('synthetic outage')], env: { GOOGLE_MAPS_API_KEY: 'synthetic' } });
  const started = await call(handler, { action: 'start', fulfillment_task_id: 'task-anchor' });
  const result = await call(handler, { action: 'ingest', session_id: started.data.session_id, sequence: 1, latitude: 38.81234567, longitude: -90.81234567, accuracy_meters: 20, captured_at: new Date().toISOString() }, started.data.session_token);
  assert.equal(result.status, 200);
  assert.equal(result.data.progress_updated, false);
  assert.equal(state.rows[0].state, 'active');
  assert.equal(state.rows[0].last_provider_status, 'unavailable');
  assert.deepEqual(Array.from(state.rows[0].snapshots), []);
});

test('stop is authorized, audited, repeatable, and removes the active state', async () => {
  const state = fixture();
  const { handler } = await loadHandler(state.base44);
  const started = await call(handler, { action: 'start', fulfillment_task_id: 'task-anchor' });
  const stopped = await call(handler, { action: 'stop', session_id: started.data.session_id, reason: 'operator_stopped' });
  assert.equal(stopped.data.state, 'stopped');
  const replay = await call(handler, { action: 'stop', session_id: started.data.session_id, reason: 'operator_stopped' });
  assert.equal(replay.data.skipped, true);
  assert.equal(state.rows[0].audit_events.at(-1).event, 'stopped');
});

test('customer and push snapshot builders consume only fresh privacy-safe distance snapshots', () => {
  assert.equal(customerSnapshotSource, pushSnapshotSource);
  assert.match(customerSnapshotSource, /progress_source: 'distance_eta'/);
  assert.match(customerSnapshotSource, /3 \* 60 \* 1000/);
  assert.match(customerSnapshotSource, /Precise driver location is not shared/);
  assert.doesNotMatch(customerSnapshotSource, /snapshot\.(latitude|longitude|address)/);
});

test('web bridge keeps route tokens memory-only and fails closed on an unexpected start failure', () => {
  assert.match(webBridgeSource, /DeliveryLiveActivity\.startRouteTracking/);
  assert.match(webBridgeSource, /X-Route-Session-Token/);
  assert.match(webBridgeSource, /device_tracking_start_failed/);
  assert.doesNotMatch(webBridgeSource, /localStorage\.setItem\([^\n]*(sessionToken|session_token|token)/);
  assert.match(deliveryQueueSource, /Start Live Route Tracking/);
  assert.match(deliveryQueueSource, /Precise driver location is never shown or stored/);
});

test('iOS route tracking is explicit, background-capable, host-restricted, and nonpersistent', () => {
  assert.match(iosPluginSource, /startRouteTracking/);
  assert.match(iosPluginSource, /allowsBackgroundLocationUpdates = true/);
  assert.match(iosPluginSource, /distanceFilter/);
  assert.match(iosPluginSource, /X-Route-Session-Token/);
  assert.match(iosPluginSource, /X-App-Id/);
  assert.match(iosPluginSource, /URLSessionConfiguration\.ephemeral/);
  assert.match(iosInfoSource, /NSLocationWhenInUseUsageDescription/);
  assert.match(iosInfoSource, /<string>location<\/string>/);
  assert.doesNotMatch(iosPluginSource, /UserDefaults[\s\S]{0,160}(sessionToken|session_token)/);
});

test('Android route tracking uses a location foreground service with explicit permission and no token persistence', () => {
  assert.match(androidPluginSource, /routeLocation/);
  assert.match(androidServiceSource, /START_NOT_STICKY/);
  assert.match(androidServiceSource, /startForeground/);
  assert.match(androidServiceSource, /X-Route-Session-Token/);
  assert.match(androidServiceSource, /X-App-Id/);
  assert.match(androidServiceSource, /validEndpoint/);
  assert.match(androidManifestSource, /FOREGROUND_SERVICE_LOCATION/);
  assert.match(androidManifestSource, /foregroundServiceType="location"/);
  assert.doesNotMatch(androidServiceSource, /SharedPreferences|FileOutputStream|SQLite/);
});

let passed = 0;
for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

console.log(`\nG126 distance-aware delivery progress: ${passed}/${tests.length} passed`);
