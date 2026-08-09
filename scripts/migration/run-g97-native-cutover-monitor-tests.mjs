#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.cwd();
const read = relativePath => fs.readFileSync(`${root}/${relativePath}`, 'utf8');

function loadHandler(relativePath, base44, now = '2026-08-08T14:00:00.000Z') {
  let source = read(relativePath)
    .replace(/^import .*$/gm, '')
    .replace('export default async', 'globalThis.__handler = async');
  source = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const logs = [];
  const context = vm.createContext({
    Response,
    Request,
    Headers,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    RegExp,
    Error,
    Promise,
    Math,
    Intl,
    Date: class extends Date {
      constructor(value) { super(value === undefined ? now : value); }
      static now() { return new Date(now).getTime(); }
    },
    console: {
      log: (...args) => logs.push(['log', ...args]),
      warn: (...args) => logs.push(['warn', ...args]),
      error: (...args) => logs.push(['error', ...args]),
    },
    createClientFromRequest: () => base44,
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: relativePath });
  return { handler: context.globalThis.__handler, logs };
}

const orderFixtures = {
  Order: [{
    id: 'order_1',
    order_number: 'NV-SYNTHETIC-1',
    created_date: '2026-08-08T13:55:00.000Z',
    payment_captured: true,
    payment_status: 'paid',
    status: 'scheduled_for_juicing',
    fulfillment_type: 'delivery',
    assigned_delivery_date: '2026-08-09',
  }],
  ShopifyOrder: [{
    id: 'ops_order_1',
    base44_order_id: 'order_1',
    shopify_order_number: 'NV-SYNTHETIC-1',
    fulfillment_method: 'delivery',
    assigned_delivery_date: '2026-08-09',
    created_date: '2026-08-08T13:55:10.000Z',
  }],
  FulfillmentTask: [{
    id: 'task_1',
    base44_order_id: 'order_1',
    order_id: 'ops_order_1',
    order_number: 'NV-SYNTHETIC-1',
    delivery_date: '2026-08-09',
    created_date: '2026-08-08T13:55:20.000Z',
  }],
  OrderSyncLog: [{
    id: 'audit_1',
    order_number: 'NV-SYNTHETIC-1',
    sync_source: 'native_order_ops',
    status: 'success',
    created_date: '2026-08-08T13:55:30.000Z',
  }],
  Subscription: [],
  PendingSubscriptionCheckout: [],
  UserPoints: [],
};

function monitorClient(fixtures = orderFixtures, role = 'admin') {
  const entities = Object.fromEntries(Object.entries(fixtures).map(([name, rows]) => [name, { list: async () => rows }]));
  return { auth: { me: async () => role ? ({ role, email: 'operator@example.test' }) : null }, asServiceRole: { entities } };
}

const monitorPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/monitorPostPaymentChain/entry.ts';
const monitor = loadHandler(monitorPath, monitorClient());
const healthyResponse = await monitor.handler(new Request('https://example.test', { method: 'POST', body: '{}' }));
const healthy = await healthyResponse.json();
assert.equal(healthyResponse.status, 200);
assert.equal(healthy.overall, 'all_clear');
assert.equal(healthy.orders.ok, 1);
assert.equal(healthy.customer_app_native_authoritative, true);
assert.equal(healthy.hub_operational_dependency, false);
assert.equal(JSON.stringify(healthy).includes('example.test'), false);

const missingTaskFixtures = structuredClone(orderFixtures);
missingTaskFixtures.FulfillmentTask = [];
const missingTask = loadHandler(monitorPath, monitorClient(missingTaskFixtures));
const missingTaskResponse = await missingTask.handler(new Request('https://example.test', { method: 'POST', body: '{}' }));
const missingTaskResult = await missingTaskResponse.json();
assert.equal(missingTaskResult.overall, 'issues_detected');
assert.deepEqual([...missingTaskResult.orders.failed_items[0].issues], ['native_fulfillment_task_missing']);

const missingProjectionFixtures = structuredClone(orderFixtures);
missingProjectionFixtures.ShopifyOrder = [];
const missingProjection = loadHandler(monitorPath, monitorClient(missingProjectionFixtures));
const missingProjectionResult = await (await missingProjection.handler(new Request('https://example.test', { method: 'POST', body: '{}' }))).json();
assert.equal(missingProjectionResult.orders.failed_items[0].issues.includes('native_operational_order_missing'), true);

