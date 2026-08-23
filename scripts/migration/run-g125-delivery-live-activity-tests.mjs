#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transform } from 'esbuild';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const routeHelperPath = 'base44/functions/getCustomerAccountDashboardData/handlers/getDeliveryEta/deliverySnapshot.ts';
const pushRouteHelperPath = 'base44/functions/sendCustomerPushNotification/deliverySnapshot.ts';
const routeHelper = read(routeHelperPath);
const pushRouteHelper = read(pushRouteHelperPath);
const etaHandler = read('base44/functions/getCustomerAccountDashboardData/handlers/getDeliveryEta/entry.ts');
const manageHandler = read('base44/functions/getCustomerAccountDashboardData/handlers/manageDeliveryLiveActivity/entry.ts');
const customerGateway = read('base44/functions/getCustomerAccountDashboardData/entry.ts');
const base44Client = read('src/api/base44Client.js');
const pushHandler = read('base44/functions/sendCustomerPushNotification/entry.ts');
const statusHandler = read('base44/functions/sendOrderStatusNotification/entry.ts');
const entity = JSON.parse(read('base44/entities/DeliveryLiveActivity.jsonc'));
const webBridge = read('src/lib/deliveryLiveActivity.js');
const app = read('src/App.jsx');
const tracker = read('src/pages/OrderTracker.jsx');
const iosPlugin = read('ios/App/App/NativeDeliveryLiveActivityPlugin.swift');
const iosAppDelegate = read('ios/App/App/AppDelegate.swift');
const iosAttributes = read('ios/App/Shared/NuViraDeliveryAttributes.swift');
const iosWidget = read('ios/App/NuViraDeliveryActivity/NuViraDeliveryActivityWidget.swift');
const iosInfo = read('ios/App/App/Info.plist');
const iosExtensionInfo = read('ios/App/NuViraDeliveryActivity/Info.plist');
const iosExtensionAssets = read('ios/App/NuViraDeliveryActivity/Assets.xcassets/NuViraDeliveryLogo.imageset/Contents.json');
const iosCompactExtensionAssets = read('ios/App/NuViraDeliveryActivity/Assets.xcassets/NuViraDeliveryCompactLogo.imageset/Contents.json');
const iosAppLogoExtensionAssets = read('ios/App/NuViraDeliveryActivity/Assets.xcassets/NuViraDeliveryAppLogo.imageset/Contents.json');
const iosSmallAppLogoExtensionAssets = read('ios/App/NuViraDeliveryActivity/Assets.xcassets/NuViraDeliveryAppLogoSmall.imageset/Contents.json');
const iosProject = read('ios/App/App.xcodeproj/project.pbxproj');
const androidPlugin = read('android/app/src/main/java/com/nuvirajuice/app/DeliveryLiveActivityPlugin.java');
const androidMessaging = read('android/app/src/main/java/com/nuvirajuice/app/NuViraMessagingService.java');
const androidManifest = read('android/app/src/main/AndroidManifest.xml');

async function loadRouteBuilder(fetchImpl = async () => {
  throw new Error('Unexpected network request');
}) {
  const executable = routeHelper
    .replace('export async function buildDeliveryRouteSnapshots', 'async function buildDeliveryRouteSnapshots')
    .concat('\nglobalThis.__buildDeliveryRouteSnapshots = buildDeliveryRouteSnapshots;');
  const compiled = await transform(executable, { loader: 'ts', format: 'iife', target: 'es2022' });
  const context = vm.createContext({
    console,
    Date,
    Intl,
    Map,
    Set,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    encodeURIComponent,
    fetch: fetchImpl,
  });
  vm.runInContext(compiled.code, context);
  return context.__buildDeliveryRouteSnapshots;
}

