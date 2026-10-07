#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import { productBadges } from '../../src/lib/productBadges.js';
import { birthdayProductEligible } from '../../src/lib/birthdayCheckoutEligibility.js';
import { REFERRAL_OFFER } from '../../src/lib/referralOffer.js';
import { programCollectionSummary } from '../../src/lib/program-catalog.js';
import { assertSiteSize, measureSiteSize, SITE_SIZE_LIMIT_BYTES } from '../release/verify-site-size.mjs';

const read = file => fs.readFileSync(file, 'utf8');
const checks = [];
assert.deepEqual(productBadges({ category: 'shot', ingredients: 'Coconut Water, Honey, Lime' }), ['Contains Honey', 'Keep Chilled', 'Local Delivery']);
assert.deepEqual(productBadges({ category: 'juice' }), ['Cold-Pressed', 'Keep Chilled', 'Local Delivery']);
assert.deepEqual(productBadges({}, true), ['Reusable', 'Insulated', 'Large Capacity']);
for (const category of ['juice', 'bundle', 'shot', undefined]) {
  assert.ok(!productBadges({ category }).some(label => /vegan|gluten|non-gmo/i.test(label)));
}
checks.push('Product labels do not assert unverified dietary claims; honey is disclosed');
const birthdayProduct = { id: 'juice', category: 'juice', size: '12oz / 355ml', price: 13, is_available: true };
assert.equal(birthdayProductEligible(birthdayProduct), true);
for (const change of [{ size: '32oz' }, { category: 'bundle' }, { category: 'shot' }, { is_available: false }, { price: 0 }, { price: 'invalid' }]) assert.equal(birthdayProductEligible({ ...birthdayProduct, ...change }), false);
assert.match(read('src/pages/Cart.jsx'), /isEligible={birthdayProductEligible}/);
assert.match(read('src/pages/Cart.jsx'), /!birthdayProductEligible\(product\)\) return false/);
checks.push('Birthday picker and handler enforce the existing available 12oz juice rule');

assert.equal(REFERRAL_OFFER.friendDiscount, 5);
assert.deepEqual(REFERRAL_OFFER.milestones.map(m => m.count), [5, 10, 20]);
assert.match(REFERRAL_OFFER.terms, /completed purchase/);
assert.match(REFERRAL_OFFER.terms, /manually/);
assert.match(REFERRAL_OFFER.terms, /Order minimums still apply/);
for (const file of ['src/pages/Referral.jsx', 'src/pages/Rewards.jsx', 'src/pages/Account.jsx', 'src/components/desktop/DesktopReferral.jsx', 'src/components/desktop/DesktopRewards.jsx']) {
  assert.match(read(file), /REFERRAL_OFFER/);
  assert.doesNotMatch(read(file), /Give \$5, Get a Bottle|Refer a friend.*50/i);
}
checks.push('All referral surfaces use the approved $5 offer and manually verified 5/10/20 milestones');

