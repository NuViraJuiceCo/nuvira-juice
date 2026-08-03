import { base44 } from '@/api/base44Client';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY || '';
const SERVICE_WORKER_PATH = '/push-sw.js';
const NUVIRA_IOS_BUNDLE_ID = 'com.base69d48d0c39891f7945481152.app';
const NUVIRA_ANDROID_APP_ID = 'com.nuvirajuice.app';
const EVENT_NATIVE_PUSH_TARGET_KEY = 'nuvira_may30_native_push_target_v1';
let cachedVapidPublicKey = null;

function isNativeApp() {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

function normalizeNativePermission(value) {
  if (value === 'granted') return 'granted';
  if (value === 'denied') return 'denied';
  return 'default';
}

function isIosNativeApp() {
  return isNativeApp() && Capacitor.getPlatform() === 'ios';
}

function nativeAppIdentifier() {
  return Capacitor.getPlatform() === 'android'
    ? NUVIRA_ANDROID_APP_ID
    : NUVIRA_IOS_BUNDLE_ID;
}

async function waitForApnsToken(timeoutMs = 5000) {
  if (!isIosNativeApp()) return null;

  let listenerHandle = null;
  return new Promise((resolve) => {
    let settled = false;
    const finish = async (token) => {
      if (settled) return;
      settled = true;
      if (listenerHandle?.remove) {
        await listenerHandle.remove().catch(() => {});
      }
      resolve(token || null);
    };

    const timeout = window.setTimeout(() => finish(null), timeoutMs);
    FirebaseMessaging.addListener('apnsTokenReceived', (event) => {
      window.clearTimeout(timeout);
      finish(event?.token || null);
    }).then((handle) => {
      listenerHandle = handle;
    }).catch(() => {
      window.clearTimeout(timeout);
      finish(null);
    });
  });
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

function normalizeVapidPublicKey(value) {
  return String(value || '').trim();
}

async function readWebPushVapidPublicKey() {
  if (VAPID_PUBLIC_KEY) return VAPID_PUBLIC_KEY;
  if (cachedVapidPublicKey !== null) return cachedVapidPublicKey;

  try {
    const response = await base44.functions.invoke('getAdminPushDiagnostics', {});
    const data = response?.data || response || {};
    cachedVapidPublicKey = normalizeVapidPublicKey(data.providers?.web_push_public_key);
  } catch {
    cachedVapidPublicKey = '';
  }

  return cachedVapidPublicKey;
}

function canUseEventNativePushFallback(reason) {
  return [
    'push_subscription_fallback_storage_unavailable',
    'push_subscription_storage_unavailable',
    'push_subscription_registration_unavailable',
  ].includes(reason);
}

function eventNativePushPayload({ status, tokenResult, apnsToken }) {
  const fcmToken = tokenResult?.token || null;
  const nativeApnsToken = apnsToken || null;

  if (!fcmToken && !nativeApnsToken) return null;

  return {
    // FirebaseMessaging.getToken() is the cross-platform delivery token. Prefer
    // it whenever it is available so iOS and Android use the same audited FCM
    // transport, while retaining the APNs token as diagnostic/fallback metadata.
    token_type: fcmToken ? 'fcm' : 'apns',
    fcm_token: fcmToken,
    apns_token: nativeApnsToken,
    apns_environment: 'unknown',
    app_bundle_id: nativeAppIdentifier(),
    permission: status,
    device_platform: Capacitor.getPlatform(),
    platform: Capacitor.getPlatform(),
    app_shell: 'capacitor',
    user_agent: navigator.userAgent || '',
  };
}

function nativePushRegistrationTargets(pushTarget) {
  if (!pushTarget) return [];
  const targets = [];
  if (pushTarget.fcm_token) {
    targets.push({ ...pushTarget, token_type: 'fcm' });
  }
  if (pushTarget.apns_token) {
    targets.push({
      ...pushTarget,
      token_type: 'apns',
      fcm_token: null,
      apns_environment: 'production',
    });
  }
  return targets;
}

function clearEventNativePushTarget() {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(EVENT_NATIVE_PUSH_TARGET_KEY);
  } catch {
    // Local storage can be unavailable in early WKWebView startup.
  }
}

function saveEventNativePushTarget(pushTarget) {
  if (typeof window === 'undefined' || !pushTarget) return;

  try {
    window.localStorage.setItem(EVENT_NATIVE_PUSH_TARGET_KEY, JSON.stringify({
      ...pushTarget,
      saved_at: new Date().toISOString(),
    }));
  } catch {
    // Local storage is only a convenience for the event-only direct-token fallback.
  }
}

function readEventNativePushTarget() {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(EVENT_NATIVE_PUSH_TARGET_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.token_type === 'apns' && parsed.apns_token) return parsed;
    if (parsed.token_type === 'fcm' && parsed.fcm_token) return parsed;
  } catch {
    return null;
  }

  return null;
}

