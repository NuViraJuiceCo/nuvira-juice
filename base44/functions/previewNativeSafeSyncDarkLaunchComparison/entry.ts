const CRITICAL_FIELDS = new Set([
  'payment_status',
  'source_channel',
  'stripe_subscription_id',
  'line_items',
  'fulfillments',
  'production_snapshot',
  'address_line1',
  'address_line2',
  'address_city',
  'address_state',
  'address_postal_code',
  'address_country',
  'order_lock_status',
  'production_status',
  'fulfillment_status',
]);

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string').sort();
  if (typeof value === 'object') return Object.keys(value).sort();
  return [];
}

function unique(values) {
  return [...new Set(values)].sort();
}

function symmetricDiff(left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return unique([
    ...left.filter((value) => !rightSet.has(value)),
    ...right.filter((value) => !leftSet.has(value)),
  ]);
}

function normalizeAction(action) {
  if (!action) return null;
  const value = String(action).toLowerCase();
  if (['created', 'create', 'would_create'].includes(value)) return 'created';
  if (['updated', 'update', 'would_update'].includes(value)) return 'updated';
  if (['skipped', 'duplicate_event'].includes(value)) return 'skipped';
  if (['rejected', 'reject', 'failed', 'error'].includes(value)) return 'rejected';
  return value;
}

function normalizeHubResult(hubResult) {
  const action = normalizeAction(
    hubResult?.order_sync_log_draft?.action ||
    hubResult?.action ||
    hubResult?.status ||
    null,
  );
  const rejected = toArray(hubResult?.fields_rejected || hubResult?.rejected_fields || hubResult?.order_sync_log_draft?.fields_rejected);
  const accepted = toArray(hubResult?.fields_updated || hubResult?.accepted_fields || hubResult?.order_sync_log_draft?.fields_updated);
  const errorCode = hubResult?.error_code || hubResult?.reason || hubResult?.order_sync_log_draft?.error_code || null;
  const queueIncident = hubResult?.order_review_queue_draft?.incident_type || hubResult?.order_review_queue_incident_type || null;

  return {
    action,
    accepted_fields: accepted,
    rejected_fields: rejected,
    error_code: errorCode,
    order_sync_log_action: normalizeAction(hubResult?.order_sync_log_draft?.action || action),
    order_review_queue_incident_type: queueIncident,
    would_create_order: action === 'created',
    would_update_order: action === 'updated',
    would_reject: action === 'rejected',
    would_quarantine: Boolean(queueIncident),
  };
}

function normalizeNativeResult(nativeResult) {
  const action = normalizeAction(
    nativeResult?.order_sync_log_draft?.action ||
    nativeResult?.action ||
    nativeResult?.response_status ||
    null,
  );
  const rejected = toArray(nativeResult?.rejected_fields || nativeResult?.order_sync_log_draft?.fields_rejected);
  const accepted = toArray(nativeResult?.accepted_fields || nativeResult?.order_sync_log_draft?.fields_updated);
  const queueIncident = nativeResult?.order_review_queue_draft?.incident_type || null;

  return {
    action,
    accepted_fields: accepted,
    rejected_fields: rejected,
    error_code: nativeResult?.error_code || nativeResult?.order_sync_log_draft?.error_code || null,
    order_sync_log_action: normalizeAction(nativeResult?.order_sync_log_draft?.action || action),
    order_review_queue_incident_type: queueIncident,
    would_create_order: Boolean(nativeResult?.would_create_order),
    would_update_order: Boolean(nativeResult?.would_update_order),
    would_reject: Boolean(nativeResult?.would_reject),
    would_quarantine: Boolean(nativeResult?.would_quarantine),
  };
}

function classifyMismatch(mismatches) {
  if (mismatches.some((mismatch) => mismatch.severity === 'blocker')) return 'blocker';
  if (mismatches.some((mismatch) => mismatch.severity === 'high')) return 'high';
  if (mismatches.some((mismatch) => mismatch.severity === 'medium')) return 'medium';
  if (mismatches.some((mismatch) => mismatch.severity === 'low')) return 'low';
  return null;
}

