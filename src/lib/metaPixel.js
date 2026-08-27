import { isNativeAppRuntime } from '@/lib/nativeRuntime';

export const META_PIXEL_ID = '719023677458304';
export const MARKETING_CONSENT_STORAGE_KEY = 'nuvira_marketing_consent_v1';
export const MARKETING_CONSENT_EVENT = 'nuvira:marketing-consent';

const META_PIXEL_SCRIPT_ID = 'nuvira-meta-pixel';
const META_STANDARD_EVENTS = new Set([
  'PageView',
  'ViewContent',
  'Search',
  'AddToCart',
  'InitiateCheckout',
  'AddPaymentInfo',
  'Lead',
]);
const SENSITIVE_QUERY_KEYS = /^(?:session_id|payment_intent|payment_intent_client_secret|token|secret|code|email|order_number)$/i;
const PAGE_VIEW_BLOCKED_PREFIXES = [
  '/admin',
  '/account',
  '/checkout',
  '/login',
  '/register',
  '/oauth-consent',
  '/order-confirmation',
  '/order-options',
  '/order-tracker',
  '/_preview',
];

let volatileConsent = null;
let metaScriptPromise = null;
let metaInitialized = false;

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

function prepareMetaQueue() {
  if (window.fbq) return;
  const queue = function fbq() {
    queue.callMethod ? queue.callMethod.apply(queue, arguments) : queue.queue.push(arguments);
  };
  queue.push = queue;
  queue.loaded = true;
  queue.version = '2.0';
  queue.queue = [];
  window.fbq = queue;
  window._fbq = queue;
}

function clearMetaCookies() {
  if (!hasBrowserRuntime()) return;
  for (const name of ['_fbp', '_fbc']) {
    document.cookie = `${name}=; Max-Age=0; path=/; SameSite=Lax`;
    document.cookie = `${name}=; Max-Age=0; path=/; domain=.nuvirajuice.com; SameSite=Lax`;
  }
}

function hasSensitiveQuery(search = '') {
  const params = new URLSearchParams(String(search || ''));
  return [...params.keys()].some((key) => SENSITIVE_QUERY_KEYS.test(key));
}

function validMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
}

function safeLabel(value, fallback = '') {
  return String(value || fallback)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 80);
}

function buildContents(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: safeLabel(item?.product_id || item?.id, `item-${index + 1}`),
      quantity: Math.max(1, Math.round(Number(item?.quantity) || 1)),
      item_price: validMoney(item?.price),
    }))
    .filter((item) => item.id && item.item_price > 0);
}

function contentsValue(contents) {
  return Math.round(contents.reduce((sum, item) => sum + (item.item_price * item.quantity), 0) * 100) / 100;
}

function eventId(eventName) {
  const unique = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `web:${eventName}:${unique}`;
}

export function getMarketingConsent() {
  let value = volatileConsent;
  try {
    value = safeStorage()?.getItem(MARKETING_CONSENT_STORAGE_KEY) || volatileConsent;
  } catch {
    // Locked-down storage must fail closed.
  }
  return value === 'granted' || value === 'denied' ? value : null;
}

export function setMarketingConsent(value) {
  if (value !== 'granted' && value !== 'denied') return false;
  if (!hasBrowserRuntime() || isNativeAppRuntime()) return false;

  volatileConsent = value;
  try {
    safeStorage()?.setItem(MARKETING_CONSENT_STORAGE_KEY, value);
  } catch {
    // Preserve the choice for this page session without enabling early.
  }
  if (window.fbq) window.fbq('consent', value === 'granted' ? 'grant' : 'revoke');
  if (value === 'denied') clearMetaCookies();
  window.dispatchEvent(new CustomEvent(MARKETING_CONSENT_EVENT, { detail: value }));
  return true;
}

export function resetMarketingConsent() {
  if (!hasBrowserRuntime() || isNativeAppRuntime()) return false;
  volatileConsent = null;
  try {
    safeStorage()?.removeItem(MARKETING_CONSENT_STORAGE_KEY);
  } catch {
    // The in-memory choice is still reset for this page session.
  }
  if (window.fbq) window.fbq('consent', 'revoke');
  clearMetaCookies();
  window.dispatchEvent(new CustomEvent(MARKETING_CONSENT_EVENT, { detail: 'reset' }));
  return true;
}

export function isSafeMarketingEventContext() {
  if (!hasBrowserRuntime()) return false;
  return !hasSensitiveQuery(window.location.search);
}

