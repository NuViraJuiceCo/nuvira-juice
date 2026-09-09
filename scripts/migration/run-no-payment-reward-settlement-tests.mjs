import assert from 'node:assert/strict';
import * as creditReservation from '../../base44/shared/checkoutCredit.js';
import * as birthdayCheckout from '../../base44/functions/createPaymentIntent/birthdayCheckout.js';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { transformSync } from 'esbuild';
import { finalizeNoPaymentRewardOrder, expireNoPaymentRewardOrder, isVerifiedNoPaymentOrder } from '../../base44/functions/stripeWebhook/rewardSettlement.js';
import * as rewardWebhook from '../../base44/functions/stripeWebhook/rewardWebhook.js';
import * as benefits from '../../base44/functions/stripeWebhook/paymentBenefits.js';
import * as ledger from '../../base44/functions/enrollNewCustomerInLoyalty/pointsAccount.js';

// All Stripe, database and downstream surfaces are synthetic and in-memory.
// No network, credentials, provider events, customer/order writes or safety logs.
const root = 'base44/functions/';
const read = file => fs.readFileSync(file, 'utf8');
function declaration(source, name) {
  const tree = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name);
  assert.ok(node, name); return node.getText(tree).replace(/^export /, '');
}
const canonical = declaration(read(`${root}stripeWebhook/rewardSettlement.js`), 'isVerifiedNoPaymentOrder');
const consumers = [
  'syncOrderToHub/entry.ts', 'syncHubDeliveryStatuses/entry.ts',
  'getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle/entry.ts',
  'getAdminOperationsDashboardSummary/handlers/monitorPostPaymentChain/entry.ts',
  'getAdminOperationsDashboardSummary/handlers/getAdminOrdersWithHub/entry.ts',
  'getAdminOperationsDashboardSummary/handlers/previewNativeProductionBatchLifecycle/entry.ts',
  'getCustomerOrderDetail/entry.ts',
  'getCustomerAccountDashboardData/handlers/getCustomerOrderDetail/entry.ts',
  'getCustomerAccountDashboardData/handlers/getCustomerAccountDashboardData/entry.ts',
];
const tests = []; const test = (name, fn) => tests.push([name, fn]);
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(clause => matches(row, clause));
    if (value && typeof value === 'object') {
      if ('$exists' in value) return (row[key] !== undefined) === value.$exists;
      if ('$ne' in value) return row[key] !== value.$ne;
      throw new Error(`Unexpected query ${key}`);
    }
    return row[key] === value;
  });
}
const email = 'reward-settlement@example.test';
const ledgerSource = transformSync(read(`${root}enrollNewCustomerInLoyalty/entry.ts`), { loader: 'ts', format: 'cjs' }).code;
function fixture({ connected = false } = {}) {
  const schedule = { assigned_delivery_date: '2026-09-12', assigned_production_day: '2026-09-11',
    assigned_delivery_window_start: '12:00', assigned_delivery_window_end: '15:00', delivery_window_label: 'Saturday 12 PM - 3 PM' };
  const session = { id: 'cs_live_SYNTHETIC', livemode: true, currency: 'usd', mode: 'payment',
    status: 'complete', payment_status: 'no_payment_required', payment_intent: null, amount_total: 0,
    customer_email: email, metadata: { checkout_version: '4.0_reward_no_payment', checkout_mode: 'account',
      customer_email: email, order_number: 'NV-SYNTHETIC', reward_reservation_id: 'synthetic-reservation',
      checkout_context_hash: 'a'.repeat(64) } };
  const order = { id: 'synthetic-order', customer_email: email, order_number: session.metadata.order_number,
    stripe_checkout_session_id: session.id, payment_captured: false, total: 0,
    status: 'pending_payment', payment_status: 'pending', financial_status: 'pending', is_test_order: false,
    items: [{ product_id: 'synthetic-oasis', title: 'OASIS', quantity: 6, price: 0, catalog_unit_price: 13 }],
    ...schedule, status_history: [{ status: 'pending_payment' }], updated_date: '2026-09-08T08:00:00Z' };
  const checkoutData = { customer_email: email, order_number: order.order_number, total: 0,
    items: structuredClone(order.items), ...schedule, checkout_context_hash: session.metadata.checkout_context_hash,
    reward_reservation_id: session.metadata.reward_reservation_id, reward_reservation_points: 2000,
    points_used: 0, credits_discount: 0, active_reward: { id: 'synthetic-vip', points_required: 2000 },
    reward_checkout: { revision: '2026-09-08.reward-checkout-v1', active_reward: { id: 'synthetic-vip' } } };
  const rows = { Order: [order], CheckoutSession: [{ id: 'synthetic-context', stripe_session_id: session.id,
    customer_email: email, order_number: order.order_number, checkout_data: checkoutData }],
    UserPoints: [{ id: 'synthetic-points', customer_email: email, total_points: 3000, lifetime_points: 3000,
      redeemed_points: 0, reserved_points: 2000, points_ledger_revision: 1, points_history: [],
      reward_reservations: [{ reservation_id: session.metadata.reward_reservation_id,
        checkout_session_id: session.id, points: 2000, context_hash: session.metadata.checkout_context_hash, status: 'held' }] }],
    LoyaltyMember: [{ id: 'synthetic-member', email, total_points: 3000, reserved_points: 2000 }], LoyaltyTransaction: [] };
  const effects = []; const faults = {}; const entities = {};
  for (const [name, list] of Object.entries(rows)) entities[name] = {
    filter: async query => { if (faults[`${name}.read`]) throw new Error('synthetic_read_failure');
      return structuredClone(list.filter(row => matches(row, query))); },
    create: async data => { effects.push(`${name}.create`); assert.equal(name, 'LoyaltyTransaction');
      const row = { ...structuredClone(data), id: `synthetic-tx-${list.length}` }; list.push(row); return structuredClone(row); },
    update: async (id, data) => { effects.push(`${name}.update`); assert.notEqual(name, 'Order');
      const row = list.find(r => r.id === id); assert.ok(row); Object.assign(row, structuredClone(data)); return structuredClone(row); },
    updateMany: async (query, patch) => {
      if (faults[`${name}.write`]) throw new Error('synthetic_write_failure');
      if (name === 'Order' && faults.raceCancel) Object.assign(order, { status: 'cancelled', do_not_recover: true });
      if (name === 'Order' && faults.raceHistory) { order.updated_date = '2026-09-08T08:00:01Z'; order.status_history.push({ message: 'Other actor' }); }
      const selected = list.filter(row => matches(row, query)); assert.ok(selected.length <= 1);
      selected.forEach(row => Object.assign(row, structuredClone(patch.$set))); effects.push(`${name}.cas`);
      if (name === 'Order' && faults.lostOrderResponse) { faults.lostOrderResponse = false; throw new Error('synthetic_lost_write_response'); }
      return faults.badCas && name === 'Order' ? { success: true, updated: 2, has_more: true }
        : { success: true, updated: selected.length, has_more: false };
    },
  };
  const stripe = { checkout: { sessions: { retrieve: async id => {
    assert.equal(id, session.id); effects.push('stripe.retrieve');
    if (faults.provider) throw new Error('synthetic_provider_outage');
    return structuredClone(session);
  } } } };
  let ledgerHandler;
  if (connected) {
    const module = { exports: {} };
    vm.runInNewContext(ledgerSource, { module, exports: module.exports, Request, Response, Date,
      console: { log() {}, warn() {}, error() {} },
      Deno: { serve: fn => { ledgerHandler = fn; }, env: { get: name => name === 'STRIPE_SECRET_KEY'
        ? 'synthetic-stripe' : name === 'LOYALTY_LEDGER_SECRET' ? 'synthetic-internal' : undefined } },
      require: name => {
        if (name.includes('@base44/sdk')) return { createClientFromRequest: () => ({ auth: { me: async () => null }, asServiceRole: { entities } }) };
        if (name.includes('pointsAccount')) return ledger;
        if (name.includes('stripe')) return class { checkout = stripe.checkout; };
        throw new Error(`Unexpected import ${name}`);
      },
    });
  }
  const event = { id: 'evt_SYNTHETIC', type: 'checkout.session.completed', livemode: true,
    created: 1788854400, data: { object: structuredClone(session) } };
  const options = { entities, stripe, event,
      verifySchedule: () => faults.schedule ? null : structuredClone(schedule),
      settleReservation: async payload => {
        effects.push('loyalty.settle'); assert.equal(payload.stripe_checkout_session_id, session.id);
        assert.equal(payload.stripe_payment_intent_id, undefined);
        if (faults.ledger) throw new Error('synthetic_ledger_outage');
        if (faults.ledgerPending) return { success: true, reservation_status: 'held' };
        if (ledgerHandler) {
          const response = await ledgerHandler(new Request('https://test.invalid/ledger', { method: 'POST', body: JSON.stringify({
            ...payload, action: 'settle_reward_checkout', internal_secret: 'synthetic-internal' }) }));
          const data = await response.json(); assert.equal(response.status, 200, JSON.stringify(data)); return data;
        }
        return { success: true, reservation_status: event.type === 'checkout.session.expired' ? 'released' : 'consumed' };
      },
    };
  return { order, session, checkoutData, rows, faults, effects, entities, event, options,
    run: async () => event.type === 'checkout.session.expired'
      ? expireNoPaymentRewardOrder(options) : finalizeNoPaymentRewardOrder(options) };
}

