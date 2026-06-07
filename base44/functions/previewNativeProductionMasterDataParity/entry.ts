import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_MAX_ROWS = 120;
const HUB_FETCH_TIMEOUT_MS = 6000;
const MAX_BLOCKERS = 60;
const MAX_TEXT = 160;
const INVENTORY_SEED_POLICY = 'NON_STOCK_MASTER_DATA_ONLY';
const YIELD_POLICY = 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES';
const APPROVED_ALIAS_MAPPINGS = [
  {
    source_name: 'The NuVira Trio',
    source_type: 'bundle',
    target_type: 'bundle',
    target_hub_name: 'NuVira Trio',
    target_hub_id: '69e8f55b06e17fbd88dbbc0c',
    approval_phrase: 'APPROVE ALIAS The NuVira Trio -> NuVira Trio',
  },
];

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function normalizeKey(value) {
  return normalizeLower(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularKey(value) {
  return normalizeKey(value)
    .split(' ')
    .map(part => (part.length > 3 && part.endsWith('s') ? part.slice(0, -1) : part))
    .join(' ');
}

function matchKeys(value) {
  const exact = normalizeKey(value);
  const singular = singularKey(value);
  return [...new Set([exact, singular].filter(Boolean))];
}

function safeText(value, maxLength = MAX_TEXT) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted provider id]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted shopify id]');
  if (!text) return null;
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeId(value, maxLength = 180) {
  const text = safeText(value, maxLength);
  return text && /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPreviewSecret() {
  return Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET') ||
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET') ||
    Deno.env.get('HUB_SYNC_SECRET') ||
    '';
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    const body = JSON.parse(raw);
    return body && typeof body === 'object' && !Array.isArray(body)
      ? { ok: true, body }
      : { ok: false, body: null };
  } catch {
    return { ok: false, body: null };
  }
}

function unauthorized() {
  return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
}

function forbidden() {
  return Response.json({ success: false, error_code: 'forbidden', message: 'Admin access required' }, { status: 403 });
}

async function requirePreviewAccess({ base44, req, body }) {
  const headerSecret = normalizeText(req.headers.get('x-internal-secret'));
  const bodySecret = normalizeText(body?._internal_secret || body?.internal_secret);
  const providedSecret = headerSecret || bodySecret;
  const expectedSecret = getPreviewSecret();

  if (providedSecret) {
    return expectedSecret && providedSecret === expectedSecret
      ? { ok: true, actor_type: 'system', actor_role: 'service' }
      : { ok: false, response: unauthorized() };
  }

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: unauthorized() };
    if (user.role !== 'admin') return { ok: false, response: forbidden() };
    return { ok: true, actor_type: 'admin', actor_role: 'admin' };
  } catch {
    return { ok: false, response: unauthorized() };
  }
}

function getLookup(body) {
  return {
    orderId: normalizeText(body?.customer_app_order_id || body?.base44_order_id || body?.order_id),
    nativeOrderId: normalizeText(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id),
    taskId: normalizeText(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id),
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number || body?.number).replace(/^#/, ''),
    requestId: normalizeText(body?.request_id),
  };
}

function hasLookupOrLineItems(lookup, body) {
  return Boolean(lookup.orderId || lookup.nativeOrderId || lookup.taskId || lookup.orderNumber || Array.isArray(body?.line_items));
}

async function listEntity(base44, entityName, sort = '-created_date', limit = DEFAULT_MAX_ROWS) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.list !== 'function') return [];
  const rows = await entity.list(sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function filterEntity(base44, entityName, filter, sort = '-created_date', limit = 10) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity || typeof entity.filter !== 'function') return [];
  const rows = await entity.filter(filter, sort, limit).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function findCustomerOrder(base44, lookup) {
  const filters = [];
  if (lookup.orderId) filters.push({ id: lookup.orderId });
  if (lookup.orderNumber) {
    filters.push({ order_number: lookup.orderNumber });
    filters.push({ shopify_order_number: lookup.orderNumber });
  }
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'Order', filter, '-created_date', 5);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeShopifyOrder(base44, customerOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeText(customerOrder?.order_number || customerOrder?.shopify_order_number).replace(/^#/, '');
  const filters = [];
  if (lookup.nativeOrderId) {
    filters.push({ id: lookup.nativeOrderId });
    filters.push({ shopify_order_id: lookup.nativeOrderId });
  }
  if (customerOrder?.id) filters.push({ base44_order_id: customerOrder.id });
  if (orderNumber) filters.push({ shopify_order_number: orderNumber });
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'ShopifyOrder', filter, '-created_date', 5);
    if (rows.length > 0) return rows[0];
  }
  return null;
}

async function findNativeFulfillmentTask(base44, customerOrder, nativeOrder, lookup) {
  const orderNumber = lookup.orderNumber || normalizeText(nativeOrder?.shopify_order_number || customerOrder?.order_number).replace(/^#/, '');
  const filters = [];
  if (lookup.taskId) filters.push({ id: lookup.taskId });
  if (nativeOrder?.id) {
    filters.push({ native_shopify_order_id: nativeOrder.id });
    filters.push({ shopify_order_id: nativeOrder.id });
    filters.push({ order_id: nativeOrder.id });
  }
  if (customerOrder?.id) {
    filters.push({ base44_order_id: customerOrder.id });
    filters.push({ order_id: customerOrder.id });
  }
  if (orderNumber) {
    filters.push({ order_number: orderNumber });
    filters.push({ shopify_order_number: orderNumber });
  }
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'FulfillmentTask', filter, '-created_date', 10);
    if (rows.length > 0) return lookup.taskId ? rows.find(row => row.id === lookup.taskId) || null : rows[0];
  }
  return null;
}

function lineItemTitle(item) {
  return safeText(item?.title || item?.name || item?.product_title || item?.variant_title, 120);
}

function lineItemQuantity(item) {
  const parsed = Number(item?.quantity);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function safeLineItems({ body, customerOrder, nativeOrder, task }) {
  const candidates = [
    body?.line_items,
    nativeOrder?.line_items,
    nativeOrder?.items,
    task?.items,
    customerOrder?.line_items,
    customerOrder?.items,
  ];
  for (const value of candidates) {
    if (Array.isArray(value) && value.length > 0) {
      return value.slice(0, DEFAULT_MAX_ROWS).map(item => ({
        title: lineItemTitle(item),
        quantity: lineItemQuantity(item),
        sku: safeText(item?.sku || item?.product_sku, 80),
      })).filter(item => item.title && item.quantity > 0);
    }
  }
  return [];
}

function addToIndex(index, value, row) {
  for (const key of matchKeys(value)) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(row);
  }
}

function buildIndex(rows, nameSelector) {
  const index = new Map();
  for (const row of rows || []) addToIndex(index, nameSelector(row), row);
  return index;
}

function findMatches(index, name) {
  for (const key of matchKeys(name)) {
    const matches = index.get(key) || [];
    if (matches.length > 0) return matches;
  }
  return [];
}

function statusForMatches(matches) {
  if (!matches || matches.length === 0) return 'missing';
  if (matches.length > 1) return 'ambiguous';
  return 'matched';
}

function firstHubMatch(rows, name) {
  const normalized = normalizeKey(name);
  const row = (rows || []).find(item => item.normalized_name === normalized || normalizeKey(item.requested_name) === normalized);
  return row || { requested_name: safeText(name, 120), normalized_name: normalized, status: 'missing', count: 0, matches: [] };
}

