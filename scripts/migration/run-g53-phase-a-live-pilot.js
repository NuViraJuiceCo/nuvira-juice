const TEST_BATCH_ID = 'BATCH-G53-TEST-20260723-AURA';
const EXPECTED_OPERATOR = 'info@nuvirajuice.com';
const CONFIRMATION = 'execute_native_production_batch_lifecycle';
const TEST_PURPOSE = 'G53 controlled live persistence validation';
const STAFF_LABEL = 'NuVira G53 Internal QA';

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

function responseData(response) {
  return response?.data || response || {};
}

function safeError(error) {
  return {
    name: error?.name || 'Error',
    message: (error?.message || String(error)).slice(0, 300),
    status: error?.status || error?.response?.status || null,
    code: error?.code || null,
  };
}

async function invoke(name, payload) {
  try {
    const response = await base44.functions.invoke(name, payload);
    return { ok: true, data: responseData(response), error: null };
  } catch (error) {
    return { ok: false, data: null, error: safeError(error) };
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesText(value, text) {
  return JSON.stringify(value || {}).includes(text);
}

function summarizeQueue(data) {
  const batches = Array.isArray(data?.batches) ? data.batches : [];
  return {
    count: batches.length,
    statuses: batches.reduce((acc, batch) => {
      const status = batch?.status || batch?.current_status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {}),
    contains_test_batch: includesText(data, TEST_BATCH_ID),
    test_batch_mode: data?.test_batch_mode || null,
    operational_totals_exclude_test_batches: data?.operational_totals_exclude_test_batches === true,
  };
}

function summarizeCompliance(data) {
  return {
    counts: data?.counts || data?.summary || data?.native?.counts || {},
    contains_test_batch: includesText(data, TEST_BATCH_ID),
    test_record_mode: data?.test_record_mode || data?.native?.test_record_mode || null,
    operational_totals_exclude_test_records:
      data?.operational_totals_exclude_test_records === true ||
      data?.native?.operational_totals_exclude_test_records === true,
  };
}

function summarizeOperations(data) {
  return {
    summary: data?.summary || null,
    native_ops_health_overlay: data?.native_ops_health_overlay || null,
    contains_test_batch: includesText(data, TEST_BATCH_ID),
  };
}

const generatedAt = new Date();
const pilotWindowEnd = new Date(generatedAt.getTime() + 60 * 60 * 1000);
const today = chicagoDate();
const time = chicagoTime();
const requestIds = {
  blocked_start: 'g53-phase-a-start-blocked-20260723-v1',
  start: 'g53-phase-a-start-20260723-v1',
  complete: 'g53-phase-a-complete-20260723-v1',
  verify: 'g53-phase-a-verify-20260723-v1',
};

const evidence = {
  success: false,
  classification: 'phase_a_live_pilot_in_progress',
  generated_at_utc: generatedAt.toISOString(),
  pilot_window: {
    start_utc: generatedAt.toISOString(),
    end_utc: pilotWindowEnd.toISOString(),
    timezone: 'America/Chicago',
  },
  rollback_owner: 'NuVira owner authorization; executing admin info@nuvirajuice.com',
  test_batch_id: TEST_BATCH_ID,
  operator: null,
  baseline: null,
  creation: null,
  blocked_start: null,
  compliance_writes: null,
  ready_preview: null,
  lifecycle: null,
  verification: null,
  safety: {
    customer_order_mutations: false,
    customer_notifications_sent: false,
    provider_calls_performed: false,
    inventory_mutations_performed: false,
    refunds_performed: false,
    subscription_changes_performed: false,
    bulk_sync_performed: false,
  },
};

try {
  const user = await base44.auth.me();
  evidence.operator = {
    email: user?.email || null,
    role: user?.role || null,
  };
  assert(user?.role === 'admin', 'G53 pilot requires an admin operator');
  assert((user?.email || '').toLowerCase() === EXPECTED_OPERATOR, 'G53 pilot operator does not match approval');

  const preexisting = await base44.entities.ProductionBatch.filter(
    { batch_id: TEST_BATCH_ID },
    '-created_date',
    5,
  );
  assert(Array.isArray(preexisting) && preexisting.length === 0, 'G53 test batch already exists; refusing duplicate creation');

  const [baselineQueueCall, baselineComplianceCall, baselineOperationsCall] = await Promise.all([
    invoke('getAdminProductionQueueSummary', {
      date_from: today,
      date_to: today,
      limit: 100,
      test_batch_mode: 'exclude',
    }),
    invoke('getAdminComplianceOpsSummary', {
      date_from: today,
      date_to: today,
      test_record_mode: 'exclude',
    }),
    invoke('getAdminOperationsDashboardSummary', { preset: 'today' }),
  ]);
  assert(baselineQueueCall.ok && baselineComplianceCall.ok && baselineOperationsCall.ok, 'Unable to capture read-only operational baseline');
  evidence.baseline = {
    queue: summarizeQueue(baselineQueueCall.data),
    compliance: summarizeCompliance(baselineComplianceCall.data),
    operations: summarizeOperations(baselineOperationsCall.data),
  };
  assert(evidence.baseline.queue.contains_test_batch === false, 'Test batch unexpectedly present in baseline queue');
  assert(evidence.baseline.compliance.contains_test_batch === false, 'Test batch unexpectedly present in baseline compliance');
  assert(evidence.baseline.operations.contains_test_batch === false, 'Test batch unexpectedly present in baseline operations');

  const created = await base44.entities.ProductionBatch.create({
    batch_id: TEST_BATCH_ID,
    product_name: 'Aura',
    product_category: 'juice',
    status: 'planned',
    planned_units: 1,
    production_date: today,
    assigned_to: STAFF_LABEL,
    notes: 'Internal G53 live-persistence pilot. Excluded from all operational totals and customer workflows.',
    is_test_batch: true,
    test_purpose: TEST_PURPOSE,
    is_locked: false,
    order_sources: [],
    related_orders: [],
    source_system: 'customer_app_internal_validation',
    native_owner_status: 'internal_test_only',
    inventory_deduction_status: 'held_internal_test',
  });
  assert(created?.id, 'ProductionBatch creation did not return an id');
  evidence.creation = {
    production_batch_id: created.id,
    batch_id: created.batch_id,
    status: created.status,
    planned_units: created.planned_units,
    is_test_batch: created.is_test_batch === true,
    source_system: created.source_system,
    native_owner_status: created.native_owner_status,
    inventory_deduction_status: created.inventory_deduction_status,
  };
  assert(evidence.creation.batch_id === TEST_BATCH_ID, 'Created batch id mismatch');
  assert(evidence.creation.is_test_batch, 'Created batch is missing formal test marker');
  assert(evidence.creation.status === 'planned', 'Created batch did not persist as planned');

  const blockedPreview = await invoke('previewNativeProductionBatchLifecycle', {
    mode: 'dry_run',
    action: 'start',
    batch: created,
    request_id: 'g53-phase-a-preview-blocked-20260723-v1',
  });
  assert(blockedPreview.ok, 'Blocked-start preview call failed');
  assert(blockedPreview.data?.lifecycle_ready === false, 'Start preview should be blocked before compliance');
  assert(includesText(blockedPreview.data?.blockers, 'pre_start_sanitation_missing_or_incomplete'), 'Sanitation blocker missing');
  assert(includesText(blockedPreview.data?.blockers, 'pre_start_daily_checklist_missing_or_incomplete'), 'Checklist blocker missing');
  assert(includesText(blockedPreview.data?.blockers, 'pre_start_temperature_missing_or_out_of_range'), 'Temperature blocker missing');

  const blockedExecute = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    batch_id: TEST_BATCH_ID,
    action: 'start',
    request_id: requestIds.blocked_start,
    reason: 'G53 prove server-side pre-start compliance rejection',
  });
  const blockedLogKey = `native_production_batch_lifecycle:${requestIds.blocked_start}`;
  const blockedLogsAfterFirst = await base44.entities.CommandLog.filter(
    { idempotency_key: blockedLogKey },
    '-created_date',
    5,
  );
  assert(blockedLogsAfterFirst.length === 1, 'Blocked start must create exactly one rejection audit log');
  assert(blockedLogsAfterFirst[0]?.status === 'rejected', 'Blocked start audit status must be rejected');
  assert(includesText(blockedLogsAfterFirst[0]?.result?.blockers, 'pre_start_sanitation_missing_or_incomplete'), 'Rejected audit lacks compliance blockers');

  const blockedReplay = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    batch_id: TEST_BATCH_ID,
    action: 'start',
    request_id: requestIds.blocked_start,
    reason: 'G53 idempotent rejection replay',
  });
  const blockedLogsAfterReplay = await base44.entities.CommandLog.filter(
    { idempotency_key: blockedLogKey },
    '-created_date',
    5,
  );
  assert(blockedLogsAfterReplay.length === 1, 'Rejected replay created a duplicate CommandLog');
  const afterBlockedBatch = await base44.entities.ProductionBatch.get(created.id);
  assert(afterBlockedBatch?.status === 'planned', 'Blocked start mutated ProductionBatch status');
  evidence.blocked_start = {
    preview_blockers: blockedPreview.data?.blockers || [],
    execute_transport_ok: blockedExecute.ok,
    execute_error: blockedExecute.error,
    replay_transport_ok: blockedReplay.ok,
    replay_error: blockedReplay.error,
    rejected_command_log_count: blockedLogsAfterReplay.length,
    persisted_status_after_rejection: afterBlockedBatch?.status || null,
    writes_to_production_batch: false,
  };

  const commonLink = {
    batch_id: TEST_BATCH_ID,
    source_production_batch_id: created.id,
    related_batch_ids: [TEST_BATCH_ID],
    related_source_production_batch_ids: [created.id],
    is_test_record: true,
  };
  const sanitation = await invoke('saveAdminComplianceRecord', {
    record_type: 'sanitation',
    data: {
      ...commonLink,
      log_date: today,
      log_time: time,
      staff_member: STAFF_LABEL,
      area: 'Prep Area',
      sanitizer_type: 'Internal Test Sanitizer Check',
      sanitizer_level: 'Adequate',
      cleaned: true,
      sanitized: true,
      verified_by: EXPECTED_OPERATOR,
      notes: 'G53 internal test record only',
    },
  });
  const checklist = await invoke('saveAdminComplianceRecord', {
    record_type: 'daily_checklist',
    data: {
      ...commonLink,
      checklist_date: today,
      staff_member: STAFF_LABEL,
      shift: 'Morning',
      morning_fridge_temp_logged: true,
      morning_fridge_time: time,
      sanitizer_levels_checked: true,
      sanitizer_check_time: time,
      equipment_sanitized: true,
      sanitization_time: time,
      work_areas_cleaned: true,
      cleaning_time: time,
      batch_logs_completed: false,
      ccp_logs_completed: false,
      batches_logged: TEST_BATCH_ID,
      overall_status: 'Pre-Production Complete',
      manager_reviewed: true,
      manager_comments: 'G53 internal compliance gate validation',
    },
  });
  const temperature = await invoke('saveAdminComplianceRecord', {
    record_type: 'temperature',
    data: {
      ...commonLink,
      log_date: today,
      log_time: time,
      staff_member: STAFF_LABEL,
      location: 'Cold Room 1',
      temperature: 38,
      unit: 'F',
      min_range: 35,
      max_range: 40,
      production_date: today,
      shift: 'Morning',
      notes: 'G53 internal test record only',
    },
  });
  assert(sanitation.ok && sanitation.data?.success === true, 'Sanitation test record failed');
  assert(checklist.ok && checklist.data?.success === true, 'Daily checklist test record failed');
  assert(temperature.ok && temperature.data?.success === true, 'Temperature test record failed');
  evidence.compliance_writes = {
    sanitation: {
      record_id: sanitation.data.record_id,
      entity: sanitation.data.entity,
      customer_notification_sent: sanitation.data.customer_notification_sent === true,
      provider_calls: sanitation.data.provider_calls === true,
    },
    daily_checklist: {
      record_id: checklist.data.record_id,
      entity: checklist.data.entity,
      customer_notification_sent: checklist.data.customer_notification_sent === true,
      provider_calls: checklist.data.provider_calls === true,
    },
    temperature: {
      record_id: temperature.data.record_id,
      entity: temperature.data.entity,
      customer_notification_sent: temperature.data.customer_notification_sent === true,
      provider_calls: temperature.data.provider_calls === true,
    },
  };

  const [savedSanitation, savedChecklist, savedTemperature] = await Promise.all([
    base44.entities.SanitationLog.filter({ test_batch_id: TEST_BATCH_ID }, '-created_date', 10),
    base44.entities.DailyChecklist.filter({ test_batch_id: TEST_BATCH_ID }, '-created_date', 10),
    base44.entities.TemperatureLog.filter({ test_batch_id: TEST_BATCH_ID }, '-created_date', 10),
  ]);
  assert(savedSanitation.length === 1 && savedSanitation[0]?.is_test_record === true, 'Sanitation test marker did not persist');
  assert(savedChecklist.length === 1 && savedChecklist[0]?.is_test_record === true, 'Checklist test marker did not persist');
  assert(savedTemperature.length === 1 && savedTemperature[0]?.is_test_record === true, 'Temperature test marker did not persist');

  const readyPreview = await invoke('previewNativeProductionBatchLifecycle', {
    mode: 'dry_run',
    action: 'start',
    batch: await base44.entities.ProductionBatch.get(created.id),
    request_id: 'g53-phase-a-preview-ready-20260723-v1',
  });
  assert(readyPreview.ok, 'Ready-start preview call failed');
  assert(readyPreview.data?.lifecycle_ready === true, 'Start preview did not become lifecycle-ready');
  assert(readyPreview.data?.live_command_available === true, 'Start preview did not become live-command-ready');
  assert(readyPreview.data?.pre_start_compliance?.ready === true, 'Server compliance summary is not ready');
  evidence.ready_preview = {
    lifecycle_ready: readyPreview.data.lifecycle_ready,
    live_command_available: readyPreview.data.live_command_available,
    blockers: readyPreview.data.blockers || [],
    live_command_blockers: readyPreview.data.live_command_blockers || [],
    pre_start_compliance: readyPreview.data.pre_start_compliance,
  };

  const start = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    batch_id: TEST_BATCH_ID,
    action: 'start',
    request_id: requestIds.start,
    reason: 'G53 controlled internal test lifecycle start',
  });
  assert(start.ok && start.data?.success === true && start.data?.status === 'in_production', 'Live start failed');
  const startReplay = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    batch_id: TEST_BATCH_ID,
    action: 'start',
    request_id: requestIds.start,
    reason: 'G53 idempotent start replay',
  });
  assert(startReplay.ok && startReplay.data?.idempotent === true && startReplay.data?.writes_performed === false, 'Start replay was not idempotent');

  const complete = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    batch_id: TEST_BATCH_ID,
    action: 'complete',
    request_id: requestIds.complete,
    reason: 'G53 controlled internal test lifecycle completion',
    actual_units: 1,
    bottles_produced: 1,
    bottles_rejected_or_wasted: 0,
    final_usable_quantity: 1,
    storage_location: 'Internal Test Hold',
    use_by_date: today,
  });
  assert(complete.ok && complete.data?.success === true && complete.data?.status === 'completed_pending_verification', 'Live completion failed');
  const completeReplay = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    batch_id: TEST_BATCH_ID,
    action: 'complete',
    request_id: requestIds.complete,
    reason: 'G53 idempotent completion replay',
    actual_units: 1,
  });
  assert(completeReplay.ok && completeReplay.data?.idempotent === true && completeReplay.data?.writes_performed === false, 'Completion replay was not idempotent');

  const verify = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    batch_id: TEST_BATCH_ID,
    action: 'verify',
    request_id: requestIds.verify,
    reason: 'G53 controlled internal test lifecycle verification',
    pH_result: 4.2,
    pH_passed_failed: 'passed',
    passed_failed: 'passed',
    staff_on_duty: [STAFF_LABEL],
    verification_notes: 'G53 internal persistence, audit, and idempotency validation passed',
  });
  assert(verify.ok && verify.data?.success === true && verify.data?.status === 'verified_logged', 'Live verification failed');
  assert(verify.data?.compliance_log_created === true, 'Verification did not create BatchComplianceLog');
  const verifyReplay = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: CONFIRMATION,
    batch_id: TEST_BATCH_ID,
    action: 'verify',
    request_id: requestIds.verify,
    reason: 'G53 idempotent verification replay',
    pH_result: 4.2,
    pH_passed_failed: 'passed',
    passed_failed: 'passed',
  });
  assert(verifyReplay.ok && verifyReplay.data?.idempotent === true && verifyReplay.data?.writes_performed === false, 'Verification replay was not idempotent');
  evidence.lifecycle = {
    start: {
      status: start.data.status,
      writes_performed: start.data.writes_performed === true,
      customer_notification_sent: start.data.customer_notification_sent === true,
      external_service_calls: start.data.external_service_calls === true,
      replay_idempotent: startReplay.data.idempotent === true,
      replay_writes_performed: startReplay.data.writes_performed === true,
    },
    complete: {
      status: complete.data.status,
      writes_performed: complete.data.writes_performed === true,
      inventory_deduction_run: complete.data.inventory_deduction_run === true,
      purchase_order_updated: complete.data.purchase_order_updated === true,
      customer_notification_sent: complete.data.customer_notification_sent === true,
      external_service_calls: complete.data.external_service_calls === true,
      replay_idempotent: completeReplay.data.idempotent === true,
      replay_writes_performed: completeReplay.data.writes_performed === true,
    },
    verify: {
      status: verify.data.status,
      writes_performed: verify.data.writes_performed === true,
      compliance_log_created: verify.data.compliance_log_created === true,
      customer_notification_sent: verify.data.customer_notification_sent === true,
      external_service_calls: verify.data.external_service_calls === true,
      replay_idempotent: verifyReplay.data.idempotent === true,
      replay_writes_performed: verifyReplay.data.writes_performed === true,
    },
  };

  const [finalBatch, commandLogs, batchComplianceLogs] = await Promise.all([
    base44.entities.ProductionBatch.get(created.id),
    base44.entities.CommandLog.filter({ target_display_id: TEST_BATCH_ID }, '-created_date', 20),
    base44.entities.BatchComplianceLog.filter({ test_batch_id: TEST_BATCH_ID }, '-created_date', 10),
  ]);
  const lifecycleLogs = commandLogs.filter(log => log?.command_type === 'native_production_batch_lifecycle');
  assert(finalBatch?.status === 'verified_logged', 'Final ProductionBatch status did not persist');
  assert(finalBatch?.is_test_batch === true, 'Final ProductionBatch test marker did not persist');
  assert(Array.isArray(finalBatch?.audit_trail) && finalBatch.audit_trail.length === 3, 'Successful lifecycle audit trail must contain exactly three events');
  assert(lifecycleLogs.length === 4, 'Lifecycle CommandLog count must be one rejection plus three successes');
  assert(lifecycleLogs.filter(log => log.status === 'rejected').length === 1, 'Expected exactly one rejected CommandLog');
  assert(lifecycleLogs.filter(log => log.status === 'success').length === 3, 'Expected exactly three successful CommandLogs');
  assert(batchComplianceLogs.length === 1 && batchComplianceLogs[0]?.is_test_record === true, 'Expected one marked test BatchComplianceLog');

  const [
    defaultQueueCall,
    testQueueCall,
    defaultComplianceCall,
    testComplianceCall,
    operationsCall,
    calendarCall,
    resourcesCall,
    planningCall,
  ] = await Promise.all([
    invoke('getAdminProductionQueueSummary', {
      date_from: today,
      date_to: today,
      limit: 100,
      test_batch_mode: 'exclude',
    }),
    invoke('getAdminProductionQueueSummary', {
      date_from: today,
      date_to: today,
      limit: 100,
      test_batch_mode: 'only',
    }),
    invoke('getAdminComplianceOpsSummary', {
      date_from: today,
      date_to: today,
      test_record_mode: 'exclude',
    }),
    invoke('getAdminComplianceOpsSummary', {
      date_from: today,
      date_to: today,
      test_record_mode: 'only',
    }),
    invoke('getAdminOperationsDashboardSummary', { preset: 'today' }),
    invoke('getAdminCalendarEventsSummary', {
      preset: 'custom',
      date_from: today,
      date_to: today,
      limit: 200,
    }),
    invoke('getAdminResourcesSummary', { limit: 200 }),
    invoke('getAdminProductionPlanningSummary', {
      preset: 'custom',
      date_from: today,
      date_to: today,
    }),
  ]);
  assert([
    defaultQueueCall,
    testQueueCall,
    defaultComplianceCall,
    testComplianceCall,
    operationsCall,
    calendarCall,
    resourcesCall,
    planningCall,
  ].every(call => call.ok), 'One or more post-pilot read models failed');
  assert(!includesText(defaultQueueCall.data, TEST_BATCH_ID), 'Default production queue leaked test batch');
  assert(includesText(testQueueCall.data, TEST_BATCH_ID), 'Test-only production queue did not expose test batch');
  assert(!includesText(defaultComplianceCall.data, TEST_BATCH_ID), 'Default compliance view leaked test records');
  assert(includesText(testComplianceCall.data, TEST_BATCH_ID), 'Test-only compliance view did not expose test records');
  assert(!includesText(operationsCall.data, TEST_BATCH_ID), 'Operations dashboard leaked test batch');
  assert(!includesText(calendarCall.data, TEST_BATCH_ID), 'Calendar leaked test batch');
  assert(!includesText(resourcesCall.data, TEST_BATCH_ID), 'Resources leaked test batch');
  assert(!includesText(planningCall.data, TEST_BATCH_ID), 'Production planning leaked test batch');

  evidence.verification = {
    persisted_batch: {
      id: finalBatch.id,
      batch_id: finalBatch.batch_id,
      status: finalBatch.status,
      actual_units: finalBatch.actual_units,
      is_test_batch: finalBatch.is_test_batch === true,
      audit_trail_count: finalBatch.audit_trail.length,
      compliance_log_id: finalBatch.compliance_log_id || null,
      inventory_deduction_status: finalBatch.inventory_deduction_status || null,
    },
    command_logs: {
      total: lifecycleLogs.length,
      rejected: lifecycleLogs.filter(log => log.status === 'rejected').length,
      success: lifecycleLogs.filter(log => log.status === 'success').length,
      failed: lifecycleLogs.filter(log => log.status === 'failed').length,
      duplicate_logs_created_by_replays: false,
    },
    compliance_records: {
      sanitation: savedSanitation.length,
      daily_checklist: savedChecklist.length,
      temperature: savedTemperature.length,
      batch_compliance: batchComplianceLogs.length,
      all_marked_test: [
        ...savedSanitation,
        ...savedChecklist,
        ...savedTemperature,
        ...batchComplianceLogs,
      ].every(record => record?.is_test_record === true && record?.test_batch_id === TEST_BATCH_ID),
    },
    operational_isolation: {
      default_queue: summarizeQueue(defaultQueueCall.data),
      test_only_queue: summarizeQueue(testQueueCall.data),
      default_compliance: summarizeCompliance(defaultComplianceCall.data),
      test_only_compliance: summarizeCompliance(testComplianceCall.data),
      operations: summarizeOperations(operationsCall.data),
      calendar_contains_test_batch: includesText(calendarCall.data, TEST_BATCH_ID),
      resources_contains_test_batch: includesText(resourcesCall.data, TEST_BATCH_ID),
      planning_contains_test_batch: includesText(planningCall.data, TEST_BATCH_ID),
    },
  };

  evidence.success = true;
  evidence.classification = 'phase_a_live_persistence_verified';
  evidence.disposition = 'Preserve the verified internal test records as marked audit evidence; close both test-only mutation allowlists after evidence capture.';
} catch (error) {
  evidence.success = false;
  evidence.classification = 'phase_a_live_pilot_failed_safe_hold';
  evidence.error = safeError(error);
}

console.log(JSON.stringify(evidence, null, 2));
if (!evidence.success) throw new Error(evidence.error?.message || 'G53 live pilot failed');
