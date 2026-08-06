import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { buildAdminOrderLifecycleReadModel } from './adminOrderLifecycleReadModel.js';

const HUB_ORDER_FETCH_TIMEOUT_MS = 2500;
const HUB_ORDER_TOTAL_BUDGET_MS = 8000;
const ADMIN_ORDER_LIFECYCLE_READ_MODEL_ENABLE = 'ENABLE_ADMIN_ORDER_LIFECYCLE_READ_MODEL';
const ADMIN_ORDER_LIFECYCLE_READ_MODEL_KILL_SWITCH = 'ADMIN_ORDER_LIFECYCLE_READ_MODEL_KILL_SWITCH';
const ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION = 'g48e_admin_order_lifecycle_v1';
const ADMIN_ORDER_LIFECYCLE_READ_MODEL_MODE = 'ADMIN_ORDER_LIFECYCLE';
const G48E_RUNTIME_DIAGNOSTIC_MODE = 'G48E_RUNTIME_CONTRACT';
const G48E_RUNTIME_CONTRACT_VERSION = 'g48e_runtime_contract_v1';
const G48E_COMPACT_READ_MODEL_CONTRACT = 'g48e_compact_read_model_v1';
const ADMIN_ORDER_LIST_COMPACT_RESPONSE_MODE = 'ADMIN_ORDER_LIST_COMPACT';
const ADMIN_ORDER_LIST_COMPACT_CONTRACT = 'g48e_admin_order_list_compact_v1';
const ADMIN_ORDER_LIST_COMPACT_MAX_ROWS = 15;
const ADMIN_ORDER_LIST_COMPACT_MAX_ITEMS_PER_ROW = 6;
const ADMIN_ORDER_LIST_COMPACT_MAX_CHARS = 180;

function normalizeOrderNum(num) {
  return (num || '').toString().replace(/^#/, '').trim().toLowerCase();
}

function normalizeLower(value) {
  return (value || '').toString().trim().toLowerCase();
}

function envFlagEnabled(name) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(normalizeLower(Deno.env.get(name)));
}

function adminOrderLifecycleReadModelEnabled() {
  return envFlagEnabled(ADMIN_ORDER_LIFECYCLE_READ_MODEL_ENABLE) && !envFlagEnabled(ADMIN_ORDER_LIFECYCLE_READ_MODEL_KILL_SWITCH);
}

function adminOrderLifecycleReadModelModeValue(body) {
  return body?.read_model_mode || body?.preview_mode || body?.mode || '';
}

function adminOrderLifecycleReadModelModeValues(body) {
  return [body?.read_model_mode, body?.preview_mode, body?.mode]
    .map(value => normalizeLower(value).toUpperCase())
    .filter(Boolean);
}

function hasConflictingAdminOrderLifecycleModeValues(body) {
  return new Set(adminOrderLifecycleReadModelModeValues(body)).size > 1;
}

function isAdminOrderLifecycleReadModelRequest(body) {
  return normalizeLower(adminOrderLifecycleReadModelModeValue(body)).toUpperCase() === ADMIN_ORDER_LIFECYCLE_READ_MODEL_MODE;
}

function buildAdminOrderLifecycleCompactResponse({ enabled = false, readModel = null } = {}) {
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    read_model_mode: ADMIN_ORDER_LIFECYCLE_READ_MODEL_MODE,
    admin_order_lifecycle_read_model_available: true,
    admin_order_lifecycle_read_model_enabled: Boolean(enabled),
    admin_order_lifecycle_read_model_version: ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION,
    read_model_payload_present: Boolean(readModel),
    legacy_orders_payload_included: false,
    response_contract: G48E_COMPACT_READ_MODEL_CONTRACT,
    ...(readModel ? { admin_order_lifecycle_read_model: readModel } : {}),
    order_write_ready: false,
    payment_write_ready: false,
    refund_write_ready: false,
    fulfillment_write_ready: false,
    delivery_write_ready: false,
    notification_expansion_ready: false,
    hub_write_suppression_ready: false,
    repair_replay_ready: false,
    pii_returned: false,
    raw_payloads_returned: false,
    provider_call_impact: false,
    stripe_calls: false,
    shopify_calls: false,
    hub_calls: false,
    notifications_sent: false,
    order_mutation_performed: false,
    native_order_mutation_performed: false,
    fulfillment_task_mutation_performed: false,
    payment_mutation_performed: false,
    refund_mutation_performed: false,
    repair_replay_performed: false,
  };
}

function buildAdminOrderLifecycleModeConflictResponse() {
  return {
    success: false,
    error: 'conflicting_read_model_mode',
    dry_run: true,
    writes_performed: false,
    read_model_mode: ADMIN_ORDER_LIFECYCLE_READ_MODEL_MODE,
    legacy_orders_payload_included: false,
    response_contract: G48E_COMPACT_READ_MODEL_CONTRACT,
    order_write_ready: false,
    payment_write_ready: false,
    refund_write_ready: false,
    fulfillment_write_ready: false,
    delivery_write_ready: false,
    notification_expansion_ready: false,
    hub_write_suppression_ready: false,
    repair_replay_ready: false,
    pii_returned: false,
    raw_payloads_returned: false,
    provider_call_impact: false,
    stripe_calls: false,
    shopify_calls: false,
    hub_calls: false,
    notifications_sent: false,
    order_mutation_performed: false,
    native_order_mutation_performed: false,
    fulfillment_task_mutation_performed: false,
    payment_mutation_performed: false,
    refund_mutation_performed: false,
    repair_replay_performed: false,
  };
}

function isG48eRuntimeDiagnosticRequest(body) {
  return normalizeLower(body?.diagnostic_mode).toUpperCase() === G48E_RUNTIME_DIAGNOSTIC_MODE;
}

function isAdminOrderListCompactRequest(body) {
  return normalizeLower(body?.response_mode).toUpperCase() === ADMIN_ORDER_LIST_COMPACT_RESPONSE_MODE;
}

function compactLineItem(item = {}) {
  const quantity = Number(item.quantity || item.qty || 1);
  const title = compactString(item.title || item.name || item.product_name || item.variant_title || 'Item', 96);
  const price = Number(item.price || item.unit_price || 0);
  return {
    title,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    ...(Number.isFinite(price) && price > 0 ? { price } : {}),
  };
}

function compactNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstPresent(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '') ?? null;
}

function compactString(value, maxLength = ADMIN_ORDER_LIST_COMPACT_MAX_CHARS) {
  if (value === null || value === undefined) return null;
  const text = value.toString().trim();
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function compactStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => compactString(item, 64)).filter(Boolean).slice(0, 6);
}