function schemaCompatibleForType(type, record) {
  if (!record) return { status: 'missing', blockers: ['hub_record_missing'] };
  if (record.field_compatibility_status && record.field_compatibility_status !== 'compatible') {
    return { status: record.field_compatibility_status, blockers: record.incompatibilities || ['schema_gap'] };
  }
  if (type === 'recipe') {
    return record.name && Array.isArray(record.ingredients) ? { status: 'compatible', blockers: [] } : { status: 'schema_gap', blockers: ['recipe_field_shape_incompatible'] };
  }
  if (type === 'bundle') {
    return record.name && Array.isArray(record.components) ? { status: 'compatible', blockers: [] } : { status: 'schema_gap', blockers: ['bundle_field_shape_incompatible'] };
  }
  if (type === 'inventory') {
    return record.name && record.unit && numberOrNull(record.stock) !== null && numberOrNull(record.reorder_point) !== null
      ? { status: 'compatible', blockers: [] }
      : { status: 'schema_gap', blockers: ['inventory_field_shape_incompatible'] };
  }
  if (type === 'yield') {
    return record.name && record.purchase_unit && numberOrNull(record.oz_per_purchase_unit) !== null
      ? { status: 'compatible', blockers: [] }
      : { status: 'schema_gap', blockers: ['yield_field_shape_incompatible'] };
  }
  return { status: 'unknown_type', blockers: ['unknown_master_data_type'] };
}

function sourceLooksLikeBundle(name) {
  return /\b(bundle|pack|trio|cleanse|program|set)\b/i.test(normalizeText(name));
}

function compactNames(names) {
  return [...new Set((names || []).map(name => safeText(name, 120)).filter(Boolean))].slice(0, DEFAULT_MAX_ROWS);
}

async function fetchHubMasterDataParity(names) {
  const hubApiUrl = normalizeText(Deno.env.get('HUB_API_URL'));
  const secret = normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET'));
  if (!hubApiUrl || !secret) {
    return { ok: false, error_code: 'hub_master_data_config_missing', message: 'HUB_API_URL or CUSTOMER_APP_SYNC_SECRET is not configured.' };
  }
  const hubBase = hubApiUrl.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
  const url = `${hubBase}/api/functions/getProductionMasterDataParityForCustomerApp?names=${encodeURIComponent(JSON.stringify(compactNames(names)))}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HUB_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${secret}` },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      return {
        ok: false,
        error_code: data?.error_code || `hub_master_data_http_${response.status}`,
        message: safeText(data?.message || data?.error || 'Hub master data parity lookup failed.', 180),
        status: response.status,
      };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error_code: 'hub_master_data_fetch_failed', message: safeText(error?.message || 'Hub master data parity lookup failed.', 180) };
  } finally {
    clearTimeout(timeout);
  }
}

function hubMatchForType(hubData, type, name) {
  if (!hubData) return { requested_name: safeText(name, 120), normalized_name: normalizeKey(name), status: 'missing', count: 0, matches: [] };
  if (type === 'bundle') return firstHubMatch(hubData.bundle_matches, name);
  if (type === 'recipe') {
    const direct = firstHubMatch(hubData.recipe_matches, name);
    if (direct.status !== 'missing') return direct;
    return firstHubMatch(hubData.component_recipe_matches, name);
  }
  if (type === 'inventory') return firstHubMatch(hubData.inventory_matches, name);
  if (type === 'yield') return firstHubMatch(hubData.yield_matches, name);
  return { requested_name: safeText(name, 120), normalized_name: normalizeKey(name), status: 'missing', count: 0, matches: [] };
}

function firstCandidateFromRows(rows, type, name, candidateTypes = []) {
  const key = normalizeKey(name);
  const candidates = (rows || [])
    .filter(row => row?.required_type === type && normalizeKey(row?.requested_name) === key)
    .filter(row => candidateTypes.length === 0 || candidateTypes.includes(row?.candidate_type))
    .flatMap(row => (row?.candidates || []).map(candidate => ({
      ...candidate,
      requested_name: row.requested_name,
      required_type: row.required_type,
      candidate_type: row.candidate_type,
      status: row.status,
    })))
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
  return candidates[0] || null;
}

function productMatchForName(hubData, name) {
  const row = firstHubMatch(hubData?.product_matches || [], name);
  if (row.status === 'matched') {
    return {
      confidence: 1,
      match_kind: 'exact_product_catalog_match',
      required_type: 'bundle',
      candidate_type: 'product',
      candidate: row.matches?.[0],
    };
  }
  return firstCandidateFromRows(hubData?.product_alias_candidates || hubData?.alias_candidate_rows, 'bundle', name, ['product']);
}

function aliasCandidateForRow(hubData, row) {
  if (!hubData || !row) return null;
  if (row.required_type === 'bundle') {
    return firstCandidateFromRows(hubData.bundle_alias_candidates || hubData.alias_candidate_rows, 'bundle', row.required_name, ['bundle']) ||
      productMatchForName(hubData, row.required_name);
  }
  if (row.required_type === 'recipe') {
    return firstCandidateFromRows(hubData.recipe_alias_candidates || hubData.alias_candidate_rows, 'recipe', row.required_name, ['recipe']);
  }
  if (row.required_type === 'inventory') {
    return firstCandidateFromRows(hubData.inventory_alias_candidates || hubData.alias_candidate_rows, 'inventory', row.required_name, ['inventory']);
  }
  if (row.required_type === 'yield') {
    return firstCandidateFromRows(hubData.yield_alias_candidates || hubData.alias_candidate_rows, 'yield', row.required_name, ['yield']);
  }
  return null;
}

function hubRecordForRequiredRow(hubData, row) {
  const match = hubMatchForType(hubData, row.required_type, row.required_name);
  return match?.status === 'matched' ? match.matches?.[0] || null : null;
}

function approvedAliasMappingForRow(row, hubData) {
  if (!row || row.required_type !== 'bundle') return null;
  if (!hubData) return null;
  const mapping = APPROVED_ALIAS_MAPPINGS.find(item =>
    item.source_type === row.required_type &&
    normalizeKey(item.source_name) === normalizeKey(row.required_name)
  );
  if (!mapping) return null;
  const directHubMatch = hubMatchForType(hubData, row.required_type, row.required_name);
  if (directHubMatch.status === 'ambiguous') return null;
  if (directHubMatch.status === 'matched') {
    const directRecord = directHubMatch.matches?.[0] || null;
    const directId = safeId(directRecord?.id);
    const directName = safeText(directRecord?.name, 120);
    if (directId !== mapping.target_hub_id && normalizeKey(directName) !== normalizeKey(mapping.target_hub_name)) {
      return null;
    }
  }
  const candidate = aliasCandidateForRow(hubData, row);
  const candidateRecord = candidate?.candidate || null;
  const candidateId = safeId(candidateRecord?.id);
  const candidateName = safeText(candidateRecord?.name, 120);
  if (candidateRecord && candidateId !== mapping.target_hub_id && normalizeKey(candidateName) !== normalizeKey(mapping.target_hub_name)) {
    return null;
  }
  return {
    ...mapping,
    candidate: candidateRecord || {
      id: mapping.target_hub_id,
      name: mapping.target_hub_name,
    },
    alias_confidence: numberOrNull(candidate?.confidence) ?? 0.9,
    alias_match_kind: candidate?.match_kind || 'owner_approved_alias',
  };
}

function isMissingYieldRow(row) {
  return row?.required_type === 'yield' && (row.blockers || []).some(blocker => blocker.startsWith('missing_hub_yield'));
}

