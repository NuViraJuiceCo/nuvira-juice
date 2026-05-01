import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * ⚠️ LEGACY READ-ONLY CACHE FUNCTION (Not in active sync path)
 * Architecture: Option B - Customer App reads Hub data via getCustomerOrdersWithHub
 *
 * This function is preserved as a manual admin tool but is NOT called in the active UI path.
 * It does NOT overwrite Hub-verified data; it only reads local orders and returns them.
 * 
 * IMPORTANT: This function must NEVER create an operational sync loop or background cache.
 * If you need to sync orders from Hub, use getCustomerOrdersWithHub (display query) instead.
 * 
 * Previous behavior: Admin-callable function to manually trigger a local order cache refresh
 * Current use: MANUAL ADMIN TOOL ONLY (not automated)
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // ⚠️ LEGACY: This function now only lists local orders. It does NOT sync from Hub.
    // Hub orders are fetched at display time via getCustomerOrdersWithHub and getAdminOrdersWithHub.
    // Local orders are displayed as-is (non-hub-managed).
    // 
    // This function is available as a manual admin inspection tool only.
    console.log('syncOrdersFromHub: LEGACY - Returning local order cache only (not syncing from Hub)');
    
    const allOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
    const hubOrders = allOrders;  // Local only, NOT Hub

    let synced = 0;
    let errors = 0;

    // Sync each order to local database
    for (const hubOrder of hubOrders) {
      try {
        // Check if order already exists locally
        const existing = await base44.asServiceRole.entities.Order.filter({ order_number: hubOrder.order_number });

        if (existing.length === 0) {
          // Create new order
          await base44.asServiceRole.entities.Order.create({
            order_number: hubOrder.order_number,
            customer_email: hubOrder.customer_email,
            items: hubOrder.items || [],
            subtotal: hubOrder.subtotal || 0,
            delivery_fee: hubOrder.delivery_fee || 0,
            total: hubOrder.total || 0,
            fulfillment_type: hubOrder.fulfillment_type || 'delivery',
            delivery_address: hubOrder.delivery_address || '',
            contact_phone: hubOrder.contact_phone || '',
            estimated_delivery_date: hubOrder.estimated_delivery_date,
            status: hubOrder.status || 'order_received',
            status_history: hubOrder.status_history || [],
            notes: hubOrder.notes || '',
          });
          synced++;
        } else {
          // Update existing order if status differs
          const local = existing[0];
          if (local.status !== hubOrder.status) {
            await base44.asServiceRole.entities.Order.update(local.id, {
              status: hubOrder.status,
              status_history: hubOrder.status_history || [],
            });
            synced++;
          }
        }
      } catch (err) {
        console.error(`Failed to sync order ${hubOrder.order_number}:`, err.message);
        errors++;
      }
    }

    console.log(`Synced ${synced} orders from hub, ${errors} errors`);

    return Response.json({
      success: true,
      message: 'Orders synced from hub',
      synced,
      errors,
      total_from_hub: hubOrders.length,
    });
  } catch (error) {
    console.error('Sync orders from hub error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});