// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const G39H_PATCH1_RUNTIME_ACTIVATION_MARKER = 'g39h_patch1_calendar_runtime_activation_unblock';
const MAX_RANGE_DAYS = 31;
const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 250;
const VALID_PRESETS = new Set(['current_month', 'next_30_days', 'today']);
const VALID_TYPES = new Set(['event', 'production', 'delivery', 'compliance']);
const VALID_EVENT_OPERATIONS = new Set(['create_event', 'update_event', 'archive_event']);
const CHICAGO_TZ = 'America/Chicago';

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

function normalizeLower(value) {
  return normalizeText(value).toLowerCase();
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

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
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

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function firstDayOfMonth(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

function lastDayOfMonth(dateStr) {
  const [year, month] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function resolveDateRange({ preset, dateFrom, dateTo }) {
  if (preset === 'custom') {
    return { date_from: dateFrom, date_to: dateTo };
  }

  const today = todayChicagoDate();
  if (preset === 'today') {
    return { date_from: today, date_to: today };
  }
  if (preset === 'next_30_days') {
    return { date_from: today, date_to: addDays(today, 29) };
  }
  return { date_from: firstDayOfMonth(today), date_to: lastDayOfMonth(today) };
}

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeType(value) {
  const type = normalizeLower(value);
  if (!type) return '';
  if (!VALID_TYPES.has(type)) {
    throw new Error('type must be one of event, production, delivery, compliance');
  }
  return type;
}

function sanitizeEventUrl(value, fieldName) {
  const text = sanitizeText(value, 500);
  if (!text) return null;
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${fieldName} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== 'https:') throw new Error(`${fieldName} must use HTTPS`);
  return parsed.toString();
}

function optionalNumber(value, fieldName, { min = 0 } = {}) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) throw new Error(`${fieldName} must be ${min} or greater`);
  return parsed;
}

function eventMutationPayload(body) {
  const event = body?.event && typeof body.event === 'object' && !Array.isArray(body.event) ? body.event : {};
  const title = sanitizeText(event.title, 140);
  const date = parseIsoDate(event.date, 'event.date');
  if (!title) throw new Error('event.title is required');
  if (!date) throw new Error('event.date is required');
  return {
    title,
    description: sanitizeText(event.description, 2000) || null,
    date,
    time: sanitizeText(event.time, 40) || null,
    location: sanitizeText(event.location, 240) || null,
    image_url: sanitizeEventUrl(event.image_url, 'event.image_url'),
    price: optionalNumber(event.price, 'event.price'),
    capacity: optionalNumber(event.capacity, 'event.capacity', { min: 1 }),
    is_active: event.is_active !== false,
    tags: Array.isArray(event.tags)
      ? event.tags.map(value => sanitizeText(value, 40)).filter(Boolean).slice(0, 12)
      : [],
    website_link: sanitizeEventUrl(event.website_link, 'event.website_link'),
    tickets_link: sanitizeEventUrl(event.tickets_link, 'event.tickets_link'),
  };
}

async function createEventAudit({ base44, user, requestId, operation, eventId, eventTitle }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_id: requestId,
    command_type: `admin_event_${operation}`,
    command_source: 'customer_app_admin',
    status: 'pending',
    target_entity: 'Event',
    target_id: eventId,
    target_display_id: eventTitle,
    actor_email: user.email,
    actor_role: user.role,
    actor_type: 'authenticated_admin',
    payload: { operation },
    result: { saved: false },
    idempotency_key: `admin_event:${operation}:${requestId}`,
    idempotent_skipped: false,
    request_id: requestId,
    submitted_at: now,
    started_at: now,
    function_name: 'getAdminCalendarEventsSummary',
  });
}

