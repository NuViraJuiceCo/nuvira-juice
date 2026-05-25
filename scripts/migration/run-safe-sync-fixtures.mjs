#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const fixturePath = path.join(repoRoot, 'docs/migration/fixtures/safe-sync-order-update/fixtures.json');
const plannerPath = path.join(repoRoot, 'base44/functions/previewNativeSafeSyncOrderUpdate/entry.ts');

function loadPlanner() {
  const source = fs.readFileSync(plannerPath, 'utf8');
  const plannerOnly = source.split('Deno.serve')[0] + '\nglobalThis.__planSafeSync = planSafeSync;\n';
  const context = vm.createContext({ console, globalThis: {} });
  vm.runInContext(plannerOnly, context, { filename: plannerPath });
  return context.globalThis.__planSafeSync;
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function isSubset(expected, actual) {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return false;
    return expected.every((item, index) => isSubset(item, actual[index]));
  }
  if (isObject(expected)) {
    if (!isObject(actual)) return false;
    return Object.entries(expected).every(([key, value]) => isSubset(value, actual[key]));
  }
  return Object.is(expected, actual);
}

function assertFixture(fixture, result) {
  const failures = [];
  const expected = fixture.expected || {};

  for (const key of ['action', 'would_create_order', 'would_update_order', 'would_quarantine', 'would_reject', 'error_code', 'response_status']) {
    if (key in expected && !Object.is(result[key], expected[key])) {
      failures.push(`${key}: expected ${JSON.stringify(expected[key])}, got ${JSON.stringify(result[key])}`);
    }
  }

  for (const field of expected.accepted_fields_include || []) {
    if (!(field in (result.accepted_fields || {}))) failures.push(`accepted_fields missing ${field}`);
  }

  for (const field of expected.rejected_fields_include || []) {
    if (!(field in (result.rejected_fields || {}))) failures.push(`rejected_fields missing ${field}`);
  }

  if ('order_review_queue_incident_type' in expected) {
    const actualIncident = result.order_review_queue_draft?.incident_type || null;
    if (actualIncident !== expected.order_review_queue_incident_type) {
      failures.push(`queue incident: expected ${expected.order_review_queue_incident_type}, got ${actualIncident}`);
    }
  }

  if (expected.proposed_order_state_include && !isSubset(expected.proposed_order_state_include, result.proposed_order_state || {})) {
    failures.push('proposed_order_state_include did not match');
  }

  for (const warning of expected.warnings_include || []) {
    if (!(result.warnings || []).includes(warning)) failures.push(`warnings missing ${warning}`);
  }

  if (expected.untouched?.includes('FulfillmentTask') && result.fulfillment_task_draft) {
    failures.push('unexpected FulfillmentTask draft present');
  }
  if (expected.untouched?.includes('ProductionBatch') && result.production_batch_draft) {
    failures.push('unexpected ProductionBatch draft present');
  }

  return failures;
}

const fixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const planSafeSync = loadPlanner();

let failed = 0;
for (const fixture of fixtures) {
  const result = planSafeSync({
    fixture_id: fixture.fixture_id,
    starting_order: fixture.starting_order,
    incoming_payload: fixture.incoming_payload,
    source: fixture.source,
    idempotency_key: fixture.idempotency_key,
    stripe_event_id: fixture.stripe_event_id,
    mode: 'dry_run',
  });
  const failures = assertFixture(fixture, result);
  if (failures.length > 0) {
    failed += 1;
    console.error(`FAIL ${fixture.fixture_id}`);
    for (const failure of failures) console.error(`  - ${failure}`);
  } else {
    console.log(`PASS ${fixture.fixture_id}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${fixtures.length} safeSync fixtures failed.`);
  process.exit(1);
}

console.log(`\n${fixtures.length}/${fixtures.length} safeSync fixtures passed.`);

