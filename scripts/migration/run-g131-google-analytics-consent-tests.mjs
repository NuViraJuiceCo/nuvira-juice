import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const analytics = fs.readFileSync('src/lib/googleAnalytics.js', 'utf8');
const consent = fs.readFileSync('src/components/AnalyticsConsent.jsx', 'utf8');
const confirmation = fs.readFileSync('src/pages/OrderConfirmation.jsx', 'utf8');
const app = fs.readFileSync('src/App.jsx', 'utf8');
const legal = fs.readFileSync('src/pages/Legal.jsx', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');
const cartContext = fs.readFileSync('src/lib/cartContext.jsx', 'utf8');
const cart = fs.readFileSync('src/pages/Cart.jsx', 'utf8');
const productDetail = fs.readFileSync('src/pages/ProductDetail.jsx', 'utf8');
const programDetail = fs.readFileSync('src/pages/ProgramDetail.jsx', 'utf8');
const checkout = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const embeddedPayment = fs.readFileSync('src/components/checkout/EmbeddedPayment.jsx', 'utf8');
const indexHtml = fs.readFileSync('index.html', 'utf8');
const indexCss = fs.readFileSync('src/index.css', 'utf8');
const seo = fs.readFileSync('src/components/SEO.jsx', 'utf8');
const contact = fs.readFileSync('src/pages/Contact.jsx', 'utf8');
const heroBanner = fs.readFileSync('src/components/home/HeroBanner.jsx', 'utf8');
const brandImages = fs.readFileSync('src/lib/brandImages.js', 'utf8');
const sitemap = fs.readFileSync('public/sitemap.xml', 'utf8');

const checks = [
  ['web stream uses the exact GA4 measurement ID', () => {
    assert.match(analytics, /G-H8R82365GM/);
  }],
  ['analytics is consent gated and excluded from native apps', () => {
    assert.match(analytics, /getAnalyticsConsent\(\) !== 'granted'/);
    assert.match(analytics, /isNativeAppRuntime\(\)/);
    assert.match(consent, /No thanks/);
    assert.match(consent, /Website analytics/);
    assert.match(consent, />\s*Save\s*</);
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
    assert.match(legal, /Google Analytics remains off unless you enable Website analytics/);
    assert.match(legal, /Review measurement choices/);
  }],
  ['analytics privacy and purchase regression is permanently gated', () => {
    assert.match(critical, /run-g131-google-analytics-consent-tests\.mjs/);
  }],
  ['recommended GA4 commerce milestones are wired through the real customer journey', () => {
    for (const eventName of ['view_item_list', 'select_item', 'view_item', 'add_to_cart', 'remove_from_cart', 'view_cart', 'begin_checkout', 'add_shipping_info', 'add_payment_info', 'search', 'generate_lead']) {
      assert.match(analytics, new RegExp(`['"]${eventName}['"]`));
    }
    assert.match(cartContext, /trackGoogleAddToCart/);
    assert.match(cartContext, /trackGoogleBeginCheckout/);
    assert.match(cart, /trackGoogleViewCart/);
    assert.match(cart, /ANALYTICS_CONSENT_EVENT/);
    assert.match(productDetail, /trackGoogleViewItem/);
    assert.match(productDetail, /ANALYTICS_CONSENT_EVENT/);
    assert.match(programDetail, /trackGoogleViewItem/);
    assert.match(programDetail, /ANALYTICS_CONSENT_EVENT/);
    assert.match(checkout, /trackGoogleAddShippingInfo/);
    assert.match(checkout, /trackGoogleAddPaymentInfo/);
    assert.match(checkout, /shippingAnalyticsTrackedRef/);
    assert.match(checkout, /paymentAnalyticsTrackedRef/);
    assert.match(embeddedPayment, /onPaymentAttempt\?\.\('Card'\)/);
    assert.match(embeddedPayment, /onPaymentAttempt\?\.\('Google Pay'\)/);
  }],
  ['commerce analytics payload construction remains consent gated and PII free', () => {
    assert.match(analytics, /GOOGLE_ECOMMERCE_EVENTS\.has\(eventName\)/);
    assert.match(analytics, /getAnalyticsConsent\(\) !== 'granted'/);
    assert.doesNotMatch(analytics, /params\.(?:customer_email|customer_name|contact_phone|delivery_address|address_line1)/);
  }],
  ['crawler-readable brand identity uses the canonical apex domain and verified social handles', () => {
    assert.match(indexHtml, /rel="canonical" href="https:\/\/nuvirajuice\.com\/"/);
    assert.match(indexHtml, /property="og:url" content="https:\/\/nuvirajuice\.com\/"/);
    assert.doesNotMatch(indexHtml, /juice cleanse/i);
    assert.doesNotMatch(indexHtml, /@nuvirajuice"/);
    assert.match(indexHtml, /instagram\.com\/nuvirajuiceco/);
    assert.match(indexHtml, /facebook\.com\/nuvirajuiceco/);
    assert.match(seo, /instagram\.com\/nuvirajuiceco/);
    assert.doesNotMatch(seo, /openingHoursSpecification/);
    assert.match(contact, /instagram\.com\/nuvirajuiceco/);
    assert.match(app, /path="\/our-story" element=\{<Navigate to="\/about" replace \/>\}/);
    assert.match(sitemap, /https:\/\/nuvirajuice\.com\/about/);
    assert.doesNotMatch(sitemap, /https:\/\/nuvirajuice\.com\/(?:our-story|subscribe|referral)/);
  }],
  ['homepage LCP image is preloaded and does not auto-rotate during Core Web Vitals measurement', () => {
    assert.match(indexHtml, /rel="preload" as="image" href="\/images\/brand\/nuvira-about-bottle-cooler\.webp" imagesrcset="\/images\/brand\/nuvira-about-bottle-cooler-840\.webp 840w, \/images\/brand\/nuvira-about-bottle-cooler\.webp 1440w" imagesizes="100vw" fetchpriority="high"/);
    assert.match(indexHtml, /content="width=device-width, initial-scale=1\.0, viewport-fit=cover"/);
    assert.match(brandImages, /nuvira-about-bottle-cooler\.webp/);
    assert.match(brandImages, /nuvira-about-bottle-cooler-840\.webp/);
    assert.match(brandImages, /nuvira-trio-outdoor-event\.webp/);
    assert.match(brandImages, /nuvira-tote-bag\.webp/);
    assert.doesNotMatch(heroBanner, /setInterval/);
    assert.doesNotMatch(heroBanner, /new Image\(\)/);
    assert.match(heroBanner, /current !== 0/);
    assert.match(heroBanner, /srcSet=\{activeBanners\[0\]\.image_url === DEFAULT_HERO_IMAGE\.image_url/);
    assert.match(app, /isNativeAppRuntime\(\) && !hasSplashBeenShown\(\)/);
  }],
  ['homepage LCP heading uses a preloaded local font and renders without a mount delay', () => {
    assert.match(indexHtml, /rel="preload" href="\/fonts\/playfair-display-latin\.woff2" as="font" type="font\/woff2" crossorigin/);
    assert.match(indexCss, /font-family: 'Playfair Display'/);
    assert.match(indexCss, /src: url\('\/fonts\/playfair-display-latin\.woff2'\) format\('woff2'\)/);
    assert.ok(fs.existsSync('public/fonts/playfair-display-latin.woff2'));
    assert.match(heroBanner, /<motion\.div\s+initial=\{false\}/);
  }],
  ['web homepage module begins loading early without weakening native route isolation', () => {
    assert.match(indexHtml, /!globalThis\.Capacitor\?\.isNativePlatform\?\.\(\)/);
    assert.match(indexHtml, /window\.location\.pathname === '\/'/);
    assert.match(indexHtml, /import\('\/src\/pages\/Home\.jsx'\)/);
    assert.match(app, /const Home = React\.lazy\(\(\) => import\('@\/pages\/Home'\)\)/);
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
  + '\nglobalThis.__g131 = { setAnalyticsConsent, trackGooglePageView, trackGooglePurchase, trackGoogleEcommerceEvent };';
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
assert.equal(await context.__g131.trackGoogleEcommerceEvent('add_to_cart', {
  value: 13.5,
  items: [{ id: 'oasis', title: 'OASIS', category: 'Juice', size: '12 oz', price: 13.5, quantity: 1 }],
}), true);
assert.equal(await context.__g131.trackGoogleEcommerceEvent('unknown_event', {
  items: [{ id: 'oasis', title: 'OASIS', price: 13.5, quantity: 1 }],
}), false);
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
const addToCart = emitted.find((entry) => entry[0] === 'event' && entry[1] === 'add_to_cart');
assert.equal(pageView[2].page_path, '/order-tracker/:order');
assert.equal(pageView[2].page_location, 'https://www.nuvirajuice.com/order-tracker/:order');
assert.equal(addToCart[2].value, 13.5);
assert.equal(addToCart[2].items[0].item_id, 'oasis');
assert.equal('customer_email' in addToCart[2], false);
assert.equal(purchases.length, 1);
assert.equal(purchases[0][2].transaction_id, 'NV-G131-PAID');
assert.equal(purchases[0][2].value, 27);
assert.equal(purchases[0][2].shipping, 5);
assert.equal(purchases[0][2].items[0].item_name, 'OASIS');
assert.equal('customer_email' in purchases[0][2], false);
console.log(`PASS ${checks.length + 1}: runtime harness verifies consented page view, commerce milestone, paid purchase, PII omission, and duplicate suppression`);
console.log(`G131 Google Analytics consent and purchase tracking: ${passed + 1}/${checks.length + 1} checks passed`);
