import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { buildSync } from 'esbuild';
import { createRewardNativeHandoffAdapter } from '../../base44/functions/stripeWebhook/rewardNativeHandoff.js';
import { nativeItemSnapshot } from '../../base44/functions/syncOrderToHub/nativeItemSnapshot.js';

// Actual adapter -> actual root -> actual native order writer + production
// materializer. Only storage, transport and the existing safe-sync planner are
// simulated. Network/provider calls are forbidden; no real records are touched.
const compiled = buildSync({ entryPoints: ['base44/functions/syncOrderToHub/entry.ts'], bundle: true,
  write: false, platform: 'node', format: 'cjs', external: ['npm:*'] }).outputFiles[0].text;
const tests = []; const test = (name, run) => tests.push([name, run]);
const copy = value => structuredClone(value);
function fixture() {
  const order = { id: 'synthetic_order', order_number: 'NV-SYNTHETIC-NATIVE', customer_name: 'Synthetic Tester',
    customer_email: 'synthetic@example.test', contact_phone: '+12025550123', total: 0, subtotal: 0,
    payment_captured: false, payment_status: 'paid', financial_status: 'paid', status: 'scheduled_for_juicing',
    assigned_production_day: '2026-09-11', assigned_delivery_date: '2026-09-12',
    delivery_window_label: 'Saturday 12 PM – 3 PM', address_line1: '1 Synthetic Street', address_line2: 'Unit 1',
    address_city: 'Testville', address_state: 'MO', address_postal_code: '00000',
    delivery_address: '1 Synthetic Street Unit 1, Testville, MO 00000', stripe_checkout_session_id: 'cs_live_SYNTHETIC',
    items: ['OASIS', 'AURA', 'RE-NU'].map((title, index) => ({ product_id: `synthetic_product_${index}`, title,
      quantity: 2, price: 0, image_url: `https://synthetic.invalid/${index}.png`, category: 'juice', size: '12 oz',
      cart_line_key: `reward:synthetic_reward:synthetic_product_${index}`, reward_id: 'synthetic_reward',
      reward_type: 'vip_box', isFreeReward: true, catalog_unit_price: 13, reward_discount_amount: 26 })),
    reward_settlement: { revision: '2026-09-08.reward-settlement-v1', checkout_session_id: 'cs_live_SYNTHETIC',
      context_hash: 'a'.repeat(64), reservation_id: 'synthetic_reservation', points_redeemed: 2000,
      provider_event_id: 'evt_SYNTHETIC', settled_at: '2026-09-08T08:00:00Z' },
    reward_handoff: { revision: '2026-09-08.reward-handoff-v1', checkout_session_id: 'cs_live_SYNTHETIC',
      context_hash: 'a'.repeat(64), steps: { native_operations: { state: 'dispatching', attempt_id: 'synthetic_attempt' } } } };
  const rows = { Order: [order], CheckoutSession: [{ id: 'synthetic_context', stripe_session_id: order.stripe_checkout_session_id,
    customer_email: order.customer_email, order_number: order.order_number, checkout_data: {
      checkout_context_hash: 'a'.repeat(64), reward_reservation_id: 'synthetic_reservation', total: 0, items: copy(order.items),
    } }], ShopifyOrder: [], FulfillmentTask: [], ProductionBatch: [],
    Recipe: [], Bundle: [], Product: [], InventoryItem: [], IngredientYield: [], CommandLog: [], OrderSyncLog: [], OrderReviewQueue: [] };
  const calls = []; const faults = {};
  const match = (row, query) => Object.entries(query).every(([key, value]) => row[key] === value);
  const entities = Object.fromEntries(Object.keys(rows).map(name => [name, {
    filter: async (query, _sort, limit) => {
      calls.push(`read:${name}`);
      if (faults.read === name) throw new Error('Synthetic read error');
      return copy(rows[name].filter(row => match(row, query)).slice(0, limit));
    },
    list: async (_sort, limit) => {
      calls.push(`list:${name}`);
      if (faults.list === name) throw new Error('Synthetic list error');
      return copy(rows[name].slice(0, limit));
    },
    create: async data => {
      calls.push(`create:${name}`);
      if (faults.create === name) throw new Error('Synthetic create error');
      const row = { ...copy(data), id: `synthetic_${name}_${rows[name].length}` }; rows[name].push(row);
      if (faults.afterCreate) faults.afterCreate(name, row);
      if (faults.lostCreate === name) throw new Error('Synthetic lost create response');
      return copy(row);
    },
    update: async (id, data) => {
      calls.push(`update:${name}`); const row = rows[name].find(row => row.id === id); assert.ok(row);
      Object.assign(row, copy(data)); return copy(row);
    },
  }]));
  let handler;
  const base44 = { auth: { me: async () => null }, asServiceRole: { entities, functions: {
    invoke: async (name, payload) => {
      calls.push(`invoke:${name}`);
      assert.equal(name, 'getAdminOperationsDashboardSummary');
      assert.equal(payload.gateway_action, 'previewNativeSafeSyncOrderUpdate');
      if (faults.planner) return { data: { success: false, would_reject: true } };
      return { data: { success: true, accepted_fields: copy(payload.payload.incoming_payload) } };
    },
    fetch: async (path, options) => {
      calls.push(`fetch:${path}`); assert.equal(path, '/syncOrderToHub');
      assert.equal(options.headers['x-internal-secret'], 'synthetic-secret');
      if (faults.beforeFetch) faults.beforeFetch(order);
      const response = await handler(new Request(`https://synthetic.invalid${path}`, options));
      if (faults.lostResponse) throw new Error('Synthetic lost function response');
      return response;
    },
  } } };
  const sandbox = { exports: {}, Request, Response, Headers, AbortSignal, TextEncoder, TextDecoder,
    Date, Intl, URL, URLSearchParams, crypto: webcrypto,
    console: { log() {}, warn() {}, error() {} }, setTimeout: fn => { fn(); return 0; },
    require: spec => { assert.match(spec, /^npm:@base44\/sdk@/); return { createClientFromRequest: () => base44 }; },
    Deno: { serve: fn => { handler = fn; }, env: { get: key => ({ ENABLE_NATIVE_ORDER_OPS: 'true',
      CUSTOMER_APP_SYNC_SECRET: 'synthetic-secret', NATIVE_ORDER_OPS_SECRET: 'synthetic-native-secret' })[key] || '' } },
    fetch: async () => { throw new Error('External provider/network is forbidden'); } };
  vm.runInNewContext(compiled, sandbox);
  const adapter = createRewardNativeHandoffAdapter({ base44, internalSecret: 'synthetic-secret' }).native_operations;
  const input = () => ({ order: copy(order), idempotencyKey: `reward_handoff:${order.id}:native_operations` });
  const create = () => adapter.perform(input()); const reconcile = () => adapter.reconcile(input());
  return { order, rows, calls, faults, create, reconcile, input, adapter, handler, sandbox, base44 };
}
test('exact six earned bottles create one native order, one delivery task and three planned flavors', async () => {
  const f = fixture(); const before = copy(f.order); const receipt = await f.create();
  assert.equal(receipt.outcome, 'completed'); assert.deepEqual(f.order, before);
  assert.equal(f.rows.ShopifyOrder.length, 1); assert.equal(f.rows.FulfillmentTask.length, 1);
  assert.equal(f.rows.ProductionBatch.length, 3);
  assert.deepEqual(f.rows.ProductionBatch.map(row => row.planned_units), [2, 2, 2]);
  assert.ok(f.rows.ProductionBatch.every(row => row.status === 'planned' && row.is_locked === false
    && row.production_date === '2026-09-11' && !row.actual_units && !row.ph_result));
  for (const [index, item] of f.rows.FulfillmentTask[0].items.entries()) {
    assert.equal(item.product_id, f.order.items[index].product_id);
    assert.equal(item.size, '12 oz'); assert.equal(item.catalog_unit_price, 13); assert.equal(item.reward_discount_amount, 26);
  }
  assert.ok(f.calls.indexOf('create:FulfillmentTask') < f.calls.indexOf('create:ProductionBatch'));
  assert.ok(!f.calls.some(call => /create:(Order|InventoryItem|IngredientYield)$|update:Order$/.test(call)));
});
test('reconcile and repeated adapter perform do not write or re-invoke', async () => {
  const f = fixture(); await f.create(); f.calls.length = 0;
  assert.equal((await f.reconcile()).outcome, 'completed'); assert.equal((await f.create()).outcome, 'completed');
  assert.ok(f.calls.every(call => call.startsWith('read:')));
});
function setBundle(f) {
  const parts = f.order.items.map(item => ({ product_id: item.product_id, product_name: item.title, quantity: 1 }));
  f.order.items = [{ ...f.order.items[0], product_id: 'synthetic_trio', title: 'The NuVira Trio',
    category: 'bundle', quantity: 2, bottles_per_unit: 3, bundle_composition: parts }];
  f.rows.CheckoutSession[0].checkout_data.items = copy(f.order.items);
}
test('an earned bundle uses its purchased composition instead of a later changed catalog', async () => {
  const f = fixture(); setBundle(f);
  f.rows.Bundle.push({ id: 'synthetic_catalog_bundle', bundle_name: 'The NuVira Trio', is_active: true,
    components: [{ product_name: 'Wrong newer flavor', quantity: 10 }] });
  assert.equal((await f.create()).outcome, 'completed');
  assert.deepEqual(f.rows.ProductionBatch.map(batch => [batch.product_name, batch.planned_units]),
    [['OASIS', 2], ['AURA', 2], ['RE-NU', 2]]);
  assert.ok(f.rows.ProductionBatch.every(batch => batch.order_sources[0].source_type === 'bundle'
    && batch.order_sources[0].source_item === 'The NuVira Trio'));
  assert.deepEqual(f.rows.FulfillmentTask[0].items[0].bundle_composition, f.order.items[0].bundle_composition);
  assert.equal((await f.reconcile()).outcome, 'completed');
});
test('an earned bundle does not require a still-existing catalog bundle to produce its saved bottles', async () => {
  const f = fixture(); setBundle(f); assert.equal((await f.create()).outcome, 'completed');
  assert.equal(f.rows.ProductionBatch.reduce((sum, batch) => sum + batch.planned_units, 0), 6);
});
test('an inconsistent saved bundle is rejected before any record creation', async () => {
  const f = fixture(); setBundle(f); f.order.items[0].bottles_per_unit = 4;
  f.rows.CheckoutSession[0].checkout_data.items = copy(f.order.items);
  await assert.rejects(f.create); assert.ok(!f.calls.some(call => call.startsWith('create:')));
});
for (const name of ['ShopifyOrder', 'Order', 'FulfillmentTask', 'Bundle', 'Product']) {
  test(`${name} full planning page cannot silently omit demand or overwrite batch totals`, async () => {
    const f = fixture();
    // The native proof lookups remain exact; the materializer list is the page under test.
    const list = f.base44.asServiceRole.entities[name].list;
    f.base44.asServiceRole.entities[name].list = async (...args) => {
      const rows = await list(...args);
      return [...rows, ...Array.from({ length: 500 - rows.length }, (_, index) => ({ id: `synthetic_page_${index}` }))];
    };
    await assert.rejects(f.create);
    assert.ok(!f.calls.some(call => /^(create|update):ProductionBatch$/.test(call)));
  });
}
test('a lost root response is recovered from actual persisted records without another dispatch', async () => {
  const f = fixture(); f.faults.lostResponse = true; await assert.rejects(f.create);
  f.calls.length = 0; assert.equal((await f.reconcile()).outcome, 'completed');
  assert.ok(f.calls.every(call => call.startsWith('read:')));
});
for (const entity of ['ShopifyOrder', 'FulfillmentTask', 'ProductionBatch']) {
  test(`${entity} read failure is not treated as absence`, async () => {
    const f = fixture(); f.faults.read = entity; await assert.rejects(f.create);
    assert.ok(!f.calls.some(call => call.startsWith('create:') || call.startsWith('fetch:')));
  });
  test(`${entity} partial lost-write acknowledgement cannot trigger another creation`, async () => {
    const f = fixture(); f.faults.lostCreate = entity; await assert.rejects(f.create);
    f.calls.length = 0; await assert.rejects(f.reconcile); await assert.rejects(f.create);
    assert.ok(f.calls.every(call => call.startsWith('read:')));
  });
  test(`${entity} duplicate records fail independent proof`, async () => {
    const f = fixture(); await f.create(); f.rows[entity].push({ ...copy(f.rows[entity][0]), id: 'synthetic_duplicate' });
    await assert.rejects(f.reconcile);
  });
}
for (const [name, mutate] of Object.entries({
  wrong_product: f => { f.rows.FulfillmentTask[0].items[0].product_id = 'wrong'; },
  wrong_size: f => { f.rows.FulfillmentTask[0].items[0].size = '32 oz'; },
  wrong_quantity: f => { f.rows.FulfillmentTask[0].items[0].quantity += 1; },
  wrong_reward: f => { f.rows.ShopifyOrder[0].line_items[0].reward_id = 'wrong'; },
  wrong_customer: f => { f.rows.FulfillmentTask[0].customer_email = 'wrong@example.test'; },
  wrong_delivery: f => { f.rows.FulfillmentTask[0].delivery_date = '2026-09-13'; },
  wrong_production: f => { f.rows.ShopifyOrder[0].production_date = '2026-09-12'; },
  wrong_address: f => { f.rows.FulfillmentTask[0].address_line1 = 'Wrong'; },
  wrong_total: f => { f.rows.ShopifyOrder[0].total_price = 78; },
  wrong_batch_quantity: f => { f.rows.ProductionBatch[0].order_sources[0].quantity = 3; f.rows.ProductionBatch[0].planned_units = 3; },
  wrong_batch_flavor: f => { f.rows.ProductionBatch[0].product_name = 'Wrong'; },
  wrong_batch_customer: f => { f.rows.ProductionBatch[0].order_sources[0].customer_email = 'wrong@example.test'; },
  archived_batch: f => { f.rows.ProductionBatch[0].status = 'archived'; },
})) test(`${name} is rejected by readback`, async () => {
  const f = fixture(); await f.create(); mutate(f); f.calls.length = 0; await assert.rejects(f.reconcile);
  assert.ok(f.calls.every(call => call.startsWith('read:')));
});
for (const [name, mutate] of Object.entries({
  refunded: o => { o.status = 'refunded'; },
  unpaid: o => { o.payment_status = 'pending'; },
  captured: o => { o.payment_captured = true; },
  test_order: o => { o.is_test_order = true; },
  wrong_claim: o => { o.reward_handoff.steps.native_operations.attempt_id = 'changed'; },
  wrong_item: o => { o.items[0].product_id = 'changed'; },
  wrong_address: o => { o.address_line1 = 'Changed address'; },
  already_started: o => { o.status = 'in_production'; },
})) test(`${name} appearing immediately before dispatch cannot create records`, async () => {
  const f = fixture(); f.faults.beforeFetch = mutate; await assert.rejects(f.create);
  assert.ok(!f.calls.some(call => call.startsWith('create:')));
});
test('a completed production lifecycle is read-only reconcilable, never reset', async () => {
  const f = fixture(); await f.create(); f.order.status = 'delivered';
  for (const batch of f.rows.ProductionBatch) { batch.status = 'verified_logged'; batch.is_locked = true; }
  f.rows.FulfillmentTask[0].status = 'delivered'; f.rows.ShopifyOrder[0].fulfillment_status = 'delivered';
  const before = copy(f.rows); f.calls.length = 0;
  assert.equal((await f.reconcile()).outcome, 'completed'); assert.deepEqual(f.rows, before);
  assert.ok(f.calls.every(call => call.startsWith('read:')));
});
test('native strict duplicate request does not reset an already-started mirror', async () => {
  const f = fixture(); await f.create(); f.rows.ShopifyOrder[0].production_status = 'in_production';
  const body = { ...f.input(), order_id: f.order.id, native_only: true,
    reward_native_handoff: { revision: '2026-09-08.reward-native-handoff-v1',
      checkout_session_id: f.order.stripe_checkout_session_id, context_hash: 'a'.repeat(64),
      idempotency_key: f.input().idempotencyKey, attempt_id: 'synthetic_attempt' } };
  f.calls.length = 0;
  const response = await f.handler(new Request('https://synthetic.invalid/native', { method: 'POST',
    headers: { 'x-internal-secret': 'synthetic-secret' }, body: JSON.stringify(body) }));
  assert.equal(response.ok, false); assert.ok(f.calls.every(call => call.startsWith('read:')));
});
test('optional item metadata is declared on both persistent projection schemas', () => {
  const order = JSON.parse(fs.readFileSync('base44/entities/Order.jsonc')).properties.items.items.properties;
  const mirror = JSON.parse(fs.readFileSync('base44/entities/ShopifyOrder.jsonc')).properties.line_items.items.properties;
  const task = JSON.parse(fs.readFileSync('base44/entities/FulfillmentTask.jsonc')).properties.items.items.properties;
  for (const key of Object.keys(order)) { assert.ok(mirror[key], `ShopifyOrder.${key}`); assert.ok(task[key], `FulfillmentTask.${key}`); }
});
test('legacy no-metadata lines remain valid and product ID never becomes a synthetic reward ID', () => {
  assert.deepEqual(nativeItemSnapshot({ title: 'Legacy', quantity: 1, price: 13 }), {});
  assert.throws(() => nativeItemSnapshot({ title: 'Legacy', quantity: 1, price: 13 }, true));
  const f = fixture(); const item = f.order.items[0]; assert.equal(nativeItemSnapshot(item, true).product_id, item.product_id);
});
export { fixture as createNativeFixture };
if (process.argv[1]?.endsWith('run-reward-native-handoff-tests.mjs')) {
let passed = 0;
for (const [name, run] of tests) { try { await run(); passed++; } catch (error) { console.error(`FAIL: ${name}`, error); process.exitCode = 1; } }
console.log(`Reward native handoff: ${passed}/${tests.length}. Actual root/native writer/materializer, simulated planner/storage; no external calls or live writes.`);
}
