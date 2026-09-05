#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const checkout = read('src/pages/Checkout.jsx');
const browserMeta = read('src/lib/metaPixel.js');
const consent = read('src/components/AnalyticsConsent.jsx');
const legal = read('src/pages/Legal.jsx');
const createPaymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
const stripeWebhook = read('base44/functions/stripeWebhook/entry.ts');
const helperSource = read('base44/functions/stripeWebhook/metaConversions.js');
const critical = read('scripts/ci/run-critical-regressions.mjs');

assert.match(checkout, /getMetaCapiAttributionContext/);
assert.match(checkout, /marketing_measurement_consent:\s*marketingMeasurementConsent \? 'granted' : 'denied'/);
assert.match(checkout, /meta_capi_context:\s*metaCapiContext/);
assert.match(createPaymentIntent, /marketing_measurement_consent:\s*marketing_measurement_consent === 'granted' \? 'granted' : 'denied'/);
assert.match(createPaymentIntent, /normalizeMetaCapiContext/);
assert.match(createPaymentIntent, /meta_capi_context:\s*normalizedMetaCapiContext/);
assert.match(createPaymentIntent, /RUN_META_CAPI_PROVIDER_SANDBOX/);
assert.match(createPaymentIntent, /meta_capi_test_enabled:\s*internalSandboxCheckout/);
assert.match(stripeWebhook, /import \{ sendMetaPurchaseConversion \} from '\.\/metaConversions\.js'/);
assert.match(stripeWebhook, /async function attemptMetaPurchaseConversion/);
assert.match(stripeWebhook, /async function boundedMetaPurchaseAttempt/);
assert.ok((stripeWebhook.match(/boundedMetaPurchaseAttempt\(\{/g) || []).length >= 4);
assert.match(stripeWebhook, /meta_capi_attempt_timeout/);
assert.doesNotMatch(browserMeta, /['"]Purchase['"]/);
assert.match(helperSource, /META_PIXEL_ID = '719023677458304'/);
assert.match(helperSource, /META_GRAPH_API_VERSION = 'v26\.0'/);
assert.match(helperSource, /ENABLE_META_CAPI_PURCHASE/);
assert.match(helperSource, /ENABLE_META_CAPI_TEST_EVENTS/);
assert.match(helperSource, /META_CONVERSIONS_API_TOKEN/);
assert.match(helperSource, /marketing_measurement_consent !== 'granted'/);
assert.match(helperSource, /crypto\.subtle\.digest\('SHA-256'/);
assert.match(helperSource, /authorization: `Bearer \$\{accessToken\}`/);
assert.doesNotMatch(helperSource, /access_token=/);
assert.match(helperSource, /`\$\{META_PURCHASE_LOG_PREFIX\}:\$\{/);
assert.match(helperSource, /stripe_purchase:\$\{/);
assert.match(helperSource, /existingLogs\.some/);
assert.match(browserMeta, /export function getMetaCapiAttributionContext/);
assert.match(browserMeta, /_fbp/);
assert.match(browserMeta, /_fbc/);
assert.match(consent, /raw name, contact, street address, or payment details/);
assert.match(legal, /one-way SHA-256 hashes/);
assert.match(legal, /browser attribution and technical request context/);
assert.match(legal, /Meta does not receive raw name, email, phone, street address, payment details, or card details/);
assert.match(critical, /run-g138-meta-capi-purchase-tests\.mjs/);

const helperUrl = new URL('../../base44/functions/stripeWebhook/metaConversions.js', import.meta.url).href;
const {
  META_CONVERSIONS_CONTRACT,
  buildMetaCatalogContents,
  normalizeMetaCatalogContentId,
  sendMetaPurchaseConversion,
} = await import(`${helperUrl}?g138=${Date.now()}`);

const envMap = new Map([
  ['ENABLE_META_CAPI_PURCHASE', 'true'],
  ['ENABLE_META_CAPI_TEST_EVENTS', 'true'],
  ['META_CONVERSIONS_API_TOKEN', 'synthetic-meta-token'],
  ['META_CONVERSIONS_API_TEST_EVENT_CODE', 'TEST_SYNTHETIC_G138'],
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

const event = { id: 'evt_synthetic_g138', created: 1787840000 };
const paymentIntent = {
  id: 'pi_synthetic_g138',
  status: 'succeeded',
  amount_received: 1699,
  currency: 'usd',
  metadata: {
    order_number: 'NV-SYNTH-G138',
    marketing_measurement_consent: 'granted',
    customer_email: 'buyer@example.test',
    customer_phone: '6365550100',
  },
};
const order = {
  id: 'order_synthetic_g138',
  order_number: 'NV-SYNTH-G138',
  customer_email: 'buyer@example.test',
  customer_name: 'Jordan Taylor',
  contact_phone: '(636) 555-0100',
  address_city: 'Wentzville',
  address_state: 'MO',
  address_postal_code: '63385-1234',
  address_country: 'US',
  total: 16.99,
  items: [{ product_id: 'oasis', title: 'OASIS', price: 13, quantity: 1 }],
};
const checkoutData = {
  customer_email: 'buyer@example.test',
  customer_first_name: 'Jordan',
  customer_last_name: 'Taylor',
  customer_app_user_id: 'customer_nuvira_42',
  address_city: 'Wentzville',
  address_state: 'MO',
  address_postal_code: '63385-1234',
  address_country: 'US',
  meta_capi_context: {
    fbp: 'fb.1.1787840000000.1234567890',
    fbc: 'fb.1.1787840001000.IwAR1SyntheticClickId',
    client_ip_address: '203.0.113.42',
    client_user_agent: 'Mozilla/5.0 NuVira Synthetic Browser',
    event_source_url: 'https://nuvirajuice.com/checkout?payment_intent=pi_secret&fbclid=discard-me',
  },
};

const calls = [];
const acceptedFetch = async (url, init) => {
  assert.equal(url, 'https://graph.facebook.com/v26.0/719023677458304/events');
  assert.equal(url.includes('synthetic-meta-token'), false);
  assert.equal(init.headers.authorization, 'Bearer synthetic-meta-token');
  calls.push({ url, init });
  return { ok: true, status: 200, json: async () => ({ events_received: 1 }) };
};

const sha256Hex = async (value) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const sent = await sendMetaPurchaseConversion({ base44, event, paymentIntent, order, checkoutData, fetchImpl: acceptedFetch, env });
assert.equal(sent.sent, true);
assert.equal(sent.event_id, 'stripe_purchase:pi_synthetic_g138');
assert.equal(calls.length, 1);
const payload = JSON.parse(calls[0].init.body);
assert.equal(payload.data[0].event_name, 'Purchase');
assert.equal(payload.data[0].event_id, 'stripe_purchase:pi_synthetic_g138');
assert.equal(payload.data[0].event_source_url, 'https://nuvirajuice.com/checkout');
assert.equal(payload.data[0].custom_data.value, 16.99);
assert.equal(payload.data[0].custom_data.currency, 'USD');
assert.equal(payload.data[0].custom_data.order_id, 'NV-SYNTH-G138');
assert.deepEqual(payload.data[0].custom_data.content_ids, ['43220774944858']);
assert.equal(payload.test_event_code, undefined);
assert.equal(JSON.stringify(payload).includes('buyer@example.test'), false);
assert.equal(JSON.stringify(payload).includes('6365550100'), false);
assert.equal(JSON.stringify(payload).includes('Jordan'), false);
assert.equal(JSON.stringify(payload).includes('Taylor'), false);
assert.equal(JSON.stringify(payload).includes('Wentzville'), false);
assert.equal(JSON.stringify(payload).includes('63385'), false);
assert.equal(payload.data[0].user_data.em[0], await sha256Hex('buyer@example.test'));
assert.equal(payload.data[0].user_data.ph[0], await sha256Hex('16365550100'));
assert.equal(payload.data[0].user_data.fn[0], await sha256Hex('jordan'));
assert.equal(payload.data[0].user_data.ln[0], await sha256Hex('taylor'));
assert.equal(payload.data[0].user_data.ct[0], await sha256Hex('wentzville'));
assert.equal(payload.data[0].user_data.st[0], await sha256Hex('mo'));
assert.equal(payload.data[0].user_data.zp[0], await sha256Hex('63385'));
assert.equal(payload.data[0].user_data.country[0], await sha256Hex('us'));
assert.equal(payload.data[0].user_data.external_id[0], await sha256Hex('customernuvira42'));
assert.equal(payload.data[0].user_data.fbp, 'fb.1.1787840000000.1234567890');
assert.equal(payload.data[0].user_data.fbc, 'fb.1.1787840001000.IwAR1SyntheticClickId');
assert.equal(payload.data[0].user_data.client_ip_address, '203.0.113.42');
assert.equal(payload.data[0].user_data.client_user_agent, 'Mozilla/5.0 NuVira Synthetic Browser');
assert.equal(logs.at(-1).idempotency_key, 'meta_capi_purchase:pi_synthetic_g138');
assert.equal(logs.at(-1).status, 'success');
assert.equal(normalizeMetaCatalogContentId('gid://shopify/ProductVariant/43220774813786'), '43220774813786');
assert.deepEqual(buildMetaCatalogContents([{
  product_id: 'program_hydration_2day',
  price: 104,
  quantity: 1,
  is_program: true,
  bundle_composition: [
    { product_id: 'oasis', quantity: 6 },
    { product_id: 'aura', quantity: 2 },
  ],
}]).map(({ id, quantity }) => ({ id, quantity })), [
  { id: '43220774944858', quantity: 6 },
  { id: '43220774813786', quantity: 2 },
]);

const replay = await sendMetaPurchaseConversion({ base44, event, paymentIntent, order, checkoutData, fetchImpl: acceptedFetch, env });
assert.equal(replay.deduplicated, true);
assert.equal(calls.length, 1, 'successful replay must not make a second provider request');

const denied = await sendMetaPurchaseConversion({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_denied_g138', metadata: { ...paymentIntent.metadata, marketing_measurement_consent: 'denied' } },
  order: { ...order, order_number: 'NV-DENIED-G138' },
  fetchImpl: acceptedFetch,
  env,
});
assert.equal(denied.reason, 'marketing_consent_not_granted');
assert.equal(calls.length, 1);

envMap.set('ENABLE_META_CAPI_PURCHASE', 'false');
const disabled = await sendMetaPurchaseConversion({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_disabled_g138' },
  order: { ...order, order_number: 'NV-DISABLED-G138' },
  fetchImpl: acceptedFetch,
  env,
});
assert.equal(disabled.reason, 'production_gate_disabled');
envMap.set('ENABLE_META_CAPI_PURCHASE', 'true');

const testPayment = {
  ...paymentIntent,
  id: 'pi_test_g138',
  metadata: {
    ...paymentIntent.metadata,
    order_number: 'NV-TEST-G138',
    internal_sandbox_checkout: 'true',
    is_test_order: 'true',
    meta_capi_test_enabled: 'true',
  },
};
const testOrder = { ...order, order_number: 'NV-TEST-G138', is_test_order: true };
const suppressedTest = await sendMetaPurchaseConversion({ base44, event, paymentIntent: testPayment, order: testOrder, checkoutData, fetchImpl: acceptedFetch, env });
assert.equal(suppressedTest.reason, 'test_order_suppressed');
const allowedTest = await sendMetaPurchaseConversion({
  base44, event, paymentIntent: testPayment, order: testOrder, checkoutData, allowTestOrder: true, fetchImpl: acceptedFetch, env,
});
assert.equal(allowedTest.sent, true);
assert.equal(JSON.parse(calls.at(-1).init.body).test_event_code, 'TEST_SYNTHETIC_G138');

const browserMatched = await sendMetaPurchaseConversion({
  base44,
  event,
  paymentIntent: {
    ...paymentIntent,
    id: 'pi_browser_matched_g138',
    metadata: {
      order_number: 'NV-BROWSER-G138',
      marketing_measurement_consent: 'granted',
    },
  },
  order: {
    id: 'order_browser_matched_g138',
    order_number: 'NV-BROWSER-G138',
    total: 16.99,
    items: order.items,
  },
  checkoutData: {
    meta_capi_context: {
      fbp: 'fb.1.1787840002000.0987654321',
      client_ip_address: '203.0.113.43',
      client_user_agent: 'Mozilla/5.0 NuVira Attribution Only',
      event_source_url: 'https://malicious.example/checkout',
    },
  },
  fetchImpl: acceptedFetch,
  env,
});
assert.equal(browserMatched.sent, true);
const browserMatchedPayload = JSON.parse(calls.at(-1).init.body);
assert.equal(browserMatchedPayload.data[0].event_source_url, 'https://nuvirajuice.com/checkout');
assert.equal(browserMatchedPayload.data[0].user_data.fbp, 'fb.1.1787840002000.0987654321');
assert.equal(browserMatchedPayload.data[0].user_data.client_ip_address, '203.0.113.43');
assert.equal(browserMatchedPayload.data[0].user_data.client_user_agent, 'Mozilla/5.0 NuVira Attribution Only');
assert.equal(browserMatchedPayload.data[0].user_data.em, undefined);
assert.equal(browserMatchedPayload.data[0].user_data.ph, undefined);

const rejected = await sendMetaPurchaseConversion({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_rejected_g138' },
  order: { ...order, order_number: 'NV-REJECTED-G138' },
  fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ error: { message: 'synthetic rejection' } }) }),
  env,
});
assert.equal(rejected.reason, 'provider_rejected');
assert.equal(logs.at(-1).status, 'error');

const transportFailure = await sendMetaPurchaseConversion({
  base44,
  event,
  paymentIntent: { ...paymentIntent, id: 'pi_transport_g138' },
  order: { ...order, order_number: 'NV-TRANSPORT-G138' },
  fetchImpl: async () => { throw new Error('synthetic-meta-token buyer@example.test'); },
  env,
});
assert.equal(transportFailure.reason, 'transport_failed');
assert.equal(JSON.stringify(logs).includes('synthetic-meta-token'), false);
assert.equal(JSON.stringify(logs).includes('buyer@example.test'), false);

assert.equal(META_CONVERSIONS_CONTRACT.pixel_id, '719023677458304');
assert.equal(META_CONVERSIONS_CONTRACT.graph_api_version, 'v26.0');

console.log(JSON.stringify({
  ok: true,
  suite: 'g138-meta-capi-purchase',
  assertions: 91,
  browser_purchase_enabled: false,
  production_gate_default: 'disabled_without_exact_env_true',
  deterministic_event_id: true,
  enriched_customer_match_data: true,
  raw_contact_or_address_data_sent: false,
  unexpected_network_requests: 0,
  live_provider_calls_performed: false,
}, null, 2));
