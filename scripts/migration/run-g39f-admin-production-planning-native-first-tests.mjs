#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/getAdminProductionPlanningSummary/entry.ts');
const PRODUCTION_DATE = '2026-06-20';

function loadHandler({ env = {}, hubData = emptyHubPlanning(), hubStatus = 200, fetchError = null } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');

  const context = vm.createContext({
    console,
    URL,
    URLSearchParams,
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    JSON,
    Error,
    Response,
    Promise,
    Intl,
    createClientFromRequest: req => req.__base44,
    fetch: async () => {
      if (fetchError) throw fetchError;
      return new Response(JSON.stringify(hubData), { status: hubStatus });
    },
    Deno: {
      env: { get: key => env[key] || '' },
      serve: handler => {
        context.globalThis.__handler = handler;
      },
    },
    globalThis: {},
  });

  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__handler;
}

function lineItems(overrides = {}) {
  return [
    { title: overrides.title || 'Pineapple Juice', variant_title: overrides.variant_title || '32 oz', quantity: overrides.quantity ?? 1 },
  ];
}

function nativeOrder(overrides = {}) {
  const orderNumber = overrides.shopify_order_number || overrides.order_number || 'NV-G39F-NATIVE';
  return {
    id: overrides.id || `shopify_${orderNumber}`,
    base44_order_id: overrides.base44_order_id || `order_${orderNumber}`,
    shopify_order_number: orderNumber,
    order_number: orderNumber,
    source_type: overrides.source_type || 'customer_app_one_time',
    source_channel: overrides.source_channel || 'customer_app',
    order_type: overrides.order_type || 'one_time',
    fulfillment_method: overrides.fulfillment_method || 'delivery',
    payment_status: overrides.payment_status || 'paid',
    financial_status: overrides.financial_status || 'paid',
    production_status: overrides.production_status || 'awaiting_production',
    sync_status: overrides.sync_status || 'native_may30_ready',
    customer_order_date: overrides.customer_order_date || '2026-06-16T12:00:00Z',
    created_date: overrides.created_date || '2026-06-16T12:00:00Z',
    production_date: overrides.production_date ?? PRODUCTION_DATE,
    delivery_date: overrides.delivery_date ?? PRODUCTION_DATE,
    line_items: overrides.line_items || lineItems(overrides),
    customer_email: 'do-not-return@example.test',
    customer_phone: '+15555550123',
    raw_payload: { should_not_return: true },
    provider_payload: { should_not_return: true },
    payment_payload: { should_not_return: true },
    ...overrides,
  };
}

function baseRecipes() {
  return [
    {
      id: 'recipe_pineapple',
      product_name: 'Pineapple Juice',
      is_active: true,
      yield_factor: 1,
      ingredients: [{ ingredient_name: 'Pineapple', quantity_oz: 32, unit: 'oz' }],
    },
  ];
}

function baseInventoryItems() {
  return [
    { id: 'inventory_pineapple', ingredient: 'Pineapple', stock: 100, unit: 'oz', supplier: 'Synthetic Supplier' },
  ];
}

function baseIngredientYields() {
  return [
    {
      id: 'yield_pineapple',
      ingredient_name: 'Pineapple',
      purchase_unit: 'case',
      oz_per_purchase_unit: 160,
      trim_waste_factor: 1,
      units_per_case: 1,
      split_case_allowed: false,
      rounding_rule: 'round_up_unit',
      supplier: 'Synthetic Supplier',
    },
  ];
}

function hubDateGroup(overrides = {}) {
  const productName = overrides.product_name || 'Pineapple Juice';
  const plannedUnits = overrides.planned_units ?? 1;
  return {
    production_date: overrides.production_date || PRODUCTION_DATE,
    batch_count: overrides.batch_count ?? 1,
    planned_units: plannedUnits,
    produced_units: overrides.produced_units ?? 0,
    product_groups: overrides.product_groups || [
      {
        product_name: productName,
        product_category: 'Hub Demand',
        planned_units: plannedUnits,
        produced_units: 0,
        batch_count: 1,
        source_order_count: 1,
        source: 'hub',
      },
    ],
    ingredient_count: overrides.ingredient_count ?? 1,
    shortage_count: overrides.shortage_count ?? 0,
    source: overrides.source || 'hub',
  };
}

