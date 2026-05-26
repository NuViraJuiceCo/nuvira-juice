import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import Stripe from 'npm:stripe@14.21.0';

/**
 * READ-ONLY audit: Full Customer App integration inventory and Stripe event coverage matrix.
 * No mutations, no secret exposure, no record changes.
 */

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

// Events implemented in stripeWebhook (extracted from code analysis)
const IMPLEMENTED_HANDLERS = [
  'checkout.session.completed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'invoice.payment_succeeded',
  'invoice.paid',
  'invoice.payment_failed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'charge.refunded',
  'refund.updated',
];

// Events we consider REQUIRED for production correctness
const REQUIRED_EVENTS = new Set([
  'checkout.session.completed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'charge.refunded',
  'refund.updated',
]);

// Events that are optional/future-only
const OPTIONAL_FUTURE_EVENTS = new Set([
  'checkout.session.expired',
  'customer.created',
  'customer.updated',
  'payment_method.attached',
  'payment_method.updated',
  'invoice.upcoming',
  'invoice.finalization_failed',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
]);

// Idempotency protections per handler (from code analysis)
const IDEMPOTENCY_NOTES = {
  'checkout.session.completed': 'Deduped by stripe_checkout_session_id on Order; stripe_subscription_id on Subscription',
  'payment_intent.succeeded': 'Deduped by stripe_payment_intent_id on Order; terminal-state guard prevents resurrection',
  'payment_intent.payment_failed': 'Only acts on unpaid orders (payment_captured=false)',
  'payment_intent.canceled': 'Only acts on orders with matching PI id',
  'invoice.payment_succeeded': 'Deduped by stripe_subscription_id; retires duplicates; terminal-state guard',
  'invoice.paid': 'Same dedup as invoice.payment_succeeded; mirrors that handler',
  'invoice.payment_failed': 'Read-only log — no mutation risk',
  'customer.subscription.updated': 'Matched by stripe_subscription_id only; terminal-state guard blocks cancelled→active resurrection',
  'customer.subscription.deleted': 'Matched by stripe_subscription_id only',
  'charge.refunded': 'Routes to subscription path first (by PI→invoice→sub), then one-time order; idempotency by order.status===refunded check',
  'refund.updated': 'Repair guard only — promotes non-terminal orders to refunded if refund.status=succeeded',
};

// What each handler creates/updates
const HANDLER_MUTATIONS = {
  'checkout.session.completed': ['Order (create)', 'Subscription (create)', 'UserPoints (create/update)', 'NuViraCredit (deduct)', 'PendingSubscriptionCheckout (update)', 'OrderSyncLog (on error)', '→ syncOrderToHub', '→ syncSubscriptionWithFulfillments', '→ pushOrderToShopify', '→ sendOrderReceivedNotification', '→ notifyOrderProcessed', '→ sendOrderSms'],
  'payment_intent.succeeded': ['Order (update: finalize payment)', 'UserPoints (create/update)', 'NuViraCredit (deduct)', 'OrderSyncLog (on error)', '→ syncOrderToHub', '→ pushOrderToShopify', '→ sendOrderReceivedNotification', '→ notifyOrderProcessed', '→ sendOrderSms'],
  'payment_intent.payment_failed': ['Order (update: mark abandoned/cancelled)'],
  'payment_intent.canceled': ['Order (update: mark cancelled)', 'OperationalAlert (create)'],
  'invoice.payment_succeeded': ['Subscription (create)', 'UserPoints (create/update)', 'PendingSubscriptionCheckout (update)', 'OrderSyncLog (on error)', '→ syncSubscriptionWithFulfillments'],
  'invoice.paid': ['Subscription (create)', 'UserPoints (create/update)', 'PendingSubscriptionCheckout (update)', 'OrderSyncLog (on error)', '→ syncSubscriptionWithFulfillments'],
  'invoice.payment_failed': ['OrderSyncLog (create — log only)'],
  'customer.subscription.updated': ['Subscription (update: status, next_delivery_date)'],
  'customer.subscription.deleted': ['Subscription (update: status→cancelled)', '→ syncCustomerToHub (cancel event)'],
  'charge.refunded': ['Subscription (update: status→cancelled) OR Order (update: status→refunded)', 'UserPoints (reverse/adjust)', 'OrderSyncLog (create)', '→ syncCustomerToHub OR syncRefundToHub'],
  'refund.updated': ['Order (update: promote to refunded if not terminal)'],
};

// Terminal-state guards analysis
const TERMINAL_GUARDS = {
  'checkout.session.completed': true,
  'payment_intent.succeeded': true,
  'payment_intent.payment_failed': false, // only checks payment_captured=false
  'payment_intent.canceled': false,
  'invoice.payment_succeeded': true,
  'invoice.paid': true,
  'invoice.payment_failed': false, // log only
  'customer.subscription.updated': true, // blocks cancelled→active
  'customer.subscription.deleted': false,
  'charge.refunded': true, // idempotency by status===refunded
  'refund.updated': true, // repair guard checks isAlreadyTerminal
};

