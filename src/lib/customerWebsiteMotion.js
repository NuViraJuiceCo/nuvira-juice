import { canRenderPublicStorefront, hasStartupAuthParams } from './publicStorefrontStartup.js';

const CUSTOMER_LAYOUT_ROUTES = new Set([
  '/account', '/account/orders', '/account/programs', '/account/settings', '/account/subscriptions',
  '/notifications', '/rewards', '/return-reward', '/cart', '/delete-account', '/referral',
  '/partner', '/book-event',
]);

// Presentation only, after App's existing auth/onboarding gates. Never use this
// policy to enable a query, bypass authorization, or render a protected route early.
export function usesImmediateCustomerWebsiteLayout(options = {}) {
  const { pathname = '', search = '', hash = '', isNative, startedWithAuthReturn = false } = options;
  if (isNative !== false || startedWithAuthReturn || hasStartupAuthParams(search, hash)) return false;
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.startsWith('//')) return false;
  if (canRenderPublicStorefront(options)) return true;
  const path = pathname.toLowerCase().replace(/\/+$/, '') || '/';
  return CUSTOMER_LAYOUT_ROUTES.has(path) || /^\/(?:account\/programs|cart)\/[^/]+$/.test(path);
}

// Immediate website content also honors reduced-motion preferences without a
// media-query/hydration delay. Native keeps its exact existing animation props.
export function customerWebsiteMotionOverrides(isNative) {
  return isNative === false ? { initial: false, transition: { duration: 0, delay: 0 } } : {};
}
