import { Capacitor } from '@capacitor/core';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';

export function isNativeAppShell() {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

export function getStoredBase44Token() {
  if (typeof window === 'undefined') return appParams.token || null;
  try {
    return localStorage.getItem('base44_access_token') || localStorage.getItem('token') || appParams.token || null;
  } catch {
    return appParams.token || null;
  }
}

function getCurrentRoute() {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
}

function normalizeReturnRoute(route) {
  if (!route || typeof route !== 'string') return '/';
  if (!route.startsWith('/') || route.startsWith('//')) return '/';
  return route;
}

export async function redirectToLogin(returnRoute = getCurrentRoute()) {
  const safeReturnRoute = normalizeReturnRoute(returnRoute);

  if (!isNativeAppShell()) {
    base44.auth.redirectToLogin(safeReturnRoute);
    return;
  }

  const loginUrl = `/native-login?return_to=${encodeURIComponent(safeReturnRoute)}`;
  window.location.assign(loginUrl);
}
