import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const ALLOWED_TYPES = new Set([
  'temperature',
  'ph',
  'ccp',
  'sanitation',
  'corrective_action',
  'daily_checklist',
  'batch_compliance',
  'unified',
  'label_allergen',
  'haccp_plan',
]);

function text(value, max = 220) {
  const normalized = (value ?? '').toString().trim().replace(/\s+/g, ' ');
  if (!normalized) return '';
  return normalized.length > max ? `${normalized.slice(0, max - 1).trim()}...` : normalized;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function bool(value) {
  return value === true;
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).map(item => text(item, 120)).filter(Boolean);
}

function ingredientRows(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 80).map(row => {
    const source = row && typeof row === 'object' ? row : {};
    return compact({
      ingredient_name: text(source.ingredient_name || source.name, 160),
      quantity: optionalNumber(source.quantity),
      unit: text(source.unit, 40),
      lot_number: text(source.lot_number, 120),
    });
  }).filter(row => row.ingredient_name);
}

function batchLinkFields(data) {
  const relatedBatchIds = stringArray(data?.related_batch_ids || data?.batch_ids);
  const relatedSourceBatchIds = stringArray(data?.related_source_production_batch_ids || data?.source_production_batch_ids || data?.production_batch_ids);
  return compact({
    batch_id: text(data?.batch_id, 120),
    source_production_batch_id: text(data?.source_production_batch_id || data?.production_batch_id, 160),
    related_batch_ids: relatedBatchIds.length > 0 ? relatedBatchIds : undefined,
    related_source_production_batch_ids: relatedSourceBatchIds.length > 0 ? relatedSourceBatchIds : undefined,
  });
}

async function resolveLinkedProductionBatch(base44, data) {
  const entity = base44.asServiceRole?.entities?.ProductionBatch;
  if (!entity) return null;

  const sourceId = text(data?.source_production_batch_id || data?.production_batch_id, 160);
  if (sourceId && typeof entity.get === 'function') {
    const byId = await entity.get(sourceId).catch(() => null);
    if (byId?.id) return byId;
  }

  const displayIds = [
    text(data?.batch_id, 120),
    ...stringArray(data?.related_batch_ids || data?.batch_ids),
  ].filter(Boolean);
  if (typeof entity.filter === 'function') {
    for (const batchId of displayIds) {
      const matches = await entity.filter({ batch_id: batchId }, '-created_date', 2).catch(() => []);
      if (Array.isArray(matches) && matches.length === 1) return matches[0];
    }
  }

  return null;
}

