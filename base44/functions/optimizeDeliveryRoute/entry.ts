// Optimizes delivery route using Google Maps Routes API
// Origin/Destination: 619 N Main St Unit 3, O'Fallon, MO 63366
// Hub orders are fetched by reusing the same logic as getAdminOrdersWithHub

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORIGIN = '619 N Main St Unit 3, O\'Fallon, MO 63366';

const QUEUED_STATUSES = ['order_received', 'scheduled_for_juicing', 'in_production', 'bottled_packed', 'out_for_delivery', 'arriving_soon'];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || (user.role !== 'driver' && user.role !== 'admin')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { date, optimize } = body; // date: YYYY-MM-DD, optimize: boolean

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Maps API key not configured' }, { status: 500 });
    }

    // ── 1. Local orders ──────────────────────────────────────────────────────
    const allLocalOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
    const localDelivery = allLocalOrders.filter(o =>
      o.fulfillment_type === 'delivery' &&
      QUEUED_STATUSES.includes(o.status) &&
      !(o.notes && o.notes.includes('SUPERSEDED_BY_HUB'))
    );
    console.log(`[Route] Local delivery orders: ${localDelivery.length}`);

    // ── 2. Hub orders (same approach as getAdminOrdersWithHub) ───────────────
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    let hubOrders = [];

    if (hubApiUrl && hubSecret) {
      const hubBase = hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '');

      // Build email set from all UserProfiles
      const profiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', 500);
      const contactToAuth = {};
      const hubEmails = new Set();
      for (const p of profiles) {
        const hubEmail = p.contact_email || p.customer_email;
        if (hubEmail) hubEmails.add(hubEmail);
        if (p.contact_email && p.customer_email !== p.contact_email) {
          contactToAuth[p.contact_email] = p.customer_email;
        }
      }
      // Also add emails from local orders not in profiles
      for (const o of localDelivery) {
        if (o.customer_email) hubEmails.add(o.customer_email);
      }

      console.log(`[Route] Querying Hub for ${hubEmails.size} emails`);

      const fetches = Array.from(hubEmails).map(async (hubEmail) => {
        try {
          const url = `${hubBase}/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(hubEmail)}`;
          const res = await fetch(url, { headers: { 'Authorization': `Bearer ${hubSecret}` } });
          if (!res.ok) {
            console.warn(`[Route] Hub ${hubEmail}: ${res.status} ${await res.text()}`);
            return [];
          }
          const data = await res.json();
          const rawOrders = data.orders || [];
          if (rawOrders.length > 0) {
            console.log(`[Route] Hub ${hubEmail}: ${rawOrders.length} orders`);
          }
          const authEmail = contactToAuth[hubEmail] || hubEmail;
          const expanded = [];

          for (const order of rawOrders) {
            const fulfillments = order.fulfillments;
            if (Array.isArray(fulfillments) && fulfillments.length > 0) {
              for (const f of fulfillments) {
                const mappedStatus = mapHubStatus(f.status || order.status);
                if (!QUEUED_STATUSES.includes(mappedStatus)) continue;
                if (order.fulfillment_type === 'pickup') continue;
                const addr = order.delivery_address || '';
                // Include even if no address — driver still needs to see the order
                const baseNum = (order.shopify_order_number || order.order_number || '').replace('#', '');
                expanded.push({
                  id: `hub_${order.id || order.shopify_order_id}_f${f.fulfillment_number}`,
                  hub_order_id: order.id || order.shopify_order_id || null,
                  hub_fulfillment_number: f.fulfillment_number,
                  order_number: f.fulfillment_number === 1 ? baseNum : `${baseNum}-${f.fulfillment_number}`,
                  customer_email: authEmail,
                  hub_customer_email: order.customer_email || hubEmail,
                  status: mappedStatus,
                  total: order.total ? parseFloat((order.total / fulfillments.length).toFixed(2)) : 0,
                  fulfillment_type: 'delivery',
                  delivery_address: addr,
                  contact_phone: order.contact_phone || '',
                  estimated_delivery_date: f.delivery_date || null,
                  items: f.items || order.line_items || [],
                  notes: `${order.subscription_plan || 'Subscription'} — Delivery ${f.fulfillment_number} of ${fulfillments.length}`,
                  is_hub_order: true,
                });
              }
            } else {
              const mappedStatus = mapHubStatus(order.status);
              if (!QUEUED_STATUSES.includes(mappedStatus)) continue;
              if (order.fulfillment_type === 'pickup') continue;
              const addr = order.delivery_address || '';
              // Include even if no address — driver still needs to see the order
              expanded.push({
                id: `hub_${order.id}`,
                hub_order_id: order.id || order.shopify_order_id || null,
                order_number: (order.shopify_order_number || order.order_number || '').replace('#', ''),
                customer_email: authEmail,
                hub_customer_email: order.customer_email || hubEmail,
                status: mappedStatus,
                total: order.total || 0,
                fulfillment_type: 'delivery',
                delivery_address: addr,
                contact_phone: order.contact_phone || '',
                estimated_delivery_date: order.estimated_delivery_date || null,
                items: order.line_items || order.items || [],
                notes: order.notes || null,
                is_hub_order: true,
              });
            }
          }
          return expanded;
        } catch (err) {
          console.warn(`[Route] Hub fetch error for ${hubEmail}: ${err.message}`);
          return [];
        }
      });

      const results = await Promise.all(fetches);
      hubOrders = results.flat();
      console.log(`[Route] Hub total delivery orders after expansion: ${hubOrders.length}`);
    } else {
      console.warn('[Route] HUB_API_URL or CUSTOMER_APP_SYNC_SECRET not set — skipping Hub fetch');
    }

    // ── 3. Merge: Hub wins for status/items, but local fills in missing address/phone ─────────────────────────
    const localByOrderNumber = new Map();
    for (const o of localDelivery) { if (o.order_number) localByOrderNumber.set(o.order_number, o); }

    const mergedMap = new Map();
    for (const o of hubOrders) {
      if (!o.order_number) continue;
      const local = localByOrderNumber.get(o.order_number);
      // Patch missing address/phone from local order if Hub doesn't have them
      mergedMap.set(o.order_number, {
        ...o,
        delivery_address: o.delivery_address || local?.delivery_address || '',
        contact_phone: o.contact_phone || local?.contact_phone || '',
      });
    }
    for (const o of localDelivery) {
      if (!o.order_number) continue;
      if (!mergedMap.has(o.order_number)) mergedMap.set(o.order_number, o);
    }
    let deliveryOrders = Array.from(mergedMap.values());
    console.log(`[Route] Merged total: ${deliveryOrders.length} orders`);

    // ── 4. Date filter ───────────────────────────────────────────────────────
    if (date) {
      deliveryOrders = deliveryOrders.filter(o =>
        o.estimated_delivery_date === date || o.assigned_delivery_date === date
      );
      console.log(`[Route] After date filter (${date}): ${deliveryOrders.length} orders`);
    }

    if (deliveryOrders.length === 0) {
      return Response.json({ orders: [], optimized_orders: null });
    }

    // If not optimizing, just return the raw queued orders
    if (!optimize) {
      return Response.json({ orders: deliveryOrders, optimized_orders: null });
    }

    if (deliveryOrders.length === 1) {
      return Response.json({ orders: deliveryOrders, optimized_orders: deliveryOrders, total_distance_miles: null, total_duration_minutes: null });
    }

    // ── 5. Route optimization via Google Maps Routes API ────────────────────
    // Only include orders with a delivery address for route optimization
    const ordersWithAddress = deliveryOrders.filter(o => o.delivery_address);
    const ordersWithoutAddress = deliveryOrders.filter(o => !o.delivery_address);
    if (ordersWithoutAddress.length > 0) {
      console.warn(`[Route] ${ordersWithoutAddress.length} orders have no delivery address — they will appear at the end of the route`);
    }
    if (ordersWithAddress.length === 0) {
      return Response.json({ orders: deliveryOrders, optimized_orders: deliveryOrders, total_distance_miles: null, total_duration_minutes: null });
    }
    if (ordersWithAddress.length === 1) {
      return Response.json({ orders: deliveryOrders, optimized_orders: [...ordersWithAddress, ...ordersWithoutAddress], total_distance_miles: null, total_duration_minutes: null });
    }
    const routePayload = {
      origin: { address: ORIGIN },
      destination: { address: ORIGIN },
      intermediates: ordersWithAddress.map(o => ({ address: o.delivery_address })),
      travelMode: 'DRIVE',
      optimizeWaypointOrder: true,
      routingPreference: 'TRAFFIC_AWARE',
    };

    const routeRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration,routes.legs',
      },
      body: JSON.stringify(routePayload),
    });

    const routeData = await routeRes.json();
    console.log('Routes API response status:', routeRes.status);

    if (!routeData.routes || routeData.routes.length === 0) {
      console.error('Routes API error:', JSON.stringify(routeData));
      return Response.json({ orders: deliveryOrders, optimized_orders: deliveryOrders, total_distance_miles: null, total_duration_minutes: null });
    }

    const route = routeData.routes[0];
    const optimizedIndexes = route.optimizedIntermediateWaypointIndex || ordersWithAddress.map((_, i) => i);
    // Reorder the addressable orders, then append any without addresses at the end
    const optimizedOrders = [...optimizedIndexes.map(i => ordersWithAddress[i]), ...ordersWithoutAddress];

    const legs = route.legs || [];
    const ordersWithLegs = optimizedOrders.map((order, i) => {
      const leg = legs[i + 1] || legs[i];
      return {
        ...order,
        leg_distance_meters: leg?.distanceMeters || null,
        leg_duration_seconds: leg ? parseInt(leg.duration?.replace('s', '') || '0') : null,
      };
    });

    const totalDistanceMeters = route.distanceMeters || 0;
    const totalDurationSeconds = route.duration ? parseInt(route.duration.replace('s', '')) : 0;

    return Response.json({
      orders: deliveryOrders,
      optimized_orders: ordersWithLegs,
      total_distance_miles: Math.round((totalDistanceMeters / 1609.344) * 10) / 10,
      total_duration_minutes: Math.round(totalDurationSeconds / 60),
    });

  } catch (error) {
    console.error('optimizeDeliveryRoute error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function mapHubStatus(hubStatus) {
  const map = {
    new: 'order_received', awaiting_production: 'scheduled_for_juicing',
    in_production: 'in_production', bottled: 'bottled_packed', labeled: 'bottled_packed',
    qc_checked: 'bottled_packed', packed: 'bottled_packed', in_cold_storage: 'bottled_packed',
    assigned_for_pickup: 'ready_for_pickup', assigned_for_delivery: 'out_for_delivery',
    fulfilled: 'delivered', pending: 'scheduled_for_juicing', production_scheduled: 'scheduled_for_juicing',
    order_received: 'order_received', scheduled_for_juicing: 'scheduled_for_juicing',
    bottled_packed: 'bottled_packed', out_for_delivery: 'out_for_delivery',
    arriving_soon: 'arriving_soon', delivered: 'delivered',
    ready_for_pickup: 'ready_for_pickup', picked_up: 'picked_up',
  };
  return map[hubStatus] || 'order_received';
}