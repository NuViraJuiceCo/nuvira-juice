import assert from 'node:assert/strict';
import { rewardProductEligible } from '../../src/lib/rewardSelection.js';
import { quoteRewardCheckout } from '../../base44/functions/createPaymentIntent/rewardCheckout.js';
import { quoteBirthdayCatalogCheckout } from '../../base44/functions/createPaymentIntent/birthdayCheckout.js';
import { birthdayWindow } from '../../base44/shared/birthdayEntitlement.js';

// Shapes independently read from the public live catalog on 2026-09-09.
// Synthetic IDs/account/clock only. No network, provider or entity writes.
let checks = 0;
const now = Date.parse('2026-09-08T18:00:00Z');
const identity = { birthday: '1990-09-08', signupDate: '2025-01-01T00:00:00.123456Z', now };
const eligibility = birthdayWindow(identity);
assert.equal(eligibility.eligible, true); checks++;
for (const signupDate of ['2025-01-01T00:00:00Z', '2025-01-01T00:00:00.123Z',
  '2025-01-01T00:00:00.123456Z', '2025-01-01T00:00:00.123456-05:00']) {
  assert.deepEqual(birthdayWindow({ ...identity, signupDate }), eligibility); checks++;
}
for (const signupDate of ['2025-01-01', '2025-01-01T00:00:00.1234567Z',
  '2025-02-30T00:00:00.123456Z', '2027-01-01T00:00:00.123456Z', 'invalid']) {
  assert.equal(birthdayWindow({ ...identity, signupDate }).eligible, false); checks++;
}
for (const [category, type, valid, invalid] of [
  ['juice', 'free_bottle', ['12oz / 355ml', '12 oz', '12 fl oz / 355 ml', '355ml'],
    ['32oz / 946ml', '12oz / 60ml', '3 × 12oz', '12oz extra', '112oz', '']],
  ['shot', 'free_shot', ['2oz / 60ml', '2 oz', '2 fl oz / 60 ml', '60ml'],
    ['12oz / 355ml', '2oz / 355ml', '3 × 2oz', '2oz extra', '32oz', '']],
]) {
  const reward = { id: 'synthetic-tier', reward_type: type, points_required: 1000, is_active: true };
  for (const size of [...valid, ...invalid]) {
    const eligible = valid.includes(size);
    const product = { id: 'synthetic-bottle', title: 'Synthetic bottle', size, category, price: 13, is_available: true };
    assert.equal(rewardProductEligible(reward, product), eligible, `${type}: ${size}`); checks++;
    const quote = () => quoteRewardCheckout({ products: [product], reward, requestedReward: reward, availablePoints: 1000,
      items: [{ product_id: product.id, price: 13, quantity: 5 },
        { product_id: product.id, price: 0, quantity: 1, reward_id: reward.id, isFreeReward: true }] });
    if (eligible) assert.equal(quote().reward_item_discount, 13);
    else assert.throws(quote, error => error.code === 'REWARD_PRODUCT_INELIGIBLE');
    checks++;
    if (category === 'juice') {
      const birthday = () => quoteBirthdayCatalogCheckout({ products: [product], eligibility,
        items: [{ product_id: product.id, quantity: 2, price: 13 },
          { product_id: '__birthday_reward__', birthday_product_id: product.id, isBirthdayReward: true, price: 0, quantity: 1 }] });
      if (eligible) assert.equal(birthday().birthday_discount, 13);
      else assert.throws(birthday, error => error.code === 'birthday_product_ineligible');
      checks++;
    }
  }
}
for (const title of ['AURA', 'OASIS', 'RE-NU']) {
  const product = { id: `synthetic-${title}`, title, size: '12oz / 355ml', category: 'juice', price: 13, is_available: true };
  const reward = { id: 'synthetic-vip', reward_type: 'vip_box', points_required: 6000, is_active: true };
  const result = quoteRewardCheckout({ products: [product], reward, requestedReward: reward, availablePoints: 6000,
    items: [{ product_id: product.id, quantity: 6, price: 0, isFreeReward: true, reward_id: reward.id }] });
  assert.equal(result.catalog_subtotal, 78); assert.equal(result.physical_units, 6);
  assert.equal(result.merchandise_total, 0); assert.equal(result.free_delivery, false); checks += 4;
}
console.log(`Live catalog reward parity: ${checks} assertions pass; synthetic/no writes.`);
