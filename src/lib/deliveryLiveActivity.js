import { base44 } from '@/api/base44Client';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';

const DeliveryLiveActivity = registerPlugin('DeliveryLiveActivity');
const INSTALLATION_ID_KEY = 'nuvira_delivery_live_activity_installation_v1';
const IOS_BUNDLE_ID = 'com.base69d48d0c39891f7945481152.app';
const ANDROID_APP_ID = 'com.nuvirajuice.app';
const ALLOWED_DEEP_LINK = /^\/(order-tracker\/[^/?#]+|account\/orders)(?:[/?#].*)?$/;
const PENDING_NATIVE_ROUTE_KEY = 'nuvira_pending_native_route_v1';
const PENDING_NATIVE_ROUTE_TTL_MS = 60 * 1000;
const CAPABILITY_REFRESH_MS = 15 * 60 * 1000;
let capabilityRegistrationPromise = null;
let capabilityRegisteredAt = 0;

function isNativeApp() {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

function normalizeSingleLine(value, maxLength = 180) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function safeInteger(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.round(number)) : fallback;
}

function safeDeepLink(value) {
  const path = normalizeSingleLine(value, 400);
  return ALLOWED_DEEP_LINK.test(path) ? path : '/account/orders';
}

function preserveNativeRoute(route) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(PENDING_NATIVE_ROUTE_KEY, JSON.stringify({
      route,
      expires_at: Date.now() + PENDING_NATIVE_ROUTE_TTL_MS,
    }));
  } catch {
    // The native pending-navigation store remains the fallback when storage is unavailable.
  }
}

function consumePreservedNativeRoute() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_NATIVE_ROUTE_KEY);
    window.sessionStorage.removeItem(PENDING_NATIVE_ROUTE_KEY);
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!Number.isFinite(pending?.expires_at) || pending.expires_at < Date.now()) return null;
    return safeDeepLink(pending.route);
  } catch {
    return null;
  }
}

function installationId() {
  if (typeof window === 'undefined') return '';
  try {
    const existing = window.localStorage.getItem(INSTALLATION_ID_KEY);
    if (existing && /^[A-Za-z0-9._:-]{8,180}$/.test(existing)) return existing;
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const next = `nuvira-${Capacitor.getPlatform()}-${random}`;
    window.localStorage.setItem(INSTALLATION_ID_KEY, next);
    return next;
  } catch {
    return `nuvira-${Capacitor.getPlatform()}-ephemeral`;
  }
}

async function appMetadata() {
  const info = await CapacitorApp.getInfo().catch(() => ({}));
  const platform = Capacitor.getPlatform();
  return {
    platform,
    installation_id: installationId(),
    app_bundle_id: platform === 'android' ? ANDROID_APP_ID : IOS_BUNDLE_ID,
    app_version: normalizeSingleLine(info.version, 80),
    build_number: normalizeSingleLine(info.build, 40),
  };
}

