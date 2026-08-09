#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const functionPath = path.join(root, 'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminComplianceOpsSummary/entry.ts');
const DATE = '2026-08-07';
const results = [];

function loadHandler({ env = {}, hubData = {}, hubStatus = 200 } = {}) {
  let fetchCount = 0;
  let source = fs.readFileSync(functionPath, 'utf8');
  source = source.replace(/^import .*$/gm, '');
  source = source.replace('export default async function handler(req: Request)', 'globalThis.__handler = async function handler(req)');
  const context = vm.createContext({
    console, URL, URLSearchParams, Date, Math, Number, String, Boolean, Array, Object,
    Set, Map, RegExp, JSON, Error, Response, Promise, Intl,
    createClientFromRequest: req => req.__base44,
    fetch: async () => {
      fetchCount += 1;
      return new Response(JSON.stringify(hubData), { status: hubStatus });
    },
    Deno: { env: { get: key => env[key] || '' } },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return { handler: context.globalThis.__handler, getFetchCount: () => fetchCount };
}

function makeBase44({ role = 'admin', rows = {} } = {}) {
  const writes = [];
  const entityNames = [
    'TemperatureLog', 'pHLog', 'CCPLog', 'SanitationLog', 'DailyChecklist',
    'CorrectiveActionLog', 'BatchComplianceLog', 'ComplianceAlert', 'ComplianceLog',
    'LabelAllergenReview', 'HACCPPlanReview', 'ComplianceDoc', 'ProductionBatch',
  ];
  const entities = Object.fromEntries(entityNames.map(name => [name, {
    list: async (_sort, limit = 500) => (rows[name] || []).slice(0, limit),
    create: async payload => { writes.push({ name, action: 'create', payload }); throw new Error('unexpected write'); },
    update: async (id, payload) => { writes.push({ name, action: 'update', id, payload }); throw new Error('unexpected write'); },
    delete: async id => { writes.push({ name, action: 'delete', id }); throw new Error('unexpected write'); },
  }]));
  return {
    writes,
    base44: {
      auth: { me: async () => ({ id: 'synthetic_admin', role }) },
      asServiceRole: { entities },
    },
  };
}

async function invoke({ role = 'admin', rows = {}, body = {}, hubData = {}, hubStatus = 200, configured = true } = {}) {
  const { base44, writes } = makeBase44({ role, rows });
  const { handler, getFetchCount } = loadHandler({
    env: configured ? { HUB_API_URL: 'https://hub.example.test', CUSTOMER_APP_SYNC_SECRET: 'synthetic-secret' } : {},
    hubData,
    hubStatus,
  });
  const response = await handler({
    method: 'POST',
    __base44: base44,
    json: async () => ({ date_from: DATE, date_to: DATE, ...body }),
  });
  return { status: response.status, payload: await response.json(), writes, fetchCount: getFetchCount() };
}

const nativeRows = {
  TemperatureLog: [{ id: 'temp_1', log_date: DATE, temperature: 38, within_range: true, location: 'Cold storage' }],
  SanitationLog: [{ id: 'san_1', log_date: DATE, cleaned: true, sanitized: true, area: 'Prep' }],
  DailyChecklist: [{ id: 'daily_1', checklist_date: DATE, overall_status: 'Complete', batch_logs_completed: true }],
  BatchComplianceLog: [{ id: 'batch_log_1', batch_id: 'BATCH-NATIVE', date: DATE, product_name: 'Orange Juice', quantity_produced: 4, passed_failed: 'passed' }],
  ProductionBatch: [{ id: 'batch_1', batch_id: 'BATCH-NATIVE', production_date: DATE, product_name: 'Orange Juice', planned_units: 4, status: 'completed' }],
};

const hubData = {
  success: true,
  read_only: true,
  summary: { temperature: 900, sanitation: 800, production_batches: 700 },
  recent_logs: [{ id: 'hub_log', date: DATE, product_name: 'Must not enter operational records' }],
  attention_batches: [{ id: 'hub_batch', production_date: DATE }],
};

const normal = await invoke({ rows: nativeRows, hubData });
assert.equal(normal.status, 200);
assert.equal(normal.fetchCount, 0);
assert.equal(normal.payload.source, 'customer_app_native_compliance_authoritative');
assert.equal(normal.payload.hub_operational_dependency, false);
assert.equal(normal.payload.hub_fallback_used, false);
assert.equal(normal.payload.summary.temperature, 1);
assert.equal(normal.payload.summary.sanitation, 1);
assert.equal(normal.payload.summary.production_batches, 1);
assert.equal(normal.payload.native.records.batch_compliance.length, 1);
assert.equal(normal.writes.length, 0);
results.push('default_compliance_read_is_native_authoritative_without_hub_fetch');
results.push('native_compliance_counts_and_records_remain_operational_truth');
results.push('native_compliance_read_performs_no_writes');

const historical = await invoke({ rows: nativeRows, hubData, body: { include_hub_historical_context: true } });
assert.equal(historical.fetchCount, 1);
assert.equal(historical.payload.hub_historical_context_available, true);
assert.equal(historical.payload.hub_historical_context_summary.temperature, 900);
assert.equal(historical.payload.summary.temperature, 1);
assert.equal(historical.payload.native.records.batch_compliance.length, 1);
assert.equal(JSON.stringify(historical.payload).includes('Must not enter operational records'), false);
assert.equal(JSON.stringify(historical.payload).includes('hub_batch'), false);
results.push('hub_history_requires_an_explicit_flag');
results.push('hub_historical_counts_cannot_change_operational_totals');
results.push('hub_historical_rows_never_enter_native_compliance_records');

const unavailable = await invoke({ rows: nativeRows, configured: false, body: { include_hub_historical_context: true } });
assert.equal(unavailable.status, 200);
assert.equal(unavailable.fetchCount, 0);
assert.equal(unavailable.payload.summary.temperature, 1);
assert.equal(unavailable.payload.hub_historical_context_available, false);
results.push('missing_hub_history_configuration_does_not_degrade_native_compliance');

const failedHistory = await invoke({ rows: nativeRows, hubData: { error: 'synthetic' }, hubStatus: 503, body: { include_hub_historical_context: true } });
assert.equal(failedHistory.status, 200);
assert.equal(failedHistory.payload.summary.production_batches, 1);
assert.equal(failedHistory.payload.hub_fallback_used, false);
results.push('failed_hub_history_read_does_not_activate_operational_fallback');

const internalRows = {
  TemperatureLog: [{ id: 'temp_test', log_date: DATE, is_test_record: true, test_batch_id: 'BATCH-G53-TEST-1', temperature: 38 }],
  ProductionBatch: [{ id: 'batch_test', batch_id: 'BATCH-G53-TEST-1', production_date: DATE, is_test_batch: true }],
};
const excluded = await invoke({ rows: internalRows });
assert.equal(excluded.payload.summary.temperature, 0);
assert.equal(excluded.payload.summary.production_batches, 0);
const only = await invoke({ rows: internalRows, body: { test_record_mode: 'only' } });
assert.equal(only.fetchCount, 0);
assert.equal(only.payload.summary.temperature, 1);
assert.equal(only.payload.summary.production_batches, 1);
results.push('operational_compliance_excludes_internal_test_records');
results.push('internal_test_compliance_read_remains_native_and_isolated');

const forbidden = await invoke({ role: 'customer', rows: nativeRows });
assert.equal(forbidden.status, 403);
results.push('non_admin_compliance_read_is_forbidden');

const serialized = JSON.stringify(normal.payload);
for (const marker of ['customer_email', 'customer_phone', 'provider_payload', 'payment_payload', 'raw_payload']) {
  assert.equal(serialized.includes(marker), false);
}
assert.equal(normal.payload.provider_calls_performed, false);
assert.equal(normal.payload.customer_notifications_sent, false);
assert.equal(normal.payload.hub_mutation_performed, false);
results.push('response_excludes_customer_and_provider_payload_fields');
results.push('compliance_authority_read_has_no_provider_notification_or_hub_side_effect');

console.log(JSON.stringify({
  success: true,
  suite: 'g94-customer-app-compliance-authority',
  cases: results.length,
  results,
  writes_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
  hub_mutation_performed: false,
}, null, 2));