async function deriveComplianceTestContext(base44, data) {
  const linkedBatch = await resolveLinkedProductionBatch(base44, data);
  const requestedTestRecord = data?.is_test_record === true;
  if (requestedTestRecord && linkedBatch?.is_test_batch !== true) {
    throw new Error('test_record_requires_linked_test_batch');
  }
  if (linkedBatch?.is_test_batch === true) {
    return {
      is_test_record: true,
      test_batch_id: text(linkedBatch.batch_id || linkedBatch.id, 120),
    };
  }
  return { is_test_record: false };
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentTime() {
  return new Date().toTimeString().slice(0, 5);
}

function safeDate(value) {
  const normalized = text(value, 40);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : todayIso();
}

function safeTime(value) {
  const normalized = text(value, 20);
  return /^\d{2}:\d{2}/.test(normalized) ? normalized.slice(0, 5) : currentTime();
}

function optionalTime(value) {
  const normalized = text(value, 20);
  return /^\d{2}:\d{2}/.test(normalized) ? normalized.slice(0, 5) : '';
}

function baseFields(data, user) {
  return {
    log_date: safeDate(data?.log_date),
    log_time: safeTime(data?.log_time),
    staff_member: text(data?.staff_member || user?.full_name || user?.email, 120),
    notes: text(data?.notes, 1000),
  };
}

function compact(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
}

function temperatureRecord(data, user) {
  const min = number(data?.min_range, 35);
  const max = number(data?.max_range, 40);
  const temperature = number(data?.temperature, NaN);
  const withinRange = Number.isFinite(temperature) && temperature >= min && temperature <= max;
  return compact({
    ...baseFields(data, user),
    ...batchLinkFields(data),
    location: text(data?.location || 'Cold Room 1', 120),
    temperature,
    unit: text(data?.unit || 'F', 10),
    production_date: safeDate(data?.production_date || data?.log_date),
    min_range: min,
    max_range: max,
    within_range: withinRange,
    shift: text(data?.shift || 'Morning', 40),
  });
}

function phRecord(data, user) {
  const min = number(data?.min_ph, 4);
  const max = number(data?.max_ph, 5);
  const phValue = number(data?.ph_value, NaN);
  const withinRange = Number.isFinite(phValue) && phValue >= min && phValue <= max;
  return compact({
    ...baseFields(data, user),
    batch_id: text(data?.batch_id, 120),
    product_name: text(data?.product_name, 160),
    ph_value: phValue,
    min_ph: min,
    max_ph: max,
    within_range: withinRange,
  });
}

function ccpRecord(data, user) {
  return compact({
    ...baseFields(data, user),
    ccp_point: text(data?.ccp_point || 'Pasteurization', 120),
    batch_id: text(data?.batch_id, 120),
    measurement: text(data?.measurement, 160),
    critical_limit: text(data?.critical_limit, 160),
    result: text(data?.result || 'Pass', 20) === 'Fail' ? 'Fail' : 'Pass',
  });
}

function sanitationRecord(data, user) {
  return compact({
    ...baseFields(data, user),
    ...batchLinkFields(data),
    area: text(data?.area || 'Prep Area', 120),
    sanitizer_type: text(data?.sanitizer_type || 'Bleach Solution', 120),
    sanitizer_level: text(data?.sanitizer_level || 'Adequate', 80),
    cleaned: bool(data?.cleaned),
    sanitized: bool(data?.sanitized),
    verified_by: text(data?.verified_by, 120),
  });
}

function correctiveRecord(data, user) {
  return compact({
    ...baseFields(data, user),
    issue_type: text(data?.issue_type || 'Temperature Out of Range', 120),
    related_log_id: text(data?.related_log_id, 140),
    issue_description: text(data?.issue_description, 1000),
    corrective_action_taken: text(data?.corrective_action_taken, 1200),
    action_completed_time: optionalTime(data?.action_completed_time),
    verification: text(data?.verification, 600),
    verified_by: text(data?.verified_by, 120),
    status: text(data?.status || 'Initiated', 80),
  });
}

function checklistRecord(data, user) {
  const batchRefs = stringArray(data?.related_batch_ids || data?.batch_ids);
  const linkFields = batchLinkFields(data);
  const batchesLogged = text(
    data?.batches_logged || data?.batch_id || batchRefs.join(', '),
    500
  );
  return compact({
    checklist_date: safeDate(data?.checklist_date),
    staff_member: text(data?.staff_member || user?.full_name || user?.email, 120),
    ...linkFields,
    shift: text(data?.shift || 'Morning', 40),
    morning_fridge_temp_logged: bool(data?.morning_fridge_temp_logged),
    morning_fridge_time: text(data?.morning_fridge_time, 20),
    evening_fridge_temp_logged: bool(data?.evening_fridge_temp_logged),
    evening_fridge_time: text(data?.evening_fridge_time, 20),
    sanitizer_levels_checked: bool(data?.sanitizer_levels_checked),
    sanitizer_check_time: text(data?.sanitizer_check_time, 20),
    equipment_sanitized: bool(data?.equipment_sanitized),
    sanitization_time: text(data?.sanitization_time, 20),
    work_areas_cleaned: bool(data?.work_areas_cleaned),
    cleaning_time: text(data?.cleaning_time, 20),
    batch_logs_completed: bool(data?.batch_logs_completed),
    batches_logged: batchesLogged,
    ccp_logs_completed: bool(data?.ccp_logs_completed),
    ccp_notes: text(data?.ccp_notes, 500),
    issues_reported: text(data?.issues_reported, 1000),
    overall_status: text(data?.overall_status || 'Incomplete', 80),
    completed_at: text(data?.completed_at || new Date().toISOString(), 80),
    manager_reviewed: bool(data?.manager_reviewed),
    manager_comments: text(data?.manager_comments, 1000),
  });
}

function unifiedRecord(data, user) {
  return compact({
    log_type: text(data?.log_type, 80),
    log_date: safeDate(data?.log_date),
    log_time: safeTime(data?.log_time),
    staff_member: text(data?.staff_member || user?.full_name || user?.email, 120),
    shift: text(data?.shift || 'Morning', 40),
    data: data?.data && typeof data.data === 'object' ? data.data : {},
    status: text(data?.status || 'pass', 80),
    notes: text(data?.notes, 1000),
    within_range: data?.within_range === true,
  });
}

function labelAllergenRecord(data) {
  return compact({
    product_name: text(data?.product_name, 160),
    label_version: text(data?.label_version, 80),
    label_file_url: text(data?.label_file_url, 500),
    ingredient_statement: text(data?.ingredient_statement, 2000),
    allergen_statement: text(data?.allergen_statement, 1000),
    contains_allergens: bool(data?.contains_allergens),
    allergens_present: stringArray(data?.allergens_present),
    may_contain_statement: text(data?.may_contain_statement, 1000),
    nutrition_label_status: text(data?.nutrition_label_status || 'Not Required', 80),
    net_volume: text(data?.net_volume, 80),
    business_name_and_address: text(data?.business_name_and_address, 500),
    barcode_or_sku: text(data?.barcode_or_sku, 120),
    review_status: text(data?.review_status || 'Pending', 80),
    reviewed_by: text(data?.reviewed_by, 160),
    review_date: text(data?.review_date, 40),
    approval_status: text(data?.approval_status || 'Pending', 80),
    approved_by: text(data?.approved_by, 160),
    approval_date: text(data?.approval_date, 40),
    next_review_date: text(data?.next_review_date, 40),
    notes: text(data?.notes, 2000),
  });
}

function haccpPlanRecord(data) {
  return compact({
    plan_version: text(data?.plan_version, 80),
    review_period: text(data?.review_period, 120),
    review_date: text(data?.review_date, 40),
    reviewed_by: text(data?.reviewed_by, 160),
    approval_status: text(data?.approval_status || 'Pending', 80),
    approved_by: text(data?.approved_by, 160),
    approval_date: text(data?.approval_date, 40),
    hazard_analysis_reviewed: bool(data?.hazard_analysis_reviewed),
    ccp_steps_reviewed: bool(data?.ccp_steps_reviewed),
    critical_limits_reviewed: bool(data?.critical_limits_reviewed),
    monitoring_procedures_reviewed: bool(data?.monitoring_procedures_reviewed),
    corrective_actions_reviewed: bool(data?.corrective_actions_reviewed),
    verification_procedures_reviewed: bool(data?.verification_procedures_reviewed),
    recordkeeping_reviewed: bool(data?.recordkeeping_reviewed),
    changes_made: bool(data?.changes_made),
    change_summary: text(data?.change_summary, 2000),
    linked_document_url: text(data?.linked_document_url, 500),
    next_review_date: text(data?.next_review_date, 40),
    notes: text(data?.notes, 2000),
  });
}

function batchComplianceRecord(data, user) {
  const passedFailed = text(data?.passed_failed || data?.status || 'passed', 20).toLowerCase() === 'failed' ? 'failed' : 'passed';
  return compact({
    date: safeDate(data?.date || data?.log_date),
    batch_id: text(data?.batch_id, 120),
    juice_flavor: text(data?.juice_flavor || data?.product_name || data?.flavor, 160),
    ingredients: ingredientRows(data?.ingredients),
    start_time: text(data?.start_time, 80),
    end_time: text(data?.end_time, 80),
    quantity_produced: number(data?.quantity_produced ?? data?.actual_units ?? data?.units_produced, NaN),
    staff_on_duty: stringArray(data?.staff_on_duty),
    pH_result: optionalNumber(data?.pH_result ?? data?.ph_result ?? data?.ph_value),
    passed_failed: passedFailed,
    notes: text(data?.notes, 2000),
    verified_by: text(data?.verified_by || user?.email, 160),
    verified_at: text(data?.verified_at || new Date().toISOString(), 80),
    source_production_batch_id: text(data?.source_production_batch_id || data?.production_batch_id, 160),
    locked: true,
  });
}

function buildRecord(recordType, data, user) {
  if (recordType === 'temperature') return { entity: 'TemperatureLog', record: temperatureRecord(data, user) };
  if (recordType === 'ph') return { entity: 'pHLog', record: phRecord(data, user) };
  if (recordType === 'ccp') return { entity: 'CCPLog', record: ccpRecord(data, user) };
  if (recordType === 'sanitation') return { entity: 'SanitationLog', record: sanitationRecord(data, user) };
  if (recordType === 'corrective_action') return { entity: 'CorrectiveActionLog', record: correctiveRecord(data, user) };
  if (recordType === 'daily_checklist') return { entity: 'DailyChecklist', record: checklistRecord(data, user) };
  if (recordType === 'batch_compliance') return { entity: 'BatchComplianceLog', record: batchComplianceRecord(data, user) };
  if (recordType === 'label_allergen') return { entity: 'LabelAllergenReview', record: labelAllergenRecord(data) };
  if (recordType === 'haccp_plan') return { entity: 'HACCPPlanReview', record: haccpPlanRecord(data) };
  return { entity: 'ComplianceLog', record: unifiedRecord(data, user) };
}

function validate(recordType, record) {
  if (recordType === 'temperature' && !Number.isFinite(record.temperature)) return 'temperature_required';
  if (recordType === 'ph' && (!record.batch_id || !Number.isFinite(record.ph_value))) return 'ph_batch_and_value_required';
  if (recordType === 'ccp' && (!record.batch_id || !record.measurement)) return 'ccp_batch_and_measurement_required';
  if (recordType === 'sanitation' && (!record.cleaned || !record.sanitized)) return 'sanitation_cleaned_and_sanitized_required';
  if (recordType === 'corrective_action' && !record.corrective_action_taken) return 'corrective_action_required';
  if (recordType === 'batch_compliance' && (!record.batch_id || !record.juice_flavor || !Number.isFinite(record.quantity_produced) || record.quantity_produced <= 0)) return 'batch_id_product_and_quantity_required';
  if (recordType === 'batch_compliance' && !['passed', 'failed'].includes(record.passed_failed)) return 'batch_pass_fail_status_required';
  if (recordType === 'unified' && !record.log_type) return 'compliance_log_type_required';
  if (recordType === 'label_allergen' && !record.product_name) return 'product_name_required';
  if (recordType === 'haccp_plan' && (!record.plan_version || !record.review_date)) return 'haccp_plan_version_and_review_date_required';
  return null;
}

async function maybeCreateComplianceAlert(base44, recordType, record, created) {
  if (recordType === 'ccp' && record.result === 'Fail') {
    await base44.asServiceRole.entities.ComplianceAlert.create({
      alert_type: 'Failure',
      severity: 'Critical',
      message: `CCP FAILURE: ${record.ccp_point} failed for batch ${record.batch_id}. Immediate corrective action required.`,
      related_log_id: created?.id,
      related_log_type: 'CCPLog',
      triggered_date: record.log_date,
      triggered_time: record.log_time,
      status: 'Active',
    });
    return true;
  }

  if ((recordType === 'temperature' || recordType === 'ph') && record.within_range === false) {
    await base44.asServiceRole.functions.invoke('validateComplianceEntry', {
      log_type: recordType === 'temperature' ? 'temperature' : 'pH',
      data: record,
      min_value: recordType === 'temperature' ? record.min_range : record.min_ph,
      max_value: recordType === 'temperature' ? record.max_range : record.max_ph,
    }).catch(() => null);
    return true;
  }

  return false;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error: 'method_not_allowed' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    if (!user || user.role !== 'admin') {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }

    const recordType = text(body?.record_type || body?.type, 80).toLowerCase();
    if (!ALLOWED_TYPES.has(recordType)) {
      return Response.json({ success: false, error: 'unsupported_record_type' }, { status: 400 });
    }

    const data = body?.data && typeof body.data === 'object' ? body.data : {};
    const { entity, record } = buildRecord(recordType, data, user);
    if (['temperature', 'sanitation', 'daily_checklist', 'batch_compliance'].includes(recordType)) {
      Object.assign(record, await deriveComplianceTestContext(base44, data));
    }
    const validationError = validate(recordType, record);
    if (validationError) {
      return Response.json({ success: false, error: validationError }, { status: 400 });
    }

    const entityApi = base44.asServiceRole.entities?.[entity];
    if (!entityApi?.create) {
      return Response.json({ success: false, error: 'entity_unavailable', entity }, { status: 503 });
    }

    let action = 'created';
    let saved;
    const existingId = text(body?.existing_id || data?.id, 140);
    if (['daily_checklist', 'label_allergen', 'haccp_plan'].includes(recordType) && existingId && entityApi.update) {
      if (recordType === 'daily_checklist' && typeof entityApi.get === 'function') {
        const existing = await entityApi.get(existingId).catch(() => null);
        if (!existing) {
          return Response.json({ success: false, error: 'existing_record_not_found' }, { status: 404 });
        }
        if ((existing.is_test_record === true) !== (record.is_test_record === true)) {
          return Response.json({ success: false, error: 'test_and_operational_checklists_cannot_be_merged' }, { status: 409 });
        }
      }
      saved = await entityApi.update(existingId, record);
      action = 'updated';
    } else {
      saved = await entityApi.create(record);
    }

    const alertCreated = await maybeCreateComplianceAlert(base44, recordType, record, saved);

    return Response.json({
      success: true,
      action,
      record_type: recordType,
      entity,
      record_id: saved?.id || existingId || null,
      alert_or_validation_queued: alertCreated,
      native_compliance_write: true,
      customer_notification_sent: false,
      provider_calls: false,
    });
  } catch (error) {
    console.error('[saveAdminComplianceRecord] Error:', error?.message || 'unknown error');
    return Response.json({ success: false, error: 'Unable to save compliance record' }, { status: 500 });
  }
});
