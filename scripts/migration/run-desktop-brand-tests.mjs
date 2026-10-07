#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import os from 'node:os';
import { transformSync } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { assertDesktopGeometry } from '../qa/desktop-geometry-contract.mjs';
import { PUBLIC_PRODUCT_FALLBACKS } from '../../src/lib/public-product-catalog.js';
import { approvedProductMedia } from '../../src/lib/approved-product-media.js';
import { DAILY_PROGRAM_SCHEDULES, PROGRAMS, programOptionForDays } from '../../src/lib/program-catalog.js';
import { deliveryLandingProducts } from '../../src/lib/localDeliveryShopping.js';
import { DESKTOP_HERO_STATEMENTS } from '../../src/components/desktop/desktopHeroCopy.js';
import * as deliveryPolicy from '../../src/lib/delivery-policy.js';
import { createPreviewHandler, LOCAL_CATALOG } from '../qa/serve-desktop-preview.mjs';

const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const { code } = transformSync(read(file), { loader: file.endsWith('.jsx') ? 'jsx' : 'js', format: 'cjs' });
  vm.runInNewContext(code, { module, exports: module.exports, ...globals, require(name) {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return { __esModule: true, ...imports[name] };
  } });
  return module.exports;
}
const checks = [];
let storedHeadline = null;
const heroWindow = { sessionStorage: {
  getItem: () => storedHeadline,
  setItem: (_key, value) => { storedHeadline = value; },
} };
for (const index of [0, 1, 2, 0, 1, 2]) {
  const { desktopHeroStatement } = load('src/components/desktop/desktopHeroCopy.js', {}, { window: heroWindow });
  assert.deepEqual(Array.from(desktopHeroStatement()), DESKTOP_HERO_STATEMENTS[index]);
  assert.equal(storedHeadline, String((index + 1) % 3));
  assert.equal(desktopHeroStatement(), desktopHeroStatement(), 'Remounts retain the same statement');
  assert.equal(storedHeadline, String((index + 1) % 3), 'Remounts never advance the sequence');
}
for (const invalid of ['-1', '3', 'NaN', '1.5', '']) {
  storedHeadline = invalid;
  assert.deepEqual(Array.from(load('src/components/desktop/desktopHeroCopy.js', {}, { window: heroWindow }).desktopHeroStatement()), DESKTOP_HERO_STATEMENTS[0]);
}
assert.deepEqual(Array.from(load('src/components/desktop/desktopHeroCopy.js', {}).desktopHeroStatement()), DESKTOP_HERO_STATEMENTS[0]);
assert.deepEqual(Array.from(load('src/components/desktop/desktopHeroCopy.js', {}, { window: { get sessionStorage() { throw new Error('Blocked storage'); } } }).desktopHeroStatement()), DESKTOP_HERO_STATEMENTS[0]);
checks.push('Hero cycles three statements once per fresh document, stays stable on remount, and safely handles blocked storage and server rendering');
let native = false;
let width = 1440;
let subscribe;
const hook = load('src/hooks/useDesktopStorefront.js', {
  react: { useSyncExternalStore: (listen, snapshot, server) => { subscribe = listen; assert.equal(server(), false); return snapshot(); } },
  '@/lib/nativeRuntime': { isNativeAppRuntime: () => native },
}, { window: { get innerWidth() { return width; }, matchMedia: () => { throw new Error('Website identity must not depend on viewport width'); } } }).default;
for (const platform of [false, true]) {
  native = platform;
  for (const viewport of [390, 768, 1023, 1024, 1280, 1440, 1920]) {
    width = viewport;
    assert.equal(hook(), !platform);
  }
}
let changes = 0;
const unlisten = subscribe(() => changes++);
unlisten();
assert.equal(changes, 0);
checks.push('Website identity is stable from 390 to 1920px, never native; resizing has no shell subscription; server snapshot stays conservative');

let route = '/';
let desktop = true;
const empty = () => null;
const Layout = load('src/components/layout/AppLayout.jsx', {
  '@/styles/browser-audit.css': {},
  react: { ...React, default: React },
  'react-router-dom': { useLocation: () => ({ pathname: route, search: '', hash: '' }), Outlet: () => React.createElement('p', null, 'Page') },
  'framer-motion': { AnimatePresence: ({ children }) => children, motion: { div: ({ children }) => React.createElement('div', null, children) } },
  './MobileNav': { default: () => React.createElement('nav', { 'data-test-app-nav': true }) }, './SideNav': { default: () => React.createElement('aside', { 'data-test-sidebar': true }) },
  './PublicRouteLoading': { default: empty },
  '@/lib/nativeRuntime': { isNativeAppRuntime: () => native },
  '@/lib/customerWebsiteMotion': { usesImmediateCustomerWebsiteLayout: () => !native },
  '@/lib/app-params': { startedWithAuthReturn: false },
  '@/hooks/useDesktopStorefront': { default: () => desktop && !native },
  '@/components/desktop/DesktopHeader': { default: () => React.createElement('header', { 'data-test-brand-header': true }) },
  '@/components/desktop/DesktopFooter': { default: () => React.createElement('footer', { 'data-test-brand-footer': true }) },
  '@/components/cart/CartPreviewHost': { default: empty },
}).default;
for (const path of ['/', '/shop', '/product/oasis.html', '/account', '/admin/operations']) {
  route = path;
  for (const isNative of [false, true]) for (const isDesktop of [false, true]) {
    native = isNative; desktop = isDesktop;
    const html = renderToStaticMarkup(React.createElement(Layout));
    const expected = isDesktop && !isNative && !path.startsWith('/admin');
    assert.equal(html.includes('data-desktop-brand="true"'), expected);
    assert.equal(html.includes('data-test-brand-header'), expected);
    assert.equal(html.includes('data-test-brand-footer'), expected);
    assert.equal(html.includes('data-test-sidebar'), !expected);
    assert.equal(html.includes('data-test-app-nav'), !expected);
  }
}
checks.push('Website uses one brand header and no app bottom navigation; native and admin retain their separate navigation');