test('Real settlement source promotes exact six-bottle reward without claiming a card capture', async () => {
  const f = fixture(); const r = await f.run(); assert.equal(r.idempotent, false);
  assert.equal(f.order.status, 'scheduled_for_juicing'); assert.equal(f.order.payment_captured, false);
  assert.equal(f.order.payment_status, 'paid'); assert.equal(f.order.financial_status, 'paid');
  assert.equal(f.order.total, 0); assert.equal(f.order.items[0].quantity, 6); assert.equal(f.order.reward_handoff_status, 'pending');
  assert.equal(isVerifiedNoPaymentOrder(f.order), true); assert.equal(f.order.stripe_payment_intent_id, undefined);
  assert.deepEqual(f.effects, ['stripe.retrieve', 'loyalty.settle', 'Order.cas']);
});
for (const [name, patch] of Object.entries({
  'nonzero cash amount': { amount_total: 1 }, 'negative total': { amount_total: -1 },
  'PaymentIntent present': { payment_intent: 'pi_actual' }, 'unpaid Session': { payment_status: 'unpaid' },
  'ordinary paid Session': { payment_status: 'paid' }, 'open Session': { status: 'open' },
  'expired Session': { status: 'expired' }, 'test mode': { livemode: false },
  'non-USD currency': { currency: 'eur' }, 'subscription Session': { mode: 'subscription' },
  'wrong customer': { customer_email: 'other@example.test' }, 'changed collected email': { customer_details: { email: 'other@example.test' } },
})) test(`Reject ${name} before any settlement write`, async () => {
  const f = fixture(); Object.assign(f.session, patch); await assert.rejects(f.run);
  assert.deepEqual(f.effects, ['stripe.retrieve']); assert.equal(f.order.status, 'pending_payment');
});
for (const field of ['checkout_context_hash', 'customer_email', 'order_number', 'reward_reservation_id', 'checkout_version']) {
  test(`Signed event/current provider ${field} mismatch cannot settle`, async () => {
    const f = fixture(); f.event.data.object.metadata[field] = 'different'; await assert.rejects(f.run);
    assert.ok(!f.effects.includes('loyalty.settle'));
  });
}
for (const entity of ['Order', 'CheckoutSession']) {
  for (const variant of ['missing', 'duplicate', 'read_failure']) test(`${entity} ${variant} does not reconstruct an order from metadata`, async () => {
    const f = fixture();
    if (variant === 'missing') f.rows[entity].splice(0);
    if (variant === 'duplicate') f.rows[entity].push(structuredClone(f.rows[entity][0]));
    if (variant === 'read_failure') f.faults[`${entity}.read`] = true;
    await assert.rejects(f.run); assert.ok(!f.effects.includes('loyalty.settle'));
  });
}
for (const [name, mutate] of [
  ['changed items', f => { f.order.items[0].quantity = 7; }],
  ['foreign checkout', f => { f.checkoutData.customer_email = 'someone@example.test'; }],
  ['wrong reservation', f => { f.checkoutData.reward_reservation_id = 'wrong'; }],
  ['wrong points', f => { f.checkoutData.reward_reservation_points = 2001; }],
  ['different reward', f => { f.checkoutData.active_reward.id = 'wrong'; }],
  ['unreserved credit', f => { f.checkoutData.credits_discount = 3.99; }],
  ['wrong amount', f => { f.checkoutData.total = 0.01; }],
  ['changed delivery choice', f => { f.order.assigned_delivery_date = '2026-09-16'; }],
  ['missing schedule', f => { f.faults.schedule = true; }],
  ['captured cash', f => { f.order.payment_captured = true; }],
  ['ambiguous provider', f => { f.order.stripe_payment_intent_id = 'pi_other'; }],
  ['guest reward', f => { f.checkoutData.guest_checkout = true; }],
  ['test order', f => { f.order.is_test_order = true; }],
  ['cancelled order', f => { f.order.status = 'cancelled'; }],
  ['refunded order', f => { f.order.payment_status = 'refunded'; }],
  ['abandoned order', f => { f.order.is_abandoned_checkout = true; }],
  ['missing conditional updates', f => { delete f.entities.Order.updateMany; }],
]) test(`${name} blocks before points or order settlement`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(f.run); assert.ok(!f.effects.includes('loyalty.settle'));
});
test('Unconfirmed ledger consumption cannot activate the order', async () => {
  for (const fault of ['ledger', 'ledgerPending']) {
    const f = fixture(); f.faults[fault] = true; await assert.rejects(f.run);
    assert.equal(f.order.status, 'pending_payment'); assert.ok(!f.effects.includes('Order.cas'));
  }
});
test('Duplicate completion does not append history or overwrite current production status', async () => {
  const f = fixture(); await f.run(); f.order.status = 'in_production';
  const receipt = structuredClone(f.order.reward_settlement); f.event.id = 'evt_ANOTHER';
  const r = await f.run(); assert.equal(r.idempotent, true); assert.equal(f.order.status, 'in_production');
  assert.deepEqual(f.order.reward_settlement, receipt); assert.equal(f.order.status_history.length, 2);
  assert.equal(f.effects.filter(x => x === 'Order.cas').length, 1);
});
test('Conflicting existing settlement receipt cannot be replaced', async () => {
  const f = fixture(); await f.run(); f.order.reward_settlement.reservation_id = 'other';
  const before = structuredClone(f.rows); await assert.rejects(f.run, /receipt_conflict/); assert.deepEqual(f.rows, before);
});
for (const fault of ['raceCancel', 'raceHistory', 'badCas']) test(`${fault} cannot report successful finalization`, async () => {
  const f = fixture(); f.faults[fault] = true; await assert.rejects(f.run);
  if (fault === 'raceCancel') assert.equal(f.order.status, 'cancelled');
  if (fault === 'raceHistory') { assert.equal(f.order.status, 'pending_payment'); assert.equal(f.order.status_history.at(-1).message, 'Other actor'); }
});
test('Connected real finalizer and real central ledger consume once and preserve member projection', async () => {
  const f = fixture({ connected: true }); await f.run(); await f.run();
  const points = f.rows.UserPoints[0]; assert.equal(points.total_points, 1000); assert.equal(points.reserved_points, 0);
  assert.equal(points.lifetime_points, 3000); assert.equal(points.redeemed_points, 2000);
  assert.equal(f.rows.LoyaltyMember[0].total_points, 1000); assert.equal(f.rows.LoyaltyMember[0].reserved_points, 0);
  assert.equal(f.rows.LoyaltyTransaction.length, 1); assert.equal(f.rows.LoyaltyTransaction[0].status, 'posted');
  assert.equal(f.rows.LoyaltyTransaction[0].transaction_type, 'redeemed');
  assert.equal(f.rows.LoyaltyTransaction[0].idempotency_key, `stripe_checkout:${f.session.id}:redeemed`);
  assert.equal(f.order.payment_captured, false); assert.equal(f.order.status_history.length, 2);
});
for (const fault of ['Order.write', 'LoyaltyMember.write', 'lostOrderResponse']) test(`Connected ${fault} outage can recover without duplicate redemption`, async () => {
  const f = fixture({ connected: true }); f.faults[fault] = true; await assert.rejects(f.run);
  delete f.faults[fault]; await f.run();
  assert.equal(f.rows.UserPoints[0].total_points, 1000); assert.equal(f.rows.UserPoints[0].redeemed_points, 2000);
  assert.equal(f.rows.LoyaltyMember[0].total_points, 1000); assert.equal(f.rows.LoyaltyTransaction.length, 1);
  assert.equal(f.order.status_history.length, 2); assert.equal(f.order.payment_captured, false);
});
test('No-cash qualification requires the entire receipt, not a bare paid or zero-total flag', async () => {
  const f = fixture(); await f.run();
  for (const key of Object.keys(f.order.reward_settlement)) {
    const copy = structuredClone(f.order); delete copy.reward_settlement[key]; assert.equal(isVerifiedNoPaymentOrder(copy), false, key);
  }
  for (const total of [null, undefined, '', '0', -1, 0.01, NaN]) assert.equal(isVerifiedNoPaymentOrder({ ...f.order, total }), false);
  for (const status of ['pending_payment', 'cancelled', 'refunded', 'failed']) assert.equal(isVerifiedNoPaymentOrder({ ...f.order, status }), false);
});
for (const file of consumers) test(`Bundle-local receipt predicate parity: ${file}`, () => {
  assert.equal(declaration(read(root + file), 'isVerifiedNoPaymentOrder'), canonical);
});
test('Frontend receipt predicate remains identical to the server contract', () => {
  assert.equal(declaration(read('src/lib/orderConfirmationState.js'), 'isVerifiedNoPaymentOrder'), canonical);
});
test('Actual production transition accepts the settled reward without creating a fake payment', async () => {
  const f = fixture(); await f.run(); const source = read(`${root}getAdminOperationsDashboardSummary/handlers/executeNativeProductionBatchLifecycle/entry.ts`);
  const names = ['normalizeText', 'normalizeSingleLine', 'normalizeLower', 'sanitizeText', 'sanitizeId', 'terminalCustomerOrder', 'projectLinkedCustomerOrdersInProduction'];
  const js = [canonical, ...names.map(name => declaration(source, name))].join('\n');
  const context = vm.createContext({}); vm.runInContext(js, context);
  const writes = []; const base44 = { asServiceRole: { entities: { Order: { update: async (id, patch) => {
    assert.equal(id, f.order.id); writes.push(patch); Object.assign(f.order, structuredClone(patch));
  } } } } };
  const r = await context.projectLinkedCustomerOrdersInProduction({ base44, batch: {}, requestId: 'synthetic-start',
    now: '2026-09-11T09:00:00Z', preloadedOrders: [f.order] });
  assert.equal(r.updated_count, 1); assert.equal(f.order.status, 'in_production'); assert.equal(f.order.payment_captured, false);
  assert.equal(writes[0].payment_captured, undefined);
});
test('Actual delivery patch preserves reward settlement through out-for-delivery and delivered', async () => {
  const f = fixture(); await f.run(); const receipt = structuredClone(f.order.reward_settlement);
  const source = read(`${root}getAdminOperationsDashboardSummary/handlers/executeNativeFulfillmentTaskLifecycle/entry.ts`);
  const names = ['normalizeText', 'normalizeSingleLine', 'normalizeLower', 'sanitizeText', 'sanitizeId',
    'terminalCustomerStatus', 'buildStatusHistory', 'buildCustomerOrderPatch'];
  const context = vm.createContext({}); vm.runInContext(names.map(name => declaration(source, name)).join('\n'), context);
  for (const action of ['out_for_delivery', 'delivered_operational']) {
    const result = context.buildCustomerOrderPatch({ order: f.order, task: {}, writtenTask: {}, action,
      now: '2026-09-12T18:00:00Z', requestId: `synthetic-${action}` });
    assert.equal(result.skipped, false); assert.equal(result.patch.payment_captured, undefined);
    Object.assign(f.order, structuredClone(result.patch));
    assert.equal(isVerifiedNoPaymentOrder(f.order), true); assert.equal(f.order.payment_captured, false);
    assert.deepEqual(f.order.reward_settlement, receipt);
  }
  assert.equal(f.order.status, 'delivered');
});
test('Admin summary and attached customer context preserve the no-cash qualification', async () => {
  const f = fixture(); await f.run(); const source = read(`${root}getAdminOperationsDashboardSummary/handlers/getAdminOrdersWithHub/entry.ts`);
  const context = vm.createContext({}); vm.runInContext([canonical,
    declaration(source, 'summarizeCustomerAppOrder'), declaration(source, 'attachCustomerAppContext')].join('\n'), context);
  const summary = context.summarizeCustomerAppOrder(f.order);
  assert.equal(summary.reward_payment_settled, true); assert.equal(summary.payment_captured, false);
  const attached = context.attachCustomerAppContext({ id: 'synthetic-native' }, summary);
  assert.equal(attached.customer_app_reward_settled, true); assert.equal(attached.customer_app_payment_captured, false);
});
test('Production preview does not label a no-cash reward as a captured payment', async () => {
  const f = fixture(); await f.run(); const source = read(`${root}getAdminOperationsDashboardSummary/handlers/previewNativeProductionBatchLifecycle/entry.ts`);
  const context = vm.createContext({}); vm.runInContext([canonical, declaration(source, 'isPaymentCaptured')].join('\n'), context);
  assert.equal(context.isPaymentCaptured(f.order, { payment_captured: true }), false);
});
for (const file of ['getCustomerOrderDetail/entry.ts', 'getCustomerAccountDashboardData/handlers/getCustomerAccountDashboardData/entry.ts']) {
  test(`Actual customer view eligibility accepts no-cash receipt: ${file}`, async () => {
    const f = fixture(); await f.run(); const source = read(root + file);
    const context = vm.createContext({}); vm.runInContext([canonical,
      declaration(source, 'normalizeText'), declaration(source, 'normalizeLower'), declaration(source, 'hasPaidCaptured')].join('\n'), context);
    assert.equal(context.hasPaidCaptured(f.order), true); assert.equal(f.order.payment_captured, false);
    assert.equal(context.hasPaidCaptured({ ...f.order, reward_settlement: null }), false);
    assert.equal(context.hasPaidCaptured({ payment_captured: true, payment_status: 'paid' }), true);
  });
}
test('Customer identity cannot directly create settled Order records; normal server checkout still creates them', () => {
  const schema = JSON.parse(read('base44/entities/Order.jsonc'));
  assert.deepEqual(schema.rls.create, { user_condition: { role: 'admin' } });
  assert.ok(schema.rls.read.$or.some(row => row['data.customer_email'] === '{{user.email}}'));
  assert.equal(schema.properties.reward_settlement.type, 'object');
  assert.match(read(`${root}createPaymentIntent/entry.ts`), /asServiceRole\.entities\.Order\.create/);
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]);
  for (const file of walk('src').filter(path => /\.(jsx?|tsx?)$/.test(path))) {
    assert.doesNotMatch(read(file), /entities\.Order\.(?:create|bulkCreate)\(/, file);
  }
});

