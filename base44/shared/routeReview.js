// Private agreement for route review. All prices/schedules originate in the
// ordinary authoritative checkout. The review is not a second pricing engine.
export const ROUTE_REVIEW_REVISION = '2026-09-09.route-review-v2';
export function routeReviewExpiryAction(dar, now = Date.now()) {
  if (dar.checkout_revision === ROUTE_REVIEW_REVISION && dar.communications_pending
    && dar.review_decision?.complete && ['deny', 'expire', 'cancel'].includes(dar.review_decision.kind)) {
    return dar.review_decision.kind;
  }
  if (!['pending_authorization', 'pending_review'].includes(dar.status) || dar.review_decision?.kind === 'approve') return null;
  const expired = Date.parse(dar.created_date) <= now - 48 * 60 * 60 * 1000
    || Date.parse(dar.authorization_expires_at) <= now;
  return expired ? (dar.review_decision?.kind || 'expire') : null;
}
const check = (value, code = 'route_review_proof_unconfirmed') => { if (!value) throw new Error(code); };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cents = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
  && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value * 100 - Math.round(value * 100)) < 0.00001
  ? Math.round(value * 100) : NaN;
const single = rows => { check(Array.isArray(rows) && rows.length === 1 && rows[0]?.id); return rows[0]; };
const reference = value => /^DAR-[A-F0-9]{24}$/.test(value || '');
const pending = order => order.status === 'pending_payment' && order.payment_status === 'pending'
  && order.financial_status === 'pending' && order.payment_captured === false && !order.reward_settlement;
const oneTime = (row, allowRefunded = false) => !row.is_test_order && !row.internal_sandbox_checkout && !row.stripe_subscription_id
  && (allowRefunded || (!(Number(row.amount_refunded || 0) > 0) && !['refunded', 'partially_refunded'].includes(row.payment_status)));

async function pricedProof(entities, provider, allowRefunded = false) {
  const noPayment = /^cs_[A-Za-z0-9_]+$/.test(provider?.id || '');
  const meta = provider?.metadata || {};
  check(provider?.livemode === true && provider.currency === 'usd' && reference(meta.route_review_request)
    && meta.checkout_mode === 'account' && meta.internal_sandbox_checkout !== 'true' && meta.is_test_order !== 'true'
    && meta.checkout_version === (noPayment ? '4.0_reward_no_payment' : '3.0_embedded')
    && /^[a-f0-9]{64}$/.test(meta.checkout_context_hash || ''));
  if (noPayment) check(provider.mode === 'payment' && provider.amount_total === 0 && provider.payment_intent === null
    && ['open', 'complete', 'expired'].includes(provider.status)
    && (provider.status !== 'complete' || provider.payment_status === 'no_payment_required'));
  else check(/^pi_[A-Za-z0-9_]+$/.test(provider.id) && provider.capture_method === 'manual'
    && Number.isSafeInteger(provider.amount) && provider.amount >= 50);
  const context = single(await entities.CheckoutSession.filter({ stripe_session_id: provider.id }, undefined, 2));
  const order = single(await entities.Order.filter({ [noPayment ? 'stripe_checkout_session_id' : 'stripe_payment_intent_id']: provider.id }, undefined, 2));
  const data = context.checkout_data;
  check(data?.route_review?.revision === ROUTE_REVIEW_REVISION
    && data.route_review.request_number === meta.route_review_request
    && data.route_review.customer_acknowledged_hold === true
    && [order, context, data].every(row => row.customer_email === meta.customer_email && row.order_number === meta.order_number)
    && data.checkout_context_hash === meta.checkout_context_hash && data.guest_checkout === false
    && oneTime(order, allowRefunded) && oneTime(data) && same(order.items, data.items)
    && cents(order.total) === (noPayment ? 0 : provider.amount) && cents(data.total) === cents(order.total)
    && ['zone_3a_route_review_25_30', 'zone_3b_route_review_30_35'].includes(order.delivery_zone_id)
    && data.route_review.zone_key === order.delivery_zone_id
    && meta.delivery_zone_key === order.delivery_zone_id
    && ['assigned_delivery_date', 'assigned_production_day', 'delivery_window_label', 'assigned_delivery_window_start',
      'assigned_delivery_window_end', 'address_line1', 'address_line2', 'address_city', 'address_state', 'address_postal_code',
      'contact_phone', 'subtotal', 'delivery_fee', 'total_discounts'].every(key => same(order[key], data[key])));
  const qualification = cents(data.route_review.qualification_subtotal);
  check(qualification >= (data.route_review.zone_key === 'zone_3a_route_review_25_30' ? 5999 : 7200));
  return { provider, noPayment, meta, order, context, data };
}

