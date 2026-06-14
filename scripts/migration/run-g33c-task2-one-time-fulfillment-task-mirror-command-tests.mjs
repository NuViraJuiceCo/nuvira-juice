#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/createNativeOneTimeFulfillmentTaskMirrorForCustomerApp/entry.ts');

const IDS = {
  orderNumber: 'NV-MP5SOQLJ',
  customerAppOrderId: '6a060df457fc07751f3c7ded',
  nativeShopifyOrderId: '6a2df0026e266e19c68046eb',
  requestId: 'g33c_task2_fixture_request',
};
const REQUIRED_EMAIL = ['required.customer', 'example.test'].join('@');
const INTERNAL_ADDRESS_LINE1 = 'delivery-line-1';

function loadHarness({ env = {} } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { unsupportedBodyKey, getLookup, exactInputBlockers, gateFailure, resolveTask1PreviewEvidence, validatePreview, schemaAudit, schemaBlockers, buildNativeFulfillmentTaskRecord, validateNativeFulfillmentTaskRecord, summarizeNativeFulfillmentTask } ;\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Promise,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { handler: context.globalThis.__handler, exports: context.globalThis.__exports, source };
}

function body(overrides = {}) {
  return {
    order_number: IDS.orderNumber,
    customer_app_order_id: IDS.customerAppOrderId,
    native_shopify_order_id: IDS.nativeShopifyOrderId,
    task_creation_policy: 'EXACT_NATIVE_SHOPIFY_ORDER_LINK_ONLY',
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    request_id: IDS.requestId,
    confirmation: 'create_native_one_time_fulfillment_task_mirror_no_notification',
    ...overrides,
  };
}

function openEnv(overrides = {}) {
  return {
    ENABLE_NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR: 'true',
    NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_KILL_SWITCH: 'false',
    NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_ALLOWED_EMAILS: 'admin@example.test',
    NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_ORDER_ALLOWLIST: `${IDS.orderNumber},#${IDS.orderNumber}`,
    NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_CUSTOMER_ORDER_ALLOWLIST: IDS.customerAppOrderId,
    NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_SHOPIFY_ORDER_ALLOWLIST: IDS.nativeShopifyOrderId,
    NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_POLICY: 'EXACT_ONE_TIME_FULFILLMENT_TASK_MIRROR_ONLY_NO_NOTIFICATION',
    ...overrides,
  };
}

function taskPacket(overrides = {}) {
  return {
    order_id: IDS.customerAppOrderId,
    base44_order_id: IDS.customerAppOrderId,
    shopify_order_id: IDS.nativeShopifyOrderId,
    native_shopify_order_id: IDS.nativeShopifyOrderId,
    shopify_order_number: `#${IDS.orderNumber}`,
    order_number: IDS.orderNumber,
    source_channel: 'online',
    source_type: 'customer_app_one_time_native_task_mirror_preview',
    task_source: 'g33c_task1_one_time_native_fulfillment_task_packet_preview',
    created_from_native_ops: true,
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    fulfillment_number: 1,
    delivery_date: '2026-05-16',
    scheduled_date: '2026-05-16',
    assigned_delivery_date: '2026-05-16',
    production_date: '2026-05-16',
    time_window: '12:00 PM – 3:00 PM',
    delivery_window_label: '12:00 PM – 3:00 PM',
    items: [
      { title: 'Pineapple Juice', quantity: 1, price: 15 },
      { title: 'Watermelon Juice', quantity: 1, price: 12 },
      { title: 'RE-NU', quantity: 1, price: 13 },
    ],
    items_summary: '3 line items',
    line_item_count: 3,
    total_price: 43.99,
    address_complete: true,
    status: 'bottled_packed',
    delivery_status: 'pending',
    production_status: 'bottled',
    payment_status: 'paid',
    sync_status: 'native_one_time_fulfillment_task_preview_g33c_task1',
    schedule_source: 'customer_app_order_date_native_mirror_preview',
    review_status: 'preview_ready',
    review_reason: 'preview_only_no_write',
    ...overrides,
  };
}