function applyApprovedPoliciesToRequiredRow(row, hubData) {
  if (!row) return row;
  let blockers = [...(row.blockers || [])];
  const warnings = [...(row.warnings || [])];
  const policy = {};
  let nextRow = { ...row };

  const approvedAlias = approvedAliasMappingForRow(row, hubData);
  if (approvedAlias) {
    blockers = blockers.filter(blocker => !blocker.startsWith('missing_hub_bundle'));
    warnings.push('approved_alias_mapping_applied');
    policy.approved_alias_mapping = {
      source_name: approvedAlias.source_name,
      source_type: approvedAlias.source_type,
      target_type: approvedAlias.target_type,
      target_hub_name: approvedAlias.target_hub_name,
      target_hub_id: approvedAlias.target_hub_id,
      approval_phrase: approvedAlias.approval_phrase,
    };
    nextRow = {
      ...nextRow,
      hub_match_status: 'approved_alias',
      hub_id: approvedAlias.target_hub_id,
      hub_name: approvedAlias.target_hub_name,
      field_compatibility_status: 'approved_alias_mapping',
      mirror_readiness: 'ready_to_mirror_via_approved_alias',
    };
  }

  if (isMissingYieldRow(row)) {
    blockers = blockers.filter(blocker => !blocker.startsWith('missing_hub_yield'));
    warnings.push('yield_details_pending');
    warnings.push('procurement_conversion_pending');
    warnings.push('inventory_deduction_held_pending_yield_policy');
    warnings.push('purchase_order_automation_held_pending_yield_policy');
    policy.yield_policy = YIELD_POLICY;
    nextRow = {
      ...nextRow,
      field_compatibility_status: 'deferred_yield_details',
      mirror_readiness: 'yield_details_deferred',
    };
  }

  if (row.required_type === 'inventory' && row.mirror_readiness?.startsWith('ready_to_mirror')) {
    warnings.push('inventory_seed_policy_non_stock_master_data_only');
    warnings.push('stock_seeded_or_kept_zero_for_make_to_order');
    warnings.push('inventory_deduction_held_pending_stock_yield_policy');
    policy.inventory_seed_policy = INVENTORY_SEED_POLICY;
    nextRow = {
      ...nextRow,
      mirror_readiness: 'ready_to_mirror_non_stock_master_data',
    };
  }

  return {
    ...nextRow,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    ...policy,
  };
}

function seedPreviewPayload(type, sourceRecord) {
  if (!sourceRecord) return null;
  if (type === 'bundle') {
    return {
      bundle_name: safeText(sourceRecord.name, 120),
      component_count: Array.isArray(sourceRecord.components) ? sourceRecord.components.length : 0,
      components: (sourceRecord.components || []).slice(0, DEFAULT_MAX_ROWS).map(component => ({
        product_name: safeText(component?.product_name, 120),
        quantity: numberOrNull(component?.quantity),
      })).filter(component => component.product_name),
      fulfillment_count: numberOrNull(sourceRecord.fulfillment_count),
      is_active: sourceRecord.is_active !== false,
    };
  }
  if (type === 'recipe') {
    return {
      product_name: safeText(sourceRecord.name, 120),
      product_sku: safeText(sourceRecord.product_sku, 80),
      bottle_size_oz: numberOrNull(sourceRecord.bottle_size_oz),
      yield_factor: numberOrNull(sourceRecord.yield_factor),
      ingredient_count: Array.isArray(sourceRecord.ingredients) ? sourceRecord.ingredients.length : 0,
      ingredients: (sourceRecord.ingredients || []).slice(0, DEFAULT_MAX_ROWS).map(ingredient => ({
        ingredient_name: safeText(ingredient?.ingredient_name, 120),
        quantity_oz: numberOrNull(ingredient?.quantity_oz),
        unit: safeText(ingredient?.unit, 40),
      })).filter(ingredient => ingredient.ingredient_name),
      is_active: sourceRecord.is_active !== false,
    };
  }
  if (type === 'inventory') {
    return {
      ingredient: safeText(sourceRecord.name, 120),
      unit: safeText(sourceRecord.unit, 40),
      category: safeText(sourceRecord.category, 80),
      supplier: safeText(sourceRecord.supplier, 120),
      stock: numberOrNull(sourceRecord.stock),
      reorder_point: numberOrNull(sourceRecord.reorder_point),
      max_stock: numberOrNull(sourceRecord.max_stock),
      supplier_packaging_unit: safeText(sourceRecord.supplier_packaging_unit, 40),
      supplier_packaging_qty: safeText(sourceRecord.supplier_packaging_qty, 80),
      stock_is_live_state: true,
    };
  }
  if (type === 'yield') {
    return {
      ingredient_name: safeText(sourceRecord.name, 120),
      purchase_unit: safeText(sourceRecord.purchase_unit, 40),
      oz_per_purchase_unit: numberOrNull(sourceRecord.oz_per_purchase_unit),
      trim_waste_factor: numberOrNull(sourceRecord.trim_waste_factor),
      units_per_case: numberOrNull(sourceRecord.units_per_case),
      split_case_allowed: sourceRecord.split_case_allowed === true,
      rounding_rule: safeText(sourceRecord.rounding_rule, 80),
      supplier: safeText(sourceRecord.supplier, 120),
    };
  }
  return null;
}

function ownerInputFieldsForRow(row) {
  if (row?.required_type === 'yield') {
    return ['ingredient_name', 'purchase_unit', 'oz_per_purchase_unit', 'trim_waste_factor', 'units_per_case', 'rounding_rule'];
  }
  if (row?.required_type === 'bundle') {
    return ['bundle_name', 'components.product_name', 'components.quantity', 'fulfillment_count'];
  }
  return [];
}

