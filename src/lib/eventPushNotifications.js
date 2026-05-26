import { base44 } from '@/api/base44Client';

const VAPID_PUBLIC_KEY = 'BHmr7cCgm_eL3ckBL91ZKnvCqXvLax8pahXxpFCY8qwFXi0alWve4tDDJaaSDTuLwA-4VSEWBHMMlE_BixdHWaM';
const SERVICE_WORKER_PATH = '/push-sw.js';

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
  if (!('Notification' in window)) return { supported: false, reason: 'notifications_unavailable' };
  if (!('serviceWorker' in navigator)) return { supported: false, reason: 'service_worker_unavailable' };
  if (!('PushManager' in window)) return { supported: false, reason: 'push_unavailable' };
  if (!window.isSecureContext) return { supported: false, reason: 'insecure_context' };
  return { supported: true, reason: null };
}

export function getEventPushPermission() {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

export async function getExistingEventPushSubscription() {
  const support = getEventPushSupportStatus();
  if (!support.supported) return null;

  const registration = await navigator.serviceWorker.getRegistration(SERVICE_WORKER_PATH)
    || await navigator.serviceWorker.getRegistration('/');

  return registration?.pushManager.getSubscription() || null;
}

export async function subscribeToEventPushNotifications() {
  const support = getEventPushSupportStatus();
  if (!support.supported) {
    return { success: false, status: 'unsupported', reason: support.reason };
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
  const existing = await getExistingEventPushSubscription();
  const endpoint = existing?.endpoint || null;

  if (existing) {
    await existing.unsubscribe();
  }

  await base44.functions.invoke('unregisterPushSubscription', { endpoint });

  return { success: true };
}
