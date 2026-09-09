import assert from 'node:assert/strict';
import * as creditReservation from '../../base44/shared/checkoutCredit.js';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import * as attempt from '../../src/lib/rewardCheckoutAttempt.js';
import * as recovery from '../../src/lib/rewardCheckoutRecovery.js';
import * as noPayment from '../../base44/functions/createPaymentIntent/noPaymentCheckout.js';
import * as rewards from '../../base44/functions/createPaymentIntent/rewardCheckout.js';
import * as offers from '../../base44/functions/createPaymentIntent/firstOrderEligibility.js';

const owner = 'synthetic-user';
const email = 'buyer@example.test';
const attemptKey = 'synthetic-attempt-key-1234567890';
const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(`${email}:${attemptKey}`)))].map(n => n.toString(16).padStart(2, '0')).join('');
const sessionId = 'cs_live_SYNTHETIC';
const orderNumber = `NV-${hash.slice(0, 24).toUpperCase()}`;
const hint = { kind: 'reward_no_payment', checkout_session_id: sessionId, order_number: orderNumber };
function storage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
let count = 0;
async function test(name, run) { await run(); count++; console.log('PASS', name); }
await test('opaque attempt survives reload without saving contact/cart/payment secrets', () => {
  const store = storage();
  const result = attempt.saveRewardCheckoutAttempt(store, owner, attemptKey, 1000);
  assert.deepEqual(attempt.readRewardCheckoutAttempt(store, owner), result);
  assert.deepEqual(Object.keys(result), ['version', 'attempt_key', 'created_at']);
  assert.doesNotMatch(JSON.stringify([...store.values]), /buyer@|client_secret|address|cart|cs_live|pi_/);
});
await test('another account cannot read or clear this account recovery reference', () => {
  const store = storage(); attempt.saveRewardCheckoutAttempt(store, owner, attemptKey);
  assert.equal(attempt.readRewardCheckoutAttempt(store, 'another-user'), null);
  attempt.clearRewardCheckoutAttempt(store, 'another-user', attemptKey);
  assert.equal(attempt.readRewardCheckoutAttempt(store, owner).attempt_key, attemptKey);
});
await test('age does not silently expire a payment hold', () => {
  const store = storage(); attempt.saveRewardCheckoutAttempt(store, owner, attemptKey, 1);
  assert.equal(attempt.readRewardCheckoutAttempt(store, owner).created_at, 1);
});
await test('retry preserves original attempt timestamp; another attempt cannot replace it', () => {
  const store = storage(); attempt.saveRewardCheckoutAttempt(store, owner, attemptKey, 1000);
  attempt.saveRewardCheckoutAttempt(store, owner, attemptKey, 2000);
  assert.equal(attempt.readRewardCheckoutAttempt(store, owner).created_at, 1000);
  assert.throws(() => attempt.saveRewardCheckoutAttempt(store, owner, 'different-attempt-key-1234567890'));
  assert.throws(() => attempt.clearRewardCheckoutAttempt(store, owner, 'different-attempt-key-1234567890'));
  assert.equal(attempt.readRewardCheckoutAttempt(store, owner).attempt_key, attemptKey);
});
await test('confirmed cancellation can remove exactly its own marker', () => {
  const store = storage(); attempt.saveRewardCheckoutAttempt(store, owner, attemptKey);
  assert.equal(attempt.clearRewardCheckoutAttempt(store, owner, attemptKey), true);
  assert.equal(attempt.readRewardCheckoutAttempt(store, owner), null);
});
await test('corrupted or unavailable storage cannot masquerade as no prior attempt', () => {
  const store = storage(); attempt.saveRewardCheckoutAttempt(store, owner, attemptKey);
  const key = [...store.values.keys()][0]; store.values.set(key, '{broken');
  assert.throws(() => attempt.readRewardCheckoutAttempt(store, owner));
  assert.throws(() => attempt.saveRewardCheckoutAttempt({ ...storage(), setItem() {} }, owner, attemptKey));
  assert.throws(() => attempt.clearRewardCheckoutAttempt({ ...store, removeItem() {} }, owner, attemptKey));
});

