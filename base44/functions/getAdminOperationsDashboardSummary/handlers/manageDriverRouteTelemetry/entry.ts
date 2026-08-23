// @ts-nocheck
import { timingSafeEqual } from 'node:crypto';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ROUTE_ORIGIN = "619 N Main St Unit 3, O'Fallon, MO 63366";
const CENTRAL_TIME_ZONE = 'America/Chicago';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SNAPSHOT_FRESH_MS = 3 * 60 * 1000;
const ACTIVITY_REFRESH_MS = 60 * 1000;
const ETA_WINDOW_SECONDS = 10 * 60;
const DWELL_PER_STOP_SECONDS = 150;
const MAX_TASKS = 30;
const MAX_ACCURACY_METERS = 250;
const ACTIVE_STATUSES = new Set(['out_for_delivery', 'arriving_soon']);
const ROUTE_ELIGIBLE_STATUSES = new Set(['packed', 'bottled_packed', 'ready_for_delivery', 'out_for_delivery', 'arriving_soon']);
const ALLOWED_ACTIONS = new Set(['start', 'status', 'ingest', 'stop']);

function text(value: unknown, max = 180): string {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function lower(value: unknown, max = 180): string {
  return text(value, max).toLowerCase();
}

function statusKey(value: unknown): string {
  const valueText = lower(value).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (valueText === 'out for delivery' || valueText === 'in transit') return 'out_for_delivery';
  if (valueText === 'ready for delivery') return 'ready_for_delivery';
  if (valueText === 'bottled packed') return 'bottled_packed';
  if (['complete', 'completed', 'fulfilled'].includes(valueText)) return 'delivered';
  return valueText.replace(/\s+/g, '_');
}

function normalizeDate(value: unknown): string {
  return text(value, 40).match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || '';
}

function timestamp(value: unknown): number {
  const parsed = Date.parse(text(value, 80));
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeAddress(value: unknown): string {
  if (typeof value === 'string') return text(value, 320);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return '';
  const address = value as Record<string, unknown>;
  return [
    address.address_line1 || address.line1 || address.street,
    address.address_line2 || address.line2,
    address.city,
    address.state,
    address.postal_code || address.zip,
  ].map((part) => text(part, 120)).filter(Boolean).join(', ').slice(0, 320);
}

function taskAddress(task: Record<string, any>, order: Record<string, any> | null): string {
  return safeAddress(task.delivery_address)
    || safeAddress(task.address)
    || [task.address_line1, task.address_line2, task.address_city, task.address_state, task.address_postal_code]
      .map((part) => text(part, 120)).filter(Boolean).join(', ').slice(0, 320)
    || safeAddress(order?.delivery_address)
    || [order?.address_line1, order?.address_line2, order?.address_city, order?.address_state, order?.address_postal_code]
      .map((part) => text(part, 120)).filter(Boolean).join(', ').slice(0, 320);
}

function normalizeId(value: unknown, field: string): string {
  const id = text(value, 160);
  if (!id || !/^[A-Za-z0-9._:@/-]+$/.test(id)) throw new Error(`${field}_invalid`);
  return id;
}

function normalizeTaskIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TASKS) throw new Error('ordered_task_ids_invalid');
  const ids = value.map((item) => normalizeId(item, 'ordered_task_id'));
  return [...new Set(ids)];
}

function currentUserLabel(user: Record<string, any>): string[] {
  return [user.id, user.email, user.full_name, user.name]
    .map((value) => lower(value, 180))
    .filter(Boolean);
}

function driverMatches(task: Record<string, any>, user: Record<string, any>): boolean {
  const actorLabels = new Set(currentUserLabel(user));
  return [task.assigned_driver_id, task.assigned_driver_email, task.assigned_driver]
    .map((value) => lower(value, 180))
    .filter(Boolean)
    .some((value) => actorLabels.has(value));
}

function routeDate(task: Record<string, any>): string {
  return normalizeDate(task.delivery_date || task.assigned_delivery_date || task.scheduled_date);
}

