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
  source += `\nglobalThis.__exports = { G36C_RESOLVE_PREVIEW_MODE, isG36CResolvePreviewRequest, buildG36CResolvePreview } ;\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    setTimeout: callback => { callback(); return 0; },
    fetch: fetchImpl || (async () => new Response(JSON.stringify({ success: false, tasks: [] }), { status: 503 })),
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  const exported = vm.runInContext('globalThis.__exports', context) || context.globalThis.__exports || context.__exports;
  if (!exported) throw new Error(`failed to export harness symbols; context keys=${Object.keys(context).join(',')}; global keys=${Object.keys(context.globalThis || {}).join(',')}`);
  return { exports: exported, source };
}

const IDS = {
  hubSubscriptionId: 'SUB-G36C-RESOLVE',
  parentOrderNumber: 'SUB-G36C-RESOLVE',
  hubOrderId: 'hub-order-g36c-resolve',
  taskOne: 'hub-task-g36c-resolve-1',
  taskTwo: 'hub-task-g36c-resolve-2',
  deliveryDate: '2026-05-09',
};

function makeOrder(overrides = {}) {
  return {
    id: 'customer-app-order-g36c-resolve',
    order_number: IDS.parentOrderNumber,
    status: 'delivered',
    payment_status: 'paid',
    fulfillment_status: 'fulfilled',
    items: [{ name: 'Weekly Fresh Subscription', quantity: 1 }],
    ...overrides,
  };
}

function makeHubTask(overrides = {}) {
  return {
    id: IDS.taskOne,
    order_id: IDS.hubOrderId,
    order_number: IDS.parentOrderNumber,
    status: 'Completed',
    delivery_status: 'delivered',
    scheduled_date: IDS.deliveryDate,
    delivery_date: IDS.deliveryDate,
    source_type: 'subscription_fulfillment',
    payment_status: 'paid',
    items: [{ title: 'Aura', quantity: 1 }],
    created_at: '2026-05-08T12:00:00.000Z',
    updated_at: '2026-05-09T12:00:00.000Z',
    ...overrides,
  };
}

function makeStore({ orders = [makeOrder()], subscriptions = [], nativeOrders = [], nativeTasks = [], user = { role: 'admin', email: 'synthetic_admin_label' } } = {}) {
  const store = { orders, subscriptions, nativeOrders, nativeTasks, writes: [] };
  const rowsFor = name => ({
    Subscription: store.subscriptions,
    Order: store.orders,
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.nativeTasks,
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
      auth: { me: async () => user },
      asServiceRole: { entities: {
        Subscription: api('Subscription'), Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'),
        OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'), ProductionBatch: api('ProductionBatch'),
      } },
    },
  };
}

function makeFetch({ tasks = [makeHubTask()], calls = [] } = {}) {
  return async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', hasAuthHeader: Boolean(opts.headers?.Authorization) });
    assert.equal(opts.method || 'GET', 'GET');
    assert.ok(String(url).includes('/functions/getFulfillmentTaskDetailsForCustomerApp'));
    return new Response(JSON.stringify({ success: true, matched_by: 'order_number', tasks }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function body(overrides = {}) {
  return {
    preview_mode: 'SUBSCRIPTION_OCCURRENCE_AMBIGUITY_RESOLUTION',
    hub_subscription_id: IDS.hubSubscriptionId,
    parent_order_number: `#${IDS.parentOrderNumber}`,
    date_from: IDS.deliveryDate,
    date_to: IDS.deliveryDate,
    fulfilled_only: true,
    max_candidates: 5,
    request_id: 'g36c_resolve_fixture',
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

async function runPreview({ tasks, orders, request = {}, env = { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' } } = {}) {
  const calls = [];
  const { exports: fns, source } = loadHarness({ env, fetchImpl: makeFetch({ tasks, calls }) });
  const scenario = makeStore({ orders });
  const preview = await fns.buildG36CResolvePreview(scenario.base44, body(request));
  return { fns, source, scenario, preview, calls };
}

const results = [];

{
  const { exports: fns, source } = loadHarness();
  assert.equal(fns.G36C_RESOLVE_PREVIEW_MODE, 'SUBSCRIPTION_OCCURRENCE_AMBIGUITY_RESOLUTION');
  assert.equal(fns.isG36CResolvePreviewRequest({ preview_mode: 'SUBSCRIPTION_OCCURRENCE_AMBIGUITY_RESOLUTION' }), true);
  assert.ok(source.includes('SUBSCRIPTION_OCCURRENCE_AMBIGUITY_RESOLUTION'));
  assert.ok(!source.includes('entities.OrderReviewQueue.create('));
}

{
  const { preview, scenario } = await runPreview({ tasks: [
    makeHubTask({ id: IDS.taskOne, payment_status: null, items_summary: '1x Weekly Fresh Subscription' }),
    makeHubTask({ id: IDS.taskTwo, payment_status: null, items_summary: '1x Weekly Fresh Subscription' }),
  ], orders: [makeOrder({ payment_status: 'cancelled' })], request: { operator_expected_payment_status: 'paid', operator_expected_line_item_count: 3 } });
  assert.equal(preview.matching_task_count, 2);
  assert.equal(preview.duplicate_occurrence_risk?.detected, true);
  assert.ok(preview.blockers.includes('duplicate_occurrence_risk'));
  assert.equal(preview.g36d_ready, false);
  assertNoWrites(preview, scenario.store, 'duplicate task risk');
  results.push('two_matching_tasks_duplicate_occurrence_risk');
}

{
  const { preview, scenario } = await runPreview({ tasks: [makeHubTask({ payment_status: 'paid', items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] })], orders: [makeOrder({ payment_status: 'paid', items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }] })], request: { operator_expected_payment_status: 'paid', operator_expected_line_item_count: 3 } });
  assert.equal(preview.matching_task_count, 1);
  assert.equal(preview.payment_status_authority?.authority, 'paid_authoritative');
  assert.equal(preview.line_item_discrepancy_analysis?.authoritative_count, 3);
  assert.equal(preview.g36d_ready, true);
  assert.ok(preview.g36d_approval_block?.includes('APPROVE G36D EXACT SUBSCRIPTION OCCURRENCE PREVIEW'));
  assertNoWrites(preview, scenario.store, 'g36d ready exact task');
  results.push('one_selected_authoritative_payment_g36d_ready');
}

