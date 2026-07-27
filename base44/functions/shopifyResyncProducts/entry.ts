import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin-triggered product sync from Shopify to Base44.
 */

function normalizeLookup(value: unknown) {
  return String(value || '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function slugify(value: unknown) {
  return normalizeLookup(value)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function shopifyNumericId(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '';
  const gidMatch = text.match(/\/(\d+)$/);
  if (gidMatch) return gidMatch[1];
  return text.replace(/\D/g, '');
}

function productLookupKeys(product: Record<string, unknown>) {
  return [
    product.id,
    product.title,
    slugify(product.title),
    product.shopify_handle,
    product.handle,
    product.shopify_product_id,
    product.shopify_variant_id,
  ]
    .filter(Boolean)
    .map(normalizeLookup);
}

function findMatchingBase44Product(shopifyProduct: Record<string, unknown>, base44Products: Array<Record<string, unknown>>) {
  const shopifyProductId = shopifyNumericId(shopifyProduct.id || shopifyProduct.shopify_product_id);
  const defaultVariant = Array.isArray(shopifyProduct.variants) ? shopifyProduct.variants[0] : null;
  const variantSku = defaultVariant?.sku ? String(defaultVariant.sku) : '';
  const lookupValues = [
    variantSku,
    shopifyProduct.handle,
    shopifyProduct.title,
    slugify(shopifyProduct.title),
  ].map(normalizeLookup).filter(Boolean);

  return base44Products.find((candidate) => {
    if (variantSku && candidate.id === variantSku) return true;
    if (shopifyProductId && shopifyNumericId(candidate.shopify_product_id) === shopifyProductId) return true;

    const candidateKeys = productLookupKeys(candidate);
    return lookupValues.some((value) => candidateKeys.includes(value));
  }) || null;
}

async function backfillBase44ProductShopifyIds(base44, shopifyProduct: Record<string, unknown>, base44Products: Array<Record<string, unknown>>) {
  const matchedProduct = findMatchingBase44Product(shopifyProduct, base44Products);
  if (!matchedProduct?.id) return false;

  const defaultVariantId = Array.isArray(shopifyProduct.variants) && shopifyProduct.variants[0]?.id
    ? String(shopifyProduct.variants[0].id)
    : '';
  const shopifyProductId = shopifyProduct.id ? String(shopifyProduct.id) : '';
  const shopifyHandle = shopifyProduct.handle ? String(shopifyProduct.handle) : '';

  const updates: Record<string, string> = {};
  if (shopifyProductId && matchedProduct.shopify_product_id !== shopifyProductId) {
    updates.shopify_product_id = shopifyProductId;
  }
  if (shopifyHandle && matchedProduct.shopify_handle !== shopifyHandle) {
    updates.shopify_handle = shopifyHandle;
  }
  if (defaultVariantId && matchedProduct.shopify_variant_id !== defaultVariantId) {
    updates.shopify_variant_id = defaultVariantId;
  }

  if (Object.keys(updates).length === 0) return false;

  await base44.asServiceRole.entities.Product.update(String(matchedProduct.id), updates);
  Object.assign(matchedProduct, updates);
  return true;
}

Deno.serve(async (req) => {
  if (Deno.env.get('ENABLE_ADMIN_SHOPIFY_RESYNC') !== 'true') {
    return Response.json({
      success: true,
      skipped: true,
      reason: 'admin_shopify_resync_disabled',
      message: 'Admin Shopify product resync is disabled by the current controlled-sync gate.',
    }, { status: 409 });
  }

  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  const SHOPIFY_API_TOKEN = Deno.env.get('SHOPIFY_API_TOKEN');
  const SHOPIFY_STORE_URL = Deno.env.get('SHOPIFY_STORE_URL');

  if (!SHOPIFY_API_TOKEN || !SHOPIFY_STORE_URL) {
    return Response.json({ error: 'Shopify credentials not configured' }, { status: 500 });
  }

  const storeHost = SHOPIFY_STORE_URL.replace(/^https?:\/\//, '');
  const shopifyRes = await fetch(
    `https://${storeHost}/admin/api/2024-01/products.json?limit=250&status=any`,
    { headers: { 'X-Shopify-Access-Token': SHOPIFY_API_TOKEN, 'Content-Type': 'application/json' } }
  );

  if (!shopifyRes.ok) {
    const errText = await shopifyRes.text();
    console.error('Shopify API error:', shopifyRes.status, errText);
    return Response.json({ error: `Shopify API ${shopifyRes.status}`, details: errText }, { status: 502 });
  }

  const { products = [] } = await shopifyRes.json();
  const base44Products = await base44.asServiceRole.entities.Product.list('sort_order', 250);
  let synced = 0;
  let product_links_updated = 0;

  for (const product of products) {
    const shopifyProductId = String(product.id);
    const existing = await base44.asServiceRole.entities.ShopifyProduct.filter({ shopify_product_id: shopifyProductId });
    const record = {
      shopify_product_id: shopifyProductId,
      title: product.title,
      handle: product.handle,
      product_type: product.product_type || '',
      status: product.status || 'active',
      vendor: product.vendor || '',
      tags: (product.tags || '').split(',').map(t => t.trim()).filter(Boolean),
      image_url: product.image?.src || product.images?.[0]?.src || '',
      variants: (product.variants || []).map(v => ({
        shopify_variant_id: String(v.id),
        title: v.title, sku: v.sku || '',
        price: parseFloat(v.price || 0),
        compare_at_price: parseFloat(v.compare_at_price || 0),
        inventory_quantity: v.inventory_quantity || 0,
        inventory_policy: v.inventory_policy || 'deny',
      })),
      synced_at: new Date().toISOString(),
    };
    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyProduct.update(existing[0].id, record);
    } else {
      await base44.asServiceRole.entities.ShopifyProduct.create(record);
    }
    if (await backfillBase44ProductShopifyIds(base44, product, base44Products)) {
      product_links_updated++;
    }
    synced++;
  }

  await base44.asServiceRole.entities.ShopifySyncLog.create({
    sync_type: 'products', status: 'success',
    records_synced: synced, records_failed: 0,
    started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    triggered_by: 'manual',
  });

  return Response.json({ ok: true, synced, product_links_updated });
});
