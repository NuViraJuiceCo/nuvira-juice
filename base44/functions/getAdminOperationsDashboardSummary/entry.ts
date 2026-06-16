import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const VALID_PRESETS = new Set(['today', 'last_7_days', 'last_30_days']);
const CHICAGO_TZ = 'America/Chicago';
const G39N_DIAGNOSTICS_MARKER = 'g39n_operations_dashboard_aggregate_diagnostics';
const G39Q_DELIVERY_COMPLETED_MARKER = 'g39q_delivery_completed_in_range_route_date_guard';

const G39N_AGGREGATE_SPECS = Object.freeze([
  {
    name: 'orders.total',
    group: 'orders',
    key: 'total',
    domain: 'admin_orders',
    source_of_truth: 'hub',
    blocker: 'admin_orders_not_broad_native_first_g39l_zero_eligible_rows',
    recommendation: 'preserve_current_display_until_admin_order_aggregate_parity_is_proven',
  },
  {
    name: 'orders.paid',
    group: 'orders',
    key: 'paid',
    domain: 'payment_refund',
    source_of_truth: 'payment_provider_hub',
    mismatch_category: 'payment_refund_semantic_mismatch',
    blocker: 'payment_refund_source_of_truth_hold',
    recommendation: 'keep_hub_payment_refund_source_of_truth_until_payment_parity_is_proven',
  },
  {
    name: 'orders.fulfilled',
    group: 'orders',
    key: 'fulfilled',
    domain: 'admin_orders',
    source_of_truth: 'hub',
    blocker: 'fulfillment_status_semantics_not_row_proven_for_broad_orders',
    recommendation: 'use_admin_orders_diagnostics_before_switching_order_fulfillment_counts',
  },
  {
    name: 'orders.delivered',
    group: 'orders',
    key: 'delivered',
    domain: 'admin_orders',
    source_of_truth: 'hub',
    mismatch_category: 'delivered_completed_semantic_mismatch',
    blocker: 'order_delivered_count_not_equivalent_to_route_task_count',
    recommendation: 'reference_g39d_route_summary_but_keep_order_delivered_count_current_source_for_now',
  },
  {
    name: 'production.batch_count',
    group: 'production',
    key: 'batch_count',
    domain: 'production_planning',
    source_of_truth: 'mixed',
    mismatch_category: 'production_status_semantic_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'reference_g39f_production_planning_before_switching_displayed_count',
  },
  {
    name: 'production.planned_units',
    group: 'production',
    key: 'planned_units',
    domain: 'production_planning',
    source_of_truth: 'mixed',
    mismatch_category: 'schema_meaning_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'compare_unit_semantics_with_g39f_planning_before_switching_displayed_units',
  },
  {
    name: 'production.produced_units',
    group: 'production',
    key: 'produced_units',
    domain: 'production_planning',
    source_of_truth: 'mixed',
    mismatch_category: 'schema_meaning_mismatch',
    native_first_candidate_if_match: true,
    recommendation: 'compare_actual_units_final_usable_quantity_and_hub_produced_units_before_switching',
  },
  {
    name: 'delivery.today_stops',
    group: 'delivery',
    key: 'today_stops',
    domain: 'delivery_route',
    source_of_truth: 'mixed',
    native_first_candidate_if_match: true,
    recommendation: 'reference_g39d_native_first_route_summary_for_date_bucket_semantics',
  },
  {
    name: 'delivery.tomorrow_stops',
    group: 'delivery',
    key: 'tomorrow_stops',
    domain: 'delivery_route',
    source_of_truth: 'mixed',
    native_first_candidate_if_match: true,
    recommendation: 'reference_g39d_native_first_route_summary_for_date_bucket_semantics',
  },
  {
    name: 'delivery.completed_in_range',
    group: 'delivery',
    key: 'completed_in_range',
    domain: 'delivery_route',
    source_of_truth: 'mixed',
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
    recommendation: 'keep_inventory_counts_as_diagnostics_only_until_stock_policy_is_owner_approved',
  },
  {
    name: 'inventory.critical',
    group: 'inventory',
    key: 'critical',
    domain: 'inventory_po',
    source_of_truth: 'manual_review',
    mismatch_category: 'schema_meaning_mismatch',
    blocker: 'inventory_stock_not_authoritative_po_automation_held',
    recommendation: 'keep_inventory_counts_as_diagnostics_only_until_stock_policy_is_owner_approved',
  },
  {
    name: 'inventory.out_of_stock',
    group: 'inventory',
    key: 'out_of_stock',
    domain: 'inventory_po',
    source_of_truth: 'manual_review',
    mismatch_category: 'schema_meaning_mismatch',
    blocker: 'inventory_stock_not_authoritative_po_automation_held',
    recommendation: 'do_not_trigger_inventory_deduction_or_purchase_orders_from_dashboard_counts',
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
    source_of_truth: 'hub',
    mismatch_category: 'aggregate_includes_different_row_classes',
    blocker: 'one_time_source_mix_not_equivalent_to_g39l_native_primary_eligibility',
    recommendation: 'keep_source_mix_current_display_until_one_time_classification_parity_is_proven',
  },
  {
    name: 'source_mix.subscription',
    group: 'source_mix',
    key: 'subscription',
    domain: 'subscription',
    source_of_truth: 'subscription_hub',
    mismatch_category: 'subscription_multi_delivery_mismatch',
    blocker: 'subscription_multi_delivery_hub_source_of_truth',
    recommendation: 'keep_subscription_counts_hub_source_of_truth',
  },
  {
    name: 'source_mix.pos',
    group: 'source_mix',
    key: 'pos',
    domain: 'pos_event',
    source_of_truth: 'hub',
    mismatch_category: 'aggregate_includes_different_row_classes',
    blocker: 'pos_event_order_classification_not_in_native_first_scope',
    recommendation: 'keep_pos_event_source_mix_current_display_until_pos_parity_is_proven',
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

function sanitizeCountGroup(group, keys) {
  const result = {};
  for (const key of keys) {
    result[key] = numberOrZero(group?.[key]);
  }
  return result;
}

function sanitizeSummary(summary) {
  return {
    orders: sanitizeCountGroup(summary?.orders, ['total', 'paid', 'fulfilled', 'delivered']),
    production: sanitizeCountGroup(summary?.production, ['batch_count', 'planned_units', 'produced_units']),
    delivery: sanitizeCountGroup(summary?.delivery, ['today_stops', 'tomorrow_stops', 'completed_in_range']),
    inventory: sanitizeCountGroup(summary?.inventory, ['low', 'critical', 'out_of_stock']),
    alerts: sanitizeCountGroup(summary?.alerts, ['active', 'critical', 'warning', 'info']),
    source_mix: sanitizeCountGroup(summary?.source_mix, ['one_time', 'subscription', 'pos', 'other']),
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
  const nativeFirstReady = Boolean(spec.native_first_candidate_if_match)
    && comparisonAvailable
    && !mismatchDetected
    && !sourceHold;
  const fallbackRequired = !nativeFirstReady || currentDisplaySource !== 'native_primary';
  const reviewRequired = mismatchDetected || sourceOfTruth === 'manual_review' || sourceOfTruth === 'unknown' || sourceOfTruth === 'not_comparable';
  const blocker = nativeFirstReady
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
    native_first_enabled: false,
    hub_primary_enabled: true,
    hub_fallback_active: true,
    dashboard_source_mode: 'current_behavior_with_diagnostics',
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
  const guardPassed = comparisonAvailable && blockerReasons.length === 0;
  const mismatchDetected = comparisonAvailable && nativeValue !== comparisonValue;
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

function inventoryStatus(item) {
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
  ] = await Promise.all([
    listEntity(base44, 'Order', '-created_date'),
    listEntity(base44, 'ShopifyOrder', '-created_date'),
    listEntity(base44, 'ProductionBatch', '-production_date'),
    listEntity(base44, 'FulfillmentTask', '-delivery_date'),
    listEntity(base44, 'InventoryItem', 'ingredient'),
    listEntity(base44, 'OrderReviewQueue', '-created_date'),
    listEntity(base44, 'OperationalAlert', '-created_date'),
    listEntity(base44, 'ComplianceAlert', '-created_date'),
  ]);

  const orders = uniqueByOrderNumber([
    ...customerOrders
      .filter(order => inRange(orderReferenceDate(order), dateFrom, dateTo))
      .filter(order => orderMatchesSource(order, sourceType, sourceChannel)),
    ...shopifyOrders
      .filter(order => inRange(orderReferenceDate(order), dateFrom, dateTo))
      .filter(order => orderMatchesSource(order, sourceType, sourceChannel))
      .map(order => ({
        ...order,
        order_number: order.shopify_order_number || order.order_number,
      })),
  ]);

  const batches = productionBatches.filter(batch => inRange(batch.production_date, dateFrom, dateTo));
  const today = todayChicagoDate();
  const tomorrow = addDays(today, 1);
  const deliveryTasks = fulfillmentTasks.filter(task => {
    const source = normalizeLower(task.source_type || task.source_channel);
    return source !== 'pos' && normalizeLower(task.fulfillment_type) !== 'event_pos';
  });
  const deliveryCompletedRouteDate = computeNativeCompletedDeliveriesInRangeByRouteDate({
    deliveryTasks,
    customerOrders,
    shopifyOrders,
    dateFrom,
    dateTo,
  });
  const alerts = [
    ...reviewQueueItems.map(item => ({ ...item, severity: item.incident_type || 'warning' })),
    ...operationalAlerts,
    ...complianceAlerts,
  ].filter(alert => inRange(alertDate(alert), dateFrom, dateTo)).filter(isActiveAlert);

  const inventoryCounts = { low: 0, critical: 0, out_of_stock: 0 };
  for (const item of inventoryItems) {
    const status = inventoryStatus(item);
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
    },
    inventory: inventoryCounts,
    alerts: {
      active: alerts.length,
      critical: alerts.filter(alert => ['critical', 'error', 'failed', 'failure'].includes(alertSeverity(alert))).length,
      warning: alerts.filter(alert => ['warning', 'needs_review', 'incomplete_address', 'low_quality_order'].includes(alertSeverity(alert))).length,
      info: alerts.filter(alert => ['info', 'notice'].includes(alertSeverity(alert))).length,
    },
    source_mix: sourceMix,
  });

  return {
    summary,
    delivery_completed_route_date: deliveryCompletedRouteDate,
  };
}

function nativeFallbackResponse({ dateFrom, dateTo, summary, deliveryCompletedGuard, reason, hubStatus = null }) {
  const diagnostics = buildOperationsDashboardDiagnostics({
    displayedSummary: summary,
    nativeSummary: summary,
    hubSummary: null,
    currentDisplaySource: 'native_fallback',
    requestedRange: { date_from: dateFrom, date_to: dateTo },
    hubRange: null,
    deliveryCompletedGuard,
  });

  return Response.json({
    success: true,
    source: 'customer_app_native_operations_dashboard_fallback',
    generated_at: new Date().toISOString(),
    date_from: dateFrom,
    date_to: dateTo,
    summary,
    truncated: false,
    warnings: [
      hubStatus
        ? `hub_operations_dashboard_unavailable:${hubStatus}`
        : `hub_operations_dashboard_unavailable:${reason}`,
      'native_read_only_fallback',
      ...deliveryCompletedWarnings(deliveryCompletedGuard),
    ],
    data_sources: {
      hub_available: false,
      native_available: true,
      native_read_only: true,
    },
    ...diagnostics,
  });
}

Deno.serve(async (req) => {
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
    const loadNativeContext = () => loadNativeOperationsDashboardContext(base44, {
      dateFrom: resolvedRange.date_from,
      dateTo: resolvedRange.date_to,
      sourceType,
      sourceChannel,
    });

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      const nativeContext = await loadNativeContext();
      const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
        currentSummary: nativeContext.summary,
        nativeRouteDateResult: nativeContext.delivery_completed_route_date,
        hubSummary: null,
        currentDisplaySource: 'native_fallback',
      });
      const guardedSummary = applyDeliveryCompletedInRangeGuard(nativeContext.summary, deliveryCompletedGuard);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: guardedSummary,
        deliveryCompletedGuard,
        reason: 'missing_config',
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
        currentDisplaySource: 'native_fallback',
      });
      const guardedSummary = applyDeliveryCompletedInRangeGuard(nativeContext.summary, deliveryCompletedGuard);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: guardedSummary,
        deliveryCompletedGuard,
        reason: 'fetch_failed',
      });
    }

    if (!hubResponse.ok) {
      const nativeContext = await loadNativeContext();
      const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
        currentSummary: nativeContext.summary,
        nativeRouteDateResult: nativeContext.delivery_completed_route_date,
        hubSummary: null,
        currentDisplaySource: 'native_fallback',
      });
      const guardedSummary = applyDeliveryCompletedInRangeGuard(nativeContext.summary, deliveryCompletedGuard);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: guardedSummary,
        deliveryCompletedGuard,
        reason: 'non_ok',
        hubStatus: hubResponse.status,
      });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !hubData.summary) {
      const nativeContext = await loadNativeContext();
      const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
        currentSummary: nativeContext.summary,
        nativeRouteDateResult: nativeContext.delivery_completed_route_date,
        hubSummary: null,
        currentDisplaySource: 'native_fallback',
      });
      const guardedSummary = applyDeliveryCompletedInRangeGuard(nativeContext.summary, deliveryCompletedGuard);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        summary: guardedSummary,
        deliveryCompletedGuard,
        reason: 'malformed_response',
      });
    }

    const hubSummary = sanitizeSummary(hubData.summary);
    const nativeContext = await loadNativeContext();
    const nativeSummary = nativeContext.summary;
    const deliveryCompletedGuard = buildDeliveryCompletedInRangeGuard({
      currentSummary: hubSummary,
      nativeRouteDateResult: nativeContext.delivery_completed_route_date,
      hubSummary,
      currentDisplaySource: 'hub_primary',
    });
    const displayedSummary = applyDeliveryCompletedInRangeGuard(hubSummary, deliveryCompletedGuard);
    const diagnostics = buildOperationsDashboardDiagnostics({
      displayedSummary,
      nativeSummary,
      hubSummary,
      currentDisplaySource: 'hub_primary',
      requestedRange: resolvedRange,
      hubRange: {
        date_from: hubData.date_from || (preset === 'custom' ? dateFrom : resolvedRange.date_from),
        date_to: hubData.date_to || (preset === 'custom' ? dateTo : resolvedRange.date_to),
      },
      deliveryCompletedGuard,
    });
    const warnings = deliveryCompletedWarnings(deliveryCompletedGuard);

    return Response.json({
      success: true,
      source: hubData.source || 'hub_operations_dashboard_summary',
      generated_at: hubData.generated_at || null,
      date_from: hubData.date_from || dateFrom || null,
      date_to: hubData.date_to || dateTo || null,
      summary: displayedSummary,
      truncated: hubData.truncated === true,
      ...(warnings.length > 0 ? { warnings } : {}),
      ...diagnostics,
    });
  } catch (error) {
    console.error('[getAdminOperationsDashboardSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load operations dashboard summary' }, { status: 500 });
  }
});
