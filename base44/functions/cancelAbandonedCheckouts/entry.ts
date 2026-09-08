/**
 * cancelAbandonedCheckouts
 * 
 * Finds pending_payment orders older than 30 minutes. Provider-confirmed
 * cancellation/expiration and reward-hold release must precede local cancellation.
 * Uncertain provider outcomes are skipped for a later retry, never abandoned.
 * 
 * Safe to run as a scheduled job (every 10 minutes) or manually.
 * Admin-only when called manually.
 * 
 * Sets:
 *   status = 'cancelled'
 *   payment_status = 'pending' (unchanged — never paid)
 *   is_abandoned_checkout = true
 *   do_not_recover = true
 * 
 * These records then disappear from:
 *   - Customer App Order Management active views
 *   - Customer App Driver Portal
 *   - Route optimization
 *   - Hub sync queue
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import Stripe from 'npm:stripe@14.21.0';
import { settleCheckoutCredit } from '../../shared/checkoutCredit.js';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const EXACT_CANCEL_CONFIRMATION = 'cancel_unpaid_checkout';
const CANCELLATION_REVISION = '2026-09-08.confirmed-credit-cancellation-v3';

function safeId(value, maxLength = 180) {
  const normalized = String(value ?? '').trim();
  return normalized.length <= maxLength && /^[A-Za-z0-9._:@/#-]+$/.test(normalized) ? normalized : '';
}

async function cancelPendingPaymentIntent(order, internalSecret = '') {
  const paymentIntentId = safeId(order?.stripe_payment_intent_id);
  const checkoutSessionId = safeId(order?.stripe_checkout_session_id);
  if ((!paymentIntentId && !checkoutSessionId) || (paymentIntentId && checkoutSessionId)) {
    return { blocked: true, provider_cancelled: false, provider_status: 'ambiguous_or_missing_provider_identity' };
  }
  const noPayment = Boolean(checkoutSessionId);
  const id = noPayment ? checkoutSessionId : paymentIntentId;
  if (!(noPayment ? /^cs_[a-zA-Z0-9_]+$/ : /^pi_[a-zA-Z0-9_]+$/).test(id)) {
    return { blocked: true, provider_cancelled: false, provider_status: 'invalid_provider_identity' };
  }
  const payment = noPayment ? await stripe.checkout.sessions.retrieve(id) : await stripe.paymentIntents.retrieve(id);
  const meta = payment.metadata || {};
  if (payment.id !== id || payment.livemode !== true || payment.currency !== 'usd'
    || meta.order_number !== order.order_number
    || String(meta.customer_email || '').trim().toLowerCase() !== String(order.customer_email || '').trim().toLowerCase()
    || !meta.customer_email || meta.is_test_order === 'true' || meta.internal_sandbox_checkout === 'true') {
    return { blocked: true, provider_cancelled: false, provider_status: 'provider_identity_mismatch' };
  }
  if (meta.reward_reservation_id && !internalSecret) {
    return { blocked: true, provider_cancelled: false, provider_status: 'reward_release_unavailable' };
  }
  if (noPayment && (!('mode' in payment) || payment.mode !== 'payment' || payment.amount_total !== 0 || payment.payment_intent !== null
    || meta.checkout_version !== '4.0_reward_no_payment'
    || !['unpaid', 'no_payment_required'].includes(payment.payment_status))) {
    return { blocked: true, provider_cancelled: false, provider_status: 'session_payment_not_cancelable' };
  }
  const terminalStatus = noPayment ? 'expired' : 'canceled';
  const reservable = noPayment ? ['open'] : ['requires_payment_method', 'requires_confirmation', 'requires_action'];
  if (payment.status !== terminalStatus && !reservable.includes(payment.status)) {
    return { blocked: true, provider_cancelled: false, provider_status: payment.status };
  }
  const cancelled = payment.status === terminalStatus ? payment : noPayment
    ? await stripe.checkout.sessions.expire(id)
    : await stripe.paymentIntents.cancel(id, { cancellation_reason: 'abandoned' });
  if (cancelled.id !== id || cancelled.status !== terminalStatus) {
    return { blocked: true, provider_cancelled: false, provider_status: 'provider_cancellation_unconfirmed' };
  }
  return { provider_cancelled: payment.status !== terminalStatus, provider_status: terminalStatus,
    idempotent: payment.status === terminalStatus, reward_reservation_id: meta.reward_reservation_id || null,
    credit_reservation_id: meta.credit_reservation_id || null,
    provider_id: id, checkout_session: noPayment };
}

async function markOrderAbandoned(base44, order, message) {
  if (typeof base44.asServiceRole.entities.Order.updateMany !== 'function') throw new Error('conditional_order_updates_unavailable');
  const timestamp = new Date().toISOString();
  const result = await base44.asServiceRole.entities.Order.updateMany({
    id: order.id, order_number: order.order_number, customer_email: order.customer_email,
    ...(order.updated_date ? { updated_date: order.updated_date } : {}),
    status: 'pending_payment', payment_captured: { $ne: true },
    payment_status: { $nin: ['paid', 'refunded'] }, financial_status: { $nin: ['paid', 'refunded'] },
  }, { $set: {
    status: 'cancelled',
    is_abandoned_checkout: true,
    do_not_recover: true,
    canceled_at: timestamp,
    status_history: [
      ...(order.status_history || []),
      { status: 'cancelled', timestamp, message },
    ],
  } });
  if (result?.success !== true || result.has_more !== false || ![0, 1].includes(result.updated)) {
    throw new Error('conditional_order_cancellation_unconfirmed');
  }
  return result.updated === 1;
}

async function releaseCanceledReward(base44, order, provider, internalSecret) {
  if (provider.credit_reservation_id) {
    if (provider.checkout_session) throw new Error('credit_checkout_session_unsupported');
    const latest = await stripe.paymentIntents.retrieve(provider.provider_id);
    if (latest.id !== provider.provider_id || latest.status !== 'canceled') throw new Error('credit_cancellation_unconfirmed');
    const released = await settleCheckoutCredit({ entities: base44.asServiceRole.entities,
      payment: latest, email: order.customer_email });
    if (released.reservation_status !== 'released') throw new Error('credit_release_unconfirmed');
  }
  if (!provider.reward_reservation_id) return;
  // The ledger independently retrieves Stripe again. A cancellation response
  // supplied by this job alone cannot release points.
  const response = await base44.asServiceRole.functions.invoke('enrollNewCustomerInLoyalty', {
    action: 'settle_reward_checkout', customer_email: order.customer_email,
    ...(provider.checkout_session ? { stripe_checkout_session_id: provider.provider_id }
      : { stripe_payment_intent_id: provider.provider_id }), internal_secret: internalSecret,
  });
  const result = response?.data || response;
  if (result?.success !== true || result.reservation_status !== 'released') throw new Error('reward_release_unconfirmed');
}

function unpaid(order) {
  return order?.status === 'pending_payment' && order.payment_captured !== true
    && !['paid', 'refunded'].includes(order.payment_status) && !['paid', 'refunded'].includes(order.financial_status)
    && order.do_not_recover !== true && !order.is_abandoned_checkout;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin' && user.role !== 'owner') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const internalSecret = Deno.env.get('LOYALTY_LEDGER_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || Deno.env.get('HUB_SYNC_SECRET') || '';
    if (typeof base44.asServiceRole.entities.Order.updateMany !== 'function') {
      return Response.json({ error: 'conditional_order_updates_unavailable', writes_performed: false }, { status: 503 });
    }
    if (body?.action === 'cancel_exact_pending_checkout') {
      const orderNumber = safeId(body.order_number, 80).replace(/^#/, '');
      const expectedOrderId = safeId(body.expected_order_id);
      if (!orderNumber || !expectedOrderId || body.confirmation !== EXACT_CANCEL_CONFIRMATION) {
        return Response.json({ error: 'Exact order identity and confirmation are required' }, { status: 400 });
      }
      const rows = await base44.asServiceRole.entities.Order.filter({ order_number: orderNumber }, '-created_date', 2);
      if (rows.length !== 1 || rows[0]?.id !== expectedOrderId) {
        return Response.json({ error: 'exact_order_identity_mismatch' }, { status: 409 });
      }
      const order = rows[0];
      if (!unpaid(order)) {
        return Response.json({ error: 'order_is_not_an_unpaid_pending_checkout' }, { status: 409 });
      }
      const provider = await cancelPendingPaymentIntent(order, internalSecret);
      if (provider.blocked) {
        return Response.json({ error: 'payment_intent_cannot_be_cancelled', provider_status: provider.provider_status }, { status: 409 });
      }
      await releaseCanceledReward(base44, order, provider, internalSecret);
      const marked = await markOrderAbandoned(base44, order, 'Unpaid checkout cancelled after confirmed provider cancellation.');
      return Response.json({
        success: true,
        action: 'cancel_exact_pending_checkout',
        order_number: orderNumber,
        provider_cancelled: provider.provider_cancelled,
        provider_status: provider.provider_status,
        order_cancelled: marked, revision: CANCELLATION_REVISION,
        writes_performed: provider.provider_cancelled || marked || Boolean(provider.reward_reservation_id || provider.credit_reservation_id),
      });
    }

    const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago

    // Fetch only pending_payment orders (targeted filter — not full dataset scan)
    const pendingOrders = await base44.asServiceRole.entities.Order.filter(
      { status: 'pending_payment' },
      'created_date',
      50
    );

    const abandoned = pendingOrders.filter(o =>
      o.created_date < cutoff &&
      unpaid(o)
    );

    console.log(`[cancelAbandonedCheckouts] Found ${abandoned.length} abandoned checkout records older than 30 min`);

    const results = [];

    for (const order of abandoned) {
      try {
        const provider = await cancelPendingPaymentIntent(order, internalSecret);
        if (provider.blocked) {
          results.push({ order_number: order.order_number, action: 'skipped_provider_not_cancelable', provider_status: provider.provider_status });
          continue;
        }
        await releaseCanceledReward(base44, order, provider, internalSecret);
        const marked = await markOrderAbandoned(base44, order, 'Abandoned checkout — provider confirmed cancellation after 30 minutes.');
        results.push({ order_number: order.order_number, action: marked ? 'cancelled' : 'skipped_order_changed' });
      } catch {
        // A provider or storage timeout can happen after a successful write.
        // Leave the order retryable; the next run retrieves the same provider
        // resource and replays the same release receipt before trying again.
        results.push({ order_number: order.order_number, action: 'skipped_unconfirmed_cancellation' });
      }
    }

    return Response.json({
      success: true,
      revision: CANCELLATION_REVISION,
      processed: abandoned.length,
      cancelled: results.filter(r => r.action === 'cancelled').length,
      skipped: results.filter(r => r.action?.startsWith('skipped')).length,
      results,
    });

  } catch (error) {
    console.error('[cancelAbandonedCheckouts] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
