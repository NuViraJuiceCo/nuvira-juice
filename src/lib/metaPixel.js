import { isNativeAppRuntime } from '@/lib/nativeRuntime';

export const META_PIXEL_ID = '719023677458304';
export const MARKETING_CONSENT_STORAGE_KEY = 'nuvira_marketing_consent_v1';
export const MARKETING_CONSENT_EVENT = 'nuvira:marketing-consent';

const META_PIXEL_SCRIPT_ID = 'nuvira-meta-pixel';
const META_REGISTRATION_STORAGE_KEY = 'nuvira_meta_registration_event_v1';
const META_REGISTRATION_TTL_MS = 10 * 60 * 1000;
const META_FUNNEL_EVENTS = new Set(['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo']);
const META_LIVE_ORIGINS = new Set(['https://nuvirajuice.com', 'https://www.nuvirajuice.com']);
const META_STANDARD_EVENTS = new Set([
  'PageView',
  'ViewContent',
  'Search',
  'AddToCart',
  'InitiateCheckout',
  'AddPaymentInfo',
  'CompleteRegistration',
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
const META_BROWSER_ID_PATTERN = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9._-]{1,220}$/;

let volatileConsent = null;
let metaScriptPromise = null;
let metaInitialized = false;
let consentRevision = 0;

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

function safeText(value, maxLength = 500) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
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

function readCookie(name) {
  if (!hasBrowserRuntime()) return '';
  const prefix = `${name}=`;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) || '';
}

function normalizeMetaBrowserId(value) {
  let normalized = '';
  try {
    normalized = decodeURIComponent(String(value || '').trim());
  } catch {
    normalized = String(value || '').trim();
  }
  return META_BROWSER_ID_PATTERN.test(normalized) ? normalized : '';
}

function deriveFbcFromCurrentUrl() {
  if (!hasBrowserRuntime()) return '';
  try {
    const fbclid = new URL(window.location.href).searchParams.get('fbclid');
    if (!fbclid || !/^[A-Za-z0-9._-]{8,220}$/.test(fbclid)) return '';
    return `fb.1.${Date.now()}.${fbclid}`;
  } catch {
    return '';
  }
}

