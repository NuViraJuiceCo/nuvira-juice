import { creditAccountState, creditCents, settleCheckoutCredit } from '../../shared/checkoutCredit.js';
import { readPointsAccount } from '../enrollNewCustomerInLoyalty/pointsAccount.js';
import { hasBirthdayCheckout, verifyBirthdayCheckoutHold, settleVerifiedBirthdayCheckout } from './birthdayCheckout.js';
import { readRouteReview, claimRouteDecision, finishRouteDecision } from '../../shared/routeReview.js';

export const PAID_RECOVERY_REVISION = '2026-09-08.paid-checkout-recovery-v1';
const keyPattern = /^[A-Za-z0-9_-]{20,200}$/;
const orderPattern = /^NV-[A-F0-9]{24}$/;
const resumable = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);
const assert = value => { if (!value) throw new Error('paid_checkout_recovery_unconfirmed'); };
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
  new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const equal = (left, right) => {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
};
const one = rows => { assert(Array.isArray(rows) && rows.length === 1 && rows[0]?.id); return rows[0]; };
const pending = order => order.status === 'pending_payment' && order.payment_status === 'pending'
  && order.financial_status === 'pending' && order.payment_captured === false;

// Lookup uses an authenticated account + attempt digest, or the previously
// issued guest receipt secret. Caller-supplied email/PI/status is never authority.
// Missing records are ambiguous, not permission to create another payment.
async function proof({ base44, stripe, user, body, now = Date.now() }) {
  const entities = base44.asServiceRole.entities;
  assert(keyPattern.test(body.checkout_idempotency_key || ''));
  const guest = body.guest_checkout === true;
  let email = String(user?.email || '').trim().toLowerCase();
  let orderNumber;
  if (guest) {
    assert(keyPattern.test(body.guest_order_token || '') && orderPattern.test(body.order_number || ''));
    orderNumber = body.order_number;
  } else {
    assert(user?.id && email && !body.guest_order_token);
    orderNumber = `NV-${(await hash(`${email}:${body.checkout_idempotency_key}`)).slice(0, 24).toUpperCase()}`;
  }
  const session = one(await entities.CheckoutSession.filter({ order_number: orderNumber }, undefined, 2));
  const data = session.checkout_data;
  assert(data && data.order_number === orderNumber && data.checkout_idempotency_key === body.checkout_idempotency_key
    && data.guest_checkout === guest && data.internal_sandbox_checkout !== true && !data.sandbox_test_id
    && data.paid_recovery_revision === PAID_RECOVERY_REVISION && /^[a-f0-9]{64}$/.test(data.checkout_context_hash || ''));
  if (guest) {
    assert(Date.parse(session.expires_at) > now
      && equal(data.guest_order_token_hash, await hash(body.guest_order_token)));
    email = data.customer_email;
    assert(typeof email === 'string' && email === email.trim().toLowerCase());
    assert(orderNumber === `NV-${(await hash(`${email}:${body.checkout_idempotency_key}`)).slice(0, 24).toUpperCase()}`);
  } else assert(data.customer_app_user_id === user.id);
  assert(session.customer_email === email && data.customer_email === email);
  assert(/^pi_[A-Za-z0-9_]+$/.test(session.stripe_session_id || ''));
  const order = one(await entities.Order.filter({ order_number: orderNumber }, undefined, 2));
  assert(order.customer_email === email && order.stripe_payment_intent_id === session.stripe_session_id
    && order.is_test_order !== true && order.internal_sandbox_checkout !== true
    && !['refunded', 'partially_refunded'].includes(order.payment_status) && order.status !== 'refunded');
  // Detect conflicting PI ownership or duplicate materialization as well.
  assert(one(await entities.Order.filter({ stripe_payment_intent_id: session.stripe_session_id }, undefined, 2)).id === order.id);
  assert(one(await entities.CheckoutSession.filter({ stripe_session_id: session.stripe_session_id }, undefined, 2)).id === session.id);
  const payment = await stripe.paymentIntents.retrieve(session.stripe_session_id);
  const meta = payment?.metadata || {};
  assert(payment?.id === session.stripe_session_id && payment.livemode === true && payment.currency === 'usd'
    && meta.checkout_version === '3.0_embedded' && meta.checkout_mode === (guest ? 'guest' : 'account')
    && meta.customer_email === email && meta.order_number === orderNumber
    && meta.checkout_context_hash === data.checkout_context_hash
    && meta.internal_sandbox_checkout !== 'true' && meta.is_test_order !== 'true'
    && Number.isSafeInteger(payment.amount) && payment.amount >= 50
    && creditCents(data.total) === payment.amount && creditCents(order.total) === payment.amount
    && ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing', 'requires_capture', 'succeeded', 'canceled'].includes(payment.status));
  if (payment.status === 'succeeded') assert(payment.amount_received === payment.amount);
  if (resumable.has(payment.status)) assert(pending(order));
  if (payment.status === 'canceled') assert(pending(order)
    || (order.status === 'cancelled' && order.payment_status === 'cancelled' && order.payment_captured === false));
  assert(Array.isArray(data.items) && data.items.length > 0 && data.items.length <= 50
    && data.items.every(item => typeof item.title === 'string' && item.title.trim()
      && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100
      && Number.isFinite(item.price) && item.price >= 0));
  const routeRows = payment.metadata.route_review_request ? await entities.DeliveryApprovalRequest.filter({ request_number: payment.metadata.route_review_request }, undefined, 2) : [];
  assert(Array.isArray(routeRows) && routeRows.length <= 1);
  const route = routeRows.length ? await readRouteReview(entities, payment) : null;
  if (payment.metadata.route_review_request && !route) assert(resumable.has(payment.status) || payment.status === 'canceled');
  return { entities, stripe, session, data, order, payment, email, guest, orderNumber, now, route };
}

export async function verifyPaidCheckoutHolds(ctx) {
  const { entities, payment, data, email, guest } = ctx;
  const meta = payment.metadata;
  for (const field of ['reward_reservation_id', 'credit_reservation_id', 'birthday_reservation_id']) assert((meta[field] || null) === (data[field] || null));
  if (guest) assert(!meta.reward_reservation_id && !meta.credit_reservation_id && !meta.birthday_reservation_id && !hasBirthdayCheckout(data.items));
  if (meta.birthday_reservation_id || hasBirthdayCheckout(data.items)) {
    assert(meta.birthday_reservation_id);
    await verifyBirthdayCheckoutHold({ entities, stripe: ctx.stripe, customerEmail: email, paymentIntentId: payment.id });
  }
  if (meta.reward_reservation_id) {
    const account = await readPointsAccount(entities, email);
    const hold = account.reward_reservations.find(row => row.reservation_id === meta.reward_reservation_id);
    assert(hold?.status === 'held' && hold.payment_intent_id === payment.id
      && hold.context_hash === data.checkout_context_hash && hold.points === data.reward_reservation_points);
  }
  if (meta.credit_reservation_id) {
    const account = one(await entities.NuViraCredit.filter({ customer_email: email }, undefined, 2));
    const hold = creditAccountState(account).holds.find(row => row.reservation_id === meta.credit_reservation_id);
    assert(hold?.status === 'held' && hold.payment_intent_id === payment.id
      && hold.context_hash === data.checkout_context_hash && hold.amount_cents === creditCents(data.credits_discount)
      && hold.amount_cents === Number(meta.credit_reservation_cents));
  }
}

function summary(ctx) {
  return { revision: PAID_RECOVERY_REVISION, order_number: ctx.orderNumber, state: ctx.payment.status,
    ...(ctx.route ? { routeReview: { requestNumber: ctx.route.dar.request_number, darId: ctx.route.dar.id,
      status: ctx.route.dar.status, total: ctx.payment.amount / 100 } } : {}),
    total: ctx.payment.amount / 100, currency: 'usd', guest_checkout: ctx.guest,
    delivery_date: ctx.data.assigned_delivery_date, delivery_window: ctx.data.delivery_window_label,
    items: ctx.data.items.map(item => ({ title: item.title, quantity: item.quantity, price: item.price })),
    writes_performed: false, payment_confirmation_attempted: false, payment_intent_created: false,
    order_created: false, ok: true };
}

export async function recoverPaidCheckout(options) {
  const ctx = await proof(options);
  const result = summary(ctx);
  if (options.body.mode === 'read_paid_checkout_recovery') return result;
  assert(options.body.mode === 'resume_paid_checkout');
  if (ctx.payment.metadata.route_review_request) assert(ctx.route && !ctx.route.dar.review_decision);
  // Do not revive an expired offer/delivery window. Cancellation remains an
  // explicit action; age alone never releases a hold or authorizes a retry.
  assert(resumable.has(ctx.payment.status) && Date.parse(ctx.session.expires_at) > ctx.now
    && Date.parse(`${ctx.data.assigned_delivery_date}T00:00:00Z`) > ctx.now);
  await verifyPaidCheckoutHolds(ctx);
  assert(typeof ctx.payment.client_secret === 'string'
    && ctx.payment.client_secret.startsWith(`${ctx.payment.id}_secret_`)
    && /^pk_live_[A-Za-z0-9]+$/.test(options.publishableKey || ''));
  return { ...result, clientSecret: ctx.payment.client_secret, publishableKey: options.publishableKey,
    customerName: ctx.data.customer_name, customerEmail: ctx.email, customerPhone: ctx.data.contact_phone };
}

export async function cancelPaidCheckout(options) {
  let ctx = await proof(options);
  assert(resumable.has(ctx.payment.status) || ctx.payment.status === 'canceled'
    || (ctx.route && ctx.payment.status === 'requires_capture'));
  // Missing CAS/ledger capability blocks before provider cancellation.
  assert(typeof ctx.entities.Order.updateMany === 'function');
  if (ctx.payment.metadata.reward_reservation_id) assert(options.secret);
  if (ctx.route) await claimRouteDecision(ctx.entities, ctx.payment, { kind: 'cancel', actor: ctx.email,
    reason: 'Customer canceled this route-review checkout.', now: ctx.now });
  if (resumable.has(ctx.payment.status) || (ctx.route && ctx.payment.status === 'requires_capture')) await options.stripe.paymentIntents.cancel(ctx.payment.id);
  // A lost acknowledgment, capture race, or processing state is never success.
  ctx = await proof(options);
  assert(ctx.payment.status === 'canceled');
  if (ctx.payment.metadata.birthday_reservation_id || hasBirthdayCheckout(ctx.data.items)) {
    assert(ctx.payment.metadata.birthday_reservation_id);
    const result = await settleVerifiedBirthdayCheckout({ entities: ctx.entities, stripe: options.stripe,
      customerEmail: ctx.email, paymentIntentId: ctx.payment.id, now: ctx.now });
    assert(result.reservation_status === 'released');
  }
  if (ctx.payment.metadata.reward_reservation_id) {
    const response = await options.base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
      action: 'settle_reward_checkout', customer_email: ctx.email,
      stripe_payment_intent_id: ctx.payment.id, internal_secret: options.secret,
    });
    assert((response?.data || response)?.reservation_status === 'released');
  }
  if (ctx.payment.metadata.credit_reservation_id) {
    const result = await settleCheckoutCredit({ entities: ctx.entities, payment: ctx.payment, email: ctx.email });
    assert(result.reservation_status === 'released');
  }
  if (pending(ctx.order)) {
    const result = await ctx.entities.Order.updateMany({ id: ctx.order.id, stripe_payment_intent_id: ctx.payment.id,
      status: 'pending_payment', payment_status: 'pending', financial_status: 'pending', payment_captured: false },
    { $set: { status: 'cancelled', payment_status: 'cancelled', financial_status: 'cancelled',
      do_not_recover: true, abandoned_checkout: true } });
    assert(result?.success === true && result.has_more === false && [0, 1].includes(result.updated));
  }
  const confirmed = one(await ctx.entities.Order.filter({ id: ctx.order.id }, undefined, 2));
  assert(confirmed.status === 'cancelled' && confirmed.payment_status === 'cancelled'
    && confirmed.financial_status === 'cancelled' && confirmed.payment_captured === false
    && confirmed.do_not_recover === true && confirmed.abandoned_checkout === true);
  if (ctx.route) await finishRouteDecision(ctx.entities, ctx.payment, 'denied', ctx.now);
  return { ok: true, revision: PAID_RECOVERY_REVISION, order_number: ctx.orderNumber,
    payment_attempt_canceled: true, benefit_reservations_released: true, order_cancelled: true,
    payment_confirmation_attempted: false };
}
