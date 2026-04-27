// Optimizes delivery route using Google Maps Routes API
// Origin/Destination: 619 N Main St Unit 3, O'Fallon, MO 63366

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORIGIN = '619 N Main St Unit 3, O\'Fallon, MO 63366';

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

    // Fetch all active delivery orders (local)
    const allLocalOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);

    const QUEUED_STATUSES = ['order_received', 'scheduled_for_juicing', 'in_production', 'bottled_packed', 'out_for_delivery', 'arriving_soon'];

    let localDelivery = allLocalOrders.filter(o => {
      const isDelivery = o.fulfillment_type === 'delivery';
      const isQueued = QUEUED_STATUSES.includes(o.status);
      const notSuperseded = !(o.notes && o.notes.includes('SUPERSEDED_BY_HUB'));
      return isDelivery && isQueued && o.delivery_address && notSuperseded;
    });

    // --- Pull Hub orders for the requested date ---
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    let hubOrders = [];

    if (hubApiUrl && hubSecret) {
      try {
        const hubBase = hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '');

        // Get all UserProfile emails to query Hub
        const profiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', 500);
        const hubEmails = new Set();
        const contactToAuth = {};
        for (const p of profiles) {
          const hubEmail = p.contact_email || p.customer_email;
          if (hubEmail) hubEmails.add(hubEmail);
          if (p.contact_email && p.customer_email !== p.contact_email) {
            contactToAuth[p.contact_email] = p.customer_email;
          }
        }

        const fetches = Array.from(hubEmails).map(async (hubEmail) => {
          try {
            const url = `${hubBase}/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(hubEmail)}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${hubSecret}` } });
            if (!res.ok) return [];
            const data = await res.json();
            const rawOrders = data.orders || [];
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
                  if (!addr) continue;
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
                if (!addr) continue;
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
          } catch { return []; }
        });

        const results = await Promise.all(fetches);
        hubOrders = results.flat();
        console.log(`[Route] Hub returned ${hubOrders.length} delivery orders`);
      } catch (err) {
        console.warn('[Route] Hub fetch failed:', err.message);
      }
    }

    // Merge: Hub wins for matching order_number
    const mergedMap = new Map();
    for (const o of hubOrders) { if (o.order_number) mergedMap.set(o.order_number, o); }
    for (const o of localDelivery) {
      if (!o.order_number) continue;
      if (!mergedMap.has(o.order_number)) mergedMap.set(o.order_number, o);
    }
    let deliveryOrders = Array.from(mergedMap.values());

    // Date filter — for Hub orders use estimated_delivery_date; for local use estimated_delivery_date or assigned_delivery_date
    if (date) {
      const dateFiltered = deliveryOrders.filter(o =>
        o.estimated_delivery_date === date || o.assigned_delivery_date === date
      );
      if (dateFiltered.length > 0) deliveryOrders = dateFiltered;
      else deliveryOrders = []; // strict: if date specified and no matches, return empty
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

    // Build waypoints for Routes API
    const waypoints = deliveryOrders.map(o => ({
      address: o.delivery_address,
    }));

    const routePayload = {
      origin: { address: ORIGIN },
      destination: { address: ORIGIN },
      intermediates: waypoints.map(w => ({ address: w.address })),
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
      // Return unoptimized on failure
      return Response.json({ optimized_orders: deliveryOrders, total_distance: null, total_duration: null });
    }

    const route = routeData.routes[0];
    const optimizedIndexes = route.optimizedIntermediateWaypointIndex || deliveryOrders.map((_, i) => i);

    // Reorder orders by optimized waypoint index
    const optimizedOrders = optimizedIndexes.map(i => deliveryOrders[i]);

    // Attach per-leg distance/duration
    const legs = route.legs || [];
    const ordersWithLegs = optimizedOrders.map((order, i) => {
      const leg = legs[i + 1] || legs[i]; // leg 0 = origin to first stop
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