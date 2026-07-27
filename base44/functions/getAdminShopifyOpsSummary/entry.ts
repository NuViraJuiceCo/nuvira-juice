import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function safeString(value, maxLength = 240) {
  const text = normalizeText(value);
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}…` : text;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeStringArray(value, maxItems = 30) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(item => safeString(item, 120)).filter(Boolean);
}

function sanitizeLineItems(items) {
  if (!Array.isArray(items)) return [];
  return items.slice(0, 40).map(item => ({
    shopify_line_item_id: safeString(item?.shopify_line_item_id, 120),
    title: safeString(item?.title, 160),
    variant_title: safeString(item?.variant_title, 160),
    sku: safeString(item?.sku, 80),
    quantity: safeNumber(item?.quantity),
    price: item?.price === null || item?.price === undefined ? 0 : safeNumber(item.price),
    total_discount: item?.total_discount === null || item?.total_discount === undefined ? 0 : safeNumber(item.total_discount),
  })).filter(item => item.title || item.sku || item.quantity);
}

function sanitizeWorkflowChecklist(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 40)
      .map(([key, checked]) => [safeString(key, 80), checked === true])
      .filter(([key]) => Boolean(key))
  );
}

function sanitizeOrder(order, customerOrder = null) {
  return {
    id: safeString(order?.id, 140),
    shopify_order_id: safeString(order?.shopify_order_id, 140),
    shopify_order_number: safeString(order?.shopify_order_number, 80),
    source_channel: safeString(order?.source_channel, 80),
    customer_name: safeString(customerOrder?.customer_name || order?.customer_name, 160),
    customer_email: safeString(order?.customer_email, 180),
    customer_phone: safeString(order?.customer_phone, 80),
    line_items: sanitizeLineItems(order?.line_items),
    fulfillment_method: safeString(order?.fulfillment_method, 80),
    delivery_address: safeString(order?.delivery_address || customerOrder?.delivery_address, 260),
    requested_delivery_date: safeString(order?.requested_delivery_date || order?.selected_delivery_date || customerOrder?.requested_delivery_date || customerOrder?.estimated_delivery_date, 80),
    requested_time_window: safeString(order?.requested_time_window || customerOrder?.delivery_window_label, 120),
    payment_status: safeString(order?.payment_status, 80),
    fulfillment_status: safeString(order?.fulfillment_status, 80),
    shopify_fulfillment_status: safeString(order?.shopify_fulfillment_status, 80),
    financial_status: safeString(order?.financial_status, 80),
    subtotal: safeNumber(order?.subtotal),
    total_tax: safeNumber(order?.total_tax),
    total_discounts: safeNumber(order?.total_discounts),
    tip_received: safeNumber(order?.tip_received),
    total_price: safeNumber(order?.total_price),
    discount_codes: safeStringArray(order?.discount_codes),
    customer_notes: safeString(order?.customer_notes, 1000),
    internal_notes: safeString(order?.internal_notes, 1000),
    tags: safeStringArray(order?.tags),
    is_pos_order: order?.is_pos_order === true,
    is_subscription: order?.is_subscription === true,
    event_name: safeString(order?.event_name, 160),
    event_date: safeString(order?.event_date, 80),
    event_location: safeString(order?.event_location, 160),
    production_status: safeString(order?.production_status, 80),
    workflow_checklist: sanitizeWorkflowChecklist(order?.workflow_checklist),
    shopify_synced_at: safeString(order?.shopify_synced_at, 80),
    created_date: safeString(order?.created_date, 80),
    updated_date: safeString(order?.updated_date, 80),
  };
}

function sanitizeAlert(alert) {
  return {
    id: safeString(alert?.id, 140),
    alert_type: safeString(alert?.alert_type, 80),
    title: safeString(alert?.title, 180),
    message: safeString(alert?.message, 500),
    shopify_order_id: safeString(alert?.shopify_order_id, 140),
    order_number: safeString(alert?.order_number, 80),
    severity: safeString(alert?.severity, 40),
    is_read: alert?.is_read === true,
    resolved: alert?.resolved === true,
    created_date: safeString(alert?.created_date, 80),
    updated_date: safeString(alert?.updated_date, 80),
  };
}

function sanitizeProduct(product) {
  return {
    id: safeString(product?.id, 140),
    shopify_product_id: safeString(product?.shopify_product_id, 140),
    title: safeString(product?.title, 180),
    handle: safeString(product?.handle, 180),
    product_type: safeString(product?.product_type, 120),
    status: safeString(product?.status, 80),
    vendor: safeString(product?.vendor, 120),
    tags: safeStringArray(product?.tags),
    image_url: safeString(product?.image_url, 500),
    variants: Array.isArray(product?.variants) ? product.variants.slice(0, 50).map(variant => ({
      shopify_variant_id: safeString(variant?.shopify_variant_id, 140),
      title: safeString(variant?.title, 160),
      sku: safeString(variant?.sku, 80),
      price: variant?.price === null || variant?.price === undefined ? null : safeNumber(variant.price),
      compare_at_price: variant?.compare_at_price === null || variant?.compare_at_price === undefined ? null : safeNumber(variant.compare_at_price),
      inventory_quantity: safeNumber(variant?.inventory_quantity),
      inventory_policy: safeString(variant?.inventory_policy, 80),
    })) : [],
    synced_at: safeString(product?.synced_at, 80),
    created_date: safeString(product?.created_date, 80),
  };
}

function sanitizeSyncLog(log) {
  return {
    id: safeString(log?.id, 140),
    sync_type: safeString(log?.sync_type, 80),
    status: safeString(log?.status, 80),
    records_synced: safeNumber(log?.records_synced),
    records_failed: safeNumber(log?.records_failed),
    error_details: safeString(log?.error_details, 500),
    started_at: safeString(log?.started_at, 80),
    completed_at: safeString(log?.completed_at, 80),
    triggered_by: safeString(log?.triggered_by, 80),
    created_date: safeString(log?.created_date, 80),
  };
}

function sanitizeWebhookLog(log) {
  return {
    id: safeString(log?.id, 140),
    topic: safeString(log?.topic, 120),
    shopify_order_id: safeString(log?.shopify_order_id, 140),
    shopify_order_number: safeString(log?.shopify_order_number, 80),
    status: safeString(log?.status, 80),
    error_message: safeString(log?.error_message, 500),
    description: safeString(log?.description, 500),
    processed_at: safeString(log?.processed_at, 80),
    created_date: safeString(log?.created_date, 80),
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    let user = null;

    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const [ordersRaw, customerOrdersRaw, alertsRaw, productsRaw, syncLogsRaw, webhookLogsRaw] = await Promise.all([
      base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500).catch(error => {
        console.warn('[getAdminShopifyOpsSummary] ShopifyOrder unavailable:', error.message);
        return [];
      }),
      base44.asServiceRole.entities.Order?.list
        ? base44.asServiceRole.entities.Order.list('-created_date', 500).catch(error => {
          console.warn('[getAdminShopifyOpsSummary] Order unavailable:', error.message);
          return [];
        })
        : Promise.resolve([]),
      base44.asServiceRole.entities.OperationalAlert.list('-created_date', 100).catch(error => {
        console.warn('[getAdminShopifyOpsSummary] OperationalAlert unavailable:', error.message);
        return [];
      }),
      base44.asServiceRole.entities.ShopifyProduct.list('-created_date', 100).catch(error => {
        console.warn('[getAdminShopifyOpsSummary] ShopifyProduct unavailable:', error.message);
        return [];
      }),
      base44.asServiceRole.entities.ShopifySyncLog.list('-created_date', 20).catch(error => {
        console.warn('[getAdminShopifyOpsSummary] ShopifySyncLog unavailable:', error.message);
        return [];
      }),
      base44.asServiceRole.entities.ShopifyWebhookLog.list('-created_date', 30).catch(error => {
        console.warn('[getAdminShopifyOpsSummary] ShopifyWebhookLog unavailable:', error.message);
        return [];
      }),
    ]);

    const customerOrdersById = new Map();
    const customerOrdersByNumber = new Map();
    for (const order of customerOrdersRaw) {
      if (order.id) customerOrdersById.set(order.id, order);
      const orderNumber = normalizeLower(order.order_number || order.shopify_order_number);
      if (orderNumber) customerOrdersByNumber.set(orderNumber, order);
    }

    const orders = ordersRaw.map(order => {
      const customerOrder = (
        customerOrdersById.get(order.base44_order_id) ||
        customerOrdersByNumber.get(normalizeLower(order.shopify_order_number || order.order_number)) ||
        null
      );
      return sanitizeOrder(order, customerOrder);
    });
    const alerts = alertsRaw.map(sanitizeAlert);
    const products = productsRaw.map(sanitizeProduct);
    const sync_logs = syncLogsRaw.map(sanitizeSyncLog);
    const webhook_logs = webhookLogsRaw.map(sanitizeWebhookLog);

    return Response.json({
      success: true,
      source: 'customer_app_admin_shopify_ops_summary',
      generated_at: new Date().toISOString(),
      orders,
      alerts,
      products,
      sync_logs,
      webhook_logs,
      summary: {
        order_count: orders.length,
        active_order_count: orders.filter(order => !['fulfilled', 'canceled', 'refunded'].includes(order.production_status || '')).length,
        alert_count: alerts.length,
        unread_alert_count: alerts.filter(alert => alert.is_read !== true).length,
        product_count: products.length,
        sync_log_count: sync_logs.length,
        webhook_log_count: webhook_logs.length,
      },
      native_admin_read: true,
      customer_notification_sent: false,
      provider_calls: false,
      inventory_mutation: false,
      purchase_order_mutation: false,
    });
  } catch (error) {
    console.error('[getAdminShopifyOpsSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load Shopify operations summary' }, { status: 500 });
  }
});
