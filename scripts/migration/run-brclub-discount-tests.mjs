import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const checkoutSource = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const paymentIntentSource = fs.readFileSync('base44/functions/createPaymentIntent/entry.ts', 'utf8');
const zone3Source = fs.readFileSync('base44/functions/createZone3AuthorizationIntent/entry.ts', 'utf8');
const zone3ApprovalSource = fs.readFileSync('base44/functions/approveZone3DeliveryRequest/entry.ts', 'utf8');
const webhookSource = fs.readFileSync('base44/functions/stripeWebhook/entry.ts', 'utf8');
const shopifyPushSource = fs.readFileSync('base44/functions/pushOrderToShopify/entry.ts', 'utf8');
const orderSchema = JSON.parse(fs.readFileSync('base44/entities/Order.jsonc', 'utf8'));
const discountCodeSchema = JSON.parse(fs.readFileSync('base44/entities/DiscountCode.jsonc', 'utf8'));
const deliveryApprovalSchema = JSON.parse(fs.readFileSync('base44/entities/DeliveryApprovalRequest.jsonc', 'utf8'));
const adminPageSource = fs.readFileSync('src/pages/admin/DiscountCodes.jsx', 'utf8');
const appSource = fs.readFileSync('src/App.jsx', 'utf8');
const adminNavSource = fs.readFileSync('src/components/layout/adminNavItems.js', 'utf8');

const helperSource = fs
  .readFileSync('src/lib/checkoutPromotions.js', 'utf8')
  .replaceAll('export const ', 'const ')
  .replaceAll('export function ', 'function ')
  .concat('\nresult = { normalizeCheckoutCode, normalizeValidatedCheckoutCode };');
const context = { result: null };
vm.runInNewContext(helperSource, context);

const resolverSource = paymentIntentSource
  .slice(
    paymentIntentSource.indexOf('function normalizePromotionCode'),
    paymentIntentSource.indexOf('function normalizeNamePart'),
  )
  .concat('\nresult = { resolvePromotion };');
const resolverContext = { result: null };
vm.runInNewContext(resolverSource, resolverContext);

function discountBackend(rows) {
  return {
    asServiceRole: {
      entities: {
        DiscountCode: {
          filter: async (query) => rows.filter((row) => row.code === query.code),
        },
      },
    },
  };
}

const activePercent = {
  code: 'BRCLUB',
  display_name: 'BRClub 10% discount',
  discount_kind: 'promotion',
  discount_type: 'percent',
  discount_value: 10,
  minimum_subtotal: 0,
  maximum_discount: 0,
  active: true,
};
const fixedReferral = {
  code: 'NUVIRA26',
  display_name: 'NuVira referral discount',
  discount_kind: 'referral',
  discount_type: 'fixed_amount',
  discount_value: 5,
  active: true,
};

assert.equal(context.result.normalizeCheckoutCode(' brClub '), 'BRCLUB');
assert.deepEqual(
  JSON.parse(JSON.stringify(context.result.normalizeValidatedCheckoutCode({
    code: 'brclub',
    type: 'promotion',
    label: 'BRClub 10% discount',
    discount_type: 'percent',
    percent: 10,
    amount: 15.2,
    eligible_subtotal: 151.99,
  }))),
  {
    code: 'BRCLUB',
    type: 'promotion',
    label: 'BRClub 10% discount',
    discountType: 'percent',
    percent: 10,
    amount: 15.2,
    eligibleSubtotal: 151.99,
  }
);
assert.equal(context.result.normalizeValidatedCheckoutCode({ code: 'invalid', amount: 0 }), null);

