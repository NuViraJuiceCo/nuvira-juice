import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MERCHANT_ID = Deno.env.get('GOOGLE_MERCHANT_ID');
const MERCHANT_DATA_SOURCE_ID = Deno.env.get('GOOGLE_MERCHANT_DATA_SOURCE_ID');
const MERCHANT_API_BASE = 'https://merchantapi.googleapis.com';
const MERCHANT_API_SERVICE = 'merchantapi.googleapis.com';
const CLOUD_PLATFORM_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const SITE_URL = 'https://www.nuvirajuice.com';
const BRAND = 'NuVira Juice Co.';
const GOOGLE_PRODUCT_CATEGORIES = {
  juice: '2887',
  tote: '5608',
};

const PRODUCT_TYPE_MAP = {
  juice: 'Cold-Pressed Juice',
  shot: 'Wellness Shot',
  bundle: 'Juice Bundle',
  wellness_pack: 'Wellness Pack',
  seasonal: 'Seasonal Juice',
  apparel: 'Apparel',
  merch: 'Merchandise',
};

const MERCHANT_COPY = {
  aura: {
    title: 'NuVira AURA Cold-Pressed Juice – 12 oz',
    description: 'A 12 oz cold-pressed juice blend made with carrot, orange, pineapple, cucumber, ginger, sea salt, and coconut water. Keep refrigerated.',
  },
  oasis: {
    title: 'NuVira OASIS Cold-Pressed Juice – 12 oz',
    description: 'A 12 oz cold-pressed juice blend made with watermelon, pineapple, orange, lemon, ginger, sea salt, black pepper, and coconut water. Keep refrigerated.',
  },
  're-nu': {
    title: 'NuVira RE-NU Cold-Pressed Green Juice – 12 oz',
    description: 'A 12 oz cold-pressed green juice made with cucumber, apple, celery, and kale. Keep refrigerated.',
  },
  'the nuvira trio': {
    title: 'NuVira Cold-Pressed Juice Trio – 3 × 12 oz',
    description: 'One 12 oz bottle each of NuVira AURA, RE-NU, and OASIS cold-pressed juice. Keep refrigerated.',
  },
  'orange juice': {
    title: 'NuVira Cold-Pressed Orange Juice – 32 oz',
    description: 'A 32 oz bottle of cold-pressed orange juice made from oranges with no added sugar or preservatives. Keep refrigerated.',
  },
  'pineapple juice': {
    title: 'NuVira Cold-Pressed Pineapple Juice – 32 oz',
    description: 'A 32 oz bottle of cold-pressed pineapple juice made from whole pineapple with no added sugar or preservatives. Keep refrigerated.',
  },
  'watermelon juice': {
    title: 'NuVira Cold-Pressed Watermelon Juice – 32 oz',
    description: 'A 32 oz bottle of cold-pressed watermelon juice made from fresh watermelon with no added sugar or preservatives. Keep refrigerated.',
  },
  'radiance shot': {
    title: 'NuVira Radiance Wellness Shot – 2 oz',
    description: 'A 2 oz wellness shot made with beet, apple, and lemon. Keep refrigerated.',
  },
  'hydration shot': {
    title: 'NuVira Hydration Wellness Shot – 2 oz',
    description: 'A 2 oz wellness shot made with coconut water, pink Himalayan salt, lime, honey, and mint. Keep refrigerated.',
  },
  'reset shot': {
    title: 'NuVira Reset Wellness Shot – 2 oz',
    description: 'A 2 oz wellness shot made with pineapple, lemon, ginger, and black salt. Keep refrigerated.',
  },
  'large nuvira tote bag': {
    title: 'NuVira Reusable Tote Bag – Large',
    description: 'A large reusable NuVira tote bag for event days, juice runs, and everyday carry.',
  },
};

