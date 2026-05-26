import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL              = `${(Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '')}/api/functions/receiveCustomerAppEvent`;
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH = Deno.env.get('ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH') === 'true';
const NATIVE_SAFE_SYNC_DARK_LAUNCH_SAMPLE_RATE = Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_SAMPLE_RATE') || '0';
const NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_SOURCES = Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_SOURCES') || '';
const NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_EVENTS = Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_EVENTS') || '';
const NATIVE_SAFE_SYNC_DARK_LAUNCH_ORDER_ALLOWLIST = Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_ORDER_ALLOWLIST') || '';
const NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE = Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE') || 'none';
const NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH = Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH') === 'true';
const NATIVE_SAFE_SYNC_DARK_LAUNCH_RETURN_DEBUG = Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_RETURN_DEBUG') === 'true';
const ENABLE_MAY30_NATIVE_ORDER_OPS = Deno.env.get('ENABLE_MAY30_NATIVE_ORDER_OPS') === 'true';

/**
 * Syncs an app-originated order to the operations hub.
 * Called by: stripeWebhook on checkout.session.completed
 * Payload: { order_id: "<id>" }  OR  { data: <Order>, stripe_session: <Stripe session> }
 *
 * Payment status resolution (in priority order):
 *   1. Stripe session payment_status field (passed from webhook — most reliable)
 *   2. order.payment_captured === true → "paid"
 *   3. Default → "pending"
 *
 * NOTE: is_preorder is passed through as-is from the stored order record for
 * backward compatibility with existing orders. New orders will always have
 * is_preorder: false and this field has no effect on Hub processing behavior.
 */

// Hardcoded test order numbers that must never reach Hub production systems.
// These were created during embedded checkout QA and have been cancelled/refunded.
const DO_NOT_SYNC_ORDER_NUMBERS = new Set([
  'NV-MOTLSBB2', // abandoned pre-fix PI test
  'NV-MOTM8I5R', // diagnostic PI test (verify-test@nuvirajuice.com)
  'NV-MOTMFXWH', // embedded checkout QA test — refund pending
]);

function isFakeStripeId(id) {
  if (!id) return false;
  const fakePatterns = [
    'UNIQUE_SESSION_ID', 'UNIQUE_INTENT', 'cs_test_fake',
    'pi_test_fake', 'cs_live_FAKE', 'pi_live_FAKE',
    'test_session', 'test_intent',
  ];
  return fakePatterns.some(p => id.includes(p));
}

function normalizeDeliveryWindowBucket(label) {
  if (!label || typeof label !== 'string') return null;

  const normalized = label
    .toLowerCase()
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  const hasWednesday = /\bwednesday\b/.test(normalized);
  const hasSaturday = /\bsaturday\b/.test(normalized);
  const isFiveToEight = /\b5(?::00)?\s*pm\s*-\s*8(?::00)?\s*pm\b/.test(normalized);
  const isTwelveToThree = /\b12(?::00)?\s*pm\s*-\s*3(?::00)?\s*pm\b/.test(normalized);

  if (hasWednesday) return isFiveToEight ? 'wednesday_5_8' : null;
  if (hasSaturday) return isTwelveToThree ? 'saturday_12_3' : null;
  if (isFiveToEight) return 'wednesday_5_8';
  if (isTwelveToThree) return 'saturday_12_3';
  return null;
}

const LOCKED_FINAL_SCHEDULE_SOURCES = new Set([
  'backend_cadence',
  'admin_override',
  'route_review_approval',
  'subscription_renewal',
  'legacy_migration',
  'unknown',
]);

function normalizeFinalScheduleSource(source) {
  if (source === 'central_engine') return 'backend_cadence';
  return LOCKED_FINAL_SCHEDULE_SOURCES.has(source) ? source : 'unknown';
}

function normalizeAllowlistValue(value) {
  return String(value || '').trim().toLowerCase();
}

function parseCsvSet(value) {
  return new Set(String(value || '').split(',').map(normalizeAllowlistValue).filter(Boolean));
}

function parseSampleRate(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  if (parsed >= 1) return 1;
  return parsed;
}

