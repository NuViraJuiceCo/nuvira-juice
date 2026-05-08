import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

const OLD_SUB_ID = 'sub_1TUah0IrzYHaHkt24AVgUtNY';
const NEW_SUB_ID = 'sub_1TUsq1IrzYHaHkt2JnjTdP5a';
const PI_PAID    = 'pi_3TUsq2IrzYHaHkt22btoVsMf';
const CUSTOMER_EMAIL = 'amark@nuvisionarymedia.com';
const AMOUNT_PAID = 144;
const POINTS_TO_AWARD = 1440;
const EXISTING_CA_SUB_ID = '69fd1b7e5994d9b6bfbafeaf';
const PENDING_CHECKOUT_ID = '69fe26d514bbc6b1415ad7f2';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin only' }, { status: 403 });
    }

    const results = {};

    // ── STEP 1: Cancel old Stripe subscription (no refund) ──────────────────
    console.log('[canonicalize] Step 1: Cancelling old Stripe subscription', OLD_SUB_ID);
    try {
      const cancelResult = await stripe.subscriptions.cancel(OLD_SUB_ID, {
        prorate: false,
        invoice_now: false,
      });
      results.stripe_cancel = {
        id: cancelResult.id,
        status: cancelResult.status,
        canceled_at: cancelResult.canceled_at ? new Date(cancelResult.canceled_at * 1000).toISOString() : null,
      };
      console.log('[canonicalize] Old sub cancelled:', cancelResult.status);
    } catch (err) {
      results.stripe_cancel = { error: err.message };
      console.error('[canonicalize] Failed to cancel old sub:', err.message);
    }

    // ── STEP 2: Fetch current CA subscription record ─────────────────────────
    const existingSubRecords = await base44.asServiceRole.entities.Subscription.filter({ id: EXISTING_CA_SUB_ID });
    const existingSub = existingSubRecords[0];
    results.ca_sub_before = existingSub ? {
      id: existingSub.id,
      stripe_subscription_id: existingSub.data?.stripe_subscription_id || existingSub.stripe_subscription_id,
      status: existingSub.data?.status || existingSub.status,
      hub_sync_status: existingSub.data?.hub_sync_status || existingSub.hub_sync_status,
    } : null;

    // ── STEP 3: Update CA Subscription record to point to new canonical sub ──
    console.log('[canonicalize] Step 3: Updating CA Subscription to new stripe sub ID');
    const pendingCheckoutData = (await base44.asServiceRole.entities.PendingSubscriptionCheckout.filter({ id: PENDING_CHECKOUT_ID }))[0];

    await base44.asServiceRole.entities.Subscription.update(EXISTING_CA_SUB_ID, {
      stripe_subscription_id: NEW_SUB_ID,
      stripe_customer_id: 'cus_UTTa07PlEGr4SH',
      status: 'active',
      started_date: '2026-05-09',
      next_delivery_date: '2026-06-09',
      delivery_address: '206 West Pine Creek Ct, Wentzville, MO, 63385',
      delivery_zone_id: '69dff325e191695828ee96a3',
      hub_sync_status: 'pending',
      description: `Monthly Ritual — 1x AURA, 1x RE-NU, 1x OASIS per weekly fulfillment. Canonicalized 2026-05-08: replaced old duplicate stripe sub ${OLD_SUB_ID} with new paid sub ${NEW_SUB_ID}. Old sub cancelled in Stripe to prevent double billing. PI: ${PI_PAID}.`,
    });
    results.ca_sub_update = { success: true, new_stripe_sub_id: NEW_SUB_ID };
    console.log('[canonicalize] CA Subscription updated to new sub ID');

    // ── STEP 4: Award loyalty points (idempotent) ────────────────────────────
    console.log('[canonicalize] Step 4: Checking loyalty points idempotency');
    const pointsRecs = await base44.asServiceRole.entities.UserPoints.filter({ customer_email: CUSTOMER_EMAIL });
    const pointsRec = pointsRecs[0];

    const alreadyAwarded = pointsRec?.points_history?.some(h =>
      h.description?.includes(`subscription ${NEW_SUB_ID}`) ||
      h.description?.includes(PI_PAID)
    );

    if (alreadyAwarded) {
      results.loyalty = { action: 'skipped_already_awarded', message: `Points for ${NEW_SUB_ID} already exist` };
      console.log('[canonicalize] Loyalty points already awarded, skipping');
    } else {
      const entry = {
        amount: POINTS_TO_AWARD,
        type: 'earned',
        description: `Subscription payment of $${AMOUNT_PAID.toFixed(2)} (subscription ${NEW_SUB_ID}) — canonicalized repair 2026-05-08`,
        timestamp: new Date().toISOString(),
      };
      if (pointsRec) {
        await base44.asServiceRole.entities.UserPoints.update(pointsRec.id, {
          total_points: (pointsRec.total_points || 0) + POINTS_TO_AWARD,
          lifetime_points: (pointsRec.lifetime_points || 0) + POINTS_TO_AWARD,
          points_history: [...(pointsRec.points_history || []), entry],
        });
        results.loyalty = {
          action: 'awarded',
          points_added: POINTS_TO_AWARD,
          new_total: (pointsRec.total_points || 0) + POINTS_TO_AWARD,
          new_lifetime: (pointsRec.lifetime_points || 0) + POINTS_TO_AWARD,
        };
        console.log(`[canonicalize] Awarded ${POINTS_TO_AWARD} pts to ${CUSTOMER_EMAIL}`);
      } else {
        results.loyalty = { action: 'error', message: 'UserPoints record not found' };
      }
    }

    // ── STEP 5: Mark PendingSubscriptionCheckout as completed ────────────────
    console.log('[canonicalize] Step 5: Marking PendingSubscriptionCheckout as completed');
    await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(PENDING_CHECKOUT_ID, {
      status: 'completed',
      completed_at: new Date().toISOString(),
      stripe_subscription_id: NEW_SUB_ID,
      error_message: null,
      notes: `Canonicalized repair 2026-05-08: payment confirmed PI ${PI_PAID}, $${AMOUNT_PAID} paid. Old sub ${OLD_SUB_ID} cancelled in Stripe.`,
    });
    results.pending_checkout = { action: 'marked_completed', id: PENDING_CHECKOUT_ID };
    console.log('[canonicalize] PendingSubscriptionCheckout marked completed');

    // ── STEP 6: Build Hub payload and sync ───────────────────────────────────
    console.log('[canonicalize] Step 6: Syncing corrected subscription to Hub');

    const products = [
      { product_name: 'AURA', quantity: 1 },
      { product_name: 'RE-NU', quantity: 1 },
      { product_name: 'OASIS', quantity: 1 },
    ];

    const hubPayload = {
      event: 'customer.subscription_created',
      event_type: 'customer.subscription_created',
      source: 'customer_app',
      customer_email: CUSTOMER_EMAIL,
      data: {
        // IDs — use canonical CA sub record ID and new Stripe sub
        subscription_id: EXISTING_CA_SUB_ID,
        customer_app_subscription_id: EXISTING_CA_SUB_ID,
        stripe_subscription_id: NEW_SUB_ID,
        stripe_customer_id: 'cus_UTTa07PlEGr4SH',
        payment_intent_id: PI_PAID,
        // Replaced sub reference for Hub deduplication
        replaced_stripe_subscription_id: OLD_SUB_ID,
        // Customer
        customer_name: 'Amar Kahlon',
        customer_email: CUSTOMER_EMAIL,
        phone: '',
        // Payment
        payment_status: 'paid',
        financial_status: 'paid',
        // Plan
        plan_id: '69dff325e191695828ee96a1',
        plan_name: 'Monthly Ritual',
        billing_cadence: 'monthly',
        fulfillment_cadence: 'weekly',
        fulfillments_per_cycle: 4,
        fulfillment_number: 1,
        // Order type
        order_type: 'subscription',
        source_type: 'subscription_fulfillment',
        // Dates from PendingSubscriptionCheckout
        production_date: '2026-05-08',
        first_delivery_date: '2026-05-09',
        next_delivery_date: '2026-06-09',
        subscription_started_date: '2026-05-09',
        // Delivery window
        delivery_window_label: '5 PM – 8 PM',
        delivery_window_start: '17:00',
        delivery_window_end: '20:00',
        // Address
        delivery_address: '206 West Pine Creek Ct, Wentzville, MO, 63385',
        address_line1: '206 West Pine Creek Ct',
        address_line2: '',
        address_city: 'Wentzville',
        address_state: 'MO',
        address_postal_code: '63385',
        address_country: 'US',
        delivery_zone_id: '69dff325e191695828ee96a3',
        // Products — decomposed weekly, NOT monthly totals
        products,
        items_summary: '1x AURA, 1x RE-NU, 1x OASIS',
        // Canonicalization metadata for Hub deduplication
        canonicalization_note: `Replaced old sub ${OLD_SUB_ID} with new paid sub ${NEW_SUB_ID}. Use customer_app_subscription_id for dedup.`,
      },
    };

    let hubResult = {};
    try {
      const hubResp = await base44.asServiceRole.functions.invoke('syncCustomerToHub', hubPayload);
      hubResult = {
        success: true,
        response: hubResp?.data || hubResp,
      };
      console.log('[canonicalize] Hub sync result:', JSON.stringify(hubResult));

      // Update CA sub hub_sync_status
      await base44.asServiceRole.entities.Subscription.update(EXISTING_CA_SUB_ID, {
        hub_sync_status: 'synced',
        hub_synced_at: new Date().toISOString(),
      });
    } catch (hubErr) {
      hubResult = { success: false, error: hubErr.message };
      console.error('[canonicalize] Hub sync failed:', hubErr.message);
      await base44.asServiceRole.entities.Subscription.update(EXISTING_CA_SUB_ID, {
        hub_sync_status: 'failed',
        hub_sync_error: hubErr.message,
      });
    }
    results.hub_sync = hubResult;

    // ── STEP 7: Final verification ───────────────────────────────────────────
    console.log('[canonicalize] Step 7: Final verification');
    const [verifyStripeOld, verifyStripeNew, verifyCA, verifyPoints] = await Promise.all([
      stripe.subscriptions.retrieve(OLD_SUB_ID).catch(e => ({ error: e.message })),
      stripe.subscriptions.retrieve(NEW_SUB_ID).catch(e => ({ error: e.message })),
      base44.asServiceRole.entities.Subscription.filter({ customer_email: CUSTOMER_EMAIL }),
      base44.asServiceRole.entities.UserPoints.filter({ customer_email: CUSTOMER_EMAIL }),
    ]);

    const activeCASubsCount = (verifyCA || []).filter(s => (s.data?.status || s.status) === 'active').length;
    const currentPoints = verifyPoints[0];
    const pointsForNewSub = currentPoints?.points_history?.filter(h =>
      h.description?.includes(`subscription ${NEW_SUB_ID}`)
    ) || [];

    results.verification = {
      stripe_old_sub_status: verifyStripeOld.status || verifyStripeOld.error,
      stripe_new_sub_status: verifyStripeNew.status || verifyStripeNew.error,
      active_ca_subscriptions_count: activeCASubsCount,
      ca_sub_stripe_id: (verifyCA || []).find(s => (s.data?.status || s.status) === 'active')?.data?.stripe_subscription_id || null,
      total_points: currentPoints?.total_points || 0,
      lifetime_points: currentPoints?.lifetime_points || 0,
      loyalty_entries_for_new_sub: pointsForNewSub.length,
      pending_checkout_id: PENDING_CHECKOUT_ID,
      pass: (
        (verifyStripeOld.status === 'canceled') &&
        (verifyStripeNew.status === 'active') &&
        (activeCASubsCount === 1) &&
        (pointsForNewSub.length === 1)
      ),
    };

    console.log('[canonicalize] ✅ Complete. Pass:', results.verification.pass);
    return Response.json({ success: true, results });

  } catch (err) {
    console.error('[canonicalizeAmarkSubscription] Fatal error:', err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
});