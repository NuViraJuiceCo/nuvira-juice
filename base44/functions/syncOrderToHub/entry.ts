import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { handleNativeOrderOpsRequest } from './nativeOrderOps.ts';
import productionMaterializationHandler from './productionMaterializer/entry.ts';

// Bundle revision: g115h-local-production-materializer-20260812.
// Bundle revision: g115g-bundle-safe-signed-production-materializer-20260812.
// Bundle revision: g115f-direct-production-materializer-composition-20260812.
// Bundle revision: g115e-automatic-production-before-native-projection-20260812.
// Bundle revision: g115d-automatic-production-authenticated-fetch-20260812.
// Bundle revision: g115c-automatic-production-consistency-retry-20260812.
// Bundle revision: g115b-automatic-order-result-coverage-20260812.
// Bundle revision: g115-automatic-paid-order-production-batches-20260812.

function getHubApiUrl() {
  const hubBaseUrl = (Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '');
  return hubBaseUrl ? `${hubBaseUrl}/api/functions/receiveCustomerAppEvent` : '';
}

function getCustomerAppSyncSecret() {
  return Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '';
}

function getNativeSafeSyncPreviewInvokeOptions() {
  return {
    headers: {
      'x-internal-secret': Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET') ||
        Deno.env.get('CUSTOMER_APP_SYNC_SECRET') ||
        Deno.env.get('HUB_SYNC_SECRET') ||
        '',
    },
  };
}

function productionMaterializationSkipReason({ order, eventType, source }) {
  if (eventType === 'order.refunded') return 'refund_event';
  if (order?.order_type === 'subscription' || order?.stripe_subscription_id) return 'subscription_order';
  if (source === 'shopify_pos' || order?.source_channel === 'pos' || order?.fulfillment_method === 'pos') return 'pos_order';
  return null;
}

async function recordProductionMaterializationFailure(base44, order, errorCode) {
  const now = new Date().toISOString();
  await base44.asServiceRole.entities.OrderSyncLog.create({
    order_number: order?.order_number || order?.shopify_order_number || 'unknown',
    status: 'error',
    hub_action: 'automatic_production_batch_materialization_failed',
    description: `Automatic production batch materialization failed safely: ${errorCode}. Retry eligible.`,
    started_at: now,
    completed_at: now,
    triggered_by: 'syncOrderToHub',
  }).catch(() => {});
}

function materializationInvokeError(error) {
  const response = error?.response?.data || {};
  return {
    code: response?.error || response?.error_code || error?.message || 'unknown',
    blockers: Array.isArray(response?.results)
      ? [...new Set(response.results.flatMap(row => Array.isArray(row?.blockers) ? row.blockers : []))]
      : [],
  };
}

function isRetriableMaterializationPreflight(error) {
  const { code } = materializationInvokeError(error);
  return code === 'materialization_preflight_blocked';
}

async function invokeProductionMaterialization(req, payload, secret) {
  // Base44's internal function route can retain a different gateway snapshot.
  // Bundle the canonical materializer with this function so checkout always
  // executes the exact handler version shipped with syncOrderToHub.
  const headers = new Headers(req?.headers || {});
  headers.set('content-type', 'application/json');
  headers.set('x-internal-secret', secret);
  const response = await productionMaterializationHandler(new Request('https://internal.nuvira/syncOrderToHub/materialize', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload.payload),
  }));
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error: any = new Error(result?.error || result?.error_code || `production_materialization_http_${response.status}`);
    error.response = { status: response.status, data: result };
    throw error;
  }
  return result;
}