export async function readRouteReview(entities, provider) {
  return readRouteProof(entities, provider);
}

async function readRouteProof(entities, provider, allowRefunded = false) {
  const proof = await pricedProof(entities, provider, allowRefunded);
  const dar = single(await entities.DeliveryApprovalRequest.filter({ request_number: proof.meta.route_review_request }, undefined, 2));
  check(dar.checkout_revision === ROUTE_REVIEW_REVISION && dar.customer_email === proof.order.customer_email
    && dar.order_id === proof.order.id && dar.checkout_context_hash === proof.meta.checkout_context_hash
    && dar.request_type === 'one_time_order' && dar.zone_key === proof.data.route_review.zone_key
    && dar.checkout_provider_id === provider.id && dar.customer_acknowledged_hold === true
    && same(dar.cart_items, proof.data.items) && cents(dar.estimated_total) === cents(proof.data.total)
    && cents(dar.estimated_delivery_fee) === cents(proof.data.delivery_fee)
    && cents(dar.catalog_qualification_subtotal) === cents(proof.data.route_review.qualification_subtotal));
  return { ...proof, dar };
}

export async function prepareRouteReview({ entities, stripe, providerId }) {
  const noPayment = /^cs_/.test(providerId || '');
  const provider = noPayment ? await stripe.checkout.sessions.retrieve(providerId) : await stripe.paymentIntents.retrieve(providerId);
  const proof = await pricedProof(entities, provider);
  check(provider.id === providerId && pending(proof.order));
  const { data, meta, order } = proof;
  const existing = await entities.DeliveryApprovalRequest.filter({ request_number: meta.route_review_request }, undefined, 2);
  check(Array.isArray(existing) && existing.length <= 1);
  if (!existing.length) {
    check(noPayment ? provider.status === 'open' : ['requires_payment_method', 'requires_confirmation', 'requires_action'].includes(provider.status));
    await entities.DeliveryApprovalRequest.create({ request_number: meta.route_review_request,
      request_type: 'one_time_order', checkout_revision: ROUTE_REVIEW_REVISION,
      checkout_provider_id: providerId, checkout_context_hash: data.checkout_context_hash, order_id: order.id,
      ...(noPayment ? { stripe_checkout_session_id: providerId } : { stripe_payment_intent_id: providerId }),
      customer_email: data.customer_email, customer_name: data.customer_name, customer_phone: data.contact_phone,
      delivery_address: data.delivery_address, address_line1: data.address_line1, address_line2: data.address_line2,
      address_city: data.address_city, address_state: data.address_state, address_postal_code: data.address_postal_code, address_country: 'US',
      cart_items: data.items, cart_subtotal: data.subtotal, catalog_qualification_subtotal: data.route_review.qualification_subtotal,
      discount_eligible_subtotal: data.subtotal - data.total_discounts,
      estimated_delivery_fee: data.delivery_fee, estimated_total: data.total,
      zone_key: data.route_review.zone_key, zone_type: 'route_review', zone_name: 'Route Review Required',
      estimated_distance_miles: data.route_review.distance_miles,
      customer_acknowledged_hold: true, status: 'pending_authorization',
      requested_delivery_date: data.assigned_delivery_date, requested_production_date: data.assigned_production_day,
      requested_delivery_window: data.delivery_window_label,
      review_revision: 0, audit_trail: [{ action: 'checkout_prepared', performed_by: data.customer_email,
        timestamp: new Date().toISOString(), note: 'Authoritative checkout saved; awaiting customer confirmation. No payment captured.' }] });
  }
  const confirmed = await readRouteReview(entities, provider);
  check(['pending_authorization', 'pending_review'].includes(confirmed.dar.status) && !confirmed.dar.review_decision);
  return { darId: confirmed.dar.id, requestNumber: confirmed.dar.request_number,
    routeReview: true, paymentIntentId: noPayment ? null : providerId };
}

