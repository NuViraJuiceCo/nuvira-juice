#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { renderProductCanonicalRedirect, renderProductCrawlerHtml } from '../seo/product-crawler-pages.mjs';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { buildProductSeoMetadata, buildProductStructuredData } from '../../src/lib/product-seo.js';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const indexHtml = read('index.html');
const sitemap = read('public/sitemap.xml');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function attributeContent(html, selector, attribute = 'content') {
  const match = html.match(new RegExp(`<${selector}[^>]*\\s${attribute}="([^"]*)"[^>]*>`, 'i'));
  return match?.[1] || '';
}

function productSchema(html) {
  const match = html.match(/<script type="application\/ld\+json" data-nuvira-product-schema>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'crawler HTML must contain the NuVira Product JSON-LD block');
  return JSON.parse(match[1]);
}

function runCanonicalRedirect(html, pathname, { native = false } = {}) {
  const match = html.match(/<script data-nuvira-product-canonical-redirect>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'canonical redirect script must be present');
  const replacements = [];
  const window = {
    location: {
      pathname,
      search: '?utm_source=test',
      hash: '#section',
      replace: (value) => replacements.push(value),
    },
  };
  const runtime = {
    ...(native ? { Capacitor: { isNativePlatform: () => true } } : {}),
  };
  new Function('globalThis', 'window', match[1])(runtime, window);
  return replacements;
}

test('shared public catalog defines exactly 11 stable, unique offers', () => {
  assert.equal(PUBLIC_PRODUCT_FALLBACKS.length, 11);

  for (const field of ['id', 'catalog_id', 'slug', 'title', 'seo_title', 'seo_description']) {
    const values = PUBLIC_PRODUCT_FALLBACKS.map(product => String(product[field] || '').trim());
    assert.equal(values.every(Boolean), true, `${field} must be present for every product`);
    assert.equal(new Set(values).size, values.length, `${field} must be unique`);
  }

  for (const product of PUBLIC_PRODUCT_FALLBACKS) {
    const metadata = buildProductSeoMetadata(product);
    assert.ok(product.seo_title.length >= 10 && product.seo_title.length <= 60, `${product.slug} SEO title length is invalid`);
    assert.ok(product.seo_description.length >= 50 && product.seo_description.length <= 160, `${product.slug} SEO description length is invalid`);
    assert.ok(Number(product.price) > 0, `${product.slug} needs a positive price`);
    assert.ok(String(product.image_url || '').trim(), `${product.slug} needs a product image`);
    assert.ok(['In stock', 'Out of stock'].includes(metadata.availabilityLabel));
  }
});

test('the sitemap contains exactly the same 11 canonical product routes', () => {
  const sitemapRoutes = [...sitemap.matchAll(/<loc>(https:\/\/nuvirajuice\.com\/product\/[^<]+)<\/loc>/g)]
    .map(match => match[1]);
  const catalogRoutes = PUBLIC_PRODUCT_FALLBACKS.map(product => buildProductSeoMetadata(product).canonicalUrl);
  assert.deepEqual([...sitemapRoutes].sort(), [...catalogRoutes].sort());
  assert.equal(sitemapRoutes.every(route => route.endsWith('.html')), true, 'product canonicals must resolve explicit Base44 static HTML assets');
});

