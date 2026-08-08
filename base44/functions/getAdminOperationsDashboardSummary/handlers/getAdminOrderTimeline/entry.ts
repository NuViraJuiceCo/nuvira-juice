// @ts-nocheck
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

function normalizeLimit(value, fallback = 50, maximum = 100) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), maximum);
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

const CROSS_SOURCE_PROJECTION_TYPES = new Set([
  'delivered',
  'delivery_proof_added',
  'production_scheduled',
]);

function normalizeEventToken(value) {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function normalizedEventMoment(event) {
  const value = normalizeText(event?.timestamp || event?.date);
  if (!value) return '';
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
}

function projectionIdentity(event) {
  const type = normalizeEventToken(event?.type);
  if (!CROSS_SOURCE_PROJECTION_TYPES.has(type)) return '';
  return [
    type,
    normalizedEventMoment(event),
    normalizeText(event?.production_date),
    normalizeText(event?.delivery_date),
  ].join('|');
}

function dedupeCrossSourceProjections(events) {
  const groups = new Map();
  events.forEach((event, index) => {
    const key = projectionIdentity(event);
    if (!key) return;
    const group = groups.get(key) || [];
    group.push({ event, index });
    groups.set(key, group);
  });

  const dropIndexes = new Set();
  for (const group of groups.values()) {
    const taskEvents = group.filter(({ event }) => normalizeEventToken(event?.source) === 'fulfillment_task');
    const orderEvents = group.filter(({ event }) => normalizeEventToken(event?.source) === 'shopify_order');
    if (taskEvents.length === 0 || orderEvents.length === 0) continue;

    // FulfillmentTask is the occurrence-level source. Keep every distinct task
    // event, but hide the parent ShopifyOrder projection of the same milestone.
    for (const { index } of orderEvents) dropIndexes.add(index);
  }

  return events.filter((_, index) => !dropIndexes.has(index));
}

function nativeEvent({
  type,
  label,
  timestamp = null,
  date = null,
  source,
  status = null,
  task = null,
}) {
  return sanitizeEvent({
    type,
    label,
    timestamp,
    date,
    source,
    status,
    task_id: task?.id || task?.fulfillment_task_id || null,
    fulfillment_number: task?.fulfillment_number ?? null,
    production_date: task?.production_date || null,
    delivery_date: task?.delivery_date || task?.scheduled_date || null,
    delivery_window_label: task?.delivery_window_label || task?.time_window || null,
    schedule_source: task?.schedule_source || task?.task_source || null,
    source_type: task?.source_type || task?.source_channel || null,
    details: {
      proof_available: Boolean(task?.delivery_photo_url),
      delivery_photo_url: task?.delivery_photo_url || null,
      delivery_drop_location: task?.delivery_drop_location || null,
    },
  });
}

function eventMoment(event) {
  const value = event?.timestamp || event?.date;
  const parsed = Date.parse(value || '');
  return Number.isNaN(parsed) ? 0 : parsed;
}

function buildNativeTimeline({ customerOrder, nativeOrder, tasks, limit }) {
  const events = [];

  if (customerOrder?.created_date) {
    events.push(nativeEvent({
      type: 'order_created',
      label: 'Order Created',
      timestamp: customerOrder.created_date,
      source: 'Customer App Order',
      status: 'created',
    }));
  }

  if (nativeOrder?.created_date) {
    events.push(nativeEvent({
      type: 'native_operations_record_created',
      label: 'Native Operations Record Created',
      timestamp: nativeOrder.created_date,
      source: 'Shopify Order',
      status: 'created',
    }));
  }

  for (const task of tasks) {
    if (task?.created_date) {
      events.push(nativeEvent({
        type: 'fulfillment_task_created',
        label: 'Delivery Occurrence Created',
        timestamp: task.created_date,
        source: 'Fulfillment Task',
        status: 'created',
        task,
      }));
    }
    if (task?.production_date) {
      events.push(nativeEvent({
        type: 'production_scheduled',
        label: 'Production Scheduled',
        date: task.production_date,
        source: 'Fulfillment Task',
        status: 'scheduled_for_production',
        task,
      }));
    }
    if (task?.out_for_delivery_at) {
      events.push(nativeEvent({
        type: 'out_for_delivery',
        label: 'Out for Delivery',
        timestamp: task.out_for_delivery_at,
        source: 'Fulfillment Task',
        status: 'out_for_delivery',
        task,
      }));
    }
    if (task?.delivery_photo_url && task?.delivered_at) {
      events.push(nativeEvent({
        type: 'delivery_proof_added',
        label: 'Delivery Proof Added',
        timestamp: task.delivered_at,
        source: 'Fulfillment Task',
        status: 'proof_recorded',
        task,
      }));
    }
    if (task?.delivered_at) {
      events.push(nativeEvent({
        type: 'delivered',
        label: 'Delivered',
        timestamp: task.delivered_at,
        source: 'Fulfillment Task',
        status: 'delivered',
        task,
      }));
    }
  }

  const seen = new Set();
  return events
    .filter((event) => {
      const identity = [
        normalizeEventToken(event.type),
        normalizeEventToken(event.source),
        normalizeText(event.task_id),
        normalizedEventMoment(event),
      ].join('|');
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .sort((a, b) => eventMoment(b) - eventMoment(a))
    .slice(0, limit);
}

async function findFirst(entity, filters) {
  for (const filter of filters) {
    const rows = await entity.filter(filter, '-created_date', 2).catch(() => []);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeTimelineRecords(base44, { orderNumber, customerAppOrderId, limit }) {
  const entities = base44.asServiceRole.entities;
  const customerOrder = await findFirst(entities.Order, [
    ...(customerAppOrderId ? [{ id: customerAppOrderId }] : []),
    ...(orderNumber ? [{ order_number: orderNumber }] : []),
  ]);
  const resolvedOrderNumber = orderNumber || normalizeText(customerOrder?.order_number);
  const nativeOrder = await findFirst(entities.ShopifyOrder, [
    ...(customerAppOrderId ? [{ base44_order_id: customerAppOrderId }] : []),
    ...(resolvedOrderNumber ? [{ shopify_order_number: resolvedOrderNumber }] : []),
  ]);
  const taskQueries = [];
  if (resolvedOrderNumber) {
    taskQueries.push(entities.FulfillmentTask.filter({ order_number: resolvedOrderNumber }, '-created_date', limit).catch(() => []));
    taskQueries.push(entities.FulfillmentTask.filter({ shopify_order_number: resolvedOrderNumber }, '-created_date', limit).catch(() => []));
  }
  if (customerAppOrderId) {
    taskQueries.push(entities.FulfillmentTask.filter({ order_id: customerAppOrderId }, '-created_date', limit).catch(() => []));
    taskQueries.push(entities.FulfillmentTask.filter({ base44_order_id: customerAppOrderId }, '-created_date', limit).catch(() => []));
  }
  const seen = new Set();
  const tasks = (await Promise.all(taskQueries)).flat().filter((task) => {
    const identity = normalizeText(task?.id || task?.fulfillment_task_id);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });

  return {
    customerOrder,
    nativeOrder,
    tasks,
    orderNumber: resolvedOrderNumber || normalizeText(nativeOrder?.shopify_order_number),
  };
}

export default async function handler(req: Request) {
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
    const limit = normalizeLimit(body.limit);

    if (!hubOrderId && !orderNumber && !stripeSubscriptionId && !customerAppOrderId) {
      return Response.json({
        error: 'At least one scoped identifier is required',
        required_any_of: ['hub_order_id', 'order_number', 'stripe_subscription_id', 'customer_app_order_id'],
      }, { status: 400 });
    }

    const nativeRecords = await findNativeTimelineRecords(base44, {
      orderNumber,
      customerAppOrderId,
      limit,
    });
    const nativeEvents = buildNativeTimeline({
      customerOrder: nativeRecords.customerOrder,
      nativeOrder: nativeRecords.nativeOrder,
      tasks: nativeRecords.tasks,
      limit,
    });

    // Prefer the records owned by this app. They represent each delivery
    // occurrence directly and avoid duplicate parent-order projections.
    if (nativeEvents.length > 0) {
      return Response.json({
        success: true,
        matched_by: nativeRecords.customerOrder ? 'customer_app_order' : 'native_operations_record',
        source: 'customer_app_native',
        order_number: nativeRecords.orderNumber || orderNumber || null,
        count: nativeEvents.length,
        source_event_count: nativeEvents.length,
        duplicate_projection_count: 0,
        events: nativeEvents,
      });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({
        success: true,
        matched_by: null,
        source: 'customer_app_native',
        order_number: orderNumber || null,
        count: 0,
        source_event_count: 0,
        duplicate_projection_count: 0,
        events: [],
        warning: 'legacy_source_unavailable',
      });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams();
    if (hubOrderId) params.set('hub_order_id', hubOrderId);
    if (orderNumber) params.set('order_number', orderNumber);
    if (stripeSubscriptionId) params.set('stripe_subscription_id', stripeSubscriptionId);
    if (customerAppOrderId) params.set('customer_app_order_id', customerAppOrderId);
    params.set('limit', String(limit));

    const hubUrl = `${hubBase}/functions/getOrderTimelineForCustomerApp?${params.toString()}`;
    const hubResponse = await fetch(hubUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        success: true,
        matched_by: null,
        source: 'customer_app_native',
        order_number: orderNumber || null,
        count: 0,
        source_event_count: 0,
        duplicate_projection_count: 0,
        events: [],
        warning: 'legacy_source_unavailable',
      });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.events)) {
      return Response.json({ error: 'Malformed Hub timeline response' }, { status: 502 });
    }

    const sourceEvents = hubData.events.map(sanitizeEvent);
    const events = dedupeCrossSourceProjections(sourceEvents);

    return Response.json({
      success: true,
      matched_by: hubData.matched_by || null,
      order_number: hubData.order_number || null,
      count: events.length,
      source_event_count: sourceEvents.length,
      duplicate_projection_count: sourceEvents.length - events.length,
      events,
    });
  } catch (error) {
    console.error('[getAdminOrderTimeline] Error:', error.message);
    return Response.json({ error: 'Unable to load Hub timeline' }, { status: 500 });
  }
}
