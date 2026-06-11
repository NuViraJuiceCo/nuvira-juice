#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const functionPath = path.join(repoRoot, 'base44/functions/createNativeSubscriptionOccurrenceShopifyOrderMirrorForCustomerApp/entry.ts');

const IDS = {
  hubSubscriptionId: 'SUB-1TPMGCIR',
  parentOrderNumber: 'SUB-1TPMGCIR',
  hubOrderId: '69ed51368b5ca93c33a1b0b4',
  selectedTaskId: '69ffb0c9fedc8bbefc7710da',
  ignoredTaskId: '69f509d5a1bea46cdce8e274',
  deliveryDate: '2026-05-09',
  requestId: 'g36g_fixture_request',
};

function loadHarness({ env = {} } = {}) {
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { unsupportedBodyKey, getLookup, exactInputBlockers, validatePreview, buildNativeShopifyOrderRecord, validateNativeShopifyOrderRecord } ;\n`;
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
    hub_subscription_id: IDS.hubSubscriptionId,
    parent_order_number: `#${IDS.parentOrderNumber}`,
    hub_order_id: IDS.hubOrderId,
    delivery_date: IDS.deliveryDate,
    selected_hub_fulfillment_task_id: IDS.selectedTaskId,
    ignored_duplicate_hub_fulfillment_task_id: IDS.ignoredTaskId,
    payment_status: 'paid',
    financial_status: 'paid',
    fulfillment_status: 'fulfilled',
    production_status: 'fulfilled',
    line_item_count: 1,
    line_item_interpretation: 'subscription bundle/package count',
    decomposed_production_item_count: 'held_for_later',
    customer_app_cancelled_mirror_treatment: 'stale_artifact_for_this_preview_only',
    known_cancellation_refund_issue: 'no',
    known_repair_replay_issue: 'no',
    notification_policy: 'NO_NOTIFICATION',
    provider_call_policy: 'NO_PROVIDER_CALLS',
    hub_mutation_policy: 'NO_HUB_MUTATION',
    request_id: IDS.requestId,
    confirmation: 'create_native_subscription_occurrence_shopify_order_mirror_no_notification',
    ...overrides,
  };
}

function openEnv(overrides = {}) {
  return {
    ENABLE_NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR: 'true',
    NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_KILL_SWITCH: 'false',
    NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_ALLOWED_EMAILS: 'admin@example.test',
    NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_SUBSCRIPTION_ALLOWLIST: IDS.hubSubscriptionId,
    NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_ORDER_ALLOWLIST: `${IDS.parentOrderNumber},#${IDS.parentOrderNumber},${IDS.hubOrderId}`,
    NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_TASK_ALLOWLIST: IDS.selectedTaskId,
    NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_POLICY: 'EXACT_SUBSCRIPTION_OCCURRENCE_MIRROR_ONLY_NO_NOTIFICATION',
    ...overrides,
  };
}

function makePreview(overrides = {}) {
  return {
    success: true,
    dry_run: true,
    writes_performed: false,
    preview_mode: 'SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET',
    mode: 'EXACT_OCCURRENCE_MIRROR_PACKET',
    mirror_packet_ready: true,
    selected_hub_fulfillment_task_id: IDS.selectedTaskId,
    ignored_duplicate_hub_fulfillment_task_id: IDS.ignoredTaskId,
    payment_status: 'paid',
    fulfillment_status: 'fulfilled',
    line_item_count: 1,
    line_item_interpretation: 'subscription bundle/package count',
    customer_app_cancelled_mirror_treatment: 'stale_artifact_for_this_preview_only',
    blockers: [],
    schema_packet_blockers: [],
    proposed_native_shopify_order_packet: { shopify_order_number: `#${IDS.parentOrderNumber}` },
    provider_call_impact: false,
    notification_impact: { notification_held: true, notification_would_send: false },
    hub_mutation_performed: false,
    hub_records_updated: false,
    existing_record_checks: { native_shopify_order_present: false, native_fulfillment_task_present: false },
    ...overrides,
  };
}

function makeStore({ user = { role: 'admin', email: 'admin@example.test' }, preview = makePreview(), nativeOrders = [], tasks = [], commandLogs = [] } = {}) {
  const store = { nativeOrders, tasks, commandLogs, orders: [], batches: [], compliance: [], reviewRows: [], syncLogs: [], notifications: [], messageLogs: [], writes: [] };
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
        assert.equal(payload.preview_mode, 'SUBSCRIPTION_OCCURRENCE_MIRROR_PACKET');
        return { data: preview };
      } },
      asServiceRole: { entities: {
        ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), CommandLog: api('CommandLog'), Order: api('Order'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), OrderReviewQueue: api('OrderReviewQueue'), OrderSyncLog: api('OrderSyncLog'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog'),
      } },
    },
  };
}

function req({ base44, method = 'POST', payload = body() }) {
  return {
    method,
    __base44: base44,
    text: async () => JSON.stringify(payload),
  };
}

async function invoke({ env = openEnv(), storeArgs = {}, payload = body(), method = 'POST' } = {}) {
  const { handler, source } = loadHarness({ env });
  const scenario = makeStore(storeArgs);
  const response = await handler(req({ base44: scenario.base44, method, payload }));
  const json = await response.json();
  return { status: response.status, json, scenario, source };
}

function assertNoBusinessWrites(store, label) {
  const forbidden = store.writes.filter(write => !['CommandLog', 'ShopifyOrder'].includes(write.name));
  assert.deepEqual(forbidden, [], `${label}: no forbidden writes`);
}

