import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Get recent orders from this app
    const orders = await base44.asServiceRole.entities.Order.list('-created_date', 10);
    const shopifyOrders = await base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 10);

    const validation = {
      timestamp: new Date().toISOString(),
      app_orders_count: orders.length,
      shopify_orders_count: shopifyOrders.length,
      sync_status: 'checking...',
      data_integrity: {
        customer_emails_match: 0,
        total_price_matches: 0,
        line_items_matches: 0,
        missing_fields: [],
      },
      warnings: [],
    };

    // Verify data integrity between order sources
    orders.forEach((order) => {
      const matchingShopify = shopifyOrders.find(
        (so) => so.base44_order_id === order.id
      );

      if (matchingShopify) {
        if (order.customer_email === matchingShopify.customer_email) {
          validation.data_integrity.customer_emails_match++;
        }
        if (
          Math.abs((order.total || 0) - (matchingShopify.total_price || 0)) < 0.01
        ) {
          validation.data_integrity.total_price_matches++;
        }
        if (order.items?.length === matchingShopify.line_items?.length) {
          validation.data_integrity.line_items_matches++;
        }
      }
    });

    // Check for required fields on recent orders
    orders.slice(0, 5).forEach((order) => {
      const missing = [];
      if (!order.order_number) missing.push('order_number');
      if (!order.customer_email) missing.push('customer_email');
      if (!order.items?.length) missing.push('items');
      if (!order.total) missing.push('total');
      if (missing.length > 0) {
        validation.data_integrity.missing_fields.push({
          order_id: order.id,
          missing,
        });
      }
    });

    shopifyOrders.slice(0, 5).forEach((order) => {
      const missing = [];
      if (!order.shopify_order_id) missing.push('shopify_order_id');
      if (!order.customer_email) missing.push('customer_email');
      if (!order.line_items?.length) missing.push('line_items');
      if (!order.total_price) missing.push('total_price');
      if (missing.length > 0) {
        validation.data_integrity.missing_fields.push({
          shopify_order_id: order.id,
          missing,
        });
      }
    });

    // Check sync flow
    if (orders.length > 0 && shopifyOrders.length > 0) {
      const syncedOrders = shopifyOrders.filter((so) => so.base44_order_id);
      validation.sync_status = `${syncedOrders.length}/${Math.max(orders.length, shopifyOrders.length)} orders synced`;
    }

    // Data mapping verification
    if (validation.data_integrity.customer_emails_match > 0) {
      validation.warnings.push('✓ Customer emails syncing correctly');
    } else if (orders.length > 0 && shopifyOrders.length > 0) {
      validation.warnings.push('⚠️ Customer email mismatch detected');
    }

    if (validation.data_integrity.missing_fields.length === 0) {
      validation.warnings.push('✓ No missing required fields detected');
    } else {
      validation.warnings.push(
        `⚠️ Missing fields found in ${validation.data_integrity.missing_fields.length} records`
      );
    }

    console.log('Data flow validation:', validation);
    return Response.json(validation);
  } catch (error) {
    console.error('validateOrderDataFlow error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});