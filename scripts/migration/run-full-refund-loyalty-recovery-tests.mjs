import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSync, transformSync } from 'esbuild';
import * as ledger from '../../base44/functions/enrollNewCustomerInLoyalty/pointsAccount.js';
import { reconcileFullRefundLoyalty } from '../../base44/functions/stripeWebhook/refundLoyalty.js';

// Actual webhook + central ledger, in-memory CAS and simulated provider reads.
// The Stripe class cannot issue refunds or any other outbound provider write.
const bundle = buildSync({ entryPoints: ['base44/functions/stripeWebhook/entry.ts'], bundle: true,
  write: false, format: 'cjs', platform: 'node', external: ['npm:*'] }).outputFiles[0].text;
const ledgerCode = transformSync(fs.readFileSync('base44/functions/enrollNewCustomerInLoyalty/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code;
const reviewCode = transformSync(fs.readFileSync('base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminOpsAlertsSummary/entry.ts', 'utf8')
  + '\nexport { loadNativeReviewQueue };', { loader: 'ts', format: 'cjs' }).code;
const copy = value => structuredClone(value);
function match(row, query) {
  return Object.entries(query).every(([key, value]) => key === '$or' ? value.some(q => match(row, q))
    : value && typeof value === 'object' && '$exists' in value ? (row[key] !== undefined) === value.$exists : row[key] === value);
}
export async function createRefundFixture({ amount = 4299, multiplier = 1 } = {}) {
  const customerEmail = 'refund-proof@example.test';
  const paymentId = 'pi_synthetic_refund'; const earningKey = `stripe_payment:${paymentId}:earned`;
  const order = { id: 'order_synthetic_refund', order_number: 'NV-SYNTHETIC-REFUND', customer_email: customerEmail,
    stripe_payment_intent_id: paymentId, total: amount / 100, status: 'scheduled_for_juicing',
    payment_status: 'paid', financial_status: 'paid', payment_captured: true, status_history: [],
    items: [{ product_id: 'synthetic-oasis', quantity: 3, price: 13 }] };
  const payment = { id: paymentId, amount, amount_received: amount, status: 'succeeded', currency: 'usd',
    livemode: true, invoice: null, latest_charge: 'ch_synthetic_refund',
    metadata: { customer_email: customerEmail, order_number: order.order_number, checkout_mode: 'account' } };
  const charge = { id: 'ch_synthetic_refund', payment_intent: paymentId, amount, amount_refunded: amount,
    currency: 'usd', paid: true, captured: true, refunded: true, livemode: true,
    refunds: { data: [{ id: 're_synthetic_full', amount, status: 'succeeded' }] } };
  const rows = { Order: [order], UserPoints: [{ id: 'points_synthetic_refund', customer_email: customerEmail,
    total_points: 2000, lifetime_points: 2000, redeemed_points: 0, reserved_points: 0, points_history: [],
    reward_reservations: [], birthday_reservations: [] }],
    LoyaltyMember: [{ id: 'member_synthetic_refund', email: customerEmail, total_points: 2000 }],
    LoyaltyTransaction: [], NuViraCredit: [{ id: 'credit_synthetic', customer_email: customerEmail, balance: 12 }],
    OrderSyncLog: [], OrderReviewQueue: [], Subscription: [] };
  const effects = []; const faults = {}; const entities = {};
  for (const [name, list] of Object.entries(rows)) entities[name] = {
    list: async (_sort, limit) => copy(list.slice(0, limit)),
    filter: async (query, _sort, limit) => {
      if (faults[`${name}.read`]) throw new Error('Synthetic database read failure');
      return copy(list.filter(row => match(row, query)).slice(0, limit));
    },
    create: async data => {
      if (faults[`${name}.create`]) throw new Error('Synthetic create failure');
      if (faults[`${name}.ignoredCreate`]) return { id: 'ignored' };
      const row = { ...copy(data), id: `${name}_${list.length}` };
      list.push(row); effects.push(`${name}.create`);
      if (faults[`${name}.lostCreate`]) { faults[`${name}.lostCreate`] = false; throw new Error('Synthetic lost create acknowledgement'); }
      return copy(row);
    },
    update: async (id, patch) => { const row = list.find(row => row.id === id); assert.ok(row);
      Object.assign(row, copy(patch)); effects.push(`${name}.update`); return copy(row); },
    updateMany: async (query, patch) => {
      if (faults[`${name}.write`]) throw new Error('Synthetic conditional write failure');
      if (name === 'UserPoints' && typeof faults.beforeBalanceMutation === 'function') {
        const mutate = faults.beforeBalanceMutation; delete faults.beforeBalanceMutation; await mutate();
      }
      if (name === 'UserPoints' && faults.raceSpend) {
        faults.raceSpend = false; list[0].total_points = 100; list[0].points_ledger_revision++;
      }
      const selected = list.filter(row => match(row, query)); assert.ok(selected.length <= 1);
      selected.forEach(row => Object.assign(row, copy(patch.$set))); effects.push(`${name}.CAS`);
      if (name === 'UserPoints' && faults.lostReviewCAS && patch.$set.refund_review_holds) {
        faults.lostReviewCAS = false; throw new Error('Synthetic lost review CAS acknowledgement');
      }
      return { success: true, updated: selected.length, has_more: false };
    },
  };
  const provider = { charges: { retrieve: async id => {
    effects.push('stripe.charge.read'); assert.equal(id, charge.id);
    if (faults.provider) throw new Error('Synthetic provider outage'); return copy(charge);
  } }, paymentIntents: { retrieve: async id => {
    effects.push('stripe.payment.read'); assert.equal(id, payment.id); return copy(payment);
  } } };
  let ledgerHandler;
  const quiet = { log() {}, warn() {}, error() {} };
  const env = { get: key => ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'LOYALTY_LEDGER_SECRET', 'CUSTOMER_APP_SYNC_SECRET'].includes(key)
    ? 'synthetic-private-placeholder' : '' };
  const invokeLedger = async payload => {
    effects.push(`ledger.${payload.transaction_type}`);
    if (payload.transaction_type === 'reversal' && faults.post) throw new Error('Synthetic ledger unavailable');
    if (payload.transaction_type === 'reversal' && faults.ignorePost) return { success: true };
    const response = await ledgerHandler(new Request('https://synthetic.invalid/ledger', { method: 'POST',
      body: JSON.stringify({ ...payload, action: 'post', internal_secret: env.get('LOYALTY_LEDGER_SECRET') }) }));
    const body = await response.json();
    if (response.status !== 200) throw new Error(body.error);
    if (payload.transaction_type === 'reversal' && faults.lostPost) { faults.lostPost = false; throw new Error('Synthetic lost reply'); }
    return body;
  };
  const base44 = { auth: { me: async () => null }, asServiceRole: { entities, functions: {
    invoke: async (name, payload) => {
      if (name === 'enrollNewCustomerInLoyalty') return { data: await invokeLedger(payload) };
      assert.equal(name, 'sendOrderReceivedNotification'); assert.equal(payload.refund_notification, true);
      effects.push(name); return { data: { success: false, skipped: true, reason: 'refund_customer_email_disabled' } };
    },
    fetch: async (path, options) => {
      assert.equal(path, '/syncRefundToHub'); assert.equal(JSON.parse(options.body).order_id, order.id);
      effects.push('syncRefundToHub'); return new Response(JSON.stringify({ success: true }));
    },
  } } };
  const module = { exports: {} };
  vm.runInNewContext(ledgerCode, { module, exports: module.exports, Request, Response, Date, console: quiet,
    Deno: { env, serve: handler => { ledgerHandler = handler; } }, require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => base44 };
      if (name.includes('pointsAccount')) return ledger;
      if (name.includes('stripe')) return class {};
      throw new Error(`Unexpected ledger import ${name}`);
    } });
  const reviewModule = { exports: {} };
  vm.runInNewContext(reviewCode, { module: reviewModule, exports: reviewModule.exports, Date, console: quiet,
    Deno: { env, serve() {} }, require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => base44 };
      throw new Error(`Unexpected review reader import ${name}`);
    } });
  const award = Math.floor(amount / 10) * multiplier;
  await invokeLedger({ customer_email: customerEmail, amount: award, transaction_type: 'earned',
    idempotency_key: earningKey, source_id: paymentId, source_type: 'stripe_payment', order_id: order.id,
    metadata: { points_multiplier: multiplier } });
  effects.length = 0;
  let handler;
  vm.runInNewContext(bundle, { module: { exports: {} }, exports: {}, Request, Response, URL, Date,
    console: quiet, crypto: globalThis.crypto, AbortSignal, setTimeout, clearTimeout,
    fetch: async () => { throw new Error('External network forbidden'); },
    Deno: { env, serve: fn => { handler = fn; } }, require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => base44 };
      if (name.includes('stripe')) return class { charges = provider.charges; paymentIntents = provider.paymentIntents;
        webhooks = { constructEventAsync: async raw => { if (faults.signature) throw new Error('Invalid synthetic signature'); return JSON.parse(raw); } }; };
      throw new Error(`Unexpected webhook import ${name}`);
    } });
  const event = { id: 'evt_synthetic_full_refund', type: 'charge.refunded', livemode: true, created: 1788883200,
    data: { object: copy(charge) } };
  const run = async patch => {
    const response = await handler(new Request('https://synthetic.invalid/webhook', { method: 'POST',
      headers: { 'stripe-signature': 'synthetic-only' }, body: JSON.stringify({ ...event, ...patch }) }));
    return { status: response.status, body: await response.json() };
  };
  return { rows, order, entities, payment, charge, provider, event, run, effects, faults, award, customerEmail,
    post: invokeLedger,
    reviewInbox: () => reviewModule.exports.loadNativeReviewQueue(base44, { status: 'open', search: '', limit: 150 }),
    reconcile: () => reconcileFullRefundLoyalty({ entities, stripe: provider, event, order, postLoyalty: invokeLedger }) };
}
const tests = []; const test = (name, fn) => tests.push([name, fn]);
const reversals = f => f.rows.UserPoints[0].points_history.filter(row => row.transaction_type === 'reversal');
function balanced(f) {
  assert.equal(f.rows.UserPoints[0].total_points, 2000); assert.equal(f.rows.UserPoints[0].lifetime_points, 2000);
  assert.equal(f.rows.UserPoints[0].redeemed_points, 0);
  assert.equal(reversals(f).reduce((sum, row) => sum - row.amount, 0), f.award);
  for (const key of ['total_points', 'lifetime_points', 'redeemed_points', 'points_history', 'points_ledger_revision']) {
    assert.deepEqual(f.rows.UserPoints[0][key], f.rows.LoyaltyMember[0][key], key);
  }
  assert.equal(f.rows.NuViraCredit[0].balance, 12);
  assert.equal(f.rows.UserPoints[0].reward_reservations.length, 0);
  assert.equal(f.rows.UserPoints[0].birthday_reservations.length, 0);
}
for (const multiplier of [1, 2]) test(`actual full-refund webhook reverses its recorded ${multiplier}x award once`, async () => {
  const f = await createRefundFixture({ multiplier });
  assert.equal((await f.run()).status, 200); balanced(f); assert.equal(f.order.status, 'refunded');
  assert.equal((await f.run({ id: 'evt_synthetic_same_refund_different_delivery' })).status, 200); balanced(f);
  assert.equal(reversals(f).length, 1); assert.equal(f.effects.filter(x => x === 'syncRefundToHub').length, 1);
});
test('recorded award is used even when current order total was edited', async () => {
  const f = await createRefundFixture({ multiplier: 2 }); f.order.total = 1;
  assert.equal((await f.run()).status, 200); balanced(f);
});
test('refund never restores a redeemed tier, birthday entitlement, credit or another checkout hold', async () => {
  const f = await createRefundFixture(); const account = f.rows.UserPoints[0];
  account.reward_reservations = [
    { reservation_id: 'consumed-tier', context_hash: 'synthetic-consumed', points: 1000, status: 'consumed' },
    { reservation_id: 'another-live-checkout', context_hash: 'synthetic-held', points: 1000, status: 'held' },
  ];
  account.reserved_points = 1000; account.redeemed_points = 1000;
  account.birthday_reservations = [{ reservation_id: 'synthetic-birthday', status: 'consumed', birthday_year: 2026 }];
  const before = copy({ holds: account.reward_reservations, birthday: account.birthday_reservations,
    credits: f.rows.NuViraCredit, redeemed: account.redeemed_points });
  await f.reconcile();
  assert.deepEqual({ holds: account.reward_reservations, birthday: account.birthday_reservations,
    credits: f.rows.NuViraCredit, redeemed: account.redeemed_points }, before);
  assert.equal(account.total_points, 2000); assert.equal(account.reserved_points, 1000);
});
for (const fault of ['post', 'lostPost', 'UserPoints.write', 'LoyaltyMember.write', 'ignorePost']) test(`terminal refund retries recover ${fault} without a second deduction`, async () => {
  const f = await createRefundFixture(); f.faults[fault] = true;
  assert.equal((await f.run()).status, 500); assert.equal(f.order.status, 'refunded');
  f.faults[fault] = false; assert.equal((await f.run()).status, 200); balanced(f);
  assert.equal(reversals(f).length, 1);
});
test('concurrent refund events retain one canonical reversal and void losing audit attempts', async () => {
  const f = await createRefundFixture(); await Promise.all([f.reconcile(), f.reconcile()]); balanced(f);
  assert.equal(reversals(f).length, 1);
  assert.equal(f.rows.LoyaltyTransaction.filter(row => row.transaction_type === 'reversal' && row.status === 'posted').length, 1);
});
test('actual concurrent signed refund callbacks cannot reverse an award twice', async () => {
  const f = await createRefundFixture({ multiplier: 2 });
  const results = await Promise.all([f.run(), f.run({ id: 'evt_synthetic_parallel' })]);
  assert.ok(results.every(result => [200, 500].includes(result.status)));
  assert.equal((await f.run()).status, 200); balanced(f); assert.equal(reversals(f).length, 1);
});
for (const already of [429, 858]) test(`legacy reversal of ${already} points is not debited twice`, async () => {
  const f = await createRefundFixture({ multiplier: 2 });
  await f.post({ customer_email: f.customerEmail, amount: -already, transaction_type: 'reversal', order_id: f.order.id,
    idempotency_key: `stripe_refund_event:evt_synthetic_old:order:${f.order.id}` });
  assert.equal((await f.run()).status, 200); balanced(f);
  assert.equal((await f.run({ id: 'evt_synthetic_another' })).status, 200); balanced(f);
});
for (const [name, mutate] of [
  ['signature failure', f => { f.faults.signature = true; }],
  ['test event', f => { f.event.livemode = false; }],
  ['provider outage', f => { f.faults.provider = true; }],
  ['not fully refunded', f => { f.charge.amount_refunded--; }],
  ['test provider charge', f => { f.charge.livemode = false; }],
  ['foreign provider payment', f => { f.charge.payment_intent = 'pi_FOREIGN'; }],
  ['foreign customer', f => { f.payment.metadata.customer_email = 'foreign@example.test'; }],
  ['foreign order', f => { f.payment.metadata.order_number = 'NV-FOREIGN'; }],
  ['wrong received amount', f => { f.payment.amount_received--; }],
  ['duplicate order', f => { f.rows.Order.push({ ...copy(f.order), id: 'other' }); }],
]) test(`${name} rejects before lifecycle or loyalty writes`, async () => {
  const f = await createRefundFixture(); mutate(f); assert.ok((await f.run()).status >= 400);
  assert.equal(f.order.status, 'scheduled_for_juicing'); assert.equal(reversals(f).length, 0);
  assert.ok(!f.effects.some(effect => /CAS|\.update|\.create|ledger\./.test(effect)));
});
for (const [name, mutate] of [
  ['missing purchase receipt', f => { f.rows.UserPoints[0].points_history = []; }],
  ['duplicate purchase receipt', f => { f.rows.UserPoints[0].points_history.push(copy(f.rows.UserPoints[0].points_history[0])); }],
  ['foreign purchase transaction', f => { f.rows.LoyaltyTransaction[0].customer_email = 'foreign@example.test'; }],
  ['changed receipt amount', f => { f.rows.UserPoints[0].points_history[0].amount++; }],
  ['missing points account', f => { f.rows.UserPoints.splice(0); }],
  ['unknown prior reversal', f => { f.rows.LoyaltyTransaction.push({ id: 'unknown', order_id: f.order.id,
    transaction_type: 'reversal', amount: -5, status: 'posted', customer_email: f.customerEmail, idempotency_key: 'unrecognized' }); }],
]) test(`${name} requires reconciliation and never guesses a debit`, async () => {
  const f = await createRefundFixture(); mutate(f);
  const before = copy(f.rows); await assert.rejects(f.reconcile); assert.deepEqual(f.rows, before);
});
test('legacy over-reversal is flagged without inventing compensating credit', async () => {
  const f = await createRefundFixture();
  await f.post({ customer_email: f.customerEmail, amount: -500, transaction_type: 'reversal', order_id: f.order.id,
    idempotency_key: `stripe_refund_event:evt_synthetic_old:order:${f.order.id}` });
  const before = copy(f.rows); await assert.rejects(f.reconcile, /exceeds_award/); assert.deepEqual(f.rows, before);
});
for (const reserved of [false, true]) test(`${reserved ? 'reserved' : 'spent'} points cannot be silently clamped by a refund`, async () => {
  const f = await createRefundFixture(); const account = f.rows.UserPoints[0];
  if (reserved) {
    account.reserved_points = 2200; account.reward_reservations = [{ reservation_id: 'other-checkout',
      context_hash: 'synthetic-other', points: 2200, status: 'held' }];
  } else account.total_points = 100;
  const before = copy(account); assert.equal((await f.reconcile()).outcome, 'manual_review');
  assert.deepEqual({ ...account, refund_review_holds: undefined, points_ledger_revision: before.points_ledger_revision },
    { ...before, refund_review_holds: undefined });
  assert.equal(account.refund_review_holds.length, 1); assert.equal(reversals(f).length, 0);
  const inbox = await f.reviewInbox(); assert.equal(inbox.summary.open, 1); assert.equal(inbox.summary.refund_related, 1);
  assert.equal(inbox.rows[0].existing_order_number, f.order.order_number);
  assert.match(inbox.rows[0].recommended_action, /Do not refund the money again/);
  assert.equal(inbox.rows[0].incoming_payload, undefined); assert.equal(inbox.safety.writes_performed, false);
});
test('a spend racing the reversal is rechecked inside the central balance CAS', async () => {
  const f = await createRefundFixture(); f.faults.raceSpend = true;
  assert.equal((await f.reconcile()).outcome, 'manual_review'); assert.equal(f.rows.UserPoints[0].total_points, 100);
  assert.equal(reversals(f).length, 0);
});
test('the actual webhook acknowledges durable manual review separately from a points reversal', async () => {
  const f = await createRefundFixture(); f.rows.UserPoints[0].total_points = 100;
  const result = await f.run(); assert.equal(result.status, 200); assert.equal(result.body.loyalty_outcome, 'manual_review');
  assert.equal(f.order.payment_status, 'refunded'); assert.equal((await f.reviewInbox()).summary.open, 1);
  const replay = await f.run(); assert.equal(replay.body.loyalty_outcome, 'manual_review');
  assert.equal(f.rows.OrderReviewQueue.length, 1); assert.equal(reversals(f).length, 0);
});
test('later earnings cannot release a held refund review, including direct ledger retries', async () => {
  const f = await createRefundFixture(); f.rows.UserPoints[0].total_points = 100;
  await f.reconcile(); const debit = copy(f.rows.LoyaltyTransaction.find(row => row.transaction_type === 'reversal'));
  await f.post({ customer_email: f.customerEmail, amount: 2000, transaction_type: 'earned', idempotency_key: 'synthetic_later_purchase' });
  const before = copy(f.rows.UserPoints[0]); assert.equal((await f.reconcile()).outcome, 'manual_review');
  await assert.rejects(() => f.post(debit), /requires_review/);
  assert.deepEqual(f.rows.UserPoints[0], before); assert.equal(reversals(f).length, 0);
});
test('spent award evidence survives replenishment before the first refund callback', async () => {
  const f = await createRefundFixture();
  await f.post({ customer_email: f.customerEmail, amount: -2200, transaction_type: 'redeemed', idempotency_key: 'synthetic_spend' });
  await f.post({ customer_email: f.customerEmail, amount: 2200, transaction_type: 'earned', idempotency_key: 'synthetic_new_purchase' });
  assert.equal((await f.reconcile()).outcome, 'manual_review'); assert.equal(reversals(f).length, 0);
});
test('spending only older points while the full award remains does not force review', async () => {
  const f = await createRefundFixture();
  await f.post({ customer_email: f.customerEmail, amount: -100, transaction_type: 'redeemed', idempotency_key: 'synthetic_older_points' });
  assert.equal((await f.reconcile()).outcome, 'reversed'); assert.equal(reversals(f).length, 1);
  assert.equal(f.rows.UserPoints[0].total_points, 1900);
});
test('an old redemption without balance evidence requires review rather than assuming the award remains', async () => {
  const f = await createRefundFixture();
  await f.post({ customer_email: f.customerEmail, amount: -100, transaction_type: 'redeemed', idempotency_key: 'synthetic_legacy_spend' });
  delete f.rows.UserPoints[0].points_history.at(-1).balanceAfter;
  assert.equal((await f.reconcile()).outcome, 'manual_review'); assert.equal(reversals(f).length, 0);
});
test('refund review latch is an optional explicit field with unchanged admin-only write access', () => {
  const schema = JSON.parse(fs.readFileSync('base44/entities/UserPoints.jsonc', 'utf8'));
  const field = schema.properties.refund_review_holds;
  assert.equal(field.type, 'array'); assert.deepEqual(field.default, []);
  assert.ok(field.items.required.includes('points_to_review')); assert.ok(!schema.required.includes('refund_review_holds'));
  assert.equal(schema.rls.update.user_condition.role, 'admin');
});
for (const fault of ['OrderReviewQueue.create', 'OrderReviewQueue.ignoredCreate', 'OrderReviewQueue.lostCreate', 'OrderReviewQueue.read']) {
  test(`review queue ${fault} failure retries without losing its persistent hold`, async () => {
    const f = await createRefundFixture(); f.rows.UserPoints[0].total_points = 100; f.faults[fault] = true;
    assert.equal((await f.run()).status, 500); assert.equal(f.rows.UserPoints[0].refund_review_holds.length, 1);
    assert.equal(reversals(f).length, 0); f.faults[fault] = false;
    await f.post({ customer_email: f.customerEmail, amount: 1000, transaction_type: 'earned', idempotency_key: 'synthetic_replenish' });
    const result = await f.run(); assert.equal(result.status, 200); assert.equal(result.body.loyalty_outcome, 'manual_review');
    assert.equal(f.rows.OrderReviewQueue.length, 1); assert.equal(reversals(f).length, 0);
  });
}
test('lost review CAS acknowledgement is recovered from persisted proof', async () => {
  const f = await createRefundFixture(); f.rows.UserPoints[0].total_points = 100; f.faults.lostReviewCAS = true;
  assert.equal((await f.reconcile()).outcome, 'manual_review');
  assert.equal(f.rows.UserPoints[0].refund_review_holds.length, 1); assert.equal(f.rows.OrderReviewQueue.length, 1);
});
test('failed review CAS cannot be acknowledged as a successful manual-review handoff', async () => {
  const f = await createRefundFixture(); f.rows.UserPoints[0].total_points = 100; f.faults['UserPoints.write'] = true;
  await assert.rejects(f.reconcile); assert.equal(f.rows.OrderReviewQueue.length, 0);
  assert.equal(f.rows.UserPoints[0].refund_review_holds, undefined);
});
test('concurrent held-refund callbacks converge on one open review and no deductions', async () => {
  const f = await createRefundFixture(); f.rows.UserPoints[0].total_points = 100;
  await Promise.allSettled([f.reconcile(), f.reconcile(), f.reconcile()]);
  assert.equal((await f.reconcile()).outcome, 'manual_review');
  assert.equal(f.rows.UserPoints[0].refund_review_holds.length, 1);
  assert.equal((await f.reviewInbox()).summary.open, 1); assert.equal(reversals(f).length, 0);
});
test('closing an operations review never authorizes an automatic late deduction', async () => {
  const f = await createRefundFixture(); f.rows.UserPoints[0].total_points = 100;
  await f.reconcile(); const review = f.rows.OrderReviewQueue[0];
  Object.assign(review, { status: 'resolved', resolved_action: 'reviewed_by_operator', admin_notes: 'Synthetic review decision' });
  const before = copy(review); f.rows.UserPoints[0].total_points = 5000;
  assert.equal((await f.reconcile()).outcome, 'manual_review'); assert.deepEqual(review, before);
  assert.equal(f.rows.UserPoints[0].total_points, 5000); assert.equal(reversals(f).length, 0);
});
test('a mismatched manual-review projection is not overwritten or accepted as a successful handoff', async () => {
  const f = await createRefundFixture(); f.rows.UserPoints[0].total_points = 100;
  await f.reconcile(); f.rows.OrderReviewQueue[0].existing_order_id = 'different_order';
  const before = copy(f.rows); await assert.rejects(f.reconcile, /queue_identity_conflict/); assert.deepEqual(f.rows, before);
});
test('a corrected award racing a refund cannot debit the old award amount', async () => {
  const f = await createRefundFixture();
  f.faults.beforeBalanceMutation = () => {
    f.rows.UserPoints[0].points_history[0].amount = 100; f.rows.UserPoints[0].points_ledger_revision++;
  };
  await assert.rejects(f.reconcile, /receipt_changed/); assert.equal(reversals(f).length, 0);
});
test('a legacy reversal arriving during CAS cannot be counted twice', async () => {
  const f = await createRefundFixture();
  f.faults.beforeBalanceMutation = () => f.post({ customer_email: f.customerEmail, amount: -50,
    transaction_type: 'reversal', order_id: f.order.id,
    idempotency_key: `stripe_refund_event:evt_synthetic_late_old:order:${f.order.id}` });
  await assert.rejects(f.reconcile, /receipt_changed/);
  assert.equal(reversals(f).length, 1); assert.equal(reversals(f)[0].amount, -50);
});
test('a corrupt posted reversal receipt cannot be accepted on replay', async () => {
  const f = await createRefundFixture(); await f.reconcile();
  reversals(f)[0].transaction_id = 'missing-transaction';
  await assert.rejects(f.reconcile, /receipt_mismatch/);
});
test('partial refund never calls the full-refund reconciler or terminalizes an order', async () => {
  const f = await createRefundFixture(); f.event.data.object.amount_refunded = 100;
  assert.equal((await f.run()).status, 200); assert.equal(f.order.status, 'scheduled_for_juicing');
  assert.equal(reversals(f).length, 0); assert.ok(!f.effects.includes('stripe.charge.read'));
});
if (process.argv[1]?.endsWith('run-full-refund-loyalty-recovery-tests.mjs')) {
  let passed = 0;
  for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
  console.log(`Full-refund loyalty recovery: ${passed}/${tests.length}; simulated providers/storage, no external writes.`);
}
