#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

const BATCH_IDS = [
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT',
];
const PRODUCTS = {
  'NATIVE-NV-MPZNKGNT-2026-06-05-AURA': 'Aura',
  'NATIVE-NV-MPZNKGNT-2026-06-05-OASIS': 'Oasis',
  'NATIVE-NV-MPZNKGNT-2026-06-05-PINEAPPLE-JUICE': 'Pineapple Juice',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RADIANCE-SHOT': 'Radiance Shot',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RE-NU': 'Re-Nu',
  'NATIVE-NV-MPZNKGNT-2026-06-05-RESET-SHOT': 'Reset Shot',
};

function loadHarness(env = {}) {
  const filePath = path.join(repoRoot, 'base44/functions/previewNativeCustomerStatusNotificationImpact/entry.ts');
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source += `\nglobalThis.__exports = { buildPreview, buildCustomerStatusPreview, buildNotificationPreview, mapNativeProductionStatusToCustomerStatus, getLookup, requirePreviewAccess };\n`;
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object, Set, Map, RegExp, JSON, Error, Response,
    createClientFromRequest: req => req.__base44,
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return { exports: context.globalThis.__exports, handler: context.globalThis.__handler };
}

function makeCustomerOrder(overrides = {}) {
  return {
    id: '6a219a3f4adcda5856c3d579',
    order_number: 'NV-MPZNKGNT',
    status: 'scheduled_for_juicing',
    payment_status: 'paid',
    payment_captured: true,
    order_type: 'one_time',
    fulfillment_type: 'delivery',
    status_history: [
      { status: 'order_received', timestamp: '2026-06-05T16:00:00.000Z', message: 'Order received.' },
      { status: 'scheduled_for_juicing', timestamp: '2026-06-05T16:05:00.000Z', message: 'Payment confirmed.' },
    ],
    ...(overrides || {}),
  };
}

function makeNativeOrder(overrides = {}) {
  return {
    id: '6a22ffda400eb806eb3ca945',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    shopify_order_number: 'NV-MPZNKGNT',
    production_status: 'bottled',
    fulfillment_status: 'pending',
    payment_status: 'paid',
    financial_status: 'paid',
    is_subscription: false,
    order_type: 'one_time',
    fulfillment_mode: 'single_delivery',
    ...(overrides || {}),
  };
}

function makeTask(overrides = {}) {
  return {
    id: '6a22ffdaf675ea79e30575aa',
    base44_order_id: '6a219a3f4adcda5856c3d579',
    native_shopify_order_id: '6a22ffda400eb806eb3ca945',
    shopify_order_id: '6a22ffda400eb806eb3ca945',
    order_number: 'NV-MPZNKGNT',
    status: 'packed',
    delivery_status: 'pending',
    production_status: 'packed',
    packed_at: '2026-06-08T18:00:10.444Z',
    production_date: '2026-06-05',
    delivery_date: '2026-06-06',
    assigned_delivery_date: '2026-06-06',
    fulfillment_type: 'delivery',
    order_type: 'one_time',
    ...(overrides || {}),
  };
}