function stableBucket(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function normalizeDarkLaunchAction(action) {
  const value = String(action || '').toLowerCase();
  if (['created', 'create', 'would_create'].includes(value)) return 'created';
  if (['updated', 'update', 'would_update'].includes(value)) return 'updated';
  if (['dedupe_exact_match', 'skipped', 'duplicate_event'].includes(value)) return 'skipped';
  if (['queued_for_review', 'rejected', 'reject', 'failed', 'error'].includes(value)) return 'rejected';
  return value || null;
}

function getDarkLaunchOrderIdentifiers(order) {
  return [
    order?.id,
    order?.order_number,
    order?.shopify_order_number,
    order?.stripe_checkout_session_id,
  ].map(normalizeAllowlistValue).filter(Boolean);
}

function hasDarkLaunchOrderAllowlistMatch(order) {
  const allowedOrders = parseCsvSet(NATIVE_SAFE_SYNC_DARK_LAUNCH_ORDER_ALLOWLIST);
  if (allowedOrders.size === 0) return false;

  const identifiers = getDarkLaunchOrderIdentifiers(order);
  if (identifiers.length === 0) return false;

  return identifiers.some((identifier) => allowedOrders.has(identifier));
}

function getSafeDarkLaunchOrderIdentifier(order) {
  return order?.order_number || order?.id || null;
}

function summarizeDarkLaunchComparison(comparison, skippedReason = null) {
  if (skippedReason) {
    return {
      enabled: ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH,
      sampled: false,
      skipped_reason: skippedReason,
      native_writer_enabled: false,
      hub_remains_live_writer: true,
    };
  }

  const mismatchCount = Array.isArray(comparison?.mismatches) ? comparison.mismatches.length : 0;
  return {
    enabled: true,
    sampled: true,
    parity_status: comparison?.parity_status || (comparison?.matched === true ? 'match' : 'mismatch'),
    mismatch_category: comparison?.mismatch_category || null,
    mismatch_count: mismatchCount,
    warnings: Array.isArray(comparison?.warnings) ? comparison.warnings.slice(0, 10) : [],
    native_writer_enabled: false,
    hub_remains_live_writer: true,
  };
}

function hasExplicitDarkLaunchDebugRequest(body) {
  return body?.debug_dark_launch === true || body?.debug_safe_sync_dark_launch === true;
}

function shouldReturnDarkLaunchDebug({ body, payload, summary }) {
  if (!NATIVE_SAFE_SYNC_DARK_LAUNCH_RETURN_DEBUG) return false;
  if (!hasExplicitDarkLaunchDebugRequest(body)) return false;
  if (!summary) return false;
  if (!ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH) return false;
  if (NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH) return false;
  if (!['none', 'persistent'].includes(NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE)) return false;
  if (!hasDarkLaunchOrderAllowlistMatch(payload?.order)) return false;

  const source = payload?.source || 'customer_app';
  const event = payload?.event || 'order.created';
  const allowedSources = parseCsvSet(NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_SOURCES);
  const allowedEvents = parseCsvSet(NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_EVENTS);
  if (!allowedSources.has(normalizeAllowlistValue(source))) return false;
  if (!allowedEvents.has(normalizeAllowlistValue(event))) return false;

  return true;
}

function sanitizeDarkLaunchDebugSummary(summary, payload) {
  return {
    enabled: summary?.enabled === true,
    sampled: summary?.sampled === true,
    skipped_reason: summary?.skipped_reason || null,
    parity_status: summary?.parity_status || null,
    mismatch_category: summary?.mismatch_category || null,
    mismatch_count: Number.isFinite(Number(summary?.mismatch_count)) ? Number(summary.mismatch_count) : 0,
    warnings: Array.isArray(summary?.warnings) ? summary.warnings.slice(0, 10).map(String) : [],
    error_code: summary?.error_code || null,
    source: payload?.source || 'customer_app',
    event_type: payload?.event || 'order.created',
    order_identifier: getSafeDarkLaunchOrderIdentifier(payload?.order),
    native_writer_enabled: false,
    hub_remains_live_writer: true,
    persistent_logging_enabled: NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE === 'persistent',
    persistent_logging_status: summary?.persistent_logging_status || 'not_attempted',
  };
}

function toSafeStringArray(value, limit = 20) {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit);
  }
  if (typeof value === 'object') {
    return Object.keys(value).map((item) => String(item || '').trim()).filter(Boolean).slice(0, limit);
  }
  const normalized = String(value || '').trim();
  return normalized ? [normalized] : [];
}

function getSafeMismatchCategories({ summary, comparison }) {
  const categories = [
    ...toSafeStringArray(comparison?.mismatch_categories),
    ...toSafeStringArray(summary?.mismatch_categories),
  ];

  if (comparison?.mismatch_category) categories.push(String(comparison.mismatch_category));
  if (summary?.mismatch_category) categories.push(String(summary.mismatch_category));

  if (Array.isArray(comparison?.mismatches)) {
    for (const mismatch of comparison.mismatches) {
      const label = mismatch?.category || mismatch?.type || mismatch?.field || null;
      if (label) categories.push(String(label));
    }
  }

  return [...new Set(categories.map((item) => item.trim()).filter(Boolean))].slice(0, 20);
}

function getSafeAcceptedFields(nativeResult) {
  return toSafeStringArray(
    nativeResult?.accepted_fields ||
    nativeResult?.order_sync_log_draft?.fields_updated ||
    [],
  );
}

