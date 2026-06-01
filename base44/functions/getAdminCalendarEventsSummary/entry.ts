import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 250;
const VALID_PRESETS = new Set(['current_month', 'next_30_days', 'today']);
const VALID_TYPES = new Set(['event', 'production', 'delivery', 'compliance']);
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
  };
}

function sanitizeComplianceItem(item) {
  return {
    type: 'compliance',
    compliance_date: sanitizeDate(item?.compliance_date),
    log_count: numberOrZero(item?.log_count),
    open_corrective_action_count: numberOrZero(item?.open_corrective_action_count),
    status_counts: sanitizeCounts(item?.status_counts),
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
  for (const batch of productionBatches.filter(row => inRange(batchProductionDate(row), dateFrom, dateTo))) {
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
  for (const task of fulfillmentTasks.filter(row => inRange(taskDeliveryDate(row), dateFrom, dateTo))) {
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
  ].filter(row => inRange(complianceDate(row), dateFrom, dateTo));

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

function nativeFallbackResponse({ dateFrom, dateTo, nativeCalendar, reason, hubStatus = null }) {
  return Response.json({
    success: true,
    source: 'customer_app_native_calendar_fallback',
    date_from: dateFrom,
    date_to: dateTo,
    generated_at: new Date().toISOString(),
    summary: sanitizeSummary(nativeCalendar.summary),
    dates: nativeCalendar.dates.map(sanitizeDateGroup).slice(0, MAX_RANGE_DAYS),
    truncated: false,
    warnings: [
      hubStatus ? `hub_calendar_unavailable:${hubStatus}` : `hub_calendar_unavailable:${reason}`,
      'native_read_only_fallback',
    ],
    data_sources: {
      hub_available: false,
      native_available: true,
      native_read_only: true,
    },
  });
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
    const loadNativeCalendar = () => loadNativeCalendarSummary(base44, {
      dateFrom: resolvedRange.date_from,
      dateTo: resolvedRange.date_to,
      type,
      status,
      search,
      limit,
    });

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      const nativeCalendar = await loadNativeCalendar();
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
      const nativeCalendar = await loadNativeCalendar();
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        nativeCalendar,
        reason: 'fetch_failed',
      });
    }

    if (!hubResponse.ok) {
      const nativeCalendar = await loadNativeCalendar();
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
      const nativeCalendar = await loadNativeCalendar();
      return nativeFallbackResponse({
        dateFrom: resolvedRange.date_from,
        dateTo: resolvedRange.date_to,
        nativeCalendar,
        reason: 'malformed_response',
      });
    }

    return Response.json({
      success: true,
      date_from: hubData.date_from || dateFrom || null,
      date_to: hubData.date_to || dateTo || null,
      generated_at: hubData.generated_at || null,
      summary: sanitizeSummary(hubData.summary),
      dates: hubData.dates.map(sanitizeDateGroup).slice(0, MAX_RANGE_DAYS),
      truncated: hubData.truncated === true,
    });
  } catch (error) {
    console.error('[getAdminCalendarEventsSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load calendar summary' }, { status: 500 });
  }
});