function buildSeedPacketRow({ row, hubData }) {
  const hubRecord = hubRecordForRequiredRow(hubData, row);
  const aliasCandidate = aliasCandidateForRow(hubData, row);
  const base = {
    source_line_item: row.source_line_item,
    entity_type: row.required_type,
    customer_app_target_name: row.required_name,
    normalized_name: row.normalized_name,
    native_present: row.native_present,
    hub_match_status: row.hub_match_status,
    field_compatibility_status: row.field_compatibility_status,
    blockers: row.blockers || [],
    warnings: row.warnings || [],
  };

  if (row.native_present) {
    return {
      ...base,
      status: 'already_native',
      proposed_action: 'already_native_no_seed',
      seed_ready: false,
    };
  }

  if (row.mirror_readiness?.startsWith('ready_to_mirror') && hubRecord) {
    if (row.required_type === 'inventory') {
      const payload = seedPreviewPayload(row.required_type, hubRecord) || {};
      return {
        ...base,
        status: 'mirror_ready_non_stock_master_data',
        proposed_action: 'mirror_hub_inventory_item_non_stock_metadata_seed_zero_stock',
        seed_ready: true,
        hub_source_id: safeId(hubRecord.id),
        hub_source_name: safeText(hubRecord.name, 120),
        seed_payload_preview: {
          ...payload,
          inventory_seed_policy: INVENTORY_SEED_POLICY,
          stock_seed_quantity: 0,
          hub_stock_not_authoritative_for_customer_app: true,
        },
        inventory_seed_policy: INVENTORY_SEED_POLICY,
        inventory_deduction_ready: false,
        warnings: [...new Set([...(row.warnings || []), 'inventory_deduction_held_pending_stock_yield_policy'])],
      };
    }
    return {
      ...base,
      status: 'mirror_ready',
      proposed_action: `mirror_hub_${row.required_type}`,
      seed_ready: true,
      hub_source_id: safeId(hubRecord.id),
      hub_source_name: safeText(hubRecord.name, 120),
      seed_payload_preview: seedPreviewPayload(row.required_type, hubRecord),
      warnings: row.warnings || [],
    };
  }

  const approvedAlias = approvedAliasMappingForRow(row, hubData);
  if (approvedAlias) {
    const candidate = approvedAlias.candidate || {};
    return {
      ...base,
      status: 'approved_alias_mapping',
      proposed_action: 'apply_approved_bundle_alias_mapping',
      seed_ready: true,
      hub_source_id: approvedAlias.target_hub_id,
      hub_source_name: approvedAlias.target_hub_name,
      alias_candidate_type: approvedAlias.target_type,
      alias_match_kind: approvedAlias.alias_match_kind,
      alias_confidence: approvedAlias.alias_confidence,
      alias_candidate_preview: seedPreviewPayload('bundle', candidate) || {
        name: approvedAlias.target_hub_name,
        id: approvedAlias.target_hub_id,
      },
      approved_alias_mapping: {
        source_name: approvedAlias.source_name,
        source_type: approvedAlias.source_type,
        target_type: approvedAlias.target_type,
        target_hub_name: approvedAlias.target_hub_name,
        target_hub_id: approvedAlias.target_hub_id,
        approval_phrase: approvedAlias.approval_phrase,
      },
      warnings: [...new Set([...(row.warnings || []), 'approved_alias_mapping_applied'])],
    };
  }

  if (row.required_type === 'yield' && row.mirror_readiness === 'yield_details_deferred') {
    return {
      ...base,
      status: 'yield_details_deferred',
      proposed_action: 'defer_purchase_conversion_values',
      seed_ready: true,
      yield_policy: YIELD_POLICY,
      procurement_conversion_ready: false,
      inventory_deduction_ready: false,
      purchase_order_automation_ready: false,
      warnings: [...new Set([...(row.warnings || []), 'yield_details_pending', 'procurement_conversion_pending'])],
    };
  }

  if (aliasCandidate?.candidate && row.required_type !== 'yield') {
    const candidate = aliasCandidate.candidate;
    const candidateType = aliasCandidate.candidate_type || row.required_type;
    return {
      ...base,
      status: 'manual_mapping_required',
      proposed_action: candidateType === 'product' && row.required_type === 'bundle'
        ? 'product_catalog_candidate_requires_manual_bundle_mapping'
        : `alias_existing_hub_${candidateType}`,
      seed_ready: false,
      hub_source_id: safeId(candidate.id),
      hub_source_name: safeText(candidate.name, 120),
      alias_candidate_type: candidateType,
      alias_match_kind: aliasCandidate.match_kind,
      alias_confidence: numberOrNull(aliasCandidate.confidence),
      alias_candidate_preview: seedPreviewPayload(candidateType === 'product' ? 'product' : row.required_type, candidate) || {
        name: safeText(candidate.name, 120),
        category: safeText(candidate.category, 80),
      },
      owner_input_fields_required: candidateType === 'product' && row.required_type === 'bundle' ? ownerInputFieldsForRow(row) : [],
      warnings: [
        ...(row.warnings || []),
        candidateType === 'product' && row.required_type === 'bundle'
          ? 'product_catalog_candidate_is_not_bundle_master_data'
          : 'alias_requires_explicit_mapping_approval',
      ],
    };
  }

  if ((row.blockers || []).some(blocker => blocker.startsWith('missing_hub_yield'))) {
    return {
      ...base,
      status: 'yield_details_deferred',
      proposed_action: 'defer_purchase_conversion_values',
      seed_ready: true,
      yield_policy: YIELD_POLICY,
      procurement_conversion_ready: false,
      inventory_deduction_ready: false,
      purchase_order_automation_ready: false,
      warnings: [...new Set([...(row.warnings || []), 'yield_details_pending', 'procurement_conversion_pending'])],
    };
  }

  if ((row.blockers || []).some(blocker => blocker.startsWith('missing_hub'))) {
    return {
      ...base,
      status: 'hub_missing',
      proposed_action: `cannot_seed_missing_hub_${row.required_type}`,
      seed_ready: false,
      owner_input_fields_required: ownerInputFieldsForRow(row),
    };
  }

  if ((row.blockers || []).some(blocker => blocker.startsWith('ambiguous_hub') || blocker.startsWith('ambiguous_native'))) {
    return {
      ...base,
      status: 'manual_mapping_required',
      proposed_action: 'resolve_ambiguous_master_data_mapping',
      seed_ready: false,
    };
  }

  return {
    ...base,
    status: 'blocked',
    proposed_action: 'hold',
    seed_ready: false,
  };
}

function buildMasterDataGapClosurePreview({ requiredRows, hubData, hubResult }) {
  const policyAdjustedRows = (requiredRows || []).map(row => applyApprovedPoliciesToRequiredRow(row, hubData));
  const seedPacketRows = policyAdjustedRows.map(row => buildSeedPacketRow({ row, hubData }));
  const blockedRows = seedPacketRows.filter(row => row.status === 'blocked' || row.status === 'hub_missing');
  const manualMappingRows = seedPacketRows.filter(row => row.status === 'manual_mapping_required');
  const ownerInputRows = seedPacketRows.filter(row => row.status === 'owner_input_required' || (row.owner_input_fields_required || []).length > 0);
  const hubMissingRows = seedPacketRows.filter(row => row.status === 'hub_missing' || row.status === 'owner_input_required');
  const aliasRows = seedPacketRows.filter(row => row.alias_candidate_type || row.approved_alias_mapping);
  const pendingYieldRows = seedPacketRows.filter(row => row.status === 'yield_details_deferred');
  const mirrorReadyRows = seedPacketRows.filter(row => [
    'mirror_ready',
    'mirror_ready_non_stock_master_data',
    'approved_alias_mapping',
    'yield_details_deferred',
  ].includes(row.status));
  const blockers = [
    ...blockedRows.map(row => `${row.status}:${row.entity_type}:${row.customer_app_target_name}`),
    ...ownerInputRows.map(row => `owner_input_required:${row.entity_type}:${row.customer_app_target_name}`),
    ...manualMappingRows.map(row => `manual_mapping_required:${row.entity_type}:${row.customer_app_target_name}`),
    ...(!hubResult.ok ? [hubResult.error_code || 'hub_lookup_unavailable'] : []),
  ].filter(Boolean);
  const warnings = [
    ...new Set(seedPacketRows.flatMap(row => row.warnings || [])),
    ...(pendingYieldRows.length > 0 ? ['yield_details_pending', 'procurement_conversion_pending'] : []),
    'inventory_deduction_held_pending_stock_yield_policy',
    'purchase_order_automation_held_pending_yield_policy',
  ];

  const productionMasterDataReady = policyAdjustedRows.length > 0 && blockers.length === 0;
  const nonStockMasterDataSeedReady = productionMasterDataReady && seedPacketRows.every(row => [
    'mirror_ready',
    'mirror_ready_non_stock_master_data',
    'approved_alias_mapping',
    'yield_details_deferred',
    'already_native',
  ].includes(row.status));
  const procurementConversionReady = pendingYieldRows.length === 0 && seedPacketRows
    .filter(row => row.entity_type === 'yield')
    .every(row => row.status === 'mirror_ready' || row.status === 'already_native');
  const inventoryDeductionReady = false;

  let nextAction = 'hold';
  if (!hubResult.ok) nextAction = 'hold';
  else if (blockers.length > 0) nextAction = 'patch_remaining_master_data_blockers';
  else if (pendingYieldRows.length > 0) nextAction = 'ready_with_deferred_yield_details';
  else if (nonStockMasterDataSeedReady) nextAction = 'ready_for_non_stock_master_data_mirror';

  const nonStockImportPreview = buildCustomerAppNonStockMirrorImportPreview(seedPacketRows);

  return {
    required_rows: policyAdjustedRows.length,
    mirror_ready_row_count: mirrorReadyRows.length,
    seed_packet_ready: nonStockMasterDataSeedReady,
    non_stock_import_preview_ready: nonStockImportPreview.import_ready,
    non_stock_master_data_seed_ready: nonStockMasterDataSeedReady,
    production_master_data_ready: productionMasterDataReady,
    procurement_conversion_ready: procurementConversionReady,
    inventory_deduction_ready: inventoryDeductionReady,
    yield_details_pending: pendingYieldRows.length > 0,
    pending_yield_items: compactNames(pendingYieldRows.map(row => row.customer_app_target_name)),
    approved_alias_mappings: APPROVED_ALIAS_MAPPINGS.map(mapping => ({ ...mapping })),
    inventory_seed_policy: INVENTORY_SEED_POLICY,
    yield_policy: YIELD_POLICY,
    seed_packet_rows: seedPacketRows.slice(0, DEFAULT_MAX_ROWS),
    blocked_rows: blockedRows.slice(0, DEFAULT_MAX_ROWS),
    manual_mapping_required_rows: manualMappingRows.slice(0, DEFAULT_MAX_ROWS),
    owner_input_required_rows: ownerInputRows.slice(0, DEFAULT_MAX_ROWS),
    hub_missing_rows: hubMissingRows.slice(0, DEFAULT_MAX_ROWS),
    alias_candidate_rows: aliasRows.slice(0, DEFAULT_MAX_ROWS),
    customer_app_non_stock_master_data_import_preview: nonStockImportPreview,
    blockers: [...new Set(blockers)].slice(0, MAX_BLOCKERS),
    warnings: [...new Set(warnings)].slice(0, MAX_BLOCKERS),
    next_action: nextAction,
    policy_adjusted_required_rows: policyAdjustedRows.slice(0, DEFAULT_MAX_ROWS),
    master_data_gap_closure_preview: {
      dry_run: true,
      writes_performed: false,
      seed_packet_ready: nonStockMasterDataSeedReady,
      non_stock_import_preview_ready: nonStockImportPreview.import_ready,
      non_stock_master_data_seed_ready: nonStockMasterDataSeedReady,
      production_master_data_ready: productionMasterDataReady,
      procurement_conversion_ready: procurementConversionReady,
      inventory_deduction_ready: inventoryDeductionReady,
      yield_details_pending: pendingYieldRows.length > 0,
      pending_yield_items: compactNames(pendingYieldRows.map(row => row.customer_app_target_name)),
      approved_alias_mappings: APPROVED_ALIAS_MAPPINGS.map(mapping => ({ ...mapping })),
      inventory_seed_policy: INVENTORY_SEED_POLICY,
      yield_policy: YIELD_POLICY,
      next_action: nextAction,
      required_rows: policyAdjustedRows.length,
      mirror_ready_rows: mirrorReadyRows.length,
      blocked_rows: blockedRows.length,
      manual_mapping_required_rows: manualMappingRows.length,
      owner_input_required_rows: ownerInputRows.length,
      hub_missing_rows: hubMissingRows.length,
      alias_candidate_rows: aliasRows.length,
      non_stock_import_create_rows: nonStockImportPreview.create_rows.length,
      non_stock_import_deferred_rows: nonStockImportPreview.deferred_rows.length,
      non_stock_import_blockers: nonStockImportPreview.blockers.length,
      inventory_stock_seed_policy_required: false,
    },
  };
}

