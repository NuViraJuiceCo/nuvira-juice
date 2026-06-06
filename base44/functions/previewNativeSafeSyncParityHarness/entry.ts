import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

const MAX_FIXTURES = 20;

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

const DEFAULT_FIXTURES = [
  {
    fixture_id: 'g26a_customer_app_paid_one_time_create',
    description: 'Paid one-time Customer App delivery order should plan a native operational order create.',
    source: 'customer_app',
    event_type: 'order.created',
    idempotency_key: 'g26a:synthetic:customer_app_paid_create',
    incoming_payload: {
      base44_order_id: 'g26a_order_paid_001',
      shopify_order_number: 'G26A-SYNTH-PAID-001',
      customer_name: 'G26A Synthetic Customer',
      source_channel: 'online',
      source_type: 'customer_app_one_time',
      order_type: 'one_time',
      fulfillment_method: 'delivery',
      payment_status: 'paid',
      line_items: [
        { title: 'Re-Nu', quantity: 2, price: 12 },
        { title: 'Green Glow', quantity: 1, price: 12 },
      ],
      subtotal: 36,
      total_price: 36,
      address_line1: 'Synthetic Address Line 1',
      address_city: 'Synthetic City',
      address_state: 'TX',
      address_postal_code: '00000',
      address_country: 'US',
      assigned_delivery_date: '2026-06-13',
    },
    expected: {
      action: 'created',
      would_create_order: true,
      would_update_order: false,
      would_reject: false,
      accepted_fields_include: [
        'base44_order_id',
        'shopify_order_number',
        'payment_status',
        'line_items',
        'address_line1',
        'order_type',
        'fulfillment_mode',
        'stripe_event_id_applied',
      ],
      rejected_fields_exclude: ['base44_order_id', 'payment_status', 'line_items', 'address_line1'],
      proposed_fields: {
        base44_order_id: 'g26a_order_paid_001',
        payment_status: 'paid',
        source_channel: 'online',
        order_type: 'one_time',
        fulfillment_mode: 'single_delivery',
      },
    },
  },
  {
    fixture_id: 'g26c_base44_order_id_relink_guard',
    description: 'Existing native order linkage must not be relinked to a different Customer App order id by non-admin sources.',
    source: 'customer_app',
    event_type: 'order.updated',
    idempotency_key: 'g26c:synthetic:base44_relink_guard',
    starting_order: {
      id: 'g26c_existing_linked_order',
      base44_order_id: 'g26c_order_original_001',
      shopify_order_number: 'G26C-SYNTH-LINK-001',
      customer_name: 'G26C Synthetic Customer',
      source_channel: 'online',
      source_type: 'customer_app_one_time',
      order_type: 'one_time',
      fulfillment_method: 'delivery',
      payment_status: 'paid',
      production_status: 'new',
      order_lock_status: 'unlocked',
      line_items: [{ title: 'Re-Nu', quantity: 1, price: 12 }],
      total_price: 12,
      address_line1: 'Synthetic Address Line 1',
      address_city: 'Synthetic City',
      address_state: 'TX',
      address_postal_code: '00000',
    },
    incoming_payload: {
      base44_order_id: 'g26c_order_wrong_999',
      shopify_order_number: 'G26C-SYNTH-LINK-001',
      customer_name: 'G26C Synthetic Customer',
      payment_status: 'paid',
      customer_notes: 'Safe customer note update',
    },
    expected: {
      action: 'updated',
      would_update_order: true,
      would_reject: false,
      accepted_fields_include: ['customer_notes', 'stripe_event_id_applied'],
      accepted_fields_exclude: ['base44_order_id'],
      rejected_fields_include: ['base44_order_id'],
      proposed_fields: {
        base44_order_id: 'g26c_order_original_001',
        customer_notes: 'Safe customer note update',
      },
    },
  },
  {
    fixture_id: 'g26a_duplicate_stripe_event_skip',
    description: 'Duplicate provider/order event should plan a skipped no-op.',
    source: 'stripe_webhook',
    event_type: 'order.created',
    idempotency_key: 'evt_g26a_duplicate',
    starting_order: {
      id: 'g26a_existing_duplicate_order',
      shopify_order_number: 'G26A-SYNTH-DUP-001',
      customer_name: 'G26A Synthetic Customer',
      source_channel: 'online',
      order_type: 'one_time',
      fulfillment_method: 'delivery',
      payment_status: 'paid',
      production_status: 'new',
      order_lock_status: 'unlocked',
      stripe_event_id_applied: 'evt_g26a_duplicate',
      line_items: [{ title: 'Re-Nu', quantity: 1, price: 12 }],
      total_price: 12,
      address_line1: 'Synthetic Address Line 1',
      address_city: 'Synthetic City',
      address_state: 'TX',
      address_postal_code: '00000',
    },
    incoming_payload: {
      shopify_order_number: 'G26A-SYNTH-DUP-001',
      customer_name: 'G26A Synthetic Customer',
      payment_status: 'paid',
      line_items: [{ title: 'Re-Nu', quantity: 1, price: 12 }],
      total_price: 12,
    },
    expected: {
      action: 'skipped',
      would_create_order: false,
      would_update_order: false,
      would_reject: false,
      accepted_fields_exact_count: 0,
      rejected_fields_exact_count: 0,
    },
  },
  {
    fixture_id: 'g26a_partial_refund_requires_review',
    description: 'Partial refund should not silently mutate operational state and should require review.',
    source: 'stripe_webhook',
    event_type: 'order.refunded',
    idempotency_key: 'g26a:synthetic:partial_refund',
    starting_order: {
      id: 'g26a_existing_refund_order',
      shopify_order_number: 'G26A-SYNTH-REFUND-001',
      customer_name: 'G26A Synthetic Customer',
      source_channel: 'online',
      order_type: 'one_time',
      fulfillment_method: 'delivery',
      payment_status: 'paid',
      production_status: 'awaiting_production',
      order_lock_status: 'unlocked',
      line_items: [{ title: 'Re-Nu', quantity: 2, price: 12 }],
      total_price: 24,
    },
    incoming_payload: {
      shopify_order_number: 'G26A-SYNTH-REFUND-001',
      payment_status: 'partially_refunded',
      refund_amount: 8,
      charge_amount: 24,
    },
    expected: {
      action: 'rejected',
      would_reject: true,
      would_quarantine: true,
      error_code: 'partial_refund_requires_review',
      review_incident_type: 'partial_refund_received',
    },
  },
  {
    fixture_id: 'g26a_subscription_downgrade_guard',
    description: 'Subscription order must not be downgraded to online/one-time by a stale payload.',
    source: 'customer_app',
    event_type: 'order.updated',
    idempotency_key: 'g26a:synthetic:subscription_downgrade',
    starting_order: {
      id: 'g26a_existing_subscription_order',
      shopify_order_number: 'G26A-SYNTH-SUB-001',
      customer_name: 'G26A Synthetic Customer',
      source_channel: 'subscription',
      order_type: 'subscription',
      fulfillment_method: 'delivery',
      payment_status: 'paid',
      production_status: 'awaiting_production',
      order_lock_status: 'unlocked',
      stripe_subscription_id: 'sub_g26a_synthetic',
      line_items: [{ title: 'Monthly Cleanse', quantity: 1, price: 120 }],
      fulfillments: [{ delivery_date: '2026-06-13', status: 'scheduled' }],
      total_price: 120,
    },
    incoming_payload: {
      shopify_order_number: 'G26A-SYNTH-SUB-001',
      customer_name: 'G26A Synthetic Customer',
      source_channel: 'online',
      stripe_subscription_id: '',
      line_items: [],
      payment_status: 'paid',
    },
    expected: {
      action: 'updated',
      would_update_order: true,
      would_quarantine: true,
      rejected_fields_include: ['source_channel', 'stripe_subscription_id', 'line_items'],
      review_incident_type: 'subscription_downgrade_attempt',
      proposed_fields: {
        source_channel: 'subscription',
        stripe_subscription_id: 'sub_g26a_synthetic',
      },
    },
  },
  {
    fixture_id: 'g26a_shopify_pos_create_not_required',
    description: 'Shopify POS order should normalize as fulfilled/not_required without delivery production demand.',
    source: 'admin',
    event_type: 'order.created',
    idempotency_key: 'g26a:synthetic:pos_create',
    incoming_payload: {
      shopify_order_id: 'gid://shopify/Order/G26A-SYNTH-POS-001',
      shopify_order_number: 'G26A-SYNTH-POS-001',
      customer_name: 'G26A Synthetic POS Customer',
      source_channel: 'pos',
      source_type: 'shopify_pos',
      order_type: 'pos',
      fulfillment_method: 'pos',
      line_items: [{ title: 'Event Juice', quantity: 3, price: 10 }],
      total_price: 30,
    },
    expected: {
      action: 'created',
      would_create_order: true,
      would_reject: false,
      accepted_fields_include: ['production_status', 'fulfillment_status', 'payment_status', 'source_channel', 'source_type'],
      proposed_fields: {
        source_channel: 'pos',
        source_type: 'shopify_pos',
        payment_status: 'paid',
        production_status: 'not_required',
        fulfillment_status: 'fulfilled',
        order_lock_status: 'fulfilled',
      },
    },
  },
  {
    fixture_id: 'g26a_production_lock_rejects_customer_app_fields',
    description: 'Production scheduled order should reject stale Customer App edits to frozen operational fields.',
    source: 'customer_app',
    event_type: 'order.updated',
    idempotency_key: 'g26a:synthetic:production_lock',
    starting_order: {
      id: 'g26a_existing_locked_order',
      shopify_order_number: 'G26A-SYNTH-LOCK-001',
      customer_name: 'G26A Synthetic Customer',
      source_channel: 'online',
      order_type: 'one_time',
      fulfillment_method: 'delivery',
      payment_status: 'paid',
      production_status: 'awaiting_production',
      order_lock_status: 'production_scheduled',
      line_items: [{ title: 'Re-Nu', quantity: 2, price: 12 }],
      total_price: 24,
      address_line1: 'Synthetic Address Line 1',
      address_city: 'Synthetic City',
      address_state: 'TX',
      address_postal_code: '00000',
      production_snapshot: {
        line_items: [{ title: 'Re-Nu', quantity: 2, price: 12 }],
        fulfillments: [{ delivery_date: '2026-06-13' }],
      },
    },
    incoming_payload: {
      shopify_order_number: 'G26A-SYNTH-LOCK-001',
      customer_name: 'Changed Synthetic Name',
      address_line1: 'Changed Synthetic Address',
      line_items: [{ title: 'Changed Juice', quantity: 1, price: 12 }],
      production_status: 'new',
      payment_status: 'paid',
    },
    expected: {
      action: 'updated',
      would_update_order: true,
      rejected_fields_include: ['customer_name', 'address_line1', 'line_items', 'production_status', 'payment_status'],
      accepted_fields_include: ['stripe_event_id_applied'],
      proposed_fields: {
        customer_name: 'G26A Synthetic Customer',
        address_line1: 'Synthetic Address Line 1',
        payment_status: 'paid',
        production_status: 'awaiting_production',
      },
    },
  },
];

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeAction(action) {
  if (!action) return null;
  const value = String(action).toLowerCase();
  if (['created', 'create', 'would_create'].includes(value)) return 'created';
  if (['updated', 'update', 'would_update'].includes(value)) return 'updated';
  if (['skipped', 'duplicate_event', 'dedupe_exact_match'].includes(value)) return 'skipped';
  if (['rejected', 'reject', 'failed', 'error'].includes(value)) return 'rejected';
  return value;
}

