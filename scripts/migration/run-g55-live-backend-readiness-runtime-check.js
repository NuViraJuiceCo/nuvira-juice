function chicagoDate(offsetDays = 0) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const year = Number(parts.find(part => part.type === 'year')?.value);
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function payload(res) {
  return res?.data || res || {};
}

async function timed(name, args = {}) {
  const started = Date.now();
  try {
    const res = await base44.functions.invoke(name, args);
    return {
      ok: true,
      name,
      ms: Date.now() - started,
      error: null,
      data: payload(res),
    };
  } catch (error) {
    return {
      ok: false,
      name,
      ms: Date.now() - started,
      error: error?.message || String(error),
      data: null,
    };
  }
}

function sideEffects(data = {}) {
  data = data || {};
  const safety = data.read_only_safety || data.safety || {};
  return {
    writes_performed: data.writes_performed === true || safety.writes_performed === true,
    provider_calls_performed: data.provider_calls_performed === true || safety.provider_calls_performed === true,
    customer_notifications_sent: data.customer_notifications_sent === true || data.notifications_sent === true || safety.customer_notifications_sent === true || safety.notifications_sent === true,
    inventory_mutation: data.inventory_mutation === true || safety.inventory_mutation === true,
    bulk_sync: data.bulk_sync === true || safety.bulk_sync === true,
  };
}

const today = chicagoDate(0);
const tomorrow = chicagoDate(1);
const startedAt = new Date().toISOString();

const calls = {
  backend_readiness: await timed('getAdminOperationsDashboardSummary', {
    include_backend_readiness: true,
    date_from: chicagoDate(-7),
    date_to: chicagoDate(7),
  }),
  operations: await timed('getAdminOperationsDashboardSummary', {
    preset: 'today',
  }),
  production_today: await timed('getAdminProductionQueueSummary', {
    date_from: today,
    date_to: today,
  }),
  production_tomorrow: await timed('getAdminProductionQueueSummary', {
    date_from: tomorrow,
    date_to: tomorrow,
  }),
  delivery_today: await timed('getAdminDeliveryRouteSummary', {
    delivery_date: today,
    limit: 100,
    read_model_mode: 'DELIVERY_LIFECYCLE',
    test_task_mode: 'exclude',
  }),
  delivery_tomorrow: await timed('getAdminDeliveryRouteSummary', {
    delivery_date: tomorrow,
    limit: 100,
    read_model_mode: 'DELIVERY_LIFECYCLE',
    test_task_mode: 'exclude',
  }),
  push_diagnostics: await timed('getAdminPushDiagnostics', {
    mode: 'read_only',
  }),
};

const safety = Object.fromEntries(
  Object.entries(calls).map(([key, call]) => [key, sideEffects(call.data)])
);

const backend = calls.backend_readiness.data?.backend_readiness || {};
const unsafe = Object.values(safety).some(item => (
  item.writes_performed ||
  item.provider_calls_performed ||
  item.customer_notifications_sent ||
  item.inventory_mutation ||
  item.bulk_sync
));

console.log(JSON.stringify({
  success: Object.values(calls).every(call => call.ok) && !unsafe,
  classification: backend.classification || 'backend_readiness_unavailable',
  generated_at: new Date().toISOString(),
  started_at: startedAt,
  mode: 'g55_live_backend_readiness_read_only',
  date_context: {
    today,
    tomorrow,
    backend_range: {
      date_from: chicagoDate(-7),
      date_to: chicagoDate(7),
    },
  },
  calls: Object.fromEntries(
    Object.entries(calls).map(([key, call]) => [key, {
      ok: call.ok,
      name: call.name,
      ms: call.ms,
      error: call.error,
    }])
  ),
  safety,
  backend_readiness_summary: backend.summary || null,
  backend_readiness_next_action: backend.next_action || null,
  backend_readiness_issue_preview: Array.isArray(backend.issues) ? backend.issues.slice(0, 12) : [],
  operations_summary_available: Boolean(calls.operations.data?.summary),
  production_today_count: Array.isArray(calls.production_today.data?.batches) ? calls.production_today.data.batches.length : null,
  production_tomorrow_count: Array.isArray(calls.production_tomorrow.data?.batches) ? calls.production_tomorrow.data.batches.length : null,
  delivery_today_sections: calls.delivery_today.data?.sections
    ? Object.fromEntries(Object.entries(calls.delivery_today.data.sections).map(([key, value]) => [key, Array.isArray(value) ? value.length : null]))
    : null,
  delivery_tomorrow_sections: calls.delivery_tomorrow.data?.sections
    ? Object.fromEntries(Object.entries(calls.delivery_tomorrow.data.sections).map(([key, value]) => [key, Array.isArray(value) ? value.length : null]))
    : null,
  push_ready: calls.push_diagnostics.data?.ready === true || calls.push_diagnostics.data?.push_ready === true,
  no_writes_or_provider_calls: !unsafe,
}, null, 2));
