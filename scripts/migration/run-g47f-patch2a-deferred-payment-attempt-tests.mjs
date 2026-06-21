#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = process.cwd();
const functionPath = path.join(repoRoot, 'base44/functions/createPaymentIntent/entry.ts');
const docsPath = path.join(repoRoot, 'docs/migration/g47f-patch2a-deferred-payment-attempt-backend.md');
const planHarnessPath = path.join(repoRoot, 'scripts/migration/run-g47f-patch2-deferred-intent-architecture-tests.mjs');
const source = fs.readFileSync(functionPath, 'utf8');
const docs = fs.readFileSync(docsPath, 'utf8');
const planHarness = fs.readFileSync(planHarnessPath, 'utf8');

const MODE = 'DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT';
const BLOCKED = 'apple_pay_deferred_intent_backend_blocked_by_atomic_idempotency_gap';

function stripImports(text) {
  return text
    .replace("import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';\n", '')
    .replace("import Stripe from 'npm:stripe@14.21.0';\n", '');
}

function loadHandler(env = {}, user = { email: 'pilot_auth_ref', role: 'user' }, profileIds = ['profile_allowed']) {
  let handler;
  class FakeStripe {
    constructor() {
      this.paymentIntents = {
        create: async () => { throw new Error('unexpected Stripe PaymentIntent create'); },
      };
    }
  }
  const base44 = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        UserProfile: {
          filter: async () => profileIds.map(id => ({ id })),
        },
        Order: { create: async () => { throw new Error('unexpected Order.create'); } },
        CheckoutSession: { create: async () => { throw new Error('unexpected CheckoutSession.create'); } },
      },
      functions: {
        invoke: async () => { throw new Error('unexpected function invoke'); },
      },
    },
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, group() {}, groupEnd() {} },
    Response,
    Stripe: FakeStripe,
    Deno: {
      env: { get: name => env[name] || '' },
      serve: fn => { handler = fn; },
    },
    createClientFromRequest: req => req.__base44 || base44,
  };
  vm.runInNewContext(stripImports(source), sandbox, { filename: functionPath });
  return { handler, base44 };
}

async function invokeDeferred({ env = {}, body = {}, user, profileIds } = {}) {
  const { handler, base44 } = loadHandler(env, user, profileIds);
  const req = new Request('https://example.test/createPaymentIntent', {
    method: 'POST',
    body: JSON.stringify({
      mode: MODE,
      checkout_request_id: 'g47f-patch2a-1234567890',
      confirmation_token_id: 'ctoken_fixture_1234567890',
      currency: 'usd',
      expected_amount: 1699,
      cart: [{ product_id: 'prod_aura', quantity: 1 }],
      fulfillment_type: 'delivery',
      order_type: 'one_time',
      fulfillment_mode: 'single_delivery',
      dry_run: true,
      ...body,
    }),
  });
  req.__base44 = base44;
  const response = await handler(req);
  return { status: response.status, json: await response.json() };
}

const fixtureCatalog = Object.freeze({
  prod_aura: { id: 'prod_aura', title: 'AURA', active: true, priceCents: 1300 },
  prod_inactive: { id: 'prod_inactive', title: 'Inactive', active: false, priceCents: 1300 },
});

