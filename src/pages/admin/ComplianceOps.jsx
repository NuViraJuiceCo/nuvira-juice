import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  RefreshCw,
  ShieldCheck,
  Thermometer,
} from 'lucide-react';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const MAX_RANGE_DAYS = 31;

function todayDate() {
  const today = new Date();
  const year = today.getFullYear();
  const month = `${today.getMonth() + 1}`.padStart(2, '0');
  const day = `${today.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysInclusive(from, to) {
  if (!from || !to) return 0;
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1;
}

function formatDate(value) {
  if (!value) return 'Date pending';
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatDateTime(value) {
  if (!value) return null;
  try {
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function formatLabel(value) {
  if (!value) return 'Not set';
  return value
    .toString()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map(word => {
      const lower = word.toLowerCase();
      if (['ph', 'ccp', 'pos', 'id'].includes(lower)) return lower === 'ph' ? 'pH' : lower.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

function validateRange(from, to) {
  if (!from || !to) return 'Choose a start and end date.';
  if (to < from) return 'End date must be on or after start date.';
  if (daysInclusive(from, to) > MAX_RANGE_DAYS) return `Date range must be ${MAX_RANGE_DAYS} days or fewer.`;
  return null;
}

function StatCard({ icon: Icon, label, value, sublabel, tone = 'neutral', isRefreshing }) {
  const toneClass = {
    neutral: 'border-slate-300 bg-slate-100 text-slate-950 border-l-slate-600',
    success: 'border-emerald-300 bg-emerald-100 text-emerald-950 border-l-emerald-600',
    warning: 'border-amber-300 bg-amber-100 text-amber-950 border-l-amber-500',
    danger: 'border-rose-300 bg-rose-100 text-rose-950 border-l-rose-600',
    info: 'border-sky-300 bg-sky-100 text-sky-950 border-l-sky-600',
  }[tone] || 'border-slate-300 bg-slate-100 text-slate-950 border-l-slate-600';

  return (
    <div className={`rounded-xl border border-l-4 p-3 shadow-sm ${toneClass}`}>
      {Icon && <Icon className={`w-4 h-4 mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider font-black opacity-75">{label}</p>
      <p className="text-xl font-black">{formatNumber(value)}</p>
      {sublabel && <p className="text-[10px] font-semibold opacity-75">{sublabel}</p>}
    </div>
  );
}

function RangeControls({ dateFrom, dateTo, setDateFrom, setDateTo, rangeError }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <CalendarDays className="w-4 h-4 text-primary" />
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compliance date range</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">From</span>
          <input
            type="date"
            value={dateFrom}
            onChange={event => setDateFrom(event.target.value)}
            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="space-y-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">To</span>
          <input
            type="date"
            value={dateTo}
            onChange={event => setDateTo(event.target.value)}
            className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
      </div>
      {rangeError ? (
        <p className="text-xs text-destructive">{rangeError}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Showing Hub compliance records from {formatDate(dateFrom)} through {formatDate(dateTo)}.
        </p>
      )}
      <AdminStatusLegend />
    </div>
  );
}

