#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function loadFunctions(relativePath, exportNames, env = {}) {
  const filePath = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  const serveIndex = source.indexOf('Deno.serve');
  if (serveIndex >= 0) source = source.slice(0, serveIndex);
  source += `\nglobalThis.__exports = { ${exportNames.join(', ')} };\n`;

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
    Deno: {
      env: {
        get: key => env[key] || '',
      },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const fns = loadFunctions('base44/functions/previewNativeOrderCutoverReadiness/entry.ts', [
  'getLookup',
  'taskHasDisplayMetadata',
  'summarizeTarget',
  'aggregateReadiness',
  'gateSummary',
  'buildHubRetirementReadiness',
  'requirePreviewAccess',
], {
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret',
  ENABLE_NATIVE_SAFE_SYNC_WRITER: 'false',
  NATIVE_SAFE_SYNC_WRITER_KILL_SWITCH: 'true',
  NATIVE_SAFE_SYNC_WRITER_ORDER_ALLOWLIST: 'G27-1001',
  NATIVE_SAFE_SYNC_WRITER_ACTOR_EMAIL_ALLOWLIST: 'owner@example.test',
  NATIVE_SAFE_SYNC_WRITER_ALLOWED_SOURCES: 'customer_app,customer_app_one_time',
  NATIVE_SAFE_SYNC_WRITER_ALLOWED_EVENTS: 'order.created,paid_order',
  ENABLE_NATIVE_ORDER_OPS: 'true',
  NATIVE_ORDER_OPS_SECRET: 'configured',
  ENABLE_NATIVE_FULFILLMENT_TASK_MATERIALIZATION_WRITES: 'false',
  NATIVE_FULFILLMENT_TASK_MATERIALIZATION_KILL_SWITCH: 'true',
  NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ORDER_ALLOWLIST: 'G27-1001',
  NATIVE_FULFILLMENT_TASK_MATERIALIZATION_ALLOWED_EMAILS: 'owner@example.test',
  ENABLE_NATIVE_FULFILLMENT_TASK_LIFECYCLE_WRITES: 'false',
  NATIVE_FULFILLMENT_TASK_LIFECYCLE_KILL_SWITCH: 'true',
  NATIVE_FULFILLMENT_TASK_LIFECYCLE_TASK_ALLOWLIST: 'native_task_001',
  NATIVE_FULFILLMENT_TASK_LIFECYCLE_ALLOWED_EMAILS: 'owner@example.test',
  NATIVE_FULFILLMENT_TASK_LIFECYCLE_ALLOWED_ACTIONS: 'pack,out_for_delivery,delivered_operational',
  ENABLE_NATIVE_PRODUCTION_BATCH_LIFECYCLE_WRITES: 'false',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_KILL_SWITCH: 'true',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_BATCH_ALLOWLIST: 'batch_001',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_EMAILS: 'owner@example.test',
  NATIVE_PRODUCTION_BATCH_LIFECYCLE_ALLOWED_ACTIONS: 'start,complete,verify',
  ENABLE_NATIVE_ORDER_SCHEDULE_CORRECTION_WRITES: 'false',
  NATIVE_ORDER_SCHEDULE_CORRECTION_KILL_SWITCH: 'true',
  NATIVE_ORDER_SCHEDULE_CORRECTION_ORDER_ALLOWLIST: 'G27-1001',
  NATIVE_ORDER_SCHEDULE_CORRECTION_ALLOWED_EMAILS: 'owner@example.test',
  ENABLE_NATIVE_SAFE_SYNC_DARK_LAUNCH: 'false',
  NATIVE_SAFE_SYNC_DARK_LAUNCH_KILL_SWITCH: 'true',
  ENABLE_NATIVE_SAFE_SYNC_PARITY_LOG: 'false',
});

const lookup = fns.getLookup({
  order_number: '#G27-1001',
  native_shopify_order_id: 'native_order_001',
});
assert.equal(lookup.orderNumber, 'G27-1001');
assert.equal(lookup.nativeOrderId, 'native_order_001');

const adminBearerAuth = await fns.requirePreviewAccess({
  base44: {
    auth: {
      me: async () => ({ role: 'admin', email: 'admin@example.test' }),
    },
  },
  req: {
    headers: {
      get: name => (name.toLowerCase() === 'authorization' ? 'Bearer short' : ''),
    },
  },
  body: {},
});
assert.equal(adminBearerAuth.ok, true);
assert.equal(adminBearerAuth.actor_type, 'admin');

const internalSecretAuth = await fns.requirePreviewAccess({
  base44: {
    auth: {
      me: async () => { throw new Error('auth.me should not run for valid internal secret'); },
    },
  },
  req: {
    headers: {
      get: name => (name.toLowerCase() === 'x-internal-secret' ? 'preview-secret' : ''),
    },
  },
  body: {},
});
assert.equal(internalSecretAuth.ok, true);
assert.equal(internalSecretAuth.actor_type, 'system');


const parityFns = loadFunctions('base44/functions/previewNativeSafeSyncLiveOrderParity/entry.ts', [
  'requirePreviewAccess',
], {
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret',
});

const parityAdminBearerAuth = await parityFns.requirePreviewAccess({
  base44: {
    auth: {
      me: async () => ({ role: 'admin', email: 'admin@example.test' }),
    },
  },
  req: {
    headers: {
      get: name => (name.toLowerCase() === 'authorization' ? 'Bearer short' : ''),
    },
  },
  body: {},
});
assert.equal(parityAdminBearerAuth.ok, true);
assert.equal(parityAdminBearerAuth.actor_type, 'admin');

const parityBodySecretWithBearerAuth = await parityFns.requirePreviewAccess({
  base44: {
    auth: {
      me: async () => { throw new Error('auth.me should not run for valid internal preview body secret'); },
    },
  },
  req: {
    headers: {
      get: name => (name.toLowerCase() === 'authorization' ? 'Bearer short' : ''),
    },
  },
  body: { _internal_secret: 'preview-secret' },
});
assert.equal(parityBodySecretWithBearerAuth.ok, true);
assert.equal(parityBodySecretWithBearerAuth.actor_type, 'system');

assert.equal(fns.taskHasDisplayMetadata({
  order_number: 'G27-1001',
  source_type: 'customer_app_one_time',
  schedule_source: 'native_customer_app_paid_order_mirror',
  production_date: '2026-06-12',
}), true);
assert.equal(fns.taskHasDisplayMetadata({
  order_number: 'G27-1001',
  status: 'pending',
  delivery_date: '2026-06-13',
}), false);

const paidDeliveryOrder = {
  id: 'base44_order_001',
  order_number: 'G27-1001',
  status: 'scheduled_for_juicing',
  payment_status: 'paid',
  payment_captured: true,
  fulfillment_method: 'delivery',
  address_line1: '123 Test St',
  address_city: 'Austin',
  address_state: 'TX',
  address_postal_code: '78701',
  line_items: [
    { title: 'Green Juice', quantity: 1 },
    { title: 'Orange Juice', quantity: 2 },
  ],
};

const nativeOrder = {
  id: 'native_shopify_order_001',
  shopify_order_number: 'G27-1001',
  sync_status: 'native_ops_ready',
  source_type: 'customer_app_one_time',
  order_type: 'one_time',
};

const incompleteTask = {
  id: 'native_task_001',
  order_id: nativeOrder.id,
  status: 'pending',
  delivery_date: '2026-06-13',
};

const existingNativeSummary = fns.summarizeTarget({
  customerOrder: paidDeliveryOrder,
  nativeOrder,
  tasks: [incompleteTask],
  preview: {
    parity_status: 'pass',
    planner_summary: { action: 'skipped' },
    readiness: { blockers: [], warnings: [] },
  },
  lookup,
});

assert.equal(existingNativeSummary.customer_app_order_id, 'base44_order_001');
assert.equal(existingNativeSummary.native_order_present, true);
assert.equal(existingNativeSummary.native_task_count, 1);
assert.equal(existingNativeSummary.native_task_display_metadata_complete_count, 0);
assert.equal(existingNativeSummary.classification, 'pilot_ready_native_update_or_dedupe_dry_run');
assert.equal(JSON.stringify(existingNativeSummary.warnings), JSON.stringify(['native_task_display_metadata_incomplete']));

const createNativeSummary = fns.summarizeTarget({
  customerOrder: { ...paidDeliveryOrder, id: 'base44_order_002', order_number: 'G27-1002' },
  nativeOrder: null,
  tasks: [],
  preview: {
    parity_status: 'pass',
    planner_summary: { would_create_order: true },
    readiness: { blockers: [], warnings: [] },
  },
  lookup: { orderNumber: 'G27-1002' },
});

assert.equal(createNativeSummary.classification, 'pilot_ready_native_create_dry_run');
assert.equal(JSON.stringify(createNativeSummary.blockers), JSON.stringify([]));

const blockedSummary = fns.summarizeTarget({
  customerOrder: { ...paidDeliveryOrder, id: 'base44_order_003', order_number: 'G27-1003', payment_status: 'pending', payment_captured: false },
  nativeOrder: null,
  tasks: [],
  preview: { readiness: { blockers: [], warnings: [] } },
  lookup: { orderNumber: 'G27-1003' },
});
assert.equal(blockedSummary.classification, 'blocked');
assert.equal(JSON.stringify(blockedSummary.blockers), JSON.stringify(['payment_not_paid']));

const gates = fns.gateSummary();
assert.equal(gates.native_safe_sync_writer.enabled, false);
assert.equal(gates.native_safe_sync_writer.broad_real_order_mode, false);
assert.equal(gates.native_safe_sync_writer.order_allowlist_count, 1);
assert.equal(gates.native_order_ops.enabled, true);
assert.equal(gates.native_fulfillment_task_materialization.enabled, false);
assert.equal(gates.native_fulfillment_task_materialization.order_allowlist_count, 1);
assert.equal(gates.native_fulfillment_task_lifecycle.enabled, false);
assert.equal(gates.native_fulfillment_task_lifecycle.broad_real_task_mode, false);
assert.equal(gates.native_fulfillment_task_lifecycle.action_allowlist_count, 3);
assert.equal(gates.native_production_batch_lifecycle.enabled, false);
assert.equal(gates.native_production_batch_lifecycle.broad_real_batch_mode, false);
assert.equal(gates.native_order_schedule_correction.enabled, false);
assert.equal(gates.native_order_schedule_correction.broad_real_order_mode, false);

const readiness = fns.aggregateReadiness([createNativeSummary, existingNativeSummary], gates);
assert.equal(readiness.classification, 'pilot_ready_with_exact_order_approval');
assert.equal(readiness.target_count, 2);
assert.equal(readiness.pilot_ready_target_count, 2);
assert.equal(readiness.hub_bridge_remains_fallback, true);
assert.equal(readiness.live_pilot_requires_exact_order_approval, true);
assert.equal(JSON.stringify(readiness.blockers), JSON.stringify([]));
assert.ok(readiness.warnings.includes('native_safe_sync_writer_disabled_for_broad_real_orders'));
assert.ok(readiness.warnings.includes('native_task_materialization_writes_disabled'));

const hubRetirement = fns.buildHubRetirementReadiness(gates);
assert.equal(hubRetirement.status, 'not_ready_to_retire_hub');
assert.equal(hubRetirement.hub_bridge_fallback_required, true);
assert.equal(hubRetirement.hub_retirement_approved, false);
assert.equal(hubRetirement.live_writes_required_for_this_check, false);
assert.ok(hubRetirement.blockers.includes('native_order_writer_not_approved_for_broad_real_orders'));
assert.ok(hubRetirement.blockers.includes('inventory_procurement_native_ownership_not_validated'));
assert.ok(hubRetirement.blockers.includes('delivery_route_proof_native_ownership_not_validated'));
assert.ok(hubRetirement.blockers.includes('notification_behavior_native_ownership_not_validated'));
assert.ok(hubRetirement.blockers.includes('refund_payment_reversal_native_ownership_not_validated'));
assert.ok(hubRetirement.blockers.includes('hub_retirement_reconciliation_reporting_not_finalized'));
assert.ok(hubRetirement.blockers.includes('hub_bridge_retirement_not_approved'));
assert.equal(hubRetirement.subsystems.length, 12);
assert.equal(hubRetirement.subsystems.find(item => item.key === 'hub_bridge_fallback')?.status, 'required_fallback_active');
assert.equal(hubRetirement.subsystems.find(item => item.key === 'native_fulfillment_task_lifecycle')?.status, 'disabled_or_not_configured');

const holdReadiness = fns.aggregateReadiness([blockedSummary], {
  ...gates,
  native_safe_sync_writer: { ...gates.native_safe_sync_writer, enabled: true, broad_real_order_mode: true },
});
assert.equal(holdReadiness.classification, 'hold_before_live_pilot');
assert.ok(holdReadiness.blockers.includes('one_or_more_targets_blocked'));
assert.ok(holdReadiness.blockers.includes('native_safe_sync_writer_broad_mode_enabled_unexpectedly'));

console.log('G27 native cutover readiness tests passed.');
