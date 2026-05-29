import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS_BACK = 6;
const CHICAGO_TZ = 'America/Chicago';

function normalizeText(value) {
  return (value || '').toString().trim();
}

function sanitizeText(value, maxLength = 160) {
  const text = normalizeText(value)
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function todayChicagoDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function parseIsoDate(value, fieldName) {
  const text = normalizeText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  }

  const [year, month, day] = text.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.toISOString().slice(0, 10) !== text) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }

  return text;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(from, to) {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeBoolean(value) {
  return value === true;
}

function safeStringArray(value, maxItems = 30) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxItems).map(item => sanitizeText(item, 120)).filter(Boolean);
}

function safeObjectNumberMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 40)
      .map(([key, count]) => [sanitizeText(key, 80), safeNumber(count)])
      .filter(([key]) => Boolean(key))
  );
}

function sanitizeLog(log) {
  return {
    id: sanitizeText(log?.id, 140) || null,
    type: sanitizeText(log?.type, 80) || null,
    date: sanitizeText(log?.date, 40) || null,
    time: sanitizeText(log?.time, 40) || null,
    status: sanitizeText(log?.status, 80) || null,
    staff_member: sanitizeText(log?.staff_member, 100) || null,
    batch_id: sanitizeText(log?.batch_id, 120) || null,
    product_name: sanitizeText(log?.product_name, 120) || null,
    location: sanitizeText(log?.location, 120) || null,
    value: typeof log?.value === 'number' || typeof log?.value === 'string' ? log.value : null,
    within_range: typeof log?.within_range === 'boolean' ? log.within_range : null,
    updated_date: sanitizeText(log?.updated_date, 80) || null,
  };
}

function sanitizeRecord(row, fields) {
  return Object.fromEntries(
    fields.map(([outputName, sourceName, maxLength = 160]) => {
      const value = row?.[sourceName];
      if (typeof value === 'boolean' || typeof value === 'number') return [outputName, value];
      return [outputName, sanitizeText(value, maxLength) || null];
    })
  );
}

function sanitizeTemperatureRecord(row) {
  return sanitizeRecord(row, [
    ['id', 'id', 140],
    ['location', 'location', 120],
    ['log_date', 'log_date', 40],
    ['log_time', 'log_time', 40],
    ['staff_member', 'staff_member', 120],
    ['temperature', 'temperature', 40],
    ['unit', 'unit', 20],
    ['within_range', 'within_range'],
  ]);
}

function sanitizePhRecord(row) {
  return sanitizeRecord(row, [
    ['id', 'id', 140],
    ['batch_id', 'batch_id', 120],
    ['product_name', 'product_name', 120],
    ['log_date', 'log_date', 40],
    ['log_time', 'log_time', 40],
    ['staff_member', 'staff_member', 120],
    ['ph_value', 'ph_value', 40],
    ['within_range', 'within_range'],
  ]);
}

function sanitizeCcpRecord(row) {
  return sanitizeRecord(row, [
    ['id', 'id', 140],
    ['ccp_point', 'ccp_point', 120],
    ['batch_id', 'batch_id', 120],
    ['log_date', 'log_date', 40],
    ['log_time', 'log_time', 40],
    ['staff_member', 'staff_member', 120],
    ['measurement', 'measurement', 160],
    ['critical_limit', 'critical_limit', 160],
    ['result', 'result', 40],
  ]);
}

function sanitizeSanitationRecord(row) {
  return sanitizeRecord(row, [
    ['id', 'id', 140],
    ['area', 'area', 120],
    ['log_date', 'log_date', 40],
    ['log_time', 'log_time', 40],
    ['staff_member', 'staff_member', 120],
    ['cleaned', 'cleaned'],
    ['sanitized', 'sanitized'],
    ['sanitizer_type', 'sanitizer_type', 120],
    ['sanitizer_level', 'sanitizer_level', 80],
  ]);
}

function sanitizeCorrectiveRecord(row) {
  return sanitizeRecord(row, [
    ['id', 'id', 140],
    ['issue_type', 'issue_type', 120],
    ['log_date', 'log_date', 40],
    ['log_time', 'log_time', 40],
    ['staff_member', 'staff_member', 120],
    ['corrective_action_taken', 'corrective_action_taken', 260],
    ['status', 'status', 80],
    ['verified_by', 'verified_by', 120],
  ]);
}

