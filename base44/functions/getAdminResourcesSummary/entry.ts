import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;
const VALID_CATEGORIES = new Set(['team member', 'equipment']);
const VALID_STATUSES = new Set(['active', 'on leave', 'inactive', 'operational', 'maintenance', 'broken']);

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

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return DEFAULT_LIMIT;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function normalizeCategory(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const normalized = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!VALID_CATEGORIES.has(normalized)) {
    throw new Error('category must be Team Member or Equipment');
  }
  return normalized === 'team member' ? 'Team Member' : 'Equipment';
}

function normalizeStatus(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const normalized = text.toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (!VALID_STATUSES.has(normalized)) {
    throw new Error('status must be an approved team or equipment status');
  }
  return normalized;
}

function sanitizeText(value, maxLength = 120) {
  const text = normalizeText(value).replace(/\s+/g, ' ');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeDate(value) {
  return normalizeText(value) || null;
}

function sanitizeSummary(summary) {
  return {
    team_count: Number(summary?.team_count) || 0,
    equipment_count: Number(summary?.equipment_count) || 0,
    active_team: Number(summary?.active_team) || 0,
    operational_equipment: Number(summary?.operational_equipment) || 0,
    maintenance_equipment: Number(summary?.maintenance_equipment) || 0,
    broken_equipment: Number(summary?.broken_equipment) || 0,
  };
}

function isSafeShiftLabel(value) {
  if (value === null || value === undefined) return true;
  const text = normalizeText(value);
  if (!text) return true;
  const lower = normalizeLower(text);
  if ([
    'morning',
    'afternoon',
    'evening',
    'night',
    'day',
    'weekend',
    'weekday',
    'mon-fri',
    'monday-friday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
  ].includes(lower)) {
    return true;
  }
  if (/^shift:\s*[a-z0-9\s:-]{1,60}$/i.test(text)) return true;
  if (/^(mon|tue|wed|thu|fri|sat|sun)(day)?\s*-\s*(mon|tue|wed|thu|fri|sat|sun)(day)?$/i.test(text)) return true;
  return /^\d{1,2}(:\d{2})?\s*(AM|PM)\s*-\s*\d{1,2}(:\d{2})?\s*(AM|PM)$/i.test(text);
}

function sanitizeTeamItem(item) {
  const shiftLabel = sanitizeText(item.shift_label, 80);
  return {
    resource_id: item.resource_id || null,
    display_name: sanitizeText(item.display_name),
    role: sanitizeText(item.role),
    shift_label: isSafeShiftLabel(shiftLabel) ? shiftLabel : null,
    status: sanitizeText(item.status, 40),
    updated_date: sanitizeDate(item.updated_date),
  };
}

function sanitizeEquipmentItem(item) {
  return {
    resource_id: item.resource_id || null,
    equipment_name: sanitizeText(item.equipment_name),
    equipment_type: sanitizeText(item.equipment_type),
    equipment_status: sanitizeText(item.equipment_status, 40),
    last_service_date: sanitizeDate(item.last_service_date),
    updated_date: sanitizeDate(item.updated_date),
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
    let category;
    let status;
    let limit;

    try {
      category = normalizeCategory(body.category);
      status = normalizeStatus(body.status);
      limit = normalizeLimit(body.limit);
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const search = sanitizeText(body.search, 80) || '';

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub resources service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      limit: limit.toString(),
    });
    if (category) params.set('category', category);
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    const hubResponse = await fetch(`${hubBase}/functions/getResourcesSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    if (!hubResponse.ok) {
      return Response.json({
        error: 'Unable to load resources summary',
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (
      !hubData ||
      hubData.success !== true ||
      !hubData.sections ||
      !Array.isArray(hubData.sections.team) ||
      !Array.isArray(hubData.sections.equipment)
    ) {
      return Response.json({ error: 'Malformed resources summary response' }, { status: 502 });
    }

    const team = hubData.sections.team.map(sanitizeTeamItem).slice(0, limit);
    const equipment = hubData.sections.equipment.map(sanitizeEquipmentItem).slice(0, limit);
    const returnedCount = team.length + equipment.length;
    const upstreamCount = Number(hubData.count) || returnedCount;

    return Response.json({
      success: true,
      summary: sanitizeSummary(hubData.summary),
      count: returnedCount,
      truncated: hubData.truncated === true || returnedCount < upstreamCount,
      sections: {
        team,
        equipment,
      },
    });
  } catch (error) {
    console.error('[getAdminResourcesSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load resources summary' }, { status: 500 });
  }
});
