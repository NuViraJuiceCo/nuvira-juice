import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
const MAX_TASK_SUMMARY = 5;
const MAX_BLOCKERS = 20;
const MAX_SUBSYSTEM_SUMMARY = 12;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '');
}

function parseCsv(value) {
  return normalizeText(value).split(',').map(item => normalizeText(item)).filter(Boolean);
}

function countCsv(value) {
  return parseCsv(value).length;
}

function envEnabled(name) {
  return Deno.env.get(name) === 'true';
}

function guardedWriteGate({
  enabledFlag,
  killSwitchFlag,
  allowlistFlag,
  actorAllowlistFlag,
  actionAllowlistFlag,
  broadModeKey = 'broad_real_order_mode',
}) {
  const allowlistCount = countCsv(Deno.env.get(allowlistFlag));
  const gate = {
    enabled: envEnabled(enabledFlag),
    kill_switch: envEnabled(killSwitchFlag),
    allowlist_count: allowlistCount,
    actor_allowlist_count: countCsv(Deno.env.get(actorAllowlistFlag)),
  };
  if (actionAllowlistFlag) gate.action_allowlist_count = countCsv(Deno.env.get(actionAllowlistFlag));
  gate[broadModeKey] = gate.enabled && allowlistCount === 0;
  return gate;
}

function safeLimit(value) {
  const parsed = Number(value || DEFAULT_LIMIT);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function compactObject(value) {
  const out = {};
  for (const [key, item] of Object.entries(value || {})) {
    if (item !== undefined && item !== null && item !== '') out[key] = item;
  }
  return out;
}

function sanitizeText(value, maxLength = 180) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted provider id]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted shopify id]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function getPreviewInternalSecret() {
  return Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET') ||
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET') ||
    Deno.env.get('HUB_SYNC_SECRET') ||
    '';
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const body = JSON.parse(raw);
    return body && typeof body === 'object' && !Array.isArray(body)
      ? { ok: true, body }
      : { ok: false, body: null };
  } catch {
    return { ok: false, body: null };
  }
}

function unauthorized() {
  return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized', writes_performed: false }, { status: 401 });
}

function forbidden() {
  return Response.json({ success: false, error_code: 'forbidden', message: 'Admin access required', writes_performed: false }, { status: 403 });
}

async function requirePreviewAccess({ base44, req, body }) {
  const bodySecret = normalizeText(body?.internal_secret || body?._internal_secret);
  const headerSecret = normalizeText(req.headers.get('x-internal-secret'));
  const expectedSecret = getPreviewInternalSecret();
  const providedSecret = headerSecret || bodySecret;

  if (providedSecret) {
    return expectedSecret && providedSecret === expectedSecret
      ? { ok: true, actor_type: 'system', actor_role: 'service', actor_email: 'system' }
      : { ok: false, response: unauthorized() };
  }

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: unauthorized() };
    if (user.role !== 'admin') return { ok: false, response: forbidden() };
    return { ok: true, actor_type: 'admin', actor_role: 'admin', actor_email: user.email || 'admin' };
  } catch {
    return { ok: false, response: unauthorized() };
  }
}

function getLookup(body) {
  return {
    orderId: normalizeText(body?.order_id || body?.customer_app_order_id || body?.base44_order_id),
    nativeOrderId: normalizeText(body?.native_order_id || body?.native_shopify_order_id || body?.shopify_order_record_id || body?.shopify_order_id),
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number || body?.order || body?.number),
  };
}

function paymentStatus(order) {
  const status = normalizeLower(order?.payment_status || order?.financial_status);
  if (status) return status;
  return order?.payment_captured === true ? 'paid' : 'pending';
}

function fulfillmentMethod(order) {
  return normalizeLower(order?.fulfillment_type || order?.fulfillment_method) || 'delivery';
}

function lineItemCount(order) {
  const items = Array.isArray(order?.items) ? order.items : order?.line_items;
  return Array.isArray(items) ? items.filter(item => safeNumber(item?.quantity, 0) > 0).length : 0;
}

function hasCompleteDeliveryAddress(order) {
  if (fulfillmentMethod(order) !== 'delivery') return true;
  const deliveryAddress = typeof order?.delivery_address === 'object' && order.delivery_address !== null
    ? order.delivery_address
    : {};
  return Boolean(
    normalizeText(order?.address_line1 || deliveryAddress.address_line1 || deliveryAddress.address1 || order?.delivery_address) &&
    normalizeText(order?.address_city || deliveryAddress.city) &&
    normalizeText(order?.address_state || deliveryAddress.state || deliveryAddress.province) &&
    normalizeText(order?.address_postal_code || deliveryAddress.postal_code || deliveryAddress.zip)
  );
}

function taskHasDisplayMetadata(task) {
  return Boolean(
    normalizeText(task?.shopify_order_number || task?.order_number) &&
    normalizeText(task?.source_type) &&
    normalizeText(task?.schedule_source) &&
    normalizeText(task?.production_date)
  );
}

function summarizeTask(task) {
  return {
    id: task?.id || null,
    status: sanitizeText(task?.status, 80),
    delivery_status: sanitizeText(task?.delivery_status, 80),
    delivery_date: sanitizeText(task?.delivery_date || task?.assigned_delivery_date, 40),
    production_date: sanitizeText(task?.production_date, 40),
    shopify_order_number: sanitizeText(task?.shopify_order_number || task?.order_number, 120),
    source_type: sanitizeText(task?.source_type, 80),
    schedule_source: sanitizeText(task?.schedule_source, 100),
    display_metadata_complete: taskHasDisplayMetadata(task),
  };
}

async function listCandidateCustomerOrders(base44, limit) {
  const rows = await base44.asServiceRole.entities.Order.list('-created_date', 80).catch(() => []);
  return (Array.isArray(rows) ? rows : [])
    .filter(order => {
      const status = paymentStatus(order);
      const method = fulfillmentMethod(order);
      return (status === 'paid' || order?.payment_captured === true) &&
        method === 'delivery' &&
        lineItemCount(order) > 0;
    })
    .slice(0, limit);
}

async function findCustomerOrder(base44, lookup) {
  const candidates = [];
  if (lookup.orderId) candidates.push({ id: lookup.orderId });
  if (lookup.orderNumber) candidates.push({ order_number: lookup.orderNumber });
  if (lookup.orderNumber) candidates.push({ shopify_order_number: lookup.orderNumber });
  for (const filter of candidates) {
    const rows = await base44.asServiceRole.entities.Order.filter(filter, '-created_date', 5).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeShopifyOrder(base44, customerOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeOrderNumber(customerOrder?.order_number || customerOrder?.shopify_order_number);
  const queries = [];
  if (lookup.nativeOrderId) queries.push({ id: lookup.nativeOrderId });
  if (lookup.nativeOrderId) queries.push({ shopify_order_id: lookup.nativeOrderId });
  if (customerOrder?.id) queries.push({ base44_order_id: customerOrder.id });
  if (orderNumber) queries.push({ shopify_order_number: orderNumber });
  for (const filter of queries) {
    const rows = await base44.asServiceRole.entities.ShopifyOrder.filter(filter, '-created_date', 5).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeFulfillmentTasks(base44, customerOrder, nativeOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeOrderNumber(customerOrder?.order_number || nativeOrder?.shopify_order_number);
  const queries = [];
  if (nativeOrder?.id) {
    queries.push({ order_id: nativeOrder.id });
    queries.push({ shopify_order_id: nativeOrder.id });
  }
  if (customerOrder?.id) {
    queries.push({ order_id: customerOrder.id });
    queries.push({ base44_order_id: customerOrder.id });
  }
  if (orderNumber) {
    queries.push({ order_number: orderNumber });
    queries.push({ shopify_order_number: orderNumber });
  }

  const seen = new Set();
  const out = [];
  for (const filter of queries) {
    const rows = await base44.asServiceRole.entities.FulfillmentTask.filter(filter, '-created_date', 10).catch(() => []);
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      out.push(row);
    }
  }
  return out;
}

async function runLiveOrderParityPreview({ base44, customerOrder, lookup, source, eventType }) {
  const response = await base44.asServiceRole.functions.invoke('previewNativeSafeSyncLiveOrderParity', compactObject({
    mode: 'dry_run',
    _internal_secret: getPreviewInternalSecret(),
    order_id: customerOrder?.id || lookup.orderId || null,
    order_number: lookup.orderNumber || normalizeOrderNumber(customerOrder?.order_number) || null,
    native_order_id: lookup.nativeOrderId || null,
    source,
    event_type: eventType,
    idempotency_key: `g27:cutover-readiness:${customerOrder?.id || lookup.orderNumber || lookup.nativeOrderId || Date.now()}`,
  }));
  return response?.data || response;
}

function gateSummary() {
  const nativeWriterAllowedSources = parseCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES'));
  const nativeWriterAllowedEvents = parseCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS'));
  return {
    native_safe_sync_writer: {
      enabled: Deno.env.get('ENABLE_NATIVE_SAFE_SYNC_WRITER') === 'true',
      kill_switch: Deno.env.get('NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH') === 'true',
      secret_configured: Boolean(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET')),
      allowed_sources: nativeWriterAllowedSources.slice(0, 10).map(value => sanitizeText(value, 80)).filter(Boolean),
      allowed_events: nativeWriterAllowedEvents.slice(0, 10).map(value => sanitizeText(value, 80)).filter(Boolean),
      order_allowlist_count: countCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST')),
      actor_allowlist_count: countCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ACTOR_EMAIL_ALLOWLIST') || Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ACTOR_ALLOWLIST')),
      broad_real_order_mode: Deno.env.get('ENABLE_NATIVE_SAFE_SYNC_WRITER') === 'true' && countCsv(Deno.env.get('NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST')) === 0,
    },
    may30_native_order_ops: {
      enabled: Deno.env.get('ENABLE_MAY30_NATIVE_ORDER_OPS') === 'true',
      secret_configured: Boolean(Deno.env.get('MAY30_NATIVE_ORDER_OPS_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET')),
      hub_bridge_fallback_expected: true,
    },
    native_fulfillment_task_materialization: {
      enabled: Deno.env.get('ENABLE_NATIVE_FULFILLMENT_TASK_MATERIALIZATION_WRITES') === 'true',
      kill_switch: Deno.env.get('NATIVE_FULFILLMENT_TASK_MATERIALIZATION_KILL_SWITCH') === 'true',
      order_allowlist_count: countCsv(Deno.env.get('NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ORDER_ALLOWLIST')),
      actor_allowlist_count: countCsv(Deno.env.get('NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ALLOWED_EMAILS')),
      broad_real_order_mode: Deno.env.get('ENABLE_NATIVE_FULFILLMENT_TASK_MATERIALIZATION_WRITES') === 'true' && countCsv(Deno.env.get('NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ORDER_ALLOWLIST')) === 0,
    },
    native_fulfillment_task_lifecycle: guardedWriteGate({
      enabledFlag: 'ENABLE_NATIVE_FULFILLMENT_TASK_LIFECYCLE_WRITES',
      killSwitchFlag: 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_KILL_SWITCH',
      allowlistFlag: 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_TASK_ALLOWLIST',
      actorAllowlistFlag: 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_ALLOWED_EMAILS',
      actionAllowlistFlag: 'NATIVE_FULFILLMENT_TASK_LIFECYCLE_ALLOWED_ACTIONS',
      broadModeKey: 'broad_real_task_mode',
    }),
    native_production_batch_lifecycle: guardedWriteGate({
      enabledFlag: 'ENABLE_NATIVE_PRODUCTION_BATCH_LIFECYCLE_WRITES',
      killSwitchFlag: 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_KILL_SWITCH',
      allowlistFlag: 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_BATCH_ALLOWLIST',
      actorAllowlistFlag: 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_EMAILS',
      actionAllowlistFlag: 'NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_ACTIONS',
      broadModeKey: 'broad_real_batch_mode',
    }),
    native_order_schedule_correction: guardedWriteGate({
      enabledFlag: 'ENABLE_NATIVE_ORDER_SCHEDULE_CORRECTION_WRITES',
      killSwitchFlag: 'NATIVE_ORDER_SCHEDULE_CORRECTION_KILL_SWITCH',
      allowlistFlag: 'NATIVE_ORDER_SCHEDULE_CORRECTION_ORDER_ALLOWLIST',
      actorAllowlistFlag: 'NATIVE_ORDER_SCHEDULE_CORRECTION_ALLOWED_EMAILS',
    }),
    native_notification_flags: {
      admin_push_enabled: envEnabled('ENABLE_ADMIN_PUSH_NOTIFICATIONS'),
      order_processed_admin_push_enabled: envEnabled('ENABLE_ADMIN_ORDER_PROCESSED_PUSH'),
      customer_push_enabled: envEnabled('ENABLE_CUSTOMER_PUSH_NOTIFICATIONS'),
      customer_delivery_status_notifications_enabled: envEnabled('ENABLE_CUSTOMER_DELIVERY_STATUS_NOTIFICATIONS'),
      order_status_notifications_enabled: envEnabled('ENABLE_ORDER_STATUS_NOTIFICATIONS'),
      upcoming_delivery_notifications_enabled: envEnabled('ENABLE_UPCOMING_DELIVERY_NOTIFICATIONS'),
      notification_campaign_sends_enabled: envEnabled('ENABLE_NOTIFICATION_CAMPAIGN_SENDS'),
    },
    refund_payment_flags: {
      admin_manual_refunds_enabled: envEnabled('ENABLE_ADMIN_MANUAL_REFUNDS'),
      admin_subscription_cancel_refund_enabled: envEnabled('ENABLE_ADMIN_SUBSCRIPTION_CANCEL_REFUND'),
    },
    delivery_route_flags: {
      delivery_route_optimization_enabled: envEnabled('ENABLE_DELIVERY_ROUTE_OPTIMIZATION'),
      hub_delivery_status_sync_enabled: envEnabled('ENABLE_HUB_DELIVERY_STATUS_SYNC'),
      out_for_delivery_notification_sync_enabled: envEnabled('ENABLE_OUT_FOR_DELIVERY_NOTIFICATION_RUN_SYNC'),
    },
    native_safe_sync_parity: {
      dark_launch_enabled: envEnabled('ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH'),
      dark_launch_kill_switch: envEnabled('NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH'),
      parity_log_enabled: envEnabled('ENABLE_NATIVE_SAFE_SYNC_PARITY_LOG'),
      preview_available: true,
    },
  };
}

function subsystemSummary({ key, label, status, blockers = [], warnings = [], evidence = [] }) {
  return {
    key,
    label,
    status,
    blockers: blockers.slice(0, MAX_BLOCKERS),
    warnings: warnings.slice(0, MAX_BLOCKERS),
    evidence: evidence.slice(0, MAX_BLOCKERS).map(item => sanitizeText(item, 140)).filter(Boolean),
  };
}

function statusForGuardedExactOrderGate(gate, unsafeBroadKey = 'broad_real_order_mode') {
  if (gate?.[unsafeBroadKey]) return 'unsafe_broad_mode_enabled';
  if (gate?.enabled && !gate?.kill_switch && gate?.allowlist_count > 0 && gate?.actor_allowlist_count > 0) return 'exact_scope_gate_ready';
  if (gate?.enabled && gate?.kill_switch) return 'guarded_by_kill_switch';
  return 'disabled_or_not_configured';
}

function buildHubRetirementReadiness(gates) {
  const subsystems = [
    subsystemSummary({
      key: 'paid_order_native_ingestion',
      label: 'Paid Customer App order native ingestion',
      status: gates.may30_native_order_ops.enabled ? 'native_ops_available_with_hub_fallback' : 'not_auto_active_for_future_orders',
      warnings: gates.may30_native_order_ops.enabled ? [] : ['native_paid_order_ops_future_order_trigger_not_confirmed'],
      evidence: [
        gates.may30_native_order_ops.enabled ? 'May 30 native ops flag enabled' : 'May 30 native ops flag disabled',
        'Hub bridge remains fallback',
      ],
    }),
    subsystemSummary({
      key: 'native_shopify_order_mirror',
      label: 'Native ShopifyOrder mirror ownership',
      status: gates.native_safe_sync_writer.broad_real_order_mode ? 'unsafe_broad_mode_enabled' : 'guarded_exact_order_or_disabled',
      blockers: gates.native_safe_sync_writer.broad_real_order_mode ? ['native_safe_sync_writer_broad_mode_enabled_unexpectedly'] : ['native_order_writer_not_approved_for_broad_real_orders'],
      warnings: gates.native_safe_sync_writer.enabled ? ['native_order_writer_requires_exact_scope_gate_review'] : ['native_order_writer_disabled_for_broad_real_orders'],
      evidence: [
        `writer enabled: ${gates.native_safe_sync_writer.enabled}`,
        `order allowlist count: ${gates.native_safe_sync_writer.order_allowlist_count}`,
      ],
    }),
    subsystemSummary({
      key: 'native_fulfillment_task_materialization',
      label: 'Native FulfillmentTask materialization',
      status: gates.native_fulfillment_task_materialization.broad_real_order_mode ? 'unsafe_broad_mode_enabled' : 'guarded_exact_order_or_disabled',
      blockers: gates.native_fulfillment_task_materialization.broad_real_order_mode ? ['native_task_materialization_broad_mode_enabled_unexpectedly'] : ['native_task_materialization_not_approved_for_broad_real_orders'],
      warnings: gates.native_fulfillment_task_materialization.enabled ? ['native_task_materialization_requires_exact_scope_gate_review'] : ['native_task_materialization_writes_disabled'],
      evidence: [
        `task materialization enabled: ${gates.native_fulfillment_task_materialization.enabled}`,
        `order allowlist count: ${gates.native_fulfillment_task_materialization.order_allowlist_count}`,
      ],
    }),
    subsystemSummary({
      key: 'native_fulfillment_task_lifecycle',
      label: 'Native FulfillmentTask lifecycle commands',
      status: statusForGuardedExactOrderGate(gates.native_fulfillment_task_lifecycle, 'broad_real_task_mode'),
      blockers: gates.native_fulfillment_task_lifecycle.broad_real_task_mode ? ['native_task_lifecycle_broad_task_mode_enabled_unexpectedly'] : ['native_task_lifecycle_not_validated_for_broad_operations'],
      warnings: ['route_proof_drop_delivery_command_coverage_still_requires_separate_validation'],
      evidence: [
        `lifecycle enabled: ${gates.native_fulfillment_task_lifecycle.enabled}`,
        `task allowlist count: ${gates.native_fulfillment_task_lifecycle.allowlist_count}`,
        `action allowlist count: ${gates.native_fulfillment_task_lifecycle.action_allowlist_count || 0}`,
      ],
    }),
    subsystemSummary({
      key: 'native_production_batch_lifecycle',
      label: 'Native production batch lifecycle',
      status: statusForGuardedExactOrderGate(gates.native_production_batch_lifecycle, 'broad_real_batch_mode'),
      blockers: gates.native_production_batch_lifecycle.broad_real_batch_mode ? ['native_production_batch_broad_mode_enabled_unexpectedly'] : ['native_production_batch_lifecycle_not_validated_for_broad_operations'],
      warnings: ['production_start_complete_verify_ownership_requires_separate_validation'],
      evidence: [
        `production lifecycle enabled: ${gates.native_production_batch_lifecycle.enabled}`,
        `batch allowlist count: ${gates.native_production_batch_lifecycle.allowlist_count}`,
      ],
    }),
    subsystemSummary({
      key: 'native_schedule_correction',
      label: 'Native order schedule correction',
      status: statusForGuardedExactOrderGate(gates.native_order_schedule_correction),
      blockers: gates.native_order_schedule_correction.broad_real_order_mode ? ['native_schedule_correction_broad_mode_enabled_unexpectedly'] : ['native_schedule_correction_not_validated_for_broad_operations'],
      warnings: ['schedule_correction_remains_exact_order_only_until_approved'],
      evidence: [
        `schedule correction enabled: ${gates.native_order_schedule_correction.enabled}`,
        `order allowlist count: ${gates.native_order_schedule_correction.allowlist_count}`,
      ],
    }),
    subsystemSummary({
      key: 'inventory_procurement_ownership',
      label: 'Inventory and procurement ownership',
      status: 'not_native_owned_for_cutover',
      blockers: ['inventory_procurement_native_ownership_not_validated'],
      warnings: ['do_not_retire_hub_until_inventory_deduction_and_purchase_order_paths_are_validated'],
      evidence: ['Readiness gate found no approved broad native inventory/procurement cutover contract'],
    }),
    subsystemSummary({
      key: 'delivery_route_proof_ownership',
      label: 'Delivery route, proof, and drop ownership',
      status: 'partial_not_cutover_ready',
      blockers: ['delivery_route_proof_native_ownership_not_validated'],
      warnings: [
        gates.delivery_route_flags.hub_delivery_status_sync_enabled ? 'hub_delivery_status_sync_flag_enabled' : 'hub_delivery_status_sync_not_part_of_native_cutover',
        gates.delivery_route_flags.delivery_route_optimization_enabled ? 'route_optimization_flag_enabled_requires_separate_validation' : 'route_optimization_not_enabled_for_cutover',
      ],
      evidence: ['Fulfillment lifecycle command coverage is separate from full delivery execution/proof ownership'],
    }),
    subsystemSummary({
      key: 'notification_ownership',
      label: 'Notification ownership',
      status: 'not_cutover_validated',
      blockers: ['notification_behavior_native_ownership_not_validated'],
      warnings: [
        gates.native_notification_flags.customer_push_enabled ? 'customer_push_notifications_flag_enabled_requires_separate_cutover_validation' : 'customer_push_notifications_not_enabled_for_cutover',
        gates.native_notification_flags.order_status_notifications_enabled ? 'order_status_notifications_flag_enabled_requires_separate_cutover_validation' : 'order_status_notifications_not_enabled_for_cutover',
      ],
      evidence: ['No notification send is part of this readiness preview'],
    }),
    subsystemSummary({
      key: 'refund_payment_reversal_ownership',
      label: 'Refund and payment reversal ownership',
      status: 'not_cutover_validated',
      blockers: ['refund_payment_reversal_native_ownership_not_validated'],
      warnings: [
        gates.refund_payment_flags.admin_manual_refunds_enabled ? 'manual_refunds_flag_enabled_requires_separate_cutover_validation' : 'manual_refunds_not_enabled_for_cutover',
        gates.refund_payment_flags.admin_subscription_cancel_refund_enabled ? 'subscription_cancel_refund_flag_enabled_requires_separate_cutover_validation' : 'subscription_cancel_refund_not_enabled_for_cutover',
      ],
      evidence: ['Refund/payment reversal paths are intentionally outside this order cutover preview'],
    }),
    subsystemSummary({
      key: 'reconciliation_reporting',
      label: 'Reconciliation and parity reporting',
      status: gates.native_safe_sync_parity.preview_available ? 'read_only_parity_available' : 'not_available',
      blockers: ['hub_retirement_reconciliation_reporting_not_finalized'],
      warnings: [
        gates.native_safe_sync_parity.dark_launch_enabled && !gates.native_safe_sync_parity.dark_launch_kill_switch ? 'dark_launch_comparison_enabled' : 'dark_launch_comparison_not_active',
        gates.native_safe_sync_parity.parity_log_enabled ? 'parity_log_flag_enabled_requires_volume_review' : 'parity_log_not_enabled_for_cutover',
      ],
      evidence: ['previewNativeSafeSyncLiveOrderParity is reused for dry-run target checks'],
    }),
    subsystemSummary({
      key: 'hub_bridge_fallback',
      label: 'Hub bridge fallback',
      status: 'required_fallback_active',
      blockers: ['hub_bridge_retirement_not_approved'],
      warnings: ['hub_bridge_must_remain_until_all_native_subsystems_are_validated'],
      evidence: ['Current migration contract keeps Hub bridge as fallback'],
    }),
  ];

  const blockers = [...new Set(subsystems.flatMap(item => item.blockers || []))].slice(0, MAX_BLOCKERS);
  const warnings = [...new Set(subsystems.flatMap(item => item.warnings || []))].slice(0, MAX_BLOCKERS);

  return {
    status: blockers.length > 0 ? 'not_ready_to_retire_hub' : warnings.length > 0 ? 'review_required_before_hub_retirement' : 'ready_to_retire_hub',
    subsystem_count: subsystems.length,
    blocker_count: blockers.length,
    warning_count: warnings.length,
    blockers,
    warnings,
    hub_bridge_fallback_required: true,
    hub_retirement_approved: false,
    live_writes_required_for_this_check: false,
    next_action: blockers.length > 0
      ? 'validate_blocked_native_subsystems_before_hub_retirement'
      : 'perform_final_cutover_approval_review',
    subsystems: subsystems.slice(0, MAX_SUBSYSTEM_SUMMARY),
  };
}

function summarizeTarget({ customerOrder, nativeOrder, tasks, preview, lookup }) {
  const blockers = [];
  const warnings = [];
  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || nativeOrder?.shopify_order_number || lookup.orderNumber);
  const paid = paymentStatus(customerOrder) === 'paid' || customerOrder?.payment_captured === true;
  const delivery = fulfillmentMethod(customerOrder) === 'delivery';
  const addressComplete = hasCompleteDeliveryAddress(customerOrder || {});
  const itemCount = lineItemCount(customerOrder);
  const parityReadiness = preview?.readiness || {};
  const parityBlockers = Array.isArray(parityReadiness.blockers) ? parityReadiness.blockers : [];
  const parityWarnings = Array.isArray(parityReadiness.warnings) ? parityReadiness.warnings : [];
  const displayCompleteTasks = tasks.filter(taskHasDisplayMetadata);

  if (!customerOrder) blockers.push('customer_app_order_missing');
  if (customerOrder && !paid) blockers.push('payment_not_paid');
  if (customerOrder && itemCount === 0) blockers.push('line_items_missing');
  if (customerOrder && delivery && !addressComplete) blockers.push('delivery_address_incomplete');
  if (parityBlockers.length > 0) blockers.push(...parityBlockers);
  if (nativeOrder && delivery && tasks.length === 0) warnings.push('native_fulfillment_task_missing');
  if (tasks.length > 0 && displayCompleteTasks.length === 0) warnings.push('native_task_display_metadata_incomplete');
  warnings.push(...parityWarnings);

  const uniqueBlockers = [...new Set(blockers)].slice(0, MAX_BLOCKERS);
  const uniqueWarnings = [...new Set(warnings)].slice(0, MAX_BLOCKERS);
  const planner = preview?.planner_summary || {};
  let classification = 'hold';
  if (uniqueBlockers.length > 0) classification = 'blocked';
  else if (!nativeOrder && planner.would_create_order) classification = 'pilot_ready_native_create_dry_run';
  else if (nativeOrder && (planner.would_update_order || planner.action === 'skipped' || planner.action === 'duplicate_event')) classification = 'pilot_ready_native_update_or_dedupe_dry_run';
  else if (nativeOrder && tasks.length > 0) classification = 'usable_with_hub_fallback';

  return {
    order_number: orderNumber || null,
    customer_app_order_id: customerOrder?.id || null,
    native_shopify_order_id: nativeOrder?.id || null,
    status: sanitizeText(customerOrder?.status, 80),
    payment_status: paymentStatus(customerOrder),
    payment_captured: customerOrder?.payment_captured === true,
    fulfillment_method: fulfillmentMethod(customerOrder),
    line_item_count: itemCount,
    address_complete: addressComplete,
    native_order_present: Boolean(nativeOrder),
    native_sync_status: sanitizeText(nativeOrder?.sync_status, 100),
    native_source_type: sanitizeText(nativeOrder?.source_type, 80),
    native_order_type: sanitizeText(nativeOrder?.order_type, 80),
    native_task_count: tasks.length,
    native_task_display_metadata_complete_count: displayCompleteTasks.length,
    native_tasks: tasks.slice(0, MAX_TASK_SUMMARY).map(summarizeTask),
    parity_status: preview?.parity_status || null,
    planner_summary: preview?.planner_summary || null,
    classification,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
  };
}

function aggregateReadiness(targets, gates) {
  const blockers = [];
  const warnings = [];
  const targetBlockers = targets.flatMap(target => target.blockers || []);
  const targetWarnings = targets.flatMap(target => target.warnings || []);
  if (targets.length === 0) blockers.push('no_paid_delivery_orders_selected_or_found');
  if (targetBlockers.length > 0) blockers.push('one_or_more_targets_blocked');
  if (gates.native_safe_sync_writer.broad_real_order_mode) blockers.push('native_safe_sync_writer_broad_mode_enabled_unexpectedly');
  if (gates.native_fulfillment_task_materialization.broad_real_order_mode) blockers.push('native_task_materialization_broad_mode_enabled_unexpectedly');
  if (!gates.may30_native_order_ops.enabled) warnings.push('may30_native_order_ops_live_path_disabled_future_orders_need_existing_checkout_or_bridge_flow');
  if (!gates.native_safe_sync_writer.enabled) warnings.push('native_safe_sync_writer_disabled_for_broad_real_orders');
  if (!gates.native_fulfillment_task_materialization.enabled) warnings.push('native_task_materialization_writes_disabled');
  if (targetWarnings.length > 0) warnings.push('one_or_more_targets_have_warnings');

  const pilotReadyTargets = targets.filter(target => target.classification?.startsWith('pilot_ready'));
  const usableTargets = targets.filter(target => ['usable_with_hub_fallback', 'pilot_ready_native_create_dry_run', 'pilot_ready_native_update_or_dedupe_dry_run'].includes(target.classification));

  return {
    classification: blockers.length > 0
      ? 'hold_before_live_pilot'
      : pilotReadyTargets.length > 0
        ? 'pilot_ready_with_exact_order_approval'
        : usableTargets.length > 0
          ? 'usable_with_hub_fallback_monitor_next_order'
          : 'review_required',
    target_count: targets.length,
    pilot_ready_target_count: pilotReadyTargets.length,
    usable_target_count: usableTargets.length,
    blockers: [...new Set(blockers)].slice(0, MAX_BLOCKERS),
    warnings: [...new Set(warnings)].slice(0, MAX_BLOCKERS),
    target_blockers: [...new Set(targetBlockers)].slice(0, MAX_BLOCKERS),
    target_warnings: [...new Set(targetWarnings)].slice(0, MAX_BLOCKERS),
    hub_bridge_remains_fallback: true,
    live_pilot_requires_exact_order_approval: true,
    next_action: blockers.length > 0
      ? 'resolve_blockers_then_recheck'
      : pilotReadyTargets.length > 0
        ? 'approve_one_exact_order_live_pilot_or_continue_monitoring'
        : 'monitor_next_natural_paid_order',
  };
}

async function buildTargets(base44, body) {
  const limit = safeLimit(body?.limit);
  const lookup = getLookup(body);
  if (lookup.orderId || lookup.orderNumber || lookup.nativeOrderId) {
    let customerOrder = await findCustomerOrder(base44, lookup);
    if (!customerOrder && lookup.nativeOrderId) {
      const nativeOrder = await findNativeShopifyOrder(base44, null, lookup);
      customerOrder = await findCustomerOrder(base44, {
        orderId: nativeOrder?.base44_order_id || '',
        orderNumber: normalizeOrderNumber(nativeOrder?.shopify_order_number),
        nativeOrderId: lookup.nativeOrderId,
      });
    }
    return customerOrder ? [customerOrder] : [];
  }
  return listCandidateCustomerOrders(base44, limit);
}

const G33C_DEFAULT_RECENT_LIMIT = 10;
const G33C_MAX_RECENT_LIMIT = 25;
const G33C_PREVIEW_MODE = 'ELIGIBLE_ONE_TIME_ORDER_NATIVE_WORKFLOW';

const G33C_ALLOWED_BODY_KEYS = new Set([
  'mode',
  'preview_mode',
  'preview_bundle',
  'preview_bundle_mode',
  'candidate_mode',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'max_recent_candidates',
  'limit',
  'include_hub_context',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

const G33C_READ_ONLY_SAFETY = Object.freeze({
  dry_run_only: true,
  writes_performed: false,
  gates_opened: false,
  live_commands_run: false,
  customer_app_order_created: false,
  customer_app_order_updated: false,
  native_shopify_order_created: false,
  native_shopify_order_updated: false,
  native_fulfillment_task_created: false,
  native_fulfillment_task_updated: false,
  production_batch_created: false,
  production_batch_updated: false,
  batch_compliance_log_created: false,
  batch_compliance_log_updated: false,
  notifications_created: false,
  notifications_sent: false,
  message_logs_created: false,
  provider_calls_performed: false,
  stripe_calls_performed: false,
  shopify_api_calls_performed: false,
  sync_repair_replay_performed: false,
  inventory_deducted: false,
  purchase_order_created: false,
  hub_records_updated: false,
  hub_bridge_modified: false,
});

function isG33CPreviewRequest(body) {
  const mode = normalizeText(body?.mode).toUpperCase();
  const previewMode = normalizeText(body?.preview_mode || body?.preview_bundle).toUpperCase();
  return previewMode === G33C_PREVIEW_MODE || (!previewMode && ['EXACT_ORDER_PREVIEW', 'RECENT_CANDIDATE_SCAN'].includes(mode));
}

function g33cUnsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!G33C_ALLOWED_BODY_KEYS.has(normalizeText(key).toLowerCase())) return key;
  }
  return null;
}

function g33cLookup(body) {
  const orderNumber = normalizeOrderNumber(body?.order_number || body?.shopify_order_number);
  const requestedMode = normalizeText(body?.preview_bundle_mode || body?.candidate_mode || body?.mode).toUpperCase();
  const maxRecentRaw = Number(body?.max_recent_candidates || body?.limit || G33C_DEFAULT_RECENT_LIMIT);
  const maxRecentCandidates = Number.isFinite(maxRecentRaw)
    ? Math.max(1, Math.min(G33C_MAX_RECENT_LIMIT, Math.floor(maxRecentRaw)))
    : G33C_DEFAULT_RECENT_LIMIT;
  return {
    mode: ['EXACT_ORDER_PREVIEW', 'RECENT_CANDIDATE_SCAN'].includes(requestedMode)
      ? requestedMode
      : orderNumber || body?.customer_app_order_id || body?.base44_order_id || body?.order_id
        ? 'EXACT_ORDER_PREVIEW'
        : 'RECENT_CANDIDATE_SCAN',
    orderNumber,
    customerAppOrderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id || body?.order_id),
    maxRecentCandidates,
    includeHubContext: body?.include_hub_context !== false,
  };
}

function g33cOrderKey(value) {
  return normalizeOrderNumber(value).toLowerCase();
}

function g33cMatchesOrder(row, orderNumber, customerOrderId) {
  const orderKey = g33cOrderKey(orderNumber);
  if (customerOrderId && [row?.base44_order_id, row?.order_id, row?.customer_app_order_id].some(value => normalizeText(value) === customerOrderId)) return true;
  if (!orderKey) return false;
  return [row?.order_number, row?.shopify_order_number, row?.source_order_number, row?.customer_order_number, row?.hub_order_number]
    .some(value => g33cOrderKey(value) === orderKey);
}

function g33cUnique(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const key = row?.id || JSON.stringify(row).slice(0, 120);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function g35dSleep(ms) {
  if (typeof setTimeout !== 'function') return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function g33cFilter(base44, entityName, filter, sort = '-created_date', limit = 20, options = {}) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const attempts = options?.retryEmpty ? 3 : 1;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const rows = await entity.filter(filter, sort, limit).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) return rows;
    if (attempt < attempts) await g35dSleep(options?.retryDelayMs || 150);
  }
  return [];
}

async function g33cList(base44, entityName, sort = '-created_date', limit = 100) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.list) return [];
  const rows = await entity.list(sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}


const G39B_PREVIEW_MODE = 'ADMIN_NATIVE_FIRST_HUB_READ_PARITY';
const G39B_DEFAULT_MAX_ROWS = 10;
const G39B_MAX_ROWS = 25;
const G39B_SURFACES = [
  'admin_orders',
  'operations_dashboard',
  'delivery_route_summary',
  'production_planning',
  'ops_alerts',
  'resources',
  'calendar_events',
];
const G39B_SUPPORTED_SURFACES = new Set(['all', ...G39B_SURFACES]);
const G39B_ALLOWED_BODY_KEYS = new Set([
  'preview_mode',
  'surface',
  'date_from',
  'date_to',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'native_shopify_order_id',
  'native_fulfillment_task_id',
  'max_rows',
  'limit',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);
const G39B_ADMIN_SURFACE_AUDIT = Object.freeze({
  admin_orders: {
    function_name: 'getAdminOrdersWithHub',
    admin_page_dependency: 'admin order list / operations order surfaces',
    reads_native_data: true,
    reads_hub_data: true,
    hub_role: 'primary_merged_with_native_context',
    admin_only: true,
    read_only: true,
    creates_logs_or_queues: false,
    provider_calls_expected: false,
    pii_policy: 'preview_returns_ids_and_statuses_only_no_customer_email_phone_full_address',
    native_replacement_status: 'native_replacement_partial',
  },
  operations_dashboard: {
    function_name: 'getAdminOperationsDashboardSummary',
    admin_page_dependency: 'operations dashboard summary',
    reads_native_data: true,
    reads_hub_data: true,
    hub_role: 'hub_primary_with_native_fallback',
    admin_only: true,
    read_only: true,
    creates_logs_or_queues: false,
    provider_calls_expected: false,
    pii_policy: 'aggregate_counts_only',
    native_replacement_status: 'native_replacement_partial',
  },
  delivery_route_summary: {
    function_name: 'getAdminDeliveryRouteSummary',
    admin_page_dependency: 'delivery route summary',
    reads_native_data: true,
    reads_hub_data: true,
    hub_role: 'hub_route_queue_with_native_schedule_reconciliation',
    admin_only: true,
    read_only: true,
    creates_logs_or_queues: false,
    provider_calls_expected: false,
    pii_policy: 'route_drop_proof_presence_only_no_raw_payload',
    native_replacement_status: 'native_replacement_partial',
  },
  production_planning: {
    function_name: 'getAdminProductionPlanningSummary',
    admin_page_dependency: 'production planning summary',
    reads_native_data: true,
    reads_hub_data: true,
    hub_role: 'hub_summary_merged_with_native_batches_and_master_data',
    admin_only: true,
    read_only: true,
    creates_logs_or_queues: false,
    provider_calls_expected: false,
    pii_policy: 'product_demand_and_batch_counts_only',
    native_replacement_status: 'native_replacement_partial',
  },
  ops_alerts: {
    function_name: 'getAdminOpsAlertsSummary',
    admin_page_dependency: 'operations alerts summary',
    reads_native_data: true,
    reads_hub_data: true,
    hub_role: 'hub_alerts_with_native_fallback',
    admin_only: true,
    read_only: true,
    creates_logs_or_queues: false,
    provider_calls_expected: false,
    pii_policy: 'alert_counts_and_safe_alert_labels_only',
    native_replacement_status: 'native_replacement_partial',
  },
  resources: {
    function_name: 'getAdminResourcesSummary',
    admin_page_dependency: 'resources summary',
    reads_native_data: true,
    reads_hub_data: true,
    hub_role: 'hub_resources_with_native_fallback',
    admin_only: true,
    read_only: true,
    creates_logs_or_queues: false,
    provider_calls_expected: false,
    pii_policy: 'team_and_equipment_summary_only',
    native_replacement_status: 'native_preview_exists_only',
  },
  calendar_events: {
    function_name: 'getAdminCalendarEventsSummary',
    admin_page_dependency: 'admin calendar/events summary',
    reads_native_data: true,
    reads_hub_data: true,
    hub_role: 'hub_calendar_with_native_fallback',
    admin_only: true,
    read_only: true,
    creates_logs_or_queues: false,
    provider_calls_expected: false,
    pii_policy: 'date_event_counts_only',
    native_replacement_status: 'native_replacement_partial',
  },
});

function isG39BPreviewRequest(body) {
  return normalizeText(body?.preview_mode).toUpperCase() === G39B_PREVIEW_MODE;
}

function g39bUnsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!G39B_ALLOWED_BODY_KEYS.has(normalizeText(key).toLowerCase())) return key;
  }
  return null;
}

function g39bLookup(body) {
  const surface = normalizeLower(body?.surface || 'all') || 'all';
  const maxRowsRaw = Number(body?.max_rows || body?.limit || G39B_DEFAULT_MAX_ROWS);
  const maxRows = Number.isFinite(maxRowsRaw)
    ? Math.max(1, Math.min(G39B_MAX_ROWS, Math.floor(maxRowsRaw)))
    : G39B_DEFAULT_MAX_ROWS;
  return {
    surface: G39B_SUPPORTED_SURFACES.has(surface) ? surface : 'unsupported',
    rawSurface: surface,
    maxRows,
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id),
    nativeShopifyOrderId: normalizeText(body?.native_shopify_order_id),
    nativeFulfillmentTaskId: normalizeText(body?.native_fulfillment_task_id),
    dateFrom: g39bDateOnly(body?.date_from),
    dateTo: g39bDateOnly(body?.date_to),
    requestId: sanitizeText(body?.request_id, 120),
  };
}

function g39bDateOnly(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function g39bEntityId(row) {
  return sanitizeText(row?.id || row?._id || row?.record_id, 100);
}

function g39bOrderKey(value) {
  return normalizeOrderNumber(value).toLowerCase();
}

function g39bFirstValue(row, keys) {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && normalizeText(value) !== '') return value;
  }
  return null;
}

function g39bSafeDate(row, keys) {
  return g39bDateOnly(g39bFirstValue(row, keys));
}

function g39bSafeStatus(row, keys) {
  return sanitizeText(g39bFirstValue(row, keys), 80);
}

function g39bSafeBool(value) {
  if (value === true || value === false) return value;
  const text = normalizeLower(value);
  if (['true', 'yes', '1'].includes(text)) return true;
  if (['false', 'no', '0'].includes(text)) return false;
  return null;
}

function g39bNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function g39bLineItemCount(row) {
  const direct = g39bNumberOrNull(g39bFirstValue(row, ['line_item_count', 'item_count', 'items_count']));
  if (direct !== null) return direct;
  const lineItems = row?.line_items || row?.items || row?.products;
  return Array.isArray(lineItems) ? lineItems.length : null;
}

function g39bProductDemandCount(row) {
  const direct = g39bNumberOrNull(g39bFirstValue(row, ['product_demand_count', 'line_item_count', 'item_count']));
  if (direct !== null) return direct;
  const items = row?.line_items || row?.items || row?.products || row?.product_demands;
  return Array.isArray(items) ? items.length : null;
}

function g39bHasHubContext(row) {
  if (!row || typeof row !== 'object') return false;
  const source = normalizeLower(g39bFirstValue(row, ['source', 'source_type', 'source_channel', 'origin', 'record_source']));
  if (source.includes('hub')) return true;
  return Boolean(
    row?.hub_order_id ||
    row?.hub_task_id ||
    row?.hub_subscription_id ||
    row?.hub_fallback_context ||
    row?.hub_delivery_date ||
    row?.hub_status ||
    row?.hub_payload_present ||
    row?.is_hub_order === true ||
    row?.from_hub === true
  );
}

function g39bMatchesLookup(row, lookup) {
  if (!row || typeof row !== 'object') return false;
  if (lookup.customerAppOrderId && [row?.id, row?.base44_order_id, row?.customer_app_order_id, row?.order_id]
    .some(value => normalizeText(value) === lookup.customerAppOrderId)) return true;
  if (lookup.nativeShopifyOrderId && [row?.id, row?.native_shopify_order_id, row?.shopify_order_id]
    .some(value => normalizeText(value) === lookup.nativeShopifyOrderId)) return true;
  if (lookup.nativeFulfillmentTaskId && [row?.id, row?.native_fulfillment_task_id, row?.fulfillment_task_id]
    .some(value => normalizeText(value) === lookup.nativeFulfillmentTaskId)) return true;
  if (!lookup.orderNumber) return true;
  const orderKey = g39bOrderKey(lookup.orderNumber);
  return [
    row?.order_number,
    row?.shopify_order_number,
    row?.source_order_number,
    row?.customer_order_number,
    row?.hub_order_number,
  ].some(value => g39bOrderKey(value) === orderKey);
}

function g39bWithinDateRange(row, lookup, keys = ['delivery_date', 'production_date', 'scheduled_date', 'assigned_delivery_date', 'created_date', 'updated_date']) {
  if (!lookup.dateFrom && !lookup.dateTo) return true;
  const date = g39bSafeDate(row, keys);
  if (!date) return false;
  if (lookup.dateFrom && date < lookup.dateFrom) return false;
  if (lookup.dateTo && date > lookup.dateTo) return false;
  return true;
}

async function g39bReadRows(base44, entityName, limit = 100) {
  return g33cList(base44, entityName, '-created_date', limit);
}

function g39bTakeRows(rows, lookup, dateKeys) {
  return (rows || [])
    .filter(row => g39bMatchesLookup(row, lookup))
    .filter(row => g39bWithinDateRange(row, lookup, dateKeys))
    .slice(0, lookup.maxRows);
}

function g39bBuildNativeOrderRows({ orders, nativeOrders, tasks, lookup }) {
  const nativeByOrder = new Map();
  for (const row of nativeOrders || []) {
    const key = g39bOrderKey(g39bFirstValue(row, ['shopify_order_number', 'order_number', 'source_order_number']));
    if (key && !nativeByOrder.has(key)) nativeByOrder.set(key, row);
  }
  const taskByOrder = new Map();
  for (const row of tasks || []) {
    const key = g39bOrderKey(g39bFirstValue(row, ['order_number', 'shopify_order_number', 'source_order_number']));
    if (key && !taskByOrder.has(key)) taskByOrder.set(key, row);
  }
  const rows = [];
  for (const order of orders || []) {
    const orderNumber = normalizeOrderNumber(g39bFirstValue(order, ['order_number', 'shopify_order_number', 'source_order_number']));
    if (!orderNumber) continue;
    const key = g39bOrderKey(orderNumber);
    const nativeOrder = nativeByOrder.get(key) || null;
    const task = taskByOrder.get(key) || null;
    rows.push({
      parity_key: key,
      order_number: sanitizeText(orderNumber, 80),
      customer_app_order_id: g39bEntityId(order),
      native_shopify_order_id: g39bEntityId(nativeOrder),
      native_fulfillment_task_id: g39bEntityId(task),
      order_status: g39bSafeStatus(order, ['status', 'order_status']),
      payment_status: g39bSafeStatus(order, ['payment_status']),
      payment_captured: g39bSafeBool(order?.payment_captured),
      fulfillment_type: g39bSafeStatus(order, ['fulfillment_type', 'fulfillment_method']),
      fulfillment_status: g39bSafeStatus(nativeOrder, ['fulfillment_status', 'status']),
      production_status: g39bSafeStatus(nativeOrder, ['production_status']) || g39bSafeStatus(task, ['production_status']),
      delivery_status: g39bSafeStatus(task, ['delivery_status']),
      delivery_date: g39bSafeDate(order, ['delivery_date', 'scheduled_date', 'assigned_delivery_date']),
      line_item_count: g39bLineItemCount(order),
      total_price: g39bNumberOrNull(g39bFirstValue(order, ['total_price', 'total', 'order_total'])),
      source_classification: nativeOrder || task ? 'native_context_available' : 'customer_app_order_only',
      fallback_source: g39bHasHubContext(order) ? 'local_hub_context_on_order' : 'native_customer_app',
    });
  }
  for (const nativeOrder of nativeOrders || []) {
    const orderNumber = normalizeOrderNumber(g39bFirstValue(nativeOrder, ['shopify_order_number', 'order_number', 'source_order_number']));
    const key = g39bOrderKey(orderNumber);
    if (!key || rows.some(row => row.parity_key === key)) continue;
    const task = taskByOrder.get(key) || null;
    rows.push({
      parity_key: key,
      order_number: sanitizeText(orderNumber, 80),
      customer_app_order_id: sanitizeText(nativeOrder?.base44_order_id, 100),
      native_shopify_order_id: g39bEntityId(nativeOrder),
      native_fulfillment_task_id: g39bEntityId(task),
      order_status: null,
      payment_status: g39bSafeStatus(nativeOrder, ['payment_status']),
      payment_captured: null,
      fulfillment_type: g39bSafeStatus(nativeOrder, ['fulfillment_method', 'fulfillment_type']),
      fulfillment_status: g39bSafeStatus(nativeOrder, ['fulfillment_status', 'status']),
      production_status: g39bSafeStatus(nativeOrder, ['production_status']),
      delivery_status: g39bSafeStatus(task, ['delivery_status']),
      delivery_date: g39bSafeDate(nativeOrder, ['delivery_date', 'scheduled_date', 'assigned_delivery_date']),
      line_item_count: g39bLineItemCount(nativeOrder),
      total_price: g39bNumberOrNull(g39bFirstValue(nativeOrder, ['total_price', 'total'])),
      source_classification: 'native_only_shopify_order',
      fallback_source: 'native_shopify_order',
    });
  }
  return g39bTakeRows(rows, lookup, ['delivery_date']).map(row => ({ ...row, data_source: 'native' }));
}

function g39bBuildHubOrderRows({ orders, orderSyncLogs, parityLogs, lookup }) {
  const rows = [];
  for (const order of orders || []) {
    if (!g39bHasHubContext(order)) continue;
    const orderNumber = normalizeOrderNumber(g39bFirstValue(order, ['hub_order_number', 'order_number', 'shopify_order_number', 'source_order_number']));
    if (!orderNumber) continue;
    rows.push({
      parity_key: g39bOrderKey(orderNumber),
      order_number: sanitizeText(orderNumber, 80),
      customer_app_order_id: g39bEntityId(order),
      hub_order_id: sanitizeText(g39bFirstValue(order, ['hub_order_id', 'hub_id', 'source_order_id']), 100),
      order_status: g39bSafeStatus(order, ['hub_status', 'status', 'order_status']),
      payment_status: g39bSafeStatus(order, ['payment_status', 'hub_payment_status']),
      payment_captured: g39bSafeBool(order?.payment_captured),
      fulfillment_type: g39bSafeStatus(order, ['fulfillment_type', 'hub_fulfillment_type']),
      fulfillment_status: g39bSafeStatus(order, ['fulfillment_status', 'hub_fulfillment_status']),
      production_status: g39bSafeStatus(order, ['production_status', 'hub_production_status']),
      delivery_status: g39bSafeStatus(order, ['delivery_status', 'hub_delivery_status']),
      delivery_date: g39bSafeDate(order, ['hub_delivery_date', 'delivery_date', 'scheduled_date', 'assigned_delivery_date']),
      line_item_count: g39bLineItemCount(order),
      total_price: g39bNumberOrNull(g39bFirstValue(order, ['total_price', 'total', 'order_total'])),
      source_classification: 'hub_fallback_local_context',
      fallback_source: 'hub_context_on_customer_order',
      data_source: 'hub_fallback',
    });
  }
  for (const log of [...(orderSyncLogs || []), ...(parityLogs || [])]) {
    if (!g39bHasHubContext(log)) continue;
    const orderNumber = normalizeOrderNumber(g39bFirstValue(log, ['order_number', 'shopify_order_number', 'hub_order_number', 'source_order_number']));
    if (!orderNumber) continue;
    const key = g39bOrderKey(orderNumber);
    if (rows.some(row => row.parity_key === key)) continue;
    rows.push({
      parity_key: key,
      order_number: sanitizeText(orderNumber, 80),
      customer_app_order_id: sanitizeText(g39bFirstValue(log, ['base44_order_id', 'customer_app_order_id', 'order_id']), 100),
      hub_order_id: sanitizeText(g39bFirstValue(log, ['hub_order_id', 'hub_id']), 100),
      order_status: g39bSafeStatus(log, ['status', 'hub_status', 'sync_status']),
      payment_status: g39bSafeStatus(log, ['payment_status']),
      payment_captured: null,
      fulfillment_type: g39bSafeStatus(log, ['fulfillment_type']),
      fulfillment_status: g39bSafeStatus(log, ['fulfillment_status']),
      production_status: g39bSafeStatus(log, ['production_status']),
      delivery_status: g39bSafeStatus(log, ['delivery_status']),
      delivery_date: g39bSafeDate(log, ['delivery_date', 'hub_delivery_date', 'scheduled_date']),
      line_item_count: null,
      total_price: null,
      source_classification: 'hub_fallback_sync_log_context',
      fallback_source: 'order_sync_or_parity_log',
      data_source: 'hub_fallback',
    });
  }
  return g39bTakeRows(rows, lookup, ['delivery_date']);
}

function g39bComparableFieldsForSurface(surface) {
  if (surface === 'delivery_route_summary') {
    return ['delivery_date', 'task_status', 'delivery_status', 'production_status'];
  }
  if (surface === 'production_planning') {
    return ['production_date', 'production_status', 'product_demand_count', 'native_production_batch_count'];
  }
  return ['order_status', 'payment_status', 'payment_captured', 'fulfillment_type', 'fulfillment_status', 'production_status', 'delivery_status', 'delivery_date', 'line_item_count', 'total_price'];
}

function g39bCompareRows(nativeRow, hubRow, surface) {
  if (nativeRow && hubRow) {
    const mismatches = [];
    for (const field of g39bComparableFieldsForSurface(surface)) {
      const nativeValue = nativeRow?.[field];
      const hubValue = hubRow?.[field];
      if (nativeValue === null || nativeValue === undefined || nativeValue === '') continue;
      if (hubValue === null || hubValue === undefined || hubValue === '') continue;
      if (String(nativeValue) !== String(hubValue)) mismatches.push({ field, native_value: nativeValue, hub_value: hubValue });
    }
    if (surface === 'delivery_route_summary' && hubRow?.stale_hub_fallback === true) {
      return { classification: 'stale_hub_fallback_detected', mismatches };
    }
    return { classification: mismatches.length ? 'native_hub_mismatch' : 'native_hub_match', mismatches };
  }
  if (nativeRow && !hubRow) return { classification: 'native_present_hub_missing', mismatches: [] };
  if (!nativeRow && hubRow) return { classification: 'native_missing_hub_available', mismatches: [] };
  return { classification: 'unknown_needs_manual_review', mismatches: [] };
}

function g39bBuildParityRows({ surface, nativeRows, hubRows, maxRows }) {
  const keys = new Set();
  for (const row of nativeRows || []) if (row?.parity_key) keys.add(row.parity_key);
  for (const row of hubRows || []) if (row?.parity_key) keys.add(row.parity_key);
  const rows = [];
  for (const key of keys) {
    const nativeRow = (nativeRows || []).find(row => row.parity_key === key) || null;
    const hubRow = (hubRows || []).find(row => row.parity_key === key) || null;
    const comparison = g39bCompareRows(nativeRow, hubRow, surface);
    rows.push({
      parity_key: sanitizeText(key, 100),
      order_number: sanitizeText(nativeRow?.order_number || hubRow?.order_number, 80),
      classification: comparison.classification,
      native_ids: compactObject({
        customer_app_order_id: nativeRow?.customer_app_order_id || null,
        native_shopify_order_id: nativeRow?.native_shopify_order_id || null,
        native_fulfillment_task_id: nativeRow?.native_fulfillment_task_id || null,
        production_batch_id: nativeRow?.production_batch_id || null,
      }),
      hub_ids: compactObject({
        hub_order_id: hubRow?.hub_order_id || null,
        hub_task_id: hubRow?.hub_task_id || null,
      }),
      comparable_fields: compactObject({
        native: nativeRow ? g39bProjectComparable(nativeRow, surface) : null,
        hub: hubRow ? g39bProjectComparable(hubRow, surface) : null,
      }),
      mismatches: comparison.mismatches,
      data_source: nativeRow && hubRow ? 'native_and_hub_fallback' : nativeRow ? 'native_only' : 'hub_fallback_only',
      fallback_source: nativeRow?.fallback_source || hubRow?.fallback_source || null,
    });
  }
  return rows.slice(0, maxRows);
}

function g39bProjectComparable(row, surface) {
  const out = {};
  for (const field of g39bComparableFieldsForSurface(surface)) {
    if (row?.[field] !== undefined && row?.[field] !== null) out[field] = row[field];
  }
  if (row?.route_drop_presence !== undefined) out.route_drop_presence = row.route_drop_presence;
  if (row?.proof_presence !== undefined) out.proof_presence = row.proof_presence;
  if (row?.data_source) out.data_source = row.data_source;
  return out;
}

function g39bCountClassifications(rows) {
  const counts = {};
  for (const row of rows || []) counts[row.classification] = (counts[row.classification] || 0) + 1;
  return counts;
}

function g39bSurfaceReadiness({ surface, parityRows, nativeRecordCount, hubRecordCount, requiredNativeFields = [] }) {
  const counts = g39bCountClassifications(parityRows);
  const mismatchCount = counts.native_hub_mismatch || 0;
  const nativeMissingCount = counts.native_missing_hub_available || 0;
  const staleCount = counts.stale_hub_fallback_detected || 0;
  const hubOnly = hubRecordCount > 0 && nativeRecordCount === 0;
  if (surface === 'resources') {
    return {
      cutover_readiness: hubOnly ? 'hub_source_of_truth_for_now' : 'preview_only_more_fields_needed',
      risk_level: 'medium',
      recommended_patch_scope: 'keep_hub_fallback_reporting_until_team_and_equipment_native_fields_are_proven',
      required_native_fields: requiredNativeFields,
      required_ui_copy: 'Show native resource summary with explicit Hub fallback status before replacing Hub-primary resources.',
    };
  }
  if (nativeMissingCount > 0 || hubOnly) {
    return {
      cutover_readiness: 'ready_with_fallback_reporting',
      risk_level: 'medium',
      recommended_patch_scope: 'native_first_read_with_visible_hub_fallback_counts_not_customer_facing',
      required_native_fields: requiredNativeFields,
      required_ui_copy: 'Surface Hub fallback counts and mismatch warnings in admin-only context.',
    };
  }
  if (mismatchCount > 0 || staleCount > 0) {
    return {
      cutover_readiness: 'preview_only_more_fields_needed',
      risk_level: 'medium',
      recommended_patch_scope: 'resolve_mismatches_or_add_fallback_reporting_before_native_first_patch',
      required_native_fields: requiredNativeFields,
      required_ui_copy: 'Do not hide Hub mismatch/stale fallback rows.',
    };
  }
  return {
    cutover_readiness: nativeRecordCount > 0 ? 'ready_for_native_first_patch' : 'preview_only_more_fields_needed',
    risk_level: nativeRecordCount > 0 ? 'low' : 'medium',
    recommended_patch_scope: nativeRecordCount > 0 ? 'lowest_risk_admin_native_first_read_patch' : 'collect_more_native_rows_before_patch',
    required_native_fields: requiredNativeFields,
    required_ui_copy: 'Admin-only native-first read with Hub fallback reporting.',
  };
}

function g39bBuildSurfaceResult({ surface, nativeRows, hubRows, requiredNativeFields = [], extraWarnings = [] }) {
  const parityRows = g39bBuildParityRows({ surface, nativeRows, hubRows, maxRows: G39B_MAX_ROWS });
  const counts = g39bCountClassifications(parityRows);
  const readiness = g39bSurfaceReadiness({ surface, parityRows, nativeRecordCount: nativeRows.length, hubRecordCount: hubRows.length, requiredNativeFields });
  const audit = G39B_ADMIN_SURFACE_AUDIT[surface] || {};
  return {
    surface,
    function_name: audit.function_name || null,
    admin_page_dependency: audit.admin_page_dependency || null,
    admin_only: audit.admin_only !== false,
    customer_facing: false,
    read_only: true,
    currently_reads_native_data: audit.reads_native_data === true,
    currently_reads_hub_data: audit.reads_hub_data === true,
    current_hub_role: audit.hub_role || 'unknown_needs_manual_review',
    native_replacement_status: audit.native_replacement_status || 'unknown_needs_manual_review',
    native_record_count: nativeRows.length,
    hub_record_count: hubRows.length,
    exact_match_count: counts.native_hub_match || 0,
    native_missing_count: counts.native_missing_hub_available || 0,
    hub_only_count: counts.native_missing_hub_available || 0,
    native_only_count: counts.native_present_hub_missing || 0,
    mismatch_count: counts.native_hub_mismatch || 0,
    fallback_required_count: (counts.native_missing_hub_available || 0) + (counts.stale_hub_fallback_detected || 0),
    stale_hub_fallback_count: counts.stale_hub_fallback_detected || 0,
    classifications: Object.keys(counts).sort(),
    rows: parityRows,
    blockers: [],
    warnings: [...new Set(extraWarnings)],
    ...readiness,
  };
}

function g39bBuildDeliveryRows({ tasks, orders, lookup }) {
  const nativeRows = [];
  const hubRows = [];
  const orderByNumber = new Map();
  for (const order of orders || []) {
    const key = g39bOrderKey(g39bFirstValue(order, ['order_number', 'shopify_order_number', 'source_order_number']));
    if (key && !orderByNumber.has(key)) orderByNumber.set(key, order);
  }
  for (const task of tasks || []) {
    const orderNumber = normalizeOrderNumber(g39bFirstValue(task, ['order_number', 'shopify_order_number', 'source_order_number']));
    const key = g39bOrderKey(orderNumber);
    if (!key) continue;
    const order = orderByNumber.get(key) || null;
    const nativeDeliveryDate = g39bSafeDate(task, ['assigned_delivery_date', 'scheduled_date', 'delivery_date']) || g39bSafeDate(order, ['delivery_date', 'scheduled_date']);
    const hubDeliveryDate = g39bSafeDate(task, ['hub_delivery_date']) || g39bSafeDate(order, ['hub_delivery_date']);
    nativeRows.push({
      parity_key: key,
      order_number: sanitizeText(orderNumber, 80),
      customer_app_order_id: sanitizeText(task?.base44_order_id || task?.order_id || order?.id, 100),
      native_fulfillment_task_id: g39bEntityId(task),
      delivery_date: nativeDeliveryDate,
      scheduled_date: g39bSafeDate(task, ['scheduled_date']),
      assigned_delivery_date: g39bSafeDate(task, ['assigned_delivery_date']),
      task_status: g39bSafeStatus(task, ['status']),
      delivery_status: g39bSafeStatus(task, ['delivery_status']),
      production_status: g39bSafeStatus(task, ['production_status']),
      route_drop_presence: Boolean(task?.drop_id || task?.route_id || task?.delivery_route_id),
      proof_presence: Boolean(task?.proof_id || task?.proof_status || task?.delivery_proof_present),
      fallback_source: 'native_fulfillment_task',
      data_source: 'native',
    });
    if (g39bHasHubContext(task) || hubDeliveryDate) {
      hubRows.push({
        parity_key: key,
        order_number: sanitizeText(orderNumber, 80),
        customer_app_order_id: sanitizeText(task?.base44_order_id || task?.order_id || order?.id, 100),
        hub_task_id: sanitizeText(g39bFirstValue(task, ['hub_task_id', 'hub_fulfillment_task_id']), 100),
        delivery_date: hubDeliveryDate || nativeDeliveryDate,
        task_status: g39bSafeStatus(task, ['hub_task_status', 'status']),
        delivery_status: g39bSafeStatus(task, ['hub_delivery_status', 'delivery_status']),
        production_status: g39bSafeStatus(task, ['hub_production_status', 'production_status']),
        route_drop_presence: Boolean(task?.hub_drop_id || task?.hub_route_id || task?.drop_id || task?.route_id),
        proof_presence: Boolean(task?.hub_proof_present || task?.delivery_proof_present),
        stale_hub_fallback: Boolean(nativeDeliveryDate && hubDeliveryDate && nativeDeliveryDate !== hubDeliveryDate),
        fallback_source: 'hub_delivery_task_context',
        data_source: 'hub_fallback',
      });
    }
  }
  for (const order of orders || []) {
    if (!g39bHasHubContext(order) || !(order?.hub_task_id || order?.hub_delivery_date)) continue;
    const orderNumber = normalizeOrderNumber(g39bFirstValue(order, ['order_number', 'shopify_order_number', 'source_order_number']));
    const key = g39bOrderKey(orderNumber);
    if (!key || hubRows.some(row => row.parity_key === key)) continue;
    hubRows.push({
      parity_key: key,
      order_number: sanitizeText(orderNumber, 80),
      customer_app_order_id: g39bEntityId(order),
      hub_task_id: sanitizeText(g39bFirstValue(order, ['hub_task_id']), 100),
      delivery_date: g39bSafeDate(order, ['hub_delivery_date', 'delivery_date']),
      task_status: g39bSafeStatus(order, ['hub_task_status', 'status']),
      delivery_status: g39bSafeStatus(order, ['hub_delivery_status', 'delivery_status']),
      production_status: g39bSafeStatus(order, ['hub_production_status', 'production_status']),
      route_drop_presence: Boolean(order?.hub_drop_id || order?.hub_route_id),
      proof_presence: Boolean(order?.hub_proof_present),
      stale_hub_fallback: false,
      fallback_source: 'hub_delivery_order_context',
      data_source: 'hub_fallback',
    });
  }
  return {
    nativeRows: g39bTakeRows(nativeRows, lookup, ['delivery_date', 'scheduled_date', 'assigned_delivery_date']),
    hubRows: g39bTakeRows(hubRows, lookup, ['delivery_date']),
  };
}

function g39bBuildProductionRows({ orders, nativeOrders, batches, lookup }) {
  const batchCountByOrder = new Map();
  for (const batch of batches || []) {
    const key = g39bOrderKey(g39bFirstValue(batch, ['order_number', 'shopify_order_number', 'source_order_number']));
    if (!key) continue;
    batchCountByOrder.set(key, (batchCountByOrder.get(key) || 0) + 1);
  }
  const nativeRows = [];
  const hubRows = [];
  for (const order of orders || []) {
    const orderNumber = normalizeOrderNumber(g39bFirstValue(order, ['order_number', 'shopify_order_number', 'source_order_number']));
    const key = g39bOrderKey(orderNumber);
    if (!key) continue;
    const batchCount = batchCountByOrder.get(key) || 0;
    nativeRows.push({
      parity_key: key,
      order_number: sanitizeText(orderNumber, 80),
      customer_app_order_id: g39bEntityId(order),
      production_date: g39bSafeDate(order, ['production_date', 'delivery_date']),
      production_status: g39bSafeStatus(order, ['production_status', 'status']),
      product_demand_count: g39bProductDemandCount(order),
      native_production_batch_count: batchCount,
      production_batch_id: batchCount === 1 ? g39bEntityId((batches || []).find(batch => g39bOrderKey(g39bFirstValue(batch, ['order_number', 'shopify_order_number', 'source_order_number'])) === key)) : null,
      fallback_source: batchCount ? 'native_production_batch' : 'native_order_demand_without_batch',
      data_source: 'native',
    });
    if (g39bHasHubContext(order)) {
      hubRows.push({
        parity_key: key,
        order_number: sanitizeText(orderNumber, 80),
        customer_app_order_id: g39bEntityId(order),
        hub_order_id: sanitizeText(g39bFirstValue(order, ['hub_order_id']), 100),
        production_date: g39bSafeDate(order, ['hub_production_date', 'production_date', 'delivery_date']),
        production_status: g39bSafeStatus(order, ['hub_production_status', 'production_status', 'status']),
        product_demand_count: g39bProductDemandCount(order),
        native_production_batch_count: batchCount,
        fallback_source: 'hub_order_production_context',
        data_source: 'hub_fallback',
      });
    }
  }
  for (const nativeOrder of nativeOrders || []) {
    const orderNumber = normalizeOrderNumber(g39bFirstValue(nativeOrder, ['shopify_order_number', 'order_number', 'source_order_number']));
    const key = g39bOrderKey(orderNumber);
    if (!key || nativeRows.some(row => row.parity_key === key)) continue;
    const batchCount = batchCountByOrder.get(key) || 0;
    nativeRows.push({
      parity_key: key,
      order_number: sanitizeText(orderNumber, 80),
      customer_app_order_id: sanitizeText(nativeOrder?.base44_order_id, 100),
      production_date: g39bSafeDate(nativeOrder, ['production_date', 'delivery_date']),
      production_status: g39bSafeStatus(nativeOrder, ['production_status']),
      product_demand_count: g39bProductDemandCount(nativeOrder),
      native_production_batch_count: batchCount,
      production_batch_id: null,
      fallback_source: 'native_shopify_order_production_context',
      data_source: 'native',
    });
  }
  return {
    nativeRows: g39bTakeRows(nativeRows, lookup, ['production_date']),
    hubRows: g39bTakeRows(hubRows, lookup, ['production_date']),
  };
}

function g39bBuildAggregateRows({ surface, records, lookup }) {
  const safeRecords = records || {};
  const nativeCount = Object.values(safeRecords).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
  const hubCount = Object.values(safeRecords).reduce((sum, rows) => sum + (Array.isArray(rows) ? rows.filter(g39bHasHubContext).length : 0), 0);
  const nativeRows = nativeCount ? [{
    parity_key: surface,
    order_number: null,
    order_status: 'aggregate_native_context_present',
    line_item_count: nativeCount,
    fallback_source: 'native_aggregate_counts',
    data_source: 'native',
  }] : [];
  const hubRows = hubCount ? [{
    parity_key: surface,
    order_number: null,
    order_status: 'aggregate_hub_context_present',
    line_item_count: hubCount,
    fallback_source: 'local_hub_fallback_aggregate_counts',
    data_source: 'hub_fallback',
  }] : [];
  return {
    nativeRows: g39bTakeRows(nativeRows, lookup, []),
    hubRows: g39bTakeRows(hubRows, lookup, []),
  };
}

async function buildG39BPreview(base44, body) {
  const lookup = g39bLookup(body);
  if (lookup.surface === 'unsupported') {
    const customerFacingHold = normalizeLower(lookup.rawSurface).startsWith('customer');
    return {
      success: false,
      dry_run: true,
      writes_performed: false,
      preview_mode: G39B_PREVIEW_MODE,
      surface: sanitizeText(lookup.rawSurface, 80),
      error_code: customerFacingHold ? 'customer_facing_surface_not_in_scope' : 'unsupported_surface',
      supported_surfaces: ['all', ...G39B_SURFACES],
      classifications: customerFacingHold ? ['customer_facing_hold'] : ['unknown_needs_manual_review'],
      cutover_readiness: customerFacingHold ? 'unsafe_customer_facing' : 'preview_only_more_fields_needed',
      provider_call_impact: false,
      notifications_sent: false,
      hub_mutation_performed: false,
      pii_returned: false,
      blockers: [customerFacingHold ? 'customer_facing_surface_not_in_scope' : 'unsupported_surface'],
      warnings: customerFacingHold ? ['customer_facing_reads_require_separate_parity_proof'] : [],
      safety: G33C_READ_ONLY_SAFETY,
    };
  }

  const readLimit = Math.max(lookup.maxRows * 5, 50);
  const [orders, nativeOrders, tasks, batches, reviewRows, syncRows, parityRows, alerts, complianceAlerts, recipes, inventoryItems, yields, events, sanitationLogs, temperatureLogs, dailyChecklists, correctiveActions, complianceLogs] = await Promise.all([
    g39bReadRows(base44, 'Order', readLimit),
    g39bReadRows(base44, 'ShopifyOrder', readLimit),
    g39bReadRows(base44, 'FulfillmentTask', readLimit),
    g39bReadRows(base44, 'ProductionBatch', readLimit),
    g39bReadRows(base44, 'OrderReviewQueue', readLimit),
    g39bReadRows(base44, 'OrderSyncLog', readLimit),
    g39bReadRows(base44, 'SafeSyncParityLog', readLimit),
    g39bReadRows(base44, 'OperationalAlert', readLimit),
    g39bReadRows(base44, 'ComplianceAlert', readLimit),
    g39bReadRows(base44, 'Recipe', readLimit),
    g39bReadRows(base44, 'InventoryItem', readLimit),
    g39bReadRows(base44, 'IngredientYield', readLimit),
    g39bReadRows(base44, 'Event', readLimit),
    g39bReadRows(base44, 'SanitationLog', readLimit),
    g39bReadRows(base44, 'TemperatureLog', readLimit),
    g39bReadRows(base44, 'DailyChecklist', readLimit),
    g39bReadRows(base44, 'CorrectiveActionLog', readLimit),
    g39bReadRows(base44, 'BatchComplianceLog', readLimit),
  ]);

  const surfaces = lookup.surface === 'all' ? G39B_SURFACES : [lookup.surface];
  const surfaceResults = [];
  const warnings = ['external_hub_not_called_local_native_and_hub_fallback_context_only'];
  for (const surface of surfaces) {
    if (surface === 'admin_orders') {
      const nativeRows = g39bBuildNativeOrderRows({ orders, nativeOrders, tasks, lookup });
      const hubRows = g39bBuildHubOrderRows({ orders, orderSyncLogs: syncRows, parityLogs: parityRows, lookup });
      surfaceResults.push(g39bBuildSurfaceResult({
        surface,
        nativeRows,
        hubRows,
        requiredNativeFields: ['order_number', 'payment_status', 'payment_captured', 'fulfillment_type', 'production_status', 'delivery_status'],
      }));
      continue;
    }
    if (surface === 'delivery_route_summary') {
      const rows = g39bBuildDeliveryRows({ tasks, orders, lookup });
      surfaceResults.push(g39bBuildSurfaceResult({
        surface,
        nativeRows: rows.nativeRows,
        hubRows: rows.hubRows,
        requiredNativeFields: ['native_fulfillment_task_id', 'delivery_date', 'scheduled_date', 'assigned_delivery_date', 'delivery_status', 'route_or_drop_presence'],
      }));
      continue;
    }
    if (surface === 'production_planning') {
      const rows = g39bBuildProductionRows({ orders, nativeOrders, batches, lookup });
      surfaceResults.push(g39bBuildSurfaceResult({
        surface,
        nativeRows: rows.nativeRows,
        hubRows: rows.hubRows,
        requiredNativeFields: ['production_date', 'product_demand_count', 'production_status', 'native_production_batch_count', 'master_data_readiness'],
      }));
      continue;
    }
    if (surface === 'ops_alerts') {
      const rows = g39bBuildAggregateRows({ surface, records: { reviewRows, syncRows, parityRows, alerts, complianceAlerts }, lookup });
      surfaceResults.push(g39bBuildSurfaceResult({
        surface,
        nativeRows: rows.nativeRows,
        hubRows: rows.hubRows,
        requiredNativeFields: ['OrderReviewQueue', 'OperationalAlert', 'ComplianceAlert', 'SafeSyncParityLog'],
      }));
      continue;
    }
    if (surface === 'operations_dashboard') {
      const rows = g39bBuildAggregateRows({ surface, records: { orders, nativeOrders, tasks, batches, reviewRows, alerts, complianceAlerts }, lookup });
      surfaceResults.push(g39bBuildSurfaceResult({
        surface,
        nativeRows: rows.nativeRows,
        hubRows: rows.hubRows,
        requiredNativeFields: ['orders', 'native_shopify_orders', 'fulfillment_tasks', 'production_batches', 'alerts'],
      }));
      continue;
    }
    if (surface === 'resources') {
      const rows = g39bBuildAggregateRows({ surface, records: { recipes, inventoryItems, yields, batches }, lookup });
      surfaceResults.push(g39bBuildSurfaceResult({
        surface,
        nativeRows: rows.nativeRows,
        hubRows: rows.hubRows,
        requiredNativeFields: ['team_members', 'equipment', 'recipes', 'inventory_items', 'ingredient_yields'],
        extraWarnings: ['resources_surface_still_needs_team_and_equipment_native_field_parity'],
      }));
      continue;
    }
    if (surface === 'calendar_events') {
      const rows = g39bBuildAggregateRows({ surface, records: { events, tasks, batches, sanitationLogs, temperatureLogs, dailyChecklists, correctiveActions, complianceLogs }, lookup });
      surfaceResults.push(g39bBuildSurfaceResult({
        surface,
        nativeRows: rows.nativeRows,
        hubRows: rows.hubRows,
        requiredNativeFields: ['event_date', 'delivery_date', 'production_date', 'compliance_log_dates'],
      }));
    }
  }

  const summary = g39bSummarizeSurfaces(surfaceResults);
  const nativeFirstCandidates = surfaceResults
    .filter(result => ['ready_for_native_first_patch', 'ready_with_fallback_reporting'].includes(result.cutover_readiness))
    .map(result => ({ surface: result.surface, cutover_readiness: result.cutover_readiness, risk_level: result.risk_level }));
  const blockedSurfaces = surfaceResults
    .filter(result => !['ready_for_native_first_patch', 'ready_with_fallback_reporting'].includes(result.cutover_readiness))
    .map(result => ({ surface: result.surface, cutover_readiness: result.cutover_readiness, risk_level: result.risk_level }));

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    preview_mode: G39B_PREVIEW_MODE,
    request_id: lookup.requestId,
    surfaces_checked: surfaces,
    surface_audit: surfaces.map(surface => ({ surface, ...G39B_ADMIN_SURFACE_AUDIT[surface] })),
    parity_summary: summary,
    surface_results: surfaceResults,
    native_record_counts: summary.native_record_counts,
    hub_record_counts: summary.hub_record_counts,
    exact_match_count: summary.exact_match_count,
    native_missing_count: summary.native_missing_count,
    hub_only_count: summary.hub_only_count,
    native_only_count: summary.native_only_count,
    mismatch_count: summary.mismatch_count,
    fallback_required_count: summary.fallback_required_count,
    stale_hub_fallback_count: summary.stale_hub_fallback_count,
    pii_returned: false,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    blockers: [],
    warnings: [...new Set(warnings)],
    native_first_candidate_surfaces: nativeFirstCandidates,
    blocked_surfaces: blockedSurfaces,
    next_action: nativeFirstCandidates.length
      ? 'plan_g39c_native_first_admin_patch_for_lowest_risk_surface'
      : 'hold_missing_native_parity_fields',
    safety: G33C_READ_ONLY_SAFETY,
  };
}

function g39bSummarizeSurfaces(surfaceResults) {
  const summary = {
    native_record_counts: {},
    hub_record_counts: {},
    exact_match_count: 0,
    native_missing_count: 0,
    hub_only_count: 0,
    native_only_count: 0,
    mismatch_count: 0,
    fallback_required_count: 0,
    stale_hub_fallback_count: 0,
    ready_for_native_first_patch_count: 0,
    ready_with_fallback_reporting_count: 0,
    blocked_or_preview_only_count: 0,
  };
  for (const result of surfaceResults || []) {
    summary.native_record_counts[result.surface] = result.native_record_count;
    summary.hub_record_counts[result.surface] = result.hub_record_count;
    summary.exact_match_count += result.exact_match_count || 0;
    summary.native_missing_count += result.native_missing_count || 0;
    summary.hub_only_count += result.hub_only_count || 0;
    summary.native_only_count += result.native_only_count || 0;
    summary.mismatch_count += result.mismatch_count || 0;
    summary.fallback_required_count += result.fallback_required_count || 0;
    summary.stale_hub_fallback_count += result.stale_hub_fallback_count || 0;
    if (result.cutover_readiness === 'ready_for_native_first_patch') summary.ready_for_native_first_patch_count += 1;
    else if (result.cutover_readiness === 'ready_with_fallback_reporting') summary.ready_with_fallback_reporting_count += 1;
    else summary.blocked_or_preview_only_count += 1;
  }
  return summary;
}

async function g33cCustomerOrders(base44, lookup) {
  const rows = [];
  if (lookup.customerAppOrderId) {
    const byId = await g33cFilter(base44, 'Order', { id: lookup.customerAppOrderId }, '-created_date', 1, { retryEmpty: true });
    rows.push(...(Array.isArray(byId) ? byId : []));
  }
  if (lookup.orderNumber) {
    rows.push(...await g33cFilter(base44, 'Order', { order_number: lookup.orderNumber }, '-created_date', 10, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'Order', { order_number: `#${lookup.orderNumber}` }, '-created_date', 10, { retryEmpty: true }));
  }
  return g33cUnique(rows);
}

async function g33cNativeOrders(base44, orderNumber, customerOrderId) {
  const rows = [];
  if (customerOrderId) rows.push(...await g33cFilter(base44, 'ShopifyOrder', { base44_order_id: customerOrderId }, '-created_date', 10, { retryEmpty: true }));
  if (orderNumber) {
    rows.push(...await g33cFilter(base44, 'ShopifyOrder', { shopify_order_number: orderNumber }, '-created_date', 10, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'ShopifyOrder', { shopify_order_number: `#${orderNumber}` }, '-created_date', 10, { retryEmpty: true }));
  }
  return g33cUnique(rows).filter(row => g33cMatchesOrder(row, orderNumber, customerOrderId));
}

async function g33cTasks(base44, orderNumber, customerOrderId, nativeOrderId, taskId = '') {
  const rows = [];
  if (taskId) rows.push(...await g33cFilter(base44, 'FulfillmentTask', { id: taskId }, '-created_date', 5, { retryEmpty: true }));
  if (customerOrderId) {
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { base44_order_id: customerOrderId }, '-created_date', 20, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { order_id: customerOrderId }, '-created_date', 20, { retryEmpty: true }));
  }
  if (nativeOrderId) {
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { native_shopify_order_id: nativeOrderId }, '-created_date', 20, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { shopify_order_id: nativeOrderId }, '-created_date', 20, { retryEmpty: true }));
  }
  if (orderNumber) {
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { order_number: orderNumber }, '-created_date', 20, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { shopify_order_number: orderNumber }, '-created_date', 20, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { shopify_order_number: `#${orderNumber}` }, '-created_date', 20, { retryEmpty: true }));
  }
  return g33cUnique(rows).filter(row => (taskId && normalizeText(row?.id) === taskId) || g33cMatchesOrder(row, orderNumber, customerOrderId) || (nativeOrderId && [row?.native_shopify_order_id, row?.shopify_order_id].includes(nativeOrderId)));
}

async function g33cLogs(base44, entityName, orderNumber, customerOrderId, limit = 20) {
  const rows = [];
  if (customerOrderId) {
    rows.push(...await g33cFilter(base44, entityName, { base44_order_id: customerOrderId }, '-created_date', limit));
    rows.push(...await g33cFilter(base44, entityName, { order_id: customerOrderId }, '-created_date', limit));
    rows.push(...await g33cFilter(base44, entityName, { customer_app_order_id: customerOrderId }, '-created_date', limit));
  }
  if (orderNumber) {
    rows.push(...await g33cFilter(base44, entityName, { order_number: orderNumber }, '-created_date', limit));
    rows.push(...await g33cFilter(base44, entityName, { shopify_order_number: orderNumber }, '-created_date', limit));
    rows.push(...await g33cFilter(base44, entityName, { source_order_number: orderNumber }, '-created_date', limit));
  }
  return g33cUnique(rows).filter(row => g33cMatchesOrder(row, orderNumber, customerOrderId));
}

async function g33cBatches(base44, orderNumber, customerOrderId, nativeOrderId, taskId) {
  const rows = await g33cList(base44, 'ProductionBatch', '-production_date', 800);
  return rows.filter(batch => {
    if (customerOrderId && [batch?.base44_order_id, batch?.order_id, batch?.source_order_id].includes(customerOrderId)) return true;
    if (nativeOrderId && [batch?.native_shopify_order_id, batch?.shopify_order_id].includes(nativeOrderId)) return true;
    if (taskId && [batch?.native_fulfillment_task_id, batch?.fulfillment_task_id].includes(taskId)) return true;
    return g33cMatchesOrder(batch, orderNumber, customerOrderId);
  });
}

async function g33cComplianceLogs(base44, batches) {
  const rows = [];
  for (const batch of batches || []) {
    if (batch?.batch_id) rows.push(...await g33cFilter(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 10));
    if (batch?.id) rows.push(...await g33cFilter(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 10));
  }
  return g33cUnique(rows);
}

function g33cStatuses(rows) {
  const statuses = [...new Set((rows || []).map(row => sanitizeText(row?.status || row?.sync_status || row?.review_status || row?.result_status || row?.error_code || row?.action, 120)).filter(Boolean))];
  return { count: Array.isArray(rows) ? rows.length : 0, statuses: statuses.slice(0, 8), latest_status: statuses[0] || null };
}

function g33cPaid(order, nativeOrder) {
  return order?.payment_captured === true || paymentStatus(order) === 'paid' || normalizeLower(nativeOrder?.payment_status || nativeOrder?.financial_status) === 'paid';
}

function g33cCancelledOrRefunded(order, nativeOrder) {
  const values = [order?.status, order?.payment_status, order?.financial_status, nativeOrder?.fulfillment_status, nativeOrder?.production_status, nativeOrder?.financial_status, nativeOrder?.payment_status].map(normalizeLower);
  return Boolean(order?.canceled_at || order?.deleted_at || order?.do_not_recover) ||
    values.some(value => ['cancelled', 'canceled', 'refunded', 'partially_refunded', 'voided'].includes(value));
}

function g33cOrderType(order, nativeOrder, task) {
  const nativeType = normalizeLower(nativeOrder?.order_type || nativeOrder?.source_type || task?.order_type || task?.source_type);
  if (nativeType) return nativeType;
  if (normalizeLower(nativeOrder?.source_channel) === 'subscription' || nativeOrder?.is_subscription) return 'subscription';
  return 'one_time';
}

function g33cSubscriptionOrMulti(nativeOrder, task) {
  return normalizeLower(nativeOrder?.order_type || nativeOrder?.source_type || task?.order_type || task?.source_type) === 'subscription' ||
    normalizeLower(nativeOrder?.fulfillment_mode) === 'multi_delivery' ||
    normalizeLower(task?.fulfillment_type) === 'subscription_delivery' ||
    Boolean(nativeOrder?.is_subscription || nativeOrder?.stripe_subscription_id || task?.stripe_subscription_id || task?.customer_app_subscription_id);
}

function g33cAlreadyComplete(order, nativeOrder, task) {
  const customerStatus = normalizeLower(order?.status);
  const nativeFulfillmentStatus = normalizeLower(nativeOrder?.fulfillment_status || nativeOrder?.shopify_fulfillment_status);
  const taskStatus = normalizeLower(task?.status);
  const taskDeliveryStatus = normalizeLower(task?.delivery_status);
  return ['delivered', 'fulfilled', 'completed'].includes(customerStatus) ||
    (['fulfilled', 'delivered', 'completed'].includes(nativeFulfillmentStatus) && ['delivered', 'completed'].includes(taskStatus) && ['delivered', 'completed'].includes(taskDeliveryStatus));
}

function g33cReviewBlocker(rows) {
  return (rows || []).some(row => {
    const status = normalizeLower(row?.status || row?.review_status || row?.resolution_status);
    return !status || !['resolved', 'closed', 'ignored', 'safe', 'deduped', 'not_applicable', 'test_only'].includes(status);
  });
}

function g33cClassification({ customerOrder, nativeOrder, task, customerOrders, nativeOrders, tasks, reviewRows }) {
  const blockers = [];
  const warnings = [];
  const paid = g33cPaid(customerOrder, nativeOrder);
  const cancelled = g33cCancelledOrRefunded(customerOrder, nativeOrder);
  const fulfillType = fulfillmentMethod(customerOrder) || normalizeLower(nativeOrder?.fulfillment_method || task?.fulfillment_type);
  const items = lineItemCount(customerOrder) || (Array.isArray(nativeOrder?.line_items) ? nativeOrder.line_items.length : 0) || (Array.isArray(task?.items) ? task.items.length : 0) || safeNumber(nativeOrder?.line_item_count || task?.line_item_count, 0);
  const duplicateRisks = [];
  if ((customerOrders || []).length > 1) duplicateRisks.push('multiple_customer_app_orders_match');
  if ((nativeOrders || []).length > 1) duplicateRisks.push('multiple_native_shopify_orders_match');
  if ((tasks || []).length > 1) duplicateRisks.push('multiple_native_fulfillment_tasks_match');
  const reviewBlocker = g33cReviewBlocker(reviewRows);

  if (!customerOrder?.id) blockers.push('customer_app_order_missing');
  if (!paid) blockers.push('payment_not_paid_or_captured');
  if (cancelled) blockers.push('cancelled_or_refunded');
  if (g33cSubscriptionOrMulti(nativeOrder, task)) blockers.push('subscription_or_multi_delivery_not_supported');
  if (!items) blockers.push('missing_line_items');
  if (!['delivery', 'pickup'].includes(fulfillType)) blockers.push('ambiguous_delivery_or_pickup_classification');
  if (reviewBlocker) blockers.push('order_review_queue_blocker');
  blockers.push(...duplicateRisks);

  if (!nativeOrder?.id) warnings.push('native_shopify_order_missing_mirror_preview_required');
  if (!task?.id) warnings.push('native_fulfillment_task_missing_task_preview_required');

  let classification = 'eligible_next_one_time_order_candidate';
  if (!customerOrder?.id) classification = 'insufficient_data';
  else if (!paid) classification = 'pending_payment_do_not_process';
  else if (cancelled) classification = 'cancelled_or_refunded';
  else if (g33cSubscriptionOrMulti(nativeOrder, task)) classification = 'unsupported_subscription_or_multi_delivery';
  else if (duplicateRisks.length) classification = 'duplicate_or_deduped';
  else if (reviewBlocker) classification = 'needs_review';
  else if (g33cAlreadyComplete(customerOrder, nativeOrder, task)) classification = 'no_action_needed_already_native_complete';
  else if (!items || !['delivery', 'pickup'].includes(fulfillType)) classification = 'insufficient_data';
  else if (!nativeOrder?.id) classification = 'paid_but_native_mirror_missing';
  else if (!task?.id) classification = 'paid_but_task_missing';

  return { eligible: classification === 'eligible_next_one_time_order_candidate', classification, blockers, warnings, duplicateRisks };
}

function g33cNextAction(classification, eligible) {
  if (eligible) return 'run_g33d_second_exact_controlled_pilot_approval_packet';
  if (classification === 'paid_but_native_mirror_missing') return 'run_native_mirror_parity_preview_only';
  if (classification === 'paid_but_task_missing') return 'run_native_task_materialization_preview_only';
  if (classification === 'pending_payment_do_not_process') return 'wait_for_payment_capture';
  if (classification === 'needs_review') return 'resolve_order_review_queue_before_pilot';
  if (classification === 'insufficient_data') return 'collect_exact_order_identity_and_rerun_preview';
  if (classification === 'duplicate_or_deduped') return 'resolve_duplicate_risk_before_pilot';
  if (classification === 'unsupported_subscription_or_multi_delivery') return 'hold_for_subscription_or_multi_delivery_workflow';
  if (classification === 'cancelled_or_refunded') return 'no_action_cancelled_or_refunded';
  if (classification === 'no_action_needed_already_native_complete') return 'no_action_already_native_complete';
  return 'wait_for_next_natural_paid_one_time_order';
}

async function g33cCandidateRow(base44, seed) {
  const seedOrderNumber = normalizeOrderNumber(seed?.order_number || seed?.shopify_order_number || seed?.orderNumber);
  const seedCustomerOrderId = normalizeText(seed?.customer_app_order_id || seed?.base44_order_id || seed?.order_id || seed?.id);
  const lookup = { orderNumber: seedOrderNumber, customerAppOrderId: seedCustomerOrderId };
  const customerOrders = seed?.__entity === 'Order' && seed?.id ? g33cUnique([seed, ...await g33cCustomerOrders(base44, lookup)]) : await g33cCustomerOrders(base44, lookup);
  const customerOrder = customerOrders[0] || null;
  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || seedOrderNumber);
  const customerOrderId = normalizeText(customerOrder?.id || seedCustomerOrderId);
  const nativeOrders = await g33cNativeOrders(base44, orderNumber, customerOrderId);
  const nativeOrder = nativeOrders[0] || null;
  const tasks = await g33cTasks(base44, orderNumber, customerOrderId, nativeOrder?.id);
  const task = tasks[0] || null;
  const [orderSyncRows, reviewRows, commandRows, parityRows] = await Promise.all([
    g33cLogs(base44, 'OrderSyncLog', orderNumber, customerOrderId, 20),
    g33cLogs(base44, 'OrderReviewQueue', orderNumber, customerOrderId, 20),
    g33cLogs(base44, 'CommandLog', orderNumber, customerOrderId, 20),
    g33cLogs(base44, 'SafeSyncParityLog', orderNumber, customerOrderId, 20),
  ]);
  const batches = await g33cBatches(base44, orderNumber, customerOrderId, nativeOrder?.id, task?.id);
  const complianceLogs = await g33cComplianceLogs(base44, batches);
  const classification = g33cClassification({ customerOrder, nativeOrder, task, customerOrders, nativeOrders, tasks, reviewRows });
  const batchCount = batches.length;
  const verifiedBatchCount = batches.filter(batch => normalizeLower(batch?.status || batch?.lifecycle_status || batch?.production_status) === 'verified_logged').length;
  const taskStatus = normalizeLower(task?.status);
  const taskDeliveryStatus = normalizeLower(task?.delivery_status);
  const nativeProductionStatus = normalizeLower(nativeOrder?.production_status);
  const nativeFulfillmentStatus = normalizeLower(nativeOrder?.fulfillment_status);
  const lineItems = lineItemCount(customerOrder) || (Array.isArray(nativeOrder?.line_items) ? nativeOrder.line_items.length : 0) || safeNumber(nativeOrder?.line_item_count || task?.line_item_count, 0);
  const fulfillType = fulfillmentMethod(customerOrder) || normalizeLower(nativeOrder?.fulfillment_method || task?.fulfillment_type);

  return {
    order_number: orderNumber || seedOrderNumber || null,
    customer_app_order_id: customerOrderId || null,
    native_shopify_order_id: nativeOrder?.id || null,
    native_fulfillment_task_id: task?.id || null,
    hub_order_id: null,
    hub_task_id: null,
    hub_order_present: null,
    hub_task_present: null,
    hub_context_status: 'derived_from_local_bridge_context_only',
    customer_app_order_present: Boolean(customerOrder?.id),
    payment_status: sanitizeText(customerOrder?.payment_status || customerOrder?.financial_status || nativeOrder?.payment_status || nativeOrder?.financial_status, 80),
    payment_captured: customerOrder?.payment_captured === true,
    is_paid: g33cPaid(customerOrder, nativeOrder),
    order_status: sanitizeText(customerOrder?.status || nativeOrder?.order_status, 80),
    order_type: g33cOrderType(customerOrder, nativeOrder, task),
    source_type: sanitizeText(nativeOrder?.source_type || task?.source_type || customerOrder?.source_type, 80),
    fulfillment_type: fulfillType || null,
    delivery_or_pickup_date: sanitizeText(customerOrder?.assigned_delivery_date || customerOrder?.estimated_delivery_date || customerOrder?.preorder_fulfillment_date || nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date || task?.delivery_date || task?.scheduled_date, 40),
    line_item_count: lineItems,
    total_quantity: safeNumber(Array.isArray(customerOrder?.items) ? customerOrder.items.reduce((sum, item) => sum + safeNumber(item?.quantity, 0), 0) : 0, 0),
    cancelled_or_refunded: g33cCancelledOrRefunded(customerOrder, nativeOrder),
    subscription_or_multi_delivery: g33cSubscriptionOrMulti(nativeOrder, task),
    already_native_complete: g33cAlreadyComplete(customerOrder, nativeOrder, task),
    review_queue_present: reviewRows.length > 0,
    review_queue_status: g33cStatuses(reviewRows),
    duplicate_risk: classification.duplicateRisks.length > 0,
    duplicate_risk_reasons: classification.duplicateRisks,
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: Boolean(task?.id),
    hub_bridge_present: orderSyncRows.length > 0 || Boolean(nativeOrder?.sync_status),
    hub_bridge_status: sanitizeText(nativeOrder?.sync_status || g33cStatuses(orderSyncRows).latest_status, 140),
    order_sync_log_status: g33cStatuses(orderSyncRows),
    safe_sync_parity_log_status: g33cStatuses(parityRows),
    command_log_status: g33cStatuses(commandRows),
    safeSync_native_mirror_status: nativeOrder?.id ? 'native_mirror_present' : 'native_mirror_missing_preview_required',
    master_data_ready: null,
    production_inventory_ready: null,
    production_demand_preview_ready: null,
    production_batch_materialized: batchCount > 0,
    production_batch_count: batchCount,
    verified_batch_count: verifiedBatchCount,
    compliance_log_count: complianceLogs.length,
    production_lifecycle_state: batchCount === 0 ? 'not_applicable_until_production_batches_exist' : verifiedBatchCount === batchCount ? 'verified_logged' : 'production_batches_present_not_fully_verified',
    production_blockers: batchCount > 0 && verifiedBatchCount < batchCount ? ['production_batches_not_fully_verified'] : [],
    production_warnings: batchCount === 0 ? ['not_applicable_until_production_batches_exist'] : [],
    task_pack_state: !task?.id ? 'not_applicable_until_task_exists' : ['packed', 'bottled_packed', 'delivered'].includes(taskStatus) ? taskStatus : 'task_not_packed',
    native_order_bottle_state: !nativeOrder?.id ? 'not_applicable_until_native_order_exists' : ['bottled', 'fulfilled'].includes(nativeProductionStatus) ? nativeProductionStatus : 'order_not_bottled',
    customer_status_state: 'not_applicable_until_downstream_preview',
    delivery_state: !task?.id ? 'not_applicable_until_task_exists' : taskDeliveryStatus || taskStatus || 'pending',
    notification_policy_state: 'held_no_notification',
    native_order_fulfillment_state: nativeFulfillmentStatus || 'unknown',
    eligible_for_second_controlled_pilot: classification.eligible,
    recommended_pilot_type: classification.eligible ? 'second_exact_controlled_one_time_order_pilot' : 'not_recommended',
    exact_gates_required: true,
    eligibility_classification: classification.classification,
    blockers: classification.blockers,
    warnings: [...new Set([...classification.warnings, ...(batchCount === 0 ? ['not_applicable_until_production_batches_exist'] : [])])],
    next_action: g33cNextAction(classification.classification, classification.eligible),
  };
}

async function buildG33CPreview(base44, body) {
  const lookup = g33cLookup(body);
  const blockers = [];
  const warnings = [];
  let seeds = [];
  if (lookup.mode === 'EXACT_ORDER_PREVIEW') {
    if (!lookup.orderNumber && !lookup.customerAppOrderId) blockers.push('order_number_or_customer_app_order_id_required');
    else seeds = [{ order_number: lookup.orderNumber, customer_app_order_id: lookup.customerAppOrderId }];
  } else if (lookup.mode === 'RECENT_CANDIDATE_SCAN') {
    const rows = await g33cList(base44, 'Order', '-created_date', Math.max(lookup.maxRecentCandidates * 4, 25));
    seeds = rows.filter(row => row?.order_number).slice(0, lookup.maxRecentCandidates).map(row => ({ ...row, __entity: 'Order' }));
    if (!seeds.length) warnings.push('no_recent_customer_app_orders_returned');
  } else {
    blockers.push('unsupported_mode');
  }
  const candidateRows = [];
  for (const seed of seeds) candidateRows.push(await g33cCandidateRow(base44, seed));
  const eligibleRows = candidateRows.filter(row => row.eligible_for_second_controlled_pilot);
  return {
    success: blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    preview_mode: G33C_PREVIEW_MODE,
    requested_function_alias: 'previewEligibleOneTimeOrderNativeWorkflow',
    mode: lookup.mode,
    include_hub_context: lookup.includeHubContext,
    scanned_count: candidateRows.length,
    selected_order_number: lookup.mode === 'EXACT_ORDER_PREVIEW' ? (candidateRows[0]?.order_number || lookup.orderNumber || null) : null,
    eligible_candidate_count: eligibleRows.length,
    eligible_candidate_found: eligibleRows.length > 0,
    candidate_rows: candidateRows,
    blockers,
    warnings,
    next_action: blockers.length
      ? 'fix_preview_request_and_rerun'
      : eligibleRows.length
        ? 'plan_g33d_second_exact_controlled_pilot_for_clean_candidate'
        : lookup.mode === 'EXACT_ORDER_PREVIEW'
          ? (candidateRows[0]?.next_action || 'wait_for_next_natural_paid_one_time_order')
          : 'wait_for_next_natural_paid_one_time_order_or_run_exact_order_preview',
    safety: G33C_READ_ONLY_SAFETY,
  };
}


const G33C_MIRROR1_PREVIEW_MODE = 'ONE_TIME_NATIVE_MIRROR_TASK_PARITY';
const G33C_MIRROR1_EXACT_MODE = 'EXACT_ORDER_PREVIEW';
const G33C_MIRROR1_MARKER = 'g33c_mirror1_one_time_native_mirror_task_parity_preview';

const G33C_MIRROR1_ALLOWED_BODY_KEYS = new Set([
  'mode',
  'preview_mode',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

const G33C_MIRROR1_SHOPIFY_ORDER_FIELDS = new Set([
  'shopify_order_number',
  'description',
  'base44_order_id',
  'source_channel',
  'line_items',
  'fulfillment_method',
  'requested_delivery_date',
  'requested_time_window',
  'payment_status',
  'fulfillment_status',
  'shopify_fulfillment_status',
  'financial_status',
  'subtotal',
  'total_tax',
  'total_discounts',
  'tip_received',
  'total_price',
  'internal_notes',
  'tags',
  'is_pos_order',
  'is_subscription',
  'production_status',
  'assigned_delivery_date',
  'order_type',
  'fulfillment_mode',
  'customer_order_date',
  'selected_delivery_date',
  'production_date',
  'delivery_window_label',
  'order_lock_status',
  'order_status',
  'operational_visibility',
  'sync_status',
  'source_type',
  'data_quality_status',
  'last_verified_at',
  'audit_trail',
]);

const G33C_MIRROR1_TASK_FIELDS = new Set([
  'order_id',
  'base44_order_id',
  'shopify_order_id',
  'native_shopify_order_id',
  'shopify_order_number',
  'order_number',
  'source_channel',
  'source_type',
  'task_source',
  'created_from_native_ops',
  'order_type',
  'fulfillment_type',
  'fulfillment_number',
  'delivery_date',
  'scheduled_date',
  'assigned_delivery_date',
  'production_date',
  'time_window',
  'delivery_window_label',
  'items',
  'items_summary',
  'line_item_count',
  'total_price',
  'address_complete',
  'status',
  'delivery_status',
  'production_status',
  'payment_status',
  'sync_status',
  'schedule_source',
  'internal_notes',
  'review_status',
  'review_reason',
  'audit_trail',
  'notes',
]);

const G33C_TASK1_PREVIEW_MODE = 'ONE_TIME_NATIVE_FULFILLMENT_TASK_MIRROR_PACKET';
const G33C_TASK1_MARKER = 'g33c_task1_one_time_native_fulfillment_task_packet_preview';
const G33C_TASK1_REQUIRED_TASK_POLICY = 'HELD_UNTIL_NATIVE_SHOPIFY_ORDER_EXISTS';
const G33C_TASK1_REQUIRED_NOTIFICATION_POLICY = 'NO_NOTIFICATION';
const G33C_TASK1_REQUIRED_PROVIDER_POLICY = 'NO_PROVIDER_CALLS';
const G33C_TASK1_REQUIRED_HUB_POLICY = 'NO_HUB_MUTATION';

const G33C_TASK1_ALLOWED_BODY_KEYS = new Set([
  'preview_mode',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'task_creation_policy',
  'notification_policy',
  'provider_call_policy',
  'hub_mutation_policy',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

function isG33CMirror1PreviewRequest(body) {
  const previewMode = normalizeText(body?.preview_mode).toUpperCase();
  return previewMode === G33C_MIRROR1_PREVIEW_MODE;
}

function isG33CTask1PreviewRequest(body) {
  const previewMode = normalizeText(body?.preview_mode).toUpperCase();
  return previewMode === G33C_TASK1_PREVIEW_MODE;
}

function g33cMirror1UnsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!G33C_MIRROR1_ALLOWED_BODY_KEYS.has(normalizeText(key).toLowerCase())) return key;
  }
  return null;
}

function g33cTask1UnsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!G33C_TASK1_ALLOWED_BODY_KEYS.has(normalizeText(key).toLowerCase())) return key;
  }
  return null;
}

function g33cMirror1Lookup(body) {
  return {
    mode: G33C_MIRROR1_EXACT_MODE,
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id || body?.order_id),
    requestId: sanitizeText(body?.request_id, 180),
  };
}

function g33cMirror1LineItems(order) {
  const source = Array.isArray(order?.items) ? order.items : Array.isArray(order?.line_items) ? order.line_items : [];
  return source
    .filter(item => safeNumber(item?.quantity, 0) > 0)
    .slice(0, 25)
    .map(item => compactObject({
      title: sanitizeText(item?.title || item?.name || item?.product_name || 'Line item', 140) || 'Line item',
      variant_title: sanitizeText(item?.variant_title || item?.variant || item?.size, 120),
      sku: sanitizeText(item?.sku, 80),
      quantity: safeNumber(item?.quantity, 1),
      price: safeNumber(item?.price || item?.unit_price, 0),
      total_discount: safeNumber(item?.total_discount || item?.discount, 0),
    }));
}

function g33cMirror1Total(order) {
  return safeNumber(order?.total_price || order?.total || order?.order_total || order?.amount_total || order?.subtotal, 0);
}

function g33cMirror1Date(order) {
  return sanitizeText(
    order?.assigned_delivery_date ||
    order?.selected_delivery_date ||
    order?.requested_delivery_date ||
    order?.estimated_delivery_date ||
    order?.preorder_fulfillment_date ||
    order?.delivery_date ||
    order?.pickup_date ||
    order?.fulfillment_date,
    40,
  );
}

function g33cMirror1ProductionDate(order) {
  return sanitizeText(order?.production_date || order?.assigned_production_date || order?.juice_date || g33cMirror1Date(order), 40);
}

function g33cMirror1Window(order) {
  return sanitizeText(order?.delivery_window_label || order?.requested_time_window || order?.time_window || order?.delivery_window, 120);
}

function g33cMirror1StatusProjection(order) {
  const status = normalizeLower(order?.status || order?.order_status);
  if (['bottled_packed', 'packed', 'ready_for_delivery'].includes(status)) {
    return {
      nativeProductionStatus: status === 'bottled_packed' ? 'bottled' : status,
      nativeFulfillmentStatus: 'pending',
      taskStatus: status === 'bottled_packed' ? 'bottled_packed' : status,
      taskDeliveryStatus: 'pending',
      taskProductionStatus: status === 'bottled_packed' ? 'bottled' : status,
      lifecycleSafety: 'hub_operational_context_already_bottled_or_packed',
    };
  }
  if (['delivered', 'fulfilled', 'completed'].includes(status)) {
    return {
      nativeProductionStatus: 'fulfilled',
      nativeFulfillmentStatus: 'fulfilled',
      taskStatus: 'delivered',
      taskDeliveryStatus: 'delivered',
      taskProductionStatus: 'fulfilled',
      lifecycleSafety: 'customer_facing_completed_historical_admin_mirror_only',
    };
  }
  return {
    nativeProductionStatus: 'new',
    nativeFulfillmentStatus: 'pending',
    taskStatus: 'pending',
    taskDeliveryStatus: 'pending',
    taskProductionStatus: 'new',
    lifecycleSafety: 'operationally_active_pre_native_ops',
  };
}

function g33cMirror1ExistingSummary(row) {
  return compactObject({
    id: sanitizeText(row?.id, 120),
    order_number: sanitizeText(row?.order_number || row?.shopify_order_number, 120),
    status: sanitizeText(row?.status || row?.order_status || row?.sync_status, 120),
    source_type: sanitizeText(row?.source_type, 120),
    sync_status: sanitizeText(row?.sync_status, 120),
  });
}

function g33cMirror1SafeOrderSummary(order) {
  return compactObject({
    id: sanitizeText(order?.id, 120),
    order_number: sanitizeText(order?.order_number || order?.shopify_order_number, 120),
    status: sanitizeText(order?.status || order?.order_status, 120),
    payment_status: sanitizeText(order?.payment_status || order?.financial_status, 80),
    payment_captured: order?.payment_captured === true,
    order_type: 'one_time',
    fulfillment_type: fulfillmentMethod(order),
    delivery_or_pickup_date: g33cMirror1Date(order),
    production_date: g33cMirror1ProductionDate(order),
    delivery_window_present: Boolean(g33cMirror1Window(order)),
    address_complete: hasCompleteDeliveryAddress(order),
    line_item_count: lineItemCount(order),
    total_price: g33cMirror1Total(order),
    status_history_count: Array.isArray(order?.status_history) ? order.status_history.length : 0,
    cancellation_refund_markers: {
      cancelled_or_refunded: g33cCancelledOrRefunded(order, null),
      refund_status_present: Boolean(order?.refund_status || order?.refunded_at),
      cancelled_marker_present: Boolean(order?.canceled_at || order?.cancelled_at || order?.deleted_at || order?.do_not_recover),
    },
    customer_data_completeness: {
      customer_name_present: Boolean(order?.customer_name || order?.name || order?.full_name),
      customer_email_present: Boolean(order?.customer_email || order?.email),
      customer_phone_present: Boolean(order?.customer_phone || order?.phone),
      address_complete: hasCompleteDeliveryAddress(order),
      pii_values_returned: false,
    },
  });
}

function g33cMirror1MissingReason({ customerOrder, nativeOrders, tasks, orderSyncRows, reviewRows }) {
  if (!customerOrder?.id) return 'unknown_missing_native_reason';
  if (g33cReviewBlocker(reviewRows)) return 'native_record_missing_requires_review';
  const latestSync = normalizeLower(g33cStatuses(orderSyncRows).latest_status);
  const syncStatuses = (g33cStatuses(orderSyncRows).statuses || []).map(normalizeLower);
  if (latestSync === 'deduped' || syncStatuses.includes('deduped')) return 'native_ops_duplicate_hub_dedupe_only';
  if (syncStatuses.some(status => status.includes('validation') || status.includes('blocked'))) return 'native_ops_validation_blocked';
  if (syncStatuses.some(status => status.includes('error') || status.includes('failed'))) return 'native_ops_not_triggered';
  if (nativeOrders.length === 0 && tasks.length === 0 && orderSyncRows.length === 0) return 'native_ops_not_triggered';
  if (!g33cPaid(customerOrder, null)) return 'native_ops_payment_context_missing';
  if (fulfillmentMethod(customerOrder) === 'delivery' && !hasCompleteDeliveryAddress(customerOrder)) return 'native_ops_delivery_context_missing';
  return 'native_record_missing_but_preview_safe';
}

function g33cMirror1BuildShopifyOrderPacket({ customerOrder, orderNumber, projection }) {
  const lineItems = g33cMirror1LineItems(customerOrder);
  const deliveryDate = g33cMirror1Date(customerOrder);
  const productionDate = g33cMirror1ProductionDate(customerOrder);
  const packet = compactObject({
    shopify_order_number: orderNumber ? `#${orderNumber}` : null,
    description: 'G33C-MIRROR1 read-only native ShopifyOrder mirror packet for one-time Customer App order. No write approved.',
    base44_order_id: customerOrder?.id,
    source_channel: 'online',
    source_type: 'customer_app_one_time_native_mirror_preview',
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    fulfillment_method: fulfillmentMethod(customerOrder),
    requested_delivery_date: deliveryDate,
    assigned_delivery_date: deliveryDate,
    selected_delivery_date: deliveryDate,
    production_date: productionDate,
    customer_order_date: sanitizeText(customerOrder?.created_date || customerOrder?.created_at, 40),
    requested_time_window: g33cMirror1Window(customerOrder),
    delivery_window_label: g33cMirror1Window(customerOrder),
    payment_status: 'paid',
    financial_status: 'paid',
    fulfillment_status: projection.nativeFulfillmentStatus,
    shopify_fulfillment_status: projection.nativeFulfillmentStatus,
    production_status: projection.nativeProductionStatus,
    order_status: sanitizeText(customerOrder?.status || customerOrder?.order_status, 80),
    operational_visibility: 'one_time_native_mirror_preview',
    sync_status: 'native_one_time_mirror_preview_g33c_mirror1',
    data_quality_status: 'g33c_mirror1_preview_only_hub_active',
    is_pos_order: false,
    is_subscription: false,
    line_items: lineItems,
    total_price: g33cMirror1Total(customerOrder),
    tags: ['g33c_mirror1_preview', 'one_time', 'hub_active', 'no_notification'],
    internal_notes: 'Preview only. No native ShopifyOrder, FulfillmentTask, ProductionBatch, BatchComplianceLog, provider call, notification, Hub mutation, sync/repair/replay, inventory, or PO action is approved.',
    audit_trail: [{
      marker: G33C_MIRROR1_MARKER,
      source: 'previewNativeOrderCutoverReadiness',
      request_scope: 'read_only_preview',
      order_number: orderNumber,
      customer_app_order_id: customerOrder?.id,
      raw_payload_included: false,
      provider_call_performed: false,
      notification_sent: false,
      hub_mutation_performed: false,
    }],
  });
  const unsupported = Object.keys(packet).filter(key => !G33C_MIRROR1_SHOPIFY_ORDER_FIELDS.has(key));
  return { packet, unsupported };
}

function g33cMirror1BuildTaskPacket({ customerOrder, orderNumber, projection, nativeOrder }) {
  const deliveryDate = g33cMirror1Date(customerOrder);
  const productionDate = g33cMirror1ProductionDate(customerOrder);
  const lineItems = g33cMirror1LineItems(customerOrder).map(item => compactObject({
    title: item.title,
    quantity: item.quantity,
    price: item.price,
  }));
  const taskDependsOnNativeOrder = !nativeOrder?.id;
  const packet = compactObject({
    order_id: customerOrder?.id,
    base44_order_id: customerOrder?.id,
    shopify_order_id: nativeOrder?.id || 'requires_native_shopify_order_id',
    native_shopify_order_id: nativeOrder?.id || 'requires_native_shopify_order_id',
    shopify_order_number: orderNumber ? `#${orderNumber}` : null,
    order_number: orderNumber,
    source_channel: 'customer_app',
    source_type: 'one_time_native_task_preview',
    task_source: 'g33c_mirror1_preview_only',
    created_from_native_ops: true,
    order_type: 'one_time',
    fulfillment_type: fulfillmentMethod(customerOrder),
    fulfillment_number: 1,
    delivery_date: deliveryDate,
    scheduled_date: deliveryDate,
    assigned_delivery_date: deliveryDate,
    production_date: productionDate,
    time_window: g33cMirror1Window(customerOrder),
    delivery_window_label: g33cMirror1Window(customerOrder),
    items: lineItems,
    items_summary: `${lineItems.length} line item${lineItems.length === 1 ? '' : 's'}`,
    line_item_count: lineItems.length,
    total_price: g33cMirror1Total(customerOrder),
    address_complete: hasCompleteDeliveryAddress(customerOrder),
    status: projection.taskStatus,
    delivery_status: projection.taskDeliveryStatus,
    production_status: projection.taskProductionStatus,
    payment_status: 'paid',
    sync_status: 'native_one_time_task_preview_g33c_mirror1',
    schedule_source: deliveryDate ? 'customer_app_order_date_preview' : 'missing_delivery_date',
    review_status: taskDependsOnNativeOrder ? 'dependency_required' : 'preview_ready',
    review_reason: taskDependsOnNativeOrder ? 'task_create_depends_on_native_shopify_order' : 'preview_only_no_write',
    internal_notes: 'Preview only. Contact/address PII omitted from preview response; future command would require separate approval and safe internal source reads.',
    notes: 'No notification, provider call, Hub mutation, production, inventory, or PO action approved.',
    audit_trail: [{
      marker: G33C_MIRROR1_MARKER,
      source: 'previewNativeOrderCutoverReadiness',
      request_scope: 'read_only_preview',
      order_number: orderNumber,
      customer_app_order_id: customerOrder?.id,
      native_shopify_order_dependency: taskDependsOnNativeOrder,
      raw_payload_included: false,
      provider_call_performed: false,
      notification_sent: false,
      hub_mutation_performed: false,
      pii_values_returned: false,
    }],
  });
  const unsupported = Object.keys(packet).filter(key => !G33C_MIRROR1_TASK_FIELDS.has(key));
  return { packet, unsupported, taskDependsOnNativeOrder };
}

function g33cMirror1Eligibility({ customerOrder, nativeOrder, task, reviewRows, mirrorPacketBlockers, taskPacketBlockers, projection }) {
  const blockers = [];
  const warnings = [];
  if (!customerOrder?.id) blockers.push('customer_app_order_missing');
  if (!g33cPaid(customerOrder, nativeOrder)) blockers.push('payment_not_paid_or_captured');
  if (g33cCancelledOrRefunded(customerOrder, nativeOrder)) blockers.push('cancelled_or_refunded');
  if (g33cSubscriptionOrMulti(nativeOrder, task)) blockers.push('subscription_or_multi_delivery_not_supported');
  if (!lineItemCount(customerOrder)) blockers.push('missing_line_items');
  if (!['delivery', 'pickup'].includes(fulfillmentMethod(customerOrder))) blockers.push('ambiguous_delivery_or_pickup_classification');
  if (fulfillmentMethod(customerOrder) === 'delivery' && !hasCompleteDeliveryAddress(customerOrder)) blockers.push('missing_delivery_address_context');
  if (g33cReviewBlocker(reviewRows)) blockers.push('order_review_queue_blocker');
  blockers.push(...mirrorPacketBlockers, ...taskPacketBlockers);
  if (!nativeOrder?.id) warnings.push('native_shopify_order_missing');
  if (!task?.id) warnings.push('native_fulfillment_task_missing');
  if (!nativeOrder?.id) warnings.push('task_create_depends_on_native_shopify_order');
  if (projection.lifecycleSafety === 'hub_operational_context_already_bottled_or_packed') warnings.push('hub_production_or_pack_context_already_started_preserve_hub_fallback');
  if (projection.lifecycleSafety === 'customer_facing_completed_historical_admin_mirror_only') warnings.push('customer_facing_completed_historical_admin_mirror_only');
  warnings.push('provider_calls_disabled', 'notifications_held', 'hub_active_no_mutation', 'no_live_command_available');
  const mirrorReady = blockers.length === 0 && !nativeOrder?.id;
  const taskReady = blockers.length === 0 && !task?.id && Boolean(nativeOrder?.id);
  const historicalOnly = projection.lifecycleSafety === 'customer_facing_completed_historical_admin_mirror_only';
  const operationalRecovery = projection.lifecycleSafety === 'hub_operational_context_already_bottled_or_packed';
  return {
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    eligible_for_second_controlled_pilot: blockers.length === 0 && Boolean(nativeOrder?.id && task?.id) && !historicalOnly,
    eligible_for_native_mirror_command_planning: mirrorReady,
    eligible_for_native_task_command_planning: taskReady,
    recommended_pilot_type: blockers.length
      ? 'none_hold'
      : historicalOnly
        ? 'historical_native_mirror_only'
        : operationalRecovery
          ? 'exact_native_mirror_task_recovery_preview'
          : mirrorReady || taskReady
            ? 'exact_native_mirror_task_recovery_preview'
            : 'second_controlled_order_pilot_candidate',
  };
}

async function buildG33CMirror1Preview(base44, body) {
  const lookup = g33cMirror1Lookup(body);
  const requestBlockers = [];
  if (!lookup.orderNumber && !lookup.customerAppOrderId) requestBlockers.push('order_number_or_customer_app_order_id_required');
  const customerOrders = requestBlockers.length ? [] : await g33cCustomerOrders(base44, lookup);
  const customerOrder = customerOrders[0] || null;
  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || lookup.orderNumber);
  const customerOrderId = normalizeText(customerOrder?.id || lookup.customerAppOrderId);
  const nativeOrders = await g33cNativeOrders(base44, orderNumber, customerOrderId);
  const nativeOrder = nativeOrders[0] || null;
  const tasks = await g33cTasks(base44, orderNumber, customerOrderId, nativeOrder?.id);
  const task = tasks[0] || null;
  const [orderSyncRows, reviewRows, commandRows, parityRows] = await Promise.all([
    g33cLogs(base44, 'OrderSyncLog', orderNumber, customerOrderId, 30),
    g33cLogs(base44, 'OrderReviewQueue', orderNumber, customerOrderId, 30),
    g33cLogs(base44, 'CommandLog', orderNumber, customerOrderId, 30),
    g33cLogs(base44, 'SafeSyncParityLog', orderNumber, customerOrderId, 30),
  ]);
  const projection = g33cMirror1StatusProjection(customerOrder);
  const missingReason = g33cMirror1MissingReason({ customerOrder, nativeOrders, tasks, orderSyncRows, reviewRows });
  const { packet: shopifyPacket, unsupported: shopifyUnsupported } = g33cMirror1BuildShopifyOrderPacket({ customerOrder, orderNumber, projection });
  const { packet: taskPacket, unsupported: taskUnsupported, taskDependsOnNativeOrder } = g33cMirror1BuildTaskPacket({ customerOrder, orderNumber, projection, nativeOrder });
  const mirrorPacketBlockers = shopifyUnsupported.map(field => `unsupported_native_shopify_order_field:${field}`);
  const taskPacketBlockers = taskUnsupported.map(field => `unsupported_native_fulfillment_task_field:${field}`);
  if (nativeOrders.length > 1) mirrorPacketBlockers.push('multiple_native_shopify_orders_match');
  if (tasks.length > 1) taskPacketBlockers.push('multiple_native_fulfillment_tasks_match');
  const eligibility = g33cMirror1Eligibility({ customerOrder, nativeOrder, task, reviewRows, mirrorPacketBlockers, taskPacketBlockers, projection });
  const nativeMirrorWouldCreate = Boolean(customerOrder?.id && !nativeOrder?.id && eligibility.blockers.length === 0);
  const taskWouldCreate = Boolean(customerOrder?.id && !task?.id && nativeOrder?.id && eligibility.blockers.length === 0);
  const nextAction = eligibility.blockers.length
    ? 'hold_native_mirror_task_recovery_until_blockers_resolved'
    : nativeMirrorWouldCreate
      ? 'plan_exact_native_mirror_task_recovery_command_pr_prep'
      : taskWouldCreate
        ? 'plan_exact_native_task_recovery_command_pr_prep'
        : eligibility.eligible_for_second_controlled_pilot
          ? 'plan_g33d_second_exact_controlled_pilot'
          : 'hold_no_native_recovery_needed';

  return {
    success: requestBlockers.length === 0,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    preview_mode: G33C_MIRROR1_PREVIEW_MODE,
    mode: G33C_MIRROR1_EXACT_MODE,
    marker: G33C_MIRROR1_MARKER,
    request_id: lookup.requestId || null,
    order_number: orderNumber || lookup.orderNumber || null,
    customer_app_order_id: customerOrderId || null,
    customer_app_order_present: Boolean(customerOrder?.id),
    customer_app_order_summary: g33cMirror1SafeOrderSummary(customerOrder),
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_shopify_order_id: nativeOrder?.id || null,
    native_shopify_order_matches: nativeOrders.slice(0, 5).map(g33cMirror1ExistingSummary),
    native_fulfillment_task_present: Boolean(task?.id),
    native_fulfillment_task_id: task?.id || null,
    native_fulfillment_task_matches: tasks.slice(0, 5).map(g33cMirror1ExistingSummary),
    missing_native_reason_classification: missingReason,
    source_audit: {
      order_sync_log_status: g33cStatuses(orderSyncRows),
      order_review_queue_status: g33cStatuses(reviewRows),
      command_log_status: g33cStatuses(commandRows),
      safe_sync_parity_log_status: g33cStatuses(parityRows),
      hub_bridge_status: sanitizeText(g33cStatuses(orderSyncRows).latest_status, 120),
      hub_context_source: 'local_bridge_logs_only_no_hub_mutation',
      raw_payloads_returned: false,
      pii_values_returned: false,
    },
    native_shopify_order_mirror_preview: {
      would_create_native_shopify_order: nativeMirrorWouldCreate,
      native_shopify_order_present: Boolean(nativeOrder?.id),
      proposed_source_type: shopifyPacket.source_type || null,
      proposed_order_type: shopifyPacket.order_type || null,
      proposed_fulfillment_method: shopifyPacket.fulfillment_method || null,
      proposed_payment_status: shopifyPacket.payment_status || null,
      proposed_production_status: shopifyPacket.production_status || null,
      proposed_fulfillment_status: shopifyPacket.fulfillment_status || null,
      proposed_sync_status: shopifyPacket.sync_status || null,
      base44_order_id: shopifyPacket.base44_order_id || null,
      shopify_order_number: shopifyPacket.shopify_order_number || null,
      line_item_count: Array.isArray(shopifyPacket.line_items) ? shopifyPacket.line_items.length : 0,
      total_price: shopifyPacket.total_price || 0,
      delivery_date: shopifyPacket.assigned_delivery_date || shopifyPacket.requested_delivery_date || null,
      production_date: shopifyPacket.production_date || null,
      schema_safe_field_packet: shopifyPacket,
      omitted_fields: ['customer_name', 'customer_email', 'customer_phone', 'delivery_address', 'raw_provider_payloads'],
      raw_payload_included: false,
      provider_call_impact: false,
      notification_impact: { notification_would_send: false, notification_held: true },
      blockers: [...new Set([...requestBlockers, ...mirrorPacketBlockers])],
    },
    native_fulfillment_task_preview: {
      would_create_native_fulfillment_task: taskWouldCreate,
      task_create_depends_on_native_shopify_order: taskDependsOnNativeOrder,
      linked_native_shopify_order_requirement: taskDependsOnNativeOrder ? 'native_shopify_order_required_before_task_create' : 'native_shopify_order_present',
      native_fulfillment_task_present: Boolean(task?.id),
      task_status_preview: taskPacket.status || null,
      delivery_status_preview: taskPacket.delivery_status || null,
      production_status_preview: taskPacket.production_status || null,
      delivery_date: taskPacket.delivery_date || null,
      scheduled_date: taskPacket.scheduled_date || null,
      assigned_delivery_date: taskPacket.assigned_delivery_date || null,
      production_date: taskPacket.production_date || null,
      fulfillment_type: taskPacket.fulfillment_type || null,
      address_complete: taskPacket.address_complete === true,
      line_item_count: taskPacket.line_item_count || 0,
      items_summary: taskPacket.items_summary || null,
      schema_safe_field_packet: taskPacket,
      omitted_fields: ['customer_email', 'customer_phone', 'address', 'delivery_address', 'route_id', 'proof_or_drop_payloads'],
      raw_payload_included: false,
      provider_call_impact: false,
      notification_impact: { notification_would_send: false, notification_held: true },
      blockers: [...new Set([...requestBlockers, ...taskPacketBlockers, ...(taskDependsOnNativeOrder ? ['task_create_depends_on_native_shopify_order'] : [])])],
    },
    production_delivery_lifecycle_safety: {
      classification: projection.lifecycleSafety,
      customer_status: sanitizeText(customerOrder?.status || customerOrder?.order_status, 80),
      hub_fallback_sufficient: true,
      do_not_infer_delivery_completion_without_evidence: true,
      production_commands_held: true,
      delivery_commands_held: true,
      recommended_scope: projection.lifecycleSafety === 'customer_facing_completed_historical_admin_mirror_only'
        ? 'historical_admin_mirror_only'
        : 'exact_native_mirror_task_recovery_preview_only',
    },
    eligible_for_second_controlled_pilot: eligibility.eligible_for_second_controlled_pilot,
    eligible_for_native_mirror_command_planning: eligibility.eligible_for_native_mirror_command_planning,
    eligible_for_native_task_command_planning: eligibility.eligible_for_native_task_command_planning,
    recommended_pilot_type: eligibility.recommended_pilot_type,
    provider_call_impact: false,
    notification_impact: {
      notification_would_send: false,
      notification_held: true,
      notification_rows_created: false,
      message_logs_created: false,
    },
    hub_mutation_performed: false,
    customer_app_order_mutation_proposed: false,
    native_shopify_order_mutation_performed: false,
    native_fulfillment_task_mutation_performed: false,
    production_batch_mutation_proposed: false,
    batch_compliance_log_mutation_proposed: false,
    sync_repair_replay_performed: false,
    blockers: [...new Set([...requestBlockers, ...eligibility.blockers])],
    warnings: eligibility.warnings,
    next_action: requestBlockers.length ? 'provide_exact_order_number_or_customer_app_order_id' : nextAction,
    safety: G33C_READ_ONLY_SAFETY,
  };
}

function g33cTask1Lookup(body) {
  return {
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id || body?.order_id),
    nativeShopifyOrderId: normalizeText(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id),
    taskCreationPolicy: normalizeText(body?.task_creation_policy).toUpperCase(),
    notificationPolicy: normalizeText(body?.notification_policy).toUpperCase(),
    providerCallPolicy: normalizeText(body?.provider_call_policy).toUpperCase(),
    hubMutationPolicy: normalizeText(body?.hub_mutation_policy).toUpperCase(),
    requestId: sanitizeText(body?.request_id, 180),
  };
}

function g33cTask1InputBlockers(lookup) {
  const blockers = [];
  if (!lookup.orderNumber) blockers.push('order_number_required');
  if (!lookup.customerAppOrderId) blockers.push('customer_app_order_id_required');
  if (!lookup.nativeShopifyOrderId) blockers.push('native_shopify_order_id_required');
  if (lookup.taskCreationPolicy !== G33C_TASK1_REQUIRED_TASK_POLICY) blockers.push('task_creation_policy_must_be_held_until_native_shopify_order_exists');
  if (lookup.notificationPolicy !== G33C_TASK1_REQUIRED_NOTIFICATION_POLICY) blockers.push('notification_policy_must_be_no_notification');
  if (lookup.providerCallPolicy !== G33C_TASK1_REQUIRED_PROVIDER_POLICY) blockers.push('provider_call_policy_must_be_no_provider_calls');
  if (lookup.hubMutationPolicy !== G33C_TASK1_REQUIRED_HUB_POLICY) blockers.push('hub_mutation_policy_must_be_no_hub_mutation');
  return blockers;
}

async function g33cTask1NativeOrder(base44, lookup, orderNumber, customerOrderId) {
  const rows = [];
  if (lookup.nativeShopifyOrderId) rows.push(...await g33cFilter(base44, 'ShopifyOrder', { id: lookup.nativeShopifyOrderId }, '-created_date', 5, { retryEmpty: true }));
  rows.push(...await g33cNativeOrders(base44, orderNumber, customerOrderId));
  const unique = g33cUnique(rows);
  return unique.find(row => normalizeText(row?.id) === lookup.nativeShopifyOrderId) || unique[0] || null;
}

function g33cTask1ItemsSummary(items) {
  const count = Array.isArray(items) ? items.length : 0;
  return `${count} line item${count === 1 ? '' : 's'}`;
}

function g33cTask1BuildPacket({ customerOrder, nativeOrder, orderNumber, projection }) {
  const lineItems = g33cMirror1LineItems(customerOrder).map(item => compactObject({
    title: item.title,
    quantity: item.quantity,
    price: item.price,
  }));
  const deliveryDate = g33cMirror1Date(customerOrder);
  const productionDate = g33cMirror1ProductionDate(customerOrder);
  const packet = compactObject({
    order_id: customerOrder?.id,
    base44_order_id: customerOrder?.id,
    shopify_order_id: nativeOrder?.id,
    native_shopify_order_id: nativeOrder?.id,
    shopify_order_number: nativeOrder?.shopify_order_number || (orderNumber ? `#${orderNumber}` : null),
    order_number: orderNumber,
    source_channel: 'online',
    source_type: 'customer_app_one_time_native_task_mirror_preview',
    task_source: G33C_TASK1_MARKER,
    created_from_native_ops: true,
    order_type: 'one_time',
    fulfillment_type: fulfillmentMethod(customerOrder),
    fulfillment_number: 1,
    delivery_date: deliveryDate,
    scheduled_date: deliveryDate,
    assigned_delivery_date: deliveryDate,
    production_date: productionDate,
    time_window: g33cMirror1Window(customerOrder),
    delivery_window_label: g33cMirror1Window(customerOrder),
    items: lineItems,
    items_summary: g33cTask1ItemsSummary(lineItems),
    line_item_count: lineItems.length,
    total_price: g33cMirror1Total(customerOrder),
    address_complete: hasCompleteDeliveryAddress(customerOrder),
    status: projection.taskStatus,
    delivery_status: projection.taskDeliveryStatus,
    production_status: projection.taskProductionStatus,
    payment_status: 'paid',
    sync_status: 'native_one_time_fulfillment_task_preview_g33c_task1',
    schedule_source: deliveryDate ? 'customer_app_order_date_native_mirror_preview' : 'missing_delivery_date',
    review_status: 'preview_ready',
    review_reason: 'preview_only_no_write',
    internal_notes: 'G33C-TASK1 preview only. No FulfillmentTask, Customer App Order update, native ShopifyOrder update, ProductionBatch, BatchComplianceLog, provider call, notification, Hub mutation, sync/repair/replay, inventory, or PO action is approved.',
    notes: 'No notification, provider call, Hub mutation, production, inventory, PO, proof, drop, or route action approved.',
    audit_trail: [{
      marker: G33C_TASK1_MARKER,
      source: 'previewNativeOrderCutoverReadiness',
      request_scope: 'read_only_preview',
      order_number: orderNumber,
      customer_app_order_id: customerOrder?.id,
      native_shopify_order_id: nativeOrder?.id,
      raw_payload_included: false,
      provider_call_performed: false,
      notification_sent: false,
      hub_mutation_performed: false,
      customer_pii_values_returned: false,
    }],
  });
  const unsupported = Object.keys(packet).filter(key => !G33C_MIRROR1_TASK_FIELDS.has(key));
  return { packet, unsupported };
}

function g33cTask1Blockers({ inputBlockers, customerOrder, nativeOrder, taskRows, packet, unsupported }) {
  const blockers = [...inputBlockers];
  if (!customerOrder?.id) blockers.push('customer_app_order_missing');
  if (!nativeOrder?.id) blockers.push('native_shopify_order_missing');
  if (taskRows.length > 0) blockers.push('existing_native_fulfillment_task_present');
  if (!g33cPaid(customerOrder, nativeOrder)) blockers.push('payment_not_paid_or_captured');
  if (g33cCancelledOrRefunded(customerOrder, nativeOrder)) blockers.push('cancelled_or_refunded');
  if (g33cOrderType(customerOrder, nativeOrder, null) !== 'one_time') blockers.push('order_type_not_one_time');
  if (fulfillmentMethod(customerOrder) !== 'delivery') blockers.push('unsupported_fulfillment_type');
  if (!lineItemCount(customerOrder)) blockers.push('missing_line_items');
  if (!packet.delivery_date) blockers.push('missing_delivery_date');
  if (fulfillmentMethod(customerOrder) === 'delivery' && packet.address_complete !== true) blockers.push('missing_delivery_address_context');
  blockers.push(...unsupported.map(field => `unsupported_native_fulfillment_task_field:${field}`));
  return [...new Set(blockers)];
}

function g33cTask1Warnings({ projection, taskRows }) {
  const warnings = [];
  if (projection.lifecycleSafety === 'hub_operational_context_already_bottled_or_packed') warnings.push('task_status_reflects_existing_customer_order_bottled_packed');
  if (taskRows.length > 0) warnings.push('existing_native_fulfillment_task_blocks_create_preview');
  warnings.push(
    'hub_active_no_mutation',
    'customer_app_order_held',
    'native_shopify_order_held',
    'production_batch_held',
    'batch_compliance_log_held',
    'notifications_held',
    'provider_calls_disabled',
    'inventory_po_held',
    'proof_drop_route_held',
    'no_live_command_available',
  );
  return [...new Set(warnings)];
}

async function buildG33CTask1Preview(base44, body) {
  const lookup = g33cTask1Lookup(body);
  const inputBlockers = g33cTask1InputBlockers(lookup);
  const customerOrders = inputBlockers.includes('customer_app_order_id_required') && inputBlockers.includes('order_number_required')
    ? []
    : await g33cCustomerOrders(base44, lookup);
  const customerOrder = customerOrders[0] || null;
  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || lookup.orderNumber);
  const customerOrderId = normalizeText(customerOrder?.id || lookup.customerAppOrderId);
  const nativeOrder = await g33cTask1NativeOrder(base44, lookup, orderNumber, customerOrderId);
  const taskRows = await g33cTasks(base44, orderNumber, customerOrderId, nativeOrder?.id, '');
  const [orderSyncRows, reviewRows, commandRows, parityRows] = await Promise.all([
    g33cLogs(base44, 'OrderSyncLog', orderNumber, customerOrderId, 30),
    g33cLogs(base44, 'OrderReviewQueue', orderNumber, customerOrderId, 30),
    g33cLogs(base44, 'CommandLog', orderNumber, customerOrderId, 30),
    g33cLogs(base44, 'SafeSyncParityLog', orderNumber, customerOrderId, 30),
  ]);
  const projection = g33cMirror1StatusProjection(customerOrder);
  const { packet, unsupported } = g33cTask1BuildPacket({ customerOrder, nativeOrder, orderNumber, projection });
  const blockers = g33cTask1Blockers({ inputBlockers, customerOrder, nativeOrder, taskRows, packet, unsupported });
  const warnings = g33cTask1Warnings({ projection, taskRows });
  const taskPacketReady = blockers.length === 0;
  const duplicateReasons = [];
  if (taskRows.some(row => normalizeText(row?.native_shopify_order_id || row?.shopify_order_id) === normalizeText(nativeOrder?.id))) duplicateReasons.push('matching_native_shopify_order_id');
  if (taskRows.some(row => normalizeText(row?.base44_order_id || row?.order_id) === customerOrderId)) duplicateReasons.push('matching_customer_app_order_id');
  if (taskRows.some(row => g33cOrderKey(row?.order_number || row?.shopify_order_number) === g33cOrderKey(orderNumber))) duplicateReasons.push('matching_order_number');

  return {
    success: inputBlockers.length === 0,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    preview_mode: G33C_TASK1_PREVIEW_MODE,
    marker: G33C_TASK1_MARKER,
    request_id: lookup.requestId || null,
    order_number: orderNumber || lookup.orderNumber || null,
    customer_app_order_id: customerOrderId || lookup.customerAppOrderId || null,
    native_shopify_order_id: nativeOrder?.id || lookup.nativeShopifyOrderId || null,
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: taskRows.length > 0,
    native_fulfillment_task_matches: taskRows.slice(0, 5).map(g33cMirror1ExistingSummary),
    task_packet_ready: taskPacketReady,
    proposed_native_fulfillment_task_packet: taskPacketReady ? packet : packet,
    schema_supported_fields: Object.keys(packet).filter(key => G33C_MIRROR1_TASK_FIELDS.has(key)),
    schema_required_internal_fields_not_returned: ['customer_email'],
    omitted_fields: [
      'customer_email',
      'customer_phone',
      'customer_name',
      'address',
      'delivery_address',
      'route_id',
      'route_stop_sequence',
      'proof_or_drop_payloads',
      'raw_customer_app_payload',
      'raw_hub_payload',
      'raw_shopify_payload',
      'raw_stripe_payload',
      'provider_payment_payloads',
    ],
    held_records: {
      customer_app_order: 'held_no_update',
      native_shopify_order: 'held_no_update',
      native_fulfillment_task: 'preview_only_no_create',
      production_batch: 'held',
      batch_compliance_log: 'held',
      notification_message_log: 'held',
      hub_records: 'held_no_mutation',
      inventory_purchase_order: 'held',
      proof_drop_route: 'held',
    },
    existing_record_checks: {
      fulfillment_task_by_native_shopify_order: taskRows.filter(row => normalizeText(row?.native_shopify_order_id || row?.shopify_order_id) === normalizeText(nativeOrder?.id)).length,
      fulfillment_task_by_customer_app_order: taskRows.filter(row => normalizeText(row?.base44_order_id || row?.order_id) === customerOrderId).length,
      fulfillment_task_by_order_number: taskRows.filter(row => g33cOrderKey(row?.order_number || row?.shopify_order_number) === g33cOrderKey(orderNumber)).length,
      order_review_queue_status: g33cStatuses(reviewRows),
      order_sync_log_status: g33cStatuses(orderSyncRows),
      command_log_status: g33cStatuses(commandRows),
      safe_sync_parity_log_status: g33cStatuses(parityRows),
    },
    duplicate_task_risk: taskRows.length > 0,
    duplicate_task_risk_reasons: duplicateReasons,
    provider_call_impact: false,
    notification_impact: {
      notification_would_send: false,
      notification_held: true,
      notification_rows_created: false,
      message_logs_created: false,
    },
    hub_mutation_performed: false,
    customer_app_order_update_proposed: false,
    native_shopify_order_update_proposed: false,
    production_batch_create_proposed: false,
    batch_compliance_log_create_proposed: false,
    sync_repair_replay_performed: false,
    blockers,
    warnings,
    next_action: taskPacketReady ? 'plan_gated_native_fulfillment_task_mirror_command_pr_prep' : 'hold_native_fulfillment_task_mirror_until_blockers_resolved',
    safety: G33C_READ_ONLY_SAFETY,
  };
}


const G35B_PREVIEW_MODE = 'NATIVE_REFUND_IMPACT';
const G35B_REFUND_TYPES = new Set(['full', 'partial', 'unknown']);
const G35B_EVENT_SOURCES = new Set(['stripe_webhook', 'stripe_webhook_shadow', 'admin_preview', 'admin_shadow_preview', 'test_fixture', 'synthetic_fixture']);
const G35K_FULL_REFUND_PREPRODUCTION_MARKER = 'g35k_full_refund_preproduction_preview_hardening';

const G35B_ALLOWED_BODY_KEYS = new Set([
  'mode',
  'preview_mode',
  'order_number',
  'shopify_order_number',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'native_fulfillment_task_id',
  'fulfillment_task_id',
  'stripe_event_id',
  'stripe_refund_id',
  'refund_type',
  'refund_amount',
  'refund_currency',
  'currency',
  'refund_reason',
  'event_source',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

const G35B_READ_ONLY_SAFETY = Object.freeze({
  dry_run_only: true,
  writes_performed: false,
  refunds_processed: false,
  customer_app_order_updated: false,
  native_shopify_order_updated: false,
  native_fulfillment_task_updated: false,
  production_batch_updated: false,
  batch_compliance_log_updated: false,
  order_review_queue_created: false,
  order_sync_log_created: false,
  command_log_created: false,
  tasks_cancelled: false,
  order_sources_removed: false,
  batches_recalculated: false,
  inventory_deducted_or_restored: false,
  purchase_order_created_or_updated: false,
  notifications_created: false,
  notifications_sent: false,
  message_logs_created: false,
  provider_calls_performed: false,
  stripe_calls_performed: false,
  shopify_api_calls_performed: false,
  sync_repair_replay_performed: false,
  gates_opened: false,
  hub_records_updated: false,
  hub_bridge_modified: false,
});

const G35B_STATUS_SCHEMA_COMPATIBILITY = Object.freeze({
  customer_order_status_refund_value_supported: false,
  customer_order_cancelled_value_supported: false,
  native_shopify_order_payment_status_refunded_supported: true,
  native_shopify_order_production_status_cancelled_supported: true,
  native_shopify_order_production_status_cancelled_value: 'canceled',
  native_fulfillment_task_cancelled_status_supported: true,
  native_fulfillment_task_cancelled_status_value: 'cancelled',
});

function isG35BPreviewRequest(body) {
  const previewMode = normalizeText(body?.preview_mode).toUpperCase();
  return previewMode === G35B_PREVIEW_MODE;
}

function g35bUnsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!G35B_ALLOWED_BODY_KEYS.has(normalizeText(key).toLowerCase())) return key;
  }
  return null;
}

function g35bLookup(body) {
  const refundType = normalizeLower(body?.refund_type);
  const eventSource = normalizeLower(body?.event_source || 'admin_preview');
  return {
    orderNumber: normalizeOrderNumber(body?.order_number || body?.shopify_order_number),
    customerAppOrderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id || body?.order_id),
    nativeOrderId: normalizeText(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id),
    taskId: normalizeText(body?.native_fulfillment_task_id || body?.fulfillment_task_id),
    stripeEventId: normalizeText(body?.stripe_event_id),
    stripeRefundId: normalizeText(body?.stripe_refund_id),
    refundType: G35B_REFUND_TYPES.has(refundType) ? refundType : '',
    rawRefundType: refundType,
    refundAmount: body?.refund_amount === undefined || body?.refund_amount === null || body?.refund_amount === '' ? null : safeNumber(body?.refund_amount, null),
    currency: sanitizeText(body?.refund_currency || body?.currency || 'usd', 20) || 'usd',
    refundReason: sanitizeText(body?.refund_reason, 180),
    eventSource: G35B_EVENT_SOURCES.has(eventSource) ? eventSource : 'admin_preview',
    requestId: sanitizeText(body?.request_id, 120),
  };
}

async function g35bNativeOrders(base44, lookup, customerOrder) {
  const rows = [];
  if (lookup.nativeOrderId) rows.push(...await g33cFilter(base44, 'ShopifyOrder', { id: lookup.nativeOrderId }, '-created_date', 5, { retryEmpty: true }));
  rows.push(...await g33cNativeOrders(base44, lookup.orderNumber || normalizeOrderNumber(customerOrder?.order_number), lookup.customerAppOrderId || customerOrder?.id));
  return g33cUnique(rows);
}

async function g35bLogs(base44, entityName, { orderNumber, customerOrderId, stripeEventId }, limit = 25) {
  const rows = [];
  rows.push(...await g33cLogs(base44, entityName, orderNumber, customerOrderId, limit));
  if (stripeEventId) {
    rows.push(...await g33cFilter(base44, entityName, { stripe_event_id: stripeEventId }, '-created_date', limit));
    rows.push(...await g33cFilter(base44, entityName, { related_stripe_event_id: stripeEventId }, '-created_date', limit));
    rows.push(...await g33cFilter(base44, entityName, { event_id: stripeEventId }, '-created_date', limit));
  }
  return g33cUnique(rows);
}

function g35bSafeRowSummary(row) {
  return {
    id: row?.id || null,
    status: sanitizeText(row?.status || row?.sync_status || row?.review_status || row?.action, 120),
    action: sanitizeText(row?.action || row?.hub_action || row?.command_type, 120),
    error_code: sanitizeText(row?.error_code, 120),
    request_id_present: Boolean(row?.request_id),
    stripe_event_id_present: Boolean(row?.stripe_event_id || row?.related_stripe_event_id || row?.event_id),
  };
}

function g35bOrderSourceMatches(source, orderNumber, customerOrderId, nativeOrderId, taskId) {
  if (!source) return false;
  if (customerOrderId && [source.order_id, source.base44_order_id, source.customer_app_order_id, source.source_order_id, source.source_customer_app_order_id].includes(customerOrderId)) return true;
  if (nativeOrderId && [source.native_shopify_order_id, source.shopify_order_id, source.native_order_id, source.source_native_shopify_order_id, source.source_shopify_order_id].includes(nativeOrderId)) return true;
  if (taskId && [source.native_fulfillment_task_id, source.fulfillment_task_id, source.source_fulfillment_task_id].includes(taskId)) return true;
  if (orderNumber) {
    const key = g33cOrderKey(orderNumber);
    return [source.order_number, source.shopify_order_number, source.source_order_number, source.customer_order_number, source.hub_order_number].some(value => g33cOrderKey(value) === key);
  }
  return false;
}

function g35dArrayValues(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function g35dValueEqualsId(value, id) {
  if (!id) return false;
  return g35dArrayValues(value).some(candidate => normalizeText(candidate) === id);
}

function g35dValueEqualsOrderNumber(value, orderKey) {
  if (!orderKey) return false;
  return g35dArrayValues(value).some(candidate => g33cOrderKey(candidate) === orderKey);
}

function g35dBatchMatchInfo(batch, { orderNumber, customerOrderId, nativeOrderId, taskId }) {
  const methods = new Set();
  const orderKey = g33cOrderKey(orderNumber);
  if (customerOrderId && [
    batch?.base44_order_id,
    batch?.order_id,
    batch?.customer_app_order_id,
    batch?.source_order_id,
    batch?.source_customer_app_order_id,
  ].some(value => g35dValueEqualsId(value, customerOrderId))) methods.add('customer_app_order_id');
  if (nativeOrderId && [
    batch?.native_shopify_order_id,
    batch?.shopify_order_id,
    batch?.source_native_shopify_order_id,
  ].some(value => g35dValueEqualsId(value, nativeOrderId))) methods.add('native_shopify_order_id');
  if (taskId && [
    batch?.native_fulfillment_task_id,
    batch?.fulfillment_task_id,
    batch?.source_fulfillment_task_id,
  ].some(value => g35dValueEqualsId(value, taskId))) methods.add('native_fulfillment_task_id');
  if (orderKey && [
    batch?.order_number,
    batch?.shopify_order_number,
    batch?.source_order_number,
    batch?.customer_order_number,
    batch?.hub_order_number,
    batch?.source_order_numbers,
  ].some(value => g35dValueEqualsOrderNumber(value, orderKey))) methods.add('order_number');

  const sources = Array.isArray(batch?.order_sources) ? batch.order_sources : [];
  if (sources.some(source => g35bOrderSourceMatches(source, orderNumber, customerOrderId, nativeOrderId, taskId))) {
    methods.add('order_sources');
  }

  const normalizedOrder = normalizeOrderNumber(orderNumber).toUpperCase();
  const batchId = normalizeText(batch?.batch_id).toUpperCase();
  if (normalizedOrder && batchId.includes(`NATIVE-${normalizedOrder}`)) {
    methods.add('deterministic_native_batch_id');
  }

  return {
    matched: methods.size > 0,
    methods: [...methods],
  };
}

function g35dUniqueAnnotated(rows) {
  const byKey = new Map();
  for (const row of rows || []) {
    if (!row) continue;
    const key = row?.id || row?.batch_id || JSON.stringify(row).slice(0, 160);
    const methods = Array.isArray(row.__g35d_linkage_methods) ? row.__g35d_linkage_methods : [];
    if (!byKey.has(key)) {
      byKey.set(key, { ...row, __g35d_linkage_methods: [...methods] });
      continue;
    }
    const existing = byKey.get(key);
    existing.__g35d_linkage_methods = [...new Set([...(existing.__g35d_linkage_methods || []), ...methods])];
  }
  return [...byKey.values()];
}

function g35dDateOnly(value) {
  const text = normalizeText(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function g35dShiftDate(dateText, offsetDays) {
  const dateOnly = g35dDateOnly(dateText);
  if (!dateOnly) return '';
  const [year, month, day] = dateOnly.split('-').map(value => Number(value));
  if (!year || !month || !day) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function g35dRefundBatchCandidateDates(...rows) {
  const seeds = [];
  for (const row of rows || []) {
    if (!row) continue;
    seeds.push(
      row.production_date,
      row.planned_production_date,
      row.juice_date,
      row.delivery_date,
      row.scheduled_date,
      row.scheduled_delivery_date,
      row.fulfillment_date,
    );
  }
  const dates = new Set();
  for (const seed of seeds) {
    const dateOnly = g35dDateOnly(seed);
    if (!dateOnly) continue;
    for (let offset = -3; offset <= 3; offset += 1) {
      const shifted = g35dShiftDate(dateOnly, offset);
      if (shifted) dates.add(shifted);
    }
  }
  return [...dates].sort();
}

async function g35dRefundBatches(base44, orderNumber, customerOrderId, nativeOrderId, taskId, context = {}) {
  const rows = [];
  if (customerOrderId) {
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { base44_order_id: customerOrderId }, '-production_date', 50));
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { order_id: customerOrderId }, '-production_date', 50));
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { customer_app_order_id: customerOrderId }, '-production_date', 50));
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { source_order_id: customerOrderId }, '-production_date', 50));
  }
  if (nativeOrderId) {
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { native_shopify_order_id: nativeOrderId }, '-production_date', 50));
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { shopify_order_id: nativeOrderId }, '-production_date', 50));
  }
  if (taskId) {
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { native_fulfillment_task_id: taskId }, '-production_date', 50));
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { fulfillment_task_id: taskId }, '-production_date', 50));
  }
  if (orderNumber) {
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { order_number: orderNumber }, '-production_date', 50));
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { shopify_order_number: orderNumber }, '-production_date', 50));
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { source_order_number: orderNumber }, '-production_date', 50));
  }
  const candidateDates = Array.isArray(context?.candidateDates) ? context.candidateDates : [];
  for (const productionDate of candidateDates) {
    rows.push(...await g33cFilter(base44, 'ProductionBatch', { production_date: productionDate }, '-production_date', 100, { retryEmpty: true }));
  }

  const listed = await g33cList(base44, 'ProductionBatch', '-production_date', 1000);
  rows.push(...listed);

  return g35dUniqueAnnotated(rows.flatMap(batch => {
    const match = g35dBatchMatchInfo(batch, { orderNumber, customerOrderId, nativeOrderId, taskId });
    return match.matched ? [{ ...batch, __g35d_linkage_methods: match.methods }] : [];
  }));
}

async function g35dRefundBatchesWithRetry(base44, orderNumber, customerOrderId, nativeOrderId, taskId, context = {}) {
  let batches = await g35dRefundBatches(base44, orderNumber, customerOrderId, nativeOrderId, taskId, context);
  if (batches.length > 0 || !(orderNumber || customerOrderId || nativeOrderId || taskId)) return batches;
  await g35dSleep(300);
  batches = await g35dRefundBatches(base44, orderNumber, customerOrderId, nativeOrderId, taskId, context);
  return batches;
}

function g35dComplianceMatchInfo(log, batches, allowProductDateFallback = true) {
  const methods = new Set();
  for (const batch of batches || []) {
    if (batch?.compliance_log_id && normalizeText(log?.id) === normalizeText(batch.compliance_log_id)) methods.add('production_batch_compliance_log_id');
    if (batch?.id && normalizeText(log?.source_production_batch_id) === normalizeText(batch.id)) methods.add('source_production_batch_id');
    if (batch?.batch_id && normalizeText(log?.batch_id) === normalizeText(batch.batch_id)) methods.add('batch_id');
    if (allowProductDateFallback && methods.size === 0) {
      const logDate = normalizeText(log?.date || log?.production_date);
      const batchDate = normalizeText(batch?.production_date);
      const logProduct = normalizeLower(log?.juice_flavor || log?.product_name);
      const batchProduct = normalizeLower(batch?.product_name);
      if (logDate && batchDate && logDate === batchDate && logProduct && batchProduct && logProduct === batchProduct) {
        methods.add('product_name_production_date_supporting_context');
      }
    }
  }
  return {
    matched: methods.size > 0,
    methods: [...methods],
  };
}

async function g35dRefundComplianceLogs(base44, batches) {
  const rows = [];
  for (const batch of batches || []) {
    if (batch?.compliance_log_id) rows.push(...await g33cFilter(base44, 'BatchComplianceLog', { id: batch.compliance_log_id }, '-created_date', 5, { retryEmpty: true }));
    if (batch?.batch_id) rows.push(...await g33cFilter(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 10, { retryEmpty: true }));
    if (batch?.id) rows.push(...await g33cFilter(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 10, { retryEmpty: true }));
  }

  const listed = await g33cList(base44, 'BatchComplianceLog', '-created_date', 1000);
  rows.push(...listed);

  return g35dUniqueAnnotated(rows.flatMap(log => {
    const match = g35dComplianceMatchInfo(log, batches);
    return match.matched ? [{ ...log, __g35d_linkage_methods: match.methods }] : [];
  }));
}

async function g35dRefundComplianceLogsWithRetry(base44, batches) {
  let logs = await g35dRefundComplianceLogs(base44, batches);
  if (!Array.isArray(batches) || batches.length === 0 || logs.length >= batches.length) return logs;
  await g35dSleep(300);
  logs = await g35dRefundComplianceLogs(base44, batches);
  return logs;
}

function g35hStableRowKey(row, fallbackKey = '') {
  return normalizeText(row?.id || row?.batch_id || row?.request_id || fallbackKey);
}

function g35hStableKey(rows, fallbackPrefix = 'row') {
  const keys = (rows || []).map((row, index) => g35hStableRowKey(row, `${fallbackPrefix}_${index}`)).filter(Boolean).sort();
  return keys.join('|');
}

function g35hReadSectionConsensus(contexts, section, getKey, expectedPresent = false) {
  const keys = contexts.map(context => normalizeText(getKey(context)));
  const counts = new Map();
  for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
  const nonEmptyEntries = [...counts.entries()].filter(([key]) => Boolean(key));
  const emptyCount = counts.get('') || 0;
  const bestNonEmpty = nonEmptyEntries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
  let stable = false;
  let selectedKey = '';
  if (bestNonEmpty && bestNonEmpty[1] >= 2) {
    stable = true;
    selectedKey = bestNonEmpty[0];
  } else if (!bestNonEmpty && !expectedPresent) {
    stable = true;
    selectedKey = '';
  } else if (nonEmptyEntries.length === 1 && emptyCount === 0) {
    stable = true;
    selectedKey = nonEmptyEntries[0][0];
  }

  return {
    section,
    stable,
    selected_key: selectedKey,
    observed_keys: [...new Set(keys)].filter(Boolean).slice(0, 8),
    empty_attempts: emptyCount,
    non_empty_attempts: keys.length - emptyCount,
  };
}

function g35hContextScore(context) {
  return (
    (context?.customerOrder?.id ? 1000 : 0) +
    (context?.nativeOrder?.id ? 1000 : 0) +
    (context?.task?.id ? 1000 : 0) +
    ((context?.batches || []).length * 100) +
    ((context?.complianceLogs || []).length * 50)
  );
}

function g35hBuildReadConsistency(contexts, lookup) {
  const expectedIdentifiersSupplied = Boolean(lookup.customerAppOrderId || lookup.nativeOrderId || lookup.taskId);
  const sections = {
    order: g35hReadSectionConsensus(contexts, 'order', context => context?.customerOrder?.id, Boolean(lookup.customerAppOrderId)),
    native_order: g35hReadSectionConsensus(contexts, 'native_order', context => context?.nativeOrder?.id, Boolean(lookup.nativeOrderId)),
    task: g35hReadSectionConsensus(contexts, 'task', context => context?.task?.id, Boolean(lookup.taskId)),
    batch: g35hReadSectionConsensus(contexts, 'batch', context => g35hStableKey(context?.batches, 'batch'), false),
    compliance: g35hReadSectionConsensus(contexts, 'compliance', context => g35hStableKey(context?.complianceLogs, 'compliance'), false),
  };
  const inconsistentSections = Object.values(sections).filter(section => !section.stable).map(section => section.section);
  const stable = inconsistentSections.length === 0;
  const rankedContexts = contexts
    .map((context, index) => ({ context, index, score: g35hContextScore(context) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selectedIndex = rankedContexts[0]?.index || 0;
  const fallbackUsed = [];
  for (const section of Object.values(sections)) {
    if (section.empty_attempts > 0 && section.non_empty_attempts > 0) fallbackUsed.push(`${section.section}_empty_read_recovered_or_detected`);
  }
  return {
    stable,
    attempts: contexts.length,
    selected_attempt: selectedIndex + 1,
    order_read_stable: sections.order.stable,
    native_order_read_stable: sections.native_order.stable,
    task_read_stable: sections.task.stable,
    batch_read_stable: sections.batch.stable,
    compliance_read_stable: sections.compliance.stable,
    expected_identifiers_supplied: expectedIdentifiersSupplied,
    exact_customer_app_order_id_supplied: Boolean(lookup.customerAppOrderId),
    exact_native_shopify_order_id_supplied: Boolean(lookup.nativeOrderId),
    exact_native_fulfillment_task_id_supplied: Boolean(lookup.taskId),
    inconsistent_sections: inconsistentSections,
    fallback_used: fallbackUsed,
    blocker_required: !stable,
  };
}

function g35hReadConsistencyBlockers(readConsistency) {
  if (readConsistency?.stable) return [];
  const blockers = ['read_consistency_unstable'];
  if (!readConsistency?.order_read_stable) blockers.push('exact_order_read_unstable');
  if (!readConsistency?.native_order_read_stable) blockers.push('native_order_read_unstable');
  if (!readConsistency?.task_read_stable) blockers.push('native_fulfillment_task_read_unstable');
  if (!readConsistency?.batch_read_stable) blockers.push('production_batch_read_unstable');
  if (!readConsistency?.compliance_read_stable) blockers.push('compliance_log_read_unstable');
  return blockers;
}


function g35iPrev1ExactRefundIdentifiersSupplied(lookup) {
  return Boolean(lookup?.orderNumber && lookup?.customerAppOrderId && lookup?.nativeOrderId && lookup?.taskId);
}

function g35iPrev1AnnotateMatchedBatches(rows, { orderNumber, customerOrderId, nativeOrderId, taskId }) {
  return g35dUniqueAnnotated((rows || []).flatMap(batch => {
    const match = g35dBatchMatchInfo(batch, { orderNumber, customerOrderId, nativeOrderId, taskId });
    return match.matched ? [{ ...batch, __g35d_linkage_methods: [...new Set([...(batch.__g35d_linkage_methods || []), ...match.methods, G35I_PREV1_EXACT_READ_FAST_PATH_MARKER, 'g35i_prev1_list_first_batch_match'])] }] : [];
  }));
}

function g35iPrev1AnnotateMatchedComplianceLogs(rows, batches) {
  return g35dUniqueAnnotated((rows || []).flatMap(log => {
    const match = g35dComplianceMatchInfo(log, batches);
    return match.matched ? [{ ...log, __g35d_linkage_methods: [...new Set([...(log.__g35d_linkage_methods || []), ...match.methods, G35I_PREV1_EXACT_READ_FAST_PATH_MARKER, 'g35i_prev1_list_first_compliance_match'])] }] : [];
  }));
}

async function g35iPrev1ExactRefundBatches(base44, { orderNumber, customerOrderId, nativeOrderId, taskId }) {
  const listed = await g33cList(base44, 'ProductionBatch', '-production_date', G35I_PREV1_EXACT_READ_LIST_LIMIT);
  const listMatches = g35iPrev1AnnotateMatchedBatches(listed, { orderNumber, customerOrderId, nativeOrderId, taskId });
  if (listMatches.length > 0) return listMatches;

  const fallbackRows = [];
  if (customerOrderId) {
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { base44_order_id: customerOrderId }, '-production_date', 25));
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { order_id: customerOrderId }, '-production_date', 25));
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { customer_app_order_id: customerOrderId }, '-production_date', 25));
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { source_order_id: customerOrderId }, '-production_date', 25));
  }
  if (nativeOrderId) {
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { native_shopify_order_id: nativeOrderId }, '-production_date', 25));
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { shopify_order_id: nativeOrderId }, '-production_date', 25));
  }
  if (taskId) {
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { native_fulfillment_task_id: taskId }, '-production_date', 25));
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { fulfillment_task_id: taskId }, '-production_date', 25));
  }
  if (orderNumber) {
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { order_number: orderNumber }, '-production_date', 25));
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { shopify_order_number: orderNumber }, '-production_date', 25));
    fallbackRows.push(...await g33cFilter(base44, 'ProductionBatch', { source_order_number: orderNumber }, '-production_date', 25));
  }
  return g35iPrev1AnnotateMatchedBatches(fallbackRows, { orderNumber, customerOrderId, nativeOrderId, taskId });
}

async function g35iPrev1ExactRefundComplianceLogs(base44, batches) {
  const listed = await g33cList(base44, 'BatchComplianceLog', '-created_date', G35I_PREV1_EXACT_READ_LIST_LIMIT);
  const listMatches = g35iPrev1AnnotateMatchedComplianceLogs(listed, batches);
  if (!Array.isArray(batches) || batches.length === 0 || listMatches.length >= batches.length) return listMatches;

  const fallbackRows = [];
  for (const batch of batches || []) {
    if (batch?.compliance_log_id) fallbackRows.push(...await g33cFilter(base44, 'BatchComplianceLog', { id: batch.compliance_log_id }, '-created_date', 5));
    if (batch?.batch_id) fallbackRows.push(...await g33cFilter(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 10));
    if (batch?.id) fallbackRows.push(...await g33cFilter(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 10));
  }
  return g35iPrev1AnnotateMatchedComplianceLogs([...listMatches, ...fallbackRows], batches);
}

async function g35hResolveRefundReadContextExactFast(base44, lookup) {
  const exactOrderRows = await g33cFilter(base44, 'Order', { id: lookup.customerAppOrderId }, '-created_date', 1, { retryEmpty: true });
  let customerOrder = exactOrderRows[0] || null;
  if (!customerOrder && lookup.orderNumber) {
    const fallbackOrderRows = await g33cFilter(base44, 'Order', { order_number: lookup.orderNumber }, '-created_date', 5, { retryEmpty: true });
    customerOrder = fallbackOrderRows[0] || null;
  }

  const exactNativeRows = await g33cFilter(base44, 'ShopifyOrder', { id: lookup.nativeOrderId }, '-created_date', 1, { retryEmpty: true });
  let nativeOrder = exactNativeRows[0] || null;
  if (!nativeOrder && customerOrder?.id) {
    const fallbackNativeRows = await g33cFilter(base44, 'ShopifyOrder', { base44_order_id: customerOrder.id }, '-created_date', 5, { retryEmpty: true });
    nativeOrder = fallbackNativeRows.find(row => normalizeText(row?.id) === lookup.nativeOrderId) || fallbackNativeRows[0] || null;
  }

  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || nativeOrder?.shopify_order_number || lookup.orderNumber);
  const customerOrderId = normalizeText(customerOrder?.id || lookup.customerAppOrderId || nativeOrder?.base44_order_id);
  const nativeOrderId = normalizeText(nativeOrder?.id || lookup.nativeOrderId);

  const exactTaskRows = await g33cFilter(base44, 'FulfillmentTask', { id: lookup.taskId }, '-created_date', 1, { retryEmpty: true });
  let task = exactTaskRows[0] || null;
  if (!task && (orderNumber || customerOrderId || nativeOrderId)) {
    const fallbackTasks = await g33cTasks(base44, orderNumber, customerOrderId, nativeOrderId, lookup.taskId);
    task = fallbackTasks.find(row => normalizeText(row?.id) === lookup.taskId) || fallbackTasks[0] || null;
  }
  const taskId = normalizeText(task?.id || lookup.taskId);

  const batches = await g35iPrev1ExactRefundBatches(base44, { orderNumber, customerOrderId, nativeOrderId, taskId });
  const complianceLogs = await g35iPrev1ExactRefundComplianceLogs(base44, batches);

  return {
    customerOrder,
    nativeOrder,
    task,
    orderNumber,
    customerOrderId,
    nativeOrderId,
    taskId,
    batches,
    complianceLogs,
    orderFound: Boolean(customerOrder?.id || nativeOrder?.id || task?.id),
    exact_id_fast_path_used: true,
    exact_id_fast_path_marker: G35I_PREV1_EXACT_READ_FAST_PATH_MARKER,
  };
}

async function g35hResolveRefundReadContext(base44, lookup) {
  const initialCustomerOrders = await g33cCustomerOrders(base44, { orderNumber: lookup.orderNumber, customerAppOrderId: lookup.customerAppOrderId });
  let customerOrder = initialCustomerOrders[0] || null;
  let nativeOrders = await g35bNativeOrders(base44, lookup, customerOrder);
  let nativeOrder = nativeOrders[0] || null;
  if (!customerOrder && nativeOrder?.base44_order_id) {
    const byNativeCustomer = await g33cCustomerOrders(base44, { orderNumber: normalizeOrderNumber(nativeOrder?.shopify_order_number || lookup.orderNumber), customerAppOrderId: nativeOrder.base44_order_id });
    customerOrder = byNativeCustomer[0] || null;
  }
  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || nativeOrder?.shopify_order_number || lookup.orderNumber);
  const customerOrderId = normalizeText(customerOrder?.id || lookup.customerAppOrderId || nativeOrder?.base44_order_id);
  if (!nativeOrder && (orderNumber || customerOrderId || lookup.nativeOrderId)) {
    nativeOrders = await g35bNativeOrders(base44, { ...lookup, orderNumber, customerAppOrderId: customerOrderId }, customerOrder);
    nativeOrder = nativeOrders[0] || null;
  }
  const nativeOrderId = nativeOrder?.id || lookup.nativeOrderId;
  const tasks = await g33cTasks(base44, orderNumber, customerOrderId, nativeOrderId, lookup.taskId);
  const task = tasks[0] || null;
  const taskId = task?.id || lookup.taskId;
  const batchCandidateDates = g35dRefundBatchCandidateDates(customerOrder, nativeOrder, task);
  const batches = await g35dRefundBatchesWithRetry(base44, orderNumber, customerOrderId, nativeOrderId, taskId, { candidateDates: batchCandidateDates });
  const complianceLogs = await g35dRefundComplianceLogsWithRetry(base44, batches);
  return {
    customerOrder,
    nativeOrder,
    task,
    orderNumber,
    customerOrderId,
    nativeOrderId,
    taskId,
    batches,
    complianceLogs,
    orderFound: Boolean(customerOrder?.id || nativeOrder?.id || task?.id),
  };
}

async function g35hResolveRefundReadContextStable(base44, lookup) {
  const contexts = [];
  const exactFastPath = g35iPrev1ExactRefundIdentifiersSupplied(lookup);
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    contexts.push(exactFastPath
      ? await g35hResolveRefundReadContextExactFast(base44, lookup)
      : await g35hResolveRefundReadContext(base44, lookup));
    if (attempt < attempts) await g35dSleep(exactFastPath ? 100 : 250);
  }
  const readConsistency = {
    ...g35hBuildReadConsistency(contexts, lookup),
    exact_id_fast_path_used: exactFastPath,
    exact_id_fast_path_marker: exactFastPath ? G35I_PREV1_EXACT_READ_FAST_PATH_MARKER : null,
    exact_id_bounded_list_limit: exactFastPath ? G35I_PREV1_EXACT_READ_LIST_LIMIT : null,
  };
  const selected = contexts[(readConsistency.selected_attempt || 1) - 1] || contexts[0] || {};
  return { ...selected, readConsistency, exact_id_fast_path_used: exactFastPath, exact_id_fast_path_marker: exactFastPath ? G35I_PREV1_EXACT_READ_FAST_PATH_MARKER : null };
}

function g35dStatusSummary(rows) {
  const counts = {};
  for (const row of rows || []) {
    const status = sanitizeText(row?.status || row?.lifecycle_status || row?.production_status || row?.overall_status || row?.result || 'unknown', 80) || 'unknown';
    counts[status] = (counts[status] || 0) + 1;
  }
  return counts;
}

function g35bBatchSourceImpact(batch, { orderNumber, customerOrderId, nativeOrderId, taskId }) {
  const sources = Array.isArray(batch?.order_sources) ? batch.order_sources : [];
  const matchingSources = sources.filter(source => g35bOrderSourceMatches(source, orderNumber, customerOrderId, nativeOrderId, taskId));
  const unitsToSubtract = matchingSources.reduce((sum, source) => sum + safeNumber(source?.quantity, 0), 0);
  return {
    id: batch?.id || null,
    batch_id: sanitizeText(batch?.batch_id, 120),
    status: sanitizeText(batch?.status || batch?.lifecycle_status || batch?.production_status, 120),
    planned_units: safeNumber(batch?.planned_units, 0),
    production_date: sanitizeText(batch?.production_date, 40),
    product_name: sanitizeText(batch?.product_name, 120),
    linkage_methods: Array.isArray(batch?.__g35d_linkage_methods) ? batch.__g35d_linkage_methods.slice(0, 8) : [],
    order_source_count: sources.length,
    matching_order_source_count: matchingSources.length,
    matching_units: unitsToSubtract,
  };
}

function g35dComplianceLogSummary(row) {
  return {
    id: row?.id || null,
    batch_id: sanitizeText(row?.batch_id, 120),
    source_production_batch_id_present: Boolean(row?.source_production_batch_id),
    locked: row?.locked === true,
    status: sanitizeText(row?.status || row?.overall_status || row?.result, 80),
    date: sanitizeText(row?.date || row?.production_date, 40),
    product_name: sanitizeText(row?.juice_flavor || row?.product_name, 120),
    linkage_methods: Array.isArray(row?.__g35d_linkage_methods) ? row.__g35d_linkage_methods.slice(0, 8) : [],
  };
}

function g35bLifecycleState({ customerOrder, nativeOrder, task, batches, complianceLogs }) {
  const customerStatus = normalizeLower(customerOrder?.status);
  const taskStatus = normalizeLower(task?.status);
  const taskDeliveryStatus = normalizeLower(task?.delivery_status);
  const nativeProduction = normalizeLower(nativeOrder?.production_status);
  const batchStatuses = (batches || []).map(batch => normalizeLower(batch?.status || batch?.lifecycle_status || batch?.production_status));
  const historical = normalizeLower(nativeOrder?.source_type) === 'hub_historical_backfill' || normalizeLower(nativeOrder?.operational_visibility) === 'historical_backfill';

  if (historical) return 'historical_fulfilled';
  if (['delivered', 'fulfilled', 'completed'].includes(customerStatus) || ['delivered', 'completed'].includes(taskStatus) || ['delivered', 'completed'].includes(taskDeliveryStatus)) return 'delivered';
  if ((complianceLogs || []).length > 0 || batchStatuses.some(status => status.includes('verified'))) return 'production_verified';
  if (batchStatuses.some(status => status.includes('complete'))) return 'production_completed';
  if (batchStatuses.some(status => status.includes('progress') || status.includes('started') || status.includes('active'))) return 'production_started';
  if ((batches || []).length > 0) return 'production_batches_planned';
  if (['packed', 'bottled_packed', 'ready_for_delivery', 'ready'].includes(taskStatus) || nativeProduction === 'bottled') return 'task_packed';
  if (task?.id) return 'task_scheduled_or_packed';
  if (nativeOrder?.id) return 'native_order_created_only';
  return 'before_native_ops';
}

function g35bRiskLevel(lifecycleState) {
  if (['before_native_ops', 'native_order_created_only'].includes(lifecycleState)) return 'low_risk_preview_only';
  if (['task_scheduled_or_packed', 'task_packed', 'production_batches_planned'].includes(lifecycleState)) return 'review_required';
  if (['production_started', 'production_completed', 'production_verified'].includes(lifecycleState)) return 'high_risk_manual_only';
  if (['delivered', 'historical_fulfilled'].includes(lifecycleState)) return 'do_not_auto_cancel';
  return 'review_required';
}

function g35bSchemaCompatibility(refundType) {
  const schemaGapBlockers = [];
  if (refundType === 'full' || refundType === 'unknown') {
    if (!G35B_STATUS_SCHEMA_COMPATIBILITY.customer_order_status_refund_value_supported) schemaGapBlockers.push('customer_order_status_refund_value_unsupported');
    if (!G35B_STATUS_SCHEMA_COMPATIBILITY.customer_order_cancelled_value_supported) schemaGapBlockers.push('customer_order_cancelled_value_unsupported');
  }
  return {
    ...G35B_STATUS_SCHEMA_COMPATIBILITY,
    schema_gap_blockers: schemaGapBlockers,
  };
}

function g35kAlreadyRefundedOrTerminal(customerOrder, nativeOrder) {
  const customerPayment = normalizeLower(customerOrder?.payment_status || customerOrder?.financial_status);
  const nativePayment = normalizeLower(nativeOrder?.payment_status || nativeOrder?.financial_status);
  const customerRefundStatus = normalizeLower(customerOrder?.refund_status);
  const nativeRefundStatus = normalizeLower(nativeOrder?.refund_status);
  return Boolean(
    customerOrder?.do_not_recover === true
    || nativeOrder?.do_not_recover === true
    || ['refunded', 'fully_refunded'].includes(customerPayment)
    || ['refunded', 'fully_refunded'].includes(nativePayment)
    || ['fully_refunded', 'ignored_duplicate'].includes(customerRefundStatus)
    || ['fully_refunded', 'ignored_duplicate'].includes(nativeRefundStatus)
  );
}

function g35bNextAction({ refundType, orderFound, duplicateEventDetected, subscriptionOrMulti, lifecycleState, alreadyRefundedOrTerminal }) {
  if (duplicateEventDetected) return 'duplicate_refund_event_detected';
  if (!orderFound) return 'unknown_order_review_required';
  if (subscriptionOrMulti) return 'unsupported_subscription_refund';
  if (alreadyRefundedOrTerminal) return 'already_refunded_or_terminal_review_required';
  if (refundType === 'partial') return 'partial_refund_review_required';
  if (['delivered', 'historical_fulfilled'].includes(lifecycleState)) return 'delivered_refund_manual_review_required';
  if (['production_started', 'production_completed', 'production_verified'].includes(lifecycleState)) return `${lifecycleState}_manual_review_required`;
  if (lifecycleState === 'production_batches_planned' && refundType === 'full') return 'full_refund_preview_ready_batch_recalculation_impact';
  if (lifecycleState === 'task_scheduled_or_packed' && refundType === 'full') return 'full_refund_preview_ready_task_cancellation_impact';
  if (lifecycleState === 'task_packed' && refundType === 'full') return 'full_refund_review_required_task_packed';
  if (['before_native_ops', 'native_order_created_only'].includes(lifecycleState) && refundType === 'full') return 'native_refund_preview_ready_full_refund_pre_production';
  return 'hold_hub_refund_source_of_truth';
}

function g35kStatusSchemaPolicyNotes() {
  return [
    'customer_order_status_refund_value_unsupported_policy_note',
    'customer_order_cancelled_value_unsupported_policy_note',
    'customer_order_status_lifecycle_facing',
    'refund_state_uses_payment_refund_fields',
    G35K_FULL_REFUND_PREPRODUCTION_MARKER,
  ];
}

function g35kRefundSource(lookup) {
  if (lookup?.eventSource === 'stripe_webhook' || lookup?.eventSource === 'stripe_webhook_shadow') return 'stripe_webhook';
  if (lookup?.eventSource === 'admin_preview') return 'admin';
  if (lookup?.eventSource === 'test_fixture') return 'test_fixture';
  return sanitizeText(lookup?.eventSource || 'admin', 80);
}

function g35kLifecycleReviewRequired(lifecycleState) {
  return !['before_native_ops', 'native_order_created_only'].includes(lifecycleState);
}

function g35kFullRefundFieldPreview({ lookup, lifecycleState }) {
  const reviewRequired = g35kLifecycleReviewRequired(lifecycleState);
  return {
    refund_status: reviewRequired ? 'review_required' : 'fully_refunded',
    refund_type: 'full',
    refund_amount: lookup?.refundAmount,
    refund_currency: lookup?.currency,
    refunded_at: null,
    refund_source: g35kRefundSource(lookup),
    refund_event_id: lookup?.stripeEventId || lookup?.requestId || null,
    stripe_refund_id: lookup?.stripeRefundId || null,
    refund_reason: lookup?.refundReason || (reviewRequired ? 'full_refund_requires_manual_review' : 'full_refund_preproduction_preview'),
    refund_review_required: reviewRequired,
    refund_review_status: reviewRequired ? 'pending' : 'none',
  };
}

function g35kRefundSpecificFieldsAvailable() {
  return {
    order_refund_fields_available: true,
    native_shopify_order_refund_fields_available: true,
    customer_order_status_refund_values_required: false,
    customer_order_status_cancel_values_required: false,
  };
}

function g35kFullRefundPreviewReady({ refundType, orderFound, duplicateEventDetected, subscriptionOrMulti, alreadyRefundedOrTerminal, lifecycleState, readConsistencyBlockers, requestBlockers }) {
  return refundType === 'full'
    && orderFound
    && !duplicateEventDetected
    && !subscriptionOrMulti
    && !alreadyRefundedOrTerminal
    && (readConsistencyBlockers || []).length === 0
    && (requestBlockers || []).length === 0
    && ['before_native_ops', 'native_order_created_only', 'task_scheduled_or_packed', 'production_batches_planned'].includes(lifecycleState);
}

function g35bCustomerOrderImpact({ customerOrder, refundType, lookup, lifecycleState }) {
  const present = Boolean(customerOrder?.id);
  if (!present) return { present: false, proposed_action: 'none_unknown_order_review_required' };
  if (refundType === 'partial') {
    return {
      present: true,
      proposed_action: 'hold_customer_order_mutation_review_only',
      current_status: sanitizeText(customerOrder?.status, 80),
      current_payment_status: sanitizeText(customerOrder?.payment_status || customerOrder?.financial_status, 80),
      would_update_customer_status: false,
      would_update_payment_status: false,
      reason: 'partial_refund_review_required',
    };
  }
  return {
    present: true,
    proposed_action: 'preview_full_refund_customer_refund_field_impact',
    current_status: sanitizeText(customerOrder?.status, 80),
    status_mutation_proposed: false,
    proposed_status: null,
    proposed_status_supported: false,
    customer_order_status_policy: 'lifecycle_status_not_used_for_refunds',
    current_payment_status: sanitizeText(customerOrder?.payment_status || customerOrder?.financial_status, 80),
    proposed_payment_status: 'refunded',
    proposed_financial_status: 'refunded',
    proposed_payment_captured: false,
    proposed_refund_fields: g35kFullRefundFieldPreview({ lookup, lifecycleState }),
    status_history_append_preview: 'refund_event_summary_only_requires_live_policy_approval',
    would_update_now: false,
  };
}

function g35bNativeOrderImpact({ nativeOrder, refundType, lookup, lifecycleState }) {
  const present = Boolean(nativeOrder?.id);
  if (!present) return { present: false, proposed_action: 'none_native_order_missing' };
  if (refundType === 'partial') {
    return {
      present: true,
      proposed_action: 'hold_native_order_mutation_review_only',
      current_payment_status: sanitizeText(nativeOrder?.payment_status || nativeOrder?.financial_status, 80),
      current_production_status: sanitizeText(nativeOrder?.production_status, 80),
      current_fulfillment_status: sanitizeText(nativeOrder?.fulfillment_status || nativeOrder?.shopify_fulfillment_status, 80),
      would_update_now: false,
    };
  }
  const terminalOrHistory = ['production_started', 'production_completed', 'production_verified', 'delivered', 'historical_fulfilled'].includes(lifecycleState);
  return {
    present: true,
    proposed_action: terminalOrHistory ? 'hold_native_order_status_mutation_manual_review_only' : 'preview_full_refund_native_order_refund_field_impact',
    current_payment_status: sanitizeText(nativeOrder?.payment_status || nativeOrder?.financial_status, 80),
    proposed_payment_status: 'refunded',
    payment_status_mutation_preview_only: true,
    current_production_status: sanitizeText(nativeOrder?.production_status, 80),
    proposed_production_status: terminalOrHistory ? null : 'canceled',
    production_status_mutation_proposed: false,
    current_fulfillment_status: sanitizeText(nativeOrder?.fulfillment_status || nativeOrder?.shopify_fulfillment_status, 80),
    proposed_fulfillment_status: terminalOrHistory ? null : 'cancelled',
    fulfillment_status_mutation_proposed: false,
    proposed_refund_fields: g35kFullRefundFieldPreview({ lookup, lifecycleState }),
    refunded_at_required_before_live_command: true,
    would_update_now: false,
  };
}

function g35bTaskImpact({ task, refundType, lifecycleState }) {
  const present = Boolean(task?.id);
  if (!present) return { present: false, proposed_action: 'none_task_missing' };
  const terminalDelivered = ['delivered', 'historical_fulfilled'].includes(lifecycleState) || ['delivered', 'completed'].includes(normalizeLower(task?.status)) || ['delivered', 'completed'].includes(normalizeLower(task?.delivery_status));
  if (refundType === 'partial') {
    return {
      present: true,
      proposed_action: 'hold_task_mutation_review_only',
      current_status: sanitizeText(task?.status, 80),
      current_delivery_status: sanitizeText(task?.delivery_status, 80),
      would_cancel_task: false,
    };
  }
  return {
    present: true,
    proposed_action: terminalDelivered ? 'do_not_auto_cancel_delivered_or_completed_task' : 'preview_task_cancellation_impact',
    current_status: sanitizeText(task?.status, 80),
    proposed_status: terminalDelivered ? null : 'cancelled',
    current_delivery_status: sanitizeText(task?.delivery_status, 80),
    proposed_delivery_status: terminalDelivered ? null : 'cancelled',
    cancellation_held: true,
    would_cancel_task: false,
  };
}

function g35bProductionBatchImpact({ batches, complianceLogs, refundType, lifecycleState, orderNumber, customerOrderId, nativeOrderId, taskId }) {
  const batchRows = (batches || []).map(batch => g35bBatchSourceImpact(batch, { orderNumber, customerOrderId, nativeOrderId, taskId }));
  const compliancePresent = (complianceLogs || []).length > 0;
  const highRisk = ['production_started', 'production_completed', 'production_verified', 'delivered', 'historical_fulfilled'].includes(lifecycleState) || compliancePresent;
  const reviewOnly = refundType === 'partial' || highRisk;
  const verifiedLoggedBatchCount = batchRows.filter(row => normalizeLower(row.status) === 'verified_logged').length;
  const lockedComplianceLogCount = (complianceLogs || []).filter(log => log?.locked === true).length;
  const batchLinkageMethods = [...new Set(batchRows.flatMap(row => row.linkage_methods || []))];
  const complianceLinkageMethods = [...new Set((complianceLogs || []).flatMap(row => Array.isArray(row?.__g35d_linkage_methods) ? row.__g35d_linkage_methods : []))];
  const batchLinkageWarnings = [];
  if (batchRows.length === 0) batchLinkageWarnings.push('no_related_production_batches_found');
  if (batchLinkageMethods.includes('deterministic_native_batch_id')) batchLinkageWarnings.push('deterministic_native_batch_id_linkage_used');
  const complianceWarnings = [];
  if (batchRows.length > 0 && (complianceLogs || []).length === 0) complianceWarnings.push('no_related_batch_compliance_logs_found');
  if (complianceLinkageMethods.includes('product_name_production_date_supporting_context')) complianceWarnings.push('compliance_linked_by_product_date_supporting_context');
  const impactClassification = batchRows.length === 0
    ? 'not_applicable_no_production_batches'
    : ['delivered', 'historical_fulfilled'].includes(lifecycleState) && (verifiedLoggedBatchCount > 0 || lockedComplianceLogCount > 0)
      ? 'delivered_refund_manual_review_required_with_verified_batches'
      : (verifiedLoggedBatchCount > 0 || compliancePresent)
        ? 'compliance_history_preserved_no_auto_mutation'
        : reviewOnly
          ? 'manual_review_required_no_auto_mutation'
          : 'pre_production_batch_impact_preview_only';
  return {
    production_batch_count: batchRows.length,
    verified_logged_batch_count: verifiedLoggedBatchCount,
    batch_compliance_log_count: (complianceLogs || []).length,
    locked_compliance_log_count: lockedComplianceLogCount,
    production_batch_rows: batchRows,
    batch_status_summary: g35dStatusSummary(batches),
    batch_linkage_method: batchLinkageMethods,
    batch_linkage_warnings: batchLinkageWarnings,
    production_batch_impact_classification: impactClassification,
    compliance_history_preserved: true,
    compliance_history_mutation_proposed: false,
    compliance_history_preserved_no_auto_mutation: true,
    compliance_log_rows: (complianceLogs || []).map(g35dComplianceLogSummary),
    compliance_linkage_method: complianceLinkageMethods,
    compliance_warnings: complianceWarnings,
    proposed_action: batchRows.length === 0
      ? 'none_no_batches_found'
      : reviewOnly
        ? 'hold_batch_mutation_manual_review_only'
        : 'preview_order_source_removal_and_planned_units_recalculation',
    order_source_removal_preview_rows: batchRows,
    would_remove_order_sources_now: false,
    would_recalculate_planned_units_now: false,
    would_archive_batches_now: false,
    would_remove_order_sources: false,
    would_recalculate_planned_units: false,
    would_archive_batches: false,
    mutation_proposed: false,
    deletion_proposed: false,
  };
}

function g35bReviewQueueImpact({ refundType, orderNumber, customerOrderId, orderFound, lifecycleState, alreadyRefundedOrTerminal }) {
  if (!orderFound) {
    return {
      proposed_action: 'review_queue_preview_for_unknown_order',
      would_create_now: false,
      incident_type: 'refund_received_unknown_order',
      order_number: orderNumber || null,
    };
  }
  if (alreadyRefundedOrTerminal) {
    return {
      proposed_action: 'manual_review_recommended_for_already_refunded_or_terminal_order',
      would_create_now: false,
      incident_type: 'already_refunded_terminal_refund_review',
      order_number: orderNumber || null,
      customer_app_order_id: customerOrderId || null,
    };
  }
  if (refundType === 'partial') {
    return {
      proposed_action: 'partial_refund_review_queue_preview',
      would_create_now: false,
      incident_type: 'partial_refund_received',
      order_number: orderNumber || null,
      customer_app_order_id: customerOrderId || null,
      recommended_action: 'manual_review',
    };
  }
  if (['production_started', 'production_completed', 'production_verified', 'delivered', 'historical_fulfilled'].includes(lifecycleState)) {
    return {
      proposed_action: 'manual_review_recommended_for_late_lifecycle_refund',
      would_create_now: false,
      incident_type: 'full_refund_late_lifecycle_review',
      order_number: orderNumber || null,
      customer_app_order_id: customerOrderId || null,
    };
  }
  return { proposed_action: 'no_review_queue_entry_proposed_for_low_risk_full_refund_preview', would_create_now: false };
}

function g35bIdempotencyStatus({ stripeEventId, orderSyncRows, commandRows }) {
  const syncMatches = (orderSyncRows || []).filter(row => stripeEventId && [row?.stripe_event_id, row?.related_stripe_event_id, row?.event_id].includes(stripeEventId));
  const commandMatches = (commandRows || []).filter(row => stripeEventId && [row?.stripe_event_id, row?.related_stripe_event_id, row?.event_id].includes(stripeEventId));
  const duplicateEventDetected = syncMatches.length > 0 || commandMatches.length > 0;
  const successLike = [...syncMatches, ...commandMatches].some(row => ['success', 'refund_processed', 'skipped', 'deduped'].includes(normalizeLower(row?.status || row?.action || row?.result_status)) || row?.success === true);
  return {
    stripe_event_id_present: Boolean(stripeEventId),
    stripe_event_id: stripeEventId ? sanitizeText(stripeEventId, 120) : null,
    duplicate_event_detected: duplicateEventDetected,
    order_sync_log_match_count: syncMatches.length,
    command_log_match_count: commandMatches.length,
    future_command_should: duplicateEventDetected ? (successLike ? 'skip_idempotent' : 'review_duplicate_event') : 'continue_preview_only',
    matching_order_sync_log_rows: syncMatches.slice(0, 5).map(g35bSafeRowSummary),
    matching_command_log_rows: commandMatches.slice(0, 5).map(g35bSafeRowSummary),
  };
}

const G35H_PREVIEW_MODE = 'NATIVE_PARTIAL_REFUND_REVIEW_IMPACT';
const G35I_PREV1_EXACT_READ_FAST_PATH_MARKER = 'g35i_prev1_exact_refund_preview_fast_path';
const G35I_PREV1_EXACT_READ_LIST_LIMIT = 250;

function isG35HPreviewRequest(body) {
  const previewMode = normalizeText(body?.preview_mode).toUpperCase();
  return previewMode === G35H_PREVIEW_MODE;
}

function g35hUnsupportedBodyKey(body) {
  return g35bUnsupportedBodyKey(body);
}

function g35hReviewMatches(row, { orderNumber, customerOrderId, nativeOrderId, stripeEventId, stripeRefundId }) {
  if (!row) return false;
  const orderKey = g33cOrderKey(orderNumber);
  if (customerOrderId && [row?.base44_order_id, row?.order_id, row?.customer_app_order_id, row?.existing_order_id].some(value => normalizeText(value) === customerOrderId)) return true;
  if (nativeOrderId && [row?.native_shopify_order_id, row?.shopify_order_id, row?.native_order_id].some(value => normalizeText(value) === nativeOrderId)) return true;
  if (stripeEventId && [row?.stripe_event_id, row?.related_stripe_event_id, row?.event_id, row?.refund_event_id, row?.idempotency_key].some(value => normalizeText(value) === stripeEventId)) return true;
  if (stripeRefundId && [row?.stripe_refund_id, row?.refund_id, row?.idempotency_key].some(value => normalizeText(value) === stripeRefundId)) return true;
  if (orderKey && [row?.order_number, row?.shopify_order_number, row?.source_order_number, row?.customer_order_number, row?.hub_order_number, row?.existing_order_number].some(value => g33cOrderKey(value) === orderKey)) return true;
  const payload = row?.incoming_payload && typeof row.incoming_payload === 'object' ? row.incoming_payload : {};
  if (customerOrderId && [payload.customer_app_order_id, payload.order_id, payload.existing_order_id].some(value => normalizeText(value) === customerOrderId)) return true;
  if (nativeOrderId && [payload.native_shopify_order_id, payload.shopify_order_id].some(value => normalizeText(value) === nativeOrderId)) return true;
  if (stripeEventId && [payload.stripe_event_id, payload.refund_event_id, payload.event_id].some(value => normalizeText(value) === stripeEventId)) return true;
  if (stripeRefundId && [payload.stripe_refund_id, payload.refund_id].some(value => normalizeText(value) === stripeRefundId)) return true;
  if (orderKey && [payload.order_number, payload.shopify_order_number, payload.existing_order_number].some(value => g33cOrderKey(value) === orderKey)) return true;
  return false;
}

function g35hPartialReviewLike(row) {
  const text = normalizeLower(`${row?.incident_type || ''} ${row?.recommended_action || ''} ${row?.issue_description || ''} ${row?.resolved_action || ''}`);
  return text.includes('partial_refund') || text.includes('partial refund');
}

async function g35hReviewRows(base44, { orderNumber, customerOrderId, nativeOrderId, stripeEventId, stripeRefundId }) {
  const rows = [];
  rows.push(...await g35bLogs(base44, 'OrderReviewQueue', { orderNumber, customerOrderId, stripeEventId }, 25));
  if (customerOrderId) rows.push(...await g33cFilter(base44, 'OrderReviewQueue', { existing_order_id: customerOrderId }, '-created_date', 25));
  if (orderNumber) rows.push(...await g33cFilter(base44, 'OrderReviewQueue', { existing_order_number: orderNumber }, '-created_date', 25));
  if (nativeOrderId) rows.push(...await g33cFilter(base44, 'OrderReviewQueue', { native_shopify_order_id: nativeOrderId }, '-created_date', 25));
  if (stripeEventId) rows.push(...await g33cFilter(base44, 'OrderReviewQueue', { idempotency_key: stripeEventId }, '-created_date', 25));
  if (stripeRefundId) rows.push(...await g33cFilter(base44, 'OrderReviewQueue', { idempotency_key: stripeRefundId }, '-created_date', 25));
  const listed = await g33cList(base44, 'OrderReviewQueue', '-created_date', 100);
  rows.push(...listed.filter(row => g35hReviewMatches(row, { orderNumber, customerOrderId, nativeOrderId, stripeEventId, stripeRefundId })));
  return g33cUnique(rows).filter(row => g35hReviewMatches(row, { orderNumber, customerOrderId, nativeOrderId, stripeEventId, stripeRefundId }));
}

function g35hReviewRowSummary(row) {
  return {
    id: row?.id || null,
    incident_type: sanitizeText(row?.incident_type, 120),
    status: sanitizeText(row?.status, 80),
    existing_order_number: sanitizeText(row?.existing_order_number || row?.order_number, 80),
    existing_order_id_present: Boolean(row?.existing_order_id || row?.customer_app_order_id || row?.order_id),
    idempotency_key_present: Boolean(row?.idempotency_key),
  };
}

function g35hStatusPolicyNotes() {
  return [
    'customer_order_status_refund_value_unsupported_policy_note',
    'customer_order_cancelled_value_unsupported_policy_note',
    'customer_order_status_lifecycle_facing',
    'refund_state_uses_payment_refund_fields',
  ];
}

function g35hRefundFieldPreview({ refundAmount, currency, lookup }) {
  return {
    refund_status: 'pending_review',
    refund_type: 'partial',
    refund_amount: refundAmount,
    refund_currency: currency,
    refunded_at: null,
    refund_source: lookup.eventSource === 'stripe_webhook_shadow' ? 'stripe_webhook' : lookup.eventSource === 'admin_preview' ? 'admin' : lookup.eventSource,
    refund_event_id: lookup.stripeEventId || lookup.requestId || null,
    stripe_refund_id: lookup.stripeRefundId || null,
    refund_reason: lookup.refundReason || 'partial_refund_requires_manual_review',
    refund_review_required: true,
    refund_review_status: 'pending',
  };
}

function g35hCustomerOrderImpact({ customerOrder, refundAmount, currency, lookup }) {
  if (!customerOrder?.id) return { present: false, proposed_action: 'none_unknown_order_review_required' };
  return {
    present: true,
    proposed_action: 'preview_refund_field_review_markers_only',
    current_status: sanitizeText(customerOrder?.status, 80),
    status_mutation_proposed: false,
    proposed_status: null,
    current_payment_status: sanitizeText(customerOrder?.payment_status || customerOrder?.financial_status, 80),
    payment_status_mutation_proposed: false,
    proposed_refund_fields: g35hRefundFieldPreview({ refundAmount, currency, lookup }),
    would_update_now: false,
  };
}

function g35hNativeOrderImpact({ nativeOrder, refundAmount, currency, lookup }) {
  if (!nativeOrder?.id) return { present: false, proposed_action: 'none_native_order_missing' };
  return {
    present: true,
    proposed_action: 'preview_native_refund_field_review_markers_only',
    current_payment_status: sanitizeText(nativeOrder?.payment_status || nativeOrder?.financial_status, 80),
    current_production_status: sanitizeText(nativeOrder?.production_status, 80),
    current_fulfillment_status: sanitizeText(nativeOrder?.fulfillment_status || nativeOrder?.shopify_fulfillment_status, 80),
    production_status_mutation_proposed: false,
    fulfillment_status_mutation_proposed: false,
    proposed_refund_fields: g35hRefundFieldPreview({ refundAmount, currency, lookup }),
    would_update_now: false,
  };
}

function g35hReviewPriority(lifecycleState, productionBatchImpact) {
  if (['delivered', 'historical_fulfilled'].includes(lifecycleState)) return 'high';
  if (productionBatchImpact?.verified_logged_batch_count > 0 || productionBatchImpact?.locked_compliance_log_count > 0) return 'high';
  if (['production_started', 'production_completed', 'production_verified', 'task_packed'].includes(lifecycleState)) return 'high';
  return 'normal';
}

function g35hReviewReason({ lookup, lifecycleState }) {
  return lookup.refundReason || (lifecycleState === 'delivered'
    ? 'partial_refund_for_delivered_order_requires_manual_review'
    : 'partial_refund_requires_manual_review');
}

const G35H_PATCH1_BATCH_LINKAGE_MARKER = 'g35h_patch1_reuse_native_refund_impact_batch_linkage';

function g35hPatch1AnnotatedImpact(impact, directImpact) {
  const batchWarnings = Array.isArray(impact?.batch_linkage_warnings) ? impact.batch_linkage_warnings : [];
  return {
    ...impact,
    batch_linkage_warnings: [...new Set([...batchWarnings, G35H_PATCH1_BATCH_LINKAGE_MARKER])],
    g35h_patch1_linkage_source: 'native_refund_impact_reuse',
    g35h_patch1_direct_production_batch_count: safeNumber(directImpact?.production_batch_count, 0),
    g35h_patch1_direct_batch_compliance_log_count: safeNumber(directImpact?.batch_compliance_log_count, 0),
  };
}

async function g35hPatch1ProductionBatchImpact(base44, body, lookup, directImpact, { orderFound, skipFallback = false } = {}) {
  const directBatchCount = safeNumber(directImpact?.production_batch_count, 0);
  const directComplianceCount = safeNumber(directImpact?.batch_compliance_log_count, 0);
  if (!orderFound || directBatchCount > 0 || directComplianceCount > 0) {
    return {
      productionBatchImpact: directImpact,
      patch1: {
        marker: G35H_PATCH1_BATCH_LINKAGE_MARKER,
        fallback_used: false,
        fallback_status: directBatchCount > 0 || directComplianceCount > 0 ? 'direct_linkage_satisfied' : 'not_needed',
        direct_production_batch_count: directBatchCount,
        direct_batch_compliance_log_count: directComplianceCount,
        fallback_production_batch_count: null,
        fallback_batch_compliance_log_count: null,
      },
    };
  }

  if (skipFallback) {
    return {
      productionBatchImpact: directImpact,
      patch1: {
        marker: G35H_PATCH1_BATCH_LINKAGE_MARKER,
        fallback_used: false,
        fallback_status: 'fallback_skipped_exact_read_fast_path_or_unstable_reads',
        direct_production_batch_count: directBatchCount,
        direct_batch_compliance_log_count: directComplianceCount,
        fallback_production_batch_count: null,
        fallback_batch_compliance_log_count: null,
      },
    };
  }

  const fallbackBody = {
    ...body,
    preview_mode: G35B_PREVIEW_MODE,
    refund_type: 'partial',
    refund_amount: lookup.refundAmount,
    refund_currency: lookup.currency,
    currency: lookup.currency,
    event_source: lookup.eventSource,
    request_id: lookup.requestId,
  };

  const fallback = await buildG35BPreview(base44, fallbackBody).catch(error => ({
    success: false,
    error_code: 'g35h_patch1_batch_linkage_fallback_failed',
    message: sanitizeText(error?.message || error, 180),
  }));
  const fallbackImpact = fallback?.proposed_production_batch_impact;
  const fallbackBatchCount = safeNumber(fallbackImpact?.production_batch_count, 0);
  const fallbackComplianceCount = safeNumber(fallbackImpact?.batch_compliance_log_count, 0);
  if (fallbackBatchCount > 0 || fallbackComplianceCount > 0) {
    return {
      productionBatchImpact: g35hPatch1AnnotatedImpact(fallbackImpact, directImpact),
      patch1: {
        marker: G35H_PATCH1_BATCH_LINKAGE_MARKER,
        fallback_used: true,
        fallback_status: 'native_refund_impact_linkage_reused',
        direct_production_batch_count: directBatchCount,
        direct_batch_compliance_log_count: directComplianceCount,
        fallback_production_batch_count: fallbackBatchCount,
        fallback_batch_compliance_log_count: fallbackComplianceCount,
      },
    };
  }

  return {
    productionBatchImpact: directImpact,
    patch1: {
      marker: G35H_PATCH1_BATCH_LINKAGE_MARKER,
      fallback_used: true,
      fallback_status: fallback?.error_code || 'fallback_found_no_related_batch_history',
      direct_production_batch_count: directBatchCount,
      direct_batch_compliance_log_count: directComplianceCount,
      fallback_production_batch_count: fallbackBatchCount,
      fallback_batch_compliance_log_count: fallbackComplianceCount,
    },
  };
}

function g35hReviewQueueImpact({ orderNumber, customerOrderId, nativeOrderId, orderFound, lookup, duplicateReviewDetected, duplicateEventDetected, refundAmount, currency, lifecycleState, productionBatchImpact, existingReviewRows }) {
  if (duplicateEventDetected) {
    return {
      proposed_action: 'dedupe_existing_refund_event_no_new_review_queue_draft',
      would_create_now: false,
      draft_recommended_for_future_command: false,
      incident_type: 'partial_refund_review_required',
      duplicate_review_detected: false,
      duplicate_refund_event_detected: true,
      existing_review_queue_rows: existingReviewRows.slice(0, 5).map(g35hReviewRowSummary),
    };
  }
  if (duplicateReviewDetected) {
    return {
      proposed_action: 'dedupe_existing_partial_refund_review_no_new_queue_draft',
      would_create_now: false,
      draft_recommended_for_future_command: false,
      incident_type: 'partial_refund_review_required',
      duplicate_review_detected: true,
      existing_review_queue_rows: existingReviewRows.slice(0, 5).map(g35hReviewRowSummary),
    };
  }
  const priority = g35hReviewPriority(lifecycleState, productionBatchImpact);
  const reviewReason = g35hReviewReason({ lookup, lifecycleState });
  const safeDraft = {
    incident_type: orderFound ? 'partial_refund_review_required' : 'partial_refund_unknown_order_review_required',
    order_number: orderNumber || lookup.orderNumber || null,
    customer_app_order_id: customerOrderId || null,
    native_shopify_order_id: nativeOrderId || null,
    refund_amount: refundAmount,
    refund_currency: currency,
    refund_type: 'partial',
    stripe_event_id: lookup.stripeEventId || null,
    stripe_refund_id: lookup.stripeRefundId || null,
    review_reason: reviewReason,
    priority,
    status: 'pending',
    source: 'native_refund_impact_preview',
    raw_payload_included: false,
    customer_pii_included: false,
  };
  return {
    proposed_action: orderFound ? 'partial_refund_review_queue_draft' : 'unknown_order_partial_refund_review_queue_draft',
    would_create_now: false,
    draft_recommended_for_future_command: true,
    incident_type: safeDraft.incident_type,
    status: 'pending',
    source: 'native_refund_impact_preview',
    recommended_action: 'manual_review',
    duplicate_review_detected: false,
    existing_review_queue_rows: existingReviewRows.slice(0, 5).map(g35hReviewRowSummary),
    safe_queue_draft: safeDraft,
  };
}

async function buildG35HPreview(base44, body) {
  const lookup = g35bLookup(body);
  const requestBlockers = [];
  const warnings = [];
  if (lookup.rawRefundType !== 'partial') requestBlockers.push('refund_type_must_be_partial_for_partial_refund_review_preview');
  if (lookup.refundAmount === null || lookup.refundAmount <= 0) requestBlockers.push('refund_amount_required_for_partial_refund_review');
  if (!lookup.orderNumber && !lookup.customerAppOrderId && !lookup.nativeOrderId && !lookup.taskId && !lookup.stripeEventId && !lookup.stripeRefundId) requestBlockers.push('order_or_refund_event_identifier_required');

  const resolvedContext = await g35hResolveRefundReadContextStable(base44, lookup);
  const { customerOrder, nativeOrder, task, orderNumber, customerOrderId, batches, complianceLogs, orderFound, readConsistency } = resolvedContext;
  const readConsistencyBlockers = g35hReadConsistencyBlockers(readConsistency);
  const [orderSyncRows, commandRows, parityRows, reviewRows] = await Promise.all([
    g35bLogs(base44, 'OrderSyncLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'CommandLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'SafeSyncParityLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35hReviewRows(base44, { orderNumber, customerOrderId, nativeOrderId: nativeOrder?.id || lookup.nativeOrderId, stripeEventId: lookup.stripeEventId, stripeRefundId: lookup.stripeRefundId }),
  ]);
  const lifecycleState = g35bLifecycleState({ customerOrder, nativeOrder, task, batches, complianceLogs });
  const directProductionBatchImpact = g35bProductionBatchImpact({ batches, complianceLogs, refundType: 'partial', lifecycleState, orderNumber, customerOrderId, nativeOrderId: nativeOrder?.id, taskId: task?.id });
  const { productionBatchImpact, patch1: patch1BatchLinkage } = await g35hPatch1ProductionBatchImpact(base44, body, lookup, directProductionBatchImpact, { orderFound, skipFallback: resolvedContext.exact_id_fast_path_used || !readConsistency.stable });
  const idempotencyStatus = g35bIdempotencyStatus({ stripeEventId: lookup.stripeEventId, orderSyncRows, commandRows });
  const partialReviewRows = reviewRows.filter(g35hPartialReviewLike);
  const duplicateReviewDetected = partialReviewRows.length > 0;
  const duplicateEventDetected = idempotencyStatus.duplicate_event_detected;

  if (!readConsistency.stable) warnings.push('read_consistency_unstable');
  if (readConsistency.stable && !orderFound && !requestBlockers.includes('order_or_refund_event_identifier_required')) warnings.push('unknown_order_review_required');
  if (lifecycleState === 'delivered') warnings.push('delivered_partial_refund_manual_review_required');
  if (productionBatchImpact.verified_logged_batch_count > 0) warnings.push('verified_production_history_preserved');
  if (productionBatchImpact.locked_compliance_log_count > 0) warnings.push('locked_compliance_logs_preserved');
  if (patch1BatchLinkage.fallback_used && productionBatchImpact.production_batch_count > 0) warnings.push(G35H_PATCH1_BATCH_LINKAGE_MARKER);
  warnings.push('partial_refund_review_only_no_automatic_mutation', 'notifications_held', 'provider_calls_disabled', 'inventory_reversal_not_proposed', 'purchase_order_reversal_not_proposed', 'hub_fallback_required');

  const blockers = [...requestBlockers, ...readConsistencyBlockers];
  const previewDataStable = readConsistency.stable;
  const futureReviewQueueCommandPlanningPossible = previewDataStable && blockers.length === 0 && orderFound && !duplicateReviewDetected && !duplicateEventDetected;
  let nextAction = 'partial_refund_review_required';
  if (requestBlockers.includes('refund_amount_required_for_partial_refund_review')) nextAction = 'provide_refund_amount_for_review_preview';
  else if (requestBlockers.includes('refund_type_must_be_partial_for_partial_refund_review_preview')) nextAction = 'use_native_refund_impact_preview_for_non_partial_refund';
  else if (requestBlockers.length) nextAction = 'fix_preview_request_and_rerun';
  else if (readConsistencyBlockers.length) nextAction = readConsistency.expected_identifiers_supplied ? 'retry_preview_after_read_consistency_stabilizes' : 'provide_exact_ids_for_preview';
  else if (duplicateEventDetected) nextAction = 'duplicate_refund_event_detected';
  else if (duplicateReviewDetected) nextAction = 'duplicate_partial_refund_review_already_exists';
  else if (!orderFound) nextAction = 'unknown_order_review_required';
  else if (lifecycleState === 'delivered') nextAction = 'partial_refund_manual_review_required';

  const reviewQueueImpact = readConsistencyBlockers.length ? {
    proposed_action: 'read_consistency_unstable_no_review_queue_draft',
    would_create_now: false,
    draft_recommended_for_future_command: false,
    incident_type: 'partial_refund_review_required',
    status: 'blocked_by_read_consistency',
    source: 'native_refund_impact_preview',
    recommended_action: 'retry_preview_after_read_consistency_stabilizes',
    duplicate_review_detected: duplicateReviewDetected,
    duplicate_refund_event_detected: duplicateEventDetected,
    existing_review_queue_rows: partialReviewRows.slice(0, 5).map(g35hReviewRowSummary),
    safe_queue_draft: null,
  } : g35hReviewQueueImpact({
    orderNumber,
    customerOrderId,
    nativeOrderId: nativeOrder?.id || lookup.nativeOrderId,
    orderFound,
    lookup,
    duplicateReviewDetected,
    duplicateEventDetected,
    refundAmount: lookup.refundAmount,
    currency: lookup.currency,
    lifecycleState,
    productionBatchImpact,
    existingReviewRows: partialReviewRows,
  });

  return {
    success: blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    requested_function_alias: 'previewNativePartialRefundReviewImpact',
    preview_mode: G35H_PREVIEW_MODE,
    order_number: orderNumber || lookup.orderNumber || null,
    refund_type: lookup.rawRefundType || lookup.refundType || null,
    refund_amount: lookup.refundAmount,
    refund_currency: lookup.currency,
    stripe_event_id: lookup.stripeEventId ? sanitizeText(lookup.stripeEventId, 120) : null,
    stripe_refund_id: lookup.stripeRefundId ? sanitizeText(lookup.stripeRefundId, 120) : null,
    event_source: lookup.eventSource,
    request_id: lookup.requestId || null,
    order_found: orderFound,
    preview_data_stable: previewDataStable,
    read_consistency: readConsistency,
    g35i_prev1_exact_read_fast_path: Boolean(resolvedContext.exact_id_fast_path_used),
    g35i_prev1_exact_read_fast_path_marker: resolvedContext.exact_id_fast_path_marker || null,
    command_readiness_safe: false,
    future_review_queue_command_planning_possible: futureReviewQueueCommandPlanningPossible,
    customer_app_order_present: Boolean(customerOrder?.id),
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: Boolean(task?.id),
    production_batch_count: productionBatchImpact.production_batch_count,
    verified_logged_batch_count: productionBatchImpact.verified_logged_batch_count,
    batch_compliance_log_count: productionBatchImpact.batch_compliance_log_count,
    locked_compliance_log_count: productionBatchImpact.locked_compliance_log_count,
    existing_review_queue_count: partialReviewRows.length,
    duplicate_review_detected: duplicateReviewDetected,
    duplicate_refund_event_detected: duplicateEventDetected,
    idempotency_status: idempotencyStatus,
    lifecycle_state: lifecycleState,
    lifecycle_risk_level: ['delivered', 'historical_fulfilled'].includes(lifecycleState) ? 'manual_review_required' : g35bRiskLevel(lifecycleState),
    proposed_order_review_queue_impact: reviewQueueImpact,
    proposed_customer_app_order_impact: g35hCustomerOrderImpact({ customerOrder, refundAmount: lookup.refundAmount, currency: lookup.currency, lookup }),
    proposed_native_shopify_order_impact: g35hNativeOrderImpact({ nativeOrder, refundAmount: lookup.refundAmount, currency: lookup.currency, lookup }),
    proposed_fulfillment_task_impact: g35bTaskImpact({ task, refundType: 'partial', lifecycleState }),
    proposed_production_batch_impact: productionBatchImpact,
    production_batch_mutation_proposed: false,
    compliance_log_mutation_proposed: false,
    g35h_patch1_batch_linkage: patch1BatchLinkage,
    proposed_compliance_impact: {
      batch_compliance_log_count: productionBatchImpact.batch_compliance_log_count,
      locked_compliance_log_count: productionBatchImpact.locked_compliance_log_count,
      compliance_history_preserved: true,
      compliance_history_mutation_proposed: false,
      proposed_action: 'preserve_compliance_history_no_mutation',
    },
    notification_impact: {
      notification_would_send: false,
      notification_held: true,
      notification_rows_created: false,
      message_logs_created: false,
    },
    provider_call_impact: false,
    status_schema_policy_notes: g35hStatusPolicyNotes(),
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    next_action: nextAction,
    hub_fallback_required: true,
    hub_fallback_impact: {
      hub_fallback_required: true,
      hub_bridge_modified: false,
      hub_records_updated: false,
      order_sync_log_status: g33cStatuses(orderSyncRows),
      safe_sync_parity_log_status: g33cStatuses(parityRows),
      review_queue_status: g33cStatuses(reviewRows),
    },
    safety: G35B_READ_ONLY_SAFETY,
  };
}



const G35L_PREVIEW_MODE = 'STRIPE_REFUND_WEBHOOK_SHADOW_PREVIEW';
const G35L_SUPPORTED_EVENT_TYPES = new Set(['charge.refunded', 'refund.created', 'refund.updated', 'charge.refund.updated']);
const G35L_EVENT_SOURCES = new Set(['admin_shadow_preview', 'synthetic_fixture', 'stripe_webhook_shadow']);
const G35L_ALLOWED_BODY_KEYS = new Set([
  ...G35B_ALLOWED_BODY_KEYS,
  'event_type',
  'payment_intent_id',
  'payment_intent',
  'stripe_payment_intent_id',
  'charge_id',
  'stripe_charge_id',
]);

function isG35LPreviewRequest(body) {
  const previewMode = normalizeText(body?.preview_mode).toUpperCase();
  return previewMode === G35L_PREVIEW_MODE;
}

function g35lUnsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!G35L_ALLOWED_BODY_KEYS.has(normalizeText(key).toLowerCase())) return key;
  }
  return null;
}

function g35lLookup(body) {
  const baseLookup = g35bLookup(body);
  const eventType = normalizeLower(body?.event_type || 'unknown');
  const eventSource = normalizeLower(body?.event_source || 'admin_shadow_preview');
  return {
    ...baseLookup,
    eventType: eventType || 'unknown',
    eventSource: G35L_EVENT_SOURCES.has(eventSource) ? eventSource : 'admin_shadow_preview',
    paymentIntentId: normalizeText(body?.payment_intent_id || body?.payment_intent || body?.stripe_payment_intent_id),
    chargeId: normalizeText(body?.charge_id || body?.stripe_charge_id),
  };
}

function g35lIdempotencyKey(lookup) {
  if (lookup?.stripeEventId) return { key: lookup.stripeEventId, source: 'stripe_event_id' };
  if (lookup?.stripeRefundId) return { key: lookup.stripeRefundId, source: 'stripe_refund_id' };
  if (lookup?.requestId && lookup?.eventSource === 'admin_shadow_preview') return { key: lookup.requestId, source: 'request_id_admin_shadow_preview' };
  return { key: null, source: 'missing' };
}

function g35lSafeProviderIdPresent(value) {
  return Boolean(normalizeText(value));
}

function g35lRowMatchesRefundId(row, stripeRefundId) {
  if (!stripeRefundId) return false;
  const values = [row?.stripe_refund_id, row?.refund_id, row?.idempotency_key, row?.related_stripe_refund_id];
  if (values.some(value => normalizeText(value) === stripeRefundId)) return true;
  const payload = row?.metadata || row?.details || row?.data || row?.payload || {};
  return [payload?.stripe_refund_id, payload?.refund_id, payload?.related_stripe_refund_id].some(value => normalizeText(value) === stripeRefundId);
}

function g35lSafeLogSummary(row) {
  return {
    id: row?.id || null,
    status: sanitizeText(row?.status || row?.sync_status || row?.review_status || row?.action, 80),
    action: sanitizeText(row?.action || row?.hub_action || row?.command_type || row?.incident_type, 100),
    stripe_event_id_present: Boolean(row?.stripe_event_id || row?.related_stripe_event_id || row?.event_id),
    stripe_refund_id_present: Boolean(row?.stripe_refund_id || row?.refund_id || row?.related_stripe_refund_id),
  };
}

async function g35lLocalOrderRowsByPaymentIntentOrCharge(base44, lookup) {
  const rows = [];
  if (lookup.paymentIntentId) {
    rows.push(...await g33cFilter(base44, 'Order', { stripe_payment_intent_id: lookup.paymentIntentId }, '-created_date', 10, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'Order', { payment_intent_id: lookup.paymentIntentId }, '-created_date', 10, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'Order', { paymentIntentId: lookup.paymentIntentId }, '-created_date', 10, { retryEmpty: true }));
  }
  if (lookup.chargeId) {
    rows.push(...await g33cFilter(base44, 'Order', { stripe_charge_id: lookup.chargeId }, '-created_date', 10, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'Order', { charge_id: lookup.chargeId }, '-created_date', 10, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'Order', { latest_charge: lookup.chargeId }, '-created_date', 10, { retryEmpty: true }));
  }
  return g33cUnique(rows);
}

async function g35lLocalNativeRowsByPaymentIntentOrCharge(base44, lookup) {
  const rows = [];
  if (lookup.paymentIntentId) {
    rows.push(...await g33cFilter(base44, 'ShopifyOrder', { stripe_payment_intent_id: lookup.paymentIntentId }, '-created_date', 10, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'ShopifyOrder', { payment_intent_id: lookup.paymentIntentId }, '-created_date', 10, { retryEmpty: true }));
  }
  if (lookup.chargeId) {
    rows.push(...await g33cFilter(base44, 'ShopifyOrder', { stripe_charge_id: lookup.chargeId }, '-created_date', 10, { retryEmpty: true }));
    rows.push(...await g33cFilter(base44, 'ShopifyOrder', { charge_id: lookup.chargeId }, '-created_date', 10, { retryEmpty: true }));
  }
  return g33cUnique(rows);
}

async function g35lResolveOrderIdentifiers(base44, lookup) {
  const customerRows = await g33cCustomerOrders(base44, lookup);
  let customerOrder = customerRows[0] || null;
  let nativeRows = [];
  if (lookup.nativeOrderId) nativeRows.push(...await g33cFilter(base44, 'ShopifyOrder', { id: lookup.nativeOrderId }, '-created_date', 5, { retryEmpty: true }));
  nativeRows.push(...await g35bNativeOrders(base44, lookup, customerOrder));
  let nativeOrder = g33cUnique(nativeRows)[0] || null;
  let orderLookupStrategy = lookup.customerAppOrderId
    ? 'customer_app_order_id'
    : lookup.nativeOrderId
      ? 'native_shopify_order_id'
      : lookup.orderNumber
        ? 'order_number'
        : 'none';

  if (!customerOrder && !nativeOrder && (lookup.paymentIntentId || lookup.chargeId)) {
    const paymentOrders = await g35lLocalOrderRowsByPaymentIntentOrCharge(base44, lookup);
    customerOrder = paymentOrders[0] || null;
    if (customerOrder?.id) orderLookupStrategy = lookup.paymentIntentId ? 'payment_intent_id_local_order' : 'charge_id_local_order';
  }
  if (!nativeOrder && (lookup.paymentIntentId || lookup.chargeId)) {
    const paymentNativeRows = await g35lLocalNativeRowsByPaymentIntentOrCharge(base44, lookup);
    nativeOrder = paymentNativeRows[0] || null;
    if (nativeOrder?.id && orderLookupStrategy === 'none') orderLookupStrategy = lookup.paymentIntentId ? 'payment_intent_id_local_native_order' : 'charge_id_local_native_order';
  }
  if (!customerOrder && nativeOrder?.base44_order_id) {
    const byNativeOrder = await g33cCustomerOrders(base44, { orderNumber: normalizeOrderNumber(nativeOrder?.shopify_order_number || lookup.orderNumber), customerAppOrderId: nativeOrder.base44_order_id });
    customerOrder = byNativeOrder[0] || null;
  }
  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || nativeOrder?.shopify_order_number || lookup.orderNumber);
  const customerOrderId = normalizeText(customerOrder?.id || lookup.customerAppOrderId || nativeOrder?.base44_order_id);
  if (!nativeOrder && (orderNumber || customerOrderId || lookup.nativeOrderId)) {
    nativeRows = await g35bNativeOrders(base44, { ...lookup, orderNumber, customerAppOrderId: customerOrderId }, customerOrder);
    nativeOrder = nativeRows[0] || null;
  }
  const nativeOrderId = normalizeText(nativeOrder?.id || lookup.nativeOrderId);
  const tasks = await g33cTasks(base44, orderNumber, customerOrderId, nativeOrderId, lookup.taskId);
  const task = tasks[0] || null;
  return {
    order_lookup_strategy: orderLookupStrategy,
    order_found: Boolean(customerOrder?.id || nativeOrder?.id || task?.id),
    order_number: orderNumber || null,
    customer_app_order_id: customerOrderId || null,
    native_shopify_order_id: nativeOrderId || null,
    native_fulfillment_task_id: normalizeText(task?.id || lookup.taskId) || null,
    payment_intent_id_present: g35lSafeProviderIdPresent(lookup.paymentIntentId),
    charge_id_present: g35lSafeProviderIdPresent(lookup.chargeId),
  };
}

async function g35lLogsByRefundId(base44, entityName, stripeRefundId) {
  if (!stripeRefundId) return [];
  const rows = [];
  rows.push(...await g33cFilter(base44, entityName, { stripe_refund_id: stripeRefundId }, '-created_date', 25));
  rows.push(...await g33cFilter(base44, entityName, { refund_id: stripeRefundId }, '-created_date', 25));
  rows.push(...await g33cFilter(base44, entityName, { idempotency_key: stripeRefundId }, '-created_date', 25));
  return g33cUnique(rows);
}

async function g35lIdempotencyPreview(base44, lookup, identifiers) {
  const [baseOrderSyncRows, refundOrderSyncRows, baseCommandRows, refundCommandRows, reviewRows] = await Promise.all([
    g35bLogs(base44, 'OrderSyncLog', { orderNumber: identifiers.order_number, customerOrderId: identifiers.customer_app_order_id, stripeEventId: lookup.stripeEventId }, 25),
    g35lLogsByRefundId(base44, 'OrderSyncLog', lookup.stripeRefundId),
    g35bLogs(base44, 'CommandLog', { orderNumber: identifiers.order_number, customerOrderId: identifiers.customer_app_order_id, stripeEventId: lookup.stripeEventId }, 25),
    g35lLogsByRefundId(base44, 'CommandLog', lookup.stripeRefundId),
    g35hReviewRows(base44, {
      orderNumber: identifiers.order_number,
      customerOrderId: identifiers.customer_app_order_id,
      nativeOrderId: identifiers.native_shopify_order_id,
      stripeEventId: lookup.stripeEventId,
      stripeRefundId: lookup.stripeRefundId,
    }),
  ]);
  const orderSyncRows = g33cUnique([...baseOrderSyncRows, ...refundOrderSyncRows]);
  const commandRows = g33cUnique([...baseCommandRows, ...refundCommandRows]);
  const stripeRefundMatches = [
    ...orderSyncRows.filter(row => g35lRowMatchesRefundId(row, lookup.stripeRefundId)),
    ...commandRows.filter(row => g35lRowMatchesRefundId(row, lookup.stripeRefundId)),
    ...reviewRows.filter(row => g35lRowMatchesRefundId(row, lookup.stripeRefundId)),
  ];
  const eventStatus = g35bIdempotencyStatus({ stripeEventId: lookup.stripeEventId, orderSyncRows, commandRows });
  const duplicateRefundIdDetected = lookup.stripeRefundId && stripeRefundMatches.length > 0;
  return {
    ...eventStatus,
    idempotency_key: g35lIdempotencyKey(lookup).key,
    idempotency_key_source: g35lIdempotencyKey(lookup).source,
    duplicate_stripe_refund_id_detected: Boolean(duplicateRefundIdDetected),
    duplicate_event_detected: Boolean(eventStatus.duplicate_event_detected || duplicateRefundIdDetected),
    stripe_refund_id_match_count: stripeRefundMatches.length,
    matching_stripe_refund_rows: stripeRefundMatches.slice(0, 5).map(g35lSafeLogSummary),
    existing_review_queue_count: reviewRows.length,
    matching_review_queue_rows: reviewRows.slice(0, 5).map(g35lSafeLogSummary),
  };
}

function g35lShadowNextAction({ eventTypeSupported, normalizedRefundType, duplicateDetected, impactNextAction, blockers, orderFound }) {
  if (!eventTypeSupported) return 'unsupported_stripe_refund_event_type';
  if (duplicateDetected) return 'duplicate_refund_event_detected';
  if ((blockers || []).includes('refund_amount_required_for_partial_refund_review')) return 'missing_refund_amount_for_partial_preview';
  if ((blockers || []).includes('refund_currency_required_for_partial_refund_review')) return 'missing_refund_amount_for_partial_preview';
  if (!orderFound) return 'unknown_order_refund_review_required';
  if (normalizedRefundType === 'partial') return 'shadow_preview_partial_refund_review_required';
  if (normalizedRefundType === 'full' && ['delivered_refund_manual_review_required', 'production_started_manual_review_required', 'production_completed_manual_review_required', 'production_verified_manual_review_required', 'full_refund_review_required_task_packed'].includes(impactNextAction)) return 'shadow_preview_full_refund_manual_review_required';
  if (normalizedRefundType === 'full') return impactNextAction || 'hub_refund_source_of_truth';
  return 'hub_refund_source_of_truth';
}

async function buildG35LPreview(base44, body) {
  const lookup = g35lLookup(body);
  const blockers = [];
  const warnings = [];
  const eventTypeSupported = G35L_SUPPORTED_EVENT_TYPES.has(lookup.eventType);
  const refundCurrencySupplied = Boolean(normalizeText(body?.refund_currency || body?.currency));
  if (!eventTypeSupported) blockers.push('unsupported_stripe_refund_event_type');
  if (!lookup.refundType) blockers.push('refund_type_required_full_partial_or_unknown');
  if (lookup.refundType === 'partial' && (lookup.refundAmount === null || lookup.refundAmount <= 0)) blockers.push('refund_amount_required_for_partial_refund_review');
  if (lookup.refundType === 'partial' && !refundCurrencySupplied) blockers.push('refund_currency_required_for_partial_refund_review');
  if (!lookup.orderNumber && !lookup.customerAppOrderId && !lookup.nativeOrderId && !lookup.taskId && !lookup.paymentIntentId && !lookup.chargeId && !lookup.stripeEventId && !lookup.stripeRefundId) blockers.push('order_or_refund_identifier_required');
  warnings.push('stripe_refund_webhook_shadow_preview_only', 'provider_calls_disabled', 'notifications_held', 'hub_fallback_required');

  const identifiers = await g35lResolveOrderIdentifiers(base44, lookup);
  if (!identifiers.order_found && (lookup.paymentIntentId || lookup.chargeId)) warnings.push('local_payment_identifier_lookup_found_no_order_provider_calls_disabled');

  const idempotencyStatus = await g35lIdempotencyPreview(base44, lookup, identifiers);
  if (idempotencyStatus.duplicate_event_detected) blockers.push('duplicate_refund_event_detected');

  let impactPreview = null;
  if (eventTypeSupported && lookup.refundType === 'partial' && !blockers.includes('refund_amount_required_for_partial_refund_review') && !blockers.includes('refund_currency_required_for_partial_refund_review')) {
    impactPreview = await buildG35HPreview(base44, {
      preview_mode: G35H_PREVIEW_MODE,
      order_number: identifiers.order_number || lookup.orderNumber,
      customer_app_order_id: identifiers.customer_app_order_id || lookup.customerAppOrderId,
      native_shopify_order_id: identifiers.native_shopify_order_id || lookup.nativeOrderId,
      native_fulfillment_task_id: identifiers.native_fulfillment_task_id || lookup.taskId,
      stripe_event_id: lookup.stripeEventId,
      stripe_refund_id: lookup.stripeRefundId,
      refund_type: 'partial',
      refund_amount: lookup.refundAmount,
      refund_currency: lookup.currency,
      refund_reason: lookup.refundReason,
      event_source: 'stripe_webhook_shadow',
      request_id: lookup.requestId,
    });
  } else if (eventTypeSupported && lookup.refundType === 'full') {
    impactPreview = await buildG35BPreview(base44, {
      preview_mode: G35B_PREVIEW_MODE,
      order_number: identifiers.order_number || lookup.orderNumber,
      customer_app_order_id: identifiers.customer_app_order_id || lookup.customerAppOrderId,
      native_shopify_order_id: identifiers.native_shopify_order_id || lookup.nativeOrderId,
      native_fulfillment_task_id: identifiers.native_fulfillment_task_id || lookup.taskId,
      stripe_event_id: lookup.stripeEventId,
      stripe_refund_id: lookup.stripeRefundId,
      refund_type: 'full',
      refund_amount: lookup.refundAmount,
      refund_currency: lookup.currency,
      refund_reason: lookup.refundReason,
      event_source: 'stripe_webhook_shadow',
      request_id: lookup.requestId,
    });
  } else if (eventTypeSupported && lookup.refundType === 'unknown') {
    warnings.push('unknown_refund_type_review_required');
  }

  const duplicateDetected = Boolean(idempotencyStatus.duplicate_event_detected);
  const normalizedRefundType = lookup.refundType || lookup.rawRefundType || 'unknown';
  const nextAction = g35lShadowNextAction({
    eventTypeSupported,
    normalizedRefundType,
    duplicateDetected,
    impactNextAction: impactPreview?.next_action,
    blockers,
    orderFound: identifiers.order_found || Boolean(impactPreview?.order_found),
  });
  if (!identifiers.order_found && !impactPreview?.order_found) warnings.push('unknown_order_refund_review_required');
  if (normalizedRefundType === 'partial') warnings.push('partial_refund_review_only_no_automatic_mutation');
  if (normalizedRefundType === 'full') warnings.push('full_refund_shadow_preview_no_native_write_command');

  return {
    success: blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    requested_function_alias: 'previewStripeRefundWebhookShadowImpact',
    preview_mode: G35L_PREVIEW_MODE,
    event_type: lookup.eventType,
    event_type_supported: eventTypeSupported,
    stripe_event_id: lookup.stripeEventId ? sanitizeText(lookup.stripeEventId, 120) : null,
    stripe_refund_id: lookup.stripeRefundId ? sanitizeText(lookup.stripeRefundId, 120) : null,
    payment_intent_id_present: Boolean(lookup.paymentIntentId),
    charge_id_present: Boolean(lookup.chargeId),
    normalized_refund_type: normalizedRefundType,
    normalized_refund_amount: lookup.refundAmount,
    normalized_refund_currency: lookup.currency,
    event_source: lookup.eventSource,
    request_id: lookup.requestId || null,
    provider_call_impact: false,
    order_lookup_result: identifiers.order_found ? 'linked_local_order_context' : 'unknown_order_no_provider_lookup',
    order_lookup_strategy: identifiers.order_lookup_strategy,
    linked_order_number: identifiers.order_number,
    linked_customer_app_order_id: identifiers.customer_app_order_id,
    linked_native_shopify_order_id: identifiers.native_shopify_order_id,
    linked_native_fulfillment_task_id: identifiers.native_fulfillment_task_id,
    idempotency_status: idempotencyStatus,
    refund_impact_preview: impactPreview,
    proposed_order_review_queue_impact: impactPreview?.proposed_order_review_queue_impact || impactPreview?.proposed_review_queue_impact || (identifiers.order_found ? null : { proposed_action: 'unknown_order_refund_review_required', would_create_now: false, incident_type: 'refund_received_unknown_order' }),
    proposed_customer_app_order_impact: impactPreview?.proposed_customer_app_order_impact || null,
    proposed_native_shopify_order_impact: impactPreview?.proposed_native_shopify_order_impact || null,
    proposed_fulfillment_task_impact: impactPreview?.proposed_fulfillment_task_impact || null,
    proposed_production_batch_impact: impactPreview?.proposed_production_batch_impact || null,
    proposed_compliance_impact: impactPreview?.proposed_compliance_impact || {
      batch_compliance_log_count: impactPreview?.batch_compliance_log_count || 0,
      locked_compliance_log_count: impactPreview?.locked_compliance_log_count || 0,
      compliance_history_preserved: true,
      compliance_history_mutation_proposed: false,
      proposed_action: 'preserve_compliance_history_no_mutation',
    },
    notification_impact: impactPreview?.notification_impact || {
      notification_would_send: false,
      notification_held: true,
      notification_rows_created: false,
      message_logs_created: false,
    },
    blockers: [...new Set(blockers)],
    warnings: [...new Set([...(impactPreview?.warnings || []), ...warnings])],
    next_action: nextAction,
    hub_fallback_required: true,
    hub_fallback_impact: {
      hub_fallback_required: true,
      hub_bridge_modified: false,
      hub_records_updated: false,
      source_of_truth: 'hub_refund_source_of_truth',
    },
    safety: G35B_READ_ONLY_SAFETY,
  };
}


const G36B_PREVIEW_MODE = 'SUBSCRIPTION_OCCURRENCE_PARITY';
const G36B_MODES = new Set(['EXACT_OCCURRENCE_PREVIEW', 'RECENT_SUBSCRIPTION_OCCURRENCE_SCAN']);
const G36B_ALLOWED_BODY_KEYS = new Set([
  'mode',
  'preview_mode',
  'subscription_id',
  'hub_subscription_id',
  'customer_app_subscription_id',
  'stripe_subscription_id',
  'parent_order_number',
  'order_number',
  'shopify_order_number',
  'hub_order_id',
  'source_order_id',
  'occurrence_id',
  'fulfillment_number',
  'fulfillment_task_id',
  'native_fulfillment_task_id',
  'hub_fulfillment_task_id',
  'selected_hub_fulfillment_task_id',
  'ignored_duplicate_hub_fulfillment_task_id',
  'delivery_date',
  'production_date',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'payment_status',
  'fulfillment_status',
  'line_item_count',
  'line_item_interpretation',
  'decomposed_production_item_count',
  'known_cancellation_refund_issue',
  'known_repair_replay_issue',
  'customer_app_cancelled_mirror_treatment',
  'limit',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

const G36B_READ_ONLY_SAFETY = Object.freeze({
  ...G35B_READ_ONLY_SAFETY,
  subscriptions_created: false,
  subscriptions_updated: false,
  native_shopify_order_created: false,
  native_fulfillment_task_created: false,
  production_batch_created: false,
  batch_compliance_log_created: false,
  hub_read_only: true,
  hub_records_updated: false,
  hub_mutations_performed: false,
});

const G36C_HELPER_PREVIEW_MODE = 'SUBSCRIPTION_PARENT_TO_OCCURRENCE_DISCOVERY';
const G36C_RESOLVE_PREVIEW_MODE = 'SUBSCRIPTION_OCCURRENCE_AMBIGUITY_RESOLUTION';
const G36F_PREVIEW_MODE = 'SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET';
const G36F_MODE = 'EXACT_OCCURRENCE_MIRROR_PACKET';
const G36C_HELPER_ALLOWED_BODY_KEYS = new Set([
  'preview_mode',
  'customer_label',
  'subscription_id',
  'hub_subscription_id',
  'customer_app_subscription_id',
  'parent_order_number',
  'order_number',
  'shopify_order_number',
  'hub_order_id',
  'occurrence_id',
  'hub_fulfillment_task_id',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'date_from',
  'date_to',
  'fulfilled_only',
  'max_candidates',
  'limit',
  'operator_expected_line_item_count',
  'operator_expected_payment_status',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);
const G36F_ALLOWED_BODY_KEYS = new Set([
  'preview_mode',
  'mode',
  'hub_subscription_id',
  'parent_order_number',
  'order_number',
  'shopify_order_number',
  'hub_order_id',
  'source_order_id',
  'delivery_date',
  'selected_hub_fulfillment_task_id',
  'ignored_duplicate_hub_fulfillment_task_id',
  'hub_fulfillment_task_id',
  'payment_status',
  'fulfillment_status',
  'line_item_count',
  'line_item_interpretation',
  'decomposed_production_item_count',
  'known_cancellation_refund_issue',
  'known_repair_replay_issue',
  'customer_app_cancelled_mirror_treatment',
  'customer_app_order_id',
  'base44_order_id',
  'order_id',
  'native_shopify_order_id',
  'native_order_id',
  'shopify_order_id',
  'request_id',
  '_internal_secret',
  'internal_secret',
]);

function isG36BPreviewRequest(body) {
  return normalizeText(body?.preview_mode).toUpperCase() === G36B_PREVIEW_MODE;
}

function g36bUnsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!G36B_ALLOWED_BODY_KEYS.has(normalizeText(key).toLowerCase())) return key;
  }
  return null;
}

function isG36CHelperPreviewRequest(body) {
  return normalizeText(body?.preview_mode).toUpperCase() === G36C_HELPER_PREVIEW_MODE;
}

function isG36CResolvePreviewRequest(body) {
  return normalizeText(body?.preview_mode).toUpperCase() === G36C_RESOLVE_PREVIEW_MODE;
}

function isG36FPreviewRequest(body) {
  return normalizeText(body?.preview_mode).toUpperCase() === G36F_PREVIEW_MODE;
}

function g36cHelperUnsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!G36C_HELPER_ALLOWED_BODY_KEYS.has(normalizeText(key).toLowerCase())) return key;
  }
  return null;
}

function g36fUnsupportedBodyKey(body) {
  for (const key of Object.keys(body || {})) {
    if (!G36F_ALLOWED_BODY_KEYS.has(normalizeText(key).toLowerCase())) return key;
  }
  return null;
}

function g36bNumberOrNull(value) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function g36bDate(value) {
  const text = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function g36bLookup(body) {
  const rawMode = normalizeText(body?.mode || 'EXACT_OCCURRENCE_PREVIEW').toUpperCase();
  const mode = G36B_MODES.has(rawMode) ? rawMode : 'EXACT_OCCURRENCE_PREVIEW';
  return {
    mode,
    subscriptionId: normalizeText(body?.subscription_id || body?.customer_app_subscription_id),
    hubSubscriptionId: normalizeText(body?.hub_subscription_id),
    stripeSubscriptionId: normalizeText(body?.stripe_subscription_id || body?.hub_subscription_id),
    customerAppSubscriptionId: normalizeText(body?.customer_app_subscription_id || body?.subscription_id),
    orderNumber: normalizeOrderNumber(body?.order_number || body?.parent_order_number || body?.shopify_order_number),
    hubOrderId: normalizeText(body?.hub_order_id || body?.source_order_id),
    occurrenceId: normalizeText(body?.occurrence_id),
    fulfillmentNumber: g36bNumberOrNull(body?.fulfillment_number),
    fulfillmentTaskId: normalizeText(body?.fulfillment_task_id || body?.native_fulfillment_task_id),
    hubFulfillmentTaskId: normalizeText(body?.hub_fulfillment_task_id || body?.selected_hub_fulfillment_task_id),
    selectedHubFulfillmentTaskId: normalizeText(body?.selected_hub_fulfillment_task_id || body?.hub_fulfillment_task_id),
    ignoredDuplicateHubFulfillmentTaskId: normalizeText(body?.ignored_duplicate_hub_fulfillment_task_id),
    deliveryDate: g36bDate(body?.delivery_date),
    productionDate: g36bDate(body?.production_date),
    customerAppOrderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id || body?.order_id),
    nativeOrderId: normalizeText(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id),
    ownerPaymentStatus: sanitizeText(body?.payment_status, 80),
    ownerFulfillmentStatus: sanitizeText(body?.fulfillment_status, 80),
    ownerLineItemCount: g36bNumberOrNull(body?.line_item_count),
    ownerLineItemInterpretation: sanitizeText(body?.line_item_interpretation, 160),
    ownerDecomposedProductionItemCount: sanitizeText(body?.decomposed_production_item_count, 80),
    knownCancellationRefundIssue: sanitizeText(body?.known_cancellation_refund_issue, 40),
    knownRepairReplayIssue: sanitizeText(body?.known_repair_replay_issue, 40),
    customerAppCancelledMirrorTreatment: sanitizeText(body?.customer_app_cancelled_mirror_treatment, 120),
    requestId: sanitizeText(body?.request_id, 120),
    limit: safeLimit(body?.limit),
  };
}

function g36bHasSubscriptionSignal(row) {
  return normalizeLower(row?.order_type) === 'subscription' ||
    normalizeLower(row?.source_channel) === 'subscription' ||
    normalizeLower(row?.source_type) === 'subscription' ||
    normalizeLower(row?.source_type) === 'subscription_fulfillment' ||
    normalizeLower(row?.fulfillment_mode) === 'multi_delivery' ||
    Boolean(row?.stripe_subscription_id || row?.customer_app_subscription_id || row?.subscription_parent_id);
}

function g36bTaskMatchesOccurrence(task, lookup) {
  if (!task) return false;
  if (lookup.fulfillmentTaskId && normalizeText(task.id) === lookup.fulfillmentTaskId) return true;
  if (lookup.customerAppSubscriptionId && normalizeText(task.customer_app_subscription_id) === lookup.customerAppSubscriptionId) return true;
  if (lookup.stripeSubscriptionId && normalizeText(task.stripe_subscription_id) === lookup.stripeSubscriptionId) return true;
  if (lookup.nativeOrderId && [task.native_shopify_order_id, task.shopify_order_id].some(value => normalizeText(value) === lookup.nativeOrderId)) return true;
  if (lookup.customerAppOrderId && [task.base44_order_id, task.order_id].some(value => normalizeText(value) === lookup.customerAppOrderId)) return true;
  if (lookup.orderNumber) {
    const key = g33cOrderKey(lookup.orderNumber);
    if ([task.order_number, task.shopify_order_number].some(value => g33cOrderKey(value) === key)) return true;
  }
  return false;
}

function g36bTaskMatchesExactOccurrence(task, lookup) {
  if (!g36bTaskMatchesOccurrence(task, lookup)) return false;
  if (lookup.fulfillmentNumber !== null && Number(task?.fulfillment_number) !== lookup.fulfillmentNumber) return false;
  if (lookup.deliveryDate) {
    const taskDate = g36bDate(task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date);
    if (taskDate !== lookup.deliveryDate) return false;
  }
  return true;
}

function g36bNativeOrderMatchesOccurrence(order, lookup) {
  if (!order) return false;
  if (lookup.nativeOrderId && normalizeText(order.id) === lookup.nativeOrderId) return true;
  if (lookup.customerAppOrderId && normalizeText(order.base44_order_id) === lookup.customerAppOrderId) return true;
  if (lookup.customerAppSubscriptionId && normalizeText(order.customer_app_subscription_id) === lookup.customerAppSubscriptionId) return true;
  if (lookup.subscriptionId && [order.subscription_parent_id, order.customer_app_subscription_id].some(value => normalizeText(value) === lookup.subscriptionId)) return true;
  if (lookup.stripeSubscriptionId && normalizeText(order.stripe_subscription_id) === lookup.stripeSubscriptionId) return true;
  if (lookup.orderNumber) {
    const key = g33cOrderKey(lookup.orderNumber);
    if ([order.shopify_order_number, order.order_number, order.native_order_number].some(value => g33cOrderKey(value) === key)) return true;
  }
  return false;
}

function g36bOrderMatchesOccurrence(order, lookup) {
  if (!order) return false;
  if (lookup.customerAppOrderId && normalizeText(order.id) === lookup.customerAppOrderId) return true;
  if (lookup.orderNumber) {
    const key = g33cOrderKey(lookup.orderNumber);
    if ([order.order_number, order.shopify_order_number].some(value => g33cOrderKey(value) === key)) return true;
  }
  return false;
}

function g36bFulfillmentMatches(fulfillment, lookup) {
  if (!fulfillment) return false;
  if (lookup.occurrenceId && [fulfillment.id, fulfillment.occurrence_id, fulfillment.fulfillment_id].some(value => normalizeText(value) === lookup.occurrenceId)) return true;
  if (lookup.fulfillmentNumber !== null && Number(fulfillment.fulfillment_number) !== lookup.fulfillmentNumber) return false;
  if (lookup.deliveryDate) {
    const date = g36bDate(fulfillment.delivery_date || fulfillment.assigned_delivery_date || fulfillment.scheduled_date);
    if (date !== lookup.deliveryDate) return false;
  }
  return lookup.fulfillmentNumber !== null || Boolean(lookup.deliveryDate);
}

function g36bNativeFulfillmentRows(nativeOrders, lookup) {
  const rows = [];
  for (const order of nativeOrders || []) {
    const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
    for (const fulfillment of fulfillments) {
      if (g36bFulfillmentMatches(fulfillment, lookup)) {
        rows.push({ order, fulfillment });
      }
    }
  }
  return rows;
}

function g36bSafeSubscriptionSummary(row) {
  return row ? {
    id: row.id || null,
    status: sanitizeText(row.status, 80),
    plan_id_present: Boolean(row.plan_id),
    bundle_id_present: Boolean(row.bundle_id),
    started_date: g36bDate(row.started_date) || null,
    next_delivery_date: g36bDate(row.next_delivery_date) || null,
    cancel_at_period_end: row.cancel_at_period_end === true,
    cancel_effective_date: g36bDate(row.cancel_effective_date) || null,
    paused_until: g36bDate(row.paused_until) || null,
    stripe_subscription_id_present: Boolean(row.stripe_subscription_id),
    hub_sync_status: sanitizeText(row.hub_sync_status, 80),
  } : null;
}

function g36bSafeNativeOrderSummary(row, lookup) {
  if (!row) return null;
  const fulfillmentMatches = g36bNativeFulfillmentRows([row], lookup).map(({ fulfillment }) => ({
    fulfillment_number: fulfillment.fulfillment_number ?? null,
    delivery_date: g36bDate(fulfillment.delivery_date || fulfillment.assigned_delivery_date || fulfillment.scheduled_date) || null,
    production_date: g36bDate(fulfillment.production_date) || null,
    status: sanitizeText(fulfillment.status, 80),
    item_count: Array.isArray(fulfillment.items) ? fulfillment.items.length : null,
  })).slice(0, 5);
  return {
    id: row.id || null,
    order_number: sanitizeText(normalizeOrderNumber(row.shopify_order_number || row.order_number || row.native_order_number), 80),
    order_type: sanitizeText(row.order_type, 80),
    fulfillment_mode: sanitizeText(row.fulfillment_mode, 80),
    source_channel: sanitizeText(row.source_channel, 80),
    source_type: sanitizeText(row.source_type, 80),
    payment_status: sanitizeText(row.payment_status || row.financial_status, 80),
    production_status: sanitizeText(row.production_status, 80),
    fulfillment_status: sanitizeText(row.fulfillment_status, 80),
    assigned_delivery_date: g36bDate(row.assigned_delivery_date || row.selected_delivery_date) || null,
    stripe_subscription_id_present: Boolean(row.stripe_subscription_id),
    customer_app_subscription_id_present: Boolean(row.customer_app_subscription_id),
    fulfillment_count: Array.isArray(row.fulfillments) ? row.fulfillments.length : 0,
    matching_fulfillments: fulfillmentMatches,
  };
}

function g36bSafeTaskSummary(row) {
  return row ? {
    id: row.id || null,
    order_number: sanitizeText(normalizeOrderNumber(row.order_number || row.shopify_order_number), 80),
    order_type: sanitizeText(row.order_type, 80),
    source_type: sanitizeText(row.source_type, 80),
    fulfillment_type: sanitizeText(row.fulfillment_type, 80),
    fulfillment_number: row.fulfillment_number ?? null,
    status: sanitizeText(row.status, 80),
    delivery_status: sanitizeText(row.delivery_status, 80),
    production_status: sanitizeText(row.production_status, 80),
    payment_status: sanitizeText(row.payment_status, 80),
    delivery_date: g36bDate(row.delivery_date || row.scheduled_date || row.assigned_delivery_date) || null,
    production_date: g36bDate(row.production_date) || null,
    item_count: Array.isArray(row.items) ? row.items.length : null,
    items_summary_present: Boolean(row.items_summary),
    stripe_subscription_id_present: Boolean(row.stripe_subscription_id),
    customer_app_subscription_id_present: Boolean(row.customer_app_subscription_id),
  } : null;
}

function g36bSafeHubTaskSummary(row) {
  return row ? {
    id: row.id || null,
    order_id: row.order_id || null,
    order_number: sanitizeText(normalizeOrderNumber(row.order_number), 80),
    fulfillment_number: row.fulfillment_number ?? null,
    status: sanitizeText(row.status, 80),
    delivery_status: sanitizeText(row.delivery_status, 80),
    scheduled_date: g36bDate(row.scheduled_date) || null,
    production_date: g36bDate(row.production_date) || null,
    delivery_date: g36bDate(row.delivery_date || row.scheduled_date) || null,
    source_type: sanitizeText(row.source_type, 80),
    schedule_source: sanitizeText(row.schedule_source, 80),
    payment_status: sanitizeText(row.payment_status, 80),
    items_summary_present: Boolean(row.items_summary),
  } : null;
}

function g36bOrderSourceMatches(source, lookup) {
  if (!source) return false;
  if (lookup.customerAppOrderId && [source.order_id, source.base44_order_id, source.customer_app_order_id, source.source_order_id].some(value => normalizeText(value) === lookup.customerAppOrderId)) return true;
  if (lookup.nativeOrderId && [source.native_shopify_order_id, source.shopify_order_id, source.native_order_id, source.source_native_shopify_order_id].some(value => normalizeText(value) === lookup.nativeOrderId)) return true;
  if (lookup.fulfillmentTaskId && [source.native_fulfillment_task_id, source.fulfillment_task_id, source.source_fulfillment_task_id].some(value => normalizeText(value) === lookup.fulfillmentTaskId)) return true;
  if (lookup.subscriptionId && [source.subscription_id, source.customer_app_subscription_id].some(value => normalizeText(value) === lookup.subscriptionId)) return true;
  if (lookup.stripeSubscriptionId && [source.stripe_subscription_id, source.subscription_id].some(value => normalizeText(value) === lookup.stripeSubscriptionId)) return true;
  if (lookup.orderNumber) {
    const key = g33cOrderKey(lookup.orderNumber);
    if ([source.order_number, source.shopify_order_number, source.source_order_number, source.hub_order_number].some(value => g33cOrderKey(value) === key)) return true;
  }
  return false;
}

async function g36bProductionBatches(base44, lookup) {
  const rows = await g33cList(base44, 'ProductionBatch', '-production_date', 800);
  return rows.filter(batch => {
    if (!batch) return false;
    if (lookup.customerAppOrderId && [batch.base44_order_id, batch.order_id, batch.customer_app_order_id, batch.source_order_id].some(value => normalizeText(value) === lookup.customerAppOrderId)) return true;
    if (lookup.nativeOrderId && [batch.native_shopify_order_id, batch.shopify_order_id, batch.native_order_id].some(value => normalizeText(value) === lookup.nativeOrderId)) return true;
    if (lookup.fulfillmentTaskId && [batch.native_fulfillment_task_id, batch.fulfillment_task_id].some(value => normalizeText(value) === lookup.fulfillmentTaskId)) return true;
    if (lookup.orderNumber) {
      const key = g33cOrderKey(lookup.orderNumber);
      if ([batch.order_number, batch.shopify_order_number, batch.source_order_number].some(value => g33cOrderKey(value) === key)) return true;
      if (normalizeText(batch.batch_id).includes(`NATIVE-${lookup.orderNumber}`)) return true;
    }
    return Array.isArray(batch.order_sources) && batch.order_sources.some(source => g36bOrderSourceMatches(source, lookup));
  });
}

function g36bProductionDemandImpact(batches) {
  const rows = (batches || []).slice(0, 10).map(batch => ({
    id: batch.id || null,
    batch_id: sanitizeText(batch.batch_id, 120),
    product_name: sanitizeText(batch.product_name, 120),
    status: sanitizeText(batch.status || batch.production_status, 80),
    production_date: g36bDate(batch.production_date) || null,
    planned_units: safeNumber(batch.planned_units, 0),
    order_source_count: Array.isArray(batch.order_sources) ? batch.order_sources.length : 0,
  }));
  return {
    native_production_batch_count: batches?.length || 0,
    native_production_batch_rows: rows,
    production_demand_duplication_risk: (batches?.length || 0) > 0,
    production_batch_mutation_proposed: false,
    proposed_action: (batches?.length || 0) > 0 ? 'read_only_existing_native_production_context_requires_review' : 'no_native_production_demand_found',
  };
}

async function g36bHubFulfillmentTasks(base44, lookup) {
  const hubApiUrl = normalizeText(Deno.env.get('HUB_API_URL'));
  const hubSecret = normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET'));
  const safeBase = {
    configured: Boolean(hubApiUrl && hubSecret),
    hub_read_attempted: false,
    hub_read_succeeded: false,
    hub_read_error: null,
    tasks: [],
    matched_by: null,
    provider_call_impact: false,
    hub_mutation_performed: false,
  };
  if (!safeBase.configured) return { ...safeBase, hub_read_error: 'hub_task_detail_service_not_configured' };

  const params = new URLSearchParams();
  if (lookup.hubOrderId) params.set('hub_order_id', lookup.hubOrderId);
  if (lookup.orderNumber) params.set('order_number', lookup.orderNumber);
  if (lookup.stripeSubscriptionId) params.set('stripe_subscription_id', lookup.stripeSubscriptionId);
  if (lookup.customerAppOrderId) params.set('customer_app_order_id', lookup.customerAppOrderId);
  if (!params.toString()) return { ...safeBase, hub_read_error: 'hub_task_detail_identifier_required' };
  params.set('limit', '20');

  try {
    const hubBase = hubApiUrl.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const url = `${hubBase}/functions/getFulfillmentTaskDetailsForCustomerApp?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${hubSecret}` } });
    if (!response.ok) return { ...safeBase, hub_read_attempted: true, hub_read_error: `hub_task_detail_status_${response.status}` };
    const data = await response.json().catch(() => null);
    if (!data || data.success !== true || !Array.isArray(data.tasks)) return { ...safeBase, hub_read_attempted: true, hub_read_error: 'hub_task_detail_malformed_response' };
    const tasks = data.tasks.filter(task => {
      if (lookup.hubFulfillmentTaskId && normalizeText(task?.id) !== lookup.hubFulfillmentTaskId) return false;
      if (lookup.fulfillmentNumber !== null && Number(task?.fulfillment_number) !== lookup.fulfillmentNumber) return false;
      if (lookup.deliveryDate) {
        const date = g36bDate(task?.delivery_date || task?.scheduled_date);
        if (date !== lookup.deliveryDate) return false;
      }
      return true;
    });
    return {
      ...safeBase,
      hub_read_attempted: true,
      hub_read_succeeded: true,
      tasks,
      matched_by: sanitizeText(data.matched_by, 120),
    };
  } catch (error) {
    return { ...safeBase, hub_read_attempted: true, hub_read_error: sanitizeText(error?.message || 'hub_task_detail_read_failed', 160) };
  }
}

async function g36bResolveExactContext(base44, lookup) {
  const subscriptionRows = [];
  if (lookup.subscriptionId) subscriptionRows.push(...await g33cFilter(base44, 'Subscription', { id: lookup.subscriptionId }, '-created_date', 5, { retryEmpty: true }));
  if (lookup.customerAppSubscriptionId && lookup.customerAppSubscriptionId !== lookup.subscriptionId) subscriptionRows.push(...await g33cFilter(base44, 'Subscription', { id: lookup.customerAppSubscriptionId }, '-created_date', 5, { retryEmpty: true }));
  if (lookup.stripeSubscriptionId) subscriptionRows.push(...await g33cFilter(base44, 'Subscription', { stripe_subscription_id: lookup.stripeSubscriptionId }, '-created_date', 10, { retryEmpty: true }));
  const subscriptions = g33cUnique(subscriptionRows);
  const subscription = subscriptions[0] || null;
  const enrichedLookup = {
    ...lookup,
    subscriptionId: lookup.subscriptionId || subscription?.id || '',
    customerAppSubscriptionId: lookup.customerAppSubscriptionId || subscription?.id || '',
    stripeSubscriptionId: lookup.stripeSubscriptionId || subscription?.stripe_subscription_id || '',
  };

  const customerOrders = g33cUnique([
    ...await g33cCustomerOrders(base44, enrichedLookup),
  ]).filter(row => g36bOrderMatchesOccurrence(row, enrichedLookup));

  const nativeRows = [];
  if (enrichedLookup.nativeOrderId) nativeRows.push(...await g33cFilter(base44, 'ShopifyOrder', { id: enrichedLookup.nativeOrderId }, '-created_date', 5, { retryEmpty: true }));
  if (enrichedLookup.customerAppOrderId || enrichedLookup.orderNumber) nativeRows.push(...await g35bNativeOrders(base44, enrichedLookup, customerOrders[0] || null));
  if (enrichedLookup.customerAppSubscriptionId) nativeRows.push(...await g33cFilter(base44, 'ShopifyOrder', { customer_app_subscription_id: enrichedLookup.customerAppSubscriptionId }, '-created_date', 20, { retryEmpty: true }));
  if (enrichedLookup.stripeSubscriptionId) nativeRows.push(...await g33cFilter(base44, 'ShopifyOrder', { stripe_subscription_id: enrichedLookup.stripeSubscriptionId }, '-created_date', 20, { retryEmpty: true }));
  const nativeOrders = g33cUnique(nativeRows).filter(row => g36bNativeOrderMatchesOccurrence(row, enrichedLookup) || g36bHasSubscriptionSignal(row));
  const nativeOrder = nativeOrders[0] || null;
  const lookupWithNative = { ...enrichedLookup, nativeOrderId: enrichedLookup.nativeOrderId || nativeOrder?.id || '' };

  const taskRows = [];
  if (lookupWithNative.fulfillmentTaskId) taskRows.push(...await g33cFilter(base44, 'FulfillmentTask', { id: lookupWithNative.fulfillmentTaskId }, '-created_date', 5, { retryEmpty: true }));
  taskRows.push(...await g33cTasks(base44, lookupWithNative.orderNumber, lookupWithNative.customerAppOrderId, lookupWithNative.nativeOrderId, lookupWithNative.fulfillmentTaskId));
  if (lookupWithNative.customerAppSubscriptionId) taskRows.push(...await g33cFilter(base44, 'FulfillmentTask', { customer_app_subscription_id: lookupWithNative.customerAppSubscriptionId }, '-created_date', 25, { retryEmpty: true }));
  if (lookupWithNative.stripeSubscriptionId) taskRows.push(...await g33cFilter(base44, 'FulfillmentTask', { stripe_subscription_id: lookupWithNative.stripeSubscriptionId }, '-created_date', 25, { retryEmpty: true }));
  const nativeTasks = g33cUnique(taskRows).filter(row => g36bTaskMatchesOccurrence(row, lookupWithNative));
  const exactNativeTasks = nativeTasks.filter(row => g36bTaskMatchesExactOccurrence(row, lookupWithNative));
  const nativeFulfillmentMatches = g36bNativeFulfillmentRows(nativeOrders, lookupWithNative);
  const hubTaskContext = await g36bHubFulfillmentTasks(base44, lookupWithNative);
  const productionBatches = await g36bProductionBatches(base44, lookupWithNative);

  return {
    lookup: lookupWithNative,
    subscriptions,
    subscription,
    customerOrders,
    customerOrder: customerOrders[0] || null,
    nativeOrders,
    nativeOrder,
    nativeTasks,
    exactNativeTasks,
    nativeFulfillmentMatches,
    hubTaskContext,
    productionBatches,
  };
}

function g36bOccurrenceIdentityStatus({ lookup, context }) {
  const exactSignals = [];
  if (lookup.occurrenceId) exactSignals.push('occurrence_id');
  if (lookup.fulfillmentTaskId) exactSignals.push('fulfillment_task_id');
  if (lookup.hubFulfillmentTaskId) exactSignals.push('hub_fulfillment_task_id');
  if (lookup.fulfillmentNumber !== null && lookup.deliveryDate) exactSignals.push('fulfillment_number_delivery_date');
  if (lookup.orderNumber && lookup.fulfillmentNumber !== null) exactSignals.push('order_number_fulfillment_number');
  if (lookup.orderNumber && lookup.deliveryDate) exactSignals.push('order_number_delivery_date');
  const occurrenceLocatorSupplied = Boolean(
    lookup.occurrenceId ||
    lookup.fulfillmentTaskId ||
    lookup.hubFulfillmentTaskId ||
    lookup.orderNumber ||
    (lookup.fulfillmentNumber !== null && lookup.deliveryDate)
  );
  if (occurrenceLocatorSupplied && context?.hubTaskContext?.tasks?.length === 1) exactSignals.push('unique_hub_fulfillment_task');
  if (occurrenceLocatorSupplied && context?.exactNativeTasks?.length === 1) exactSignals.push('unique_native_fulfillment_task');
  const parentSignals = [lookup.subscriptionId, lookup.customerAppSubscriptionId, lookup.stripeSubscriptionId, context?.subscription?.id].filter(Boolean);
  const hasParent = parentSignals.length > 0;
  const exact = exactSignals.length > 0;
  return {
    status: exact ? 'exact_occurrence_identity_available' : hasParent ? 'parent_only_occurrence_identity_missing' : 'no_subscription_occurrence_identity',
    exact_occurrence_identity_supplied: exact,
    parent_subscription_identity_supplied: hasParent,
    exact_signals: [...new Set(exactSignals)],
    ambiguous: hasParent && !exact,
  };
}

function g36bCustomerAppCancelledMirrorTreatAsStale(lookup) {
  return normalizeText(lookup?.customerAppCancelledMirrorTreatment) === 'stale_artifact_for_this_preview_only';
}

function g36bHasRefundCancellationAmbiguity(context, lookup = {}) {
  const rows = [context.subscription, context.nativeOrder, ...(context.nativeTasks || []), ...(context.hubTaskContext?.tasks || [])];
  if (!g36bCustomerAppCancelledMirrorTreatAsStale(lookup)) rows.push(context.customerOrder);
  return rows.some(row => {
    const statusText = [row?.status, row?.payment_status, row?.financial_status, row?.production_status, row?.fulfillment_status, row?.delivery_status, row?.refund_status].map(normalizeLower).join(' ');
    const tags = Array.isArray(row?.tags) ? row.tags.map(normalizeLower).join(' ') : '';
    return /refund|cancel|canceled|cancelled|do_not_sync|excluded|quarantined/.test(`${statusText} ${tags}`) || row?.cancel_at_period_end === true;
  });
}

function g36bHasLineItems(context) {
  const nativeFulfillmentHasItems = (context.nativeFulfillmentMatches || []).some(({ fulfillment }) => Array.isArray(fulfillment?.items) && fulfillment.items.length > 0);
  const nativeOrderHasItems = (context.nativeOrders || []).some(order => Array.isArray(order?.line_items) && order.line_items.length > 0);
  const nativeTaskHasItems = (context.nativeTasks || []).some(task => Array.isArray(task?.items) && task.items.length > 0 || Boolean(task?.items_summary));
  const hubTaskHasItems = (context.hubTaskContext?.tasks || []).some(task => Boolean(task?.items_summary) || Array.isArray(task?.items) && task.items.length > 0);
  return nativeFulfillmentHasItems || nativeOrderHasItems || nativeTaskHasItems || hubTaskHasItems;
}

function g36bClassification({ context, identityStatus, blockers }) {
  const hubTaskCount = context.hubTaskContext?.tasks?.length || 0;
  const nativeTaskCount = context.exactNativeTasks?.length || context.nativeTasks?.length || 0;
  if (!context.subscription && !hubTaskCount && !context.nativeOrder && !nativeTaskCount && !context.customerOrder) return 'not_applicable_no_subscription_context';
  if (identityStatus.ambiguous) return 'subscription_occurrence_identity_ambiguous';
  if (nativeTaskCount > 1 || hubTaskCount > 1) return 'duplicate_occurrence_risk';
  if (blockers.includes('refund_cancellation_ambiguity')) return 'unsupported_subscription_multi_delivery';
  if (hubTaskCount > 0 && nativeTaskCount === 0) return 'hub_source_of_truth_subscription_occurrence';
  if (context.subscription && hubTaskCount > 0 && !context.nativeOrder) return 'customer_app_parent_only_hub_occurrence_present';
  if (context.subscription && hubTaskCount === 0) return 'hub_occurrence_missing_customer_app_context';
  if (context.nativeOrder && nativeTaskCount === 0) return 'native_task_missing';
  if (nativeTaskCount === 1) return 'native_task_present_read_only';
  if (identityStatus.exact_occurrence_identity_supplied && blockers.length === 0) return 'preview_ready_for_exact_occurrence_pilot';
  return 'no_action_hub_only_context';
}

function g36bNextAction({ blockers, classification, identityStatus }) {
  if (blockers.includes('no_exact_subscription_occurrence_identity') || identityStatus.ambiguous) return 'provide_exact_subscription_occurrence_ids';
  if (blockers.includes('duplicate_task_risk') || blockers.includes('duplicate_occurrence_risk')) return 'duplicate_risk_requires_manual_review';
  if (blockers.includes('refund_cancellation_ambiguity')) return 'unsupported_subscription_multi_delivery_hold';
  if (blockers.includes('missing_hub_occurrence_when_hub_source_of_truth')) return 'wait_for_subscription_occurrence_with_clean_identity';
  if (classification === 'preview_ready_for_exact_occurrence_pilot') return 'plan_exact_subscription_occurrence_pilot_later';
  if (classification === 'hub_source_of_truth_subscription_occurrence') return 'hold_hub_source_of_truth';
  return 'preview_exact_subscription_occurrence_again';
}

function g36bDeliveryTaskImpact(context) {
  const hubTasks = context.hubTaskContext?.tasks || [];
  const nativeTasks = context.exactNativeTasks?.length ? context.exactNativeTasks : context.nativeTasks;
  return {
    hub_fulfillment_task_count: hubTasks.length,
    native_fulfillment_task_count: nativeTasks.length,
    hub_fulfillment_task_rows: hubTasks.slice(0, 5).map(g36bSafeHubTaskSummary),
    native_fulfillment_task_rows: nativeTasks.slice(0, 5).map(g36bSafeTaskSummary),
    native_task_mutation_proposed: false,
    hub_task_mutation_proposed: false,
    proposed_action: hubTasks.length > 0 && nativeTasks.length === 0
      ? 'hub_task_present_native_task_held'
      : nativeTasks.length > 0
        ? 'native_task_present_read_only_no_write'
        : 'no_task_write_preview_only',
  };
}

function g36bCancellationRefundRisk(context, lookup = {}) {
  const ambiguous = g36bHasRefundCancellationAmbiguity(context, lookup);
  const customerAppParentStatusText = [context?.customerOrder?.status, context?.customerOrder?.payment_status, context?.customerOrder?.fulfillment_status, context?.customerOrder?.delivery_status].map(normalizeLower).join(' ');
  const customerAppParentHasCancelMarker = /cancel|canceled|cancelled|refund/.test(customerAppParentStatusText);
  const customerAppCancelledMirrorTreatment = g36bCustomerAppCancelledMirrorTreatAsStale(lookup)
    ? 'stale_artifact_for_this_preview_only'
    : null;
  return {
    refund_or_cancellation_ambiguity_detected: ambiguous,
    customer_app_parent_cancelled_mirror_present: customerAppParentHasCancelMarker,
    customer_app_cancelled_mirror_treatment: customerAppCancelledMirrorTreatment,
    partial_refund_handling_supported_now: false,
    parent_cancellation_supported_now: false,
    current_cycle_mutation_proposed: false,
    recommended_policy: ambiguous ? 'manual_review_hub_source_of_truth' : 'no_refund_cancellation_context_detected',
  };
}

function g36bOwnerApprovedNo(value) {
  return ['no', 'false', 'none'].includes(normalizeLower(value));
}

function g36bOwnerDecisionContext(lookup, context) {
  const selectedTask = (context?.hubTaskContext?.tasks || []).find(task => normalizeText(task?.id) === lookup.selectedHubFulfillmentTaskId) || (context?.hubTaskContext?.tasks || [])[0] || null;
  const selectedTaskPaymentStatus = sanitizeText(selectedTask?.payment_status, 80);
  const selectedPaymentStatus = lookup.selectedHubFulfillmentTaskId
    ? selectedTaskPaymentStatus
    : sanitizeText(selectedTask?.payment_status || lookup.ownerPaymentStatus, 80);
  const selectedFulfillmentStatus = sanitizeText(selectedTask?.delivery_status || selectedTask?.fulfillment_status || selectedTask?.status || lookup.ownerFulfillmentStatus, 80);
  return {
    selected_hub_fulfillment_task_id: lookup.selectedHubFulfillmentTaskId || selectedTask?.id || null,
    ignored_duplicate_hub_fulfillment_task_id: lookup.ignoredDuplicateHubFulfillmentTaskId || null,
    duplicate_resolution_status: lookup.selectedHubFulfillmentTaskId && lookup.ignoredDuplicateHubFulfillmentTaskId
      ? 'owner_selected_duplicate_same_occurrence_task_for_read_only_preview'
      : 'no_owner_duplicate_resolution_supplied',
    payment_status: selectedPaymentStatus || null,
    payment_status_authority: selectedPaymentStatus
      ? {
          status: selectedPaymentStatus,
          authority: selectedPaymentStatus === 'paid' ? 'hub_task_paid_context_owner_approved' : 'owner_supplied_status_read_only',
          selected_hub_task_payment_status: selectedTaskPaymentStatus || null,
          owner_supplied_payment_status: lookup.ownerPaymentStatus || null,
          mutation_proposed: false,
        }
      : null,
    fulfillment_status: lookup.ownerFulfillmentStatus || selectedFulfillmentStatus || null,
    line_item_count: lookup.ownerLineItemCount,
    line_item_interpretation: lookup.ownerLineItemInterpretation || null,
    decomposed_production_item_count: lookup.ownerDecomposedProductionItemCount || null,
    known_cancellation_refund_issue: lookup.knownCancellationRefundIssue || null,
    known_repair_replay_issue: lookup.knownRepairReplayIssue || null,
    customer_app_cancelled_mirror_treatment: lookup.customerAppCancelledMirrorTreatment || null,
    owner_decision_applied: Boolean(
      lookup.selectedHubFulfillmentTaskId ||
      lookup.ignoredDuplicateHubFulfillmentTaskId ||
      lookup.ownerPaymentStatus ||
      lookup.ownerLineItemCount !== null ||
      lookup.customerAppCancelledMirrorTreatment
    ),
  };
}

async function buildG36BExactPreview(base44, body) {
  const lookup = g36bLookup(body);
  const requestBlockers = [];
  const warnings = [];
  if (!lookup.subscriptionId && !lookup.customerAppSubscriptionId && !lookup.stripeSubscriptionId && !lookup.orderNumber && !lookup.occurrenceId && !lookup.fulfillmentTaskId && !lookup.nativeOrderId && !lookup.customerAppOrderId && !lookup.hubOrderId) {
    requestBlockers.push('no_exact_subscription_occurrence_identity');
  }

  const context = await g36bResolveExactContext(base44, lookup);
  const identityStatus = g36bOccurrenceIdentityStatus({ lookup: context.lookup, context });
  const hubTaskCount = context.hubTaskContext?.tasks?.length || 0;
  const nativeTaskCount = context.exactNativeTasks?.length || context.nativeTasks?.length || 0;
  const productionDemandImpact = g36bProductionDemandImpact(context.productionBatches);
  const cancellationRefundRisk = g36bCancellationRefundRisk(context, context.lookup);
  const ownerDecisionContext = g36bOwnerDecisionContext(context.lookup, context);
  const blockers = [...requestBlockers];

  if (identityStatus.ambiguous) blockers.push('subscription_occurrence_identity_ambiguous');
  if (!context.lookup.deliveryDate && context.lookup.fulfillmentNumber === null && !context.lookup.occurrenceId && !context.lookup.fulfillmentTaskId && !context.lookup.hubFulfillmentTaskId && !context.lookup.orderNumber) blockers.push('missing_delivery_date');
  if (nativeTaskCount > 1 || hubTaskCount > 1) blockers.push('duplicate_task_risk', 'duplicate_occurrence_risk');
  if (cancellationRefundRisk.refund_or_cancellation_ambiguity_detected) blockers.push('refund_cancellation_ambiguity');
  if (!g36bHasLineItems(context) && (hubTaskCount > 0 || nativeTaskCount > 0 || context.nativeFulfillmentMatches.length > 0)) blockers.push('missing_line_items');
  if (ownerDecisionContext.owner_decision_applied) {
    if (context.lookup.selectedHubFulfillmentTaskId && hubTaskCount !== 1) blockers.push('selected_hub_fulfillment_task_not_resolved');
    if (context.lookup.selectedHubFulfillmentTaskId && ownerDecisionContext.payment_status !== 'paid') blockers.push('selected_hub_task_payment_status_not_paid');
    if (context.lookup.ownerLineItemCount === null) blockers.push('owner_line_item_count_required_for_g36d');
    if (!context.lookup.ownerLineItemInterpretation) blockers.push('owner_line_item_interpretation_required_for_g36d');
    if (!g36bOwnerApprovedNo(context.lookup.knownCancellationRefundIssue)) blockers.push('known_cancellation_refund_issue_required_no_for_g36d');
    if (!g36bOwnerApprovedNo(context.lookup.knownRepairReplayIssue)) blockers.push('known_repair_replay_issue_required_no_for_g36d');
  }
  if (identityStatus.exact_occurrence_identity_supplied && context.hubTaskContext.configured && context.hubTaskContext.hub_read_succeeded && hubTaskCount === 0) blockers.push('missing_hub_occurrence_when_hub_source_of_truth');
  if (productionDemandImpact.production_demand_duplication_risk) blockers.push('production_demand_duplication_risk');

  if (!context.hubTaskContext.configured) warnings.push('hub_read_not_configured_local_preview_only');
  if (context.hubTaskContext.hub_read_attempted && !context.hubTaskContext.hub_read_succeeded) warnings.push('hub_read_failed_or_unavailable');
  warnings.push('hub_remains_source_of_truth', 'customer_app_native_writes_held', 'notifications_held', 'refund_cancellation_held', 'production_delivery_native_automation_held', 'occurrence_preview_only', 'no_live_command_available');
  if (ownerDecisionContext.ignored_duplicate_hub_fulfillment_task_id) warnings.push('duplicate_hub_task_ignored_by_owner_decision');
  if (g36bCustomerAppCancelledMirrorTreatAsStale(context.lookup)) warnings.push('customer_app_cancelled_mirror_treated_as_stale_artifact_for_preview_only');
  if (context.lookup.ownerDecomposedProductionItemCount === 'held_for_later') warnings.push('production_decomposition_held');
  if (ownerDecisionContext.owner_decision_applied) warnings.push('owner_decision_context_applied_read_only');

  const orderSyncRows = await g35bLogs(base44, 'OrderSyncLog', { orderNumber: context.lookup.orderNumber, customerOrderId: context.lookup.customerAppOrderId, stripeEventId: '' }, 25);
  const reviewRows = await g35bLogs(base44, 'OrderReviewQueue', { orderNumber: context.lookup.orderNumber, customerOrderId: context.lookup.customerAppOrderId, stripeEventId: '' }, 25);
  const commandRows = await g35bLogs(base44, 'CommandLog', { orderNumber: context.lookup.orderNumber, customerOrderId: context.lookup.customerAppOrderId, stripeEventId: '' }, 25);
  const parityRows = await g35bLogs(base44, 'SafeSyncParityLog', { orderNumber: context.lookup.orderNumber, customerOrderId: context.lookup.customerAppOrderId, stripeEventId: '' }, 25);
  const activeRepairReplayContext = [...orderSyncRows, ...commandRows, ...parityRows].some(row => {
    const text = [row?.status, row?.sync_status, row?.action, row?.hub_action, row?.command_type, row?.reason, row?.description].map(normalizeLower).join(' ');
    return /repair|replay|retry/.test(text) && !/preview|dry_run|skipped|resolved|success/.test(text);
  });
  if (activeRepairReplayContext) blockers.push('active_repair_replay_context');

  const classification = g36bClassification({ context, identityStatus, blockers });
  const nextAction = g36bNextAction({ blockers, classification, identityStatus });

  return {
    success: blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    preview_mode: G36B_PREVIEW_MODE,
    mode: 'EXACT_OCCURRENCE_PREVIEW',
    request_id: context.lookup.requestId || null,
    identifiers: {
      subscription_id: context.subscription?.id || context.lookup.subscriptionId || null,
      customer_app_subscription_id: context.lookup.customerAppSubscriptionId || context.subscription?.id || null,
      stripe_subscription_id_present: Boolean(context.lookup.stripeSubscriptionId || context.subscription?.stripe_subscription_id),
      hub_subscription_id_present: Boolean(context.lookup.hubSubscriptionId),
      order_number: context.lookup.orderNumber || null,
      hub_order_id: context.lookup.hubOrderId || context.hubTaskContext?.tasks?.[0]?.order_id || null,
      occurrence_id: context.lookup.occurrenceId || null,
      fulfillment_number: context.lookup.fulfillmentNumber,
      delivery_date: context.lookup.deliveryDate || null,
      production_date: context.lookup.productionDate || null,
      customer_app_order_id: context.lookup.customerAppOrderId || context.customerOrder?.id || null,
      native_shopify_order_id: context.lookup.nativeOrderId || context.nativeOrder?.id || null,
      native_fulfillment_task_id: context.lookup.fulfillmentTaskId || context.exactNativeTasks?.[0]?.id || context.nativeTasks?.[0]?.id || null,
    },
    customer_app_subscription_present: Boolean(context.subscription?.id),
    hub_subscription_present: hubTaskCount > 0 ? true : (context.hubTaskContext.hub_read_succeeded ? false : null),
    customer_app_parent_order_present: Boolean(context.customerOrder?.id),
    customer_app_parent_status: context.customerOrder ? {
      status: sanitizeText(context.customerOrder.status, 80),
      payment_status: sanitizeText(context.customerOrder.payment_status, 80),
      fulfillment_status: sanitizeText(context.customerOrder.fulfillment_status, 80),
      delivery_status: sanitizeText(context.customerOrder.delivery_status, 80),
    } : null,
    customer_app_cancelled_mirror_treatment: ownerDecisionContext.customer_app_cancelled_mirror_treatment || null,
    hub_occurrence_present: hubTaskCount > 0,
    selected_hub_fulfillment_task_id: ownerDecisionContext.selected_hub_fulfillment_task_id,
    ignored_duplicate_hub_fulfillment_task_id: ownerDecisionContext.ignored_duplicate_hub_fulfillment_task_id,
    duplicate_resolution_status: ownerDecisionContext.duplicate_resolution_status,
    hub_task_status: sanitizeText(context.hubTaskContext?.tasks?.[0]?.status, 80) || null,
    hub_fulfillment_status: sanitizeText(context.hubTaskContext?.tasks?.[0]?.delivery_status || context.hubTaskContext?.tasks?.[0]?.fulfillment_status || context.hubTaskContext?.tasks?.[0]?.status, 80) || null,
    payment_status: ownerDecisionContext.payment_status,
    payment_status_authority: ownerDecisionContext.payment_status_authority,
    line_item_count: ownerDecisionContext.line_item_count,
    line_item_interpretation: ownerDecisionContext.line_item_interpretation,
    decomposed_production_item_count: ownerDecisionContext.decomposed_production_item_count,
    native_shopify_order_present: Boolean(context.nativeOrder?.id),
    native_fulfillment_task_present: nativeTaskCount > 0,
    hub_fulfillment_task_present: hubTaskCount > 0,
    occurrence_identity_status: identityStatus,
    parity_classification: classification,
    customer_app_subscription_summary: g36bSafeSubscriptionSummary(context.subscription),
    native_shopify_order_summary: g36bSafeNativeOrderSummary(context.nativeOrder, context.lookup),
    native_fulfillment_task_summary: (context.exactNativeTasks?.length ? context.exactNativeTasks : context.nativeTasks).slice(0, 5).map(g36bSafeTaskSummary),
    hub_fulfillment_task_summary: (context.hubTaskContext?.tasks || []).slice(0, 5).map(g36bSafeHubTaskSummary),
    hub_read_status: {
      configured: context.hubTaskContext.configured,
      attempted: context.hubTaskContext.hub_read_attempted,
      succeeded: context.hubTaskContext.hub_read_succeeded,
      error: context.hubTaskContext.hub_read_error,
      matched_by: context.hubTaskContext.matched_by,
      hub_mutation_performed: false,
    },
    production_demand_impact: productionDemandImpact,
    delivery_task_impact: g36bDeliveryTaskImpact(context),
    cancellation_refund_risk: cancellationRefundRisk,
    notification_impact: {
      notification_would_send: false,
      notification_held: true,
      notification_rows_created: false,
      message_logs_created: false,
    },
    duplicate_risk: {
      duplicate_task_risk: nativeTaskCount > 1 || hubTaskCount > 1,
      native_task_count: nativeTaskCount,
      hub_task_count: hubTaskCount,
      duplicate_production_demand_risk: productionDemandImpact.production_demand_duplication_risk,
    },
    provider_call_impact: false,
    hub_source_of_truth: true,
    hub_fallback_required: true,
    log_context: {
      order_sync_log_status: g33cStatuses(orderSyncRows),
      review_queue_status: g33cStatuses(reviewRows),
      command_log_status: g33cStatuses(commandRows),
      safe_sync_parity_log_status: g33cStatuses(parityRows),
    },
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    next_action: nextAction,
    safety: G36B_READ_ONLY_SAFETY,
  };
}

function g36fAllowedMode(body) {
  return normalizeText(body?.mode || G36F_MODE).toUpperCase() === G36F_MODE;
}

function g36fSchemaFieldAudit() {
  return {
    schema: 'ShopifyOrder',
    schema_source: 'base44/entities/ShopifyOrder.jsonc',
    supported_top_level_fields: [
      'shopify_order_number',
      'description',
      'source_channel',
      'source_type',
      'order_type',
      'fulfillment_mode',
      'fulfillment_method',
      'requested_delivery_date',
      'assigned_delivery_date',
      'selected_delivery_date',
      'fulfillment_instance_date',
      'payment_status',
      'financial_status',
      'fulfillment_status',
      'shopify_fulfillment_status',
      'production_status',
      'operational_visibility',
      'sync_status',
      'data_quality_status',
      'is_subscription',
      'subscription_parent_id',
      'line_items',
      'tags',
      'internal_notes',
      'audit_trail',
    ],
    enum_mappings: [
      {
        requested: 'source_channel=hub_subscription_occurrence',
        packet_value: 'source_channel=subscription',
        reason: 'ShopifyOrder.source_channel enum supports subscription but not hub_subscription_occurrence.',
      },
      {
        requested: 'order_type=subscription_occurrence',
        packet_value: 'order_type=subscription',
        reason: 'ShopifyOrder.order_type enum supports subscription but not subscription_occurrence.',
      },
      {
        requested: 'production_status=historical_fulfilled',
        packet_value: 'production_status=fulfilled',
        reason: 'ShopifyOrder.production_status enum supports fulfilled but not historical_fulfilled.',
      },
    ],
  };
}

function g36fOmittedFields() {
  return [
    { field: 'shopify_order_id', reason: 'No Shopify order exists for this Hub subscription occurrence and no provider lookup is allowed.' },
    { field: 'hub_subscription_id', reason: 'No top-level ShopifyOrder field; preserved in audit_trail only.' },
    { field: 'hub_order_id', reason: 'No top-level ShopifyOrder field; preserved in audit_trail only.' },
    { field: 'selected_hub_fulfillment_task_id', reason: 'No top-level ShopifyOrder field; preserved in audit_trail only.' },
    { field: 'ignored_duplicate_hub_fulfillment_task_id', reason: 'No top-level ShopifyOrder field; preserved in audit_trail only.' },
    { field: 'line_item_interpretation', reason: 'No top-level ShopifyOrder field; preserved in audit_trail/internal_notes only.' },
    { field: 'decomposed_production_item_count', reason: 'Production decomposition is held and not materialized into line_items.' },
    { field: 'duplicate_resolution_status', reason: 'No top-level ShopifyOrder field; preserved in audit_trail only.' },
    { field: 'customer_app_cancelled_mirror_treatment', reason: 'No top-level ShopifyOrder field; preserved in audit_trail only.' },
    { field: 'customer PII fields', reason: 'customer identity, contact, address, proof, drop, and route fields are intentionally omitted.' },
    { field: 'provider/payment payloads', reason: 'Raw Hub/Stripe/Shopify/provider payloads are intentionally omitted.' },
  ];
}

function g36fSelectedHubTask(context) {
  const lookup = context?.lookup || {};
  const tasks = context?.hubTaskContext?.tasks || [];
  return tasks.find(task => normalizeText(task?.id) === lookup.selectedHubFulfillmentTaskId) || tasks[0] || null;
}

function g36fOwnerContext(lookup, context) {
  const selectedTask = g36fSelectedHubTask(context);
  const selectedTaskStatus = normalizeLower(selectedTask?.payment_status);
  const ownerPaymentStatus = normalizeLower(lookup.ownerPaymentStatus);
  const paymentStatus = selectedTaskStatus || ownerPaymentStatus || '';
  const selectedFulfillmentStatus = normalizeLower(selectedTask?.delivery_status || selectedTask?.fulfillment_status || selectedTask?.status);
  const ownerFulfillmentStatus = normalizeLower(lookup.ownerFulfillmentStatus);
  return {
    selected_task: selectedTask,
    payment_status: paymentStatus,
    payment_status_authority: paymentStatus === 'paid' ? 'hub_task_paid_context_owner_approved' : 'not_authoritative_for_g36f',
    fulfillment_status: ownerFulfillmentStatus || selectedFulfillmentStatus || '',
    line_item_count: lookup.ownerLineItemCount,
    line_item_interpretation: lookup.ownerLineItemInterpretation || null,
    decomposed_production_item_count: lookup.ownerDecomposedProductionItemCount || null,
    customer_app_cancelled_mirror_treatment: lookup.customerAppCancelledMirrorTreatment || null,
  };
}

function g36fExistingRecordChecks(context) {
  const nativeOrders = context.nativeOrders || [];
  const nativeTasks = context.exactNativeTasks?.length ? context.exactNativeTasks : (context.nativeTasks || []);
  const productionBatches = context.productionBatches || [];
  return {
    native_shopify_order_present: nativeOrders.length > 0,
    native_shopify_order_count: nativeOrders.length,
    native_shopify_order_ids: nativeOrders.slice(0, 5).map(row => row.id || null).filter(Boolean),
    native_fulfillment_task_present: nativeTasks.length > 0,
    native_fulfillment_task_count: nativeTasks.length,
    native_fulfillment_task_ids: nativeTasks.slice(0, 5).map(row => row.id || null).filter(Boolean),
    customer_app_order_present: Boolean(context.customerOrder?.id),
    customer_app_order_id: context.customerOrder?.id || null,
    production_batch_present: productionBatches.length > 0,
    production_batch_count: productionBatches.length,
    hub_selected_task_present: Boolean(g36fSelectedHubTask(context)?.id),
    hub_selected_task_id: g36fSelectedHubTask(context)?.id || null,
    ignored_duplicate_hub_fulfillment_task_id: context.lookup.ignoredDuplicateHubFulfillmentTaskId || null,
    hub_mutation_performed: false,
  };
}

function g36fHeldRecords() {
  return {
    customer_app_order: { held: true, would_create: false, would_update: false },
    native_fulfillment_task: { held: true, would_create: false, would_update: false },
    production_batch: { held: true, would_create: false, would_update: false },
    batch_compliance_log: { held: true, would_create: false, would_update: false },
    notification: { held: true, would_create: false, would_send: false },
    customer_message_delivery_log: { held: true, would_create: false },
    order_sync_log: { held: true, would_create: false },
    command_log: { held: true, would_create: false },
    order_review_queue: { held: true, would_create: false },
    hub_records: { held: true, would_update: false, hub_source_of_truth: true },
    proof_drop_route: { held: true, included_in_packet: false },
    inventory_purchase_order: { held: true, inventory_reversal: false, purchase_order_reversal: false },
  };
}

function g36fDuplicateRisk({ context, existingRecordChecks }) {
  const reasons = [];
  if (existingRecordChecks.native_shopify_order_present) reasons.push('existing_native_shopify_order_for_occurrence_context');
  if (existingRecordChecks.native_fulfillment_task_present) reasons.push('existing_native_fulfillment_task_for_occurrence_context');
  if (existingRecordChecks.production_batch_present) reasons.push('existing_native_production_batch_for_occurrence_context');
  if (context.lookup.ignoredDuplicateHubFulfillmentTaskId) reasons.push('ignored_duplicate_hub_task_context_recorded_by_owner_decision');
  return {
    duplicate_risk: reasons.some(reason => reason !== 'ignored_duplicate_hub_task_context_recorded_by_owner_decision'),
    duplicate_risk_reasons: reasons,
    duplicate_resolution_status: context.lookup.selectedHubFulfillmentTaskId && context.lookup.ignoredDuplicateHubFulfillmentTaskId
      ? 'owner_selected_duplicate_same_occurrence_task'
      : 'no_owner_duplicate_resolution_supplied',
    ignored_duplicate_is_context_only: Boolean(context.lookup.ignoredDuplicateHubFulfillmentTaskId),
  };
}

function g36fValidatePacketInputs({ body, context, ownerContext, existingRecordChecks }) {
  const blockers = [];
  const schemaBlockers = [];
  if (!g36fAllowedMode(body)) blockers.push('unsupported_g36f_mode');
  if (!context.lookup.hubOrderId || !context.lookup.orderNumber || !context.lookup.deliveryDate) blockers.push('exact_subscription_occurrence_context_required');
  if (!context.lookup.selectedHubFulfillmentTaskId) blockers.push('selected_hub_fulfillment_task_id_required');
  if (!existingRecordChecks.hub_selected_task_present) blockers.push('selected_hub_fulfillment_task_not_resolved');
  if (ownerContext.payment_status !== 'paid') blockers.push('selected_hub_task_payment_status_not_paid');
  if (!['delivered', 'fulfilled', 'completed'].includes(ownerContext.fulfillment_status)) {
    blockers.push('schema_packet_blocker');
    schemaBlockers.push('fulfillment_status_value_not_supported_for_g36f_packet');
  }
  if (ownerContext.line_item_count === null || ownerContext.line_item_count < 1) blockers.push('owner_line_item_count_required_for_g36f');
  if (ownerContext.line_item_interpretation !== 'subscription bundle/package count') {
    blockers.push('schema_packet_blocker');
    schemaBlockers.push('line_item_interpretation_not_approved_for_g36f_packet');
  }
  if (ownerContext.decomposed_production_item_count !== 'held_for_later') blockers.push('production_decomposition_must_be_held_for_g36f');
  if (!g36bOwnerApprovedNo(context.lookup.knownCancellationRefundIssue)) blockers.push('known_cancellation_refund_issue_required_no_for_g36f');
  if (!g36bOwnerApprovedNo(context.lookup.knownRepairReplayIssue)) blockers.push('known_repair_replay_issue_required_no_for_g36f');
  if (!g36bCustomerAppCancelledMirrorTreatAsStale(context.lookup)) blockers.push('customer_app_cancelled_mirror_treatment_required_for_g36f');
  if (existingRecordChecks.native_shopify_order_present) blockers.push('existing_native_shopify_order_found');
  if (existingRecordChecks.native_fulfillment_task_present) blockers.push('existing_native_fulfillment_task_found');
  if (existingRecordChecks.production_batch_present) blockers.push('native_production_demand_already_present');
  return {
    blockers: [...new Set(blockers)],
    schema_blockers: [...new Set(schemaBlockers)],
  };
}

function g36fBuildNativeShopifyOrderPacket({ lookup, ownerContext, requestId }) {
  const orderNumber = lookup.orderNumber ? `#${normalizeOrderNumber(lookup.orderNumber)}` : null;
  const auditEntry = compactObject({
    action: 'g36f_subscription_occurrence_mirror_packet_preview',
    request_id: requestId || null,
    source_type: 'subscription_occurrence_hub_preview',
    source_channel_requested: 'hub_subscription_occurrence',
    source_channel_packet_value: 'subscription',
    hub_subscription_id: lookup.hubSubscriptionId || lookup.stripeSubscriptionId || null,
    hub_order_id: lookup.hubOrderId || null,
    selected_hub_fulfillment_task_id: lookup.selectedHubFulfillmentTaskId || null,
    ignored_duplicate_hub_fulfillment_task_id: lookup.ignoredDuplicateHubFulfillmentTaskId || null,
    parent_order_number: orderNumber,
    delivery_date: lookup.deliveryDate || null,
    payment_status: ownerContext.payment_status || null,
    fulfillment_status: 'fulfilled',
    line_item_count: ownerContext.line_item_count,
    line_item_interpretation: ownerContext.line_item_interpretation,
    decomposed_production_item_count: ownerContext.decomposed_production_item_count,
    duplicate_resolution_status: 'owner_selected_duplicate_same_occurrence_task',
    customer_app_cancelled_mirror_treatment: ownerContext.customer_app_cancelled_mirror_treatment,
    known_cancellation_refund_issue: lookup.knownCancellationRefundIssue || null,
    known_repair_replay_issue: lookup.knownRepairReplayIssue || null,
    hub_source_of_truth: true,
    writes_performed: false,
  });
  return compactObject({
    shopify_order_number: orderNumber,
    description: 'G36F read-only preview packet for a Hub subscription occurrence native ShopifyOrder mirror. No write approved.',
    source_channel: 'subscription',
    source_type: 'subscription_occurrence_hub_preview',
    order_type: 'subscription',
    fulfillment_mode: 'single_delivery',
    fulfillment_method: 'delivery',
    requested_delivery_date: lookup.deliveryDate || null,
    assigned_delivery_date: lookup.deliveryDate || null,
    selected_delivery_date: lookup.deliveryDate || null,
    fulfillment_instance_date: lookup.deliveryDate || null,
    payment_status: ownerContext.payment_status || null,
    financial_status: ownerContext.payment_status || null,
    fulfillment_status: 'fulfilled',
    shopify_fulfillment_status: 'fulfilled',
    production_status: 'fulfilled',
    operational_visibility: 'historical_preview',
    sync_status: 'native_subscription_occurrence_preview_g36f',
    data_quality_status: 'preview_only_hub_source_of_truth_owner_approved_occurrence',
    is_subscription: true,
    subscription_parent_id: lookup.hubSubscriptionId || lookup.stripeSubscriptionId || null,
    line_items: ownerContext.line_item_count ? [{
      title: 'Subscription bundle/package (production decomposition held)',
      quantity: ownerContext.line_item_count,
    }] : [],
    tags: [
      'g36f_preview',
      'subscription_occurrence',
      'hub_source_of_truth',
      'native_shopify_order_mirror_preview_only',
    ],
    internal_notes: 'Read-only G36F mirror packet preview. Customer App Order, FulfillmentTask, production, notifications, providers, Hub mutation, inventory, and PO are held.',
    audit_trail: [auditEntry],
  });
}

async function buildG36FPreview(base44, body) {
  const lookup = g36bLookup({ ...body, mode: 'EXACT_OCCURRENCE_PREVIEW' });
  const context = await g36bResolveExactContext(base44, lookup);
  const ownerContext = g36fOwnerContext(context.lookup, context);
  const existingRecordChecks = g36fExistingRecordChecks(context);
  const duplicateRisk = g36fDuplicateRisk({ context, existingRecordChecks });
  const validation = g36fValidatePacketInputs({ body, context, ownerContext, existingRecordChecks });
  const blockers = [...validation.blockers];
  const warnings = [
    'hub_source_of_truth',
    'native_shopify_order_mirror_preview_only',
    'native_fulfillment_task_held',
    'customer_app_order_held',
    'production_decomposition_held',
    'duplicate_hub_task_ignored_by_owner_decision',
    'customer_app_cancelled_mirror_treated_as_stale_artifact_for_preview_only',
    'notifications_held',
    'provider_calls_disabled',
    'no_live_command_available',
  ];
  if (!context.hubTaskContext.configured) warnings.push('hub_read_not_configured_local_preview_only');
  if (context.hubTaskContext.hub_read_attempted && !context.hubTaskContext.hub_read_succeeded) warnings.push('hub_read_failed_or_unavailable');
  if (existingRecordChecks.customer_app_order_present) warnings.push('customer_app_parent_context_present_read_only');

  const proposedPacket = g36fBuildNativeShopifyOrderPacket({
    lookup: context.lookup,
    ownerContext,
    requestId: context.lookup.requestId,
  });
  const schemaAudit = g36fSchemaFieldAudit();
  const mirrorPacketReady = blockers.length === 0;
  const nextAction = mirrorPacketReady
    ? 'plan_gated_subscription_occurrence_native_shopify_order_mirror_command'
    : (blockers.includes('schema_packet_blocker') ? 'resolve_schema_packet_blockers' : 'hold_subscription_migration');

  return {
    success: blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    preview_mode: G36F_PREVIEW_MODE,
    mode: G36F_MODE,
    request_id: context.lookup.requestId || null,
    hub_source_of_truth: true,
    mirror_packet_ready: mirrorPacketReady,
    selected_hub_fulfillment_task_id: context.lookup.selectedHubFulfillmentTaskId || null,
    ignored_duplicate_hub_fulfillment_task_id: context.lookup.ignoredDuplicateHubFulfillmentTaskId || null,
    duplicate_resolution_status: duplicateRisk.duplicate_resolution_status,
    payment_status: ownerContext.payment_status || null,
    payment_status_authority: ownerContext.payment_status_authority,
    fulfillment_status: ownerContext.fulfillment_status || null,
    line_item_count: ownerContext.line_item_count,
    line_item_interpretation: ownerContext.line_item_interpretation,
    decomposed_production_item_count: ownerContext.decomposed_production_item_count,
    customer_app_cancelled_mirror_treatment: ownerContext.customer_app_cancelled_mirror_treatment,
    proposed_native_shopify_order_packet: proposedPacket,
    schema_supported_fields: {
      ...schemaAudit,
      packet_top_level_fields: Object.keys(proposedPacket),
    },
    omitted_fields: g36fOmittedFields(),
    held_records: g36fHeldRecords(),
    existing_record_checks: existingRecordChecks,
    duplicate_risk: duplicateRisk,
    blockers: [...new Set(blockers)],
    schema_packet_blockers: validation.schema_blockers,
    warnings: [...new Set(warnings)],
    next_action: nextAction,
    provider_call_impact: false,
    notification_impact: {
      notification_would_send: false,
      notification_held: true,
      notification_rows_created: false,
      message_logs_created: false,
    },
    hub_mutation_performed: false,
    hub_records_updated: false,
    safety: G36B_READ_ONLY_SAFETY,
  };
}

async function buildG36BRecentScan(base44, body) {
  const lookup = g36bLookup(body);
  const limit = lookup.limit || 5;
  const [subscriptions, nativeOrders, tasks] = await Promise.all([
    g33cList(base44, 'Subscription', '-created_date', 50),
    g33cList(base44, 'ShopifyOrder', '-created_date', 100),
    g33cList(base44, 'FulfillmentTask', '-created_date', 100),
  ]);
  const candidates = [];
  const pushCandidate = (row, source) => {
    if (candidates.length >= limit) return;
    const candidateLookup = {
      ...lookup,
      subscriptionId: source === 'subscription' ? row?.id || '' : lookup.subscriptionId,
      customerAppSubscriptionId: row?.customer_app_subscription_id || (source === 'subscription' ? row?.id : '') || lookup.customerAppSubscriptionId,
      stripeSubscriptionId: row?.stripe_subscription_id || lookup.stripeSubscriptionId,
      orderNumber: normalizeOrderNumber(row?.order_number || row?.shopify_order_number || lookup.orderNumber),
      nativeOrderId: source === 'native_order' ? row?.id || '' : lookup.nativeOrderId,
      fulfillmentTaskId: source === 'task' ? row?.id || '' : lookup.fulfillmentTaskId,
      fulfillmentNumber: row?.fulfillment_number ?? lookup.fulfillmentNumber,
      deliveryDate: g36bDate(row?.delivery_date || row?.scheduled_date || row?.assigned_delivery_date) || lookup.deliveryDate,
    };
    const identity = g36bOccurrenceIdentityStatus({ lookup: candidateLookup, context: {} });
    candidates.push({
      source,
      order_number: candidateLookup.orderNumber || null,
      subscription_id: source === 'subscription' ? row?.id || null : candidateLookup.customerAppSubscriptionId || null,
      stripe_subscription_id_present: Boolean(candidateLookup.stripeSubscriptionId),
      delivery_date: candidateLookup.deliveryDate || null,
      fulfillment_number: candidateLookup.fulfillmentNumber ?? null,
      hub_occurrence_present: null,
      customer_app_parent_present: source === 'subscription' || Boolean(candidateLookup.customerAppSubscriptionId),
      native_order_present: source === 'native_order',
      native_task_present: source === 'task',
      classification: identity.ambiguous ? 'subscription_occurrence_identity_ambiguous' : 'no_action_hub_only_context',
      blockers: identity.ambiguous ? ['subscription_occurrence_identity_ambiguous'] : [],
      warnings: ['recent_scan_local_context_only', 'hub_source_of_truth'],
    });
  };
  for (const task of tasks.filter(g36bHasSubscriptionSignal)) pushCandidate(task, 'task');
  for (const order of nativeOrders.filter(g36bHasSubscriptionSignal)) pushCandidate(order, 'native_order');
  for (const subscription of subscriptions) pushCandidate(subscription, 'subscription');

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    preview_mode: G36B_PREVIEW_MODE,
    mode: 'RECENT_SUBSCRIPTION_OCCURRENCE_SCAN',
    request_id: lookup.requestId || null,
    scan_limit: limit,
    candidate_count: candidates.length,
    candidates,
    provider_call_impact: false,
    notification_impact: { notification_would_send: false, notification_held: true, notification_rows_created: false, message_logs_created: false },
    hub_source_of_truth: true,
    hub_fallback_required: true,
    blockers: [],
    warnings: ['recent_scan_local_context_only', 'no_customer_pii_returned', 'hub_reads_not_performed_for_broad_scan'],
    next_action: candidates.length ? 'provide_exact_subscription_occurrence_ids' : 'wait_for_subscription_occurrence_with_clean_identity',
    safety: G36B_READ_ONLY_SAFETY,
  };
}

async function buildG36BPreview(base44, body) {
  const lookup = g36bLookup(body);
  return lookup.mode === 'RECENT_SUBSCRIPTION_OCCURRENCE_SCAN'
    ? buildG36BRecentScan(base44, body)
    : buildG36BExactPreview(base44, body);
}

function g36cBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const text = normalizeLower(value);
  if (['true', '1', 'yes', 'y'].includes(text)) return true;
  if (['false', '0', 'no', 'n'].includes(text)) return false;
  return fallback;
}

function g36cLookup(body) {
  const maxCandidates = Math.max(1, Math.min(safeLimit(body?.max_candidates || body?.limit) || 5, 10));
  return {
    previewMode: G36C_HELPER_PREVIEW_MODE,
    customerLabel: sanitizeText(body?.customer_label, 120),
    subscriptionId: normalizeText(body?.subscription_id || body?.customer_app_subscription_id),
    hubSubscriptionId: normalizeText(body?.hub_subscription_id),
    hubSubscriptionIdInput: normalizeText(body?.hub_subscription_id),
    customerAppSubscriptionId: normalizeText(body?.customer_app_subscription_id || body?.subscription_id),
    parentOrderNumber: normalizeOrderNumber(body?.parent_order_number || body?.order_number || body?.shopify_order_number),
    hubOrderId: normalizeText(body?.hub_order_id),
    occurrenceId: normalizeText(body?.occurrence_id),
    hubFulfillmentTaskId: normalizeText(body?.hub_fulfillment_task_id),
    customerAppOrderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id || body?.order_id),
    dateFrom: g36bDate(body?.date_from),
    dateTo: g36bDate(body?.date_to),
    fulfilledOnly: g36cBool(body?.fulfilled_only, true),
    maxCandidates,
    operatorExpectedLineItemCount: g36bNumberOrNull(body?.operator_expected_line_item_count),
    operatorExpectedPaymentStatus: sanitizeText(body?.operator_expected_payment_status, 80),
    requestId: sanitizeText(body?.request_id, 120),
  };
}

function g36cHasExactParentIdentifier(lookup) {
  return Boolean(lookup.subscriptionId || lookup.hubSubscriptionId || lookup.customerAppSubscriptionId || lookup.parentOrderNumber || lookup.customerAppOrderId);
}

function g36cParentIdentityStatus(lookup, parentContext) {
  if (!g36cHasExactParentIdentifier(lookup) && lookup.customerLabel) return 'customer_label_only_not_sufficient';
  if (!g36cHasExactParentIdentifier(lookup)) return 'parent_identifier_insufficient';
  const parentCount = (parentContext?.subscriptions?.length || 0) + (parentContext?.orders?.length || 0);
  if (parentCount > 1 && !lookup.customerAppSubscriptionId && !lookup.subscriptionId && !lookup.customerAppOrderId && !lookup.parentOrderNumber) return 'ambiguous_parent_context';
  if (parentCount === 0 && !parentContext?.hubTasks?.length && !parentContext?.nativeOrders?.length && !parentContext?.nativeTasks?.length) return 'no_parent_context_found';
  return 'exact_parent_identifier_present';
}

function g36cDateInRange(date, lookup) {
  const value = g36bDate(date);
  if (!value) return true;
  if (lookup.dateFrom && value < lookup.dateFrom) return false;
  if (lookup.dateTo && value > lookup.dateTo) return false;
  return true;
}

function g36cIsFulfilled(row) {
  const text = [
    row?.status,
    row?.delivery_status,
    row?.fulfillment_status,
    row?.occurrence_status,
    row?.fulfillment?.status,
    row?.fulfillment?.delivery_status,
    row?.fulfillment?.fulfillment_status,
  ].map(normalizeLower).join(' ');
  return /delivered|fulfilled|complete|completed/.test(text);
}

function g36cLineItemCount(row) {
  if (Array.isArray(row?.items)) return row.items.length;
  if (Array.isArray(row?.line_items)) return row.line_items.length;
  if (Array.isArray(row?.fulfillment?.items)) return row.fulfillment.items.length;
  if (row?.item_count !== undefined && row.item_count !== null) return safeNumber(row.item_count, null);
  if (row?.line_item_count !== undefined && row.line_item_count !== null) return safeNumber(row.line_item_count, null);
  if (row?.items_summary) return 1;
  return null;
}

function g36cCancellationRefundRisk(row) {
  const text = [row?.status, row?.payment_status, row?.financial_status, row?.refund_status, row?.delivery_status, row?.fulfillment_status, row?.tags].map(value => Array.isArray(value) ? value.join(' ') : value).map(normalizeLower).join(' ');
  return /refund|cancel|canceled|cancelled|do_not_sync|excluded|quarantined/.test(text) || row?.cancel_at_period_end === true;
}

function g36cRepairReplayRisk(row) {
  const text = [row?.repair_status, row?.sync_status, row?.hub_sync_status, row?.status, row?.notes, row?.reason].map(normalizeLower).join(' ');
  return /repair|replay|retry/.test(text) && !/preview|dry_run|skipped|resolved|success|synced/.test(text);
}

function g36cOrderNumber(row) {
  return normalizeOrderNumber(row?.order_number || row?.shopify_order_number || row?.native_order_number || row?.hub_order_number);
}

function g36cDeliveryDate(row) {
  return g36bDate(row?.delivery_date || row?.scheduled_date || row?.assigned_delivery_date || row?.fulfillment_instance_date || row?.fulfillment?.delivery_date || row?.fulfillment?.scheduled_date);
}

function g36cOccurrenceId(row) {
  return normalizeText(row?.occurrence_id || row?.fulfillment_id || row?.fulfillment_task_id || row?.fulfillment?.id || row?.id);
}

function g36cParentMatches(row, lookup) {
  if (!row) return false;
  if (lookup.customerAppSubscriptionId && [row.id, row.customer_app_subscription_id, row.subscription_parent_id, row.subscription_id].some(value => normalizeText(value) === lookup.customerAppSubscriptionId)) return true;
  if (lookup.subscriptionId && [row.id, row.customer_app_subscription_id, row.subscription_parent_id, row.subscription_id].some(value => normalizeText(value) === lookup.subscriptionId)) return true;
  if (lookup.hubSubscriptionId && [row.hub_subscription_id, row.subscription_id, row.stripe_subscription_id].some(value => normalizeText(value) === lookup.hubSubscriptionId)) return true;
  if (lookup.customerAppOrderId && [row.id, row.order_id, row.base44_order_id, row.customer_app_order_id].some(value => normalizeText(value) === lookup.customerAppOrderId)) return true;
  if (lookup.hubOrderId && [row.order_id, row.hub_order_id, row.source_order_id].some(value => normalizeText(value) === lookup.hubOrderId)) return true;
  if (lookup.hubFulfillmentTaskId && [row.id, row.fulfillment_task_id, row.hub_fulfillment_task_id].some(value => normalizeText(value) === lookup.hubFulfillmentTaskId)) return true;
  if (lookup.occurrenceId && [row.occurrence_id, row.fulfillment_id, row.fulfillment?.id].some(value => normalizeText(value) === lookup.occurrenceId)) return true;
  if (lookup.parentOrderNumber) {
    const key = g33cOrderKey(lookup.parentOrderNumber);
    if ([row.order_number, row.shopify_order_number, row.native_order_number, row.hub_order_number].some(value => g33cOrderKey(value) === key)) return true;
  }
  return false;
}

async function g36cParentContext(base44, lookup) {
  const subscriptionRows = [];
  if (lookup.subscriptionId) subscriptionRows.push(...await g33cFilter(base44, 'Subscription', { id: lookup.subscriptionId }, '-created_date', 5, { retryEmpty: true }));
  if (lookup.customerAppSubscriptionId && lookup.customerAppSubscriptionId !== lookup.subscriptionId) subscriptionRows.push(...await g33cFilter(base44, 'Subscription', { id: lookup.customerAppSubscriptionId }, '-created_date', 5, { retryEmpty: true }));
  if (lookup.hubSubscriptionId) subscriptionRows.push(...await g33cFilter(base44, 'Subscription', { stripe_subscription_id: lookup.hubSubscriptionId }, '-created_date', 10, { retryEmpty: true }));

  const orderRows = [];
  if (lookup.customerAppOrderId) orderRows.push(...await g33cFilter(base44, 'Order', { id: lookup.customerAppOrderId }, '-created_date', 5, { retryEmpty: true }));
  if (lookup.parentOrderNumber) orderRows.push(...await g33cFilter(base44, 'Order', { order_number: lookup.parentOrderNumber }, '-created_date', 10, { retryEmpty: true }));

  const subscription = g33cUnique(subscriptionRows)[0] || null;
  const enrichedLookup = {
    ...lookup,
    subscriptionId: lookup.subscriptionId || subscription?.id || '',
    customerAppSubscriptionId: lookup.customerAppSubscriptionId || subscription?.id || '',
    hubSubscriptionId: lookup.hubSubscriptionId || subscription?.stripe_subscription_id || '',
    hubSubscriptionIdInput: lookup.hubSubscriptionIdInput || '',
  };

  const nativeRows = [];
  if (enrichedLookup.customerAppSubscriptionId) nativeRows.push(...await g33cFilter(base44, 'ShopifyOrder', { customer_app_subscription_id: enrichedLookup.customerAppSubscriptionId }, '-created_date', 50, { retryEmpty: true }));
  if (enrichedLookup.hubSubscriptionId) nativeRows.push(...await g33cFilter(base44, 'ShopifyOrder', { stripe_subscription_id: enrichedLookup.hubSubscriptionId }, '-created_date', 50, { retryEmpty: true }));
  if (enrichedLookup.customerAppOrderId || enrichedLookup.parentOrderNumber) nativeRows.push(...await g35bNativeOrders(base44, { orderNumber: enrichedLookup.parentOrderNumber, customerAppOrderId: enrichedLookup.customerAppOrderId }, orderRows[0] || null));

  const taskRows = [];
  if (enrichedLookup.customerAppSubscriptionId) taskRows.push(...await g33cFilter(base44, 'FulfillmentTask', { customer_app_subscription_id: enrichedLookup.customerAppSubscriptionId }, '-delivery_date', 50, { retryEmpty: true }));
  if (enrichedLookup.hubSubscriptionId) taskRows.push(...await g33cFilter(base44, 'FulfillmentTask', { stripe_subscription_id: enrichedLookup.hubSubscriptionId }, '-delivery_date', 50, { retryEmpty: true }));
  if (enrichedLookup.customerAppOrderId || enrichedLookup.parentOrderNumber) taskRows.push(...await g33cTasks(base44, enrichedLookup.parentOrderNumber, enrichedLookup.customerAppOrderId, '', ''));

  const hubTaskContext = await g36cHubOccurrenceTasks(enrichedLookup);
  return {
    lookup: enrichedLookup,
    subscriptions: g33cUnique(subscriptionRows),
    subscription,
    orders: g33cUnique(orderRows),
    nativeOrders: g33cUnique(nativeRows).filter(row => g36cParentMatches(row, enrichedLookup) || g36bHasSubscriptionSignal(row)),
    nativeTasks: g33cUnique(taskRows).filter(row => g36cParentMatches(row, enrichedLookup) || g36bHasSubscriptionSignal(row)),
    hubTasks: hubTaskContext.tasks || [],
    hubTaskContext,
  };
}

async function g36cHubOccurrenceTasks(lookup) {
  const hubApiUrl = normalizeText(Deno.env.get('HUB_API_URL'));
  const hubSecret = normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET'));
  const safeBase = {
    configured: Boolean(hubApiUrl && hubSecret),
    hub_read_attempted: false,
    hub_read_succeeded: false,
    hub_read_error: null,
    tasks: [],
    matched_by: null,
    provider_call_impact: false,
    hub_mutation_performed: false,
  };
  if (!safeBase.configured) return { ...safeBase, hub_read_error: 'hub_task_detail_service_not_configured' };
  const params = new URLSearchParams();
  if (lookup.parentOrderNumber) params.set('order_number', lookup.parentOrderNumber);
  if (lookup.customerAppOrderId) params.set('customer_app_order_id', lookup.customerAppOrderId);
  if (lookup.hubOrderId) params.set('hub_order_id', lookup.hubOrderId);
  if (lookup.occurrenceId) params.set('occurrence_id', lookup.occurrenceId);
  if (lookup.hubFulfillmentTaskId) params.set('hub_fulfillment_task_id', lookup.hubFulfillmentTaskId);
  if (lookup.hubSubscriptionId) {
    params.set('hub_subscription_id', lookup.hubSubscriptionId);
    params.set('stripe_subscription_id', lookup.hubSubscriptionId);
  }
  if (lookup.customerAppSubscriptionId) params.set('customer_app_subscription_id', lookup.customerAppSubscriptionId);
  if (lookup.subscriptionId) params.set('subscription_id', lookup.subscriptionId);
  if (!params.toString()) return { ...safeBase, hub_read_error: 'hub_task_detail_identifier_required' };
  params.set('limit', String(Math.min(lookup.maxCandidates || 5, 10)));
  try {
    const hubBase = hubApiUrl.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const url = `${hubBase}/functions/getFulfillmentTaskDetailsForCustomerApp?${params.toString()}`;
    const response = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${hubSecret}` } });
    if (!response.ok) return { ...safeBase, hub_read_attempted: true, hub_read_error: `hub_task_detail_status_${response.status}` };
    const data = await response.json().catch(() => null);
    if (!data || data.success !== true || !Array.isArray(data.tasks)) return { ...safeBase, hub_read_attempted: true, hub_read_error: 'hub_task_detail_malformed_response' };
    return {
      ...safeBase,
      hub_read_attempted: true,
      hub_read_succeeded: true,
      matched_by: sanitizeText(data.matched_by, 120),
      tasks: data.tasks.filter(task => g36cDateInRange(g36cDeliveryDate(task), lookup)),
    };
  } catch (error) {
    return { ...safeBase, hub_read_attempted: true, hub_read_error: sanitizeText(error?.message || 'hub_task_detail_read_failed', 160) };
  }
}

function g36cMissingFields(candidate) {
  const missing = [];
  if (!candidate.subscription_id && !candidate.hub_subscription_id) missing.push('subscription_id_or_hub_subscription_id');
  if (!candidate.occurrence_id && !(candidate.delivery_date && candidate.order_number)) missing.push('occurrence_id_or_delivery_date_plus_order_number');
  if (!candidate.order_number && !candidate.hub_order_id) missing.push('order_number_or_hub_order_id');
  if (!candidate.delivery_date) missing.push('delivery_date');
  if (!candidate.payment_status) missing.push('payment_status');
  if (!candidate.fulfillment_status) missing.push('fulfillment_status');
  if (candidate.line_item_count === null || candidate.line_item_count === undefined || Number(candidate.line_item_count) < 1) missing.push('line_item_count');
  if (candidate.cancellation_refund_risk?.known !== true) missing.push('cancellation_refund_issue_known');
  if (candidate.repair_replay_risk?.known !== true) missing.push('repair_replay_issue_known');
  return missing;
}

function g36cCandidateClassification(candidate, duplicateCount) {
  const missing = g36cMissingFields(candidate);
  const blockers = [];
  if (missing.includes('occurrence_id_or_delivery_date_plus_order_number')) blockers.push('missing_occurrence_id');
  if (missing.includes('delivery_date')) blockers.push('missing_delivery_date');
  if (missing.includes('order_number_or_hub_order_id')) blockers.push('missing_order_number');
  if (missing.includes('payment_status')) blockers.push('missing_payment_status');
  if (missing.includes('fulfillment_status')) blockers.push('missing_fulfillment_status');
  if (missing.includes('line_item_count')) blockers.push('missing_line_items');
  if (duplicateCount > 1) blockers.push('duplicate_occurrence_risk');
  if (candidate.cancellation_refund_risk?.detected) blockers.push('cancellation_refund_risk');
  if (candidate.repair_replay_risk?.detected) blockers.push('repair_replay_risk');
  if (missing.length) blockers.push('insufficient_for_g36d');
  const g36dReady = blockers.length === 0;
  const classification = g36dReady
    ? 'g36d_ready_exact_occurrence_candidate'
    : blockers.find(value => value !== 'insufficient_for_g36d') || 'hub_source_of_truth_hold';
  return { missing, blockers: [...new Set(blockers)], g36dReady, classification };
}

function g36cBuildCandidate({ row, source, lookup, parentContext, duplicateCount }) {
  const fulfillment = row?.fulfillment || null;
  const sourceRow = fulfillment ? { ...row, ...fulfillment } : row;
  const orderNumber = g36cOrderNumber(sourceRow) || lookup.parentOrderNumber || null;
  const deliveryDate = g36cDeliveryDate(sourceRow) || null;
  const paymentStatus = sanitizeText(sourceRow?.payment_status || sourceRow?.financial_status || parentContext.subscription?.payment_status, 80);
  const fulfillmentStatus = sanitizeText(sourceRow?.fulfillment_status || sourceRow?.delivery_status || sourceRow?.status || fulfillment?.status, 80);
  const lineItemCount = g36cLineItemCount(sourceRow);
  const cancellationDetected = g36cCancellationRefundRisk(sourceRow) || g36cCancellationRefundRisk(parentContext.subscription);
  const repairDetected = g36cRepairReplayRisk(sourceRow);
  const candidate = {
    candidate_id: sanitizeText(`${source}:${sourceRow?.id || sourceRow?.occurrence_id || sourceRow?.fulfillment_task_id || orderNumber || deliveryDate || 'candidate'}`, 160),
    source,
    subscription_id: parentContext.subscription?.id || lookup.subscriptionId || null,
    hub_subscription_id: lookup.hubSubscriptionIdInput || null,
    customer_app_subscription_id: lookup.customerAppSubscriptionId || parentContext.subscription?.id || sourceRow?.customer_app_subscription_id || null,
    occurrence_id: sanitizeText(sourceRow?.occurrence_id || sourceRow?.fulfillment_id || fulfillment?.id || null, 120) || null,
    order_number: orderNumber,
    hub_order_id: sanitizeText(sourceRow?.order_id || sourceRow?.hub_order_id || lookup.hubOrderId, 120) || null,
    hub_fulfillment_task_id: source === 'hub_fulfillment_task' ? sourceRow?.id || null : null,
    customer_app_order_id: lookup.customerAppOrderId || sourceRow?.base44_order_id || sourceRow?.customer_app_order_id || null,
    native_shopify_order_id: source === 'native_order_fulfillment' ? row?.id || null : sourceRow?.native_shopify_order_id || null,
    native_fulfillment_task_id: source === 'native_fulfillment_task' ? sourceRow?.id || null : null,
    delivery_date: deliveryDate,
    occurrence_status: sanitizeText(sourceRow?.status || sourceRow?.occurrence_status, 80),
    payment_status: paymentStatus,
    fulfillment_status: fulfillmentStatus,
    line_item_count: lineItemCount,
    customer_app_parent_present: Boolean(parentContext.subscription?.id || parentContext.orders?.length),
    hub_occurrence_present: source === 'hub_fulfillment_task',
    native_order_present: source === 'native_order_fulfillment',
    native_task_present: source === 'native_fulfillment_task',
    duplicate_risk: { duplicate_occurrence_risk: duplicateCount > 1, matching_candidate_count: duplicateCount },
    cancellation_refund_risk: { known: Boolean(paymentStatus || fulfillmentStatus), detected: cancellationDetected },
    repair_replay_risk: { known: true, detected: repairDetected },
    occurrence_identity_status: null,
    g36d_ready: false,
    blockers: [],
    warnings: ['hub_source_of_truth', 'read_only_discovery_only'],
    next_action: 'provide_exact_subscription_occurrence_ids',
  };
  const readiness = g36cCandidateClassification(candidate, duplicateCount);
  candidate.occurrence_identity_status = readiness.g36dReady ? 'exact_occurrence_identity_available' : 'occurrence_identity_incomplete';
  candidate.g36d_ready = readiness.g36dReady;
  candidate.classification = readiness.classification;
  candidate.missing_fields = readiness.missing;
  candidate.blockers = readiness.blockers;
  candidate.next_action = readiness.g36dReady ? 'run_g36d_exact_subscription_occurrence_preview' : 'complete_g36c_operator_packet';
  return candidate;
}

function g36cCandidateKey(candidate) {
  if (candidate.occurrence_id) return `occurrence:${candidate.occurrence_id}`;
  if (candidate.order_number && candidate.delivery_date) return `order_date:${candidate.order_number}:${candidate.delivery_date}`;
  if (candidate.hub_fulfillment_task_id) return `hub_task:${candidate.hub_fulfillment_task_id}`;
  if (candidate.native_fulfillment_task_id) return `native_task:${candidate.native_fulfillment_task_id}`;
  return candidate.candidate_id || 'unknown_candidate';
}

function g36cApprovalBlock(candidate) {
  if (!candidate) return null;
  return [
    'APPROVE G36D EXACT SUBSCRIPTION OCCURRENCE PREVIEW',
    '',
    `subscription_id=${candidate.subscription_id || ''}`,
    `hub_subscription_id=${candidate.hub_subscription_id || ''}`,
    `customer_app_subscription_id=${candidate.customer_app_subscription_id || ''}`,
    `occurrence_id=${candidate.occurrence_id || ''}`,
    `order_number=${candidate.order_number || ''}`,
    `hub_order_id=${candidate.hub_order_id || ''}`,
    `delivery_date=${candidate.delivery_date || ''}`,
    `hub_fulfillment_task_id=${candidate.hub_fulfillment_task_id || ''}`,
    `customer_app_order_id=${candidate.customer_app_order_id || ''}`,
    `native_shopify_order_id=${candidate.native_shopify_order_id || ''}`,
    `native_fulfillment_task_id=${candidate.native_fulfillment_task_id || ''}`,
    `payment_status=${candidate.payment_status || ''}`,
    `fulfillment_status=${candidate.fulfillment_status || ''}`,
    `line_item_count=${candidate.line_item_count ?? ''}`,
    `known cancellation/refund issue=${candidate.cancellation_refund_risk?.detected ? 'yes' : 'no'}`,
    `known repair/replay issue=${candidate.repair_replay_risk?.detected ? 'yes' : 'no'}`,
    'notes=',
  ].join('\n');
}

function g36cExactFieldsStillNeeded({ lookup, parentIdentityStatus, candidateRows }) {
  if (!g36cHasExactParentIdentifier(lookup) || ['parent_identifier_insufficient', 'customer_label_only_not_sufficient'].includes(parentIdentityStatus)) {
    return ['subscription_id_or_hub_subscription_id_or_parent_order_number', 'customer_app_subscription_id_if_available'];
  }
  const fromCandidates = [...new Set((candidateRows || []).flatMap(candidate => candidate.missing_fields || []))];
  if (fromCandidates.length) return fromCandidates;
  return [
    'occurrence_id_or_delivery_date_plus_order_number',
    'order_number_or_hub_order_id',
    'delivery_date',
    'payment_status',
    'fulfillment_status',
    'line_item_count',
    'cancellation_refund_issue_known',
    'repair_replay_issue_known',
  ];
}

function g36cHelperNextAction({ readyCandidates, candidateRows, blockers, parentIdentityStatus }) {
  if (readyCandidates.length === 1) return 'approve_g36d_exact_subscription_occurrence_preview';
  if (readyCandidates.length > 1) return 'owner_select_one_exact_occurrence_candidate';
  if (candidateRows.length > 1) return 'owner_select_one_exact_candidate_after_missing_fields_resolved';
  if (['parent_identifier_insufficient', 'customer_label_only_not_sufficient', 'ambiguous_parent_context', 'no_parent_context_found'].includes(parentIdentityStatus)) return 'provide_subscription_or_parent_order_identifier';
  if (blockers.includes('no_occurrence_candidates_found')) return 'hold_subscription_migration_until_exact_occurrence_identifiers_available';
  return 'complete_g36c_operator_packet';
}

async function buildG36CHelperPreview(base44, body) {
  const lookup = g36cLookup(body);
  const blockers = [];
  const warnings = ['hub_source_of_truth', 'read_only_discovery_only', 'customer_pii_not_returned', 'provider_calls_disabled', 'notifications_held'];
  if (lookup.customerLabel) warnings.push('customer_label_ignored_for_matching');

  if (!g36cHasExactParentIdentifier(lookup)) {
    blockers.push('exact_parent_identifier_required');
    if (lookup.customerLabel) blockers.push('insufficient_exact_parent_identifier');
    return {
      success: true,
      dry_run: true,
      writes_performed: false,
      generated_at: new Date().toISOString(),
      function_name: 'previewNativeOrderCutoverReadiness',
      preview_mode: G36C_HELPER_PREVIEW_MODE,
      request_id: lookup.requestId || null,
      hub_source_of_truth: true,
      input_quality: lookup.customerLabel ? 'customer_label_only_not_sufficient' : 'parent_identifier_insufficient',
      parent_identity_status: lookup.customerLabel ? 'customer_label_only_not_sufficient' : 'parent_identifier_insufficient',
      customer_label_supplied: Boolean(lookup.customerLabel),
      candidate_count: 0,
      candidate_rows: [],
      exact_fields_still_needed: g36cExactFieldsStillNeeded({ lookup, parentIdentityStatus: lookup.customerLabel ? 'customer_label_only_not_sufficient' : 'parent_identifier_insufficient', candidateRows: [] }),
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      next_action: 'provide_subscription_or_parent_order_identifier',
      owner_ready_g36d_approval_block: null,
      provider_call_impact: false,
      notification_impact: { notification_would_send: false, notification_held: true, notification_rows_created: false, message_logs_created: false },
      safety: G36B_READ_ONLY_SAFETY,
    };
  }

  const parentContext = await g36cParentContext(base44, lookup);
  const parentIdentityStatus = g36cParentIdentityStatus(parentContext.lookup, parentContext);
  if (['parent_identifier_insufficient', 'customer_label_only_not_sufficient', 'ambiguous_parent_context', 'no_parent_context_found'].includes(parentIdentityStatus)) {
    blockers.push(parentIdentityStatus === 'no_parent_context_found' ? 'no_parent_context_found' : 'exact_parent_identifier_required');
  }
  if (!parentContext.hubTaskContext.configured) warnings.push('hub_read_not_configured_local_preview_only');
  if (parentContext.hubTaskContext.hub_read_attempted && !parentContext.hubTaskContext.hub_read_succeeded) warnings.push('hub_read_failed_or_unavailable');

  const rawCandidateRows = [];
  for (const task of parentContext.hubTasks || []) rawCandidateRows.push({ source: 'hub_fulfillment_task', row: task });
  for (const task of parentContext.nativeTasks || []) rawCandidateRows.push({ source: 'native_fulfillment_task', row: task });
  for (const order of parentContext.nativeOrders || []) {
    const fulfillments = Array.isArray(order?.fulfillments) ? order.fulfillments : [];
    for (const fulfillment of fulfillments) rawCandidateRows.push({ source: 'native_order_fulfillment', row: { ...order, fulfillment } });
  }

  const filteredRows = rawCandidateRows.filter(({ row }) => {
    if (!g36cDateInRange(g36cDeliveryDate(row), parentContext.lookup)) return false;
    if (parentContext.lookup.fulfilledOnly && !g36cIsFulfilled(row)) return false;
    return true;
  });
  const duplicateCounts = new Map();
  for (const item of filteredRows) {
    const rough = {
      candidate_id: '',
      occurrence_id: sanitizeText(item.row?.occurrence_id || item.row?.fulfillment_id || item.row?.fulfillment?.id || null, 120) || null,
      order_number: g36cOrderNumber(item.row) || parentContext.lookup.parentOrderNumber || null,
      delivery_date: g36cDeliveryDate(item.row) || null,
      hub_fulfillment_task_id: item.source === 'hub_fulfillment_task' ? item.row?.id || null : null,
      native_fulfillment_task_id: item.source === 'native_fulfillment_task' ? item.row?.id || null : null,
    };
    const key = g36cCandidateKey(rough);
    duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
  }
  const candidateRows = [];
  const seen = new Set();
  for (const item of filteredRows) {
    if (candidateRows.length >= parentContext.lookup.maxCandidates) break;
    const candidate = g36cBuildCandidate({ row: item.row, source: item.source, lookup: parentContext.lookup, parentContext, duplicateCount: duplicateCounts.get(g36cCandidateKey({
      candidate_id: '',
      occurrence_id: sanitizeText(item.row?.occurrence_id || item.row?.fulfillment_id || item.row?.fulfillment?.id || null, 120) || null,
      order_number: g36cOrderNumber(item.row) || parentContext.lookup.parentOrderNumber || null,
      delivery_date: g36cDeliveryDate(item.row) || null,
      hub_fulfillment_task_id: item.source === 'hub_fulfillment_task' ? item.row?.id || null : null,
      native_fulfillment_task_id: item.source === 'native_fulfillment_task' ? item.row?.id || null : null,
    })) || 1 });
    const key = g36cCandidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    candidateRows.push(candidate);
  }

  if (candidateRows.length === 0 && blockers.length === 0) blockers.push('no_occurrence_candidates_found');
  const readyCandidates = candidateRows.filter(candidate => candidate.g36d_ready);
  const exactFieldsStillNeeded = g36cExactFieldsStillNeeded({ lookup: parentContext.lookup, parentIdentityStatus, candidateRows });
  const nextAction = g36cHelperNextAction({ readyCandidates, candidateRows, blockers, parentIdentityStatus });
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    preview_mode: G36C_HELPER_PREVIEW_MODE,
    request_id: parentContext.lookup.requestId || null,
    hub_source_of_truth: true,
    input_quality: parentIdentityStatus === 'exact_parent_identifier_present' ? 'exact_parent_identifier_present' : parentIdentityStatus,
    parent_identity_status: parentIdentityStatus,
    identifiers: {
      subscription_id: parentContext.subscription?.id || parentContext.lookup.subscriptionId || null,
      hub_subscription_id_present: Boolean(parentContext.lookup.hubSubscriptionIdInput || parentContext.lookup.hubSubscriptionId),
      customer_app_subscription_id: parentContext.lookup.customerAppSubscriptionId || parentContext.subscription?.id || null,
      parent_order_number: parentContext.lookup.parentOrderNumber || null,
      customer_app_order_id: parentContext.lookup.customerAppOrderId || null,
      date_from: parentContext.lookup.dateFrom || null,
      date_to: parentContext.lookup.dateTo || null,
      fulfilled_only: parentContext.lookup.fulfilledOnly,
    },
    parent_context: {
      customer_app_subscription_present: Boolean(parentContext.subscription?.id),
      customer_app_order_count: parentContext.orders.length,
      native_order_count: parentContext.nativeOrders.length,
      native_task_count: parentContext.nativeTasks.length,
      hub_task_count: parentContext.hubTasks.length,
      hub_read_status: {
        configured: parentContext.hubTaskContext.configured,
        attempted: parentContext.hubTaskContext.hub_read_attempted,
        succeeded: parentContext.hubTaskContext.hub_read_succeeded,
        error: parentContext.hubTaskContext.hub_read_error,
        matched_by: parentContext.hubTaskContext.matched_by,
        hub_mutation_performed: false,
      },
    },
    candidate_count: candidateRows.length,
    g36d_ready_candidate_count: readyCandidates.length,
    candidate_rows: candidateRows,
    exact_fields_still_needed: exactFieldsStillNeeded,
    owner_ready_g36d_approval_block: readyCandidates.length === 1 ? g36cApprovalBlock(readyCandidates[0]) : null,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    next_action: nextAction,
    provider_call_impact: false,
    notification_impact: { notification_would_send: false, notification_held: true, notification_rows_created: false, message_logs_created: false },
    safety: G36B_READ_ONLY_SAFETY,
  };
}

function g36cResolveSafeTimestamp(value) {
  const text = sanitizeText(value, 80);
  return text || null;
}

function g36cResolveStatus(value) {
  const text = sanitizeText(value, 80);
  return text || null;
}

function g36cResolvePaymentStatus(row) {
  return g36cResolveStatus(row?.payment_status || row?.financial_status || row?.payment?.status || row?.billing_status);
}

function g36cResolveTaskKey(row, lookup) {
  const occurrenceId = g36cOccurrenceId(row);
  if (occurrenceId) return `occurrence:${occurrenceId}`;
  const taskId = normalizeText(row?.id || row?.fulfillment_task_id || row?.hub_fulfillment_task_id);
  if (taskId) return `task:${taskId}`;
  const orderNumber = g36cOrderNumber(row) || lookup.parentOrderNumber || '';
  const deliveryDate = g36cDeliveryDate(row) || '';
  return `order_date:${orderNumber}:${deliveryDate}`;
}

function g36cResolveExplicitOccurrenceId(row) {
  return normalizeText(row?.occurrence_id || row?.fulfillment_id || row?.fulfillment?.id);
}

function g36cResolveOccurrenceGroupKey(row, lookup) {
  const occurrenceId = g36cResolveExplicitOccurrenceId(row);
  if (occurrenceId) return `occurrence:${occurrenceId}`;
  const orderNumber = g36cOrderNumber(row) || lookup.parentOrderNumber || '';
  const deliveryDate = g36cDeliveryDate(row) || '';
  return `order_date:${orderNumber}:${deliveryDate}`;
}

function g36cResolveLineItemSource(row, source) {
  const itemsCount = Array.isArray(row?.items) ? row.items.length : null;
  const lineItemsCount = Array.isArray(row?.line_items) ? row.line_items.length : null;
  const fulfillmentItemsCount = Array.isArray(row?.fulfillment?.items) ? row.fulfillment.items.length : null;
  const explicitCount = row?.line_item_count ?? row?.item_count ?? null;
  const summaryPresent = Boolean(row?.items_summary);
  const count = g36cLineItemCount(row);
  let authority = 'missing_line_item_detail';
  if (itemsCount !== null || lineItemsCount !== null || fulfillmentItemsCount !== null) authority = 'explicit_item_array';
  else if (explicitCount !== null && explicitCount !== undefined) authority = 'explicit_item_count';
  else if (summaryPresent) authority = 'summary_only_counted_as_one';
  return {
    source,
    count,
    authority,
    items_array_count: itemsCount,
    line_items_array_count: lineItemsCount,
    fulfillment_items_array_count: fulfillmentItemsCount,
    explicit_count: explicitCount !== null && explicitCount !== undefined ? safeNumber(explicitCount, null) : null,
    summary_present: summaryPresent,
  };
}

function g36cResolveLineItemAnalysis({ taskRows, parentContext, lookup }) {
  const sources = [];
  for (const row of taskRows) sources.push(g36cResolveLineItemSource(row, 'hub_fulfillment_task'));
  for (const row of parentContext.orders || []) sources.push(g36cResolveLineItemSource(row, 'customer_app_parent_order'));
  if (parentContext.subscription) sources.push(g36cResolveLineItemSource(parentContext.subscription, 'customer_app_subscription'));
  for (const row of parentContext.nativeOrders || []) sources.push(g36cResolveLineItemSource(row, 'native_shopify_order'));
  for (const row of parentContext.nativeTasks || []) sources.push(g36cResolveLineItemSource(row, 'native_fulfillment_task'));

  const counts = [...new Set(sources.map(source => source.count).filter(count => count !== null && count !== undefined))];
  const taskCounts = [...new Set(sources.filter(source => source.source === 'hub_fulfillment_task').map(source => source.count).filter(count => count !== null && count !== undefined))];
  const operatorCount = lookup.operatorExpectedLineItemCount;
  const classifications = [];
  const blockers = [];
  const warnings = [];

  if (operatorCount !== null && operatorCount !== undefined) {
    sources.push({ source: 'operator_expected_packet', count: operatorCount, authority: 'operator_supplied_not_authoritative' });
  }

  const effectiveCounts = [...new Set(sources.map(source => source.count).filter(count => count !== null && count !== undefined))];
  if (!effectiveCounts.length) {
    classifications.push('missing_line_item_detail');
    blockers.push('missing_line_item_detail');
  } else if (effectiveCounts.length === 1 && (!operatorCount || effectiveCounts[0] === operatorCount)) {
    classifications.push(`line_item_count_authoritative_${effectiveCounts[0]}`);
  } else {
    classifications.push('line_item_count_ambiguous');
    blockers.push('line_item_count_ambiguous');
  }

  if (operatorCount !== null && operatorCount !== undefined && taskCounts.length && !taskCounts.includes(operatorCount)) {
    classifications.push('bundle_or_decomposition_possible_not_authoritative');
    warnings.push('operator_packet_line_item_count_differs_from_hub_task_count');
    blockers.push('line_item_discrepancy_requires_owner_resolution');
  }

  if (counts.length > 1) {
    classifications.push('task_vs_order_line_item_mismatch');
    blockers.push('task_vs_order_line_item_mismatch');
  }

  return {
    operator_expected_line_item_count: operatorCount ?? null,
    safe_line_item_sources: sources,
    classifications: [...new Set(classifications)],
    authoritative_count: blockers.length ? null : effectiveCounts[0] ?? null,
    blocks_g36d: blockers.length > 0,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
  };
}

function g36cResolvePaymentAuthority({ taskRows, parentContext, lookup }) {
  const sources = [];
  for (const row of taskRows) sources.push({ source: 'hub_fulfillment_task', status: g36cResolvePaymentStatus(row), authority: 'occurrence_task_field' });
  for (const row of parentContext.orders || []) sources.push({ source: 'customer_app_parent_order', status: g36cResolvePaymentStatus(row), authority: 'parent_order_mirror' });
  if (parentContext.subscription) sources.push({ source: 'customer_app_subscription', status: g36cResolvePaymentStatus(parentContext.subscription), authority: 'parent_subscription_mirror' });
  for (const row of parentContext.nativeOrders || []) sources.push({ source: 'native_shopify_order', status: g36cResolvePaymentStatus(row), authority: 'native_order_mirror' });
  for (const row of parentContext.nativeTasks || []) sources.push({ source: 'native_fulfillment_task', status: g36cResolvePaymentStatus(row), authority: 'native_task_mirror' });
  if (lookup.operatorExpectedPaymentStatus) sources.push({ source: 'operator_expected_packet', status: lookup.operatorExpectedPaymentStatus, authority: 'operator_supplied_not_authoritative' });

  const normalizedStatuses = [...new Set(sources.map(source => normalizeLower(source.status)).filter(Boolean))];
  const hubTaskStatuses = sources.filter(source => source.source === 'hub_fulfillment_task').map(source => normalizeLower(source.status)).filter(Boolean);
  const localMirrorStatuses = sources.filter(source => source.source !== 'operator_expected_packet' && source.source !== 'hub_fulfillment_task').map(source => normalizeLower(source.status)).filter(Boolean);
  const classifications = [];
  const blockers = [];
  let authoritative_status = null;
  let authority = 'not_available_from_safe_reads';

  if (hubTaskStatuses.length && new Set(hubTaskStatuses).size === 1) {
    authoritative_status = hubTaskStatuses[0];
    authority = hubTaskStatuses[0] === 'paid' ? 'paid_authoritative' : (/(fail|unpaid|cancel)/.test(hubTaskStatuses[0]) ? 'unpaid_or_failed' : 'payment_status_authoritative');
  } else if (hubTaskStatuses.length > 1) {
    authority = 'payment_status_ambiguous';
    blockers.push('payment_status_ambiguous');
  } else if (normalizedStatuses.length === 0) {
    authority = 'not_available_from_safe_reads';
    blockers.push('missing_payment_status');
  } else if (normalizedStatuses.length > 1) {
    authority = 'payment_status_ambiguous';
    blockers.push('payment_status_ambiguous');
  } else if (localMirrorStatuses.length) {
    authoritative_status = normalizedStatuses[0];
    authority = normalizedStatuses[0] === 'paid' ? 'paid_inferred_not_authoritative' : (/(fail|unpaid|cancel)/.test(normalizedStatuses[0]) ? 'unpaid_or_failed' : 'payment_status_inferred_not_authoritative');
    blockers.push('payment_status_not_authoritative');
  } else {
    authority = 'not_available_from_safe_reads';
    blockers.push('missing_payment_status');
  }

  if (lookup.operatorExpectedPaymentStatus && authoritative_status && normalizeLower(lookup.operatorExpectedPaymentStatus) !== authoritative_status) {
    blockers.push('operator_payment_status_disagrees_with_safe_reads');
  }
  if (lookup.operatorExpectedPaymentStatus && normalizedStatuses.length > 1) classifications.push('operator_payment_status_conflicts_with_mirror');
  classifications.push(authority);

  return {
    status: authoritative_status,
    authority,
    safe_payment_sources: sources.map(source => ({ ...source, status: source.status || null })),
    classifications: [...new Set(classifications)],
    blocks_g36d: blockers.length > 0 || authority !== 'paid_authoritative',
    blockers: [...new Set(blockers.length ? blockers : (authority === 'paid_authoritative' ? [] : ['payment_status_not_authoritative']))],
    warnings: authority === 'paid_inferred_not_authoritative' ? ['payment_status_inferred_from_mirror_not_occurrence'] : [],
  };
}

function g36cResolveCandidateClassification(row, groupCount) {
  const repairRisk = g36cRepairReplayRisk(row);
  const cancellationRisk = g36cCancellationRefundRisk(row);
  if (repairRisk) return 'historical_repair_artifact';
  if (groupCount > 1) return 'duplicate_hub_task_same_occurrence';
  if (!g36cDeliveryDate(row) || !g36cOrderNumber(row)) return 'insufficient_identity';
  if (cancellationRisk) return 'cancellation_refund_risk';
  return 'exact_subscription_occurrence_candidate';
}

function g36cResolveSafeTaskSummary({ row, lookup, parentContext, groupCount }) {
  const lineItem = g36cResolveLineItemSource(row, 'hub_fulfillment_task');
  const paymentStatus = g36cResolvePaymentStatus(row);
  return {
    hub_fulfillment_task_id: sanitizeText(row?.id || row?.fulfillment_task_id || row?.hub_fulfillment_task_id, 120) || null,
    hub_order_id: sanitizeText(row?.order_id || row?.hub_order_id || lookup.hubOrderId, 120) || null,
    hub_subscription_id: lookup.hubSubscriptionIdInput || null,
    parent_order_number: lookup.parentOrderNumber || g36cOrderNumber(row) || null,
    occurrence_id: sanitizeText(row?.occurrence_id || row?.fulfillment_id, 120) || null,
    occurrence_order_number: g36cOrderNumber(row) || null,
    delivery_date: g36cDeliveryDate(row) || null,
    fulfillment_status: g36cResolveStatus(row?.fulfillment_status || row?.delivery_status || row?.status),
    task_status: g36cResolveStatus(row?.status),
    production_status: g36cResolveStatus(row?.production_status),
    payment_status_present: Boolean(paymentStatus),
    payment_status: paymentStatus,
    line_item_count: lineItem.count,
    line_item_count_source: lineItem.authority,
    line_item_summary_present: Boolean(row?.items_summary || row?.item_summary),
    source_channel: sanitizeText(row?.source_channel || row?.source_type || row?.fulfillment_type, 120) || null,
    created_at: g36cResolveSafeTimestamp(row?.created_at || row?.created_date),
    updated_at: g36cResolveSafeTimestamp(row?.updated_at || row?.updated_date),
    route_context_present: Boolean(row?.route_id || row?.driver_id || row?.delivery_route_id || row?.assigned_driver_id),
    proof_or_drop_context_present: Boolean(row?.proof_photo_url || row?.proof || row?.dropoff_proof || row?.delivery_proof_id),
    sync_repair_replay_risk: { known: true, detected: g36cRepairReplayRisk(row) },
    cancellation_refund_risk: { known: true, detected: g36cCancellationRefundRisk(row) || g36cCancellationRefundRisk(parentContext.subscription) },
    duplicate_group_key: g36cResolveOccurrenceGroupKey(row, lookup),
    duplicate_group_count: groupCount,
    classification: g36cResolveCandidateClassification(row, groupCount),
    warnings: ['hub_source_of_truth', 'safe_summary_only'],
  };
}

async function buildG36CResolvePreview(base44, body) {
  const lookup = g36cLookup(body);
  const blockers = [];
  const warnings = ['hub_source_of_truth', 'read_only_ambiguity_resolution_only', 'customer_pii_not_returned', 'provider_calls_disabled', 'notifications_held', 'raw_hub_payloads_not_returned'];
  if (lookup.customerLabel) warnings.push('customer_label_ignored_for_matching');
  if (!g36cHasExactParentIdentifier(lookup)) {
    blockers.push('exact_parent_identifier_required');
    return {
      success: true,
      dry_run: true,
      writes_performed: false,
      generated_at: new Date().toISOString(),
      function_name: 'previewNativeOrderCutoverReadiness',
      preview_mode: G36C_RESOLVE_PREVIEW_MODE,
      request_id: lookup.requestId || null,
      hub_source_of_truth: true,
      matching_task_count: 0,
      candidate_rows: [],
      selected_candidate: null,
      payment_status_authority: { authority: 'not_available_from_safe_reads', blocks_g36d: true, blockers: ['exact_parent_identifier_required'] },
      line_item_discrepancy_analysis: { blocks_g36d: true, blockers: ['exact_parent_identifier_required'] },
      duplicate_occurrence_risk: { detected: false, matching_task_count: 0 },
      g36d_ready: false,
      g36d_approval_block: null,
      blockers: [...new Set(blockers)],
      warnings: [...new Set(warnings)],
      next_action: 'provide_subscription_or_parent_order_identifier',
      provider_call_impact: false,
      notification_impact: { notification_would_send: false, notification_held: true, notification_rows_created: false, message_logs_created: false },
      safety: G36B_READ_ONLY_SAFETY,
    };
  }

  const parentContext = await g36cParentContext(base44, lookup);
  const taskRows = (parentContext.hubTasks || []).filter(row => {
    if (parentContext.lookup.hubFulfillmentTaskId && normalizeText(row?.id || row?.fulfillment_task_id || row?.hub_fulfillment_task_id) !== parentContext.lookup.hubFulfillmentTaskId) return false;
    if (parentContext.lookup.occurrenceId && normalizeText(row?.occurrence_id || row?.fulfillment_id) !== parentContext.lookup.occurrenceId) return false;
    if (parentContext.lookup.hubOrderId && normalizeText(row?.order_id || row?.hub_order_id) !== parentContext.lookup.hubOrderId) return false;
    return true;
  });

  const groupCounts = new Map();
  for (const row of taskRows) {
    const key = g36cResolveOccurrenceGroupKey(row, parentContext.lookup);
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
  }
  const candidateRows = taskRows.map(row => g36cResolveSafeTaskSummary({
    row,
    lookup: parentContext.lookup,
    parentContext,
    groupCount: groupCounts.get(g36cResolveOccurrenceGroupKey(row, parentContext.lookup)) || 1,
  }));

  const paymentAuthority = g36cResolvePaymentAuthority({ taskRows, parentContext, lookup: parentContext.lookup });
  const lineItemAnalysis = g36cResolveLineItemAnalysis({ taskRows, parentContext, lookup: parentContext.lookup });
  const duplicateDetected = candidateRows.some(candidate => candidate.duplicate_group_count > 1) || candidateRows.length > 1;
  if (!candidateRows.length) blockers.push('no_matching_hub_task_context_found');
  if (duplicateDetected) blockers.push('duplicate_occurrence_risk');
  if (paymentAuthority.blocks_g36d) blockers.push(...paymentAuthority.blockers);
  if (lineItemAnalysis.blocks_g36d) blockers.push(...lineItemAnalysis.blockers);
  if (candidateRows.some(candidate => candidate.sync_repair_replay_risk?.detected)) blockers.push('repair_replay_risk');
  if (candidateRows.some(candidate => candidate.cancellation_refund_risk?.detected)) blockers.push('cancellation_refund_risk');
  if (parentContext.orders.some(order => g36cCancellationRefundRisk(order))) warnings.push('customer_app_parent_order_has_cancel_or_refund_marker');
  if (!parentContext.hubTaskContext.configured) warnings.push('hub_read_not_configured_local_preview_only');
  if (parentContext.hubTaskContext.hub_read_attempted && !parentContext.hubTaskContext.hub_read_succeeded) warnings.push('hub_read_failed_or_unavailable');

  const selectedCandidate = candidateRows.length === 1 && !duplicateDetected && blockers.length === 0 ? candidateRows[0] : null;
  const g36dReady = Boolean(selectedCandidate && paymentAuthority.authority === 'paid_authoritative' && !lineItemAnalysis.blocks_g36d);
  const approvalCandidate = selectedCandidate && g36dReady ? {
    subscription_id: parentContext.subscription?.id || parentContext.lookup.subscriptionId || null,
    hub_subscription_id: parentContext.lookup.hubSubscriptionIdInput || null,
    customer_app_subscription_id: parentContext.lookup.customerAppSubscriptionId || parentContext.subscription?.id || null,
    occurrence_id: selectedCandidate.occurrence_id,
    order_number: selectedCandidate.occurrence_order_number || selectedCandidate.parent_order_number,
    hub_order_id: selectedCandidate.hub_order_id,
    hub_fulfillment_task_id: selectedCandidate.hub_fulfillment_task_id,
    customer_app_order_id: parentContext.lookup.customerAppOrderId || null,
    native_shopify_order_id: null,
    native_fulfillment_task_id: null,
    delivery_date: selectedCandidate.delivery_date,
    payment_status: paymentAuthority.status,
    fulfillment_status: selectedCandidate.fulfillment_status,
    line_item_count: lineItemAnalysis.authoritative_count,
    cancellation_refund_risk: selectedCandidate.cancellation_refund_risk,
    repair_replay_risk: selectedCandidate.sync_repair_replay_risk,
  } : null;

  const nextAction = g36dReady
    ? 'approve_g36d_exact_subscription_occurrence_preview'
    : (duplicateDetected ? 'resolve_duplicate_hub_task_context_before_g36d' : 'complete_payment_and_line_item_authority_before_g36d');

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    preview_mode: G36C_RESOLVE_PREVIEW_MODE,
    request_id: parentContext.lookup.requestId || null,
    hub_source_of_truth: true,
    identifiers: {
      hub_subscription_id_present: Boolean(parentContext.lookup.hubSubscriptionIdInput || parentContext.lookup.hubSubscriptionId),
      parent_order_number: parentContext.lookup.parentOrderNumber || null,
      hub_order_id_present: Boolean(parentContext.lookup.hubOrderId),
      occurrence_id_present: Boolean(parentContext.lookup.occurrenceId),
      hub_fulfillment_task_id_present: Boolean(parentContext.lookup.hubFulfillmentTaskId),
      delivery_date: parentContext.lookup.dateFrom && parentContext.lookup.dateFrom === parentContext.lookup.dateTo ? parentContext.lookup.dateFrom : null,
    },
    parent_context: {
      customer_app_subscription_present: Boolean(parentContext.subscription?.id),
      customer_app_order_count: parentContext.orders.length,
      native_order_count: parentContext.nativeOrders.length,
      native_task_count: parentContext.nativeTasks.length,
      hub_task_count: parentContext.hubTasks.length,
      hub_read_status: {
        configured: parentContext.hubTaskContext.configured,
        attempted: parentContext.hubTaskContext.hub_read_attempted,
        succeeded: parentContext.hubTaskContext.hub_read_succeeded,
        error: parentContext.hubTaskContext.hub_read_error,
        matched_by: parentContext.hubTaskContext.matched_by,
        hub_mutation_performed: false,
      },
    },
    matching_task_count: candidateRows.length,
    candidate_rows: candidateRows,
    selected_candidate: selectedCandidate,
    payment_status_authority: paymentAuthority,
    line_item_discrepancy_analysis: lineItemAnalysis,
    duplicate_occurrence_risk: {
      detected: duplicateDetected,
      matching_task_count: candidateRows.length,
      duplicate_group_keys: [...new Set(candidateRows.filter(candidate => candidate.duplicate_group_count > 1).map(candidate => candidate.duplicate_group_key))],
    },
    g36d_ready: g36dReady,
    g36d_approval_block: approvalCandidate ? g36cApprovalBlock(approvalCandidate) : null,
    blockers: [...new Set(g36dReady ? [] : [...blockers, 'insufficient_for_g36d'])],
    warnings: [...new Set([...warnings, ...paymentAuthority.warnings, ...lineItemAnalysis.warnings])],
    next_action: nextAction,
    provider_call_impact: false,
    notification_impact: { notification_would_send: false, notification_held: true, notification_rows_created: false, message_logs_created: false },
    safety: G36B_READ_ONLY_SAFETY,
  };
}

async function buildG35BPreview(base44, body) {
  const lookup = g35bLookup(body);
  const requestBlockers = [];
  const warnings = [];
  if (!lookup.refundType) requestBlockers.push('refund_type_required_full_partial_or_unknown');
  if (!lookup.orderNumber && !lookup.customerAppOrderId && !lookup.nativeOrderId && !lookup.taskId && !lookup.stripeEventId) requestBlockers.push('order_or_stripe_event_identifier_required');

  const resolvedContext = await g35hResolveRefundReadContextStable(base44, lookup);
  const { customerOrder, nativeOrder, task, orderNumber, customerOrderId, batches, complianceLogs, orderFound, readConsistency } = resolvedContext;
  const readConsistencyBlockers = g35hReadConsistencyBlockers(readConsistency);
  const [orderSyncRows, reviewRows, commandRows, parityRows] = await Promise.all([
    g35bLogs(base44, 'OrderSyncLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'OrderReviewQueue', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'CommandLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'SafeSyncParityLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
  ]);
  const subscriptionOrMulti = g33cSubscriptionOrMulti(nativeOrder, task);
  const lifecycleState = g35bLifecycleState({ customerOrder, nativeOrder, task, batches, complianceLogs });
  const lifecycleRiskLevel = g35bRiskLevel(lifecycleState);
  const statusSchemaCompatibility = g35bSchemaCompatibility(lookup.refundType || 'unknown');
  const idempotencyStatus = g35bIdempotencyStatus({ stripeEventId: lookup.stripeEventId, orderSyncRows, commandRows });
  const productionBatchImpact = g35bProductionBatchImpact({ batches, complianceLogs, refundType: lookup.refundType || 'unknown', lifecycleState, orderNumber, customerOrderId, nativeOrderId: nativeOrder?.id, taskId: task?.id });
  const alreadyRefundedOrTerminal = g35kAlreadyRefundedOrTerminal(customerOrder, nativeOrder);
  const liveBlockers = [];
  if (subscriptionOrMulti) liveBlockers.push('subscription_or_multi_delivery_refund_not_supported_by_one_time_preview');
  if (alreadyRefundedOrTerminal) liveBlockers.push('already_refunded_or_terminal_review_required');
  if (['production_started', 'production_completed', 'production_verified', 'delivered', 'historical_fulfilled'].includes(lifecycleState)) liveBlockers.push(`${lifecycleState}_manual_review_required`);
  if (idempotencyStatus.duplicate_event_detected) liveBlockers.push('duplicate_refund_event_detected');
  if (!readConsistency.stable) warnings.push('read_consistency_unstable');
  if (readConsistency.stable && !orderFound) warnings.push('unknown_order_review_required');
  if (lookup.refundType === 'partial') warnings.push('partial_refund_review_only_no_automatic_mutation');
  if (lookup.refundType === 'full' && statusSchemaCompatibility.schema_gap_blockers.length) warnings.push('refund_state_uses_payment_refund_fields', 'customer_order_status_lifecycle_facing');
  if (alreadyRefundedOrTerminal) warnings.push('already_refunded_or_terminal_review_required');
  if (productionBatchImpact.verified_logged_batch_count > 0) warnings.push('verified_production_history_preserved');
  if (productionBatchImpact.locked_compliance_log_count > 0) warnings.push('locked_compliance_logs_preserved');
  if (lifecycleState === 'delivered') warnings.push('delivered_refund_manual_review_required');
  warnings.push('notifications_held', 'provider_calls_disabled', 'inventory_reversal_not_proposed', 'purchase_order_reversal_not_proposed', 'hub_fallback_required');

  const blockers = [...requestBlockers, ...readConsistencyBlockers];
  const previewDataStable = readConsistency.stable;
  const nextAction = requestBlockers.length
    ? 'fix_preview_request_and_rerun'
    : readConsistencyBlockers.length
      ? (readConsistency.expected_identifiers_supplied ? 'retry_preview_after_read_consistency_stabilizes' : 'provide_exact_ids_for_preview')
      : g35bNextAction({
      refundType: lookup.refundType,
      orderFound,
      duplicateEventDetected: idempotencyStatus.duplicate_event_detected,
      subscriptionOrMulti,
      lifecycleState,
      alreadyRefundedOrTerminal,
    });

  const fullRefundPreviewReady = g35kFullRefundPreviewReady({
    refundType: lookup.refundType,
    orderFound,
    duplicateEventDetected: idempotencyStatus.duplicate_event_detected,
    subscriptionOrMulti,
    alreadyRefundedOrTerminal,
    lifecycleState,
    readConsistencyBlockers,
    requestBlockers,
  });
  const proposedCustomerAppOrderImpact = g35bCustomerOrderImpact({ customerOrder, refundType: lookup.refundType || 'unknown', lookup, lifecycleState });
  const proposedNativeShopifyOrderImpact = g35bNativeOrderImpact({ nativeOrder, refundType: lookup.refundType || 'unknown', lookup, lifecycleState });
  const proposedFulfillmentTaskImpact = g35bTaskImpact({ task, refundType: lookup.refundType || 'unknown', lifecycleState });
  const proposedReviewQueueImpact = g35bReviewQueueImpact({ refundType: lookup.refundType || 'unknown', orderNumber, customerOrderId, orderFound, lifecycleState, alreadyRefundedOrTerminal });
  const proposedRefundFieldImpact = {
    customer_app_order: proposedCustomerAppOrderImpact?.proposed_refund_fields || null,
    native_shopify_order: proposedNativeShopifyOrderImpact?.proposed_refund_fields || null,
  };


  return {
    success: blockers.length === 0,
    dry_run: true,
    writes_performed: false,
    generated_at: new Date().toISOString(),
    function_name: 'previewNativeOrderCutoverReadiness',
    requested_function_alias: 'previewNativeRefundImpact',
    preview_mode: G35B_PREVIEW_MODE,
    order_number: orderNumber || lookup.orderNumber || null,
    refund_type: lookup.refundType || lookup.rawRefundType || null,
    refund_amount: lookup.refundAmount,
    currency: lookup.currency,
    event_source: lookup.eventSource,
    stripe_event_id: lookup.stripeEventId ? sanitizeText(lookup.stripeEventId, 120) : null,
    request_id: lookup.requestId || null,
    order_found: orderFound,
    preview_data_stable: previewDataStable,
    read_consistency: readConsistency,
    g35i_prev1_exact_read_fast_path: Boolean(resolvedContext.exact_id_fast_path_used),
    g35i_prev1_exact_read_fast_path_marker: resolvedContext.exact_id_fast_path_marker || null,
    command_readiness_safe: false,
    future_refund_command_planning_possible: false,
    customer_app_order_present: Boolean(customerOrder?.id),
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: Boolean(task?.id),
    hub_order_present: null,
    hub_context_status: 'hub_fallback_not_queried_safe_local_context_only',
    lifecycle_state: lifecycleState,
    lifecycle_stage: lifecycleState,
    lifecycle_risk_level: lifecycleRiskLevel,
    full_refund_preview_ready: fullRefundPreviewReady,
    refund_specific_fields_available: g35kRefundSpecificFieldsAvailable(),
    status_schema_policy_notes: lookup.refundType === 'full' ? g35kStatusSchemaPolicyNotes() : [],
    production_batch_count: productionBatchImpact.production_batch_count,
    verified_logged_batch_count: productionBatchImpact.verified_logged_batch_count,
    batch_compliance_log_count: productionBatchImpact.batch_compliance_log_count,
    locked_compliance_log_count: productionBatchImpact.locked_compliance_log_count,
    production_batch_mutation_proposed: false,
    compliance_log_mutation_proposed: false,
    idempotency_status: idempotencyStatus,
    already_refunded_or_terminal: alreadyRefundedOrTerminal,
    status_schema_compatibility: statusSchemaCompatibility,
    proposed_refund_field_impact: proposedRefundFieldImpact,
    proposed_customer_app_order_impact: proposedCustomerAppOrderImpact,
    proposed_native_shopify_order_impact: proposedNativeShopifyOrderImpact,
    proposed_fulfillment_task_impact: proposedFulfillmentTaskImpact,
    proposed_task_cancellation_impact: proposedFulfillmentTaskImpact,
    proposed_production_batch_impact: productionBatchImpact,
    proposed_batch_recalculation_impact: productionBatchImpact,
    proposed_order_review_queue_impact: proposedReviewQueueImpact,
    proposed_review_queue_impact: proposedReviewQueueImpact,
    proposed_order_sync_log_impact: {
      proposed_action: 'preview_only_future_refund_audit_log',
      would_create_now: false,
      existing_rows: g33cStatuses(orderSyncRows),
    },
    proposed_command_log_impact: {
      proposed_action: 'preview_only_future_command_log_if_live_command_is_approved',
      would_create_now: false,
      existing_rows: g33cStatuses(commandRows),
    },
    notification_impact: {
      notification_would_send: false,
      notification_held: true,
      notification_rows_created: false,
      message_logs_created: false,
    },
    provider_call_impact: false,
    hub_fallback_required: true,
    hub_fallback_impact: {
      hub_fallback_required: true,
      hub_bridge_modified: false,
      hub_records_updated: false,
      order_sync_log_status: g33cStatuses(orderSyncRows),
      safe_sync_parity_log_status: g33cStatuses(parityRows),
      review_queue_status: g33cStatuses(reviewRows),
    },
    blockers: [...new Set([...blockers, ...liveBlockers])],
    warnings: [...new Set(warnings)],
    next_action: nextAction,
    safety: G35B_READ_ONLY_SAFETY,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, error_code: 'malformed_json', message: 'Malformed JSON body' }, { status: 400 });
    }

    const body = parsed.body || {};
    const g39bPreviewRequest = isG39BPreviewRequest(body);
    const g33cPreviewRequest = isG33CPreviewRequest(body);
    const g33cMirror1PreviewRequest = isG33CMirror1PreviewRequest(body);
    const g33cTask1PreviewRequest = isG33CTask1PreviewRequest(body);
    const g35bPreviewRequest = isG35BPreviewRequest(body);
    const g35hPreviewRequest = isG35HPreviewRequest(body);
    const g35lPreviewRequest = isG35LPreviewRequest(body);
    const g36bPreviewRequest = isG36BPreviewRequest(body);
    const g36cHelperPreviewRequest = isG36CHelperPreviewRequest(body);
    const g36cResolvePreviewRequest = isG36CResolvePreviewRequest(body);
    const g36fPreviewRequest = isG36FPreviewRequest(body);
    if (g39bPreviewRequest) {
      const unsupported = g39bUnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (g33cPreviewRequest) {
      const unsupported = g33cUnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (g33cMirror1PreviewRequest) {
      const unsupported = g33cMirror1UnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (g33cTask1PreviewRequest) {
      const unsupported = g33cTask1UnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (g35bPreviewRequest) {
      const unsupported = g35bUnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (g35hPreviewRequest) {
      const unsupported = g35hUnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (g35lPreviewRequest) {
      const unsupported = g35lUnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (g36bPreviewRequest) {
      const unsupported = g36bUnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (g36cHelperPreviewRequest || g36cResolvePreviewRequest) {
      const unsupported = g36cHelperUnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (g36fPreviewRequest) {
      const unsupported = g36fUnsupportedBodyKey(body);
      if (unsupported) {
        return Response.json({ success: false, error_code: 'unsupported_body_key', unsupported_key: sanitizeText(unsupported, 80), writes_performed: false }, { status: 400 });
      }
    }
    if (!g39bPreviewRequest && !g33cPreviewRequest && !g33cMirror1PreviewRequest && !g33cTask1PreviewRequest && !g35bPreviewRequest && !g35hPreviewRequest && !g35lPreviewRequest && !g36bPreviewRequest && !g36cHelperPreviewRequest && !g36cResolvePreviewRequest && !g36fPreviewRequest && body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported' }, { status: 400 });
    }

    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    if (g39bPreviewRequest) {
      const preview = await buildG39BPreview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g33cPreviewRequest) {
      const preview = await buildG33CPreview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g33cMirror1PreviewRequest) {
      const preview = await buildG33CMirror1Preview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g33cTask1PreviewRequest) {
      const preview = await buildG33CTask1Preview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g35bPreviewRequest) {
      const preview = await buildG35BPreview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g35hPreviewRequest) {
      const preview = await buildG35HPreview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g35lPreviewRequest) {
      const preview = await buildG35LPreview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g36bPreviewRequest) {
      const preview = await buildG36BPreview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g36cHelperPreviewRequest) {
      const preview = await buildG36CHelperPreview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g36cResolvePreviewRequest) {
      const preview = await buildG36CResolvePreview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    if (g36fPreviewRequest) {
      const preview = await buildG36FPreview(base44, body);
      return Response.json({
        ...preview,
        actor_type: auth.actor_type,
        actor_role: auth.actor_role,
        actor_email_present: Boolean(auth.actor_email),
      });
    }

    const source = sanitizeText(body?.source || 'customer_app', 80) || 'customer_app';
    const eventType = sanitizeText(body?.event_type || body?.event || 'order.created', 100) || 'order.created';
    const targets = await buildTargets(base44, body);
    const lookup = getLookup(body);
    const summaries = [];

    for (const customerOrder of targets) {
      const targetLookup = {
        orderId: customerOrder?.id || lookup.orderId,
        orderNumber: normalizeOrderNumber(customerOrder?.order_number || lookup.orderNumber),
        nativeOrderId: lookup.nativeOrderId,
      };
      const nativeOrder = await findNativeShopifyOrder(base44, customerOrder, targetLookup);
      const tasks = await findNativeFulfillmentTasks(base44, customerOrder, nativeOrder, targetLookup);
      const preview = await runLiveOrderParityPreview({ base44, customerOrder, lookup: targetLookup, source, eventType }).catch(error => ({
        success: false,
        parity_status: 'preview_failed',
        readiness: { blockers: ['live_order_parity_preview_failed'], warnings: [sanitizeText(error?.message, 120)].filter(Boolean) },
      }));
      summaries.push(summarizeTarget({ customerOrder, nativeOrder, tasks, preview, lookup: targetLookup }));
    }

    const gates = gateSummary();
    const readiness = aggregateReadiness(summaries, gates);
    const hubRetirementReadiness = buildHubRetirementReadiness(gates);

    return Response.json({
      success: readiness.blockers.length === 0,
      dry_run: true,
      function_name: 'previewNativeOrderCutoverReadiness',
      generated_at: new Date().toISOString(),
      scope: lookup.orderId || lookup.orderNumber || lookup.nativeOrderId ? 'specific_order' : 'recent_paid_delivery_orders',
      source,
      event_type: eventType,
      readiness,
      hub_retirement_readiness: hubRetirementReadiness,
      gates,
      targets: summaries,
      safety: {
        dry_run_only: true,
        writes_performed: false,
        provider_calls_performed: false,
        stripe_calls_performed: false,
        shopify_api_calls_performed: false,
        notifications_sent: false,
        sync_repair_replay_performed: false,
        production_inventory_delivery_mutations_performed: false,
        hub_bridge_modified: false,
      },
    });
  } catch (error) {
    console.error(`[previewNativeOrderCutoverReadiness] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'native_order_cutover_readiness_failed',
      message: 'Native order cutover readiness preview failed safely.',
      writes_performed: false,
    }, { status: 500 });
  }
});
