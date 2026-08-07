#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const repoRoot = process.cwd();
const functionPath = path.join(repoRoot, 'base44/functions/previewNativeOrderCutoverReadiness/entry.ts');
const docsPath = path.join(repoRoot, 'docs/migration/g41b-admin-compliance-native-read-parity-preview.md');
const source = fs.readFileSync(functionPath, 'utf8');

function loadHarness(env = {}) {
  let handler;
  const sandbox = {
    console,
    Response,
    setTimeout,
    Deno: {
      env: { get: name => env[name] || '' },
      serve: fn => { handler = fn; },
    },
    createClientFromRequest: req => req.__base44,
  };
  const runnable = source.replace("import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';", '');
  vm.runInNewContext(runnable, sandbox, { filename: functionPath });
  return { handler };
}

function normalize(value) {
  return String(value ?? '').trim();
}

function sortRows(rows, sort = '-created_date') {
  const out = [...(rows || [])];
  const key = sort?.startsWith('-') ? sort.slice(1) : sort;
  const desc = sort?.startsWith('-');
  out.sort((a, b) => {
    const left = String(a?.[key] || '');
    const right = String(b?.[key] || '');
    return desc ? right.localeCompare(left) : left.localeCompare(right);
  });
  return out;
}

function exactFilter(rows, filter) {
  const entries = Object.entries(filter || {}).filter(([, value]) => normalize(value));
  return (rows || []).filter(row => entries.every(([key, value]) => row?.[key] === value));
}

function batch(overrides = {}) {
  return {
    id: overrides.id || 'pb_clean',
    batch_id: overrides.batch_id || 'BATCH-G41B-CLEAN',
    product_name: overrides.product_name || 'AURA',
    production_date: overrides.production_date || '2026-06-21',
    status: overrides.status || 'verified_logged',
    planned_units: overrides.planned_units ?? 12,
    actual_units: overrides.actual_units ?? 12,
    actual_start_time: overrides.actual_start_time || '2026-06-21T13:00:00.000Z',
    actual_end_time: overrides.actual_end_time || '2026-06-21T15:00:00.000Z',
    pH_result: overrides.pH_result ?? 3.82,
    pH_passed_failed: overrides.pH_passed_failed || 'passed',
    passed_failed: overrides.passed_failed || 'passed',
    verified_by: overrides.verified_by || 'admin@example.test',
    verified_at: overrides.verified_at || '2026-06-21T15:10:00.000Z',
    compliance_log_id: overrides.compliance_log_id || 'bcl_clean',
    is_locked: overrides.is_locked ?? false,
    notes: overrides.notes || 'internal production note should not be returned',
    order_sources: overrides.order_sources || [{ customer_email: 'customer@example.test', customer_name: 'Private Customer', order_number: 'NV-PRIVATE' }],
    ...overrides,
  };
}

function complianceLog(overrides = {}) {
  return {
    id: overrides.id || 'bcl_clean',
    date: overrides.date || '2026-06-21',
    batch_id: overrides.batch_id || 'BATCH-G41B-CLEAN',
    juice_flavor: overrides.juice_flavor || 'AURA',
    quantity_produced: overrides.quantity_produced ?? 12,
    pH_result: overrides.pH_result ?? 3.82,
    passed_failed: overrides.passed_failed || 'passed',
    verified_by: overrides.verified_by || 'manager@example.test',
    verified_at: overrides.verified_at || '2026-06-21T15:11:00.000Z',
    source_production_batch_id: overrides.source_production_batch_id || 'pb_clean',
    locked: overrides.locked ?? true,
    notes: overrides.notes || 'raw compliance notes should not be returned',
    ...overrides,
  };
}

function alert(overrides = {}) {
  return {
    id: overrides.id || 'alert_clean',
    alert_type: overrides.alert_type || 'Failure',
    severity: overrides.severity || 'High',
    related_log_id: overrides.related_log_id || 'bcl_clean',
    related_log_type: overrides.related_log_type || 'BatchComplianceLog',
    status: overrides.status || 'Active',
    message: overrides.message || 'Internal alert text should not be returned',
    created_date: overrides.created_date || '2026-06-21T15:12:00.000Z',
    triggered_date: overrides.triggered_date || '2026-06-21',
    ...overrides,
  };
}