function makePreview(overrides = {}) {
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    preview_mode: 'ONE_TIME_NATIVE_FULFILLMENT_TASK_MIRROR_PACKET',
    marker: 'g33c_task1_one_time_native_fulfillment_task_packet_preview',
    order_number: IDS.orderNumber,
    customer_app_order_id: IDS.customerAppOrderId,
    native_shopify_order_id: IDS.nativeShopifyOrderId,
    native_shopify_order_present: true,
    native_fulfillment_task_present: false,
    task_packet_ready: true,
    proposed_native_fulfillment_task_packet: taskPacket(),
    existing_record_checks: {
      fulfillment_task_by_native_shopify_order: 0,
      fulfillment_task_by_customer_app_order: 0,
      fulfillment_task_by_order_number: 0,
    },
    duplicate_task_risk: false,
    duplicate_task_risk_reasons: [],
    provider_call_impact: false,
    notification_impact: { notification_would_send: false, notification_held: true, notification_rows_created: false, message_logs_created: false },
    hub_mutation_performed: false,
    blockers: [],
    warnings: ['notifications_held'],
    safety: { hub_records_updated: false, hub_bridge_modified: false },
    ...overrides,
  };
}

function customerOrder(overrides = {}) {
  return {
    id: IDS.customerAppOrderId,
    order_number: IDS.orderNumber,
    customer_email: REQUIRED_EMAIL,
    status: 'bottled_packed',
    payment_status: 'paid',
    payment_captured: true,
    fulfillment_type: 'delivery',
    address_line1: INTERNAL_ADDRESS_LINE1,
    address_city: 'Austin',
    address_state: 'TX',
    address_postal_code: '78701',
    total_price: 43.99,
    ...overrides,
  };
}

function nativeShopifyOrder(overrides = {}) {
  return {
    id: IDS.nativeShopifyOrderId,
    base44_order_id: IDS.customerAppOrderId,
    shopify_order_number: `#${IDS.orderNumber}`,
    source_channel: 'online',
    source_type: 'customer_app_one_time_native_mirror',
    order_type: 'one_time',
    fulfillment_method: 'delivery',
    payment_status: 'paid',
    production_status: 'bottled',
    fulfillment_status: 'pending',
    sync_status: 'native_one_time_mirror_g33c_mirror2',
    ...overrides,
  };
}

function makeStore({ user = { role: 'admin', email: 'admin@example.test' }, preview = makePreview(), orders = [customerOrder()], nativeOrders = [nativeShopifyOrder()], tasks = [], commandLogs = [] } = {}) {
  const store = { orders, nativeOrders, tasks, commandLogs, batches: [], compliance: [], reviewRows: [], syncLogs: [], notifications: [], messageLogs: [], writes: [] };
  const rowsFor = name => ({
    ShopifyOrder: store.nativeOrders,
    FulfillmentTask: store.tasks,
    CommandLog: store.commandLogs,
    Order: store.orders,
    ProductionBatch: store.batches,
    BatchComplianceLog: store.compliance,
    OrderReviewQueue: store.reviewRows,
    OrderSyncLog: store.syncLogs,
    Notification: store.notifications,
    CustomerMessageDeliveryLog: store.messageLogs,
  }[name] || []);
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    get: async id => {
      const row = rowsFor(name).find(item => item.id === id);
      if (!row) throw new Error(`${name} row not found`);
      return row;
    },
    list: async (_sort, limit = 200) => rowsFor(name).slice(0, limit),
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
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
      Object.assign(row, patch);
      store.writes.push({ op: 'update', name, id, patch });
      return row;
    },
    delete: async id => { store.writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    store,
    base44: {
      auth: { me: async () => user },
      functions: { invoke: async (name, payload) => {
        assert.equal(name, 'previewNativeOrderCutoverReadiness');
        assert.equal(payload.preview_mode, 'ONE_TIME_NATIVE_FULFILLMENT_TASK_MIRROR_PACKET');
        assert.equal(payload.order_number, IDS.orderNumber);
        assert.equal(payload.customer_app_order_id, IDS.customerAppOrderId);
        assert.equal(payload.native_shopify_order_id, IDS.nativeShopifyOrderId);
        return { data: preview };
      } },
      asServiceRole: { entities: {
        ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), CommandLog: api('CommandLog'), Order: api('Order'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), OrderReviewQueue: api('OrderReviewQueue'), OrderSyncLog: api('OrderSyncLog'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog'),
      } },
    },
  };
}

function req({ base44, method = 'POST', payload = body() }) {
  return { method, __base44: base44, text: async () => JSON.stringify(payload) };
}

async function invoke({ env = openEnv(), storeArgs = {}, payload = body(), method = 'POST' } = {}) {
  const { handler, source } = loadHarness({ env });
  const scenario = makeStore(storeArgs);
  const response = await handler(req({ base44: scenario.base44, method, payload }));
  const json = await response.json();
  return { status: response.status, json, scenario, source };
}