function sanitizeSnapshot(snapshot = {}) {
  const orderId = normalizeSingleLine(snapshot.order_id, 160);
  const orderNumber = normalizeSingleLine(snapshot.order_number, 80).replace(/^#/, '');
  if (!orderId || !orderNumber) return null;
  return {
    schemaVersion: 1,
    orderId,
    orderNumber,
    deepLink: safeDeepLink(snapshot.deep_link || `/order-tracker/${encodeURIComponent(orderNumber)}`),
    status: normalizeSingleLine(snapshot.status || 'out_for_delivery', 40),
    statusLabel: normalizeSingleLine(snapshot.status_label || 'Out for Delivery', 80),
    etaStartEpoch: safeInteger(snapshot.eta_start_epoch),
    etaEndEpoch: safeInteger(snapshot.eta_end_epoch),
    stopsAhead: safeInteger(snapshot.stops_ahead),
    stopsDelivered: safeInteger(snapshot.stops_delivered),
    stopsTotal: safeInteger(snapshot.stops_total),
    progressPercent: Math.min(100, safeInteger(snapshot.progress_percent)),
    updatedAtEpoch: safeInteger(snapshot.sequence, Math.floor(Date.now() / 1000)),
    staleAtEpoch: safeInteger(snapshot.stale_at_epoch),
    isDelayed: snapshot.status === 'delayed',
    message: normalizeSingleLine(snapshot.message, 160),
    activityState: normalizeSingleLine(snapshot.activity_state, 40),
  };
}

async function registerCapability(capability = {}) {
  const metadata = await appMetadata();
  const response = await base44.functions.invoke('manageDeliveryLiveActivity', {
    action: 'register_capability',
    ...metadata,
    push_to_start_token: normalizeSingleLine(capability.pushToStartToken, 4096),
    apns_environment: capability.apnsEnvironment || 'unknown',
    enabled: capability.available !== false,
  });
  return response?.data || response || {};
}

async function registerActivity(activity = {}) {
  const metadata = await appMetadata();
  const orderId = normalizeSingleLine(activity.orderId, 160);
  const activityId = normalizeSingleLine(activity.activityId, 180);
  if (!orderId || !activityId) return { success: false, reason: 'activity_identity_missing' };
  const response = await base44.functions.invoke('manageDeliveryLiveActivity', {
    action: 'register_activity',
    ...metadata,
    order_id: orderId,
    activity_id: activityId,
    activity_push_token: normalizeSingleLine(activity.activityPushToken, 4096),
    apns_environment: activity.apnsEnvironment || 'unknown',
  });
  return response?.data || response || {};
}

async function endServerActivity(activity = {}) {
  const metadata = await appMetadata();
  const orderId = normalizeSingleLine(activity.orderId, 160);
  if (!orderId) return;
  await base44.functions.invoke('manageDeliveryLiveActivity', {
    action: 'end_activity',
    ...metadata,
    order_id: orderId,
    activity_id: normalizeSingleLine(activity.activityId, 180),
  }).catch(() => null);
}

export async function ensureDeliveryLiveActivityRegistration({ force = false } = {}) {
  if (!isNativeApp()) return { success: false, status: 'unsupported', reason: 'not_native_app' };
  if (!force && capabilityRegistrationPromise && Date.now() - capabilityRegisteredAt < CAPABILITY_REFRESH_MS) {
    return capabilityRegistrationPromise;
  }
  capabilityRegistrationPromise = (async () => {
    const capability = await DeliveryLiveActivity.isAvailable().catch(() => null);
    if (!capability?.available) {
      return { success: false, status: 'unsupported', reason: capability?.reason || 'native_live_activity_unavailable' };
    }
    const server = await registerCapability(capability);
    const activeActivities = Array.isArray(capability.activeActivities) ? capability.activeActivities : [];
    for (const activity of activeActivities) await registerActivity(activity);
    if (server.success === true) capabilityRegisteredAt = Date.now();
    return { success: server.success === true, status: 'registered', capability, server };
  })();
  return capabilityRegistrationPromise;
}

export async function syncDeliveryLiveActivity(snapshot) {
  if (!isNativeApp()) return { success: false, status: 'unsupported' };
  const safeSnapshot = sanitizeSnapshot(snapshot);
  if (!safeSnapshot) return { success: false, status: 'invalid_snapshot' };

  await ensureDeliveryLiveActivityRegistration().catch(() => null);

  if (safeSnapshot.activityState === 'delivered' || safeSnapshot.activityState === 'inactive') {
    const result = await DeliveryLiveActivity.end({ snapshot: safeSnapshot }).catch(() => null);
    await endServerActivity({
      orderId: safeSnapshot.orderId,
      activityId: result?.activityId,
    });
    return { success: true, status: 'ended', native: result };
  }

  const result = await DeliveryLiveActivity.sync({ snapshot: safeSnapshot }).catch((error) => ({
    success: false,
    reason: error?.message || 'native_sync_failed',
  }));
  if (result?.activityId) {
    await registerActivity({
      orderId: safeSnapshot.orderId,
      activityId: result.activityId,
      activityPushToken: result.activityPushToken,
      apnsEnvironment: result.apnsEnvironment,
    });
  }
  return result;
}

function nativeRouteFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'nuvira:' && url.hostname === 'open') {
      return safeDeepLink(url.searchParams.get('path'));
    }
    if (url.protocol === 'https:' && ['nuvirajuice.com', 'www.nuvirajuice.com'].includes(url.hostname)) {
      return safeDeepLink(`${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    return null;
  }
  return null;
}

export async function installDeliveryLiveActivityListeners({ onNavigate } = {}) {
  if (!isNativeApp()) return () => {};
  const handles = [];
  const add = async (promise) => {
    const handle = await promise.catch(() => null);
    if (handle?.remove) handles.push(handle);
  };

  await add(DeliveryLiveActivity.addListener('deliveryLiveActivityCapabilityChanged', async (event) => {
    await registerCapability(event).catch(() => null);
  }));
  await add(DeliveryLiveActivity.addListener('deliveryLiveActivityTokenChanged', async (event) => {
    await registerActivity(event).catch(() => null);
  }));
  await add(DeliveryLiveActivity.addListener('deliveryLiveActivityEnded', async (event) => {
    await endServerActivity(event).catch(() => null);
  }));
  await add(CapacitorApp.addListener('appUrlOpen', async (event) => {
    const route = nativeRouteFromUrl(event?.url);
    if (!route) return;
    preserveNativeRoute(route);
    onNavigate?.(route);
    await DeliveryLiveActivity.consumePendingNavigation().catch(() => null);
  }));

  const preservedRoute = consumePreservedNativeRoute();
  const pendingNavigation = await DeliveryLiveActivity.consumePendingNavigation().catch(() => null);
  const launchUrl = await CapacitorApp.getLaunchUrl().catch(() => null);
  const launchRoute = preservedRoute || nativeRouteFromUrl(pendingNavigation?.url) || nativeRouteFromUrl(launchUrl?.url);
  if (launchRoute) onNavigate?.(launchRoute);

  return () => handles.forEach((handle) => handle.remove().catch(() => {}));
}

export { sanitizeSnapshot as buildNativeDeliverySnapshot };
