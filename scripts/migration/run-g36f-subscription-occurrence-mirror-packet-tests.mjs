#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');

function loadHarness({ env = {}, fetchImpl } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { buildG36FPreview, isG36FPreviewRequest, g36fUnsupportedBodyKey } ;\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    setTimeout: callback => { callback(); return 0; },
    fetch: fetchImpl || (async () => new Response(JSON.stringify({ success: false, tasks: [] }), { status: 503 })),
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: vm.runInContext('globalThis.__exports', context) || context.globalThis.__exports, source };
}

const IDS = {
  hubSubscriptionId: 'SUB-G36F-0001',
  parentOrderNumber: 'SUB-G36F-0001',
  hubOrderId: 'hub-order-g36f-0001',
  selectedTaskId: 'hub-task-g36f-selected',
  ignoredTaskId: 'hub-task-g36f-ignored',
  deliveryDate: '2026-05-09',
};

function makeCustomerOrder(overrides = {}) {
  return {
    id: 'customer-app-order-g36f-parent',
    order_number: IDS.parentOrderNumber,
    status: 'cancelled',
    payment_status: 'cancelled',
    fulfillment_status: 'cancelled',
    delivery_status: 'cancelled',
    items: [{ name: 'Weekly Fresh Subscription' }],
    ...overrides,
  };
}

function makeHubTask(overrides = {}) {
  return {
    id: IDS.selectedTaskId,
    order_id: IDS.hubOrderId,
    order_number: IDS.parentOrderNumber,
    status: 'Completed',
    delivery_status: 'delivered',
    scheduled_date: IDS.deliveryDate,
    delivery_date: IDS.deliveryDate,
    source_type: 'subscription_fulfillment',
    payment_status: 'paid',
    items_summary: 'Weekly Fresh Subscription',
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: 'native-shopify-order-g36f-existing',
    shopify_order_number: `#${IDS.parentOrderNumber}`,
    source_channel: 'subscription',
    source_type: 'subscription_occurrence_hub_preview',
    order_type: 'subscription',
    fulfillment_mode: 'single_delivery',
    payment_status: 'paid',
    production_status: 'fulfilled',
    fulfillment_status: 'fulfilled',
    assigned_delivery_date: IDS.deliveryDate,
    is_subscription: true,
    audit_trail: [{ selected_hub_fulfillment_task_id: IDS.selectedTaskId }],
    ...overrides,
  };
}