function sanitizeChecklistRecord(row) {
  return sanitizeRecord(row, [
    ['id', 'id', 140],
    ['checklist_date', 'checklist_date', 40],
    ['staff_member', 'staff_member', 120],
    ['shift', 'shift', 40],
    ['morning_fridge_temp_logged', 'morning_fridge_temp_logged'],
    ['morning_fridge_time', 'morning_fridge_time', 20],
    ['evening_fridge_temp_logged', 'evening_fridge_temp_logged'],
    ['evening_fridge_time', 'evening_fridge_time', 20],
    ['sanitizer_levels_checked', 'sanitizer_levels_checked'],
    ['sanitizer_check_time', 'sanitizer_check_time', 20],
    ['equipment_sanitized', 'equipment_sanitized'],
    ['sanitization_time', 'sanitization_time', 20],
    ['work_areas_cleaned', 'work_areas_cleaned'],
    ['cleaning_time', 'cleaning_time', 20],
    ['batch_logs_completed', 'batch_logs_completed'],
    ['batches_logged', 'batches_logged', 500],
    ['ccp_logs_completed', 'ccp_logs_completed'],
    ['ccp_notes', 'ccp_notes', 500],
    ['issues_reported', 'issues_reported', 1000],
    ['overall_status', 'overall_status', 80],
    ['completed_at', 'completed_at', 80],
    ['manager_reviewed', 'manager_reviewed'],
  ]);
}

function sanitizeBatchComplianceRecord(row) {
  return sanitizeRecord(row, [
    ['id', 'id', 140],
    ['batch_id', 'batch_id', 120],
    ['juice_flavor', 'juice_flavor', 120],
    ['date', 'date', 40],
    ['quantity_produced', 'quantity_produced', 40],
    ['verified_by', 'verified_by', 120],
    ['passed_failed', 'passed_failed', 80],
  ]);
}

function sanitizeLabelAllergenReview(row) {
  return {
    ...sanitizeRecord(row, [
      ['id', 'id', 140],
      ['product_name', 'product_name', 160],
      ['label_version', 'label_version', 80],
      ['label_file_url', 'label_file_url', 500],
      ['ingredient_statement', 'ingredient_statement', 2000],
      ['allergen_statement', 'allergen_statement', 1000],
      ['contains_allergens', 'contains_allergens'],
      ['may_contain_statement', 'may_contain_statement', 1000],
      ['nutrition_label_status', 'nutrition_label_status', 80],
      ['net_volume', 'net_volume', 80],
      ['business_name_and_address', 'business_name_and_address', 500],
      ['barcode_or_sku', 'barcode_or_sku', 120],
      ['review_status', 'review_status', 80],
      ['reviewed_by', 'reviewed_by', 160],
      ['review_date', 'review_date', 40],
      ['approval_status', 'approval_status', 80],
      ['approved_by', 'approved_by', 160],
      ['approval_date', 'approval_date', 40],
      ['next_review_date', 'next_review_date', 40],
      ['notes', 'notes', 2000],
      ['updated_date', 'updated_date', 80],
    ]),
    allergens_present: safeStringArray(row?.allergens_present),
  };
}

function sanitizeHaccpPlanReview(row) {
  return sanitizeRecord(row, [
    ['id', 'id', 140],
    ['plan_version', 'plan_version', 80],
    ['review_period', 'review_period', 120],
    ['review_date', 'review_date', 40],
    ['reviewed_by', 'reviewed_by', 160],
    ['approval_status', 'approval_status', 80],
    ['approved_by', 'approved_by', 160],
    ['approval_date', 'approval_date', 40],
    ['hazard_analysis_reviewed', 'hazard_analysis_reviewed'],
    ['ccp_steps_reviewed', 'ccp_steps_reviewed'],
    ['critical_limits_reviewed', 'critical_limits_reviewed'],
    ['monitoring_procedures_reviewed', 'monitoring_procedures_reviewed'],
    ['corrective_actions_reviewed', 'corrective_actions_reviewed'],
    ['verification_procedures_reviewed', 'verification_procedures_reviewed'],
    ['recordkeeping_reviewed', 'recordkeeping_reviewed'],
    ['changes_made', 'changes_made'],
    ['change_summary', 'change_summary', 2000],
    ['linked_document_url', 'linked_document_url', 500],
    ['next_review_date', 'next_review_date', 40],
    ['notes', 'notes', 2000],
    ['updated_date', 'updated_date', 80],
  ]);
}

