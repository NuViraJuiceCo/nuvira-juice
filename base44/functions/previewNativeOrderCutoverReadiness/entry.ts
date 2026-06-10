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
  return previewMode === G33C_PREVIEW_MODE || ['EXACT_ORDER_PREVIEW', 'RECENT_CANDIDATE_SCAN'].includes(mode);
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

async function g33cFilter(base44, entityName, filter, sort = '-created_date', limit = 20) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function g33cList(base44, entityName, sort = '-created_date', limit = 100) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.list) return [];
  const rows = await entity.list(sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function g33cCustomerOrders(base44, lookup) {
  const rows = [];
  if (lookup.customerAppOrderId) {
    const byId = await base44.asServiceRole?.entities?.Order?.filter({ id: lookup.customerAppOrderId }, '-created_date', 1).catch(() => []);
    rows.push(...(Array.isArray(byId) ? byId : []));
  }
  if (lookup.orderNumber) {
    rows.push(...await g33cFilter(base44, 'Order', { order_number: lookup.orderNumber }, '-created_date', 10));
    rows.push(...await g33cFilter(base44, 'Order', { order_number: `#${lookup.orderNumber}` }, '-created_date', 10));
  }
  return g33cUnique(rows);
}

async function g33cNativeOrders(base44, orderNumber, customerOrderId) {
  const rows = [];
  if (customerOrderId) rows.push(...await g33cFilter(base44, 'ShopifyOrder', { base44_order_id: customerOrderId }, '-created_date', 10));
  if (orderNumber) {
    rows.push(...await g33cFilter(base44, 'ShopifyOrder', { shopify_order_number: orderNumber }, '-created_date', 10));
    rows.push(...await g33cFilter(base44, 'ShopifyOrder', { shopify_order_number: `#${orderNumber}` }, '-created_date', 10));
  }
  return g33cUnique(rows).filter(row => g33cMatchesOrder(row, orderNumber, customerOrderId));
}

async function g33cTasks(base44, orderNumber, customerOrderId, nativeOrderId) {
  const rows = [];
  if (customerOrderId) {
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { base44_order_id: customerOrderId }, '-created_date', 20));
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { order_id: customerOrderId }, '-created_date', 20));
  }
  if (nativeOrderId) {
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { native_shopify_order_id: nativeOrderId }, '-created_date', 20));
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { shopify_order_id: nativeOrderId }, '-created_date', 20));
  }
  if (orderNumber) {
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { order_number: orderNumber }, '-created_date', 20));
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { shopify_order_number: orderNumber }, '-created_date', 20));
    rows.push(...await g33cFilter(base44, 'FulfillmentTask', { shopify_order_number: `#${orderNumber}` }, '-created_date', 20));
  }
  return g33cUnique(rows).filter(row => g33cMatchesOrder(row, orderNumber, customerOrderId) || (nativeOrderId && [row?.native_shopify_order_id, row?.shopify_order_id].includes(nativeOrderId)));
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


const G35B_PREVIEW_MODE = 'NATIVE_REFUND_IMPACT';
const G35B_REFUND_TYPES = new Set(['full', 'partial', 'unknown']);
const G35B_EVENT_SOURCES = new Set(['stripe_webhook', 'stripe_webhook_shadow', 'admin_preview', 'test_fixture']);

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
  if (lookup.nativeOrderId) rows.push(...await g33cFilter(base44, 'ShopifyOrder', { id: lookup.nativeOrderId }, '-created_date', 5));
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

async function g35dRefundBatches(base44, orderNumber, customerOrderId, nativeOrderId, taskId) {
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

  const listed = await g33cList(base44, 'ProductionBatch', '-production_date', 1000);
  rows.push(...listed);

  return g35dUniqueAnnotated(rows.flatMap(batch => {
    const match = g35dBatchMatchInfo(batch, { orderNumber, customerOrderId, nativeOrderId, taskId });
    return match.matched ? [{ ...batch, __g35d_linkage_methods: match.methods }] : [];
  }));
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
    if (batch?.compliance_log_id) rows.push(...await g33cFilter(base44, 'BatchComplianceLog', { id: batch.compliance_log_id }, '-created_date', 5));
    if (batch?.batch_id) rows.push(...await g33cFilter(base44, 'BatchComplianceLog', { batch_id: batch.batch_id }, '-created_date', 10));
    if (batch?.id) rows.push(...await g33cFilter(base44, 'BatchComplianceLog', { source_production_batch_id: batch.id }, '-created_date', 10));
  }

  const listed = await g33cList(base44, 'BatchComplianceLog', '-created_date', 1000);
  rows.push(...listed);

  return g35dUniqueAnnotated(rows.flatMap(log => {
    const match = g35dComplianceMatchInfo(log, batches);
    return match.matched ? [{ ...log, __g35d_linkage_methods: match.methods }] : [];
  }));
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

