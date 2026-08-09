// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const VALID_PRESETS = new Set(['today', 'last_7_days', 'last_30_days']);
const CHICAGO_TZ = 'America/Chicago';
const G39N_DIAGNOSTICS_MARKER = 'g39n_operations_dashboard_aggregate_diagnostics';
const G39Q_DELIVERY_COMPLETED_MARKER = 'g39q_delivery_completed_in_range_route_date_guard';
const UNSCHEDULED_NATIVE_ORDER_REVIEW_DAYS = 14;
const BACKEND_READINESS_MAX_ROWS = 500;
const BACKEND_READINESS_RECENT_ORDER_WRITE_MINUTES = 60;
const FOOD_STOCK_EXCLUDED_CATEGORIES = new Set(['produce', 'juice base', 'spices & herbs']);

const G39N_AGGREGATE_SPECS = Object.freeze([
  {
    name: 'orders.total',
    group: 'orders',
    key: 'total',
    domain: 'admin_orders',
    source_of_truth: 'customer_app_native',
    native_first_candidate_if_match: true,
    recommendation: 'customer_app_order_entities_are_authoritative',
  },
  {
    name: 'orders.paid',
    group: 'orders',
    key: 'paid',
    domain: 'payment_refund',
    source_of_truth: 'customer_app_payment_projection',
    mismatch_category: 'payment_refund_semantic_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'use_customer_app_order_payment_projection_for_dashboard_counts',
  },
  {
    name: 'orders.fulfilled',
    group: 'orders',
    key: 'fulfilled',
    domain: 'admin_orders',
    source_of_truth: 'customer_app_native',
    native_first_candidate_if_match: true,
    recommendation: 'use_customer_app_order_and_fulfillment_task_lifecycle',
  },
  {
    name: 'orders.delivered',
    group: 'orders',
    key: 'delivered',
    domain: 'admin_orders',
    source_of_truth: 'customer_app_native',
    mismatch_category: 'delivered_completed_semantic_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'use_customer_app_order_and_route_task_delivery_state',
  },
  {
    name: 'production.batch_count',
    group: 'production',
    key: 'batch_count',
    domain: 'production_planning',
    source_of_truth: 'customer_app_native',
    mismatch_category: 'production_status_semantic_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'reference_g39f_production_planning_before_switching_displayed_count',
  },
  {
    name: 'production.planned_units',
    group: 'production',
    key: 'planned_units',
    domain: 'production_planning',
    source_of_truth: 'customer_app_native',
    mismatch_category: 'schema_meaning_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'compare_unit_semantics_with_g39f_planning_before_switching_displayed_units',
  },
  {
    name: 'production.produced_units',
    group: 'production',
    key: 'produced_units',
    domain: 'production_planning',
    source_of_truth: 'customer_app_native',
    mismatch_category: 'schema_meaning_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'compare_actual_units_final_usable_quantity_and_hub_produced_units_before_switching',
  },
  {
    name: 'delivery.today_stops',
    group: 'delivery',
    key: 'today_stops',
    domain: 'delivery_route',
    source_of_truth: 'customer_app_native',
    native_first_candidate_if_match: true,
    recommendation: 'reference_g39d_native_first_route_summary_for_date_bucket_semantics',
  },
  {
    name: 'delivery.tomorrow_stops',
    group: 'delivery',
    key: 'tomorrow_stops',
    domain: 'delivery_route',
    source_of_truth: 'customer_app_native',
    native_first_candidate_if_match: true,
    recommendation: 'reference_g39d_native_first_route_summary_for_date_bucket_semantics',
  },
  {
    name: 'delivery.unscheduled',
    group: 'delivery',
    key: 'unscheduled',
    domain: 'delivery_route',
    source_of_truth: 'customer_app_native',
    native_first_candidate_if_match: true,
    recommendation: 'surface_paid_delivery_orders_without_route_dates_before_planning_routes',
  },
  {
    name: 'delivery.completed_in_range',
    group: 'delivery',
    key: 'completed_in_range',
    domain: 'delivery_route',
    source_of_truth: 'customer_app_native',
    mismatch_category: 'delivered_completed_semantic_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'reference_g39d_completed_task_semantics_before_switching_displayed_count',
  },
  {
    name: 'calendar.events',
    group: 'calendar',
    key: 'events',
    domain: 'calendar_events',
    source_of_truth: 'mixed',
    mismatch_category: 'not_comparable',
    blocker: 'calendar_events_not_returned_by_current_operations_dashboard_summary_contract',
    recommendation: 'reference_g39h_native_first_calendar_summary_if_calendar_aggregate_is_added_later',
  },
  {
    name: 'inventory.low',
    group: 'inventory',
    key: 'low',
    domain: 'inventory_po',
    source_of_truth: 'manual_review',
    mismatch_category: 'schema_meaning_mismatch',
    blocker: 'inventory_stock_not_authoritative_po_automation_held',
    recommendation: 'count_only_non_food_stock_thresholds_food_and_juice_items_are_demand_based',
  },
  {
    name: 'inventory.critical',
    group: 'inventory',
    key: 'critical',
    domain: 'inventory_po',
    source_of_truth: 'manual_review',
    mismatch_category: 'schema_meaning_mismatch',
    blocker: 'inventory_stock_not_authoritative_po_automation_held',
    recommendation: 'count_only_non_food_stock_thresholds_food_and_juice_items_are_demand_based',
  },
  {
    name: 'inventory.out_of_stock',
    group: 'inventory',
    key: 'out_of_stock',
    domain: 'inventory_po',
    source_of_truth: 'manual_review',
    mismatch_category: 'schema_meaning_mismatch',
    blocker: 'inventory_stock_not_authoritative_po_automation_held',
    recommendation: 'do_not_trigger_inventory_deduction_or_purchase_orders_from_dashboard_counts_food_is_demand_based',
  },
  {
    name: 'alerts.active',
    group: 'alerts',
    key: 'active',
    domain: 'alerts_review',
    source_of_truth: 'manual_review',
    mismatch_category: 'repair_replay_safesync_mismatch',
    blocker: 'alert_sources_include_review_log_manual_review_context',
    recommendation: 'label_alert_source_counts_before_switching_displayed_alert_totals',
  },
  {
    name: 'alerts.critical',
    group: 'alerts',
    key: 'critical',
    domain: 'alerts_review',
    source_of_truth: 'manual_review',
    mismatch_category: 'repair_replay_safesync_mismatch',
    blocker: 'alert_severity_semantics_differ_by_source',
    recommendation: 'label_alert_source_counts_before_switching_displayed_alert_totals',
  },
  {
    name: 'alerts.warning',
    group: 'alerts',
    key: 'warning',
    domain: 'alerts_review',
    source_of_truth: 'manual_review',
    mismatch_category: 'repair_replay_safesync_mismatch',
    blocker: 'alert_severity_semantics_differ_by_source',
    recommendation: 'label_alert_source_counts_before_switching_displayed_alert_totals',
  },
  {
    name: 'alerts.info',
    group: 'alerts',
    key: 'info',
    domain: 'alerts_review',
    source_of_truth: 'manual_review',
    mismatch_category: 'repair_replay_safesync_mismatch',
    blocker: 'alert_severity_semantics_differ_by_source',
    recommendation: 'label_alert_source_counts_before_switching_displayed_alert_totals',
  },
  {
    name: 'source_mix.one_time',
    group: 'source_mix',
    key: 'one_time',
    domain: 'admin_orders',
    source_of_truth: 'customer_app_native',
    mismatch_category: 'aggregate_includes_different_row_classes',
    native_first_candidate_if_match: true,
    recommendation: 'use_customer_app_order_source_classification',
  },
  {
    name: 'source_mix.subscription',
    group: 'source_mix',
    key: 'subscription',
    domain: 'subscription',
    source_of_truth: 'customer_app_native',
    mismatch_category: 'subscription_multi_delivery_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'use_customer_app_order_subscription_classification',
  },
  {
    name: 'source_mix.pos',
    group: 'source_mix',
    key: 'pos',
    domain: 'pos_event',
    source_of_truth: 'customer_app_native',
    mismatch_category: 'aggregate_includes_different_row_classes',
    native_first_candidate_if_match: true,
    recommendation: 'use_customer_app_order_pos_event_classification',
  },
  {
    name: 'source_mix.other',
    group: 'source_mix',
    key: 'other',
    domain: 'unknown',
    source_of_truth: 'unknown',
    mismatch_category: 'unknown_manual_review_needed',
    blocker: 'ambiguous_source_mix_bucket',
    recommendation: 'manual_review_before_native_primary_source_mix',
  },
]);

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function isInternalTestProductionBatch(batch) {
  const batchId = normalizeLower(batch?.batch_id || batch?.id);
  const sourceSystem = normalizeLower(batch?.source_system);
  const ownerStatus = normalizeLower(batch?.native_owner_status);
  const testPurpose = normalizeLower(batch?.test_purpose);
  return batch?.is_test_batch === true ||
    batchId.includes('-test-') ||
    sourceSystem.includes('internal_validation') ||
    ownerStatus.includes('internal_test') ||
    testPurpose.includes('internal validation');
}

