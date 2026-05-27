import { base44 } from '@/api/base44Client';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';

const VAPID_PUBLIC_KEY = 'BHmr7cCgm_eL3ckBL91ZKnvCqXvLax8pahXxpFCY8qwFXi0alWve4tDDJaaSDTuLwA-4VSEWBHMMlE_BixdHWaM';
const SERVICE_WORKER_PATH = '/push-sw.js';
const NUVIRA_APP_BUNDLE_ID = 'com.base69d48d0c39891f7945481152.app';

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
    const tokenResult = await FirebaseMessaging.getToken().catch(() => null);
    return tokenResult?.token ? { token_type: 'native_push', device_platform: Capacitor.getPlatform() } : null;
  }

  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH)
    || await navigator.serviceWorker.getRegistration('/');

  return registration?.pushManager.getSubscription() || null;
}

export async function subscribeToEventPushNotifications() {
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
    if (!tokenResult?.token && !apnsToken) {
      return { success: false, status, reason: 'native_push_token_unavailable' };
    }

    const response = await base44.functions.invoke('registerPushSubscription', {
      token_type: apnsToken ? 'apns' : 'fcm',
      fcm_token: tokenResult?.token || null,
      apns_token: apnsToken || null,
      apns_environment: 'unknown',
      app_bundle_id: NUVIRA_APP_BUNDLE_ID,
      permission: status,
      device_platform: Capacitor.getPlatform(),
      platform: Capacitor.getPlatform(),
      app_shell: 'capacitor',
      user_agent: navigator.userAgent || '',
    });

    const data = response?.data || response || {};
    if (data.error) throw new Error(data.error);
    if (data.success === false) {
      return {
        success: false,
        status,
        reason: data.reason || 'push_subscription_registration_unavailable',
        mode: 'native_push',
      };
    }

    return {
      success: true,
      status,
      mode: apnsToken ? 'native_apns' : 'native_fcm',
      server: data,
    };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { success: false, status: permission, reason: 'permission_not_granted' };
  }

  const registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH, { scope: '/' });
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing || await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
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
    const tokenResult = await FirebaseMessaging.getToken().catch(() => null);
    await base44.functions.invoke('unregisterPushSubscription', {
      token_type: 'fcm',
      fcm_token: tokenResult?.token || null,
    });
    await FirebaseMessaging.deleteToken().catch(() => {});
    return { success: true };
  }

  const existing = await getExistingEventPushSubscription();
  const endpoint = existing?.endpoint || null;

  if (existing) {
    await existing.unsubscribe();
  }

  await base44.functions.invoke('unregisterPushSubscription', { endpoint });

  return { success: true };
}