function AttentionList({ data }) {
  const issues = data?.issues || {};
  const entries = [
    ['temp_out_of_range', 'Temperature out of range'],
    ['ph_out_of_range', 'pH out of range'],
    ['ccp_failed', 'CCP failures'],
    ['sanitation_issues', 'Sanitation issues'],
    ['incomplete_checklists', 'Incomplete checklists'],
    ['open_corrective_actions', 'Open corrective actions'],
    ['failed_batch_logs', 'Failed batch logs'],
    ['batches_missing_compliance_log', 'Batches missing compliance log'],
  ].filter(([key]) => Number(issues[key] || 0) > 0);

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="w-5 h-5 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-black">No compliance attention items in this range</p>
            <p className="text-xs font-medium opacity-80 mt-0.5">Keep logging temperature, sanitation, checklist, batch, and corrective records during production.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-black">{formatNumber(issues.total_attention_items)} compliance attention item{Number(issues.total_attention_items) === 1 ? '' : 's'}</p>
          <p className="text-xs font-medium opacity-80 mt-0.5">Use the Hub-backed compliance workflow for corrections and official records.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {entries.map(([key, label]) => (
          <div key={key} className="rounded-lg border border-amber-300 bg-white/60 p-2">
            <p className="text-[10px] uppercase tracking-wider font-black opacity-70">{label}</p>
            <p className="text-lg font-black">{formatNumber(issues[key])}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function LogList({ title, logs, emptyText }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        <AdminStatusPill label={`${logs.length} rows`} tone="hub" />
      </div>
      {logs.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        <div className="space-y-2">
          {logs.slice(0, 20).map(log => (
            <div key={`${log.type}-${log.id}-${log.date}-${log.time}`} className="rounded-lg border border-border/50 bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-1.5 mb-1">
                    <AdminStatusPill value={log.type} label={formatLabel(log.type)} tone="hub" />
                    <AdminStatusPill value={log.status || (log.within_range === false ? 'out_of_range' : 'ok')} />
                  </div>
                  <p className="text-sm font-semibold text-foreground truncate">
                    {log.product_name || log.batch_id || log.location || 'Compliance record'}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(log.date)} {log.time ? `· ${log.time}` : ''}{log.staff_member ? ` · ${log.staff_member}` : ''}
                  </p>
                </div>
                {log.value !== null && log.value !== undefined && (
                  <p className="text-xs font-bold text-foreground shrink-0">{log.value}</p>
                )}
              </div>
            </div>
          ))}
          {logs.length > 20 && <p className="text-[10px] text-muted-foreground">Showing 20 of {logs.length} records.</p>}
        </div>
      )}
    </section>
  );
}

function BatchAttentionList({ batches }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-foreground">Batch Compliance Attention</h2>
        <AdminStatusPill label={`${batches.length} batches`} tone={batches.length ? 'warning' : 'success'} />
      </div>
      {batches.length === 0 ? (
        <p className="text-xs text-muted-foreground">No Hub production batches in this range are missing compliance linkage or requiring corrective action.</p>
      ) : (
        <div className="space-y-2">
          {batches.map(batch => (
            <div key={batch.id || batch.batch_id} className="rounded-lg border border-border/50 bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{batch.product_name || 'Production batch'}</p>
                  <p className="text-xs text-muted-foreground">{batch.batch_id || 'No batch id'} · {formatDate(batch.production_date)}</p>
                </div>
                <AdminStatusPill value={batch.status} label={formatLabel(batch.status)} />
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2">
                <AdminStatusPill label={batch.compliance_log_id_present ? 'Compliance logged' : 'Missing compliance log'} tone={batch.compliance_log_id_present ? 'success' : 'warning'} />
                {batch.corrective_action_required && (
                  <AdminStatusPill label={batch.corrective_action_log_id_present ? 'Corrective linked' : 'Corrective needed'} tone={batch.corrective_action_log_id_present ? 'success' : 'danger'} />
                )}
                {batch.is_locked && <AdminStatusPill label="Locked" tone="hub" />}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function ComplianceOps() {
  const { user } = useAuth();
  const defaultTo = useMemo(() => todayDate(), []);
  const defaultFrom = useMemo(() => addDays(defaultTo, -6), [defaultTo]);
  const [dateFrom, setDateFrom] = useState(defaultFrom);
  const [dateTo, setDateTo] = useState(defaultTo);
  const rangeError = validateRange(dateFrom, dateTo);

  const { data, isLoading, isError, error, isFetching, refetch } = useQuery({
    queryKey: ['admin-compliance-ops-summary', dateFrom, dateTo],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminComplianceOpsSummary', {
        date_from: dateFrom,
        date_to: dateTo,
      });
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    enabled: user?.role === 'admin' && !rangeError,
    staleTime: 60000,
  });

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  const summary = data?.summary || {};
  const issues = data?.issues || {};
  const recentLogs = data?.recent_logs || [];
  const batchLogs = data?.batch_compliance || [];
  const attentionBatches = data?.attention_batches || [];

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Compliance Ops"
        subtitle="Hub-backed compliance visibility for production, sanitation, temperature, checklist, and corrective records"
        badge="Hub fallback"
        badgeTone="hub"
        actions={(
          <button
            type="button"
            onClick={() => refetch()}
            className="h-9 rounded-lg border border-slate-700 bg-slate-900 px-3 text-xs font-semibold text-emerald-300"
          >
            <RefreshCw className={`inline-block w-3.5 h-3.5 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        )}
      />

      <div className="px-4 mt-4 space-y-4">
        <RangeControls
          dateFrom={dateFrom}
          dateTo={dateTo}
          setDateFrom={setDateFrom}
          setDateTo={setDateTo}
          rangeError={rangeError}
        />

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load compliance summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        ) : !rangeError ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              <StatCard icon={ShieldCheck} label="Attention" value={issues.total_attention_items} tone={issues.total_attention_items ? 'warning' : 'success'} />
              <StatCard icon={Thermometer} label="Temperature" value={summary.temperature} sublabel={`${formatNumber(issues.temp_out_of_range)} out of range`} tone={issues.temp_out_of_range ? 'danger' : 'info'} />
              <StatCard icon={ClipboardCheck} label="Checklists" value={summary.daily_checklists} sublabel={`${formatNumber(issues.incomplete_checklists)} incomplete`} tone={issues.incomplete_checklists ? 'warning' : 'info'} />
              <StatCard icon={FileCheck2} label="Batch Logs" value={summary.batch_compliance_logs} sublabel={`${formatNumber(issues.batches_missing_compliance_log)} missing`} tone={issues.batches_missing_compliance_log ? 'warning' : 'success'} />
            </div>

            <AttentionList data={data} />

            <div className="rounded-xl border border-border/50 bg-card p-4">
              <div className="flex items-start gap-2">
                <ShieldCheck className="w-5 h-5 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-bold text-foreground">Official compliance records remain Hub-backed for May 30</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Use this page for Customer App visibility. Create or correct official sanitation, temperature, checklist, corrective, pH, CCP, and binder records in the existing Hub compliance workflow until native compliance write contracts are migrated.
                  </p>
                  {data?.generated_at && (
                    <p className="text-[10px] text-muted-foreground mt-2">Generated {formatDateTime(data.generated_at)}</p>
                  )}
                </div>
              </div>
            </div>

            <BatchAttentionList batches={attentionBatches} />

            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              <LogList
                title="Recent Compliance Logs"
                logs={recentLogs}
                emptyText="No temperature, pH, CCP, sanitation, or corrective records returned for this date range."
              />
              <LogList
                title="Recent Batch Compliance Logs"
                logs={batchLogs}
                emptyText="No batch compliance logs returned for this date range."
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
