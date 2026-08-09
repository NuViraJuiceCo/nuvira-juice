import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncHubDeliveryStatuses — scheduled every 10 minutes.
 * 
 * Fetches active CA orders (not yet delivered/cancelled), queries Hub for
 * current production_status, maps to CA status, and updates any that have changed.
 * 
 * The CA Order entity automation "Order Status Notification Trigger" then fires
 * automatically on status change → sendOrderStatusNotification → sendCustomerNotification.
 * 
 * Terminal state guard: never overwrites delivered, cancelled, refunded, picked_up.
 * Idempotent: only writes if status actually changed.
 */

const HUB_BASE = (Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const TERMINAL_STATUSES = new Set(['delivered', 'picked_up', 'cancelled', 'refunded']);
const TASK_TERMINAL_STATUSES = new Set(['delivered', 'completed', 'fulfilled', 'cancelled', 'canceled']);
const DELIVERY_DATE_FIELDS = [
  'assigned_delivery_date',
  'selected_delivery_date',
  'requested_delivery_date',
  'delivery_date',
];

async function readJsonBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return {};
  }

  const raw = await req.text();
  if (!raw.trim()) return {};

  try {
    const body = JSON.parse(raw);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return { __malformed_json: true };
  }
}

// Hub production_status → CA Order status
function mapHubStatus(hubStatus) {
  const map = {
    new:                      'order_received',
    awaiting_production:      'scheduled_for_juicing',
    scheduled_for_production: 'scheduled_for_juicing',
    in_production:            'in_production',
    bottled:                  'bottled_packed',
    labeled:                  'bottled_packed',
    qc_checked:               'bottled_packed',
    packed:                   'bottled_packed',
    in_cold_storage:          'bottled_packed',
    assigned_for_pickup:      'ready_for_pickup',
    assigned_for_delivery:    'out_for_delivery',
    fulfilled:                'delivered',
    // pass-throughs
    order_received:           'order_received',
    scheduled_for_juicing:    'scheduled_for_juicing',
    bottled_packed:           'bottled_packed',
    out_for_delivery:         'out_for_delivery',
    arriving_soon:            'arriving_soon',
    ready_for_pickup:         'ready_for_pickup',
    picked_up:                'picked_up',
  };
  return map[hubStatus] || null;
}

