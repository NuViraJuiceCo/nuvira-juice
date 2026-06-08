#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/previewNativeDeliveryCompletionReconciliation/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(/^export \{[\s\S]*?\};\s*$/m, '');
  source += `\nglobalThis.__exports = { READ_ONLY_SAFETY, statusMappingAudit, buildNativeDeliveredRow, buildHistoricalHubBackfillRow, buildResponse, targetSpecsFromBody, lookupFromBody, commonPolicyBlockers, safeHubOrderStatus, DELIVERED_TASK_STATUS, DELIVERED_DELIVERY_STATUS, SHOPIFY_ORDER_FULFILLED_STATUS, CUSTOMER_ORDER_DELIVERED_STATUS };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, AbortController, setTimeout, clearTimeout, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    createClientFromRequest: req => req.__base44,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ orders: [] }) }),
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler };
}

function customerOrder(overrides = {}) {
  return {
    id: '6a219a3f4adcda5856c3d579',
    order_number: 'NV-MPZNKGNT',
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    payment_captured: true,
    production_date: '2026-06-07',
    assigned_delivery_date: '2026-06-08',
    status_history: [{ status: 'order_received' }, { status: 'scheduled_for_juicing' }],
    ...overrides,
  };
}

function nativeOrder(overrides = {}) {
  return {
    id: '6a22ffda400eb806eb3ca945',
    shopify_order_number: 'NV-MPZNKGNT',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    production_status: 'bottled',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    production_date: '2026-06-07',
    assigned_delivery_date: '2026-06-08',
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: '6a22ffdaf675ea79e30575aa',
    order_number: 'NV-MPZNKGNT',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    status: 'packed',
    delivery_status: 'pending',
    production_status: 'packed',
    delivery_date: '2026-06-08',
    scheduled_date: '2026-06-08',
    assigned_delivery_date: '2026-06-08',
    production_date: '2026-06-07',
    packed_at: '2026-06-08T18:00:10.444Z',
    ...overrides,
  };
}

function batches(count = 6, status = 'verified_logged') {
  return Array.from({ length: count }, (_, index) => ({ id: `pb_${index}`, batch_id: `batch_${index}`, status, production_date: '2026-06-05' }));
}

function complianceLogs(count = 6) {
  return Array.from({ length: count }, (_, index) => ({ id: `bcl_${index}`, batch_id: `batch_${index}`, locked: true }));
}

function policy(overrides = {}) {
  return {
    correctionMode: 'DIRECT_DELIVERED_NO_NOTIFICATION',
    notificationPolicy: 'NO_NOTIFICATION',
    proofDropPolicy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
    actualDeliveredAt: '',
    ...overrides,
  };
}

function hubOrder(overrides = {}) {
  return {
    id: 'hub_1052',
    shopify_order_number: '1052',
    customer_email: 'redacted@example.test',
    source_channel: 'online',
    order_type: 'one_time',
    production_status: 'new',
    fulfillment_status: 'fulfilled',
    assigned_delivery_date: '2026-06-06',
    line_items: [{ title: 'AURA', quantity: 1 }, { title: 'OASIS', quantity: 1 }, { title: 'RE-NU', quantity: 1 }],
    total_price: 166.9,
    ...overrides,
  };
}

const { exports: fns } = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'test-secret' });

assert.equal(fns.commonPolicyBlockers(policy()).length, 0);
assert.ok(fns.statusMappingAudit().fulfillment_task.status_delivered_supported);
assert.equal(fns.statusMappingAudit().fulfillment_task.status_value, 'delivered');
assert.equal(fns.statusMappingAudit().native_shopify_order.fulfillment_status_value, 'fulfilled');

let row = fns.buildNativeDeliveredRow({
  spec: { orderNumber: 'NV-MPZNKGNT' },
  customerOrder: customerOrder(),
  nativeOrder: nativeOrder(),
  task: task(),
  batches: batches(),
  complianceLogs: complianceLogs(),
  policy: policy(),
  mapping: fns.statusMappingAudit(),
});
assert.equal(row.target_type, 'native_delivery_reconciliation');
assert.equal(row.reconciliation_needed, true);
assert.equal(row.delivered_reconciliation_needed, true);
assert.equal(row.actual_delivered_at_required, true);
assert.ok(row.warnings.includes('delivered_timestamp_required_before_live_reconciliation'));
assert.equal(row.notification_would_send, false);
assert.equal(row.proof_drop_impact.proof_drop_required, false);
assert.equal(row.customer_status_impact.customer_status_update_held, true);
assert.equal(row.route_impact.out_for_delivery_transition_proposed, false);
assert.equal(row.next_action, 'approve_exact_direct_delivered_reconciliation_with_timestamp');
assert.equal(row.records_that_would_be_updated.length, 2);
assert.ok(row.records_that_would_be_updated.includes('Native FulfillmentTask'));
assert.ok(row.records_that_would_be_updated.includes('Native ShopifyOrder'));
assert.ok(row.proposed_field_changes.some(change => change.field === 'status' && change.to === 'delivered'));
assert.ok(row.proposed_field_changes.some(change => change.field === 'delivery_status' && change.to === 'delivered'));
assert.ok(row.proposed_field_changes.some(change => change.field === 'fulfillment_status' && change.to === 'fulfilled'));

row = fns.buildNativeDeliveredRow({
  spec: { orderNumber: 'NV-MPZNKGNT' },
  customerOrder: customerOrder(),
  nativeOrder: nativeOrder(),
  task: task(),
  batches: batches(),
  complianceLogs: complianceLogs(),
  policy: policy({ actualDeliveredAt: '2026-06-08T14:30:00.000Z' }),
  mapping: fns.statusMappingAudit(),
});
assert.equal(row.actual_delivered_at_required, false);
assert.equal(row.next_action, 'approve_exact_direct_delivered_reconciliation_no_notification');
assert.ok(row.proposed_field_changes.some(change => change.field === 'delivered_at' && change.to === '2026-06-08T14:30:00.000Z'));

row = fns.buildNativeDeliveredRow({
  spec: { orderNumber: 'NV-MPZNKGNT' },
  customerOrder: customerOrder(),
  nativeOrder: nativeOrder(),
  task: task(),
  batches: batches(),
  complianceLogs: complianceLogs(),
  policy: policy({ notificationPolicy: 'SEND_NOTIFICATION' }),
  mapping: fns.statusMappingAudit(),
});
assert.ok(row.blockers.includes('notification_policy_must_be_no_notification'));

row = fns.buildNativeDeliveredRow({
  spec: { orderNumber: 'NV-MPZNKGNT' },
  customerOrder: customerOrder(),
  nativeOrder: nativeOrder(),
  task: task(),
  batches: batches(),
  complianceLogs: complianceLogs(),
  policy: policy({ proofDropPolicy: 'REQUIRE_PROOF' }),
  mapping: fns.statusMappingAudit(),
});
assert.ok(row.blockers.includes('proof_drop_policy_must_be_held_not_required_for_reconciliation'));

row = fns.buildNativeDeliveredRow({
  spec: { orderNumber: 'NV-MPZNKGNT' },
  customerOrder: customerOrder(),
  nativeOrder: nativeOrder(),
  task: task(),
  batches: batches(),
  complianceLogs: complianceLogs(),
  policy: policy(),
  mapping: { mapping_blockers: ['delivered_status_mapping_required'] },
});
assert.ok(row.blockers.includes('delivered_status_mapping_required'));

let hubRow = fns.buildHistoricalHubBackfillRow({
  spec: { orderNumber: '1052', hubOrderNumber: '1052' },
  hubOrder: hubOrder(),
  hubTasks: [],
  customerOrder: null,
  nativeOrder: null,
  task: null,
  policy: policy({ correctionMode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION' }),
});
assert.equal(hubRow.target_type, 'historical_hub_fulfilled_backfill');
assert.equal(hubRow.hub_order_present, true);
assert.equal(hubRow.native_fulfillment_task_present, false);
assert.equal(hubRow.hub_fulfillment_status, 'fulfilled');
assert.equal(hubRow.operational_reality_classification, 'hub_fulfilled_native_missing');
assert.equal(hubRow.historical_backfill_decision.native_shopify_order_mirror_preview_ready, true);
assert.equal(hubRow.historical_backfill_decision.native_fulfillment_task_backfill_ready, false);
assert.ok(hubRow.records_that_would_be_created.includes('Native ShopifyOrder historical fulfilled mirror'));
assert.ok(hubRow.warnings.includes('native_delivered_command_not_applicable_without_native_task'));
assert.equal(hubRow.notification_would_send, false);
assert.equal(hubRow.proof_drop_impact.proof_drop_required, false);

hubRow = fns.buildHistoricalHubBackfillRow({
  spec: { orderNumber: '1052', hubOrderNumber: '1052' },
  hubOrder: hubOrder({ customer_email: '', line_items: [], assigned_delivery_date: '' }),
  hubTasks: [],
  customerOrder: null,
  nativeOrder: null,
  task: null,
  policy: policy({ correctionMode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION' }),
});
assert.ok(hubRow.blockers.includes('insufficient_hub_data_for_historical_backfill'));
assert.ok(hubRow.blockers.includes('hub_customer_identity_missing'));
assert.ok(hubRow.blockers.includes('hub_line_items_missing'));
assert.ok(hubRow.blockers.includes('hub_delivery_date_missing'));
assert.equal(hubRow.historical_backfill_decision.native_shopify_order_mirror_preview_ready, false);

hubRow = fns.buildHistoricalHubBackfillRow({
  spec: { orderNumber: '1052', hubOrderNumber: '1052' },
  hubOrder: hubOrder(),
  hubTasks: [],
  customerOrder: null,
  nativeOrder: null,
  task: null,
  policy: policy({ correctionMode: 'DIRECT_DELIVERED_NO_NOTIFICATION' }),
});
assert.equal(hubRow.route_impact.native_delivery_task_command_applicable, false);

const response = fns.buildResponse({
  rows: [row, hubRow],
  targetSpecs: [
    { orderNumber: 'NV-MPZNKGNT', correctionMode: 'DIRECT_DELIVERED_NO_NOTIFICATION' },
    { hubOrderNumber: '1052', correctionMode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION' },
  ],
  policy: policy(),
  hubFetchResult: { ok: true, status: 200, orders: [hubOrder()] },
  auth: { actor_type: 'admin' },
});
assert.equal(response.success, true);
assert.equal(response.dry_run, true);
assert.equal(response.writes_performed, false);
assert.equal(response.safety.writes_performed, false);
assert.equal(response.safety.notifications_sent, false);
assert.equal(response.preview_rows.length, 2);

const parsed = fns.targetSpecsFromBody({
  correction_mode: 'DIRECT_DELIVERED_NO_NOTIFICATION',
  notification_policy: 'NO_NOTIFICATION',
  proof_drop_policy: 'HELD_NOT_REQUIRED_FOR_RECONCILIATION',
  targets: [
    { order_number: 'NV-MPZNKGNT', correction_mode: 'DIRECT_DELIVERED_NO_NOTIFICATION' },
    { hub_order_number: '1052', correction_mode: 'HISTORICAL_HUB_FULFILLED_BACKFILL_NO_NOTIFICATION' },
  ],
});
assert.equal(parsed.length, 2);
assert.equal(parsed[0].orderNumber, 'NV-MPZNKGNT');
assert.equal(parsed[1].hubOrderNumber, '1052');

console.log('G32H delivery completion reconciliation preview tests passed');
