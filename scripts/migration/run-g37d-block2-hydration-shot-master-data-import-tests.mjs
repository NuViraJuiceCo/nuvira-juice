#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/importNativeProductionMasterDataForCustomerApp/entry.ts');

const IDS = {
  orderNumber: 'NV-MQHJR3V2',
  customerAppOrderId: '6a321cbfd8d78863f15de956',
  nativeShopifyOrderId: '6a321d38a3819cdd5cf89031',
  nativeFulfillmentTaskId: '6a321d38071327f8218b958b',
  hubRecipeId: '69ed63d35c89c5d5ffa37e0e',
  requestId: 'g37d_block2_fixture_request',
};

const INVENTORY_NAMES = ['Lime Juice', 'Honey', 'Mint', 'Pink Salt'];
const DEFERRED_YIELD_NAMES = ['Beetroot', 'Lime Juice', 'Honey', 'Mint', 'Pink Salt'];

function loadHarness({ env = {} } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { resolveImportContract, exactPolicyInputBlockers, exactTargetBlockers, gateFailure, fetchFreshPreview, validateImportPreview, validateHydrationImportPreview, entityCounts } ;\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    structuredClone,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { handler: context.globalThis.__handler, exports: context.globalThis.__exports, source };
}

function recipeRow(overrides = {}) {
  return {
    target_entity: 'Recipe',
    operation: 'create_if_missing',
    match_field: 'product_name',
    match_value: 'Hydration Shot',
    import_ready: true,
    source_hub_id: IDS.hubRecipeId,
    payload: {
      product_name: 'Hydration Shot',
      product_sku: null,
      bottle_size_oz: 2.32,
      yield_factor: 1.05,
      ingredients: [
        { ingredient_name: 'Coconut Water', quantity_oz: 1.69, unit: 'oz' },
        { ingredient_name: 'Lime Juice', quantity_oz: 0.34, unit: 'oz' },
        { ingredient_name: 'Honey', quantity_oz: 0.15, unit: 'oz' },
        { ingredient_name: 'Mint', quantity_oz: 0, unit: 'leaves' },
        { ingredient_name: 'Pink Salt', quantity_oz: 0, unit: 'pinch' },
      ],
      is_active: true,
    },
    ...overrides,
  };
}

function inventoryRow(name, overrides = {}) {
  const defaults = {
    'Lime Juice': { unit: 'lbs', category: 'Produce', supplier: 'Restaurant Depot', reorder_point: 5, max_stock: 15 },
    Honey: { unit: 'bottles', category: 'Other', supplier: 'Restaurant Depot', reorder_point: 0, max_stock: 5, supplier_packaging_unit: 'case' },
    Mint: { unit: 'lbs', category: 'Produce', supplier: 'Restaurant Depot', reorder_point: 1, max_stock: 5 },
    'Pink Salt': { unit: 'lbs', category: 'Spices & Herbs', supplier: 'Restaurant Depot', reorder_point: 0.5, max_stock: 3 },
    Orange: { unit: 'lbs', category: 'Produce', supplier: 'Restaurant Depot', reorder_point: 2, max_stock: 8 },
  }[name] || { unit: 'lbs', category: 'Other', supplier: 'Restaurant Depot', reorder_point: 0, max_stock: 1 };
  return {
    target_entity: 'InventoryItem',
    operation: 'create_if_missing',
    match_field: 'ingredient',
    match_value: name,
    import_ready: true,
    source_hub_id: `hub_inventory_${name.toLowerCase().replace(/\s+/g, '_')}`,
    payload: {
      ingredient: name,
      unit: defaults.unit,
      category: defaults.category,
      supplier: defaults.supplier,
      stock: 0,
      reorder_point: defaults.reorder_point,
      max_stock: defaults.max_stock,
      supplier_packaging_unit: defaults.supplier_packaging_unit || null,
      supplier_packaging_qty: null,
    },
    ...overrides,
  };
}

function yieldCreateRow(name) {
  return {
    target_entity: 'IngredientYield',
    operation: 'create_if_missing',
    match_field: 'ingredient_name',
    match_value: name,
    import_ready: true,
    payload: { ingredient_name: name, purchase_unit: 'case', oz_per_purchase_unit: 12 },
  };
}

