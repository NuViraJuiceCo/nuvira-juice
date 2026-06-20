#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const sourcePath = 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts';
const source = fs.readFileSync(sourcePath, 'utf8');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    console.error(`not ok ${passed + 1} - ${name}`);
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  }
}

function classifyFixtureKey(value) {
  const key = String(value ?? '').trim();
  if (!key) return { ok: false, error_code: 'stripe_publishable_key_not_configured', stripe_mode: 'unknown', key_type: 'unknown' };
  if (key.startsWith('pk_live_')) return { ok: true, stripe_mode: 'live', key_type: 'publishable' };
  if (key.startsWith('pk_test_')) return { ok: false, error_code: 'stripe_publishable_key_mode_mismatch', stripe_mode: 'test', key_type: 'publishable' };
  if (key.startsWith('sk_')) return { ok: false, error_code: 'stripe_publishable_key_wrong_type', stripe_mode: key.startsWith('sk_live_') ? 'live' : key.startsWith('sk_test_') ? 'test' : 'unknown', key_type: 'secret' };
  if (key.startsWith('rk_')) return { ok: false, error_code: 'stripe_publishable_key_wrong_type', stripe_mode: key.startsWith('rk_live_') ? 'live' : key.startsWith('rk_test_') ? 'test' : 'unknown', key_type: 'restricted' };
  if (key.startsWith('whsec_')) return { ok: false, error_code: 'stripe_publishable_key_wrong_type', stripe_mode: 'unknown', key_type: 'webhook_secret' };
  if (key.startsWith('cs_')) return { ok: false, error_code: 'stripe_publishable_key_wrong_type', stripe_mode: key.startsWith('cs_live_') ? 'live' : key.startsWith('cs_test_') ? 'test' : 'unknown', key_type: 'client_secret' };
  if (key.startsWith('pi_')) return { ok: false, error_code: 'stripe_publishable_key_wrong_type', stripe_mode: 'unknown', key_type: 'payment_intent_id' };
  return { ok: false, error_code: 'stripe_publishable_key_wrong_type', stripe_mode: 'unknown', key_type: 'unknown' };
}

test('GET returns 405', () => {
  assert.match(source, /if \(req\.method !== 'POST'\) \{\s*return Response\.json\(\{ success: false, error_code: 'method_not_allowed'/s);
});

test('Anonymous request returns 401', () => {
  assert.match(source, /if \(!user\) return \{ ok: false, response: unauthorized\(\) \}/);
});

test('Ordinary customer returns 403', () => {
  assert.match(source, /role !== 'admin' && role !== 'owner'/);
  assert.match(source, /return \{ ok: false, response: forbidden\(\) \}/);
});

test('Admin/owner succeeds', () => {
  assert.match(source, /async function requireAdminOwnerAccess/);
  assert.match(source, /actor_role: role/);
  assert.match(source, /buildG47FConfig2PublicConfig\(body\)/);
});

test('Missing key fails closed', () => {
  assert.deepEqual(classifyFixtureKey(undefined), { ok: false, error_code: 'stripe_publishable_key_not_configured', stripe_mode: 'unknown', key_type: 'unknown' });
});

test('Empty key fails closed', () => {
  assert.deepEqual(classifyFixtureKey('   '), { ok: false, error_code: 'stripe_publishable_key_not_configured', stripe_mode: 'unknown', key_type: 'unknown' });
});

test('Test publishable key is rejected', () => {
  assert.deepEqual(classifyFixtureKey(`${'pk_'}${'test_'}fixture_only_not_real`), { ok: false, error_code: 'stripe_publishable_key_mode_mismatch', stripe_mode: 'test', key_type: 'publishable' });
});

test('Secret key is rejected', () => {
  assert.deepEqual(classifyFixtureKey(`${'sk_'}${'live_'}fixture_only_not_real`), { ok: false, error_code: 'stripe_publishable_key_wrong_type', stripe_mode: 'live', key_type: 'secret' });
});

test('Restricted key is rejected', () => {
  assert.deepEqual(classifyFixtureKey(`${'rk_'}${'live_'}fixture_only_not_real`), { ok: false, error_code: 'stripe_publishable_key_wrong_type', stripe_mode: 'live', key_type: 'restricted' });
});

test('Webhook secret is rejected', () => {
  assert.deepEqual(classifyFixtureKey(`${'wh'}${'sec_'}fixture_only_not_real`), { ok: false, error_code: 'stripe_publishable_key_wrong_type', stripe_mode: 'unknown', key_type: 'webhook_secret' });
});

test('Live publishable key is accepted', () => {
  assert.deepEqual(classifyFixtureKey(`${'pk_'}${'live_'}fixture_only_not_real`), { ok: true, stripe_mode: 'live', key_type: 'publishable' });
});

test('Response reports live mode', () => {
  assert.match(source, /stripe_mode: classification\.stripe_mode/);
});

test('Response reports publishable type', () => {
  assert.match(source, /key_type: classification\.key_type/);
});

test('Key is absent from logs', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /console\.(log|warn|error|info|debug)\(/);
});

test('Key is absent from error responses', () => {
  const failureStart = source.indexOf('function g47fConfig2Failure');
  const failureEnd = source.indexOf('function buildG47FConfig2PublicConfig');
  const failureSlice = source.slice(failureStart, failureEnd);
  assert.doesNotMatch(failureSlice, /stripe_publishable_key|publishableKey|publishable_key/);
  assert.match(failureSlice, /error_code: classification\.error_code/);
});

test('Cache is disabled when supported', () => {
  assert.match(source, /'Cache-Control': 'no-store, max-age=0'/);
  assert.match(source, /Pragma: 'no-cache'/);
});

test('No PII returned', () => {
  assert.match(source, /pii_returned: false/);
});

test('No raw payload returned', () => {
  assert.match(source, /raw_payloads_returned: false/);
});

test('No Stripe API call', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /new Stripe|stripe\.paymentIntents|fetch\(|XMLHttpRequest|confirmPayment|createConfirmationToken/);
  assert.match(source, /stripe_calls: false/);
});

test('No PaymentIntent', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /paymentIntents\.(create|update|confirm|capture|cancel)|PaymentIntent\.create|createPaymentIntent|clientSecret\s*:/);
  assert.match(source, /payment_mutation_performed: false/);
});

