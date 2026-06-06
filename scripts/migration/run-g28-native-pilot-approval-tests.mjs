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
    Date,
    Math,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
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

const fns = loadFunctions('base44/functions/previewNativeExactOrderPilotApproval/entry.ts', [
  'getLookup',
  'hasExactLookup',
  'buildApprovalPacket',
  'requirePreviewAccess',
], {
  NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret',
});

const lookup = fns.getLookup({ order_number: '#NV-G28-1001' });
assert.equal(lookup.orderNumber, 'NV-G28-1001');
assert.equal(fns.hasExactLookup(lookup), true);
assert.equal(fns.hasExactLookup(fns.getLookup({ limit: 5 })), false);

const adminAuth = await fns.requirePreviewAccess({
  base44: { auth: { me: async () => ({ role: 'admin', email: 'admin@example.test' }) } },
  req: { headers: { get: name => (name.toLowerCase() === 'authorization' ? 'Bearer short' : '') } },
  body: {},
});
assert.equal(adminAuth.ok, true);
assert.equal(adminAuth.actor_type, 'admin');

const secretAuth = await fns.requirePreviewAccess({
  base44: { auth: { me: async () => { throw new Error('auth.me should not run for valid preview secret'); } } },
  req: { headers: { get: name => (name.toLowerCase() === 'x-internal-secret' ? 'preview-secret' : '') } },
  body: {},
});
assert.equal(secretAuth.ok, true);
assert.equal(secretAuth.actor_type, 'system');

const readinessResult = {
  success: true,
  readiness: {
    classification: 'pilot_ready_with_exact_order_approval',
    blockers: [],
    warnings: ['native_safe_sync_writer_disabled_for_broad_real_orders'],
    next_action: 'approve_one_exact_order_live_pilot_or_continue_monitoring',
    hub_bridge_remains_fallback: true,
  },
  gates: {
    native_safe_sync_writer: {
      enabled: false,
      kill_switch: true,
      broad_real_order_mode: false,
      order_allowlist_count: 1,
      actor_allowlist_count: 1,
    },
    native_fulfillment_task_materialization: {
      broad_real_order_mode: false,
    },
    may30_native_order_ops: {
      enabled: true,
      hub_bridge_fallback_expected: true,
    },
  },
  targets: [{
    order_number: 'NV-G28-1001',
    customer_app_order_id: 'order_001',
    native_shopify_order_id: 'native_001',
    classification: 'pilot_ready_native_update_or_dedupe_dry_run',
    blockers: [],
    warnings: ['native_task_display_metadata_incomplete'],
    native_order_present: true,
    payment_status: 'paid',
    payment_captured: true,
    address_complete: true,
    fulfillment_method: 'delivery',
    native_sync_status: 'native_may30_ready',
    native_task_count: 1,
    native_task_display_metadata_complete_count: 0,
    planner_summary: {
      success: true,
      action: 'updated',
      would_create_order: false,
      would_update_order: true,
      would_reject: false,
      would_quarantine: false,
      accepted_fields: ['base44_order_id', 'line_items', 'payment_status'],
      rejected_fields: ['customer_email'],
      proposed_line_item_count: 4,
    },
  }],
};

const packet = fns.buildApprovalPacket({ readinessResult, lookup, actor: adminAuth });
assert.equal(packet.approval_packet_ready, true);
assert.equal(packet.approved_for_live_execution, false);
assert.equal(packet.live_execution_not_run, true);
assert.equal(packet.exact_order_approval_phrase, 'APPROVE G28 EXACT ORDER PILOT NV-G28-1001');
assert.equal(packet.writer_dry_run_equivalent.would_update_order, true);
assert.equal(packet.live_execution_contract.function_name, 'executeNativeSafeSyncOrderUpdate');
assert.equal(packet.live_execution_contract.broad_real_order_mode_allowed, false);
assert.ok(packet.warnings.includes('native_safe_sync_writer_currently_disabled'));
assert.ok(packet.warnings.includes('native_safe_sync_writer_kill_switch_currently_on'));

const broadModePacket = fns.buildApprovalPacket({
  readinessResult: {
    ...readinessResult,
    gates: {
      ...readinessResult.gates,
      native_safe_sync_writer: {
        ...readinessResult.gates.native_safe_sync_writer,
        enabled: true,
        kill_switch: false,
        broad_real_order_mode: true,
      },
    },
  },
  lookup,
  actor: adminAuth,
});
assert.equal(broadModePacket.approval_packet_ready, false);
assert.ok(broadModePacket.blockers.includes('native_safe_sync_writer_broad_mode_enabled_unexpectedly'));

const notReadyPacket = fns.buildApprovalPacket({
  readinessResult: {
    ...readinessResult,
    readiness: { ...readinessResult.readiness, classification: 'hold_before_live_pilot', blockers: ['one_or_more_targets_blocked'] },
  },
  lookup,
  actor: adminAuth,
});
assert.equal(notReadyPacket.approval_packet_ready, false);
assert.ok(notReadyPacket.blockers.includes('cutover_not_pilot_ready'));

console.log('G28 native pilot approval packet tests passed.');
