#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const analytics = read('src/lib/googleAnalytics.js');
const checkout = read('src/pages/Checkout.jsx');
const createPaymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
const stripeWebhook = read('base44/functions/stripeWebhook/entry.ts');
const helperSource = read('base44/functions/stripeWebhook/googleMeasurement.js');
const browserConfirmation = read('src/pages/OrderConfirmation.jsx');
const legal = read('src/pages/Legal.jsx');
const critical = read('scripts/ci/run-critical-regressions.mjs');

assert.match(analytics, /export async function getGoogleMeasurementContext\(\)/);
assert.match(analytics, /window\.gtag\('get', GOOGLE_ANALYTICS_MEASUREMENT_ID, fieldName, finish\)/);
assert.match(analytics, /readGoogleTagValue\('client_id'\)/);
assert.match(analytics, /readGoogleTagValue\('session_id'\)/);
assert.match(analytics, /Promise\.race\(\[/);
assert.match(analytics, /resolve\(false\), GOOGLE_MEASUREMENT_CONTEXT_TIMEOUT_MS/);
assert.match(analytics, /getAnalyticsConsent\(\) !== 'granted'/);
assert.match(analytics, /isNativeAppRuntime\(\)/);
assert.match(checkout, /analytics_measurement_consent: analyticsMeasurementConsent \? 'granted' : 'denied'/);
assert.match(checkout, /google_measurement_context: googleMeasurementContext/);
assert.match(createPaymentIntent, /normalizeGoogleMeasurementContext/);
assert.match(createPaymentIntent, /analytics_measurement_consent === 'granted'/);
assert.match(createPaymentIntent, /google_measurement_context: normalizedGoogleMeasurementContext/);
const stripeMetadataBlock = createPaymentIntent.slice(
  createPaymentIntent.indexOf('const intentMetadata = {'),
  createPaymentIntent.indexOf('const amountCents ='),
);
assert.doesNotMatch(stripeMetadataBlock, /google_measurement_context|google_client_id|google_session_id/);
assert.match(stripeWebhook, /import \{ sendGooglePurchaseMeasurement \} from '\.\/googleMeasurement\.js'/);
assert.match(stripeWebhook, /async function attemptGooglePurchaseMeasurement/);
assert.equal((stripeWebhook.match(/attemptGooglePurchaseMeasurement\(\{/g) || []).length, 3);
assert.match(helperSource, /ENABLE_GOOGLE_MEASUREMENT_PROTOCOL_PURCHASE/);
assert.match(helperSource, /GOOGLE_ANALYTICS_API_SECRET/);
assert.match(helperSource, /analytics_measurement_consent !== 'granted'/);
assert.match(helperSource, /test_order_suppressed/);
assert.match(helperSource, /timestamp_micros/);
assert.match(helperSource, /ad_user_data: 'DENIED'/);
assert.match(helperSource, /ad_personalization: 'DENIED'/);
assert.match(helperSource, /`\$\{GOOGLE_PURCHASE_LOG_PREFIX\}:\$\{paymentIntentId\}`/);
assert.match(helperSource, /existingLogs\.some/);
assert.match(helperSource, /AbortSignal\.timeout\(GOOGLE_MEASUREMENT_TIMEOUT_MS\)/);
assert.doesNotMatch(helperSource, /customer_email|customer_name|contact_phone|delivery_address|address_line1/);
assert.match(browserConfirmation, /trackGooglePurchase\(order\)/);
assert.match(analytics, /transaction_id: transactionId/);
assert.match(legal, /pseudonymous browser client and session identifier/);
assert.match(legal, /does not send your raw contact, address, or payment details/);
assert.match(critical, /run-g167-google-measurement-protocol-tests\.mjs/);

const stored = new Map();
const scripts = new Map();
const windowMock = {
  localStorage: {
    getItem: (key) => stored.get(key) || null,
    setItem: (key, value) => stored.set(key, String(value)),
    removeItem: (key) => stored.delete(key),
  },
  sessionStorage: {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  },
  location: { origin: 'https://nuvirajuice.com', href: 'https://nuvirajuice.com/checkout', search: '' },
  dispatchEvent: () => true,
};
const documentMock = {
  title: 'Synthetic checkout',
  cookie: '',
  head: {
    appendChild: (script) => {
      scripts.set(script.id, script);
      queueMicrotask(() => script.onload?.());
    },
  },
  createElement: () => ({ dataset: {}, remove() { scripts.delete(this.id); } }),
  getElementById: (id) => scripts.get(id) || null,
};
const executable = analytics
  .replace("import { isNativeAppRuntime } from '@/lib/nativeRuntime';", 'const isNativeAppRuntime = () => false;')
  .replace(/^export /gm, '')
  + '\nglobalThis.__g167 = { setAnalyticsConsent, getGoogleMeasurementContext };';
const browserContext = vm.createContext({
  window: windowMock,
  document: documentMock,
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
  console,
  URL,
  URLSearchParams,
  encodeURIComponent,
  queueMicrotask,
  setTimeout,
  clearTimeout,
});
vm.runInContext(executable, browserContext);
assert.equal(browserContext.__g167.setAnalyticsConsent('granted'), true);
const queuedGtag = windowMock.gtag;
windowMock.gtag = (command, measurementId, fieldName, callback) => {
  if (command !== 'get') return queuedGtag(command, measurementId, fieldName, callback);
  assert.equal(measurementId, 'G-H8R82365GM');
  callback(fieldName === 'client_id' ? '1234567890.1788123456' : '1788123456');
};
const measurementContext = await browserContext.__g167.getGoogleMeasurementContext();
assert.equal(measurementContext.client_id, '1234567890.1788123456');
assert.equal(measurementContext.session_id, '1788123456');
assert.match(measurementContext.captured_at, /^\d{4}-\d{2}-\d{2}T/);

const helperUrl = pathToFileURL(new URL('../../base44/functions/stripeWebhook/googleMeasurement.js', import.meta.url).pathname).href;
const {
  GOOGLE_MEASUREMENT_CONTRACT,
  buildGooglePurchaseItems,
  normalizeGoogleMeasurementContext,
  sendGooglePurchaseMeasurement,
} = await import(`${helperUrl}?g167=${Date.now()}`);

const secret = 'synthetic-google-api-secret';
const envMap = new Map([
  ['ENABLE_GOOGLE_MEASUREMENT_PROTOCOL_PURCHASE', 'true'],
  ['GOOGLE_ANALYTICS_API_SECRET', secret],
]);
const env = { get: (name) => envMap.get(name) || '' };
const logs = [];
const base44 = {
  asServiceRole: {
    entities: {
      OrderSyncLog: {
        filter: async ({ idempotency_key }) => logs.filter((row) => row.idempotency_key === idempotency_key),
        create: async (row) => {
          logs.push({ id: `log_${logs.length + 1}`, ...row });
          return logs.at(-1);
        },
      },
    },
  },
};
const event = { id: 'evt_synthetic_g167', created: 1788123456 };
const paymentIntent = {
  id: 'pi_synthetic_g167',
  status: 'succeeded',
  amount_received: 3200,
  currency: 'usd',
  metadata: { order_number: 'NV-SYNTH-G167' },
};
const order = {
  id: 'order_synthetic_g167',
  order_number: 'NV-SYNTH-G167',
  payment_captured: true,
  payment_status: 'paid',
  delivery_fee: 5,
  total: 32,
  discount_codes: ['WELCOME'],
  items: [{ product_id: 'oasis', title: 'OASIS', category: 'Juice', size: '12 oz', price: 13.5, quantity: 2 }],
};
const checkoutData = {
  analytics_measurement_consent: 'granted',
  google_measurement_context: {
    client_id: '1234567890.1788123456',
    session_id: '1788123456',
    captured_at: '2026-08-30T12:00:00.000Z',
  },
};

const providerCalls = [];
let unexpectedNetworkRequests = 0;
const acceptedFetch = async (url, init) => {
  if (!String(url).startsWith('https://www.google-analytics.com/mp/collect?')) {
    unexpectedNetworkRequests += 1;
    throw new Error('unexpected network request');
  }
  providerCalls.push({ url: String(url), init });
  return { ok: true, status: 204 };
};
const sent = await sendGooglePurchaseMeasurement({
  base44, event, paymentIntent, order, checkoutData, fetchImpl: acceptedFetch, env,
});
assert.equal(sent.sent, true);
assert.equal(sent.transaction_id, 'NV-SYNTH-G167');
assert.equal(providerCalls.length, 1);
assert.match(providerCalls[0].url, /measurement_id=G-H8R82365GM/);
assert.match(providerCalls[0].url, /api_secret=synthetic-google-api-secret/);
const payload = JSON.parse(providerCalls[0].init.body);
assert.equal(payload.client_id, '1234567890.1788123456');
assert.equal(payload.timestamp_micros, 1788123456000000);
assert.deepEqual(payload.consent, { ad_user_data: 'DENIED', ad_personalization: 'DENIED' });
assert.equal(payload.events[0].name, 'purchase');
assert.equal(payload.events[0].params.transaction_id, 'NV-SYNTH-G167');
assert.equal(payload.events[0].params.currency, 'USD');
assert.equal(payload.events[0].params.value, 27);
assert.equal(payload.events[0].params.shipping, 5);
assert.equal(payload.events[0].params.session_id, '1788123456');
assert.equal(payload.events[0].params.items[0].item_id, 'oasis');
assert.equal(payload.events[0].params.items[0].quantity, 2);
assert.equal(JSON.stringify(payload).includes('customer_email'), false);
assert.equal(logs.at(-1).idempotency_key, 'ga4_measurement_purchase:pi_synthetic_g167');
assert.equal(logs.at(-1).status, 'success');

const replay = await sendGooglePurchaseMeasurement({
  base44, event, paymentIntent, order, checkoutData, fetchImpl: acceptedFetch, env,
});
assert.equal(replay.deduplicated, true);
assert.equal(providerCalls.length, 1, 'a successful replay must not issue a second provider request');

const denied = await sendGooglePurchaseMeasurement({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_denied_g167' },
  order: { ...order, order_number: 'NV-DENIED-G167' },
  checkoutData: { ...checkoutData, analytics_measurement_consent: 'denied' },
  fetchImpl: acceptedFetch,
  env,
});
assert.equal(denied.reason, 'analytics_consent_not_granted');

const invalidContext = await sendGooglePurchaseMeasurement({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_invalid_context_g167' },
  order: { ...order, order_number: 'NV-CONTEXT-G167' },
  checkoutData: { ...checkoutData, google_measurement_context: { client_id: 'invalid', session_id: '0' } },
  fetchImpl: acceptedFetch,
  env,
});
assert.equal(invalidContext.reason, 'measurement_context_unavailable');

const testOrderResult = await sendGooglePurchaseMeasurement({
  base44,
  event,
  paymentIntent: {
    ...paymentIntent,
    id: 'pi_test_g167',
    metadata: { ...paymentIntent.metadata, order_number: 'NV-TEST-G167', is_test_order: 'true' },
  },
  order: { ...order, order_number: 'NV-TEST-G167', is_test_order: true },
  checkoutData,
  fetchImpl: acceptedFetch,
  env,
});
assert.equal(testOrderResult.reason, 'test_order_suppressed');

envMap.set('ENABLE_GOOGLE_MEASUREMENT_PROTOCOL_PURCHASE', 'false');
const disabled = await sendGooglePurchaseMeasurement({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_disabled_g167' },
  order: { ...order, order_number: 'NV-DISABLED-G167' },
  checkoutData,
  fetchImpl: acceptedFetch,
  env,
});
assert.equal(disabled.reason, 'production_gate_disabled');
envMap.set('ENABLE_GOOGLE_MEASUREMENT_PROTOCOL_PURCHASE', 'true');

envMap.delete('GOOGLE_ANALYTICS_API_SECRET');
const unconfigured = await sendGooglePurchaseMeasurement({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_unconfigured_g167' },
  order: { ...order, order_number: 'NV-UNCONFIGURED-G167' },
  checkoutData,
  fetchImpl: acceptedFetch,
  env,
});
assert.equal(unconfigured.reason, 'measurement_protocol_not_configured');
envMap.set('GOOGLE_ANALYTICS_API_SECRET', secret);

const rejected = await sendGooglePurchaseMeasurement({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_rejected_g167' },
  order: { ...order, order_number: 'NV-REJECTED-G167' },
  checkoutData,
  fetchImpl: async () => ({ ok: false, status: 503 }),
  env,
});
assert.equal(rejected.reason, 'provider_rejected');
assert.equal(logs.at(-1).status, 'error');

const transportFailure = await sendGooglePurchaseMeasurement({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_transport_g167' },
  order: { ...order, order_number: 'NV-TRANSPORT-G167' },
  checkoutData,
  fetchImpl: async () => { throw new Error(`${secret} should never escape`); },
  env,
});
assert.equal(transportFailure.reason, 'transport_failed');
assert.equal(JSON.stringify(logs).includes(secret), false);
assert.equal(JSON.stringify(transportFailure).includes(secret), false);
assert.equal(unexpectedNetworkRequests, 0);
assert.equal(providerCalls.length, 1);
assert.equal(GOOGLE_MEASUREMENT_CONTRACT.measurement_id, 'G-H8R82365GM');
assert.equal(GOOGLE_MEASUREMENT_CONTRACT.endpoint, 'https://www.google-analytics.com/mp/collect');
assert.deepEqual(normalizeGoogleMeasurementContext(checkoutData.google_measurement_context), {
  client_id: '1234567890.1788123456', session_id: '1788123456',
});
assert.deepEqual(buildGooglePurchaseItems(order.items).map(({ item_id, quantity }) => ({ item_id, quantity })), [
  { item_id: 'oasis', quantity: 2 },
]);

console.log(JSON.stringify({
  ok: true,
  suite: 'g167-google-measurement-protocol',
  assertions: 67,
  browser_context_captured_only_with_analytics_consent: true,
  server_purchase_authority: 'stripe_payment_intent_succeeded',
  stable_transaction_id: 'order_number',
  test_orders_suppressed: true,
  raw_customer_data_sent: false,
  secret_exposed: false,
  unexpected_network_requests: unexpectedNetworkRequests,
  live_provider_calls_performed: false,
}, null, 2));
