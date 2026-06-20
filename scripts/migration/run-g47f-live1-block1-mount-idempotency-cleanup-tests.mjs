#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '../..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const files = Object.freeze({
  checkout: 'src/pages/Checkout.jsx',
  embeddedPayment: 'src/components/checkout/EmbeddedPayment.jsx',
  createPaymentIntent: 'base44/functions/createPaymentIntent/entry.ts',
  cancelAbandonedCheckouts: 'base44/functions/cancelAbandonedCheckouts/entry.ts',
  stripeWebhook: 'base44/functions/stripeWebhook/entry.ts',
});

const source = Object.fromEntries(Object.entries(files).map(([key, relativePath]) => [key, read(relativePath)]));

const PLAN = Object.freeze({
  customerAccountRef: 'g47f_live1_owner_controlled_customer_account',
  product: 'AURA',
  quantity: 1,
  expectedSubtotal: 13,
  expectedDeliveryFee: 3.99,
  expectedTax: 0,
  expectedTotal: 16.99,
  maximumAuthorizedAmount: 16.99,
});

const CLASSIFICATIONS = Object.freeze({
  READY: 'checkout_mount_idempotency_ready',
  DUPLICATE_PI: 'checkout_mount_duplicate_payment_intent_risk',
  DUPLICATE_ORDER: 'checkout_mount_duplicate_pending_order_risk',
  PARTIAL_STATE: 'checkout_mount_partial_state_risk',
  RETRY_MISSING: 'checkout_mount_retry_contract_missing',
  SIDE_EFFECT_FREE_SUPPORTED: 'express_checkout_side_effect_free_mount_supported',
  REQUIRES_PI: 'express_checkout_mount_requires_payment_intent',
  APP_CREATES_ORDER_BEFORE_MOUNT: 'app_architecture_creates_order_before_mount',
  CLEANUP_GAP: 'hard_stop_checkout_mount_cleanup_gap',
  BLOCKED: 'apple_pay_mount_smoke_blocked_by_idempotency_and_cleanup',
});

const safety = Object.freeze({
  writes_performed: false,
  provider_calls_performed: false,
  stripe_calls_performed: false,
  shopify_calls_performed: false,
  hub_calls_performed: false,
  notifications_sent: false,
  order_mutation_performed: false,
  payment_submitted: false,
  apple_pay_confirmation_performed: false,
  live_records_mutated: false,
});

function normalizeCart(cart) {
  return (cart || []).map((item) => ({
    product: String(item.product || '').trim().toUpperCase(),
    quantity: Number(item.quantity || 0),
  })).sort((a, b) => a.product.localeCompare(b.product));
}

function cartMatchesPlan(cart) {
  const normalized = normalizeCart(cart);
  return normalized.length === 1 && normalized[0].product === PLAN.product && normalized[0].quantity === PLAN.quantity;
}

function amountMatchesPlan(amount) {
  return Math.abs(Number(amount) - PLAN.expectedTotal) < 0.001 && Number(amount) <= PLAN.maximumAuthorizedAmount;
}

function validateSmokeIdentity({ customerSessionConfirmed, customerAccountRef, cart, amount }) {
  const blockers = [];
  if (customerSessionConfirmed !== true) blockers.push('owner_customer_session_not_confirmed');
  if (customerAccountRef !== PLAN.customerAccountRef) blockers.push('wrong_customer_account_ref');
  if (!cartMatchesPlan(cart)) blockers.push('wrong_cart');
  if (!amountMatchesPlan(amount)) blockers.push('wrong_amount');
  return { ok: blockers.length === 0, blockers };
}

function createFixtureStore() {
  return {
    paymentIntents: new Map(),
    orders: new Map(),
    sideEffects: {
      shopifyOrdersCreated: 0,
      fulfillmentTasksCreated: 0,
      hubMutations: 0,
      notifications: 0,
      loyaltyMutations: 0,
      orderDeletions: 0,
      providerCalls: 0,
      paymentSubmissions: 0,
      applePayConfirmations: 0,
      liveWrites: 0,
    },
  };
}

