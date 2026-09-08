import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import { createRewardCustomerHandoffAdapters } from '../../base44/functions/stripeWebhook/rewardCustomerHandoff.js';
import { runRewardHandoff, REWARD_HANDOFF_STAGES } from '../../base44/functions/stripeWebhook/rewardHandoff.js';

// Actual adapter + actual existing email handler/template. All storage, function
// transport and Resend HTTP are simulated. No network or provider is available.
const emailSource = transformSync(fs.readFileSync('base44/functions/sendOrderReceivedNotification/entry.ts', 'utf8'),
  { loader: 'ts', format: 'cjs' }).code;
const tests = []; const test = (name, run) => tests.push([name, run]);
const providerId = '00000000-0000-4000-8000-000000000123';
function fixture() {
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
  const rows = { Order: [order], BagReturn: [bag], CustomerMessageDeliveryLog: [] };
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
      const row = { ...structuredClone(data), id: `synthetic_log_${rows[name].length}` }; rows[name].push(row); return row;
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
  let handler;
  const base44 = { auth: { me: async () => ({ role: 'admin' }) }, asServiceRole: { entities, functions: {
    invoke: async (name, payload) => {
      calls.push(`invoke:${name}`);
      assert.equal(name, 'sendOrderReceivedNotification');
      if (faults.beforeInvoke) faults.beforeInvoke(order);
      const response = await handler(new Request('https://synthetic.invalid/email', { method: 'POST', body: JSON.stringify(payload) }));
      if (faults.lostInvoke) throw new Error('synthetic lost function response');
      const data = await response.json();
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
  const fetchEmail = async (url, options) => {
    calls.push('provider:read'); assert.equal(url, `https://api.resend.com/emails/${providerId}`);
    assert.equal(options.method, 'GET');
    if (faults.readFailed) return Response.json({}, { status: 503 });
    const message = structuredClone(provider.get(providerId));
    if (faults.message) faults.message(message);
    if (faults.afterRead) faults.afterRead(order);
    return Response.json(message);
  };
  const adapters = createRewardCustomerHandoffAdapters({ base44, fetchEmail, resendApiKey: 'synthetic-provider-credential' });
  const snapshot = () => structuredClone(order);
  function claim(stage) {
    order.reward_handoff = { revision: '2026-09-08.reward-handoff-v1', checkout_session_id: order.stripe_checkout_session_id,
      context_hash: order.reward_settlement.context_hash, steps: { ...(order.reward_handoff?.steps || {}),
        [stage]: { state: 'dispatching', attempt_id: `synthetic_${stage}`, started_at: '2026-09-08T08:10:00Z' } } };
  }
  const input = stage => ({ order: snapshot(), idempotencyKey: `reward_handoff:${order.id}:${stage}` });
  const perform = async stage => { claim(stage); return adapters[stage].perform(input(stage)); };
  return { order, bag, rows, entities, base44, calls, provider, faults, adapters, claim, input, perform, fetchEmail };
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
test('Actual durable runner uses these two adapters and reconciles a lost email response exactly once', async () => {
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
test('Factory cannot accidentally advertise all stages or change the production webhook activation boundary', () => {
  const f = fixture(); assert.deepEqual(Object.keys(f.adapters), ['bag_return', 'confirmation_email']);
  const webhook = fs.readFileSync('base44/functions/stripeWebhook/entry.ts', 'utf8');
  assert.match(webhook, /runHandoff: null/);
});

let passed = 0;
for (const [name, run] of tests) { try { await run(); passed++; console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`, error); process.exitCode = 1; } }
console.log(`Reward customer handoff: ${passed}/${tests.length}. Actual adapters/email handler, simulated storage and provider only; other seven runner stages remain synthetic.`);
