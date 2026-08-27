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
const META_CATALOG_CONTENT_IDS = Object.freeze({
  '69d490ce699b5f1ac4dde495': '43220774813786',
  aura: '43220774813786',
  '69d490ce699b5f1ac4dde496': '43220774846554',
  're-nu': '43220774846554',
  renu: '43220774846554',
  '69d490ce699b5f1ac4dde497': '43220774944858',
  oasis: '43220774944858',
  '69d490ce699b5f1ac4dde498': '43222070198362',
  'the-nuvira-trio': '43222070198362',
  '69d5b9df48ee4ce27d9eb8fa': '43255063445594',
  'orange-juice': '43255063445594',
  '69d5b9df48ee4ce27d9eb8fb': '43222071181402',
  'pineapple-juice': '43222071181402',
  '69d5b9df48ee4ce27d9eb8fc': '43222071115866',
  'watermelon-juice': '43222071115866',
  '69e95a6b3b4d04fb9b9599d5': '43296833044570',
  'radiance-shot': '43296833044570',
  '69e95a6b3b4d04fb9b9599d6': '43296833011802',
  'hydration-shot': '43296833011802',
  '69e95a6b3b4d04fb9b9599d7': '43296833077338',
  'reset-shot': '43296833077338',
  '6a511e652e19910e6f789c2c': '43629081722970',
  'large-nuvira-tote-bag': '43629081722970',
});
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

function catalogLookupKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeMetaCatalogContentId(value) {
  const match = String(value || '').trim().match(/(?:ProductVariant\/)?(\d{10,20})$/);
  return match?.[1] || '';
}

export function metaCatalogContentIdForItem(item = {}) {
  for (const candidate of [
    item.meta_catalog_content_id,
    item.shopify_variant_id,
    item.shopify_pos_variant_id,
  ]) {
    const normalized = normalizeMetaCatalogContentId(candidate);
    if (normalized) return normalized;
  }
  for (const candidate of [item.product_id, item.id, item.slug, item.title, item.name]) {
    const raw = String(candidate || '').trim().toLowerCase();
    const resolved = META_CATALOG_CONTENT_IDS[raw]
      || META_CATALOG_CONTENT_IDS[catalogLookupKey(raw)];
    if (resolved) return resolved;
  }
  return '';
}

function catalogLinesForItem(item) {
  const quantity = Math.max(1, Math.round(Number(item?.quantity) || 1));
  const itemPrice = validMoney(item?.price);
  const directId = metaCatalogContentIdForItem(item);
  if (directId && itemPrice > 0) return [{ id: directId, quantity, item_price: itemPrice }];

  const components = Array.isArray(item?.bundle_composition) ? item.bundle_composition : [];
  const componentQuantity = components.reduce(
    (sum, component) => sum + Math.max(0, Math.round(Number(component?.quantity) || 0)),
    0,
  );
  if (!item?.is_program || componentQuantity <= 0 || itemPrice <= 0) return [];
  const allocatedPrice = validMoney(itemPrice / componentQuantity);
  return components.map((component) => ({
    id: metaCatalogContentIdForItem(component),
    quantity: quantity * Math.max(0, Math.round(Number(component?.quantity) || 0)),
    item_price: allocatedPrice,
  })).filter((component) => component.id && component.quantity > 0);
}

function buildContents(items) {
  return (Array.isArray(items) ? items : []).flatMap(catalogLinesForItem);
}

function itemsValue(items) {
  return Math.round((Array.isArray(items) ? items : []).reduce((sum, item) => (
    sum + (validMoney(item?.price) * Math.max(1, Math.round(Number(item?.quantity) || 1)))
  ), 0) * 100) / 100;
}

function catalogParams(contents) {
  if (!contents.length) return {};
  return {
    content_ids: contents.map((entry) => entry.id),
    contents,
  };
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
  return trackMetaStandardEvent('ViewContent', {
    ...catalogParams(contents),
    content_name: safeLabel(item?.title || item?.name, 'NuVira product'),
    content_category: safeLabel(item?.category, item?.is_program ? 'Juice Program' : 'Juice'),
    content_type: 'product',
    currency: 'USD',
    value: itemsValue([{ ...item, quantity: 1 }]),
  });
}

export function trackMetaAddToCart(item, quantity = 1) {
  const trackedItems = [{ ...item, quantity }];
  const contents = buildContents(trackedItems);
  return trackMetaStandardEvent('AddToCart', {
    ...catalogParams(contents),
    content_type: 'product',
    currency: 'USD',
    value: itemsValue(trackedItems),
  });
}

export function trackMetaInitiateCheckout(items, value) {
  const contents = buildContents(items);
  return trackMetaStandardEvent('InitiateCheckout', {
    ...catalogParams(contents),
    content_type: 'product',
    currency: 'USD',
    num_items: contents.length
      ? contents.reduce((sum, item) => sum + item.quantity, 0)
      : (Array.isArray(items) ? items : []).reduce((sum, item) => sum + Math.max(1, Math.round(Number(item?.quantity) || 1)), 0),
    value: value === undefined ? itemsValue(items) : validMoney(value),
  });
}

export function trackMetaAddPaymentInfo(items, value) {
  const contents = buildContents(items);
  return trackMetaStandardEvent('AddPaymentInfo', {
    ...catalogParams(contents),
    content_type: 'product',
    currency: 'USD',
    value: value === undefined ? itemsValue(items) : validMoney(value),
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
