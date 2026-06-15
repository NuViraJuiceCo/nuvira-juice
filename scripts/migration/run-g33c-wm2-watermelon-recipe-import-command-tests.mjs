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
  orderNumber: 'NV-MP5SOQLJ',
  customerAppOrderId: '6a060df457fc07751f3c7ded',
  nativeShopifyOrderId: '6a2df0026e266e19c68046eb',
  nativeFulfillmentTaskId: '6a2eb72aa7ff194aafac49d3',
  hubRecipeId: '69ed8a1fab9a16f8772096ec',
  requestId: 'g33c_wm2_fixture_request',
};

function loadHarness({ env = {} } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { resolveImportContract, exactPolicyInputBlockers, exactTargetBlockers, gateFailure, fetchFreshPreview, validateImportPreview, validateWatermelonImportPreview, entityCounts } ;\n`;
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
    match_value: 'Watermelon Juice',
    import_ready: true,
    source_hub_id: IDS.hubRecipeId,
    payload: {
      product_name: 'Watermelon Juice',
      bottle_size_oz: 32,
      yield_factor: 1.05,
      ingredients: [{ ingredient_name: 'Watermelon', quantity_oz: 32, unit: 'oz' }],
      is_active: true,
    },
    ...overrides,
  };
}

function inventoryRow() {
  return {
    target_entity: 'InventoryItem',
    operation: 'create_if_missing',
    match_field: 'ingredient',
    match_value: 'Watermelon',
    import_ready: true,
    source_hub_id: 'hub_inventory_watermelon',
    payload: { ingredient: 'Watermelon', unit: 'lbs', stock: 0, reorder_point: 0 },
  };
}

function yieldRow() {
  return {
    target_entity: 'IngredientYield',
    operation: 'create_if_missing',
    match_field: 'ingredient_name',
    match_value: 'Watermelon',
    import_ready: true,
    source_hub_id: 'hub_yield_watermelon',
    payload: { ingredient_name: 'Watermelon', purchase_unit: 'each', oz_per_purchase_unit: 28 },
  };
}

function bundleRow() {
  return {
    target_entity: 'Bundle',
    operation: 'create_if_missing',
    match_field: 'bundle_name',
    match_value: 'Watermelon Juice',
    import_ready: true,
    source_hub_id: 'hub_bundle_watermelon',
    payload: { bundle_name: 'Watermelon Juice', components: [{ product_name: 'Watermelon Juice', quantity: 1 }] },
  };
}

function preview(overrides = {}) {
  const createRows = overrides.createRows ?? [recipeRow()];
  const deferredRows = overrides.deferredRows ?? [];
  const blockedRows = overrides.blockedRows ?? [];
  return {
    success: true,
    order_number: IDS.orderNumber,
    customer_app_order_id: IDS.customerAppOrderId,
    native_shopify_order_id: IDS.nativeShopifyOrderId,
    native_fulfillment_task_id: IDS.nativeFulfillmentTaskId,
    line_item_names: ['Watermelon Juice'],
    missing_native_recipes: ['Watermelon Juice'],
    production_master_data_ready: true,
    non_stock_master_data_seed_ready: true,
    seed_packet_ready: true,
    non_stock_import_preview_ready: true,
    inventory_seed_policy: 'NON_STOCK_MASTER_DATA_ONLY',
    yield_policy: 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES',
    procurement_conversion_ready: true,
    yield_details_pending: false,
    inventory_deduction_ready: false,
    blockers: [],
    hub_recipe_matches: [{
      requested_name: 'Watermelon Juice',
      status: 'matched',
      count: 1,
      matches: [{
        id: IDS.hubRecipeId,
        name: 'Watermelon Juice',
        ingredients: [{ ingredient_name: 'Watermelon', quantity_oz: 32, unit: 'oz' }],
      }],
    }],
    customer_app_non_stock_master_data_import_preview: {
      import_ready: true,
      inventory_seed_policy: 'NON_STOCK_MASTER_DATA_ONLY',
      yield_policy: 'DEFER_DETAILED_PURCHASE_CONVERSION_VALUES',
      procurement_conversion_ready: true,
      yield_details_pending: false,
      inventory_deduction_ready: false,
      create_row_count: createRows.length,
      create_rows: createRows,
      deferred_row_count: deferredRows.length,
      deferred_rows: deferredRows,
      blocked_rows: blockedRows,
      blockers: [],
      warnings: ['preview_only_no_master_data_import_performed'],
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
    recipe_name: 'Watermelon Juice',
    hub_recipe_id: IDS.hubRecipeId,
    import_scope: 'EXACT_RECIPE_ONLY',
    inventory_policy: 'NON_STOCK_MASTER_DATA_ONLY',
    inventory_deduction_policy: 'HELD',
    purchase_order_policy: 'HELD',
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    request_id: IDS.requestId,
    confirmation: 'import_watermelon_juice_recipe_non_stock_no_inventory_no_po',
    ...overrides,
  };
}

function openEnv(overrides = {}) {
  return {
    ENABLE_NATIVE_PRODUCTION_MASTER_DATA_IMPORT: 'true',
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_KILL_SWITCH: 'false',
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ALLOWED_EMAILS: 'admin@example.test',
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ORDER_ALLOWLIST: `${IDS.orderNumber},${IDS.customerAppOrderId},${IDS.nativeShopifyOrderId},${IDS.nativeFulfillmentTaskId}`,
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_ENTITY_ALLOWLIST: `recipe:Watermelon Juice,${IDS.hubRecipeId}`,
    NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY: 'EXACT_WATERMELON_JUICE_RECIPE_ONLY_NON_STOCK_NO_INVENTORY_NO_PO',
    CUSTOMER_APP_SYNC_SECRET: 'preview-secret',
    ...overrides,
  };
}

function makeStore({ user = { role: 'admin', email: 'admin@example.test' }, freshPreview = preview(), recipes = [], commandLogs = [] } = {}) {
  const store = {
    recipes,
    commandLogs,
    inventoryItems: [{ id: 'inventory-watermelon', ingredient: 'Watermelon' }],
    ingredientYields: [{ id: 'yield-watermelon', ingredient_name: 'Watermelon' }],
    bundles: [],
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
    CommandLog: store.commandLogs,
    InventoryItem: store.inventoryItems,
    IngredientYield: store.ingredientYields,
    Bundle: store.bundles,
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
          assert.equal(JSON.stringify(payload.line_items), JSON.stringify([{ title: 'Watermelon Juice', quantity: 1 }]));
          assert.equal(payload._internal_secret, 'preview-secret');
          return { data: freshPreview };
        } },
        entities: {
          Recipe: api('Recipe'), CommandLog: api('CommandLog'), InventoryItem: api('InventoryItem'), IngredientYield: api('IngredientYield'), Bundle: api('Bundle'), Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog'),
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

function assertNoForbiddenWrites(store, label) {
  const forbidden = store.writes.filter(write => !['Recipe', 'CommandLog'].includes(write.name));
  assert.equal(forbidden.length, 0, `${label}: no forbidden writes`);
}

function assertNoRawPayloads(value, label) {
  const text = JSON.stringify(value);
  assert.equal(/raw_hub_payload|raw_shopify_payload|raw_stripe_payload|provider_payload|customer_email|address_line1/i.test(text), false, `${label}: no raw payload or PII markers`);
}

const { exports: fns } = loadHarness({ env: openEnv() });
const wmContract = fns.resolveImportContract(body());

assert.equal(wmContract.key, 'g33c_wm2_watermelon_juice_recipe_import');
assert.equal(fns.exactPolicyInputBlockers(body(), wmContract).length, 0);
assert.ok(fns.exactPolicyInputBlockers(body({ purchase_order_policy: 'CREATE' }), wmContract).includes('purchase_order_policy_held_required'));
assert.ok(fns.exactPolicyInputBlockers(body({ create_inventory_item: true }), wmContract).includes('forbidden_input:create_inventory_item'));
assert.equal(fns.validateImportPreview(preview(), wmContract).ready, true);
assert.equal(fns.validateImportPreview(preview({ missing_native_recipes: [] }), wmContract).ready, false);
assert.ok(fns.validateImportPreview(preview({ hub_recipe_matches: [] }), wmContract).blockers.includes('hub_watermelon_recipe_missing'));
assert.ok(fns.validateImportPreview(preview({ createRows: [] }), wmContract).blockers.includes('unexpected_create_row_count'));
assert.ok(fns.validateImportPreview(preview({ createRows: [recipeRow(), inventoryRow()] }), wmContract).blockers.includes('inventory_item_create_not_allowed'));
assert.ok(fns.validateImportPreview(preview({ createRows: [recipeRow(), yieldRow()] }), wmContract).blockers.includes('ingredient_yield_create_not_allowed'));
assert.ok(fns.validateImportPreview(preview({ createRows: [recipeRow(), bundleRow()] }), wmContract).blockers.includes('bundle_create_not_allowed'));
assert.ok(fns.validateImportPreview(preview({ deferredRows: [{ target_entity: 'IngredientYield', match_value: 'Watermelon' }] }), wmContract).blockers.includes('deferred_rows_not_allowed'));
assert.ok(fns.validateImportPreview(preview({ createRows: [recipeRow({ payload: { ...recipeRow().payload, raw_payload: { unsafe: true } } })] }), wmContract).blockers.some(item => item.includes('unapproved_Recipe_field:raw_payload')));
assert.ok(fns.validateImportPreview(preview({ inventory_deduction_ready: true, customer_app_non_stock_master_data_import_preview: { ...preview().customer_app_non_stock_master_data_import_preview, inventory_deduction_ready: true } }), wmContract).blockers.includes('inventory_deduction_should_remain_held'));

{
  const { status, json, scenario } = await invoke({ env: {} });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'native_production_master_data_import_disabled');
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { user: null } });
  assert.equal(status, 401);
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: {}, storeArgs: { user: null } });
  assert.equal(status, 401);
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), payload: body({ confirmation: 'wrong' }) });
  assert.equal(status, 400);
  assert.equal(json.error_code, 'confirmation_required');
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv({ NATIVE_PRODUCTION_MASTER_DATA_IMPORT_POLICY: 'WRONG' }) });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'watermelon_recipe_import_policy_required');
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), payload: body({ customer_app_order_id: '' }) });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('target_customer_app_order_id_mismatch'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { freshPreview: preview({ success: false, error_code: 'preview_failed' }) } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'preview_failed');
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { freshPreview: preview({ missing_native_recipes: [] }) } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'fresh_import_preview_not_clean');
  assert.ok(json.blockers.includes('watermelon_native_recipe_not_missing'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { freshPreview: preview({ hub_recipe_matches: [] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('hub_watermelon_recipe_missing'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { freshPreview: preview({ createRows: [recipeRow(), inventoryRow()] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('inventory_item_create_not_allowed'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { freshPreview: preview({ createRows: [recipeRow(), yieldRow()] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('ingredient_yield_create_not_allowed'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { freshPreview: preview({ createRows: [recipeRow(), bundleRow()] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('bundle_create_not_allowed'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { freshPreview: preview({ deferredRows: [{ target_entity: 'IngredientYield', match_value: 'Watermelon' }] }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('deferred_rows_not_allowed'));
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { recipes: [{ id: 'existing-recipe', product_name: 'Watermelon Juice' }] } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'target_master_data_already_exists');
  assert.equal(scenario.store.writes.length, 0);
}

{
  const { status, json, scenario } = await invoke();
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.writes_performed, true);
  assert.equal(json.created_row_count, 1);
  assert.deepEqual(json.created_rows_by_entity, { Recipe: 1 });
  assert.equal(json.recipe_records_created, 1);
  assert.equal(json.inventory_item_records_created, 0);
  assert.equal(json.ingredient_yield_records_created, 0);
  assert.equal(json.bundle_records_created, 0);
  assert.equal(json.inventory_deducted, false);
  assert.equal(json.purchase_orders_created, false);
  assert.equal(json.notifications_sent, false);
  assert.equal(json.provider_calls, false);
  assert.equal(json.hub_records_updated, false);
  assert.equal(scenario.store.recipes.length, 1);
  assert.equal(scenario.store.commandLogs.length, 1);
  assertNoForbiddenWrites(scenario.store, 'valid command');
  assertNoRawPayloads(json, 'valid response');
}

{
  const idempotencyKey = `watermelon_juice_recipe_import:${IDS.requestId}`;
  const { status, json, scenario } = await invoke({ storeArgs: { commandLogs: [{ id: 'log-1', status: 'success', idempotency_key: idempotencyKey }] } });
  assert.equal(status, 200);
  assert.equal(json.skipped, true);
  assert.equal(json.idempotent, true);
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.writes.length, 0);
}

console.log('G33C-WM2 Watermelon Juice Recipe import command tests passed');