function sanitizeComplianceDocument(row) {
  return sanitizeRecord(row, [
    ['id', 'id', 140],
    ['name', 'name', 160],
    ['type', 'type', 80],
    ['status', 'status', 80],
    ['expiry_date', 'expiry_date', 40],
    ['issued_date', 'issued_date', 40],
    ['owner', 'owner', 160],
    ['issuing_body', 'issuing_body', 160],
    ['file_url', 'file_url', 500],
    ['reminder_days', 'reminder_days'],
    ['notes', 'notes', 1000],
    ['updated_date', 'updated_date', 80],
  ]);
}

function newestFirst(rows, dateField, limit = 50) {
  return [...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => String(b?.[dateField] || b?.updated_date || b?.created_date || '').localeCompare(String(a?.[dateField] || a?.updated_date || a?.created_date || '')))
    .slice(0, limit);
}

function inDateRange(value, dateFrom, dateTo) {
  const text = sanitizeText(value, 40);
  return Boolean(text && text >= dateFrom && text <= dateTo);
}

function nativeComplianceLog(entityName, row, type) {
  const valueMap = {
    temperature: row?.temperature,
    ph: row?.ph_value,
    ccp: row?.measurement,
    sanitation: row?.cleaned && row?.sanitized ? 'complete' : 'incomplete',
    corrective: row?.status,
    daily_checklist: row?.overall_status,
    batch: row?.quantity_produced,
    alert: row?.severity,
    unified: row?.status,
  };

  return sanitizeLog({
    id: row?.id,
    type,
    date: row?.log_date || row?.checklist_date || row?.date || row?.triggered_date,
    time: row?.log_time || row?.triggered_time,
    status: row?.status || row?.overall_status || row?.result || row?.passed_failed || (row?.within_range === false ? 'out_of_range' : 'ok'),
    staff_member: row?.staff_member || row?.verified_by || row?.resolved_by,
    batch_id: row?.batch_id,
    product_name: row?.product_name || row?.juice_flavor,
    location: row?.location || row?.area || row?.ccp_point || row?.alert_type,
    value: valueMap[type],
    within_range: typeof row?.within_range === 'boolean' ? row.within_range : null,
    updated_date: row?.updated_date || row?.created_date,
    entity: entityName,
  });
}

function countWhere(rows, predicate) {
  return (Array.isArray(rows) ? rows : []).filter(predicate).length;
}

async function safeEntityList(base44, entityName, sort, limit = 500) {
  try {
    const entity = base44.asServiceRole.entities?.[entityName];
    if (!entity?.list) return { rows: [], warning: `${entityName}_unavailable` };
    const rows = await entity.list(sort, limit);
    return { rows: Array.isArray(rows) ? rows : [], warning: null };
  } catch (error) {
    return { rows: [], warning: `${entityName}_read_failed` };
  }
}

