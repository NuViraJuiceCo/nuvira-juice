import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const DEFAULT_MAX_ROWS = 80;
const MAX_BLOCKERS = 40;
const MAX_TEXT = 160;
const OZ_TO_G = 28.3495;
const SUPPORTED_STOCK_UNITS = new Set(['oz', 'fl oz', 'floz', 'g', 'gram', 'grams', 'kg', 'lb', 'lbs', 'l', 'liter', 'liters', 'ml']);
const TRACE_INGREDIENT_UNITS = new Set(['pinch', 'dash', 'trace', 'to taste']);

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function normalizeMatchKey(value) {
  return normalizeLower(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function singularMatchKey(value) {
  return normalizeMatchKey(value)
    .split(' ')
    .map(part => (part.length > 3 && part.endsWith('s') ? part.slice(0, -1) : part))
    .join(' ');
}

function matchKeys(value) {
  const exact = normalizeMatchKey(value);
  const singular = singularMatchKey(value);
  return [...new Set([exact, singular].filter(Boolean))];
}

function sanitizeText(value, maxLength = MAX_TEXT) {
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

function sanitizeId(value, maxLength = 180) {
  const text = sanitizeText(value, maxLength);
  return text && /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : null;
}

function safeNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isTraceIngredientQuantity(ingredient) {
  const quantity = numberOrNull(ingredient?.quantity_oz);
  const unit = normalizeLower(ingredient?.unit);
  return (quantity === 0 || quantity === null) && TRACE_INGREDIENT_UNITS.has(unit);
}

function roundQuantity(value, decimals = 3) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** decimals;
  return Math.round(parsed * factor) / factor;
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
      ? { ok: true, actor_type: 'system', actor_role: 'service', actor_email: 'system' }
      : { ok: false, response: unauthorized() };
  }

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: unauthorized() };
    if (user.role !== 'admin') return { ok: false, response: forbidden() };
    return { ok: true, actor_type: 'admin', actor_role: 'admin', actor_email: sanitizeText(user.email, 120) || 'admin' };
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

function hasExactLookup(lookup) {
  return Boolean(lookup.orderId || lookup.nativeOrderId || lookup.taskId || lookup.orderNumber);
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

  const seen = new Set();
  for (const filter of filters) {
    const rows = await filterEntity(base44, 'FulfillmentTask', filter, '-created_date', 10);
    for (const row of rows) {
      if (!row?.id || seen.has(row.id)) continue;
      seen.add(row.id);
      if (lookup.taskId && row.id === lookup.taskId) return row;
      if (!lookup.taskId) return row;
    }
  }
  return null;
}

function addToIndex(index, value, record) {
  for (const key of matchKeys(value)) {
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(record);
  }
}

function firstMatch(index, value) {
  for (const key of matchKeys(value)) {
    const matches = index.get(key) || [];
    if (matches.length === 1) return { status: 'matched', record: matches[0], match_count: 1 };
    if (matches.length > 1) return { status: 'ambiguous', record: null, matches, match_count: matches.length };
  }
  return { status: 'missing', record: null, matches: [], match_count: 0 };
}

function firstMatchAny(index, values) {
  for (const value of values || []) {
    const match = firstMatch(index, value);
    if (match.status !== 'missing') return match;
  }
  return { status: 'missing', record: null, matches: [], match_count: 0 };
}

function parseOunces(value) {
  const text = normalizeText(value);
  const match = text.match(/(\d+(?:\.\d+)?)\s*(?:fl\s*)?oz\b/i);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function lineItemTitle(item) {
  return sanitizeText(item?.title || item?.name || item?.product_title || item?.variant_title, 120);
}

function lineItemSku(item) {
  return sanitizeText(item?.sku || item?.product_sku, 80);
}

function lineItemQuantity(item) {
  const quantity = safeNumber(item?.quantity, 0);
  return quantity > 0 ? quantity : 0;
}

function lineItemSizeOz(item, productRecord) {
  return parseOunces(item?.size) ||
    parseOunces(item?.variant_title) ||
    parseOunces(item?.title) ||
    parseOunces(productRecord?.size) ||
    parseOunces(productRecord?.title) ||
    null;
}

function safeLineItems({ customerOrder, nativeOrder, task }) {
  const candidates = [
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
        sku: lineItemSku(item),
        quantity: lineItemQuantity(item),
        variant_title: sanitizeText(item?.variant_title, 120),
        source_line_item_id: sanitizeId(item?.id || item?.shopify_line_item_id || item?.product_id, 120),
      })).filter(item => item.title && item.quantity > 0);
    }
  }
  return [];
}

function paymentStatus(customerOrder, nativeOrder) {
  const status = normalizeLower(customerOrder?.payment_status || nativeOrder?.payment_status || nativeOrder?.financial_status);
  if (status) return status;
  return customerOrder?.payment_captured === true ? 'paid' : '';
}

function isPaymentCaptured(customerOrder) {
  return customerOrder?.payment_captured === true || paymentStatus(customerOrder, null) === 'paid';
}

function orderType(customerOrder, nativeOrder) {
  return normalizeLower(nativeOrder?.order_type || nativeOrder?.source_channel || customerOrder?.order_type || customerOrder?.source_channel);
}

