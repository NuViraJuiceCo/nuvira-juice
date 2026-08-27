import { isNativeAppRuntime } from '@/lib/nativeRuntime';

export const GOOGLE_ANALYTICS_MEASUREMENT_ID = 'G-H8R82365GM';
export const ANALYTICS_CONSENT_STORAGE_KEY = 'nuvira_analytics_consent_v1';
export const ANALYTICS_CONSENT_EVENT = 'nuvira:analytics-consent';

const PURCHASE_STORAGE_PREFIX = 'nuvira_ga4_purchase_v1:';
const GOOGLE_TAG_SCRIPT_ID = 'nuvira-google-analytics';

let googleTagPromise = null;
let googleTagConfigured = false;
let volatileConsent = null;
const volatilePurchaseIds = new Set();

function hasBrowserRuntime() {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function safeStorage() {
  if (!hasBrowserRuntime()) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function prepareDataLayer() {
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };
}

function sendConsentUpdate(value) {
  if (!hasBrowserRuntime()) return;
  prepareDataLayer();
  window.gtag('consent', 'update', {
    analytics_storage: value === 'granted' ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
}

function clearGoogleAnalyticsCookies() {
  if (!hasBrowserRuntime()) return;
  const cookieNames = document.cookie
    .split(';')
    .map((entry) => entry.split('=')[0]?.trim())
    .filter((name) => name === '_ga' || name?.startsWith('_ga_'));

  for (const name of cookieNames) {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=.nuvirajuice.com; SameSite=Lax`;
  }
}

export function getAnalyticsConsent() {
  let value = volatileConsent;
  try {
    value = safeStorage()?.getItem(ANALYTICS_CONSENT_STORAGE_KEY) || volatileConsent;
  } catch {
    // A private browsing or locked-down storage context must fail closed.
  }
  return value === 'granted' || value === 'denied' ? value : null;
}

export function setAnalyticsConsent(value) {
  if (value !== 'granted' && value !== 'denied') return false;
  const storage = safeStorage();
  if (isNativeAppRuntime()) return false;

  volatileConsent = value;
  try {
    storage?.setItem(ANALYTICS_CONSENT_STORAGE_KEY, value);
  } catch {
    // Keep the choice for this page session without enabling tracking early.
  }
  sendConsentUpdate(value);
  if (value === 'denied') clearGoogleAnalyticsCookies();
  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: value }));
  return true;
}

export function resetAnalyticsConsent() {
  const storage = safeStorage();
  if (isNativeAppRuntime()) return false;

  volatileConsent = null;
  try {
    storage?.removeItem(ANALYTICS_CONSENT_STORAGE_KEY);
  } catch {
    // The in-memory choice is still reset for this page session.
  }
  sendConsentUpdate('denied');
  clearGoogleAnalyticsCookies();
  window.dispatchEvent(new CustomEvent(ANALYTICS_CONSENT_EVENT, { detail: 'reset' }));
  return true;
}

export function sanitizeAnalyticsPath(pathname = '/') {
  const path = String(pathname || '/').split('?')[0].split('#')[0] || '/';
  if (/^\/order-tracker\/[^/]+/i.test(path)) return '/order-tracker/:order';
  if (/^\/order-confirmation\/[^/]+/i.test(path)) return '/order-confirmation/:order';
  return path;
}

export function isTrackableAnalyticsPath(pathname = '/') {
  const path = String(pathname || '/').toLowerCase();
  return !path.startsWith('/admin')
    && !path.startsWith('/oauth-consent')
    && !path.startsWith('/_preview');
}

export async function loadGoogleAnalytics() {
  if (!hasBrowserRuntime() || isNativeAppRuntime() || getAnalyticsConsent() !== 'granted') {
    return false;
  }

  prepareDataLayer();
  if (!googleTagConfigured) {
    window.gtag('consent', 'default', {
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
      wait_for_update: 500,
    });
    sendConsentUpdate('granted');
    window.gtag('js', new Date());
    window.gtag('config', GOOGLE_ANALYTICS_MEASUREMENT_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    googleTagConfigured = true;
  }

  if (googleTagPromise) return googleTagPromise;
  const existingScript = document.getElementById(GOOGLE_TAG_SCRIPT_ID);
  if (existingScript?.dataset?.loaded === 'true') return true;

  googleTagPromise = new Promise((resolve) => {
    const script = existingScript || document.createElement('script');
    script.id = GOOGLE_TAG_SCRIPT_ID;
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GOOGLE_ANALYTICS_MEASUREMENT_ID)}`;
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve(true);
    };
    script.onerror = () => {
      script.remove();
      googleTagPromise = null;
      resolve(false);
    };
    if (!existingScript) document.head.appendChild(script);
  });

  return googleTagPromise;
}

export async function trackGooglePageView(pathname, title = '') {
  if (!isTrackableAnalyticsPath(pathname)) return false;
  if (!(await loadGoogleAnalytics())) return false;

  const pagePath = sanitizeAnalyticsPath(pathname);
  window.gtag('event', 'page_view', {
    page_title: String(title || document.title || 'NuVira Juice Co.'),
    page_path: pagePath,
    page_location: `${window.location.origin}${pagePath}`,
  });
  return true;
}

function validMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
}

function buildPurchaseItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      item_id: String(item?.product_id || item?.id || `item-${index + 1}`),
      item_name: String(item?.title || item?.name || 'NuVira product'),
      item_category: String(item?.category || (item?.is_program ? 'Juice Program' : 'Juice')),
      item_variant: String(item?.size || ''),
      price: validMoney(item?.price),
      quantity: Math.max(1, Math.round(Number(item?.quantity) || 1)),
    }))
    .filter((item) => item.price > 0);
}

const GOOGLE_ECOMMERCE_EVENTS = new Set([
  'view_item',
  'add_to_cart',
  'view_cart',
  'begin_checkout',
  'add_shipping_info',
  'add_payment_info',
]);

function safeAnalyticsLabel(value, fallback = '') {
  return String(value || fallback)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 80);
}

function merchandiseValue(items) {
  return Math.round(items.reduce((sum, item) => sum + (item.price * item.quantity), 0) * 100) / 100;
}

export async function trackGoogleEcommerceEvent(eventName, payload = {}) {
  if (!GOOGLE_ECOMMERCE_EVENTS.has(eventName) || getAnalyticsConsent() !== 'granted') return false;

  const items = buildPurchaseItems(payload.items);
  if (!items.length || !(await loadGoogleAnalytics())) return false;

  const params = {
    currency: 'USD',
    value: payload.value === undefined ? merchandiseValue(items) : validMoney(payload.value),
    items,
  };

  const coupon = safeAnalyticsLabel(payload.coupon);
  if (coupon) params.coupon = coupon;
  if (eventName === 'add_shipping_info') {
    params.shipping_tier = safeAnalyticsLabel(payload.shippingTier, 'Local delivery');
  }
  if (eventName === 'add_payment_info') {
    params.payment_type = safeAnalyticsLabel(payload.paymentType, 'Card or wallet');
  }

  window.gtag('event', eventName, params);
  return true;
}

export function trackGoogleViewItem(item) {
  return trackGoogleEcommerceEvent('view_item', { items: [item] });
}

export function trackGoogleAddToCart(item, quantity = 1) {
  return trackGoogleEcommerceEvent('add_to_cart', {
    items: [{ ...item, quantity: Math.max(1, Math.round(Number(quantity) || 1)) }],
  });
}

export function trackGoogleViewCart(items, value) {
  return trackGoogleEcommerceEvent('view_cart', { items, value });
}

export function trackGoogleBeginCheckout(items, value, coupon = '') {
  return trackGoogleEcommerceEvent('begin_checkout', { items, value, coupon });
}

export function trackGoogleAddShippingInfo(items, value, shippingTier = 'Local delivery', coupon = '') {
  return trackGoogleEcommerceEvent('add_shipping_info', { items, value, shippingTier, coupon });
}

export function trackGoogleAddPaymentInfo(items, value, paymentType = 'Card or wallet', coupon = '') {
  return trackGoogleEcommerceEvent('add_payment_info', { items, value, paymentType, coupon });
}

export function isEligibleGooglePurchase(order) {
  if (!order || order.is_test_order === true) return false;
  if (order.deleted_at || order.canceled_at || order.do_not_recover === true) return false;
  if (order.payment_status === 'refunded' || order.financial_status === 'refunded') return false;
  if (order.refund_status === 'fully_refunded') return false;
  const paid = order.payment_captured === true
    || order.payment_status === 'paid'
    || order.financial_status === 'paid';
  return paid && Boolean(String(order.order_number || '').trim()) && validMoney(order.total) > 0;
}

export async function trackGooglePurchase(order) {
  if (!isEligibleGooglePurchase(order) || getAnalyticsConsent() !== 'granted') return false;

  const transactionId = String(order.order_number).trim();
  const storage = safeStorage();
  const storageKey = `${PURCHASE_STORAGE_PREFIX}${transactionId}`;
  if (volatilePurchaseIds.has(transactionId)) return false;
  try {
    if (storage?.getItem(storageKey) === '1') return false;
  } catch {
    // GA4 also deduplicates repeated purchases by transaction_id.
  }
  if (!(await loadGoogleAnalytics())) return false;

  const shipping = validMoney(order.delivery_fee);
  const total = validMoney(order.total);
  const value = Math.max(0, Math.round((total - shipping) * 100) / 100);
  const coupon = String(order.discount_codes?.[0] || order.promotion_code || order.referral_code || '').trim();
  const items = buildPurchaseItems(order.items);
  if (!items.length) return false;

  window.gtag('event', 'purchase', {
    transaction_id: transactionId,
    currency: 'USD',
    value,
    shipping,
    coupon: coupon || undefined,
    items,
  });
  volatilePurchaseIds.add(transactionId);
  try {
    storage?.setItem(storageKey, '1');
  } catch {
    // Tracking succeeded; storage failure must not surface to the customer.
  }
  return true;
}
