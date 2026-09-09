import assert from 'node:assert/strict';
import fs from 'node:fs';
import { notifyRouteReview } from '../../base44/shared/routeReviewNotifications.js';
import { ROUTE_REVIEW_REVISION, routeReviewExpiryAction } from '../../base44/shared/routeReview.js';

globalThis.fetch = async () => { throw new Error('External network forbidden'); };
const now = Date.parse('2026-09-09T12:00:00Z');
function fixture(stage = 'submitted', noPayment = false) {
  const rows = []; const calls = []; const emails = new Map(); const faults = {};
  const proof = { noPayment, provider: { id: noPayment ? 'cs_synthetic' : 'pi_synthetic' },
    order: { id: 'order-synthetic', order_number: 'NV-SYNTHETIC', customer_email: 'buyer@example.test', payment_captured: false },
    dar: { id: 'dar-synthetic', request_number: 'DAR-SYNTHETIC', customer_email: 'buyer@example.test',
      status: stage === 'submitted' ? 'pending_review' : stage,
      ...(stage === 'submitted' ? { provider_confirmation: { provider_id: noPayment ? 'cs_synthetic' : 'pi_synthetic' } }
        : { review_decision: { complete: true } }) } };
  const config = { RESEND_API_KEY: 'synthetic-resend', TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN: 'synthetic-internal',
    ENABLE_ELEVATED_TRANSACTIONAL_COMMUNICATIONS: 'true', TRANSACTIONAL_COMMUNICATIONS_KILL_SWITCH: 'false',
    TRANSACTIONAL_COMMUNICATIONS_MODE: 'production' };
  const base44 = { asServiceRole: { entities: { CustomerMessageDeliveryLog: {
    filter: async query => structuredClone(rows.filter(row => Object.entries(query).every(([k, v]) => row[k] === v))),
    create: async value => { calls.push('log:create'); rows.push({ id: 'log-' + rows.length, ...structuredClone(value) }); },
    update: async (id, value) => { calls.push('log:update'); if (faults.ignoreLogWrite) return;
      Object.assign(rows.find(row => row.id === id), structuredClone(value)); },
  } }, functions: { invoke: async (name, body) => {
    assert.equal(name, 'sendCustomerNotification'); assert.equal(body.notification_subtype, 'route_review');
    assert.equal(body.source, 'elevated_transactional'); assert.equal(body.internal_token, config.TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN);
    assert.equal(body.order_id, proof.order.id); calls.push('notification');
    return { data: faults.notification || { success: true, notification_id: 'notification-synthetic',
      push_sent: false, push_skipped_reason: 'no_active_push_subscription' } };
  } } } };
  const fetchImpl = async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails'); assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer synthetic-resend');
    const key = options.headers['Idempotency-Key']; const body = JSON.parse(options.body); calls.push('resend');
    if (faults.providerReject) return { ok: false, json: async () => ({ error: 'synthetic' }) };
    if (!emails.has(key)) emails.set(key, { id: 'email-' + emails.size, body });
    if (faults.lostAcknowledgement) { faults.lostAcknowledgement = false; throw new Error('synthetic lost acknowledgment'); }
    return { ok: true, json: async () => ({ id: emails.get(key).id }) };
  };
  return { rows, calls, emails, faults, proof, config,
    run: (time = now) => notifyRouteReview({ base44, proof, stage, env: { get: key => config[key] }, fetchImpl, now: time }) };
}
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS', name); }
for (const stage of ['submitted', 'denied', 'expired']) for (const noPayment of [false, true]) {
  await test(`${stage} ${noPayment ? 'cashless' : 'manual-card'} communication is truthful, provider-backed and replay-safe`, async () => {
    const f = fixture(stage, noPayment); await f.run(); await f.run();
    assert.equal(f.emails.size, stage === 'submitted' ? 3 : 1);
    assert.equal(f.calls.filter(c => c === 'resend').length, f.emails.size);
    assert.ok(f.rows.every(row => row.status === 'sent' && row.provider_message_id));
    const text = [...f.emails.values()][0].body.text;
    assert.doesNotMatch(text, /undefined|null|fully released|charged successfully/i);
    assert.match(text, stage === 'submitted' ? /reserved|authorized only/ : /No card payment was captured/);
    if (!noPayment && stage !== 'submitted') assert.match(text, /your bank controls/i);
  });
}
await test('unknown provider acknowledgment reuses the same provider key, not a duplicate email', async () => {
  const f = fixture('denied'); f.faults.lostAcknowledgement = true;
  await assert.rejects(() => f.run(), /lost acknowledgment/); assert.equal(f.rows[0].status, 'prepared');
  await f.run(); assert.equal(f.emails.size, 1); assert.equal(f.rows[0].status, 'sent');
});
await test('lost email-log write is detected and can be recovered inside the provider window', async () => {
  const f = fixture('denied'); f.faults.ignoreLogWrite = true;
  await assert.rejects(() => f.run(), /notification_unconfirmed/); assert.equal(f.calls.includes('notification'), false);
  f.faults.ignoreLogWrite = false; await f.run(); assert.equal(f.emails.size, 1);
});
await test('unknown prepared message beyond provider idempotency window requires review without a resend', async () => {
  const f = fixture('denied'); f.faults.lostAcknowledgement = true; await assert.rejects(() => f.run());
  await assert.rejects(() => f.run(now + 24 * 3600000), /notification_unconfirmed/);
  assert.equal(f.calls.filter(c => c === 'resend').length, 1);
});
await test('provider rejection never becomes a sent log or in-app success', async () => {
  const f = fixture('denied'); f.faults.providerReject = true;
  await assert.rejects(() => f.run()); assert.equal(f.rows[0].status, 'prepared'); assert.equal(f.calls.includes('notification'), false);
});
for (const notification of [
  { success: true, skipped: true, reason: 'non_confirmation_customer_notifications_disabled' },
  { success: true, notification_id: 'n', push_skipped_reason: 'push_function_unavailable' },
  { success: true, notification_id: 'n', push_skipped_reason: 'push_delivery_failed' },
  { success: false },
]) await test('skipped or failed notification cannot masquerade as delivery', async () => {
  const f = fixture('denied'); f.faults.notification = notification; await assert.rejects(() => f.run(), /notification_unconfirmed/);
  assert.equal(f.emails.size, 1); f.faults.notification = { success: true, skipped: true,
    reason: 'duplicate_idempotency_key', notification_id: 'n', push_sent: true };
  await f.run(); assert.equal(f.emails.size, 1);
});
await test('wrong owner or unconfirmed state stops before any communication write', async () => {
  const f = fixture('denied'); f.proof.dar.customer_email = 'other@example.test';
  await assert.rejects(() => f.run()); assert.equal(f.calls.length, 0);
  f.proof.dar.customer_email = f.proof.order.customer_email; f.proof.dar.review_decision.complete = false;
  await assert.rejects(() => f.run()); assert.equal(f.calls.length, 0);
});
await test('disabled transactional gate stops before provider or message-log writes', async () => {
  const f = fixture('denied'); f.config.TRANSACTIONAL_COMMUNICATIONS_MODE = 'disabled';
  await assert.rejects(() => f.run()); assert.equal(f.calls.length, 0);
});
await test('both existing notification transports recognize protected route-review subtype', () => {
  for (const file of ['sendCustomerNotification', 'sendCustomerPushNotification']) {
    assert.match(fs.readFileSync(`base44/functions/${file}/entry.ts`, 'utf8'), /const ELEVATED_TRANSACTIONAL[^=]*= new Set\(\[\s*'route_review'/);
  }
});
await test('expiry handles abandoned preparation, real authorization deadlines, and failed-message retries without canceling approvals', () => {
  const pending = { checkout_revision: ROUTE_REVIEW_REVISION, status: 'pending_review', created_date: new Date(now - 49 * 3600000).toISOString() };
  assert.equal(routeReviewExpiryAction(pending, now), 'expire');
  assert.equal(routeReviewExpiryAction({ ...pending, status: 'pending_authorization' }, now), 'expire');
  assert.equal(routeReviewExpiryAction({ ...pending, created_date: new Date(now).toISOString() }, now), null);
  assert.equal(routeReviewExpiryAction({ ...pending, created_date: new Date(now).toISOString(), authorization_expires_at: new Date(now - 1).toISOString() }, now), 'expire');
  assert.equal(routeReviewExpiryAction({ ...pending, review_decision: { kind: 'approve' } }, now), null);
  for (const kind of ['deny', 'expire', 'cancel']) {
    const closed = { ...pending, status: kind === 'expire' ? 'expired' : 'denied', review_decision: { kind, complete: true } };
    assert.equal(routeReviewExpiryAction(closed, now), null);
    assert.equal(routeReviewExpiryAction({ ...closed, communications_pending: true }, now), kind);
  }
  const source = fs.readFileSync('base44/functions/autoExpireZone3Authorizations/entry.ts', 'utf8');
  assert.match(source, /pagination_repeated/); assert.match(source, /pagination_limit/);
  assert.match(source, /filter\(\{\}, '-created_date', 100, offset\)/);
});
console.log(`Route-review communications: ${passed}/${passed}; synthetic transports only, no external messages.`);