assert.equal(programCollectionSummary(), '2 or 3 days of juice, thoughtfully paired. 8 or 12 bottles per program.');
assert.equal(programCollectionSummary([{ durationOptions: [{ days: 4, bottles: 16 }, { days: 2, bottles: 8 }] }, { days: 4, bottles: 16 }]), '2 or 4 days of juice, thoughtfully paired. 8 or 16 bottles per program.');
assert.match(read('src/pages/Shop.jsx'), /programCollectionSummary\(/);
assert.match(read('src/pages/Shop.jsx'), /setSearch\(''\);[\s\S]*?setCategory\('all'\)/);
assert.match(read('src/pages/Shop.jsx'), /No Matching Products/);
checks.push('Program summary follows catalog options; empty-shop recovery resets search and category');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvira-size-test-'));
try {
  fs.writeFileSync(path.join(temp, 'photo.jpg'), '123');
  assert.deepEqual(measureSiteSize(temp), { bytes: 3, files: 1 });
  fs.writeFileSync(path.join(temp, 'photo 2.jpg'), '123');
  assert.throws(() => measureSiteSize(temp), /numbered copy/);
  fs.unlinkSync(path.join(temp, 'photo 2.jpg'));
  fs.symlinkSync(path.join(temp, 'photo.jpg'), path.join(temp, 'linked.jpg'));
  assert.throws(() => measureSiteSize(temp), /symlink/);
  assert.equal(assertSiteSize(SITE_SIZE_LIMIT_BYTES), SITE_SIZE_LIMIT_BYTES);
  for (const invalid of [SITE_SIZE_LIMIT_BYTES + 1, -1, NaN, 0.5]) assert.throws(() => assertSiteSize(invalid));
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
checks.push('Release guard rejects duplicate numbered assets, symlinks and oversize packages');

function load(file, extras = {}) {
  const imports = {
    react: { ...React, default: React },
    'react-router-dom': { Link: ({ to, children }) => React.createElement('a', { href: to }, children) },
    'lucide-react': icons,
    './DesktopMemberLayout': { default: ({ title, children }) => React.createElement('main', null, React.createElement('h1', null, title), children) },
    '@/lib/referralOffer': { REFERRAL_OFFER }, ...extras,
  };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(read(file), { loader: 'jsx', format: 'cjs' }).code, {
    module, exports: module.exports,
    require(name) { assert.ok(name in imports, `Unexpected dependency: ${name}`); return { __esModule: true, ...imports[name] }; },
  });
  return module.exports.default;
}
const Rewards = load('src/components/desktop/DesktopRewards.jsx');
const reward = { id: 'reward-1', title: 'A Bottle on Us', points_required: 100, description: 'Choose a juice.' };
const base = { totalPoints: 150, lifetimePoints: 200, redeemedPoints: 50, tier: { name: 'Seed', min: 0, next: 500 }, rewards: [reward], earningOptions: [] };
const render = props => renderToStaticMarkup(React.createElement(Rewards, { ...base, ...props }));
assert.match(render({}), /Select Reward/);
assert.match(render({ totalPoints: 90 }), /disabled=""[^>]*>10 More Points to Unlock/);
assert.match(render({ busy: true }), /disabled=""[^>]*>Select Reward/);
assert.match(render({ activeReward: reward }), /Remove Selected Reward/);
assert.match(render({ rewards: [{ ...reward, id: undefined }] }), /Not Currently Available/);
assert.doesNotMatch(render({ rewards: [{ ...reward, id: undefined }], activeReward: { title: 'Different reward' } }), /Remove Selected Reward/);
function elements(node) {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
let applied, removed = false;
const applyTree = Rewards({ ...base, onApply: selected => { applied = selected; } });
elements(applyTree).find(node => node.type === 'button').props.onClick();
assert.equal(applied, reward);
elements(Rewards({ ...base, activeReward: reward, onRemove: () => { removed = true; } })).find(node => node.type === 'button').props.onClick();
assert.equal(removed, true);
checks.push('Actual rewards view preserves selection/removal handlers, points gates, busy and unavailable states');

for (const [file, title] of [['Cart', 'Your Cart'], ['OrderHistory', 'Your Orders'], ['OrderTracker', 'Order Tracking']]) {
  assert.match(read(`src/pages/${file}.jsx`), new RegExp(`<SEO title="${title}"`));
}
const app = read('src/App.jsx');
assert.match(app, /<Route element={<CustomerFlowLayout \/>}>[\s\S]*?order-confirmation[\s\S]*?order-incomplete[\s\S]*?order-tracker/);
const flow = read('src/components/layout/CustomerFlowLayout.jsx');
assert.match(flow, /if \(!browser\) return <Outlet/);
assert.match(flow, /<DesktopHeader/);
assert.match(flow, /<CartPreviewHost/);
assert.match(read('src/styles/browser-audit.css'), /\.nv-journey-header \{ position:relative/);
checks.push('Cart/orders/tracker titles and standalone browser shell are explicit; native shell stays unchanged');

for (const file of ['src/components/CustomerDialog.jsx', 'src/components/RewardProductPicker.jsx']) {
  const source = read(file);
  assert.match(source, /onOpenAutoFocus/);
  assert.match(source, /onCloseAutoFocus/);
  assert.match(source, /returnFocus\.current\.focus/);
  assert.match(source, /triggerRef\?\.current \|\| document\.activeElement/);
  assert.match(source, /onEscapeKeyDown/);
  assert.match(source, /onPointerDownOutside/);
}
for (const file of ['src/components/account/ProfileAvatar.jsx', 'src/components/FreeProductPicker.jsx', 'src/pages/SubscriptionManagement.jsx', 'src/pages/ProgramJourney.jsx']) assert.match(read(file), /<CustomerDialog/);
const preferences = read('src/components/NotificationPreferencesPanel.jsx');
assert.match(preferences, /role="switch"/);
assert.match(preferences, /aria-checked={enabled}/);
assert.match(preferences, /aria-label={label}/);
checks.push('Dialogs use focus trapping/restoration and busy guards; preferences expose switch names/states');
console.log(JSON.stringify({ ok: true, suite: 'browser-audit-remediation', checks, provider_calls: 0, production_writes: false }, null, 2));
