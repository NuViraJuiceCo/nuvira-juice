import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin-triggered manual resync of recent Shopify orders.
 * Payload: { limit?: number, order_id?: string }
 */

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  }

  const broadResyncEnabled = Deno.env.get('ENABLE_ADMIN_SHOPIFY_RESYNC') === 'true';
  const exactImportEnabled = Deno.env.get('ENABLE_ADMIN_SHOPIFY_EXACT_ORDER_IMPORT') === 'true';

  if (!broadResyncEnabled && !exactImportEnabled) {
    return Response.json({
      success: true,
      skipped: true,
      reason: 'admin_shopify_resync_disabled',
      message: 'Admin Shopify order resync is disabled for May 30 launch freeze.',
    }, { status: 409 });
  }

  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (user?.role !== 'admin') {
    return Response.json({ error: 'Admin only' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const { limit = 50, order_id } = body;
  const exactIdentifier = normalizeIdentifier(
    body.exact_order_identifier ||
    body.order_name ||
    body.order_number ||
    order_id
  );

  if (exactIdentifier) {
    if (!exactImportEnabled) {
      return Response.json({
        success: true,
        skipped: true,
        reason: 'exact_shopify_order_import_disabled',
        message: 'Exact Shopify order import is disabled for May 30 launch freeze.',
      }, { status: 409 });
    }

    if (!isAllowlistedExactOrder(exactIdentifier)) {
      return Response.json({
        success: false,
        skipped: true,
        reason: 'exact_shopify_order_not_allowlisted',
        message: 'Exact Shopify order import is enabled only for explicitly allowlisted order identifiers.',
      }, { status: 403 });
    }

    const credentials = shopifyCredentials();
    if (!credentials.ok) return credentials.response;

    return importExactShopifyOrder({
      base44,
      token: credentials.token,
      storeUrl: credentials.storeUrl,
      identifier: exactIdentifier,
      actorEmail: user.email || 'admin',
    });
  }

  if (!broadResyncEnabled) {
    return Response.json({
      success: true,
      skipped: true,
      reason: 'exact_shopify_order_identifier_required',
      message: 'Broad Shopify resync is disabled. Provide one exact allowlisted Shopify order id, name, or number.',
    }, { status: 409 });
  }

  const credentials = shopifyCredentials();
  if (!credentials.ok) return credentials.response;
  const { token: SHOPIFY_API_TOKEN, storeUrl: SHOPIFY_STORE_URL } = credentials;

  let url = `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders.json?status=any&limit=${limit}`;
  if (order_id) {
    url = `https://${SHOPIFY_STORE_URL}/admin/api/2024-01/orders/${order_id}.json`;
  }

  console.log(`Manual resync from: ${url}`);

  const shopifyRes = await fetch(url, {
    headers: {
      'X-Shopify-Access-Token': SHOPIFY_API_TOKEN,
      'Content-Type': 'application/json',
    },
  });

  if (!shopifyRes.ok) {
    const errText = await shopifyRes.text();
    console.error('Shopify API error:', shopifyRes.status, errText);
    return Response.json({ error: `Shopify API returned ${shopifyRes.status}`, details: errText }, { status: 502 });
  }

  const data = await shopifyRes.json();
  const orders = order_id ? [data.order].filter(Boolean) : (data.orders || []);

  let synced = 0;
  let failed = 0;
  const results = [];

  for (const order of orders) {
    const shopifyOrderId = String(order.id);
    const orderNumber = String(order.order_number || order.name || order.id);
    const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: shopifyOrderId });

    const record = mapOrder(order);

    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, record);
      results.push({ order: orderNumber, action: 'updated' });
    } else {
      await base44.asServiceRole.entities.ShopifyOrder.create(record);
      results.push({ order: orderNumber, action: 'created' });
    }
    synced++;
  }

  await base44.asServiceRole.entities.ShopifySyncLog.create({
    sync_type: 'orders', status: failed > 0 ? 'partial' : 'success',
    records_synced: synced, records_failed: failed,
    started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
    triggered_by: 'manual',
  });

  return Response.json({ ok: true, synced, failed, results });
});

function normalizeIdentifier(value) {
  return String(value || '').trim();
}