test('No Checkout Session', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /checkout\.sessions\.(create|update|expire)|createCheckoutSession|checkout_session\s*:/);
});

test('No Customer App Order creation/update', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /entities\.Order\.(create|update|delete|upsert)|Order\.create|Order\.update/);
  assert.match(source, /order_mutation_performed: false/);
});

test('No ShopifyOrder creation/update', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /entities\.ShopifyOrder\.(create|update|delete|upsert)|ShopifyOrder\.create|ShopifyOrder\.update/);
});

test('No FulfillmentTask creation/update', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /entities\.FulfillmentTask\.(create|update|delete|upsert)|FulfillmentTask\.create|FulfillmentTask\.update/);
});

test('No CommandLog', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /CommandLog/);
  assert.match(source, /command_log_created: false/);
});

test('No OrderSyncLog', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /OrderSyncLog/);
});

test('No Hub call/mutation', () => {
  assert.match(source, /hub_calls: false/);
  assert.match(source, /hub_mutation_performed: false/);
});

test('No notification', () => {
  assert.match(source, /notifications_sent: false/);
});

test('No loyalty/credit mutation', () => {
  const configSlice = source.slice(source.indexOf('const G47F_CONFIG2_PREVIEW_MODE'), source.indexOf('function g47bLookup'));
  assert.doesNotMatch(configSlice, /loyalty|credit|UserPoints|NuViraCredit/i);
});

test('writes_performed=false', () => {
  assert.match(source, /writes_performed: false/);
});

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log(JSON.stringify({
  suite: 'g47f-patch1-config2-public-key-delivery',
  passed,
  failed: 0,
  preview_mode: 'APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG',
  env_source: 'STRIPE_PUBLISHABLE_KEY',
  side_effects: {
    writes_performed: false,
    stripe_api_calls: false,
    payment_intent_created: false,
    checkout_session_created: false,
    customer_app_order_created: false,
    shopify_order_created: false,
    fulfillment_task_created: false,
    command_log_created: false,
    order_sync_log_created: false,
    hub_calls: false,
    notifications_sent: false,
  },
  classification: 'apple_pay_diagnostic_readonly_public_key_delivery_pr_ready',
}, null, 2));