function command(overrides = {}) {
  return {
    id: overrides.id || 'cmd_clean',
    target_entity: overrides.target_entity || 'ProductionBatch',
    target_id: overrides.target_id || 'pb_clean',
    target_display_id: overrides.target_display_id || 'BATCH-G41B-CLEAN',
    status: overrides.status || 'success',
    function_name: overrides.function_name || 'executeNativeProductionBatchLifecycle',
    command_type: overrides.command_type || 'production_batch_verify',
    notes: overrides.notes || 'safe command metadata only',
    payload: { secret: 'should-not-return' },
    result: { raw: 'should-not-return' },
    created_date: overrides.created_date || '2026-06-21T15:13:00.000Z',
    ...overrides,
  };
}

function baseData(overrides = {}) {
  return {
    ProductionBatch: overrides.ProductionBatch || [batch()],
    BatchComplianceLog: overrides.BatchComplianceLog || [complianceLog()],
    ComplianceAlert: overrides.ComplianceAlert || [],
    OperationalAlert: overrides.OperationalAlert || [],
    ManualProductionBatch: overrides.ManualProductionBatch || [],
    CommandLog: overrides.CommandLog || [command()],
  };
}

function makeBase44({ data = baseData(), errors = {}, calls = [], writes = [], user = { role: 'admin', email: 'admin@example.test' } } = {}) {
  const entityNames = ['ProductionBatch', 'BatchComplianceLog', 'ComplianceAlert', 'OperationalAlert', 'ManualProductionBatch', 'CommandLog'];
  const entities = {};
  for (const name of entityNames) {
    entities[name] = {
      list: async (sort = '-created_date', limit = 100) => {
        calls.push({ entity: name, method: 'list', sort, limit });
        if (errors[name]) throw errors[name];
        return sortRows(data[name] || [], sort).slice(0, limit || 100);
      },
      filter: async (filter = {}, sort = '-created_date', limit = 10) => {
        calls.push({ entity: name, method: 'filter', filter, sort, limit });
        if (errors[`${name}Filter`]) throw errors[`${name}Filter`];
        return sortRows(exactFilter(data[name] || [], filter), sort).slice(0, limit || 10);
      },
      create: async row => { writes.push({ entity: name, method: 'create', row }); return row; },
      update: async (id, row) => { writes.push({ entity: name, method: 'update', id, row }); return row; },
      delete: async id => { writes.push({ entity: name, method: 'delete', id }); return id; },
    };
  }
  return {
    auth: { me: async () => user },
    asServiceRole: { entities },
  };
}

function request(base44, body = {}, method = 'POST') {
  return {
    method,
    headers: { get: () => '' },
    text: async () => JSON.stringify({
      preview_mode: 'ADMIN_COMPLIANCE_OPERATIONS_READ_PARITY',
      mode: 'EXACT_COMPLIANCE_RECORD_PARITY',
      production_batch_id: 'pb_clean',
      batch_compliance_log_id: 'bcl_clean',
      request_id: 'g41b_fixture',
      ...body,
    }),
    __base44: base44,
  };
}

async function invoke({ data, errors, body, user, method } = {}) {
  const calls = [];
  const writes = [];
  const { handler } = loadHarness();
  const base44 = makeBase44({ data: data || baseData(), errors: errors || {}, calls, writes, user });
  const response = await handler(request(base44, body, method));
  return { status: response.status, json: await response.json(), calls, writes };
}

function assertNoSideEffects(result) {
  assert.equal(result.writes.length, 0, 'no entity writes');
  assert.equal(result.json.writes_performed, false);
  assert.equal(result.json.production_batch_mutation_performed, false);
  assert.equal(result.json.compliance_log_mutation_performed, false);
  assert.equal(result.json.compliance_alert_created, false);
  assert.equal(result.json.notifications_sent, false);
  assert.equal(result.json.hub_mutation_performed, false);
  assert.equal(result.json.customer_facing_behavior_changed, false);
  assert.equal(result.json.provider_call_impact, false);
  assert.equal(result.json.command_log_created, false);
}

function assertNoUnsafePayload(json) {
  const text = JSON.stringify(json);
  for (const forbidden of [
    'customer@example.test',
    'Private Customer',
    'admin@example.test',
    'manager@example.test',
    'internal production note',
    'raw compliance notes',
    'Internal alert text',
    'should-not-return',
    'order_sources',
  ]) {
    assert.equal(text.includes(forbidden), false, `${forbidden} leaked`);
  }
  assert.equal(json.pii_returned, false);
  assert.equal(json.raw_payloads_returned, false);
}

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

