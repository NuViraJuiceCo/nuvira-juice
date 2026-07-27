const EXPECTED_OPERATOR = 'info@nuvirajuice.com';
const PRODUCTION_CONFIRMATION = 'execute_native_production_batch_lifecycle';
const FULFILLMENT_CONFIRMATION = 'execute_native_fulfillment_task_lifecycle';
const TEST_PURPOSE = 'G56 website all-bundle live sandbox validation';
const STAFF_LABEL = 'NuVira G56 Internal QA';
const TEST_ORDER_ID = 'ORDER-G56-TEST-ALLBUNDLE-20260724';
const TEST_ORDER_NUMBER = 'G56-TEST-ALLBUNDLE-20260724';
const TEST_TASK_ID = 'TASK-G56-TEST-ALLBUNDLE-20260724';
const TEST_EMAIL = 'g56.internal@example.invalid';
const INTERNAL_DRIVER = 'G56 Internal Driver';

const products = [
  {
    key: 'oasis',
    batch_id: 'BATCH-G56-TEST-20260724-OASIS',
    product_name: 'Oasis',
    pH_result: 4.0,
  },
  {
    key: 'aura',
    batch_id: 'BATCH-G56-TEST-20260724-AURA',
    product_name: 'Aura',
    pH_result: 4.1,
  },
  {
    key: 're-nu',
    batch_id: 'BATCH-G56-TEST-20260724-RE-NU',
    product_name: 'Re-Nu',
    pH_result: 3.8,
  },
];

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

function includesAny(value, texts) {
  return texts.some(text => includesText(value, text));
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
    contains_test_batches: products.filter(product => includesText(data, product.batch_id)).map(product => product.batch_id),
    test_batch_mode: data?.test_batch_mode || null,
    operational_totals_exclude_test_batches: data?.operational_totals_exclude_test_batches === true,
  };
}

function summarizeCompliance(data) {
  return {
    counts: data?.counts || data?.summary || data?.native?.counts || {},
    contains_test_batches: products.filter(product => includesText(data, product.batch_id)).map(product => product.batch_id),
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
    contains_test_data: includesAny(data, [...products.map(product => product.batch_id), TEST_TASK_ID, TEST_ORDER_NUMBER]),
  };
}

function routeSummary(data) {
  return {
    summary: data?.summary || null,
    test_task_mode: data?.test_task_mode || null,
    operational_totals_exclude_test_tasks: data?.operational_totals_exclude_test_tasks === true,
    contains_test_task: includesText(data, TEST_TASK_ID) || includesText(data, TEST_ORDER_NUMBER),
    active_count: Array.isArray(data?.sections?.delivery_stops) ? data.sections.delivery_stops.length : null,
    completed_count: Array.isArray(data?.sections?.completed) ? data.sections.completed.length : null,
  };
}

const generatedAt = new Date();
const pilotWindowEnd = new Date(generatedAt.getTime() + 60 * 60 * 1000);
const today = chicagoDate();
const time = chicagoTime();
const batchIds = products.map(product => product.batch_id);
const requestIds = {
  blocked_start: 'g56-allbundle-start-blocked-20260724-v1',
  invalid_delivered: 'g56-allbundle-invalid-delivered-20260724-v1',
};

for (const product of products) {
  requestIds[`start_${product.key}`] = `g56-allbundle-start-${product.key}-20260724-v1`;
  requestIds[`complete_${product.key}`] = `g56-allbundle-complete-${product.key}-20260724-v1`;
  requestIds[`verify_${product.key}`] = `g56-allbundle-verify-${product.key}-20260724-v1`;
}

const taskRequestIds = {
  assign: 'g56-allbundle-task-assign-20260724-v1',
  pack: 'g56-allbundle-task-pack-20260724-v1',
  out_for_delivery: 'g56-allbundle-task-out-for-delivery-20260724-v1',
  delivered_operational: 'g56-allbundle-task-delivered-20260724-v1',
};

const evidence = {
  success: false,
  classification: 'website_all_bundle_controlled_live_sandbox_in_progress',
  generated_at_utc: generatedAt.toISOString(),
  pilot_window: {
    start_utc: generatedAt.toISOString(),
    end_utc: pilotWindowEnd.toISOString(),
    timezone: 'America/Chicago',
  },
  rollback_owner: 'NuVira owner authorization; executing admin info@nuvirajuice.com',
  test_scope: {
    order_reference: TEST_ORDER_ID,
    order_number: TEST_ORDER_NUMBER,
    fulfillment_task_id: TEST_TASK_ID,
    production_batch_ids: batchIds,
    approved_test_marker: 'internal/test',
  },
  operator: null,
  baseline: null,
  creation: null,
  blocked_start: null,
  compliance_writes: [],
  production_lifecycle: [],
  fulfillment_creation: null,
  fulfillment_invalid_transition: null,
  fulfillment_lifecycle: null,
  verification: null,
  safety: {
    customer_order_created: false,
    customer_order_updated: false,
    shopify_order_mutations: false,
    customer_notifications_sent: false,
    customer_message_delivery_logs_created: false,
    provider_calls_performed: false,
    route_saved: false,
    inventory_mutations_performed: false,
    refunds_performed: false,
    subscription_changes_performed: false,
    bulk_sync_performed: false,
  },
};