function addMismatch(mismatches, field, hub, native, severity) {
  mismatches.push({ field, hub, native, severity });
}

function compareSafeSyncDarkLaunch(body) {
  const fixtureId = typeof body.fixture_id === 'string' ? body.fixture_id : null;
  const source = typeof body.source === 'string' ? body.source : null;
  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : null;
  const hub = normalizeHubResult(body.hub_result || {});
  const native = normalizeNativeResult(body.native_result || {});
  const mismatches = [];
  const warnings = [];

  if (!body.hub_result || typeof body.hub_result !== 'object') {
    addMismatch(mismatches, 'hub_result', false, true, 'blocker');
  }
  if (!body.native_result || typeof body.native_result !== 'object') {
    addMismatch(mismatches, 'native_result', false, true, 'blocker');
  }

  for (const field of ['action', 'would_create_order', 'would_update_order', 'would_reject']) {
    if (hub[field] !== native[field]) addMismatch(mismatches, field, hub[field], native[field], 'blocker');
  }

  if (hub.error_code !== native.error_code) {
    addMismatch(mismatches, 'error_code', hub.error_code, native.error_code, hub.would_reject || native.would_reject ? 'blocker' : 'medium');
  }

  const acceptedDiff = symmetricDiff(hub.accepted_fields, native.accepted_fields);
  if (acceptedDiff.length > 0) {
    const severity = acceptedDiff.some((field) => CRITICAL_FIELDS.has(field)) ? 'high' : 'medium';
    addMismatch(mismatches, 'accepted_fields', hub.accepted_fields, native.accepted_fields, severity);
  }

  const rejectedDiff = symmetricDiff(hub.rejected_fields, native.rejected_fields);
  if (rejectedDiff.length > 0) {
    const severity = rejectedDiff.some((field) => CRITICAL_FIELDS.has(field)) ? 'high' : 'medium';
    addMismatch(mismatches, 'rejected_fields', hub.rejected_fields, native.rejected_fields, severity);
  }

  if (hub.order_sync_log_action !== native.order_sync_log_action) {
    addMismatch(mismatches, 'order_sync_log_action', hub.order_sync_log_action, native.order_sync_log_action, 'medium');
  }

  if (hub.order_review_queue_incident_type !== native.order_review_queue_incident_type) {
    addMismatch(mismatches, 'order_review_queue_incident_type', hub.order_review_queue_incident_type, native.order_review_queue_incident_type, 'medium');
  }

  if (!idempotencyKey) warnings.push('missing_idempotency_key');
  if (!source) warnings.push('missing_source');

  const mismatchCategory = classifyMismatch(mismatches);

  return {
    success: true,
    dry_run: true,
    dark_launch: true,
    native_writer_enabled: false,
    hub_remains_live_writer: true,
    fixture_id: fixtureId,
    source,
    idempotency_key: idempotencyKey,
    matched: mismatches.length === 0,
    mismatch_category: mismatchCategory,
    mismatches,
    hub_summary: hub,
    native_summary: native,
    warnings,
  };
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) {
    return { ok: true, body: null };
  }

  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required' }, { status: 405 });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return Response.json({ success: false, error: 'malformed_json', error_code: 'malformed_json' }, { status: 400 });
    }

    const body = parsedBody.body;
    if (!body || typeof body !== 'object') {
      return Response.json({ success: false, error_code: 'invalid_json', message: 'JSON body required' }, { status: 400 });
    }

    if (body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported' }, { status: 400 });
    }

    return Response.json(compareSafeSyncDarkLaunch(body));
  } catch (_error) {
    return Response.json({ success: false, dry_run: true, dark_launch: true, error_code: 'comparison_failed', message: 'Dark-launch comparison failed' }, { status: 500 });
  }
});
