import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import * as confirmation from '../../src/lib/orderConfirmationState.js';

const source = fs.readFileSync('src/pages/OrderConfirmation.jsx', 'utf8');
const compiled = transformSync(source, { loader: 'jsx', format: 'cjs' }).code;
const paid = { id: 'synthetic-order', order_number: 'NV-SYNTHETIC', status: 'scheduled_for_juicing',
  payment_status: 'paid', payment_captured: true, total: 42.99, items: [], customer_email: 'synthetic@example.test' };
const pending = { ...paid, status: 'pending_payment', payment_status: 'pending', payment_captured: false };
function fixture({ query = '?order_number=NV-SYNTHETIC', row = paid, guestToken = false, stalled = false } = {}) {
  const states = []; const effects = []; const calls = []; const intervals = new Map(); const timeouts = new Map();
  let cursor = 0; let nextTimer = 1; let initialized = false; let resolveRead;
  const waitRead = stalled ? new Promise(resolve => { resolveRead = resolve; }) : null;
  const storage = new Map();
  if (guestToken) storage.set('nuvira_guest_order_confirmation', JSON.stringify({
    order_number: 'NV-SYNTHETIC', token: 'synthetic-token', timestamp: Date.now() }));
  const react = { ...React, useState: initial => {
    const index = cursor++;
    if (!initialized) states[index] = typeof initial === 'function' ? initial() : initial;
    return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
  }, useEffect: fn => { if (!initialized) effects.push(fn); }, useRef: value => ({ current: value }) };
  const passthrough = ({ children }) => React.createElement('div', null, children);
  const icons = new Proxy({}, { get: () => () => React.createElement('svg') });
  const track = () => { calls.push('tracking'); return false; };
  const backend = async () => { calls.push('read'); if (waitRead) await waitRead; return row; };
  const api = { base44: { entities: { Order: { filter: async () => { const result = await backend(); return result ? [result] : []; } } },
    functions: { invoke: async () => { const result = await backend(); return { data: { found: Boolean(result), order: result } }; } } } };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, URLSearchParams, Date,
    console: { log() {}, warn() {}, error() {} },
    window: { location: { search: query, pathname: '/order-confirmation' }, addEventListener() {}, removeEventListener() {} },
    sessionStorage: { getItem: key => storage.get(key) || null, removeItem: key => storage.delete(key) },
    setInterval: fn => { const id = nextTimer++; intervals.set(id, fn); return id; }, clearInterval: id => intervals.delete(id),
    setTimeout: fn => { const id = nextTimer++; timeouts.set(id, fn); return id; }, clearTimeout: id => timeouts.delete(id),
    require: name => {
      if (name === 'react') return { ...react, default: react, __esModule: true };
      if (name === 'react-router-dom') return { Link: passthrough };
      if (name === 'lucide-react') return icons;
      if (name === 'framer-motion') return { motion: { div: passthrough } };
      if (name === 'date-fns') return { format: () => 'Synthetic delivery date' };
      if (name.endsWith('orderConfirmationState')) return confirmation;
      if (name.endsWith('base44Client')) return api;
      if (name.endsWith('googleAnalytics')) return { trackGooglePurchase: track, ANALYTICS_CONSENT_EVENT: 'test-analytics' };
      if (name.endsWith('metaPixel')) return { MARKETING_CONSENT_EVENT: 'test-marketing' };
      if (name.endsWith('snapPixel')) return { trackSnapPurchase: track };
      if (name.endsWith('guestLoyaltyActivation')) return { GUEST_LOYALTY_ACTIVATION_RETURN_ROUTE: '/synthetic-activation',
        purchasePointsForTotal: amount => Math.floor(amount * 10), saveGuestLoyaltyActivationContext: () => calls.push('activation_saved') };
      if (name.endsWith('nativeAuthRedirect')) return { redirectToLogin: () => {} };
      if (name.endsWith('HealthAdvisory')) return { HEALTH_ADVISORY_CONFIG: { confirmationNotice: 'Synthetic notice' } };
      if (name.endsWith('MobilePageHeader')) return { SAFE_TOP_PADDING: 16 };
      if (name.endsWith('/button')) return { Button: passthrough };
      if (['@/components/SEO', '@/components/BrowserAppPrompt', '@/components/GoogleCustomerReviewsOptIn'].includes(name)) return { default: () => null, __esModule: true };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const render = () => { cursor = 0; const html = renderToStaticMarkup(React.createElement(module.exports.default)); initialized = true; return html; };
  const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  const mount = async () => { render(); const cleanup = effects[0](); await drain(); return cleanup; };
  return { states, calls, intervals, timeouts, render, mount, drain, resolve: () => resolveRead?.(row) };
}
const tests = []; const test = (name, fn) => tests.push([name, fn]);
for (const [label, row, expected] of [
  ['missing order', null, 'pending'], ['pending payment', pending, 'pending'],
  ['paid member', paid, 'confirmed'], ['sanitized paid guest without internal ID', { ...paid, id: undefined }, 'confirmed'],
  ['unproven zero-dollar paid flag', { ...paid, total: 0, payment_captured: false }, 'pending'],
  ['cancelled after capture', { ...paid, status: 'cancelled' }, 'not_completed'],
  ['refunded payment', { ...paid, payment_status: 'refunded' }, 'not_completed'],
  ['abandoned checkout', { ...paid, is_abandoned_checkout: true }, 'not_completed'],
]) test(`Classify ${label}`, () => assert.equal(confirmation.classifyOrderConfirmation(row), expected));
test('Actual page initially makes no payment-received claim', () => {
  const f = fixture(); const html = f.render(); assert.match(html, /Confirming your order/);
  assert.doesNotMatch(html, /payment was received|Order is Confirmed|points earned/i);
});
test('Actual member page keeps pending Order out of confirmed UI', async () => {
  const f = fixture({ row: pending }); await f.mount(); const html = f.render();
  assert.match(html, /Confirming your order/); assert.equal(f.states[0], null);
  assert.doesNotMatch(html, /payment was received|Order is Confirmed/i);
});
test('Actual session lookup keeps a found-but-pending Order out of confirmed UI', async () => {
  const f = fixture({ row: pending, query: '?session_id=cs_SYNTHETIC' }); await f.mount();
  assert.equal(f.states[0], null); assert.doesNotMatch(f.render(), /Order is Confirmed/);
});
test('Actual guest page accepts the existing sanitized paid response without requiring an internal ID', async () => {
  const f = fixture({ query: '?order_number=NV-SYNTHETIC&guest_checkout=1', guestToken: true, row: { ...paid, id: undefined } });
  await f.mount(); const html = f.render(); assert.match(html, /Your Order is Confirmed/);
  assert.match(html, /Activate My Points/); assert.ok(f.calls.includes('activation_saved'));
});
test('Verified no-cash reward confirmation explicitly says no payment was required', async () => {
  const row = { ...paid, total: 0, financial_status: 'paid', payment_captured: false,
    stripe_checkout_session_id: 'cs_live_SYNTHETIC', reward_settlement: {
      revision: '2026-09-08.reward-settlement-v1', checkout_session_id: 'cs_live_SYNTHETIC',
      context_hash: 'a'.repeat(64), reservation_id: 'synthetic-reservation', points_redeemed: 2000,
      provider_event_id: 'evt_SYNTHETIC', settled_at: '2026-09-08T08:00:00Z',
    } };
  const f = fixture({ row }); await f.mount(); const html = f.render();
  assert.match(html, /Your Order is Confirmed/);
  assert.match(html, /Reward redeemed/); assert.match(html, /No payment required/);
  assert.doesNotMatch(html, /payment was received|payment was confirmed/i);
});
test('Missing guest authorization no longer invents a confirmation or rewards', async () => {
  const f = fixture({ query: '?order_number=NV-SYNTHETIC&guest_checkout=1' }); await f.mount();
  assert.match(f.render(), /couldn&#x27;t confirm/); assert.doesNotMatch(f.render(), /Order is Confirmed|points earned/);
  assert.equal(f.calls.length, 0); assert.equal(f.intervals.size, 0); assert.equal(f.timeouts.size, 0);
});
test('Timeout shows uncertainty, not a promised successful order or email', async () => {
  const f = fixture({ row: pending }); await f.mount(); [...f.timeouts.values()][0]();
  const html = f.render(); assert.match(html, /couldn&#x27;t confirm/);
  assert.doesNotMatch(html, /payment was confirmed|Order Received!|receive a confirmation email shortly/i);
});
test('Cancelled/refunded actual readback cannot render a fresh order confirmation', async () => {
  for (const status of ['cancelled', 'refunded']) {
    const f = fixture({ row: { ...paid, status } }); await f.mount();
    assert.equal(f.states[0], null); assert.doesNotMatch(f.render(), /Your Order is Confirmed/);
  }
});
test('A slow read cannot start overlapping polls', async () => {
  const f = fixture({ stalled: true }); await f.mount(); const interval = [...f.intervals.values()][0];
  interval(); interval(); await f.drain(); assert.equal(f.calls.filter(x => x === 'read').length, 1);
  f.resolve(); await f.drain(); assert.match(f.render(), /Your Order is Confirmed/); assert.equal(f.intervals.size, 0);
});
test('Read resolved after timeout cannot replace uncertainty with a stale confirmation', async () => {
  const f = fixture({ stalled: true }); await f.mount(); [...f.timeouts.values()][0]();
  f.resolve(); await f.drain(); assert.equal(f.states[0], null); assert.doesNotMatch(f.render(), /Your Order is Confirmed/);
});
test('Unmount suppresses a late lookup result', async () => {
  const f = fixture({ stalled: true }); const cleanup = await f.mount(); cleanup(); f.resolve(); await f.drain();
  assert.equal(f.states[0], null); assert.equal(f.intervals.size, 0); assert.equal(f.timeouts.size, 0);
});

let passed = 0;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`Order confirmation truth: ${passed}/${tests.length}; actual component rendered with simulated reads/timers, no provider calls.`);
