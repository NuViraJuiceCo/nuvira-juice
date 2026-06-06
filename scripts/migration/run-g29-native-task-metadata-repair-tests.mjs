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
    Deno: { env: { get: key => env[key] || '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const previewFns = loadFunctions('base44/functions/previewNativeFulfillmentTaskMetadataRepair/entry.ts', [
  'getLookup',
  'hasExactLookup',
  'taskMissingDisplayFields',
  'taskDisplayMetadataComplete',
  'buildMetadataRepairPlan',
  'summarizePatch',
  'requirePreviewAccess',
], {
  NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_PREVIEW_SECRET: 'preview-secret',
});

const executeFns = loadFunctions('base44/functions/executeNativeFulfillmentTaskMetadataRepair/entry.ts', [
  'gateSummary',
  'envGateFailure',
  'allowlistIdentifiers',
  'buildMetadataRepairPlan',
], {
  ENABLE_NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_WRITES: 'true',
  NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_KILL_SWITCH: 'false',
  NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_ORDER_ALLOWLIST: 'NV-G29-1001,native_001,task_001,order_001',
  NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_ALLOWED_EMAILS: 'admin@example.test',
});

const lookup = previewFns.getLookup({ order_number: '#NV-G29-1001' });
assert.equal(lookup.orderNumber, 'NV-G29-1001');
assert.equal(previewFns.hasExactLookup(lookup), true);
assert.equal(previewFns.hasExactLookup(previewFns.getLookup({})), false);

const adminAuth = await previewFns.requirePreviewAccess({
  base44: { auth: { me: async () => ({ role: 'admin', email: 'admin@example.test' }) } },
  req: { headers: { get: () => '' } },
  body: {},
});
assert.equal(adminAuth.ok, true);
assert.equal(adminAuth.actor_type, 'admin');

const secretAuth = await previewFns.requirePreviewAccess({
  base44: { auth: { me: async () => { throw new Error('auth.me should not run for preview secret'); } } },
  req: { headers: { get: name => (name.toLowerCase() === 'x-internal-secret' ? 'preview-secret' : '') } },
  body: {},
});
assert.equal(secretAuth.ok, true);
assert.equal(secretAuth.actor_type, 'system');

const nativeOrder = {
  id: 'native_001',
  base44_order_id: 'order_001',
  shopify_order_number: 'NV-G29-1001',
  customer_name: 'Repair Owner',
  customer_email: 'owner@example.test',
  customer_phone: '555-0100',
  source_channel: 'online',
  source_type: 'customer_app_one_time',
  order_type: 'one_time',
  fulfillment_method: 'delivery',
  payment_status: 'paid',
  production_status: 'awaiting_production',
  assigned_delivery_date: '2026-06-13',
  production_date: '2026-06-12',
  delivery_window_label: 'Saturday 12 PM - 3 PM',
  address_line1: '123 Test St',
  address_city: 'Austin',
  address_state: 'TX',
  address_postal_code: '78701',
  delivery_zone_key: 'central',
  total_price: 42,
  line_items: [
    { shopify_line_item_id: 'li_1', title: 'Green Juice', quantity: 1, price: 12 },
    { shopify_line_item_id: 'li_2', title: 'Orange Juice', quantity: 2, price: 15 },
  ],
};
const customerOrder = {
  id: 'order_001',
  order_number: 'NV-G29-1001',
  production_date: '2026-06-12',
  assigned_delivery_date: '2026-06-13',
};
const incompleteTask = {
  id: 'task_001',
  order_id: 'native_001',
  status: 'pending',
  delivery_date: '2026-06-13',
  production_date: null,
  shopify_order_number: null,
  source_type: null,
  schedule_source: null,
  base44_order_id: null,
};

assert.deepEqual(Array.from(previewFns.taskMissingDisplayFields(incompleteTask)), [
  'base44_order_id',
  'shopify_order_id',
  'native_shopify_order_id',
  'shopify_order_number',
  'order_number',
  'source_type',
  'schedule_source',
  'production_date',
]);
assert.equal(previewFns.taskDisplayMetadataComplete(incompleteTask), false);