const compiled = transformSync(fs.readFileSync('base44/functions/createPaymentIntent/entry.ts', 'utf8'), { loader: 'ts', format: 'cjs' }).code;
function backendFixture({ user = { id: owner, email }, balancePatch = {}, holdPatch = {}, sessionPatch = {},
  metadataPatch = {}, duplicateBalance = false, duplicateHold = false, missingHold = false,
  readFailure = false, providerFailure = false } = {}) {
  const calls = [];
  const hold = { reservation_id: `reward:${hash}`, context_hash: 'a'.repeat(64), checkout_session_id: sessionId,
    status: 'held', points: 6000, ...holdPatch };
  const session = { id: sessionId, mode: 'payment', livemode: true, currency: 'usd', amount_total: 0,
    payment_intent: null, status: 'open', payment_status: 'unpaid', customer_email: email,
    client_secret: 'SYNTHETIC_ONLY', metadata: { checkout_version: noPayment.NO_PAYMENT_CHECKOUT_VERSION,
      checkout_mode: 'account', customer_email: email, reward_reservation_id: `reward:${hash}`,
      checkout_context_hash: 'a'.repeat(64), order_number: orderNumber, ...metadataPatch }, ...sessionPatch };
  const stripe = { checkout: { sessions: { retrieve: async id => {
    calls.push('provider.read'); assert.equal(id, sessionId); if (providerFailure) throw new Error('PRIVATE PROVIDER');
    return structuredClone(session);
  } } } };
  const forbidden = () => { throw new Error('External/provider/entity mutation forbidden'); };
  const db = { auth: { me: async () => user }, asServiceRole: { functions: { invoke: forbidden }, entities: {
    UserPoints: { filter: async query => {
      calls.push('ledger.read'); assert.equal(query.customer_email, user.email.trim().toLowerCase());
      if (readFailure) throw new Error('PRIVATE DATABASE');
      const row = { id: 'points-synthetic', customer_email: email,
        reward_reservations: missingHold ? [] : duplicateHold ? [hold, hold] : [hold], ...balancePatch };
      return duplicateBalance ? [row, row] : [row];
    }, updateMany: forbidden, create: forbidden, update: forbidden },
  } } };
  let served; const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Request, Response, URL, URLSearchParams,
    TextEncoder, crypto: globalThis.crypto, console: { log() {}, warn() {}, error() {} }, fetch: forbidden,
    Deno: { env: { get: () => undefined }, serve: fn => { served = fn; } },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db };
      if (name.includes('noPaymentCheckout')) return noPayment;
      if (name.includes('rewardCheckout')) return rewards;
      if (name.includes('checkoutCredit')) return creditReservation;
      if (name.includes('firstOrderEligibility')) return offers;
      if (name.includes('stripe')) return class { constructor() { return stripe; } };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  return { calls, handle: patch => served(new Request('https://unit.test/recovery', { method: 'POST',
    body: JSON.stringify({ mode: 'read_reward_checkout_recovery', checkout_idempotency_key: attemptKey, ...patch }) })) };
}
for (const state of ['open', 'complete', 'expired']) await test(`real handler recovers ${state} identity with read-only provider proof`, async () => {
  const f = backendFixture({ sessionPatch: { status: state, payment_status: state === 'complete' ? 'no_payment_required' : 'unpaid' } });
  const response = await f.handle(); const result = await response.json();
  assert.equal(response.status, 200); assert.equal(result.state, state);
  assert.deepEqual(result.reward_checkout_recovery, hint);
  assert.equal(result.writes_performed, false); assert.equal(result.reward_reservation_released, false);
  assert.doesNotMatch(JSON.stringify(result), /SYNTHETIC_ONLY|buyer@|6000|a{64}|secret/);
  assert.deepEqual(f.calls, ['ledger.read', 'provider.read']);
});
for (const [name, options] of [
  ['missing hold', { missingHold: true }], ['duplicate hold', { duplicateHold: true }],
  ['duplicate account', { duplicateBalance: true }], ['database failure', { readFailure: true }],
  ['wrong account', { user: { id: 'other', email: 'other@example.test' } }],
  ['cash PaymentIntent', { holdPatch: { payment_intent_id: 'pi_synthetic' } }],
  ['bad hold state', { holdPatch: { status: 'unknown' } }], ['bad context', { holdPatch: { context_hash: 'bad' } }],
  ['provider outage', { providerFailure: true }], ['test mode', { sessionPatch: { livemode: false } }],
  ['nonzero amount', { sessionPatch: { amount_total: 100 } }], ['actual cash payment', { sessionPatch: { payment_intent: 'pi_synthetic' } }],
  ['wrong provider email', { sessionPatch: { customer_email: 'other@example.test' } }],
  ['wrong reservation', { metadataPatch: { reward_reservation_id: 'other' } }],
  ['wrong hash', { metadataPatch: { checkout_context_hash: 'b'.repeat(64) } }],
  ['wrong order', { metadataPatch: { order_number: 'NV-OTHER' } }],
  ['test order', { metadataPatch: { is_test_order: 'true' } }],
  ['wrong version', { metadataPatch: { checkout_version: '3.0_embedded' } }],
  ['unpaid completed Session', { sessionPatch: { status: 'complete', payment_status: 'unpaid' } }],
]) await test(`${name} stays unresolved and never authorizes another checkout`, async () => {
  const f = backendFixture(options); const response = await f.handle(); const result = await response.json();
  assert.equal(response.status, 409); assert.equal(result.error_code, 'REWARD_RECOVERY_UNCONFIRMED');
  assert.equal(result.reward_checkout_recovery, undefined); assert.equal(result.reward_reservation_released, false);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|buyer@|SYNTHETIC_ONLY/);
});
await test('anonymous caller is denied before reading ledger or provider', async () => {
  const f = backendFixture({ user: null }); assert.equal((await f.handle()).status, 403); assert.deepEqual(f.calls, []);
});
await test('caller-supplied email and Session cannot override authenticated ownership', async () => {
  const f = backendFixture(); const result = await (await f.handle({ customer_email: 'other@example.test',
    checkout_session_id: 'cs_OTHER' })).json(); assert.deepEqual(result.reward_checkout_recovery, hint);
});