const MERCHANT_IMAGE_SETS = {
  aura: {
    primary: `${SITE_URL}/images/products/aura-main.jpg`,
    additional: [
      `${SITE_URL}/images/products/aura-lifestyle.jpg`,
      `${SITE_URL}/images/brand/nuvira-bottles-cooler-wide.jpg`,
    ],
  },
  oasis: {
    primary: `${SITE_URL}/images/products/oasis-main.jpg`,
    additional: [
      `${SITE_URL}/images/products/oasis-lifestyle.jpg`,
      `${SITE_URL}/images/brand/nuvira-bottles-cooler-wide.jpg`,
    ],
  },
  're-nu': {
    primary: `${SITE_URL}/images/products/re-nu-main.jpg`,
    additional: [
      `${SITE_URL}/images/products/re-nu-lifestyle.jpg`,
      `${SITE_URL}/images/brand/nuvira-bottles-cooler-wide.jpg`,
    ],
  },
  'the nuvira trio': {
    primary: `${SITE_URL}/images/products/nuvira-trio-main.jpg`,
    additional: [
      `${SITE_URL}/images/products/nuvira-trio-lifestyle.jpg`,
      `${SITE_URL}/images/brand/nuvira-bottles-cooler-wide.jpg`,
      `${SITE_URL}/images/brand/nuvira-trio-outdoor-event.jpg`,
    ],
  },
  'pineapple juice': { primary: `${SITE_URL}/images/products/pineapple-juice-main.jpg` },
  'orange juice': { primary: `${SITE_URL}/images/products/orange-juice-main.jpg` },
  'watermelon juice': { primary: `${SITE_URL}/images/products/watermelon-juice-main.jpg` },
  'reset shot': { primary: `${SITE_URL}/images/products/reset-shot-main.jpg` },
  'hydration shot': { primary: `${SITE_URL}/images/products/hydration-shot-main.jpg` },
  'radiance shot': { primary: `${SITE_URL}/images/products/radiance-shot-main.jpg` },
  'large nuvira tote bag': {
    primary: `${SITE_URL}/assets/large-nuvira-tote-bag.jpg`,
    additional: [`${SITE_URL}/images/brand/nuvira-tote-bag.jpg`],
  },
};

