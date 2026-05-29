import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

const MAX_RANGE_DAYS = 31;
const presetOptions = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 Days' },
  { value: 'last_30_days', label: 'Last 30 Days' },
];

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

function validateRange(from, to) {
  if (!from || !to) return 'Choose a start and end date.';
  if (to < from) return 'End date must be on or after start date.';
  if (daysInclusive(from, to) > MAX_RANGE_DAYS) return `Date range must be ${MAX_RANGE_DAYS} days or fewer.`;
  return null;
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
  if (!value) return 'Not returned';
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
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function sanitizeAdminText(value) {
  if (!value) return '';
  return value
    .toString()
    .replace(/\b(?:ch|re|pi|cs|cus|sub|evt|in|pm|seti|si|src|tok|po|li)_[A-Za-z0-9]{8,}\b/g, '[redacted]')
    .replace(/\bgid:\/\/shopify\/[A-Za-z]+\/[A-Za-z0-9_-]+\b/g, '[redacted]');
}

function statusClass(value) {
  const key = (value || '').toString().toLowerCase();
  if (key.includes('success') || key.includes('active')) return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (key.includes('fail') || key.includes('error')) return 'bg-red-50 text-red-700 border-red-100';
  if (key.includes('pending') || key.includes('stale')) return 'bg-amber-50 text-amber-800 border-amber-100';
  if (key.includes('deprecated') || key.includes('disabled')) return 'bg-secondary text-secondary-foreground border-border/50';
  return 'bg-blue-50 text-blue-700 border-blue-100';
}

function StatusChip({ value }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full border text-[10px] font-semibold ${statusClass(value)}`}>
      {formatLabel(value)}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, sublabel, tone = 'default', isRefreshing }) {
  const toneClass = {
    default: 'border-border/50 bg-card',
    success: 'border-emerald-100 bg-emerald-50/60',
    warning: 'border-amber-100 bg-amber-50/60',
    danger: 'border-red-100 bg-red-50/60',
    info: 'border-blue-100 bg-blue-50/60',
  }[tone] || 'border-border/50 bg-card';

  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      {Icon && <Icon className={`w-4 h-4 text-primary mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold text-foreground">{value}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function DirectionCard({ title, description, direction }) {
  const stats = direction || {};
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Total" value={formatNumber(stats.total)} />
        <StatCard label="Success" value={formatNumber(stats.success)} tone="success" />
        <StatCard label="Failed" value={formatNumber(stats.failed)} tone="danger" />
        <StatCard label="Pending" value={formatNumber(stats.pending)} tone="warning" />
      </div>
    </section>
  );
}