function routeFixture() {
  const orders = [
    {
      id: 'order-delivered',
      order_number: 'NV-DELIVERED',
      customer_email: 'delivered@example.test',
      fulfillment_type: 'delivery',
      status: 'delivered',
      estimated_delivery_date: '2026-08-22',
      delivery_address: '10 Previous Stop, Wentzville, MO 63385',
      created_date: '2026-08-22T12:00:00.000Z',
    },
    {
      id: 'order-next',
      order_number: 'NV-NEXT',
      customer_email: 'next@example.test',
      fulfillment_type: 'delivery',
      status: 'out_for_delivery',
      estimated_delivery_date: '2026-08-22',
      delivery_address: '20 Next Stop, Wentzville, MO 63385',
      created_date: '2026-08-22T12:01:00.000Z',
    },
    {
      id: 'order-anchor',
      order_number: 'NV-ANCHOR',
      customer_email: 'owner@example.test',
      fulfillment_type: 'delivery',
      status: 'out_for_delivery',
      estimated_delivery_date: '2026-08-22',
      delivery_address: '30 Anchor Stop, Wentzville, MO 63385',
      created_date: '2026-08-22T12:02:00.000Z',
    },
    {
      id: 'order-other-route',
      order_number: 'NV-OTHER',
      customer_email: 'other@example.test',
      fulfillment_type: 'delivery',
      status: 'out_for_delivery',
      estimated_delivery_date: '2026-08-22',
      delivery_address: '40 Other Route, Wentzville, MO 63385',
      created_date: '2026-08-22T12:03:00.000Z',
    },
    {
      id: 'order-old',
      order_number: 'NV-OLD',
      customer_email: 'old@example.test',
      fulfillment_type: 'delivery',
      status: 'out_for_delivery',
      estimated_delivery_date: '2026-08-21',
      delivery_address: '50 Old Route, Wentzville, MO 63385',
      created_date: '2026-08-21T12:03:00.000Z',
    },
  ];
  const tasks = [
    { id: 'task-delivered', order_id: 'order-delivered', route_id: 'route-1', route_stop_sequence: 1, status: 'delivered', delivered_at: '2026-08-22T13:00:00.000Z' },
    { id: 'task-next', order_id: 'order-next', route_id: 'route-1', route_stop_sequence: 2, status: 'out_for_delivery' },
    { id: 'task-anchor', order_id: 'order-anchor', route_id: 'route-1', route_stop_sequence: 3, status: 'out_for_delivery' },
    { id: 'task-other', order_id: 'order-other-route', route_id: 'route-2', route_stop_sequence: 1, status: 'out_for_delivery' },
    { id: 'task-old', order_id: 'order-old', route_id: 'route-old', route_stop_sequence: 1, status: 'out_for_delivery' },
  ];
  return {
    orders,
    tasks,
    base44: {
      asServiceRole: {
        entities: {
          Order: { list: async () => orders },
          FulfillmentTask: { list: async () => tasks },
        },
      },
    },
  };
}

