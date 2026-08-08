#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const outIndex = process.argv.indexOf('--out');
const outPath = outIndex >= 0 ? process.argv[outIndex + 1] : '';
let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  checks += 1;
}

function loadFunctions(filePath, exportNames, env = {}) {
  let source = fs.readFileSync(filePath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
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
    Map,
    RegExp,
    JSON,
    Error,
    URL,
    Response,
    createClientFromRequest: req => req.__base44,
    Deno: {
      env: { get: key => env[key] || '' },
      serve: handler => { context.globalThis.__handler = handler; },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: filePath });
  return context.globalThis.__exports;
}

const task = {
  id: 'g53-internal-task-id',
  fulfillment_task_id: 'TASK-G53-TEST-20260723-DELIVERY',
  order_id: 'G53-INTERNAL-NO-CUSTOMER-ORDER',
  order_number: 'G53-TEST-DELIVERY-20260723',
  customer_name: 'G53 Internal QA',
  customer_email: 'g53.internal@example.invalid',
  fulfillment_number: 1,
  fulfillment_type: 'delivery',
  delivery_date: '2026-07-23',
  delivery_address: { address_line1: 'Internal Test Route', city: 'Internal', state: 'MO' },
  items: [{ title: 'Aura', quantity: 1 }],
  items_summary: '1x Aura',
  status: 'scheduled',
  delivery_status: 'pending',
  production_status: 'ready',
  is_test_task: true,
  test_purpose: 'G53 controlled delivery persistence validation',
};

const env = {
  ENABLE_NATIVE_FULFILLMENT_TASK_TEST_LIFECYCLE_WRITES: 'true',
  NATIVE_FULFILLMENT_TASK_LIFECYCLE_TEST_ALLOWED_EMAILS: 'info@nuvirajuice.com',
  NATIVE_FULFILLMENT_TASK_LIFECYCLE_TEST_ALLOWED_ACTIONS: 'assign,pack,out_for_delivery,delivered_operational',
  NATIVE_FULFILLMENT_TASK_LIFECYCLE_TEST_TASK_ALLOWLIST: task.fulfillment_task_id,
};

const executePath = path.join(repoRoot, 'base44/functions/executeNativeFulfillmentTaskLifecycle/entry.ts');
const executeSource = fs.readFileSync(executePath, 'utf8');
const executeFns = loadFunctions(executePath, ['envGateFailure', 'planLifecycle'], env);

equal(executeFns.envGateFailure({
  action: 'assign',
  task,
  requestedKey: task.fulfillment_task_id,
  actorEmail: 'info@nuvirajuice.com',
}), null, 'marked test task should pass the isolated test gate');
equal(executeFns.envGateFailure({
  action: 'assign',
  task: { ...task, is_test_task: false },
  requestedKey: task.fulfillment_task_id,
  actorEmail: 'info@nuvirajuice.com',
}), 'test_task_allowlist_requires_test_marker', 'test allowlist must require the formal marker');
equal(executeFns.envGateFailure({
  action: 'unassign',
  task,
  requestedKey: task.fulfillment_task_id,
  actorEmail: 'info@nuvirajuice.com',
}), 'action_not_allowlisted', 'test action allowlist must remain exact');
equal(executeFns.envGateFailure({
  action: 'assign',
  task,
  requestedKey: task.fulfillment_task_id,
  actorEmail: 'other@example.com',
}), 'actor_email_not_allowlisted', 'test actor allowlist must remain exact');
equal(executeFns.envGateFailure({
  action: 'assign',
  task: { ...task, fulfillment_task_id: 'TASK-REAL', is_test_task: false, test_purpose: '' },
  requestedKey: 'TASK-REAL',
  actorEmail: 'info@nuvirajuice.com',
}), 'native_fulfillment_task_lifecycle_writes_disabled', 'normal writer must remain disabled');

let plan = executeFns.planLifecycle({
  action: 'delivered_operational',
  task,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g53-invalid-delivered',
  now: '2026-07-23T18:00:00.000Z',
  body: {},
  reason: 'invalid transition proof',
});
check(plan.blockers.includes('status_not_deliverable'), 'invalid delivered transition must be blocked');

plan = executeFns.planLifecycle({
  action: 'assign',
  task,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g53-assign',
  now: '2026-07-23T18:01:00.000Z',
  body: { assigned_driver: 'G53 Internal Driver' },
  reason: 'internal validation',
});
equal(plan.proposed_patch.status, 'assigned', 'assign transition should be ready');

