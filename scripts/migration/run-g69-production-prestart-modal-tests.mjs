#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const productionDate = '2026-08-07';
const batch = { id: 'pb_g69', batch_id: 'BATCH-20260807-OASIS', production_date: productionDate, is_test_batch: false };

function loadHandler(relativePath) {
  const filename = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(filename, 'utf8').replace(/^import .*$/gm, '');
  const context = vm.createContext({
    console,
    Date,
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
    createClientFromRequest: req => req.__base44,
    Deno: {
      env: { get: () => undefined },
      serve: handler => { context.globalThis.__handler = handler; },
    },
    globalThis: {},
  });
  vm.runInContext(source, context, { filename });
  return context.globalThis.__handler;
}

function entityApi(rows, writes, name) {
  return {
    get: async id => rows.find(row => row.id === id) || null,
    filter: async filter => rows.filter(row => Object.entries(filter).every(([key, value]) => row[key] === value)),
    update: async (id, patch) => {
      writes.push({ name, id, patch });
      const row = rows.find(item => item.id === id);
      Object.assign(row, patch);
      return row;
    },
  };
}

function makeBase44({ sanitation = [], checklists = [], temperatures = [], productionBatch = batch } = {}) {
  const writes = [];
  const rows = {
    ProductionBatch: [productionBatch],
    SanitationLog: sanitation,
    DailyChecklist: checklists,
    TemperatureLog: temperatures,
  };
  return {
    writes,
    base44: {
      auth: { me: async () => ({ role: 'admin', email: 'admin@example.test' }) },
      asServiceRole: { entities: Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, entityApi(values, writes, name)])) },
    },
  };
}

function linkedFields() {
  return { source_production_batch_id: batch.id, batch_id: batch.batch_id, is_test_record: false };
}

function readyRows({ linked = true } = {}) {
  const links = linked ? linkedFields() : { is_test_record: false };
  return {
    sanitation: [{ id: 'san_g69', log_date: productionDate, ...links, cleaned: true, sanitized: true, sanitizer_level: 'Adequate' }],
    checklists: [{ id: 'check_g69', checklist_date: productionDate, ...links, overall_status: 'Pre-Production Complete', morning_fridge_temp_logged: true, sanitizer_levels_checked: true, equipment_sanitized: true, work_areas_cleaned: true }],
    temperatures: [{ id: 'temp_g69', log_date: productionDate, ...links, temperature: 38, within_range: true }],
  };
}

async function call(handler, base44, body) {
  const response = await handler({ method: 'POST', __base44: base44, json: async () => body });
  return { status: response.status, payload: await response.json() };
}

const statusHandler = loadHandler('base44/functions/getAdminProductionQueueSummary/entry.ts');
const linkHandler = loadHandler('base44/functions/saveAdminComplianceRecord/entry.ts');

{
  const store = makeBase44(readyRows());
  const { status, payload } = await call(statusHandler, store.base44, { action: 'pre_start_status', production_batch_id: batch.id, batch_id: batch.batch_id, production_date: productionDate });
  assert.equal(status, 200);
  assert.equal(payload.ready, true);
  assert.equal(payload.items.every(item => item.ready && item.match_scope === 'batch_linked'), true);
  assert.equal(store.writes.length, 0);
}

{
  const store = makeBase44(readyRows({ linked: false }));
  const { status, payload } = await call(statusHandler, store.base44, { action: 'pre_start_status', production_batch_id: batch.id, batch_id: batch.batch_id, production_date: productionDate });
  assert.equal(status, 200);
  assert.equal(payload.ready, false);
  assert.equal(payload.items.every(item => item.reusable_same_day_record && item.reusable_record_id), true);
  assert.equal(store.writes.length, 0);
}

{
  const records = readyRows({ linked: false });
  const store = makeBase44(records);
  const { status, payload } = await call(linkHandler, store.base44, {
    action: 'link_pre_start_record',
    production_batch_id: batch.id,
    batch_id: batch.batch_id,
    production_date: productionDate,
    record_type: 'sanitation',
    record_id: records.sanitation[0].id,
  });
  assert.equal(status, 200);
  assert.equal(payload.success, true);
  assert.equal(store.writes.length, 1);
  assert.deepEqual(Array.from(store.writes[0].patch.related_batch_ids), [batch.batch_id]);
  assert.deepEqual(Array.from(store.writes[0].patch.related_source_production_batch_ids), [batch.id]);
}

{
  const records = readyRows({ linked: false });
  records.temperatures[0].log_date = '2026-08-06';
  const store = makeBase44(records);
  const { status, payload } = await call(linkHandler, store.base44, {
    action: 'link_pre_start_record',
    production_batch_id: batch.id,
    batch_id: batch.batch_id,
    production_date: productionDate,
    record_type: 'temperature',
    record_id: records.temperatures[0].id,
  });
  assert.equal(status, 409);
  assert.equal(payload.error, 'record_date_does_not_match_batch');
  assert.equal(store.writes.length, 0);
}

const modalSource = fs.readFileSync(path.join(repoRoot, 'src/components/admin/ProductionPreStartModal.jsx'), 'utf8');
assert.ok(modalSource.includes("setView('overview');"));
assert.ok(modalSource.includes('Choose the next missing item.'));
assert.ok(modalSource.includes("Use today's log"));
assert.ok(modalSource.includes('Continue to Start Preview'));
assert.equal(modalSource.includes('Promise.all'), false);

console.log(JSON.stringify({
  ok: true,
  suite: 'g69-production-prestart-modal',
  cases: 9,
  writes_performed: false,
  live_calls_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
