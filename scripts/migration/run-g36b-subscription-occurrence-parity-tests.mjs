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
  source += `\nglobalThis.__exports = { G36B_PREVIEW_MODE, G36B_READ_ONLY_SAFETY, isG36BPreviewRequest, buildG36BPreview } ;\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    setTimeout: callback => { callback(); return 0; },
    fetch: fetchImpl || (async () => new Response(JSON.stringify({ success: false, tasks: [] }), { status: 503 })),
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler, source };
}

const IDS = {
  subscriptionId: 'subscription-ca-g36b',
  stripeSubscriptionId: 'stripe-sub-test-g36b-safe-fake',
  hubOrderId: 'hub_order_g36b',
  orderNumber: 'SUB-G36B-0001',
  nativeOrderId: 'native_sub_order_g36b',
  taskId: 'native_task_g36b_1',
  fulfillmentNumber: 2,
  deliveryDate: '2026-06-24',
  productionDate: '2026-06-23',
};

function makeSubscription(overrides = {}) {
  return {
    id: IDS.subscriptionId,
    customer_email: 'synthetic_customer',
    stripe_subscription_id: IDS.stripeSubscriptionId,
    status: 'active',
    plan_id: 'plan_monthly',
    bundle_id: 'bundle_monthly',
    started_date: '2026-06-17',
    next_delivery_date: IDS.deliveryDate,
    hub_sync_status: 'synced',
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: IDS.nativeOrderId,
    shopify_order_number: IDS.orderNumber,
    order_type: 'subscription',
    fulfillment_mode: 'multi_delivery',
    source_channel: 'subscription',
    source_type: 'subscription_fulfillment',
    payment_status: 'paid',
    production_status: 'awaiting_production',
    fulfillment_status: 'pending',
    stripe_subscription_id: IDS.stripeSubscriptionId,
    customer_app_subscription_id: IDS.subscriptionId,
    fulfillments: [
      { fulfillment_number: 1, delivery_date: '2026-06-17', production_date: '2026-06-16', status: 'pending', items: [{ title: 'Aura', quantity: 1 }] },
      { fulfillment_number: IDS.fulfillmentNumber, delivery_date: IDS.deliveryDate, production_date: IDS.productionDate, status: 'pending', items: [{ title: 'Aura', quantity: 1 }] },
    ],
    ...overrides,
  };
}

function makeTask(overrides = {}) {
  return {
    id: IDS.taskId,
    native_shopify_order_id: IDS.nativeOrderId,
    order_number: IDS.orderNumber,
    order_type: 'subscription',
    source_type: 'subscription_fulfillment',
    fulfillment_type: 'subscription_delivery',
    fulfillment_number: IDS.fulfillmentNumber,
    delivery_date: IDS.deliveryDate,
    scheduled_date: IDS.deliveryDate,
    production_date: IDS.productionDate,
    status: 'scheduled',
    delivery_status: 'pending',
    payment_status: 'paid',
    items: [{ title: 'Aura', quantity: 1 }],
    items_summary: '1x Aura',
    stripe_subscription_id: IDS.stripeSubscriptionId,
    customer_app_subscription_id: IDS.subscriptionId,
    ...overrides,
  };
}

function makeHubTask(overrides = {}) {
  return {
    id: 'hub_task_g36b_2',
    order_id: IDS.hubOrderId,
    order_number: IDS.orderNumber,
    fulfillment_number: IDS.fulfillmentNumber,
    status: 'Scheduled',
    delivery_status: 'pending',
    scheduled_date: IDS.deliveryDate,
    delivery_date: IDS.deliveryDate,
    production_date: IDS.productionDate,
    source_type: 'subscription_fulfillment',
    schedule_source: 'subscription_renewal',
    payment_status: 'paid',
    items_summary: '1x Aura',
    ...overrides,
  };
}

function makeBatch(overrides = {}) {
  return {
    id: 'pb_g36b_1',
    batch_id: `NATIVE-${IDS.orderNumber}-2026-06-23-AURA`,
    product_name: 'Aura',
    production_date: IDS.productionDate,
    status: 'planned',
    planned_units: 1,
    order_sources: [{ order_number: IDS.orderNumber, customer_app_subscription_id: IDS.subscriptionId, quantity: 1 }],
    ...overrides,
  };
}

function makeStore({
  user = { role: 'admin', email: 'synthetic_owner_admin' },
  subscriptions = [makeSubscription()],
  orders = [],
  nativeOrders = [makeNativeOrder()],
  tasks = [],
  batches = [],
  orderSyncLogs = [],
  reviewRows = [],
  commandLogs = [],
  parityLogs = [],
} = {}) {
  const store = { subscriptions, orders, nativeOrders, tasks, batches, orderSyncLogs, reviewRows, commandLogs, parityLogs, writes: [] };
  const rowsFor = name => ({
    Subscription: store.subscriptions,
    Order: store.orders,
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.tasks,
    ProductionBatch: store.batches,
    OrderSyncLog: store.orderSyncLogs,
    OrderReviewQueue: store.reviewRows,
    CommandLog: store.commandLogs,
    SafeSyncParityLog: store.parityLogs,
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
        ProductionBatch: api('ProductionBatch'), OrderSyncLog: api('OrderSyncLog'), OrderReviewQueue: api('OrderReviewQueue'), CommandLog: api('CommandLog'), SafeSyncParityLog: api('SafeSyncParityLog'),
      } },
    },
  };
}

function makeFetch({ tasks = [makeHubTask()], calls = [] } = {}) {
  return async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', headers: opts.headers || {} });
    assert.equal(opts.method || 'GET', 'GET');
    assert.ok(String(url).includes('/functions/getFulfillmentTaskDetailsForCustomerApp'));
    return new Response(JSON.stringify({ success: true, matched_by: 'synthetic_exact_subscription_occurrence', tasks }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function exactBody(overrides = {}) {
  return {
    preview_mode: 'SUBSCRIPTION_OCCURRENCE_PARITY',
    mode: 'EXACT_OCCURRENCE_PREVIEW',
    subscription_id: IDS.subscriptionId,
    stripe_subscription_id: IDS.stripeSubscriptionId,
    order_number: IDS.orderNumber,
    fulfillment_number: IDS.fulfillmentNumber,
    delivery_date: IDS.deliveryDate,
    native_shopify_order_id: IDS.nativeOrderId,
    request_id: 'g36b_exact_fixture',
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
  assert.equal(preview.safety?.native_fulfillment_task_created, false, `${label}: no task create`);
  assert.equal(preview.safety?.hub_records_updated, false, `${label}: no Hub update`);
  assert.equal(store.writes.length, 0, `${label}: no writes captured`);
}

const hubCalls = [];
const { exports: fns, source } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: hubCalls }),
});
const { exports: fnsHubEmpty } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ tasks: [], calls: hubCalls }),
});

assert.equal(fns.G36B_PREVIEW_MODE, 'SUBSCRIPTION_OCCURRENCE_PARITY');
assert.equal(fns.isG36BPreviewRequest({ preview_mode: 'SUBSCRIPTION_OCCURRENCE_PARITY' }), true);
assert.equal(fns.G36B_READ_ONLY_SAFETY.writes_performed, false);
assert.ok(source.includes('SUBSCRIPTION_OCCURRENCE_PARITY'));
assert.ok(!source.includes('entities.OrderReviewQueue.create('), 'preview must not create review queue');

const results = [];

let scenario = makeStore({ tasks: [] });
let preview = await fns.buildG36BPreview(scenario.base44, exactBody());
assert.equal(preview.success, true);
assert.equal(preview.parity_classification, 'hub_source_of_truth_subscription_occurrence');
assert.equal(preview.hub_occurrence_present, true);
assert.equal(preview.native_fulfillment_task_present, false);
assert.equal(preview.delivery_task_impact.proposed_action, 'hub_task_present_native_task_held');
assertNoWrites(preview, scenario.store, 'hub present no native task');
results.push(`${preview.parity_classification}:${preview.next_action}`);

scenario = makeStore({ nativeOrders: [makeNativeOrder()], tasks: [] });
preview = await fns.buildG36BPreview(scenario.base44, {
  preview_mode: 'SUBSCRIPTION_OCCURRENCE_PARITY',
  mode: 'EXACT_OCCURRENCE_PREVIEW',
  subscription_id: IDS.subscriptionId,
  request_id: 'g36b_parent_only',
});
assert.equal(preview.success, false);
assert.equal(preview.occurrence_identity_status.ambiguous, true);
assert.ok(preview.blockers.includes('subscription_occurrence_identity_ambiguous'));
assert.equal(preview.next_action, 'provide_exact_subscription_occurrence_ids');
assertNoWrites(preview, scenario.store, 'parent only ambiguous');
results.push(`${preview.parity_classification}:${preview.next_action}`);

scenario = makeStore({ tasks: [makeTask()] });
preview = await fns.buildG36BPreview(scenario.base44, exactBody({ fulfillment_task_id: IDS.taskId }));
assert.equal(preview.success, true);
assert.equal(preview.native_fulfillment_task_present, true);
assert.equal(preview.hub_fulfillment_task_present, true);
assert.equal(preview.native_fulfillment_task_summary[0].id, IDS.taskId);
assert.equal(preview.hub_fulfillment_task_summary[0].fulfillment_number, IDS.fulfillmentNumber);
assertNoWrites(preview, scenario.store, 'exact occurrence');
results.push(`${preview.parity_classification}:${preview.next_action}`);

scenario = makeStore({ tasks: [makeTask({ id: 'task_dup_1' }), makeTask({ id: 'task_dup_2' })] });
preview = await fns.buildG36BPreview(scenario.base44, exactBody());
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('duplicate_task_risk'));
assert.equal(preview.duplicate_risk.duplicate_task_risk, true);
assertNoWrites(preview, scenario.store, 'duplicate native task');
results.push(`${preview.parity_classification}:${preview.next_action}`);

scenario = makeStore({ subscriptions: [makeSubscription({ cancel_at_period_end: true })], tasks: [] });
preview = await fns.buildG36BPreview(scenario.base44, exactBody());
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('refund_cancellation_ambiguity'));
assert.equal(preview.cancellation_refund_risk.refund_or_cancellation_ambiguity_detected, true);
assertNoWrites(preview, scenario.store, 'refund cancellation ambiguity');
results.push(`${preview.parity_classification}:${preview.next_action}`);

scenario = makeStore({ tasks: [makeTask()], batches: [makeBatch()] });
preview = await fns.buildG36BPreview(scenario.base44, exactBody({ fulfillment_task_id: IDS.taskId }));
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('production_demand_duplication_risk'));
assert.equal(preview.production_demand_impact.production_demand_duplication_risk, true);
assertNoWrites(preview, scenario.store, 'production demand duplication');
results.push(`${preview.parity_classification}:${preview.next_action}`);


scenario = makeStore({ tasks: [] });
preview = await fns.buildG36BPreview(scenario.base44, {
  preview_mode: 'SUBSCRIPTION_OCCURRENCE_PARITY',
  mode: 'EXACT_OCCURRENCE_PREVIEW',
  request_id: 'g36b_missing_identity',
});
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('no_exact_subscription_occurrence_identity'));
assert.equal(preview.next_action, 'provide_exact_subscription_occurrence_ids');
assertNoWrites(preview, scenario.store, 'missing exact identity');
results.push(`${preview.parity_classification}:${preview.next_action}`);

scenario = makeStore({ tasks: [] });
preview = await fnsHubEmpty.buildG36BPreview(scenario.base44, exactBody());
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('missing_hub_occurrence_when_hub_source_of_truth'));
assert.equal(preview.hub_occurrence_present, false);
assertNoWrites(preview, scenario.store, 'missing hub occurrence');
results.push(`${preview.parity_classification}:${preview.next_action}`);

scenario = makeStore({
  tasks: [],
  orderSyncLogs: [{ id: 'log_repair', order_number: IDS.orderNumber, status: 'pending', action: 'repair_subscription_occurrence' }],
});
preview = await fns.buildG36BPreview(scenario.base44, exactBody());
assert.equal(preview.success, false);
assert.ok(preview.blockers.includes('active_repair_replay_context'));
assertNoWrites(preview, scenario.store, 'active repair replay');
results.push(`${preview.parity_classification}:${preview.next_action}`);

scenario = makeStore({ subscriptions: [makeSubscription()], nativeOrders: [makeNativeOrder()], tasks: [makeTask()] });
preview = await fns.buildG36BPreview(scenario.base44, {
  preview_mode: 'SUBSCRIPTION_OCCURRENCE_PARITY',
  mode: 'RECENT_SUBSCRIPTION_OCCURRENCE_SCAN',
  limit: 5,
  request_id: 'g36b_recent_scan',
});
assert.equal(preview.success, true);
assert.equal(preview.mode, 'RECENT_SUBSCRIPTION_OCCURRENCE_SCAN');
assert.ok(preview.candidate_count > 0);
const serialized = JSON.stringify(preview);
assert.equal(serialized.includes('synthetic_customer'), false, 'recent scan must not expose customer email');
assert.equal(serialized.includes('555-'), false, 'recent scan must not expose phone');
assert.equal(preview.provider_call_impact, false);
assertNoWrites(preview, scenario.store, 'recent scan');
results.push(`scan:${preview.candidate_count}`);

console.log(JSON.stringify({
  suite: 'g36b-subscription-occurrence-parity',
  passed: results.length,
  failed: 0,
  classifications: results,
  hub_read_calls: hubCalls.length,
  writes_performed: false,
  provider_call_impact: false,
  notifications_held: true,
}, null, 2));
