import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
} from 'lucide-react';
import { AdminStatusLegend, AdminStatusPill } from '@/components/admin/AdminStatusPill';
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

function categorySelectOptions(alerts, selectedCategory) {
  const categories = new Set(alerts.map(alert => alert.category).filter(Boolean));
  if (selectedCategory && selectedCategory !== 'all') categories.add(selectedCategory);
  return [...categories].sort((a, b) => a.localeCompare(b));
}

function normalizedStatus(status) {
  return (status || '').toString().trim().toLowerCase();
}

function availableAlertActions(status) {
  const key = normalizedStatus(status);
  if (key === 'unread' || key === 'read') return ['acknowledge', 'resolve', 'dismiss'];
  if (key === 'acknowledged') return ['resolve', 'dismiss'];
  return [];
}

function isTerminalStatus(status) {
  const key = normalizedStatus(status);
  return key === 'resolved' || key === 'dismissed';
}

function generateRequestId(action, alertId) {
  const randomPart = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `ops_alert_${action}_${alertId}_${Date.now()}_${randomPart}`;
}

function sanitizeClientNote(value) {
  const text = (value || '').toString().replace(/\s+/g, ' ').trim();
  return text.length > 500 ? `${text.slice(0, 499).trim()}...` : text;
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

function Chip({ value, context = 'status' }) {
  return <AdminStatusPill value={value} label={formatLabel(value)} context={context} />;
}

function ActionButton({ children, onClick, disabled, variant = 'default' }) {
  const variantClasses = {
    default: 'border-border bg-background text-foreground hover:bg-secondary',
    primary: 'border-primary/20 bg-primary text-primary-foreground hover:bg-primary/90',
    muted: 'border-border bg-secondary text-secondary-foreground hover:bg-secondary/80',
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`h-8 rounded-lg border px-3 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${variantClasses[variant]}`}
    >
      {children}
    </button>
  );
}

function AlertCard({ alert, feedback, pendingAction, onAction }) {
  const created = formatDateTime(alert.created_date);
  const updated = formatDateTime(alert.updated_date);
  const actions = alert.id ? availableAlertActions(alert.status) : [];
  const terminal = isTerminalStatus(alert.status);
  const isPending = pendingAction?.alertId === alert.id;

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
          <Chip value={alert.severity} context="severity" />
          <Chip value={alert.status} />
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

      {(actions.length > 0 || terminal || feedback) && (
        <div className="border-t border-border/40 pt-3 space-y-2">
          {actions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {actions.includes('acknowledge') && (
                <ActionButton
                  onClick={() => onAction(alert, 'acknowledge')}
                  disabled={isPending}
                  variant="muted"
                >
                  {isPending && pendingAction.action === 'acknowledge' ? 'Acknowledging...' : 'Acknowledge'}
                </ActionButton>
              )}
              {actions.includes('resolve') && (
                <ActionButton
                  onClick={() => onAction(alert, 'resolve')}
                  disabled={isPending}
                  variant="primary"
                >
                  {isPending && pendingAction.action === 'resolve' ? 'Resolving...' : 'Resolve'}
                </ActionButton>
              )}
              {actions.includes('dismiss') && (
                <ActionButton
                  onClick={() => onAction(alert, 'dismiss')}
                  disabled={isPending}
                >
                  {isPending && pendingAction.action === 'dismiss' ? 'Dismissing...' : 'Dismiss'}
                </ActionButton>
              )}
            </div>
          )}
          {terminal && (
            <p className="text-[10px] text-muted-foreground">
              This alert is {formatLabel(alert.status).toLowerCase()}. No actions are available.
            </p>
          )}
          {feedback && (
            <p className={`text-[10px] font-medium ${feedback.type === 'error' ? 'text-destructive' : 'text-green-700'}`}>
              {feedback.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function OpsAlerts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [pendingAction, setPendingAction] = useState(null);
  const [feedbackByAlert, setFeedbackByAlert] = useState({});

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

  async function refreshOpsAlertSummaries() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-ops-alerts-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-operations-dashboard-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-sync-health-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-shopify-ops-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-production-planning-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-inventory-status-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-delivery-route-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['admin_compliance_ops_summary'] }),
    ]);
  }

  const handleAlertAction = async (alert, action) => {
    if (!alert?.id || pendingAction) return;

    let resolutionNote = '';
    if (action === 'resolve') {
      const confirmed = window.confirm('Resolve this ops alert? This will mark it resolved in Operations Hub.');
      if (!confirmed) return;
      const note = window.prompt('Optional resolution note. Leave blank for no note.', '');
      if (note === null) return;
      resolutionNote = sanitizeClientNote(note);
    }

    if (action === 'dismiss') {
      const confirmed = window.confirm('Dismiss this ops alert? Dismissed alerts are terminal.');
      if (!confirmed) return;
    }

    const requestId = generateRequestId(action, alert.id);
    setPendingAction({ alertId: alert.id, action });
    setFeedbackByAlert(current => ({
      ...current,
      [alert.id]: null,
    }));

    try {
      const payload = {
        alert_id: alert.id,
        action,
        request_id: requestId,
      };
      if (action === 'resolve' && resolutionNote) payload.resolution_note = resolutionNote;

      const res = await base44.functions.invoke('updateAdminOpsAlertStatus', payload);
      const result = res?.data || res;
      if (!result?.success) throw new Error('Alert update failed');

      setFeedbackByAlert(current => ({
        ...current,
        [alert.id]: {
          type: 'success',
          message: `${formatLabel(action)} saved.`,
        },
      }));
      await refreshOpsAlertSummaries();
    } catch {
      setFeedbackByAlert(current => ({
        ...current,
        [alert.id]: {
          type: 'error',
          message: 'Unable to update this alert. Refresh and try again.',
        },
      }));
    } finally {
      setPendingAction(null);
    }
  };

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <p className="text-muted-foreground text-sm">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-10">
      <AdminOpsHeader
        title="Ops Alerts"
        subtitle="Sanitized operations inbox"
        badge="Limited actions"
        badgeTone="warning"
      />

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
            <p className="text-[10px] text-muted-foreground">Sanitized alert visibility only. Acknowledge, resolve, and dismiss are available for active alerts only.</p>
            <AdminStatusLegend className="mt-2" />
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
                <AlertCard
                  key={alert.id || `${alert.title}-${alert.created_date}`}
                  alert={alert}
                  feedback={feedbackByAlert[alert.id]}
                  pendingAction={pendingAction}
                  onAction={handleAlertAction}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
