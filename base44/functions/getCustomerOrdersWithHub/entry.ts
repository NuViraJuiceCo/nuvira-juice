import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * 🏛️ ACTIVE ARCHITECTURE FUNCTION — Option B (Read-Only Hub Expansion)
 * 
 * Role: Fetch and merge customer's local + Hub-verified operational orders for display.
 * Source of Truth: Hub (for operational order data, fulfillment tasks, delivery status)
 * 
 * PROCESS:
 * 1. Resolve customer email (auth_email ↔ contact_email mapping via UserProfile)
 * 2. Fetch local orders (non-superseded, non-cancelled)
 * 3. Query Hub for same customer's orders via getOrderUpdatesForCustomerApp
 * 4. Expand Hub subscription orders into individual fulfillment records
 * 5. Expand local subscription orders via FulfillmentTask references
 * 6. Merge: Hub wins on order_number collision; local fills missing address/phone
 * 7. Return merged list sorted by creation date (newest first)
 * 
 * FULFILLMENT TASK EXPANSION: Subscription orders from Hub are expanded into individual
 * fulfillment display records (one per weekly/monthly delivery). This ensures the customer
 * sees "1 Oasis, 1 Aura, 1 Re-Nu" per delivery, not parent "0-item" records.
 * 
 * Called by: pages/OrderHistory (customer-facing order list)
 * Hub Integration: Hub remains authoritative; Customer App displays and reads only.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { customer_email } = await req.json();

    if (!customer_email) {
      return Response.json({ error: 'customer_email required' }, { status: 400 });
    }

    // 1. Fetch local Customer App orders (by auth email)
    const localOrders = await base44.asServiceRole.entities.Order.filter(
      { customer_email },
      '-created_date',
      50
    );

    // Fetch all FulfillmentTasks for this customer (used to expand local subscription orders)
    let fulfillmentTasks = [];
    try {
      if (localOrders.length > 0) {
        fulfillmentTasks = await base44.asServiceRole.entities.FulfillmentTask.filter(
          { customer_email },
          '-created_date',
          200
        );
      }
    } catch (err) {
      // FulfillmentTask may not exist yet — skip expansion
      console.warn('[Fetch Orders] FulfillmentTask not available, skipping expansion:', err.message);
    }

    // 2. Resolve contact_email from UserProfile (handles Apple Sign In relay email)
    let hubQueryEmail = customer_email;
    const profiles = await base44.asServiceRole.entities.UserProfile.filter({ customer_email });
    if (profiles[0]?.contact_email && profiles[0].contact_email !== customer_email) {
      hubQueryEmail = profiles[0].contact_email;
      console.log(`[Fetch Orders] Apple Sign In detected — using contact_email ${hubQueryEmail} for Hub query`);
    }

    // 3. Fetch from Hub using correct endpoint: getOrderUpdatesForCustomerApp
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    let hubOrders = [];
    if (hubApiUrl && hubSecret) {
      try {
        // HUB_API_URL may already contain a path prefix — strip everything after the hostname
        const hubBase = hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '');
        const hubUrl = `${hubBase}/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(hubQueryEmail)}`;
        const hubResponse = await fetch(hubUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${hubSecret}`,
            'Content-Type': 'application/json',
          },
        });

        if (hubResponse.ok) {
          const hubData = await hubResponse.json();
          const rawOrders = hubData.orders || [];
          console.log(`[Fetch Orders] Hub returned ${rawOrders.length} raw orders for ${hubQueryEmail}`);

          // Expand subscription parent orders that have embedded fulfillments[]
          for (const order of rawOrders) {
            const fulfillments = order.fulfillments;
            if (Array.isArray(fulfillments) && fulfillments.length > 0) {
              // Expand each fulfillment into a display record
              for (const f of fulfillments) {
                hubOrders.push({
                  id: `${order.id || order.shopify_order_id}_f${f.fulfillment_number}`,
                  order_number: f.fulfillment_number === 1
                    ? (order.shopify_order_number || order.order_number || '').replace('#', '')
                    : `${(order.shopify_order_number || order.order_number || '').replace('#', '')}-${f.fulfillment_number}`,
                  customer_email: order.customer_email || hubQueryEmail,
                  status: mapHubStatus(f.status || order.status),
                  total: order.total ? order.total / (fulfillments.length) : 0,
                  subtotal: order.subtotal ? order.subtotal / (fulfillments.length) : 0,
                  delivery_fee: 0,
                  fulfillment_type: order.fulfillment_type || 'delivery',
                  delivery_address: order.delivery_address || '',
                  estimated_delivery_date: f.delivery_date || null,
                  items: f.items || order.line_items || [],
                  created_date: order.created_date || order.updated_date || null,
                  notes: `Monthly Ritual — Delivery ${f.fulfillment_number} of ${fulfillments.length}`,
                  is_hub_order: true,
                });
              }
            } else {
              // Regular order — normalize fields
              hubOrders.push({
                ...order,
                order_number: (order.shopify_order_number || order.order_number || '').replace('#', ''),
                status: mapHubStatus(order.status),
                items: order.line_items || order.items || [],
                is_hub_order: true,
              });
            }
          }
          console.log(`[Fetch Orders] Expanded to ${hubOrders.length} display orders`);
        } else {
          const errText = await hubResponse.text();
          console.warn(`[Fetch Orders] Hub call failed: ${hubResponse.status} — ${errText}`);
        }
      } catch (hubErr) {
        console.warn(`[Fetch Orders] Hub fetch error: ${hubErr.message}`);
      }
    }

    // 4. Expand local subscription orders that reference FulfillmentTasks
    // For each local order, check if it has fulfillment tasks that should be displayed separately
    const expandedLocalOrders = [];
    for (const order of localOrders) {
      // Check if this order has FulfillmentTasks
      const tasksForOrder = fulfillmentTasks.filter(t => t.order_id === order.id);
      
      if (tasksForOrder.length > 0) {
        // Subscription order — expand each fulfillment task into a display record
        for (const task of tasksForOrder) {
          expandedLocalOrders.push({
            id: task.id, // Use task ID for expanded records
            order_number: order.order_number + (tasksForOrder.length > 1 ? `-${task.fulfillment_number || 1}` : ''),
            customer_email,
            status: order.status,
            total: order.total ? order.total / tasksForOrder.length : 0,
            subtotal: order.subtotal ? order.subtotal / tasksForOrder.length : 0,
            delivery_fee: order.delivery_fee || 0,
            fulfillment_type: order.fulfillment_type || 'delivery',
            delivery_address: order.delivery_address || '',
            estimated_delivery_date: task.delivery_date || order.estimated_delivery_date || null,
            items: task.items || order.items || [],
            created_date: order.created_date || null,
            notes: order.notes || '',
            is_local_fulfillment_expansion: true, // Flag to indicate this is an expanded fulfillment
          });
        }
      } else {
        // Regular order with no fulfillment tasks — use as-is
        expandedLocalOrders.push(order);
      }
    }

    // 5. Fetch CheckoutSession records for address/pricing recovery
    let checkoutSessions = {};
    try {
      const allCheckouts = await base44.asServiceRole.entities.CheckoutSession.list('-created_date', 200);
      for (const cs of allCheckouts) {
        const orderNum = cs.order_number;
        if (orderNum) checkoutSessions[orderNum] = cs.checkout_data;
      }
      console.log(`[Fetch Orders] Loaded ${Object.keys(checkoutSessions).length} CheckoutSession records`);
    } catch (err) {
      console.warn(`[Fetch Orders] Failed to load CheckoutSession: ${err.message}`);
    }

    // 6. Merge: deduplicate by order_number
    // Rules:
    //   - Hub always wins for subscription orders (is_hub_order) or orders marked SUPERSEDED_BY_HUB
    //   - Local wins only for true local-only orders that don't exist on Hub
    const mergedMap = new Map();

    // Seed with Hub orders first
    for (const order of hubOrders) {
      if (order.order_number) {
        // Patch missing address/prices from CheckoutSession
        const checkout = checkoutSessions[order.order_number];
        if (checkout) {
          if (!order.delivery_address && checkout.delivery_address) order.delivery_address = checkout.delivery_address;
          if ((!order.items || order.items.length === 0) && checkout.items) order.items = checkout.items;
          if ((order.total === 0 || !order.total) && checkout.total) order.total = checkout.total;
          if ((order.subtotal === 0 || !order.subtotal) && checkout.subtotal) order.subtotal = checkout.subtotal;
          if (!order.customer_name && checkout.customer_name) order.customer_name = checkout.customer_name;
        }
        mergedMap.set(order.order_number, order);
      }
    }

    // Local orders only win if:
    //   1. No Hub record exists for this order_number, AND
    //   2. The local record is not marked as superseded by Hub
    for (const order of expandedLocalOrders) {
      if (!order.order_number) continue;
      const isSuperseded = order.notes && order.notes.includes('SUPERSEDED_BY_HUB');
      const hubAlreadyHasIt = mergedMap.has(order.order_number) && mergedMap.get(order.order_number).is_hub_order;
      if (!isSuperseded && !hubAlreadyHasIt) {
        mergedMap.set(order.order_number, order);
      }
    }

    const mergedOrders = Array.from(mergedMap.values()).sort((a, b) => {
      const aDate = new Date(a.created_date || a.updated_date || 0);
      const bDate = new Date(b.created_date || b.updated_date || 0);
      return bDate - aDate;
    });

    console.log(`[Fetch Orders] Final merged count: ${mergedOrders.length} for ${customer_email} (hub email: ${hubQueryEmail})`);

    return Response.json({
      success: true,
      customer_email,
      hub_query_email: hubQueryEmail,
      local_count: localOrders.length,
      hub_count: hubOrders.length,
      merged_count: mergedOrders.length,
      orders: mergedOrders,
    });
  } catch (error) {
    console.error('[Fetch Orders] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Map Hub production_status values to Customer App status enum
 */
function mapHubStatus(hubStatus) {
  const map = {
    new: 'order_received',
    awaiting_production: 'scheduled_for_juicing',
    in_production: 'in_production',
    bottled: 'bottled_packed',
    labeled: 'bottled_packed',
    qc_checked: 'bottled_packed',
    packed: 'bottled_packed',
    in_cold_storage: 'bottled_packed',
    assigned_for_pickup: 'ready_for_pickup',
    assigned_for_delivery: 'out_for_delivery',
    fulfilled: 'delivered',
    pending: 'scheduled_for_juicing',
    production_scheduled: 'scheduled_for_juicing',
    // pass-through if already a valid customer app status
    order_received: 'order_received',
    scheduled_for_juicing: 'scheduled_for_juicing',
    in_production: 'in_production',
    bottled_packed: 'bottled_packed',
    out_for_delivery: 'out_for_delivery',
    arriving_soon: 'arriving_soon',
    delivered: 'delivered',
    ready_for_pickup: 'ready_for_pickup',
    picked_up: 'picked_up',
  };
  return map[hubStatus] || 'order_received';
}