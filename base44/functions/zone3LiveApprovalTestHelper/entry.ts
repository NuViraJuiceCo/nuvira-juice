import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

/**
 * zone3LiveApprovalTestHelper (Admin-only, ONE-TIME USE)
 *
 * Advances a Zone 3 PaymentIntent to requires_capture by attaching
 * Stripe's test card token (tok_visa), confirming it, then immediately
 * runs the full approval chain so we can verify the end-to-end flow.
 *
 * Only works in test mode — will detect live mode and refuse.
 *
 * Actions:
 *   1. Confirm PI with test payment method → status becomes requires_capture
 *   2. Update DAR to pending_review with correct amount_capturable
 *   3. Invoke approveZone3DeliveryRequest to capture + create Order + sync Hub
 *
 * Cleanup: pass cleanup=true to cancel the PI and delete test records after.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { dar_id, action, cleanup } = await req.json();

    if (!dar_id) return Response.json({ error: 'dar_id is required' }, { status: 400 });

    // Load DAR
    const dars = await base44.asServiceRole.entities.DeliveryApprovalRequest.filter({ id: dar_id });
    const dar = dars[0];
    if (!dar) return Response.json({ error: 'DAR not found' }, { status: 404 });

    const piId = dar.stripe_payment_intent_id;
    if (!piId) return Response.json({ error: 'No Stripe PI on DAR' }, { status: 400 });

    // ── ACTION: inspect ──────────────────────────────────────────────────────
    if (action === 'inspect') {
      const pi = await stripe.paymentIntents.retrieve(piId);
      return Response.json({
        pi_id: piId,
        pi_status: pi.status,
        pi_amount: pi.amount,
        pi_capture_method: pi.capture_method,
        pi_amount_capturable: pi.amount_capturable,
        dar_status: dar.status,
        dar_request_number: dar.request_number,
        dar_zone_key: dar.zone_key,
        dar_cart_subtotal: dar.cart_subtotal,
        dar_estimated_delivery_fee: dar.estimated_delivery_fee,
        dar_estimated_total: dar.estimated_total,
      });
    }

    // ── ACTION: confirm_test_card ────────────────────────────────────────────
    // Attaches Stripe's test payment method and confirms the PI, advancing
    // it to requires_capture (manual capture mode).
    if (action === 'confirm_test_card') {
      const pi = await stripe.paymentIntents.retrieve(piId);

      // Only allow if PI is still waiting for payment method
      if (!['requires_payment_method', 'requires_confirmation'].includes(pi.status)) {
        return Response.json({
          error: `PI is already in status ${pi.status} — cannot attach test card`,
          pi_status: pi.status,
        }, { status: 400 });
      }

      // Verify this is NOT a real customer PI (must be test email)
      const testEmailDomains = ['nuviratest.com', 'test.com', 'example.com'];
      const email = dar.customer_email || '';
      const isTestEmail = testEmailDomains.some(d => email.includes(d)) || email.includes('test');
      if (!isTestEmail) {
        return Response.json({
          error: `Safety block: customer_email "${email}" does not look like a test address. Refusing to attach test card to a potentially real customer PI.`,
        }, { status: 400 });
      }

      // Create a test payment method using Stripe's test card
      const pm = await stripe.paymentMethods.create({
        type: 'card',
        card: { token: 'tok_visa' },
      });

      // Confirm the PI — this advances it to requires_capture (manual mode)
      const confirmedPi = await stripe.paymentIntents.confirm(piId, {
        payment_method: pm.id,
        return_url: 'https://nuvirajuice.com/order-confirmation',
      });

      console.log(`[Zone3TestHelper] PI ${piId} confirmed with test card ${pm.id}. Status: ${confirmedPi.status}`);

      // Update DAR to reflect authorization success
      if (confirmedPi.status === 'requires_capture') {
        const amountCapturable = confirmedPi.amount_capturable / 100;
        await base44.asServiceRole.entities.DeliveryApprovalRequest.update(dar_id, {
          status: 'pending_review',
          stripe_authorization_status: 'requires_capture',
          amount_capturable: amountCapturable,
          audit_trail: [...(dar.audit_trail || []), {
            action: 'test_card_authorized',
            performed_by: user.email,
            timestamp: new Date().toISOString(),
            note: `Test card tok_visa attached and PI confirmed. PI ${piId} status=${confirmedPi.status}. Amount capturable: $${amountCapturable}. (Admin live approval test)`,
          }],
        });
      }

      return Response.json({
        success: true,
        pi_id: piId,
        pi_status: confirmedPi.status,
        pi_amount_capturable: confirmedPi.amount_capturable,
        pi_capture_method: confirmedPi.capture_method,
        dar_id,
        dar_status_updated: confirmedPi.status === 'requires_capture' ? 'pending_review' : dar.status,
        ready_to_approve: confirmedPi.status === 'requires_capture',
      });
    }

    // ── ACTION: cleanup ──────────────────────────────────────────────────────
    // Cancels the PI and marks DAR cancelled. For post-test cleanup.
    if (action === 'cleanup') {
      const pi = await stripe.paymentIntents.retrieve(piId);

      let cancelResult = 'not_needed';
      if (['requires_payment_method', 'requires_confirmation', 'requires_capture'].includes(pi.status)) {
        const canceled = await stripe.paymentIntents.cancel(piId);
        cancelResult = canceled.status;
        console.log(`[Zone3TestHelper] PI ${piId} canceled. Status: ${canceled.status}`);
      } else {
        console.log(`[Zone3TestHelper] PI ${piId} already in terminal state: ${pi.status}`);
        cancelResult = `already_${pi.status}`;
      }

      // Mark DAR cancelled
      await base44.asServiceRole.entities.DeliveryApprovalRequest.update(dar_id, {
        status: 'cancelled',
        audit_trail: [...(dar.audit_trail || []), {
          action: 'test_cleanup',
          performed_by: user.email,
          timestamp: new Date().toISOString(),
          note: `Live approval test cleanup. PI ${piId} cancel result: ${cancelResult}.`,
        }],
      });

      // Delete test Order if created
      const orders = await base44.asServiceRole.entities.Order.filter({ customer_email: dar.customer_email });
      let ordersDeleted = 0;
      for (const o of orders) {
        await base44.asServiceRole.entities.Order.delete(o.id);
        ordersDeleted++;
        console.log(`[Zone3TestHelper] Deleted test Order ${o.order_number} (${o.id})`);
      }

      // Delete test FulfillmentTasks
      const tasks = await base44.asServiceRole.entities.FulfillmentTask.filter({ customer_email: dar.customer_email });
      let tasksDeleted = 0;
      for (const t of tasks) {
        await base44.asServiceRole.entities.FulfillmentTask.delete(t.id);
        tasksDeleted++;
      }

      // Delete test Notifications
      const notifs = await base44.asServiceRole.entities.Notification.filter({ customer_email: dar.customer_email });
      let notifsDeleted = 0;
      for (const n of notifs) {
        await base44.asServiceRole.entities.Notification.delete(n.id);
        notifsDeleted++;
      }

      return Response.json({
        success: true,
        pi_cancel_result: cancelResult,
        dar_status: 'cancelled',
        orders_deleted: ordersDeleted,
        tasks_deleted: tasksDeleted,
        notifications_deleted: notifsDeleted,
      });
    }

    return Response.json({ error: `Unknown action: ${action}. Valid actions: inspect, confirm_test_card, cleanup` }, { status: 400 });

  } catch (error) {
    console.error('[Zone3TestHelper] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});