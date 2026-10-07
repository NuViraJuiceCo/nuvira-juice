#!/usr/bin/env node
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildProductGallery, productAdditionalImageUrls, productGalleryThumbnail } from '../../src/lib/product-gallery-images.js';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const brandSource = read('src/lib/brandImages.js');
const brandModule = brandSource.replace("'@/lib/seo-slugs'", JSON.stringify(pathToFileURL(path.join(root, 'src/lib/seo-slugs.js')).href));
const { BRAND_IMAGES, BRAND_OG_IMAGE, websiteBrandImageProps } = await import(`data:text/javascript;base64,${Buffer.from(brandModule).toString('base64')}`);
const inputs = JSON.parse(read('scripts/media/website-image-inputs-20261006.json'));
const provenance = JSON.parse(read('scripts/media/website-image-provenance-20261006.json'));
const pdpSource = read('src/pages/ProductDetail.jsx');
const groups = [];
function test(name, run) { run(); groups.push(name); }

function webpChunks(buffer) {
  assert.equal(buffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(buffer.toString('ascii', 8, 12), 'WEBP');
  const chunks = new Map();
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const name = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    chunks.set(name, buffer.subarray(offset + 8, offset + 8 + size));
    offset += 8 + size + (size % 2);
  }
  return chunks;
}

test('frozen originals remain byte-identical', () => {
  assert.equal(inputs.source_commit, '27bd7d184e7d957a07aef59b33744f01e7af1c08');
  assert.equal(inputs.inputs.length, 17);
  for (const input of inputs.inputs) {
    const actual = fs.readFileSync(path.join(root, input.path));
    assert.equal(actual.length, input.bytes, input.path);
    assert.equal(sha(actual), input.sha256, input.path);
  }
});

test('18 bounded derivatives preserve dimensions, XMP and recorded hashes', () => {
  assert.equal(provenance.output_count, 18);
  assert.ok(provenance.output_bytes <= 1_400_000, 'Keep the existing site-size guard headroom');
  let bytes = 0;
  let count = 0;
  for (const input of provenance.assets) {
    assert.equal(input.sha256, inputs.inputs.find(item => item.path === input.path)?.sha256);
    for (const output of input.outputs) {
      const actual = fs.readFileSync(path.join(root, output.path));
      assert.equal(actual.length, output.bytes, output.path);
      assert.equal(sha(actual), output.sha256, output.path);
      const chunks = webpChunks(actual);
      const extended = chunks.get('VP8X');
      const lossy = chunks.get('VP8 ');
      assert.ok(extended || lossy, output.path);
      assert.equal(extended ? extended.readUIntLE(4, 3) + 1 : lossy.readUInt16LE(6) & 0x3fff, output.width);
      assert.equal(extended ? extended.readUIntLE(7, 3) + 1 : lossy.readUInt16LE(8) & 0x3fff, output.height);
      assert.ok(Math.abs(output.height - input.height * output.width / input.width) <= 1, 'Aspect ratio must be preserved within one output pixel');
      assert.ok(output.width <= input.width, 'No enlargement');
      assert.equal(chunks.has('XMP ') ? sha(chunks.get('XMP ')) : null, input.xmp_sha256, 'Original XMP presence and bytes must survive');
      assert.ok(output.psnr_db_against_same_size_original > 28);
      assert.ok(output.bytes < input.bytes, 'Every derivative must reduce the source payload');
      bytes += actual.length;
      count += 1;
    }
  }
  assert.equal(bytes, provenance.output_bytes);
  assert.equal(count, provenance.output_count);
  const expectedFiles = provenance.assets.flatMap(input => input.outputs.map(output => output.path)).sort();
  const actualFiles = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(path.join(root, directory), { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else actualFiles.push(file);
    }
  }
  walk('public/images/website-performance-20261006');
  assert.deepEqual(actualFiles.sort(), expectedFiles, 'No unused or superseded derivatives may enter the bounded site package');
});

