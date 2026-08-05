const REQUEST_INCIDENT_TYPE = 'customer_order_adjustment_choice';
const REQUEST_SOURCE = 'customer_order_adjustment';
const REQUEST_VERSION = 1;
const TOKEN_BYTES = 32;
const TOKEN_MAX_LENGTH = 256;
const APP_ORIGIN = 'https://nuvirajuice.com';
const TIME_ZONE = 'America/Chicago';

export const CUSTOMER_ORDER_ADJUSTMENT_ACTIONS = new Set([
  'prepare_customer_order_adjustment',
  'get_customer_order_adjustment',
  'submit_customer_order_adjustment',
]);

export const CUSTOMER_ORDER_ADJUSTMENT_CHOICES = Object.freeze({
  full_order_saturday: {
    label: 'Deliver my full order Saturday',
    short_label: 'Full order Saturday',
    description: 'NuVira will produce the complete order Friday and deliver everything together Saturday.',
    recommended: true,
  },
  oasis_saturday: {
    label: 'Deliver only OASIS Saturday',
    short_label: 'OASIS Saturday',
    description: 'Keep the available items on the current schedule and deliver OASIS separately Saturday.',
    recommended: false,
  },
  oasis_refund: {
    label: 'Refund the OASIS portion',
    short_label: 'Refund OASIS',
    description: 'Keep the available items on the current schedule and request a refund for the OASIS portion.',
    recommended: false,
  },
});

function text(value, max = 240) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function lower(value, max = 240) {
  return text(value, max).toLowerCase();
}

