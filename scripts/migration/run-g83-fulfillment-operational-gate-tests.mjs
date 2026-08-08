import assert from 'node:assert/strict';
import fs from 'node:fs';

const handlerPath = 'base44/functions/getAdminOperationsDashboardSummary/handlers/executeNativeFulfillmentTaskLifecycle/entry.ts';
const uiPath = 'src/pages/admin/DeliveryQueue.jsx';
const handler = fs.readFileSync(handlerPath, 'utf8');
const ui = fs.readFileSync(uiPath, 'utf8');

const tests = [
  ['operational tasks are identified separately from internal test tasks', () => {
    assert.match(handler, /function isInternalTestTask\(task\)/);
    assert.match(handler, /const isTestRequest = isInternalTestTask\(task\)/);
  }],
  ['operational tasks do not depend on a per-task launch allowlist', () => {
    assert.doesNotMatch(handler, /const TASK_ALLOWLIST_FLAG/);
    assert.doesNotMatch(handler, /return 'task_allowlist_required'/);
    assert.doesNotMatch(handler, /return 'task_not_allowlisted'/);
  }],
  ['internal test tasks remain exact allowlisted and separately enabled', () => {
    assert.match(handler, /ENABLE_NATIVE_FULFILLMENT_TASK_TEST_LIFECYCLE_WRITES/);
    assert.match(handler, /return 'test_task_allowlist_required'/);
    assert.match(handler, /return 'test_task_not_allowlisted'/);
    assert.match(handler, /return 'test_task_allowlist_requires_test_marker'/);
  }],
  ['the entity automation remains the single customer notification sender', () => {
    assert.match(handler, /queued: true,[\s\S]*reason: 'order_status_entity_automation_triggered'/);
    assert.match(ui, /notification\.queued\) pieces\.push\('customer notification queued'\)/);
  }],
];

let passed = 0;
for (const [name, test] of tests) {
  test();
  passed += 1;
  console.log(`PASS ${name}`);
}
console.log(`\n${passed}/${tests.length} fulfillment operational-gate tests passed.`);