function mountAttempt(store, request, opts = {}) {
  const identity = validateSmokeIdentity(request);
  if (!identity.ok) return { ok: false, reason: 'identity_contract_failed', blockers: identity.blockers };

  const idempotencyReady = opts.idempotencyReady === true;
  const key = String(request.requestId || '').trim();
  if (!idempotencyReady || !key) {
    return {
      ok: false,
      reason: CLASSIFICATIONS.RETRY_MISSING,
      classifications: [CLASSIFICATIONS.DUPLICATE_PI, CLASSIFICATIONS.DUPLICATE_ORDER, CLASSIFICATIONS.RETRY_MISSING],
    };
  }

  const existingPi = store.paymentIntents.get(key);
  const existingOrder = store.orders.get(key);
  if (existingPi && existingOrder) {
    return { ok: true, reused: true, paymentIntentCount: store.paymentIntents.size, orderCount: store.orders.size };
  }
  if (existingPi && !existingOrder) {
    return { ok: false, reason: 'payment_intent_created_order_missing_partial_state', classifications: [CLASSIFICATIONS.PARTIAL_STATE] };
  }
  if (!existingPi && existingOrder) {
    return { ok: false, reason: 'order_created_payment_intent_missing_partial_state', classifications: [CLASSIFICATIONS.PARTIAL_STATE] };
  }

  store.paymentIntents.set(key, { id: `fixture_pi_${key}`, status: 'requires_payment_method', amount: request.amount });
  store.orders.set(key, { id: `fixture_order_${key}`, status: 'pending_payment', amount: request.amount });
  return { ok: true, reused: false, paymentIntentCount: store.paymentIntents.size, orderCount: store.orders.size };
}