function cleanObject(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => cleanObject(item))
      .filter(item => item !== null && item !== undefined && !(typeof item === 'object' && !Array.isArray(item) && Object.keys(item).length === 0));
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const cleaned = cleanObject(item);
    if (cleaned === null || cleaned === undefined || cleaned === '') continue;
    if (Array.isArray(cleaned) && cleaned.length === 0) {
      out[key] = cleaned;
      continue;
    }
    if (typeof cleaned === 'object' && !Array.isArray(cleaned) && Object.keys(cleaned).length === 0) continue;
    out[key] = cleaned;
  }
  return out;
}

function importMatchKey(entityName, value) {
  return `${entityName}:${normalizeKey(value) || 'unknown'}`;
}

function schemaSafeRecipePayload(row) {
  const source = row?.seed_payload_preview || {};
  return cleanObject({
    product_name: safeText(row?.customer_app_target_name || source.product_name, 120),
    product_sku: safeText(source.product_sku, 80),
    bottle_size_oz: numberOrNull(source.bottle_size_oz),
    yield_factor: numberOrNull(source.yield_factor),
    ingredients: (source.ingredients || []).slice(0, DEFAULT_MAX_ROWS).map(ingredient => cleanObject({
      ingredient_name: safeText(ingredient?.ingredient_name, 120),
      quantity_oz: numberOrNull(ingredient?.quantity_oz),
      unit: safeText(ingredient?.unit, 40),
    })).filter(ingredient => ingredient.ingredient_name),
    is_active: source.is_active !== false,
  });
}

function schemaSafeBundlePayload(row) {
  const source = row?.seed_payload_preview || row?.alias_candidate_preview || {};
  const approvedAlias = row?.approved_alias_mapping;
  return cleanObject({
    bundle_name: safeText(row?.customer_app_target_name || source.bundle_name || source.name, 120),
    components: (source.components || []).slice(0, DEFAULT_MAX_ROWS).map(component => cleanObject({
      product_name: safeText(component?.product_name, 120),
      quantity: numberOrNull(component?.quantity),
    })).filter(component => component.product_name),
    fulfillment_count: numberOrNull(source.fulfillment_count),
    is_active: source.is_active !== false,
    notes: approvedAlias
      ? safeText(`Mirrored from Hub Bundle "${approvedAlias.target_hub_name}" via owner-approved alias "${approvedAlias.source_name}".`, 240)
      : null,
  });
}

function schemaSafeInventoryPayload(row) {
  const source = row?.seed_payload_preview || {};
  const stockSeed = numberOrNull(source.stock_seed_quantity) ?? 0;
  return cleanObject({
    ingredient: safeText(row?.customer_app_target_name || source.ingredient, 120),
    unit: safeText(source.unit, 40),
    stock: stockSeed,
    reorder_point: numberOrNull(source.reorder_point),
    max_stock: numberOrNull(source.max_stock),
    supplier: safeText(source.supplier, 120),
    supplier_packaging_unit: safeText(source.supplier_packaging_unit, 40),
    supplier_packaging_qty: safeText(source.supplier_packaging_qty, 80),
    category: safeText(source.category, 80),
    notes: 'Seeded under NON_STOCK_MASTER_DATA_ONLY. Hub stock was not mirrored as authoritative.',
  });
}

function schemaSafeYieldPayload(row) {
  const source = row?.seed_payload_preview || {};
  return cleanObject({
    ingredient_name: safeText(row?.customer_app_target_name || source.ingredient_name, 120),
    purchase_unit: safeText(source.purchase_unit, 40),
    oz_per_purchase_unit: numberOrNull(source.oz_per_purchase_unit),
    trim_waste_factor: numberOrNull(source.trim_waste_factor),
    units_per_case: numberOrNull(source.units_per_case),
    split_case_allowed: source.split_case_allowed === true,
    rounding_rule: safeText(source.rounding_rule, 80),
    supplier: safeText(source.supplier, 120),
  });
}

function validateImportPayload(entityName, payload) {
  const blockers = [];
  if (entityName === 'Recipe') {
    if (!payload.product_name) blockers.push('recipe_product_name_required');
    if (!Array.isArray(payload.ingredients)) blockers.push('recipe_ingredients_array_required');
  } else if (entityName === 'Bundle') {
    if (!payload.bundle_name) blockers.push('bundle_name_required');
    if (!Array.isArray(payload.components)) blockers.push('bundle_components_array_required');
    if (Array.isArray(payload.components) && payload.components.length === 0) blockers.push('bundle_components_required');
  } else if (entityName === 'InventoryItem') {
    if (!payload.ingredient) blockers.push('inventory_ingredient_required');
    if (!payload.unit) blockers.push('inventory_unit_required');
    if (numberOrNull(payload.stock) === null) blockers.push('inventory_stock_number_required');
    if (numberOrNull(payload.reorder_point) === null) blockers.push('inventory_reorder_point_number_required');
  } else if (entityName === 'IngredientYield') {
    if (!payload.ingredient_name) blockers.push('yield_ingredient_name_required');
    if (!payload.purchase_unit) blockers.push('yield_purchase_unit_required');
    if (numberOrNull(payload.oz_per_purchase_unit) === null) blockers.push('yield_oz_per_purchase_unit_number_required');
  } else {
    blockers.push('unsupported_customer_app_master_data_entity');
  }
  return blockers;
}

