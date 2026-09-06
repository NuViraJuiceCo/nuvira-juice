import { buildMetaUserData, META_CONVERSIONS_CONTRACT } from '../../../../shared/metaIdentity.js';

const EVENTS = new Set(['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo']);
const ORIGINS = new Set(['https://nuvirajuice.com', 'https://www.nuvirajuice.com']);
const EVENT_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 16384;
const MAX_CACHE_ENTRIES = 2000;

function validSourceUrl(value) {
  try {
    const url = new URL(value);
    if (!ORIGINS.has(url.origin) || url.username || url.password) return '';
    // Only commerce routes may enter this public telemetry endpoint.
    if (!/^\/(?:shop(?:\/[^/]+)?|products\/[^/]+|product\/[^/]+\.html|program\/[^/]+|cart|checkout)?\/?$/i.test(url.pathname)) return '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function requestIp(req) {
  for (const header of ['cf-connecting-ip', 'true-client-ip', 'x-real-ip', 'x-forwarded-for']) {
    const value = String(req.headers.get(header) || '').split(',')[0].trim();
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every((part) => Number(part) <= 255)) return value;
    if (/^[a-f0-9:]{3,45}$/i.test(value) && value.includes(':')) return value;
  }
  return '';
}

function customData(input) {
  if (!input || input.currency !== 'USD' || input.content_type !== 'product') return null;
  if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || input.value > 100000) return null;
  const result = { currency: 'USD', content_type: 'product', value: Math.round(input.value * 100) / 100 };
  if (input.contents !== undefined) {
    if (!Array.isArray(input.contents) || !input.contents.length || input.contents.length > 100) return null;
    const contents = [];
    for (const item of input.contents) {
      if (!/^\d{10,20}$/.test(item?.id) || !Number.isInteger(item?.quantity) || item.quantity < 1 || item.quantity > 1000) return null;
      if (typeof item.item_price !== 'number' || !Number.isFinite(item.item_price) || item.item_price < 0 || item.item_price > 100000) return null;
      contents.push({ id: String(item.id), quantity: item.quantity, item_price: Math.round(item.item_price * 100) / 100 });
    }
    result.contents = contents;
    result.content_ids = contents.map((item) => item.id);
    result.num_items = contents.reduce((sum, item) => sum + item.quantity, 0);
  } else if (Number.isInteger(input.num_items) && input.num_items > 0 && input.num_items <= 1000) {
    result.num_items = input.num_items;
  }
  // Free-text names, URLs, and arbitrary customer fields are never forwarded.
  return result;
}

