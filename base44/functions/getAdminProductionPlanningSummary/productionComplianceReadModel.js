const READ_MODEL_VERSION = 'g48c_production_compliance_lifecycle_v1';

function text(value) {
  return (value ?? '').toString().trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function bool(value) {
  return value === true;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value) {
  const match = text(value).match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function passFail(value) {
  const normalized = lower(value).replace(/[^a-z]/g, '');
  if (['pass', 'passed', 'true', 'yes'].includes(normalized)) return 'passed';
  if (['fail', 'failed', 'false', 'no'].includes(normalized)) return 'failed';
  return text(value) || null;
}

function safeRef(value) {
  const valueText = text(value);
  return valueText ? valueText.slice(0, 160) : null;
}

function pushIndex(map, key, row) {
  const normalized = safeRef(key);
  if (!normalized) return;
  if (!map.has(normalized)) map.set(normalized, []);
  map.get(normalized).push(row);
}

function uniqueById(rows) {
  const seen = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = safeRef(row?.id) || `${safeRef(row?.batch_id) || 'batch'}:${safeRef(row?.source_production_batch_id) || 'source'}:${seen.size}`;
    if (!seen.has(key)) seen.set(key, row);
  }
  return Array.from(seen.values());
}

function inRangeByAnyDate(row, dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return true;
  const candidates = [row?.production_date, row?.date, row?.log_date, row?.created_date, row?.updated_date]
    .map(dateOnly)
    .filter(Boolean);
  if (candidates.length === 0) return true;
  return candidates.some(date => (!dateFrom || date >= dateFrom) && (!dateTo || date <= dateTo));
}

function buildLogIndexes(logs) {
  const byId = new Map();
  const bySourceBatchId = new Map();
  const byBatchId = new Map();
  for (const log of logs) {
    if (safeRef(log?.id)) byId.set(safeRef(log.id), log);
    pushIndex(bySourceBatchId, log?.production_batch_id, log);
    pushIndex(bySourceBatchId, log?.source_production_batch_id, log);
    pushIndex(byBatchId, log?.batch_id, log);
  }
  return { byId, bySourceBatchId, byBatchId };
}

function logsForBatch(batch, indexes) {
  const candidates = [];
  const add = row => { if (row) candidates.push(row); };
  add(indexes.byId.get(safeRef(batch?.compliance_log_id)));
  for (const row of indexes.bySourceBatchId.get(safeRef(batch?.id)) || []) add(row);
  for (const row of indexes.byBatchId.get(safeRef(batch?.batch_id)) || []) add(row);
  return uniqueById(candidates);
}

function hasRepairReplayHold(row) {
  const joined = [
    row?.repair_status,
    row?.replay_status,
    row?.review_status,
    row?.sync_status,
    row?.status_reason,
    row?.notes,
  ].map(text).join(' ').toLowerCase();
  return /repair|replay|manual_review|review_required/.test(joined);
}

function buildRow(batch, matches) {
  const blockers = [];
  const warnings = [];
  const mismatchCategories = [];
  const matchCount = matches.length;
  const log = matchCount === 1 ? matches[0] : null;
  const batchStatus = lower(batch?.status);
  const batchPass = passFail(batch?.passed_failed);
  const batchPhPass = passFail(batch?.pH_passed_failed ?? batch?.ph_passed_failed);
  const batchPhResult = nullableNumber(batch?.pH_result ?? batch?.ph_result ?? batch?.ph_value);
  const logPass = passFail(log?.passed_failed);
  const logPhPass = passFail(log?.pH_passed_failed ?? log?.ph_passed_failed ?? log?.pH_passed ?? log?.ph_passed);
  const logPhResult = nullableNumber(log?.pH_result ?? log?.ph_result ?? log?.ph_value);
  const logLocked = bool(log?.locked) || bool(log?.is_locked);

  if (matchCount === 0) {
    blockers.push('compliance_log_missing');
    mismatchCategories.push('production_batch_missing_compliance_log');
  }
  if (matchCount > 1) {
    blockers.push('duplicate_compliance_log_matches');
    mismatchCategories.push('production_batch_duplicate_compliance_log_risk');
  }

  if (log) {
    const expectedLogId = safeRef(batch?.compliance_log_id);
    if (expectedLogId && safeRef(log?.id) !== expectedLogId) {
      blockers.push('compliance_log_id_link_conflict');
      mismatchCategories.push('production_batch_compliance_link_conflict');
    }
    const logSource = safeRef(log?.source_production_batch_id || log?.production_batch_id);
    if (logSource && safeRef(batch?.id) && logSource !== safeRef(batch?.id)) {
      blockers.push('source_production_batch_link_conflict');
      mismatchCategories.push('production_batch_compliance_link_conflict');
    }
    if (safeRef(log?.batch_id) && safeRef(batch?.batch_id) && safeRef(log?.batch_id) !== safeRef(batch?.batch_id)) {
      blockers.push('batch_id_link_conflict');
      mismatchCategories.push('production_batch_compliance_link_conflict');
    }
    if (batchPass && logPass && batchPass !== logPass) {
      blockers.push('batch_log_pass_fail_mismatch');
      mismatchCategories.push('production_compliance_pass_fail_mismatch');
    }
    if (batchPhPass && logPhPass && batchPhPass !== logPhPass) {
      blockers.push('batch_log_ph_pass_fail_mismatch');
      mismatchCategories.push('production_compliance_pass_fail_mismatch');
    }
    if (batchPhResult !== null && logPhResult !== null && Math.abs(batchPhResult - logPhResult) > 0.001) {
      blockers.push('batch_log_ph_result_mismatch');
      mismatchCategories.push('production_compliance_status_mismatch');
    }
    if (batchStatus === 'verified_logged' && !logLocked) {
      warnings.push('verified_batch_log_unlocked');
      mismatchCategories.push('production_compliance_native_read_partial');
    }
  }

  if (batchStatus === 'verified_logged' && batchPhResult === null && logPhResult === null) {
    blockers.push('ph_result_missing');
    mismatchCategories.push('production_compliance_ph_missing');
  }
  if (batchStatus === 'verified_logged' && !batchPass && !logPass) {
    warnings.push('verified_batch_pass_fail_missing');
    mismatchCategories.push('production_compliance_native_read_partial');
  }
  if (hasRepairReplayHold(batch) || matches.some(hasRepairReplayHold)) {
    blockers.push('repair_replay_hold');
    mismatchCategories.push('production_compliance_repair_replay_hold');
  }

  const exactIdentityReady = matchCount === 1 && blockers.length === 0;
  const lockedVerified = batchStatus === 'verified_logged' && Boolean(log) && logLocked && Boolean(batch?.verified_at || log?.verified_at);
  const nativeReadReady = exactIdentityReady && lockedVerified;
  const reviewRequired = blockers.length > 0 || matchCount !== 1;
  const fallbackRequired = !nativeReadReady;

  let classification = 'production_compliance_native_read_partial';
  if (nativeReadReady) classification = 'production_compliance_native_read_ready';
  else if (matchCount === 0) classification = 'production_batch_missing_compliance_log';
  else if (matchCount > 1) classification = 'production_batch_duplicate_compliance_log_risk';
  else if (mismatchCategories.includes('production_batch_compliance_link_conflict')) classification = 'production_batch_compliance_link_conflict';
  else if (mismatchCategories.includes('production_compliance_pass_fail_mismatch')) classification = 'production_compliance_pass_fail_mismatch';
  else if (mismatchCategories.includes('production_compliance_ph_missing')) classification = 'production_compliance_ph_missing';
  else if (mismatchCategories.includes('production_compliance_repair_replay_hold')) classification = 'production_compliance_repair_replay_hold';

  return {
    production_batch_ref: safeRef(batch?.id),
    batch_id: safeRef(batch?.batch_id),
    product: safeRef(batch?.product_name || batch?.juice_flavor),
    production_date: dateOnly(batch?.production_date),
    planned_units: number(batch?.planned_units),
    actual_units: number(batch?.actual_units ?? batch?.bottles_produced ?? batch?.final_usable_quantity),
    production_status: safeRef(batch?.status),
    actual_start_time_present: Boolean(batch?.actual_start_time),
    actual_end_time_present: Boolean(batch?.actual_end_time),
    compliance_log_present: Boolean(log),
    compliance_log_match_count: matchCount,
    compliance_log_ref: safeRef(log?.id),
    compliance_log_locked: Boolean(log && logLocked),
    pH_result: batchPhResult ?? logPhResult,
    pH_passed: (batchPhPass || logPhPass) || null,
    batch_passed: (batchPass || logPass) || null,
    verified_at_present: Boolean(batch?.verified_at || log?.verified_at),
    verified_by_present: Boolean(batch?.verified_by || log?.verified_by),
    exact_identity_ready: exactIdentityReady,
    native_read_ready: nativeReadReady,
    fallback_required: fallbackRequired,
    review_required: reviewRequired,
    mismatch_categories: Array.from(new Set(mismatchCategories)),
    blockers: Array.from(new Set(blockers)),
    warnings: Array.from(new Set(warnings)),
    classification,
  };
}

function emptySummary() {
  return {
    production_batch_count: 0,
    verified_batch_count: 0,
    compliance_log_count: 0,
    exact_batch_log_match_count: 0,
    missing_log_count: 0,
    duplicate_log_count: 0,
    locked_verified_count: 0,
    pH_missing_count: 0,
    pass_fail_mismatch_count: 0,
    status_mismatch_count: 0,
    fallback_required_count: 0,
    review_required_count: 0,
  };
}

export function buildProductionComplianceLifecycleReadModel({
  productionBatches = [],
  batchComplianceLogs = [],
  manualProductionBatches = [],
  dateFrom = null,
  dateTo = null,
  enabled = false,
  sourceMode = 'disabled',
} = {}) {
  const filteredBatches = (Array.isArray(productionBatches) ? productionBatches : [])
    .filter(row => inRangeByAnyDate(row, dateFrom, dateTo))
    .slice(0, 500);
  const filteredLogs = (Array.isArray(batchComplianceLogs) ? batchComplianceLogs : [])
    .filter(row => inRangeByAnyDate(row, dateFrom, dateTo))
    .slice(0, 500);
  const filteredManual = (Array.isArray(manualProductionBatches) ? manualProductionBatches : [])
    .filter(row => inRangeByAnyDate(row, dateFrom, dateTo))
    .slice(0, 200);

  const indexes = buildLogIndexes(filteredLogs);
  const rows = filteredBatches.map(batch => buildRow(batch, logsForBatch(batch, indexes)));
  const summary = rows.reduce((acc, row) => {
    acc.production_batch_count += 1;
    if (lower(row.production_status) === 'verified_logged') acc.verified_batch_count += 1;
    if (row.compliance_log_match_count === 1) acc.exact_batch_log_match_count += 1;
    if (row.compliance_log_match_count === 0) acc.missing_log_count += 1;
    if (row.compliance_log_match_count > 1) acc.duplicate_log_count += 1;
    if (lower(row.production_status) === 'verified_logged' && row.compliance_log_locked && row.verified_at_present) acc.locked_verified_count += 1;
    if (row.mismatch_categories.includes('production_compliance_ph_missing')) acc.pH_missing_count += 1;
    if (row.mismatch_categories.includes('production_compliance_pass_fail_mismatch')) acc.pass_fail_mismatch_count += 1;
    if (row.mismatch_categories.includes('production_compliance_status_mismatch')) acc.status_mismatch_count += 1;
    if (row.fallback_required) acc.fallback_required_count += 1;
    if (row.review_required) acc.review_required_count += 1;
    return acc;
  }, emptySummary());

  summary.compliance_log_count = filteredLogs.length;
  if (filteredManual.length > 0) {
    summary.fallback_required_count += filteredManual.length;
    summary.review_required_count += filteredManual.length;
  }

  const classificationCounts = {};
  for (const row of rows) {
    classificationCounts[row.classification] = (classificationCounts[row.classification] || 0) + 1;
  }
  if (filteredManual.length > 0) {
    classificationCounts.production_compliance_manual_batch_fallback = filteredManual.length;
  }
  if (summary.fallback_required_count > 0 && !classificationCounts.production_compliance_hub_fallback_required) {
    classificationCounts.production_compliance_hub_fallback_required = summary.fallback_required_count;
  }
  if (summary.review_required_count > 0 && !classificationCounts.production_compliance_review_required) {
    classificationCounts.production_compliance_review_required = summary.review_required_count;
  }

  return {
    read_model_version: READ_MODEL_VERSION,
    read_model_enabled: enabled === true,
    source_mode: sourceMode,
    read_only: true,
    production_write_ready: false,
    compliance_write_ready: false,
    compliance_alert_expansion_ready: false,
    notification_expansion_ready: false,
    customer_facing_status_ready: false,
    hub_write_suppression_ready: false,
    summary,
    classification_counts: classificationCounts,
    rows,
    manual_batch_fallback_count: filteredManual.length,
    warnings: filteredManual.length > 0 ? ['manual_production_batch_fallback_present'] : [],
  };
}

export { READ_MODEL_VERSION };