function makeBatch(batchId, overrides = {}) {
  return {
    id: `pb_${batchId.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
    batch_id: batchId,
    product_name: PRODUCTS[batchId],
    status: 'verified_logged',
    production_date: '2026-06-05',
    planned_units: 1,
    actual_units: 1,
    actual_start_time: '2026-06-08T03:37:37.073Z',
    actual_end_time: '2026-06-08T04:49:01.083Z',
    verified_at: '2026-06-08T16:03:53.429Z',
    verified_by: 'owner@example.test',
    compliance_log_id: `bcl_${batchId}`,
    order_sources: [{ order_id: '6a219a3f4adcda5856c3d579', order_number: 'NV-MPZNKGNT', quantity: 1 }],
    related_orders: ['6a22ffda400eb806eb3ca945'],
    ...(overrides || {}),
  };
}

function makeBatches(overridesById = {}) {
  return BATCH_IDS.map(batchId => makeBatch(batchId, overridesById[batchId] || {}));
}

function makeComplianceLogs(batches = makeBatches()) {
  return batches.map(batch => ({
    id: `bcl_${batch.batch_id}`,
    batch_id: batch.batch_id,
    source_production_batch_id: batch.id,
    juice_flavor: batch.product_name,
    date: batch.production_date,
    quantity_produced: 1,
    pH_result: 3.8,
    passed_failed: 'passed',
    verified_by: 'owner@example.test',
    verified_at: '2026-06-08T16:03:53.429Z',
    locked: true,
  }));
}

function context(overrides = {}) {
  const customerOrder = makeCustomerOrder(overrides.customerOrder);
  const nativeOrder = makeNativeOrder(overrides.nativeOrder);
  const task = makeTask(overrides.task);
  const batches = overrides.batches || makeBatches(overrides.batchOverrides || {});
  const complianceLogs = overrides.complianceLogs ?? makeComplianceLogs(batches);
  return {
    customerOrder,
    nativeOrder,
    task,
    batches,
    complianceLogs,
    notificationRows: overrides.notificationRows || [],
    messageLogRows: overrides.messageLogRows || [],
    commandLogs: overrides.commandLogs || [],
    lookup: { orderNumber: 'NV-MPZNKGNT', requestId: 'g32c_test' },
    auth: { actor_type: 'admin', actor_role: 'admin' },
  };
}

function makeStore({ user = { role: 'admin', email: 'owner@example.test' }, ...ctx } = context()) {
  const writes = [];
  const rowsFor = name => {
    if (name === 'Order') return [ctx.customerOrder].filter(Boolean);
    if (name === 'ShopifyOrder') return [ctx.nativeOrder].filter(Boolean);
    if (name === 'FulfillmentTask') return [ctx.task].filter(Boolean);
    if (name === 'ProductionBatch') return ctx.batches || [];
    if (name === 'BatchComplianceLog') return ctx.complianceLogs || [];
    if (name === 'Notification') return ctx.notificationRows || [];
    if (name === 'CustomerMessageDeliveryLog') return ctx.messageLogRows || [];
    if (name === 'CommandLog') return ctx.commandLogs || [];
    return [];
  };
  const match = (row, filter) => Object.entries(filter || {}).every(([key, value]) => row?.[key] === value);
  const api = name => ({
    filter: async filter => rowsFor(name).filter(row => match(row, filter)),
    list: async () => rowsFor(name),
    create: async payload => { writes.push({ op: 'create', name, payload }); throw new Error(`unexpected create ${name}`); },
    update: async (id, payload) => { writes.push({ op: 'update', name, id, payload }); throw new Error(`unexpected update ${name}`); },
    delete: async id => { writes.push({ op: 'delete', name, id }); throw new Error(`unexpected delete ${name}`); },
  });
  return {
    writes,
    base44: {
      auth: { me: async () => {
        if (user instanceof Error) throw user;
        return user;
      } },
      asServiceRole: { entities: {
        Order: api('Order'), ShopifyOrder: api('ShopifyOrder'), FulfillmentTask: api('FulfillmentTask'), ProductionBatch: api('ProductionBatch'), BatchComplianceLog: api('BatchComplianceLog'), Notification: api('Notification'), CustomerMessageDeliveryLog: api('CustomerMessageDeliveryLog'), CommandLog: api('CommandLog'),
      } },
    },
  };
}

function req(base44, body = {}, method = 'POST') {
  return { method, __base44: base44, headers: { get: () => '' }, text: async () => JSON.stringify(body) };
}
async function json(res) { return res.json(); }

const { exports: fns, handler } = loadHarness({ NATIVE_SAFE_SYNC_PREVIEW_SECRET: 'preview-secret' });
assert.equal(fns.mapNativeProductionStatusToCustomerStatus('bottled'), 'bottled_packed');
assert.equal(fns.mapNativeProductionStatusToCustomerStatus('packed'), 'bottled_packed');
assert.equal(fns.mapNativeProductionStatusToCustomerStatus('assigned_for_delivery'), 'out_for_delivery');

let preview = fns.buildPreview(context());
assert.equal(preview.success, true);
assert.equal(preview.dry_run, true);
assert.equal(preview.writes_performed, false);
assert.equal(preview.production_verified, true);
assert.equal(preview.task_packed, true);
assert.equal(preview.native_order_bottled, true);
assert.equal(preview.current_customer_order_status, 'scheduled_for_juicing');
assert.equal(preview.proposed_customer_order_status, 'bottled_packed');
assert.equal(preview.status_update_ready, true);
assert.equal(preview.status_update_held, true);
assert.equal(preview.status_command_available, true);
assert.equal(preview.status_command_gated, true);
assert.equal(preview.status_requires_exact_approval, true);
assert.equal(preview.notification_policy_required, 'NO_NOTIFICATION');
assert.equal(preview.proposed_status_history_entry.status, 'bottled_packed');
assert.equal(preview.status_history_preview.would_append, true);
assert.equal(preview.status_history_preview.preview_entry.status, 'bottled_packed');
assert.equal(preview.notification_would_send, false);
assert.equal(preview.notification_held, true);
assert.equal(preview.notification_preview.notification_would_send, false);
assert.equal(preview.notification_preview.automatic_notification_would_send_if_status_updated, false);
assert.equal(preview.notification_preview.status_only_path_available_without_notification, true);
assert.equal(preview.next_action, 'plan_status_only_command_with_notifications_disabled');
assert.equal(preview.safety.customer_app_order_updated, false);
assert.equal(preview.safety.status_history_appended, false);
assert.equal(preview.safety.notifications_sent, false);

preview = fns.buildPreview(context({ nativeOrder: { is_subscription: true, order_type: 'subscription', fulfillment_mode: 'multi_delivery' }, task: { order_type: 'subscription', fulfillment_type: 'subscription_delivery' } }));
assert.ok(preview.blockers.includes('subscription_multi_delivery_customer_status_blocked'));
assert.equal(preview.status_update_ready, false);
assert.equal(preview.customer_status_impact_preview.recommended_next_action, 'not_applicable');

preview = fns.buildPreview(context({ customerOrder: { status: 'cancelled' } }));
assert.ok(preview.blockers.includes('customer_app_order_terminal_status'));
assert.equal(preview.status_update_ready, false);

preview = fns.buildPreview(context({ nativeOrder: { production_status: 'refunded', financial_status: 'refunded' } }));
assert.ok(preview.blockers.includes('native_order_cancelled_or_refunded'));
assert.equal(preview.status_update_ready, false);

const notificationRisk = fns.buildNotificationPreview({
  customerOrder: makeCustomerOrder(),
  proposedStatus: 'out_for_delivery',
  notificationRows: [],
  messageLogRows: [],
});
assert.equal(notificationRisk.notification_would_send, false);
assert.equal(notificationRisk.notification_held, true);
assert.equal(notificationRisk.automatic_notification_would_send_if_status_updated, false);
assert.equal(notificationRisk.status_only_path_available_without_notification, true);

const { exports: fnsNotifyEnabled } = loadHarness({ ENABLE_ORDER_STATUS_NOTIFICATIONS: 'true' });
const enabledRisk = fnsNotifyEnabled.buildNotificationPreview({
  customerOrder: makeCustomerOrder(),
  proposedStatus: 'out_for_delivery',
  notificationRows: [],
  messageLogRows: [],
});
assert.equal(enabledRisk.notification_would_send, false);
assert.equal(enabledRisk.notification_held, true);
assert.equal(enabledRisk.automatic_notification_would_send_if_status_updated, true);
assert.ok(enabledRisk.blockers.includes('automatic_notification_would_send_if_status_updated'));

const alreadySatisfied = fns.buildPreview(context({ customerOrder: { status: 'bottled_packed', status_history: [{ status: 'bottled_packed', timestamp: '2026-06-08T19:00:00.000Z', message: 'Already packed.' }] } }));
assert.equal(alreadySatisfied.status_update_ready, false);
assert.equal(alreadySatisfied.status_update_already_satisfied, true);
assert.equal(alreadySatisfied.status_history_preview.would_append, false);
assert.equal(alreadySatisfied.customer_status_impact_preview.recommended_next_action, 'not_applicable');

const missingCompliance = fns.buildPreview(context({ complianceLogs: [] }));
assert.ok(missingCompliance.blockers.includes('missing_batch_compliance_logs'));
assert.equal(missingCompliance.status_update_ready, false);

const store = makeStore(context());
let res = await handler(req(store.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT' }));
let body = await json(res);
assert.equal(res.status, 200);
assert.equal(body.success, true);
assert.equal(body.writes_performed, false);
assert.equal(body.proposed_customer_order_status, 'bottled_packed');
assert.deepEqual(store.writes, []);

res = await handler(req(store.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT' }, 'GET'));
body = await json(res);
assert.equal(res.status, 405);
assert.equal(body.writes_performed, false);

const unauthStore = makeStore({ ...context(), user: null });
res = await handler(req(unauthStore.base44, { mode: 'dry_run', order_number: 'NV-MPZNKGNT' }));
body = await json(res);
assert.equal(res.status, 401);
assert.equal(body.writes_performed, false);
assert.deepEqual(unauthStore.writes, []);

const source = fs.readFileSync(path.join(repoRoot, 'base44/functions/previewNativeCustomerStatusNotificationImpact/entry.ts'), 'utf8');
assert.equal(/\.create\s*\(/.test(source), false, 'preview must not create records');
assert.equal(/\.update\s*\(/.test(source), false, 'preview must not update records');
assert.equal(/sendCustomerNotification|sendCustomerPushNotification|sendOrderStatusNotification/.test(source), false, 'preview must not invoke notification functions');

const syncHealthSource = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/SyncHealth.jsx'), 'utf8');
assert.equal(syncHealthSource.includes('Customer Status / Notification Impact Preview'), true);
assert.equal(syncHealthSource.includes('Run Customer Impact Preview'), true);
assert.equal(syncHealthSource.includes('previewNativeCustomerStatusNotificationImpact'), true);
assert.equal(syncHealthSource.includes('No Customer App Order write now'), true);
assert.equal(syncHealthSource.includes('Push/SMS/email/in-app held'), true);
assert.equal(syncHealthSource.includes('Status-only command available but gated'), true);
assert.equal(syncHealthSource.includes('NO_NOTIFICATION required'), true);

console.log('G32C customer status / notification impact preview tests passed');
