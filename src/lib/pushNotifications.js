import { base44 } from '@/api/base44Client';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY || '';
const SERVICE_WORKER_PATH = '/push-sw.js';
const NUVIRA_IOS_BUNDLE_ID = 'com.base69d48d0c39891f7945481152.app';
const NUVIRA_ANDROID_APP_ID = 'com.nuvirajuice.app';
const NATIVE_PUSH_TARGET_KEY = 'nuvira_native_push_target_v2';
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

function nativePushPayload({ status, tokenResult, apnsToken }) {
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

function sameNativePushTarget(left, right) {
  if (!left || !right) return false;
  return Boolean(
    (left.fcm_token && right.fcm_token && left.fcm_token === right.fcm_token)
    || (left.apns_token && right.apns_token && left.apns_token === right.apns_token)
  );
}

function clearNativePushTarget() {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.removeItem(NATIVE_PUSH_TARGET_KEY);
  } catch {
    // Local storage can be unavailable in early WKWebView startup.
  }
}

function saveNativePushTarget(pushTarget) {
  if (typeof window === 'undefined' || !pushTarget) return;

  try {
    window.localStorage.setItem(NATIVE_PUSH_TARGET_KEY, JSON.stringify({
      ...pushTarget,
      saved_at: new Date().toISOString(),
    }));
  } catch {
    // Local storage is only a convenience for the event-only direct-token fallback.
  }
}

