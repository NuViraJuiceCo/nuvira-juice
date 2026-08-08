const BATCH_ID = 'BATCH-G81-TEST-20260807-CONNECTED';
const TASK_ID = 'TASK-G81-TEST-20260807-CONNECTED';

function responseData(response) {
  return response?.data || response || {};
}

async function invoke(name, payload) {
  try {
    return {
      ok: true,
      data: responseData(await base44.functions.invoke('getAdminOperationsDashboardSummary', {
        gateway_action: name,
        payload,
      })),
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.status || error?.response?.status || null,
      data: error?.response?.data || null,
      message: String(error?.message || error).slice(0, 300),
    };
  }
}

function errorCode(result) {
  return result?.data?.error_code || result?.data?.error || '';
}

const production = await invoke('executeNativeProductionBatchLifecycle', {
  mode: 'live',
  confirmation: 'execute_native_production_batch_lifecycle',
  batch_id: BATCH_ID,
  action: 'start',
  request_id: `g81-gate-close-production-${Date.now()}`,
  reason: 'Confirm internal test production gate is closed',
});

const fulfillment = await invoke('executeNativeFulfillmentTaskLifecycle', {
  mode: 'live',
  confirmation: 'execute_native_fulfillment_task_lifecycle',
  fulfillment_task_id: TASK_ID,
  action: 'assign',
  request_id: `g81-gate-close-fulfillment-${Date.now()}`,
  reason: 'Confirm internal test fulfillment gate is closed',
  assigned_driver: 'NuVira Internal QA Driver',
});

const productionClosed = !production.ok && [
  'native_production_batch_test_lifecycle_writes_disabled',
  'native_production_batch_lifecycle_writes_disabled',
].includes(errorCode(production));
const fulfillmentClosed = !fulfillment.ok && [
  'native_fulfillment_task_test_lifecycle_writes_disabled',
  'native_fulfillment_task_lifecycle_writes_disabled',
].includes(errorCode(fulfillment));

const evidence = {
  success: productionClosed && fulfillmentClosed,
  production: { closed: productionClosed, status: production.status, error_code: errorCode(production) || null },
  fulfillment: { closed: fulfillmentClosed, status: fulfillment.status, error_code: errorCode(fulfillment) || null },
};

console.log(JSON.stringify(evidence, null, 2));
if (!evidence.success) throw new Error('One or more internal lifecycle test gates remain open');
