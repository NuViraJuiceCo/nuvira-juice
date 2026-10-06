const PUBLIC_PAGES = new Set([
  '/', '/shop', '/about', '/our-story', '/why-nuvira', '/events', '/merch', '/contact', '/support',
  '/delivery', '/delivery.html', '/returns', '/returns.html', '/legal',
  '/cold-pressed-juice-delivery', '/fresh-juice-delivery-st-louis',
  '/cold-pressed-juice-wentzville', '/juice-cleanse-wentzville',
  '/all-natural-juice-wentzville', '/juice-catering-st-louis',
  '/cold-pressed-juice-ofallon-mo', '/juice-delivery-st-charles-mo',
  '/juice-delivery-lake-saint-louis', '/wellness-shots-wentzville',
  '/corporate-juice-catering-st-louis', '/fresh-juice-for-events-st-louis',
]);

const AUTH_RETURN_PARAMS = new Set([
  'access_token', 'clear_access_token', 'code', 'state', 'error', 'is_new_user',
  'native_provider_callback', 'native_browser_callback', 'reset_sign_in',
]);

export function hasStartupAuthParams(search = '', hash = '') {
  return [search, hash.replace(/^#/, '')].some(value => {
    const params = new URLSearchParams(value);
    return [...params.keys()].some(key => AUTH_RETURN_PARAMS.has(key));
  });
}

export function canRenderPublicStorefront({
  pathname = '', search = '', hash = '', isNative = false, startedWithAuthReturn = false,
} = {}) {
  if (isNative || startedWithAuthReturn || hasStartupAuthParams(search, hash)) return false;
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return false;
  // Explicitly exclude cart/checkout, auth, account, operations and unknown routes.
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return PUBLIC_PAGES.has(path) || /^\/(shop|product|products|program)\/[^/]+$/.test(path);
}