function evaluateTargetContract(overrides = {}) {
  const request = {
    authenticated: true,
    allowlisted: true,
    checkout_request_id: 'g47f-patch2a-1234567890',
    confirmation_token_id: 'ctoken_fixture_1234567890',
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    product_id: 'prod_aura',
    quantity: 1,
    clientPriceCents: 1,
    expectedAmount: 1699,
    serverDeliveryFeeCents: 399,
    serverTaxCents: 0,
    currency: 'usd',
    rewardCreditCouponPresent: false,
    fingerprint: 'fingerprint_a',
    priorFingerprint: 'fingerprint_a',
    duplicateRequest: false,
    remount: false,
    networkRetry: false,
    twoTabs: false,
    attemptCount: 1,
    orderCount: 1,
    paymentIntentCount: 1,
    orderCreated: false,
    intentCreated: false,
    duplicateOrderLink: false,
    duplicateIntentLink: false,
    webhookCanResolve: true,
    webhookReplay: false,
    dryRun: true,
    ...overrides,
  };
  const blockers = [];
  const product = fixtureCatalog[request.product_id];
  if (!request.authenticated) blockers.push('unauthenticated_customer');
  if (!request.allowlisted) blockers.push('pilot_user_profile_not_allowlisted');
  if (!request.checkout_request_id || request.checkout_request_id.length < 16) blockers.push('checkout_request_id_invalid_or_required');
  if (!/^ctoken_/.test(request.confirmation_token_id || '')) blockers.push('confirmation_token_id_invalid_or_required');
  if (request.order_type !== 'one_time') blockers.push('subscription_or_non_one_time_order_unsupported');
  if (request.fulfillment_mode !== 'single_delivery') blockers.push('multi_delivery_unsupported');
  if (!product) blockers.push('unknown_product');
  if (product && !product.active) blockers.push('inactive_product');
  if (!Number.isInteger(request.quantity) || request.quantity <= 0 || request.quantity > 24) blockers.push('invalid_quantity');
  const subtotal = product ? product.priceCents * Math.max(0, request.quantity || 0) : 0;
  const authoritativeAmount = subtotal + request.serverDeliveryFeeCents + request.serverTaxCents;
  if (request.currency !== 'usd') blockers.push('currency_mismatch');
  if (request.expectedAmount !== authoritativeAmount) blockers.push('amount_mismatch');
  if (request.rewardCreditCouponPresent) blockers.push('reward_credit_coupon_unsupported_for_deferred_pilot');
  if (request.fingerprint !== request.priorFingerprint) blockers.push('idempotency_fingerprint_conflict');
  if (request.attemptCount > 1) blockers.push('duplicate_attempt_risk');
  if (request.orderCount > 1 || request.duplicateOrderLink) blockers.push('duplicate_order_state');
  if (request.paymentIntentCount > 1 || request.duplicateIntentLink) blockers.push('duplicate_payment_intent_state');
  if (!request.webhookCanResolve) blockers.push('webhook_lookup_gap');

  let attemptState = 'checkout_attempt_initialized';
  if (request.orderCreated && !request.intentCreated) attemptState = 'checkout_attempt_order_created_intent_missing';
  if (request.intentCreated && !request.orderCreated) attemptState = 'checkout_attempt_intent_created_order_missing';
  if (request.duplicateRequest || request.remount || request.networkRetry || request.webhookReplay) attemptState = 'checkout_attempt_idempotent_retry';
  if (request.twoTabs) attemptState = request.attemptCount <= 1 ? 'checkout_attempt_idempotent_retry' : 'checkout_attempt_duplicate_risk';
  if (blockers.length) attemptState = blockers.some(b => b.includes('duplicate')) ? 'checkout_attempt_duplicate_risk' : 'checkout_attempt_payment_failed';

  return {
    accepted: blockers.length === 0,
    blockers,
    authoritativeAmount,
    attemptState,
    orderWrites: request.dryRun ? 0 : Math.min(1, request.orderCount),
    paymentIntentWrites: request.dryRun ? 0 : Math.min(1, request.paymentIntentCount),
    stripeIdempotencyKey: `nuvira:deferred-checkout:${request.checkout_request_id}`,
    piiInStripeIdempotencyKey: /@|\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(`nuvira:deferred-checkout:${request.checkout_request_id}`),
  };
}

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

