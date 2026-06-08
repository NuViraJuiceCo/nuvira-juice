#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const TARGET = {
  order_number: 'NV-MPZNKGNT',
  customer_app_order_id: '6a219a3f4adcda5856c3d579',
  native_shopify_order_id: '6a22ffda400eb806eb3ca945',
  native_fulfillment_task_id: '6a22ffdaf675ea79e30575aa',
};

const BATCH_IDS = [
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT',
];

function loadPreviewHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/previewNativeDeliveryWorkflowReadiness/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace(/^export \{[\s\S]*?\};\s*$/m, '');
  source += `\nglobalThis.__exports = { buildPreview, buildOutForDeliveryPreview, buildDeliveredPreview, reconcileNativeAndHubRows, safeNativeDeliveryRow, safeHubRow, getLookup, READ_ONLY_SAFETY };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    createClientFromRequest: req => req.__base44,
    fetch: async () => ({ ok: true, json: async () => ({ success: true, sections: { delivery_stops: [], completed: [], unscheduled_delivery_orders: [] } }) }),
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler };
}

function loadRouteSummaryHarness() {
  const filePath = path.join(repoRoot, 'base44/functions/getAdminDeliveryRouteSummary/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { sanitizeStop, reconcileHubRowsWithNativeSchedule, summarizeStops };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response, Intl,
    createClientFromRequest: req => req.__base44,
    fetch: async () => ({ ok: true, json: async () => ({ success: true, sections: { delivery_stops: [], completed: [] } }) }),
    Deno: { env: { get: () => '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

function makeCustomerOrder(overrides = {}) {
  return {
    id: TARGET.customer_app_order_id,
    order_number: TARGET.order_number,
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    payment_captured: true,
    estimated_delivery_date: '2026-06-08',
    assigned_delivery_date: '2026-06-08',
    production_date: '2026-06-07',
    assigned_production_day: '2026-06-07',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    status_history: [{ status: 'order_received' }, { status: 'scheduled_for_juicing' }],
    ...(overrides || {}),
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: TARGET.native_shopify_order_id,
    base44_order_id: TARGET.customer_app_order_id,
    shopify_order_number: TARGET.order_number,
    production_status: 'bottled',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    financial_status: 'paid',
    production_date: '2026-06-07',
    assigned_delivery_date: '2026-06-08',
    selected_delivery_date: '2026-06-08',
    fulfillment_mode: 'single_delivery',
    order_type: 'one_time',
    ...(overrides || {}),
  };
}

function makeTask(overrides = {}) {
  return {
    id: TARGET.native_fulfillment_task_id,
    order_number: TARGET.order_number,
    base44_order_id: TARGET.customer_app_order_id,
    native_shopify_order_id: TARGET.native_shopify_order_id,
    status: 'packed',
    delivery_status: 'pending',
    production_status: 'packed',
    production_date: '2026-06-07',
    delivery_date: '2026-06-08',
    scheduled_date: '2026-06-08',
    assigned_delivery_date: '2026-06-08',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    time_window: 'Saturday 12 PM - 3 PM',
    packed_at: '2026-06-08T18:00:10.444Z',
    ...(overrides || {}),
  };
}

function makeBatches(overrides = {}) {
  return BATCH_IDS.map((batchId, index) => ({
    id: `pb_${index}`,
    batch_id: batchId,
    order_sources: [{ order_number: TARGET.order_number, order_id: TARGET.customer_app_order_id }],
    related_orders: [TARGET.native_shopify_order_id],
    production_date: '2026-06-05',
    status: 'verified_logged',
    compliance_log_id: `bcl_${index}`,
    ...(overrides[batchId] || {}),
  }));
}

function makeComplianceLogs(batches = makeBatches()) {
  return batches.map((batch, index) => ({
    id: `bcl_${index}`,
    batch_id: batch.batch_id,
    source_production_batch_id: batch.id,
    date: '2026-06-05',
    locked: true,
  }));
}

function hubRow(overrides = {}) {
  return {
    task_id: 'hub_task_2026_06_06',
    order_number: TARGET.order_number,
    task_status: 'Scheduled',
    delivery_status: null,
    fulfillment_status: null,
    delivery_date: '2026-06-06',
    delivery_window_label: 'Saturday 12 PM - 3 PM',
    data_source: 'hub',
    ...(overrides || {}),
  };
}

function context(overrides = {}) {
  const batches = overrides.batches || makeBatches(overrides.batchOverrides || {});
  return {
    customerOrder: overrides.customerOrder ?? makeCustomerOrder(),
    nativeOrder: overrides.nativeOrder ?? makeNativeOrder(),
    task: overrides.task ?? makeTask(),
    batches,
    complianceLogs: overrides.complianceLogs ?? makeComplianceLogs(batches),
    hubRowsByDate: overrides.hubRowsByDate ?? {
      '2026-06-06': { rows: [hubRow()] },
      '2026-06-08': { rows: [] },
    },
    lookup: {
      orderNumber: TARGET.order_number,
      customerAppOrderId: TARGET.customer_app_order_id,
      nativeShopifyOrderId: TARGET.native_shopify_order_id,
      nativeFulfillmentTaskId: TARGET.native_fulfillment_task_id,
      deliveryDate: '2026-06-08',
      productionDate: '2026-06-07',
      requestId: 'g32f_test',
    },
    auth: { actor_type: 'admin', actor_role: 'admin' },
  };
}

const { exports: fns } = loadPreviewHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
let preview = fns.buildPreview(context());
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.native_task_present, true);
assert.equal(preview.native_delivery_row.delivery_date, '2026-06-08');
assert.equal(preview.production_batch_count, 6);
assert.equal(preview.verified_batch_count, 6);
assert.equal(preview.compliance_log_count, 6);
assert.equal(preview.stale_hub_fallback_detected, true);
assert.equal(preview.route_summary_merge_status, 'native_schedule_active_hub_fallback_stale_date_detected');
assert.equal(preview.stale_hub_fallback_rows.length, 1);
assert.equal(preview.stale_hub_fallback_rows[0].delivery_date, '2026-06-06');
assert.equal(preview.out_for_delivery_ready, true);
assert.equal(preview.out_for_delivery_held, true);
assert.equal(preview.out_for_delivery_preview.would_send_notification, false);
assert.equal(preview.out_for_delivery_preview.stale_hub_fallback_blocks, false);
assert.equal(preview.delivered_ready, false);
assert.equal(preview.delivered_held, true);
assert.ok(preview.delivered_preview.blockers.includes('proof_drop_policy_not_defined'));
assert.equal(preview.customer_status_impact_preview.customer_facing_status_changes_held, true);
assert.equal(preview.notification_impact_preview.would_send_notification, false);
assert.equal(preview.notification_impact_preview.notification_held, true);
assert.equal(preview.safety.writes_performed, false);
assert.equal(preview.safety.hub_records_updated, false);
assert.equal(preview.next_action, 'plan_gated_native_out_for_delivery_command');

preview = fns.buildPreview(context({ hubRowsByDate: { '2026-06-08': { rows: [hubRow({ delivery_date: '2026-06-08' })] } } }));
assert.equal(preview.stale_hub_fallback_detected, false);
assert.equal(preview.route_summary_merge_status, 'native_schedule_preferred_hub_duplicate_detected');
assert.equal(preview.out_for_delivery_ready, true);

preview = fns.buildPreview(context({ task: makeTask({ status: 'pending' }) }));
assert.equal(preview.out_for_delivery_ready, false);
assert.ok(preview.out_for_delivery_preview.blockers.includes('native_fulfillment_task_not_packed'));
assert.equal(preview.safety.writes_performed, false);

preview = fns.buildPreview(context({ complianceLogs: [] }));
assert.equal(preview.out_for_delivery_ready, false);
assert.ok(preview.out_for_delivery_preview.blockers.includes('batch_compliance_logs_missing'));

preview = fns.buildPreview(context({ nativeOrder: makeNativeOrder({ production_status: 'awaiting_production' }) }));
assert.equal(preview.out_for_delivery_ready, false);
assert.ok(preview.out_for_delivery_preview.blockers.includes('native_shopify_order_not_bottled'));

const nativeRow = fns.safeNativeDeliveryRow({ task: makeTask(), customerOrder: makeCustomerOrder(), nativeOrder: makeNativeOrder() });
const reconciliation = fns.reconcileNativeAndHubRows({ nativeRow, hubRows: [fns.safeHubRow(hubRow())], deliveryDate: '2026-06-08' });
assert.equal(reconciliation.stale_hub_fallback_detected, true);
assert.equal(reconciliation.stale_hub_fallback_rows.length, 1);
assert.ok(reconciliation.warnings.includes('hub_fallback_stale_date_detected'));

const routeFns = loadRouteSummaryHarness();
const routeReconciliation = routeFns.reconcileHubRowsWithNativeSchedule({
  hubRows: [routeFns.sanitizeStop(hubRow())],
  nativeScheduleIndex: [routeFns.sanitizeStop({ task_id: TARGET.native_fulfillment_task_id, order_number: TARGET.order_number, delivery_date: '2026-06-08', data_source: 'customer_app_native_task' })],
  deliveryDate: '2026-06-06',
  section: 'delivery_stops',
});
assert.equal(routeReconciliation.rows.length, 0);
assert.equal(routeReconciliation.suppressed.length, 1);
assert.equal(routeReconciliation.suppressed[0].merge_status, 'native_schedule_active_hub_fallback_stale_date');

const duplicateRouteReconciliation = routeFns.reconcileHubRowsWithNativeSchedule({
  hubRows: [routeFns.sanitizeStop(hubRow({ delivery_date: '2026-06-08' }))],
  nativeScheduleIndex: [routeFns.sanitizeStop({ task_id: TARGET.native_fulfillment_task_id, order_number: TARGET.order_number, delivery_date: '2026-06-08', data_source: 'customer_app_native_task' })],
  deliveryDate: '2026-06-08',
  section: 'delivery_stops',
});
assert.equal(duplicateRouteReconciliation.rows.length, 0);
assert.equal(duplicateRouteReconciliation.suppressed.length, 1);
assert.equal(duplicateRouteReconciliation.suppressed[0].merge_status, 'native_schedule_preferred_hub_duplicate');

console.log('G32F native delivery workflow readiness preview tests passed');