assert.deepEqual(
  JSON.parse(JSON.stringify(await resolverContext.result.resolvePromotion(discountBackend([activePercent]), ' brclub ', 151.99))),
  {
    code: 'BRCLUB',
    type: 'promotion',
    label: 'BRClub 10% discount',
    discount_type: 'percent',
    percent: 10,
    amount: 15.2,
  },
);
assert.deepEqual(
  JSON.parse(JSON.stringify(await resolverContext.result.resolvePromotion(discountBackend([fixedReferral]), 'NUVIRA26', 3))),
  {
    code: 'NUVIRA26',
    type: 'referral',
    label: 'NuVira referral discount',
    discount_type: 'fixed_amount',
    percent: 0,
    amount: 3,
  },
);
assert.equal(await resolverContext.result.resolvePromotion(discountBackend([{ ...activePercent, active: false }]), 'BRCLUB', 100), null);
assert.equal(await resolverContext.result.resolvePromotion(discountBackend([activePercent, { ...activePercent }]), 'BRCLUB', 100), null);
assert.equal(await resolverContext.result.resolvePromotion(discountBackend([{ ...activePercent, starts_at: '2099-01-01T00:00:00.000Z' }]), 'BRCLUB', 100), null);
assert.equal(await resolverContext.result.resolvePromotion(discountBackend([{ ...activePercent, ends_at: '2020-01-01T00:00:00.000Z' }]), 'BRCLUB', 100), null);
assert.equal(await resolverContext.result.resolvePromotion(discountBackend([{ ...activePercent, minimum_subtotal: 101 }]), 'BRCLUB', 100), null);
assert.equal(await resolverContext.result.resolvePromotion(discountBackend([{ ...activePercent, discount_value: 101 }]), 'BRCLUB', 100), null);
assert.equal(
  (await resolverContext.result.resolvePromotion(discountBackend([{ ...activePercent, maximum_discount: 7 }]), 'BRCLUB', 100)).amount,
  7,
);

assert.match(checkoutSource, /mode:\s*'validate_discount_code'/);
assert.match(checkoutSource, /discount_code:\s*checkoutCode\?\.code/);
assert.match(checkoutSource, /discount_contract_version:\s*2/);
assert.match(checkoutSource, /promotion_code:\s*checkoutCode\?\.type === 'promotion'/);
assert.match(checkoutSource, /total:\s*totalBeforePromotion/);
assert.match(checkoutSource, /Math\.min\(checkoutCode\.amount, merchandiseTotalBeforePromotion\)/);
assert.doesNotMatch(checkoutSource, /BRClub \(10% off\)/);
assert.doesNotMatch(paymentIntentSource, /const BRCLUB_CODE/);
assert.match(paymentIntentSource, /entities\.DiscountCode\.filter/);
assert.match(paymentIntentSource, /mode === 'validate_discount_code'/);
assert.match(paymentIntentSource, /legacyReferralAdjustment/);
assert.match(paymentIntentSource, /promotionDiscountAmt = promotion\.type === 'promotion'/);
assert.match(
  paymentIntentSource,
  /appliedPromotionDiscountAmt = Math\.min\(promotionDiscountAmt, merchandiseTotalBeforePromotion\)/
);
assert.match(paymentIntentSource, /INVALID_DISCOUNT_CODE/);
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
assert.match(zone3Source, /entities\.DiscountCode\.filter/);
assert.match(zone3Source, /discount_eligible_subtotal/);
assert.match(zone3Source, /discount_amount:\s*discount\.amount/);
assert.match(zone3ApprovalSource, /captureMerchandiseTotal/);
assert.match(zone3ApprovalSource, /discount_codes:\s*dar\.discount_code/);
assert.match(adminPageSource, /entities\.DiscountCode\.create/);
assert.match(adminPageSource, /entities\.DiscountCode\.update/);
assert.match(appSource, /\/admin\/discount-codes/);
assert.match(adminNavSource, /\/admin\/discount-codes/);

assert.equal(discountCodeSchema.rls.read.user_condition.role, 'admin');
assert.equal(discountCodeSchema.rls.create.user_condition.role, 'admin');
for (const field of ['code', 'display_name', 'discount_kind', 'discount_type', 'discount_value', 'active']) {
  assert.ok(discountCodeSchema.properties[field], `DiscountCode schema is missing ${field}`);
}
for (const field of ['discount_eligible_subtotal', 'discount_code', 'discount_kind', 'discount_amount', 'discount_percent']) {
  assert.ok(deliveryApprovalSchema.properties[field], `DeliveryApprovalRequest schema is missing ${field}`);
}

for (const field of [
  'promotion_code',
  'promotion_discount_percent',
  'promotion_discount_amount',
  'total_discounts',
  'discount_codes',
]) {
  assert.ok(orderSchema.properties[field], `Order schema is missing ${field}`);
}

console.log('Server-managed discount code tests passed');
