// Actual customer recovery + signed webhook handlers with synthetic providers.
// Optional --qa also exercises the separately isolated, prepared QA handlers.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qaRoot = path.resolve(root, '../live-checkout-qa-20260929');
const modes = process.argv.includes('--qa') ? [false, true] : [false];
globalThis.fetch = async () => { throw new Error('TEST_NETWORK_FORBIDDEN'); };
const hash = async input => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input)))].map(b => b.toString(16).padStart(2, '0')).join('');
let tests = 0;
const test = async (label, run) => { await run(); tests++; console.log('PASS', label); };
const key = 'cancel-race-synthetic-key-123456';
const token = 'cancel-race-guest-token-123456';
const contextHash = 'a'.repeat(64);
const now = Date.now();
for (const qaMode of modes) {
  const activeRoot = qaMode ? qaRoot : root;
  const QA = qaMode ? (await import(pathToFileURL(path.join(qaRoot, 'base44/shared/qaIsolation.js')))).QA : {};
  const recovery = await import(pathToFileURL(path.join(activeRoot, qaMode
    ? 'base44/shared/qaReleased/functions__createPaymentIntent__paidCheckoutRecovery.js'
    : 'base44/functions/createPaymentIntent/paidCheckoutRecovery.js')));
  const label = qaMode ? 'QA' : 'candidate';
  const email = QA.email || 'buyer@example.test';
  const orderNumber = `NV-${(await hash(`${email}:${key}`)).slice(0, 24).toUpperCase()}`;
  const guestHash = await hash(token);
  const webhookFile = path.join(activeRoot, 'base44/functions/stripeWebhook/entry.ts');
  const compiled = buildSync({ entryPoints: [webhookFile], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['npm:*'] }).outputFiles[0].text;
  function fixture({ guest = true, webhookWins = false, casRace = null, ignoreCAS = false } = {}) {
    const payment = { id: 'pi_SYNTHETIC_CANCEL_RACE', status: 'requires_payment_method', livemode: !qaMode,
      currency: 'usd', amount: 4299, amount_received: 0, metadata: { checkout_version: '3.0_embedded',
        checkout_mode: guest ? 'guest' : 'account', customer_email: email, order_number: orderNumber,
        checkout_context_hash: contextHash, ...(qaMode ? { qa_app_id: QA.appId, qa_run_id: QA.runId } : {}) } };
    const order = { id: 'order_synthetic', order_number: orderNumber, customer_email: email,
      stripe_payment_intent_id: payment.id, total: 42.99, status: 'pending_payment', payment_status: 'pending',
      financial_status: 'pending', payment_captured: false, is_test_order: qaMode, qa_run_id: QA.runId };
    const session = { id: 'session_synthetic', order_number: orderNumber, customer_email: email,
      stripe_session_id: payment.id, expires_at: new Date(now + 3600_000).toISOString(), qa_run_id: QA.runId,
      checkout_data: { order_number: orderNumber, customer_email: email, guest_checkout: guest,
        customer_app_user_id: guest ? undefined : 'user_synthetic', total: 42.99,
        checkout_idempotency_key: key, guest_order_token_hash: guestHash, checkout_context_hash: contextHash,
        paid_recovery_revision: '2026-09-08.paid-checkout-recovery-v1', items: [{ title: 'AURA', price: 13, quantity: 3 }] } };
    const rows = { Order: [order], CheckoutSession: [session], OperationalAlert: [], QASideEffectReceipt: [] };
    const calls = { cancel: 0, retrieve: 0, cas: 0, casWon: 0, unsafeUpdates: 0 };
    const match = (row, query) => Object.entries(query).every(([name, value]) =>
      value && typeof value === 'object' && '$exists' in value ? (row[name] !== undefined) === value.$exists : row[name] === value);
    const entities = Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, {
      filter: async query => structuredClone(values.filter(row => match(row, query))),
      update: async () => { calls.unsafeUpdates++; throw new Error('UNCONDITIONAL_ORDER_UPDATE_FORBIDDEN'); },
      create: async data => { const row = { id: `${name}-${values.length}`, ...structuredClone(data) }; values.push(row); return row; },
      updateMany: async (query, patch) => {
        assert.equal(name, 'Order'); calls.cas++;
        if (calls.cas === 1 && casRace) casRace(order);
        const found = values.filter(row => match(row, query));
        if (!ignoreCAS) { found.forEach(row => Object.assign(row, structuredClone(patch.$set))); calls.casWon += found.length; }
        return { success: true, updated: found.length, has_more: false };
      },
    }]));
    const client = { auth: { me: async () => guest ? null : { id: 'user_synthetic', email } },
      asServiceRole: { entities, functions: { invoke: async () => { throw new Error('UNEXPECTED_SIDE_EFFECT'); } } } };
    let webhook;
    const event = () => ({ id: 'evt_SYNTHETIC_CANCEL_RACE', type: 'payment_intent.canceled', livemode: !qaMode,
      created: Math.floor(now / 1000), data: { object: { ...structuredClone(payment), status: 'canceled' } } });
    const runWebhook = async (payload = event()) => webhook(new Request('https://base44-dispatcher-production.base44.workers.dev/run/qa-function', {
      method: 'POST', headers: { 'base44-app-id': QA.appId || 'synthetic', 'stripe-signature': 'SYNTHETIC_SIGNATURE' }, body: JSON.stringify(payload) }));
    class FakeStripe {
      accounts = { retrieve: async () => ({ id: QA.account }) };
      paymentIntents = {
        retrieve: async () => { calls.retrieve++; return structuredClone(payment); },
        cancel: async () => { calls.cancel++; payment.status = 'canceled';
          if (webhookWins) assert.equal((await runWebhook()).status, 200);
          return structuredClone(payment);
        },
      };
      webhooks = { constructEventAsync: async body => JSON.parse(body) };
    }
    const env = { STRIPE_SECRET_KEY: 'sk_test_SYNTHETIC', STRIPE_PUBLISHABLE_KEY: 'pk_test_SYNTHETIC',
      STRIPE_WEBHOOK_SECRET: 'whsec_SYNTHETIC', BASE44_APP_ID: QA.appId,
      NUVIRA_QA_APP_ID: QA.appId, NUVIRA_QA_STRIPE_ACCOUNT: QA.account, NUVIRA_QA_ORIGIN: QA.origin, NUVIRA_QA_RUN_ID: QA.runId };
    const module = { exports: {} };
    vm.runInNewContext(compiled, { module, exports: module.exports, Request, Response, URL, URLSearchParams, Headers,
      TextEncoder, TextDecoder, crypto, Date, setTimeout, clearTimeout,
      console: { log() {}, warn() {}, error() {} },
      Deno: { env: { get: name => env[name] }, serve: handler => { webhook = handler; } },
      fetch: async () => { throw new Error('TEST_NETWORK_FORBIDDEN'); },
      require: name => name.startsWith('npm:@base44/sdk') ? { createClientFromRequest: () => client }
        : name.startsWith('npm:stripe@') ? FakeStripe : (() => { throw new Error('Unexpected module'); })(),
    }, { filename: webhookFile });
    const options = { base44: client, stripe: new FakeStripe(), user: guest ? null : { id: 'user_synthetic', email }, now,
      body: { mode: 'cancel_paid_checkout', guest_checkout: guest, order_number: orderNumber,
        checkout_idempotency_key: key, ...(guest ? { guest_order_token: token } : {}) } };
    const cancel = () => recovery.cancelPaidCheckout(options);
    const read = () => recovery.recoverPaidCheckout({ ...options, body: { ...options.body, mode: 'read_paid_checkout_recovery' } });
    return { payment, order, session, rows, calls, entities, options, cancel, read, runWebhook };
  }
  const terminal = ctx => {
    assert.equal(ctx.order.status, 'cancelled'); assert.equal(ctx.order.payment_status, 'cancelled');
    assert.equal(ctx.order.financial_status, 'cancelled'); assert.equal(ctx.order.payment_captured, false);
    assert.equal(ctx.order.do_not_recover, true); assert.equal(ctx.order.abandoned_checkout, true);
    assert.equal(ctx.calls.unsafeUpdates, 0); assert.equal(ctx.rows.Order.length, 1);
  };
  const alertCount = ctx => qaMode ? ctx.rows.QASideEffectReceipt.filter(row => row.operation === 'OperationalAlert.create').length : ctx.rows.OperationalAlert.length;
  for (const webhookWins of [false, true]) await test(`${label} ${webhookWins ? 'webhook-first' : 'request-first'} cancellation and replay converge`, async () => {
    const ctx = fixture({ webhookWins }); assert.equal((await ctx.cancel()).ok, true); terminal(ctx);
    const before = JSON.stringify(ctx.rows);
    assert.equal((await ctx.runWebhook()).status, 200); assert.equal((await ctx.cancel()).ok, true);
    assert.equal(JSON.stringify(ctx.rows), before); assert.equal(ctx.calls.casWon, 1); assert.equal(ctx.calls.cancel, 1);
    assert.equal(alertCount(ctx), webhookWins ? 1 : 0);
  });
  await test(`${label} legacy hybrid is read-only until explicit cancel, then repaired without provider re-cancel`, async () => {
    const ctx = fixture(); ctx.payment.status = 'canceled'; ctx.order.status = 'cancelled';
    const before = JSON.stringify(ctx.rows); assert.equal((await ctx.read()).state, 'canceled');
    assert.equal(JSON.stringify(ctx.rows), before); assert.equal(ctx.calls.cas, 0);
    assert.equal((await ctx.cancel()).ok, true); terminal(ctx); assert.equal(ctx.calls.cancel, 0);
    assert.equal((await ctx.cancel()).ok, true); assert.equal(ctx.calls.casWon, 1);
  });
  await test(`${label} webhook independently repairs historical hybrid and replay is idempotent`, async () => {
    const ctx = fixture(); ctx.payment.status = 'canceled'; ctx.order.status = 'cancelled';
    assert.equal((await ctx.runWebhook()).status, 200); terminal(ctx);
    const before = JSON.stringify(ctx.rows); assert.equal((await ctx.runWebhook()).status, 200);
    assert.equal(JSON.stringify(ctx.rows), before); assert.equal(ctx.calls.casWon, 1);
  });
  await test(`${label} concurrent cancel requests + webhook use one terminal transition`, async () => {
    const ctx = fixture(); ctx.payment.status = 'canceled';
    const results = await Promise.all([ctx.cancel(), ctx.cancel(), ctx.runWebhook(), ctx.runWebhook()]);
    assert.equal(results[0].ok, true); assert.equal(results[1].ok, true);
    assert.equal(results[2].status, 200); assert.equal(results[3].status, 200);
    terminal(ctx); assert.equal(ctx.calls.casWon, 1); assert.ok(alertCount(ctx) <= 1);
    assert.equal(ctx.order.status_history.length, 1);
  });
  await test(`${label} in-flight old webhook losing CAS is reread and repaired`, async () => {
    const ctx = fixture({ casRace: row => { row.status = 'cancelled'; } });
    assert.equal((await ctx.cancel()).ok, true); terminal(ctx); assert.equal(ctx.calls.cas, 2);
  });
  await test(`${label} false CAS acknowledgment cannot clear recovery`, async () => {
    const ctx = fixture({ ignoreCAS: true }); await assert.rejects(ctx.cancel, /unconfirmed/);
    assert.equal(ctx.order.payment_status, 'pending'); assert.equal(ctx.calls.cas, 2);
  });
  await test(`${label} concurrent audit history is preserved through revision-guarded CAS`, async () => {
    const note = { status: 'pending_payment', message: 'Concurrent admin note' };
    const ctx = fixture({ casRace: row => { row.updated_date = 'newer'; row.status_history = [note]; } });
    ctx.order.updated_date = 'older';
    assert.equal((await ctx.cancel()).ok, true); terminal(ctx);
    assert.equal(ctx.calls.cas, 2); assert.equal(ctx.order.status_history[0].message, note.message);
    assert.equal(ctx.order.status_history.length, 2);
  });
  for (const patch of [
    { status: 'paid', payment_status: 'paid', financial_status: 'paid', payment_captured: true },
    { refund_amount: 1 }, { amount_refunded: 1 }, { stripe_refund_id: 're_SYNTHETIC' }, { refund_status: 'partially_refunded' },
  ]) await test(`${label} concurrent paid/refund mutation wins safely ${JSON.stringify(patch)}`, async () => {
    const ctx = fixture({ casRace: row => Object.assign(row, patch) });
    await assert.rejects(ctx.cancel, /unconfirmed/);
    for (const [key, value] of Object.entries(patch)) assert.equal(ctx.order[key], value);
    assert.equal(ctx.calls.casWon, 0);
  });
  for (const [name, mutate] of [
    ['wrong guest token', ctx => { ctx.options.body.guest_order_token = 'incorrect-guest-token-123456789'; }],
    ['wrong attempt', ctx => { ctx.options.body.checkout_idempotency_key = 'incorrect-attempt-123456789'; }],
    ['expired guest', ctx => { ctx.session.expires_at = '2020-01-01T00:00:00Z'; }],
    ['foreign order owner', ctx => { ctx.order.customer_email = 'other@example.test'; }],
    ['foreign session owner', ctx => { ctx.session.customer_email = 'other@example.test'; }],
    ['foreign provider owner', ctx => { ctx.payment.metadata.customer_email = 'other@example.test'; }],
    ['wrong context', ctx => { ctx.payment.metadata.checkout_context_hash = 'b'.repeat(64); }],
    ['missing context', ctx => { delete ctx.payment.metadata.checkout_context_hash; }],
    ['missing session', ctx => { ctx.rows.CheckoutSession.length = 0; }],
    ['wrong provider mode', ctx => { ctx.payment.livemode = qaMode; }],
    ['wrong currency', ctx => { ctx.payment.currency = 'eur'; }],
    ['wrong amount', ctx => { ctx.payment.amount++; }],
    ['duplicate order', ctx => { ctx.rows.Order.push({ ...structuredClone(ctx.order), id: 'duplicate' }); }],
    ['duplicate session', ctx => { ctx.rows.CheckoutSession.push({ ...structuredClone(ctx.session), id: 'duplicate' }); }],
    ['captured', ctx => { ctx.order.payment_captured = true; }],
    ['paid', ctx => { ctx.order.payment_status = 'paid'; }],
    ['refunded', ctx => { ctx.order.financial_status = 'refunded'; }],
    ['partial refund', ctx => { ctx.order.payment_status = 'partially_refunded'; }],
    ['refund amount', ctx => { ctx.order.refund_amount = 1; }],
    ['canceled but money received', ctx => { ctx.payment.amount_received = 1; }],
  ]) await test(`${label} ${name} cannot authorize cancellation`, async () => {
    const ctx = fixture(); ctx.payment.status = 'canceled'; mutate(ctx);
    const before = JSON.stringify(ctx.rows); await assert.rejects(ctx.cancel);
    assert.equal(JSON.stringify(ctx.rows), before); assert.equal(ctx.calls.cancel, 0); assert.equal(ctx.calls.cas, 0);
  });
  for (const field of ['refund_amount', 'amount_refunded']) await test(`${label} resumable intent with ${field} blocks before provider cancellation`, async () => {
    const ctx = fixture(); ctx.order[field] = 1;
    await assert.rejects(ctx.cancel); assert.equal(ctx.calls.cancel, 0); assert.equal(ctx.calls.cas, 0);
    assert.equal(ctx.payment.status, 'requires_payment_method');
  });
  for (const status of ['succeeded', 'processing', 'requires_capture', 'requires_payment_method']) await test(`${label} stale canceled event cannot overwrite fresh provider ${status}`, async () => {
    const ctx = fixture(); ctx.payment.status = status;
    if (status === 'succeeded') ctx.payment.amount_received = ctx.payment.amount;
    const before = JSON.stringify(ctx.rows); assert.equal((await ctx.runWebhook()).status, 500);
    assert.equal(JSON.stringify(ctx.rows), before); assert.equal(ctx.calls.cas, 0);
    if (status !== 'requires_payment_method') await assert.rejects(ctx.cancel);
  });
  for (const [name, mutate] of [
    ['foreign order', ctx => { ctx.order.customer_email = 'other@example.test'; }],
    ['missing context', ctx => { delete ctx.payment.metadata.checkout_context_hash; }],
    ['missing session', ctx => { ctx.rows.CheckoutSession.length = 0; }],
    ['wrong provider mode', ctx => { ctx.payment.livemode = qaMode; }],
    ['wrong currency', ctx => { ctx.payment.currency = 'eur'; }],
    ['wrong amount', ctx => { ctx.payment.amount++; }],
    ['duplicate order', ctx => { ctx.rows.Order.push({ ...structuredClone(ctx.order), id: 'duplicate' }); }],
    ['duplicate session', ctx => { ctx.rows.CheckoutSession.push({ ...structuredClone(ctx.session), id: 'duplicate' }); }],
    ['paid row', ctx => { ctx.order.payment_status = 'paid'; }],
    ['partial refund', ctx => { ctx.order.refund_status = 'partially_refunded'; }],
  ]) await test(`${label} webhook refuses ${name} without writes`, async () => {
    const ctx = fixture(); ctx.payment.status = 'canceled'; mutate(ctx);
    const before = JSON.stringify(ctx.rows);
    // QA rejects wrong-mode/currency events at its additional isolation boundary.
    assert.equal((await ctx.runWebhook()).status, qaMode && ['wrong provider mode', 'wrong currency'].includes(name) ? 400 : 500);
    assert.equal(JSON.stringify(ctx.rows), before); assert.equal(ctx.calls.cas, 0);
  });
  if (!qaMode) await test('candidate authenticated owner cancellation works; foreign account cannot cancel', async () => {
    const ctx = fixture({ guest: false }); ctx.options.user.id = 'foreign';
    await assert.rejects(ctx.cancel); assert.equal(ctx.calls.cancel, 0);
    ctx.options.user.id = 'user_synthetic'; assert.equal((await ctx.cancel()).ok, true); terminal(ctx);
  });
  await test(`${label} terminal contract states are allowed by Order schema`, () => {
    const schema = JSON.parse(fs.readFileSync(path.join(activeRoot, 'base44/entities/Order.jsonc'), 'utf8'));
    for (const field of ['status', 'financial_status', 'payment_status']) assert.ok(schema.properties[field].enum.includes('cancelled'));
  });
}
console.log(JSON.stringify({ ok: true, tests, provider_calls: 0, live_writes: 0, actual_handlers: true }));