function json(body, status = 200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export function createMetaFunnelHandler({ env, getUser = async (_req) => null, fetchImpl = fetch, now = Date.now, log = console.info }) {
  const recent = new Map();
  const rates = new Map();
  const inFlight = new Map();
  const prune = (map, cutoff) => {
    for (const [key, value] of map) if (value.time < cutoff) map.delete(key);
    while (map.size >= MAX_CACHE_ENTRIES) map.delete(map.keys().next().value);
  };
  const limited = (key, max, time) => {
    const bucket = rates.get(key);
    if (bucket && time - bucket.time < 60000) {
      bucket.count += 1;
      return bucket.count > max;
    }
    rates.set(key, { time, count: 1 });
    return false;
  };

  return async function handler(req) {
    if (req.method !== 'POST') return json({ sent: false, reason: 'method_not_allowed' }, 405);
    if (!ORIGINS.has(req.headers.get('origin'))) return json({ sent: false, reason: 'origin_not_allowed' }, 403);
    const mode = String(env.get('META_CAPI_FUNNEL_MODE') || '').trim();
    if (!['test', 'live'].includes(mode)) return json({ sent: false, reason: 'funnel_disabled' });
    const token = String(env.get('META_CONVERSIONS_API_TOKEN') || '').trim();
    const testCode = String(env.get('META_CONVERSIONS_API_TEST_EVENT_CODE') || '').trim();
    if (!token || (mode === 'test' && !testCode)) return json({ sent: false, reason: 'funnel_not_configured' });
    if (!req.headers.get('content-type')?.includes('application/json')) return json({ sent: false, reason: 'invalid_content_type' }, 415);
    if (Number(req.headers.get('content-length')) > MAX_BODY_BYTES) return json({ sent: false, reason: 'payload_too_large' }, 413);
    let body;
    try {
      const raw = await req.text();
      if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) return json({ sent: false, reason: 'payload_too_large' }, 413);
      body = JSON.parse(raw);
    } catch {
      return json({ sent: false, reason: 'invalid_json' }, 400);
    }
    if (body?.marketing_measurement_consent !== 'granted') return json({ sent: false, reason: 'marketing_consent_not_granted' });
    const eventName = body.event_name;
    const eventId = body.event_id;
    const time = now();
    const eventTime = body.event_time;
    const sourceUrl = validSourceUrl(body.attribution?.event_source_url);
    const data = customData(body.custom_data);
    if (!EVENTS.has(eventName) || typeof eventId !== 'string'
      || !new RegExp(`^web:${eventName}:[A-Za-z0-9-]{12,80}$`).test(eventId)
      || !Number.isInteger(eventTime) || eventTime * 1000 < time - EVENT_TTL_MS || eventTime * 1000 > time + 60000
      || !sourceUrl || !data) return json({ sent: false, reason: 'invalid_event' }, 400);

    prune(recent, time - EVENT_TTL_MS);
    prune(rates, time - 60000);
    const key = `${mode}:${eventId}`;
    if (recent.has(key)) return json({ sent: true, deduplicated: true, event_id: eventId });
    if (inFlight.has(key)) return json(await inFlight.get(key));
    const ip = requestIp(req);
    if (limited('all', 600, time) || limited(`ip:${ip || 'unknown'}`, 60, time)) {
      return json({ sent: false, reason: 'rate_limited' }, 429);
    }

    const send = async () => {
      let user = null;
      let userTimer;
      try {
        user = await Promise.race([
          Promise.resolve().then(() => getUser(req)).catch(() => null),
          new Promise((resolve) => { userTimer = setTimeout(() => resolve(null), 750); }),
        ]);
      } finally {
        clearTimeout(userTimer);
      }
      const { userData } = await buildMetaUserData({
        order: { user_id: user?.id, customer_email: user?.email, customer_name: user?.full_name },
        checkoutData: {
          meta_capi_context: {
            fbp: body.attribution?.fbp,
            fbc: body.attribution?.fbc,
            client_ip_address: ip,
            client_user_agent: req.headers.get('user-agent') || '',
            event_source_url: sourceUrl,
          },
        },
      });
      // A visitor's country must not be inferred from our delivery region.
      delete userData.country;
      if (!userData.em && !userData.external_id && !userData.fbp && !userData.fbc
        && !(userData.client_ip_address && userData.client_user_agent)) {
        return { sent: false, reason: 'matching_data_unavailable' };
      }
      const payload = {
        data: [{
          event_name: eventName, event_id: eventId, event_time: eventTime,
          action_source: 'website', event_source_url: sourceUrl,
          user_data: userData, custom_data: data,
        }],
        ...(mode === 'test' ? { test_event_code: testCode } : {}),
      };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4000);
      try {
        const response = await fetchImpl(META_CONVERSIONS_CONTRACT.endpoint, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload), signal: controller.signal,
        });
        const result = await response.json().catch(() => ({}));
        const sent = response.ok && Number(result.events_received) >= 1;
        if (sent) recent.set(key, { time: now() });
        const outcome = { sent, event_id: eventId, event_name: eventName, mode, reason: sent ? 'accepted' : 'provider_rejected' };
        log('[Meta funnel]', JSON.stringify(outcome));
        return outcome;
      } catch {
        log('[Meta funnel]', JSON.stringify({ sent: false, event_id: eventId, event_name: eventName, mode, reason: 'transport_failed' }));
        return { sent: false, reason: 'transport_failed' };
      } finally {
        clearTimeout(timer);
      }
    };
    const pending = send().catch(() => ({ sent: false, reason: 'funnel_unavailable' }));
    inFlight.set(key, pending);
    try {
      return json(await pending);
    } finally {
      inFlight.delete(key);
    }
  };
}
