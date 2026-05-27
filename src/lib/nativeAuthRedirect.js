import { Capacitor } from '@capacitor/core';
import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';

const AUTH_TOKEN_STORAGE_KEYS = ['base44_access_token', 'token'];

export function isNativeAppShell() {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

export function hasBase44AuthParamsInUrl() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('access_token') || params.get('clear_access_token') === 'true';
}

export function consumeBase44AuthFromUrl() {
  if (typeof window === 'undefined') return null;

  const url = new URL(window.location.href);
  const accessToken = url.searchParams.get('access_token');
  const shouldClearToken = url.searchParams.get('clear_access_token') === 'true';

  if (!accessToken && !shouldClearToken) return null;

  try {
    if (shouldClearToken) {
      for (const key of AUTH_TOKEN_STORAGE_KEYS) {
        window.localStorage.removeItem(key);
      }
    }

    if (accessToken) {
      base44.auth.setToken(accessToken);
    }
  } finally {
    url.searchParams.delete('access_token');
    url.searchParams.delete('clear_access_token');
    url.searchParams.delete('is_new_user');
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }

  return accessToken;
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
