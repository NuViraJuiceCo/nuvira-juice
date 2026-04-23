import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin endpoint: fetch ALL orders for hub sync (no date filter).
 * Returns paginated results to avoid timeout on large datasets.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { limit = 100, offset = 0 } = await req.json();

    // Fetch orders with pagination
    const allOrders = await base44.asServiceRole.entities.Order.list('-updated_date', 999999);
    const paginatedOrders = allOrders.slice(offset, offset + limit);

    const ordersForSync = paginatedOrders.map(o => ({
      id: o.id,
      order_number: o.order_number,
      customer_email: o.customer_email,
      items: o.items,
      subtotal: o.subtotal,
      delivery_fee: o.delivery_fee,
      total: o.total,
      fulfillment_type: o.fulfillment_type,
      delivery_address: o.delivery_address,
      contact_phone: o.contact_phone,
      estimated_delivery_date: o.estimated_delivery_date,
      status: o.status,
      is_preorder: o.is_preorder,
      preorder_fulfillment_date: o.preorder_fulfillment_date,
      payment_captured: o.payment_captured,
      stripe_payment_intent_id: o.stripe_payment_intent_id,
      stripe_checkout_session_id: o.stripe_checkout_session_id,
      referral_code: o.referral_code,
      created_date: o.created_date,
      updated_date: o.updated_date,
      delivered_at: o.delivered_at,
      delivery_photo_url: o.delivery_photo_url,
      delivery_drop_location: o.delivery_drop_location,
      delivered_by: o.delivered_by,
    }));

    console.log(`Returning ${paginatedOrders.length} orders (offset: ${offset}, limit: ${limit})`);

    return Response.json({
      success: true,
      total: allOrders.length,
      offset,
      limit,
      count: paginatedOrders.length,
      orders: ordersForSync,
    });
  } catch (error) {
    console.error('Get all orders for sync error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});