const assignedTask = { ...task, ...plan.proposed_patch };
plan = executeFns.planLifecycle({
  action: 'pack',
  task: assignedTask,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g53-pack',
  now: '2026-07-23T18:02:00.000Z',
  body: {},
  reason: 'internal validation',
});
equal(plan.proposed_patch.status, 'packed', 'pack transition should be ready');

const packedTask = { ...assignedTask, ...plan.proposed_patch };
plan = executeFns.planLifecycle({
  action: 'out_for_delivery',
  task: packedTask,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g53-out-for-delivery',
  now: '2026-07-23T18:03:00.000Z',
  body: { update_customer_order_status: false, notify_customer: false },
  reason: 'internal validation',
});
equal(plan.proposed_patch.status, 'out_for_delivery', 'out-for-delivery transition should be ready');
check(plan.warnings.includes('customer_status_projection_deferred'), 'customer order projection must remain deferred');
check(plan.warnings.includes('customer_notification_not_included'), 'customer notification must remain excluded');

const outForDeliveryTask = { ...packedTask, ...plan.proposed_patch };
plan = executeFns.planLifecycle({
  action: 'delivered_operational',
  task: outForDeliveryTask,
  actorEmail: 'info@nuvirajuice.com',
  requestId: 'g53-delivered',
  now: '2026-07-23T18:04:00.000Z',
  body: {
    delivery_drop_location: 'Internal Test Completion',
    delivery_notes: 'G53 internal delivery pilot; no customer or provider effect',
    update_customer_order_status: false,
    notify_customer: false,
  },
  reason: 'internal validation',
});
equal(plan.proposed_patch.status, 'delivered', 'delivered transition should be ready');
equal(plan.proposed_patch.delivery_drop_location, 'Internal Test Completion', 'drop location should be persisted');

check(executeSource.includes('test_task_customer_side_effects_forbidden'), 'server must reject customer side effects for test tasks');
check(executeSource.includes("['success', 'skipped'].includes(normalizeLower(existingLog.status))"), 'successful replay handling must be explicit');
check(executeSource.includes("normalizeLower(existingLog.status) === 'rejected'"), 'rejected replay must remain rejected');
check(executeSource.includes("['pending', 'running'].includes(normalizeLower(existingLog.status))"), 'in-progress replay must remain blocked');
check(executeSource.includes('is_test_task: task?.is_test_task === true'), 'command logs must carry the test-task marker');

const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'base44/entities/FulfillmentTask.jsonc'), 'utf8'));
equal(schema.properties.is_test_task.type, 'boolean', 'FulfillmentTask must have a formal test marker');
equal(schema.properties.is_test_task.default, false, 'test marker must default false');
equal(schema.properties.test_purpose.type, 'string', 'FulfillmentTask must record test purpose');

const routeSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminDeliveryRouteSummary/entry.ts'), 'utf8');
check(routeSource.includes("testTaskMode === 'only' ? task?.is_test_task === true : task?.is_test_task !== true"), 'delivery route summary must isolate test tasks');
check(routeSource.includes("testTaskMode === 'only'") && routeSource.includes('hubWarning = null'), 'test-only view must skip the Hub fallback');
check(routeSource.includes('operational_totals_exclude_test_tasks: true'), 'delivery response must declare operational isolation');

const dashboardSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminOperationsDashboardSummary/entry.ts'), 'utf8');
check(dashboardSource.includes('task?.is_test_task !== true'), 'operations dashboard must exclude test tasks');
check(dashboardSource.includes('row?.payload?.is_test_task !== true'), 'operations dashboard must exclude test command logs');

const calendarSource = fs.readFileSync(path.join(repoRoot, 'base44/functions/getAdminCalendarEventsSummary/entry.ts'), 'utf8');
check(calendarSource.includes('row?.is_test_task !== true'), 'calendar must exclude test tasks');
check(calendarSource.includes('row?.is_test_record !== true'), 'calendar must exclude test compliance records');

const uiSource = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/DeliveryQueue.jsx'), 'utf8');
check(uiSource.includes('Open Internal Test Validation'), 'delivery queue must expose an explicit internal test-only view');
check(uiSource.includes("test_task_mode: testTaskMode"), 'delivery queue must send the explicit test-task mode');

const result = {
  ok: true,
  suite: 'g53-phase-b-live-pilot-prerequisites',
  generated_at_utc: new Date().toISOString(),
  checks,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
};

if (outPath) {
  const absoluteOutPath = path.resolve(repoRoot, outPath);
  fs.mkdirSync(path.dirname(absoluteOutPath), { recursive: true });
  fs.writeFileSync(absoluteOutPath, `${JSON.stringify(result, null, 2)}\n`);
}

console.log(JSON.stringify(result, null, 2));