{
  const { preview, scenario } = await runPreview({ tasks: [makeHubTask({ payment_status: null })], orders: [makeOrder({ payment_status: undefined })] });
  assert.equal(preview.payment_status_authority?.blocks_g36d, true);
  assert.ok(preview.blockers.includes('missing_payment_status') || preview.blockers.includes('payment_status_not_authoritative'));
  assert.equal(preview.g36d_ready, false);
  assertNoWrites(preview, scenario.store, 'missing payment');
  results.push('missing_payment_status_blocks');
}

{
  const { preview, scenario } = await runPreview({ tasks: [makeHubTask({ payment_status: null })], orders: [makeOrder({ payment_status: 'cancelled' })], request: { operator_expected_payment_status: 'paid' } });
  assert.equal(preview.payment_status_authority?.authority, 'payment_status_ambiguous');
  assert.ok(preview.blockers.includes('payment_status_ambiguous'));
  assertNoWrites(preview, scenario.store, 'ambiguous payment');
  results.push('ambiguous_payment_status_blocks');
}

{
  const { preview, scenario } = await runPreview({ tasks: [makeHubTask({ items_summary: '1 bundle' })], orders: [makeOrder({ items: [{ name: 'bundle' }] })], request: { operator_expected_line_item_count: 3 } });
  assert.equal(preview.line_item_discrepancy_analysis?.blocks_g36d, true);
  assert.ok(preview.line_item_discrepancy_analysis?.classifications.includes('line_item_count_ambiguous'));
  assert.ok(preview.blockers.includes('line_item_discrepancy_requires_owner_resolution'));
  assertNoWrites(preview, scenario.store, 'line item mismatch');
  results.push('line_item_mismatch_blocks_unless_resolved');
}

{
  const { preview, scenario } = await runPreview({ tasks: [makeHubTask({ repair_status: 'active_retry' })] });
  assert.ok(preview.blockers.includes('repair_replay_risk'));
  assert.equal(preview.g36d_ready, false);
  assertNoWrites(preview, scenario.store, 'repair replay risk');
  results.push('repair_replay_ambiguity_blocks');
}

{
  const { preview, scenario } = await runPreview({ tasks: [makeHubTask({ status: 'cancelled' })] });
  assert.ok(preview.blockers.includes('cancellation_refund_risk'));
  assert.equal(preview.g36d_ready, false);
  assertNoWrites(preview, scenario.store, 'cancellation refund risk');
  results.push('cancellation_refund_ambiguity_blocks');
}

{
  const { preview, scenario } = await runPreview({ tasks: [makeHubTask({ customer_email: 'synthetic_customer_marker_not_output', phone: '555-0100', raw_payload_marker: 'raw_payload_marker_not_output' })] });
  const serialized = JSON.stringify(preview);
  assert.equal(serialized.includes('synthetic_customer_marker_not_output'), false, 'customer email marker must not be returned');
  assert.equal(serialized.includes('555-0100'), false, 'phone marker must not be returned');
  assert.equal(serialized.includes('raw_payload_marker_not_output'), false, 'raw payload marker must not be returned');
  assertNoWrites(preview, scenario.store, 'no PII');
  results.push('no_pii_or_raw_payload_returned');
}

{
  const { preview, scenario, calls } = await runPreview({ tasks: [makeHubTask()] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.equal(preview.provider_call_impact, false);
  assertNoWrites(preview, scenario.store, 'no provider calls writes');
  results.push('no_provider_calls_no_writes');
}

console.log(JSON.stringify({
  suite: 'g36c-occurrence-ambiguity-resolution',
  passed: results.length,
  failed: 0,
  results,
  writes_performed: false,
  provider_call_impact: false,
  notifications_held: true,
}, null, 2));