test('native/default/unknown hero delivery and SEO original paths remain unchanged', () => {
  for (const src of Object.values(BRAND_IMAGES)) {
    assert.deepEqual(websiteBrandImageProps(src), { src });
    assert.deepEqual(websiteBrandImageProps(src, { website: false }), { src });
    assert.deepEqual(websiteBrandImageProps(src, { website: 'true' }), { src });
    assert.ok(!src.includes('website-performance'));
  }
  assert.deepEqual(websiteBrandImageProps('/unknown/photo.jpg', { website: true }), { src: '/unknown/photo.jpg' });
  assert.deepEqual(websiteBrandImageProps(BRAND_IMAGES.eventSampling, { website: true }), { src: BRAND_IMAGES.eventSampling });
  assert.deepEqual(websiteBrandImageProps(BRAND_IMAGES.eventCollateral, { website: true }), { src: BRAND_IMAGES.eventCollateral });
  assert.equal(BRAND_OG_IMAGE, 'https://nuvirajuice.com/images/brand/nuvira-og-cooler.jpg');
});

test('website hero candidates resolve to correct originals and recorded output widths', () => {
  for (const input of provenance.assets.filter(item => item.role === 'hero')) {
    const original = input.path.replace(/^public/, '');
    const props = websiteBrandImageProps(original, { website: true, sizes: '73vw' });
    assert.equal(props.src, original, 'JPEG remains fallback, not a different photo');
    assert.equal(props.sizes, '73vw');
    assert.equal(props.decoding, 'async');
    for (const candidate of props.srcSet.split(', ')) {
      const [url, width] = candidate.split(' ');
      const expectedWidth = Number(width.slice(0, -1));
      if (url === original) {
        assert.equal(expectedWidth, input.width, 'Original retained for large/high-DPR displays');
      } else {
        const output = input.outputs.find(item => '/' + item.path.replace(/^public\//, '') === url);
        assert.ok(output, candidate);
        assert.equal(expectedWidth, output.width);
      }
    }
    const maxDerivative = Math.max(...input.outputs.map(item => item.width));
    assert.equal(props.srcSet.includes(`${original} ${input.width}w`), input.width > maxDerivative);
  }
});

test('failed responsive photo restores original and original desktop picture branch once', () => {
  const props = websiteBrandImageProps(BRAND_IMAGES.aboutHeroMobile, { website: true });
  const attrs = new Map([['srcset', props.srcSet]]);
  const sourceAttrs = new Map([['srcset', 'optimized.webp'], ['data-original-srcset', BRAND_IMAGES.aboutHeroEvent]]);
  let restores = 0;
  const image = {
    getAttribute: name => attrs.get(name),
    removeAttribute: name => attrs.delete(name),
    parentElement: { querySelectorAll: selector => {
      assert.equal(selector, 'source[data-original-srcset]');
      return [{ getAttribute: name => sourceAttrs.get(name), setAttribute: (name, value) => { restores++; sourceAttrs.set(name, value); } }];
    } },
  };
  props.onError({ currentTarget: image });
  assert.equal(attrs.has('srcset'), false);
  assert.equal(sourceAttrs.get('srcset'), BRAND_IMAGES.aboutHeroEvent);
  props.onError({ currentTarget: image });
  assert.equal(restores, 1, 'Original failures must not loop');
});

test('gallery helpers preserve full photos, SEO, existing cards, and native defaults', () => {
  for (const product of PUBLIC_PRODUCT_FALLBACKS) {
    const gallery = buildProductGallery(product);
    for (const image of gallery) {
      const oldValue = image.thumbnail || image.src;
      assert.equal(productGalleryThumbnail(image), oldValue);
      assert.equal(productGalleryThumbnail(image, { website: false }), oldValue);
      if (image.thumbnail) assert.equal(productGalleryThumbnail(image, { website: true }), image.thumbnail);
    }
    assert.ok(productAdditionalImageUrls(product).every(src => src.endsWith('.jpg')), 'SEO/provider photo URLs must stay original');
    assert.ok(gallery.every(image => !image.src.includes('website-performance')), 'Selected full-size photo remains unchanged');
  }
});

test('website thumbnails cover only12 known authentic photos and preserve absolute URL form', () => {
  const thumbnails = new Set();
  for (const input of provenance.assets.filter(item => item.role === 'gallery-thumbnail')) {
    const src = input.path.replace(/^public/, '');
    const expected = input.outputs[0].path.replace(/^public/, '');
    assert.equal(productGalleryThumbnail({ src }, { website: true }), expected);
    assert.equal(productGalleryThumbnail({ src: 'https://nuvirajuice.com' + src }, { website: true }), 'https://nuvirajuice.com' + expected);
    thumbnails.add(expected);
  }
  assert.equal(thumbnails.size, 12);
  for (const src of ['https://elsewhere.example/images/authentic-products/aura/aura-drinking.jpg', '/images/unverified.jpg', '/images/authentic-products/aura/aura-drinking.jpg?version=other']) {
    assert.equal(productGalleryThumbnail({ src }, { website: true }), src, 'Never guess a provider image derivative');
  }
});

test('PDP thumbnail failure falls back to full photo without losing the gallery entry', () => {
  const region = pdpSource.slice(pdpSource.indexOf('src={productGalleryThumbnail('));
  const callback = region.match(/onError=\{(\(event\) => \{[\s\S]*?\n                    \})\}/)?.[1];
  assert.ok(callback, 'Image error handler must be present');
  for (const native of [false, true]) {
    for (const original of [{ src: '/images/authentic-products/aura/aura-drinking.jpg' }, { src: '/approved-primary.webp', thumbnail: '/approved-card.webp' }]) {
      const failed = [];
      const selected = productGalleryThumbnail(original, { website: !native });
      const element = { src: selected, getAttribute: () => element.src };
      const handler = vm.runInNewContext('(' + callback + ')', {
        image: original, index: 2, productGalleryThumbnail,
        isNativeAppRuntime: () => native,
        handleGalleryImageError: (...args) => failed.push(args),
      });
      handler({ currentTarget: element });
      if (selected !== original.src) {
        assert.equal(element.src, original.src);
        assert.equal(failed.length, 0);
        handler({ currentTarget: element });
      }
      assert.deepEqual(failed, [[original.src, 2]], 'Only a failed original should remove a gallery photo');
    }
  }
});

test('public page wiring explicitly gates derivatives without altering crop or loading policy', () => {
  const about = read('src/pages/About.jsx');
  const local = read('src/pages/LocalSeoLanding.jsx');
  for (const page of [about, local]) assert.match(page, /const website = !isNativeAppRuntime\(\)/);
  assert.match(about, /media="\(min-width: 768px\)"[\s\S]*?srcSet=\{desktopHero.srcSet \|\| BRAND_IMAGES.aboutHeroEvent\}/);
  assert.match(about, /\.\.\.mobileHero/);
  assert.match(about, /h-\[23rem\] w-full object-cover object-center md:h-\[32rem\] lg:h-\[30rem\]/);
  assert.match(local, /websiteBrandImageProps\(page.image, \{ website \}\)/);
  assert.match(local, /absolute inset-0 h-full w-full object-cover/);
  assert.match(pdpSource, /src=\{productGalleryThumbnail\(image, \{ website: !isNativeAppRuntime\(\) \}\)\}/);
  assert.match(pdpSource, /loading=\{index === 0 \? 'eager' : 'lazy'\}/);
  assert.match(pdpSource, /src=\{selectedProductImage.src\}/, 'Main selected photo stays original');
});

console.log(JSON.stringify({ ok: true, suite: 'website-image-delivery', groups: groups.length, tests: groups, source_count: inputs.inputs.length, derivative_count: provenance.output_count, derivative_bytes: provenance.output_bytes, native_defaults_preserved: true, provider_calls_performed: false }, null, 2));