async function handleEventMutation({ base44, user, body }) {
  const operation = normalizeLower(body.operation);
  if (!VALID_EVENT_OPERATIONS.has(operation)) return null;
  const requestId = sanitizeText(body.request_id, 160);
  if (!requestId) return Response.json({ error: 'request_id is required' }, { status: 400 });

  const idempotencyKey = `admin_event:${operation}:${requestId}`;
  const existingCommands = await base44.asServiceRole.entities.CommandLog.filter(
    { idempotency_key: idempotencyKey }, '-created_date', 1,
  ).catch(() => []);
  if (existingCommands.length > 0) {
    const prior = existingCommands[0];
    if (prior.status !== 'success') {
      return Response.json({ error: 'A prior event change requires review before retrying' }, { status: 409 });
    }
    return Response.json({
      success: true,
      operation,
      skipped: true,
      reason: 'duplicate_request_id',
      event_id: prior?.target_id || null,
      source: 'customer_app_native',
    });
  }

  const eventId = sanitizeText(body.event_id, 100);
  if (operation !== 'create_event' && !eventId) {
    return Response.json({ error: 'event_id is required' }, { status: 400 });
  }

  let existingEvent = null;
  if (eventId) {
    const matches = await base44.asServiceRole.entities.Event.filter({ id: eventId }, '-created_date', 1).catch(() => []);
    existingEvent = matches[0] || null;
    if (!existingEvent) return Response.json({ error: 'Event not found' }, { status: 404 });
  }

  let payload = null;
  if (operation !== 'archive_event') {
    try {
      payload = eventMutationPayload(body);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
  }

  const command = await createEventAudit({
    base44,
    user,
    requestId,
    operation,
    eventId: eventId || `pending-native-${requestId}`,
    eventTitle: payload?.title || existingEvent?.title || 'Event',
  });

  let saved;
  try {
    if (operation === 'archive_event') {
      saved = await base44.asServiceRole.entities.Event.update(eventId, { is_active: false });
    } else if (operation === 'create_event') {
      saved = await base44.asServiceRole.entities.Event.create({
        ...payload,
        hub_event_id: `native-${requestId}`,
      });
    } else {
      saved = await base44.asServiceRole.entities.Event.update(eventId, payload);
    }
  } catch {
    await base44.asServiceRole.entities.CommandLog.update(command.id, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_code: 'event_write_failed',
      error_message: 'Event change failed',
      result: { saved: false },
    }).catch(() => null);
    return Response.json({ error: 'Unable to save event' }, { status: 500 });
  }

  await base44.asServiceRole.entities.CommandLog.update(command.id, {
    status: 'success',
    target_id: saved?.id || eventId,
    target_display_id: saved?.title || existingEvent?.title || 'Event',
    completed_at: new Date().toISOString(),
    result: { saved: true, source: 'customer_app_native' },
  });

  return Response.json({
    success: true,
    operation,
    skipped: false,
    event: sanitizeEventItem({
      ...existingEvent,
      ...saved,
      start_datetime: saved?.date || existingEvent?.date,
      status: saved?.is_active === false ? 'inactive' : 'active',
    }),
    event_id: saved?.id || eventId,
    source: 'customer_app_native',
    writes_performed: true,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
  });
}

