import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import { customerDashboardOrders } from '../../src/lib/customerDashboardQueries.js';
import { REFERRAL_OFFER } from '../../src/lib/referralOffer.js';

const read = path => fs.readFileSync(path, 'utf8');
const empty = () => null;
const link = ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children);
const imports = {
  '@/lib/referralOffer': { REFERRAL_OFFER },
  react: { ...React, default: React },
  'react-router-dom': { Link: link, NavLink: ({ end: _end, ...props }) => link(props) },
  'lucide-react': icons,
  '@/components/SEO': { default: empty },
  '@/styles/desktop-member.css': {},
};
function load(path, extras = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transformSync(read(path), { loader: 'jsx', format: 'cjs' }).code, {
    module, exports: module.exports,
    require(name) { assert.ok(name in { ...imports, ...extras }, name); return { __esModule: true, ...({ ...imports, ...extras }[name]) }; },
  });
  return module.exports.default;
}
const Layout = load('src/components/desktop/DesktopMemberLayout.jsx');
imports['./DesktopMemberLayout'] = { default: Layout };
const Account = load('src/components/desktop/DesktopAccount.jsx', {
  '@/components/account/CreditWallet': { default: () => React.createElement('div', { 'data-credit-wallet': true }) },
  '@/components/account/ProfileAvatar': { default: empty },
  '@/components/account/MemberProgramCard': { default: ({ isError, isLoading }) => React.createElement('div', { 'data-program-state': isError ? 'error' : isLoading ? 'loading' : 'ready' }) },
  '@/lib/admin-access': { isAdminUser: user => user?.role === 'admin' },
});
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const checks = [];
const base = { user: { first_name: 'Preview' }, orders: [] };
let html = render(Account, { ...base, isLoading: true });
assert.match(html, /Loading your orders/);
assert.doesNotMatch(html, /data-credit-wallet|orders in your history/);
html = render(Account, { ...base, isError: true });
assert.match(html, /order summary is unavailable/);
assert.doesNotMatch(html, /data-credit-wallet|orders in your history/);
html = render(Account, { ...base, dashData: {}, isProgramError: true });
assert.match(html, /Find Your Mix/);
assert.match(html, /data-program-state="error"/);
assert.doesNotMatch(html, /href="\/admin\/operations"/);
html = render(Account, { ...base, dashData: {}, orders: [{ id: '1' }, { id: '2' }], user: { role: 'admin' } });
assert.match(html, /<strong>2<\/strong>/);
assert.match(html, /View Your Orders/);
assert.match(html, /data-credit-wallet/);
assert.match(html, /href="\/admin\/operations"/);
assert.deepEqual(customerDashboardOrders({ orders: { total: 99 }, all_orders_raw: [{ id: '1' }] }), [{ id: '1' }]);
checks.push('Account uses canonical order rows; loading/error never become zero balances or empty history; admin link stays role-gated');

const Referral = load('src/components/desktop/DesktopReferral.jsx');
html = render(Referral, { code: 'NuVira26', email: '', copied: false });
assert.match(html, /Copy referral code/);
assert.match(html, /<strong>5<\/strong>referrals/);
assert.match(html, /manually/);
assert.match(html, /Order minimums still apply/);
assert.doesNotMatch(html, /Give \$5, Get a Bottle/);
assert.match(html, /type="email" required=""/);
assert.match(html, /Prepare email invitation[^>]+disabled|disabled=""[^>]+Prepare email invitation/);
html = render(Referral, { code: 'NuVira26', email: 'review@example.com', copied: true });
assert.match(html, /Code copied/);
checks.push('Referral offer matches existing five-referral milestone; copy and email states remain accessible and minimums remain explicit');

const Partner = load('src/components/desktop/DesktopPartner.jsx', {
  '@/lib/brandImages': { BRAND_IMAGES: { aboutHeroEvent: '/event.jpg' }, websiteBrandImageProps: src => ({ src }) },
});
html = render(Partner, { form: { name: '', business: '', email: '', phone: '', type: '', notes: '' } });
assert.equal((html.match(/required=""/g) || []).length, 4);
assert.equal((html.match(/autoComplete=/g) || []).length, 4);
assert.match(html, /href="#partnership-inquiry"/);
assert.match(html, /id="partnership-inquiry"/);
assert.match(html, /alt="NuVira serving fresh juice at a local community event"/);
html = render(Partner, { form: {}, loading: true });
assert.match(html, /disabled=""/);
assert.match(html, /Sending\.\.\./);
checks.push('Partnership form retains four required fields, native email validation, business options, loading state and jump target');

for (const [file, component] of [['Account', 'DesktopAccount'], ['Referral', 'DesktopReferral'], ['Partner', 'DesktopPartner']]) {
  const source = read(`src/pages/${file}.jsx`);
  assert.match(source, /const desktop = useDesktopStorefront\(\)/);
  assert.match(source, new RegExp(`if \\(desktop\\) return <${component}`));
}
const settings = read('src/pages/AccountSettings.jsx');
assert.match(settings, /return desktop \? <DesktopMemberLayout/);
assert.match(settings, /deleteConfirm !== 'DELETE'/);
assert.match(settings, /await base44\.auth\.updateMe/);
const operations = read('src/pages/admin/Operations.jsx');
assert.ok(operations.indexOf('if (!isAdminUser(user))', operations.indexOf('export default')) < operations.indexOf('if (desktop) return'));
assert.match(operations, /memberPreview \? <section[\s\S]*?: <div className="nv-operations-live"><OperationsSnapshot/);
assert.match(operations, /\) : data \? \([\s\S]*?<OperationsPulse/);
assert.match(read('scripts/qa/serve-member-preview.mjs'), /getCustomerAccountDashboardData/);
checks.push('Layouts remain desktop-only; existing settings and inquiry handlers remain; admin preview never mounts live snapshot and absent data never renders ready/clear metrics');
console.log(JSON.stringify({ ok: true, suite: 'desktop-member', checks, production_writes: false }, null, 2));