function expiredFixture(options) {
  const f = fixture(options); f.session.status = 'expired'; f.session.payment_status = 'unpaid';
  f.event.type = 'checkout.session.expired'; f.event.data.object = structuredClone(f.session); return f;
}
test('Expiration releases held points and cancels only the unpaid order; retry preserves history', async () => {
  const f = expiredFixture({ connected: true }); await f.run();
  assert.equal(f.order.status, 'cancelled'); assert.equal(f.order.payment_captured, false);
  assert.equal(f.order.payment_status, 'pending'); assert.equal(f.rows.UserPoints[0].reserved_points, 0);
  assert.equal(f.rows.UserPoints[0].total_points, 3000); assert.equal(f.rows.LoyaltyMember[0].total_points, 3000);
  assert.equal(f.rows.LoyaltyTransaction.length, 0); assert.equal(f.order.reward_settlement, undefined);
  const history = structuredClone(f.order.status_history); await f.run(); assert.deepEqual(f.order.status_history, history);
});
test('Expiration releases a real hold even if checkout creation failed before Order/CheckoutSession persistence', async () => {
  const f = expiredFixture({ connected: true }); f.rows.Order.splice(0); f.rows.CheckoutSession.splice(0);
  await f.run(); assert.equal(f.rows.UserPoints[0].reserved_points, 0); assert.equal(f.rows.UserPoints[0].total_points, 3000);
  assert.ok(!f.effects.includes('Order.cas')); assert.equal(f.rows.LoyaltyTransaction.length, 0);
});
for (const [label, patch] of Object.entries({
  complete: { status: 'complete', payment_status: 'no_payment_required' }, open: { status: 'open' },
  cash: { amount_total: 1 }, charge: { payment_intent: 'pi_OTHER' }, test: { livemode: false },
  subscription: { mode: 'subscription' }, currency: { currency: 'eur' }, customer: { customer_email: 'other@example.test' },
})) test(`Expiration ${label} mismatch cannot release or cancel`, async () => {
  const f = expiredFixture(); Object.assign(f.session, patch); await assert.rejects(f.run);
  assert.ok(!f.effects.includes('loyalty.settle')); assert.equal(f.order.status, 'pending_payment');
});
for (const [label, mutate] of [
  ['paid order', f => { f.order.payment_status = 'paid'; }],
  ['foreign order', f => { f.order.customer_email = 'other@example.test'; }],
  ['duplicate order', f => { f.rows.Order.push(structuredClone(f.order)); }],
  ['changed event context', f => { f.event.data.object.metadata.checkout_context_hash = 'b'.repeat(64); }],
  ['existing settlement', f => { f.order.reward_settlement = {}; }],
]) test(`Expiration ${label} fails closed`, async () => {
  const f = expiredFixture(); mutate(f); await assert.rejects(f.run); assert.ok(!f.effects.includes('loyalty.settle'));
});
for (const fault of ['Order.write', 'LoyaltyMember.write', 'lostOrderResponse']) {
  test(`Connected expiration recovers ${fault} without spending or releasing twice`, async () => {
    const f = expiredFixture({ connected: true }); f.faults[fault] = true;
    await assert.rejects(f.run); f.faults[fault] = false; await f.run();
    assert.equal(f.order.status, 'cancelled'); assert.equal(f.rows.UserPoints[0].reserved_points, 0);
    assert.equal(f.rows.UserPoints[0].total_points, 3000); assert.equal(f.rows.LoyaltyTransaction.length, 0);
  });
}
test('Concurrent expiration/lifecycle edit is not overwritten or reported as canceled', async () => {
  const f = expiredFixture({ connected: true }); f.faults.raceHistory = true;
  await assert.rejects(f.run); assert.equal(f.order.status, 'pending_payment');
  assert.ok(f.order.status_history.some(row => row.message === 'Other actor'));
  f.faults.raceHistory = false; await f.run(); assert.equal(f.order.status, 'cancelled');
});

