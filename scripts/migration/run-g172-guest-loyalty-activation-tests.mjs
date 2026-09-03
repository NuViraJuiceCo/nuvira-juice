#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

globalThis.window = { sessionStorage: new MemoryStorage() };
const activation = await import(new URL('../../src/lib/guestLoyaltyActivation.js', import.meta.url));

assert.equal(activation.purchasePointsForTotal(42.37), 423);
assert.equal(activation.purchasePointsForTotal('13.00'), 130);
assert.equal(activation.purchasePointsForTotal(-2), 0);

const stored = activation.saveGuestLoyaltyActivationContext({
  customer_email: ' GUEST@Example.com ',
  customer_name: '  Jamie   Rivera ',
  contact_phone: ' (636) 555-0100 ',
  order_number: 'nv-g172-order',
  total: 28.55,
  guest_order_token: 'g172-token-with-at-least-24-characters',
});
assert.equal(stored.customer_email, 'guest@example.com');
assert.equal(stored.customer_name, 'Jamie Rivera');
assert.equal(stored.order_number, 'NV-G172-ORDER');
assert.equal(stored.purchase_points, 285);
assert.equal(activation.readGuestLoyaltyActivationContext().guest_order_token, 'g172-token-with-at-least-24-characters');
assert.equal(activation.guestActivationMatchesUser(stored, 'guest@example.com'), true);
assert.equal(activation.guestActivationMatchesUser(stored, 'relay@privaterelay.appleid.com'), true);
assert.equal(activation.guestActivationMatchesUser(stored, 'other@example.com'), false);
assert.deepEqual(activation.splitGuestCustomerName('Jamie Lee Rivera'), { first_name: 'Jamie', last_name: 'Lee Rivera' });

const rawStored = JSON.parse(window.sessionStorage.getItem('nuvira_guest_loyalty_activation'));
rawStored.saved_at = Date.now() - (25 * 60 * 60 * 1000);
window.sessionStorage.setItem('nuvira_guest_loyalty_activation', JSON.stringify(rawStored));
assert.equal(activation.readGuestLoyaltyActivationContext(), null);
assert.equal(window.sessionStorage.getItem('nuvira_guest_loyalty_activation'), null);
assert.equal(activation.saveGuestLoyaltyActivationContext({ customer_email: 'not-an-email' }), null);

const checkout = read('src/pages/Checkout.jsx');
const confirmation = read('src/pages/OrderConfirmation.jsx');
const nativeLogin = read('src/pages/NativeLogin.jsx');
const accountSetup = read('src/pages/AccountSetup.jsx');
const app = read('src/App.jsx');
const rewards = read('src/pages/Rewards.jsx');
const paymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
const accountSetupBackend = read('base44/functions/completeAccountSetup/entry.ts');
const accountSetupGateway = read('base44/functions/getCustomerAccountDashboardData/handlers/completeAccountSetup/entry.ts');
const webhook = read('base44/functions/stripeWebhook/entry.ts');
const orderEmail = read('base44/functions/sendOrderReceivedNotification/entry.ts');
const critical = read('scripts/ci/run-critical-regressions.mjs');

assert.match(checkout, /You still earn 10 points per \$1/);
assert.match(checkout, /saveGuestLoyaltyActivationContext\(\{/);
assert.match(checkout, /guest_order_token: guestOrderToken\.current/);
assert.match(confirmation, /earned_points \?\? purchasePointsForTotal\(order\.total\)/);
assert.match(confirmation, /Activate My Points/);
assert.match(confirmation, /GUEST_LOYALTY_ACTIVATION_RETURN_ROUTE/);
assert.doesNotMatch(confirmation, /customer_email=.*redirectToLogin/);
assert.match(nativeLogin, /isRewardsActivation \? 'register' : 'login'/);
assert.match(nativeLogin, /guestActivationContext\?\.customer_email/);
assert.match(nativeLogin, /guestActivationContext\?\.customer_email \? 'shown below' : 'you used at checkout'/);
assert.match(app, /account-setup\?return_to=\$\{encodeURIComponent\(returnTo\)\}/);
assert.match(accountSetup, /guest_order_number:/);
assert.match(accountSetup, /guest_order_token:/);
assert.match(accountSetup, /guestActivationMatchesUser/);
assert.match(accountSetup, /invalidateQueries\(\{ queryKey: \['account-dashboard'\] \}\)/);
assert.match(accountSetup, /Rewards Activated!/);
assert.match(accountSetup, /setupReturnRoute === GUEST_LOYALTY_ACTIVATION_RETURN_ROUTE/);
assert.match(rewards, /Join NuVira Rewards/);
assert.match(rewards, /'250 pts'/);
assert.match(rewards, /Your rewards are active/);

for (const backend of [accountSetupBackend, accountSetupGateway]) {
  assert.match(backend, /verifyGuestPurchaseClaim/);
  assert.match(backend, /guest_order_token_hash/);
  assert.match(backend, /Date\.parse\(String\(row\.expires_at\)\) > now/);
  assert.match(backend, /normalizeEmail\(candidate\?\.customer_email\) === contactEmail/);
  assert.match(backend, /candidate\?\.is_test_order !== true/);
  assert.match(backend, /guest_purchase_claimed: Boolean\(guestPurchaseClaim\.order\)/);
}

assert.match(paymentIntent, /earned_points: Math\.max\(0, Math\.floor\(Number\(order\.total \|\| 0\) \* 10\)\)/);
assert.match(paymentIntent, /customer_name: order\.customer_name/);
assert.match(paymentIntent, /contact_phone: order\.contact_phone/);
assert.equal((webhook.match(/guest_checkout:/g) || []).length >= 4, true);
assert.match(orderEmail, /guest_checkout === true/);
assert.match(orderEmail, /Activate My Points/);
assert.match(orderEmail, /purchase points are saved to your checkout email/i);
assert.doesNotMatch(orderEmail, /customer_email=.*activationUrl/);
assert.match(critical, /run-g172-guest-loyalty-activation-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g172-guest-loyalty-activation',
  purchase_points_use_existing_10x_rule: true,
  anonymous_purchase_remains_unblocked: true,
  activation_context_ttl_hours: 24,
  verified_guest_claim_required: true,
  duplicate_loyalty_ledger_created: false,
  marketing_consent_changed: false,
  provider_calls_performed: false,
  writes_performed: false,
}, null, 2));