function assertNoForbiddenWrites(store, label) {
  const forbidden = store.writes.filter(write => !['CommandLog', 'FulfillmentTask'].includes(write.name));
  assert.deepEqual(forbidden, [], `${label}: no forbidden writes`);
}

function assertNoPiiInOutput(value, label) {
  const text = JSON.stringify(value);
  assert.ok(!text.includes(REQUIRED_EMAIL), `${label}: customer email not exposed`);
  assert.ok(!text.includes(INTERNAL_ADDRESS_LINE1), `${label}: full address not exposed`);
}

const results = [];

{
  const { status, json, scenario } = await invoke({ env: {} });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'native_one_time_fulfillment_task_mirror_disabled');
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.writes.length, 0);
  results.push('disabled_gate_returns_409_no_writes');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { user: null } });
  assert.equal(status, 401);
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.writes.length, 0);
  results.push('missing_auth_returns_401');
}

{
  const { status, json } = await invoke({ env: openEnv(), storeArgs: { user: { role: 'user', email: 'admin@example.test' } } });
  assert.equal(status, 403);
  assert.equal(json.writes_performed, false);
  results.push('non_admin_returns_403');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), payload: body({ confirmation: 'wrong' }) });
  assert.equal(status, 400);
  assert.ok(json.blockers.includes('confirmation_phrase_required'));
  assert.equal(scenario.store.writes.length, 0);
  results.push('missing_confirmation_blocks');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv({ NATIVE_ONE_TIME_FULFILLMENT_TASK_MIRROR_POLICY: 'WRONG' }) });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'native_one_time_fulfillment_task_mirror_policy_required');
  assert.equal(scenario.store.writes.length, 0);
  results.push('policy_mismatch_blocks');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), payload: body({ native_shopify_order_id: '' }) });
  assert.equal(status, 400);
  assert.ok(json.blockers.includes('target_native_shopify_order_id_mismatch'));
  assert.equal(scenario.store.writes.length, 0);
  results.push('missing_native_shopify_order_id_blocks');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { preview: makePreview({ blockers: ['not_ready'] }) } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'g33c_task1_preview_not_write_ready');
  assert.equal(scenario.store.writes.length, 0);
  results.push('fresh_g33c_task1_preview_blocker_blocks');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { preview: makePreview({ task_packet_ready: false }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('task_packet_not_ready'));
  assert.equal(scenario.store.writes.length, 0);
  results.push('task_packet_ready_false_blocks');
}

