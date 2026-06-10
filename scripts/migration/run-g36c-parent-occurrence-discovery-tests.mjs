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
  source += `\nglobalThis.__exports = { G36C_HELPER_PREVIEW_MODE, isG36CHelperPreviewRequest, buildG36CHelperPreview } ;\n`;
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
  subscriptionId: 'subscription-ca-g36c-helper',
  hubSubscriptionId: 'hub-subscription-g36c-helper',
  parentOrderNumber: 'SUB-G36C-0001',
  hubOrderId: 'hub-order-g36c-helper',
  hubTaskId: 'hub-task-g36c-helper-1',
  nativeOrderId: 'native-order-g36c-helper',
  nativeTaskId: 'native-task-g36c-helper',
  deliveryDate: '2026-06-24',
  productionDate: '2026-06-23',
};

function makeSubscription(overrides = {}) {
  return {
    id: IDS.subscriptionId,
    stripe_subscription_id: IDS.hubSubscriptionId,
    status: 'active',
    next_delivery_date: IDS.deliveryDate,
    hub_sync_status: 'synced',
    operator_marker: 'synthetic_customer_marker_not_output',
    contact_marker: 'synthetic_contact_marker_not_output',
    ...overrides,
  };
}

function makeOrder(overrides = {}) {
  return {
    id: 'customer-app-order-g36c-helper',
    order_number: IDS.parentOrderNumber,
    status: 'delivered',
    payment_status: 'paid',
    fulfillment_type: 'subscription_delivery',
    ...overrides,
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: IDS.nativeOrderId,
    shopify_order_number: IDS.parentOrderNumber,
    order_type: 'subscription',
    fulfillment_mode: 'multi_delivery',
    payment_status: 'paid',
    fulfillment_status: 'fulfilled',
    customer_app_subscription_id: IDS.subscriptionId,
    stripe_subscription_id: IDS.hubSubscriptionId,
    fulfillments: [
      {
        id: 'occurrence-native-g36c-helper',
        fulfillment_number: 1,
        delivery_date: IDS.deliveryDate,
        production_date: IDS.productionDate,
        status: 'fulfilled',
        items: [{ title: 'Aura', quantity: 2 }],
      },
    ],
    ...overrides,
  };
}

function makeNativeTask(overrides = {}) {
  return {
    id: IDS.nativeTaskId,
    native_shopify_order_id: IDS.nativeOrderId,
    order_number: IDS.parentOrderNumber,
    order_type: 'subscription',
    source_type: 'subscription_fulfillment',
    fulfillment_type: 'subscription_delivery',
    fulfillment_number: 1,
    delivery_date: IDS.deliveryDate,
    scheduled_date: IDS.deliveryDate,
    production_date: IDS.productionDate,
    status: 'delivered',
    delivery_status: 'delivered',
    payment_status: 'paid',
    items_summary: '2x Aura',
    customer_app_subscription_id: IDS.subscriptionId,
    stripe_subscription_id: IDS.hubSubscriptionId,
    ...overrides,
  };
}

function makeHubTask(overrides = {}) {
  return {
    id: IDS.hubTaskId,
    order_id: IDS.hubOrderId,
    order_number: IDS.parentOrderNumber,
    fulfillment_number: 1,
    status: 'Delivered',
    delivery_status: 'delivered',
    scheduled_date: IDS.deliveryDate,
    delivery_date: IDS.deliveryDate,
    production_date: IDS.productionDate,
    source_type: 'subscription_fulfillment',
    payment_status: 'paid',
    items_summary: '2x Aura',
    ...overrides,
  };
}

