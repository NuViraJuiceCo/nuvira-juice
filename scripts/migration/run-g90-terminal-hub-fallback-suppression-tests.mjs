#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const functionPath = path.join(
  repoRoot,
  'base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionQueueSummary/entry.ts',
);

function loadHandler(hubBatches) {
  let source = fs.readFileSync(functionPath, 'utf8')
    .replace(/^import .*$/gm, '')
    .replaceAll('req: Request', 'req')
    .replace('export default async function handler(req)', 'async function handler(req)');
  source += '\nglobalThis.__handler = handler;\n';

  const context = vm.createContext({
    console,
    Date,
    Intl,
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
    URLSearchParams,
    createClientFromRequest: req => req.__base44,
    fetch: async url => {
      assert.match(url, /^https:\/\/hub\.example\.test\/functions\/getProductionQueueSummaryForCustomerApp\?/);
      return Response.json({
        success: true,
        date_from: '2026-08-04',
        date_to: '2026-08-07',
        batches: hubBatches,
        truncated: false,
      });
    },
    Deno: {
      env: {
        get: key => ({
          HUB_API_URL: 'https://hub.example.test',
          CUSTOMER_APP_SYNC_SECRET: 'synthetic-secret',
        })[key] || '',
      },
      serve: () => {},
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename: functionPath });
  return context.globalThis.__handler;
}

function nativeBatch() {
  return {
    id: 'native_re_nu',
    batch_id: 'BATCH-20260807-RE-NU',
    production_date: '2026-08-07',
    product_name: 'Re-Nu',
    status: 'planned',
    planned_units: 1,
    order_sources: [{ order_number: 'NV-NATIVE-CURRENT', quantity: 1, source_type: 'customer_app' }],
  };
}

function staleHubBatch(index) {
  return {
    id: `hub_stale_${index}`,
    batch_id: `BATCH-20260804-STALE-${index}`,
    production_date: '2026-08-04',
    product_name: `Synthetic product ${index}`,
    status: 'planned',
    planned_units: 1,
    order_count: 1,
    order_numbers: ['NV-TERMINAL'],
  };
}

function base44({ lifecycleAvailable = true } = {}) {
  const entities = {
    ProductionBatch: { list: async () => [nativeBatch()] },
  };
  if (lifecycleAvailable) {
    entities.Order = { list: async () => [{ order_number: 'NV-TERMINAL', status: 'delivered' }] };
    entities.FulfillmentTask = { list: async () => [
      { order_number: 'NV-TERMINAL', status: 'delivered' },
      { order_number: 'NV-TERMINAL', delivery_status: 'delivered' },
    ] };
  }
  return {
    auth: { me: async () => ({ id: 'synthetic-admin', role: 'admin' }) },
    asServiceRole: { entities },
  };
}

async function invoke(hubBatches, options = {}) {
  const handler = loadHandler(hubBatches);
  const response = await handler({
    __base44: base44(options),
    json: async () => ({
      date_from: '2026-08-04',
      date_to: '2026-08-07',
      limit: 20,
    }),
  });
  return { status: response.status, payload: await response.json() };
}

const staleRows = [1, 2, 3, 4].map(staleHubBatch);
const duplicateNativeHubRow = {
  id: 'hub_native_duplicate',
  batch_id: 'BATCH-20260807-RE-NU',
  production_date: '2026-08-07',
  product_name: 'Re-Nu',
  status: 'planned',
  order_numbers: ['NV-NATIVE-CURRENT'],
};

{
  const { status, payload } = await invoke([...staleRows, duplicateNativeHubRow]);
  assert.equal(status, 200);
  assert.equal(payload.count, 1);
  assert.equal(payload.batches[0].source, 'customer_app_native');
  assert.equal(payload.data_sources.hub_fallback_batch_count, 0);
  assert.equal(payload.data_sources.stale_terminal_hub_batch_count, 4);
  assert.equal(payload.data_sources.native_terminal_lifecycle_available, true);
  assert.equal(payload.data_sources.live_actions_source, 'customer_app_native');
  assert.ok(payload.warnings.includes('stale_terminal_hub_batches_suppressed'));
}

{
  const activeHubRow = {
    id: 'hub_active',
    batch_id: 'BATCH-20260807-ACTIVE',
    production_date: '2026-08-07',
    product_name: 'Active synthetic product',
    status: 'planned',
    order_numbers: ['NV-ACTIVE'],
  };
  const { payload } = await invoke([...staleRows, activeHubRow]);
  assert.equal(payload.data_sources.hub_fallback_batch_count, 1);
  assert.equal(payload.data_sources.live_actions_source, 'customer_app_native_with_hub_fallback');
  assert.equal(payload.batches.some(row => row.batch_id === activeHubRow.batch_id), true);
}

{
  const { payload } = await invoke(staleRows, { lifecycleAvailable: false });
  assert.equal(payload.data_sources.native_terminal_lifecycle_available, false);
  assert.equal(payload.data_sources.stale_terminal_hub_batch_count, 0);
  assert.equal(payload.data_sources.hub_fallback_batch_count, 4);
  assert.ok(payload.warnings.includes('native_order_lifecycle_entity_unavailable'));
}

console.log(JSON.stringify({
  ok: true,
  suite: 'g90-terminal-hub-fallback-suppression',
  checks: 16,
  writes_performed: false,
  customer_notifications_sent: false,
  provider_calls_performed: false,
}, null, 2));
