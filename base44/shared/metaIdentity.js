const META_PIXEL_ID = '719023677458304';

const META_GRAPH_API_VERSION = 'v26.0';

const META_EVENTS_ENDPOINT = `https://graph.facebook.com/${META_GRAPH_API_VERSION}/${META_PIXEL_ID}/events`;

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

function normalizeHashText(value, maxLength = 120) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, maxLength);
}

function normalizeNameForHash(value) {
  return normalizeHashText(value, 80);
}

function normalizeCityForHash(value) {
  return normalizeHashText(value, 80);
}

function normalizeStateForHash(value) {
  const normalized = normalizeHashText(value, 20);
  return normalized.length === 2 ? normalized : '';
}

function normalizePostalForHash(value) {
  const raw = String(value || '').trim().toLowerCase();
  const usZip = raw.match(/\b(\d{5})(?:-\d{4})?\b/);
  if (usZip) return usZip[1];
  return raw.replace(/[^a-z0-9]/g, '').slice(0, 20);
}

function normalizeCountryForHash(value) {
  const normalized = normalizeHashText(value || 'US', 30);
  if (!normalized || normalized === 'usa' || normalized === 'unitedstates') return 'us';
  return normalized.length === 2 ? normalized : '';
}

const META_BROWSER_ID_PATTERN = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9._-]{1,220}$/;

function safeMetaText(value, maxLength = 500) {
  return String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function normalizeMetaBrowserId(value) {
  const normalized = safeMetaText(value, 260);
  return META_BROWSER_ID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeClientIpAddress(value) {
  const normalized = safeMetaText(value, 60).replace(/^\[|\]$/g, '');
  return /^[0-9a-fA-F:.]{3,45}$/.test(normalized) ? normalized : '';
}

function normalizeMetaEventSourceUrl(value) {
  const fallback = 'https://nuvirajuice.com/checkout';
  const raw = safeMetaText(value, 500);
  if (!raw) return fallback;
  try {
    const url = new URL(raw, fallback);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !['nuvirajuice.com', 'www.nuvirajuice.com'].includes(host)) {
      return fallback;
    }
    url.search = '';
    url.hash = '';
    return url.toString().slice(0, 500);
  } catch {
    return fallback;
  }
}

function firstNonEmpty(...values) {
  return values.find((value) => String(value || '').trim()) || '';
}

function splitHumanName(value) {
  const parts = String(value || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  if (parts.length < 2 || String(value || '').includes('@')) return {};
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function addHashedUserData(userData, key, value) {
  const normalized = String(value || '').trim();
  if (!normalized) return;
  userData[key] = [await sha256Hex(normalized)];
}

function resolveMetaAttributionContext(checkoutData = {}) {
  const nested = checkoutData?.meta_capi_context && typeof checkoutData.meta_capi_context === 'object'
    ? checkoutData.meta_capi_context
    : {};
  return {
    fbp: normalizeMetaBrowserId(firstNonEmpty(nested.fbp, checkoutData.fbp)),
    fbc: normalizeMetaBrowserId(firstNonEmpty(nested.fbc, checkoutData.fbc)),
    client_ip_address: normalizeClientIpAddress(firstNonEmpty(nested.client_ip_address, checkoutData.client_ip_address)),
    client_user_agent: safeMetaText(firstNonEmpty(nested.client_user_agent, checkoutData.client_user_agent), 500),
    event_source_url: normalizeMetaEventSourceUrl(firstNonEmpty(nested.event_source_url, checkoutData.event_source_url)),
  };
}

export async function buildMetaUserData({ order = {}, metadata = {}, checkoutData = {} }) {
  const nameParts = splitHumanName(firstNonEmpty(
    order.customer_name,
    checkoutData.customer_name,
    metadata.customer_name,
  ));
  const email = normalizeEmail(firstNonEmpty(order.customer_email, checkoutData.customer_email, metadata.customer_email));
  const phone = normalizeUsPhone(firstNonEmpty(order.contact_phone, checkoutData.contact_phone, metadata.customer_phone));
  const firstName = normalizeNameForHash(firstNonEmpty(
    checkoutData.customer_first_name,
    metadata.customer_first_name,
    nameParts.firstName,
  ));
  const lastName = normalizeNameForHash(firstNonEmpty(
    checkoutData.customer_last_name,
    metadata.customer_last_name,
    nameParts.lastName,
  ));
  const city = normalizeCityForHash(firstNonEmpty(order.address_city, checkoutData.address_city, metadata.delivery_city));
  const state = normalizeStateForHash(firstNonEmpty(order.address_state, checkoutData.address_state, metadata.delivery_state));
  const postalCode = normalizePostalForHash(firstNonEmpty(
    order.address_postal_code,
    checkoutData.address_postal_code,
    metadata.delivery_postal_code,
  ));
  const country = normalizeCountryForHash(firstNonEmpty(order.address_country, checkoutData.address_country, 'US'));
  const externalId = normalizeHashText(firstNonEmpty(
    order.customer_app_user_id,
    order.user_id,
    checkoutData.customer_app_user_id,
    checkoutData.user_id,
    checkoutData.customer_id,
    email,
  ), 180);
  const attribution = resolveMetaAttributionContext(checkoutData);

  const userData = {};
  await addHashedUserData(userData, 'em', email);
  await addHashedUserData(userData, 'ph', phone);
  await addHashedUserData(userData, 'fn', firstName);
  await addHashedUserData(userData, 'ln', lastName);
  await addHashedUserData(userData, 'ct', city);
  await addHashedUserData(userData, 'st', state);
  await addHashedUserData(userData, 'zp', postalCode);
  await addHashedUserData(userData, 'country', country);
  await addHashedUserData(userData, 'external_id', externalId);

  if (attribution.fbp) userData.fbp = attribution.fbp;
  if (attribution.fbc) userData.fbc = attribution.fbc;
  if (attribution.client_ip_address) userData.client_ip_address = attribution.client_ip_address;
  if (attribution.client_user_agent) userData.client_user_agent = attribution.client_user_agent;

  return { userData, eventSourceUrl: attribution.event_source_url };
}

export const META_CONVERSIONS_CONTRACT = Object.freeze({
  pixel_id: META_PIXEL_ID,
  graph_api_version: META_GRAPH_API_VERSION,
  endpoint: META_EVENTS_ENDPOINT,
});
