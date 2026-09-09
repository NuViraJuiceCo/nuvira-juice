// Runs only after the caller has authenticated, priced the catalog/reward, and
// validated delivery and the selected schedule. Never confirms an order here.
import { NO_PAYMENT_POINTS_REVISION, verifiedNoPaymentPointsSnapshot, verifiedNoPaymentPointsMetadata,
  verifiedNoPaymentTierPointsSnapshot } from '../../shared/noPaymentPoints.js';
import { NO_PAYMENT_CREDIT_REVISION, verifiedNoPaymentCreditSnapshot, verifiedNoPaymentCreditMetadata } from '../../shared/noPaymentCredit.js';
import { reserveNoPaymentCheckoutCredit, settleNoPaymentCheckoutCredit } from '../../shared/checkoutCredit.js';
import { noPaymentBirthdayMetadata, NO_PAYMENT_BIRTHDAY_REVISION } from '../../shared/noPaymentBirthday.js';
import { reserveNoPaymentBirthdayCheckout, settleNoPaymentBirthdayCheckout } from './birthdayCheckout.js';
import { readRouteReview } from '../../shared/routeReview.js';
import { decideRouteReview } from '../../shared/routeReviewDecision.js';
export { NO_PAYMENT_BIRTHDAY_REVISION };
export { NO_PAYMENT_POINTS_REVISION };
export { NO_PAYMENT_CREDIT_REVISION };
export const NO_PAYMENT_CHECKOUT_VERSION = '4.0_reward_no_payment';
const hashPattern = /^[a-f0-9]{64}$/;
const sessionPattern = /^cs_[A-Za-z0-9_]+$/;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const email = value => String(value || '').trim().toLowerCase();
const assert = (condition, code) => { if (!condition) throw new Error(code); };
const body = result => result?.data || result;

function verifySession(session, metadata) {
  assert(sessionPattern.test(session?.id || '') && session.livemode === true
    && session.mode === 'payment' && session.currency === 'usd' && session.amount_total === 0
    && session.payment_intent === null && ['open', 'complete', 'expired'].includes(session.status)
    && ['unpaid', 'no_payment_required'].includes(session.payment_status)
    && (session.status !== 'complete' || session.payment_status === 'no_payment_required')
    && email(session.customer_email) === email(metadata.customer_email), 'reward_session_not_verified');
  for (const key of Object.keys(metadata)) {
    assert(session.metadata?.[key] === metadata[key], 'reward_session_context_mismatch');
  }
}

function orderSnapshot(data, session) {
  const keys = ['order_number', 'customer_email', 'customer_name', 'items', 'subtotal', 'delivery_fee', 'total',
    'fulfillment_type', 'delivery_address', 'address_line1', 'address_line2', 'address_city', 'address_state',
    'address_postal_code', 'address_country', 'contact_phone', 'estimated_delivery_date', 'assigned_delivery_date',
    'assigned_production_day', 'production_date', 'delivery_window_label', 'assigned_delivery_window_start',
    'assigned_delivery_window_end', 'delivery_window_timezone', 'final_schedule_source', 'scheduling_reason',
    'schedule_timezone', 'cutoff_window_label', 'referral_code', 'promotion_code', 'promotion_discount_percent',
    'promotion_discount_amount', 'total_discounts', 'discount_codes', 'health_advisory_acknowledged',
    'health_advisory_acknowledged_at', 'health_advisory_version', 'delivery_zone_id'];
  const order = Object.fromEntries(keys.filter(key => data[key] !== undefined).map(key => [key, data[key]]));
  return { ...order, ...(data.bag_return_request_id ? { bag_return_request_id: data.bag_return_request_id } : {}),
    status: 'pending_payment', payment_status: 'pending', financial_status: 'pending',
    payment_captured: false, stripe_checkout_session_id: session.id, is_preorder: false,
    source_type: 'one_time', is_test_order: false,
    status_history: [{ status: 'pending_payment', timestamp: new Date().toISOString(),
      message: 'Reward checkout prepared — awaiting your confirmation. No card payment is required.' }] };
}

