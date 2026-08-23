// @ts-nocheck

const ROUTE_ORIGIN = "619 N Main St Unit 3, O'Fallon, MO 63366";
const CENTRAL_TIME_ZONE = 'America/Chicago';
const ON_ROUTE_STATUSES = new Set(['out_for_delivery', 'arriving_soon']);
const ROUTE_STATUSES = new Set(['out_for_delivery', 'arriving_soon', 'delivered']);
const TERMINAL_STATUSES = new Set(['delivered', 'cancelled', 'canceled', 'refunded', 'failed']);
const DWELL_PER_STOP_SECONDS = 150;
const FALLBACK_LEG_SECONDS = 15 * 60;
const ETA_WINDOW_SECONDS = 20 * 60;

function normalizeSingleLine(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function normalizeStatus(value: unknown): string {
  return normalizeSingleLine(value).toLowerCase().replace(/\s+/g, '_');
}

function normalizeOrderNumber(value: unknown): string {
  return normalizeSingleLine(value).replace(/^#/, '').toUpperCase();
}

function normalizeDate(value: unknown): string {
  const text = normalizeSingleLine(value);
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
}

function parseDate(value: unknown): number {
  const timestamp = Date.parse(normalizeSingleLine(value));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function centralCalendarDate(value: unknown): string {
  const timestamp = parseDate(value);
  if (!timestamp) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CENTRAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

function safeAddress(value: unknown): string {
  if (typeof value === 'string') return normalizeSingleLine(value).slice(0, 320);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const address = value as Record<string, unknown>;
  return [
    address.address_line1 || address.line1 || address.street,
    address.address_line2 || address.line2,
    address.city,
    address.state,
    address.postal_code || address.zip,
  ].map(normalizeSingleLine).filter(Boolean).join(', ').slice(0, 320);
}

function taskAddress(task: Record<string, any> | null | undefined): string {
  if (!task) return '';
  return safeAddress(task.address)
    || safeAddress(task.delivery_address)
    || [task.address_line1, task.address_line2, task.address_city, task.address_state, task.address_postal_code]
      .map(normalizeSingleLine)
      .filter(Boolean)
      .join(', ')
      .slice(0, 320);
}

function orderAddress(order: Record<string, any>, task?: Record<string, any> | null): string {
  return safeAddress(order.delivery_address)
    || safeAddress(order.address)
    || taskAddress(task);
}

function isDelivery(order: Record<string, any>, task?: Record<string, any> | null): boolean {
  const value = normalizeStatus(order.fulfillment_type || task?.fulfillment_type || task?.source_type);
  return value.includes('delivery') || value.includes('driver');
}

function resolveTaskOrderKey(task: Record<string, any>): string[] {
  return [
    normalizeSingleLine(task.base44_order_id),
    normalizeSingleLine(task.customer_app_order_id),
    normalizeSingleLine(task.order_id),
    normalizeOrderNumber(task.order_number || task.shopify_order_number),
  ].filter(Boolean);
}

function latestTaskByOrder(orders: Record<string, any>[], tasks: Record<string, any>[]) {
  const orderByKey = new Map<string, Record<string, any>>();
  for (const order of orders) {
    const keys = [normalizeSingleLine(order.id), normalizeOrderNumber(order.order_number)].filter(Boolean);
    for (const key of keys) orderByKey.set(key, order);
  }

  const taskByOrderId = new Map<string, Record<string, any>>();
  for (const task of tasks) {
    const order = resolveTaskOrderKey(task).map((key) => orderByKey.get(key)).find(Boolean);
    if (!order?.id) continue;
    const current = taskByOrderId.get(order.id);
    if (!current || parseDate(task.updated_date || task.created_date) > parseDate(current.updated_date || current.created_date)) {
      taskByOrderId.set(order.id, task);
    }
  }
  return taskByOrderId;
}

function resolvedStatus(order: Record<string, any>, task?: Record<string, any> | null): string {
  const taskStatus = normalizeStatus(task?.delivery_status || task?.status);
  const orderStatus = normalizeStatus(order.status);
  if (ROUTE_STATUSES.has(taskStatus) || TERMINAL_STATUSES.has(taskStatus)) return taskStatus;
  return orderStatus || taskStatus || 'order_received';
}

function resolvedDeliveryDate(order: Record<string, any>, task?: Record<string, any> | null): string {
  return normalizeDate(
    order.estimated_delivery_date
      || order.assigned_delivery_date
      || task?.delivery_date
      || task?.assigned_delivery_date
      || task?.scheduled_date,
  );
}

function routeSequence(task?: Record<string, any> | null): number | null {
  const value = Number(task?.route_stop_sequence);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: CENTRAL_TIME_ZONE,
  });
}

function activitySnapshot({
  order,
  status,
  now,
  routeTotal = 0,
  stopsDelivered = 0,
  stopsAhead = 0,
  stopsRemaining = 0,
  etaSeconds = null,
}: Record<string, any>) {
  const timestamp = Math.floor(now.getTime() / 1000);
  const orderNumber = normalizeOrderNumber(order.order_number);
  const delivered = status === 'delivered';
  const onRoute = ON_ROUTE_STATUSES.has(status) && isDelivery(order);
  const etaStart = onRoute && Number.isFinite(etaSeconds)
    ? new Date(now.getTime() + Math.max(0, etaSeconds - ETA_WINDOW_SECONDS) * 1000)
    : null;
  const etaEnd = onRoute && Number.isFinite(etaSeconds)
    ? new Date(now.getTime() + (etaSeconds + ETA_WINDOW_SECONDS) * 1000)
    : null;
  const targetStopCount = Math.max(1, stopsDelivered + stopsAhead + 1);
  const progress = delivered
    ? 100
    : onRoute
      ? Math.max(12, Math.min(92, Math.round((stopsDelivered / targetStopCount) * 100)))
      : 0;
  const statusLabel = delivered
    ? 'Delivered'
    : onRoute && stopsAhead === 0
      ? 'You are next'
      : onRoute
        ? `${stopsAhead} stop${stopsAhead === 1 ? '' : 's'} away`
        : 'Delivery not active';
  const message = delivered
    ? 'Your NuVira delivery is complete.'
    : onRoute && stopsAhead === 0
      ? 'Your driver is headed to your stop next.'
      : onRoute
        ? `${stopsAhead} stop${stopsAhead === 1 ? '' : 's'} ahead of yours.`
        : 'Live delivery tracking will appear when your route begins.';

  return {
    schema_version: 1,
    order_id: normalizeSingleLine(order.id),
    order_number: orderNumber,
    deep_link: orderNumber ? `/order-tracker/${encodeURIComponent(orderNumber)}` : '/account/orders',
    fulfillment_type: isDelivery(order) ? 'delivery' : normalizeStatus(order.fulfillment_type),
    status,
    activity_state: delivered ? 'delivered' : onRoute ? 'en_route' : 'inactive',
    activity_eligible: onRoute,
    on_route: onRoute,
    status_label: statusLabel,
    message,
    eta_window: etaStart && etaEnd ? `${formatTime(etaStart)} - ${formatTime(etaEnd)}` : null,
    eta_start: etaStart?.toISOString() || null,
    eta_end: etaEnd?.toISOString() || null,
    eta_start_epoch: etaStart ? Math.floor(etaStart.getTime() / 1000) : null,
    eta_end_epoch: etaEnd ? Math.floor(etaEnd.getTime() / 1000) : null,
    stops_ahead: onRoute ? stopsAhead : 0,
    stops_remaining: onRoute ? stopsRemaining : 0,
    stops_total: routeTotal,
    stops_delivered: delivered ? routeTotal : stopsDelivered,
    progress_percent: progress,
    updated_at: now.toISOString(),
    sequence: timestamp,
    stale_at: new Date(now.getTime() + 12 * 60 * 1000).toISOString(),
    stale_at_epoch: timestamp + 12 * 60,
    privacy_label: 'Route progress only. Precise driver location is not shared.',
  };
}

function genericOnRouteSnapshot(order: Record<string, any>, status: string, now: Date) {
  return activitySnapshot({
    order,
    status,
    now,
    routeTotal: 1,
    stopsDelivered: 0,
    stopsAhead: 0,
    stopsRemaining: 1,
    etaSeconds: 25 * 60,
  });
}

function durationSeconds(leg: Record<string, any> | null | undefined): number {
  const value = normalizeSingleLine(leg?.duration).replace(/s$/, '');
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : FALLBACK_LEG_SECONDS;
}

export async function buildDeliveryRouteSnapshots({
  base44,
  anchorOrderId,
  googleMapsApiKey = '',
  now = new Date(),
}: Record<string, any>) {
  const orders = await base44.asServiceRole.entities.Order.list('-created_date', 500);
  const anchorOrder = orders.find((order: Record<string, any>) => order.id === anchorOrderId) || null;
  if (!anchorOrder) return { anchor_order: null, anchor_snapshot: null, route_snapshots: [], route_orders: [] };

  const tasks = await base44.asServiceRole.entities.FulfillmentTask.list('-created_date', 500).catch(() => []);
  const taskByOrderId = latestTaskByOrder(orders, Array.isArray(tasks) ? tasks : []);
  const anchorTask = taskByOrderId.get(anchorOrder.id) || null;
  const anchorStatus = resolvedStatus(anchorOrder, anchorTask);
  const routeDate = resolvedDeliveryDate(anchorOrder, anchorTask) || now.toISOString().slice(0, 10);
  const anchorRouteId = normalizeSingleLine(anchorTask?.route_id);

  if (!isDelivery(anchorOrder, anchorTask) || (!ROUTE_STATUSES.has(anchorStatus) && !ON_ROUTE_STATUSES.has(anchorStatus))) {
    const inactive = activitySnapshot({ order: anchorOrder, status: anchorStatus, now });
    return { anchor_order: anchorOrder, anchor_snapshot: inactive, route_snapshots: [inactive], route_orders: [anchorOrder], route_date: routeDate };
  }

  const routeRecords = orders
    .map((order: Record<string, any>) => {
      const task = taskByOrderId.get(order.id) || null;
      return {
        order,
        task,
        status: resolvedStatus(order, task),
        deliveryDate: resolvedDeliveryDate(order, task),
        operationalDate: resolvedDeliveryDate(order, task)
          || centralCalendarDate(task?.updated_date || task?.created_date || order.updated_date || order.created_date),
        routeId: normalizeSingleLine(task?.route_id),
        address: orderAddress(order, task),
        sequence: routeSequence(task),
      };
    })
    .filter((record: Record<string, any>) => (
      isDelivery(record.order, record.task)
      && ROUTE_STATUSES.has(record.status)
      && record.address
      && (anchorRouteId ? record.routeId === anchorRouteId : record.operationalDate === routeDate)
    ));

  if (!routeRecords.some((record: Record<string, any>) => record.order.id === anchorOrder.id)) {
    const generic = genericOnRouteSnapshot(anchorOrder, anchorStatus, now);
    return { anchor_order: anchorOrder, anchor_snapshot: generic, route_snapshots: [generic], route_orders: [anchorOrder], route_date: routeDate };
  }

  const delivered = routeRecords
    .filter((record: Record<string, any>) => record.status === 'delivered')
    .sort((left: Record<string, any>, right: Record<string, any>) => (
      parseDate(left.task?.delivered_at || left.order.delivered_at || left.order.updated_date)
      - parseDate(right.task?.delivered_at || right.order.delivered_at || right.order.updated_date)
    ));
  const remaining = routeRecords.filter((record: Record<string, any>) => record.status !== 'delivered');
  const allRemainingSequenced = remaining.length > 0 && remaining.every((record: Record<string, any>) => record.sequence !== null);
  const orderedRemaining = allRemainingSequenced
    ? [...remaining].sort((left, right) => left.sequence - right.sequence)
    : [...remaining];

  let cumulativeByOrderId = new Map<string, number>();
  let finalOrder = orderedRemaining;

  if (orderedRemaining.length > 0 && googleMapsApiKey) {
    const routeOrigin = delivered.length > 0 ? delivered[delivered.length - 1].address : ROUTE_ORIGIN;
    try {
      const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': googleMapsApiKey,
          'X-Goog-FieldMask': 'routes.optimizedIntermediateWaypointIndex,routes.legs',
        },
        body: JSON.stringify({
          origin: { address: routeOrigin },
          destination: { address: ROUTE_ORIGIN },
          intermediates: orderedRemaining.map((record: Record<string, any>) => ({ address: record.address })),
          travelMode: 'DRIVE',
          optimizeWaypointOrder: !allRemainingSequenced,
          routingPreference: 'TRAFFIC_AWARE',
        }),
      });

      const data = await response.json().catch(() => ({}));
      const route = response.ok && Array.isArray(data?.routes) ? data.routes[0] : null;
      if (route) {
        const indexes = Array.isArray(route.optimizedIntermediateWaypointIndex)
          ? route.optimizedIntermediateWaypointIndex
          : orderedRemaining.map((_: unknown, index: number) => index);
        finalOrder = indexes.map((index: number) => orderedRemaining[index]).filter(Boolean);
        let cumulative = 0;
        finalOrder.forEach((record: Record<string, any>, index: number) => {
          cumulative += durationSeconds(route.legs?.[index]);
          cumulativeByOrderId.set(record.order.id, cumulative);
        });
      } else {
        console.warn(`[deliverySnapshot] Routes API unavailable status=${response.status}`);
      }
    } catch {
      console.warn('[deliverySnapshot] Routes API request failed; using safe fallback timing');
    }
  }

  if (cumulativeByOrderId.size === 0) {
    let cumulative = 0;
    finalOrder.forEach((record: Record<string, any>) => {
      cumulative += FALLBACK_LEG_SECONDS;
      cumulativeByOrderId.set(record.order.id, cumulative);
    });
  }

  const deliveredSnapshots = delivered.map((record: Record<string, any>) => activitySnapshot({
    order: record.order,
    status: 'delivered',
    now,
    routeTotal: routeRecords.length,
    stopsDelivered: routeRecords.length,
  }));
  const activeSnapshots = finalOrder.map((record: Record<string, any>, index: number) => activitySnapshot({
    order: record.order,
    status: record.status,
    now,
    routeTotal: routeRecords.length,
    stopsDelivered: delivered.length,
    stopsAhead: index,
    stopsRemaining: finalOrder.length,
    etaSeconds: (cumulativeByOrderId.get(record.order.id) || FALLBACK_LEG_SECONDS) + index * DWELL_PER_STOP_SECONDS,
  }));
  const routeSnapshots = [...deliveredSnapshots, ...activeSnapshots];
  const anchorSnapshot = routeSnapshots.find((snapshot) => snapshot.order_id === anchorOrder.id)
    || genericOnRouteSnapshot(anchorOrder, anchorStatus, now);

  return {
    anchor_order: anchorOrder,
    anchor_snapshot: anchorSnapshot,
    route_snapshots: routeSnapshots,
    route_orders: routeRecords.map((record: Record<string, any>) => record.order),
    route_date: routeDate,
  };
}