function parseIsoDate(value, fieldName) {
  const text = normalizeText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const normalized = date.toISOString().slice(0, 10);
  if (normalized !== text) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  return text;
}

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function todayChicagoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function resolveDateRange({ preset, dateFrom, dateTo }) {
  if (preset === 'custom') {
    return { date_from: dateFrom, date_to: dateTo };
  }

  const today = todayChicagoDate();
  if (preset === 'today') {
    return { date_from: today, date_to: today };
  }
  if (preset === 'last_30_days') {
    return { date_from: addDays(today, -29), date_to: today };
  }
  return { date_from: addDays(today, -6), date_to: today };
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function supersededNotificationCampaignFailureIds(campaigns = []) {
  const recentCampaigns = /** @type {any[]} */ (Array.isArray(campaigns) ? campaigns : []);
  const supersededIds = new Set();
  for (const campaign of recentCampaigns) {
    const campaignKey = normalizeLower(campaign?.campaign_key);
    if (!campaignKey || normalizeLower(campaign?.status) !== 'failed') continue;
    const failedAt = Date.parse(campaign?.created_date || campaign?.updated_date || '') || 0;
    const supersedingCampaign = recentCampaigns.find(candidate => {
      if (candidate?.id === campaign?.id || normalizeLower(candidate?.campaign_key) !== campaignKey) return false;
      const candidateAt = Date.parse(candidate?.created_date || candidate?.updated_date || '') || 0;
      return candidateAt > failedAt && ['cancelled', 'sent'].includes(normalizeLower(candidate?.status));
    });
    if (supersedingCampaign && numberOrZero(campaign?.sent_count) === 0) supersededIds.add(campaign?.id);
  }
  return supersededIds;
}

function sanitizeCountGroup(group, keys) {
  const result = {};
  for (const key of keys) {
    result[key] = numberOrZero(group?.[key]);
  }
  return result;
}

function sanitizeCountMap(map, limit = 6) {
  return Object.fromEntries(
    Object.entries(map || {})
      .sort((a, b) => numberOrZero(b[1]) - numberOrZero(a[1]) || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([key, value]) => [normalizeLower(key).replace(/\s+/g, '_') || 'not_recorded', numberOrZero(value)]),
  );
}

function sanitizeOpsHealthDetails(details) {
  const review = details?.review_queue || {};
  const commands = details?.commands || {};
  return {
    review_queue: {
      open: numberOrZero(review.open),
      legacy_launch_suppressed: numberOrZero(review.legacy_launch_suppressed),
      internal_test_suppressed: numberOrZero(review.internal_test_suppressed),
      missing_order_number: numberOrZero(review.missing_order_number),
      has_order_number: numberOrZero(review.has_order_number),
      oldest_open_at: normalizeText(review.oldest_open_at) || null,
      newest_open_at: normalizeText(review.newest_open_at) || null,
      by_incident_type: sanitizeCountMap(review.by_incident_type),
      by_source: sanitizeCountMap(review.by_source),
    },
    commands: {
      failed: numberOrZero(commands.failed),
      rejected: numberOrZero(commands.rejected),
      running: numberOrZero(commands.running),
      outside_window_suppressed: numberOrZero(commands.outside_window_suppressed),
    },
  };
}

function sanitizeSummary(summary) {
  return {
    orders: sanitizeCountGroup(summary?.orders, ['total', 'paid', 'fulfilled', 'delivered']),
    production: sanitizeCountGroup(summary?.production, ['batch_count', 'planned_units', 'produced_units']),
    delivery: sanitizeCountGroup(summary?.delivery, ['today_stops', 'tomorrow_stops', 'completed_in_range', 'unscheduled']),
    inventory: sanitizeCountGroup(summary?.inventory, ['low', 'critical', 'out_of_stock', 'demand_based_food', 'stock_tracked']),
    alerts: sanitizeCountGroup(summary?.alerts, ['active', 'critical', 'warning', 'info']),
    source_mix: sanitizeCountGroup(summary?.source_mix, ['one_time', 'subscription', 'pos', 'other']),
    ops_health: sanitizeCountGroup(summary?.ops_health, ['review_open', 'command_failed', 'command_rejected', 'command_running']),
    ops_health_details: sanitizeOpsHealthDetails(summary?.ops_health_details),
  };
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function incrementCount(counts, key) {
  if (!key) return;
  counts[key] = (counts[key] || 0) + 1;
}

function topCountMap(rows, keyFn, limit = 6) {
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeStatus(keyFn(row) || 'not_recorded') || 'not_recorded';
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(counts)
      .sort((a, b) => numberOrZero(b[1]) - numberOrZero(a[1]) || a[0].localeCompare(b[0]))
      .slice(0, limit),
  );
}

function dateWindow(rows, dateFn) {
  const values = (Array.isArray(rows) ? rows : [])
    .map(dateFn)
    .map(normalizeText)
    .filter(Boolean)
    .sort();
  return {
    oldest: values[0] || null,
    newest: values[values.length - 1] || null,
  };
}

function summaryAggregateValue(summary, spec) {
  if (!summary || !spec?.group || !spec?.key) return null;
  return numberOrNull(summary?.[spec.group]?.[spec.key]);
}

function hasDateWindowMismatch({ requestedRange, hubRange }) {
  if (!hubRange?.date_from && !hubRange?.date_to) return false;
  if (requestedRange?.date_from && hubRange?.date_from && requestedRange.date_from !== hubRange.date_from) return true;
  if (requestedRange?.date_to && hubRange?.date_to && requestedRange.date_to !== hubRange.date_to) return true;
  return false;
}

function sourceOfTruthIsHold(sourceOfTruth) {
  return ['payment_provider_hub', 'subscription_hub', 'manual_review', 'not_comparable', 'unknown'].includes(sourceOfTruth);
}

function compareAggregateValues(nativeValue, hubValue) {
  if (nativeValue === null || nativeValue === undefined || hubValue === null || hubValue === undefined) {
    return {
      comparison_available: false,
      mismatch_detected: false,
      direction: null,
    };
  }

  if (nativeValue === hubValue) {
    return {
      comparison_available: true,
      mismatch_detected: false,
      direction: 'match',
    };
  }

  return {
    comparison_available: true,
    mismatch_detected: true,
    direction: nativeValue < hubValue ? 'native_count_lower_than_hub' : 'hub_count_lower_than_native',
  };
}

function aggregateMismatchCategory(spec, comparison, { dateWindowMismatch }) {
  if (dateWindowMismatch && spec?.domain !== 'inventory_po') return 'date_window_mismatch';
  if (!comparison.comparison_available) {
    if (comparison.direction) return comparison.direction;
    return 'not_comparable';
  }
  if (!comparison.mismatch_detected) return null;
  return spec?.mismatch_category || comparison.direction || 'unknown_manual_review_needed';
}

function aggregateDiagnosticForSpec({
  spec,
  displayedSummary,
  nativeSummary,
  hubSummary,
  currentDisplaySource,
  requestedRange,
  hubRange,
  deliveryCompletedGuard,
}) {
  const displayedValue = summaryAggregateValue(displayedSummary, spec);
  const nativeValue = summaryAggregateValue(nativeSummary, spec);
  const hubValue = summaryAggregateValue(hubSummary, spec);
  const comparison = compareAggregateValues(nativeValue, hubValue);
  const dateWindowMismatch = hasDateWindowMismatch({ requestedRange, hubRange });
  const comparisonAvailable = comparison.comparison_available && !dateWindowMismatch;
  const mismatchCategory = aggregateMismatchCategory(spec, comparison, { dateWindowMismatch });
  const mismatchDetected = Boolean(mismatchCategory) && mismatchCategory !== 'not_comparable';
  const sourceOfTruth = comparisonAvailable ? spec.source_of_truth : (spec.source_of_truth || 'not_comparable');
  const sourceHold = sourceOfTruthIsHold(sourceOfTruth) || Boolean(spec.blocker);
  const nativeAuthority = sourceOfTruth === 'customer_app_native'
    || sourceOfTruth === 'customer_app_payment_projection';
  const nativeFirstReady = nativeAuthority
    ? nativeValue !== null && nativeValue !== undefined && !sourceHold
    : Boolean(spec.native_first_candidate_if_match)
      && comparisonAvailable
      && !mismatchDetected
      && !sourceHold;
  const nativeDisplayActive = currentDisplaySource === 'native_primary'
    || currentDisplaySource === 'customer_app_native_authoritative';
  const fallbackRequired = nativeAuthority
    ? false
    : !nativeFirstReady || !nativeDisplayActive;
  const reviewRequired = mismatchDetected || sourceOfTruth === 'manual_review' || sourceOfTruth === 'unknown' || sourceOfTruth === 'not_comparable';
  const blocker = nativeAuthority || nativeFirstReady
    ? null
    : spec.blocker || (comparisonAvailable ? null : 'aggregate_comparison_not_available');
  const fallbackReason = fallbackRequired
    ? (blocker || mismatchCategory || `${spec.domain || 'aggregate'}_current_display_preserved`)
    : null;

  const diagnostic = {
    aggregate_name: spec.name,
    displayed_value: displayedValue,
    current_display_source: currentDisplaySource,
    native_value: comparisonAvailable || nativeValue !== null ? nativeValue : null,
    hub_value: comparisonAvailable || hubValue !== null ? hubValue : null,
    comparison_available: comparisonAvailable,
    mismatch_detected: mismatchDetected,
    mismatch_category: mismatchCategory,
    source_of_truth: sourceOfTruth,
    native_first_ready: nativeFirstReady,
    fallback_required: fallbackRequired,
    review_required: reviewRequired,
    blocker,
    recommendation: spec.recommendation || 'keep_current_display_until_aggregate_parity_is_proven',
  };

  if (spec.name === 'delivery.completed_in_range' && deliveryCompletedGuard) {
    const guardMismatch = Boolean(deliveryCompletedGuard.mismatch_guard);
    return {
      ...diagnostic,
      displayed_value: deliveryCompletedGuard.final_value,
      current_display_source: deliveryCompletedGuard.display_source,
      native_value: deliveryCompletedGuard.native_value,
      hub_value: deliveryCompletedGuard.hub_value,
      comparison_available: deliveryCompletedGuard.comparison_available,
      mismatch_detected: guardMismatch,
      mismatch_category: guardMismatch ? 'delivered_completed_semantic_mismatch' : null,
      source_of_truth: deliveryCompletedGuard.guard_passed ? 'native_route_date' : diagnostic.source_of_truth,
      native_first_ready: deliveryCompletedGuard.guard_passed,
      fallback_required: !deliveryCompletedGuard.guard_passed,
      review_required: deliveryCompletedGuard.guard_passed ? false : diagnostic.review_required,
      blocker: deliveryCompletedGuard.guard_passed ? null : diagnostic.blocker || deliveryCompletedGuard.guard_reason,
      recommendation: deliveryCompletedGuard.guard_passed
        ? 'native_route_date_semantic_applied'
        : diagnostic.recommendation,
    };
  }

  if (
    spec.name === 'delivery.unscheduled' &&
    currentDisplaySource === 'hub_primary_with_native_operations_overlay' &&
    displayedValue === nativeValue &&
    numberOrZero(nativeValue) > numberOrZero(hubValue)
  ) {
    return {
      ...diagnostic,
      mismatch_detected: false,
      mismatch_category: null,
      source_of_truth: 'native_unscheduled_delivery_overlay',
      native_first_ready: true,
      fallback_required: false,
      review_required: false,
      blocker: null,
      recommendation: 'native_unscheduled_delivery_overlay_applied',
    };
  }

  return diagnostic;
}

function buildOperationsDashboardDiagnostics({
  displayedSummary,
  nativeSummary,
  hubSummary,
  currentDisplaySource,
  requestedRange,
  hubRange,
  deliveryCompletedGuard,
}) {
  const aggregateDiagnostics = G39N_AGGREGATE_SPECS.map(spec => aggregateDiagnosticForSpec({
    spec,
    displayedSummary,
    nativeSummary,
    hubSummary,
    currentDisplaySource,
    requestedRange,
    hubRange,
    deliveryCompletedGuard,
  }));

  const aggregateMismatchCategories = {};
  const sourceOfTruthHolds = {};
  const fallbackReasons = {};
  let nativeAggregateCount = 0;
  let hubAggregateCount = 0;
  let mixedAggregateCount = 0;
  let aggregateMismatchCount = 0;
  let sourceOfTruthHoldCount = 0;
  let fallbackRequiredCount = 0;
  let reviewRequiredCount = 0;
  let nativeFirstReadyAggregateCount = 0;
  let hubSourceOfTruthAggregateCount = 0;
  let blockedAggregateCount = 0;

  for (const diagnostic of aggregateDiagnostics) {
    if (diagnostic.native_value !== null && diagnostic.native_value !== undefined) nativeAggregateCount += 1;
    if (diagnostic.hub_value !== null && diagnostic.hub_value !== undefined) hubAggregateCount += 1;
    if (
      diagnostic.native_value !== null
      && diagnostic.native_value !== undefined
      && diagnostic.hub_value !== null
      && diagnostic.hub_value !== undefined
    ) {
      mixedAggregateCount += 1;
    }
    if (diagnostic.mismatch_detected) {
      aggregateMismatchCount += 1;
      incrementCount(aggregateMismatchCategories, diagnostic.mismatch_category);
    }
    if (sourceOfTruthIsHold(diagnostic.source_of_truth) || diagnostic.blocker) {
      sourceOfTruthHoldCount += 1;
      incrementCount(sourceOfTruthHolds, diagnostic.source_of_truth);
    }
    if (diagnostic.fallback_required) {
      fallbackRequiredCount += 1;
      incrementCount(fallbackReasons, diagnostic.blocker || diagnostic.mismatch_category || 'current_display_preserved');
    }
    if (diagnostic.review_required) reviewRequiredCount += 1;
    if (diagnostic.native_first_ready) nativeFirstReadyAggregateCount += 1;
    if (['hub', 'payment_provider_hub', 'subscription_hub'].includes(diagnostic.source_of_truth)) {
      hubSourceOfTruthAggregateCount += 1;
    }
    if (diagnostic.blocker) blockedAggregateCount += 1;
  }

  return {
    operations_dashboard_diagnostics_enabled: true,
    operations_dashboard_diagnostics_marker: G39N_DIAGNOSTICS_MARKER,
    operations_dashboard_delivery_completed_marker: deliveryCompletedGuard?.marker || G39Q_DELIVERY_COMPLETED_MARKER,
    native_first_enabled: currentDisplaySource === 'customer_app_native_authoritative',
    hub_primary_enabled: currentDisplaySource !== 'customer_app_native_authoritative',
    hub_fallback_active: false,
    dashboard_source_mode: currentDisplaySource === 'customer_app_native_authoritative'
      ? 'customer_app_native_authoritative'
      : 'historical_diagnostics_only',
    delivery_completed_in_range_native_primary_enabled: deliveryCompletedGuard?.enabled === true,
    delivery_completed_in_range_guard_passed: deliveryCompletedGuard?.guard_passed === true,
    delivery_completed_in_range_guard_reason: deliveryCompletedGuard?.guard_reason || 'native_route_date_guard_not_evaluated',
    delivery_completed_in_range_display_source: deliveryCompletedGuard?.display_source || currentDisplaySource,
    delivery_completed_in_range_semantic: 'route_delivery_date_completed_status',
    completed_delivery_date_bucket: 'delivery_date_then_scheduled_date_then_assigned_delivery_date',
    completed_delivery_native_source: 'native_fulfillment_task_route_date',
    completed_delivery_hub_source: 'current_hub_or_dashboard_summary',
    delivery_completed_in_range_native_value: deliveryCompletedGuard?.native_value ?? null,
    delivery_completed_in_range_previous_display_value: deliveryCompletedGuard?.previous_display_value ?? null,
    delivery_completed_in_range_hub_value: deliveryCompletedGuard?.hub_value ?? null,
    delivery_completed_in_range_mismatch_guard: deliveryCompletedGuard?.mismatch_guard === true,
    writes_performed: false,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    customer_facing_behavior_changed: false,
    aggregate_count: aggregateDiagnostics.length,
    aggregate_mismatch_count: aggregateMismatchCount,
    native_aggregate_count: nativeAggregateCount,
    hub_aggregate_count: hubAggregateCount,
    mixed_aggregate_count: mixedAggregateCount,
    source_of_truth_hold_count: sourceOfTruthHoldCount,
    fallback_required_count: fallbackRequiredCount,
    review_required_count: reviewRequiredCount,
    native_first_ready_aggregate_count: nativeFirstReadyAggregateCount,
    hub_source_of_truth_aggregate_count: hubSourceOfTruthAggregateCount,
    blocked_aggregate_count: blockedAggregateCount,
    aggregate_mismatch_categories: aggregateMismatchCategories,
    source_of_truth_holds: sourceOfTruthHolds,
    fallback_reasons: fallbackReasons,
    aggregate_diagnostics: aggregateDiagnostics,
  };
}

function dateKey(value) {
  const text = normalizeText(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function inRange(value, from, to) {
  const key = dateKey(value);
  return key && key >= from && key <= to;
}

function normalizeOrderNumber(value) {
  return normalizeLower(value).replace(/^#/, '');
}

function normalizeStatus(value) {
  return normalizeLower(value).replace(/\s+/g, '_');
}

function uniqueByOrderNumber(rows) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = normalizeOrderNumber(row?.order_number || row?.shopify_order_number || row?.id);
    if (key && !map.has(key)) map.set(key, row);
  }
  return [...map.values()];
}

function orderReferenceDate(order) {
  return (
    order?.customer_order_date ||
    order?.created_date ||
    order?.shopify_synced_at ||
    order?.updated_date ||
    order?.estimated_delivery_date ||
    order?.assigned_delivery_date ||
    null
  );
}

function isInRecentUnscheduledWindow(referenceDate, dateFrom, dateTo) {
  const key = dateKey(referenceDate);
  if (!key || !dateFrom || !dateTo) return false;
  const reviewStart = addDays(dateFrom, -UNSCHEDULED_NATIVE_ORDER_REVIEW_DAYS);
  return key >= reviewStart && key <= dateTo;
}

function orderMatchesSource(order, sourceType, sourceChannel) {
  if (!sourceType && !sourceChannel) return true;
  const type = normalizeLower(order?.source_type || order?.order_type || order?.fulfillment_type);
  const channel = normalizeLower(order?.source_channel || (order?.is_pos_order ? 'pos' : ''));
  if (sourceType && type !== normalizeLower(sourceType)) return false;
  if (sourceChannel && channel !== normalizeLower(sourceChannel)) return false;
  return true;
}

function isPaidOrder(order) {
  const paymentStatus = normalizeStatus(order?.payment_status || order?.financial_status);
  return order?.payment_captured === true || ['paid', 'captured', 'succeeded'].includes(paymentStatus);
}

function isFulfilledOrder(order) {
  const statuses = [
    order?.status,
    order?.fulfillment_status,
    order?.production_status,
    order?.delivery_status,
  ].map(normalizeStatus);
  return statuses.some(status => [
    'fulfilled',
    'delivered',
    'picked_up',
  ].includes(status));
}

function isDeliveredOrder(order) {
  const statuses = [
    order?.status,
    order?.fulfillment_status,
    order?.delivery_status,
    order?.production_status,
  ].map(normalizeStatus);
  return Boolean(order?.delivered_at) || statuses.some(status => ['delivered', 'picked_up', 'fulfilled'].includes(status));
}

function isInactiveOrder(order) {
  const statuses = [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    order?.fulfillment_status,
    order?.delivery_status,
  ].map(normalizeStatus);
  return statuses.some(status => ['cancelled', 'canceled', 'refunded', 'voided', 'failed'].includes(status));
}

function orderDeliveryDate(order) {
  return (
    order?.delivery_date ||
    order?.selected_delivery_date ||
    order?.requested_delivery_date ||
    order?.assigned_delivery_date ||
    order?.scheduled_delivery_date ||
    order?.estimated_delivery_date ||
    order?.delivery_window_date ||
    null
  );
}

function isDeliveryOrder(order) {
  const signals = [
    order?.fulfillment_type,
    order?.fulfillment_method,
    order?.delivery_method,
    order?.shipping_method,
    order?.source_type,
  ].map(normalizeStatus);
  return signals.includes('delivery') || Boolean(order?.delivery_address || order?.shipping_address);
}

function orderTaskKeys(order) {
  return [
    order?.id,
    order?.base44_order_id,
    order?.order_number,
    order?.shopify_order_number,
  ].map(normalizeOrderNumber).filter(Boolean);
}

function taskOrderKeys(task) {
  return [
    task?.order_id,
    task?.base44_order_id,
    task?.order_number,
    task?.shopify_order_number,
  ].map(normalizeOrderNumber).filter(Boolean);
}

function taskReferenceDate(task) {
  return task?.created_date || task?.updated_date || task?.order_created_date || null;
}

function countUnscheduledDeliveryWork(orders, deliveryTasks, { dateFrom, dateTo } = {}) {
  const taskKeys = new Set();
  let unscheduledTaskCount = 0;
  for (const task of Array.isArray(deliveryTasks) ? deliveryTasks : []) {
    taskOrderKeys(task).forEach(key => taskKeys.add(key));
    if (!taskDate(task) && !isCompletedTask(task) && isInRecentUnscheduledWindow(taskReferenceDate(task), dateFrom, dateTo)) {
      unscheduledTaskCount += 1;
    }
  }

  let unscheduledOrderCount = 0;
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!isDeliveryOrder(order)) continue;
    if (!isPaidOrder(order) || isDeliveredOrder(order) || isInactiveOrder(order)) continue;
    if (orderDeliveryDate(order)) continue;
    if (!isInRecentUnscheduledWindow(orderReferenceDate(order), dateFrom, dateTo)) continue;
    if (orderTaskKeys(order).some(key => taskKeys.has(key))) continue;
    unscheduledOrderCount += 1;
  }

  return unscheduledTaskCount + unscheduledOrderCount;
}

