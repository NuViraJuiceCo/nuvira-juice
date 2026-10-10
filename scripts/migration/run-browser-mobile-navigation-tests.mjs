#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';

const source = fs.readFileSync('src/components/desktop/BrowserNavigationPanel.jsx', 'utf8');
const css = fs.readFileSync('src/styles/desktop-brand.css', 'utf8');
const header = fs.readFileSync('src/components/desktop/DesktopHeader.jsx', 'utf8');
let location = { pathname: '/', hash: '', key: 'first' };
let effects = [];
let open = false;
let mediaListener;
let removedListener;
let focusedLogo = false;
let scrolledAnchor = null;
const media = {
  matches: true,
  addEventListener: (name, listener) => { assert.equal(name, 'change'); mediaListener = listener; },
  removeEventListener: (name, listener) => { assert.equal(name, 'change'); removedListener = listener; },
};
const container = ({ children }) => React.createElement('div', null, children);
const imports = {
  react: { ...React, default: React, useState: () => [open, value => { open = value; }], useRef: value => ({ current: value }), useEffect: (effect, deps) => effects.push({ effect, deps }) },
  'react-router-dom': { Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children), useLocation: () => location },
  'lucide-react': { ArrowUpRight: () => null, Menu: () => null },
  '@/components/ui/sheet': { Sheet: container, SheetClose: container, SheetContent: container, SheetTitle: 'h2', SheetTrigger: container },
  '@/lib/admin-access': { isAdminUser: user => user?.role === 'admin' },
};
const module = { exports: {} };
vm.runInNewContext(transformSync(source, { loader: 'jsx', format: 'cjs' }).code, {
  module, exports: module.exports,
  require: name => { assert.ok(name in imports, `Unexpected dependency: ${name}`); return { __esModule: true, ...imports[name] }; },
  window: { matchMedia: query => { assert.equal(query, '(max-width: 600px)'); return media; } },
  document: {
    querySelector: selector => { assert.equal(selector, '.nv-brand-logo'); return { focus: () => { focusedLogo = true; } }; },
    getElementById: id => ({ scrollIntoView: () => { scrolledAnchor = id; } }),
  },
});
const Panel = module.exports.default;
const navigation = [
  { to: '/shop', label: 'Shop Juices', matches: path => path === '/shop' },
  { to: '/#programs', label: 'Programs', matches: path => path.startsWith('/program/') },
  { to: '/rewards', label: 'Rewards', matches: path => path === '/rewards' },
];
const intent = to => ({ onFocus: () => to });
function nodes(element, predicate) {
  if (!element || typeof element !== 'object') return [];
  return [...(predicate(element) ? [element] : []), ...React.Children.toArray(element.props?.children).flatMap(child => nodes(child, predicate))];
}
for (const user of [null, { email: 'fixture@example.test' }, { email: 'fixture@example.test', role: 'admin' }]) {
  effects = [];
  const tree = Panel({ navigation, user, navigationIntent: intent });
  const html = renderToStaticMarkup(tree);
  assert.ok(html.includes(user ? 'My Account' : 'Sign In / Create Account'));
  assert.equal(html.includes('Admin Operations'), user?.role === 'admin');
  assert.equal(html.includes('Notifications'), Boolean(user));
  assert.match(html, /Delivery Details/);
  assert.match(html, /Help &amp; Support/);
  let focusedLinkScrolled = false;
  const scrollArea = nodes(tree, e => e.props?.className === 'nv-mobile-navigation-scroll')[0];
  scrollArea.props.onFocusCapture({ target: { closest: selector => {
    assert.equal(selector, 'a');
    return { scrollIntoView: options => {
      assert.equal(options.block, 'nearest');
      assert.equal(options.inline, 'nearest');
      focusedLinkScrolled = true;
    } };
  } } });
  assert.equal(focusedLinkScrolled, true, 'Wrapped keyboard focus stays visible in short viewports');
  const content = nodes(tree, e => e.props?.onCloseAutoFocus)[0];
  for (const link of nodes(tree, e => e.props?.to)) {
    open = true;
    link.props.onClick({ currentTarget: { getAttribute: () => link.props.to } });
    assert.equal(open, false, 'Every destination closes the sheet, including the current URL');
    let navigationFocusPrevented = false;
    content.props.onCloseAutoFocus({ preventDefault: () => { navigationFocusPrevented = true; } });
    assert.equal(navigationFocusPrevented, true, 'Navigation does not refocus the header and undo anchor scrolling');
  }
  const firstLink = nodes(tree, e => e.props?.to)[0];
  firstLink.props.onClick({ currentTarget: { getAttribute: () => '/' } });
  let samePageFocusPrevented = false;
  content.props.onCloseAutoFocus({ preventDefault: () => { samePageFocusPrevented = true; } });
  assert.equal(samePageFocusPrevented, false, 'Same-page links restore focus to the menu trigger');
  assert.equal(effects[0].deps[0], location.key);
  open = true;
  effects[0].effect();
  assert.equal(open, false, 'History navigation closes the sheet');
  const cleanup = effects[1].effect();
  open = true;
  media.matches = true;
  mediaListener();
  assert.equal(open, true, 'Phone height changes do not dismiss navigation');
  media.matches = false;
  mediaListener();
  assert.equal(open, false, 'Switching to desktop releases the modal');
  cleanup();
  assert.equal(removedListener, mediaListener);
  let prevented = false;
  content.props.onCloseAutoFocus({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(focusedLogo, true, 'Focus returns to visible branding after resizing');
  media.matches = true;
  prevented = false;
  content.props.onCloseAutoFocus({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false, 'Normal dismissal uses Radix trigger focus restoration');
}
for (const route of [{ pathname: '/', hash: '#programs' }, { pathname: '/program/reset', hash: '' }]) {
  location = { ...route, key: 'next' };
  const tree = Panel({ navigation, user: null, navigationIntent: intent });
  const programs = nodes(tree, e => e.props?.to === '/#programs')[0];
  assert.equal(programs.props['aria-current'], 'page');
  programs.props.onClick({ currentTarget: { getAttribute: () => '/#programs' } });
  let prevented = false;
  nodes(tree, e => e.props?.onCloseAutoFocus)[0].props.onCloseAutoFocus({ preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(scrolledAnchor, 'programs', 'Same-hash navigation scrolls after closing instead of returning to the header');
}
assert.match(source, /<Sheet open=\{open\} onOpenChange=\{setOpen\}>/);
assert.match(source, /<SheetContent side="right"/);
assert.match(source, /<SheetTitle>/);
assert.match(source, /<SheetClose asChild/);
assert.doesNotMatch(source, /base44|fetch\(|localStorage|entities\.|functions\./);
assert.match(header, /<BrowserNavigationPanel navigation=\{navigation\} user=\{user\}/);
assert.doesNotMatch(header, /DropdownMenuTrigger[^>]*Website navigation/);
assert.match(css, /\.nv-mobile-navigation-sheet \{[^}]*height: 100dvh/);
assert.match(css, /\.nv-mobile-navigation-scroll \{[^}]*overflow-y: auto[^}]*overscroll-behavior: contain/);
assert.match(css, /\.nv-mobile-navigation-sheet > button \{[^}]*width: 44px; height: 44px/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /\.nv-mobile-navigation-sheet \{ animation: none !important/);
assert.match(css, /\.nv-brand-desktop-account \{ display: none/);
assert.match(css, /max-height: var\(--radix-dropdown-menu-content-available-height\); overflow-y: auto/);
console.log('PASS: browser mobile navigation destinations, member/admin gating, close behavior, hash state, resize cleanup, focus return and viewport contracts');