const results = [];

{
  const { status, json, scenario } = await invoke({ env: {} });
  assert.equal(status, 409);
  assert.equal(json.writes_performed, false);
  assert.equal(json.error_code, 'native_subscription_occurrence_mirror_disabled');
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
  const { status, json, scenario } = await invoke({ env: openEnv({ NATIVE_SUBSCRIPTION_OCCURRENCE_MIRROR_POLICY: 'WRONG' }) });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'native_subscription_occurrence_mirror_policy_required');
  assert.equal(scenario.store.writes.length, 0);
  results.push('policy_mismatch_blocks');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), payload: body({ selected_hub_fulfillment_task_id: '' }) });
  assert.equal(status, 400);
  assert.ok(json.blockers.includes('selected_hub_fulfillment_task_id_required'));
  assert.equal(scenario.store.writes.length, 0);
  results.push('missing_exact_selected_task_id_blocks');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { preview: makePreview({ success: false, blockers: ['not_ready'], mirror_packet_ready: false }) } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'g36f_mirror_packet_preview_not_write_ready');
  assert.equal(scenario.store.writes.length, 0);
  results.push('fresh_g36f_preview_blocker_blocks');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { preview: makePreview({ schema_packet_blockers: ['schema_packet_blocker'] }) } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'g36f_mirror_packet_preview_not_write_ready');
  assert.equal(scenario.store.writes.length, 0);
  results.push('schema_packet_blocker_blocks');
}

{
  const existing = { id: 'existing-native', shopify_order_number: `#${IDS.parentOrderNumber}`, sync_status: 'other_source' };
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { nativeOrders: [existing] } });
  assert.equal(status, 409);
  assert.equal(json.error_code, 'native_shopify_order_already_exists_for_occurrence');
  assert.equal(scenario.store.writes.length, 0);
  results.push('existing_native_shopify_order_dedupes_conflicts_safely');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv() });
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.writes_performed, true);
  assert.equal(json.native_shopify_order_created, true);
  assert.equal(json.command_log_created, true);
  assert.equal(scenario.store.nativeOrders.length, 1);
  assert.equal(scenario.store.commandLogs.length, 1);
  assert.equal(scenario.store.nativeOrders[0].shopify_order_number, `#${IDS.parentOrderNumber}`);
  assert.equal(scenario.store.nativeOrders[0].source_type, 'subscription_occurrence_hub_mirror');
  assert.equal(scenario.store.nativeOrders[0].sync_status, 'native_subscription_occurrence_mirror_g36g');
  assert.equal(scenario.store.nativeOrders[0].line_items.length, 1);
  assert.equal(scenario.store.nativeOrders[0].audit_trail[0].raw_payload_included, false);
  assert.equal(scenario.store.nativeOrders[0].audit_trail[0].notification_sent, false);
  assert.equal(scenario.store.nativeOrders[0].audit_trail[0].provider_call_performed, false);
  assert.equal(scenario.store.nativeOrders[0].audit_trail[0].hub_mutation_performed, false);
  assert.equal(Boolean(scenario.store.nativeOrders[0].customer_email || scenario.store.nativeOrders[0].customer_phone || scenario.store.nativeOrders[0].delivery_address), false);
  assert.equal(scenario.store.tasks.length, 0);
  assert.equal(scenario.store.orders.length, 0);
  assert.equal(scenario.store.batches.length, 0);
  assert.equal(scenario.store.compliance.length, 0);
  assert.equal(scenario.store.notifications.length, 0);
  assert.equal(scenario.store.messageLogs.length, 0);
  assertNoBusinessWrites(scenario.store, 'valid command');
  results.push('valid_in_memory_command_creates_one_native_shopify_order_and_one_command_log');
  results.push('customer_app_order_not_created');
  results.push('fulfillment_task_not_created');
  results.push('production_batch_not_created');
  results.push('batch_compliance_log_not_created');
  results.push('notifications_not_sent');
  results.push('provider_calls_false');
  results.push('hub_mutation_false');
  results.push('raw_payloads_not_written');
}

{
  const existingSuccess = { id: 'cmd-existing-success', status: 'success', idempotency_key: `native_subscription_occurrence_shopify_order_mirror_create:${IDS.hubSubscriptionId}:${IDS.hubOrderId}:${IDS.selectedTaskId}:${IDS.requestId}` };
  const { status, json, scenario } = await invoke({ env: openEnv(), storeArgs: { commandLogs: [existingSuccess] } });
  assert.equal(status, 200);
  assert.equal(json.skipped, true);
  assert.equal(json.idempotent, true);
  assert.equal(json.writes_performed, false);
  assert.equal(scenario.store.nativeOrders.length, 0);
  assert.equal(scenario.store.writes.length, 0);
  results.push('duplicate_request_id_skips');
}

{
  const { status, json, scenario } = await invoke({ env: openEnv(), payload: body({ raw_hub_payload: { unsafe: true } }) });
  assert.equal(status, 400);
  assert.equal(json.error_code, 'unsupported_or_forbidden_input');
  assert.equal(scenario.store.writes.length, 0);
  results.push('raw_payload_input_forbidden');
}

console.log(JSON.stringify({
  suite: 'g36g-subscription-occurrence-mirror-command',
  passed: results.length,
  failed: 0,
  results,
  writes_limited_to_in_memory_native_shopify_order_and_command_log: true,
  live_records_mutated: false,
  provider_call_impact: false,
  notifications_sent: false,
  hub_mutation: false,
}, null, 2));
