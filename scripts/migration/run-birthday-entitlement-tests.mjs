import assert from 'node:assert/strict';
import fs from 'node:fs';
import { birthdayWindow, birthdayAvailability, birthdayReservationState, BIRTHDAY_ENTITLEMENT_REVISION } from '../../base44/shared/birthdayEntitlement.js';
import { readBirthdayCheckoutEligibility, quoteBirthdayCatalogCheckout, readVerifiedBirthdayPayment,
  reserveVerifiedBirthdayCheckout, settleVerifiedBirthdayCheckout } from '../../base44/functions/createPaymentIntent/birthdayCheckout.js';
import { reserveBirthdayGift, settleBirthdayGift, applyPointsTransaction, reserveRewardPoints } from '../../base44/functions/enrollNewCustomerInLoyalty/pointsAccount.js';

// Pure calendar/catalog and in-memory conditional-write/provider fixtures only.
// No network, real account, provider event, payment, email, inventory or deploy.
const email = 'birthday-checkout@example.test';
const now = Date.parse('2026-09-08T18:00:00Z');
const identity = { userId: 'synthetic-user', birthday: '1990-09-08', signupDate: '2025-10-01T18:00:00Z' };
const user = { id: identity.userId, email, birthday: identity.birthday, created_date: identity.signupDate };
const window = birthdayWindow({ ...identity, now });
const products = [{ id: 'oasis', title: 'OASIS', category: 'juice', size: '12oz', price: 13, is_available: true,
  image_url: 'https://example.test/oasis.png', shopify_variant_id: 'synthetic-oasis' },
{ id: 'aura', title: 'AURA', category: 'juice', size: '12oz', price: 13, is_available: true },
{ id: 'trio', title: 'NuVira Trio', category: 'bundle', bottles_per_unit: 3, price: 36, is_available: true }];
const cart = () => [{ product_id: 'aura', price: 13, quantity: 2 },
  { product_id: '__birthday_reward__', birthday_product_id: 'oasis', isBirthdayReward: true, price: 0, quantity: 1 }];
