import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Shopify Webhook Receiver
 * Handles: orders/create, orders/updated, orders/cancelled, orders/paid,
 *          orders/fulfilled, orders/refunded, products/create, products/update
 *
 * Register this URL in Shopify Admin > Settings > Notifications > Webhooks
 * Set your SHOPIFY_WEBHOOK_SECRET in secrets for verification.
 */

const SHOPIFY_WEBHOOK_SECRET = Deno.env.get('SHOPIFY_WEBHOOK_SECRET') || '';

async function verifyShopifyHmac(req, bodyText) {
  const hmacHeader = req.headers.get('x-shopify-hmac-sha256');
  if (!SHOPIFY_WEBHOOK_SECRET || !hmacHeader) return true; // skip if not configured
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SHOPIFY_WEBHOOK_SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(bodyText));
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return computed === hmacHeader;
}

function detectSourceChannel(order) {
  const tags = (order.tags || '').toLowerCase();
  const source = (order.source_name || '').toLowerCase();
  if (order.source_name === 'pos' || source === 'pos') return 'pos';
  if (tags.includes('subscription') || tags.includes('recurring')) return 'subscription';
  if (tags.includes('wholesale')) return 'wholesale';
  if (tags.includes('event')) return 'event';
  if (order.source_name === 'draft_order') return 'draft';
  if (source === 'admin') return 'admin';
  return 'online';
}

function mapFulfillmentMethod(order) {
  const shippingLines = order.shipping_lines || [];
  const noteAttr = (order.note_attributes || []).reduce((acc, a) => { acc[a.name] = a.value; return acc; }, {});
  if (order.source_name === 'pos') return 'pos';
  if (noteAttr['fulfillment_type'] === 'pickup') return 'pickup';
  if (shippingLines.some(l => (l.title || '').toLowerCase().includes('pickup'))) return 'pickup';
  return 'delivery';
}

function extractAddress(order) {
  const addr = order.shipping_address || order.billing_address;
  if (!addr) return '';
  return [addr.address1, addr.city, addr.province_code, addr.zip].filter(Boolean).join(', ');
}

function extractRequestedDate(order) {
  const attrs = (order.note_attributes || []).reduce((acc, a) => { acc[a.name] = a.value; return acc; }, {});
  return attrs['delivery_date'] || attrs['pickup_date'] || attrs['requested_date'] || '';
}

