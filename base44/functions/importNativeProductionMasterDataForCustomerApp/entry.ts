import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const COMMAND_TYPE = 'customer_app_non_stock_master_data_import';
const FUNCTION_NAME = 'importNativeProductionMasterDataForCustomerApp';
const ENABLE_FLAG = 'ENABLE_NATIVE_PRODUCTION_MASTER_DATA_IMPORT';
const KILL_SWITCH_FLAG = 'NATIVE_PRODUCTION_MASTER_DATA_IMPORT_KILL_SWITCH';
const ALLOWED_EMAILS_FLAG = 'NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ALLOWED_EMAILS';
const ORDER_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ORDER_ALLOWLIST';
const ENTITY_ALLOWLIST_FLAG = 'NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ENTITY_ALLOWLIST';
const POLICY_FLAG = 'NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY';
const REQUIRED_POLICY = 'NON_STOCK_MASTER_DATA_ONLY';
const REQUIRED_YIELD_POLICY = 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES';
const CONFIRMATION_PHRASE = 'import_customer_app_non_stock_master_data';
const OWNER_APPROVAL_PHRASE = 'APPROVE G31I CUSTOMER APP NON STOCK COMPONENT MASTER DATA IMPORT NV-MPZNKGNT';
const TARGET_ORDER_NUMBER = 'NV-MPZNKGNT';
const TARGET_CUSTOMER_APP_ORDER_ID = '6a219a3f4adcda5856c3d579';
const TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a22ffda400eb806eb3ca945';
const TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a22ffdaf675ea79e30575aa';
const TARGET_TRIO_HUB_BUNDLE_ID = '69e8f55b06e17fbd88dbbc0c';
const WATERMELON_IMPORT_SCOPE = 'EXACT_RECIPE_ONLY';
const WATERMELON_RECIPE_NAME = 'Watermelon Juice';
const WATERMELON_HUB_RECIPE_ID = '69ed8a1fab9a16f8772096ec';
const WATERMELON_POLICY = 'EXACT_WATERMELON_JUICE_RECIPE_ONLY_NON_STOCK_NO_INVENTORY_NO_PO';
const WATERMELON_CONFIRMATION_PHRASE = 'import_watermelon_juice_recipe_non_stock_no_inventory_no_po';
const WATERMELON_TARGET_ORDER_NUMBER = 'NV-MP5SOQLJ';
const WATERMELON_TARGET_CUSTOMER_APP_ORDER_ID = '6a060df457fc07751f3c7ded';
const WATERMELON_TARGET_NATIVE_SHOPIFY_ORDER_ID = '6a2df0026e266e19c68046eb';
const WATERMELON_TARGET_NATIVE_FULFILLMENT_TASK_ID = '6a2eb72aa7ff194aafac49d3';
const WATERMELON_PREVIEW_MARKER = 'g33c_wm2_exact_watermelon_recipe_import';
const MAX_TEXT = 180;
const MAX_ROWS = 120;

const LEGACY_IMPORT_CONTRACT = Object.freeze({
  key: 'g31i_component_non_stock_master_data_import',
  commandType: COMMAND_TYPE,
  targetEntity: 'ProductionMasterData',
  targetId: TARGET_ORDER_NUMBER,
  targetDisplayId: TARGET_ORDER_NUMBER,
  targetOrderNumber: TARGET_ORDER_NUMBER,
  targetCustomerAppOrderId: TARGET_CUSTOMER_APP_ORDER_ID,
  targetNativeShopifyOrderId: TARGET_NATIVE_SHOPIFY_ORDER_ID,
  targetNativeFulfillmentTaskId: TARGET_NATIVE_FULFILLMENT_TASK_ID,
  requiredGatePolicy: REQUIRED_POLICY,
  requiredPreviewInventoryPolicy: REQUIRED_POLICY,
  requiredYieldPolicy: REQUIRED_YIELD_POLICY,
  confirmationPhrase: CONFIRMATION_PHRASE,
  ownerApprovalPhrase: OWNER_APPROVAL_PHRASE,
  expectedCreateCounts: null,
  expectedNames: null,
  requireDeferredYieldNames: true,
  previewLineItems: null,
  notes: 'G31I exact Customer App non-stock component production master-data import. Creates only approved Re-Nu/Aura/Oasis Recipe rows plus approved component InventoryItem and exact IngredientYield rows. No Black Salt/Beetroot yield, inventory deduction, PO, ProductionBatch, provider, notification, sync, repair, order, or task writes.',
});

const WATERMELON_IMPORT_CONTRACT = Object.freeze({
  key: 'g33c_wm2_watermelon_juice_recipe_import',
  commandType: 'watermelon_juice_recipe_import',
  targetEntity: 'Recipe',
  targetId: WATERMELON_RECIPE_NAME,
  targetDisplayId: WATERMELON_RECIPE_NAME,
  targetOrderNumber: WATERMELON_TARGET_ORDER_NUMBER,
  targetCustomerAppOrderId: WATERMELON_TARGET_CUSTOMER_APP_ORDER_ID,
  targetNativeShopifyOrderId: WATERMELON_TARGET_NATIVE_SHOPIFY_ORDER_ID,
  targetNativeFulfillmentTaskId: WATERMELON_TARGET_NATIVE_FULFILLMENT_TASK_ID,
  requiredGatePolicy: WATERMELON_POLICY,
  requiredPreviewInventoryPolicy: REQUIRED_POLICY,
  requiredYieldPolicy: REQUIRED_YIELD_POLICY,
  confirmationPhrase: WATERMELON_CONFIRMATION_PHRASE,
  ownerApprovalPhrase: '',
  importScope: WATERMELON_IMPORT_SCOPE,
  recipeName: WATERMELON_RECIPE_NAME,
  hubRecipeId: WATERMELON_HUB_RECIPE_ID,
  expectedCreateCounts: { Recipe: 1 },
  expectedNames: { Recipe: [WATERMELON_RECIPE_NAME] },
  requireDeferredYieldNames: false,
  previewLineItems: [{ title: WATERMELON_RECIPE_NAME, quantity: 1 }],
  notes: 'G33C-WM2 exact Watermelon Juice Recipe-only non-stock master-data import. Creates one Recipe row only. No InventoryItem, IngredientYield, Bundle, inventory deduction, PO, ProductionBatch, provider, notification, sync, repair, Hub, order, or task writes.',
});

