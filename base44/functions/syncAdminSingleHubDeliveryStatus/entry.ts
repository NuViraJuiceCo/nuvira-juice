import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const FUNCTION_NAME = 'syncAdminSingleHubDeliveryStatus';
const HUB_GUARD_UNAVAILABLE_WARNING = 'hub_guard_fields_unavailable: Live sync is blocked because Hub sync/exclusion guard fields are unavailable from the scoped Hub response.';
const APPROVED_TEST_EMAILS = new Set(['delivered-test@nuvirajuice.com']);
const APPROVED_TEST_ORDER_NUMBER = 'NV-TEST-G15E-DELIVERED';
const APPROVED_TEST_ORDER_PATTERN = /^NV-TEST-G15E-DELIVERED(?:-[A-Z0-9-]+)?$/;
const APPROVED_SYNTHETIC_HUB_ORDER_ID_PREFIX = 'TEST-NONPROVIDER-';
const TERMINAL_STATUSES = new Set(['delivered', 'picked_up', 'cancelled', 'refunded']);
const BLOCKED_HUB_STATUSES = new Set(['refunded', 'cancelled', 'canceled']);
const ALLOWED_BODY_KEYS = new Set([
  'order_id',
  'order_number',
  'request_id',
  'dry_run',
  'confirm',
  'allow_test_order',
]);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function sanitizeText(value, maxLength = 160) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function normalizeId(value, fieldName, required = true) {
  const text = normalizeSingleLine(value);
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (text.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeOrderNumber(value) {
  const text = normalizeSingleLine(value).replace(/^#/, '').toUpperCase();
  if (!text) return '';
  if (text.length > 80 || !/^[A-Z0-9._-]+$/.test(text)) {
    throw new Error('order_number contains unsupported characters');
  }
  return text;
}

function normalizeEmail(value) {
  const email = normalizeSingleLine(value).toLowerCase();
  if (!email || email.length > 160 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
  return email;
}

function maskEmail(value) {
  const email = normalizeEmail(value);
  if (!email) return null;
  const [local, domain] = email.split('@');
  const visible = local.slice(0, Math.min(3, local.length));
  return `${visible}${local.length > 3 ? '***' : '*'}@${domain}`;
}

function isValidIsoTimestamp(value) {
  const text = normalizeSingleLine(value);
  return Boolean(text && !Number.isNaN(Date.parse(text)));
}

function mapHubStatus(hubStatus) {
  const map = {
    new: 'order_received',
    awaiting_production: 'scheduled_for_juicing',
    scheduled_for_production: 'scheduled_for_juicing',
    in_production: 'in_production',
    bottled: 'bottled_packed',
    labeled: 'bottled_packed',
    qc_checked: 'bottled_packed',
    packed: 'bottled_packed',
    in_cold_storage: 'bottled_packed',
    assigned_for_pickup: 'ready_for_pickup',
    assigned_for_delivery: 'out_for_delivery',
    fulfilled: 'delivered',
    order_received: 'order_received',
    scheduled_for_juicing: 'scheduled_for_juicing',
    bottled_packed: 'bottled_packed',
    out_for_delivery: 'out_for_delivery',
    arriving_soon: 'arriving_soon',
    ready_for_pickup: 'ready_for_pickup',
    picked_up: 'picked_up',
  };
  return map[normalizeLower(hubStatus)] || null;
}

function findForbiddenBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (ALLOWED_BODY_KEYS.has(normalized)) continue;
    return key;
  }

  return null;
}

function hasOwnField(source, fieldName) {
  return Boolean(source && Object.prototype.hasOwnProperty.call(source, fieldName));
}

function hasCustomerContactOrAddress(order, hubOrder) {
  const fields = [
    order?.contact_phone,
    order?.customer_phone,
    order?.delivery_address,
    order?.address_line1,
    order?.address_line2,
    order?.address_city,
    order?.address_state,
    order?.address_postal_code,
    hubOrder?.customer_phone,
    hubOrder?.phone,
    hubOrder?.delivery_address,
    hubOrder?.address_line1,
    hubOrder?.address_line2,
    hubOrder?.address_city,
    hubOrder?.address_state,
    hubOrder?.address_postal_code,
  ];

  return fields.some((field) => Boolean(normalizeSingleLine(field)));
}

function isApprovedSyntheticHubOrderId(value) {
  return normalizeSingleLine(value).startsWith(APPROVED_SYNTHETIC_HUB_ORDER_ID_PREFIX);
}

function isApprovedSyntheticTestPath({ order, hubOrder, allowTestOrder }) {
  const caEmail = normalizeEmail(order?.customer_email);
  const orderNumber = normalizeOrderNumber(order?.order_number);

  return APPROVED_TEST_EMAILS.has(caEmail) &&
    hubEmailMatches(hubOrder, caEmail) &&
    orderNumber === APPROVED_TEST_ORDER_NUMBER &&
    order?.is_test_order === true &&
    allowTestOrder === true &&
    hasFakeMarker(order) &&
    !hasProofOrDrop(order, hubOrder) &&
    !hasCustomerContactOrAddress(order, hubOrder);
}

function getProviderPaymentGuard({ order, hubOrder, allowTestOrder }) {
  const caKeys = [
    'stripe_payment_intent_id',
    'stripe_checkout_session_id',
    'stripe_subscription_id',
    'shopify_order_id',
  ];
  const hubStripeKeys = ['stripe_subscription_id'];
  const caHasProviderOrPaymentId = caKeys.some((key) => Boolean(normalizeSingleLine(order?.[key])));
  const hubHasStripeId = hubStripeKeys.some((key) => Boolean(normalizeSingleLine(hubOrder?.[key])));
  const hubShopifyOrderId = normalizeSingleLine(hubOrder?.shopify_order_id);

  if (!hubShopifyOrderId) {
    return {
      blocked: caHasProviderOrPaymentId || hubHasStripeId,
      syntheticAllowed: false,
    };
  }

  const syntheticAllowed = isApprovedSyntheticHubOrderId(hubShopifyOrderId) &&
    isApprovedSyntheticTestPath({ order, hubOrder, allowTestOrder }) &&
    !caHasProviderOrPaymentId &&
    !hubHasStripeId;

  return {
    blocked: caHasProviderOrPaymentId || hubHasStripeId || !syntheticAllowed,
    syntheticAllowed,
  };
}

function hasProofOrDrop(order, hubOrder) {
  return Boolean(
    normalizeSingleLine(order?.delivery_photo_url) ||
    normalizeSingleLine(order?.delivery_drop_location) ||
    normalizeSingleLine(hubOrder?.delivery_photo_url) ||
    normalizeSingleLine(hubOrder?.delivery_drop_location)
  );
}

function hasFakeMarker(order) {
  const haystack = [
    order?.customer_name,
    order?.notes,
    ...(Array.isArray(order?.items) ? order.items.map((item) => item?.title) : []),
  ].map((value) => normalizeLower(value)).join(' ');

  return /\b(g15e|test|fake|no fulfillment|no customer)\b/.test(haystack);
}

function orderMatchesApprovedPattern(orderNumber) {
  return APPROVED_TEST_ORDER_PATTERN.test(normalizeOrderNumber(orderNumber));
}

function hubEmailMatches(hubOrder, expectedEmail) {
  const expected = normalizeEmail(expectedEmail);
  const emails = [
    normalizeEmail(hubOrder?.customer_email),
    normalizeEmail(hubOrder?.contact_email),
  ].filter(Boolean);
  return Boolean(expected && emails.includes(expected));
}

function buildNotificationKey(orderId) {
  return `order_status_${orderId}_delivered`;
}

function hubGuardFieldsAvailable(hubOrder) {
  const hasSyncStatus = hasOwnField(hubOrder, 'sync_status');
  const hasExclusionMarker = hasOwnField(hubOrder, 'tags') ||
    hasOwnField(hubOrder, 'excluded') ||
    hasOwnField(hubOrder, 'is_excluded');

  return hasSyncStatus && hasExclusionMarker;
}

function hubOrderIsExcluded(hubOrder) {
  const hubTags = Array.isArray(hubOrder?.tags) ? hubOrder.tags.map((tag) => normalizeLower(tag)) : [];
  return hubTags.includes('excluded') ||
    hubOrder?.excluded === true ||
    hubOrder?.is_excluded === true;
}

function deliveredHistoryPresent(order) {
  const history = Array.isArray(order?.status_history) ? order.status_history : [];
  return history.some((entry) => normalizeLower(entry?.status) === 'delivered');
}

function buildSafeResponse({
  dryRun,
  order,
  hubOrder,
  previousStatus,
  proposedStatus,
  newStatus = null,
  hubProductionStatus,
  hubFulfillmentStatus,
  deliveredAt,
  statusHistoryWouldAppend,
  didAppend = false,
  notificationKey,
  notificationExistingCount,
  notificationExpected,
  deliveredHistoryPresent: deliveredHistory = null,
  skipped = false,
  requestId = null,
  warnings = [],
  liveAllowed = false,
}) {
  return {
    success: true,
    dry_run: dryRun,
    order_id: sanitizeText(order?.id, 160) || null,
    order_number: sanitizeText(order?.order_number, 80) || null,
    previous_status: sanitizeText(previousStatus, 40) || null,
    proposed_status: sanitizeText(proposedStatus, 40) || null,
    new_status: sanitizeText(newStatus, 40) || null,
    hub_order_id: sanitizeText(hubOrder?.id, 160) || null,
    hub_production_status: sanitizeText(hubProductionStatus, 40) || null,
    hub_fulfillment_status: sanitizeText(hubFulfillmentStatus, 40) || null,
    delivered_at_source: deliveredAt ? 'hub_order.delivered_at' : null,
    status_history_would_append: statusHistoryWouldAppend === true,
    did_append: didAppend === true,
    notification_key: sanitizeText(notificationKey, 180) || null,
    notification_existing_count: notificationExistingCount,
    notification_expected: notificationExpected === true,
    delivered_history_present: deliveredHistory === null ? null : deliveredHistory === true,
    skipped: skipped === true,
    request_id: sanitizeText(requestId, 160) || null,
    warnings: warnings.map((warning) => sanitizeText(warning, 160)).filter(Boolean),
    live_allowed: liveAllowed === true,
  };
}

function buildGuardWarnings({ order, hubOrder, hubMatches, mappedStatus, hubProductionStatus, hubFulfillmentStatus, deliveredAt, requestId, dryRun, confirm, allowTestOrder }) {
  const warnings = [];
  const caEmail = normalizeEmail(order?.customer_email);
  const orderNumber = normalizeOrderNumber(order?.order_number);
  const caStatus = normalizeLower(order?.status);
  const caPaymentStatus = normalizeLower(order?.payment_status);
  const caFinancialStatus = normalizeLower(order?.financial_status);
  const hubProduction = normalizeLower(hubProductionStatus);
  const hubFulfillment = normalizeLower(hubFulfillmentStatus);
  const hubSyncStatus = normalizeLower(hubOrder?.sync_status);
  const providerPaymentGuard = getProviderPaymentGuard({ order, hubOrder, allowTestOrder });

  if (!dryRun && !requestId) warnings.push('live mode requires request_id');
  if (!dryRun && confirm !== true) warnings.push('live mode requires confirm=true');
  if (!hubGuardFieldsAvailable(hubOrder)) {
    warnings.push(HUB_GUARD_UNAVAILABLE_WARNING);
  }
  if (!APPROVED_TEST_EMAILS.has(caEmail)) warnings.push('customer app email is not an approved test inbox');
  if (!hubEmailMatches(hubOrder, caEmail)) warnings.push('hub email does not match customer app test inbox');
  if (!orderMatchesApprovedPattern(orderNumber)) warnings.push('order number does not match approved fake delivered test pattern');
  if (order?.is_test_order === true && allowTestOrder !== true) warnings.push('is_test_order requires allow_test_order=true');
  if (!hasFakeMarker(order)) warnings.push('customer app order lacks a clear fake/test marker');
  if (TERMINAL_STATUSES.has(caStatus) && caStatus !== 'delivered') warnings.push(`customer app order is terminal: ${caStatus}`);
  if (caStatus === 'delivered') warnings.push('customer app order is already delivered');
  if (order?.payment_captured !== true) warnings.push('customer app payment_captured is not true');
  if (caPaymentStatus !== 'paid') warnings.push('customer app payment_status is not paid');
  if (caFinancialStatus && caFinancialStatus !== 'paid') warnings.push('customer app financial_status is not paid');
  if (mappedStatus !== 'delivered') warnings.push('hub status does not map to delivered');
  if (hubProduction !== 'fulfilled') warnings.push('hub production_status is not fulfilled');
  if (hubFulfillment !== 'fulfilled') warnings.push('hub fulfillment_status is not fulfilled');
  if (!isValidIsoTimestamp(deliveredAt)) warnings.push('hub delivered_at is missing or invalid');
  if (BLOCKED_HUB_STATUSES.has(hubProduction) || BLOCKED_HUB_STATUSES.has(hubFulfillment)) warnings.push('hub order is refunded or cancelled');
  if (hubSyncStatus === 'do_not_sync') warnings.push('hub order is do_not_sync');
  if (hubOrderIsExcluded(hubOrder)) warnings.push('hub order is excluded');
  if (hasProofOrDrop(order, hubOrder)) warnings.push('proof/drop fields are present while proof/drop are out of scope');
  if (providerPaymentGuard.blocked) warnings.push('provider/payment identifiers are present');
  if (dryRun && providerPaymentGuard.syntheticAllowed) warnings.push('synthetic_nonprovider_id_allowed_for_test');
  if (hubMatches.length > 1) warnings.push('multiple matching Hub orders found');

  return warnings;
}

async function fetchCustomerAppOrder(ca, body) {
  const hasOrderId = Boolean(normalizeSingleLine(body.order_id));
  const hasOrderNumber = Boolean(normalizeSingleLine(body.order_number));

  if (hasOrderId === hasOrderNumber) {
    return { error: 'Provide exactly one of order_id or order_number', status: 400 };
  }

  if (hasOrderId) {
    const orderId = normalizeId(body.order_id, 'order_id');
    const matches = await ca.entities.Order.filter({ id: orderId });
    if (!matches?.length) return { error: 'Customer App order not found', status: 404 };
    if (matches.length > 1) return { error: 'Multiple Customer App orders matched order_id', status: 409 };
    return { order: matches[0] };
  }

  const orderNumber = normalizeOrderNumber(body.order_number);
  const matches = await ca.entities.Order.filter({ order_number: orderNumber });
  if (!matches?.length) return { error: 'Customer App order not found', status: 404 };
  if (matches.length > 1) return { error: 'Multiple Customer App orders matched order_number', status: 409 };
  return { order: matches[0] };
}

async function fetchHubOrdersForCustomer(email) {
  if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
    return { error: 'Hub delivery sync service is not configured', status: 503 };
  }

  const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
  const hubUrl = `${hubBase}/api/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(email)}`;
  const response = await fetch(hubUrl, {
    headers: {
      Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    return { error: 'Unable to fetch matching Hub order', status: response.status >= 400 && response.status < 500 ? response.status : 502 };
  }

  const data = await response.json().catch(() => ({}));
  return { orders: Array.isArray(data?.orders) ? data.orders : [] };
}

async function countDeliveredNotifications(ca, notificationKey) {
  if (!notificationKey) return 0;
  const rows = await ca.entities.Notification.filter({ idempotency_key: notificationKey }, null, 20);
  return rows?.length || 0;
}

async function findExistingRequestLog(ca, orderNumber, requestId) {
  if (!orderNumber || !requestId) return null;
  const rows = await ca.entities.OrderSyncLog.filter({ order_number: orderNumber }, '-created_date', 50);
  return (rows || []).find((log) => {
    const description = normalizeSingleLine(log?.description);
    return description.includes(FUNCTION_NAME) && description.includes(`request_id=${requestId}`) && ['success', 'skipped'].includes(log?.status);
  }) || null;
}

async function createSyncLog(ca, { order, hubOrder, requestId, status, previousStatus, newStatus, notificationKey }) {
  const now = new Date().toISOString();
  const description = sanitizeText([
    FUNCTION_NAME,
    `request_id=${requestId}`,
    `ca_order_id=${order?.id}`,
    `hub_order_id=${hubOrder?.id}`,
    `status=${previousStatus}->${newStatus}`,
    `notification_key=${notificationKey}`,
    'proof_drop_omitted=true',
  ].join(' | '), 1000);

  await ca.entities.OrderSyncLog.create({
    order_number: order?.order_number || null,
    status,
    hub_order_id: hubOrder?.id || null,
    hub_action: 'scoped_delivery_status_sync',
    description,
    started_at: now,
    completed_at: now,
    triggered_by: 'manual',
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

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

    const body = await req.json().catch(() => ({}));
    const forbiddenKey = findForbiddenBodyKey(body);
    if (forbiddenKey) {
      return Response.json({
        error: `Unsupported field: ${sanitizeText(forbiddenKey, 80)}`,
        error_code: 'unsupported_field',
      }, { status: 400 });
    }

    const dryRun = body.dry_run !== false;
    const confirm = body.confirm === true;
    const allowTestOrder = body.allow_test_order === true;
    let requestId = '';

    try {
      requestId = normalizeId(body.request_id, 'request_id', !dryRun);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const ca = base44.asServiceRole;
    const orderResult = await fetchCustomerAppOrder(ca, body);
    if (orderResult.error) {
      return Response.json({ error: orderResult.error }, { status: orderResult.status });
    }

    const order = orderResult.order;
    const caEmail = normalizeEmail(order?.customer_email);
    if (!caEmail) {
      return Response.json({ error: 'Customer App order email is unavailable' }, { status: 409 });
    }

    const hubResult = await fetchHubOrdersForCustomer(caEmail);
    if (hubResult.error) {
      return Response.json({ error: hubResult.error }, { status: hubResult.status });
    }

    const normalizedOrderNumber = normalizeOrderNumber(order?.order_number);
    const hubMatches = (hubResult.orders || []).filter((hubOrder) => {
      const hubNumber = normalizeOrderNumber(hubOrder?.shopify_order_number || hubOrder?.order_number);
      return hubNumber === normalizedOrderNumber;
    });

    if (hubMatches.length === 0) {
      return Response.json({ error: 'Matching Hub order not found' }, { status: 404 });
    }

    if (hubMatches.length > 1) {
      return Response.json({ error: 'Multiple matching Hub orders found' }, { status: 409 });
    }

    const hubOrder = hubMatches[0];
    const hubProductionStatus = sanitizeText(hubOrder?.production_status || hubOrder?.status, 40);
    const hubFulfillmentStatus = sanitizeText(hubOrder?.fulfillment_status, 40);
    const mappedStatus = mapHubStatus(hubProductionStatus);
    const deliveredAt = normalizeSingleLine(hubOrder?.delivered_at);
    const notificationKey = buildNotificationKey(order.id);
    const notificationExistingCount = await countDeliveredNotifications(ca, notificationKey);
    const previousStatus = sanitizeText(order?.status, 40);
    const deliveredHistory = deliveredHistoryPresent(order);
    const statusHistoryWouldAppend = mappedStatus === 'delivered' && previousStatus !== 'delivered';
    const warnings = buildGuardWarnings({
      order,
      hubOrder,
      hubMatches,
      mappedStatus,
      hubProductionStatus,
      hubFulfillmentStatus,
      deliveredAt,
      requestId,
      dryRun,
      confirm,
      allowTestOrder,
    });
    const alreadyDelivered = normalizeLower(order?.status) === 'delivered';
    const blockingWarnings = warnings.filter((warning) => warning !== 'synthetic_nonprovider_id_allowed_for_test');
    const liveAllowed = blockingWarnings.length === 0;

    if (dryRun) {
      return Response.json(buildSafeResponse({
        dryRun: true,
        order,
        hubOrder,
        previousStatus,
        proposedStatus: mappedStatus,
        hubProductionStatus,
        hubFulfillmentStatus,
        deliveredAt,
        statusHistoryWouldAppend,
        notificationKey,
        notificationExistingCount,
        notificationExpected: mappedStatus === 'delivered' && previousStatus !== 'delivered',
        deliveredHistoryPresent: deliveredHistory,
        warnings,
        liveAllowed,
      }));
    }

    if (alreadyDelivered) {
      const alreadyDeliveredWarnings = [...warnings, 'customer app order already delivered; no write performed'];
      if (!deliveredHistory) {
        alreadyDeliveredWarnings.push('delivered status_history entry was not detected');
      }
      if (notificationExistingCount === 0) {
        alreadyDeliveredWarnings.push('delivered notification was not detected');
      }

      return Response.json(buildSafeResponse({
        dryRun: false,
        order,
        hubOrder,
        previousStatus,
        proposedStatus: mappedStatus,
        newStatus: previousStatus,
        hubProductionStatus,
        hubFulfillmentStatus,
        deliveredAt,
        statusHistoryWouldAppend: false,
        didAppend: false,
        notificationKey,
        notificationExistingCount,
        notificationExpected: false,
        deliveredHistoryPresent: deliveredHistory,
        skipped: true,
        requestId,
        warnings: alreadyDeliveredWarnings,
        liveAllowed: false,
      }));
    }

    if (!liveAllowed) {
      const hubGuardUnavailable = warnings.includes(HUB_GUARD_UNAVAILABLE_WARNING);
      const providerLinkageBlocked = warnings.includes('provider/payment identifiers are present');
      return Response.json({
        error: 'Scoped delivered sync guard failed',
        error_code: hubGuardUnavailable ? 'hub_guard_fields_unavailable' : providerLinkageBlocked ? 'provider_linkage_blocked' : 'scoped_delivered_sync_guard_failed',
        warnings: warnings.map((warning) => sanitizeText(warning, 160)).filter(Boolean),
      }, { status: 409 });
    }

    const existingRequestLog = await findExistingRequestLog(ca, order.order_number, requestId);
    if (existingRequestLog) {
      return Response.json(buildSafeResponse({
        dryRun: false,
        order,
        hubOrder,
        previousStatus,
        proposedStatus: mappedStatus,
        newStatus: previousStatus,
        hubProductionStatus,
        hubFulfillmentStatus,
        deliveredAt,
        statusHistoryWouldAppend: false,
        didAppend: false,
        notificationKey,
        notificationExistingCount,
        notificationExpected: false,
        deliveredHistoryPresent: deliveredHistory,
        skipped: true,
        requestId,
        warnings: ['duplicate request_id already processed; no write performed'],
        liveAllowed: true,
      }));
    }

    const newHistory = [
      ...(Array.isArray(order?.status_history) ? order.status_history : []),
      {
        status: 'delivered',
        timestamp: new Date().toISOString(),
        message: `Scoped status synced from Hub (hub_status: ${sanitizeText(hubProductionStatus, 40)})`,
      },
    ];

    await ca.entities.Order.update(order.id, {
      status: 'delivered',
      status_history: newHistory,
      delivered_at: deliveredAt,
    });

    await createSyncLog(ca, {
      order,
      hubOrder,
      requestId,
      status: 'success',
      previousStatus,
      newStatus: 'delivered',
      notificationKey,
    });

    return Response.json(buildSafeResponse({
      dryRun: false,
      order,
      hubOrder,
      previousStatus,
      proposedStatus: mappedStatus,
      newStatus: 'delivered',
      hubProductionStatus,
      hubFulfillmentStatus,
      deliveredAt,
      statusHistoryWouldAppend: true,
      didAppend: true,
      notificationKey,
      notificationExistingCount,
      notificationExpected: true,
      deliveredHistoryPresent: true,
      skipped: false,
      requestId,
      warnings: [],
      liveAllowed: true,
    }));
  } catch {
    console.error('[syncAdminSingleHubDeliveryStatus] Error');
    return Response.json({ error: 'Unable to sync single Hub delivery status' }, { status: 500 });
  }
});