function verifyRecords(orders, contexts, data, session) {
  assert(Array.isArray(orders) && orders.length === 1 && orders[0]?.id
    && Array.isArray(contexts) && contexts.length === 1 && contexts[0]?.id, 'reward_checkout_records_not_unique');
  const order = orders[0]; const context = contexts[0]; const stored = context.checkout_data;
  assert(order.customer_email === data.customer_email && context.customer_email === data.customer_email
    && order.order_number === data.order_number && context.order_number === data.order_number
    && order.total === 0 && !order.stripe_payment_intent_id && order.payment_captured === false
    && order.stripe_checkout_session_id === session.id && context.stripe_session_id === session.id
    && stored?.checkout_context_hash === data.checkout_context_hash
    && stored?.reward_reservation_id === data.reward_reservation_id
    && stored?.reward_reservation_points === data.reward_reservation_points
    && stored?.customer_email === data.customer_email && stored?.order_number === data.order_number
    && stored?.total === 0 && stored?.credits_discount === data.credits_discount
    && (order.bag_return_request_id || null) === (data.bag_return_request_id || null)
    && same(stored?.items, data.items) && same(order.items, data.items)
    && same(stored?.active_reward, data.active_reward), 'reward_checkout_records_mismatch');
  for (const key of ['assigned_delivery_date', 'assigned_production_day', 'assigned_delivery_window_start',
    'assigned_delivery_window_end', 'delivery_window_label', 'health_advisory_version']) {
    assert(order[key] === data[key] && stored[key] === data[key], 'reward_checkout_schedule_mismatch');
  }
  for (const key of Object.keys(data)) {
    // Server-observed acknowledgment time changes on retries; preserve the
    // original, while every immutable checkout fact must remain identical.
    if (key !== 'health_advisory_acknowledged_at') assert(same(stored[key], data[key]), 'reward_checkout_snapshot_changed');
  }
  for (const key of ['address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code',
    'contact_phone', 'subtotal', 'delivery_fee', 'total_discounts', 'health_advisory_acknowledged']) {
    assert(same(order[key], data[key]), 'reward_order_snapshot_changed');
  }
  assert(order.is_test_order !== true && order.is_abandoned_checkout !== true && order.do_not_recover !== true
    && !['cancelled', 'canceled', 'failed', 'refunded'].includes(order.status)
    && !(Number(order.amount_refunded || 0) > 0), 'reward_checkout_order_terminal');
  if (session.status === 'open') assert(order.status === 'pending_payment' && order.payment_status === 'pending'
    && order.financial_status === 'pending' && !order.reward_settlement, 'reward_checkout_not_pending');
}

async function verifyRequestedBagReturn(entities, data) {
  if (!data.bag_return_request_id) return;
  const bags = await entities.BagReturn.filter({ id: data.bag_return_request_id }, undefined, 2);
  assert(Array.isArray(bags) && bags.length === 1 && bags[0]?.id === data.bag_return_request_id
    && email(bags[0].customer_email) === email(data.customer_email), 'reward_bag_request_unconfirmed');
  const bag = bags[0];
  if (bag.order_id === 'pending' && bag.verification_status === 'requested') return;
  // A completed checkout may legitimately replay after its handoff linked or
  // collected the bag. Only that exact persisted order may reuse the reference.
  const orders = await entities.Order.filter({ id: bag.order_id }, undefined, 2);
  assert(Array.isArray(orders) && orders.length === 1 && orders[0]?.order_number === data.order_number
    && email(orders[0].customer_email) === email(data.customer_email)
    && orders[0].bag_return_request_id === bag.id && orders[0].total === 0
    && orders[0].payment_captured === false && sessionPattern.test(orders[0].stripe_checkout_session_id || ''),
  'reward_bag_already_assigned');
}

