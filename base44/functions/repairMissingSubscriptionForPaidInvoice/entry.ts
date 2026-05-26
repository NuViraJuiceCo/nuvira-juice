import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * Repair missing Customer App Subscription for active paid Stripe subscription.
 * 
 * Context: Stripe shows sub_1TUsPSIrzYHaHkt2QoRmPw2F as ACTIVE and paid.
 * Customer App has no Subscription record for it because invoice.payment_succeeded
 * webhook failed to find the subscription ID in the invoice object (or webhook didn't process).
 * 
 * This function:
 * 1. Verifies the Stripe subscription is real, paid, and active
 * 2. Finds the matching PendingSubscriptionCheckout
 * 3. Creates/activates the Subscription record
 * 4. Awards loyalty points exactly once
 * 5. Marks PendingSubscriptionCheckout as completed
 * 6. Syncs to Hub
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_REPAIR_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_repair_tools_disabled',
        message: 'Legacy repair tools are disabled for May 30 launch freeze.',
      });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const {
      stripe_subscription_id = 'sub_1TUsPSIrzYHaHkt2QoRmPw2F',
      stripe_invoice_id = 'in_1TUsPSIrzYHaHkt2HdLlkJAO',
      customer_email = 'amark@nuvisionarymedia.com',
    } = await req.json();

    console.log(`[repairMissingSub] Starting repair for ${stripe_subscription_id}, invoice ${stripe_invoice_id}`);

    // ── STEP 1: Verify Stripe subscription is real and paid ──
    const stripeSub = await stripe.subscriptions.retrieve(stripe_subscription_id);
    console.log(`[repairMissingSub] Stripe sub status: ${stripeSub.status}`);
    
    if (stripeSub.status !== 'active') {
      return Response.json({
        error: `Stripe subscription ${stripe_subscription_id} is ${stripeSub.status}, not active. Cannot repair.`,
        stripe_status: stripeSub.status,
      }, { status: 400 });
    }

    const stripeInvoice = await stripe.invoices.retrieve(stripe_invoice_id);
    console.log(`[repairMissingSub] Stripe invoice status: ${stripeInvoice.status}, amount_paid: ${stripeInvoice.amount_paid / 100}`);
    
    if (stripeInvoice.status !== 'paid' || stripeInvoice.amount_paid === 0) {
      return Response.json({
        error: `Stripe invoice ${stripe_invoice_id} is not paid. Cannot repair.`,
        invoice_status: stripeInvoice.status,
      }, { status: 400 });
    }

    const paidAmount = stripeInvoice.amount_paid / 100;
    const pointsToAward = Math.floor(paidAmount * 10);

    // ── STEP 2: Find matching PendingSubscriptionCheckout ──
    const pendingCheckouts = await base44.asServiceRole.entities.PendingSubscriptionCheckout.filter({
      stripe_subscription_id: stripe_subscription_id,
      customer_email: customer_email,
    });

    if (pendingCheckouts.length === 0) {
      return Response.json({
        error: `No PendingSubscriptionCheckout found for ${stripe_subscription_id}`,
      }, { status: 404 });
    }

    const pendingCheckout = pendingCheckouts[0];
    console.log(`[repairMissingSub] Found PendingSubscriptionCheckout ${pendingCheckout.id}, status=${pendingCheckout.status}`);

    // ── STEP 3: Fetch Plan details ──
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({
      id: pendingCheckout.plan_id,
    });
    const plan = plans[0];

    // ── STEP 4: Create Subscription record ──
    const newSubscription = await base44.asServiceRole.entities.Subscription.create({
      customer_email: customer_email,
      plan_id: pendingCheckout.plan_id,
      bundle_id: pendingCheckout.bundle_id || '',
      delivery_zone_id: pendingCheckout.delivery_zone_id,
      delivery_address: pendingCheckout.delivery_address,
      status: 'active',
      stripe_subscription_id: stripe_subscription_id,
      stripe_customer_id: pendingCheckout.stripe_customer_id,
      started_date: pendingCheckout.first_delivery_date,
      next_delivery_date: pendingCheckout.next_delivery_date,
      custom_composition: pendingCheckout.products?.map(p => ({
        product_name: p.product_name,
        product_id: p.product_id,
        quantity: p.quantity,
      })) || [],
      description: `[REPAIR] Automatically created from PendingSubscriptionCheckout ${pendingCheckout.id}. Stripe subscription was paid but webhook failed to process. Created ${new Date().toISOString()}.`,
      hub_sync_status: 'pending',
    });

    console.log(`[repairMissingSub] Created Subscription ${newSubscription.id}`);

    // ── STEP 5: Award loyalty points exactly once ──
    const pointsRecs = await base44.asServiceRole.entities.UserPoints.filter({
      customer_email: customer_email,
    });

    let loyaltyAction = 'skipped_no_record';
    if (pointsRecs[0]) {
      const rec = pointsRecs[0];
      // Check if already awarded for this exact subscription
      const alreadyAwarded = rec.points_history?.some(h =>
        h.description?.includes(stripe_subscription_id) && h.type === 'earned'
      );

      if (!alreadyAwarded) {
        const entry = {
          amount: pointsToAward,
          type: 'earned',
          description: `Subscription payment of $${paidAmount.toFixed(2)} (subscription ${stripe_subscription_id}) [REPAIR]`,
          timestamp: new Date().toISOString(),
        };
        await base44.asServiceRole.entities.UserPoints.update(rec.id, {
          total_points: (rec.total_points || 0) + pointsToAward,
          lifetime_points: (rec.lifetime_points || 0) + pointsToAward,
          points_history: [...(rec.points_history || []), entry],
        });
        loyaltyAction = `awarded_${pointsToAward}_pts`;
        console.log(`[repairMissingSub] Awarded ${pointsToAward} loyalty points`);
      } else {
        loyaltyAction = 'already_awarded_idempotent';
        console.log(`[repairMissingSub] Points already awarded for this subscription, skipping`);
      }
    }

    // ── STEP 6: Mark PendingSubscriptionCheckout as completed ──
    await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(
      pendingCheckout.id,
      {
        status: 'completed',
        completed_at: new Date().toISOString(),
        notes: `[REPAIR] Marked completed after Subscription creation. Webhook failed to process paid invoice. Sub: ${newSubscription.id}`,
      }
    );
    console.log(`[repairMissingSub] Marked PendingSubscriptionCheckout ${pendingCheckout.id} as completed`);

    // ── STEP 7: Sync to Hub ──
    let hubResult = 'not_sent';
    try {
      const hubResp = await base44.asServiceRole.functions.invoke('syncCustomerToHub', {
        event: 'customer.subscription_created',
        customer_email: customer_email,
        data: {
          subscription_id: newSubscription.id,
          customer_app_subscription_id: newSubscription.id,
          stripe_subscription_id: stripe_subscription_id,
          stripe_customer_id: pendingCheckout.stripe_customer_id,
          customer_name: pendingCheckout.customer_name,
          customer_email: customer_email,
          phone: pendingCheckout.customer_phone || '',
          payment_status: 'paid',
          financial_status: 'paid',
          plan_id: pendingCheckout.plan_id,
          plan_name: plan?.name || 'Unknown',
          billing_cadence: pendingCheckout.cadence,
          fulfillment_cadence: 'weekly',
          fulfillments_per_cycle: pendingCheckout.fulfillments_per_cycle,
          fulfillment_number: 1,
          order_type: 'subscription',
          source_type: 'subscription_fulfillment',
          production_date: pendingCheckout.production_date,
          first_delivery_date: pendingCheckout.first_delivery_date,
          next_delivery_date: pendingCheckout.next_delivery_date,
          subscription_started_date: pendingCheckout.first_delivery_date,
          delivery_window_label: pendingCheckout.delivery_window_label,
          delivery_window_start: pendingCheckout.delivery_window_start,
          delivery_window_end: pendingCheckout.delivery_window_end,
          delivery_address: pendingCheckout.delivery_address,
          address_line1: pendingCheckout.address_line1,
          address_line2: pendingCheckout.address_line2,
          address_city: pendingCheckout.address_city,
          address_state: pendingCheckout.address_state,
          address_postal_code: pendingCheckout.address_postal_code,
          address_country: 'US',
          delivery_zone_id: pendingCheckout.delivery_zone_id,
          products: newSubscription.custom_composition,
          items_summary: pendingCheckout.items_summary,
        },
      });
      hubResult = hubResp?.success ? 'sent_ok' : 'sent_noop';
      console.log(`[repairMissingSub] Hub sync result: ${hubResult}`);
    } catch (hubErr) {
      hubResult = `failed: ${hubErr.message}`;
      console.error(`[repairMissingSub] Hub sync failed: ${hubErr.message}`);
    }

    return Response.json({
      success: true,
      subscription_id: newSubscription.id,
      stripe_subscription_id: stripe_subscription_id,
      loyalty_action: loyaltyAction,
      hub_result: hubResult,
      message: `✅ Subscription repaired. Created ${newSubscription.id} for Stripe ${stripe_subscription_id}. Loyalty: ${loyaltyAction}. Hub: ${hubResult}.`,
    });

  } catch (error) {
    console.error('[repairMissingSub] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