function numberOrZero(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sanitizeText(value, maxLength = 120) {
  const text = normalizeText(value)
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]')
    .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[redacted]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'\-\s]{2,}\s+(?:st|street|ave|avenue|rd|road|dr|drive|ln|lane|blvd|boulevard|way|ct|court|pl|place)\b/gi, '[redacted]')
    .replace(/\b(?:bearer|authorization|token|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '[redacted]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeDate(value) {
  return normalizeText(value) || null;
}

function sanitizeCounts(group, maxKeys = 20) {
  if (!group || typeof group !== 'object' || Array.isArray(group)) return {};
  const result = {};
  for (const [key, value] of Object.entries(group).slice(0, maxKeys)) {
    const safeKey = sanitizeText(key, 50);
    if (safeKey) {
      result[safeKey] = numberOrZero(value);
    }
  }
  return result;
}

function sanitizeSummary(summary) {
  return {
    total_items: numberOrZero(summary?.total_items),
    events: numberOrZero(summary?.events),
    production_days: numberOrZero(summary?.production_days),
    delivery_days: numberOrZero(summary?.delivery_days),
    compliance_items: numberOrZero(summary?.compliance_items),
  };
}

function sanitizeMetadataWarnings(value) {
  if (!Array.isArray(value)) return undefined;
  const warnings = value.map(item => sanitizeText(item, 100)).filter(Boolean).slice(0, 6);
  return warnings.length > 0 ? warnings : undefined;
}

function sanitizeItemMetadata(item) {
  const metadata = {};
  const dataSource = normalizeLower(item?.data_source);
  if (['customer_app_native', 'hub_fallback', 'native_with_hub_fallback_context'].includes(dataSource)) {
    metadata.data_source = dataSource;
  }

  const fallbackSource = sanitizeText(item?.fallback_source, 80);
  if (fallbackSource) metadata.fallback_source = fallbackSource;

  const fallbackReason = sanitizeText(item?.fallback_reason, 100);
  if (fallbackReason) metadata.fallback_reason = fallbackReason;

  if (typeof item?.native_primary === 'boolean') metadata.native_primary = item.native_primary;
  if (typeof item?.hub_fallback_used === 'boolean') metadata.hub_fallback_used = item.hub_fallback_used;
  if (typeof item?.stale_hub_event_suppressed === 'boolean') metadata.stale_hub_event_suppressed = item.stale_hub_event_suppressed;

  const warnings = sanitizeMetadataWarnings(item?.warnings);
  if (warnings) metadata.warnings = warnings;

  return metadata;
}

function sanitizeEventItem(item) {
  return {
    id: sanitizeText(item?.id, 80),
    type: 'event',
    title: sanitizeText(item?.title, 140) || 'Event',
    event_type: sanitizeText(item?.event_type, 60),
    status: sanitizeText(item?.status, 60),
    start_datetime: sanitizeDate(item?.start_datetime),
    end_datetime: sanitizeDate(item?.end_datetime),
    location: sanitizeText(item?.location, 120),
    summary: sanitizeText(item?.summary, 160),
    ...sanitizeItemMetadata(item),
  };
}

function sanitizeProductionItem(item) {
  return {
    type: 'production',
    production_date: sanitizeDate(item?.production_date),
    batch_count: numberOrZero(item?.batch_count),
    product_count: numberOrZero(item?.product_count),
    planned_units: numberOrZero(item?.planned_units),
    status_counts: sanitizeCounts(item?.status_counts),
    ...sanitizeItemMetadata(item),
  };
}

function sanitizeComplianceItem(item) {
  return {
    type: 'compliance',
    compliance_date: sanitizeDate(item?.compliance_date),
    log_count: numberOrZero(item?.log_count),
    open_corrective_action_count: numberOrZero(item?.open_corrective_action_count),
    status_counts: sanitizeCounts(item?.status_counts),
    ...sanitizeItemMetadata(item),
  };
}

function sanitizeDeliveryItem(item) {
  return {
    type: 'delivery',
    delivery_date: sanitizeDate(item?.delivery_date),
    stop_count: numberOrZero(item?.stop_count),
    completed_count: numberOrZero(item?.completed_count),
    pending_count: numberOrZero(item?.pending_count),
    source_type_counts: sanitizeCounts(item?.source_type_counts),
    ...sanitizeItemMetadata(item),
  };
}

function sanitizeCalendarItem(item) {
  const type = normalizeLower(item?.type);
  if (type === 'event') return sanitizeEventItem(item);
  if (type === 'production') return sanitizeProductionItem(item);
  if (type === 'delivery') return sanitizeDeliveryItem(item);
  if (type === 'compliance') return sanitizeComplianceItem(item);
  return null;
}

function sanitizeDateGroup(group) {
  const items = Array.isArray(group?.items)
    ? group.items.map(sanitizeCalendarItem).filter(Boolean).slice(0, MAX_LIMIT)
    : [];

  return {
    date: sanitizeDate(group?.date),
    counts: {
      events: numberOrZero(group?.counts?.events),
      production: numberOrZero(group?.counts?.production),
      delivery: numberOrZero(group?.counts?.delivery),
      compliance: numberOrZero(group?.counts?.compliance),
    },
    items,
  };
}

function dateKey(value) {
  const text = normalizeText(value);
  const match = text.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function inRange(value, from, to) {
  const key = dateKey(value);
  return key && key >= from && key <= to;
}

function matchesSearch(...values) {
  return (search) => {
    if (!search) return true;
    const haystack = values.map(value => normalizeLower(value)).join(' ');
    return haystack.includes(normalizeLower(search));
  };
}

function statusMatches(value, statusFilter) {
  if (!statusFilter) return true;
  return normalizeLower(value) === normalizeLower(statusFilter);
}

function addCalendarItem(groups, date, item) {
  if (!date) return;
  const group = groups.get(date) || {
    date,
    counts: { events: 0, production: 0, delivery: 0, compliance: 0 },
    items: [],
  };
  group.items.push(item);
  if (item.type === 'event') group.counts.events += 1;
  if (item.type === 'production') group.counts.production += 1;
  if (item.type === 'delivery') group.counts.delivery += 1;
  if (item.type === 'compliance') group.counts.compliance += 1;
  groups.set(date, group);
}

function countStatuses(rows, statusField = 'status') {
  const counts = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = sanitizeText(row?.[statusField] || 'unknown', 50) || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function sourceTypeCounts(tasks) {
  const counts = {};
  for (const task of Array.isArray(tasks) ? tasks : []) {
    const key = sanitizeText(task?.source_type || task?.source_channel || task?.fulfillment_type || 'delivery', 50) || 'delivery';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function eventStartDate(event) {
  return dateKey(event?.start_datetime || event?.date || event?.event_date || event?.created_date);
}

function eventStartDateTime(event) {
  const date = dateKey(event?.start_datetime || event?.date || event?.event_date);
  const time = normalizeText(event?.time || event?.start_time);
  if (event?.start_datetime) return event.start_datetime;
  if (date && time) return `${date}T${time.length === 5 ? `${time}:00` : time}`;
  return date || null;
}

function batchProductionDate(batch) {
  return dateKey(batch?.production_date || batch?.created_date);
}

function taskDeliveryDate(task) {
  return dateKey(task?.delivery_date || task?.scheduled_date || task?.assigned_delivery_date);
}

function complianceDate(row) {
  return dateKey(
    row?.compliance_date ||
    row?.check_date ||
    row?.log_date ||
    row?.production_date ||
    row?.date ||
    row?.created_date,
  );
}

function isCompletedTask(task) {
  return ['delivered', 'picked_up', 'fulfilled', 'completed'].includes(normalizeLower(task?.status || task?.delivery_status));
}

function isOpenCorrectiveAction(row) {
  return !['completed', 'verified', 'closed', 'resolved', 'archived'].includes(normalizeLower(row?.status));
}

async function listEntity(base44, entityName, sort, limit = 500) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.list !== 'function') return [];
  return await entity.list(sort, limit).catch(error => {
    console.warn(`[getAdminCalendarEventsSummary] Native ${entityName} unavailable:`, error.message);
    return [];
  });
}

function applyCalendarFilters(groups, { type, status, search, limit }) {
  const filtered = [];
  for (const group of [...groups.values()].sort((a, b) => (a.date || '').localeCompare(b.date || ''))) {
    const items = group.items
      .map(sanitizeCalendarItem)
      .filter(Boolean)
      .filter(item => !type || item.type === type)
      .filter(item => {
        if (!status) return true;
        if (item.type === 'event') return statusMatches(item.status, status);
        if (item.type === 'production') return Number(item.status_counts?.[status] || 0) > 0;
        if (item.type === 'compliance') return Number(item.status_counts?.[status] || 0) > 0;
        if (item.type === 'delivery') return ['pending', 'completed'].includes(normalizeLower(status));
        return true;
      })
      .filter(item => {
        if (!search) return true;
        return normalizeLower(JSON.stringify(item)).includes(normalizeLower(search));
      });

    if (items.length === 0) continue;
    const counts = { events: 0, production: 0, delivery: 0, compliance: 0 };
    for (const item of items) {
      if (item.type === 'event') counts.events += 1;
      if (item.type === 'production') counts.production += 1;
      if (item.type === 'delivery') counts.delivery += 1;
      if (item.type === 'compliance') counts.compliance += 1;
    }
    filtered.push({ date: group.date, counts, items: items.slice(0, limit) });
  }
  return filtered.slice(0, MAX_RANGE_DAYS);
}

async function loadNativeCalendarSummary(base44, { dateFrom, dateTo, type, status, search, limit }) {
  const [
    events,
    productionBatches,
    fulfillmentTasks,
    sanitationLogs,
    temperatureLogs,
    dailyChecklists,
    correctiveActions,
    batchComplianceLogs,
    ccpLogs,
    phLogs,
  ] = await Promise.all([
    listEntity(base44, 'Event', '-date'),
    listEntity(base44, 'ProductionBatch', '-production_date'),
    listEntity(base44, 'FulfillmentTask', '-delivery_date'),
    listEntity(base44, 'SanitationLog', '-created_date'),
    listEntity(base44, 'TemperatureLog', '-created_date'),
    listEntity(base44, 'DailyChecklist', '-created_date'),
    listEntity(base44, 'CorrectiveActionLog', '-created_date'),
    listEntity(base44, 'BatchComplianceLog', '-created_date'),
    listEntity(base44, 'CCPLog', '-created_date'),
    listEntity(base44, 'pHLog', '-created_date'),
  ]);

  const groups = new Map();

  for (const event of events.filter(row => inRange(eventStartDate(row), dateFrom, dateTo))) {
    if (!matchesSearch(event.title, event.event_type, event.location, event.description)(search)) continue;
    if (status && !statusMatches(event.status || (event.is_active === false ? 'cancelled' : 'active'), status)) continue;
    addCalendarItem(groups, eventStartDate(event), {
      type: 'event',
      id: event.id,
      title: event.title,
      event_type: event.event_type || 'Event',
      status: event.status || (event.is_active === false ? 'cancelled' : 'active'),
      start_datetime: eventStartDateTime(event),
      end_datetime: event.end_datetime || null,
      location: event.location,
      summary: event.description,
    });
  }

  const batchesByDate = new Map();
  for (const batch of productionBatches.filter(row => row?.is_test_batch !== true && inRange(batchProductionDate(row), dateFrom, dateTo))) {
    const productionDate = batchProductionDate(batch);
    const rows = batchesByDate.get(productionDate) || [];
    rows.push(batch);
    batchesByDate.set(productionDate, rows);
  }
  for (const [productionDate, rows] of batchesByDate.entries()) {
    const productNames = new Set(rows.map(row => normalizeText(row.product_name)).filter(Boolean));
    addCalendarItem(groups, productionDate, {
      type: 'production',
      production_date: productionDate,
      batch_count: rows.length,
      product_count: productNames.size,
      planned_units: rows.reduce((sum, row) => sum + numberOrZero(row.planned_units), 0),
      status_counts: countStatuses(rows),
    });
  }

  const tasksByDate = new Map();
  for (const task of fulfillmentTasks.filter(row => row?.is_test_task !== true && inRange(taskDeliveryDate(row), dateFrom, dateTo))) {
    const sourceType = normalizeLower(task.source_type || task.source_channel || task.fulfillment_type);
    if (sourceType === 'pos' || sourceType === 'event_pos') continue;
    const deliveryDate = taskDeliveryDate(task);
    const rows = tasksByDate.get(deliveryDate) || [];
    rows.push(task);
    tasksByDate.set(deliveryDate, rows);
  }
  for (const [deliveryDate, rows] of tasksByDate.entries()) {
    addCalendarItem(groups, deliveryDate, {
      type: 'delivery',
      delivery_date: deliveryDate,
      stop_count: rows.length,
      completed_count: rows.filter(isCompletedTask).length,
      pending_count: rows.filter(row => !isCompletedTask(row)).length,
      source_type_counts: sourceTypeCounts(rows),
    });
  }

  const complianceRows = [
    ...sanitationLogs.map(row => ({ ...row, _compliance_type: 'sanitation' })),
    ...temperatureLogs.map(row => ({ ...row, _compliance_type: 'temperature' })),
    ...dailyChecklists.map(row => ({ ...row, _compliance_type: 'daily_checklist' })),
    ...correctiveActions.map(row => ({ ...row, _compliance_type: 'corrective_action' })),
    ...batchComplianceLogs.map(row => ({ ...row, _compliance_type: 'batch_compliance' })),
    ...ccpLogs.map(row => ({ ...row, _compliance_type: 'ccp' })),
    ...phLogs.map(row => ({ ...row, _compliance_type: 'ph' })),
  ].filter(row => row?.is_test_record !== true && inRange(complianceDate(row), dateFrom, dateTo));

  const complianceByDate = new Map();
  for (const row of complianceRows) {
    const date = complianceDate(row);
    const rows = complianceByDate.get(date) || [];
    rows.push(row);
    complianceByDate.set(date, rows);
  }
  for (const [date, rows] of complianceByDate.entries()) {
    addCalendarItem(groups, date, {
      type: 'compliance',
      compliance_date: date,
      log_count: rows.length,
      open_corrective_action_count: rows.filter(row => row._compliance_type === 'corrective_action' && isOpenCorrectiveAction(row)).length,
      status_counts: countStatuses(rows, '_compliance_type'),
    });
  }

  const dates = applyCalendarFilters(groups, { type, status, search, limit });
  const summary = sanitizeSummary({
    total_items: dates.reduce((sum, group) => sum + group.items.length, 0),
    events: dates.reduce((sum, group) => sum + numberOrZero(group.counts.events), 0),
    production_days: dates.filter(group => numberOrZero(group.counts.production) > 0).length,
    delivery_days: dates.filter(group => numberOrZero(group.counts.delivery) > 0).length,
    compliance_items: dates.reduce((sum, group) => sum + numberOrZero(group.counts.compliance), 0),
  });

  return { summary, dates };
}


function cloneDateGroupWithSource(group, sourceMetadata) {
  const safeGroup = sanitizeDateGroup(group);
  return {
    ...safeGroup,
    items: safeGroup.items.map(item => sanitizeCalendarItem({ ...item, ...sourceMetadata })).filter(Boolean),
  };
}

function calendarItemDate(item, groupDate = '') {
  return dateKey(
    item?.calendar_date ||
    item?.production_date ||
    item?.delivery_date ||
    item?.scheduled_date ||
    item?.assigned_delivery_date ||
    item?.compliance_date ||
    item?.start_datetime ||
    item?.date ||
    groupDate,
  );
}

function calendarExactKey(item, groupDate = '') {
  const type = normalizeLower(item?.type) || 'event';
  const date = calendarItemDate(item, groupDate) || groupDate || 'date_pending';
  if (type === 'event') {
    const id = normalizeLower(item?.id);
    if (id) return `${type}:${date}:id:${id}`;
    return `${type}:${date}:${normalizeLower(item?.event_type)}:${normalizeLower(item?.title)}:${normalizeLower(item?.start_datetime)}`;
  }
  if (type === 'production') return `${type}:${date}`;
  if (type === 'delivery') return `${type}:${date}`;
  if (type === 'compliance') return `${type}:${date}`;
  return `${type}:${date}:${normalizeLower(item?.title || item?.summary || item?.status)}`;
}

function calendarStableKey(item) {
  const type = normalizeLower(item?.type) || 'event';
  const id = normalizeLower(item?.id || item?.production_batch_id || item?.native_fulfillment_task_id || item?.hub_task_id || item?.order_number);
  if (!id) return '';
  return `${type}:${id}`;
}

function isCalendarItemComplete(item) {
  const type = normalizeLower(item?.type);
  if (type === 'event') return Boolean(item?.title && item?.event_type && normalizeLower(item.event_type) !== 'event' && (item?.start_datetime || item?.id));
  if (type === 'production') return Boolean(item?.production_date && Object.prototype.hasOwnProperty.call(item, 'batch_count'));
  if (type === 'delivery') return Boolean(item?.delivery_date && Object.prototype.hasOwnProperty.call(item, 'stop_count'));
  if (type === 'compliance') return Boolean(item?.compliance_date && Object.prototype.hasOwnProperty.call(item, 'log_count'));
  return true;
}

function recalculateDateGroup(group) {
  const items = Array.isArray(group?.items) ? group.items.map(sanitizeCalendarItem).filter(Boolean).slice(0, MAX_LIMIT) : [];
  const counts = { events: 0, production: 0, delivery: 0, compliance: 0 };
  for (const item of items) {
    if (item.type === 'event') counts.events += 1;
    if (item.type === 'production') counts.production += 1;
    if (item.type === 'delivery') counts.delivery += 1;
    if (item.type === 'compliance') counts.compliance += 1;
  }
  return { date: sanitizeDate(group?.date), counts, items };
}

function summarizeCalendarDates(dates) {
  return sanitizeSummary({
    total_items: dates.reduce((sum, group) => sum + numberOrZero(group.items?.length), 0),
    events: dates.reduce((sum, group) => sum + numberOrZero(group.counts?.events), 0),
    production_days: dates.filter(group => numberOrZero(group.counts?.production) > 0).length,
    delivery_days: dates.filter(group => numberOrZero(group.counts?.delivery) > 0).length,
    compliance_items: dates.reduce((sum, group) => sum + numberOrZero(group.counts?.compliance), 0),
  });
}

function addFallbackReason(reasons, reason) {
  const safeReason = sanitizeText(reason, 100);
  if (safeReason && !reasons.includes(safeReason)) reasons.push(safeReason);
}


function hubCalendarFallbackReason(item) {
  const text = normalizeLower([
    item?.event_type,
    item?.title,
    item?.summary,
    item?.status,
    item?.fallback_reason,
  ].filter(Boolean).join(' '));
  if (text.includes('subscription') || text.includes('multi_delivery') || text.includes('multi-delivery')) {
    return 'subscription_calendar_event_hub_source_of_truth';
  }
  if (text.includes('historical') || text.includes('late_mirror') || text.includes('late-mirror')) {
    return 'historical_hub_event_retained';
  }
  return 'native_calendar_event_missing';
}

function mergeNativeAndHubCalendar({ nativeCalendar, hubCalendar }) {
  const groups = new Map();
  const nativeExact = new Map();
  const nativeStable = new Map();
  const fallbackReasons = [];
  let nativeEventCount = 0;
  let nativeOnlyCount = 0;
  let hubFallbackEventCount = 0;
  let suppressedHubEventCount = 0;
  let mismatchCount = 0;

  const nativeGroups = Array.isArray(nativeCalendar?.dates)
    ? nativeCalendar.dates.map(group => cloneDateGroupWithSource(group, {
      data_source: 'customer_app_native',
      native_primary: true,
      hub_fallback_used: false,
    }))
    : [];

  for (const group of nativeGroups) {
    const outputGroup = groups.get(group.date) || { date: group.date, items: [] };
    for (const item of group.items) {
      const safeItem = sanitizeCalendarItem(item);
      if (!safeItem) continue;
      const key = calendarExactKey(safeItem, group.date);
      const stableKey = calendarStableKey(safeItem);
      outputGroup.items.push(safeItem);
      nativeExact.set(key, { item: safeItem, date: group.date });
      if (stableKey) nativeStable.set(stableKey, { item: safeItem, date: group.date });
      nativeEventCount += 1;
      nativeOnlyCount += 1;
    }
    groups.set(group.date, outputGroup);
  }

  const hubGroups = Array.isArray(hubCalendar?.dates)
    ? hubCalendar.dates.map(group => cloneDateGroupWithSource(group, {
      data_source: 'hub_fallback',
      fallback_source: 'hub_calendar',
      native_primary: false,
      hub_fallback_used: true,
    }))
    : [];

  for (const group of hubGroups) {
    for (const item of group.items) {
      const safeHubItem = sanitizeCalendarItem(item);
      if (!safeHubItem) continue;
      const exactKey = calendarExactKey(safeHubItem, group.date);
      const stableKey = calendarStableKey(safeHubItem);
      const nativeStableMatch = stableKey ? nativeStable.get(stableKey) : null;
      const nativeMatch = nativeExact.get(exactKey) || (nativeStableMatch?.date === group.date ? nativeStableMatch : null);

      if (nativeMatch) {
        nativeOnlyCount = Math.max(0, nativeOnlyCount - 1);
        if (!isCalendarItemComplete(nativeMatch.item) && isCalendarItemComplete(safeHubItem)) {
          Object.assign(nativeMatch.item, sanitizeItemMetadata({
            data_source: 'native_with_hub_fallback_context',
            fallback_source: 'hub_calendar',
            fallback_reason: 'native_data_incomplete_for_calendar_event',
            native_primary: true,
            hub_fallback_used: true,
            warnings: ['native_data_incomplete_for_calendar_event'],
          }));
          hubFallbackEventCount += 1;
          addFallbackReason(fallbackReasons, 'native_data_incomplete_for_calendar_event');
        } else {
          suppressedHubEventCount += 1;
          addFallbackReason(fallbackReasons, 'duplicate_native_hub_event_deduped');
        }
        continue;
      }

      if (nativeStableMatch && nativeStableMatch.date !== group.date) {
        suppressedHubEventCount += 1;
        mismatchCount += 1;
        addFallbackReason(fallbackReasons, 'stale_hub_event_suppressed');
        continue;
      }

      const outputGroup = groups.get(group.date) || { date: group.date, items: [] };
      const fallbackReason = hubCalendarFallbackReason(safeHubItem);
      outputGroup.items.push(sanitizeCalendarItem({
        ...safeHubItem,
        fallback_reason: fallbackReason,
        warnings: [`${fallbackReason}_hub_fallback_used`],
      }));
      groups.set(group.date, outputGroup);
      hubFallbackEventCount += 1;
      addFallbackReason(fallbackReasons, fallbackReason);
    }
  }

  const dates = [...groups.values()]
    .map(recalculateDateGroup)
    .filter(group => group.items.length > 0)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .slice(0, MAX_RANGE_DAYS);

  if (dates.length === 0) addFallbackReason(fallbackReasons, 'no_calendar_events_found');

  return {
    summary: summarizeCalendarDates(dates),
    dates,
    native_event_count: nativeEventCount,
    hub_fallback_event_count: hubFallbackEventCount,
    suppressed_hub_event_count: suppressedHubEventCount,
    fallback_required: hubFallbackEventCount > 0,
    fallback_reasons: fallbackReasons,
    hub_fallback_used: hubFallbackEventCount > 0,
    native_missing_count: hubFallbackEventCount,
    hub_only_count: hubFallbackEventCount,
    native_only_count: nativeOnlyCount,
    mismatch_count: mismatchCount,
  };
}

function nativeFirstCalendarResponse({ dateFrom, dateTo, nativeCalendar, hubData = null, hubWarning = null, hubAvailable = false }) {
  const hubCalendar = hubData && Array.isArray(hubData.dates)
    ? {
      summary: sanitizeSummary(hubData.summary),
      dates: hubData.dates.map(sanitizeDateGroup).slice(0, MAX_RANGE_DAYS),
    }
    : { summary: {}, dates: [] };

  const merged = mergeNativeAndHubCalendar({ nativeCalendar, hubCalendar });
  const warnings = [];
  if (hubWarning) warnings.push(hubWarning, 'native_read_only_fallback');
  if (merged.suppressed_hub_event_count > 0) warnings.push('hub_calendar_rows_suppressed_or_deduped');
  for (const reason of merged.fallback_reasons) {
    if (['stale_hub_event_suppressed', 'subscription_calendar_event_hub_source_of_truth', 'historical_hub_event_retained'].includes(reason)) warnings.push(reason);
  }

  return Response.json({
    success: true,
    source: hubAvailable ? 'customer_app_native_calendar_first' : 'customer_app_native_calendar_fallback',
    date_from: hubData?.date_from || dateFrom,
    date_to: hubData?.date_to || dateTo,
    generated_at: hubData?.generated_at || new Date().toISOString(),
    summary: merged.summary,
    dates: merged.dates,
    truncated: hubData?.truncated === true,
    warnings: [...new Set(warnings)].filter(Boolean),
    data_sources: {
      hub_available: hubAvailable,
      native_available: true,
      native_read_only: true,
      native_first: true,
      hub_fallback_active: true,
    },
    native_first_enabled: true,
    native_event_count: merged.native_event_count,
    hub_fallback_event_count: merged.hub_fallback_event_count,
    suppressed_hub_event_count: merged.suppressed_hub_event_count,
    fallback_required: merged.fallback_required,
    fallback_reasons: merged.fallback_reasons,
    hub_fallback_used: merged.hub_fallback_used,
    native_missing_count: merged.native_missing_count,
    hub_only_count: merged.hub_only_count,
    native_only_count: merged.native_only_count,
    mismatch_count: merged.mismatch_count,
    calendar_events_source: hubAvailable ? 'customer_app_native_first_with_hub_fallback' : 'customer_app_native_first_hub_unavailable',
    writes_performed: false,
    provider_call_impact: false,
    notifications_sent: false,
    hub_mutation_performed: false,
    live_command_candidate: false,
    runtime_activation_patch: G39H_PATCH1_RUNTIME_ACTIVATION_MARKER,
  });
}

function nativeFallbackResponse({ dateFrom, dateTo, nativeCalendar, reason, hubStatus = null }) {
  return nativeFirstCalendarResponse({
    dateFrom,
    dateTo,
    nativeCalendar,
    hubWarning: hubStatus ? `hub_calendar_unavailable:${hubStatus}` : `hub_calendar_unavailable:${reason}`,
    hubAvailable: false,
  });
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
    const mutationResponse = await handleEventMutation({ base44, user, body });
    if (mutationResponse) return mutationResponse;
    let dateFrom;
    let dateTo;
    let preset;
    let type;
    let limit;

    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
      const requestedPreset = normalizeLower(body.preset);
      preset = requestedPreset || ((dateFrom || dateTo) ? 'custom' : 'current_month');

      if (preset !== 'custom' && !VALID_PRESETS.has(preset)) {
        throw new Error('preset must be one of current_month, next_30_days, today');
      }

      if ((dateFrom || dateTo) && preset !== 'custom') {
        throw new Error('Use either preset or date_from/date_to, not both');
      }

      if (preset === 'custom') {
        if (!dateFrom || !dateTo) {
          throw new Error('date_from and date_to are required for custom range');
        }
        if (dateTo < dateFrom) {
          throw new Error('date_to must be on or after date_from');
        }
        if (daysInclusive(dateFrom, dateTo) > MAX_RANGE_DAYS) {
          throw new Error(`Date range must be ${MAX_RANGE_DAYS} days or fewer`);
        }
      }

      type = normalizeType(body.type);
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const status = sanitizeText(body.status, 60) || '';
    const search = sanitizeText(body.search, 80) || '';
    const resolvedRange = resolveDateRange({ preset, dateFrom, dateTo });
    const nativeCalendar = await loadNativeCalendarSummary(base44, {
      dateFrom: resolvedRange.date_from,
      dateTo: resolvedRange.date_to,
      type,
      status,
      search,
      limit,
    });

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        nativeCalendar,
        reason: 'missing_config',
      });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      limit: limit.toString(),
    });
    if (preset === 'custom') {
      params.set('date_from', dateFrom);
      params.set('date_to', dateTo);
    } else {
      params.set('preset', preset);
    }
    if (type) params.set('type', type);
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    let hubResponse;
    try {
      hubResponse = await fetch(`${hubBase}/functions/getCalendarEventsSummaryForCustomerApp?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
      });
    } catch (error) {
      console.warn('[getAdminCalendarEventsSummary] Hub fetch failed; returning native fallback:', error.message);
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        nativeCalendar,
        reason: 'fetch_failed',
      });
    }

    if (!hubResponse.ok) {
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        nativeCalendar,
        reason: 'non_ok',
        hubStatus: hubResponse.status,
      });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (
      !hubData ||
      hubData.success !== true ||
      !hubData.summary ||
      !Array.isArray(hubData.dates)
    ) {
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        nativeCalendar,
        reason: 'malformed_response',
      });
    }

    return nativeFirstCalendarResponse({
      dateFrom: resolvedRange.date_from,
      dateTo: resolvedRange.date_to,
      nativeCalendar,
      hubData,
      hubAvailable: true,
    });
  } catch (error) {
    console.error('[getAdminCalendarEventsSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load calendar summary' }, { status: 500 });
  }
}
