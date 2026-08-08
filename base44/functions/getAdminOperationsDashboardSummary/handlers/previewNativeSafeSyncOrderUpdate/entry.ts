const LOCK_FROZEN_FIELDS = {
  unlocked: [],
  verified: ['customer_name', 'customer_email', 'customer_phone', 'source_channel', 'stripe_subscription_id'],
  production_scheduled: [
    'customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments',
    'payment_status', 'address_line1', 'address_line2', 'address_city',
    'address_state', 'address_postal_code', 'address_country',
  ],
  in_production: [
    'customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments', 'total_price',
    'subtotal', 'payment_status', 'address_line1', 'address_line2',
    'address_city', 'address_state', 'address_postal_code', 'address_country',
  ],
  out_for_delivery: [
    'customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments', 'total_price',
    'subtotal', 'address_line1', 'address_line2', 'address_city',
    'address_state', 'address_postal_code', 'address_country',
  ],
  fulfilled: [
    'customer_name', 'customer_email', 'customer_phone', 'source_channel',
    'stripe_subscription_id', 'line_items', 'fulfillments', 'total_price',
    'subtotal', 'payment_status', 'address_line1', 'address_line2',
    'address_city', 'address_state', 'address_postal_code', 'address_country',
  ],
};

const FIELD_OWNERSHIP = {
  stripe_webhook: [
    'shopify_order_id', 'shopify_order_number', 'base44_order_id', 'payment_status',
    'stripe_customer_id', 'stripe_subscription_id', 'stripe_invoice_id',
    'stripe_checkout_session_id', 'stripe_payment_intent_id',
    'stripe_charge_id', 'stripe_created_event_type',
    'stripe_event_id_applied', 'last_reconciliation_at', 'sync_status',
    'last_sync_at', 'customer_order_date', 'source_type', 'customer_name',
    'customer_email', 'customer_phone', 'source_channel', 'line_items',
    'total_price', 'subtotal', 'fulfillment_method', 'address_line1',
    'address_line2', 'address_city', 'address_state', 'address_postal_code',
    'address_country', 'address_last_synced_from', 'address_last_synced_at',
  ],
  customer_app: [
    'base44_order_id', 'customer_name', 'customer_email', 'customer_phone', 'address_line1',
    'address_line2', 'address_city', 'address_state', 'address_postal_code',
    'address_country', 'customer_notes', 'requested_delivery_date',
    'selected_delivery_date', 'assigned_delivery_date', 'production_date',
    'delivery_window_label', 'delivery_notes', 'fulfillment_method',
    'line_items', 'total_price', 'subtotal', 'delivery_fee', 'tags',
    'sync_status', 'last_sync_at', 'shopify_order_number', 'payment_status',
    'stripe_checkout_session_id', 'stripe_payment_intent_id',
    'stripe_customer_id', 'source_channel', 'source_type', 'order_type',
    'fulfillment_mode', 'customer_order_date', 'production_status',
    'data_quality_status', 'order_lock_status',
  ],
  rebuild_subscriptions: [
    'shopify_order_id', 'shopify_order_number', 'base44_order_id', 'customer_name',
    'customer_email', 'customer_phone', 'source_channel', 'source_type',
    'stripe_subscription_id', 'stripe_customer_id', 'line_items',
    'fulfillments', 'total_price', 'subtotal', 'payment_status',
    'fulfillment_method', 'address_line1', 'address_line2', 'address_city',
    'address_state', 'address_postal_code', 'address_country', 'sync_status',
    'last_sync_at', 'customer_order_date', 'production_status',
    'order_lock_status', 'customer_app_user_id', 'customer_notes', 'tags',
    'requested_delivery_date', 'delivery_notes',
  ],
  operations: [
    'production_status', 'fulfillment_status', 'assigned_delivery_date',
    'internal_notes', 'tags', 'sync_status', 'order_lock_status',
    'fulfillments', 'delivery_photo_url', 'delivery_drop_location',
    'delivered_by', 'delivered_at', 'fulfillment_method',
  ],
  customer_app_driver: [
    'fulfillment_status', 'production_status', 'delivered_at',
    'delivered_by', 'delivery_photo_url', 'delivery_drop_location',
    'internal_notes', 'sync_status',
  ],
  admin: ['__all__'],
  manual_recovery: [
    'shopify_order_id', 'shopify_order_number', 'base44_order_id', 'customer_name',
    'customer_email', 'customer_phone', 'source_channel', 'source_type',
    'stripe_subscription_id', 'stripe_customer_id',
    'stripe_checkout_session_id', 'stripe_payment_intent_id',
    'stripe_invoice_id', 'line_items', 'fulfillments', 'total_price',
    'subtotal', 'payment_status', 'fulfillment_method', 'address_line1',
    'address_line2', 'address_city', 'address_state', 'address_postal_code',
    'address_country', 'sync_status', 'repair_status', 'repair_timestamp',
    'repair_method', 'last_reconciliation_at', 'last_sync_at',
    'customer_order_date', 'production_status', 'order_lock_status',
  ],
};

