#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const paymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
const oneTimeCheckout = read('src/components/checkout/EmbeddedPayment.jsx');
const subscriptionCheckout = read('src/components/checkout/SubscriptionPaymentPanel.jsx');
const criticalSuite = read('scripts/ci/run-critical-regressions.mjs');

function extractBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} is missing`);
  const start = source.indexOf('{', markerIndex + marker.length);
  assert.notEqual(start, -1, `${marker} block is missing`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${marker} block is unterminated`);
}

assert.match(oneTimeCheckout, /buttonType:\s*\{\s*applePay:\s*'buy',\s*googlePay:\s*'buy'\s*\}/);
assert.match(oneTimeCheckout, /paymentMethods:\s*\{\s*applePay:\s*'always',\s*googlePay:\s*'always',\s*link:\s*'auto'\s*\}/);
assert.match(subscriptionCheckout, /buttonType:\s*\{\s*applePay:\s*'subscribe',\s*googlePay:\s*'subscribe'\s*\}/);
assert.match(subscriptionCheckout, /paymentMethods:\s*\{\s*applePay:\s*'always',\s*googlePay:\s*'always',\s*link:\s*'auto'\s*\}/);

assert.match(paymentIntent, /payment_method_types:\s*\['card'\]/);
assert.match(paymentIntent, /'nuvirajuice\.com',\s*\n\s*'www\.nuvirajuice\.com'/);
assert.match(paymentIntent, /\['admin', 'owner'\]\.includes/);
assert.match(paymentIntent, /GOOGLE_PAY_DOMAIN_CONFIRMATION = 'ENSURE_GOOGLE_PAY_DOMAINS'/);
assert.match(paymentIntent, /requestBody\.confirmation !== GOOGLE_PAY_DOMAIN_CONFIRMATION/);
assert.match(paymentIntent, /stripe\.paymentMethodDomains\.create/);
assert.match(paymentIntent, /stripe\.paymentMethodDomains\.update/);
assert.match(paymentIntent, /stripe\.paymentMethodDomains\.validate/);

const walletBranchIndex = paymentIntent.indexOf("if (mode === 'wallet_configuration_status' || mode === 'ensure_google_pay_domains')");
const customerAuthorizationIndex = paymentIntent.indexOf('const unauthorized = await authorizeCheckoutCustomer');
const itemValidationIndex = paymentIntent.indexOf('const invalidItem =');
assert.ok(walletBranchIndex > 0 && walletBranchIndex < customerAuthorizationIndex, 'wallet administration must run before customer checkout authorization');
assert.ok(walletBranchIndex < itemValidationIndex, 'wallet administration must not require cart items');

const summaryBlock = extractBlock(paymentIntent, 'function paymentMethodDomainSummary');
assert.match(summaryBlock, /domain_name:/);
assert.match(summaryBlock, /google_pay_status:/);
assert.match(summaryBlock, /apple_pay_status:/);
assert.doesNotMatch(summaryBlock, /\bid\s*:/, 'provider identifiers must not be returned');
assert.doesNotMatch(summaryBlock, /status_details|requirements|last_error|secret/i, 'provider diagnostics must remain private');

const walletActionBlock = paymentIntent.slice(walletBranchIndex, paymentIntent.indexOf("if (mode === 'validate_discount_code')", walletBranchIndex));
assert.doesNotMatch(walletActionBlock, /paymentIntents\.create|entities\.Order|entities\.CheckoutSession/, 'wallet readiness must not create payments or orders');
assert.match(walletActionBlock, /GOOGLE_PAY_DOMAIN_READINESS_UNAVAILABLE/);
assert.doesNotMatch(walletActionBlock, /error:\s*walletError|error:\s*walletError\?\.message/, 'provider errors must not be exposed');

assert.match(paymentIntent, /payment_method_types=card; express_wallets=apple_pay,google_pay/);
assert.doesNotMatch(paymentIntent, /automatic_payment_methods=enabled, allow_redirects=never/);
assert.equal(fs.existsSync(new URL('../../base44/functions/ensureGooglePayDomains', import.meta.url)), false, 'Google Pay readiness must reuse the existing payment function slot');
assert.match(criticalSuite, /run-g133-google-pay-domain-readiness-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g133-google-pay-domain-readiness',
  required_domains: ['nuvirajuice.com', 'www.nuvirajuice.com'],
  checkout_surfaces: ['one_time', 'subscription'],
  admin_mutation_confirmation: 'required',
  payment_or_order_writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
