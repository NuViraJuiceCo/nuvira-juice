import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const analytics = fs.readFileSync('src/lib/googleAnalytics.js', 'utf8');
const consent = fs.readFileSync('src/components/AnalyticsConsent.jsx', 'utf8');
const confirmation = fs.readFileSync('src/pages/OrderConfirmation.jsx', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');
const legal = fs.readFileSync('src/pages/Legal.jsx', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const checks = [
  ['web stream uses the exact GA4 measurement ID', () => {
    assert.match(analytics, /G-ELZQJD8NR9/);
  }],
  ['analytics is consent gated and excluded from native apps', () => {
    assert.match(analytics, /getAnalyticsConsent\(\) !== 'granted'/);
    assert.match(analytics, /isNativeAppRuntime\(\)/);
    assert.match(consent, /Only necessary/);
    assert.match(consent, /Allow analytics/);
  }],
  ['advertising storage and personalization remain denied', () => {
    assert.match(analytics, /ad_storage: 'denied'/);
    assert.match(analytics, /ad_user_data: 'denied'/);
    assert.match(analytics, /ad_personalization: 'denied'/);
    assert.match(analytics, /allow_google_signals: false/);
    assert.match(analytics, /allow_ad_personalization_signals: false/);
  }],
  ['page views strip queries and redact order identifiers', () => {
    assert.match(analytics, /split\('\?'\)/);
    assert.match(analytics, /\/order-tracker\/:order/);
    assert.match(analytics, /page_location: `\$\{window\.location\.origin\}\$\{pagePath\}`/);
  }],
  ['purchase tracking requires a paid non-test order', () => {
    assert.match(analytics, /order\.is_test_order === true/);
    assert.match(analytics, /order\.payment_status === 'refunded'/);
    assert.match(analytics, /order\.refund_status === 'fully_refunded'/);
    assert.match(analytics, /order\.payment_captured === true/);
    assert.match(analytics, /order\.payment_status === 'paid'/);
    assert.match(analytics, /order\.financial_status === 'paid'/);
  }],
  ['purchase payload contains no customer PII fields', () => {
    assert.match(analytics, /transaction_id: transactionId/);
    assert.match(analytics, /currency: 'USD'/);
    assert.doesNotMatch(analytics, /customer_email|customer_name|contact_phone|delivery_address|address_line1/);
  }],
  ['purchase is duplicate safe in the browser and deferred until consent', () => {
    assert.match(analytics, /PURCHASE_STORAGE_PREFIX/);
    assert.match(analytics, /storage\?\.getItem\(storageKey\) === '1'/);
    assert.match(confirmation, /ANALYTICS_CONSENT_EVENT/);
    assert.match(confirmation, /trackGooglePurchase\(order\)/);
  }],
  ['consent UI is mounted globally and privacy policy is accurate', () => {
    assert.match(app, /<AnalyticsConsent \/>/);
    assert.match(legal, /Google Analytics remains off until you choose/);
    assert.match(legal, /Review analytics choice/);
  }],
  ['analytics privacy and purchase regression is permanently gated', () => {
    assert.match(critical, /run-g131-google-analytics-consent-tests\.mjs/);
  }],
];

let passed = 0;
for (const [name, check] of checks) {
  check();
  passed += 1;
  console.log(`PASS ${passed}: ${name}`);
}

const stored = new Map();
const scripts = new Map();
const windowMock = {
  localStorage: {
    getItem: (key) => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  },
  location: { origin: 'https://www.nuvirajuice.com' },
  dispatchEvent: () => true,
};
const documentMock = {
  title: 'NuVira test',
  cookie: '',
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
const executable = analytics
  .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", 'const isNativeAppRuntime = () => false;')
  .replace(/^export /gm, '')
  + '\nglobalThis.__g131 = { setAnalyticsConsent, trackGooglePageView, trackGooglePurchase };';
const context = vm.createContext({
  window: windowMock,
  document: documentMock,
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  console,
  encodeURIComponent,
  queueMicrotask,
  setTimeout,
  clearTimeout,
});
vm.runInContext(executable, context);

assert.equal(context.__g131.setAnalyticsConsent('granted'), true);
assert.equal(await context.__g131.trackGooglePageView('/order-tracker/NV-PRIVATE?session_id=secret', 'Order'), true);
const paidOrder = {
  order_number: 'NV-G131-PAID',
  payment_status: 'paid',
  total: 32,
  delivery_fee: 5,
  discount_codes: ['WELCOME'],
  items: [{ product_id: 'oasis', title: 'OASIS', category: 'Juice', size: '12 oz', price: 13.5, quantity: 2 }],
};
assert.equal(await context.__g131.trackGooglePurchase(paidOrder), true);
assert.equal(await context.__g131.trackGooglePurchase(paidOrder), false, 'repeat purchase must be suppressed');
assert.equal(await context.__g131.trackGooglePurchase({ ...paidOrder, order_number: 'NV-G131-TEST', is_test_order: true }), false);
assert.equal(await context.__g131.trackGooglePurchase({ ...paidOrder, order_number: 'NV-G131-UNPAID', payment_status: 'pending' }), false);
assert.equal(await context.__g131.trackGooglePurchase({ ...paidOrder, order_number: 'NV-G131-REFUND', payment_status: 'refunded' }), false);

const emitted = windowMock.dataLayer.map((entry) => Array.from(entry));
const pageView = emitted.find((entry) => entry[0] === 'event' && entry[1] === 'page_view');
const purchases = emitted.filter((entry) => entry[0] === 'event' && entry[1] === 'purchase');
assert.equal(pageView[2].page_path, '/order-tracker/:order');
assert.equal(pageView[2].page_location, 'https://www.nuvirajuice.com/order-tracker/:order');
assert.equal(purchases.length, 1);
assert.equal(purchases[0][2].transaction_id, 'NV-G131-PAID');
assert.equal(purchases[0][2].value, 27);
assert.equal(purchases[0][2].shipping, 5);
assert.equal(purchases[0][2].items[0].item_name, 'OASIS');
assert.equal('customer_email' in purchases[0][2], false);
console.log('PASS 10: runtime harness verifies consented page view, paid purchase, PII omission, and duplicate suppression');
console.log(`G131 Google Analytics consent and purchase tracking: ${passed + 1}/${checks.length + 1} checks passed`);
