import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AdminOpsHeader from '@/components/admin/AdminOpsHeader';
import { AdminStatusPill } from '@/components/admin/AdminStatusPill';
import { base44 } from '@/api/base44Client';
import { unwrapBase44Result } from '@/lib/base44-result';
import { isAdminUser } from '@/lib/admin-access';
import { useAuth } from '@/lib/AuthContext';
import { usePageVisibility } from '@/lib/usePageVisibility';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, MapPin, Navigation, Truck } from 'lucide-react';

function todayDate() {
  const today = new Date();
  return [
    today.getFullYear(),
    `${today.getMonth() + 1}`.padStart(2, '0'),
    `${today.getDate()}`.padStart(2, '0'),
  ].join('-');
}

function shiftDate(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    `${date.getMonth() + 1}`.padStart(2, '0'),
    `${date.getDate()}`.padStart(2, '0'),
  ].join('-');
}

function formatDate(value) {
  if (!value) return 'Date pending';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return value;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatLabel(value) {
  if (!value) return 'Not set';
  return value.toString().split(/[_\s-]+/).filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function StatCard({ icon: Icon, label, value, sublabel, tone = 'default', isRefreshing }) {
  const toneClass = {
    default: 'border-border/50 bg-card',
    success: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30',
    warning: 'border-cyan-200 bg-cyan-50/70 dark:border-cyan-900/60 dark:bg-cyan-950/30',
  }[tone] || 'border-border/50 bg-card';
  return (
    <div className={`rounded-xl border p-3 ${toneClass}`}>
      {Icon && <Icon className={`mb-1 h-4 w-4 text-primary ${isRefreshing ? 'animate-spin' : ''}`} />}
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-foreground">
        {value === null || value === undefined ? '—' : Number(value).toLocaleString()}
      </p>
      {sublabel && <p className="text-[10px] text-muted-foreground">{sublabel}</p>}
    </div>
  );
}

function RouteReadiness({ summary, data }) {
  const unscheduled = Number(summary.unscheduled || 0);
  const active = Number(summary.active || 0);
  const completed = Number(summary.completed || 0);
  const lifecycleSummary = data?.delivery_lifecycle_read_model?.summary || {};
  const reviewRequired = Number(lifecycleSummary.review_required_count || 0);
  const duplicateIdentities = Number(lifecycleSummary.duplicate_identity_count || 0);
  const fallbackRows = Number(lifecycleSummary.fallback_required_count || 0);
  const needsAttention = unscheduled > 0 || reviewRequired > 0 || duplicateIdentities > 0;
  const label = needsAttention
    ? 'Route review needed'
    : active > 0
      ? 'Route active'
      : completed > 0
        ? 'Completed route evidence'
        : 'No active route';
  const value = needsAttention ? 'needs_attention' : active > 0 || completed > 0 ? 'ready' : 'clear';
  const reviewDetails = [
    reviewRequired > 0 ? `${reviewRequired} lifecycle ${reviewRequired === 1 ? 'item' : 'items'}` : null,
    duplicateIdentities > 0 ? `${duplicateIdentities} identity ${duplicateIdentities === 1 ? 'conflict' : 'conflicts'}` : null,
    needsAttention && fallbackRows > 0 ? `${fallbackRows} fallback ${fallbackRows === 1 ? 'row' : 'rows'}` : null,
  ].filter(Boolean).join(' · ');

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Route Review</p>
          <h2 className="mt-1 text-base font-bold text-foreground">{label}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {needsAttention && reviewDetails
              ? `${reviewDetails} need review before this route can be treated as reconciled.`
              : 'Delivery Queue remains the write surface for assignment, Out For Delivery, proof capture, and Delivered. This page is a route-management snapshot.'}
          </p>
        </div>
        <AdminStatusPill value={value} label={formatLabel(value)} size="md" />
      </div>
      <Link to="/admin/delivery-queue" className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground">
        Open Delivery Queue
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </section>
  );
}

function StopCard({ stop, type }) {
  const orderRef = stop.order_number || stop.source_order_id || '';

  return (
    <article className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{type}</p>
          <h3 className="mt-0.5 text-sm font-bold text-foreground">{stop.customer_name || stop.order_number || 'Delivery stop'}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{stop.order_number || stop.source_order_id || 'Order pending'}</p>
        </div>
        <AdminStatusPill value={stop.status || stop.fulfillment_status || type} label={formatLabel(stop.status || stop.fulfillment_status || type)} size="md" />
      </div>
      <p className="mt-3 text-xs font-medium text-foreground">{stop.items_summary || 'Items pending'}</p>
      {(stop.delivery_address || stop.delivery_area || stop.address) && (
        <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{stop.delivery_address || stop.delivery_area || stop.address}</span>
        </p>
      )}
      {stop.delivery_notes && <p className="mt-3 rounded-lg border border-border/50 bg-background p-3 text-xs text-muted-foreground">Notes: {stop.delivery_notes}</p>}
      {orderRef && (
        <Link
          to={`/admin/orders?order=${encodeURIComponent(orderRef)}`}
          className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground hover:border-primary/60"
        >
          View order details
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      )}
    </article>
  );
}

export default function RouteOps() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isPageVisible = usePageVisibility();
  const [deliveryDate, setDeliveryDate] = useState(todayDate());

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ['admin-route-ops-summary', deliveryDate],
    queryFn: async () => {
      const res = await base44.functions.invoke('getAdminDeliveryRouteSummary', {
        delivery_date: deliveryDate,
        limit: 100,
        read_model_mode: 'DELIVERY_LIFECYCLE',
      });
      const result = unwrapBase44Result(res);
      if (result?.error) throw new Error(result.error);
      return result || { summary: {}, sections: {} };
    },
    enabled: isAdminUser(user) && isPageVisible,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: isPageVisible ? 30000 : false,
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (!isAdminUser(user) || !isPageVisible) return;
    queryClient.invalidateQueries({ queryKey: ['admin-route-ops-summary', deliveryDate] });
  }, [deliveryDate, isPageVisible, queryClient, user]);

  const summary = data?.summary || {};
  const sections = data?.sections || {};
  const stops = sections.delivery_stops || [];
  const completed = sections.completed || [];
  const unscheduled = sections.unscheduled_delivery_orders || [];
  const suppressedNativeRows = sections.suppressed_stale_delivery_tasks || [];
  const rows = useMemo(() => [
    ...unscheduled.slice(0, 4).map(stop => ({ stop, type: 'Date pending' })),
    ...stops.slice(0, 4).map(stop => ({ stop, type: 'Active stop' })),
    ...completed.slice(0, 4).map(stop => ({ stop, type: 'Completed' })),
  ].slice(0, 8), [completed, stops, unscheduled]);

  if (!isAdminUser(user)) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <p className="text-sm text-muted-foreground">Admin access required.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-10">
      <AdminOpsHeader title="Route Ops" subtitle="Delivery route review and queue handoff" badge="Route Review" badgeTone="native" />

      <main className="mx-auto mt-4 w-full max-w-[1180px] space-y-4 px-4">
        <section className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <label className="space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Delivery Date</span>
              <input type="date" value={deliveryDate} onChange={event => setDeliveryDate(event.target.value || todayDate())} className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground" />
            </label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setDeliveryDate(shiftDate(deliveryDate, -1))} className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground">Previous</button>
              <button type="button" onClick={() => setDeliveryDate(todayDate())} className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground">Today</button>
              <button type="button" onClick={() => setDeliveryDate(shiftDate(deliveryDate, 1))} className="h-9 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground">Next</button>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Route snapshot for {formatDate(deliveryDate)}. Use Delivery Queue for driver assignment, proof upload, customer-notification-gated delivery actions, and Delivered completion.</p>
        </section>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
          <StatCard icon={Truck} label="Total Stops" value={summary.total_stops} isRefreshing={isFetching} />
          <StatCard icon={Clock} label="Active" value={summary.active} />
          <StatCard icon={CheckCircle2} label="Completed" value={summary.completed} tone="success" />
          <StatCard icon={AlertTriangle} label="Date Pending" value={summary.unscheduled} tone={Number(summary.unscheduled || 0) > 0 ? 'warning' : 'default'} />
          <StatCard
            icon={Navigation}
            label="Bag Returns"
            value={summary.bag_returns}
            sublabel={summary.bag_returns === null || summary.bag_returns === undefined ? 'No count recorded' : ''}
          />
        </div>

        <RouteReadiness summary={summary} data={data} />

        {suppressedNativeRows.length > 0 && (
          <section className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 space-y-2 dark:border-cyan-900/60 dark:bg-cyan-950/30">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-700 dark:text-cyan-300" />
              <div>
                <p className="text-xs font-semibold text-cyan-950 dark:text-cyan-100">Historical native task context</p>
                <p className="text-[10px] text-cyan-900 dark:text-cyan-200/80">
                  Legacy nonterminal native tasks are excluded from active route totals for this date and kept here for audit context.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-cyan-200 bg-white/70 px-2 py-1 text-[10px] font-semibold text-cyan-900 dark:border-cyan-800/70 dark:bg-background/70 dark:text-cyan-100">
                Suppressed native rows: {suppressedNativeRows.length}
              </span>
              {data?.stale_native_delivery_task_detected && (
                <span className="rounded-full border border-cyan-200 bg-white/70 px-2 py-1 text-[10px] font-semibold text-cyan-900 dark:border-cyan-800/70 dark:bg-background/70 dark:text-cyan-100">
                  Active route impact prevented
                </span>
              )}
            </div>
            <div className="space-y-1">
              {suppressedNativeRows.slice(0, 5).map(row => (
                <p key={`${row.order_number}-${row.delivery_date}-${row.native_fulfillment_task_id || row.task_id}`} className="text-[10px] text-cyan-900 dark:text-cyan-200/80">
                  {row.order_number}: {formatLabel(row.task_status || row.delivery_status || 'pending')} · {formatLabel(row.suppression_reason)}
                </p>
              ))}
            </div>
          </section>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
            <p className="text-sm font-semibold text-destructive">Unable to load route summary</p>
            <p className="mt-1 text-xs text-muted-foreground">{error?.message || 'Try again later.'}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-8 text-center">
            <p className="text-sm font-semibold text-foreground">No route rows found</p>
            <p className="mt-1 text-xs text-muted-foreground">This date has no active, completed, or date-pending delivery rows.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            {rows.map(({ stop, type }, index) => <StopCard key={`${type}-${stop.id || stop.order_number || index}`} stop={stop} type={type} />)}
          </div>
        )}
      </main>
    </div>
  );
}