const EXPECTED_CREATE_COUNTS = Object.freeze({
  Recipe: 3,
  InventoryItem: 10,
  IngredientYield: 10,
});

const EXPECTED_NAMES = Object.freeze({
  Recipe: ['Re-Nu', 'Aura', 'Oasis'],
  InventoryItem: ['Cucumber', 'Green Apple', 'Celery', 'Kale', 'Carrot', 'Orange', 'Coconut Water', 'Sea Salt', 'Watermelon', 'Black Pepper'],
  IngredientYield: ['Cucumber', 'Green Apple', 'Celery', 'Kale', 'Carrot', 'Orange', 'Coconut Water', 'Sea Salt', 'Watermelon', 'Black Pepper'],
});

const DEFERRED_YIELD_NAMES = Object.freeze(['Black Salt', 'Beetroot']);

const ALLOWED_FIELDS = Object.freeze({
  Bundle: ['bundle_name', 'components', 'fulfillment_count', 'is_active', 'notes'],
  Recipe: ['product_name', 'product_sku', 'bottle_size_oz', 'yield_factor', 'ingredients', 'is_active'],
  InventoryItem: [
    'ingredient',
    'unit',
    'stock',
    'reorder_point',
    'max_stock',
    'supplier',
    'supplier_packaging_unit',
    'supplier_packaging_qty',
    'category',
    'notes',
  ],
  IngredientYield: [
    'ingredient_name',
    'purchase_unit',
    'oz_per_purchase_unit',
    'trim_waste_factor',
    'units_per_case',
    'split_case_allowed',
    'rounding_rule',
    'supplier',
  ],
});

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

