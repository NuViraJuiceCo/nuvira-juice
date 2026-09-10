#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { approvedProductMedia, productPrimaryImage, productThumbnailImage, isApprovedProductImage } from '../../src/lib/approved-product-media.js';
import { buildProductGallery, productAdditionalImageUrls } from '../../src/lib/product-gallery-images.js';
import { buildProductSeoMetadata, buildProductStructuredData } from '../../src/lib/product-seo.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const origin = 'https://nuvirajuice.com';
const base = '/images/approved-lifestyle/20260910';
const targets = [
  { key: 'aura', id: '69d490ce699b5f1ac4dde495', variant: '43220774813786', title: 'AURA' },
  { key: 'oasis', id: '69d490ce699b5f1ac4dde497', variant: '43220774944858', title: 'OASIS' },
  { key: 're-nu', id: '69d490ce699b5f1ac4dde496', variant: '43220774846554', title: 'RE-NU' },
];
const expectedHashes = {
  'aura-card.webp': '0995f7a0c30fa196b07a8179a71745fd9e7f461aca1004f91e32697880f4ca09',
  'aura-primary.webp': '3d88d5f6d06daa9bf2cf0174b11c4c6c4415b8ddaa1eed845b1d7e598e4aacce',
  'oasis-card.webp': '6e95ef0ed9c6bdb616af50fe1db1f62678db5f5a2153f612d976ab6aaa9242d2',
  'oasis-primary.webp': '1449544865d52189ceb9116013852374b2b62752964473f6b9086fee3a2672fc',
  're-nu-card.webp': 'a1d243cd22e625d6c6fee7c8bb031c4fbe5c17d74cb4bb59f7aba80ad7cd7577',
  're-nu-primary.webp': '8d6c27b2a3e8cfff8d330d7b8281258cc155811aa1b4282f60f40218a9c8357a',
};
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
let checks = 0;
const check = (name, run) => { run(); checks += 1; console.log(`PASS ${name}`); };

// Bundle aliases in memory. No generated files, app mount, API or provider call.
const bundled = await build({
  stdin: { contents: `export { productCardImage } from './src/lib/product-card-images.js';
    export { resolveOrderItemImageCandidates } from './src/lib/order-item-images.js';
    export { default as ProductPhoto } from './src/components/shop/ProductPhoto.jsx';`, resolveDir: root, sourcefile: 'approved-media-contract-entry.js' },
  bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'], logLevel: 'silent',
  plugins: [{ name: 'local-source-aliases', setup(builder) {
    builder.onResolve({ filter: /^@\// }, args => {
      const candidate = path.join(root, 'src', args.path.slice(2));
      return { path: [candidate, `${candidate}.js`, `${candidate}.jsx`].find(file => fs.existsSync(file)) };
    });
  } }],
});
let failedImageState = [];
const isolatedRequire = name => name === 'react' ? {
  ...React,
  useState: () => [failedImageState, update => { failedImageState = typeof update === 'function' ? update(failedImageState) : update; }],
} : require(name);
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(isolatedRequire, module, module.exports);
const { productCardImage, resolveOrderItemImageCandidates, ProductPhoto } = module.exports;