function routeDriver(task: Record<string, any>): string {
  return text(task.assigned_driver_email || task.assigned_driver_id || task.assigned_driver, 180);
}

function sameRoute(anchor: Record<string, any>, candidate: Record<string, any>): boolean {
  const anchorRouteId = text(anchor.route_id, 160);
  if (anchorRouteId) return text(candidate.route_id, 160) === anchorRouteId;
  const anchorDriver = lower(routeDriver(anchor), 180);
  const candidateDriver = lower(routeDriver(candidate), 180);
  return routeDate(candidate) === routeDate(anchor) && Boolean(anchorDriver) && candidateDriver === anchorDriver;
}

function routeSequence(task: Record<string, any>): number {
  const value = Number(task.route_stop_sequence);
  return Number.isFinite(value) && value > 0 ? value : Number.MAX_SAFE_INTEGER;
}

async function digestHex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secureHashMatch(leftHex: string, rightHex: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(leftHex) || !/^[a-f0-9]{64}$/.test(rightHex)) return false;
  const decode = (value: string) => Uint8Array.from(value.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
  return timingSafeEqual(decode(leftHex), decode(rightHex));
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function safeSession(row: Record<string, any>, now = new Date()) {
  const sampleAge = timestamp(row.last_sample_at) ? now.getTime() - timestamp(row.last_sample_at) : null;
  return {
    success: true,
    session_id: text(row.session_id, 160),
    state: row.state,
    route_id: text(row.route_id, 160) || null,
    delivery_date: normalizeDate(row.delivery_date) || null,
    anchor_fulfillment_task_id: text(row.anchor_fulfillment_task_id, 160),
    task_count: Array.isArray(row.task_ids) ? row.task_ids.length : 0,
    tracked_order_count: Array.isArray(row.order_ids) ? row.order_ids.length : 0,
    started_at: text(row.started_at, 80) || null,
    expires_at: text(row.expires_at, 80) || null,
    stopped_at: text(row.stopped_at, 80) || null,
    last_sample_at: text(row.last_sample_at, 80) || null,
    sample_fresh: sampleAge !== null && sampleAge >= 0 && sampleAge <= SNAPSHOT_FRESH_MS,
    last_provider_status: text(row.last_provider_status, 40) || 'pending',
    location_storage: 'coordinates_discarded_after_derivation',
  };
}

async function readBody(req: Request): Promise<Record<string, any> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

async function authenticatedOperator(base44: any) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) return { user: null, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!['admin', 'owner', 'driver'].includes(lower(user.role, 40))) {
    return { user: null, response: Response.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { user, response: null };
}

async function listRows(entity: any, sort: string): Promise<Record<string, any>[]> {
  if (!entity || typeof entity.list !== 'function') return [];
  return entity.list(sort, 500).catch(() => []);
}

function customerOrderForTask(task: Record<string, any>, orders: Record<string, any>[]) {
  const directIds = [task.base44_order_id, task.customer_app_order_id, task.order_id].map((value) => text(value, 160)).filter(Boolean);
  const orderNumber = lower(task.order_number || task.shopify_order_number, 100).replace(/^#/, '');
  return orders.find((order) => directIds.includes(text(order.id, 160)))
    || orders.find((order) => lower(order.order_number, 100).replace(/^#/, '') === orderNumber)
    || null;
}

function orderedRouteTasks(anchor: Record<string, any>, tasks: Record<string, any>[], requestedOrder: string[]) {
  const eligible = tasks.filter((task) => (
    task.is_test_task !== true
    && sameRoute(anchor, task)
    && ROUTE_ELIGIBLE_STATUSES.has(statusKey(task.status || task.delivery_status))
  ));
  const eligibleById = new Map(eligible.map((task) => [text(task.id, 160), task]));
  const requested = requestedOrder.map((id) => eligibleById.get(id)).filter(Boolean);
  const requestedIds = new Set(requested.map((task) => text(task.id, 160)));
  const rest = eligible
    .filter((task) => !requestedIds.has(text(task.id, 160)))
    .sort((left, right) => routeSequence(left) - routeSequence(right));
  return [...requested, ...rest].slice(0, MAX_TASKS);
}

function routeRecords(tasks: Record<string, any>[], orders: Record<string, any>[]) {
  return tasks.map((task) => {
    const order = customerOrderForTask(task, orders);
    return {
      task,
      order,
      task_id: text(task.id, 160),
      order_id: text(order?.id, 160),
      order_number: text(order?.order_number || task.order_number || task.shopify_order_number, 80).replace(/^#/, '').toUpperCase(),
      address: taskAddress(task, order),
      status: statusKey(task.status || task.delivery_status || order?.status),
    };
  }).filter((record) => record.task_id && record.order_id && record.order_number && record.address);
}

function durationSeconds(leg: Record<string, any>): number {
  const value = Number(text(leg?.duration, 40).replace(/s$/, ''));
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function distanceMeters(leg: Record<string, any>): number {
  const value = Number(leg?.distanceMeters);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function timeLabel(date: Date): string {
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: CENTRAL_TIME_ZONE });
}

function baselineMap(row: Record<string, any>): Map<string, number> {
  return new Map((Array.isArray(row.baseline_distances) ? row.baseline_distances : [])
    .map((item) => [text(item?.order_id, 160), Number(item?.distance_meters)])
    .filter(([orderId, value]) => orderId && Number.isFinite(value) && value > 0));
}

function previousSnapshotMap(row: Record<string, any>): Map<string, Record<string, any>> {
  return new Map((Array.isArray(row.snapshots) ? row.snapshots : [])
    .filter((snapshot) => text(snapshot?.order_id, 160))
    .map((snapshot) => [text(snapshot.order_id, 160), snapshot]));
}

function buildSafeSnapshots({ row, records, legs, now, sequence }: Record<string, any>) {
  const baselines = baselineMap(row);
  const previous = previousSnapshotMap(row);
  const snapshots = [];
  let cumulativeDistance = 0;
  let cumulativeDuration = 0;
  const routeTotal = Math.max(records.length, Array.isArray(row.order_ids) ? row.order_ids.length : records.length);
  const deliveredCount = Math.max(0, routeTotal - records.length);

  records.forEach((record: Record<string, any>, index: number) => {
    cumulativeDistance += distanceMeters(legs[index] || {});
    cumulativeDuration += durationSeconds(legs[index] || {});
    const baseline = baselines.get(record.order_id) || Math.max(cumulativeDistance, 1);
    if (!baselines.has(record.order_id)) baselines.set(record.order_id, baseline);
    const rawProgress = 12 + (1 - Math.min(1, cumulativeDistance / baseline)) * 82;
    const priorProgress = Number(previous.get(record.order_id)?.progress_percent || 0);
    const progress = Math.max(12, Math.min(94, Math.round(Math.max(rawProgress, priorProgress))));
    const etaSeconds = cumulativeDuration + index * DWELL_PER_STOP_SECONDS;
    const etaStart = new Date(now.getTime() + Math.max(0, etaSeconds - ETA_WINDOW_SECONDS) * 1000);
    const etaEnd = new Date(now.getTime() + (etaSeconds + ETA_WINDOW_SECONDS) * 1000);
    snapshots.push({
      schema_version: 2,
      order_id: record.order_id,
      order_number: record.order_number,
      deep_link: `/order-tracker/${encodeURIComponent(record.order_number)}`,
      status: 'out_for_delivery',
      activity_state: 'en_route',
      activity_eligible: true,
      on_route: true,
      status_label: 'Out for Delivery',
      message: index === 0
        ? 'Your driver is headed to your stop next.'
        : `${index} stop${index === 1 ? '' : 's'} ahead of yours.`,
      eta_window: `${timeLabel(etaStart)} - ${timeLabel(etaEnd)}`,
      eta_start: etaStart.toISOString(),
      eta_end: etaEnd.toISOString(),
      eta_start_epoch: Math.floor(etaStart.getTime() / 1000),
      eta_end_epoch: Math.floor(etaEnd.getTime() / 1000),
      stops_ahead: index,
      stops_remaining: records.length,
      stops_total: routeTotal,
      stops_delivered: deliveredCount,
      progress_percent: progress,
      progress_source: 'distance_eta',
      updated_at: now.toISOString(),
      sequence,
      stale_at: new Date(now.getTime() + SNAPSHOT_FRESH_MS).toISOString(),
      stale_at_epoch: Math.floor((now.getTime() + SNAPSHOT_FRESH_MS) / 1000),
      privacy_label: 'Route progress only. Precise driver location is not shared.',
    });
  });

  return {
    snapshots,
    baselines: [...baselines.entries()].map(([order_id, distance_meters]) => ({ order_id, distance_meters })),
  };
}

async function stableSnapshotHash(snapshots: Record<string, any>[]): Promise<string> {
  return digestHex(JSON.stringify(snapshots.map((snapshot) => ({
    order_id: snapshot.order_id,
    progress_percent: snapshot.progress_percent,
    eta_start_epoch: snapshot.eta_start_epoch,
    eta_end_epoch: snapshot.eta_end_epoch,
    stops_ahead: snapshot.stops_ahead,
  }))));
}

async function computeRoute(records: Record<string, any>[], latitude: number, longitude: number, apiKey: string) {
  const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'routes.legs.distanceMeters,routes.legs.duration',
    },
    body: JSON.stringify({
      origin: { location: { latLng: { latitude, longitude } } },
      destination: { address: ROUTE_ORIGIN },
      intermediates: records.map((record) => ({ address: record.address })),
      travelMode: 'DRIVE',
      optimizeWaypointOrder: false,
      routingPreference: 'TRAFFIC_AWARE',
    }),
  });
  const data = await response.json().catch(() => ({}));
  const route = response.ok && Array.isArray(data?.routes) ? data.routes[0] : null;
  return route && Array.isArray(route.legs) && route.legs.length >= records.length ? route : null;
}

async function findSession(base44: any, sessionId: string) {
  const rows = await base44.asServiceRole.entities.DeliveryRouteTelemetry.filter({ session_id: sessionId }, '-updated_date', 5).catch(() => []);
  return rows[0] || null;
}

async function startSession(base44: any, user: Record<string, any>, body: Record<string, any>) {
  const taskId = normalizeId(body.fulfillment_task_id, 'fulfillment_task_id');
  const requestedOrder = normalizeTaskIds(body.ordered_task_ids);
  const tasks = await listRows(base44.asServiceRole.entities.FulfillmentTask, '-delivery_date');
  const anchor = tasks.find((task) => text(task.id, 160) === taskId) || null;
  if (!anchor) return Response.json({ error: 'fulfillment_task_not_found' }, { status: 404 });
  if (!ACTIVE_STATUSES.has(statusKey(anchor.status || anchor.delivery_status))) {
    return Response.json({ error: 'route_tracking_requires_out_for_delivery' }, { status: 409 });
  }
  if (!routeDriver(anchor)) return Response.json({ error: 'assigned_driver_required' }, { status: 409 });
  if (lower(user.role, 40) === 'driver' && !driverMatches(anchor, user)) {
    return Response.json({ error: 'driver_assignment_mismatch' }, { status: 403 });
  }

  const orderedTasks = orderedRouteTasks(anchor, tasks, requestedOrder);
  if (!orderedTasks.some((task) => text(task.id, 160) === taskId)) {
    return Response.json({ error: 'route_scope_unavailable' }, { status: 409 });
  }
  const orders = await listRows(base44.asServiceRole.entities.Order, '-created_date');
  const records = routeRecords(orderedTasks, orders);
  if (!records.some((record) => record.task_id === taskId)) {
    return Response.json({ error: 'route_order_linkage_incomplete' }, { status: 409 });
  }

  const now = new Date();
  const actorEmail = lower(user.email, 180);
  const existing = await base44.asServiceRole.entities.DeliveryRouteTelemetry.filter({ state: 'active' }, '-updated_date', 50).catch(() => []);
  for (const row of existing) {
    if (lower(row.actor_email, 180) === actorEmail || (
      lower(row.assigned_driver, 180) === lower(routeDriver(anchor), 180)
      && normalizeDate(row.delivery_date) === routeDate(anchor)
    )) {
      await base44.asServiceRole.entities.DeliveryRouteTelemetry.update(row.id, {
        state: 'stopped',
        stopped_at: now.toISOString(),
        stop_reason: 'superseded_by_new_route_session',
        audit_events: [...(Array.isArray(row.audit_events) ? row.audit_events : []), {
          event: 'stopped', timestamp: now.toISOString(), actor_role: lower(user.role, 40), reason: 'superseded',
        }].slice(-20),
      });
    }
  }

  const rawToken = randomToken();
  const sessionId = `route-${crypto.randomUUID()}`;
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  const routeId = text(anchor.route_id, 160);
  const deliveryDate = routeDate(anchor);
  const row = await base44.asServiceRole.entities.DeliveryRouteTelemetry.create({
    session_id: sessionId,
    token_hash: await digestHex(rawToken),
    state: 'active',
    actor_email: actorEmail,
    actor_role: lower(user.role, 40),
    assigned_driver: routeDriver(anchor),
    anchor_fulfillment_task_id: taskId,
    ...(routeId ? { route_id: routeId } : {}),
    ...(deliveryDate ? { delivery_date: deliveryDate } : {}),
    task_ids: orderedTasks.map((task) => text(task.id, 160)),
    order_ids: records.map((record) => record.order_id),
    baseline_distances: [],
    snapshots: [],
    last_sequence: 0,
    last_provider_status: 'pending',
    started_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    audit_events: [{ event: 'started', timestamp: now.toISOString(), actor_role: lower(user.role, 40), reason: 'operator_started_active_route' }],
  });

  return Response.json({
    ...safeSession(row, now),
    session_token: rawToken,
    ingest_path: '/functions/getAdminOperationsDashboardSummary',
    minimum_update_interval_seconds: 30,
    minimum_distance_meters: 75,
  });
}

async function statusSession(base44: any, user: Record<string, any>, body: Record<string, any>) {
  const requestedId = body.session_id ? normalizeId(body.session_id, 'session_id') : '';
  const rows = requestedId
    ? await base44.asServiceRole.entities.DeliveryRouteTelemetry.filter({ session_id: requestedId }, '-updated_date', 5).catch(() => [])
    : await base44.asServiceRole.entities.DeliveryRouteTelemetry.filter({ state: 'active' }, '-updated_date', 50).catch(() => []);
  const row = rows.find((candidate) => (
    lower(user.role, 40) !== 'driver'
    || lower(candidate.actor_email, 180) === lower(user.email, 180)
    || lower(candidate.assigned_driver, 180) === lower(user.email, 180)
    || lower(candidate.assigned_driver, 180) === lower(user.full_name || user.name, 180)
  ));
  return row
    ? Response.json(safeSession(row))
    : Response.json({ success: true, state: 'inactive', location_storage: 'coordinates_discarded_after_derivation' });
}

async function stopSession(base44: any, user: Record<string, any>, body: Record<string, any>) {
  const sessionId = normalizeId(body.session_id, 'session_id');
  const row = await findSession(base44, sessionId);
  if (!row) return Response.json({ error: 'route_session_not_found' }, { status: 404 });
  if (lower(user.role, 40) === 'driver' && lower(row.actor_email, 180) !== lower(user.email, 180)
      && lower(row.assigned_driver, 180) !== lower(user.email, 180)
      && lower(row.assigned_driver, 180) !== lower(user.full_name || user.name, 180)) {
    return Response.json({ error: 'route_session_forbidden' }, { status: 403 });
  }
  if (row.state !== 'active') return Response.json({ ...safeSession(row), skipped: true, reason: 'already_stopped' });
  const now = new Date();
  const updated = await base44.asServiceRole.entities.DeliveryRouteTelemetry.update(row.id, {
    state: 'stopped',
    stopped_at: now.toISOString(),
    stop_reason: text(body.reason, 120) || 'operator_stopped',
    audit_events: [...(Array.isArray(row.audit_events) ? row.audit_events : []), {
      event: 'stopped', timestamp: now.toISOString(), actor_role: lower(user.role, 40), reason: text(body.reason, 120) || 'operator_stopped',
    }].slice(-20),
  });
  return Response.json(safeSession(updated, now));
}

async function ingestSample(base44: any, req: Request, body: Record<string, any>) {
  const sessionId = normalizeId(body.session_id, 'session_id');
  const row = await findSession(base44, sessionId);
  if (!row) return Response.json({ error: 'route_session_not_found' }, { status: 404 });
  if (row.state !== 'active') return Response.json({ error: 'route_session_inactive' }, { status: 410 });

  const now = new Date();
  if (!timestamp(row.expires_at) || timestamp(row.expires_at) <= now.getTime()) {
    await base44.asServiceRole.entities.DeliveryRouteTelemetry.update(row.id, {
      state: 'expired', stopped_at: now.toISOString(), stop_reason: 'session_expired',
    });
    return Response.json({ error: 'route_session_expired' }, { status: 410 });
  }
  const incomingToken = text(req.headers.get('x-route-session-token'), 256);
  const incomingHash = incomingToken ? await digestHex(incomingToken) : '';
  if (!incomingToken || !secureHashMatch(text(row.token_hash, 64), incomingHash)) {
    return Response.json({ error: 'route_session_unauthorized' }, { status: 401 });
  }

  const sequence = Number(body.sequence);
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);
  const accuracy = Number(body.accuracy_meters);
  const capturedAt = timestamp(body.captured_at);
  if (!Number.isSafeInteger(sequence) || sequence <= 0 || sequence > 1_000_000_000) {
    return Response.json({ error: 'sequence_invalid' }, { status: 400 });
  }
  if (sequence <= Number(row.last_sequence || 0)) {
    return Response.json({ success: true, skipped: true, reason: 'duplicate_or_out_of_order_sample', sequence: Number(row.last_sequence || 0) });
  }
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
      || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return Response.json({ error: 'location_sample_invalid' }, { status: 400 });
  }
  if (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > MAX_ACCURACY_METERS) {
    return Response.json({ success: true, skipped: true, reason: 'location_accuracy_insufficient' });
  }
  if (!capturedAt || capturedAt < now.getTime() - 5 * 60 * 1000 || capturedAt > now.getTime() + 2 * 60 * 1000) {
    return Response.json({ error: 'location_sample_stale' }, { status: 400 });
  }

  const allTasks = await listRows(base44.asServiceRole.entities.FulfillmentTask, '-delivery_date');
  const taskIds = new Set(Array.isArray(row.task_ids) ? row.task_ids.map((value) => text(value, 160)) : []);
  const activeTasks = allTasks.filter((task) => taskIds.has(text(task.id, 160)) && ACTIVE_STATUSES.has(statusKey(task.status || task.delivery_status)));
  const orders = await listRows(base44.asServiceRole.entities.Order, '-created_date');
  const records = routeRecords(activeTasks, orders);
  if (records.length === 0) {
    const updated = await base44.asServiceRole.entities.DeliveryRouteTelemetry.update(row.id, {
      state: 'stopped', stopped_at: now.toISOString(), stop_reason: 'route_complete', last_sequence: sequence, last_sample_at: now.toISOString(),
    });
    return Response.json({ ...safeSession(updated, now), route_complete: true });
  }

  const apiKey = Deno.env.get('GOOGLE_MAPS_API_KEY') || '';
  if (!apiKey) {
    await base44.asServiceRole.entities.DeliveryRouteTelemetry.update(row.id, {
      last_sequence: sequence,
      last_sample_at: now.toISOString(),
      last_accuracy_meters: Math.round(accuracy),
      last_provider_status: 'unavailable',
    });
    return Response.json({ success: true, progress_updated: false, reason: 'route_provider_not_configured' });
  }

  const route = await computeRoute(records, latitude, longitude, apiKey).catch(() => null);
  if (!route) {
    await base44.asServiceRole.entities.DeliveryRouteTelemetry.update(row.id, {
      last_sequence: sequence,
      last_sample_at: now.toISOString(),
      last_accuracy_meters: Math.round(accuracy),
      last_provider_status: 'unavailable',
    });
    return Response.json({ success: true, progress_updated: false, reason: 'route_provider_unavailable' });
  }

  const derived = buildSafeSnapshots({ row, records, legs: route.legs, now, sequence });
  const snapshotHash = await stableSnapshotHash(derived.snapshots);
  const shouldRefresh = snapshotHash !== text(row.last_snapshot_hash, 64)
    && (!timestamp(row.last_activity_refresh_at) || now.getTime() - timestamp(row.last_activity_refresh_at) >= ACTIVITY_REFRESH_MS);
  await base44.asServiceRole.entities.DeliveryRouteTelemetry.update(row.id, {
    baseline_distances: derived.baselines,
    snapshots: derived.snapshots,
    last_sequence: sequence,
    last_sample_at: now.toISOString(),
    last_accuracy_meters: Math.round(accuracy),
    last_provider_status: 'ok',
    last_snapshot_hash: snapshotHash,
    ...(shouldRefresh ? { last_activity_refresh_at: now.toISOString() } : {}),
  });

  let refreshRequested = 0;
  if (shouldRefresh) {
    for (const snapshot of derived.snapshots) {
      await base44.asServiceRole.functions.invoke('sendCustomerPushNotification', {
        operation: 'refresh_delivery_live_activity',
        order_id: snapshot.order_id,
        refresh_route: false,
        source: 'driver_route_telemetry',
      }).then(() => { refreshRequested += 1; }).catch(() => null);
    }
  }

  return Response.json({
    success: true,
    progress_updated: true,
    sequence,
    tracked_order_count: derived.snapshots.length,
    activity_refresh_requested: refreshRequested,
    next_update_after_seconds: 30,
    location_storage: 'coordinates_discarded_after_derivation',
  });
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  if (lower(Deno.env.get('DRIVER_ROUTE_TELEMETRY_KILL_SWITCH'), 20) === 'true') {
    return Response.json({ error: 'route_tracking_temporarily_unavailable' }, { status: 503 });
  }
  const body = await readBody(req);
  if (body === null) return Response.json({ error: 'malformed_json' }, { status: 400 });
  const action = lower(body.action, 40);
  if (!ALLOWED_ACTIONS.has(action)) return Response.json({ error: 'unsupported_action' }, { status: 400 });

  try {
    const base44 = createClientFromRequest(req);
    if (action === 'ingest') return ingestSample(base44, req, body);

    const auth = await authenticatedOperator(base44);
    if (auth.response) return auth.response;
    if (action === 'start') return startSession(base44, auth.user, body);
    if (action === 'status') return statusSession(base44, auth.user, body);
    return stopSession(base44, auth.user, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    const invalid = /_invalid$/.test(message);
    console.warn(`[manageDriverRouteTelemetry] ${invalid ? 'invalid_request' : 'operation_failed'}`);
    return Response.json({ error: invalid ? message : 'route_tracking_unavailable' }, { status: invalid ? 400 : 500 });
  }
}
