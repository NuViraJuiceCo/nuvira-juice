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

    // Fetch all active delivery orders
    const orders = await base44.asServiceRole.entities.Order.list('-created_date', 500);

    // Queue = any delivery order that hasn't been delivered/picked up yet
    const QUEUED_STATUSES = ['order_received', 'scheduled_for_juicing', 'in_production', 'bottled_packed', 'out_for_delivery', 'arriving_soon'];

    let deliveryOrders = orders.filter(o => {
      const isDelivery = o.fulfillment_type === 'delivery';
      const isQueued = QUEUED_STATUSES.includes(o.status);
      return isDelivery && isQueued && o.delivery_address;
    });

    // If a date is provided, further filter by estimated_delivery_date
    if (date) {
      const dateFiltered = deliveryOrders.filter(o => o.estimated_delivery_date === date || o.assigned_delivery_date === date);
      // Only apply date filter if it actually matches some orders, otherwise show all queued
      if (dateFiltered.length > 0) deliveryOrders = dateFiltered;
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