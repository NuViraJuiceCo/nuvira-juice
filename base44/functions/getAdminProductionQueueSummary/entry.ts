import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const HUB_API_URL = Deno.env.get('HUB_API_URL');
const CUSTOMER_APP_SYNC_SECRET = Deno.env.get('CUSTOMER_APP_SYNC_SECRET');
const MAX_RANGE_DAYS = 31;
const DEFAULT_RANGE_DAYS_AHEAD = 14;
const MAX_LIMIT = 100;
const CHICAGO_TZ = 'America/Chicago';
const TEST_BATCH_MODES = new Set(['exclude', 'only']);

async function readJsonBody(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return (value || '').toString().trim();
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
  const normalized = date.toISOString().slice(0, 10);
  if (normalized !== text) {
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

function normalizeLimit(value) {
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error('limit must be a positive integer');
  }
  return Math.min(parsed, MAX_LIMIT);
}

function sanitizeSourceTypeCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, count]) => [key.toString(), Number(count) || 0])
      .filter(([key]) => Boolean(key))
  );
}

function safeStringArray(values, limit = 30) {
  if (!Array.isArray(values)) return [];
  return values
    .map(value => normalizeText(value))
    .filter(Boolean)
    .slice(0, limit);
}

function safeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function safeIngredientUsageRows(values) {
  if (!Array.isArray(values)) return [];
  return values.slice(0, 40).map(row => {
    const ingredientName = normalizeText(row?.ingredient_name || row?.name);
    if (!ingredientName) return null;
    return {
      ingredient_name: ingredientName,
      quantity: safeNumber(row?.quantity),
      unit: normalizeText(row?.unit),
      lot_number: normalizeText(row?.lot_number),
    };
  }).filter(Boolean);
}

function sourceKey(batch) {
  return normalizeText(batch.batch_id || batch.id).toLowerCase();
}

function isInternalTestBatch(batch) {
  const batchId = normalizeText(batch?.batch_id || batch?.id).toLowerCase();
  const sourceSystem = normalizeText(batch?.source_system).toLowerCase();
  const ownerStatus = normalizeText(batch?.native_owner_status).toLowerCase();
  const testPurpose = normalizeText(batch?.test_purpose).toLowerCase();
  return batch?.is_test_batch === true ||
    batchId.includes('-test-') ||
    sourceSystem.includes('internal_validation') ||
    ownerStatus.includes('internal_test') ||
    testPurpose.includes('internal validation');
}

function sanitizeBatch(batch) {
  const isTestBatch = isInternalTestBatch(batch);
  return {
    id: batch.id || null,
    batch_id: batch.batch_id || null,
    production_date: batch.production_date || null,
    product_name: batch.product_name || null,
    product_category: batch.product_category || null,
    status: batch.status || null,
    planned_units: batch.planned_units ?? null,
    actual_units: batch.actual_units ?? null,
    is_test_batch: isTestBatch,
    test_purpose: isTestBatch ? normalizeText(batch.test_purpose) : null,
    is_locked: batch.is_locked === true,
    order_count: Number(batch.order_count) || 0,
    order_numbers: Array.isArray(batch.order_numbers)
      ? batch.order_numbers.map(value => value?.toString().trim()).filter(Boolean)
      : [],
    source_type_counts: sanitizeSourceTypeCounts(batch.source_type_counts),
    source: batch.source || 'hub',
    source_label: batch.source === 'customer_app_native' ? 'Native Customer App' : 'Hub',
    updated_date: batch.updated_date || null,
  };
}

function nativeSourceTypeCounts(orderSources) {
  const counts = {};
  for (const source of Array.isArray(orderSources) ? orderSources : []) {
    const key = normalizeText(source?.source_type) || 'native_order';
    counts[key] = (counts[key] || 0) + (Number(source?.quantity) || 1);
  }
  return counts;
}

