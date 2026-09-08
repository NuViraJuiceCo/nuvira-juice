import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as policy from '../../base44/functions/createPaymentIntent/firstOrderEligibility.js';
import * as rewardCheckout from '../../base44/functions/createPaymentIntent/rewardCheckout.js';

let passed = 0;
async function test(name, run) {
  await run();
  passed += 1;
  console.log('PASS', name);
}
const read = path => fs.readFileSync(path, 'utf8');
const helperPath = 'base44/functions/createPaymentIntent/firstOrderEligibility.js';
const piPath = 'base44/functions/createPaymentIntent/entry.ts';
const zonePath = 'base44/functions/getCustomerAccountDashboardData/handlers/createZone3AuthorizationIntent/entry.ts';
const capturePath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/approveZone3DeliveryRequest/entry.ts';
const adminPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/manageAdminDiscountCode/entry.ts';
const email = 'buyer@example.test';
const offer = { code: 'FIRST10_QA', display_name: 'Synthetic first order', active: true,
  discount_type: 'percent', discount_kind: 'promotion', discount_value: 10,
  first_order_only: true, once_per_customer: true, ends_at: null };
function backend(data = {}, user = null) {
  const calls = [];
  const writes = [];
  const entities = {};
  for (const name of ['Order', 'ShopifyOrder', 'DeliveryApprovalRequest', 'DiscountCode', 'CommandLog']) {
    const rows = data[name] || [];
    entities[name] = {
      async filter(query, sort, limit = 50, skip = 0) {
        calls.push({ name, query, sort, limit, skip });
        const matched = rows.filter(row => Object.entries(query).every(([key, condition]) => {
          if (condition?.$regex) return new RegExp(condition.$regex, condition.$options).test(row[key] || '');
          return row[key] === condition;
        }));
        return matched.slice(skip, skip + limit);
      },
      async create(payload) { const row = { id: name + '-' + (rows.length + 1), ...payload }; rows.push(row); writes.push({ name, payload }); return row; },
      async update(id, payload) { const row = rows.find(row => row.id === id); Object.assign(row, payload); writes.push({ name, payload }); return row; },
    };
  }
  return { auth: { me: async () => user }, asServiceRole: { entities }, calls, writes };
}
const paid = (extra = {}) => ({ id: 'paid1', customer_email: email, payment_status: 'paid', total: 39, ...extra });
async function errorCode(result) { return result ? (await result.json()).error_code : null; }
function loadHandler(path, db, env = {}, stripeMock = null) {
  let served;
  const exported = { exports: {} };
  const compiled = transformSync(read(path), { loader: 'ts', format: 'cjs', target: 'es2022' }).code;
  const context = {
    module: exported, exports: exported.exports, Response, Request, URL, URLSearchParams,
    crypto: globalThis.crypto, TextEncoder, TextDecoder, setTimeout, clearTimeout,
    console: { log() {}, error() {}, warn() {} },
    Deno: { env: { get: key => env[key] }, serve: fn => { served = fn; } },
    fetch: () => { throw new Error('External network forbidden in regression'); },
    require: name => {
      if (name.includes('@base44/sdk')) return { createClientFromRequest: () => db };
      if (name.includes('firstOrderEligibility')) return policy;
      if (name.includes('rewardCheckout')) return rewardCheckout;
      if (name.includes('stripe')) return class {
        constructor() {
          this.paymentIntents = stripeMock || new Proxy({}, { get: () => async () => { throw new Error('Provider calls forbidden'); } });
        }
      };
      throw new Error('Unexpected dependency ' + name);
    },
  };
  vm.runInNewContext(compiled, context);
  return served || exported.exports.default;
}
const request = payload => new Request('https://unit.test/function', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

await test('three deployment packages contain the identical standalone policy', () => {
  for (const name of ['getCustomerAccountDashboardData', 'getAdminOperationsDashboardSummary']) {
    assert.equal(read('base44/functions/' + name + '/firstOrderEligibility.js'), read(helperPath));
  }
});
await test('existing offers require no new history reads or expiry', async () => {
  assert.equal(policy.firstOrderOfferIsConfigured({ code: 'NUVIRASUMMER' }), true);
  assert.equal(await policy.firstOrderEligibilityBlock({}, { code: 'NUVIRASUMMER' }, email), null);
});
await test('ongoing first-order offers require one-use enforcement, with valid optional expiration', () => {
  assert.equal(policy.firstOrderOfferIsConfigured(offer), true);
  for (const value of ['', null, undefined, '2099-01-01T00:00:00.000Z']) assert.equal(policy.firstOrderOfferIsConfigured({ ...offer, ends_at: value }), true);
  assert.equal(policy.firstOrderOfferIsConfigured({ ...offer, ends_at: 'invalid' }), false);
  assert.equal(policy.firstOrderOfferIsConfigured({ ...offer, once_per_customer: false }), false);
});
await test('guest without paid history is eligible without account or writes', async () => {
  const db = backend();
  assert.equal(await policy.firstOrderEligibilityBlock(db, offer, email), null);
  assert.equal(db.calls.length, 3);
  assert.equal(db.writes.length, 0);
});
await test('member without paid history is eligible', async () => {
  assert.equal(await policy.firstOrderEligibilityBlock(backend(), offer, email, email), null);
});
for (const [name, evidence] of [
  ['native paid with no promotion', { Order: [paid()] }],
  ['native paid with a different code', { Order: [paid({ promotion_code: 'DIFFERENT' })] }],
  ['Shopify POS purchase', { ShopifyOrder: [paid({ financial_status: 'paid', payment_status: '', source_channel: 'pos' })] }],
  ['Shopify online purchase', { ShopifyOrder: [paid({ financial_status: 'paid', payment_status: '', source_channel: 'online_store' })] }],
  ['captured route review', { DeliveryApprovalRequest: [paid({ status: 'captured', payment_status: '' })] }],
  ['route authorization succeeded', { DeliveryApprovalRequest: [paid({ stripe_authorization_status: 'succeeded', payment_status: '' })] }],
  ['partially refunded paid purchase', { Order: [paid({ payment_status: 'partially_refunded' })] }],
  ['fully refunded paid purchase', { ShopifyOrder: [paid({ payment_status: '', financial_status: 'refunded' })] }],
]) {
  await test(name + ' consumes first-order eligibility', async () => {
    assert.equal(await errorCode(await policy.firstOrderEligibilityBlock(backend(evidence), offer, email)), 'FIRST_ORDER_OFFER_NOT_ELIGIBLE');
  });
}
for (const [name, row] of [
  ['unpaid attempt', paid({ payment_status: 'pending' })],
  ['cancelled unpaid attempt', paid({ payment_status: 'unpaid', status: 'cancelled' })],
  ['uncaptured hold', paid({ payment_status: 'authorized', stripe_authorization_status: 'requires_capture' })],
  ['fulfilled without payment evidence', paid({ payment_status: '', status: 'delivered' })],
  ['explicit test order', paid({ is_test_order: true })],
  ['provider test order', paid({ test: true })],
  ['sandbox number', paid({ order_number: 'NV-SBX-123' })],
  ['recording test order', paid({ order_number: 'G81-TEST-OASIS5-RECORDING' })],
]) {
  await test(name + ' does not consume first-order eligibility', async () => {
    assert.equal(await policy.firstOrderEligibilityBlock(backend({ Order: [row] }), offer, email), null);
  });
}
await test('case and whitespace are normalized in stored and submitted email', async () => {
  const db = backend({ Order: [paid({ customer_email: '  Buyer@Example.Test  ' })] });
  assert.equal(await errorCode(await policy.firstOrderEligibilityBlock(db, offer, ' BUYER@example.TEST ')), 'FIRST_ORDER_OFFER_NOT_ELIGIBLE');
});
await test('regex metacharacters are literal and other identities are not matched', async () => {
  const literal = 'first+tag.name@example.test';
  const db = backend({ Order: [paid({ customer_email: 'firstttagXname@example.test' })] });
  assert.equal(await policy.firstOrderEligibilityBlock(db, offer, literal), null);
  const db2 = backend({ Order: [paid({ customer_email: literal })] });
  assert.equal(await errorCode(await policy.firstOrderEligibilityBlock(db2, offer, literal)), 'FIRST_ORDER_OFFER_NOT_ELIGIBLE');
});
await test('signed-in account history cannot be bypassed via a new receipt email', async () => {
  assert.equal(await errorCode(await policy.firstOrderEligibilityBlock(backend({ Order: [paid()] }), offer, 'other@example.test', email)), 'FIRST_ORDER_OFFER_NOT_ELIGIBLE');
});
await test('older purchases beyond first 200 rows are checked', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => paid({ id: 'pending' + index, payment_status: 'pending' }));
  rows.push(paid({ id: 'older-paid' }));
  const db = backend({ Order: rows });
  assert.equal(await errorCode(await policy.firstOrderEligibilityBlock(db, offer, email)), 'FIRST_ORDER_OFFER_NOT_ELIGIBLE');
  assert.equal(db.calls[1].skip, 200);
});
await test('lookup failure fails closed without PII or provider error leakage', async () => {
  const db = backend();
  db.asServiceRole.entities.Order.filter = async () => { throw new Error('secret ' + email); };
  const result = await policy.firstOrderEligibilityBlock(db, offer, email);
  assert.equal(result.status, 503);
  const text = await result.text();
  assert.ok(!text.includes(email) && !text.includes('secret'));
});
await test('malformed and cross-customer history responses fail closed', async () => {
  for (const rows of [null, {}, [paid({ customer_email: 'wrong@example.test' })]]) {
    const db = backend();
    db.asServiceRole.entities.Order.filter = async () => rows;
    assert.equal((await policy.firstOrderEligibilityBlock(db, offer, email)).status, 503);
  }
});
await test('repeating pagination is blocked instead of claiming complete history', async () => {
  const db = backend();
  db.asServiceRole.entities.Order.filter = async () => Array.from({ length: 200 }, (_, index) => paid({ id: String(index), payment_status: 'pending' }));
  assert.equal((await policy.firstOrderEligibilityBlock(db, offer, email)).status, 503);
});
await test('missing email is blocked without history queries', async () => {
  for (const invalid of ['', 'invalid', 'x y@example.test']) {
    const db = backend();
    assert.equal((await policy.firstOrderEligibilityBlock(db, offer, invalid)).status, 400);
    assert.equal(db.calls.length, 0);
  }
});
await test('new offer does not stack; existing promo behavior is preserved', async () => {
  for (const amounts of [[1, 0, 0], [0, 2, 0], [0, 0, 3]]) assert.equal((await policy.firstOrderStackingBlock(offer, amounts)).status, 400);
  assert.equal(policy.firstOrderStackingBlock(offer, [0, 0, 0]), null);
  assert.equal(policy.firstOrderStackingBlock({ code: 'NUVIRASUMMER' }, [3, 2, 1]), null);
});
await test('zero-dollar rewards and free items cannot bypass the new offer non-stacking rule', async () => {
  for (const checkout of [
    { active_reward: { reward_type: 'double_points' } },
    { points_used: 500 },
    { items: [{ product_id: 'synthetic', isFreeReward: true, price: 0 }] },
    { items: [{ product_id: '__free_reward_synthetic__', price: 0 }] },
  ]) {
    assert.equal(policy.firstOrderStackingBlock(offer, [0, 0, 0], checkout).status, 400);
    assert.equal(policy.firstOrderStackingBlock({ code: 'NUVIRASUMMER' }, [0, 0, 0], checkout), null);
  }
  assert.equal(policy.firstOrderStackingBlock(offer, [0], { items: [{ product_id: 'synthetic', price: 13 }] }), null);
});
for (const [path, normalizer, resolver] of [
  [piPath, 'normalizePromotionCode', 'resolvePromotion'],
  [zonePath, 'normalizeDiscountCode', 'resolveDiscount'],
]) {
  await test(resolver + ' honors an optional explicit deadline, exclusively', async () => {
    const source = read(path);
    const context = { firstOrderOfferIsConfigured: policy.firstOrderOfferIsConfigured };
    vm.runInNewContext(source.slice(source.indexOf('function ' + normalizer), source.indexOf('function normalizeNamePart')) +
      '\nthis.resolve = ' + resolver + ';', context);
    const cutoff = '2026-10-01T05:00:00.000Z';
    const seasonal = { ...offer, ends_at: cutoff };
    const db = backend({ DiscountCode: [seasonal] });
    assert.equal((await context.resolve(db, offer.code, 39, new Date('2026-10-01T04:59:59.999Z'))).amount, 3.9);
    assert.equal(await context.resolve(db, offer.code, 39, new Date(cutoff)), null);
    assert.equal(await context.resolve(db, offer.code, 39, new Date('2026-10-01T05:00:00.001Z')), null);
    const legacy = backend({ DiscountCode: [{ ...seasonal, first_order_only: false }] });
    assert.equal((await context.resolve(legacy, offer.code, 39, new Date(cutoff))).amount, 3.9);
  });
  await test(resolver + ' keeps an ongoing first-order offer available across month and year boundaries', async () => {
    const source = read(path);
    const context = { firstOrderOfferIsConfigured: policy.firstOrderOfferIsConfigured };
    vm.runInNewContext(source.slice(source.indexOf('function ' + normalizer), source.indexOf('function normalizeNamePart')) +
      '\nthis.resolve = ' + resolver + ';', context);
    for (const instant of ['2026-09-30T23:59:59.000Z', '2026-10-01T05:00:00.000Z', '2027-01-01T06:00:00.000Z', '2099-01-01T00:00:00.000Z']) {
      const db = backend({ DiscountCode: [offer] });
      assert.equal((await context.resolve(db, offer.code, 39, new Date(instant))).amount, 3.9);
      assert.equal(db.writes.length, 0);
    }
  });
}
for (const member of [false, true]) {
  await test((member ? 'member' : 'guest') + ' real validation handler accepts eligible 10% offer with $3.90 savings and no writes', async () => {
    const db = backend({ DiscountCode: [offer] }, member ? { email, role: 'user' } : null);
    const response = await loadHandler(piPath, db)(request({ mode: 'validate_discount_code', discount_code: offer.code,
      eligible_subtotal: 39, customer_email: email, guest_checkout: !member }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.discount.amount, 3.9);
    assert.equal(payload.discount.first_order_only, true);
    assert.equal(db.writes.length, 0);
  });
  await test((member ? 'member' : 'guest') + ' Trio example is $36 less $3.60, not three separate $13 bottles', async () => {
    const db = backend({ DiscountCode: [offer] }, member ? { email, role: 'user' } : null);
    const response = await loadHandler(piPath, db)(request({ mode: 'validate_discount_code', discount_code: offer.code,
      eligible_subtotal: 36, customer_email: email, guest_checkout: !member }));
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.discount.amount, 3.6);
    assert.equal(Math.round((36 - payload.discount.amount) * 100), 3240);
    assert.equal(db.writes.length, 0);
  });
}
await test('actual validation rejects prior buyer, expiry, malformed expiry and stacking', async () => {
  for (const [data, payload, expected] of [
    [{ Order: [paid()], DiscountCode: [offer] }, {}, 409],
    [{ DiscountCode: [{ ...offer, ends_at: '2020-01-01T00:00:00Z' }] }, {}, 400],
    [{ DiscountCode: [{ ...offer, ends_at: 'invalid' }] }, {}, 400],
    [{ DiscountCode: [offer] }, { points_discount: 1 }, 400],
    [{ DiscountCode: [offer] }, { active_reward: { reward_type: 'double_points' } }, 400],
    [{ DiscountCode: [offer] }, { items: [{ product_id: '__free_reward_synthetic__' }] }, 400],
  ]) {
    const db = backend(data);
    const result = await loadHandler(piPath, db)(request({ mode: 'validate_discount_code', discount_code: offer.code,
      eligible_subtotal: 39, customer_email: email, guest_checkout: true, ...payload }));
    assert.equal(result.status, expected);
    assert.equal(db.writes.length, 0);
  }
});
await test('admin rejects repeated-use first-order offers before writing', async () => {
  const db = backend({}, { email: 'admin@example.test', role: 'admin' });
  const result = await loadHandler(adminPath, db)(request({ ...offer, once_per_customer: false, action: 'upsert',
    request_id: 'qa-unbounded', confirmation: 'SAVE FIRST10_QA' }));
  assert.equal(result.status, 400);
  assert.equal(db.writes.length, 0);
});
await test('admin can save an ongoing inactive offer; no real record is created', async () => {
  const db = backend({}, { email: 'admin@example.test', role: 'admin' });
  const result = await loadHandler(adminPath, db)(request({ ...offer, active: false, action: 'upsert',
    request_id: 'qa-draft', confirmation: 'SAVE FIRST10_QA' }));
  assert.equal(result.status, 200);
  const payload = await result.json();
  assert.equal(payload.row.first_order_only, true);
  assert.equal(payload.row.active, false);
  assert.equal(payload.row.ends_at, null);
});
await test('old admin client cannot silently erase first-order restriction', async () => {
  const stored = { id: 'offer1', ...offer };
  const db = backend({ DiscountCode: [stored] }, { email: 'admin@example.test', role: 'admin' });
  const { first_order_only: _policy, ...legacyBody } = offer;
  const response = await loadHandler(adminPath, db)(request({ ...legacyBody, action: 'upsert', discount_code_id: 'offer1',
    request_id: 'qa-legacy', confirmation: 'SAVE FIRST10_QA' }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).row.first_order_only, true);
});
await test('old admin toggle cannot activate an unsafe first-order record', async () => {
  const db = backend({ DiscountCode: [{ ...offer, id: 'unsafe', once_per_customer: false, active: false }] }, { email: 'admin@example.test', role: 'admin' });
  const result = await loadHandler(adminPath, db)(request({ action: 'toggle_active', discount_code_id: 'unsafe',
    active: true, request_id: 'qa-toggle', confirmation: 'SET unsafe ACTIVE' }));
  assert.equal(result.status, 400);
  assert.equal(db.writes.length, 0);
});
await test('actual route authorization rejects a prior buyer before any hold or record write', async () => {
  const db = backend({ DiscountCode: [offer], Order: [paid()] }, { email, role: 'user' });
  const result = await loadHandler(zonePath, db)(request({
    customer_email: email, discount_code: offer.code, subtotal: 78, discount_eligible_subtotal: 78,
    items: [{ product_id: 'synthetic', title: 'Synthetic juice', price: 13, quantity: 6 }],
    customer_acknowledged_hold: true, contact_phone: '2025550100',
    address_line1: '1 Test Street', address_city: 'Example', address_state: 'MO', address_postal_code: '63366',
  }));
  assert.equal(result.status, 409);
  assert.equal(await errorCode(result), 'FIRST_ORDER_OFFER_NOT_ELIGIBLE');
  assert.equal(db.writes.length, 0);
});
await test('actual route capture rejects newly consumed eligibility and never raises/captures the price', async () => {
  const db = backend({ Order: [paid()], DeliveryApprovalRequest: [{ id: 'route1', customer_email: email,
    status: 'pending_review', stripe_payment_intent_id: 'pi_synthetic', discount_code: offer.code,
    discount_first_order_only: true }] }, { email: 'admin@example.test', role: 'admin' });
  let captures = 0;
  const result = await loadHandler(capturePath, db, { ENABLE_ZONE3_ROUTE_REVIEW_DECISIONS: 'true' }, {
    retrieve: async () => ({ status: 'requires_capture', metadata: { discount_first_order_only: 'true' } }),
    capture: async () => { captures++; throw new Error('Must not capture'); },
  })(request({ dar_id: 'route1', admin_decision_reason: 'Synthetic verification' }));
  assert.equal(result.status, 409);
  assert.equal(await errorCode(result), 'FIRST_ORDER_OFFER_NOT_ELIGIBLE');
  assert.equal(captures, 0);
  assert.equal(db.writes.length, 0);
});
await test('actual route capture lookup failure leaves the hold and price unchanged', async () => {
  const db = backend({ DeliveryApprovalRequest: [{ id: 'route1', customer_email: email,
    status: 'pending_review', stripe_payment_intent_id: 'pi_synthetic', discount_code: offer.code,
    discount_first_order_only: true }] }, { email: 'admin@example.test', role: 'admin' });
  db.asServiceRole.entities.Order.filter = async () => { throw new Error('Synthetic outage'); };
  let captures = 0;
  const result = await loadHandler(capturePath, db, { ENABLE_ZONE3_ROUTE_REVIEW_DECISIONS: 'true' }, {
    retrieve: async () => ({ status: 'requires_capture', metadata: {} }),
    capture: async () => { captures++; throw new Error('Must not capture'); },
  })(request({ dar_id: 'route1', admin_decision_reason: 'Synthetic verification' }));
  assert.equal(result.status, 503);
  assert.equal(captures, 0);
  assert.equal(db.writes.length, 0);
});
await test('server guard is present at validation, standard checkout, authorization and capture', () => {
  const pi = read(piPath), zone = read(zonePath), capture = read(capturePath);
  assert.equal((pi.match(/await firstOrderEligibilityBlock\(/g) || []).length, 2);
  assert.ok(pi.indexOf('const firstOrderBlock', pi.indexOf('const promotion = await resolvePromotion')) < pi.indexOf('await checkoutStripe.paymentIntents.create'));
  assert.ok(zone.indexOf('await firstOrderEligibilityBlock') < zone.indexOf('entities.DeliveryApprovalRequest.create'));
  assert.ok(zone.indexOf('await firstOrderEligibilityBlock') < zone.indexOf('await stripe.paymentIntents.create'));
  assert.ok(capture.indexOf('await firstOrderEligibilityBlock') < capture.indexOf('await stripe.paymentIntents.capture'));
  assert.match(zone, /discount_first_order_only: discount.first_order_only === true/);
  assert.match(capture, /dar.discount_first_order_only === true/);
  assert.match(capture, /pi.metadata\?\.discount_account_email/);
});
await test('schema, UI, trusted command and gateway packaging support the opt-in policy', () => {
  const schema = JSON.parse(read('base44/entities/DiscountCode.jsonc'));
  assert.equal(schema.properties.first_order_only.default, false);
  assert.equal(schema.rls.update.user_condition.role, 'admin');
  assert.match(read('src/pages/admin/DiscountCodes.jsx'), /First order only/);
  assert.match(read('src/pages/admin/DiscountCodes.jsx'), /first_order_only: form.first_order_only/);
  assert.match(read('src/pages/Checkout.jsx'), /points_discount: isGuestCheckout \? 0 : pointsDiscount/);
  for (const root of ['getAdminOperationsDashboardSummary', 'getCustomerAccountDashboardData']) {
    assert.match(read('base44/functions/' + root + '/entry.ts'), /Bundle revision: first-order-offer-20260907/);
  }
});
console.log('First-order offer tests: ' + passed + ' passed; mocked data/providers only, no live writes.');
