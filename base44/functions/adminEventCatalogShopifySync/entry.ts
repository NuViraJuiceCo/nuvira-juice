// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const APPROVAL_CODE = 'SYNC_EVENT_CATALOG_2026_07_11';
const SHOPIFY_REST_VERSION = '2024-01';
const SHOPIFY_GRAPHQL_VERSIONS = ['2026-07', '2026-01', '2024-01'];
const TARGET_PUBLICATION_TITLES = new Set(['point of sale', 'online store']);

const EVENT_STOCK_PLAN = {
  event_date: '2026-07-11',
  bottle_units: 170,
  items: [
    { product_name: 'RE-NU', quantity: 20 },
    { product_name: 'OASIS', quantity: 75 },
    { product_name: 'AURA', quantity: 75 },
  ],
};

const TOTE_PRODUCT = {
  title: 'Large NuVira Tote Bag',
  short_description: 'Large reusable NuVira tote.',
  description: 'Large reusable NuVira tote bag for event days, juice runs, and everyday carry.',
  wellness_note: 'Reusable carryall for bottles, merch, and daily essentials.',
  category: 'merch',
  price: 12,
  size: 'Large tote',
  sort_order: 40,
  tags: ['merch', 'event', 'tote', 'pos'],
};

const TRIO_PRODUCT = {
  title: 'The NuVira Trio',
  shopify_product_id: '7867922514010',
  shopify_variant_id: '43222070198362',
  expected_price: 36,
};

function normalizeText(value) {
  return String(value ?? '').trim();
}

function safeString(value, maxLength = 240) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeStoreHost(raw) {
  const host = normalizeText(raw).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  if (!host || host.includes('/')) return null;
  return host;
}

function shopifyProductGid(productId) {
  const clean = normalizeText(productId).replace(/\D/g, '');
  return clean ? `gid://shopify/Product/${clean}` : null;
}

function sanitizePublication(node) {
  return {
    id: safeString(node?.id, 160),
    auto_publish: node?.autoPublish === true,
    supports_future_publishing: node?.supportsFuturePublishing === true,
    catalog_title: safeString(node?.catalog?.title, 160),
  };
}

function sanitizeProduct(product) {
  return {
    id: safeString(product?.id, 160),
    title: safeString(product?.title, 160),
    category: safeString(product?.category, 80),
    price: safeNumber(product?.price),
    size: safeString(product?.size, 120),
    is_available: product?.is_available === true,
    shopify_product_id: safeString(product?.shopify_product_id, 140),
    shopify_handle: safeString(product?.shopify_handle, 180),
    shopify_variant_id: safeString(product?.shopify_variant_id, 140),
  };
}

function sanitizeShopifyProduct(product) {
  return {
    shopify_product_id: safeString(product?.id, 140),
    title: safeString(product?.title, 180),
    handle: safeString(product?.handle, 180),
    product_type: safeString(product?.product_type, 120),
    status: safeString(product?.status, 80),
    vendor: safeString(product?.vendor, 120),
    variants: Array.isArray(product?.variants)
      ? product.variants.slice(0, 10).map(variant => ({
        shopify_variant_id: safeString(variant?.id, 140),
        title: safeString(variant?.title, 160),
        sku: safeString(variant?.sku, 120),
        price: safeNumber(variant?.price),
      }))
      : [],
  };
}

