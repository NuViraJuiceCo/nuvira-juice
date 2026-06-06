import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MAX_TASK_SUMMARY = 5;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '');
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
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

function uniqueById(rows) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = row?.id || JSON.stringify(row);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function getPreviewInternalSecret() {
  return Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET') ||
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET') ||
    Deno.env.get('HUB_SYNC_SECRET') ||
    '';
}

function getNativeSafeSyncPreviewInvokeOptions() {
  return {
    headers: {
      'x-internal-secret': getPreviewInternalSecret(),
    },
  };
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(raw) };
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
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const bodySecret = normalizeText(body?.internal_secret || body?._internal_secret);
  const headerSecret = normalizeText(req.headers.get('x-internal-secret'));
  const expectedSecret = getPreviewInternalSecret();
  const providedSecret = headerSecret || bearer || bodySecret;

  if (providedSecret) {
    return expectedSecret && providedSecret === expectedSecret
      ? { ok: true, actor_type: 'system', actor_role: 'service' }
      : { ok: false, response: unauthorized() };
  }

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: unauthorized() };
    if (user.role !== 'admin') return { ok: false, response: forbidden() };
    return { ok: true, actor_type: 'admin', actor_role: 'admin' };
  } catch {
    return { ok: false, response: unauthorized() };
  }
}

function getLookup(body) {
  const orderId = normalizeText(body?.order_id || body?.customer_app_order_id || body?.base44_order_id);
  const nativeOrderId = normalizeText(body?.native_order_id || body?.shopify_order_record_id);
  const shopifyOrderId = normalizeText(body?.shopify_order_id);
  const orderNumber = normalizeOrderNumber(
    body?.order_number || body?.shopify_order_number || body?.order || body?.number,
  );
  return { orderId, nativeOrderId, shopifyOrderId, orderNumber };
}

