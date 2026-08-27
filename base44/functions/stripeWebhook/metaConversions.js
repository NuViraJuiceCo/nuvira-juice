const META_PIXEL_ID = '719023677458304';
const META_GRAPH_API_VERSION = 'v26.0';
const META_EVENTS_ENDPOINT = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${META_PIXEL_ID}/events`;
const META_PURCHASE_LOG_PREFIX = 'meta_capi_purchase';

function envValue(env, name) {
  return String(env?.get?.(name) || '').trim();
}

function envEnabled(env, name) {
  return envValue(env, name).toLowerCase() === 'true';
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function normalizeUsPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return digits;
  return '';
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
}

function buildContents(items) {
  return (Array.isArray(items) ? items : [])
    .map((item, index) => ({
      id: String(item?.product_id || item?.id || `item-${index + 1}`).trim().slice(0, 100),
      quantity: Math.max(1, Math.round(Number(item?.quantity) || 1)),
      item_price: validMoney(item?.price),
    }))
    .filter((item) => item.id && item.item_price > 0);
}

function isTestOrder(order, metadata) {
  return order?.is_test_order === true
    || metadata?.internal_sandbox_checkout === 'true'
    || metadata?.is_test_order === 'true';
}

function eventIdForPayment(paymentIntentId) {
  return `stripe_purchase:${String(paymentIntentId || '').trim()}`;
}

function logIdForPayment(paymentIntentId) {
  return `${META_PURCHASE_LOG_PREFIX}:${String(paymentIntentId || '').trim()}`;
}

async function writeDeliveryLog(base44, {
  order,
  event,
  status,
  action,
  reason,
  idempotencyKey,
  success,
  errorCode = null,
}) {
  try {
    const now = new Date().toISOString();
    await base44.asServiceRole.entities.OrderSyncLog.create({
      order_number: String(order?.order_number || 'UNKNOWN').trim() || 'UNKNOWN',
      order_id: order?.id || null,
      status,
      description: reason,
      started_at: now,
      completed_at: now,
      triggered_by: 'stripe_webhook',
      event_type: 'meta.conversions_api.purchase',
      stripe_event_id: event?.id || null,
      action,
      reason,
      success,
      ...(errorCode ? { error_code: errorCode } : {}),
      idempotency_key: idempotencyKey,
    });
  } catch {
    console.warn('[Meta CAPI] delivery audit unavailable');
  }
}

export async function sendMetaPurchaseConversion({
  base44,
  event,
  paymentIntent,
  order,
  checkoutData = {},
  allowTestOrder = false,
  fetchImpl = fetch,
  env = Deno.env,
}) {
  const metadata = paymentIntent?.metadata || {};
  const paymentIntentId = String(paymentIntent?.id || '').trim();
  const orderNumber = String(order?.order_number || metadata.order_number || '').trim();
  if (!paymentIntentId || !orderNumber || paymentIntent?.status !== 'succeeded') {
    return { sent: false, reason: 'invalid_purchase_contract' };
  }

  const testOrder = isTestOrder(order, metadata);
  const testEventCode = envValue(env, 'META_CONVERSIONS_API_TEST_EVENT_CODE');
  const sandboxAllowed = testOrder
    && allowTestOrder
    && metadata.meta_capi_test_enabled === 'true'
    && envEnabled(env, 'ENABLE_META_CAPI_TEST_EVENTS')
    && Boolean(testEventCode);

  if (testOrder && !sandboxAllowed) return { sent: false, reason: 'test_order_suppressed' };
  if (!testOrder && !envEnabled(env, 'ENABLE_META_CAPI_PURCHASE')) {
    return { sent: false, reason: 'production_gate_disabled' };
  }
  if (!testOrder && metadata.marketing_measurement_consent !== 'granted') {
    return { sent: false, reason: 'marketing_consent_not_granted' };
  }

  const accessToken = envValue(env, 'META_CONVERSIONS_API_TOKEN');
  if (!accessToken) return { sent: false, reason: 'meta_capi_not_configured' };

  const idempotencyKey = logIdForPayment(paymentIntentId);
  const existingLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { idempotency_key: idempotencyKey },
    '-created_date',
    5,
  ).catch(() => []);
  if (existingLogs.some((row) => row?.status === 'success' && row?.success === true)) {
    return { sent: false, reason: 'already_delivered', deduplicated: true };
  }

  const email = normalizeEmail(order?.customer_email || metadata.customer_email);
  const phone = normalizeUsPhone(order?.contact_phone || metadata.customer_phone);
  const userData = {};
  if (email) userData.em = [await sha256Hex(email)];
  if (phone) userData.ph = [await sha256Hex(phone)];
  if (!userData.em && !userData.ph) return { sent: false, reason: 'matching_data_unavailable' };

  const contents = buildContents(order?.items?.length ? order.items : checkoutData?.items);
  const eventId = eventIdForPayment(paymentIntentId);
  const payload = {
    data: [{
      event_name: 'Purchase',
      event_time: Number(event?.created) || Math.floor(Date.now() / 1000),
      event_id: eventId,
      action_source: 'website',
      event_source_url: 'https://nuvirajuice.com/checkout',
      user_data: userData,
      custom_data: {
        currency: String(paymentIntent.currency || 'usd').toUpperCase(),
        value: validMoney(Number(paymentIntent.amount_received || 0) / 100),
        content_type: 'product',
        content_ids: contents.map((item) => item.id),
        contents,
        num_items: contents.reduce((sum, item) => sum + item.quantity, 0),
      },
    }],
    ...(sandboxAllowed ? { test_event_code: testEventCode } : {}),
  };

  try {
    const response = await fetchImpl(META_EVENTS_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    const accepted = response.ok && Number(result?.events_received) >= 1;
    if (!accepted) {
      const errorCode = `meta_http_${Number(response.status) || 500}`;
      await writeDeliveryLog(base44, {
        order: { ...order, order_number: orderNumber }, event, status: 'error',
        action: 'meta_capi_purchase_failed', reason: 'Meta Purchase event was not accepted; safe retry remains available.',
        idempotencyKey, success: false, errorCode,
      });
      return { sent: false, reason: 'provider_rejected', error_code: errorCode };
    }

    await writeDeliveryLog(base44, {
      order: { ...order, order_number: orderNumber }, event, status: 'success',
      action: 'meta_capi_purchase_sent', reason: sandboxAllowed
        ? 'Meta Purchase test event accepted for the isolated provider sandbox.'
        : 'Meta Purchase event accepted for a consented paid order.',
      idempotencyKey, success: true,
    });
    return { sent: true, event_id: eventId, test_event: sandboxAllowed };
  } catch {
    await writeDeliveryLog(base44, {
      order: { ...order, order_number: orderNumber }, event, status: 'error',
      action: 'meta_capi_purchase_failed', reason: 'Meta Purchase transport failed; safe retry remains available.',
      idempotencyKey, success: false, errorCode: 'meta_transport_failed',
    });
    return { sent: false, reason: 'transport_failed', error_code: 'meta_transport_failed' };
  }
}

export const META_CONVERSIONS_CONTRACT = Object.freeze({
  pixel_id: META_PIXEL_ID,
  graph_api_version: META_GRAPH_API_VERSION,
  endpoint: META_EVENTS_ENDPOINT,
});
