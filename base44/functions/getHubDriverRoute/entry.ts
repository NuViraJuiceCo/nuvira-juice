/**
 * getHubDriverRoute
 * 
 * Builds the driver route for a given date by querying Hub via the same
 * getOrderUpdatesForCustomerApp endpoint used by getAdminOrdersWithHub.
 * 
 * Auth: driver, admin, or operations role only.
 * No local Order or FulfillmentTask reads or writes.
 * 
 * Returns: { date, counts, delivery_window_label, ready_tasks, scheduled_tasks, completed_tasks }
 * Each task: { id, order_number, customer_name, delivery_address, contact_phone, status,
 *              scheduled_date, delivery_window_label, items, notes }
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

// Map Hub production_status → driver task status
function mapToTaskStatus(hubStatus) {
  const delivered = new Set(['fulfilled', 'delivered', 'picked_up']);
  const outForDelivery = new Set(['assigned_for_delivery', 'out_for_delivery', 'arriving_soon']);
  const ready = new Set([
    'packed', 'in_cold_storage', 'qc_checked', 'labeled', 'bottled',
    'bottled_packed', 'ready_for_delivery',
  ]);
  if (delivered.has(hubStatus)) return 'delivered';
  if (outForDelivery.has(hubStatus)) return 'out_for_delivery';
  if (ready.has(hubStatus)) return 'ready';
  return 'scheduled';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'driver' && user.role !== 'admin' && user.role !== 'operations') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { date } = await req.json();
    if (!date) return Response.json({ error: 'date is required' }, { status: 400 });

    const hubBase = (Deno.env.get('HUB_API_URL') || '').replace(/\/$/, '').replace(/\/functions\/.*$/, '');
    const hubSecret = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

    if (!hubBase || !hubSecret) {
      return Response.json({ error: 'Hub not configured' }, { status: 500 });
    }

    // ── 1. Fetch all UserProfiles to get the Hub query email for each customer ──
    const profiles = await base44.asServiceRole.entities.UserProfile.list('-created_date', 500);

    const authToContact = {};
    const contactToAuth = {};
    const emailToName = {};
    const emailToPhone = {};
    const emailToAddress = {};
    const hubEmails = new Set();

    for (const p of profiles) {
      if (!p.customer_email) continue;
      const hubEmail = p.contact_email || p.customer_email;
      hubEmails.add(hubEmail);
      if (p.contact_email && p.contact_email !== p.customer_email) {
        authToContact[p.customer_email] = p.contact_email;
        contactToAuth[p.contact_email] = p.customer_email;
      }
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ').trim();
      const ak = p.customer_email.toLowerCase();
      const ck = (p.contact_email || '').toLowerCase();
      if (name)    { emailToName[ak] = name;    if (ck) emailToName[ck] = name; }
      if (p.phone) { emailToPhone[ak] = p.phone; if (ck) emailToPhone[ck] = p.phone; }
      if (p.address) { emailToAddress[ak] = p.address; if (ck) emailToAddress[ck] = p.address; }
    }

    console.log(`[getHubDriverRoute] date=${date}, querying Hub for ${hubEmails.size} customers`);

    // ── 2. Fetch Hub orders for each customer ──────────────────────────────────
    const BATCH = 5;
    const emailList = Array.from(hubEmails);
    const allHubOrders = [];

    const fetchOne = async (hubEmail) => {
      try {
        const url = `${hubBase}/functions/getOrderUpdatesForCustomerApp?email=${encodeURIComponent(hubEmail)}`;
        const res = await fetch(url, { headers: { 'Authorization': `Bearer ${hubSecret}` } });
        if (!res.ok) return [];
        const data = await res.json();
        const orders = data.orders || [];
        if (orders.length > 0) {
          console.log(`[getHubDriverRoute] ${hubEmail}: ${orders.length} orders, dates: ${orders.map(o => o.assigned_delivery_date || o.estimated_delivery_date || 'none').join(', ')}`);
        }
        return orders.map(o => ({
          ...o,
          _hub_email: hubEmail,
          _auth_email: contactToAuth[hubEmail] || hubEmail,
        }));
      } catch {
        return [];
      }
    };

    for (let i = 0; i < emailList.length; i += BATCH) {
      const batch = emailList.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(fetchOne));
      allHubOrders.push(...results.flat());
    }

    console.log(`[getHubDriverRoute] Hub returned ${allHubOrders.length} total orders across all customers`);

    // ── 3. Filter to orders matching the requested delivery date ───────────────
    const dateOrders = allHubOrders.filter(o => {
      // Skip pickups
      if (o.fulfillment_type === 'pickup') return false;
      // Check assigned_delivery_date, estimated_delivery_date, or fulfillment dates
      const dates = [
        o.assigned_delivery_date,
        o.estimated_delivery_date,
        o.requested_delivery_date,
      ];
      // Also check fulfillment-level dates if present
      if (Array.isArray(o.fulfillments)) {
        for (const f of o.fulfillments) {
          if (f.delivery_date) dates.push(f.delivery_date);
        }
      }
      return dates.some(d => d && d.slice(0, 10) === date);
    });

    console.log(`[getHubDriverRoute] ${dateOrders.length} orders match date=${date}`);

    // ── 4. Build task objects ──────────────────────────────────────────────────
    const tasks = [];

    for (const order of dateOrders) {
      const authKey = (order._auth_email || order._hub_email || '').toLowerCase();
      const hubKey  = (order._hub_email || '').toLowerCase();

      const resolvedName = order.customer_name || order.full_name ||
        emailToName[authKey] || emailToName[hubKey] || '';
      const resolvedPhone = order.contact_phone || order.phone ||
        emailToPhone[authKey] || emailToPhone[hubKey] || '';
      const resolvedAddress = order.delivery_address ||
        emailToAddress[authKey] || emailToAddress[hubKey] || '';

      const hubStatus = order.production_status || order.status || 'new';
      const taskStatus = mapToTaskStatus(hubStatus);

      const orderNum = (order.shopify_order_number || order.order_number || '').replace('#', '');

      // Expand fulfillments only when a fulfillment's delivery_date matches the requested date.
      // If fulfillments exist but none match (e.g. subscription future deliveries), fall through
      // and use the order's own assigned_delivery_date instead.
      const matchingFulfillments = Array.isArray(order.fulfillments)
        ? order.fulfillments.filter(f => f.delivery_date && f.delivery_date.slice(0, 10) === date)
        : [];

      if (matchingFulfillments.length > 0) {
        for (const f of matchingFulfillments) {
          const fStatus = mapToTaskStatus(f.status || hubStatus);
          tasks.push({
            id: `${order.id || orderNum}_f${f.fulfillment_number}`,
            order_number: f.fulfillment_number === 1 ? orderNum : `${orderNum}-${f.fulfillment_number}`,
            customer_name: resolvedName,
            delivery_address: f.delivery_address || resolvedAddress,
            contact_phone: f.contact_phone || resolvedPhone,
            status: fStatus,
            scheduled_date: f.delivery_date || date,
            delivery_window_label: f.delivery_window_label || order.delivery_window_label || '5 PM – 8 PM',
            items: f.items || order.line_items || [],
            notes: `${order.subscription_plan || 'Subscription'} — Delivery ${f.fulfillment_number}`,
          });
        }
      } else {
        // Regular order or subscription where the top-level assigned_delivery_date matched
        tasks.push({
          id: order.id || orderNum,
          order_number: orderNum,
          customer_name: resolvedName,
          delivery_address: resolvedAddress,
          contact_phone: resolvedPhone,
          status: taskStatus,
          scheduled_date: order.assigned_delivery_date || order.estimated_delivery_date || date,
          delivery_window_label: order.delivery_window_label || '5 PM – 8 PM',
          items: order.line_items || order.items || [],
          notes: order.notes || null,
        });
      }
    }

    // ── 5. Bucket and count ────────────────────────────────────────────────────
    const ready_tasks     = tasks.filter(t => t.status === 'ready');
    const scheduled_tasks = tasks.filter(t => t.status === 'scheduled');
    const out_tasks       = tasks.filter(t => t.status === 'out_for_delivery');
    const completed_tasks = tasks.filter(t => t.status === 'delivered' || t.status === 'unable_to_deliver');

    // Put out_for_delivery inside ready_tasks bucket for the portal
    const ready_and_out = [...out_tasks, ...ready_tasks];
    const remaining = ready_and_out.length + scheduled_tasks.length;

    console.log(`[getHubDriverRoute] Result: ready=${ready_and_out.length} scheduled=${scheduled_tasks.length} completed=${completed_tasks.length}`);

    return Response.json({
      date,
      delivery_window_label: '5 PM – 8 PM',
      counts: {
        ready: ready_and_out.length,
        scheduled: scheduled_tasks.length,
        completed: completed_tasks.length,
        total: tasks.length,
        left: remaining,
      },
      ready_tasks: ready_and_out,
      scheduled_tasks,
      completed_tasks,
    });

  } catch (error) {
    console.error('[getHubDriverRoute] Error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});