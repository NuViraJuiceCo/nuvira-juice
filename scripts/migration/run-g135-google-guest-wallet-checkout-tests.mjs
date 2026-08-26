#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const cart = read('src/pages/Cart.jsx');
const checkout = read('src/pages/Checkout.jsx');
const confirmation = read('src/pages/OrderConfirmation.jsx');
const paymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
const embeddedPayment = read('src/components/checkout/EmbeddedPayment.jsx');
const criticalSuite = read('scripts/ci/run-critical-regressions.mjs');

assert.doesNotMatch(
  cart,
  /if \(!user\) \{\s*redirectToLogin\('\/checkout'\);\s*return;\s*\}\s*navigate\('\/checkout'\)/,
  'Cart must not force guests through sign-in before checkout',
);
assert.match(cart, /Guest checkout available\./);
assert.match(cart, /Sign in for rewards/);

assert.doesNotMatch(checkout, /Sign In to Checkout/);
assert.match(checkout, /Secure guest checkout/);
assert.match(checkout, /No account is required\. Google Pay, Apple Pay, and card are available/);
assert.match(checkout, /id="checkout-email"/);
assert.match(checkout, /type="email"/);
assert.match(checkout, /autoComplete="email"/);
assert.match(checkout, /guest_checkout: isGuestCheckout/);
assert.match(checkout, /guest_order_token: isGuestCheckout \? guestOrderToken\.current : null/);
assert.match(checkout, /customer_email: normalizedCustomerEmail/);
assert.match(checkout, /customerEmail=\{normalizedCustomerEmail\}/);
assert.match(checkout, /Sign in for route review/);
assert.match(checkout, /isExplicitNoWriteCheckoutStartFailure\(explicitFailure\)/);
assert.match(checkout, /'Calculated after address'/);

assert.match(embeddedPayment, /ExpressCheckoutElement/);
assert.match(embeddedPayment, /googlePay:\s*'always'/);
assert.match(embeddedPayment, /applePay:\s*'always'/);

assert.match(paymentIntent, /const isGuestCheckout = internalSandboxCheckout \|\| \(!authenticatedUser\?\.email && guest_checkout === true\)/);
assert.match(paymentIntent, /isValidCustomerEmail\(normalizedCustomerEmail\)/);
assert.match(paymentIntent, /GUEST_CHECKOUT_SECRET_REQUIRED/);
assert.match(paymentIntent, /GUEST_ACCOUNT_BENEFITS_NOT_ALLOWED/);
assert.match(paymentIntent, /HEALTH_ADVISORY_ACKNOWLEDGMENT_REQUIRED/);
assert.match(paymentIntent, /health_advisory_acknowledged_at:\s*healthAdvisoryAcknowledgedAt/);
assert.match(paymentIntent, /authoritativeGuestCheckoutItems\(base44, items\)/);
assert.match(paymentIntent, /entities\.Product\.filter\(\s*\{ is_available: true \},\s*'sort_order',\s*250/);
assert.match(paymentIntent, /const productById = Object\.fromEntries/);
assert.doesNotMatch(paymentIntent, /entities\.Product\.filter\(\{ id: productId \}/);
assert.match(paymentIntent, /PRODUCT_PRICE_OR_AVAILABILITY_CHANGED/);
assert.match(paymentIntent, /items\.length > 50/);
assert.match(paymentIntent, /Number\(item\?\.quantity\) > 100/);
assert.match(paymentIntent, /checkout_mode:\s*isGuestCheckout \? 'guest' : 'account'/);
assert.match(paymentIntent, /receipt_email:\s*normalizedCustomerEmail/);
assert.match(paymentIntent, /const authoritativeDeliveryFee = validatedEligibility/);
assert.match(paymentIntent, /guest_order_token_hash:\s*isGuestCheckout \? await sha256Hex\(guest_order_token\) : null/);
assert.match(paymentIntent, /mode === 'guest_order_status'/);
assert.match(paymentIntent, /constantTimeEqual/);
assert.match(paymentIntent, /row\?\.checkout_data\?\.guest_checkout === true/);
assert.match(paymentIntent, /Date\.parse\(String\(row\.expires_at\)\) > now/);
assert.match(paymentIntent, /sanitizeGuestConfirmationOrder/);
assert.doesNotMatch(
  paymentIntent.match(/const intentMetadata = \{[\s\S]*?\n    \};/)?.[0] || '',
  /guest_order_token|guest_order_token_hash/,
  'Guest confirmation secret must never be stored in Stripe metadata',
);
assert.doesNotMatch(
  paymentIntent,
  /console\.(?:log|warn|error)\([^\n]*guest_order_token/,
  'Guest confirmation secret must never be logged',
);

assert.match(confirmation, /lookupMode === 'guest_order'/);
assert.match(confirmation, /sessionStorage\.getItem\('nuvira_guest_order_confirmation'\)/);
assert.match(confirmation, /mode: 'guest_order_status'/);
assert.match(confirmation, /Create Account to Track/);
assert.match(criticalSuite, /run-g135-google-guest-wallet-checkout-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g135-google-guest-wallet-checkout',
  guest_checkout_reachable: true,
  account_benefits_isolated: true,
  catalog_prices_server_authoritative_for_guests: true,
  guest_confirmation_tokenized: true,
  live_payment_attempts: 0,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