const plan = previewFns.buildMetadataRepairPlan({ task: incompleteTask, nativeOrder, customerOrder });
assert.equal(plan.ready, true);
assert.equal(plan.action, 'repair_existing_task_metadata');
assert.ok(plan.patch_fields.includes('base44_order_id'));
assert.ok(plan.patch_fields.includes('shopify_order_number'));
assert.ok(plan.patch_fields.includes('source_type'));
assert.ok(plan.patch_fields.includes('schedule_source'));
assert.ok(plan.patch_fields.includes('production_date'));
assert.equal(plan.patch.base44_order_id, 'order_001');
assert.equal(plan.patch.shopify_order_number, 'NV-G29-1001');
assert.equal(plan.patch.source_type, 'customer_app_one_time');
assert.equal(plan.patch.schedule_source, 'native_customer_app_paid_order_mirror');
assert.equal(plan.patch.production_date, '2026-06-12');
assert.equal(plan.patch.line_item_count, 2);
assert.equal(plan.patch.total_price, 42);
assert.equal(plan.patch.address_complete, true);
assert.deepEqual(Array.from(plan.missing_display_fields_after), []);

const summarizedPatch = previewFns.summarizePatch(plan.patch);
assert.equal(summarizedPatch.customer_email, '[redacted email]');
assert.equal(summarizedPatch.items.item_count, 2);

const completeTask = { ...incompleteTask, ...plan.patch };
const noop = previewFns.buildMetadataRepairPlan({ task: completeTask, nativeOrder, customerOrder });
assert.equal(noop.ready, true);
assert.equal(noop.patch_fields.length, 0);
assert.ok(noop.warnings.includes('no_missing_metadata_fields_to_repair'));
assert.equal(previewFns.taskDisplayMetadataComplete(completeTask), true);

const conflict = previewFns.buildMetadataRepairPlan({
  task: { ...incompleteTask, order_id: 'other_native' },
  nativeOrder,
  customerOrder,
});
assert.equal(conflict.ready, false);
assert.ok(conflict.blockers.includes('task_order_link_conflict'));

const subscriptionPlan = previewFns.buildMetadataRepairPlan({
  task: incompleteTask,
  nativeOrder: { ...nativeOrder, order_type: 'subscription' },
  customerOrder,
});
assert.equal(subscriptionPlan.ready, false);
assert.ok(subscriptionPlan.blockers.includes('subscription_order_not_supported'));

const gate = executeFns.gateSummary();
assert.equal(gate.enabled, true);
assert.equal(gate.kill_switch, false);
assert.equal(gate.broad_real_order_mode, false);
assert.equal(gate.order_allowlist_count, 4);
assert.equal(gate.actor_allowlist_count, 1);

const identifiers = executeFns.allowlistIdentifiers({
  lookup,
  task: incompleteTask,
  nativeOrder,
  customerOrder,
});
assert.ok(identifiers.includes('nv-g29-1001'));
assert.ok(identifiers.includes('native_001'));
assert.ok(identifiers.includes('task_001'));
assert.ok(identifiers.includes('order_001'));

assert.equal(executeFns.envGateFailure({
  actorEmail: 'admin@example.test',
  lookup,
  task: incompleteTask,
  nativeOrder,
  customerOrder,
}), null);
assert.equal(executeFns.envGateFailure({
  actorEmail: 'other@example.test',
  lookup,
  task: incompleteTask,
  nativeOrder,
  customerOrder,
}), 'actor_email_not_allowlisted');

const disabledFns = loadFunctions('base44/functions/executeNativeFulfillmentTaskMetadataRepair/entry.ts', [
  'gateSummary',
  'envGateFailure',
], {
  ENABLE_NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_WRITES: 'false',
  NATIVE_FULFILLMENT_TASK_METADATA_REPAIR_KILL_SWITCH: 'true',
});
assert.equal(disabledFns.gateSummary().enabled, false);
assert.equal(disabledFns.envGateFailure({ actorEmail: 'admin@example.test', lookup, task: incompleteTask, nativeOrder, customerOrder }), 'kill_switch_active');

console.log('G29 native FulfillmentTask metadata repair tests passed.');
