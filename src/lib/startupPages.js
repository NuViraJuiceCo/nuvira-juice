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