function hubIngredient(overrides = {}) {
  return {
    ingredient: overrides.ingredient || 'Pineapple',
    unit: overrides.unit || 'oz',
    required_quantity: overrides.required_quantity ?? 32,
    available_stock: overrides.available_stock ?? 100,
    shortage_amount: overrides.shortage_amount ?? 0,
    status: overrides.status || 'covered',
    yield_match_found: overrides.yield_match_found ?? true,
    purchase_unit: 'case',
    oz_per_purchase_unit: 160,
    trim_waste_factor: 1,
    units_per_case: 1,
    split_case_allowed: false,
    rounding_rule: 'round_up_unit',
    procurement_needed_quantity: 0,
    procurement_unit: 'case',
    procurement_case_quantity: 0,
    procurement_basis: 'covered',
    source_products: [overrides.product_name || 'Pineapple Juice'],
    production_dates: [overrides.production_date || PRODUCTION_DATE],
    source: overrides.source || 'hub',
  };
}

function emptyHubPlanning(overrides = {}) {
  const dates = overrides.dates || [];
  const ingredients = overrides.ingredients || [];
  return {
    success: true,
    date_from: overrides.date_from || PRODUCTION_DATE,
    date_to: overrides.date_to || PRODUCTION_DATE,
    generated_at: overrides.generated_at || '2026-06-16T12:00:00Z',
    summary: overrides.summary || {
      production_date_count: dates.length,
      batch_count: dates.reduce((sum, row) => sum + Number(row.batch_count || 0), 0),
      planned_units: dates.reduce((sum, row) => sum + Number(row.planned_units || 0), 0),
      produced_units: 0,
      ingredient_count: ingredients.length,
      shortage_count: ingredients.filter(row => row.status === 'short').length,
      missing_recipe_count: 0,
      missing_yield_count: 0,
    },
    dates,
    ingredients,
    truncated: overrides.truncated === true,
  };
}

function hubPlanningWithPineapple(overrides = {}) {
  const dates = overrides.dates || [hubDateGroup(overrides)];
  const ingredients = overrides.ingredients || [hubIngredient(overrides)];
  return emptyHubPlanning({ ...overrides, dates, ingredients });
}

function makeBase44({
  nativeOrders = [], customerOrders = [], recipes = baseRecipes(), bundles = [], products = [], inventoryItems = baseInventoryItems(), ingredientYields = baseIngredientYields(),
} = {}) {
  const writes = [];
  const rowsByName = {
    ShopifyOrder: nativeOrders,
    Order: customerOrders,
    Recipe: recipes,
    Bundle: bundles,
    Product: products,
    InventoryItem: inventoryItems,
    IngredientYield: ingredientYields,
  };
  const api = name => ({
    list: async (_sort, limit = 100) => (rowsByName[name] || []).slice(0, limit),
    filter: async () => { throw new Error(`unexpected filter ${name}`); },
    create: async payload => { writes.push({ entity: name, action: 'create', payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ entity: name, action: 'update', id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ entity: name, action: 'delete', id }); throw new Error(`unexpected delete ${name}`); },
    upsert: async payload => { writes.push({ entity: name, action: 'upsert', payload }); throw new Error(`unexpected upsert ${name}`); },
  });
  return {
    writes,
    base44: {
      auth: { me: async () => ({ id: 'synthetic_admin', role: 'admin' }) },
      asServiceRole: { entities: Object.fromEntries(Object.keys(rowsByName).map(name => [name, api(name)])) },
    },
  };
}

async function invoke({ store = {}, hubData = emptyHubPlanning(), hubEnv = true, body = {}, hubStatus = 200 } = {}) {
  const { base44, writes } = makeBase44(store);
  const handler = loadHandler({
    env: hubEnv ? { HUB_API_URL: 'https://hub.example.test/functions/getProductionPlanningSummaryForCustomerApp', CUSTOMER_APP_SYNC_SECRET: 'synthetic-secret' } : {},
    hubData,
    hubStatus,
  });
  const req = {
    method: 'POST',
    __base44: base44,
    json: async () => ({ preset: 'custom', date_from: PRODUCTION_DATE, date_to: PRODUCTION_DATE, ...body }),
  };
  const response = await handler(req);
  const payload = await response.json();
  return { status: response.status, payload, writes };
}

