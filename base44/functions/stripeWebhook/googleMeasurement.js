const GOOGLE_ANALYTICS_MEASUREMENT_ID = 'G-H8R82365GM';
const GOOGLE_MEASUREMENT_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const GOOGLE_PURCHASE_LOG_PREFIX = 'ga4_measurement_purchase';
const GOOGLE_MEASUREMENT_TIMEOUT_MS = 3000;

function envValue(env, name) {
  return String(env?.get?.(name) || '').trim();
}

function envEnabled(env, name) {
  return envValue(env, name).toLowerCase() === 'true';
}

function validMoney(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
}

function safeText(value, maxLength = 100) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLength);
}

function isTestOrder(order, metadata) {
  return order?.is_test_order === true
    || metadata?.internal_sandbox_checkout === 'true'
    || metadata?.is_test_order === 'true';
}

export function normalizeGoogleMeasurementContext(value) {
  const clientId = String(value?.client_id || '').trim();
  const sessionId = String(value?.session_id || '').trim();
  if (!/^\d{1,20}\.\d{1,20}$/.test(clientId) || !/^\d{1,20}$/.test(sessionId) || Number(sessionId) <= 0) {
    return null;
  }
  return { client_id: clientId, session_id: sessionId };
}

export function buildGooglePurchaseItems(items) {
  return (Array.isArray(items) ? items : []).flatMap((item, index) => {
    const quantity = Math.max(1, Math.round(Number(item?.quantity) || 1));
    const price = validMoney(item?.price);
    const itemId = safeText(item?.product_id || item?.id || item?.slug, 100);
    const itemName = safeText(item?.title || item?.name || item?.product_name, 100);
    if (!itemId || !itemName || price <= 0) return [];
    return [{
      item_id: itemId,
      item_name: itemName,
      affiliation: 'NuVira Juice Co.',
      currency: 'USD',
      index,
      price,
      quantity,
      ...(safeText(item?.category, 100) ? { item_category: safeText(item.category, 100) } : {}),
      ...(safeText(item?.size, 100) ? { item_variant: safeText(item.size, 100) } : {}),
    }];
  });
}

async function writeMeasurementLog(base44, {
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
      order_number: safeText(order?.order_number || 'UNKNOWN', 100) || 'UNKNOWN',
      order_id: order?.id || null,
      status,
      description: reason,
      started_at: now,
      completed_at: now,
      triggered_by: 'stripe_webhook',
      event_type: 'google_analytics.measurement_protocol.purchase',
      stripe_event_id: event?.id || null,
      action,
      reason,
      success,
      ...(errorCode ? { error_code: errorCode } : {}),
      idempotency_key: idempotencyKey,
    });
  } catch {
    console.warn('[Google Measurement] delivery audit unavailable');
  }
}

export async function sendGooglePurchaseMeasurement({
  base44,
  event,
  paymentIntent,
  order,
  checkoutData = {},
  fetchImpl = fetch,
  env = Deno.env,
}) {
  const metadata = paymentIntent?.metadata || {};
  const paymentIntentId = safeText(paymentIntent?.id, 100);
  const orderNumber = safeText(order?.order_number || metadata.order_number, 100);
  if (!paymentIntentId || !orderNumber || paymentIntent?.status !== 'succeeded') {
    return { sent: false, reason: 'invalid_purchase_contract' };
  }
  if (isTestOrder(order, metadata)) return { sent: false, reason: 'test_order_suppressed' };
  if (!envEnabled(env, 'ENABLE_GOOGLE_MEASUREMENT_PROTOCOL_PURCHASE')) {
    return { sent: false, reason: 'production_gate_disabled' };
  }
  if (checkoutData?.analytics_measurement_consent !== 'granted') {
    return { sent: false, reason: 'analytics_consent_not_granted' };
  }

  const measurementContext = normalizeGoogleMeasurementContext(
    order?.google_measurement_context || checkoutData?.google_measurement_context,
  );
  if (!measurementContext) return { sent: false, reason: 'measurement_context_unavailable' };

  const apiSecret = envValue(env, 'GOOGLE_ANALYTICS_API_SECRET');
  if (!apiSecret) return { sent: false, reason: 'measurement_protocol_not_configured' };

  const idempotencyKey = `${GOOGLE_PURCHASE_LOG_PREFIX}:${paymentIntentId}`;
  const existingLogs = await base44.asServiceRole.entities.OrderSyncLog.filter(
    { idempotency_key: idempotencyKey },
    '-created_date',
    5,
  ).catch(() => []);
  if (existingLogs.some((row) => row?.status === 'success' && row?.success === true)) {
    return { sent: false, reason: 'already_delivered', deduplicated: true };
  }

  const items = buildGooglePurchaseItems(order?.items?.length ? order.items : checkoutData?.items);
  const shipping = validMoney(order?.delivery_fee ?? checkoutData?.delivery_fee);
  const total = validMoney(Number(paymentIntent?.amount_received || 0) / 100);
  const value = Math.max(0, Math.round((total - shipping) * 100) / 100);
  if (!items.length || value <= 0) return { sent: false, reason: 'purchase_payload_unavailable' };

  const coupon = safeText(
    order?.discount_codes?.[0] || order?.promotion_code || order?.referral_code
      || checkoutData?.discount_codes?.[0] || checkoutData?.promotion_code || checkoutData?.referral_code,
    100,
  );
  const payload = {
    client_id: measurementContext.client_id,
    timestamp_micros: (Number(event?.created) || Math.floor(Date.now() / 1000)) * 1_000_000,
    consent: {
      ad_user_data: 'DENIED',
      ad_personalization: 'DENIED',
    },
    events: [{
      name: 'purchase',
      params: {
        transaction_id: orderNumber,
        currency: 'USD',
        value,
        shipping,
        engagement_time_msec: 1,
        session_id: measurementContext.session_id,
        ...(coupon ? { coupon } : {}),
        items,
      },
    }],
  };

  const endpoint = `${GOOGLE_MEASUREMENT_ENDPOINT}?measurement_id=${encodeURIComponent(GOOGLE_ANALYTICS_MEASUREMENT_ID)}&api_secret=${encodeURIComponent(apiSecret)}`;
  try {
    const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(GOOGLE_MEASUREMENT_TIMEOUT_MS)
      : undefined;
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      const errorCode = `google_measurement_http_${Number(response.status) || 500}`;
      await writeMeasurementLog(base44, {
        order, event, status: 'error', action: 'ga4_purchase_failed',
        reason: 'Google Analytics Purchase event was not accepted; safe retry remains available.',
        idempotencyKey, success: false, errorCode,
      });
      return { sent: false, reason: 'provider_rejected', error_code: errorCode };
    }

    await writeMeasurementLog(base44, {
      order, event, status: 'success', action: 'ga4_purchase_sent',
      reason: 'Google Analytics Purchase transport accepted for a consented paid order.',
      idempotencyKey, success: true,
    });
    return { sent: true, transaction_id: orderNumber };
  } catch {
    await writeMeasurementLog(base44, {
      order, event, status: 'error', action: 'ga4_purchase_failed',
      reason: 'Google Analytics Purchase transport failed; safe retry remains available.',
      idempotencyKey, success: false, errorCode: 'google_measurement_transport_failed',
    });
    return { sent: false, reason: 'transport_failed', error_code: 'google_measurement_transport_failed' };
  }
}

export const GOOGLE_MEASUREMENT_CONTRACT = Object.freeze({
  measurement_id: GOOGLE_ANALYTICS_MEASUREMENT_ID,
  endpoint: GOOGLE_MEASUREMENT_ENDPOINT,
});
