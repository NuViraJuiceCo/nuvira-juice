import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');

const ALLOWED_BODY_KEYS = new Set([
  'production_batch_id',
  'batch_id',
  'expected_status',
  'request_id',
]);

const SAFE_ARRAY_LIMIT = 40;

function normalizeText(value) {
  return (value ?? '').toString().trim();
}

function normalizeSingleLine(value) {
  return normalizeText(value).replace(/\s+/g, ' ');
}

function normalizeLower(value) {
  return normalizeSingleLine(value).toLowerCase();
}

function sanitizeText(value, maxLength = 160) {
  const text = normalizeSingleLine(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function sanitizeAdminPreviewText(value, maxLength = 160) {
  const text = normalizeSingleLine(value)
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[redacted phone]')
    .replace(/\b\d{1,6}\s+[A-Za-z0-9.'-]+(?:\s+[A-Za-z0-9.'-]+){0,5}\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Court|Ct|Circle|Cir|Way|Place|Pl)\b/gi, '[redacted address]')
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}\b/gi, '[redacted auth]')
    .replace(/\b(?:sk|pk|rk|whsec|ghp|github_pat|xoxb|xoxp|shpat|secret|token|api[_-]?key)[A-Za-z0-9:_-]{8,}\b/gi, '[redacted secret]')
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted token]');

  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trim()}...` : text;
}

function normalizeId(value, fieldName, required = true) {
  const text = normalizeSingleLine(value);
  if (!text) {
    if (required) throw new Error(`${fieldName} is required`);
    return '';
  }
  if (text.length > 160 || !/^[A-Za-z0-9._:@/-]+$/.test(text)) {
    throw new Error(`${fieldName} contains unsupported characters`);
  }
  return text;
}

function normalizeOptionalStatus(value) {
  const status = normalizeSingleLine(value);
  if (!status) return '';
  if (status.length > 80 || !/^[A-Za-z0-9._ -]+$/.test(status)) {
    throw new Error('expected_status contains unsupported characters');
  }
  return status;
}

function findUnsupportedBodyKey(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;

  for (const key of Object.keys(body)) {
    const normalized = normalizeLower(key);
    if (!ALLOWED_BODY_KEYS.has(normalized)) return key;
  }

  return null;
}

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function safeStringArray(value, itemLength = 120) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, SAFE_ARRAY_LIMIT)
    .map((item) => sanitizeText(item, itemLength))
    .filter(Boolean);
}

function referenceList(value) {
  if (Array.isArray(value)) return value.map(item => sanitizeText(item, 160)).filter(Boolean);
  return normalizeText(value).split(',').map(item => sanitizeText(item, 160)).filter(Boolean);
}

function complianceRecordMatchesBatch(record, batch) {
  const sourceId = normalizeText(batch?.id);
  const batchId = normalizeText(batch?.batch_id);
  const sourceRefs = new Set([
    normalizeText(record?.source_production_batch_id),
    ...referenceList(record?.related_source_production_batch_ids),
  ].filter(Boolean));
  const batchRefs = new Set([
    normalizeText(record?.batch_id),
    ...referenceList(record?.related_batch_ids),
    ...referenceList(record?.batches_logged),
  ].filter(Boolean));
  return Boolean((sourceId && sourceRefs.has(sourceId)) || (batchId && batchRefs.has(batchId)));
}

function preStartRecordReady(recordType, record) {
  if (recordType === 'sanitation') {
    return record?.cleaned === true && record?.sanitized === true && normalizeLower(record?.sanitizer_level) !== 'low';
  }
  if (recordType === 'daily_checklist') {
    return ['complete', 'pre-production complete'].includes(normalizeLower(record?.overall_status)) &&
      record?.morning_fridge_temp_logged === true &&
      record?.sanitizer_levels_checked === true &&
      record?.equipment_sanitized === true &&
      record?.work_areas_cleaned === true;
  }
  return record?.within_range === true && Number.isFinite(Number(record?.temperature));
}

async function linkedComplianceRows(base44, entityName, batch) {
  const entity = base44.asServiceRole?.entities?.[entityName];
  if (!entity?.filter) throw new Error(`${entityName}_unavailable`);
  const results = await Promise.all([
    batch.id ? entity.filter({ source_production_batch_id: batch.id }, '-created_date', 20).catch(() => []) : [],
    batch.batch_id ? entity.filter({ batch_id: batch.batch_id }, '-created_date', 20).catch(() => []) : [],
  ]);
  const seen = new Set();
  return results.flat().filter(row => {
    const key = normalizeText(row?.id);
    if (!key || seen.has(key) || row?.is_test_record === true) return false;
    seen.add(key);
    return complianceRecordMatchesBatch(row, batch);
  });
}

async function loadPreStartCompliance(base44, batch) {
  try {
    const [sanitation, dailyChecklist, temperature] = await Promise.all([
      linkedComplianceRows(base44, 'SanitationLog', batch),
      linkedComplianceRows(base44, 'DailyChecklist', batch),
      linkedComplianceRows(base44, 'TemperatureLog', batch),
    ]);
    const ready = {
      sanitation: sanitation.some(row => preStartRecordReady('sanitation', row)),
      daily_checklist: dailyChecklist.some(row => preStartRecordReady('daily_checklist', row)),
      temperature: temperature.some(row => preStartRecordReady('temperature', row)),
    };
    const blockers = [];
    if (!ready.sanitation) blockers.push('pre_start_sanitation_missing_or_incomplete');
    if (!ready.daily_checklist) blockers.push('pre_start_daily_checklist_missing_or_incomplete');
    if (!ready.temperature) blockers.push('pre_start_temperature_missing_or_out_of_range');
    return { enforced: true, ready: blockers.length === 0, blockers, items: ready };
  } catch {
    return {
      enforced: true,
      ready: false,
      blockers: ['pre_start_compliance_unavailable'],
      items: { sanitation: false, daily_checklist: false, temperature: false },
    };
  }
}

function safePreStartCompliance(value) {
  return {
    enforced: value?.enforced === true,
    ready: value?.ready === true,
    blockers: safeStringArray(value?.blockers, 120),
    items: {
      sanitation: value?.items?.sanitation === true,
      daily_checklist: value?.items?.daily_checklist === true,
      temperature: value?.items?.temperature === true,
    },
  };
}

function safeCountMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, SAFE_ARRAY_LIMIT)
      .map(([key, count]) => [sanitizeText(key, 80), Number(count) || 0])
      .filter(([key]) => Boolean(key))
  );
}

function safeOrderSourceSummaries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, SAFE_ARRAY_LIMIT)
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const summary = {};
      const sourceType = sanitizeAdminPreviewText(item.source_type, 80);
      const orderNumber = sanitizeAdminPreviewText(item.order_number, 80);
      const customerName = sanitizeAdminPreviewText(item.customer_name, 100);
      const customerEmail = sanitizeAdminPreviewText(item.customer_email, 120);
      const fulfillmentType = sanitizeAdminPreviewText(item.fulfillment_type, 80);

      if (sourceType) summary.source_type = sourceType;
      if (orderNumber) summary.order_number = orderNumber;
      if (customerName) summary.customer_name = customerName;
      if (customerEmail) summary.customer_email = customerEmail;
      if (fulfillmentType) summary.fulfillment_type = fulfillmentType;

      return Object.keys(summary).length > 0 ? summary : null;
    })
    .filter(Boolean);
}

function sanitizeHubPreviewResponse(data, requestId) {
  return {
    success: data?.success === true,
    dry_run: data?.dry_run === true,
    production_batch_id: sanitizeText(data?.production_batch_id, 160) || null,
    batch_id: sanitizeText(data?.batch_id, 160) || null,
    current_status: sanitizeText(data?.current_status, 80) || null,
    eligible_status: data?.eligible_status === true,
    is_locked: data?.is_locked === true,
    order_sources_count: Number(data?.order_sources_count) || 0,
    order_source_type_counts: safeCountMap(data?.order_source_type_counts),
    order_number_count: Number(data?.order_number_count) || 0,
    customer_context_present: data?.customer_context_present === true,
    customer_context_allowed_for_preview: data?.customer_context_allowed_for_preview === true,
    order_sources_preview_allowed: data?.order_sources_preview_allowed === true,
    customer_data_blocking: data?.customer_data_blocking === true,
    safe_order_source_summaries: safeOrderSourceSummaries(data?.safe_order_source_summaries),
    manual_source_count: Number(data?.manual_source_count) || 0,
    linked_task_count: Number(data?.linked_task_count) || 0,
    linked_order_count: Number(data?.linked_order_count) || 0,
    compliance_finalization_present: data?.compliance_finalization_present === true,
    inventory_po_linkage_present: data?.inventory_po_linkage_present === true,
    recalculation_risk: data?.recalculation_risk === true,
    projected_writes: safeStringArray(data?.projected_writes, 120),
    live_allowed: data?.live_allowed === true,
    blockers: safeStringArray(data?.blockers, 120),
    warnings: safeStringArray(data?.warnings, 120),
    ...(requestId ? { request_id: requestId } : {}),
  };
}

function safeHubError(data, fallback = 'Unable to preview Hub production batch start') {
  const error = sanitizeText(data?.error, 160);
  const errorCode = sanitizeText(data?.error_code, 80);
  const message = sanitizeText(data?.message, 160);
  return {
    error: error || fallback,
    ...(errorCode ? { error_code: errorCode } : {}),
    ...(message ? { message } : {}),
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

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }

    const unsupportedKey = findUnsupportedBodyKey(body);
    if (unsupportedKey) {
      return Response.json({
        error: `Unsupported field: ${unsupportedKey}`,
        error_code: 'unsupported_field',
      }, { status: 400 });
    }

    let productionBatchId;
    let batchId;
    let expectedStatus;
    let requestId;

    try {
      productionBatchId = normalizeId(body.production_batch_id, 'production_batch_id');
      batchId = normalizeId(body.batch_id, 'batch_id', false);
      expectedStatus = normalizeOptionalStatus(body.expected_status);
      requestId = normalizeId(body.request_id, 'request_id', false);
    } catch (error) {
      return Response.json({ error: error.message, error_code: 'invalid_input' }, { status: 400 });
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      return Response.json({ error: 'Hub production batch preview service is not configured' }, { status: 503 });
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const hubBody = {
      production_batch_id: productionBatchId,
    };

    if (batchId) {
      hubBody.batch_id = batchId;
    }

    if (expectedStatus) {
      hubBody.expected_status = expectedStatus;
    }

    if (requestId) {
      hubBody.request_id = requestId;
    }

    const hubResponse = await fetch(`${hubBase}/functions/previewProductionBatchStartForCustomerApp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
      },
      body: JSON.stringify(hubBody),
    });

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubResponse.ok) {
      return Response.json({
        ...safeHubError(hubData),
        hub_status: hubResponse.status,
      }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
    }

    const preStartCompliance = await loadPreStartCompliance(base44, {
      id: productionBatchId,
      batch_id: batchId,
    });
    const sanitized = sanitizeHubPreviewResponse(hubData, requestId);
    const blockers = [...new Set([
      ...safeStringArray(sanitized.blockers, 120),
      ...safeStringArray(preStartCompliance.blockers, 120),
    ])];
    return Response.json({
      ...sanitized,
      live_allowed: sanitized.live_allowed === true && preStartCompliance.ready === true,
      blockers,
      pre_start_compliance: safePreStartCompliance(preStartCompliance),
    });
  } catch {
    console.error('[previewAdminProductionBatchStart] Error');
    return Response.json({ error: 'Unable to preview Hub production batch start' }, { status: 500 });
  }
});