function makeStore({
  user = { role: 'admin', email: 'synthetic_admin_label' },
  subscriptions = [makeSubscription()],
  orders = [makeOrder()],
  nativeOrders = [],
  tasks = [],
  orderSyncLogs = [],
  reviewRows = [],
  commandLogs = [],
  parityLogs = [],
} = {}) {
  const store = { subscriptions, orders, nativeOrders, tasks, orderSyncLogs, reviewRows, commandLogs, parityLogs, writes: [] };
  const rowsFor = name => ({
    Subscription: store.subscriptions,
    Order: store.orders,
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.tasks,
    OrderSyncLog: store.orderSyncLogs,
    OrderReviewQueue: store.reviewRows,
    CommandLog: store.commandLogs,
    SafeSyncParityLog: store.parityLogs,
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
    return new Response(JSON.stringify({ success: true, matched_by: 'synthetic_parent_identifier', tasks }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

function body(overrides = {}) {
  return {
    preview_mode: 'SUBSCRIPTION_PARENT_TO_OCCURRENCE_DISCOVERY',
    subscription_id: IDS.subscriptionId,
    customer_app_subscription_id: IDS.subscriptionId,
    fulfilled_only: true,
    max_candidates: 5,
    request_id: 'g36c_helper_fixture',
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

const hubCalls = [];
const { exports: fns, source } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: hubCalls }),
});
assert.equal(fns.G36C_HELPER_PREVIEW_MODE, 'SUBSCRIPTION_PARENT_TO_OCCURRENCE_DISCOVERY');
assert.equal(fns.isG36CHelperPreviewRequest({ preview_mode: 'SUBSCRIPTION_PARENT_TO_OCCURRENCE_DISCOVERY' }), true);
assert.ok(source.includes('SUBSCRIPTION_PARENT_TO_OCCURRENCE_DISCOVERY'));
assert.ok(!source.includes('entities.OrderReviewQueue.create('));

const results = [];

let scenario = makeStore();
let preview = await fns.buildG36CHelperPreview(scenario.base44, {
  preview_mode: 'SUBSCRIPTION_PARENT_TO_OCCURRENCE_DISCOVERY',
  customer_label: 'operator display only',
  request_id: 'label_only',
});
assert.equal(preview.success, true);
assert.equal(preview.candidate_count, 0);
assert.equal(preview.parent_identity_status, 'customer_label_only_not_sufficient');
assert.ok(preview.blockers.includes('exact_parent_identifier_required'));
assert.equal(hubCalls.length, 0, 'customer label only must not call Hub');
assertNoWrites(preview, scenario.store, 'label only');
results.push(preview.parent_identity_status);

scenario = makeStore();
preview = await fns.buildG36CHelperPreview(scenario.base44, body());
assert.equal(preview.success, true);
assert.equal(preview.parent_identity_status, 'exact_parent_identifier_present');
assert.equal(preview.candidate_count, 1);
assert.equal(preview.g36d_ready_candidate_count, 1);
assert.equal(preview.candidate_rows[0].g36d_ready, true);
assert.equal(preview.candidate_rows[0].classification, 'g36d_ready_exact_occurrence_candidate');
assert.equal(preview.candidate_rows[0].hub_fulfillment_task_id, IDS.hubTaskId);
assert.ok(preview.owner_ready_g36d_approval_block.includes('APPROVE G36D EXACT SUBSCRIPTION OCCURRENCE PREVIEW'));
assertNoWrites(preview, scenario.store, 'ready hub candidate');
results.push(preview.candidate_rows[0].classification);

const hubOnlyCalls = [];
const { exports: fnsHubOnly } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: hubOnlyCalls, tasks: [makeHubTask()] }),
});
scenario = makeStore({ subscriptions: [], orders: [], nativeOrders: [], tasks: [] });
preview = await fnsHubOnly.buildG36CHelperPreview(scenario.base44, body({ subscription_id: undefined, customer_app_subscription_id: undefined, hub_subscription_id: IDS.hubSubscriptionId }));
assert.equal(preview.parent_identity_status, 'exact_parent_identifier_present');
assert.equal(preview.candidate_count, 1, 'exact hub_subscription_id returns occurrence candidates');
assert.equal(preview.candidate_rows[0].g36d_ready, true);
assertNoWrites(preview, scenario.store, 'exact hub subscription id');
results.push('exact_hub_subscription_id_candidates');

const multiCalls = [];
const { exports: fnsMultiple } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: multiCalls, tasks: [
    makeHubTask({ id: 'hub-task-g36c-multi-1', order_number: 'SUB-G36C-0001-A', order_id: 'hub-order-g36c-a', delivery_date: '2026-06-24', scheduled_date: '2026-06-24' }),
    makeHubTask({ id: 'hub-task-g36c-multi-2', order_number: 'SUB-G36C-0001-B', order_id: 'hub-order-g36c-b', delivery_date: '2026-07-24', scheduled_date: '2026-07-24' }),
  ] }),
});
scenario = makeStore();
preview = await fnsMultiple.buildG36CHelperPreview(scenario.base44, body({ date_from: '2026-06-01', date_to: '2026-08-01' }));
assert.equal(preview.candidate_count, 2, 'multiple candidates return candidate table');
assert.equal(preview.g36d_ready_candidate_count, 2);
assert.equal(preview.owner_ready_g36d_approval_block, null);
assert.equal(preview.next_action, 'owner_select_one_exact_occurrence_candidate');
assertNoWrites(preview, scenario.store, 'multiple candidates owner selection');
results.push('multiple_candidates_owner_selection_required');

