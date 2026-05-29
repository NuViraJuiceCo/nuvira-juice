import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const CHICAGO_TZ = 'America/Chicago';
const MAX_LIMIT = 100;

function normalizeText(value) {
  return (value || '').toString().trim();
}

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeDate(value) {
  const text = normalizeText(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function lineItemsSummary(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items
    .slice(0, 8)
    .map(item => {
      const title = normalizeText(item?.title || item?.name || item?.product_name);
      const quantity = Number(item?.quantity) || 1;
      return title ? `${quantity}x ${title}` : null;
    })
    .filter(Boolean)
    .join(', ');
}

function sanitizeAssignedDriver(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 119).trim()}...` : text;
}

function sanitizeCustomerName(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 120 ? `${text.slice(0, 119).trim()}...` : text;
}

function sanitizeAddress(value) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]');

  if (!text) return null;
  return text.length > 240 ? `${text.slice(0, 239).trim()}...` : text;
}

function todayChicagoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function parseIsoDate(value, fieldName) {
  const text = normalizeText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const normalized = date.toISOString().slice(0, 10);
  if (normalized !== text) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  return text;
}

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return MAX_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function sanitizeStop(stop) {
  return {
    task_id: stop.task_id || null,
    order_number: stop.order_number || null,
    customer_name: sanitizeCustomerName(stop.customer_name),
    fulfillment_number: stop.fulfillment_number ?? null,
    source_type: stop.source_type || null,
    assigned_driver: sanitizeAssignedDriver(stop.assigned_driver),
    task_status: stop.task_status || null,
    delivery_status: stop.delivery_status || null,
    fulfillment_status: stop.fulfillment_status || null,
    delivery_date: stop.delivery_date || null,
    delivery_window_label: stop.delivery_window_label || null,
    delivery_address: sanitizeAddress(stop.delivery_address),
    items_summary: stop.items_summary || null,
    delivered_at: stop.delivered_at || null,
    proof_available: stop.proof_available === true,
    delivery_photo_url: stop.delivery_photo_url || null,
    delivery_drop_location: stop.delivery_drop_location || null,
    missing_address: stop.missing_address === true,
    bag_return_required: stop.bag_return_required ?? null,
    bag_return_count: stop.bag_return_count ?? null,
    data_source: stop.data_source || null,
  };
}

function sanitizeSummary(summary) {
  return {
    total_stops: Number(summary?.total_stops) || 0,
    active: Number(summary?.active) || 0,
    completed: Number(summary?.completed) || 0,
    bag_returns: summary?.bag_returns === null || summary?.bag_returns === undefined
      ? null
      : Number(summary.bag_returns) || 0,
  };
}

function summarizeStops(active, completed) {
  const bagReturnValues = [...active, ...completed]
    .map(stop => stop.bag_return_count)
    .filter(value => value !== null && value !== undefined);
  return sanitizeSummary({
    total_stops: active.length + completed.length,
    active: active.length,
    completed: completed.length,
    bag_returns: bagReturnValues.length
      ? bagReturnValues.reduce((sum, value) => sum + (Number(value) || 0), 0)
      : null,
  });
}

async function loadNativeDeliveryStops(base44, deliveryDate, limit) {
  const [tasks, orders] = await Promise.all([
    base44.asServiceRole.entities.FulfillmentTask.list('-delivery_date', 500).catch(() => []),
    base44.asServiceRole.entities.ShopifyOrder.list('-created_date', 500).catch(() => []),
  ]);
  const ordersById = new Map();
  const ordersByBase44Id = new Map();
  for (const order of orders) {
    if (order.id) ordersById.set(order.id, order);
    if (order.base44_order_id) ordersByBase44Id.set(order.base44_order_id, order);
  }

  const fromTasks = tasks
    .filter(task => normalizeDate(task.delivery_date || task.scheduled_date) === deliveryDate)
    .map(task => {
      const order = ordersById.get(task.order_id) || ordersByBase44Id.get(task.order_id) || {};
      return sanitizeStop({
        task_id: task.id,
        order_number: order.shopify_order_number || order.order_number || task.order_number,
        customer_name: order.customer_name || task.customer_name,
        fulfillment_number: task.fulfillment_number,
        source_type: task.source_type || order.source_type || order.source_channel || 'customer_app_native',
        assigned_driver: task.assigned_driver || order.assigned_driver,
        task_status: task.status || 'pending',
        delivery_status: task.delivery_status || order.fulfillment_status,
        fulfillment_status: order.fulfillment_status,
        delivery_date: normalizeDate(task.delivery_date || task.scheduled_date),
        delivery_window_label: task.delivery_window_label || order.delivery_window_label || order.requested_time_window,
        delivery_address: task.delivery_address || order.delivery_address,
        items_summary: task.items_summary || lineItemsSummary(task.items || order.line_items),
        delivered_at: task.delivered_at,
        delivery_photo_url: task.delivery_photo_url,
        delivery_drop_location: task.delivery_drop_location,
        missing_address: !normalizeText(task.delivery_address || order.delivery_address),
        data_source: 'customer_app_native_task',
      });
    });

  const taskOrderNumbers = new Set(fromTasks.map(stop => normalizeLower(stop.order_number)).filter(Boolean));
  const fromOrders = orders
    .filter(order => normalizeDate(order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date) === deliveryDate)
    .filter(order => normalizeLower(order.fulfillment_method) === 'delivery')
    .filter(order => !taskOrderNumbers.has(normalizeLower(order.shopify_order_number || order.order_number)))
    .map(order => sanitizeStop({
      task_id: null,
      order_number: order.shopify_order_number || order.order_number,
      customer_name: order.customer_name,
      fulfillment_number: 1,
      source_type: order.source_type || order.source_channel || 'customer_app_native',
      assigned_driver: order.assigned_driver,
      task_status: order.fulfillment_status || 'pending',
      delivery_status: order.fulfillment_status,
      fulfillment_status: order.fulfillment_status,
      delivery_date: normalizeDate(order.assigned_delivery_date || order.selected_delivery_date || order.requested_delivery_date),
      delivery_window_label: order.delivery_window_label || order.requested_time_window,
      delivery_address: order.delivery_address,
      items_summary: lineItemsSummary(order.line_items),
      missing_address: !normalizeText(order.delivery_address),
      data_source: 'customer_app_native_order',
    }));

  const allStops = [...fromTasks, ...fromOrders].slice(0, limit);
  const completed = allStops.filter(stop => ['delivered', 'completed', 'fulfilled'].includes(normalizeLower(stop.task_status || stop.delivery_status)));
  const active = allStops.filter(stop => !completed.includes(stop));

  return {
    summary: summarizeStops(active, completed),
    sections: {
      delivery_stops: active,
      completed,
    },
    source_available: allStops.length > 0,
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

    const body = await req.json().catch(() => ({}));
    let deliveryDate;
    let limit;

    try {
      deliveryDate = parseIsoDate(body.delivery_date || body.date, 'delivery_date') || todayChicagoDate();
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const nativeData = await loadNativeDeliveryStops(base44, deliveryDate, limit);

    let hubData = null;
    let hubWarning = null;
    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      hubWarning = 'hub_delivery_queue_service_not_configured';
    } else {
      const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
      const params = new URLSearchParams({
        delivery_date: deliveryDate,
        limit: limit.toString(),
      });

      const hubResponse = await fetch(`${hubBase}/functions/getDeliveryRouteSummaryForCustomerApp?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
      });

      if (!hubResponse.ok) {
        hubWarning = `hub_delivery_queue_unavailable:${hubResponse.status}`;
      } else {
        const parsedHubData = await hubResponse.json().catch(() => null);
        if (
          !parsedHubData ||
          parsedHubData.success !== true ||
          !parsedHubData.sections ||
          !Array.isArray(parsedHubData.sections.delivery_stops) ||
          !Array.isArray(parsedHubData.sections.completed)
        ) {
          hubWarning = 'hub_delivery_queue_malformed_response';
        } else {
          hubData = parsedHubData;
        }
      }
    }

    const hubActive = hubData ? hubData.sections.delivery_stops.map(stop => sanitizeStop({ ...stop, data_source: 'hub' })) : [];
    const hubCompleted = hubData ? hubData.sections.completed.map(stop => sanitizeStop({ ...stop, data_source: 'hub' })) : [];
    const hubOrderNumbers = new Set([...hubActive, ...hubCompleted].map(stop => normalizeLower(stop.order_number)).filter(Boolean));
    const nativeActive = nativeData.sections.delivery_stops.filter(stop => !hubOrderNumbers.has(normalizeLower(stop.order_number)));
    const nativeCompleted = nativeData.sections.completed.filter(stop => !hubOrderNumbers.has(normalizeLower(stop.order_number)));
    const deliveryStops = [...hubActive, ...nativeActive].slice(0, limit);
    const completedStops = [...hubCompleted, ...nativeCompleted].slice(0, limit);

    if (!hubData && !nativeData.source_available) {
      return Response.json({
        error: 'Unable to load delivery queue summary',
        warning: hubWarning,
      }, { status: 503 });
    }

    return Response.json({
      success: true,
      delivery_date: hubData?.delivery_date || deliveryDate,
      summary: summarizeStops(deliveryStops, completedStops),
      sections: {
        delivery_stops: deliveryStops,
        completed: completedStops,
      },
      data_sources: {
        hub_available: Boolean(hubData),
        native_available: nativeData.source_available,
        native_read_only: true,
      },
      warnings: [hubWarning].filter(Boolean),
    });
  } catch (error) {
    console.error('[getAdminDeliveryRouteSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load delivery queue summary' }, { status: 500 });
  }
});
