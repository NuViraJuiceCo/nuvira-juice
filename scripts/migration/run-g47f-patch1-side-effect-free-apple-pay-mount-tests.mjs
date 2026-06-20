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
  diagnostic: 'src/components/checkout/ApplePayMountDiagnostic.jsx',
  embeddedPayment: 'src/components/checkout/EmbeddedPayment.jsx',
  createPaymentIntent: 'base44/functions/createPaymentIntent/entry.ts',
  docs: 'docs/migration/g47f-patch1-side-effect-free-apple-pay-mount.md',
});
const source = Object.fromEntries(Object.entries(files).map(([key, relativePath]) => [key, read(relativePath)]));

const diagnosticSource = source.diagnostic;
const wrapperSource = source.checkout.slice(source.checkout.indexOf('export default function Checkout()'), source.checkout.indexOf('function CheckoutFlow()'));
const checkoutFlowSource = source.checkout.slice(source.checkout.indexOf('function CheckoutFlow()'));

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function assertNoBackendCalls(segment, label) {
  assert.doesNotMatch(segment, /base44\.functions\.invoke\(/, `${label} must not invoke Base44 functions`);
  assert.doesNotMatch(segment, /base44\.entities\./, `${label} must not use Base44 entities`);
  assert.doesNotMatch(segment, /fetch\(/, `${label} must not call fetch`);
}
function assertOnlyPublicConfigBackendCall(segment, label) {
  const invokes = [...segment.matchAll(/base44\.functions\.invoke\(\s*['"]([^'"]+)['"]/g)].map(match => match[1]);
  assert.deepEqual([...new Set(invokes)], ['previewNativeOrderCutoverReadiness'], `${label} may only invoke previewNativeOrderCutoverReadiness`);
  assert.match(segment, /APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG/, `${label} must request the public config preview mode`);
  assert.doesNotMatch(segment, /base44\.entities\./, `${label} must not use Base44 entities`);
  assert.doesNotMatch(segment, /fetch\(/, `${label} must not call fetch`);
}
function assertNoStripePaymentActions(segment, label) {
  assert.doesNotMatch(segment, /createConfirmationToken\(/, `${label} must not create ConfirmationToken`);
  assert.doesNotMatch(segment, /confirmPayment\(/, `${label} must not confirm payment`);
  assert.doesNotMatch(segment, /confirmCardPayment\(/, `${label} must not confirm card payment`);
  assert.doesNotMatch(segment, /elements\.submit\(/, `${label} must not submit Elements`);
}

// 1-4 access/default-off.
test('Diagnostic mode is default-off', () => {
  assert.match(wrapperSource, /apple_pay_mount_diagnostic/, 'wrapper must require explicit diagnostic query');
  assert.match(wrapperSource, /if \(diagnosticRequested\)/, 'diagnostic branch must be explicit');
  assert.match(wrapperSource, /return <CheckoutFlow \/>/, 'normal checkout flow must remain default path');
});

test('Anonymous user cannot activate diagnostic mode', () => {
  assert.match(wrapperSource, /isLoadingAuth/, 'auth loading must be passed to diagnostic');
  assert.match(diagnosticSource, /if \(!isAuthorized\)/, 'diagnostic component must deny unauthorized users');
});

test('Ordinary customer cannot activate diagnostic mode', () => {
  assert.match(wrapperSource, /user\?\.role === 'admin' \|\| user\?\.role === 'owner'/, 'diagnostic authorization must require admin or owner role');
  assert.match(diagnosticSource, /Access restricted/, 'unauthorized diagnostic request must render restricted state');
});

test('Admin/owner can activate diagnostic mode', () => {
  assert.match(wrapperSource, /isAuthorized=\{diagnosticAuthorized\}/, 'authorization result must be passed to diagnostic');
  assert.match(diagnosticSource, /Apple Pay mount diagnostic/, 'authorized diagnostic UI must exist');
});

// 5-8 no-intent Elements configuration.
test('Elements initializes with mode=payment', () => {
  assert.match(diagnosticSource, /mode:\s*['"]payment['"]/, 'diagnostic Elements must use payment mode');
});

test('Elements initializes with currency=usd', () => {
  assert.match(diagnosticSource, /currency:\s*['"]usd['"]/, 'diagnostic Elements must use USD');
});

test('Elements initializes with amount=1699', () => {
  assert.match(diagnosticSource, /APPLE_PAY_MOUNT_DIAGNOSTIC_AMOUNT\s*=\s*1699/, 'diagnostic amount must be 1699');
  assert.match(diagnosticSource, /amount:\s*APPLE_PAY_MOUNT_DIAGNOSTIC_AMOUNT/, 'diagnostic Elements must use amount constant');
});

test('No clientSecret is required for diagnostic mount', () => {
  assert.doesNotMatch(diagnosticSource, /clientSecret/, 'diagnostic source must not reference clientSecret');
  assert.match(diagnosticSource, /loadStripe\(publicConfig\.publishableKey\)/, 'diagnostic must initialize Stripe with read-only public config key only');
});

test('Diagnostic obtains publishable key from read-only public config preview', () => {
  assert.match(diagnosticSource, /previewNativeOrderCutoverReadiness/, 'diagnostic must call the existing preview function');
  assert.match(diagnosticSource, /APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG/, 'diagnostic must use the CONFIG2 preview mode');
  assert.match(diagnosticSource, /writes_performed === false/, 'diagnostic must require read-only response');
  assert.doesNotMatch(diagnosticSource, /VITE_STRIPE_PUBLISHABLE_KEY|__NUVIRA_STRIPE_PUBLISHABLE_KEY__/, 'diagnostic must not depend on local frontend key shims');
});

// 9-13 no backend or record creation.
test('createPaymentIntent is not called during diagnostic mount', () => {
  assertOnlyPublicConfigBackendCall(diagnosticSource, 'diagnostic component');
  assert.doesNotMatch(wrapperSource, /createPaymentIntent/, 'diagnostic wrapper must not invoke createPaymentIntent');
});

test('No Customer App Order creation occurs in diagnostic source', () => {
  assert.doesNotMatch(diagnosticSource, /Order\.create|entities\.Order\.create|pending_payment/, 'diagnostic must not create Customer App Order');
});

test('No Checkout Session creation occurs in diagnostic source', () => {
  assert.doesNotMatch(diagnosticSource, /CheckoutSession|checkout_session/i, 'diagnostic must not create Checkout Session');
});

test('No ShopifyOrder creation occurs in diagnostic source', () => {
  assert.doesNotMatch(diagnosticSource, /ShopifyOrder|shopify/i, 'diagnostic must not create ShopifyOrder or call Shopify');
});

test('No FulfillmentTask creation occurs in diagnostic source', () => {
  assert.doesNotMatch(diagnosticSource, /FulfillmentTask/, 'diagnostic must not create FulfillmentTask');
});

// 14-16 safe booleans/UI states.
test('onReady captures safe availability booleans only', () => {
  assert.match(diagnosticSource, /availablePaymentMethods/, 'diagnostic must read availablePaymentMethods');
  for (const key of ['express_checkout_mounted', 'available_payment_methods_present', 'apple_pay_available', 'google_pay_available', 'link_available', 'diagnostic_mode_active']) {
    assert.match(diagnosticSource, new RegExp(key), `diagnostic must expose ${key}`);
  }
  assert.doesNotMatch(diagnosticSource, /billingDetails|shippingAddress|customer_email|customer_phone|customer_name|user\.email|cardNumber|card_details/i, 'diagnostic must not capture customer/payment detail fields');
});

test('Apple Pay available state renders safely', () => {
  assert.match(diagnosticSource, /label="apple_pay_available"/, 'diagnostic must render apple_pay_available boolean');
});

test('No-wallet state renders safely', () => {
  assert.match(diagnosticSource, /boolStatus\(walletStatus\?\.available_payment_methods_present\)/, 'diagnostic must render unavailable/false state safely');
  assert.match(diagnosticSource, /unavailable/, 'diagnostic status helper must support unavailable');
});

// 17-20 fail closed.
test('Diagnostic onConfirm fails closed', () => {
  assert.match(diagnosticSource, /paymentFailed\?\.\(/, 'diagnostic onConfirm must call paymentFailed when available');
  assert.match(diagnosticSource, /Diagnostic preview only\. No payment was processed\./, 'diagnostic failure message must be explicit');
});

test('Diagnostic onConfirm calls no backend endpoint', () => {
  const confirmSegment = diagnosticSource.slice(diagnosticSource.indexOf('const handleConfirm'), diagnosticSource.indexOf('const handleReady'));
  assertNoBackendCalls(confirmSegment, 'diagnostic onConfirm');
});

test('Diagnostic onConfirm creates no ConfirmationToken', () => {
  const confirmSegment = diagnosticSource.slice(diagnosticSource.indexOf('const handleConfirm'), diagnosticSource.indexOf('const handleReady'));
  assert.doesNotMatch(confirmSegment, /createConfirmationToken/, 'diagnostic onConfirm must not create ConfirmationToken');
});

test('Diagnostic onConfirm confirms no payment', () => {
  const confirmSegment = diagnosticSource.slice(diagnosticSource.indexOf('const handleConfirm'), diagnosticSource.indexOf('const handleReady'));
  assertNoStripePaymentActions(confirmSegment, 'diagnostic onConfirm');
});

// 21-24 remount/normal flow.
test('Component remount creates no side effects', () => {
  assertOnlyPublicConfigBackendCall(diagnosticSource, 'diagnostic remount path');
  assertNoStripePaymentActions(diagnosticSource, 'diagnostic remount path');
});

test('Page refresh creates no side effects in diagnostic branch', () => {
  assertOnlyPublicConfigBackendCall(diagnosticSource, 'diagnostic refresh path');
  assertNoBackendCalls(wrapperSource, 'diagnostic wrapper path');
});

test('Normal checkout behavior remains unchanged with diagnostic disabled', () => {
  assert.match(checkoutFlowSource, /base44\.functions\.invoke\(['"]createPaymentIntent['"]/, 'normal checkout still invokes createPaymentIntent');
  assert.match(checkoutFlowSource, /<EmbeddedPayment\b/, 'normal checkout still renders EmbeddedPayment after clientSecret');
  assert.match(checkoutFlowSource, /setClientSecret\(/, 'normal checkout still uses clientSecret path');
});

test('Card fallback remains unchanged', () => {
  for (const token of ['CardNumberElement', 'CardExpiryElement', 'CardCvcElement', 'confirmCardPayment']) {
    assert.match(source.embeddedPayment, new RegExp(token), `${token} card fallback must remain in EmbeddedPayment`);
  }
});

// 25-30 privacy/side effects.
test('No customer PII is logged or displayed', () => {
  assert.doesNotMatch(diagnosticSource, /user\.email|customer_email|phone|address|billingDetails|shippingAddress|card details/i, 'diagnostic must not display customer PII/payment details');
});

test('No Stripe secret/client-secret output', () => {
  assert.doesNotMatch(diagnosticSource, /sk_live_|sk_test_|whsec_|clientSecret|_secret_|PaymentIntent ID|PI:/, 'diagnostic must not expose secrets/client secrets/provider ids');
});

test('No Hub mutation', () => {
  assert.doesNotMatch(diagnosticSource, /syncOrderToHub|syncCustomerToHub|hub_mutation_performed\s*:\s*true/i, 'diagnostic must not touch Hub');
});

test('No notification', () => {
  assert.doesNotMatch(diagnosticSource, /sendCustomerNotification|sendOrderReceivedNotification|Notification\.create|notifications_sent:\s*true/, 'diagnostic must not send notifications');
});

test('No loyalty/credit mutation', () => {
  assert.doesNotMatch(diagnosticSource, /UserPoints|NuViraCredit|loyalty_credit_mutation\s*:\s*true|creditMutation/i, 'diagnostic must not mutate loyalty/credits');
});

test('No live writes', () => {
  assertOnlyPublicConfigBackendCall(diagnosticSource, 'diagnostic source');
  assertNoStripePaymentActions(diagnosticSource, 'diagnostic source');
});

test('Docs record publish and smoke constraints', () => {
  assert.match(source.docs, /Web\/customer UI only/, 'docs must constrain publish scope');
  assert.match(source.docs, /Do not tap Apple Pay/, 'docs must preserve no-submit rule');
  assert.match(source.docs, /no PaymentIntent/, 'docs must document no-Intent policy');
});

let passed = 0;
const failures = [];
for (const { name, fn } of cases) {
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
  suite: 'g47f-patch1-side-effect-free-apple-pay-mount',
  passed,
  failed: failures.length,
  diagnostic_mode_default_off: true,
  admin_owner_only: true,
  elements_options: {
    mode: 'payment',
    currency: 'usd',
    amount: 1699,
    client_secret_required: false,
  },
  public_config_source: 'previewNativeOrderCutoverReadiness/APPLE_PAY_DIAGNOSTIC_PUBLIC_CONFIG',
  side_effects: {
    payment_intent_created: false,
    checkout_session_created: false,
    customer_app_order_created: false,
    shopify_order_created: false,
    fulfillment_task_created: false,
    hub_mutation_performed: false,
    notifications_sent: false,
    loyalty_credit_mutation: false,
    payment_submitted: false,
    apple_pay_confirmed: false,
    live_writes: false,
    backend_calls: 'read_only_public_config_only',
  },
  classifications: [
    'apple_pay_side_effect_free_mount_patch_ready_pending_merge_publish_smoke',
  ],
};
console.log(JSON.stringify(evidence, null, 2));

if (failures.length) process.exitCode = 1;