const noCandidateCalls = [];
const { exports: fnsNoCandidates } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: noCandidateCalls, tasks: [] }),
});
scenario = makeStore({ nativeOrders: [], tasks: [] });
preview = await fnsNoCandidates.buildG36CHelperPreview(scenario.base44, body());
assert.equal(preview.candidate_count, 0, 'no candidates returns no table rows');
assert.ok(preview.blockers.includes('no_occurrence_candidates_found'));
assert.ok(preview.exact_fields_still_needed.includes('occurrence_id_or_delivery_date_plus_order_number'));
assert.equal(preview.next_action, 'hold_subscription_migration_until_exact_occurrence_identifiers_available');
assertNoWrites(preview, scenario.store, 'no candidates hold');
results.push('no_candidates_hold_with_fields_needed');

const missingOccurrenceCalls = [];
const { exports: fnsMissingOccurrence } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: missingOccurrenceCalls, tasks: [makeHubTask({ order_number: '', hub_order_number: '', order_id: IDS.hubOrderId })] }),
});
scenario = makeStore();
preview = await fnsMissingOccurrence.buildG36CHelperPreview(scenario.base44, body({ parent_order_number: undefined, order_number: undefined }));
assert.equal(preview.candidate_count, 1);
assert.ok(preview.candidate_rows[0].blockers.includes('missing_occurrence_id'));
assert.equal(preview.candidate_rows[0].g36d_ready, false);
assertNoWrites(preview, scenario.store, 'missing occurrence id');
results.push('missing_occurrence_id_blocks');

const missingDateCalls = [];
const { exports: fnsMissingDate } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: missingDateCalls, tasks: [makeHubTask({ delivery_date: '', scheduled_date: '' })] }),
});
scenario = makeStore();
preview = await fnsMissingDate.buildG36CHelperPreview(scenario.base44, body());
assert.equal(preview.candidate_count, 1);
assert.ok(preview.candidate_rows[0].blockers.includes('missing_delivery_date'));
assert.equal(preview.candidate_rows[0].g36d_ready, false);
assertNoWrites(preview, scenario.store, 'missing delivery date');
results.push('missing_delivery_date_blocks');

const scheduledCalls = [];
const { exports: fnsScheduled } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: scheduledCalls, tasks: [makeHubTask({ id: 'hub-task-scheduled', status: 'Scheduled', delivery_status: 'pending' })] }),
});
scenario = makeStore();
preview = await fnsScheduled.buildG36CHelperPreview(scenario.base44, body());
assert.equal(preview.candidate_count, 0, 'fulfilled_only filters non-fulfilled occurrences');
assert.ok(preview.blockers.includes('no_occurrence_candidates_found'));
assertNoWrites(preview, scenario.store, 'fulfilled only filter');
results.push('fulfilled_only_filtered');

preview = await fnsScheduled.buildG36CHelperPreview(scenario.base44, body({ fulfilled_only: false }));
assert.equal(preview.candidate_count, 1, 'fulfilled_only false includes scheduled occurrence');
assert.equal(preview.candidate_rows[0].payment_status, 'paid');
assertNoWrites(preview, scenario.store, 'include scheduled when requested');
results.push('fulfilled_only_false_includes_candidate');

const dupCalls = [];
const { exports: fnsDuplicate } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: dupCalls, tasks: [makeHubTask({ id: 'hub-task-dup-1' }), makeHubTask({ id: 'hub-task-dup-2' })] }),
});
scenario = makeStore();
preview = await fnsDuplicate.buildG36CHelperPreview(scenario.base44, body());
assert.equal(preview.candidate_count, 1, 'duplicate occurrence rows dedupe to one safe candidate');
assert.equal(preview.candidate_rows[0].duplicate_risk.duplicate_occurrence_risk, true);
assert.ok(preview.candidate_rows[0].blockers.includes('duplicate_occurrence_risk'));
assert.equal(preview.candidate_rows[0].g36d_ready, false);
assertNoWrites(preview, scenario.store, 'duplicate occurrence risk');
results.push('duplicate_occurrence_risk');