const quote = (overrides = {}) => quoteBirthdayCatalogCheckout({ products, items: cart(), eligibility: window, ...overrides });
const request = (char = 'a') => ({ reservation_id: `birthday:${char.repeat(64)}`, context_hash: 'c'.repeat(64),
  customer_app_user_id: identity.userId, product_id: 'oasis', retail_value_cents: 1300, payment_intent_id: `pi_${char}`,
  cycle_year: window.cycle_year, month_day: window.month_day, window_start: window.window_start, window_end: window.window_end,
  provider_status: 'requires_payment_method' });
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => key === '$or' ? value.some(q => matches(row, q))
    : value && typeof value === 'object' && '$exists' in value ? (row[key] !== undefined) === value.$exists
      : row[key] === value);
}
function fixture() {
  const account = { id: 'synthetic-points', customer_email: email, total_points: 1000, lifetime_points: 1200,
    redeemed_points: 200, reserved_points: 0, points_ledger_revision: 0, points_history: [], reward_reservations: [],
    credit_balance: 4, credit_reservations: [] };
  const q = quote();
  const data = { customer_email: email, customer_app_user_id: user.id, order_number: `NV-${'A'.repeat(24)}`,
    guest_checkout: false, checkout_context_hash: request().context_hash, total: 30,
    birthday_reservation_id: request().reservation_id, birthday_checkout: q.birthday_checkout,
    birthday_discount: 13, items: q.items };
  const payment = { id: 'pi_a', livemode: true, currency: 'usd', amount: 3000, status: 'requires_payment_method',
    metadata: { customer_email: email, order_number: data.order_number, checkout_mode: 'account',
      checkout_version: '3.0_embedded', checkout_context_hash: data.checkout_context_hash,
      birthday_reservation_id: data.birthday_reservation_id } };
  const rows = { UserPoints: [account], UserProfile: [{ id: 'profile-test', customer_email: email, birthday: identity.birthday }],
    Order: [{ id: 'order-test', order_number: data.order_number, customer_email: email, total: 30,
      stripe_payment_intent_id: 'pi_a', status: 'pending_payment', payment_status: 'pending', payment_captured: false, items: structuredClone(q.items) }],
    CheckoutSession: [{ id: 'context-test', stripe_session_id: 'pi_a', customer_email: email, order_number: data.order_number, checkout_data: data }] };
  const faults = {}; const writes = []; const entities = {};
  for (const [name, records] of Object.entries(rows)) entities[name] = {
    filter: async (query, sort, limit) => structuredClone(records.filter(row => matches(row, query)).slice(0, limit)),
    create: async () => { throw new Error('Creation not authorized by synthetic birthday fixture'); },
    update: async () => { throw new Error('Unconditional update not authorized'); },
    updateMany: async (query, update) => {
      assert.equal(name, 'UserPoints'); assert.deepEqual(Object.keys(update), ['$set']);
      assert.equal(query.id, account.id); assert.equal(query.customer_email, email);
      assert.ok('points_ledger_revision' in query);
      if (faults.rejectCas) return { success: true, updated: 0, has_more: false };
      if (faults.badResponse) return { success: true, updated: 2, has_more: true };
      const selected = records.filter(row => matches(row, query)); assert.ok(selected.length <= 1);
      if (!faults.ignoreWrite) selected.forEach(row => Object.assign(row, structuredClone(update.$set)));
      writes.push(structuredClone(update));
      if (faults.loseResponse) { faults.loseResponse = false; throw new Error('Synthetic response lost after write'); }
      return { success: true, updated: selected.length, has_more: false };
    },
  };
  let providerReads = 0;
  const stripe = { paymentIntents: { retrieve: async id => {
    providerReads++; assert.equal(id, 'pi_a'); if (faults.providerOffline) throw new Error('Synthetic provider offline');
    return structuredClone(payment);
  } } };
  return { account, rows, data, payment, entities, faults, writes, stripe, providerReads: () => providerReads };
}
const proof = f => readVerifiedBirthdayPayment({ entities: f.entities, stripe: f.stripe, customerEmail: email, paymentIntentId: 'pi_a' });
const reserve = (f, r = request(), who = identity, at = now) => reserveBirthdayGift(f.entities, email, r, who, at);
const settle = (f, status = 'succeeded', r = request()) => settleBirthdayGift(f.entities, email, { ...r, provider_status: status }, now + 1000);
const throwsCode = (fn, code) => assert.throws(fn, err => err.code === code);
const rejectsCode = (fn, code) => assert.rejects(fn, err => err.code === code);
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('Calendar window requires a real date and server signup timestamp', () => {
  assert.equal(window.eligible, true);
  for (const birthday of ['2026-02-30', 'bad', '2999-09-08', 19900908]) {
    assert.equal(birthdayWindow({ ...identity, birthday, now }).eligible, false);
  }
  for (const signupDate of [undefined, null, '', '2025-01-01', 'bad', '2027-01-01T00:00:00Z']) {
    assert.equal(birthdayWindow({ ...identity, signupDate, now }).eligible, false);
  }
  assert.equal(birthdayWindow({ ...identity, birthday: null, now }).status, 'birthday_missing');
  assert.equal(birthdayWindow({ ...identity, now: null }).eligible, false);
});
test('A birthday on or before the signup day does not create immediate entitlement', () => {
  for (const signupDate of ['2026-09-08T05:00:00Z', '2026-09-08T17:00:00Z', '2026-09-09T05:00:00Z']) {
    assert.equal(birthdayWindow({ ...identity, signupDate, now }).eligible, false);
  }
  assert.equal(birthdayWindow({ ...identity, signupDate: '2026-09-08T04:59:59Z', now }).eligible, true);
});
test('Central midnight and inclusive day 30 do not depend on device timezone', () => {
  const original = process.env.TZ;
  try {
    for (const zone of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      process.env.TZ = zone;
      for (const [at, expected] of [['2026-09-08T04:59:59Z', false], ['2026-09-08T05:00:00Z', true],
        ['2026-10-09T04:59:59Z', true], ['2026-10-09T05:00:00Z', false]]) {
        assert.equal(birthdayWindow({ ...identity, now: Date.parse(at) }).eligible, expected);
      }
    }
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
test('December birthday claimed in January belongs to the previous birthday cycle', () => {
  const result = birthdayWindow({ ...identity, birthday: '1990-12-20', now: Date.parse('2027-01-05T18:00:00Z') });
  assert.equal(result.eligible, true); assert.equal(result.cycle_year, 2026);
  assert.equal(result.window_end, '2027-01-19');
});
test('February 29 keeps the established March 1 non-leap anniversary', () => {
  const base = { birthday: '2000-02-29', signupDate: '2020-01-01T00:00:00Z' };
  assert.equal(birthdayWindow({ ...base, now: Date.parse('2027-02-28T18:00:00Z') }).eligible, false);
  assert.equal(birthdayWindow({ ...base, now: Date.parse('2027-03-01T18:00:00Z') }).window_start, '2027-03-01');
  assert.equal(birthdayWindow({ ...base, now: Date.parse('2028-02-29T18:00:00Z') }).window_start, '2028-02-29');
});
test('Read-only eligibility uses the unique owned profile and never creates an account', async () => {
  const f = fixture(); f.rows.Order.length = 0; f.rows.CheckoutSession.length = 0;
  const result = await readBirthdayCheckoutEligibility(f.entities, user, now);
  assert.equal(result.eligibility.eligible, true); assert.equal(f.writes.length, 0);
  assert.equal(result.eligibility.birthday, undefined); assert.equal(result.eligibility.email, undefined);
  f.rows.UserProfile.length = 0;
  assert.equal((await readBirthdayCheckoutEligibility(f.entities, user, now)).eligibility.eligible, true);
  await rejectsCode(() => readBirthdayCheckoutEligibility(f.entities, null, now), 'birthday_sign_in_required');
});
test('Duplicate profile or points records fail closed', async () => {
  const f = fixture(); f.rows.UserProfile.push({ ...f.rows.UserProfile[0], id: 'duplicate' });
  await rejectsCode(() => readBirthdayCheckoutEligibility(f.entities, user, now), 'birthday_profile_read_unconfirmed');
  f.rows.UserProfile.pop(); f.rows.UserPoints.push({ ...f.account, id: 'duplicate' });
  await rejectsCode(() => readBirthdayCheckoutEligibility(f.entities, user, now), 'duplicate_points_accounts');
  assert.equal(f.writes.length, 0);
});
test('A missing points account is not silently created to redeem a gift', async () => {
  const f = fixture(); f.rows.UserPoints.length = 0;
  await rejectsCode(() => readBirthdayCheckoutEligibility(f.entities, user, now), 'points_account_missing');
});
test('Legacy birthday history needs reconciliation rather than a second annual gift', async () => {
  for (const legacy of [{ product_id: '__birthday_reward__', price: 0, quantity: 1 },
    { product_id: 'old-bottle', title: '🎂 Birthday juice (Free)', price: 0, quantity: 1 }]) {
    const f = fixture(); f.rows.CheckoutSession.length = 0; f.rows.Order[0].items = [legacy];
    f.rows.Order[0].payment_status = 'paid';
    const result = await readBirthdayCheckoutEligibility(f.entities, user, now);
    assert.equal(result.eligibility.status, 'birthday_history_review_required');
    assert.equal(result.eligibility.eligible, false); assert.equal(f.writes.length, 0);
  }
});
test('Capped or malformed order-history reads cannot prove birthday eligibility', async () => {
  const f = fixture(); f.entities.Order.filter = async () => Array.from({ length: 250 }, (_, i) => ({ id: `order-${i}` }));
  assert.equal((await readBirthdayCheckoutEligibility(f.entities, user, now)).eligibility.status, 'birthday_history_review_required');
  f.entities.Order.filter = async () => [{ id: 'incomplete', customer_email: email }];
  assert.equal((await readBirthdayCheckoutEligibility(f.entities, user, now)).eligibility.status, 'birthday_history_review_required');
});
test('Gift quote keeps real product lineage, zero charge and retail minimum value', () => {
  const q = quote(); assert.equal(q.subtotal, 26); assert.equal(q.catalog_subtotal, 39);
  assert.equal(q.birthday_discount, 13); assert.equal(q.physical_units, 3);
  const gift = q.items[1]; assert.equal(gift.product_id, 'oasis'); assert.equal(gift.title, 'OASIS');
  assert.equal(gift.price, 0); assert.equal(gift.catalog_unit_price, 13); assert.equal(gift.birthday_discount_amount, 13);
  assert.equal(gift.image_url, products[0].image_url); assert.equal(gift.shopify_variant_id, 'synthetic-oasis');
  assert.equal(gift.cart_line_key, 'birthday:oasis'); assert.equal(gift.isFreeReward, undefined);
  assert.equal(q.birthday_checkout.revision, BIRTHDAY_ENTITLEMENT_REVISION);
});
test('Gift plus paid bottle of the same flavor remain two distinct priced lines', () => {
  const items = cart(); items[0] = { product_id: 'oasis', price: 13, quantity: 2 };
  const q = quote({ items }); assert.equal(q.items.length, 2);
  assert.equal(q.items[0].price, 13); assert.equal(q.items[1].price, 0); assert.equal(q.subtotal, 26);
});
test('No client marker can bypass availability, catalog price or quantity checks', () => {
  for (const eligibility of [null, { eligible: false, status: 'already_redeemed' }]) {
    throwsCode(() => quote({ eligibility }), 'birthday_not_available');
  }
  for (const change of [gift => { gift.quantity = 2; }, gift => { gift.price = 13; },
    gift => { delete gift.birthday_product_id; }, gift => { gift.product_id = 'aura'; },
    gift => { gift.isFreeReward = true; }, gift => { gift.reward_id = 'fake'; }]) {
    const items = cart(); change(items[1]); throwsCode(() => quote({ items }), 'birthday_selection_invalid');
  }
  throwsCode(() => quote({ items: [...cart(), cart()[1]] }), 'birthday_selection_invalid');
  const items = cart(); items[0].price = 0;
  throwsCode(() => quote({ items }), 'PRODUCT_PRICE_OR_AVAILABILITY_CHANGED');
});
test('Birthday is one available 12oz juice, not a shot, 32oz bottle or bundle', () => {
  for (const change of [{ category: 'shot', size: '2oz' }, { size: '32oz' }, { category: 'bundle' },
    { is_available: false }, { price: 0 }, { price: 13.001 }]) {
    throwsCode(() => quote({ products: [{ ...products[0], ...change }, ...products.slice(1)] }), 'birthday_product_ineligible');
  }
});
test('Birthday gift counts once toward physical minimum but cannot ship alone', () => {
  throwsCode(() => quote({ items: [cart()[1]] }), 'ORDER_MINIMUM_NOT_MET');
  const items = cart(); items[0].quantity = 1;
  throwsCode(() => quote({ items }), 'ORDER_MINIMUM_NOT_MET');
  assert.equal(quote({ items: [{ product_id: 'trio', price: 36, quantity: 1 }, cart()[1]] }).subtotal, 36);
});
test('An earned-reward marker still needs the separate tier validator', () => {
  const items = cart(); items[0].reward_id = 'fake';
  throwsCode(() => quote({ items }), 'REWARD_SELECTION_REQUIRED');
});
test('Two concurrent annual gift checkouts reserve exactly one bottle', async () => {
  const f = fixture(); const results = await Promise.allSettled([reserve(f), reserve(f, request('b'))]);
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'checkout_in_progress');
  assert.equal(f.account.birthday_reservations.length, 1); assert.equal(f.account.points_ledger_revision, 1);
  assert.equal(f.account.total_points, 1000); assert.equal(f.account.reserved_points, 0);
});
test('Identical retries share one reservation and CAS revision', async () => {
  const f = fixture(); const results = await Promise.all([reserve(f), reserve(f)]);
  assert.equal(results.filter(row => row.idempotent).length, 1);
  assert.equal(f.account.birthday_reservations.length, 1); assert.equal(f.account.points_ledger_revision, 1);
});
test('Lost committed response safely recovers without a second gift', async () => {
  const f = fixture(); f.faults.loseResponse = true;
  await assert.rejects(() => reserve(f), /lost after write/);
  assert.equal((await reserve(f)).idempotent, true); assert.equal(f.account.birthday_reservations.length, 1);
});
test('Birthday and point earnings serialize without losing either result', async () => {
  const f = fixture(); await Promise.all([reserve(f), applyPointsTransaction(f.entities, email, {
    id: 'tx-test', idempotency_key: 'birthday-fixture-earn', amount: 100, transaction_type: 'earned',
    description: 'Synthetic earning', occurred_at: '2026-09-08T18:00:00Z' })]);
  assert.equal(f.account.total_points, 1100); assert.equal(f.account.lifetime_points, 1300);
  assert.equal(f.account.points_history.length, 1); assert.equal(f.account.birthday_reservations.length, 1);
});
test('Birthday hold does not spend points or affect existing credit/points holds', async () => {
  const f = fixture(); await reserveRewardPoints(f.entities, email, { reservation_id: 'synthetic_points_hold',
    points: 500, context_hash: 'd'.repeat(64), payment_intent_id: 'pi_points' });
  const before = structuredClone(f.account); await reserve(f); await settle(f);
  for (const field of ['total_points', 'lifetime_points', 'redeemed_points', 'reserved_points',
    'points_history', 'reward_reservations', 'credit_balance', 'credit_reservations']) assert.deepEqual(f.account[field], before[field]);
});
test('Success consumes once; the same annual gift cannot be selected again', async () => {
  const f = fixture(); await reserve(f); await Promise.all([settle(f), settle(f)]);
  assert.equal(f.account.points_ledger_revision, 2); assert.equal(f.account.birthday_reservations[0].status, 'consumed');
  assert.equal(birthdayAvailability(f.account, identity, now).status, 'already_redeemed');
  await rejectsCode(() => reserve(f, request('b')), 'already_redeemed');
});
test('Next anniversary has a new cycle without erasing earlier redemption proof', async () => {
  const f = fixture(); await reserve(f); await settle(f);
  const next = Date.parse('2027-09-08T18:00:00Z'); const nextWindow = birthdayWindow({ ...identity, now: next });
  const r = { ...request('b'), cycle_year: nextWindow.cycle_year, window_start: nextWindow.window_start, window_end: nextWindow.window_end };
  await reserve(f, r, identity, next); assert.equal(f.account.birthday_reservations.length, 2);
});
test('Profile birthday changes or account-owner changes require review, not another gift', async () => {
  const f = fixture(); await reserve(f); await settle(f);
  assert.equal(birthdayAvailability(f.account, { ...identity, birthday: '1990-09-09' }, now).status, 'birthday_profile_review_required');
  assert.equal(birthdayAvailability(f.account, { ...identity, userId: 'other-user' }, now).status, 'birthday_profile_review_required');
  await rejectsCode(() => reserve(f, request('b'), { ...identity, userId: 'other-user' }), 'birthday_owner_mismatch');
});
test('Every provider/context/product/value/cycle binding survives retries', async () => {
  const f = fixture(); await reserve(f);
  for (const change of [{ context_hash: 'e'.repeat(64) }, { product_id: 'aura' }, { retail_value_cents: 1200 },
    { payment_intent_id: 'pi_other' }, { month_day: '09-09', window_start: '2026-09-09', window_end: '2026-10-09' }]) {
    await rejectsCode(() => reserve(f, { ...request(), ...change }), 'birthday_reservation_context_conflict');
  }
});
test('Same held payment can be recovered after the birthday window, not a fresh claim', async () => {
  const f = fixture(); await reserve(f);
  const later = Date.parse('2026-11-01T18:00:00Z');
  assert.equal((await reserve(f, request(), identity, later)).idempotent, true);
  await rejectsCode(() => reserve(f, request('b'), identity, later), 'outside_birthday_window');
  await settleBirthdayGift(f.entities, email, { ...request(), provider_status: 'succeeded' }, later);
  assert.equal(f.account.birthday_reservations[0].status, 'consumed');
});
test('Captured or unverified payments cannot create a new annual reservation', async () => {
  for (const provider_status of [undefined, 'succeeded', 'canceled', 'processing', 'requires_capture']) {
    const f = fixture();
    await rejectsCode(() => reserve(f, { ...request(), provider_status }), 'birthday_payment_not_reservable');
    assert.equal(f.writes.length, 0);
  }
  const f = fixture(); await reserve(f);
  assert.equal((await reserve(f, { ...request(), provider_status: 'succeeded' })).idempotent, true);
});
test('Confirmed cancellation releases; a new attempt can use that annual gift', async () => {
  const f = fixture(); await reserve(f); await settle(f, 'canceled');
  assert.equal(birthdayAvailability(f.account, identity, now).eligible, true);
  await reserve(f, request('b')); assert.equal(f.account.birthday_reservations.length, 2);
  await rejectsCode(() => reserve(f), 'birthday_reservation_already_released');
});
test('Cancellation before reservation leaves a tombstone that defeats late preparation', async () => {
  const f = fixture(); await settle(f, 'canceled');
  await rejectsCode(() => reserve(f), 'birthday_reservation_already_released');
  await reserve(f, request('b')); assert.equal(f.account.birthday_reservations[0].status, 'released');
});
test('Declines, timeouts, processing, expiry and refund cannot release birthday holds', async () => {
  const f = fixture(); await reserve(f);
  for (const status of ['requires_payment_method', 'processing', 'requires_capture', 'expired', 'refunded', 'payment_failed']) {
    await rejectsCode(() => settle(f, status), 'confirmed_birthday_payment_outcome_required');
  }
  assert.equal(f.account.birthday_reservations[0].status, 'held');
});
test('Conflicting terminal outcomes fail closed and missing successful holds cannot be invented', async () => {
  const f = fixture(); await rejectsCode(() => settle(f), 'birthday_reservation_missing');
  await reserve(f); await settle(f);
  await rejectsCode(() => settle(f, 'canceled'), 'birthday_reservation_outcome_conflict');
  const canceled = fixture(); await settle(canceled, 'canceled');
  await rejectsCode(() => settle(canceled), 'birthday_reservation_outcome_conflict');
});
test('Conditional API rejection, ambiguous response and ignored writes are never success', async () => {
  for (const [fault, code] of [['rejectCas', 'points_account_busy_retry'], ['badResponse', 'conditional_points_update_unconfirmed'],
    ['ignoreWrite', 'conditional_points_readback_unconfirmed']]) {
    const f = fixture(); f.faults[fault] = true; await rejectsCode(() => reserve(f), code);
  }
  const f = fixture(); delete f.entities.UserPoints.updateMany;
  await rejectsCode(() => reserve(f), 'conditional_points_updates_unavailable');
});
test('Malformed, duplicate and cross-owner birthday histories cannot authorize a gift', async () => {
  const f = fixture(); await reserve(f); const hold = f.account.birthday_reservations[0];
  for (const rows of [null, [hold, hold], [{ ...hold, retail_value_cents: 0 }], [{ ...hold, status: 'refunded' }],
    [{ ...hold, window_end: '2026-10-09' }], [{ ...hold, created_at: 'bad' }],
    [hold, { ...hold, reservation_id: request('b').reservation_id, payment_intent_id: 'pi_b', cycle_year: 2027,
      window_start: '2027-09-08', window_end: '2027-10-08', customer_app_user_id: 'other-user' }]]) {
    assert.throws(() => birthdayReservationState({ birthday_reservations: rows }));
  }
});
test('Malformed birthday history does not break unrelated point earnings', async () => {
  const f = fixture(); f.account.birthday_reservations = [{ invalid: true }];
  await applyPointsTransaction(f.entities, email, { id: 'tx-ordinary', idempotency_key: 'ordinary-fixture', amount: 100,
    transaction_type: 'earned', description: 'Synthetic earning', occurred_at: '2026-09-08T18:00:00Z' });
  assert.equal(f.account.total_points, 1100); await assert.rejects(() => reserve(f));
});
test('Fresh provider and exact private records prove the paid birthday binding', async () => {
  const f = fixture(); const result = await proof(f);
  assert.deepEqual(result.request, { ...request(), provider_status: 'requires_payment_method' });
  assert.equal(f.providerReads(), 1); assert.equal(f.writes.length, 0);
  assert.equal(result.request.birthday, undefined); assert.equal(result.request.customer_email, undefined);
});
test('Provider proof rejects wrong owner/mode/environment/currency/amount/status/context', async () => {
  for (const change of [f => { f.payment.id = 'pi_other'; }, f => { f.payment.livemode = false; },
    f => { f.payment.currency = 'cad'; }, f => { f.payment.amount = 2999; }, f => { f.payment.amount = 0; },
    f => { f.payment.status = 'fake'; }, f => { f.payment.metadata.customer_email = 'other@example.test'; },
    f => { f.payment.metadata.checkout_mode = 'guest'; }, f => { f.payment.metadata.checkout_version = 'old'; },
    f => { f.payment.metadata.is_test_order = 'true'; }, f => { f.payment.metadata.internal_sandbox_checkout = 'true'; },
    f => { f.payment.metadata.checkout_context_hash = 'e'.repeat(64); }]) {
    const f = fixture(); change(f); await rejectsCode(() => proof(f), 'birthday_checkout_context_unconfirmed');
    assert.equal(f.writes.length, 0);
  }
});
test('Missing/duplicate private records and inconsistent gift snapshots fail closed', async () => {
  for (const change of [f => { f.rows.Order.length = 0; }, f => { f.rows.CheckoutSession.length = 0; },
    f => { f.rows.Order.push({ ...f.rows.Order[0], id: 'duplicate' }); },
    f => { f.rows.CheckoutSession.push({ ...f.rows.CheckoutSession[0], id: 'duplicate' }); },
    f => { f.data.guest_checkout = true; }, f => { f.data.customer_email = 'other@example.test'; },
    f => { f.data.birthday_checkout.revision = 'old'; }, f => { f.data.birthday_discount = 0; },
    f => { f.data.items[1].price = 13; }, f => { f.data.items[1].birthday_product_id = 'aura'; },
    f => { f.data.items[1].size = '32oz'; }, f => { f.data.items[1].category = 'shot'; },
    f => { f.rows.Order[0].items[1].title = ''; },
    f => { f.rows.Order[0].items[1].quantity = 2; }, f => { f.rows.Order[0].is_test_order = true; },
    f => { f.rows.Order[0].payment_status = 'refunded'; }, f => { f.rows.Order[0].payment_status = 'partially_refunded'; }]) {
    const f = fixture(); change(f); await rejectsCode(() => proof(f), 'birthday_checkout_context_unconfirmed');
    assert.equal(f.writes.length, 0);
  }
});
test('Captured success requires exact received amount and no canceled order', async () => {
  const f = fixture(); f.payment.status = 'succeeded';
  await rejectsCode(() => proof(f), 'birthday_checkout_context_unconfirmed');
  f.payment.amount_received = 3000; assert.equal((await proof(f)).payment.status, 'succeeded');
  f.rows.Order[0].status = 'cancelled';
  await rejectsCode(() => proof(f), 'birthday_checkout_context_unconfirmed');
});
test('Provider unavailable does not reserve, consume or release any birthday entitlement', async () => {
  const f = fixture(); f.faults.providerOffline = true;
  await assert.rejects(() => proof(f), /provider offline/); assert.equal(f.writes.length, 0);
});
test('Synthetic paid journey quotes, verifies, reserves, settles and blocks annual replay', async () => {
  const f = fixture(); const order = f.rows.Order.pop(); const session = f.rows.CheckoutSession.pop();
  const read = await readBirthdayCheckoutEligibility(f.entities, user, now);
  assert.equal(quote({ eligibility: read.eligibility }).items[1].price, 0);
  f.rows.Order.push(order); f.rows.CheckoutSession.push(session);
  const prepared = await reserveVerifiedBirthdayCheckout({ ...f, authenticatedUser: user, paymentIntentId: 'pi_a', now });
  assert.equal(prepared.reservation_status, 'held');
  f.payment.status = 'succeeded'; f.payment.amount_received = 3000;
  const settled = await settleVerifiedBirthdayCheckout({ ...f, customerEmail: email, paymentIntentId: 'pi_a', now: now + 1000 });
  assert.equal(settled.reservation_status, 'consumed');
  assert.equal((await readBirthdayCheckoutEligibility(f.entities, user, now)).eligibility.status, 'already_redeemed');
  assert.equal(f.account.total_points, 1000); assert.equal(f.account.redeemed_points, 200);
  assert.equal(f.rows.Order[0].payment_status, 'pending'); // No operational handoff is pretended.
});
test('Preparation coordinator cannot use its own new order to mask a legacy claim', async () => {
  const f = fixture(); f.rows.Order.push({ id: 'legacy', customer_email: email, payment_status: 'paid',
    order_number: 'LEGACY-SYNTHETIC', stripe_payment_intent_id: 'pi_legacy',
    items: [{ product_id: '__birthday_reward__', price: 0, quantity: 1 }] });
  await rejectsCode(() => reserveVerifiedBirthdayCheckout({ ...f, authenticatedUser: user, paymentIntentId: 'pi_a', now }), 'birthday_history_review_required');
  assert.equal(f.writes.length, 0);
});
test('Preparation rejects different authenticated owner and captured unreserved payment', async () => {
  const f = fixture();
  await rejectsCode(() => reserveVerifiedBirthdayCheckout({ ...f, authenticatedUser: { ...user, id: 'other-user' }, paymentIntentId: 'pi_a', now }), 'birthday_owner_mismatch');
  f.payment.status = 'succeeded'; f.payment.amount_received = 3000;
  await rejectsCode(() => reserveVerifiedBirthdayCheckout({ ...f, authenticatedUser: user, paymentIntentId: 'pi_a', now }), 'birthday_payment_not_reservable');
  assert.equal(f.writes.length, 0);
});
test('Settlement coordinator defers retryable payments and accepts only fresh cancellation', async () => {
  const f = fixture();
  const result = await settleVerifiedBirthdayCheckout({ ...f, customerEmail: email, paymentIntentId: 'pi_a', now });
  assert.equal(result.deferred, true); assert.equal(result.writes_performed, false); assert.equal(f.writes.length, 0);
  f.payment.status = 'canceled';
  const canceled = await settleVerifiedBirthdayCheckout({ ...f, customerEmail: email, paymentIntentId: 'pi_a', now });
  assert.equal(canceled.reservation_status, 'released');
  const eligible = await readBirthdayCheckoutEligibility(f.entities, user, now);
  assert.equal(eligible.eligibility.eligible, true);
  f.rows.Order[0].payment_captured = true;
  assert.equal((await readBirthdayCheckoutEligibility(f.entities, user, now)).eligibility.status, 'birthday_history_review_required');
});
test('Gift schema preserves admin-only writes and paid wiring exposes no public reservation action', () => {
  const schema = JSON.parse(fs.readFileSync('base44/entities/UserPoints.jsonc', 'utf8'));
  assert.equal(schema.rls.update.user_condition.role, 'admin'); assert.equal(schema.rls.create.user_condition.role, 'admin');
  assert.equal(schema.properties.birthday_reservations.items.required.includes('payment_intent_id'), false);
  assert.equal(schema.properties.birthday_reservations.items.properties.checkout_session_id.type, 'string');
  for (const file of ['base44/functions/createPaymentIntent/entry.ts', 'base44/functions/stripeWebhook/entry.ts',
    'base44/functions/enrollNewCustomerInLoyalty/entry.ts']) {
    const source = fs.readFileSync(file, 'utf8');
    assert.equal(source.includes("action === 'reserve_birthday_checkout'"), false);
  }
  assert.ok(fs.readFileSync('base44/functions/createPaymentIntent/entry.ts', 'utf8').includes('reserveVerifiedBirthdayCheckout'));
  assert.ok(fs.readFileSync('base44/functions/stripeWebhook/entry.ts', 'utf8').includes('settleVerifiedBirthdayCheckout'));
});

for (const [name, fn] of tests) { await fn(); console.log(`PASS ${name}`); }
console.log(`Birthday entitlement: ${tests.length}/${tests.length} synthetic contracts pass; live wiring/provider/CAS unverified.`);
