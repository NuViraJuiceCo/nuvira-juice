import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { isAdminUser } from '@/lib/admin-access';
import { useAuth } from '@/lib/AuthContext';
import { Activity, AlertTriangle, CheckCircle2, Clock3, Search } from 'lucide-react';

function formatDateTime(value) {
  if (!value) return 'Not recorded';
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

function formatLabel(value) {
  if (!value) return 'Not set';
  return value.toString().split(/[_\s-]+/).filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function statusKey(value) {
  return (value || '').toString().trim().toLowerCase();
}

const RETIRED_NATIVE_ORDER_FUNCTION = ['process', 'May', '30', 'NativeOrderOps'].join('');

function isRetiredHistoricalCommand(row) {
  const functionName = String(row?.function_name || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const commandType = String(row?.command_type || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  const retiredFunction = RETIRED_NATIVE_ORDER_FUNCTION.toLowerCase();
  return functionName === retiredFunction || commandType === retiredFunction.replace(/^process/, '');
}

function matchesSearch(row, search) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    row.command_id,
    row.command_type,
    row.command_source,
    row.status,
    row.target_entity,
    row.target_display_id,
    row.function_name,
    row.related_order_number,
    row.error_code,
    row.notes,
  ].filter(Boolean).join(' ').toLowerCase().includes(query);
}

function StatCard({ icon: Icon, label, value, sublabel, tone = 'default', isRefreshing }) {
  const toneClass = {
    default: 'border-border/50 bg-card',
    success: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30',
    warning: 'border-cyan-200 bg-cyan-50/70 dark:border-cyan-900/60 dark:bg-cyan-950/30',
    danger: 'border-red-200 bg-red-50/70 dark:border-red-900/60 dark:bg-red-950/30',
  }[tone] || 'border-border/50 bg-card';
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      {Icon && <Icon className={`mb-1 h-4 w-4 text-primary ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{Number(value || 0).toLocaleString()}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function AuditCard({ row }) {
  return (
    <article className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{row.function_name || row.command_source || 'Command'}</p>
          <h2 className="mt-0.5 text-base font-bold text-foreground">{formatLabel(row.command_type || row.command_id || 'Audit event')}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(row.completed_at || row.submitted_at || row.created_date)}</p>
        </div>
        <AdminStatusPill value={row.status} label={formatLabel(row.status)} size="md" />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Target</p>
          <p className="mt-1 text-xs font-semibold text-foreground">{row.target_display_id || row.related_order_number || row.target_entity || 'Not recorded'}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Actor Type</p>
          <p className="mt-1 text-xs font-semibold text-foreground">{formatLabel(row.actor_type || row.actor_role || 'system')}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Duration</p>
          <p className="mt-1 text-xs font-semibold text-foreground">{row.duration_ms ? `${row.duration_ms}ms` : '-'}</p>
        </div>
      </div>

      {(row.error_code || row.error_message) && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-950 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{row.error_code || 'Error'}</p>
          <p className="mt-1 text-sm leading-relaxed">{row.error_message || 'Command returned an error.'}</p>
        </div>
      )}

      {row.notes && <p className="mt-3 rounded-lg border border-border/50 bg-background p-3 text-xs text-muted-foreground">{row.notes}</p>}

      <p className="mt-3 text-[10px] text-muted-foreground">
        Payload and result bodies are hidden in this view to keep audit review safe and focused.
      </p>
    </article>
  );
}

export default function AuditTrail() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [includeRetiredHistory, setIncludeRetiredHistory] = useState(false);

  const { data = [], isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-audit-trail-read-model'],
    queryFn: () => base44.entities.CommandLog.list('-created_date', 150),
    enabled: isAdminUser(user),
    staleTime: 60000,
  });

  const rows = Array.isArray(data) ? data : [];
  const retiredHistory = useMemo(() => rows.filter(isRetiredHistoricalCommand), [rows]);
  const visibleRows = useMemo(() => includeRetiredHistory ? rows : rows.filter(row => !isRetiredHistoricalCommand(row)), [includeRetiredHistory, rows]);
  const stats = useMemo(() => ({
    total: visibleRows.length,
    success: visibleRows.filter(row => statusKey(row.status) === 'success').length,
    failed: visibleRows.filter(row => statusKey(row.status) === 'failed').length,
    running: visibleRows.filter(row => ['pending', 'running'].includes(statusKey(row.status))).length,
  }), [visibleRows]);

  const filtered = useMemo(() => visibleRows.filter(row => {
    const key = statusKey(row.status);
    if (statusFilter !== 'all' && key !== statusFilter) return false;
    return matchesSearch(row, search);
  }), [visibleRows, search, statusFilter]);

  if (!isAdminUser(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader title="Audit Trail" subtitle="Read-only command history" badge="Read-only" />

      <main className="mx-auto mt-4 w-full max-w-[1180px] space-y-4 px-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard icon={Activity} label="Commands" value={stats.total} isRefreshing={isFetching} />
          <StatCard icon={CheckCircle2} label="Success" value={stats.success} tone="success" />
          <StatCard icon={AlertTriangle} label="Failed" value={stats.failed} tone={stats.failed > 0 ? 'danger' : 'default'} />
          <StatCard icon={Clock3} label="Pending / Running" value={stats.running} tone={stats.running > 0 ? 'warning' : 'default'} />
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_180px]">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search command, function, target, order..."
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="all">All status</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
              <option value="pending">Pending</option>
              <option value="running">Running</option>
              <option value="rejected">Rejected</option>
              <option value="skipped">Skipped</option>
            </select>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            This page is visibility only. It does not retry, replay, repair, sync, notify, or expose raw command payloads.
          </p>
          {retiredHistory.length > 0 && (
            <label className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={includeRetiredHistory}
                onChange={event => setIncludeRetiredHistory(event.target.checked)}
                className="h-4 w-4 rounded border-border"
              />
              Include {retiredHistory.length.toLocaleString()} retired historical commands
            </label>
          )}
        </section>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load audit trail</p>
            <p className="mt-1 text-xs text-muted-foreground">{error?.message || 'Try again later.'}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No command records found</p>
            <p className="mt-1 text-xs text-muted-foreground">Adjust filters or check after the next controlled operation.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {filtered.map(row => <AuditCard key={row.id || row.command_id || `${row.function_name}-${row.created_date}`} row={row} />)}
          </div>
        )}
      </main>
    </div>
  );
}