const dupNative = loadHarness({ env: {} });
scenario = makeStore({ nativeOrders: [], tasks: [makeNativeTask({ id: 'native-task-dup-a' }), makeNativeTask({ id: 'native-task-dup-b' })] });
preview = await dupNative.exports.buildG36CHelperPreview(scenario.base44, body({ fulfilled_only: true }));
assert.equal(preview.candidate_count, 1, 'duplicate native task rows dedupe to one candidate');
assert.equal(preview.candidate_rows[0].duplicate_risk.duplicate_occurrence_risk, true);
assert.ok(preview.candidate_rows[0].blockers.includes('duplicate_occurrence_risk'));
assert.equal(preview.candidate_rows[0].g36d_ready, false);
assertNoWrites(preview, scenario.store, 'duplicate native task risk');
results.push('duplicate_native_task_risk');

const cancelCalls = [];
const { exports: fnsCancel } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: cancelCalls, tasks: [makeHubTask({ payment_status: 'partially_refunded', status: 'Delivered' })] }),
});
scenario = makeStore();
preview = await fnsCancel.buildG36CHelperPreview(scenario.base44, body());
assert.equal(preview.candidate_count, 1);
assert.ok(preview.candidate_rows[0].blockers.includes('cancellation_refund_risk'));
assert.equal(preview.candidate_rows[0].g36d_ready, false);
assertNoWrites(preview, scenario.store, 'cancellation refund ambiguity');
results.push('cancellation_refund_ambiguity_blocks');

const repairCalls = [];
const { exports: fnsRepair } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: repairCalls, tasks: [makeHubTask({ repair_status: 'active_retry' })] }),
});
scenario = makeStore();
preview = await fnsRepair.buildG36CHelperPreview(scenario.base44, body());
assert.equal(preview.candidate_count, 1);
assert.ok(preview.candidate_rows[0].blockers.includes('repair_replay_risk'));
assert.equal(preview.candidate_rows[0].g36d_ready, false);
assertNoWrites(preview, scenario.store, 'repair replay ambiguity');
results.push('repair_replay_ambiguity_blocks');

const missingLineCalls = [];
const { exports: fnsMissingLine } = loadHarness({
  env: { HUB_API_URL: 'https://hub.example.invalid', CUSTOMER_APP_SYNC_SECRET: 'test-secret' },
  fetchImpl: makeFetch({ calls: missingLineCalls, tasks: [makeHubTask({ items_summary: '', items: [] })] }),
});
scenario = makeStore();
preview = await fnsMissingLine.buildG36CHelperPreview(scenario.base44, body());
assert.equal(preview.candidate_count, 1);
assert.equal(preview.candidate_rows[0].g36d_ready, false);
assert.ok(preview.candidate_rows[0].missing_fields.includes('line_item_count'));
assert.ok(preview.candidate_rows[0].blockers.includes('missing_line_items'));
assertNoWrites(preview, scenario.store, 'missing line items');
results.push('missing_line_items');

const localOnly = loadHarness({ env: {} });
scenario = makeStore({ nativeOrders: [makeNativeOrder()], tasks: [makeNativeTask()] });
preview = await localOnly.exports.buildG36CHelperPreview(scenario.base44, body({ fulfilled_only: true }));
assert.equal(preview.parent_context.hub_read_status.configured, false);
assert.ok(preview.warnings.includes('hub_read_not_configured_local_preview_only'));
assert.ok(preview.candidate_count >= 1, 'local native mirrors can support discovery context');
assertNoWrites(preview, scenario.store, 'local support context');
results.push('local_support_context');

const serialized = JSON.stringify(preview);
assert.equal(serialized.includes('synthetic_customer_marker_not_output'), false, 'customer email-style field must not be returned');
assert.equal(serialized.includes('synthetic_contact_marker_not_output'), false, 'contact marker must not be returned');
assert.equal(serialized.includes('raw_payload'), false, 'raw payload marker must not be returned');
assert.equal(serialized.includes(IDS.hubSubscriptionId), false, 'internal subscription provider id must not be echoed');

console.log(JSON.stringify({
  suite: 'g36c-parent-occurrence-discovery',
  passed: results.length,
  failed: 0,
  results,
  writes_performed: false,
  provider_call_impact: false,
  notifications_held: true,
}, null, 2));
