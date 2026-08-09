#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const client = read('src/api/base44Client.js');
const subscribe = read('src/pages/Subscribe.jsx');
const gateway = read('base44/functions/getCustomerAccountDashboardData/entry.ts');
const checkout = read('base44/functions/getCustomerAccountDashboardData/handlers/createSubscriptionPaymentElementIntent/entry.ts');
const webhook = read('base44/functions/stripeWebhook/entry.ts');
const cancelIncomplete = read('base44/functions/cancelIncompleteSubscriptions/entry.ts');

assert.match(client, /'createSubscriptionPaymentElementIntent'/, 'subscription checkout must route through the customer gateway');
assert.match(gateway, /createSubscriptionPaymentElementIntent\/entry\.ts/, 'customer gateway must import the subscription checkout handler');
assert.match(gateway, /"createSubscriptionPaymentElementIntent":\s*handler\d+/, 'customer gateway must dispatch subscription checkout');
assert.match(checkout, /export default async function handler\(req: Request\)/, 'subscription checkout must be a gateway handler');
assert.doesNotMatch(checkout, /Deno\.serve\(/, 'nested subscription handler must not start a second server');

assert.match(checkout, /ENABLE_SUBSCRIPTION_CHECKOUTS/, 'subscription checkout must retain an explicit rollout gate');
assert.match(checkout, /ENABLE_NATIVE_SUBSCRIPTION_FULFILLMENT/, 'subscription checkout must remain blocked until native recurring fulfillment exists');
assert.match(checkout, /authorizeCheckoutCustomer/, 'subscription checkout must bind the requested customer to the authenticated user');
assert.match(checkout, /getSubDeliveryEligibility\(resolvedAddress/, 'subscription checkout must revalidate delivery eligibility server-side');
assert.match(checkout, /payment_behavior:\s*'default_incomplete'/, 'subscription must remain incomplete until payment succeeds');
assert.match(checkout, /PendingSubscriptionCheckout\.create/, 'subscription checkout must persist the authoritative pending checkout before Stripe creation');
assert.match(checkout, /pending_subscription_checkout_id/, 'Stripe subscription metadata must retain the pending checkout identity');
assert.doesNotMatch(checkout, /functions\.invoke\('repairMissingCASubscriptionFromStripeAndHub'/, 'customer checkout must not call the retired admin repair endpoint');

assert.match(webhook, /invoice\.payment_succeeded/, 'Stripe webhook must process successful recurring invoices');
assert.match(webhook, /customer\.subscription\.updated/, 'Stripe webhook must reconcile subscription status updates');
assert.match(webhook, /customer\.subscription\.deleted/, 'Stripe webhook must reconcile subscription cancellation');
assert.match(cancelIncomplete, /incomplete/, 'stale incomplete subscription cleanup must remain scheduled');

assert.match(subscribe, /Subscription Plans Coming Soon/, 'subscription purchasing must remain customer-hidden until the controlled provider pilot passes');
assert.doesNotMatch(subscribe, /functions\.invoke\(/, 'the coming-soon surface must not create a Stripe or Base44 checkout');

console.log(JSON.stringify({
  ok: true,
  suite: 'g86-subscription-gateway-readiness',
  customer_purchase_surface_enabled: false,
  payment_provider_calls_performed: false,
  records_written: false,
  customer_notifications_sent: false,
}, null, 2));
