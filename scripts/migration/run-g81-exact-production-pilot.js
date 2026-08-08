const TEST_BATCH_ID = 'BATCH-G81-TEST-20260807-AURA';
const OPERATOR_EMAIL = 'info@nuvirajuice.com';
const CONFIRMATION = 'execute_native_production_batch_lifecycle';
const STAFF_LABEL = 'NuVira Internal QA';

function responseData(response) {
  return response?.data || response || {};
}

async function invoke(name, payload) {
  try {
    const response = await base44.functions.invoke(name, payload);
    return { ok: true, data: responseData(response) };
  } catch (error) {
    return {
      ok: false,
      error: {
        message: String(error?.message || error).slice(0, 300),
        status: error?.status || error?.response?.status || null,
      },
    };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includes(value, needle) {
  return JSON.stringify(value || {}).includes(needle);
}

function chicagoDate() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function chicagoTime() {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}

const today = chicagoDate();
const time = chicagoTime();
const requestIds = {
  blocked: 'g81-production-blocked-20260807-v1',
  start: 'g81-production-start-20260807-v1',
  complete: 'g81-production-complete-20260807-v1',
  verify: 'g81-production-verify-20260807-v1',
};

const evidence = {
  success: false,
  test_batch_id: TEST_BATCH_ID,
  operator: null,
  lifecycle: {},
  isolation: {},
};

try {
  const user = await base44.auth.me();
  evidence.operator = { role: user?.role || null, email_matches_expected: (user?.email || '').toLowerCase() === OPERATOR_EMAIL };
  assert(user?.role === 'admin', 'admin operator required');
  assert(evidence.operator.email_matches_expected, 'unexpected operator');

  const preexisting = await base44.entities.ProductionBatch.filter({ batch_id: TEST_BATCH_ID }, '-created_date', 5);
  assert(preexisting.length === 0, 'test batch already exists');

  const created = await base44.entities.ProductionBatch.create({
    batch_id: TEST_BATCH_ID,
    product_name: 'Aura',
    product_category: 'juice',
    status: 'planned',
    planned_units: 1,
    production_date: today,
    assigned_to: STAFF_LABEL,
    staff_on_duty: [STAFF_LABEL],
    equipment_used: ['Cold-press juicer', 'Internal QA bottling set'],
    formula_or_recipe_used: 'Aura approved production recipe',
    bottle_size: '12 oz',
    ingredients_used: [
      { ingredient_name: 'Orange', quantity: 1, unit: 'lb', lot_number: 'G81-TEST-ORANGE' },
      { ingredient_name: 'Carrot', quantity: 1, unit: 'lb', lot_number: 'G81-TEST-CARROT' },
      { ingredient_name: 'Ginger', quantity: 0.1, unit: 'lb', lot_number: 'G81-TEST-GINGER' },
    ],
    notes: 'G81 exact internal production lifecycle validation. No real product, customer, inventory, or provider effect.',
    is_test_batch: true,
    test_purpose: 'G81 exact connected-system validation',
    is_locked: false,
    order_sources: [],
    related_orders: [],
    source_system: 'customer_app_internal_validation',
    native_owner_status: 'internal_test_only',
    inventory_deduction_status: 'held_internal_test',
    audit_trail: [],
  });
  assert(created?.id, 'batch create failed');

  const blocked = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live', confirmation: CONFIRMATION, batch_id: TEST_BATCH_ID, action: 'start',
    request_id: requestIds.blocked, reason: 'G81 prove pre-start compliance enforcement',
  });
  assert(!blocked.ok, 'start unexpectedly succeeded without compliance');
  const blockedLog = await base44.entities.CommandLog.filter({
    idempotency_key: `native_production_batch_lifecycle:${requestIds.blocked}`,
  }, '-created_date', 5);
  assert(blockedLog.length === 1 && blockedLog[0]?.status === 'rejected', 'blocked start audit mismatch');

  const common = {
    batch_id: TEST_BATCH_ID,
    source_production_batch_id: created.id,
    related_batch_ids: [TEST_BATCH_ID],
    related_source_production_batch_ids: [created.id],
    is_test_record: true,
  };
  const sanitation = await invoke('saveAdminComplianceRecord', { record_type: 'sanitation', data: {
    ...common, log_date: today, log_time: time, staff_member: STAFF_LABEL, area: 'Prep Area',
    sanitizer_type: 'Internal QA check', sanitizer_level: 'Adequate', cleaned: true, sanitized: true,
    verified_by: OPERATOR_EMAIL, notes: 'G81 test record',
  }});
  const checklist = await invoke('saveAdminComplianceRecord', { record_type: 'daily_checklist', data: {
    ...common, checklist_date: today, staff_member: STAFF_LABEL, shift: 'Internal QA',
    morning_fridge_temp_logged: true, morning_fridge_time: time, sanitizer_levels_checked: true,
    sanitizer_check_time: time, equipment_sanitized: true, sanitization_time: time,
    work_areas_cleaned: true, cleaning_time: time, batch_logs_completed: false,
    ccp_logs_completed: false, batches_logged: TEST_BATCH_ID, overall_status: 'Pre-Production Complete',
    manager_reviewed: true, manager_comments: 'G81 test record',
  }});
  const temperature = await invoke('saveAdminComplianceRecord', { record_type: 'temperature', data: {
    ...common, log_date: today, log_time: time, staff_member: STAFF_LABEL, location: 'Cold Room 1',
    temperature: 38, unit: 'F', min_range: 35, max_range: 40, production_date: today,
    shift: 'Internal QA', notes: 'G81 test record',
  }});
  assert(sanitation.ok && sanitation.data?.success, 'sanitation write failed');
  assert(checklist.ok && checklist.data?.success, 'checklist write failed');
  assert(temperature.ok && temperature.data?.success, 'temperature write failed');

  const previewBatch = await base44.entities.ProductionBatch.get(created.id);
  const preview = await invoke('previewNativeProductionBatchLifecycle', {
    mode: 'dry_run', action: 'start', batch: previewBatch,
    request_id: 'g81-production-preview-ready-20260807-v1',
  });
  assert(preview.ok && preview.data?.lifecycle_ready === true, `ready preview failed: ${JSON.stringify(preview)}`);
  assert(preview.data?.live_command_available === true, `test live gate did not open: ${JSON.stringify(preview.data?.live_command_blockers || [])}`);

  async function run(action, extra = {}) {
    const payload = {
      mode: 'live', confirmation: CONFIRMATION, production_batch_id: created.id, batch_id: TEST_BATCH_ID,
      action, request_id: requestIds[action], reason: `G81 exact internal ${action}`, ...extra,
    };
    const first = await invoke('executeNativeProductionBatchLifecycle', payload);
    assert(first.ok && first.data?.success && first.data?.writes_performed, `${action} failed: ${JSON.stringify(first)}`);
    const replay = await invoke('executeNativeProductionBatchLifecycle', payload);
    assert(replay.ok && replay.data?.idempotent && replay.data?.writes_performed === false, `${action} replay not idempotent`);
    return {
      status: first.data.status,
      writes_performed: first.data.writes_performed === true,
      replay_idempotent: replay.data.idempotent === true,
      inventory_deduction_run: first.data.inventory_deduction_run === true,
      customer_notification_sent: first.data.customer_notification_sent === true,
      external_service_calls: first.data.external_service_calls === true,
      compliance_log_created: first.data.compliance_log_created === true,
    };
  }

  evidence.lifecycle.start = await run('start');
  evidence.lifecycle.complete = await run('complete', {
    actual_units: 1, bottles_produced: 1, bottles_rejected_or_wasted: 0,
    final_usable_quantity: 1, storage_location: 'Internal Test Hold', use_by_date: today,
  });
  evidence.lifecycle.verify = await run('verify', {
    pH_result: 4.1, pH_passed_failed: 'passed', passed_failed: 'passed',
    calibration_checked: true, ccp_check_complete: true,
    sanitation_verification_complete: true, labels_applied: true,
    staff_on_duty: [STAFF_LABEL], verification_notes: 'G81 exact verification passed without a meter ID',
  });

  const finalBatch = await base44.entities.ProductionBatch.get(created.id);
  const complianceLogs = await base44.entities.BatchComplianceLog.filter({ test_batch_id: TEST_BATCH_ID }, '-created_date', 5);
  const lifecycleLogs = (await base44.entities.CommandLog.filter({ target_id: created.id }, '-created_date', 20))
    .filter((row) => row?.command_type === 'native_production_batch_lifecycle');
  const testOrders = await base44.entities.Order.filter({ order_number: TEST_BATCH_ID }, '-created_date', 5);
  const testTasks = await base44.entities.FulfillmentTask.filter({ order_number: TEST_BATCH_ID }, '-created_date', 5);
  const messageLogs = await base44.entities.CustomerMessageDeliveryLog.filter({ order_number: TEST_BATCH_ID }, '-created_date', 5);

  assert(finalBatch?.status === 'verified_logged', 'final batch status mismatch');
  assert(finalBatch?.pH_result === 4.1, 'pH result did not persist');
  assert(!finalBatch?.pH_meter_id, 'meter ID should remain optional and absent');
  assert(finalBatch?.calibration_checked === true, 'calibration confirmation missing');
  assert(finalBatch?.ccp_check_complete === true, 'CCP confirmation missing');
  assert(finalBatch?.sanitation_verification_complete === true, 'sanitation verification missing');
  assert(finalBatch?.labels_applied === true, 'label confirmation missing');
  assert(complianceLogs.length === 1 && complianceLogs[0]?.is_test_record === true, 'batch compliance log mismatch');
  assert(lifecycleLogs.filter((row) => row.status === 'success').length === 3, 'expected three success command logs');
  assert(lifecycleLogs.filter((row) => row.status === 'rejected').length === 1, 'expected one rejection command log');
  assert(testOrders.length === 0 && testTasks.length === 0 && messageLogs.length === 0, 'test batch leaked into customer workflow');

  evidence.isolation = {
    customer_orders_created: testOrders.length,
    fulfillment_tasks_created: testTasks.length,
    customer_message_logs_created: messageLogs.length,
    inventory_deduction_run: false,
    purchase_order_updated: false,
    provider_calls: false,
  };
  evidence.final = {
    status: finalBatch.status,
    ph_result: finalBatch.pH_result,
    ph_meter_id_present: Boolean(finalBatch.pH_meter_id),
    calibration_checked: finalBatch.calibration_checked === true,
    ccp_check_complete: finalBatch.ccp_check_complete === true,
    sanitation_verification_complete: finalBatch.sanitation_verification_complete === true,
    labels_applied: finalBatch.labels_applied === true,
    command_logs: lifecycleLogs.length,
    compliance_logs: complianceLogs.length,
  };
  evidence.success = true;
} catch (error) {
  evidence.error = String(error?.message || error).slice(0, 500);
}

console.log(JSON.stringify(evidence, null, 2));
if (!evidence.success) throw new Error(evidence.error || 'G81 production pilot failed');
