#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const productionDate = '2026-08-07';
const batch = {
  id: 'pb_g69',
  batch_id: 'BATCH-20260807-OASIS',
  product_name: 'Pineapple Juice',
  production_date: productionDate,
  planned_units: 4,
  status: 'planned',
  is_test_batch: false,
  staff_on_duty: ['Admin'],
  equipment_used: ['Juicer'],
  formula_or_recipe_used: 'Oasis standard recipe',
  bottle_size: '12 oz',
  ingredients_used: [{ ingredient_name: 'Pineapple', quantity: 10, unit: 'oz', lot_number: 'LOT-G69' }],
};

function loadHandler(relativePath) {
  const filename = path.join(repoRoot, relativePath);
  let source = fs.readFileSync(filename, 'utf8')
    .replace(/^import .*$/gm, '')
    .replace('export default async function handler(req: Request)', 'globalThis.__handler = async function handler(req)');
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
    Recipe: [{ id: 'recipe_g69', product_name: 'Pineapple Juice', bottle_size_oz: 32, is_active: true, ingredients: [{ ingredient_name: 'Pineapple', quantity_oz: 32, unit: 'oz' }] }],
    Product: [{ id: 'product_g69', title: 'Pineapple Juice', size: '32oz / 946ml' }],
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

const statusHandler = loadHandler('base44/functions/getAdminOperationsDashboardSummary/handlers/getAdminProductionQueueSummary/entry.ts');
const linkHandler = loadHandler('base44/functions/getAdminOperationsDashboardSummary/handlers/saveAdminComplianceRecord/entry.ts');

{
  const store = makeBase44(readyRows());
  const { status, payload } = await call(statusHandler, store.base44, { action: 'pre_start_status', production_batch_id: batch.id, batch_id: batch.batch_id, production_date: productionDate });
  assert.equal(status, 200);
  assert.equal(payload.ready, true);
  assert.equal(payload.items.length, 4);
  assert.equal(payload.items.every(item => item.ready), true);
  assert.equal(payload.items.find(item => item.key === 'batch_setup')?.match_scope, 'production_batch');
  assert.equal(payload.batch_defaults.bottle_size, '12 oz');
  assert.equal(payload.batch_defaults.recipe_planned_ingredients[0].quantity, 128);
  assert.equal(payload.batch_defaults.ingredient_quantity_variances[0].recorded_quantity, 10);
  assert.equal(payload.batch_defaults.ingredient_quantity_variances[0].planned_quantity, 128);
  assert.equal(store.writes.length, 0);
}

{
  const noSetupBatch = {
    id: batch.id,
    batch_id: batch.batch_id,
    product_name: batch.product_name,
    production_date: productionDate,
    planned_units: 4,
    status: 'planned',
  };
  const store = makeBase44({ productionBatch: noSetupBatch });
  const { payload } = await call(statusHandler, store.base44, { action: 'pre_start_status', production_batch_id: batch.id, batch_id: batch.batch_id, production_date: productionDate });
  assert.equal(payload.batch_defaults.bottle_size, '32 oz');
  assert.equal(payload.batch_defaults.bottle_size_source, 'recipe');
  assert.equal(payload.batch_defaults.ingredients_used[0].ingredient_name, 'Pineapple');
  assert.equal(payload.batch_defaults.ingredients_used[0].quantity, 128);
  assert.equal(payload.batch_defaults.measured_pH_must_be_entered, true);
}

{
  const store = makeBase44(readyRows({ linked: false }));
  const { status, payload } = await call(statusHandler, store.base44, { action: 'pre_start_status', production_batch_id: batch.id, batch_id: batch.batch_id, production_date: productionDate });
  assert.equal(status, 200);
  assert.equal(payload.ready, false);
  assert.equal(payload.items.filter(item => item.key !== 'batch_setup').every(item => item.reusable_same_day_record && item.reusable_record_id), true);
  assert.equal(payload.items.find(item => item.key === 'batch_setup')?.ready, true);
  assert.equal(store.writes.length, 0);
}

{
  const incompleteBatch = {
    id: batch.id,
    batch_id: batch.batch_id,
    production_date: productionDate,
    status: 'planned',
    is_test_batch: false,
  };
  const store = makeBase44({ productionBatch: incompleteBatch });
  const { status, payload } = await call(linkHandler, store.base44, {
    action: 'save_production_batch_setup',
    production_batch_id: batch.id,
    batch_id: batch.batch_id,
    data: {
      staff_on_duty: ['Admin'],
      equipment_used: ['Juicer', 'Scale'],
      formula_or_recipe_used: 'Oasis standard recipe',
      bottle_size: '12 oz',
      ingredients_used: [{ ingredient_name: 'Watermelon', quantity: 10, unit: 'lb', lot_number: 'LOT-G69' }],
      ingredient_lot_notes: 'Supplier lot verified.',
    },
  });
  assert.equal(status, 200);
  assert.equal(payload.success, true);
  assert.equal(store.writes.length, 1);
  assert.equal(store.writes[0].name, 'ProductionBatch');
  assert.equal(store.writes[0].patch.ingredients_used[0].lot_number, 'LOT-G69');
  assert.equal(store.writes[0].patch.ingredient_usage_status, 'recorded_pending_deduction');
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
const cssSource = fs.readFileSync(path.join(repoRoot, 'src/index.css'), 'utf8');
const productionSource = fs.readFileSync(path.join(repoRoot, 'src/pages/admin/ProductionQueueSummary.jsx'), 'utf8');
assert.ok(modalSource.includes("setView('overview');"));
assert.ok(modalSource.includes('Choose the next missing item.'));
assert.ok(modalSource.includes("Use today's log"));
assert.ok(modalSource.includes('Continue to Start Preview'));
assert.ok(modalSource.includes("action: 'save_production_batch_setup'"));
assert.ok(modalSource.includes('Measured pH and final quality checks are recorded after production in Verify'));
assert.ok(modalSource.includes('Recipe defaults are loaded automatically'));
assert.ok(modalSource.includes('Review setup'));
assert.ok(modalSource.includes('Recipe plan for'));
assert.ok(modalSource.includes('the recorded amount differs from the recipe plan'));
assert.ok(modalSource.includes('max-h-[calc(100dvh-2rem)]'));
assert.ok(modalSource.includes('min-h-0 flex-1 space-y-4 overflow-y-auto'));
assert.ok(cssSource.includes('[data-scroll] {'));
assert.equal(productionSource.includes('pH meter ID'), false);
assert.ok(productionSource.includes('pH meter calibration checked'));
assert.ok(productionSource.includes('CCP monitoring complete'));
assert.ok(productionSource.includes('The system never invents a pH value or pass/fail result.'));
assert.ok(productionSource.includes('Check ${formatLabel(activeAction)} Readiness'));
const genericOverflowGroup = cssSource.match(/\[data-scroll\],\s*\.overflow-y-auto[\s\S]*?\}/)?.[0] || '';
assert.equal(genericOverflowGroup.includes('transform:'), false);
assert.equal(modalSource.includes('Promise.all'), false);

console.log(JSON.stringify({
  ok: true,
  suite: 'g69-production-prestart-modal',
  cases: 34,
  writes_performed: false,
  live_calls_performed: false,
  provider_calls_performed: false,
  customer_notifications_sent: false,
}, null, 2));
