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

function normalizeFulfillmentNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeTask(task) {
  return {
    id: task.id || null,
    order_id: task.order_id || null,
    order_number: task.order_number || null,
    fulfillment_number: task.fulfillment_number ?? null,
    status: task.status || null,
    delivery_status: task.delivery_status || null,
    scheduled_date: task.scheduled_date || null,
    production_date: task.production_date || null,
    delivery_date: task.delivery_date || task.scheduled_date || null,
    delivery_window_label: task.delivery_window_label || null,
    items_summary: task.items_summary || null,
    source_type: task.source_type || null,
    schedule_source: task.schedule_source || null,
    payment_status: task.payment_status || null,
    delivered_at: task.delivered_at || null,
    delivery_photo_url: task.delivery_photo_url || null,
    delivery_drop_location: task.delivery_drop_location || null,
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
    const fulfillmentNumber = normalizeFulfillmentNumber(body.fulfillment_number);
    const limit = normalizeText(body.limit);

    if (!hubOrderId && !orderNumber && !stripeSubscriptionId && !customerAppOrderId) {
      return Response.json({
        error: 'At least one scoped identifier is required',
        required_any_of: ['hub_order_id', 'order_number', 'stripe_subscription_id', 'customer_app_order_id'],
      }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub task detail service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams();
    if (hubOrderId) params.set('hub_order_id', hubOrderId);
    if (orderNumber) params.set('order_number', orderNumber);
    if (stripeSubscriptionId) params.set('stripe_subscription_id', stripeSubscriptionId);
    if (customerAppOrderId) params.set('customer_app_order_id', customerAppOrderId);
    if (limit) params.set('limit', limit);

    const hubUrl = `${hubBase}/functions/getFulfillmentTaskDetailsForCustomerApp?${params.toString()}`;
    const hubResponse = await fetch(hubUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load FulfillmentTask details',
        hub_status: hubResponse.status,
      }, { status: 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.tasks)) {
      return Response.json({ error: 'Malformed FulfillmentTask detail response' }, { status: 502 });
    }

    const tasks = hubData.tasks
      .map(sanitizeTask)
      .filter(task => {
        if (fulfillmentNumber === null) return true;
        return Number(task.fulfillment_number) === fulfillmentNumber;
      });

    return Response.json({
      success: true,
      matched_by: hubData.matched_by || null,
      count: tasks.length,
      tasks,
    });
  } catch (error) {
    console.error('[getAdminFulfillmentTaskDetails] Error:', error.message);
    return Response.json({ error: 'Unable to load FulfillmentTask details' }, { status: 500 });
  }
});
