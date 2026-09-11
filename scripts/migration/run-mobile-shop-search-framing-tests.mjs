#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { approvedProductMedia } from '../../src/lib/approved-product-media.js';
import { buildProductGallery } from '../../src/lib/product-gallery-images.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const shop = read('src/pages/Shop.jsx');
const inputSource = read('src/components/ui/input.jsx');
const viewport = read('index.html').match(/<meta\s+name="viewport"\s+content="([^"]+)"\s*\/>/)?.[1];
const inputJsx = shop.match(/<Input\s+placeholder="Search juices, bundles, merch\.\.\."[\s\S]*?\/>/)?.[0];
assert.ok(inputJsx, 'Inspect the actual Shop search Input, not a duplicate fixture');
let checks = 0;
const check = (name, run) => { run(); checks += 1; console.log(`PASS ${name}`); };

// Compose the actual Shop input with the real shared Input and cn/twMerge.
// No app mount, search tracking, network, checkout or provider execution.
const bundled = await build({
  stdin: { contents: `import { Input } from './src/components/ui/input.jsx';
    export function shopInput(search, setSearch) { return (${inputJsx}); }`,
  resolveDir: root, sourcefile: 'mobile-shop-search-contract.jsx', loader: 'jsx' },
  bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'], logLevel: 'silent',
  plugins: [{ name: 'local-source-aliases', setup(builder) {
    builder.onResolve({ filter: /^@\// }, args => {
      const candidate = path.join(root, 'src', args.path.slice(2));
      return { path: [candidate, `${candidate}.js`, `${candidate}.jsx`].find(file => fs.existsSync(file)) };
    });
  } }],
});
const module = { exports: {} };
// utils.js also exports an unrelated isIframe flag; isolate its read-only window probe.
new Function('require', 'module', 'exports', 'window', bundled.outputFiles[0].text)(require, module, module.exports, { self: null, top: null });
const { shopInput } = module.exports;
const rendered = renderToStaticMarkup(shopInput('Oasis', () => {}));
const className = rendered.match(/class="([^"]+)"/)?.[1];
assert.ok(className);
const classes = className.split(/\s+/);

check('real Shop input explicitly overrides both base and shared desktop font size', () => {
  const sourceClasses = inputJsx.match(/className="([^"]+)"/)?.[1].split(/\s+/);
  assert.ok(sourceClasses.includes('text-base'));
  assert.ok(sourceClasses.includes('md:text-base'));
  assert.ok(classes.includes('text-base'));
  assert.ok(classes.includes('md:text-base'));
  assert.ok(!classes.some(token => /^(?:(?:sm|md|lg|xl|2xl):)?text-(?:xs|sm)$/.test(token)),
    'A composed responsive text-sm would still shrink landscape/tablet touch inputs');
  assert.doesNotMatch(inputJsx, /style=|autoFocus|transform|scale-|zoom/);
});

