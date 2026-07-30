import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const checkoutSource = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const paymentIntentSource = fs.readFileSync('base44/functions/createPaymentIntent/entry.ts', 'utf8');
const webhookSource = fs.readFileSync('base44/functions/stripeWebhook/entry.ts', 'utf8');
const shopifyPushSource = fs.readFileSync('base44/functions/pushOrderToShopify/entry.ts', 'utf8');
const orderSchema = JSON.parse(fs.readFileSync('base44/entities/Order.jsonc', 'utf8'));

const helperSource = fs
  .readFileSync('src/lib/checkoutPromotions.js', 'utf8')
  .replaceAll('export const ', 'const ')
  .replaceAll('export function ', 'function ')
  .concat('\nresult = { normalizeCheckoutCode, resolveCheckoutCode };');
const context = { result: null };
vm.runInNewContext(helperSource, context);

assert.equal(context.result.normalizeCheckoutCode(' brClub '), 'BRCLUB');
assert.deepEqual(
  JSON.parse(JSON.stringify(context.result.resolveCheckoutCode('brclub', 151.99))),
  {
    code: 'BRCLUB',
    type: 'promotion',
    label: 'BRClub 10% discount',
    percent: 10,
    amount: 15.2,
  }
);
assert.equal(context.result.resolveCheckoutCode('invalid', 100), null);

assert.match(checkoutSource, /promotion_code:\s*checkoutCode\?\.type === 'promotion'/);
assert.match(checkoutSource, /total:\s*totalBeforePromotion/);
assert.match(checkoutSource, /Math\.min\(checkoutCode\.amount, merchandiseTotalBeforePromotion\)/);
assert.match(checkoutSource, /BRClub \(10% off\)/);
assert.match(paymentIntentSource, /const BRCLUB_CODE = 'BRCLUB'/);
assert.match(paymentIntentSource, /promotionDiscountAmt = promotion\.amount/);
assert.match(
  paymentIntentSource,
  /appliedPromotionDiscountAmt = Math\.min\(promotionDiscountAmt, merchandiseTotalBeforePromotion\)/
);
assert.match(paymentIntentSource, /INVALID_PROMOTION_CODE/);
assert.match(paymentIntentSource, /promotion_discount_amount:\s*appliedPromotionDiscountAmt/);
assert.match(paymentIntentSource, /total_discounts:\s*totalDiscountAmount/);
assert.doesNotMatch(
  paymentIntentSource,
  /total - \(delivery_fee - effectiveDeliveryFee\) - subDiscountAmt/,
  'Subscription discount must not be subtracted twice'
);
assert.match(webhookSource, /promotion_code:\s*meta\.promotion_code/);
assert.match(shopifyPushSource, /order\.total_discounts \|\| order\.promotion_discount_amount/);
assert.match(shopifyPushSource, /applied_discount:\s*totalDiscountAmount > 0/);

for (const field of [
  'promotion_code',
  'promotion_discount_percent',
  'promotion_discount_amount',
  'total_discounts',
  'discount_codes',
]) {
  assert.ok(orderSchema.properties[field], `Order schema is missing ${field}`);
}

console.log('BRClub discount tests passed');
