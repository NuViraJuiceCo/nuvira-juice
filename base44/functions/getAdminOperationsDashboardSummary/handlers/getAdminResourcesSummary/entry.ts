// @ts-nocheck
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';
import { handleAdminDataSummary } from './adminDataSummary.ts';

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

function matchesSearch(values, search) {
  if (!search) return true;
  const haystack = values.map(normalizeLower).join(' ');
  return haystack.includes(normalizeLower(search));
}

function matchesStatus(value, status) {
  if (!status) return true;
  return normalizeLower(value) === normalizeLower(status);
}

async function listEntity(base44, entityName, sort, limit = 500) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.list !== 'function') return [];
  return await entity.list(sort, limit).catch(error => {
    console.warn(`[getAdminResourcesSummary] Native ${entityName} unavailable:`, error.message);
    return [];
  });
}

function mapNativeTeam(users) {
  return (Array.isArray(users) ? users : [])
    .filter(user => ['admin', 'driver'].includes(normalizeLower(user?.role)))
    .map(user => sanitizeTeamItem({
      resource_id: `native_user_${user.id || [user.first_name, user.last_name, user.role].filter(Boolean).join('_')}`,
      display_name: [user.first_name, user.last_name].map(sanitizeText).filter(Boolean).join(' '),
      role: user.role || 'team member',
      shift_label: null,
      status: 'active',
      updated_date: user.updated_date || user.created_date || null,
    }))
    .filter(member => member.display_name);
}

function mapNativeEquipment({ productionBatches, inventoryItems }) {
  const equipment = new Map();
  for (const batch of Array.isArray(productionBatches) ? productionBatches : []) {
    for (const name of Array.isArray(batch?.equipment_used) ? batch.equipment_used : []) {
      const safeName = sanitizeText(name, 120);
      if (!safeName) continue;
      const key = normalizeLower(safeName);
      if (!equipment.has(key)) {
        equipment.set(key, sanitizeEquipmentItem({
          resource_id: `native_batch_equipment_${key.replace(/[^a-z0-9]+/g, '_')}`,
          equipment_name: safeName,
          equipment_type: 'Production equipment',
          equipment_status: 'operational',
          last_service_date: null,
          updated_date: batch.updated_date || batch.created_date || null,
        }));
      }
    }
  }

  for (const item of Array.isArray(inventoryItems) ? inventoryItems : []) {
    if (normalizeLower(item?.category) !== 'equipment') continue;
    const safeName = sanitizeText(item.ingredient, 120);
    if (!safeName) continue;
    const key = normalizeLower(safeName);
    if (!equipment.has(key)) {
      equipment.set(key, sanitizeEquipmentItem({
        resource_id: `native_inventory_equipment_${item.id || key.replace(/[^a-z0-9]+/g, '_')}`,
        equipment_name: safeName,
        equipment_type: 'Inventory equipment',
        equipment_status: Number(item.stock || 0) > 0 ? 'operational' : 'maintenance',
        last_service_date: null,
        updated_date: item.updated_date || item.created_date || null,
      }));
    }
  }
  return [...equipment.values()];
}

function applyNativeFilters({ team, equipment, category, status, search, limit }) {
  let filteredTeam = team;
  let filteredEquipment = equipment;

  if (category === 'Team Member') filteredEquipment = [];
  if (category === 'Equipment') filteredTeam = [];

  filteredTeam = filteredTeam
    .filter(member => matchesStatus(member.status, status))
    .filter(member => matchesSearch([member.display_name, member.role, member.shift_label, member.status], search));
  filteredEquipment = filteredEquipment
    .filter(item => matchesStatus(item.equipment_status, status))
    .filter(item => matchesSearch([item.equipment_name, item.equipment_type, item.equipment_status], search));

  return {
    team: filteredTeam.slice(0, limit),
    equipment: filteredEquipment.slice(0, limit),
    total_before_limit: filteredTeam.length + filteredEquipment.length,
  };
}

async function loadNativeResources(base44, { category, status, search, limit }) {
  const [users, productionBatches, inventoryItems] = await Promise.all([
    listEntity(base44, 'User', '-created_date'),
    listEntity(base44, 'ProductionBatch', '-production_date'),
    listEntity(base44, 'InventoryItem', 'ingredient'),
  ]);

  const team = mapNativeTeam(users);
  const equipment = mapNativeEquipment({
    productionBatches: productionBatches.filter(batch => batch?.is_test_batch !== true),
    inventoryItems,
  });
  const filtered = applyNativeFilters({ team, equipment, category, status, search, limit });
  const sections = {
    team: filtered.team,
    equipment: filtered.equipment,
  };
  const summary = sanitizeSummary({
    team_count: team.length,
    equipment_count: equipment.length,
    active_team: team.filter(member => normalizeLower(member.status) === 'active').length,
    operational_equipment: equipment.filter(item => normalizeLower(item.equipment_status) === 'operational').length,
    maintenance_equipment: equipment.filter(item => normalizeLower(item.equipment_status) === 'maintenance').length,
    broken_equipment: equipment.filter(item => normalizeLower(item.equipment_status) === 'broken').length,
  });

  return {
    summary,
    sections,
    count: sections.team.length + sections.equipment.length,
    truncated: filtered.total_before_limit > sections.team.length + sections.equipment.length,
  };
}

function nativeResourcesResponse(nativeResources) {
  return Response.json({
    success: true,
    source: 'customer_app_native_resources',
    summary: sanitizeSummary(nativeResources.summary),
    count: nativeResources.count,
    truncated: nativeResources.truncated === true,
    sections: {
      team: nativeResources.sections.team.map(sanitizeTeamItem),
      equipment: nativeResources.sections.equipment.map(sanitizeEquipmentItem),
    },
    warnings: [],
    data_sources: {
      hub_available: false,
      native_available: true,
      native_read_only: true,
      native_authoritative: true,
    },
  });
}

async function handleOperationalResourcesSummary(req: Request) {
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
    const loadNativeResourcesSummary = () => loadNativeResources(base44, {
      category,
      status,
      search,
      limit,
    });

    return nativeResourcesResponse(await loadNativeResourcesSummary());
  } catch (error) {
    console.error('[getAdminResourcesSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load resources summary' }, { status: 500 });
  }
}

export default async function handler(req: Request) {
  if (req.method === 'POST') {
    const body = await req.clone().json().catch(() => ({}));
    if (body?.resource) return handleAdminDataSummary(req);
  }
  return handleOperationalResourcesSummary(req);
}