function getSafeRejectedFields(nativeResult) {
  return toSafeStringArray(
    nativeResult?.rejected_fields ||
    nativeResult?.order_sync_log_draft?.fields_rejected ||
    [],
  );
}

async function persistSafeSyncParityLog({ base44, payload, source, event, hubAction, logStatus, summary, comparison, nativeResult, idempotencyKey }) {
  if (NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE !== 'persistent') {
    return { attempted: false, status: 'disabled' };
  }
  if (!summary?.sampled) {
    return { attempted: false, status: 'not_sampled' };
  }

  try {
    const createdAt = new Date().toISOString();
    const created = await base44.asServiceRole.entities.SafeSyncParityLog.create({
      sample_id: `runtime_dark_launch_syncOrderToHub:${createdAt}`,
      request_id: idempotencyKey,
      correlation_id: idempotencyKey,
      order_id: payload?.order?.id || null,
      order_number: payload?.order?.order_number || null,
      source,
      event_type: event,
      bridge_action: hubAction || logStatus || null,
      hub_result_status: logStatus || null,
      native_parity_status: summary?.parity_status || null,
      mismatch_categories: getSafeMismatchCategories({ summary, comparison }),
      mismatch_count: Number.isFinite(Number(summary?.mismatch_count)) ? Number(summary.mismatch_count) : 0,
      warnings: toSafeStringArray(summary?.warnings, 10),
      native_would_create_order: nativeResult?.would_create_order === true,
      native_would_update_order: nativeResult?.would_update_order === true,
      native_would_quarantine: nativeResult?.would_quarantine === true,
      native_would_reject: nativeResult?.would_reject === true,
      accepted_fields_summary: getSafeAcceptedFields(nativeResult),
      rejected_fields_summary: getSafeRejectedFields(nativeResult),
      redaction_applied: true,
      logging_mode: 'persistent',
      native_writer_enabled: false,
      created_at: createdAt,
    });
    console.log(`[safeSync dark launch] parity log persisted status=created id=${created?.id || 'unknown'} order=${payload?.order?.order_number || payload?.order?.id || 'unknown'}`);
    return { attempted: true, status: 'created', id: created?.id || null };
  } catch (error) {
    console.warn(`[safeSync dark launch] parity log write failed safely: ${error?.message || 'unknown error'}`);
    return { attempted: true, status: 'failed', error_code: 'parity_log_write_failed' };
  }
}

