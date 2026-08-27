import { isNativeAppRuntime } from '@/lib/nativeRuntime';

export const GOOGLE_ANALYTICS_MEASUREMENT_ID = 'G-H8R82365GM';
export const ANALYTICS_CONSENT_STORAGE_KEY = 'nuvira_analytics_consent_v1';
export const ANALYTICS_CONSENT_EVENT = 'nuvira:analytics-consent';

const PURCHASE_STORAGE_PREFIX = 'nuvira_ga4_purchase_v1:';
const GOOGLE_TAG_SCRIPT_ID = 'nuvira-google-analytics';
const GOOGLE_AUTH_EVENT_PARAM = 'nuvira_auth_event';
const GOOGLE_AUTH_EVENT_STORAGE_KEY = 'nuvira_ga4_auth_event_v1';
const GOOGLE_AUTH_EVENT_TTL_MS = 10 * 60 * 1000;
const CAMPAIGN_QUERY_KEYS = [
  'utm_id',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'gclid',
  'dclid',
  'gbraid',
  'wbraid',
  'gad_source',
  'gad_campaignid',
  'fbclid',
  'ttclid',
  'msclkid',
  'srsltid',
];

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

function safeSessionStorage() {
  if (!hasBrowserRuntime()) return null;
  try {
    return window.sessionStorage;
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

function sanitizeCampaignValue(value) {
  const sanitized = String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 200);
  if (!sanitized) return '';
  if (/\S+@\S+\.\S+/.test(sanitized)) return '';
  if (/(?:\+?\d[\s().-]*){7,}/.test(sanitized)) return '';
  return sanitized;
}

export function buildAnalyticsPageLocation(pathname = '/', search = '') {
  const pagePath = sanitizeAnalyticsPath(pathname);
  if (!hasBrowserRuntime()) return pagePath;

  const sourceParams = new URLSearchParams(String(search || ''));
  const campaignParams = new URLSearchParams();
  for (const key of CAMPAIGN_QUERY_KEYS) {
    const value = sanitizeCampaignValue(sourceParams.get(key));
    if (value) campaignParams.set(key, value);
  }

  const campaignQuery = campaignParams.toString();
  return `${window.location.origin}${pagePath}${campaignQuery ? `?${campaignQuery}` : ''}`;
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
    page_location: buildAnalyticsPageLocation(pathname, window.location.search),
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
  'view_item_list',
  'select_item',
  'view_item',
  'add_to_cart',
  'remove_from_cart',
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

function trackGoogleLifecycleEvent(eventName, params = {}) {
  if (!hasBrowserRuntime() || isNativeAppRuntime() || getAnalyticsConsent() !== 'granted') {
    return false;
  }

  // gtag queues commands in dataLayer, so auth redirects do not need to wait
  // for the network script before leaving the page.
  void loadGoogleAnalytics();
  prepareDataLayer();
  window.gtag('event', eventName, params);
  return true;
}

export function trackGoogleLogin(method = 'email') {
  return trackGoogleLifecycleEvent('login', {
    method: safeAnalyticsLabel(method, 'unknown'),
  });
}

export function trackGoogleSignUp(method = 'email') {
  return trackGoogleLifecycleEvent('sign_up', {
    method: safeAnalyticsLabel(method, 'unknown'),
  });
}

export function trackGoogleProfileComplete(source = 'account_setup') {
  return trackGoogleLifecycleEvent('profile_complete', {
    profile_source: safeAnalyticsLabel(source, 'account_setup'),
  });
}

export function trackGoogleShare(method = 'native_share', contentType = 'referral', itemId = 'nuvira_referral') {
  return trackGoogleLifecycleEvent('share', {
    method: safeAnalyticsLabel(method, 'unknown'),
    content_type: safeAnalyticsLabel(contentType, 'referral'),
    item_id: safeAnalyticsLabel(itemId, 'nuvira_referral'),
  });
}

function createAuthEventToken() {
  try {
    return globalThis.crypto?.randomUUID?.() || '';
  } catch {
    return '';
  }
}

export function prepareGoogleProviderAuthRedirect(returnTo = '/', intendedEvent = 'login', method = 'google') {
  if (!hasBrowserRuntime() || isNativeAppRuntime()) return returnTo;
  if (intendedEvent !== 'login' && intendedEvent !== 'sign_up') return returnTo;

  const storage = safeSessionStorage();
  const token = createAuthEventToken();
  if (!storage || !token) return returnTo;

  try {
    const url = new URL(String(returnTo || '/'), window.location.origin);
    if (url.origin !== window.location.origin) return '/';
    storage.setItem(GOOGLE_AUTH_EVENT_STORAGE_KEY, JSON.stringify({
      token,
      intendedEvent,
      method: safeAnalyticsLabel(method, 'google'),
      createdAt: Date.now(),
    }));
    url.searchParams.set(GOOGLE_AUTH_EVENT_PARAM, token);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return returnTo;
  }
}

export function captureGoogleProviderAuthEvent() {
  if (!hasBrowserRuntime() || isNativeAppRuntime()) return null;

  const token = new URL(window.location.href).searchParams.get(GOOGLE_AUTH_EVENT_PARAM);
  const storage = safeSessionStorage();
  if (!token || !storage) return null;

  try {
    const stored = JSON.parse(storage.getItem(GOOGLE_AUTH_EVENT_STORAGE_KEY) || 'null');
    if (!stored || stored.token !== token) {
      clearGoogleProviderAuthEvent({ token });
      return null;
    }
    const ageMs = Date.now() - Number(stored.createdAt || 0);
    if (ageMs < 0 || ageMs > GOOGLE_AUTH_EVENT_TTL_MS) {
      clearGoogleProviderAuthEvent({ token });
      return null;
    }

    const providerOutcome = new URL(window.location.href).searchParams.get('is_new_user');
    const eventName = providerOutcome === 'true'
      ? 'sign_up'
      : providerOutcome === 'false'
        ? 'login'
        : stored.intendedEvent;
    return {
      token,
      eventName,
      method: safeAnalyticsLabel(stored.method, 'google'),
    };
  } catch {
    clearGoogleProviderAuthEvent({ token });
    return null;
  }
}

function clearGoogleProviderAuthEvent(capturedEvent = null) {
  if (!hasBrowserRuntime()) return;
  const storage = safeSessionStorage();
  try {
    storage?.removeItem(GOOGLE_AUTH_EVENT_STORAGE_KEY);
  } catch {
    // Cleanup is best effort and must not affect authentication.
  }

  try {
    const url = new URL(window.location.href);
    if (!capturedEvent?.token || url.searchParams.get(GOOGLE_AUTH_EVENT_PARAM) === capturedEvent.token) {
      url.searchParams.delete(GOOGLE_AUTH_EVENT_PARAM);
      window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
    }
  } catch {
    // URL cleanup is best effort and must not affect authentication.
  }
}

export function completeGoogleProviderAuthEvent(capturedEvent) {
  if (!capturedEvent?.token) return false;
  clearGoogleProviderAuthEvent(capturedEvent);
  if (capturedEvent.eventName === 'sign_up') return trackGoogleSignUp(capturedEvent.method);
  if (capturedEvent.eventName === 'login') return trackGoogleLogin(capturedEvent.method);
  return false;
}

export function discardGoogleProviderAuthEvent(capturedEvent) {
  if (!capturedEvent?.token) return false;
  clearGoogleProviderAuthEvent(capturedEvent);
  return true;
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
  const itemListId = safeAnalyticsLabel(payload.itemListId);
  const itemListName = safeAnalyticsLabel(payload.itemListName);
  if (itemListId) params.item_list_id = itemListId;
  if (itemListName) params.item_list_name = itemListName;
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

export function trackGoogleViewItemList(items, itemListId = 'shop', itemListName = 'Shop') {
  return trackGoogleEcommerceEvent('view_item_list', { items, itemListId, itemListName });
}

export function trackGoogleSelectItem(item, itemListId = 'shop', itemListName = 'Shop') {
  return trackGoogleEcommerceEvent('select_item', { items: [item], itemListId, itemListName });
}

export function trackGoogleAddToCart(item, quantity = 1) {
  return trackGoogleEcommerceEvent('add_to_cart', {
    items: [{ ...item, quantity: Math.max(1, Math.round(Number(quantity) || 1)) }],
  });
}

export function trackGoogleRemoveFromCart(item, quantity = 1) {
  return trackGoogleEcommerceEvent('remove_from_cart', {
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

export function sanitizeSearchTerm(value) {
  const term = safeAnalyticsLabel(value);
  if (term.length < 2) return '';
  if (/\S+@\S+\.\S+/.test(term)) return '';
  if (/(?:\+?\d[\s().-]*){7,}/.test(term)) return '';
  return term;
}

export async function trackGoogleSearch(searchTerm) {
  const term = sanitizeSearchTerm(searchTerm);
  if (!term || getAnalyticsConsent() !== 'granted' || !(await loadGoogleAnalytics())) return false;
  window.gtag('event', 'search', { search_term: term });
  return true;
}

export async function trackGoogleGenerateLead(leadType = 'customer_inquiry') {
  const source = safeAnalyticsLabel(leadType, 'customer_inquiry');
  if (!source || getAnalyticsConsent() !== 'granted' || !(await loadGoogleAnalytics())) return false;
  window.gtag('event', 'generate_lead', { lead_source: source });
  return true;
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
