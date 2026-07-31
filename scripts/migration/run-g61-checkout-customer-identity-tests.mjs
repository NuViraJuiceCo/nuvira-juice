#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildCustomerName,
  normalizeNamePart,
  resolveCustomerIdentity,
  splitHumanFullName,
} from '../../src/lib/customerIdentity.js';

const read = (path) => fs.readFileSync(path, 'utf8');
const checkout = read('src/pages/Checkout.jsx');
const embeddedPayment = read('src/components/checkout/EmbeddedPayment.jsx');
const nativeApplePay = read('src/lib/nativeApplePay.js');
const nativeApplePayPlugin = read('ios/App/App/NativeApplePayPlugin.swift');
const createPaymentIntent = read('base44/functions/createPaymentIntent/entry.ts');
const createZone3AuthorizationIntent = read('base44/functions/createZone3AuthorizationIntent/entry.ts');
const profileSetup = read('src/components/onboarding/ProfileSetup.jsx');
const accountSettings = read('src/pages/AccountSettings.jsx');

assert.equal(normalizeNamePart('  Lee   Ann  '), 'Lee Ann');
assert.equal(buildCustomerName(' Lee ', ' Burton '), 'Lee Burton');
assert.deepEqual(splitHumanFullName('burton117'), { firstName: '', lastName: '' });
assert.deepEqual(splitHumanFullName('lee@example.com'), { firstName: '', lastName: '' });
assert.deepEqual(splitHumanFullName('Lee Burton'), { firstName: 'Lee', lastName: 'Burton' });

assert.deepEqual(
  resolveCustomerIdentity({
    profile: { first_name: 'Lee', last_name: 'Burton' },
    user: { full_name: 'burton117', first_name: 'Wrong', last_name: 'Name' },
  }),
  { firstName: 'Lee', lastName: 'Burton', source: 'profile' },
);
assert.deepEqual(
  resolveCustomerIdentity({
    profile: null,
    user: { first_name: 'Lee', last_name: 'Burton', full_name: 'burton117' },
  }),
  { firstName: 'Lee', lastName: 'Burton', source: 'auth_structured' },
);
assert.deepEqual(
  resolveCustomerIdentity({ profile: null, user: { full_name: 'Lee Burton' } }),
  { firstName: 'Lee', lastName: 'Burton', source: 'auth_full_name' },
);
assert.deepEqual(
  resolveCustomerIdentity({ profile: null, user: { full_name: 'burton117' } }),
  { firstName: '', lastName: '', source: 'missing' },
);

for (const field of ['firstName', 'lastName']) {
  assert.match(checkout, new RegExp(`value=\\{${field}\\}`), `Checkout must render ${field}`);
}
for (const field of ['customer_first_name', 'customer_last_name', 'customer_name']) {
  assert.match(checkout, new RegExp(`${field}:`), `Checkout must submit ${field}`);
}
assert.doesNotMatch(
  checkout,
  /const resolvedName = \(user\?\.full_name \|\| ''\)/,
  'Checkout must not prefer the auth display name over structured customer names',
);
assert.match(checkout, /return <Navigate to="\/cart" replace \/>;/);
assert.doesNotMatch(checkout, /if \(items\.length === 0\) \{\s*navigate\(['"]\/cart['"]\)/);

for (const source of [createPaymentIntent, createZone3AuthorizationIntent]) {
  assert.match(source, /CUSTOMER_NAME_REQUIRED/, 'Payment functions must reject missing structured customer identity');
  assert.match(source, /INVALID_ORDER_ITEMS/, 'Payment functions must reject unusable fulfillment items');
  assert.match(source, /CUSTOMER_PHONE_REQUIRED/, 'Payment functions must reject missing fulfillment phone numbers');
  assert.match(source, /DELIVERY_ADDRESS_REQUIRED/, 'Payment functions must reject incomplete delivery addresses');
  assert.match(source, /customer_first_name:/, 'Payment metadata must include customer first name');
  assert.match(source, /customer_last_name:/, 'Payment metadata must include customer last name');
  assert.match(source, /customer_name_source:/, 'Payment metadata must record the name source');
  assert.match(source, /shipping:\s*/, 'Stripe PaymentIntents must retain delivery identity');
  assert.match(source, /source:\s*'auth_structured'/, 'Current native builds must fall back to authenticated structured names');
  assert.match(source, /authUser:\s*authenticatedUser/, 'Server identity resolution must receive the authenticated account');
}

assert.match(embeddedPayment, /billing_details:\s*\{[\s\S]*name:\s*customerName/);
assert.match(embeddedPayment, /email:\s*customerEmail/);
assert.match(embeddedPayment, /phone:\s*customerPhone/);
assert.match(nativeApplePay, /customerName/);
assert.match(nativeApplePayPlugin, /request\.billingContact/);

for (const source of [profileSetup, accountSettings]) {
  assert.match(source, /first_name:/, 'Profile writes must persist first name');
  assert.match(source, /last_name:/, 'Profile writes must persist last name');
}
assert.match(profileSetup, /UserProfile\.update\(profileId, profileData\)/);
assert.ok(
  accountSettings.indexOf('UserProfile.update') < accountSettings.indexOf('auth.updateMe'),
  'Account settings must persist the authoritative profile before mirroring auth identity',
);

console.log(JSON.stringify({
  ok: true,
  suite: 'g61-checkout-customer-identity',
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
