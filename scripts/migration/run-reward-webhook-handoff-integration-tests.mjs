import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildSync, transformSync } from 'esbuild';
import { createCompleteRewardHandoffFixture } from './run-reward-complete-handoff-tests.mjs';
import { createRewardSettlementFixture } from './run-no-payment-reward-settlement-tests.mjs';
import { REWARD_HANDOFF_STAGES } from '../../base44/functions/stripeWebhook/rewardHandoff.js';
import { runVerifiedRewardHandoff } from '../../base44/functions/stripeWebhook/rewardHandoffRuntime.js';
import { noPaymentBirthdayMetadata } from '../../base44/shared/noPaymentBirthday.js';
import { prepareRouteReview, recordRouteAuthorization, ROUTE_REVIEW_REVISION } from '../../base44/shared/routeReview.js';
import { decideRouteReview } from '../../base44/shared/routeReviewDecision.js';

// Bundle the real webhook and every local helper. Only SDK/provider transports,
// storage, and native safe-sync planning use synthetic fixtures; no network.
const source = buildSync({ entryPoints: ['base44/functions/stripeWebhook/entry.ts'], bundle: true,
  write: false, format: 'cjs', platform: 'node', target: 'es2022', external: ['npm:*'] }).outputFiles[0].text;
globalThis.fetch = async () => { throw new Error('External network forbidden'); };
const copy = value => structuredClone(value);
function fixture({ directPoints = false, mixedPoints = false, creditMode = null, birthday = false } = {}) {
  directPoints ||= birthday;
  directPoints ||= creditMode === 'points' || creditMode === 'only';
  mixedPoints ||= creditMode === 'tier';
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
  if (directPoints) {
    order.items.forEach(item => {
      item.price = 13;
      for (const key of ['isFreeReward', 'reward_id', 'reward_type', 'reward_discount_amount', 'cart_line_key']) delete item[key];
    });
    Object.assign(order, { subtotal: 78, total_discounts: 78 });
    Object.assign(data, { items: copy(order.items), subtotal: 78, total_discounts: 78, delivery_fee: 0,
      points_used: 7800, points_discount: 78, reward_discount: 0, subscription_discount: 0,
      reward_reservation_points: 7800, active_reward: null,
      reward_reservation_id: `points:${'a'.repeat(64)}`,
      points_reservation_revision: '2026-09-08.direct-points-v1', no_payment_points_revision: '2026-09-09.no-payment-points-v1' });
    delete data.reward_checkout;
    oldReceipt.reservation_id = data.reward_reservation_id;
  }
  if (mixedPoints) {
    const extra = { ...copy(order.items[0]), quantity: 1, price: 13 };
    for (const key of ['isFreeReward', 'reward_id', 'reward_type', 'reward_discount_amount', 'cart_line_key']) delete extra[key];
    order.items.push(extra);
    Object.assign(order, { subtotal: 13, total_discounts: 13 });
    Object.assign(data, { items: copy(order.items), subtotal: 13, total_discounts: 13, delivery_fee: 0,
      points_used: 1300, points_discount: 13, reward_discount: 0, subscription_discount: 0,
      reward_reservation_points: 3300, reward_reservation_id: `reward:${'a'.repeat(64)}` });
    Object.assign(data.reward_checkout, { active_reward: copy(data.active_reward), points_required: 2000,
      items: copy(data.items), subtotal: 13, catalog_subtotal: 91, reward_item_discount: 78,
      reward_discount: 0, merchandise_total: 13 });
    oldReceipt.reservation_id = data.reward_reservation_id;
  }
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
  if (directPoints) {
    s.metadata.no_payment_points = '7800';
    Object.assign(account, { total_points: 9000, lifetime_points: 9000, reserved_points: 7800 });
    account.reward_reservations[0].points = 7800;
  }
  if (mixedPoints) {
    Object.assign(account, { total_points: 9000, lifetime_points: 9000, reserved_points: 3300 });
    account.reward_reservations[0].points = 3300;
  }
  if (creditMode) {
    const points = creditMode === 'only' ? 0 : creditMode === 'points' ? 1300 : 2000;
    const credit = creditMode === 'only' ? 78 : creditMode === 'points' ? 65 : 13;
    const rid = `credit:${'a'.repeat(64)}`;
    Object.assign(data, { no_payment_credit_revision: '2026-09-09.no-payment-credit-v1',
      credit_reservation_revision: '2026-09-08.credit-reservation-v1', credit_reservation_id: rid,
      credits_discount: credit, points_used: creditMode === 'points' ? 1300 : 0,
      points_discount: creditMode === 'points' ? 13 : 0, reward_reservation_points: points });
    Object.assign(s.metadata, { credit_reservation_id: rid, credit_reservation_cents: String(credit * 100) });
    if (creditMode === 'points') s.metadata.no_payment_points = '1300';
    else delete s.metadata.no_payment_points;
    if (!points) { data.reward_reservation_id = rid; s.metadata.reward_reservation_id = rid; account.reward_reservations = []; }
    else account.reward_reservations[0].points = points;
    account.reserved_points = points;
    c.rows.NuViraCredit = [{ id: 'synthetic_credit', customer_email: order.customer_email, balance: 100,
      reserved_balance: credit, lifetime_used: 0, history: [], checkout_reservations: [{
        reservation_id: rid, context_hash: data.checkout_context_hash, checkout_session_id: s.id,
        amount_cents: credit * 100, preparation_attempt_id: 'synthetic-credit-preparation', status: 'held',
      }] }];
    const matches = (row, query) => Object.entries(query).every(([key, value]) => key === '$or'
      ? value.some(q => matches(row, q)) : value && typeof value === 'object' && '$exists' in value
        ? (row[key] !== undefined) === value.$exists : row[key] === value);
    c.entities.NuViraCredit = {
      filter: async query => copy(c.rows.NuViraCredit.filter(row => matches(row, query))),
      updateMany: async (query, patch) => { const rows = c.rows.NuViraCredit.filter(row => matches(row, query));
        rows.forEach(row => Object.assign(row, copy(patch.$set)));
        return { success: true, has_more: false, updated: rows.length }; },
    };
  }
  if (birthday) {
    const gift = { ...copy(order.items[0]), quantity: 1, price: 0, isBirthdayReward: true,
      birthday_product_id: order.items[0].product_id, catalog_unit_price: 13, birthday_discount_amount: 13 };
    order.items.push(gift); data.items = copy(order.items);
    const b = { revision: '2026-09-08.birthday-entitlement-v1', product_id: gift.product_id, retail_value_cents: 1300,
      cycle_year: 2026, month_day: '09-08', window_start: '2026-09-08', window_end: '2026-10-08' };
    Object.assign(data, { customer_app_user_id: 'synthetic-birthday-user', birthday_checkout: b,
      birthday_reservation_id: `birthday:${'a'.repeat(64)}`, birthday_discount: 13, catalog_subtotal: 91,
      no_payment_birthday_revision: '2026-09-09.no-payment-birthday-v1' });
    Object.assign(s.metadata, { birthday_reservation_id: data.birthday_reservation_id,
      no_payment_birthday: noPaymentBirthdayMetadata(data) });
    account.birthday_reservations = [{ reservation_id: data.birthday_reservation_id,
      context_hash: data.checkout_context_hash, customer_app_user_id: data.customer_app_user_id,
      product_id: gift.product_id, retail_value_cents: 1300, cycle_year: 2026, month_day: b.month_day,
      window_start: b.window_start, window_end: b.window_end, checkout_session_id: s.id,
      status: 'held', created_at: '2026-09-08T15:00:00Z' }];
  }
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
test('approved cashless route executes every real handoff stage once using its existing order', async () => {
  const f = fixture({ directPoints: true }); const requests = [];
  const matches = (row, query) => Object.entries(query).every(([key, value]) => row[key] === value);
  const entity = {
    filter: async query => copy(requests.filter(row => matches(row, query))),
    create: async data => { const row = { id: 'dar-integration-synthetic', ...copy(data) }; requests.push(row); return copy(row); },
    updateMany: async (query, patch) => { const rows = requests.filter(row => matches(row, query));
      rows.forEach(row => Object.assign(row, copy(patch.$set))); return { success: true, updated: rows.length, has_more: false }; },
  };
  f.c.entities.DeliveryApprovalRequest = entity; f.settled.entities.DeliveryApprovalRequest = entity;
  f.order.delivery_zone_id = 'zone_3a_route_review_25_30';
  // The original local handoff fixture does not persist all private quote
  // columns; route review requires the same exact values as root preparation.
  for (const key of ['assigned_delivery_date', 'assigned_production_day', 'delivery_window_label',
    'assigned_delivery_window_start', 'assigned_delivery_window_end', 'address_line1', 'address_line2',
    'address_city', 'address_state', 'address_postal_code', 'contact_phone', 'subtotal', 'delivery_fee', 'total_discounts']) {
    f.order[key] = f.data[key];
  }
  f.data.route_review = { revision: ROUTE_REVIEW_REVISION, request_number: 'DAR-' + 'A'.repeat(24),
    customer_acknowledged_hold: true, qualification_subtotal: 78, zone_key: f.order.delivery_zone_id };
  Object.assign(f.s.metadata, { route_review_request: f.data.route_review.request_number, delivery_zone_key: f.order.delivery_zone_id });
  Object.assign(f.s.metadata, { assigned_production_day: f.data.assigned_production_day,
    selected_delivery_date: f.data.assigned_delivery_date, delivery_window_label: f.data.delivery_window_label,
    delivery_window_start: f.data.assigned_delivery_window_start, delivery_window_end: f.data.assigned_delivery_window_end });
  const stripe = f.settled.options.stripe; f.s.status = 'open';
  await prepareRouteReview({ entities: f.c.entities, stripe, providerId: f.s.id });
  f.s.status = 'complete';
  const event = { ...f.settled.event, data: { object: copy(f.s) } };
  stripe.events = { retrieve: async id => { assert.equal(id, event.id); return copy(event); } };
  await recordRouteAuthorization({ entities: f.c.entities, stripe, event });
  assert.equal(f.order.status, 'pending_payment'); assert.equal(f.shopify.state.creates.length, 0);
  const invoke = f.c.base44.asServiceRole.functions.invoke;
  f.c.base44.asServiceRole.functions.invoke = async (name, payload) => name === 'calculateNuViraFulfillmentSchedule'
    ? { data: { options: [{ production_date: f.data.assigned_production_day, delivery_date: f.data.assigned_delivery_date,
      delivery_window_label: f.data.delivery_window_label, delivery_window_start: f.data.assigned_delivery_window_start,
      delivery_window_end: f.data.assigned_delivery_window_end }] } } : invoke(name, payload);
  const args = { base44: f.c.base44, stripe, darId: requests[0].id, kind: 'approve', actor: 'admin@example.test',
    reason: 'Synthetic route approval, no live fulfillment', env: f.env, fetchImpl: f.fetchImpl };
  const result = await decideRouteReview(args); assert.equal(result.fulfillment_handoff, 'complete');
  assert.ok(REWARD_HANDOFF_STAGES.every(stage => f.order.reward_handoff.steps[stage].state === 'complete'));
  assert.equal(f.order.payment_captured, false); assert.equal(f.order.total, 0);
  assert.equal(f.native.rows.FulfillmentTask.length, 1); assert.equal(f.shopify.state.creates.length, 1);
  assert.equal(f.settled.rows.UserPoints[0].total_points, 1200); assert.equal(requests[0].status, 'captured');
  await decideRouteReview(args);
  assert.equal(f.shopify.state.creates.length, 1); assert.equal(count(f, 'provider:send'), 1);
  assert.equal(f.settled.rows.UserPoints[0].total_points, 1200);
  Object.assign(f.order, { status: 'refunded', payment_status: 'refunded' });
  const replay = await recordRouteAuthorization({ entities: f.c.entities, stripe, event });
  assert.equal(replay.dar.status, 'captured'); assert.equal(f.order.status, 'refunded');
  assert.equal(f.shopify.state.creates.length, 1); assert.equal(count(f, 'provider:send'), 1);
});
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
test('direct points flow completes actual ledger, native production, Shopify and all communications without cash', async () => {
  const f = fixture({ directPoints: true }); const result = await f.run();
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.handoff_complete, true);
  assert.ok(REWARD_HANDOFF_STAGES.every(stage => f.order.reward_handoff.steps[stage].state === 'complete'));
  const account = f.settled.rows.UserPoints[0]; assert.equal(account.total_points, 1200);
  assert.equal(account.reserved_points, 0); assert.equal(account.redeemed_points, 7800);
  assert.equal(f.settled.rows.LoyaltyMember[0].total_points, 1200);
  assert.equal(f.order.payment_captured, false); assert.equal(f.order.stripe_payment_intent_id, undefined);
  assert.equal(f.order.reward_settlement.points_redeemed, 7800);
  assert.equal(f.native.rows.FulfillmentTask.length, 1); assert.equal(f.native.rows.ShopifyOrder.length, 1);
  assert.equal(f.native.rows.ProductionBatch.reduce((sum, row) => sum + row.planned_units, 0), 6);
  assert.equal(f.shopify.state.creates.length, 1);
  const input = f.shopify.state.creates[0].order;
  assert.ok(input.lineItems.every(item => item.priceSet.shopMoney.amount === '0.00'));
  assert.ok(input.lineItems.every(item => JSON.parse(item.properties.find(p => p.name === 'nuvira_checkout_item').value).price === 13));
  assert.equal(input.transactions, undefined); assert.equal(count(f, 'provider:send'), 1); assert.equal(count(f, 'operations:send'), 1);
  assert.equal((await f.run()).status, 200); assert.equal(f.shopify.state.creates.length, 1);
  assert.equal(f.settled.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
  assert.equal(account.total_points, 1200); assert.equal(count(f, 'provider:send'), 1);
});
test('earned tier plus points-covered extra bottle completes all nine handoff stages once', async () => {
  const f = fixture({ mixedPoints: true }); const result = await f.run();
  assert.equal(result.status, 200, JSON.stringify(result)); assert.equal(result.body.handoff_complete, true);
  assert.ok(REWARD_HANDOFF_STAGES.every(stage => f.order.reward_handoff.steps[stage].state === 'complete'));
  const account = f.settled.rows.UserPoints[0]; assert.equal(account.total_points, 5700);
  assert.equal(account.reserved_points, 0); assert.equal(account.redeemed_points, 3300);
  assert.equal(f.settled.rows.LoyaltyMember[0].total_points, 5700);
  assert.equal(f.order.reward_settlement.points_redeemed, 3300); assert.equal(f.order.payment_captured, false);
  assert.equal(f.native.rows.ProductionBatch.reduce((sum, row) => sum + row.planned_units, 0), 7);
  assert.equal(f.native.rows.FulfillmentTask.length, 1); assert.equal(f.shopify.state.creates.length, 1);
  const input = f.shopify.state.creates[0].order;
  assert.equal(input.lineItems.reduce((sum, line) => sum + line.quantity, 0), 7);
  assert.ok(input.lineItems.every(line => line.priceSet.shopMoney.amount === '0.00'));
  assert.equal(JSON.parse(input.lineItems.at(-1).properties.find(p => p.name === 'nuvira_checkout_item').value).price, 13);
  assert.equal(input.transactions, undefined); assert.equal(count(f, 'provider:send'), 1);
  assert.equal(count(f, 'operations:send'), 1);
  assert.equal((await f.run()).status, 200); assert.equal(account.total_points, 5700);
  assert.equal(f.settled.rows.LoyaltyTransaction.filter(row => row.status === 'posted').length, 1);
  assert.equal(f.shopify.state.creates.length, 1); assert.equal(count(f, 'provider:send'), 1);
});
for (const [name, mutate] of [
  ['uncovered extra item', f => { f.data.points_discount = 12; }],
  ['altered quote price', f => { f.data.reward_checkout.subtotal = 12; }],
  ['altered reward retail value', f => { f.data.reward_checkout.reward_item_discount = 79; }],
  ['unreserved credits', f => { f.data.credits_discount = 1; }],
  ['wrong tier cost', f => { f.data.active_reward.points_required = 1900; }],
  ['wrong total discounts', f => { f.data.total_discounts = 12; }],
]) test(`mixed tier/points refuses ${name} before spending or downstream dispatch`, async () => {
  const f = fixture({ mixedPoints: true }); mutate(f); const result = await f.run();
  assert.notEqual(result.status, 200); assert.equal(f.settled.rows.UserPoints[0].total_points, 9000);
  assert.equal(f.settled.rows.UserPoints[0].reserved_points, 3300);
  assert.equal(f.shopify.state.creates.length, 0); assert.equal(count(f, 'provider:send'), 0);
});
for (const creditMode of ['only', 'points', 'tier']) test(`credit ${creditMode} completes every downstream stage without a card charge or duplicate credit spend`, async () => {
  const f = fixture({ creditMode }); const start = f.settled.rows.UserPoints[0].total_points;
  const points = f.data.reward_reservation_points; const used = f.data.credits_discount;
  const result = await f.run(); assert.equal(result.status, 200, JSON.stringify({ result, handoff: f.order.reward_handoff }));
  assert.ok(REWARD_HANDOFF_STAGES.every(stage => f.order.reward_handoff.steps[stage].state === 'complete'));
  assert.equal(f.order.reward_settlement.revision, '2026-09-09.credit-settlement-v2');
  assert.equal(f.order.reward_settlement.points_redeemed, points);
  assert.equal(f.order.reward_settlement.credit_redeemed_cents, used * 100);
  assert.equal(f.c.rows.NuViraCredit[0].balance, 100 - used); assert.equal(f.c.rows.NuViraCredit[0].reserved_balance, 0);
  assert.equal(f.settled.rows.UserPoints[0].total_points, start - points);
  assert.equal(f.native.rows.FulfillmentTask.length, 1); assert.equal(f.shopify.state.creates.length, 1);
  assert.equal(f.native.rows.ProductionBatch.reduce((sum, row) => sum + row.planned_units, 0), creditMode === 'tier' ? 7 : 6);
  assert.equal(f.shopify.state.creates[0].order.transactions, undefined);
  assert.equal(count(f, 'provider:send'), 1); assert.equal(count(f, 'operations:send'), 1);
  assert.equal((await f.run()).status, 200); assert.equal(f.c.rows.NuViraCredit[0].history.length, 1);
  assert.equal(f.c.rows.NuViraCredit[0].balance, 100 - used); assert.equal(f.shopify.state.creates.length, 1);
  assert.equal(count(f, 'provider:send'), 1);
});
for (const creditMode of ['only', 'points', 'tier']) test(`credit ${creditMode} reaches eligible customer/staff push and opted-in SMS exactly once`, async () => {
  const f = fixture({ creditMode });
  f.order.contact_phone = '+12025550123'; f.data.contact_phone = f.order.contact_phone;
  f.c.rows.UserProfile.push({ id: 'synthetic_profile', customer_email: f.order.customer_email,
    phone: f.order.contact_phone, sms_consent: true, sms_consent_date: '2026-09-01T12:00:00Z' });
  for (const [i, email] of [f.order.customer_email, 'operations@example.test'].entries()) f.c.rows.PushSubscription.push({
    id: `synthetic_credit_device_${i}`, customer_email: email, token_type: 'web_push', enabled: true,
    endpoint: `https://synthetic.invalid/push/${i}`, p256dh: 'synthetic-key', auth: 'synthetic-auth' });
  for (let retry = 0; retry < 2; retry++) {
    const result = await f.run(); assert.equal(result.status, 200, JSON.stringify(result));
    assert.ok(REWARD_HANDOFF_STAGES.every(stage => f.order.reward_handoff.steps[stage].state === 'complete'));
    assert.equal(count(f, 'push:accept'), 2); assert.equal(count(f, 'sms:send'), 1);
    assert.equal(f.c.rows.NuViraCredit[0].history.length, 1);
  }
  assert.ok(f.c.rows.CustomerMessageDeliveryLog.filter(row => row.channel === 'push').every(row => !row.delivered_at));
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
for (const creditMode of [null, 'only', 'points']) test(`birthday plus ${creditMode || 'points-only'} completes the actual signed webhook and all nine handoffs`, async () => {
  const f = fixture({ birthday: true, creditMode });
  const result = await f.run(); assert.equal(result.status, 200, JSON.stringify({ result, handoff: f.order.reward_handoff }));
  assert.ok(REWARD_HANDOFF_STAGES.every(stage => f.order.reward_handoff.steps[stage].state === 'complete'));
  assert.equal(f.settled.rows.UserPoints[0].birthday_reservations[0].status, 'consumed');
  assert.equal(f.order.reward_settlement.birthday_retail_cents, 1300);
  assert.equal(f.native.rows.ProductionBatch.reduce((sum, row) => sum + row.planned_units, 0), 7);
  assert.equal(f.native.rows.FulfillmentTask.length, 1); assert.equal(f.shopify.state.creates.length, 1);
  assert.equal(count(f, 'provider:send'), 1); assert.equal(count(f, 'operations:send'), 1);
  assert.equal((await f.run()).status, 200); assert.equal(f.shopify.state.creates.length, 1);
  assert.equal(f.settled.rows.UserPoints[0].birthday_reservations.length, 1);
});
let passed = 0;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`Reward webhook/handoff integration: ${passed}/${tests.length}; actual local handlers, simulated storage/providers only.`);
