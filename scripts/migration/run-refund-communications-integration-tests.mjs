import assert from 'node:assert/strict';
import vm from 'node:vm';
import { buildSync } from 'esbuild';
import { createRefundFixture } from './run-full-refund-loyalty-recovery-tests.mjs';
const bundle = buildSync({ entryPoints: ['base44/functions/sendOrderStatusNotification/elevatedTransactionalCommunications.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs' }).outputFiles[0].text;
const rootBundle = buildSync({ entryPoints: ['base44/functions/sendOrderStatusNotification/entry.ts'],
  bundle: true, write: false, platform: 'node', format: 'cjs', external: ['npm:*'] }).outputFiles[0].text;
async function fixture() {
  const f = await createRefundFixture(); const messages = []; const module = { exports: {} };
  const env = { get: key => f.faults.disableElevated && key === 'ENABLE_ELEVATED_TRANSACTIONAL_COMMUNICATIONS'
    ? 'false' : ['ENABLE_ELEVATED_TRANSACTIONAL_PUSH', 'ENABLE_CUSTOMER_PUSH_NOTIFICATIONS'].includes(key)
    ? 'true' : f.env.get(key) };
  const context = { module, exports: module.exports, Response, Request, Date, Intl, URL,
    console: { log() {}, warn() {}, error() {} }, Deno: { env },
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.method, 'POST');
      const payload = JSON.parse(options.body); messages.push({ payload, headers: options.headers });
      if (f.faults.emailUnknown) throw new Error('Synthetic timeout');
      if (f.faults.emailRejected) return new Response(JSON.stringify({ message: 'synthetic rejection' }), { status: 422 });
      return new Response(JSON.stringify({ id: 'synthetic-confirmed-message-id' }), { status: 200 });
    } };
  vm.runInNewContext(bundle, context);
  let rootHandler; const rootModule = { exports: {} };
  vm.runInNewContext(rootBundle, { ...context, module: rootModule, exports: rootModule.exports,
    require: name => { assert.equal(name, 'npm:@base44/sdk@0.8.25'); return { createClientFromRequest: () => f.base44 }; },
    Deno: { env, serve: handler => { rootHandler = handler; } } });
  const root = async body => {
    f.base44.auth.me = async () => ({ role: 'admin', email: 'operator@example.test' });
    const response = await rootHandler(new Request('https://synthetic.invalid/order-status', {
      method: 'POST', body: JSON.stringify(body) }));
    return { status: response.status, body: await response.json() };
  };
  const originalInvoke = f.base44.asServiceRole.functions.invoke;
  f.base44.asServiceRole.functions.invoke = async (name, body) => {
    if (name === 'sendOrderStatusNotification') {
      f.effects.push(name);
      if (f.faults.injectAutomation) {
        const stale = structuredClone(f.order); delete stale.refund_processing;
        const result = await root({ event: { type: 'update', entity_id: f.order.id }, data: stale,
          old_data: { status: 'in_production' }, changed_fields: ['status'] });
        assert.equal(result.body.reason, 'refund_recovery_owns_communications');
        const elevated = await module.exports.handleElevatedTransactionalAction(f.base44, { ...body,
          source: 'sendOrderStatusNotification', refund_dispatch_attempt: undefined });
        assert.equal((await elevated.json()).reason, 'refund_recovery_owns_communications');
        assert.equal(messages.length, 0);
      }
      if (f.faults.concurrentDispatch) {
        await Promise.all([module.exports.handleElevatedTransactionalAction(f.base44, body),
          module.exports.handleElevatedTransactionalAction(f.base44, body)]);
        return { data: { success: true } };
      }
      const response = await module.exports.handleElevatedTransactionalAction(f.base44, body);
      return { data: await response.json() };
    }
    if (name === 'sendCustomerNotification') {
      assert.equal(body.notification_subtype, 'order_refunded');
      if (f.faults.inAppFailure) throw new Error('Synthetic in-app unavailable');
      const existing = f.rows.Notification.find(row => row.idempotency_key === body.idempotency_key);
      const notification = existing || await f.entities.Notification.create({ ...body });
      return { data: { success: true, notification_id: notification.id, push_sent: false,
        push_skipped_reason: f.faults.pushFailed ? 'push_delivery_failed' : 'no_active_push_subscription', token_count: 0 } };
    }
    return originalInvoke(name, body);
  };
  return { ...f, messages, root, deliver: body => module.exports.handleElevatedTransactionalAction(f.base44, body) };
}
const tests = []; const test = (name, fn) => tests.push([name, fn]);
test('actual webhook and refund template produce matching email, in-app and explained no-device receipts', async () => {
  const f = await fixture(); const result = await f.run(); assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.communications_confirmed, true); assert.equal(f.messages.length, 1);
  const { payload, headers } = f.messages[0];
  assert.deepEqual(payload.to, [f.customerEmail]); assert.match(payload.subject, /refund/i);
  assert.match(payload.html, /42\.99/); assert.ok(payload.html.includes(f.order.order_number));
  assert.doesNotMatch(payload.html, /\b(?:undefined|null|NaN)\b|\[object Object\]/i);
  assert.equal(headers['Idempotency-Key'], `txn:${f.order.id}:refunded:email:re_synthetic_full`);
  assert.equal(f.rows.Notification.length, 1);
  assert.equal((await f.run({ id: 'evt_synthetic_replayed' })).status, 200); assert.equal(f.messages.length, 1);
});
test('persisted amount overrides missing or stale notification payload amount', async () => {
  const f = await fixture(); Object.assign(f.order, { status: 'refunded', payment_status: 'refunded',
    refund_status: 'fully_refunded', refund_amount: 42.99, stripe_refund_id: 're_synthetic_full' });
  await f.deliver({ action: 'elevated_deliver_event', internal_token: 'synthetic-private-placeholder',
    order_id: f.order.id, event: 'refunded', refund_amount: 1 });
  assert.match(f.messages[0].payload.html, /42\.99/);
});
test('the actual entity automation and direct elevated path defer to refund-owned dispatch', async () => {
  const f = await fixture(); f.faults.injectAutomation = true;
  assert.equal((await f.run()).status, 200); assert.equal(f.messages.length, 1);
});
test('a duplicate authorized dispatch cannot call providers twice', async () => {
  const f = await fixture(); f.faults.concurrentDispatch = true;
  assert.equal((await f.run()).status, 200); assert.equal(f.messages.length, 1);
  assert.equal(f.rows.Notification.length, 1);
});
test('legacy-mode automation fallback also cannot resend a coordinated refund', async () => {
  const f = await fixture(); await f.run(); f.faults.disableElevated = true;
  const result = await f.root({ order_id: f.order.id, new_status: 'refunded' });
  assert.equal(result.body.reason, 'refund_recovery_owns_communications'); assert.equal(f.messages.length, 1);
});
for (const mode of ['ignored', 'lost_response', 'ambiguous']) test(`${mode} provider-dispatch claim never authorizes a send`, async () => {
  const f = await fixture(); const original = f.entities.Order.updateMany;
  f.entities.Order.updateMany = async (query, patch) => {
    if (patch.$set?.refund_processing?.communication?.provider_dispatch_claimed !== true) return original(query, patch);
    if (mode === 'ignored') return { success: true, has_more: false, updated: 1 };
    const result = await original(query, patch);
    if (mode === 'lost_response') throw new Error('Synthetic lost claim acknowledgement');
    return { ...result, has_more: true };
  };
  assert.equal((await f.run()).status, 500); assert.equal(f.messages.length, 0);
  assert.equal(f.rows.OrderReviewQueue[0].incident_type, 'refund_communication_unconfirmed');
  f.entities.Order.updateMany = original;
  assert.equal((await f.run()).status, 500); assert.equal(f.messages.length, 0);
});
test('refund closes queued earlier status pushes without deleting their history', async () => {
  const f = await fixture(); f.rows.CustomerMessageDeliveryLog.push({ id: 'scheduled-old', order_id: f.order.id,
    message_type: 'transactional_order', channel: 'push', status: 'scheduled', metadata: { event: 'in_production' } });
  assert.equal((await f.run()).status, 200);
  const old = f.rows.CustomerMessageDeliveryLog.find(row => row.id === 'scheduled-old');
  assert.equal(old.status, 'skipped'); assert.equal(old.metadata.event, 'in_production');
  assert.equal(old.error_message, 'superseded_by_refunded');
});
for (const fault of ['emailUnknown', 'emailRejected', 'inAppFailure', 'pushFailed']) test(`${fault} is not misreported as all channels completed`, async () => {
  const f = await fixture(); f.faults[fault] = true; assert.equal((await f.run()).status, 500);
  assert.equal(f.order.status, 'refunded'); assert.equal(f.order.refund_processing.communication.state, 'dispatching');
  const messages = f.messages.length; f.faults[fault] = false;
  assert.equal((await f.run()).status, 500); assert.equal(f.messages.length, messages, 'unknown channel outcomes must not resend');
});
test('lost delivery-log acknowledgement recovers actual email and in-app receipts', async () => {
  const f = await fixture(); let lost = false; const original = f.entities.CustomerMessageDeliveryLog.update;
  f.entities.CustomerMessageDeliveryLog.update = async (id, patch) => {
    const result = await original(id, patch);
    if (patch.status === 'sent' && !lost) { lost = true; throw new Error('Synthetic lost log response'); }
    return result;
  };
  assert.equal((await f.run()).status, 200); assert.equal(f.messages.length, 1);
  assert.equal((await f.run()).status, 200); assert.equal(f.messages.length, 1);
});
test('invalid transactional token never creates a message', async () => {
  const f = await fixture();
  const response = await f.deliver({ action: 'elevated_deliver_event', internal_token: 'incorrect',
    order_id: f.order.id, event: 'refunded' });
  assert.equal(response.status, 409); assert.equal(f.messages.length, 0); assert.equal(f.rows.Notification.length, 0);
});
let passed = 0;
for (const [name, fn] of tests) { try { await fn(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`Refund communication integration: ${passed}/${tests.length}; actual webhook/template/logs, simulated Resend/push/storage, no network.`);
