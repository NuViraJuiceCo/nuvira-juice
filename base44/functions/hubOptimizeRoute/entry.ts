/**
 * hubOptimizeRoute
 * 
 * Thin proxy: forwards explicit Hub stops to the Hub's route optimizer.
 * NEVER reads from local Customer App Order or FulfillmentTask entities.
 * 
 * Payload: { stops: HubStop[], date: string }
 * Each stop must have: task_id, customer_name, delivery_address, etc. (from getHubDriverRoute)
 * 
 * Returns Hub optimizer response verbatim.
 * Customer App Driver Portal uses this instead of local optimizeDeliveryRoute.
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORIGIN = "619 N Main St Unit 3, O'Fallon, MO 63366";

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'driver' && user.role !== 'admin' && user.role !== 'operations') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { stops, date } = await req.json();

    if (!Array.isArray(stops) || stops.length === 0) {
      return Response.json({ error: 'stops array is required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Maps API key not configured' }, { status: 500 });
    }

    console.log(`[hubOptimizeRoute] Optimizing ${stops.length} Hub stops for date=${date}`);
    stops.forEach((s, i) => console.log(`  ${i + 1}. task_id=${s.task_id} customer=${s.customer_name} addr=${s.delivery_address}`));

    // Single stop — no optimization needed
    if (stops.length === 1) {
      const returnStop = {
        id: 'return_to_origin',
        order_number: 'RETURN',
        customer_name: 'Return to NuVira Base',
        delivery_address: ORIGIN,
        is_return_stop: true,
      };
      return Response.json({ optimized_orders: [...stops, returnStop], total_distance_miles: null, total_duration_minutes: null });
    }

    const withAddr = stops.filter(s => s.delivery_address);
    const withoutAddr = stops.filter(s => !s.delivery_address);

    if (withAddr.length < 2) {
      const returnStop = { id: 'return_to_origin', order_number: 'RETURN', customer_name: 'Return to NuVira Base', delivery_address: ORIGIN, is_return_stop: true };
      return Response.json({ optimized_orders: [...stops, returnStop], total_distance_miles: null, total_duration_minutes: null });
    }

    const routePayload = {
      origin: { address: ORIGIN },
      destination: { address: ORIGIN },
      intermediates: withAddr.map(s => ({ address: s.delivery_address })),
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

    if (!routeData.routes || routeData.routes.length === 0) {
      console.error('[hubOptimizeRoute] Google Maps API error:', JSON.stringify(routeData));
      // Fall back to original order
      const returnStop = { id: 'return_to_origin', order_number: 'RETURN', customer_name: 'Return to NuVira Base', delivery_address: ORIGIN, is_return_stop: true };
      return Response.json({ optimized_orders: [...stops, returnStop], total_distance_miles: null, total_duration_minutes: null });
    }

    const route = routeData.routes[0];
    const optimizedIndexes = route.optimizedIntermediateWaypointIndex || withAddr.map((_, i) => i);
    const legs = route.legs || [];

    const orderedStops = [
      ...optimizedIndexes.map((i, legIdx) => ({
        ...withAddr[i],
        leg_distance_meters: legs[legIdx + 1]?.distanceMeters || null,
        leg_duration_seconds: legs[legIdx + 1] ? parseInt(legs[legIdx + 1].duration?.replace('s', '') || '0') : null,
      })),
      ...withoutAddr,
    ];

    const returnStop = {
      id: 'return_to_origin',
      order_number: 'RETURN',
      customer_name: 'Return to NuVira Base',
      delivery_address: ORIGIN,
      is_return_stop: true,
    };

    const totalDistanceMeters = route.distanceMeters || 0;
    const totalDurationSeconds = route.duration ? parseInt(route.duration.replace('s', '')) : 0;

    console.log(`[hubOptimizeRoute] Optimized ${orderedStops.length} delivery stops:`);
    orderedStops.forEach((s, i) => console.log(`  ${i + 1}. task_id=${s.task_id} customer=${s.customer_name}`));

    return Response.json({
      optimized_orders: [...orderedStops, returnStop],
      total_distance_miles: Math.round((totalDistanceMeters / 1609.344) * 10) / 10,
      total_duration_minutes: Math.round(totalDurationSeconds / 60),
    });

  } catch (error) {
    console.error('[hubOptimizeRoute] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});