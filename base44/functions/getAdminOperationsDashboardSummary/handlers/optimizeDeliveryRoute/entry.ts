// @ts-nocheck
/**
 * Customer App native route preview.
 *
 * The caller supplies the already-authorized native delivery manifest returned by
 * getAdminDeliveryRouteSummary. This handler never reads Hub data, persists route
 * order, mutates fulfillment state, or notifies customers.
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORIGIN = '619 N Main St Unit 3, O\'Fallon, MO 63366';
const MAX_STOPS = 100;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function safeText(value, maxLength = 160) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeRouteStop(stop) {
  return {
    task_id: safeText(stop?.task_id, 120) || null,
    order_number: safeText(stop?.order_number, 120) || null,
    fulfillment_number: stop?.fulfillment_number ?? null,
    customer_name: safeText(stop?.customer_name, 120) || null,
    delivery_address: safeText(stop?.delivery_address, 240) || null,
    delivery_window_label: safeText(stop?.delivery_window_label, 120) || null,
    items_summary: safeText(stop?.items_summary, 240) || null,
    assigned_driver: safeText(stop?.assigned_driver, 120) || null,
    task_status: safeText(stop?.task_status, 80) || null,
    delivery_status: safeText(stop?.delivery_status, 80) || null,
    source_type: safeText(stop?.source_type, 80) || null,
    missing_address: stop?.missing_address === true,
    is_return_stop: stop?.is_return_stop === true,
    leg_distance_meters: safeNumber(stop?.leg_distance_meters),
    leg_duration_seconds: safeNumber(stop?.leg_duration_seconds),
  };
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

function staticManifest(stops, message) {
  return Response.json({
    success: true,
    skipped: true,
    orders: stops,
    optimized_orders: null,
    static_route_available: stops.length > 0,
    customer_delivery_count: stops.filter(stop => !stop.is_return_stop).length,
    total_distance_miles: null,
    total_duration_minutes: null,
    source_mode: 'customer_app_native_manifest',
    hub_operational_dependency: false,
    writes_performed: false,
    provider_calls_performed: false,
    message,
  });
}

export default async function handler(req: Request) {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || (user.role !== 'driver' && user.role !== 'admin')) {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body)
      ? parsedBody.body
      : {};
    const explicitStops = Array.isArray(body.stops)
      ? body.stops.slice(0, MAX_STOPS).map(sanitizeRouteStop)
      : [];

    if (explicitStops.length === 0) {
      return Response.json({
        success: false,
        error: 'Customer App delivery stops are required for route preview',
        error_code: 'native_delivery_stops_required',
        hub_operational_dependency: false,
        writes_performed: false,
      }, { status: 400 });
    }

    if (body.optimize !== true) {
      return staticManifest(explicitStops, 'Customer App delivery manifest returned without route optimization.');
    }

    if (Deno.env.get('ENABLE_DELIVERY_ROUTE_OPTIMIZATION') !== 'true') {
      return staticManifest(explicitStops, 'Route optimization is disabled. The Customer App delivery manifest remains available.');
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({
        success: false,
        error: 'Route optimization is temporarily unavailable',
        error_code: 'route_provider_not_configured',
        orders: explicitStops,
        hub_operational_dependency: false,
        writes_performed: false,
      }, { status: 503 });
    }

    const addressable = explicitStops.filter(stop => stop.delivery_address && !stop.missing_address);
    const missingAddress = explicitStops.filter(stop => !stop.delivery_address || stop.missing_address);
    if (addressable.length < 2) {
      return staticManifest(explicitStops, 'At least two addressable Customer App stops are required for route optimization.');
    }

    const routeRes = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.optimizedIntermediateWaypointIndex,routes.distanceMeters,routes.duration,routes.legs',
      },
      body: JSON.stringify({
        origin: { address: ORIGIN },
        destination: { address: ORIGIN },
        intermediates: addressable.map(stop => ({ address: stop.delivery_address })),
        travelMode: 'DRIVE',
        optimizeWaypointOrder: true,
        routingPreference: 'TRAFFIC_AWARE',
      }),
    });

    if (!routeRes.ok) {
      return staticManifest(explicitStops, 'The route provider was unavailable. The Customer App delivery manifest remains available.');
    }

    const routeData = await routeRes.json().catch(() => null);
    const route = routeData?.routes?.[0];
    if (!route) {
      return staticManifest(explicitStops, 'No optimized route was returned. The Customer App delivery manifest remains available.');
    }

    const optimizedIndexes = Array.isArray(route.optimizedIntermediateWaypointIndex)
      ? route.optimizedIntermediateWaypointIndex
      : addressable.map((_, index) => index);
    const legs = Array.isArray(route.legs) ? route.legs : [];
    const orderedStops = optimizedIndexes
      .filter(index => Number.isInteger(index) && addressable[index])
      .map((index, legIndex) => ({
        ...addressable[index],
        leg_distance_meters: safeNumber(legs[legIndex]?.distanceMeters),
        leg_duration_seconds: legs[legIndex]?.duration
          ? safeNumber(parseInt(String(legs[legIndex].duration).replace('s', ''), 10))
          : null,
      }));
    const returnStop = sanitizeRouteStop({
      order_number: 'RETURN',
      customer_name: 'Return to NuVira Base',
      delivery_address: ORIGIN,
      is_return_stop: true,
    });
    const totalDistanceMeters = safeNumber(route.distanceMeters) || 0;
    const totalDurationSeconds = route.duration
      ? safeNumber(parseInt(String(route.duration).replace('s', ''), 10)) || 0
      : 0;

    return Response.json({
      success: true,
      orders: explicitStops,
      optimized_orders: [...orderedStops, ...missingAddress, returnStop].map(sanitizeRouteStop),
      total_distance_miles: Math.round((totalDistanceMeters / 1609.344) * 10) / 10,
      total_duration_minutes: Math.round(totalDurationSeconds / 60),
      customer_delivery_count: orderedStops.length + missingAddress.length,
      source_mode: 'customer_app_native_manifest',
      hub_operational_dependency: false,
      writes_performed: false,
      provider_calls_performed: true,
    });
  } catch (error) {
    console.error('[optimizeDeliveryRoute] failed safely:', safeText(error?.message, 180) || 'unknown_error');
    return Response.json({
      success: false,
      error: 'Unable to preview the delivery route',
      error_code: 'route_preview_failed',
      hub_operational_dependency: false,
      writes_performed: false,
    }, { status: 500 });
  }
}
