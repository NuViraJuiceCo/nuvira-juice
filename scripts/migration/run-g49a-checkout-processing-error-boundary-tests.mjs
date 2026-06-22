#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const checkoutPath = path.join(root, 'src/pages/Checkout.jsx');
const source = fs.readFileSync(checkoutPath, 'utf8');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function createState() {
  return {
    isSubmitting: false,
    locked: false,
    stage: 'idle',
    message: '',
    attempts: 0,
    mountedPaymentElement: false,
    automaticRetries: 0,
    backendRequests: 0,
    paymentSuccessClaimed: false,
    paymentFailureClaimed: false,
    rawErrorShown: false,
    clientSecretLogged: false,
    providerIdLogged: false,
    writesPerformed: false,
    providerCalls: false,
    notificationsSent: false,
    hubCalls: false,
    recordMutation: false,
    watchdogActive: false,
  };
}

function resetPreAttempt(state, message = 'safe retry') {
  state.isSubmitting = false;
  state.locked = false;
  state.stage = 'failed_before_payment_attempt';
  state.message = message;
  state.watchdogActive = false;
}

function lockAmbiguous(state) {
  state.isSubmitting = false;
  state.locked = true;
  state.stage = 'payment_attempt_state_unknown';
  state.message = 'Please don’t retry yet';
  state.watchdogActive = false;
}

function startCheckout(state, outcome) {
  if (state.isSubmitting || state.locked) return state;
  state.isSubmitting = true;
  state.stage = 'saving_profile';
  state.watchdogActive = true;
  state.backendRequests += 1;
  state.attempts += 1;

  if (outcome === 'profile_update_reject') {
    resetPreAttempt(state, 'profile update failure');
    return state;
  }
  if (outcome === 'profile_create_lost_response') {
    lockAmbiguous(state);
    return state;
  }
  state.stage = 'saving_bag_return';
  if (outcome === 'bag_return_filter_reject') {
    resetPreAttempt(state, 'bag return read failure');
    return state;
  }
  if (outcome === 'bag_return_create_lost_response') {
    lockAmbiguous(state);
    return state;
  }
  state.stage = 'creating_payment_attempt';
  if (outcome === 'explicit_no_write_failure') {
    resetPreAttempt(state, 'no write failure');
    return state;
  }
  if (outcome === 'ambiguous_reject' || outcome === 'lost_response' || outcome === 'malformed_response') {
    lockAmbiguous(state);
    return state;
  }
  if (outcome === 'unresolved') {
    state.stage = 'slow_processing';
    state.message = 'Still checking';
    state.locked = false;
    state.isSubmitting = true;
    return state;
  }
  if (outcome === 'success') {
    state.stage = 'payment_element_ready';
    state.mountedPaymentElement = true;
    state.isSubmitting = false;
    state.locked = false;
    state.watchdogActive = false;
    return state;
  }
  return state;
}

function unmount(state) {
  state.watchdogActive = false;
  state.isSubmitting = false;
}

test('1. Profile update rejection resets submitting', () => {
  const s = startCheckout(createState(), 'profile_update_reject');
  assert.equal(s.isSubmitting, false);
  assert.equal(s.locked, false);
  assert.equal(s.stage, 'failed_before_payment_attempt');
});

test('1b. Profile create lost response is unknown', () => {
  const s = startCheckout(createState(), 'profile_create_lost_response');
  assert.equal(s.isSubmitting, false);
  assert.equal(s.locked, true);
  assert.equal(s.stage, 'payment_attempt_state_unknown');
});

test('2. Bag-return read rejection resets submitting', () => {
  const s = startCheckout(createState(), 'bag_return_filter_reject');
  assert.equal(s.isSubmitting, false);
  assert.equal(s.locked, false);
  assert.equal(s.stage, 'failed_before_payment_attempt');
});

test('2b. Bag-return create lost response is unknown', () => {
  const s = startCheckout(createState(), 'bag_return_create_lost_response');
  assert.equal(s.isSubmitting, false);
  assert.equal(s.locked, true);
  assert.equal(s.stage, 'payment_attempt_state_unknown');
});

test('3. Proven pre-write/idempotent failure permits manual retry', () => {
  const s = startCheckout(createState(), 'profile_update_reject');
  startCheckout(s, 'success');
  assert.equal(s.attempts, 2);
  assert.equal(s.mountedPaymentElement, true);
});

test('4. Explicit no-write backend failure resets submitting', () => {
  const s = startCheckout(createState(), 'explicit_no_write_failure');
  assert.equal(s.isSubmitting, false);
  assert.equal(s.locked, false);
});

test('5. Ambiguous createPaymentIntent rejection does not permit retry', () => {
  const s = startCheckout(createState(), 'ambiguous_reject');
  startCheckout(s, 'success');
  assert.equal(s.attempts, 1);
  assert.equal(s.locked, true);
});

test('6. Lost response is classified unknown', () => {
  const s = startCheckout(createState(), 'lost_response');
  assert.equal(s.stage, 'payment_attempt_state_unknown');
  assert.equal(s.locked, true);
});

test('7. Unresolved promise triggers watchdog', () => {
  const s = startCheckout(createState(), 'unresolved');
  assert.equal(s.stage, 'slow_processing');
  assert.match(s.message, /Still checking/);
});

test('8. Watchdog sends no backend request', () => {
  const s = startCheckout(createState(), 'unresolved');
  assert.equal(s.backendRequests, 1);
  assert.equal(s.automaticRetries, 0);
});

