import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return (value || '').toString().trim();
}

function sanitizeEvent(event) {
  const details = event.details || {};
  return {
    type: event.type || null,
    label: event.label || null,
    timestamp: event.timestamp || null,
    date: event.date || null,
    source: event.source || null,
    status: event.status || null,
    task_id: event.task_id || null,
    fulfillment_number: event.fulfillment_number ?? null,
    production_date: event.production_date || null,
    delivery_date: event.delivery_date || null,
    delivery_window_label: event.delivery_window_label || null,
    schedule_source: event.schedule_source || null,
    source_type: event.source_type || null,
    details: {
      proof_available: details.proof_available === true,
      delivery_photo_url: details.delivery_photo_url || null,
      delivery_drop_location: details.delivery_drop_location || null,
    },
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }
    const hubOrderId = normalizeText(body.hub_order_id);
    const orderNumber = normalizeText(body.order_number);
    const stripeSubscriptionId = normalizeText(body.stripe_subscription_id);
    const customerAppOrderId = normalizeText(body.customer_app_order_id);
    const limit = normalizeText(body.limit);

    if (!hubOrderId && !orderNumber && !stripeSubscriptionId && !customerAppOrderId) {
      return Response.json({
        error: 'At least one scoped identifier is required',
        required_any_of: ['hub_order_id', 'order_number', 'stripe_subscription_id', 'customer_app_order_id'],
      }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub timeline service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams();
    if (hubOrderId) params.set('hub_order_id', hubOrderId);
    if (orderNumber) params.set('order_number', orderNumber);
    if (stripeSubscriptionId) params.set('stripe_subscription_id', stripeSubscriptionId);
    if (customerAppOrderId) params.set('customer_app_order_id', customerAppOrderId);
    if (limit) params.set('limit', limit);

    const hubUrl = `${hubBase}/functions/getOrderTimelineForCustomerApp?${params.toString()}`;
    const hubResponse = await fetch(hubUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load Hub timeline',
        hub_status: hubResponse.status,
      }, { status: 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.events)) {
      return Response.json({ error: 'Malformed Hub timeline response' }, { status: 502 });
    }

    const events = hubData.events.map(sanitizeEvent);

    return Response.json({
      success: true,
      matched_by: hubData.matched_by || null,
      order_number: hubData.order_number || null,
      count: events.length,
      events,
    });
  } catch (error) {
    console.error('[getAdminOrderTimeline] Error:', error.message);
    return Response.json({ error: 'Unable to load Hub timeline' }, { status: 500 });
  }
});