function absoluteImageUrl(value) {
  const url = String(value || '').trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${SITE_URL}${url}`;
  return '';
}

function getMerchantImages(product) {
  const titleKey = String(product.title || '').trim().toLowerCase();
  const curated = MERCHANT_IMAGE_SETS[titleKey];
  const primary = curated?.primary || absoluteImageUrl(product.image_url);
  // Only send the curated, first-party image set to Google. Product.secondary_images
  // can contain provider URLs or formats that render in-app but Merchant Center
  // rejects as unsupported additional images.
  const candidates = curated?.additional || [];
  const additional = [...new Set(candidates.filter(url => url && url !== primary))].slice(0, 9);
  return { primary, additional };
}

function getGoogleProductCategory(product) {
  const titleKey = String(product.title || '').trim().toLowerCase();
  if (titleKey.includes('tote') || titleKey.includes('shopping bag')) {
    return GOOGLE_PRODUCT_CATEGORIES.tote;
  }
  return GOOGLE_PRODUCT_CATEGORIES.juice;
}

function getMerchantCopy(product) {
  const titleKey = String(product.title || '').trim().toLowerCase();
  const curated = MERCHANT_COPY[titleKey];
  if (curated) return curated;
  const size = String(product.size || '').trim();
  return {
    title: `${String(product.title || '').trim()}${size ? ` – ${size}` : ''}`,
    description: `${String(product.title || '').trim()} from NuVira Juice Co. See the product page for current ingredients, size, availability, and scheduled local-delivery details.`,
  };
}

function getServiceAccountKey() {
  const keyJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
  if (!keyJson) throw new Error('Google service account is not configured');
  return JSON.parse(keyJson);
}

// Get a Google OAuth2 access token using the service account JWT flow.
async function getAccessToken(scope = 'https://www.googleapis.com/auth/content') {
  const key = getServiceAccountKey();

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const encode = (obj) => btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const signingInput = `${encode(header)}.${encode(payload)}`;

  // Import the private key for signing
  const pemBody = key.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    binaryKey.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sigB64}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`Merchant API authentication failed (${tokenRes.status})`);
  }
  return tokenData.access_token;
}

function merchantDataSourceName() {
  const configured = String(MERCHANT_DATA_SOURCE_ID || '').trim();
  if (!configured) throw new Error('GOOGLE_MERCHANT_DATA_SOURCE_ID is not configured');
  return configured.startsWith('accounts/')
    ? configured
    : `accounts/${MERCHANT_ID}/dataSources/${configured}`;
}

function priceMicros(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('Invalid Merchant product price');
  return String(Math.round(amount * 1_000_000));
}

function encodeProductInputId(offerId) {
  const raw = `en~US~${String(offerId || '')}`;
  const bytes = new TextEncoder().encode(raw);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function buildMerchantProductInput(product) {
  const images = getMerchantImages(product);
  if (!product.title || !images.primary || !product.price) return null;
  const copy = getMerchantCopy(product);

  const offerId = product.id;
  const productAttributes: Record<string, any> = {
    title: copy.title,
    description: copy.description,
    link: `${SITE_URL}/shop/${product.id}`,
    imageLink: images.primary,
    availability: product.is_available === false ? 'OUT_OF_STOCK' : product.is_preorder ? 'PREORDER' : 'IN_STOCK',
    condition: 'NEW',
    brand: BRAND,
    googleProductCategory: getGoogleProductCategory(product),
    productTypes: [PRODUCT_TYPE_MAP[product.category] || 'Cold-Pressed Juice'],
    identifierExists: false,
    price: {
      amountMicros: priceMicros(product.price),
      currencyCode: 'USD',
    },
  };

  const merchantProductInput: Record<string, any> = {
    offerId,
    contentLanguage: 'en',
    feedLabel: 'US',
    productAttributes,
  };

  // Delivery cost and timing are intentionally omitted here. Offer-level
  // shipping overrides Merchant Center's account policy, while NuVira uses
  // scheduled, distance-priced local delivery rather than free parcel shipping.

  // Sale price
  if (product.compare_at_price && product.compare_at_price > product.price) {
    productAttributes.price = { amountMicros: priceMicros(product.compare_at_price), currencyCode: 'USD' };
    productAttributes.salePrice = { amountMicros: priceMicros(product.price), currencyCode: 'USD' };
  }

  if (product.size) productAttributes.size = product.size;

  // Additional images
  if (images.additional.length > 0) productAttributes.additionalImageLinks = images.additional;

  // Preorder availability date
  if (product.is_preorder && product.preorder_ship_date) {
    productAttributes.availabilityDate = `${product.preorder_ship_date}T00:00:00-06:00`;
  }

  // Custom labels
  if (product.is_best_seller) productAttributes.customLabel0 = 'best_seller';
  else if (product.is_seasonal) productAttributes.customLabel0 = 'seasonal';
  else if (product.is_featured) productAttributes.customLabel0 = 'featured';

  return merchantProductInput;
}

// Merchant API productInputs.insert replaces the prior input for the same
// language, feed label, offer ID, and API data source.
async function upsertProduct(accessToken, merchantProductInput) {
  const dataSource = merchantDataSourceName();
  const url = `${MERCHANT_API_BASE}/products/v1/accounts/${MERCHANT_ID}/productInputs:insert?dataSource=${encodeURIComponent(dataSource)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(merchantProductInput),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Merchant API product upsert failed (${res.status})`);
  return data;
}

// Delete a single product from GMC
async function deleteProduct(accessToken, offerId) {
  const dataSource = merchantDataSourceName();
  const productInputId = encodeProductInputId(offerId);
  const url = `${MERCHANT_API_BASE}/products/v1/accounts/${MERCHANT_ID}/productInputs/${productInputId}?dataSource=${encodeURIComponent(dataSource)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Merchant API product delete failed (${res.status})`);
  }
}

async function fetchMerchantApiStatus(accessToken) {
  const registrationUrl = `${MERCHANT_API_BASE}/accounts/v1/accounts/${MERCHANT_ID}/developerRegistration`;
  const dataSourceUrl = `${MERCHANT_API_BASE}/datasources/v1/accounts/${MERCHANT_ID}/dataSources?pageSize=1000`;
  const [registrationRes, dataSourceRes] = await Promise.all([
    fetch(registrationUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } }),
    fetch(dataSourceUrl, { headers: { 'Authorization': `Bearer ${accessToken}` } }),
  ]);
  const registration = await registrationRes.json().catch(() => ({}));
  const dataSources = await dataSourceRes.json().catch(() => ({}));
  const configuredDataSource = merchantDataSourceName();
  const names = Array.isArray(dataSources.dataSources)
    ? dataSources.dataSources.map(source => source?.name).filter(Boolean)
    : [];
  return {
    registered: registrationRes.ok,
    registration_status: registrationRes.status,
    registration_reason: providerErrorReason(registration),
    configured_data_source: configuredDataSource,
    configured_data_source_found: names.includes(configuredDataSource),
    data_source_status: dataSourceRes.status,
    data_source_reason: providerErrorReason(dataSources),
    data_source_count: names.length,
    migration_ready: registrationRes.ok && dataSourceRes.ok && names.includes(configuredDataSource),
  };
}

function providerErrorReason(payload) {
  const error = payload?.error && typeof payload.error === 'object' ? payload.error : {};
  const details = Array.isArray(error.details) ? error.details : [];
  const detailReason = details.map(detail => detail?.reason).find(Boolean);
  return detailReason || error.status || null;
}

async function merchantApiServiceStatus() {
  const projectId = String(getServiceAccountKey().project_id || '').trim();
  if (!projectId) throw new Error('Google service account project is not configured');
  const accessToken = await getAccessToken(CLOUD_PLATFORM_SCOPE);
  const url = `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services/${MERCHANT_API_SERVICE}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  return {
    service: MERCHANT_API_SERVICE,
    service_account_project: projectId,
    accessible: res.ok,
    status: res.status,
    state: data.state || null,
    enabled: res.ok && data.state === 'ENABLED',
    reason: providerErrorReason(data),
  };
}

async function enableMerchantApiService() {
  const projectId = String(getServiceAccountKey().project_id || '').trim();
  if (!projectId) throw new Error('Google service account project is not configured');
  const accessToken = await getAccessToken(CLOUD_PLATFORM_SCOPE);
  const url = `https://serviceusage.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/services/${MERCHANT_API_SERVICE}:enable`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Merchant API service activation failed (${res.status})`);
  return {
    service: MERCHANT_API_SERVICE,
    service_account_project: projectId,
    activation_requested: true,
    operation: data.name || null,
  };
}

async function registerMerchantApi(accessToken, developerEmail) {
  const url = `${MERCHANT_API_BASE}/accounts/v1/accounts/${MERCHANT_ID}/developerRegistration:registerGcp`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ developerEmail }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Merchant API registration failed (${res.status})`);
  return { name: data.name || null, gcp_project_count: Array.isArray(data.gcpIds) ? data.gcpIds.length : 0 };
}

async function readJsonBody(req) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return { ok: true, body: {} };
  }

  const raw = await req.text();
  if (!raw.trim()) {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) {
      return Response.json({ success: false, error: 'unauthorized' }, { status: 401 });
    }
    if (!['admin', 'owner'].includes(String(caller.role || '').trim().toLowerCase())) {
      return Response.json({ success: false, error: 'forbidden' }, { status: 403 });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};

    // If triggered by entity automation, handle single product.
    const { action, product_id } = body;

    if (!MERCHANT_ID || !MERCHANT_DATA_SOURCE_ID || !Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY')) {
      return Response.json({ success: false, error: 'merchant_api_configuration_incomplete' }, { status: 503 });
    }

    if (action === 'merchant_api_service_status') {
      return Response.json({ success: true, action, ...(await merchantApiServiceStatus()) });
    }

    if (action === 'enable_merchant_api_service') {
      if (body.confirm !== 'ENABLE_MERCHANT_API_SERVICE') {
        return Response.json({ success: false, error: 'service_activation_confirmation_required' }, { status: 400 });
      }
      return Response.json({ success: true, action, ...(await enableMerchantApiService()) });
    }

    if (action === 'merchant_api_status' || action === 'register_merchant_api') {
      const accessToken = await getAccessToken();

      if (action === 'merchant_api_status') {
        return Response.json({ success: true, action, ...(await fetchMerchantApiStatus(accessToken)) });
      }

      const developerEmail = String(body.developer_email || '').trim().toLowerCase();
      if (body.confirm !== 'REGISTER_GCP_PROJECT' || !/^\S+@\S+\.\S+$/.test(developerEmail)) {
        return Response.json({ success: false, error: 'registration_confirmation_required' }, { status: 400 });
      }
      const registration = await registerMerchantApi(accessToken, developerEmail);
      return Response.json({ success: true, action, registration });
    }

    if (Deno.env.get('ENABLE_GOOGLE_MERCHANT_PRODUCT_SYNC') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        gate: 'ENABLE_GOOGLE_MERCHANT_PRODUCT_SYNC',
        reason: 'google_merchant_product_sync_disabled',
        message: 'Google Merchant product sync is disabled by the current integration safety gate.',
      });
    }

    const accessToken = await getAccessToken();

    // Single product delete
    if (action === 'delete' && product_id) {
      console.log(`[GMC Sync] Deleting product ${product_id}`);
      await deleteProduct(accessToken, product_id);
      return Response.json({ success: true, action: 'delete', product_id });
    }

    // Single product upsert
    if (product_id) {
      const products = await base44.asServiceRole.entities.Product.filter({ id: product_id });
      const product = products[0];
      if (!product) {
        return Response.json({ success: false, error: 'Product not found' }, { status: 404 });
      }
      console.log(`[GMC Sync] Upserting single product: ${product.title}`);
      const merchantProductInput = buildMerchantProductInput(product);
      if (!merchantProductInput) {
        return Response.json({ success: false, error: 'Product missing required fields' });
      }
      const result = await upsertProduct(accessToken, merchantProductInput);
      console.log(`[Merchant API] Upserted: ${result.name || product_id}`);
      return Response.json({ success: true, action: 'upsert', product_id, merchant_product_input: result.name || null });
    }

    // Full bulk sync — fetch all available products
    console.log('[GMC Sync] Starting full bulk sync...');
    const products = await base44.asServiceRole.entities.Product.list('sort_order', 200);

    let synced = 0;
    let failed = 0;
    const errors = [];

    for (const product of products) {
      if (!product.is_available && !product.is_preorder) {
        // Delete unavailable products from GMC
        try {
          await deleteProduct(accessToken, product.id);
          console.log(`[GMC Sync] Deleted unavailable: ${product.title}`);
        } catch (e) {
          console.warn(`[GMC Sync] Delete skipped for ${product.title}: ${e.message}`);
        }
        continue;
      }

      const merchantProductInput = buildMerchantProductInput(product);
      if (!merchantProductInput) {
        console.warn(`[GMC Sync] Skipping ${product.title} — missing required fields`);
        continue;
      }

      try {
        await upsertProduct(accessToken, merchantProductInput);
        synced++;
        console.log(`[GMC Sync] ✓ ${product.title}`);
      } catch (e) {
        failed++;
        errors.push({ title: product.title, error: e.message });
        console.error(`[GMC Sync] ✗ ${product.title}: ${e.message}`);
      }
    }

    console.log(`[GMC Sync] Complete — ${synced} synced, ${failed} failed`);
    return Response.json({ success: true, synced, failed, errors });

  } catch (error) {
    console.error('[GMC Sync] Fatal error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