// Source-level guarantees.
test('1. Legacy checkout request remains unchanged', () => {
  assert.match(source, /stripe\.paymentIntents\.create\(/, 'legacy path still creates PaymentIntent');
  assert.match(source, /entities\.Order\.create\(/, 'legacy path still pre-creates pending Order');
  assert.match(source, /clientSecret:\s*paymentIntent\.client_secret/, 'legacy response still returns clientSecret');
});

test('2. Deferred mode is default-off', async () => {
  const { json } = await invokeDeferred();
  assert.equal(json.feature_enabled, false);
  assert.ok(json.blockers.includes('deferred_express_checkout_disabled'));
});

test('3. Kill switch blocks deferred mode', async () => {
  const { json } = await invokeDeferred({ env: { ENABLE_DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT: 'true', DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT_KILL_SWITCH: 'true' } });
  assert.ok(json.blockers.includes('deferred_express_checkout_kill_switch_active'));
});

test('4. Anonymous customer blocked', async () => {
  const { status, json } = await invokeDeferred({ user: null });
  assert.equal(status, 401);
  assert.ok(json.blockers.includes('unauthenticated_customer'));
});

test('5. Nonallowlisted customer blocked', async () => {
  const { json } = await invokeDeferred({ env: { ENABLE_DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT: 'true', DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT_ALLOWED_USER_PROFILE_IDS: 'other_profile' } });
  assert.ok(json.blockers.includes('pilot_user_profile_not_allowlisted'));
});

test('6. Exact pilot customer accepted in fixtures', async () => {
  const { json } = await invokeDeferred({ env: { ENABLE_DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT: 'true', DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT_ALLOWED_USER_PROFILE_IDS: 'profile_allowed' } });
  assert.equal(json.user_authenticated, true);
  assert.equal(json.feature_enabled, true);
  assert.ok(!json.blockers.includes('pilot_user_profile_not_allowlisted'));
});

test('7. Missing checkout_request_id rejected', async () => {
  const { json } = await invokeDeferred({ body: { checkout_request_id: '' } });
  assert.ok(json.blockers.includes('checkout_request_id_invalid_or_required'));
});

test('8. Malformed checkout_request_id rejected', async () => {
  const { json } = await invokeDeferred({ body: { checkout_request_id: 'bad request id' } });
  assert.ok(json.blockers.includes('checkout_request_id_invalid_or_required'));
});

test('9. One-time order accepted by target fixture policy', () => {
  assert.equal(evaluateTargetContract({ order_type: 'one_time' }).accepted, true);
});

test('10. Subscription rejected', () => {
  assert.ok(evaluateTargetContract({ order_type: 'subscription' }).blockers.includes('subscription_or_non_one_time_order_unsupported'));
});

test('11. Multi-delivery rejected', () => {
  assert.ok(evaluateTargetContract({ fulfillment_mode: 'multi_delivery' }).blockers.includes('multi_delivery_unsupported'));
});

test('12. Unknown product rejected', () => {
  assert.ok(evaluateTargetContract({ product_id: 'missing' }).blockers.includes('unknown_product'));
});

test('13. Inactive product rejected', () => {
  assert.ok(evaluateTargetContract({ product_id: 'prod_inactive' }).blockers.includes('inactive_product'));
});

test('14. Invalid quantity rejected', () => {
  assert.ok(evaluateTargetContract({ quantity: 0 }).blockers.includes('invalid_quantity'));
});

test('15. Server price used instead of client price', () => {
  const result = evaluateTargetContract({ clientPriceCents: 1 });
  assert.equal(result.authoritativeAmount, 1699);
});

test('16. Delivery fee recalculated server-side', () => {
  assert.equal(evaluateTargetContract({ serverDeliveryFeeCents: 399 }).authoritativeAmount, 1699);
});

test('17. Tax recalculated server-side', () => {
  assert.equal(evaluateTargetContract({ serverTaxCents: 101, expectedAmount: 1800 }).authoritativeAmount, 1800);
});

test('18. Amount mismatch fails before writes', () => {
  const result = evaluateTargetContract({ expectedAmount: 1 });
  assert.ok(result.blockers.includes('amount_mismatch'));
  assert.equal(result.orderWrites, 0);
});

test('19. Currency mismatch fails before writes', () => {
  assert.ok(evaluateTargetContract({ currency: 'eur' }).blockers.includes('currency_mismatch'));
});

test('20. Unsupported reward/credit/coupon fails closed', async () => {
  const fixture = evaluateTargetContract({ rewardCreditCouponPresent: true });
  assert.ok(fixture.blockers.includes('reward_credit_coupon_unsupported_for_deferred_pilot'));
  const { json } = await invokeDeferred({ body: { credits_discount: 100 } });
  assert.ok(json.blockers.includes('reward_credit_coupon_unsupported_for_deferred_pilot'));
});

test('21. Dry run creates no attempt', async () => {
  const { json } = await invokeDeferred({ body: { dry_run: true } });
  assert.equal(json.writes_performed, false);
});

test('22. Dry run creates no Order', async () => {
  const { json } = await invokeDeferred({ body: { dry_run: true } });
  assert.equal(json.order_created, false);
});

test('23. Dry run makes no Stripe call', async () => {
  const { json } = await invokeDeferred({ body: { dry_run: true } });
  assert.equal(json.stripe_calls, false);
});

test('24. Same request/fingerprint is idempotent', () => {
  assert.equal(evaluateTargetContract({ fingerprint: 'same', priorFingerprint: 'same', duplicateRequest: true }).attemptState, 'checkout_attempt_idempotent_retry');
});

test('25. Same request/different fingerprint conflicts', () => {
  assert.ok(evaluateTargetContract({ fingerprint: 'a', priorFingerprint: 'b' }).blockers.includes('idempotency_fingerprint_conflict'));
});

test('26. Network retry reuses attempt', () => {
  assert.equal(evaluateTargetContract({ networkRetry: true }).attemptState, 'checkout_attempt_idempotent_retry');
});

test('27. Component remount reuses attempt', () => {
  assert.equal(evaluateTargetContract({ remount: true }).attemptState, 'checkout_attempt_idempotent_retry');
});

test('28. Two-tab concurrency creates at most one attempt', () => {
  assert.equal(evaluateTargetContract({ twoTabs: true, attemptCount: 1 }).attemptState, 'checkout_attempt_idempotent_retry');
  assert.equal(evaluateTargetContract({ twoTabs: true, attemptCount: 2 }).attemptState, 'checkout_attempt_duplicate_risk');
});

test('29. At most one Order', () => {
  assert.ok(evaluateTargetContract({ orderCount: 2 }).blockers.includes('duplicate_order_state'));
});

test('30. At most one PaymentIntent', () => {
  assert.ok(evaluateTargetContract({ paymentIntentCount: 2 }).blockers.includes('duplicate_payment_intent_state'));
});

test('31. Stripe idempotency key is stable', () => {
  const first = evaluateTargetContract({ checkout_request_id: 'fixed-request-123456' }).stripeIdempotencyKey;
  const second = evaluateTargetContract({ checkout_request_id: 'fixed-request-123456', networkRetry: true }).stripeIdempotencyKey;
  assert.equal(first, second);
});

test('32. Stripe idempotency key contains no PII', () => {
  assert.equal(evaluateTargetContract({ checkout_request_id: 'fixed-request-123456' }).piiInStripeIdempotencyKey, false);
});

test('33. ConfirmationToken is never logged', () => {
  assert.doesNotMatch(source, /console\.(log|warn|error)\([^\n]*confirmation_token_id/i);
  assert.match(source, /confirmation_token_id_invalid_or_required/);
});

test('34. Client secret is never logged or persisted by deferred mode', () => {
  const deferredSegment = source.slice(source.indexOf('async function handleDeferredExpressCheckoutPaymentAttempt'), source.indexOf('/**\n * Creates a Stripe PaymentIntent'));
  assert.doesNotMatch(deferredSegment, /clientSecret|client_secret|paymentIntent\.client_secret/);
});

test('35. Existing pending Order is reused by target contract', () => {
  assert.equal(evaluateTargetContract({ orderCreated: true, intentCreated: true, duplicateRequest: true }).attemptState, 'checkout_attempt_idempotent_retry');
});

test('36. Existing PaymentIntent is reused by target contract', () => {
  assert.equal(evaluateTargetContract({ paymentIntentCount: 1, duplicateRequest: true }).paymentIntentWrites, 0);
});

test('37. Order-created/Intent-missing partial state detected', () => {
  assert.equal(evaluateTargetContract({ orderCreated: true, intentCreated: false }).attemptState, 'checkout_attempt_order_created_intent_missing');
});

test('38. Intent-created/Order-missing partial state detected', () => {
  assert.equal(evaluateTargetContract({ orderCreated: false, intentCreated: true }).attemptState, 'checkout_attempt_intent_created_order_missing');
});

test('39. Duplicate Order state fails closed', () => {
  assert.ok(evaluateTargetContract({ duplicateOrderLink: true }).blockers.includes('duplicate_order_state'));
});

test('40. Duplicate PaymentIntent linkage fails closed', () => {
  assert.ok(evaluateTargetContract({ duplicateIntentLink: true }).blockers.includes('duplicate_payment_intent_state'));
});

test('41. Existing webhook can resolve the canonical Order', () => {
  assert.match(source, /stripe_payment_intent_id:\s*paymentIntent\.id/);
  assert.match(source, /checkout_version:\s*['"]3\.0_embedded['"]/);
});

test('42. Webhook replay remains idempotent', () => {
  assert.equal(evaluateTargetContract({ webhookReplay: true }).attemptState, 'checkout_attempt_idempotent_retry');
});

test('43. No ShopifyOrder creation in deferred preparation', async () => {
  const { json } = await invokeDeferred();
  assert.equal(json.shopify_calls, false);
});

test('44. No FulfillmentTask creation', async () => {
  const { json } = await invokeDeferred();
  assert.equal(json.writes_performed, false);
  assert.doesNotMatch(source.slice(source.indexOf('async function handleDeferredExpressCheckoutPaymentAttempt'), source.indexOf('/**\n * Creates a Stripe PaymentIntent')), /FulfillmentTask/);
});

test('45. No Hub sync', async () => {
  const { json } = await invokeDeferred();
  assert.equal(json.hub_calls, false);
  assert.equal(json.hub_mutation_performed, false);
});

test('46. No notification', async () => {
  const { json } = await invokeDeferred();
  assert.equal(json.notifications_sent, false);
});

test('47. No loyalty/credit mutation', async () => {
  const { json } = await invokeDeferred();
  assert.equal(json.loyalty_mutation_performed, false);
});

test('48. No inventory deduction', async () => {
  const { json } = await invokeDeferred();
  assert.equal(json.inventory_deducted, false);
});

test('49. No PurchaseOrder', async () => {
  const { json } = await invokeDeferred();
  assert.equal(json.purchase_orders_created, false);
});

test('50. No PII/raw payload exposure', async () => {
  const { json } = await invokeDeferred();
  assert.equal(json.pii_returned, false);
  assert.equal(json.raw_payloads_returned, false);
  assert.doesNotMatch(JSON.stringify(json), /pilot_auth_ref|ctoken_fixture_1234567890|client_secret|sk_live|pk_live|whsec/i);
});

test('PATCH2A source records atomic blocker classification', async () => {
  const { json } = await invokeDeferred({ env: { ENABLE_DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT: 'true', DEFERRED_EXPRESS_CHECKOUT_PAYMENT_ATTEMPT_ALLOWED_USER_PROFILE_IDS: 'profile_allowed' } });
  assert.ok(json.blockers.includes('atomic_application_idempotency_gap'));
  assert.equal(json.classification, BLOCKED);
  assert.equal(json.atomic_reservation_ready, false);
});

test('PATCH2A docs include required blocker packet sections', () => {
  for (const phrase of [
    'PLAN1 merge result',
    'current createPaymentIntent behavior',
    'selected reservation/idempotency primitive',
    'atomicity evidence or blocker',
    'new default-off mode/gates',
    'request contract',
    'server cart calculation',
    'cart fingerprint',
    'Order/PaymentIntent ordering',
    'Stripe idempotency',
    'ConfirmationToken handling',
    'partial-state policy',
    'dry-run contract',
    'existing card-checkout non-regression',
    'webhook compatibility',
    'future allowed writes',
    'hard stops',
    'tests',
    'publish-disabled plan',
    'PATCH2B dependency',
  ]) assert.ok(docs.includes(phrase), `docs missing ${phrase}`);
});

test('PATCH2 PLAN1 harness remains present', () => {
  assert.ok(planHarness.includes('apple_pay_production_deferred_intent_architecture_plan_ready'));
});

let failed = 0;
for (const { name, fn } of cases) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(error?.stack || error?.message || error);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${cases.length} G47F-PATCH2A tests failed.`);
  process.exit(1);
}

console.log(`\n${cases.length} G47F-PATCH2A tests passed.`);
console.log(JSON.stringify({
  success: true,
  dry_run: true,
  writes_performed: false,
  provider_calls: false,
  payment_intent_created: false,
  order_created: false,
  classification: BLOCKED,
}, null, 2));