function ErrorCategories({ categories }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-foreground">Error Categories</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Sanitized aggregate categories only. Raw logs are not shown.</p>
      </div>
      {categories.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          No error categories returned for this range.
        </p>
      ) : (
        <div className="space-y-2">
          {categories.map((category, index) => (
            <div key={`${category.category}-${index}`} className="rounded-lg border border-border/50 bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{category.category || 'Other'}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    Latest seen: {formatDateTime(category.latest_seen_at)}
                  </p>
                </div>
                <StatusChip value={`${formatNumber(category.count)} events`} />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DeprecatedTools({ tools }) {
  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold text-foreground">Disabled / Deprecated Tools</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Static owner context only. No repair, replay, or sync controls are available here.</p>
      </div>
      {tools.length === 0 ? (
        <p className="text-xs text-muted-foreground rounded-lg border border-border/50 bg-background p-3">
          No disabled or deprecated tool context returned.
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {tools.map((tool, index) => (
            <div key={`${tool.name}-${index}`} className="rounded-lg border border-border/50 bg-background p-3 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{tool.name || 'Tool'}</p>
                <StatusChip value={tool.status || 'unknown'} />
              </div>
              {tool.note && <p className="text-xs text-muted-foreground leading-relaxed">{tool.note}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function NativeCustomerAppContext({ context }) {
  const summary = context?.summary || {};
  const reviewIssues = Array.isArray(context?.recent_review_issues) ? context.recent_review_issues : [];
  const syncLogs = Array.isArray(context?.recent_sync_logs) ? context.recent_sync_logs : [];

  return (
    <section className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
      <div>
        <h2 className="text-sm font-bold text-foreground">Native Customer App Review / Issues</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Native OrderReviewQueue and OrderSyncLog context. Read-only; no retry, repair, replay, or recovery controls.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <StatCard label="Native Sync Logs" value={formatNumber(summary.native_sync_events)} />
        <StatCard label="Native Success" value={formatNumber(summary.native_success_count)} tone="success" />
        <StatCard label="Native Failed" value={formatNumber(summary.native_failed_count)} tone={Number(summary.native_failed_count || 0) > 0 ? 'danger' : 'default'} />
        <StatCard label="Native Pending" value={formatNumber(summary.native_pending_count)} tone={Number(summary.native_pending_count || 0) > 0 ? 'warning' : 'default'} />
        <StatCard label="Active Reviews" value={formatNumber(summary.active_review_count)} tone={Number(summary.active_review_count || 0) > 0 ? 'warning' : 'default'} />
      </div>

      {reviewIssues.length === 0 ? (
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
          <p className="text-xs font-semibold text-emerald-800">No active native review issues returned.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Active Native Review Items</p>
          {reviewIssues.map(issue => (
            <div key={issue.id || `${issue.order_number}-${issue.incident_type}`} className="rounded-lg border border-amber-100 bg-amber-50/70 p-3 space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-950">{formatLabel(issue.incident_type)}</p>
                  <p className="text-[10px] text-amber-800 mt-0.5">
                    {[issue.order_number ? `Order ${issue.order_number}` : null, issue.source ? formatLabel(issue.source) : null, `Last seen ${formatDateTime(issue.last_seen_at)}`].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <StatusChip value={issue.status || 'pending'} />
              </div>
              {issue.issue && <p className="text-xs text-amber-900 leading-relaxed">{issue.issue}</p>}
              {issue.recommended_action && (
                <p className="text-[10px] font-semibold text-amber-900">Recommended: {formatLabel(issue.recommended_action)}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {syncLogs.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Recent Native Sync Logs</p>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
            {syncLogs.slice(0, 8).map(log => (
              <div key={log.id || `${log.order_number}-${log.timestamp}`} className="rounded-lg border border-border/50 bg-background p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-foreground">{log.order_number || 'Order pending'}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {[log.source ? formatLabel(log.source) : null, log.event_type ? formatLabel(log.event_type) : null, formatDateTime(log.timestamp)].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <StatusChip value={log.status || 'unknown'} />
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  {[log.action ? `Action: ${formatLabel(log.action)}` : null, log.reason ? `Reason: ${sanitizeAdminText(log.reason)}` : null].filter(Boolean).join(' · ') || 'No reason returned'}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

export default function SyncHealth() {
  const { user } = useAuth();
  const today = useMemo(() => todayDate(), []);
  const [preset, setPreset] = useState('last_7_days');
  const [dateFrom, setDateFrom] = useState(addDays(today, -6));
  const [dateTo, setDateTo] = useState(today);
  const [appliedDateFrom, setAppliedDateFrom] = useState(addDays(today, -6));
  const [appliedDateTo, setAppliedDateTo] = useState(today);
  const [statusFilter, setStatusFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [actionFilter, setActionFilter] = useState('all');
  const isCustom = preset === 'custom';
  const rangeError = validateRange(dateFrom, dateTo);
  const requestDateFrom = isCustom ? appliedDateFrom : null;
  const requestDateTo = isCustom ? appliedDateTo : null;

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-sync-health-summary', preset, requestDateFrom, requestDateTo, statusFilter, sourceFilter, actionFilter],
    queryFn: async () => {
      const payload = {
        limit: 300,
      };
      if (isCustom) {
        payload.preset = 'custom';
        payload.date_from = appliedDateFrom;
        payload.date_to = appliedDateTo;
      } else {
        payload.preset = preset;
      }
      if (statusFilter !== 'all') payload.status = statusFilter;
      if (sourceFilter !== 'all') payload.source = sourceFilter;
      if (actionFilter !== 'all') payload.action = actionFilter;

      const res = await base44.functions.invoke('getAdminSyncHealthSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, directions: {}, error_categories: [], disabled_or_deprecated_tools: [] };
    },
    enabled: user?.role === 'admin',
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
  const directions = data?.directions || {};
  const errorCategories = data?.error_categories || [];
  const deprecatedTools = data?.disabled_or_deprecated_tools || [];
  const nativeCustomerApp = data?.native_customer_app || {};
  const pendingStale = Number(summary.pending_count || 0) + Number(summary.stale_count || 0);
  const showError = isError && !data && !isFetching;
  const nativeSummary = nativeCustomerApp.summary || {};
  const nativeActivity =
    Number(nativeSummary.native_sync_events || 0) > 0 ||
    Number(nativeSummary.total_review_count || 0) > 0;
  const hasActivity = Number(summary.total_events || 0) > 0 || errorCategories.length > 0 || deprecatedTools.length > 0 || nativeActivity;
  const contextLabel = (() => {
    if (isCustom) {
      const hasCurrentResponse = data?.date_from === appliedDateFrom && data?.date_to === appliedDateTo;
      const from = hasCurrentResponse ? data.date_from : appliedDateFrom;
      const to = hasCurrentResponse ? data.date_to : appliedDateTo;
      return `${formatDate(from)} - ${formatDate(to)}`;
    }
    if (data?.date_from && data?.date_to) {
      return `${formatDate(data.date_from)} - ${formatDate(data.date_to)}`;
    }
    return presetOptions.find(option => option.value === preset)?.label || 'Last 7 Days';
  })();

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Sync Health"
        subtitle="Read-only bridge health"
        badge="Read-only"
      />

      <div className="px-4 mt-4 space-y-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sync range</p>
                <p className="text-xs font-semibold text-foreground mt-0.5">{contextLabel}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Generated</p>
              <p className="text-xs text-foreground">{formatDateTime(data?.generated_at)}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {presetOptions.map(option => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPreset(option.value)}
                className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                  preset === option.value
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Custom From</span>
              <input
                type="date"
                value={dateFrom}
                onChange={event => setDateFrom(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Custom To</span>
              <input
                type="date"
                value={dateTo}
                onChange={event => setDateTo(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              disabled={Boolean(rangeError)}
              onClick={() => {
                if (rangeError) return;
                setAppliedDateFrom(dateFrom);
                setAppliedDateTo(dateTo);
                setPreset('custom');
              }}
              className={`h-9 px-3 rounded-lg border text-xs font-semibold transition-colors ${
                rangeError
                  ? 'bg-muted text-muted-foreground border-border cursor-not-allowed'
                  : preset === 'custom' && appliedDateFrom === dateFrom && appliedDateTo === dateTo
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background text-muted-foreground border-border hover:text-foreground'
              }`}
            >
              Apply Range
            </button>
          </div>

          {rangeError && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
              {rangeError}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Status</span>
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Statuses</option>
                <option value="success">Success</option>
                <option value="failed">Failed</option>
                <option value="pending">Pending</option>
                <option value="stale">Stale</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source</span>
              <select
                value={sourceFilter}
                onChange={event => setSourceFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Sources</option>
                <option value="customer_app_to_hub">Customer App to Hub</option>
                <option value="hub_to_customer_app">Hub to Customer App</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Action</span>
              <select
                value={actionFilter}
                onChange={event => setActionFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Actions</option>
                <option value="order_sync">Order Sync</option>
                <option value="status_sync">Status Sync</option>
                <option value="subscription_sync">Subscription Sync</option>
                <option value="refund_sync">Refund Sync</option>
                <option value="delivery_status_sync">Delivery Status Sync</option>
              </select>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2">
          <StatCard icon={Activity} label="Total Sync Events" value={formatNumber(summary.total_events)} isRefreshing={isFetching} />
          <StatCard icon={CheckCircle2} label="Success" value={formatNumber(summary.success_count)} tone="success" />
          <StatCard icon={XCircle} label="Failed" value={formatNumber(summary.failed_count)} tone="danger" />
          <StatCard icon={AlertTriangle} label="Pending / Stale" value={formatNumber(pendingStale)} tone="warning" />
          <StatCard icon={Clock3} label="Latest Success" value={formatDateTime(summary.latest_success_at)} />
          <StatCard icon={Clock3} label="Latest Failure" value={formatDateTime(summary.latest_failure_at)} />
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Hub Sync Health view</p>
            <p className="text-[10px] text-muted-foreground">Read-only bridge visibility. If Hub summary is unavailable, native Customer App review and sync context still loads below. Sync, retry, recover, replay, repair, export, and raw-log actions are not available here.</p>
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        {showError && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load sync health summary</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        )}

        {data?.hub_available === false && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              {data.hub_error
                ? `Hub sync health summary unavailable (${data.hub_error}); native Customer App issue context is still shown.`
                : 'Hub sync health summary unavailable; native Customer App issue context is still shown.'}
            </span>
          </div>
        )}

        {data?.truncated && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
            Results are capped. Narrow the date range or filters for a more complete sync health view.
          </p>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : !showError && !hasActivity ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No sync health activity found</p>
            <p className="text-xs text-muted-foreground mt-1">Try another preset, filter, or valid custom date range.</p>
          </div>
        ) : !showError ? (
          <div className="space-y-4">
            <DirectionCard
              title="Customer App to Hub"
              description="Aggregate outbound bridge activity"
              direction={directions.customer_app_to_hub}
            />
            <DirectionCard
              title="Hub to Customer App"
              description="Aggregate inbound status bridge activity"
              direction={directions.hub_to_customer_app}
            />
            <NativeCustomerAppContext context={nativeCustomerApp} />
            <ErrorCategories categories={errorCategories} />
            <DeprecatedTools tools={deprecatedTools} />
          </div>
        ) : null}

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <p className="text-[10px] text-muted-foreground leading-relaxed">
            Browser requests stop at the Customer App wrapper. Hub credentials stay server-side.
          </p>
        </div>
      </div>
    </div>
  );
}