function bundleRow() {
  return {
    target_entity: 'Bundle',
    operation: 'create_if_missing',
    match_field: 'bundle_name',
    match_value: 'Hydration Bundle',
    import_ready: true,
    payload: { bundle_name: 'Hydration Bundle', components: [{ product_name: 'Hydration Shot', quantity: 1 }] },
  };
}

function productRow() {
  return {
    target_entity: 'Product',
    operation: 'create_if_missing',
    match_field: 'name',
    match_value: 'Hydration Shot',
    import_ready: true,
    payload: { name: 'Hydration Shot' },
  };
}

function deferredYieldRow(name) {
  return {
    target_entity: 'IngredientYield',
    match_field: 'ingredient_name',
    match_value: name,
    reason: 'yield_details_deferred',
    status: 'yield_details_deferred',
  };
}

function createRows() {
  return [recipeRow(), ...INVENTORY_NAMES.map(name => inventoryRow(name))];
}

function preview(overrides = {}) {
  const rows = overrides.createRows ?? createRows();
  const deferredRows = overrides.deferredRows ?? DEFERRED_YIELD_NAMES.map(deferredYieldRow);
  const blockedRows = overrides.blockedRows ?? [];
  return {
    success: true,
    order_number: IDS.orderNumber,
    customer_app_order_id: IDS.customerAppOrderId,
    native_shopify_order_id: IDS.nativeShopifyOrderId,
    native_fulfillment_task_id: IDS.nativeFulfillmentTaskId,
    line_item_names: ['Radiance Shot', 'Hydration Shot'],
    missing_native_recipes: ['Hydration Shot'],
    missing_native_inventory_items: [...INVENTORY_NAMES],
    missing_native_ingredient_yields: [...DEFERRED_YIELD_NAMES],
    production_master_data_ready: true,
    non_stock_master_data_seed_ready: true,
    seed_packet_ready: true,
    non_stock_import_preview_ready: true,
    inventory_seed_policy: 'NON_STOCK_MASTER_DATA_ONLY',
    yield_policy: 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES',
    procurement_conversion_ready: false,
    yield_details_pending: true,
    inventory_deduction_ready: false,
    purchase_order_ready: false,
    blockers: [],
    warnings: ['hub_fallback_required_until_master_data_mirrored'],
    hub_recipe_matches: [{
      requested_name: 'Hydration Shot',
      status: 'matched',
      count: 1,
      matches: [{ id: IDS.hubRecipeId, name: 'Hydration Shot' }],
    }],
    customer_app_non_stock_master_data_import_preview: {
      import_ready: true,
      inventory_seed_policy: 'NON_STOCK_MASTER_DATA_ONLY',
      yield_policy: 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES',
      procurement_conversion_ready: false,
      yield_details_pending: true,
      inventory_deduction_ready: false,
      purchase_order_ready: false,
      purchase_order_automation_ready: false,
      create_row_count: rows.length,
      create_rows: rows,
      deferred_row_count: deferredRows.length,
      deferred_rows: deferredRows,
      blocked_rows: blockedRows,
      blockers: [],
      warnings: ['preview_only_no_master_data_import_performed', 'inventory_deduction_held', 'purchase_order_automation_held'],
    },
    ...overrides,
  };
}

function body(overrides = {}) {
  return {
    mode: 'live',
    order_number: IDS.orderNumber,
    customer_app_order_id: IDS.customerAppOrderId,
    native_shopify_order_id: IDS.nativeShopifyOrderId,
    native_fulfillment_task_id: IDS.nativeFulfillmentTaskId,
    recipe_name: 'Hydration Shot',
    hub_recipe_id: IDS.hubRecipeId,
    import_scope: 'EXACT_HYDRATION_SHOT_NON_STOCK_VISIBILITY_PACKET',
    inventory_policy: 'NON_STOCK_MASTER_DATA_ONLY',
    inventory_deduction_policy: 'HELD',
    purchase_order_policy: 'HELD',
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    request_id: IDS.requestId,
    confirmation: 'import_hydration_shot_non_stock_master_data_no_inventory_no_po',
    ...overrides,
  };
}