function buildImportCreateRow(row, entityName, payload, proposedAction) {
  const validationBlockers = validateImportPayload(entityName, payload);
  const name = payload.product_name || payload.bundle_name || payload.ingredient || payload.ingredient_name || row?.customer_app_target_name;
  return {
    target_entity: entityName,
    operation: 'create_if_missing',
    proposed_action: proposedAction,
    match_key: importMatchKey(entityName, name),
    match_field: entityName === 'Recipe'
      ? 'product_name'
      : entityName === 'Bundle'
        ? 'bundle_name'
        : entityName === 'InventoryItem'
          ? 'ingredient'
          : 'ingredient_name',
    match_value: safeText(name, 120),
    source_line_item: row?.source_line_item,
    source_entity_type: row?.entity_type,
    source_hub_id: safeId(row?.hub_source_id),
    source_hub_name: safeText(row?.hub_source_name, 120),
    approved_alias_mapping: row?.approved_alias_mapping || null,
    import_ready: validationBlockers.length === 0,
    blockers: validationBlockers,
    warnings: row?.warnings || [],
    payload,
  };
}

function buildCustomerAppNonStockMirrorImportPreview(seedPacketRows) {
  const createRows = [];
  const skippedRows = [];
  const deferredRows = [];
  const blockedRows = [];
  const warnings = [
    'preview_only_no_master_data_import_performed',
    'hub_bridge_remains_fallback',
    'inventory_stock_seeded_or_kept_zero',
    'inventory_deduction_held',
    'purchase_order_automation_held',
  ];

  for (const row of seedPacketRows || []) {
    if (row.status === 'already_native') {
      skippedRows.push({
        target_entity: row.entity_type,
        match_value: row.customer_app_target_name,
        reason: 'already_native_no_seed',
      });
      continue;
    }

    if (row.status === 'yield_details_deferred') {
      deferredRows.push({
        target_entity: 'IngredientYield',
        match_value: row.customer_app_target_name,
        reason: 'yield_details_deferred_by_policy',
        yield_policy: YIELD_POLICY,
        procurement_conversion_ready: false,
        inventory_deduction_ready: false,
        purchase_order_automation_ready: false,
        warnings: [...new Set([...(row.warnings || []), 'yield_details_pending'])],
      });
      continue;
    }

    if (row.entity_type === 'recipe' && row.status === 'mirror_ready') {
      createRows.push(buildImportCreateRow(row, 'Recipe', schemaSafeRecipePayload(row), 'create_customer_app_recipe_from_hub_master_data'));
      continue;
    }

    if (row.entity_type === 'bundle' && ['mirror_ready', 'approved_alias_mapping'].includes(row.status)) {
      createRows.push(buildImportCreateRow(row, 'Bundle', schemaSafeBundlePayload(row), row.status === 'approved_alias_mapping'
        ? 'create_customer_app_bundle_from_approved_alias'
        : 'create_customer_app_bundle_from_hub_master_data'));
      continue;
    }

    if (row.entity_type === 'inventory' && row.status === 'mirror_ready_non_stock_master_data') {
      createRows.push(buildImportCreateRow(row, 'InventoryItem', schemaSafeInventoryPayload(row), 'create_customer_app_inventory_item_non_stock_seed_zero_stock'));
      continue;
    }

    if (row.entity_type === 'yield' && row.status === 'mirror_ready') {
      createRows.push(buildImportCreateRow(row, 'IngredientYield', schemaSafeYieldPayload(row), 'create_customer_app_ingredient_yield_from_hub_exact_values'));
      continue;
    }

    blockedRows.push({
      target_entity: row.entity_type,
      match_value: row.customer_app_target_name,
      status: row.status,
      blockers: row.blockers || ['seed_row_not_import_ready'],
      warnings: row.warnings || [],
    });
  }

  const invalidCreateRows = createRows.filter(row => !row.import_ready);
  blockedRows.push(...invalidCreateRows.map(row => ({
    target_entity: row.target_entity,
    match_value: row.match_value,
    status: 'schema_validation_blocked',
    blockers: row.blockers,
    warnings: row.warnings,
  })));

  const importReady = blockedRows.length === 0 && createRows.length > 0 && invalidCreateRows.length === 0;
  const rowsByEntity = createRows.reduce((acc, row) => {
    acc[row.target_entity] = (acc[row.target_entity] || 0) + 1;
    return acc;
  }, {});

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    import_ready: importReady,
    preview_scope: 'exact_order_required_non_stock_production_master_data',
    inventory_seed_policy: INVENTORY_SEED_POLICY,
    yield_policy: YIELD_POLICY,
    procurement_conversion_ready: false,
    inventory_deduction_ready: false,
    purchase_order_automation_ready: false,
    create_rows: createRows.slice(0, DEFAULT_MAX_ROWS),
    create_row_count: createRows.length,
    create_rows_by_entity: rowsByEntity,
    deferred_rows: deferredRows.slice(0, DEFAULT_MAX_ROWS),
    deferred_row_count: deferredRows.length,
    skipped_rows: skippedRows.slice(0, DEFAULT_MAX_ROWS),
    skipped_row_count: skippedRows.length,
    blocked_rows: blockedRows.slice(0, DEFAULT_MAX_ROWS),
    blockers: [...new Set(blockedRows.flatMap(row => row.blockers || []))].slice(0, MAX_BLOCKERS),
    warnings: [...new Set([...warnings, ...createRows.flatMap(row => row.warnings || []), ...deferredRows.flatMap(row => row.warnings || [])])].slice(0, MAX_BLOCKERS),
    next_action: importReady ? 'approve_gated_customer_app_non_stock_master_data_import' : 'patch_import_preview_blockers',
    required_approval_phrase_template: 'APPROVE G31G CUSTOMER APP NON STOCK MASTER DATA IMPORT <ORDER_NUMBER>',
    safety: {
      dry_run_only: true,
      writes_performed: false,
      recipe_records_created: false,
      bundle_records_created: false,
      inventory_records_created: false,
      ingredient_yield_records_created: false,
      production_batches_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      provider_calls_performed: false,
      stripe_calls_performed: false,
      shopify_api_calls_performed: false,
      notifications_sent: false,
      sync_repair_replay_performed: false,
      hub_bridge_modified: false,
    },
  };
}

function buildRequiredRow({ type, name, sourceLineItem, nativeMatches, hubMatch }) {
  const nativeStatus = statusForMatches(nativeMatches);
  const nativePresent = nativeStatus === 'matched';
  const hubStatus = hubMatch?.status || 'missing';
  const hubRecord = hubStatus === 'matched' ? hubMatch.matches?.[0] : null;
  const compatibility = schemaCompatibleForType(type, hubRecord);
  const blockers = [];
  const warnings = [];

  if (nativeStatus === 'ambiguous') blockers.push(`ambiguous_native_${type}:${name}`);
  if (!nativePresent && hubStatus === 'missing') blockers.push(`missing_hub_${type}:${name}`);
  if (!nativePresent && hubStatus === 'ambiguous') blockers.push(`ambiguous_hub_${type}:${name}`);
  if (!nativePresent && hubStatus === 'matched' && compatibility.status !== 'compatible') blockers.push(...compatibility.blockers.map(item => `${type}_${item}:${name}`));
  if (type === 'inventory') {
    warnings.push('inventory_seed_policy_non_stock_master_data_only');
    warnings.push('inventory_deduction_held_pending_stock_yield_policy');
  }

  const mirrorReadiness = nativePresent
    ? 'already_native'
    : blockers.length === 0 && hubStatus === 'matched' && compatibility.status === 'compatible'
      ? (type === 'inventory' ? 'ready_to_mirror_master_data_with_stock_seed_decision' : 'ready_to_mirror')
      : 'blocked';

  return {
    source_line_item: safeText(sourceLineItem || name, 120),
    required_type: type,
    required_name: safeText(name, 120),
    normalized_name: normalizeKey(name) || null,
    native_present: nativePresent,
    native_match_status: nativeStatus,
    hub_match_status: hubStatus,
    hub_match_count: hubMatch?.count || 0,
    hub_id: safeId(hubRecord?.id),
    hub_name: safeText(hubRecord?.name, 120),
    field_compatibility_status: compatibility.status,
    mirror_readiness: mirrorReadiness,
    blockers,
    warnings,
  };
}

