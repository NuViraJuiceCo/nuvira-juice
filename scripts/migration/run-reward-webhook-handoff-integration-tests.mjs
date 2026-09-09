import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSync, transformSync } from 'esbuild';
import { createCompleteRewardHandoffFixture } from './run-reward-complete-handoff-tests.mjs';
import { createRewardSettlementFixture } from './run-no-payment-reward-settlement-tests.mjs';
import { REWARD_HANDOFF_STAGES } from '../../base44/functions/stripeWebhook/rewardHandoff.js';
import { runVerifiedRewardHandoff } from '../../base44/functions/stripeWebhook/rewardHandoffRuntime.js';

// Bundle the real webhook and every local helper. Only SDK/provider transports,
// storage, and native safe-sync planning use synthetic fixtures; no network.
const source = buildSync({ entryPoints: ['base44/functions/stripeWebhook/entry.ts'], bundle: true,
  write: false, format: 'cjs', platform: 'node', target: 'es2022', external: ['npm:*'] }).outputFiles[0].text;
globalThis.fetch = async () => { throw new Error('External network forbidden'); };
const copy = value => structuredClone(value);
function fixture() {
  const handoff = createCompleteRewardHandoffFixture(); const c = handoff.communication;
  const settled = createRewardSettlementFixture({ connected: true });
  const s = settled.session; const order = c.order;
  // Begin with the exact prepared pending order, not an invented settled receipt.
  const oldReceipt = order.reward_settlement; delete order.reward_settlement;
  Object.assign(order, { status: 'pending_payment', payment_status: 'pending', financial_status: 'pending',
    assigned_delivery_window_start: '12:00', assigned_delivery_window_end: '15:00',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    status_history: [{ status: 'pending_payment' }] });
  const data = { ...copy(settled.checkoutData), ...copy(order),
    reward_reservation_id: oldReceipt.reservation_id, checkout_context_hash: oldReceipt.context_hash,
    reward_checkout: { revision: '2026-09-08.reward-checkout-v1', active_reward: { id: 'synthetic_vip' } },
    active_reward: { id: 'synthetic_vip', points_required: 2000 }, points_used: 0,
    credits_discount: 0, total: 0, guest_checkout: false, internal_sandbox_checkout: false };
  const context = { id: 'synthetic_context', customer_email: order.customer_email, order_number: order.order_number,
    stripe_session_id: order.stripe_checkout_session_id, checkout_data: data };
  handoff.native.rows.CheckoutSession.splice(0, Infinity, context);
  settled.rows.Order.splice(0, Infinity, order); settled.rows.CheckoutSession.splice(0, Infinity, context);
  for (const name of ['UserPoints', 'LoyaltyMember', 'LoyaltyTransaction']) {
    c.rows[name] = settled.rows[name]; c.entities[name] = settled.entities[name];
  }
  Object.assign(s, { id: order.stripe_checkout_session_id, customer_email: order.customer_email,
    metadata: { ...s.metadata, customer_email: order.customer_email, order_number: order.order_number,
      reward_reservation_id: oldReceipt.reservation_id, checkout_context_hash: oldReceipt.context_hash,
      bag_return_request_id: order.bag_return_request_id } });
  const account = settled.rows.UserPoints[0]; account.customer_email = order.customer_email;
  account.reward_reservations[0].reservation_id = oldReceipt.reservation_id;
  settled.rows.LoyaltyMember[0].email = order.customer_email;
  const invoke = c.base44.asServiceRole.functions.invoke;
  c.base44.asServiceRole.functions.invoke = async (name, payload) => {
    if (name !== 'enrollNewCustomerInLoyalty') return invoke(name, payload);
    assert.equal(payload.action, 'settle_reward_checkout', 'No cash points, new order, or advertising Purchase');
    assert.equal(payload.internal_secret, 'synthetic-internal');
    const data = await settled.options.settleReservation(payload);
    if (faults.lostLedgerResponse) { faults.lostLedgerResponse = false; throw new Error('Synthetic lost ledger response'); }
    return { data };
  };
  const environment = { LOYALTY_LEDGER_SECRET: 'synthetic-internal', CUSTOMER_APP_SYNC_SECRET: 'synthetic-secret',
    RESEND_API_KEY: 'synthetic-provider-credential', SHOPIFY_STORE_URL: handoff.shopify.config.shopifyStoreUrl,
    SHOPIFY_API_TOKEN: handoff.shopify.config.shopifyApiToken,
    SENDBLUE_API_KEY: 'synthetic-sms-key', SENDBLUE_API_SECRET: 'synthetic-sms-secret', SENDBLUE_PHONE_NUMBER: '+12025550199' };
  const faults = {}; const envReads = [];
  const env = { get: name => { envReads.push(name); return environment[name] || ''; } };
  const fetchImpl = (url, options) => {
    if (url.startsWith('https://api.resend.com/emails/')) return c.fetchEmail(url, options);
    if (url.startsWith('https://api.sendblue.co/api/status?')) return c.fetchStatus(url, options);
    return handoff.shopify.config.fetchShopify(url, options);
  };
  let handler;
  vm.runInNewContext(source, { module: { exports: {} }, exports: {}, Request, Response, URL, TextEncoder,
    crypto: globalThis.crypto, AbortSignal, Date, Intl, structuredClone, setTimeout, clearTimeout,
    fetch: fetchImpl, console: { log() {}, warn() {}, error() {} }, Deno: { env, serve: fn => { handler = fn; } },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => c.base44 };
      if (name.startsWith('npm:stripe')) return class { checkout = settled.options.stripe.checkout;
        webhooks = { constructEventAsync: async raw => {
          if (faults.invalidSignature) throw new Error('Synthetic invalid signature'); return JSON.parse(raw);
        } }; };
      throw new Error(`Unexpected external import ${name}`);
    },
  });
  const run = async (type = 'checkout.session.completed', patch = {}) => {
    settled.event.type = type;
    const event = { ...settled.event, ...patch, data: { object: copy(s) } };
    const response = await handler(new Request('https://synthetic.invalid/webhook', {
      method: 'POST', headers: { 'stripe-signature': 'synthetic-only' }, body: JSON.stringify(event) }));
    return { status: response.status, body: await response.json() };
  };
  return { ...handoff, c, settled, data, s, order, run, faults, environment, env, envReads, fetchImpl };
}
const tests = []; const test = (name, fn) => tests.push([name, fn]);
const count = (f, name) => f.c.calls.filter(call => call === name).length;
function complete(f, result, { expectedAttempts = 1 } = {}) {
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.handoff_complete, true);
  assert.ok(REWARD_HANDOFF_STAGES.every(stage => f.order.reward_handoff.steps[stage].state === 'complete'));
  assert.equal(f.order.reward_handoff_status, 'complete'); assert.equal(f.order.payment_captured, false);
  assert.equal(f.order.total, 0); assert.equal(f.order.stripe_payment_intent_id, undefined);
  const account = f.settled.rows.UserPoints[0]; const member = f.settled.rows.LoyaltyMember[0];
  const transactions = f.settled.rows.LoyaltyTransaction;
  assert.equal(account.total_points, 1000); assert.equal(account.reserved_points, 0);
  assert.equal(account.redeemed_points, 2000); assert.equal(account.points_history.length, 1);
  assert.equal(transactions.length, expectedAttempts);
  const posted = transactions.filter(row => row.status === 'posted');
  assert.equal(posted.length, 1); assert.equal(posted[0].amount, -2000);
  assert.equal(posted[0].id, account.points_history[0].transaction_id);
  assert.equal(transactions.filter(row => row.status === 'voided').length, expectedAttempts - 1);
  for (const key of ['total_points', 'reserved_points', 'redeemed_points', 'points_history', 'points_ledger_revision']) {
    assert.deepEqual(member[key], account[key], `Member projection ${key}`);
  }
  assert.equal(f.native.rows.FulfillmentTask.length, 1); assert.equal(f.native.rows.ShopifyOrder.length, 1);
  assert.equal(f.native.rows.ProductionBatch.reduce((sum, row) => sum + row.planned_units, 0), 6);
  assert.equal(f.shopify.state.creates.length, 1); assert.equal(count(f, 'provider:send'), 1);
  assert.equal(count(f, 'operations:send'), 1);
}
test('actual signed webhook settles and completes all nine real stages without cash or fake purchase', async () => {
  const f = fixture(); complete(f, await f.run());
  assert.equal(f.order.reward_handoff.steps.customer_push.receipt.reason, 'no_eligible_device');
  assert.equal(f.order.reward_handoff.steps.operations_push.receipt.reason, 'no_eligible_device');
  assert.equal(f.order.reward_handoff.steps.sms.receipt.reason, 'no_phone');
  assert.doesNotMatch(JSON.stringify(f.order.reward_handoff), /example\.test|Synthetic Street|credential/);
});
test('duplicate same and different event IDs do not repeat fulfillment or communication', async () => {
  const f = fixture(); complete(f, await f.run());
  complete(f, await f.run()); complete(f, await f.run('checkout.session.completed', { id: 'evt_SYNTHETIC_REDELIVERY' }));
  assert.equal(f.order.status_history.length, 2); assert.equal(f.c.bag.order_id, f.order.id);
});
test('concurrent completion deliveries cannot dispatch a stage twice', async () => {
  const f = fixture(); const results = await Promise.all([f.run(), f.run()]);
  assert.ok(results.every(result => [200, 503].includes(result.status)));
  // Entity creation is not assumed unique. The existing CAS protocol retains
  // one posted debit and voids the losing audit attempt without deleting it.
  complete(f, await f.run(), { expectedAttempts: 2 }); assert.equal(f.order.status_history.length, 2);
});
test('operations loyalty history hides voided/pending attempts and agrees with customer points history', async () => {
  const f = fixture(); await Promise.all([f.run(), f.run()]);
  complete(f, await f.run(), { expectedAttempts: 2 });
  const module = { exports: {} };
  vm.runInNewContext(transformSync(fs.readFileSync('base44/functions/auditCustomerAppLoyaltyAfterPhase2/loyaltyAdmin.ts', 'utf8'),
    { loader: 'ts', format: 'cjs' }).code, { module, exports: module.exports, Response, console });
  f.settled.rows.LoyaltyTransaction.push({ ...copy(f.settled.rows.LoyaltyTransaction[0]), id: 'pending-audit-only', status: 'pending' });
  const entities = Object.fromEntries(['LoyaltyMember', 'UserPoints', 'LoyaltyTransaction', 'UserProfile', 'Order', 'ShopifyOrder', 'POSCustomerClaim']
    .map(name => [name, { list: async () => copy(f.settled.rows[name] || []) }]));
  const response = await module.exports.handleLoyaltyAdminAction({ asServiceRole: { entities } }, { role: 'admin' }, { action: 'list' });
  const result = await response.json(); assert.equal(response.status, 200);
  const member = result.rows.find(row => row.customer_email === f.order.customer_email); assert.ok(member);
  assert.equal(member.recent_transactions.length, 1); assert.equal(member.recent_transactions[0].amount, -2000);
  assert.equal(member.recent_transactions[0].id, f.settled.rows.UserPoints[0].points_history[0].transaction_id);
  assert.equal(member.total_points, 1000); assert.equal(member.redeemed_points, 2000);
  assert.equal(result.summary.total_outstanding_points, 1000);
});
for (const lostAcknowledgement of [false, true]) test(`ledger posting ${lostAcknowledgement ? 'lost acknowledgement' : 'outage'} retries without charging points twice`, async () => {
  const f = fixture(); const entity = f.settled.entities.LoyaltyTransaction;
  const update = entity.update; let interrupted = false;
  entity.update = async (id, patch) => {
    if (patch.status === 'posted' && !interrupted) {
      interrupted = true;
      if (lostAcknowledgement) await update(id, patch);
      throw new Error('Synthetic posting interruption');
    }
    return update(id, patch);
  };
  assert.equal((await f.run()).status, 503); assert.equal(f.native.rows.FulfillmentTask.length, 0);
  assert.equal(f.settled.rows.UserPoints[0].total_points, 1000);
  complete(f, await f.run()); complete(f, await f.run());
});
test('interrupted voiding of a losing concurrent attempt is repaired without removing audit evidence', async () => {
  const f = fixture(); const entity = f.settled.entities.LoyaltyTransaction;
  const update = entity.update; let interrupted = false;
  entity.update = async (id, patch) => {
    if (patch.status === 'voided' && !interrupted) { interrupted = true; throw new Error('Synthetic void interruption'); }
    return update(id, patch);
  };
  await Promise.all([f.run(), f.run()]); assert.equal(interrupted, true);
  complete(f, await f.run(), { expectedAttempts: 2 });
  complete(f, await f.run(), { expectedAttempts: 2 });
});
test('lost ledger acknowledgement recovers a consumed reward before any fulfillment', async () => {
  const f = fixture(); f.faults.lostLedgerResponse = true;
  assert.equal((await f.run()).status, 503); assert.equal(f.native.rows.FulfillmentTask.length, 0);
  assert.equal(f.settled.rows.UserPoints[0].total_points, 1000); complete(f, await f.run());
});
test('eligible customer and staff devices plus opted-in SMS get separate acceptance receipts', async () => {
  const f = fixture(); f.order.contact_phone = '+12025550123'; f.data.contact_phone = f.order.contact_phone;
  f.c.rows.UserProfile.push({ id: 'synthetic_profile', customer_email: f.order.customer_email,
    phone: f.order.contact_phone, sms_consent: true, sms_consent_date: '2026-09-01T12:00:00Z' });
  for (const [i, email] of [f.order.customer_email, 'operations@example.test'].entries()) f.c.rows.PushSubscription.push({
    id: `synthetic_device_${i}`, customer_email: email, token_type: 'web_push', enabled: true,
    endpoint: `https://synthetic.invalid/push/${i}`, p256dh: 'synthetic-key', auth: 'synthetic-auth' });
  complete(f, await f.run()); assert.equal(count(f, 'push:accept'), 2); assert.equal(count(f, 'sms:send'), 1);
  complete(f, await f.run()); assert.equal(count(f, 'push:accept'), 2); assert.equal(count(f, 'sms:send'), 1);
  assert.ok(f.c.rows.CustomerMessageDeliveryLog.filter(row => row.channel === 'push').every(row => !row.delivered_at));
});
for (const [name, setup] of [
  ['invalid signature', f => { f.faults.invalidSignature = true; }],
  ['staging guard', f => { f.environment.NUVIRA_STAGING_SAFE_MODE = 'true'; }],
  ['missing ledger credential', f => { delete f.environment.LOYALTY_LEDGER_SECRET; delete f.environment.CUSTOMER_APP_SYNC_SECRET; }],
  ['unknown version', f => { f.s.metadata.checkout_version = 'future_reward_no_payment'; }],
  ['test event', f => { f.s.livemode = false; f.settled.event.livemode = false; }],
]) test(`${name} stops before settlement, provider or operations work`, async () => {
  const f = fixture(); setup(f); const result = await f.run(); assert.ok([400, 503].includes(result.status));
  assert.equal(f.settled.effects.length, 0); assert.equal(f.c.calls.length, 0);
  assert.equal(f.shopify.state.creates.length, 0); assert.equal(f.order.status, 'pending_payment');
});
for (const status of ['open', 'expired']) test(`unconfirmed ${status} provider state never starts handoff`, async () => {
  const f = fixture(); f.s.status = status; const result = await f.run(); assert.equal(result.status, 503);
  assert.equal(f.c.calls.filter(x => !x.startsWith('read:')).length, 0);
  assert.equal(f.order.status, 'pending_payment'); assert.equal(f.settled.rows.LoyaltyTransaction.length, 0);
});
for (const [key, stage] of [['CUSTOMER_APP_SYNC_SECRET', 'native_operations'], ['SHOPIFY_API_TOKEN', 'shopify_mirror'],
  ['RESEND_API_KEY', 'confirmation_email']]) test(`missing ${key} fails preflight before a dispatch claim and can safely resume`, async () => {
  const f = fixture(); const saved = f.environment[key]; delete f.environment[key];
  const first = await f.run(); assert.equal(first.status, 503); assert.equal(first.body.error, 'reward_checkout_handoff_pending');
  assert.equal(f.order.reward_handoff?.steps?.[stage], undefined);
  f.environment[key] = saved; complete(f, await f.run());
});
test('no eligible SMS recipient requires no SMS credential', async () => {
  const f = fixture(); for (const key of ['SENDBLUE_API_KEY', 'SENDBLUE_API_SECRET', 'SENDBLUE_PHONE_NUMBER']) delete f.environment[key];
  complete(f, await f.run()); assert.equal(count(f, 'sms:send'), 0);
});
test('opted-in SMS missing a credential remains undispatched and resumes after configuration', async () => {
  const f = fixture(); f.order.contact_phone = '+12025550123'; f.data.contact_phone = f.order.contact_phone;
  f.c.rows.UserProfile.push({ id: 'synthetic_profile', customer_email: f.order.customer_email,
    phone: f.order.contact_phone, sms_consent: true, sms_consent_date: '2026-09-01T12:00:00Z' });
  delete f.environment.SENDBLUE_API_SECRET;
  assert.equal((await f.run()).status, 503); assert.equal(f.order.reward_handoff.steps.sms, undefined);
  assert.equal(count(f, 'sms:send'), 0); f.environment.SENDBLUE_API_SECRET = 'synthetic-sms-secret';
  complete(f, await f.run()); assert.equal(count(f, 'sms:send'), 1);
});
for (const [name, stage, setup, recover] of [
  ['native response', 'native_operations', f => { f.native.faults.lostResponse = true; }, f => { f.native.faults.lostResponse = false; }],
  ['Shopify response', 'shopify_mirror', f => { f.shopify.state.faults.lostCreate = true; }, f => { f.shopify.state.faults.lostCreate = false; }],
  ['confirmation response', 'confirmation_email', f => { f.c.faults.lostFunction = 'sendOrderReceivedNotification'; }, f => { delete f.c.faults.lostFunction; }],
]) test(`lost ${name} reconciles existing evidence, never duplicates work`, async () => {
  const f = fixture(); setup(f); assert.equal((await f.run()).status, 503);
  assert.equal(f.order.reward_handoff.steps[stage].state, 'dispatching'); recover(f); complete(f, await f.run());
});
test('unknown email acceptance never resends automatically or reports completion', async () => {
  const f = fixture(); f.c.faults.lostSend = true; assert.equal((await f.run()).status, 503);
  delete f.c.faults.lostSend; assert.equal((await f.run()).status, 503);
  assert.equal(count(f, 'provider:send'), 1); assert.equal(count(f, 'operations:send'), 0);
  assert.equal(f.order.reward_handoff_status, 'review_required');
});
test('provider email with undefined text blocks later customer/staff stages', async () => {
  const f = fixture(); f.c.faults.message = msg => { msg.html += ' undefined '; };
  assert.equal((await f.run()).status, 503); assert.equal(count(f, 'operations:send'), 0);
  assert.equal(f.order.reward_handoff.steps.customer_in_app, undefined);
});
test('terminal order change before native dispatch cannot create production or send confirmation', async () => {
  const f = fixture(); f.native.faults.beforeFetch = () => { f.order.status = 'cancelled'; };
  assert.equal((await f.run()).status, 503); assert.equal(f.native.rows.FulfillmentTask.length, 0);
  assert.equal(count(f, 'provider:send'), 0); assert.equal((await f.run()).status, 503);
  assert.equal(f.order.status, 'cancelled'); assert.equal(f.shopify.state.creates.length, 0);
});
test('partial native projection requires reconciliation rather than creating a duplicate order', async () => {
  const f = fixture(); f.native.faults.lostCreate = 'ShopifyOrder';
  assert.equal((await f.run()).status, 503); delete f.native.faults.lostCreate;
  assert.equal((await f.run()).status, 503); assert.equal(f.native.rows.ShopifyOrder.length, 1);
  assert.equal(f.native.rows.FulfillmentTask.length, 0); assert.equal(f.shopify.state.creates.length, 0);
  assert.equal(count(f, 'provider:send'), 0); assert.equal(f.order.reward_handoff_status, 'review_required');
});
test('webhook acknowledgment waits until the native stage and all later evidence finish', async () => {
  const f = fixture(); const original = f.c.base44.asServiceRole.functions.fetch;
  let release; const wait = new Promise(resolve => { release = resolve; }); let entered = false; let ended = false;
  f.c.base44.asServiceRole.functions.fetch = async (...args) => { entered = true; await wait; return original(...args); };
  const result = f.run().then(value => { ended = true; return value; });
  for (let n = 0; n < 1000 && !entered; n++) await Promise.resolve();
  assert.equal(entered, true); assert.equal(ended, false); assert.equal(count(f, 'provider:send'), 0);
  release(); complete(f, await result);
});
test('expired checkout only releases the reservation without handoff', async () => {
  const f = fixture(); f.s.status = 'expired'; f.s.payment_status = 'unpaid';
  const result = await f.run('checkout.session.expired'); assert.equal(result.status, 200); assert.equal(result.body.expired, true);
  assert.equal(f.order.status, 'cancelled'); assert.equal(f.settled.rows.UserPoints[0].total_points, 3000);
  assert.equal(f.settled.rows.LoyaltyTransaction.length, 0); assert.equal(f.native.rows.FulfillmentTask.length, 0);
  assert.equal(f.shopify.state.creates.length, 0); assert.equal(count(f, 'provider:send'), 0);
});
test('a completed receipt replay needs no provider re-dispatch even when credentials later disappear', async () => {
  const f = fixture(); complete(f, await f.run());
  for (const key of ['CUSTOMER_APP_SYNC_SECRET', 'SHOPIFY_API_TOKEN', 'RESEND_API_KEY']) delete f.environment[key];
  complete(f, await f.run());
});
test('runtime refuses an unsettled order before reading credentials or constructing dispatch', async () => {
  const f = fixture(); await assert.rejects(() => runVerifiedRewardHandoff({ base44: f.c.base44,
    result: { order: f.order }, env: f.env, fetchImpl: f.fetchImpl }), /settlement_required/);
  assert.equal(f.c.calls.length, 0); assert.ok(!f.envReads.includes('SHOPIFY_API_TOKEN'));
});
test('root routes the complete runner only inside the signed reward-event branch', () => {
  const entry = fs.readFileSync('base44/functions/stripeWebhook/entry.ts', 'utf8');
  assert.match(entry, /runHandoff: result => runVerifiedRewardHandoff/); assert.doesNotMatch(entry, /runHandoff: null/);
  assert.ok(entry.indexOf('constructEventAsync') < entry.indexOf('runHandoff: result'));
  assert.ok(entry.indexOf('if (rewardResult) return Response.json') < entry.indexOf("if (event.type === 'checkout.session.completed')"));
  const factory = fs.readFileSync('base44/functions/stripeWebhook/rewardHandoffRuntime.js', 'utf8');
  assert.doesNotMatch(factory, /sendGooglePurchase|sendMetaPurchase|paymentIntents|\.capture\(|\.confirm\(|\.refund/);
});
let passed = 0;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`Reward webhook/handoff integration: ${passed}/${tests.length}; actual local handlers, simulated storage/providers only.`);
