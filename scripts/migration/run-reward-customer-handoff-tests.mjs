import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createRewardCustomerHandoffAdapters } from '../../base44/functions/stripeWebhook/rewardCustomerHandoff.js';
import { createRewardOperationsHandoffAdapters } from '../../base44/functions/stripeWebhook/rewardOperationsHandoff.js';
import { createRewardSmsHandoffAdapter } from '../../base44/functions/stripeWebhook/rewardSmsHandoff.js';
import { runRewardHandoff, REWARD_HANDOFF_STAGES } from '../../base44/functions/stripeWebhook/rewardHandoff.js';

// Actual adapter + actual existing email handler/template. All storage, function
// transport and Resend HTTP are simulated. No network or provider is available.
const emailSource = transformSync(fs.readFileSync('base44/functions/sendOrderReceivedNotification/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code;
const notificationSource = transformSync(fs.readFileSync('base44/functions/sendCustomerNotification/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code;
const pushSource = transformSync(fs.readFileSync('base44/functions/sendCustomerPushNotification/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code;
const operationsPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/notifyOrderProcessed/entry.ts';
const operationsSource = transformSync(fs.readFileSync(operationsPath, 'utf8'), { loader: 'ts', format: 'cjs' }).code;
const adminPushSource = transformSync(fs.readFileSync('base44/functions/sendAdminOrderProcessedNotification/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code;
const smsSource = transformSync(fs.readFileSync('base44/functions/getAdminOperationsDashboardSummary/handlers/sendOrderSms/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code;
const tests = []; const test = (name, run) => tests.push([name, run]);
const providerId = '00000000-0000-4000-8000-000000000123';
const operationsProviderId = '00000000-0000-4000-8000-000000000124';
function fixture(environment = {}) {
  const order = { id: 'synthetic_order', customer_email: 'synthetic@example.test', customer_name: 'Synthetic Tester',
    order_number: 'NV-SYNTHETIC', total: 0, payment_captured: false, payment_status: 'paid', financial_status: 'paid',
    status: 'scheduled_for_juicing', stripe_checkout_session_id: 'cs_live_SYNTHETIC',
    assigned_delivery_date: '2026-09-12', delivery_window_label: 'Saturday 12 PM – 3 PM',
    delivery_address: '1 Synthetic Test Street, Testville, MO 00000', bag_return_request_id: 'synthetic_bag',
    items: [{ product_id: 'synthetic_oasis', title: 'OASIS', price: 0, quantity: 2 },
      { product_id: 'synthetic_aura', title: 'AURA', price: 0, quantity: 2 },
      { product_id: 'synthetic_renu', title: 'RE-NU', price: 0, quantity: 2 }],
    reward_settlement: { revision: '2026-09-08.reward-settlement-v1', checkout_session_id: 'cs_live_SYNTHETIC',
      context_hash: 'a'.repeat(64), reservation_id: 'synthetic-reservation', points_redeemed: 2000,
      provider_event_id: 'evt_SYNTHETIC', settled_at: '2026-09-08T08:00:00Z' } };
  const bag = { id: 'synthetic_bag', customer_email: order.customer_email, order_id: 'pending',
    verification_status: 'requested', small_bags_requested: 1, small_bags_accepted: 0, credit_issued: 0,
    updated_date: '2026-09-08T07:00:00Z' };
  const rows = { Order: [order], BagReturn: [bag], CustomerMessageDeliveryLog: [],
    Notification: [], UserProfile: [], PushSubscription: [], User: [{ id: 'synthetic_admin', role: 'admin', email: 'operations@example.test' }] };
  const faults = {}; const calls = []; const provider = new Map();
  const matches = (row, query) => Object.entries(query).every(([key, value]) => value && typeof value === 'object'
    ? '$exists' in value ? (row[key] !== undefined) === value.$exists : row[key] !== value.$ne
    : row[key] === value);
  const entities = Object.fromEntries(Object.keys(rows).map(name => [name, {
    filter: async (query, _sort, limit) => {
      calls.push(`read:${name}`);
      if (faults.read === name) throw new Error('synthetic unavailable');
      return structuredClone(rows[name].filter(row => matches(row, query)).slice(0, limit));
    },
    create: async data => {
      calls.push(`create:${name}`);
      if (faults.create === name) throw new Error('synthetic log failure');
      const row = { ...structuredClone(data), id: `synthetic_log_${rows[name].length}` }; rows[name].push(row);
      if (faults.lostReceipt && data.channel === 'push') throw new Error('synthetic lost receipt acknowledgement');
      return row;
    },
    update: async (id, patch) => {
      calls.push(`update:${name}`);
      const row = rows[name].find(item => item.id === id); assert.ok(row);
      Object.assign(row, structuredClone(patch)); return structuredClone(row);
    },
    updateMany: async (query, patch) => {
      calls.push(`update:${name}`);
      if (faults.beforeBagWrite && name === 'BagReturn') { const fn = faults.beforeBagWrite; faults.beforeBagWrite = null; fn(bag); }
      const selected = rows[name].filter(row => matches(row, query));
      for (const row of selected) Object.assign(row, structuredClone(patch.$set));
      if (faults.lostBagWrite && name === 'BagReturn') throw new Error('synthetic lost acknowledgement');
      return faults.badBagAck && name === 'BagReturn' ? { success: true, has_more: true, updated: 2 }
        : { success: true, has_more: false, updated: selected.length };
    },
  }]));
  let handler; const handlers = {};
  const base44 = { auth: { me: async () => ({ role: 'admin' }) }, asServiceRole: { entities, functions: {
    invoke: async (name, payload) => {
      calls.push(`invoke:${name}`);
      assert.ok(['sendOrderReceivedNotification', 'sendCustomerNotification', 'sendCustomerPushNotification', 'getAdminOperationsDashboardSummary', 'sendAdminOrderProcessedNotification'].includes(name));
      if (faults.beforeInvoke) faults.beforeInvoke(order);
      let gatewayAction;
      if (name === 'getAdminOperationsDashboardSummary') {
        assert.ok(['notifyOrderProcessed', 'sendOrderSms'].includes(payload.gateway_action));
        gatewayAction = payload.gateway_action; payload = payload.payload;
      }
      const target = name === 'sendOrderReceivedNotification' ? handler
        : gatewayAction === 'sendOrderSms' ? handlers.sendOrderSms : handlers[name];
      const response = await target(new Request('https://synthetic.invalid/function', { method: 'POST', body: JSON.stringify(payload) }));
      if (faults.lostInvoke || faults.lostFunction === name) throw new Error('synthetic lost function response');
      const data = await response.json();
      if (faults.functionData) faults.functionData(name, data);
      if (!response.ok) throw new Error('synthetic function failed');
      return { data };
    },
  } } };
  vm.runInNewContext(emailSource, { exports: {}, require: () => ({ createClientFromRequest: () => base44 }),
    Request, Response, Date, Intl, console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: key => key === 'RESEND_API_KEY' ? 'synthetic-provider-credential' : '' }, serve: fn => { handler = fn; } },
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.method, 'POST'); calls.push('provider:send');
      assert.equal(options.headers['Idempotency-Key'], `order_confirmation_email_${order.id}`);
      const payload = JSON.parse(options.body);
      if (faults.sendFailed) return Response.json({ error: 'synthetic' }, { status: 503 });
      provider.set(providerId, { ...payload, id: providerId, to: [payload.to], cc: [], bcc: [], last_event: 'sent', scheduled_at: null });
      if (faults.lostSend) throw new Error('synthetic lost provider response');
      return Response.json({ id: providerId });
    },
  });
  const operationsModule = { exports: {} };
  vm.runInNewContext(operationsSource, { module: operationsModule, exports: operationsModule.exports,
    require: () => ({ createClientFromRequest: () => base44 }), Request, Response, Date,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: key => key === 'RESEND_API_KEY' ? 'synthetic-provider-credential'
      : key === 'ENABLE_ADMIN_PUSH_NOTIFICATIONS' || key === 'ENABLE_ADMIN_ORDER_PROCESSED_PUSH' ? 'true' : '' } },
    fetch: async (url, options) => {
      assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.method, 'POST'); calls.push('operations:send');
      assert.equal(options.headers['Idempotency-Key'], `internal_order_processed_${order.id}`);
      const data = JSON.parse(options.body);
      if (faults.sendFailed) return Response.json({ error: 'synthetic' }, { status: 503 });
      provider.set(operationsProviderId, { ...data, id: operationsProviderId, cc: [], bcc: [], last_event: 'sent', scheduled_at: null });
      if (faults.lostSend) throw new Error('synthetic lost provider response');
      return Response.json({ id: operationsProviderId });
    },
  });
  handlers.getAdminOperationsDashboardSummary = operationsModule.exports.default;
  const smsModule = { exports: {} };
  vm.runInNewContext(smsSource, { module: smsModule, exports: smsModule.exports,
    require: () => ({ createClientFromRequest: () => base44 }), Request, Response, Date,
    console: { log() {}, warn() {}, error() {} }, Deno: { env: { get: key => ({
      SENDBLUE_API_KEY: 'synthetic-sms-key', SENDBLUE_API_SECRET: 'synthetic-sms-secret', SENDBLUE_PHONE_NUMBER: '+12025550199',
    })[key] || '' } }, fetch: async (url, options) => {
      assert.equal(url, 'https://api.sendblue.com/api/send-message'); assert.equal(options.method, 'POST'); calls.push('sms:send');
      const data = JSON.parse(options.body);
      if (faults.smsRejected) return Response.json({ error_code: 99 }, { status: 503 });
      const message = { ...data, message_handle: 'synthetic-message-handle', is_outbound: true,
        status: faults.smsQueued ? 'QUEUED' : 'SENT', error_code: 0 };
      provider.set('synthetic-message-handle', message);
      if (faults.lostSend) throw new Error('synthetic lost SMS response');
      return Response.json(message);
    },
  });
  handlers.sendOrderSms = smsModule.exports.default;
  const env = { ENABLE_CUSTOMER_PUSH_NOTIFICATIONS: 'true', ENABLE_CUSTOMER_ORDER_CONFIRMATION_PUSH: 'true',
    ENABLE_ADMIN_PUSH_NOTIFICATIONS: 'true', ENABLE_ADMIN_ORDER_PROCESSED_PUSH: 'true',
    WEB_PUSH_VAPID_PUBLIC_KEY: 'synthetic-public', WEB_PUSH_VAPID_PRIVATE_KEY: 'synthetic-private', ...environment };
  for (const [name, source] of [['sendCustomerNotification', notificationSource], ['sendCustomerPushNotification', pushSource],
    ['sendAdminOrderProcessedNotification', adminPushSource]]) {
    vm.runInNewContext(source, { exports: {}, require: path => {
      if (path.includes('@base44/sdk')) return { createClientFromRequest: () => base44 };
      if (path.includes('web-push')) return { __esModule: true, default: {
        setVapidDetails() {}, sendNotification: async (_subscription, body) => {
          calls.push('push:accept'); const payload = JSON.parse(body);
          assert.match(payload.body, /no payment required/i);
          assert.equal(payload.url, payload.notification_subtype === 'admin_order_processed' ? '/admin/orders' : `/order-tracker/${order.order_number}`);
          if (faults.pushFailed) throw new Error('synthetic provider failure');
          if (faults.afterPush) faults.afterPush(order);
        },
      } };
      if (path.includes('deliverySnapshot')) return { buildDeliveryRouteSnapshots: () => { throw new Error('out of scope'); } };
      throw new Error('unexpected dependency');
    }, Request, Response, Date, Intl, TextEncoder, Uint8Array, ArrayBuffer,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: key => env[key] || '' }, serve: fn => { handlers[name] = fn; } },
    fetch: () => { throw new Error('No external network permitted'); },
    });
  }
  const fetchEmail = async (url, options) => {
    calls.push('provider:read');
    assert.ok([providerId, operationsProviderId].some(id => url === `https://api.resend.com/emails/${id}`));
    assert.equal(options.method, 'GET');
    if (faults.readFailed) return Response.json({}, { status: 503 });
    const message = structuredClone(provider.get(url.split('/').at(-1)));
    if (faults.message) faults.message(message);
    if (faults.afterRead) faults.afterRead(order);
    return Response.json(message);
  };
  const fetchStatus = async (url, options) => {
    calls.push('sms:read'); assert.equal(url, 'https://api.sendblue.co/api/status?handle=synthetic-message-handle');
    assert.equal(options.method, 'GET');
    if (faults.readFailed) return Response.json({}, { status: 503 });
    const message = structuredClone(provider.get('synthetic-message-handle'));
    if (faults.smsMessage) faults.smsMessage(message);
    return Response.json(message);
  };
  const adapters = { ...createRewardCustomerHandoffAdapters({ base44, fetchEmail, resendApiKey: 'synthetic-provider-credential' }),
    ...createRewardOperationsHandoffAdapters({ base44, fetchEmail, resendApiKey: 'synthetic-provider-credential' }),
    sms: createRewardSmsHandoffAdapter({ base44, fetchStatus, apiKey: 'synthetic-sms-key', apiSecret: 'synthetic-sms-secret', senderPhone: '+12025550199' }) };
  const snapshot = () => structuredClone(order);
  function claim(stage) {
    order.reward_handoff = { revision: '2026-09-08.reward-handoff-v1', checkout_session_id: order.stripe_checkout_session_id,
      context_hash: order.reward_settlement.context_hash, steps: { ...(order.reward_handoff?.steps || {}),
        [stage]: { state: 'dispatching', attempt_id: `synthetic_${stage}`, started_at: '2026-09-08T08:10:00Z' } } };
  }
  const input = stage => ({ order: snapshot(), idempotencyKey: `reward_handoff:${order.id}:${stage}` });
  const perform = async stage => { claim(stage); return adapters[stage].perform(input(stage)); };
  return { order, bag, rows, entities, base44, calls, provider, faults, adapters, claim, input, perform, fetchEmail, fetchStatus, env };
}

test('Bag return links only its order, leaves verification/credit/counts unchanged, and replays without a write', async () => {
  const f = fixture(); const original = structuredClone(f.bag); const proof = await f.perform('bag_return');
  assert.equal(proof.evidence_id, `bag_return:${f.bag.id}`);
  assert.deepEqual(f.bag, { ...original, order_id: f.order.id });
  await f.adapters.bag_return.reconcile(f.input('bag_return')); await f.perform('bag_return');
  assert.equal(f.calls.filter(c => c === 'update:BagReturn').length, 1);
  assert.ok(!f.calls.some(c => c.startsWith('provider:') || c.startsWith('invoke:')));
});
test('No bag request is an explained skip without bag/provider access', async () => {
  const f = fixture(); delete f.order.bag_return_request_id;
  assert.equal((await f.perform('bag_return')).reason, 'not_requested');
  assert.ok(!f.calls.some(c => c.includes('BagReturn')));
});
test('Bag ownership comparison permits normalized casing without an unconditional update', async () => {
  const f = fixture(); f.bag.customer_email = 'SYNTHETIC@example.test';
  assert.equal((await f.perform('bag_return')).outcome, 'completed');
});
for (const [name, mutate] of [
  ['foreign owner', f => { f.bag.customer_email = 'other@example.test'; }],
  ['foreign order', f => { f.bag.order_id = 'other_order'; }],
  ['already verified', f => { f.bag.verification_status = 'verified'; }],
  ['missing bag', f => { f.rows.BagReturn.length = 0; }],
  ['duplicate bag', f => { f.rows.BagReturn.push({ ...f.bag }); }],
  ['read error', f => { f.faults.read = 'BagReturn'; }],
]) test(`Bag ${name} never reassigns, credits or verifies`, async () => {
  const f = fixture(); mutate(f); await assert.rejects(() => f.perform('bag_return'));
  assert.ok(!f.calls.some(c => c.startsWith('update:') || c.startsWith('provider:')));
});
test('Competing assignment wins its CAS; reward handoff cannot steal the bag', async () => {
  const f = fixture(); f.faults.beforeBagWrite = bag => { bag.order_id = 'other_order'; };
  await assert.rejects(() => f.perform('bag_return')); assert.equal(f.bag.order_id, 'other_order');
});
test('Lost bag-write acknowledgement reconciles read-only without replaying an update', async () => {
  const f = fixture(); f.faults.lostBagWrite = true; await assert.rejects(() => f.perform('bag_return'));
  assert.equal((await f.adapters.bag_return.reconcile(f.input('bag_return'))).outcome, 'completed');
  assert.equal(f.calls.filter(c => c === 'update:BagReturn').length, 1);
});
test('Malformed CAS acknowledgement is not success', async () => {
  const f = fixture(); f.faults.badBagAck = true; await assert.rejects(() => f.perform('bag_return'), /write_unconfirmed/);
});
test('Missing CAS and missing durable stage claim cannot dispatch', async () => {
  let f = fixture(); delete f.entities.BagReturn.updateMany; await assert.rejects(() => f.perform('bag_return'), /conditional_updates/);
  f = fixture(); await assert.rejects(() => f.adapters.confirmation_email.perform(f.input('confirmation_email')), /dispatch_claim/);
  assert.ok(!f.calls.some(c => c.startsWith('invoke:')));
});
test('Actual email function/template sends one exact zero-cash order and independent readback verifies it', async () => {
  const f = fixture(); const result = await f.perform('confirmation_email');
  assert.deepEqual(result, { outcome: 'completed', evidence_id: `resend:${providerId}` });
  const message = f.provider.get(providerId);
  assert.match(message.html, /Total: \$0\.00/); assert.match(message.html, /x2/);
  assert.doesNotMatch(message.html, /points earned|payment received|undefined|null|NaN/i);
  assert.equal(f.rows.CustomerMessageDeliveryLog.length, 1);
  await f.perform('confirmation_email'); await f.adapters.confirmation_email.reconcile(f.input('confirmation_email'));
  assert.equal(f.calls.filter(c => c === 'provider:send').length, 1);
  assert.equal(f.calls.filter(c => c.startsWith('invoke:')).length, 1);
  assert.equal(f.order.payment_captured, false);
});
test('Lost function response with a stored provider ID recovers without sending again', async () => {
  const f = fixture(); f.faults.lostInvoke = true; await assert.rejects(() => f.perform('confirmation_email'));
  assert.equal((await f.adapters.confirmation_email.reconcile(f.input('confirmation_email'))).outcome, 'completed');
  assert.equal(f.calls.filter(c => c === 'provider:send').length, 1);
});
test('Actual email template includes all 50 accepted checkout lines without truncation', async () => {
  const f = fixture(); f.order.items = Array.from({ length: 50 }, (_, i) => ({
    product_id: `synthetic_item_${i}`, title: `Synthetic Item ${i}`, price: 0, quantity: 1,
  }));
  assert.equal((await f.perform('confirmation_email')).outcome, 'completed');
  const html = f.provider.get(providerId).html;
  assert.match(html, /Synthetic Item 49/);
  assert.equal([...html.matchAll(/<tr><td style="padding: 8px;">/g)].length, 50);
});
test('Optional null product metadata does not falsely block otherwise complete email content', async () => {
  const f = fixture(); f.order.items[0].program_addon_for = null; f.order.items[0].image_url = null;
  assert.equal((await f.perform('confirmation_email')).outcome, 'completed');
  assert.doesNotMatch(f.provider.get(providerId).html, /\bnull\b/);
});
for (const fault of ['lostSend', 'create']) test(`${fault}: unlogged provider acceptance does not become a confirmed email or trigger a replay`, async () => {
  const f = fixture(); f.faults[fault] = fault === 'create' ? 'CustomerMessageDeliveryLog' : true;
  await assert.rejects(() => f.perform('confirmation_email'));
  assert.equal(await f.adapters.confirmation_email.reconcile(f.input('confirmation_email')), null);
  assert.equal(f.calls.filter(c => c === 'provider:send').length, 1);
});
test('Failed initial email-log read stops before sending', async () => {
  const f = fixture(); f.faults.read = 'CustomerMessageDeliveryLog'; await assert.rejects(() => f.perform('confirmation_email'));
  assert.ok(!f.calls.some(c => c.startsWith('invoke:')));
});
test('Absent readback configuration cannot be mistaken for completed provider verification', async () => {
  const f = fixture(); const adapters = createRewardCustomerHandoffAdapters({ base44: f.base44, fetchEmail: f.fetchEmail, resendApiKey: '' });
  f.claim('confirmation_email'); await assert.rejects(() => adapters.confirmation_email.perform(f.input('confirmation_email')), /readback_unavailable/);
  assert.ok(!f.calls.some(c => c.startsWith('invoke:')));
});
for (const [name, mutate] of [
  ['wrong recipient', m => { m.to = ['other@example.test']; }],
  ['extra recipient', m => { m.to.push('other@example.test'); }],
  ['copied recipient', m => { m.bcc.push('other@example.test'); }],
  ['bounced', m => { m.last_event = 'bounced'; }],
  ['scheduled', m => { m.scheduled_at = '2026-09-30T00:00:00Z'; }],
  ['wrong order', m => { m.subject = 'Your Order #OTHER is Confirmed!'; }],
  ['wrong content', m => { m.html = m.html.replace('OASIS', 'UNRELATED'); }],
  ['wrong quantity', m => { m.html = m.html.replace('x2', 'x3'); }],
  ['extra item', m => { m.html = m.html.replace('</tbody>', '<tr>Extra</tr></tbody>'); }],
  ['wrong total', m => { m.html = m.html.replace('Total: $0.00', 'Total: $0.50'); }],
  ['wrong date', m => { m.html = m.html.replace('September 12, 2026', 'September 13, 2026'); }],
  ['wrong link', m => { m.html = m.html.replaceAll('www.nuvirajuice.com', 'invalid.example'); }],
  ['undefined', m => { m.html += '<p>undefined</p>'; }],
]) test(`Email ${name} is not provider-confirmed and is never resent during reconciliation`, async () => {
  const f = fixture(); await f.perform('confirmation_email'); f.faults.message = mutate;
  await assert.rejects(() => f.adapters.confirmation_email.reconcile(f.input('confirmation_email')));
  assert.equal(f.calls.filter(c => c === 'provider:send').length, 1);
});
for (const [name, mutate] of [
  ['foreign record', f => { f.rows.CustomerMessageDeliveryLog[0].customer_email = 'other@example.test'; }],
  ['multiple provider IDs', f => { f.rows.CustomerMessageDeliveryLog.push({ ...f.rows.CustomerMessageDeliveryLog[0], provider_message_id: '00000000-0000-4000-8000-000000000456' }); }],
  ['failed log', f => { f.rows.CustomerMessageDeliveryLog[0].status = 'failed'; }],
  ['truncated read', f => { f.rows.CustomerMessageDeliveryLog = Array.from({ length: 20 }, () => ({ ...f.rows.CustomerMessageDeliveryLog[0] })); }],
  ['provider read failure', f => { f.faults.readFailed = true; }],
]) test(`Email ${name} stops without another send`, async () => {
  const f = fixture(); await f.perform('confirmation_email'); mutate(f);
  await assert.rejects(() => f.perform('confirmation_email'));
  assert.equal(f.calls.filter(c => c === 'provider:send').length, 1);
});
for (const [name, mutate] of [
  ['missing window', o => { delete o.delivery_window_label; }],
  ['missing address', o => { delete o.delivery_address; }],
  ['impossible date', o => { o.assigned_delivery_date = '2026-02-31'; }],
  ['placeholder name', o => { o.customer_name = 'undefined'; }],
  ['bad quantity', o => { o.items[0].quantity = NaN; }],
  ['too many items', o => { o.items = Array(51).fill(o.items[0]); }],
  ['cancelled order', o => { o.status = 'cancelled'; }],
  ['captured cash flag', o => { o.payment_captured = true; }],
]) test(`Email ${name} cannot reach the provider`, async () => {
  const f = fixture(); mutate(f.order); await assert.rejects(() => f.perform('confirmation_email'));
  assert.ok(!f.calls.some(c => c.startsWith('invoke:')));
});
test('Order changed during independent provider read is not reported as a current successful handoff', async () => {
  const f = fixture(); f.faults.afterRead = order => { order.status = 'cancelled'; };
  // Current-order proof is required again after provider verification.
  await assert.rejects(() => f.perform('confirmation_email'), /order_changed/);
  assert.equal(f.calls.filter(c => c === 'provider:send').length, 1);
});
test('Actual in-app handler creates one owned reward notification with the exact order link and no coupled push', async () => {
  const f = fixture(); const result = await f.perform('customer_in_app');
  assert.equal(result.outcome, 'completed'); assert.equal(f.rows.Notification.length, 1);
  const notification = f.rows.Notification[0];
  assert.equal(notification.customer_email, f.order.customer_email);
  assert.equal(notification.deep_link, `/order-tracker/${f.order.order_number}`);
  assert.match(notification.message, /earned reward.*no payment required/);
  assert.ok(!f.calls.includes('invoke:sendCustomerPushNotification'));
  await f.perform('customer_in_app'); await f.adapters.customer_in_app.reconcile(f.input('customer_in_app'));
  assert.equal(f.calls.filter(c => c === 'create:Notification').length, 1);
});
test('A lost in-app function response is recovered from the exact persisted notification', async () => {
  const f = fixture(); f.faults.lostFunction = 'sendCustomerNotification';
  await assert.rejects(() => f.perform('customer_in_app'));
  assert.equal((await f.adapters.customer_in_app.reconcile(f.input('customer_in_app'))).outcome, 'completed');
  assert.equal(f.calls.filter(c => c === 'create:Notification').length, 1);
});
for (const key of ['title', 'message', 'type', 'notification_subtype', 'order_id', 'deep_link', 'customer_email']) {
  test(`A notification with mismatched ${key} is not accepted or resent`, async () => {
    const f = fixture(); await f.perform('customer_in_app'); f.rows.Notification[0][key] = 'foreign';
    await assert.rejects(() => f.perform('customer_in_app'), /content_mismatch/);
    await assert.rejects(() => f.perform('customer_push'));
    assert.equal(f.calls.filter(c => c === 'create:Notification').length, 1);
    assert.ok(!f.calls.includes('push:accept'));
  });
}
test('Duplicate in-app records and notification read failure do not become success', async () => {
  const f = fixture(); await f.perform('customer_in_app'); f.rows.Notification.push({ ...f.rows.Notification[0], id: 'other' });
  await assert.rejects(() => f.perform('customer_in_app'), /not_unique/);
  f.faults.read = 'Notification'; await assert.rejects(() => f.perform('customer_in_app'));
});
function addDevice(f, email = f.order.customer_email) {
  f.rows.PushSubscription.push({ id: `synthetic_device_${f.rows.PushSubscription.length}`, customer_email: email,
    token_type: 'web_push', enabled: true, endpoint: `https://synthetic.invalid/push/${f.rows.PushSubscription.length}`,
    p256dh: 'synthetic-key', auth: 'synthetic-auth' });
}
test('Actual push handler accepts every eligible device and stores an acceptance receipt, never a delivery claim', async () => {
  const f = fixture(); await f.perform('customer_in_app'); addDevice(f); addDevice(f);
  const proof = await f.perform('customer_push'); assert.match(proof.evidence_id, /^push_acceptance:/);
  const log = f.rows.CustomerMessageDeliveryLog[0];
  assert.equal(log.status, 'sent'); assert.equal(log.metadata.outcome, 'provider_accepted');
  assert.equal(log.metadata.token_count, 2); assert.equal(log.metadata.sent_count, 2);
  assert.equal(log.delivered_at, undefined);
  assert.doesNotMatch(JSON.stringify(log.metadata), /synthetic-auth|synthetic-key|endpoint/);
  await f.perform('customer_push'); await f.adapters.customer_push.reconcile(f.input('customer_push'));
  assert.equal(f.calls.filter(c => c === 'push:accept').length, 2);
});
test('No eligible device is an explained skip after successful complete identity/device reads', async () => {
  const f = fixture(); await f.perform('customer_in_app');
  assert.equal((await f.perform('customer_push')).reason, 'no_eligible_device');
  assert.ok(f.calls.includes('read:UserProfile')); assert.ok(f.calls.includes('read:PushSubscription'));
  assert.ok(!f.calls.includes('push:accept'));
});
for (const gate of ['ENABLE_CUSTOMER_PUSH_NOTIFICATIONS', 'ENABLE_CUSTOMER_ORDER_CONFIRMATION_PUSH']) {
  test(`Disabled ${gate} remains disabled with an explicit receipt`, async () => {
    const f = fixture({ [gate]: 'false' }); await f.perform('customer_in_app'); addDevice(f);
    assert.equal((await f.perform('customer_push')).reason, 'channel_disabled');
    assert.ok(!f.calls.includes('push:accept'));
  });
}
test('Missing provider credentials with a real device is a failure, never a channel-disabled skip', async () => {
  const f = fixture({ WEB_PUSH_VAPID_PRIVATE_KEY: '' }); await f.perform('customer_in_app'); addDevice(f);
  await assert.rejects(() => f.perform('customer_push'), /acceptance_incomplete/);
  assert.equal(f.rows.CustomerMessageDeliveryLog.length, 0);
});
for (const entity of ['UserProfile', 'PushSubscription']) {
  test(`Failed ${entity} read cannot be reported as no device`, async () => {
    const f = fixture(); await f.perform('customer_in_app'); f.faults.read = entity;
    await assert.rejects(() => f.perform('customer_push'));
    assert.equal(f.rows.CustomerMessageDeliveryLog.length, 0); assert.ok(!f.calls.includes('push:accept'));
  });
}
test('Truncated profile/device reads do not silently omit recipients', async () => {
  for (const entity of ['UserProfile', 'PushSubscription']) {
    const f = fixture(); await f.perform('customer_in_app');
    f.rows[entity] = Array.from({ length: entity === 'UserProfile' ? 251 : 501 }, (_, i) => ({
      id: `synthetic_${i}`, customer_email: f.order.customer_email,
    }));
    await assert.rejects(() => f.perform('customer_push')); assert.ok(!f.calls.includes('push:accept'));
  }
});
test('All profile aliases are considered, including the second forward profile', async () => {
  const f = fixture(); await f.perform('customer_in_app');
  f.rows.UserProfile.push({ customer_email: f.order.customer_email, contact_email: 'alias1@example.test' },
    { customer_email: f.order.customer_email, contact_email: 'alias2@example.test' });
  addDevice(f, 'alias2@example.test');
  assert.equal((await f.perform('customer_push')).outcome, 'completed');
});
test('A failed provider send cannot complete the push stage', async () => {
  const f = fixture(); await f.perform('customer_in_app'); addDevice(f); f.faults.pushFailed = true;
  await assert.rejects(() => f.perform('customer_push'), /acceptance_incomplete/);
  assert.equal(f.rows.CustomerMessageDeliveryLog.length, 0);
});
test('A partially covered token set is not accepted as complete', async () => {
  const f = fixture(); await f.perform('customer_in_app'); addDevice(f);
  f.rows.PushSubscription.push({ id: 'synthetic_fcm', customer_email: f.order.customer_email, token_type: 'fcm', fcm_token: 'synthetic-fcm' });
  await assert.rejects(() => f.perform('customer_push'), /acceptance_incomplete/);
  assert.equal(f.rows.CustomerMessageDeliveryLog.length, 0);
});
test('A stale push runtime without strict-read evidence is rejected', async () => {
  const f = fixture(); await f.perform('customer_in_app');
  f.faults.functionData = (name, data) => { if (name === 'sendCustomerPushNotification') delete data.complete_readback; };
  await assert.rejects(() => f.perform('customer_push'), /runtime_unconfirmed/);
});
test('Lost push response remains uncertain and reconciliation does not resend', async () => {
  const f = fixture(); await f.perform('customer_in_app'); addDevice(f); f.faults.lostFunction = 'sendCustomerPushNotification';
  await assert.rejects(() => f.perform('customer_push'));
  assert.equal(await f.adapters.customer_push.reconcile(f.input('customer_push')), null);
  assert.equal(f.calls.filter(c => c === 'push:accept').length, 1);
});
test('Lost durable receipt acknowledgement recovers acceptance without another push', async () => {
  const f = fixture(); await f.perform('customer_in_app'); addDevice(f); f.faults.lostReceipt = true;
  await assert.rejects(() => f.perform('customer_push'));
  assert.equal((await f.adapters.customer_push.reconcile(f.input('customer_push'))).outcome, 'completed');
  assert.equal(f.calls.filter(c => c === 'push:accept').length, 1);
});
test('Order cancellation after provider response prevents a false completion receipt', async () => {
  const f = fixture(); await f.perform('customer_in_app'); addDevice(f); f.faults.afterPush = order => { order.status = 'cancelled'; };
  await assert.rejects(() => f.perform('customer_push')); assert.equal(f.rows.CustomerMessageDeliveryLog.length, 0);
});
test('Foreign or duplicate push evidence is rejected without sending', async () => {
  const f = fixture(); await f.perform('customer_in_app'); addDevice(f); await f.perform('customer_push');
  f.rows.CustomerMessageDeliveryLog[0].metadata.context_hash = 'b'.repeat(64);
  await assert.rejects(() => f.perform('customer_push'), /identity_mismatch/);
  f.rows.CustomerMessageDeliveryLog.push({ ...f.rows.CustomerMessageDeliveryLog[0], id: 'other' });
  await assert.rejects(() => f.perform('customer_push'), /not_unique/);
  assert.equal(f.calls.filter(c => c === 'push:accept').length, 1);
});
test('Operations template uses exact reward details and the real admin link without claiming a cash payment or sending coupled push', async () => {
  const f = fixture(); const proof = await f.perform('operations_email');
  assert.equal(proof.evidence_id, `resend:${operationsProviderId}`);
  const html = f.provider.get(operationsProviderId).html;
  assert.match(html, /Reward redeemed — no payment required/);
  assert.match(html, /https:\/\/nuvirajuice\.com\/admin\/orders\?order=NV-SYNTHETIC/);
  assert.doesNotMatch(html, /Payment received|app\.base44\.com|undefined/);
  await f.perform('operations_email'); await f.adapters.operations_email.reconcile(f.input('operations_email'));
  assert.equal(f.calls.filter(c => c === 'operations:send').length, 1);
  assert.ok(!f.calls.includes('invoke:sendAdminOrderProcessedNotification'));
});
test('Operations handler independently rejects a changed reward order before provider contact', async () => {
  const f = fixture(); f.faults.beforeInvoke = order => { order.items[0].quantity += 1; };
  await assert.rejects(() => f.perform('operations_email'));
  assert.ok(!f.calls.includes('operations:send'));
});
test('Operations receipt predicate remains byte-equivalent to the settled-order authority', () => {
  const extract = source => source.match(/function isVerifiedNoPaymentOrder\(order\) \{[\s\S]*?\n\}/)[0];
  assert.equal(extract(fs.readFileSync(operationsPath, 'utf8')),
    extract(fs.readFileSync('base44/functions/stripeWebhook/rewardSettlement.js', 'utf8')));
});
for (const [name, mutate] of [
  ['wrong recipient', msg => { msg.to = ['other@example.test']; }],
  ['bcc recipient', msg => { msg.bcc = ['other@example.test']; }],
  ['wrong title', msg => { msg.subject = 'Foreign order'; }],
  ['wrong items', msg => { msg.html = msg.html.replace('x2', 'x3'); }],
  ['wrong total', msg => { msg.html = msg.html.replace('Total: $0.00', 'Total: $0.50'); }],
  ['wrong schedule', msg => { msg.html = msg.html.replace('2026-09-12', '2026-09-13'); }],
  ['wrong link', msg => { msg.html = msg.html.replace('nuvirajuice.com/admin', 'app.base44.com/admin'); }],
  ['legacy cash copy', msg => { msg.html = msg.html.replace('Reward redeemed', 'Payment received'); }],
  ['bounced', msg => { msg.last_event = 'bounced'; }],
]) test(`Operations ${name} is not confirmed or resent`, async () => {
  const f = fixture(); f.faults.message = mutate;
  await assert.rejects(() => f.perform('operations_email'));
  await assert.rejects(() => f.adapters.operations_email.reconcile(f.input('operations_email')));
  assert.equal(f.calls.filter(c => c === 'operations:send').length, 1);
});
test('Lost operations function response recovers the exact stored provider message without resend', async () => {
  const f = fixture(); f.faults.lostFunction = 'getAdminOperationsDashboardSummary';
  await assert.rejects(() => f.perform('operations_email'));
  assert.equal((await f.adapters.operations_email.reconcile(f.input('operations_email'))).outcome, 'completed');
  assert.equal(f.calls.filter(c => c === 'operations:send').length, 1);
});
test('Operations log read failure stops before send; lost unlogged send remains uncertain', async () => {
  let f = fixture(); f.faults.read = 'CustomerMessageDeliveryLog';
  await assert.rejects(() => f.perform('operations_email')); assert.ok(!f.calls.includes('operations:send'));
  f = fixture(); f.faults.lostSend = true;
  await assert.rejects(() => f.perform('operations_email'));
  assert.equal(await f.adapters.operations_email.reconcile(f.input('operations_email')), null);
  assert.equal(f.calls.filter(c => c === 'operations:send').length, 1);
});
test('Staff push reaches all registered admins, independently from the operations email', async () => {
  const f = fixture(); addDevice(f, 'operations@example.test');
  f.rows.User.push({ id: 'synthetic_admin2', role: 'admin', email: 'admin2@example.test' });
  addDevice(f, 'admin2@example.test');
  const result = await f.perform('operations_push');
  assert.match(result.evidence_id, /^operations_push_acceptance:/);
  assert.equal(f.rows.Notification.length, 2); assert.equal(f.calls.filter(c => c === 'push:accept').length, 2);
  assert.equal(f.rows.CustomerMessageDeliveryLog[0].metadata.recipients.length, 2);
  assert.doesNotMatch(JSON.stringify(f.rows.CustomerMessageDeliveryLog[0].metadata), /example\.test|synthetic-key|synthetic-auth/);
  await f.perform('operations_push'); await f.adapters.operations_push.reconcile(f.input('operations_push'));
  assert.equal(f.calls.filter(c => c === 'push:accept').length, 2); assert.ok(!f.calls.includes('operations:send'));
});
test('Staff with no device produces an explicit skip; mixed registered/unregistered admins are fully accounted for', async () => {
  let f = fixture(); assert.equal((await f.perform('operations_push')).reason, 'no_eligible_device');
  f = fixture(); addDevice(f, 'operations@example.test');
  f.rows.User.push({ id: 'synthetic_admin2', role: 'admin', email: 'admin2@example.test' });
  assert.equal((await f.perform('operations_push')).outcome, 'completed');
  assert.equal(f.rows.CustomerMessageDeliveryLog[0].metadata.recipients[1].reason, 'no_eligible_device');
});
for (const gate of ['ENABLE_ADMIN_PUSH_NOTIFICATIONS', 'ENABLE_ADMIN_ORDER_PROCESSED_PUSH']) {
  test(`Staff gate ${gate} is preserved as an explained skip`, async () => {
    const f = fixture({ [gate]: 'false' }); addDevice(f, 'operations@example.test');
    assert.equal((await f.perform('operations_push')).reason, 'channel_disabled');
    assert.ok(!f.calls.includes('push:accept')); assert.equal(f.rows.Notification.length, 0);
  });
}
test('Staff lookup failure, empty admin inventory and truncated reads cannot become a no-device skip', async () => {
  for (const mode of ['read_failure', 'empty', 'truncated']) {
    const f = fixture();
    if (mode === 'read_failure') f.faults.read = 'User';
    if (mode === 'empty') f.rows.User = [];
    if (mode === 'truncated') f.rows.User = Array.from({ length: 251 }, (_, i) => ({ role: 'admin', email: `admin${i}@example.test` }));
    await assert.rejects(() => f.perform('operations_push')); assert.ok(!f.calls.includes('push:accept'));
    assert.equal(f.rows.CustomerMessageDeliveryLog.length, 0);
  }
});
test('Invalid configured staff recipient is not silently omitted', async () => {
  const f = fixture({ ADMIN_PUSH_RECIPIENT_EMAILS: 'operations@example.test,invalid' });
  await assert.rejects(() => f.perform('operations_push')); assert.ok(!f.calls.includes('push:accept'));
});
test('An existing staff notification without acceptance proof does not trigger duplicate push or claim completion', async () => {
  const f = fixture(); addDevice(f, 'operations@example.test'); await f.perform('operations_push');
  f.rows.CustomerMessageDeliveryLog = [];
  await assert.rejects(() => f.perform('operations_push'));
  assert.equal(f.calls.filter(c => c === 'push:accept').length, 1);
});
test('A staff provider failure leaves the stage unconfirmed', async () => {
  const f = fixture(); addDevice(f, 'operations@example.test'); f.faults.pushFailed = true;
  await assert.rejects(() => f.perform('operations_push')); assert.equal(f.rows.CustomerMessageDeliveryLog.length, 0);
});
test('Lost staff function response cannot be retried as a fresh push', async () => {
  const f = fixture(); addDevice(f, 'operations@example.test'); f.faults.lostFunction = 'sendAdminOrderProcessedNotification';
  await assert.rejects(() => f.perform('operations_push'));
  assert.equal(await f.adapters.operations_push.reconcile(f.input('operations_push')), null);
  assert.equal(f.calls.filter(c => c === 'push:accept').length, 1);
});
test('A stored staff acceptance receipt survives an acknowledgement timeout', async () => {
  const f = fixture(); addDevice(f, 'operations@example.test'); f.faults.lostReceipt = true;
  await assert.rejects(() => f.perform('operations_push'));
  assert.equal((await f.adapters.operations_push.reconcile(f.input('operations_push'))).outcome, 'completed');
  assert.equal(f.calls.filter(c => c === 'push:accept').length, 1);
});
function allowSms(f) {
  f.order.contact_phone = '+12025550123';
  f.rows.UserProfile.push({ id: 'synthetic_profile', customer_email: f.order.customer_email, phone: f.order.contact_phone,
    sms_consent: true, sms_consent_date: '2026-09-01T12:00:00Z' });
}
test('SMS uses the real consented order, stored provider handle and independent status/content readback', async () => {
  const f = fixture(); allowSms(f);
  const proof = await f.perform('sms'); assert.equal(proof.evidence_id, 'sendblue:synthetic-message-handle');
  assert.equal(f.rows.CustomerMessageDeliveryLog[0].provider_message_id, 'synthetic-message-handle');
  assert.equal(f.rows.CustomerMessageDeliveryLog[0].metadata.reward_checkout_session_id, f.order.stripe_checkout_session_id);
  await f.perform('sms'); await f.adapters.sms.reconcile(f.input('sms'));
  assert.equal(f.calls.filter(c => c === 'sms:send').length, 1);
});
test('Missing phone is an explained skip without a provider send', async () => {
  const f = fixture(); assert.equal((await f.perform('sms')).reason, 'no_phone');
  assert.ok(!f.calls.includes('sms:send'));
});
for (const [name, mutate] of [
  ['no consent', profile => { profile.sms_consent = false; }],
  ['different phone', profile => { profile.phone = '+12025550124'; }],
  ['missing consent date', profile => { delete profile.sms_consent_date; }],
  ['future consent date', profile => { profile.sms_consent_date = '2999-01-01'; }],
]) test(`SMS ${name} never sends`, async () => {
  const f = fixture(); allowSms(f); mutate(f.rows.UserProfile[0]);
  assert.equal((await f.perform('sms')).reason, 'preference_opt_out'); assert.ok(!f.calls.includes('sms:send'));
});
test('SMS consent is checked again by the actual sender if revoked between the adapter read and invocation', async () => {
  const f = fixture(); allowSms(f); f.faults.beforeInvoke = () => { f.rows.UserProfile[0].sms_consent = false; };
  assert.equal((await f.perform('sms')).reason, 'preference_opt_out'); assert.ok(!f.calls.includes('sms:send'));
});
test('SMS profile read errors and duplicates fail instead of pretending opt-out or sending', async () => {
  let f = fixture(); allowSms(f); f.faults.read = 'UserProfile'; await assert.rejects(() => f.perform('sms'));
  assert.ok(!f.calls.includes('sms:send'));
  f = fixture(); allowSms(f); f.rows.UserProfile.push({ ...f.rows.UserProfile[0] });
  await assert.rejects(() => f.perform('sms')); assert.ok(!f.calls.includes('sms:send'));
});
for (const [name, mutate] of [
  ['recipient', msg => { msg.number = '+12025550124'; }],
  ['sender', msg => { msg.from_number = '+12025550124'; }],
  ['direction', msg => { msg.is_outbound = false; }],
  ['provider handle', msg => { msg.message_handle = 'other'; }],
  ['provider failure', msg => { msg.error_code = 4; }],
  ['content', msg => { msg.content = 'undefined'; }],
  ['quantity', msg => { msg.content = msg.content.replace('x2', 'x3'); }],
]) test(`SMS mismatched ${name} cannot complete or trigger a resend`, async () => {
  const f = fixture(); allowSms(f); f.faults.smsMessage = mutate;
  await assert.rejects(() => f.perform('sms')); await assert.rejects(() => f.adapters.sms.reconcile(f.input('sms')));
  assert.equal(f.calls.filter(c => c === 'sms:send').length, 1);
});
test('A queued SMS is not a completed handoff; a later SENT readback recovers without resending', async () => {
  const f = fixture(); allowSms(f); f.faults.smsQueued = true;
  await assert.rejects(() => f.perform('sms'));
  f.provider.get('synthetic-message-handle').status = 'SENT';
  assert.equal((await f.adapters.sms.reconcile(f.input('sms'))).outcome, 'completed');
  assert.equal(f.calls.filter(c => c === 'sms:send').length, 1);
});
test('A rejected SMS or lost unlogged acceptance cannot masquerade as a confirmed send', async () => {
  let f = fixture(); allowSms(f); f.faults.smsRejected = true; await assert.rejects(() => f.perform('sms'));
  await assert.rejects(() => f.adapters.sms.reconcile(f.input('sms')));
  f = fixture(); allowSms(f); f.faults.lostSend = true;
  await assert.rejects(() => f.perform('sms')); assert.equal(await f.adapters.sms.reconcile(f.input('sms')), null);
  assert.equal(f.calls.filter(c => c === 'sms:send').length, 1);
});
test('A lost SMS function response reconciles from its durable handle and real status endpoint', async () => {
  const f = fixture(); allowSms(f); f.faults.lostFunction = 'getAdminOperationsDashboardSummary';
  await assert.rejects(() => f.perform('sms')); assert.equal((await f.adapters.sms.reconcile(f.input('sms'))).outcome, 'completed');
  assert.equal(f.calls.filter(c => c === 'sms:send').length, 1);
});
test('Actual durable runner uses seven adapters and reconciles a lost email response exactly once', async () => {
  const f = fixture(); f.faults.lostInvoke = true;
  const synthetic = Object.fromEntries(REWARD_HANDOFF_STAGES.map(stage => [stage, {
    perform: async () => ({ outcome: 'completed', evidence_id: `synthetic:${stage}` }),
    reconcile: async () => ({ outcome: 'completed', evidence_id: `synthetic:${stage}` }),
  }]));
  const run = () => runRewardHandoff({ entities: f.entities, orderId: f.order.id,
    adapters: { ...synthetic, ...f.adapters }, now: () => '2026-09-08T08:10:00Z', attemptId: () => 'synthetic-attempt' });
  assert.deepEqual(await run(), { complete: false, review_required: true, stage: 'confirmation_email' });
  f.faults.lostInvoke = false; assert.equal((await run()).complete, true); await run();
  assert.equal(f.calls.filter(c => c === 'provider:send').length, 1);
  assert.equal(f.calls.filter(c => c === 'update:BagReturn').length, 1);
  assert.doesNotMatch(JSON.stringify(f.order.reward_handoff), /example\.test|Synthetic Test Street|credential/);
});
test('Customer-only factory stays partial and the webhook uses the complete runtime after settlement', () => {
  const f = fixture(); assert.deepEqual(Object.keys(f.adapters), ['bag_return', 'confirmation_email', 'customer_in_app', 'customer_push', 'operations_email', 'operations_push', 'sms']);
  const webhook = fs.readFileSync('base44/functions/stripeWebhook/entry.ts', 'utf8');
  assert.match(webhook, /runHandoff: result => runVerifiedRewardHandoff/);
  assert.doesNotMatch(webhook, /runHandoff:.*createRewardCustomerHandoffAdapters/);
  assert.match(fs.readFileSync('base44/functions/getAdminOperationsDashboardSummary/entry.ts', 'utf8'),
    /Bundle revision: reward-communications-20260908/);
});

export { fixture as createCommunicationFixture };
if (process.argv[1]?.endsWith('run-reward-customer-handoff-tests.mjs')) {
let passed = 0;
for (const [name, run] of tests) { try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`Reward customer handoff: ${passed}/${tests.length}. Actual customer/staff email/in-app/push/SMS handlers, simulated storage and provider only; native and Shopify runner stages remain synthetic.`);
}
