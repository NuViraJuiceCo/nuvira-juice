#!/usr/bin/env node
// Render the actual pages with synthetic read results; no API/provider calls.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { customerWebsiteMotionOverrides, usesImmediateCustomerWebsiteLayout } from '../../src/lib/customerWebsiteMotion.js';

const BASELINE = '27bd7d184e7d957a07aef59b33744f01e7af1c08';
const read = file => fs.readFileSync(file, 'utf8');
const original = file => execFileSync('git', ['show', `${BASELINE}:${file}`], { encoding: 'utf8' });
const clean = value => JSON.parse(JSON.stringify(value));
const checks = [];

for (const pathname of ['/', '/shop', '/products/aura', '/account', '/ACCOUNT/', '/account/orders',
  '/account/programs/fixture', '/account/subscriptions', '/account/settings', '/notifications', '/rewards',
  '/return-reward', '/cart', '/cart/fixture', '/partner', '/book-event']) {
  assert.equal(usesImmediateCustomerWebsiteLayout({ pathname, isNative: false }), true, pathname);
  assert.equal(usesImmediateCustomerWebsiteLayout({ pathname, isNative: true }), false, pathname);
  assert.equal(usesImmediateCustomerWebsiteLayout({ pathname }), false, 'Missing runtime must fail closed');
  assert.equal(usesImmediateCustomerWebsiteLayout({ pathname, isNative: false, startedWithAuthReturn: true }), false);
  for (const key of ['code', 'state', 'access_token', 'clear_access_token', 'error', 'is_new_user',
    'native_provider_callback', 'native_browser_callback', 'reset_sign_in']) {
    assert.equal(usesImmediateCustomerWebsiteLayout({ pathname, isNative: false, search: `?${key}=fixture` }), false);
    assert.equal(usesImmediateCustomerWebsiteLayout({ pathname, isNative: false, hash: `#${key}=fixture` }), false);
  }
}
for (const pathname of ['/admin', '/admin/orders', '/ADMIN/orders', '/operations', '/unknown',
  '/account/private', '/checkout', '/order-confirmation', '/login', '/native-login', '/account-setup',
  '/oauth-consent', '/order-tracker/fixture', '//external.invalid', 'account', '', null]) {
  assert.equal(usesImmediateCustomerWebsiteLayout({ pathname, isNative: false }), false, String(pathname));
}
checks.push('Explicit customer layout policy excludes native, admin, standalone/payment, unknown and auth-return paths');

assert.deepEqual(customerWebsiteMotionOverrides(false), { initial: false, transition: { duration: 0, delay: 0 } });
for (const runtime of [true, undefined, null]) assert.deepEqual(customerWebsiteMotionOverrides(runtime), {});
assert.doesNotMatch(read('src/lib/customerWebsiteMotion.js'), /matchMedia|setTimeout|useEffect|base44|fetch\(/);
checks.push('Website content is immediately visible with zero motion, including reduced-motion users; native props are not overridden');

let native = false;
let role = 'user';
let frames = [];
const noContent = () => null;
const pass = ({ children }) => children;
const orders = Array.from({ length: 50 }, (_, index) => ({
  id: `fixture-${index}`, order_number: `NV-FIXTURE-${index}`, status: 'delivered', payment_status: 'paid',
  total: 10, items: [{ product_id: 'fixture-product', title: 'Fixture', quantity: 1, price: 10 }],
}));
const dashboard = { customer_profile: null, orders: [], all_orders_raw: orders };
const motion = { div: ({ initial, animate, exit, transition, children, ...props }) => {
  frames.push(clean({ initial, animate, exit, transition, className: props.className }));
  return React.createElement('div', props, children);
} };
const imports = {
  react: React,
  'react-router-dom': {
    Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
    useNavigate: () => () => {},
  },
  'framer-motion': { motion },
  'lucide-react': new Proxy({}, { get: () => noContent }),
  '@tanstack/react-query': { useQuery: options => ({
    data: options.queryKey[0] === 'account-dashboard'
      ? (options.select ? options.select(dashboard) : dashboard) : [],
    isLoading: false, refetch: noContent,
  }) },
  '@/lib/AuthContext': { useAuth: () => ({ user: { email: 'member@example.test', role }, logout: noContent, navigateToLogin: noContent }) },
  '@/lib/admin-access': { isAdminUser: user => user?.role === 'admin' },
  '@/lib/nativeRuntime': { isNativeAppRuntime: () => native },
  '@/lib/customerWebsiteMotion': { customerWebsiteMotionOverrides },
  '@/lib/customerDashboardQueries': {
    customerDashboardQueryOptions: () => ({ queryKey: ['account-dashboard', 'member@example.test'] }),
    customerDashboardOrders: data => data.all_orders_raw,
    customerDashboardOrderPollInterval: () => false,
  },
  '@/api/base44Client': { base44: new Proxy({}, { get: () => { throw new Error('Unexpected API access'); } }) },
  '@/lib/cartContext': { useCart: () => ({ addItem: noContent }) },
  '@/lib/program-catalog': { PROGRAM_BY_KEY: {} },
  '@/lib/program-journey-state': { useActiveProgramJourney: () => ({ journeys: [], isLoading: false, refetch: noContent }) },
  '@/lib/customer-order-journey': { getCustomerOrderJourney: () => ({ statusLabel: 'Delivered' }), resolveCustomerJourneyFulfillmentType: () => 'delivery' },
  '@/lib/googleAnalytics': { trackGoogleRetentionEvent: noContent },
  '@/components/ui/badge': { Badge: ({ variant, children, ...props }) => React.createElement('span', props, children) },
  'date-fns': { format: () => '' },
  sonner: { toast: {} },
  '@/components/PullToRefresh': { default: pass },
};
for (const name of ['account/CreditWallet', 'account/MemberProgramCard', 'account/ProfileAvatar',
  'BrowserAppPrompt', 'orders/OrderItemThumbnail', 'checkout/CustomerRouteRequests']) {
  imports[`@/components/${name}`] = { default: noContent };
}
function renderSource(source, isNative, userRole = 'user') {
  native = isNative; role = userRole; frames = [];
  const module = { exports: {} };
  const { code } = transformSync(source, { loader: 'jsx', format: 'cjs' });
  vm.runInNewContext(code, { module, exports: module.exports, console, require: name => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    const value = imports[name];
    return 'default' in value ? { __esModule: true, ...value } : value;
  } });
  const html = renderToStaticMarkup(React.createElement(module.exports.default));
  return { html, frames };
}

