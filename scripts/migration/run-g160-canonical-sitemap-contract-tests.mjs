#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SITE_URL,
  STATIC_PAGES,
  buildSitemap,
  slugifyProductTitle,
} from '../../base44/functions/generateSitemap/sitemap.js';

const publicSitemap = fs.readFileSync('public/sitemap.xml', 'utf8');
const entrySource = fs.readFileSync('base44/functions/generateSitemap/entry.ts', 'utf8');
const critical = fs.readFileSync('scripts/ci/run-critical-regressions.mjs', 'utf8');

const syntheticProducts = [
  { title: 'OASIS', is_available: true, updated_date: '2026-08-27T12:34:56Z' },
  { title: 'OASIS', is_available: true, updated_date: '2026-08-28T12:34:56Z' },
  { title: 'The NuVira Trio', is_available: true },
  { title: 'Unavailable Product', is_available: false },
  { title: '', is_available: true },
];

const xml = buildSitemap(syntheticProducts, '2026-08-28');
const dynamicLocs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const publicLocs = [...publicSitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const publicStaticLocs = publicLocs.filter(loc => !loc.includes('/product/'));
const expectedStaticLocs = STATIC_PAGES.map(page => `${SITE_URL}${page.path}`);

assert.equal(SITE_URL, 'https://nuvirajuice.com');
assert.equal(slugifyProductTitle('The NuVira Trio'), 'the-nuvira-trio');
assert.deepEqual(new Set(expectedStaticLocs), new Set(publicStaticLocs));
assert.equal(expectedStaticLocs.length, publicStaticLocs.length);
assert.ok(dynamicLocs.includes('https://nuvirajuice.com/product/oasis.html'));
assert.ok(dynamicLocs.includes('https://nuvirajuice.com/product/the-nuvira-trio.html'));
assert.equal(dynamicLocs.filter(loc => loc.endsWith('/product/oasis.html')).length, 1);
assert.equal(dynamicLocs.some(loc => loc.includes('/product/unavailable-product.html')), false);
assert.equal(dynamicLocs.some(loc => loc.includes('www.nuvirajuice.com')), false);
assert.equal(dynamicLocs.some(loc => /\/shop\/[^/]+$/.test(loc)), false);
assert.equal(new Set(dynamicLocs).size, dynamicLocs.length);
assert.match(xml, /<lastmod>2026-08-27<\/lastmod>/);
assert.match(xml, /<lastmod>2026-08-28<\/lastmod>/);

assert.match(entrySource, /import \{ buildSitemap \} from '\.\/sitemap\.js'/);
assert.match(entrySource, /\['GET', 'HEAD'\]\.includes\(req\.method\)/);
assert.match(entrySource, /Product\.filter\(\{ is_available: true \}\)/);
assert.match(entrySource, /req\.method === 'HEAD' \? null : xml/);
assert.doesNotMatch(entrySource, /\/shop\/\$\{p\.id\}/);
assert.doesNotMatch(entrySource, /console\.error\([^\n]*error/);

assert.match(publicSitemap, /Canonical sitemap advertised by robots\.txt/);
assert.doesNotMatch(publicSitemap, /Submit the dynamic sitemap URL/);
assert.match(critical, /run-g160-canonical-sitemap-contract-tests\.mjs/);

console.log(JSON.stringify({
  ok: true,
  suite: 'g160-canonical-sitemap-contract',
  canonical_host: SITE_URL,
  static_route_count: STATIC_PAGES.length,
  synthetic_product_route_count: dynamicLocs.length - STATIC_PAGES.length,
  duplicate_urls: false,
  legacy_product_id_routes: false,
  unavailable_products_excluded: true,
  production_writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