function normalizeKey(value) {
  return normalizeIdentifier(value).replace(/^#/, '').toLowerCase();
}

function parseCsvSet(value) {
  return new Set(String(value || '').split(',').map(normalizeKey).filter(Boolean));
}

function isAllowlistedExactOrder(identifier) {
  const allowed = parseCsvSet(Deno.env.get('ADMIN_SHOPIFY_EXACT_ORDER_IMPORT_ALLOWLIST') || '');
  if (allowed.size === 0) return false;

  const key = normalizeKey(identifier);
  const hashName = key ? `#${key}` : '';
  return allowed.has(key) || allowed.has(hashName);
}

function shopifyCredentials() {
  const token = Deno.env.get('SHOPIFY_API_TOKEN');
  const storeUrl = Deno.env.get('SHOPIFY_STORE_URL');

  if (!token || !storeUrl) {
    return {
      ok: false,
      response: Response.json({ error: 'Shopify credentials not configured' }, { status: 500 }),
    };
  }

  return { ok: true, token, storeUrl };
}

async function importExactShopifyOrder({ base44, token, storeUrl, identifier, actorEmail }) {
  let order;
  try {
    order = await fetchExactShopifyOrder({ token, storeUrl, identifier });
  } catch (error) {
    return Response.json({
      success: false,
      skipped: true,
      reason: 'shopify_exact_order_lookup_failed',
      identifier: safeIdentifier(identifier),
      message: sanitizeErrorMessage(error?.message || 'Exact Shopify order lookup failed.'),
    }, { status: 502 });
  }

  if (!order) {
    return Response.json({
      success: false,
      skipped: true,
      reason: 'shopify_order_not_found',
      identifier: safeIdentifier(identifier),
    }, { status: 404 });
  }

  const mapped = mapOrderForNativeOps(order);
  const source = isPosOrder(order) ? 'shopify_pos' : 'website_one_time';
  const eventType = source === 'shopify_pos' ? 'pos.order.imported' : 'shopify.order.imported';
  const orderNumber = mapped.shopify_order_number || mapped.order_number || identifier;

  const response = await base44.asServiceRole.functions.invoke('processMay30NativeOrderOps', {
    mode: 'live',
    source,
    event_type: eventType,
    request_id: `shopify_exact_import:${order.id || orderNumber}`,
    idempotency_key: `may30_native_order_ops:${source}:${order.id || orderNumber}`,
    internal_secret: Deno.env.get('MAY30_NATIVE_ORDER_OPS_SECRET') || Deno.env.get('CUSTOMER_APP_SYNC_SECRET') || '',
    actor_email: actorEmail,
    order: mapped,
  });

  const result = response?.data || response || {};
  return Response.json({
    success: result?.success === true,
    action: result?.action || null,
    source,
    event_type: eventType,
    order_number: safeIdentifier(orderNumber),
    shopify_order_id: safeIdentifier(order.id),
    native_order_id: result?.order_id || null,
    review_queue: result?.review_queue || null,
    fulfillment_task: result?.fulfillment_task || null,
    production_demand: result?.production_demand || null,
    message: result?.success === true
      ? 'Exact Shopify order imported through May 30 native operations path.'
      : 'Exact Shopify order fetched, but May 30 native operations path did not accept it.',
    error_code: result?.error_code || null,
    warnings: Array.isArray(result?.warnings) ? result.warnings.slice(0, 5) : [],
  }, { status: result?.success === true ? 200 : 409 });
}

async function fetchExactShopifyOrder({ token, storeUrl, identifier }) {
  const storeHost = storeUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const trimmed = normalizeIdentifier(identifier);

  if (/^\d{8,}$/.test(trimmed)) {
    const byId = await fetch(`https://${storeHost}/admin/api/2024-01/orders/${trimmed}.json`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    if (byId.ok) {
      const data = await byId.json();
      if (data?.order) return data.order;
    }
    if (byId.status !== 404) {
      const errorText = await byId.text().catch(() => '');
      throw new Error(`Shopify exact order fetch failed: ${byId.status} ${errorText.slice(0, 120)}`);
    }
  }

  const nameCandidates = Array.from(new Set([
    trimmed,
    trimmed.startsWith('#') ? trimmed : `#${trimmed}`,
    trimmed.replace(/^#/, ''),
  ].filter(Boolean)));

  for (const candidate of nameCandidates) {
    const byName = await fetch(`https://${storeHost}/admin/api/2024-01/orders.json?status=any&limit=10&name=${encodeURIComponent(candidate)}`, {
      headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
    });
    if (!byName.ok) {
      const errorText = await byName.text().catch(() => '');
      throw new Error(`Shopify exact order name lookup failed: ${byName.status} ${errorText.slice(0, 120)}`);
    }
    const data = await byName.json();
    const matches = (data.orders || []).filter(order => {
      const orderName = normalizeKey(order.name);
      const orderNumber = normalizeKey(order.order_number);
      const wanted = normalizeKey(candidate);
      return orderName === wanted || orderNumber === wanted || String(order.id || '') === trimmed;
    });
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error('Ambiguous Shopify order lookup; multiple exact matches found');
  }

  return null;
}

function noteAttributes(order) {
  return (order.note_attributes || []).reduce((acc, attr) => {
    if (attr?.name) acc[attr.name] = attr.value;
    return acc;
  }, {});
}

function isPosOrder(order) {
  const sourceName = String(order.source_name || '').toLowerCase();
  const appId = String(order.app_id || '').toLowerCase();
  const tags = String(order.tags || '').toLowerCase();
  return sourceName === 'pos' ||
    sourceName.includes('pos') ||
    ['131', '131313', 'com.jadedpixel.pos', 'shopify_pos', 'pos'].includes(appId) ||
    Boolean(order.location_id) ||
    tags.includes('pos');
}

function mapNativeFulfillmentMethod(order, attrs) {
  if (isPosOrder(order)) return 'pos';

  const explicit = normalizeKey(attrs.fulfillment_type || attrs.fulfillment_method);
  if (explicit === 'pickup' || explicit === 'delivery') return explicit;

  const shippingLines = order.shipping_lines || [];
  if (shippingLines.some(line => String(line.title || '').toLowerCase().includes('pickup'))) {
    return 'pickup';
  }

  return 'delivery';
}

function mapOrderForNativeOps(order) {
  const attrs = noteAttributes(order);
  const address = order.shipping_address || order.billing_address || {};
  const customerName = [
    order.customer?.first_name || address.first_name,
    order.customer?.last_name || address.last_name,
  ].filter(Boolean).join(' ') || order.email || 'Shopify Customer';

  return {
    id: String(order.id || ''),
    shopify_order_id: String(order.id || ''),
    shopify_order_number: String(order.name || order.order_number || order.id || '').replace(/^#/, ''),
    order_number: String(order.name || order.order_number || order.id || '').replace(/^#/, ''),
    customer_name: customerName,
    customer_email: order.email || order.customer?.email || '',
    customer_phone: order.phone || order.customer?.phone || address.phone || '',
    line_items: (order.line_items || []).map(item => ({
      id: String(item.id || ''),
      shopify_line_item_id: String(item.id || ''),
      title: item.title || item.name || 'Item',
      variant_title: item.variant_title || '',
      sku: item.sku || '',
      quantity: Number(item.quantity || 0),
      price: Number(item.price || 0),
      total_discount: Number(item.total_discount || 0),
    })),
    total_price: Number(order.total_price || order.subtotal_price || 0),
    subtotal: Number(order.subtotal_price || order.total_price || 0),
    payment_status: order.financial_status || '',
    financial_status: order.financial_status || '',
    fulfillment_method: mapNativeFulfillmentMethod(order, attrs),
    source_name: order.source_name || '',
    app_id: order.app_id || null,
    location_id: order.location_id || null,
    location_name: order.location_name || '',
    order_date: order.created_at || new Date().toISOString(),
    requested_delivery_date: attrs.delivery_date || attrs.pickup_date || attrs.requested_date || '',
    selected_delivery_date: attrs.selected_delivery_date || attrs.delivery_date || '',
    assigned_delivery_date: attrs.assigned_delivery_date || attrs.delivery_date || '',
    delivery_window_label: attrs.time_window || attrs.delivery_window || '',
    delivery_address: {
      address1: address.address1 || '',
      address2: address.address2 || '',
      city: address.city || '',
      province: address.province_code || address.province || '',
      zip: address.zip || '',
      country_code: address.country_code || 'US',
    },
    address_line1: address.address1 || '',
    address_line2: address.address2 || '',
    address_city: address.city || '',
    address_state: address.province_code || address.province || '',
    address_postal_code: address.zip || '',
    address_country: address.country_code || 'US',
  };
}

function safeIdentifier(value) {
  return String(value || '').trim().slice(0, 120);
}

function sanitizeErrorMessage(message) {
  return String(message || 'error')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:shpat|sk|pk|rk|whsec|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .slice(0, 180);
}

function mapOrder(order) {
  const channel = detectChannel(order);
  return {
    shopify_order_id: String(order.id),
    shopify_order_number: String(order.order_number || order.name || order.id),
    source_channel: channel,
    customer_name: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Guest',
    customer_email: order.email || order.customer?.email || '',
    customer_phone: order.phone || order.customer?.phone || '',
    line_items: (order.line_items || []).map(li => ({
      shopify_line_item_id: String(li.id),
      title: li.title, variant_title: li.variant_title || '',
      sku: li.sku || '', quantity: li.quantity,
      price: parseFloat(li.price || 0), total_discount: parseFloat(li.total_discount || 0),
    })),
    fulfillment_method: order.source_name === 'pos' ? 'pos' : 'delivery',
    delivery_address: extractAddress(order),
    payment_status: order.financial_status || '',
    shopify_fulfillment_status: order.fulfillment_status || 'unfulfilled',
    financial_status: order.financial_status || '',
    subtotal: parseFloat(order.subtotal_price || 0),
    total_tax: parseFloat(order.total_tax || 0),
    total_discounts: parseFloat(order.total_discounts || 0),
    tip_received: parseFloat(order.total_tip_received || 0),
    total_price: parseFloat(order.total_price || 0),
    discount_codes: (order.discount_codes || []).map(d => d.code),
    customer_notes: order.note || '',
    tags: (order.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    is_pos_order: order.source_name === 'pos',
    is_subscription: (order.tags || '').toLowerCase().includes('subscription'),
    shopify_synced_at: new Date().toISOString(),
  };
}

function detectChannel(order) {
  const tags = (order.tags || '').toLowerCase();
  const src = (order.source_name || '').toLowerCase();
  if (src === 'pos') return 'pos';
  if (tags.includes('subscription')) return 'subscription';
  if (tags.includes('wholesale')) return 'wholesale';
  if (tags.includes('event')) return 'event';
  if (src === 'draft_order') return 'draft';
  if (src === 'admin') return 'admin';
  return 'online';
}

function extractAddress(order) {
  const addr = order.shipping_address || order.billing_address;
  if (!addr) return '';
  return [addr.address1, addr.city, addr.province_code, addr.zip].filter(Boolean).join(', ');
}
