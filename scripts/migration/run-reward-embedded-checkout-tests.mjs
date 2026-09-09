import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transformSync } from 'esbuild';
import ts from 'typescript';
import { readRewardCheckoutRecovery, cancelRewardCheckoutRecovery } from '../../src/lib/rewardCheckoutRecovery.js';

const componentSource = fs.readFileSync('src/components/checkout/RewardEmbeddedCheckout.jsx', 'utf8');
const compiled = transformSync(componentSource, { loader: 'jsx', format: 'cjs' }).code;
const checkoutSource = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const tree = ts.createSourceFile('Checkout.jsx', checkoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
function find(predicate) {
  let found;
  const visit = node => { if (!found && predicate(node)) found = node; if (!found) ts.forEachChild(node, visit); };
  visit(tree); assert.ok(found, 'Checkout callback must exist'); return found;
}
const sessionId = 'cs_live_SYNTHETIC';
const props = { checkoutSessionId: sessionId, clientSecret: `${sessionId}_secret_TEST`, publishableKey: 'pk_live_SYNTHETIC' };
function fixture(patch = {}, loaderMode = 'success') {
  const slots = []; const effects = []; const calls = []; let cursor = 0; let options;
  const depsEqual = (a, b) => a && b && a.length === b.length && a.every((item, i) => item === b[i]);
  const hooks = { ...React,
    useState: initial => { const i = cursor++; slots[i] ||= { value: initial };
      return [slots[i].value, value => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value; }]; },
    useRef: initial => { const i = cursor++; slots[i] ||= { current: initial }; return slots[i]; },
    useMemo: (fn, deps) => { const i = cursor++; if (!depsEqual(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value; },
    useEffect: (fn, deps) => { const i = cursor++; if (!depsEqual(slots[i]?.deps, deps)) {
      const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn(); });
    } },
  };
  let resolveLoad;
  const pending = new Promise(resolve => { resolveLoad = resolve; });
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Promise,
    require: name => {
      if (name === 'react') return { ...hooks, default: hooks, __esModule: true };
      if (name === '@stripe/stripe-js') return { loadStripe: async key => {
        calls.push(`load:${key}`); if (loaderMode === 'failure') throw new Error('synthetic provider secret');
        if (loaderMode === 'null') return null; if (loaderMode === 'pending') return pending; return { syntheticStripe: true };
      } };
      if (name === '@stripe/react-stripe-js') return {
        EmbeddedCheckoutProvider: ({ options: value, children }) => { options = value; return React.createElement('section', null, children); },
        EmbeddedCheckout: () => React.createElement('div', { 'data-embedded': true }, 'Synthetic Stripe frame'),
      };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  const current = { ...props, onComplete: id => calls.push(`complete:${id}`), ...patch };
  const render = () => { cursor = 0; return renderToStaticMarkup(React.createElement(module.exports.default, current)); };
  const drain = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  const commit = async () => { effects.splice(0).forEach(effect => effect()); await drain(); };
  return { calls, current, render, commit, options: () => options,
    unmount: () => slots.forEach(slot => slot?.cleanup?.()), resolve: async () => { resolveLoad({ syntheticStripe: true }); await drain(); } };
}
let count = 0;
async function test(name, fn) { await fn(); count++; console.log('PASS', name); }
await test('real component shows neutral loading then the Session frame, without PaymentElement', async () => {
  const f = fixture(); assert.match(f.render(), /Loading your secure reward checkout/);
  await f.commit(); assert.match(f.render(), /data-embedded/); assert.equal(f.options().clientSecret, props.clientSecret);
  assert.equal(f.calls.length, 1); assert.doesNotMatch(componentSource, /confirmPayment\(/);
});
for (const [name, patch] of [
  ['missing key', { publishableKey: null }], ['missing secret', { clientSecret: null }],
  ['PaymentIntent secret', { clientSecret: 'pi_SYNTHETIC_secret_TEST' }], ['wrong Session', { checkoutSessionId: 'cs_OTHER' }],
  ['missing Session', { checkoutSessionId: null }], ['non-publishable key', { publishableKey: 'invalid' }],
]) await test(`${name} does not initialize Stripe or show success`, async () => {
  const f = fixture(patch); const html = f.render(); assert.match(html, /role="alert"/);
  assert.match(html, /not been confirmed/); await f.commit(); assert.equal(f.calls.length, 0);
});
for (const mode of ['failure', 'null']) await test(`provider ${mode} gives a safe visible error`, async () => {
  const f = fixture({}, mode); f.render(); await f.commit(); const html = f.render(); assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /synthetic provider secret/); assert.equal(f.calls.some(value => value.startsWith('complete:')), false);
});
await test('Stripe completion is delivered once, never as a card payment or Purchase', async () => {
  const f = fixture(); f.render(); await f.commit(); f.render();
  f.options().onComplete(); f.options().onComplete(); assert.deepEqual(f.calls, [`load:${props.publishableKey}`, `complete:${sessionId}`]);
});
await test('completion after unmount cannot clear the cart or navigate', async () => {
  const f = fixture(); f.render(); await f.commit(); f.render(); const callback = f.options().onComplete;
  f.unmount(); callback(); assert.equal(f.calls.some(value => value.startsWith('complete:')), false);
});
await test('late provider load after unmount is ignored', async () => {
  const f = fixture({}, 'pending'); f.render(); await f.commit(); f.unmount(); await f.resolve();
  assert.equal(f.options(), undefined); assert.equal(f.calls.length, 1);
});
await test('stale Session callback is ignored after the checkout changes', async () => {
  const f = fixture(); f.render(); await f.commit(); f.render(); const stale = f.options().onComplete;
  f.current.checkoutSessionId = 'cs_NEW'; f.current.clientSecret = 'cs_NEW_secret_TEST';
  f.render(); await f.commit(); f.render(); stale(); f.options().onComplete();
  assert.equal(f.calls.filter(value => value.startsWith('complete:')).join(','), 'complete:cs_NEW');
});
await test('actual Checkout reward-completion callback only clears cart and opens the receipt-verified order page', () => {
  const node = find(n => ts.isJsxSelfClosingElement(n) && n.tagName.getText(tree) === 'RewardEmbeddedCheckout');
  const attribute = node.attributes.properties.find(p => p.name?.getText(tree) === 'onComplete');
  const calls = [];
  const callback = vm.runInNewContext(`(${attribute.initializer.expression.getText(tree)})`, {
    clearCart: () => calls.push('clear'), localStorage: { removeItem: key => calls.push(`remove:${key}`) },
    navigate: url => calls.push(url), pendingOrderNumber: 'NV-SYNTHETIC', encodeURIComponent, routeCheckout: null,
  });
  callback(); assert.deepEqual(calls, ['clear', 'remove:nuvira_pending_checkout_session', '/order-confirmation?order_number=NV-SYNTHETIC']);
});
function cancelFixture(result, throwing = false) {
  const node = find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(tree) === 'button'
    && n.children.some(child => ts.isJsxText(child) && child.text.includes('Edit order details')));
  const attribute = node.openingElement.attributes.properties.find(p => p.name?.getText(tree) === 'onClick');
  const calls = []; const ref = { current: false }; const key = { current: 'old-attempt' };
  const callback = vm.runInNewContext(`(${attribute.initializer.expression.getText(tree)})`, {
    rewardCheckoutSessionId: sessionId, checkoutAttemptInFlightRef: ref, checkoutIdempotencyKey: key,
    forgetRewardAttempt: () => calls.push('forget-attempt'),
    setIsSubmitting: value => calls.push(`submitting:${value}`),
    setRewardCheckoutSessionId: value => calls.push(`session:${value}`),
    setClientSecret: value => calls.push(`secret:${value}`),
    setPendingOrderNumber: value => calls.push(`order:${value}`),
    setConfirmedDeliverySchedule: value => calls.push(`schedule:${value}`),
    setRouteCheckout: () => {},
    refreshCheckoutPoints: async () => calls.push('refresh-points'),
    crypto: { randomUUID: () => 'new-attempt' },
    toast: { error: () => calls.push('error') },
    base44: { functions: { invoke: async (name, payload) => {
      assert.equal(name, 'createPaymentIntent'); assert.equal(payload.mode, 'cancel_reward_checkout');
      assert.equal(payload.checkout_session_id, sessionId); calls.push('cancel');
      if (throwing) throw new Error('synthetic'); return { data: result };
    } } },
  });
  return { callback, calls, ref, key };
}
await test('actual edit callback unlocks only after confirmed expiry and points release', async () => {
  const f = cancelFixture({ ok: true, checkout_session_expired: true, reward_reservation_released: true });
  await f.callback(); assert.equal(f.key.current, 'new-attempt'); assert.equal(f.ref.current, false);
  assert.deepEqual(f.calls, ['submitting:true', 'cancel', 'forget-attempt', 'session:null', 'refresh-points', 'submitting:false', 'secret:null', 'order:null', 'schedule:null']);
});
for (const [name, result, throwing] of [
  ['provider/network failure', null, true], ['not expired', { ok: true, reward_reservation_released: true }, false],
  ['points not released', { ok: true, checkout_session_expired: true }, false], ['generic success only', { ok: true }, false],
]) await test(`actual edit callback ${name} retains checkout identity and blocks duplicate preparation`, async () => {
  const f = cancelFixture(result, throwing); await f.callback(); assert.equal(f.key.current, 'old-attempt');
  assert.equal(f.calls.includes('error'), true); assert.equal(f.calls.some(value => value.startsWith('secret:')), false);
  assert.equal(f.calls.includes('refresh-points'), false); assert.equal(f.ref.current, false);
});
await test('actual edit callback ignores double taps while cancellation is in flight', async () => {
  const f = cancelFixture({ ok: true, checkout_session_expired: true, reward_reservation_released: true });
  await Promise.all([f.callback(), f.callback()]); assert.equal(f.calls.filter(value => value === 'cancel').length, 1);
});
const recovery = { kind: 'reward_no_payment', checkout_session_id: sessionId, order_number: 'NV-SYNTHETIC' };
await test('recovery hint accepts only the typed failure and bounded non-secret identity', () => {
  const payload = { ok: false, error_code: 'REWARD_CHECKOUT_PREPARING', reward_checkout_recovery: { ...recovery, extra: 'ignored' } };
  assert.deepEqual(readRewardCheckoutRecovery(payload), recovery);
  for (const patch of [{ ok: true }, { error_code: 'UNKNOWN' }, { reward_checkout_recovery: null },
    { reward_checkout_recovery: { ...recovery, kind: 'payment' } },
    { reward_checkout_recovery: { ...recovery, checkout_session_id: 'pi_TEST' } },
    { reward_checkout_recovery: { ...recovery, order_number: '<unsafe>' } }]) {
    assert.equal(readRewardCheckoutRecovery({ ...payload, ...patch }), null);
  }
});
function recoveryFixture(result, throwing = false) {
  const node = find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(tree) === 'button'
    && n.getText(tree).includes('Cancel this reward checkout'));
  const attribute = node.openingElement.attributes.properties.find(p => p.name?.getText(tree) === 'onClick');
  const calls = []; const ref = { current: false }; const key = { current: 'old-attempt' };
  const callback = vm.runInNewContext(`(${attribute.initializer.expression.getText(tree)})`, {
    rewardCheckoutRecovery: recovery, checkoutAttemptInFlightRef: ref, checkoutIdempotencyKey: key,
    forgetRewardAttempt: () => calls.push('forget-attempt'),
    cancelRewardCheckoutRecovery, crypto: { randomUUID: () => 'new-attempt' }, CHECKOUT_START_STAGES: { IDLE: 'idle' },
    setIsSubmitting: value => calls.push(`submitting:${value}`),
    setRewardCheckoutRecovery: value => calls.push(`recovery:${value}`),
    setRewardCheckoutSessionId: value => calls.push(`session:${value}`),
    setRouteCheckout: value => calls.push(`route:${value}`),
    setClientSecret: value => calls.push(`secret:${value}`), setPendingOrderNumber: value => calls.push(`order:${value}`),
    setConfirmedDeliverySchedule: value => calls.push(`schedule:${value}`),
    setCheckoutStartLockedSafely: value => calls.push(`locked:${value}`),
    setCheckoutStartStage: value => calls.push(`stage:${value}`), setCheckoutStartMessage: value => calls.push(`message:${value}`),
    refreshCheckoutPoints: async () => calls.push('refresh-points'), toast: { error: () => calls.push('error') },
    base44: { functions: { invoke: async (name, payload) => {
      assert.equal(name, 'createPaymentIntent'); assert.equal(payload.mode, 'cancel_reward_checkout');
      assert.equal(payload.checkout_session_id, sessionId); calls.push('cancel');
      if (throwing) throw new Error('provider-uncertain'); return { data: result };
    } } },
  });
  return { calls, ref, key, callback };
}
await test('actual recovery callback releases the checkout lock only after exact cancellation proof', async () => {
  const f = recoveryFixture({ ok: true, checkout_session_expired: true, reward_reservation_released: true });
  await f.callback(); assert.equal(f.key.current, 'new-attempt'); assert.equal(f.ref.current, false);
  assert.deepEqual(f.calls, ['submitting:true', 'cancel', 'forget-attempt', 'recovery:null', 'session:null', 'route:null', 'secret:null', 'order:null',
    'schedule:null', 'locked:false', 'stage:idle', 'message:', 'refresh-points', 'submitting:false']);
});
for (const [name, result, throwing] of [
  ['lost response', null, true], ['no expiry', { ok: true, reward_reservation_released: true }, false],
  ['no release', { ok: true, checkout_session_expired: true }, false], ['success only', { ok: true }, false],
]) await test(`actual recovery callback ${name} keeps the attempt and checkout lock`, async () => {
  const f = recoveryFixture(result, throwing); await f.callback(); assert.equal(f.key.current, 'old-attempt');
  assert.deepEqual(f.calls, ['submitting:true', 'cancel', 'error', 'submitting:false']);
});
await test('actual recovery cancellation ignores duplicate taps', async () => {
  const f = recoveryFixture({ ok: true, checkout_session_expired: true, reward_reservation_released: true });
  await Promise.all([f.callback(), f.callback()]); assert.equal(f.calls.filter(call => call === 'cancel').length, 1);
});
await test('recovery orders link targets the real protected customer history route, not admin orders', () => {
  const node = find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(tree) === 'button'
    && n.children.some(child => ts.isJsxText(child) && child.text.includes('Check my orders')));
  const attribute = node.openingElement.attributes.properties.find(p => p.name?.getText(tree) === 'onClick');
  const calls = []; vm.runInNewContext(`(${attribute.initializer.expression.getText(tree)})`, { navigate: url => calls.push(url) })();
  assert.deepEqual(calls, ['/account/orders']);
  assert.match(fs.readFileSync('src/App.jsx', 'utf8'), /path="\/account\/orders" element=\{<ProtectedRoute element=\{<OrderHistory/);
});
console.log(`Reward embedded checkout: ${count}/${count} passed. Actual components/callbacks, simulated Stripe only; no live iframe/payment claim.`);