try {
  const user = await base44.auth.me();
  evidence.operator = { email: user?.email || null, role: user?.role || null };
  assert(user?.role === 'admin', 'G56 sandbox requires an admin operator');
  assert((user?.email || '').toLowerCase() === EXPECTED_OPERATOR, 'G56 sandbox operator does not match approval');

  const preexistingBatchChecks = await Promise.all(products.map(product =>
    base44.entities.ProductionBatch.filter({ batch_id: product.batch_id }, '-created_date', 5)
  ));
  preexistingBatchChecks.forEach((rows, index) => {
    assert(Array.isArray(rows) && rows.length === 0, `${products[index].batch_id} already exists; refusing duplicate creation`);
  });

  const [preexistingTasks, preexistingOrders, preexistingNotifications, preexistingDeliveryLogs] = await Promise.all([
    base44.entities.FulfillmentTask.filter({ fulfillment_task_id: TEST_TASK_ID }, '-created_date', 5),
    base44.entities.Order.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
    base44.entities.Notification.filter({ customer_email: TEST_EMAIL }, '-created_date', 5),
    base44.entities.CustomerMessageDeliveryLog.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
  ]);
  assert(preexistingTasks.length === 0, 'G56 test task already exists; refusing duplicate creation');
  assert(preexistingOrders.length === 0, 'Synthetic order reference unexpectedly resolves to a Customer App Order');
  assert(preexistingNotifications.length === 0, 'Synthetic test email already has Notification rows');
  assert(preexistingDeliveryLogs.length === 0, 'Synthetic order reference already has customer delivery logs');

  const [
    baselineQueueCall,
    baselineComplianceCall,
    baselineRouteCall,
    baselineOperationsCall,
    baselineCalendarCall,
    baselineResourcesCall,
    baselinePlanningCall,
  ] = await Promise.all([
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
    invoke('getAdminDeliveryRouteSummary', {
      delivery_date: today,
      limit: 100,
      test_task_mode: 'exclude',
    }),
    invoke('getAdminOperationsDashboardSummary', {
      preset: 'today',
      include_backend_readiness: true,
    }),
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
    baselineQueueCall,
    baselineComplianceCall,
    baselineRouteCall,
    baselineOperationsCall,
    baselineCalendarCall,
    baselineResourcesCall,
    baselinePlanningCall,
  ].every(call => call.ok), 'Unable to capture read-only operational baseline');
  assert(!includesAny(baselineQueueCall.data, batchIds), 'Baseline queue unexpectedly contains G56 test batch data');
  assert(!includesAny(baselineComplianceCall.data, batchIds), 'Baseline compliance unexpectedly contains G56 test data');
  assert(!routeSummary(baselineRouteCall.data).contains_test_task, 'Baseline route unexpectedly contains G56 test task');
  assert(!includesAny(baselineOperationsCall.data, [...batchIds, TEST_TASK_ID, TEST_ORDER_NUMBER]), 'Baseline operations unexpectedly contains G56 test data');
  assert(!includesAny(baselineCalendarCall.data, [...batchIds, TEST_TASK_ID, TEST_ORDER_NUMBER]), 'Baseline calendar unexpectedly contains G56 test data');
  assert(!includesAny(baselineResourcesCall.data, batchIds), 'Baseline resources unexpectedly contains G56 test data');
  assert(!includesAny(baselinePlanningCall.data, batchIds), 'Baseline production planning unexpectedly contains G56 test data');
  evidence.baseline = {
    queue: summarizeQueue(baselineQueueCall.data),
    compliance: summarizeCompliance(baselineComplianceCall.data),
    route: routeSummary(baselineRouteCall.data),
    operations: summarizeOperations(baselineOperationsCall.data),
  };

  const createdBatches = [];
  for (const product of products) {
    const created = await base44.entities.ProductionBatch.create({
      batch_id: product.batch_id,
      product_name: product.product_name,
      product_category: 'juice',
      status: 'planned',
      planned_units: 1,
      production_date: today,
      assigned_to: STAFF_LABEL,
      notes: 'Internal G56 website all-bundle sandbox. Excluded from operational totals and customer workflows.',
      is_test_batch: true,
      test_purpose: TEST_PURPOSE,
      is_locked: false,
      order_sources: [],
      related_orders: [],
      source_system: 'customer_app_internal_validation',
      native_owner_status: 'internal_test_only',
      inventory_deduction_status: 'held_internal_test',
    });
    assert(created?.id, `${product.batch_id} creation did not return an id`);
    assert(created?.is_test_batch === true, `${product.batch_id} missing formal test marker`);
    assert(created?.status === 'planned', `${product.batch_id} did not persist as planned`);
    createdBatches.push({ ...product, entity: created });
  }
  evidence.creation = createdBatches.map(({ entity }) => ({
    production_batch_entity_id: entity.id,
    batch_id: entity.batch_id,
    status: entity.status,
    planned_units: entity.planned_units,
    is_test_batch: entity.is_test_batch === true,
    source_system: entity.source_system,
    native_owner_status: entity.native_owner_status,
    inventory_deduction_status: entity.inventory_deduction_status,
  }));

  const firstBatch = createdBatches[0];
  const blockedPreview = await invoke('previewNativeProductionBatchLifecycle', {
    mode: 'dry_run',
    action: 'start',
    batch: firstBatch.entity,
    request_id: 'g56-allbundle-preview-blocked-20260724-v1',
  });
  assert(blockedPreview.ok, 'Blocked-start preview call failed');
  assert(blockedPreview.data?.lifecycle_ready === false, 'Start preview should be blocked before compliance');
  assert(includesText(blockedPreview.data?.blockers, 'pre_start_sanitation_missing_or_incomplete'), 'Sanitation blocker missing');
  assert(includesText(blockedPreview.data?.blockers, 'pre_start_daily_checklist_missing_or_incomplete'), 'Checklist blocker missing');
  assert(includesText(blockedPreview.data?.blockers, 'pre_start_temperature_missing_or_out_of_range'), 'Temperature blocker missing');

  const blockedExecute = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: PRODUCTION_CONFIRMATION,
    batch_id: firstBatch.batch_id,
    action: 'start',
    request_id: requestIds.blocked_start,
    reason: 'G56 prove server-side pre-start compliance rejection',
  });
  const blockedLogKey = `native_production_batch_lifecycle:${requestIds.blocked_start}`;
  const blockedLogsAfterFirst = await base44.entities.CommandLog.filter({ idempotency_key: blockedLogKey }, '-created_date', 5);
  assert(blockedLogsAfterFirst.length === 1, 'Blocked start must create exactly one rejection audit log');
  assert(blockedLogsAfterFirst[0]?.status === 'rejected', 'Blocked start audit status must be rejected');
  assert(includesText(blockedLogsAfterFirst[0]?.result?.blockers, 'pre_start_sanitation_missing_or_incomplete'), 'Rejected audit lacks compliance blockers');

  const blockedReplay = await invoke('executeNativeProductionBatchLifecycle', {
    mode: 'live',
    confirmation: PRODUCTION_CONFIRMATION,
    batch_id: firstBatch.batch_id,
    action: 'start',
    request_id: requestIds.blocked_start,
    reason: 'G56 idempotent rejection replay',
  });
  const blockedLogsAfterReplay = await base44.entities.CommandLog.filter({ idempotency_key: blockedLogKey }, '-created_date', 5);
  const afterBlockedBatch = await base44.entities.ProductionBatch.get(firstBatch.entity.id);
  assert(blockedLogsAfterReplay.length === 1, 'Rejected replay created a duplicate CommandLog');
  assert(afterBlockedBatch?.status === 'planned', 'Blocked start mutated ProductionBatch status');
  evidence.blocked_start = {
    batch_id: firstBatch.batch_id,
    preview_blockers: blockedPreview.data?.blockers || [],
    execute_transport_ok: blockedExecute.ok,
    execute_error: blockedExecute.error,
    replay_transport_ok: blockedReplay.ok,
    replay_error: blockedReplay.error,
    rejected_command_log_count: blockedLogsAfterReplay.length,
    persisted_status_after_rejection: afterBlockedBatch?.status || null,
    writes_to_production_batch: false,
  };

  for (const product of createdBatches) {
    const commonLink = {
      batch_id: product.batch_id,
      source_production_batch_id: product.entity.id,
      related_batch_ids: [product.batch_id],
      related_source_production_batch_ids: [product.entity.id],
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
        notes: `G56 internal ${product.product_name} sanitation gate validation only`,
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
        batches_logged: product.batch_id,
        overall_status: 'Pre-Production Complete',
        manager_reviewed: true,
        manager_comments: `G56 internal ${product.product_name} compliance gate validation`,
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
        notes: `G56 internal ${product.product_name} temperature gate validation only`,
      },
    });
    assert(sanitation.ok && sanitation.data?.success === true, `${product.batch_id} sanitation record failed`);
    assert(checklist.ok && checklist.data?.success === true, `${product.batch_id} daily checklist record failed`);
    assert(temperature.ok && temperature.data?.success === true, `${product.batch_id} temperature record failed`);
    evidence.compliance_writes.push({
      batch_id: product.batch_id,
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
    });
  }

  for (const product of createdBatches) {
    const [savedSanitation, savedChecklist, savedTemperature] = await Promise.all([
      base44.entities.SanitationLog.filter({ test_batch_id: product.batch_id }, '-created_date', 10),
      base44.entities.DailyChecklist.filter({ test_batch_id: product.batch_id }, '-created_date', 10),
      base44.entities.TemperatureLog.filter({ test_batch_id: product.batch_id }, '-created_date', 10),
    ]);
    assert(savedSanitation.length === 1 && savedSanitation[0]?.is_test_record === true, `${product.batch_id} sanitation test marker did not persist`);
    assert(savedChecklist.length === 1 && savedChecklist[0]?.is_test_record === true, `${product.batch_id} checklist test marker did not persist`);
    assert(savedTemperature.length === 1 && savedTemperature[0]?.is_test_record === true, `${product.batch_id} temperature test marker did not persist`);

    const readyPreview = await invoke('previewNativeProductionBatchLifecycle', {
      mode: 'dry_run',
      action: 'start',
      batch: await base44.entities.ProductionBatch.get(product.entity.id),
      request_id: `g56-allbundle-preview-ready-${product.key}-20260724-v1`,
    });
    assert(readyPreview.ok, `${product.batch_id} ready-start preview failed`);
    assert(readyPreview.data?.lifecycle_ready === true, `${product.batch_id} start preview did not become lifecycle-ready`);
    assert(readyPreview.data?.live_command_available === true, `${product.batch_id} start preview did not become live-command-ready`);
    assert(readyPreview.data?.pre_start_compliance?.ready === true, `${product.batch_id} pre-start compliance summary is not ready`);

    const start = await invoke('executeNativeProductionBatchLifecycle', {
      mode: 'live',
      confirmation: PRODUCTION_CONFIRMATION,
      batch_id: product.batch_id,
      action: 'start',
      request_id: requestIds[`start_${product.key}`],
      reason: `G56 controlled internal ${product.product_name} lifecycle start`,
    });
    assert(start.ok && start.data?.success === true && start.data?.status === 'in_production', `${product.batch_id} live start failed`);
    const startReplay = await invoke('executeNativeProductionBatchLifecycle', {
      mode: 'live',
      confirmation: PRODUCTION_CONFIRMATION,
      batch_id: product.batch_id,
      action: 'start',
      request_id: requestIds[`start_${product.key}`],
      reason: `G56 idempotent ${product.product_name} start replay`,
    });
    assert(startReplay.ok && startReplay.data?.idempotent === true && startReplay.data?.writes_performed === false, `${product.batch_id} start replay was not idempotent`);

    const complete = await invoke('executeNativeProductionBatchLifecycle', {
      mode: 'live',
      confirmation: PRODUCTION_CONFIRMATION,
      batch_id: product.batch_id,
      action: 'complete',
      request_id: requestIds[`complete_${product.key}`],
      reason: `G56 controlled internal ${product.product_name} lifecycle completion`,
      actual_units: 1,
      bottles_produced: 1,
      bottles_rejected_or_wasted: 0,
      final_usable_quantity: 1,
      storage_location: 'Internal Test Hold',
      use_by_date: today,
    });
    assert(complete.ok && complete.data?.success === true && complete.data?.status === 'completed_pending_verification', `${product.batch_id} live completion failed`);
    const completeReplay = await invoke('executeNativeProductionBatchLifecycle', {
      mode: 'live',
      confirmation: PRODUCTION_CONFIRMATION,
      batch_id: product.batch_id,
      action: 'complete',
      request_id: requestIds[`complete_${product.key}`],
      reason: `G56 idempotent ${product.product_name} completion replay`,
      actual_units: 1,
    });
    assert(completeReplay.ok && completeReplay.data?.idempotent === true && completeReplay.data?.writes_performed === false, `${product.batch_id} completion replay was not idempotent`);

    const verify = await invoke('executeNativeProductionBatchLifecycle', {
      mode: 'live',
      confirmation: PRODUCTION_CONFIRMATION,
      batch_id: product.batch_id,
      action: 'verify',
      request_id: requestIds[`verify_${product.key}`],
      reason: `G56 controlled internal ${product.product_name} lifecycle verification`,
      pH_result: product.pH_result,
      pH_passed_failed: 'passed',
      passed_failed: 'passed',
      staff_on_duty: [STAFF_LABEL],
      verification_notes: `G56 ${product.product_name} internal sandbox persistence, audit, and idempotency validation passed`,
    });
    assert(verify.ok && verify.data?.success === true && verify.data?.status === 'verified_logged', `${product.batch_id} live verification failed`);
    assert(verify.data?.compliance_log_created === true, `${product.batch_id} verification did not create BatchComplianceLog`);
    const verifyReplay = await invoke('executeNativeProductionBatchLifecycle', {
      mode: 'live',
      confirmation: PRODUCTION_CONFIRMATION,
      batch_id: product.batch_id,
      action: 'verify',
      request_id: requestIds[`verify_${product.key}`],
      reason: `G56 idempotent ${product.product_name} verification replay`,
      pH_result: product.pH_result,
      pH_passed_failed: 'passed',
      passed_failed: 'passed',
    });
    assert(verifyReplay.ok && verifyReplay.data?.idempotent === true && verifyReplay.data?.writes_performed === false, `${product.batch_id} verification replay was not idempotent`);

    evidence.production_lifecycle.push({
      batch_id: product.batch_id,
      ready_preview: {
        lifecycle_ready: readyPreview.data.lifecycle_ready,
        live_command_available: readyPreview.data.live_command_available,
        blockers: readyPreview.data.blockers || [],
        live_command_blockers: readyPreview.data.live_command_blockers || [],
        pre_start_compliance: readyPreview.data.pre_start_compliance,
      },
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
    });
  }

  const finalProduction = [];
  for (const product of createdBatches) {
    const [finalBatch, commandLogs, batchComplianceLogs] = await Promise.all([
      base44.entities.ProductionBatch.get(product.entity.id),
      base44.entities.CommandLog.filter({ target_display_id: product.batch_id }, '-created_date', 20),
      base44.entities.BatchComplianceLog.filter({ test_batch_id: product.batch_id }, '-created_date', 10),
    ]);
    const lifecycleLogs = commandLogs.filter(log => log?.command_type === 'native_production_batch_lifecycle');
    const expectedLogs = product.batch_id === firstBatch.batch_id ? 4 : 3;
    const expectedRejected = product.batch_id === firstBatch.batch_id ? 1 : 0;
    assert(finalBatch?.status === 'verified_logged', `${product.batch_id} final status did not persist`);
    assert(finalBatch?.is_test_batch === true, `${product.batch_id} final test marker did not persist`);
    assert(Array.isArray(finalBatch?.audit_trail) && finalBatch.audit_trail.length === 3, `${product.batch_id} successful lifecycle audit trail must contain exactly three events`);
    assert(lifecycleLogs.length === expectedLogs, `${product.batch_id} lifecycle CommandLog count mismatch`);
    assert(lifecycleLogs.filter(log => log.status === 'rejected').length === expectedRejected, `${product.batch_id} rejected CommandLog count mismatch`);
    assert(lifecycleLogs.filter(log => log.status === 'success').length === 3, `${product.batch_id} success CommandLog count mismatch`);
    assert(batchComplianceLogs.length === 1 && batchComplianceLogs[0]?.is_test_record === true, `${product.batch_id} expected one marked test BatchComplianceLog`);
    finalProduction.push({
      id: finalBatch.id,
      batch_id: finalBatch.batch_id,
      product_name: finalBatch.product_name,
      status: finalBatch.status,
      actual_units: finalBatch.actual_units,
      is_test_batch: finalBatch.is_test_batch === true,
      audit_trail_count: finalBatch.audit_trail.length,
      compliance_log_id: finalBatch.compliance_log_id || null,
      inventory_deduction_status: finalBatch.inventory_deduction_status || null,
      command_logs: {
        total: lifecycleLogs.length,
        rejected: lifecycleLogs.filter(log => log.status === 'rejected').length,
        success: lifecycleLogs.filter(log => log.status === 'success').length,
        failed: lifecycleLogs.filter(log => log.status === 'failed').length,
      },
    });
  }

  const [
    defaultQueueCall,
    testQueueCall,
    defaultComplianceCall,
    testComplianceCall,
    productionOperationsCall,
    productionCalendarCall,
    productionResourcesCall,
    productionPlanningCall,
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
    invoke('getAdminOperationsDashboardSummary', {
      preset: 'today',
      include_backend_readiness: true,
    }),
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
    productionOperationsCall,
    productionCalendarCall,
    productionResourcesCall,
    productionPlanningCall,
  ].every(call => call.ok), 'One or more production post-pilot read models failed');
  assert(!includesAny(defaultQueueCall.data, batchIds), 'Default production queue leaked G56 test batch');
  assert(batchIds.every(batchId => includesText(testQueueCall.data, batchId)), 'Test-only production queue did not expose every G56 test batch');
  assert(!includesAny(defaultComplianceCall.data, batchIds), 'Default compliance view leaked G56 test records');
  assert(batchIds.every(batchId => includesText(testComplianceCall.data, batchId)), 'Test-only compliance view did not expose every G56 test record');
  assert(!includesAny(productionOperationsCall.data, batchIds), 'Operations dashboard leaked G56 test batch data');
  assert(!includesAny(productionCalendarCall.data, batchIds), 'Calendar leaked G56 test batch data');
  assert(!includesAny(productionResourcesCall.data, batchIds), 'Resources leaked G56 test batch data');
  assert(!includesAny(productionPlanningCall.data, batchIds), 'Production planning leaked G56 test batch data');

  const createdTask = await base44.entities.FulfillmentTask.create({
    order_id: TEST_ORDER_ID,
    order_number: TEST_ORDER_NUMBER,
    fulfillment_task_id: TEST_TASK_ID,
    customer_name: 'G56 Internal QA',
    customer_email: TEST_EMAIL,
    source_channel: 'customer_app_internal_validation',
    source_type: 'delivery',
    task_source: 'g56_controlled_live_sandbox',
    created_from_native_ops: true,
    order_type: 'internal_test',
    fulfillment_type: 'delivery',
    fulfillment_number: 1,
    delivery_date: today,
    scheduled_date: today,
    assigned_delivery_date: today,
    production_date: today,
    delivery_window_label: 'Internal Validation Window',
    address: 'Internal Test Route',
    delivery_address: {
      address_line1: 'Internal Test Route',
      city: 'Internal',
      state: 'MO',
    },
    address_complete: true,
    items: products.map(product => ({ title: product.product_name, quantity: 1, price: 0 })),
    items_summary: '1x Oasis, 1x Aura, 1x Re-Nu',
    line_item_count: 3,
    total_price: 0,
    status: 'scheduled',
    delivery_status: 'pending',
    production_status: 'ready',
    payment_status: 'test_paid',
    route_id: 'ROUTE-G56-INTERNAL-TEST',
    route_stop_sequence: 1,
    is_test_task: true,
    test_purpose: TEST_PURPOSE,
    internal_notes: 'Internal validation only. No Customer App Order, customer contact, provider call, route save, or inventory effect.',
    notes: 'G56 isolated website all-bundle delivery sandbox audit record.',
    audit_trail: [],
  });
  assert(createdTask?.id, 'FulfillmentTask creation did not return an id');
  assert(createdTask?.is_test_task === true, 'Formal test-task marker did not persist on creation');
  assert(createdTask?.status === 'scheduled', 'Test task did not persist as scheduled');
  evidence.fulfillment_creation = {
    fulfillment_task_entity_id: createdTask.id,
    fulfillment_task_id: createdTask.fulfillment_task_id,
    order_reference: createdTask.order_id,
    order_number: createdTask.order_number,
    status: createdTask.status,
    is_test_task: createdTask.is_test_task === true,
    customer_email_domain: createdTask.customer_email?.split('@')[1] || null,
    task_source: createdTask.task_source,
    items_summary: createdTask.items_summary,
  };

  const invalidExecute = await invoke('executeNativeFulfillmentTaskLifecycle', {
    mode: 'live',
    confirmation: FULFILLMENT_CONFIRMATION,
    fulfillment_task_id: TEST_TASK_ID,
    action: 'delivered_operational',
    request_id: requestIds.invalid_delivered,
    reason: 'G56 prove invalid transition rejection',
    update_customer_order_status: false,
    notify_customer: false,
  });
  const invalidReplay = await invoke('executeNativeFulfillmentTaskLifecycle', {
    mode: 'live',
    confirmation: FULFILLMENT_CONFIRMATION,
    fulfillment_task_id: TEST_TASK_ID,
    action: 'delivered_operational',
    request_id: requestIds.invalid_delivered,
    reason: 'G56 prove rejected delivery command idempotency',
    update_customer_order_status: false,
    notify_customer: false,
  });
  const invalidLogKey = `native_fulfillment_task_lifecycle:${requestIds.invalid_delivered}`;
  const invalidLogs = await base44.entities.CommandLog.filter({ idempotency_key: invalidLogKey }, '-created_date', 5);
  const afterInvalid = await base44.entities.FulfillmentTask.get(createdTask.id);
  assert(invalidExecute.ok === false, 'Invalid delivered transition unexpectedly succeeded');
  assert(invalidReplay.ok === false, 'Rejected transition replay unexpectedly succeeded');
  assert(invalidLogs.length === 1 && invalidLogs[0]?.status === 'rejected', 'Invalid transition must create one rejected CommandLog');
  assert(afterInvalid?.status === 'scheduled', 'Invalid transition changed task status');
  evidence.fulfillment_invalid_transition = {
    first_transport_ok: invalidExecute.ok,
    replay_transport_ok: invalidReplay.ok,
    command_log_count: invalidLogs.length,
    command_log_status: invalidLogs[0]?.status || null,
    blockers: invalidLogs[0]?.result?.blockers || [],
    status_after_rejection: afterInvalid?.status || null,
    mutation_performed: false,
  };

  async function runTaskAndReplay(action, payload = {}) {
    const requestId = taskRequestIds[action];
    const command = {
      mode: 'live',
      confirmation: FULFILLMENT_CONFIRMATION,
      fulfillment_task_id: TEST_TASK_ID,
      action,
      request_id: requestId,
      reason: `G56 controlled internal ${action} validation`,
      update_customer_order_status: false,
      notify_customer: false,
      ...payload,
    };
    const first = await invoke('executeNativeFulfillmentTaskLifecycle', command);
    assert(first.ok && first.data?.success === true && first.data?.writes_performed === true, `${action} live command failed`);
    assert(first.data?.customer_order_updated !== true, `${action} unexpectedly updated Customer App Order`);
    assert(first.data?.customer_notification_sent !== true, `${action} unexpectedly sent customer notification`);
    assert(first.data?.external_service_calls !== true, `${action} unexpectedly called external service`);
    const replay = await invoke('executeNativeFulfillmentTaskLifecycle', command);
    assert(replay.ok && replay.data?.idempotent === true && replay.data?.writes_performed === false, `${action} replay was not idempotent`);
    return {
      status: first.data.status,
      delivery_status: first.data.delivery_status,
      command_log_id: first.data.command_log_id,
      writes_performed: first.data.writes_performed === true,
      customer_order_updated: first.data.customer_order_updated === true,
      customer_notification_sent: first.data.customer_notification_sent === true,
      external_service_calls: first.data.external_service_calls === true,
      route_saved: first.data.route_saved === true,
      replay_idempotent: replay.data.idempotent === true,
      replay_writes_performed: replay.data.writes_performed === true,
    };
  }

  const assign = await runTaskAndReplay('assign', { assigned_driver: INTERNAL_DRIVER });
  const pack = await runTaskAndReplay('pack');
  const outForDelivery = await runTaskAndReplay('out_for_delivery');
  const delivered = await runTaskAndReplay('delivered_operational', {
    delivery_drop_location: 'Internal Test Completion',
    delivery_notes: 'G56 internal all-bundle delivery sandbox; no customer or provider effect',
  });
  assert(assign.status === 'assigned', 'Assign status mismatch');
  assert(pack.status === 'packed', 'Pack status mismatch');
  assert(outForDelivery.status === 'out_for_delivery', 'Out-for-delivery status mismatch');
  assert(delivered.status === 'delivered', 'Delivered status mismatch');
  evidence.fulfillment_lifecycle = {
    assign,
    pack,
    out_for_delivery: outForDelivery,
    delivered_operational: delivered,
  };

  const [
    finalTask,
    taskCommandLogs,
    customerOrders,
    notifications,
    customerDeliveryLogs,
    defaultRouteCall,
    testRouteCall,
    finalOperationsCall,
    finalCalendarCall,
  ] = await Promise.all([
    base44.entities.FulfillmentTask.get(createdTask.id),
    base44.entities.CommandLog.filter({ target_id: createdTask.id }, '-created_date', 20),
    base44.entities.Order.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
    base44.entities.Notification.filter({ customer_email: TEST_EMAIL }, '-created_date', 5),
    base44.entities.CustomerMessageDeliveryLog.filter({ order_number: TEST_ORDER_NUMBER }, '-created_date', 5),
    invoke('getAdminDeliveryRouteSummary', {
      delivery_date: today,
      limit: 100,
      test_task_mode: 'exclude',
    }),
    invoke('getAdminDeliveryRouteSummary', {
      delivery_date: today,
      limit: 100,
      test_task_mode: 'only',
    }),
    invoke('getAdminOperationsDashboardSummary', {
      preset: 'today',
      include_backend_readiness: true,
    }),
    invoke('getAdminCalendarEventsSummary', {
      preset: 'custom',
      date_from: today,
      date_to: today,
      limit: 200,
    }),
  ]);
  const taskLifecycleLogs = taskCommandLogs.filter(log => log?.command_type === 'native_fulfillment_task_lifecycle');
  assert(finalTask?.status === 'delivered' && finalTask?.delivery_status === 'delivered', 'Final delivered state did not persist');
  assert(finalTask?.is_test_task === true, 'Final test-task marker did not persist');
  assert(finalTask?.delivery_drop_location === 'Internal Test Completion', 'Delivery drop location did not persist');
  assert(Array.isArray(finalTask?.audit_trail) && finalTask.audit_trail.length === 4, 'Successful task audit trail must contain four events');
  assert(taskLifecycleLogs.length === 5, 'Task lifecycle CommandLog count must be one rejection plus four successes');
  assert(taskLifecycleLogs.filter(log => log.status === 'rejected').length === 1, 'Expected exactly one rejected task CommandLog');
  assert(taskLifecycleLogs.filter(log => log.status === 'success').length === 4, 'Expected exactly four successful task CommandLogs');
  assert(taskLifecycleLogs.every(log => log?.payload?.is_test_task === true), 'Every task CommandLog must be marked test');
  assert(customerOrders.length === 0, 'G56 created or matched a Customer App Order');
  assert(notifications.length === 0, 'G56 created a Notification');
  assert(customerDeliveryLogs.length === 0, 'G56 created a customer message delivery log');
  assert(defaultRouteCall.ok && testRouteCall.ok && finalOperationsCall.ok && finalCalendarCall.ok, 'One or more final read models failed');
  assert(!includesText(defaultRouteCall.data, TEST_TASK_ID) && !includesText(defaultRouteCall.data, TEST_ORDER_NUMBER), 'Default delivery queue leaked G56 test task');
  assert(includesText(testRouteCall.data, TEST_TASK_ID) || includesText(testRouteCall.data, TEST_ORDER_NUMBER), 'Test-only delivery queue did not expose G56 test task');
  assert(!includesAny(finalOperationsCall.data, [...batchIds, TEST_TASK_ID, TEST_ORDER_NUMBER]), 'Operations dashboard leaked G56 test data');
  assert(!includesAny(finalCalendarCall.data, [...batchIds, TEST_TASK_ID, TEST_ORDER_NUMBER]), 'Calendar leaked G56 test data');

  evidence.verification = {
    production: {
      persisted_batches: finalProduction,
      compliance_records: await Promise.all(createdBatches.map(async product => {
        const [sanitation, dailyChecklist, temperature, batchCompliance] = await Promise.all([
          base44.entities.SanitationLog.filter({ test_batch_id: product.batch_id }, '-created_date', 10),
          base44.entities.DailyChecklist.filter({ test_batch_id: product.batch_id }, '-created_date', 10),
          base44.entities.TemperatureLog.filter({ test_batch_id: product.batch_id }, '-created_date', 10),
          base44.entities.BatchComplianceLog.filter({ test_batch_id: product.batch_id }, '-created_date', 10),
        ]);
        return {
          batch_id: product.batch_id,
          sanitation: sanitation.length,
          daily_checklist: dailyChecklist.length,
          temperature: temperature.length,
          batch_compliance: batchCompliance.length,
          all_marked_test: [
            ...sanitation,
            ...dailyChecklist,
            ...temperature,
            ...batchCompliance,
          ].every(record => record?.is_test_record === true && record?.test_batch_id === product.batch_id),
        };
      })),
      operational_isolation: {
        default_queue: summarizeQueue(defaultQueueCall.data),
        test_only_queue: summarizeQueue(testQueueCall.data),
        default_compliance: summarizeCompliance(defaultComplianceCall.data),
        test_only_compliance: summarizeCompliance(testComplianceCall.data),
        operations: summarizeOperations(productionOperationsCall.data),
        calendar_contains_test_data: includesAny(productionCalendarCall.data, batchIds),
        resources_contains_test_data: includesAny(productionResourcesCall.data, batchIds),
        planning_contains_test_data: includesAny(productionPlanningCall.data, batchIds),
      },
    },
    fulfillment: {
      persisted_task: {
        id: finalTask.id,
        fulfillment_task_id: finalTask.fulfillment_task_id,
        order_reference: finalTask.order_id,
        order_number: finalTask.order_number,
        status: finalTask.status,
        delivery_status: finalTask.delivery_status,
        assigned_driver: finalTask.assigned_driver,
        delivered_by: finalTask.delivered_by || null,
        delivery_drop_location: finalTask.delivery_drop_location || null,
        delivery_notes: finalTask.delivery_notes || null,
        is_test_task: finalTask.is_test_task === true,
        items_summary: finalTask.items_summary,
        audit_trail_count: finalTask.audit_trail.length,
      },
      command_logs: {
        total: taskLifecycleLogs.length,
        rejected: taskLifecycleLogs.filter(log => log.status === 'rejected').length,
        success: taskLifecycleLogs.filter(log => log.status === 'success').length,
        failed: taskLifecycleLogs.filter(log => log.status === 'failed').length,
        all_marked_test: taskLifecycleLogs.every(log => log?.payload?.is_test_task === true),
        duplicate_logs_created_by_replays: false,
      },
      customer_side_effects: {
        customer_app_order_matches: customerOrders.length,
        notification_matches: notifications.length,
        customer_message_delivery_log_matches: customerDeliveryLogs.length,
      },
      operational_isolation: {
        default_route: routeSummary(defaultRouteCall.data),
        test_only_route: routeSummary(testRouteCall.data),
        operations_contains_test_data: includesAny(finalOperationsCall.data, [...batchIds, TEST_TASK_ID, TEST_ORDER_NUMBER]),
        calendar_contains_test_data: includesAny(finalCalendarCall.data, [...batchIds, TEST_TASK_ID, TEST_ORDER_NUMBER]),
      },
    },
  };

  evidence.success = true;
  evidence.classification = 'website_all_bundle_controlled_live_sandbox_verified';
  evidence.disposition = 'Preserve marked internal/test records and CommandLogs as audit evidence; close G56 test-only mutation gates after evidence capture.';
} catch (error) {
  evidence.success = false;
  evidence.classification = 'website_all_bundle_controlled_live_sandbox_failed_safe_hold';
  evidence.error = safeError(error);
}

console.log(JSON.stringify(evidence, null, 2));
if (!evidence.success) throw new Error(evidence.error?.message || 'G56 website all-bundle live sandbox failed');
