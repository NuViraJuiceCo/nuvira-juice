const META_PIXEL_ID = '719023677458304';
const META_GRAPH_API_VERSION = 'v26.0';
const META_EVENTS_ENDPOINT = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${META_PIXEL_ID}/events`;
const META_PURCHASE_LOG_PREFIX = 'meta_capi_purchase';
const META_CATALOG_CONTENT_IDS = Object.freeze({
  '69d490ce699b5f1ac4dde495': '43220774813786', aura: '43220774813786',
  '69d490ce699b5f1ac4dde496': '43220774846554', 're-nu': '43220774846554', renu: '43220774846554',
  '69d490ce699b5f1ac4dde497': '43220774944858', oasis: '43220774944858',
  '69d490ce699b5f1ac4dde498': '43222070198362', 'the-nuvira-trio': '43222070198362',
  '69d5b9df48ee4ce27d9eb8fa': '43255063445594', 'orange-juice': '43255063445594',
  '69d5b9df48ee4ce27d9eb8fb': '43222071181402', 'pineapple-juice': '43222071181402',
  '69d5b9df48ee4ce27d9eb8fc': '43222071115866', 'watermelon-juice': '43222071115866',
  '69e95a6b3b4d04fb9b9599d5': '43296833044570', 'radiance-shot': '43296833044570',
  '69e95a6b3b4d04fb9b9599d6': '43296833011802', 'hydration-shot': '43296833011802',
  '69e95a6b3b4d04fb9b9599d7': '43296833077338', 'reset-shot': '43296833077338',
  '6a511e652e19910e6f789c2c': '43629081722970', 'large-nuvira-tote-bag': '43629081722970',
});

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

function catalogLookupKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normalizeMetaCatalogContentId(value) {
  const match = String(value || '').trim().match(/(?:ProductVariant\/)?(\d{10,20})$/);
  return match?.[1] || '';
}

export function metaCatalogContentIdForItem(item = {}) {
  for (const candidate of [item.meta_catalog_content_id, item.shopify_variant_id, item.shopify_pos_variant_id]) {
    const normalized = normalizeMetaCatalogContentId(candidate);
    if (normalized) return normalized;
  }
  for (const candidate of [item.product_id, item.id, item.slug, item.title, item.name, item.product_name]) {
    const raw = String(candidate || '').trim().toLowerCase();
    const resolved = META_CATALOG_CONTENT_IDS[raw] || META_CATALOG_CONTENT_IDS[catalogLookupKey(raw)];
    if (resolved) return resolved;
  }
  return '';
}

export function buildMetaCatalogContents(items) {
  return (Array.isArray(items) ? items : []).flatMap((item) => {
    const quantity = Math.max(1, Math.round(Number(item?.quantity) || 1));
    const itemPrice = validMoney(item?.price);
    const directId = metaCatalogContentIdForItem(item);
    if (directId && itemPrice > 0) return [{ id: directId, quantity, item_price: itemPrice }];

    const components = Array.isArray(item?.bundle_composition) ? item.bundle_composition : [];
    const componentQuantity = components.reduce(
      (sum, component) => sum + Math.max(0, Math.round(Number(component?.quantity) || 0)),
      0,
    );
    if (!item?.is_program || componentQuantity <= 0 || itemPrice <= 0) return [];
    const allocatedPrice = validMoney(itemPrice / componentQuantity);
    return components.map((component) => ({
      id: metaCatalogContentIdForItem(component),
      quantity: quantity * Math.max(0, Math.round(Number(component?.quantity) || 0)),
      item_price: allocatedPrice,
    })).filter((component) => component.id && component.quantity > 0);
  });
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

  const contents = buildMetaCatalogContents(order?.items?.length ? order.items : checkoutData?.items);
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
        ...(contents.length ? {
          content_ids: contents.map((item) => item.id),
          contents,
          num_items: contents.reduce((sum, item) => sum + item.quantity, 0),
        } : {}),
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
