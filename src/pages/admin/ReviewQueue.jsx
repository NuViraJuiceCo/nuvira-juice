import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { isAdminUser } from '@/lib/admin-access';
import { useAuth } from '@/lib/AuthContext';
import { unwrapBase44Result } from '@/lib/base44-result';
import { usePageVisibility } from '@/lib/usePageVisibility';
import { AlertTriangle, CheckCircle2, Clock3, Search, ShieldCheck } from 'lucide-react';

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

function matchesSearch(row, search) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    row.incident_type,
    row.customer_email,
    row.customer_name,
    row.existing_order_number,
    row.incoming_source,
    row.issue_description,
    row.recommended_action,
    row.admin_notes,
    row.status,
  ].filter(Boolean).join(' ').toLowerCase().includes(query);
}

function StatCard({ icon: Icon, label, value, sublabel, isRefreshing }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      {Icon && <Icon className={`mb-1 h-4 w-4 text-primary ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">{Number(value || 0).toLocaleString()}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function ReviewCard({ row }) {
  const occurrenceCount = Number(row.occurrence_count || 0);
  return (
    <article className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{formatLabel(row.incident_type || 'review')}</p>
          <h2 className="mt-0.5 text-base font-bold text-foreground">{row.existing_order_number || row.customer_name || 'Review item'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{row.incoming_source || 'Source pending'}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <AdminStatusPill value={row.status} label={formatLabel(row.status)} size="md" />
          {occurrenceCount > 1 && <AdminStatusPill value="repeat" label={`${occurrenceCount} times`} size="md" />}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Customer</p>
          <p className="mt-1 text-xs font-semibold text-foreground">{row.customer_name || row.customer_email || 'Not recorded'}</p>
        </div>
        <div className="rounded-lg border border-border/50 bg-background p-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Last Seen</p>
          <p className="mt-1 text-xs font-semibold text-foreground">{formatDateTime(row.last_seen_at || row.updated_date || row.created_date)}</p>
        </div>
      </div>

      {row.issue_description && (
        <div className="mt-3 rounded-lg border border-border/50 bg-background p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Issue</p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/85">{row.issue_description}</p>
        </div>
      )}

      {row.recommended_action && (
        <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-cyan-950 dark:border-cyan-900/60 dark:bg-cyan-950/30 dark:text-cyan-100">
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-75">Recommended Action</p>
          <p className="mt-1 text-sm leading-relaxed">{row.recommended_action}</p>
        </div>
      )}

      <p className="mt-3 text-[10px] text-muted-foreground">
        Raw incoming payload is intentionally hidden here. Use exact approved repair/reconciliation tools only when a single item is ready.
      </p>
    </article>
  );
}

export default function ReviewQueue() {
  const { user } = useAuth();
  const isPageVisible = usePageVisibility();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('open');

  const { data = [], isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-review-queue-read-model', search, statusFilter],
    queryFn: async () => {
      const response = await base44.functions.invoke('getAdminOpsAlertsSummary', {
        include_review_queue_only: true,
        review_status: statusFilter,
        review_search: search,
        review_limit: 150,
      });
      const result = unwrapBase44Result(response);
      if (result?.success === false || result?.error) {
        throw new Error(result?.error || 'Unable to load review queue');
      }
      return result || { rows: [], summary: {} };
    },
    enabled: isAdminUser(user) && isPageVisible,
    staleTime: 60000,
    refetchOnWindowFocus: true,
  });

  const rows = Array.isArray(data?.rows) ? data.rows : [];
  const stats = useMemo(() => {
    const summary = data?.summary || {};
    return {
      total: Number(summary.total || 0),
      open: Number(summary.open || 0),
      resolved: Number(summary.resolved || 0),
      refund: Number(summary.refund_related || 0),
    };
  }, [data]);

  const filtered = useMemo(() => rows.filter(row => {
    return matchesSearch(row, search);
  }), [rows, search]);

  if (!isAdminUser(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader title="Review Queue" subtitle="Read-only order review inbox" badge="Read-only" />

      <main className="mx-auto mt-4 w-full max-w-[1180px] space-y-4 px-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <StatCard icon={ShieldCheck} label="Total Items" value={stats.total} isRefreshing={isFetching} />
          <StatCard icon={Clock3} label="Open" value={stats.open} />
          <StatCard icon={CheckCircle2} label="Resolved" value={stats.resolved} />
          <StatCard icon={AlertTriangle} label="Refund Related" value={stats.refund} />
        </div>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-[1fr_180px]">
            <label className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search incident, customer, order, source..."
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground">
              <option value="open">Open</option>
              <option value="all">All status</option>
              <option value="pending">Pending</option>
              <option value="reviewing">Reviewing</option>
              <option value="resolved">Resolved</option>
              <option value="rejected">Rejected</option>
              <option value="archived">Archived</option>
            </select>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            This service-role read view is intentionally read-only. It does not resolve, repair, replay, refund, sync, notify, or mutate review items.
          </p>
          {data?.source && (
            <p className="mt-1 text-[10px] text-muted-foreground">
              Source: {formatLabel(data.source)}{data?.truncated ? ' - result set truncated' : ''}
            </p>
          )}
        </section>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load review queue</p>
            <p className="mt-1 text-xs text-muted-foreground">{error?.message || 'Try again later.'}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No review items found</p>
            <p className="mt-1 text-xs text-muted-foreground">Adjust filters or check Sync Health for current bridge diagnostics.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {filtered.map(row => <ReviewCard key={row.id || row.idempotency_key || `${row.incident_type}-${row.created_date}`} row={row} />)}
          </div>
        )}
      </main>
    </div>
  );
}