test('every generated product document is unique, crawler-readable, and catalog-matched', () => {
  const genericBrandImage = '6200af615_generated_image.png';
  const rendered = PUBLIC_PRODUCT_FALLBACKS.map(product => {
    const metadata = buildProductSeoMetadata(product);
    const html = renderProductCrawlerHtml(indexHtml, product);
    const schema = productSchema(html);

    assert.equal((html.match(/<link rel="canonical"/g) || []).length, 1, `${product.slug} must have one canonical`);
    assert.match(html, new RegExp(`<title>${escapeRegExp(metadata.fullTitle)}<\\/title>`));
    assert.equal(attributeContent(html, 'meta name="description"'), metadata.description);
    assert.equal(attributeContent(html, 'link rel="canonical"', 'href'), metadata.canonicalUrl);
    assert.equal(attributeContent(html, 'meta property="og:type"'), 'product');
    assert.equal(attributeContent(html, 'meta property="og:url"'), metadata.canonicalUrl);
    assert.equal(attributeContent(html, 'meta property="og:title"'), metadata.fullTitle);
    assert.equal(attributeContent(html, 'meta property="og:description"'), metadata.description);
    assert.equal(attributeContent(html, 'meta property="og:image"'), metadata.image);
    assert.equal(attributeContent(html, 'meta name="twitter:title"'), metadata.fullTitle);
    assert.equal(attributeContent(html, 'meta name="twitter:description"'), metadata.description);
    assert.equal(attributeContent(html, 'meta name="twitter:image"'), metadata.image);
    assert.equal(attributeContent(html, 'meta name="twitter:url"'), metadata.canonicalUrl);
    assert.equal(attributeContent(html, 'meta property="product:price:amount"'), metadata.price);
    assert.equal(attributeContent(html, 'meta property="product:price:currency"'), 'USD');
    assert.equal(attributeContent(html, 'meta property="product:availability"'), metadata.availabilityLabel.toLowerCase());
    assert.equal(metadata.image.includes(genericBrandImage), false, `${product.slug} must not use the generic brand social image`);

    assert.equal(schema['@type'], 'Product');
    assert.equal(schema['@id'], `${metadata.canonicalUrl}#product`);
    assert.equal(schema.name, product.title);
    assert.equal(schema.image[0], metadata.image, `${product.slug} must keep the real catalog image first`);
    assert.equal(
      schema.image.length,
      product.category === 'merch' ? 1 : 4 + (product.secondary_images?.length || 0),
      `${product.slug} should expose its complete crawler-readable image gallery`,
    );
    assert.equal(schema.sku, String(product.catalog_id));
    assert.equal(schema.productID, String(product.id));
    assert.equal(schema.brand?.name, 'NuVira Juice Co.');
    assert.equal(schema.offers?.url, metadata.canonicalUrl);
    assert.equal(schema.offers?.price, metadata.price);
    assert.equal(schema.offers?.priceCurrency, 'USD');
    assert.equal(schema.offers?.availability, metadata.availability);
    assert.equal(schema.offers?.seller?.name, 'NuVira Juice Co.');

    assert.match(html, new RegExp(`<noscript>[\\s\\S]*?<h1>${escapeRegExp(product.title)}<\\/h1>`));
    assert.match(html, /<noscript>[\s\S]*?<a href="\/shop">Shop all NuVira products<\/a>/);
    assert.match(html, /<noscript>[\s\S]*?<img src="[^"]+" alt="[^"]+ from NuVira Juice Co\." \/>/);

    return { metadata, html };
  });

  for (const field of ['fullTitle', 'description', 'image', 'canonicalUrl']) {
    const values = rendered.map(result => result.metadata[field]);
    assert.equal(new Set(values).size, values.length, `${field} must be unique across all product pages`);
  }
});

test('runtime and build paths share one catalog and one Product schema builder', () => {
  const productDetail = read('src/pages/ProductDetail.jsx');
  const publicProducts = read('src/lib/public-products.js');
  const viteConfig = read('vite.config.js');
  const criticalRunner = read('scripts/ci/run-critical-regressions.mjs');

  assert.match(productDetail, /buildProductSeoMetadata\(product\)/);
  assert.match(productDetail, /buildProductStructuredData\(product\)/);
  assert.match(productDetail, /window\.location\.pathname !== canonicalPath/);
  assert.doesNotMatch(productDetail, /'@type': 'Product'/);
  assert.match(publicProducts, /public-product-catalog/);
  assert.match(read('src/lib/seo-slugs.js'), /return `\/product\/\$\{slug\}\.html`/);
  assert.match(read('src/lib/seo-slugs.js'), /\.replace\(\/\\\.html\$\/i, ''\)/);
  assert.match(viteConfig, /productCrawlerSeoPages\(\)/);
  assert.match(viteConfig, /scripts\/seo\/product-crawler-pages\.mjs/);
  assert.match(criticalRunner, /run-g151-product-crawler-seo-tests\.mjs/);
});

