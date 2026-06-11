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
  source += `\nglobalThis.__exports = { buildG36BPreview, isG36BPreviewRequest, g36bUnsupportedBodyKey } ;\n`;
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
  hubSubscriptionId: 'SUB-G36D-0001',
  parentOrderNumber: 'SUB-G36D-0001',
  hubOrderId: 'hub-order-g36d-0001',
  selectedTaskId: 'hub-task-g36d-selected',
  ignoredTaskId: 'hub-task-g36d-ignored',
  deliveryDate: '2026-05-09',
};

function makeCustomerOrder(overrides = {}) {
  return {
    id: 'customer-app-order-g36d-parent',
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

function makeStore({ orders = [makeCustomerOrder()], nativeOrders = [], tasks = [], subscriptions = [] } = {}) {
  const store = { orders, nativeOrders, tasks, subscriptions, writes: [] };
  const rowsFor = name => ({
    Subscription: store.subscriptions,
    Order: store.orders,
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.tasks,
    OrderSyncLog: [],
    OrderReviewQueue: [],
    CommandLog: [],
    SafeSyncParityLog: [],
    ProductionBatch: [],
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
        Subscription: api('Subscription'), Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'),
        OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'), ProductionBatch: api('ProductionBatch'),
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
    preview_mode: 'SUBSCRIPTION_OCCURRENCE_PARITY',
    mode: 'EXACT_OCCURRENCE_PREVIEW',
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
    request_id: 'g36d_exact_fixture',
    ...overrides,
  };
}

function assertNoWrites(preview, store, label) {
  assert.equal(preview.dry_run, true, `${label}: dry_run`);
  assert.equal(preview.writes_performed, false, `${label}: writes_performed`);
  assert.equal(preview.provider_call_impact, false, `${label}: provider calls false`);
  assert.equal(preview.notification_impact?.notification_would_send, false, `${label}: notification send false`);
  assert.equal(preview.notification_impact?.notification_held, true, `${label}: notification held`);
  assert.equal(preview.safety?.subscriptions_created, false, `${label}: no subscription create`);
  assert.equal(preview.safety?.hub_records_updated, false, `${label}: no Hub update`);
  assert.equal(store.writes.length, 0, `${label}: no captured writes`);
}

async function run({ tasks = [makeHubTask(), makeHubTask({ id: IDS.ignoredTaskId, payment_status: null, source_type: null })], request = {} } = {}) {
  const calls = [];
  const { exports: fns, source } = loadHarness({ env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' }, fetchImpl: makeFetch({ tasks, calls }) });
  const scenario = makeStore();
  const preview = await fns.buildG36BPreview(scenario.base44, body(request));
  return { fns, source, scenario, preview, calls };
}

const results = [];

{
  const { exports: fns, source } = loadHarness();
  assert.equal(fns.isG36BPreviewRequest({ preview_mode: 'SUBSCRIPTION_OCCURRENCE_PARITY' }), true);
  assert.equal(fns.g36bUnsupportedBodyKey(body()), null);
  assert.ok(source.includes('selected_hub_fulfillment_task_id'));
  assert.ok(!source.includes('entities.OrderReviewQueue.create('));
}

{
  const { preview, scenario, calls } = await run();
  assert.equal(calls.length, 1);
  assert.equal(preview.success, true);
  assert.equal(preview.blockers.length, 0);
  assert.equal(preview.selected_hub_fulfillment_task_id, IDS.selectedTaskId);
  assert.equal(preview.ignored_duplicate_hub_fulfillment_task_id, IDS.ignoredTaskId);
  assert.equal(preview.duplicate_resolution_status, 'owner_selected_duplicate_same_occurrence_task_for_read_only_preview');
  assert.equal(preview.delivery_task_impact?.hub_fulfillment_task_count, 1);
  assert.equal(preview.payment_status, 'paid');
  assert.equal(preview.payment_status_authority?.authority, 'hub_task_paid_context_owner_approved');
  assert.equal(preview.line_item_count, 1);
  assert.equal(preview.line_item_interpretation, 'subscription bundle/package count');
  assert.equal(preview.decomposed_production_item_count, 'held_for_later');
  assert.equal(preview.customer_app_cancelled_mirror_treatment, 'stale_artifact_for_this_preview_only');
  assert.equal(preview.cancellation_refund_risk?.refund_or_cancellation_ambiguity_detected, false);
  assert.ok(preview.warnings.includes('duplicate_hub_task_ignored_by_owner_decision'));
  assert.ok(preview.warnings.includes('customer_app_cancelled_mirror_treated_as_stale_artifact_for_preview_only'));
  assert.ok(preview.warnings.includes('production_decomposition_held'));
  assertNoWrites(preview, scenario.store, 'approved exact occurrence');
  results.push('selected_task_disambiguates_duplicate_same_occurrence');
  results.push('ignored_duplicate_not_treated_as_separate_occurrence');
  results.push('paid_selected_task_satisfies_payment_authority');
  results.push('line_item_count_bundle_package_accepted_decomposition_held');
  results.push('cancelled_parent_mirror_treated_as_stale_artifact');
}

{
  const { preview, scenario } = await run({ request: { selected_hub_fulfillment_task_id: IDS.ignoredTaskId } });
  assert.equal(preview.success, false);
  assert.ok(preview.blockers.includes('selected_hub_task_payment_status_not_paid'));
  assertNoWrites(preview, scenario.store, 'selected unpaid/null task blocks');
  results.push('selected_task_without_paid_status_blocks');
}

{
  const { preview, scenario } = await run({ request: { line_item_count: undefined } });
  assert.equal(preview.success, false);
  assert.ok(preview.blockers.includes('owner_line_item_count_required_for_g36d'));
  assertNoWrites(preview, scenario.store, 'missing owner line item blocks');
  results.push('missing_owner_line_item_count_blocks');
}

console.log(JSON.stringify({
  suite: 'g36d-exact-subscription-occurrence-preview',
  passed: results.length,
  failed: 0,
  results,
  writes_performed: false,
  provider_call_impact: false,
  notifications_held: true,
}, null, 2));
