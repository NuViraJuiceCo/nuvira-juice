export const startupPageLoaders = {
  home: () => import('@/pages/Home'),
  shop: () => import('@/pages/Shop'),
  account: () => import('@/pages/Account'),
  accountSetup: () => import('@/pages/AccountSetup'),
  nativeLogin: () => import('@/pages/NativeLogin'),
  orderHistory: () => import('@/pages/OrderHistory'),
  orderTracker: () => import('@/pages/OrderTracker'),
};

export function startupPageKey(route) {
  const pathname = String(route || '/').split(/[?#]/, 1)[0];
  if (pathname === '/') return 'home';
  if (pathname === '/shop') return 'shop';
  if (pathname === '/account') return 'account';
  if (pathname === '/account-setup') return 'accountSetup';
  if (pathname === '/native-login') return 'nativeLogin';
  if (pathname === '/account/orders') return 'orderHistory';
  if (/^\/order-tracker(?:\/|$)/.test(pathname)) return 'orderTracker';
  return null;
}

// Only load page code. Protected reads and mutations still wait for mounted routes.
export async function preloadStartupPage(route) {
  const key = startupPageKey(route);
  if (!key) return false;
  try {
    await startupPageLoaders[key]();
    return true;
  } catch {
    // A failed warmup must not abort sign-in; the route can load normally later.
    return false;
  }
}

// Link intent warms only public page modules. Importing does not mount a route
// or run its query hooks; account data and auth remain behind existing gates.
const publicNavigationLoaders = Object.freeze({
  '/': startupPageLoaders.home,
  '/shop': startupPageLoaders.shop,
  '/about': () => import('@/pages/About'),
  '/contact': () => import('@/pages/Contact'),
  '/support': () => import('@/pages/Support'),
});
const publicNavigationPrefetches = new Map();
const MAX_PUBLIC_NAVIGATION_PREFETCHES = 2;
let publicNavigationPrefetchesInFlight = 0;

export function isPublicNavigationPreloadRoute(route) {
  return typeof route === 'string' && Object.hasOwn(publicNavigationLoaders, route);
}

export function preloadPublicNavigation(route, { isNative = true, isAdmin = true } = {}) {
  // Fail closed unless the caller confirms customer-web context. Keep this
  // module independent of auth/runtime initialization and browser-only by default.
  if (typeof window === 'undefined' || isNative !== false || isAdmin !== false ||
      !isPublicNavigationPreloadRoute(route)) return Promise.resolve(false);
  if (publicNavigationPrefetches.has(route)) return publicNavigationPrefetches.get(route);
  if (publicNavigationPrefetchesInFlight >= MAX_PUBLIC_NAVIGATION_PREFETCHES) return Promise.resolve(false);

  publicNavigationPrefetchesInFlight += 1;
  const pending = Promise.resolve()
    .then(() => publicNavigationLoaders[route]())
    .then(() => true, () => {
      // Do not retain failed chunks: another deliberate hover/focus can retry.
      publicNavigationPrefetches.delete(route);
      return false;
    })
    .finally(() => { publicNavigationPrefetchesInFlight -= 1; });
  // The explicit five-route allowlist also bounds retained successful entries.
  publicNavigationPrefetches.set(route, pending);
  return pending;
}