async function loadManageHandler(base44) {
  const executable = manageHandler
    .replace(/^import .*?;\s*/m, '')
    .replace('export default async function handler', 'globalThis.__handler = async function handler');
  const compiled = await transform(executable, { loader: 'ts', format: 'iife', target: 'es2022' });
  const context = vm.createContext({
    console,
    Request,
    Response,
    Headers,
    URL,
    Date,
    Set,
    JSON,
    Math,
    Number,
    String,
    Array,
    Object,
    RegExp,
    createClientFromRequest: () => base44,
  });
  vm.runInContext(compiled.code, context);
  return context.__handler;
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('the customer ETA and push functions use byte-identical route logic', () => {
  assert.equal(pushRouteHelper, routeHelper);
});

test('explicit route IDs isolate an active route and preserve stop order', async () => {
  const build = await loadRouteBuilder();
  const fixture = routeFixture();
  const result = await build({
    base44: fixture.base44,
    anchorOrderId: 'order-anchor',
    now: new Date('2026-08-22T14:00:00.000Z'),
  });
  assert.deepEqual(Array.from(result.route_orders, row => row.id), ['order-delivered', 'order-next', 'order-anchor']);
  assert.equal(result.anchor_snapshot.stops_ahead, 1);
  assert.equal(result.anchor_snapshot.stops_delivered, 1);
  assert.equal(result.anchor_snapshot.stops_total, 3);
  assert.equal(result.anchor_snapshot.status_label, 'Out for Delivery');
  assert.equal(result.anchor_snapshot.progress_percent, 33);
});

test('route snapshots disclose no customer address, email, or driver location', async () => {
  const build = await loadRouteBuilder();
  const fixture = routeFixture();
  const result = await build({ base44: fixture.base44, anchorOrderId: 'order-anchor', now: new Date('2026-08-22T14:00:00.000Z') });
  const serialized = JSON.stringify(result.anchor_snapshot);
  for (const forbidden of ['Anchor Stop', '@example.test', 'latitude', 'longitude', 'driver_location', 'delivery_address']) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(result.anchor_snapshot.privacy_label, 'Route progress only. Precise driver location is not shared.');
  assert.equal(result.anchor_snapshot.deep_link, '/order-tracker/NV-ANCHOR');
});

test('a Google Routes failure falls back to conservative timing without failing the route', async () => {
  let networkAttempts = 0;
  const build = await loadRouteBuilder(async () => {
    networkAttempts += 1;
    throw new Error('synthetic provider outage');
  });
  const fixture = routeFixture();
  const result = await build({
    base44: fixture.base44,
    anchorOrderId: 'order-anchor',
    googleMapsApiKey: 'synthetic-key',
    now: new Date('2026-08-22T14:00:00.000Z'),
  });
  assert.equal(networkAttempts, 1);
  assert.equal(result.anchor_snapshot.activity_state, 'en_route');
  assert.ok(result.anchor_snapshot.eta_end_epoch > result.anchor_snapshot.eta_start_epoch);
});

test('provider routing uses traffic-aware optimization without exposing the key in output', async () => {
  let request = null;
  const build = await loadRouteBuilder(async (url, init) => {
    request = { url, init };
    return new Response(JSON.stringify({ routes: [{ optimizedIntermediateWaypointIndex: [0, 1], legs: [{ duration: '300s' }, { duration: '600s' }] }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const fixture = routeFixture();
  const result = await build({
    base44: fixture.base44,
    anchorOrderId: 'order-anchor',
    googleMapsApiKey: 'synthetic-key',
    now: new Date('2026-08-22T14:00:00.000Z'),
  });
  assert.equal(request.url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
  assert.equal(request.init.headers['X-Goog-Api-Key'], 'synthetic-key');
  assert.equal(JSON.parse(request.init.body).routingPreference, 'TRAFFIC_AWARE');
  assert.equal(JSON.stringify(result.anchor_snapshot).includes('synthetic-key'), false);
});

test('customer ETA authorization is server-side and errors are redacted', () => {
  assert.match(etaHandler, /base44\.auth\.me\(\)/);
  assert.match(etaHandler, /requester === owner/);
  assert.match(etaHandler, /status: 401/);
  assert.match(etaHandler, /status: 403/);
  assert.match(etaHandler, /\[redacted email\]/);
  assert.match(etaHandler, /delivery_eta_unavailable/);
});

test('customer ownership is verified before route or provider work begins', () => {
  const ownershipRead = etaHandler.indexOf('const ownedOrderRows');
  const ownershipCheck = etaHandler.indexOf('authorizeOrderAccess(user, ownedOrder)');
  const routeBuild = etaHandler.indexOf('const result = await buildDeliveryRouteSnapshots');
  assert.ok(ownershipRead >= 0 && ownershipRead < ownershipCheck);
  assert.ok(ownershipCheck < routeBuild);
});

test('the live-activity registration handler is bundled through the existing customer gateway', () => {
  assert.match(customerGateway, /manageDeliveryLiveActivity/);
  assert.match(customerGateway, /g125-delivery-live-activity-20260822/);
  assert.match(base44Client, /manageDeliveryLiveActivity/);
});

test('unauthenticated live-activity registration is rejected', async () => {
  const handler = await loadManageHandler({ auth: { me: async () => null } });
  const response = await handler(new Request('https://example.test/functions/gateway', { method: 'POST', body: JSON.stringify({ action: 'status' }) }));
  assert.equal(response.status, 401);
});

test('an authenticated customer cannot register an activity for another customer order', async () => {
  const base44 = {
    auth: { me: async () => ({ email: 'owner@example.test', role: 'user' }) },
    asServiceRole: { entities: {
      Order: { filter: async () => [{ id: 'other-order', order_number: 'NV-OTHER', customer_email: 'other@example.test' }] },
      DeliveryLiveActivity: { filter: async () => [] },
    } },
  };
  const handler = await loadManageHandler(base44);
  const response = await handler(new Request('https://example.test/functions/gateway', {
    method: 'POST',
    body: JSON.stringify({ action: 'register_activity', platform: 'ios', installation_id: 'install-12345', order_id: 'other-order', activity_id: 'activity-1', activity_push_token: 'a'.repeat(64) }),
  }));
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'order_not_found' });
});

test('valid activity registration stores tokens but never returns them', async () => {
  const rows = [];
  const base44 = {
    auth: { me: async () => ({ email: 'owner@example.test', role: 'user' }) },
    asServiceRole: { entities: {
      Order: { filter: async () => [{ id: 'owned-order', order_number: 'NV-OWNED', customer_email: 'owner@example.test' }] },
      DeliveryLiveActivity: {
        filter: async () => [],
        create: async payload => {
          const row = { id: 'activity-row-1', ...payload };
          rows.push(row);
          return row;
        },
        update: async () => { throw new Error('Unexpected update'); },
      },
    } },
  };
  const handler = await loadManageHandler(base44);
  const token = 'b'.repeat(64);
  const response = await handler(new Request('https://example.test/functions/gateway', {
    method: 'POST',
    body: JSON.stringify({ action: 'register_activity', platform: 'ios', installation_id: 'install-12345', order_id: 'owned-order', activity_id: 'activity-1', activity_push_token: token, app_bundle_id: 'com.base69d48d0c39891f7945481152.app' }),
  }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.equal(rows[0].activity_push_token, token);
  assert.equal(JSON.stringify(body).includes(token), false);
  assert.equal(body.registration.remote_update_ready, true);
});

test('unapproved bundle IDs and malformed device tokens fail closed', async () => {
  const base44 = {
    auth: { me: async () => ({ email: 'owner@example.test', role: 'user' }) },
    asServiceRole: { entities: {
      Order: { filter: async () => [{ id: 'owned-order', order_number: 'NV-OWNED', customer_email: 'owner@example.test' }] },
      DeliveryLiveActivity: { filter: async () => [], create: async payload => payload },
    } },
  };
  const handler = await loadManageHandler(base44);
  const wrongBundle = await handler(new Request('https://example.test/functions/gateway', {
    method: 'POST',
    body: JSON.stringify({ action: 'register_capability', platform: 'ios', installation_id: 'install-12345', app_bundle_id: 'com.attacker.app' }),
  }));
  assert.equal(wrongBundle.status, 400);
  const badToken = await handler(new Request('https://example.test/functions/gateway', {
    method: 'POST',
    body: JSON.stringify({ action: 'register_activity', platform: 'ios', installation_id: 'install-12345', order_id: 'owned-order', activity_id: 'activity-1', activity_push_token: 'not-a-token' }),
  }));
  assert.equal(badToken.status, 400);
  const partiallyHexToken = await handler(new Request('https://example.test/functions/gateway', {
    method: 'POST',
    body: JSON.stringify({ action: 'register_activity', platform: 'ios', installation_id: 'install-12345', order_id: 'owned-order', activity_id: 'activity-1', activity_push_token: `${'a'.repeat(64)}!` }),
  }));
  assert.equal(partiallyHexToken.status, 400);
});

test('a late iOS update token for a delivered order requests a recoverable end refresh', async () => {
  const created = [];
  const invokes = [];
  const base44 = {
    auth: { me: async () => ({ email: 'owner@example.test', role: 'user' }) },
    asServiceRole: {
      entities: {
        Order: { filter: async () => [{ id: 'delivered-order', order_number: 'NV-DONE', customer_email: 'owner@example.test', status: 'delivered' }] },
        DeliveryLiveActivity: {
          filter: async () => [],
          create: async payload => {
            const row = { id: 'activity-row-late', ...payload };
            created.push(row);
            return row;
          },
        },
      },
      functions: {
        invoke: async (name, payload) => {
          invokes.push({ name, payload });
          return { data: { success: true } };
        },
      },
    },
  };
  const handler = await loadManageHandler(base44);
  const response = await handler(new Request('https://example.test/functions/gateway', {
    method: 'POST',
    body: JSON.stringify({
      action: 'register_activity',
      platform: 'ios',
      installation_id: 'install-12345',
      order_id: 'delivered-order',
      activity_id: 'activity-late',
      activity_push_token: 'c'.repeat(64),
    }),
  }));
  assert.equal(response.status, 200);
  assert.equal(created[0].state, 'active');
  assert.equal(JSON.stringify(invokes), JSON.stringify([{
    name: 'sendCustomerPushNotification',
    payload: {
      operation: 'refresh_delivery_live_activity',
      order_id: 'delivered-order',
      refresh_route: false,
      source: 'late_activity_token_registration',
    },
  }]));
  assert.match(pushHandler, /if \(isEnd\) \{\s+for \(const row of iosOrderActivityRows\)/);
});

test('registration storage is service-role only and direct entity RLS is admin/owner only', () => {
  for (const operation of ['create', 'read', 'update', 'delete']) {
    const roles = entity.rls[operation].$or.map(rule => rule.user_condition.role).sort();
    assert.deepEqual(roles, ['admin', 'owner']);
  }
  assert.match(manageHandler, /asServiceRole\.entities\.DeliveryLiveActivity/);
  assert.match(manageHandler, /findOwnedOrder/);
});

test('delivery refresh remains fail-closed behind enable and kill-switch gates', () => {
  assert.match(pushHandler, /ENABLE_DELIVERY_LIVE_ACTIVITIES/);
  assert.match(pushHandler, /DELIVERY_LIVE_ACTIVITIES_KILL_SWITCH/);
  assert.match(pushHandler, /delivery_live_activities_disabled/);
});

test('test orders and missing registrations are suppressed before route-provider work', () => {
  const preflightStart = pushHandler.indexOf('async function refreshDeliveryLiveActivities');
  const routeCall = pushHandler.indexOf('const route = await buildDeliveryRouteSnapshots', preflightStart);
  const testSuppression = pushHandler.indexOf("reason: 'test_order_suppressed'", preflightStart);
  const registrationSuppression = pushHandler.indexOf("reason: 'no_live_activity_registration'", preflightStart);
  assert.ok(preflightStart >= 0 && testSuppression > preflightStart && testSuppression < routeCall);
  assert.ok(registrationSuppression > testSuppression && registrationSuppression < routeCall);
});

test('APNs Live Activity start/update/end uses ActivityKit headers and payload contract', () => {
  for (const marker of [
    "'apns-push-type': 'liveactivity'",
    "push-type.liveactivity",
    "aps['attributes-type'] = DELIVERY_LIVE_ACTIVITY_ATTRIBUTES_TYPE",
    "aps['input-push-token'] = 1",
    "event: 'start' | 'update' | 'end'",
    "aps['dismissal-date']",
  ]) assert.ok(pushHandler.includes(marker), marker);
});

test('Android receives a data-only live-update payload', () => {
  assert.match(pushHandler, /liveActivityDataPayload\(snapshot, isEnd \? 'end' : 'update'\)/);
  assert.match(pushHandler, /\{ dataOnly: true \}/);
  assert.match(pushHandler, /message: options\.dataOnly/);
  assert.match(pushHandler, /android: \{ priority: 'high' \}/);
});

test('stable snapshot hashes suppress sequential duplicate deliveries', () => {
  assert.match(pushHandler, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(pushHandler, /if \(row\.last_snapshot_hash === hash\) continue/);
  assert.match(pushHandler, /last_snapshot_hash: hash/);
});

test('status transitions refresh active route snapshots without changing dry-run behavior', () => {
  assert.match(statusHandler, /\['out_for_delivery', 'arriving_soon', 'delivered'\]\.includes\(status\)/);
  assert.match(statusHandler, /refresh_route: status === 'delivered'/);
  assert.match(statusHandler, /const deliveryLiveActivity = dryRun/);
  assert.match(statusHandler, /\? \{ attempted: false, sent: false, reason: 'dry_run' \}/);
  assert.match(statusHandler, /test_order_customer_communications_suppressed/);
});

test('web integration sanitizes deep links and supports cold-start navigation', () => {
  assert.match(webBridge, /ALLOWED_DEEP_LINK/);
  assert.match(webBridge, /CapacitorApp\.getLaunchUrl\(\)/);
  assert.match(webBridge, /DeliveryLiveActivity\.consumePendingNavigation\(\)/);
  assert.match(webBridge, /PENDING_NATIVE_ROUTE_KEY/);
  assert.match(webBridge, /window\.sessionStorage\.setItem\(PENDING_NATIVE_ROUTE_KEY/);
  assert.match(webBridge, /expires_at: Date\.now\(\) \+ PENDING_NATIVE_ROUTE_TTL_MS/);
  assert.match(webBridge, /const preservedRoute = consumePreservedNativeRoute\(\)/);
  assert.match(webBridge, /preservedRoute \|\| nativeRouteFromUrl\(pendingNavigation\?\.url\) \|\| nativeRouteFromUrl\(launchUrl\?\.url\)/);
  assert.match(webBridge, /DeliveryLiveActivity\.addListener\('deliveryLiveActivityTokenChanged'/);
  assert.match(webBridge, /ensureDeliveryLiveActivityRegistration/);
  assert.match(app, /installDeliveryLiveActivityListeners/);
  assert.match(iosPlugin, /CAPPluginMethod\(name: "consumePendingNavigation"/);
  assert.match(iosPlugin, /NuViraPendingNavigationStore\.consume\(\)/);
  assert.match(iosPlugin, /allowedPathPattern/);
  assert.match(iosPlugin, /order-tracker/);
  assert.match(iosPlugin, /account\/orders/);
  assert.match(iosAppDelegate, /launchOptions\?\[\.url\] as\? URL/);
  assert.match(iosAppDelegate, /NuViraPendingNavigationStore\.capture\(url: url\)/);
});

test('the tracker presents a compact, privacy-safe live delivery card', () => {
  for (const marker of ['Live delivery', 'stops_ahead', 'progress_percent', 'Precise driver location stays private', 'syncDeliveryLiveActivity', 'Car', 'markerProgress']) {
    assert.ok(tracker.includes(marker), marker);
  }
  assert.match(tracker, /Route position/);
  assert.match(tracker, /You're next/);
  assert.doesNotMatch(tracker, /etaData\?\.stops_delivered/);
  assert.doesNotMatch(tracker, /driver_latitude|driver_longitude|driver_location/);
  assert.match(tracker, /\{!isOnRoute && <div className="mt-8 flex items-center gap-4 border-t/);
});

test('the order journey visually continues the Live Activity system across viewports', () => {
  for (const marker of ['bg-[#063b2a]', 'bg-[#0b1d16]', 'bg-lime-300', 'max-w-5xl', 'sm:grid-cols-2']) {
    assert.ok(tracker.includes(marker), marker);
  }
  assert.match(tracker, /animate=\{\{ width: `\$\{journey\.progressPercent\}%` \}\}/);
});

test('the iOS target contains ActivityKit attributes, widget UI, and app support metadata', () => {
  assert.match(iosAttributes, /ActivityAttributes/);
  assert.match(iosPlugin, /Activity\.request\(/);
  assert.match(iosPlugin, /pushTokenUpdates/);
  assert.match(iosWidget, /ActivityConfiguration\(for: NuViraDeliveryAttributes\.self\)/);
  assert.match(iosWidget, /DynamicIsland/);
  assert.match(iosWidget, /DeliveryProgressTrack\(value: progress\(context\.state\)\)/);
  assert.match(iosWidget, /systemName: "car\.side\.fill"/);
  assert.match(iosWidget, /\.scaleEffect\(x: -1, y: 1\)/);
  assert.match(iosInfo, /NSSupportsLiveActivities/);
  assert.match(iosExtensionInfo, /<key>CFBundleExecutable<\/key>\s*<string>\$\(EXECUTABLE_NAME\)<\/string>/);
  assert.match(iosExtensionAssets, /nuvira-delivery-logo\.png/);
  assert.match(iosCompactExtensionAssets, /nuvira-delivery-compact-logo\.png/);
  assert.match(iosAppLogoExtensionAssets, /nuvira-delivery-app-logo-1x\.png/);
  assert.match(iosAppLogoExtensionAssets, /nuvira-delivery-app-logo-2x\.png/);
  assert.match(iosAppLogoExtensionAssets, /nuvira-delivery-app-logo-3x\.png/);
  assert.match(iosSmallAppLogoExtensionAssets, /nuvira-delivery-app-logo-small-1x\.png/);
  assert.match(iosSmallAppLogoExtensionAssets, /nuvira-delivery-app-logo-small-2x\.png/);
  assert.match(iosSmallAppLogoExtensionAssets, /nuvira-delivery-app-logo-small-3x\.png/);
  assert.match(iosExtensionAssets, /"template-rendering-intent"\s*:\s*"original"/);
  assert.match(iosAppLogoExtensionAssets, /"template-rendering-intent"\s*:\s*"original"/);
  assert.match(iosSmallAppLogoExtensionAssets, /"template-rendering-intent"\s*:\s*"original"/);
  assert.match(iosWidget, /NuViraDeliveryAppLogoSmall/);
  assert.match(iosWidget, /NuViraDeliveryAppLogo/);
  assert.match(iosWidget, /renderingMode\(\.original\)/);
  assert.match(iosWidget, /widgetAccentedRenderingMode\(\.fullColor\)/);
  assert.match(iosWidget, /privacySensitive\(false\)/);
  assert.match(iosWidget, /\.unredacted\(\)/);
  assert.match(iosWidget, /Color\.clear\.frame\(height: 14\)/);
  assert.match(iosWidget, /let markerWidth: CGFloat = 30/);
  assert.match(iosWidget, /RoundedRectangle\(cornerRadius: 7/);
  assert.match(iosWidget, /StopsAheadView\(state: context\.state\)/);
  assert.match(iosWidget, /state\.stopsAhead == 0 \? "You're next"/);
  assert.match(tracker, /<Car className="h-3\.5 w-4"/);
  assert.doesNotMatch(tracker, /<Car className="[^"]*scale-x/);
  assert.match(iosProject, /Assets\.xcassets in Resources/);
  assert.match(iosProject, /NuViraDeliveryActivity\.appex/);
});

test('the Android target uses ProgressStyle with promoted and compatibility fallback content', () => {
  assert.match(androidPlugin, /NotificationCompat\.ProgressStyle/);
  assert.match(androidPlugin, /setRequestPromotedOngoing/);
  assert.match(androidPlugin, /setContentText\(content\)/);
  assert.match(androidPlugin, /setOngoing\(true\)/);
  assert.match(androidPlugin, /setPublicVersion/);
  assert.match(androidPlugin, /private static int notificationId\(String orderId\)/);
  assert.match(androidPlugin, /orderId\.hashCode\(\)/);
  assert.match(androidMessaging, /DeliveryLiveActivityPlugin\.handleRemoteMessage/);
  assert.match(androidPlugin, /nuvira_delivery_live_activity/);
  assert.match(androidManifest, /POST_PROMOTED_NOTIFICATIONS/);
  assert.match(androidManifest, /android:name="\.NuViraMessagingService"/);
});

test('native and server payloads never introduce precise-location fields', () => {
  for (const [name, source] of [
    ['push handler', pushHandler],
    ['web bridge', webBridge],
    ['iOS attributes', iosAttributes],
    ['Android plugin', androidPlugin],
  ]) {
    assert.doesNotMatch(source, /driverLatitude|driverLongitude|preciseDriverLocation/, name);
  }
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

console.log(`G125 delivery live activity: ${passed}/${tests.length} passed`);