function normalizeEventPushRoute(value) {
  const route = String(value || '/notifications').trim();
  if (!route.startsWith('/') || route.startsWith('//') || route.includes('\\')) {
    return '/notifications';
  }

  try {
    const parsed = new URL(route, 'https://app.nuvirajuice.com');
    if (parsed.origin !== 'https://app.nuvirajuice.com') return '/notifications';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/notifications';
  }
}

function eventNativeNotificationData(event) {
  const notification = event?.notification || {};
  const data = notification?.data && typeof notification.data === 'object'
    ? notification.data
    : event?.data && typeof event.data === 'object'
      ? event.data
      : {};

  return {
    ...data,
    notification_id: String(data.notification_id || '').trim(),
    url: normalizeEventPushRoute(data.url),
  };
}

async function markEventPushNotificationOpened(notificationId) {
  if (!notificationId) return;
  await base44.functions.invoke('getCustomerNotifications', {
    mark_read_id: notificationId,
  }).catch(() => {});
}

export async function installEventNativePushListeners({
  onNotificationAction,
  onNotificationReceived,
} = {}) {
  if (!isNativeApp()) return () => {};

  const handles = await Promise.all([
    FirebaseMessaging.addListener('notificationActionPerformed', async (event) => {
      const data = eventNativeNotificationData(event);
      await markEventPushNotificationOpened(data.notification_id);
      onNotificationAction?.({ event, data, route: data.url });
    }),
    FirebaseMessaging.addListener('notificationReceived', (event) => {
      const data = eventNativeNotificationData(event);
      onNotificationReceived?.({ event, data, route: data.url });
    }),
  ]);

  return async () => {
    await Promise.all(handles.map((handle) => handle?.remove?.().catch(() => {})));
  };
}

export function getEventPushSupportStatus() {
  if (typeof window === 'undefined') return { supported: false, reason: 'server' };
  if (isNativeApp()) return { supported: true, reason: null, mode: 'native_push' };
  if (!('Notification' in window)) return { supported: false, reason: 'notifications_unavailable' };
  if (!('serviceWorker' in navigator)) return { supported: false, reason: 'service_worker_unavailable' };
  if (!('PushManager' in window)) return { supported: false, reason: 'push_unavailable' };
  if (!window.isSecureContext) return { supported: false, reason: 'insecure_context' };
  return { supported: true, reason: null, mode: 'web_push' };
}

