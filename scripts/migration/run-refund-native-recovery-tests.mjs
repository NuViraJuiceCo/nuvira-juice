import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync, buildSync } from 'esbuild';
const source = fs.readFileSync('base44/functions/syncOrderToHub/nativeOrderOps.ts', 'utf8');
const code = transformSync(source + '\nexport { handleNativeRefundMirror };', { loader: 'ts', format: 'cjs' }).code;
const module = { exports: {} };
vm.runInNewContext(code, { module, exports: module.exports, Response, Request, Date, Map, Set,
  console: { log() {}, warn() {}, error() {} }, Deno: { env: { get: () => '' } },
  require: () => ({}) });
const copy = value => structuredClone(value);
const routedBundles = Object.fromEntries(['syncRefundToHub', 'syncOrderToHub'].map(name => [name,
  buildSync({ entryPoints: [`base44/functions/${name}/entry.ts`], bundle: true, write: false,
    platform: 'node', format: 'cjs', external: ['npm:*'] }).outputFiles[0].text]));
function fixture() {
  const order = { id: 'native-order', order_number: 'NV-REFUND-NATIVE', customer_email: 'refund@example.test',
    stripe_payment_intent_id: 'pi_native', stripe_refund_id: 're_native', stripe_charge_id: 'ch_native',
    refund_amount: 39, is_full_refund: true, refund_type: 'full' };
  const mirror = { id: 'native-mirror', base44_order_id: order.id, shopify_order_number: order.order_number,
    customer_email: order.customer_email, stripe_charge_id: 'ch_native', payment_status: 'paid',
    financial_status: 'paid', production_status: 'awaiting_production',
    fulfillments: [{ status: 'delivered', proof_photo_url: 'https://synthetic.invalid/proof' }] };
  const rows = { Order: [order], ShopifyOrder: [mirror], FulfillmentTask: [
    { id: 'task-pending', order_id: mirror.id, base44_order_id: order.id, status: 'pending', notes: 'Keep instructions' },
    { id: 'task-delivered', order_id: mirror.id, base44_order_id: order.id, status: 'delivered', proof_photo_url: 'https://synthetic.invalid/proof' },
  ], OrderSyncLog: [], CommandLog: [], OrderReviewQueue: [] };
  const faults = {}; const effects = []; const entities = {};
  for (const [name, list] of Object.entries(rows)) entities[name] = {
    filter: async (query, _sort, limit) => {
      if (faults[`${name}.read`]) throw new Error('Synthetic read outage');
      let selected = list.filter(row => Object.entries(query).every(([key, value]) => row[key] === value));
      if (faults[`${name}.capped`]) selected = Array.from({ length: limit }, () => copy(selected[0]));
      return copy(selected.slice(0, limit));
    },
    update: async (id, patch) => {
      if (faults[`${name}.write`]) throw new Error('Synthetic write outage');
      const row = list.find(row => row.id === id); assert.ok(row);
      effects.push(`${name}.update`);
      if (!faults[`${name}.ignored`]) Object.assign(row, copy(patch));
      if (faults[`${name}.lost`]) { faults[`${name}.lost`] = false; throw new Error('Synthetic lost acknowledgement'); }
      return copy(row);
    },
    updateMany: async (query, patch) => {
      if (name === 'FulfillmentTask' && faults.raceDelivery) {
        faults.raceDelivery = false; Object.assign(list[0], { status: 'delivered', proof_photo_url: 'https://synthetic.invalid/new-proof' });
      }
      const selected = list.filter(row => Object.entries(query).every(([key, value]) =>
        value && typeof value === 'object' && '$exists' in value ? (row[key] !== undefined) === value.$exists : row[key] === value));
      for (const row of selected) await entities[name].update(row.id, patch.$set);
      return { success: true, updated: selected.length, has_more: false };
    },
    create: async patch => { effects.push(`${name}.create`); const row = { ...copy(patch), id: `${name}-${list.length}` };
      list.push(row); return copy(row); },
  };
  const run = async (mode = 'live') => {
    const response = await module.exports.handleNativeRefundMirror({ base44: { asServiceRole: { entities } },
      order, source: 'customer_app_one_time', eventType: 'order.refunded', idempotencyKey: 'refund-native-key',
      requestId: 'refund-native-request', mode });
    return { status: response.status, body: await response.json() };
  };
  return { rows, order, mirror, run, faults, effects, entities };
}
function routedFixture() {
  const f = fixture(); const handlers = {};
  Object.assign(f.order, { status: 'refunded', payment_status: 'refunded', refund_status: 'fully_refunded',
    payment_captured: false, items: [{ product_id: 'oasis', title: 'OASIS', quantity: 3, price: 13 }], total: 39 });
  const env = { get: key => key === 'ENABLE_NATIVE_ORDER_OPS' ? 'true'
    : ['CUSTOMER_APP_SYNC_SECRET', 'HUB_SYNC_SECRET', 'NATIVE_ORDER_OPS_SECRET'].includes(key) ? 'synthetic-private-placeholder' : '' };
  const base44 = { auth: { me: async () => ({ role: 'admin', email: 'operator@example.test' }) },
    asServiceRole: { entities: f.entities, functions: { invoke: async (name, body) => {
      assert.equal(name, 'syncOrderToHub');
      const response = await handlers[name](new Request('https://synthetic.invalid/functions/syncOrderToHub', {
        method: 'POST', body: JSON.stringify(body) }));
      return { data: await response.json() };
    } } } };
  for (const [name, bundled] of Object.entries(routedBundles)) vm.runInNewContext(bundled, {
    module: { exports: {} }, exports: {}, Request, Response, Headers, URL, Date, Map, Set, crypto: globalThis.crypto,
    console: { log() {}, warn() {}, error() {} }, Deno: { env, serve: handler => { handlers[name] = handler; } },
    require: moduleName => { assert.ok(moduleName.includes('@base44/sdk')); return { createClientFromRequest: () => base44 }; },
    fetch: async () => { throw new Error('External provider calls forbidden'); },
  });
  return { ...f, run: async () => {
    const response = await handlers.syncRefundToHub(new Request('https://synthetic.invalid/functions/syncRefundToHub', {
      method: 'POST', headers: { 'x-internal-secret': 'synthetic-private-placeholder' },
      body: JSON.stringify({ order_id: f.order.id, triggered_by: 'stripe_refund_webhook' }) }));
    return { status: response.status, body: await response.json() };
  } };
}
const tests = []; const test = (name, fn) => tests.push([name, fn]);
test('actual refund mirror cancels active tasks, preserves delivered proof and Stripe charge identity', async () => {
  const f = fixture(); const delivered = copy(f.rows.FulfillmentTask[1]);
  const result = await f.run(); assert.equal(result.body.success, true); assert.equal(result.body.action, 'refund_mirrored');
  assert.equal(f.rows.FulfillmentTask[0].status, 'cancelled'); assert.deepEqual(f.rows.FulfillmentTask[1], delivered);
  assert.equal(f.mirror.fulfillments[0].status, 'delivered'); assert.equal(f.mirror.stripe_charge_id, 'ch_native');
  const before = copy(f.rows); assert.equal((await f.run()).body.reason, 'already_refunded_idempotent');
  assert.deepEqual(f.rows, before);
});
test('native-id linked task is recovered even when not linked through the mirror id', async () => {
  const f = fixture(); f.rows.FulfillmentTask[0].order_id = f.order.id;
  delete f.rows.FulfillmentTask[0].base44_order_id;
  await f.run(); assert.equal(f.rows.FulfillmentTask[0].status, 'cancelled');
});
test('delivery completed during refund cancellation is preserved by conditional write and retry', async () => {
  const f = fixture(); f.faults.raceDelivery = true;
  await assert.rejects(f.run, /raced/);
  assert.equal((await f.run()).body.success, true);
  assert.equal(f.rows.FulfillmentTask[0].status, 'delivered');
  assert.equal(f.rows.FulfillmentTask[0].proof_photo_url, 'https://synthetic.invalid/new-proof');
});
for (const fault of ['FulfillmentTask.read', 'FulfillmentTask.capped', 'ShopifyOrder.read', 'ShopifyOrder.capped']) {
  test(`${fault} cannot be mistaken for no records or success`, async () => {
    const f = fixture(); f.faults[fault] = true; await assert.rejects(f.run); assert.equal(f.effects.length, 0);
  });
}
for (const fault of ['FulfillmentTask.write', 'FulfillmentTask.ignored', 'FulfillmentTask.lost',
  'ShopifyOrder.write', 'ShopifyOrder.ignored', 'ShopifyOrder.lost']) {
  test(`retry repairs ${fault} without modifying delivered facts`, async () => {
    const f = fixture(); const delivered = copy(f.rows.FulfillmentTask[1]); f.faults[fault] = true;
    await assert.rejects(f.run); f.faults[fault] = false;
    assert.equal((await f.run()).body.success, true); assert.equal(f.rows.FulfillmentTask[0].status, 'cancelled');
    assert.deepEqual(f.rows.FulfillmentTask[1], delivered);
  });
}
test('an old success log cannot conceal an active task behind an already refunded mirror', async () => {
  const f = fixture(); await f.run(); f.rows.FulfillmentTask[0].status = 'pending';
  const before = copy(f.mirror); assert.equal((await f.run()).body.action, 'refund_mirrored');
  assert.equal(f.rows.FulfillmentTask[0].status, 'cancelled'); assert.deepEqual(f.mirror, before);
});
test('more than twenty linked tasks are all canceled, not silently truncated', async () => {
  const f = fixture(); for (let i = 0; i < 30; i++) f.rows.FulfillmentTask.push({ id: `extra-${i}`, order_id: f.mirror.id, status: 'pending' });
  await f.run(); assert.ok(f.rows.FulfillmentTask.every(row => ['cancelled', 'delivered'].includes(row.status)));
});
for (const field of ['is_partial_refund', 'is_full_refund', 'refund_type']) test(`${field} partial cannot cancel fulfillment`, async () => {
  const f = fixture(); f.order[field] = field === 'refund_type' ? 'partial' : field === 'is_partial_refund';
  assert.equal((await f.run()).status, 409); assert.equal(f.effects.length, 0);
});
test('conflicting mirror identities block all writes', async () => {
  const f = fixture(); f.rows.ShopifyOrder.push({ ...copy(f.mirror), id: 'other-mirror' });
  await assert.rejects(f.run, /ambiguous/); assert.equal(f.effects.length, 0);
});
test('a wrong linked customer cannot be refunded through a matching order number', async () => {
  const f = fixture(); f.mirror.customer_email = 'foreign@example.test';
  await assert.rejects(f.run, /mismatch/); assert.equal(f.effects.length, 0);
});
test('a different payment on a matching mirror requires review before any cancellation', async () => {
  const f = fixture(); f.mirror.stripe_payment_intent_id = 'pi_foreign';
  await assert.rejects(f.run, /mismatch/); assert.equal(f.effects.length, 0);
});
test('dry-run preview writes nothing', async () => {
  const f = fixture(); assert.equal((await f.run('preview')).body.dry_run, true); assert.equal(f.effects.length, 0);
});
test('actual retained refund entrypoint routes through the real sync root and native handler without external Hub writes', async () => {
  const f = routedFixture(); const result = await f.run();
  assert.equal(result.status, 200); assert.equal(result.body.success, true, JSON.stringify(result.body));
  assert.equal(result.body.native_authoritative, true); assert.equal(result.body.external_calls_performed, false);
  assert.equal(result.body.native_order_ops.action, 'refund_mirrored');
  assert.equal(f.rows.FulfillmentTask[0].status, 'cancelled'); assert.equal(f.rows.FulfillmentTask[1].status, 'delivered');
  assert.equal((await f.run()).body.native_order_ops.reason, 'already_refunded_idempotent');
});
test('the full retained native route does not conceal a task-cancellation outage', async () => {
  const f = routedFixture(); f.faults['FulfillmentTask.write'] = true;
  assert.equal((await f.run()).body.success, false); f.faults['FulfillmentTask.write'] = false;
  assert.equal((await f.run()).body.success, true); assert.equal(f.rows.FulfillmentTask[0].status, 'cancelled');
});
let passed = 0;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`Native refund recovery: ${passed}/${tests.length}; actual handler, simulated records, no provider/network calls.`);