for (const file of ['src/pages/Account.jsx', 'src/pages/OrderHistory.jsx']) {
  const source = read(file);
  const baseline = original(file);
  // Removing only presentation additions must recover the exact approved source.
  const withoutOverrides = source
    .replace(/^import \{ customerWebsiteMotionOverrides \} from '@\/lib\/customerWebsiteMotion';\n/m, '')
    .replace(/^import \{ isNativeAppRuntime \} from '@\/lib\/nativeRuntime';\n/m, '')
    .replace(/^  const immediateMotion = customerWebsiteMotionOverrides\(isNativeAppRuntime\(\)\);\n/gm, '')
    .replace(/^\s*\{\.\.\.immediateMotion\}\n/gm, '');
  assert.equal(withoutOverrides, baseline, `${file}: data, auth, actions and markup must be untouched`);
  const beforeNative = renderSource(baseline, true);
  const afterNative = renderSource(source, true);
  assert.deepEqual(afterNative, beforeNative, `${file}: exact native markup and animation props`);
  const website = renderSource(source, false);
  assert.equal(website.html, afterNative.html, `${file}: website retains original content/links`);
  assert.ok(website.frames.length > 0);
  for (const frame of website.frames) {
    assert.equal(frame.initial, false);
    assert.deepEqual(frame.transition, { duration: 0, delay: 0 });
  }
  if (file.includes('OrderHistory')) {
    assert.equal(website.frames.length, 50);
    assert.equal(beforeNative.frames[49].transition.delay, 2.45);
  } else {
    const adminWebsite = renderSource(source, false, 'admin');
    const legacyAdmin = renderSource(baseline, false, 'admin');
    assert.deepEqual(adminWebsite.frames.at(-1), legacyAdmin.frames.at(-1), 'Admin tool row preserves its existing motion');
  }
}
checks.push('Actual Account and 50-card Orders render immediately on web, with byte-preserved data/actions and exact native animation/markup parity');
checks.push('Admin tool row remains unchanged; long order histories no longer accumulate website stagger delays');

const layout = read('src/components/layout/AppLayout.jsx');
assert.match(layout, /<Suspense key=\{location\.pathname\} fallback=\{<PublicRouteLoading \/>\}>/);
assert.match(layout, /<AnimatePresence mode="wait">/);
assert.match(layout, /transition=\{\{ duration: 0\.22, ease: \[0\.22, 1, 0\.36, 1\] \}\}/);
assert.doesNotMatch(layout, /useAuth|base44|useQuery|startTransition|keepPreviousData/);
assert.doesNotMatch(read('src/components/layout/PublicRouteLoading.jsx'), /useAuth|base44|user\.|account\.|fetch\(/);
checks.push('Path-keyed neutral content boundary cannot deliberately retain prior private content; auth/data logic stays outside presentation');

console.log(JSON.stringify({ ok: true, suite: 'customer-website-motion-continuity', baseline: BASELINE,
  checks, real_network_requests: 0, provider_calls: 0, production_writes: 0 }, null, 2));
