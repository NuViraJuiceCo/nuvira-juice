#!/usr/bin/env node
// Synthetic only: exact assets, built HTML and the installed Helmet client
// reconciliation against a minimal head DOM. No browser/provider/network calls.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import helmetPackage from 'react-helmet-async';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { buildProductSeoMetadata, buildProductStructuredData } from '../../src/lib/product-seo.js';
import { socialShareImageForUrl } from '../../src/lib/social-share-images.js';
import { ownRouteMetadata, renderPublicShareHtml, renderProductCrawlerHtml, productCrawlerSeoPages, renderProductCanonicalRedirect, renderReturnPolicyCrawlerHtml, renderDeliveryPolicyCrawlerHtml } from '../seo/product-crawler-pages.mjs';
import { SITE_SIZE_LIMIT_BYTES, assertSiteSize, measureSiteSize } from '../release/verify-site-size.mjs';

const root = process.cwd();
const { Helmet, HelmetData, HelmetProvider } = helmetPackage;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const index = read('index.html');
const routes = ['/', '/shop', '/product/oasis.html', '/product/aura.html', '/product/re-nu.html', '/product/the-nuvira-trio.html'];
const expectedHashes = {
  oasis: '2e95bd053c9caf337e011b4de0378887863688edba8d77a6a1bb4ec33724f5fb',
  aura: 'ef5a3fb787307a6ceaa5eb57c2c9b035a570d687b54efdac385466f043c502d1',
  're-nu': '7f39bac751addadf516b26d82e02569aaba0abdd3c030902e8a098c2cd45834e',
  trio: 'b1269619db5b873d98698ab4b55d58087b355a1106ca94c41d605602f46f0e84',
  homepage: 'c07e989f6217ebbe75a232ca2947723e3a2c5f050f714c0c93437c1a06501e2b',
  shop: '18bd9edaffab1a04ff416be88edc43cb27bfd6cb9568c7042c358c1231845fe4',
};
let count = 0;
const test = (name, fn) => { fn(); count++; console.log(`PASS ${name}`); };
const attrs = tag => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], match[2]]));
const tags = html => [...html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)[1].matchAll(/<(meta|link)\b[^>]*>/g)].map(match => ({ tag: match[1], ...attrs(match[0]) }));
const one = (html, attribute, value) => {
  const matches = tags(html).filter(tag => tag[attribute] === value);
  assert.equal(matches.length, 1, `${attribute}=${value} must be unique`);
  return matches[0];
};
function jpegMetadata(bytes) {
  assert.equal(bytes.readUInt16BE(0), 0xffd8, 'Expected real JPEG');
  const result = { width: 0, height: 0, xmp: '' };
  for (let offset = 2; offset < bytes.length;) {
    assert.equal(bytes[offset], 0xff);
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset + 2);
    const data = bytes.subarray(offset + 4, offset + 2 + length);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      result.height = data.readUInt16BE(1);
      result.width = data.readUInt16BE(3);
    }
    if (marker === 0xe1 && data.toString('utf8', 0, data.indexOf(0)) === 'http://ns.adobe.com/xap/1.0/') result.xmp = data.subarray(data.indexOf(0) + 1).toString('utf8');
    offset += length + 2;
  }
  return result;
}

