import { isNativeAppRuntime } from '@/lib/nativeRuntime';
import {
  getMarketingConsent,
  isSafeMarketingEventContext,
  isTrackableMarketingPageView,
  metaCatalogContentIdForItem,
  sanitizeMetaSearchTerm,
} from '@/lib/metaPixel';

export const SNAP_PIXEL_ID = '5e7242b6-e772-4e2d-bfc9-32e995f95c10';

const SNAP_PIXEL_SCRIPT_ID = 'nuvira-snap-pixel';
const SNAP_PURCHASE_STORAGE_PREFIX = 'nuvira_snap_purchase_v1:';
const SNAP_REGISTRATION_STORAGE_KEY = 'nuvira_snap_registration_event_v1';
const SNAP_REGISTRATION_TTL_MS = 10 * 60 * 1000;
const SNAP_STANDARD_EVENTS = new Set([
  'PAGE_VIEW',
  'VIEW_CONTENT',
  'SEARCH',
  'ADD_CART',
  'START_CHECKOUT',
  'ADD_BILLING',
  'SIGN_UP',
  'PURCHASE',
  'CUSTOM_EVENT_1',
]);

let snapScriptPromise = null;
let snapInitialized = false;
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

function safeLabel(value, fallback = '') {
  return String(value || fallback)
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, 100);
}

function validMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
}

function eventId(eventName) {
  const unique = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `web:${eventName}:${unique}`;
}

function registrationMethod(value) {
  const method = String(value || '').trim().toLowerCase();
  return new Set(['email', 'google', 'apple']).has(method) ? method : 'unknown';
}

function canTrackSnapEvent() {
  return hasBrowserRuntime()
    && !isNativeAppRuntime()
    && getMarketingConsent() === 'granted'
    && isSafeMarketingEventContext();
}

function prepareSnapQueue() {
  if (window.snaptr) return;
  window.snaptr = function snaptr() {
    window.snaptr.handleRequest
      ? window.snaptr.handleRequest.apply(window.snaptr, arguments)
      : window.snaptr.queue.push(arguments);
  };
  window.snaptr.queue = [];
}