// Expiration is provider-authoritative. A completion race, failed read, or lost
// provider acknowledgment cannot release points or cancel a fulfilled order.
export async function cancelNoPaymentCheckout({ base44, stripe, sessionId, customerEmail, secret }) {
  assert(secret && email(customerEmail) && sessionPattern.test(sessionId || ''), 'reward_cancel_identity_required');
  let session = await stripe.checkout.sessions.retrieve(sessionId);
  const metadata = session?.metadata || {};
  assert(metadata.checkout_version === NO_PAYMENT_CHECKOUT_VERSION && metadata.checkout_mode === 'account'
    && email(metadata.customer_email) === email(customerEmail) && hashPattern.test(metadata.checkout_context_hash || '')
    && metadata.reward_reservation_id && metadata.order_number && metadata.is_test_order !== 'true'
    && metadata.internal_sandbox_checkout !== 'true', 'reward_cancel_identity_mismatch');
  verifySession(session, metadata);
  const routeRows = metadata.route_review_request ? await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ request_number: metadata.route_review_request }, undefined, 2) : [];
  assert(Array.isArray(routeRows) && routeRows.length <= 1, 'route_review_not_unique');
  if (routeRows.length) {
    const proof = await readRouteReview(base44.asServiceRole.entities, session);
    const result = await decideRouteReview({ base44, stripe, darId: proof.dar.id, kind: 'cancel',
      actor: customerEmail, reason: 'Customer canceled this route-review checkout.',
      env: { get: name => name === 'LOYALTY_LEDGER_SECRET' ? secret : undefined },
      notify: async () => {} }); // This explicit customer action returns its confirmation in the checkout UI.
    const fresh = await stripe.checkout.sessions.retrieve(session.id);
    return { ok: result.success, checkout_session_expired: fresh.status === 'expired',
      route_review_cancelled: true, reward_reservation_released: result.benefit_reservations_released };
  }
  assert(session.status !== 'complete', 'reward_checkout_already_completed');
  if (session.status === 'open') await stripe.checkout.sessions.expire(session.id);
  session = await stripe.checkout.sessions.retrieve(session.id);
  verifySession(session, metadata);
  assert(session.status === 'expired', 'reward_expiration_not_confirmed');
  const entities = base44.asServiceRole.entities;
  const orders = await entities.Order.filter({ stripe_checkout_session_id: session.id }, '-created_date', 2);
  assert(Array.isArray(orders) && orders.length <= 1, 'reward_checkout_records_not_unique');
  const order = orders[0];
  const cancelled = row => row?.status === 'cancelled' && row.is_abandoned_checkout === true && row.do_not_recover === true;
  if (order) assert(order.id && order.customer_email === email(customerEmail) && order.order_number === metadata.order_number
    && order.total === 0 && order.payment_captured === false && !order.stripe_payment_intent_id
    && !order.reward_settlement && order.payment_status === 'pending' && order.financial_status === 'pending'
    && (order.status === 'pending_payment' || cancelled(order)), 'reward_cancel_order_not_pending');
  if (metadata.credit_reservation_id) {
    const released = await settleNoPaymentCheckoutCredit({ entities, stripe, email: email(customerEmail), sessionId: session.id });
    assert(released.reservation_status === 'released', 'credit_release_unconfirmed');
  }
  if (metadata.birthday_reservation_id) {
    const birthday = await settleNoPaymentBirthdayCheckout({ entities, stripe, customerEmail, sessionId: session.id });
    assert(birthday.reservation_status === 'released', 'birthday_release_unconfirmed');
  }
  const released = metadata.reward_reservation_id.startsWith('credit:') ? { success: true, reservation_status: 'released' }
    : body(await base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
    action: 'settle_reward_checkout', customer_email: email(customerEmail),
    stripe_checkout_session_id: session.id, internal_secret: secret,
  }));
  assert(released?.success === true && released.reservation_status === 'released', 'reward_release_unconfirmed');
  if (order && !cancelled(order)) {
    assert(typeof entities.Order.updateMany === 'function', 'conditional_order_updates_unavailable');
    const timestamp = new Date().toISOString();
    const changed = await entities.Order.updateMany({ id: order.id, customer_email: order.customer_email,
      stripe_checkout_session_id: session.id, status: 'pending_payment', payment_status: 'pending',
      financial_status: 'pending', payment_captured: false,
      ...(order.updated_date ? { updated_date: order.updated_date } : {}),
    }, { $set: { status: 'cancelled', is_abandoned_checkout: true, do_not_recover: true, canceled_at: timestamp,
      status_history: [...(order.status_history || []), { status: 'cancelled', timestamp,
        request_id: `reward_expiration:${session.id}`, message: 'Reward checkout cancelled without payment. Reserved points released.' }] } });
    assert(changed?.success === true && changed.has_more === false && [0, 1].includes(changed.updated), 'reward_cancel_write_unconfirmed');
    const readback = await entities.Order.filter({ id: order.id }, undefined, 2);
    assert(readback?.length === 1 && cancelled(readback[0]) && readback[0].payment_captured === false
      && !readback[0].reward_settlement, 'reward_cancel_readback_unconfirmed');
  }
  return { ok: true, checkout_session_expired: true, reward_reservation_released: true };
}