function errorSummary(status, bodyText) {
  const trimmed = normalizeText(bodyText).slice(0, 500);
  try {
    const parsed = JSON.parse(trimmed);
    return parsed.errors || parsed.error || parsed.message || trimmed || `HTTP ${status}`;
  } catch {
    return trimmed || `HTTP ${status}`;
  }
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

async function shopifyRest({ host, token, path, method = 'GET', body }) {
  const response = await fetch(`https://${host}/admin/api/${SHOPIFY_REST_VERSION}${path}`, {
    method,
    headers: {
      'X-Shopify-Access-Token': token,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const bodyText = await response.text();
  let data = null;
  if (bodyText) {
    try {
      data = JSON.parse(bodyText);
    } catch {
      data = null;
    }
  }
  if (!response.ok) {
    throw new Error(`shopify_rest_${response.status}:${JSON.stringify(errorSummary(response.status, bodyText))}`);
  }
  return data;
}

async function shopifyGraphql({ host, token, query, variables }) {
  const errors = [];
  for (const version of SHOPIFY_GRAPHQL_VERSIONS) {
    const response = await fetch(`https://${host}/admin/api/${version}/graphql.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
    const bodyText = await response.text();
    let data = null;
    if (bodyText) {
      try {
        data = JSON.parse(bodyText);
      } catch {
        data = null;
      }
    }
    if (response.ok && !data?.errors) {
      return { version, data };
    }
    errors.push({
      version,
      status: response.status,
      error: data?.errors || errorSummary(response.status, bodyText),
    });
  }
  throw new Error(`shopify_graphql_failed:${JSON.stringify(errors).slice(0, 900)}`);
}

async function listTargetPublications(config) {
  const query = `
    query Publications {
      publications(first: 50) {
        nodes {
          id
          autoPublish
          supportsFuturePublishing
          catalog {
            id
            title
          }
        }
      }
    }
  `;
  const result = await shopifyGraphql({ ...config, query, variables: {} });
  const publications = result.data?.data?.publications?.nodes || [];
  return publications
    .filter(node => TARGET_PUBLICATION_TITLES.has(normalizeText(node?.catalog?.title).toLowerCase()))
    .map(sanitizePublication)
    .filter(node => node.id);
}

async function publishProductToTargets(config, shopifyProductId, targetPublications) {
  const productGid = shopifyProductGid(shopifyProductId);
  if (!productGid || targetPublications.length === 0) {
    return {
      attempted: Boolean(productGid),
      publication_count: 0,
      user_errors: [],
      error: targetPublications.length === 0 ? 'target_publications_not_found' : 'invalid_shopify_product_id',
    };
  }

  const query = `
    mutation PublishProduct($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          ... on Product {
            id
            title
          }
          availablePublicationsCount {
            count
          }
          resourcePublicationsCount {
            count
          }
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  const variables = {
    id: productGid,
    input: targetPublications.map(publication => ({ publicationId: publication.id })),
  };
  const result = await shopifyGraphql({ ...config, query, variables });
  const payload = result.data?.data?.publishablePublish || {};
  return {
    attempted: true,
    api_version: result.version,
    publication_count: targetPublications.length,
    target_publications: targetPublications,
    user_errors: Array.isArray(payload.userErrors) ? payload.userErrors.map(error => ({
      field: Array.isArray(error?.field) ? error.field.join('.') : safeString(error?.field, 160),
      message: safeString(error?.message, 240),
    })) : [],
    available_publications_count: safeNumber(payload.publishable?.availablePublicationsCount?.count),
    resource_publications_count: safeNumber(payload.publishable?.resourcePublicationsCount?.count),
  };
}

async function upsertBase44ToteProduct(base44) {
  const matches = await base44.asServiceRole.entities.Product.filter({ title: TOTE_PRODUCT.title });
  const existing = Array.isArray(matches)
    ? matches.find(product => normalizeText(product?.title).toLowerCase() === TOTE_PRODUCT.title.toLowerCase()) || matches[0]
    : null;

  if (!existing) {
    const created = await base44.asServiceRole.entities.Product.create({
      ...TOTE_PRODUCT,
      is_available: true,
    });
    return { product: created, action: 'created' };
  }

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(TOTE_PRODUCT)) {
    if (key === 'tags') {
      const existingTags = Array.isArray(existing.tags) ? existing.tags : [];
      const nextTags = [...new Set([...existingTags, ...TOTE_PRODUCT.tags])];
      if (JSON.stringify(existingTags) !== JSON.stringify(nextTags)) patch.tags = nextTags;
      continue;
    }
    if (existing[key] !== value) patch[key] = value;
  }
  if (existing.is_available !== true) patch.is_available = true;

  if (Object.keys(patch).length === 0) {
    return { product: existing, action: 'unchanged' };
  }

  const updated = await base44.asServiceRole.entities.Product.update(existing.id, patch);
  return { product: updated || { ...existing, ...patch }, action: 'updated', fields_updated: Object.keys(patch) };
}

async function upsertShopifyToteProduct(base44, config, product) {
  const productId = normalizeText(product?.shopify_product_id);
  const payload = {
    product: {
      title: TOTE_PRODUCT.title,
      body_html: TOTE_PRODUCT.description,
      vendor: 'NuVira Juice Co.',
      product_type: 'Merch',
      status: 'active',
      published_scope: 'global',
      tags: TOTE_PRODUCT.tags.join(', '),
      ...(product?.shopify_handle ? { handle: product.shopify_handle } : {}),
      metafields_global_title_tag: `${TOTE_PRODUCT.title} | NuVira Juice`,
      metafields_global_description_tag: TOTE_PRODUCT.short_description,
      variants: [
        {
          price: TOTE_PRODUCT.price.toFixed(2),
          sku: product.id,
          requires_shipping: false,
          taxable: true,
          inventory_management: null,
        },
      ],
      images: product?.image_url ? [{ src: product.image_url }] : [],
    },
  };

  const shopifyData = productId
    ? await shopifyRest({ ...config, path: `/products/${productId}.json`, method: 'PUT', body: payload })
    : await shopifyRest({ ...config, path: '/products.json', method: 'POST', body: payload });

  const shopifyProduct = shopifyData?.product;
  const defaultVariantId = shopifyProduct?.variants?.[0]?.id ? String(shopifyProduct.variants[0].id) : null;
  const productUpdates: Record<string, string> = {};
  if (shopifyProduct?.id && product.shopify_product_id !== String(shopifyProduct.id)) {
    productUpdates.shopify_product_id = String(shopifyProduct.id);
  }
  if (shopifyProduct?.handle && product.shopify_handle !== String(shopifyProduct.handle)) {
    productUpdates.shopify_handle = String(shopifyProduct.handle);
  }
  if (defaultVariantId && product.shopify_variant_id !== defaultVariantId) {
    productUpdates.shopify_variant_id = defaultVariantId;
  }

  const updatedProduct = Object.keys(productUpdates).length > 0
    ? await base44.asServiceRole.entities.Product.update(product.id, productUpdates)
    : product;

  await upsertShopifyProductMirror(base44, {
    shopify_product: shopifyProduct,
    base44_product_id: product.id,
  });

  return {
    base44_product: sanitizeProduct(updatedProduct || { ...product, ...productUpdates }),
    shopify_product: sanitizeShopifyProduct(shopifyProduct),
    action: productId ? 'updated_shopify_product' : 'created_shopify_product',
    product_fields_updated: Object.keys(productUpdates),
  };
}

async function upsertShopifyProductMirror(base44, { shopify_product, base44_product_id }) {
  if (!shopify_product?.id) return null;
  const shopifyProductId = String(shopify_product.id);
  const mirrorPayload = {
    shopify_product_id: shopifyProductId,
    title: shopify_product.title || '',
    description: safeString(shopify_product.body_html, 1000),
    handle: shopify_product.handle || '',
    product_type: shopify_product.product_type || '',
    status: shopify_product.status || 'active',
    vendor: shopify_product.vendor || '',
    tags: typeof shopify_product.tags === 'string'
      ? shopify_product.tags.split(',').map(tag => safeString(tag, 120)).filter(Boolean)
      : [],
    image_url: shopify_product.image?.src || '',
    variants: Array.isArray(shopify_product.variants) ? shopify_product.variants.map(variant => ({
      shopify_variant_id: variant?.id ? String(variant.id) : '',
      title: variant?.title || '',
      sku: variant?.sku || '',
      price: Number(variant?.price || 0),
      compare_at_price: variant?.compare_at_price ? Number(variant.compare_at_price) : null,
      inventory_quantity: Number(variant?.inventory_quantity || 0),
      inventory_policy: variant?.inventory_policy || '',
    })) : [],
    base44_product_id,
    synced_at: new Date().toISOString(),
  };

  const matches = await base44.asServiceRole.entities.ShopifyProduct.filter({ shopify_product_id: shopifyProductId }).catch(() => []);
  if (Array.isArray(matches) && matches[0]?.id) {
    return base44.asServiceRole.entities.ShopifyProduct.update(matches[0].id, mirrorPayload).catch(() => null);
  }
  return base44.asServiceRole.entities.ShopifyProduct.create(mirrorPayload).catch(() => null);
}

async function verifyAndPublishTrio(config, targetPublications) {
  const shopifyData = await shopifyRest({
    ...config,
    path: `/products/${TRIO_PRODUCT.shopify_product_id}.json`,
    method: 'GET',
  });
  const shopifyProduct = shopifyData?.product;
  const variants = Array.isArray(shopifyProduct?.variants) ? shopifyProduct.variants : [];
  const trioVariant = variants.find(variant => String(variant?.id) === TRIO_PRODUCT.shopify_variant_id) || null;
  const publication = await publishProductToTargets(config, TRIO_PRODUCT.shopify_product_id, targetPublications)
    .catch(error => ({ attempted: true, publication_count: targetPublications.length, error: safeString(error?.message, 900) }));

  return {
    expected_title: TRIO_PRODUCT.title,
    expected_shopify_product_id: TRIO_PRODUCT.shopify_product_id,
    expected_shopify_variant_id: TRIO_PRODUCT.shopify_variant_id,
    product_found: Boolean(shopifyProduct),
    variant_found: Boolean(trioVariant),
    status: safeString(shopifyProduct?.status, 80),
    variant_price: safeNumber(trioVariant?.price),
    price_matches: safeNumber(trioVariant?.price) === TRIO_PRODUCT.expected_price,
    publication,
  };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed' }, { status: 405 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error_code: 'malformed_json' }, { status: 400 });
    }
    if (normalizeText(body.approval_code) !== APPROVAL_CODE) {
      return Response.json({ success: false, error_code: 'approval_code_required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user?.role !== 'admin') {
      return Response.json({ success: false, error_code: 'admin_only' }, { status: 403 });
    }

    const token = Deno.env.get('SHOPIFY_API_TOKEN');
    const storeUrl = Deno.env.get('SHOPIFY_STORE_URL');
    const host = normalizeStoreHost(storeUrl);
    if (!token || !host) {
      return Response.json({ success: false, error_code: 'shopify_credentials_not_configured' }, { status: 500 });
    }

    const config = { host, token };
    const targetPublications = await listTargetPublications(config).catch(error => ({
      error: safeString(error?.message, 900),
      publications: [],
    }));
    const publicationList = Array.isArray(targetPublications) ? targetPublications : targetPublications.publications;
    const publicationLookupError = Array.isArray(targetPublications) ? null : targetPublications.error;

    const base44Tote = await upsertBase44ToteProduct(base44);
    const toteSync = await upsertShopifyToteProduct(base44, config, base44Tote.product);
    const totePublication = await publishProductToTargets(config, toteSync.shopify_product.shopify_product_id, publicationList)
      .catch(error => ({ attempted: true, publication_count: publicationList.length, error: safeString(error?.message, 900) }));
    const trio = await verifyAndPublishTrio(config, publicationList)
      .catch(error => ({ error: safeString(error?.message, 900), product_found: false, variant_found: false }));

    return Response.json({
      success: true,
      writes_performed: true,
      scope: 'event_catalog_shopify_sync_only',
      generated_at: new Date().toISOString(),
      actor: {
        role: safeString(user?.role, 40),
        id: safeString(user?.id, 160),
      },
      safeguards: {
        customer_orders_created: false,
        fulfillment_tasks_created: false,
        production_batches_created: false,
        inventory_deducted: false,
        purchase_orders_created: false,
        notifications_sent: false,
        bulk_product_sync: false,
      },
      event_stock_plan: EVENT_STOCK_PLAN,
      publications: {
        lookup_error: publicationLookupError,
        target_publications: publicationList,
      },
      tote: {
        base44_action: base44Tote.action,
        base44_fields_updated: base44Tote.fields_updated || [],
        shopify_action: toteSync.action,
        base44_product: toteSync.base44_product,
        shopify_product: toteSync.shopify_product,
        publication: totePublication,
      },
      trio,
    });
  } catch (error) {
    console.error('[adminEventCatalogShopifySync] Error:', error?.message || error);
    return Response.json({
      success: false,
      error_code: 'event_catalog_shopify_sync_failed',
      message: safeString(error?.message || 'Unknown error', 1000),
    }, { status: 500 });
  }
});