function readNativePushTarget() {
  if (typeof window === 'undefined') return null;

  try {
    const parsed = JSON.parse(window.localStorage.getItem(NATIVE_PUSH_TARGET_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.token_type === 'apns' && parsed.apns_token) return parsed;
    if (parsed.token_type === 'fcm' && parsed.fcm_token) return parsed;
  } catch {
    return null;
  }

  return null;
}

async function registerNativePushTarget(pushTarget, status = 'granted') {
  if (!pushTarget) {
    return { success: false, status, reason: 'native_push_token_unavailable', mode: 'native_push' };
  }

  const existing = readNativePushTarget();
  saveNativePushTarget({
    ...pushTarget,
    server_registered: Boolean(existing?.server_registered && sameNativePushTarget(existing, pushTarget)),
  });

  const registrations = await Promise.all(nativePushRegistrationTargets(pushTarget).map(async (target) => {
    try {
      const response = await base44.functions.invoke('registerPushSubscription', target);
      const data = response?.data || response || {};
      return { tokenType: target.token_type, data, success: data.success !== false && !data.error };
    } catch (error) {
      return { tokenType: target.token_type, data: { error: error.message }, success: false };
    }
  }));
  const successful = registrations.filter(registration => registration.success);
  if (successful.length === 0) {
    const reason = registrations[0]?.data?.reason || registrations[0]?.data?.error || 'push_subscription_registration_unavailable';
    return { success: false, status, reason, mode: 'native_push', persistent_storage: false };
  }

  const registeredTokenTypes = successful.map(registration => registration.tokenType);
  saveNativePushTarget({
    ...pushTarget,
    server_registered: true,
    server_registered_at: new Date().toISOString(),
    registered_token_types: registeredTokenTypes,
  });

  return {
    success: true,
    status,
    mode: registeredTokenTypes.includes('apns') ? 'native_apns_with_fcm' : 'native_fcm',
    registered_token_types: registeredTokenTypes,
    persistent_storage: true,
  };
}

async function currentNativePushTarget(status, apnsWaitMs = 1500) {
  const tokenResult = await FirebaseMessaging.getToken().catch(() => null);
  const apnsToken = await waitForApnsToken(apnsWaitMs).catch(() => null);
  return nativePushPayload({ status, tokenResult, apnsToken }) || readNativePushTarget();
}

function normalizePushRoute(value) {
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

function nativeNotificationData(event) {
  const notification = event?.notification || {};
  const data = notification?.data && typeof notification.data === 'object'
    ? notification.data
    : event?.data && typeof event.data === 'object'
      ? event.data
      : {};

  return {
    ...data,
    notification_id: String(data.notification_id || '').trim(),
    url: normalizePushRoute(data.url),
  };
}

async function markPushNotificationOpened(notificationId) {
  if (!notificationId) return;
  await base44.functions.invoke('getCustomerNotifications', {
    mark_read_id: notificationId,
  }).catch(() => {});
}

export async function installNativePushListeners({
  onNotificationAction,
  onNotificationReceived,
} = {}) {
  if (!isNativeApp()) return () => {};

  const handles = await Promise.all([
    FirebaseMessaging.addListener('notificationActionPerformed', async (event) => {
      const data = nativeNotificationData(event);
      await markPushNotificationOpened(data.notification_id);
      onNotificationAction?.({ event, data, route: data.url });
    }),
    FirebaseMessaging.addListener('notificationReceived', (event) => {
      const data = nativeNotificationData(event);
      onNotificationReceived?.({ event, data, route: data.url });
    }),
  ]);

  return async () => {
    await Promise.all(handles.map((handle) => handle?.remove?.().catch(() => {})));
  };
}

export function getPushSupportStatus() {
  if (typeof window === 'undefined') return { supported: false, reason: 'server' };
  if (isNativeApp()) return { supported: true, reason: null, mode: 'native_push' };
  if (!('Notification' in window)) return { supported: false, reason: 'notifications_unavailable' };
  if (!('serviceWorker' in navigator)) return { supported: false, reason: 'service_worker_unavailable' };
  if (!('PushManager' in window)) return { supported: false, reason: 'push_unavailable' };
  if (!window.isSecureContext) return { supported: false, reason: 'insecure_context' };
  return { supported: true, reason: null, mode: 'web_push' };
}

export async function getPushPermission() {
  if (isNativeApp()) {
    const result = await FirebaseMessaging.checkPermissions();
    return normalizeNativePermission(result.receive);
  }
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function getExistingPushSubscription() {
  const support = getPushSupportStatus();
  if (!support.supported) return null;

  if (isNativeApp()) {
    const permission = await FirebaseMessaging.checkPermissions();
    if (permission.receive !== 'granted') return null;
    const savedTarget = readNativePushTarget();
    return savedTarget?.server_registered === true
      ? { token_type: savedTarget.token_type, device_platform: Capacitor.getPlatform() }
      : null;
  }

  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH)
    || await navigator.serviceWorker.getRegistration('/');

  return registration?.pushManager.getSubscription() || null;
}

export async function getNativePushRequestPayload() {
  if (!isNativeApp()) return null;

  const permission = await FirebaseMessaging.checkPermissions().catch(() => null);
  const status = normalizeNativePermission(permission?.receive);
  if (status !== 'granted') return null;

  const pushTarget = await currentNativePushTarget(status);

  if (pushTarget) {
    const existing = readNativePushTarget();
    saveNativePushTarget({
      ...pushTarget,
      server_registered: Boolean(existing?.server_registered && sameNativePushTarget(existing, pushTarget)),
    });
    return pushTarget;
  }

  return readNativePushTarget();
}

export async function ensureAuthenticatedNativePushRegistration() {
  if (!isNativeApp()) {
    return { success: false, status: 'unsupported', reason: 'not_native_app' };
  }

  const nativeSupport = await FirebaseMessaging.isSupported().catch(() => ({ isSupported: false }));
  if (!nativeSupport.isSupported) {
    return { success: false, status: 'unsupported', reason: 'native_fcm_unavailable' };
  }

  const permission = await FirebaseMessaging.checkPermissions().catch(() => null);
  const status = normalizeNativePermission(permission?.receive);
  if (status !== 'granted') {
    return { success: false, status, reason: 'permission_not_granted' };
  }

  const pushTarget = await currentNativePushTarget(status);
  return registerNativePushTarget(pushTarget, status);
}

export async function subscribeToPushNotifications(options = {}) {
  const support = getPushSupportStatus();
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
    const pushTarget = nativePushPayload({ status, tokenResult, apnsToken });
    return registerNativePushTarget(pushTarget, status);
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

export async function unsubscribeFromPushNotifications() {
  if (isNativeApp()) {
    const savedTarget = readNativePushTarget();
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
    clearNativePushTarget();
    return { success: true, revoked };
  }

  const existing = await getExistingPushSubscription();
  const endpoint = existing?.endpoint || null;

  if (existing) {
    await existing.unsubscribe();
  }

  await base44.functions.invoke('unregisterPushSubscription', { endpoint });

  return { success: true };
}
