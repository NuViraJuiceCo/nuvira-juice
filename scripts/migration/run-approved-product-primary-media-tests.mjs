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
const base = '/images/approved-lifestyle/20260911-contact-v3';
const renuBase = '/images/approved-lifestyle/20260911-re-nu-v4';
const baseFor = target => target.key === 're-nu' ? renuBase : base;
const retiredBases = ['/images/approved-lifestyle/20260910', '/images/approved-lifestyle/20260911-v5'];
const retiredBasesFor = target => target.key === 're-nu' ? [...retiredBases, base] : retiredBases;
const targets = [
  { key: 'aura', id: '69d490ce699b5f1ac4dde495', variant: '43220774813786', title: 'AURA' },
  { key: 'oasis', id: '69d490ce699b5f1ac4dde497', variant: '43220774944858', title: 'OASIS' },
  { key: 're-nu', id: '69d490ce699b5f1ac4dde496', variant: '43220774846554', title: 'RE-NU' },
];
const expectedHashes = {
  'aura-card.webp': '9b39db7ffefc93c615b3f841c2ef881db172a948b929813cfa4d36fd11a1cf14',
  'aura-primary.webp': 'dd2a7cae213b66fc664b59a7babc387c1e2768b4bdb0eacf0bf9cad4bf380637',
  'oasis-card.webp': '8ed1c818ab75f011a6946b5ee0351be171ad712173c95621ef5d4481f900afbc',
  'oasis-primary.webp': 'e30787556fab142a4602e86d011c5cd2853e35f2075a8098a31f13df5fc30d76',
  're-nu-card.webp': '9f6af6d160f8218d576beb2bc522bc85e4e0b5c956bd9fceed25819c17cd30a8',
  're-nu-primary.webp': '69404b4db552b523928cbbdaefa3797d40179b990b24d05258bbeebf8251affb',
};
const expectedJpegHashes = {
  'aura-merchant.jpg': 'e131d69faddfeb565ccba6c8e7b8157f93af328652cad4e9fc2fa6a2d1b95964',
  'aura-provider.jpg': '3bbfd11bb35a36200dc5b36c7541b9cdf3fd6c6ff1feac98e35879b078b05345',
  'oasis-merchant.jpg': 'a42bbdb5b4c1a1622b08bbc2b6aa1ab9b0105ef2165934b2d8939da26e51219a',
  'oasis-provider.jpg': 'f9bc6556629d836d3a3944509deecc81cacbc069d4a6fca419a9969bde4be6ac',
  're-nu-merchant.jpg': 'a8cb4e55d14d81a44f37fe8613b09ace4d4b7f3442d5588e02e243a1fa2cb642',
  're-nu-provider.jpg': '499792b64dac57997fe0f1dbb9740529b4d95e55530e62527a1a96ee7411be89',
};
const expectedRenuV4Hashes = {
  're-nu-card.webp': '4412275fe8eba32d4b27e62cdcab77ad1cc2f3f3d06da2f5ec07be2c15cfb0c1',
  're-nu-primary.webp': '01385ffb7bff83bb9237f8473e07985af98da61046d84d1257d72261ec5a3a03',
  're-nu-merchant.jpg': '09064715720a502284ec44fe26053a18e65d2b40973f1bed93a7c0400a840ff9',
  're-nu-provider.jpg': '977792d58e06d30034dcae62f5df6b463c4498f9e1853eb70c70456dca9d30e7',
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
      assert.equal(result?.primary, `${baseFor(target)}/${target.key}-primary.webp`);
      assert.equal(result?.card, `${baseFor(target)}/${target.key}-card.webp`);
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
    const src = `${baseFor(target)}/${target.key}-${kind}.webp`;
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
    assert.equal(images[0], `${baseFor(target)}/${target.key}-card.webp`);
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
    assert.equal(productThumbnailImage(item), `${baseFor(target)}/${target.key}-card.webp`);
    assert.equal(resolveOrderItemImageCandidates(item)[0], `${baseFor(target)}/${target.key}-card.webp`);
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
check('contact galleries exclude each product retired primary/card URLs without removing authentic or unknown secondaries', () => {
  for (const target of targets) {
    const product = PUBLIC_PRODUCT_FALLBACKS.find(item => item.id === target.id);
    const approved = approvedProductMedia(product);
    const targetRetiredBases = retiredBasesFor(target);
    const retired = targetRetiredBases.flatMap(retiredBase => [`${retiredBase}/${target.key}-primary.webp`, `${retiredBase}/${target.key}-card.webp`]);
    assert.deepEqual(approved.retiredImages, retired);
    for (const current of [product.image_url, approved.primary, `${origin}${approved.primary}`, ...retired]) {
      const input = { ...product, image_url: current, secondary_images: [...retired, ...retired.map(src => `${origin}${src}`), '/keep-authentic-detail.jpg'] };
      const before = JSON.stringify(input);
      for (const absolute of [false, true]) {
        const gallery = buildProductGallery(input, { absolute });
        assert.equal(gallery.length, 5);
        assert.equal(gallery.some(image => targetRetiredBases.some(retiredBase => image.src.includes(retiredBase))), false);
        assert.equal(gallery[1].src, absolute ? `${origin}/keep-authentic-detail.jpg` : '/keep-authentic-detail.jpg');
        assert.deepEqual(gallery.slice(2).map(image => image.src), productAdditionalImageUrls(product, { absolute }));
      }
      assert.equal(buildProductStructuredData(input).image.some(src => targetRetiredBases.some(retiredBase => src.includes(retiredBase))), false);
      assert.equal(JSON.stringify(input), before);
    }
    // Old static files remain available for existing snapshots/error recovery.
    retired.forEach(src => assert.ok(fs.existsSync(path.join(root, 'public', src))));
  }
  const unknown = { title: 'Custom product', image_url: '/custom.jpg', secondary_images: retiredBases.map(retiredBase => `${retiredBase}/aura-primary.webp`) };
  assert.equal(buildProductGallery(unknown)[1].src, unknown.secondary_images[0]);
  assert.equal(buildProductGallery(unknown)[2].src, unknown.secondary_images[1]);
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

check('six preserved v3 assets and two current RE-NU v4 WebPs match exact bytes, disclosure and size/dimension budgets', () => {
  const directory = path.join(root, 'public', base);
  assert.deepEqual(fs.readdirSync(directory).filter(file => file.endsWith('.webp')).sort(), Object.keys(expectedHashes).sort());
  const assets = [
    ...Object.entries(expectedHashes).map(([file, hash]) => ({ file, hash, directory })),
    ...Object.entries(expectedRenuV4Hashes).filter(([file]) => file.endsWith('.webp')).map(([file, hash]) => ({ file, hash, directory: path.join(root, 'public', renuBase) })),
  ];
  for (const { file, hash: expectedHash, directory: assetDirectory } of assets) {
    const bytes = fs.readFileSync(path.join(assetDirectory, file));
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
    assert.deepEqual([width, height], card ? [640, 640] : [1080, 1350], file);
    assert.ok(bytes.length < (card ? 80_000 : 500_000), `${file} exceeds optimized media budget`);
    assert.ok(chunks.get('XMP ')?.includes(Buffer.from('http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia')), `${file} must retain correct composite disclosure`);
  }
});
check('provider JPEG derivatives preserve exact approved framing, embedded disclosure and provenance', () => {
  const provenance = JSON.parse(read('scripts/media/approved-primary-photo-provenance-20260911-contact-v3.json'));
  assert.equal(provenance.approval_date, '2026-09-11');
  assert.equal(provenance.base_commit, '5b757f261896b2c909761cec16f2909912cc0c9b');
  assert.equal(provenance.approval_status, 'OWNER APPROVED FOR PHOTO ROLLOUT; REEL WORK STOPPED');
  assert.equal(provenance.provider_upload_performed, false);
  assert.match(provenance.preservation_boundary, /before lossy delivery encoding/);
  const directory = path.join(root, 'public', base);
  assert.deepEqual(fs.readdirSync(directory).filter(file => file.endsWith('.jpg')).sort(), Object.keys(expectedJpegHashes).sort());
  const assets = [
    ...Object.entries(expectedJpegHashes).map(([file, hash]) => ({ file, hash, directory })),
    ...Object.entries(expectedRenuV4Hashes).filter(([file]) => file.endsWith('.jpg')).map(([file, hash]) => ({ file, hash, directory: path.join(root, 'public', renuBase) })),
  ];
  for (const { file, hash: expectedHash, directory: assetDirectory } of assets) {
    const bytes = fs.readFileSync(path.join(assetDirectory, file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), expectedHash);
    assert.equal(bytes.readUInt16BE(0), 0xffd8);
    let dimensions;
    for (let offset = 2; offset + 8 < bytes.length;) {
      assert.equal(bytes[offset], 0xff);
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (marker === 0xc0 || marker === 0xc2) {
        dimensions = [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
        break;
      }
      assert.ok(length >= 2);
      offset += length + 2;
    }
    assert.deepEqual(dimensions, file.includes('-provider.') ? [1080, 1350] : [1080, 1080]);
    assert.ok(bytes.length < 5_000_000);
    assert.ok(bytes.includes(Buffer.from(provenance.digital_source_type)));
  }
  for (const target of targets) {
    const asset = provenance.assets[target.key];
    assert.equal(asset.approved_source_crop_pixel_parity, 'PASS');
    for (const [kind, output] of Object.entries(asset.outputs)) {
      const file = `${target.key}-${kind}.${['merchant', 'provider'].includes(kind) ? 'jpg' : 'webp'}`;
      assert.equal(output.path, `public${base}/${file}`);
      assert.equal(output.sha256, { ...expectedHashes, ...expectedJpegHashes }[file]);
      assert.equal(output.bytes, fs.statSync(path.join(root, output.path)).size);
      assert.equal(output.xmp_preserved, true);
    }
  }
});
check('RE-NU v4 provenance locks all approved PNG sizes and the local-only base correction', () => {
  const provenance = JSON.parse(read('scripts/media/approved-primary-photo-provenance-20260911-re-nu-v4.json'));
  assert.equal(provenance.base_commit, '1866463859d9578dea65eb00cbb91885718b51ed');
  assert.equal(provenance.approval_date, '2026-09-11');
  assert.equal(provenance.approval_status, 'OWNER APPROVED RE-NU V4 HERO REPLACEMENT; REEL WORK STOPPED');
  assert.equal(provenance.provider_upload_performed, false);
  assert.deepEqual(Object.keys(provenance.assets), ['re-nu']);
  const asset = provenance.assets['re-nu'];
  assert.equal(asset.master_sha256, '3543b29c3b935ca06e9280636b0fd2519efa153c00738146e210bf1188b0ddd0');
  assert.equal(asset.primary_source_sha256, '1cdc1499ecdfc376b98d2116f5495a2239612d0102fa54fd1300be25be6fc505');
  assert.equal(asset.square_source_sha256, '9952494b092bba9cb747af92b1ebcfc43303a33c607e1307347a90b7fd3feedf');
  assert.equal(asset.previous_master_sha256, '74ca8c776d38ef02fa6b371074859d8fb0db2f058a37b016e1faa9cbfd822794');
  assert.equal(asset.approved_source_crop_pixel_parity, 'PASS');
  assert.deepEqual(asset.edited_bounds, { left: 682, top: 1338, right: 1000, bottom: 1440 });
  assert.equal(asset.changed_pixels, 28795);
  assert.equal(asset.outside_edit_region_changed_pixels, 0);
  assert.equal(asset.protected_above_y1338_changed_pixels, 0);
  assert.deepEqual(fs.readdirSync(path.join(root, 'public', renuBase)).sort(), Object.keys(expectedRenuV4Hashes).sort());
  for (const [kind, output] of Object.entries(asset.outputs)) {
    const file = `re-nu-${kind}.${['merchant', 'provider'].includes(kind) ? 'jpg' : 'webp'}`;
    assert.equal(output.path, `public${renuBase}/${file}`);
    assert.equal(output.sha256, expectedRenuV4Hashes[file]);
    assert.equal(output.bytes, fs.statSync(path.join(root, output.path)).size);
    assert.equal(output.xmp_preserved, true);
    assert.deepEqual(output.dimensions, ['primary', 'provider'].includes(kind) ? [1080, 1350] : kind === 'card' ? [640, 640] : [1080, 1080]);
  }
});
check('RE-NU v4 does not replace OASIS/AURA or turn retired v3 RE-NU images into active approved images', () => {
  for (const target of targets) {
    const media = approvedProductMedia({ id: target.id });
    assert.equal(media.primary, `${baseFor(target)}/${target.key}-primary.webp`);
    assert.equal(media.card, `${baseFor(target)}/${target.key}-card.webp`);
    const isRenu = target.key === 're-nu';
    for (const kind of ['primary', 'card']) {
      const previous = `${base}/${target.key}-${kind}.webp`;
      assert.equal(media.retiredImages.includes(previous), isRenu);
      assert.equal(isApprovedProductImage(previous), !isRenu);
      assert.equal(isApprovedProductImage(`${origin}${previous}`), !isRenu);
    }
  }
  assert.equal(isApprovedProductImage(`${renuBase}/aura-primary.webp`), false);
  assert.equal(isApprovedProductImage(`${renuBase}/oasis-card.webp`), false);
});
check('legacy display thumbnails use the shared resolver without changing selection or save handlers', () => {
  const contracts = [
    ['src/components/subscription/CompositionEditor.jsx', { handleSave: 'b3069b97ced3ef090c171da6cdf02f2f619be1c0f328feaa62b9f20bb316fb26', adjust: 'eb492b7ee76af6779fdd097217c2eb8bbb84f073d1016801e941619f8657aa02' }],
  ];
  for (const [file, handlers] of contracts) {
    const source = read(file);
    assert.match(source, /import ProductPhoto from '@\/components\/shop\/ProductPhoto'/);
    assert.match(source, /<ProductPhoto product=\{product\} thumbnail/);
    assert.doesNotMatch(source, /<img src=\{product\.image_url\}/);
    for (const [name, expected] of Object.entries(handlers)) {
      const handler = source.match(new RegExp(`const ${name} = [\\s\\S]*?\\n  \\};`));
      assert.ok(handler);
      assert.equal(crypto.createHash('sha256').update(handler[0]).digest('hex'), expected, `${file}: ${name} must be untouched by photo rollout`);
    }
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
  assert.equal(different.props.src, `${renuBase}/re-nu-primary.webp`, 'prior failures cannot hide another flavor');
});
check('ProductPhoto leaves unknown images, explicit alt and caller styles intact', () => {
  failedImageState = [];
  const element = ProductPhoto({ product: { title: 'Custom product', image_url: '/custom.jpg' }, alt: 'Specific view', style: { objectFit: 'cover' } });
  assert.equal(element.props.src, '/custom.jpg');
  assert.equal(element.props.style.objectFit, 'cover');
  assert.equal(element.props.alt, 'Specific view');
  assert.equal(element.props['data-approved-product-photo'], undefined);
  assert.equal(ProductPhoto({ product: { title: 'Unknown product' }, thumbnail: true }), null, 'unknown products with no image retain the legacy editor no-image behavior');
});

console.log(JSON.stringify({ ok: true, suite: 'approved-product-primary-media', checks, approved_products: targets.length, preserved_catalog_products: nonTargets.length, approved_assets: Object.keys(expectedHashes).length, render_state_contracts_only: true, provider_calls_performed: false, production_writes_performed: false }, null, 2));