const pickupFixtures = structuredClone(orderFixtures);
pickupFixtures.Order[0].fulfillment_type = 'pickup';
pickupFixtures.Order[0].assigned_delivery_date = null;
pickupFixtures.ShopifyOrder[0].fulfillment_method = 'pickup';
pickupFixtures.ShopifyOrder[0].assigned_delivery_date = null;
pickupFixtures.FulfillmentTask = [];
const pickup = loadHandler(monitorPath, monitorClient(pickupFixtures));
const pickupResult = await (await pickup.handler(new Request('https://example.test', { method: 'POST', body: '{}' }))).json();
assert.equal(pickupResult.orders.ok, 1);

const unauthorized = loadHandler(monitorPath, monitorClient(orderFixtures, null));
assert.equal((await unauthorized.handler(new Request('https://example.test', { method: 'POST', body: '{}' }))).status, 401);

const sentEmails = [];
const complianceEntities = {
  ComplianceDoc: { list: async () => [
    { id: 'doc_expired', name: '<Expired Permit>', type: 'Permit', expiry_date: '2026-08-01', status: 'Valid' },
    { id: 'doc_due', name: 'Due License', type: 'License', expiry_date: '2026-08-20', status: 'Valid', reminder_days: 30 },
    { id: 'doc_valid', name: 'Valid Inspection', type: 'Inspection', expiry_date: '2027-01-01', status: 'Overdue' },
  ] },
  User: { list: async () => [
    { role: 'admin', email: 'operator@example.test' },
    { role: 'user', email: 'customer@example.test' },
  ] },
};
const complianceClient = {
  auth: { me: async () => ({ role: 'admin', email: 'operator@example.test' }) },
  asServiceRole: {
    entities: complianceEntities,
    integrations: { Core: { SendEmail: async payload => { sentEmails.push(payload); return { success: true }; } } },
  },
};
const compliancePath = monitorPath;
const compliance = loadHandler(compliancePath, complianceClient);
const complianceRequest = body => new Request('https://example.test', {
  method: 'POST',
  headers: { 'x-nuvira-admin-action': 'monitorComplianceExpiry' },
  body: JSON.stringify(body),
});
const dryRun = await (await compliance.handler(complianceRequest({}))).json();
assert.equal(dryRun.mode, 'dry_run');
assert.equal(dryRun.expired_count, 1);
assert.equal(dryRun.due_soon_count, 1);
assert.equal(sentEmails.length, 0);

const liveResult = await (await compliance.handler(complianceRequest({ mode: 'live' }))).json();
assert.equal(liveResult.sent, true);
assert.equal(liveResult.internal_admin_notifications_sent, 1);
assert.equal(sentEmails.length, 1);
assert.equal(sentEmails[0].body.includes('&lt;Expired Permit&gt;'), true);
assert.equal(sentEmails[0].body.includes('customer@example.test'), false);

const deniedCompliance = loadHandler(compliancePath, {
  ...complianceClient,
  auth: { me: async () => ({ role: 'user', email: 'customer@example.test' }) },
});
assert.equal((await deniedCompliance.handler(complianceRequest({}))).status, 403);

const gateway = read('base44/functions/getAdminOperationsDashboardSummary/entry.ts');
const config = read('base44/functions/getAdminOperationsDashboardSummary/function.jsonc');
assert.match(gateway, /monitorComplianceExpiry/);
assert.match(gateway, /"monitorComplianceExpiry": handler61/);
assert.match(gateway, /x-nuvira-admin-action/);
assert.match(gateway, /g97-customer-app-native-monitoring-20260808/);
assert.match(config, /Customer App Compliance Expiry Review/);
assert.match(config, /"gateway_action": "monitorComplianceExpiry"/);
assert.match(config, /"repeat_unit": "weeks"/);
assert.match(config, /"repeat_interval": 1/);
assert.match(config, /"repeat_on_days": \[1\]/);
assert.match(gateway, /automationArgs/);
assert.equal(fs.existsSync(`${root}/base44/functions/getAdminOperationsDashboardSummary/handlers/monitorComplianceExpiry/entry.ts`), false);
assert.doesNotMatch(read(monitorPath), /HUB_API_URL|CUSTOMER_APP_SYNC_SECRET|no_hub_sync_log|hub_sync_status/);

console.log(JSON.stringify({
  success: true,
  suite: 'g97-native-cutover-monitor',
  cases: 8,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  hub_operational_dependency: false,
}, null, 2));