async function maybeRunNativeSafeSyncDarkLaunch({ base44, payload, hubAction, logStatus }) {
  if (!ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH) return null;
  if (NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH) return summarizeDarkLaunchComparison(null, 'kill_switch');
  if (!['none', 'persistent'].includes(NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE)) return summarizeDarkLaunchComparison(null, 'unsupported_logging_mode');

  const source = payload?.source || 'customer_app';
  const event = payload?.event || 'order.created';
  const normalizedSource = normalizeAllowlistValue(source);
  const normalizedEvent = normalizeAllowlistValue(event);
  const allowedSources = parseCsvSet(NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_SOURCES);
  const allowedEvents = parseCsvSet(NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_EVENTS);
  if (!allowedSources.has(normalizedSource)) return summarizeDarkLaunchComparison(null, 'source_not_allowlisted');
  if (!allowedEvents.has(normalizedEvent)) return summarizeDarkLaunchComparison(null, 'event_not_allowlisted');
  if (normalizedEvent !== 'order.created') return summarizeDarkLaunchComparison(null, 'event_out_of_scope');
  if (!hasDarkLaunchOrderAllowlistMatch(payload?.order)) return summarizeDarkLaunchComparison(null, 'no_order_allowlist_match');

  const sampleRate = parseSampleRate(NATIVE_SAFE_SYNC_DARK_LAUNCH_SAMPLE_RATE);
  const sampleKey = payload?.order?.id || payload?.order?.order_number || payload?.order?.stripe_checkout_session_id || '';
  if (stableBucket(sampleKey) >= sampleRate) return summarizeDarkLaunchComparison(null, 'not_sampled');

  try {
    const idempotencyKey = `syncOrderToHub:${payload?.order?.id || payload?.order?.order_number || 'unknown'}`;
    const nativeResponse = await base44.asServiceRole.functions.invoke('previewNativeSafeSyncOrderUpdate', {
      mode: 'dry_run',
      fixture_id: 'runtime_dark_launch_syncOrderToHub',
      source,
      idempotency_key: idempotencyKey,
      incoming_payload: payload.order,
      starting_order: null,
    });
    const nativeResult = nativeResponse?.data || nativeResponse;
    const nativeFields = nativeResult?.order_sync_log_draft || {};
    const normalizedHubAction = normalizeDarkLaunchAction(hubAction || logStatus);

    if (normalizedHubAction === 'skipped') {
      const summary = summarizeDarkLaunchComparison({
        parity_status: 'unsupported',
        matched: false,
        mismatch_category: null,
        mismatches: [],
        warnings: ['hub_dedupe_without_native_starting_order', 'hub_field_plan_unavailable'],
      });

      const persistence = await persistSafeSyncParityLog({
        base44,
        payload,
        source,
        event,
        hubAction,
        logStatus,
        summary,
        comparison: null,
        nativeResult,
        idempotencyKey,
      });
      summary.persistent_logging_status = persistence.status;
      if (persistence.error_code) summary.error_code = persistence.error_code;

      console.log(`[safeSync dark launch] source=${source} event=${event} order=${payload?.order?.order_number || 'unknown'} parity=${summary.parity_status} mismatch=none count=${summary.mismatch_count}`);
      return summary;
    }

    // The current Hub bridge response does not expose field-level write plans.
    // Use native field lists only to avoid false field-diff alarms; action/error
    // parity remains the only runtime smoke signal in this dark-launch phase.
    const hubSummary = {
      action: normalizedHubAction,
      status: logStatus || null,
      fields_updated: Array.isArray(nativeFields.fields_updated) ? nativeFields.fields_updated : [],
      fields_rejected: Array.isArray(nativeFields.fields_rejected) ? nativeFields.fields_rejected : [],
      error_code: normalizedHubAction === 'rejected' ? (nativeFields.error_code || null) : null,
      order_sync_log_draft: {
        action: normalizedHubAction,
        success: !['rejected', 'error'].includes(normalizedHubAction),
        fields_updated: Array.isArray(nativeFields.fields_updated) ? nativeFields.fields_updated : [],
        fields_rejected: Array.isArray(nativeFields.fields_rejected) ? nativeFields.fields_rejected : [],
        error_code: normalizedHubAction === 'rejected' ? (nativeFields.error_code || null) : null,
      },
      order_review_queue_draft: nativeResult?.order_review_queue_draft
        ? { incident_type: nativeResult.order_review_queue_draft.incident_type || null }
        : null,
    };

    const comparisonResponse = await base44.asServiceRole.functions.invoke('previewNativeSafeSyncDarkLaunchComparison', {
      mode: 'dry_run',
      fixture_id: 'runtime_dark_launch_syncOrderToHub',
      source,
      idempotency_key: idempotencyKey,
      hub_result: hubSummary,
      native_result: nativeResult,
    });
    const comparison = comparisonResponse?.data || comparisonResponse;
    const summary = summarizeDarkLaunchComparison({
      ...comparison,
      warnings: [...(comparison?.warnings || []), 'hub_field_plan_unavailable'],
    });

    const persistence = await persistSafeSyncParityLog({
      base44,
      payload,
      source,
      event,
      hubAction,
      logStatus,
      summary,
      comparison,
      nativeResult,
      idempotencyKey,
    });
    summary.persistent_logging_status = persistence.status;
    if (persistence.error_code) summary.error_code = persistence.error_code;

    console.log(`[safeSync dark launch] source=${source} event=${event} order=${payload?.order?.order_number || 'unknown'} parity=${summary.parity_status} mismatch=${summary.mismatch_category || 'none'} count=${summary.mismatch_count}`);
    return summary;
  } catch (error) {
    console.warn(`[safeSync dark launch] comparison failed safely: ${error?.message || 'unknown error'}`);
    const summary = {
      enabled: true,
      sampled: true,
      parity_status: 'needs_manual_review',
      error_code: 'dark_launch_failed',
      mismatch_count: 0,
      warnings: ['dark_launch_failed'],
      native_writer_enabled: false,
      hub_remains_live_writer: true,
    };
    const persistence = await persistSafeSyncParityLog({
      base44,
      payload,
      source,
      event,
      hubAction,
      logStatus,
      summary,
      comparison: null,
      nativeResult: null,
      idempotencyKey: `syncOrderToHub:${payload?.order?.id || payload?.order?.order_number || 'unknown'}`,
    });
    summary.persistent_logging_status = persistence.status;
    if (persistence.error_code) summary.error_code = persistence.error_code;
    return summary;
  }
}

