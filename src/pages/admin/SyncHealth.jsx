import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Database, RefreshCw, XCircle } from 'lucide-react';

import { base44 } from '@/api/base44Client';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { useAuth } from '@/lib/AuthContext';
import { isAdminUser } from '@/lib/admin-access';
import { usePageVisibility } from '@/lib/usePageVisibility';

function unwrapFunctionData(response) {
  const raw = response?.data ?? response ?? {};
  const payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!payload || typeof payload !== 'object' || payload.error || payload.success !== true) {
    throw new Error(payload?.error || 'Sync health summary is unavailable');
  }
  return payload;
}
function formatTimestamp(value) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatLabel(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, character => character.toUpperCase());
}

function MetricCard({ label, value, detail, icon: Icon, tone = 'default' }) {
  const toneClass = {
    success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
    warning: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    danger: 'border-red-500/30 bg-red-500/10 text-red-200',
    default: 'border-border bg-card text-foreground',
  }[tone];

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] opacity-75">{label}</p>
        <Icon className="h-4 w-4 opacity-80" />
      </div>
      <p className="text-2xl font-black leading-none">{Number(value || 0).toLocaleString()}</p>
      <p className="mt-2 text-xs opacity-75">{detail}</p>
    </div>
  );
}

function DirectionCard({ name, data = {} }) {
  const failed = Number(data.failed || 0);
  const pending = Number(data.pending || 0);
  const healthy = failed === 0 && pending === 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-foreground">{formatLabel(name)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{Number(data.total || 0).toLocaleString()} events in this reporting window</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${healthy ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-200'}`}>
          {healthy ? 'Healthy' : 'Attention'}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-secondary/60 px-2 py-3">
          <p className="text-lg font-black text-emerald-300">{Number(data.success || 0).toLocaleString()}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Success</p>
        </div>
        <div className="rounded-xl bg-secondary/60 px-2 py-3">
          <p className="text-lg font-black text-red-300">{failed.toLocaleString()}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Failed</p>
        </div>
        <div className="rounded-xl bg-secondary/60 px-2 py-3">
          <p className="text-lg font-black text-amber-200">{pending.toLocaleString()}</p>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Pending</p>
        </div>
      </div>
    </div>
  );
}

export default function SyncHealth() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPageVisible = usePageVisibility();

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ['admin-sync-health-summary'],
    queryFn: async () => unwrapFunctionData(await base44.functions.invoke('getAdminNativeSystemHealth', {})),
    enabled: isAdminUser(user) && isPageVisible,
    refetchInterval: isPageVisible ? 60000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  if (!isAdminUser(user)) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">Access denied.</div>;
  }

  const summary = data?.summary || {};
  const directions = data?.directions && typeof data.directions === 'object' ? data.directions : {};
  const errorCategories = Array.isArray(data?.error_categories) ? data.error_categories : [];
  const healthy = data?.native_available === true && Number(summary.failed_count || 0) === 0 && Number(summary.pending_count || 0) === 0 && Number(summary.stale_count || 0) === 0;

  return (
    <div className="min-h-screen bg-background">
      <AdminOpsHeader
        title="System Health"
        subtitle="Customer App native order and operations health"
        badge={healthy ? 'Healthy' : 'Review'}
        onBack={() => navigate('/admin/operations')}
        actions={(
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex h-9 items-center gap-2 rounded-xl border border-border bg-background px-3 text-xs font-bold text-foreground disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      />

      <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
        {isLoading ? (
          <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-border bg-card">
            <RefreshCw className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : isError ? (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-5 text-red-200">
            <div className="flex items-center gap-2 font-bold"><XCircle className="h-5 w-5" /> Sync health could not load</div>
            <p className="mt-2 text-sm opacity-80">{error?.message || 'Unknown error'}</p>
            <button type="button" onClick={() => refetch()} className="mt-4 rounded-xl border border-red-300/30 px-3 py-2 text-xs font-bold">Try again</button>
          </div>
        ) : (
          <>
            <section className={`rounded-2xl border p-5 ${healthy ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'}`}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  {healthy ? <CheckCircle2 className="mt-0.5 h-6 w-6 text-emerald-300" /> : <AlertTriangle className="mt-0.5 h-6 w-6 text-amber-200" />}
                  <div>
                    <h2 className="text-base font-black text-foreground">{healthy ? 'Current native workflow is healthy' : 'Current native workflow needs review'}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Customer App authoritative · Window {data?.date_from || '—'} through {data?.date_to || '—'}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Updated {formatTimestamp(data?.generated_at)}</p>
              </div>
            </section>

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard label="Events" value={summary.total_events} detail="Observed native events" icon={Activity} />
              <MetricCard label="Successful" value={summary.success_count} detail="Completed normally" icon={CheckCircle2} tone="success" />
              <MetricCard label="Failed" value={summary.failed_count} detail="Require correction" icon={XCircle} tone={Number(summary.failed_count || 0) > 0 ? 'danger' : 'default'} />
              <MetricCard label="Pending" value={summary.pending_count} detail="Still processing" icon={Clock3} tone={Number(summary.pending_count || 0) > 0 ? 'warning' : 'default'} />
              <MetricCard label="Stale" value={summary.stale_count} detail="Outside expected timing" icon={Database} tone={Number(summary.stale_count || 0) > 0 ? 'warning' : 'default'} />
            </section>

            <section className="space-y-3">
              <div>
                <h2 className="text-sm font-black text-foreground">Workflow health</h2>
                <p className="mt-1 text-xs text-muted-foreground">Current native processing and operational review activity.</p>
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                {Object.entries(directions).map(([name, direction]) => <DirectionCard key={name} name={name} data={direction} />)}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-black text-foreground">Current error categories</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Only active categories from the reporting window are shown.</p>
                </div>
                <span className="rounded-full bg-secondary px-2.5 py-1 text-xs font-bold text-muted-foreground">{errorCategories.length}</span>
              </div>
              {errorCategories.length === 0 ? (
                <div className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-3 text-sm text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" /> No active sync error categories.
                </div>
              ) : (
                <div className="mt-4 space-y-2">
                  {errorCategories.map((category, index) => (
                    <div key={`${category?.category || category?.name || 'error'}-${index}`} className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-3">
                      <p className="text-sm font-bold text-foreground">{formatLabel(category?.category || category?.name || 'Sync error')}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{Number(category?.count || 0).toLocaleString()} event(s)</p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border border-border/70 bg-secondary/30 px-4 py-3 text-xs text-muted-foreground">
              Legacy launch, one-order, and historical backfill controls have been retired from this page. Current corrections belong in the dedicated Orders, Production, Delivery, and Review Queue workflows.
            </section>
          </>
        )}
      </main>
    </div>
  );
}