function fulfillmentMethod(customerOrder, nativeOrder, task) {
  return normalizeLower(task?.fulfillment_type || nativeOrder?.fulfillment_method || customerOrder?.fulfillment_type || customerOrder?.fulfillment_method) || 'delivery';
}

function productionDateForOrder(customerOrder, nativeOrder, task) {
  return normalizeText(task?.production_date || nativeOrder?.production_date || customerOrder?.production_date || customerOrder?.assigned_production_date || customerOrder?.assigned_production_day) || null;
}

function deliveryDateForOrder(customerOrder, nativeOrder, task) {
  return normalizeText(task?.assigned_delivery_date || task?.delivery_date || nativeOrder?.assigned_delivery_date || nativeOrder?.requested_delivery_date || customerOrder?.assigned_delivery_date || customerOrder?.estimated_delivery_date || customerOrder?.requested_delivery_date) || null;
}

function sameRecordId(a, b) {
  const left = normalizeText(a);
  const right = normalizeText(b);
  return Boolean(left && right && left === right);
}

function sameOrderNumber(a, b) {
  const left = normalizeText(a).replace(/^#/, '');
  const right = normalizeText(b).replace(/^#/, '');
  return Boolean(left && right && left === right);
}

function anyMatches(value, candidates, matcher = sameRecordId) {
  return (candidates || []).filter(Boolean).some(candidate => matcher(value, candidate));
}

function linkageBlockers({ customerOrder, nativeOrder, task, lookup, orderNumber }) {
  const blockers = [];
  if (lookup.orderId && customerOrder?.id && !sameRecordId(lookup.orderId, customerOrder.id)) blockers.push('customer_app_order_id_mismatch');
  if (lookup.nativeOrderId && nativeOrder?.id && !anyMatches(lookup.nativeOrderId, [nativeOrder.id, nativeOrder.shopify_order_id])) blockers.push('native_shopify_order_id_mismatch');
  if (lookup.taskId && task?.id && !sameRecordId(lookup.taskId, task.id)) blockers.push('native_fulfillment_task_id_mismatch');

  if (customerOrder && nativeOrder?.base44_order_id && !sameRecordId(nativeOrder.base44_order_id, customerOrder.id)) {
    blockers.push('native_order_base44_order_link_mismatch');
  }
  if (customerOrder && task?.base44_order_id && !sameRecordId(task.base44_order_id, customerOrder.id)) {
    blockers.push('native_task_base44_order_link_mismatch');
  }
  if (nativeOrder && task) {
    const taskNativeIds = [task.native_shopify_order_id, task.shopify_order_id].filter(Boolean);
    if (taskNativeIds.length > 0 && !taskNativeIds.some(value => sameRecordId(value, nativeOrder.id))) {
      blockers.push('native_task_shopify_order_link_mismatch');
    }
    if (task.order_id && !anyMatches(task.order_id, [nativeOrder.id, customerOrder?.id])) {
      blockers.push('native_task_order_id_link_mismatch');
    }
  }
  if (orderNumber) {
    const customerNumbers = [customerOrder?.order_number, customerOrder?.shopify_order_number].filter(Boolean);
    if (customerNumbers.length > 0 && !customerNumbers.some(value => sameOrderNumber(value, orderNumber))) {
      blockers.push('customer_order_number_mismatch');
    }
    const nativeNumber = nativeOrder?.shopify_order_number;
    if (nativeNumber && !sameOrderNumber(nativeNumber, orderNumber)) blockers.push('native_order_number_mismatch');
    const taskNumbers = [task?.order_number, task?.shopify_order_number].filter(Boolean);
    if (taskNumbers.length > 0 && !taskNumbers.some(value => sameOrderNumber(value, orderNumber))) {
      blockers.push('native_task_order_number_mismatch');
    }
  }
  return blockers;
}

function stockToOz(stock, unit) {
  const amount = numberOrNull(stock);
  if (amount === null) return { ok: false, value: null, reason: 'missing_stock' };
  const normalized = normalizeLower(unit);
  if (!normalized) return { ok: false, value: null, reason: 'missing_stock_unit' };
  if (!SUPPORTED_STOCK_UNITS.has(normalized)) return { ok: false, value: null, reason: 'unsupported_stock_unit' };
  switch (normalized) {
    case 'oz':
    case 'fl oz':
    case 'floz':
      return { ok: true, value: amount, reason: null };
    case 'g':
    case 'gram':
    case 'grams':
      return { ok: true, value: amount / OZ_TO_G, reason: null };
    case 'kg':
      return { ok: true, value: (amount * 1000) / OZ_TO_G, reason: null };
    case 'lb':
    case 'lbs':
      return { ok: true, value: amount * 16, reason: null };
    case 'l':
    case 'liter':
    case 'liters':
      return { ok: true, value: amount * 33.814, reason: null };
    case 'ml':
      return { ok: true, value: amount / 29.5735, reason: null };
    default:
      return { ok: false, value: null, reason: 'unsupported_stock_unit' };
  }
}

function normalizedRoundingRule(record) {
  const rule = normalizeLower(record?.rounding_rule);
  return ['round_up_unit', 'round_up_case', 'exact'].includes(rule) ? rule : 'round_up_unit';
}

function roundedPurchaseUnits(rawUnits, rule, unitsPerCase) {
  if (!Number.isFinite(rawUnits) || rawUnits <= 0) return 0;
  if (rule === 'exact') return roundQuantity(rawUnits, 3);
  if (rule === 'round_up_case' && Number.isFinite(unitsPerCase) && unitsPerCase > 0) {
    return Math.ceil(rawUnits / unitsPerCase) * unitsPerCase;
  }
  return Math.ceil(rawUnits);
}

function buildIndexes({ recipes, bundles, products, inventoryItems, ingredientYields }) {
  const recipeIndex = new Map();
  const bundleIndex = new Map();
  const productIndex = new Map();
  const inventoryIndex = new Map();
  const yieldIndex = new Map();

  for (const recipe of recipes || []) {
    if (recipe?.is_active === false) continue;
    addToIndex(recipeIndex, recipe.product_name, recipe);
    if (recipe.product_sku) addToIndex(recipeIndex, recipe.product_sku, recipe);
  }
  for (const bundle of bundles || []) {
    if (bundle?.is_active === false) continue;
    addToIndex(bundleIndex, bundle.bundle_name, bundle);
  }
  for (const product of products || []) {
    if (product?.is_available === false) continue;
    addToIndex(productIndex, product.title, product);
    if (product.shopify_product_id) addToIndex(productIndex, product.shopify_product_id, product);
  }
  for (const item of inventoryItems || []) addToIndex(inventoryIndex, item.ingredient, item);
  for (const item of ingredientYields || []) addToIndex(yieldIndex, item.ingredient_name, item);

  return { recipeIndex, bundleIndex, productIndex, inventoryIndex, yieldIndex };
}

function expandLineItems(lineItems, indexes) {
  const rows = [];
  const bundleRows = [];
  const blockers = [];
  const warnings = [];

  for (const item of lineItems) {
    const title = lineItemTitle(item);
    const quantity = lineItemQuantity(item);
    if (!title || quantity <= 0) continue;

    const bundleMatch = firstMatch(indexes.bundleIndex, title);
    if (bundleMatch.status === 'ambiguous') {
      blockers.push(`ambiguous_bundle_match:${title}`);
      rows.push({ source_line_item: title, source_quantity: quantity, recipe_match_status: 'blocked_ambiguous_bundle' });
      continue;
    }

    if (bundleMatch.status === 'matched') {
      const bundle = bundleMatch.record;
      const components = Array.isArray(bundle.components) ? bundle.components : [];
      if (components.length === 0) {
        blockers.push(`missing_bundle_components:${title}`);
        rows.push({ source_line_item: title, source_quantity: quantity, recipe_match_status: 'blocked_missing_bundle_components' });
        continue;
      }
      for (const component of components) {
        const componentName = sanitizeText(component?.product_name, 120);
        const componentQty = quantity * safeNumber(component?.quantity, 0);
        if (!componentName || componentQty <= 0) {
          blockers.push(`invalid_bundle_component:${title}`);
          continue;
        }
        const row = {
          product_name: componentName,
          quantity: componentQty,
          source_line_item: title,
          sku: lineItemSku(item),
          source_line_item_quantity: quantity,
          bundle_name: sanitizeText(bundle.bundle_name, 120),
          bundle_component: componentName,
          demand_source_type: 'bundle_component',
          recipe_match_status: 'pending',
        };
        rows.push(row);
        bundleRows.push({
          bundle_name: sanitizeText(bundle.bundle_name, 120),
          source_line_item: title,
          source_quantity: quantity,
          component_product_name: componentName,
          component_quantity: safeNumber(component?.quantity, 0),
          total_component_quantity: componentQty,
        });
      }
      continue;
    }

    const productMatch = firstMatch(indexes.productIndex, title);
    if (productMatch.status === 'ambiguous') {
      blockers.push(`ambiguous_product_match:${title}`);
      rows.push({ source_line_item: title, source_quantity: quantity, recipe_match_status: 'blocked_ambiguous_product' });
      continue;
    }
    const productRecord = productMatch.status === 'matched' ? productMatch.record : null;
    const productCategory = normalizeLower(productRecord?.category);
    if (['bundle', 'wellness_pack'].includes(productCategory)) {
      blockers.push(`missing_bundle_mapping:${title}`);
      rows.push({ source_line_item: title, source_quantity: quantity, recipe_match_status: 'blocked_missing_bundle_mapping' });
      continue;
    }

    const recipeDirectMatch = firstMatchAny(indexes.recipeIndex, [title, item.sku]);
    if (!productRecord && recipeDirectMatch.status === 'missing') {
      blockers.push(`unknown_product_mapping:${title}`);
      rows.push({ source_line_item: title, source_quantity: quantity, recipe_match_status: 'blocked_unknown_product_mapping' });
      continue;
    }
    if (!productRecord) warnings.push(`product_master_record_missing_recipe_direct_match_used:${title}`);

    rows.push({
      product_name: sanitizeText(productRecord?.title || title, 120),
      quantity,
      source_line_item: title,
      sku: lineItemSku(item),
      source_line_item_quantity: quantity,
      bundle_name: null,
      bundle_component: null,
      demand_source_type: 'direct_line_item',
      size_oz: lineItemSizeOz(item, productRecord),
      recipe_match_status: 'pending',
    });
  }

  return { rows, bundleRows, blockers, warnings };
}

function attachRecipes(demandRows, indexes) {
  const blockers = [];
  const recipeRows = [];
  const enrichedRows = [];

  for (const row of demandRows) {
    if (!row.product_name || row.quantity <= 0) {
      enrichedRows.push(row);
      continue;
    }
    const recipeMatch = firstMatchAny(indexes.recipeIndex, [row.product_name, row.sku]);
    if (recipeMatch.status === 'ambiguous') {
      blockers.push(`ambiguous_recipe_match:${row.product_name}`);
      enrichedRows.push({ ...row, recipe_match_status: 'ambiguous', recipe_id: null, recipe_name: null });
      recipeRows.push({
        product_name: row.product_name,
        source_line_item: row.source_line_item,
        recipe_match_status: 'ambiguous',
        recipe_id: null,
        recipe_name: null,
        ingredient_count: 0,
      });
      continue;
    }
    if (recipeMatch.status === 'missing') {
      blockers.push(`missing_recipe:${row.product_name}`);
      enrichedRows.push({ ...row, recipe_match_status: 'missing', recipe_id: null, recipe_name: null });
      recipeRows.push({
        product_name: row.product_name,
        source_line_item: row.source_line_item,
        recipe_match_status: 'missing',
        recipe_id: null,
        recipe_name: null,
        ingredient_count: 0,
      });
      continue;
    }
    const recipe = recipeMatch.record;
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    if (ingredients.length === 0) blockers.push(`recipe_has_no_ingredients:${row.product_name}`);
    enrichedRows.push({
      ...row,
      recipe_match_status: ingredients.length > 0 ? 'matched' : 'empty_recipe',
      recipe_id: sanitizeId(recipe.id, 120),
      recipe_name: sanitizeText(recipe.product_name, 120),
      recipe_yield_factor: numberOrNull(recipe.yield_factor) ?? 1,
      recipe,
    });
    recipeRows.push({
      product_name: row.product_name,
      source_line_item: row.source_line_item,
      recipe_match_status: ingredients.length > 0 ? 'matched' : 'empty_recipe',
      recipe_id: sanitizeId(recipe.id, 120),
      recipe_name: sanitizeText(recipe.product_name, 120),
      ingredient_count: ingredients.length,
      yield_factor: numberOrNull(recipe.yield_factor) ?? 1,
    });
  }

  return { demandRows: enrichedRows, recipeRows, blockers };
}

function computeIngredientNeeds(demandRows, indexes) {
  const aggregate = new Map();
  const blockers = [];
  const warnings = [];
  const traceRows = [];

  for (const row of demandRows) {
    const recipe = row.recipe;
    if (!recipe || !Array.isArray(recipe.ingredients)) continue;
    const yieldFactor = numberOrNull(recipe.yield_factor) ?? 1;
    for (const ingredient of recipe.ingredients) {
      const ingredientName = sanitizeText(ingredient?.ingredient_name, 120);
      if (!ingredientName) continue;
      const recipeQuantityOz = safeNumber(ingredient?.quantity_oz, 0);
      if (recipeQuantityOz <= 0) {
        if (isTraceIngredientQuantity(ingredient)) {
          warnings.push(`trace_recipe_ingredient_quantity_pending:${row.product_name}:${ingredientName}`);
          warnings.push(`procurement_conversion_pending:${ingredientName}`);
          traceRows.push({
            ingredient_name: ingredientName,
            recipe_source: sanitizeText(recipe.product_name, 120),
            source_product: sanitizeText(row.product_name, 120),
            source_line_item: sanitizeText(row.source_line_item, 120),
            unit: sanitizeText(ingredient?.unit, 40) || 'trace',
          });
          continue;
        }
        blockers.push(`unsupported_or_missing_recipe_quantity:${row.product_name}:${ingredientName}`);
        continue;
      }
      const key = normalizeMatchKey(ingredientName);
      const current = aggregate.get(key) || {
        ingredient_name: ingredientName,
        proposed_quantity: 0,
        unit: 'oz',
        recipe_sources: new Set(),
        source_products: new Set(),
        source_line_items: new Set(),
      };
      current.proposed_quantity += recipeQuantityOz * safeNumber(row.quantity, 0) * yieldFactor;
      current.recipe_sources.add(sanitizeText(recipe.product_name, 120));
      current.source_products.add(sanitizeText(row.product_name, 120));
      current.source_line_items.add(sanitizeText(row.source_line_item, 120));
      aggregate.set(key, current);
    }
  }

  const ingredientRows = [];
  for (const value of aggregate.values()) {
    const inventoryMatch = firstMatch(indexes.inventoryIndex, value.ingredient_name);
    const yieldMatch = firstMatch(indexes.yieldIndex, value.ingredient_name);
    const proposedQuantity = roundQuantity(value.proposed_quantity, 3) || 0;
    let inventoryItem = null;
    let currentStock = null;
    let projectedStock = null;
    let shortfallQuantity = proposedQuantity;
    let procurementNeeded = false;
    let status = 'no_inventory_match';

    if (inventoryMatch.status === 'ambiguous') {
      blockers.push(`ambiguous_inventory_item:${value.ingredient_name}`);
    } else if (inventoryMatch.status === 'missing') {
      blockers.push(`missing_inventory_item:${value.ingredient_name}`);
    } else {
      inventoryItem = inventoryMatch.record;
      const conversion = stockToOz(inventoryItem.stock, inventoryItem.unit);
      if (!conversion.ok) {
        if (conversion.reason === 'unsupported_stock_unit') {
          warnings.push(`unsupported_stock_unit_deferred:${value.ingredient_name}`);
          warnings.push(`procurement_conversion_pending:${value.ingredient_name}`);
          shortfallQuantity = proposedQuantity;
          procurementNeeded = proposedQuantity > 0;
          status = 'unsupported_stock_unit_deferred';
        } else {
          blockers.push(`${conversion.reason}:${value.ingredient_name}`);
          status = conversion.reason;
        }
      } else {
        currentStock = roundQuantity(conversion.value, 3);
        shortfallQuantity = roundQuantity(Math.max(0, proposedQuantity - currentStock), 3) || 0;
        projectedStock = roundQuantity(currentStock - proposedQuantity, 3);
        procurementNeeded = shortfallQuantity > 0;
        status = procurementNeeded ? 'procurement_needed' : 'covered';
        if (procurementNeeded) warnings.push(`inventory_shortfall:${value.ingredient_name}`);
      }
    }

    let yieldRecord = null;
    let procurementQuantity = null;
    let procurementUnit = null;
    let procurementCaseQuantity = null;
    let procurementBasis = null;

    if (yieldMatch.status === 'ambiguous') {
      blockers.push(`ambiguous_ingredient_yield:${value.ingredient_name}`);
    } else if (yieldMatch.status === 'missing') {
      warnings.push(`yield_details_pending:${value.ingredient_name}`);
      warnings.push(`procurement_conversion_pending:${value.ingredient_name}`);
    } else {
      yieldRecord = yieldMatch.record;
      const ozPerPurchaseUnit = numberOrNull(yieldRecord?.oz_per_purchase_unit);
      if (!ozPerPurchaseUnit || ozPerPurchaseUnit <= 0) {
        warnings.push(`yield_details_pending:${value.ingredient_name}`);
        warnings.push(`invalid_ingredient_yield_details:${value.ingredient_name}`);
        warnings.push(`procurement_conversion_pending:${value.ingredient_name}`);
      } else if (status === 'unsupported_stock_unit_deferred') {
        procurementBasis = 'stock_unit_conversion_deferred';
      } else {
        const trimWasteFactor = numberOrNull(yieldRecord?.trim_waste_factor) ?? 1;
        const unitsPerCase = numberOrNull(yieldRecord?.units_per_case);
        const roundingRule = normalizedRoundingRule(yieldRecord);
        const rawUnits = shortfallQuantity > 0 ? (shortfallQuantity * trimWasteFactor) / ozPerPurchaseUnit : 0;
        procurementQuantity = roundedPurchaseUnits(rawUnits, roundingRule, unitsPerCase);
        procurementUnit = sanitizeText(yieldRecord.purchase_unit, 40);
        procurementCaseQuantity = roundingRule === 'round_up_case' && unitsPerCase && unitsPerCase > 0 && rawUnits > 0
          ? Math.ceil(rawUnits / unitsPerCase)
          : null;
        procurementBasis = shortfallQuantity > 0 ? 'shortfall' : 'covered';
      }
    }

    ingredientRows.push({
      ingredient_name: value.ingredient_name,
      proposed_quantity: proposedQuantity,
      unit: 'oz',
      recipe_source: [...value.recipe_sources].filter(Boolean).sort().join(', '),
      source_products: [...value.source_products].filter(Boolean).sort(),
      source_line_items: [...value.source_line_items].filter(Boolean).sort(),
      inventory_item_id: sanitizeId(inventoryItem?.id, 120),
      inventory_item_name: sanitizeText(inventoryItem?.ingredient, 120),
      inventory_unit: sanitizeText(inventoryItem?.unit, 40),
      current_stock: currentStock,
      projected_stock: projectedStock,
      procurement_needed: procurementNeeded,
      shortfall_quantity: shortfallQuantity,
      ingredient_yield_id: sanitizeId(yieldRecord?.id, 120),
      ingredient_yield_name: sanitizeText(yieldRecord?.ingredient_name, 120),
      purchase_unit: sanitizeText(yieldRecord?.purchase_unit, 40),
      oz_per_purchase_unit: numberOrNull(yieldRecord?.oz_per_purchase_unit),
      procurement_quantity: procurementQuantity,
      procurement_unit: procurementUnit,
      procurement_case_quantity: procurementCaseQuantity,
      procurement_basis: procurementBasis,
      yield_details_pending: yieldMatch.status === 'missing' ||
        (yieldMatch.status === 'matched' && (!numberOrNull(yieldRecord?.oz_per_purchase_unit) || numberOrNull(yieldRecord?.oz_per_purchase_unit) <= 0)),
      procurement_conversion_ready: Boolean(procurementUnit && procurementQuantity !== null) && status !== 'unsupported_stock_unit_deferred',
      unsupported_stock_unit_deferred: status === 'unsupported_stock_unit_deferred',
      status,
    });
  }

  for (const trace of traceRows) {
    const inventoryMatch = firstMatch(indexes.inventoryIndex, trace.ingredient_name);
    const yieldMatch = firstMatch(indexes.yieldIndex, trace.ingredient_name);
    const inventoryItem = inventoryMatch.status === 'matched' ? inventoryMatch.record : null;
    const yieldRecord = yieldMatch.status === 'matched' ? yieldMatch.record : null;
    if (inventoryMatch.status === 'ambiguous') blockers.push(`ambiguous_inventory_item:${trace.ingredient_name}`);
    if (yieldMatch.status === 'ambiguous') blockers.push(`ambiguous_ingredient_yield:${trace.ingredient_name}`);
    if (yieldMatch.status === 'missing') warnings.push(`yield_details_pending:${trace.ingredient_name}`);
    ingredientRows.push({
      ingredient_name: trace.ingredient_name,
      proposed_quantity: 0,
      unit: trace.unit,
      recipe_source: trace.recipe_source,
      source_products: [trace.source_product].filter(Boolean),
      source_line_items: [trace.source_line_item].filter(Boolean),
      inventory_item_id: sanitizeId(inventoryItem?.id, 120),
      inventory_item_name: sanitizeText(inventoryItem?.ingredient, 120),
      inventory_unit: sanitizeText(inventoryItem?.unit, 40),
      current_stock: numberOrNull(inventoryItem?.stock),
      projected_stock: numberOrNull(inventoryItem?.stock),
      procurement_needed: false,
      shortfall_quantity: 0,
      ingredient_yield_id: sanitizeId(yieldRecord?.id, 120),
      ingredient_yield_name: sanitizeText(yieldRecord?.ingredient_name, 120),
      purchase_unit: sanitizeText(yieldRecord?.purchase_unit, 40),
      oz_per_purchase_unit: numberOrNull(yieldRecord?.oz_per_purchase_unit),
      procurement_quantity: null,
      procurement_unit: null,
      procurement_case_quantity: null,
      procurement_basis: 'trace_quantity_pending',
      yield_details_pending: yieldMatch.status !== 'matched',
      procurement_conversion_ready: false,
      trace_quantity_pending: true,
      status: 'trace_quantity_pending',
    });
  }

  ingredientRows.sort((a, b) => {
    if (a.procurement_needed !== b.procurement_needed) return a.procurement_needed ? -1 : 1;
    return (a.ingredient_name || '').localeCompare(b.ingredient_name || '');
  });

  return { ingredientRows, blockers, warnings };
}

function isInventoryBlocker(blocker) {
  return [
    'ambiguous_inventory_item',
    'missing_inventory_item',
    'missing_stock',
    'missing_stock_unit',
    'unsupported_stock_unit',
    'ambiguous_ingredient_yield',
    'missing_ingredient_yield',
    'invalid_ingredient_yield',
  ].some(prefix => normalizeText(blocker).startsWith(prefix));
}

function isProductionBlocker(blocker) {
  return !isInventoryBlocker(blocker);
}

function safeProductionDemandRows(rows) {
  return rows.map(row => ({
    product_name: sanitizeText(row.product_name, 120),
    quantity: roundQuantity(row.quantity, 3),
    source_line_item: sanitizeText(row.source_line_item, 120),
    sku: sanitizeText(row.sku, 80),
    source_line_item_quantity: roundQuantity(row.source_line_item_quantity, 3),
    bundle_name: sanitizeText(row.bundle_name, 120),
    bundle_component: sanitizeText(row.bundle_component, 120),
    demand_source_type: sanitizeText(row.demand_source_type, 80),
    recipe_match_status: sanitizeText(row.recipe_match_status, 80),
    recipe_id: sanitizeId(row.recipe_id, 120),
    recipe_name: sanitizeText(row.recipe_name, 120),
  }));
}

function buildProductionReadiness({ customerOrder, nativeOrder, task, lookup, lineItems, masterData, existingBatches }) {
  const blockers = [];
  const warnings = [];
  const orderNumber = sanitizeText(lookup.orderNumber || nativeOrder?.shopify_order_number || customerOrder?.order_number || task?.order_number, 120);
  const paid = paymentStatus(customerOrder, nativeOrder) === 'paid' || isPaymentCaptured(customerOrder);
  const captured = isPaymentCaptured(customerOrder);
  const type = orderType(customerOrder, nativeOrder);
  const fulfillment = fulfillmentMethod(customerOrder, nativeOrder, task);
  const productionDate = productionDateForOrder(customerOrder, nativeOrder, task);
  const deliveryDate = deliveryDateForOrder(customerOrder, nativeOrder, task);

  if (!customerOrder) blockers.push('order_not_found');
  if (customerOrder && !paid) blockers.push('order_not_paid');
  if (customerOrder && !captured) blockers.push('payment_not_captured');
  if (!nativeOrder) blockers.push('missing_native_shopify_order');
  if (!task) blockers.push('missing_native_fulfillment_task');
  if (lineItems.length === 0) blockers.push('missing_line_items');
  blockers.push(...linkageBlockers({ customerOrder, nativeOrder, task, lookup, orderNumber }));
  if (['subscription', 'multi_delivery'].includes(type) || nativeOrder?.is_subscription === true) blockers.push('subscription_multi_delivery_out_of_scope');
  if (['pos', 'event'].includes(type) || fulfillment === 'pos') blockers.push('pos_event_order_out_of_scope');
  if (!productionDate) warnings.push('production_date_missing_or_pending');

  const indexes = buildIndexes(masterData);
  const expanded = expandLineItems(lineItems, indexes);
  blockers.push(...expanded.blockers);
  warnings.push(...expanded.warnings);
  const recipeAttached = attachRecipes(expanded.rows, indexes);
  blockers.push(...recipeAttached.blockers);
  const ingredients = computeIngredientNeeds(recipeAttached.demandRows, indexes);
  blockers.push(...ingredients.blockers);
  warnings.push(...ingredients.warnings);

  if (ingredients.ingredientRows.some(row => row.procurement_needed)) warnings.push('inventory_shortfall_procurement_needed');
  warnings.push('hub_fallback_required');
  warnings.push('inventory_deduction_held');
  warnings.push('purchase_order_automation_held');

  const existingBatchRows = (existingBatches || [])
    .filter(batch => {
      const batchDate = normalizeText(batch.production_date);
      if (productionDate && batchDate && batchDate !== productionDate) return false;
      const sourceText = JSON.stringify(batch?.order_sources || []) + JSON.stringify(batch?.related_orders || []);
      return sourceText.includes(orderNumber || '') || sourceText.includes(nativeOrder?.id || '') || sourceText.includes(customerOrder?.id || '');
    })
    .slice(0, 12)
    .map(batch => ({
      production_batch_id: sanitizeId(batch.id, 120),
      batch_id: sanitizeText(batch.batch_id, 120),
      product_name: sanitizeText(batch.product_name, 120),
      production_date: sanitizeText(batch.production_date, 40),
      status: sanitizeText(batch.status, 80),
      planned_units: numberOrNull(batch.planned_units),
      source: normalizeLower(batch.source_system).includes('hub') ? 'hub' : 'customer_app_native_or_unknown',
    }));
  if (existingBatchRows.length === 0) warnings.push('existing_native_production_batch_missing');

  const uniqueBlockers = [...new Set(blockers)].slice(0, MAX_BLOCKERS);
  const uniqueWarnings = [...new Set(warnings)].slice(0, MAX_BLOCKERS);
  const productionBlockers = uniqueBlockers.filter(isProductionBlocker);
  const inventoryBlockers = uniqueBlockers.filter(isInventoryBlocker);
  const missingRecipeItems = recipeAttached.recipeRows.filter(row => ['missing', 'empty_recipe'].includes(row.recipe_match_status)).map(row => row.product_name).filter(Boolean);
  const ambiguousRecipeItems = recipeAttached.recipeRows.filter(row => row.recipe_match_status === 'ambiguous').map(row => row.product_name).filter(Boolean);
  const missingInventoryItems = ingredients.ingredientRows.filter(row => !row.inventory_item_id).map(row => row.ingredient_name).filter(Boolean);
  const missingYieldItems = ingredients.ingredientRows.filter(row => !row.ingredient_yield_id).map(row => row.ingredient_name).filter(Boolean);
  const pendingYieldItems = ingredients.ingredientRows
    .filter(row => row.yield_details_pending || !row.ingredient_yield_id)
    .map(row => row.ingredient_name)
    .filter(Boolean);
  const traceIngredientItems = ingredients.ingredientRows
    .filter(row => row.trace_quantity_pending)
    .map(row => row.ingredient_name)
    .filter(Boolean);
  const deferredStockUnitItems = ingredients.ingredientRows
    .filter(row => row.unsupported_stock_unit_deferred)
    .map(row => row.ingredient_name)
    .filter(Boolean);
  const procurementConversionReady = pendingYieldItems.length === 0 &&
    deferredStockUnitItems.length === 0 &&
    !ingredients.ingredientRows.some(row => row.procurement_needed && row.procurement_quantity === null);
  const procurementConversionWarnings = deferredStockUnitItems.length > 0 ||
    pendingYieldItems.length > 0 ||
    traceIngredientItems.length > 0 ||
    uniqueWarnings.some(warning => normalizeText(warning).startsWith('procurement_conversion_pending'));
  const shortfallItems = ingredients.ingredientRows.filter(row => row.procurement_needed).map(row => ({
    ingredient_name: row.ingredient_name,
    shortfall_quantity: row.shortfall_quantity,
    unit: row.unit,
    procurement_quantity: row.procurement_quantity,
    procurement_unit: row.procurement_unit,
  }));

  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    order_number: orderNumber || null,
    customer_app_order_present: Boolean(customerOrder),
    native_shopify_order_present: Boolean(nativeOrder),
    native_fulfillment_task_present: Boolean(task),
    customer_app_order_id: sanitizeId(customerOrder?.id, 120),
    native_shopify_order_id: sanitizeId(nativeOrder?.id, 120),
    native_fulfillment_task_id: sanitizeId(task?.id, 120),
    payment_status: sanitizeText(paymentStatus(customerOrder, nativeOrder), 80),
    payment_captured: captured,
    fulfillment_type: sanitizeText(fulfillment, 80),
    order_type: sanitizeText(type || 'one_time', 80),
    production_date: sanitizeText(productionDate, 40),
    delivery_date: sanitizeText(deliveryDate, 40),
    line_item_count: lineItems.length,
    production_demand_rows: safeProductionDemandRows(recipeAttached.demandRows).slice(0, DEFAULT_MAX_ROWS),
    bundle_decomposition_rows: expanded.bundleRows.slice(0, DEFAULT_MAX_ROWS),
    recipe_match_rows: recipeAttached.recipeRows.slice(0, DEFAULT_MAX_ROWS),
    ingredient_need_rows: ingredients.ingredientRows.slice(0, DEFAULT_MAX_ROWS),
    procurement_needed: ingredients.ingredientRows.some(row => row.procurement_needed),
    procurement_needed_count: ingredients.ingredientRows.filter(row => row.procurement_needed).length,
    missing_recipe_items: [...new Set(missingRecipeItems)].slice(0, DEFAULT_MAX_ROWS),
    ambiguous_recipe_items: [...new Set(ambiguousRecipeItems)].slice(0, DEFAULT_MAX_ROWS),
    missing_bundle_items: expanded.rows
      .filter(row => ['blocked_missing_bundle_components', 'blocked_missing_bundle_mapping'].includes(row.recipe_match_status))
      .map(row => row.source_line_item)
      .filter(Boolean)
      .slice(0, DEFAULT_MAX_ROWS),
    missing_inventory_items: [...new Set(missingInventoryItems)].slice(0, DEFAULT_MAX_ROWS),
    missing_yield_items: [...new Set(missingYieldItems)].slice(0, DEFAULT_MAX_ROWS),
    pending_yield_items: [...new Set(pendingYieldItems)].slice(0, DEFAULT_MAX_ROWS),
    yield_details_pending: pendingYieldItems.length > 0,
    trace_ingredient_items: [...new Set(traceIngredientItems)].slice(0, DEFAULT_MAX_ROWS),
    deferred_stock_unit_items: [...new Set(deferredStockUnitItems)].slice(0, DEFAULT_MAX_ROWS),
    unsupported_stock_unit_items: [...new Set(deferredStockUnitItems)].slice(0, DEFAULT_MAX_ROWS),
    inventory_shortfall_items: shortfallItems.slice(0, DEFAULT_MAX_ROWS),
    existing_production_batch_context_rows: existingBatchRows,
    production_ready: productionBlockers.length === 0 && recipeAttached.demandRows.length > 0,
    inventory_calculation_ready: inventoryBlockers.length === 0 && ingredients.ingredientRows.length > 0,
    procurement_conversion_ready: procurementConversionReady,
    inventory_deduction_ready: productionBlockers.length === 0 &&
      inventoryBlockers.length === 0 &&
      procurementConversionReady &&
      !ingredients.ingredientRows.some(row => row.procurement_needed),
    purchase_order_ready: false,
    hub_fallback_required: true,
    classification: uniqueBlockers.length === 0
      ? (procurementConversionWarnings
        ? 'production_ready_with_procurement_conversion_warnings'
        : (ingredients.ingredientRows.some(row => row.procurement_needed) ? 'production_inventory_preview_ready_procurement_needed' : 'production_inventory_preview_ready'))
      : productionBlockers.length === 0 && inventoryBlockers.length > 0
        ? 'production_ready_inventory_master_data_blocked'
        : 'blocked_master_data_or_order_context',
    blockers: uniqueBlockers,
    production_blockers: productionBlockers,
    inventory_blockers: inventoryBlockers,
    warnings: uniqueWarnings,
    safety: {
      dry_run_only: true,
      writes_performed: false,
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
    if (!hasExactLookup(lookup)) {
      return Response.json({ success: false, error_code: 'exact_order_required', message: 'order_number or exact target id is required' }, { status: 400 });
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
    const lineItems = safeLineItems({ customerOrder, nativeOrder, task });

    const [recipes, bundles, products, inventoryItems, ingredientYields, existingBatches] = await Promise.all([
      listEntity(base44, 'Recipe', 'product_name', 500),
      listEntity(base44, 'Bundle', 'bundle_name', 500),
      listEntity(base44, 'Product', 'title', 500),
      listEntity(base44, 'InventoryItem', 'ingredient', 500),
      listEntity(base44, 'IngredientYield', 'ingredient_name', 500),
      listEntity(base44, 'ProductionBatch', '-production_date', 500),
    ]);

    const readiness = buildProductionReadiness({
      customerOrder,
      nativeOrder,
      task,
      lookup,
      lineItems,
      masterData: { recipes, bundles, products, inventoryItems, ingredientYields },
      existingBatches,
    });

    return Response.json({
      ...readiness,
      function_name: 'previewNativeProductionInventoryReadiness',
      generated_at: new Date().toISOString(),
      request_id: sanitizeId(lookup.requestId, 120),
      actor_type: auth.actor_type,
      master_data_summary: {
        recipe_count: recipes.length,
        bundle_count: bundles.length,
        product_count: products.length,
        inventory_item_count: inventoryItems.length,
        ingredient_yield_count: ingredientYields.length,
        production_batch_context_count: existingBatches.length,
      },
    });
  } catch (error) {
    console.error(`[previewNativeProductionInventoryReadiness] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'native_production_inventory_readiness_failed',
      message: 'Native production/inventory readiness preview failed safely.',
      writes_performed: false,
    }, { status: 500 });
  }
});