const checkoutSource = fs.readFileSync('src/pages/Checkout.jsx', 'utf8');
const tree = ts.createSourceFile('Checkout.jsx', checkoutSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JSX);
let effect;
let forgetCallback;
let noWriteCallback;
let completedRecoveryCallback;
const visit = node => {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'React.useEffect'
    && node.arguments[0]?.getText(tree).includes("mode: 'read_reward_checkout_recovery'")) effect = node.arguments[0].getText(tree);
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'forgetRewardAttempt') forgetCallback = node.initializer.getText(tree);
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'showExplicitNoWriteCheckoutFailure') noWriteCallback = node.initializer.getText(tree);
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(tree) === 'button'
    && node.children.some(child => ts.isJsxText(child) && child.text.includes('View this reward order'))) {
    completedRecoveryCallback = node.openingElement.attributes.properties.find(p => p.name?.getText(tree) === 'onClick').initializer.expression.getText(tree);
  }
  ts.forEachChild(node, visit);
};
visit(tree); assert.ok(effect, 'actual reload effect exists');
await test('ordinary paid checkout does not depend on new reward storage cleanup', () => {
  const callback = vm.runInNewContext(`(${forgetCallback})`, { rewardAttemptTrackedRef: { current: false },
    clearRewardCheckoutAttempt: () => { throw new Error('must not run'); } });
  assert.doesNotThrow(callback);
});
await test('storage-clear failure after a no-write response is handled without unlocking or uncaught error', () => {
  let unknown = false;
  const callback = vm.runInNewContext(`(${noWriteCallback})`, {
    forgetRewardAttempt: () => { throw new Error('blocked storage'); },
    showAmbiguousCheckoutStartState: () => { unknown = true; },
  });
  assert.doesNotThrow(callback); assert.equal(unknown, true);
});
await test('viewing a recovered completed confirmation clears its cart/marker and opens receipt verification', () => {
  const calls = [];
  const callback = vm.runInNewContext(`(${completedRecoveryCallback})`, {
    clearCart: () => calls.push('clear-cart'), forgetRewardAttempt: () => calls.push('clear-attempt'),
    navigate: url => calls.push(url), encodeURIComponent, rewardCheckoutRecovery: hint,
  });
  callback(); assert.deepEqual(calls, ['clear-cart', 'clear-attempt', `/order-confirmation?order_number=${orderNumber}`]);
});
function frontFixture({ pending = true, state = 'open', failure = false, deferred = false } = {}) {
  const store = storage(); if (pending) attempt.saveRewardCheckoutAttempt(store, owner, attemptKey);
  const calls = []; const key = { current: 'fresh-key' }; let resolve;
  const ownerRef = { current: null }; const trackedRef = { current: false };
  let timeout;
  const waiting = new Promise(done => { resolve = done; });
  const setter = name => value => calls.push([name, value]);
  const callback = vm.runInNewContext(`(${effect})`, { isLoadingAuth: false, user: { id: owner },
    setTimeout: (fn, ms) => { assert.equal(ms, 15000); timeout = fn; return 1; }, clearTimeout: () => {},
    localStorage: store, readRewardCheckoutAttempt: attempt.readRewardCheckoutAttempt,
    rewardRecoveryOwnerRef: ownerRef, rewardAttemptTrackedRef: trackedRef,
    readRewardCheckoutRecovery: recovery.readRewardCheckoutRecovery, checkoutIdempotencyKey: key,
    setRewardCheckoutRecovery: setter('recovery'), setRewardRecoveryState: setter('state'),
    setRewardCheckoutSessionId: setter('session'), setClientSecret: setter('secret'),
    setCheckoutStartLockedSafely: setter('locked'), setCheckoutStartStage: setter('stage'),
    setCheckoutStartMessage: setter('message'), setRewardRecoveryCheckedOwner: setter('checked'),
    CHECKOUT_START_STAGES: { PAYMENT_ATTEMPT_STATE_UNKNOWN: 'unknown' },
    base44: { functions: { invoke: async (name, payload) => {
      calls.push(['invoke', payload]); assert.equal(name, 'createPaymentIntent');
      assert.equal(payload.mode, 'read_reward_checkout_recovery'); assert.equal(payload.checkout_idempotency_key, attemptKey);
      if (deferred) await waiting; if (failure) throw new Error('offline');
      return { data: { ok: true, state, writes_performed: false, reward_checkout_recovery: hint } };
    } } },
  });
  const cleanup = callback();
  const drain = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
  return { calls, key, store, cleanup, drain, callback, ownerRef, trackedRef,
    expire: async () => { timeout(); await drain(); },
    resolve: async () => { resolve(); await drain(); } };
}
await test('fresh checkout without recovery marker does not call any backend', async () => {
  const f = frontFixture({ pending: false }); await f.drain();
  assert.equal(f.calls.some(([name]) => name === 'invoke'), false);
  assert.deepEqual(f.calls.at(-1), ['checked', owner]);
});
await test('same-account auth recheck does not reset an active checkout frame', async () => {
  const f = frontFixture({ pending: false }); await f.drain();
  const before = JSON.stringify(f.calls); f.callback(); await f.drain();
  assert.equal(JSON.stringify(f.calls), before);
});
await test('real reload effect restores opaque identity, locks new attempt and reads current proof', async () => {
  const f = frontFixture(); await f.drain(); assert.equal(f.key.current, attemptKey);
  assert.ok(f.calls.some(([name, value]) => name === 'locked' && value === true));
  assert.deepEqual(f.calls.find(([name, value]) => name === 'recovery' && value)?.[1], hint);
  assert.deepEqual(f.calls.at(-1), ['checked', owner]);
});
await test('completed Session is displayed separately, never automatically claimed fulfilled', async () => {
  const f = frontFixture({ state: 'complete' }); await f.drain();
  assert.ok(f.calls.some(([name, value]) => name === 'state' && value === 'complete'));
  assert.match(checkoutSource, /rewardRecoveryState === 'complete' \? <button/);
  assert.equal(attempt.readRewardCheckoutAttempt(f.store, owner).attempt_key, attemptKey);
});
await test('offline reload keeps the original attempt and offers no new payment', async () => {
  const f = frontFixture({ failure: true }); await f.drain();
  assert.deepEqual(f.calls.filter(([name]) => name === 'locked').at(-1), ['locked', true]);
  assert.equal(attempt.readRewardCheckoutAttempt(f.store, owner).attempt_key, attemptKey);
  assert.ok(f.calls.some(([name, value]) => name === 'message' && value.includes('could not confirm')));
});
await test('late response after leaving/account switch cannot restore old customer state', async () => {
  const f = frontFixture({ deferred: true }); await f.drain(); f.cleanup();
  const before = JSON.stringify(f.calls); await f.resolve(); assert.equal(JSON.stringify(f.calls), before);
});
await test('a stalled recovery request exits loading without declaring the attempt safe to repeat', async () => {
  const f = frontFixture({ deferred: true }); await f.drain(); await f.expire();
  assert.deepEqual(f.calls.at(-1), ['checked', owner]);
  assert.deepEqual(f.calls.filter(([name]) => name === 'locked').at(-1), ['locked', true]);
  const before = JSON.stringify(f.calls); await f.resolve(); assert.equal(JSON.stringify(f.calls), before);
});
await test('source persists before provider invocation and does not redirect an unresolved empty cart', () => {
  const submission = checkoutSource.slice(checkoutSource.indexOf('const handlePlaceOrder = async'));
  const paymentStage = submission.indexOf('paymentAttemptStarted = true;');
  assert.ok(paymentStage >= 0);
  const paymentSubmission = submission.slice(paymentStage);
  assert.ok(paymentSubmission.indexOf('saveRewardCheckoutAttempt(') >= 0);
  assert.ok(paymentSubmission.indexOf('saveRewardCheckoutAttempt(') < paymentSubmission.indexOf("base44.functions.invoke('createPaymentIntent'"));
  assert.ok(submission.indexOf('await verifyCheckoutCatalog(') < paymentStage,
    'The new preflight is read-only; it must never move the real payment before durable recovery storage');
  assert.match(submission, /items.length === 0 && !checkoutStartLocked/);
  assert.match(submission, /forgetRewardAttempt\(\);\s*checkoutIdempotencyKey.current = crypto.randomUUID/);
});
console.log(`Reward reload recovery: ${count}/${count} passed; actual handlers/effect, simulated storage/provider, no production writes.`);