function persistMetaAttribution() {
  if (!META_LIVE_ORIGINS.has(window.location.origin)) return;
  const setCookie = (name, value) => {
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=7776000; path=/; domain=.nuvirajuice.com; SameSite=Lax; Secure`;
  };
  try {
    const currentFbc = normalizeMetaBrowserId(readCookie('_fbc'));
    const incomingFbc = deriveFbcFromCurrentUrl();
    if (incomingFbc && incomingFbc.split('.').slice(3).join('.') !== currentFbc.split('.').slice(3).join('.')) {
      setCookie('_fbc', incomingFbc);
    }
    if (!normalizeMetaBrowserId(readCookie('_fbp')) && globalThis.crypto?.getRandomValues) {
      const random = crypto.getRandomValues(new Uint32Array(1))[0];
      setCookie('_fbp', `fb.1.${Date.now()}.${random}`);
    }
  } catch {
    // Cookie restrictions must not interrupt shopping.
  }
}

function safeCurrentEventSourceUrl() {
  if (!hasBrowserRuntime()) return 'https://nuvirajuice.com/checkout';
  try {
    const url = new URL(window.location.href);
    if (!['https:', 'http:'].includes(url.protocol)) return 'https://nuvirajuice.com/checkout';
    [...url.searchParams.keys()].forEach((key) => {
      if (SENSITIVE_QUERY_KEYS.test(key) || key.toLowerCase() === 'fbclid') url.searchParams.delete(key);
    });
    url.hash = '';
    return url.toString().slice(0, 500);
  } catch {
    return 'https://nuvirajuice.com/checkout';
  }
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
  consentRevision += 1;
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
  consentRevision += 1;
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

export function getMetaCapiAttributionContext() {
  if (!hasBrowserRuntime() || isNativeAppRuntime() || getMarketingConsent() !== 'granted') return null;

  persistMetaAttribution();

  const context = {
    event_source_url: safeCurrentEventSourceUrl(),
    client_user_agent: safeText(window.navigator?.userAgent, 500),
    captured_at: new Date().toISOString(),
  };

  const fbp = normalizeMetaBrowserId(readCookie('_fbp'));
  const fbc = normalizeMetaBrowserId(readCookie('_fbc')) || normalizeMetaBrowserId(deriveFbcFromCurrentUrl());
  if (fbp) context.fbp = fbp;
  if (fbc) context.fbc = fbc;

  return context.fbp || context.fbc || context.client_user_agent ? context : null;
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
    const timeout = globalThis.setTimeout?.(() => {
      script.remove();
      metaScriptPromise = null;
      resolve(false);
    }, 5000);
    script.id = META_PIXEL_SCRIPT_ID;
    script.async = true;
    script.src = 'https://connect.facebook.net/en_US/fbevents.js';
    script.onload = () => {
      globalThis.clearTimeout?.(timeout);
      script.dataset.loaded = 'true';
      resolve(true);
    };
    script.onerror = () => {
      globalThis.clearTimeout?.(timeout);
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
    || !hasBrowserRuntime()
    || isNativeAppRuntime()
    || !isSafeMarketingEventContext()) {
    return false;
  }

  const sharedEventId = eventId(eventName);
  const revision = consentRevision;
  const attribution = getMetaCapiAttributionContext();
  let serverDelivery = Promise.resolve(false);
  // Start server delivery independently of the pixel script's availability.
  if (META_FUNNEL_EVENTS.has(eventName) && META_LIVE_ORIGINS.has(window.location.origin)) {
    const payload = {
      event_name: eventName,
      event_id: sharedEventId,
      event_time: Math.floor(Date.now() / 1000),
      marketing_measurement_consent: 'granted',
      attribution,
      custom_data: params,
    };
    serverDelivery = import('./metaFunnelTransport.js').then(({ sendMetaFunnelEvent }) => {
      if (revision !== consentRevision || getMarketingConsent() !== 'granted' || !isSafeMarketingEventContext() || isNativeAppRuntime()) return false;
      return sendMetaFunnelEvent(payload);
    }).catch(() => false);
  }

  const pixelLoaded = await loadMetaPixel();
  if (revision !== consentRevision || getMarketingConsent() !== 'granted' || !isSafeMarketingEventContext()) return false;
  if (!pixelLoaded) return serverDelivery;
  window.fbq('track', eventName, params, { eventID: sharedEventId });
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

export function prepareMetaRegistrationEvent(method = 'email') {
  if (!hasBrowserRuntime() || isNativeAppRuntime()) return false;
  const storage = safeSessionStorage();
  if (!storage) return false;
  try {
    storage.setItem(META_REGISTRATION_STORAGE_KEY, JSON.stringify({
      method: safeLabel(method, 'unknown'),
      createdAt: Date.now(),
    }));
    return true;
  } catch {
    return false;
  }
}

export function trackMetaCompleteRegistration(method = 'email') {
  return trackMetaStandardEvent('CompleteRegistration', {
    content_name: 'NuVira account',
    registration_method: safeLabel(method, 'unknown'),
    status: 'completed',
  });
}

export async function consumeMetaRegistrationEvent() {
  if (!hasBrowserRuntime() || isNativeAppRuntime()) return false;
  const storage = safeSessionStorage();
  if (!storage) return false;

  let pending = null;
  try {
    pending = JSON.parse(storage.getItem(META_REGISTRATION_STORAGE_KEY) || 'null');
    storage.removeItem(META_REGISTRATION_STORAGE_KEY);
  } catch {
    return false;
  }

  const ageMs = Date.now() - Number(pending?.createdAt || 0);
  if (!pending || ageMs < 0 || ageMs > META_REGISTRATION_TTL_MS) return false;
  return trackMetaCompleteRegistration(pending.method);
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
