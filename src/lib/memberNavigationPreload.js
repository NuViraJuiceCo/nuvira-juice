// A deliberate desktop hover/focus can warm page CODE, never account data.
// These imports do not mount components or run their query/mutation hooks.
const memberPageLoaders = Object.freeze({
  '/account': () => import('@/pages/Account'),
  '/rewards': () => import('@/pages/Rewards'),
});
const prefetched = new Map();
let inFlight = false;

export function isMemberNavigationPreloadRoute(route) {
  return typeof route === 'string' && Object.hasOwn(memberPageLoaders, route);
}

export function preloadMemberNavigation(route, {
  isNative = true, isAdmin = true, isAuthenticated = false,
} = {}) {
  // Exact paths only. Never follow external, callback, nested, or admin targets.
  // Check context even for cached entries; import success grants no route access.
  if (typeof window === 'undefined' || isNative !== false || isAdmin !== false ||
      isAuthenticated !== true || !isMemberNavigationPreloadRoute(route)) return Promise.resolve(false);
  if (prefetched.has(route)) return prefetched.get(route);
  // One speculative member chunk at a time, in addition to the existing bounded
  // public-code warmup. No eager imports, timers, data prefetch, or storage.
  if (inFlight) return Promise.resolve(false);
  inFlight = true;
  const pending = Promise.resolve()
    .then(() => memberPageLoaders[route]())
    .then(() => true, () => {
      prefetched.delete(route);
      return false;
    })
    .finally(() => { inFlight = false; });
  prefetched.set(route, pending);
  return pending;
}