check('all three exact identities map to their own distinct approved media', () => {
  for (const target of targets) {
    for (const identity of [{ id: target.id }, { product_id: target.id }, { catalog_id: target.variant }, { shopify_variant_id: target.variant }, { variant_id: target.variant }]) {
      const result = approvedProductMedia(identity);
      assert.equal(result?.key, target.key);
      assert.equal(result?.id, target.id);
      assert.equal(result?.variant, target.variant);
      assert.equal(result?.primary, `${base}/${target.key}-primary.webp`);
      assert.equal(result?.card, `${base}/${target.key}-card.webp`);
      assert.ok(result?.alt.startsWith(target.title));
    }
  }
});
check('exact normalized names and supported historical labels resolve without substring guesses', () => {
  for (const target of targets) {
    for (const identity of [{ title: target.title }, { name: target.title.toLowerCase() }, { slug: target.key }, { handle: target.key }, { shopify_handle: target.key }, { product_id: target.key }, { slug: `/product/${target.key}.html` }]) {
      assert.equal(approvedProductMedia(identity)?.key, target.key);
    }
  }
  assert.equal(approvedProductMedia({ title: 'RENU' })?.key, 're-nu');
  assert.equal(approvedProductMedia({ title: 'AURA Cold-Pressed Juice' })?.key, 'aura');
  assert.equal(approvedProductMedia({ title: 'NuVira OASIS Cold-Pressed Juice 12 oz' })?.key, 'oasis');
  for (const title of ['AURA Lookalike', 'OASIS Program', 'Hydration with OASIS', 'RE-NU Gift Bundle']) assert.equal(approvedProductMedia({ title }), null);
});
check('concrete identity wins stale category or name, but conflicting concrete identities never guess', () => {
  assert.equal(approvedProductMedia({ id: targets[1].id, title: 'AURA', slug: 'aura', category: 'shot' })?.key, 'oasis');
  for (const input of [
    { id: targets[0].id, product_id: targets[1].id },
    { id: targets[0].id, shopify_variant_id: targets[2].variant },
    { title: 'AURA', slug: 'oasis' },
  ]) assert.equal(approvedProductMedia(input), null);
});
check('name-only non-juice categories and unknown products are excluded', () => {
  for (const category of ['shot', 'bundle', 'merch', 'apparel', 'program']) {
    for (const title of ['AURA', 'OASIS', 'RE-NU']) assert.equal(approvedProductMedia({ category, title }), null);
  }
  for (const value of [null, undefined, false, '', 1, {}, { id: 'not-a-real-product' }]) assert.equal(approvedProductMedia(value), null);
  assert.equal(productPrimaryImage({ title: 'Other', image_url: '/old-other.jpg' }), '/old-other.jpg');
  assert.equal(productThumbnailImage({ title: 'Other', image_url: '/old-other.jpg' }), '/old-other.jpg');
});
check('approved-image recognition is an exact local or canonical-host allowlist', () => {
  for (const target of targets) for (const kind of ['primary', 'card']) {
    const src = `${base}/${target.key}-${kind}.webp`;
    assert.equal(isApprovedProductImage(src), true);
    assert.equal(isApprovedProductImage(`${origin}${src}`), true);
    assert.equal(isApprovedProductImage(`https://other.invalid${src}`), false);
    assert.equal(isApprovedProductImage(`${src}?unapproved=1`), false);
  }
  assert.equal(isApprovedProductImage(`${base}/hydration-shot-primary.webp`), false);
});

