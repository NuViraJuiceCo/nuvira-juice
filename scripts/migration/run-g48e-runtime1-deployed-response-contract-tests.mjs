#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const entryPath = path.join(repoRoot, 'base44/functions/getAdminOrdersWithHub/entry.ts');
const helperPath = path.join(repoRoot, 'base44/functions/getAdminOrdersWithHub/adminOrderLifecycleReadModel.js');
const uiPath = path.join(repoRoot, 'src/pages/AdminOrders.jsx');
const appParamsPath = path.join(repoRoot, 'src/lib/app-params.js');
const docsPath = path.join(repoRoot, 'docs/migration/g48e-runtime1-deployed-response-contract-investigation.md');

const entrySource = fs.readFileSync(entryPath, 'utf8');
const helperSource = fs.readFileSync(helperPath, 'utf8');
const uiSource = fs.readFileSync(uiPath, 'utf8');
const appParamsSource = fs.readFileSync(appParamsPath, 'utf8');
const docs = fs.existsSync(docsPath) ? fs.readFileSync(docsPath, 'utf8') : '';

function loadHandler({ role = 'admin', env = {} } = {}) {
  const source = entrySource.replace(/^import .*$/gm, '');
  const reads = [];
  const writes = [];
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
    Promise,
    Intl,
    createClientFromRequest: req => req.__base44,
    buildAdminOrderLifecycleReadModel: () => ({ read_model_version: 'g48e_admin_order_lifecycle_v1', rows: [], summary: {} }),
    fetch: async () => new Response(JSON.stringify({ orders: [] }), { status: 200 }),
    Deno: { env: { get: key => env[key] || '' }, serve: handler => { context.globalThis.__handler = handler; } },
    globalThis: {},
  });
  const serviceRole = { entities: new Proxy({}, {
    get(_target, name) {
      return {
        list: async () => { reads.push(String(name)); return []; },
        filter: async () => { reads.push(`${String(name)}.filter`); return []; },
        create: async () => { writes.push(String(name)); throw new Error('unexpected create'); },
        update: async () => { writes.push(String(name)); throw new Error('unexpected update'); },
        delete: async () => { writes.push(String(name)); throw new Error('unexpected delete'); },
      };
    },
  }) };
  const base44 = {
    auth: { me: async () => role === 'none' ? null : { id: 'user', role } },
    asServiceRole: serviceRole,
  };
  vm.runInContext(source, context, { filename: entryPath });
  return { handler: context.globalThis.__handler, base44, reads, writes };
}

async function invoke({ body, role = 'admin', env = {} }) {
  const runtime = loadHandler({ role, env });
  const response = await runtime.handler({ __base44: runtime.base44, json: async () => body });
  return { status: response.status, payload: await response.json(), reads: runtime.reads, writes: runtime.writes };
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. Harness request shape matches actual direct JSON body parsing', () => {
  assert.match(entrySource, /body\s*=\s*await req\.json\(\)/);
  assert.match(entrySource, /body\?\.read_model_mode/);
});

