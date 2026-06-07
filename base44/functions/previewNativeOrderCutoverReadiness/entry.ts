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
  return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
}

function forbidden() {
  return Response.json({ success: false, error_code: 'forbidden', message: 'Admin access required' }, { status: 403 });
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

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, error_code: 'malformed_json', message: 'Malformed JSON body' }, { status: 400 });
    }

    const body = parsed.body || {};
    if (body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported' }, { status: 400 });
    }

    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

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