function money(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function normalizeOrderNumber(value) {
  return text(value, 80).replace(/^#/, '');
}

function validIsoDate(value) {
  const date = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? '' : date;
}

function formatDate(value) {
  const date = validIsoDate(value);
  if (!date) return 'the scheduled date';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date(`${date}T12:00:00Z`));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export async function hashCustomerAdjustmentToken(token, cryptoImpl = crypto) {
  const digest = await cryptoImpl.subtle.digest('SHA-256', new TextEncoder().encode(String(token || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function newCustomerAdjustmentToken(cryptoImpl = crypto) {
  return base64Url(cryptoImpl.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

export async function deriveCustomerAdjustmentToken(secret, orderNumber, requestId, cryptoImpl = crypto) {
  const key = await cryptoImpl.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await cryptoImpl.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${normalizeOrderNumber(orderNumber)}:${text(requestId, 180)}`),
  );
  return base64Url(new Uint8Array(signature));
}

function tokenFromBody(body) {
  const token = text(body?.token, TOKEN_MAX_LENGTH);
  return /^[A-Za-z0-9_-]{32,256}$/.test(token) ? token : '';
}

function customerFirstName(value) {
  return text(value, 100).split(' ').filter(Boolean)[0] || 'there';
}

function choiceList(refundAmount) {
  return Object.entries(CUSTOMER_ORDER_ADJUSTMENT_CHOICES).map(([id, choice]) => ({
    id,
    ...choice,
    description: id === 'oasis_refund'
      ? `Keep the available items on the current schedule and request a $${money(refundAmount).toFixed(2)} refund for the OASIS portion.`
      : choice.description,
  }));
}

async function collect(entity, filters, sort = '-created_date', limit = 20) {
  const rows = [];
  if (!entity) return rows;
  for (const filter of filters) {
    try {
      for (const row of await entity.filter(filter, sort, limit)) {
        if (row?.id && !rows.some((candidate) => candidate.id === row.id)) rows.push(row);
      }
    } catch {}
  }
  return rows;
}

async function loadOrderContext(base44, orderNumber) {
  const entities = base44.asServiceRole.entities;
  const customerOrders = await collect(entities.Order, [{ order_number: orderNumber }]);
  const operationalOrders = await collect(entities.ShopifyOrder, [
    { order_number: orderNumber },
    { shopify_order_number: orderNumber },
  ]);
  if (customerOrders.length !== 1 || operationalOrders.length !== 1) {
    return { error: customerOrders.length === 0 ? 'order_not_found' : 'order_context_ambiguous' };
  }

  const customerOrder = customerOrders[0];
  const operationalOrder = operationalOrders[0];
  const ids = [customerOrder.id, operationalOrder.id].filter(Boolean);
  const tasks = await collect(entities.FulfillmentTask, [
    { order_number: orderNumber },
    { shopify_order_number: orderNumber },
    ...ids.flatMap((id) => [
      { order_id: id },
      { base44_order_id: id },
      { shopify_order_id: id },
      { native_shopify_order_id: id },
    ]),
  ]);

  return { customerOrder, operationalOrder, tasks };
}

function findTrioLine(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items.find((item) => lower(item?.title, 120).includes('nuvira trio')) || null;
}

async function computeOasisRefundAmount(base44, customerOrder) {
  const trio = findTrioLine(customerOrder);
  if (!trio || Number(trio.quantity || 0) !== 1 || money(trio.price) <= 0) {
    return { error: 'supported_trio_line_not_found' };
  }
  const title = text(trio.title, 120);
  const bundles = await collect(base44.asServiceRole.entities.Bundle, [{ bundle_name: title }], '-created_date', 5);
  const bundle = bundles.find((row) => Array.isArray(row?.components) && row.components.length > 0);
  if (!bundle) return { error: 'bundle_composition_unavailable' };

  const components = bundle.components
    .map((component) => ({ name: text(component?.product_name, 120), quantity: Number(component?.quantity || 0) }))
    .filter((component) => component.name && component.quantity > 0);
  const totalUnits = components.reduce((sum, component) => sum + component.quantity, 0);
  const oasisUnits = components
    .filter((component) => lower(component.name) === 'oasis')
    .reduce((sum, component) => sum + component.quantity, 0);
  if (totalUnits <= 0 || oasisUnits !== 1) return { error: 'oasis_bundle_component_ambiguous' };

  return {
    amount: money((money(trio.price) * oasisUnits) / totalUnits),
    bundle_name: title,
    components,
  };
}

function requestKey(digest) {
  return `customer_order_adjustment:${digest}`;
}

async function reviewByToken(base44, token, cryptoImpl = crypto) {
  if (!token) return null;
  const digest = await hashCustomerAdjustmentToken(token, cryptoImpl);
  const rows = await collect(base44.asServiceRole.entities.OrderReviewQueue, [{ idempotency_key: requestKey(digest) }], '-created_date', 2);
  return rows.find((row) => row?.incident_type === REQUEST_INCIDENT_TYPE) || null;
}

function safeRequestView(review) {
  const payload = review?.incoming_payload && typeof review.incoming_payload === 'object'
    ? review.incoming_payload
    : {};
  const refundAmount = money(payload.oasis_refund_amount);
  return {
    request_state: text(payload.request_state, 60) || 'awaiting_customer',
    order_number: text(review?.existing_order_number, 80),
    customer_first_name: customerFirstName(review?.customer_name),
    current_delivery_date: validIsoDate(payload.current_delivery_date),
    current_delivery_label: formatDate(payload.current_delivery_date),
    target_delivery_date: validIsoDate(payload.target_delivery_date),
    target_delivery_label: formatDate(payload.target_delivery_date),
    target_production_date: validIsoDate(payload.target_production_date),
    target_production_label: formatDate(payload.target_production_date),
    expires_at: text(payload.expires_at, 80),
    selected_choice: text(payload.selected_choice, 80) || null,
    selected_at: text(payload.selected_at, 80) || null,
    oasis_refund_amount: refundAmount,
    choices: choiceList(refundAmount),
  };
}

function expired(review, now) {
  const expiresAt = review?.incoming_payload?.expires_at;
  const timestamp = Date.parse(expiresAt || '');
  return !Number.isFinite(timestamp) || timestamp <= now.getTime();
}

function selectionGuidance(choice, refundAmount, currentDate, targetDate) {
  if (choice === 'full_order_saturday') {
    return `Customer selected full-order delivery on ${formatDate(targetDate)}. Produce the complete order Friday and deliver all items together Saturday.`;
  }
  if (choice === 'oasis_saturday') {
    return `Customer selected split delivery. Keep available items on ${formatDate(currentDate)} and produce OASIS Friday for delivery ${formatDate(targetDate)}.`;
  }
  return `Customer requested a $${money(refundAmount).toFixed(2)} partial refund for OASIS. Keep available items on ${formatDate(currentDate)} and do not produce or deliver OASIS.`;
}

function emailHtml({ orderNumber, firstName, token, currentDate, targetDate, refundAmount }) {
  const baseUrl = `${APP_ORIGIN}/order-options?token=${encodeURIComponent(token)}`;
  const links = Object.keys(CUSTOMER_ORDER_ADJUSTMENT_CHOICES).reduce((out, choice) => {
    out[choice] = `${baseUrl}&choice=${encodeURIComponent(choice)}`;
    return out;
  }, {});
  return `<!doctype html>
<html><body style="margin:0;background:#f3f7f3;font-family:Arial,sans-serif;color:#15211a">
  <div style="max-width:620px;margin:0 auto;padding:28px 18px">
    <div style="background:#0d1b14;color:#fff;padding:26px;border-radius:12px 12px 0 0">
      <div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#8fdda8">NuVira Juice Co.</div>
      <h1 style="margin:10px 0 0;font-size:27px;line-height:1.15">Please choose an update for order ${escapeHtml(orderNumber)}</h1>
    </div>
    <div style="background:#fff;padding:26px;border:1px solid #dfe9e1;border-top:0;border-radius:0 0 12px 12px">
      <p style="font-size:16px;line-height:1.6;margin-top:0">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:16px;line-height:1.6">We are reaching out before production because our OASIS labels will arrive later this week. Please choose the option that works best for you.</p>
      <div style="background:#eef8f0;border-left:4px solid #24a854;padding:16px;margin:20px 0">
        <strong>Our freshness-first recommendation</strong><br>
        <span style="line-height:1.5">Have the complete order produced Friday and delivered together ${escapeHtml(formatDate(targetDate))}. This keeps every juice in one fresh delivery, but the final choice is entirely yours.</span>
      </div>
      <a href="${escapeHtml(links.full_order_saturday)}" style="display:block;text-align:center;text-decoration:none;background:#159947;color:#fff;font-weight:700;padding:14px 16px;border-radius:8px;margin:12px 0">Deliver my full order Saturday</a>
      <a href="${escapeHtml(links.oasis_saturday)}" style="display:block;text-align:center;text-decoration:none;background:#fff;color:#174c2b;font-weight:700;padding:13px 16px;border:1px solid #83b691;border-radius:8px;margin:12px 0">Keep ${escapeHtml(formatDate(currentDate))}; deliver OASIS Saturday</a>
      <a href="${escapeHtml(links.oasis_refund)}" style="display:block;text-align:center;text-decoration:none;background:#fff;color:#6c351e;font-weight:700;padding:13px 16px;border:1px solid #d5a188;border-radius:8px;margin:12px 0">Request a $${money(refundAmount).toFixed(2)} OASIS refund</a>
      <p style="font-size:13px;line-height:1.5;color:#657067;margin-bottom:0">Each button opens a confirmation page. Nothing changes until you confirm your selection. Please choose as soon as you can so we can plan production accurately.</p>
    </div>
  </div>
</body></html>`;
}

async function deliveryLog(base44, idempotencyKey) {
  const rows = await collect(base44.asServiceRole.entities.CustomerMessageDeliveryLog, [{ idempotency_key: idempotencyKey }], '-created_date', 1);
  return rows[0] || null;
}

async function writeDeliveryLog(base44, existing, payload) {
  return existing?.id
    ? await base44.asServiceRole.entities.CustomerMessageDeliveryLog.update(existing.id, payload)
    : await base44.asServiceRole.entities.CustomerMessageDeliveryLog.create(payload);
}

async function sendChoiceEmail({ base44, review, order, token, fetchImpl, envGet, now }) {
  const apiKey = text(envGet('RESEND_API_KEY'), 1000);
  if (!apiKey) return { sent: false, reason: 'email_service_not_configured' };
  const payload = review.incoming_payload || {};
  const idempotencyKey = `customer_order_adjustment_email:${review.id}`;
  const existing = await deliveryLog(base44, idempotencyKey);
  if (existing && ['sent', 'delivered'].includes(existing.status)) {
    return { sent: true, skipped: true, reason: 'duplicate_idempotency_key' };
  }
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: 'NuVira Juice Co <info@nuvirajuice.com>',
      to: order.customer_email,
      reply_to: 'support@nuvirajuice.com',
      subject: `Please choose an update for NuVira order ${order.order_number}`,
      html: emailHtml({
        orderNumber: order.order_number,
        firstName: customerFirstName(order.customer_name),
        token,
        currentDate: payload.current_delivery_date,
        targetDate: payload.target_delivery_date,
        refundAmount: payload.oasis_refund_amount,
      }),
    }),
  });
  const result = await response.json().catch(() => ({}));
  await writeDeliveryLog(base44, existing, {
    idempotency_key: idempotencyKey,
    channel: 'email',
    message_type: 'transactional_order',
    order_id: order.id,
    order_number: order.order_number,
    customer_email: order.customer_email,
    provider: 'resend',
    provider_message_id: response.ok ? text(result?.id, 180) || null : null,
    status: response.ok ? 'sent' : 'failed',
    sent_at: response.ok ? now.toISOString() : null,
    error_message: response.ok ? null : `resend_status_${response.status}`,
    metadata: {
      request_id: review.id,
      source_function: 'processManualRefund',
      communication_subtype: 'customer_order_adjustment_choice',
    },
  });
  return response.ok
    ? { sent: true, provider_message_id: text(result?.id, 180) || null }
    : { sent: false, reason: 'email_provider_failed', status: response.status };
}

async function sendChoicePush({ base44, review, order, token, envGet }) {
  const internalToken = text(envGet('TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN'), 1000);
  if (!internalToken) return { sent: false, reason: 'transactional_internal_token_missing' };
  try {
    const result = await base44.functions.invoke('sendCustomerNotification', {
      customer_email: order.customer_email,
      type: 'order_update',
      notification_subtype: 'order_delayed',
      title: `Action needed for order ${order.order_number}`,
      message: 'Please choose Saturday delivery for the full order, a separate Saturday OASIS delivery, or an OASIS refund.',
      order_id: order.id,
      deep_link: `/order-options?token=${encodeURIComponent(token)}`,
      idempotency_key: `customer_order_adjustment_push:${review.id}`,
      delivery_key: `customer_order_adjustment_push:${review.id}`,
      source: 'elevated_transactional',
      notification_source: 'elevated_transactional',
      notification_origin: 'elevated_transactional',
      internal_token: internalToken,
      transactional_proof: internalToken,
      push_priority: 'high',
    });
    const data = result?.data || result || {};
    return {
      sent: data.push_sent === true,
      notification_created: Boolean(data.notification_id || data.existing_id),
      push_attempted: data.push_attempted === true,
      reason: text(data.push_skipped_reason || data.reason, 180) || null,
    };
  } catch {
    return { sent: false, notification_created: false, push_attempted: false, reason: 'notification_dispatch_failed' };
  }
}

async function pauseFulfillmentTasks(base44, tasks, now, reviewId) {
  const updated = [];
  for (const task of tasks) {
    if (['delivered', 'cancelled', 'canceled'].includes(lower(task.status, 60))) continue;
    const audit = Array.isArray(task.audit_trail) ? task.audit_trail : [];
    const record = await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
      status: 'needs_review',
      review_status: 'customer_choice_pending',
      review_reason: 'OASIS unavailable; customer delivery/refund selection pending.',
      internal_notes: 'Do not pack or route until the customer order-adjustment choice is recorded.',
      audit_trail: [...audit, {
        event: 'customer_order_adjustment_requested',
        timestamp: now.toISOString(),
        source: REQUEST_SOURCE,
        review_id: reviewId,
      }],
    });
    updated.push(record.id);
  }
  return updated;
}

async function prepareRequest({ base44, body, caller, fetchImpl, envGet, cryptoImpl, now }) {
  if (!caller || !['admin', 'owner'].includes(lower(caller.role, 30))) {
    return Response.json({ error: 'Admin access required' }, { status: 403 });
  }
  const orderNumber = normalizeOrderNumber(body?.order_number);
  const targetDeliveryDate = validIsoDate(body?.target_delivery_date);
  const targetProductionDate = validIsoDate(body?.target_production_date);
  const expiresAt = text(body?.expires_at, 80);
  const requestId = text(body?.request_id, 160);
  if (!orderNumber || !targetDeliveryDate || !targetProductionDate || !Number.isFinite(Date.parse(expiresAt)) || !/^[A-Za-z0-9:._-]{8,160}$/.test(requestId)) {
    return Response.json({ error: 'order_number, request_id, target_delivery_date, target_production_date, and expires_at are required' }, { status: 400 });
  }

  const context = await loadOrderContext(base44, orderNumber);
  if (context.error) return Response.json({ error: context.error }, { status: context.error === 'order_not_found' ? 404 : 409 });
  const { customerOrder, operationalOrder, tasks } = context;
  if (lower(customerOrder.payment_status) !== 'paid' || ['delivered', 'cancelled', 'canceled', 'refunded'].includes(lower(customerOrder.status))) {
    return Response.json({ error: 'order_not_eligible_for_adjustment' }, { status: 409 });
  }
  if (!customerOrder.customer_email || !customerOrder.customer_name) {
    return Response.json({ error: 'customer_identity_incomplete' }, { status: 409 });
  }

  const allocation = await computeOasisRefundAmount(base44, customerOrder);
  if (allocation.error) return Response.json({ error: allocation.error }, { status: 409 });
  const currentDeliveryDate = validIsoDate(
    operationalOrder.assigned_delivery_date
    || operationalOrder.selected_delivery_date
    || operationalOrder.requested_delivery_date
    || customerOrder.assigned_delivery_date
    || customerOrder.estimated_delivery_date,
  );
  if (!currentDeliveryDate) return Response.json({ error: 'current_delivery_date_unavailable' }, { status: 409 });

  const tokenSecret = text(envGet('TRANSACTIONAL_COMMUNICATIONS_INTERNAL_TOKEN'), 1000);
  if (!tokenSecret) return Response.json({ error: 'customer_adjustment_token_service_unavailable' }, { status: 503 });
  const token = await deriveCustomerAdjustmentToken(tokenSecret, orderNumber, requestId, cryptoImpl);
  const digest = await hashCustomerAdjustmentToken(token, cryptoImpl);
  const existingReviews = await collect(
    base44.asServiceRole.entities.OrderReviewQueue,
    [{ idempotency_key: requestKey(digest) }],
    '-created_date',
    1,
  );
  const reviewDraft = {
    incident_type: REQUEST_INCIDENT_TYPE,
    customer_email: customerOrder.customer_email,
    customer_name: customerOrder.customer_name,
    existing_order_id: customerOrder.id,
    existing_order_number: orderNumber,
    existing_order_type: 'customer_app_order',
    incoming_source: REQUEST_SOURCE,
    issue_description: 'OASIS is unavailable for the current production date. Customer choice requested before fulfillment.',
    recommended_action: 'Await the customer response. The freshness-first recommendation is full-order production Friday with Saturday delivery.',
    admin_notes: 'No refund, schedule change, production mutation, or customer-order mutation has been applied.',
    status: 'pending',
    idempotency_key: requestKey(digest),
    occurrence_count: 1,
    first_seen_at: now.toISOString(),
    last_seen_at: now.toISOString(),
    queue_visibility_status: 'visible',
    incoming_payload: {
      request_version: REQUEST_VERSION,
      request_id: requestId,
      request_state: 'awaiting_customer',
      current_delivery_date: currentDeliveryDate,
      current_production_date: validIsoDate(operationalOrder.production_date || customerOrder.production_date || customerOrder.assigned_production_day),
      target_delivery_date: targetDeliveryDate,
      target_production_date: targetProductionDate,
      oasis_refund_amount: allocation.amount,
      affected_product: 'OASIS',
      affected_bundle: allocation.bundle_name,
      allowed_choices: Object.keys(CUSTOMER_ORDER_ADJUSTMENT_CHOICES),
      selected_choice: null,
      selected_at: null,
      expires_at: new Date(expiresAt).toISOString(),
      customer_order_id: customerOrder.id,
      operational_order_id: operationalOrder.id,
      fulfillment_task_ids: tasks.map((task) => task.id),
    },
  };
  const review = existingReviews[0]
    || await base44.asServiceRole.entities.OrderReviewQueue.create(reviewDraft);

  const alreadyPausedTaskIds = tasks
    .filter((task) => task.review_status === 'customer_choice_pending' && task.status === 'needs_review')
    .map((task) => task.id);
  const pausedTaskIds = alreadyPausedTaskIds.length === tasks.length
    ? alreadyPausedTaskIds
    : await pauseFulfillmentTasks(base44, tasks.filter((task) => !alreadyPausedTaskIds.includes(task.id)), now, review.id);
  const emailResult = await sendChoiceEmail({ base44, review, order: customerOrder, token, fetchImpl, envGet, now });
  const pushResult = await sendChoicePush({ base44, review, order: customerOrder, token, envGet });

  return Response.json({
    success: emailResult.sent === true,
    request_id: review.id,
    order_number: orderNumber,
    request_state: 'awaiting_customer',
    oasis_refund_amount: allocation.amount,
    target_delivery_date: targetDeliveryDate,
    target_production_date: targetProductionDate,
    fulfillment_paused: pausedTaskIds.length > 0,
    paused_task_count: pausedTaskIds.length,
    email_sent: emailResult.sent === true,
    email_reason: emailResult.reason || null,
    notification_created: pushResult.notification_created === true,
    push_attempted: pushResult.push_attempted === true,
    push_sent: pushResult.sent === true,
    push_reason: pushResult.reason || null,
  }, { status: emailResult.sent === true ? 200 : 502 });
}

async function getRequest({ base44, body, cryptoImpl, now }) {
  const token = tokenFromBody(body);
  if (!token) return Response.json({ error: 'invalid_or_expired_link' }, { status: 404 });
  const review = await reviewByToken(base44, token, cryptoImpl);
  if (!review || expired(review, now)) return Response.json({ error: 'invalid_or_expired_link' }, { status: 404 });
  return Response.json({ success: true, request: safeRequestView(review) });
}

async function submitRequest({ base44, body, cryptoImpl, now }) {
  const token = tokenFromBody(body);
  const choice = text(body?.choice, 80);
  if (!token || !CUSTOMER_ORDER_ADJUSTMENT_CHOICES[choice]) {
    return Response.json({ error: 'invalid_selection' }, { status: 400 });
  }
  const review = await reviewByToken(base44, token, cryptoImpl);
  if (!review || expired(review, now)) return Response.json({ error: 'invalid_or_expired_link' }, { status: 404 });
  const payload = review.incoming_payload || {};
  if (payload.selected_choice) {
    if (payload.selected_choice === choice) {
      return Response.json({ success: true, skipped: true, reason: 'selection_already_recorded', request: safeRequestView(review) });
    }
    return Response.json({ error: 'selection_already_recorded', request: safeRequestView(review) }, { status: 409 });
  }

  const guidance = selectionGuidance(choice, payload.oasis_refund_amount, payload.current_delivery_date, payload.target_delivery_date);
  const updated = await base44.asServiceRole.entities.OrderReviewQueue.update(review.id, {
    status: 'reviewing',
    resolved_action: `customer_selected:${choice}`,
    recommended_action: guidance,
    admin_notes: 'Customer selection recorded. Operator confirmation is required before any refund, order schedule, production, or split-fulfillment mutation.',
    last_seen_at: now.toISOString(),
    incoming_payload: {
      ...payload,
      request_state: 'customer_selected',
      selected_choice: choice,
      selected_at: now.toISOString(),
    },
  });

  const taskIds = Array.isArray(payload.fulfillment_task_ids) ? payload.fulfillment_task_ids : [];
  for (const taskId of taskIds) {
    const task = await base44.asServiceRole.entities.FulfillmentTask.get(taskId).catch(() => null);
    if (!task?.id) continue;
    const audit = Array.isArray(task.audit_trail) ? task.audit_trail : [];
    await base44.asServiceRole.entities.FulfillmentTask.update(task.id, {
      status: 'needs_review',
      review_status: 'customer_choice_received',
      review_reason: guidance,
      internal_notes: 'Customer selection received. Follow the linked Order Review Queue action before packing or routing.',
      audit_trail: [...audit, {
        event: 'customer_order_adjustment_selected',
        timestamp: now.toISOString(),
        source: REQUEST_SOURCE,
        review_id: review.id,
        choice,
      }],
    });
  }

  const readback = await base44.asServiceRole.entities.OrderReviewQueue.get(updated.id).catch(() => updated);
  if (readback?.incoming_payload?.selected_choice !== choice) {
    return Response.json({ error: 'selection_conflict_detected' }, { status: 409 });
  }
  return Response.json({ success: true, request: safeRequestView(readback) });
}

export async function handleCustomerOrderAdjustmentRequest({
  base44,
  body,
  caller = null,
  fetchImpl = fetch,
  envGet = (name) => Deno.env.get(name),
  cryptoImpl = crypto,
  now = new Date(),
}) {
  const action = text(body?.action, 80);
  if (action === 'prepare_customer_order_adjustment') {
    return prepareRequest({ base44, body, caller, fetchImpl, envGet, cryptoImpl, now });
  }
  if (action === 'get_customer_order_adjustment') {
    return getRequest({ base44, body, cryptoImpl, now });
  }
  if (action === 'submit_customer_order_adjustment') {
    return submitRequest({ base44, body, cryptoImpl, now });
  }
  return Response.json({ error: 'unsupported_customer_order_adjustment_action' }, { status: 400 });
}
