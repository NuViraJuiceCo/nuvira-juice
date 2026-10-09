#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import postcss from 'postcss';

const read = file => fs.readFileSync(file, 'utf8');
const source = read('src/components/desktop/DesktopLicensing.jsx');
const css = read('src/components/desktop/DesktopLicensing.css');
const legal = read('src/pages/Legal.jsx');
const footer = read('src/components/desktop/DesktopFooter.jsx');
const brandCss = read('src/styles/desktop-brand.css');
const module = { exports: {} };
const imports = {
  react: { ...React, default: React },
  'lucide-react': { ArrowUpRight: () => null, Building2: () => null, ShieldCheck: () => null },
  './DesktopLicensing.css': {},
};
vm.runInNewContext(transformSync(source, { loader: 'jsx', format: 'cjs' }).code, {
  module, exports: module.exports,
  require(name) { assert.ok(name in imports, name); return { __esModule: true, ...imports[name] }; },
});
const html = renderToStaticMarkup(React.createElement(module.exports.default));
assert.match(html, /id="licensing-insurance"/);
assert.match(html, /aria-labelledby="nv-licensing-title"/);
assert.match(html, /licensed to operate through the St\. Charles County Department of Public Health/);
assert.match(html, /NuVira Juice Company LLC/);
assert.match(html, /Accelerant National Insurance Company/);
assert.match(html, /Each occurrence[\s\S]*?\$1,000,000/);
assert.match(html, /Products-completed operations aggregate[\s\S]*?\$2,000,000/);
assert.match(html, /dateTime="2025-11-28"/);
assert.match(html, /dateTime="2026-11-28"/);
assert.match(html, /subject to policy terms, conditions, exclusions/);
assert.match(html, /mailto:support@nuvirajuice\.com\?subject=Licensing/);
for (const text of ['food handler', 'meets or exceeds', 'inspected and approved', 'HL25-', 'F341771', 'N0276GL', 'Pine Creek', 'Holiday Night Lights']) {
  assert.ok(!`${source}${legal}`.includes(text), `Unsupported or private detail: ${text}`);
}
assert.doesNotMatch(html, /href="[^"]+\.(pdf|htm)"/);
assert.match(footer, /to="\/legal#licensing-insurance"/);
assert.match(legal, /desktop \? <DesktopLicensing/);
assert.match(legal, /hash !== '#licensing-insurance'/);
assert.match(legal, /cancelAnimationFrame\(frame\)/);
assert.match(legal, /\[desktop, hash, key\]/);
assert.match(legal, /aria-expanded=\{openIndex === i\}/);
assert.match(legal, /role="region"/);
for (const fn of ['resetAnalyticsConsent', 'resetMarketingConsent', 'resetGoogleAdsMeasurementConsent']) assert.match(legal, new RegExp(`${fn}\\(\\)`));
for (const title of ['Privacy Policy', 'Terms of Service', 'Refund & Return Policy', 'Product Disclaimers', 'Allergen Information']) assert.ok(legal.includes(title));
postcss.parse(css).walkRules(rule => {
  for (const selector of rule.selectors) assert.ok(selector.startsWith('[data-desktop-brand="true"]'), `Unscoped browser rule: ${selector}`);
});
assert.match(css, /@media \(max-width: 640px\)/);
assert.match(css, /focus-visible/);
assert.match(brandCss, /main\[data-storefront-page\] \{ width: 100%; max-width: 1536px/);
assert.doesNotMatch(brandCss, /[^{}]*data-storefront-page="\/legal"[^{}]*\{[^{}]*max-width: 1040px/);
assert.match(css, /nv-legal-header,\.nv-legal-sections\) \{ padding-inline: 0/);
assert.match(css, /max-width: 85ch/);
console.log(JSON.stringify({ ok: true, suite: 'browser-licensing', checks: [
  'Owner-confirmed county licensing and certificate-scoped insurance details',
  'No private identifiers, expired temporary permit, raw documents, or unsupported approval claims',
  'Direct footer link, accessible section, accessible policy accordions and measurement choices retained',
  'Browser-only styling and responsive single-column layout',
  'Legal page uses the shared 1536px site width, aligned gutters and bounded policy reading measure',
] }, null, 2));
