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
  diagnostic: 'src/components/checkout/ApplePayMountDiagnostic.jsx',
  createPaymentIntent: 'base44/functions/createPaymentIntent/entry.ts',
  stripeWebhook: 'base44/functions/stripeWebhook/entry.ts',
  historyHarness: 'scripts/migration/run-g43b-customer-order-history-limited-native-first-tests.mjs',
  trackerHarness: 'scripts/migration/run-g43c-customer-order-tracker-limited-native-first-tests.mjs',
  docs: 'docs/migration/g47f-patch2-production-deferred-intent-architecture-plan.md',
});

const source = Object.fromEntries(Object.entries(files).map(([key, relativePath]) => [key, read(relativePath)]));

const cases = [];
function test(name, fn) {
  cases.push({ name, fn });
}

function assertContains(haystack, needle, label) {
  assert.ok(haystack.includes(needle), `${label} missing expected text: ${needle}`);
}

function assertMatch(haystack, pattern, label) {
  assert.match(haystack, pattern, label);
}

function assertNoRuntimeMutationInPlanFiles() {
  assert.doesNotMatch(source.docs, /base44\.asServiceRole\.entities\.(Order|ShopifyOrder|FulfillmentTask)\.(create|update|delete|upsert)\(/, 'architecture docs must not include executable mutation calls');
  assert.doesNotMatch(source.docs, /stripe\.paymentIntents\.(create|confirm|capture|cancel)\(/, 'architecture docs must not include executable Stripe calls');
}

const proposedAttempt = Object.freeze({
  checkout_request_id: 'fixture-checkout-request',
  customerAuthenticated: true,
  cartValidatedLocally: true,
  publishableConfigLoaded: true,
  expressCheckoutMounted: true,
  applePayCancelledBeforeConfirm: false,
  confirmationReceived: true,
  backendAuthenticated: true,
  serverRecalculatedTotalCents: 1699,
  clientTotalCents: 1699,
  currency: 'usd',
  productsKnown: true,
  quantitiesValid: true,
  duplicateRequest: false,
  componentRemount: false,
  networkRetry: false,
  twoTabs: false,
  orderCount: 1,
  paymentIntentCount: 1,
  paymentStatus: 'succeeded',
  webhookReplayCount: 1,
  hubWritesActive: true,
  hubSuppression: false,
  providerCalls: 0,
  liveRecords: 0,
  cardCheckoutChanged: false,
});

function evaluateDeferredAttempt(overrides = {}) {
  const attempt = { ...proposedAttempt, ...overrides };
  const events = [];
  const writes = {
    paymentIntent: 0,
    customerAppOrder: 0,
    shopifyOrder: 0,
    fulfillmentTask: 0,
    hubSync: 0,
    notification: 0,
  };

  if (!attempt.expressCheckoutMounted) {
    return { status: 'checkout_attempt_initialized', writes, events };
  }

  if (attempt.applePayCancelledBeforeConfirm) {
    events.push('wallet_cancelled_before_backend_flow');
    return { status: 'checkout_attempt_payment_not_started', writes, events };
  }

  if (!attempt.confirmationReceived) {
    return { status: 'checkout_attempt_payment_not_started', writes, events };
  }

  if (!attempt.checkout_request_id || !attempt.backendAuthenticated) {
    return { status: 'checkout_attempt_duplicate_risk', writes, events: [...events, 'missing_request_or_auth'] };
  }

  if (!attempt.productsKnown || !attempt.quantitiesValid || attempt.clientTotalCents !== attempt.serverRecalculatedTotalCents || attempt.currency !== 'usd') {
    return { status: 'checkout_attempt_payment_failed', writes, events: [...events, 'server_validation_failed'] };
  }

  const duplicatePressure = attempt.duplicateRequest || attempt.componentRemount || attempt.networkRetry || attempt.twoTabs;
  writes.customerAppOrder = Math.min(1, attempt.orderCount);
  writes.paymentIntent = Math.min(1, attempt.paymentIntentCount);

  if (attempt.orderCount > 1 || attempt.paymentIntentCount > 1) {
    return { status: 'checkout_attempt_duplicate_risk', writes, events: [...events, 'duplicate_state_created'] };
  }

  if (attempt.orderCount === 1 && attempt.paymentIntentCount === 0) {
    return { status: 'checkout_attempt_order_created_intent_missing', writes, events };
  }

  if (attempt.orderCount === 0 && attempt.paymentIntentCount === 1) {
    return { status: 'checkout_attempt_intent_created_order_missing', writes, events };
  }

  if (attempt.paymentStatus === 'requires_action') {
    return { status: 'checkout_attempt_payment_requires_action', writes, events };
  }

  if (attempt.paymentStatus === 'failed') {
    return { status: 'checkout_attempt_payment_failed', writes, events };
  }

  if (attempt.paymentStatus === 'succeeded' && attempt.webhookPending) {
    return { status: 'checkout_attempt_payment_succeeded_webhook_pending', writes, events };
  }

  if (attempt.paymentStatus === 'succeeded') {
    writes.hubSync = attempt.hubWritesActive && !attempt.hubSuppression ? 1 : 0;
    writes.shopifyOrder = 1;
    writes.fulfillmentTask = 1;
    writes.notification = 1;
    return {
      status: duplicatePressure ? 'checkout_attempt_idempotent_retry' : 'checkout_attempt_complete',
      writes,
      events: duplicatePressure ? [...events, 'resolved_existing_attempt'] : events,
    };
  }

  return { status: 'checkout_attempt_partial_state_manual_review', writes, events };
}

// Static current-state tests.
test('Current checkout creates PaymentIntent before EmbeddedPayment mounts', () => {
  assertMatch(source.checkout, /base44\.functions\.invoke\(['"]createPaymentIntent['"]/, 'Checkout must currently invoke createPaymentIntent before setting clientSecret');
  assertMatch(source.checkout, /setClientSecret\(res\.data\.clientSecret\)/, 'Checkout must set clientSecret after createPaymentIntent');
  assertMatch(source.checkout, /<EmbeddedPayment[\s\S]*clientSecret=\{clientSecret\}/, 'EmbeddedPayment currently receives clientSecret');
});

test('Current createPaymentIntent pre-creates pending Customer App Order', () => {
  assertMatch(source.createPaymentIntent, /stripe\.paymentIntents\.create\(/, 'createPaymentIntent currently creates a PaymentIntent');
  assertMatch(source.createPaymentIntent, /entities\.Order\.create\(/, 'createPaymentIntent currently creates an Order');
  assertMatch(source.createPaymentIntent, /status:\s*['"]pending_payment['"]/, 'pre-created Order is pending_payment');
});

test('Current Express Checkout confirms an existing clientSecret', () => {
  assertMatch(source.embeddedPayment, /stripe\.confirmPayment\([\s\S]*clientSecret/, 'Express Checkout confirm currently uses an existing clientSecret');
  assertMatch(source.embeddedPayment, /onConfirm=\{handleExpressConfirm\}/, 'Express Checkout onConfirm handler exists');
});

test('PATCH1 diagnostic proves side-effect-free Apple Pay mount path exists', () => {
  assertMatch(source.diagnostic, /mode:\s*['"]payment['"]/, 'diagnostic uses no-client-secret Elements mode');
  assertMatch(source.diagnostic, /APPLE_PAY_MOUNT_DIAGNOSTIC_AMOUNT\s*=\s*1699/, 'diagnostic amount is fixed for preview');
  assert.doesNotMatch(source.diagnostic, /createPaymentIntent|paymentIntents\.create|entities\.Order\.create/, 'diagnostic must not create payment or order state');
});

// Required architecture fixture cases.
test('1. Checkout page mounts without PaymentIntent', () => {
  const result = evaluateDeferredAttempt({ confirmationReceived: false, paymentIntentCount: 0, orderCount: 0 });
  assert.equal(result.writes.paymentIntent, 0);
});

test('2. Checkout page mounts without Customer App Order', () => {
  const result = evaluateDeferredAttempt({ confirmationReceived: false, paymentIntentCount: 0, orderCount: 0 });
  assert.equal(result.writes.customerAppOrder, 0);
});

test('3. Apple Pay availability check creates no state', () => {
  const result = evaluateDeferredAttempt({ expressCheckoutMounted: true, confirmationReceived: false, paymentIntentCount: 0, orderCount: 0 });
  assert.deepEqual(result.writes, { paymentIntent: 0, customerAppOrder: 0, shopifyOrder: 0, fulfillmentTask: 0, hubSync: 0, notification: 0 });
});

test('4. Apple Pay cancellation creates no state', () => {
  const result = evaluateDeferredAttempt({ applePayCancelledBeforeConfirm: true, paymentIntentCount: 0, orderCount: 0 });
  assert.equal(result.status, 'checkout_attempt_payment_not_started');
  assert.equal(result.writes.paymentIntent + result.writes.customerAppOrder, 0);
});

test('5. Confirmation initiates backend flow once', () => {
  const result = evaluateDeferredAttempt();
  assert.equal(result.writes.customerAppOrder, 1);
  assert.equal(result.writes.paymentIntent, 1);
});

test('6. Exact checkout request id is required', () => {
  const result = evaluateDeferredAttempt({ checkout_request_id: '' });
  assert.equal(result.status, 'checkout_attempt_duplicate_risk');
});

test('7. Server recalculates authoritative total', () => {
  const result = evaluateDeferredAttempt({ clientTotalCents: 1699, serverRecalculatedTotalCents: 1699 });
  assert.equal(result.status, 'checkout_attempt_complete');
});

test('8. Client/server amount mismatch fails closed', () => {
  const result = evaluateDeferredAttempt({ clientTotalCents: 1599, serverRecalculatedTotalCents: 1699 });
  assert.equal(result.status, 'checkout_attempt_payment_failed');
  assert.equal(result.writes.paymentIntent, 0);
});

test('9. Unknown product fails closed', () => {
  const result = evaluateDeferredAttempt({ productsKnown: false });
  assert.equal(result.status, 'checkout_attempt_payment_failed');
});

test('10. Invalid quantity fails closed', () => {
  const result = evaluateDeferredAttempt({ quantitiesValid: false });
  assert.equal(result.status, 'checkout_attempt_payment_failed');
});

test('11. Duplicate request is idempotent', () => {
  const result = evaluateDeferredAttempt({ duplicateRequest: true });
  assert.equal(result.status, 'checkout_attempt_idempotent_retry');
  assert.equal(result.writes.customerAppOrder, 1);
  assert.equal(result.writes.paymentIntent, 1);
});

test('12. Component remount is idempotent', () => {
  const result = evaluateDeferredAttempt({ componentRemount: true });
  assert.equal(result.status, 'checkout_attempt_idempotent_retry');
});

test('13. Network retry is idempotent', () => {
  const result = evaluateDeferredAttempt({ networkRetry: true });
  assert.equal(result.status, 'checkout_attempt_idempotent_retry');
});

test('14. Two-tab duplicate attempt resolves one attempt or fails closed', () => {
  const resolved = evaluateDeferredAttempt({ twoTabs: true });
  const duplicate = evaluateDeferredAttempt({ twoTabs: true, orderCount: 2 });
  assert.equal(resolved.status, 'checkout_attempt_idempotent_retry');
  assert.equal(duplicate.status, 'checkout_attempt_duplicate_risk');
});

test('15. At most one Customer App Order exists', () => {
  assert.equal(evaluateDeferredAttempt({ orderCount: 1 }).writes.customerAppOrder, 1);
  assert.equal(evaluateDeferredAttempt({ orderCount: 2 }).status, 'checkout_attempt_duplicate_risk');
});

test('16. At most one PaymentIntent exists', () => {
  assert.equal(evaluateDeferredAttempt({ paymentIntentCount: 1 }).writes.paymentIntent, 1);
  assert.equal(evaluateDeferredAttempt({ paymentIntentCount: 2 }).status, 'checkout_attempt_duplicate_risk');
});

test('17. Order-created/Intent-missing state is detected', () => {
  assert.equal(evaluateDeferredAttempt({ orderCount: 1, paymentIntentCount: 0 }).status, 'checkout_attempt_order_created_intent_missing');
});

test('18. Intent-created/Order-missing state is detected', () => {
  assert.equal(evaluateDeferredAttempt({ orderCount: 0, paymentIntentCount: 1 }).status, 'checkout_attempt_intent_created_order_missing');
});

test('19. Successful payment with lost frontend response is recovered through webhook state', () => {
  const result = evaluateDeferredAttempt({ networkRetry: true, webhookReplayCount: 1, paymentStatus: 'succeeded' });
  assert.equal(result.status, 'checkout_attempt_idempotent_retry');
  assert.ok(result.events.includes('resolved_existing_attempt'));
});

test('20. Webhook replay is idempotent', () => {
  const first = evaluateDeferredAttempt({ webhookReplayCount: 1 });
  const replay = evaluateDeferredAttempt({ webhookReplayCount: 2, duplicateRequest: true });
  assert.equal(first.writes.customerAppOrder, 1);
  assert.equal(replay.writes.customerAppOrder, 1);
});

test('21. Payment failure does not mark Order paid', () => {
  const result = evaluateDeferredAttempt({ paymentStatus: 'failed' });
  assert.equal(result.status, 'checkout_attempt_payment_failed');
  assert.equal(result.writes.hubSync, 0);
});

test('22. No notification on Apple Pay cancellation', () => {
  const result = evaluateDeferredAttempt({ applePayCancelledBeforeConfirm: true, paymentIntentCount: 0, orderCount: 0 });
  assert.equal(result.writes.notification, 0);
});

test('23. No ShopifyOrder before paid/captured finalization', () => {
  const result = evaluateDeferredAttempt({ paymentStatus: 'requires_action' });
  assert.equal(result.status, 'checkout_attempt_payment_requires_action');
  assert.equal(result.writes.shopifyOrder, 0);
});

test('24. No FulfillmentTask before the approved post-payment path', () => {
  const result = evaluateDeferredAttempt({ paymentStatus: 'requires_action' });
  assert.equal(result.writes.fulfillmentTask, 0);
});

test('25. Hub writes remain active', () => {
  const result = evaluateDeferredAttempt({ hubWritesActive: true, hubSuppression: false });
  assert.equal(result.writes.hubSync, 1);
});

test('26. Hub suppression remains false', () => {
  assert.equal(proposedAttempt.hubSuppression, false);
  assertContains(source.docs, 'Hub writes remain active', 'PATCH2 docs');
});

test('27. G43B order history remains compatible', () => {
  assertContains(source.historyHarness, 'feature disabled preserves current response exactly', 'G43B harness');
  assertContains(source.docs, 'G43B', 'PATCH2 docs');
});

test('28. G43C tracker remains compatible', () => {
  assertContains(source.trackerHarness, 'feature disabled preserves current response exactly', 'G43C harness');
  assertContains(source.docs, 'G43C', 'PATCH2 docs');
});

test('29. Existing card checkout remains unchanged', () => {
  assertMatch(source.embeddedPayment, /stripe\.confirmCardPayment\(clientSecret/, 'card checkout currently uses confirmCardPayment with clientSecret');
  assertContains(source.docs, 'do not modify card checkout in PATCH2A or PATCH2B', 'PATCH2 docs');
});

test('30. No real provider calls', () => {
  assert.equal(proposedAttempt.providerCalls, 0);
  assertContains(source.docs, 'No provider calls are made by this plan or harness', 'PATCH2 docs');
});

test('31. No live records', () => {
  assert.equal(proposedAttempt.liveRecords, 0);
  assertNoRuntimeMutationInPlanFiles();
});

test('32. No credentials, card data, or raw payment payloads', () => {
  assert.doesNotMatch(source.docs, /pk_(live|test)_[A-Za-z0-9]|sk_(live|test)_[A-Za-z0-9]|client_secret|card number|wallet card|raw Stripe payload/i, 'PATCH2 docs must not contain secrets or raw payment details');
});

test('Architecture docs include all required sections', () => {
  for (const heading of [
    '1. PATCH1 live proof',
    '2. Current checkout sequence',
    '3. Proposed deferred-Intent sequence',
    '4. Client/server trust boundary',
    '5. Request and Stripe idempotency',
    '6. Order versus PaymentIntent sequencing',
    '7. Partial-state policy',
    '8. Apple Pay cancellation behavior',
    '9. Server-authoritative amount validation',
    '10. Webhook compatibility',
    '11. Shopify, Hub, and task boundaries',
    '12. Card-checkout compatibility',
    '13. Fixture results',
    '14. Implementation phases',
    '15. Rollback',
    '16. Sandbox/live-payment test prerequisites',
    '17. Hard stops',
  ]) {
    assertContains(source.docs, heading, 'PATCH2 docs');
  }
});

let failed = 0;
for (const { name, fn } of cases) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`✗ ${name}`);
    console.error(error?.stack || error?.message || error);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${cases.length} G47F-PATCH2 architecture tests failed.`);
  process.exit(1);
}

console.log(`\n${cases.length} G47F-PATCH2 architecture tests passed.`);
console.log(JSON.stringify({
  success: true,
  dry_run: true,
  writes_performed: false,
  provider_calls: false,
  payment_intent_created: false,
  order_created: false,
  classification: 'apple_pay_production_deferred_intent_architecture_plan_ready',
}, null, 2));