function mapToShopifyOrder(order) {
  const channel = detectSourceChannel(order);
  return {
    shopify_order_id: String(order.id),
    shopify_order_number: String(order.order_number || order.name || order.id),
    source_channel: channel,
    customer_name: [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || 'Guest',
    customer_email: order.email || order.customer?.email || '',
    customer_phone: order.phone || order.customer?.phone || order.billing_address?.phone || '',
    line_items: (order.line_items || []).map(li => ({
      shopify_line_item_id: String(li.id),
      title: li.title,
      variant_title: li.variant_title || '',
      sku: li.sku || '',
      quantity: li.quantity,
      price: parseFloat(li.price || 0),
      total_discount: parseFloat(li.total_discount || 0),
    })),
    fulfillment_method: mapFulfillmentMethod(order),
    delivery_address: extractAddress(order),
    requested_delivery_date: extractRequestedDate(order),
    requested_time_window: (order.note_attributes || []).find(a => a.name === 'time_window')?.value || '',
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
    subscription_cadence: '',
    shopify_synced_at: new Date().toISOString(),
    shopify_raw_payload: order,
  };
}

Deno.serve(async (req) => {
  const bodyText = await req.text();

  // Verify HMAC
  const valid = await verifyShopifyHmac(req, bodyText);
  if (!valid) {
    console.error('Invalid Shopify HMAC signature');
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const topic = req.headers.get('x-shopify-topic') || 'unknown';
  let payload;
  try {
    payload = JSON.parse(bodyText);
  } catch (e) {
    console.error('Failed to parse webhook payload:', e.message);
    return Response.json({ error: 'Bad JSON' }, { status: 400 });
  }

  const base44 = createClientFromRequest(req);
  const shopifyOrderId = payload.id ? String(payload.id) : null;
  const orderNumber = String(payload.order_number || payload.name || payload.id || '');

  // Log the webhook
  await base44.asServiceRole.entities.ShopifyWebhookLog.create({
    topic,
    shopify_order_id: shopifyOrderId,
    shopify_order_number: orderNumber,
    status: 'received',
    payload_preview: bodyText.substring(0, 500),
  });

  console.log(`Webhook received: ${topic} | Order: ${orderNumber}`);

  // Handle product sync topics
  if (topic.startsWith('products/')) {
    await handleProductSync(base44, topic, payload);
    return Response.json({ ok: true });
  }

  // Order topics
  if (!shopifyOrderId) {
    console.warn('No order ID in payload for topic:', topic);
    return Response.json({ ok: true });
  }

  // Idempotency: check for existing record
  const existing = await base44.asServiceRole.entities.ShopifyOrder.filter({ shopify_order_id: shopifyOrderId });

  if (topic === 'orders/create' || topic === 'orders/paid') {
    if (existing.length > 0) {
      console.log(`Duplicate webhook for order ${orderNumber} — skipping create`);
      await base44.asServiceRole.entities.ShopifyWebhookLog.filter({ shopify_order_id: shopifyOrderId, status: 'received' })
        .then(logs => logs.length > 0 ? base44.asServiceRole.entities.ShopifyWebhookLog.update(logs[logs.length - 1].id, { status: 'duplicate' }) : null);
      return Response.json({ ok: true, note: 'duplicate' });
    }
    const record = mapToShopifyOrder(payload);
    const created = await base44.asServiceRole.entities.ShopifyOrder.create(record);

    // Create operational alert
    await createAlert(base44, 'new_order', `New Order #${orderNumber}`, `${record.customer_name} · $${record.total_price?.toFixed(2)}`, shopifyOrderId, orderNumber, 'info');

    // Same-day pickup check
    const requestedDate = record.requested_delivery_date;
    if (requestedDate) {
      const today = new Date().toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      if (requestedDate === today && record.fulfillment_method === 'pickup') {
        await createAlert(base44, 'same_day_pickup', `Same-Day Pickup! #${orderNumber}`, `${record.customer_name} needs pickup today`, shopifyOrderId, orderNumber, 'critical');
      } else if (requestedDate === tomorrow && record.fulfillment_method === 'delivery') {
        await createAlert(base44, 'next_day_delivery', `Next-Day Delivery #${orderNumber}`, `${record.customer_name} — deliver tomorrow`, shopifyOrderId, orderNumber, 'warning');
      }
    }

    // High-volume order check
    const totalItems = record.line_items?.reduce((s, li) => s + li.quantity, 0) || 0;
    if (totalItems >= 12) {
      await createAlert(base44, 'high_volume', `High Volume Order #${orderNumber}`, `${totalItems} items — plan production capacity`, shopifyOrderId, orderNumber, 'warning');
    }

    // Missing info check
    if (!record.customer_phone && record.fulfillment_method === 'delivery') {
      await createAlert(base44, 'missing_info', `Missing Phone #${orderNumber}`, `No phone number for delivery order`, shopifyOrderId, orderNumber, 'warning');
    }

    await logSync(base44, 'webhook', 'success', 1, 0);
    console.log(`Created ShopifyOrder for #${orderNumber}`);

  } else if (topic === 'orders/updated') {
    if (existing.length > 0) {
      const updates = mapToShopifyOrder(payload);
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        shopify_fulfillment_status: updates.shopify_fulfillment_status,
        financial_status: updates.financial_status,
        customer_notes: updates.customer_notes,
        line_items: updates.line_items,
        total_price: updates.total_price,
        total_discounts: updates.total_discounts,
        shopify_synced_at: new Date().toISOString(),
      });
      console.log(`Updated ShopifyOrder #${orderNumber}`);
    } else {
      // Order not in Base44 yet — create it
      await base44.asServiceRole.entities.ShopifyOrder.create(mapToShopifyOrder(payload));
      console.log(`Created missing ShopifyOrder #${orderNumber} from update event`);
    }

  } else if (topic === 'orders/cancelled') {
    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        production_status: 'canceled',
        shopify_fulfillment_status: 'cancelled',
        shopify_synced_at: new Date().toISOString(),
      });
      await createAlert(base44, 'cancellation', `Order Canceled #${orderNumber}`, `${payload.customer?.first_name || ''} ${payload.customer?.last_name || ''} canceled their order`, shopifyOrderId, orderNumber, 'warning');
    }

  } else if (topic === 'orders/refunded') {
    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        production_status: 'refunded',
        financial_status: 'refunded',
        shopify_synced_at: new Date().toISOString(),
      });
      await createAlert(base44, 'refund', `Refund #${orderNumber}`, `Refund processed for ${payload.customer?.first_name || ''} — $${payload.total_price || '?'}`, shopifyOrderId, orderNumber, 'info');
    }

  } else if (topic === 'orders/fulfilled') {
    if (existing.length > 0) {
      await base44.asServiceRole.entities.ShopifyOrder.update(existing[0].id, {
        shopify_fulfillment_status: 'fulfilled',
        shopify_synced_at: new Date().toISOString(),
      });
    }
  }

  // Update webhook log status
  const logs = await base44.asServiceRole.entities.ShopifyWebhookLog.filter({ shopify_order_id: shopifyOrderId, status: 'received' });
  if (logs.length > 0) {
    await base44.asServiceRole.entities.ShopifyWebhookLog.update(logs[logs.length - 1].id, { status: 'processed', processed_at: new Date().toISOString() });
  }

  return Response.json({ ok: true });
});

