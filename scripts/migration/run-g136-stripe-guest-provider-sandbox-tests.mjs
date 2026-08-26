#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const paymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
const webhook = read('base44/functions/stripeWebhook/entry.ts');
const orderEmail = read('base44/functions/sendOrderReceivedNotification/entry.ts');
const criticalSuite = read('scripts/ci/run-critical-regressions.mjs');

assert.match(paymentIntent, /RUN_GUEST_CHECKOUT_PROVIDER_SANDBOX/);
assert.match(paymentIntent, /STRIPE_SANDBOX_SECRET_KEY/);
assert.match(paymentIntent, /STRIPE_SANDBOX_PUBLISHABLE_KEY/);
assert.match(paymentIntent, /isWalletConfigurationAdmin\(authenticatedUser\)/);
assert.match(paymentIntent, /constantTimeEqual\([\s\S]*CHECKOUT_PROVIDER_SANDBOX_CONFIRMATION/);
assert.match(paymentIntent, /CHECKOUT_PROVIDER_SANDBOX_FORBIDDEN/);
assert.match(paymentIntent, /CHECKOUT_PROVIDER_SANDBOX_CONFIRMATION_REQUIRED/);
assert.match(paymentIntent, /CHECKOUT_PROVIDER_SANDBOX_NOT_CONFIGURED/);
assert.match(paymentIntent, /delivered\+g136-guest-checkout@resend\.dev/);
assert.match(paymentIntent, /customer_name: 'NuVira Sandbox'/);
assert.match(paymentIntent, /contact_phone: '6365550100'/);
assert.match(paymentIntent, /guest_checkout: true/);
assert.match(paymentIntent, /points_used: 0/);
assert.match(paymentIntent, /bag_return_request_id: null/);
assert.match(paymentIntent, /source_type:[\s\S]*\? 'guest_sandbox'/);
assert.match(paymentIntent, /is_test_order:\s*internalSandboxCheckout/);
assert.match(paymentIntent, /internal_sandbox_checkout:\s*internalSandboxCheckout/);
assert.match(paymentIntent, /checkoutStripe\.paymentIntents\.confirm\(paymentIntent\.id,[\s\S]*payment_method: 'pm_card_visa'/);
assert.match(paymentIntent, /no_money_moved: true/);
assert.match(paymentIntent, /production_stripe_key_used: false/);
const intentMetadataSource = paymentIntent.match(/const intentMetadata = \{([\s\S]*?)\n    \};/)?.[1] || '';
const intentMetadataKeyCount = [...intentMetadataSource.matchAll(/^\s{6}([a-zA-Z_][a-zA-Z0-9_]*):/gm)].length;
assert.ok(intentMetadataKeyCount > 0 && intentMetadataKeyCount <= 50,
  `Stripe metadata must remain within the 50-key provider limit; found ${intentMetadataKeyCount}`);
assert.match(paymentIntent, /Object\.keys\(intentMetadata\)\.length > 50/);
assert.doesNotMatch(intentMetadataSource, /\b(?:base44_app_id|source_app|order_type|fulfillment_mode|customer_first_name|customer_last_name|customer_name_source|requested_delivery_date|production_date|schedule_reason|scheduling_reason|zone_origin_address):/);
assert.doesNotMatch(
  paymentIntent,
  /console\.(?:log|warn|error)\([^\n]*(?:STRIPE_SANDBOX_SECRET_KEY|internal_sandbox_confirmation|guest_order_token)/,
  'Sandbox credentials and confirmation secrets must never be logged',
);

const orderCreateIndex = paymentIntent.indexOf('entities.Order.create({');
const sessionCreateIndex = paymentIntent.indexOf('entities.CheckoutSession.create({');
const confirmIndex = paymentIntent.indexOf('checkoutStripe.paymentIntents.confirm(paymentIntent.id');
assert.ok(orderCreateIndex > -1 && sessionCreateIndex > orderCreateIndex && confirmIndex > sessionCreateIndex,
  'Sandbox PaymentIntent must only be confirmed after isolated Order and CheckoutSession records exist');

assert.match(webhook, /STRIPE_SANDBOX_WEBHOOK_SECRET/);
assert.match(webhook, /stripe-webhook-runtime-g136-sandbox-signature-v1/);
assert.match(webhook, /constructEventAsync\(body, signature, sandboxWebhookSecret\)/);
assert.match(webhook, /live_webhook_rejected_test_event/);
assert.match(webhook, /sandbox_webhook_rejected_unmarked_event/);
assert.match(webhook, /event\?\.livemode === false/);
assert.match(webhook, /metadata\.internal_sandbox_checkout === 'true'/);
assert.match(webhook, /metadata\.is_test_order === 'true'/);
assert.match(webhook, /candidate\?\.is_test_order === true/);
assert.match(webhook, /candidate\?\.source_type === 'guest_sandbox'/);
assert.match(webhook, /candidate\?\.checkout_data\?\.internal_sandbox_checkout === true/);
assert.match(webhook, /customer_email_provider: 'resend_safe_test_address'/);
assert.match(webhook, /push_skipped_reason: 'guest_checkout_has_no_registered_device'/);
assert.match(webhook, /loyalty_write_performed: false/);
assert.match(webhook, /shopify_write_performed: false/);
assert.match(webhook, /inventory_write_performed: false/);
assert.match(webhook, /production_write_performed: false/);

const sandboxHandler = webhook.match(/async function handleCheckoutProviderSandboxEvent[\s\S]*?\n}\n\nfunction skipLoyaltyWrite/)?.[0] || '';
assert.ok(sandboxHandler, 'Isolated sandbox webhook handler must remain a distinct fail-closed branch');
assert.doesNotMatch(sandboxHandler, /postLoyaltyTransaction|pushOrderToShopify|syncOrderToHub|sendOrderSms|notifyOrderProcessed|sendCustomerNotification/);
assert.match(sandboxHandler, /sendOrderReceivedNotification/);
assert.match(sandboxHandler, /do_not_recover: true/);
assert.match(sandboxHandler, /is_test_order: true/);

assert.match(orderEmail, /internal_sandbox_test/);
assert.match(orderEmail, /invalid_checkout_provider_sandbox_recipient/);
assert.match(orderEmail, /internal_sandbox_test: internal_sandbox_test === true/);
assert.match(orderEmail, /sandbox_test_id: internal_sandbox_test === true \? sandbox_test_id : null/);
assert.match(criticalSuite, /run-g136-stripe-guest-provider-sandbox-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g136-stripe-guest-provider-sandbox',
  admin_only: true,
  exact_confirmation_required: true,
  production_stripe_key_unchanged: true,
  no_money_test_payment: true,
  safe_resend_test_recipient_only: true,
  customer_records_written: false,
  loyalty_writes: false,
  shopify_writes: false,
  inventory_writes: false,
  production_writes: false,
  live_provider_calls_performed: false,
}, null, 2));
