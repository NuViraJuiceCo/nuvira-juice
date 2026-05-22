import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  Bell,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';

function formatDateTime(value) {
  if (!value) return null;
  try {
    return format(new Date(value), 'MMM d, yyyy - h:mm a');
  } catch {
    return value;
  }
}

function formatLabel(value) {
  if (!value) return 'Not set';
  return value
    .toString()
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function severityClass(severity) {
  const key = (severity || '').toString().toLowerCase();
  if (key === 'critical' || key === 'high') return 'bg-red-100 text-red-800';
  if (key === 'warning' || key === 'medium') return 'bg-amber-100 text-amber-800';
  if (key === 'info' || key === 'low') return 'bg-blue-100 text-blue-700';
  return 'bg-muted text-muted-foreground';
}

function statusClass(status) {
  const key = (status || '').toString().toLowerCase();
  if (key.includes('resolved') || key.includes('dismissed')) return 'bg-green-100 text-green-700';
  if (key.includes('ack')) return 'bg-blue-100 text-blue-700';
  if (key.includes('open') || key.includes('active') || key.includes('new')) return 'bg-red-50 text-red-700';
  return 'bg-muted text-muted-foreground';
}

function categorySelectOptions(alerts, selectedCategory) {
  const categories = new Set(alerts.map(alert => alert.category).filter(Boolean));
  if (selectedCategory && selectedCategory !== 'all') categories.add(selectedCategory);
  return [...categories].sort((a, b) => a.localeCompare(b));
}

function StatCard({ icon: Icon, label, value, sublabel, isRefreshing }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card p-3">
      {Icon && <Icon className={`w-4 h-4 text-primary mb-1 ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</p>
      <p className="text-lg font-bold">{value}</p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function Chip({ value, classNameFor }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${classNameFor(value)}`}>
      {formatLabel(value)}
    </span>
  );
}

function AlertCard({ alert }) {
  const created = formatDateTime(alert.created_date);
  const updated = formatDateTime(alert.updated_date);

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {alert.category || 'Ops Alert'}
          </p>
          <h2 className="font-heading text-base font-bold text-foreground mt-0.5 break-words">
            {alert.title || 'Untitled alert'}
          </h2>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Chip value={alert.severity} classNameFor={severityClass} />
          <Chip value={alert.status} classNameFor={statusClass} />
        </div>
      </div>

      <p className="text-sm text-foreground/85 leading-relaxed break-words">
        {alert.summary || 'Additional details available in Operations Hub.'}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Source</p>
          <p className="text-xs font-semibold mt-0.5">{alert.source || 'Source pending'}</p>
        </div>
        <div className="rounded-lg bg-secondary/50 p-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Related Record</p>
          <p className="text-xs font-semibold mt-0.5">
            {alert.related_display_id
              ? `${formatLabel(alert.related_record_type)} ${alert.related_display_id}`
              : 'No related record'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-border/40">
        <p className="text-[10px] text-muted-foreground">Created: {created || 'Not set'}</p>
        <p className="text-[10px] text-muted-foreground sm:text-right">Updated: {updated || 'Not set'}</p>
      </div>
    </div>
  );
}

export default function OpsAlerts() {
  const { user } = useAuth();
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-ops-alerts-summary', severityFilter, statusFilter, categoryFilter, search],
    queryFn: async () => {
      const payload = {
        limit: 100,
      };
      if (search.trim()) payload.search = search.trim();
      if (severityFilter !== 'all') payload.severity = severityFilter;
      if (statusFilter !== 'all') payload.status = statusFilter;
      if (categoryFilter !== 'all') payload.category = categoryFilter;

      const res = await base44.functions.invoke('getAdminOpsAlertsSummary', payload);
      const result = res?.data || res;
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, alerts: [] };
    },
    enabled: user?.role === 'admin',
    staleTime: 60000,
  });

  const alerts = data?.alerts || [];
  const summary = data?.summary || {};
  const categoryOptions = useMemo(() => categorySelectOptions(alerts, categoryFilter), [alerts, categoryFilter]);

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="bg-primary px-4 pt-10 pb-5">
        <Link to="/account" className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center mb-3">
          <ArrowLeft className="w-4 h-4 text-white" />
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="font-heading text-2xl font-bold text-primary-foreground">Ops Alerts</h1>
            <p className="text-primary-foreground/70 text-xs mt-0.5">Read-only operations inbox</p>
          </div>
          <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/20 text-white">Read-only</span>
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <StatCard icon={Bell} label="Active" value={summary.total_active ?? 0} />
          <StatCard icon={ShieldAlert} label="Critical" value={summary.critical ?? 0} />
          <StatCard icon={AlertTriangle} label="Warning" value={summary.warning ?? 0} />
          <StatCard icon={Info} label="Info" value={summary.info ?? 0} isRefreshing={isFetching} />
        </div>

        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              className="w-full h-10 rounded-lg border border-border bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="Search alerts, summaries, categories, or sources..."
              value={search}
              onChange={event => setSearch(event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Severity</span>
              <select
                value={severityFilter}
                onChange={event => setSeverityFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Status</span>
              <select
                value={statusFilter}
                onChange={event => setStatusFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">Active Inbox</option>
                <option value="active">Active</option>
                <option value="open">Open</option>
                <option value="new">New</option>
                <option value="unresolved">Unresolved</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Category</span>
              <select
                value={categoryFilter}
                onChange={event => setCategoryFilter(event.target.value)}
                className="w-full h-10 rounded-lg border border-border bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="all">All Categories</option>
                {categoryOptions.map(category => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-card p-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-foreground">Hub Alerts view</p>
            <p className="text-[10px] text-muted-foreground">Preserved read-only operations inbox from Hub.</p>
          </div>
          <RefreshCw className={`w-4 h-4 text-primary ${isFetching ? 'animate-spin' : ''}`} />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load ops alerts</p>
            <p className="text-xs text-muted-foreground mt-1">{error?.message || 'Try again later.'}</p>
          </div>
        ) : alerts.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <AlertCircle className="w-5 h-5 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">No ops alerts found</p>
            <p className="text-xs text-muted-foreground mt-1">Try another search, severity, status, or category filter.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {data?.truncated && (
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3">
                Results are capped. Narrow the search or filters for a more complete view.
              </p>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {alerts.map(alert => (
                <AlertCard key={alert.id || `${alert.title}-${alert.created_date}`} alert={alert} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
