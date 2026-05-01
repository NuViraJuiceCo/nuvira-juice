import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

/**
 * Admin order list:
 * - Queries Hub for ALL customers (from UserProfiles), not just those with surviving local orders.
 *   This ensures customers whose only local record is SUPERSEDED_BY_HUB still appear via Hub.
 * - Merges with valid local orders (excluding SUPERSEDED_BY_HUB).
 * - Hub wins when both sides have the same order_number.
 * - Hub-managed orders keep is_hub_order=true so the frontend can route status updates correctly.
 * - is_read_only is NOT set — admin can always update status.
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

    // 2. Fetch ALL UserProfiles to get every customer — including those whose only local
    //    record was superseded and would otherwise be invisible.
    const profiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', 500);

    // Build bidirectional auth_email <-> contact_email maps
    const authToContact = {};
    const contactToAuth = {};
    for (const p of profiles) {
      if (p.customer_email && p.contact_email && p.customer_email !== p.contact_email) {
        authToContact[p.customer_email] = p.contact_email;
        contactToAuth[p.contact_email] = p.customer_email;
      }
    }

    // Build the set of hub query emails from ALL profiles + surviving local orders
    // Use contact_email if available (real email, not Apple relay) — never add both variants
    const hubQueryEmails = new Set();
    for (const p of profiles) {
      if (p.customer_email) {
        const queryEmail = p.contact_email || p.customer_email;
        hubQueryEmails.add(queryEmail.toLowerCase().trim());
      }
    }
    // Also include emails from local orders not covered by profiles
    for (const o of localOrders) {
      if (o.customer_email) {
        const queryEmail = authToContact[o.customer_email] || o.customer_email;
        hubQueryEmails.add(queryEmail.toLowerCase().trim());
      }
    }

    // 3. Fetch Hub orders for each unique hub email
    const hubApiUrl = Deno.env.get('HUB_API_URL');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
    const hubBase = hubApiUrl ? hubApiUrl.replace(/\/$/, '').replace(/\/functions\/.*$/, '') : null;

    let allHubOrders = [];

    if (hubBase && hubSecret) {
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
          if (rawOrders.length === 0) return [];

          // Resolve back to auth email for display
          const authEmail = contactToAuth[hubEmail] || hubEmail;

          const expanded = [];
          for (const order of rawOrders) {
            const fulfillments = order.fulfillments;
            if (Array.isArray(fulfillments) && fulfillments.length > 0) {
              for (const f of fulfillments) {
                const baseOrderNum = (order.shopify_order_number || order.order_number || '').replace('#', '');
                expanded.push({
                  // Use a stable id that the frontend can use as advancingId key
                  id: `hub_${order.id || order.shopify_order_id}_f${f.fulfillment_number}`,
                  // Store Hub identifiers for status push
                  hub_order_id: order.id || order.shopify_order_id || null,
                  hub_fulfillment_number: f.fulfillment_number,
                  order_number: f.fulfillment_number === 1
                    ? baseOrderNum
                    : `${baseOrderNum}-${f.fulfillment_number}`,
                  customer_email: authEmail,
                  hub_customer_email: order.customer_email || hubEmail,
                  status: mapHubStatus(f.status || order.status),
                  total: order.total ? parseFloat((order.total / fulfillments.length).toFixed(2)) : 0,
                  subtotal: order.subtotal ? parseFloat((order.subtotal / fulfillments.length).toFixed(2)) : 0,
                  delivery_fee: 0,
                  fulfillment_type: order.fulfillment_type || 'delivery',
                  delivery_address: order.delivery_address || '',
                  contact_phone: order.contact_phone || '',
                  estimated_delivery_date: f.delivery_date || null,
                  created_date: f.delivery_date || order.created_date || order.updated_date || null,
                  items: f.items || order.line_items || [],
                  notes: `${order.subscription_plan || 'Subscription'} — Delivery ${f.fulfillment_number} of ${fulfillments.length}`,
                  is_hub_order: true,
                  // NOT is_read_only — admin can always update status
                });
              }
            } else {
              const baseOrderNum = (order.shopify_order_number || order.order_number || '').replace('#', '');
              expanded.push({
                id: `hub_${order.id}`,
                hub_order_id: order.id || order.shopify_order_id || null,
                order_number: baseOrderNum,
                customer_email: authEmail,
                hub_customer_email: order.customer_email || hubEmail,
                status: mapHubStatus(order.status),
                total: order.total || 0,
                subtotal: order.subtotal || 0,
                delivery_fee: order.delivery_fee || 0,
                fulfillment_type: order.fulfillment_type || 'delivery',
                delivery_address: order.delivery_address || '',
                contact_phone: order.contact_phone || '',
                estimated_delivery_date: order.estimated_delivery_date || null,
                created_date: order.created_date || order.updated_date || null,
                items: order.line_items || order.items || [],
                notes: order.notes || null,
                is_hub_order: true,
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
      console.log(`[AdminOrders] Hub returned ${allHubOrders.length} expanded orders across ${hubQueryEmails.size} customers`);
    }

    // 4. Merge: Hub wins for any order_number it has; local wins otherwise
    // Normalize order numbers for comparison: strip leading #, lowercase, trim
    function normalizeOrderNum(num) {
      return (num || '').toString().replace(/^#/, '').trim().toLowerCase();
    }

    const mergedMap = new Map();

    // Seed with Hub orders first — deduplicate Hub side too (same order fetched via contact+auth email)
    for (const order of allHubOrders) {
      const key = normalizeOrderNum(order.order_number);
      if (!key) continue;
      if (!mergedMap.has(key)) {
        mergedMap.set(key, order);
      }
    }

    // Local orders fill in only where Hub has no record
    for (const order of localOrders) {
      const key = normalizeOrderNum(order.order_number);
      if (!key) continue; // skip orders with no order_number entirely
      const hubHasIt = mergedMap.has(key) && mergedMap.get(key).is_hub_order;
      if (!hubHasIt) {
        mergedMap.set(key, order);
      }
    }

    const merged = Array.from(mergedMap.values()).sort((a, b) => {
      const aDate = new Date(a.created_date || 0);
      const bDate = new Date(b.created_date || 0);
      return bDate - aDate;
    });

    console.log(`[AdminOrders] Final: ${merged.length} orders (${localOrders.length} local non-superseded, ${allHubOrders.length} hub expanded)`);

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
    canceled: 'delivered', // treat canceled as terminal — won't normally appear in active
    pending: 'scheduled_for_juicing',
    production_scheduled: 'scheduled_for_juicing',
    // pass-through valid customer app statuses
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