const nonTargets = PUBLIC_PRODUCT_FALLBACKS.filter(product => !targets.some(target => target.id === product.id));
const catalogSnapshot = JSON.stringify(PUBLIC_PRODUCT_FALLBACKS);
check('all eight non-target catalog products keep their existing primary and card treatment', () => {
  assert.equal(nonTargets.length, 8);
  for (const product of nonTargets) {
    assert.equal(approvedProductMedia(product), null, product.title);
    assert.equal(productPrimaryImage(product), product.image_url);
    assert.equal(productThumbnailImage(product), product.image_url);
    assert.equal(buildProductGallery(product)[0].src, product.image_url);
    assert.equal(buildProductSeoMetadata(product).image, new URL(product.image_url, origin).href);
    const expectedCard = product.category === 'merch' ? '/images/brand/nuvira-tote-bag.webp' : `/images/products/cards/${product.slug}.webp`;
    assert.equal(productCardImage(product), expectedCard, product.title);
    assert.equal(resolveOrderItemImageCandidates(product)[0], product.image_url);
  }
});
check('cards, galleries, history and SEO resolve each target to the same flavor', () => {
  for (const target of targets) {
    const product = PUBLIC_PRODUCT_FALLBACKS.find(item => item.id === target.id);
    const media = approvedProductMedia(product);
    assert.equal(productCardImage(product), media.card);
    assert.equal(productThumbnailImage(product), media.card);
    assert.equal(productPrimaryImage(product), media.primary);
    assert.equal(resolveOrderItemImageCandidates(product)[0], media.card);
    const gallery = buildProductGallery(product);
    assert.equal(gallery.length, 4);
    assert.deepEqual(gallery[0], { src: media.primary, thumbnail: media.card, alt: media.alt, scene: 'approved-primary', fit: 'contain' });
    assert.equal(gallery.some(image => image.src === product.image_url), false, 'retired old hero must be absent');
    assert.deepEqual(gallery.slice(1).map(image => image.src), productAdditionalImageUrls(product));
    assert.equal(buildProductGallery(product, { absolute: true })[0].thumbnail, `${origin}${media.card}`);
    assert.equal(buildProductSeoMetadata(product).image, `${origin}${media.primary}`);
    assert.equal(buildProductStructuredData(product).image[0], `${origin}${media.primary}`);
  }
});
check('historical cart/order snapshots get an approved thumbnail without mutation and retain old fallback', () => {
  for (const target of targets) {
    const item = Object.freeze({ product_id: target.id, title: target.title, image_url: '/stored-old.jpg', price: 13, quantity: 2 });
    const before = JSON.stringify(item);
    const images = resolveOrderItemImageCandidates(item);
    assert.equal(images[0], `${base}/${target.key}-card.webp`);
    assert.equal(images.at(-1), '/stored-old.jpg');
    assert.equal(new Set(images).size, images.length);
    assert.equal(JSON.stringify(item), before);
  }
  assert.deepEqual(resolveOrderItemImageCandidates({ title: 'Unknown Juice', image_url: '/stored-custom.jpg' }), ['/stored-custom.jpg']);
  assert.deepEqual(resolveOrderItemImageCandidates({ title: 'Unknown Juice', image_url: 'javascript:alert(1)' }), []);
  const conflict = resolveOrderItemImageCandidates({ id: targets[0].id, product_id: targets[1].id, title: 'AURA', image_url: '/stored.jpg' });
  assert.equal(conflict.some(isApprovedProductImage), false, 'conflicts must not regain approved media through per-identifier or alias fallback');
  assert.equal(resolveOrderItemImageCandidates({ title: 'OASIS', category: 'shot' }).some(isApprovedProductImage), false);
});
check('birthday cart identity is resolved only for marked birthday items and retains conflict rejection', () => {
  for (const target of targets) {
    const item = Object.freeze({ product_id: '__birthday_reward__', birthday_product_id: target.id, isBirthdayReward: true, title: `🎂 ${target.title} (Free)`, category: 'juice', image_url: '/birthday-old.jpg', price: 0, quantity: 1 });
    const before = JSON.stringify(item);
    assert.equal(approvedProductMedia(item)?.key, target.key);
    assert.equal(productThumbnailImage(item), `${base}/${target.key}-card.webp`);
    assert.equal(resolveOrderItemImageCandidates(item)[0], `${base}/${target.key}-card.webp`);
    assert.equal(approvedProductMedia({ ...item, isBirthdayReward: false }), null);
    assert.equal(approvedProductMedia({ ...item, isBirthdayReward: undefined }), null);
    assert.equal(JSON.stringify(item), before);
  }
  assert.equal(approvedProductMedia({ id: targets[0].id, birthday_product_id: targets[1].id, isBirthdayReward: true }), null);
  assert.equal(approvedProductMedia({ id: targets[0].id, birthday_product_id: targets[1].id, isBirthdayReward: false })?.key, 'aura');
});
check('gallery preserves other secondaries but removes retired originals and their duplicates', () => {
  const product = PUBLIC_PRODUCT_FALLBACKS.find(item => item.slug === 'oasis');
  const input = { ...product, secondary_images: ['/old-secondary.jpg', '/old-secondary.jpg', product.image_url] };
  const before = JSON.stringify(input);
  const gallery = buildProductGallery(input);
  assert.equal(gallery.length, 5);
  assert.deepEqual(gallery.slice(0, 2).map(image => image.src), [`${base}/oasis-primary.webp`, '/old-secondary.jpg']);
  assert.equal(gallery.some(image => image.src === product.image_url), false);
  assert.equal(buildProductGallery(input, { absolute: true })[1].src, `${origin}/old-secondary.jpg`);
  assert.equal(buildProductGallery({ ...product, image_url: `${base}/oasis-primary.webp` }).length, 4);
  assert.equal(buildProductGallery({ ...product, image_url: `${origin}${base}/oasis-primary.webp` }, { absolute: true }).length, 4);
  assert.equal(JSON.stringify(input), before);
  const duplicateForms = { ...product, image_url: '/retired-oasis.jpg', secondary_images: [`${origin}/retired-oasis.jpg`, '/retired-oasis.jpg', '/keep-oasis-detail.jpg'] };
  for (const absolute of [false, true]) {
    const variants = buildProductGallery(duplicateForms, { absolute });
    assert.equal(variants.length, 5);
    assert.equal(variants.some(image => image.src.includes('retired-oasis.jpg')), false);
    assert.equal(variants[1].src, absolute ? `${origin}/keep-oasis-detail.jpg` : '/keep-oasis-detail.jpg');
  }
});
check('catalog already pointing at approved primary cannot reintroduce known retired original through secondaries', () => {
  for (const target of targets) {
    const product = PUBLIC_PRODUCT_FALLBACKS.find(item => item.id === target.id);
    const approved = approvedProductMedia(product);
    for (const current of [approved.primary, `${origin}${approved.primary}`]) {
      const input = { ...product, image_url: current, secondary_images: [product.image_url, product.image_url, current] };
      const before = JSON.stringify(input);
      for (const absolute of [false, true]) {
        const gallery = buildProductGallery(input, { absolute });
        assert.equal(gallery.length, 4, `${target.title}: old original must not add a fifth tile`);
        assert.equal(gallery.some(image => image.src === product.image_url), false);
        assert.equal(gallery[0].src, absolute ? `${origin}${approved.primary}` : approved.primary);
        assert.deepEqual(gallery.slice(1).map(image => image.src), productAdditionalImageUrls(product, { absolute }));
      }
      const schema = buildProductStructuredData(input);
      assert.equal(schema.image.length, 4);
      assert.equal(schema.image.includes(product.image_url), false);
      assert.equal(JSON.stringify(input), before);
    }
  }
});
check('approved hero and thumbnail framing use matching image ratios without side-band backdrops', () => {
  const detail = read('src/pages/ProductDetail.jsx');
  const cards = read('src/components/shop/ProductCard.jsx');
  const heroGeometry = detail.match(/selectedProductImage\?\.scene === 'approved-primary'\s*\? '([^']+)'\s*:/)?.[1];
  assert.ok(heroGeometry?.includes('aspect-[4/5]'), 'approved hero must have exact 4:5 geometry');
  assert.doesNotMatch(heroGeometry, /(?:^|\s)(?:\w+:)?(?:h-|min-h-|max-h-|p-|border(?:-|\s|$))/, 'approved hero must have no height clamps, padding or physical borders causing bands');
  assert.match(detail, /\{isMerchProduct && \([\s\S]*?blur-2xl/, 'decorative hero blur remains merch-only');
  assert.doesNotMatch(detail, /isMerchProduct \|\| selectedProductImage\.fit/);
  assert.match(detail, /src=\{image\.thumbnail \|\| image\.src\}/, 'approved gallery thumbnail must use its square derivative');
  assert.match(detail, /const hasApprovedMedia = Boolean\(approvedProductMedia\(product\)\)/);
  assert.match(detail, /hasApprovedMedia \? 'aspect-square border-0' : 'aspect-\[4\/3\] border'/, 'only approved products get square thumbnail frames; non-target framing is retained');
  assert.match(cards, /relative aspect-square overflow-hidden/, 'shop frame must match square card image');
  assert.match(cards, /aspectRatio: '1\/1'/, 'compact home frame stays square');
  assert.doesNotMatch(cards, /blur-xl|blur-2xl|aspect-\[4\/3\]/, 'no blurred or letterboxed shop framing');
});
check('failed square thumbnail retries its full-size image before removing a healthy gallery item', () => {
  const detail = read('src/pages/ProductDetail.jsx');
  const thumbnailSource = detail.slice(detail.indexOf('src={image.thumbnail || image.src}'));
  const handler = thumbnailSource.match(/onError=\{\(event\) => \{([\s\S]*?)\n\s*\}\}/);
  assert.ok(handler, 'actual thumbnail onError handler must be present');
  const onError = new Function('image', 'index', 'handleGalleryImageError', 'event', handler[1]);
  const image = { src: `${base}/oasis-primary.webp`, thumbnail: `${base}/oasis-card.webp` };
  const failures = [];
  const currentTarget = { src: image.thumbnail, getAttribute(name) { assert.equal(name, 'src'); return this.src; } };
  onError(image, 0, (...args) => failures.push(args), { currentTarget });
  assert.equal(currentTarget.src, image.src);
  assert.deepEqual(failures, [], 'card-only failure must not remove healthy primary');
  onError(image, 0, (...args) => failures.push(args), { currentTarget });
  assert.deepEqual(failures, [[image.src, 0]], 'actual primary failure retains existing gallery recovery');
  const secondary = { src: '/images/authentic-products/oasis/oasis-event-cooler.jpg' };
  onError(secondary, 1, (...args) => failures.push(args), { currentTarget });
  assert.deepEqual(failures[1], [secondary.src, 1]);
});
check('metadata changes images only and preserves prices, offers, availability and canonical identity', () => {
  for (const product of PUBLIC_PRODUCT_FALLBACKS) {
    const metadata = buildProductSeoMetadata(product);
    const schema = buildProductStructuredData(product);
    assert.equal(metadata.price, Number(product.price).toFixed(2));
    assert.equal(metadata.currency, 'USD');
    assert.equal(metadata.canonicalUrl, `${origin}/product/${product.slug}.html`);
    assert.equal(metadata.availability, product.is_available === false ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock');
    assert.equal(schema.name, product.title);
    assert.equal(Number(schema.offers.price), Number(product.price));
    assert.equal(schema.offers.priceCurrency, 'USD');
    assert.equal(schema.offers.url, metadata.canonicalUrl);
  }
  const product = PUBLIC_PRODUCT_FALLBACKS.find(item => item.slug === 'aura');
  const unavailable = buildProductSeoMetadata({ ...product, price: 17.25, is_available: false });
  assert.equal(unavailable.price, '17.25');
  assert.equal(unavailable.availability, 'https://schema.org/OutOfStock');
  assert.equal(JSON.stringify(PUBLIC_PRODUCT_FALLBACKS), catalogSnapshot, 'no catalog or price mutation');
});

check('six approved assets match exact bytes, declared AI-composite metadata and size/dimension budgets', () => {
  const directory = path.join(root, 'public', base);
  assert.deepEqual(fs.readdirSync(directory).filter(file => file.endsWith('.webp')).sort(), Object.keys(expectedHashes).sort());
  for (const [file, expectedHash] of Object.entries(expectedHashes)) {
    const bytes = fs.readFileSync(path.join(directory, file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedHash, `${file} needs renewed approval after byte changes`);
    assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
    assert.equal(bytes.subarray(8, 12).toString(), 'WEBP');
    const chunks = new Map();
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = bytes.readUInt32LE(offset + 4);
      assert.ok(offset + 8 + size <= bytes.length, `${file} invalid WebP chunk size`);
      chunks.set(bytes.subarray(offset, offset + 4).toString(), bytes.subarray(offset + 8, offset + 8 + size));
      offset += 8 + size + size % 2;
    }
    assert.ok(chunks.has('VP8X'), `${file} needs WebP extended dimensions`);
    const dimensions = chunks.get('VP8X');
    const width = 1 + dimensions.readUIntLE(4, 3);
    const height = 1 + dimensions.readUIntLE(7, 3);
    const card = file.includes('-card.');
    assert.deepEqual([width, height], card ? [640, 640] : [1600, 2000], file);
    assert.ok(bytes.length < (card ? 80_000 : 500_000), `${file} exceeds optimized media budget`);
    assert.ok(chunks.get('XMP ')?.includes(Buffer.from('http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia')), `${file} must retain correct composite disclosure`);
  }
});
check('new approved assets stay separate from all authentic photographic provenance', () => {
  const provenance = JSON.parse(read('scripts/media/authentic-product-photo-provenance.json'));
  assert.equal(Object.keys(provenance.assets).length, 12);
  for (const [file, record] of Object.entries(provenance.assets)) {
    assert.ok(file.startsWith('public/images/authentic-products/'));
    assert.equal(record.transform, 'resize-only');
    assert.ok(!file.includes('/approved-lifestyle/'));
  }
  assert.match(read('scripts/ci/run-critical-regressions.mjs'), /run-g170-authentic-product-gallery-tests\.mjs/);
});
check('ProductPhoto contains approved bottles even when a caller requests cover', () => {
  failedImageState = [];
  const product = Object.freeze({ id: targets[0].id, title: 'AURA', image_url: '/old-aura.jpg', price: 13 });
  const element = ProductPhoto({ product, thumbnail: true, className: 'object-cover', style: { objectFit: 'cover', borderRadius: '8px' } });
  assert.equal(element.props.src, `${base}/aura-card.webp`);
  assert.equal(element.props.style.objectFit, 'contain');
  assert.equal(element.props.style.borderRadius, '8px');
  assert.equal(element.props.alt, 'AURA');
  const html = renderToStaticMarkup(element);
  assert.ok(html.includes('object-fit:contain'));
  assert.ok(html.includes('data-approved-product-photo="true"'));
});
check('ProductPhoto retries the old source once then uses neutral fallback without modifying the item', () => {
  failedImageState = [];
  const product = Object.freeze({ id: targets[1].id, title: 'OASIS', image_url: '/old-oasis.jpg', price: 13, quantity: 2 });
  const before = JSON.stringify(product);
  const props = { product, fallback: React.createElement('span', { 'data-neutral': true }, 'Product photo unavailable') };
  const primary = ProductPhoto(props);
  assert.equal(primary.props.src, `${base}/oasis-primary.webp`);
  primary.props.onError();
  primary.props.onError();
  assert.deepEqual(failedImageState, [`${base}/oasis-primary.webp`]);
  const old = ProductPhoto(props);
  assert.equal(old.props.src, '/old-oasis.jpg');
  old.props.onError();
  assert.equal(ProductPhoto(props), props.fallback);
  assert.equal(JSON.stringify(product), before);
  const different = ProductPhoto({ product: { id: targets[2].id, title: 'RE-NU' } });
  assert.equal(different.props.src, `${base}/re-nu-primary.webp`, 'prior failures cannot hide another flavor');
});
check('ProductPhoto leaves unknown images, explicit alt and caller styles intact', () => {
  failedImageState = [];
  const element = ProductPhoto({ product: { title: 'Custom product', image_url: '/custom.jpg' }, alt: 'Specific view', style: { objectFit: 'cover' } });
  assert.equal(element.props.src, '/custom.jpg');
  assert.equal(element.props.style.objectFit, 'cover');
  assert.equal(element.props.alt, 'Specific view');
  assert.equal(element.props['data-approved-product-photo'], undefined);
});

console.log(JSON.stringify({ ok: true, suite: 'approved-product-primary-media', checks, approved_products: targets.length, preserved_catalog_products: nonTargets.length, approved_assets: Object.keys(expectedHashes).length, render_state_contracts_only: true, provider_calls_performed: false, production_writes_performed: false }, null, 2));