function classifyOrderSource(order) {
  const sourceChannel = normalizeLower(order?.source_channel);
  const sourceType = normalizeLower(order?.source_type || order?.order_type || order?.fulfillment_type);
  const fulfillmentMethod = normalizeLower(order?.fulfillment_method);
  if (order?.is_pos_order === true || sourceChannel === 'pos' || sourceType === 'pos' || fulfillmentMethod === 'pos') return 'pos';
  if (order?.is_subscription === true || order?.stripe_subscription_id || sourceChannel === 'subscription' || sourceType === 'subscription') return 'subscription';
  if (sourceChannel || sourceType || Array.isArray(order?.line_items) || Array.isArray(order?.items)) return 'one_time';
  return 'other';
}

function taskDate(task) {
  return task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date || null;
}

function taskRouteDate(task) {
  return task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date || null;
}

function isCompletedTask(task) {
  return ['delivered', 'picked_up', 'fulfilled', 'completed'].includes(normalizeStatus(task?.status || task?.delivery_status));
}

function buildOrderContextIndex(customerOrders, shopifyOrders) {
  const index = new Map();
  const add = (key, order) => {
    const normalized = normalizeLower(key);
    if (normalized && order && !index.has(normalized)) index.set(normalized, order);
  };

  for (const order of [...(customerOrders || []), ...(shopifyOrders || [])]) {
    add(order?.id, order);
    add(order?.base44_order_id, order);
    add(order?.order_number, order);
    add(order?.shopify_order_number, order);
  }

  return index;
}