const webhookSource = transformSync(read(`${root}stripeWebhook/entry.ts`), { loader: 'ts', format: 'cjs' }).code;
function actualWebhook(f, { missingSecret = false, staging = false, invalidSignature = false } = {}) {
  let handler; const module = { exports: {} };
  const db = { asServiceRole: { entities: f.entities, functions: { invoke: async (name, payload) => {
    assert.equal(name, 'enrollNewCustomerInLoyalty', 'No legacy downstream/cash/advertising path may run');
    assert.equal(payload.action, 'settle_reward_checkout');
    assert.equal(payload.internal_secret, 'synthetic-internal');
    return { data: await f.options.settleReservation(payload) };
  } } } };
  vm.runInNewContext(webhookSource, { module, exports: module.exports, Request, Response, URL, setTimeout, clearTimeout,
    console: { log() {}, warn() {}, error() {} },
    Deno: { serve: fn => { handler = fn; }, env: { get: name => name === 'NUVIRA_STAGING_SAFE_MODE'
      ? (staging ? 'true' : '') : name === 'LOYALTY_LEDGER_SECRET' && !missingSecret ? 'synthetic-internal' : '' } },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db };
      if (name.includes('rewardWebhook')) return rewardWebhook;
      if (name.includes('paymentBenefits')) return benefits;
      if (name.includes('checkoutCredit')) return creditReservation;
      if (name.includes('birthdayCheckout')) return birthdayCheckout;
      if (name.includes('metaConversions')) return { sendMetaPurchaseConversion: () => { throw new Error('No advertising Purchase'); } };
      if (name.includes('googleMeasurement')) return { sendGooglePurchaseMeasurement: () => { throw new Error('No advertising Purchase'); } };
      if (name.includes('stripe')) return class { checkout = f.options.stripe.checkout;
        webhooks = { constructEventAsync: async raw => { if (invalidSignature) throw new Error('synthetic invalid signature'); return JSON.parse(raw); } }; };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return async () => {
    const response = await handler(new Request('https://test.invalid/webhook', { method: 'POST',
      headers: { 'stripe-signature': 'synthetic-only' }, body: JSON.stringify(f.event) }));
    return { status: response.status, body: await response.json() };
  };
}
test('Actual webhook dispatches expiration to ledger release; no legacy cash or provider writes', async () => {
  const f = expiredFixture({ connected: true }); const result = await actualWebhook(f)();
  assert.equal(result.status, 200); assert.equal(result.body.expired, true); assert.equal(f.order.status, 'cancelled');
});
test('Actual webhook completion settles once but does not acknowledge an unfinished handoff', async () => {
  const f = fixture({ connected: true }); const invoke = actualWebhook(f);
  for (let i = 0; i < 2; i++) { const result = await invoke(); assert.equal(result.status, 503);
    assert.equal(result.body.error, 'reward_checkout_handoff_pending'); }
  assert.equal(f.order.payment_captured, false); assert.equal(f.rows.UserPoints[0].total_points, 1000);
  assert.equal(f.rows.LoyaltyTransaction.length, 1);
});
for (const [name, opts, expected] of [
  ['missing ledger credential', { missingSecret: true }, 503], ['staging write guard', { staging: true }, 503],
  ['invalid signature', { invalidSignature: true }, 400],
]) test(`Actual webhook ${name} stops before reads or writes`, async () => {
  const f = fixture(); const result = await actualWebhook(f, opts)(); assert.equal(result.status, expected);
  assert.deepEqual(f.effects, []);
});
test('Unknown reward version is isolated from legacy Checkout processing', async () => {
  const f = fixture(); f.event.data.object.metadata.checkout_version = 'future_reward_no_payment';
  const result = await actualWebhook(f)(); assert.equal(result.status, 503); assert.deepEqual(f.effects, []);
});
test('Dispatcher waits for handoff and only acknowledges its explicit completion', async () => {
  const f = fixture(); let release; const wait = new Promise(resolve => { release = resolve; }); let ended = false;
  const call = rewardWebhook.handleRewardCheckoutEvent({ ...f.options, internalSecretAvailable: true,
    runHandoff: async () => { await wait; return { complete: true }; } }).then(result => { ended = true; return result; });
  for (let i = 0; i < 30; i++) await Promise.resolve(); assert.equal(ended, false);
  release(); const result = await call; assert.equal(result.status, 200); assert.equal(result.body.handoff_complete, true);
});
test('Dispatcher error response never returns downstream PII/payload text', async () => {
  const f = fixture(); const result = await rewardWebhook.handleRewardCheckoutEvent({ ...f.options,
    internalSecretAvailable: true, runHandoff: async () => { throw new Error('synthetic-secret@example.test'); } });
  assert.equal(result.status, 503); assert.doesNotMatch(JSON.stringify(result), /synthetic-secret/);
});

let passed = 0;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); } catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`No-payment reward settlement: ${passed}/${tests.length}; local source and simulated provider/storage only.`);
