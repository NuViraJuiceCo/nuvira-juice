const TEST_BATCH_ID = 'BATCH-G53-TEST-20260723-AURA';

function data(response) {
  return response?.data || response || {};
}

function safeError(error) {
  return {
    message: (error?.message || String(error)).slice(0, 300),
    status: error?.status || error?.response?.status || null,
    code: error?.code || null,
  };
}

async function invoke(name, payload) {
  try {
    return { ok: true, data: data(await base44.functions.invoke(name, payload)), error: null };
  } catch (error) {
    return { ok: false, data: null, error: safeError(error) };
  }
}

const user = await base44.auth.me();
const batches = await base44.entities.ProductionBatch.filter({ batch_id: TEST_BATCH_ID }, '-created_date', 5);
const batch = batches[0] || null;
const preview = batch ? await invoke('previewNativeProductionBatchLifecycle', {
  mode: 'dry_run',
  action: 'verify',
  batch,
  request_id: 'g53-phase-a-postpilot-closure-preview-20260723-v1',
}) : { ok: false, data: null, error: { message: 'batch_not_found' } };

const lifecycleLogs = await base44.entities.CommandLog.filter(
  { target_display_id: TEST_BATCH_ID },
  '-created_date',
  20,
);

const result = {
  success:
    user?.role === 'admin' &&
    batches.length === 1 &&
    batch?.is_test_batch === true &&
    batch?.status === 'verified_logged' &&
    lifecycleLogs.filter(log => log?.command_type === 'native_production_batch_lifecycle').length === 4 &&
    preview.ok === true &&
    Array.isArray(preview.data?.live_command_blockers) &&
    preview.data.live_command_blockers.includes('batch_not_allowlisted') &&
    preview.data.live_command_available === false,
  classification: 'phase_a_live_pilot_closed_read_only_audit_preserved',
  verified_at_utc: new Date().toISOString(),
  operator: {
    email: user?.email || null,
    role: user?.role || null,
  },
  persisted_batch: batch ? {
    id: batch.id,
    batch_id: batch.batch_id,
    status: batch.status,
    is_test_batch: batch.is_test_batch === true,
    audit_trail_count: Array.isArray(batch.audit_trail) ? batch.audit_trail.length : 0,
    compliance_log_id: batch.compliance_log_id || null,
    inventory_deduction_status: batch.inventory_deduction_status || null,
  } : null,
  lifecycle_command_log_count: lifecycleLogs.filter(log => log?.command_type === 'native_production_batch_lifecycle').length,
  mutation_gate: {
    live_command_available: preview.data?.live_command_available === true,
    live_command_blockers: preview.data?.live_command_blockers || [],
    test_batch_allowlisted: preview.data?.live_gate?.batch_allowlisted === true,
  },
  safety: {
    writes_performed: false,
    provider_calls_performed: false,
    customer_notifications_sent: false,
    inventory_mutations_performed: false,
  },
};

console.log(JSON.stringify(result, null, 2));
if (!result.success) throw new Error('G53 post-pilot closure verification failed');
