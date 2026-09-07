import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const snapPixel = fs.readFileSync('src/lib/snapPixel.js', 'utf8');
const analyticsConsent = fs.readFileSync('src/components/AnalyticsConsent.jsx', 'utf8');
const cartContext = fs.readFileSync('src/lib/cartContext.jsx', 'utf8');
const productDetail = fs.readFileSync('src/pages/ProductDetail.jsx', 'utf8');
const programDetail = fs.readFileSync('src/pages/ProgramDetail.jsx', 'utf8');
const shop = fs.readFileSync('src/pages/Shop.jsx', 'utf8');
const checkout = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const bookEvent = fs.readFileSync('src/pages/BookEvent.jsx', 'utf8');
const orderConfirmation = fs.readFileSync('src/pages/OrderConfirmation.jsx', 'utf8');
const register = fs.readFileSync('src/pages/Register.jsx', 'utf8');
const authContext = fs.readFileSync('src/lib/AuthContext.jsx', 'utf8');
const legal = fs.readFileSync('src/pages/Legal.jsx', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const checks = [
  ['Snapchat uses the approved Pixel and vendor script without user data in init', () => {
    assert.match(snapPixel, /SNAP_PIXEL_ID = '5e7242b6-e772-4e2d-bfc9-32e995f95c10'/);
    assert.match(snapPixel, /https:\/\/sc-static\.net\/scevent\.min\.js/);
    assert.match(snapPixel, /window\.snaptr\('init', SNAP_PIXEL_ID\);/);
    assert.doesNotMatch(snapPixel, /user_email|user_phone|first_name|last_name|address/);
  }],
  ['tracking is consent gated, query safe, and excluded from native apps', () => {
    assert.match(snapPixel, /!isNativeAppRuntime\(\)/);
    assert.match(snapPixel, /getMarketingConsent\(\) === 'granted'/);
    assert.match(snapPixel, /isSafeMarketingEventContext\(\)/);
    assert.match(snapPixel, /isTrackableMarketingPageView\(pathname\)/);
    assert.match(snapPixel, /sanitizeMetaSearchTerm\(searchTerm\)/);
    assert.match(snapPixel, /new Set\(\['email', 'google', 'apple'\]\)/);
    assert.match(analyticsConsent, /trackSnapPageView/);
    assert.match(analyticsConsent, /aria-label="Allow advertising measurement"/);
  }],
  ['catalog events use the verified Shopify variant mapping', () => {
    assert.match(snapPixel, /metaCatalogContentIdForItem/);
    assert.match(snapPixel, /item_ids: contents\.map\(\(item\) => item\.id\)/);
    assert.doesNotMatch(snapPixel, /item\?\.product_id \|\| item\?\.id \|\| item\?\.sku/);
  }],
  ['the complete customer funnel is wired only after each successful action', () => {
    assert.match(productDetail, /trackSnapViewContent/);
    assert.match(programDetail, /trackSnapViewContent/);
    assert.match(shop, /trackSnapSearch/);
    assert.match(cartContext, /trackSnapAddToCart/);
    assert.match(cartContext, /trackSnapStartCheckout/);
    assert.match(checkout, /onPaymentAttempt[\s\S]{0,500}trackSnapAddBilling/);
    assert.match(bookEvent, /await submitCustomerInquiry[\s\S]{0,900}trackSnapLead\('event_booking'\)/);
    assert.match(orderConfirmation, /trackSnapPurchase/);
  }],
  ['sign-up is measured only after verified email or provider authentication', () => {
    assert.match(register, /await credentials\.verifyOtp\(\{ email, otpCode \}\);\s*credentials\.assertCurrent\(\);[\s\S]{0,300}prepareSnapRegistrationEvent\('email'\)/);
    assert.match(authContext, /if \(currentUser\)[\s\S]{0,500}trackSnapSignUp\(pendingProviderAuthEvent\.method, pendingProviderAuthEvent\.token\)/);
    assert.match(authContext, /void consumeSnapRegistrationEvent\(\);/);
    assert.match(snapPixel, /SNAP_REGISTRATION_TTL_MS = 10 \* 60 \* 1000/);
    assert.match(snapPixel, /storage\.removeItem\(SNAP_REGISTRATION_STORAGE_KEY\)/);
  }],
  ['purchase measurement is paid-only, test-safe, refund-safe, and replay-safe', () => {
    assert.match(snapPixel, /order\.is_test_order === true/);
    assert.match(snapPixel, /order\.do_not_recover === true/);
    assert.match(snapPixel, /order\.payment_status === 'refunded'/);
    assert.match(snapPixel, /order\.payment_captured === true/);
    assert.match(snapPixel, /transaction_id: transactionId/);
    assert.match(snapPixel, /trackSnapStandardEvent\('PURCHASE'[\s\S]{0,300}, transactionId\)/);
    assert.match(snapPixel, /volatilePurchaseIds\.has\(transactionId\)/);
  }],
  ['all unique events receive explicit cross-channel deduplication identifiers', () => {
    assert.match(snapPixel, /client_dedup_id: safeLabel\(dedupId\) \|\| eventId\(eventName\)/);
    assert.match(snapPixel, /return `web:\$\{eventName\}:\$\{unique\}`/);
  }],
  ['privacy disclosure matches the Snapchat implementation and retired subscription offering', () => {
    assert.match(legal, /Snapchat Pixel — optional, consent-based ad, catalog, and shopping-journey measurement/);
    assert.match(legal, /Meta and Snapchat measurement remain off unless you enable Ad insights/);
    assert.match(legal, /A paid Snapchat Purchase event may be sent from the order-confirmation page after Ad insights consent/);
    assert.match(legal, /without raw contact, address, or payment details/);
    assert.doesNotMatch(legal, /SUBSCRIPTIONS[\s\S]{0,160}48 hours notice/);
  }],
  ['G143 is permanently included in the critical regression suite', () => {
    assert.match(critical, /run-g143-snapchat-measurement-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  check();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

let marketingConsent = null;
const localStored = new Map();
const sessionStored = new Map();
const scripts = new Map();
const windowMock = {
  localStorage: {
    getItem: (key) => localStored.get(key) || null,
    setItem: (key, value) => localStored.set(key, String(value)),
  },
  sessionStorage: {
    getItem: (key) => sessionStored.get(key) || null,
    setItem: (key, value) => sessionStored.set(key, String(value)),
    removeItem: (key) => sessionStored.delete(key),
  },
  location: { pathname: '/shop', search: '' },
};
const documentMock = {
  head: {
    appendChild: (script) => {
      scripts.set(script.id, script);
      queueMicrotask(() => script.onload?.());
    },
  },
  createElement: () => ({
    dataset: {},
    remove() {
      scripts.delete(this.id);
    },
  }),
  getElementById: (id) => scripts.get(id) || null,
};
const metaImport = `import {
  getMarketingConsent,
  isSafeMarketingEventContext,
  isTrackableMarketingPageView,
  metaCatalogContentIdForItem,
  sanitizeMetaSearchTerm,
} from '@/lib/metaPixel';`;
const executable = snapPixel
  .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", 'const isNativeAppRuntime = () => false;')
  .replace(metaImport, `const getMarketingConsent = () => globalThis.__consent();
const isSafeMarketingEventContext = () => !window.location.search.includes('session_id');
const isTrackableMarketingPageView = (pathname) => !String(pathname).startsWith('/admin');
const sanitizeMetaSearchTerm = (value) => {
  const term = String(value || '').trim().slice(0, 100);
  if (term.length < 2 || /\\S+@\\S+\\.\\S+/.test(term) || /(?:\\+?\\d[\\s().-]*){7,}/.test(term)) return '';
  return term;
};
const metaCatalogContentIdForItem = (item) => ({ aura: '43220774813786', oasis: '43220774944858' }[String(item?.product_id || item?.id || '').toLowerCase()] || '');`)
  .replace(/^export /gm, '')
  + '\nglobalThis.__g143 = { trackSnapPageView, trackSnapViewContent, trackSnapSearch, trackSnapAddToCart, trackSnapStartCheckout, trackSnapAddBilling, trackSnapLead, trackSnapSignUp, prepareSnapRegistrationEvent, consumeSnapRegistrationEvent, trackSnapPurchase };';
const context = vm.createContext({
  window: windowMock,
  document: documentMock,
  console,
  crypto: { randomUUID: (() => { let value = 0; return () => `g143-${++value}`; })() },
  Date,
  Math,
  JSON,
  Promise,
  queueMicrotask,
  setTimeout,
  clearTimeout,
  __consent: () => marketingConsent,
});
vm.runInContext(executable, context);

assert.equal(await context.__g143.trackSnapPageView('/shop'), false, 'tracking must fail closed before consent');
marketingConsent = 'granted';
windowMock.location.search = '?session_id=private';
assert.equal(await context.__g143.trackSnapAddToCart({ product_id: 'aura', price: 13 }, 1), false, 'sensitive query contexts must fail closed');
windowMock.location.search = '';

assert.equal(await context.__g143.trackSnapPageView('/shop'), true);
assert.equal(await context.__g143.trackSnapViewContent({ product_id: 'aura', price: 13, category: 'juice' }), true);
assert.equal(await context.__g143.trackSnapSearch('oasis'), true);
assert.equal(await context.__g143.trackSnapSearch('customer@example.com'), false);
assert.equal(await context.__g143.trackSnapSearch('(636) 697-6028'), false);
assert.equal(await context.__g143.trackSnapAddToCart({ product_id: 'aura', price: 13 }, 2), true);
assert.equal(await context.__g143.trackSnapStartCheckout([{ product_id: 'oasis', price: 13, quantity: 1 }], 13), true);
assert.equal(await context.__g143.trackSnapAddBilling([{ product_id: 'oasis', price: 13, quantity: 1 }], 13), true);
assert.equal(await context.__g143.trackSnapLead('event_booking'), true);
assert.equal(await context.__g143.trackSnapSignUp('google', 'registration-g143'), true);
assert.equal(await context.__g143.trackSnapSignUp('customer@example.com', 'registration-safe'), true);

const paidOrder = {
  order_number: 'NV-G143-SYNTHETIC',
  total: 15,
  delivery_fee: 2,
  payment_captured: true,
  items: [{ product_id: 'aura', price: 13, quantity: 1 }],
};
assert.equal(await context.__g143.trackSnapPurchase(paidOrder), true);
assert.equal(await context.__g143.trackSnapPurchase(paidOrder), false, 'sequential purchase replay must be suppressed');
assert.equal(await context.__g143.trackSnapPurchase({ ...paidOrder, order_number: 'NV-G143-TEST', is_test_order: true }), false);
assert.equal(await context.__g143.trackSnapPurchase({ ...paidOrder, order_number: 'NV-G143-REFUND', payment_status: 'refunded' }), false);

const queue = windowMock.snaptr.queue.map((entry) => Array.from(entry));
const events = queue.filter((entry) => entry[0] === 'track');
for (const name of ['PAGE_VIEW', 'VIEW_CONTENT', 'SEARCH', 'ADD_CART', 'START_CHECKOUT', 'ADD_BILLING', 'CUSTOM_EVENT_1', 'SIGN_UP', 'PURCHASE']) {
  assert.ok(events.some((entry) => entry[1] === name), `${name} must be emitted`);
}
const viewContent = events.find((entry) => entry[1] === 'VIEW_CONTENT');
assert.deepEqual(Array.from(viewContent[2].item_ids), ['43220774813786']);
const purchase = events.find((entry) => entry[1] === 'PURCHASE');
assert.equal(purchase[2].transaction_id, 'NV-G143-SYNTHETIC');
assert.equal(purchase[2].client_dedup_id, 'NV-G143-SYNTHETIC');
assert.equal(purchase[2].price, 13);
const signUps = events.filter((entry) => entry[1] === 'SIGN_UP');
assert.equal(signUps.at(-1)[2].sign_up_method, 'unknown');
assert.equal(JSON.stringify(queue).includes('customer@example.com'), false);
assert.equal(JSON.stringify(queue).includes('session_id=private'), false);

assert.equal(context.__g143.prepareSnapRegistrationEvent('email'), true);
assert.equal(await context.__g143.consumeSnapRegistrationEvent(), true);
assert.equal(sessionStored.size, 0);

console.log(`PASS ${checks.length + 1}: runtime harness verifies consent, catalog IDs, funnel events, replay safety, PII omission, and registration TTL`);
console.log(`G143 Snapchat measurement coverage: ${passed + 1}/${checks.length + 1} checks passed`);
