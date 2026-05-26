import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * autoExpireZone3Authorizations
 * Scheduled job: cancels Zone 3 authorization holds pending for > 48 hours.
 * Run hourly via automation.
 */
Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_ZONE3_AUTO_EXPIRE_AUTHORIZATIONS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        expired_count: 0,
        reason: 'zone3_auto_expire_disabled',
        message: 'Zone 3 auto-expire authorization cleanup is disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);

    // Allow both admin-triggered and scheduled (no user) calls
    const user = await base44.auth.me().catch(() => null);
    if (user && user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    console.log(`[Zone3 Expire] Checking for pending_review requests older than ${cutoffTime}`);

    // Get all pending_review requests
    const pendingRequests = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ status: 'pending_review' });

    const expired = pendingRequests.filter(dar => dar.created_date && dar.created_date < cutoffTime);
    console.log(`[Zone3 Expire] Found ${pendingRequests.length} pending, ${expired.length} older than 48h`);

    const results = [];

    for (const dar of expired) {
      let stripeAction = 'no_pi';
      if (dar.stripe_payment_intent_id) {
        try {
          const pi = await stripe.paymentIntents.retrieve(dar.stripe_payment_intent_id);
          if (['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'].includes(pi.status)) {
            await stripe.paymentIntents.cancel(dar.stripe_payment_intent_id);
            stripeAction = 'canceled';
          } else if (pi.status === 'canceled') {
            stripeAction = 'already_canceled';
          } else {
            stripeAction = `not_cancelable_${pi.status}`;
          }
        } catch (err) {
          stripeAction = `error: ${err.message}`;
          console.error(`[Zone3 Expire] PI cancel error for ${dar.stripe_payment_intent_id}: ${err.message}`);
        }
      }

      await base44.asServiceRole.entities.DeliveryApprovalRequest.update(dar.id, {
        status: 'expired',
        stripe_authorization_status: stripeAction.includes('cancel') ? 'canceled' : dar.stripe_authorization_status,
        audit_trail: [...(dar.audit_trail || []), {
          action: 'auto_expired',
          performed_by: 'system',
          timestamp: new Date().toISOString(),
          note: `Auto-expired after 48h. Stripe action: ${stripeAction}. Cutoff: ${cutoffTime}`,
        }],
      });

      // Notify customer
      if (dar.customer_email) {
        base44.asServiceRole.functions.invoke('sendCustomerNotification', {
          customer_email: dar.customer_email,
          type: 'general',
          title: 'Route Review Expired',
          message: `Your Zone 3 delivery request for ${dar.delivery_address || 'your address'} has expired after 48 hours without a decision. The authorization hold on your card has been fully released — no charge was made. You're welcome to place a new request or contact us for more information.`,
          deep_link: '/account',
          idempotency_key: `zone3_expired_${dar.id}`,
        }).catch(() => {});
      }

      results.push({ dar_id: dar.id, request_number: dar.request_number, stripe_action: stripeAction });
      console.log(`[Zone3 Expire] Expired DAR ${dar.request_number} (${dar.id}), stripe: ${stripeAction}`);
    }

    return Response.json({ expired_count: results.length, results });

  } catch (error) {
    console.error('[Zone3 Expire] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