function envInt(name, fallback, { min = 0, max = 90 } = {}) {
  const parsed = Number.parseInt(Deno.env.get(name) || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function dateKey(value) {
  if (!value) return null;
  const text = value.toString().trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function dateToEpochDay(key) {
  if (!key) return null;
  const [year, month, day] = key.split('-').map(Number);
  if (!year || !month || !day) return null;
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function centralTodayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function orderDeliveryDateKey(order) {
  for (const field of DELIVERY_DATE_FIELDS) {
    const key = dateKey(order?.[field]);
    if (key) return key;
  }
  return null;
}

function orderKey(value) {
  return (value ?? '').toString().trim().replace(/^#/, '').toLowerCase();
}

function normalizeStatus(value) {
  return (value ?? '').toString().trim().toLowerCase().replace(/\s+/g, '_');
}

function validIsoDate(value) {
  const text = (value ?? '').toString().trim();
  return text && !Number.isNaN(Date.parse(text)) ? text : null;
}

function taskAlreadyDelivered(task) {
  const status = normalizeStatus(task?.status);
  const deliveryStatus = normalizeStatus(task?.delivery_status);
  return TASK_TERMINAL_STATUSES.has(status) ||
    TASK_TERMINAL_STATUSES.has(deliveryStatus) ||
    Boolean(validIsoDate(task?.delivered_at));
}

function taskMatchesOrder(task, order) {
  const orderNumber = orderKey(order?.order_number || order?.shopify_order_number);
  const taskOrderNumber = orderKey(task?.order_number || task?.shopify_order_number);
  if (orderNumber && taskOrderNumber && orderNumber === taskOrderNumber) return true;

  const orderIds = new Set([order?.id, order?.base44_order_id].filter(Boolean));
  return [
    task?.order_id,
    task?.base44_order_id,
    task?.customer_app_order_id,
  ].some(value => value && orderIds.has(value));
}

function taskDeliveryDateKey(task) {
  return dateKey(task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date);
}

function centralDateKeyFromTimestamp(value) {
  const text = (value ?? '').toString().trim();
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(text));
}

function hubDeliveredTaskKeys(hubOrder) {
  const keys = new Set();
  const add = (value) => {
    const key = orderKey(value);
    if (key) keys.add(key);
  };
  add(hubOrder?.fulfillment_task_id);
  add(hubOrder?.task_id);

  for (const row of [
    ...(Array.isArray(hubOrder?.fulfillment_tasks) ? hubOrder.fulfillment_tasks : []),
    ...(Array.isArray(hubOrder?.fulfillments) ? hubOrder.fulfillments : []),
  ]) {
    if (!taskAlreadyDelivered(row)) continue;
    add(row?.id);
    add(row?.fulfillment_task_id);
    add(row?.task_id);
  }
  return keys;
}

function taskMatchesExplicitHubEvidence(task, hubKeys) {
  if (!hubKeys.size) return false;
  return [task?.id, task?.fulfillment_task_id, task?.task_id]
    .map(orderKey)
    .filter(Boolean)
    .some((key) => hubKeys.has(key));
}

function planDeliveredTaskReconciliation({ tasks, order, hubOrder = null }) {
  const matchingTasks = tasks.filter((task) => taskMatchesOrder(task, order));
  const nonterminalTasks = matchingTasks.filter((task) => !taskAlreadyDelivered(task));
  const hubKeys = hubDeliveredTaskKeys(hubOrder);
  const explicitMatches = nonterminalTasks.filter((task) => taskMatchesExplicitHubEvidence(task, hubKeys));
  const evidenceDates = new Set([
    orderDeliveryDateKey(hubOrder),
    orderDeliveryDateKey(order),
    centralDateKeyFromTimestamp(hubOrder?.delivered_at),
    centralDateKeyFromTimestamp(order?.delivered_at),
  ].filter(Boolean));
  const dateMatches = nonterminalTasks.filter((task) => evidenceDates.has(taskDeliveryDateKey(task)));

  let task = null;
  let reason = null;
  if (explicitMatches.length === 1) {
    task = explicitMatches[0];
    reason = 'exact_hub_task_identity';
  } else if (explicitMatches.length > 1) {
    reason = 'multiple_exact_hub_task_matches';
  } else if (dateMatches.length === 1) {
    task = dateMatches[0];
    reason = 'exact_delivery_date_match';
  } else if (dateMatches.length > 1) {
    reason = 'multiple_delivery_date_task_matches';
  } else if (matchingTasks.length === 1 && nonterminalTasks.length === 1) {
    task = nonterminalTasks[0];
    reason = 'single_order_task';
  } else if (nonterminalTasks.length > 0) {
    reason = 'no_exact_fulfillment_occurrence_match';
  } else {
    reason = 'no_nonterminal_task_reconciliation_needed';
  }

  return {
    task,
    reason,
    matching_task_count: matchingTasks.length,
    nonterminal_task_count: nonterminalTasks.length,
    remaining_nonterminal_task_count: Math.max(0, nonterminalTasks.length - (task ? 1 : 0)),
  };
}

function buildTaskDeliveredPayload(task, order, hubOrder = null, source = 'customer_app_order_delivered') {
  const deliveredAt = validIsoDate(order?.delivered_at) || validIsoDate(hubOrder?.delivered_at) || new Date().toISOString();
  const existingAudit = Array.isArray(task?.audit_trail) ? task.audit_trail : [];
  const payload = Object.assign(Object.create(null), {
    status: 'delivered',
    delivery_status: 'delivered',
    delivered_at: deliveredAt,
    audit_trail: [
      ...existingAudit,
      {
        action: 'hub_delivery_status_sync_task_reconciled',
        source,
        order_number: order?.order_number || hubOrder?.order_number || hubOrder?.shopify_order_number || null,
        previous_status: task?.status || null,
        previous_delivery_status: task?.delivery_status || null,
        timestamp: new Date().toISOString(),
      },
    ].slice(-25),
  });

  const photoUrl = hubOrder?.delivery_photo_url || order?.delivery_photo_url;
  const dropLocation = hubOrder?.delivery_drop_location || order?.delivery_drop_location;
  if (photoUrl) payload.delivery_photo_url = photoUrl;
  if (dropLocation) payload.delivery_drop_location = dropLocation;
  return payload;
}

function stageDeliveredTaskReconciliation({ taskUpdates, tasks, order, hubOrder = null, source }) {
  const plan = planDeliveredTaskReconciliation({ tasks, order, hubOrder });
  if (plan.task) {
    taskUpdates.set(plan.task.id, {
      task: plan.task,
      order_number: order?.order_number || hubOrder?.order_number || hubOrder?.shopify_order_number || plan.task?.order_number || null,
      payload: buildTaskDeliveredPayload(plan.task, order, hubOrder, source),
    });
  }
  return plan;
}

function getDeliverySyncWindow() {
  const todayKey = centralTodayKey();
  const todayEpochDay = dateToEpochDay(todayKey);
  const lookbackDays = envInt('HUB_DELIVERY_STATUS_SYNC_LOOKBACK_DAYS', 3, { min: 0, max: 30 });
  const lookaheadDays = envInt('HUB_DELIVERY_STATUS_SYNC_LOOKAHEAD_DAYS', 14, { min: 0, max: 90 });

  return {
    todayKey,
    todayEpochDay,
    lookbackDays,
    lookaheadDays,
    startEpochDay: todayEpochDay - lookbackDays,
    endEpochDay: todayEpochDay + lookaheadDays,
  };
}

function classifyDeliverySyncEligibility(order, window) {
  const deliveryDateKey = orderDeliveryDateKey(order);
  if (!deliveryDateKey) {
    return { eligible: false, reason: 'missing_delivery_date', delivery_date: null };
  }

  const epochDay = dateToEpochDay(deliveryDateKey);
  if (!Number.isFinite(epochDay)) {
    return { eligible: false, reason: 'invalid_delivery_date', delivery_date: deliveryDateKey };
  }

  if (epochDay < window.startEpochDay) {
    return { eligible: false, reason: 'delivery_date_before_sync_window', delivery_date: deliveryDateKey };
  }
  if (epochDay > window.endEpochDay) {
    return { eligible: false, reason: 'delivery_date_after_sync_window', delivery_date: deliveryDateKey };
  }

  return { eligible: true, reason: 'delivery_date_in_sync_window', delivery_date: deliveryDateKey };
}

Deno.serve(async (req) => {
  try {
    const body = await readJsonBody(req);
    if (body.__malformed_json) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }

    if (Deno.env.get('ENABLE_LEGACY_HUB_DELIVERY_BRIDGE') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        retired: true,
        dry_run: body.dry_run === true || body.mode === 'dry_run',
        active_orders: 0,
        updated: 0,
        updated_fulfillment_tasks: 0,
        reason: 'legacy_hub_delivery_bridge_retired',
        source: 'customer_app_native_delivery_authoritative',
        hub_operational_dependency: false,
        external_calls_performed: false,
      });
    }

    const dryRun = body.dry_run === true || body.mode === 'dry_run';
    const syncGateEnabled = Deno.env.get('ENABLE_HUB_DELIVERY_STATUS_SYNC') === 'true';

    if (!syncGateEnabled && !dryRun) {
      return Response.json({
        success: true,
        skipped: true,
        active_orders: 0,
        updated: 0,
        reason: 'hub_delivery_status_sync_disabled',
        message: 'Hub delivery status sync is disabled by the current controlled-sync gate.',
      });
    }

    const base44 = createClientFromRequest(req);

    if (!HUB_BASE || !SYNC_SECRET) {
      console.log('[syncHubDeliveryStatuses] HUB_API_URL or CUSTOMER_APP_SYNC_SECRET not set, skipping');
      return Response.json({ success: true, skipped: true, reason: 'missing_env' });
    }

    // Fetch active (non-terminal, paid) CA orders
    const [allOrders, allFulfillmentTasks] = await Promise.all([
      base44.asServiceRole.entities.Order.list('-updated_date', 300),
      base44.asServiceRole.entities.FulfillmentTask.list('-updated_date', 500).catch(() => []),
    ]);
    const activeOrders = allOrders.filter(o =>
      o.order_number &&
      o.payment_captured === true &&
      !TERMINAL_STATUSES.has(o.status) &&
      o.payment_status !== 'refunded' &&
      o.status !== 'cancelled' &&
      !o.is_test_order &&
      !o.is_abandoned_checkout
    );

    const syncWindow = getDeliverySyncWindow();
    const skippedByDeliveryWindow = [];
    const eligibleOrders = activeOrders.filter((order) => {
      const eligibility = classifyDeliverySyncEligibility(order, syncWindow);
      if (!eligibility.eligible) {
        skippedByDeliveryWindow.push({
          order_number: order.order_number,
          status: order.status,
          delivery_date: eligibility.delivery_date,
          reason: eligibility.reason,
        });
      }
      return eligibility.eligible;
    });
    const deliveredOrdersInWindow = allOrders.filter((order) => {
      if (!order?.order_number || order.payment_captured !== true) return false;
      if (normalizeStatus(order.status) !== 'delivered') return false;
      if (order.payment_status === 'refunded' || order.is_test_order || order.is_abandoned_checkout) return false;
      return classifyDeliverySyncEligibility(order, syncWindow).eligible;
    });

    console.log(`[syncHubDeliveryStatuses] Checking ${eligibleOrders.length} eligible active orders against Hub`);

    // Get unique customer emails to batch Hub queries
    const uniqueEmails = [...new Set([...eligibleOrders, ...deliveredOrdersInWindow].map(o => o.customer_email).filter(Boolean))];

    // Map: order_number → hub order
    const hubByOrderNum = new Map();

    for (const email of uniqueEmails) {
      try {
        const hubUrl = `${HUB_BASE}/api/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(email)}`;
        const res = await fetch(hubUrl, {
          headers: {
            'Authorization': `Bearer ${SYNC_SECRET}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          console.warn(`[syncHubDeliveryStatuses] Hub returned ${res.status} for ${email}`);
          continue;
        }

        const data = await res.json();
        for (const order of (data.orders || [])) {
          const num = (order.shopify_order_number || order.order_number || '').replace('#', '');
          if (num) hubByOrderNum.set(num, order);
        }
      } catch (err) {
        console.warn(`[syncHubDeliveryStatuses] Hub fetch error for ${email}: ${err.message}`);
      }
    }

    console.log(`[syncHubDeliveryStatuses] Fetched ${hubByOrderNum.size} Hub orders`);

    let updated = 0;
    let skipped = 0;
    const updatedOrders = [];
    const wouldUpdateOrders = [];
    const taskUpdates = new Map();
    const wouldUpdateFulfillmentTasks = [];
    const updatedFulfillmentTasks = [];
    const heldOrderDeliveryCompletions = [];
    const heldTaskReconciliations = [];

    for (const caOrder of eligibleOrders) {
      const hubOrder = hubByOrderNum.get(caOrder.order_number);
      if (!hubOrder) { skipped++; continue; }

      const hubProdStatus = hubOrder.production_status || hubOrder.status;
      const mappedStatus = mapHubStatus(hubProdStatus);

      if (!mappedStatus || mappedStatus === caOrder.status) { skipped++; continue; }

      // Terminal guard: never overwrite a terminal CA status
      if (TERMINAL_STATUSES.has(caOrder.status)) { skipped++; continue; }

      // Update CA Order — this triggers the entity automation → notification
      const newHistory = [
        ...(caOrder.status_history || []),
        {
          status: mappedStatus,
          timestamp: new Date().toISOString(),
          message: `Status synced from Hub (hub_status: ${hubProdStatus})`,
        },
      ];

      // Build update payload — stamp delivered_at and pull proof fields on delivery
      const updatePayload = Object.assign(Object.create(null), {
        status: mappedStatus,
        status_history: newHistory,
      });
      if (mappedStatus === 'delivered') {
        const hubDeliveredAt = hubOrder.delivered_at && !Number.isNaN(Date.parse(hubOrder.delivered_at))
          ? hubOrder.delivered_at
          : null;
        updatePayload.delivered_at = hubDeliveredAt || new Date().toISOString();
        // Pull proof-of-delivery fields from Hub order if present
        if (hubOrder.delivery_photo_url) updatePayload.delivery_photo_url = hubOrder.delivery_photo_url;
        if (hubOrder.delivery_drop_location) updatePayload.delivery_drop_location = hubOrder.delivery_drop_location;
      }

      if (mappedStatus === 'delivered') {
        const reconciliation = stageDeliveredTaskReconciliation({
          taskUpdates,
          tasks: allFulfillmentTasks,
          order: { ...caOrder, ...updatePayload },
          hubOrder,
          source: dryRun ? 'hub_status_mapping_dry_run' : 'hub_status_mapping',
        });
        if (reconciliation.remaining_nonterminal_task_count > 0 || (!reconciliation.task && reconciliation.nonterminal_task_count > 0)) {
          heldOrderDeliveryCompletions.push({
            order_number: caOrder.order_number,
            reason: 'pending_or_ambiguous_fulfillment_occurrences',
            reconciliation_reason: reconciliation.reason,
            matching_task_count: reconciliation.matching_task_count,
            remaining_nonterminal_task_count: reconciliation.remaining_nonterminal_task_count,
          });
          skipped++;
          continue;
        }
      }

      if (dryRun) {
        wouldUpdateOrders.push({
          order_number: caOrder.order_number,
          from: caOrder.status,
          to: mappedStatus,
          hub_status: hubProdStatus,
          would_set_delivered_at: mappedStatus === 'delivered' ? Boolean(updatePayload.delivered_at) : false,
          would_pull_delivery_photo_url: mappedStatus === 'delivered' ? Boolean(updatePayload.delivery_photo_url) : false,
          would_pull_delivery_drop_location: mappedStatus === 'delivered' ? Boolean(updatePayload.delivery_drop_location) : false,
        });
        skipped++;
        continue;
      }

      await base44.asServiceRole.entities.Order.update(caOrder.id, updatePayload);

      console.log(`[syncHubDeliveryStatuses] ✅ ${caOrder.order_number}: ${caOrder.status} → ${mappedStatus}`);
      updated++;
      updatedOrders.push({ order_number: caOrder.order_number, from: caOrder.status, to: mappedStatus });

      // NOTE: Notification is handled exclusively by the entity automation
      // "Order Status Notification Trigger" → sendOrderStatusNotification → sendCustomerNotification.
      // The idempotency key in sendCustomerNotification prevents duplicates.
      // Safety-net direct call removed (2026-05-17) to eliminate double function invocation credits.
    }

    for (const deliveredOrder of deliveredOrdersInWindow) {
      const hubOrder = hubByOrderNum.get(deliveredOrder.order_number) || null;
      const reconciliation = stageDeliveredTaskReconciliation({
        taskUpdates,
        tasks: allFulfillmentTasks,
        order: deliveredOrder,
        hubOrder,
        source: 'customer_app_order_delivered',
      });
      if (!reconciliation.task && reconciliation.nonterminal_task_count > 0) {
        heldTaskReconciliations.push({
          order_number: deliveredOrder.order_number,
          reason: reconciliation.reason,
          matching_task_count: reconciliation.matching_task_count,
          nonterminal_task_count: reconciliation.nonterminal_task_count,
        });
      }
    }

    for (const entry of taskUpdates.values()) {
      const preview = {
        fulfillment_task_id: entry.task.id,
        order_number: entry.order_number,
        from: entry.task.status || entry.task.delivery_status || null,
        to: 'delivered',
        would_set_delivered_at: Boolean(entry.payload.delivered_at),
        would_pull_delivery_photo_url: Boolean(entry.payload.delivery_photo_url),
        would_pull_delivery_drop_location: Boolean(entry.payload.delivery_drop_location),
      };

      if (dryRun) {
        wouldUpdateFulfillmentTasks.push(preview);
        continue;
      }

      await base44.asServiceRole.entities.FulfillmentTask.update(entry.task.id, entry.payload);
      updatedFulfillmentTasks.push(preview);
    }

    console.log(`[syncHubDeliveryStatuses] Done. updated=${updated} skipped=${skipped}`);
    return Response.json({
      success: true,
      dry_run: dryRun,
      sync_gate_enabled: syncGateEnabled,
      active_orders: activeOrders.length,
      updated,
      skipped,
      updatedOrders,
      held_order_delivery_completions: heldOrderDeliveryCompletions.length,
      heldOrderDeliveryCompletions,
      updated_fulfillment_tasks: updatedFulfillmentTasks.length,
      updatedFulfillmentTasks,
      would_update: wouldUpdateOrders.length,
      wouldUpdateOrders,
      would_update_fulfillment_tasks: wouldUpdateFulfillmentTasks.length,
      wouldUpdateFulfillmentTasks,
      held_task_reconciliations: heldTaskReconciliations.length,
      heldTaskReconciliations,
      eligible_orders: eligibleOrders.length,
      skipped_by_delivery_window: skippedByDeliveryWindow.length,
      skippedByDeliveryWindow,
      sync_window: {
        today: syncWindow.todayKey,
        lookback_days: syncWindow.lookbackDays,
        lookahead_days: syncWindow.lookaheadDays,
      },
    });

  } catch (error) {
    console.error('[syncHubDeliveryStatuses] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
