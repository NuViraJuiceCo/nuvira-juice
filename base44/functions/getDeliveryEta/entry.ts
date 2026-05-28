// Returns a live ETA window for a customer's delivery
// Uses the current state of the route (delivered stops as real-time anchors)
// to calculate how far the driver is from the customer's stop RIGHT NOW.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORIGIN = "619 N Main St Unit 3, O'Fallon, MO 63366";

async function requireAuthenticatedUser(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) {
    return { response: Response.json({ error: 'unauthorized' }, { status: 401 }) };
  }
  return { user };
}

function authorizeOrderAccess(user, order) {
  const requester = String(user.email || '').trim().toLowerCase();
  const owner = String(order?.customer_email || '').trim().toLowerCase();
  if (user.role === 'admin' || user.role === 'driver' || requester === owner) {
    return null;
  }
  return Response.json({ error: 'forbidden' }, { status: 403 });
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { order_id } = body;

    if (!order_id) {
      return Response.json({ error: 'order_id required' }, { status: 400 });
    }

    const auth = await requireAuthenticatedUser(base44);
    if (auth.response) return auth.response;

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    const orders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
    const targetOrder = orders.find(o => o.id === order_id);

    if (!targetOrder) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }
    const unauthorized = authorizeOrderAccess(auth.user, targetOrder);
    if (unauthorized) return unauthorized;

    // Only show ETA when driver is actively delivering
    const ON_ROUTE_STATUSES = ['out_for_delivery', 'arriving_soon'];
    const isOnRoute = ON_ROUTE_STATUSES.includes(targetOrder.status) && targetOrder.fulfillment_type === 'delivery';

    if (!isOnRoute) {
      return Response.json({ eta: null, on_route: false });
    }

    // Get today's date
    const today = new Date().toISOString().slice(0, 10);
    const deliveryDate = targetOrder.estimated_delivery_date || targetOrder.assigned_delivery_date || today;

    // Build the full route — all stops that are part of today's run (active + delivered)
    const ROUTE_STATUSES = ['out_for_delivery', 'arriving_soon', 'delivered'];
    const routeOrders = orders.filter(o => {
      const isDelivery = o.fulfillment_type === 'delivery';
      const isRouteStatus = ROUTE_STATUSES.includes(o.status);
      const matchesDate = o.estimated_delivery_date === deliveryDate
        || o.assigned_delivery_date === deliveryDate
        || (!o.estimated_delivery_date && !o.assigned_delivery_date);
      return isDelivery && isRouteStatus && o.delivery_address && matchesDate;
    });

    if (routeOrders.length === 0 || !routeOrders.find(o => o.id === order_id)) {
      return Response.json({ eta: null, on_route: true, message: 'Your delivery is on its way today!' });
    }

    // Single stop — driver is coming directly
    if (routeOrders.length === 1 || !apiKey) {
      const now = new Date();
      const windowStart = new Date(now.getTime() + 10 * 60 * 1000);
      const windowEnd = new Date(now.getTime() + 40 * 60 * 1000);
      const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });
      return Response.json({
        on_route: true,
        eta_window: `${fmt(windowStart)} – ${fmt(windowEnd)}`,
        stops_ahead: 0,
        stops_remaining: 0,
        stops_total: 1,
        message: 'Your delivery is next!',
      });
    }

    // Call Routes API — use ONLY the remaining stops (not yet delivered) to get
    // accurate drive-time from the driver's current position (approximated as last delivered stop)
    const deliveredStops = routeOrders.filter(o => o.status === 'delivered');
    const remainingStops = routeOrders.filter(o => o.status !== 'delivered');

    // Origin for remaining route: if some stops delivered, use last delivered address as current driver position
    // Otherwise use depot
    let routeOrigin = ORIGIN;
    if (deliveredStops.length > 0) {
      // Sort delivered by updated_date desc to find most recently delivered
      const sorted = [...deliveredStops].sort((a, b) => new Date(b.updated_date) - new Date(a.updated_date));
      routeOrigin = sorted[0].delivery_address;
    }

    // Request route from driver's current position through remaining stops
    const routePayload = {
      origin: { address: routeOrigin },
      destination: { address: ORIGIN },
      intermediates: remainingStops.map(o => ({ address: o.delivery_address })),
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
      return Response.json({ on_route: true, eta: null, message: 'Your delivery is on its way!' });
    }

    const route = routeData.routes[0];
    const optimizedIndexes = route.optimizedIntermediateWaypointIndex || remainingStops.map((_, i) => i);
    const legs = route.legs || [];

    // Build ordered remaining stops with cumulative drive times from NOW
    let cumulative = 0;
    const orderedRemaining = optimizedIndexes.map((originalIdx, stopIdx) => {
      const order = remainingStops[originalIdx];
      // leg[0] = origin→first stop, leg[1] = first→second, etc.
      const leg = legs[stopIdx] || null;
      const legSeconds = leg ? parseInt(leg.duration?.replace('s', '') || '0') : 0;
      cumulative += legSeconds;
      return { order, stopIdx, cumulativeSeconds: cumulative, legSeconds };
    });

    const targetStop = orderedRemaining.find(s => s.order.id === order_id);

    if (!targetStop) {
      return Response.json({ on_route: true, eta: null, message: 'Your delivery is on its way!' });
    }

    const stopsAhead = orderedRemaining.filter(s => s.stopIdx < targetStop.stopIdx).length;
    const stopsRemaining = orderedRemaining.length;

    // Add a realistic dwell time per stop (2.5 min avg for handoff)
    const DWELL_PER_STOP_SECONDS = 150;
    const totalSecondsToArrival = targetStop.cumulativeSeconds + (stopsAhead * DWELL_PER_STOP_SECONDS);

    const now = new Date();
    const estimatedArrival = new Date(now.getTime() + totalSecondsToArrival * 1000);

    // ±20 min window
    const windowStart = new Date(estimatedArrival.getTime() - 20 * 60 * 1000);
    const windowEnd = new Date(estimatedArrival.getTime() + 20 * 60 * 1000);

    const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' });

    const message = stopsAhead === 0
      ? 'Your delivery is next!'
      : `${stopsAhead} stop${stopsAhead > 1 ? 's' : ''} ahead of yours`;

    return Response.json({
      on_route: true,
      eta_window: `${fmt(windowStart)} – ${fmt(windowEnd)}`,
      eta_start: windowStart.toISOString(),
      eta_end: windowEnd.toISOString(),
      stops_ahead: stopsAhead,
      stops_remaining: stopsRemaining,
      stops_total: routeOrders.length,
      stops_delivered: deliveredStops.length,
      message,
    });

  } catch (error) {
    console.error('getDeliveryEta error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