async function materializePaidOrderProduction({ base44, req, order, eventType, source, requestId }) {
  const skippedReason = productionMaterializationSkipReason({ order, eventType, source });
  if (skippedReason) {
    return { success: true, skipped: true, reason: skippedReason, writes_performed: false };
  }

  const productionDate = order?.production_date || order?.assigned_production_day || order?.assigned_production_date || null;
  const orderNumber = String(order?.order_number || order?.shopify_order_number || '').replace(/^#/, '').trim();
  if (!productionDate || !orderNumber) {
    const errorCode = !productionDate ? 'automatic_production_date_missing' : 'automatic_order_number_missing';
    await recordProductionMaterializationFailure(base44, order, errorCode);
    return { success: false, error_code: errorCode, writes_performed: false };
  }

  const secret = getCustomerAppSyncSecret();
  if (!secret) {
    const errorCode = 'automatic_production_materialization_secret_missing';
    await recordProductionMaterializationFailure(base44, order, errorCode);
    return { success: false, error_code: errorCode, writes_performed: false };
  }

  const invokePayload = {
    gateway_action: 'getAdminProductionPlanningSummary',
    payload: {
      preset: 'custom',
      date_from: productionDate,
      date_to: productionDate,
      operation: 'execute_batch_materialization',
      confirmation: 'materialize_native_production_batches',
      request_id: `auto_native_production:${requestId || orderNumber}`,
      automation_source: 'syncOrderToHub',
      automation_order_number: orderNumber,
    },
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await invokeProductionMaterialization(req, invokePayload, secret);
      if (result?.success !== true || Number(result?.blocked_count || 0) > 0) {
        const errorCode = result?.error || 'automatic_production_materialization_blocked';
        await recordProductionMaterializationFailure(base44, order, errorCode);
        return {
          success: false,
          error_code: errorCode,
          blocked_count: Number(result?.blocked_count || 0),
          writes_performed: result?.writes_performed === true,
        };
      }
      const expectedOrderNumber = orderNumber.toLowerCase();
      const orderIncluded = Array.isArray(result?.results) && result.results.some(row => (
        Array.isArray(row?.source_order_numbers) &&
        row.source_order_numbers.some(value => String(value || '').replace(/^#/, '').trim().toLowerCase() === expectedOrderNumber)
      ));
      if (!orderIncluded) {
        const errorCode = 'automatic_order_demand_not_found';
        await recordProductionMaterializationFailure(base44, order, errorCode);
        return {
          success: false,
          error_code: errorCode,
          blocked_count: 0,
          writes_performed: result?.writes_performed === true,
        };
      }
      return {
        success: true,
        skipped: false,
        created_count: Number(result?.created_count || 0),
        updated_count: Number(result?.updated_count || 0),
        deduped_count: Number(result?.deduped_count || 0),
        blocked_count: 0,
        writes_performed: result?.writes_performed === true,
        consistency_retry_count: attempt - 1,
      };
    } catch (error) {
      if (attempt < maxAttempts && isRetriableMaterializationPreflight(error)) {
        // Native order/task projection and the planning read model are separate
        // writes. Give the second isolated read a brief chance to observe the
        // just-committed order before treating a preflight conflict as real.
        await new Promise(resolve => setTimeout(resolve, 750 * attempt));
        continue;
      }
      const nested = materializationInvokeError(error);
      const errorCode = `automatic_production_materialization_invoke_failed:${String(nested.code).slice(0, 160)}`;
      await recordProductionMaterializationFailure(base44, order, errorCode);
      return {
        success: false,
        error_code: errorCode,
        blockers: nested.blockers.slice(0, 20),
        consistency_retry_count: attempt - 1,
        writes_performed: false,
      };
    }
  }

  return { success: false, error_code: 'automatic_production_materialization_unreachable', writes_performed: false };
}

function isNativeOrderOpsEnabled() {
  return Deno.env.get('ENABLE_NATIVE_ORDER_OPS') === 'true';
}

function isLegacyHubOrderBridgeEnabled() {
  return Deno.env.get('ENABLE_LEGACY_HUB_ORDER_BRIDGE') === 'true';
}

function getNativeSafeSyncDarkLaunchConfig() {
  // Read dark-launch gates per request so Base44 runtime artifact/env
  // propagation cannot leave allowlists or kill switches on stale values.
  return {
    enabled: Deno.env.get('ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH') === 'true',
    sampleRate: Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_SAMPLE_RATE') || '0',
    allowedSources: Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_SOURCES') || '',
    allowedEvents: Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_ALLOWED_EVENTS') || '',
    orderAllowlist: Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_ORDER_ALLOWLIST') || '',
    loggingMode: Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_LOGGING_MODE') || 'none',
    killSwitch: Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH') === 'true',
    returnDebug: Deno.env.get('NATIVE_SAFE_SYNC_DARK_LAUNCH_RETURN_DEBUG') === 'true',
  };
}

/**
 * Projects an app-originated order into Customer App operational entities.
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
 * is_preorder: false and this field has no effect on native processing behavior.
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

function hasDarkLaunchOrderAllowlistMatch(order, config = getNativeSafeSyncDarkLaunchConfig()) {
  const allowedOrders = parseCsvSet(config?.orderAllowlist);
  if (allowedOrders.size === 0) return false;

  const identifiers = getDarkLaunchOrderIdentifiers(order);
  if (identifiers.length === 0) return false;

  return identifiers.some((identifier) => allowedOrders.has(identifier));
}

function getSafeDarkLaunchOrderIdentifier(order) {
  return order?.order_number || order?.id || null;
}

function summarizeDarkLaunchComparison(comparison, skippedReason = null, config = getNativeSafeSyncDarkLaunchConfig()): Record<string, any> {
  if (skippedReason) {
    return {
      enabled: config.enabled,
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
  const config = getNativeSafeSyncDarkLaunchConfig();
  if (!config.returnDebug) return false;
  if (!hasExplicitDarkLaunchDebugRequest(body)) return false;
  if (!summary) return false;
  if (!config.enabled) return false;
  if (config.killSwitch) return false;
  if (!['none', 'persistent'].includes(config.loggingMode)) return false;
  if (!hasDarkLaunchOrderAllowlistMatch(payload?.order, config)) return false;

  const source = payload?.source || 'customer_app';
  const event = payload?.event || 'order.created';
  const allowedSources = parseCsvSet(config.allowedSources);
  const allowedEvents = parseCsvSet(config.allowedEvents);
  if (!allowedSources.has(normalizeAllowlistValue(source))) return false;
  if (!allowedEvents.has(normalizeAllowlistValue(event))) return false;

  return true;
}

function sanitizeDarkLaunchDebugSummary(summary, payload) {
  const config = getNativeSafeSyncDarkLaunchConfig();
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
    persistent_logging_enabled: config.loggingMode === 'persistent',
    persistent_logging_status: summary?.persistent_logging_status || 'not_attempted',
  };
}

function sanitizeSyncLogText(value, maxLength = 240) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function buildSafePayloadSummary({ order, paymentStatus, addressLine1, addressCity, addressState, addressPostalCode }) {
  const itemCount = Array.isArray(order?.items) ? order.items.length : 0;
  const hasStructuredAddress = Boolean(addressLine1 && addressCity && addressState && addressPostalCode);
  return [
    `payment_status=${paymentStatus || 'unknown'}`,
    `address_complete=${hasStructuredAddress}`,
    `customer_present=${Boolean(order?.customer_name || order?.customer_email)}`,
    `total=${Number(order?.total || 0)}`,
    `items=${itemCount}`,
    `is_preorder=${order?.is_preorder === true}`,
  ].join(' | ');
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
  const config = getNativeSafeSyncDarkLaunchConfig();
  if (config.loggingMode !== 'persistent') {
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
  const config = getNativeSafeSyncDarkLaunchConfig();
  if (!config.enabled) return null;
  if (config.killSwitch) return summarizeDarkLaunchComparison(null, 'kill_switch', config);
  if (!['none', 'persistent'].includes(config.loggingMode)) return summarizeDarkLaunchComparison(null, 'unsupported_logging_mode', config);

  const source = payload?.source || 'customer_app';
  const event = payload?.event || 'order.created';
  const normalizedSource = normalizeAllowlistValue(source);
  const normalizedEvent = normalizeAllowlistValue(event);
  const allowedSources = parseCsvSet(config.allowedSources);
  const allowedEvents = parseCsvSet(config.allowedEvents);
  if (!allowedSources.has(normalizedSource)) return summarizeDarkLaunchComparison(null, 'source_not_allowlisted', config);
  if (!allowedEvents.has(normalizedEvent)) return summarizeDarkLaunchComparison(null, 'event_not_allowlisted', config);
  if (normalizedEvent !== 'order.created') return summarizeDarkLaunchComparison(null, 'event_out_of_scope', config);
  if (!hasDarkLaunchOrderAllowlistMatch(payload?.order, config)) return summarizeDarkLaunchComparison(null, 'no_order_allowlist_match', config);

  const sampleRate = parseSampleRate(config.sampleRate);
  const sampleKey = payload?.order?.id || payload?.order?.order_number || payload?.order?.stripe_checkout_session_id || '';
  if (stableBucket(sampleKey) >= sampleRate) return summarizeDarkLaunchComparison(null, 'not_sampled', config);

  try {
    const idempotencyKey = `syncOrderToHub:${payload?.order?.id || payload?.order?.order_number || 'unknown'}`;
    const nativeResponse = await base44.asServiceRole.functions.invoke('getAdminOperationsDashboardSummary', {
      gateway_action: 'previewNativeSafeSyncOrderUpdate',
      payload: {
        mode: 'dry_run',
        fixture_id: 'runtime_dark_launch_syncOrderToHub',
        source,
        idempotency_key: idempotencyKey,
        incoming_payload: payload.order,
        starting_order: null,
      },
    }, getNativeSafeSyncPreviewInvokeOptions());
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

    const comparisonResponse = await base44.asServiceRole.functions.invoke('getAdminOperationsDashboardSummary', {
      gateway_action: 'previewNativeSafeSyncDarkLaunchComparison',
      payload: {
        mode: 'dry_run',
        fixture_id: 'runtime_dark_launch_syncOrderToHub',
        source,
        idempotency_key: idempotencyKey,
        hub_result: hubSummary,
        native_result: nativeResult,
      },
    }, getNativeSafeSyncPreviewInvokeOptions());
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
    const summary: Record<string, any> = {
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

async function maybeRunNativeOrderOps({ req, payload, body }) {
  if (!isNativeOrderOpsEnabled()) return null;
  const eventType = payload?.event || 'order.created';
  const source = ['customer_app_one_time', 'website_one_time', 'shopify_pos'].includes(body?.native_source)
    ? body.native_source
    : 'customer_app_one_time';
  const nativeOrder = body?.native_order && typeof body.native_order === 'object'
    ? body.native_order
    : payload?.order;
  if (nativeOrder?.order_type === 'subscription' || nativeOrder?.stripe_subscription_id) {
    return { skipped: true, reason: 'subscription_out_of_scope' };
  }
  const orderNumber = nativeOrder?.shopify_order_number || nativeOrder?.order_number || nativeOrder?.id || 'unknown';
  const refundSuffix = eventType === 'order.refunded'
    ? `:${nativeOrder?.stripe_refund_id || nativeOrder?.refund_event_id || nativeOrder?.refund_id || nativeOrder?.refunded_at || 'refund'}`
    : '';

  try {
    const headers = new Headers(req.headers);
    headers.set('content-type', 'application/json');
    const response = await handleNativeOrderOpsRequest(new Request(req.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        mode: 'live',
        source,
        event_type: eventType,
        order: nativeOrder,
        request_id: body?.request_id || `syncOrderToHub:${eventType}:${nativeOrder?.id || orderNumber || Date.now()}`,
        idempotency_key: body?.idempotency_key || `native_order_ops:${source}:${eventType}:${orderNumber}${refundSuffix}`,
        internal_secret: getCustomerAppSyncSecret(),
        actor_email: body?.actor_email || null,
      }),
    }));
    const result = await response.json().catch(() => null);
    console.log(`[Native order ops] source=${source} order=${orderNumber} action=${result?.action || 'unknown'} success=${result?.success === true}`);
    return {
      attempted: true,
      success: result?.success === true,
      action: result?.action || null,
      error_code: result?.error_code || null,
      order_id: result?.order_id || null,
      order_number: result?.order_number || orderNumber || null,
      source,
      status: response.status,
      result,
      triggered_by: body?.triggered_by || 'stripe_webhook',
    };
  } catch (error) {
    console.warn(`[Native order ops] failed safely for source=${source} order=${orderNumber}: ${error?.message || 'unknown error'}`);
    return {
      attempted: true,
      success: false,
      action: 'failed_safely',
      error_code: 'native_order_ops_internal_failed',
      order_number: orderNumber || null,
      source,
    };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const base44 = createClientFromRequest(req);
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 });
  }

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

  if (body?.native_only === true) {
    const nativeEventType = body?.event_type || body?.event || 'order.created';
    const source = ['customer_app_one_time', 'website_one_time', 'shopify_pos'].includes(body?.native_source)
      ? body.native_source
      : 'customer_app_one_time';
    const productionBatchMaterialization = await materializePaidOrderProduction({
      base44,
      req,
      order,
      eventType: nativeEventType,
      source,
      requestId: body?.request_id || order?.order_number || order?.id,
    });
    const nativeResult = await maybeRunNativeOrderOps({
      req,
      payload: { event: nativeEventType, order },
      body: { ...body, native_order: body?.native_order || order },
    });
    const success = nativeResult?.success === true && productionBatchMaterialization?.success !== false;
    return Response.json({
      success,
      native_only: true,
      hub_sync_skipped: true,
      action: productionBatchMaterialization?.success === false
        ? 'production_materialization_failed'
        : (nativeResult?.action || (nativeResult ? 'not_accepted' : 'disabled')),
      error_code: productionBatchMaterialization?.success === false
        ? productionBatchMaterialization.error_code
        : (nativeResult?.error_code || (nativeResult ? null : 'native_order_ops_disabled')),
      order_number: nativeResult?.order_number || order?.shopify_order_number || order?.order_number || null,
      native_order_ops: nativeResult?.result || nativeResult,
      production_batch_materialization: productionBatchMaterialization,
    }, { status: success ? 200 : (productionBatchMaterialization?.success === false ? 503 : (nativeResult?.status || 503)) });
  }

  const hubApiUrl = getHubApiUrl();
  const customerAppSyncSecret = getCustomerAppSyncSecret();

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
    console.log(`syncOrderToHub: address parsed from string for ${order.order_number}; address_complete=${Boolean(address_line1 && address_city && address_state && address_postal_code)}`);
  }

  if (!address_line1) {
    console.warn(`syncOrderToHub: WARNING — address_line1 blank for order ${order.order_number}`);
  }

  // order_type: always one_time for Customer App orders.
  // (Subscriptions go through createSubscriptionPaymentElementIntent, not syncOrderToHub)
  const order_type       = 'one_time';
  const fulfillment_mode = 'single_delivery';

  // ── PHASE 5: Validate canonical schedule fields ───────────────────────────
  // All new paid orders have production_date and assigned_delivery_date set by
  // calculateNuViraFulfillmentSchedule (event.created authority). Abort native
  // materialization if the canonical schedule is invalid. Refunded orders skip
  // schedule validation so their native cancellation can still be projected.
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
  const isFullRefund = eventType === 'order.refunded' && (
    stripeSession?.is_full_refund === true ||
    order.refund_type === 'full' ||
    order.refund_status === 'fully_refunded' ||
    (order.refund_type == null && order.refund_status == null && order.is_partial_refund !== true)
  );
  const refundReference = eventType === 'order.refunded'
    ? (order.stripe_refund_id || order.refund_event_id || order.refund_id || stripeSession?.id || null)
    : null;
  const refundAmount = eventType === 'order.refunded'
    ? (order.refund_amount ?? stripeSession?.refund_amount ?? (isFullRefund ? order.total : null))
    : null;
  
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
        category:   i.category || null,
        size:       i.size || null,
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
      refund_id:        refundReference,
      stripe_charge_id:  order.stripe_charge_id || null,
      stripe_refund_id:  order.stripe_refund_id || refundReference,
      refund_amount:    refundAmount,
      charge_amount:    order.total ?? null,
      is_full_refund:   isFullRefund,
      is_partial_refund: eventType === 'order.refunded' ? !isFullRefund : false,
    },
  };

  const payloadSummary = buildSafePayloadSummary({
    order,
    paymentStatus: payment_status,
    addressLine1: address_line1,
    addressCity: address_city,
    addressState: address_state,
    addressPostalCode: address_postal_code,
  });
  console.log(`syncOrderToHub: PAYLOAD for ${order.order_number}: ${payloadSummary}`);

  try {
    // Keep the deployed function name and caller contract, but make the
    // Customer App entities the operational writer. The external Hub bridge
    // is retained only as a default-off rollback path for older clients.
    // Materialize from the committed paid-order read model before refreshing
    // its native projections; otherwise that refresh can briefly expose a
    // mixed pre/post-write snapshot to the separate planning function.
    const productionBatchMaterialization = await materializePaidOrderProduction({
      base44,
      req,
      order,
      eventType,
      source: 'customer_app_one_time',
      requestId: body?.request_id || `syncOrderToHub:${order?.id || order?.order_number || Date.now()}`,
    });
    const nativeOrderOps = await maybeRunNativeOrderOps({ req, payload, body });
    if (nativeOrderOps?.success !== true) {
      if (!isLegacyHubOrderBridgeEnabled()) {
        return Response.json({
          success: false,
          error: 'Native operational order processing did not complete',
          error_code: nativeOrderOps?.error_code || 'native_order_ops_required',
          native_authoritative: true,
          native_order_ops: nativeOrderOps?.result || nativeOrderOps,
          hub_bridge_retired: true,
          hub_operational_dependency: false,
          external_calls_performed: false,
        }, { status: nativeOrderOps?.status || 503 });
      }
    }

    if (productionBatchMaterialization?.success === false) {
      return Response.json({
        success: false,
        error: 'Native order was recorded, but production batch materialization did not complete',
        error_code: productionBatchMaterialization.error_code || 'automatic_production_materialization_failed',
        native_authoritative: true,
        native_order_ops: nativeOrderOps?.result || nativeOrderOps,
        production_batch_materialization: productionBatchMaterialization,
        retry_eligible: true,
        hub_bridge_retired: true,
        hub_operational_dependency: false,
        external_calls_performed: false,
      }, { status: 503 });
    }

    if (!isLegacyHubOrderBridgeEnabled()) {
      return Response.json({
        success: true,
        log_status: nativeOrderOps?.action === 'skipped' ? 'deduped' : 'success',
        hub_action: 'retired_no_external_sync',
        hub_response: null,
        native_authoritative: true,
        native_order_ops: nativeOrderOps?.result || nativeOrderOps,
        production_batch_materialization: productionBatchMaterialization,
        hub_bridge_retired: true,
        hub_sync_skipped: true,
        hub_operational_dependency: false,
        external_calls_performed: false,
      });
    }

    if (!hubApiUrl || !customerAppSyncSecret) {
      return Response.json({
        success: false,
        error: 'Legacy Hub order bridge is enabled but not configured',
        error_code: 'legacy_hub_bridge_not_configured',
        native_authoritative: nativeOrderOps?.success === true,
        native_order_ops: nativeOrderOps?.result || nativeOrderOps,
      }, { status: 503 });
    }

    // Log refund-specific details
    if (eventType === 'order.refunded') {
      console.log(`[syncOrderToHub:REFUND] Sending order.refunded event for ${order.order_number}`);
      console.log(`[syncOrderToHub:REFUND] Endpoint: ${hubApiUrl}`);
      console.log(`[syncOrderToHub:REFUND] Auth configured: ${customerAppSyncSecret ? 'yes' : 'no'}`);
      console.log(`[syncOrderToHub:REFUND] Refund details: amount=$${refundAmount}, reference_present=${Boolean(refundReference)}, full=${isFullRefund}`);
    }

    const response = await fetch(hubApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${customerAppSyncSecret}`,
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
          description:  `Hub HTTP ${response.status}. Retry eligible. ${payloadSummary}. Response: ${sanitizeSyncLogText(responseText, 220)}`,
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
    // Hub create/update returns { action }, while refund cascades return
    // { status: "success", refund_status }. Treat confirmed refund statuses
    // as operational sync outcomes so refund cascades do not look retryable.
    const rawHubAction = typeof hubResponse === 'object' ? (hubResponse?.action || hubResponse?.status || null) : null;
    const hubRefundStatus = eventType === 'order.refunded' && typeof hubResponse === 'object'
      ? hubResponse?.refund_status
      : null;
    const hubAction = hubRefundStatus || rawHubAction;
    const hubOrderId = typeof hubResponse === 'object' ? (hubResponse?.hub_order_id || hubResponse?.order_id || null) : null;
    const matchedHubOrderId = typeof hubResponse === 'object' ? (hubResponse?.matched_hub_order_id || null) : null;

    let logStatus;
    let logLabel;

    if (hubAction === 'created' || hubAction === 'updated' || hubAction === 'refund_processed') {
      // Confirmed operational sync — Hub created or updated a record
      logStatus = 'success';
      logLabel  = `✅ Hub ${hubAction} order. hub_order_id=${hubOrderId}`;
      console.log(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else if (hubAction === 'dedupe_exact_match' || (eventType === 'order.refunded' && hubAction === 'skipped')) {
      // Hub matched an identical existing order — no new record created but order IS in Hub
      logStatus = 'deduped';
      logLabel  = hubAction === 'skipped'
        ? `🔁 Hub refund cascade already applied. hub_order_id=${hubOrderId}`
        : `🔁 Hub dedupe_exact_match. matched_hub_order_id=${matchedHubOrderId}`;
      console.log(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else if (hubAction === 'queued_for_review' || hubAction === 'partial_refund_flagged_for_review') {
      logStatus = 'queued_for_review';
      logLabel  = `⏳ Hub queued_for_review. No operational record yet.`;
      console.warn(`syncOrderToHub: ${logLabel} for ${order.order_number}`);

    } else if (hubAction === 'rejected' || hubAction === 'order_not_found') {
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
        description:        `${sanitizeSyncLogText(logLabel, 260)}. ${payloadSummary}`.substring(0, 1000),
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
        description:   `Sync failed: ${sanitizeSyncLogText(fetchErr.message, 180)}. Payload: ${payloadSummary}`,
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
