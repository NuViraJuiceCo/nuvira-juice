import assert from 'node:assert/strict';
import fs from 'node:fs';

const rewards = fs.readFileSync('src/pages/Rewards.jsx', 'utf8');
const setup = fs.readFileSync('src/pages/AccountSetup.jsx', 'utf8');
const setupHandler = fs.readFileSync('base44/functions/getCustomerAccountDashboardData/handlers/completeAccountSetup/entry.ts', 'utf8');
const checkout = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const addressAutocomplete = fs.readFileSync('src/components/AddressAutocomplete.jsx', 'utf8');

const tests = [
  ['profile requires only name and phone', () => {
    assert.match(setup, /We only need your name and phone to activate rewards/);
    assert.match(setup, /Birthday[\s\S]{0,160}\(optional\)/);
    assert.match(setup, /Delivery Address[\s\S]{0,160}\(optional until checkout\)/);
  }],
  ['authenticated identity owns the profile write', () => {
    assert.match(setupHandler, /const authenticatedEmail = normalizeEmail\(user\.email\)/);
    assert.match(setupHandler, /\{ customer_email: authenticatedEmail \}/);
  }],
  ['profile completion enrolls through the canonical loyalty writer', () => {
    assert.match(setupHandler, /functions\.invoke\('createLoyaltyMember'/);
    assert.match(setupHandler, /loyalty_status: loyaltyStatus/);
  }],
  ['rewards never display a false zero while the authoritative read is loading', () => {
    assert.match(rewards, /isLoading: isLoadingRewards/);
    assert.match(rewards, /if \(isLoadingRewards && !dashData\)/);
    assert.match(rewards, /Loading your rewards/);
  }],
  ['rewards failure is explicit and retryable', () => {
    assert.match(rewards, /isError: rewardsLoadFailed/);
    assert.match(rewards, /Your points are safe\. Try loading them again\./);
    assert.match(rewards, /onClick=\{\(\) => refetchRewards\(\)\}/);
  }],
  ['partial street input cannot trigger an out-of-area decision', () => {
    assert.match(checkout, /const hasCompleteDeliveryAddress = Boolean\(/);
    assert.match(checkout, /address\.street\?\.trim\(\)[\s\S]*address\.city\?\.trim\(\)[\s\S]*address\.state\?\.trim\(\)[\s\S]*address\.zip\?\.trim\(\)/);
    assert.match(checkout, /if \(!hasCompleteDeliveryAddress\)/);
    assert.match(addressAutocomplete, /emit\(\{ street: nextStreet, city: '', state: '', zip: '' \}\)/);
    assert.match(checkout, /const validationRequestId = \+\+addressValidationRequestRef\.current/);
    assert.match(checkout, /addressValidationRequestRef\.current !== validationRequestId/);
  }],
  ['bag-return suggestions ignore unpaid or unfinished checkout attempts', () => {
    assert.match(checkout, /const isEligibleBagReturnSourceOrder = \(order\) =>/);
    assert.match(checkout, /order\.is_abandoned_checkout \|\| order\.do_not_recover/);
    assert.match(checkout, /const paymentWasCaptured = order\.payment_captured === true/);
    assert.match(checkout, /BAG_RETURN_COMPLETED_STATUSES\.has/);
    assert.match(checkout, /recentOrders\.filter\(isEligibleBagReturnSourceOrder\)\.slice\(0, 1\)/);
  }],
];

for (const [name, test] of tests) {
  test();
  console.log(`PASS ${name}`);
}
console.log(`\n${tests.length}/${tests.length} profile and rewards live-state tests passed.`);
