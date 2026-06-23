import { base44 } from '@/api/base44Client';
import { appParams } from '@/lib/app-params';

const AUTH_TOKEN_STORAGE_KEYS = ['base44_access_token', 'token', 'base44_clear_access_token'];
const SIGN_IN_RESET_STORAGE_KEYS = [...AUTH_TOKEN_STORAGE_KEYS, 'base44_from_url'];
const NATIVE_CALLBACK_ROUTE = '/native-login';
const NATIVE_URL_SCHEME = 'nuvira';
const NATIVE_CALLBACK_MARKER = 'native_provider_callback';

export function isNativeAppShell() {
  return typeof window !== 'undefined';
}

export function hasBase44AuthParamsInUrl() {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return params.has('access_token') || params.get('clear_access_token') === 'true';
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function applyBase44AuthParams(url) {
  const accessToken = url.searchParams.get('access_token');
  const shouldClearToken = url.searchParams.get('clear_access_token') === 'true';

  if (!accessToken && !shouldClearToken) return null;

  if (shouldClearToken) {
    for (const key of AUTH_TOKEN_STORAGE_KEYS) {
      window.localStorage.removeItem(key);
    }
  }

  if (accessToken) {
    base44.auth.setToken(accessToken);
  }

  return accessToken;
}

export function consumeBase44AuthFromUrl() {
  if (typeof window === 'undefined') return null;

  const url = new URL(window.location.href);
  const accessToken = applyBase44AuthParams(url);
  const shouldClearToken = url.searchParams.get('clear_access_token') === 'true';

  if (!accessToken && !shouldClearToken) return null;

  try {
    return accessToken;
  } finally {
    url.searchParams.delete('access_token');
    url.searchParams.delete('clear_access_token');
    url.searchParams.delete('is_new_user');
    url.searchParams.delete(NATIVE_CALLBACK_MARKER);
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  }
}

export function normalizeReturnRoute(route) {
  if (!route || typeof route !== 'string') return '/';
  if (!route.startsWith('/') || route.startsWith('//')) return '/';
  return route;
}


function dispatchInAppNavigationEvent() {
  try {
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    try {
      window.dispatchEvent(new Event('popstate'));
    } catch {
      // Event dispatch is best effort only.
    }
  }
}

export function replaceInAppRoute(route = '/') {
  if (typeof window === 'undefined') return false;
  const safeRoute = normalizeReturnRoute(route);
  try {
    window.history.replaceState({}, document.title, safeRoute);
    dispatchInAppNavigationEvent();
    return true;
  } catch {
    console.warn('[nativeAuthRedirect] In-app route replacement failed', 'navigation_unavailable');
    return false;
  }
}


export function getNativeLoginResetRoute(returnRoute = '/account') {
  const params = new URLSearchParams();
  params.set('return_to', normalizeReturnRoute(returnRoute));
  params.set('reset_sign_in', '1');
  params.set('clear_access_token', 'true');
  return `${NATIVE_CALLBACK_ROUTE}?${params.toString()}`;
}

export async function resetSignInAndReload(returnRoute = '/account') {
  if (typeof window === 'undefined') return;

  const resetRoute = getNativeLoginResetRoute(returnRoute);
  clearBase44AuthTokens();
  for (const key of SIGN_IN_RESET_STORAGE_KEYS) {
    try {
      window.localStorage?.removeItem(key);
      window.sessionStorage?.removeItem(key);
    } catch {
      // Storage can be unavailable; the reset route carries clear_access_token as a second guard.
    }
  }

  try {
    const fromUrl = window.location.origin && window.location.origin !== 'null'
      ? new URL(resetRoute, window.location.origin).toString()
      : resetRoute;
    await fetch(`${appParams.appBaseUrl}/api/apps/auth/logout?from_url=${encodeURIComponent(fromUrl)}`, {
      method: 'GET',
      credentials: 'include',
    });
  } catch {
    console.warn('[nativeAuthRedirect] Sign-in reset logout request failed', 'logout_request_failed');
  }

  window.location.replace(resetRoute);
}

export function getNativeProviderReturnUrl(returnRoute = '/') {
  const callbackUrl = new URL(NATIVE_CALLBACK_ROUTE, appParams.appBaseUrl);
  callbackUrl.searchParams.set('return_to', normalizeReturnRoute(returnRoute));
  callbackUrl.searchParams.set(NATIVE_CALLBACK_MARKER, '1');
  return callbackUrl.toString();
}

export function getNativeSchemeProviderReturnUrl(returnRoute = '/') {
  const callbackUrl = new URL(`${NATIVE_URL_SCHEME}://auth/callback`);
  callbackUrl.searchParams.set('return_to', normalizeReturnRoute(returnRoute));
  callbackUrl.searchParams.set(NATIVE_CALLBACK_MARKER, '1');
  return callbackUrl.toString();
}

export function consumeNativeAuthCallbackUrl(callbackUrl) {
  if (typeof window === 'undefined') return null;

  const url = parseUrl(callbackUrl);
  if (!url) return null;

  const appBaseUrl = parseUrl(appParams.appBaseUrl);
  const isApprovedWebCallback = appBaseUrl
    && url.origin === appBaseUrl.origin
    && url.pathname === NATIVE_CALLBACK_ROUTE;
  const isApprovedSchemeCallback = url.protocol === `${NATIVE_URL_SCHEME}:`
    && url.host === 'auth'
    && url.pathname === '/callback';

  if (!isApprovedWebCallback && !isApprovedSchemeCallback) return null;

  const accessToken = applyBase44AuthParams(url);
  const shouldClearToken = url.searchParams.get('clear_access_token') === 'true';
  const returnTo = normalizeReturnRoute(url.searchParams.get('return_to'));

  if (!accessToken && !shouldClearToken && url.searchParams.get(NATIVE_CALLBACK_MARKER) !== '1') {
    return null;
  }

  return {
    accessToken,
    shouldClearToken,
    returnTo,
  };
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

function routeWithClearToken(route) {
  if (typeof window === 'undefined') return '/';
  const url = new URL(normalizeReturnRoute(route), window.location.origin);
  url.searchParams.set('clear_access_token', 'true');
  url.searchParams.set('signed_out', '1');
  return `${url.pathname}${url.search}${url.hash}`;
}

export function clearBase44AuthTokens() {
  if (typeof window === 'undefined') return;
  for (const key of AUTH_TOKEN_STORAGE_KEYS) {
    try {
      window.localStorage?.removeItem(key);
      window.sessionStorage?.removeItem(key);
    } catch {
      // Storage can be unavailable in strict privacy contexts. The reload
      // route below still carries clear_access_token as a second guard.
    }
  }
}

export async function redirectToLogin(returnRoute = getCurrentRoute()) {
  const safeReturnRoute = normalizeReturnRoute(returnRoute);

  if (typeof window === 'undefined') {
    base44.auth.redirectToLogin(safeReturnRoute);
    return;
  }

  if (window.location.pathname === '/native-login') {
    return;
  }

  // Keep customer checkout/account auth inside the NuVira app session. The
  // hosted Base44 login can open in an external browser/webview and return
  // without sharing the same token storage, which creates a sign-in loop.
  const loginUrl = `/native-login?return_to=${encodeURIComponent(safeReturnRoute)}`;
  replaceInAppRoute(loginUrl);
}

export async function logoutInsideApp(returnRoute = '/account') {
  if (typeof window === 'undefined') return;

  const signedOutRoute = routeWithClearToken(returnRoute);
  clearBase44AuthTokens();

  try {
    const fromUrl = `${window.location.origin}${signedOutRoute}`;
    await fetch(`${appParams.appBaseUrl}/api/apps/auth/logout?from_url=${encodeURIComponent(fromUrl)}`, {
      method: 'GET',
      credentials: 'include',
    });
  } catch {
    // Clearing local app auth is the critical path. If the hosted logout
    // endpoint cannot be reached from the app shell, keep the user in-app.
  }

  replaceInAppRoute(signedOutRoute);
}