function orderContextForTask(task, orderIndex) {
  return (
    orderIndex.get(normalizeLower(task?.order_id)) ||
    orderIndex.get(normalizeLower(task?.base44_order_id)) ||
    orderIndex.get(normalizeLower(task?.order_number)) ||
    {}
  );
}

function deliveryCompletedTaskBlockers(task, order = {}) {
  const blockers = [];
  const signals = [
    task?.source_type,
    task?.source_channel,
    task?.order_type,
    task?.fulfillment_type,
    task?.fulfillment_method,
    order?.source_type,
    order?.source_channel,
    order?.order_type,
    order?.fulfillment_type,
    order?.fulfillment_method,
  ].map(normalizeStatus);

  if (
    task?.is_subscription === true ||
    order?.is_subscription === true ||
    task?.subscription_id ||
    order?.stripe_subscription_id ||
    signals.some(signal => ['subscription', 'multi_delivery', 'multidelivery', 'recurring'].includes(signal))
  ) {
    blockers.push('subscription_multi_delivery_ambiguity');
  }

  if (
    task?.repair_context === true ||
    task?.replay_context === true ||
    task?.safe_sync_context === true ||
    order?.repair_context === true ||
    order?.replay_context === true ||
    order?.safe_sync_context === true ||
    signals.some(signal => ['repair', 'replay', 'safe_sync', 'safesync'].includes(signal))
  ) {
    blockers.push('repair_replay_safesync_ambiguity');
  }

  if (task?.provider_call_required === true || order?.provider_call_required === true) {
    blockers.push('provider_call_required');
  }

  if (task?.notification_required === true || order?.notification_required === true) {
    blockers.push('notification_required');
  }

  if (
    task?.hub_mutation_required === true ||
    order?.hub_mutation_required === true ||
    task?.write_required === true ||
    order?.write_required === true
  ) {
    blockers.push('write_or_hub_mutation_required');
  }

  return blockers;
}

function computeNativeCompletedDeliveriesInRangeByRouteDate({
  deliveryTasks,
  customerOrders,
  shopifyOrders,
  dateFrom,
  dateTo,
}) {
  const orderIndex = buildOrderContextIndex(customerOrders, shopifyOrders);
  const blockers = [];
  let value = 0;
  let includedRowCount = 0;

  for (const task of Array.isArray(deliveryTasks) ? deliveryTasks : []) {
    if (!isCompletedTask(task)) continue;
    const routeDate = taskRouteDate(task);
    if (!inRange(routeDate, dateFrom, dateTo)) continue;

    includedRowCount += 1;
    value += 1;

    const order = orderContextForTask(task, orderIndex);
    blockers.push(...deliveryCompletedTaskBlockers(task, order));
  }

  return {
    computation_available: true,
    value,
    included_row_count: includedRowCount,
    blocker_reasons: [...new Set(blockers)],
    date_bucket: 'delivery_date_then_scheduled_date_then_assigned_delivery_date',
    semantic: 'route_delivery_date_completed_status',
    native_source: 'native_fulfillment_task_route_date',
  };
}

function buildDeliveryCompletedInRangeGuard({ currentSummary, nativeRouteDateResult, hubSummary, currentDisplaySource }) {
  const previousDisplayValue = summaryAggregateValue(currentSummary, {
    group: 'delivery',
    key: 'completed_in_range',
  });
  const hubValue = summaryAggregateValue(hubSummary, {
    group: 'delivery',
    key: 'completed_in_range',
  });
  const nativeValue = numberOrNull(nativeRouteDateResult?.value);
  const comparisonValue = hubValue ?? previousDisplayValue;
  const comparisonAvailable = nativeRouteDateResult?.computation_available === true
    && nativeValue !== null
    && comparisonValue !== null;
  const blockerReasons = [...new Set(nativeRouteDateResult?.blocker_reasons || [])];
  const mismatchDetected = comparisonAvailable && nativeValue !== comparisonValue;
  const guardPassed = comparisonAvailable && blockerReasons.length === 0;
  const guardReason = guardPassed
    ? 'native_route_date_semantic_applied'
    : blockerReasons[0] || (comparisonAvailable ? 'native_route_date_guard_failed' : 'native_route_date_comparison_unavailable');

  return {
    marker: G39Q_DELIVERY_COMPLETED_MARKER,
    enabled: guardPassed,
    guard_passed: guardPassed,
    guard_reason: guardReason,
    display_source: guardPassed ? 'native_route_date' : 'current_display_fallback',
    semantic: 'route_delivery_date_completed_status',
    date_bucket: nativeRouteDateResult?.date_bucket || 'delivery_date_then_scheduled_date_then_assigned_delivery_date',
    native_source: nativeRouteDateResult?.native_source || 'native_fulfillment_task_route_date',
    hub_source: 'current_hub_or_dashboard_summary',
    native_value: nativeValue,
    previous_display_value: previousDisplayValue,
    hub_value: hubValue,
    final_value: guardPassed ? nativeValue : previousDisplayValue,
    comparison_available: comparisonAvailable,
    mismatch_guard: mismatchDetected,
    mismatch_category: mismatchDetected ? 'delivered_completed_semantic_mismatch' : null,
    blocker_reasons: blockerReasons,
    current_display_source: currentDisplaySource,
  };
}

function applyDeliveryCompletedInRangeGuard(summary, guard) {
  return {
    ...summary,
    delivery: {
      ...(summary?.delivery || {}),
      completed_in_range: numberOrZero(guard?.final_value),
    },
  };
}

function buildNativeProductionOverlay(hubSummary, nativeSummary) {
  const hubProduction = sanitizeCountGroup(hubSummary?.production, ['batch_count', 'planned_units', 'produced_units']);
  const nativeProduction = sanitizeCountGroup(nativeSummary?.production, ['batch_count', 'planned_units', 'produced_units']);
  const nativeHasProduction = nativeProduction.batch_count > 0 || nativeProduction.planned_units > 0 || nativeProduction.produced_units > 0;
  const hubMissingProduction = hubProduction.batch_count === 0 && hubProduction.planned_units === 0 && hubProduction.produced_units === 0;
  const nativeMoreComplete = nativeProduction.batch_count > hubProduction.batch_count ||
    nativeProduction.planned_units > hubProduction.planned_units ||
    nativeProduction.produced_units > hubProduction.produced_units;
  return {
    applied: nativeHasProduction && (hubMissingProduction || nativeMoreComplete),
    hub_production: hubProduction,
    native_production: nativeProduction,
    reason: hubMissingProduction
      ? 'hub_missing_current_production'
      : nativeMoreComplete
        ? 'native_current_production_more_complete'
        : 'hub_production_retained',
  };
}

function applyNativeProductionOverlay(summary, overlay) {
  if (!overlay?.applied) return summary;
  return {
    ...summary,
    production: {
      ...(summary?.production || {}),
      ...overlay.native_production,
    },
  };
}