function safeText(value, maxLength = MAX_TEXT) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted provider id]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted shopify id]');
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function safeId(value, maxLength = MAX_TEXT) {
  const text = safeText(value, maxLength);
  return text && /^[A-Za-z0-9._:@/#-]+$/.test(text) ? text : '';
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvSet(value) {
  return new Set(normalizeText(value).split(',').map(normalizeLower).filter(Boolean));
}

function jsonResponse(body, status = 200) {
  return Response.json(body, { status });
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

function getLookup(body) {
  return {
    orderNumber: normalizeText(body?.order_number || body?.shopify_order_number || body?.number).replace(/^#/, ''),
    customerAppOrderId: safeId(body?.customer_app_order_id || body?.base44_order_id || body?.order_id, 120),
    nativeShopifyOrderId: safeId(body?.native_shopify_order_id || body?.native_order_id || body?.shopify_order_id, 120),
    nativeFulfillmentTaskId: safeId(body?.native_fulfillment_task_id || body?.fulfillment_task_id || body?.task_id, 120),
    requestId: safeId(body?.request_id, 160),
    recipeName: safeText(body?.recipe_name || body?.product_or_recipe_name || body?.product_name, 120),
    hubRecipeId: safeId(body?.hub_recipe_id, 120),
    importScope: normalizeText(body?.import_scope),
  };
}

function expectedPreviewSecret() {
  return normalizeText(Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET')) ||
    normalizeText(Deno.env.get('CUSTOMER_APP_SYNC_SECRET')) ||
    normalizeText(Deno.env.get('HUB_SYNC_SECRET'));
}

function isWatermelonImportRequest(body = {}) {
  return normalizeText(body?.import_scope) === WATERMELON_IMPORT_SCOPE ||
    normalizeKey(body?.recipe_name || body?.product_or_recipe_name || body?.product_name) === normalizeKey(WATERMELON_RECIPE_NAME) ||
    normalizeText(body?.confirmation) === WATERMELON_CONFIRMATION_PHRASE ||
    normalizeText(body?.hub_recipe_id) === WATERMELON_HUB_RECIPE_ID ||
    normalizeText(body?.inventory_policy) === WATERMELON_POLICY ||
    normalizeText(body?.policy) === WATERMELON_POLICY;
}

function resolveImportContract(body = {}) {
  return isWatermelonImportRequest(body) ? WATERMELON_IMPORT_CONTRACT : LEGACY_IMPORT_CONTRACT;
}

function exactTargetBlockers(lookup, contract = LEGACY_IMPORT_CONTRACT) {
  const blockers = [];
  if (lookup.orderNumber !== contract.targetOrderNumber) blockers.push('target_order_number_mismatch');
  const requireExactIds = contract.key === WATERMELON_IMPORT_CONTRACT.key;
  if ((requireExactIds || lookup.customerAppOrderId) && lookup.customerAppOrderId !== contract.targetCustomerAppOrderId) blockers.push('target_customer_app_order_id_mismatch');
  if ((requireExactIds || lookup.nativeShopifyOrderId) && lookup.nativeShopifyOrderId !== contract.targetNativeShopifyOrderId) blockers.push('target_native_shopify_order_id_mismatch');
  if ((requireExactIds || lookup.nativeFulfillmentTaskId) && lookup.nativeFulfillmentTaskId !== contract.targetNativeFulfillmentTaskId) blockers.push('target_native_fulfillment_task_id_mismatch');
  if (contract.key === WATERMELON_IMPORT_CONTRACT.key) {
    if (lookup.importScope !== contract.importScope) blockers.push('import_scope_mismatch');
    if (normalizeKey(lookup.recipeName) !== normalizeKey(contract.recipeName)) blockers.push('recipe_name_mismatch');
    if (lookup.hubRecipeId !== contract.hubRecipeId) blockers.push('hub_recipe_id_mismatch');
  }
  return blockers;
}

function gateFailure({ actorEmail, lookup, contract = LEGACY_IMPORT_CONTRACT }) {
  if (Deno.env.get(KILL_SWITCH_FLAG) === 'true') return 'kill_switch_active';
  if (Deno.env.get(ENABLE_FLAG) !== 'true') return 'native_production_master_data_import_disabled';
  if (normalizeText(Deno.env.get(POLICY_FLAG)) !== contract.requiredGatePolicy) {
    return contract.key === WATERMELON_IMPORT_CONTRACT.key
      ? 'watermelon_recipe_import_policy_required'
      : 'non_stock_master_data_policy_required';
  }

  const allowedEmails = parseCsvSet(Deno.env.get(ALLOWED_EMAILS_FLAG) || '');
  if (allowedEmails.size === 0) return 'allowed_email_gate_required';
  if (!allowedEmails.has(normalizeLower(actorEmail))) return 'actor_email_not_allowlisted';

  const allowlist = parseCsvSet(Deno.env.get(ORDER_ALLOWLIST_FLAG) || '');
  if (allowlist.size === 0) return 'order_allowlist_required';
  const candidates = [
    lookup.orderNumber,
    lookup.customerAppOrderId,
    lookup.nativeShopifyOrderId,
    lookup.nativeFulfillmentTaskId,
    contract.targetCustomerAppOrderId,
    contract.targetNativeShopifyOrderId,
    contract.targetNativeFulfillmentTaskId,
  ].map(normalizeLower).filter(Boolean);
  if (!candidates.some(candidate => allowlist.has(candidate))) return 'order_not_allowlisted';

  if (contract.key === WATERMELON_IMPORT_CONTRACT.key) {
    const entityAllowlist = parseCsvSet(Deno.env.get(ENTITY_ALLOWLIST_FLAG) || '');
    if (entityAllowlist.size === 0) return 'entity_allowlist_required';
    const entityCandidates = [
      contract.recipeName,
      contract.hubRecipeId,
      `recipe:${contract.recipeName}`,
      `hub_recipe:${contract.hubRecipeId}`,
      WATERMELON_PREVIEW_MARKER,
    ].map(normalizeLower).filter(Boolean);
    if (!entityCandidates.some(candidate => entityAllowlist.has(candidate))) return 'entity_not_allowlisted';
  }
  return null;
}

async function fetchFreshPreview(base44, lookup, contract = LEGACY_IMPORT_CONTRACT) {
  const secret = expectedPreviewSecret();
  if (!secret) {
    return { ok: false, status: 409, error_code: 'preview_secret_not_configured', data: null };
  }

  const payload = {
    mode: 'dry_run',
    order_number: contract.targetOrderNumber,
    customer_app_order_id: lookup.customerAppOrderId || contract.targetCustomerAppOrderId,
    native_shopify_order_id: lookup.nativeShopifyOrderId || contract.targetNativeShopifyOrderId,
    native_fulfillment_task_id: lookup.nativeFulfillmentTaskId || contract.targetNativeFulfillmentTaskId,
    request_id: `${lookup.requestId || contract.key}:fresh_preview`,
    _internal_secret: secret,
  };
  if (Array.isArray(contract.previewLineItems)) payload.line_items = contract.previewLineItems;

  try {
    const response = await base44.asServiceRole.functions.invoke('previewNativeProductionMasterDataParity', payload);
    const data = response?.data || response;
    if (!data?.success) {
      return {
        ok: false,
        status: 409,
        error_code: data?.error_code || 'fresh_preview_not_successful',
        data,
      };
    }
    return { ok: true, status: 200, data };
  } catch (error) {
    const status = error?.response?.status || error?.status || 502;
    const data = error?.response?.data || error?.data || null;
    return {
      ok: false,
      status,
      error_code: data?.error_code || `fresh_preview_invoke_${status}`,
      data,
    };
  }
}

function fieldValueForRow(row) {
  const payload = row?.payload || {};
  if (row?.target_entity === 'Recipe') return payload.product_name || row.match_value;
  if (row?.target_entity === 'Bundle') return payload.bundle_name || row.match_value;
  if (row?.target_entity === 'InventoryItem') return payload.ingredient || row.match_value;
  if (row?.target_entity === 'IngredientYield') return payload.ingredient_name || row.match_value;
  return row?.match_value;
}

function sortedKeys(values) {
  return [...values].map(normalizeKey).filter(Boolean).sort();
}

function sameNameSet(actual, expected) {
  return JSON.stringify(sortedKeys(actual)) === JSON.stringify(sortedKeys(expected));
}

function entityCounts(rows) {
  return (rows || []).reduce((acc, row) => {
    acc[row.target_entity] = (acc[row.target_entity] || 0) + 1;
    return acc;
  }, {});
}

function rowsByEntity(rows, entityName) {
  return (rows || []).filter(row => row.target_entity === entityName);
}

function createRowNames(rows, entityName) {
  return rowsByEntity(rows, entityName).map(fieldValueForRow);
}

function hubRecipeMatch(preview, recipeName) {
  return (preview?.hub_recipe_matches || []).find(row =>
    normalizeKey(row?.requested_name) === normalizeKey(recipeName) ||
    normalizeKey(row?.matches?.[0]?.name) === normalizeKey(recipeName)
  ) || null;
}

function validatePayloadShape(entityName, payload) {
  const blockers = [];
  const allowed = new Set(ALLOWED_FIELDS[entityName] || []);
  for (const field of Object.keys(payload || {})) {
    if (!allowed.has(field)) blockers.push(`unapproved_${entityName}_field:${field}`);
  }

  if (entityName === 'Recipe') {
    if (!payload.product_name) blockers.push('recipe_product_name_required');
    if (payload.product_sku !== undefined && typeof payload.product_sku !== 'string') blockers.push('recipe_product_sku_must_be_string');
    if (payload.bottle_size_oz !== undefined && numberOrNull(payload.bottle_size_oz) === null) blockers.push('recipe_bottle_size_must_be_number');
    if (payload.yield_factor !== undefined && numberOrNull(payload.yield_factor) === null) blockers.push('recipe_yield_factor_must_be_number');
    if (!Array.isArray(payload.ingredients)) blockers.push('recipe_ingredients_array_required');
    for (const ingredient of payload.ingredients || []) {
      if (!ingredient?.ingredient_name) blockers.push('recipe_ingredient_name_required');
      if (numberOrNull(ingredient?.quantity_oz) === null) blockers.push('recipe_ingredient_quantity_oz_number_required');
      for (const key of Object.keys(ingredient || {})) {
        if (!['ingredient_name', 'quantity_oz', 'unit'].includes(key)) blockers.push(`unapproved_recipe_ingredient_field:${key}`);
      }
    }
  } else if (entityName === 'Bundle') {
    if (!payload.bundle_name) blockers.push('bundle_name_required');
    if (!Array.isArray(payload.components)) blockers.push('bundle_components_array_required');
    if (Array.isArray(payload.components) && payload.components.length === 0) blockers.push('bundle_components_required');
    for (const component of payload.components || []) {
      if (!component?.product_name) blockers.push('bundle_component_product_name_required');
      if (numberOrNull(component?.quantity) === null) blockers.push('bundle_component_quantity_number_required');
      for (const key of Object.keys(component || {})) {
        if (!['product_name', 'quantity'].includes(key)) blockers.push(`unapproved_bundle_component_field:${key}`);
      }
    }
  } else if (entityName === 'InventoryItem') {
    if (!payload.ingredient) blockers.push('inventory_ingredient_required');
    if (!payload.unit) blockers.push('inventory_unit_required');
    if (numberOrNull(payload.stock) !== 0) blockers.push('inventory_stock_must_seed_zero');
    if (numberOrNull(payload.reorder_point) === null) blockers.push('inventory_reorder_point_number_required');
  } else if (entityName === 'IngredientYield') {
    if (!payload.ingredient_name) blockers.push('yield_ingredient_name_required');
    if (!payload.purchase_unit) blockers.push('yield_purchase_unit_required');
    if (numberOrNull(payload.oz_per_purchase_unit) === null) blockers.push('yield_oz_per_purchase_unit_number_required');
  } else {
    blockers.push('unsupported_target_entity');
  }
  return blockers;
}

function validateWatermelonImportPreview(preview) {
  const blockers = [];
  const warnings = [];
  const importPreview = preview?.customer_app_non_stock_master_data_import_preview || {};
  const createRows = Array.isArray(importPreview.create_rows) ? importPreview.create_rows : [];
  const deferredRows = Array.isArray(importPreview.deferred_rows) ? importPreview.deferred_rows : [];
  const blockedRows = Array.isArray(importPreview.blocked_rows) ? importPreview.blocked_rows : [];
  const recipeRows = rowsByEntity(createRows, 'Recipe');
  const nonRecipeRows = createRows.filter(row => row.target_entity !== 'Recipe');
  const recipeRow = recipeRows[0] || null;
  const recipePayload = recipeRow?.payload || {};
  const hubRecipe = hubRecipeMatch(preview, WATERMELON_RECIPE_NAME);

  if (!preview?.success) blockers.push('fresh_preview_failed');
  if (preview?.order_number !== WATERMELON_TARGET_ORDER_NUMBER) blockers.push('fresh_preview_target_order_mismatch');
  if (preview?.customer_app_order_id !== WATERMELON_TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('fresh_preview_customer_app_order_id_mismatch');
  if (preview?.native_shopify_order_id !== WATERMELON_TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('fresh_preview_native_shopify_order_id_mismatch');
  if (preview?.native_fulfillment_task_id !== WATERMELON_TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('fresh_preview_native_task_id_mismatch');
  if (!Array.isArray(preview?.line_item_names) || preview.line_item_names.length !== 1 || normalizeKey(preview.line_item_names[0]) !== normalizeKey(WATERMELON_RECIPE_NAME)) {
    blockers.push('fresh_preview_not_watermelon_only');
  }
  if (!(preview?.missing_native_recipes || []).some(name => normalizeKey(name) === normalizeKey(WATERMELON_RECIPE_NAME))) blockers.push('watermelon_native_recipe_not_missing');
  if (!hubRecipe || hubRecipe.status !== 'matched') blockers.push('hub_watermelon_recipe_missing');
  if (hubRecipe?.matches?.[0]?.id !== WATERMELON_HUB_RECIPE_ID) blockers.push('hub_watermelon_recipe_id_mismatch');
  if (preview?.non_stock_import_preview_ready !== true && importPreview.import_ready !== true) blockers.push('non_stock_import_preview_not_ready');
  if (preview?.seed_packet_ready !== true && preview?.non_stock_master_data_seed_ready !== true) blockers.push('seed_packet_not_ready');
  if (preview?.inventory_seed_policy !== REQUIRED_POLICY || importPreview.inventory_seed_policy !== REQUIRED_POLICY) blockers.push('inventory_seed_policy_mismatch');
  if (preview?.yield_policy !== REQUIRED_YIELD_POLICY || importPreview.yield_policy !== REQUIRED_YIELD_POLICY) blockers.push('yield_policy_mismatch');
  if (preview?.procurement_conversion_ready !== true || importPreview.procurement_conversion_ready !== true) blockers.push('procurement_conversion_not_ready');
  if (preview?.yield_details_pending === true || importPreview.yield_details_pending === true) blockers.push('yield_details_should_not_be_pending');
  if (preview?.inventory_deduction_ready !== false || importPreview.inventory_deduction_ready !== false) blockers.push('inventory_deduction_should_remain_held');
  if (preview?.production_master_data_ready !== true) blockers.push('production_master_data_not_ready');

  if (Number(importPreview.create_row_count) !== 1 || createRows.length !== 1) blockers.push('unexpected_create_row_count');
  if (recipeRows.length !== 1) blockers.push('unexpected_Recipe_create_count');
  if (nonRecipeRows.length > 0) blockers.push('unexpected_non_recipe_create_rows');
  if (rowsByEntity(createRows, 'InventoryItem').length > 0) blockers.push('inventory_item_create_not_allowed');
  if (rowsByEntity(createRows, 'IngredientYield').length > 0) blockers.push('ingredient_yield_create_not_allowed');
  if (rowsByEntity(createRows, 'Bundle').length > 0) blockers.push('bundle_create_not_allowed');
  if (deferredRows.length > 0) blockers.push('deferred_rows_not_allowed');
  if (blockedRows.length > 0 || (importPreview.blockers || []).length > 0 || (preview?.blockers || []).length > 0) blockers.push('fresh_preview_contains_blockers');
  if (!sameNameSet(createRowNames(createRows, 'Recipe'), [WATERMELON_RECIPE_NAME])) blockers.push('unexpected_Recipe_names');
  if (recipeRow?.operation !== 'create_if_missing') blockers.push(`unsupported_operation:${recipeRow?.operation || 'missing'}`);
  if (recipeRow?.import_ready !== true) blockers.push('watermelon_recipe_create_row_not_import_ready');
  if (!recipeRow?.match_field || !recipeRow?.match_value) blockers.push('missing_match_contract:Recipe');
  if (recipeRow?.source_hub_id !== WATERMELON_HUB_RECIPE_ID) blockers.push('watermelon_recipe_source_hub_id_mismatch');
  blockers.push(...validatePayloadShape('Recipe', recipePayload).map(item => `Recipe:${WATERMELON_RECIPE_NAME}:${item}`));
  if (normalizeKey(recipePayload.product_name) !== normalizeKey(WATERMELON_RECIPE_NAME)) blockers.push('watermelon_recipe_payload_name_mismatch');
  if (numberOrNull(recipePayload.bottle_size_oz) !== 32) blockers.push('watermelon_recipe_bottle_size_mismatch');
  if (numberOrNull(recipePayload.yield_factor) !== 1.05) blockers.push('watermelon_recipe_yield_factor_mismatch');
  if (!Array.isArray(recipePayload.ingredients) || recipePayload.ingredients.length !== 1) blockers.push('watermelon_recipe_ingredient_count_mismatch');
  const ingredient = recipePayload.ingredients?.[0] || {};
  if (normalizeKey(ingredient.ingredient_name) !== normalizeKey('Watermelon')) blockers.push('watermelon_recipe_ingredient_name_mismatch');
  if (numberOrNull(ingredient.quantity_oz) !== 32) blockers.push('watermelon_recipe_ingredient_quantity_mismatch');
  if (normalizeLower(ingredient.unit) !== 'oz') blockers.push('watermelon_recipe_ingredient_unit_mismatch');
  if (recipePayload.is_active !== true) blockers.push('watermelon_recipe_must_be_active');

  if ((importPreview.warnings || []).includes('preview_only_no_master_data_import_performed')) {
    warnings.push('fresh_preview_confirmed_read_only');
  }

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].slice(0, 80),
    warnings: [...new Set(warnings.concat(importPreview.warnings || []))].slice(0, 80),
    createRows,
    deferredRows,
    importPreview,
  };
}

function validateLegacyImportPreview(preview) {
  const blockers = [];
  const warnings = [];
  const importPreview = preview?.customer_app_non_stock_master_data_import_preview || {};
  const createRows = Array.isArray(importPreview.create_rows) ? importPreview.create_rows : [];
  const deferredRows = Array.isArray(importPreview.deferred_rows) ? importPreview.deferred_rows : [];

  if (!preview?.success) blockers.push('fresh_preview_failed');
  if (preview?.order_number !== TARGET_ORDER_NUMBER) blockers.push('fresh_preview_target_order_mismatch');
  if (preview?.customer_app_order_id !== TARGET_CUSTOMER_APP_ORDER_ID) blockers.push('fresh_preview_customer_app_order_id_mismatch');
  if (preview?.native_shopify_order_id !== TARGET_NATIVE_SHOPIFY_ORDER_ID) blockers.push('fresh_preview_native_shopify_order_id_mismatch');
  if (preview?.native_fulfillment_task_id !== TARGET_NATIVE_FULFILLMENT_TASK_ID) blockers.push('fresh_preview_native_task_id_mismatch');
  if (preview?.non_stock_import_preview_ready !== true && importPreview.import_ready !== true) blockers.push('non_stock_import_preview_not_ready');
  if (preview?.inventory_seed_policy !== REQUIRED_POLICY || importPreview.inventory_seed_policy !== REQUIRED_POLICY) blockers.push('inventory_seed_policy_mismatch');
  if (preview?.yield_policy !== REQUIRED_YIELD_POLICY || importPreview.yield_policy !== REQUIRED_YIELD_POLICY) blockers.push('yield_policy_mismatch');
  if (preview?.procurement_conversion_ready !== false || importPreview.procurement_conversion_ready !== false) blockers.push('procurement_conversion_should_remain_pending');
  if (preview?.inventory_deduction_ready !== false || importPreview.inventory_deduction_ready !== false) blockers.push('inventory_deduction_should_remain_held');
  if (preview?.production_master_data_ready !== true) blockers.push('production_master_data_not_ready');

  if (Number(importPreview.create_row_count) !== 23 || createRows.length !== 23) blockers.push('unexpected_create_row_count');
  if (Number(importPreview.deferred_row_count) !== 2 || deferredRows.length !== 2) blockers.push('unexpected_deferred_row_count');
  if ((importPreview.blocked_rows || []).length > 0 || (importPreview.blockers || []).length > 0) blockers.push('fresh_preview_contains_blockers');

  const counts = entityCounts(createRows);
  for (const [entityName, expectedCount] of Object.entries(EXPECTED_CREATE_COUNTS)) {
    if (Number(counts[entityName] || 0) !== expectedCount) blockers.push(`unexpected_${entityName}_create_count`);
    const actualNames = createRows.filter(row => row.target_entity === entityName).map(fieldValueForRow);
    if (!sameNameSet(actualNames, EXPECTED_NAMES[entityName])) blockers.push(`unexpected_${entityName}_names`);
  }

  if (!sameNameSet(deferredRows.map(row => row.match_value), DEFERRED_YIELD_NAMES)) blockers.push('unexpected_deferred_yield_names');
  const yieldNames = createRows.filter(row => row.target_entity === 'IngredientYield').map(fieldValueForRow).map(normalizeKey);
  for (const deferredName of DEFERRED_YIELD_NAMES) {
    if (yieldNames.includes(normalizeKey(deferredName))) blockers.push(`deferred_yield_would_be_created:${deferredName}`);
  }

  const approvedAlias = (preview?.approved_alias_mappings || []).find(mapping =>
    normalizeKey(mapping?.source_name) === normalizeKey('The NuVira Trio') &&
    normalizeKey(mapping?.target_hub_name) === normalizeKey('NuVira Trio')
  );
  if (!approvedAlias) blockers.push('approved_trio_alias_mapping_missing');
  if (approvedAlias && approvedAlias.target_hub_id !== TARGET_TRIO_HUB_BUNDLE_ID) blockers.push('approved_trio_alias_hub_id_mismatch');
  if (createRows.some(row => row.target_entity === 'Bundle')) blockers.push('unexpected_bundle_create_row');

  for (const row of createRows) {
    if (row.operation !== 'create_if_missing') blockers.push(`unsupported_operation:${row.operation || 'missing'}`);
    if (row.import_ready !== true) blockers.push(`create_row_not_import_ready:${row.target_entity}:${row.match_value}`);
    if (!ALLOWED_FIELDS[row.target_entity]) blockers.push(`unsupported_target_entity:${row.target_entity || 'missing'}`);
    if (!row.match_field || !row.match_value) blockers.push(`missing_match_contract:${row.target_entity || 'missing'}`);
    blockers.push(...validatePayloadShape(row.target_entity, row.payload || {}).map(item => `${row.target_entity}:${fieldValueForRow(row)}:${item}`));
  }

  if ((importPreview.warnings || []).includes('preview_only_no_master_data_import_performed')) {
    warnings.push('fresh_preview_confirmed_read_only');
  }

  return {
    ready: blockers.length === 0,
    blockers: [...new Set(blockers)].slice(0, 80),
    warnings: [...new Set(warnings.concat(importPreview.warnings || []))].slice(0, 80),
    createRows,
    deferredRows,
    importPreview,
  };
}

function validateImportPreview(preview, contract = LEGACY_IMPORT_CONTRACT) {
  return contract.key === WATERMELON_IMPORT_CONTRACT.key
    ? validateWatermelonImportPreview(preview)
    : validateLegacyImportPreview(preview);
}

function matchFilterForRow(row) {
  const value = fieldValueForRow(row);
  if (row.target_entity === 'Recipe') return { product_name: value };
  if (row.target_entity === 'Bundle') return { bundle_name: value };
  if (row.target_entity === 'InventoryItem') return { ingredient: value };
  if (row.target_entity === 'IngredientYield') return { ingredient_name: value };
  return {};
}

function exactPolicyInputBlockers(body, contract = LEGACY_IMPORT_CONTRACT) {
  const blockers = [];
  if (contract.key !== WATERMELON_IMPORT_CONTRACT.key) return blockers;

  if (normalizeText(body?.import_scope) !== WATERMELON_IMPORT_SCOPE) blockers.push('import_scope_required');
  if (normalizeKey(body?.recipe_name || body?.product_or_recipe_name || body?.product_name) !== normalizeKey(WATERMELON_RECIPE_NAME)) blockers.push('recipe_name_required');
  if (safeId(body?.hub_recipe_id, 120) !== WATERMELON_HUB_RECIPE_ID) blockers.push('hub_recipe_id_required');
  if (normalizeText(body?.inventory_policy) !== REQUIRED_POLICY) blockers.push('inventory_policy_required');
  if (normalizeText(body?.inventory_deduction_policy) !== 'HELD') blockers.push('inventory_deduction_policy_held_required');
  if (normalizeText(body?.purchase_order_policy) !== 'HELD') blockers.push('purchase_order_policy_held_required');
  if (normalizeText(body?.notification_policy) !== 'NO_NOTIFICATION') blockers.push('notification_policy_required');
  if (normalizeText(body?.provider_call_policy) !== 'NO_PROVIDER_CALLS') blockers.push('provider_call_policy_required');
  if (normalizeText(body?.hub_mutation_policy) !== 'NO_HUB_MUTATION') blockers.push('hub_mutation_policy_required');

  const forbiddenTruthyFields = [
    'create_inventory_item',
    'update_inventory_item',
    'create_ingredient_yield',
    'update_ingredient_yield',
    'create_bundle',
    'update_bundle',
    'create_production_batch',
    'create_batch_compliance_log',
    'deduct_inventory',
    'create_purchase_order',
    'send_notification',
    'call_provider',
    'call_shopify',
    'call_stripe',
    'sync_repair_replay',
    'bulk_recipe_import',
    'broad_master_data_import',
  ];
  for (const field of forbiddenTruthyFields) {
    if (body?.[field] === true || normalizeText(body?.[field]) === 'true') blockers.push(`forbidden_input:${field}`);
  }
  if (body?.raw_hub_payload || body?.raw_shopify_payload || body?.raw_stripe_payload || body?.provider_payload) blockers.push('raw_payload_input_forbidden');
  return blockers;
}

async function findExistingRow(base44, row) {
  const entity = base44.asServiceRole?.entities?.[row.target_entity];
  if (!entity?.filter) return [];
  return entity.filter(matchFilterForRow(row), '-created_date', 5).catch(() => []);
}

async function findExistingCommandLog(base44, idempotencyKey) {
  return base44.asServiceRole.entities.CommandLog.filter({ idempotency_key: idempotencyKey }, '-created_date', 1).catch(() => []);
}

async function createCommandLog({ base44, status, idempotencyKey, requestId, user, result, errorCode, errorMessage, contract = LEGACY_IMPORT_CONTRACT }) {
  const now = new Date().toISOString();
  return base44.asServiceRole.entities.CommandLog.create({
    command_type: contract.commandType,
    command_source: 'customer_app_native_admin',
    status,
    target_entity: contract.targetEntity,
    target_id: contract.targetId,
    target_display_id: contract.targetDisplayId,
    actor_email: safeText(user?.email, 180) || null,
    actor_role: safeText(user?.role, 80) || null,
    actor_type: 'admin',
    payload: {
      exact_order_allowlist: true,
      order_number: contract.targetOrderNumber,
      customer_app_order_id: contract.targetCustomerAppOrderId,
      native_shopify_order_id: contract.targetNativeShopifyOrderId,
      native_fulfillment_task_id: contract.targetNativeFulfillmentTaskId,
      import_contract: contract.key,
      import_scope: contract.importScope || 'G31I_COMPONENT_MASTER_DATA',
      recipe_name: contract.recipeName || null,
      hub_recipe_id: contract.hubRecipeId || null,
      inventory_seed_policy: REQUIRED_POLICY,
      yield_policy: REQUIRED_YIELD_POLICY,
      gate_policy: contract.requiredGatePolicy,
      approved_alias: contract.key === LEGACY_IMPORT_CONTRACT.key ? 'The NuVira Trio -> NuVira Trio' : null,
      import_phase: contract.key,
      no_inventory_deduction: true,
      no_purchase_order: true,
      no_notification: true,
      no_provider_calls: true,
      no_hub_mutation: true,
    },
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 180) : null,
    idempotency_key: idempotencyKey,
    idempotent_skipped: status === 'skipped',
    request_id: requestId,
    submitted_at: now,
    completed_at: status === 'running' ? null : now,
    function_name: FUNCTION_NAME,
    related_order_number: contract.targetOrderNumber,
    related_order_id: contract.targetCustomerAppOrderId,
    notes: contract.notes,
  });
}

async function updateCommandLog({ base44, commandLogId, status, result, errorCode, errorMessage }) {
  if (!commandLogId) return null;
  return base44.asServiceRole.entities.CommandLog.update(commandLogId, {
    status,
    result,
    error_code: errorCode || null,
    error_message: errorMessage ? safeText(errorMessage, 180) : null,
    idempotent_skipped: status === 'skipped',
    completed_at: new Date().toISOString(),
  });
}

function summarizeCreateRow(row, created) {
  return {
    target_entity: row.target_entity,
    match_field: row.match_field,
    match_value: safeText(row.match_value, 120),
    created_id: safeId(created?.id, 120) || null,
    source_hub_id: safeId(row.source_hub_id, 120) || null,
    stock: row.target_entity === 'InventoryItem' ? numberOrNull(row.payload?.stock) : undefined,
  };
}

async function preflightExistingRows(base44, createRows) {
  const existingRows = [];
  for (const row of createRows) {
    const found = await findExistingRow(base44, row);
    if (Array.isArray(found) && found.length > 0) {
      existingRows.push({
        target_entity: row.target_entity,
        match_value: safeText(fieldValueForRow(row), 120),
        existing_count: found.length,
        existing_ids: found.slice(0, 3).map(item => safeId(item?.id, 120)).filter(Boolean),
      });
    }
  }
  return existingRows;
}

async function createRows(base44, rows) {
  const createdRows = [];
  for (const row of rows) {
    const entity = base44.asServiceRole?.entities?.[row.target_entity];
    if (!entity?.create) throw new Error(`Entity create unavailable: ${row.target_entity}`);
    const created = await entity.create(row.payload);
    createdRows.push(summarizeCreateRow(row, created));
  }
  return createdRows;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return jsonResponse({ success: false, error_code: 'method_not_allowed', message: 'POST required', writes_performed: false }, 405);
    }

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return jsonResponse({ success: false, error_code: 'malformed_json', writes_performed: false }, 400);
    const body = parsed.body || {};

    const base44 = createClientFromRequest(req);
    let user;
    try {
      user = await base44.auth.me();
    } catch {
      return jsonResponse({ success: false, error_code: 'unauthorized', writes_performed: false }, 401);
    }
    if (user?.role !== 'admin') return jsonResponse({ success: false, error_code: 'forbidden', writes_performed: false }, 403);

    const lookup = getLookup(body);
    const contract = resolveImportContract(body);

    if (
      normalizeText(body.confirmation) !== contract.confirmationPhrase ||
      (contract.ownerApprovalPhrase && normalizeText(body.approval_phrase) !== contract.ownerApprovalPhrase) ||
      normalizeLower(body.mode) !== 'live'
    ) {
      return jsonResponse({ success: false, error_code: 'confirmation_required', writes_performed: false }, 400);
    }
    if (!lookup.requestId) return jsonResponse({ success: false, error_code: 'request_id_required', writes_performed: false }, 400);

    const inputBlockers = exactPolicyInputBlockers(body, contract);
    if (inputBlockers.length > 0) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'exact_policy_inputs_required',
        blockers: inputBlockers,
        writes_performed: false,
      }, 400);
    }

    const targetBlockers = exactTargetBlockers(lookup, contract);
    if (targetBlockers.length > 0) {
      return jsonResponse({ success: false, skipped: true, error_code: 'exact_target_required', blockers: targetBlockers, writes_performed: false }, 409);
    }

    const gate = gateFailure({ actorEmail: user.email, lookup, contract });
    if (gate) return jsonResponse({ success: false, skipped: true, error_code: gate, writes_performed: false }, 409);

    const idempotencyKey = `${contract.commandType}:${lookup.requestId}`;
    const existingLogs = await findExistingCommandLog(base44, idempotencyKey);
    const existingLog = Array.isArray(existingLogs) && existingLogs.length > 0 ? existingLogs[0] : null;
    if (existingLog && existingLog.status !== 'failed') {
      return jsonResponse({
        success: true,
        skipped: true,
        idempotent: true,
        reason: 'idempotency_log_present',
        request_id: lookup.requestId,
        idempotency_key: idempotencyKey,
        command_log_id: safeId(existingLog.id, 120) || null,
        writes_performed: false,
        duplicate_master_data_created: false,
      });
    }

    const freshPreview = await fetchFreshPreview(base44, lookup, contract);
    if (!freshPreview.ok) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: freshPreview.error_code || 'fresh_preview_failed',
        preview_status: freshPreview.status,
        writes_performed: false,
      }, freshPreview.status || 409);
    }

    const validation = validateImportPreview(freshPreview.data, contract);
    if (!validation.ready) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'fresh_import_preview_not_clean',
        blockers: validation.blockers,
        warnings: validation.warnings,
        writes_performed: false,
      }, 409);
    }

    const existingMasterData = await preflightExistingRows(base44, validation.createRows);
    if (existingMasterData.length > 0) {
      return jsonResponse({
        success: false,
        skipped: true,
        error_code: 'target_master_data_already_exists',
        existing_rows: existingMasterData,
        writes_performed: false,
      }, 409);
    }

    const commandLog = await createCommandLog({
      base44,
      status: 'running',
      idempotencyKey,
      requestId: lookup.requestId,
      user,
        result: {
          writes_performed: false,
          projected_create_row_count: validation.createRows.length,
          projected_create_rows_by_entity: entityCounts(validation.createRows),
          deferred_rows: validation.deferredRows.map(row => ({ target_entity: row.target_entity, match_value: safeText(row.match_value, 120), reason: row.reason })),
          inventory_seed_policy: REQUIRED_POLICY,
          yield_policy: REQUIRED_YIELD_POLICY,
          import_contract: contract.key,
          recipe_name: contract.recipeName || null,
          inventory_deducted: false,
          purchase_orders_created: false,
          provider_calls_performed: false,
          notifications_sent: false,
          hub_records_updated: false,
        },
        contract,
      });

    let created = [];
    try {
      created = await createRows(base44, validation.createRows);
    } catch (error) {
      await updateCommandLog({
        base44,
        commandLogId: commandLog?.id,
        status: 'failed',
        result: {
          writes_performed: created.length > 0,
          partial_create_count: created.length,
          created_rows: created,
          inventory_deducted: false,
          purchase_orders_created: false,
          production_batches_created: false,
          provider_calls_performed: false,
          notifications_sent: false,
          sync_repair_replay_performed: false,
        },
        errorCode: 'master_data_import_write_failed',
        errorMessage: error?.message || 'Master-data import write failed',
      }).catch(() => null);
      return jsonResponse({
        success: false,
        skipped: false,
        error_code: 'master_data_import_write_failed',
        message: 'Customer App non-stock master-data import failed safely.',
        writes_performed: created.length > 0,
        partial_create_count: created.length,
      }, 500);
    }

    await updateCommandLog({
      base44,
      commandLogId: commandLog?.id,
      status: 'success',
      result: {
        writes_performed: true,
        created_row_count: created.length,
        created_rows_by_entity: entityCounts(validation.createRows),
        created_rows: created,
        deferred_rows: validation.deferredRows.map(row => ({ target_entity: row.target_entity, match_value: safeText(row.match_value, 120), reason: row.reason })),
        import_contract: contract.key,
        recipe_name: contract.recipeName || null,
        inventory_seed_policy: REQUIRED_POLICY,
        yield_policy: REQUIRED_YIELD_POLICY,
        recipe_records_created: Number(entityCounts(validation.createRows).Recipe || 0),
        inventory_item_records_created: Number(entityCounts(validation.createRows).InventoryItem || 0),
        ingredient_yield_records_created: Number(entityCounts(validation.createRows).IngredientYield || 0),
        bundle_records_created: Number(entityCounts(validation.createRows).Bundle || 0),
        stock_seeded_zero: validation.createRows.some(row => row.target_entity === 'InventoryItem'),
        black_salt_yield_created: false,
        beetroot_yield_created: false,
        inventory_deducted: false,
        purchase_orders_created: false,
        production_batches_created: false,
        provider_calls_performed: false,
        stripe_calls_performed: false,
        shopify_api_calls_performed: false,
        notifications_sent: false,
        sync_repair_replay_performed: false,
        customer_order_updated: false,
        native_shopify_order_updated: false,
        native_fulfillment_task_updated: false,
        hub_records_updated: false,
      },
    });

    return jsonResponse({
      success: true,
      skipped: false,
      idempotent: false,
      request_id: lookup.requestId,
      idempotency_key: idempotencyKey,
      command_log_id: safeId(commandLog?.id, 120) || null,
      order_number: contract.targetOrderNumber,
      import_contract: contract.key,
      recipe_name: contract.recipeName || null,
      writes_performed: true,
      created_row_count: created.length,
      created_rows_by_entity: entityCounts(validation.createRows),
      created_rows: created,
      deferred_row_count: validation.deferredRows.length,
      deferred_rows: validation.deferredRows.map(row => ({ target_entity: row.target_entity, match_value: safeText(row.match_value, 120), reason: row.reason })),
      recipe_records_created: Number(entityCounts(validation.createRows).Recipe || 0),
      inventory_item_records_created: Number(entityCounts(validation.createRows).InventoryItem || 0),
      ingredient_yield_records_created: Number(entityCounts(validation.createRows).IngredientYield || 0),
      bundle_records_created: Number(entityCounts(validation.createRows).Bundle || 0),
      inventory_seed_policy: REQUIRED_POLICY,
      yield_policy: REQUIRED_YIELD_POLICY,
      stock_seeded_zero: validation.createRows.some(row => row.target_entity === 'InventoryItem'),
      black_salt_yield_created: false,
      beetroot_yield_created: false,
      inventory_deducted: false,
      purchase_orders_created: false,
      production_batches_created: false,
      provider_calls: false,
      stripe_calls: false,
      shopify_calls: false,
      notifications_sent: false,
      sync_retry_repair_run: false,
      customer_app_order_updated: false,
      native_shopify_order_updated: false,
      native_fulfillment_task_updated: false,
      hub_records_updated: false,
    });
  } catch (error) {
    console.error(`[${FUNCTION_NAME}] failed safely: ${error?.message || 'unknown error'}`);
    return jsonResponse({
      success: false,
      error_code: 'native_production_master_data_import_failed',
      message: 'Customer App non-stock master-data import failed safely.',
      writes_performed: false,
    }, 500);
  }
});
