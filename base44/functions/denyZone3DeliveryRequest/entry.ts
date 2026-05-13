import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * denyZone3DeliveryRequest (Admin-only)
 * Cancels the uncaptured Stripe authorization, adds customer to waitlist, notifies customer.
 * Does NOT create an Order. Does NOT sync Hub.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const { dar_id, admin_decision_reason } = await req.json();

    if (!dar_id) return Response.json({ error: 'dar_id is required' }, { status: 400 });
    if (!admin_decision_reason?.trim()) return Response.json({ error: 'admin_decision_reason is required' }, { status: 400 });

    // Load DeliveryApprovalRequest
    const dars = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ id: dar_id });
    const dar = dars[0];
    if (!dar) return Response.json({ error: 'DeliveryApprovalRequest not found' }, { status: 404 });

    // Validate status
    if (!['pending_review', 'pending_authorization'].includes(dar.status)) {
      return Response.json({ error: `Request is in status ${dar.status}. Cannot deny.`, status: dar.status }, { status: 400 });
    }

    // Idempotency key for cancellation
    const cancelIdempotencyKey = `deny_zone3_${dar_id}_${dar.stripe_payment_intent_id || 'no_pi'}`;

    // Cancel Stripe PaymentIntent if it exists and is uncaptured
    let stripeAction = 'no_pi_to_cancel';
    if (dar.stripe_payment_intent_id) {
      try {
        const pi = await stripe.paymentIntents.retrieve(dar.stripe_payment_intent_id);
        if (['requires_payment_method', 'requires_confirmation', 'requires_action', 'requires_capture'].includes(pi.status)) {
          await stripe.paymentIntents.cancel(dar.stripe_payment_intent_id, {}, { idempotencyKey: cancelIdempotencyKey });
          stripeAction = 'canceled';
          console.log(`[Zone3 Deny] Canceled PI ${dar.stripe_payment_intent_id}`);
        } else if (pi.status === 'canceled') {
          stripeAction = 'already_canceled';
          console.log(`[Zone3 Deny] PI ${dar.stripe_payment_intent_id} already canceled`);
        } else {
          stripeAction = `not_cancelable_status_${pi.status}`;
          console.warn(`[Zone3 Deny] PI ${dar.stripe_payment_intent_id} status=${pi.status} — cannot cancel`);
        }
      } catch (cancelErr) {
        stripeAction = `cancel_error: ${cancelErr.message}`;
        console.error(`[Zone3 Deny] PI cancel error: ${cancelErr.message}`);
      }
    }

    // Create DeliveryWaitlist record
    let waitlistId = null;
    try {
      const waitlistRecord = await base44.asServiceRole.entities.DeliveryWaitlist.create({
        customer_name: dar.customer_name || '',
        customer_email: dar.customer_email || '',
        customer_phone: dar.customer_phone || '',
        delivery_address: dar.delivery_address || '',
        city: dar.address_city || '',
        state: dar.address_state || '',
        postal_code: dar.address_postal_code || '',
        reason: 'denied_route_review',
        requested_zone: dar.zone_key || 'zone_3_route_review',
        cart_subtotal: dar.cart_subtotal || 0,
        distance_miles: dar.estimated_distance_miles || null,
        drive_time_minutes: dar.estimated_drive_time_minutes || null,
        source: 'route_review_denial',
        status: 'new',
        admin_notes: `Denied by ${user.email}. Reason: ${admin_decision_reason}. DAR: ${dar.request_number || dar_id}`,
      });
      waitlistId = waitlistRecord.id;
      console.log(`[Zone3 Deny] Waitlist record created: ${waitlistId}`);
    } catch (wlErr) {
      console.error(`[Zone3 Deny] Waitlist creation failed: ${wlErr.message}`);
    }

    // Update DeliveryApprovalRequest
    await base44.asServiceRole.entities.DeliveryApprovalRequest.update(dar_id, {
      status: 'denied',
      admin_decision: 'denied',
      admin_decision_reason,
      denied_by: user.email,
      denied_at: new Date().toISOString(),
      stripe_authorization_status: stripeAction.includes('cancel') ? 'canceled' : dar.stripe_authorization_status,
      waitlist_id: waitlistId,
      cancel_idempotency_key: cancelIdempotencyKey,
      audit_trail: [...(dar.audit_trail || []), {
        action: 'denied',
        performed_by: user.email,
        timestamp: new Date().toISOString(),
        note: `Denied. Stripe action: ${stripeAction}. Waitlist: ${waitlistId}. Reason: ${admin_decision_reason}`,
      }],
    });

    // Notify customer
    const resolvedAddress = dar.delivery_address || [dar.address_line1, dar.address_city, dar.address_state, dar.address_postal_code].filter(Boolean).join(', ');
    base44.asServiceRole.functions.invoke('sendCustomerNotification', {
      customer_email: dar.customer_email,
      type: 'general',
      title: 'Route Review Update',
      message: `Thank you for your interest in NuVira delivery to ${resolvedAddress}. Unfortunately, we're unable to offer delivery to your area at this time. No charge was made to your card — the authorization hold has been released. We've added you to our delivery expansion waitlist and will notify you as soon as your area becomes available.`,
      deep_link: '/account',
      idempotency_key: `zone3_denied_${dar_id}`,
    }).catch(err => console.warn(`[Zone3 Deny] Notify failed: ${err.message}`));

    return Response.json({
      success: true,
      dar_status: 'denied',
      stripe_action: stripeAction,
      waitlist_id: waitlistId,
    });

  } catch (error) {
    console.error('[Zone3 Deny] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});