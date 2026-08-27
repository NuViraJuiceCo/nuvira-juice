import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const meta = fs.readFileSync('src/lib/metaPixel.js', 'utf8');
const google = fs.readFileSync('src/lib/googleAnalytics.js', 'utf8');
const consent = fs.readFileSync('src/components/AnalyticsConsent.jsx', 'utf8');
const shop = fs.readFileSync('src/pages/Shop.jsx', 'utf8');
const productCard = fs.readFileSync('src/components/shop/ProductCard.jsx', 'utf8');
const productDetail = fs.readFileSync('src/pages/ProductDetail.jsx', 'utf8');
const programDetail = fs.readFileSync('src/pages/ProgramDetail.jsx', 'utf8');
const cartContext = fs.readFileSync('src/lib/cartContext.jsx', 'utf8');
const checkout = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const confirmation = fs.readFileSync('src/pages/OrderConfirmation.jsx', 'utf8');
const legal = fs.readFileSync('src/pages/Legal.jsx', 'utf8');
const contact = fs.readFileSync('src/pages/Contact.jsx', 'utf8');
const partner = fs.readFileSync('src/pages/Partner.jsx', 'utf8');
const bookEvent = fs.readFileSync('src/pages/BookEvent.jsx', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const checks = [
  ['Meta uses the verified pixel and a separate fail-closed consent choice', () => {
    assert.match(meta, /719023677458304/);
    assert.match(meta, /nuvira_marketing_consent_v1/);
    assert.match(meta, /getMarketingConsent\(\) !== 'granted'/);
    assert.match(meta, /isNativeAppRuntime\(\)/);
    assert.match(consent, /Website analytics/);
    assert.match(consent, /Ad insights/);
    assert.match(consent, /No thanks/);
    assert.match(consent, />\s*Save\s*</);
  }],
  ['Meta never emits Purchase from a customer browser', () => {
    assert.doesNotMatch(meta, /['"]Purchase['"]/);
    assert.doesNotMatch(confirmation, /trackMeta|fbq/);
  }],
  ['sensitive and private page views are excluded', () => {
    for (const prefix of ['/admin', '/account', '/checkout', '/login', '/register', '/order-confirmation', '/order-options', '/order-tracker']) {
      assert.match(meta, new RegExp(prefix.replace('/', '\\/')));
    }
    assert.match(meta, /SENSITIVE_QUERY_KEYS/);
    assert.match(meta, /session_id/);
    assert.match(meta, /payment_intent_client_secret/);
  }],
  ['Meta events use standard names, catalog IDs, value, and no PII fields', () => {
    for (const eventName of ['PageView', 'ViewContent', 'Search', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'Lead']) {
      assert.match(meta, new RegExp(`['"]${eventName}['"]`));
    }
    assert.match(meta, /content_ids/);
    assert.match(meta, /contents/);
    assert.match(meta, /currency: 'USD'/);
    assert.doesNotMatch(meta, /customer_email|customer_name|contact_phone|delivery_address|address_line1/);
  }],
  ['GA4 includes the missing recommended discovery and cart diagnostics', () => {
    for (const eventName of ['view_item_list', 'select_item', 'remove_from_cart', 'search']) {
      assert.match(google, new RegExp(`['"]${eventName}['"]`));
    }
    assert.match(shop, /trackGoogleViewItemList/);
    assert.match(shop, /trackGoogleSearch/);
    assert.match(productCard, /trackGoogleSelectItem/);
    assert.match(cartContext, /trackGoogleRemoveFromCart/);
  }],
  ['Meta funnel events are wired to the real shopping journey', () => {
    assert.match(productDetail, /trackMetaViewContent/);
    assert.match(programDetail, /trackMetaViewContent/);
    assert.match(shop, /trackMetaSearch/);
    assert.match(cartContext, /trackMetaAddToCart/);
    assert.match(cartContext, /trackMetaInitiateCheckout/);
    assert.match(checkout, /trackMetaAddPaymentInfo/);
  }],
  ['successful inquiry submissions emit lead events without form fields', () => {
    assert.match(google, /['"]generate_lead['"]/);
    for (const source of [contact, partner, bookEvent]) {
      assert.match(source, /trackGoogleGenerateLead/);
      assert.match(source, /trackMetaLead/);
      assert.ok(source.lastIndexOf('trackGoogleGenerateLead(') > source.indexOf('await submitCustomerInquiry'));
      assert.ok(source.lastIndexOf('trackMetaLead(') > source.indexOf('await submitCustomerInquiry'));
    }
    assert.doesNotMatch(meta, /customer_email|customer_name|contact_phone|delivery_address|address_line1/);
  }],
  ['search terms reject likely email addresses and phone numbers', () => {
    assert.match(google, /sanitizeSearchTerm/);
    assert.match(meta, /sanitizeMetaSearchTerm/);
    assert.match(google, /\\S\+@\\S\+/);
    assert.match(meta, /\\S\+@\\S\+/);
  }],
  ['privacy copy describes optional measurement tools and native exclusion', () => {
    assert.match(legal, /Meta and Snapchat measurement remain off unless you enable Ad insights/);
    assert.match(legal, /one-way SHA-256 hashes/);
    assert.match(legal, /not enabled inside the native iOS or Android app/);
    assert.match(legal, /Review measurement choices/);
  }],
  ['the measurement regression suite is permanently gated', () => {
    assert.match(critical, /run-g137-marketing-measurement-tests\.mjs/);
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
const dispatched = [];
const windowMock = {
  localStorage: {
    getItem: (key) => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  },
  location: { pathname: '/shop', search: '', origin: 'https://nuvirajuice.com' },
  dispatchEvent: (event) => dispatched.push(event),
};
const documentMock = {
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
const executable = meta
  .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", 'const isNativeAppRuntime = () => false;')
  .replace(/^export /gm, '')
  + '\nglobalThis.__g137 = { getMarketingConsent, setMarketingConsent, trackMetaPageView, trackMetaViewContent, trackMetaSearch, trackMetaLead, sanitizeMetaSearchTerm, normalizeMetaCatalogContentId, metaCatalogContentIdForItem };';
const context = vm.createContext({
  window: windowMock,
  document: documentMock,
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  URLSearchParams,
  console,
  queueMicrotask,
  Date,
  Math,
  crypto: { randomUUID: () => 'synthetic-event-id' },
});
vm.runInContext(executable, context);

assert.equal(context.__g137.getMarketingConsent(), null);
assert.equal(await context.__g137.trackMetaPageView('/shop'), false, 'Meta must remain off before consent');
assert.equal(scripts.size, 0, 'no Meta script may load before consent');
assert.equal(context.__g137.setMarketingConsent('granted'), true);
assert.equal(await context.__g137.trackMetaPageView('/shop'), true);
assert.equal(await context.__g137.trackMetaViewContent({ id: 'oasis', title: 'OASIS', price: 13.5, category: 'Juice' }), true);
assert.equal(await context.__g137.trackMetaSearch('oasis'), true);
assert.equal(await context.__g137.trackMetaLead('contact'), true);

const emitted = windowMock.fbq.queue.map((entry) => Array.from(entry));
assert.ok(emitted.some((entry) => entry[0] === 'init' && entry[1] === '719023677458304'));
assert.ok(emitted.some((entry) => entry[0] === 'track' && entry[1] === 'PageView'));
assert.ok(emitted.some((entry) => entry[0] === 'track' && entry[1] === 'Lead' && entry[2].content_name === 'contact'));
const viewContent = emitted.find((entry) => entry[0] === 'track' && entry[1] === 'ViewContent');
assert.equal(viewContent[2].content_ids[0], '43220774944858');
assert.equal(viewContent[2].value, 13.5);
assert.equal(viewContent[3].eventID, 'web:ViewContent:synthetic-event-id');
assert.equal('customer_email' in viewContent[2], false);
assert.equal(context.__g137.normalizeMetaCatalogContentId('gid://shopify/ProductVariant/43220774813786'), '43220774813786');
assert.equal(context.__g137.metaCatalogContentIdForItem({ id: '69d490ce699b5f1ac4dde496' }), '43220774846554');

windowMock.location.pathname = '/order-confirmation';
windowMock.location.search = '?session_id=synthetic-secret';
assert.equal(await context.__g137.trackMetaPageView('/order-confirmation'), false);
assert.equal(await context.__g137.trackMetaViewContent({ id: 'oasis', title: 'OASIS', price: 13.5 }), false);
assert.equal(context.__g137.sanitizeMetaSearchTerm('customer@example.com'), '');
assert.equal(context.__g137.sanitizeMetaSearchTerm('636-555-1212'), '');
assert.equal(context.__g137.sanitizeMetaSearchTerm('oasis'), 'oasis');

assert.equal(context.__g137.setMarketingConsent('denied'), true);
windowMock.location.pathname = '/shop';
windowMock.location.search = '';
assert.equal(await context.__g137.trackMetaSearch('aura'), false);
assert.ok(dispatched.some((event) => event.type === 'nuvira:marketing-consent' && event.detail === 'denied'));

console.log(`PASS ${checks.length + 1}: runtime harness verifies fail-closed consent, safe standard events, PII rejection, and sensitive-route blocking`);
console.log(`G137 marketing measurement: ${passed + 1}/${checks.length + 1} checks passed`);