async function findCustomerOrder(base44, lookup) {
  const candidates = [];
  if (lookup.orderId) candidates.push({ id: lookup.orderId });
  if (lookup.orderNumber) candidates.push({ order_number: lookup.orderNumber });

  for (const filter of candidates) {
    const rows = await base44.asServiceRole.entities.Order.filter(filter, '-created_date', 5).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeShopifyOrder(base44, lookup, customerOrder) {
  const orderNumber = lookup.orderNumber || normalizeOrderNumber(customerOrder?.order_number);
  const candidates = [];
  if (lookup.nativeOrderId) candidates.push({ id: lookup.nativeOrderId });
  if (lookup.shopifyOrderId) candidates.push({ shopify_order_id: lookup.shopifyOrderId });
  if (customerOrder?.id) candidates.push({ base44_order_id: customerOrder.id });
  if (lookup.orderId) candidates.push({ base44_order_id: lookup.orderId });
  if (orderNumber) candidates.push({ shopify_order_number: orderNumber });

  for (const filter of candidates) {
    const rows = await base44.asServiceRole.entities.ShopifyOrder.filter(filter, '-created_date', 5).catch(() => []);
    if (Array.isArray(rows) && rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeFulfillmentTasks(base44, nativeOrder, customerOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeOrderNumber(customerOrder?.order_number || nativeOrder?.shopify_order_number);
  const queries = [];
  if (nativeOrder?.id) {
    queries.push({ order_id: nativeOrder.id });
    queries.push({ shopify_order_id: nativeOrder.id });
  }
  if (orderNumber) {
    queries.push({ order_number: orderNumber });
    queries.push({ shopify_order_number: orderNumber });
  }
  if (customerOrder?.id) queries.push({ order_id: customerOrder.id });

  const results = [];
  for (const filter of queries) {
    const rows = await base44.asServiceRole.entities.FulfillmentTask.filter(filter, '-created_date', 10).catch(() => []);
    results.push(...(Array.isArray(rows) ? rows : []));
  }
  return uniqueById(results);
}

function normalizePaymentStatus(order) {
  const status = normalizeLower(order?.payment_status || order?.financial_status);
  if (status) return status;
  if (order?.payment_captured === true) return 'paid';
  return 'pending';
}

function hasCompleteDeliveryAddress(order) {
  if (normalizeLower(order?.fulfillment_type || order?.fulfillment_method) !== 'delivery') return true;
  return Boolean(
    normalizeText(order?.address_line1 || order?.delivery_address?.address_line1 || order?.delivery_address?.address1 || order?.delivery_address) &&
    normalizeText(order?.address_city || order?.delivery_address?.city) &&
    normalizeText(order?.address_state || order?.delivery_address?.state || order?.delivery_address?.province) &&
    normalizeText(order?.address_postal_code || order?.delivery_address?.postal_code || order?.delivery_address?.zip)
  );
}

function sanitizeLineItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 60).map((item) => compactObject({
    shopify_line_item_id: normalizeText(item?.shopify_line_item_id || item?.id || item?.product_id),
    title: normalizeText(item?.title || item?.name || item?.product_title) || 'Item',
    variant_title: normalizeText(item?.variant_title),
    sku: normalizeText(item?.sku),
    quantity: safeNumber(item?.quantity, 0),
    price: item?.price === undefined || item?.price === null ? null : safeNumber(item.price, 0),
  })).filter((item) => item.title && item.quantity > 0);
}

function firstFulfillmentDate(order) {
  const firstFulfillment = Array.isArray(order?.fulfillments)
    ? order.fulfillments.find((fulfillment) => (
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
    order?.assigned_delivery_date ||
    order?.estimated_delivery_date ||
    order?.requested_delivery_date ||
    order?.delivery_date ||
    order?.selected_delivery_date ||
    null;
}

function buildIncomingPayload(customerOrder) {
  const fulfillmentMethod = normalizeLower(customerOrder?.fulfillment_type || customerOrder?.fulfillment_method) || 'delivery';
  const paymentStatus = normalizePaymentStatus(customerOrder);
  const orderNumber = normalizeOrderNumber(customerOrder?.order_number || customerOrder?.shopify_order_number);
  const deliveryDate = firstFulfillmentDate(customerOrder);

  return compactObject({
    base44_order_id: customerOrder?.id,
    shopify_order_number: orderNumber,
    customer_name: normalizeText(customerOrder?.customer_name),
    customer_email: normalizeText(customerOrder?.customer_email),
    source_channel: 'online',
    source_type: 'customer_app_one_time',
    order_type: 'one_time',
    fulfillment_method: fulfillmentMethod,
    payment_status: paymentStatus,
    line_items: sanitizeLineItems(customerOrder?.items || customerOrder?.line_items),
    subtotal: customerOrder?.subtotal === undefined ? null : safeNumber(customerOrder.subtotal, 0),
    total_price: safeNumber(customerOrder?.total ?? customerOrder?.total_price, 0),
    delivery_fee: customerOrder?.delivery_fee === undefined ? null : safeNumber(customerOrder.delivery_fee, 0),
    address_line1: normalizeText(customerOrder?.address_line1),
    address_line2: normalizeText(customerOrder?.address_line2),
    address_city: normalizeText(customerOrder?.address_city),
    address_state: normalizeText(customerOrder?.address_state),
    address_postal_code: normalizeText(customerOrder?.address_postal_code),
    address_country: normalizeText(customerOrder?.address_country || 'US'),
    assigned_delivery_date: deliveryDate,
    selected_delivery_date: deliveryDate,
    production_date: customerOrder?.production_date || customerOrder?.assigned_production_day || null,
    delivery_window_label: normalizeText(customerOrder?.delivery_window_label),
    stripe_checkout_session_id: normalizeText(customerOrder?.stripe_checkout_session_id),
    stripe_payment_intent_id: normalizeText(customerOrder?.stripe_payment_intent_id),
    sync_status: 'live_read_parity_preview',
    last_sync_at: new Date().toISOString(),
  });
}

function summarizePlan(plan) {
  const proposed = plan?.proposed_order_state || {};
  return {
    success: plan?.success === true,
    action: plan?.order_sync_log_draft?.action || plan?.action || plan?.response_status || null,
    error_code: plan?.error_code || plan?.order_sync_log_draft?.error_code || null,
    would_create_order: Boolean(plan?.would_create_order),
    would_update_order: Boolean(plan?.would_update_order),
    would_reject: Boolean(plan?.would_reject),
    would_quarantine: Boolean(plan?.would_quarantine),
    accepted_fields: plan?.accepted_fields && typeof plan.accepted_fields === 'object'
      ? Object.keys(plan.accepted_fields).sort()
      : [],
    rejected_fields: plan?.rejected_fields && typeof plan.rejected_fields === 'object'
      ? Object.keys(plan.rejected_fields).sort()
      : [],
    review_incident_type: plan?.order_review_queue_draft?.incident_type || null,
    proposed_order_number: proposed.shopify_order_number || null,
    proposed_payment_status: proposed.payment_status || null,
    proposed_source_channel: proposed.source_channel || null,
    proposed_source_type: proposed.source_type || null,
    proposed_order_type: proposed.order_type || null,
    proposed_production_status: proposed.production_status || null,
    proposed_fulfillment_status: proposed.fulfillment_status || null,
    proposed_line_item_count: Array.isArray(proposed.line_items) ? proposed.line_items.length : 0,
  };
}

function summarizeTask(task) {
  return {
    id: task?.id || null,
    status: task?.status || null,
    delivery_date: task?.delivery_date || task?.assigned_delivery_date || null,
    production_date: task?.production_date || null,
    source_type: task?.source_type || null,
    schedule_source: task?.schedule_source || null,
  };
}

function buildReadiness({ customerOrder, nativeOrder, tasks, planner }) {
  const blockers = [];
  const warnings = [];
  const paymentStatus = normalizePaymentStatus(customerOrder);
  const lineItems = sanitizeLineItems(customerOrder?.items || customerOrder?.line_items);
  const addressComplete = hasCompleteDeliveryAddress(customerOrder || {});
  const fulfillmentMethod = normalizeLower(customerOrder?.fulfillment_type || customerOrder?.fulfillment_method) || null;
  const paid = paymentStatus === 'paid' || customerOrder?.payment_captured === true;
  const delivery = fulfillmentMethod === 'delivery';

  if (!customerOrder) blockers.push('customer_app_order_missing');
  if (customerOrder && !paid) warnings.push('payment_not_paid_do_not_fulfill');
  if (customerOrder && lineItems.length === 0) blockers.push('line_items_missing');
  if (customerOrder && delivery && !addressComplete) blockers.push('delivery_address_incomplete');
  if (planner?.would_reject) blockers.push(planner?.error_code || 'native_planner_rejected');

  const rejectedFields = planner?.rejected_fields && typeof planner.rejected_fields === 'object'
    ? Object.keys(planner.rejected_fields)
    : [];
  if (rejectedFields.includes('base44_order_id')) {
    if (!nativeOrder && planner?.would_create_order) blockers.push('base44_order_id_linkage_rejected_for_native_create');
    else warnings.push('base44_order_id_linkage_rejected_by_planner');
  }

  if (customerOrder && paid && lineItems.length > 0 && (!delivery || addressComplete)) {
    if (nativeOrder && planner?.would_create_order) blockers.push('duplicate_native_create_risk');
    if (!nativeOrder && !planner?.would_create_order) blockers.push('native_missing_and_planner_not_create');
    if (nativeOrder && tasks.length === 0 && delivery) warnings.push('native_fulfillment_task_missing_or_not_matched');
  }

  let classification = 'not_ready';
  if (blockers.length === 0) {
    if (!customerOrder) classification = 'not_ready';
    else if (!paid) classification = 'hold_payment_pending';
    else if (!nativeOrder && planner?.would_create_order) classification = 'native_create_ready_dry_run';
    else if (nativeOrder && (planner?.would_update_order || planner?.order_sync_log_draft?.action === 'skipped' || planner?.action === 'duplicate_event')) classification = 'native_update_or_dedupe_ready_dry_run';
    else classification = 'review_required';
  }

  return {
    classification,
    blockers,
    warnings,
    hub_retirement_relevance: 'native_order_write_gateway_readiness',
    next_action: blockers.length > 0
      ? 'review_blockers_before_native_writer_pilot'
      : 'eligible_for_shadow_parity_monitoring_not_live_write',
  };
}

async function runPlanner({ base44, source, eventType, idempotencyKey, incomingPayload, nativeOrder }) {
  const response = await base44.asServiceRole.functions.invoke('previewNativeSafeSyncOrderUpdate', {
    mode: 'dry_run',
    fixture_id: 'g26b_live_order_parity_preview',
    source,
    event_type: eventType,
    idempotency_key: idempotencyKey,
    incoming_payload: incomingPayload,
    starting_order: nativeOrder || null,
  }, getNativeSafeSyncPreviewInvokeOptions());
  return response?.data || response;
}

function deriveSource(body, nativeOrder) {
  if (body?.source) return normalizeText(body.source);
  if (normalizeLower(nativeOrder?.source_type) === 'shopify_pos' || normalizeLower(nativeOrder?.source_channel) === 'pos') return 'admin';
  return 'customer_app';
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

    const lookup = getLookup(body);
    if (!lookup.orderId && !lookup.orderNumber && !lookup.nativeOrderId && !lookup.shopifyOrderId) {
      return Response.json({
        success: false,
        dry_run: true,
        error_code: 'missing_order_lookup',
        message: 'Provide order_id, order_number, native_order_id, or shopify_order_id.',
        writes_performed: false,
      }, { status: 400 });
    }

    const customerOrder = await findCustomerOrder(base44, lookup);
    const nativeOrder = await findNativeShopifyOrder(base44, lookup, customerOrder);
    const tasks = await findNativeFulfillmentTasks(base44, nativeOrder, customerOrder, lookup);

    if (!customerOrder) {
      return Response.json({
        success: true,
        dry_run: true,
        parity_status: 'review_required',
        writes_performed: false,
        native_writer_enabled: false,
        hub_remains_live_writer: true,
        target_summary: {
          lookup_order_number: lookup.orderNumber || null,
          customer_app_order_present: false,
          native_shopify_order_present: Boolean(nativeOrder),
          native_shopify_order_id: nativeOrder?.id || null,
          native_fulfillment_task_count: tasks.length,
          native_fulfillment_tasks: tasks.slice(0, MAX_TASK_SUMMARY).map(summarizeTask),
        },
        readiness: buildReadiness({ customerOrder: null, nativeOrder, tasks, planner: null }),
        safety: {
          dry_run_only: true,
          writes_performed: false,
          provider_calls_performed: false,
          hub_api_calls_performed: false,
          native_writer_enabled: false,
        },
      });
    }

    const eventType = normalizeText(body?.event_type || body?.event || 'order.created');
    const source = deriveSource(body, nativeOrder);
    const incomingPayload = buildIncomingPayload(customerOrder);
    const idempotencyKey = normalizeText(body?.idempotency_key) ||
      `g26b:live-read:${source}:${eventType}:${customerOrder.id || incomingPayload.shopify_order_number || lookup.orderNumber}`;
    const planner = await runPlanner({ base44, source, eventType, idempotencyKey, incomingPayload, nativeOrder });
    const readiness = buildReadiness({ customerOrder, nativeOrder, tasks, planner });

    return Response.json({
      success: readiness.blockers.length === 0,
      dry_run: true,
      parity_status: readiness.blockers.length === 0 ? 'pass' : 'review_required',
      function_name: 'previewNativeSafeSyncLiveOrderParity',
      writes_performed: false,
      native_writer_enabled: false,
      hub_remains_live_writer: true,
      target_summary: {
        order_number: normalizeOrderNumber(customerOrder.order_number || nativeOrder?.shopify_order_number) || null,
        customer_app_order_id: customerOrder.id || null,
        customer_app_order_present: true,
        customer_app_status: customerOrder.status || null,
        payment_status: normalizePaymentStatus(customerOrder),
        payment_captured: customerOrder.payment_captured === true,
        fulfillment_method: normalizeLower(customerOrder.fulfillment_type || customerOrder.fulfillment_method) || null,
        line_item_count: sanitizeLineItems(customerOrder.items || customerOrder.line_items).length,
        address_complete: hasCompleteDeliveryAddress(customerOrder),
        native_shopify_order_present: Boolean(nativeOrder),
        native_shopify_order_id: nativeOrder?.id || null,
        native_sync_status: nativeOrder?.sync_status || null,
        native_source_type: nativeOrder?.source_type || null,
        native_order_type: nativeOrder?.order_type || null,
        native_fulfillment_task_count: tasks.length,
        native_fulfillment_tasks: tasks.slice(0, MAX_TASK_SUMMARY).map(summarizeTask),
      },
      planner_summary: summarizePlan(planner),
      readiness,
      safety: {
        dry_run_only: true,
        writes_performed: false,
        provider_calls_performed: false,
        hub_api_calls_performed: false,
        native_writer_enabled: false,
      },
    });
  } catch (error) {
    console.error(`[previewNativeSafeSyncLiveOrderParity] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'live_order_parity_preview_failed',
      message: 'Native safeSync live-order parity preview failed safely.',
      writes_performed: false,
      native_writer_enabled: false,
    }, { status: 500 });
  }
});