function buildNativeDeliveryOverlay(hubSummary, nativeSummary) {
  const hubDelivery = sanitizeCountGroup(hubSummary?.delivery, ['today_stops', 'tomorrow_stops', 'completed_in_range', 'unscheduled']);
  const nativeDelivery = sanitizeCountGroup(nativeSummary?.delivery, ['today_stops', 'tomorrow_stops', 'completed_in_range', 'unscheduled']);
  return {
    applied: nativeDelivery.unscheduled > hubDelivery.unscheduled,
    hub_delivery: hubDelivery,
    native_delivery: nativeDelivery,
  };
}

function applyNativeDeliveryOverlay(summary, overlay) {
  if (!overlay?.applied) return summary;
  return {
    ...summary,
    delivery: {
      ...(summary?.delivery || {}),
      unscheduled: overlay.native_delivery.unscheduled,
    },
  };
}

function responseData(response) {
  return response?.data || response || {};
}

function inventoryStatusSummaryToDashboardCounts(summary) {
  return {
    low: numberOrZero(summary?.low_stock_count),
    critical: numberOrZero(summary?.critical_count),
    out_of_stock: numberOrZero(summary?.out_of_stock_count),
    demand_based_food: numberOrZero(summary?.demand_based_food_count),
    stock_tracked: numberOrZero(summary?.stock_tracked_item_count),
  };
}

function buildNativeInventoryPolicyOverlay(hubSummary, nativeSummary) {
  const hubInventory = sanitizeCountGroup(hubSummary?.inventory, ['low', 'critical', 'out_of_stock', 'demand_based_food', 'stock_tracked']);
  const nativeInventory = sanitizeCountGroup(nativeSummary?.inventory, ['low', 'critical', 'out_of_stock', 'demand_based_food', 'stock_tracked']);
  const nativeHasInventoryPolicy = nativeInventory.stock_tracked > 0 || nativeInventory.demand_based_food > 0;
  return {
    applied: nativeHasInventoryPolicy,
    hub_inventory: hubInventory,
    native_inventory: nativeInventory,
    reason: nativeHasInventoryPolicy
      ? 'native_food_demand_based_inventory_policy_applied'
      : 'native_inventory_policy_unavailable',
  };
}

async function buildInventoryPolicyOverlay(base44, hubSummary, nativeSummary) {
  const fallback = buildNativeInventoryPolicyOverlay(hubSummary, nativeSummary);
  const invoke = base44?.asServiceRole?.functions?.invoke;
  if (!invoke) return fallback;

  try {
    const inventorySummary = responseData(await invoke('getAdminInventoryStatusSummary', { limit: 200 }));
    const dataSources = inventorySummary?.data_sources || {};
    const mergedInventory = inventoryStatusSummaryToDashboardCounts(inventorySummary?.summary || {});
    const mergedPolicyAvailable = dataSources.food_inventory_policy === 'food_and_juice_make_to_order' &&
      dataSources.food_stock_warnings_suppressed === true;
    if (!mergedPolicyAvailable) return fallback;

    return {
      ...fallback,
      applied: true,
      merged_inventory: mergedInventory,
      inventory_summary_source: 'getAdminInventoryStatusSummary',
      reason: 'merged_food_demand_based_inventory_policy_applied',
    };
  } catch {
    return {
      ...fallback,
      reason: fallback.applied
        ? 'native_food_demand_based_inventory_policy_applied_inventory_summary_unavailable'
        : 'inventory_policy_summary_unavailable',
    };
  }
}

function applyNativeInventoryPolicyOverlay(summary, overlay) {
  if (!overlay?.applied) return summary;
  const inventory = overlay.merged_inventory || overlay.native_inventory;
  return {
    ...summary,
    inventory: {
      ...(summary?.inventory || {}),
      ...inventory,
    },
  };
}

function buildNativeOpsHealthOverlay(summary, nativeSummary) {
  const nativeOpsHealth = nativeSummary?.ops_health || {};
  const activeCount = numberOrZero(nativeOpsHealth.review_open) +
    numberOrZero(nativeOpsHealth.command_failed) +
    numberOrZero(nativeOpsHealth.command_rejected) +
    numberOrZero(nativeOpsHealth.command_running);
  return {
    applied: activeCount > 0,
    native_ops_health: sanitizeCountGroup(nativeSummary?.ops_health, ['review_open', 'command_failed', 'command_rejected', 'command_running']),
    native_ops_health_details: sanitizeOpsHealthDetails(nativeSummary?.ops_health_details),
    previous_ops_health: sanitizeCountGroup(summary?.ops_health, ['review_open', 'command_failed', 'command_rejected', 'command_running']),
    reason: activeCount > 0 ? 'native_current_ops_health_overlay_applied' : 'native_current_ops_health_clear',
  };
}

function applyNativeOpsHealthOverlay(summary, overlay) {
  return {
    ...summary,
    ops_health: overlay?.native_ops_health || sanitizeCountGroup(summary?.ops_health, ['review_open', 'command_failed', 'command_rejected', 'command_running']),
    ops_health_details: overlay?.native_ops_health_details || sanitizeOpsHealthDetails(summary?.ops_health_details),
  };
}

function deliveryCompletedWarnings(guard) {
  if (!guard?.guard_passed) return [];
  return [
    'delivery_completed_in_range_uses_g39d_route_date_semantic',
    'delivered_at_is_audit_only_not_bucket',
    guard.mismatch_guard ? 'hub_current_display_may_differ_for_single_day_windows' : null,
  ].filter(Boolean);
}

function alertDate(row) {
  return row?.last_seen_at || row?.created_date || row?.updated_date || null;
}

function isActiveAlert(row) {
  return !['resolved', 'archived', 'closed', 'dismissed'].includes(normalizeStatus(row?.status));
}

function alertSeverity(row) {
  return normalizeStatus(row?.severity || row?.priority || row?.level || row?.incident_type);
}

function commandStatus(row) {
  return normalizeStatus(row?.status);
}

function commandReferenceDate(row) {
  return row?.updated_date || row?.completed_at || row?.failed_at || row?.created_date;
}

function isOpenReviewItem(row) {
  return ['pending', 'reviewing'].includes(normalizeStatus(row?.status));
}

function isLegacyLaunchReviewQueueNoise(row) {
  const source = normalizeStatus(row?.incoming_source);
  const incident = normalizeStatus(row?.incident_type);
  const existingOrder = normalizeOrderNumber(row?.existing_order_number || row?.order_number || row?.shopify_order_number);
  const recommendedAction = normalizeStatus(row?.recommended_action);
  const referenceTimestamp = Date.parse(String(row?.last_seen_at || row?.updated_date || row?.created_date || ''));
  const isStale = Number.isFinite(referenceTimestamp) && referenceTimestamp < Date.now() - 30 * 24 * 60 * 60 * 1000;
  return source === 'shopify_pos' &&
    incident === 'payment_not_paid' &&
    !existingOrder &&
    recommendedAction === 'manual_review_before_operational_processing' &&
    isStale;
}

function isInternalTestReviewQueueItem(row) {
  if (row?.is_test_record === true || row?.is_test_order === true || row?.internal_test === true) return true;
  const orderRef = normalizeOrderNumber(row?.existing_order_number || row?.order_number || row?.shopify_order_number);
  return orderRef.startsWith('nv-test-') || orderRef.includes('-test-');
}

function isFoodInventoryItem(item) {
  return FOOD_STOCK_EXCLUDED_CATEGORIES.has(normalizeLower(item?.category));
}

function inventoryStatus(item) {
  if (isFoodInventoryItem(item)) return 'demand_based';
  const stock = Number(item?.stock);
  const reorderPoint = Number(item?.reorder_point);
  if (!Number.isFinite(stock)) return 'unknown';
  if (stock <= 0) return 'out_of_stock';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint * 0.5) return 'critical';
  if (Number.isFinite(reorderPoint) && reorderPoint > 0 && stock <= reorderPoint) return 'low';
  return 'ok';
}

async function listEntity(base44, entityName, sort, limit = 500) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.list !== 'function') return [];
  return await entity.list(sort, limit).catch(error => {
    console.warn(`[getAdminOperationsDashboardSummary] Native ${entityName} unavailable:`, error.message);
    return [];
  });
}