function g35bNextAction({ refundType, orderFound, duplicateEventDetected, subscriptionOrMulti, lifecycleState, schemaGapBlockers }) {
  if (duplicateEventDetected) return 'duplicate_refund_event_detected';
  if (!orderFound) return 'unknown_order_review_required';
  if (subscriptionOrMulti) return 'unsupported_subscription_refund';
  if (refundType === 'partial') return 'partial_refund_review_required';
  if (['delivered', 'historical_fulfilled'].includes(lifecycleState)) return 'delivered_refund_manual_review_required';
  if (schemaGapBlockers?.length) return 'schema_gap_blocks_native_refund_command';
  if (['before_native_ops', 'native_order_created_only'].includes(lifecycleState) && refundType === 'full') return 'native_refund_preview_ready_full_refund_pre_production';
  return 'hold_hub_refund_source_of_truth';
}

function g35bCustomerOrderImpact({ customerOrder, refundType, statusCompatibility }) {
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
    proposed_action: statusCompatibility.schema_gap_blockers.length ? 'blocked_by_schema_gap_preview_only' : 'preview_full_refund_customer_payment_status_impact',
    current_status: sanitizeText(customerOrder?.status, 80),
    proposed_status: 'refunded',
    proposed_status_supported: statusCompatibility.customer_order_status_refund_value_supported,
    current_payment_status: sanitizeText(customerOrder?.payment_status || customerOrder?.financial_status, 80),
    proposed_payment_status: 'refunded',
    proposed_financial_status: 'refunded',
    proposed_payment_captured: false,
    status_history_append_preview: 'held_requires_live_policy_approval',
    would_update_now: false,
  };
}

