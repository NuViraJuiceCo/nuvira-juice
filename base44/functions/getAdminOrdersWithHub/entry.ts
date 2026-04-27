import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin order list: local orders (excluding superseded) + Hub orders for customers
 * who have subscription orders on the Hub.
 * Hub wins for any order_number that exists on both sides.
 * Superseded local records (notes contains SUPERSEDED_BY_HUB) are excluded.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 1. Fetch all local orders, exclude superseded
    const allLocalOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
    const localOrders = allLocalOrders.filter(o =>
      !(o.notes && o.notes.includes('SUPERSEDED_BY_HUB'))
    );

    // 2. Find unique customer emails that have local orders
    const localEmailSet = new Set(localOrders.map(o => o.customer_email).filter(Boolean));

    // 3. Also find contact_emails from UserProfiles (for Apple Sign In customers)
    // Build map: auth_email -> contact_email
    const profiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', 500);
    const authToContact = {};
    const contactToAuth = {};
    for (const p of profiles) {
      if (p.customer_email && p.contact_email && p.customer_email !== p.contact_email) {
        authToContact[p.customer_email] = p.contact_email;
        contactToAuth[p.contact_email] = p.customer_email;
      }
    }

    // Resolve hub query emails for all customers with local orders
    const hubQueryEmails = new Set();
    for (const email of localEmailSet) {
      hubQueryEmails.add(authToContact[email] || email);
    }

    // 4. Fetch Hub orders for each unique hub email
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const hubBase = hubApiUrl ? hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '') : null;

    let allHubOrders = [];

    if (hubBase && hubSecret) {
      // Fetch in parallel for all hub emails
      const fetches = Array.from(hubQueryEmails).map(async (hubEmail) => {
        try {
          const url = `${hubBase}/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(hubEmail)}`;
          const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${hubSecret}` },
          });
          if (!res.ok) {
            console.warn(`[AdminOrders] Hub fetch failed for ${hubEmail}: ${res.status}`);
            return [];
          }
          const data = await res.json();
          const rawOrders = data.orders || [];

          // Resolve auth email for this hub email
          const authEmail = contactToAuth[hubEmail] || hubEmail;

          const expanded = [];
          for (const order of rawOrders) {
            const fulfillments = order.fulfillments;
            if (Array.isArray(fulfillments) && fulfillments.length > 0) {
              for (const f of fulfillments) {
                expanded.push({
                  id: `hub_${order.id || order.shopify_order_id}_f${f.fulfillment_number}`,
                  order_number: f.fulfillment_number === 1
                    ? (order.shopify_order_number || order.order_number || '').replace('#', '')
                    : `${(order.shopify_order_number || order.order_number || '').replace('#', '')}-${f.fulfillment_number}`,
                  customer_email: authEmail,
                  hub_customer_email: order.customer_email || hubEmail,
                  status: mapHubStatus(f.status || order.status),
                  total: order.total ? order.total / fulfillments.length : 0,
                  subtotal: order.subtotal ? order.subtotal / fulfillments.length : 0,
                  delivery_fee: 0,
                  fulfillment_type: order.fulfillment_type || 'delivery',
                  delivery_address: order.delivery_address || '',
                  contact_phone: order.contact_phone || '',
                  estimated_delivery_date: f.delivery_date || null,
                  created_date: f.delivery_date || order.created_date || order.updated_date || null,
                  items: f.items || order.line_items || [],
                  notes: `${order.subscription_plan || 'Subscription'} — Delivery ${f.fulfillment_number} of ${fulfillments.length}`,
                  is_hub_order: true,
                  is_read_only: true, // Hub manages status for subscriptions
                });
              }
            } else {
              expanded.push({
                ...order,
                id: `hub_${order.id}`,
                order_number: (order.shopify_order_number || order.order_number || '').replace('#', ''),
                customer_email: authEmail,
                hub_customer_email: order.customer_email || hubEmail,
                status: mapHubStatus(order.status),
                items: order.line_items || order.items || [],
                created_date: order.created_date || order.updated_date || null,
                is_hub_order: true,
                is_read_only: true,
              });
            }
          }
          return expanded;
        } catch (err) {
          console.warn(`[AdminOrders] Hub error for ${hubEmail}: ${err.message}`);
          return [];
        }
      });

      const results = await Promise.all(fetches);
      allHubOrders = results.flat();
      console.log(`[AdminOrders] Hub returned ${allHubOrders.length} total orders across ${hubQueryEmails.size} customers`);
    }

    // 5. Merge: Hub wins for any order_number it has; local wins otherwise
    const mergedMap = new Map();

    // Seed with Hub orders
    for (const order of allHubOrders) {
      if (order.order_number) mergedMap.set(order.order_number, order);
    }

    // Local orders win only if Hub doesn't have that order_number
    for (const order of localOrders) {
      if (!order.order_number) continue;
      const hubHasIt = mergedMap.has(order.order_number) && mergedMap.get(order.order_number).is_hub_order;
      if (!hubHasIt) {
        mergedMap.set(order.order_number, order);
      }
    }

    const merged = Array.from(mergedMap.values()).sort((a, b) => {
      const aDate = new Date(a.created_date || 0);
      const bDate = new Date(b.created_date || 0);
      return bDate - aDate;
    });

    console.log(`[AdminOrders] Final merged: ${merged.length} orders (${localOrders.length} local, ${allHubOrders.length} hub)`);

    return Response.json({
      success: true,
      total: merged.length,
      local_count: localOrders.length,
      hub_count: allHubOrders.length,
      orders: merged,
    });
  } catch (error) {
    console.error('[AdminOrders] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

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
    order_received: 'order_received',
    scheduled_for_juicing: 'scheduled_for_juicing',
    bottled_packed: 'bottled_packed',
    out_for_delivery: 'out_for_delivery',
    arriving_soon: 'arriving_soon',
    delivered: 'delivered',
    ready_for_pickup: 'ready_for_pickup',
    picked_up: 'picked_up',
  };
  return map[hubStatus] || 'order_received';
}