export async function updateRouteReview(entities, dar, patch) {
  check(typeof entities.DeliveryApprovalRequest?.updateMany === 'function', 'route_review_conditional_updates_required');
  check(Number.isSafeInteger(dar.review_revision) && dar.review_revision >= 0);
  const result = await entities.DeliveryApprovalRequest.updateMany({ id: dar.id, customer_email: dar.customer_email,
    checkout_provider_id: dar.checkout_provider_id, checkout_context_hash: dar.checkout_context_hash,
    review_revision: dar.review_revision, status: dar.status }, { $set: { ...patch, review_revision: dar.review_revision + 1 } });
  check(result?.success === true && result.has_more === false && [0, 1].includes(result.updated), 'route_review_write_unconfirmed');
  const fresh = single(await entities.DeliveryApprovalRequest.filter({ id: dar.id }, undefined, 2));
  check(fresh.checkout_context_hash === dar.checkout_context_hash && fresh.checkout_provider_id === dar.checkout_provider_id);
  return { updated: result.updated === 1, dar: fresh };
}

// Called only from the signature-verified webhook. Fresh retrieval proves the
// provider's current state; the recorded event ID remains the genuine event ID.
export async function recordRouteAuthorization({ entities, stripe, event }) {
  const supplied = event?.data?.object;
  const noPayment = /^cs_/.test(supplied?.id || '');
  check(event?.livemode === true && /^evt_[A-Za-z0-9_]+$/.test(event.id || '')
    && Number.isSafeInteger(event.created) && event.created > 0
    && event.type === (noPayment ? 'checkout.session.completed' : 'payment_intent.amount_capturable_updated'));
  const provider = noPayment ? await stripe.checkout.sessions.retrieve(supplied.id)
    : await stripe.paymentIntents.retrieve(supplied.id, { expand: ['latest_charge'] });
  check(provider.id === supplied.id && ['checkout_version', 'route_review_request', 'customer_email',
    'order_number', 'checkout_context_hash'].every(key => provider.metadata?.[key] === supplied.metadata?.[key]));
  // A late confirmation is read-only for an already approved/refunded order.
  // Keep the normal mutation/settlement proof strictly non-refunded.
  let proof = await readRouteProof(entities, provider, true);
  if (Number(proof.order.amount_refunded || 0) > 0 || ['refunded', 'partially_refunded'].includes(proof.order.payment_status)) {
    check(proof.dar.status === 'captured' && proof.dar.review_decision?.kind === 'approve'
      && proof.dar.review_decision.complete === true
      && (noPayment ? provider.status === 'complete' : provider.status === 'succeeded'),
    'route_review_terminal_confirmation_unconfirmed');
    return proof;
  }
  if (proof.dar.review_decision || proof.dar.status !== 'pending_authorization') return proof;
  check(pending(proof.order));
  let expiresAt = null;
  if (noPayment) check(provider.status === 'complete' && provider.payment_status === 'no_payment_required');
  else {
    const captureBefore = provider.latest_charge?.payment_method_details?.card?.capture_before;
    check(provider.status === 'requires_capture' && provider.amount_capturable === provider.amount
      && Number.isSafeInteger(captureBefore) && captureBefore > event.created, 'route_review_authorization_unconfirmed');
    expiresAt = new Date(captureBefore * 1000).toISOString();
  }
  const patch = { status: 'pending_review', stripe_authorization_status: noPayment ? 'no_payment_required' : 'requires_capture',
    amount_authorized: proof.data.total, amount_capturable: proof.data.total,
    authorization_expires_at: expiresAt, provider_confirmation: { event_id: event.id, created: event.created,
      event_type: event.type, provider_id: provider.id },
    audit_trail: [...(proof.dar.audit_trail || []), { action: 'customer_confirmed', performed_by: 'stripe_webhook',
      timestamp: new Date(event.created * 1000).toISOString(), note: 'Confirmation verified. Awaiting route approval; no payment captured.' }] };
  await updateRouteReview(entities, proof.dar, patch);
  proof = await readRouteReview(entities, provider);
  check(proof.dar.status === 'pending_review' && proof.dar.provider_confirmation?.provider_id === provider.id);
  return proof;
}