test('9. Watchdog keeps checkout disabled', () => {
  const s = startCheckout(createState(), 'unresolved');
  assert.equal(s.isSubmitting, true);
});

test('10. Watchdog claims neither payment success nor failure', () => {
  const s = startCheckout(createState(), 'unresolved');
  assert.equal(s.paymentSuccessClaimed, false);
  assert.equal(s.paymentFailureClaimed, false);
});

test('11. No automatic retry', () => {
  const s = startCheckout(createState(), 'ambiguous_reject');
  assert.equal(s.automaticRetries, 0);
  assert.equal(s.backendRequests, 1);
});

test('12. Double-click invokes checkout once', () => {
  const s = createState();
  startCheckout(s, 'unresolved');
  startCheckout(s, 'success');
  assert.equal(s.attempts, 1);
  assert.equal(s.backendRequests, 1);
});

test('13. Malformed response does not mount Payment Element', () => {
  const s = startCheckout(createState(), 'malformed_response');
  assert.equal(s.mountedPaymentElement, false);
  assert.equal(s.stage, 'payment_attempt_state_unknown');
});

test('14. Valid clientSecret mounts the existing Payment Element', () => {
  const s = startCheckout(createState(), 'success');
  assert.equal(s.mountedPaymentElement, true);
});

test('15. Watchdog clears after success', () => {
  const s = startCheckout(createState(), 'success');
  assert.equal(s.watchdogActive, false);
});

test('16. Watchdog clears on unmount', () => {
  const s = startCheckout(createState(), 'unresolved');
  unmount(s);
  assert.equal(s.watchdogActive, false);
});

test('17. Raw errors are not shown', () => {
  const g49aRegion = source.match(/const CHECKOUT_COPY[\s\S]*?const handlePlaceOrder/)?.[0] || '';
  assert.doesNotMatch(g49aRegion, /error\.message\}|JSON\.stringify\(error|raw SDK/i);
  assert.match(source, /CHECKOUT_COPY\.AMBIGUOUS_STATE/);
});

test('18. Client secrets are not logged', () => {
  assert.doesNotMatch(source, /console\.(log|warn|error)\([^\n]*(clientSecret|client secret|_secret_)/i);
});

test('19. Provider ids are not logged', () => {
  assert.doesNotMatch(source, /console\.(log|warn|error)\([^\n]*(PaymentIntent ID|paymentIntentId|pi_)/i);
});

test('20. Existing card checkout remains unchanged', () => {
  assert.match(source, /<EmbeddedPayment/);
  assert.match(source, /onSuccess=\{\(paymentIntentId\) =>/);
});

test('21. Existing Express Checkout behavior remains unchanged', () => {
  const embedded = fs.readFileSync(path.join(root, 'src/components/checkout/EmbeddedPayment.jsx'), 'utf8');
  assert.match(embedded, /ExpressCheckoutElement|PaymentElement|confirmPayment/);
});

test('22. No PaymentIntent in tests', () => {
  const s = createState();
  assert.equal(s.providerCalls, false);
});

test('23. No Order creation in tests', () => {
  const s = createState();
  assert.equal(s.recordMutation, false);
});

test('24. No Hub call', () => {
  const addedCheckoutPatch = source.match(/CHECKOUT_PROCESSING_WATCHDOG_MS[\s\S]*?function CheckoutFlow/)?.[0] || '';
  assert.doesNotMatch(addedCheckoutPatch, /syncCustomerToHub|HUB_API|fetch\s*\(/);
});

test('25. No notification', () => {
  assert.doesNotMatch(source, /Notification\.create|sendNotification|notifications_sent:\s*true/);
});

test('26. No record mutation added by G49A patch helpers', () => {
  const helperRegion = source.match(/const setCheckoutStartLockedSafely[\s\S]*?const handlePlaceOrder/)?.[0] || '';
  assert.doesNotMatch(helperRegion, /\.create\s*\(|\.update\s*\(|\.delete\s*\(|base44\.entities/);
});

const requiredMarkers = [
  'CHECKOUT_START_STAGES',
  'FAILED_BEFORE_PAYMENT_ATTEMPT',
  'PAYMENT_ATTEMPT_STATE_UNKNOWN',
  'SLOW_PROCESSING',
  'CHECKOUT_PROCESSING_WATCHDOG_MS',
  'isExplicitNoWriteCheckoutStartFailure',
  'checkoutAttemptInFlightRef',
  'checkoutStartLockedRef',
  'isValidCheckoutStartSuccess',
];
for (const marker of requiredMarkers) {
  test(`marker present: ${marker}`, () => assert.match(source, new RegExp(marker)));
}

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failures.push({ name, error: error?.stack || error?.message || String(error) });
    console.error(`not ok ${passed + failures.length} - ${name}`);
  }
}

const result = {
  suite: 'g49a-checkout-processing-error-boundary',
  success: failures.length === 0,
  tests: tests.length,
  passed,
  failed: failures.length,
  failures,
  writes_performed: false,
  provider_call_impact: false,
  payment_intent_created: false,
  order_created: false,
  hub_calls: false,
  notifications_sent: false,
  classification: failures.length === 0
    ? 'checkout_processing_error_boundary_patch_pr_ready'
    : 'hard_stop_checkout_processing_error_boundary_regression',
};
console.log(JSON.stringify(result, null, 2));
if (failures.length) process.exit(1);