function roundCurrency(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function compactItemsSubtotal(items = []) {
  if (!Array.isArray(items) || items.length === 0) return null;
  let subtotal = 0;
  for (const item of items) {
    const price = compactNumber(item?.price);
    if (price === null) return null;
    const quantity = compactNumber(item?.quantity) || 1;
    subtotal += price * quantity;
  }
  return roundCurrency(subtotal);
}

function inferCompactDeliveryFeeFromLineItems(order = {}, { total, subtotal, itemSubtotal, tax, discounts } = {}) {
  const recordedFee = compactNumber(firstPresent(order.delivery_fee, order.approved_delivery_fee, order.delivery_zone_fee));
  if (recordedFee !== null) return recordedFee;

  const method = normalizeLower(firstPresent(order.fulfillment_type, order.fulfillment_method, order.customer_app_fulfillment_type));
  if (method && method !== 'delivery') return null;

  const comparableSubtotal = subtotal ?? itemSubtotal;
  if (total === null || comparableSubtotal === null) return null;

  const inferred = total - comparableSubtotal - (tax || 0) + (discounts || 0);
  return inferred > 0.009 ? roundCurrency(inferred) : null;
}

function buildCompactPricingFromLineItems(order = {}, items = []) {
  const total = compactNumber(order.total);
  const itemSubtotal = compactItemsSubtotal(items);
  const recordedSubtotal = compactNumber(order.subtotal);
  const subtotal = recordedSubtotal ?? itemSubtotal;
  const tax = compactNumber(order.total_tax);
  const discounts = compactNumber(order.total_discounts);
  const deliveryFee = inferCompactDeliveryFeeFromLineItems(order, {
    total,
    subtotal,
    itemSubtotal,
    tax,
    discounts,
  });

  return {
    total: total ?? 0,
    subtotal,
    delivery_fee: deliveryFee,
    total_tax: tax,
    total_discounts: discounts,
    inferred_from_line_items: recordedSubtotal === null || compactNumber(order.delivery_fee) === null,
  };
}

function compactDeliveryRateContext(order = {}) {
  return {
    fulfillment_method: compactString(firstPresent(order.fulfillment_method, order.fulfillment_type, order.customer_app_fulfillment_type, order.source_channel), 64),
    delivery_fee: compactNumber(firstPresent(order.delivery_fee, order.approved_delivery_fee, order.delivery_zone_fee)),
    delivery_zone_key: compactString(firstPresent(order.delivery_zone_key, order.delivery_zone_id), 64),
    delivery_zone_name: compactString(firstPresent(order.delivery_zone_name), 96),
    delivery_zone_type: compactString(firstPresent(order.delivery_zone_type, order.zone_type), 64),
    minimum_order: compactNumber(firstPresent(order.minimum_order, order.delivery_zone_minimum)),
    distance_miles: compactNumber(firstPresent(order.distance_miles, order.estimated_distance_miles)),
    drive_time_minutes: compactNumber(firstPresent(order.drive_time_minutes, order.estimated_drive_time_minutes)),
    approval_status: compactString(firstPresent(order.approval_status, order.route_review_status), 64),
    delivery_area: compactString(firstPresent(order.delivery_address), 160),
    schedule_source: compactString(firstPresent(order.final_schedule_source, order.delivery_schedule_source, order.scheduling_reason, order.schedule_source), 96),
  };
}

function compactTaskSummary(summary = {}) {
  if (!summary || typeof summary !== 'object') return null;
  const tasks = Array.isArray(summary.tasks)
    ? summary.tasks.slice(0, 3).map(task => ({
        id: task.id || null,
        delivery_date: task.delivery_date || task.scheduled_date || null,
        production_date: task.production_date || null,
        source_type: task.source_type || null,
        source_channel: task.source_channel || null,
        schedule_source: task.schedule_source || null,
      }))
    : [];
  return {
    count: Number(summary.count || 0),
    status_counts: summary.status_counts || {},
    next_delivery_date: summary.next_delivery_date || null,
    production_date: summary.production_date || null,
    task_ids: Array.isArray(summary.task_ids) ? summary.task_ids.slice(0, 5).filter(Boolean) : [],
    ...(tasks.length > 0 ? { tasks } : {}),
    incomplete_display_metadata: summary.incomplete_display_metadata === true,
    missing_metadata_fields: Array.isArray(summary.missing_metadata_fields) ? summary.missing_metadata_fields.slice(0, 10) : [],
  };
}

function compactLatestSyncLog(log = null) {
  if (!log || typeof log !== 'object') return null;
  return {
    status: log.status || null,
    action: log.action || null,
    source: log.source || null,
    event_type: log.event_type || null,
    reason: compactString(log.reason, 120),
    timestamp: log.timestamp || log.created_date || null,
  };
}

function compactReviewSummary(summary = null) {
  if (!summary || typeof summary !== 'object') return null;
  return {
    status: summary.status || null,
    incident_type: summary.incident_type || null,
    issue_description: compactString(summary.issue_description, 140),
    recommended_action: compactString(summary.recommended_action, 140),
    last_seen_at: summary.last_seen_at || summary.updated_date || null,
  };
}

function compactHubSyncSummary(summary = null) {
  if (!summary || typeof summary !== 'object') return null;
  return {
    status: summary.status || null,
    action: summary.action || null,
    timestamp: summary.timestamp || summary.updated_date || null,
  };
}

function isTerminalOperationalStatus(value) {
  return ['delivered', 'fulfilled', 'completed', 'complete', 'picked_up'].includes(normalizeLower(value).replace(/\s+/g, '_'));
}

function isStalePendingNativeStatus(value) {
  return ['awaiting_production', 'scheduled', 'pending', 'unfulfilled', 'not_required'].includes(normalizeLower(value).replace(/\s+/g, '_'));
}

function taskSummaryHasTerminalStatus(taskSummary = {}) {
  return Object.keys(taskSummary?.status_counts || {}).some(isTerminalOperationalStatus);
}

function taskSummaryCompletion(taskSummary = {}) {
  const counts = Object.entries(taskSummary?.status_counts || {});
  const total = Number(taskSummary?.count || counts.reduce((sum, [, count]) => sum + Number(count || 0), 0));
  const terminal = counts.reduce((sum, [status, count]) => (
    sum + (isTerminalOperationalStatus(status) ? Number(count || 0) : 0)
  ), 0);
  return {
    total,
    terminal,
    pending: Math.max(0, total - terminal),
    mixed: terminal > 0 && terminal < total,
    all_terminal: total > 0 && terminal === total,
  };
}

function mapKnownOperationalStatus(value) {
  const normalized = normalizeLower(value);
  return normalized ? mapHubStatus(normalized) : null;
}

function effectiveAdminOperationalStatuses(order = {}) {
  const taskSummary = order.native_fulfillment_task_summary || {};
  const taskCompletion = taskSummaryCompletion(taskSummary);
  const taskTerminal = taskCompletion.all_terminal || (taskCompletion.total === 0 && taskSummaryHasTerminalStatus(taskSummary));
  const taskMixed = taskCompletion.mixed;
  const hubTerminal = isTerminalOperationalStatus(order.hub_operational_status) || isTerminalOperationalStatus(order.hub_fulfillment_status);
  const customerTerminal = isTerminalOperationalStatus(order.customer_app_order_status) || isTerminalOperationalStatus(order.status);
  const deliveredLike = !taskMixed && (hubTerminal || taskTerminal || customerTerminal || Boolean(order.delivered_at));
  const sourceStatus = (
    (taskMixed ? 'partially_fulfilled' : null) ||
    order.hub_operational_status ||
    order.hub_fulfillment_status ||
    (taskTerminal ? 'delivered' : null) ||
    order.customer_app_order_status ||
    order.status ||
    null
  );
  const sourceFulfillment = (
    (taskMixed ? 'partially_fulfilled' : null) ||
    order.hub_fulfillment_status ||
    order.hub_operational_status ||
    (taskTerminal ? 'delivered' : null) ||
    order.native_fulfillment_status ||
    null
  );
  const staleFields = [
    deliveredLike && isStalePendingNativeStatus(order.native_production_status) ? 'native_production_status' : null,
    deliveredLike && isStalePendingNativeStatus(order.native_fulfillment_status) ? 'native_fulfillment_status' : null,
  ].filter(Boolean);

  return {
    effective_order_status: taskMixed ? 'partially_fulfilled' : mapKnownOperationalStatus(sourceStatus) || (order.status || null),
    effective_production_status: taskMixed
      ? 'partially_complete'
      : staleFields.includes('native_production_status')
      ? mapKnownOperationalStatus(sourceStatus || sourceFulfillment || 'delivered')
      : (order.native_production_status || mapKnownOperationalStatus(sourceStatus) || null),
    effective_fulfillment_status: taskMixed
      ? 'partially_fulfilled'
      : staleFields.includes('native_fulfillment_status')
      ? mapKnownOperationalStatus(sourceFulfillment || sourceStatus || 'delivered')
      : (order.native_fulfillment_status || mapKnownOperationalStatus(sourceFulfillment || sourceStatus) || null),
    effective_delivery_status: taskMixed
      ? 'partially_fulfilled'
      : deliveredLike
      ? 'delivered'
      : mapKnownOperationalStatus(sourceFulfillment || sourceStatus),
    effective_status_source: order.is_hub_order
      ? (taskTerminal ? 'hub_primary_with_native_task_context' : 'hub_primary')
      : taskMixed ? 'native_task_occurrences' : taskTerminal ? 'native_task' : order.has_customer_app_order ? 'customer_app_order' : 'native_mirror',
    fulfillment_occurrence_summary: taskCompletion,
    native_status_stale_against_source: staleFields.length > 0,
    native_status_stale_fields: staleFields,
  };
}

function attachEffectiveAdminOperationalStatuses(order = {}) {
  return {
    ...order,
    ...effectiveAdminOperationalStatuses(order),
  };
}

function compactAdminOrderRow(order = {}) {
  const effectiveStatuses = effectiveAdminOperationalStatuses(order);
  const items = Array.isArray(order.items) ? order.items.slice(0, ADMIN_ORDER_LIST_COMPACT_MAX_ITEMS_PER_ROW).map(compactLineItem) : [];
  const pricing = buildCompactPricingFromLineItems(order, items);
  const deliveryRateContext = compactDeliveryRateContext(order);
  const taskSummary = compactTaskSummary(order.native_fulfillment_task_summary);
  const latestSyncLog = compactLatestSyncLog(order.native_latest_sync_log);
  const reviewSummary = compactReviewSummary(order.native_review_queue_summary);
  const hubSyncSummary = compactHubSyncSummary(order.hub_sync_summary);

  return {
    id: order.id || order.customer_app_order_id || order.hub_order_id || order.order_number || null,
    order_number: order.order_number || null,
    created_date: order.created_date || null,
    status: order.status || null,
    effective_order_status: effectiveStatuses.effective_order_status,
    payment_status: order.payment_status || order.financial_status || null,
    financial_status: order.financial_status || null,
    payment_captured: order.payment_captured === true,
    fulfillment_type: order.fulfillment_type || null,
    estimated_delivery_date: order.estimated_delivery_date || order.assigned_delivery_date || order.delivery_date || null,
    assigned_delivery_date: order.assigned_delivery_date || null,
    selected_delivery_date: order.selected_delivery_date || null,
    requested_delivery_date: order.requested_delivery_date || null,
    delivery_window_label: order.delivery_window_label || null,
    total: pricing.total,
    subtotal: pricing.subtotal,
    delivery_fee: pricing.delivery_fee,
    total_tax: pricing.total_tax,
    total_discounts: pricing.total_discounts,
    discount_codes: compactStringArray(order.discount_codes),
    delivery_rate_context: {
      ...deliveryRateContext,
      delivery_fee: deliveryRateContext.delivery_fee ?? pricing.delivery_fee,
    },
    pricing_fields_inferred_from_line_items: pricing.inferred_from_line_items,
    order_type: compactString(order.order_type, 64),
    source_type: compactString(order.source_type, 64),
    source_channel: compactString(order.source_channel, 64),
    customer_email: order.customer_email || order.hub_customer_email || null,
    customer_name: compactString(order.customer_name || order.full_name || order.shipping_name || order.billing_name, 96),
    full_name: compactString(order.full_name, 96),
    shipping_name: compactString(order.shipping_name, 96),
    billing_name: compactString(order.billing_name, 96),
    contact_phone: compactString(order.contact_phone, 48),
    delivery_address: compactString(order.delivery_address, 160),
    items,
    notes: compactString(order.notes, 180),
    is_test_order: order.is_test_order === true,
    do_not_recover: order.do_not_recover === true,
    is_abandoned_checkout: order.is_abandoned_checkout === true,
    is_hub_order: order.is_hub_order === true,
    is_native_order: order.is_native_order === true,
    has_customer_app_order: order.has_customer_app_order === true,
    has_native_order: order.has_native_order === true,
    has_native_task: order.has_native_task === true,
    customer_app_order_id: order.customer_app_order_id || null,
    customer_app_order_status: order.customer_app_order_status || null,
    customer_app_payment_status: order.customer_app_payment_status || null,
    customer_app_payment_captured: order.customer_app_payment_captured === true,
    customer_app_line_item_count: Number.isFinite(Number(order.customer_app_line_item_count)) ? Number(order.customer_app_line_item_count) : null,
    native_shopify_order_id: order.native_shopify_order_id || null,
    native_payment_status: order.native_payment_status || null,
    native_production_status: order.native_production_status || null,
    native_fulfillment_status: order.native_fulfillment_status || null,
    effective_production_status: effectiveStatuses.effective_production_status,
    effective_fulfillment_status: effectiveStatuses.effective_fulfillment_status,
    effective_delivery_status: effectiveStatuses.effective_delivery_status,
    effective_status_source: effectiveStatuses.effective_status_source,
    native_status_stale_against_source: effectiveStatuses.native_status_stale_against_source,
    native_status_stale_fields: effectiveStatuses.native_status_stale_fields,
    native_sync_status: order.native_sync_status || null,
    native_review_status: order.native_review_status || null,
    native_source_type: order.native_source_type || null,
    native_source_channel: order.native_source_channel || null,
    native_order_type: order.native_order_type || null,
    native_line_item_count: Number.isFinite(Number(order.native_line_item_count)) ? Number(order.native_line_item_count) : null,
    native_total: Number.isFinite(Number(order.native_total)) ? Number(order.native_total) : null,
    native_order_lock_status: order.native_order_lock_status || null,
    order_lock_status: order.order_lock_status || null,
    ...(taskSummary ? { native_fulfillment_task_summary: taskSummary } : {}),
    ...(latestSyncLog ? { native_latest_sync_log: latestSyncLog } : {}),
    ...(reviewSummary ? { native_review_queue_summary: reviewSummary } : {}),
    hub_order_id: order.hub_order_id || null,
    hub_customer_email: order.hub_customer_email || null,
    hub_operational_status: order.hub_operational_status || null,
    hub_fulfillment_status: order.hub_fulfillment_status || null,
    hub_fulfillment_number: order.hub_fulfillment_number || null,
    hub_updated_date: order.hub_updated_date || null,
    ...(hubSyncSummary ? { hub_sync_summary: hubSyncSummary } : {}),
    production_date: order.production_date || null,
    delivered_at: order.delivered_at || null,
    delivered_by: compactString(order.delivered_by, 96),
    delivery_drop_location: compactString(order.delivery_drop_location, 120),
    delivery_photo_url: order.delivery_photo_url || null,
    approval_status: order.approval_status || null,
    sync_status: order.sync_status || null,
    admin_context_badges: Array.isArray(order.admin_context_badges) ? order.admin_context_badges.slice(0, 8).map(item => compactString(item, 72)).filter(Boolean) : [],
    admin_context_guidance: Array.isArray(order.admin_context_guidance)
      ? order.admin_context_guidance.slice(0, 3).map(item => ({
          label: compactString(item.label, 80),
          detail: compactString(item.detail, 140),
          tone: compactString(item.tone, 40),
        }))
      : [],
  };
}

function buildAdminOrderListCompactResponse({ merged = [], localOrders = [], allLocalOrders = localOrders, allHubOrders = [], nativeShopifyOrders = [], fulfillmentTasks = [], diagnostics = {} } = {}) {
  const normalized = merged
    .map(order => normalizeOrderNum(order?.order_number))
    .filter(Boolean);
  const duplicateOrderNumbers = normalized.length - new Set(normalized).size;
  const sourceTruncated = {
    local_orders: allLocalOrders.length >= 500,
    hub_orders: allHubOrders.length >= 500,
    native_shopify_orders: nativeShopifyOrders.length >= 500,
    fulfillment_tasks: fulfillmentTasks.length >= 500,
  };
  const anySourceTruncated = Object.values(sourceTruncated).some(Boolean);
  const compactOrders = merged
    .slice(0, ADMIN_ORDER_LIST_COMPACT_MAX_ROWS)
    .map(compactAdminOrderRow);
  const compactOrderWindowed = merged.length > compactOrders.length;

  return {
    success: true,
    response_mode: ADMIN_ORDER_LIST_COMPACT_RESPONSE_MODE,
    response_contract: ADMIN_ORDER_LIST_COMPACT_CONTRACT,
    orders: compactOrders,
    order_count: merged.length,
    orders_returned: compactOrders.length,
    compact_order_limit: ADMIN_ORDER_LIST_COMPACT_MAX_ROWS,
    compact_order_windowed: compactOrderWindowed,
    total: merged.length,
    source_counts: {
      local_orders: localOrders.length,
      hub_orders: allHubOrders.length,
      native_shopify_orders: nativeShopifyOrders.length,
      fulfillment_tasks: fulfillmentTasks.length,
    },
    local_count: localOrders.length,
    hub_count: allHubOrders.length,
    native_shopify_order_count: nativeShopifyOrders.length,
    source_truncated: anySourceTruncated,
    source_truncated_by_entity: sourceTruncated,
    fallback_active: true,
    duplicate_order_number_count: duplicateOrderNumbers,
    warnings: [
      anySourceTruncated ? 'source_truncated' : null,
      compactOrderWindowed ? 'compact_order_windowed' : null,
      duplicateOrderNumbers > 0 ? 'duplicate_order_numbers_detected' : null,
    ].filter(Boolean),
    compact_response_contains_raw_legacy_payload: false,
    compact_response_contains_required_action_refs: true,
    writes_performed: false,
    order_mutation_performed: false,
    native_order_mutation_performed: false,
    fulfillment_task_mutation_performed: false,
    payment_mutation_performed: false,
    refund_mutation_performed: false,
    provider_call_impact: false,
    stripe_calls: false,
    shopify_calls: false,
    hub_calls: false,
    notifications_sent: false,
    repair_replay_performed: false,
    hub_write_suppression_ready: false,
    raw_payloads_returned: false,
    pii_returned: false,
    ...(diagnostics && typeof diagnostics === 'object' ? {
      exact_native_match_count: diagnostics.exact_native_match_count,
      status_mismatch_count: diagnostics.status_mismatch_count,
      payment_mismatch_count: diagnostics.payment_mismatch_count,
      delivery_date_mismatch_count: diagnostics.delivery_date_mismatch_count,
    } : {}),
  };
}

function isPosLikeOrder(order) {
  return [
    order?.source_channel,
    order?.source_type,
    order?.order_type,
    order?.fulfillment_type,
    order?.fulfillment_method,
  ].some(value => normalizeLower(value) === 'pos');
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function addIndexValue(index, key, value) {
  const normalizedKey = normalizeOrderNum(key);
  if (!normalizedKey || !value || index.has(normalizedKey)) return;
  index.set(normalizedKey, value);
}

function isPaidOrder(order) {
  return (
    order?.payment_status === 'paid' ||
    order?.financial_status === 'paid' ||
    order?.payment_captured === true ||
    order?.native_payment_status === 'paid' ||
    order?.customer_app_payment_status === 'paid'
  );
}

function isPendingPaymentOrder(order) {
  return (
    order?.status === 'pending_payment' ||
    ['pending', 'unpaid', 'requires_payment_method'].includes(normalizeLower(order?.payment_status)) ||
    ['pending', 'unpaid', 'requires_payment_method'].includes(normalizeLower(order?.financial_status))
  );
}

function hasPaymentSignal(order) {
  return Boolean(
    order?.payment_status ||
    order?.financial_status ||
    order?.payment_captured === true ||
    order?.native_payment_status ||
    order?.customer_app_payment_status
  );
}

function normalizeComparable(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return value.toString().trim().toLowerCase();
}

function valuesDiffer(left, right) {
  const normalizedLeft = normalizeComparable(left);
  const normalizedRight = normalizeComparable(right);
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft !== normalizedRight;
}

function numericValuesDiffer(left, right) {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
  return Math.abs(leftNumber - rightNumber) > 0.009;
}

function lineItemCount(order) {
  if (Number.isFinite(Number(order?.customer_app_line_item_count))) return Number(order.customer_app_line_item_count);
  if (Number.isFinite(Number(order?.native_line_item_count))) return Number(order.native_line_item_count);
  if (Array.isArray(order?.items)) return order.items.length;
  if (Array.isArray(order?.line_items)) return order.line_items.length;
  return null;
}

function currentRowLineItemCount(order) {
  if (Array.isArray(order?.items)) return order.items.length;
  if (Array.isArray(order?.line_items)) return order.line_items.length;
  return null;
}

function statusLooksTerminalOrRefunded(order) {
  return ['cancelled', 'canceled', 'refunded'].some(status => [
    order?.status,
    order?.payment_status,
    order?.financial_status,
    order?.refund_status,
  ].map(normalizeLower).includes(status));
}

function isSubscriptionOrMultiDelivery(order) {
  return [
    order?.order_type,
    order?.native_order_type,
    order?.source_channel,
    order?.source_type,
    order?.fulfillment_mode,
  ].some(value => {
    const normalized = normalizeLower(value);
    return normalized.includes('subscription') || normalized.includes('multi_delivery') || normalized.includes('multi-delivery');
  }) || Boolean(order?.stripe_subscription_id || order?.hub_fulfillment_number);
}

function isRepairReplayContext(order) {
  const joined = [
    order?.native_sync_status,
    order?.native_review_status,
    order?.order_lock_status,
    order?.native_order_lock_status,
    order?.hub_sync_summary?.action,
    order?.hub_sync_summary?.reason,
    order?.native_latest_sync_log?.action,
    order?.native_latest_sync_log?.reason,
    order?.native_review_queue_summary?.incident_type,
    order?.native_review_queue_summary?.recommended_action,
  ].map(normalizeLower).join(' ');

  return ['repair', 'replay', 'safe_sync', 'safesync', 'review_required', 'queued_for_review'].some(token => joined.includes(token)) ||
    Boolean(order?.native_review_queue_summary);
}

function isHistoricalLateMirror(order) {
  const joined = [
    order?.notes,
    order?.source_type,
    order?.native_source_type,
    order?.native_sync_status,
    order?.native_order_lock_status,
    order?.order_lock_status,
    order?.native_latest_sync_log?.source,
    order?.native_latest_sync_log?.reason,
  ].map(normalizeLower).join(' ');

  return ['historical', 'late_mirror', 'late-mirror', 'backfill'].some(token => joined.includes(token));
}

function orderClassification(order) {
  if (isSubscriptionOrMultiDelivery(order)) return 'subscription_or_multi_delivery';
  if (statusLooksTerminalOrRefunded(order)) return 'refunded_or_cancelled';
  if (isPendingPaymentOrder(order) || (hasPaymentSignal(order) && !isPaidOrder(order))) return 'payment_not_ready';
  if (isRepairReplayContext(order)) return 'repair_replay_context';
  if (isHistoricalLateMirror(order)) return 'historical_late_mirror';
  if (!order?.is_hub_order && (order?.is_native_order || order?.has_native_order)) return 'native_mirror_only';
  if (order?.is_hub_order && !order?.has_native_order && !order?.has_customer_app_order) return 'hub_dedupe_only';
  if (['delivered', 'picked_up'].includes(normalizeLower(order?.status))) return 'one_time_complete';
  if (isPaidOrder(order)) return 'one_time_active_paid';
  return 'unknown';
}

function sourceOfTruthForOrder(order, classification) {
  if (classification === 'subscription_or_multi_delivery') return 'subscription_hub';
  if (['refunded_or_cancelled', 'payment_not_ready'].includes(classification)) return 'payment_provider_hub';
  if (classification === 'repair_replay_context') return 'manual_review';
  if (order?.is_hub_order) return 'hub';
  if (order?.is_native_order || order?.has_native_order) return 'native';
  return 'unknown';
}

function mismatchDiagnosticsForOrder(order) {
  const mismatchFields = [];
  const mismatchCategories = [];

  const addMismatch = (field, category) => {
    if (!mismatchFields.includes(field)) mismatchFields.push(field);
    if (category && !mismatchCategories.includes(category)) mismatchCategories.push(category);
  };

  if (valuesDiffer(order?.status, order?.customer_app_order_status)) addMismatch('status', 'status_mismatch');
  if (valuesDiffer(order?.payment_status || order?.financial_status, order?.customer_app_payment_status)) addMismatch('payment_status', 'payment_mismatch');
  if (valuesDiffer(order?.payment_status || order?.financial_status, order?.native_payment_status)) addMismatch('payment_status', 'payment_mismatch');
  if (
    order?.payment_captured !== undefined &&
    order?.customer_app_payment_captured !== undefined &&
    Boolean(order.payment_captured) !== Boolean(order.customer_app_payment_captured)
  ) {
    addMismatch('payment_captured', 'payment_mismatch');
  }
  if (valuesDiffer(order?.hub_fulfillment_status || order?.fulfillment_status, order?.native_fulfillment_status)) addMismatch('fulfillment_status', 'fulfillment_mismatch');
  if (valuesDiffer(order?.production_status, order?.native_production_status)) addMismatch('production_status', 'production_mismatch');

  const taskSummary = order?.native_fulfillment_task_summary || {};
  const nativeTask = Array.isArray(taskSummary.tasks) ? taskSummary.tasks[0] : null;
  const hubDeliveryDate = order?.assigned_delivery_date || order?.estimated_delivery_date || null;
  const nativeDeliveryDate = nativeTask?.delivery_date || taskSummary.next_delivery_date || order?.customer_app_estimated_delivery_date || null;
  if (valuesDiffer(hubDeliveryDate, nativeDeliveryDate)) addMismatch('delivery_date', 'delivery_schedule_mismatch');

  const visibleLineCount = currentRowLineItemCount(order);
  const comparableLineCount = lineItemCount(order);
  if (
    Number.isFinite(Number(visibleLineCount)) &&
    Number.isFinite(Number(comparableLineCount)) &&
    Number(visibleLineCount) !== Number(comparableLineCount)
  ) {
    addMismatch('line_item_count', 'line_item_mismatch');
  }
  if (numericValuesDiffer(order?.total, order?.native_total)) addMismatch('total_price', 'financial_mismatch');

  return { mismatchFields, mismatchCategories };
}

function fallbackReasonForOrder(order, classification, mismatchFields) {
  if (classification === 'subscription_or_multi_delivery') return 'subscription_hub_source_of_truth';
  if (['refunded_or_cancelled', 'payment_not_ready'].includes(classification)) return 'payment_or_refund_hub_source_of_truth';
  if (classification === 'repair_replay_context') return 'manual_review_repair_replay_context';
  if (classification === 'historical_late_mirror') return 'historical_late_mirror_admin_context_only';
  if (order?.is_hub_order && !order?.has_native_order) return 'native_missing_hub_available';
  if (!order?.is_hub_order && (order?.is_native_order || order?.has_native_order)) return 'hub_missing_native_available';
  if (mismatchFields.length > 0) return 'native_hub_mismatch_hub_primary_preserved';
  if (order?.is_hub_order && order?.has_native_order) return 'hub_primary_with_native_context';
  if (!order?.is_hub_order && order?.has_customer_app_order) return 'local_customer_app_only';
  return null;
}

function dataSourceForOrder(order) {
  if (order?.is_hub_order && (order?.has_native_order || order?.has_customer_app_order)) return 'hub_with_native_context';
  if (order?.is_hub_order) return 'hub_primary';
  if (order?.is_native_order || order?.has_native_order) return 'native_only';
  if (order?.hub_sync_summary) return 'native_with_hub_fallback_context';
  return 'local_customer_app_only';
}

function addCount(counts, key) {
  if (!key) return;
  counts[key] = (counts[key] || 0) + 1;
}

function decorateAdminOrderDiagnostics(order) {
  const classification = orderClassification(order);
  const sourceOfTruth = sourceOfTruthForOrder(order, classification);
  const { mismatchFields, mismatchCategories } = mismatchDiagnosticsForOrder(order);
  const fallbackReason = fallbackReasonForOrder(order, classification, mismatchFields);
  const reviewRequired = mismatchFields.length > 0 ||
    ['payment_provider_hub', 'manual_review', 'unknown'].includes(sourceOfTruth) ||
    ['historical_late_mirror', 'repair_replay_context'].includes(classification);
  const warnings = [];
  if (mismatchFields.length > 0) warnings.push('native_hub_mismatch_diagnostics_only');
  if (classification === 'historical_late_mirror') warnings.push('not_live_lifecycle_candidate');
  if (classification === 'subscription_or_multi_delivery') warnings.push('subscription_hub_source_of_truth');
  if (sourceOfTruth === 'payment_provider_hub') warnings.push('payment_or_refund_hub_source_of_truth');

  return {
    ...order,
    data_source: dataSourceForOrder(order),
    hub_primary: order?.is_hub_order === true,
    native_context_available: Boolean(order?.has_native_order || order?.has_native_task || order?.native_fulfillment_task_summary?.count),
    fallback_source: fallbackReason ? (order?.is_hub_order ? 'hub_order_context' : order?.has_native_order ? 'native_order_context' : 'customer_app_order_context') : null,
    fallback_reason: fallbackReason,
    mismatch_fields: mismatchFields,
    mismatch_categories: mismatchCategories,
    review_required: reviewRequired,
    customer_facing_safe: mismatchFields.length === 0 && sourceOfTruth === 'native' ? false : false,
    source_of_truth: sourceOfTruth,
    order_classification: classification,
    live_command_candidate: false,
    warnings: uniqueValues([...(Array.isArray(order?.warnings) ? order.warnings : []), ...warnings]),
  };
}

function buildAdminOrderDiagnostics({ mergedOrders, filteredHubOrders, nativeAdminOrders, fulfillmentTasks, localOrders }) {
  const exactMatchRows = mergedOrders.filter(order => (
    order.has_native_order &&
    order.is_hub_order &&
    Array.isArray(order.mismatch_fields) &&
    order.mismatch_fields.length === 0
  ));
  const mismatchRows = mergedOrders.filter(order => Array.isArray(order.mismatch_fields) && order.mismatch_fields.length > 0);
  const nativeMissingHubAvailable = mergedOrders.filter(order => order.is_hub_order && !order.has_native_order);
  const nativeOnlyRows = mergedOrders.filter(order => !order.is_hub_order && (order.is_native_order || order.has_native_order));
  const hubOnlyRows = mergedOrders.filter(order => order.is_hub_order && !order.has_native_order && !order.has_customer_app_order);
  const fallbackRows = mergedOrders.filter(order => Boolean(order.fallback_reason));
  const reviewRows = mergedOrders.filter(order => order.review_required === true);
  const nativePrimaryRows = mergedOrders.filter(order => order.native_primary_eligible === true && order.admin_primary_source === 'native');
  const hubPrimaryRows = mergedOrders.filter(order => order.admin_primary_source === 'hub');
  const nativePrimaryEligibleRows = mergedOrders.filter(order => order.native_primary_eligible === true);
  const nativePrimaryIneligibleRows = mergedOrders.filter(order => order.native_primary_eligible !== true);
  const mismatchCategoryCounts = {};
  const fallbackReasonCounts = {};
  const sourceOfTruthCounts = {};
  const nativePrimaryIneligibleReasonCounts = {};

  for (const order of mergedOrders) {
    for (const category of Array.isArray(order.mismatch_categories) ? order.mismatch_categories : []) addCount(mismatchCategoryCounts, category);
    addCount(fallbackReasonCounts, order.fallback_reason);
    addCount(sourceOfTruthCounts, order.source_of_truth);
    for (const blocker of Array.isArray(order.native_primary_blockers) ? order.native_primary_blockers : []) addCount(nativePrimaryIneligibleReasonCounts, blocker);
  }

  return {
    admin_orders_diagnostics_enabled: true,
    limited_native_primary_enabled: true,
    native_first_enabled: false,
    hub_first_enabled: true,
    hub_fallback_active: true,
    writes_performed: false,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    customer_facing_behavior_changed: false,
    append_admin_hub_order_note_touched: false,
    hub_row_count: filteredHubOrders.length,
    native_shopify_order_row_count: nativeAdminOrders.length,
    native_fulfillment_task_row_count: Array.isArray(fulfillmentTasks) ? fulfillmentTasks.length : 0,
    local_customer_app_order_row_count: localOrders.length,
    merged_row_count: mergedOrders.length,
    exact_match_count: exactMatchRows.length,
    mismatch_count: mismatchRows.length,
    native_missing_hub_available_count: nativeMissingHubAvailable.length,
    hub_missing_native_available_count: nativeOnlyRows.length,
    hub_only_count: hubOnlyRows.length,
    native_only_count: nativeOnlyRows.length,
    native_primary_row_count: nativePrimaryRows.length,
    hub_primary_row_count: hubPrimaryRows.length,
    native_primary_eligible_count: nativePrimaryEligibleRows.length,
    native_primary_ineligible_count: nativePrimaryIneligibleRows.length,
    native_primary_ineligible_reasons: nativePrimaryIneligibleReasonCounts,
    fallback_required_count: fallbackRows.length,
    review_required_count: reviewRows.length,
    mismatch_categories: mismatchCategoryCounts,
    fallback_reasons: fallbackReasonCounts,
    source_of_truth_holds: sourceOfTruthCounts,
  };
}

function nativeCandidateForAdminRow(order, nativeOrderIndexes) {
  if (!order || !nativeOrderIndexes) return null;
  return nativeOrderIndexes.byNativeOrderId.get(order.native_shopify_order_id) ||
    nativeOrderIndexes.byCustomerAppOrderId.get(order.customer_app_order_id || order.native_base44_order_id) ||
    nativeOrderIndexes.byOrderNumber.get(normalizeOrderNum(order.native_order_number || order.order_number)) ||
    null;
}

function hasOneTimeOrderSignal(order) {
  const values = [
    order?.order_type,
    order?.native_order_type,
    order?.source_type,
    order?.native_source_type,
    order?.source_channel,
    order?.native_source_channel,
  ].map(normalizeLower);

  if (values.some(value => ['one_time', 'one-time', 'one time'].includes(value))) return true;
  if (['one_time_active_paid', 'one_time_complete', 'historical_late_mirror', 'native_mirror_only'].includes(order?.order_classification)) {
    return !isSubscriptionOrMultiDelivery(order) && !isPosLikeOrder(order);
  }
  return false;
}

function evaluateAdminOrderLimitedNativePrimaryEligibility(order, nativeCandidate = null) {
  const blockers = [];
  const addBlocker = (blocker) => {
    if (blocker && !blockers.includes(blocker)) blockers.push(blocker);
  };

  const classification = order?.order_classification || orderClassification(order);
  const sourceOfTruth = order?.source_of_truth || sourceOfTruthForOrder(order, classification);
  const mismatchFields = Array.isArray(order?.mismatch_fields) ? order.mismatch_fields : [];
  const taskSummary = order?.native_fulfillment_task_summary || {};

  if (!hasOneTimeOrderSignal({ ...order, order_classification: classification })) addBlocker('one_time_not_proven');
  if (isPosLikeOrder(order)) addBlocker('pos_or_event_not_in_limited_subset');
  if (isSubscriptionOrMultiDelivery(order) || classification === 'subscription_or_multi_delivery') addBlocker('subscription_or_multi_delivery_hub_source_of_truth');
  if (classification === 'refunded_or_cancelled' || statusLooksTerminalOrRefunded(order)) addBlocker('refund_cancel_payment_source_of_truth');
  if (classification === 'payment_not_ready' || isPendingPaymentOrder(order) || !isPaidOrder(order)) addBlocker('payment_not_ready');
  if (order?.payment_captured !== true && order?.customer_app_payment_captured !== true) addBlocker('payment_not_captured');
  if (classification === 'repair_replay_context' || isRepairReplayContext(order)) addBlocker('repair_replay_manual_review');
  if (sourceOfTruth === 'payment_provider_hub') addBlocker('payment_provider_hub_source_of_truth');
  if (sourceOfTruth === 'subscription_hub') addBlocker('subscription_hub_source_of_truth');
  if (sourceOfTruth === 'manual_review') addBlocker('manual_review_source_of_truth');
  if (sourceOfTruth === 'unknown') addBlocker('unknown_source_of_truth');
  if (!order?.has_customer_app_order || !order?.customer_app_order_id) addBlocker('customer_app_order_missing');
  if (!order?.has_native_order || !(order?.native_shopify_order_id || nativeCandidate?.native_shopify_order_id)) addBlocker('native_shopify_order_missing');
  if (!nativeCandidate) addBlocker('native_primary_candidate_missing');
  if (!(order?.has_native_task === true || Number(taskSummary.count) > 0)) addBlocker('native_fulfillment_task_missing');
  if (order?.native_review_queue_summary) addBlocker('order_review_queue_blocker');
  if (mismatchFields.length > 0) addBlocker('native_hub_mismatch');
  if (order?.review_required === true) addBlocker('review_required');
  if (Array.isArray(order?.native_task_missing_metadata_fields) && order.native_task_missing_metadata_fields.length > 0) addBlocker('native_task_metadata_incomplete');

  const reason = blockers.length === 0
    ? (classification === 'historical_late_mirror'
        ? 'safe_historical_late_mirror_admin_context_only'
        : order?.is_hub_order
          ? 'safe_one_time_reconciled_native_context'
          : 'safe_one_time_native_born_or_mirror')
    : null;

  return {
    eligible: blockers.length === 0,
    reason,
    blockers,
  };
}

function retainHubFallbackContextForNativePrimary(nativePrimaryRow, currentRow) {
  if (!nativePrimaryRow || !currentRow?.is_hub_order) return nativePrimaryRow;

  const withHubFallback = {
    ...nativePrimaryRow,
    is_hub_order: true,
    hub_order_id: currentRow.hub_order_id || nativePrimaryRow.hub_order_id || null,
    hub_customer_email: currentRow.hub_customer_email || nativePrimaryRow.hub_customer_email || null,
    hub_operational_status: currentRow.hub_operational_status || nativePrimaryRow.hub_operational_status || null,
    hub_fulfillment_status: currentRow.hub_fulfillment_status || nativePrimaryRow.hub_fulfillment_status || null,
    hub_fulfillment_number: currentRow.hub_fulfillment_number || nativePrimaryRow.hub_fulfillment_number || null,
    hub_sync_summary: currentRow.hub_sync_summary || nativePrimaryRow.hub_sync_summary || null,
    delivery_window_label: nativePrimaryRow.delivery_window_label || currentRow.delivery_window_label || null,
    created_date: currentRow.created_date || nativePrimaryRow.created_date || null,
  };

  const withEffectiveStatuses = attachEffectiveAdminOperationalStatuses(withHubFallback);
  withEffectiveStatuses.admin_context_guidance = buildOperationalContextGuidance(withEffectiveStatuses);
  withEffectiveStatuses.admin_context_badges = buildAdminContextBadges(withEffectiveStatuses);
  return withEffectiveStatuses;
}

function adminPrimarySourceForOrder(order, evaluation) {
  if (evaluation?.eligible === true) return 'native';
  if (order?.is_hub_order) return 'hub';
  if (order?.is_native_order || order?.has_native_order) return 'native';
  return 'local_customer_app';
}

function applyLimitedNativePrimaryMetadata(order, evaluation) {
  const adminPrimarySource = adminPrimarySourceForOrder(order, evaluation);
  return {
    ...order,
    admin_primary_source: adminPrimarySource,
    native_primary_eligible: evaluation?.eligible === true,
    native_primary_reason: evaluation?.reason || null,
    native_primary_blockers: Array.isArray(evaluation?.blockers) ? evaluation.blockers : [],
    customer_facing_safe: evaluation?.eligible === true,
    source_of_truth: evaluation?.eligible === true ? 'native' : order?.source_of_truth,
    write_path_not_in_scope: true,
  };
}

/**
 * 🏛️ ACTIVE ARCHITECTURE FUNCTION — Option B (Read-Only Hub Expansion)
 * 
 * Role: Admin view of ALL orders (local + Hub-verified) with full merge and expansion.
 * Source of Truth: Hub (for operational orders, subscriptions, deliveries)
 * 
 * PROCESS:
 * 1. Fetch all local orders (excluding superseded, cancelled, ghost pre-orders)
 * 2. Fetch ALL UserProfile records to get every customer's contact email
 * 3. Query Hub for each customer's orders (include cancelled-only customers for visibility)
 * 4. Expand Hub subscription orders into fulfillment-level display records
 * 5. Expand local subscription orders via FulfillmentTask references
 * 6. Merge: Hub remains the primary row on order_number; local + native context attach for same-order visibility
 * 7. Return merged list sorted by created_date (newest first)
 * 
 * FULFILLMENT EXPANSION:
 * - Hub subscriptions: broken into individual fulfillments (e.g., 4 weekly deliveries)
 * - Local subscriptions: expanded via FulfillmentTask if available
 * - Result: Admins see individual deliveries, not parent "0-item" records
 * 
 * STATUS UPDATES:
 * - Generic order workflow controls are frozen in the admin UI during launch hardening
 * - This function is read-only aggregation and does not create, update, sync, repair, notify, or call providers
 * 
 * Called by: pages/AdminOrders (admin order management)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch (_authError) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (!user) {
      return Response.json({ error: 'Authentication required' }, { status: 401 });
    }
    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    let body = {};
    try {
      body = await req.json();
    } catch (_jsonError) {
      body = {};
    }
    const adminOrderLifecycleReadModelRequested = isAdminOrderLifecycleReadModelRequest(body);
    const adminOrderLifecycleReadModelActive = adminOrderLifecycleReadModelEnabled();
    const adminOrderListCompactRequested = isAdminOrderListCompactRequest(body);

    if (hasConflictingAdminOrderLifecycleModeValues(body)) {
      return Response.json(buildAdminOrderLifecycleModeConflictResponse(), { status: 400 });
    }

    if (adminOrderLifecycleReadModelRequested && adminOrderListCompactRequested) {
      return Response.json({
        success: false,
        error: 'conflicting_response_contract_modes',
        dry_run: true,
        writes_performed: false,
        response_contract: ADMIN_ORDER_LIST_COMPACT_CONTRACT,
        legacy_orders_payload_included: false,
        provider_call_impact: false,
        stripe_calls: false,
        shopify_calls: false,
        hub_calls: false,
        notifications_sent: false,
        order_mutation_performed: false,
        native_order_mutation_performed: false,
        fulfillment_task_mutation_performed: false,
        repair_replay_performed: false,
        raw_payloads_returned: false,
        pii_returned: false,
      }, { status: 400 });
    }

    if (isG48eRuntimeDiagnosticRequest(body)) {
      return Response.json({
        success: true,
        dry_run: true,
        writes_performed: false,
        g48e_source_marker_present: true,
        request_body_parsed: true,
        read_model_mode_received: Boolean(body?.read_model_mode),
        read_model_mode_value_match: adminOrderLifecycleReadModelRequested,
        diagnostic_mode_received: true,
        diagnostic_mode_value_match: true,
        legacy_path_selected: false,
        capability_metadata_constructed: true,
        capability_metadata_attached: true,
        response_contract_version: G48E_RUNTIME_CONTRACT_VERSION,
        admin_order_lifecycle_read_model_available: true,
        admin_order_lifecycle_read_model_enabled: Boolean(adminOrderLifecycleReadModelRequested && adminOrderLifecycleReadModelActive),
        admin_order_lifecycle_read_model_version: ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION,
        read_model_payload_present: false,
        order_write_ready: false,
        payment_write_ready: false,
        refund_write_ready: false,
        fulfillment_write_ready: false,
        delivery_write_ready: false,
        notification_expansion_ready: false,
        hub_write_suppression_ready: false,
        repair_replay_ready: false,
        provider_call_impact: false,
        hub_mutation_performed: false,
        notifications_sent: false,
        raw_payloads_returned: false,
        pii_returned: false,
      });
    }

    if (adminOrderLifecycleReadModelRequested && !adminOrderLifecycleReadModelActive) {
      return Response.json(buildAdminOrderLifecycleCompactResponse({ enabled: false }));
    }

    // 1. Fetch all local orders, exclude superseded, cancelled, and ghost pre-orders
    // A "ghost" pre-order is one that was authorized but never completed payment capture
    // (payment_captured=false AND no stripe_payment_intent_id means it's an abandoned/admin-created stub)
    const allLocalOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
    
    // Fetch all FulfillmentTasks for expanding local subscription orders
    let fulfillmentTasks = [];
    try {
      if (allLocalOrders.length > 0) {
        fulfillmentTasks = await base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 500);
      }
    } catch (err) {
      // FulfillmentTask may not exist yet — skip expansion
      console.warn('[AdminOrders] FulfillmentTask not available, skipping expansion:', err.message);
    }
    const cancelledOrderNumbers = new Set(
      allLocalOrders
        .filter(o => o.status === 'cancelled')
        .map(o => (o.order_number || '').toString().replace(/^#/, '').trim().toLowerCase())
        .filter(Boolean)
    );
    // Also track customer emails that have ONLY cancelled orders (no live orders)
    // so we can suppress ALL their Hub orders from showing up
    const allEmailsWithLiveOrders = new Set(
       allLocalOrders
         .filter(o =>
           o.status !== 'cancelled' &&
           o.financial_status !== 'refunded' &&
           o.payment_status !== 'refunded' &&
           o.do_not_recover !== true &&
           !(o.notes && o.notes.includes('SUPERSEDED_BY_HUB'))
         )
         .map(o => o.customer_email?.toLowerCase())
         .filter(Boolean)
     );
    const localOrders = allLocalOrders.filter(o => {
      if (o.notes && o.notes.includes('SUPERSEDED_BY_HUB')) return false;
      if (o.status === 'cancelled') return false;
      // Filter ghost pre-orders: is_preorder=true, payment_captured=false, no stripe_payment_intent_id
      if (o.is_preorder && !o.payment_captured && !o.stripe_payment_intent_id) return false;
      return true;
    });

    const nativeShopifyOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500).catch(error => {
      console.warn('[AdminOrders] Native ShopifyOrder unavailable, skipping native operational records:', error.message);
      return [];
    });
    const orderSyncLogs = await base44.asServiceRole.entities.OrderSyncLog.list('-created_date', 500).catch(error => {
      console.warn('[AdminOrders] OrderSyncLog unavailable, skipping native sync context:', error.message);
      return [];
    });
    const safeSyncParityLogs = adminOrderLifecycleReadModelRequested && adminOrderLifecycleReadModelActive
      ? await base44.asServiceRole.entities.SafeSyncParityLog.list('-created_date', 500).catch(error => {
          console.warn('[AdminOrders] SafeSyncParityLog unavailable, skipping parity context:', error.message);
          return [];
        })
      : [];
    const reviewQueueItems = await base44.asServiceRole.entities.OrderReviewQueue.list('-created_date', 500).catch(error => {
      console.warn('[AdminOrders] OrderReviewQueue unavailable, skipping native review context:', error.message);
      return [];
    });
    const nativeContext = buildNativeOperationalContext({
      fulfillmentTasks,
      orderSyncLogs,
      reviewQueueItems,
    });
    console.log(`[AdminOrders] Local: ${allLocalOrders.length} total, ${localOrders.length} after filtering. Cancelled order numbers: ${[...cancelledOrderNumbers].join(', ')}`);

    // 2. Fetch ALL UserProfiles to get every customer — including those whose only local
    //    record was superseded and would otherwise be invisible.
    const profiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', 500);

    // Build bidirectional auth_email <-> contact_email maps, and a name lookup map
    const authToContact = {};
    const contactToAuth = {};
    const emailToName = {};    // auth_email -> "First Last"
    const emailToPhone = {};   // auth_email -> phone
    const emailToAddress = {}; // auth_email -> address string
    for (const p of profiles) {
      if (p.customer_email) {
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
        if (name) emailToName[p.customer_email.toLowerCase()] = name;
        if (p.phone) emailToPhone[p.customer_email.toLowerCase()] = p.phone;
        if (p.address) emailToAddress[p.customer_email.toLowerCase()] = p.address;
        if (p.contact_email && p.contact_email !== p.customer_email) {
          authToContact[p.customer_email] = p.contact_email;
          contactToAuth[p.contact_email] = p.customer_email;
          // Also index by contact_email so lookups work both ways
          if (name) emailToName[p.contact_email.toLowerCase()] = name;
          if (p.phone) emailToPhone[p.contact_email.toLowerCase()] = p.phone;
          if (p.address) emailToAddress[p.contact_email.toLowerCase()] = p.address;
        }
      }
    }

    // Build cancelledCustomerEmails = emails that appear ONLY in cancelled orders (no live orders at all)
    // We suppress ALL Hub queries for these customers.
    // We add BOTH the auth email AND any contact_email alias so the Hub-query skip fires regardless
    // of which email variant we use to query the Hub.
    const cancelledCustomerEmails = new Set();
     for (const o of allLocalOrders) {
       const isCancelledOrRefunded = o.status === 'cancelled' || o.financial_status === 'refunded' || o.payment_status === 'refunded' || o.do_not_recover === true;
       if (!isCancelledOrRefunded) continue;
       const email = o.customer_email?.toLowerCase();
       if (!email || allEmailsWithLiveOrders.has(email)) continue;
       cancelledCustomerEmails.add(email);
       // Also add the contact_email alias used to query Hub
       const contactAlias = authToContact[o.customer_email]?.toLowerCase();
       if (contactAlias) cancelledCustomerEmails.add(contactAlias);
     }
    console.log(`[AdminOrders] Cancelled-only customers (suppress Hub): ${[...cancelledCustomerEmails].join(', ')} | Live order emails: ${[...allEmailsWithLiveOrders].join(', ')}`);

    // Build the set of hub query emails from surviving local orders + profiles of customers with live orders
    // Use contact_email if available (real email, not Apple relay) — never add both variants
    // EXCLUDE cancelled-only customers entirely
    const hubQueryEmails = new Set();
    for (const p of profiles) {
      if (p.customer_email) {
        const authEmail = p.customer_email.toLowerCase();
        // Skip if this customer has ONLY cancelled orders
        if (cancelledCustomerEmails.has(authEmail)) continue;
        const queryEmail = p.contact_email || p.customer_email;
        hubQueryEmails.add(queryEmail.toLowerCase().trim());
      }
    }
    // Also include emails from local orders not covered by profiles
    for (const o of localOrders) {
      if (o.customer_email) {
        const queryEmail = authToContact[o.customer_email] || o.customer_email;
        hubQueryEmails.add(queryEmail.toLowerCase().trim());
      }
    }

    // 3. Fetch Hub orders for each unique hub email
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const hubBase = hubApiUrl ? hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '') : null;

    let allHubOrders = [];

    if (hubBase && hubSecret) {
      // Fetch in batches of 5 to avoid Hub rate limiting
      const emailList = Array.from(hubQueryEmails);
      const BATCH_SIZE = 5;
      const hubStartedAt = Date.now();
      let hubFetchTruncated = false;

      const fetchOne = async (hubEmail) => {
        if (Date.now() - hubStartedAt > HUB_ORDER_TOTAL_BUDGET_MS) {
          hubFetchTruncated = true;
          return [];
        }
        // Skip entirely for customers whose only local orders are cancelled
        // Check both the hub email itself AND its resolved auth email
        const normalizedHub = hubEmail.toLowerCase();
        const resolvedAuth = (contactToAuth[normalizedHub] || normalizedHub);
        if (cancelledCustomerEmails.has(normalizedHub) || cancelledCustomerEmails.has(resolvedAuth)) {
          console.log(`[AdminOrders] Skipping Hub fetch for cancelled customer: ${hubEmail}`);
          return [];
        }
        try {
          const url = `${hubBase}/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(hubEmail)}`;
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), HUB_ORDER_FETCH_TIMEOUT_MS);
          const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${hubSecret}` },
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          if (!res.ok) {
            console.warn(`[AdminOrders] Hub fetch failed for ${hubEmail}: ${res.status}`);
            return [];
          }
          const data = await res.json();
          const rawOrders = data.orders || [];
          if (rawOrders.length === 0) return [];

          const authEmail = contactToAuth[hubEmail] || hubEmail;
          const resolveField = (hubVal, profileVal) => hubVal || profileVal || '';
          const authKey = authEmail.toLowerCase();

          const expanded = [];
          for (const order of rawOrders) {
            const hubName = order.customer_name || order.full_name || '';
            const resolvedName = resolveField(hubName, emailToName[authKey]);
            const resolvedPhone = resolveField(order.contact_phone || order.phone, emailToPhone[authKey]);
            const resolvedAddress = resolveField(order.delivery_address, emailToAddress[authKey]);
            const fulfillmentType = isPosLikeOrder(order) ? 'pickup' : (order.fulfillment_type || 'delivery');

            const fulfillments = order.fulfillments;
            const isSubscription = order.order_type === 'subscription' || order.fulfillment_mode === 'multi_delivery';

            // Only expand subscriptions. One-time orders use line_items (main product display)
            if (isSubscription && Array.isArray(fulfillments) && fulfillments.length > 0) {
              for (const f of fulfillments) {
                const baseOrderNum = (order.shopify_order_number || order.order_number || '').replace('#', '');
                const fAddress = resolveField(f.delivery_address || order.delivery_address, emailToAddress[authKey]);
                const fPhone = resolveField(f.contact_phone || order.contact_phone || order.phone, emailToPhone[authKey]);
                expanded.push({
                  id: `hub_${order.id || order.shopify_order_id}_f${f.fulfillment_number}`,
                  hub_order_id: order.id || order.shopify_order_id || null,
                  hub_fulfillment_number: f.fulfillment_number,
                  order_number: f.fulfillment_number === 1 ? baseOrderNum : `${baseOrderNum}-${f.fulfillment_number}`,
                  customer_email: authEmail,
                  customer_name: resolvedName,
                  hub_customer_email: order.customer_email || hubEmail,
                  status: mapHubStatus(f.status || order.status),
                  hub_operational_status: f.status || order.status || null,
                  hub_fulfillment_status: f.fulfillment_status || order.fulfillment_status || null,
                  production_date: f.production_date || order.production_date || null,
                  assigned_delivery_date: f.delivery_date || f.assigned_delivery_date || order.assigned_delivery_date || null,
                  selected_delivery_date: f.selected_delivery_date || f.delivery_date || order.selected_delivery_date || null,
                  requested_delivery_date: f.requested_delivery_date || f.delivery_date || order.requested_delivery_date || null,
                  delivery_window_label: f.delivery_window_label || order.delivery_window_label || null,
                  delivered_at: f.delivered_at || null,
                  delivered_by: f.delivered_by || null,
                  delivery_photo_url: f.delivery_photo_url || null,
                  delivery_drop_location: f.delivery_drop_location || null,
                  source_channel: order.source_channel || null,
                  stripe_subscription_id: order.stripe_subscription_id || null,
                  hub_updated_date: order.updated_date || null,
                  total: order.total ? parseFloat((order.total / fulfillments.length).toFixed(2)) : 0,
                  subtotal: order.subtotal === null || order.subtotal === undefined ? null : parseFloat((Number(order.subtotal) / fulfillments.length).toFixed(2)),
                  delivery_fee: order.delivery_fee === null || order.delivery_fee === undefined ? null : order.delivery_fee,
                  total_tax: order.total_tax === null || order.total_tax === undefined ? null : parseFloat((Number(order.total_tax) / fulfillments.length).toFixed(2)),
                  total_discounts: order.total_discounts === null || order.total_discounts === undefined ? null : parseFloat((Number(order.total_discounts) / fulfillments.length).toFixed(2)),
                  discount_codes: order.discount_codes || [],
                  delivery_zone_key: order.delivery_zone_key || order.delivery_zone_id || null,
                  delivery_zone_name: order.delivery_zone_name || null,
                  delivery_zone_type: order.delivery_zone_type || null,
                  minimum_order: order.minimum_order ?? null,
                  distance_miles: order.distance_miles ?? null,
                  drive_time_minutes: order.drive_time_minutes ?? null,
                  approval_status: order.approval_status || null,
                  fulfillment_type: fulfillmentType,
                  delivery_address: fAddress,
                  contact_phone: fPhone,
                  estimated_delivery_date: f.delivery_date || null,
                  created_date: f.delivery_date || order.created_date || order.updated_date || null,
                  items: f.items || order.line_items || [],
                  notes: `${order.subscription_plan || 'Subscription'} — Delivery ${f.fulfillment_number} of ${fulfillments.length}`,
                  is_hub_order: true,
                });
              }
            } else {
              const baseOrderNum = (order.shopify_order_number || order.order_number || '').replace('#', '');
              expanded.push({
                id: `hub_${order.id}`,
                hub_order_id: order.id || order.shopify_order_id || null,
                order_number: baseOrderNum,
                customer_email: authEmail,
                customer_name: resolvedName,
                hub_customer_email: order.customer_email || hubEmail,
                status: mapHubStatus(order.status),
                hub_operational_status: order.status || null,
                hub_fulfillment_status: order.fulfillment_status || null,
                production_date: order.production_date || null,
                assigned_delivery_date: order.assigned_delivery_date || null,
                selected_delivery_date: order.selected_delivery_date || null,
                requested_delivery_date: order.requested_delivery_date || null,
                delivery_window_label: order.delivery_window_label || null,
                delivered_at: order.delivered_at || null,
                delivered_by: order.delivered_by || null,
                delivery_photo_url: order.delivery_photo_url || null,
                delivery_drop_location: order.delivery_drop_location || null,
                source_channel: order.source_channel || null,
                stripe_subscription_id: order.stripe_subscription_id || null,
                hub_updated_date: order.updated_date || null,
                total: order.total || 0,
                subtotal: order.subtotal ?? null,
                delivery_fee: order.delivery_fee ?? null,
                total_tax: order.total_tax ?? null,
                total_discounts: order.total_discounts ?? null,
                discount_codes: order.discount_codes || [],
                delivery_zone_key: order.delivery_zone_key || order.delivery_zone_id || null,
                delivery_zone_name: order.delivery_zone_name || null,
                delivery_zone_type: order.delivery_zone_type || null,
                minimum_order: order.minimum_order ?? null,
                distance_miles: order.distance_miles ?? null,
                drive_time_minutes: order.drive_time_minutes ?? null,
                approval_status: order.approval_status || null,
                fulfillment_type: fulfillmentType,
                delivery_address: resolvedAddress,
                contact_phone: resolvedPhone,
                estimated_delivery_date: order.estimated_delivery_date || null,
                created_date: order.created_date || order.updated_date || null,
                items: order.line_items || order.items || [],
                notes: order.notes || null,
                is_hub_order: true,
              });
            }
          }
          return expanded;
        } catch (err) {
          if (err?.name === 'AbortError') {
            console.warn(`[AdminOrders] Hub fetch timed out for ${hubEmail}`);
          } else {
            console.warn(`[AdminOrders] Hub error for ${hubEmail}: ${err.message}`);
          }
          return [];
        }
      };

      // Process in batches of 5 to avoid Hub rate limiting
      for (let i = 0; i < emailList.length; i += BATCH_SIZE) {
        if (Date.now() - hubStartedAt > HUB_ORDER_TOTAL_BUDGET_MS) {
          hubFetchTruncated = true;
          console.warn(`[AdminOrders] Hub fetch budget exceeded after ${i} of ${emailList.length} customer lookups`);
          break;
        }
        const batch = emailList.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(batch.map(fetchOne));
        allHubOrders.push(...batchResults.flat());
      }
      if (hubFetchTruncated) {
        console.warn('[AdminOrders] Returning partial Hub expansion so admin page remains usable');
      }
      console.log(`[AdminOrders] Hub returned ${allHubOrders.length} expanded orders across ${hubQueryEmails.size} customers`);
    }

    // Filter out cancelled hub orders AND hub orders whose order_number is locally cancelled
    const filteredHubOrders = allHubOrders.filter(o => {
      if (o.status === 'cancelled') return false;
      const normNum = normalizeOrderNum(o.order_number);
      if (normNum && cancelledOrderNumbers.has(normNum)) return false;
      return true;
    });
    console.log(`[AdminOrders] After cancel filter: ${filteredHubOrders.length} hub orders (removed ${allHubOrders.length - filteredHubOrders.length} cancelled)`);

    // 3b. Expand local subscription orders that reference FulfillmentTasks
    const expandedLocalOrders = [];
    for (const order of localOrders) {
      const tasksForOrder = fulfillmentTasks.filter(t => t.order_id === order.id);
      
      if (tasksForOrder.length > 0) {
        // Subscription order — expand each fulfillment task into a display record
        for (const task of tasksForOrder) {
          expandedLocalOrders.push({
            id: task.id,
            order_number: order.order_number + (tasksForOrder.length > 1 ? `-${task.fulfillment_number || 1}` : ''),
            customer_email: order.customer_email,
            customer_name: order.customer_name || '',
            status: order.status,
            total: order.total ? order.total / tasksForOrder.length : 0,
            subtotal: order.subtotal === null || order.subtotal === undefined ? null : order.subtotal / tasksForOrder.length,
            delivery_fee: order.delivery_fee ?? null,
            total_tax: order.total_tax === null || order.total_tax === undefined ? null : order.total_tax / tasksForOrder.length,
            total_discounts: order.total_discounts === null || order.total_discounts === undefined ? null : order.total_discounts / tasksForOrder.length,
            fulfillment_type: order.fulfillment_type || 'delivery',
            delivery_address: order.delivery_address || '',
            contact_phone: order.contact_phone || '',
            estimated_delivery_date: task.delivery_date || order.estimated_delivery_date || null,
            assigned_delivery_date: task.delivery_date || order.assigned_delivery_date || null,
            selected_delivery_date: order.selected_delivery_date || null,
            requested_delivery_date: order.requested_delivery_date || null,
            delivery_window_label: task.delivery_window_label || order.delivery_window_label || null,
            final_schedule_source: order.final_schedule_source || null,
            scheduling_reason: order.scheduling_reason || null,
            created_date: order.created_date || null,
            items: task.items || order.items || [],
            notes: order.notes || '',
            is_local_fulfillment_expansion: true,
          });
        }
      } else {
        expandedLocalOrders.push(order);
      }
    }

    const nativeAdminOrders = nativeShopifyOrders
      .map(order => mapNativeShopifyOrderToAdminOrder(order, nativeContext))
      .filter(Boolean);
    const nativeOrderIndexes = buildNativeOrderIndexes(nativeAdminOrders);
    const customerAppOrderIndexes = buildCustomerAppOrderIndexes(expandedLocalOrders);

    const withMergedContext = (order) => mergeAdminOperationalContext({
      order,
      nativeOrderIndexes,
      customerAppOrderIndexes,
      syncContext: nativeContext,
    });

    // 4. Merge: Hub remains the primary operational row when present, but same-order
    // Customer App + native May 30 context is attached to that row instead of hidden.
    // Normalize order numbers for comparison: strip leading #, lowercase, trim
    const mergedMap = new Map();

    // Seed with Hub orders first — deduplicate Hub side too (same order fetched via contact+auth email)
    for (const order of filteredHubOrders) {
      const key = normalizeOrderNum(order.order_number);
      if (!key) continue;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, withMergedContext(order));
      }
    }

    // Native May 30 operational records are visible in Customer App admin even while
    // Hub remains the operational fallback. When Hub already has the same order, its row
    // was enriched above; otherwise render the native row directly.
    for (const order of nativeAdminOrders) {
      const key = normalizeOrderNum(order.order_number);
      if (!key) continue;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, withMergedContext(order));
      }
    }

    // Local orders fill in only where Hub has no record
    for (const order of expandedLocalOrders) {
      const key = normalizeOrderNum(order.order_number);
      if (!key) continue; // skip orders with no order_number entirely
      const hubHasIt = mergedMap.has(key) && mergedMap.get(key).is_hub_order;
      if (!hubHasIt) {
        mergedMap.set(key, withMergedContext(order));
      }
    }

    const merged = Array.from(mergedMap.values())
      .map((order) => {
        const decoratedOrder = decorateAdminOrderDiagnostics(order);
        const nativeCandidate = nativeCandidateForAdminRow(decoratedOrder, nativeOrderIndexes);
        const eligibility = evaluateAdminOrderLimitedNativePrimaryEligibility(decoratedOrder, nativeCandidate);

        if (!eligibility.eligible || !nativeCandidate) {
          return applyLimitedNativePrimaryMetadata(decoratedOrder, eligibility);
        }

        const nativePrimaryBase = withMergedContext(nativeCandidate);
        const nativePrimaryWithFallback = retainHubFallbackContextForNativePrimary(nativePrimaryBase, decoratedOrder);
        const decoratedNativePrimary = decorateAdminOrderDiagnostics(nativePrimaryWithFallback);

        return applyLimitedNativePrimaryMetadata(decoratedNativePrimary, eligibility);
      })
      .sort((a, b) => {
      const aDate = new Date(a.created_date || 0);
      const bDate = new Date(b.created_date || 0);
      return bDate - aDate;
    });
    const diagnostics = buildAdminOrderDiagnostics({
      mergedOrders: merged,
      filteredHubOrders,
      nativeAdminOrders,
      fulfillmentTasks,
      localOrders,
    });
    const adminOrderLifecycleReadModel = adminOrderLifecycleReadModelRequested && adminOrderLifecycleReadModelActive
      ? buildAdminOrderLifecycleReadModel({
          currentOrders: merged,
          customerOrders: expandedLocalOrders,
          nativeOrders: nativeShopifyOrders,
          fulfillmentTasks,
          hubOrders: filteredHubOrders,
          reviewRows: reviewQueueItems,
          orderSyncLogs,
          safeSyncParityLogs,
          filters: body || {},
        })
      : null;

    console.log(`[AdminOrders] Final: ${merged.length} orders (${expandedLocalOrders.length} local expanded including fulfillments, ${filteredHubOrders.length} hub expanded)`);

    if (adminOrderLifecycleReadModelRequested && adminOrderLifecycleReadModelActive) {
      return Response.json(buildAdminOrderLifecycleCompactResponse({
        enabled: true,
        readModel: adminOrderLifecycleReadModel,
      }));
    }

    if (adminOrderListCompactRequested) {
      return Response.json(buildAdminOrderListCompactResponse({
        merged,
        localOrders,
        allLocalOrders,
        allHubOrders,
        nativeShopifyOrders,
        fulfillmentTasks,
        diagnostics,
      }));
    }

    return Response.json({
      success: true,
      total: merged.length,
      local_count: localOrders.length,
      hub_count: allHubOrders.length,
      native_shopify_order_count: nativeShopifyOrders.length,
      orders: merged,
      ...diagnostics,
      admin_order_lifecycle_read_model_available: true,
      admin_order_lifecycle_read_model_enabled: Boolean(adminOrderLifecycleReadModelRequested && adminOrderLifecycleReadModelActive),
      admin_order_lifecycle_read_model_version: ADMIN_ORDER_LIFECYCLE_READ_MODEL_VERSION,
      ...(adminOrderLifecycleReadModel ? { admin_order_lifecycle_read_model: adminOrderLifecycleReadModel } : {}),
      order_write_ready: false,
      payment_write_ready: false,
      refund_write_ready: false,
      fulfillment_write_ready: false,
      delivery_write_ready: false,
      notification_expansion_ready: false,
      hub_write_suppression_ready: false,
      repair_replay_ready: false,
    });
  } catch (error) {
    console.error('[AdminOrders] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function mapHubStatus(hubStatus) {
  const map = {
    new: 'order_received',
    awaiting_production: 'scheduled_for_juicing',
    in_production: 'in_production',
    bottled: 'bottled_packed',
    labeled: 'bottled_packed',
    qc_checked: 'bottled_packed',
    packed: 'bottled_packed',
    in_cold_storage: 'bottled_packed',
    assigned_for_pickup: 'ready_for_pickup',
    assigned_for_delivery: 'out_for_delivery',
    fulfilled: 'delivered',
    canceled: 'cancelled', // explicit cancelled status — filtered out below
    cancelled: 'cancelled',
    refunded: 'cancelled',
    pending: 'scheduled_for_juicing',
    production_scheduled: 'scheduled_for_juicing',
    // pass-through valid customer app statuses
    order_received: 'order_received',
    scheduled_for_juicing: 'scheduled_for_juicing',
    bottled_packed: 'bottled_packed',
    out_for_delivery: 'out_for_delivery',
    arriving_soon: 'arriving_soon',
    delivered: 'delivered',
    ready_for_pickup: 'ready_for_pickup',
    picked_up: 'picked_up',
  };
  return map[hubStatus] || 'order_received';
}

function buildNativeOperationalContext({ fulfillmentTasks, orderSyncLogs, reviewQueueItems }) {
  const taskByOrderId = new Map();
  const taskByShopifyOrderId = new Map();
  const taskByOrderNumber = new Map();
  const nativeSyncByOrderNumber = new Map();
  const nativeSyncByOrderId = new Map();
  const hubSyncByOrderNumber = new Map();
  const hubSyncByOrderId = new Map();
  const reviewByOrderNumber = new Map();
  const reviewByOrderId = new Map();

  const addTaskIndex = (index, key, task) => {
    const normalizedKey = (key || '').toString();
    if (!normalizedKey) return;
    const existing = index.get(normalizedKey) || [];
    existing.push(task);
    index.set(normalizedKey, existing);
  };

  for (const task of Array.isArray(fulfillmentTasks) ? fulfillmentTasks : []) {
    addTaskIndex(taskByOrderId, task.order_id, task);
    addTaskIndex(taskByShopifyOrderId, task.shopify_order_id, task);
    addTaskIndex(taskByOrderNumber, normalizeOrderNum(task.shopify_order_number || task.order_number), task);
  }

  for (const log of Array.isArray(orderSyncLogs) ? orderSyncLogs : []) {
    const orderNumber = normalizeOrderNum(log.order_number);
    const orderId = (log.order_id || '').toString();
    const summary = {
      status: log.status || null,
      action: log.action || log.hub_action || null,
      source: log.sync_source || log.triggered_by || null,
      event_type: log.event_type || null,
      reason: log.reason || log.error_code || null,
      hub_order_id: log.hub_order_id || null,
      timestamp: log.sync_timestamp || log.completed_at || log.created_date || null,
    };
    const isNativeSync = normalizeLower(log.sync_source).includes('native') ||
      normalizeLower(log.sync_source).includes('may30') ||
      normalizeLower(log.action).includes('native');
    const isHubSync = Boolean(log.hub_order_id || log.hub_action) ||
      normalizeLower(log.triggered_by).includes('hub') ||
      normalizeLower(log.sync_source).includes('hub');

    if (isNativeSync) {
      if (orderNumber && !nativeSyncByOrderNumber.has(orderNumber)) nativeSyncByOrderNumber.set(orderNumber, summary);
      if (orderId && !nativeSyncByOrderId.has(orderId)) nativeSyncByOrderId.set(orderId, summary);
    }
    if (isHubSync) {
      if (orderNumber && !hubSyncByOrderNumber.has(orderNumber)) hubSyncByOrderNumber.set(orderNumber, summary);
      if (orderId && !hubSyncByOrderId.has(orderId)) hubSyncByOrderId.set(orderId, summary);
    }
  }

  for (const item of Array.isArray(reviewQueueItems) ? reviewQueueItems : []) {
    if (item.status === 'resolved' || item.status === 'archived') continue;
    const payload = item.incoming_payload && typeof item.incoming_payload === 'object' ? item.incoming_payload : {};
    const orderNumber = normalizeOrderNum(item.existing_order_number || payload.order_number);
    const orderId = (item.existing_order_id || payload.order_id || '').toString();
    const summary = {
      status: item.status || null,
      incident_type: item.incident_type || null,
      issue_description: item.issue_description || null,
      recommended_action: item.recommended_action || null,
      occurrence_count: item.occurrence_count || null,
      last_seen_at: item.last_seen_at || item.created_date || null,
    };
    if (orderNumber && !reviewByOrderNumber.has(orderNumber)) reviewByOrderNumber.set(orderNumber, summary);
    if (orderId && !reviewByOrderId.has(orderId)) reviewByOrderId.set(orderId, summary);
  }

  const taskSummary = (tasks) => {
    const statusCounts = {};
    let nextDeliveryDate = null;
    let productionDate = null;
    const missingMetadataFields = new Set();

    for (const task of tasks) {
      const status = task.status || 'unknown';
      statusCounts[status] = (statusCounts[status] || 0) + 1;
      const candidateDeliveryDate = task.delivery_date || task.scheduled_date || task.assigned_delivery_date || null;
      if (candidateDeliveryDate && (!nextDeliveryDate || candidateDeliveryDate < nextDeliveryDate)) {
        nextDeliveryDate = candidateDeliveryDate;
      }
      if (!productionDate && task.production_date) productionDate = task.production_date;

      if (!task.shopify_order_number && !task.order_number) missingMetadataFields.add('shopify_order_number');
      if (!task.source_type) missingMetadataFields.add('source_type');
      if (!task.schedule_source && !task.task_source) missingMetadataFields.add('schedule_source');
      if (!task.production_date) missingMetadataFields.add('production_date');
    }

    return {
      count: tasks.length,
      status_counts: statusCounts,
      next_delivery_date: nextDeliveryDate,
      production_date: productionDate,
      task_ids: tasks.slice(0, 5).map(task => task.id).filter(Boolean),
      tasks: tasks.slice(0, 5).map(task => ({
        id: task.id || null,
        order_id: task.order_id || null,
        shopify_order_id: task.shopify_order_id || null,
        shopify_order_number: task.shopify_order_number || task.order_number || null,
        status: task.status || null,
        delivery_status: task.delivery_status || null,
        delivery_date: task.delivery_date || task.scheduled_date || task.assigned_delivery_date || null,
        production_date: task.production_date || null,
        source_channel: task.source_channel || null,
        source_type: task.source_type || null,
        schedule_source: task.schedule_source || task.task_source || null,
        fulfillment_type: task.fulfillment_type || null,
        fulfillment_number: task.fulfillment_number || null,
        delivery_window_label: task.delivery_window_label || task.time_window || null,
      })),
      incomplete_display_metadata: tasks.length > 0 && missingMetadataFields.size > 0,
      missing_metadata_fields: Array.from(missingMetadataFields),
    };
  };

  const tasksFor = ({ orderNumber, orderId, shopifyOrderId }) => {
    const combined = [
      ...(taskByOrderId.get((orderId || '').toString()) || []),
      ...(taskByShopifyOrderId.get((shopifyOrderId || '').toString()) || []),
      ...(taskByOrderNumber.get(normalizeOrderNum(orderNumber)) || []),
    ];
    const seen = new Set();
    return combined.filter(task => {
      const key = task.id || `${task.order_id || ''}:${task.shopify_order_number || task.order_number || ''}:${task.delivery_date || task.scheduled_date || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const latestNativeSyncFor = ({ orderNumber, orderId }) => (
    nativeSyncByOrderId.get((orderId || '').toString()) || nativeSyncByOrderNumber.get(normalizeOrderNum(orderNumber)) || null
  );
  const latestHubSyncFor = ({ orderNumber, orderId }) => (
    hubSyncByOrderId.get((orderId || '').toString()) || hubSyncByOrderNumber.get(normalizeOrderNum(orderNumber)) || null
  );

  return {
    taskSummaryFor(orderId) {
      return taskSummary(tasksFor({ orderId }));
    },
    taskSummaryForOrder({ orderNumber, orderId, shopifyOrderId }) {
      return taskSummary(tasksFor({ orderNumber, orderId, shopifyOrderId }));
    },
    latestNativeSyncFor,
    latestHubSyncFor,
    latestSyncFor({ orderNumber, orderId }) {
      return latestNativeSyncFor({ orderNumber, orderId }) || latestHubSyncFor({ orderNumber, orderId });
    },
    reviewFor({ orderNumber, orderId }) {
      return reviewByOrderId.get((orderId || '').toString()) || reviewByOrderNumber.get(normalizeOrderNum(orderNumber)) || null;
    },
  };
}

function buildNativeOrderIndexes(nativeAdminOrders) {
  const byOrderNumber = new Map();
  const byCustomerAppOrderId = new Map();
  const byNativeOrderId = new Map();

  for (const order of Array.isArray(nativeAdminOrders) ? nativeAdminOrders : []) {
    addIndexValue(byOrderNumber, order.native_order_number || order.order_number, order);
    if (order.native_base44_order_id && !byCustomerAppOrderId.has(order.native_base44_order_id)) {
      byCustomerAppOrderId.set(order.native_base44_order_id, order);
    }
    if (order.native_shopify_order_id && !byNativeOrderId.has(order.native_shopify_order_id)) {
      byNativeOrderId.set(order.native_shopify_order_id, order);
    }
  }

  return { byOrderNumber, byCustomerAppOrderId, byNativeOrderId };
}

function summarizeCustomerAppOrder(order) {
  if (!order) return null;
  return {
    id: order.id || null,
    order_number: order.order_number || null,
    status: order.status || null,
    payment_status: order.payment_status || order.financial_status || null,
    payment_captured: order.payment_captured === true,
    fulfillment_type: order.fulfillment_type || null,
    estimated_delivery_date: order.estimated_delivery_date || null,
    line_item_count: Array.isArray(order.items) ? order.items.length : (Array.isArray(order.line_items) ? order.line_items.length : null),
  };
}

function buildCustomerAppOrderIndexes(orders) {
  const byOrderNumber = new Map();
  const byId = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    const summary = summarizeCustomerAppOrder(order);
    if (!summary) continue;
    addIndexValue(byOrderNumber, order.order_number, summary);
    if (order.id && !byId.has(order.id)) byId.set(order.id, summary);
  }

  return { byOrderNumber, byId };
}

function copyNativeContextFields(target, nativeOrder, syncContext) {
  if (!nativeOrder) return target;

  const taskSummary = syncContext?.taskSummaryForOrder({
    orderNumber: nativeOrder.native_order_number || nativeOrder.order_number,
    orderId: nativeOrder.native_shopify_order_id,
    shopifyOrderId: nativeOrder.native_shopify_order_id,
  }) || nativeOrder.native_fulfillment_task_summary || {
    count: 0,
    status_counts: {},
    next_delivery_date: null,
    production_date: null,
    task_ids: [],
    tasks: [],
    incomplete_display_metadata: false,
    missing_metadata_fields: [],
  };

  const latestNativeSyncLog = syncContext?.latestNativeSyncFor({
    orderNumber: nativeOrder.native_order_number || nativeOrder.order_number,
    orderId: nativeOrder.native_shopify_order_id,
  }) || nativeOrder.native_latest_sync_log || null;
  const reviewSummary = syncContext?.reviewFor({
    orderNumber: nativeOrder.native_order_number || nativeOrder.order_number,
    orderId: nativeOrder.native_shopify_order_id,
  }) || nativeOrder.native_review_queue_summary || null;

  return {
    ...target,
    has_native_order: true,
    native_shopify_order_id: nativeOrder.native_shopify_order_id || null,
    native_base44_order_id: nativeOrder.native_base44_order_id || null,
    native_order_number: nativeOrder.native_order_number || nativeOrder.order_number || null,
    native_payment_status: nativeOrder.native_payment_status || nativeOrder.payment_status || null,
    native_production_status: nativeOrder.native_production_status || null,
    native_fulfillment_status: nativeOrder.native_fulfillment_status || null,
    native_sync_status: nativeOrder.native_sync_status || null,
    native_review_status: nativeOrder.native_review_status || null,
    native_source_channel: nativeOrder.native_source_channel || nativeOrder.source_channel || null,
    native_source_type: nativeOrder.native_source_type || nativeOrder.source_type || null,
    native_order_type: nativeOrder.native_order_type || nativeOrder.order_type || null,
    native_order_lock_status: nativeOrder.native_order_lock_status || nativeOrder.order_lock_status || null,
    native_line_item_count: nativeOrder.native_line_item_count ?? (Array.isArray(nativeOrder.items) ? nativeOrder.items.length : null),
    native_total: nativeOrder.native_total ?? nativeOrder.total ?? null,
    native_fulfillment_task_summary: taskSummary,
    has_native_task: taskSummary.count > 0,
    native_task_incomplete_metadata: taskSummary.incomplete_display_metadata,
    native_task_missing_metadata_fields: taskSummary.missing_metadata_fields || [],
    native_latest_sync_log: latestNativeSyncLog,
    native_review_queue_summary: reviewSummary,
  };
}

function attachCustomerAppContext(target, customerAppOrder) {
  if (!customerAppOrder) return target;
  return {
    ...target,
    has_customer_app_order: true,
    customer_app_order_id: customerAppOrder.id || null,
    customer_app_order_status: customerAppOrder.status || null,
    customer_app_payment_status: customerAppOrder.payment_status || null,
    customer_app_payment_captured: customerAppOrder.payment_captured === true,
    customer_app_fulfillment_type: customerAppOrder.fulfillment_type || null,
    customer_app_estimated_delivery_date: customerAppOrder.estimated_delivery_date || null,
    customer_app_line_item_count: customerAppOrder.line_item_count ?? null,
  };
}

function buildOperationalContextGuidance(order) {
  const guidance = [];
  const paid = isPaidOrder(order);

  if (order.has_native_order && order.is_hub_order) {
    guidance.push({
      tone: 'native',
      label: 'Native mirror + Hub fallback active',
      detail: 'Native Customer App operations context is visible while Hub remains the bridge fallback.',
    });
  }

  if (order.has_customer_app_order && paid && !order.has_native_order) {
    guidance.push({
      tone: 'warning',
      label: 'Native ops mirror missing',
      detail: 'Monitor this paid app order or use an explicitly approved processing path; this page does not run native processing.',
    });
  }

  if (order.has_customer_app_order && paid && !order.is_hub_order && !order.has_native_order) {
    guidance.push({
      tone: 'warning',
      label: 'Hub sync missing',
      detail: 'Monitor the Hub bridge or use an explicitly approved resend path; this page does not run sync or repair.',
    });
  }

  if (isPendingPaymentOrder(order) || (hasPaymentSignal(order) && !paid)) {
    guidance.push({
      tone: 'warning',
      label: 'Do not fulfill until paid',
      detail: 'Payment is not confirmed for fulfillment decisions.',
    });
  }

  if (order.native_task_incomplete_metadata) {
    guidance.push({
      tone: 'warning',
      label: 'Native task exists but has incomplete display metadata.',
      detail: 'This is a read-only warning; no backfill is performed from Admin Orders.',
    });
  }

  return guidance;
}

function buildAdminContextBadges(order) {
  const badges = [];

  if (order.has_customer_app_order || (!order.is_hub_order && !order.has_native_order)) badges.push('Customer App Order');
  if (order.has_native_order) badges.push('Native Ops Mirror');
  if (order.has_native_task || order.native_fulfillment_task_summary?.count > 0) badges.push('Native Task');
  if (order.is_hub_order) badges.push('Hub Synced');
  if (order.is_hub_order && order.has_native_order) badges.push('Hub Fallback');
  if (order.native_review_queue_summary || ['review', 'review_required', 'queued_for_review', 'rejected', 'incomplete'].includes(normalizeLower(order.native_review_status))) {
    badges.push('Needs Review');
  }
  if (isPendingPaymentOrder(order) || (hasPaymentSignal(order) && !isPaidOrder(order))) {
    badges.push('Payment Pending');
  } else if (isPaidOrder(order)) {
    badges.push('Paid');
  }
  if (isPosLikeOrder(order)) {
    badges.push('POS/Event');
  } else if (order.fulfillment_type === 'delivery' || order.customer_app_fulfillment_type === 'delivery') {
    badges.push('Delivery');
  }

  return uniqueValues(badges);
}

function mergeAdminOperationalContext({ order, nativeOrderIndexes, customerAppOrderIndexes, syncContext }) {
  if (!order) return order;

  const orderNumberKey = normalizeOrderNum(order.order_number);
  let merged = { ...order };

  const customerAppOrder =
    customerAppOrderIndexes.byId.get(order.id) ||
    customerAppOrderIndexes.byId.get(order.native_base44_order_id) ||
    customerAppOrderIndexes.byOrderNumber.get(orderNumberKey);

  merged = attachCustomerAppContext(merged, customerAppOrder);

  const nativeOrder =
    nativeOrderIndexes.byNativeOrderId.get(order.native_shopify_order_id) ||
    nativeOrderIndexes.byCustomerAppOrderId.get(merged.customer_app_order_id) ||
    nativeOrderIndexes.byOrderNumber.get(orderNumberKey);

  merged = copyNativeContextFields(merged, nativeOrder, syncContext);

  merged.hub_sync_summary = syncContext?.latestHubSyncFor({
    orderNumber: merged.order_number,
    orderId: merged.hub_order_id || merged.customer_app_order_id,
  }) || null;

  merged = attachEffectiveAdminOperationalStatuses(merged);

  merged.admin_context_guidance = buildOperationalContextGuidance(merged);
  merged.admin_context_badges = buildAdminContextBadges(merged);

  return merged;
}

function nativeFulfillmentDate(order) {
  const firstFulfillment = Array.isArray(order?.fulfillments)
    ? order.fulfillments.find(fulfillment => (
        fulfillment?.delivery_date ||
        fulfillment?.assigned_delivery_date ||
        fulfillment?.selected_delivery_date ||
        fulfillment?.requested_delivery_date ||
        fulfillment?.scheduled_date
      ))
    : null;
  return firstFulfillment?.delivery_date ||
    firstFulfillment?.assigned_delivery_date ||
    firstFulfillment?.selected_delivery_date ||
    firstFulfillment?.requested_delivery_date ||
    firstFulfillment?.scheduled_date ||
    order?.first_fulfillment?.delivery_date ||
    order?.first_fulfillment?.assigned_delivery_date ||
    order?.first_fulfillment?.selected_delivery_date ||
    order?.first_fulfillment?.requested_delivery_date ||
    null;
}

function mapNativeShopifyOrderToAdminOrder(order, nativeContext = null) {
  const orderNumber = (order?.shopify_order_number || order?.order_number || '').toString().replace(/^#/, '');
  if (!order || !orderNumber) return null;
  if (order.is_subscription === true || order.order_type === 'subscription' || order.source_channel === 'subscription') return null;

  const fulfillmentMethod = order.fulfillment_method || (order.source_channel === 'pos' ? 'pos' : 'delivery');
  const isPos = order.source_channel === 'pos' || order.order_type === 'pos' || fulfillmentMethod === 'pos' || order.is_pos_order === true;
  const mappedStatus = isPos
    ? 'picked_up'
    : mapHubStatus(order.production_status || order.order_status || order.fulfillment_status || 'order_received');
  const items = Array.isArray(order.line_items) ? order.line_items : [];
  const nativeTaskSummary = nativeContext?.taskSummaryFor(order.id) || {
    count: 0,
    status_counts: {},
    next_delivery_date: null,
    production_date: null,
    task_ids: [],
    tasks: [],
    incomplete_display_metadata: false,
    missing_metadata_fields: [],
  };
  const nativeLatestSyncLog = nativeContext?.latestNativeSyncFor({
    orderNumber,
    orderId: order.id,
  }) || null;
  const nativeReviewQueueSummary = nativeContext?.reviewFor({
    orderNumber,
    orderId: order.id,
  }) || null;

  return {
    id: `native_${order.id}`,
    has_native_order: true,
    native_shopify_order_id: order.id,
    native_base44_order_id: order.base44_order_id || null,
    native_order_number: orderNumber,
    native_payment_status: order.payment_status || order.financial_status || null,
    native_source_channel: order.source_channel || null,
    native_source_type: order.source_type || null,
    native_order_type: order.order_type || null,
    native_order_lock_status: order.order_lock_status || null,
    native_line_item_count: items.length,
    native_total: Number(order.total_price || 0),
    order_number: orderNumber,
    customer_email: order.customer_email || '',
    customer_name: order.customer_name || '',
    status: mappedStatus,
    operational_order_status: order.order_status || null,
    native_production_status: order.production_status || null,
    native_fulfillment_status: order.fulfillment_status || null,
    native_sync_status: order.sync_status || null,
    native_review_status: order.data_quality_status || null,
    native_fulfillment_task_summary: nativeTaskSummary,
    has_native_task: nativeTaskSummary.count > 0,
    native_task_incomplete_metadata: nativeTaskSummary.incomplete_display_metadata,
    native_task_missing_metadata_fields: nativeTaskSummary.missing_metadata_fields || [],
    native_latest_sync_log: nativeLatestSyncLog,
    native_review_queue_summary: nativeReviewQueueSummary,
    payment_status: order.payment_status || order.financial_status || null,
    source_channel: order.source_channel || null,
    source_type: order.source_type || null,
    order_type: order.order_type || null,
    order_lock_status: order.order_lock_status || null,
    total: Number(order.total_price || 0),
    subtotal: compactNumber(order.subtotal),
    total_tax: compactNumber(order.total_tax),
    total_discounts: compactNumber(order.total_discounts),
    discount_codes: Array.isArray(order.discount_codes) ? order.discount_codes : [],
    delivery_fee: compactNumber(order.delivery_fee),
    selected_delivery_date: order.selected_delivery_date || null,
    requested_delivery_date: order.requested_delivery_date || null,
    delivery_zone_key: order.delivery_zone_key || order.delivery_zone_id || null,
    delivery_zone_name: order.delivery_zone_name || null,
    delivery_zone_type: order.delivery_zone_type || null,
    minimum_order: order.minimum_order ?? null,
    distance_miles: order.distance_miles ?? null,
    drive_time_minutes: order.drive_time_minutes ?? null,
    approval_status: order.approval_status || null,
    approved_delivery_fee: order.approved_delivery_fee ?? null,
    final_schedule_source: order.final_schedule_source || null,
    scheduling_reason: order.scheduling_reason || null,
    fulfillment_type: isPos ? 'pickup' : (fulfillmentMethod === 'pickup' ? 'pickup' : 'delivery'),
    delivery_address: order.delivery_address || [order.address_line1, order.address_city, order.address_state, order.address_postal_code].filter(Boolean).join(', '),
    contact_phone: order.customer_phone || '',
    estimated_delivery_date: order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date || nativeFulfillmentDate(order) || null,
    created_date: order.customer_order_date || order.created_date || order.last_sync_at || null,
    items,
    notes: order.internal_notes || order.customer_notes || null,
    is_native_order: true,
  };
}
