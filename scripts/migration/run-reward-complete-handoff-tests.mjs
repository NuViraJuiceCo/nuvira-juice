import assert from 'node:assert/strict';
import { createCommunicationFixture } from './run-reward-customer-handoff-tests.mjs';
import { createNativeFixture } from './run-reward-native-handoff-tests.mjs';
import { createShopifyFixture } from './run-reward-shopify-handoff-tests.mjs';
import { createRewardNativeHandoffAdapter } from '../../base44/functions/stripeWebhook/rewardNativeHandoff.js';
import { createRewardShopifyHandoffAdapter } from '../../base44/functions/stripeWebhook/rewardShopifyHandoff.js';
import { runRewardHandoff, REWARD_HANDOFF_STAGES } from '../../base44/functions/stripeWebhook/rewardHandoff.js';

// All nine real adapters + actual native/materializer/communication leaf code.
// Only provider HTTP, storage, gateway transport and safe-sync planning are mocked.
function fixture() {
  const communication = createCommunicationFixture(); const native = createNativeFixture(); const shopify = createShopifyFixture();
  Object.assign(communication.order, structuredClone(shopify.order));
  delete communication.order.reward_handoff;
  communication.order.delivery_address = '1 Synthetic Street, Testville, MO 00000';
  native.rows.Order = communication.rows.Order;
  communication.entities.Order.list = native.base44.asServiceRole.entities.Order.list;
  native.rows.CheckoutSession = [{ ...structuredClone(shopify.context), id: 'synthetic_context',
    stripe_session_id: communication.order.stripe_checkout_session_id }];
  for (const name of Object.keys(native.rows)) {
    if (communication.entities[name]) native.base44.asServiceRole.entities[name] = communication.entities[name];
    else { communication.entities[name] = native.base44.asServiceRole.entities[name]; communication.rows[name] = native.rows[name]; }
  }
  communication.base44.asServiceRole.functions.fetch = async (...args) => {
    const response = await native.base44.asServiceRole.functions.fetch(...args);
    assert.ok(response.ok, JSON.stringify(await response.clone().json()));
    return response;
  };
  shopify.config.base44 = communication.base44;
  const adapters = { ...communication.adapters,
    ...createRewardNativeHandoffAdapter({ base44: communication.base44, internalSecret: 'synthetic-secret' }),
    ...createRewardShopifyHandoffAdapter(shopify.config) };
  assert.deepEqual(Object.keys(adapters).sort(), [...REWARD_HANDOFF_STAGES].sort());
  const errors = [];
  for (const [stage, adapter] of Object.entries(adapters)) for (const method of ['perform', 'reconcile']) {
    const action = adapter[method];
    adapter[method] = async (...args) => { try { return await action(...args); }
      catch (error) { errors.push(`${stage}.${method}: ${error.message}`); throw error; } };
  }
  const run = () => runRewardHandoff({ entities: communication.entities, orderId: communication.order.id, adapters,
    now: () => '2026-09-08T10:00:00Z', attemptId: () => 'synthetic-run-attempt' });
  return { communication, native, shopify, run, errors };
}
const tests = []; const test = (name, fn) => tests.push([name, fn]);
test('all nine stages complete with one order/task, six planned bottles, one Shopify mirror and exact communication receipts', async () => {
  const f = fixture(); const result = await f.run(); assert.equal(result.complete, true, `${JSON.stringify(result)} ${f.errors.join('; ')}`);
  const steps = f.communication.order.reward_handoff.steps;
  assert.ok(REWARD_HANDOFF_STAGES.every(stage => steps[stage].state === 'complete'));
  assert.equal(steps.customer_push.receipt.reason, 'no_eligible_device');
  assert.equal(steps.operations_push.receipt.reason, 'no_eligible_device');
  assert.equal(steps.sms.receipt.reason, 'no_phone');
  assert.equal(f.native.rows.ShopifyOrder.length, 1); assert.equal(f.native.rows.FulfillmentTask.length, 1);
  assert.equal(f.native.rows.ProductionBatch.reduce((sum, batch) => sum + batch.planned_units, 0), 6);
  assert.equal(f.shopify.state.creates.length, 1); assert.equal(f.communication.bag.order_id, f.communication.order.id);
  assert.equal(f.communication.calls.filter(call => call === 'provider:send').length, 1);
  assert.equal(f.communication.calls.filter(call => call === 'operations:send').length, 1);
  assert.doesNotMatch(JSON.stringify(f.communication.order.reward_handoff), /example\.test|Synthetic Street|credential|nuvira_checkout_item/);
  const previous = JSON.stringify(f.communication.rows); const calls = f.communication.calls.length;
  assert.equal((await f.run()).complete, true); assert.equal(JSON.stringify(f.communication.rows), previous);
  assert.ok(f.communication.calls.slice(calls).every(call => call.startsWith('read:')));
  assert.equal(f.shopify.state.creates.length, 1);
});
test('lost native dispatch response reconciles the real records before continuing, without extra demand', async () => {
  const f = fixture(); f.native.faults.lostResponse = true;
  assert.deepEqual(await f.run(), { complete: false, review_required: true, stage: 'native_operations' });
  f.native.faults.lostResponse = false; assert.equal((await f.run()).complete, true);
  assert.equal(f.native.rows.FulfillmentTask.length, 1); assert.equal(f.native.rows.ProductionBatch.length, 3);
});
test('registered customer/staff devices and opted-in SMS each get their own confirmed acceptance receipt', async () => {
  const f = fixture(); const c = f.communication;
  c.order.contact_phone = '+12025550123';
  c.rows.UserProfile.push({ id: 'synthetic_profile', customer_email: c.order.customer_email, phone: c.order.contact_phone,
    sms_consent: true, sms_consent_date: '2026-09-01T12:00:00Z' });
  for (const [index, email] of [c.order.customer_email, 'operations@example.test'].entries()) {
    c.rows.PushSubscription.push({ id: `synthetic_device_${index}`, customer_email: email, token_type: 'web_push',
      enabled: true, endpoint: `https://synthetic.invalid/push/${index}`, p256dh: 'synthetic-key', auth: 'synthetic-auth' });
  }
  const result = await f.run(); assert.equal(result.complete, true, `${JSON.stringify(result)} ${f.errors.join('; ')}`);
  assert.ok(REWARD_HANDOFF_STAGES.every(stage => c.order.reward_handoff.steps[stage].receipt.outcome === 'completed'));
  assert.equal(c.calls.filter(call => call === 'push:accept').length, 2);
  assert.equal(c.calls.filter(call => call === 'sms:send').length, 1);
  assert.ok(c.rows.CustomerMessageDeliveryLog.filter(log => log.channel === 'push').every(log => !log.delivered_at));
  await f.run(); assert.equal(c.calls.filter(call => call === 'push:accept').length, 2);
  assert.equal(c.calls.filter(call => call === 'sms:send').length, 1);
});
test('lost Shopify creation response reconciles before sending customer/staff messages', async () => {
  const f = fixture(); f.shopify.state.faults.lostCreate = true;
  assert.deepEqual(await f.run(), { complete: false, review_required: true, stage: 'shopify_mirror' });
  assert.equal(f.communication.calls.filter(call => call === 'provider:send').length, 0);
  assert.equal((await f.run()).complete, true); assert.equal(f.shopify.state.creates.length, 1);
});
test('lost confirmation response recovers without repeating native, Shopify, bag, or email actions', async () => {
  const f = fixture(); f.communication.faults.lostFunction = 'sendOrderReceivedNotification';
  assert.deepEqual(await f.run(), { complete: false, review_required: true, stage: 'confirmation_email' });
  f.communication.faults.lostFunction = null; assert.equal((await f.run()).complete, true);
  assert.equal(f.communication.calls.filter(call => call === 'provider:send').length, 1);
  assert.equal(f.communication.calls.filter(call => call === 'update:BagReturn').length, 1);
  assert.equal(f.shopify.state.creates.length, 1); assert.equal(f.native.rows.FulfillmentTask.length, 1);
});
for (const [name, fn] of tests) { try { await fn(); } catch (error) { throw new Error(name, { cause: error }); } }
console.log(`Complete reward handoff: ${tests.length}/${tests.length}; all nine adapters executed, simulated providers/storage only.`);
