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

function safety(data) {
  const nested = data?.safety || {};
  return {
    writes_performed: data?.writes_performed === true || data?.runtimeWritesPerformed === true || nested.writes_performed === true,
    provider_calls_performed: data?.provider_calls_performed === true || data?.provider_call_impact === true || nested.provider_calls_performed === true,
    notifications_sent: data?.notifications_sent === true || nested.notifications_sent === true,
    hub_mutation_performed: data?.hub_mutation_performed === true || nested.hub_mutation_performed === true || nested.hub_bridge_modified === true,
  };
}

function noUnsafeSideEffects(entries) {
  return Object.values(entries).every(item => (
    item.writes_performed === false &&
    item.provider_calls_performed === false &&
    item.notifications_sent === false &&
    item.hub_mutation_performed === false
  ));
}

const today = chicagoDate(0);
const tomorrow = chicagoDate(1);
const startedAt = new Date().toISOString();

const calls = {
  cutover: await timed('previewNativeOrderCutoverReadiness', {
    mode: 'dry_run',
  }),
  operations: await timed('getAdminOperationsDashboardSummary', {
    preset: 'today',
  }),
  production: await timed('getAdminProductionQueueSummary', {
    date_from: today,
    date_to: today,
  }),
  compliance: await timed('getAdminComplianceOpsSummary', {
    date_from: today,
    date_to: today,
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
  push: await timed('getAdminPushDiagnostics', {
    mode: 'read_only',
  }),
};

const safetyByCall = Object.fromEntries(
  Object.entries(calls).map(([key, call]) => [key, safety(call.data)])
);

const output = {
  success: Object.values(calls).every(call => call.ok),
  generated_at: new Date().toISOString(),
  started_at: startedAt,
  actor: 'base44_current_user',
  mode: 'read_only_runtime_baseline',
  date_context: {
    today,
    tomorrow,
  },
  calls: Object.fromEntries(
    Object.entries(calls).map(([key, call]) => [key, {
      ok: call.ok,
      name: call.name,
      ms: call.ms,
      error: call.error,
    }])
  ),
  safety: safetyByCall,
  summary: {
    cutover_classification: calls.cutover.data?.classification || calls.cutover.data?.readiness?.classification || null,
    cutover_blockers: calls.cutover.data?.blockers || calls.cutover.data?.readiness?.blockers || calls.cutover.data?.blocker_reasons || [],
    cutover_warnings: calls.cutover.data?.warnings || calls.cutover.data?.readiness?.warnings || [],
    hub_retirement_status: calls.cutover.data?.hub_retirement_readiness?.status || null,
    hub_retirement_blockers: calls.cutover.data?.hub_retirement_readiness?.blockers || [],
    gates: calls.cutover.data?.gates || null,
    operations: {
      source: calls.operations.data?.source || calls.operations.data?.data_source || null,
      summary: calls.operations.data?.summary || null,
      warnings: calls.operations.data?.warnings || [],
      diagnostics_enabled: calls.operations.data?.diagnostics_enabled === true,
      native_ops_health_overlay: calls.operations.data?.native_ops_health_overlay || null,
    },
    production: {
      count: Array.isArray(calls.production.data?.batches) ? calls.production.data.batches.length : null,
      data_sources: calls.production.data?.data_sources || null,
      warnings: calls.production.data?.warnings || [],
      statuses: Array.isArray(calls.production.data?.batches)
        ? Object.entries(calls.production.data.batches.reduce((acc, batch) => {
          const status = batch?.status || 'unknown';
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        }, {}))
        : [],
    },
    compliance: {
      counts: calls.compliance.data?.counts || calls.compliance.data?.summary || {},
      warnings: calls.compliance.data?.warnings || [],
      native_available: calls.compliance.data?.native_available === true,
    },
    delivery_today: {
      summary: calls.delivery_today.data?.summary || null,
      read_model: {
        available: calls.delivery_today.data?.delivery_lifecycle_read_model_available === true,
        enabled: calls.delivery_today.data?.delivery_lifecycle_read_model_enabled === true,
        version: calls.delivery_today.data?.delivery_lifecycle_read_model_version || null,
      },
      sections: {
        delivery_stops: calls.delivery_today.data?.sections?.delivery_stops?.length ?? calls.delivery_today.data?.delivery_stops?.length ?? null,
        completed: calls.delivery_today.data?.sections?.completed?.length ?? calls.delivery_today.data?.completed?.length ?? null,
        unscheduled_delivery_orders: calls.delivery_today.data?.sections?.unscheduled_delivery_orders?.length ?? calls.delivery_today.data?.unscheduled_delivery_orders?.length ?? null,
      },
    },
    delivery_tomorrow: {
      summary: calls.delivery_tomorrow.data?.summary || null,
      sections: {
        delivery_stops: calls.delivery_tomorrow.data?.sections?.delivery_stops?.length ?? calls.delivery_tomorrow.data?.delivery_stops?.length ?? null,
        completed: calls.delivery_tomorrow.data?.sections?.completed?.length ?? calls.delivery_tomorrow.data?.completed?.length ?? null,
        unscheduled_delivery_orders: calls.delivery_tomorrow.data?.sections?.unscheduled_delivery_orders?.length ?? calls.delivery_tomorrow.data?.unscheduled_delivery_orders?.length ?? null,
      },
    },
    push: {
      ready: calls.push.data?.ready === true || calls.push.data?.push_ready === true,
      active_subscription_count: calls.push.data?.active_subscription_count ?? null,
      warnings: calls.push.data?.warnings || [],
    },
  },
  no_writes_or_provider_calls: noUnsafeSideEffects(safetyByCall),
};

console.log(JSON.stringify(output, null, 2));
