import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * syncHubDeliveryStatuses — scheduled every 10 minutes.
 * 
 * Fetches active CA orders (not yet delivered/cancelled), queries Hub for
 * current production_status, maps to CA status, and updates any that have changed.
 * 
 * The CA Order entity automation "Order Status Notification Trigger" then fires
 * automatically on status change → sendOrderStatusNotification → sendCustomerNotification.
 * 
 * Terminal state guard: never overwrites delivered, cancelled, refunded, picked_up.
 * Idempotent: only writes if status actually changed.
 */

const HUB_BASE = (Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
const SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const TERMINAL_STATUSES = new Set(['delivered', 'picked_up', 'cancelled', 'refunded']);

// Hub production_status → CA Order status
function mapHubStatus(hubStatus) {
  const map = {
    new:                      'order_received',
    awaiting_production:      'scheduled_for_juicing',
    scheduled_for_production: 'scheduled_for_juicing',
    in_production:            'in_production',
    bottled:                  'bottled_packed',
    labeled:                  'bottled_packed',
    qc_checked:               'bottled_packed',
    packed:                   'bottled_packed',
    in_cold_storage:          'bottled_packed',
    assigned_for_pickup:      'ready_for_pickup',
    assigned_for_delivery:    'out_for_delivery',
    fulfilled:                'delivered',
    // pass-throughs
    order_received:           'order_received',
    scheduled_for_juicing:    'scheduled_for_juicing',
    bottled_packed:           'bottled_packed',
    out_for_delivery:         'out_for_delivery',
    arriving_soon:            'arriving_soon',
    ready_for_pickup:         'ready_for_pickup',
    picked_up:                'picked_up',
  };
  return map[hubStatus] || null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    if (!HUB_BASE || !SYNC_SECRET) {
      console.log('[syncHubDeliveryStatuses] HUB_API_URL or CUSTOMER_APP_SYNC_SECRET not set, skipping');
      return Response.json({ success: true, skipped: true, reason: 'missing_env' });
    }

    // Fetch active (non-terminal, paid) CA orders
    const allOrders = await base44.asServiceRole.entities.Order.list('-updated_date', 300);
    const activeOrders = allOrders.filter(o =>
      o.order_number &&
      o.payment_captured === true &&
      !TERMINAL_STATUSES.has(o.status) &&
      o.payment_status !== 'refunded' &&
      o.status !== 'cancelled' &&
      !o.is_test_order &&
      !o.is_abandoned_checkout
    );

    if (activeOrders.length === 0) {
      console.log('[syncHubDeliveryStatuses] No active orders to sync');
      return Response.json({ success: true, active_orders: 0, updated: 0 });
    }

    console.log(`[syncHubDeliveryStatuses] Checking ${activeOrders.length} active orders against Hub`);

    // Get unique customer emails to batch Hub queries
    const uniqueEmails = [...new Set(activeOrders.map(o => o.customer_email).filter(Boolean))];

    // Map: order_number → hub order
    const hubByOrderNum = new Map();

    for (const email of uniqueEmails) {
      try {
        const hubUrl = `${HUB_BASE}/api/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(email)}`;
        const res = await fetch(hubUrl, {
          headers: {
            'Authorization': `Bearer ${SYNC_SECRET}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          console.warn(`[syncHubDeliveryStatuses] Hub returned ${res.status} for ${email}`);
          continue;
        }

        const data = await res.json();
        for (const order of (data.orders || [])) {
          const num = (order.shopify_order_number || order.order_number || '').replace('#', '');
          if (num) hubByOrderNum.set(num, order);
        }
      } catch (err) {
        console.warn(`[syncHubDeliveryStatuses] Hub fetch error for ${email}: ${err.message}`);
      }
    }

    console.log(`[syncHubDeliveryStatuses] Fetched ${hubByOrderNum.size} Hub orders`);

    let updated = 0;
    let skipped = 0;
    const updatedOrders = [];

    for (const caOrder of activeOrders) {
      const hubOrder = hubByOrderNum.get(caOrder.order_number);
      if (!hubOrder) { skipped++; continue; }

      const hubProdStatus = hubOrder.production_status || hubOrder.status;
      const mappedStatus = mapHubStatus(hubProdStatus);

      if (!mappedStatus || mappedStatus === caOrder.status) { skipped++; continue; }

      // Terminal guard: never overwrite a terminal CA status
      if (TERMINAL_STATUSES.has(caOrder.status)) { skipped++; continue; }

      // Update CA Order — this triggers the entity automation → notification
      const newHistory = [
        ...(caOrder.status_history || []),
        {
          status: mappedStatus,
          timestamp: new Date().toISOString(),
          message: `Status synced from Hub (hub_status: ${hubProdStatus})`,
        },
      ];

      await base44.asServiceRole.entities.Order.update(caOrder.id, {
        status: mappedStatus,
        status_history: newHistory,
      });

      console.log(`[syncHubDeliveryStatuses] ✅ ${caOrder.order_number}: ${caOrder.status} → ${mappedStatus}`);
      updated++;
      updatedOrders.push({ order_number: caOrder.order_number, from: caOrder.status, to: mappedStatus });
    }

    console.log(`[syncHubDeliveryStatuses] Done. updated=${updated} skipped=${skipped}`);
    return Response.json({ success: true, active_orders: activeOrders.length, updated, skipped, updatedOrders });

  } catch (error) {
    console.error('[syncHubDeliveryStatuses] Fatal error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});