async function loadNativeProductionBatches(base44, dateFrom, dateTo, limit, testBatchMode = 'exclude') {
  try {
    const entity = base44.asServiceRole?.entities?.ProductionBatch;
    if (!entity || typeof entity.list !== 'function') return [];
    const rows = await entity.list('production_date', 500).catch(() => []);
    if (!Array.isArray(rows)) return [];

    const filtered = rows
      .filter(batch => {
        const productionDate = normalizeText(batch.production_date);
        const isTestBatch = isInternalTestBatch(batch);
        const modeMatches = testBatchMode === 'only' ? isTestBatch : !isTestBatch;
        return modeMatches && productionDate && productionDate >= dateFrom && productionDate <= dateTo;
      })
      .map(batch => {
        const orderSources = Array.isArray(batch.order_sources) ? batch.order_sources : [];
        const safeBatch = sanitizeBatch({
          ...batch,
          order_count: orderSources.length,
          order_numbers: safeStringArray(orderSources.map(source => source?.order_number), 50),
          source_type_counts: nativeSourceTypeCounts(orderSources),
          source: 'customer_app_native',
        });

        return {
          ...safeBatch,
          actual_start_time: normalizeText(batch.actual_start_time),
          actual_end_time: normalizeText(batch.actual_end_time),
          started_by: normalizeText(batch.started_by),
          completed_by: normalizeText(batch.completed_by),
          verified_by: normalizeText(batch.verified_by),
          verified_at: normalizeText(batch.verified_at),
          compliance_log_id: normalizeText(batch.compliance_log_id),
          inventory_deduction_log_id: normalizeText(batch.inventory_deduction_log_id),
          source_system: normalizeText(batch.source_system),
          pH_result: safeNumber(batch.pH_result),
          pH_passed_failed: normalizeText(batch.pH_passed_failed),
          passed_failed: normalizeText(batch.passed_failed),
          bottles_produced: safeNumber(batch.bottles_produced),
          bottles_rejected_or_wasted: safeNumber(batch.bottles_rejected_or_wasted),
          final_usable_quantity: safeNumber(batch.final_usable_quantity),
          storage_location: normalizeText(batch.storage_location),
          use_by_date: normalizeText(batch.use_by_date),
          staff_on_duty: safeStringArray(batch.staff_on_duty, 20),
          ingredients_used: safeIngredientUsageRows(batch.ingredients_used),
        };
      });

    return (limit ? filtered.slice(0, limit) : filtered).sort((a, b) => {
      const dateCompare = (a.production_date || '').localeCompare(b.production_date || '');
      if (dateCompare !== 0) return dateCompare;
      return (a.product_name || '').localeCompare(b.product_name || '');
    });
  } catch (error) {
    console.error('[getAdminProductionQueueSummary] Native batch overlay unavailable:', error.message);
    return [];
  }
}

function mergeHubAndNativeBatches(hubBatches, nativeBatches, limit) {
  const hubRows = Array.isArray(hubBatches)
    ? hubBatches.map(batch => sanitizeBatch({ ...batch, source: 'hub' }))
    : [];
  const hubKeys = new Set(hubRows.map(sourceKey).filter(Boolean));
  const nativeOnlyRows = nativeBatches.filter(batch => {
    const key = sourceKey(batch);
    return key && !hubKeys.has(key);
  });
  const merged = [...hubRows, ...nativeOnlyRows].sort((a, b) => {
    const dateCompare = (a.production_date || '').localeCompare(b.production_date || '');
    if (dateCompare !== 0) return dateCompare;
    const sourceCompare = (a.source || '').localeCompare(b.source || '');
    if (sourceCompare !== 0) return sourceCompare;
    return (a.product_name || '').localeCompare(b.product_name || '');
  });
  return limit ? merged.slice(0, limit) : merged;
}