// A completed zero-cash Session records the customer's confirmation, not route
// approval. An explicit protected decision, not a forged Stripe status, decides
// whether held benefits can be consumed or released.
export async function noPaymentRouteOutcome(entities, session) {
  if (!session?.metadata?.route_review_request) return session?.status === 'complete' ? 'consumed' : session?.status === 'expired' ? 'released' : 'held';
  if (session.status === 'expired') return 'released';
  if (session.status !== 'complete') return 'held';
  const { dar, order } = await readRouteReview(entities, session);
  const decision = dar.review_decision;
  if (!decision) return 'held';
  check(['approve', 'deny', 'expire', 'cancel'].includes(decision.kind) && decision.actor && decision.reason
    && Number.isFinite(Date.parse(decision.created_at)));
  if (decision.kind === 'approve') {
    check(['pending_review', 'captured'].includes(dar.status) && dar.provider_confirmation?.provider_id === session.id);
    return 'consumed';
  }
  check(pending(order) || (order.status === 'cancelled' && order.payment_captured === false && !order.reward_settlement));
  check(['pending_review', 'pending_authorization', 'denied', 'expired'].includes(dar.status));
  return 'released';
}

export async function assertRouteCaptureApproved(entities, provider) {
  if (!provider?.metadata?.route_review_request) return;
  const { dar } = await readRouteReview(entities, provider);
  check(dar.review_decision?.kind === 'approve' && dar.review_decision.actor && dar.review_decision.reason
    && ['pending_review', 'captured'].includes(dar.status)
    && dar.provider_confirmation?.provider_id === provider.id, 'route_review_approval_required');
}

export async function claimRouteDecision(entities, provider, { kind, actor, reason, now = Date.now() }) {
  check(['approve', 'deny', 'expire', 'cancel'].includes(kind) && actor && typeof reason === 'string'
    && reason.trim().length > 0 && reason.length <= 1000, 'route_review_decision_required');
  let proof = await readRouteReview(entities, provider);
  if (!proof.dar.review_decision) {
    check(pending(proof.order) && (kind === 'approve' ? proof.dar.status === 'pending_review'
      : ['pending_review', 'pending_authorization'].includes(proof.dar.status)), 'route_review_not_pending');
    if (kind === 'approve') check(proof.dar.provider_confirmation?.provider_id === provider.id);
    await updateRouteReview(entities, proof.dar, { review_decision: {
      kind, actor, reason: reason.trim(), created_at: new Date(now).toISOString(), complete: false } });
    proof = await readRouteReview(entities, provider);
  }
  check(proof.dar.review_decision?.kind === kind, 'route_review_competing_decision');
  return proof;
}

export async function finishRouteDecision(entities, provider, status, now = Date.now()) {
  let proof = await readRouteReview(entities, provider);
  const decision = proof.dar.review_decision;
  check(decision && (decision.kind === 'approve' ? status === 'captured' : ['denied', 'expired'].includes(status)));
  if (!decision.complete) {
    await updateRouteReview(entities, proof.dar, { status,
      communications_pending: decision.kind === 'deny' || decision.kind === 'expire',
      review_decision: { ...decision, complete: true },
      admin_decision: decision.kind === 'approve' ? 'approved' : 'denied',
      admin_decision_reason: decision.reason,
      ...(decision.kind === 'approve' ? { approved_by: decision.actor, approved_at: decision.created_at,
        approved_delivery_fee: proof.data.delivery_fee, approved_total: proof.data.total, amount_captured: proof.data.total }
        : { denied_by: decision.actor, denied_at: decision.created_at, amount_captured: 0 }),
      stripe_authorization_status: proof.noPayment ? 'no_payment_required' : provider.status,
      audit_trail: [...(proof.dar.audit_trail || []), { action: `route_${decision.kind}_confirmed`,
        performed_by: decision.actor, timestamp: new Date(now).toISOString(), note: decision.reason }] });
    proof = await readRouteReview(entities, provider);
  }
  check(proof.dar.status === status && proof.dar.review_decision.complete === true);
  return proof;
}

export async function cancelRouteOrder(entities, proof) {
  const { order, provider, noPayment } = proof;
  if (pending(order)) {
    const result = await entities.Order.updateMany({ id: order.id,
      [noPayment ? 'stripe_checkout_session_id' : 'stripe_payment_intent_id']: provider.id,
      status: 'pending_payment', payment_status: 'pending', financial_status: 'pending', payment_captured: false },
    { $set: { status: 'cancelled', payment_status: 'cancelled', financial_status: 'cancelled',
      do_not_recover: true, abandoned_checkout: true } });
    check(result?.success === true && result.has_more === false && [0, 1].includes(result.updated));
  }
  const fresh = single(await entities.Order.filter({ id: order.id }, undefined, 2));
  check(fresh.status === 'cancelled' && fresh.payment_status === 'cancelled' && fresh.financial_status === 'cancelled'
    && fresh.payment_captured === false && !fresh.reward_settlement && fresh.do_not_recover === true);
}
