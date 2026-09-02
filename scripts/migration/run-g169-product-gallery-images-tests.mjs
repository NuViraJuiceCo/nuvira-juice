import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { buildProductGallery, productAdditionalImageUrls } from '../../src/lib/product-gallery-images.js';
import { buildProductStructuredData } from '../../src/lib/product-seo.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const productDetailSource = fs.readFileSync(path.join(repoRoot, 'src/pages/ProductDetail.jsx'), 'utf8');
const consumables = PUBLIC_PRODUCT_FALLBACKS.filter(product => product.category !== 'merch');
const tote = PUBLIC_PRODUCT_FALLBACKS.find(product => product.category === 'merch');
const expectedGalleryDirectoryByTitle = Object.freeze({
  'Radiance Shot': 'radiance-shot',
  AURA: 'aura',
  'Hydration Shot': 'hydration-shot',
  'RE-NU': 're-nu',
  'Reset Shot': 'reset-shot',
  OASIS: 'oasis',
  'The NuVira Trio': 'nuvira-trio',
  'Orange Juice': 'orange-juice',
  'Pineapple Juice': 'pineapple-juice',
  'Watermelon Juice': 'watermelon-juice',
});

assert.equal(consumables.length, 10, 'Expected ten consumable catalog products');

for (const product of consumables) {
  const gallery = buildProductGallery(product);
  const additional = productAdditionalImageUrls(product);
  const absoluteAdditional = productAdditionalImageUrls(product, { absolute: true });
  const structuredData = buildProductStructuredData(product);

  const existingSecondaryCount = product.secondary_images?.length || 0;
  assert.equal(
    gallery.length,
    4 + existingSecondaryCount,
    `${product.title} should render all real catalog photos plus three supplemental images`,
  );
  assert.equal(gallery[0].src, product.image_url, `${product.title} must preserve the real catalog image as primary`);
  assert.equal(additional.length, 3, `${product.title} should expose three supplemental images`);
  assert.equal(absoluteAdditional.length, 3, `${product.title} should expose three absolute supplemental URLs`);
  const expectedDirectory = expectedGalleryDirectoryByTitle[product.title];
  assert.ok(expectedDirectory, `${product.title} needs an explicit product-to-gallery mapping`);
  for (const imagePath of additional) {
    assert.match(
      imagePath,
      new RegExp(`^/images/google-merchant/${expectedDirectory}/${expectedDirectory}-(?:kitchen|ingredients|outdoor|wellness|lifestyle)\\.jpg$`),
      `${product.title} must never receive another product's photos`,
    );
  }
  assert.equal(
    structuredData.image.length,
    4 + existingSecondaryCount,
    `${product.title} structured data should include the complete gallery`,
  );
  assert.equal(structuredData.image[0], product.image_url, `${product.title} structured data must keep the real image first`);

  for (const imagePath of additional) {
    const localPath = path.join(repoRoot, 'public', imagePath.replace(/^\//, ''));
    assert.equal(fs.existsSync(localPath), true, `Missing product gallery asset: ${imagePath}`);
  }

  for (const imageUrl of absoluteAdditional) {
    assert.match(imageUrl, /^https:\/\/nuvirajuice\.com\/images\/google-merchant\//);
  }
}

assert.ok(tote, 'Expected the tote catalog product');
assert.deepEqual(productAdditionalImageUrls(tote), [], 'The tote should not receive juice lifestyle images');
assert.equal(buildProductGallery(tote).length, 1, 'The tote should keep its existing single-image treatment');

const oasisWithExistingSecondary = {
  ...PUBLIC_PRODUCT_FALLBACKS.find(product => product.title === 'OASIS'),
  secondary_images: [
    'https://example.com/oasis-real-secondary.jpg',
    '/images/oasis-detail.jpg',
    'https://example.com/oasis-real-secondary.jpg',
  ],
};
const oasisGallery = buildProductGallery(oasisWithExistingSecondary);
assert.equal(oasisGallery.length, 6, 'OASIS should retain unique real secondary photos before generated scenes');
assert.equal(oasisGallery[1].src, 'https://example.com/oasis-real-secondary.jpg');
assert.equal(oasisGallery[2].src, '/images/oasis-detail.jpg');
assert.match(oasisGallery[3].src, /\/images\/google-merchant\/oasis\/oasis-kitchen\.jpg$/);
const absoluteOasisGallery = buildProductGallery(oasisWithExistingSecondary, { absolute: true });
assert.equal(absoluteOasisGallery[2].src, 'https://nuvirajuice.com/images/oasis-detail.jpg');

assert.match(productDetailSource, /buildProductGallery\(product\)/, 'Product detail should resolve the curated gallery');
assert.match(productDetailSource, /setSelectedImageIndex\(index\)/, 'Product detail should support thumbnail selection');
assert.match(productDetailSource, /aria-pressed=\{selectedImageIndex === index\}/, 'Gallery thumbnails should expose selected state');
assert.match(productDetailSource, /role="group"[\s\S]*?product gallery/, 'Gallery thumbnails should have an accessible group label');
assert.match(productDetailSource, /selectedImageIndex \+ 1[\s\S]*?productGallery\.length/, 'Product detail should show a visual gallery position');

console.log(JSON.stringify({
  ok: true,
  suite: 'g169-product-gallery-images',
  consumable_products: consumables.length,
  minimum_images_per_product: 4,
  existing_secondary_images_preserved: true,
  real_primary_preserved: true,
  product_assignment_matrix_locked: true,
  structured_data_gallery_enabled: true,
  provider_calls_performed: false,
  production_writes_performed: false,
}, null, 2));
