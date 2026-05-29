import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_FETCH_TIMEOUT_MS = 2500;
const HUB_TOTAL_BUDGET_MS = 9000;
const DEFAULT_EMAIL_LIMIT = 75;
const MAX_EMAIL_LIMIT = 250;
const DEFAULT_HUB_LIMIT = 500;
const MAX_PREVIEW_ROWS = 60;
const VALID_SCOPES = new Set(['known_customers', 'hub_all']);

async function readJsonBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return { ok: true, body: {} };
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const parsed = JSON.parse(raw);
    return { ok: true, body: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} };
  } catch {
    return { ok: false, body: null };
  }
}

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeOrderNumber(value) {
  return normalizeText(value).replace(/^#/, '').toLowerCase();
}

function safeText(value, maxLength = 180) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function orderNumber(order) {
  return normalizeText(order?.shopify_order_number || order?.order_number || order?.name).replace(/^#/, '');
}

function orderKey(order) {
  return normalizeOrderNumber(orderNumber(order));
}

function sourceChannel(order) {
  return normalizeLower(order?.source_channel || order?.source_type || '');
}

function paymentStatus(order) {
  return normalizeLower(order?.payment_status || order?.financial_status || '');
}

function productionStatus(order) {
  return normalizeLower(order?.production_status || order?.status || '');
}

function fulfillmentStatus(order) {
  return normalizeLower(order?.fulfillment_status || order?.shopify_fulfillment_status || '');
}

function fulfillmentMethod(order) {
  return normalizeLower(order?.fulfillment_method || order?.fulfillment_type || (sourceChannel(order) === 'pos' ? 'pos' : 'delivery')) || 'delivery';
}

function isSubscriptionLike(order) {
  return sourceChannel(order) === 'subscription' ||
    normalizeLower(order?.order_type) === 'subscription' ||
    normalizeLower(order?.fulfillment_mode) === 'multi_delivery' ||
    Boolean(order?.stripe_subscription_id) ||
    (Array.isArray(order?.fulfillments) && order.fulfillments.length > 1);
}

function isPosLike(order) {
  return sourceChannel(order) === 'pos' ||
    normalizeLower(order?.order_type) === 'pos' ||
    fulfillmentMethod(order) === 'pos' ||
    order?.is_pos_order === true;
}

function isCancelledOrRefunded(order) {
  const statuses = [paymentStatus(order), productionStatus(order), fulfillmentStatus(order), normalizeLower(order?.order_status)];
  return statuses.some(status => status.includes('refund') || status.includes('cancel') || status === 'voided');
}

function hasLineItems(order) {
  return Array.isArray(order?.line_items) && order.line_items.length > 0;
}

function safeLineItems(order) {
  return (Array.isArray(order?.line_items) ? order.line_items : [])
    .slice(0, 20)
    .map(item => ({
      title: safeText(item?.title || item?.name || item?.product_title, 120),
      quantity: safeNumber(item?.quantity, 0),
    }))
    .filter(item => item.title && item.quantity > 0);
}

function safeOrderSummary(order) {
  return {
    order_number: safeText(orderNumber(order), 80),
    customer_name: safeText(order?.customer_name || order?.full_name, 120),
    customer_email: safeText(order?.customer_email || order?.contact_email, 160),
    source_channel: safeText(sourceChannel(order) || (isPosLike(order) ? 'pos' : 'online'), 60),
    order_type: safeText(order?.order_type || (isSubscriptionLike(order) ? 'subscription' : (isPosLike(order) ? 'pos' : 'one_time')), 60),
    payment_status: safeText(paymentStatus(order), 60),
    production_status: safeText(productionStatus(order), 80),
    fulfillment_status: safeText(fulfillmentStatus(order), 80),
    fulfillment_method: safeText(fulfillmentMethod(order), 60),
    assigned_delivery_date: safeText(order?.assigned_delivery_date || order?.selected_delivery_date || order?.estimated_delivery_date, 40),
    production_date: safeText(order?.production_date, 40),
    line_item_count: Array.isArray(order?.line_items) ? order.line_items.length : 0,
    total_price: safeNumber(order?.total_price ?? order?.total, 0),
    items: safeLineItems(order),
  };
}

function existingNativeDiff(hubOrder, nativeOrder) {
  const fields = [];
  const checks = [
    ['customer_email', hubOrder?.customer_email, nativeOrder?.customer_email],
    ['customer_name', hubOrder?.customer_name, nativeOrder?.customer_name],
    ['payment_status', paymentStatus(hubOrder), paymentStatus(nativeOrder)],
    ['production_status', productionStatus(hubOrder), productionStatus(nativeOrder)],
    ['fulfillment_status', fulfillmentStatus(hubOrder), fulfillmentStatus(nativeOrder)],
    ['fulfillment_method', fulfillmentMethod(hubOrder), fulfillmentMethod(nativeOrder)],
    ['assigned_delivery_date', hubOrder?.assigned_delivery_date || hubOrder?.selected_delivery_date || hubOrder?.estimated_delivery_date, nativeOrder?.assigned_delivery_date || nativeOrder?.selected_delivery_date],
  ];

  for (const [field, hubValue, nativeValue] of checks) {
    if (normalizeText(hubValue) && normalizeLower(hubValue) !== normalizeLower(nativeValue)) {
      fields.push(field);
    }
  }

  const hubItems = Array.isArray(hubOrder?.line_items) ? hubOrder.line_items.length : 0;
  const nativeItems = Array.isArray(nativeOrder?.line_items) ? nativeOrder.line_items.length : 0;
  if (hubItems > 0 && hubItems !== nativeItems) fields.push('line_items');

  return fields;
}

function classifyHubOrder({ hubOrder, nativeOrder, localOrder }) {
  if (!orderKey(hubOrder)) {
    return { action: 'blocked', reason: 'missing_order_number' };
  }

  if (isSubscriptionLike(hubOrder)) {
    return { action: 'blocked', reason: 'subscription_future_compatible_hold' };
  }

  if (!hasLineItems(hubOrder)) {
    return { action: 'blocked', reason: 'missing_line_items' };
  }

  if (nativeOrder) {
    const diffFields = existingNativeDiff(hubOrder, nativeOrder);
    return diffFields.length > 0
      ? { action: 'would_update_native', reason: 'native_record_differs', diff_fields: diffFields }
      : { action: 'already_native', reason: 'native_record_present' };
  }

  if (isCancelledOrRefunded(hubOrder)) {
    return { action: 'would_create_archived_native', reason: 'historical_cancelled_or_refunded' };
  }

  if (localOrder) {
    return { action: 'would_create_native_from_hub', reason: 'customer_order_exists_native_operational_missing' };
  }

  return { action: 'would_create_native_from_hub', reason: isPosLike(hubOrder) ? 'historical_pos_order_missing_native' : 'historical_one_time_order_missing_native' };
}

function buildPreviewRow({ hubOrder, nativeOrder, localOrder }) {
  const classification = classifyHubOrder({ hubOrder, nativeOrder, localOrder });
  return {
    action: classification.action,
    reason: classification.reason,
    diff_fields: classification.diff_fields || [],
    order: safeOrderSummary(hubOrder),
    existing: {
      native_shopify_order: Boolean(nativeOrder),
      customer_app_order: Boolean(localOrder),
      native_shopify_order_id: nativeOrder?.id || null,
      customer_app_order_id: localOrder?.id || null,
    },
  };
}

function indexByOrderNumber(records, numberFieldNames) {
  const index = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    for (const field of numberFieldNames) {
      const key = normalizeOrderNumber(record?.[field]);
      if (key && !index.has(key)) {
        index.set(key, record);
      }
    }
  }
  return index;
}

function collectKnownEmails({ profiles, orders, nativeOrders }) {
  const emails = new Set();
  const add = value => {
    const email = normalizeLower(value);
    if (email && email.includes('@')) emails.add(email);
  };
  for (const profile of profiles || []) {
    add(profile.customer_email);
    add(profile.contact_email);
  }
  for (const order of orders || []) add(order.customer_email);
  for (const order of nativeOrders || []) {
    add(order.customer_email);
    add(order.contact_email);
  }
  return Array.from(emails);
}

async function fetchHubOrders({ hubBase, hubSecret, email, since }) {
  const url = new URL(`${hubBase}/functions/getOrderUpdatesForCustomerApp`);
  if (email) url.searchParams.set('email', email);
  if (since) url.searchParams.set('since', since);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUB_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${hubSecret}` },
      signal: controller.signal,
    });
    if (!res.ok) {
      return { ok: false, status: res.status, orders: [] };
    }
    const data = await res.json();
    return { ok: true, status: res.status, orders: Array.isArray(data?.orders) ? data.orders : [] };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error_code: 'unauthorized' }, { status: 401 });
    }
    if (!user) return Response.json({ success: false, error_code: 'unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ success: false, error_code: 'forbidden' }, { status: 403 });

    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, error_code: 'malformed_json' }, { status: 400 });
    }

    const body = parsed.body || {};
    const scope = VALID_SCOPES.has(body.scope) ? body.scope : 'known_customers';
    const emailLimit = normalizeLimit(body.email_limit, DEFAULT_EMAIL_LIMIT, MAX_EMAIL_LIMIT);
    const hubLimit = normalizeLimit(body.hub_limit, DEFAULT_HUB_LIMIT, DEFAULT_HUB_LIMIT);
    const since = safeText(body.since, 40);

    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const hubBase = hubApiUrl ? hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '') : null;

    if (!hubBase || !hubSecret) {
      return Response.json({
        success: false,
        dry_run: true,
        error_code: 'hub_config_missing',
        message: 'Hub API URL or sync secret is not configured.',
        writes_performed: false,
      }, { status: 200 });
    }

    const [nativeOrders, localOrders, profiles] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500).catch(() => []),
      base44.asServiceRole.entities.Order.list('-created_date', 500).catch(() => []),
      base44.asServiceRole.entities.UserProfile.list('-created_date', 500).catch(() => []),
    ]);

    const nativeByNumber = indexByOrderNumber(nativeOrders, ['shopify_order_number', 'order_number']);
    const localByNumber = indexByOrderNumber(localOrders, ['order_number', 'shopify_order_number']);
    const hubByNumber = new Map();
    const warnings = [];
    const fetchStats = {
      scope,
      known_emails_scanned: 0,
      hub_fetches_attempted: 0,
      hub_fetches_failed: 0,
      hub_fetch_truncated: false,
    };

    const startedAt = Date.now();

    if (scope === 'hub_all') {
      fetchStats.hub_fetches_attempted += 1;
      const result = await fetchHubOrders({ hubBase, hubSecret, since });
      if (!result.ok) {
        fetchStats.hub_fetches_failed += 1;
        warnings.push(`hub_all_fetch_failed_${result.status}`);
      }
      for (const order of result.orders.slice(0, hubLimit)) {
        const key = orderKey(order);
        if (key && !hubByNumber.has(key)) hubByNumber.set(key, order);
      }
    } else {
      const emails = collectKnownEmails({ profiles, orders: localOrders, nativeOrders }).slice(0, emailLimit);
      fetchStats.known_emails_scanned = emails.length;
      if (emails.length >= emailLimit) warnings.push('known_email_scan_limited');

      for (const email of emails) {
        if (Date.now() - startedAt > HUB_TOTAL_BUDGET_MS) {
          fetchStats.hub_fetch_truncated = true;
          warnings.push('hub_fetch_budget_exceeded');
          break;
        }
        fetchStats.hub_fetches_attempted += 1;
        try {
          const result = await fetchHubOrders({ hubBase, hubSecret, email, since });
          if (!result.ok) {
            fetchStats.hub_fetches_failed += 1;
            continue;
          }
          for (const order of result.orders) {
            const key = orderKey(order);
            if (key && !hubByNumber.has(key)) hubByNumber.set(key, order);
          }
        } catch (error) {
          fetchStats.hub_fetches_failed += 1;
          warnings.push(error?.name === 'AbortError' ? 'hub_fetch_timeout' : 'hub_fetch_failed');
        }
      }
    }

    const rows = Array.from(hubByNumber.values()).map(hubOrder => {
      const key = orderKey(hubOrder);
      return buildPreviewRow({
        hubOrder,
        nativeOrder: nativeByNumber.get(key),
        localOrder: localByNumber.get(key),
      });
    });

    const countsByAction = {};
    const countsByReason = {};
    for (const row of rows) {
      countsByAction[row.action] = (countsByAction[row.action] || 0) + 1;
      countsByReason[row.reason] = (countsByReason[row.reason] || 0) + 1;
    }

    const createOrUpdateCount =
      (countsByAction.would_create_native_from_hub || 0) +
      (countsByAction.would_create_archived_native || 0) +
      (countsByAction.would_update_native || 0);

    return Response.json({
      success: true,
      dry_run: true,
      preview_only: true,
      writes_performed: false,
      generated_at: new Date().toISOString(),
      scope,
      fetch_stats: fetchStats,
      summary: {
        hub_orders_scanned: rows.length,
        native_shopify_orders_seen: Array.isArray(nativeOrders) ? nativeOrders.length : 0,
        customer_app_orders_seen: Array.isArray(localOrders) ? localOrders.length : 0,
        candidate_create_or_update_count: createOrUpdateCount,
        blocked_count: countsByAction.blocked || 0,
        already_native_count: countsByAction.already_native || 0,
        counts_by_action: countsByAction,
        counts_by_reason: countsByReason,
      },
      preview_rows: rows
        .filter(row => row.action !== 'already_native')
        .slice(0, MAX_PREVIEW_ROWS),
      live_backfill_allowed: false,
      live_backfill_requires: [
        'separate owner approval',
        'exact scope',
        'request_id',
        'idempotency',
        'before_after_snapshots',
        'no customer notifications',
        'no provider calls',
      ],
      warnings,
      blocked_live_actions: [
        'no Customer App Order writes',
        'no ShopifyOrder writes',
        'no FulfillmentTask writes',
        'no OrderSyncLog writes',
        'no OrderReviewQueue writes',
        'no notifications',
        'no Stripe/Shopify/provider calls',
        'no inventory or purchase order mutation',
      ],
    });
  } catch (error) {
    console.error('[previewAdminHistoricalHubBackfill] failed safely:', error?.message || 'unknown error');
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'historical_backfill_preview_failed',
      message: 'Historical backfill preview failed safely; no records were changed.',
      writes_performed: false,
    }, { status: 500 });
  }
});
