#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import * as rewardSelection from '../../src/lib/rewardSelection.js';
import { orderMinimumGuidance } from '../../src/lib/orderMinimumGuidance.js';

const read = file => fs.readFileSync(file, 'utf8');
function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const { code } = transformSync(read(file), { loader: 'jsx', format: 'cjs' });
  vm.runInNewContext(code, { module, exports: module.exports, ...globals, require(name) {
    assert.ok(name in imports, `Unexpected dependency: ${name}`);
    return { __esModule: true, ...imports[name] };
  } });
  return module.exports;
}
let stateIndex = 0;
let refIndex = 0;
let states = [];
let refs = [];
let focusCalls = 0;
let tracking = [];
const storageWrites = [];
const mockWindow = { location: { pathname: '/shop' }, localStorage: { getItem: () => null, setItem: (...args) => storageWrites.push(args) } };
const mockDocument = { activeElement: { isConnected: true, focus: () => focusCalls++ } };
const hooks = { ...React, default: React,
  useState: initial => {
    const index = stateIndex++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  },
  useRef: initial => refs[refIndex++] ||= { current: initial },
  useCallback: fn => fn,
  useEffect: () => {},
};
const track = name => (...args) => tracking.push({ name, args });
const { CartProvider } = load('src/lib/cartContext.jsx', {
  react: hooks,
  '@/api/base44Client': { base44: { functions: { invoke: track('journey') } } },
  '@/lib/googleAnalytics': { trackGoogleAddToCart: track('google-add'), trackGoogleRemoveFromCart: track('google-remove'), trackGoogleBeginCheckout: track('google-checkout') },
  '@/lib/metaPixel': { trackMetaAddToCart: track('meta-add'), trackMetaInitiateCheckout: track('meta-checkout') },
  '@/lib/snapPixel': { trackSnapAddToCart: track('snap-add'), trackSnapStartCheckout: track('snap-checkout') },
  '@/lib/rewardSelection': rewardSelection,
}, { window: mockWindow, document: mockDocument });
const cart = () => { stateIndex = 0; refIndex = 0; return CartProvider({ children: null }).props.value; };
const reset = () => { states = []; refs = []; tracking = []; storageWrites.length = 0; return cart(); };
const aura = { id: 'aura', title: 'AURA', price: 13, category: 'juice', size: '12oz' };
const shot = { id: 'shot', title: 'Reset Shot', price: 5, category: 'shot' };
const checks = [];

assert.equal(reset().cartPreview, null);
cart().addItem(aura);
assert.equal(cart().cartPreview, null, 'Existing non-preview flows are unchanged');
cart().addItem(aura, 1, {}, { preview: true });
assert.equal(cart().items.length, 1);
assert.equal(cart().items[0].quantity, 2);
assert.equal(cart().subtotal, 26);
assert.equal(cart().cartPreview.addedTitle, 'AURA');
assert.equal(cart().cartPreview.open, true);
assert.equal(tracking.length, 6, 'Two adds each emit existing Google/Meta/Snap tracking once');
const trackedAdds = tracking.length;
cart().closeCartPreview(); cart().openCartPreview(); cart().closeCartPreview();
assert.equal(tracking.length, trackedAdds, 'Opening and closing emit no cart or checkout events');
assert.equal(storageWrites.length, 0, 'Preview state is not persisted');
assert.equal('preview' in cart().items[0], false);
cart().restoreCartPreviewFocus();
assert.equal(focusCalls, 1);
mockWindow.location.pathname = '/cart';
cart().restoreCartPreviewFocus();
assert.equal(focusCalls, 1, 'Navigation must not restore focus to the previous route');
mockWindow.location.pathname = '/shop';
checks.push('Preview is opt-in and ephemeral; repeated adds merge once, tracking is unchanged, and focus restores only on the original route');

let pointerFocusCalls = 0;
const pointerTrigger = { isConnected: true, focus: () => pointerFocusCalls++ };
cart().openCartPreview('', pointerTrigger);
cart().closeCartPreview();
cart().restoreCartPreviewFocus();
assert.equal(pointerFocusCalls, 1, 'A pointer trigger wins over Safari activeElement');
cart().addItem(aura, 1, {}, { preview: true, triggerElement: pointerTrigger });
cart().closeCartPreview();
cart().restoreCartPreviewFocus();
assert.equal(pointerFocusCalls, 2, 'Quick-add forwards its explicit focus target');
assert.equal('triggerElement' in cart().items[0], false, 'DOM references never enter persisted cart items');
pointerTrigger.isConnected = false;
cart().restoreCartPreviewFocus();
assert.equal(pointerFocusCalls, 2, 'Detached triggers are ignored');
checks.push('Pointer-trigger focus restores in Safari without storing DOM references in the cart');

reset().addItem(aura, 1, { isFreeReward: true, reward_id: 'earned' }, { preview: true });
assert.equal(cart().items.length, 0);
assert.equal(cart().cartPreview, null);
assert.equal(tracking.length, 0);
cart().addItem(aura, 5, { isBirthdayReward: true }, { preview: true });
assert.equal(cart().items.length, 0);
const birthday = { ...aura, id: '__birthday_reward__', price: 0 };
cart().addItem(birthday, 5, { isBirthdayReward: true, birthday_product_id: aura.id }, { preview: true });
assert.equal(cart().items[0].quantity, 1);
cart().updateQuantity('__birthday_reward__', 9);
assert.equal(cart().items[0].quantity, 1);
checks.push('Earned-item and birthday validation still guard both cart mutations and confirmation');

