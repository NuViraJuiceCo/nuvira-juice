import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';
import { decideRouteReview } from '../../shared/routeReviewDecision.js';
import { ROUTE_REVIEW_REVISION, routeReviewExpiryAction } from '../../shared/routeReview.js';
import { notifyRouteReview } from '../../shared/routeReviewNotifications.js';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * autoExpireZone3Authorizations
 * Scheduled job: cancels Zone 3 authorization holds pending for > 48 hours.
 * Run hourly via automation.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user.role !== 'admin' && user.role !== 'owner') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (Deno.env.get('ENABLE_ZONE3_AUTO_EXPIRE_AUTHORIZATIONS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        expired_count: 0,
        gate: 'ENABLE_ZONE3_AUTO_EXPIRE_AUTHORIZATIONS',
        reason: 'zone3_auto_expire_disabled',
        message: 'Zone 3 auto-expire authorization cleanup is disabled by the current operational safety gate.',
      });
    }

    const cutoffTime = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    console.log(`[Zone3 Expire] Checking for pending_review requests older than ${cutoffTime}`);

    // Complete, bounded pagination before any decision. Include interrupted
    // preparation and closed requests still awaiting their customer update.
    const pendingRequests = [];
    const seen = new Set();
    for (let offset = 0; ; offset += 100) {
      if (offset >= 10000) throw new Error('route_review_expiry_pagination_limit');
      const page = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({}, '-created_date', 100, offset);
      if (!Array.isArray(page)) throw new Error('route_review_expiry_read_unconfirmed');
      for (const row of page) {
        if (!row.id || seen.has(row.id)) throw new Error('route_review_expiry_pagination_repeated');
        seen.add(row.id); pendingRequests.push(row);
      }
      if (page.length < 100) break;
    }
    const now = Date.now();
    const expired = pendingRequests.filter(dar => routeReviewExpiryAction(dar, now));
    console.log(`[Zone3 Expire] Found ${pendingRequests.length} pending, ${expired.length} older than 48h`);

    const results = [];

    for (const dar of expired) {
      if (dar.checkout_revision === ROUTE_REVIEW_REVISION) {
        try {
          const result = await decideRouteReview({ base44, stripe, darId: dar.id, kind: routeReviewExpiryAction(dar, now),
            actor: user.email, reason: 'Route review or its authorization expired without approval.', env: Deno.env,
            notify: (proof, stage) => notifyRouteReview({ base44, proof, stage, env: Deno.env }) });
          results.push(result);
        } catch {
          results.push({ dar_id: dar.id, success: false, reason: 'route_review_expiry_unconfirmed' });
        }
        continue;
      }
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

      if (!dar.stripe_payment_intent_id || !['canceled', 'already_canceled'].includes(stripeAction)
        || (await stripe.paymentIntents.retrieve(dar.stripe_payment_intent_id)).status !== 'canceled') {
        results.push({ dar_id: dar.id, success: false, reason: 'route_review_cancellation_unconfirmed' });
        continue;
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
          message: `Your delivery route request has expired without approval. No payment was captured. We canceled the card authorization; your bank controls when the pending hold disappears. You can place a new request or contact us for help.`,
          deep_link: '/account',
          idempotency_key: `zone3_expired_${dar.id}`,
        }).catch(() => {});
      }

      results.push({ dar_id: dar.id, request_number: dar.request_number, stripe_action: stripeAction });
      console.log(`[Zone3 Expire] Expired DAR ${dar.request_number} (${dar.id}), stripe: ${stripeAction}`);
    }

    return Response.json({ expired_count: results.filter(result => result.success !== false).length,
      pending_review_count: results.filter(result => result.success === false).length, results });

  } catch (error) {
    console.error('[Zone3 Expire] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