function openEnv(overrides = {}) {
  return {
    ENABLE_NATIVE_PRODUCTION_MASTER_DATA_IMPORT: 'true',
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_KILL_SWITCH: 'false',
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ALLOWED_EMAILS: 'admin@example.test',
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ORDER_ALLOWLIST: `${IDS.orderNumber},${IDS.customerAppOrderId},${IDS.nativeShopifyOrderId},${IDS.nativeFulfillmentTaskId}`,
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ENTITY_ALLOWLIST: `recipe:Hydration Shot,hub_recipe:${IDS.hubRecipeId},inventoryitem:Lime Juice,inventoryitem:Honey,inventoryitem:Mint,inventoryitem:Pink Salt`,
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY: 'EXACT_HYDRATION_SHOT_NON_STOCK_MASTER_DATA_ONLY_NO_INVENTORY_NO_PO',
    CUSTOMER_APP_SYNC_SECRET: 'preview-secret',
    ...overrides,
  };
}

function makeStore({ user = { role: 'admin', email: 'admin@example.test' }, freshPreview = preview(), recipes = [], inventoryItems = [], commandLogs = [] } = {}) {
  const store = {
    recipes,
    inventoryItems,
    commandLogs,
    ingredientYields: [],
    bundles: [],
    products: [],
    orders: [{ id: IDS.customerAppOrderId, order_number: IDS.orderNumber }],
    nativeOrders: [{ id: IDS.nativeShopifyOrderId, base44_order_id: IDS.customerAppOrderId, shopify_order_number: `#${IDS.orderNumber}` }],
    tasks: [{ id: IDS.nativeFulfillmentTaskId, base44_order_id: IDS.customerAppOrderId, native_shopify_order_id: IDS.nativeShopifyOrderId, order_number: IDS.orderNumber }],
    batches: [],
    compliance: [],
    syncLogs: [],
    reviewRows: [],
    notifications: [],
    messageLogs: [],
    writes: [],
    previewCalls: [],
  };
  const rowsFor = name => ({
    Recipe: store.recipes,
    InventoryItem: store.inventoryItems,
    IngredientYield: store.ingredientYields,
    Bundle: store.bundles,
    Product: store.products,
    CommandLog: store.commandLogs,
    Order: store.orders,
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.tasks,
    ProductionBatch: store.batches,
    BatchComplianceLog: store.compliance,
    OrderSyncLog: store.syncLogs,
    OrderReviewQueue: store.reviewRows,
    Notification: store.notifications,
    CustomerMessageDeliveryLog: store.messageLogs,
  }[name] || []);
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    list: async (_sort, limit = 200) => rowsFor(name).slice(0, limit),
    create: async payload => {
      const row = { id: `${name.toLowerCase()}-${rowsFor(name).length + 1}`, ...payload };
      rowsFor(name).push(row);
      store.writes.push({ op: 'create', name, payload: row });
      return row;
    },
    update: async (id, patch) => {
      const rows = rowsFor(name);
      const row = rows.find(item => item.id === id);
      if (!row) throw new Error(`${name} row not found`);
      if (name !== 'CommandLog') {
        store.writes.push({ op: 'update', name, id, patch });
        throw new Error(`unexpected update ${name}`);
      }
      Object.assign(row, patch);
      store.writes.push({ op: 'update', name, id, patch });
      return row;
    },
  });
  return {
    store,
    base44: {
      auth: { me: async () => {
        if (!user) throw new Error('unauthorized');
        return user;
      } },
      asServiceRole: {
        functions: { invoke: async (name, payload) => {
          store.previewCalls.push({ name, payload });
          assert.equal(name, 'previewNativeProductionMasterDataParity');
          assert.equal(payload.order_number, IDS.orderNumber);
          assert.equal(payload.customer_app_order_id, IDS.customerAppOrderId);
          assert.equal(payload.native_shopify_order_id, IDS.nativeShopifyOrderId);
          assert.equal(payload.native_fulfillment_task_id, IDS.nativeFulfillmentTaskId);
          assert.equal(payload.import_scope, 'EXACT_HYDRATION_SHOT_NON_STOCK_VISIBILITY_PACKET');
          assert.equal(payload.recipe_name, 'Hydration Shot');
          assert.equal(payload.hub_recipe_id, IDS.hubRecipeId);
          assert.equal(Object.hasOwn(payload, 'line_items'), false);
          assert.equal(payload._internal_secret, 'preview-secret');
          return { data: freshPreview };
        } },
        entities: {
          Recipe: api('Recipe'), InventoryItem: api('InventoryItem'), IngredientYield: api('IngredientYield'), Bundle: api('Bundle'), Product: api('Product'), CommandLog: api('CommandLog'), Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog'),
        },
      },
    },
  };
}