export async function getEventPushPermission() {
  if (isNativeApp()) {
    const result = await FirebaseMessaging.checkPermissions();
    return normalizeNativePermission(result.receive);
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function getExistingEventPushSubscription() {
  const support = getEventPushSupportStatus();
  if (!support.supported) return null;

  if (isNativeApp()) {
    const permission = await FirebaseMessaging.checkPermissions();
    if (permission.receive !== 'granted') return null;
    const savedTarget = readEventNativePushTarget();
    return savedTarget
      ? { token_type: savedTarget.token_type, device_platform: Capacitor.getPlatform() }
      : null;
  }

  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH)
    || await navigator.serviceWorker.getRegistration('/');

  return registration?.pushManager.getSubscription() || null;
}

export async function getEventNativePushRequestPayload() {
  if (!isNativeApp()) return null;

  const permission = await FirebaseMessaging.checkPermissions().catch(() => null);
  const status = normalizeNativePermission(permission?.receive);
  if (status !== 'granted') return null;

  const tokenResult = await FirebaseMessaging.getToken().catch(() => null);
  const apnsToken = await waitForApnsToken(1500).catch(() => null);
  const pushTarget = eventNativePushPayload({ status, tokenResult, apnsToken });

  if (pushTarget) {
    saveEventNativePushTarget(pushTarget);
    return pushTarget;
  }

  return readEventNativePushTarget();
}

export async function subscribeToEventPushNotifications(options = {}) {
  const support = getEventPushSupportStatus();
  if (!support.supported) {
    return { success: false, status: 'unsupported', reason: support.reason };
  }

  if (isNativeApp()) {
    const nativeSupport = await FirebaseMessaging.isSupported();
    if (!nativeSupport.isSupported) {
      return { success: false, status: 'unsupported', reason: 'native_fcm_unavailable' };
    }

    const apnsTokenPromise = waitForApnsToken();
    const permission = await FirebaseMessaging.requestPermissions();
    const status = normalizeNativePermission(permission.receive);
    if (status !== 'granted') {
      return { success: false, status, reason: 'permission_not_granted' };
    }

    const tokenResult = await FirebaseMessaging.getToken();
    const apnsToken = await apnsTokenPromise;
    const pushTarget = eventNativePushPayload({ status, tokenResult, apnsToken });
    if (!pushTarget) {
      return { success: false, status, reason: 'native_push_token_unavailable' };
    }

    saveEventNativePushTarget(pushTarget);

    const registrations = await Promise.all(nativePushRegistrationTargets(pushTarget).map(async (target) => {
      try {
        const response = await base44.functions.invoke('registerPushSubscription', target);
        const data = response?.data || response || {};
        return { target, data, success: data.success !== false && !data.error };
      } catch (error) {
        return { target, data: { error: error.message }, success: false };
      }
    }));
    const successful = registrations.filter((registration) => registration.success);
    if (successful.length === 0) {
      const reason = registrations[0]?.data?.reason || registrations[0]?.data?.error || 'push_subscription_registration_unavailable';
      if (canUseEventNativePushFallback(reason)) {
        return { success: true, status, reason, mode: 'native_push_direct', persistent_storage: false };
      }
      return { success: false, status, reason, mode: 'native_push' };
    }

    return {
      success: true,
      status,
      mode: successful.some((registration) => registration.target.token_type === 'apns')
        ? 'native_apns_with_fcm'
        : 'native_fcm',
      registered_token_types: successful.map((registration) => registration.target.token_type),
      server: successful.map((registration) => registration.data),
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { success: false, status: permission, reason: 'permission_not_granted' };
  }

  const vapidPublicKey = normalizeVapidPublicKey(options.vapidPublicKey) || await readWebPushVapidPublicKey();
  if (!vapidPublicKey) {
    return { success: false, status: permission, reason: 'vapid_public_key_missing' };
  }

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: '/' });
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  const response = await base44.functions.invoke('registerPushSubscription', {
    subscription: subscription.toJSON(),
    permission,
    platform: navigator.platform || '',
    user_agent: navigator.userAgent || '',
  });

  const data = response?.data || response || {};
  if (data.error) throw new Error(data.error);
  if (data.success === false) {
    if (!existing) {
      await subscription.unsubscribe().catch(() => {});
    }
    return {
      success: false,
      status: permission,
      reason: data.reason || 'push_subscription_registration_unavailable',
    };
  }

  return {
    success: true,
    status: permission,
    subscription,
    server: data,
  };
}

export async function unsubscribeFromEventPushNotifications() {
  if (isNativeApp()) {
    const savedTarget = readEventNativePushTarget();
    const tokenResult = await FirebaseMessaging.getToken().catch(() => null);
    const selectors = [];
    const fcmToken = savedTarget?.fcm_token || tokenResult?.token;
    if (fcmToken) selectors.push({ token_type: 'fcm', fcm_token: fcmToken });
    if (savedTarget?.apns_token) selectors.push({ token_type: 'apns', apns_token: savedTarget.apns_token });

    let revoked = 0;
    for (const selector of selectors) {
      const response = await base44.functions.invoke('unregisterPushSubscription', selector);
      const data = response?.data || response || {};
      if (data.error) throw new Error(data.error);
      revoked += Number(data.revoked || 0);
    }

    await FirebaseMessaging.deleteToken().catch(() => {});
    clearEventNativePushTarget();
    return { success: true, revoked };
  }

  const existing = await getExistingEventPushSubscription();
  const endpoint = existing?.endpoint || null;

  if (existing) {
    await existing.unsubscribe();
  }

  await base44.functions.invoke('unregisterPushSubscription', { endpoint });

  return { success: true };
}