test('1. Admin auth required.', async () => {
  const result = await invoke({ user: null });
  assert.equal(result.status, 401);
  assert.equal(result.json.writes_performed, false);
});

test('2. Exact ProductionBatch resolves.', async () => {
  const result = await invoke();
  assert.equal(result.status, 200);
  assert.equal(result.json.exact_batch_match_count, 1);
  assert.equal(result.json.batch_parity.batch_id, 'BATCH-G41B-CLEAN');
});

test('3. Exact compliance log resolves.', async () => {
  const result = await invoke();
  assert.equal(result.json.exact_log_match_count, 1);
  assert.equal(result.json.exact_batch_log_match_count, 1);
});

test('4. Missing log classified safely.', async () => {
  const result = await invoke({ data: baseData({ BatchComplianceLog: [] }) });
  assert.equal(result.json.classification, 'compliance_batch_log_missing');
  assert.equal(result.json.native_read_ready, false);
});

test('5. Duplicate log blocks readiness.', async () => {
  const result = await invoke({ data: baseData({ BatchComplianceLog: [complianceLog(), complianceLog({ id: 'bcl_dup' })] }) });
  assert.equal(result.json.classification, 'compliance_duplicate_log_risk');
  assert.equal(result.json.duplicate_log_risk, true);
});

test('6. Incorrect batch linkage blocks readiness.', async () => {
  const result = await invoke({ data: baseData({ BatchComplianceLog: [complianceLog({ source_production_batch_id: 'other_batch', batch_id: 'OTHER-BATCH' })] }) });
  assert.equal(result.json.classification, 'compliance_batch_log_status_mismatch');
});

test('7. Verified/locked batch-log pair is read-ready.', async () => {
  const result = await invoke();
  assert.equal(result.json.classification, 'compliance_native_read_ready');
  assert.equal(result.json.native_read_ready, true);
  assert.equal(result.json.batch_parity.compliance_log_locked, true);
});

test('8. Missing pH result holds.', async () => {
  const result = await invoke({ data: baseData({ ProductionBatch: [batch({ pH_result: undefined })], BatchComplianceLog: [complianceLog({ pH_result: undefined })] }) });
  assert.equal(result.json.classification, 'compliance_ph_result_missing');
});

test('9. pH failure is represented safely.', async () => {
  const result = await invoke({ data: baseData({ ProductionBatch: [batch({ pH_passed_failed: 'failed', passed_failed: 'failed' })], BatchComplianceLog: [complianceLog({ passed_failed: 'failed' })] }) });
  assert.equal(result.json.batch_parity.pH_passed, false);
  assert.equal(result.json.batch_parity.batch_passed, false);
  assertNoUnsafePayload(result.json);
});

test('10. Batch/log pass mismatch holds.', async () => {
  const result = await invoke({ data: baseData({ ProductionBatch: [batch({ passed_failed: 'passed' })], BatchComplianceLog: [complianceLog({ passed_failed: 'failed' })] }) });
  assert.equal(result.json.classification, 'compliance_pass_fail_mismatch');
});

test('11. Status mismatch holds.', async () => {
  const result = await invoke({ data: baseData({ ProductionBatch: [batch({ status: 'in_production' })] }) });
  assert.equal(result.json.classification, 'compliance_batch_log_status_mismatch');
});

test('12. Alert context reported.', async () => {
  const result = await invoke({ data: baseData({ ComplianceAlert: [alert()] }) });
  assert.equal(result.json.classification, 'compliance_alert_context_present');
  assert.equal(result.json.batch_parity.alert_context_count, 1);
});

test('13. Hub context unavailable does not imply parity.', async () => {
  const result = await invoke();
  assert.equal(result.json.hub_fallback_remains_active, true);
  assert.match(result.json.warnings.join('|'), /hub_compliance_context_not_queried_by_g41b_preview/);
});

test('14. Repair/replay evidence holds.', async () => {
  const result = await invoke({ data: baseData({ CommandLog: [command({ status: 'failed', notes: 'repair replay required' })] }) });
  assert.equal(result.json.classification, 'compliance_repair_replay_hold');
});