test('six exact existing approved JPEG cards retain dimensions and AI-composite provenance', () => {
  const receipt = JSON.parse(read('scripts/media/approved-social-share-jpeg-provenance-20260911.json'));
  assert.equal(receipt.assets.length, 6);
  assert.equal(receipt.publication_performed, false);
  for (const route of routes) {
    const card = socialShareImageForUrl(route);
    const bytes = fs.readFileSync(path.join(root, 'public', new URL(card.url).pathname));
    const metadata = jpegMetadata(bytes);
    assert.equal(hash(bytes), expectedHashes[card.key]);
    assert.equal(metadata.width, card.width);
    assert.equal(metadata.height, card.height);
    assert.match(metadata.xmp, /compositeWithTrainedAlgorithmicMedia/);
    assert.equal(hash(metadata.xmp), receipt.assets.find(asset => asset.key === card.key).xmp_sha256);
    assert.ok(card.alt.length > 20 && card.alt.length < 150);
  }
  assert.equal(fs.existsSync(path.join(root, 'public/images/social-share/20260911-approved-v1')), false, 'Never-deployed PNG copies must not remain in site payload');
  assert.equal(receipt.assets.reduce((sum, asset) => sum + asset.bytes, 0), 1_660_898);
  assert.equal(receipt.retired_pngs.length, 6);
});
test('site-size guard fails before publishing oversized packages and is mandatory in the build command', () => {
  assert.equal(SITE_SIZE_LIMIT_BYTES, 49_000_000);
  for (const bytes of [0, 47_267_584, 49_000_000]) assert.equal(assertSiteSize(bytes), bytes);
  for (const bytes of [-1, NaN, 49_000_001, 50_000_000, 53_383_538]) assert.throws(() => assertSiteSize(bytes), /maximum permitted/);
  assert.equal(JSON.parse(read('package.json')).scripts.build, 'vite build && node scripts/release/verify-site-size.mjs');
});
test('route selection is exact, same-origin and tracking-query independent', () => {
  for (const route of routes) {
    assert.deepEqual(socialShareImageForUrl(`https://nuvirajuice.com${route}?utm_source=facebook#details`), socialShareImageForUrl(route));
  }
  for (const value of [null, '', '/about', '/product/oasis', '/product/oasis.html/', '/product/OASIS.html', '/product/reset-shot.html', 'https://example.com/product/oasis.html', '//nuvirajuice.com/shop', 'https://user@nuvirajuice.com/shop']) {
    assert.equal(socialShareImageForUrl(value), null, `unknown input must preserve its existing behavior: ${value}`);
  }
});
test('all 11 catalog, Product schema, product-image and value contracts are unchanged from canonical base', () => {
  const snapshot = PUBLIC_PRODUCT_FALLBACKS.map(product => ({ product, metadata: buildProductSeoMetadata(product), schema: buildProductStructuredData(product) }));
  assert.equal(hash(JSON.stringify(snapshot)), 'a1675b6c5e3169b74477973a4128ea0ed5fc45912a35d86d792e3c0f4c23fa1b');
  assert.doesNotMatch(JSON.stringify(snapshot), /images\/social-share/);
});
test('every static product has one managed social set and untouched schema/noscript photos', () => {
  for (const product of PUBLIC_PRODUCT_FALLBACKS) {
    const metadata = buildProductSeoMetadata(product);
    const card = socialShareImageForUrl(metadata.canonicalUrl);
    const html = renderProductCrawlerHtml(index, product);
    for (const [attribute, key] of [['property', 'og:image'], ['name', 'twitter:image']]) {
      const tag = one(html, attribute, key);
      assert.equal(tag.content, card?.url || metadata.image);
      assert.equal(tag['data-rh'], 'true');
    }
    assert.equal(one(html, 'name', 'twitter:url').content, metadata.canonicalUrl);
    assert.equal(one(html, 'property', 'og:url').content, metadata.canonicalUrl);
    assert.equal(one(html, 'rel', 'canonical').href, metadata.canonicalUrl);
    for (const dimension of ['width', 'height']) {
      const found = tags(html).filter(tag => tag.property === `og:image:${dimension}`);
      assert.equal(found.length, card ? 1 : 0);
      if (card) assert.equal(found[0].content, String(card[dimension]));
    }
    const rawSchema = html.match(/<script type="application\/ld\+json" data-nuvira-product-schema>([\s\S]*?)<\/script>/)[1];
    assert.deepEqual(JSON.parse(rawSchema), buildProductStructuredData(product));
    assert.doesNotMatch(rawSchema, /images\/social-share/);
    assert.ok(html.includes(`<img src="${metadata.image}"`));
    assert.doesNotMatch(html.match(/<noscript>[\s\S]*?<\/noscript>/)[0], /images\/social-share/);
  }
});
test('root/shop static documents have distinct cards and leave business schema unchanged', () => {
  const schema = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => match[1]);
  for (const route of ['/', '/shop']) {
    const html = renderPublicShareHtml(index, route);
    const card = socialShareImageForUrl(route);
    assert.equal(one(html, 'property', 'og:image').content, card.url);
    assert.equal(one(html, 'name', 'twitter:image').content, card.url);
    assert.equal(one(html, 'name', 'twitter:url').content, `https://nuvirajuice.com${route}`);
    assert.equal(one(html, 'rel', 'canonical').href, `https://nuvirajuice.com${route}`);
    assert.deepEqual(schema(html), schema(index));
  }
});
test('build emits six intended share surfaces without contaminating policy output or redirect behavior', () => {
  const emitted = [];
  const bundle = { 'index.html': { type: 'asset', source: index } };
  productCrawlerSeoPages().generateBundle.call({ emitFile: file => emitted.push(file) }, {}, bundle);
  assert.equal(emitted.length, 27); // 22 existing product + 4 policy + one supplemental shop
  assert.equal(one(bundle['index.html'].source, 'property', 'og:image').content, socialShareImageForUrl('/').url);
  const template = renderProductCanonicalRedirect(index);
  for (const [name, renderer] of [['returns', renderReturnPolicyCrawlerHtml], ['delivery', renderDeliveryPolicyCrawlerHtml]]) {
    assert.equal(emitted.find(file => file.fileName === `${name}.html`).source, renderer(template));
  }
  assert.ok(emitted.find(file => file.fileName === 'shop/index.html'));
  for (const product of PUBLIC_PRODUCT_FALLBACKS) {
    assert.equal(emitted.find(file => file.fileName === `product/${product.slug}.html`).source, emitted.find(file => file.fileName === `product/${product.slug}/index.html`).source);
  }
});
test('ownership removes duplicate route tags but preserves verification tags and unmanaged Product JSON-LD', () => {
  const sample = '<head><meta property="og:image" content="first" /><meta property="og:image" content="old" /><meta name="facebook-domain-verification" content="a" /><meta name="facebook-domain-verification" content="b" /><script type="application/ld+json" data-nuvira-product-schema>{}</script></head>';
  const result = ownRouteMetadata(sample);
  assert.equal(one(result, 'property', 'og:image').content, 'first');
  assert.equal(tags(result).filter(tag => tag.name === 'facebook-domain-verification').length, 2);
  assert.match(result, /<script type="application\/ld\+json" data-nuvira-product-schema>\{\}<\/script>/);
  assert.equal(ownRouteMetadata(result), result);
});

