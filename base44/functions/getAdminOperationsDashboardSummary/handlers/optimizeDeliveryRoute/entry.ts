// @ts-nocheck
/**
 * 🏛️ ACTIVE ARCHITECTURE FUNCTION — Option B (Read-Only Hub Expansion)
 * 
 * Optimizes delivery route using Google Maps Routes API
 * Origin/Destination: 619 N Main St Unit 3, O'Fallon, MO 63366
 * 
 * PROCESS:
 * 1. Fetch local delivery orders (queued status, non-superseded)
 * 2. Expand local subscription orders via FulfillmentTask
 * 3. Fetch Hub delivery orders for all customers (same expansion logic)
 * 4. Merge: Hub wins on order_number; local fills missing address/phone
 * 5. Filter by date (if specified)
 * 6. Call Google Maps Routes API for optimization (if requested)
 * 7. Return ordered stops with distance/duration metadata
 * 
 * FULFILLMENT EXPANSION: Subscription orders become individual stops per fulfillment.
 * Example: Monthly subscription with 4 fulfillments → 4 separate delivery stops.
 * 
 * Called by: pages/driver/DriverPortal (route planning and optimization)
 */

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ORIGIN = '619 N Main St Unit 3, O\'Fallon, MO 63366';

const QUEUED_STATUSES = ['order_received', 'scheduled_for_juicing', 'in_production', 'bottled_packed', 'out_for_delivery', 'arriving_soon'];

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
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return { ok: true, body: {} };
  }

  const raw = await req.text();
  if (!raw.trim()) {
    return { ok: true, body: {} };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

export default async function handler(req: Request) {
  try {
    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }
    const body = parsedBody.body && typeof parsedBody.body === 'object' && !Array.isArray(parsedBody.body) ? parsedBody.body : {};
    const { date, optimize, stops: explicitStops } = body; // stops: pre-filtered Hub stops from frontend

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || (user.role !== 'driver' && user.role !== 'admin')) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (Deno.env.get('ENABLE_DELIVERY_ROUTE_OPTIMIZATION') !== 'true') {
      const safeExplicitStops = Array.isArray(explicitStops)
        ? explicitStops.slice(0, 100).map(sanitizeRouteStop)
        : [];

      return Response.json({
        success: true,
        skipped: true,
        orders: safeExplicitStops,
        optimized_orders: null,
        static_route_available: safeExplicitStops.length > 0,
        reason: 'delivery_route_optimization_disabled',
        message: safeExplicitStops.length > 0
          ? 'Delivery route optimization is disabled. Static route manifest returned without calling Google Maps.'
          : 'Delivery route optimization is disabled. Enable the route optimization gate to calculate an admin route preview.',
      });
    }

    const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      return Response.json({ error: 'Google Maps API key not configured' }, { status: 500 });
    }

    // ── FAST PATH: explicit Hub stops provided by frontend ───────────────────
    // When the Driver Portal passes `stops`, use ONLY those stops.
    // Never re-fetch from local Customer App DB — that would leak stale/cancelled orders.
    if (Array.isArray(explicitStops) && explicitStops.length > 0) {
      const safeExplicitStops = explicitStops.slice(0, 100).map(sanitizeRouteStop);
      console.log(`[Route] Using ${safeExplicitStops.length} explicit Hub stops — skipping local DB fetch`);

      if (!optimize) {
        return Response.json({ success: true, orders: safeExplicitStops, optimized_orders: null });
      }
      if (safeExplicitStops.length === 1) {
        return Response.json({ success: true, orders: safeExplicitStops, optimized_orders: safeExplicitStops, total_distance_miles: null, total_duration_minutes: null });
      }

      const withAddr = safeExplicitStops.filter(s => s.delivery_address);
      const withoutAddr = safeExplicitStops.filter(s => !s.delivery_address);

      if (withAddr.length < 2) {
        return Response.json({ success: true, orders: safeExplicitStops, optimized_orders: safeExplicitStops, total_distance_miles: null, total_duration_minutes: null });
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
        console.error('[Route] Google Maps API returned no explicit-stop route');
        // Fall back to original order on Maps API failure
        return Response.json({ success: true, orders: safeExplicitStops, optimized_orders: safeExplicitStops, total_distance_miles: null, total_duration_minutes: null });
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

      console.log(`[Route] Explicit stops optimized: ${orderedStops.length} delivery stops`);
      orderedStops.forEach((s, i) => console.log(`  ${i + 1}. task_id=${s.task_id || 'missing'} order=${s.order_number || 'missing'}`));

      return Response.json({
        success: true,
        orders: safeExplicitStops,
        optimized_orders: [...orderedStops, returnStop].map(sanitizeRouteStop),
        total_distance_miles: Math.round((totalDistanceMeters / 1609.344) * 10) / 10,
        total_duration_minutes: Math.round(totalDurationSeconds / 60),
        customer_delivery_count: orderedStops.length,
      });
    }

    if (Deno.env.get('ENABLE_DELIVERY_ROUTE_LEGACY_FETCH') !== 'true') {
      return Response.json({
        success: false,
        error: 'Explicit delivery stops are required for route optimization',
        error_code: 'explicit_stops_required',
      }, { status: 400 });
    }

    // ── LEGACY PATH: no explicit stops — fetch from local DB (kept for non-driver callers) ──
    // ── 1. Local orders ──────────────────────────────────────────────────────
    const allLocalOrders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
    
    // Fetch FulfillmentTasks for expanding local subscription orders
    let fulfillmentTasks = [];
    try {
      fulfillmentTasks = await base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 500);
    } catch (err) {
      // FulfillmentTask may not exist yet — skip expansion
      console.warn('[Route] FulfillmentTask not available, skipping expansion:', err.message);
    }
    
    // Filter + expand local orders: subscriptions become individual fulfillments, others stay as-is
    let localDelivery = [];
    for (const o of allLocalOrders) {
      if (o.fulfillment_type !== 'delivery' || !QUEUED_STATUSES.includes(o.status) || (o.notes && o.notes.includes('SUPERSEDED_BY_HUB'))) {
        continue;
      }
      
      const tasksForOrder = fulfillmentTasks.length > 0 ? fulfillmentTasks.filter(t => t.order_id === o.id) : [];
      if (tasksForOrder.length > 0) {
        // Subscription: expand each fulfillment task
        for (const task of tasksForOrder) {
          localDelivery.push({
            id: task.id,
            order_number: o.order_number + (tasksForOrder.length > 1 ? `-${task.fulfillment_number || 1}` : ''),
            customer_email: o.customer_email,
            customer_name: o.customer_name || '',
            status: o.status,
            fulfillment_type: 'delivery',
            delivery_address: o.delivery_address || '',
            contact_phone: o.contact_phone || '',
            estimated_delivery_date: task.delivery_date || o.estimated_delivery_date,
            items: task.items || o.items || [],
            notes: o.notes || '',
            is_local_fulfillment_expansion: true,
          });
        }
      } else {
        // Regular order: use as-is
        localDelivery.push(o);
      }
    }
    console.log(`[Route] Local delivery orders (after expansion): ${localDelivery.length}`);

    // ── 2. Hub orders (same approach as getAdminOrdersWithHub) ───────────────
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    let hubOrders = [];

    if (hubApiUrl && hubSecret) {
      const hubBase = hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '');

      // Build email set from all UserProfiles + name/phone/address lookup maps
      const profiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', 500);
      const contactToAuth = {};
      const emailToName = {};
      const emailToPhone = {};
      const emailToAddress = {};
      const hubEmails = new Set();
      for (const p of profiles) {
        const hubEmail = p.contact_email || p.customer_email;
        if (hubEmail) hubEmails.add(hubEmail);
        if (p.contact_email && p.customer_email !== p.contact_email) {
          contactToAuth[p.contact_email] = p.customer_email;
        }
        const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
        const authKey = (p.customer_email || '').toLowerCase();
        const contactKey = (p.contact_email || '').toLowerCase();
        if (name) { emailToName[authKey] = name; if (contactKey) emailToName[contactKey] = name; }
        if (p.phone) { emailToPhone[authKey] = p.phone; if (contactKey) emailToPhone[contactKey] = p.phone; }
        if (p.address) { emailToAddress[authKey] = p.address; if (contactKey) emailToAddress[contactKey] = p.address; }
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
          const authKey = authEmail.toLowerCase();
          const expanded = [];

          for (const order of rawOrders) {
            const hubName = order.customer_name || order.full_name || '';
            const resolvedName = hubName || emailToName[authKey] || emailToName[hubEmail.toLowerCase()] || '';
            const resolvedPhone = order.contact_phone || order.phone || emailToPhone[authKey] || emailToPhone[hubEmail.toLowerCase()] || '';
            const resolvedAddress = order.delivery_address || emailToAddress[authKey] || emailToAddress[hubEmail.toLowerCase()] || '';

            const fulfillments = order.fulfillments;
            if (Array.isArray(fulfillments) && fulfillments.length > 0) {
              for (const f of fulfillments) {
                const mappedStatus = mapHubStatus(f.status || order.status);
                if (!QUEUED_STATUSES.includes(mappedStatus)) continue;
                if (order.fulfillment_type === 'pickup') continue;
                const fAddress = f.delivery_address || resolvedAddress;
                const fPhone = f.contact_phone || resolvedPhone;
                const baseNum = (order.shopify_order_number || order.order_number || '').replace('#', '');
                expanded.push({
                    id: `hub_${order.id || order.shopify_order_id}_f${f.fulfillment_number}`,
                    task_id: f.id || f.fulfillment_task_id || `hub_${order.id}_f${f.fulfillment_number}`, // Hub FulfillmentTask.id
                    hub_order_id: order.id || order.shopify_order_id || null,
                    hub_fulfillment_number: f.fulfillment_number,
                    order_number: f.fulfillment_number === 1 ? baseNum : `${baseNum}-${f.fulfillment_number}`,
                    customer_email: authEmail,
                    customer_name: resolvedName,
                    hub_customer_email: order.customer_email || hubEmail,
                    status: mappedStatus,
                    total: order.total ? parseFloat((order.total / fulfillments.length).toFixed(2)) : 0,
                    fulfillment_type: 'delivery',
                    delivery_address: fAddress,
                    contact_phone: fPhone,
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
              expanded.push({
                id: `hub_${order.id}`,
                task_id: order.id || order.fulfillment_task_id || null, // Hub FulfillmentTask.id
                hub_order_id: order.id || order.shopify_order_id || null,
                order_number: (order.shopify_order_number || order.order_number || '').replace('#', ''),
                customer_email: authEmail,
                customer_name: resolvedName,
                hub_customer_email: order.customer_email || hubEmail,
                status: mappedStatus,
                total: order.total || 0,
                fulfillment_type: 'delivery',
                delivery_address: resolvedAddress,
                contact_phone: resolvedPhone,
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
      // Patch missing fields from local order if Hub doesn't have them
      mergedMap.set(o.order_number, {
        ...o,
        customer_name: o.customer_name || local?.customer_name || '',
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

    // ── 4. Date filter & exclude already delivered ───────────────────────────────────────────────────────
    if (date) {
      deliveryOrders = deliveryOrders.filter(o =>
        o.estimated_delivery_date === date || o.assigned_delivery_date === date
      );
      console.log(`[Route] After date filter (${date}): ${deliveryOrders.length} orders`);
    }

    // CRITICAL: Exclude already delivered orders — they must NOT be re-optimized or reverted to queued status
    const deliveredOrders = deliveryOrders.filter(o => o.status === 'delivered' || o.delivered_at);
    const queuedForOptimization = deliveryOrders.filter(o => o.status !== 'delivered' && !o.delivered_at);
    
    if (deliveredOrders.length > 0) {
      console.log(`[Route] Excluding ${deliveredOrders.length} already-delivered orders from optimization`);
    }

    if (queuedForOptimization.length === 0) {
      return Response.json({ 
        orders: deliveryOrders, 
        optimized_orders: deliveredOrders.length > 0 ? deliveredOrders : null,
        completed_orders: deliveredOrders
      });
    }
    
    // Continue optimization only for queued orders
    deliveryOrders = queuedForOptimization;

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
      const enriched = {
        ...order,
        leg_distance_meters: leg?.distanceMeters || null,
        leg_duration_seconds: leg ? parseInt(leg.duration?.replace('s', '') || '0') : null,
      };
      
      // CRITICAL: Ensure real Hub task_id is preserved for driver actions
      // task_id must be the Hub FulfillmentTask.id (not order id, not hub_order_id)
      if (!enriched.task_id) {
        // Fallback: if no task_id, generate from hub_order_id or use order id as last resort
        if (enriched.hub_order_id) {
          console.warn(`[Route] task_id missing for order=${enriched.order_number || 'missing'}, using hub_order_id fallback`);
          enriched.task_id = enriched.hub_order_id;
        } else {
          console.warn(`[Route] task_id AND hub_order_id missing for order=${enriched.order_number || 'missing'}, using id fallback`);
          enriched.task_id = enriched.id;
        }
      }
      
      return enriched;
    });

    // Add return-to-origin as final stop (for display only, not a customer delivery)
    const returnToOrigin = {
      id: 'return_to_origin',
      order_number: 'RETURN',
      customer_name: 'Return to NuVira Base',
      delivery_address: ORIGIN,
      contact_phone: '',
      is_return_stop: true,
      status: 'return_to_origin',
      leg_distance_meters: null,
      leg_duration_seconds: null,
    };
    const optimizedOrdersWithReturn = [...ordersWithLegs, returnToOrigin];

    const totalDistanceMeters = route.distanceMeters || 0;
    const totalDurationSeconds = route.duration ? parseInt(route.duration.replace('s', '')) : 0;

    // Final validation: all optimized stops must have real task_ids
    const taskIdCheck = optimizedOrdersWithReturn.filter(o => !o.is_return_stop && !o.task_id);
    if (taskIdCheck.length > 0) {
      console.error(`[Route] ${taskIdCheck.length} stops missing task_id after optimization:`, taskIdCheck.map(o => o.order_number || 'missing'));
    } else {
      console.log(`✓ All ${optimizedOrders.length} delivery stops have task_ids`);
    }

    console.log('Optimized stop order (with task_ids):');
    optimizedOrders.forEach((o, i) => {
      console.log(`  ${i + 1}. task_id=${o.task_id || 'missing'}, order=${o.order_number || 'missing'}`);
    });

    return Response.json({
      orders: deliveryOrders,
      optimized_orders: optimizedOrdersWithReturn,
      total_distance_miles: Math.round((totalDistanceMeters / 1609.344) * 10) / 10,
      total_duration_minutes: Math.round(totalDurationSeconds / 60),
      customer_delivery_count: optimizedOrders.length,
    });

  } catch (error) {
    console.error('optimizeDeliveryRoute error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
}

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
