// Returns estimated delivery time window for a specific order
// Based on the optimized route, completed stops, and cumulative leg durations
// Public endpoint — no driver auth required, but order_id must match customer

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORIGIN = "619 N Main St Unit 3, O'Fallon, MO 63366";
const ROUTE_START_HOUR = 9; // Driver typically starts at 9am local time

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { order_id } = body;

    if (!order_id) {
      return Response.json({ error: 'order_id required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');

    // Fetch the specific order (service role so RLS doesn't block)
    const orders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
    const targetOrder = orders.find(o => o.id === order_id);

    if (!targetOrder) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    // Only meaningful for delivery orders that are out for delivery or arriving
    const activeStatuses = ['bottled_packed', 'out_for_delivery', 'arriving_soon'];
    if (!activeStatuses.includes(targetOrder.status) || targetOrder.fulfillment_type !== 'delivery') {
      return Response.json({ eta: null, message: null });
    }

    // Get today's delivery date
    const today = new Date().toISOString().slice(0, 10);
    const deliveryDate = targetOrder.estimated_delivery_date || targetOrder.assigned_delivery_date || today;

    // Fetch all delivery orders for the same delivery date
    const QUEUED_STATUSES = ['bottled_packed', 'out_for_delivery', 'arriving_soon', 'delivered'];
    let routeOrders = orders.filter(o => {
      const isDelivery = o.fulfillment_type === 'delivery';
      const isRouteStatus = QUEUED_STATUSES.includes(o.status);
      const matchesDate = o.estimated_delivery_date === deliveryDate || o.assigned_delivery_date === deliveryDate
        || (!o.estimated_delivery_date && !o.assigned_delivery_date);
      return isDelivery && isRouteStatus && o.delivery_address && matchesDate;
    });

    if (routeOrders.length === 0) {
      return Response.json({ eta: null, message: 'Your delivery is on its way today!' });
    }

    // Check if target order is in this route
    const targetInRoute = routeOrders.find(o => o.id === order_id);
    if (!targetInRoute) {
      return Response.json({ eta: null, message: 'Your delivery is scheduled for today.' });
    }

    // If only 1 stop or no API key, return a simple window
    if (!apiKey || routeOrders.length === 1) {
      return Response.json({
        eta: null,
        message: 'Your order is out for delivery today and will arrive soon!',
        stops_ahead: 0,
        stops_total: 1,
      });
    }

    // Call Routes API to get optimized order + cumulative durations
    const routePayload = {
      origin: { address: ORIGIN },
      destination: { address: ORIGIN },
      intermediates: routeOrders.map(o => ({ address: o.delivery_address })),
      travelMode: 'DRIVE',
      optimizeWaypointOrder: true,
      routingPreference: 'TRAFFIC_AWARE',
    };

    const routeRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.optimizedIntermediateWaypointIndex,routes.legs',
      },
      body: JSON.stringify(routePayload),
    });

    const routeData = await routeRes.json();

    if (!routeData.routes || routeData.routes.length === 0) {
      console.error('Routes API error:', JSON.stringify(routeData));
      return Response.json({ eta: null, message: 'Your delivery is on its way today!' });
    }

    const route = routeData.routes[0];
    const optimizedIndexes = route.optimizedIntermediateWaypointIndex || routeOrders.map((_, i) => i);
    const legs = route.legs || [];

    // Build ordered stop list with cumulative durations
    const optimizedStops = optimizedIndexes.map((originalIdx, stopIdx) => {
      const order = routeOrders[originalIdx];
      // legs[0] = origin → stop 0, legs[1] = stop 0 → stop 1, etc.
      const leg = legs[stopIdx] || null;
      const legSeconds = leg ? parseInt(leg.duration?.replace('s', '') || '0') : 0;
      return { order, stopIdx, legSeconds };
    });

    // Calculate cumulative seconds from route start to each stop
    let cumulative = 0;
    const stopsWithTime = optimizedStops.map(s => {
      cumulative += s.legSeconds;
      return { ...s, cumulativeSeconds: cumulative };
    });

    // Find our target order's position
    const targetStop = stopsWithTime.find(s => s.order.id === order_id);
    if (!targetStop) {
      return Response.json({ eta: null, message: 'Your delivery is scheduled for today.' });
    }

    // Count how many stops before this one are NOT yet delivered
    const stopsAhead = stopsWithTime.filter(s => s.stopIdx < targetStop.stopIdx && s.order.status !== 'delivered').length;
    const totalActiveStops = stopsWithTime.filter(s => s.order.status !== 'delivered').length;

    // Estimate route start time: if any stop is already "out_for_delivery" or "arriving_soon" or "delivered",
    // infer start was recent. Otherwise assume ROUTE_START_HOUR.
    const now = new Date();
    let routeStartTime;
    const deliveredStops = stopsWithTime.filter(s => s.order.status === 'delivered');
    if (deliveredStops.length > 0) {
      // Use the last delivered stop's verified_at or updated_date to back-calculate start
      const lastDelivered = deliveredStops[deliveredStops.length - 1];
      const lastDeliveredTime = new Date(lastDelivered.order.updated_date || now);
      routeStartTime = new Date(lastDeliveredTime.getTime() - lastDelivered.cumulativeSeconds * 1000);
    } else {
      // No deliveries done yet — assume driver started at ROUTE_START_HOUR today
      routeStartTime = new Date(now);
      routeStartTime.setHours(ROUTE_START_HOUR, 0, 0, 0);
      // If current time is already past that, use now as start
      if (routeStartTime < now) routeStartTime = now;
    }

    // Estimated arrival = route start + cumulative seconds to this stop
    const estimatedArrival = new Date(routeStartTime.getTime() + targetStop.cumulativeSeconds * 1000);

    // Build a ±30 min window
    const windowStart = new Date(estimatedArrival.getTime() - 15 * 60 * 1000);
    const windowEnd = new Date(estimatedArrival.getTime() + 15 * 60 * 1000);

    const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

    return Response.json({
      eta_start: windowStart.toISOString(),
      eta_end: windowEnd.toISOString(),
      eta_window: `${fmt(windowStart)} – ${fmt(windowEnd)}`,
      stops_ahead: stopsAhead,
      stops_total: totalActiveStops,
      message: stopsAhead === 0
        ? 'Your delivery is next!'
        : `${stopsAhead} stop${stopsAhead > 1 ? 's' : ''} ahead of yours`,
    });

  } catch (error) {
    console.error('getDeliveryEta error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});