test('2. Frontend invocation shape is direct object payload', () => {
  assert.match(uiSource, /base44\.functions\.invoke\('getAdminOrdersWithHub',\s*\{\s*read_model_mode:\s*ADMIN_ORDER_LIFECYCLE_READ_MODEL_MODE/s);
});

test('3. Direct HTTP adapter shape is documented as JSON body', () => {
  assert.match(docs, /direct_http_request_shape=direct_json_body/);
});

test('4. Explicit mode reaches diagnostic intended branch', async () => {
  const result = await invoke({ body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.equal(result.status, 200);
  assert.equal(result.payload.success, true);
  assert.equal(result.payload.read_model_mode_received, true);
  assert.equal(result.payload.read_model_mode_value_match, true);
  assert.equal(result.payload.response_contract_version, 'g48e_runtime_contract_v1');
});

test('5. Missing mode is reported and does not activate read model', async () => {
  const result = await invoke({ body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT' } });
  assert.equal(result.payload.read_model_mode_received, false);
  assert.equal(result.payload.read_model_mode_value_match, false);
  assert.equal(result.payload.admin_order_lifecycle_read_model_enabled, false);
});

test('6. Wrong mode is reported safely', async () => {
  const result = await invoke({ body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'WRONG_MODE' } });
  assert.equal(result.payload.read_model_mode_received, true);
  assert.equal(result.payload.read_model_mode_value_match, false);
  assert.equal(result.payload.admin_order_lifecycle_read_model_enabled, false);
});

test('7. Capability metadata is attached on diagnostic disabled response', async () => {
  const result = await invoke({ body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.equal(result.payload.admin_order_lifecycle_read_model_available, true);
  assert.equal(result.payload.admin_order_lifecycle_read_model_enabled, false);
  assert.equal(result.payload.admin_order_lifecycle_read_model_version, 'g48e_admin_order_lifecycle_v1');
  assert.equal(result.payload.read_model_payload_present, false);
});

test('8. Legacy response construction still contains additive disabled metadata source', () => {
  assert.match(entrySource, /admin_order_lifecycle_read_model_available:\s*true/);
  assert.match(entrySource, /admin_order_lifecycle_read_model_enabled:\s*Boolean\(adminOrderLifecycleReadModelRequested && adminOrderLifecycleReadModelActive\)/);
  assert.match(entrySource, /\.\.\.\(adminOrderLifecycleReadModel \? \{ admin_order_lifecycle_read_model: adminOrderLifecycleReadModel \} : \{\}\)/);
});

test('9. Early auth returns cannot expose diagnostic data', async () => {
  const result = await invoke({ role: 'customer', body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.equal(result.status, 403);
  assert.equal(result.payload.success, undefined);
  assert.equal(result.payload.g48e_source_marker_present, undefined);
});

test('10. Response serializer preserves additive top-level diagnostic fields', async () => {
  const result = await invoke({ body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  for (const key of ['g48e_source_marker_present', 'capability_metadata_constructed', 'capability_metadata_attached']) {
    assert.equal(result.payload[key], true);
  }
});

test('11. Official and custom endpoints are compared safely in docs', () => {
  assert.match(docs, /base44_endpoint_metadata_present=/);
  assert.match(docs, /custom_endpoint_metadata_present=/);
  assert.match(docs, /response_key_sets_match=/);
});

test('12. Wrong app or endpoint target is detectable', () => {
  assert.match(appParamsSource, /DEFAULT_BASE44_APP_ID/);
  assert.match(docs, /cli_project_matches_source_pull=/);
  assert.match(docs, /source_pull_matches_test_endpoint=/);
});

test('13. Diagnostic mode requires admin', async () => {
  const unauth = await invoke({ role: 'none', body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT' } });
  const customer = await invoke({ role: 'customer', body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT' } });
  assert.equal(unauth.status, 401);
  assert.equal(customer.status, 403);
});

test('14. Diagnostic mode returns no order or customer data', async () => {
  const result = await invoke({ body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  const keys = Object.keys(result.payload).join(' ');
  assert.doesNotMatch(keys, /orders|customer|email|phone|address|record_id|payment_intent|shopify_order_id|native_fulfillment_task_id/i);
});

test('15. Diagnostic mode performs no entity reads', async () => {
  const result = await invoke({ body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.deepEqual(result.reads, []);
});

test('16. Diagnostic mode performs no entity writes', async () => {
  const result = await invoke({ body: { diagnostic_mode: 'G48E_RUNTIME_CONTRACT', read_model_mode: 'ADMIN_ORDER_LIFECYCLE' } });
  assert.deepEqual(result.writes, []);
  assert.equal(result.payload.writes_performed, false);
});

test('17. No provider calls are introduced', () => {
  const addedDiagnosticSection = entrySource.slice(entrySource.indexOf('if (isG48eRuntimeDiagnosticRequest'), entrySource.indexOf('// 1. Fetch all local orders'));
  assert.doesNotMatch(addedDiagnosticSection, /fetch\s*\(|stripe\.|Stripe\.|shopify\.|Shopify\.|provider\s*\(/i);
});

test('18. Diagnostic mode performs no Hub calls', () => {
  const addedDiagnosticSection = entrySource.slice(entrySource.indexOf('if (isG48eRuntimeDiagnosticRequest'), entrySource.indexOf('// 1. Fetch all local orders'));
  assert.doesNotMatch(addedDiagnosticSection, /HUB_API_URL|hubSync\s*\(|fetchHub\s*\(|invoke\(['"]hub|fetch\s*\(/i);
  assert.equal(addedDiagnosticSection.includes('hub_write_suppression_ready: false'), true);
});

test('19. Diagnostic mode performs no notifications', () => {
  const addedDiagnosticSection = entrySource.slice(entrySource.indexOf('if (isG48eRuntimeDiagnosticRequest'), entrySource.indexOf('// 1. Fetch all local orders'));
  assert.doesNotMatch(addedDiagnosticSection, /Notification\.|CustomerMessageDeliveryLog|send[A-Z]/);
  assert.equal(addedDiagnosticSection.includes('notifications_sent: false'), true);
});

test('20. Diagnostic mode creates no logs or queues', () => {
  const addedDiagnosticSection = entrySource.slice(entrySource.indexOf('if (isG48eRuntimeDiagnosticRequest'), entrySource.indexOf('// 1. Fetch all local orders'));
  assert.doesNotMatch(addedDiagnosticSection, /CommandLog|OrderSyncLog|OrderReviewQueue|SafeSyncParityLog|\.create\s*\(/);
});

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failures.push({ name, error: error.message });
    console.error(`not ok - ${name}: ${error.message}`);
  }
}

if (failures.length) {
  console.error(JSON.stringify({ suite: 'g48e-runtime1-deployed-response-contract', passed, failed: failures.length, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  suite: 'g48e-runtime1-deployed-response-contract',
  tests: tests.length,
  passed,
  failed: 0,
  writes_performed: false,
  provider_call_impact: false,
  hub_calls: false,
  notifications_sent: false,
  raw_payloads_returned: false,
  pii_returned: false,
  classification: 'admin_order_lifecycle_runtime_contract_fix_pr_ready',
}, null, 2));
