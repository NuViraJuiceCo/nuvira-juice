import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * cancelIncompleteSubscriptions
 *
 * Scheduled cleanup: cancels Stripe subscriptions that were created in
 * `default_incomplete` state but never had payment completed.
 *
 * Stripe automatically expires incomplete subscriptions after 23 hours by default,
 * but this function provides an explicit cleanup path and marks
 * PendingSubscriptionCheckout records as `failed` so the database stays clean.
 *
 * Run this on a schedule (e.g. every 4 hours).
 * Only admin can invoke manually.
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Allow scheduled (no auth) or admin-only manual invocations
    let isScheduled = false;
    try {
      const user = await base44.auth.me();
      if (user?.role !== 'admin') {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } catch {
      // No auth header — assume called by automation/scheduler
      isScheduled = true;
    }

    const cutoffMs = 2 * 60 * 60 * 1000; // 2 hours — subscriptions incomplete for >2h get cancelled
    const cutoffTimestamp = Math.floor((Date.now() - cutoffMs) / 1000); // Unix seconds for Stripe

    console.log(`[CleanupIncomplete] Running cleanup for incomplete subscriptions created before ${new Date(cutoffTimestamp * 1000).toISOString()}`);

    // Fetch all incomplete Stripe subscriptions (Stripe expires them at 23h, but we clean up at 2h)
    let cancelled = 0;
    let errors = 0;
    let startingAfter = undefined;

    while (true) {
      const params = {
        status: 'incomplete',
        limit: 100,
        created: { lt: cutoffTimestamp },
      };
      if (startingAfter) params.starting_after = startingAfter;

      const subscriptions = await stripe.subscriptions.list(params);

      for (const sub of subscriptions.data) {
        // Only cancel subscriptions created by this app
        if (sub.metadata?.source_app !== 'customer_app') continue;

        try {
          await stripe.subscriptions.cancel(sub.id);
          console.log(`[CleanupIncomplete] Cancelled incomplete subscription ${sub.id} for ${sub.metadata?.customer_email}`);
          cancelled++;

          // Mark PendingSubscriptionCheckout as failed
          const pendingId = sub.metadata?.pending_subscription_checkout_id;
          if (pendingId) {
            await base44.asServiceRole.entities.PendingSubscriptionCheckout.update(pendingId, {
              status: 'failed',
              error_message: 'Subscription incomplete — payment not completed within 2 hours. Auto-cancelled.',
            }).catch(err => console.warn(`[CleanupIncomplete] Failed to update pending checkout ${pendingId}: ${err.message}`));
          }
        } catch (err) {
          console.error(`[CleanupIncomplete] Failed to cancel ${sub.id}: ${err.message}`);
          errors++;
        }
      }

      if (!subscriptions.has_more) break;
      startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
    }

    console.log(`[CleanupIncomplete] Done. Cancelled: ${cancelled}, Errors: ${errors}`);
    return Response.json({ success: true, cancelled, errors, cutoff: new Date(cutoffTimestamp * 1000).toISOString() });

  } catch (error) {
    console.error('[CleanupIncomplete] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});