function collectNamesFromHubBundles(hubData, lineItemNames) {
  const names = [];
  for (const name of lineItemNames || []) {
    const row = hubMatchForType(hubData, 'bundle', name);
    if (row.status === 'matched') {
      for (const component of row.matches?.[0]?.components || []) {
        if (component.product_name) names.push({ name: component.product_name, source: name });
      }
    }
  }
  return names;
}

function collectNamesFromNativeBundles(nativeBundleMatches, sourceName) {
  const names = [];
  for (const bundle of nativeBundleMatches || []) {
    for (const component of bundle?.components || []) {
      const componentName = safeText(component?.product_name, 120);
      if (componentName) names.push({ name: componentName, source: sourceName });
    }
  }
  return names;
}

function collectIngredientsFromRecipeRecords(records, sourceName) {
  const names = [];
  for (const record of records || []) {
    for (const ingredient of record?.ingredients || []) {
      const ingredientName = safeText(ingredient?.ingredient_name, 120);
      if (ingredientName) names.push({ name: ingredientName, source: sourceName || record.name || record.product_name });
    }
  }
  return names;
}

function buildParityReport({ lookup, customerOrder, nativeOrder, task, lineItems, nativeData, hubResult }) {
  const recipeIndex = buildIndex(nativeData.recipes, row => row?.product_name);
  const bundleIndex = buildIndex(nativeData.bundles, row => row?.bundle_name);
  const inventoryIndex = buildIndex(nativeData.inventoryItems, row => row?.ingredient);
  const yieldIndex = buildIndex(nativeData.ingredientYields, row => row?.ingredient_name);
  const hubData = hubResult.ok ? hubResult.data : null;
  const blockers = [];
  const warnings = ['hub_fallback_required_until_master_data_mirrored'];
  const requiredRows = [];
  const lineItemNames = compactNames(lineItems.map(item => item.title));

  if (!customerOrder && !Array.isArray(lineItems)) warnings.push('customer_app_order_not_loaded_line_items_only');
  if (!nativeOrder && lookup.orderNumber) warnings.push('native_shopify_order_not_loaded');
  if (lineItems.length === 0) blockers.push('missing_line_items');
  if (!hubResult.ok) blockers.push(hubResult.error_code || 'hub_master_data_unavailable');

  const recipeRequirements = [];
  const bundleRequirements = [];
  for (const item of lineItems) {
    const nativeBundleMatches = findMatches(bundleIndex, item.title);
    const hubBundle = hubMatchForType(hubData, 'bundle', item.title);
    const hubRecipe = hubMatchForType(hubData, 'recipe', item.title);
    const nativeRecipeMatches = findMatches(recipeIndex, item.title);
    const treatAsBundle = nativeBundleMatches.length > 0 || hubBundle.status !== 'missing' || sourceLooksLikeBundle(item.title);

    if (treatAsBundle) {
      bundleRequirements.push({ name: item.title, source: item.title });
      recipeRequirements.push(...collectNamesFromNativeBundles(nativeBundleMatches, item.title));
      recipeRequirements.push(...collectNamesFromHubBundles(hubData, [item.title]));
      if (hubBundle.status === 'missing' && nativeBundleMatches.length === 0 && hubRecipe.status === 'matched') {
        warnings.push(`line_item_looks_like_bundle_but_hub_recipe_matched:${item.title}`);
      }
    } else {
      recipeRequirements.push({ name: item.title, source: item.title });
    }

    if (nativeRecipeMatches.length > 0 && !treatAsBundle) {
      recipeRequirements.push({ name: item.title, source: item.title });
    }
  }

  for (const requirement of compactNamedRequirements(bundleRequirements)) {
    requiredRows.push(buildRequiredRow({
      type: 'bundle',
      name: requirement.name,
      sourceLineItem: requirement.source,
      nativeMatches: findMatches(bundleIndex, requirement.name),
      hubMatch: hubMatchForType(hubData, 'bundle', requirement.name),
    }));
  }

  for (const requirement of compactNamedRequirements(recipeRequirements)) {
    requiredRows.push(buildRequiredRow({
      type: 'recipe',
      name: requirement.name,
      sourceLineItem: requirement.source,
      nativeMatches: findMatches(recipeIndex, requirement.name),
      hubMatch: hubMatchForType(hubData, 'recipe', requirement.name),
    }));
  }

  const ingredientRequirements = [];
  for (const row of requiredRows.filter(item => item.required_type === 'recipe')) {
    const nativeRecipeMatches = findMatches(recipeIndex, row.required_name);
    ingredientRequirements.push(...collectIngredientsFromRecipeRecords(nativeRecipeMatches, row.required_name));
    const hubRecipeRow = hubMatchForType(hubData, 'recipe', row.required_name);
    if (hubRecipeRow.status === 'matched') ingredientRequirements.push(...collectIngredientsFromRecipeRecords(hubRecipeRow.matches, row.required_name));
  }

  for (const requirement of compactNamedRequirements(ingredientRequirements)) {
    requiredRows.push(buildRequiredRow({
      type: 'inventory',
      name: requirement.name,
      sourceLineItem: requirement.source,
      nativeMatches: findMatches(inventoryIndex, requirement.name),
      hubMatch: hubMatchForType(hubData, 'inventory', requirement.name),
    }));
    requiredRows.push(buildRequiredRow({
      type: 'yield',
      name: requirement.name,
      sourceLineItem: requirement.source,
      nativeMatches: findMatches(yieldIndex, requirement.name),
      hubMatch: hubMatchForType(hubData, 'yield', requirement.name),
    }));
  }

  const gapClosurePreview = buildMasterDataGapClosurePreview({ requiredRows, hubData, hubResult });
  const policyAdjustedRows = gapClosurePreview.policy_adjusted_required_rows || requiredRows.map(row => applyApprovedPoliciesToRequiredRow(row, hubData));
  const rowBlockers = policyAdjustedRows.flatMap(row => row.blockers || []);
  const rowWarnings = policyAdjustedRows.flatMap(row => row.warnings || []);
  blockers.push(...rowBlockers);
  warnings.push(...rowWarnings);
  warnings.push(...(gapClosurePreview.warnings || []));

  const missingNativeRows = policyAdjustedRows.filter(row => !row.native_present);
  const mirrorReadyRows = policyAdjustedRows.filter(row => row.mirror_readiness?.startsWith('ready_to_mirror') || row.mirror_readiness === 'yield_details_deferred');
  const uniqueBlockers = [...new Set(blockers)].slice(0, MAX_BLOCKERS);
  const uniqueWarnings = [...new Set(warnings)].slice(0, MAX_BLOCKERS);
  const mirrorBlockers = gapClosurePreview.blockers || [...new Set(rowBlockers.concat(!hubResult.ok ? [hubResult.error_code || 'hub_master_data_unavailable'] : []))].slice(0, MAX_BLOCKERS);
  const nativeProductionReadinessAfterMirror = Boolean(gapClosurePreview.production_master_data_ready);

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    order_number: safeText(lookup.orderNumber || nativeOrder?.shopify_order_number || customerOrder?.order_number, 120),
    customer_app_order_present: Boolean(customerOrder),
    native_shopify_order_present: Boolean(nativeOrder),
    native_fulfillment_task_present: Boolean(task),
    customer_app_order_id: safeId(customerOrder?.id),
    native_shopify_order_id: safeId(nativeOrder?.id),
    native_fulfillment_task_id: safeId(task?.id),
    line_item_count: lineItems.length,
    line_item_names: lineItemNames,
    customer_app_counts: {
      recipe_count: nativeData.recipes.length,
      bundle_count: nativeData.bundles.length,
      inventory_item_count: nativeData.inventoryItems.length,
      ingredient_yield_count: nativeData.ingredientYields.length,
    },
    hub_counts: hubData?.counts || { recipe_count: 0, bundle_count: 0, inventory_item_count: 0, ingredient_yield_count: 0 },
    required_master_data_rows: policyAdjustedRows.slice(0, DEFAULT_MAX_ROWS),
    missing_native_recipes: namesByType(missingNativeRows, 'recipe'),
    missing_native_bundles: namesByType(missingNativeRows, 'bundle'),
    missing_native_inventory_items: namesByType(missingNativeRows, 'inventory'),
    missing_native_ingredient_yields: namesByType(missingNativeRows, 'yield'),
    hub_recipe_matches: hubData?.recipe_matches || [],
    hub_bundle_matches: hubData?.bundle_matches || [],
    hub_inventory_matches: hubData?.inventory_matches || [],
    hub_yield_matches: hubData?.yield_matches || [],
    hub_product_matches: hubData?.product_matches || [],
    mirror_ready_rows: mirrorReadyRows.slice(0, DEFAULT_MAX_ROWS),
    mirror_blockers: mirrorBlockers,
    warnings: uniqueWarnings,
    blockers: uniqueBlockers,
    native_production_readiness_after_mirror: nativeProductionReadinessAfterMirror,
    hub_fallback_required: true,
    recommended_next_action: gapClosurePreview.next_action || recommendedNextAction({ requiredRows: policyAdjustedRows, mirrorBlockers, hubResult, missingNativeRows }),
    production_master_data_ready: gapClosurePreview.production_master_data_ready,
    non_stock_master_data_seed_ready: gapClosurePreview.non_stock_master_data_seed_ready,
    procurement_conversion_ready: gapClosurePreview.procurement_conversion_ready,
    inventory_deduction_ready: gapClosurePreview.inventory_deduction_ready,
    yield_details_pending: gapClosurePreview.yield_details_pending,
    pending_yield_items: gapClosurePreview.pending_yield_items,
    approved_alias_mappings: gapClosurePreview.approved_alias_mappings,
    inventory_seed_policy: gapClosurePreview.inventory_seed_policy,
    yield_policy: gapClosurePreview.yield_policy,
    hub_lookup: {
      available: hubResult.ok,
      error_code: hubResult.ok ? null : hubResult.error_code,
      message: hubResult.ok ? null : hubResult.message,
      truncated: Boolean(hubData?.truncated),
    },
    required_rows: gapClosurePreview.required_rows,
    mirror_ready_row_count: gapClosurePreview.mirror_ready_row_count,
    seed_packet_ready: gapClosurePreview.seed_packet_ready,
    non_stock_import_preview_ready: gapClosurePreview.non_stock_import_preview_ready,
    seed_packet_rows: gapClosurePreview.seed_packet_rows,
    blocked_rows: gapClosurePreview.blocked_rows,
    manual_mapping_required_rows: gapClosurePreview.manual_mapping_required_rows,
    owner_input_required_rows: gapClosurePreview.owner_input_required_rows,
    hub_missing_rows: gapClosurePreview.hub_missing_rows,
    alias_candidate_rows: gapClosurePreview.alias_candidate_rows,
    customer_app_non_stock_master_data_import_preview: gapClosurePreview.customer_app_non_stock_master_data_import_preview,
    gap_closure_blockers: gapClosurePreview.blockers,
    gap_closure_warnings: gapClosurePreview.warnings,
    next_action: gapClosurePreview.next_action,
    master_data_gap_closure_preview: gapClosurePreview.master_data_gap_closure_preview,
    safety: {
      dry_run_only: true,
      writes_performed: false,
      master_data_imported: false,
      recipe_records_created: false,
      bundle_records_created: false,
      inventory_records_created: false,
      ingredient_yield_records_created: false,
      production_batches_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      provider_calls_performed: false,
      stripe_calls_performed: false,
      shopify_api_calls_performed: false,
      notifications_sent: false,
      sync_repair_replay_performed: false,
      hub_bridge_modified: false,
    },
  };
}