async function handleProductSync(base44, topic, payload) {
  const shopifyProductId = String(payload.id);
  const existing = await base44.asServiceRole.entities.ShopifyProduct.filter({ shopify_product_id: shopifyProductId });
  const record = {
    shopify_product_id: shopifyProductId,
    title: payload.title,
    handle: payload.handle,
    product_type: payload.product_type || '',
    status: payload.status || 'active',
    vendor: payload.vendor || '',
    tags: (payload.tags || '').split(',').map(t => t.trim()).filter(Boolean),
    image_url: payload.image?.src || payload.images?.[0]?.src || '',
    variants: (payload.variants || []).map(v => ({
      shopify_variant_id: String(v.id),
      title: v.title,
      sku: v.sku || '',
      price: parseFloat(v.price || 0),
      compare_at_price: parseFloat(v.compare_at_price || 0),
      inventory_quantity: v.inventory_quantity || 0,
      inventory_policy: v.inventory_policy || 'deny',
    })),
    synced_at: new Date().toISOString(),
  };
  if (existing.length > 0) {
    await base44.asServiceRole.entities.ShopifyProduct.update(existing[0].id, record);
    console.log(`Updated product: ${payload.title}`);
  } else {
    await base44.asServiceRole.entities.ShopifyProduct.create(record);
    console.log(`Created product: ${payload.title}`);
  }
}

async function createAlert(base44, alertType, title, message, shopifyOrderId, orderNumber, severity) {
  await base44.asServiceRole.entities.OperationalAlert.create({
    alert_type: alertType, title, message,
    shopify_order_id: shopifyOrderId,
    order_number: orderNumber,
    severity, is_read: false, resolved: false,
  });
}

async function logSync(base44, syncType, status, synced, failed) {
  await base44.asServiceRole.entities.ShopifySyncLog.create({
    sync_type: syncType, status,
    records_synced: synced, records_failed: failed,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    triggered_by: 'webhook',
  });
}