function makeStore({ orders = [makeCustomerOrder()], nativeOrders = [], tasks = [], subscriptions = [], batches = [] } = {}) {
  const store = { orders, nativeOrders, tasks, subscriptions, batches, writes: [] };
  const rowsFor = name => ({
    Subscription: store.subscriptions,
    Order: store.orders,
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.tasks,
    ProductionBatch: store.batches,
    OrderSyncLog: [],
    OrderReviewQueue: [],
    CommandLog: [],
    SafeSyncParityLog: [],
  }[name] || []);
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    list: async () => rowsFor(name),
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    get: async id => rowsFor(name).find(row => row?.id === id) || null,
    create: async payload => { store.writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, patch) => { store.writes.push({ op: 'update', name, id, patch }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { store.writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    store,
    base44: {
      auth: { me: async () => ({ role: 'admin', email: 'synthetic_admin_label' }) },
      asServiceRole: { entities: {
        Subscription: api('Subscription'), Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'),
        OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'),
      } },
    },
  };
}

function makeFetch({ tasks, calls = [] } = {}) {
  return async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', hasAuthHeader: Boolean(opts.headers?.Authorization) });
    assert.equal(opts.method || 'GET', 'GET');
    assert.ok(String(url).includes('/functions/getFulfillmentTaskDetailsForCustomerApp'));
    return new Response(JSON.stringify({ success: true, matched_by: 'hub_order_id', tasks }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function body(overrides = {}) {
  return {
    preview_mode: 'SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET',
    mode: 'EXACT_OCCURRENCE_MIRROR_PACKET',
    hub_subscription_id: IDS.hubSubscriptionId,
    parent_order_number: `#${IDS.parentOrderNumber}`,
    hub_order_id: IDS.hubOrderId,
    delivery_date: IDS.deliveryDate,
    selected_hub_fulfillment_task_id: IDS.selectedTaskId,
    ignored_duplicate_hub_fulfillment_task_id: IDS.ignoredTaskId,
    payment_status: 'paid',
    fulfillment_status: 'delivered',
    line_item_count: 1,
    line_item_interpretation: 'subscription bundle/package count',
    decomposed_production_item_count: 'held_for_later',
    known_cancellation_refund_issue: 'no',
    known_repair_replay_issue: 'no',
    customer_app_cancelled_mirror_treatment: 'stale_artifact_for_this_preview_only',
    request_id: 'g36f_exact_fixture',
    ...overrides,
  };
}

function assertNoWrites(preview, store, label) {
  assert.equal(preview.dry_run, true, `${label}: dry_run`);
  assert.equal(preview.writes_performed, false, `${label}: writes_performed`);
  assert.equal(preview.provider_call_impact, false, `${label}: provider calls false`);
  assert.equal(preview.notification_impact?.notification_would_send, false, `${label}: notification send false`);
  assert.equal(preview.notification_impact?.notification_held, true, `${label}: notification held`);
  assert.equal(preview.held_records?.customer_app_order?.held, true, `${label}: customer app order held`);
  assert.equal(preview.held_records?.native_fulfillment_task?.held, true, `${label}: fulfillment task held`);
  assert.equal(preview.held_records?.production_batch?.held, true, `${label}: production batch held`);
  assert.equal(preview.held_records?.notification?.held, true, `${label}: notification held`);
  assert.equal(preview.safety?.native_shopify_order_created, false, `${label}: no native order create`);
  assert.equal(preview.safety?.hub_records_updated, false, `${label}: no hub update`);
  assert.equal(store.writes.length, 0, `${label}: no captured writes`);
}

async function run({ tasks = [makeHubTask(), makeHubTask({ id: IDS.ignoredTaskId, payment_status: null, source_type: null })], request = {}, storeOverrides = {} } = {}) {
  const calls = [];
  const { exports: fns, source } = loadHarness({ env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' }, fetchImpl: makeFetch({ tasks, calls }) });
  const scenario = makeStore(storeOverrides);
  const preview = await fns.buildG36FPreview(scenario.base44, body(request));
  return { fns, source, scenario, preview, calls };
}

const results = [];

{
  const { exports: fns, source } = loadHarness();
  assert.equal(fns.isG36FPreviewRequest({ preview_mode: 'SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET' }), true);
  assert.equal(fns.g36fUnsupportedBodyKey(body()), null);
  assert.ok(source.includes('SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET'));
  assert.ok(!source.includes('entities.ShopifyOrder.create('));
  assert.ok(!source.includes('entities.OrderReviewQueue.create('));
  results.push('g36f_preview_mode_is_registered_read_only');
}

{
  const { preview, scenario, calls } = await run();
  assert.equal(calls.length, 1);
  assert.equal(preview.success, true);
  assert.equal(preview.mirror_packet_ready, true);
  assert.equal(preview.blockers.length, 0);
  assert.equal(preview.selected_hub_fulfillment_task_id, IDS.selectedTaskId);
  assert.equal(preview.ignored_duplicate_hub_fulfillment_task_id, IDS.ignoredTaskId);
  assert.equal(preview.duplicate_resolution_status, 'owner_selected_duplicate_same_occurrence_task');
  assert.equal(preview.line_item_count, 1);
  assert.equal(preview.line_item_interpretation, 'subscription bundle/package count');
  assert.equal(preview.decomposed_production_item_count, 'held_for_later');
  assert.equal(preview.customer_app_cancelled_mirror_treatment, 'stale_artifact_for_this_preview_only');
  assert.equal(preview.proposed_native_shopify_order_packet?.shopify_order_number, `#${IDS.parentOrderNumber}`);
  assert.equal(preview.proposed_native_shopify_order_packet?.source_type, 'subscription_occurrence_hub_preview');
  assert.equal(preview.proposed_native_shopify_order_packet?.source_channel, 'subscription');
  assert.equal(preview.proposed_native_shopify_order_packet?.order_type, 'subscription');
  assert.equal(preview.proposed_native_shopify_order_packet?.fulfillment_mode, 'single_delivery');
  assert.equal(preview.proposed_native_shopify_order_packet?.payment_status, 'paid');
  assert.equal(preview.proposed_native_shopify_order_packet?.production_status, 'fulfilled');
  assert.equal(preview.proposed_native_shopify_order_packet?.line_items?.[0]?.title, 'Subscription bundle/package (production decomposition held)');
  assert.equal(preview.proposed_native_shopify_order_packet?.audit_trail?.[0]?.selected_hub_fulfillment_task_id, IDS.selectedTaskId);
  assert.equal(preview.proposed_native_shopify_order_packet?.audit_trail?.[0]?.ignored_duplicate_hub_fulfillment_task_id, IDS.ignoredTaskId);
  assert.ok(preview.omitted_fields.some(row => row.field === 'shopify_order_id'));
  assert.ok(preview.schema_supported_fields?.packet_top_level_fields.includes('audit_trail'));
  assertNoWrites(preview, scenario.store, 'clean mirror packet');
  results.push('exact_g36d_approved_occurrence_generates_schema_safe_packet');
  results.push('selected_and_ignored_duplicate_task_ids_included_as_context');
  results.push('bundle_line_item_and_decomposition_hold_are_preserved');
  results.push('customer_app_cancelled_mirror_treatment_is_preview_context_only');
}

{
  const { preview, scenario } = await run({ storeOverrides: { nativeOrders: [makeNativeOrder()] } });
  assert.equal(preview.success, false);
  assert.equal(preview.mirror_packet_ready, false);
  assert.ok(preview.blockers.includes('existing_native_shopify_order_found'));
  assert.equal(preview.existing_record_checks?.native_shopify_order_present, true);
  assert.ok(preview.duplicate_risk?.duplicate_risk_reasons.includes('existing_native_shopify_order_for_occurrence_context'));
  assertNoWrites(preview, scenario.store, 'existing native order dedupes');
  results.push('existing_native_shopify_order_dedupes_and_blocks_create_preview');
}

{
  const { preview, scenario } = await run({ request: { fulfillment_status: 'unknown_future_status' } });
  assert.equal(preview.success, false);
  assert.equal(preview.mirror_packet_ready, false);
  assert.ok(preview.blockers.includes('schema_packet_blocker'));
  assert.ok(preview.schema_packet_blockers.includes('fulfillment_status_value_not_supported_for_g36f_packet'));
  assertNoWrites(preview, scenario.store, 'unsupported schema value blocks');
  results.push('unsupported_schema_value_returns_schema_packet_blocker');
}

{
  const { preview, scenario } = await run({ request: { line_item_interpretation: 'decomposed products' } });
  assert.equal(preview.success, false);
  assert.ok(preview.blockers.includes('schema_packet_blocker'));
  assert.ok(preview.schema_packet_blockers.includes('line_item_interpretation_not_approved_for_g36f_packet'));
  assertNoWrites(preview, scenario.store, 'unsupported line item interpretation blocks');
  results.push('unsupported_line_item_interpretation_blocks_packet_readiness');
}

console.log(JSON.stringify({
  suite: 'g36f-subscription-occurrence-mirror-packet-preview',
  passed: results.length,
  failed: 0,
  results,
  writes_performed: false,
  provider_call_impact: false,
  notifications_held: true,
}, null, 2));