export function isTrackableMarketingPageView(pathname = '/') {
  const path = String(pathname || '/').toLowerCase();
  return isSafeMarketingEventContext()
    && !PAGE_VIEW_BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export async function loadMetaPixel() {
  if (!hasBrowserRuntime()
    || isNativeAppRuntime()
    || getMarketingConsent() !== 'granted'
    || !isSafeMarketingEventContext()) {
    return false;
  }

  prepareMetaQueue();
  if (!metaInitialized) {
    window.fbq('consent', 'grant');
    window.fbq('init', META_PIXEL_ID);
    metaInitialized = true;
  }

  if (metaScriptPromise) return metaScriptPromise;
  const existingScript = document.getElementById(META_PIXEL_SCRIPT_ID);
  if (existingScript?.dataset?.loaded === 'true') return true;

  metaScriptPromise = new Promise((resolve) => {
    const script = existingScript || document.createElement('script');
    script.id = META_PIXEL_SCRIPT_ID;
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve(true);
    };
    script.onerror = () => {
      script.remove();
      metaScriptPromise = null;
      resolve(false);
    };
    if (!existingScript) document.head.appendChild(script);
  });

  return metaScriptPromise;
}

export async function trackMetaStandardEvent(eventName, params = {}) {
  if (!META_STANDARD_EVENTS.has(eventName)
    || getMarketingConsent() !== 'granted'
    || !(await loadMetaPixel())) {
    return false;
  }

  window.fbq('track', eventName, params, { eventID: eventId(eventName) });
  return true;
}

export function trackMetaPageView(pathname = '/') {
  if (!isTrackableMarketingPageView(pathname)) return Promise.resolve(false);
  return trackMetaStandardEvent('PageView');
}

export function trackMetaViewContent(item) {
  const contents = buildContents([{ ...item, quantity: 1 }]);
  if (!contents.length) return Promise.resolve(false);
  return trackMetaStandardEvent('ViewContent', {
    content_ids: contents.map((entry) => entry.id),
    contents,
    content_name: safeLabel(item?.title || item?.name, 'NuVira product'),
    content_category: safeLabel(item?.category, item?.is_program ? 'Juice Program' : 'Juice'),
    content_type: 'product',
    currency: 'USD',
    value: contentsValue(contents),
  });
}

export function trackMetaAddToCart(item, quantity = 1) {
  const contents = buildContents([{ ...item, quantity }]);
  if (!contents.length) return Promise.resolve(false);
  return trackMetaStandardEvent('AddToCart', {
    content_ids: contents.map((entry) => entry.id),
    contents,
    content_type: 'product',
    currency: 'USD',
    value: contentsValue(contents),
  });
}

export function trackMetaInitiateCheckout(items, value) {
  const contents = buildContents(items);
  if (!contents.length) return Promise.resolve(false);
  return trackMetaStandardEvent('InitiateCheckout', {
    content_ids: contents.map((entry) => entry.id),
    contents,
    content_type: 'product',
    currency: 'USD',
    num_items: contents.reduce((sum, item) => sum + item.quantity, 0),
    value: value === undefined ? contentsValue(contents) : validMoney(value),
  });
}

export function trackMetaAddPaymentInfo(items, value) {
  const contents = buildContents(items);
  if (!contents.length) return Promise.resolve(false);
  return trackMetaStandardEvent('AddPaymentInfo', {
    content_ids: contents.map((entry) => entry.id),
    contents,
    content_type: 'product',
    currency: 'USD',
    value: value === undefined ? contentsValue(contents) : validMoney(value),
  });
}

export function sanitizeMetaSearchTerm(value) {
  const term = safeLabel(value);
  if (term.length < 2) return '';
  if (/\S+@\S+\.\S+/.test(term)) return '';
  if (/(?:\+?\d[\s().-]*){7,}/.test(term)) return '';
  return term;
}

export function trackMetaSearch(searchTerm) {
  const term = sanitizeMetaSearchTerm(searchTerm);
  if (!term) return Promise.resolve(false);
  return trackMetaStandardEvent('Search', { search_string: term });
}

export function trackMetaLead(leadType = 'customer_inquiry') {
  const source = safeLabel(leadType, 'customer_inquiry');
  if (!source) return Promise.resolve(false);
  return trackMetaStandardEvent('Lead', { content_name: source });
}