test('15. Customer-facing status remains unchanged.', async () => {
  const result = await invoke();
  assert.equal(result.json.customer_facing_status_unchanged, true);
  assert.equal(result.json.customer_facing_behavior_changed, false);
});

test('16. Bounded scan uses one read per source.', async () => {
  const result = await invoke({ body: { mode: 'BOUNDED_COMPLIANCE_READINESS_SCAN', production_batch_limit: 100, compliance_log_limit: 100, related_entity_limit: 100 } });
  assert.equal(result.json.source_read_count, 6);
  assert.equal(result.calls.filter(call => call.method === 'list').length, 6);
  assert.deepEqual([...new Set(result.calls.filter(call => call.method === 'list').map(call => call.entity))].sort(), ['BatchComplianceLog', 'CommandLog', 'ComplianceAlert', 'ManualProductionBatch', 'OperationalAlert', 'ProductionBatch'].sort());
});

test('17. Source truncation prevents fleet-wide claims.', async () => {
  const batches = Array.from({ length: 100 }, (_, index) => batch({ id: `pb_${index}`, batch_id: `BATCH-${index}`, compliance_log_id: `bcl_${index}` }));
  const logs = batches.map((row, index) => complianceLog({ id: `bcl_${index}`, batch_id: row.batch_id, source_production_batch_id: row.id }));
  const result = await invoke({ data: baseData({ ProductionBatch: batches, BatchComplianceLog: logs }), body: { mode: 'BOUNDED_COMPLIANCE_READINESS_SCAN', production_batch_limit: 100, compliance_log_limit: 100 } });
  assert.equal(result.json.scan_complete, false);
  assert.equal(result.json.source_truncated.ProductionBatch, true);
});

test('18. No PII/raw notes returned.', async () => {
  const result = await invoke();
  assertNoUnsafePayload(result.json);
});

test('19. No ProductionBatch mutation.', async () => {
  const result = await invoke();
  assert.equal(result.json.production_batch_mutation_performed, false);
  assert.equal(result.writes.some(write => write.entity === 'ProductionBatch'), false);
});

test('20. No BatchComplianceLog mutation.', async () => {
  const result = await invoke();
  assert.equal(result.json.compliance_log_mutation_performed, false);
  assert.equal(result.writes.some(write => write.entity === 'BatchComplianceLog'), false);
});

test('21. No ComplianceAlert creation.', async () => {
  const result = await invoke();
  assert.equal(result.json.compliance_alert_created, false);
  assert.equal(result.writes.some(write => write.entity === 'ComplianceAlert'), false);
});

test('22. No notifications.', async () => {
  const result = await invoke();
  assert.equal(result.json.notifications_sent, false);
});

test('23. No Hub mutation.', async () => {
  const result = await invoke();
  assert.equal(result.json.hub_mutation_performed, false);
  assert.match(source, /hub_fallback_remains_active/);
});

test('24. No customer/order/task mutation.', async () => {
  const result = await invoke();
  assert.equal(result.json.order_mutation_performed, false);
  assert.equal(result.json.native_order_mutation_performed, false);
  assert.equal(result.json.fulfillment_task_mutation_performed, false);
});

test('25. No provider calls.', async () => {
  const result = await invoke();
  assert.equal(result.json.provider_call_impact, false);
  assert.equal(result.json.stripe_calls, false);
  assert.equal(result.json.shopify_calls, false);
});

test('26. No logs/queues created.', async () => {
  const result = await invoke();
  assert.equal(result.json.command_log_created, false);
  assert.equal(result.writes.length, 0);
});

test('Source contains required G41B markers and docs target exists.', () => {
  assert.match(source, /ADMIN_COMPLIANCE_OPERATIONS_READ_PARITY/);
  assert.match(source, /EXACT_COMPLIANCE_RECORD_PARITY/);
  assert.match(source, /BOUNDED_COMPLIANCE_READINESS_SCAN/);
  assert.match(source, /compliance_native_boundary_partially_ready_pending_live_qc_proof/);
  assert.match(source, /saveAdminComplianceRecord/);
  assert.ok(fs.existsSync(docsPath), 'G41B docs file exists');
});

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`\nG41B admin compliance read-parity tests passed (${passed}/${tests.length}).`);