const ALWAYS_SAFE_FIELDS = ['sync_status', 'last_sync_at', 'stripe_event_id_applied', 'last_reconciliation_at'];
const OPERATIONAL_FIELDS = new Set([
  'production_status', 'fulfillment_status', 'order_lock_status',
  'assigned_delivery_date', 'internal_notes', 'tags', 'sync_status',
  'fulfillments', 'fulfillment_method', 'delivery_photo_url',
  'delivery_drop_location', 'delivered_by', 'delivered_at',
]);
const MANUAL_PROTECTED_FIELDS = [
  'production_status', 'fulfillment_status', 'order_lock_status',
  'assigned_delivery_date', 'address_line1', 'address_line2', 'address_city',
  'address_state', 'address_postal_code', 'tags', 'manual_override',
  'manual_override_at', 'manual_override_by', 'internal_notes', 'audit_trail',
];

function clone(value: any): any {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeTitle(title) {
  if (!title) return title;
  let next = String(title).replace(/^\d+\s*[x×]\s*/i, '').trim();
  next = next.replace(/\s*\(at\s+\$[\d.]+\s*\/\s*\w+\)/i, '').trim();
  next = next.replace(/\s*\(\$[\d.,]+.*?\)/i, '').trim();
  return next;
}

function getCompletenessScore(data) {
  let score = 0;
  if (data.customer_name && String(data.customer_name).trim()) score += 2;
  if (data.customer_email && String(data.customer_email).trim()) score += 2;
  if (Array.isArray(data.line_items) && data.line_items.length > 0) score += 2;
  if (data.total_price && data.total_price > 0) score += 1;
  if (data.address_line1 && String(data.address_line1).trim()) score += 1;
  if (data.stripe_subscription_id) score += 1;
  if (Array.isArray(data.fulfillments) && data.fulfillments.length > 0) score += 1;
  return Math.min(score, 10);
}

function isUnknownQuality(data) {
  const hasIdentity = data.customer_email || data.stripe_subscription_id ||
    data.stripe_checkout_session_id || data.customer_name;
  const hasExplicitUnknown = data.shopify_order_number === '#unknown' ||
    data.shopify_order_number === '#UNKNOWN';
  const allOperational = Object.keys(data).every((key) => OPERATIONAL_FIELDS.has(key));
  if (allOperational) return false;
  return hasExplicitUnknown || (!hasIdentity && Object.keys(data).length > 3);
}

function isPosOrder(data, existingOrder) {
  return data.source_type === 'shopify_pos' ||
    data.source_channel === 'pos' ||
    data.order_type === 'pos' ||
    data.fulfillment_method === 'pos' ||
    existingOrder?.source_type === 'shopify_pos' ||
    existingOrder?.source_channel === 'pos' ||
    existingOrder?.order_type === 'pos';
}

function hasCompleteAddress(data) {
  return Boolean(data.address_line1 && data.address_city && data.address_state && data.address_postal_code);
}

function sortedTitles(items) {
  return (items || []).map((item) => normalizeTitle(item.title)).sort().join(',');
}

function rejectField(incoming, rejected, field, reason) {
  if (field in incoming) {
    delete incoming[field];
    rejected[field] = reason;
  }
}

function queueDraft({ incidentType, source, existingOrder, incomingData, issueDescription, recommendedAction = 'manual_review' }) {
  const incomingKeys = Object.keys(incomingData || {}).sort();
  return {
    incident_type: incidentType,
    existing_order_id: existingOrder?.id || null,
    existing_order_number: existingOrder?.shopify_order_number || null,
    existing_order_type: existingOrder?.source_channel || null,
    incoming_source: source,
    incoming_payload_summary: {
      field_count: incomingKeys.length,
      fields_present: incomingKeys,
      has_line_items: Array.isArray(incomingData.line_items),
      line_item_count: Array.isArray(incomingData.line_items) ? incomingData.line_items.length : 0,
      has_fulfillments: Array.isArray(incomingData.fulfillments),
      fulfillment_count: Array.isArray(incomingData.fulfillments) ? incomingData.fulfillments.length : 0,
      source_channel: incomingData.source_channel || null,
      fulfillment_method: incomingData.fulfillment_method || null,
      payment_status: incomingData.payment_status || null,
    },
    issue_description: issueDescription,
    recommended_action: recommendedAction || 'manual_review',
    status: 'pending',
    occurrence_count: 1,
  };
}

function planSafeSync(input) {
  const fixtureId = input.fixture_id || null;
  const source = input.source || 'customer_app';
  const existingOrder = clone(input.starting_order || input.existing_order || null);
  const incomingOriginal = clone(input.incoming_payload || input.incomingData || {});
  const incoming = clone(incomingOriginal);
  const idempotencyKey = input.idempotency_key || input.stripeEventId || input.stripe_event_id || null;
  const stripeEventId = input.stripeEventId || input.stripe_event_id || idempotencyKey || null;
  const acceptedFields: Record<string, any> = {};
  const rejectedFields: Record<string, any> = {};
  const warnings = [];
  let orderReviewQueueDraft = null;
  let wouldReject = false;
  let errorCode = null;
  let action = existingOrder ? 'would_update' : 'would_create';

  if (stripeEventId && existingOrder?.stripe_event_id_applied === stripeEventId) {
    return {
      success: true,
      dry_run: true,
      fixture_id: fixtureId,
      source,
      idempotency_key: idempotencyKey,
      accepted_fields: {},
      rejected_fields: {},
      proposed_order_state: existingOrder,
      order_sync_log_draft: {
        sync_source: source,
        event_type: source,
        stripe_event_id: stripeEventId,
        order_id: existingOrder.id || null,
        order_number: existingOrder.shopify_order_number || null,
        action: 'skipped',
        reason: 'duplicate_event',
        success: true,
        idempotency_key: idempotencyKey,
      },
      order_review_queue_draft: null,
      command_log_draft: null,
      would_create_order: false,
      would_update_order: false,
      would_quarantine: false,
      would_reject: false,
      error_code: null,
      response_status: 'skipped',
      action: 'duplicate_event',
      warnings,
    };
  }

  if (stripeEventId) incoming.stripe_event_id_applied = stripeEventId;

  const partialRefund = incoming.refund_amount > 0 && incoming.charge_amount > 0 &&
    incoming.refund_amount < incoming.charge_amount;
  if (partialRefund) {
    wouldReject = true;
    errorCode = 'partial_refund_requires_review';
    action = 'rejected';
    orderReviewQueueDraft = queueDraft({
      incidentType: 'partial_refund_received',
      source,
      existingOrder,
      incomingData: incomingOriginal,
      issueDescription: 'Partial refund requires manual review before operational state changes.',
    });
  }

  if (!wouldReject && isUnknownQuality(incoming)) {
    if (existingOrder && getCompletenessScore(existingOrder) >= 5) {
      wouldReject = true;
      errorCode = 'unknown_quality_would_overwrite_verified_order';
      action = 'rejected';
      orderReviewQueueDraft = queueDraft({
        incidentType: 'unknown_order_attempt',
        source,
        existingOrder,
        incomingData: incomingOriginal,
        issueDescription: 'Unknown or incomplete payload attempted to overwrite an existing order.',
        recommendedAction: 'reject',
      });
    } else if (!existingOrder) {
      wouldReject = true;
      errorCode = 'unknown_quality_new_order';
      action = 'rejected';
      orderReviewQueueDraft = queueDraft({
        incidentType: 'unknown_order_attempt',
        source,
        existingOrder,
        incomingData: incomingOriginal,
        issueDescription: 'New order with unknown quality rejected.',
      });
    }
  }

  if (!wouldReject && !existingOrder && source !== 'admin') {
    const minimumScore = source === 'rebuild_subscriptions' ? 6 : 5;
    if (getCompletenessScore(incoming) < minimumScore) {
      wouldReject = true;
      errorCode = 'low_quality_new_order';
      action = 'rejected';
      orderReviewQueueDraft = queueDraft({
        incidentType: 'low_quality_new_order',
        source,
        existingOrder,
        incomingData: incomingOriginal,
        issueDescription: `New order rejected below completeness threshold ${minimumScore}.`,
      });
    }
  }

  if (existingOrder && (existingOrder.source_channel === 'subscription' || existingOrder.stripe_subscription_id)) {
    if (incoming.source_channel && incoming.source_channel !== 'subscription') {
      rejectedFields.source_channel = 'subscription_hard_lock';
      orderReviewQueueDraft = orderReviewQueueDraft || queueDraft({
        incidentType: 'subscription_downgrade_attempt',
        source,
        existingOrder,
        incomingData: incomingOriginal,
        issueDescription: `Attempted to change subscription order channel to ${incoming.source_channel}.`,
        recommendedAction: 'reject',
      });
      incoming.source_channel = 'subscription';
    }
    if (incoming.stripe_subscription_id === null || incoming.stripe_subscription_id === '') {
      rejectedFields.stripe_subscription_id = 'subscription_hard_lock';
      incoming.stripe_subscription_id = existingOrder.stripe_subscription_id;
    }
    if ((!Array.isArray(incoming.line_items) || incoming.line_items.length === 0) &&
      Array.isArray(existingOrder.line_items) && existingOrder.line_items.length > 0 &&
      'line_items' in incoming) {
      rejectedFields.line_items = 'subscription_hard_lock';
      incoming.line_items = existingOrder.line_items;
    }
    if ((!Array.isArray(incoming.fulfillments) || incoming.fulfillments.length === 0) &&
      Array.isArray(existingOrder.fulfillments) && existingOrder.fulfillments.length > 0 &&
      'fulfillments' in incoming) {
      rejectedFields.fulfillments = 'subscription_hard_lock';
      incoming.fulfillments = existingOrder.fulfillments;
    }
    incoming.source_channel = 'subscription';
  }

  if (existingOrder?.manual_override === true && ['customer_app', 'rebuild_subscriptions'].includes(source)) {
    for (const field of MANUAL_PROTECTED_FIELDS) {
      rejectField(incoming, rejectedFields, field, 'manual_override_guard');
    }
  }

  const incomingPayment = incoming.payment_status;
  const existingPayment = existingOrder?.payment_status;
  const terminalRefunded = existingPayment === 'refunded' || existingOrder?.production_status === 'canceled';
  if (existingOrder && source !== 'admin') {
    if (existingPayment === 'paid' && ['pending', 'unpaid', null, undefined, ''].includes(incomingPayment)) {
      rejectField(incoming, rejectedFields, 'payment_status', 'payment_downgrade_blocked');
    }
    if (terminalRefunded && incomingPayment === 'paid') {
      rejectField(incoming, rejectedFields, 'payment_status', 'terminal_order_state_preserved');
      warnings.push('terminal_order_state_preserved');
    }
    if (terminalRefunded && incoming.production_status && incoming.production_status !== existingOrder.production_status) {
      rejectField(incoming, rejectedFields, 'production_status', 'terminal_order_state_preserved');
      if (!warnings.includes('terminal_order_state_preserved')) warnings.push('terminal_order_state_preserved');
    }
  }
  const forcePaymentPaid = incomingPayment === 'paid' && existingPayment !== 'paid';

  const lockStatus = existingOrder?.order_lock_status || 'unlocked';
  const frozenFields = LOCK_FROZEN_FIELDS[lockStatus] || [];
  if (existingOrder && source !== 'admin') {
    for (const field of frozenFields) {
      if (field === 'payment_status' && forcePaymentPaid) continue;
      if (field in incoming && existingOrder[field] !== undefined && existingOrder[field] !== null && existingOrder[field] !== '') {
        rejectField(incoming, rejectedFields, field, 'lock_frozen_field');
      }
    }
  }

  if (existingOrder && source === 'customer_app') {
    for (const field of ['production_status', 'order_lock_status', 'data_quality_status']) {
      rejectField(incoming, rejectedFields, field, 'customer_app_operational_ownership_guard');
    }
  }

  if (existingOrder?.base44_order_id && incoming.base44_order_id &&
    incoming.base44_order_id !== existingOrder.base44_order_id &&
    source !== 'admin') {
    rejectField(incoming, rejectedFields, 'base44_order_id', 'base44_order_linkage_guard');
  }

  const allowedFields = source === 'admin' ? null : (FIELD_OWNERSHIP[source] || []);
  if (allowedFields) {
    for (const field of Object.keys(incoming)) {
      if (!allowedFields.includes(field) && !ALWAYS_SAFE_FIELDS.includes(field)) {
        rejectField(incoming, rejectedFields, field, 'field_ownership');
      }
    }
  }

  if (Array.isArray(incoming.line_items)) {
    incoming.line_items = incoming.line_items.map((item) => ({ ...item, title: normalizeTitle(item.title) }));
  }

  if (existingOrder && existingOrder.order_type === 'one_time' &&
    existingOrder.fulfillment_mode === 'single_delivery' &&
    !['stripe_webhook', 'manual_recovery', 'admin', 'customer_app'].includes(source) &&
    Array.isArray(incoming.line_items) && Array.isArray(existingOrder.line_items) &&
    sortedTitles(incoming.line_items) !== sortedTitles(existingOrder.line_items)) {
    rejectedFields.line_items = 'one_time_line_items_guard';
    incoming.line_items = existingOrder.line_items;
  }

  if (isPosOrder(incoming, existingOrder)) {
    incoming.production_status = incoming.production_status || 'not_required';
    incoming.order_lock_status = incoming.order_lock_status || 'fulfilled';
    incoming.fulfillment_status = incoming.fulfillment_status || 'fulfilled';
    incoming.payment_status = incoming.payment_status || 'paid';
    incoming.source_channel = 'pos';
    incoming.source_type = 'shopify_pos';
  }

  const deliveryOrder = !isPosOrder(incoming, existingOrder) &&
    (incoming.fulfillment_method === 'delivery' || existingOrder?.fulfillment_method === 'delivery');
  if (!wouldReject && deliveryOrder && !existingOrder && !hasCompleteAddress(incoming)) {
    wouldReject = true;
    errorCode = 'delivery_order_missing_address';
    action = 'rejected';
    orderReviewQueueDraft = queueDraft({
      incidentType: 'missing_customer_info',
      source,
      existingOrder,
      incomingData: incomingOriginal,
      issueDescription: 'New delivery order creation rejected because address is incomplete.',
    });
  }

  if (existingOrder?.production_snapshot && ['production_scheduled', 'in_production', 'out_for_delivery', 'fulfilled'].includes(lockStatus) && source !== 'admin') {
    const snapshot = existingOrder.production_snapshot;
    if (Array.isArray(incoming.line_items) && Array.isArray(snapshot.line_items) &&
      sortedTitles(incoming.line_items) !== sortedTitles(snapshot.line_items)) {
      rejectedFields.line_items = 'production_snapshot_mismatch';
      delete incoming.line_items;
      orderReviewQueueDraft = orderReviewQueueDraft || queueDraft({
        incidentType: 'overwrite_rejection',
        source,
        existingOrder,
        incomingData: { line_items: incomingOriginal.line_items, snapshot_line_items: snapshot.line_items },
        issueDescription: 'Production snapshot mismatch: incoming line_items differ from captured snapshot.',
      });
    }
    if (Array.isArray(incoming.fulfillments) && Array.isArray(snapshot.fulfillments) &&
      snapshot.fulfillments.length > 0 && incoming.fulfillments.length !== snapshot.fulfillments.length) {
      rejectedFields.fulfillments = 'production_snapshot_mismatch';
      delete incoming.fulfillments;
      orderReviewQueueDraft = orderReviewQueueDraft || queueDraft({
        incidentType: 'overwrite_rejection',
        source,
        existingOrder,
        incomingData: { fulfillment_count: incomingOriginal.fulfillments?.length, snapshot_count: snapshot.fulfillments.length },
        issueDescription: 'Production snapshot mismatch: incoming fulfillments differ from captured snapshot.',
      });
    }
  }

  if (!existingOrder && !incoming.order_type) {
    if (incoming.source_channel === 'subscription' || incoming.stripe_subscription_id) incoming.order_type = 'subscription';
    else if (incoming.source_channel === 'pos' || incoming.fulfillment_method === 'pos') incoming.order_type = 'pos';
    else incoming.order_type = 'one_time';
  }
  if (!existingOrder && !incoming.fulfillment_mode) {
    incoming.fulfillment_mode = incoming.order_type === 'subscription' ? 'multi_delivery' : 'single_delivery';
  }

  for (const [field, value] of Object.entries(incoming)) {
    if (!(field in rejectedFields)) acceptedFields[field] = value;
  }

  const proposedOrderState = existingOrder ? { ...existingOrder, ...acceptedFields } : { ...acceptedFields };
  const fieldsUpdated = Object.keys(acceptedFields);
  const fieldsRejected = Object.keys(rejectedFields);
  const wouldCreateOrder = !wouldReject && !existingOrder;
  const wouldUpdateOrder = !wouldReject && Boolean(existingOrder) && fieldsUpdated.length > 0;

  const orderSyncLogDraft = {
    sync_source: source,
    event_type: source,
    stripe_event_id: stripeEventId || null,
    order_id: proposedOrderState.id || null,
    order_number: proposedOrderState.shopify_order_number || incomingOriginal.shopify_order_number || null,
    action: wouldReject ? 'rejected' : (wouldCreateOrder ? 'created' : wouldUpdateOrder ? 'updated' : 'skipped'),
    reason: wouldReject ? errorCode : `source:${source}, lock:${lockStatus}`,
    fields_updated: fieldsUpdated,
    fields_rejected: fieldsRejected,
    success: !wouldReject,
    error: wouldReject ? errorCode : null,
    error_code: wouldReject ? errorCode : null,
    idempotency_key: idempotencyKey,
  };

  return {
    success: true,
    dry_run: true,
    fixture_id: fixtureId,
    source,
    idempotency_key: idempotencyKey,
    accepted_fields: acceptedFields,
    rejected_fields: rejectedFields,
    proposed_order_state: proposedOrderState,
    order_sync_log_draft: orderSyncLogDraft,
    order_review_queue_draft: orderReviewQueueDraft,
    command_log_draft: null,
    would_create_order: wouldCreateOrder,
    would_update_order: wouldUpdateOrder,
    would_quarantine: Boolean(orderReviewQueueDraft),
    would_reject: wouldReject,
    error_code: errorCode,
    response_status: wouldReject ? 'rejected' : 'dry_run',
    action,
    warnings,
  };
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) {
    return { ok: true, body: null };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

function previewUnauthorized() {
  return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
}

function previewForbidden() {
  return Response.json({ success: false, error_code: 'forbidden', message: 'Admin access required' }, { status: 403 });
}

function getPreviewInternalSecret() {
  return Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET') ||
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET') ||
    Deno.env.get('HUB_SYNC_SECRET') ||
    '';
}

async function requirePreviewAccess(req) {
  const providedSecret = (req.headers.get('x-internal-secret') || '').trim();
  if (providedSecret) {
    const expectedSecret = getPreviewInternalSecret();
    return expectedSecret && providedSecret === expectedSecret
      ? { ok: true }
      : { ok: false, response: previewUnauthorized() };
  }

  try {
    const { createClientFromRequest } = await import('npm:@base44/sdk@0.8.25');
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: previewUnauthorized() };
    if (user.role !== 'admin') return { ok: false, response: previewForbidden() };
    return { ok: true };
  } catch {
    return { ok: false, response: previewUnauthorized() };
  }
}

export default async (req: Request) => {
  try {
    const access = await requirePreviewAccess(req);
    if (!access.ok) return access.response;

    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required' }, { status: 405 });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }

    const body = parsedBody.body;
    if (!body || typeof body !== 'object') {
      return Response.json({ success: false, error_code: 'invalid_json', message: 'JSON body required' }, { status: 400 });
    }

    if (body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported' }, { status: 400 });
    }

    return Response.json(planSafeSync(body));
  } catch (_error) {
    return Response.json({ success: false, dry_run: true, error_code: 'preview_failed', message: 'Dry-run planner failed' }, { status: 500 });
  }
};