Deno.serve(async (req) => {
  try {
    if (Deno.env.get('ENABLE_LEGACY_PAYMENT_SUBSCRIPTION_TOOLS') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'legacy_payment_subscription_tools_disabled',
        message: 'Legacy payment/subscription tools are disabled for May 30 launch freeze.',
      }, { status: 409 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    console.log('[AuditIntegration] Starting read-only audit...');

    // ── 1. Fetch all Stripe webhook destinations ──────────────────────────
    const webhookEndpoints = await stripe.webhookEndpoints.list({ limit: 20 });
    const CANONICAL_URL = 'https://nuvira-fresh-flow.base44.app/api/functions/stripeWebhook';

    const destinations = webhookEndpoints.data.map(ep => ({
      id: ep.id,
      url: ep.url,
      status: ep.status,
      enabled_events: ep.enabled_events,
      is_canonical: ep.url === CANONICAL_URL,
      api_version: ep.api_version,
      created: new Date(ep.created * 1000).toISOString(),
      livemode: ep.livemode,
    }));

    const canonicalDest = destinations.find(d => d.is_canonical && d.status === 'enabled');
    const duplicateActiveDests = destinations.filter(d => d.is_canonical && d.status === 'enabled');
    const disabledDests = destinations.filter(d => d.is_canonical && d.status === 'disabled');
    const nonCanonicalDests = destinations.filter(d => !d.is_canonical);

    console.log(`[AuditIntegration] Found ${destinations.length} webhook destinations total`);
    console.log(`[AuditIntegration] Canonical active: ${duplicateActiveDests.length}, disabled: ${disabledDests.length}, non-canonical: ${nonCanonicalDests.length}`);

    // ── 2. Recent delivery logs for canonical destination ─────────────────
    let recentDeliveries = [];
    let deliverySummary = { total: 0, http200: 0, http400: 0, http500: 0, retries: 0 };
    if (canonicalDest) {
      try {
        const deliveryAttempts = await stripe.webhookEndpoints.retrieve(canonicalDest.id);
        // Note: Stripe API doesn't expose delivery logs directly; we check via event list
        const recentEvents = await stripe.events.list({ limit: 20, delivery_success: false });
        recentDeliveries = recentEvents.data.map(e => ({
          id: e.id,
          type: e.type,
          created: new Date(e.created * 1000).toISOString(),
          pending_webhooks: e.pending_webhooks,
          request: e.request?.id || null,
        }));
        deliverySummary.total = recentEvents.data.length;
        deliverySummary.pending_retries = recentEvents.data.filter(e => e.pending_webhooks > 0).length;
      } catch (err) {
        console.warn(`[AuditIntegration] Could not fetch delivery logs: ${err.message}`);
      }
    }

    // ── 3. Confirm STRIPE_WEBHOOK_SECRET exists (do NOT print value) ─────
    const webhookSecretExists = !!Deno.env.get('STRIPE_WEBHOOK_SECRET');
    const webhookSecretLength = Deno.env.get('STRIPE_WEBHOOK_SECRET')?.length || 0;
    const webhookSecretPrefix = Deno.env.get('STRIPE_WEBHOOK_SECRET')?.startsWith('whsec_') ? 'whsec_...' : 'WRONG_PREFIX';

    // ── 4. Check recent OrderSyncLog for webhook errors ───────────────────
    const recentSyncLogs = await base44.asServiceRole.entities.OrderSyncLog.list('-completed_at', 20);
    const errorLogs = recentSyncLogs.filter(l => l.status === 'error');
    const successLogs = recentSyncLogs.filter(l => l.status === 'success');
    const skipLogs = recentSyncLogs.filter(l => l.status === 'skipped' || l.status === 'deduped');

    // ── 5. Event handler matrix ───────────────────────────────────────────
    const enabledEvents = canonicalDest?.enabled_events || [];
    const isAllEvents = enabledEvents.includes('*');

    const eventHandlerMatrix = IMPLEMENTED_HANDLERS.map(event => {
      const isEnabled = isAllEvents || enabledEvents.includes(event);
      const isRequired = REQUIRED_EVENTS.has(event);
      const isOptional = OPTIONAL_FUTURE_EVENTS.has(event);

      let classification;
      if (isEnabled && isRequired) classification = 'REQUIRED_NOW';
      else if (isEnabled && isOptional) classification = 'OPTIONAL_LATER';
      else if (isEnabled && !isRequired && !isOptional) classification = 'HANDLED_REVIEW_REQUIRED';
      else if (!isEnabled && isRequired) classification = 'MISSING_HANDLER';
      else if (!isEnabled) classification = 'HANDLED_BUT_NOT_ENABLED';
      else classification = 'UNKNOWN_REVIEW_REQUIRED';

      return {
        event,
        implemented_in_code: true,
        enabled_in_stripe: isEnabled,
        classification,
        idempotency: IDEMPOTENCY_NOTES[event] || 'Unknown',
        terminal_state_guard: TERMINAL_GUARDS[event] ?? false,
        mutations: HANDLER_MUTATIONS[event] || [],
        affects_hub_sync: (HANDLER_MUTATIONS[event] || []).some(m => m.includes('Hub') || m.includes('sync')),
        affects_loyalty: (HANDLER_MUTATIONS[event] || []).some(m => m.includes('UserPoints')),
        affects_orders: (HANDLER_MUTATIONS[event] || []).some(m => m.includes('Order')),
        affects_subscriptions: (HANDLER_MUTATIONS[event] || []).some(m => m.includes('Subscription')),
      };
    });

    // Events enabled in Stripe but not handled in code
    const enabledButUnhandled = enabledEvents.filter(e => e !== '*' && !IMPLEMENTED_HANDLERS.includes(e));

    // Events that should be enabled but aren't
    const missingRequired = [...REQUIRED_EVENTS].filter(e => !isAllEvents && !enabledEvents.includes(e));

    // Events handled but not enabled in Stripe
    const handledButNotEnabled = IMPLEMENTED_HANDLERS.filter(e => !isAllEvents && !enabledEvents.includes(e));

    // ── 6. Functions inventory ────────────────────────────────────────────
    // Classify all functions by role and risk
    const FUNCTION_INVENTORY = [
      // Payment/checkout
      { name: 'createPaymentIntent', role: 'payment', status: 'ACTIVE_REQUIRED', called_by: ['Checkout page'], risk: 'Creates Order + Stripe PI', can_create_order: true, can_create_sub: false, uses_central_schedule: true, uses_identity_resolver: false },
      { name: 'createSubscriptionPaymentElementIntent', role: 'payment', status: 'ACTIVE_REQUIRED', called_by: ['Subscribe page'], risk: 'Creates PendingCheckout + Stripe Subscription (incomplete)', can_create_order: false, can_create_sub: true, uses_central_schedule: true, uses_identity_resolver: false },
      { name: 'createSubscriptionSession', role: 'payment', status: 'LEGACY_CHECK_USAGE', called_by: ['Unknown - older Subscribe path'], risk: 'May create duplicate subscription paths', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'createSubscriptionCheckoutHosted', role: 'payment', status: 'LEGACY_CHECK_USAGE', called_by: ['Unknown - older hosted checkout'], risk: 'Hosted redirect - may bypass payment element flow', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'createSubscriptionPaymentIntent', role: 'payment', status: 'LEGACY_SUPERSEDED', called_by: ['Superseded by createSubscriptionPaymentElementIntent'], risk: 'Old version - check if still called from frontend', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'createSubscriptionPaymentIntentV2', role: 'payment', status: 'LEGACY_SUPERSEDED', called_by: ['V2 - check if frontend calls this vs V3'], risk: 'Old version', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'createCheckoutSession', role: 'payment', status: 'ACTIVE_REQUIRED', called_by: ['Checkout page - one-time orders'], risk: 'Creates CheckoutSession record + Stripe session', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },

      // Webhook
      { name: 'stripeWebhook', role: 'webhook', status: 'ACTIVE_REQUIRED', called_by: ['Stripe'], risk: 'Master event handler - creates Orders, Subscriptions, UserPoints', can_create_order: true, can_create_sub: true, uses_central_schedule: true, uses_identity_resolver: false },

      // Schedule
      { name: 'calculateNuViraFulfillmentSchedule', role: 'schedule', status: 'ACTIVE_REQUIRED', called_by: ['stripeWebhook', 'createPaymentIntent', 'createSubscriptionPaymentElementIntent'], risk: 'Central source of truth for dates', can_create_order: false, can_create_sub: false, uses_central_schedule: true, uses_identity_resolver: false },
      { name: 'assignProductionWindow', role: 'schedule', status: 'LEGACY_OR_ADMIN', called_by: ['Admin use only?'], risk: 'Manual production assignment', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'assignDeliveryWindow', role: 'schedule', status: 'LEGACY_OR_ADMIN', called_by: ['Admin use only?'], risk: 'Manual delivery assignment', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'testSchedulingLogic', role: 'schedule', status: 'DEBUG_ONLY', called_by: ['Manual testing'], risk: 'Non-mutating', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },

      // Hub sync
      { name: 'syncOrderToHub', role: 'hub_sync', status: 'ACTIVE_REQUIRED', called_by: ['stripeWebhook', 'retryFailedHubSyncs'], risk: 'Sends order to Hub; blocked for unpaid/abandoned', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'syncSubscriptionWithFulfillments', role: 'hub_sync', status: 'ACTIVE_REQUIRED', called_by: ['stripeWebhook', 'retryFailedHubSyncs'], risk: 'Sends 4-fulfillment subscription payload to Hub', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'syncCustomerToHub', role: 'hub_sync', status: 'ACTIVE_REQUIRED', called_by: ['stripeWebhook (cancel events)', 'cancelSubscriptionFutureRenewal'], risk: 'Sends customer events (cancel, subscription events)', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'syncRefundToHub', role: 'hub_sync', status: 'ACTIVE_REQUIRED', called_by: ['stripeWebhook (charge.refunded)'], risk: 'Sends refund event to Hub', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'retryFailedHubSyncs', role: 'hub_sync', status: 'ACTIVE_REQUIRED', called_by: ['Scheduled automation'], risk: 'Idempotent retry; terminal-state aware', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'syncOrdersFromHub', role: 'hub_sync', status: 'LEGACY_OR_POLLER', called_by: ['Scheduled poll?'], risk: 'Pulls orders from Hub into CA', can_create_order: true, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'syncSubscriptionFromHub', role: 'hub_sync', status: 'LEGACY_OR_POLLER', called_by: ['Scheduled poll?'], risk: 'Pulls sub from Hub', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'syncAllSubscriptionsFromHub', role: 'hub_sync', status: 'LEGACY_OR_ADMIN', called_by: ['Admin trigger?'], risk: 'Bulk pull - could create duplicate subscriptions if not guarded', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'manualSyncOrders', role: 'hub_sync', status: 'ADMIN_TOOL', called_by: ['Admin panel'], risk: 'Manual trigger - check for guards', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'manualSyncSubscription', role: 'hub_sync', status: 'ADMIN_TOOL', called_by: ['Admin panel'], risk: 'Manual trigger - check for guards', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'hubSyncProxy', role: 'hub_sync', status: 'LEGACY_OR_PROXY', called_by: ['Internal proxy?'], risk: 'Review if still used', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },

      // Subscription management
      { name: 'cancelSubscriptionFutureRenewal', role: 'subscription', status: 'ACTIVE_REQUIRED', called_by: ['SubscriptionManagement page'], risk: 'Sets cancel_at_period_end on Stripe; no immediate cancel', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'pauseSubscription', role: 'subscription', status: 'ACTIVE_REQUIRED', called_by: ['SubscriptionManagement page'], risk: 'Updates paused_until date', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'stripeCustomerPortal', role: 'subscription', status: 'ACTIVE_REQUIRED', called_by: ['SubscriptionManagement page'], risk: 'Redirects to Stripe billing portal', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'adminCancelAndRefundSubscription', role: 'subscription', status: 'ADMIN_TOOL', called_by: ['Admin panel'], risk: 'HIGH: cancels + refunds; check terminal guards', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },

      // Repair functions
      { name: 'repairMissingCASubscriptionFromStripeAndHub', role: 'repair', status: 'REPAIR_KEEP_TEMPORARY', called_by: ['createSubscriptionPaymentElementIntent (background)', 'Admin'], risk: 'Creates CA Subscription only if missing; uses hub_sync_status=skipped to prevent double sync', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'repairLiveSubscriptionV2', role: 'repair', status: 'REPAIR_RETIRE_AFTER_STABLE', called_by: ['Admin only'], risk: 'One-time repair tool', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'repairLiveSubscriptionFailure', role: 'repair', status: 'REPAIR_RETIRE_AFTER_STABLE', called_by: ['Admin only'], risk: 'One-time repair tool', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'repairMissingSubscriptionForPaidInvoice', role: 'repair', status: 'REPAIR_KEEP_TEMPORARY', called_by: ['Admin only'], risk: 'Reconciliation tool', can_create_order: false, can_create_sub: true, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'repairR1DeepaCAPatch', role: 'repair', status: 'ONE_TIME_RETIRE', called_by: ['Admin - one time'], risk: 'One-time historical fix', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'repairR2RefundedDuplicatesCA', role: 'repair', status: 'ONE_TIME_RETIRE', called_by: ['Admin - one time'], risk: 'One-time historical fix', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'repairR3HenrryCAHydration', role: 'repair', status: 'ONE_TIME_RETIRE', called_by: ['Admin - one time'], risk: 'One-time historical fix', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'repairR4SukhwantCAStructure', role: 'repair', status: 'ONE_TIME_RETIRE', called_by: ['Admin - one time'], risk: 'One-time historical fix', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'repairFulfillmentTaskAssignedDeliveryDates', role: 'repair', status: 'REPAIR_KEEP_TEMPORARY', called_by: ['Admin only'], risk: 'Updates FulfillmentTask dates', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },

      // Audit/debug
      { name: 'auditStabilizationRepair', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin - testing'], risk: 'Read-only audit', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'auditStripeAndIntegrationInventory', role: 'audit', status: 'THIS_FUNCTION', called_by: ['Admin - this run'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'verifyLiveSubscriptionSmoke', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin - post-payment verification'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'verifyStripeLiveMode', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'verifyHubEndpointReachability', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Sends test ping to Hub', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'auditSubscriptionPayloadToHub', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only diagnostic', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'auditSubscriptionFulfillments', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only diagnostic', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'auditNewSubscriptions', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'debugHubSyncPayload', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Sends test payload to Hub — note: NOT read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'debugAndRetryHubSync', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Sends retry to Hub', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'stabilizationDiagnostic', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'monitorPostPaymentChain', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'monitorLiveCheckoutTest', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'monitorSubscriptionLoyalty', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'listRecentPIs', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only Stripe query', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'inspectPaymentIntent', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only Stripe query', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'diagnosePiConfig', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'refundFlowDiagnostic', role: 'audit', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only diagnostic', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'auditAmarkSubscriptions', role: 'audit', status: 'ONE_TIME_RETIRE', called_by: ['One-time customer audit'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'auditLatestStripePaymentForAmark', role: 'audit', status: 'ONE_TIME_RETIRE', called_by: ['One-time'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'auditCustomerAppLoyaltyAfterPhase2', role: 'audit', status: 'ONE_TIME_RETIRE', called_by: ['One-time loyalty audit'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'auditWindow3Orders', role: 'audit', status: 'LEGACY_OR_ADMIN', called_by: ['Admin'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },

      // Identity resolver
      { name: 'findCustomerOrders', role: 'identity', status: 'ACTIVE_REQUIRED', called_by: ['Admin/internal lookup'], risk: 'Read-only query', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: true },
      { name: 'findCustomerSubscriptions', role: 'identity', status: 'ACTIVE_REQUIRED', called_by: ['Admin/internal lookup'], risk: 'Read-only query', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: true },

      // Loyalty
      { name: 'enrollNewCustomerInLoyalty', role: 'loyalty', status: 'ACTIVE_REQUIRED', called_by: ['Account setup or first order'], risk: 'Creates LoyaltyMember', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'claimReward', role: 'loyalty', status: 'ACTIVE_REQUIRED', called_by: ['Rewards page'], risk: 'Deducts UserPoints, marks reward claimed', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'reconcileCustomerLoyalty', role: 'loyalty', status: 'ADMIN_TOOL', called_by: ['Admin'], risk: 'Updates loyalty points - check idempotency', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'executeCustomerAppLoyaltyImportPhase2', role: 'loyalty', status: 'ONE_TIME_RETIRE', called_by: ['One-time import'], risk: 'Bulk mutation - retire', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'verifyCustomerFacingLoyaltyDisplay', role: 'loyalty', status: 'KEEP_DEBUG', called_by: ['Admin'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'syncLoyaltyToHub', role: 'loyalty', status: 'ACTIVE_OR_ADMIN', called_by: ['Admin or automation'], risk: 'Syncs loyalty to Hub', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'syncLoyaltyFromHub', role: 'loyalty', status: 'ACTIVE_OR_ADMIN', called_by: ['Admin or automation'], risk: 'Pulls loyalty from Hub', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'receivePointsSync', role: 'loyalty', status: 'ACTIVE_OR_WEBHOOK', called_by: ['Hub push?'], risk: 'Mutates UserPoints from Hub events', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'deactivateLoyaltyMembers', role: 'loyalty', status: 'ADMIN_TOOL', called_by: ['Admin'], risk: 'Bulk deactivation', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },

      // Notifications
      { name: 'sendOrderReceivedNotification', role: 'notification', status: 'ACTIVE_REQUIRED', called_by: ['stripeWebhook'], risk: 'Email notification only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'sendOrderSms', role: 'notification', status: 'ACTIVE_REQUIRED', called_by: ['stripeWebhook'], risk: 'SMS notification only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'notifyOrderProcessed', role: 'notification', status: 'ACTIVE_REQUIRED', called_by: ['stripeWebhook'], risk: 'Ops notification only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'sendUpcomingDeliveryNotifications', role: 'notification', status: 'ACTIVE_OR_SCHEDULED', called_by: ['Scheduled automation?'], risk: 'Notifications only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'sendOrderConfirmation', role: 'notification', status: 'LEGACY_CHECK_USAGE', called_by: ['Unknown - check if duplicate of sendOrderReceivedNotification'], risk: 'Possible duplicate email sender', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },

      // Shopify
      { name: 'pushOrderToShopify', role: 'shopify', status: 'ACTIVE_REQUIRED', called_by: ['stripeWebhook'], risk: 'Creates Shopify order', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'shopifyWebhookReceiver', role: 'shopify', status: 'ACTIVE_REQUIRED', called_by: ['Shopify webhooks'], risk: 'Processes Shopify events', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'shopifyResyncOrders', role: 'shopify', status: 'ADMIN_TOOL', called_by: ['Admin'], risk: 'Bulk resync', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },

      // Get/query functions
      { name: 'getCustomerOrdersWithHub', role: 'query', status: 'ACTIVE_REQUIRED', called_by: ['OrderHistory page (fallback)', 'OrderTracker page'], risk: 'Read-only Hub query merged with CA orders', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'getOrdersForSync', role: 'query', status: 'ACTIVE_OR_POLLER', called_by: ['Hub poller'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'getSubscriptionOrdersForSync', role: 'query', status: 'ACTIVE_OR_POLLER', called_by: ['Hub poller'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'getOrderBySession', role: 'query', status: 'ACTIVE_REQUIRED', called_by: ['OrderConfirmation page'], risk: 'Read-only', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
      { name: 'adminDashboardData', role: 'query', status: 'ADMIN_TOOL', called_by: ['Admin dashboard'], risk: 'Read-only aggregate', can_create_order: false, can_create_sub: false, uses_central_schedule: false, uses_identity_resolver: false },
    ];

    // ── 7. Identify dangerous mutation paths ─────────────────────────────
    const dangerousMutations = FUNCTION_INVENTORY.filter(f =>
      (f.can_create_order || f.can_create_sub) && f.status !== 'ACTIVE_REQUIRED'
    ).map(f => ({
      function: f.name,
      risk: f.risk,
      status: f.status,
      can_create_order: f.can_create_order,
      can_create_sub: f.can_create_sub,
      recommendation: f.status.includes('LEGACY') || f.status.includes('ONE_TIME')
        ? 'AUDIT_THEN_DISABLE — verify not called from any active page before retiring'
        : 'REVIEW_GUARDS — ensure terminal-state guards exist',
    }));

    // ── 8. Identity resolver gaps ─────────────────────────────────────────
    const identityGaps = [
      { location: 'pages/OrderHistory.jsx', issue: 'FIXED: Now uses getOrdersForCustomer() from identityResolver', status: 'RESOLVED' },
      { location: 'pages/OrderTracker.jsx', issue: 'FIXED: Now uses getOrdersForCustomer() in fallback path', status: 'RESOLVED' },
      { location: 'pages/Account.jsx', issue: 'FIXED: Now uses getSubscriptionsForCustomer() and getOrdersForCustomer()', status: 'RESOLVED' },
      { location: 'pages/SubscriptionManagement.jsx', issue: 'FIXED: Now uses getSubscriptionsForCustomer()', status: 'RESOLVED' },
      { location: 'pages/Rewards.jsx', issue: 'NEEDS_AUDIT: May filter UserPoints by user?.email only', status: 'PENDING_AUDIT' },
      { location: 'components/account/CreditWallet.jsx', issue: 'NEEDS_AUDIT: NuViraCredit query may use user?.email only', status: 'PENDING_AUDIT' },
      { location: 'getCustomerOrdersWithHub function', issue: 'NEEDS_AUDIT: Called with single customer_email — does not resolve aliases', status: 'PENDING_AUDIT' },
    ];

    // ── 9. Schedule logic gaps ────────────────────────────────────────────
    const scheduleGaps = [
      { location: 'stripeWebhook - checkout.session.completed', status: 'CORRECT: Uses event.created as paid_at for calculateNuViraFulfillmentSchedule' },
      { location: 'stripeWebhook - payment_intent.succeeded', status: 'CORRECT: Uses event.created as paid_at for calculateNuViraFulfillmentSchedule' },
      { location: 'stripeWebhook - invoice.payment_succeeded', status: 'CORRECT: Uses invoice.status_transitions.paid_at OR event.created' },
      { location: 'stripeWebhook - invoice.paid', status: 'CORRECT: Same as invoice.payment_succeeded' },
      { location: 'createSubscriptionPaymentElementIntent', status: 'CORRECT: Uses calculateNuViraFulfillmentSchedule at checkout creation time' },
      { location: 'createPaymentIntent', status: 'CORRECT: Uses calculateNuViraFulfillmentSchedule at PI creation time' },
      { location: 'syncOrderToHub', issue: 'CORRECT: Validates production_date (Tue/Fri) and delivery_date (Wed/Sat) before Hub push; rejects invalid schedules with 422' },
      { location: 'syncSubscriptionWithFulfillments', issue: 'CORRECT: Pre-send validation of all 4 fulfillments; uses central engine cadence (same DOW as first delivery)' },
      { location: 'assignProductionWindow / assignDeliveryWindow', issue: 'LEGACY: These predate the central engine — check if still called anywhere; may use stale logic' },
    ];

    // ── 10. Hub sync gaps ─────────────────────────────────────────────────
    const hubSyncGaps = [
      { path: 'checkout.session.completed → syncOrderToHub', status: 'ACTIVE: fire-and-forget with error log on failure' },
      { path: 'checkout.session.completed → syncSubscriptionWithFulfillments', status: 'ACTIVE: fire-and-forget with error log on failure' },
      { path: 'payment_intent.succeeded → syncOrderToHub', status: 'ACTIVE: awaited with error log' },
      { path: 'invoice.payment_succeeded → syncSubscriptionWithFulfillments', status: 'ACTIVE: fire-and-forget' },
      { path: 'invoice.paid → syncSubscriptionWithFulfillments', status: 'ACTIVE: fire-and-forget' },
      { path: 'customer.subscription.deleted → syncCustomerToHub', status: 'ACTIVE: awaited cancel event' },
      { path: 'charge.refunded (sub) → syncCustomerToHub', status: 'ACTIVE: awaited' },
      { path: 'charge.refunded (order) → syncRefundToHub', status: 'ACTIVE: awaited' },
      { path: 'retryFailedHubSyncs', status: 'ACTIVE: scheduled automation — retries error logs' },
      { path: 'getCustomerOrdersWithHub', issue: 'NOTE: Hub query uses single email — may miss Apple relay customers' },
    ];

    // ── 11. Loyalty gaps ──────────────────────────────────────────────────
    const loyaltyGaps = [
      { event: 'checkout.session.completed (subscription)', status: 'CORRECT: Idempotent — checks description includes stripe_subscription_id before awarding' },
      { event: 'checkout.session.completed (one-time)', status: 'CORRECT: Awards 10pts per $1' },
      { event: 'payment_intent.succeeded', status: 'CORRECT: Awards 10pts per $1 for embedded checkout' },
      { event: 'invoice.payment_succeeded', status: 'CORRECT: Idempotent — same sub ID check' },
      { event: 'invoice.paid', status: 'CORRECT: Mirrors invoice.payment_succeeded — idempotent' },
      { event: 'charge.refunded (subscription)', status: 'CORRECT: Reverses points idempotently — checks for adjustment entry with sub ID' },
      { event: 'charge.refunded (order)', status: 'CORRECT: Restores points on full refund' },
      { issue: 'Rewards.jsx / UserPoints query', status: 'PENDING_AUDIT: May use single email — Apple relay customers may see wrong balance' },
    ];

    // ── 12. Recommended cleanup plan ─────────────────────────────────────
    const cleanupPlan = [
      { priority: 1, action: 'AUDIT NOW', items: ['Rewards.jsx — verify uses identity resolver for UserPoints query', 'CreditWallet.jsx — verify uses identity resolver for NuViraCredit query', 'getCustomerOrdersWithHub — update to accept multiple emails or call resolver internally'] },
      { priority: 2, action: 'RETIRE AFTER 30 DAYS', items: ['repairR1DeepaCAPatch', 'repairR2RefundedDuplicatesCA', 'repairR3HenrryCAHydration', 'repairR4SukhwantCAStructure', 'auditAmarkSubscriptions', 'auditLatestStripePaymentForAmark', 'auditCustomerAppLoyaltyAfterPhase2', 'executeCustomerAppLoyaltyImportPhase2', 'canonicalizeAmarkSubscription'] },
      { priority: 3, action: 'VERIFY THEN RETIRE', items: ['createSubscriptionSession — confirm not called from any active page', 'createSubscriptionCheckoutHosted — confirm not called from any active page', 'createSubscriptionPaymentIntent — confirm superseded by PaymentElementIntent', 'createSubscriptionPaymentIntentV2 — confirm superseded', 'sendOrderConfirmation — confirm not duplicate of sendOrderReceivedNotification'] },
      { priority: 4, action: 'KEEP PERMANENTLY', items: ['stripeWebhook', 'syncOrderToHub', 'syncSubscriptionWithFulfillments', 'retryFailedHubSyncs', 'calculateNuViraFulfillmentSchedule', 'createPaymentIntent', 'createSubscriptionPaymentElementIntent', 'cancelSubscriptionFutureRenewal', 'pauseSubscription', 'stripeCustomerPortal'] },
      { priority: 5, action: 'NO TOUCH (production sensitive)', items: ['STRIPE_WEBHOOK_SECRET — do not rotate without coordinating canonical destination update', 'stripeWebhook URL — do not rename or redeploy without updating Stripe dashboard', 'cancelAbandonedCheckouts automation — confirm schedule and do not disable without replacement'] },
    ];

    // ── 13. Count subscriptions and orders for health check ──────────────
    const totalActiveSubs = await base44.asServiceRole.entities.Subscription.filter({ status: 'active' }, '-created_date', 100);
    const totalSyncErrors = await base44.asServiceRole.entities.OrderSyncLog.filter({ status: 'error' }, '-completed_at', 50);
    const recentOrders = await base44.asServiceRole.entities.Order.list('-created_date', 10);

    // ── BUILD FINAL REPORT ────────────────────────────────────────────────
    const report = {
      generated_at: new Date().toISOString(),
      changes_applied: false,
      audit_mode: 'READ_ONLY',

      // Stripe destinations
      stripe_destinations: destinations.map(d => ({
        id: d.id,
        url: d.url,
        status: d.status,
        is_canonical: d.is_canonical,
        event_count: d.enabled_events.length,
        events_summary: d.enabled_events.includes('*') ? ['ALL EVENTS'] : d.enabled_events,
        livemode: d.livemode,
        created: d.created,
      })),

      canonical_destination: canonicalDest ? {
        id: canonicalDest.id,
        url: canonicalDest.url,
        status: canonicalDest.status,
        enabled_events: canonicalDest.enabled_events,
        is_only_active: duplicateActiveDests.length === 1,
        duplicate_active_warning: duplicateActiveDests.length > 1
          ? `WARNING: ${duplicateActiveDests.length} active destinations for same URL — potential duplicate webhook delivery`
          : null,
      } : { error: 'No active canonical destination found for ' + CANONICAL_URL },

      webhook_secret_audit: {
        secret_exists: webhookSecretExists,
        secret_length: webhookSecretLength,
        secret_prefix: webhookSecretPrefix,
        secret_correct_format: webhookSecretPrefix === 'whsec_...',
      },

      recent_failed_stripe_events: recentDeliveries,
      pending_retry_count: deliverySummary.pending_retries,

      // Event matrix
      enabled_events_on_canonical_destination: canonicalDest?.enabled_events || [],
      event_handler_matrix: eventHandlerMatrix,
      missing_required_events: missingRequired,
      enabled_but_unhandled_events: enabledButUnhandled,
      handled_but_not_enabled_events: handledButNotEnabled,

      // Functions
      functions_inventory: FUNCTION_INVENTORY,
      dangerous_mutation_paths: dangerousMutations,
      legacy_or_one_time_functions: FUNCTION_INVENTORY.filter(f =>
        f.status.includes('LEGACY') || f.status.includes('ONE_TIME') || f.status.includes('SUPERSEDED')
      ).map(f => ({ name: f.name, status: f.status, risk: f.risk })),

      // Gap analysis
      identity_resolver_gaps: identityGaps,
      schedule_logic_gaps: scheduleGaps,
      hub_sync_gaps: hubSyncGaps,
      loyalty_gaps: loyaltyGaps,

      // Health summary
      health_summary: {
        total_active_subscriptions: totalActiveSubs.length,
        total_sync_error_logs: totalSyncErrors.length,
        sync_error_detail: totalSyncErrors.slice(0, 5).map(l => ({
          order_number: l.order_number,
          description: l.description?.substring(0, 100),
          triggered_by: l.triggered_by,
          completed_at: l.completed_at,
        })),
        recent_orders_count: recentOrders.length,
      },

      // Cleanup
      recommended_cleanup_plan: cleanupPlan,

      safe_next_actions: [
        '1. Audit Rewards.jsx and CreditWallet.jsx for identity resolver gaps (non-breaking fix)',
        '2. Confirm createSubscriptionSession / createSubscriptionCheckoutHosted are not called from any active page before retiring',
        '3. Confirm sendOrderConfirmation is not a duplicate of sendOrderReceivedNotification',
        '4. After 30-day stability window, retire repairR1-R4 and one-time audit functions',
        '5. Do NOT change stripeWebhook, syncOrderToHub, syncSubscriptionWithFulfillments, or retryFailedHubSyncs without a full regression test',
        '6. Do NOT rotate STRIPE_WEBHOOK_SECRET without updating Stripe dashboard canonical destination simultaneously',
        '7. Do NOT disable any Stripe events in the canonical destination without verifying the handler still works for in-flight payments',
      ],

      final_status: '✅ AUDIT COMPLETE — Read-only. No mutations applied. See event_handler_matrix, dangerous_mutation_paths, identity_resolver_gaps, and recommended_cleanup_plan for action items.',
    };

    console.log(`[AuditIntegration] ✅ Audit complete. ${eventHandlerMatrix.length} handlers analyzed, ${dangerousMutations.length} dangerous mutation paths flagged, ${identityGaps.filter(g => g.status === 'PENDING_AUDIT').length} identity gaps pending audit.`);

    return Response.json(report);

  } catch (error) {
    console.error('[AuditIntegration] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