const home = read('src/components/desktop/DesktopHome.jsx');
const programSelector = read('src/components/desktop/DesktopPrograms.jsx');
const header = read('src/components/desktop/DesktopHeader.jsx');
const css = read('src/styles/desktop-brand.css');
const simpleLink = ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children);
const DesktopDelivery = load('src/components/desktop/DesktopDelivery.jsx', {
  react: { ...React, default: React }, 'react-router-dom': { Link: simpleLink },
  'lucide-react': { ArrowRight: empty, CalendarDays: empty, MapPin: empty, Route: empty, Truck: empty },
  '@/lib/brandImages': { BRAND_IMAGES: {}, websiteBrandImageProps: () => ({}) },
  '@/lib/delivery-policy': deliveryPolicy,
}).default;
const deliveryMarkup = renderToStaticMarkup(React.createElement(DesktopDelivery));
const escapeHtml = value => renderToStaticMarkup(React.createElement('span', null, value)).replace(/^<span>|<\/span>$/g, '');
for (const text of Object.values(deliveryPolicy.DELIVERY_POLICY_CONTENT)) assert.ok(deliveryMarkup.includes(escapeHtml(text)));
for (const window of deliveryPolicy.DELIVERY_WINDOWS) for (const value of Object.values(window)) assert.ok(deliveryMarkup.includes(value));
for (const zone of deliveryPolicy.DELIVERY_ZONE_SUMMARY) for (const field of ['distance', 'fee', 'minimum']) assert.ok(deliveryMarkup.includes(zone[field]));
assert.equal((deliveryMarkup.match(/scope="row"/g) || []).length, 6);
assert.match(deliveryMarkup, /Minimum 3 juices, 6 shots, or an equivalent mix/);
checks.push('Redesigned delivery renders every existing policy, fee, cutoff, zone and minimum without changing eligibility');
const Goods = load('src/components/desktop/DesktopMerch.jsx', {
  react: { ...React, default: React }, 'react-router-dom': { Link: simpleLink },
  'lucide-react': { ArrowRight: empty, ShoppingBag: empty },
  '@/components/ui/button': { Button: 'button' }, '@/components/ui/input': { Input: 'input' },
}).default;
const sampleGoods = { id: 'fixture-tote', name: 'Test Tote', price: 12, image_url: '/fixture.jpg', path: '/product/test-tote.html', is_available: true, sizes: ['Large'] };
let addedGoods = null;
let goodsTrigger = null;
const goodsTree = Goods({ items: [sampleGoods], loadingItems: false, onAdd: (item, trigger) => { addedGoods = item; goodsTrigger = trigger; } });
const goodsMarkup = renderToStaticMarkup(goodsTree);
assert.match(goodsMarkup, /\$12\.00/);
assert.match(goodsMarkup, /href="\/product\/test-tote.html"/);
const addButton = findHeaderElement(goodsTree, node => node.type === 'button');
assert.equal(addButton.props.disabled, false);
const goodsButtonElement = {};
addButton.props.onClick({ currentTarget: goodsButtonElement });
assert.equal(addedGoods, sampleGoods, 'Pass original normalized item to the existing cart handler');
assert.equal(goodsTrigger, goodsButtonElement, 'Forward the pointer trigger for Safari focus restoration');
assert.equal(findHeaderElement(Goods({ items: [{ ...sampleGoods, is_available: false }] }), node => node.type === 'button').props.disabled, true);
assert.match(renderToStaticMarkup(React.createElement(Goods, { items: [], loadingItems: true })), /role="status"/);
assert.match(renderToStaticMarkup(React.createElement(Goods, { items: [], email: '', onEmail: empty })), /type="email"[^>]*required/);
assert.match(renderToStaticMarkup(React.createElement(Goods, { items: [], submitted: true })), /You are on the list/);
for (const page of ['Delivery', 'Merch', 'WhyNuVira']) {
  assert.match(read(`src/pages/${page}.jsx`), /const desktopWebsite = useDesktopStorefront\(\)/);
  assert.match(read(`src/pages/${page}.jsx`), /if \(desktopWebsite\) return/);
}
checks.push('Goods preserves product identity, pricing, availability, cart handler, loading and waitlist states; all three new layouts are desktop-only');
assert.match(home, /<ProductCard product=\{product\}/);
assert.match(home, /<DeliveryAvailabilityCard \/>/);
assert.match(home, /Minimum 3 juices, 6 shots, or an equivalent mix/);
assert.match(home, /<DesktopPrograms \/>/);
assert.match(programSelector, /PROGRAMS\.map/);
assert.match(home, /approvedProductMedia/);
assert.match(home, /websiteBrandImageProps\(BRAND_IMAGES\.bottlesCoolerWide, \{ website: true \}\)/);
assert.match(home, /websiteBrandImageProps\(BRAND_IMAGES\.aboutHeroEvent, \{ website: true \}\)/);
assert.match(home, /Good company\.<br \/><span>Great juice\.<\/span>/);
assert.match(home, /to="\/book-event">Plan Your Event/);
assert.match(home, /nv-brand-community-story" to="\/about"/);
assert.doesNotMatch(home, /nv-brand-community-copy|nv-brand-community-photo/);
assert.match(css, /\.nv-brand-community-scene \{[^}]*height: 400px/);
checks.push('Community feature uses a full-width real event photo, guest-focused copy and working event/story destinations');
assert.match(header, /isAdminUser\(user\) &&/);
assert.match(header, /useCart/);
assert.match(header, /preloadPublicNavigation/);
assert.match(header, /preloadMemberNavigation/);
assert.match(header, /navigationIntent\('\/account', Boolean\(user\?\.email\)\)/);
assert.match(header, /navigationIntent\('\/rewards', Boolean\(user\?\.email\)\)/);
for (const label of ['Shop Juices', 'Programs', 'Rewards', 'Our Story', 'Events & Catering']) {
  assert.ok(header.includes(`label: '${label}'`), `Title Case navigation: ${label}`);
}
let headerUser = null;
let headerPath = '/';
const navigationPreloads = [];
const menuContainer = ({ children }) => React.createElement('div', null, children);
const Header = load('src/components/desktop/DesktopHeader.jsx', {
  react: { ...React, default: React },
  'react-router-dom': {
    useLocation: () => ({ pathname: headerPath }),
    Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children),
  },
  'lucide-react': { ArrowUpRight: empty, Bell: empty, Menu: empty, ShoppingBag: empty, UserRound: empty },
  '@/lib/AuthContext': { useAuth: () => ({ user: headerUser }) },
  '@/lib/cartContext': { useCart: () => ({ itemCount: 3 }) },
  '@/lib/admin-access': { isAdminUser: user => user?.role === 'admin' },
  '@/lib/brandImages': { BRAND_IMAGES: { wordmark: '/wordmark.svg' } },
  '@/lib/startupPages': {
    isPublicNavigationPreloadRoute: to => ['/', '/shop', '/about', '/support', '/juice-catering-st-louis'].includes(to),
    preloadPublicNavigation: (to, options) => navigationPreloads.push({ type: 'public', to, options }),
  },
  '@/lib/memberNavigationPreload': {
    isMemberNavigationPreloadRoute: to => ['/account', '/rewards'].includes(to),
    preloadMemberNavigation: (to, options) => navigationPreloads.push({ type: 'member', to, options }),
  },
  '@/components/ui/dropdown-menu': {
    DropdownMenu: menuContainer, DropdownMenuContent: menuContainer,
    DropdownMenuItem: menuContainer, DropdownMenuSeparator: empty,
    DropdownMenuTrigger: ({ children, ...props }) => React.createElement('button', props, children),
  },
}).default;
function findHeaderElement(element, predicate) {
  if (!element || typeof element !== 'object') return null;
  if (predicate(element)) return element;
  return React.Children.toArray(element.props?.children)
    .map(child => findHeaderElement(child, predicate)).find(Boolean) || null;
}
for (const user of [null, { email: 'member@example.test' }, { email: 'admin@example.test', role: 'admin' }]) {
  headerUser = user;
  for (const path of ['/', '/rewards', '/shop']) {
    headerPath = path;
    navigationPreloads.length = 0;
    const element = Header();
    const mainNav = findHeaderElement(element, item => item.props?.['aria-label'] === 'Main navigation');
    const links = React.Children.toArray(mainNav.props.children);
    assert.deepEqual(links.map(link => link.props.children), ['Shop Juices', 'Programs', 'Rewards', 'Our Story', 'Events & Catering']);
    const rewardsLink = links[2];
    assert.equal(rewardsLink.props.to, '/rewards');
    assert.equal(rewardsLink.props['aria-current'], path === '/rewards' ? 'page' : undefined);
    assert.equal(navigationPreloads.length, 0, 'Rendering never triggers a preload');
    for (const event of ['onMouseEnter', 'onFocus']) {
      navigationPreloads.length = 0;
      rewardsLink.props[event]?.();
      assert.equal(navigationPreloads.length, user ? 1 : 0);
      if (user) {
        assert.equal(navigationPreloads[0].type, 'member');
        assert.equal(navigationPreloads[0].to, '/rewards');
        assert.equal(navigationPreloads[0].options.isAuthenticated, true);
      }
    }
    const html = renderToStaticMarkup(element);
    assert.equal((html.match(/href="\/rewards"/g) || []).length, 3, 'Main, compact website menu and account-menu rewards links remain');
    assert.equal(html.includes('Admin Operations'), user?.role === 'admin');
  }
}
checks.push('Rewards follows Programs for guests and members, active state is exact, and member preloading runs only on signed-in hover or focus');
assert.match(programSelector, /program\.tagline/);
assert.match(programSelector, /program\.durationOptions/);
assert.doesNotMatch(home, /flavor-ink|nv-brand-flavor-character|nv-brand-hero-caption/);
assert.doesNotMatch(read('src/components/desktop/DesktopFooter.jsx'), /nv-brand-footer-invitation/);
assert.match(css, /@media \(min-width: 1024px\) and \(max-height: 760px\)/);
assert.match(header, /data-home=\{pathname === '\/'\}/);
assert.match(home, /id="delivery"/);
assert.match(css, /\.nv-brand-button \{[^}]*border-radius: 999px/);
assert.match(css, /@supports \(\(backdrop-filter: blur\(1px\)\)/);
assert.match(css, /prefers-reduced-transparency: reduce/);
let anchor = '';
let scrollTarget = null;
let effect;
let cancelledFrame = null;
const AnchorHome = load('src/components/desktop/DesktopHome.jsx', {
  react: { ...React, default: { ...React, useEffect: callback => { effect = callback; } } },
  'react-router-dom': { useLocation: () => ({ hash: anchor }), Link: empty },
  'lucide-react': { ArrowRight: empty, ArrowUpRight: empty, MapPin: empty },
  '@/lib/brandImages': { BRAND_IMAGES: {}, websiteBrandImageProps: () => ({}) },
  '@/components/desktop/DesktopPrograms': { default: empty },
  './desktopHeroCopy': { desktopHeroStatement: () => DESKTOP_HERO_STATEMENTS[0] },
  '@/lib/approved-product-media': { approvedProductMedia },
  '@/lib/localDeliveryShopping': { deliveryLandingProducts },
  '@/components/shop/ProductCard': { default: ({ product }) => React.createElement('span', { 'data-featured-product': product.slug }, product.price) },
  '@/components/home/QuickReorder': { default: empty },
  '@/components/program/ActiveProgramJourneyCard': { default: empty },
  '@/components/delivery/DeliveryAvailabilityCard': { default: empty },
}, {
  window: { requestAnimationFrame: cb => { cb(); return 7; }, cancelAnimationFrame: id => { cancelledFrame = id; } },
  document: { getElementById: id => ({ scrollIntoView: () => { scrollTarget = id; } }) },
}).default;
for (const hash of ['', '#programs', '#delivery', '#community', '#unknown']) {
  anchor = hash; scrollTarget = null; cancelledFrame = null;
  renderToStaticMarkup(React.createElement(AnchorHome, { products: [], hasMember: false }));
  const cleanup = effect();
  const allowed = ['#programs', '#delivery', '#community'].includes(hash);
  assert.equal(scrollTarget, allowed ? hash.slice(1) : null);
  cleanup?.();
  assert.equal(cancelledFrame, allowed ? 7 : null);
}
checks.push('Programs, delivery and community anchors scroll to the intended section and cancel pending frames; unknown anchors are ignored');
const featured = renderToStaticMarkup(React.createElement(AnchorHome, { products: PUBLIC_PRODUCT_FALLBACKS, hasMember: false }));
assert.equal((featured.match(/data-featured-product=/g) || []).length, 4);
for (const slug of ['aura', 'oasis', 're-nu', 'the-nuvira-trio']) assert.ok(featured.includes(`data-featured-product="${slug}"`));
const noTrio = renderToStaticMarkup(React.createElement(AnchorHome, { products: PUBLIC_PRODUCT_FALLBACKS.filter(product => product.slug !== 'the-nuvira-trio'), hasMember: false }));
assert.doesNotMatch(noTrio, /data-featured-product="the-nuvira-trio"/);
const repriced = PUBLIC_PRODUCT_FALLBACKS.map(product => product.slug === 'the-nuvira-trio' ? { ...product, price: 37.25 } : product);
assert.match(renderToStaticMarkup(React.createElement(AnchorHome, { products: repriced, hasMember: false })), /data-featured-product="the-nuvira-trio">37.25/);
assert.match(css, /\.nv-brand-signature-grid \{[^}]*repeat\(4/);
checks.push('Four featured products use existing identities and current supplied pricing; missing Trio is not invented');
checks.push('Rounded controls, homepage-only navigation overlay, opaque glass fallback and reduced-transparency support retained');
for (const file of ['DesktopHome', 'DesktopHeader', 'DesktopFooter', 'DesktopPrograms']) {
  const source = read(`src/components/desktop/${file}.jsx`);
  assert.doesNotMatch(source, /base44|entities\.|functions\.|localStorage|fetch\(/);
}
assert.doesNotMatch(css, /font-size:[^;]*vw|letter-spacing:\s*-/);
assert.match(css, /@media all/);
assert.match(read('src/pages/Home.jsx'), /desktopWebsite \? <DesktopHome/);
checks.push('Reuses catalog/cart/delivery/program contracts; no new data calls or writes; minimum order and admin access preserved');
checks.push('Responsive typography avoids viewport-scaled type and negative letter spacing');
let programSelection = { index: 0, days: null };
let focusedProgram = null;
const BottleMix = load('src/components/program/ProgramBottleMix.jsx', {
  react: { ...React, default: React },
  '@/lib/approved-product-media': { approvedProductMedia },
}).default;
const ProgramSelector = load('src/components/desktop/DesktopPrograms.jsx', {
  react: { ...React, default: React, useState: () => [programSelection, value => { programSelection = typeof value === 'function' ? value(programSelection) : value; }], useRef: () => ({ current: PROGRAMS.map((_, index) => ({ focus: () => { focusedProgram = index; } })) }) },
  'react-router-dom': { Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children) },
  'lucide-react': { ArrowRight: empty, Check: empty },
  '@/lib/program-catalog': { DAILY_PROGRAM_SCHEDULES, PROGRAMS },
  '@/components/program/ProgramBottleMix': { default: BottleMix },
}).default;
for (let index = 0; index < PROGRAMS.length; index++) {
  const program = PROGRAMS[index];
  for (const option of program.durationOptions) {
    programSelection = { index, days: option.days };
    const html = renderToStaticMarkup(React.createElement(ProgramSelector));
    assert.ok(html.includes(`href="/program/${program.key}?days=${option.days}"`));
    assert.match(html, new RegExp(`aria-labelledby="nv-program-tab-${program.key}"`));
    assert.match(html, /role="tablist"/);
    assert.ok(html.includes(`${option.bottles} bottles for ${option.days} days`));
    assert.match(html, /Four cold-pressed juices each day/);
    assert.match(html, /class="nv-brand-program-details"/);
    if (program.key === 'reset') assert.ok(html.includes(approvedProductMedia({ title: 'RE-NU' }).primary));
    assert.match(html, new RegExp(`\\$${option.price}`));
    assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
    assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
    for (const component of option.bundleComposition) assert.ok(html.includes(`${component.quantity} ${component.product_name}`));
  }
}
function findTabs(element) {
  if (!element || typeof element !== 'object') return [];
  return [...(element.props?.role === 'tab' ? [element] : []), ...React.Children.toArray(element.props?.children).flatMap(findTabs)];
}
programSelection = { index: 0, days: 2 };
const selectorTabs = findTabs(ProgramSelector());
for (const [index, key, expected] of [[0, 'ArrowRight', 1], [0, 'ArrowLeft', 2], [1, 'Home', 0], [0, 'End', 2]]) {
  let prevented = false;
  selectorTabs[index].props.onKeyDown({ key, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true); assert.equal(programSelection.index, expected); assert.equal(focusedProgram, expected);
}
function findLengthOptions(element) {
  if (!element || typeof element !== 'object') return [];
  return [...(element.type === 'button' && typeof element.props?.['aria-pressed'] === 'boolean' ? [element] : []), ...React.Children.toArray(element.props?.children).flatMap(findLengthOptions)];
}
programSelection = { index: 0, days: 2 };
findLengthOptions(ProgramSelector())[1].props.onClick();
assert.equal(programSelection.days, 3);
programSelection = { index: 2, days: 2 };
assert.equal(findLengthOptions(ProgramSelector()).length, 1, 'Reset must not invent a two-day option');
assert.match(renderToStaticMarkup(React.createElement(ProgramSelector)), /href="\/program\/reset\?days=3"/);
for (const program of PROGRAMS) {
  for (const request of ['2', '3', '99', 'invalid', '0', '']) {
    const days = programOptionForDays(program, new URLSearchParams({ days: request }).get('days') || 3).days;
    assert.ok(program.durationOptions.some(option => option.days === days));
    if (program.key === 'reset') assert.equal(days, 3);
  }
}
checks.push('Program duration controls keep approved package counts and prices, preserve the selected length in navigation, and keep Reset three-day only');
checks.push('Program tabs preserve duration preference with one selected tab and arrow/Home/End keyboard navigation');
function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map(part => parseInt(part, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}
for (const [foreground, background] of [['073c29', 'a7d6bd'], ['ffffff', '18734b'], ['ffffff', '082d20'], ['506056', 'ffffff'], ['23724d', 'ffffff'], ['d1e5d5', '082d20'], ['e0ece3', '173f36'], ['e0ece3', '276c60'], ['e0ece3', '1c5049']]) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  assert.ok((values[0] + .05) / (values[1] + .05) >= 4.5, `Text contrast: ${foreground}/${background}`);
}
checks.push('Title Case primary navigation, short-height hero treatment and brand text contrast retained');
for (const [ink, title, accent, stops] of [
  ['fff5ed', 'fff1da', '24503b', ['123c32', '285541', '4c6347']],
  ['fff2f1', 'ffe7dc', '882a43', ['74263d', '9b354c', '6f294b']],
  ['effaf2', 'e0f4d6', '245b43', ['164e48', '27634c', '33543f']],
]) {
  assert.ok(css.includes(`--nv-program-ink: #${ink}`));
  assert.ok(css.includes(`--nv-program-title: #${title}`));
  assert.ok((luminance('fff5ed') + .05) / (luminance(accent) + .05) >= 4.5, 'Selected program tab and CTA contrast');
  for (const background of stops) {
    assert.ok((luminance(ink) + .05) / (luminance(background) + .05) >= 4.5, `Program small text contrast: ${ink}/${background}`);
    assert.ok((luminance(title) + .05) / (luminance(background) + .05) >= 4.5, `Program display text contrast: ${title}/${background}`);
  }
}
assert.match(programSelector, /Your Flavor Pairing/);
assert.match(read('src/components/program/ProgramBottleMix.jsx'), /count === 1 \? 'bottle' : 'bottles'/);
for (const program of PROGRAMS) {
  for (const option of program.durationOptions) {
    const html = renderToStaticMarkup(React.createElement(BottleMix, { components: option.bundleComposition, days: option.days, label: option.composition }));
    assert.equal((html.match(/<figure/g) || []).length, option.bundleComposition.length);
    for (const component of option.bundleComposition) {
      assert.ok(html.includes(`<strong>${component.quantity}<span>bottles</span>`));
      const dailyCount = component.quantity / option.days;
      assert.ok(html.includes(`${dailyCount} ${dailyCount === 1 ? 'bottle' : 'bottles'} each day`));
    }
  }
  const option = program.durationOptions[0];
  const dailyHtml = renderToStaticMarkup(React.createElement(BottleMix, {
    showcase: true,
    days: option.days,
    components: option.bundleComposition,
  }));
  for (const component of option.bundleComposition) {
    const nameAt = dailyHtml.indexOf(`<h4>${component.quantity} ${component.product_name}`);
    const quantityAt = dailyHtml.indexOf('nv-program-daily-quantity', nameAt);
    assert.ok(nameAt > 0 && quantityAt > nameAt, 'Photo captions introduce the juice before its daily quantity');
  }
}
assert.match(css, /\.nv-program-how \{ grid-column: 1; grid-row: 2/);
assert.match(css, /\.nv-program-schedule \{ grid-column: 1; grid-row: 3/);
assert.match(css, /\.nv-brand-program-tabs \{ display: flex; max-width: 50%; overflow-x: auto/);
assert.match(read('src/components/program/ProgramBottleMix.jsx'), /Math.min\(components.length, 3\)/);
checks.push('Shared product-led program imagery preserves every duration bottle count and adapts to future catalog options');
checks.push('Warm light program typography and flavor-colored controls pass contrast checks against every rich gradient stop');
assert.doesNotMatch(css, /#(?:c2ef62|bbed59|d3f280|d0fa85)/i);
assert.match(css, /\.nv-brand-logo img \{ width: 116px; height: 46px/);
assert.match(css, /\.storefront-product-grid \{ grid-template-columns: repeat\(4/);
assert.match(css, /max-width: 1279px/);
assert.match(css, /\.storefront-product-card \{ height: auto/);
assert.match(css, /\.nv-brand-home h2 \{ font-family: var\(--font-heading\)/);
assert.match(read('src/pages/LocalSeoLanding.jsx'), /className="nv-local-hero /);
assert.match(css, /main\[data-storefront-page\]:has\(\.nv-local-page\) \{ max-width: none; padding: 0/);
checks.push('Compact responsive product grid, smaller logo, serif display hierarchy and full-width local heroes replace the yellow-lime desktop treatment');

let portals = 0;
const body = {};
const CartSurface = load('src/components/cart/CartSummarySurface.jsx', {
  react: { ...React, default: React },
  'react-dom': { createPortal: (children, container) => { assert.equal(container, body); portals++; return children; } },
  'lucide-react': { ShieldCheck: empty },
  '@/hooks/useDesktopStorefront': { default: () => desktop && !native },
}, { document: { body } }).default;
for (const isNative of [false, true]) for (const isDesktop of [false, true]) {
  native = isNative; desktop = isDesktop; portals = 0;
  const html = renderToStaticMarkup(React.createElement(CartSurface, null, React.createElement('button', { disabled: true }, 'Complete your mix above')));
  const inline = isDesktop && !isNative;
  assert.equal(html.includes('aria-label="Order summary"'), inline);
  assert.equal(portals, inline ? 0 : 1);
  assert.equal(html.includes('fixed bottom-16 md:bottom-0'), !inline);
  assert.match(html, /button disabled/);
  assert.match(html, /Complete your mix above/);
}
checks.push('Cart summary is in-flow only on desktop web; native/tablet/mobile retain the existing portal and safe-area footer, with identical children');
const Experience = load('src/components/checkout/CheckoutExperience.jsx', {
  react: { ...React, default: React },
  'lucide-react': Object.fromEntries(['ArrowLeft', 'Check', 'ChevronDown', 'Gift', 'LockKeyhole', 'MapPin'].map(name => [name, empty])),
  '@/components/orders/OrderItemThumbnail': { default: empty },
  '@/hooks/useDesktopStorefront': { default: () => desktop && !native },
  '@/lib/brandImages': { BRAND_IMAGES: { wordmark: '/existing-wordmark.webp' } },
  './checkout-experience.css': {},
}).default;
const AuthLayout = load('src/components/AuthLayout.jsx', {
  react: { ...React, default: React },
  'react-router-dom': { Link: ({ children, to, ...props }) => React.createElement('a', { href: to, ...props }, children) },
  '@/hooks/useDesktopStorefront': { default: () => desktop && !native },
  '@/lib/brandImages': { BRAND_IMAGES: { wordmark: '/existing-wordmark.webp' } },
}).default;
for (const isNative of [false, true]) for (const isDesktop of [false, true]) {
  native = isNative; desktop = isDesktop;
  const enabled = isDesktop && !isNative;
  const checkout = renderToStaticMarkup(React.createElement(Experience, { items: [], total: 1234.56, locked: true, contactReady: false }));
  assert.equal(checkout.includes('data-desktop-checkout="true"'), enabled);
  assert.equal(checkout.includes('nv-checkout-wordmark'), enabled);
  assert.match(checkout, /\$1234.56/);
  assert.match(checkout, /disabled=""[^>]*>Continue to delivery/);
  const auth = renderToStaticMarkup(React.createElement(AuthLayout, { icon: empty, title: 'Sign In' }, React.createElement('form', null, 'Original form')));
  assert.equal(auth.includes('data-desktop-auth="true"'), enabled);
  assert.match(auth, /<form>Original form<\/form>/);
}
assert.match(css, /\.nv-checkout-page\[data-desktop-checkout="true"\] \.nv-checkout-dock \{ position: static/);
assert.match(css, /body:has\(:is\(\[data-desktop-brand="true"\]/);
assert.match(css, /\.nv-cart-page \{[^}]*padding-bottom: 16px/);
assert.match(css, /\[data-desktop-brand="true"\] :is\(\.nv-cart-recommendation-grid,\.nv-events-list\) > :not\(\[hidden\]\) ~ :not\(\[hidden\]\) \{ margin-block: 0; \}/);
assert.match(read('src/pages/ProductDetail.jsx'), /productGalleryThumbnail\(image, \{ website: !isNativeAppRuntime\(\) \}\)/);
checks.push('Checkout/auth brand hooks exclude native and small viewports; locked checkout stays disabled, totals and original forms stay intact');
checks.push('Desktop cart reserve space removed, checkout action stays inside its original form, portal styling is explicitly website-scoped, Speed thumbnail path retained');
checks.push('Desktop cart and event grids explicitly override mobile sibling margins; their gap owns spacing without changing mobile stacks');
const geometry = { viewport: 1440, documentWidth: 1440, desktop: true, clippedFields: [], eventMargins: ['0px'], checkoutOrder: [], checkoutSections: [], cartCards: [{ top: 100, bottom: 350 }, { top: 100, bottom: 350 }] };
assert.doesNotThrow(() => assertDesktopGeometry(geometry));
assert.throws(() => assertDesktopGeometry({ ...geometry, cartCards: [geometry.cartCards[0], { top: 112, bottom: 362 }] }), /top edges/);
assert.throws(() => assertDesktopGeometry({ ...geometry, eventMargins: ['16px'] }), /stacking margins/);
assert.throws(() => assertDesktopGeometry({ ...geometry, documentWidth: 1450 }), /overflow/);
assert.throws(() => assertDesktopGeometry({ ...geometry, clippedFields: ['Email'] }), /Fields/);
assert.throws(() => assertDesktopGeometry({ ...geometry, productCards: [{ width: 410 }] }), /Shop cards/);
assert.throws(() => assertDesktopGeometry({ ...geometry, featuredCards: [{ width: 300, top: 0, bottom: 450, children: [{ top: 410, bottom: 480 }] }] }), /inside its frame/);
checks.push('Geometry contract rejects staggered cards, leftover event margins, page overflow and clipped fields');
assert.throws(() => assertDesktopGeometry({ ...geometry, fullWidthHeroes: [{ left: 200, right: 1240 }] }), /viewport edge/);
assert.throws(() => assertDesktopGeometry({ ...geometry, aboutImages: [{ top: 0, bottom: 1200 }] }), /intrinsic height/);
assert.throws(() => assertDesktopGeometry({ ...geometry, programBackground: 'none' }), /gradient surface/);
assert.throws(() => assertDesktopGeometry({ ...geometry, informationEdges: [{ left: 192, right: 1248 }] }), /shared content width/);
assert.throws(() => assertDesktopGeometry({ ...geometry, titleWeights: [500] }), /stronger serif/);
assert.doesNotThrow(() => assertDesktopGeometry({ ...geometry, informationEdges: [{ left: 48, right: 1392 }], titleWeights: [650], programBackground: 'linear-gradient(115deg, mint, blue)' }));
assert.throws(() => assertDesktopGeometry({ ...geometry, programIncluded: [{ top: 500, right: 900 }], programPairing: [{ top: 500, left: 940 }], programPurchase: [{ top: 1100 }] }), /starts alongside/);
assert.throws(() => assertDesktopGeometry({ ...geometry, programKey: 'hydration', programAccent: '#174e56' }), /red identity/);
assert.throws(() => assertDesktopGeometry({ ...geometry, programPortraits: [{ width: 800, naturalWidth: 720, loaded: true }] }), /stays crisp/);
assert.throws(() => assertDesktopGeometry({ ...geometry, programIntro: [{ top: 0, bottom: 440 }] }), /compact/);
assert.throws(() => assertDesktopGeometry({ ...geometry, programSteps: [{ top: 0, title: { top: 48 }, detail: { top: 96 } }, { top: 12, title: { top: 60 }, detail: { top: 108 } }] }), /steps align/);
assert.match(read('src/pages/About.jsx'), /sizes: desktop \? '100vw' :/);
assert.match(css, /--nv-title-weight: 650/);
assert.match(css, /\.nv-program-purchase \{ order: -1/);
const programPage = read('src/pages/ProgramDetail.jsx');
assert.match(programPage, /data-program=\{program.key\}/);
assert.match(programPage, /className="nv-program-content"/);
assert.match(programPage, /onClick=\{handleStartProgram\}/);
assert.match(programPage, /disabled=\{atMax\}/);
assert.match(programPage, /<ProgramBottleMix components=\{selectedOption.bundleComposition\} days=\{selectedOption.days\}/);
assert.match(programPage, /!desktop && program.image/);
assert.match(programPage, /programOptionForDays\(program, new URLSearchParams\(search\).get\('days'\) \|\| 3\)/);
assert.match(programPage, /useState\(requestedDays\)/);
assert.match(programPage, /setSelectedDays\(requestedDays\)/);
checks.push('Full-width heroes, shared information edges, stronger title weight, compact photos and program gradients are regression guarded');
checks.push('Program portraits cannot stretch beyond sharp display size; Hydration stays red and How it works steps must align');
checks.push('Program desktop layout reuses the existing selectors, shot limits, total and purchase handler; mobile ordering is unchanged');

let hookIndex = 0;
let cardState = [];
let invoked = 0;
let savedEligibility = 0;
let deliveryError;
const DeliveryCard = load('src/components/delivery/DeliveryAvailabilityCard.jsx', {
  react: { ...React, default: React, useEffect: () => {}, useState: initial => {
    const index = hookIndex++;
    if (!(index in cardState)) cardState[index] = initial;
    return [cardState[index], value => { cardState[index] = value; }];
  } },
  'framer-motion': { AnimatePresence: 'div', motion: { div: 'div' } },
  'lucide-react': { MapPin: empty, CheckCircle: empty, ArrowRight: empty, Leaf: empty },
  '@/api/base44Client': { base44: { functions: { invoke: async () => { invoked++; throw deliveryError; } } } },
  '@/lib/deliveryAvailability': { getDeliveryAvailability: () => null, clearDeliveryAvailability: () => {}, setDeliveryAvailability: () => { savedEligibility++; } },
  '@/lib/preliminaryDeliveryAvailability': { PRELIMINARY_DELIVERY_CHECK_VERSION: 1, classifyPreliminaryDeliveryAvailability: () => { throw new Error('Unexpected classification'); }, restorePreliminaryDeliveryAvailability: () => null },
  '@/components/delivery/WaitlistForm': { default: empty },
  'react-router-dom': { Link: 'a' },
  '@/lib/googleAnalytics': { trackGoogleRetentionEvent: () => { throw new Error('Unexpected measurement'); } },
}).default;
function checkButton(element) {
  if (!element || typeof element !== 'object') return null;
  if (element.type === 'button' && element.props.disabled !== undefined) return element;
  return React.Children.toArray(element.props?.children).map(checkButton).find(Boolean);
}
for (const error of [{ code: 'LOCAL_PREVIEW_READ_ONLY' }, { data: { code: 'LOCAL_PREVIEW_READ_ONLY' } }, { response: { data: { code: 'LOCAL_PREVIEW_READ_ONLY' } } }, new Error('Network'), { code: 'UNAUTHORIZED' }]) {
  cardState = ['63385', 'idle', false, '', null]; hookIndex = 0; invoked = 0; savedEligibility = 0; deliveryError = error;
  await checkButton(DeliveryCard()).props.onClick();
  assert.equal(invoked, 1); assert.equal(savedEligibility, 0); assert.equal(cardState[1], 'idle');
  assert.match(cardState[3], error.code === 'LOCAL_PREVIEW_READ_ONLY' || error.data || error.response ? /local design preview/ : /full address is checked at checkout/);
}
cardState = ['633', 'idle', false, '', null]; hookIndex = 0; invoked = 0;
await checkButton(DeliveryCard()).props.onClick();
assert.equal(invoked, 0); assert.match(cardState[3], /valid 5-digit ZIP/);
checks.push('ZIP validation makes no request for invalid input; preview/network failures never become eligibility or analytics events');
const fixtureDist = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvira-preview-test-'));
try {
  fs.writeFileSync(path.join(fixtureDist, 'index.html'), '<html><body><script src="/assets/test.js"></script></body></html>');
  for (const product of LOCAL_CATALOG) {
    const photo = path.join(fixtureDist, product.image_url);
    fs.mkdirSync(path.dirname(photo), { recursive: true });
    fs.writeFileSync(photo, 'fixture');
  }
  const previewHandler = await createPreviewHandler({ dist: fixtureDist, port: 4196 });
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    const response = { statusCode: 0, setHeader() {}, end(body) { this.body = body; } };
    await previewHandler({ method, url: '/api/apps/69d48d0c39891f7945481152/functions/validateDeliveryEligibility', headers: { host: '127.0.0.1:4196' } }, response);
    assert.equal(response.statusCode, 403);
    assert.equal(JSON.parse(response.body).code, 'LOCAL_PREVIEW_READ_ONLY');
  }
} finally {
  fs.rmSync(fixtureDist, { recursive: true, force: true });
}
checks.push('Local ZIP checks remain blocked, with a structured explanation; all non-read methods remain denied');
for (const page of ['About', 'Events', 'Partner', 'BookEvent']) {
  const source = read(`src/pages/${page}.jsx`);
  assert.match(source, /const desktop = useDesktopStorefront\(\)/);
  assert.match(source, /desktop \? BRAND_IMAGES\.(wordmark|trioOutdoorEvent) : (LOGO_URL|TRIO_URL)/);
}
assert.match(read('src/pages/BookEvent.jsx'), /desktop \? websiteBrandImageProps\(BRAND_IMAGES.aboutHeroEvent, \{ website: true \}\) : \{ src: HERO_URL \}/);
checks.push('Legacy remote imagery is retained on native and small web; only desktop uses existing local brand assets, with no new artwork or helper edits');
assert.match(read('src/pages/Events.jsx'), /desktop \? \(\s*<h1[^>]*>Events & Community<\/h1>/);
assert.match(read('src/components/account/ProfileAvatar.jsx'), /<CustomerDialog/);
assert.match(read('src/components/CustomerDialog.jsx'), /nv-customer-modal/);
for (const file of ['RewardsSuccessModal', 'checkout/OutOfAreaModal']) {
  assert.match(read(`src/components/${file}.jsx`), /className="nv-customer-modal /);
}
assert.match(read('src/components/checkout/OutOfAreaModal.jsx'), /aria-label="Close delivery area request"/);
checks.push('Events has a desktop page heading; custom profile, reward-success and delivery-area surfaces opt into desktop-only modal styling');
console.log(JSON.stringify({ ok: true, suite: 'desktop-brand', checks, production_writes: false }, null, 2));