async function maybeRunMay30NativeOrderOps({ base44, payload, body }) {
  if (!ENABLE_MAY30_NATIVE_ORDER_OPS) return null;
  if (payload?.event !== 'order.created') return { skipped: true, reason: 'event_out_of_scope' };
  if (payload?.order?.order_type === 'subscription' || payload?.order?.stripe_subscription_id) {
    return { skipped: true, reason: 'subscription_out_of_scope' };
  }

  try {
    const response = await base44.asServiceRole.functions.invoke('processMay30NativeOrderOps', {
      mode: 'live',
      source: 'customer_app_one_time',
      event_type: payload.event,
      order: payload.order,
      request_id: `syncOrderToHub:${payload?.order?.id || payload?.order?.order_number || Date.now()}`,
      idempotency_key: `may30_native_order_ops:customer_app_one_time:${payload?.order?.order_number || payload?.order?.id || 'unknown'}`,
      internal_secret: CUSTOMER_APP_SYNC_SECRET,
    });
    const result = response?.data || response;
    console.log(`[May30 native order ops] order=${payload?.order?.order_number || 'unknown'} action=${result?.action || 'unknown'} success=${result?.success === true}`);
    return {
      attempted: true,
      success: result?.success === true,
      action: result?.action || null,
      error_code: result?.error_code || null,
      order_number: payload?.order?.order_number || null,
      triggered_by: body?.triggered_by || 'stripe_webhook',
    };
  } catch (error) {
    console.warn(`[May30 native order ops] failed safely for order=${payload?.order?.order_number || 'unknown'}: ${error?.message || 'unknown error'}`);
    return {
      attempted: true,
      success: false,
      action: 'failed_safely',
      error_code: 'may30_native_order_ops_invoke_failed',
      order_number: payload?.order?.order_number || null,
    };
  }
}

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const body   = await req.json();

  let order = body.data;
  const stripeSession = body.stripe_session || null;

  if (!order && body.order_id) {
    const results = await base44.asServiceRole.entities.Order.filter({ id: body.order_id });
    order = results[0] || null;
  }

  if (!order || !order.id) {
    console.error('syncOrderToHub: no order data provided');
    return Response.json({ error: 'No order data' }, { status: 400 });
  }

  // HARD GATE: Never sync unpaid, pending, or abandoned checkout orders to Hub.
  // Only payment_captured=true + payment_status='paid' orders may enter Hub operational flow.
  // EXCEPT: Refunded orders (payment_status='refunded') — these MUST sync to Hub to cancel production/fulfillment
  if (order.status === 'pending_payment' || order.is_abandoned_checkout || order.do_not_recover) {
    console.log(`syncOrderToHub: BLOCKED — order ${order.order_number} is pending/abandoned (status=${order.status}, payment_captured=${order.payment_captured}). No Hub push.`);
    return Response.json({ success: true, skipped: true, reason: 'pending_or_abandoned_checkout' });
  }
  
  // Allow refunded orders to sync (critical for operational cancellation)
  const isRefundedOrder = order.payment_status === 'refunded' || order.status === 'refunded';
  
  if (!isRefundedOrder && (!order.payment_captured || (order.payment_status !== 'paid' && order.financial_status !== 'paid'))) {
    console.log(`syncOrderToHub: BLOCKED — order ${order.order_number} not paid (payment_captured=${order.payment_captured}, payment_status=${order.payment_status}). No Hub push.`);
    return Response.json({ success: true, skipped: true, reason: 'payment_not_captured' });
  }

  // Block known test orders — hardcoded blocklist, never send to Hub
  if (DO_NOT_SYNC_ORDER_NUMBERS.has(order.order_number)) {
    console.log(`syncOrderToHub: SKIPPED — order ${order.order_number} is in DO_NOT_SYNC blocklist (test/cancelled). No Hub push.`);
    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number: order.order_number,
        status:       'skipped',
        hub_action:   'do_not_sync',
        description:  `Order ${order.order_number} is in DO_NOT_SYNC blocklist. Embedded checkout test order — cancelled/refunded. Hub push permanently blocked.`,
        started_at:   new Date().toISOString(),
        completed_at: new Date().toISOString(),
        triggered_by: body.triggered_by || 'guard',
      });
    } catch {}
    return Response.json({ success: true, skipped: true, reason: 'do_not_sync_blocklist' });
  }

  // Block clearly fake/test Stripe IDs
  if (isFakeStripeId(order.stripe_checkout_session_id) || isFakeStripeId(order.stripe_payment_intent_id)) {
    const msg = `syncOrderToHub: BLOCKED — fake Stripe IDs on order ${order.order_number}`;
    console.error(msg);
    return Response.json({ error: 'Fake Stripe IDs blocked' }, { status: 400 });
  }

  if (!HUB_API_URL) {
    console.log('syncOrderToHub: HUB_API_URL not set, skipping');
    return Response.json({ success: true, skipped: true });
  }

  // Resolve payment_status from Stripe session (source of truth)
  let payment_status = 'pending';
  if (stripeSession?.payment_status === 'paid') {
    payment_status = 'paid';
  } else if (stripeSession?.payment_status === 'refunded') {
    payment_status = 'refunded';
  } else if (stripeSession?.payment_status) {
    payment_status = stripeSession.payment_status;
  } else if (order.payment_status === 'refunded') {
    payment_status = 'refunded';
  } else if (order.payment_captured === true) {
    payment_status = 'paid';
  }
  // NOTE: is_preorder / authorized logic removed — all new orders are immediate capture.
  // Old orders with is_preorder:true already have correct payment_captured state in DB.

  console.log(`syncOrderToHub: payment_status="${payment_status}" for order ${order.order_number}${payment_status === 'refunded' ? ' [REFUND]' : ''}`);

  // Resolve address fields — structured first, then fall back to parsing delivery_address string
  const addr = order.delivery_address || '';
  let address_line1       = order.address_line1       || '';
  let address_city        = order.address_city        || '';
  let address_state       = order.address_state       || '';
  let address_postal_code = order.address_postal_code || '';
  const address_country   = order.address_country     || 'US';

  if (!address_line1 && typeof addr === 'string' && addr.includes(',')) {
    const parts = addr.split(',').map(s => s.trim());
    address_line1       = parts[0] || '';
    address_city        = parts[1] || '';
    const stateZip      = (parts[2] || '').trim().split(' ');
    address_state       = stateZip[0] || '';
    address_postal_code = stateZip[1] || '';
    console.log(`syncOrderToHub: address parsed from string for ${order.order_number}: "${address_line1}", "${address_city}", "${address_state}", "${address_postal_code}"`);
  }

  if (!address_line1) {
    console.warn(`syncOrderToHub: WARNING — address_line1 blank for order ${order.order_number}`);
  }

  // order_type: always one_time for Customer App orders.
  // (Subscriptions go through createSubscriptionSession, not syncOrderToHub)
  const order_type       = 'one_time';
  const fulfillment_mode = 'single_delivery';

  // ── PHASE 5: Validate canonical schedule fields ───────────────────────────
  // All new paid orders have production_date and assigned_delivery_date set by
  // calculateNuViraFulfillmentSchedule (event.created authority). ABORT before Hub push if invalid.
  // Refunded orders skip schedule validation — they just need to reach Hub for cancellation.
  const finalProductionDate  = order.production_date || null;
  const finalDeliveryDate    = order.assigned_delivery_date || order.estimated_delivery_date || null;
  const finalWindowLabel     = order.delivery_window_label || '5 PM – 8 PM';
  const finalWindowStart     = order.assigned_delivery_window_start || '17:00';
  const finalWindowEnd       = order.assigned_delivery_window_end   || '20:00';
  const finalScheduleReason  = order.scheduling_reason || 'unknown';
  const finalScheduleSource  = normalizeFinalScheduleSource(order.final_schedule_source);

  if (!isRefundedOrder && finalProductionDate && finalDeliveryDate) {
    // Validate production day (must be Tuesday=2 or Friday=5)
    const prodDow = new Date(finalProductionDate + 'T12:00:00').getDay();
    const delDow  = new Date(finalDeliveryDate   + 'T12:00:00').getDay();
    const validProd = prodDow === 2 || prodDow === 5; // Tue or Fri
    const validDel  = delDow  === 3 || delDow  === 6; // Wed or Sat
    // Validate window matches delivery day
    const expectedWindow = delDow === 3 ? 'Wednesday 5 PM - 8 PM' : 'Saturday 12 PM - 3 PM';
    const expectedWindowBucket = delDow === 3 ? 'wednesday_5_8' : 'saturday_12_3';
    const actualWindowBucket = normalizeDeliveryWindowBucket(finalWindowLabel);
    const windowMatches = actualWindowBucket === expectedWindowBucket;

    if (!validProd || !validDel || !windowMatches) {
      const errMsg = `[syncOrderToHub] INVALID SCHEDULE — production_date=${finalProductionDate} (dow=${prodDow}, must be Tue/Fri) | delivery_date=${finalDeliveryDate} (dow=${delDow}, must be Wed/Sat) | delivery_window_label="${finalWindowLabel}" (expected "${expectedWindow}", bucket=${expectedWindowBucket}, actual_bucket=${actualWindowBucket || 'unknown'}). Order ${order.order_number} rejected before Hub push.`;
      console.error(errMsg);
      return Response.json({
        success: false,
        error_code: 'INVALID_SCHEDULE',
        reason_code: 'INVALID_SCHEDULE',
        error: errMsg,
        order_number: order.order_number,
        production_date: finalProductionDate,
        delivery_date: finalDeliveryDate,
        delivery_window_label: finalWindowLabel,
        expected_window: expectedWindow,
        expected_window_bucket: expectedWindowBucket,
        actual_window_bucket: actualWindowBucket,
        hub_push_aborted: true,
      }, { status: 422 });
    } else {
      console.log(`[syncOrderToHub] Schedule validated ✅ prod=${finalProductionDate}(${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][prodDow]}) del=${finalDeliveryDate}(${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][delDow]}) window="${finalWindowLabel}" bucket=${actualWindowBucket}`);
    }
  }

  // Determine event type: refund vs. creation
  const eventType = payment_status === 'refunded' ? 'order.refunded' : 'order.created';
  
  const payload = {
    event:  eventType,
    source: 'customer_app',
    order: {
      id:            order.id,
      order_number:  order.order_number,
      customer_email: order.customer_email,
      customer_name:  order.customer_name || '',
      customer_phone: order.contact_phone || '',
      address_line1,
      address_line2:       order.address_line2 || '',
      address_city,
      address_state,
      address_postal_code,
      address_country,
      delivery_address:    addr,
      line_items: (order.items || []).map(i => ({
        title:      i.title,
        quantity:   i.quantity,
        price:      i.price,
        product_id: i.product_id,
        image_url:  i.image_url || null,
      })),
      items:                   order.items,
      subtotal:                order.subtotal,
      delivery_fee:            order.delivery_fee,
      total_price:             order.total,
      total:                   order.total,
      fulfillment_method:      order.fulfillment_type || 'delivery',
      fulfillment_type:        order.fulfillment_type,
      requested_delivery_date:  finalDeliveryDate,
      estimated_delivery_date:  finalDeliveryDate,
      assigned_delivery_date:   finalDeliveryDate,
      production_date:          finalProductionDate,
      delivery_window_label:    finalWindowLabel,
      delivery_window_start:    finalWindowStart,
      delivery_window_end:      finalWindowEnd,
      // ── PHASE 5: Canonical schedule fields ───────────────────────────────
      final_schedule_source:    finalScheduleSource,
      schedule_reason:          finalScheduleReason,
      schedule_timezone:        'America/Chicago',
      status:                   order.status,
      production_status:        'new',
      payment_status,
      is_preorder:              order.is_preorder || false,
      customer_notes:           order.notes || '',
      notes:                    order.notes,
      stripe_checkout_session_id: order.stripe_checkout_session_id || null,
      stripe_payment_intent_id:   order.stripe_payment_intent_id   || null,
      created_date:    order.created_date,
      order_type,
      fulfillment_mode,
      // Refund-specific fields
      refunded_at:      order.refunded_at      || null,
      refund_id:        order.refund_id        || null,
      refund_amount:    order.refund_amount    || null,
      is_partial_refund: order.is_partial_refund || false,
    },
  };

  const payloadSummary = `payment_status=${payment_status} | address="${address_line1}, ${address_city}, ${address_state} ${address_postal_code}" | customer="${order.customer_name}" | email="${order.customer_email}" | total=${order.total} | items=${(order.items||[]).length} | is_preorder=${order.is_preorder || false}`;
  console.log(`syncOrderToHub: PAYLOAD for ${order.order_number}: ${payloadSummary}`);

  try {
    // M30A: default-off native operational mirror for one-time app orders.
    // Hub remains the live bridge/fallback. This call is isolated so native
    // mirror errors never alter the payload sent to Hub or the Hub response.
    await maybeRunMay30NativeOrderOps({ base44, payload, body });

    // Log refund-specific details
    if (eventType === 'order.refunded') {
      console.log(`[syncOrderToHub:REFUND] Sending order.refunded event for ${order.order_number}`);
      console.log(`[syncOrderToHub:REFUND] Endpoint: ${HUB_API_URL}`);
      console.log(`[syncOrderToHub:REFUND] Auth: Authorization: Bearer ${(CUSTOMER_APP_SYNC_SECRET || 'NOT_SET').substring(0,20)}...`);
      console.log(`[syncOrderToHub:REFUND] Refund details: amount=$${order.refund_amount}, id=${order.refund_id}, full=${!order.is_partial_refund}`);
    }

    const response = await fetch(HUB_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let hubResponse = null;
    try { hubResponse = JSON.parse(responseText); } catch { hubResponse = responseText; }

    if (eventType === 'order.refunded') {
      console.log(`[syncOrderToHub:REFUND] Response status: ${response.status}`);
      console.log(`[syncOrderToHub:REFUND] Response body: ${responseText.substring(0, 300)}`);
    }

    if (response.status === 410) {
      console.log(`syncOrderToHub: Hub push deprecated (410). Order ${order.order_number} safe in Customer App DB.`);
      return Response.json({ success: true, note: 'Hub pull model — order will sync on next hub pull cycle' });
    }

    if (!response.ok) {
      const errorMsg = `syncOrderToHub: hub returned ${response.status} for ${order.order_number}: ${responseText.substring(0, 200)}`;
      console.error(errorMsg);
      if (eventType === 'order.refunded') {
        console.error(`[syncOrderToHub:REFUND] ❌ FAILED: ${errorMsg}`);
      }
      // Log as error — eligible for retry by retryFailedHubSyncs
      try {
        await base44.asServiceRole.entities.OrderSyncLog.create({
          order_number: order.order_number,
          status:       'error',
          hub_action:   null,
          description:  `Hub HTTP ${response.status}. Retry eligible. ${payloadSummary}. Response: ${responseText.substring(0, 300)}`,
          started_at:   new Date().toISOString(),
          completed_at: new Date().toISOString(),
          triggered_by: body.triggered_by || 'stripe_webhook',
        });
      } catch (logErr) {
        console.warn(`syncOrderToHub: failed to write error log: ${logErr.message}`);
      }
      return Response.json({ error: `Hub returned ${response.status}`, details: responseText }, { status: response.status });
    }

    // --- Interpret Hub response contract ---
    // Hub should return: { action, hub_order_id?, matched_hub_order_id?, status?, note? }
    const hubAction = typeof hubResponse === 'object' ? (hubResponse?.action || hubResponse?.status || null) : null;
    const hubOrderId = typeof hubResponse === 'object' ? (hubResponse?.hub_order_id || hubResponse?.order_id || null) : null;
    const matchedHubOrderId = typeof hubResponse === 'object' ? (hubResponse?.matched_hub_order_id || null) : null;

    let logStatus;
    let logLabel;

    if (hubAction === 'created' || hubAction === 'updated') {
      // Confirmed operational sync — Hub created or updated a record
      logStatus = 'success';
      logLabel  = `✅ Hub ${hubAction} order. hub_order_id=${hubOrderId}`;
      console.log(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else if (hubAction === 'dedupe_exact_match') {
      // Hub matched an identical existing order — no new record created but order IS in Hub
      logStatus = 'deduped';
      logLabel  = `🔁 Hub dedupe_exact_match. matched_hub_order_id=${matchedHubOrderId}`;
      console.log(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else if (hubAction === 'queued_for_review') {
      logStatus = 'queued_for_review';
      logLabel  = `⏳ Hub queued_for_review. No operational record yet.`;
      console.warn(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else if (hubAction === 'rejected') {
      logStatus = 'rejected';
      logLabel  = `🚫 Hub rejected order. Response: ${JSON.stringify(hubResponse).substring(0, 200)}`;
      console.error(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else {
      // Catch-all: Hub returned 200 but no confirmed action (e.g. "acknowledged / no action required")
      // This is NOT a successful operational sync — mark skipped and keep retry eligible
      logStatus = 'skipped';
      logLabel  = `⚠️ Hub returned 200 with no confirmed action (hub_action="${hubAction}"). Retry eligible. Response: ${JSON.stringify(hubResponse).substring(0, 200)}`;
      console.warn(`syncOrderToHub: ${logLabel} for ${order.order_number}`);
    }

    // G21P/G21Y: default-off native safeSync dark launch.
    // Hub remains the only live writer. Persistent parity logging is allowed
    // only by explicit gated mode and must never alter the Hub payload, Hub
    // response handling, or existing OrderSyncLog behavior.
    const darkLaunchSummary = await maybeRunNativeSafeSyncDarkLaunch({
      base44,
      payload,
      hubAction,
      logStatus,
    });

    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number:       order.order_number,
        status:             logStatus,
        hub_action:         hubAction || 'unknown',
        hub_order_id:       hubOrderId || undefined,
        matched_hub_order_id: matchedHubOrderId || undefined,
        description:        `${logLabel}. ${payloadSummary}`.substring(0, 1000),
        started_at:         new Date().toISOString(),
        completed_at:       new Date().toISOString(),
        triggered_by:       body.triggered_by || 'stripe_webhook',
      });
    } catch (logErr) {
      console.warn(`syncOrderToHub: failed to write log: ${logErr.message}`);
    }

    const responseBody = {
      success: logStatus === 'success' || logStatus === 'deduped',
      log_status: logStatus,
      hub_action: hubAction,
      hub_response: hubResponse,
      safe_sync_dark_launch: undefined,
    };

    // G21U: explicit one-order debug return for no-persistence dark launch.
    // This never enables native writes and only returns a sanitized comparison
    // summary when both server env and request-level debug gates are present.
    if (shouldReturnDarkLaunchDebug({ body, payload, summary: darkLaunchSummary })) {
      responseBody.safe_sync_dark_launch = sanitizeDarkLaunchDebugSummary(darkLaunchSummary, payload);
    }

    return Response.json(responseBody);

  } catch (fetchErr) {
    console.error(`syncOrderToHub: fetch error for ${order.order_number}: ${fetchErr.message}`);

    try {
      await base44.asServiceRole.entities.OrderSyncLog.create({
        order_number:  order.order_number,
        status:        'error',
        description:   `Sync failed: ${fetchErr.message}. Payload: ${payloadSummary}`,
        started_at:    new Date().toISOString(),
        completed_at:  new Date().toISOString(),
        triggered_by:  body.triggered_by || 'stripe_webhook',
      });
    } catch (logErr) {
      console.warn(`syncOrderToHub: failed to write error log: ${logErr.message}`);
    }

    return Response.json({ error: fetchErr.message }, { status: 500 });
  }
});