// A lost preparation response can be recovered using the account-bound attempt
// hash already stored in the central points or credit ledger. This reads only;
// it does not create/retry a Session, release value, or expose client secrets.
export async function readNoPaymentCheckoutRecovery({ base44, stripe, customerEmail, attemptKey }) {
  const owner = email(customerEmail);
  assert(owner && /^[A-Za-z0-9_-]{20,200}$/.test(attemptKey || ''), 'reward_recovery_identity_required');
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(`${owner}:${attemptKey}`)))].map(value => value.toString(16).padStart(2, '0')).join('');
  const reservationIds = [`reward:${digest}`, `points:${digest}`];
  const entities = base44.asServiceRole.entities;
  const rows = await entities.UserPoints.filter({ customer_email: owner }, undefined, 2);
  assert(Array.isArray(rows) && rows.length <= 1 && rows.every(row => email(row.customer_email) === owner
    && (row.reward_reservations === undefined || Array.isArray(row.reward_reservations))), 'reward_recovery_balance_unconfirmed');
  const holds = (rows[0]?.reward_reservations || []).filter(hold => reservationIds.includes(hold?.reservation_id));
  let creditHold = null;
  if (!holds.length) {
    assert(typeof entities.NuViraCredit?.filter === 'function', 'credit_recovery_balance_unconfirmed');
    const credits = await entities.NuViraCredit.filter({ customer_email: owner }, undefined, 2);
    assert(Array.isArray(credits) && credits.length <= 1
      && credits.every(row => Array.isArray(row.checkout_reservations)), 'credit_recovery_balance_unconfirmed');
    const matches = (credits[0]?.checkout_reservations || []).filter(row => row.reservation_id === `credit:${digest}`);
    assert(matches.length === 1 && credits[0]?.customer_email === owner, 'reward_recovery_attempt_unconfirmed');
    creditHold = matches[0]; holds.push(creditHold);
  }
  // No record does not prove a concurrent request never reached the provider.
  assert(holds.length === 1, 'reward_recovery_attempt_unconfirmed');
  const hold = holds[0];
  const reservationId = hold.reservation_id;
  assert(sessionPattern.test(hold.checkout_session_id || '') && !hold.payment_intent_id
    && hashPattern.test(hold.context_hash || '') && ['held', 'consumed', 'released'].includes(hold.status),
  'reward_recovery_hold_unconfirmed');
  const session = await stripe.checkout.sessions.retrieve(hold.checkout_session_id);
  const metadata = session?.metadata || {};
  assert(session?.id === hold.checkout_session_id && metadata.checkout_version === NO_PAYMENT_CHECKOUT_VERSION
    && metadata.checkout_mode === 'account' && email(metadata.customer_email) === owner
    && metadata.reward_reservation_id === reservationId && metadata.checkout_context_hash === hold.context_hash
    && metadata.order_number === `NV-${digest.slice(0, 24).toUpperCase()}`
    && metadata.is_test_order !== 'true' && metadata.internal_sandbox_checkout !== 'true',
  'reward_recovery_provider_mismatch');
  verifySession(session, metadata);
  if (reservationId.startsWith('points:')) assert(verifiedNoPaymentPointsMetadata(metadata) === hold.points,
    'reward_recovery_provider_mismatch');
  if (creditHold) assert(verifiedNoPaymentCreditMetadata(metadata) === creditHold.amount_cents
    && metadata.credit_reservation_id === reservationId, 'reward_recovery_provider_mismatch');
  const routeRows = metadata.route_review_request ? await entities.DeliveryApprovalRequest.filter({ request_number: metadata.route_review_request }, undefined, 2) : [];
  assert(Array.isArray(routeRows) && routeRows.length <= 1, 'route_review_not_unique');
  const route = routeRows.length ? await readRouteReview(entities, session) : null;
  if (metadata.route_review_request && !route) assert(session.status !== 'complete', 'route_review_context_missing');
  return { ok: true, state: session.status, writes_performed: false,
    ...(route ? { routeReview: { requestNumber: route.dar.request_number, darId: route.dar.id, status: route.dar.status, total: 0 } } : {}),
    payment_confirmation_attempted: false, reward_reservation_released: false,
    reward_checkout_recovery: { kind: 'reward_no_payment', checkout_session_id: session.id,
      order_number: metadata.order_number } };
}

