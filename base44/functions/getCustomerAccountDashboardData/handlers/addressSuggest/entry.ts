// @ts-nocheck
// Public, read-only checkout address lookup. Never reads accounts or writes records.
// Keep the standalone and customer-gateway copies identical (G174 checks parity).
const ADDRESS_SUGGEST_REVISION = 'g174-guest-address-20260906';
const MAX_BODY_BYTES = 1024;
const MAX_QUERY_LENGTH = 200;
const LOOKUP_TIMEOUT_MS = 6000;
const WINDOW_MS = 60000;
// Worker-local defenses, not a distributed quota. Provider quotas remain the
// cross-worker cost ceiling. No query, address, raw IP, or API key is logged/stored.
const clientWindows = new Map();
let workerWindow = { starts: 0, count: 0 };
let activeLookups = 0;

function reply(body, status = 200, headers = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Address-Suggest-Revision': ADDRESS_SUGGEST_REVISION, ...headers },
  });
}

async function readBody(req) {
  const reader = req.body?.getReader();
  if (!reader) return {};
  const decoder = new TextDecoder();
  let raw = '';
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return reply({ error: 'request_too_large' }, 413);
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
    return raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return reply({ error: 'malformed_json' }, 400);
  } finally {
    reader.releaseLock();
  }
}

async function allowLookup(req) {
  const now = Date.now();
  // Only use the edge header as an additional fairness hint; the independent
  // worker-wide ceiling also applies when it is missing or varies.
  const edgeIp = req.headers.get('cf-connecting-ip') || '';
  const hash = edgeIp && edgeIp.length <= 64
    ? Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(edgeIp))))
      .map(byte => byte.toString(16).padStart(2, '0')).join('')
    : '';
  if (now - workerWindow.starts >= WINDOW_MS) workerWindow = { starts: now, count: 0 };
  for (const [key, bucket] of clientWindows) {
    if (now - bucket.starts >= WINDOW_MS) clientWindows.delete(key);
  }
  if (activeLookups >= 4 || workerWindow.count >= 120) return false;
  const bucket = hash ? clientWindows.get(hash) : null;
  if (bucket?.count >= 30 || (hash && !bucket && clientWindows.size >= 500)) return false;
  workerWindow.count += 1;
  if (hash) clientWindows.set(hash, { starts: bucket?.starts ?? now, count: (bucket?.count || 0) + 1 });
  activeLookups += 1;
  return true;
}

async function googleJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('address_provider_unavailable');
  return await response.json();
}

async function handler(req) {
  if (req.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });
  const body = await readBody(req);
  if (body instanceof Response) return body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'invalid_request' }, 400);
  const query = body.query ?? '';
  if (typeof query !== 'string' || query.length > MAX_QUERY_LENGTH || /[\u0000-\u001f\u007f]/.test(query)) {
    return reply({ error: 'invalid_query' }, 400);
  }
  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  if (normalizedQuery.length < 3) return reply({ suggestions: [] });
  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
  if (!apiKey) return reply({ error: 'address_lookup_unavailable' }, 503);
  if (!await allowLookup(req)) return reply({ error: 'address_lookup_rate_limited' }, 429, { 'Retry-After': '60' });

  try {
    const signal = AbortSignal.timeout(LOOKUP_TIMEOUT_MS);
    const params = new URLSearchParams({
      input: normalizedQuery, types: 'address', components: 'country:us',
      location: '38.8106,-90.6998', radius: '40000', key: apiKey,
    });
    const data = await googleJson('https://maps.googleapis.com/maps/api/place/autocomplete/json?' + params, signal);
    if (data.status === 'ZERO_RESULTS') return reply({ suggestions: [] });
    if (data.status !== 'OK' || !Array.isArray(data.predictions)) throw new Error('address_provider_unavailable');
    const predictions = data.predictions.slice(0, 5).filter(prediction =>
      typeof prediction?.place_id === 'string' && prediction.place_id.length <= 512
    );
    const suggestions = (await Promise.all(predictions.map(async prediction => {
      try {
        const detailParams = new URLSearchParams({ place_id: prediction.place_id, fields: 'address_components', key: apiKey });
        const details = await googleJson('https://maps.googleapis.com/maps/api/place/details/json?' + detailParams, signal);
        if (details.status !== 'OK' || !Array.isArray(details.result?.address_components)) return null;
        const components = details.result.address_components;
        const get = (type, short = false) => {
          const value = components.find(item => Array.isArray(item?.types) && item.types.includes(type))?.[short ? 'short_name' : 'long_name'];
          return typeof value === 'string' ? value.slice(0, 200) : '';
        };
        const street = [get('street_number'), get('route')].filter(Boolean).join(' ');
        const city = get('locality') || get('sublocality') || get('administrative_area_level_3');
        const state = get('administrative_area_level_1', true);
        const zip = get('postal_code');
        if (!street || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(-\d{4})?$/.test(zip) || get('country', true) !== 'US') return null;
        return { street, city, state, zip, display: [street, city, state + ' ' + zip].join(', ') };
      } catch {
        return null;
      }
    }))).filter(Boolean);
    if (predictions.length && !suggestions.length) return reply({ error: 'address_lookup_unavailable' }, 503);
    return reply({ suggestions });
  } catch {
    // Do not log provider exceptions: they may contain the query or secret URL.
    return reply({ error: 'address_lookup_unavailable' }, 503);
  } finally {
    activeLookups -= 1;
  }
}

export default handler;