function nativeOnlyProductionQueueResponse({ dateFrom, dateTo, nativeBatches, warnings, testBatchMode = 'exclude' }) {
  return {
    success: true,
    date_from: dateFrom,
    date_to: dateTo,
    count: nativeBatches.length,
    truncated: false,
    batches: nativeBatches,
    data_sources: {
      hub_available: false,
      native_available: true,
      native_read_only: true,
      native_batch_count: nativeBatches.length,
      hub_batch_count: 0,
      live_actions_source: testBatchMode === 'only' ? 'native_internal_test_only' : 'hub_backed_only',
    },
    test_batch_mode: testBatchMode,
    operational_totals_exclude_test_batches: true,
    warnings,
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

    const body = await readJsonBody(req);
    if (body === null) {
      return Response.json({ success: false, error: 'malformed_json' }, { status: 400 });
    }
    let dateFrom;
    let dateTo;
    let limit;
    let testBatchMode;

    try {
      dateFrom = parseIsoDate(body.date_from, 'date_from');
      dateTo = parseIsoDate(body.date_to, 'date_to');
      limit = normalizeLimit(body.limit);
      testBatchMode = normalizeText(body.test_batch_mode || 'exclude').toLowerCase();
      if (!TEST_BATCH_MODES.has(testBatchMode)) {
        throw new Error('test_batch_mode must be exclude or only');
      }
    } catch (error) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    const today = todayChicagoDate();
    if (!dateFrom && !dateTo) {
      dateFrom = today;
      dateTo = addDays(today, DEFAULT_RANGE_DAYS_AHEAD);
    } else if (dateFrom && !dateTo) {
      dateTo = addDays(dateFrom, DEFAULT_RANGE_DAYS_AHEAD);
    } else if (!dateFrom && dateTo) {
      dateFrom = today;
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

    const nativeBatches = await loadNativeProductionBatches(base44, dateFrom, dateTo, limit, testBatchMode);
    const warnings = [];
    if (testBatchMode === 'only') {
      warnings.push('internal_test_batches_only');
      return Response.json(nativeOnlyProductionQueueResponse({
        dateFrom,
        dateTo,
        nativeBatches,
        warnings,
        testBatchMode,
      }));
    }

    if (!HUB_API_URL || !CUSTOMER_APP_SYNC_SECRET) {
      if (nativeBatches.length === 0) {
        return Response.json({
          error: 'Hub production queue service is not configured',
          warnings: ['hub_production_queue_service_not_configured'],
        }, { status: 503 });
      }

      warnings.push('hub_production_queue_service_not_configured');
      return Response.json(nativeOnlyProductionQueueResponse({ dateFrom, dateTo, nativeBatches, warnings, testBatchMode }));
    }

    const hubBase = HUB_API_URL.replace(/\/$/, '').replace(/\/api\/functions\/.*$/, '').replace(/\/functions\/.*$/, '');
    const params = new URLSearchParams({
      date_from: dateFrom,
      date_to: dateTo,
    });
    if (limit) params.set('limit', limit.toString());

    let hubResponse;
    try {
      hubResponse = await fetch(`${hubBase}/functions/getProductionQueueSummaryForCustomerApp?${params.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${CUSTOMER_APP_SYNC_SECRET}`,
        },
      });
    } catch {
      warnings.push('hub_production_queue_unavailable:fetch_failed');
      if (nativeBatches.length === 0) {
        return Response.json({
          error: 'Unable to load production queue summary',
          warnings,
        }, { status: 503 });
      }

      return Response.json(nativeOnlyProductionQueueResponse({ dateFrom, dateTo, nativeBatches, warnings, testBatchMode }));
    }

    if (!hubResponse.ok) {
      warnings.push(`hub_production_queue_unavailable:${hubResponse.status}`);
      if (nativeBatches.length === 0) {
        return Response.json({
          error: 'Unable to load production queue summary',
          hub_status: hubResponse.status,
          warnings,
        }, { status: hubResponse.status >= 400 && hubResponse.status < 500 ? hubResponse.status : 502 });
      }

      return Response.json(nativeOnlyProductionQueueResponse({ dateFrom, dateTo, nativeBatches, warnings, testBatchMode }));
    }

    const hubData = await hubResponse.json().catch(() => null);
    if (!hubData || hubData.success !== true || !Array.isArray(hubData.batches)) {
      warnings.push('hub_production_queue_malformed_response');
      if (nativeBatches.length === 0) {
        return Response.json({ error: 'Malformed production queue summary response', warnings }, { status: 502 });
      }

      return Response.json(nativeOnlyProductionQueueResponse({ dateFrom, dateTo, nativeBatches, warnings }));
    }

    const batches = mergeHubAndNativeBatches(hubData.batches, nativeBatches, limit);
    const hubBatchCount = hubData.batches.length;
    const nativeOnlyCount = batches.filter(batch => batch.source === 'customer_app_native').length;
    const unmergedCount = hubBatchCount + nativeOnlyCount;
    const truncated = hubData.truncated === true || Boolean(limit && unmergedCount > batches.length);

    return Response.json({
      success: true,
      date_from: hubData.date_from || dateFrom,
      date_to: hubData.date_to || dateTo,
      count: batches.length,
      truncated,
      batches,
      data_sources: {
        hub_available: true,
        native_available: nativeBatches.length > 0,
        native_read_only: true,
        native_batch_count: nativeBatches.length,
        native_only_batch_count: nativeOnlyCount,
        hub_batch_count: hubBatchCount,
        live_actions_source: 'hub_backed_only',
      },
      warnings,
      test_batch_mode: 'exclude',
      operational_totals_exclude_test_batches: true,
    });
  } catch (error) {
    console.error('[getAdminProductionQueueSummary] Error:', error.message);
    return Response.json({ error: 'Unable to load production queue summary' }, { status: 500 });
  }
});