test('legacy web product and policy routes normalize to explicit static HTML without affecting native', () => {
  const html = renderProductCanonicalRedirect(indexHtml);
  assert.match(html, /data-nuvira-product-canonical-redirect/);
  assert.match(html, /globalThis\.Capacitor\?\.isNativePlatform\?\.\(\)/);
  assert.match(html, /window\.location\.pathname\.toLowerCase\(\)\.replace/);
  assert.match(html, /window\.location\.replace\(target \+ window\.location\.search \+ window\.location\.hash\)/);
  assert.doesNotMatch(html, /window\.location\.(?:href|assign)\s*=/);
  for (const product of PUBLIC_PRODUCT_FALLBACKS) {
    assert.ok(html.includes(`\"/product/${product.slug}\":\"/product/${product.slug}.html\"`), `${product.slug} must be in the bounded redirect map`);
  }
  assert.ok(html.includes('\"/returns\":\"/returns.html\"'));
  assert.ok(html.includes('\"/delivery\":\"/delivery.html\"'));
  assert.ok(html.includes('\"/our-story\":\"/about\"'));
  assert.ok(html.includes('\"/shipping-delivery-policy\":\"/delivery.html\"'));
  assert.ok(html.includes('\"/about\":\"/about\"'));
  assert.ok(html.includes('\"/events\":\"/events\"'));
  assert.ok(html.includes('\"/shop\":\"/shop\"'));

  assert.deepEqual(runCanonicalRedirect(html, '/our-story/'), ['/about?utm_source=test#section']);
  assert.deepEqual(runCanonicalRedirect(html, '/shipping-delivery-policy/'), ['/delivery.html?utm_source=test#section']);
  assert.deepEqual(runCanonicalRedirect(html, '/Events/'), ['/events?utm_source=test#section']);
  assert.deepEqual(runCanonicalRedirect(html, '/SHOP/'), ['/shop?utm_source=test#section']);
  assert.deepEqual(runCanonicalRedirect(html, '/shop'), []);
  assert.deepEqual(runCanonicalRedirect(html, '/our-story/', { native: true }), []);
});

test('build emits explicit Base44-host-compatible HTML assets for every canonical product URL', () => {
  const source = read('scripts/seo/product-crawler-pages.mjs');
  assert.match(source, /fileName: `product\/\$\{metadata\.slug\}\.html`/);
  assert.match(source, /fileName: 'returns\.html'/);
  assert.match(source, /fileName: 'delivery\.html'/);
});

test('live Product entity fields retain their commerce authority while static SEO identity is restored', () => {
  const catalogProduct = PUBLIC_PRODUCT_FALLBACKS.find(product => product.slug === 'aura');
  const liveProduct = {
    id: catalogProduct.id,
    title: catalogProduct.title,
    price: 14,
    size: catalogProduct.size,
    image_url: 'https://media.base44.com/live-aura.jpg',
    is_available: false,
  };
  const metadata = buildProductSeoMetadata(liveProduct);
  const schema = buildProductStructuredData(liveProduct);

  assert.equal(metadata.description, catalogProduct.seo_description);
  assert.equal(metadata.canonicalUrl, 'https://nuvirajuice.com/product/aura.html');
  assert.equal(metadata.image, liveProduct.image_url);
  assert.equal(metadata.price, '14.00');
  assert.equal(metadata.availability, 'https://schema.org/OutOfStock');
  assert.equal(schema.sku, catalogProduct.catalog_id);
  assert.equal(schema.offers.price, '14.00');
  assert.equal(schema.offers.availability, 'https://schema.org/OutOfStock');
});

let passed = 0;
for (const entry of tests) {
  try {
    await entry.fn();
    passed += 1;
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    console.error(`FAIL ${entry.name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g151-product-crawler-seo',
  cases: passed,
  product_routes: PUBLIC_PRODUCT_FALLBACKS.length,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
