// Shared by the auth pages (Login, Register, and any page that resumes a flow
// after sign-in, e.g. the MCP OAuth consent page). Keep the redirect
// validation in one place — it is security-sensitive and easy to drift.

// A destination is not an auth command. Replaying logout/bootstrap parameters
// after OAuth can clear or overwrite the session that was just established.
export function sanitizeAuthReturnRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//') || route.includes('\\')) return '/';
  try {
    const origin = 'https://nuvira-auth-return.invalid';
    const url = new URL(route, origin);
    if (url.origin !== origin || url.pathname.startsWith('//')) return '/';
    for (const key of [
      'access_token', 'clear_access_token', 'signed_out', 'reset_sign_in',
      'app_id', 'app_base_url', 'functions_version', 'from_url',
      'native_provider_callback', 'native_browser_callback', 'is_new_user',
    ]) url.searchParams.delete(key);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return '/';
  }
}

// Browser sign-in must not return to an OS-associated native callback URL.
export function getBrowserProviderReturnUrl(returnRoute = '/') {
  if (typeof document !== 'undefined' && document.querySelector('[data-desktop-preview-badge="true"]')) {
    throw new Error('Sign-in is unavailable in this local design preview. Please sign in at nuvirajuice.com.');
  }
  const route = sanitizeAuthReturnRoute(returnRoute);
  const origin = window.location.origin;
  const url = new URL(route, origin);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new URL('/account', origin).toString();
  }
  if (/^\/native-(?:login|auth-bridge)(?:\/|$)/i.test(pathname)) {
    return new URL('/account', origin).toString();
  }
  return url.toString();
}

// Resolve ?returnTo= to a safe same-origin path, else "/".
//
// The same-origin check alone is not enough: a value like /.//evil.com or
// /\evil.com parses same-origin but normalizes to a protocol-relative
// //evil.com when assigned to location.href — an open redirect. So require the
// resolved path to be exactly one leading slash (no "//" prefix, no backslash).
export function safeReturnTo() {
  const raw = new URLSearchParams(window.location.search).get("returnTo");
  if (!raw) return "/";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    // Strip app-bootstrap params: app-params.js persists these from the URL into
    // localStorage before the SDK initializes, so a crafted returnTo could
    // otherwise poison the freshly issued session — repointing the app at an
    // attacker's backend (app_base_url/app_id/functions_version) or overwriting
    // the token. Normal app-flow params (e.g. the OAuth consent ctx) are kept.
    // The full app-params.js bootstrap set (src/lib/app-params.js) — any of
    // these in a crafted returnTo would be persisted at next load.
    for (const p of ["access_token", "clear_access_token", "app_id", "app_base_url", "functions_version", "from_url"]) {
      url.searchParams.delete(p);
    }
    const path = url.pathname + url.search;
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
    return path;
  } catch {
    return "/";
  }
}
