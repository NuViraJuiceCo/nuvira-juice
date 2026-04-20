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
    const { date } = body; // YYYY-MM-DD

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Maps API key not configured' }, { status: 500 });
    }

    // Fetch orders for the given date that are out for delivery
    const orders = await base44.asServiceRole.entities.Order.list('-created_date', 200);
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const deliveryOrders = orders.filter(o => {
      const isDelivery = o.fulfillment_type === 'delivery';
      const isActive = ['bottled_packed', 'out_for_delivery', 'arriving_soon'].includes(o.status);
      const matchesDate = o.estimated_delivery_date === targetDate ||
        (!o.estimated_delivery_date && o.created_date?.startsWith(targetDate));
      return isDelivery && isActive && o.delivery_address;
    });

    if (deliveryOrders.length === 0) {
      return Response.json({ optimized_orders: [], total_distance: 0, total_duration: 0 });
    }

    if (deliveryOrders.length === 1) {
      return Response.json({ optimized_orders: deliveryOrders, total_distance: null, total_duration: null });
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
      optimized_orders: ordersWithLegs,
      total_distance_miles: Math.round((totalDistanceMeters / 1609.344) * 10) / 10,
      total_duration_minutes: Math.round(totalDurationSeconds / 60),
    });

  } catch (error) {
    console.error('optimizeDeliveryRoute error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});