function assertNoForbiddenPayloads(payload) {
  const serialized = JSON.stringify(payload);
  for (const forbidden of [
    'do-not-return@example.test', '+15555550123', 'raw_payload', 'provider_payload', 'payment_payload', 'should_not_return',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked`);
  }
}

const results = [];

{
  const mirror = nativeOrder({ base44_order_id: 'order_delivered_authoritative' });
  const { payload, writes } = await invoke({
    store: {
      nativeOrders: [mirror],
      customerOrders: [{
        id: 'order_delivered_authoritative',
        order_number: mirror.shopify_order_number,
        status: 'delivered',
        delivered_at: '2026-06-20T18:00:00.000Z',
      }],
    },
    hubData: emptyHubPlanning(),
  });
  assert.equal(payload.summary.native_order_count, 0);
  assert.equal(payload.summary.planned_units, 0);
  assert.equal(payload.dates.length, 0);
  assert.equal(writes.length, 0);
  results.push('authoritative_delivered_order_suppresses_stale_awaiting_production_mirror');
}

{
  const { status, payload, writes } = await invoke({
    store: { nativeOrders: [nativeOrder()] },
    hubData: emptyHubPlanning(),
  });
  assert.equal(status, 200);
  assert.equal(payload.success, true);
  assert.equal(payload.native_first_enabled, true);
  assert.equal(payload.production_planning_source, 'customer_app_native_first');
  assert.equal(payload.writes_performed, false);
  assert.equal(payload.provider_call_impact, false);
  assert.equal(payload.notifications_sent, false);
  assert.equal(payload.hub_mutation_performed, false);
  assert.equal(payload.inventory_deduction_ready, false);
  assert.equal(payload.purchase_order_ready, false);
  assert.equal(payload.dates[0].data_source, 'customer_app_native');
  assert.equal(payload.dates[0].native_primary, true);
  assert.equal(payload.dates[0].hub_fallback_used, false);
  assert.ok(payload.summary.planned_units >= 1);
  const nativeIngredient = payload.ingredients.find(row => row.ingredient === 'Pineapple' && row.data_source === 'customer_app_native');
  assert.equal(nativeIngredient?.status, 'demand_based');
  assert.equal(nativeIngredient?.available_stock, null);
  assert.equal(nativeIngredient?.shortage_amount, 0);
  assert.equal(nativeIngredient?.stock_authoritative, false);
  assert.equal(nativeIngredient?.procurement_basis, 'demand_based_required');
  assert.equal(nativeIngredient?.procurement_needed_quantity, 1);
  assert.equal(payload.summary.shortage_count, 0);
  assert.equal(payload.summary.demand_based_procurement_count, 1);
  assert.equal(writes.length, 0);
  results.push('native_production_planning_data_present_native_primary');
  results.push('food_ingredient_planning_demand_based_not_stock_shortage');
  results.push('writes_performed_false');
  results.push('provider_call_impact_false');
  results.push('notifications_sent_false');
  results.push('hub_mutation_performed_false');
  results.push('inventory_deduction_ready_false');
  results.push('purchase_order_ready_false');
}

{
  const { payload } = await invoke({
    store: { nativeOrders: [nativeOrder({ shopify_order_number: 'NV-NATIVE-NOHUB' })] },
    hubEnv: false,
  });
  assert.equal(payload.native_first_enabled, true);
  assert.ok(payload.dates.some(row => row.data_source === 'customer_app_native'));
  assert.equal(payload.fallback_required, false);
  results.push('hub_rows_absent_native_summary_still_returned');
}

{
  const { payload } = await invoke({
    store: { nativeOrders: [] },
    hubData: hubPlanningWithPineapple({ product_name: 'Pineapple Juice' }),
  });
  assert.equal(payload.production_planning_source, 'hub_fallback');
  assert.equal(payload.hub_fallback_used, true);
  assert.equal(payload.fallback_required, true);
  assert.ok(payload.fallback_reasons.includes('native_planning_row_missing'));
  assert.ok(payload.dates.some(row => row.data_source === 'hub_fallback'));
  results.push('native_data_missing_hub_fallback_used');
}

{
  const { payload } = await invoke({
    store: {
      nativeOrders: [
        nativeOrder({
          shopify_order_number: 'NV-G39F-DATE-PENDING',
          production_date: null,
          delivery_date: null,
          assigned_delivery_date: null,
          selected_delivery_date: null,
          requested_delivery_date: null,
          scheduled_delivery_date: null,
          first_fulfillment: null,
          fulfillments: [],
        }),
      ],
    },
    hubData: hubPlanningWithPineapple({ planned_units: 15, required_quantity: 480 }),
  });
  const scheduledHubRow = payload.dates.find(row => row.production_date === PRODUCTION_DATE && row.data_source === 'hub_fallback');
  const pendingNativeRow = payload.dates.find(row => row.production_date === 'date_pending' && row.data_source === 'customer_app_native');
  const scheduledHubIngredient = payload.ingredients.find(row => (
    row.data_source === 'hub_fallback' &&
    Array.isArray(row.production_dates) &&
    row.production_dates.includes(PRODUCTION_DATE)
  ));
  const pendingNativeIngredient = payload.ingredients.find(row => (
    row.data_source === 'customer_app_native' &&
    Array.isArray(row.production_dates) &&
    row.production_dates.includes('date_pending')
  ));
  assert.equal(payload.summary.planned_units, 15);
  assert.equal(payload.summary.date_pending_planned_units, 1);
  assert.equal(payload.summary.production_date_count, 1);
  assert.equal(pendingNativeRow?.excluded_from_scheduled_totals, true);
  assert.equal(pendingNativeRow?.review_only, true);
  assert.ok(pendingNativeRow?.warnings?.includes('date_pending_review_only'));
  assert.ok(scheduledHubRow);
  assert.ok(scheduledHubIngredient);
  assert.equal(pendingNativeIngredient?.excluded_from_scheduled_totals, true);
  assert.ok(payload.warnings.includes('native_date_pending_excluded_from_scheduled_totals'));
  results.push('date_pending_native_overlay_excluded_from_scheduled_hub_totals');
  results.push('date_pending_native_ingredients_do_not_suppress_dated_hub_ingredients');
}

{
  const { payload } = await invoke({
    store: {
      nativeOrders: [
        nativeOrder({
          shopify_order_number: 'NV-G39F-STALE-DATE-PENDING',
          production_date: null,
          delivery_date: null,
          assigned_delivery_date: null,
          selected_delivery_date: null,
          requested_delivery_date: null,
          scheduled_delivery_date: null,
          first_fulfillment: null,
          fulfillments: [],
          customer_order_date: '2026-05-01T12:00:00Z',
          created_date: '2026-05-01T12:00:00Z',
          updated_date: '2026-05-01T12:00:00Z',
        }),
      ],
    },
    hubData: emptyHubPlanning(),
  });
  assert.equal(payload.summary.planned_units, 0);
  assert.equal(payload.summary.skipped_missing_date_count, 0);
  assert.equal(payload.summary.date_pending_planned_units, 0);
  assert.equal(payload.dates.some(row => row.production_date === 'date_pending'), false);
  results.push('stale_date_pending_native_overlay_excluded_from_current_planning_window');
}

{
  const { payload } = await invoke({
    store: { nativeOrders: [nativeOrder()], ingredientYields: [] },
    hubData: hubPlanningWithPineapple(),
  });
  assert.equal(payload.native_first_enabled, true);
  assert.ok(payload.dates.some(row => row.data_source === 'customer_app_native'));
  assert.ok(payload.ingredients.some(row => row.data_source === 'native_with_hub_fallback_context'));
  assert.ok(payload.fallback_reasons.includes('native_data_incomplete_for_production_planning'));
  results.push('native_data_incomplete_hub_fallback_context_used');
}

{
  const { payload } = await invoke({
    store: { nativeOrders: [nativeOrder()] },
    hubData: hubPlanningWithPineapple(),
  });
  const pineappleDateRows = payload.dates.filter(row => row.production_date === PRODUCTION_DATE);
  assert.equal(pineappleDateRows[0].data_source, 'customer_app_native');
  assert.equal(pineappleDateRows.filter(row => row.hub_fallback_used === true).length, 0);
  assert.ok(payload.suppressed_hub_row_count >= 1);
  assert.ok(payload.mismatch_count >= 0);
  results.push('duplicate_native_hub_same_product_date_deduped_native_primary');
}

{
  const { payload } = await invoke({
    store: { nativeOrders: [nativeOrder({ production_date: '2026-05-16', delivery_date: '2026-05-16' })] },
    hubData: emptyHubPlanning(),
    body: { preset: 'custom', date_from: '2026-05-16', date_to: '2026-05-16' },
  });
  assert.equal(payload.live_production_command_candidate, false);
  assert.equal(payload.production_batch_command_ready, false);
  assert.equal(payload.production_lifecycle_command_recommendation, 'preview_only_fresh_active_order_required');
  results.push('historical_late_mirror_not_live_production_candidate');
}

{
  const { payload } = await invoke({
    store: { nativeOrders: [nativeOrder({ order_type: 'subscription', source_channel: 'subscription', stripe_subscription_id: 'sub_synthetic' })] },
    hubData: hubPlanningWithPineapple({ product_name: 'Subscription Juice' }),
  });
  assert.equal(payload.production_planning_source, 'hub_fallback');
  assert.ok(payload.fallback_reasons.includes('native_planning_row_missing'));
  assert.equal(payload.live_production_command_candidate, false);
  results.push('subscription_multi_delivery_context_remains_hub_source_of_truth');
}

{
  const { payload } = await invoke({
    store: { nativeOrders: [nativeOrder({ title: 'Unknown Juice' })], recipes: [] },
    hubData: emptyHubPlanning(),
  });
  assert.ok(payload.summary.missing_recipe_count >= 1);
  assert.equal(payload.writes_performed, false);
  assert.equal(payload.production_batch_command_ready, false);
  results.push('missing_native_master_data_returns_warning_not_write_recommendation');
}

{
  const { payload } = await invoke({
    store: { nativeOrders: [nativeOrder()] },
    hubData: emptyHubPlanning(),
  });
  assert.equal(payload.summary.batch_count, 0);
  assert.equal(payload.production_batch_command_ready, false);
  assert.equal(payload.production_lifecycle_command_recommendation, 'preview_only_fresh_active_order_required');
  results.push('missing_production_batch_preview_only_not_auto_command');
}

{
  const { payload } = await invoke({ store: { nativeOrders: [] }, hubData: emptyHubPlanning() });
  assert.equal(payload.success, true);
  assert.equal(payload.dates.length, 0);
  assert.equal(payload.ingredients.length, 0);
  assert.equal(payload.production_planning_source, 'empty');
  results.push('no_rows_empty_safe_response');
}

{
  const { payload, writes } = await invoke({
    store: { nativeOrders: [nativeOrder()] },
    hubData: hubPlanningWithPineapple(),
  });
  assert.ok(payload.summary && Array.isArray(payload.dates) && Array.isArray(payload.ingredients));
  assert.ok(payload.native_overlay && typeof payload.native_overlay === 'object');
  assert.equal(payload.native_overlay.inventory_deduction_enabled, false);
  assert.equal(payload.native_overlay.purchase_order_automation_enabled, false);
  assertNoForbiddenPayloads(payload);
  assert.equal(writes.length, 0);
  results.push('existing_response_shape_backward_compatible');
  results.push('no_customer_email_phone_returned');
  results.push('no_raw_hub_provider_payment_payload_returned');
  results.push('no_logs_or_queues_created');
}

console.log(JSON.stringify({
  suite: 'g39f_admin_production_planning_native_first',
  total_test_cases: results.length,
  passed: results.length,
  failed: 0,
  results,
}, null, 2));