export async function loadSnapPixel() {
  if (!canTrackSnapEvent()) return false;

  prepareSnapQueue();
  if (!snapInitialized) {
    window.snaptr('init', SNAP_PIXEL_ID);
    snapInitialized = true;
  }

  if (snapScriptPromise) return snapScriptPromise;
  const existingScript = document.getElementById(SNAP_PIXEL_SCRIPT_ID);
  if (existingScript?.dataset?.loaded === 'true') return true;

  snapScriptPromise = new Promise((resolve) => {
    const script = existingScript || document.createElement('script');
    script.id = SNAP_PIXEL_SCRIPT_ID;
    script.async = true;
    script.src = 'https://sc-static.net/scevent.min.js';
    script.onload = () => {
      script.dataset.loaded = 'true';
      resolve(true);
    };
    script.onerror = () => {
      script.remove();
      snapScriptPromise = null;
      resolve(false);
    };
    if (!existingScript) document.head.appendChild(script);
  });

  return snapScriptPromise;
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

function buildCatalogParams(items) {
  const safeItems = Array.isArray(items) ? items : [];
  const contents = safeItems.flatMap(catalogLinesForItem);
  const numberItems = contents.length
    ? contents.reduce((sum, item) => sum + item.quantity, 0)
    : safeItems.reduce((sum, item) => sum + Math.max(1, Math.round(Number(item?.quantity) || 1)), 0);
  const subtotal = safeItems.reduce((sum, item) => {
    const quantity = Math.max(1, Math.round(Number(item?.quantity) || 1));
    return sum + validMoney(item?.price) * quantity;
  }, 0);

  return {
    price: validMoney(subtotal),
    currency: 'USD',
    item_ids: contents.map((item) => item.id),
    number_items: numberItems,
  };
}

async function trackSnapStandardEvent(eventName, params = {}, dedupId = '') {
  if (!SNAP_STANDARD_EVENTS.has(eventName) || !(await loadSnapPixel())) return false;

  const cleanParams = Object.fromEntries(
    Object.entries({
      ...params,
      client_dedup_id: safeLabel(dedupId) || eventId(eventName),
    }).filter(([, value]) => {
      if (value === undefined || value === null || value === '') return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  );
  window.snaptr('track', eventName, cleanParams);
  return true;
}

export function trackSnapPageView(pathname = '/') {
  if (!isTrackableMarketingPageView(pathname)) return Promise.resolve(false);
  return trackSnapStandardEvent('PAGE_VIEW', {
    item_category: safeLabel(String(pathname || '/').split('/').filter(Boolean)[0] || 'home'),
  });
}

export function trackSnapViewContent(item) {
  return trackSnapStandardEvent('VIEW_CONTENT', {
    ...buildCatalogParams([{ ...item, quantity: 1 }]),
    item_category: safeLabel(item?.category, item?.is_program ? 'Juice Program' : 'Juice'),
  });
}

export function trackSnapSearch(searchTerm) {
  const term = sanitizeMetaSearchTerm(searchTerm).toLowerCase();
  if (!term) return Promise.resolve(false);
  return trackSnapStandardEvent('SEARCH', { search_string: term });
}

export function trackSnapAddToCart(item, quantity = 1) {
  return trackSnapStandardEvent('ADD_CART', buildCatalogParams([{ ...item, quantity }]));
}

export function trackSnapStartCheckout(items, value) {
  const catalog = buildCatalogParams(items);
  return trackSnapStandardEvent('START_CHECKOUT', {
    ...catalog,
    price: value === undefined ? catalog.price : validMoney(value),
  });
}

export function trackSnapAddBilling(items, value) {
  const catalog = buildCatalogParams(items);
  return trackSnapStandardEvent('ADD_BILLING', {
    ...catalog,
    price: value === undefined ? catalog.price : validMoney(value),
  });
}

export function trackSnapLead(leadType = 'customer_inquiry') {
  return trackSnapStandardEvent('CUSTOM_EVENT_1', {
    event_tag: 'lead',
    item_category: safeLabel(leadType, 'customer_inquiry'),
  });
}

export function trackSnapSignUp(method = 'email', dedupId = '') {
  return trackSnapStandardEvent('SIGN_UP', {
    sign_up_method: registrationMethod(method),
  }, dedupId);
}

export function prepareSnapRegistrationEvent(method = 'email') {
  if (!hasBrowserRuntime() || isNativeAppRuntime()) return false;
  const storage = safeSessionStorage();
  if (!storage) return false;
  try {
    storage.setItem(SNAP_REGISTRATION_STORAGE_KEY, JSON.stringify({
      method: registrationMethod(method),
      createdAt: Date.now(),
      dedupId: eventId('SIGN_UP'),
    }));
    return true;
  } catch {
    return false;
  }
}

export async function consumeSnapRegistrationEvent() {
  if (!hasBrowserRuntime() || isNativeAppRuntime()) return false;
  const storage = safeSessionStorage();
  if (!storage) return false;

  let pending = null;
  try {
    pending = JSON.parse(storage.getItem(SNAP_REGISTRATION_STORAGE_KEY) || 'null');
    storage.removeItem(SNAP_REGISTRATION_STORAGE_KEY);
  } catch {
    return false;
  }

  const ageMs = Date.now() - Number(pending?.createdAt || 0);
  if (!pending || ageMs < 0 || ageMs > SNAP_REGISTRATION_TTL_MS) return false;
  return trackSnapSignUp(pending.method, pending.dedupId);
}

function isEligibleSnapPurchase(order) {
  if (!order || order.is_test_order === true) return false;
  if (order.deleted_at || order.canceled_at || order.do_not_recover === true) return false;
  if (order.payment_status === 'refunded' || order.financial_status === 'refunded') return false;
  if (order.refund_status === 'fully_refunded') return false;
  const paid = order.payment_captured === true
    || order.payment_status === 'paid'
    || order.financial_status === 'paid';
  return paid && Boolean(String(order.order_number || '').trim()) && validMoney(order.total) > 0;
}

export async function trackSnapPurchase(order) {
  if (!isEligibleSnapPurchase(order)) return false;

  const transactionId = String(order.order_number).trim();
  const storage = safeStorage();
  const storageKey = `${SNAP_PURCHASE_STORAGE_PREFIX}${transactionId}`;
  if (volatilePurchaseIds.has(transactionId)) return false;
  try {
    if (storage?.getItem(storageKey) === '1') return false;
  } catch {
    // The volatile set still prevents same-page replays.
  }

  const shipping = validMoney(order.delivery_fee);
  const total = validMoney(order.total);
  const value = Math.max(0, Math.round((total - shipping) * 100) / 100);
  const tracked = await trackSnapStandardEvent('PURCHASE', {
    ...buildCatalogParams(order.items),
    price: value,
    transaction_id: transactionId,
  }, transactionId);

  if (!tracked) return false;
  volatilePurchaseIds.add(transactionId);
  try {
    storage?.setItem(storageKey, '1');
  } catch {
    // Tracking succeeded; storage failure must not surface to the customer.
  }
  return true;
}