// Exercise real installed Helmet parsing and client reconciliation without a
// browser. Only the DOM head methods it uses are simulated; not a visual test.
const require = createRequire(import.meta.url);
const bundled = await build({
  stdin: { contents: "export { default as SEO, LOCAL_BUSINESS_SCHEMA } from './src/components/SEO.jsx';", resolveDir: root },
  bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
  alias: { '@': path.join(root, 'src') }, external: ['react', 'react/jsx-runtime', 'react-helmet-async'],
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, module, module.exports);
const { SEO, LOCAL_BUSINESS_SCHEMA } = module.exports;
class Node {
  constructor(type, attributes = {}) { this.type = type; this.attributes = { ...attributes }; this.parentNode = null; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  isEqualNode(other) { return this.type === other.type && JSON.stringify(Object.entries(this.attributes).sort()) === JSON.stringify(Object.entries(other.attributes).sort()); }
}
test('actual Helmet replaces initial metadata on product-to-product-to-shop-to-about transitions and later same-route data updates', () => {
  const source = renderProductCrawlerHtml(index, PUBLIC_PRODUCT_FALLBACKS.find(product => product.slug === 'oasis'));
  const nodes = tags(source).map(({ tag, ...attributes }) => new Node(tag, attributes));
  const productSchemaNode = new Node('script', { type: 'application/ld+json', 'data-nuvira-product-schema': '' });
  nodes.push(productSchemaNode);
  const head = {
    querySelectorAll(selector) { const type = selector.split('[')[0]; return nodes.filter(node => node.type === type && node.getAttribute('data-rh') !== null); },
    appendChild(node) { node.parentNode = head; nodes.push(node); },
    removeChild(node) { nodes.splice(nodes.indexOf(node), 1); },
  };
  nodes.forEach(node => { node.parentNode = head; });
  const previous = globalThis.document;
  const oldCanUseDOM = HelmetProvider.canUseDOM;
  globalThis.document = { head, title: '', createElement: type => new Node(type), getElementsByTagName: () => [] };
  HelmetProvider.canUseDOM = true;
  const helmetData = new HelmetData({}, true);
  let dispatcher;
  const render = props => {
    const element = SEO(props);
    const helmet = new Helmet({ ...Helmet.defaultProps, ...element.props, helmetData, defer: false });
    const next = helmet.render();
    if (dispatcher) { dispatcher.props = next.props; dispatcher.componentDidUpdate(); }
    else { dispatcher = new next.type(next.props); dispatcher.render(); }
    for (const [attribute, value] of [['property', 'og:image'], ['property', 'og:url'], ['name', 'twitter:image'], ['name', 'twitter:url'], ['rel', 'canonical'], ['name', 'description']]) {
      assert.equal(nodes.filter(node => node.getAttribute(attribute) === value).length, 1, `${value} remains unique`);
    }
    const get = (attribute, value) => nodes.find(node => node.getAttribute(attribute) === value);
    const expected = socialShareImageForUrl(props.canonicalPath)?.url || props.image;
    assert.equal(get('property', 'og:image').getAttribute('content'), expected);
    assert.equal(get('name', 'twitter:image').getAttribute('content'), expected);
    assert.equal(get('name', 'twitter:url').getAttribute('content'), `https://nuvirajuice.com${props.canonicalPath}`);
    const dimensions = nodes.filter(node => ['og:image:width', 'og:image:height'].includes(node.getAttribute('property')));
    assert.equal(dimensions.length, socialShareImageForUrl(props.canonicalPath) ? 2 : 0);
    assert.ok(nodes.includes(productSchemaNode), 'Helmet must not remove crawler-owned Product JSON-LD');
  };
  try {
    for (const route of ['/product/oasis.html', '/product/aura.html', '/product/re-nu.html', '/shop', '/about']) render({ canonicalPath: route, image: 'https://nuvirajuice.com/original-about.jpg', title: 'Route title' });
    render({ canonicalPath: '/product/oasis.html', image: 'https://nuvirajuice.com/loading.jpg', title: 'Loading' });
    // Same route, later data update; no sanitizer route effect is invoked.
    render({ canonicalPath: '/product/oasis.html', image: 'https://nuvirajuice.com/loaded.jpg', title: 'OASIS' });
    assert.equal(LOCAL_BUSINESS_SCHEMA.image.includes('/images/social-share/'), false);
  } finally {
    dispatcher?.componentWillUnmount();
    HelmetProvider.canUseDOM = oldCanUseDOM;
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});
if (process.argv.includes('--built')) test('actual Vite output contains approved byte-identical cards and one correct social set per route', () => {
  const measured = measureSiteSize(path.join(root, 'dist'));
  assertSiteSize(measured.bytes);
  assert.ok(measured.files > 0);
  assert.equal(fs.existsSync(path.join(root, 'dist/images/social-share/20260911-approved-v1')), false);
  for (const route of routes) {
    const file = route === '/' ? 'index.html' : route === '/shop' ? 'shop/index.html' : route.slice(1);
    const html = read(`dist/${file}`);
    const card = socialShareImageForUrl(route);
    assert.equal(one(html, 'property', 'og:image').content, card.url);
    assert.equal(one(html, 'name', 'twitter:image').content, card.url);
    assert.equal(one(html, 'property', 'og:image:width').content, '1200');
    assert.equal(one(html, 'property', 'og:image:height').content, '630');
    assert.equal(one(html, 'name', 'twitter:url').content, `https://nuvirajuice.com${route}`);
    const asset = fs.readFileSync(path.join(root, 'dist', new URL(card.url).pathname));
    assert.equal(hash(asset), expectedHashes[card.key]);
    assert.match(jpegMetadata(asset).xmp, /compositeWithTrainedAlgorithmicMedia/);
  }
  for (const product of PUBLIC_PRODUCT_FALLBACKS) {
    const html = read(`dist/product/${product.slug}.html`);
    const raw = html.match(/<script type="application\/ld\+json" data-nuvira-product-schema>([\s\S]*?)<\/script>/)[1];
    assert.deepEqual(JSON.parse(raw), buildProductStructuredData(product));
  }
});
console.log(`Social share cards: ${count}/${count} checks passed (synthetic, no provider writes).`);
