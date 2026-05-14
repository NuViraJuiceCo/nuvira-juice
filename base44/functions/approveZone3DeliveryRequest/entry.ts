import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * approveZone3DeliveryRequest (Admin-only)
 * Captures a Zone 3 manual authorization, creates the Order, syncs Hub.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });

    const { dar_id, approved_delivery_fee, admin_decision_reason } = await req.json();

    if (!dar_id) return Response.json({ error: 'dar_id is required' }, { status: 400 });
    if (!admin_decision_reason?.trim()) return Response.json({ error: 'admin_decision_reason is required' }, { status: 400 });

    // Load DeliveryApprovalRequest
    const dars = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ id: dar_id });
    const dar = dars[0];
    if (!dar) return Response.json({ error: 'DeliveryApprovalRequest not found' }, { status: 404 });

    // Validate status
    if (dar.status !== 'pending_review') {
      return Response.json({ error: `Request is in status ${dar.status}, not pending_review. Cannot approve.`, status: dar.status }, { status: 400 });
    }

    if (!dar.stripe_payment_intent_id) {
      return Response.json({ error: 'No Stripe PaymentIntent associated with this request.' }, { status: 400 });
    }

    // Verify Stripe PI is still capturable
    const pi = await stripe.paymentIntents.retrieve(dar.stripe_payment_intent_id);
    if (pi.status !== 'requires_capture') {
      return Response.json({ error: `PaymentIntent status is ${pi.status}, expected requires_capture. Cannot capture.`, stripe_status: pi.status }, { status: 400 });
    }

    // Determine capture amount
    const captureDeliveryFee = approved_delivery_fee != null ? approved_delivery_fee : (dar.estimated_delivery_fee || 0);
    const captureTotal = Math.max(0, Math.round(((dar.cart_subtotal || 0) + captureDeliveryFee) * 100) / 100);
    const captureAmountCents = Math.max(50, Math.round(captureTotal * 100));

    // Idempotency key for capture
    const captureIdempotencyKey = `approve_zone3_${dar_id}_${dar.stripe_payment_intent_id}`;

    // Capture PaymentIntent
    let capturedPi;
    try {
      capturedPi = await stripe.paymentIntents.capture(dar.stripe_payment_intent_id, {
        amount_to_capture: captureAmountCents,
      }, { idempotencyKey: captureIdempotencyKey });
      console.log(`[Zone3 Approve] Captured PI ${dar.stripe_payment_intent_id} for ${captureAmountCents}¢`);
    } catch (captureErr) {
      console.error(`[Zone3 Approve] Capture failed: ${captureErr.message}`);
      return Response.json({ error: `Payment capture failed: ${captureErr.message}` }, { status: 400 });
    }

    if (capturedPi.status !== 'succeeded') {
      return Response.json({ error: `Capture returned status ${capturedPi.status}, expected succeeded.`, stripe_status: capturedPi.status }, { status: 400 });
    }

    // Get delivery schedule
    let scheduleResult;
    try {
      const schedResp = await base44.asServiceRole.functions.invoke('calculateNuViraFulfillmentSchedule', { created_at: new Date().toISOString() });
      scheduleResult = schedResp.data || schedResp;
    } catch {
      scheduleResult = {
        production_date: '',
        delivery_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        delivery_window_label: '5 PM – 8 PM',
        delivery_window_start: '17:00',
        delivery_window_end: '20:00',
        schedule_reason: 'fallback_defaults',
        cutoff_window_label: 'unknown',
      };
    }

    // Generate order number
    const orderNumber = `NV-${Date.now().toString(36).toUpperCase()}`;

    const resolvedDeliveryAddress = dar.delivery_address || [dar.address_line1, dar.address_city, dar.address_state, dar.address_postal_code].filter(Boolean).join(', ');

    // Create Order after successful capture
    const order = await base44.asServiceRole.entities.Order.create({
      order_number: orderNumber,
      customer_email: dar.customer_email || '',
      customer_name: dar.customer_name || '',
      items: (dar.cart_items || []).map(i => ({ product_id: i.product_id, title: i.title, price: i.price, quantity: i.quantity })),
      subtotal: dar.cart_subtotal || 0,
      delivery_fee: captureDeliveryFee,
      total: captureTotal,
      fulfillment_type: 'delivery',
      delivery_address: resolvedDeliveryAddress,
      address_line1: dar.address_line1 || '',
      address_line2: dar.address_line2 || '',
      address_city: dar.address_city || '',
      address_state: dar.address_state || '',
      address_postal_code: dar.address_postal_code || '',
      address_country: 'US',
      contact_phone: dar.customer_phone || '',
      estimated_delivery_date: scheduleResult.delivery_date,
      assigned_delivery_date: scheduleResult.delivery_date,
      delivery_window_label: scheduleResult.delivery_window_label,
      assigned_delivery_window_start: scheduleResult.delivery_window_start,
      assigned_delivery_window_end: scheduleResult.delivery_window_end,
      status: 'scheduled_for_juicing',
      payment_status: 'paid',
      financial_status: 'paid',
      payment_captured: true,
      stripe_payment_intent_id: dar.stripe_payment_intent_id,
      delivery_zone_id: dar.zone_key || '',
      scheduling_reason: scheduleResult.schedule_reason || 'zone3_approved',
      final_schedule_source: 'central_engine',
      schedule_timezone: 'America/Chicago',
      cutoff_window_label: scheduleResult.cutoff_window_label || 'zone3_approval',
      notes: `Zone 3 Route Review approved. Admin: ${user.email}. Reason: ${admin_decision_reason}. Distance: ${dar.estimated_distance_miles} miles.`,
      status_history: [
        { status: 'order_received', timestamp: new Date().toISOString(), message: 'Zone 3 route review approved by NuVira admin.' },
        { status: 'scheduled_for_juicing', timestamp: new Date().toISOString(), message: 'Payment captured — order scheduled for juicing.' },
      ],
    });

    console.log(`[Zone3 Approve] Order created: ${order.id} (${orderNumber})`);

    // Update DAR
    await base44.asServiceRole.entities.DeliveryApprovalRequest.update(dar_id, {
      status: 'captured',
      admin_decision: 'approved',
      admin_decision_reason,
      approved_delivery_fee: captureDeliveryFee,
      approved_by: user.email,
      approved_at: new Date().toISOString(),
      stripe_authorization_status: 'succeeded',
      amount_capturable: 0,
      created_order_id: order.id,
      created_order_number: orderNumber,
      capture_idempotency_key: captureIdempotencyKey,
      audit_trail: [...(dar.audit_trail || []), {
        action: 'approved_and_captured',
        performed_by: user.email,
        timestamp: new Date().toISOString(),
        note: `Approved. Delivery fee: $${captureDeliveryFee}. Captured: $${captureTotal}. Order: ${orderNumber}. Reason: ${admin_decision_reason}`,
      }],
    });

    // Sync to Hub
    base44.asServiceRole.functions.invoke('syncOrderToHub', {
      order_id: order.id,
      stripe_session: { payment_status: 'paid', id: dar.stripe_payment_intent_id },
      triggered_by: 'zone3_approval',
    }).then(() => console.log(`[Zone3 Approve] ✅ Order ${orderNumber} synced to Hub`))
      .catch(err => {
        console.error(`[Zone3 Approve] Hub sync failed: ${err.message}`);
        base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: orderNumber, status: 'error',
          description: `Zone3 approval Hub sync failed: ${err.message}`,
          started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
          triggered_by: 'zone3_approval',
        }).catch(() => {});
      });

    // Send approval email
    const itemsSummary = (dar.cart_items || []).map(i => `${i.quantity}x ${i.title}`).join(', ') || '—';
    const deliveryFormatted = scheduleResult.delivery_date
      ? new Date(scheduleResult.delivery_date).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : 'TBD';
    const approvalEmailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: Arial, sans-serif; color: #333; background: #f9f7f4; margin: 0; padding: 0; }
    .wrapper { max-width: 580px; margin: 40px auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
    .header { background: #2d6a4f; padding: 32px 24px; text-align: center; }
    .header h1 { color: #fff; margin: 0; font-size: 22px; letter-spacing: 0.5px; }
    .header p { color: #b7e4c7; margin: 6px 0 0; font-size: 13px; }
    .body { padding: 28px 32px; }
    .body p { font-size: 15px; line-height: 1.6; margin: 0 0 16px; }
    .order-box { background: #f0faf4; border: 1px solid #b7e4c7; border-radius: 10px; padding: 20px 24px; margin: 20px 0; }
    .order-box .row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #d8f3e6; font-size: 14px; }
    .order-box .row:last-child { border-bottom: none; font-weight: bold; font-size: 15px; }
    .order-box .label { color: #555; }
    .order-box .value { color: #1b4332; font-weight: 600; }
    .delivery-banner { background: #1b4332; color: #fff; border-radius: 8px; padding: 14px 20px; text-align: center; margin: 20px 0; font-size: 15px; }
    .delivery-banner strong { font-size: 17px; display: block; margin-top: 4px; }
    .footer { text-align: center; padding: 20px 24px; font-size: 12px; color: #999; border-top: 1px solid #eee; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <h1>🎉 Delivery Approved!</h1>
      <p>Real. Living. Nutrition.</p>
    </div>
    <div class="body">
      <p>Hi ${dar.customer_name || 'there'},</p>
      <p>Great news — your NuVira route review has been approved! Your order is confirmed and scheduled for juicing.</p>
      <div class="order-box">
        <div class="row"><span class="label">Order Number</span><span class="value">${orderNumber}</span></div>
        <div class="row"><span class="label">Items</span><span class="value">${itemsSummary}</span></div>
        <div class="row"><span class="label">Delivery Address</span><span class="value">${resolvedDeliveryAddress}</span></div>
        <div class="row"><span class="label">Delivery Fee</span><span class="value">$${captureDeliveryFee.toFixed(2)}</span></div>
        <div class="row"><span class="label">Total Charged</span><span class="value">$${captureTotal.toFixed(2)}</span></div>
      </div>
      <div class="delivery-banner">
        🚚 Scheduled Delivery
        <strong>${deliveryFormatted}</strong>
      </div>
      <p>We'll notify you when your order is on its way. Questions? Reply to this email or reach us at <a href="mailto:support@nuvirajuice.com" style="color:#2d6a4f;">support@nuvirajuice.com</a>.</p>
      <p style="margin-top:24px;">With love & greens,<br><strong>The NuVira Team 🌿</strong></p>
    </div>
    <div class="footer">&copy; 2026 NuVira Juice Company · Wentzville, MO</div>
  </div>
</body>
</html>`;

    base44.asServiceRole.integrations.Core.SendEmail({
      to: dar.customer_email,
      subject: `🎉 Your NuVira Delivery is Approved! Order #${orderNumber}`,
      body: approvalEmailHtml,
      from_name: 'NuVira Juice Co.',
    }).then(() => console.log(`[Zone3 Approve] Approval email sent to ${dar.customer_email}`))
      .catch(err => console.warn(`[Zone3 Approve] Email send failed: ${err.message}`));

    // Notify customer (in-app)
    base44.asServiceRole.functions.invoke('sendCustomerNotification', {
      customer_email: dar.customer_email,
      type: 'order_update',
      notification_subtype: 'order_confirmation',
      title: '🎉 Delivery Approved!',
      message: `Great news! NuVira has approved your delivery request for ${resolvedDeliveryAddress}. Your order #${orderNumber} is confirmed and scheduled for juicing.`,
      order_id: order.id,
      deep_link: `/order-tracker/${orderNumber}`,
      idempotency_key: `zone3_approved_${dar_id}`,
    }).catch(err => console.warn(`[Zone3 Approve] Notify failed: ${err.message}`));

    // Award loyalty points
    if (dar.customer_email && captureTotal > 0) {
      const pointsToAward = Math.floor(captureTotal * 10);
      const existing = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: dar.customer_email });
      const entry = { amount: pointsToAward, type: 'earned', description: `Zone 3 order payment of $${captureTotal.toFixed(2)} (${orderNumber})`, timestamp: new Date().toISOString() };
      if (existing.length > 0) {
        await base44.asServiceRole.entities.UserPoints.update(existing[0].id, {
          total_points: (existing[0].total_points || 0) + pointsToAward,
          lifetime_points: (existing[0].lifetime_points || 0) + pointsToAward,
          points_history: [...(existing[0].points_history || []), entry],
        });
      } else {
        await base44.asServiceRole.entities.UserPoints.create({ customer_email: dar.customer_email, total_points: pointsToAward, lifetime_points: pointsToAward, redeemed_points: 0, points_history: [entry] });
      }
    }

    return Response.json({
      success: true,
      order_id: order.id,
      order_number: orderNumber,
      captured_amount: captureTotal,
      dar_status: 'captured',
    });

  } catch (error) {
    console.error('[Zone3 Approve] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});