function req({ base44, method = 'POST', payload = body() }) {
  return { method, __base44: base44, text: async () => JSON.stringify(payload) };
}

async function invoke({ env = openEnv(), storeArgs = {}, payload = body(), method = 'POST' } = {}) {
  const { handler } = loadHarness({ env });
  const scenario = makeStore(storeArgs);
  const response = await handler(req({ base44: scenario.base44, method, payload }));
  const json = await response.json();
  return { status: response.status, json, scenario };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertNoForbiddenWrites(store, label) {
  const allowed = new Set(['Recipe', 'InventoryItem', 'CommandLog']);
  const forbidden = store.writes.filter(write => !allowed.has(write.name));
  assert.equal(forbidden.length, 0, `${label}: no forbidden writes`);
}

function assertNoRawPayloads(value, label) {
  const text = JSON.stringify(value);
  assert.equal(/raw_hub_payload|raw_shopify_payload|raw_stripe_payload|provider_payload|customer_email|customer_phone|full_address|address_line1|@example\.com/i.test(text), false, `${label}: no raw payload or PII markers`);
}

const { exports: fns } = loadHarness({ env: openEnv() });
const hydrationContract = fns.resolveImportContract(body());
assert.equal(hydrationContract.key, 'g37d_block2_hydration_shot_non_stock_master_data_import');
assert.equal(fns.exactPolicyInputBlockers(body(), hydrationContract).length, 0);
assert.ok(fns.exactPolicyInputBlockers(body({ inventory_deduction_policy: 'DEDUCT' }), hydrationContract).includes('inventory_deduction_policy_held_required'));
assert.ok(fns.exactPolicyInputBlockers(body({ create_inventory_item: true }), hydrationContract).includes('forbidden_input:create_inventory_item'));
assert.ok(fns.exactPolicyInputBlockers(body({ call_provider: true }), hydrationContract).includes('forbidden_input:call_provider'));
assert.equal(fns.validateImportPreview(preview(), hydrationContract).ready, true);
assert.deepEqual(plain(fns.entityCounts(createRows())), { Recipe: 1, InventoryItem: 4 });
assert.ok(fns.validateImportPreview(preview({ hub_recipe_matches: [{ requested_name: 'Hydration Shot', status: 'matched', matches: [{ id: 'wrong', name: 'Hydration Shot' }] }] }), hydrationContract).blockers.includes('hub_hydration_recipe_id_mismatch'));
assert.ok(fns.validateImportPreview(preview({ createRows: [...createRows(), inventoryRow('Orange')] }), hydrationContract).blockers.includes('unexpected_InventoryItem_create_count'));
assert.ok(fns.validateImportPreview(preview({ createRows: [...createRows(), yieldCreateRow('Lime Juice')] }), hydrationContract).blockers.includes('unexpected_ingredient_yield_create_row'));
assert.ok(fns.validateImportPreview(preview({ createRows: [...createRows(), bundleRow()] }), hydrationContract).blockers.includes('unexpected_bundle_create_row'));
assert.ok(fns.validateImportPreview(preview({ createRows: [...createRows(), productRow()] }), hydrationContract).blockers.includes('unexpected_product_create_row'));
assert.ok(fns.validateImportPreview(preview({ deferredRows: DEFERRED_YIELD_NAMES.slice(1).map(deferredYieldRow) }), hydrationContract).blockers.includes('unexpected_deferred_yield_names'));
assert.ok(fns.validateImportPreview(preview({ customer_app_non_stock_master_data_import_preview: { ...preview().customer_app_non_stock_master_data_import_preview, purchase_order_automation_ready: true } }), hydrationContract).blockers.includes('purchase_order_should_remain_held'));
assert.ok(fns.validateImportPreview(preview({ provider_call_impact: true }), hydrationContract).blockers.includes('provider_calls_not_allowed'));
assert.ok(fns.validateImportPreview(preview({ hub_mutation_performed: true }), hydrationContract).blockers.includes('hub_mutation_not_allowed'));
assert.ok(fns.validateImportPreview(preview({ warnings: [], safety: { notifications_sent: true }, customer_app_non_stock_master_data_import_preview: { ...preview().customer_app_non_stock_master_data_import_preview, warnings: [], safety: { notifications_sent: true } } }), hydrationContract).blockers.includes('notifications_not_held'));

{
  const { status, json, scenario } = await invoke({ env: {} });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'native_production_master_data_import_disabled');
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ storeArgs: { user: null } });
  assert.equal(status, 401);
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ payload: body({ confirmation: 'wrong' }) });
  assert.equal(status, 400);
  assert.equal(json.error_code, 'confirmation_required');
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv({ NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY: 'WRONG' }) });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'hydration_shot_import_policy_required');
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv({ NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ENTITY_ALLOWLIST: `hub_recipe:${IDS.hubRecipeId},inventoryitem:Lime Juice,inventoryitem:Honey,inventoryitem:Mint,inventoryitem:Pink Salt` }) });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'entity_allowlist_missing:recipe:hydration shot');
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv({ NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ENTITY_ALLOWLIST: `recipe:Hydration Shot,hub_recipe:${IDS.hubRecipeId},inventoryitem:Lime Juice,inventoryitem:Honey,inventoryitem:Pink Salt` }) });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'entity_allowlist_missing:inventoryitem:mint');
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ storeArgs: { freshPreview: preview({ success: false, error_code: 'preview_failed' }) } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'preview_failed');
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ storeArgs: { freshPreview: preview({ hub_recipe_matches: [{ requested_name: 'Hydration Shot', status: 'matched', matches: [{ id: 'wrong', name: 'Hydration Shot' }] }] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('hub_hydration_recipe_id_mismatch'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ storeArgs: { freshPreview: preview({ createRows: [...createRows(), inventoryRow('Orange')] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('unexpected_InventoryItem_create_count'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ storeArgs: { freshPreview: preview({ createRows: [...createRows(), yieldCreateRow('Lime Juice')] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('unexpected_ingredient_yield_create_row'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ storeArgs: { freshPreview: preview({ createRows: [...createRows(), bundleRow()] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('unexpected_bundle_create_row'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ storeArgs: { freshPreview: preview({ createRows: [...createRows(), productRow()] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('unexpected_product_create_row'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ payload: body({ inventory_deduction_policy: 'DEDUCT' }) });
  assert.equal(status, 400);
  assert.ok(json.blockers.includes('inventory_deduction_policy_held_required'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ payload: body({ purchase_order_policy: 'CREATE' }) });
  assert.equal(status, 400);
  assert.ok(json.blockers.includes('purchase_order_policy_held_required'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ payload: body({ notification_policy: 'SEND' }) });
  assert.equal(status, 400);
  assert.ok(json.blockers.includes('notification_policy_required'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ payload: body({ call_provider: true }) });
  assert.equal(status, 400);
  assert.ok(json.blockers.includes('forbidden_input:call_provider'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ payload: body({ hub_mutation_policy: 'ALLOW' }) });
  assert.equal(status, 400);
  assert.ok(json.blockers.includes('hub_mutation_policy_required'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke();
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.writes_performed, true);
  assert.equal(json.created_row_count, 5);
  assert.deepEqual(plain(json.created_rows_by_entity), { Recipe: 1, InventoryItem: 4 });
  assert.equal(json.recipe_created, true);
  assert.equal(json.recipe_records_created, 1);
  assert.equal(json.inventory_item_records_created, 4);
  assert.equal(json.ingredient_yield_created, false);
  assert.equal(json.ingredient_yield_records_created, 0);
  assert.equal(json.bundle_records_created, 0);
  assert.equal(json.production_batch_created, false);
  assert.equal(json.batch_compliance_log_created, false);
  assert.equal(json.deferred_ingredient_yield_count, 5);
  assert.deepEqual(plain(json.deferred_ingredient_yield_names), DEFERRED_YIELD_NAMES);
  assert.equal(json.inventory_deducted, false);
  assert.equal(json.purchase_orders_created, false);
  assert.equal(json.notifications_sent, false);
  assert.equal(json.provider_calls, false);
  assert.equal(json.hub_records_updated, false);
  assert.equal(json.customer_app_order_updated, false);
  assert.equal(json.native_shopify_order_updated, false);
  assert.equal(json.native_fulfillment_task_updated, false);
  assert.equal(json.command_log_created, true);
  assert.equal(scenario.store.recipes.length, 1);
  assert.equal(scenario.store.inventoryItems.length, 4);
  assert.equal(scenario.store.commandLogs.length, 1);
  assert.equal(scenario.store.batches.length, 0);
  assert.equal(scenario.store.compliance.length, 0);
  assertNoForbiddenWrites(scenario.store, 'valid command');
  assertNoRawPayloads(json, 'valid response');
}

{
  const { status, json, scenario } = await invoke({ storeArgs: { recipes: [{ id: 'recipe-existing', product_name: 'Hydration Shot' }] } });
  assert.equal(status, 200);
  assert.equal(json.created_row_count, 4);
  assert.deepEqual(plain(json.created_rows_by_entity), { InventoryItem: 4 });
  assert.equal(json.recipe_created, false);
  assert.equal(json.recipe_records_created, 0);
  assert.equal(json.inventory_item_records_created, 4);
  assert.equal(scenario.store.recipes.length, 1);
  assert.equal(scenario.store.inventoryItems.length, 4);
  assertNoForbiddenWrites(scenario.store, 'recipe dedupe command');
}

{
  const { status, json, scenario } = await invoke({ storeArgs: { inventoryItems: [{ id: 'inventory-mint-existing', ingredient: 'Mint' }] } });
  assert.equal(status, 200);
  assert.equal(json.created_row_count, 4);
  assert.deepEqual(plain(json.created_rows_by_entity), { Recipe: 1, InventoryItem: 3 });
  assert.equal(json.inventory_item_records_created, 3);
  assert.equal(scenario.store.inventoryItems.filter(row => row.ingredient === 'Mint').length, 1);
  assertNoForbiddenWrites(scenario.store, 'inventory dedupe command');
}

{
  const idempotencyKey = `hydration_shot_non_stock_master_data_import:${IDS.requestId}`;
  const { status, json, scenario } = await invoke({ storeArgs: { commandLogs: [{ id: 'log-1', status: 'success', idempotency_key: idempotencyKey }] } });
  assert.equal(status, 200);
  assert.equal(json.skipped, true);
  assert.equal(json.idempotent, true);
  assert.equal(json.writes_performed, false);
  assert.equal(json.command_log_created, false);
  assert.equal(scenario.store.writes.length, 0);
}

{
  const existing = [{ id: 'recipe-existing', product_name: 'Hydration Shot' }, ...INVENTORY_NAMES.map(name => ({ id: `inventory-${name}`, ingredient: name }))];
  const { status, json, scenario } = await invoke({ storeArgs: { recipes: [existing[0]], inventoryItems: existing.slice(1) } });
  assert.equal(status, 200);
  assert.equal(json.skipped, true);
  assert.equal(json.reason, 'all_exact_master_data_rows_already_exist');
  assert.equal(json.writes_performed, false);
  assert.equal(json.command_log_created, false);
  assert.equal(scenario.store.writes.length, 0);
}

console.log('G37D-BLOCK2 Hydration Shot master-data import command tests passed');
