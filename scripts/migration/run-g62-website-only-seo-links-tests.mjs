#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const homeSource = fs.readFileSync('src/pages/Home.jsx', 'utf8');
const shopSource = fs.readFileSync('src/pages/Shop.jsx', 'utf8');
const sideNavSource = fs.readFileSync('src/components/layout/SideNav.jsx', 'utf8');
const nativeRuntimeSource = fs.readFileSync('src/lib/nativeRuntime.js', 'utf8');

assert.match(nativeRuntimeSource, /Capacitor\.isNativePlatform\?\.\(\) === true/);

assert.match(homeSource, /const showWebsiteFooter = !isNativeAppRuntime\(\)/);
assert.match(homeSource, /\{showWebsiteFooter && \(/);
assert.match(homeSource, /<footer className="hidden [^"]*md:block"/);

assert.match(shopSource, /import \{ isNativeAppRuntime \} from '@\/lib\/nativeRuntime';/);
assert.match(shopSource, /const showWebsiteSeoLinks = seoActive && !isNativeAppRuntime\(\)/);
assert.match(shopSource, /\{showWebsiteSeoLinks && \(/);
assert.match(shopSource, /<section className="hidden [^"]*md:block"/);

assert.match(sideNavSource, /const showWebsiteFooter = !isNativeAppRuntime\(\)/);
assert.match(sideNavSource, /\{showWebsiteFooter && \(/);

console.log(JSON.stringify({
  success: true,
  suite: 'g62-website-only-seo-links',
  cases: 10,
  writes_performed: false,
  provider_calls_performed: false,
}, null, 2));
