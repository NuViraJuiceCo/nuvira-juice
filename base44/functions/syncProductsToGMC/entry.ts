import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MERCHANT_ID = Deno.env.get('GOOGLE_MERCHANT_ID');
const SITE_URL = 'https://www.nuvirajuice.com';
const BRAND = 'NuVira Juice Co.';
const GOOGLE_PRODUCT_CATEGORY = 'Food, Beverages & Tobacco > Beverages > Juices';

const PRODUCT_TYPE_MAP = {
  juice: 'Cold-Pressed Juice',
  shot: 'Wellness Shot',
  bundle: 'Juice Bundle',
  wellness_pack: 'Wellness Pack',
  seasonal: 'Seasonal Juice',
  apparel: 'Apparel',
  merch: 'Merchandise',
};

// Get a Google OAuth2 access token using the service account JWT flow
async function getAccessToken() {
  const keyJson = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
  const key = JSON.parse(keyJson);

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/content',
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
    throw new Error(`Failed to get access token: ${JSON.stringify(tokenData)}`);
  }
  return tokenData.access_token;
}

function buildGMCProduct(product) {
  if (!product.title || !product.image_url || !product.price) return null;

  const offerId = product.id;
  const gmcProduct: Record<string, any> = {
    offerId,
    title: product.title,
    description: product.description || product.short_description || `${product.title} — fresh cold-pressed juice from NuVira Juice Co., delivered in the St. Louis, MO area.`,
    link: `${SITE_URL}/shop/${product.id}`,
    imageLink: product.image_url,
    contentLanguage: 'en',
    targetCountry: 'US',
    channel: 'online',
    availability: product.is_available === false ? 'out of stock' : product.is_preorder ? 'preorder' : 'in stock',
    condition: 'new',
    brand: BRAND,
    googleProductCategory: GOOGLE_PRODUCT_CATEGORY,
    productTypes: [PRODUCT_TYPE_MAP[product.category] || 'Cold-Pressed Juice'],
    price: {
      value: String(product.price.toFixed(2)),
      currency: 'USD',
    },
    shipping: [{
      country: 'US',
      service: 'Local Delivery',
      price: { value: '0.00', currency: 'USD' },
    }],
  };

  // Sale price
  if (product.compare_at_price && product.compare_at_price > product.price) {
    gmcProduct.price = { value: String(product.compare_at_price.toFixed(2)), currency: 'USD' };
    gmcProduct.salePrice = { value: String(product.price.toFixed(2)), currency: 'USD' };
  }

  if (product.size) gmcProduct.sizes = [product.size];

  // Additional images
  if (product.secondary_images?.length > 0) {
    gmcProduct.additionalImageLinks = product.secondary_images.slice(0, 9).filter(Boolean);
  }

  // Preorder availability date
  if (product.is_preorder && product.preorder_ship_date) {
    gmcProduct.availabilityDate = `${product.preorder_ship_date}T00:00:00-06:00`;
  }

  // Custom labels
  if (product.is_best_seller) gmcProduct.customLabel0 = 'best_seller';
  else if (product.is_seasonal) gmcProduct.customLabel0 = 'seasonal';
  else if (product.is_featured) gmcProduct.customLabel0 = 'featured';

  return gmcProduct;
}

// Upsert a single product to GMC
async function upsertProduct(accessToken, gmcProduct) {
  const url = `https://shoppingcontent.googleapis.com/content/v2.1/${MERCHANT_ID}/products`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(gmcProduct),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

// Delete a single product from GMC
async function deleteProduct(accessToken, offerId) {
  const productId = `online:en:US:${offerId}`;
  const url = `https://shoppingcontent.googleapis.com/content/v2.1/${MERCHANT_ID}/products/${encodeURIComponent(productId)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    const data = await res.text();
    throw new Error(`Delete failed: ${data}`);
  }
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
    if (Deno.env.get('ENABLE_GOOGLE_MERCHANT_PRODUCT_SYNC') !== 'true') {
      return Response.json({
        success: true,
        skipped: true,
        gate: 'ENABLE_GOOGLE_MERCHANT_PRODUCT_SYNC',
        reason: 'google_merchant_product_sync_disabled',
        message: 'Google Merchant product sync is disabled by the current integration safety gate.',
      });
    }

    const base44 = createClientFromRequest(req);
    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};

    // If triggered by entity automation, handle single product
    const { action, product_id } = body;

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
      const gmcProduct = buildGMCProduct(product);
      if (!gmcProduct) {
        return Response.json({ success: false, error: 'Product missing required fields' });
      }
      const result = await upsertProduct(accessToken, gmcProduct);
      console.log(`[GMC Sync] Upserted: ${result.id}`);
      return Response.json({ success: true, action: 'upsert', product_id, gmc_id: result.id });
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

      const gmcProduct = buildGMCProduct(product);
      if (!gmcProduct) {
        console.warn(`[GMC Sync] Skipping ${product.title} — missing required fields`);
        continue;
      }

      try {
        await upsertProduct(accessToken, gmcProduct);
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
