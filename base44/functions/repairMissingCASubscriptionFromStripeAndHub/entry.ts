import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * Repair missing CA Subscription record for an active Stripe subscription.
 * 
 * This function:
 * 1. Verifies the Stripe subscription is active and not a refunded duplicate
 * 2. Creates or repairs the CA Subscription record using Hub-canonical data
 * 3. Marks hub_sync_status as already_synced_to_hub (no new Hub demand)
 * 4. Does NOT create Hub orders, FulfillmentTasks, or ProductionBatches
 * 5. Does NOT award loyalty points
 * 6. Does NOT send sync events to Hub
 * 
 * Input payload:
 * {
 *   stripe_subscription_id: "sub_...",
 *   hub_order_id: "...",
 *   hub_order_number: "#SUB-...",
 *   customer_name: "Sukhwant Kahlon",
 *   customer_email: "ksukhi2000@yahoo.com",
 *   delivery_address: "6930 Brassel Drive, O'Fallon, MO, 63368",
 *   address_line1: "6930 Brassel Drive",
 *   address_city: "O'Fallon",
 *   address_state: "MO",
 *   address_postal_code: "63368",
 *   plan_name: "Monthly Ritual",
 *   plan_id: "69dff325e191695828ee96a1",
 *   next_delivery_date: "2026-05-17",
 *   refunded_duplicate_stripe_sub: "sub_1TUz36IrzYHaHkt2oHrmLgNL"  // For safety check
 * }
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Auth: admin only
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const {
      stripe_subscription_id,
      hub_order_id,
      hub_order_number,
      customer_name,
      customer_email,
      delivery_address,
      address_line1,
      address_city,
      address_state,
      address_postal_code,
      plan_name,
      plan_id,
      next_delivery_date,
      refunded_duplicate_stripe_sub,
    } = await req.json();

    if (!stripe_subscription_id || !customer_email || !plan_id || !next_delivery_date) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    console.log(`[RepairCASubscription] Starting repair for stripe_sub=${stripe_subscription_id}, customer=${customer_email}`);

    // ── STEP 1: Fetch and validate Stripe subscription ──────────────────
    let stripeSubscription;
    try {
      stripeSubscription = await stripe.subscriptions.retrieve(stripe_subscription_id);
    } catch (stripeErr) {
      console.error(`[RepairCASubscription] Failed to fetch Stripe subscription: ${stripeErr.message}`);
      return Response.json({ error: `Stripe subscription not found: ${stripeErr.message}` }, { status: 404 });
    }

    // Safety: confirm this is not the refunded duplicate
    if (refunded_duplicate_stripe_sub && stripe_subscription_id === refunded_duplicate_stripe_sub) {
      console.error(`[RepairCASubscription] SECURITY: attempted to repair refunded duplicate sub ${stripe_subscription_id}`);
      return Response.json({ error: 'Cannot repair refunded duplicate subscription' }, { status: 400 });
    }

    // Confirm status is active or unpaid (not cancelled/refunded)
    if (stripeSubscription.status !== 'active' && stripeSubscription.status !== 'incomplete') {
      console.error(`[RepairCASubscription] Stripe subscription status=${stripeSubscription.status}, expected active`);
      return Response.json({
        error: `Stripe subscription is ${stripeSubscription.status}, not active. Cannot repair non-active subscription.`,
      }, { status: 400 });
    }

    console.log(`[RepairCASubscription] Stripe subscription validated: status=${stripeSubscription.status}`);

    // ── STEP 2: Check if CA Subscription already exists ──────────────────
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({
      stripe_subscription_id,
    });

    if (existingSubs.length > 0) {
      const existing = existingSubs[0];
      console.log(`[RepairCASubscription] CA Subscription already exists: ${existing.id}, status=${existing.status}`);

      // If it exists and is active, just return success without modifying
      if (existing.status === 'active') {
        return Response.json({
          success: true,
          ca_subscription_id: existing.id,
          action: 'already_exists',
          stripe_subscription_status: stripeSubscription.status,
          message: 'CA Subscription already exists and is active',
        });
      }

      // If it exists but is not active, we could repair the status
      // For now, skip to avoid unintended state changes
      console.warn(`[RepairCASubscription] CA Subscription exists but status=${existing.status}. Skipping repair.`);
      return Response.json({
        success: false,
        error: `CA Subscription exists with status=${existing.status}. Admin must review before repair.`,
      }, { status: 409 });
    }

    console.log(`[RepairCASubscription] No existing CA Subscription found. Creating new record.`);

    // ── STEP 3: Fetch plan to confirm it exists ───────────────────────────
    const plans = await base44.asServiceRole.entities.SubscriptionPlan.filter({ id: plan_id });
    if (!plans[0]) {
      console.error(`[RepairCASubscription] Plan ${plan_id} not found`);
      return Response.json({ error: `Plan ${plan_id} not found` }, { status: 404 });
    }

    console.log(`[RepairCASubscription] Plan confirmed: ${plans[0].name}`);

    // ── STEP 4: Fetch default delivery zone ────────────────────────────────
    const allZones = await base44.asServiceRole.entities.DeliveryZone.filter({ is_active: true }, 'sort_order', 1);
    const defaultZoneId = allZones[0]?.id || '';

    // ── STEP 5: Create CA Subscription record ─────────────────────────────
    const caSubscription = await base44.asServiceRole.entities.Subscription.create({
      customer_email,
      stripe_subscription_id,
      stripe_customer_id: stripeSubscription.customer,
      plan_id,
      bundle_id: '',
      delivery_zone_id: defaultZoneId,
      delivery_address,
      status: 'active',
      started_date: next_delivery_date, // Use next delivery as reference point
      next_delivery_date,
      description: '[REPAIR] Repaired from Stripe & Hub reconciliation. No new Hub demand created. Existing Hub order and fulfillments remain operational.',
      hub_sync_status: 'synced', // Mark as already synced because Hub already has the order
      hub_synced_at: new Date().toISOString(),
      hub_sync_attempted_at: new Date().toISOString(),
      hub_sync_response_status: 200,
      hub_sync_response_body: 'Repaired from Stripe/Hub reconciliation — no new sync performed',
    });

    console.log(`[RepairCASubscription] ✅ CA Subscription created: ${caSubscription.id}`);

    // ── STEP 6: Validate refunded duplicate was not modified ──────────────
    if (refunded_duplicate_stripe_sub) {
      const refundedSubs = await base44.asServiceRole.entities.Subscription.filter({
        stripe_subscription_id: refunded_duplicate_stripe_sub,
      });
      if (refundedSubs[0]) {
        const refundedStatus = refundedSubs[0].status;
        const isTerminal = ['cancelled', 'refunded', 'paused'].includes(refundedStatus) || 
                          refundedSubs[0].hub_sync_status === 'skipped';
        if (!isTerminal) {
          console.warn(`[RepairCASubscription] ⚠️ Refunded duplicate ${refunded_duplicate_stripe_sub} has unexpected status=${refundedStatus}. Admin should verify.`);
        } else {
          console.log(`[RepairCASubscription] ✅ Refunded duplicate confirmed as terminal: status=${refundedStatus}`);
        }
      }
    }

    console.log(`[RepairCASubscription] ✅ Repair complete`);

    return Response.json({
      success: true,
      ca_subscription_id: caSubscription.id,
      stripe_subscription_id,
      stripe_subscription_status: stripeSubscription.status,
      stripe_customer_id: stripeSubscription.customer,
      customer_email,
      customer_name,
      plan_name,
      next_delivery_date,
      hub_order_id_linked: hub_order_id || null,
      hub_order_number_linked: hub_order_number || null,
      hub_sync_status: 'synced',
      loyalty_changed: false,
      hub_demand_created: false,
      message: 'CA Subscription repaired successfully. No new Hub demand created. Existing Hub orders remain operational.',
    });

  } catch (error) {
    console.error('[RepairCASubscription] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});