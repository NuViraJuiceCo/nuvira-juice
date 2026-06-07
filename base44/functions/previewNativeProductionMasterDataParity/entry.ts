import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_MAX_ROWS = 120;
const HUB_FETCH_TIMEOUT_MS = 6000;
const MAX_BLOCKERS = 60;
const MAX_TEXT = 160;

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
  if (type === 'inventory') warnings.push('inventory_stock_is_live_state_seed_decision_required');

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

  const rowBlockers = requiredRows.flatMap(row => row.blockers || []);
  const rowWarnings = requiredRows.flatMap(row => row.warnings || []);
  blockers.push(...rowBlockers);
  warnings.push(...rowWarnings);

  const missingNativeRows = requiredRows.filter(row => !row.native_present);
  const mirrorReadyRows = requiredRows.filter(row => row.mirror_readiness?.startsWith('ready_to_mirror'));
  const uniqueBlockers = [...new Set(blockers)].slice(0, MAX_BLOCKERS);
  const uniqueWarnings = [...new Set(warnings)].slice(0, MAX_BLOCKERS);
  const mirrorBlockers = [...new Set(rowBlockers.concat(!hubResult.ok ? [hubResult.error_code || 'hub_master_data_unavailable'] : []))].slice(0, MAX_BLOCKERS);
  const nativeProductionReadinessAfterMirror = requiredRows.length > 0 && mirrorBlockers.length === 0;

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
    required_master_data_rows: requiredRows.slice(0, DEFAULT_MAX_ROWS),
    missing_native_recipes: namesByType(missingNativeRows, 'recipe'),
    missing_native_bundles: namesByType(missingNativeRows, 'bundle'),
    missing_native_inventory_items: namesByType(missingNativeRows, 'inventory'),
    missing_native_ingredient_yields: namesByType(missingNativeRows, 'yield'),
    hub_recipe_matches: hubData?.recipe_matches || [],
    hub_bundle_matches: hubData?.bundle_matches || [],
    hub_inventory_matches: hubData?.inventory_matches || [],
    hub_yield_matches: hubData?.yield_matches || [],
    mirror_ready_rows: mirrorReadyRows.slice(0, DEFAULT_MAX_ROWS),
    mirror_blockers: mirrorBlockers,
    warnings: uniqueWarnings,
    blockers: uniqueBlockers,
    native_production_readiness_after_mirror: nativeProductionReadinessAfterMirror,
    hub_fallback_required: true,
    recommended_next_action: recommendedNextAction({ requiredRows, mirrorBlockers, hubResult, missingNativeRows }),
    hub_lookup: {
      available: hubResult.ok,
      error_code: hubResult.ok ? null : hubResult.error_code,
      message: hubResult.ok ? null : hubResult.message,
      truncated: Boolean(hubData?.truncated),
    },
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
  if (missingNativeRows.length > 0 && mirrorBlockers.length === 0) return 'ready_for_master_data_mirror';
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