export async function prepareNoPaymentCheckout({ base44, stripe, data, metadata, quote, pricing, secret, authenticatedUser }) {
  const creditCovered = Boolean(data?.credit_reservation_id);
  const hasPoints = Number(pricing?.reservation_points) > 0;
  const directOnly = /^points:[a-f0-9]{64}$/.test(data?.reward_reservation_id || '');
  const sessionMetadata = { ...metadata, checkout_version: NO_PAYMENT_CHECKOUT_VERSION,
    ...(data.birthday_reservation_id ? { no_payment_birthday: noPaymentBirthdayMetadata(data) } : {}),
    ...(directOnly ? { no_payment_points: String(pricing?.points_used) } : {}) };
  // No-cash checkouts never generate advertising Purchase/Test Events. Omit
  // their inactive placeholders so birthday + points + credit stays within
  // Stripe's 50-key limit; retain every price, schedule and entitlement binding.
  assert(!sessionMetadata.sandbox_test_id && sessionMetadata.meta_capi_test_enabled !== 'true', 'reward_zero_checkout_invalid');
  delete sessionMetadata.sandbox_test_id;
  // A missing optional referral is identical to an empty one. Keep every
  // nonempty value and all private proof bindings; reserve room for route review.
  if (sessionMetadata.referral_code === '') delete sessionMetadata.referral_code;
  delete sessionMetadata.meta_capi_test_enabled;
  if (creditCovered) verifiedNoPaymentCreditSnapshot(data, sessionMetadata);
  else if (directOnly) {
    assert(!quote && pricing?.reservation_points === pricing?.points_used, 'reward_zero_checkout_invalid');
    verifiedNoPaymentPointsSnapshot(data, sessionMetadata);
  } else if (data?.points_used > 0) verifiedNoPaymentTierPointsSnapshot(data, sessionMetadata);
  // This is not a way to waive a nonzero balance, delivery charge or unreserved credit.
  assert(secret && data?.total === 0 && data.delivery_fee === 0 && pricing?.merchandise_total === 0
    && (creditCovered ? data.credits_discount === pricing.credits_discount && data.credits_discount > 0
      : data.credits_discount === 0 && pricing.credits_discount === 0)
    && data.guest_checkout === false && data.internal_sandbox_checkout === false
    && (directOnly || (creditCovered && !hasPoints && !quote) || (quote?.revision === '2026-09-08.reward-checkout-v1' && quote.active_reward?.id))
    && Number.isSafeInteger(pricing.reservation_points) && pricing.reservation_points >= (creditCovered ? 0 : 1)
    && pricing.reservation_points === (quote ? quote.points_required : 0) + pricing.points_used
    && data.reward_reservation_points === pricing.reservation_points
    && data.reward_reservation_id === metadata.reward_reservation_id
    && hashPattern.test(data.checkout_context_hash || '') && data.checkout_context_hash === metadata.checkout_context_hash
    && metadata.checkout_mode === 'account' && metadata.customer_email === data.customer_email
    && (data.bag_return_request_id == null || (typeof data.bag_return_request_id === 'string'
      && /^[A-Za-z0-9._:-]{1,120}$/.test(data.bag_return_request_id)))
    && (metadata.bag_return_request_id || null) === (data.bag_return_request_id || null)
    && metadata.order_number === data.order_number && Array.isArray(data.items) && data.items.length > 0
    && data.items.length <= 50 && data.items.every(item => typeof item.title === 'string' && item.title.trim()
      && Number.isSafeInteger(item.quantity) && item.quantity > 0 && item.quantity <= 100), 'reward_zero_checkout_invalid');
  assert(Object.keys(sessionMetadata).length <= 50, 'reward_metadata_limit');
  // Fail before creating a provider Session or holding points, not only after
  // settlement when the customer would already have spent their reward.
  await verifyRequestedBagReturn(base44.asServiceRole.entities, data);
  let session;
  let ownsPreparation = false;
  let verifiedSessionId = null;
  const preparationAttemptId = crypto.randomUUID();
  try {
    // Stripe SDK 14.21 / API 2023-10-16 calls this UI mode `embedded`.
    // No payment_method_collection: that option is subscription-only. A true
    // zero-total payment-mode Session itself skips card collection.
    session = await stripe.checkout.sessions.create({ mode: 'payment', ui_mode: 'embedded',
      redirect_on_completion: 'never', payment_method_types: ['card'],
      customer_email: data.customer_email, client_reference_id: data.order_number,
      metadata: sessionMetadata,
      line_items: data.items.map(item => ({ quantity: item.quantity, price_data: {
        currency: 'usd', unit_amount: 0, product_data: { name: item.title,
          description: 'Covered by your earned NuVira rewards and points.' },
      } })),
    }, { idempotencyKey: `nv-reward-zero-${data.reward_reservation_id}` });
    // A fresh retrieve is important on idempotent replay: create may return the
    // original open response after the customer already completed the Session.
    assert(sessionPattern.test(session?.id || ''), 'reward_session_missing');
    session = await stripe.checkout.sessions.retrieve(session.id);
    verifySession(session, sessionMetadata);
    verifiedSessionId = session.id;
    assert(session.status !== 'expired' && Number.isSafeInteger(session.expires_at), 'reward_checkout_expired');
    const entities = base44.asServiceRole.entities;
    const reserved = !hasPoints ? { success: true, ...await reserveNoPaymentCheckoutCredit({
      entities, stripe, email: data.customer_email, sessionId: session.id, preparationAttemptId,
    }) } : body(await base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
      action: 'reserve_reward_checkout', customer_email: data.customer_email,
      stripe_checkout_session_id: session.id, reward_id: quote?.active_reward?.id || null,
      points: pricing.reservation_points, direct_points: pricing.points_used, internal_secret: secret,
      preparation_attempt_id: preparationAttemptId,
    }));
    assert(reserved?.success === true && ['held', 'consumed'].includes(reserved.reservation_status), 'reward_reservation_unconfirmed');
    ownsPreparation = reserved.preparation_attempt_id === preparationAttemptId;
    let orders = await entities.Order.filter({ stripe_checkout_session_id: session.id }, '-created_date', 2);
    let contexts = await entities.CheckoutSession.filter({ stripe_session_id: session.id }, '-created_date', 2);
    assert(Array.isArray(orders) && orders.length <= 1 && Array.isArray(contexts) && contexts.length <= 1,
      'reward_checkout_records_not_unique');
    const replay = orders.length === 1 && contexts.length === 1;
    if (session.status === 'complete') assert(replay, 'reward_completed_context_missing');
    // The points CAS grants record-creation ownership to one request only.
    // Other requests may read a complete pair, but must never race to create a
    // missing row, or expire the first request's Session while it is preparing.
    if (!replay && !ownsPreparation) return { ok: false, error_code: 'REWARD_CHECKOUT_PREPARING',
      error: 'This reward checkout is still being prepared. Please check your orders before starting another checkout.',
      payment_confirmation_attempted: false, checkout_session_expired: false, reward_reservation_released: false,
      reward_checkout_recovery: { kind: 'reward_no_payment', checkout_session_id: verifiedSessionId,
        order_number: data.order_number } };
    if (!orders.length) await entities.Order.create(orderSnapshot(data, session));
    if (!contexts.length) await entities.CheckoutSession.create({ stripe_session_id: session.id,
      order_number: data.order_number, customer_email: data.customer_email, checkout_data: data,
      expires_at: new Date(session.expires_at * 1000).toISOString() });
    orders = await entities.Order.filter({ stripe_checkout_session_id: session.id }, '-created_date', 2);
    contexts = await entities.CheckoutSession.filter({ stripe_session_id: session.id }, '-created_date', 2);
    session = await stripe.checkout.sessions.retrieve(session.id);
    verifySession(session, sessionMetadata);
    assert(session.status !== 'expired', 'reward_checkout_expired');
    verifyRecords(orders, contexts, data, session);
    if (creditCovered && hasPoints) {
      const credit = await reserveNoPaymentCheckoutCredit({ entities, stripe, email: data.customer_email,
        sessionId: session.id, preparationAttemptId });
      assert(['held', 'consumed'].includes(credit.reservation_status), 'credit_reservation_unconfirmed');
    }
    if (data.birthday_reservation_id) {
      const birthday = await reserveNoPaymentBirthdayCheckout({ entities, stripe, authenticatedUser, sessionId: session.id });
      assert(['held', 'consumed'].includes(birthday.reservation_status), 'birthday_reservation_unconfirmed');
    }
    if (session.status === 'complete') return { checkoutCompleted: true, checkoutSessionId: session.id,
      checkoutKind: 'reward_no_payment', effectiveTotal: 0, orderNumber: data.order_number, idempotent_replay: true };
    assert(typeof session.client_secret === 'string' && session.client_secret.startsWith(`${session.id}_secret_`),
      'reward_session_secret_missing');
    return { clientSecret: session.client_secret, checkoutSessionId: session.id, checkoutKind: 'reward_no_payment',
      effectiveTotal: 0, orderNumber: data.order_number, idempotent_replay: replay };
  } catch {
    let canceled = false;
    // A lost reserve acknowledgment does not prove claim ownership. Preserve
    // that Session/hold for explicit cancellation or natural expiration.
    if (ownsPreparation && session?.id && session.status !== 'complete') {
      try { const result = await cancelNoPaymentCheckout({ base44, stripe, sessionId: session.id,
        customerEmail: data.customer_email, secret }); canceled = result.ok === true; } catch { /* Withhold secret on uncertainty. */ }
    }
    // Never echo a Stripe error or Session/client secret to the customer/log.
    return { ok: false, error_code: 'REWARD_CHECKOUT_NOT_READY',
      error: 'We could not confirm this reward checkout. Please check your orders before trying again or contact NuVira.',
      payment_confirmation_attempted: false, checkout_session_expired: canceled, reward_reservation_released: canceled,
      // This opaque owned Session ID is not a payment secret. Cancellation must
      // independently reverify ownership and completion; this hint alone can
      // never release points or authorize another attempt.
      ...(verifiedSessionId ? { reward_checkout_recovery: { kind: 'reward_no_payment',
        checkout_session_id: verifiedSessionId, order_number: data.order_number } } : {}) };
  }
}
