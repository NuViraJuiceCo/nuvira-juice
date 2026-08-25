#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const xmlFeed = read('base44/functions/googleMerchantFeed/entry.ts');
const contentApi = read('base44/functions/syncProductsToGMC/entry.ts');
const reviewOptIn = read('src/components/GoogleCustomerReviewsOptIn.jsx');
const confirmation = read('src/pages/OrderConfirmation.jsx');
const payment = read('src/components/checkout/EmbeddedPayment.jsx');
const seo = read('src/components/SEO.jsx');
const legal = read('src/pages/Legal.jsx');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function jpegDimensions(filePath) {
  const bytes = fs.readFileSync(filePath);
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  throw new Error(`JPEG dimensions not found: ${filePath}`);
}

const highResolutionProductImages = [
  'aura-main.jpg',
  'aura-lifestyle.jpg',
  'hydration-shot-main.jpg',
  'nuvira-trio-main.jpg',
  'nuvira-trio-lifestyle.jpg',
  'oasis-main.jpg',
  'oasis-lifestyle.jpg',
  'orange-juice-main.jpg',
  'pineapple-juice-main.jpg',
  'radiance-shot-main.jpg',
  're-nu-main.jpg',
  're-nu-lifestyle.jpg',
  'reset-shot-main.jpg',
  'watermelon-juice-main.jpg',
];

for (const source of [xmlFeed, contentApi]) {
  assert.doesNotMatch(source, /<g:shipping>|shipping:\s*\[\{/);
  assert.doesNotMatch(source, /<g:price>0\.00 USD<\/g:price>|price:\s*\{\s*value:\s*'0\.00'/);
  assert.match(source, /account-level Merchant Center|account policy/);
}

assert.match(xmlFeed, /<g:additional_image_link>/);
assert.match(contentApi, /additionalImageLinks/);
assert.match(contentApi, /ENABLE_GOOGLE_MERCHANT_PRODUCT_SYNC/);
assert.doesNotMatch(contentApi, /shoppingcontent\.googleapis\.com|\/content\/v2\.1\//);
assert.match(contentApi, /https:\/\/merchantapi\.googleapis\.com/);
assert.match(contentApi, /products\/v1\/accounts\/\$\{MERCHANT_ID\}\/productInputs:insert/);
assert.match(contentApi, /GOOGLE_MERCHANT_DATA_SOURCE_ID/);
assert.match(contentApi, /dataSource=\$\{encodeURIComponent\(dataSource\)\}/);
assert.match(contentApi, /productAttributes/);
assert.match(contentApi, /amountMicros/);
assert.match(contentApi, /currencyCode/);
assert.match(contentApi, /productAttributes\.size = product\.size/);
assert.doesNotMatch(contentApi, /productAttributes\.sizes/);
assert.match(contentApi, /encodeProductInputId/);
assert.match(contentApi, /developerRegistration:registerGcp/);
assert.match(contentApi, /merchant_api_status/);
assert.match(contentApi, /REGISTER_GCP_PROJECT/);
assert.match(contentApi, /https:\/\/www\.googleapis\.com\/auth\/content/);
assert.match(contentApi, /merchant_api_service_status/);
assert.match(contentApi, /enable_merchant_api_service/);
assert.match(contentApi, /ENABLE_MERCHANT_API_SERVICE/);
assert.match(contentApi, /MERCHANT_API_SERVICE\}:enable/);
assert.match(contentApi, /https:\/\/serviceusage\.googleapis\.com\/v1\/projects/);
assert.match(contentApi, /https:\/\/www\.googleapis\.com\/auth\/cloud-platform/);
assert.match(contentApi, /providerErrorReason/);
assert.match(contentApi, /req\.method !== 'POST'/);
assert.match(contentApi, /base44\.auth\.me\(\)\.catch/);
assert.match(contentApi, /\['admin', 'owner'\]/);
for (const source of [xmlFeed, contentApi]) {
  assert.match(source, /MERCHANT_IMAGE_SETS/);
  assert.match(source, /\/images\/products\/aura-main\.jpg/);
  assert.match(source, /\/images\/products\/oasis-main\.jpg/);
  assert.match(source, /\/images\/products\/re-nu-main\.jpg/);
  assert.match(source, /\/images\/products\/nuvira-trio-main\.jpg/);
  assert.match(source, /absoluteImageUrl/);
}

for (const filename of highResolutionProductImages) {
  const filePath = path.join(repoRoot, 'public/images/products', filename);
  const stats = fs.statSync(filePath);
  const dimensions = jpegDimensions(filePath);
  assert.ok(dimensions.width > 1024, `${filename} width must exceed Google's 1024px high-resolution threshold`);
  assert.ok(dimensions.height > 1024, `${filename} height must exceed Google's 1024px high-resolution threshold`);
  assert.ok(stats.size < 16 * 1024 * 1024, `${filename} must remain below Google's 16MB limit`);
}

assert.match(confirmation, /<GoogleCustomerReviewsOptIn order=\{order\}/);
assert.match(reviewOptIn, /assigned_delivery_date \|\| order\.estimated_delivery_date/);
assert.match(reviewOptIn, /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/);
assert.doesNotMatch(reviewOptIn, /addDays|new Date\(\), 3/);
assert.match(reviewOptIn, /is_test_order/);
assert.match(reviewOptIn, /cancelled.*refunded.*failed/);

assert.match(payment, /ExpressCheckoutElement/);
assert.match(payment, /applePay/);
assert.match(payment, /googlePay/);
assert.match(seo, /index, follow, max-image-preview:large/);

assert.match(legal, /5–7 day refrigerated shelf life from production/);
assert.match(legal, /40°F or below/);
assert.match(legal, /use-by date printed on each bottle/);
assert.doesNotMatch(legal, /3–5 days of delivery/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g128-google-merchant-quality',
  offer_level_free_shipping_removed: true,
  scheduled_delivery_date_required_for_review_opt_in: true,
  wallet_checkout_preserved: true,
  large_image_preview_enabled: true,
  exact_high_resolution_catalog_photos: highResolutionProductImages.length,
  merchant_api_product_sync: true,
  legacy_content_api_requests: false,
  shelf_life_policy_aligned: true,
  live_writes_performed: false,
}, null, 2));