async function loadNativeComplianceSummary(base44, dateFrom, dateTo) {
  const [
    temperatureResult,
    phResult,
    ccpResult,
    sanitationResult,
    checklistResult,
    correctiveResult,
    batchResult,
    alertResult,
    unifiedResult,
    labelResult,
    haccpResult,
    documentResult,
  ] = await Promise.all([
    safeEntityList(base44, 'TemperatureLog', '-log_date', 500),
    safeEntityList(base44, 'pHLog', '-log_date', 500),
    safeEntityList(base44, 'CCPLog', '-log_date', 500),
    safeEntityList(base44, 'SanitationLog', '-log_date', 500),
    safeEntityList(base44, 'DailyChecklist', '-checklist_date', 500),
    safeEntityList(base44, 'CorrectiveActionLog', '-log_date', 500),
    safeEntityList(base44, 'BatchComplianceLog', '-date', 500),
    safeEntityList(base44, 'ComplianceAlert', '-triggered_date', 500),
    safeEntityList(base44, 'ComplianceLog', '-log_date', 500),
    safeEntityList(base44, 'LabelAllergenReview', '-updated_date', 100),
    safeEntityList(base44, 'HACCPPlanReview', '-review_date', 100),
    safeEntityList(base44, 'ComplianceDoc', '-expiry_date', 100),
  ]);

  const warnings = [
    temperatureResult.warning,
    phResult.warning,
    ccpResult.warning,
    sanitationResult.warning,
    checklistResult.warning,
    correctiveResult.warning,
    batchResult.warning,
    alertResult.warning,
    unifiedResult.warning,
    labelResult.warning,
    haccpResult.warning,
    documentResult.warning,
  ].filter(Boolean);

  const temperature = temperatureResult.rows.filter(row => inDateRange(row.log_date, dateFrom, dateTo));
  const ph = phResult.rows.filter(row => inDateRange(row.log_date, dateFrom, dateTo));
  const ccp = ccpResult.rows.filter(row => inDateRange(row.log_date, dateFrom, dateTo));
  const sanitation = sanitationResult.rows.filter(row => inDateRange(row.log_date, dateFrom, dateTo));
  const checklists = checklistResult.rows.filter(row => inDateRange(row.checklist_date, dateFrom, dateTo));
  const corrective = correctiveResult.rows.filter(row => inDateRange(row.log_date, dateFrom, dateTo));
  const batch = batchResult.rows.filter(row => inDateRange(row.date, dateFrom, dateTo));
  const alerts = alertResult.rows.filter(row => inDateRange(row.triggered_date, dateFrom, dateTo));
  const unified = unifiedResult.rows.filter(row => inDateRange(row.log_date, dateFrom, dateTo));
  const labelReviews = labelResult.rows;
  const haccpReviews = haccpResult.rows;
  const complianceDocuments = documentResult.rows;

  const recentLogs = [
    ...temperature.map(row => nativeComplianceLog('TemperatureLog', row, 'temperature')),
    ...ph.map(row => nativeComplianceLog('pHLog', row, 'ph')),
    ...ccp.map(row => nativeComplianceLog('CCPLog', row, 'ccp')),
    ...sanitation.map(row => nativeComplianceLog('SanitationLog', row, 'sanitation')),
    ...checklists.map(row => nativeComplianceLog('DailyChecklist', row, 'daily_checklist')),
    ...corrective.map(row => nativeComplianceLog('CorrectiveActionLog', row, 'corrective')),
    ...batch.map(row => nativeComplianceLog('BatchComplianceLog', row, 'batch')),
    ...unified.map(row => nativeComplianceLog('ComplianceLog', row, 'unified')),
  ]
    .sort((a, b) => String(b.updated_date || b.date || '').localeCompare(String(a.updated_date || a.date || '')))
    .slice(0, 80);

  const activeAlerts = alerts
    .filter(row => String(row?.status || '').toLowerCase() === 'active')
    .slice(0, 25)
    .map(row => ({
      id: sanitizeText(row?.id, 140) || null,
      alert_type: sanitizeText(row?.alert_type, 80) || null,
      severity: sanitizeText(row?.severity, 40) || null,
      message: sanitizeText(row?.message, 220) || null,
      triggered_date: sanitizeText(row?.triggered_date, 40) || null,
      triggered_time: sanitizeText(row?.triggered_time, 40) || null,
      status: sanitizeText(row?.status, 40) || null,
    }));

  const issues = {
    temp_out_of_range: countWhere(temperature, row => row.within_range === false),
    ph_out_of_range: countWhere(ph, row => row.within_range === false),
    ccp_failed: countWhere(ccp, row => row.result === 'Fail'),
    sanitation_issues: countWhere(sanitation, row => row.cleaned !== true || row.sanitized !== true),
    incomplete_checklists: countWhere(checklists, row => row.overall_status === 'Incomplete'),
    open_corrective_actions: countWhere(corrective, row => !['Completed', 'Verified'].includes(row.status)),
    failed_batch_logs: countWhere(batch, row => row.passed_failed === 'failed'),
    active_alerts: activeAlerts.length,
  };

  return {
    read_only: true,
    source: 'customer_app_native',
    summary: {
      temperature: temperature.length,
      ph: ph.length,
      ccp: ccp.length,
      sanitation: sanitation.length,
      daily_checklists: checklists.length,
      corrective_actions: corrective.length,
      batch_compliance_logs: batch.length,
      compliance_alerts: alerts.length,
      unified_logs: unified.length,
      label_allergen_reviews: labelReviews.length,
      haccp_plan_reviews: haccpReviews.length,
      compliance_documents: complianceDocuments.length,
    },
    issues: {
      ...issues,
      total_attention_items: Object.values(issues).reduce((sum, value) => sum + safeNumber(value), 0),
    },
    active_alerts: activeAlerts,
    recent_logs: recentLogs,
    records: {
      temperature: newestFirst(temperature, 'log_date').map(sanitizeTemperatureRecord),
      ph: newestFirst(ph, 'log_date').map(sanitizePhRecord),
      ccp: newestFirst(ccp, 'log_date').map(sanitizeCcpRecord),
      sanitation: newestFirst(sanitation, 'log_date').map(sanitizeSanitationRecord),
      corrective_actions: newestFirst(corrective, 'log_date').map(sanitizeCorrectiveRecord),
      daily_checklists: newestFirst(checklists, 'checklist_date').map(sanitizeChecklistRecord),
      batch_compliance: newestFirst(batch, 'date').map(sanitizeBatchComplianceRecord),
      label_allergen_reviews: newestFirst(labelReviews, 'updated_date', 100).map(sanitizeLabelAllergenReview),
      haccp_plan_reviews: newestFirst(haccpReviews, 'review_date', 100).map(sanitizeHaccpPlanReview),
      compliance_documents: newestFirst(complianceDocuments, 'expiry_date', 100).map(sanitizeComplianceDocument),
    },
    warnings,
  };
}