{
  const existingTask = { id: 'existing-task', order_id: IDS.customerAppOrderId, native_shopify_order_id: IDS.nativeShopifyOrderId, order_number: IDS.orderNumber };
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { tasks: [existingTask] } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'native_fulfillment_task_already_exists_for_order');
  assert.equal(scenario.store.writes.length, 0);
  results.push('existing_fulfillment_task_dedupes_conflicts_safely');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { orders: [customerOrder({ customer_email: '' })] } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'schema_contract_blocker');
  assert.ok(json.blockers.includes('customer_email_required_for_fulfillment_task_missing'));
  assert.equal(scenario.store.writes.length, 0);
  results.push('missing_customer_email_when_schema_required_blocks');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv() });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.writes_performed, true);
  assert.equal(json.native_fulfillment_task_created, true);
  assert.equal(json.command_log_created, true);
  assert.equal(scenario.store.tasks.length, 1);
  assert.equal(scenario.store.commandLogs.length, 1);
  assert.equal(scenario.store.tasks[0].customer_email, REQUIRED_EMAIL);
  assertNoPiiInOutput(json, 'valid command response');
  assertNoPiiInOutput(scenario.store.commandLogs[0], 'valid command log');
  results.push('internal_customer_email_hydration_succeeds_without_exposing_it');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { preview: makePreview({ proposed_native_fulfillment_task_packet: taskPacket({ status: 'unknown_status' }) }) } });
  assert.equal(status, 409);
  assert.ok(json.blockers.includes('invalid_fulfillment_task_status'));
  assert.equal(scenario.store.writes.length, 0);
  results.push('invalid_task_status_blocks');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv() });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.writes_performed, true);
  assert.equal(json.native_fulfillment_task_created, true);
  assert.equal(json.command_log_created, true);
  assert.equal(scenario.store.tasks.length, 1);
  assert.equal(scenario.store.commandLogs.length, 1);
  const task = scenario.store.tasks[0];
  assert.equal(task.order_id, IDS.customerAppOrderId);
  assert.equal(task.base44_order_id, IDS.customerAppOrderId);
  assert.equal(task.native_shopify_order_id, IDS.nativeShopifyOrderId);
  assert.equal(task.shopify_order_id, IDS.nativeShopifyOrderId);
  assert.equal(task.order_number, IDS.orderNumber);
  assert.equal(task.source_channel, 'online');
  assert.equal(task.source_type, 'customer_app_one_time_native_mirror');
  assert.equal(task.task_source, 'native_one_time_fulfillment_task_mirror');
  assert.equal(task.status, 'bottled_packed');
  assert.equal(task.delivery_status, 'pending');
  assert.equal(task.production_status, 'bottled');
  assert.equal(task.payment_status, 'paid');
  assert.equal(task.sync_status, 'native_one_time_fulfillment_task_mirror_g33c_task2');
  assert.equal(task.delivery_date, '2026-05-16');
  assert.equal(task.production_date, '2026-05-16');
  assert.equal(task.line_item_count, 3);
  assert.equal(task.items.length, 3);
  assert.equal(task.audit_trail[0].raw_payload_included, false);
  assert.equal(task.audit_trail[0].notification_sent, false);
  assert.equal(task.audit_trail[0].provider_call_performed, false);
  assert.equal(task.audit_trail[0].hub_mutation_performed, false);
  assert.equal(scenario.store.orders.length, 1);
  assert.equal(scenario.store.nativeOrders.length, 1);
  assert.equal(scenario.store.batches.length, 0);
  assert.equal(scenario.store.compliance.length, 0);
  assert.equal(scenario.store.notifications.length, 0);
  assert.equal(scenario.store.messageLogs.length, 0);
  assertNoForbiddenWrites(scenario.store, 'valid command');
  results.push('valid_in_memory_command_creates_one_fulfillment_task_and_one_command_log');
  results.push('customer_app_order_not_updated');
  results.push('native_shopify_order_not_updated');
  results.push('production_batch_not_created');
  results.push('batch_compliance_log_not_created');
  results.push('notifications_not_sent');
  results.push('provider_calls_false');
  results.push('hub_mutation_false');
  results.push('raw_payloads_not_written');
}

{
  const existingSuccess = { id: 'cmd-existing-success', status: 'success', idempotency_key: `native_one_time_fulfillment_task_mirror_create:${IDS.orderNumber}:${IDS.customerAppOrderId}:${IDS.nativeShopifyOrderId}:${IDS.requestId}` };
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { commandLogs: [existingSuccess] } });
  assert.equal(status, 200);
  assert.equal(json.skipped, true);
  assert.equal(json.idempotent, true);
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.tasks.length, 0);
  assert.equal(scenario.store.writes.length, 0);
  results.push('duplicate_request_id_skips');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), payload: body({ raw_customer_app_payload: { unsafe: true } }) });
  assert.equal(status, 400);
  assert.equal(json.error_code, 'unsupported_or_forbidden_input');
  assert.equal(scenario.store.writes.length, 0);
  results.push('raw_payload_input_forbidden');
}

{
  const { source } = loadHarness({ env: openEnv() });
  assert.ok(!/entities\.Order\.create\(/.test(source));
  assert.ok(!/entities\.ShopifyOrder\.create\(/.test(source));
  assert.ok(!/entities\.ProductionBatch\.create\(/.test(source));
  assert.ok(!/entities\.BatchComplianceLog\.create\(/.test(source));
  assert.ok(!/entities\.OrderSyncLog\.create\(/.test(source));
  assert.ok(!/entities\.OrderReviewQueue\.create\(/.test(source));
  assert.ok(!/entities\.Notification\.create\(/.test(source));
  assert.ok(!/entities\.CustomerMessageDeliveryLog\.create\(/.test(source));
  assert.ok(!source.includes('fetch('));
  results.push('source_contains_no_disallowed_create_paths_or_public_self_fetch');
}

console.log(JSON.stringify({
  suite: 'g33c-task2-one-time-fulfillment-task-mirror-command',
  passed: results.length,
  failed: 0,
  results,
  writes_limited_to_in_memory_fulfillment_task_and_command_log: true,
  live_records_mutated: false,
  customer_email_hydrated_internally_not_returned: true,
  provider_call_impact: false,
  notifications_sent: false,
  hub_mutation: false,
}, null, 2));
