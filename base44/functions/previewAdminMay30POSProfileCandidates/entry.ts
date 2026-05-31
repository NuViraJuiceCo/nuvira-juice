import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_DATE = '2026-05-30';
const MAX_RANGE_DAYS = 31;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function safeText(value, maxLength = 160) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok)_[A-Za-z0-9]{8,}\b/g, '[redacted]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function parseIsoDate(value, fieldName, fallback = null) {
  const text = normalizeText(value) || fallback;
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }
  return text;
}

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function dateInRange(value, from, to) {
  const date = safeText(value, 40)?.slice(0, 10);
  if (!date) return true;
  return date >= from && date <= to;
}

function safeOrderNumber(order) {
  return safeText(order?.shopify_order_number || order?.order_number || order?.name, 80)?.replace(/^#/, '') || null;
}

function normalizeEmail(value) {
  return normalizeLower(value);
}

function emailLooksUsable(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isPlaceholderEmail(email) {
  if (!email) return false;
  return email.endsWith('@nuvira.local') ||
    email.endsWith('@example.test') ||
    email.endsWith('@example.com') ||
    email.startsWith('pos-') ||
    email.includes('placeholder') ||
    email.includes('walkin') ||
    email.includes('walk-in');
}

function normalizeName(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function isPlaceholderName(name) {
  const normalized = normalizeLower(name);
  return !normalized ||
    normalized === 'pos customer' ||
    normalized === 'walk-in customer' ||
    normalized === 'walk in customer' ||
    normalized === 'customer' ||
    normalized === 'guest';
}

function splitName(value) {
  const name = normalizeName(value);
  if (isPlaceholderName(name)) return null;
  const parts = name.split(' ').filter(Boolean);
  if (parts.length < 2) return null;
  return {
    first_name: safeText(parts[0], 80),
    last_name: safeText(parts.slice(1).join(' '), 100),
    display_name: safeText(name, 140),
  };
}

function sanitizeOrder(order) {
  return {
    id: safeText(order?.id, 80),
    order_number: safeOrderNumber(order),
    customer_name: safeText(order?.customer_name || order?.full_name, 140),
    customer_email: safeText(order?.customer_email || order?.contact_email, 180),
    payment_status: safeText(order?.payment_status || order?.financial_status, 60),
    fulfillment_status: safeText(order?.fulfillment_status || order?.shopify_fulfillment_status, 60),
    source_channel: safeText(order?.source_channel, 60),
    source_type: safeText(order?.source_type, 60),
    order_type: safeText(order?.order_type, 60),
    fulfillment_method: safeText(order?.fulfillment_method || order?.fulfillment_type, 60),
    customer_order_date: safeText(order?.customer_order_date || order?.created_at || order?.created_date, 80),
    created_date: safeText(order?.created_date || order?.created_at, 80),
    total_price: order?.total_price === null || order?.total_price === undefined ? null : safeNumber(order.total_price),
  };
}

function isPosLike(order) {
  return normalizeLower(order?.source_channel) === 'pos' ||
    normalizeLower(order?.source_type) === 'shopify_pos' ||
    normalizeLower(order?.order_type) === 'pos' ||
    normalizeLower(order?.fulfillment_method || order?.fulfillment_type) === 'pos' ||
    order?.is_pos_order === true;
}

function sanitizeNativePosOrder(order) {
  return sanitizeOrder({
    ...order,
    order_number: order.shopify_order_number || order.order_number,
    source_channel: order.source_channel || 'pos',
    source_type: order.source_type || 'shopify_pos',
    order_type: order.order_type || 'pos',
    fulfillment_method: order.fulfillment_method || 'pos',
  });
}

async function fetchHubJson(url, headers, warningPrefix) {
  try {
    const response = await fetch(url, { method: 'GET', headers });
    if (!response.ok) {
      console.warn(`[previewAdminMay30POSProfileCandidates] ${warningPrefix}: ${response.status}`);
      return { ok: false, warning: `${warningPrefix}:${response.status}`, data: null };
    }
    const data = await response.json().catch(() => null);
    return { ok: true, warning: null, data };
  } catch {
    console.warn(`[previewAdminMay30POSProfileCandidates] ${warningPrefix}: fetch_failed`);
    return { ok: false, warning: `${warningPrefix}:fetch_failed`, data: null };
  }
}

async function fetchPosOrders({ base44, dateFrom, dateTo, limit }) {
  const warnings = [];
  const nativeRaw = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', MAX_LIMIT).catch(error => {
    warnings.push('native_pos_records_unavailable');
    console.warn('[previewAdminMay30POSProfileCandidates] Native POS lookup unavailable:', error?.message || 'unknown');
    return [];
  });
  const nativeOrders = nativeRaw
    .filter(isPosLike)
    .filter(order => dateInRange(order.customer_order_date || order.created_date || order.last_sync_at, dateFrom, dateTo))
    .map(sanitizeNativePosOrder);

  let hubOrders = [];
  if (HUB_API_URL && CUSTOMER_APP_SYNC_SECRET) {
    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({ limit: String(limit), date_from: dateFrom, date_to: dateTo });
    const hubResult = await fetchHubJson(
      `${hubBase}/functions/getPOSOrdersForCustomerApp?${params.toString()}`,
      { Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}` },
      'Hub POS summary unavailable',
    );
    if (hubResult.ok && hubResult.data?.success === true && Array.isArray(hubResult.data.orders)) {
      hubOrders = hubResult.data.orders.map(sanitizeOrder);
    } else if (hubResult.warning) {
      warnings.push(hubResult.warning);
    } else {
      warnings.push('hub_pos_response_malformed');
    }
  } else {
    warnings.push('hub_pos_env_missing');
  }

  const byOrder = new Map();
  for (const order of hubOrders) {
    const key = normalizeLower(order.order_number || order.id);
    if (key) byOrder.set(key, { ...order, source_record: 'hub' });
  }
  for (const order of nativeOrders) {
    const key = normalizeLower(order.order_number || order.id);
    if (key && !byOrder.has(key)) byOrder.set(key, { ...order, source_record: 'native' });
  }

  return {
    orders: Array.from(byOrder.values()).slice(0, limit),
    warnings,
    source_counts: {
      hub: hubOrders.length,
      native: nativeOrders.length,
    },
  };
}

async function findExistingProfile(base44, email) {
  const [byCustomerEmail, byContactEmail] = await Promise.all([
    base44.asServiceRole.entities.UserProfile.filter({ customer_email: email }, '-created_date', 5).catch(() => []),
    base44.asServiceRole.entities.UserProfile.filter({ contact_email: email }, '-created_date', 5).catch(() => []),
  ]);
  const matches = [...(Array.isArray(byCustomerEmail) ? byCustomerEmail : []), ...(Array.isArray(byContactEmail) ? byContactEmail : [])];
  const byId = new Map();
  for (const profile of matches) {
    if (profile?.id) byId.set(profile.id, profile);
  }
  return Array.from(byId.values());
}

function buildEmailGroups(orders) {
  const groups = new Map();
  const blockedOrders = [];

  for (const order of orders) {
    const email = normalizeEmail(order.customer_email);
    const orderNumber = order.order_number || order.id || 'unknown';
    if (!email) {
      blockedOrders.push({
        order_number: safeText(orderNumber, 80),
        customer_name: order.customer_name || null,
        blocker: 'missing_customer_email',
      });
      continue;
    }
    if (!emailLooksUsable(email)) {
      blockedOrders.push({
        order_number: safeText(orderNumber, 80),
        customer_email: safeText(email, 180),
        customer_name: order.customer_name || null,
        blocker: 'invalid_customer_email',
      });
      continue;
    }
    if (isPlaceholderEmail(email)) {
      blockedOrders.push({
        order_number: safeText(orderNumber, 80),
        customer_email: safeText(email, 180),
        customer_name: order.customer_name || null,
        blocker: 'placeholder_customer_email',
      });
      continue;
    }

    const existing = groups.get(email) || {
      customer_email: email,
      orders: [],
      names: new Set(),
      total_spend: 0,
      latest_order_date: null,
    };
    existing.orders.push({
      order_number: safeText(orderNumber, 80),
      total_price: order.total_price,
      source_record: order.source_record,
    });
    if (order.customer_name) existing.names.add(normalizeName(order.customer_name));
    existing.total_spend += safeNumber(order.total_price);
    const orderDate = safeText(order.customer_order_date || order.created_date, 80);
    if (orderDate && (!existing.latest_order_date || orderDate > existing.latest_order_date)) {
      existing.latest_order_date = orderDate;
    }
    groups.set(email, existing);
  }

  return { groups: Array.from(groups.values()), blockedOrders };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
    if (!user) return Response.json({ success: false, error: 'unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ success: false, error: 'forbidden' }, { status: 403 });
    if (req.method !== 'POST') return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });

    const body = await readJsonBody(req);
    if (body === null) return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });

    let dateFrom;
    let dateTo;
    let limit;
    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from', DEFAULT_DATE);
      dateTo = parseIsoDate(body.date_to, 'date_to', DEFAULT_DATE);
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ success: false, error: error.message }, { status: 400 });
    }

    if (dateTo < dateFrom) {
      return Response.json({ success: false, error: 'date_to must be on or after date_from' }, { status: 400 });
    }
    if (daysInclusive(dateFrom, dateTo) > MAX_RANGE_DAYS) {
      return Response.json({
        success: false,
        error: `Date range must be ${MAX_RANGE_DAYS} days or fewer`,
        max_range_days: MAX_RANGE_DAYS,
      }, { status: 400 });
    }

    const { orders, warnings, source_counts: sourceCounts } = await fetchPosOrders({ base44, dateFrom, dateTo, limit });
    const { groups, blockedOrders } = buildEmailGroups(orders);
    const candidates = [];

    for (const group of groups) {
      const existingProfiles = await findExistingProfile(base44, group.customer_email);
      const names = Array.from(group.names).filter(Boolean);
      const selectedName = names[0] || null;
      const split = splitName(selectedName);
      const blockers = [];
      const rowWarnings = [];

      if (!split) blockers.push('missing_customer_name');
      if (names.length > 1) rowWarnings.push('multiple_names_for_email');
      if (existingProfiles.length > 1) rowWarnings.push('multiple_existing_profiles_for_email');

      const alreadyProfile = existingProfiles.length > 0;
      candidates.push({
        customer_email: safeText(group.customer_email, 180),
        customer_name: safeText(selectedName, 140),
        first_name: split?.first_name || null,
        last_name: split?.last_name || null,
        profile_status: alreadyProfile
          ? 'already_profile'
          : blockers.length > 0
            ? 'blocked'
            : 'would_create_starter_profile',
        existing_profile_id: alreadyProfile ? safeText(existingProfiles[0].id, 80) : null,
        would_create_starter_profile: !alreadyProfile && blockers.length === 0,
        order_numbers: group.orders.map(order => order.order_number).filter(Boolean).slice(0, 12),
        order_count: group.orders.length,
        total_spend: Number(group.total_spend.toFixed(2)),
        latest_order_date: group.latest_order_date,
        blockers,
        warnings: rowWarnings,
      });
    }

    const wouldCreateCount = candidates.filter(candidate => candidate.would_create_starter_profile).length;
    const alreadyProfileCount = candidates.filter(candidate => candidate.profile_status === 'already_profile').length;
    const blockedCandidateCount = candidates.filter(candidate => candidate.profile_status === 'blocked').length;

    return Response.json({
      success: true,
      dry_run: true,
      source: 'preview_admin_may30_pos_profile_candidates',
      date_from: dateFrom,
      date_to: dateTo,
      generated_at: new Date().toISOString(),
      orders_scanned: orders.length,
      source_counts: sourceCounts,
      candidate_count: candidates.length,
      would_create_starter_profile_count: wouldCreateCount,
      already_profile_count: alreadyProfileCount,
      blocked_candidate_count: blockedCandidateCount,
      blocked_order_count: blockedOrders.length,
      live_backfill_allowed: false,
      recommended_next_step: wouldCreateCount > 0
        ? 'Review candidate rows, then run a separately gated starter-profile backfill if approved.'
        : 'No starter-profile backfill candidates are currently eligible.',
      warnings,
      candidates,
      blocked_orders: blockedOrders.slice(0, 40),
      response_safety: {
        customer_context: 'admin_only_limited_name_email_order_numbers',
        raw_payloads_returned: false,
        live_records_mutated: false,
        notifications_sent: false,
      },
    });
  } catch (error) {
    console.error('[previewAdminMay30POSProfileCandidates] Error:', error?.message || 'unknown');
    return Response.json({
      success: false,
      error: 'Unable to preview POS profile candidates',
    }, { status: 500 });
  }
});