function sanitizeBatch(batch) {
  return {
    id: sanitizeText(batch?.id, 140) || null,
    batch_id: sanitizeText(batch?.batch_id, 120) || null,
    product_name: sanitizeText(batch?.product_name, 120) || null,
    production_date: sanitizeText(batch?.production_date, 40) || null,
    status: sanitizeText(batch?.status, 80) || null,
    compliance_log_id_present: safeBoolean(batch?.compliance_log_id_present),
    corrective_action_required: safeBoolean(batch?.corrective_action_required),
    corrective_action_log_id_present: safeBoolean(batch?.corrective_action_log_id_present),
    is_locked: safeBoolean(batch?.is_locked),
  };
}

function sanitizeHubResponse(data, fallbackDateFrom, fallbackDateTo) {
  return {
    success: data?.success === true,
    dry_run: data?.dry_run === true,
    read_only: data?.read_only === true,
    date_from: sanitizeText(data?.date_from, 40) || fallbackDateFrom,
    date_to: sanitizeText(data?.date_to, 40) || fallbackDateTo,
    generated_at: sanitizeText(data?.generated_at, 80) || null,
    summary: safeObjectNumberMap(data?.summary),
    issues: safeObjectNumberMap(data?.issues),
    recent_logs: Array.isArray(data?.recent_logs) ? data.recent_logs.slice(0, 60).map(sanitizeLog) : [],
    batch_compliance: Array.isArray(data?.batch_compliance) ? data.batch_compliance.slice(0, 60).map(sanitizeLog) : [],
    attention_batches: Array.isArray(data?.attention_batches) ? data.attention_batches.slice(0, 60).map(sanitizeBatch) : [],
    warnings: safeStringArray(data?.warnings),
  };
}

