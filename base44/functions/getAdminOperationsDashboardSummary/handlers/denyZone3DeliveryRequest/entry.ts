import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const TRANSACTIONAL_FROM = Deno.env.get('TRANSACTIONAL_EMAIL_FROM') || 'NuVira Juice Co <orders@nuvirajuice.com>';
const TRANSACTIONAL_REPLY_TO = Deno.env.get('TRANSACTIONAL_EMAIL_REPLY_TO') || 'support@nuvirajuice.com';

function escapeHtml(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function findSentDeliveryLog(base44, idempotencyKey) {
  try {
    const existingSentLogs = await base44.asServiceRole.entities.CustomerMessageDeliveryLog.filter({
      idempotency_key: idempotencyKey,
    }, '-created_date', 5);
    return existingSentLogs.find((row) => ['sent', 'delivered'].includes(row?.status)) || null;
  } catch (error) {
    console.warn(`[Zone3 Deny] Delivery log lookup failed: ${error.message}`);
    return null;
  }
}

async function createDeliveryLog(base44, payload) {
  try {
    await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(payload);
  } catch (error) {
    console.warn(`[Zone3 Deny] Delivery log write failed: ${error.message}`);
  }
}

/**
 * denyZone3DeliveryRequest (Admin-only)
 * Cancels the uncaptured Stripe authorization, adds customer to waitlist, notifies customer.
 * Does NOT create an Order. Does NOT sync Hub.
 */
export default async (req: Request) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me().catch(() => null);
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    if (Deno.env.get('ENABLE_ZONE3_ROUTE_REVIEW_DECISIONS') !== 'true') {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'zone3_route_review_decisions_disabled',
        message: 'Zone 3 route review denials are disabled by the current route-decision gate. Use a separately approved exact route-decision workflow.',
      }, { status: 409 });
    }

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

    // Send denial email
    const resolvedAddress = dar.delivery_address || [dar.address_line1, dar.address_city, dar.address_state, dar.address_postal_code].filter(Boolean).join(', ');
    const denialEmailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: Arial, sans-serif; color: #333; background: #f9f7f4; margin: 0; padding: 0; }
    .wrapper { max-width: 580px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: #2d6a4f; padding: 32px 24px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; letter-spacing: 0.5px; }
    .header p { color: #b7e4c7; margin: 6px 0 0; font-size: 13px; }
    .body { padding: 28px 32px; }
    .body p { font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .notice-box { background: #fff8f0; border: 1px solid #f4d3a8; border-radius: 10px; padding: 20px 24px; margin: 20px 0; }
    .notice-box p { margin: 0; font-size: 14px; color: #7a4f00; }
    .waitlist-banner { background: #1b4332; color: #fff; border-radius: 8px; padding: 14px 20px; text-align: center; margin: 20px 0; font-size: 15px; }
    .footer { text-align: center; padding: 20px 24px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>NuVira Route Review Update</h1>
      <p>Real. Living. Nutrition.</p>
    </div>
    <div class="body">
      <p>Hi ${escapeHtml(dar.customer_name || 'there')},</p>
      <p>Thank you for your interest in NuVira delivery to <strong>${escapeHtml(resolvedAddress || 'your area')}</strong>.</p>
      <p>Unfortunately, we're not able to offer delivery to your area at this time based on our current route schedule.</p>
      <div class="notice-box">
        <p>✅ <strong>No charge was made.</strong> The temporary authorization hold on your card has been fully released.</p>
      </div>
      <div class="waitlist-banner">
        📋 You've been added to our delivery waitlist!<br>
        <span style="font-size:13px; opacity:0.85;">We'll notify you as soon as your area opens up.</span>
      </div>
      <p>We're constantly expanding our delivery routes and hope to serve your area soon. In the meantime, feel free to explore pickup options or reach out with any questions.</p>
      <p>Questions? Reply to this email or reach us at <a href="mailto:support@nuvirajuice.com" style="color:#2d6a4f;">support@nuvirajuice.com</a>.</p>
      <p style="margin-top:24px;">With love & greens,<br><strong>The NuVira Team 🌿</strong></p>
    </div>
    <div class="footer">&copy; 2026 NuVira Juice Company<br>619 N. Main St., O'Fallon, MO 63366</div>
  </div>
</body>
</html>`;

    const denialEmailKey = `zone3_denial_email_${dar_id}`;
    const existingSentLog = await findSentDeliveryLog(base44, denialEmailKey);

    if (existingSentLog) {
      console.log('[Zone3 Deny] Zone 3 denial email already sent; skipping duplicate');
    } else {
      try {
        if (!RESEND_API_KEY) throw new Error('resend_api_key_missing');
        const emailResponse = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': denialEmailKey.slice(0, 256),
          },
          body: JSON.stringify({
            from: TRANSACTIONAL_FROM,
            to: [dar.customer_email],
            reply_to: TRANSACTIONAL_REPLY_TO,
            subject: 'NuVira Route Review Update',
            html: denialEmailHtml,
            tags: [
              { name: 'category', value: 'transactional_order' },
              { name: 'event', value: 'zone3_denial' },
            ],
          }),
        });
        const emailResult = await emailResponse.json().catch(() => ({}));
        if (!emailResponse.ok || !emailResult?.id) {
          throw new Error(`resend_${emailResponse.status}_${String(emailResult?.message || 'send_failed').slice(0, 200)}`);
        }
        console.log(`[Zone3 Deny] Denial email sent to ${dar.customer_email}`);
        await createDeliveryLog(base44, {
          idempotency_key: denialEmailKey,
          channel: 'email',
          message_type: 'zone3_denial',
          customer_email: dar.customer_email,
          provider: 'resend',
          provider_message_id: emailResult.id,
          status: 'sent',
          sent_at: new Date().toISOString(),
          metadata: {
            source_function: 'denyZone3DeliveryRequest',
            dar_id,
            request_number: dar.request_number || null,
            stripe_action: stripeAction,
          },
        });
      } catch (err) {
        console.warn(`[Zone3 Deny] Email send failed: ${err.message}`);
        await createDeliveryLog(base44, {
          idempotency_key: denialEmailKey,
          channel: 'email',
          message_type: 'zone3_denial',
          customer_email: dar.customer_email,
          provider: 'internal',
          provider_message_id: null,
          status: 'failed',
          error_message: err.message,
          sent_at: new Date().toISOString(),
          metadata: {
            source_function: 'denyZone3DeliveryRequest',
            dar_id,
            request_number: dar.request_number || null,
            stripe_action: stripeAction,
          },
        });
      }
    }

    // Notify customer (in-app)
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
};