function sanitizeBackendId(value, maxLength = 160) {
  return normalizeText(value).replace(/[^A-Za-z0-9._:@/#-]/g, '').slice(0, maxLength);
}

function sanitizeBackendDisplay(value, maxLength = 120) {
  const text = normalizeText(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function backendReadinessDate(row, fields) {
  for (const field of fields) {
    const match = normalizeText(row?.[field]).match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  return '';
}

function recentBackendIso(value, sinceMs) {
  const time = Date.parse(normalizeText(value));
  return Number.isFinite(time) && time >= sinceMs;
}

function backendBatchDisplayId(batch) {
  return sanitizeBackendDisplay(batch?.batch_id || batch?.id, 140) || 'unknown_batch';
}

function backendTaskDisplayId(task) {
  return sanitizeBackendDisplay(task?.fulfillment_task_id || task?.order_number || task?.shopify_order_number || task?.id, 140) || 'unknown_task';
}

function backendOrderNumber(value) {
  return sanitizeBackendDisplay(value, 80).replace(/^#/, '').toUpperCase();
}

function isBackendTestBatch(batch) {
  return isInternalTestProductionBatch(batch);
}

function isBackendTestTask(task) {
  const id = normalizeLower(task?.fulfillment_task_id || task?.id || task?.order_number);
  return task?.is_test_task === true || id.includes('-test-') || normalizeLower(task?.test_purpose).includes('internal');
}

function backendListRefs(value) {
  const values = Array.isArray(value) ? value : normalizeText(value).split(',');
  return new Set(values.map(item => sanitizeBackendId(item)).filter(Boolean));
}

function backendComplianceMatches(record, batch) {
  const sourceBatchId = sanitizeBackendId(batch?.id);
  const displayBatchId = sanitizeBackendId(batch?.batch_id);
  const sourceRefs = backendListRefs(record?.related_source_production_batch_ids);
  const displayRefs = backendListRefs(record?.related_batch_ids);
  const recordSource = sanitizeBackendId(record?.source_production_batch_id);
  const recordBatch = sanitizeBackendId(record?.batch_id);
  return Boolean(
    (sourceBatchId && (recordSource === sourceBatchId || sourceRefs.has(sourceBatchId))) ||
    (displayBatchId && (recordBatch === displayBatchId || displayRefs.has(displayBatchId)))
  );
}

function backendReadinessIssue({ severity, domain, code, entityType, displayId, status, recommendation }) {
  return {
    severity,
    domain,
    code,
    entity_type: entityType || null,
    display_id: sanitizeBackendDisplay(displayId, 140) || null,
    status: sanitizeBackendDisplay(status, 80) || null,
    recommendation,
  };
}

function backendCommandTargetKey(command) {
  return sanitizeBackendId(command?.target_id || command?.target_display_id);
}

function backendCommandType(command) {
  return normalizeLower(command?.command_type);
}

function addBackendTestRefs(refs, row, fields) {
  for (const field of fields) {
    const value = sanitizeBackendId(row?.[field]);
    if (value) refs.add(value);
  }
}

function isBackendInternalCommand(command, { testBatchRefs, testTaskRefs }) {
  const payload = command?.payload || {};
  const commandType = backendCommandType(command);
  const targetEntity = normalizeLower(command?.target_entity);
  const targetRefs = [
    command?.target_id,
    command?.target_display_id,
    payload?.target_id,
    payload?.target_display_id,
    payload?.batch_id,
    payload?.production_batch_id,
    payload?.fulfillment_task_id,
    payload?.task_id,
  ].map(value => sanitizeBackendId(value)).filter(Boolean);

  if (payload?.is_test_batch === true || payload?.is_test_task === true || command?.is_test_record === true) return true;
  if (normalizeLower(payload?.test_purpose || command?.test_purpose).includes('internal')) return true;
  if (commandType.includes('g53') && commandType.includes('test')) return true;
  if (targetEntity === 'productionbatch' && targetRefs.some(ref => testBatchRefs.has(ref))) return true;
  if (targetEntity === 'fulfillmenttask' && targetRefs.some(ref => testTaskRefs.has(ref))) return true;
  return false;
}

async function buildOperationalBackendReadiness(base44, { dateFrom, dateTo, actorRole }) {
  const [
    batchesRaw,
    tasksRaw,
    ordersRaw,
    shopifyOrdersRaw,
    sanitationLogs,
    dailyChecklists,
    temperatureLogs,
    batchComplianceLogs,
    commandLogs,
    orderSyncLogs,
    campaigns,
  ] = await Promise.all([
    listEntity(base44, 'ProductionBatch', 'production_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'FulfillmentTask', '-delivery_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'Order', '-created_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'ShopifyOrder', '-updated_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'SanitationLog', '-created_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'DailyChecklist', '-created_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'TemperatureLog', '-created_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'BatchComplianceLog', '-created_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'CommandLog', '-created_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'OrderSyncLog', '-created_date', BACKEND_READINESS_MAX_ROWS),
    listEntity(base44, 'NotificationCampaign', '-created_date', 100),
  ]);

  const batches = batchesRaw.filter(batch => {
    const productionDate = backendReadinessDate(batch, ['production_date']);
    return productionDate && productionDate >= dateFrom && productionDate <= dateTo;
  });
  const tasks = tasksRaw.filter(task => {
    const routeDate = backendReadinessDate(task, ['delivery_date', 'assigned_delivery_date', 'scheduled_date']);
    return routeDate && routeDate >= dateFrom && routeDate <= dateTo;
  });

  const orderIndex = new Map();
  for (const order of ordersRaw) {
    const number = backendOrderNumber(order?.order_number);
    if (number && !orderIndex.has(number)) orderIndex.set(number, order);
  }

  const syncOrderNumbers = new Set(orderSyncLogs.map(row => backendOrderNumber(row?.order_number)).filter(Boolean));
  const syncOrderIds = new Set(orderSyncLogs.map(row => sanitizeBackendId(row?.order_id)).filter(Boolean));
  const testBatchRefs = new Set();
  const testTaskRefs = new Set();
  for (const batch of batchesRaw.filter(isBackendTestBatch)) {
    addBackendTestRefs(testBatchRefs, batch, ['id', 'batch_id', 'native_batch_id']);
  }
  for (const task of tasksRaw.filter(isBackendTestTask)) {
    addBackendTestRefs(testTaskRefs, task, ['id', 'fulfillment_task_id', 'order_number', 'shopify_order_number']);
  }
  const issues = [];

  for (const batch of batches) {
    if (isBackendTestBatch(batch)) continue;
    const status = normalizeLower(batch?.status);
    const displayId = backendBatchDisplayId(batch);
    const sanitationReady = sanitationLogs.some(row => (
      backendComplianceMatches(row, batch) &&
      row.cleaned === true &&
      row.sanitized === true &&
      normalizeLower(row.sanitizer_level) !== 'low'
    ));
    const checklistReady = dailyChecklists.some(row => (
      backendComplianceMatches(row, batch) &&
      ['complete', 'pre-production complete'].includes(normalizeLower(row.overall_status)) &&
      row.morning_fridge_temp_logged === true &&
      row.sanitizer_levels_checked === true &&
      row.equipment_sanitized === true &&
      row.work_areas_cleaned === true
    ));
    const tempReady = temperatureLogs.some(row => (
      backendComplianceMatches(row, batch) &&
      row.within_range === true &&
      numberOrZero(row.temperature) !== 0
    ));
    const batchLogReady = batchComplianceLogs.some(row => backendComplianceMatches(row, batch));

    if (['in_production', 'completed_pending_verification', 'verified_logged'].includes(status) && (!sanitationReady || !checklistReady || !tempReady)) {
      issues.push(backendReadinessIssue({
        severity: 'blocker',
        domain: 'production_compliance',
        code: 'batch_started_without_complete_prestart_compliance',
        entityType: 'ProductionBatch',
        displayId,
        status,
        recommendation: 'Review linked sanitation, daily checklist, and temperature logs before using this batch as a source-of-truth pilot record.',
      }));
    }
    if (status === 'verified_logged' && !batchLogReady) {
      issues.push(backendReadinessIssue({
        severity: 'blocker',
        domain: 'production_compliance',
        code: 'verified_batch_missing_batch_compliance_log',
        entityType: 'ProductionBatch',
        displayId,
        status,
        recommendation: 'Create or link the batch compliance log before treating verification as complete.',
      }));
    }
    if (numberOrZero(batch?.planned_units) <= 0 && status !== 'archived') {
      issues.push(backendReadinessIssue({
        severity: 'warning',
        domain: 'production',
        code: 'active_batch_missing_planned_quantity',
        entityType: 'ProductionBatch',
        displayId,
        status,
        recommendation: 'Confirm the batch quantity before it enters production or fulfillment planning.',
      }));
    }
  }

  for (const task of tasks) {
    if (isBackendTestTask(task)) continue;
    const status = normalizeLower(task?.status);
    const displayId = backendTaskDisplayId(task);
    const taskOrderNumber = backendOrderNumber(task?.order_number || task?.shopify_order_number);
    const order = taskOrderNumber ? orderIndex.get(taskOrderNumber) : null;
    const orderStatus = normalizeLower(order?.status);
    if (status === 'delivered' && !normalizeText(task?.delivered_at)) {
      issues.push(backendReadinessIssue({
        severity: 'blocker',
        domain: 'delivery',
        code: 'delivered_task_missing_delivered_at',
        entityType: 'FulfillmentTask',
        displayId,
        status,
        recommendation: 'Backfill or correct the delivery completion timestamp before relying on route history.',
      }));
    }
    if (status === 'delivered' && order && orderStatus && !['delivered', 'picked_up'].includes(orderStatus)) {
      issues.push(backendReadinessIssue({
        severity: 'warning',
        domain: 'fulfillment_order_projection',
        code: 'delivered_task_order_status_not_projected',
        entityType: 'FulfillmentTask',
        displayId,
        status,
        recommendation: 'Use the exact approved delivery reconciliation path if the customer order should be marked delivered.',
      }));
    }
    if (!['delivered', 'cancelled', 'canceled', 'unable_to_deliver'].includes(status) && backendReadinessDate(task, ['delivery_date', 'assigned_delivery_date', 'scheduled_date']) < todayChicagoDate()) {
      issues.push(backendReadinessIssue({
        severity: 'warning',
        domain: 'delivery',
        code: 'past_due_task_not_terminal',
        entityType: 'FulfillmentTask',
        displayId,
        status,
        recommendation: 'Review whether the task is genuinely open or the source status needs reconciliation.',
      }));
    }
  }

  const recentSince = Date.now() - BACKEND_READINESS_RECENT_ORDER_WRITE_MINUTES * 60 * 1000;
  const recentShopifyOrders = shopifyOrdersRaw.filter(row => recentBackendIso(row?.updated_date || row?.created_date, recentSince));
  for (const order of recentShopifyOrders) {
    const displayId = sanitizeBackendDisplay(order?.shopify_order_number || order?.id, 120);
    const orderId = sanitizeBackendId(order?.id);
    const number = backendOrderNumber(order?.shopify_order_number);
    if ((number && syncOrderNumbers.has(number)) || (orderId && syncOrderIds.has(orderId))) continue;
    issues.push(backendReadinessIssue({
      severity: 'warning',
      domain: 'order_sync',
      code: 'recent_shopify_order_update_without_order_sync_log',
      entityType: 'ShopifyOrder',
      displayId,
      status: sanitizeBackendDisplay(order?.fulfillment_status || order?.production_status, 80),
      recommendation: 'Audit recently deployed functions for direct ShopifyOrder writes that bypass safe sync logging.',
    }));
  }

  for (const command of commandLogs.slice(0, 80)) {
    const status = normalizeLower(command?.status);
    if (!['failed', 'rejected'].includes(status)) continue;
    if (isBackendInternalCommand(command, { testBatchRefs, testTaskRefs })) continue;
    issues.push(backendReadinessIssue({
      severity: status === 'failed' ? 'warning' : 'info',
      domain: 'command_audit',
      code: `recent_command_${status}`,
      entityType: sanitizeBackendDisplay(command?.target_entity, 80) || 'CommandLog',
      displayId: backendCommandTargetKey(command) || sanitizeBackendId(command?.id),
      status,
      recommendation: `Review ${sanitizeBackendDisplay(backendCommandType(command), 100) || 'the command'} before running related live workflow tests.`,
    }));
  }

  const recentCampaigns = campaigns.slice(0, 30);
  const supersededCampaignFailureIds = supersededNotificationCampaignFailureIds(recentCampaigns);

  for (const campaign of recentCampaigns) {
    const audience = normalizeLower(campaign?.audience);
    if (normalizeLower(campaign?.status) === 'sent' && audience !== 'test_only' && numberOrZero(campaign?.recipients_total) > 0 && numberOrZero(campaign?.eligible_count) === 0) {
      issues.push(backendReadinessIssue({
        severity: 'warning',
        domain: 'notifications',
        code: 'broad_campaign_sent_with_no_eligible_recipients',
        entityType: 'NotificationCampaign',
        displayId: sanitizeBackendId(campaign?.id),
        status: sanitizeBackendDisplay(campaign?.status, 80),
        recommendation: 'Review customer notification preferences before sending another broad campaign.',
      }));
    }
    if (audience !== 'test_only' && numberOrZero(campaign?.failed_count) > 0 && !supersededCampaignFailureIds.has(campaign?.id)) {
      issues.push(backendReadinessIssue({
        severity: 'warning',
        domain: 'notifications',
        code: 'campaign_has_delivery_failures',
        entityType: 'NotificationCampaign',
        displayId: sanitizeBackendId(campaign?.id),
        status: sanitizeBackendDisplay(campaign?.status, 80),
        recommendation: 'Review skipped and failed campaign counts before broad notification use.',
      }));
    }
  }

  const blockers = issues.filter(row => row.severity === 'blocker');
  const warnings = issues.filter(row => row.severity === 'warning');

  return {
    success: true,
    source: 'getAdminOperationsDashboardSummary.backend_readiness',
    classification: blockers.length ? 'backend_readiness_blocked' : warnings.length ? 'backend_live_ready_with_warnings' : 'backend_live_ready_readonly_clean',
    date_from: dateFrom,
    date_to: dateTo,
    generated_at: new Date().toISOString(),
    actor_role: actorRole,
    summary: {
      production_batches_checked: batches.filter(batch => !isBackendTestBatch(batch)).length,
      internal_test_batches_excluded: batches.filter(isBackendTestBatch).length,
      fulfillment_tasks_checked: tasks.filter(task => !isBackendTestTask(task)).length,
      internal_test_tasks_excluded: tasks.filter(isBackendTestTask).length,
      recent_shopify_orders_checked: recentShopifyOrders.length,
      command_logs_checked: Math.min(commandLogs.length, 80),
      notification_campaigns_checked: Math.min(campaigns.length, 30),
      superseded_notification_failures_excluded: supersededCampaignFailureIds.size,
      blocker_count: blockers.length,
      warning_count: warnings.length,
      info_count: issues.filter(row => row.severity === 'info').length,
    },
    issues: issues.slice(0, 120),
    next_action: blockers.length
      ? 'resolve_blockers_before_live_bundle_test'
      : warnings.length ? 'review_warnings_before_live_bundle_test' : 'ready_for_controlled_live_bundle_test_preflight',
    read_only_safety: {
      writes_performed: false,
      provider_calls_performed: false,
      customer_notifications_sent: false,
      inventory_mutation: false,
      bulk_sync: false,
      raw_records_returned: false,
      pii_redacted: true,
    },
  };
}

async function loadNativeOperationsDashboardContext(base44, { dateFrom, dateTo, sourceType, sourceChannel }) {
  const [
    customerOrders,
    shopifyOrders,
    productionBatches,
    fulfillmentTasks,
    inventoryItems,
    reviewQueueItems,
    operationalAlerts,
    complianceAlerts,
    commandLogs,
  ] = await Promise.all([
    listEntity(base44, 'Order', '-created_date'),
    listEntity(base44, 'ShopifyOrder', '-created_date'),
    listEntity(base44, 'ProductionBatch', '-production_date'),
    listEntity(base44, 'FulfillmentTask', '-delivery_date'),
    listEntity(base44, 'InventoryItem', 'ingredient'),
    listEntity(base44, 'OrderReviewQueue', '-created_date'),
    listEntity(base44, 'OperationalAlert', '-created_date'),
    listEntity(base44, 'ComplianceAlert', '-created_date'),
    listEntity(base44, 'CommandLog', '-created_date', 150),
  ]);

  const sourceMatchedOrders = uniqueByOrderNumber([
    ...customerOrders
      .filter(order => order?.is_test_order !== true)
      .filter(order => orderMatchesSource(order, sourceType, sourceChannel)),
    ...shopifyOrders
      .filter(order => orderMatchesSource(order, sourceType, sourceChannel))
      .map(order => ({
        ...order,
        order_number: order.shopify_order_number || order.order_number,
      })),
  ]);
  const orders = sourceMatchedOrders.filter(order => inRange(orderReferenceDate(order), dateFrom, dateTo));

  const batches = productionBatches.filter(batch => !isInternalTestProductionBatch(batch) && inRange(batch.production_date, dateFrom, dateTo));
  const nonTestCommandLogs = commandLogs.filter(
    row => row?.payload?.is_test_batch !== true && row?.payload?.is_test_task !== true,
  );
  const operationalCommandLogs = nonTestCommandLogs.filter(row => inRange(commandReferenceDate(row), dateFrom, dateTo));
  const commandOutsideWindowSuppressedCount = nonTestCommandLogs.length - operationalCommandLogs.length;
  const operationalReviewQueueItems = reviewQueueItems
    .filter(row => !isLegacyLaunchReviewQueueNoise(row))
    .filter(row => !isInternalTestReviewQueueItem(row));
  const openReviewItems = operationalReviewQueueItems.filter(isOpenReviewItem);
  const legacyLaunchReviewSuppressedCount = reviewQueueItems.filter(row => isOpenReviewItem(row) && isLegacyLaunchReviewQueueNoise(row)).length;
  const internalTestReviewSuppressedCount = reviewQueueItems.filter(row => isOpenReviewItem(row) && isInternalTestReviewQueueItem(row)).length;
  const openReviewWindow = dateWindow(openReviewItems, row => row?.last_seen_at || row?.updated_date || row?.created_date);
  const failedCommandCount = operationalCommandLogs.filter(row => commandStatus(row) === 'failed').length;
  const rejectedCommandCount = operationalCommandLogs.filter(row => commandStatus(row) === 'rejected').length;
  const runningCommandCount = operationalCommandLogs.filter(row => ['pending', 'running'].includes(commandStatus(row))).length;
  const today = todayChicagoDate();
  const tomorrow = addDays(today, 1);
  const deliveryTasks = fulfillmentTasks.filter(task => {
    const source = normalizeLower(task.source_type || task.source_channel);
    return task?.is_test_task !== true &&
      source !== 'pos' &&
      normalizeLower(task.fulfillment_type) !== 'event_pos';
  });
  const unscheduledDeliveryCount = countUnscheduledDeliveryWork(sourceMatchedOrders, deliveryTasks, { dateFrom, dateTo });
  const deliveryCompletedRouteDate = computeNativeCompletedDeliveriesInRangeByRouteDate({
    deliveryTasks,
    customerOrders,
    shopifyOrders,
    dateFrom,
    dateTo,
  });
  const alerts = [
    ...operationalReviewQueueItems.map(item => ({ ...item, severity: item.incident_type || 'warning' })),
    ...operationalAlerts,
    ...complianceAlerts,
  ].filter(alert => inRange(alertDate(alert), dateFrom, dateTo)).filter(isActiveAlert);

  const inventoryCounts = { low: 0, critical: 0, out_of_stock: 0, demand_based_food: 0, stock_tracked: 0 };
  for (const item of inventoryItems) {
    const status = inventoryStatus(item);
    if (status === 'demand_based') {
      inventoryCounts.demand_based_food += 1;
      continue;
    }
    inventoryCounts.stock_tracked += 1;
    if (status === 'low') inventoryCounts.low += 1;
    if (status === 'critical') inventoryCounts.critical += 1;
    if (status === 'out_of_stock') inventoryCounts.out_of_stock += 1;
  }

  const sourceMix = { one_time: 0, subscription: 0, pos: 0, other: 0 };
  for (const order of orders) {
    const source = classifyOrderSource(order);
    sourceMix[source] = (sourceMix[source] || 0) + 1;
  }

  const summary = sanitizeSummary({
    orders: {
      total: orders.length,
      paid: orders.filter(isPaidOrder).length,
      fulfilled: orders.filter(isFulfilledOrder).length,
      delivered: orders.filter(isDeliveredOrder).length,
    },
    production: {
      batch_count: batches.length,
      planned_units: batches.reduce((sum, batch) => sum + numberOrZero(batch.planned_units), 0),
      produced_units: batches.reduce((sum, batch) => sum + numberOrZero(batch.actual_units || batch.final_usable_quantity || batch.bottles_produced), 0),
    },
    delivery: {
      today_stops: deliveryTasks.filter(task => dateKey(taskDate(task)) === today).length,
      tomorrow_stops: deliveryTasks.filter(task => dateKey(taskDate(task)) === tomorrow).length,
      completed_in_range: deliveryCompletedRouteDate.value,
      unscheduled: unscheduledDeliveryCount,
    },
    inventory: inventoryCounts,
    alerts: {
      active: alerts.length,
      critical: alerts.filter(alert => ['critical', 'error', 'failed', 'failure'].includes(alertSeverity(alert))).length,
      warning: alerts.filter(alert => ['warning', 'needs_review', 'incomplete_address', 'low_quality_order'].includes(alertSeverity(alert))).length,
      info: alerts.filter(alert => ['info', 'notice'].includes(alertSeverity(alert))).length,
    },
    source_mix: sourceMix,
    ops_health: {
      review_open: openReviewItems.length,
      command_failed: failedCommandCount,
      command_rejected: rejectedCommandCount,
      command_running: runningCommandCount,
    },
    ops_health_details: {
      review_queue: {
        open: openReviewItems.length,
        legacy_launch_suppressed: legacyLaunchReviewSuppressedCount,
        internal_test_suppressed: internalTestReviewSuppressedCount,
        missing_order_number: openReviewItems.filter(row => !normalizeText(row?.existing_order_number || row?.order_number || row?.shopify_order_number)).length,
        has_order_number: openReviewItems.filter(row => normalizeText(row?.existing_order_number || row?.order_number || row?.shopify_order_number)).length,
        oldest_open_at: openReviewWindow.oldest,
        newest_open_at: openReviewWindow.newest,
        by_incident_type: topCountMap(openReviewItems, row => row?.incident_type),
        by_source: topCountMap(openReviewItems, row => row?.incoming_source || row?.source || row?.source_type),
      },
      commands: {
        failed: failedCommandCount,
        rejected: rejectedCommandCount,
        running: runningCommandCount,
        outside_window_suppressed: commandOutsideWindowSuppressedCount,
      },
    },
  });

  return {
    summary,
    delivery_completed_route_date: deliveryCompletedRouteDate,
  };
}

function nativeFallbackResponse({
  dateFrom,
  dateTo,
  summary,
  deliveryCompletedGuard,
  reason = null,
  hubStatus = null,
  backendReadiness = null,
  hubSummary = null,
  hubRange = null,
  hubHistoricalContextRequested = false,
  hubHistoricalContextAvailable = false,
}) {
  const diagnostics = buildOperationsDashboardDiagnostics({
    displayedSummary: summary,
    nativeSummary: summary,
    hubSummary,
    currentDisplaySource: 'customer_app_native_authoritative',
    requestedRange: { date_from: dateFrom, date_to: dateTo },
    hubRange,
    deliveryCompletedGuard,
  });
  const warnings = [
    hubHistoricalContextRequested && reason
      ? (hubStatus
        ? `hub_operations_dashboard_historical_context_unavailable:${hubStatus}`
        : `hub_operations_dashboard_historical_context_unavailable:${reason}`)
      : null,
    ...deliveryCompletedWarnings(deliveryCompletedGuard),
  ].filter(Boolean);

  return Response.json({
    success: true,
    source: 'customer_app_native_operations_dashboard_authoritative',
    generated_at: new Date().toISOString(),
    date_from: dateFrom,
    date_to: dateTo,
    summary,
    truncated: false,
    warnings,
    data_sources: {
      hub_available: hubHistoricalContextAvailable,
      native_available: true,
      native_read_only: true,
      customer_app_native_authoritative: true,
      hub_operational_dependency: false,
      hub_historical_context_requested: hubHistoricalContextRequested,
      hub_historical_context_available: hubHistoricalContextAvailable,
    },
    customer_app_native_authoritative: true,
    hub_operational_dependency: false,
    include_hub_historical_context: hubHistoricalContextRequested,
    writes_performed: false,
    provider_calls_performed: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    ...(backendReadiness ? { backend_readiness: backendReadiness } : {}),
    ...diagnostics,
  });
}

export default async function handler(req: Request) {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }
    let dateFrom;
    let dateTo;
    let preset;

    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
      const requestedPreset = normalizeLower(body.preset);
      preset = requestedPreset || ((dateFrom || dateTo) ? 'custom' : 'last_7_days');

      if (preset !== 'custom' && !VALID_PRESETS.has(preset)) {
        throw new Error('preset must be one of today, last_7_days, last_30_days');
      }

      if ((dateFrom || dateTo) && preset !== 'custom') {
        throw new Error('Use either preset or date_from/date_to, not both');
      }

      if (preset === 'custom') {
        if (!dateFrom || !dateTo) {
          throw new Error('date_from and date_to are required for custom range');
        }
        if (dateTo < dateFrom) {
          throw new Error('date_to must be on or after date_from');
        }
        if (daysInclusive(dateFrom, dateTo) > MAX_RANGE_DAYS) {
          throw new Error(`Date range must be ${MAX_RANGE_DAYS} days or fewer`);
        }
      }
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const sourceType = normalizeText(body.source_type);
    const sourceChannel = normalizeText(body.source_channel);
    const resolvedRange = resolveDateRange({ preset, dateFrom, dateTo });
    const includeHubHistoricalContext = body.include_hub_historical_context === true;
    const includeBackendReadiness = body.include_backend_readiness === true;
    const backendReadiness = includeBackendReadiness
      ? await buildOperationalBackendReadiness(base44, {
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        actorRole: user.role,
      })
      : null;
    const loadNativeContext = () => loadNativeOperationsDashboardContext(base44, {
      dateFrom: resolvedRange.date_from,
      dateTo: resolvedRange.date_to,
      sourceType,
      sourceChannel,
    });

    if (!includeHubHistoricalContext) {
      const nativeContext = await loadNativeContext();
      const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
        currentSummary: nativeContext.summary,
        nativeRouteDateResult: nativeContext.delivery_completed_route_date,
        hubSummary: null,
        currentDisplaySource: 'customer_app_native_authoritative',
      });
      const guardedSummary = applyDeliveryCompletedInRangeGuard(nativeContext.summary, deliveryCompletedGuard);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: guardedSummary,
        deliveryCompletedGuard,
        backendReadiness,
      });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      const nativeContext = await loadNativeContext();
      const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
        currentSummary: nativeContext.summary,
        nativeRouteDateResult: nativeContext.delivery_completed_route_date,
        hubSummary: null,
        currentDisplaySource: 'customer_app_native_authoritative',
      });
      const guardedSummary = applyDeliveryCompletedInRangeGuard(nativeContext.summary, deliveryCompletedGuard);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: guardedSummary,
        deliveryCompletedGuard,
        reason: 'missing_config',
        backendReadiness,
        hubHistoricalContextRequested: true,
      });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams();
    if (preset === 'custom') {
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
    } else {
      params.set('preset', preset);
    }
    if (sourceType) params.set('source_type', sourceType);
    if (sourceChannel) params.set('source_channel', sourceChannel);

    let hubResponse;
    try {
      hubResponse = await fetch(`${hubBase}/functions/getOperationsDashboardSummaryForCustomerApp?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
      });
    } catch (error) {
      console.warn('[getAdminOperationsDashboardSummary] Hub fetch failed; returning native fallback:', error.message);
      const nativeContext = await loadNativeContext();
      const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
        currentSummary: nativeContext.summary,
        nativeRouteDateResult: nativeContext.delivery_completed_route_date,
        hubSummary: null,
        currentDisplaySource: 'customer_app_native_authoritative',
      });
      const guardedSummary = applyDeliveryCompletedInRangeGuard(nativeContext.summary, deliveryCompletedGuard);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: guardedSummary,
        deliveryCompletedGuard,
        reason: 'fetch_failed',
        backendReadiness,
        hubHistoricalContextRequested: true,
      });
    }

    if (!hubResponse.ok) {
      const nativeContext = await loadNativeContext();
      const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
        currentSummary: nativeContext.summary,
        nativeRouteDateResult: nativeContext.delivery_completed_route_date,
        hubSummary: null,
        currentDisplaySource: 'customer_app_native_authoritative',
      });
      const guardedSummary = applyDeliveryCompletedInRangeGuard(nativeContext.summary, deliveryCompletedGuard);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: guardedSummary,
        deliveryCompletedGuard,
        reason: 'non_ok',
        hubStatus: hubResponse.status,
        backendReadiness,
        hubHistoricalContextRequested: true,
      });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !hubData.summary) {
      const nativeContext = await loadNativeContext();
      const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
        currentSummary: nativeContext.summary,
        nativeRouteDateResult: nativeContext.delivery_completed_route_date,
        hubSummary: null,
        currentDisplaySource: 'customer_app_native_authoritative',
      });
      const guardedSummary = applyDeliveryCompletedInRangeGuard(nativeContext.summary, deliveryCompletedGuard);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: guardedSummary,
        deliveryCompletedGuard,
        reason: 'malformed_response',
        backendReadiness,
        hubHistoricalContextRequested: true,
      });
    }

    const hubSummary = sanitizeSummary(hubData.summary);
    const nativeContext = await loadNativeContext();
    const nativeSummary = nativeContext.summary;
    const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
      currentSummary: nativeSummary,
      nativeRouteDateResult: nativeContext.delivery_completed_route_date,
      hubSummary,
      currentDisplaySource: 'customer_app_native_authoritative',
    });
    const displayedSummary = applyDeliveryCompletedInRangeGuard(nativeSummary, deliveryCompletedGuard);
    return nativeFallbackResponse({
      dateFrom: resolvedRange.date_from,
      dateTo: resolvedRange.date_to,
      summary: displayedSummary,
      deliveryCompletedGuard,
      backendReadiness,
      hubSummary,
      hubRange: {
        date_from: hubData.date_from || (preset === 'custom' ? dateFrom : resolvedRange.date_from),
        date_to: hubData.date_to || (preset === 'custom' ? dateTo : resolvedRange.date_to),
      },
      hubHistoricalContextRequested: true,
      hubHistoricalContextAvailable: true,
    });
  } catch (error) {
    console.error('[getAdminOperationsDashboardSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load operations dashboard summary' }, { status: 500 });
  }
}