reset().addItem(aura, 1, { cart_line_key: 'choice-a' }, { preview: true });
cart().addItem(aura, 1, { cart_line_key: 'choice-b' }, { preview: true });
cart().updateQuantity('choice-a', 3);
assert.equal(cart().items.find(item => item.cart_line_key === 'choice-b').quantity, 1);
cart().removeItem('choice-a');
assert.equal(cart().items.length, 1);
assert.equal(cart().items[0].cart_line_key, 'choice-b');
const bundle = { id: 'trio', title: 'The NuVira Trio', category: 'bundle', price: 36 };
cart().addItem(bundle, 1, { bottles_per_unit: 3, bundle_composition: [{ product_id: 'aura', quantity: 1 }] }, { preview: true });
assert.equal(cart().items[1].bottles_per_unit, 3);
assert.equal(cart().items[1].bundle_composition[0].product_id, 'aura');
checks.push('Distinct cart-line keys, bundle metadata, removal and quantity updates retain existing semantics');

let currentCart;
const plain = tag => ({ children }) => React.createElement(tag, null, children);
const empty = () => null;
const Preview = load('src/components/cart/CartPreview.jsx', {
  react: { ...React, default: React },
  'react-router-dom': { Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children) },
  '@radix-ui/react-dialog': { Root: plain('div'), Portal: plain('div'), Overlay: empty, Content: plain('section'), Title: plain('h2'), Description: plain('p'), Close: ({ children, ...props }) => React.createElement('button', props, children) },
  'lucide-react': Object.fromEntries(['ArrowRight','Check','Minus','Plus','ShoppingBag','Trash2','X'].map(name => [name, empty])),
  '@/lib/cartContext': { useCart: () => currentCart },
  '@/lib/orderMinimumGuidance': { orderMinimumGuidance },
  '@/lib/rewardSelection': rewardSelection,
  '@/components/shop/ProductPhoto': { default: empty },
  '@/styles/cart-preview.css': {},
}).default;
const render = () => { currentCart = cart(); return renderToStaticMarkup(React.createElement(Preview)); };
function find(element, predicate) {
  if (!element || typeof element !== 'object') return null;
  if (predicate(element)) return element;
  return React.Children.toArray(element.props?.children).map(child => find(child, predicate)).find(Boolean);
}
reset().addItem(aura, 1, {}, { preview: true });
assert.match(render(), /Choose 2 more juices/);
assert.match(render(), /href="\/cart"/);
assert.doesNotMatch(render(), /href="\/checkout"/);
const plus = find(Preview(), el => el.props?.['aria-label'] === 'Increase AURA quantity');
plus.props.onClick();
assert.match(render(), /Choose 1 more juice/);
assert.match(render(), /\$26\.00/);
cart().addItem(shot);
assert.match(render(), /Choose 1 more shot/);
cart().updateQuantity('shot', 2);
assert.match(render(), /Order count minimum met/);
assert.match(render(), /Delivery-area dollar minimums still apply/);
reset().addItem(bundle, 1, { bottles_per_unit: 3 }, { preview: true });
assert.match(render(), /Order count minimum met/);
reset().addItem({ id: 'tote', title: 'Tote', price: 12, category: 'merch' }, 1, {}, { preview: true });
assert.doesNotMatch(render(), /role="progressbar"/);
reset().addItem(birthday, 1, { isBirthdayReward: true, birthday_product_id: 'aura' }, { preview: true });
assert.match(render(), /Qty 1/);
assert.doesNotMatch(render(), /Increase AURA quantity/);
cart().removeItem('__birthday_reward__');
assert.match(render(), /Your bag is empty/);
assert.match(render(), /href="\/shop"/);
assert.doesNotMatch(render(), /added to your bag/);
reset().addItem(aura, 100, {}, { preview: true }); render();
assert.equal(find(Preview(), el => el.props?.['aria-label'] === 'Increase AURA quantity').props.disabled, true);
checks.push('Rendered progress follows juice, shot, mixed, bundle, reward and merchandise rules; View Cart stays available below minimum, no checkout bypass');
checks.push('Empty state, fixed reward quantity, 100-unit limit and quantity/subtotal controls are covered');

const host = read('src/components/cart/CartPreviewHost.jsx');
assert.match(host, /lazy\(\(\) => import\('\.\/CartPreview'\)\)/);
assert.match(host, /return cartPreview \? <Suspense/);
assert.match(host, /\[pathname, search, closeCartPreview\]/);
assert.match(read('src/components/layout/AppLayout.jsx'), /!adminShell && !isNativeAppRuntime\(\) && <CartPreviewHost/);
for (const file of ['src/pages/ProductDetail.jsx','src/components/shop/ProductCard.jsx','src/pages/Merch.jsx']) {
  assert.match(read(file), /preview: !isNativeAppRuntime\(\)/);
}
assert.match(read('src/components/desktop/DesktopHeader.jsx'), /onClick=\{event => openCartPreview\('', event\.currentTarget\)\}/);
const css = read('src/styles/cart-preview.css');
assert.match(css, /prefers-reduced-motion: reduce/);
assert.match(css, /prefers-reduced-transparency: reduce/);
assert.match(css, /env\(safe-area-inset-bottom\)/);
assert.match(css, /@media \(min-width: 768px\)/);
checks.push('Drawer is lazy, separate from route Suspense, dismissed on navigation, excluded from native/admin, and supports responsive/reduced-motion presentation');
console.log(JSON.stringify({ ok: true, suite: 'cart-preview', checks }, null, 2));
