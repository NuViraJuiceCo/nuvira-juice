#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import {
  buildProductStructuredData,
  shouldRenderClientProductStructuredData,
} from '../../src/lib/product-seo.js';

const read = (path) => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

function schemaDocument(schemas = []) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, 'script[type="application/ld+json"][data-nuvira-product-schema]');
      return schemas.map(schema => ({
        textContent: typeof schema === 'string' ? schema : JSON.stringify(schema),
      }));
    },
  };
}

for (const product of PUBLIC_PRODUCT_FALLBACKS) {
  const structuredData = buildProductStructuredData(product);
  assert.equal(
    shouldRenderClientProductStructuredData(structuredData, schemaDocument([structuredData])),
    false,
    `${product.slug} should not duplicate the crawler Product schema`,
  );
  assert.equal(
    (JSON.stringify(structuredData).match(/"brand"/g) || []).length,
    1,
    `${product.slug} should contain one brand field`,
  );
}

const sample = buildProductStructuredData(PUBLIC_PRODUCT_FALLBACKS[0]);
assert.equal(shouldRenderClientProductStructuredData(sample, schemaDocument([])), true);
assert.equal(shouldRenderClientProductStructuredData(sample, schemaDocument(['not-json'])), true);
assert.equal(
  shouldRenderClientProductStructuredData(sample, schemaDocument([{ ...sample, '@id': 'https://nuvirajuice.com/product/another.html#product' }])),
  true,
);

const productDetail = read('src/pages/ProductDetail.jsx');
const critical = read('scripts/ci/run-critical-regressions.mjs');
assert.match(productDetail, /shouldRenderClientProductStructuredData\(productStructuredData\)/);
assert.match(productDetail, /structuredData=\{renderClientProductStructuredData \? productStructuredData : undefined\}/);
assert.match(critical, /run-g173-product-schema-deduplication-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g173-product-schema-deduplication',
  products_verified: PUBLIC_PRODUCT_FALLBACKS.length,
  crawler_product_schema_count: 1,
  product_brand_field_count: 1,
  client_navigation_schema_preserved: true,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