function compactNamedRequirements(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows || []) {
    const name = safeText(row?.name, 120);
    if (!name) continue;
    const key = normalizeKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name, source: safeText(row?.source, 120) || name });
  }
  return out;
}

function namesByType(rows, type) {
  return [...new Set((rows || []).filter(row => row.required_type === type).map(row => row.required_name).filter(Boolean))].slice(0, DEFAULT_MAX_ROWS);
}

function recommendedNextAction({ requiredRows, mirrorBlockers, hubResult, missingNativeRows }) {
  if (!hubResult.ok) return 'hold';
  if (mirrorBlockers.some(item => item.includes('schema_gap') || item.includes('field_shape_incompatible'))) return 'schema_gap_blocks_mirror';
  if (mirrorBlockers.some(item => item.startsWith('missing_hub'))) return 'hub_master_data_missing';
  if (mirrorBlockers.some(item => item.startsWith('ambiguous_hub'))) return 'ambiguous_hub_match';
  if (mirrorBlockers.some(item => item.startsWith('ambiguous_native'))) return 'manual_mapping_required';
  if (requiredRows.length === 0) return 'hold';
  if (missingNativeRows.length > 0 && mirrorBlockers.length === 0) return 'ready_for_non_stock_master_data_mirror';
  return 'hold';
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required' }, { status: 405 });
    }
    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, error_code: 'malformed_json', message: 'Malformed JSON body' }, { status: 400 });
    }
    const body = parsed.body || {};
    if (body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported' }, { status: 400 });
    }
    const lookup = getLookup(body);
    if (!hasLookupOrLineItems(lookup, body)) {
      return Response.json({ success: false, error_code: 'exact_order_or_line_items_required', message: 'order_number, exact target id, or line_items are required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    let customerOrder = await findCustomerOrder(base44, lookup);
    let nativeOrder = await findNativeShopifyOrder(base44, customerOrder, lookup);
    if (!customerOrder && nativeOrder?.base44_order_id) {
      customerOrder = await findCustomerOrder(base44, { ...lookup, orderId: nativeOrder.base44_order_id, orderNumber: normalizeText(nativeOrder.shopify_order_number).replace(/^#/, '') });
    }
    if (!nativeOrder && customerOrder) nativeOrder = await findNativeShopifyOrder(base44, customerOrder, lookup);
    const task = await findNativeFulfillmentTask(base44, customerOrder, nativeOrder, lookup);
    const lineItems = safeLineItems({ body, customerOrder, nativeOrder, task });
    const requestedNames = compactNames(lineItems.map(item => item.title));

    const [recipes, bundles, inventoryItems, ingredientYields, hubResult] = await Promise.all([
      listEntity(base44, 'Recipe', '-updated_date', 700),
      listEntity(base44, 'Bundle', '-updated_date', 700),
      listEntity(base44, 'InventoryItem', '-updated_date', 700),
      listEntity(base44, 'IngredientYield', '-updated_date', 700),
      fetchHubMasterDataParity(requestedNames),
    ]);

    const report = buildParityReport({
      lookup,
      customerOrder,
      nativeOrder,
      task,
      lineItems,
      nativeData: { recipes, bundles, inventoryItems, ingredientYields },
      hubResult,
    });

    return Response.json({
      ...report,
      function_name: 'previewNativeProductionMasterDataParity',
      generated_at: new Date().toISOString(),
      request_id: safeId(lookup.requestId, 120),
      actor_type: auth.actor_type,
    });
  } catch (error) {
    console.error(`[previewNativeProductionMasterDataParity] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'native_production_master_data_parity_failed',
      message: 'Native production master-data parity preview failed safely.',
      writes_performed: false,
    }, { status: 500 });
  }
});
