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
const expectedGalleryPathsByTitle = Object.freeze({
  AURA: [
    '/images/authentic-products/aura/aura-drinking.jpg',
    '/images/authentic-products/aura/aura-conversation.jpg',
    '/images/authentic-products/aura/aura-bench.jpg',
  ],
  'RE-NU': [
    '/images/authentic-products/re-nu/re-nu-shared-drink.jpg',
    '/images/authentic-products/re-nu/re-nu-conversation.jpg',
    '/images/authentic-products/re-nu/re-nu-bench.jpg',
  ],
  OASIS: [
    '/images/authentic-products/oasis/oasis-event-cooler.jpg',
    '/images/authentic-products/oasis/oasis-sunset-bottle.jpg',
    '/images/authentic-products/oasis/oasis-sunset-trio.jpg',
  ],
  'The NuVira Trio': [
    '/images/authentic-products/trio/trio-outdoor-bag.jpg',
    '/images/authentic-products/trio/trio-outdoor-lineup.jpg',
    '/images/authentic-products/trio/trio-sunset-lineup.jpg',
  ],
});

assert.equal(consumables.length, 10, 'Expected ten consumable catalog products');

for (const product of consumables) {
  const gallery = buildProductGallery(product);
  const additional = productAdditionalImageUrls(product);
  const absoluteAdditional = productAdditionalImageUrls(product, { absolute: true });
  const structuredData = buildProductStructuredData(product);

  const existingSecondaryCount = product.secondary_images?.length || 0;
  const expectedAdditional = expectedGalleryPathsByTitle[product.title] || [];
  assert.equal(
    gallery.length,
    1 + existingSecondaryCount + expectedAdditional.length,
    `${product.title} should render only its verified catalog and authentic supplemental photos`,
  );
  assert.equal(gallery[0].src, product.image_url, `${product.title} must preserve the real catalog image as primary`);
  assert.deepEqual(additional, expectedAdditional, `${product.title} must never receive another product's photos`);
  assert.equal(absoluteAdditional.length, expectedAdditional.length, `${product.title} absolute supplemental count must match`);
  assert.equal(
    structuredData.image.length,
    1 + existingSecondaryCount + expectedAdditional.length,
    `${product.title} structured data should include the complete gallery`,
  );
  assert.equal(structuredData.image[0], product.image_url, `${product.title} structured data must keep the real image first`);

  for (const imagePath of additional) {
    const localPath = path.join(repoRoot, 'public', imagePath.replace(/^\//, ''));
    assert.equal(fs.existsSync(localPath), true, `Missing product gallery asset: ${imagePath}`);
  }

  for (const imageUrl of absoluteAdditional) {
    assert.match(imageUrl, /^https:\/\/nuvirajuice\.com\/images\/authentic-products\//);
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
assert.equal(oasisGallery.length, 6, 'OASIS should retain unique real secondary photos before authentic scenes');
assert.equal(oasisGallery[1].src, 'https://example.com/oasis-real-secondary.jpg');
assert.equal(oasisGallery[2].src, '/images/oasis-detail.jpg');
assert.equal(oasisGallery[3].src, '/images/authentic-products/oasis/oasis-event-cooler.jpg');
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
  authentically_enriched_products: Object.keys(expectedGalleryPathsByTitle).length,
  primary_only_products: consumables.length - Object.keys(expectedGalleryPathsByTitle).length,
  existing_secondary_images_preserved: true,
  real_primary_preserved: true,
  product_assignment_matrix_locked: true,
  structured_data_gallery_enabled: true,
  provider_calls_performed: false,
  production_writes_performed: false,
}, null, 2));