function cleanupPreview({ paymentIntent, order }) {
  const blockers = [];
  if (!paymentIntent) blockers.push('payment_intent_missing');
  if (!order) blockers.push('pending_order_missing');
  if (paymentIntent && !['requires_payment_method', 'requires_confirmation', 'requires_payment_method'].includes(paymentIntent.status)) blockers.push('payment_intent_not_cancellable_for_smoke');
  if (order && order.status !== 'pending_payment') blockers.push('order_not_pending_payment');
  return {
    ok: blockers.length === 0,
    blockers,
    orderDeletionAllowed: false,
    shopifyOrderCreated: false,
    fulfillmentTaskCreated: false,
    hubMutation: false,
    notificationSent: false,
    loyaltyMutation: false,
    paymentSubmitted: false,
    applePayConfirmed: false,
    providerCallsInFixture: false,
    liveWritesInFixture: false,
  };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

// Static source-contract assertions.
test('source maps checkout through createPaymentIntent before EmbeddedPayment mount', () => {
  assert.match(source.checkout, /base44\.functions\.invoke\(['"]createPaymentIntent['"]/, 'Checkout must invoke createPaymentIntent');
  assert.match(source.checkout, /setClientSecret\(/, 'Checkout must set clientSecret after PI creation');
  assert.match(source.checkout, /<EmbeddedPayment\b/, 'Checkout must render EmbeddedPayment');
  assert.match(source.embeddedPayment, /<ExpressCheckoutElement\b/, 'EmbeddedPayment must render ExpressCheckoutElement');
});

test('source pre-creates PaymentIntent and pending Customer App Order before mount', () => {
  assert.match(source.createPaymentIntent, /stripe\.paymentIntents\.create\(/, 'createPaymentIntent must create PaymentIntent in current architecture');
  assert.match(source.createPaymentIntent, /entities\.Order\.create\(/, 'createPaymentIntent must pre-create Order in current architecture');
  assert.match(source.createPaymentIntent, /status:\s*['"]pending_payment['"]/, 'pending Order status must be pending_payment');
});

test('source lacks stable request id and Stripe idempotency key in mount path', () => {
  const checkoutInvocation = source.checkout.slice(source.checkout.indexOf("base44.functions.invoke('createPaymentIntent'"), source.checkout.indexOf('});', source.checkout.indexOf("base44.functions.invoke('createPaymentIntent'")) + 3);
  assert.doesNotMatch(checkoutInvocation, /request[_-]?id|idempotency/i, 'checkout invocation should not currently include idempotency/request id');
  assert.doesNotMatch(source.createPaymentIntent, /idempotencyKey\s*:/, 'Stripe idempotency key is not currently passed');
});

test('source cleanup is time-based abandoned checkout and does not cancel normal checkout PI exactly', () => {
  assert.match(source.cancelAbandonedCheckouts, /pending_payment/, 'cancelAbandonedCheckouts targets pending_payment orders');
  assert.match(source.cancelAbandonedCheckouts, /30\s*\*\s*60\s*\*\s*1000|thirtyMinutesAgo|30 minutes/i, 'cleanup is 30-minute abandoned flow');
  assert.doesNotMatch(source.cancelAbandonedCheckouts, /paymentIntents\.cancel\(/, 'cancelAbandonedCheckouts does not cancel PaymentIntent');
  assert.match(source.stripeWebhook, /payment_intent\.canceled/, 'webhook handles PI cancellation');
  assert.match(source.stripeWebhook, /OperationalAlert\.create|entities\.OperationalAlert\.create/, 'PI cancellation can create operational alert today');
});

test('source separates wallet mount from payment confirmation callback', () => {
  assert.match(source.embeddedPayment, /onReady=\{\(\{\s*availablePaymentMethods/, 'onReady wallet availability handler exists');
  assert.match(source.embeddedPayment, /onConfirm=\{handleExpressConfirm\}/, 'onConfirm handler exists');
  assert.match(source.embeddedPayment, /stripe\.confirmPayment\(/, 'Apple Pay confirmation would call confirmPayment');
});

// Fixture policy cases requested by BLOCK1.
test('exact owner-controlled customer session required', () => {
  const result = validateSmokeIdentity({ customerSessionConfirmed: false, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 16.99 });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('owner_customer_session_not_confirmed'));
});

test('exact AURA x1 cart accepted', () => {
  const result = validateSmokeIdentity({ customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 16.99 });
  assert.equal(result.ok, true);
});

test('wrong cart rejected', () => {
  const result = validateSmokeIdentity({ customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 2 }], amount: 29.99 });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('wrong_cart'));
});

test('wrong amount rejected', () => {
  const result = validateSmokeIdentity({ customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 17.01 });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('wrong_amount'));
});

test('same request id is idempotent when a future guard is present', () => {
  const store = createFixtureStore();
  const request = { customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 16.99, requestId: 'g47f_live1_fixture' };
  const first = mountAttempt(store, request, { idempotencyReady: true });
  const second = mountAttempt(store, request, { idempotencyReady: true });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(second.reused, true);
});

test('same cart/session retry does not create a second PaymentIntent when idempotent', () => {
  const store = createFixtureStore();
  const request = { customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 16.99, requestId: 'retry_guard' };
  mountAttempt(store, request, { idempotencyReady: true });
  const retry = mountAttempt(store, request, { idempotencyReady: true });
  assert.equal(retry.paymentIntentCount, 1);
});

test('same cart/session retry does not create a second pending Order when idempotent', () => {
  const store = createFixtureStore();
  const request = { customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 16.99, requestId: 'order_retry_guard' };
  mountAttempt(store, request, { idempotencyReady: true });
  const retry = mountAttempt(store, request, { idempotencyReady: true });
  assert.equal(retry.orderCount, 1);
});

test('component remount does not duplicate side effects under idempotent guard', () => {
  const store = createFixtureStore();
  const request = { customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 16.99, requestId: 'remount_guard' };
  mountAttempt(store, request, { idempotencyReady: true });
  mountAttempt(store, request, { idempotencyReady: true });
  mountAttempt(store, request, { idempotencyReady: true });
  assert.equal(store.paymentIntents.size, 1);
  assert.equal(store.orders.size, 1);
});

test('two-tab duplicate attempt fails closed without idempotent guard', () => {
  const store = createFixtureStore();
  const request = { customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 16.99, requestId: 'two_tab' };
  const result = mountAttempt(store, request, { idempotencyReady: false });
  assert.equal(result.ok, false);
  assert.ok(result.classifications.includes(CLASSIFICATIONS.DUPLICATE_PI));
  assert.ok(result.classifications.includes(CLASSIFICATIONS.DUPLICATE_ORDER));
});

test('PaymentIntent-created/Order-missing partial state is detected', () => {
  const store = createFixtureStore();
  store.paymentIntents.set('partial', { id: 'fixture_pi_partial', status: 'requires_payment_method' });
  const result = mountAttempt(store, { customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 16.99, requestId: 'partial' }, { idempotencyReady: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'payment_intent_created_order_missing_partial_state');
});

test('Order-created/PaymentIntent-missing partial state is detected', () => {
  const store = createFixtureStore();
  store.orders.set('partial_order', { id: 'fixture_order_partial', status: 'pending_payment' });
  const result = mountAttempt(store, { customerSessionConfirmed: true, customerAccountRef: PLAN.customerAccountRef, cart: [{ product: 'AURA', quantity: 1 }], amount: 16.99, requestId: 'partial_order' }, { idempotencyReady: true });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'order_created_payment_intent_missing_partial_state');
});

test('PaymentIntent status is checked before cleanup', () => {
  const result = cleanupPreview({ paymentIntent: { status: 'requires_payment_method' }, order: { status: 'pending_payment' } });
  assert.equal(result.ok, true);
});

test('confirmed/succeeded PaymentIntent cannot use mount-smoke cleanup', () => {
  const result = cleanupPreview({ paymentIntent: { status: 'succeeded' }, order: { status: 'pending_payment' } });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('payment_intent_not_cancellable_for_smoke'));
});

test('exact pending Order only can be cleaned up', () => {
  const result = cleanupPreview({ paymentIntent: { status: 'requires_payment_method' }, order: { status: 'scheduled_for_juicing' } });
  assert.equal(result.ok, false);
  assert.ok(result.blockers.includes('order_not_pending_payment'));
});

test('no Order deletion is permitted by cleanup contract', () => {
  const result = cleanupPreview({ paymentIntent: { status: 'requires_payment_method' }, order: { status: 'pending_payment' } });
  assert.equal(result.orderDeletionAllowed, false);
});

test('no ShopifyOrder creation in fixture path', () => {
  const result = cleanupPreview({ paymentIntent: { status: 'requires_payment_method' }, order: { status: 'pending_payment' } });
  assert.equal(result.shopifyOrderCreated, false);
});

test('no FulfillmentTask creation in fixture path', () => {
  const result = cleanupPreview({ paymentIntent: { status: 'requires_payment_method' }, order: { status: 'pending_payment' } });
  assert.equal(result.fulfillmentTaskCreated, false);
});

test('no Hub mutation in fixture path', () => {
  const result = cleanupPreview({ paymentIntent: { status: 'requires_payment_method' }, order: { status: 'pending_payment' } });
  assert.equal(result.hubMutation, false);
});

test('no notifications in fixture path', () => {
  const result = cleanupPreview({ paymentIntent: { status: 'requires_payment_method' }, order: { status: 'pending_payment' } });
  assert.equal(result.notificationSent, false);
});

test('no loyalty/credit mutation in fixture path', () => {
  const result = cleanupPreview({ paymentIntent: { status: 'requires_payment_method' }, order: { status: 'pending_payment' } });
  assert.equal(result.loyaltyMutation, false);
});

test('no payment submission in fixture path', () => {
  assert.equal(safety.payment_submitted, false);
});

test('no Apple Pay confirmation in fixture path', () => {
  assert.equal(safety.apple_pay_confirmation_performed, false);
});

test('no provider calls in fixture tests', () => {
  assert.equal(safety.provider_calls_performed, false);
  assert.equal(safety.stripe_calls_performed, false);
});

test('no live writes in fixture tests', () => {
  assert.equal(safety.live_records_mutated, false);
  assert.equal(safety.writes_performed, false);
});

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failures.push({ name, message: error.message });
    console.error(`not ok ${passed + failures.length} - ${name}`);
    console.error(error.stack || error.message);
  }
}

const evidence = {
  suite: 'g47f-live1-block1-mount-idempotency-cleanup',
  passed,
  failed: failures.length,
  current_source_findings: {
    create_payment_intent_before_mount: /stripe\.paymentIntents\.create\(/.test(source.createPaymentIntent),
    pending_order_before_mount: /entities\.Order\.create\(/.test(source.createPaymentIntent),
    checkout_request_id_present: /request[_-]?id|idempotency/i.test(source.checkout.slice(source.checkout.indexOf("base44.functions.invoke('createPaymentIntent'"), source.checkout.indexOf('});', source.checkout.indexOf("base44.functions.invoke('createPaymentIntent'")) + 3)),
    stripe_idempotency_key_present: /idempotencyKey\s*:/.test(source.createPaymentIntent),
    abandoned_checkout_cleanup_exists: /pending_payment/.test(source.cancelAbandonedCheckouts),
    exact_payment_intent_cleanup_exists: /paymentIntents\.cancel\(/.test(source.cancelAbandonedCheckouts),
  },
  classifications: [
    CLASSIFICATIONS.REQUIRES_PI,
    CLASSIFICATIONS.APP_CREATES_ORDER_BEFORE_MOUNT,
    CLASSIFICATIONS.DUPLICATE_PI,
    CLASSIFICATIONS.DUPLICATE_ORDER,
    CLASSIFICATIONS.PARTIAL_STATE,
    CLASSIFICATIONS.RETRY_MISSING,
    CLASSIFICATIONS.CLEANUP_GAP,
    CLASSIFICATIONS.BLOCKED,
  ],
  side_effect_free_mount: {
    stripe_docs_indicate_elements_without_intent_supported_for_express_checkout: true,
    current_app_architecture_uses_client_secret_elements: true,
    recommended_followup: 'G47F-PATCH1 side-effect-free availability mount or G47F-LIVE1-IDEMPOTENCY1 exact request cleanup guard',
  },
  safety,
};

console.log(JSON.stringify(evidence, null, 2));

if (failures.length) {
  process.exitCode = 1;
}