function fallbackHubUnavailableSummary(dateFrom, dateTo, reason, hubStatus = null) {
  return {
    success: true,
    dry_run: true,
    read_only: true,
    hub_unavailable: true,
    date_from: dateFrom,
    date_to: dateTo,
    generated_at: new Date().toISOString(),
    summary: {
      temperature: 0,
      ph: 0,
      ccp: 0,
      sanitation: 0,
      daily_checklists: 0,
      corrective_actions: 0,
      batch_compliance_logs: 0,
      unified_logs: 0,
      production_batches: 0,
    },
    issues: {
      temp_out_of_range: 0,
      ph_out_of_range: 0,
      ccp_failed: 0,
      sanitation_issues: 0,
      incomplete_checklists: 0,
      open_corrective_actions: 0,
      failed_batch_logs: 0,
      batches_missing_compliance_log: 0,
      total_attention_items: 0,
    },
    recent_logs: [],
    batch_compliance: [],
    attention_batches: [],
    warnings: [
      sanitizeText(reason, 160) || 'Hub compliance summary is temporarily unavailable',
      ...(hubStatus ? [`hub_status_${hubStatus}`] : []),
    ],
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    if (req.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405 });

    const body = await req.json().catch(() => ({}));
    let dateFrom;
    let dateTo;
    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const today = todayChicagoDate();
    if (!dateFrom && !dateTo) {
      dateTo = today;
      dateFrom = addDays(today, -DEFAULT_RANGE_DAYS_BACK);
    } else if (dateFrom && !dateTo) {
      dateTo = addDays(dateFrom, DEFAULT_RANGE_DAYS_BACK);
    } else if (!dateFrom && dateTo) {
      dateFrom = addDays(dateTo, -DEFAULT_RANGE_DAYS_BACK);
    }

    if (dateTo < dateFrom) {
      return Response.json({ error: 'date_to must be on or after date_from' }, { status: 400 });
    }

    if (daysInclusive(dateFrom, dateTo) > MAX_RANGE_DAYS) {
      return Response.json({
        error: `Date range must be ${MAX_RANGE_DAYS} days or fewer`,
        max_range_days: MAX_RANGE_DAYS,
      }, { status: 400 });
    }

    const native = await loadNativeComplianceSummary(base44, dateFrom, dateTo);

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      const fallback = fallbackHubUnavailableSummary(
        dateFrom,
        dateTo,
        'Hub compliance ops summary service is not configured',
        503
      );
      return Response.json({
        ...fallback,
        native,
        summary: {
          ...fallback.summary,
          native_temperature: native.summary.temperature,
          native_ph: native.summary.ph,
          native_ccp: native.summary.ccp,
          native_sanitation: native.summary.sanitation,
          native_daily_checklists: native.summary.daily_checklists,
          native_corrective_actions: native.summary.corrective_actions,
          native_batch_compliance_logs: native.summary.batch_compliance_logs,
        },
        issues: {
          ...fallback.issues,
          native_attention_items: native.issues.total_attention_items,
        },
        recent_logs: native.recent_logs,
        warnings: [...fallback.warnings, ...native.warnings],
      });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });

    const hubResponse = await fetch(`${hubBase}/functions/getComplianceOpsSummaryForCustomerApp?${params.toString()}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
    });

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubResponse.ok) {
      const fallback = fallbackHubUnavailableSummary(
        dateFrom,
        dateTo,
        sanitizeText(hubData?.error, 160) || 'Unable to load Hub compliance ops summary',
        hubResponse.status
      );
      return Response.json({
        ...fallback,
        native,
        summary: {
          ...fallback.summary,
          native_temperature: native.summary.temperature,
          native_ph: native.summary.ph,
          native_ccp: native.summary.ccp,
          native_sanitation: native.summary.sanitation,
          native_daily_checklists: native.summary.daily_checklists,
          native_corrective_actions: native.summary.corrective_actions,
          native_batch_compliance_logs: native.summary.batch_compliance_logs,
        },
        issues: {
          ...fallback.issues,
          native_attention_items: native.issues.total_attention_items,
        },
        recent_logs: native.recent_logs,
        warnings: [...fallback.warnings, ...native.warnings],
      });
    }

    const hub = sanitizeHubResponse(hubData, dateFrom, dateTo);
    return Response.json({
      ...hub,
      native,
      summary: {
        ...hub.summary,
        native_temperature: native.summary.temperature,
        native_ph: native.summary.ph,
        native_ccp: native.summary.ccp,
        native_sanitation: native.summary.sanitation,
        native_daily_checklists: native.summary.daily_checklists,
        native_corrective_actions: native.summary.corrective_actions,
        native_batch_compliance_logs: native.summary.batch_compliance_logs,
      },
      issues: {
        ...hub.issues,
        native_attention_items: native.issues.total_attention_items,
      },
      warnings: [...safeStringArray(hub.warnings), ...native.warnings],
    });
  } catch (error) {
    console.error('[getAdminComplianceOpsSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load compliance ops summary' }, { status: 500 });
  }
});