function g35bNativeOrderImpact({ nativeOrder, refundType }) {
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
  return {
    present: true,
    proposed_action: 'preview_full_refund_native_order_status_impact',
    current_payment_status: sanitizeText(nativeOrder?.payment_status || nativeOrder?.financial_status, 80),
    proposed_payment_status: 'refunded',
    current_production_status: sanitizeText(nativeOrder?.production_status, 80),
    proposed_production_status: 'canceled',
    current_fulfillment_status: sanitizeText(nativeOrder?.fulfillment_status || nativeOrder?.shopify_fulfillment_status, 80),
    proposed_fulfillment_status: 'cancelled',
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

function g35bReviewQueueImpact({ refundType, orderNumber, customerOrderId, orderFound, lifecycleState }) {
  if (!orderFound) {
    return {
      proposed_action: 'review_queue_preview_for_unknown_order',
      would_create_now: false,
      incident_type: 'refund_received_unknown_order',
      order_number: orderNumber || null,
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
  if (!lookup.orderNumber && !lookup.customerAppOrderId && !lookup.nativeOrderId && !lookup.stripeEventId && !lookup.stripeRefundId) requestBlockers.push('order_or_refund_event_identifier_required');

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
  if (!nativeOrder && (orderNumber || customerOrderId)) {
    nativeOrders = await g35bNativeOrders(base44, { ...lookup, orderNumber, customerAppOrderId: customerOrderId }, customerOrder);
    nativeOrder = nativeOrders[0] || null;
  }
  const tasks = await g33cTasks(base44, orderNumber, customerOrderId, nativeOrder?.id || lookup.nativeOrderId);
  const task = tasks[0] || null;
  const [orderSyncRows, commandRows, parityRows, reviewRows] = await Promise.all([
    g35bLogs(base44, 'OrderSyncLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'CommandLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'SafeSyncParityLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35hReviewRows(base44, { orderNumber, customerOrderId, nativeOrderId: nativeOrder?.id || lookup.nativeOrderId, stripeEventId: lookup.stripeEventId, stripeRefundId: lookup.stripeRefundId }),
  ]);
  const batches = await g35dRefundBatches(base44, orderNumber, customerOrderId, nativeOrder?.id, task?.id);
  const complianceLogs = await g35dRefundComplianceLogs(base44, batches);
  const orderFound = Boolean(customerOrder?.id || nativeOrder?.id || task?.id);
  const lifecycleState = g35bLifecycleState({ customerOrder, nativeOrder, task, batches, complianceLogs });
  const productionBatchImpact = g35bProductionBatchImpact({ batches, complianceLogs, refundType: 'partial', lifecycleState, orderNumber, customerOrderId, nativeOrderId: nativeOrder?.id, taskId: task?.id });
  const idempotencyStatus = g35bIdempotencyStatus({ stripeEventId: lookup.stripeEventId, orderSyncRows, commandRows });
  const partialReviewRows = reviewRows.filter(g35hPartialReviewLike);
  const duplicateReviewDetected = partialReviewRows.length > 0;
  const duplicateEventDetected = idempotencyStatus.duplicate_event_detected;

  if (!orderFound && !requestBlockers.includes('order_or_refund_event_identifier_required')) warnings.push('unknown_order_review_required');
  if (lifecycleState === 'delivered') warnings.push('delivered_partial_refund_manual_review_required');
  if (productionBatchImpact.verified_logged_batch_count > 0) warnings.push('verified_production_history_preserved');
  if (productionBatchImpact.locked_compliance_log_count > 0) warnings.push('locked_compliance_logs_preserved');
  warnings.push('partial_refund_review_only_no_automatic_mutation', 'notifications_held', 'provider_calls_disabled', 'inventory_reversal_not_proposed', 'purchase_order_reversal_not_proposed', 'hub_fallback_required');

  const blockers = [...requestBlockers];
  let nextAction = 'partial_refund_review_required';
  if (requestBlockers.includes('refund_amount_required_for_partial_refund_review')) nextAction = 'provide_refund_amount_for_review_preview';
  else if (requestBlockers.includes('refund_type_must_be_partial_for_partial_refund_review_preview')) nextAction = 'use_native_refund_impact_preview_for_non_partial_refund';
  else if (requestBlockers.length) nextAction = 'fix_preview_request_and_rerun';
  else if (duplicateEventDetected) nextAction = 'duplicate_refund_event_detected';
  else if (duplicateReviewDetected) nextAction = 'duplicate_partial_refund_review_already_exists';
  else if (!orderFound) nextAction = 'unknown_order_review_required';
  else if (lifecycleState === 'delivered') nextAction = 'partial_refund_manual_review_required';

  const reviewQueueImpact = g35hReviewQueueImpact({
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

async function buildG35BPreview(base44, body) {
  const lookup = g35bLookup(body);
  const requestBlockers = [];
  const warnings = [];
  if (!lookup.refundType) requestBlockers.push('refund_type_required_full_partial_or_unknown');
  if (!lookup.orderNumber && !lookup.customerAppOrderId && !lookup.nativeOrderId && !lookup.stripeEventId) requestBlockers.push('order_or_stripe_event_identifier_required');

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
  if (!nativeOrder && (orderNumber || customerOrderId)) {
    nativeOrders = await g35bNativeOrders(base44, { ...lookup, orderNumber, customerAppOrderId: customerOrderId }, customerOrder);
    nativeOrder = nativeOrders[0] || null;
  }
  const tasks = await g33cTasks(base44, orderNumber, customerOrderId, nativeOrder?.id);
  const task = tasks[0] || null;
  const [orderSyncRows, reviewRows, commandRows, parityRows] = await Promise.all([
    g35bLogs(base44, 'OrderSyncLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'OrderReviewQueue', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'CommandLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
    g35bLogs(base44, 'SafeSyncParityLog', { orderNumber, customerOrderId, stripeEventId: lookup.stripeEventId }, 25),
  ]);
  const batches = await g35dRefundBatches(base44, orderNumber, customerOrderId, nativeOrder?.id, task?.id);
  const complianceLogs = await g35dRefundComplianceLogs(base44, batches);
  const orderFound = Boolean(customerOrder?.id || nativeOrder?.id || task?.id);
  const subscriptionOrMulti = g33cSubscriptionOrMulti(nativeOrder, task);
  const lifecycleState = g35bLifecycleState({ customerOrder, nativeOrder, task, batches, complianceLogs });
  const lifecycleRiskLevel = g35bRiskLevel(lifecycleState);
  const statusSchemaCompatibility = g35bSchemaCompatibility(lookup.refundType || 'unknown');
  const idempotencyStatus = g35bIdempotencyStatus({ stripeEventId: lookup.stripeEventId, orderSyncRows, commandRows });
  const productionBatchImpact = g35bProductionBatchImpact({ batches, complianceLogs, refundType: lookup.refundType || 'unknown', lifecycleState, orderNumber, customerOrderId, nativeOrderId: nativeOrder?.id, taskId: task?.id });
  const liveBlockers = [];
  if (subscriptionOrMulti) liveBlockers.push('subscription_or_multi_delivery_refund_not_supported_by_one_time_preview');
  liveBlockers.push(...statusSchemaCompatibility.schema_gap_blockers);
  if (['production_started', 'production_completed', 'production_verified', 'delivered', 'historical_fulfilled'].includes(lifecycleState)) liveBlockers.push(`${lifecycleState}_manual_review_required`);
  if (idempotencyStatus.duplicate_event_detected) liveBlockers.push('duplicate_refund_event_detected');
  if (!orderFound) warnings.push('unknown_order_review_required');
  if (lookup.refundType === 'partial') warnings.push('partial_refund_review_only_no_automatic_mutation');
  if (productionBatchImpact.verified_logged_batch_count > 0) warnings.push('verified_production_history_preserved');
  if (productionBatchImpact.locked_compliance_log_count > 0) warnings.push('locked_compliance_logs_preserved');
  if (lifecycleState === 'delivered') warnings.push('delivered_refund_manual_review_required');
  warnings.push('notifications_held', 'provider_calls_disabled', 'inventory_reversal_not_proposed', 'purchase_order_reversal_not_proposed', 'hub_fallback_required');

  const nextAction = requestBlockers.length
    ? 'fix_preview_request_and_rerun'
    : g35bNextAction({
      refundType: lookup.refundType,
      orderFound,
      duplicateEventDetected: idempotencyStatus.duplicate_event_detected,
      subscriptionOrMulti,
      lifecycleState,
      schemaGapBlockers: statusSchemaCompatibility.schema_gap_blockers,
    });

  return {
    success: requestBlockers.length === 0,
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
    customer_app_order_present: Boolean(customerOrder?.id),
    native_shopify_order_present: Boolean(nativeOrder?.id),
    native_fulfillment_task_present: Boolean(task?.id),
    hub_order_present: null,
    hub_context_status: 'hub_fallback_not_queried_safe_local_context_only',
    lifecycle_state: lifecycleState,
    lifecycle_risk_level: lifecycleRiskLevel,
    production_batch_count: productionBatchImpact.production_batch_count,
    verified_logged_batch_count: productionBatchImpact.verified_logged_batch_count,
    batch_compliance_log_count: productionBatchImpact.batch_compliance_log_count,
    locked_compliance_log_count: productionBatchImpact.locked_compliance_log_count,
    production_batch_mutation_proposed: false,
    compliance_log_mutation_proposed: false,
    idempotency_status: idempotencyStatus,
    status_schema_compatibility: statusSchemaCompatibility,
    proposed_customer_app_order_impact: g35bCustomerOrderImpact({ customerOrder, refundType: lookup.refundType || 'unknown', statusCompatibility: statusSchemaCompatibility }),
    proposed_native_shopify_order_impact: g35bNativeOrderImpact({ nativeOrder, refundType: lookup.refundType || 'unknown' }),
    proposed_fulfillment_task_impact: g35bTaskImpact({ task, refundType: lookup.refundType || 'unknown', lifecycleState }),
    proposed_production_batch_impact: productionBatchImpact,
    proposed_order_review_queue_impact: g35bReviewQueueImpact({ refundType: lookup.refundType || 'unknown', orderNumber, customerOrderId, orderFound, lifecycleState }),
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
    blockers: [...new Set([...requestBlockers, ...liveBlockers])],
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
    const g33cPreviewRequest = isG33CPreviewRequest(body);
    const g35bPreviewRequest = isG35BPreviewRequest(body);
    const g35hPreviewRequest = isG35HPreviewRequest(body);
    if (g33cPreviewRequest) {
      const unsupported = g33cUnsupportedBodyKey(body);
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
    if (!g33cPreviewRequest && !g35bPreviewRequest && !g35hPreviewRequest && body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported' }, { status: 400 });
    }

    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    if (g33cPreviewRequest) {
      const preview = await buildG33CPreview(base44, body);
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