check('shared Input defaults remain unchanged for unrelated consumers', () => {
  assert.match(inputSource, /text-base shadow-sm/);
  assert.match(inputSource, /md:text-sm/);
  assert.match(inputSource, /className=\{cn\(/);
  assert.match(inputSource, /className\s*\)/);
});

// Derive actual generated CSS from project Tailwind configuration. This catches
// a theme override or class-merging change that source-string checks would miss.
const configModule = { exports: {} };
new Function('module', 'require', read('tailwind.config.js'))(configModule, require);
const css = await require('postcss')([require('tailwindcss')({
  ...configModule.exports,
  content: [{ raw: rendered, extension: 'html' }],
})]).process('@tailwind utilities;', { from: undefined });
const baseFont = [];
const responsiveFont = [];
css.root.walkRules(rule => {
  if (!['.text-base', '.md\\:text-base'].includes(rule.selector)) return;
  rule.walkDecls('font-size', declaration => {
    (rule.selector === '.text-base' ? baseFont : responsiveFont).push({
      value: declaration.value,
      media: rule.parent.type === 'atrule' ? rule.parent.params : null,
    });
  });
});
check('generated CSS keeps 1rem search text below and above the md breakpoint', () => {
  assert.deepEqual(baseFont, [{ value: '1rem', media: null }]);
  assert.deepEqual(responsiveFont, [{ value: '1rem', media: '(min-width: 768px)' }]);
  assert.doesNotMatch(css.css, /\.md\\:text-sm\s*\{/);
  assert.doesNotMatch(read('src/index.css'), /html\s*\{[^}]*font-size\s*:\s*(?:[0-9]|1[0-5])px/s);
});

check('search value, change handler, placeholder and tap-target styling remain intact', () => {
  assert.match(rendered, /value="Oasis"/);
  assert.match(rendered, /placeholder="Search juices, bundles, merch\.\.\."/);
  for (const token of ['pl-9', 'h-11', 'rounded-xl', 'bg-secondary/50', 'border-0']) assert.ok(classes.includes(token));
  let nextSearch;
  shopInput('', value => { nextSearch = value; }).props.onChange({ target: { value: 'ginger + lemon' } });
  assert.equal(nextSearch, 'ginger + lemon');
  assert.match(inputJsx, /value=\{search\}/);
  assert.match(inputJsx, /onChange=\{\(e\) => setSearch\(e\.target\.value\)\}/);
});

check('actual Shop filtering preserves product, ingredient, tag and bundle search', () => {
  const filterBody = shop.match(/const filtered = useMemo\(\(\) => \{([\s\S]*?)\n  \}, \[products, bundles, category, search, filterParam\]\);/)?.[1];
  assert.ok(filterBody, 'Evaluate the existing filter callback without mounting Shop');
  const filter = new Function('products', 'bundles', 'category', 'search', 'filterParam', filterBody);
  const products = [
    { id: 'a', title: 'OASIS', ingredients: 'Watermelon, lemon', category: 'juice', tags: ['refreshing'] },
    { id: 'b', title: 'AURA', ingredients: 'Carrot, ginger', category: 'juice', tags: [] },
    { id: 't', title: 'Trio', category: 'bundle', tags: [] },
  ];
  const bundles = [{ id: 't', default_composition: [{ product_id: 'a' }, { product_id: 'b' }] }];
  const ids = (query, category = 'all') => filter(products, bundles, category, query, null).map(product => product.id);
  assert.deepEqual(ids('oasis'), ['a', 't']);
  assert.deepEqual(ids('ginger'), ['b', 't']);
  assert.deepEqual(ids('refreshing'), ['a']);
  assert.deepEqual(ids('['), []);
  assert.deepEqual(ids('', 'juice'), ['a', 'b']);
  assert.deepEqual(ids(''), ['a', 'b', 't']);
});

check('viewport retains pinch zoom instead of masking focus zoom with a zoom lock', () => {
  assert.ok(viewport);
  assert.match(viewport, /width=device-width/);
  assert.match(viewport, /initial-scale=1\.0/);
  assert.doesNotMatch(viewport, /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\.0)?(?:,|$)/i);
  assert.doesNotMatch(shop, /user-scalable|maximum-scale|visualViewport|gesturestart|touchmove|preventDefault\(/);
  assert.match(read('src/index.css'), /touch-action:\s*pan-x pan-y pinch-zoom/);
});

check('all three approved galleries keep four images and exclude their retired originals', () => {
  for (const slug of ['aura', 'oasis', 're-nu']) {
    const product = PUBLIC_PRODUCT_FALLBACKS.find(item => item.slug === slug);
    assert.ok(product);
    const approved = approvedProductMedia(product);
    const gallery = buildProductGallery(product);
    assert.equal(gallery.length, 4);
    assert.equal(gallery[0].src, approved.primary);
    assert.equal(gallery[0].thumbnail, approved.card);
    assert.equal(gallery[0].fit, 'contain');
    assert.ok(gallery.every(image => image.src !== product.image_url));
  }
});

console.log(JSON.stringify({ ok: true, suite: 'mobile-shop-search-framing', checks,
  shared_input_composition: 'tested', generated_font_size: '1rem at all widths',
  pinch_zoom_preserved: true, search_filter_contracts: 6,
  external_requests: 0, provider_calls: 0, physical_device_validation: 'separate gate' }, null, 2));