function toFieldNames(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(String).sort();
  if (typeof value === 'object') return Object.keys(value).sort();
  return [];
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean).map(String))).sort();
}

function getPlanAction(plan) {
  return normalizeAction(plan?.order_sync_log_draft?.action || plan?.action || plan?.response_status);
}

function getFieldValue(source, path) {
  if (!source || !path) return undefined;
  return String(path).split('.').reduce((current, part) => current?.[part], source);
}

function valueMatches(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function severityForField(field, defaultSeverity = 'medium') {
  return CRITICAL_FIELDS.has(field) ? 'high' : defaultSeverity;
}

function addMismatch(mismatches, field, expected, actual, severity = 'medium') {
  mismatches.push({ field, expected, actual, severity });
}

function classifyMismatch(mismatches) {
  if (mismatches.some((mismatch) => mismatch.severity === 'blocker')) return 'blocker';
  if (mismatches.some((mismatch) => mismatch.severity === 'high')) return 'high';
  if (mismatches.some((mismatch) => mismatch.severity === 'medium')) return 'medium';
  if (mismatches.some((mismatch) => mismatch.severity === 'low')) return 'low';
  return null;
}

function summarizeNativePlan(plan) {
  const proposed = plan?.proposed_order_state || {};
  return {
    success: plan?.success === true,
    action: getPlanAction(plan),
    error_code: plan?.error_code || plan?.order_sync_log_draft?.error_code || null,
    would_create_order: Boolean(plan?.would_create_order),
    would_update_order: Boolean(plan?.would_update_order),
    would_reject: Boolean(plan?.would_reject),
    would_quarantine: Boolean(plan?.would_quarantine),
    accepted_fields: toFieldNames(plan?.accepted_fields),
    rejected_fields: toFieldNames(plan?.rejected_fields),
    review_incident_type: plan?.order_review_queue_draft?.incident_type || null,
    proposed_order_number: proposed.shopify_order_number || null,
    proposed_source_channel: proposed.source_channel || null,
    proposed_source_type: proposed.source_type || null,
    proposed_order_type: proposed.order_type || null,
    proposed_payment_status: proposed.payment_status || null,
    proposed_production_status: proposed.production_status || null,
    proposed_fulfillment_status: proposed.fulfillment_status || null,
    warnings: Array.isArray(plan?.warnings) ? plan.warnings.map(String).slice(0, 10) : [],
  };
}

function evaluateExpected({ fixture, plan }) {
  const expected = fixture.expected || {};
  const mismatches = [];
  const action = getPlanAction(plan);
  const accepted = toFieldNames(plan?.accepted_fields);
  const rejected = toFieldNames(plan?.rejected_fields);
  const proposed = plan?.proposed_order_state || {};

  if (plan?.success !== true) {
    addMismatch(mismatches, 'success', true, plan?.success === true, 'blocker');
  }

  if (expected.action !== undefined && action !== normalizeAction(expected.action)) {
    addMismatch(mismatches, 'action', normalizeAction(expected.action), action, 'blocker');
  }

  for (const field of ['would_create_order', 'would_update_order', 'would_reject', 'would_quarantine']) {
    if (expected[field] !== undefined && Boolean(plan?.[field]) !== Boolean(expected[field])) {
      addMismatch(mismatches, field, Boolean(expected[field]), Boolean(plan?.[field]), field === 'would_reject' ? 'blocker' : 'high');
    }
  }

  if (expected.error_code !== undefined) {
    const actualErrorCode = plan?.error_code || plan?.order_sync_log_draft?.error_code || null;
    if (actualErrorCode !== expected.error_code) {
      addMismatch(mismatches, 'error_code', expected.error_code, actualErrorCode, expected.error_code ? 'blocker' : 'medium');
    }
  }

  if (expected.review_incident_type !== undefined) {
    const actualIncident = plan?.order_review_queue_draft?.incident_type || null;
    if (actualIncident !== expected.review_incident_type) {
      addMismatch(mismatches, 'review_incident_type', expected.review_incident_type, actualIncident, 'high');
    }
  }

  for (const field of expected.accepted_fields_include || []) {
    if (!accepted.includes(field)) {
      addMismatch(mismatches, `accepted_fields.${field}`, true, false, severityForField(field));
    }
  }

  for (const field of expected.accepted_fields_exclude || []) {
    if (accepted.includes(field)) {
      addMismatch(mismatches, `accepted_fields.${field}`, false, true, severityForField(field));
    }
  }

  for (const field of expected.rejected_fields_include || []) {
    if (!rejected.includes(field)) {
      addMismatch(mismatches, `rejected_fields.${field}`, true, false, severityForField(field));
    }
  }

  for (const field of expected.rejected_fields_exclude || []) {
    if (rejected.includes(field)) {
      addMismatch(mismatches, `rejected_fields.${field}`, false, true, severityForField(field));
    }
  }

  if (Number.isFinite(Number(expected.accepted_fields_exact_count)) && accepted.length !== Number(expected.accepted_fields_exact_count)) {
    addMismatch(mismatches, 'accepted_fields.count', Number(expected.accepted_fields_exact_count), accepted.length, 'medium');
  }

  if (Number.isFinite(Number(expected.rejected_fields_exact_count)) && rejected.length !== Number(expected.rejected_fields_exact_count)) {
    addMismatch(mismatches, 'rejected_fields.count', Number(expected.rejected_fields_exact_count), rejected.length, 'medium');
  }

  for (const [field, expectedValue] of Object.entries(expected.proposed_fields || {})) {
    const actualValue = getFieldValue(proposed, field);
    if (!valueMatches(actualValue, expectedValue)) {
      addMismatch(mismatches, `proposed_order_state.${field}`, expectedValue, actualValue, severityForField(field));
    }
  }

  const mismatchCategory = classifyMismatch(mismatches);
  return {
    fixture_id: fixture.fixture_id,
    description: fixture.description || null,
    source: fixture.source || 'customer_app',
    event_type: fixture.event_type || 'order.created',
    idempotency_key_present: Boolean(fixture.idempotency_key),
    matched: mismatches.length === 0,
    mismatch_category: mismatchCategory,
    mismatch_count: mismatches.length,
    mismatches,
    native_summary: summarizeNativePlan(plan),
  };
}

function summarizeAggregate(results) {
  const severityCounts = { blocker: 0, high: 0, medium: 0, low: 0 };
  for (const result of results) {
    for (const mismatch of result.mismatches || []) {
      if (severityCounts[mismatch.severity] !== undefined) severityCounts[mismatch.severity] += 1;
    }
  }

  const failed = results.filter((result) => !result.matched);
  return {
    success: failed.length === 0,
    dry_run: true,
    parity_status: failed.length === 0 ? 'pass' : 'fail',
    native_writer_enabled: false,
    hub_remains_live_writer: true,
    writes_performed: false,
    fixtures_run: results.length,
    fixtures_matched: results.length - failed.length,
    fixtures_failed: failed.length,
    severity_counts: severityCounts,
    failed_fixture_ids: failed.map((result) => result.fixture_id),
    blocker_fixture_ids: results
      .filter((result) => (result.mismatches || []).some((mismatch) => mismatch.severity === 'blocker'))
      .map((result) => result.fixture_id),
  };
}

function normalizeFixture(rawFixture, index) {
  const fixture = clone(rawFixture || {});
  fixture.fixture_id = String(fixture.fixture_id || `custom_fixture_${index + 1}`).slice(0, 120);
  fixture.source = String(fixture.source || 'customer_app');
  fixture.event_type = String(fixture.event_type || 'order.created');
  fixture.idempotency_key = fixture.idempotency_key || `g26a:custom:${fixture.fixture_id}`;
  fixture.incoming_payload = fixture.incoming_payload || fixture.incoming || {};
  fixture.starting_order = fixture.starting_order || fixture.existing_order || null;
  fixture.expected = fixture.expected || {};
  return fixture;
}

function selectFixtures(body) {
  const requestedIds = new Set(
    Array.isArray(body?.fixture_ids)
      ? body.fixture_ids.map((value) => String(value)).filter(Boolean)
      : [],
  );
  const sourceFixtures = Array.isArray(body?.fixtures) && body.fixtures.length > 0
    ? body.fixtures
    : DEFAULT_FIXTURES;
  const fixtures = sourceFixtures
    .map(normalizeFixture)
    .filter((fixture) => requestedIds.size === 0 || requestedIds.has(fixture.fixture_id))
    .slice(0, MAX_FIXTURES);
  return fixtures;
}

function getPreviewInternalSecret() {
  return Deno.env.get('NATIVE_SAFE_SYNC_PREVIEW_SECRET') ||
    Deno.env.get('CUSTOMER_APP_SYNC_SECRET') ||
    Deno.env.get('HUB_SYNC_SECRET') ||
    '';
}

function getNativeSafeSyncPreviewInvokeOptions() {
  return {
    headers: {
      'x-internal-secret': getPreviewInternalSecret(),
    },
  };
}

async function readJsonBody(req) {
  const raw = await req.text();
  if (!raw.trim()) return { ok: true, body: {} };
  try {
    return { ok: true, body: JSON.parse(raw) };
  } catch {
    return { ok: false, body: null };
  }
}

function unauthorized() {
  return Response.json({ success: false, error_code: 'unauthorized', message: 'Unauthorized' }, { status: 401 });
}

function forbidden() {
  return Response.json({ success: false, error_code: 'forbidden', message: 'Admin access required' }, { status: 403 });
}

async function requirePreviewAccess({ base44, req, body }) {
  const authHeader = req.headers.get('authorization') || '';
  const bearer = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : '';
  const bodySecret = String(body?.internal_secret || body?._internal_secret || '').trim();
  const headerSecret = String(req.headers.get('x-internal-secret') || '').trim();
  const expectedSecret = getPreviewInternalSecret();
  const providedSecret = headerSecret || bearer || bodySecret;

  if (providedSecret) {
    return expectedSecret && providedSecret === expectedSecret
      ? { ok: true, actor_type: 'system', actor_role: 'service' }
      : { ok: false, response: unauthorized() };
  }

  try {
    const user = await base44.auth.me().catch(() => null);
    if (!user) return { ok: false, response: unauthorized() };
    if (user.role !== 'admin') return { ok: false, response: forbidden() };
    return { ok: true, actor_type: 'admin', actor_role: 'admin' };
  } catch {
    return { ok: false, response: unauthorized() };
  }
}

async function runNativePlanner({ base44, fixture }) {
  const response = await base44.asServiceRole.functions.invoke('previewNativeSafeSyncOrderUpdate', {
    mode: 'dry_run',
    fixture_id: fixture.fixture_id,
    source: fixture.source,
    event_type: fixture.event_type,
    idempotency_key: fixture.idempotency_key,
    incoming_payload: fixture.incoming_payload || {},
    starting_order: fixture.starting_order || null,
  }, getNativeSafeSyncPreviewInvokeOptions());
  return response?.data || response;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ success: false, error_code: 'method_not_allowed', message: 'POST required' }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const parsed = await readJsonBody(req);
    if (!parsed.ok) {
      return Response.json({ success: false, error_code: 'malformed_json', message: 'Malformed JSON body' }, { status: 400 });
    }

    const body = parsed.body || {};
    if (body.mode && body.mode !== 'dry_run') {
      return Response.json({ success: false, error_code: 'dry_run_only', message: 'Only dry_run mode is supported' }, { status: 400 });
    }

    const auth = await requirePreviewAccess({ base44, req, body });
    if (!auth.ok) return auth.response;

    const fixtures = selectFixtures(body);
    if (fixtures.length === 0) {
      return Response.json({ success: false, dry_run: true, error_code: 'no_fixtures_selected', message: 'No parity fixtures selected' }, { status: 400 });
    }

    const results = [];
    for (const fixture of fixtures) {
      const nativePlan = await runNativePlanner({ base44, fixture });
      results.push(evaluateExpected({ fixture, plan: nativePlan }));
    }

    const aggregate = summarizeAggregate(results);
    return Response.json({
      ...aggregate,
      function_name: 'previewNativeSafeSyncParityHarness',
      harness_version: 'g26a',
      fixture_source: Array.isArray(body?.fixtures) && body.fixtures.length > 0 ? 'request' : 'default_g26a',
      max_fixtures: MAX_FIXTURES,
      results,
      safety: {
        dry_run_only: true,
        writes_performed: false,
        provider_calls_performed: false,
        hub_api_calls_performed: false,
        native_writer_enabled: false,
      },
    });
  } catch (error) {
    console.error(`[previewNativeSafeSyncParityHarness] failed safely: ${error?.message || 'unknown error'}`);
    return Response.json({
      success: false,
      dry_run: true,
      error_code: 'parity_harness_failed',
      message: 'Native safeSync parity harness failed safely.',
      writes_performed: false,
      native_writer_enabled: false,
    }, { status: 500 });
  }
});
