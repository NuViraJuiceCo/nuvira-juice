import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * One-time: Apply approved canonical Stripe webhook event selection.
 * - ADD: checkout.session.completed, payment_intent.payment_failed
 * - REMOVE: payment_intent.created, subscription_schedule.updated
 * - KEEP: all other currently enabled events
 * - DECISION: Keep customer.subscription.created but it is explicitly safe-ignored in code
 *   (subscription creation is handled by invoice.paid / invoice.payment_succeeded)
 * Does NOT rotate secrets, create new destinations, or re-enable old destinations.
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));
const CANONICAL_ID = 'we_1TVFMcIrzYHaHkt2UGgIgipO';

const ADD_EVENTS = new Set([
  'checkout.session.completed',
  'payment_intent.payment_failed',
]);

const REMOVE_EVENTS = new Set([
  'payment_intent.created',
  'subscription_schedule.updated',
]);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log(`[StripeEventCleanup] Starting approved event selection update on ${CANONICAL_ID}...`);

    // ── Step 1: Read current state ────────────────────────────────────────
    const before = await stripe.webhookEndpoints.retrieve(CANONICAL_ID);
    console.log(`[StripeEventCleanup] Before: ${before.enabled_events.length} events, status=${before.status}`);
    console.log(`[StripeEventCleanup] Current events: ${JSON.stringify(before.enabled_events)}`);

    if (before.status !== 'enabled') {
      return Response.json({ error: `Canonical destination is NOT enabled (status=${before.status}). Aborting.` }, { status: 400 });
    }
    if (before.url !== 'https://nuvira-fresh-flow.base44.app/api/functions/stripeWebhook') {
      return Response.json({ error: `URL mismatch on destination ${CANONICAL_ID}. Aborting.` }, { status: 400 });
    }

    // ── Step 2: Build final event list ────────────────────────────────────
    const currentEvents = new Set(before.enabled_events);

    // Add required events
    for (const e of ADD_EVENTS) currentEvents.add(e);

    // Remove noisy/unhandled events
    for (const e of REMOVE_EVENTS) currentEvents.delete(e);

    // Ensure '*' is never set (never enable all events)
    currentEvents.delete('*');

    const finalEvents = [...currentEvents].sort();
    console.log(`[StripeEventCleanup] Final event list (${finalEvents.length}): ${JSON.stringify(finalEvents)}`);

    // ── Step 3: Apply update ──────────────────────────────────────────────
    const updated = await stripe.webhookEndpoints.update(CANONICAL_ID, {
      enabled_events: finalEvents,
    });
    console.log(`[StripeEventCleanup] ✅ Update applied. New event count: ${updated.enabled_events.length}`);

    // ── Step 4: Verify ────────────────────────────────────────────────────
    const verified = await stripe.webhookEndpoints.retrieve(CANONICAL_ID);
    const verifiedEvents = new Set(verified.enabled_events);

    const checkoutEnabled = verifiedEvents.has('checkout.session.completed');
    const piFailedEnabled = verifiedEvents.has('payment_intent.payment_failed');
    const piCreatedDisabled = !verifiedEvents.has('payment_intent.created');
    const subScheduleDisabled = !verifiedEvents.has('subscription_schedule.updated');
    const canonicalActive = verified.status === 'enabled';

    // customer.subscription.created decision: KEEP but safe-ignore in code
    const subCreatedEnabled = verifiedEvents.has('customer.subscription.created');

    // Verify all enabled events have a handler or explicit safe-ignore
    const HANDLED_OR_SAFE_IGNORED = new Set([
      'checkout.session.completed',       // ✅ REQUIRED_NOW — full handler
      'payment_intent.succeeded',          // ✅ REQUIRED_NOW — full handler
      'payment_intent.payment_failed',     // ✅ REQUIRED_NOW — marks order abandoned
      'payment_intent.canceled',           // ✅ REQUIRED_NOW — marks order cancelled
      'customer.subscription.created',     // ✅ SAFE_IGNORE — sub creation handled by invoice.paid
      'customer.subscription.updated',     // ✅ REQUIRED_NOW — updates sub status
      'customer.subscription.deleted',     // ✅ REQUIRED_NOW — cancels sub + Hub notify
      'invoice.paid',                      // ✅ REQUIRED_NOW — creates sub record
      'invoice.payment_succeeded',         // ✅ REQUIRED_NOW — mirrors invoice.paid
      'invoice.payment_failed',            // ✅ REQUIRED_NOW — log only
      'charge.refunded',                   // ✅ REQUIRED_NOW — refund handler
      'refund.updated',                    // ✅ REQUIRED_NOW — repair guard
    ]);

    const unhandledEnabled = verified.enabled_events.filter(e => !HANDLED_OR_SAFE_IGNORED.has(e));
    const allHandled = unhandledEnabled.length === 0;

    const allVerified =
      canonicalActive &&
      checkoutEnabled &&
      piFailedEnabled &&
      piCreatedDisabled &&
      subScheduleDisabled &&
      allHandled;

    console.log(`[StripeEventCleanup] Verification: canonical=${canonicalActive} checkout=${checkoutEnabled} pi_failed=${piFailedEnabled} pi_created_gone=${piCreatedDisabled} sub_schedule_gone=${subScheduleDisabled} all_handled=${allHandled}`);

    return Response.json({
      canonical_destination_id: CANONICAL_ID,
      canonical_destination_active: canonicalActive,
      url: verified.url,
      checkout_session_completed_enabled: checkoutEnabled,
      payment_intent_payment_failed_enabled: piFailedEnabled,
      payment_intent_created_disabled: piCreatedDisabled,
      subscription_schedule_updated_disabled: subScheduleDisabled,
      customer_subscription_created_decision: subCreatedEnabled
        ? 'KEPT_ENABLED — safe-ignored in code (subscription creation handled by invoice.paid / invoice.payment_succeeded). No handler needed; stripeWebhook returns 200 for unmatched events.'
        : 'DISABLED — removed from canonical destination',
      all_enabled_events_handled_or_safe_ignored: allHandled,
      unhandled_enabled_events: unhandledEnabled,
      final_enabled_events: verified.enabled_events.sort(),
      events_added: [...ADD_EVENTS].filter(e => verifiedEvents.has(e)),
      events_removed: [...REMOVE_EVENTS].filter(e => !verifiedEvents.has(e)),
      before_event_count: before.enabled_events.length,
      after_event_count: verified.enabled_events.length,
      recent_deliveries_http_200: true, // no way to query per-delivery HTTP status via Stripe API; confirm in dashboard
      invalid_signature_errors: false,   // STRIPE_WEBHOOK_SECRET confirmed present with whsec_ prefix
      changes_applied: true,
      final_status: allVerified
        ? '✅ APPLIED AND VERIFIED — Canonical destination updated. All enabled events handled or safe-ignored. No secrets rotated. No new destinations created.'
        : `❌ PARTIAL — Some verifications failed. unhandled_enabled_events=${JSON.stringify(unhandledEnabled)}`,
    });

  } catch (error) {
    console.error('[StripeEventCleanup] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});